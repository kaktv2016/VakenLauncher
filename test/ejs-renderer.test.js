const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { data, handleFileRequest, renderTemplate, resolveFileRequest } = require('../app/assets/js/ejsrenderer')

test('renders the complete Launcher EJS tree with EJS 6', () => {
    const entry = path.resolve(__dirname, '..', 'app', 'app.ejs')
    data({ bkid: 0, lang: () => '' })
    const rendered = renderTemplate(entry)
    assert.match(rendered, /^<html\b/i)
    assert.match(rendered, /id="landingContainer"/)
    assert.equal(rendered.includes('<%'), false)
})

test('accepts only local file URLs for template rendering', () => {
    const entry = path.resolve(__dirname, '..', 'app', 'app.ejs')
    assert.equal(path.resolve(resolveFileRequest(new URL(`file:///${entry.replace(/\\/g, '/')}`).toString())), entry)
    assert.throws(() => resolveFileRequest('https://example.com/app.ejs'), /Unsupported/)
    assert.throws(() => resolveFileRequest('file://server/share/app.ejs'), /Unsupported/)
})

test('serves a rendered EJS response through the file protocol handler', async () => {
    const entry = path.resolve(__dirname, '..', 'app', 'app.ejs')
    data({ bkid: 0, lang: () => '' })
    const response = await handleFileRequest({ url: new URL(`file:///${entry.replace(/\\/g, '/')}`).toString() })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /^text\/html/)
    const html = await response.text()
    assert.match(html, /id="loginOptionLocal"/)
    assert.equal(/microsoft|loginOptionMicrosoft|settingsAddMicrosoftAccount/i.test(html), false)
})
