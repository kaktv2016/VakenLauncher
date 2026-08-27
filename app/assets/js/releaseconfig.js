function resolveGitHubRepository(config = {}) {
    const configured = config.updateRepository
    if(typeof configured !== 'string' || configured.length === 0) {
        return null
    }
    const parsed = new URL(configured)
    const parts = parsed.pathname.split('/').filter(Boolean)
    if(parsed.protocol !== 'https:' || parsed.hostname !== 'github.com'
        || parsed.username || parsed.password || parsed.hash || parsed.search
        || parts.length !== 2) {
        throw new Error('updateRepository must be an HTTPS GitHub owner/repository URL.')
    }
    const owner = parts[0]
    const repo = parts[1].replace(/\.git$/i, '')
    if(owner.length === 0 || repo.length === 0) {
        throw new Error('updateRepository must include both a GitHub owner and repository.')
    }
    const webUrl = `https://github.com/${owner}/${repo}`
    return {
        atomUrl: `${webUrl}/releases.atom`,
        issuesUrl: `${webUrl}/issues`,
        owner,
        repo,
        webUrl
    }
}

module.exports = { resolveGitHubRepository }
