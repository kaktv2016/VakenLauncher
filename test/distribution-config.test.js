const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { resolveDistributionUrl } = require('../app/assets/js/distributionconfig')
const { parseArguments, resolveFile } = require('../tools/serve-neoforge-staging')
const { backendEnvironment, serverRootFromArguments } = require('../tools/start-auth-backend-staging')
const { parseArguments: parseLauncherArguments, parseServerRoot, stagingEnvironment } = require('../tools/start-neoforge-staging-launcher')

test('distribution URL supports a secure staging override', () => {
    assert.equal(
        resolveDistributionUrl({ HELIOS_DISTRIBUTION_URL: 'https://127.0.0.1:9443/distribution.json' }),
        'https://127.0.0.1:9443/distribution.json'
    )
    assert.throws(() => resolveDistributionUrl({}, {}), /not configured/)
    assert.throws(() => resolveDistributionUrl({ HELIOS_DISTRIBUTION_URL: 'http://127.0.0.1/distro.json' }))
    assert.throws(() => resolveDistributionUrl({ HELIOS_DISTRIBUTION_URL: 'https://user@example.test/distro.json' }))
})

test('staging server argument and request paths remain inside the repository', () => {
    assert.deepEqual(parseArguments(['--root', 'repo', '--runtime', 'runtime.json']), {
        root: 'repo',
        runtime: 'runtime.json'
    })
    const root = path.resolve('staging-root')
    assert.equal(resolveFile(root, '/'), path.join(root, 'distribution.json'))
    assert.equal(resolveFile(root, '/repo/example.jar'), path.join(root, 'repo', 'example.jar'))
    assert.throws(() => resolveFile(root, '/..%2foutside.txt'))
})

test('Local authentication staging helper requires an explicit server root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-auth-staging-'))
    const runtimeDirectory = path.join(root, '_helios')
    const certificate = path.join(runtimeDirectory, 'ca.pem')
    fs.mkdirSync(runtimeDirectory)
    fs.writeFileSync(certificate, 'test certificate')
    fs.writeFileSync(path.join(runtimeDirectory, 'runtime.json'), JSON.stringify({
        backendDatabase: path.join(runtimeDirectory, 'auth.sqlite'),
        bridgeSecret: 'bridge-secret',
        caCertPath: certificate,
        pfxPassword: 'pfx-password',
        pfxPath: path.join(runtimeDirectory, 'loopback.p12'),
        serverId: 'youer-main',
        tokenSecret: 'token-secret'
    }))
    assert.equal(serverRootFromArguments(['--server-root', root]), root)
    assert.throws(() => serverRootFromArguments([]), /Required option/)
    assert.throws(() => serverRootFromArguments(['--server-root', path.parse(root).root]), /non-root/)
    const environment = backendEnvironment(root, { PATH: 'test-path' })
    assert.equal(environment.HELIOS_SERVER_ID, 'youer-main')
    assert.equal(environment.NODE_EXTRA_CA_CERTS, certificate)
    assert.equal(environment.PATH, 'test-path')
})

test('staging launcher selects the NeoForge distribution without exposing runtime secrets', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-staging-launcher-'))
    assert.equal(parseServerRoot(['--server-root', root]), root)
    assert.deepEqual(parseLauncherArguments(['--server-root', root]), { serverRoot: root })
    assert.throws(() => parseLauncherArguments([
        '--server-root', root,
        '--unsupported-option', 'value'
    ]), /Unknown option/)
    const runtimeDirectory = path.join(root, '_helios')
    const runtimePath = path.join(runtimeDirectory, 'runtime.json')
    const certificate = path.join(runtimeDirectory, 'ca.pem')
    fs.mkdirSync(runtimeDirectory, { recursive: true })
    fs.writeFileSync(certificate, 'test certificate')
    fs.writeFileSync(runtimePath, JSON.stringify({
        bridgeSecret: 'must-not-be-copied',
        caCertPath: certificate,
        serverId: 'youer-main',
        tokenSecret: 'must-not-be-copied'
    }))
    const environment = stagingEnvironment(root, { PATH: 'test-path' })
    assert.equal(environment.HELIOS_DISTRIBUTION_URL, 'https://127.0.0.1:9443/distribution.json')
    assert.equal(environment.HELIOS_SERVER_ID, 'youer-main')
    assert.equal(environment.NODE_EXTRA_CA_CERTS, certificate)
    assert.equal(environment.bridgeSecret, undefined)
    assert.equal(environment.tokenSecret, undefined)
})
