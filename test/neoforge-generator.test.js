const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { generateDistribution, mavenPath } = require('../tools/neoforge-distribution-generator')

function write(root, relativePath, content = relativePath) {
    const target = path.join(root, ...relativePath.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
    return target
}

test('generator creates a complete, hash-pinned NeoForge distribution and staging repository', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-neoforge-generator-'))
    const client = path.join(root, 'client')
    const instance = path.join(root, 'instance')
    const repository = path.join(root, 'www')
    const versionId = 'neoforge-21.1.248'
    const manifest = {
        id: versionId,
        inheritsFrom: '1.21.1',
        mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
        arguments: {
            jvm: ['-p', '${library_directory}/example.jar', '--add-modules', 'ALL-MODULE-PATH'],
            game: [
                '--fml.neoForgeVersion', '21.1.248',
                '--fml.neoFormVersion', '20240808.144430',
                '--launchTarget', 'forgeclient'
            ]
        },
        libraries: [{
            name: 'example:runtime:1.0.0',
            downloads: { artifact: { path: 'example/runtime/1.0.0/runtime-1.0.0.jar' } }
        }]
    }
    write(client, `versions/${versionId}/${versionId}.json`, JSON.stringify(manifest))
    for(const identifier of [
        'net.minecraft:client:1.21.1-20240808.144430:srg',
        'net.neoforged:neoforge:21.1.248:universal',
        'net.minecraft:client:1.21.1-20240808.144430:slim',
        'net.minecraft:client:1.21.1-20240808.144430:extra'
    ]) {
        write(client, `libraries/${mavenPath(identifier)}`)
    }
    write(client, 'libraries/example/runtime/1.0.0/runtime-1.0.0.jar')
    const requiredMod = write(instance, 'mods/required.jar', 'required mod')
    write(instance, 'mods/optional.jar', 'optional mod')
    write(instance, 'config/server.toml', 'config')
    write(instance, 'resourcepacks/resources.zip', 'resources')

    const distribution = generateDistribution({
        clientDir: client,
        versionId,
        baseUrl: 'https://cdn.example.invalid/files/',
        repoDir: repository,
        instanceDir: instance,
        optionalMods: ['optional.jar']
    })
    const server = distribution.servers[0]
    const loader = server.modules[0]
    const required = server.modules.find(module => module.name === 'required.jar')
    const optional = server.modules.find(module => module.name === 'optional.jar')

    assert.equal(loader.type, 'NeoForge')
    assert.equal(loader.id, 'net.minecraft:client:1.21.1-20240808.144430:srg')
    assert.equal(loader.subModules.filter(module => module.type === 'VersionManifest').length, 1)
    assert.equal(loader.subModules.filter(module => module.type === 'Library').length, 4)
    assert.equal(server.javaOptions.supported, '21.x')
    assert.equal(server.javaOptions.platformOptions[0].architecture, 'x64')
    assert.equal(required.type, 'NeoForgeMod')
    assert.equal(required.required, undefined)
    assert.deepEqual(optional.required, { value: false, def: false })
    assert.equal(
        required.artifact.MD5,
        crypto.createHash('md5').update(fs.readFileSync(requiredMod)).digest('hex'))
    assert.ok(fs.existsSync(path.join(repository, 'repo', 'versions', versionId, `${versionId}.json`)))
    assert.ok(fs.existsSync(path.join(repository, 'instance', 'mods', 'required.jar')))
    assert.ok(fs.existsSync(path.join(repository, 'instance', 'config', 'server.toml')))
    assert.ok(fs.existsSync(path.join(repository, 'instance', 'resourcepacks', 'resources.zip')))
})
