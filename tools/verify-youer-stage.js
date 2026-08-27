const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const projectPins = path.resolve(__dirname, '..', 'services', 'youer-artifacts.json')
const bundledPins = path.resolve(__dirname, '..', 'PinnedArtifacts.json')
const pinsPath = fs.existsSync(projectPins) ? projectPins : bundledPins
const pins = JSON.parse(fs.readFileSync(pinsPath, 'utf8'))

function parseArguments(argv) {
    const options = {}
    for(let index = 0; index < argv.length; index++) {
        const key = argv[index]
        if(key !== '--server-dir' && key !== '--java') {
            throw new Error(`Unexpected argument: ${key}`)
        }
        const value = argv[++index]
        if(value == null || value.startsWith('--')) {
            throw new Error(`Missing value for ${key}`)
        }
        options[key === '--server-dir' ? 'serverDir' : 'java'] = value
    }
    if(options.serverDir == null) {
        throw new Error('--server-dir is required.')
    }
    return options
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function verifyFile(root, relativePath, expectedSize, expectedHash) {
    const file = path.join(root, ...relativePath.split('/'))
    if(!fs.existsSync(file)) {
        throw new Error(`Required staging artifact is missing: ${relativePath}`)
    }
    const size = fs.statSync(file).size
    if(size !== expectedSize) {
        throw new Error(`${relativePath} size mismatch: expected ${expectedSize}, received ${size}.`)
    }
    const digest = sha256(file)
    if(digest !== expectedHash) {
        throw new Error(`${relativePath} SHA-256 mismatch.`)
    }
    return file
}

function assertIncludes(output, expected, description) {
    if(!output.includes(expected)) {
        throw new Error(`Youer smoke output did not confirm ${description}.`)
    }
}

function verifyStaticStage(serverDirectory) {
    const root = path.resolve(serverDirectory)
    const serverJar = verifyFile(
        root,
        pins.youer.serverJar,
        pins.youer.serverJarSize,
        pins.youer.serverJarSha256
    )
    verifyFile(
        root,
        `plugins/${pins.authMe.jarName}`,
        pins.authMe.jarSize,
        pins.authMe.jarSha256
    )
    verifyFile(
        root,
        `plugins/${pins.packetEvents.jarName}`,
        pins.packetEvents.jarSize,
        pins.packetEvents.jarSha256
    )
    for(const relativePath of [
        `mods/${pins.helios.companionJar}`,
        `plugins/${pins.helios.bridgeJar}`
    ]) {
        if(!fs.existsSync(path.join(root, ...relativePath.split('/')))) {
            throw new Error(`Required Helios component is missing: ${relativePath}`)
        }
    }
    const eulaPath = path.join(root, 'eula.txt')
    const eula = fs.existsSync(eulaPath) ? fs.readFileSync(eulaPath, 'utf8') : ''
    if(/^\s*eula=true\s*$/mi.test(eula)) {
        throw new Error('This verifier is intentionally pre-EULA and refuses to start an accepted server.')
    }
    return { root, serverJar }
}

function runPreEulaSmoke(options) {
    const stage = verifyStaticStage(options.serverDir)
    const java = options.java ?? 'java'
    const result = spawnSync(java, ['-jar', stage.serverJar, '--help'], {
        cwd: stage.root,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        shell: false,
        timeout: 180000,
        windowsHide: true
    })
    if(result.error != null) {
        throw result.error
    }
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    assertIncludes(output, `Thanks for using Youer - ${pins.minecraftVersion}-${pins.youer.build}`, 'the pinned Youer build')
    assertIncludes(output, `--fml.neoForgeVersion, ${pins.neoForge.version}`, 'the pinned NeoForge version')
    assertIncludes(output, `Found mod file "${pins.helios.companionJar}"`, 'the Helios companion mod')
    assertIncludes(output, 'You need to agree to the EULA', 'the pre-EULA stop gate')
    return {
        java,
        neoForgeVersion: pins.neoForge.version,
        serverDirectory: stage.root,
        youerBuild: pins.youer.build
    }
}

function main() {
    const result = runPreEulaSmoke(parseArguments(process.argv.slice(2)))
    console.log(`Verified Youer ${result.youerBuild} / NeoForge ${result.neoForgeVersion} pre-EULA runtime with ${result.java}.`)
}

if(require.main === module) {
    try {
        main()
    } catch(error) {
        console.error(error.message)
        process.exitCode = 1
    }
}

module.exports = { parseArguments, runPreEulaSmoke, sha256, verifyFile, verifyStaticStage }
