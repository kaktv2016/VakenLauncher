const assert = require('node:assert/strict')
const test = require('node:test')

const calls = []
let currentAccount
let localAuthResponse

const configManager = {
    addLocalAuthAccount: (...args) => {
        calls.push(['addLocal', ...args])
        return { ...args[0], type: 'local', accessToken: args[1].accessToken }
    },
    getAuthAccount: () => currentAccount,
    getSelectedAccount: () => currentAccount,
    removeAuthAccount: (...args) => calls.push(['remove', ...args]),
    save: () => calls.push(['save']),
    updateLocalAuthAccount: (...args) => calls.push(['updateLocal', ...args])
}

const localAuth = {
    capabilities: async () => ({ ok: true, data: { emailEnabled: true, emailRequired: false } }),
    login: async (...args) => {
        calls.push(['localLogin', ...args])
        return localAuthResponse
    },
    logout: async (...args) => {
        calls.push(['localLogout', ...args])
        return { ok: true, status: 204 }
    },
    refresh: async (...args) => {
        calls.push(['localRefresh', ...args])
        return localAuthResponse
    },
    register: async (...args) => {
        calls.push(['localRegister', ...args])
        return localAuthResponse
    }
}

function installMock(request, exports) {
    const filename = require.resolve(request)
    require.cache[filename] = { id: filename, filename, loaded: true, exports }
}

installMock('../app/assets/js/configmanager', configManager)
installMock('../app/assets/js/localauth', localAuth)
installMock('../app/assets/js/langloader', { queryJS: key => key })

const AuthManager = require('../app/assets/js/authmanager')

function successfulResponse() {
    return {
        ok: true,
        data: {
            account: { displayName: 'LocalPlayer', type: 'local', username: 'LocalPlayer', uuid: 'local-uuid' },
            tokens: {
                accessExpiresAt: Date.now() + 60_000,
                accessToken: 'local-access',
                refreshExpiresAt: Date.now() + 600_000,
                refreshToken: 'local-refresh',
                sessionId: 'session-id'
            }
        }
    }
}

test('logs in a local account without persisting its password', async () => {
    calls.length = 0
    localAuthResponse = successfulResponse()
    const account = await AuthManager.addLocalAccount('LocalPlayer', 'temporary-password')

    assert.equal(account.type, 'local')
    assert.deepEqual(calls.find(call => call[0] === 'localLogin'), [
        'localLogin',
        'LocalPlayer',
        'temporary-password'
    ])
    assert.equal(JSON.stringify(calls.find(call => call[0] === 'addLocal')).includes('temporary-password'), false)
    assert.equal(calls.some(call => call[0] === 'save'), true)
})

test('registers a local account and passes confirmation only to the backend client', async () => {
    calls.length = 0
    localAuthResponse = successfulResponse()
    await AuthManager.registerLocalAccount('LocalPlayer', 'temporary-password', 'temporary-password', 'p@example.com')

    assert.deepEqual(calls.find(call => call[0] === 'localRegister'), [
        'localRegister',
        'LocalPlayer',
        'temporary-password',
        'temporary-password',
        'p@example.com'
    ])
    assert.equal(JSON.stringify(calls.find(call => call[0] === 'addLocal')).includes('temporary-password'), false)
})

test('refreshes expired local credentials with rotating refresh tokens', async () => {
    calls.length = 0
    currentAccount = {
        type: 'local',
        uuid: 'local-uuid',
        expiresAt: 0,
        tokens: { refreshExpiresAt: Number.MAX_SAFE_INTEGER, refreshToken: 'old-local-refresh' }
    }
    localAuthResponse = successfulResponse()

    assert.equal(await AuthManager.validateSelected(), true)
    assert.deepEqual(calls.find(call => call[0] === 'localRefresh'), ['localRefresh', 'old-local-refresh'])
    assert.equal(calls.some(call => call[0] === 'updateLocal'), true)
    assert.equal(calls.some(call => call[0] === 'save'), true)
})

test('rejects every selected account type other than local', async () => {
    currentAccount = { type: 'unsupported' }
    assert.equal(await AuthManager.validateSelected(), false)
    currentAccount = null
    assert.equal(await AuthManager.validateSelected(), false)
})

test('revokes a local session before deleting its launcher account', async () => {
    calls.length = 0
    currentAccount = {
        type: 'local',
        uuid: 'local-uuid',
        tokens: { refreshToken: 'local-refresh' }
    }

    await AuthManager.removeLocalAccount('local-uuid')
    assert.deepEqual(calls.map(call => call[0]), ['localLogout', 'remove', 'save'])
})
