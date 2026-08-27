class RateLimiter {
    constructor({ limit, windowMs, blockMs, now = Date.now }) {
        this.limit = limit
        this.windowMs = windowMs
        this.blockMs = blockMs
        this.now = now
        this.entries = new Map()
    }

    consume(key) {
        const now = this.now()
        let entry = this.entries.get(key)
        if(entry == null || now - entry.windowStart >= this.windowMs) {
            entry = { count: 0, windowStart: now, blockedUntil: 0 }
        }
        if(entry.blockedUntil > now) {
            return false
        }

        entry.count++
        if(entry.count > this.limit) {
            entry.blockedUntil = now + this.blockMs
            this.entries.set(key, entry)
            return false
        }
        this.entries.set(key, entry)
        return true
    }

    prune() {
        const cutoff = this.now() - Math.max(this.windowMs, this.blockMs)
        for(const [key, entry] of this.entries) {
            if(entry.windowStart < cutoff && entry.blockedUntil < cutoff) {
                this.entries.delete(key)
            }
        }
    }
}

module.exports = { RateLimiter }
