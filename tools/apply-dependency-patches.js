const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')

function readPackageVersion(packageName) {
    const packagePath = path.join(projectRoot, 'node_modules', packageName, 'package.json')
    if(!fs.existsSync(packagePath)) {
        throw new Error(`${packageName} is not installed. Run npm install before applying patches.`)
    }
    return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version
}

function replaceOnce(file, before, after) {
    const absolutePath = path.join(projectRoot, file)
    const source = fs.readFileSync(absolutePath, 'utf8')
    if(source.includes(after)) {
        return false
    }
    const first = source.indexOf(before)
    if(first === -1 || source.indexOf(before, first + before.length) !== -1) {
        throw new Error(`Patch context is missing or ambiguous in ${file}. Dependency contents may have changed.`)
    }
    fs.writeFileSync(absolutePath, source.replace(before, after))
    return true
}

function assertVersion(packageName, expectedVersion) {
    const actualVersion = readPackageVersion(packageName)
    if(actualVersion !== expectedVersion) {
        throw new Error(`Unsupported ${packageName} version ${actualVersion}; expected ${expectedVersion}. Review the NeoForge patch before upgrading.`)
    }
}

function patchDistributionTypes() {
    assertVersion('helios-distribution-types', '1.3.0')
    const js = 'node_modules/helios-distribution-types/build/spec/type.js'
    const declarations = 'node_modules/helios-distribution-types/build/spec/type.d.ts'

    replaceOnce(js,
        '    Type["Fabric"] = "Fabric";\n    Type["LiteLoader"] = "LiteLoader";',
        '    Type["Fabric"] = "Fabric";\n    Type["NeoForge"] = "NeoForge";\n    Type["LiteLoader"] = "LiteLoader";')
    replaceOnce(js,
        '    Type["FabricMod"] = "FabricMod";\n    Type["LiteMod"] = "LiteMod";',
        '    Type["FabricMod"] = "FabricMod";\n    Type["NeoForgeMod"] = "NeoForgeMod";\n    Type["LiteMod"] = "LiteMod";')
    replaceOnce(js,
        '    Fabric: {\n        id: Type.Fabric,\n        defaultExtension: \'jar\'\n    },\n    LiteLoader:',
        '    Fabric: {\n        id: Type.Fabric,\n        defaultExtension: \'jar\'\n    },\n    NeoForge: {\n        id: Type.NeoForge,\n        defaultExtension: \'jar\'\n    },\n    LiteLoader:')
    replaceOnce(js,
        '    FabricMod: {\n        id: Type.FabricMod,\n        defaultExtension: \'jar\'\n    },\n    LiteMod:',
        '    FabricMod: {\n        id: Type.FabricMod,\n        defaultExtension: \'jar\'\n    },\n    NeoForgeMod: {\n        id: Type.NeoForgeMod,\n        defaultExtension: \'jar\'\n    },\n    LiteMod:')
    replaceOnce(declarations,
        '    Fabric = "Fabric",\n    LiteLoader = "LiteLoader",',
        '    Fabric = "Fabric",\n    NeoForge = "NeoForge",\n    LiteLoader = "LiteLoader",')
    replaceOnce(declarations,
        '    FabricMod = "FabricMod",\n    LiteMod = "LiteMod",',
        '    FabricMod = "FabricMod",\n    NeoForgeMod = "NeoForgeMod",\n    LiteMod = "LiteMod",')
}

