const crypto = require('crypto')

class BridgeClient {
    constructor({ baseUrl, secret, fetchImpl = fetch, now = Date.now }) {
        const parsed = new URL(baseUrl)
        if(parsed.protocol !== 'https:') {
            throw new Error('The AuthMe bridge URL must use HTTPS.')
        }
        if(typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
            throw new Error('HELIOS_BRIDGE_SECRET must contain at least 32 bytes.')
        }
        this.baseUrl = parsed
        this.secret = secret
        this.fetchImpl = fetchImpl
        this.now = now
    }

    async request(path, body) {
        const serialized = JSON.stringify(body)
        const timestamp = this.now().toString()
        const nonce = crypto.randomBytes(16).toString('base64url')
        const bodyHash = crypto.createHash('sha256').update(serialized).digest('hex')
        const canonical = `${timestamp}\n${nonce}\nPOST\n${path}\n${bodyHash}`
        const signature = crypto.createHmac('sha256', this.secret).update(canonical).digest('base64url')
        const response = await this.fetchImpl(new URL(path, this.baseUrl), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-helios-nonce': nonce,
                'x-helios-signature': signature,
                'x-helios-timestamp': timestamp
            },
            body: serialized,
            signal: AbortSignal.timeout(5000)
        })
        if(!response.ok) {
            return { ok: false, status: response.status }
        }
        const result = await response.json()
        return result != null && typeof result.ok === 'boolean' ? result : { ok: false, status: 502 }
    }

    login(username, password) {
        return this.request('/internal/auth/login', { username, password })
    }

    register(username, password, email) {
        return this.request('/internal/auth/register', { email, password, username })
    }

}

module.exports = { BridgeClient }
