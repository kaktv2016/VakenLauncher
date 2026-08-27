const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const projectRoot = path.resolve(__dirname, '..')

test('helios-core REST logging excludes response bodies, headers, and raw errors', () => {
    const source = fs.readFileSync(path.join(
        projectRoot,
        'node_modules/helios-core/dist/common/rest/RestResponse.js'
    ), 'utf8')

    assert.doesNotMatch(source, /logger\.debug\('Body:'/)
    assert.doesNotMatch(source, /logger\.debug\('Headers:'/)
    assert.doesNotMatch(source, /logger\.error\([^\n]+, error\)/)
    assert.match(source, /error: safeError/)
})

test('installed helios-core exposes no Microsoft authentication module', () => {
    const coreRoot = path.join(projectRoot, 'node_modules', 'helios-core')
    const manifest = JSON.parse(fs.readFileSync(path.join(coreRoot, 'package.json'), 'utf8'))

    assert.equal(manifest.exports['./microsoft'], undefined)
    assert.equal(manifest.typesVersions['*'].microsoft, undefined)
    assert.equal(fs.existsSync(path.join(coreRoot, 'dist', 'microsoft')), false)
    assert.equal(fs.existsSync(path.join(coreRoot, 'dist', 'microsoft.js')), false)
    assert.equal(fs.existsSync(path.join(coreRoot, 'dist', 'microsoft.d.ts')), false)
})
