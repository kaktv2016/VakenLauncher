const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const remotePath = require.resolve('@electron/remote')
require.cache[remotePath] = {
    id: remotePath,
    filename: remotePath,
    loaded: true,
    exports: { app: { getPath: () => os.tmpdir() } }
}

const { HeliosDistribution } = require('helios-core/common')
const { DistributionIndexProcessor } = require('helios-core/dl')
const { Type } = require('helios-distribution-types')
const ProcessBuilder = require('../app/assets/js/processbuilder')
const ConfigManager = require('../app/assets/js/configmanager')
const {
    validateModLoaderTopology,
    validateNeoForgeManifest
} = require('../app/assets/js/neoforge')

function validManifest(id = 'neoforge-21.1.248') {
    return {
        id,
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
        libraries: []
    }
}

function rawDistribution(manifestId = 'neoforge-21.1.248') {
    return {
        version: '1.0.0',
        servers: [{
            id: 'test-server',
            name: 'Test Server',
            description: 'Test',
            icon: 'https://example.invalid/icon.png',
            version: '1.0.0',
            address: 'localhost:25565',
            minecraftVersion: '1.21.1',
            javaOptions: {
                supported: '21.x',
                suggestedMajor: 21
            },
            autoconnect: true,
            modules: [{
                id: 'net.minecraft:client:1.21.1-20240808.144430:srg',
                name: 'NeoForge',
                type: 'NeoForge',
                artifact: {
                    size: 1,
                    MD5: 'c4ca4238a0b923820dcc509a6f75849b',
                    url: 'https://example.invalid/neoforge.jar'
                },
                subModules: [{
                    id: manifestId,
                    name: 'NeoForge manifest',
                    type: 'VersionManifest',
                    artifact: {
                        size: 1,
                        MD5: 'c4ca4238a0b923820dcc509a6f75849b',
                        url: 'https://example.invalid/version.json'
                    }
                }, {
                    id: 'example:runtime:1.0.0',
                    name: 'Runtime',
                    type: 'Library',
                    artifact: {
                        size: 1,
                        MD5: 'c4ca4238a0b923820dcc509a6f75849b',
                        url: 'https://example.invalid/runtime.jar'
                    }
                }, {
                    id: 'example:hidden:1.0.0',
                    name: 'Dynamically loaded runtime',
                    type: 'Library',
                    classpath: false,
                    artifact: {
                        size: 1,
                        MD5: 'c4ca4238a0b923820dcc509a6f75849b',
                        url: 'https://example.invalid/hidden.jar'
                    }
                }]
            }, {
                id: 'example:required-mod:1.0.0',
                name: 'Required Mod',
                type: 'NeoForgeMod',
                artifact: {
                    size: 1,
                    MD5: 'c4ca4238a0b923820dcc509a6f75849b',
                    path: 'mods/required-mod.jar',
                    url: 'https://example.invalid/required-mod.jar'
                }
            }, {
                id: 'example:optional-mod:1.0.0',
                name: 'Optional Mod',
                type: 'NeoForgeMod',
                required: { value: false, def: false },
                artifact: {
                    size: 1,
                    MD5: 'c4ca4238a0b923820dcc509a6f75849b',
                    path: 'mods/optional-mod.jar',
                    url: 'https://example.invalid/optional-mod.jar'
                }
            }]
        }]
    }
}

test('patched distribution types expose NeoForge module types', () => {
    assert.equal(Type.NeoForge, 'NeoForge')
    assert.equal(Type.NeoForgeMod, 'NeoForgeMod')
})

test('NeoForge manifest validation accepts the installed 1.21.1 launch shape', () => {
    const manifest = validManifest()
    assert.equal(validateNeoForgeManifest(manifest, '1.21.1'), manifest)
})

test('NeoForge manifest validation rejects legacy Forge mod-list arguments', () => {
    const manifest = validManifest()
    manifest.arguments.game.push('--fml.modLists')
    assert.throws(
        () => validateNeoForgeManifest(manifest, '1.21.1'),
        /unsupported legacy Forge mod-list arguments/
    )
})

test('distribution requires exactly one supported top-level loader', () => {
    const modules = [{ type: Type.NeoForge }]
    assert.equal(validateModLoaderTopology(modules), modules[0])
    assert.throws(() => validateModLoaderTopology([]), /exactly one mod loader/)
    assert.throws(
        () => validateModLoaderTopology([{ type: Type.NeoForge }, { type: Type.Fabric }]),
        /found 2/
    )
})

