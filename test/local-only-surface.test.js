const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const projectRoot = path.resolve(__dirname, '..')
const textExtensions = new Set(['.css', '.ejs', '.java', '.js', '.json', '.toml', '.yml'])
const forbiddenRuntimeAuth = /\bMicrosoft\b|MSFT_|AZURE_CLIENT|\bXbox\b|\bXSTS\b|microsoftClientId|login\.microsoftonline\.com|\/auth\/microsoft\//i

function sourceFiles(target) {
    const absolute = path.join(projectRoot, target)
    if(fs.statSync(absolute).isFile()) {
        return [absolute]
    }
    return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
        if(entry.name === 'node_modules' || entry.name === 'target' || entry.name === 'build') {
            return []
        }
        const child = path.join(absolute, entry.name)
        return entry.isDirectory()
            ? sourceFiles(path.relative(projectRoot, child))
            : (textExtensions.has(path.extname(entry.name)) ? [child] : [])
    })
}

test('launcher and authentication services contain only the Local account flow', () => {
    const files = [
        ...sourceFiles('app'),
        ...sourceFiles('services/auth-backend/src'),
        ...sourceFiles('services/youer-authme-bridge/src/main'),
        ...sourceFiles('tools'),
        path.join(projectRoot, 'index.js')
    ]
    const violations = files
        .filter(file => path.basename(file) !== 'apply-dependency-patches.js')
        .filter(file => forbiddenRuntimeAuth.test(fs.readFileSync(file, 'utf8')))
        .map(file => path.relative(projectRoot, file))
    assert.deepEqual(violations, [])
})

test('every Launcher page omits external-account controls and keeps the Local action', () => {
    const templates = sourceFiles('app').filter(file => path.extname(file) === '.ejs')
    const source = templates.map(file => fs.readFileSync(file, 'utf8')).join('\n')
    assert.equal(forbiddenRuntimeAuth.test(source), false)
    assert.match(source, /id="loginOptionLocal"/)
    assert.match(source, /id="settingsAddLocalAccount"/)
})
