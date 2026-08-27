const { Type } = require('helios-distribution-types')

const SUPPORTED_MINECRAFT_VERSION = '1.21.1'
const REQUIRED_MAIN_CLASS = 'cpw.mods.bootstraplauncher.BootstrapLauncher'

function isNeoForgeLoader(module) {
    return module?.rawModule?.type === Type.NeoForge || module?.type === Type.NeoForge
}

function findModLoaders(modules) {
    const loaderTypes = new Set([
        Type.ForgeHosted,
        Type.Forge,
        Type.Fabric,
        Type.NeoForge
    ])

    return modules.filter(module => loaderTypes.has(module.rawModule?.type ?? module.type))
}

function validateModLoaderTopology(modules) {
    const loaders = findModLoaders(modules)
    if(loaders.length !== 1) {
        throw new Error(`Distribution must declare exactly one mod loader; found ${loaders.length}.`)
    }
    return loaders[0]
}

function validateNeoForgeManifest(manifest, minecraftVersion) {
    if(minecraftVersion !== SUPPORTED_MINECRAFT_VERSION) {
        throw new Error(`This launcher build supports NeoForge for Minecraft ${SUPPORTED_MINECRAFT_VERSION}; received ${minecraftVersion}.`)
    }
    if(manifest == null || manifest.inheritsFrom !== minecraftVersion) {
        throw new Error(`NeoForge manifest must inherit from Minecraft ${minecraftVersion}.`)
    }
    if(manifest.mainClass !== REQUIRED_MAIN_CLASS) {
        throw new Error(`Unexpected NeoForge main class: ${manifest.mainClass ?? 'missing'}.`)
    }
    if(!Array.isArray(manifest.arguments?.jvm) || !Array.isArray(manifest.arguments?.game)) {
        throw new Error('NeoForge manifest must declare both JVM and game arguments.')
    }

    const allArgs = [...manifest.arguments.jvm, ...manifest.arguments.game]
        .filter(argument => typeof argument === 'string')
    if(allArgs.includes('--fml.modLists') || allArgs.includes('--fml.mavenRoots')) {
        throw new Error('NeoForge 1.21.1 manifest contains unsupported legacy Forge mod-list arguments.')
    }
    if(!allArgs.includes('--fml.neoForgeVersion') || !allArgs.includes('--launchTarget')) {
        throw new Error('NeoForge manifest is missing required FML game arguments.')
    }
    if(!allArgs.includes('ALL-MODULE-PATH')) {
        throw new Error('NeoForge manifest is missing its Java module-path launch configuration.')
    }

    return manifest
}

module.exports = {
    REQUIRED_MAIN_CLASS,
    SUPPORTED_MINECRAFT_VERSION,
    findModLoaders,
    isNeoForgeLoader,
    validateModLoaderTopology,
    validateNeoForgeManifest
}
