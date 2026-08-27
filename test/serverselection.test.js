const assert = require('node:assert/strict')
const test = require('node:test')

const { selectAvailableServer } = require('../app/assets/js/serverselection')

function distribution(ids) {
    const servers = ids.map(id => ({ rawServer: { id } }))
    return {
        getServerById: id => servers.find(server => server.rawServer.id === id) || null,
        servers
    }
}

test('keeps a selected server only while it exists in the current distribution', () => {
    const data = distribution(['youer-main', 'other'])
    assert.equal(selectAvailableServer(data, 'other', 'youer-main').rawServer.id, 'other')
})

test('replaces a stale Demo selection with the configured Local server', () => {
    const data = distribution(['youer-main'])
    assert.equal(selectAvailableServer(data, 'Demo-1.19.4', 'youer-main').rawServer.id, 'youer-main')
})

test('falls back to the first available server when no preferred server exists', () => {
    const data = distribution(['first'])
    assert.equal(selectAvailableServer(data, null, null).rawServer.id, 'first')
    assert.equal(selectAvailableServer(distribution([]), null, null), null)
})
