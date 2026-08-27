const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const test = require('node:test')
const { AuthRepository, offlinePlayerUuid } = require('../services/auth-backend/src/repository')
const { AuthService } = require('../services/auth-backend/src/auth-service')
const { RateLimiter } = require('../services/auth-backend/src/rate-limiter')
const { ServiceRequestAuthenticator } = require('../services/auth-backend/src/service-request-authenticator')
const { TokenService } = require('../services/auth-backend/src/token-service')

function createFixture() {
    let now = 1_800_000_000_000
    const bridgeSecret = 'test-bridge-secret-with-at-least-32-bytes'
    const bridgeCalls = []
    const bridge = {
        login: async (username, password) => {
            bridgeCalls.push(['login', username, password])
            return { ok: password === 'correct-password', username }
        },
        register: async (username, password, email) => {
            bridgeCalls.push(['register', username, password, email])
            return { ok: true, username }
        }
    }
    const repository = new AuthRepository(':memory:', () => now)
    const tokenService = new TokenService({
        audience: 'youer-main',
        secret: 'test-signing-secret-with-at-least-32-bytes',
        accessTtlSeconds: 60,
        now: () => now
    })
    const service = new AuthService({
        bridge,
        emailEnabled: true,
        loginLimiter: new RateLimiter({ limit: 20, windowMs: 60_000, blockMs: 60_000, now: () => now }),
        registerLimiter: new RateLimiter({ limit: 20, windowMs: 60_000, blockMs: 60_000, now: () => now }),
        now: () => now,
        refreshTtlMs: 10 * 60_000,
        repository,
        serverId: 'youer-main',
        serviceAuthenticator: new ServiceRequestAuthenticator({ secret: bridgeSecret, now: () => now }),
        tokenService
    })
    return {
        advance: milliseconds => { now += milliseconds },
        bridgeSecret,
        bridgeCalls,
        repository,
        service,
        tokenService
    }
}

function signedRequest(path, body, secret, timestamp = 1_800_000_000_000, nonce = crypto.randomBytes(16).toString('base64url')) {
    const rawBody = Buffer.from(JSON.stringify(body))
    const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex')
    const canonical = `${timestamp}\n${nonce}\nPOST\n${path}\n${bodyHash}`
    return {
        body,
        headers: {
            'x-helios-nonce': nonce,
            'x-helios-signature': crypto.createHmac('sha256', secret).update(canonical).digest('base64url'),
            'x-helios-timestamp': timestamp.toString()
        },
        ip: '127.0.0.1',
        method: 'POST',
        path,
        rawBody
    }
}

function request(path, body, ip = '127.0.0.1') {
    return { body, headers: {}, ip, method: 'POST', path }
}

test('registers through the AuthMe bridge and persists one stable local UUID', async t => {
    const fixture = createFixture()
    t.after(() => fixture.repository.close())
    const registration = await fixture.service.handle(request('/api/auth/register', {
        email: 'PLAYER@example.com',
        password: 'correct-password',
        passwordConfirm: 'correct-password',
        username: 'LocalPlayer'
    }))

    assert.equal(registration.status, 200)
    assert.equal(registration.body.account.type, 'local')
    assert.match(registration.body.account.uuid, /^[0-9a-f-]{36}$/)
    assert.equal(registration.body.account.username, 'LocalPlayer')
    assert.deepEqual(fixture.bridgeCalls[0], [
        'register',
        'LocalPlayer',
        'correct-password',
        'player@example.com'
    ])

    const login = await fixture.service.handle(request('/api/auth/login', {
        password: 'correct-password',
        username: 'LocalPlayer'
    }))
    assert.equal(login.status, 200)
    assert.equal(login.body.account.uuid, registration.body.account.uuid)

    const accountColumns = fixture.repository.database.prepare('PRAGMA table_info(accounts)').all()
        .map(column => column.name)
    assert.equal(accountColumns.includes('password'), false)
})

test('uses the direct offline-mode UUID that Youer assigns to a local player', () => {
    assert.equal(offlinePlayerUuid('Notch'), 'b50ad385-829d-3141-a216-7e7d7539ba7f')
    assert.notEqual(offlinePlayerUuid('Notch'), offlinePlayerUuid('notch'))
})

