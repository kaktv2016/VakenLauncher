const assert = require('node:assert/strict')
const test = require('node:test')

const { resolveGitHubRepository } = require('../app/assets/js/releaseconfig')

test('disables updates when no release repository is configured', () => {
    assert.equal(resolveGitHubRepository({}), null)
    assert.equal(resolveGitHubRepository({ updateRepository: '' }), null)
})

test('derives GitHub update and release-note endpoints from one repository URL', () => {
    assert.deepEqual(resolveGitHubRepository({
        updateRepository: 'https://github.com/example/mmorpg-launcher'
    }), {
        atomUrl: 'https://github.com/example/mmorpg-launcher/releases.atom',
        issuesUrl: 'https://github.com/example/mmorpg-launcher/issues',
        owner: 'example',
        repo: 'mmorpg-launcher',
        webUrl: 'https://github.com/example/mmorpg-launcher'
    })
})

test('rejects unsafe or ambiguous update repository URLs', () => {
    assert.throws(() => resolveGitHubRepository({ updateRepository: 'http://github.com/a/b' }))
    assert.throws(() => resolveGitHubRepository({ updateRepository: 'https://user@github.com/a/b' }))
    assert.throws(() => resolveGitHubRepository({ updateRepository: 'https://github.com/a/b/releases' }))
    assert.throws(() => resolveGitHubRepository({ updateRepository: 'https://example.com/a/b' }))
})