test('core resolves NeoForge artifacts into libraries and instance mods', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-neoforge-core-'))
    const common = path.join(root, 'common')
    const instances = path.join(root, 'instances')
    const distribution = new HeliosDistribution(rawDistribution(), common, instances)
    const server = distribution.getMainServer()

    assert.equal(
        server.modules[0].getPath(),
        path.join(common, 'libraries', 'net', 'minecraft', 'client', '1.21.1-20240808.144430', 'client-1.21.1-20240808.144430-srg.jar'))
    assert.equal(
        server.modules[1].getPath(),
        path.join(instances, 'test-server', 'mods', 'required-mod.jar'))
})

test('process builder excludes NeoForge generated artifacts from the classpath', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-neoforge-classpath-'))
    const distribution = new HeliosDistribution(rawDistribution(), path.join(root, 'common'), path.join(root, 'instances'))
    const builder = Object.create(ProcessBuilder.prototype)
    builder.server = distribution.getMainServer()

    const libraries = builder._resolveServerLibraries([])
    assert.equal(libraries['net.minecraft:client:srg'], undefined)
    assert.ok(libraries['example:runtime'])
    assert.equal(libraries['example:hidden'], undefined)
})

test('process builder never emits the removed Forge mod-list arguments for NeoForge', () => {
    const builder = Object.create(ProcessBuilder.prototype)
    builder.usingNeoForgeLoader = true
    assert.deepEqual(builder.constructModList([{ getPath: () => 'example.jar' }]), [])
})

test('process builder expands NeoForge module-path, classpath, main class, and game arguments', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-neoforge-args-'))
    const common = path.join(root, 'common')
    const distribution = new HeliosDistribution(rawDistribution(), common, path.join(root, 'instances'))
    const builder = Object.create(ProcessBuilder.prototype)
    builder.server = distribution.getMainServer()
    builder.commonDir = common
    builder.gameDir = path.join(root, 'instances', 'test-server')
    builder.libPath = path.join(common, 'libraries')
    builder.vanillaManifest = {
        id: '1.21.1',
        type: 'release',
        assets: '17',
        libraries: [],
        arguments: {
            jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
            game: ['--username', '${auth_player_name}', '--accessToken', '${auth_access_token}']
        }
    }
    builder.modManifest = validManifest()
    builder.authUser = {
        displayName: 'Player',
        uuid: '00000000000000000000000000000000',
        accessToken: 'secret',
        type: 'local'
    }
    builder.launcherVersion = 'test'
    builder.usingFabricLoader = false
    builder.usingNeoForgeLoader = true
    builder.usingLiteLoader = false
    ConfigManager.getMaxRAM = () => '4G'
    ConfigManager.getMinRAM = () => '2G'
    ConfigManager.getJVMOptions = () => []
    ConfigManager.getAutoConnect = () => false
    ConfigManager.getFullscreen = () => false
    ConfigManager.getGameWidth = () => 1280
    ConfigManager.getGameHeight = () => 720

    const args = builder._constructJVMArguments113([], path.join(root, 'natives'))
    assert.ok(args.includes('cpw.mods.bootstraplauncher.BootstrapLauncher'))
    assert.ok(args.includes('ALL-MODULE-PATH'))
    assert.ok(args.some(argument => typeof argument === 'string' && argument.includes(builder.libPath)))
    const classpath = args[args.indexOf('-cp') + 1]
    assert.ok(!classpath.includes(path.join(common, 'versions', '1.21.1', '1.21.1.jar')))
    assert.ok(!classpath.includes('client-1.21.1-20240808.144430-srg.jar'))
    assert.ok(args.includes('--fml.neoForgeVersion'))
    assert.ok(args.includes('21.1.248'))
    assert.ok(!args.includes('--fml.modLists'))
    assert.ok(!args.includes('--fml.mavenRoots'))

    const localArgs = builder._constructJVMArguments113([], path.join(root, 'natives'))
    assert.ok(!localArgs.includes('secret'))
    assert.equal(localArgs[localArgs.indexOf('--accessToken') + 1], '0')
})

test('distribution processor loads NeoForge version manifest from its submodule', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-neoforge-manifest-'))
    const common = path.join(root, 'common')
    const instances = path.join(root, 'instances')
    const manifest = validManifest()
    const distribution = new HeliosDistribution(rawDistribution(manifest.id), common, instances)
    const manifestPath = path.join(common, 'versions', manifest.id, `${manifest.id}.json`)
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))

    const processor = new DistributionIndexProcessor(common, distribution, 'test-server')
    assert.deepEqual(await processor.loadModLoaderVersionJson(), manifest)
})
