const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
    createConnectionTicketCoordinator,
    isConnectionAttemptOutput,
    removeTicketFile,
    ticketPath,
    writeTicketFile
} = require('../app/assets/js/ssoticket')

test('writes only the short-lived SSO envelope to a private instance file and removes stale data', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-sso-test-'))
    t.after(() => fs.rmSync(directory, { force: true, recursive: true }))
    fs.writeFileSync(ticketPath(directory), 'stale-secret')
    writeTicketFile(directory, {
        expiresAt: 1_800_000_045_000,
        serverId: 'youer-main',
        ticket: 'opaque-single-use-ticket-value-1234567890'
    }, 'play.example.com')

    const saved = JSON.parse(fs.readFileSync(ticketPath(directory), 'utf8'))
    assert.deepEqual(saved, {
        expiresAt: 1_800_000_045_000,
        serverAddress: 'play.example.com',
        serverId: 'youer-main',
        ticket: 'opaque-single-use-ticket-value-1234567890'
    })
    assert.equal(JSON.stringify(saved).includes('accessToken'), false)
    removeTicketFile(directory)
    assert.equal(fs.existsSync(ticketPath(directory)), false)
})

test('recognizes the Minecraft connection log instead of issuing a ticket during slow startup', () => {
    assert.equal(isConnectionAttemptOutput(
        '[Render thread/INFO] [net.minecraft.client.gui.screens.ConnectScreen/]: Connecting to 127.0.0.1, 25565'
    ), true)
    assert.equal(isConnectionAttemptOutput('[Render thread/INFO]: Connecting to localhost, 25565'), true)
    assert.equal(isConnectionAttemptOutput('[Render thread/INFO]: Game initialization complete'), false)
})

test('issues one fresh ticket per connection attempt and removes it on dispose', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-sso-coordinator-test-'))
    t.after(() => fs.rmSync(directory, { force: true, recursive: true }))
    let clock = 10_000
    let issued = 0
    const coordinator = createConnectionTicketCoordinator({
        gameDirectory: directory,
        issueTicket: async () => ({
            expiresAt: clock + 60_000,
            serverId: 'youer-main',
            ticket: `opaque-single-use-ticket-value-${++issued}-1234567890`
        }),
        now: () => clock,
        serverAddress: '127.0.0.1:25565'
    })

    const output = '[Render thread/INFO] [ConnectScreen/]: Connecting to 127.0.0.1, 25565'
    await coordinator.handleGameOutput(output)
    await coordinator.handleGameOutput(output)
    assert.equal(issued, 1)
    assert.equal(JSON.parse(fs.readFileSync(ticketPath(directory), 'utf8')).ticket,
        'opaque-single-use-ticket-value-1-1234567890')

    clock += 5_001
    await coordinator.handleGameOutput(output)
    assert.equal(issued, 2)
    assert.equal(JSON.parse(fs.readFileSync(ticketPath(directory), 'utf8')).ticket,
        'opaque-single-use-ticket-value-2-1234567890')

    coordinator.dispose()
    assert.equal(fs.existsSync(ticketPath(directory)), false)
})

test('fails closed without leaving a ticket file when refresh or issuance fails', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-sso-failure-test-'))
    t.after(() => fs.rmSync(directory, { force: true, recursive: true }))
    fs.writeFileSync(ticketPath(directory), 'stale-ticket')
    let reported = null
    const coordinator = createConnectionTicketCoordinator({
        gameDirectory: directory,
        issueTicket: async () => { throw new Error('backend unavailable') },
        onError: error => { reported = error },
        serverAddress: '127.0.0.1:25565'
    })

    const result = await coordinator.handleGameOutput(
        '[Render thread/INFO] [ConnectScreen/]: Connecting to 127.0.0.1, 25565'
    )
    assert.equal(result, false)
    assert.equal(reported?.message, 'backend unavailable')
    assert.equal(fs.existsSync(ticketPath(directory)), false)
})
