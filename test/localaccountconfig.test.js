const assert = require('node:assert/strict')
const test = require('node:test')

const { retainLocalAuthentication } = require('../app/assets/js/localaccountconfig')

test('keeps only local accounts and removes obsolete client credentials', () => {
    const config = retainLocalAuthentication({
        authenticationDatabase: {
            local: { type: 'local', uuid: 'local' },
            microsoft: { type: 'microsoft', uuid: 'microsoft', accessToken: 'obsolete' },
            mojang: { type: 'mojang', uuid: 'mojang', accessToken: 'obsolete' }
        },
        clientToken: 'obsolete-client-token',
        selectedAccount: 'microsoft'
    })

    assert.deepEqual(Object.keys(config.authenticationDatabase), ['local'])
    assert.equal(config.selectedAccount, 'local')
    assert.equal(Object.hasOwn(config, 'clientToken'), false)
    assert.equal(JSON.stringify(config).includes('obsolete'), false)
})

test('clears the selected account when no local account exists', () => {
    const config = retainLocalAuthentication({
        authenticationDatabase: { unsupported: { type: 'unsupported' } },
        selectedAccount: 'unsupported'
    })
    assert.deepEqual(config.authenticationDatabase, {})
    assert.equal(config.selectedAccount, null)
})
