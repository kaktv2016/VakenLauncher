const crypto = require('crypto')
const { DatabaseSync } = require('node:sqlite')

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex')
}

function offlinePlayerUuid(username) {
    const bytes = crypto.createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest()
    bytes[6] = bytes[6] & 0x0f | 0x30
    bytes[8] = bytes[8] & 0x3f | 0x80
    const hex = bytes.toString('hex')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

class AuthRepository {
    constructor(databasePath = ':memory:', now = Date.now) {
        this.database = new DatabaseSync(databasePath)
        this.now = now
        this.database.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS accounts (
                uuid TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                username_norm TEXT NOT NULL UNIQUE,
                email TEXT,
                created_at INTEGER NOT NULL
            ) STRICT;
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                account_uuid TEXT NOT NULL REFERENCES accounts(uuid) ON DELETE CASCADE,
                refresh_hash TEXT NOT NULL UNIQUE,
                refresh_expires_at INTEGER NOT NULL,
                revoked_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            ) STRICT;
            CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions(account_uuid);
            CREATE TABLE IF NOT EXISTS minecraft_tickets (
                ticket_hash TEXT PRIMARY KEY,
                account_uuid TEXT NOT NULL,
                username TEXT NOT NULL,
                account_type TEXT NOT NULL CHECK(account_type = 'local'),
                session_id TEXT,
                server_id TEXT NOT NULL,
                audience TEXT NOT NULL,
                issued_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                consumed_at INTEGER
            ) STRICT;
            CREATE INDEX IF NOT EXISTS minecraft_tickets_expiry_idx
                ON minecraft_tickets(expires_at);
        `)
        // Old provider tickets are short-lived credentials, not player data.
        // Purge them during the Local-only migration and enforce the same rule
        // again in the atomic consume query below.
        this.database.prepare('DELETE FROM minecraft_tickets WHERE account_type <> \'local\'').run()
    }

    close() {
        this.database.close()
    }

    getAccountByUsername(username) {
        return this.database.prepare(
            'SELECT uuid, username, email, created_at AS createdAt FROM accounts WHERE username_norm = ?'
        ).get(username.toLowerCase())
    }

    getAccountByUuid(uuid) {
        return this.database.prepare(
            'SELECT uuid, username, email, created_at AS createdAt FROM accounts WHERE uuid = ?'
        ).get(uuid)
    }

    createOrGetAccount(username, email = null) {
        const existing = this.getAccountByUsername(username)
        if(existing != null) {
            return existing
        }
        const account = {
            // This is generated and persisted once by the backend. It matches
            // the UUID assigned by a direct offline-mode Youer connection, so
            // playerdata remains stable without trusting the username as proof.
            uuid: offlinePlayerUuid(username),
            username,
            email,
            createdAt: this.now()
        }
        try {
            this.database.prepare(
                'INSERT INTO accounts(uuid, username, username_norm, email, created_at) VALUES (?, ?, ?, ?, ?)'
            ).run(account.uuid, account.username, account.username.toLowerCase(), account.email, account.createdAt)
            return account
        } catch(error) {
            if(error.code === 'ERR_SQLITE_ERROR') {
                const raced = this.getAccountByUsername(username)
                if(raced != null) {
                    return raced
                }
            }
            throw error
        }
    }

    createSession(accountUuid, refreshTtlMs) {
        const sessionId = crypto.randomUUID()
        const refreshToken = crypto.randomBytes(32).toString('base64url')
        const now = this.now()
        const refreshExpiresAt = now + refreshTtlMs
        this.database.prepare(`
            INSERT INTO sessions(
                session_id, account_uuid, refresh_hash, refresh_expires_at,
                revoked_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, NULL, ?, ?)
        `).run(sessionId, accountUuid, hashToken(refreshToken), refreshExpiresAt, now, now)
        return { refreshExpiresAt, refreshToken, sessionId }
    }

    rotateSession(refreshToken, refreshTtlMs) {
        const now = this.now()
        const session = this.database.prepare(`
            SELECT session_id AS sessionId, account_uuid AS accountUuid
            FROM sessions
            WHERE refresh_hash = ? AND revoked_at IS NULL AND refresh_expires_at > ?
        `).get(hashToken(refreshToken), now)
        if(session == null) {
            return null
        }

        const nextToken = crypto.randomBytes(32).toString('base64url')
        const refreshExpiresAt = now + refreshTtlMs
        const result = this.database.prepare(`
            UPDATE sessions SET refresh_hash = ?, refresh_expires_at = ?, updated_at = ?
            WHERE session_id = ? AND refresh_hash = ? AND revoked_at IS NULL
        `).run(nextToken && hashToken(nextToken), refreshExpiresAt, now, session.sessionId, hashToken(refreshToken))
        if(result.changes !== 1) {
            return null
        }
        return { ...session, refreshExpiresAt, refreshToken: nextToken }
    }

    revokeSession(refreshToken) {
        const now = this.now()
        const result = this.database.prepare(`
            UPDATE sessions SET revoked_at = ?, updated_at = ?
            WHERE refresh_hash = ? AND revoked_at IS NULL
        `).run(now, now, hashToken(refreshToken))
        return result.changes === 1
    }

    isSessionActive(sessionId, accountUuid) {
        return this.database.prepare(`
            SELECT 1 FROM sessions
            WHERE session_id = ? AND account_uuid = ? AND revoked_at IS NULL AND refresh_expires_at > ?
        `).get(sessionId, accountUuid, this.now()) != null
    }

    createMinecraftTicket(identity, serverId, ttlMs) {
        const ticket = crypto.randomBytes(32).toString('base64url')
        const issuedAt = this.now()
        const expiresAt = issuedAt + ttlMs
        this.database.prepare('DELETE FROM minecraft_tickets WHERE expires_at <= ?').run(issuedAt)
        this.database.prepare(`
            INSERT INTO minecraft_tickets(
                ticket_hash, account_uuid, username, account_type, session_id,
                server_id, audience, issued_at, expires_at, consumed_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'minecraft-sso', ?, ?, NULL)
        `).run(
            hashToken(ticket),
            identity.uuid,
            identity.username,
            identity.type,
            identity.sessionId || null,
            serverId,
            issuedAt,
            expiresAt
        )
        return { expiresAt, ticket }
    }

    consumeMinecraftTicket(ticket, identity, serverId) {
        const now = this.now()
        const ticketHash = hashToken(ticket)
        const result = this.database.prepare(`
            UPDATE minecraft_tickets SET consumed_at = ?
            WHERE ticket_hash = ?
                AND consumed_at IS NULL
                AND expires_at > ?
                AND server_id = ?
                AND audience = 'minecraft-sso'
                AND account_uuid = ?
                AND username = ?
                AND account_type = 'local'
                AND EXISTS (
                    SELECT 1 FROM sessions
                    WHERE sessions.session_id = minecraft_tickets.session_id
                        AND sessions.account_uuid = minecraft_tickets.account_uuid
                        AND sessions.revoked_at IS NULL
                        AND sessions.refresh_expires_at > ?
                )
        `).run(now, ticketHash, now, serverId, identity.uuid, identity.username, now)
        if(result.changes !== 1) {
            return null
        }
        return this.database.prepare(`
            SELECT account_uuid AS uuid, username, account_type AS type,
                server_id AS serverId, audience, issued_at AS issuedAt,
                expires_at AS expiresAt, consumed_at AS consumedAt
            FROM minecraft_tickets WHERE ticket_hash = ?
        `).get(ticketHash)
    }
}

module.exports = { AuthRepository, hashToken, offlinePlayerUuid }
