const childProcess = require('child_process')
const fs = require('fs')
const net = require('net')
const path = require('path')
const { start: startAuthBackend } = require('./start-auth-backend-staging')
const { createServer: createDistributionServer } = require('./serve-neoforge-staging')

const projectRoot = path.resolve(__dirname, '..')

function parseArguments(argv) {
    const parsed = {}
    for(let index = 0; index < argv.length; index += 2) {
        const option = argv[index]
        const value = argv[index + 1]
        if(value == null || value.startsWith('--')) {
            throw new Error(`Missing value for ${option || 'launcher option'}.`)
        }
        if(option === '--server-root') {
            parsed.serverRoot = path.resolve(value)
        } else {
            throw new Error(`Unknown option: ${option}`)
        }
    }
    if(parsed.serverRoot == null) {
        throw new Error('Required option: --server-root C:\\path\\to\\server')
    }
    return parsed
}

function parseServerRoot(argv) {
    return parseArguments(argv).serverRoot
}

function stagingEnvironment(serverRoot, environment = process.env) {
    const runtimePath = path.join(serverRoot, '_helios', 'runtime.json')
    const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'))
    if(typeof runtime.serverId !== 'string' || runtime.serverId.length === 0
        || typeof runtime.caCertPath !== 'string' || !fs.existsSync(runtime.caCertPath)) {
        throw new Error('The server runtime is missing its server ID or CA certificate.')
    }
    return {
        ...environment,
        HELIOS_AUTH_API_BASE_URL: 'https://127.0.0.1:8443',
        HELIOS_DISTRIBUTION_URL: 'https://127.0.0.1:9443/distribution.json',
        HELIOS_LANGUAGE: 'th_TH',
        HELIOS_SERVER_ID: runtime.serverId,
        NODE_EXTRA_CA_CERTS: runtime.caCertPath
    }
}

function portIsOpen(port, host = '127.0.0.1') {
    return new Promise(resolve => {
        const socket = net.createConnection({ host, port })
        socket.setTimeout(500)
        socket.once('connect', () => {
            socket.destroy()
            resolve(true)
        })
        socket.once('error', () => resolve(false))
        socket.once('timeout', () => {
            socket.destroy()
            resolve(false)
        })
    })
}

async function waitForPort(port, child, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs
    while(Date.now() < deadline) {
        if(await portIsOpen(port)) {
            return
        }
        if(child.exitCode != null) {
            throw new Error(`Local authentication backend exited with code ${child.exitCode}.`)
        }
        await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Local authentication backend did not open port ${port}.`)
}

function startDistributionServer(serverRoot) {
    const runtimePath = path.join(serverRoot, '_helios', 'runtime.json')
    const repositoryRoot = path.join(serverRoot, '_helios', 'phase1', 'cdn')
    const distributionPath = path.join(repositoryRoot, 'distribution.json')
    const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'))
    const distribution = JSON.parse(fs.readFileSync(distributionPath, 'utf8'))
    if(!Array.isArray(distribution.servers) || distribution.servers.length !== 1
        || distribution.servers[0].id !== runtime.serverId
        || distribution.servers[0].minecraftVersion !== '1.21.1') {
        throw new Error('The staging distribution must contain only the configured Minecraft 1.21.1 server.')
    }
    const server = createDistributionServer({ repositoryRoot, runtime })
    return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(9443, '127.0.0.1', () => {
            server.off('error', reject)
            console.log('NeoForge staging distribution started on https://127.0.0.1:9443.')
            resolve(server)
        })
    })
}

async function main() {
    const { serverRoot } = parseArguments(process.argv.slice(2))
    let authBackend = null
    if(!await portIsOpen(8443)) {
        authBackend = startAuthBackend(serverRoot, { detached: false, stdio: 'inherit' })
        await waitForPort(8443, authBackend)
    }
    const distributionServer = await portIsOpen(9443)
        ? null
        : await startDistributionServer(serverRoot)
    const electron = require('electron')
    const child = childProcess.spawn(electron, ['.'], {
        cwd: projectRoot,
        env: stagingEnvironment(serverRoot),
        stdio: 'inherit'
    })
    child.on('error', error => {
        console.error(error.message)
        process.exitCode = 1
    })
    child.on('exit', code => {
        if(authBackend != null && authBackend.exitCode == null) {
            authBackend.kill()
        }
        distributionServer?.close()
        process.exitCode = code ?? 1
    })
}

if(require.main === module) {
    main().catch(error => {
        console.error(error.message)
        process.exitCode = 1
    })
}

module.exports = {
    parseArguments,
    parseServerRoot,
    portIsOpen,
    startDistributionServer,
    stagingEnvironment
}
