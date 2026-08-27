const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

function parseArguments(argv) {
    const options = { optionalMods: [] }
    for(let index = 0; index < argv.length; index++) {
        const key = argv[index]
        if(!key.startsWith('--')) {
            throw new Error(`Unexpected argument: ${key}`)
        }
        const value = argv[++index]
        if(value == null || value.startsWith('--')) {
            throw new Error(`Missing value for ${key}`)
        }
        if(key === '--optional-mod') {
            options.optionalMods.push(value.toLowerCase())
        } else {
            options[key.substring(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = value
        }
    }
    return options
}

function normalizeUrl(value) {
    const parsed = new URL(value)
    if(parsed.protocol !== 'https:') {
        throw new Error('The distribution base URL must use HTTPS.')
    }
    return parsed.toString().replace(/\/$/, '')
}

function md5(file) {
    return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')
}

function artifact(file, url, relativePath) {
    const result = {
        size: fs.statSync(file).size,
        MD5: md5(file),
        url
    }
    if(relativePath != null) {
        result.path = relativePath.replaceAll('\\', '/')
    }
    return result
}

function mavenPath(identifier) {
    const [coordinates, extension = 'jar'] = identifier.split('@')
    const parts = coordinates.split(':')
    if(parts.length < 3 || parts.length > 4) {
        throw new Error(`Unsupported Maven identifier: ${identifier}`)
    }
    const [group, name, version, classifier] = parts
    const fileName = `${name}-${version}${classifier == null ? '' : `-${classifier}`}.${extension}`
    return `${group.replaceAll('.', '/')}/${name}/${version}/${fileName}`
}

function getArgumentValue(argumentsList, key) {
    const index = argumentsList.indexOf(key)
    if(index === -1 || typeof argumentsList[index + 1] !== 'string') {
        throw new Error(`NeoForge manifest is missing ${key}.`)
    }
    return argumentsList[index + 1]
}

function copyToRepository(source, repositoryRoot, relativePath) {
    if(repositoryRoot == null) {
        return
    }
    const destination = path.join(repositoryRoot, ...relativePath.split('/'))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination)
}

function libraryModule(clientDirectory, baseUrl, identifier, options = {}) {
    const relativePath = mavenPath(identifier)
    const source = path.join(clientDirectory, 'libraries', ...relativePath.split('/'))
    if(!fs.existsSync(source)) {
        throw new Error(`Required NeoForge runtime artifact is missing: ${source}`)
    }
    copyToRepository(source, options.repositoryRoot, `libraries/${relativePath}`)
    return {
        id: identifier,
        name: options.name ?? identifier,
        type: options.type ?? 'Library',
        ...(options.classpath === false ? { classpath: false } : {}),
        artifact: artifact(source, `${baseUrl}/libraries/${relativePath}`)
    }
}

function collectFiles(root, directory) {
    const absoluteDirectory = path.join(root, directory)
    if(!fs.existsSync(absoluteDirectory)) {
        return []
    }
    const result = []
    const pending = [absoluteDirectory]
    while(pending.length > 0) {
        const current = pending.pop()
        for(const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const absolutePath = path.join(current, entry.name)
            if(entry.isDirectory()) {
                pending.push(absolutePath)
            } else if(entry.isFile()) {
                result.push(absolutePath)
            }
        }
    }
    return result.sort()
}

function packModules(instanceDirectory, baseUrl, repositoryRoot, optionalMods) {
    if(instanceDirectory == null) {
        return []
    }
    const optional = new Set(optionalMods)
    const roots = ['mods', 'config', 'defaultconfigs', 'resourcepacks']
    return roots.flatMap(root => collectFiles(instanceDirectory, root).map(file => {
        const relativePath = path.relative(instanceDirectory, file).replaceAll('\\', '/')
        copyToRepository(file, repositoryRoot, `instance/${relativePath}`)
        if(root === 'mods' && path.extname(file).toLowerCase() === '.jar') {
            const safeName = path.basename(file, path.extname(file)).toLowerCase().replace(/[^a-z0-9_.-]+/g, '-')
            const checksum = md5(file)
            return {
                id: `local.neoforge:${safeName}:${checksum.substring(0, 12)}`,
                name: path.basename(file),
                type: 'NeoForgeMod',
                ...(optional.has(path.basename(file).toLowerCase()) ? {
                    required: { value: false, def: false }
                } : {}),
                artifact: artifact(file, `${baseUrl}/instance/${relativePath}`, relativePath)
            }
        }
        return {
            id: relativePath,
            name: path.basename(file),
            type: 'File',
            artifact: artifact(file, `${baseUrl}/instance/${relativePath}`, relativePath)
        }
    }))
}

function generateDistribution(options) {
    if(options.clientDir == null || options.versionId == null || options.baseUrl == null) {
        throw new Error('Required options: --client-dir, --version-id, and --base-url.')
    }
    const clientDirectory = path.resolve(options.clientDir)
    const baseUrl = normalizeUrl(options.baseUrl)
    const manifestPath = path.join(clientDirectory, 'versions', options.versionId, `${options.versionId}.json`)
    if(!fs.existsSync(manifestPath)) {
        throw new Error(`NeoForge version manifest not found: ${manifestPath}`)
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const minecraftVersion = manifest.inheritsFrom
    const neoForgeVersion = getArgumentValue(manifest.arguments.game, '--fml.neoForgeVersion')
    const neoFormVersion = getArgumentValue(manifest.arguments.game, '--fml.neoFormVersion')
    if(manifest.mainClass !== 'cpw.mods.bootstraplauncher.BootstrapLauncher') {
        throw new Error(`Unexpected NeoForge main class: ${manifest.mainClass}`)
    }
    if(minecraftVersion !== '1.21.1') {
        throw new Error(`This generator is pinned to Minecraft 1.21.1; received ${minecraftVersion}.`)
    }

    const repositoryRoot = options.repoDir == null ? null : path.resolve(options.repoDir)
    // FML's production client provider expects the installer-generated SRG
    // client as the top-level launch artifact. The NeoForge "client" artifact
    // is a merged output whose automatic module name collides with the
    // universal NeoForge module and does not register Minecraft as a mod.
    const loaderId = `net.minecraft:client:${minecraftVersion}-${neoFormVersion}:srg`
    const loader = libraryModule(clientDirectory, `${baseUrl}/repo`, loaderId, {
        name: `NeoForge ${neoForgeVersion}`,
        type: 'NeoForge',
        repositoryRoot: repositoryRoot == null ? null : path.join(repositoryRoot, 'repo')
    })

    copyToRepository(manifestPath, repositoryRoot == null ? null : path.join(repositoryRoot, 'repo'), `versions/${manifest.id}/${manifest.id}.json`)
    loader.subModules = [{
        id: manifest.id,
        name: `NeoForge ${neoForgeVersion} version manifest`,
        type: 'VersionManifest',
        artifact: artifact(manifestPath, `${baseUrl}/repo/versions/${manifest.id}/${manifest.id}.json`)
    }]

    const generatedLibraries = [
        `net.neoforged:neoforge:${neoForgeVersion}:universal`,
        `net.minecraft:client:${minecraftVersion}-${neoFormVersion}:slim`,
        `net.minecraft:client:${minecraftVersion}-${neoFormVersion}:extra`
    ]
    for(const identifier of generatedLibraries) {
        loader.subModules.push(libraryModule(clientDirectory, `${baseUrl}/repo`, identifier, {
            name: `NeoForge runtime (${identifier.split(':')[1]} ${identifier.split(':').at(-1)})`,
            classpath: false,
            repositoryRoot: repositoryRoot == null ? null : path.join(repositoryRoot, 'repo')
        }))
    }

    for(const library of manifest.libraries) {
        const relativePath = library.downloads?.artifact?.path
        if(relativePath == null) {
            throw new Error(`NeoForge library ${library.name} has no artifact path.`)
        }
        const source = path.join(clientDirectory, 'libraries', ...relativePath.split('/'))
        if(!fs.existsSync(source)) {
            throw new Error(`NeoForge manifest library is missing: ${source}`)
        }
        copyToRepository(source, repositoryRoot == null ? null : path.join(repositoryRoot, 'repo'), `libraries/${relativePath}`)
        loader.subModules.push({
            id: library.name,
            name: `NeoForge library (${library.name.split(':')[1]})`,
            type: 'Library',
            artifact: artifact(source, `${baseUrl}/repo/libraries/${relativePath}`)
        })
    }

    const instanceModules = packModules(
        options.instanceDir == null ? null : path.resolve(options.instanceDir),
        baseUrl,
        repositoryRoot,
        options.optionalMods ?? []
    )

    return {
        version: options.distributionVersion ?? '1.0.0',
        servers: [{
            id: options.serverId ?? 'youer-1.21.1',
            name: options.serverName ?? 'Youer 1.21.1 Hybrid Server',
            description: options.serverDescription ?? 'Minecraft 1.21.1 NeoForge hybrid server powered by Youer',
            icon: options.serverIcon ?? 'https://example.invalid/server-icon.png',
            version: options.modpackVersion ?? '1.0.0',
            address: options.serverAddress ?? 'mc.example.invalid:25565',
            minecraftVersion,
            javaOptions: {
                distribution: 'TEMURIN',
                supported: '21.x',
                suggestedMajor: 21,
                platformOptions: [{
                    platform: 'win32',
                    architecture: 'x64',
                    distribution: 'TEMURIN',
                    supported: '21.x',
                    suggestedMajor: 21
                }],
                ram: {
                    minimum: 2048,
                    recommended: 4096
                }
            },
            mainServer: true,
            autoconnect: true,
            modules: [loader, ...instanceModules]
        }]
    }
}

function main() {
    const options = parseArguments(process.argv.slice(2))
    const distribution = generateDistribution(options)
    const json = `${JSON.stringify(distribution, null, 4)}\n`
    if(options.output == null) {
        process.stdout.write(json)
    } else {
        const output = path.resolve(options.output)
        fs.mkdirSync(path.dirname(output), { recursive: true })
        fs.writeFileSync(output, json)
        console.log(`Wrote ${output}`)
    }
}

if(require.main === module) {
    try {
        main()
    } catch(error) {
        console.error(error.message)
        process.exitCode = 1
    }
}

module.exports = {
    generateDistribution,
    mavenPath,
    parseArguments
}
