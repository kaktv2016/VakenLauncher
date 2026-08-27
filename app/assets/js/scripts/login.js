/**
 * Local/AuthMe login and registration view.
 */
const validLocalUsername = /^[A-Za-z0-9_]{3,16}$/
const validLocalEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const localControlCharacters = /[\u0000-\u001f\u007f]/

const loginCancelContainer = document.getElementById('loginCancelContainer')
const loginCancelButton = document.getElementById('loginCancelButton')
const loginUsernameError = document.getElementById('loginUsernameError')
const loginUsername = document.getElementById('loginUsername')
const loginPasswordError = document.getElementById('loginPasswordError')
const loginPassword = document.getElementById('loginPassword')
const loginConfirmContainer = document.getElementById('loginConfirmContainer')
const loginConfirmError = document.getElementById('loginConfirmError')
const loginConfirmPassword = document.getElementById('loginConfirmPassword')
const loginEmailContainer = document.getElementById('loginEmailContainer')
const loginEmailError = document.getElementById('loginEmailError')
const loginEmail = document.getElementById('loginEmail')
const loginForgotPassword = document.getElementById('loginForgotPassword')
const loginModeLogin = document.getElementById('loginModeLogin')
const loginModeRegister = document.getElementById('loginModeRegister')
const loginButton = document.getElementById('loginButton')
const loginButtonLabel = document.getElementById('loginButtonLabel')
const loginForm = document.getElementById('loginForm')

let localAuthMode = 'login'
let localAuthCapabilities = { emailEnabled: false, emailRequired: false, recoveryUrl: null }
let loginViewOnSuccess = VIEWS.landing
let loginViewOnCancel = VIEWS.settings
let loginViewCancelHandler

function showLoginError(element, value) {
    element.textContent = value
    element.style.opacity = 1
}

function hideLoginError(element) {
    element.style.opacity = 0
}

function shakeError(element) {
    if(element.style.opacity == 1) {
        element.classList.remove('shake')
        void element.offsetWidth
        element.classList.add('shake')
    }
}

function validateLocalUsername(value) {
    const valid = validLocalUsername.test(value)
    if(valid) {
        hideLoginError(loginUsernameError)
    } else {
        showLoginError(loginUsernameError, Lang.queryJS('login.error.invalidUsername'))
    }
    updateLocalSubmitState()
    return valid
}

function validateLocalPassword(value) {
    const valid = value.length >= 8 && value.length <= 128 && !localControlCharacters.test(value)
    if(valid) {
        hideLoginError(loginPasswordError)
    } else {
        showLoginError(loginPasswordError, Lang.queryJS('login.error.invalidPassword'))
    }
    updateLocalSubmitState()
    return valid
}

function validateLocalConfirmation(value) {
    const valid = localAuthMode !== 'register' || (value.length > 0 && value === loginPassword.value)
    if(valid) {
        hideLoginError(loginConfirmError)
    } else {
        showLoginError(loginConfirmError, Lang.queryJS('login.error.passwordMismatch'))
    }
    updateLocalSubmitState()
    return valid
}

function validateLocalEmail(value) {
    const required = localAuthMode === 'register' && localAuthCapabilities.emailRequired
    const valid = !required && value.length === 0 || value.length <= 254 && validLocalEmail.test(value)
    if(valid) {
        hideLoginError(loginEmailError)
    } else {
        showLoginError(loginEmailError, Lang.queryJS('login.error.invalidEmail'))
    }
    updateLocalSubmitState()
    return valid
}

function localFormValid() {
    const usernameValid = validLocalUsername.test(loginUsername.value)
    const passwordValid = loginPassword.value.length >= 8
        && loginPassword.value.length <= 128
        && !localControlCharacters.test(loginPassword.value)
    if(localAuthMode === 'login') {
        return usernameValid && passwordValid
    }
    const confirmationValid = loginConfirmPassword.value === loginPassword.value
        && loginConfirmPassword.value.length > 0
    const emailValid = !localAuthCapabilities.emailEnabled
        || (!localAuthCapabilities.emailRequired && loginEmail.value.length === 0)
        || (loginEmail.value.length <= 254 && validLocalEmail.test(loginEmail.value))
    return usernameValid && passwordValid && confirmationValid && emailValid
}

function updateLocalSubmitState() {
    loginButton.disabled = !localFormValid()
}

function loginLoading(value) {
    if(value) {
        loginButton.setAttribute('loading', '')
        loginButtonLabel.textContent = localAuthMode === 'register'
            ? Lang.queryJS('login.registering')
            : Lang.queryJS('login.loggingIn')
    } else {
        loginButton.removeAttribute('loading')
        loginButtonLabel.textContent = localAuthMode === 'register'
            ? Lang.queryJS('login.register')
            : Lang.queryJS('login.login')
    }
}

