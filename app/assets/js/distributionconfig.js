function resolveDistributionUrl(environment = process.env, launcherConfig = {}) {
    const configured = environment.HELIOS_DISTRIBUTION_URL || launcherConfig.distributionUrl
    if(typeof configured !== 'string' || configured.length === 0) {
        throw new Error('The launcher distribution URL is not configured.')
    }
    const parsed = new URL(configured)
    if(parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
        throw new Error('The launcher distribution URL must be an HTTPS URL without credentials or a fragment.')
    }
    return parsed.toString()
}

module.exports = {
    resolveDistributionUrl
}
