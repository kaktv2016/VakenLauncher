const fs = require('fs')
const path = require('path')

const TICKET_FILE_NAME = '.helios-sso-ticket.json'
const CONNECTION_ATTEMPT_PATTERN = /\bConnecting to\s+[^,\r\n]+,\s*\d+\b/i

function ticketPath(gameDirectory) {
    return path.join(gameDirectory, TICKET_FILE_NAME)
}

function removeTicketFile(gameDirectory) {
    try {
        fs.rmSync(ticketPath(gameDirectory), { force: true })
    } catch(_error) {
        // Best effort only. The ticket expires quickly and is one-time-use.
    }
}

function writeTicketFile(gameDirectory, ticket, serverAddress) {
    if(typeof ticket?.ticket !== 'string'
        || typeof ticket?.serverId !== 'string'
        || !Number.isSafeInteger(ticket?.expiresAt)
        || typeof serverAddress !== 'string'
        || serverAddress.length === 0) {
        throw new Error('INVALID_SSO_TICKET')
    }
    fs.mkdirSync(gameDirectory, { recursive: true })
    removeTicketFile(gameDirectory)
    const destination = ticketPath(gameDirectory)
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
    const descriptor = fs.openSync(temporary, 'wx', 0o600)
    try {
        fs.writeFileSync(descriptor, JSON.stringify({
            expiresAt: ticket.expiresAt,
            serverAddress,
            serverId: ticket.serverId,
            ticket: ticket.ticket
        }), { encoding: 'utf8' })
        fs.fsyncSync(descriptor)
    } finally {
        fs.closeSync(descriptor)
    }
    try {
        fs.chmodSync(temporary, 0o600)
    } catch(_error) {
        // Windows ACLs are inherited from the user's private launcher directory.
    }
    try {
        fs.renameSync(temporary, destination)
    } catch(error) {
        try {
            fs.rmSync(temporary, { force: true })
        } catch(_cleanupError) {
            // Best effort only; the temporary file contains the same short-lived envelope.
        }
        throw error
    }
    return destination
}

function isConnectionAttemptOutput(output) {
    return CONNECTION_ATTEMPT_PATTERN.test(String(output))
}

function createConnectionTicketCoordinator({
    gameDirectory,
    issueTicket,
    now = () => Date.now(),
    onError = () => {},
    onReady = () => {},
    serverAddress
}) {
    if(typeof issueTicket !== 'function') {
        throw new TypeError('issueTicket must be a function')
    }
    let disposed = false
    let inFlight = null
    let lastAttemptAt = Number.NEGATIVE_INFINITY

    const prepare = async () => {
        removeTicketFile(gameDirectory)
        try {
            const result = await issueTicket()
            if(disposed) {
                return false
            }
            writeTicketFile(gameDirectory, result, serverAddress)
            onReady()
            return true
        } catch(error) {
            removeTicketFile(gameDirectory)
            onError(error)
            return false
        } finally {
            inFlight = null
        }
    }

    const handleGameOutput = output => {
        if(disposed || !isConnectionAttemptOutput(output)) {
            return null
        }
        const attemptAt = now()
        if(inFlight != null || attemptAt - lastAttemptAt < 5_000) {
            return inFlight
        }
        lastAttemptAt = attemptAt
        inFlight = prepare()
        return inFlight
    }

    const dispose = () => {
        disposed = true
        removeTicketFile(gameDirectory)
    }

    return { dispose, handleGameOutput }
}

module.exports = {
    CONNECTION_ATTEMPT_PATTERN,
    TICKET_FILE_NAME,
    createConnectionTicketCoordinator,
    isConnectionAttemptOutput,
    removeTicketFile,
    ticketPath,
    writeTicketFile
}
