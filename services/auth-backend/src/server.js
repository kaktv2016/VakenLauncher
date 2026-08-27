const fs = require('fs')
const https = require('https')
const net = require('net')
const path = require('path')
const { AuthRepository } = require('./repository')
const { AuthService } = require('./auth-service')
const { BridgeClient } = require('./bridge-client')
const { ServiceRequestAuthenticator } = require('./service-request-authenticator')
const { TokenService } = require('./token-service')

const MAX_BODY_BYTES = 16 * 1024

function requiredEnvironment(name, environment = process.env) {
    const value = environment[name]
    if(typeof value !== 'string' || value.length === 0) {
        throw new Error(`${name} is required.`)
    }
    return value
}

function tlsOptions(environment = process.env) {
    const pfxPath = environment.HELIOS_TLS_PFX
    if(typeof pfxPath === 'string' && pfxPath.length > 0) {
        return {
            minVersion: 'TLSv1.2',
            passphrase: requiredEnvironment('HELIOS_TLS_PFX_PASSWORD', environment),
            pfx: fs.readFileSync(path.resolve(pfxPath))
        }
    }
    return {
        cert: fs.readFileSync(path.resolve(requiredEnvironment('HELIOS_TLS_CERT', environment))),
        key: fs.readFileSync(path.resolve(requiredEnvironment('HELIOS_TLS_KEY', environment))),
        minVersion: 'TLSv1.2'
    }
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        let size = 0
        const chunks = []
        request.on('data', chunk => {
            size += chunk.length
            if(size > MAX_BODY_BYTES) {
                reject(new Error('REQUEST_TOO_LARGE'))
                request.destroy()
                return
            }
            chunks.push(chunk)
        })
        request.on('end', () => {
            try {
                const rawBody = Buffer.concat(chunks)
                resolve({
                    body: rawBody.length === 0 ? {} : JSON.parse(rawBody.toString('utf8')),
                    rawBody
                })
            } catch(_error) {
                reject(new Error('INVALID_JSON'))
            }
        })
        request.on('error', reject)
    })
}

function clientIp(request, trustProxy) {
    const remoteAddress = request.socket.remoteAddress || 'unknown'
    const loopback = remoteAddress === '127.0.0.1'
        || remoteAddress === '::1'
        || remoteAddress === '::ffff:127.0.0.1'
    if(!trustProxy || !loopback) {
        return remoteAddress
    }
    const forwarded = request.headers['x-forwarded-for']
    const candidate = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : ''
    return net.isIP(candidate) === 0 ? remoteAddress : candidate
}

function createRequestListener(service, { trustProxy = false } = {}) {
    return async (request, response) => {
        let result
        try {
            const url = new URL(request.url, 'https://localhost')
            const parsed = request.method === 'POST'
                ? await readJsonBody(request)
                : { body: {}, rawBody: Buffer.alloc(0) }
            result = await service.handle({
                body: parsed.body,
                headers: request.headers,
                ip: clientIp(request, trustProxy),
                method: request.method,
                path: url.pathname,
                rawBody: parsed.rawBody
            })
        } catch(error) {
            result = {
                body: { error: error.message === 'REQUEST_TOO_LARGE' ? 'REQUEST_TOO_LARGE' : 'INVALID_REQUEST' },
                headers: { 'content-type': 'application/json; charset=utf-8' },
                status: error.message === 'REQUEST_TOO_LARGE' ? 413 : 400
            }
        }

        response.writeHead(result.status, result.headers)
        response.end(result.body == null ? '' : JSON.stringify(result.body))
    }
}

function start() {
    const databasePath = path.resolve(process.env.HELIOS_AUTH_DATABASE || './data/helios-auth.sqlite')
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    const serverId = requiredEnvironment('HELIOS_SERVER_ID')
    const bridgeSecret = requiredEnvironment('HELIOS_BRIDGE_SECRET')
    const repository = new AuthRepository(databasePath)
    const tokenService = new TokenService({
        audience: serverId,
        secret: requiredEnvironment('HELIOS_TOKEN_SECRET')
    })
    const bridge = new BridgeClient({
        baseUrl: requiredEnvironment('HELIOS_BRIDGE_URL'),
        secret: bridgeSecret
    })
    const recoveryUrl = process.env.HELIOS_RECOVERY_URL || null
    if(recoveryUrl != null && new URL(recoveryUrl).protocol !== 'https:') {
        throw new Error('HELIOS_RECOVERY_URL must use HTTPS.')
    }
    const service = new AuthService({
        bridge,
        emailEnabled: process.env.HELIOS_EMAIL_ENABLED === 'true',
        emailRequired: process.env.HELIOS_EMAIL_REQUIRED === 'true',
        recoveryUrl,
        repository,
        serverId,
        serviceAuthenticator: new ServiceRequestAuthenticator({ secret: bridgeSecret }),
        tokenService
    })
    const server = https.createServer(
        tlsOptions(),
        createRequestListener(service, { trustProxy: process.env.HELIOS_TRUST_PROXY === 'true' })
    )
    const port = Number.parseInt(process.env.PORT || '8443')
    const host = process.env.HOST || '127.0.0.1'
    server.listen(port, host, () => {
        console.log(`Helios authentication backend listening securely on ${host}:${port}.`)
    })
}

if(require.main === module) {
    try {
        start()
    } catch(error) {
        console.error(error.message)
        process.exitCode = 1
    }
}

module.exports = { MAX_BODY_BYTES, clientIp, createRequestListener, readJsonBody, start, tlsOptions }
