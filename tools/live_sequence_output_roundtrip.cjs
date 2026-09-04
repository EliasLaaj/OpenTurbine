const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, request } = require('playwright');

function installedBrowser() {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJson(base, route, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const api = await request.newContext({
      baseURL: base,
      extraHTTPHeaders: { Connection:'close', 'Cache-Control':'no-cache' }
    });
    try {
      const response = await api.get(`${route}${route.includes('?') ? '&' : '?'}_test=${Date.now()}`, { timeout:8000 });
      if (response.ok()) return await response.json();
    } catch (_) {
    } finally {
      await api.dispose();
    }
    await sleep(650);
  }
  throw new Error(`${route} did not become readable`);
}

async function getTelemetrySnapshot(base, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const data = await getJson(base, '/api/data', 1);
    if (typeof data.mode === 'string') return data;
    await sleep(650);
  }
  throw new Error('/api/data did not return a complete telemetry snapshot');
}

async function restoreEngineFile(base, original) {
  const matchesOriginal = candidate =>
    JSON.stringify(candidate?.hardware?.startup_seq) === JSON.stringify(original.hardware.startup_seq) &&
    JSON.stringify(candidate?.hardware?.startup_enter_actions) === JSON.stringify(original.hardware.startup_enter_actions);
  for (let round = 0; round < 3; round++) {
    try {
      const current = await getJson(base, '/api/ecu_config', 12);
      if (matchesOriginal(current)) return;
    } catch (_) {}
    const api = await request.newContext({ baseURL:base, extraHTTPHeaders:{Connection:'close'} });
    try {
      const response = await api.post('/api/ecu_config', { data:original, timeout:20000 });
      if (!response.ok() && ![409, 503].includes(response.status()))
        throw new Error(`restore returned HTTP ${response.status()}: ${await response.text()}`);
    } catch (_) {
    } finally {
      await api.dispose();
    }
    // The successful reply may be lost when the ECU deliberately restarts.
    // Prove the committed file before ever sending the same restore again.
    for (let attempt = 0; attempt < 45; attempt++) {
      try {
        const restored = await getJson(base, '/api/ecu_config', 1);
        if (matchesOriginal(restored)) return;
      } catch (_) {}
      await sleep(750);
    }
  }
  throw new Error('original engine file was not restored after three verified attempts');
}

(async () => {
  const base = process.argv[2] || 'http://192.168.4.1';
  const original = await getJson(base, '/api/ecu_config');
  const initialData = await getJson(base, '/api/data');
  const initialInfo = await getJson(base, '/api/device_info');
  assert.equal(initialData.mode, 'STANDBY');
  assert.equal(initialInfo.outputs_active, false);
  console.log(`Baseline captured: ${original.hardware.startup_seq.length} startup blocks, boot ${initialData.boot_count}.`);

  const browser = await chromium.launch({
    headless:true,
    ...(installedBrowser() ? { executablePath:installedBrowser() } : {})
  });
  try {
    const page = await browser.newPage({ viewport:{width:412, height:915} });
    await page.goto(`${base}/sequence.html`, { waitUntil:'domcontentloaded', timeout:30000 });
    await page.waitForFunction(() => document.documentElement.classList.contains('ot-theme-ready'), null, { timeout:20000 });
    await page.waitForFunction(() => /CONNECTED/i.test(document.getElementById('conn-label')?.textContent || ''), null, { timeout:20000 });
    const add = page.locator('#add-startup-sel');
    await add.waitFor({ state:'visible', timeout:20000 });
    await page.waitForFunction(() => document.querySelectorAll('#add-startup-sel option').length > 5, null, {timeout:20000});
    const options = await add.locator('option').evaluateAll(rows => rows.map(row => ({value:row.value, text:row.textContent.trim()})));
    for (const expected of ['Set Main Fuel Metering', 'Set Oil Pump', 'Set Igniter'])
      assert.ok(options.some(option => option.text.includes(expected)), `missing professional add option: ${expected}`);
    console.log(`Sequence add menu verified: ${options.length - 1} concise choices.`);

    const chosen = options.find(option => option.value === 'SetOutput::igniter');
    assert.ok(chosen, 'the fitted Igniter was not available as an exact Set Output target');
    const beforeCount = await page.locator('#list-startup .block-card').count();
    await add.selectOption(chosen.value);
    await page.locator('#tab-startup .add-row .add-btn').first().click();
    await page.waitForFunction(count => document.querySelectorAll('#list-startup .block-card').length === count + 1, beforeCount);
    const card = page.locator('#list-startup .block-card').last();
    assert.match(await card.innerText(), /Set Igniter/i);
    const selects = card.locator('select');
    assert.equal(await selects.count(), 2, 'Set Output should expose one device and one demand selector');
    const device = selects.nth(0);
    assert.equal(await device.inputValue(), 'igniter', 'new block did not retain its exact output target');
    const onOff = selects.nth(1);
    assert.equal(await onOff.inputValue(), '1', 'binary output did not default to the explicit ON command');
    assert.equal(await page.locator('#save-btn').isEnabled(), true, 'sequence edit did not enable Save & Reboot');
    console.log('Set Igniter block added and its editable target/demand controls verified.');

    await page.locator('#save-btn').click();
    for (let attempt = 0; attempt < 8; attempt++) {
      const confirm = page.locator('#ot-dialog-confirm:visible');
      if (await confirm.count()) await confirm.click();
      if (/Saved.*rebooting/i.test(await page.locator('#save-status').textContent().catch(() => ''))) break;
      await page.waitForTimeout(350);
    }
    await page.waitForFunction(() => /Saved.*rebooting/i.test(document.getElementById('save-status')?.textContent || ''), null, { timeout:30000 });
    console.log('Sequence save accepted; waiting for the deliberate ECU reboot.');
    await page.close();

    const saved = await getJson(base, '/api/ecu_config');
    const index = saved.hardware.startup_seq.lastIndexOf('SetOutput');
    assert.ok(index >= 0, 'stored startup sequence has no SetOutput block');
    const action = saved.hardware.startup_enter_actions?.[index]?.[0];
    assert.equal(action?.target, 'igniter', 'stored SetOutput target is not the selected Igniter');
    assert.equal(Number(action?.value), 1, 'stored binary SetOutput demand is not ON');
    console.log('Stored engine file preserved SetOutput → Igniter → ON exactly.');
    const savedData = await getTelemetrySnapshot(base);
    const savedInfo = await getJson(base, '/api/device_info');
    assert.equal(savedData.mode, 'STANDBY');
    assert.equal(savedInfo.outputs_active, false, 'saving the sequence activated an output');

    await restoreEngineFile(base, original);
    console.log('Original engine file restored.');
    const finalData = await getTelemetrySnapshot(base);
    const finalInfo = await getJson(base, '/api/device_info');
    assert.equal(finalData.mode, 'STANDBY');
    assert.equal(finalInfo.outputs_active, false);
    console.log(`Sequence output round-trip PASSED: ${options.length - 1} concise add choices, exact Igniter target persisted, original engine file restored.`);
  } catch (error) {
    try { await restoreEngineFile(base, original); }
    catch (restoreError) { console.error(`EMERGENCY RESTORE FAILED: ${restoreError.message}`); }
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
