const { app, safeStorage } = require('electron')

app.whenReady().then(() => {
    if(!safeStorage.isEncryptionAvailable()) {
        throw new Error('Electron safeStorage encryption is unavailable.')
    }

    const marker = 'helios-safe-storage-round-trip'
    const encrypted = safeStorage.encryptString(marker)
    if(encrypted.includes(Buffer.from(marker)) || safeStorage.decryptString(encrypted) !== marker) {
        throw new Error('Electron safeStorage round-trip verification failed.')
    }

    console.log(`Electron safeStorage verified on ${process.platform}.`)
    app.quit()
}).catch(error => {
    console.error(error.message)
    app.exit(1)
})
