const remoteMain = require('@electron/remote/main')
remoteMain.initialize()

// Requirements
const { app, BrowserWindow, ipcMain, Menu, protocol, safeStorage, shell } = require('electron')
const autoUpdater                       = require('electron-updater').autoUpdater
const fs                                = require('fs')
const isDev                             = require('./app/assets/js/isdev')
const path                              = require('path')
const semver                            = require('semver')
const { pathToFileURL }                 = require('url')
const { SECRET_OPCODE, SHELL_OPCODE }   = require('./app/assets/js/ipcconstants')
const LangLoader                        = require('./app/assets/js/langloader')
const EjsRenderer                       = require('./app/assets/js/ejsrenderer')
const launcherConfig                    = require('./app/assets/launcher-config.json')
const { resolveGitHubRepository }       = require('./app/assets/js/releaseconfig')

EjsRenderer.install(app, protocol)

// Setup Lang
LangLoader.setupLanguage()

// Setup auto updater.
function initAutoUpdater(event, data) {

    const releaseRepository = resolveGitHubRepository(launcherConfig)
    if(releaseRepository == null) {
        console.log('Auto updater is disabled until updateRepository is configured.')
        event.sender.send('autoUpdateNotification', 'disabled')
        return false
    }

    autoUpdater.setFeedURL({
        owner: releaseRepository.owner,
        provider: 'github',
        repo: releaseRepository.repo
    })

    if(data){
        autoUpdater.allowPrerelease = true
    } else {
        // Defaults to true if application version contains prerelease components (e.g. 0.12.1-alpha.1)
        // autoUpdater.allowPrerelease = true
    }
    
    if(isDev){
        autoUpdater.autoInstallOnAppQuit = false
    }
    if(process.platform === 'darwin'){
        autoUpdater.autoDownload = false
    }
    autoUpdater.on('update-available', (info) => {
        event.sender.send('autoUpdateNotification', 'update-available', info)
    })
    autoUpdater.on('update-downloaded', (info) => {
        event.sender.send('autoUpdateNotification', 'update-downloaded', info)
    })
    autoUpdater.on('update-not-available', (info) => {
        event.sender.send('autoUpdateNotification', 'update-not-available', info)
    })
    autoUpdater.on('checking-for-update', () => {
        event.sender.send('autoUpdateNotification', 'checking-for-update')
    })
    autoUpdater.on('error', (err) => {
        event.sender.send('autoUpdateNotification', 'realerror', err)
    })
    return true
}

// Open channel to listen for update actions.
ipcMain.on('autoUpdateAction', (event, arg, data) => {
    switch(arg){
        case 'initAutoUpdater':
            console.log('Initializing auto updater.')
            if(initAutoUpdater(event, data)) {
                event.sender.send('autoUpdateNotification', 'ready')
            }
            break
        case 'checkForUpdate':
            if(resolveGitHubRepository(launcherConfig) == null) {
                event.sender.send('autoUpdateNotification', 'disabled')
                break
            }
            autoUpdater.checkForUpdates()
                .catch(err => {
                    event.sender.send('autoUpdateNotification', 'realerror', err)
                })
            break
        case 'allowPrereleaseChange':
            if(!data){
                const preRelComp = semver.prerelease(app.getVersion())
                if(preRelComp != null && preRelComp.length > 0){
                    autoUpdater.allowPrerelease = true
                } else {
                    autoUpdater.allowPrerelease = data
                }
            } else {
                autoUpdater.allowPrerelease = data
            }
            break
        case 'installUpdateNow':
            autoUpdater.quitAndInstall()
            break
        default:
            console.log('Unknown argument', arg)
            break
    }
})
// Redirect distribution index event from preloader to renderer.
ipcMain.on('distributionIndexDone', (event, res) => {
    event.sender.send('distributionIndexDone', res)
})

// Handle trash item.
ipcMain.handle(SHELL_OPCODE.TRASH_ITEM, async (event, ...args) => {
    try {
        await shell.trashItem(args[0])
        return {
            result: true
        }
    } catch(error) {
        return {
            result: false,
            error: error
        }
    }
})

// Disable hardware acceleration.
// https://electronjs.org/docs/tutorial/offscreen-rendering
app.disableHardwareAcceleration()


function secureStorageAvailable() {
    if(!safeStorage.isEncryptionAvailable()) {
        return false
    }
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
}

ipcMain.on(SECRET_OPCODE.PROTECT, (event, value) => {
    try {
        if(!secureStorageAvailable() || typeof value !== 'string') {
            throw new Error('Secure token storage is unavailable.')
        }
        event.returnValue = {
            ok: true,
            value: safeStorage.encryptString(value).toString('base64')
        }
    } catch(_error) {
        event.returnValue = { ok: false, error: 'Secure token storage is unavailable.' }
    }
})

ipcMain.on(SECRET_OPCODE.UNPROTECT, (event, value) => {
    try {
        if(!secureStorageAvailable() || typeof value !== 'string') {
            throw new Error('Secure token storage is unavailable.')
        }
        event.returnValue = {
            ok: true,
            value: safeStorage.decryptString(Buffer.from(value, 'base64'))
        }
    } catch(_error) {
        event.returnValue = { ok: false, error: 'Stored account credentials could not be decrypted.' }
    }
})

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win

function createWindow() {

    win = new BrowserWindow({
        width: 980,
        height: 552,
        icon: getPlatformIcon('SealCircle'),
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'app', 'assets', 'js', 'preloader.js'),
            nodeIntegration: true,
            contextIsolation: false
        },
        backgroundColor: '#171614'
    })
    remoteMain.enable(win.webContents)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event, uri) => {
        if(new URL(uri).protocol !== 'file:') {
            event.preventDefault()
        }
    })

    const data = {
        bkid: Math.floor((Math.random() * fs.readdirSync(path.join(__dirname, 'app', 'assets', 'images', 'backgrounds')).length)),
        lang: (str, placeHolders) => LangLoader.queryEJS(str, placeHolders)
    }
    EjsRenderer.data(data)

    win.loadURL(pathToFileURL(path.join(__dirname, 'app', 'app.ejs')).toString())

    /*win.once('ready-to-show', () => {
        win.show()
    })*/

    win.removeMenu()

    win.resizable = true

    win.on('closed', () => {
        win = null
    })
}

function createMenu() {
    
    if(process.platform === 'darwin') {

        // Extend default included application menu to continue support for quit keyboard shortcut
        let applicationSubMenu = {
            label: 'Application',
            submenu: [{
                label: 'About Application',
                selector: 'orderFrontStandardAboutPanel:'
            }, {
                type: 'separator'
            }, {
                label: 'Quit',
                accelerator: 'Command+Q',
                click: () => {
                    app.quit()
                }
            }]
        }

        // New edit menu adds support for text-editing keyboard shortcuts
        let editSubMenu = {
            label: 'Edit',
            submenu: [{
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                selector: 'undo:'
            }, {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                selector: 'redo:'
            }, {
                type: 'separator'
            }, {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                selector: 'cut:'
            }, {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:'
            }, {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                selector: 'paste:'
            }, {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                selector: 'selectAll:'
            }]
        }

        // Bundle submenus into a single template and build a menu object with it
        let menuTemplate = [applicationSubMenu, editSubMenu]
        let menuObject = Menu.buildFromTemplate(menuTemplate)

        // Assign it to the application
        Menu.setApplicationMenu(menuObject)

    }

}

function getPlatformIcon(filename){
    return path.join(__dirname, 'app', 'assets', 'images', `${filename}.png`)
}

app.on('ready', createWindow)
app.on('ready', createMenu)

app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow()
    }
})
