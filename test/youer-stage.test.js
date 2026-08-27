const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const test = require('node:test')

const pins = require('../services/youer-artifacts.json')
const { files } = require('../tools/package-youer-server')
const {
    escapePropertyValue,
    parseArguments: parseConfigureArguments
} = require('../tools/configure-youer-runtime')
const { parseArguments } = require('../tools/verify-youer-stage')

const projectRoot = path.resolve(__dirname, '..')

test('pins immutable Youer, NeoForge, and AuthMe staging artifacts', () => {
    assert.equal(pins.minecraftVersion, '1.21.1')
    assert.equal(pins.javaMajor, 21)
    assert.match(pins.youer.commit, /^[a-f0-9]{40}$/)
    assert.equal(pins.youer.build, pins.youer.commit.substring(0, 8))
    assert.match(pins.youer.serverJarSha256, /^[a-f0-9]{64}$/)
    assert.match(pins.neoForge.installerSha256, /^[a-f0-9]{64}$/)
    assert.match(pins.authMe.jarSha256, /^[a-f0-9]{64}$/)
    assert.match(pins.packetEvents.jarSha256, /^[a-f0-9]{64}$/)
    assert.equal(new URL(pins.youer.repository).protocol, 'https:')
    assert.equal(new URL(pins.neoForge.installerUrl).protocol, 'https:')
    assert.equal(new URL(pins.authMe.assetUrl).protocol, 'https:')
    assert.equal(new URL(pins.packetEvents.releaseUrl).protocol, 'https:')
    assert.equal(new URL(pins.packetEvents.assetUrl).protocol, 'https:')
})

test('keeps the client distribution and companion build aligned with Youer', () => {
    const gradleProperties = fs.readFileSync(path.join(
        projectRoot,
        'services',
        'neoforge-sso-companion',
        'gradle.properties'
    ), 'utf8')
    assert.match(gradleProperties, new RegExp(`^neo_version=${pins.neoForge.version}$`, 'm'))

    const distribution = require('../docs/neoforge_distribution.example.json')
    const loader = distribution.servers[0].modules.find(module => module.type === 'NeoForge')
    assert.equal(distribution.servers[0].minecraftVersion, pins.minecraftVersion)
    assert.match(loader.id, new RegExp(`^net\\.minecraft:client:${pins.minecraftVersion}-[^:]+:srg$`))
    assert.ok(loader.subModules.some(module => module.type === 'VersionManifest'
        && module.id === `neoforge-${pins.neoForge.version}`))
})

test('ships the pinned-artifact manifest in the server bundle', () => {
    assert.ok(files.some(entry => entry.archivePath === 'PinnedArtifacts.json'
        && entry.sourcePath === 'services/youer-artifacts.json'))
    assert.ok(files.some(entry => entry.archivePath === 'tools/verify-youer-stage.js'
        && entry.sourcePath === 'tools/verify-youer-stage.js'))
})

test('pre-EULA verifier requires an explicit staging directory', () => {
    assert.throws(() => parseArguments([]), /--server-dir is required/)
    assert.deepEqual(parseArguments(['--server-dir', 'stage', '--java', 'java21']), {
        java: 'java21',
        serverDir: 'stage'
    })
    assert.throws(() => parseArguments(['--accept-eula', 'true']), /Unexpected argument/)
})

test('runtime configurator requires explicit server, PacketEvents, and keytool paths', () => {
    assert.deepEqual(parseConfigureArguments([
        '--server-dir', 'server',
        '--packet-events', 'packetevents.jar',
        '--keytool', 'keytool.exe'
    ]), {
        keytool: 'keytool.exe',
        packetEvents: 'packetevents.jar',
        serverDir: 'server'
    })
    assert.throws(() => parseConfigureArguments(['--server-dir', 'server']), /--packet-events is required/)
})

test('runtime configurator escapes Windows paths for Java properties', () => {
    const windowsPath = String.raw`C:\Users\player\Server\_helios\truststore.p12`
    assert.equal(
        escapePropertyValue(windowsPath),
        String.raw`C:\\Users\\player\\Server\\_helios\\truststore.p12`
    )
    assert.equal(escapePropertyValue('line\tbreak\n'), String.raw`line\tbreak\n`)
})
