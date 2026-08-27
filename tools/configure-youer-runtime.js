const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const pins = require('../services/youer-artifacts.json')

const projectRoot = path.resolve(__dirname, '..')

function parseArguments(argv) {
    const options = {}
    for(let index = 0; index < argv.length; index++) {
        const key = argv[index]
        if(!['--server-dir', '--packet-events', '--keytool'].includes(key)) {
            throw new Error(`Unexpected argument: ${key}`)
        }
        const value = argv[++index]
        if(value == null || value.startsWith('--')) {
            throw new Error(`Missing value for ${key}`)
        }
        const property = {
            '--keytool': 'keytool',
            '--packet-events': 'packetEvents',
            '--server-dir': 'serverDir'
        }[key]
        options[property] = value
    }
    for(const required of ['serverDir', 'packetEvents', 'keytool']) {
        if(options[required] == null) {
            throw new Error(`--${required.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)} is required.`)
        }
    }
    return options
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function verifyPinnedFile(file, expectedSize, expectedHash, label) {
    if(!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        throw new Error(`${label} is missing: ${file}`)
    }
    if(fs.statSync(file).size !== expectedSize || sha256(file) !== expectedHash) {
        throw new Error(`${label} does not match the pinned size and SHA-256.`)
    }
}

function backupTarget(serverRoot, backupRoot, relativePath) {
    const source = path.join(serverRoot, ...relativePath.split('/'))
    if(!fs.existsSync(source)) {
        return
    }
    const destination = path.join(backupRoot, ...relativePath.split('/'))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.cpSync(source, destination, { recursive: true })
}

function runKeytool(keytool, argumentsList) {
    const result = spawnSync(keytool, argumentsList, {
        encoding: 'utf8',
        shell: false,
        windowsHide: true
    })
    if(result.error != null) {
        throw result.error
    }
    if(result.status !== 0) {
        throw new Error(`keytool failed: ${(result.stderr || result.stdout).trim()}`)
    }
}

function protectFile(file) {
    fs.chmodSync(file, 0o600)
    if(process.platform !== 'win32') {
        return
    }
    const account = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
    const result = spawnSync('icacls.exe', [
        file,
        '/inheritance:r',
        '/grant:r',
        `${account}:(F)`,
        '/grant:r',
        '*S-1-5-18:(F)'
    ], { encoding: 'utf8', shell: false, windowsHide: true })
    if(result.status !== 0) {
        throw new Error(`Unable to restrict ACLs for ${file}.`)
    }
}

function writePrivateFile(file, contents) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents, { encoding: 'utf8', mode: 0o600 })
    protectFile(file)
}

function randomSecret() {
    return crypto.randomBytes(48).toString('base64url')
}

function escapePropertyValue(value) {
    return String(value)
        .replaceAll('\\', '\\\\')
        .replaceAll('\t', '\\t')
        .replaceAll('\n', '\\n')
        .replaceAll('\r', '\\r')
        .replaceAll('\f', '\\f')
}

function createCertificates(runtime, keytool) {
    const pfxExists = fs.existsSync(runtime.pfxPath)
    const certificateExists = fs.existsSync(runtime.caCertPath)
    if(pfxExists !== certificateExists) {
        throw new Error('Incomplete TLS identity exists; restore or remove the PKCS12 file and certificate before retrying.')
    }
    if(!pfxExists) {
        runKeytool(keytool, [
            '-genkeypair',
            '-alias', 'helios-loopback',
            '-keyalg', 'RSA',
            '-keysize', '3072',
            '-validity', '3650',
            '-dname', 'CN=localhost,OU=Helios Staging,O=Helios,L=Bangkok,C=TH',
            '-ext', 'SAN=dns:localhost,ip:127.0.0.1',
            '-storetype', 'PKCS12',
            '-keystore', runtime.pfxPath,
            '-storepass', runtime.pfxPassword,
            '-keypass', runtime.pfxPassword,
            '-noprompt'
        ])
        runKeytool(keytool, [
            '-exportcert',
            '-rfc',
            '-alias', 'helios-loopback',
            '-keystore', runtime.pfxPath,
            '-storepass', runtime.pfxPassword,
            '-file', runtime.caCertPath
        ])
    }

    const javaHome = path.dirname(path.dirname(keytool))
    const defaultTrustStore = path.join(javaHome, 'lib', 'security', 'cacerts')
    if(!fs.existsSync(defaultTrustStore)) {
        throw new Error(`The Java default truststore is missing: ${defaultTrustStore}`)
    }
    fs.copyFileSync(defaultTrustStore, runtime.trustStorePath)
    runKeytool(keytool, [
        '-storepasswd',
        '-keystore', runtime.trustStorePath,
        '-storepass', 'changeit',
        '-new', runtime.trustStorePassword
    ])
    runKeytool(keytool, [
        '-importcert',
        '-alias', 'helios-loopback',
        '-file', runtime.caCertPath,
        '-keystore', runtime.trustStorePath,
        '-storetype', 'PKCS12',
        '-storepass', runtime.trustStorePassword,
        '-noprompt'
    ])
    for(const file of [runtime.pfxPath, runtime.caCertPath, runtime.trustStorePath]) {
        protectFile(file)
    }
}

