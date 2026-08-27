/**
 * Local/AuthMe authentication boundary for the Launcher.
 *
 * Passwords are sent only to the configured HTTPS backend and are never
 * persisted by the Launcher. Only short-lived local access tokens and rotating
 * refresh tokens are stored.
 */
const ConfigManager = require('./configmanager')
const LocalAuth = require('./localauth')
const Lang = require('./langloader')

function localErrorDisplayable(errorCode) {
    const knownCode = [
        'INVALID_USERNAME',
        'INVALID_PASSWORD',
        'INVALID_EMAIL',
        'PASSWORD_MISMATCH',
        'USERNAME_UNAVAILABLE',
        'RATE_LIMITED',
        'NOT_CONFIGURED',
        'SERVICE_UNAVAILABLE'
    ].includes(errorCode) ? errorCode : 'AUTHENTICATION_FAILED'
    return {
        title: Lang.queryJS('auth.local.error.title'),
        desc: Lang.queryJS(`auth.local.error.${knownCode}`)
    }
}

function isDisplayableLocalError(error) {
    return error != null && typeof error.title === 'string' && typeof error.desc === 'string'
}

function assertLocalAuthSuccess(response) {
    if(!response.ok) {
        throw localErrorDisplayable(response.error)
    }
    if(response.data?.account?.type !== 'local'
        || typeof response.data.account.uuid !== 'string'
        || typeof response.data.tokens?.accessToken !== 'string'
        || typeof response.data.tokens?.refreshToken !== 'string') {
        throw localErrorDisplayable('SERVICE_UNAVAILABLE')
    }
    return response.data
}

exports.getLocalAuthCapabilities = async function() {
    try {
        const response = await LocalAuth.capabilities()
        return response.ok ? response.data : { emailEnabled: false, emailRequired: false, recoveryUrl: null }
    } catch(_error) {
        return { emailEnabled: false, emailRequired: false, recoveryUrl: null }
    }
}

exports.addLocalAccount = async function(username, password) {
    try {
        const result = assertLocalAuthSuccess(await LocalAuth.login(username, password))
        const account = ConfigManager.addLocalAuthAccount(result.account, result.tokens)
        ConfigManager.save()
        return account
    } catch(error) {
        if(isDisplayableLocalError(error)) {
            return Promise.reject(error)
        }
        return Promise.reject(localErrorDisplayable(error.code))
    }
}

exports.registerLocalAccount = async function(username, password, passwordConfirm, email) {
    try {
        const result = assertLocalAuthSuccess(await LocalAuth.register(username, password, passwordConfirm, email))
        const account = ConfigManager.addLocalAuthAccount(result.account, result.tokens)
        ConfigManager.save()
        return account
    } catch(error) {
        if(isDisplayableLocalError(error)) {
            return Promise.reject(error)
        }
        return Promise.reject(localErrorDisplayable(error.code))
    }
}

exports.removeLocalAccount = async function(uuid) {
    const account = ConfigManager.getAuthAccount(uuid)
    if(account?.type !== 'local' || typeof account.tokens?.refreshToken !== 'string') {
        return Promise.reject(localErrorDisplayable('AUTHENTICATION_FAILED'))
    }
    const response = await LocalAuth.logout(account.tokens.refreshToken)
    if(!response.ok) {
        return Promise.reject(localErrorDisplayable(response.error))
    }
    ConfigManager.removeAuthAccount(uuid)
    ConfigManager.save()
}

exports.validateSelected = async function() {
    const current = ConfigManager.getSelectedAccount()
    if(current?.type !== 'local') {
        return false
    }
    const now = Date.now()
    if(now < current.expiresAt - 10_000) {
        return true
    }
    if(now >= current.tokens.refreshExpiresAt) {
        return false
    }
    try {
        const result = assertLocalAuthSuccess(await LocalAuth.refresh(current.tokens.refreshToken))
        ConfigManager.updateLocalAuthAccount(current.uuid, result.tokens)
        ConfigManager.save()
        return true
    } catch(_error) {
        return false
    }
}
