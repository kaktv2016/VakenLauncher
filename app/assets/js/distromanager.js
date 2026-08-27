const { DistributionAPI } = require('helios-core/common')

const ConfigManager = require('./configmanager')
const launcherConfig = require('../launcher-config.json')
const { resolveDistributionUrl } = require('./distributionconfig')

exports.REMOTE_DISTRO_URL = resolveDistributionUrl(process.env, launcherConfig)

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

exports.DistroAPI = api