function configureRuntime(options) {
    const serverRoot = path.resolve(options.serverDir)
    if(serverRoot === path.parse(serverRoot).root || !fs.statSync(serverRoot).isDirectory()) {
        throw new Error('The server directory must be an existing non-root directory.')
    }
    const keytool = path.resolve(options.keytool)
    if(!fs.existsSync(keytool)) {
        throw new Error(`keytool is missing: ${keytool}`)
    }
    verifyPinnedFile(
        path.join(serverRoot, pins.youer.serverJar),
        pins.youer.serverJarSize,
        pins.youer.serverJarSha256,
        'Youer server JAR'
    )
    verifyPinnedFile(
        path.join(serverRoot, 'plugins', pins.authMe.jarName),
        pins.authMe.jarSize,
        pins.authMe.jarSha256,
        'AuthMe JAR'
    )
    const packetEventsSource = path.resolve(options.packetEvents)
    verifyPinnedFile(
        packetEventsSource,
        pins.packetEvents.jarSize,
        pins.packetEvents.jarSha256,
        'PacketEvents JAR'
    )

    const runtimeRoot = path.join(serverRoot, '_helios')
    const runtimeFile = path.join(runtimeRoot, 'runtime.json')
    const runtime = fs.existsSync(runtimeFile)
        ? JSON.parse(fs.readFileSync(runtimeFile, 'utf8'))
        : {
            backendDatabase: path.join(runtimeRoot, 'helios-auth.sqlite'),
            bridgeSecret: randomSecret(),
            caCertPath: path.join(runtimeRoot, 'loopback-cert.pem'),
            pfxPassword: randomSecret(),
            pfxPath: path.join(runtimeRoot, 'loopback.p12'),
            serverId: 'youer-main',
            tokenSecret: randomSecret(),
            trustStorePassword: randomSecret(),
            trustStorePath: path.join(runtimeRoot, 'truststore.p12')
        }
    runtime.trustStorePassword ??= randomSecret()
    for(const secret of ['bridgeSecret', 'pfxPassword', 'tokenSecret', 'trustStorePassword']) {
        if(typeof runtime[secret] !== 'string' || Buffer.byteLength(runtime[secret]) < 32) {
            throw new Error(`Invalid ${secret} in the existing runtime configuration.`)
        }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupRoot = path.join(serverRoot, '_backups', `helios-sso-${timestamp}`)
    fs.mkdirSync(backupRoot, { recursive: true })
    const managedTargets = [
        'config/helios_sso.properties',
        `mods/${pins.helios.companionJar}`,
        'plugins/HeliosAuthBridge',
        `plugins/${pins.helios.bridgeJar}`,
        `plugins/${pins.packetEvents.jarName}`
    ]
    for(const target of managedTargets) {
        backupTarget(serverRoot, backupRoot, target)
    }

    fs.mkdirSync(path.join(serverRoot, 'mods'), { recursive: true })
    fs.mkdirSync(path.join(serverRoot, 'plugins'), { recursive: true })
    fs.copyFileSync(
        path.join(projectRoot, 'services', 'neoforge-sso-companion', 'build', 'libs', pins.helios.companionJar),
        path.join(serverRoot, 'mods', pins.helios.companionJar)
    )
    fs.copyFileSync(
        path.join(projectRoot, 'services', 'youer-authme-bridge', 'target', pins.helios.bridgeJar),
        path.join(serverRoot, 'plugins', pins.helios.bridgeJar)
    )
    fs.copyFileSync(packetEventsSource, path.join(serverRoot, 'plugins', pins.packetEvents.jarName))

    fs.mkdirSync(runtimeRoot, { recursive: true })
    writePrivateFile(runtimeFile, `${JSON.stringify(runtime, null, 4)}\n`)
    createCertificates(runtime, keytool)

    const companionConfig = [
        'bridgeUrl=https://127.0.0.1:8765',
        `serverId=${escapePropertyValue(runtime.serverId)}`,
        `sharedSecret=${escapePropertyValue(runtime.bridgeSecret)}`,
        `trustStorePath=${escapePropertyValue(runtime.trustStorePath)}`,
        `trustStorePassword=${escapePropertyValue(runtime.trustStorePassword)}`,
        ''
    ].join('\n')
    writePrivateFile(path.join(serverRoot, 'config', 'helios_sso.properties'), companionConfig)

    const quoteYaml = value => `'${value.replaceAll('\'', '\'\'')}'`
    const bridgeConfig = [
        'bind-address: 127.0.0.1',
        'port: 8765',
        `tls-keystore-path: ${quoteYaml(runtime.pfxPath)}`,
        `tls-keystore-password: ${quoteYaml(runtime.pfxPassword)}`,
        `shared-secret: ${quoteYaml(runtime.bridgeSecret)}`,
        'request-clock-skew-seconds: 30',
        'backend-url: https://127.0.0.1:8443',
        `backend-truststore-path: ${quoteYaml(runtime.trustStorePath)}`,
        `backend-truststore-password: ${quoteYaml(runtime.trustStorePassword)}`,
        ''
    ].join('\n')
    writePrivateFile(path.join(serverRoot, 'plugins', 'HeliosAuthBridge', 'config.yml'), bridgeConfig)

    return { backupRoot, runtimeFile, runtimeRoot, serverRoot }
}

function main() {
    const result = configureRuntime(parseArguments(process.argv.slice(2)))
    console.log(`Configured the Helios runtime in ${result.serverRoot}`)
    console.log(`Backups: ${result.backupRoot}`)
    console.log(`Private runtime configuration: ${result.runtimeFile}`)
}

if(require.main === module) {
    try {
        main()
    } catch(error) {
        console.error(error.message)
        process.exitCode = 1
    }
}

module.exports = { configureRuntime, escapePropertyValue, parseArguments, sha256, verifyPinnedFile }
