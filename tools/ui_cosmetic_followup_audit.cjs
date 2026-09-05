const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const port = 11800 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;

function installedBrowser() {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

async function text(page, selector) {
  return (await page.locator(selector).textContent()).trim();
}

(async () => {
  globalThis.OT_UI_SIM_PORT = port;
  await import('./ui_mock_server.mjs');
  const executablePath = installedBrowser();
  const browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})});
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', dialog => dialog.dismiss());
  try {
    await page.request.post(`${base}/__sim/reset`);
    await page.request.post(`${base}/__sim/scenario/minimal`);
    await page.request.patch(`${base}/api/hardware`, {data:{cluster_serial:{enabled:false,tx_pin:-1,rx_pin:-1}}});
    await page.goto(`${base}/hardware.html`);
    await page.waitForSelector('#hardware-comms-summary');
    await page.waitForFunction(() => typeof window.OTShowRebootOverlay === 'function');
    assert.doesNotMatch(await text(page, '#hardware-comms-summary'), /OT Cluster serial/i);
    await page.locator('#btn-edit-comms').click();
    assert.match(await text(page, '#hardware-comms-summary'), /OT Cluster serial.*Cluster TX GPIO/is);
    await page.evaluate(() => showRebootOverlay());
    assert.match(await text(page, '#reboot-overlay'), /Device rebooting.*reconnecting/is);
    assert.match(await page.locator('#reboot-overlay').getAttribute('class'), /rebooting-overlay.*show/);

    await page.goto(`${base}/system.html`);
    await page.waitForSelector('#system-device-setup');
    assert.equal(await page.locator('#system-device-setup > .system-category').count(), 3);
    assert.equal(await page.locator('#system-identity-access .system-subcard-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
    await page.locator('#system-wifi-access > summary').click();
    assert.match(await text(page, '#system-wifi-access-state'), /Open network.*Add Wi-Fi password/is);
    assert.equal(await page.locator('#system-wifi-open-action').count(), 0);
    assert.equal(await page.locator('#system-wifi-password-editor').isVisible(), false);
    await page.locator('#system-wifi-password-action').click();
    assert.equal(await page.locator('#system-wifi-password-editor').isVisible(), true);
    await page.locator('#system-wifi-password').fill('sanity-password');
    await page.locator('#system-wifi-password').dispatchEvent('change');
    assert.match(await text(page, '#system-wifi-access-state'), /Password protected.*new password ready to save/is);
    assert.equal(await page.locator('#system-wifi-open-action').count(), 1);
    await page.locator('#system-wifi-open-action').click();
    assert.match(await text(page, '#system-wifi-access-state'), /Open network.*Add Wi-Fi password/is);
    assert.match(await text(page, '#system-device-setup'), /Identity & access.*Connections & runtime.*Maintenance/is);
    assert.equal(await page.locator('#manual-update-tools #ota-file').count(), 1);
    assert.equal(await page.locator('#manual-update-tools #assets-files').count(), 1);

    await page.evaluate(() => { _clearDirty(); renderSystemSetup(); });
    const identity = page.locator('details.config-group').filter({hasText:'Name used by the dashboard'});
    if (!await identity.evaluate(element => element.open)) await identity.locator('summary').click();
    await page.locator('#system-engine-name').fill('sanity-renamed-engine');
    await page.locator('#system-engine-name').dispatchEvent('change');
    const dirty = await page.evaluate(() => ({
      pageDirty:_cfgDirty,
      hardwareDirty:_systemHardwareDirty,
      paths:[..._systemHardwareChangedPaths],
      changes:_buildChanges(),
      saveDisabled:document.querySelector('#btn-save').disabled
    }));
    assert.equal(dirty.pageDirty, true);
    assert.equal(dirty.hardwareDirty, true);
    assert.deepEqual(dirty.paths, ['profile_id']);
    assert.equal(dirty.saveDisabled, false);
    assert.match(JSON.stringify(dirty.changes), /Engine \/ Wi-Fi name.*sanity-renamed-engine/);
    await page.evaluate(() => saveConfig());
    await page.waitForSelector('#save-recap-modal', {state:'visible'});
    assert.match(await text(page, '#save-recap-subtitle'), /Wi-Fi network name to “sanity-renamed-engine”.*Reconnect/i);
    await page.locator('#save-recap-confirm-btn').click();
    await page.waitForSelector('#reboot-overlay.rebooting-overlay.show');
    assert.match(await text(page, '#reboot-overlay'), /Device rebooting.*sanity-renamed-engine/is);
    let state = await (await page.request.get(`${base}/__sim/state`)).json();
    assert.equal(state.hardware.profile_id, 'sanity-renamed-engine');
    assert.equal(state.settings.profile_id, 'sanity-renamed-engine');

    const crossed = await (await page.request.get(`${base}/api/ecu_config`)).json();
    crossed.settings.profile_id = 'different-engine-file';
    let response = await page.request.post(`${base}/api/ecu_config`, {data:crossed});
    assert.equal(response.status(), 400);

    await page.goto(`${base}/sequence.html`);
    await page.waitForSelector('#sequence-save-bar');
    await page.evaluate(() => startRebootCountdown());
    assert.match(await page.locator('#reboot-overlay').getAttribute('class'), /rebooting-overlay.*show/);
    assert.match(await text(page, '#reboot-overlay'), /Device rebooting.*reconnecting/is);

    await page.goto(`${base}/tools.html`);
    await page.waitForSelector('#tool-area');
    assert.equal(await page.locator('#manual-update-tools').count(), 0);
    assert.deepEqual(pageErrors, []);
    console.log('Cosmetic follow-up audit passed: cluster visibility, System grouping/update placement, rename warning, atomic identity sync, and full-file mismatch guard.');
  } finally {
    await browser.close();
  }
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
