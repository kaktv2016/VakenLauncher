const assert = require('node:assert/strict')
const test = require('node:test')

const {
    ENCRYPTED_PREFIX,
    protectConfig,
    unprotectConfig
} = require('../app/assets/js/securetokenstore')

function fixture() {
    return {
        authenticationDatabase: {
            local: {
                accessToken: 'local-access-token',
                username: 'player',
                tokens: {
                    refreshToken: 'local-refresh-token',
                    sessionId: 'local-session-id'
                }
            }
        }
    }
}

const encrypt = value => Buffer.from(value).toString('base64')
const decrypt = value => Buffer.from(value, 'base64').toString()

test('protects every persisted launcher credential without mutating memory state', () => {
    const source = fixture()
    const protectedConfig = protectConfig(source, encrypt)
    const serialized = JSON.stringify(protectedConfig)

    for(const secret of ['local-access-token', 'local-refresh-token', 'local-session-id']) {
        assert.equal(serialized.includes(secret), false)
    }
    assert.ok(protectedConfig.authenticationDatabase.local.accessToken.startsWith(ENCRYPTED_PREFIX))
    assert.equal(protectedConfig.authenticationDatabase.local.username, 'player')
})

test('unprotects encrypted credentials and identifies plaintext migration', () => {
    const source = fixture()
    const protectedConfig = protectConfig(source, encrypt)
    const decrypted = unprotectConfig(protectedConfig, decrypt)
    assert.deepEqual(decrypted.config, source)
    assert.equal(decrypted.migrated, false)

    const legacy = unprotectConfig(source, decrypt)
    assert.deepEqual(legacy.config, source)
    assert.equal(legacy.migrated, true)
})

test('fails closed when a platform-protected credential cannot be decrypted', () => {
    const protectedConfig = protectConfig(fixture(), encrypt)
    assert.throws(
        () => unprotectConfig(protectedConfig, () => {
            throw new Error('wrong user or corrupted DPAPI payload')
        }),
        /wrong user/
    )
})
