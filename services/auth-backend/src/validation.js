const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

function validateUsername(value) {
    if(typeof value !== 'string' || !USERNAME_PATTERN.test(value)) {
        throw new ValidationError('INVALID_USERNAME')
    }
    return value
}

function validatePassword(value) {
    if(typeof value !== 'string'
        || value.length < 8
        || value.length > 128
        || CONTROL_CHARACTER_PATTERN.test(value)) {
        throw new ValidationError('INVALID_PASSWORD')
    }
    return value
}

function validateEmail(value, required = false) {
    if(value == null || value === '') {
        if(required) {
            throw new ValidationError('INVALID_EMAIL')
        }
        return null
    }
    if(typeof value !== 'string' || value.length > 254 || !EMAIL_PATTERN.test(value)) {
        throw new ValidationError('INVALID_EMAIL')
    }
    return value.trim().toLowerCase()
}

class ValidationError extends Error {
    constructor(code) {
        super(code)
        this.name = 'ValidationError'
        this.code = code
    }
}

module.exports = {
    ValidationError,
    validateEmail,
    validatePassword,
    validateUsername
}
