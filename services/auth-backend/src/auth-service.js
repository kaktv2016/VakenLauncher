const { RateLimiter } = require('./rate-limiter')
const { ValidationError, validateEmail, validatePassword, validateUsername } = require('./validation')

const JSON_HEADERS = {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff'
}

function response(status, body) {
    return { body, headers: JSON_HEADERS, status }
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

class AuthService {
    constructor({
        bridge,
        emailEnabled = false,
        emailRequired = false,
        recoveryUrl = null,
        repository,
        serverId,
        serviceAuthenticator,
        tokenService,
        ticketTtlMs = 60_000,
        ticketLimiter = new RateLimiter({ limit: 10, windowMs: 60_000, blockMs: 60_000 }),
        refreshTtlMs = 30 * 24 * 60 * 60 * 1000,
        loginLimiter = new RateLimiter({ limit: 5, windowMs: 60_000, blockMs: 5 * 60_000 }),
        registerLimiter = new RateLimiter({ limit: 3, windowMs: 60 * 60_000, blockMs: 60 * 60_000 }),
        now = Date.now
    }) {
        this.bridge = bridge
        this.emailEnabled = emailEnabled
        this.emailRequired = emailRequired
        this.recoveryUrl = recoveryUrl
        this.repository = repository
        this.serverId = serverId
        this.serviceAuthenticator = serviceAuthenticator
        this.tokenService = tokenService
        this.ticketTtlMs = ticketTtlMs
        this.ticketLimiter = ticketLimiter
        this.refreshTtlMs = refreshTtlMs
        this.loginLimiter = loginLimiter
        this.registerLimiter = registerLimiter
        this.now = now
    }

    tokenResponse(account, session) {
        const access = this.tokenService.issueAccessToken(account, session.sessionId)
        return response(200, {
            account: {
                displayName: account.username,
                type: 'local',
                username: account.username,
                uuid: account.uuid
            },
            tokens: {
                accessToken: access.token,
                accessExpiresAt: access.expiresAt,
                refreshToken: session.refreshToken,
                refreshExpiresAt: session.refreshExpiresAt,
                sessionId: session.sessionId
            }
        })
    }

    rateLimit(limiter, ip, username) {
        const normalized = typeof username === 'string' ? username.toLowerCase() : 'invalid'
        return limiter.consume(`ip:${ip}`) && limiter.consume(`user:${normalized}`)
    }

    async login(request) {
        const started = this.now()
        if(!this.rateLimit(this.loginLimiter, request.ip, request.body?.username)) {
            return response(429, { error: 'RATE_LIMITED' })
        }
        try {
            const username = validateUsername(request.body?.username)
            const password = validatePassword(request.body?.password)
            const bridgeResult = await this.bridge.login(username, password)
            if(!bridgeResult.ok) {
                throw new AuthenticationError()
            }
            const canonicalUsername = validateUsername(bridgeResult.username || username)
            const account = this.repository.createOrGetAccount(canonicalUsername)
            const session = this.repository.createSession(account.uuid, this.refreshTtlMs)
            return this.tokenResponse(account, session)
        } catch(_error) {
            const remaining = 350 - (this.now() - started)
            if(remaining > 0) {
                await wait(remaining)
            }
            return response(401, { error: 'AUTHENTICATION_FAILED' })
        }
    }

    async register(request) {
        if(!this.rateLimit(this.registerLimiter, request.ip, request.body?.username)) {
            return response(429, { error: 'RATE_LIMITED' })
        }
        try {
            const username = validateUsername(request.body?.username)
            const password = validatePassword(request.body?.password)
            if(password !== request.body?.passwordConfirm) {
                throw new ValidationError('PASSWORD_MISMATCH')
            }
            const email = this.emailEnabled
                ? validateEmail(request.body?.email, this.emailRequired)
                : null
            if(this.repository.getAccountByUsername(username) != null) {
                return response(409, { error: 'USERNAME_UNAVAILABLE' })
            }
            const bridgeResult = await this.bridge.register(username, password, email)
            if(!bridgeResult.ok) {
                return response(409, { error: 'USERNAME_UNAVAILABLE' })
            }
            const canonicalUsername = validateUsername(bridgeResult.username || username)
            const account = this.repository.createOrGetAccount(canonicalUsername, email)
            const session = this.repository.createSession(account.uuid, this.refreshTtlMs)
            return this.tokenResponse(account, session)
        } catch(error) {
            if(error instanceof ValidationError) {
                return response(400, { error: error.code })
            }
            return response(503, { error: 'SERVICE_UNAVAILABLE' })
        }
    }

    refresh(request) {
        const refreshToken = request.body?.refreshToken
        if(typeof refreshToken !== 'string' || refreshToken.length > 256) {
            return response(401, { error: 'AUTHENTICATION_FAILED' })
        }
        const session = this.repository.rotateSession(refreshToken, this.refreshTtlMs)
        if(session == null) {
            return response(401, { error: 'AUTHENTICATION_FAILED' })
        }
        const account = this.repository.getAccountByUuid(session.accountUuid)
        return account == null
            ? response(401, { error: 'AUTHENTICATION_FAILED' })
            : this.tokenResponse(account, session)
    }

    logout(request) {
        const refreshToken = request.body?.refreshToken
        if(typeof refreshToken === 'string' && refreshToken.length <= 256) {
            this.repository.revokeSession(refreshToken)
        }
        return response(204, null)
    }

    validateAccess(request) {
        const authorization = request.headers?.authorization
        if(typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
            return response(401, { error: 'AUTHENTICATION_FAILED' })
        }
        try {
            const claims = this.tokenService.verifyAccessToken(authorization.slice(7))
            if(!this.repository.isSessionActive(claims.sid, claims.sub)) {
                throw new Error('INVALID_TOKEN')
            }
            return response(200, { accountId: claims.sub, serverId: claims.aud, username: claims.username })
        } catch(_error) {
            return response(401, { error: 'AUTHENTICATION_FAILED' })
        }
    }

    bearerToken(request) {
        const authorization = request.headers?.authorization
        return typeof authorization === 'string' && authorization.startsWith('Bearer ')
            ? authorization.slice(7)
            : null
    }

    issueTicket(identity) {
        const issued = this.repository.createMinecraftTicket(identity, this.serverId, this.ticketTtlMs)
        return response(200, {
            expiresAt: issued.expiresAt,
            serverId: this.serverId,
            ticket: issued.ticket
        })
    }

    issueLocalMinecraftTicket(request) {
        if(!this.ticketLimiter.consume(`ip:${request.ip}`)) {
            return response(429, { error: 'RATE_LIMITED' })
        }
        try {
            const claims = this.tokenService.verifyAccessToken(this.bearerToken(request))
            if(!this.repository.isSessionActive(claims.sid, claims.sub)) {
                throw new Error('INVALID_TOKEN')
            }
            const account = this.repository.getAccountByUuid(claims.sub)
            if(account == null || account.username !== claims.username) {
                throw new Error('INVALID_TOKEN')
            }
            if(!this.ticketLimiter.consume(`account:${account.uuid}`)) {
                return response(429, { error: 'RATE_LIMITED' })
            }
            return this.issueTicket({
                sessionId: claims.sid,
                type: 'local',
                username: account.username,
                uuid: account.uuid
            })
        } catch(_error) {
            return response(401, { error: 'AUTHENTICATION_FAILED' })
        }
    }

    consumeMinecraftTicket(request) {
        if(this.serviceAuthenticator == null || !this.serviceAuthenticator.verify(request)) {
            return response(401, { error: 'AUTHENTICATION_FAILED' })
        }
        const { serverId, ticket, username, uuid } = request.body || {}
        if(typeof ticket !== 'string'
            || ticket.length < 32
            || ticket.length > 128
            || serverId !== this.serverId
            || typeof username !== 'string'
            || !/^[A-Za-z0-9_]{3,16}$/.test(username)
            || typeof uuid !== 'string'
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
            return response(401, { error: 'AUTHENTICATION_FAILED' })
        }
        const consumed = this.repository.consumeMinecraftTicket(ticket, {
            username,
            uuid: uuid.toLowerCase()
        }, serverId)
        return consumed == null
            ? response(401, { error: 'AUTHENTICATION_FAILED' })
            : response(200, { account: consumed, ok: true })
    }

    async handle(request) {
        if(request.method === 'GET' && request.path === '/api/auth/capabilities') {
            return response(200, {
                emailEnabled: this.emailEnabled,
                emailRequired: this.emailRequired,
                recoveryUrl: this.recoveryUrl
            })
        }
        if(request.method !== 'POST') {
            return response(404, { error: 'NOT_FOUND' })
        }
        switch(request.path) {
            case '/api/auth/login':
                return await this.login(request)
            case '/api/auth/register':
                return await this.register(request)
            case '/api/auth/refresh':
                return this.refresh(request)
            case '/api/auth/logout':
                return this.logout(request)
            case '/api/auth/validate':
                return this.validateAccess(request)
            case '/api/auth/minecraft-ticket':
                if(request.body?.accountType === 'local') {
                    return this.issueLocalMinecraftTicket(request)
                }
                return response(400, { error: 'INVALID_REQUEST' })
            case '/api/auth/minecraft-ticket/local':
                return this.issueLocalMinecraftTicket(request)
            case '/internal/sso/consume':
                return this.consumeMinecraftTicket(request)
            default:
                return response(404, { error: 'NOT_FOUND' })
        }
    }
}

class AuthenticationError extends Error {}

module.exports = { AuthService, JSON_HEADERS }
