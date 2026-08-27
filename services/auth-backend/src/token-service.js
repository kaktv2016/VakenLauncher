const crypto = require('crypto')

function encode(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function decode(value) {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

function constantTimeEqual(left, right) {
    const leftBuffer = Buffer.from(left)
    const rightBuffer = Buffer.from(right)
    return leftBuffer.length === rightBuffer.length
        && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

class TokenService {
    constructor({ secret, issuer = 'helios-auth', audience, accessTtlSeconds = 900, now = Date.now }) {
        if(typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
            throw new Error('HELIOS_TOKEN_SECRET must contain at least 32 bytes.')
        }
        if(typeof audience !== 'string' || audience.length === 0) {
            throw new Error('A non-empty token audience/server ID is required.')
        }
        this.secret = secret
        this.issuer = issuer
        this.audience = audience
        this.accessTtlSeconds = accessTtlSeconds
        this.now = now
    }

    signature(input) {
        return crypto.createHmac('sha256', this.secret).update(input).digest('base64url')
    }

    issueAccessToken(account, sessionId) {
        const issuedAt = Math.floor(this.now() / 1000)
        const expiresAt = issuedAt + this.accessTtlSeconds
        const header = encode({ alg: 'HS256', typ: 'JWT' })
        const payload = encode({
            iss: this.issuer,
            aud: this.audience,
            sub: account.uuid,
            sid: sessionId,
            jti: crypto.randomUUID(),
            type: 'local',
            username: account.username,
            iat: issuedAt,
            exp: expiresAt
        })
        const input = `${header}.${payload}`
        return {
            token: `${input}.${this.signature(input)}`,
            expiresAt: expiresAt * 1000
        }
    }

    verifyAccessToken(token) {
        if(typeof token !== 'string' || token.length > 4096) {
            throw new Error('INVALID_TOKEN')
        }
        const parts = token.split('.')
        if(parts.length !== 3 || !constantTimeEqual(this.signature(`${parts[0]}.${parts[1]}`), parts[2])) {
            throw new Error('INVALID_TOKEN')
        }

        let header
        let claims
        try {
            header = decode(parts[0])
            claims = decode(parts[1])
        } catch {
            throw new Error('INVALID_TOKEN')
        }
        const now = Math.floor(this.now() / 1000)
        if(header.alg !== 'HS256'
            || header.typ !== 'JWT'
            || claims.iss !== this.issuer
            || claims.aud !== this.audience
            || claims.type !== 'local'
            || typeof claims.sub !== 'string'
            || typeof claims.sid !== 'string'
            || typeof claims.exp !== 'number'
            || claims.exp <= now) {
            throw new Error('INVALID_TOKEN')
        }
        return claims
    }
}

module.exports = { TokenService }
