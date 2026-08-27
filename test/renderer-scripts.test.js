const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const projectRoot = path.resolve(__dirname, '..')
const rendererScripts = [
    'app/assets/js/scripts/uicore.js',
    'app/assets/js/scripts/uibinder.js',
    'app/assets/js/scripts/welcome.js',
    'app/assets/js/scripts/login.js',
    'app/assets/js/scripts/loginOptions.js',
    'app/assets/js/scripts/settings.js',
    'app/assets/js/scripts/landing.js',
    'app/assets/js/scripts/overlay.js'
]

test('renderer scripts compile together without global lexical declaration conflicts', () => {
    const source = rendererScripts.map(relativePath => {
        const absolutePath = path.join(projectRoot, ...relativePath.split('/'))
        return `\n// ${relativePath}\n${fs.readFileSync(absolutePath, 'utf8')}`
    }).join('\n')

    assert.doesNotThrow(() => new vm.Script(source, { filename: 'helios-renderer-bundle.js' }))
})
