function selectAvailableServer(distribution, selectedId, preferredId) {
    const selected = typeof selectedId === 'string'
        ? distribution.getServerById(selectedId)
        : null
    if(selected != null) {
        return selected
    }
    const preferred = typeof preferredId === 'string'
        ? distribution.getServerById(preferredId)
        : null
    return preferred || distribution.servers[0] || null
}

module.exports = { selectAvailableServer }
