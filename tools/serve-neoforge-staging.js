const fs = require('fs')
const https = require('https')
const path = require('path')

const MIME_TYPES = {
    '.jar': 'application/java-archive',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.properties': 'text/plain; charset=utf-8',
    '.toml': 'text/plain; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.zip': 'application/zip'
}

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
    return options
}

function resolveFile(root, requestUrl) {
    const request = new URL(requestUrl, 'https://127.0.0.1')
    const decoded = decodeURIComponent(request.pathname)
    if(decoded.includes('\0')) {
        throw new Error('Invalid path.')
    }
    const relative = decoded === '/' ? 'distribution.json' : decoded.replace(/^\/+/, '')
    const resolved = path.resolve(root, relative)
    if(resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error('Path escapes the staging root.')
    }
    return resolved
}

function createServer({ repositoryRoot, runtime }) {
    const root = path.resolve(repositoryRoot)
    const pfxPath = path.resolve(runtime.pfxPath)
    if(!fs.statSync(root).isDirectory() || !fs.statSync(pfxPath).isFile()) {
        throw new Error('The repository root and TLS PFX must exist.')
    }
    return https.createServer({
        minVersion: 'TLSv1.2',
        passphrase: runtime.pfxPassword,
        pfx: fs.readFileSync(pfxPath)
    }, (request, response) => {
        if(request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405, { Allow: 'GET, HEAD' })
            response.end()
            return
        }
        let file
        try {
            file = resolveFile(root, request.url)
        } catch(_error) {
            response.writeHead(400)
            response.end()
            return
        }
        fs.stat(file, (error, stats) => {
            if(error != null || !stats.isFile()) {
                response.writeHead(404)
                response.end()
                return
            }
            response.writeHead(200, {
                'Cache-Control': 'no-store',
                'Content-Length': stats.size,
                'Content-Type': MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
                'X-Content-Type-Options': 'nosniff'
            })
            if(request.method === 'HEAD') {
                response.end()
                return
            }
            const stream = fs.createReadStream(file)
            stream.on('error', () => response.destroy())
            stream.pipe(response)
        })
    })
}

function main() {
    const options = parseArguments(process.argv.slice(2))
    if(options.root == null || options.runtime == null) {
        throw new Error('Required options: --root and --runtime.')
    }
    const runtime = JSON.parse(fs.readFileSync(path.resolve(options.runtime), 'utf8'))
    const port = Number.parseInt(options.port || '9443')
    if(!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('The HTTPS port must be between 1 and 65535.')
    }
    const server = createServer({ repositoryRoot: options.root, runtime })
    server.listen(port, '127.0.0.1', () => {
        console.log(`NeoForge staging distribution available at https://127.0.0.1:${port}/distribution.json`)
    })
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
    createServer,
    parseArguments,
    resolveFile
}