function formDisabled(value) {
    loginCancelButton.disabled = value
    loginUsername.disabled = value
    loginPassword.disabled = value
    loginConfirmPassword.disabled = value
    loginEmail.disabled = value
    loginModeLogin.disabled = value
    loginModeRegister.disabled = value
    loginButton.disabled = value || !localFormValid()
}

function clearLocalCredentials() {
    loginPassword.value = ''
    loginConfirmPassword.value = ''
    loginEmail.value = ''
    updateLocalSubmitState()
}

function loginCancelEnabled(value) {
    if(value) {
        $(loginCancelContainer).show()
    } else {
        $(loginCancelContainer).hide()
    }
}

function setLocalAuthMode(mode) {
    localAuthMode = mode
    const registering = mode === 'register'
    loginModeLogin.toggleAttribute('selected', !registering)
    loginModeRegister.toggleAttribute('selected', registering)
    loginConfirmContainer.style.display = registering ? 'flex' : 'none'
    loginEmailContainer.style.display = registering && localAuthCapabilities.emailEnabled ? 'flex' : 'none'
    loginButtonLabel.textContent = registering ? Lang.queryJS('login.register') : Lang.queryJS('login.login')
    hideLoginError(loginConfirmError)
    hideLoginError(loginEmailError)
    updateLocalSubmitState()
}

async function prepareLocalAuthForm() {
    localAuthCapabilities = await AuthManager.getLocalAuthCapabilities()
    const recoveryUrl = localAuthCapabilities.recoveryUrl
    if(typeof recoveryUrl === 'string' && recoveryUrl.startsWith('https://')) {
        loginForgotPassword.style.display = 'inline'
        loginForgotPassword.onclick = (event) => {
            event.preventDefault()
            shell.openExternal(recoveryUrl)
        }
    } else {
        loginForgotPassword.style.display = 'none'
        loginForgotPassword.onclick = null
    }
    setLocalAuthMode('login')
}

loginUsername.addEventListener('input', event => validateLocalUsername(event.target.value))
loginPassword.addEventListener('input', event => {
    validateLocalPassword(event.target.value)
    if(localAuthMode === 'register' && loginConfirmPassword.value.length > 0) {
        validateLocalConfirmation(loginConfirmPassword.value)
    }
})
loginConfirmPassword.addEventListener('input', event => validateLocalConfirmation(event.target.value))
loginEmail.addEventListener('input', event => validateLocalEmail(event.target.value))

for(const [field, error, validator] of [
    [loginUsername, loginUsernameError, validateLocalUsername],
    [loginPassword, loginPasswordError, validateLocalPassword],
    [loginConfirmPassword, loginConfirmError, validateLocalConfirmation],
    [loginEmail, loginEmailError, validateLocalEmail]
]) {
    field.addEventListener('focusout', event => {
        validator(event.target.value)
        shakeError(error)
    })
}

loginModeLogin.onclick = () => setLocalAuthMode('login')
loginModeRegister.onclick = () => setLocalAuthMode('register')

loginCancelButton.onclick = () => {
    switchView(getCurrentView(), loginViewOnCancel, 500, 500, () => {
        loginUsername.value = ''
        clearLocalCredentials()
        loginCancelEnabled(false)
        if(loginViewCancelHandler != null) {
            loginViewCancelHandler()
            loginViewCancelHandler = null
        }
    })
}

loginForm.onsubmit = () => false

loginButton.addEventListener('click', async () => {
    if(!localFormValid()) {
        return
    }
    formDisabled(true)
    loginLoading(true)

    try {
        const account = localAuthMode === 'register'
            ? await AuthManager.registerLocalAccount(
                loginUsername.value,
                loginPassword.value,
                loginConfirmPassword.value,
                loginEmail.value || null
            )
            : await AuthManager.addLocalAccount(loginUsername.value, loginPassword.value)
        updateSelectedAccount(account)
        loginButtonLabel.textContent = Lang.queryJS('login.success')
        $('.circle-loader').toggleClass('load-complete')
        $('.checkmark').toggle()
        setTimeout(() => {
            switchView(VIEWS.login, loginViewOnSuccess, 500, 500, async () => {
                if(loginViewOnSuccess === VIEWS.settings) {
                    await prepareSettings()
                }
                loginViewOnSuccess = VIEWS.landing
                loginCancelEnabled(false)
                loginViewCancelHandler = null
                loginUsername.value = ''
                clearLocalCredentials()
                $('.circle-loader').toggleClass('load-complete')
                $('.checkmark').toggle()
                loginLoading(false)
                formDisabled(false)
            })
        }, 1000)
    } catch(displayableError) {
        clearLocalCredentials()
        loginLoading(false)
        const actualError = isDisplayableError(displayableError)
            ? displayableError
            : Lang.queryJS('login.error.unknown')
        setOverlayContent(actualError.title, actualError.desc, Lang.queryJS('login.tryAgain'))
        setOverlayHandler(() => {
            formDisabled(false)
            toggleOverlay(false)
        })
        toggleOverlay(true)
    }
})