function patchCore() {
    assertVersion('helios-core', '2.3.0')
    const factory = 'node_modules/helios-core/dist/common/distribution/DistributionFactory.js'
    const processor = 'node_modules/helios-core/dist/dl/distribution/DistributionIndexProcessor.js'
    const restResponse = 'node_modules/helios-core/dist/common/rest/RestResponse.js'
    const restResponseDeclarations = 'node_modules/helios-core/dist/common/rest/RestResponse.d.ts'

    replaceOnce(factory,
        '            case helios_distribution_types_1.Type.Fabric:\n            case helios_distribution_types_1.Type.LiteLoader:',
        '            case helios_distribution_types_1.Type.Fabric:\n            case helios_distribution_types_1.Type.NeoForge:\n            case helios_distribution_types_1.Type.LiteLoader:')
    replaceOnce(factory,
        '            case helios_distribution_types_1.Type.FabricMod:\n                return (0, path_1.join)(commonDir, \'mods\', \'fabric\', relativePath);',
        '            case helios_distribution_types_1.Type.FabricMod:\n                return (0, path_1.join)(commonDir, \'mods\', \'fabric\', relativePath);\n            case helios_distribution_types_1.Type.NeoForgeMod:\n                return (0, path_1.join)(instanceDir, this.serverId, \'mods\', (0, path_1.basename)(relativePath));')
    replaceOnce(processor,
        'type === helios_distribution_types_1.Type.ForgeHosted || type === helios_distribution_types_1.Type.Forge || type === helios_distribution_types_1.Type.Fabric',
        'type === helios_distribution_types_1.Type.ForgeHosted || type === helios_distribution_types_1.Type.Forge || type === helios_distribution_types_1.Type.Fabric || type === helios_distribution_types_1.Type.NeoForge')
    replaceOnce(processor,
        'if (modLoaderModule.rawModule.type === helios_distribution_types_1.Type.Fabric\n            || DistributionIndexProcessor.isForgeGradle3',
        'if (modLoaderModule.rawModule.type === helios_distribution_types_1.Type.Fabric\n            || modLoaderModule.rawModule.type === helios_distribution_types_1.Type.NeoForge\n            || DistributionIndexProcessor.isForgeGradle3')
    replaceOnce(restResponse,
        `    const response = {
        data: dataProvider(),
        responseStatus: RestResponseStatus.ERROR,
        error
    };
    if (error instanceof got_1.HTTPError) {
        logger.error(\`Error during \${operation} request (HTTP Response \${error.response.statusCode})\`, error);
        logger.debug('Response Details:');
        logger.debug(\`URL: \${error.request.requestUrl}\`);
        logger.debug('Body:', error.response.body);
        logger.debug('Headers:', error.response.headers);
    }
    else if (error.name === 'RequestError') {
        logger.error(\`\${operation} request received no response (\${error.code}).\`, error);
    }
    else if (error instanceof got_1.TimeoutError) {
        logger.error(\`\${operation} request timed out (\${error.timings.phases.total}ms).\`);
    }
    else if (error instanceof got_1.ParseError) {
        logger.error(\`\${operation} request received unexepected body (Parse Error).\`);
    }
    else {
        // CacheError, ReadError, MaxRedirectsError, UnsupportedProtocolError, CancelError
        logger.error(\`Error during \${operation} request.\`, error);
    }`,
        `    const safeError = {
        name: error.name,
        code: error.code,
        message: error.message,
        statusCode: error.response?.statusCode
    };
    const response = {
        data: dataProvider(),
        responseStatus: RestResponseStatus.ERROR,
        error: safeError
    };
    if (error instanceof got_1.HTTPError) {
        logger.error(\`Error during \${operation} request (HTTP Response \${error.response.statusCode}).\`);
    }
    else if (error.name === 'RequestError') {
        logger.error(\`\${operation} request received no response (\${error.code}).\`);
    }
    else if (error instanceof got_1.TimeoutError) {
        logger.error(\`\${operation} request timed out.\`);
    }
    else if (error instanceof got_1.ParseError) {
        logger.error(\`\${operation} request received unexpected body (Parse Error).\`);
    }
    else {
        logger.error(\`Error during \${operation} request.\`);
    }`)
    replaceOnce(restResponseDeclarations,
        'import { RequestError } from \'got\';\nimport { Logger } from \'winston\';',
        'import { RequestError } from \'got\';\nimport { Logger } from \'winston\';\nexport interface SanitizedRequestError {\n    name?: string;\n    code?: string;\n    message?: string;\n    statusCode?: number;\n}')
    replaceOnce(restResponseDeclarations,
        '    error?: RequestError;',
        '    error?: SanitizedRequestError;')
}

function removeMicrosoftAuthFromCore() {
    assertVersion('helios-core', '2.3.0')

    const coreRoot = path.join(projectRoot, 'node_modules', 'helios-core')
    const packagePath = path.join(coreRoot, 'package.json')
    const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'))

    delete manifest.exports?.['./microsoft']
    delete manifest.typesVersions?.['*']?.microsoft
    fs.writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)

    fs.rmSync(path.join(coreRoot, 'dist', 'microsoft'), { recursive: true, force: true })
    for(const file of ['microsoft.js', 'microsoft.js.map', 'microsoft.d.ts']) {
        fs.rmSync(path.join(coreRoot, 'dist', file), { force: true })
    }
}

patchDistributionTypes()
patchCore()
removeMicrosoftAuthFromCore()
console.log('NeoForge dependency patches are applied and Microsoft authentication is removed.')
