function retainLocalAuthentication(source) {
    const database = source.authenticationDatabase != null
        && typeof source.authenticationDatabase === 'object'
        ? source.authenticationDatabase
        : {}
    source.authenticationDatabase = Object.fromEntries(
        Object.entries(database).filter(([, account]) => account?.type === 'local')
    )
    if(source.authenticationDatabase[source.selectedAccount] == null) {
        source.selectedAccount = Object.keys(source.authenticationDatabase)[0] || null
    }
    delete source.clientToken
    return source
}

module.exports = { retainLocalAuthentication }
