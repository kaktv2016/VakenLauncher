const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const AdmZip = require('adm-zip')

const projectRoot = path.resolve(__dirname, '..')
const outputPath = path.join(projectRoot, 'dist', 'Helios-Youer-Server-Bundle-0.1.0.zip')

const files = [
    {
        archivePath: 'plugins/youer-authme-bridge-0.1.0.jar',
        sourcePath: 'services/youer-authme-bridge/target/youer-authme-bridge-0.1.0.jar'
    },
    {
        archivePath: 'mods/helios_sso-0.1.0.jar',
        sourcePath: 'services/neoforge-sso-companion/build/libs/helios_sso-0.1.0.jar'
    },
    {
        archivePath: 'config/helios_sso.properties.example',
        sourcePath: 'services/neoforge-sso-companion/helios_sso.properties.example'
    },
    {
        archivePath: 'plugins/HeliosAuthBridge/config.yml.example',
        sourcePath: 'services/youer-authme-bridge/src/main/resources/config.yml'
    },
    {
        archivePath: 'auth-backend/.env.example',
        sourcePath: 'services/auth-backend/.env.example'
    },
    {
        archivePath: 'auth-backend/package.json',
        sourcePath: 'services/auth-backend/package.json'
    },
    {
        archivePath: 'README.md',
        sourcePath: 'docs/LocalAuth.md'
    },
    {
        archivePath: 'AuthenticationArchitecture.md',
        sourcePath: 'docs/AuthenticationArchitecture.md'
    },
    {
        archivePath: 'PinnedArtifacts.json',
        sourcePath: 'services/youer-artifacts.json'
    },
    {
        archivePath: 'tools/verify-youer-stage.js',
        sourcePath: 'tools/verify-youer-stage.js'
    }
]

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex')
}

function addBackendSources(entries) {
    const sourceRoot = path.join(projectRoot, 'services', 'auth-backend', 'src')
    for(const name of fs.readdirSync(sourceRoot).sort()) {
        if(name.endsWith('.js')) {
            entries.push({
                archivePath: `auth-backend/src/${name}`,
                sourcePath: path.join('services', 'auth-backend', 'src', name)
            })
        }
    }
}

function createServerBundle(destination = outputPath) {
    const entries = [...files]
    addBackendSources(entries)
    const zip = new AdmZip()
    const checksums = []
    for(const entry of entries.sort((left, right) => left.archivePath.localeCompare(right.archivePath))) {
        const absolute = path.join(projectRoot, entry.sourcePath)
        if(!fs.existsSync(absolute)) {
            throw new Error(`Required server bundle input is missing: ${entry.sourcePath}`)
        }
        const contents = fs.readFileSync(absolute)
        zip.addFile(entry.archivePath, contents)
        checksums.push(`${sha256(contents)}  ${entry.archivePath}`)
    }
    zip.addFile('SHA256SUMS', Buffer.from(`${checksums.join('\n')}\n`, 'utf8'))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    zip.writeZip(destination)
    return destination
}

if(require.main === module) {
    try {
        console.log(createServerBundle())
    } catch(error) {
        console.error(error.message)
        process.exitCode = 1
    }
}

module.exports = { createServerBundle, files, outputPath }
