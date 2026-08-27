const childProcess = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const https = require('https')
const os = require('os')
const path = require('path')
const AdmZip = require('adm-zip')

const GRADLE_VERSION = '9.2.1'
const GRADLE_SHA256 = '72f44c9f8ebcb1af43838f45ee5c4aa9c5444898b3468ab3f4af7b6076c5bc3f'
const GRADLE_URL = `https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip`
const cacheRoot = path.join(os.tmpdir(), 'helios-launcher-build-tools')
const gradleRoot = path.join(cacheRoot, `gradle-${GRADLE_VERSION}`)
const gradleCommand = path.join(gradleRoot, 'bin', process.platform === 'win32' ? 'gradle.bat' : 'gradle')
const modRoot = path.resolve(__dirname, '..', 'services', 'neoforge-sso-companion')

function download(url, destination) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, response => {
            if(response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume()
                download(new URL(response.headers.location, url), destination).then(resolve, reject)
                return
            }
            if(response.statusCode !== 200) {
                response.resume()
                reject(new Error(`Gradle download failed with HTTP ${response.statusCode}.`))
                return
            }
            const output = fs.createWriteStream(destination, { mode: 0o600 })
            response.pipe(output)
            output.on('finish', () => output.close(resolve))
            output.on('error', reject)
        })
        request.on('error', reject)
    })
}

async function ensureGradle() {
    if(fs.existsSync(gradleCommand)) {
        return
    }
    fs.mkdirSync(cacheRoot, { recursive: true })
    const archive = path.join(cacheRoot, `gradle-${GRADLE_VERSION}-bin.zip`)
    await download(GRADLE_URL, archive)
    const digest = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
    if(digest !== GRADLE_SHA256) {
        throw new Error('Downloaded Gradle archive failed SHA-256 verification.')
    }
    new AdmZip(archive).extractAllTo(cacheRoot, true)
    if(!fs.existsSync(gradleCommand)) {
        throw new Error('Gradle archive did not contain the expected executable.')
    }
}

async function main() {
    await ensureGradle()
    const command = process.platform === 'win32' ? process.env.ComSpec : gradleCommand
    const args = process.platform === 'win32'
        ? ['/d', '/s', '/c', `call ${gradleCommand} --no-daemon clean build`]
        : ['--no-daemon', 'clean', 'build']
    const result = childProcess.spawnSync(command, args, {
        cwd: modRoot,
        encoding: 'utf8',
        stdio: 'inherit'
    })
    if(result.error) {
        throw result.error
    }
    process.exitCode = result.status
}

main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
})
