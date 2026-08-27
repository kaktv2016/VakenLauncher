const ENCRYPTED_PREFIX = 'electron-safe-storage:v1:'

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function transformSecret(value, transform, decrypting, state) {
    if(typeof value !== 'string' || value.length === 0) {
        return value
    }
    if(decrypting) {
        if(!value.startsWith(ENCRYPTED_PREFIX)) {
            state.migrated = true
            return value
        }
        return transform(value.slice(ENCRYPTED_PREFIX.length))
    }
    if(value.startsWith(ENCRYPTED_PREFIX)) {
        return value
    }
    return `${ENCRYPTED_PREFIX}${transform(value)}`
}

function transformAccount(account, transform, decrypting, state) {
    if(account == null || typeof account !== 'object') {
        return
    }
    if(Object.prototype.hasOwnProperty.call(account, 'accessToken')) {
        account.accessToken = transformSecret(account.accessToken, transform, decrypting, state)
    }
    if(account.tokens != null && typeof account.tokens === 'object') {
        for(const key of Object.keys(account.tokens)) {
            account.tokens[key] = transformSecret(account.tokens[key], transform, decrypting, state)
        }
    }
}

function transformConfig(source, transform, decrypting) {
    const result = clone(source)
    const state = { migrated: false }
    if(result.authenticationDatabase != null && typeof result.authenticationDatabase === 'object') {
        for(const account of Object.values(result.authenticationDatabase)) {
            transformAccount(account, transform, decrypting, state)
        }
    }
    return { config: result, migrated: state.migrated }
}

function protectConfig(source, encrypt) {
    return transformConfig(source, encrypt, false).config
}

function unprotectConfig(source, decrypt) {
    return transformConfig(source, decrypt, true)
}

function protectSecret(value) {
    const { ipcRenderer } = require('electron')
    return callSecretOperation(ipcRenderer, 'SECRET_PROTECT', value)
}

function unprotectSecret(value) {
    const { ipcRenderer } = require('electron')
    return callSecretOperation(ipcRenderer, 'SECRET_UNPROTECT', value)
}

function callSecretOperation(ipcRenderer, operation, value) {
    const response = ipcRenderer.sendSync(operation, value)
    if(response == null || response.ok !== true || typeof response.value !== 'string') {
        throw new Error(response?.error || 'Secure token storage is unavailable.')
    }
    return response.value
}

module.exports = {
    ENCRYPTED_PREFIX,
    protectConfig,
    protectSecret,
    unprotectConfig,
    unprotectSecret
}
