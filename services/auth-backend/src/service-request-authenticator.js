const crypto = require('crypto')

function safeEqual(left, right) {
    const leftBuffer = Buffer.from(left)
    const rightBuffer = Buffer.from(right)
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

class ServiceRequestAuthenticator {
    constructor({ secret, clockSkewMs = 30_000, now = Date.now }) {
        if(typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
            throw new Error('HELIOS_BRIDGE_SECRET must contain at least 32 bytes.')
        }
        if(clockSkewMs < 1000 || clockSkewMs > 300_000) {
            throw new Error('Service request clock skew must be between 1 and 300 seconds.')
        }
        this.secret = secret
        this.clockSkewMs = clockSkewMs
        this.now = now
        this.nonces = new Map()
    }

    verify(request) {
        const timestampValue = request.headers?.['x-helios-timestamp']
        const nonce = request.headers?.['x-helios-nonce']
        const signature = request.headers?.['x-helios-signature']
        if(typeof timestampValue !== 'string'
            || typeof nonce !== 'string'
            || !/^[A-Za-z0-9_-]{20,128}$/.test(nonce)
            || typeof signature !== 'string') {
            return false
        }
        const timestamp = Number(timestampValue)
        const now = this.now()
        if(!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > this.clockSkewMs) {
            return false
        }
        const rawBody = Buffer.isBuffer(request.rawBody)
            ? request.rawBody
            : Buffer.from(JSON.stringify(request.body || {}))
        const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex')
        const canonical = `${timestampValue}\n${nonce}\n${request.method}\n${request.path}\n${bodyHash}`
        const expected = crypto.createHmac('sha256', this.secret).update(canonical).digest('base64url')
        if(!safeEqual(expected, signature)) {
            return false
        }
        for(const [usedNonce, usedAt] of this.nonces) {
            if(now - usedAt > this.clockSkewMs) {
                this.nonces.delete(usedNonce)
            }
        }
        if(this.nonces.has(nonce)) {
            return false
        }
        this.nonces.set(nonce, now)
        return true
    }
}

module.exports = { ServiceRequestAuthenticator }
