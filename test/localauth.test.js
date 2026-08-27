const assert = require('node:assert/strict')
const test = require('node:test')
const { LocalAuthClient, LocalAuthError } = require('../app/assets/js/localauth')

test('local authentication client requires an HTTPS endpoint without embedded credentials', () => {
    for(const url of ['', 'http://auth.example.com', 'https://user:password@auth.example.com']) {
        assert.throws(
            () => new LocalAuthClient(url),
            error => error instanceof LocalAuthError && error.code === 'NOT_CONFIGURED'
        )
    }
    assert.doesNotThrow(() => new LocalAuthClient('https://auth.example.com'))
})

test('local authentication client sends credentials only in an HTTPS JSON body', async () => {
    const calls = []
    const transport = async (url, options) => {
        calls.push({ options, url })
        return {
            body: { account: { type: 'local' }, tokens: {} },
            statusCode: 200
        }
    }
    const client = new LocalAuthClient('https://auth.example.com', transport)
    const result = await client.login('LocalPlayer', 'temporary-password')

    assert.equal(result.ok, true)
    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/login')
    assert.deepEqual(calls[0].options.json, {
        password: 'temporary-password',
        username: 'LocalPlayer'
    })
    assert.equal(calls[0].url.includes('temporary-password'), false)
})

test('local authentication client maps network errors to a generic service error', async () => {
    const client = new LocalAuthClient('https://auth.example.com', async () => {
        throw new Error('socket details must not escape')
    })
    assert.deepEqual(await client.login('LocalPlayer', 'temporary-password'), {
        error: 'SERVICE_UNAVAILABLE',
        ok: false,
        status: 0
    })
})

test('requests a Minecraft ticket with the access token only in an authorization header', async () => {
    const calls = []
    const client = new LocalAuthClient('https://auth.example.com', async (url, options) => {
        calls.push({ options, url })
        return {
            body: { expiresAt: Date.now() + 60_000, serverId: 'youer-main', ticket: 'opaque-ticket' },
            statusCode: 200
        }
    })
    const result = await client.issueMinecraftTicket('private-access-token')
    assert.equal(result.ok, true)
    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/minecraft-ticket')
    assert.equal(calls[0].options.headers.authorization, 'Bearer private-access-token')
    assert.deepEqual(calls[0].options.json, { accountType: 'local' })
    assert.equal(calls[0].url.includes('private-access-token'), false)
})
