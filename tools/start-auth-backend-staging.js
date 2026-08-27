const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const projectRoot = path.resolve(__dirname, '..')

function serverRootFromArguments(argv) {
    if(argv.length !== 2 || argv[0] !== '--server-root') {
        throw new Error('Required option: --server-root C:\\path\\to\\server')
    }
    const root = path.resolve(argv[1])
    if(root === path.parse(root).root || !fs.statSync(root).isDirectory()) {
        throw new Error('The server root must be an existing non-root directory.')
    }
    return root
}

function backendEnvironment(serverRoot, environment = process.env) {
    const runtimePath = path.join(serverRoot, '_helios', 'runtime.json')
    const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'))
    return {
        ...environment,
        HELIOS_AUTH_DATABASE: runtime.backendDatabase,
        HELIOS_BRIDGE_SECRET: runtime.bridgeSecret,
        HELIOS_BRIDGE_URL: 'https://127.0.0.1:8765',
        HELIOS_EMAIL_ENABLED: 'false',
        HELIOS_EMAIL_REQUIRED: 'false',
        HELIOS_SERVER_ID: runtime.serverId,
        HELIOS_TLS_PFX: runtime.pfxPath,
        HELIOS_TLS_PFX_PASSWORD: runtime.pfxPassword,
        HELIOS_TOKEN_SECRET: runtime.tokenSecret,
        HELIOS_TRUST_PROXY: 'true',
        HOST: '127.0.0.1',
        NODE_EXTRA_CA_CERTS: runtime.caCertPath,
        PORT: '8443'
    }
}

function start(serverRoot, { detached = true, stdio = 'ignore' } = {}) {
    const serviceRoot = path.join(projectRoot, 'services', 'auth-backend')
    const child = spawn(process.execPath, ['src/server.js'], {
        cwd: serviceRoot,
        detached,
        env: backendEnvironment(serverRoot),
        stdio,
        windowsHide: true
    })
    if(detached) {
        child.unref()
    }
    console.log(`Helios Local authentication backend started with PID ${child.pid}.`)
    return child
}

if(require.main === module) {
    try {
        start(serverRootFromArguments(process.argv.slice(2)))
    } catch(error) {
        console.error(error.message)
        process.exitCode = 1
    }
}

module.exports = { backendEnvironment, serverRootFromArguments, start }
