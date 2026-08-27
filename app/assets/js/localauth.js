const got = require('got')
const { AUTH_API_BASE_URL } = require('./ipcconstants')

class LocalAuthError extends Error {
    constructor(code) {
        super(code)
        this.name = 'LocalAuthError'
        this.code = code
    }
}

class LocalAuthClient {
    constructor(baseUrl = AUTH_API_BASE_URL, transport = got) {
        let parsed
        try {
            parsed = new URL(baseUrl)
        } catch(_error) {
            throw new LocalAuthError('NOT_CONFIGURED')
        }
        if(parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
            throw new LocalAuthError('NOT_CONFIGURED')
        }
        this.baseUrl = parsed
        this.transport = transport
    }

    endpoint(path) {
        return new URL(path, this.baseUrl).toString()
    }

    async request(path, body, method = 'POST', headers = {}) {
        try {
            const options = {
                responseType: 'json',
                throwHttpErrors: false,
                timeout: { request: 7500 },
                method,
                headers
            }
            if(method === 'POST') {
                options.json = body
            }
            const response = await this.transport(this.endpoint(path), options)
            const data = response.body || {}
            if(response.statusCode >= 200 && response.statusCode < 300) {
                return { data, ok: true, status: response.statusCode }
            }
            return {
                error: typeof data.error === 'string' ? data.error : 'SERVICE_UNAVAILABLE',
                ok: false,
                status: response.statusCode
            }
        } catch(_error) {
            return { error: 'SERVICE_UNAVAILABLE', ok: false, status: 0 }
        }
    }

    capabilities() {
        return this.request('/api/auth/capabilities', null, 'GET')
    }

    login(username, password) {
        return this.request('/api/auth/login', { password, username })
    }

    register(username, password, passwordConfirm, email) {
        return this.request('/api/auth/register', { email, password, passwordConfirm, username })
    }

    refresh(refreshToken) {
        return this.request('/api/auth/refresh', { refreshToken })
    }

    logout(refreshToken) {
        return this.request('/api/auth/logout', { refreshToken })
    }

    issueMinecraftTicket(accessToken) {
        return this.request(
            '/api/auth/minecraft-ticket',
            { accountType: 'local' },
            'POST',
            { authorization: `Bearer ${accessToken}` }
        )
    }
}

let client

function getClient() {
    if(client == null) {
        client = new LocalAuthClient()
    }
    return client
}

module.exports = {
    LocalAuthClient,
    LocalAuthError,
    capabilities: () => getClient().capabilities(),
    login: (username, password) => getClient().login(username, password),
    logout: refreshToken => getClient().logout(refreshToken),
    issueMinecraftTicket: accessToken => getClient().issueMinecraftTicket(accessToken),
    refresh: refreshToken => getClient().refresh(refreshToken),
    register: (username, password, passwordConfirm, email) => getClient().register(username, password, passwordConfirm, email)
}
