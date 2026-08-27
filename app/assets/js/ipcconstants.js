const launcherConfig = require('../launcher-config.json')

exports.AUTH_API_BASE_URL = process.env.HELIOS_AUTH_API_BASE_URL || launcherConfig.authApiBaseUrl
exports.SERVER_ID = process.env.HELIOS_SERVER_ID || launcherConfig.serverId


// Opcodes
exports.SECRET_OPCODE = {
    PROTECT: 'SECRET_PROTECT',
    UNPROTECT: 'SECRET_UNPROTECT'
}

exports.SHELL_OPCODE = {
    TRASH_ITEM: 'TRASH_ITEM'
}