test('purges obsolete non-local tickets when opening an existing database', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-local-migration-'))
    const databasePath = path.join(root, 'auth.sqlite')
    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
        CREATE TABLE minecraft_tickets (
            ticket_hash TEXT PRIMARY KEY,
            account_uuid TEXT NOT NULL,
            username TEXT NOT NULL,
            account_type TEXT NOT NULL,
            session_id TEXT,
            server_id TEXT NOT NULL,
            audience TEXT NOT NULL,
            issued_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            consumed_at INTEGER
        ) STRICT;
    `)
    legacy.prepare(`
        INSERT INTO minecraft_tickets VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)
    `).run('legacy-hash', 'legacy-uuid', 'LegacyPlayer', 'microsoft', 'youer-main', 'minecraft-sso', 1, 2)
    legacy.close()

    const repository = new AuthRepository(databasePath)
    t.after(() => {
        repository.close()
        for(const file of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) {
            fs.rmSync(file, { force: true })
        }
        fs.rmdirSync(root)
    })
    assert.equal(repository.database.prepare('SELECT COUNT(*) AS count FROM minecraft_tickets').get().count, 0)
})

test('returns the same generic login error for invalid credentials', async t => {
    const fixture = createFixture()
    t.after(() => fixture.repository.close())
    const result = await fixture.service.handle(request('/api/auth/login', {
        password: 'wrong-password',
        username: 'UnknownUser'
    }))

    assert.equal(result.status, 401)
    assert.deepEqual(result.body, { error: 'AUTHENTICATION_FAILED' })
})

test('rotates refresh tokens and rejects replay of the previous token', async t => {
    const fixture = createFixture()
    t.after(() => fixture.repository.close())
    const login = await fixture.service.handle(request('/api/auth/login', {
        password: 'correct-password',
        username: 'LocalPlayer'
    }))
    const firstRefreshToken = login.body.tokens.refreshToken
    const refreshed = await fixture.service.handle(request('/api/auth/refresh', {
        refreshToken: firstRefreshToken
    }))

    assert.equal(refreshed.status, 200)
    assert.notEqual(refreshed.body.tokens.refreshToken, firstRefreshToken)
    const replay = await fixture.service.handle(request('/api/auth/refresh', {
        refreshToken: firstRefreshToken
    }))
    assert.equal(replay.status, 401)
})

test('logout revokes refresh and access tokens immediately', async t => {
    const fixture = createFixture()
    t.after(() => fixture.repository.close())
    const login = await fixture.service.handle(request('/api/auth/login', {
        password: 'correct-password',
        username: 'LocalPlayer'
    }))
    const accessToken = login.body.tokens.accessToken
    const refreshToken = login.body.tokens.refreshToken
    const valid = await fixture.service.handle({
        body: {},
        headers: { authorization: `Bearer ${accessToken}` },
        ip: '127.0.0.1',
        method: 'POST',
        path: '/api/auth/validate'
    })
    assert.equal(valid.status, 200)

    const logout = await fixture.service.handle(request('/api/auth/logout', { refreshToken }))
    assert.equal(logout.status, 204)
    const invalidAccess = await fixture.service.handle({
        body: {},
        headers: { authorization: `Bearer ${accessToken}` },
        ip: '127.0.0.1',
        method: 'POST',
        path: '/api/auth/validate'
    })
    assert.equal(invalidAccess.status, 401)
    const invalidRefresh = await fixture.service.handle(request('/api/auth/refresh', { refreshToken }))
    assert.equal(invalidRefresh.status, 401)
})

test('rate limits repeated attempts by both IP and normalized username', async t => {
    let now = 1_800_000_000_000
    const fixture = createFixture()
    t.after(() => fixture.repository.close())
    fixture.service.loginLimiter = new RateLimiter({
        blockMs: 60_000,
        limit: 1,
        now: () => now,
        windowMs: 60_000
    })
    const body = { password: 'wrong-password', username: 'LocalPlayer' }
    assert.equal((await fixture.service.handle(request('/api/auth/login', body))).status, 401)
    assert.equal((await fixture.service.handle(request('/api/auth/login', body))).status, 429)
    now += 120_000
    assert.equal((await fixture.service.handle(request('/api/auth/login', body))).status, 401)
})

test('rejects expired and tampered access tokens', async t => {
    const fixture = createFixture()
    t.after(() => fixture.repository.close())
    const account = fixture.repository.createOrGetAccount('LocalPlayer')
    const session = fixture.repository.createSession(account.uuid, 600_000)
    const access = fixture.tokenService.issueAccessToken(account, session.sessionId)

    assert.throws(() => fixture.tokenService.verifyAccessToken(`${access.token}tampered`), /INVALID_TOKEN/)
    fixture.advance(61_000)
    assert.throws(() => fixture.tokenService.verifyAccessToken(access.token), /INVALID_TOKEN/)
})

test('issues an opaque local Minecraft ticket and consumes it exactly once for the bound player', async t => {
    const fixture = createFixture()
    t.after(() => fixture.repository.close())
    const login = await fixture.service.handle(request('/api/auth/login', {
        password: 'correct-password',
        username: 'LocalPlayer'
    }))
    const issued = await fixture.service.handle({
        body: {},
        headers: { authorization: `Bearer ${login.body.tokens.accessToken}` },
        ip: '127.0.0.1',
        method: 'POST',
        path: '/api/auth/minecraft-ticket/local'
    })
    assert.equal(issued.status, 200)
    assert.equal(issued.body.expiresAt, 1_800_000_060_000)
    assert.equal(fixture.repository.database.prepare(
        'SELECT ticket_hash FROM minecraft_tickets'
    ).get().ticket_hash.includes(issued.body.ticket), false)

    const body = {
        serverId: 'youer-main',
        ticket: issued.body.ticket,
        username: 'LocalPlayer',
        uuid: offlinePlayerUuid('LocalPlayer')
    }
    const consumed = await fixture.service.handle(signedRequest(
        '/internal/sso/consume', body, fixture.bridgeSecret
    ))
    assert.equal(consumed.status, 200)
    assert.equal(consumed.body.account.type, 'local')
    const replay = await fixture.service.handle(signedRequest(
        '/internal/sso/consume', body, fixture.bridgeSecret
    ))
    assert.equal(replay.status, 401)
})

test('does not burn a ticket on identity mismatch and rejects it after expiry or logout', async t => {
    const fixture = createFixture()
    t.after(() => fixture.repository.close())
    const login = await fixture.service.handle(request('/api/auth/login', {
        password: 'correct-password',
        username: 'LocalPlayer'
    }))
    const issue = async () => (await fixture.service.handle({
        body: {},
        headers: { authorization: `Bearer ${login.body.tokens.accessToken}` },
        ip: '127.0.0.1',
        method: 'POST',
        path: '/api/auth/minecraft-ticket/local'
    })).body.ticket
    const firstTicket = await issue()
    const mismatch = {
        serverId: 'youer-main',
        ticket: firstTicket,
        username: 'OtherPlayer',
        uuid: offlinePlayerUuid('OtherPlayer')
    }
    assert.equal((await fixture.service.handle(signedRequest(
        '/internal/sso/consume', mismatch, fixture.bridgeSecret
    ))).status, 401)
    const correct = { ...mismatch, username: 'LocalPlayer', uuid: offlinePlayerUuid('LocalPlayer') }
    assert.equal((await fixture.service.handle(signedRequest(
        '/internal/sso/consume', correct, fixture.bridgeSecret
    ))).status, 200)

    const expiredTicket = await issue()
    fixture.advance(61_000)
    assert.equal((await fixture.service.handle(signedRequest(
        '/internal/sso/consume', { ...correct, ticket: expiredTicket }, fixture.bridgeSecret,
        1_800_000_061_000
    ))).status, 401)

    const refreshed = await fixture.service.handle(request('/api/auth/refresh', {
        refreshToken: login.body.tokens.refreshToken
    }))
    const liveTicket = (await fixture.service.handle({
        body: {},
        headers: { authorization: `Bearer ${refreshed.body.tokens.accessToken}` },
        ip: '127.0.0.1',
        method: 'POST',
        path: '/api/auth/minecraft-ticket/local'
    })).body.ticket
    await fixture.service.handle(request('/api/auth/logout', {
        refreshToken: refreshed.body.tokens.refreshToken
    }))
    assert.equal((await fixture.service.handle(signedRequest(
        '/internal/sso/consume', { ...correct, ticket: liveTicket }, fixture.bridgeSecret,
        1_800_000_061_000
    ))).status, 401)
})

test('rejects every removed Microsoft authentication endpoint', async t => {
    const fixture = createFixture()
    t.after(() => fixture.repository.close())
    assert.equal((await fixture.service.handle(request('/api/auth/minecraft-ticket', {
        accountType: 'microsoft'
    }))).status, 400)
    assert.equal((await fixture.service.handle(request('/api/auth/minecraft-ticket/microsoft', {}))).status, 404)
    assert.equal((await fixture.service.handle(request('/api/auth/microsoft/provision', {}))).status, 404)
})

test('rate limits repeated ticket issuance and supports the unified public endpoint', async t => {
    const fixture = createFixture()
    t.after(() => fixture.repository.close())
    fixture.service.ticketLimiter = new RateLimiter({
        blockMs: 60_000,
        limit: 1,
        windowMs: 60_000
    })
    const login = await fixture.service.handle(request('/api/auth/login', {
        password: 'correct-password',
        username: 'LocalPlayer'
    }))
    const ticketRequest = {
        body: { accountType: 'local' },
        headers: { authorization: `Bearer ${login.body.tokens.accessToken}` },
        ip: '127.0.0.1',
        method: 'POST',
        path: '/api/auth/minecraft-ticket'
    }
    assert.equal((await fixture.service.handle(ticketRequest)).status, 200)
    assert.equal((await fixture.service.handle(ticketRequest)).status, 429)
})
