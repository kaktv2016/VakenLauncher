const assert = require('node:assert/strict')
const test = require('node:test')
const { clientIp, tlsOptions } = require('../services/auth-backend/src/server')
const { ServiceRequestAuthenticator } = require('../services/auth-backend/src/service-request-authenticator')

function request(remoteAddress, forwarded) {
    return {
        headers: forwarded == null ? {} : { 'x-forwarded-for': forwarded },
        socket: { remoteAddress }
    }
}

test('trusts a forwarded client IP only from a loopback reverse proxy when enabled', () => {
    assert.equal(clientIp(request('127.0.0.1', '203.0.113.7'), true), '203.0.113.7')
    assert.equal(clientIp(request('198.51.100.2', '203.0.113.7'), true), '198.51.100.2')
    assert.equal(clientIp(request('127.0.0.1', 'not-an-ip'), true), '127.0.0.1')
    assert.equal(clientIp(request('127.0.0.1', '203.0.113.7'), false), '127.0.0.1')
})

test('supports PKCS12 TLS without requiring separate PEM key files', () => {
    const options = tlsOptions({
        HELIOS_TLS_PFX: __filename,
        HELIOS_TLS_PFX_PASSWORD: 'test-passphrase'
    })
    assert.equal(options.minVersion, 'TLSv1.2')
    assert.equal(options.passphrase, 'test-passphrase')
    assert.ok(Buffer.isBuffer(options.pfx))
    assert.equal(options.cert, undefined)
    assert.throws(() => tlsOptions({ HELIOS_TLS_PFX: __filename }), /HELIOS_TLS_PFX_PASSWORD is required/)
})

test('accepts the shared Node-Java HMAC protocol vector exactly once', () => {
    const authenticator = new ServiceRequestAuthenticator({
        now: () => 1_800_000_000_000,
        secret: 'test-shared-secret-containing-at-least-32-bytes'
    })
    const request = {
        body: { ticket: 'opaque-ticket', serverId: 'youer-main' },
        headers: {
            'x-helios-nonce': 'crosslanguagevectornonce12345',
            'x-helios-signature': 'rZGRqw1txBNc6Er3vc9M4zYVsZDu9JqwxgiFx6RUcTo',
            'x-helios-timestamp': '1800000000000'
        },
        method: 'POST',
        path: '/internal/sso/consume',
        rawBody: Buffer.from('{"ticket":"opaque-ticket","serverId":"youer-main"}')
    }
    assert.equal(authenticator.verify(request), true)
    assert.equal(authenticator.verify(request), false)
})
