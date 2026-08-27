const ejs = require('ejs')
const fs = require('fs')
const mime = require('mime')

let templateData = {}

function data(key, value) {
    if(typeof key === 'object' && key != null && !Array.isArray(key)) {
        templateData = { ...key }
        return
    }
    if(typeof key !== 'string') {
        throw new TypeError('Template data key must be a string or object.')
    }
    if(arguments.length === 1) {
        return templateData[key]
    }
    templateData[key] = value
}

function resolveFileRequest(requestUrl) {
    const parsed = new URL(requestUrl)
    if(parsed.protocol !== 'file:' || parsed.username || parsed.password || parsed.host) {
        throw new Error('Unsupported template request URL.')
    }
    let pathname = decodeURIComponent(parsed.pathname)
    if(process.platform === 'win32' && /^\/[A-Za-z]:\//.test(pathname)) {
        pathname = pathname.slice(1)
    }
    return pathname
}

function renderTemplate(pathname, values = templateData) {
    return ejs.render(fs.readFileSync(pathname, 'utf8'), values, { filename: pathname })
}

async function handleFileRequest(request) {
    try {
        const pathname = resolveFileRequest(request.url)
        const extension = pathname.slice(pathname.lastIndexOf('.')).toLowerCase()
        const body = extension === '.ejs'
            ? Buffer.from(renderTemplate(pathname))
            : fs.readFileSync(pathname)
        return new Response(body, {
            headers: { 'content-type': extension === '.ejs' ? 'text/html' : mime.getType(extension) || 'application/octet-stream' }
        })
    } catch(error) {
        const missing = error?.code === 'ENOENT'
        return new Response(null, {
            status: missing ? 404 : 500,
            statusText: missing ? 'Not Found' : 'Template Error'
        })
    }
}

function install(app, protocol) {
    const register = () => protocol.handle('file', handleFileRequest)
    if(app.isReady()) {
        register()
    } else {
        app.once('ready', register)
    }
}

module.exports = {
    data,
    handleFileRequest,
    install,
    renderTemplate,
    resolveFileRequest
}
