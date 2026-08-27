const childProcess = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const https = require('https')
const os = require('os')
const path = require('path')
const AdmZip = require('adm-zip')

const MAVEN_VERSION = '3.9.16'
const MAVEN_SHA512 = 'ed41650d42485cfc243fad22158caf9cbb5dc408ce7a09ddb94dd42a019de929ca43065bfa450612cf12bf78b5cafa3884b96c090de326ff590448c933454af3'
const MAVEN_URL = `https://downloads.apache.org/maven/maven-3/${MAVEN_VERSION}/binaries/apache-maven-${MAVEN_VERSION}-bin.zip`
const cacheRoot = path.join(os.tmpdir(), 'vaken-launcher-build-tools')
const mavenRoot = path.join(cacheRoot, `apache-maven-${MAVEN_VERSION}`)
const mavenCommand = path.join(mavenRoot, 'bin', process.platform === 'win32' ? 'mvn.cmd' : 'mvn')
const bridgeRoot = path.resolve(__dirname, '..', 'services', 'youer-authme-bridge')

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
                reject(new Error(`Maven download failed with HTTP ${response.statusCode}.`))
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

async function ensureMaven() {
    if(fs.existsSync(mavenCommand)) {
        return
    }
    fs.mkdirSync(cacheRoot, { recursive: true })
    const archive = path.join(cacheRoot, `apache-maven-${MAVEN_VERSION}-bin.zip`)
    await download(MAVEN_URL, archive)
    const digest = crypto.createHash('sha512').update(fs.readFileSync(archive)).digest('hex')
    if(digest !== MAVEN_SHA512) {
        throw new Error('Downloaded Maven archive failed SHA-512 verification.')
    }
    new AdmZip(archive).extractAllTo(cacheRoot, true)
    if(!fs.existsSync(mavenCommand)) {
        throw new Error('Maven archive did not contain the expected executable.')
    }
}

async function main() {
    const goal = process.argv[2] === 'test' ? 'test' : 'package'
    await ensureMaven()
    const command = process.platform === 'win32' ? process.env.ComSpec : mavenCommand
    const args = process.platform === 'win32'
        ? ['/d', '/s', '/c', `call ${mavenCommand} -B clean ${goal}`]
        : ['-B', 'clean', goal]
    const result = childProcess.spawnSync(command, args, {
        cwd: bridgeRoot,
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
