const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')

test('builds Windows installers and executables as VakenLauncher', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    const builder = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
    const customLanguage = fs.readFileSync(path.join(root, 'app', 'assets', 'lang', '_custom.toml'), 'utf8')

    assert.equal(manifest.name, 'vakenlauncher')
    assert.equal(manifest.productName, 'VakenLauncher')
    assert.match(builder, /^appId: 'vakenlauncher'$/m)
    assert.match(builder, /^productName: 'VakenLauncher'$/m)
    assert.match(builder, /^artifactName: '\$\{productName\}-setup-\$\{version\}\.\$\{ext\}'$/m)
    assert.match(customLanguage, /^title = "VakenLauncher"$/m)
})
