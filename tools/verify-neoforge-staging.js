const fs = require('fs')
const path = require('path')

const { DistributionAPI } = require('helios-core/common')
const {
    DistributionIndexProcessor,
    FullRepair,
    MojangIndexProcessor
} = require('helios-core/dl')

const { validateNeoForgeManifest } = require('../app/assets/js/neoforge')

function parseArguments(argv) {
    const options = {}
    for(let index = 0; index < argv.length; index += 2) {
        const key = argv[index]
        const value = argv[index + 1]
        if(!key?.startsWith('--') || value == null || value.startsWith('--')) {
            throw new Error(`Invalid argument near ${key ?? 'end of command'}.`)
        }
        options[key.substring(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = value
    }
    for(const key of ['serverRoot', 'launcherDir', 'dataDir']) {
        if(options[key] == null) {
            throw new Error(`Missing required option --${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}.`)
        }
    }
    return options
}

async function main() {
    const options = parseArguments(process.argv.slice(2))
    const serverRoot = path.resolve(options.serverRoot)
    const launcherDirectory = path.resolve(options.launcherDir)
    const dataDirectory = path.resolve(options.dataDir)
    const runtime = JSON.parse(fs.readFileSync(path.join(serverRoot, '_helios', 'runtime.json'), 'utf8'))
    process.env.NODE_EXTRA_CA_CERTS = runtime.caCertPath

    const distributionApi = new DistributionAPI(
        launcherDirectory,
        path.join(dataDirectory, 'common'),
        path.join(dataDirectory, 'instances'),
        null,
        false
    )
    const distribution = await distributionApi.getDistributionLocalLoadOnly()
    const serverId = options.serverId || runtime.serverId
    const server = distribution.getServerById(serverId)
    if(server == null) {
        throw new Error(`Distribution does not contain server ${serverId}.`)
    }

    const repair = new FullRepair(
        path.join(dataDirectory, 'common'),
        path.join(dataDirectory, 'instances'),
        launcherDirectory,
        serverId,
        false
    )
    repair.spawnReceiver()
    try {
        const invalidBefore = await repair.verifyFiles(percent => {
            if(percent % 10 === 0) process.stdout.write(`Validate ${percent}%\r`)
        })
        console.log(`\nFiles requiring download or repair: ${invalidBefore}`)
        if(invalidBefore > 0) {
            await repair.download(percent => {
                if(percent % 5 === 0) process.stdout.write(`Download ${percent}%\r`)
            })
            console.log('\nDownload complete.')
        }
    } finally {
        repair.destroyReceiver()
    }

    const secondPass = new FullRepair(
        path.join(dataDirectory, 'common'),
        path.join(dataDirectory, 'instances'),
        launcherDirectory,
        serverId,
        false
    )
    secondPass.spawnReceiver()
    try {
        const invalidAfter = await secondPass.verifyFiles(() => {})
        if(invalidAfter !== 0) {
            throw new Error(`Post-download verification still reports ${invalidAfter} invalid files.`)
        }
    } finally {
        secondPass.destroyReceiver()
    }

    const commonDirectory = path.join(dataDirectory, 'common')
    const distributionProcessor = new DistributionIndexProcessor(commonDirectory, distribution, serverId)
    const mojangProcessor = new MojangIndexProcessor(commonDirectory, server.rawServer.minecraftVersion)
    const neoForgeManifest = await distributionProcessor.loadModLoaderVersionJson(server)
    const vanillaManifest = await mojangProcessor.getVersionJson()
    validateNeoForgeManifest(neoForgeManifest, server.rawServer.minecraftVersion)

    console.log(JSON.stringify({
        java: server.effectiveJavaOptions.supported,
        mainClass: neoForgeManifest.mainClass,
        minecraft: vanillaManifest.id,
        neoForge: neoForgeManifest.id,
        serverId,
        verified: true
    }, null, 2))
}

if(require.main === module) {
    main().catch(error => {
        console.error(error)
        process.exitCode = 1
    })
}

module.exports = { parseArguments }
