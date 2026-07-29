const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const port = 11100 + Math.floor(Math.random() * 500);
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

async function reset(page) {
  const response = await page.request.post(`${base}/__sim/reset`);
  assert.equal(response.ok(), true);
}

async function goto(page, route, selector = 'body') {
  await page.goto(`${base}/${route}`);
  await page.waitForSelector(selector, { state: 'attached' });
  await page.waitForTimeout(150);
}

async function text(page, selector) {
  return (await page.locator(selector).textContent()).trim();
}

async function visible(page, selector) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    return !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  }, selector);
}

async function state(page) {
  return (await page.request.get(`${base}/__sim/state`)).json();
}

async function patchHardware(page, patch) {
  const response = await page.request.patch(`${base}/api/hardware`, { data: patch });
  assert.equal(response.ok(), true);
}

async function patchConfig(page, patch) {
  const response = await page.request.patch(`${base}/api/config`, { data: patch });
  assert.equal(response.ok(), true);
}

async function patchData(page, patch) {
  const response = await page.request.post(`${base}/__sim/data`, { data: patch });
  assert.equal(response.ok(), true);
}

async function scenario(page, name) {
  const response = await page.request.post(`${base}/__sim/scenario/${name}`);
  assert.equal(response.ok(), true);
}

async function assertNoSevereLayoutIssues(page, route, viewport) {
  await page.setViewportSize(viewport);
  await goto(page, route);
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = Math.max(0, doc.scrollWidth - doc.clientWidth);
    const badControls = [];
    for (const el of document.querySelectorAll('button,select,input,.tool-card,.card,.hw-item-card,.block-card')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (el.scrollWidth > el.clientWidth + 6 && rect.width < doc.clientWidth + 1) {
        badControls.push((el.id || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 80));
      }
    }
    return { overflow, badControls: badControls.slice(0, 12) };
  });
  assert.ok(metrics.overflow <= 24, `${route} overflows viewport ${viewport.width}px by ${metrics.overflow}px`);
  assert.deepEqual(metrics.badControls, [], `${route} has clipped controls/cards at ${viewport.width}px: ${metrics.badControls.join(' | ')}`);
}

(async () => {
  globalThis.OT_UI_SIM_PORT = port;
  await import('./ui_mock_server.mjs');
  const executablePath = installedBrowser();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage();
  const consoleErrors = [];
  const badResponses = [];
  page.on('pageerror', error => { throw error; });
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource/i.test(message.text())) consoleErrors.push(message.text());
  });
  page.on('response', response => {
    if (response.status() >= 400 && !/\/favicon\.ico($|\?)/.test(response.url())) badResponses.push(`${response.status()} ${response.url()}`);
  });

  const results = [];
  try {
    await reset(page);

    await goto(page, 'index.html', '#getting-started-banner');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('#getting-started-banner');
    const gs = await text(page, '#getting-started-banner');
    assert.match(gs, /Hardware/i);
    assert.match(gs, /safety limits/i);
    assert.match(gs, /Calibrate/i);
    assert.equal(await page.locator('#getting-started-banner a[href="/hardware.html"]').count(), 1);
    assert.equal(await page.locator('#getting-started-banner a[href="/config.html"]').count(), 1);
    assert.equal(await page.locator('#getting-started-banner a[href="/calibration.html"]').count(), 1);
    results.push('first-boot checklist gives a clear hardware -> config -> calibration path');

    await goto(page, 'hardware.html', '#f-profile-id');
    assert.match(await text(page, '#save-msg'), /Loaded|Converted/i);
    assert.equal(await page.locator('#btn-save').isDisabled(), true);
    assert.equal(await page.locator('#btn-discard').isDisabled(), true);
    const migratedInputs = await text(page, '#registry-inputs');
    const migratedOutputs = await text(page, '#registry-outputs');
    for (const name of ['N1 Speed', 'N2 Speed', 'Main TOT', 'Fuel Pressure', 'Oil Temp', 'AB Flame'])
      assert.match(migratedInputs, new RegExp(name));
    for (const name of ['Main Fuel Pump', 'Starter', 'Fuel Shutoff', 'AB Igniter', 'AB Fuel Valve', 'AB Fuel Pump', 'Glow Plug'])
      assert.match(migratedOutputs, new RegExp(name));
    assert.match(await text(page, '#builtin-inputs'), /Afterburner trigger and arm.*Manual \/ browser command/is);
    const oilTempStatus = await page.locator('#registry-inputs .registry-card').evaluateAll(cards =>
      cards.find(card => card.querySelector('strong')?.textContent.trim() === 'Oil Temp')?.querySelector('.registry-status')?.textContent || '');
    assert.match(oilTempStatus, /GPIO 15 is not ADC1-capable/i);
    assert.match(await text(page, '#save-msg'), /Loaded/i);
    results.push('canonical inventory exposes every fitted sensor, actuator, AB control and invalid board pin before save');

    await page.locator('button[onclick="addRegistryChannel(\'input\')"]').click();
    const inputAddChoices = await page.locator('#registry-add-catalog').evaluate(catalog =>
      Object.fromEntries(Array.from(catalog.querySelectorAll('button')).map(button => [
        button.childNodes[0]?.textContent?.trim(),
        { disabled: button.disabled, detail: button.querySelector('.registry-add-default')?.textContent?.trim() || '', description: button.querySelector('small')?.textContent?.trim() || '' }
      ]))
    );
    for (const label of ['N1 speed', 'N2 speed', 'TOT / EGT', 'TIT', 'Oil pressure', 'AB flame', 'Throttle input', 'Idle input']) {
      assert.equal(inputAddChoices[label]?.disabled, true, `${label} should not be addable twice`);
      assert.match(inputAddChoices[label]?.detail || '', /already installed/i);
    }
    for (const label of ['Additional shaft speed', 'Generic digital input']) {
      assert.doesNotMatch(inputAddChoices[label]?.detail || '', /already installed/i);
      if (inputAddChoices[label]?.disabled) assert.match(inputAddChoices[label]?.detail || '', /capacity full/i);
    }
    assert.match(inputAddChoices['N2 speed']?.description || '', /power-turbine|propeller shaft/i);
    assert.match(inputAddChoices['TOT / EGT']?.description || '', /MAX31855.*default/i);
    assert.match(inputAddChoices['TIT']?.description || '', /MAX31855.*default/i);
    assert.match(inputAddChoices['AB flame']?.description || '', /afterburner.*flame/i);
    assert.equal(inputAddChoices['Main oil-pump flow'], undefined, 'main oil flow belongs inside the oil-pump card');
    assert.equal(inputAddChoices['Scavenge-pump flow'], undefined, 'scavenge flow belongs inside the scavenge-pump card');
    await page.locator('#registry-add-modal button[onclick="closeRegistryAddDialog()"]' ).click();

    await page.locator('button[onclick="addRegistryChannel(\'output\')"]').click();
    const outputAddChoices = await page.locator('#registry-add-catalog').evaluate(catalog =>
      Object.fromEntries(Array.from(catalog.querySelectorAll('button')).map(button => [
        button.childNodes[0]?.textContent?.trim(),
        { disabled: button.disabled, detail: button.querySelector('.registry-add-default')?.textContent?.trim() || '', description: button.querySelector('small')?.textContent?.trim() || '' }
      ]))
    );
    for (const label of ['Main fuel pump', 'Starter', 'Starter enable', 'Fuel shutoff', 'Igniter', 'AB igniter', 'Afterburner fuel shutoff valve', 'Afterburner fuel pump', 'Glow plug', 'Prop pitch']) {
      assert.equal(outputAddChoices[label]?.disabled, true, `${label} should not be addable twice`);
      assert.match(outputAddChoices[label]?.detail || '', /already installed/i);
    }
    for (const label of ['Relay output', 'PWM output']) {
      assert.doesNotMatch(outputAddChoices[label]?.detail || '', /already installed/i);
      if (outputAddChoices[label]?.disabled) assert.match(outputAddChoices[label]?.detail || '', /capacity full/i);
    }
    assert.match(outputAddChoices['Afterburner fuel pump']?.description || '', /afterburner manifold/i);
    assert.match(outputAddChoices['Afterburner fuel shutoff valve']?.description || '', /admits fuel|normally closed/i);
    await page.locator('#registry-add-modal button[onclick="closeRegistryAddDialog()"]' ).click();
    assert.equal(await page.locator('#registry-inputs .registry-card[data-registry-id="oil_flow"]').count(), 0);
    const oilPumpCard = page.locator('#registry-outputs .registry-card[data-registry-id="oil_pump"]');
    await oilPumpCard.locator('button', {hasText:'Edit'}).click();
    assert.match((await oilPumpCard.textContent()).trim(), /Flow sensing & monitoring.*Main oil-pump flow sensor.*Pulses \/ litre.*Minimum flow.*Oil System/is);
    assert.match((await oilPumpCard.textContent()).trim(), /Current sensing.*Calibration page/is);
    assert.equal(await oilPumpCard.locator('a[href="/config.html#cf-oil_mm"]').count(), 1);
    assert.equal(await oilPumpCard.locator('a[href="/config.html#cf-so_rl"]').count(), 1);
    assert.equal(await oilPumpCard.locator('a[href="/sequence.html#tab-startup"]').count(), 1);
    results.push('add-device catalog blocks duplicates while pump-owned flow and current sensors stay in their actuator cards');

    const flameUsers = await page.evaluate(() => ({
      main: registryCurrentUsers('input', 'flame_main'),
      afterburner: registryCurrentUsers('input', 'ab_flame_main')
    }));
    assert.equal(flameUsers.main.some(label => /Confirm Afterburner Flame/i.test(label)), false,
      'main combustor flame sensor must not claim to confirm afterburner flame');
    assert.equal(flameUsers.afterburner.some(label => /Confirm Afterburner Flame/i.test(label)), true,
      'dedicated AB flame sensor should identify its afterburner flame-confirmation dependency');
    results.push('main and afterburner flame cards identify the correct sequencer consumers');

    const hwFailPage = await browser.newPage();
    await hwFailPage.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, init) => String(url).includes('/api/hardware')
        ? Promise.reject(new Error('simulated hardware load failure'))
        : originalFetch(url, init);
    });
    await hwFailPage.goto(`${base}/hardware.html`);
    await hwFailPage.waitForSelector('#save-msg');
    await hwFailPage.waitForFunction(() => document.querySelector('#save-msg').textContent.includes('Load failed'));
    assert.match((await hwFailPage.locator('#save-msg').textContent()).trim(), /Load failed/i);
    await hwFailPage.close();
    results.push('hardware page has an understandable load-failure state');

    await goto(page, 'config.html', '#save-msg');
    const cfgFailPage = await browser.newPage();
    await cfgFailPage.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, init) => String(url).includes('/api/config')
        ? Promise.reject(new Error('simulated config load failure'))
        : originalFetch(url, init);
    });
    await cfgFailPage.goto(`${base}/config.html`);
    await cfgFailPage.waitForSelector('#cfg-form', { state: 'attached' });
    await cfgFailPage.waitForFunction(() => document.querySelector('#cfg-form').textContent.includes('Error loading config'));
    assert.match((await cfgFailPage.locator('#cfg-form').textContent()).trim(), /Error loading config/i);
    await cfgFailPage.close();
    results.push('config page has an understandable load-failure state');

    let response = await page.request.post(`${base}/api/ecu_config`, { data: { hardware: { profile_id: 'a' } } });
    assert.equal(response.status(), 400);
    response = await page.request.post(`${base}/api/ecu_config`, {
      data: { hardware: { profile_id: 'a' }, settings: { profile_id: 'b' } }
    });
    assert.equal(response.status(), 400);
    results.push('bad or crossed engine-file restores are rejected before changing state');

    await reset(page);
    await goto(page, 'tools.html', '#cfg-restore-btn');
    await scenario(page, 'startup');
    await page.reload();
    await page.waitForSelector('#cfg-restore-btn');
    assert.equal(await page.locator('#cfg-restore-btn').isDisabled(), true);
    await scenario(page, 'minimal');
    await page.reload();
    await page.waitForSelector('#cfg-restore-btn');
    assert.equal(await page.locator('#cfg-restore-btn').isDisabled(), false);
    assert.match(await text(page, '#card-CONFIG_BACKUP'), /STANDBY/i);
    results.push('backup/restore UX blocks restore outside STANDBY and explains the gate');

    await reset(page);
    await patchHardware(page, {
      has_afterburner: false,
      channel_registry: {
        version: 1,
        inputs: [
          {id:'n1_main',name:'N1 Speed',purpose:'n1_speed',role:'speed',driver:2,pin:34,min:0,max:200000,pulses_per_unit:1},
          {id:'tot_main',name:'Main TOT',purpose:'tot',role:'temperature',driver:1,pin:-1,min:0,max:1200,temp_interface:2,spi_clk:18,spi_cs:5,spi_miso:19,spi_mosi:-1}
        ],
        outputs: [
          {id:'main_fuel',name:'Main Fuel Pump',purpose:'main_fuel',role:'fuel',driver:6,pin:21,min:1000,max:2000,safe_demand:0},
          {id:'starter',name:'Starter',purpose:'starter',role:'starter',driver:6,pin:22,min:1000,max:2000,safe_demand:0},
          {id:'fuel_shutoff',name:'Fuel Shutoff',purpose:'fuel_shutoff',role:'fuel_shutoff',driver:4,pin:2,min:0,max:1,safe_demand:0},
          {id:'igniter',name:'Igniter',purpose:'igniter',role:'igniter',driver:4,pin:0,min:0,max:1,safe_demand:0}
        ],
        bindings: []
      },
      actuators: {
        starter_en: { enabled: false },
        ab_sol: { enabled: false },
        ab_pump: { enabled: false },
        airstarter_sol: { enabled: false },
        cool_fan: { enabled: false },
        oil_scavenge_pump: { enabled: false },
        fuel_pump2: { enabled: false },
        bleed_valve: { enabled: false },
        prop_pitch: { enabled: false },
        glow_plug: { enabled: false, has_current: false },
        igniter: { has_current: false },
        igniter2: { coil: true, pwm: false, has_current: false, current_pin: 32 },
        oil_pump: { enabled: false, has_current: false },
        status_led: { enabled: true, pin: 23, type: 0, mode: 0 }
      },
      sensors: {
        n2_rpm: { enabled: false },
        tit: { enabled: false },
        oil_press: { enabled: false },
        flame: { enabled: false },
        p1: { enabled: false },
        p2: { enabled: false },
        fuel_press: { enabled: false },
        fuel_flow: { enabled: false },
        batt_voltage: { enabled: false },
        torque: { enabled: false },
        throttle_input: { enabled: false },
        idle_input: { enabled: false },
        oil_temp: { enabled: false }
      },
      ab_flame: { enabled: false, pin: -1 },
      cluster_serial: { enabled: false, tx_pin: -1, rx_pin: -1 },
      mavlink: { enabled: false, tx_pin: -1 },
      buzzer: { enabled: false, pin: -1 },
      controllers: { oil_loop:false, dynamic_idle:false, governor:false },
      safety: { overspeed:false, overtemp:false, low_oil:false, oil_zero:false, flameout:false, hot_start:false, oil_temp_high:false, fuel_press_low:false, batt_low:false, surge:false },
      di_channels: [
        { pin: -1, role: 'none' },
        { pin: -1, role: 'none' },
        { pin: -1, role: 'none' },
        { pin: -1, role: 'none' }
      ]
    });
    await scenario(page, 'minimal');
    await goto(page, 'hardware.html', '#f-profile-desc');
    await page.waitForFunction(() => /Loaded|Converted/i.test(document.querySelector('#save-msg')?.textContent || ''));
    assert.match(await text(page, '#save-msg'), /Loaded|Converted/i);
    assert.match(await text(page, '#hardware-controllers-summary'), /Fuel response.*Automatic with Main Fuel.*1 more available to enable/is);
    assert.match(await text(page, '#hardware-safety-summary'), /5 available to enable/i);
    const profileDescription = page.locator('#f-profile-desc');
    const originalDescription = await profileDescription.inputValue();
    assert.equal(await page.locator('#btn-save').isDisabled(), true);
    assert.equal(await page.locator('#btn-discard').isDisabled(), true);
    await profileDescription.fill(originalDescription + ' changed');
    assert.equal(await page.locator('#btn-save').isDisabled(), false);
    assert.equal(await page.locator('#btn-discard').isDisabled(), false);
    assert.equal(await profileDescription.evaluate(el => el.classList.contains('field-changed')), true);
    assert.equal(await profileDescription.evaluate(el => el.closest('.hw-item-card')?.classList.contains('field-changed')), true);
    await profileDescription.fill(originalDescription);
    results.push('hardware page reaches a clear loaded state before edits');

    await page.locator('button', { hasText: '+ Add input' }).click();
    await page.getByRole('button', { name: /N2 speed/i }).click();
    const draftedN2 = page.locator('#registry-inputs .registry-card').last();
    assert.match(await page.locator('#hardware-controllers-summary').textContent(), /Fuel response.*1 more available to enable/is);
    const gpio32Option = draftedN2.locator('select').nth(2).locator('option[value="32"]');
    assert.equal(await gpio32Option.isDisabled(), false);
    assert.doesNotMatch(await gpio32Option.textContent(), /AB flame/i);
    await draftedN2.locator('select').nth(2).selectOption('35');
    await page.waitForFunction(() => {
      const card = Array.from(document.querySelectorAll('#registry-inputs .registry-card')).at(-1);
      return /GPIO 35/.test(card?.textContent || '') && /Ready/.test(card?.textContent || '');
    });
    assert.match(await draftedN2.textContent(), /N2 Speed.*GPIO 35.*Ready/is);
    assert.match(await page.locator('#hardware-controllers-summary').textContent(), /Fuel response.*2 more available to enable/is);
    assert.equal(await page.locator('#btn-save').isDisabled(), false);
    await page.locator('button', { hasText: '+ Add output' }).click();
    await page.getByRole('button', { name: /AB igniter/i }).click();
    const draftedAbIgniter = page.locator('#registry-outputs .registry-card').last();
    await draftedAbIgniter.locator('select').nth(2).selectOption('17');
    await page.waitForFunction(() => {
      const card = Array.from(document.querySelectorAll('#registry-outputs .registry-card')).at(-1);
      return /GPIO 17/.test(card?.textContent || '') && /Ready/.test(card?.textContent || '');
    });
    assert.equal(await draftedAbIgniter.locator('select').nth(3).inputValue(), 'relay');
    assert.equal(await draftedAbIgniter.locator('.registry-subcard', { hasText: 'Current sensing' }).locator('input[type="checkbox"]').isChecked(), false);
    assert.doesNotMatch(await draftedAbIgniter.textContent(), /Current sensing required/i);
    await page.reload();
    await page.waitForSelector('#registry-outputs .registry-card');
    results.push('new cards ignore phantom legacy pins, refresh readiness, and reset stale device-specific modes');

    const mainFuelCard = page.locator('#registry-outputs .registry-card').first();
    assert.match(await mainFuelCard.locator('strong').first().textContent(), /Main Fuel Pump/);
    assert.equal(await mainFuelCard.locator('button', { hasText: 'Duplicate' }).count(), 0);
    assert.equal(await mainFuelCard.locator('button.danger', { hasText: 'Remove' }).count(), 1);
    const mainFuelEdit = mainFuelCard.locator('button', { hasText: 'Edit' });
    const mainFuelRemove = mainFuelCard.locator('button.remove-action', { hasText: 'Remove' });
    const editRestColor = await mainFuelEdit.evaluate(el => getComputedStyle(el).color);
    const removeRestColor = await mainFuelRemove.evaluate(el => getComputedStyle(el).color);
    assert.equal(removeRestColor, editRestColor);
    await mainFuelRemove.hover();
    await page.waitForTimeout(180);
    assert.notEqual(await mainFuelRemove.evaluate(el => getComputedStyle(el).color), removeRestColor);
    const actionRowsAligned = await page.locator('#registry-outputs .registry-card-actions').evaluateAll(groups => groups.every(group => {
      const tops = Array.from(group.querySelectorAll('button')).map(item => Math.round(item.getBoundingClientRect().top));
      return !tops.length || Math.max(...tops) - Math.min(...tops) <= 2;
    }));
    assert.equal(actionRowsAligned, true);
    assert.equal(await page.getByText('Advanced stable ID', { exact: true }).count(), 0);
    const installedOutputCards = page.locator('#registry-outputs .registry-card');
    for (let i = 0; i < await installedOutputCards.count(); i++) {
      const card = installedOutputCards.nth(i);
      await card.locator('button', { hasText: 'Edit' }).click();
      const fallback = card.locator('input[onchange*="force_safe_on_fault"]');
      assert.equal(await fallback.count(), 1);
      assert.equal(await fallback.isChecked(), false);
      await card.locator('button', { hasText: 'Done' }).click();
    }
    const igniterCard = installedOutputCards.nth(3);
    await igniterCard.locator('button', { hasText: 'Edit' }).click();
    assert.equal(await igniterCard.evaluate(card => {
      const behavior = Array.from(card.querySelectorAll('strong')).find(el => el.textContent.trim() === 'Igniter behavior');
      const advanced = Array.from(card.querySelectorAll('summary')).find(el => el.textContent.trim() === 'Advanced output settings');
      return !!behavior && !!advanced && !!(behavior.compareDocumentPosition(advanced) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), true);
    await igniterCard.locator('button', { hasText: 'Done' }).click();

    await mainFuelCard.locator('button', { hasText: 'Edit' }).click();
    await mainFuelCard.locator('summary', { hasText: 'Advanced output settings' }).click();
    const mainFuelFaultFallback = mainFuelCard.locator('input[onchange*="force_safe_on_fault"]');
    await mainFuelFaultFallback.check();
    assert.equal(await mainFuelCard.evaluate(el => el.classList.contains('field-changed')), true);
    const faultFallbackChanges = await page.evaluate(() => _buildChanges());
    assert.match(JSON.stringify(faultFallbackChanges), /Main Fuel Pump.*Force safe state on fault.*Disabled.*Enabled/is);
    const saveDialogs = [];
    const captureSaveDialog = async dialog => {
      saveDialogs.push(dialog.message());
      await dialog.dismiss();
    };
    page.on('dialog', captureSaveDialog);
    await page.locator('#btn-save').click();
    await page.waitForTimeout(250);
    const hiddenSaveState = await page.evaluate(() => ({
      message: document.getElementById('save-msg')?.textContent || '',
      buttonDisabled: !!document.getElementById('btn-save')?.disabled,
      appDialog: document.getElementById('ot-dialog-message')?.textContent || '',
      appDialogVisible: document.getElementById('ot-app-dialog')?.classList.contains('show') || false
    }));
    assert.equal(await page.locator('#save-recap-modal').isVisible(), true,
      `save recap stayed hidden; state: ${JSON.stringify(hiddenSaveState)}; preflight dialog: ${saveDialogs.join(' | ') || 'none'}`);
    page.off('dialog', captureSaveDialog);
    assert.match(await text(page, '#save-recap-body'), /Main Fuel Pump.*Force safe state on fault.*Disabled.*Enabled/is);
    await page.locator('#save-recap-modal button', { hasText: 'Cancel' }).click();
    await page.reload();
    await page.waitForSelector('#registry-outputs .registry-card');
    const normalizedReaddRecap = await page.evaluate(() => {
      const outputs = cfg.channel_registry.outputs;
      const index = outputs.findIndex(channel => channel.purpose === 'main_fuel');
      const old = outputs[index];
      outputs[index] = {
        id: old.id, name: old.name, purpose:'main_fuel', role:'fuel',
        driver:old.driver, pin:-1, min:old.min, max:old.max,
        invert:false, safe_demand:0, force_safe_on_fault:false
      };
      return _registryDiffRows('output').map(row => row.label);
    });
    assert.ok(normalizedReaddRecap.length <= 4, 're-adding a device should recap only meaningful active fields');
    assert.doesNotMatch(normalizedReaddRecap.join(' '), /pulse|analog|voltage divider|torque|hx711|temp/i,
      're-added output recap must omit irrelevant sensor/interface defaults');
    assert.match(await page.evaluate(() => friendlyHardwareSaveError({detail:'channel registry contents'})), /device card.*invalid|incomplete/i);
    await page.reload();
    await page.waitForSelector('#registry-outputs .registry-card');
    results.push('outputs hide internal IDs, normalize re-added-device recaps, and explain rejected device data');

    const stopCard = page.locator('#builtin-inputs .hw-item-card[data-workflow-key="stop"]');
    await stopCard.locator('button', { hasText: 'Edit' }).click();
    await stopCard.locator('[data-control-field="stop_pullup"]').uncheck();
    await stopCard.locator('[data-control-field="stop_pulldown"]').check();
    assert.equal(await stopCard.evaluate(el => el.classList.contains('field-changed')), true);
    assert.equal(await stopCard.locator('[data-control-field="stop_pullup"]').evaluate(el => el.classList.contains('field-changed')), true);
    assert.equal(await stopCard.locator('[data-control-field="stop_pulldown"]').evaluate(el => el.classList.contains('field-changed')), true);
    await page.locator('#btn-save').click();
    await page.waitForSelector('#save-recap-modal', { state: 'visible' });
    assert.match(await text(page, '#save-recap-body'), /Stop switch.*Pull-up resistor.*Enabled.*Disabled/is);
    assert.match(await text(page, '#save-recap-body'), /Stop switch.*Pull-down resistor.*Disabled.*Enabled/is);
    assert.match(await text(page, '#save-recap-subtitle'), /reboot/i);
    assert.match(await text(page, '#save-recap-confirm-btn'), /Save.*Reboot/i);
    await page.locator('#save-recap-modal button', { hasText: 'Cancel' }).click();
    await page.reload();
    await page.waitForSelector('#builtin-inputs .hw-item-card[data-workflow-key="stop"]');
    results.push('Start/Stop bias edits highlight the exact switch and require a reboot recap');

    await page.locator('#btn-edit-comms').click();
    const statusLedToggle = page.locator('#hardware-comms-summary input[onchange^="setStatusLedEnabled"]');
    await statusLedToggle.uncheck();
    assert.equal(await statusLedToggle.evaluate(el => el.classList.contains('field-changed')), true);
    assert.equal(await statusLedToggle.evaluate(el => el.closest('.hw-item-card')?.classList.contains('field-changed')), true);
    assert.match(await text(page, '#save-msg'), /unsaved/i);
    assert.equal(await page.locator('#btn-save').isDisabled(), false, await page.evaluate(() => JSON.stringify({
      conflict: document.getElementById('pin-conflict-banner')?.textContent?.trim(),
      registry: Array.from(document.querySelectorAll('.registry-status-error')).map(el => el.textContent.trim()),
      message: document.getElementById('save-msg')?.textContent?.trim()
    })));
    await page.locator('#btn-save').click();
    await page.waitForSelector('#save-recap-modal', { state: 'visible' });
    assert.match(await text(page, '#save-recap-body'), /Status LED/i);
    assert.match(await text(page, '#save-recap-body'), /Enabled/i);
    assert.match(await text(page, '#save-recap-body'), /Disabled/i);
    assert.match(await text(page, '#save-recap-subtitle'), /reboot/i);
    assert.match(await text(page, '#save-recap-confirm-btn'), /Save.*Reboot/i);
    await page.locator('#save-recap-modal button', { hasText: 'Cancel' }).click();
    results.push('hardware cards keep actions aligned, mark removal as destructive, and recap indicator removal before reboot');

    await reset(page);
    await patchHardware(page, {
      channel_registry: {version:1, inputs:[{installed:true,id:'ab_flame_main',name:'AB Flame',purpose:'ab_flame',role:'flame',driver:1,pin:32,min:0,max:4095}], outputs:[{installed:true,id:'ab_pump',name:'AB Fuel Pump',purpose:'ab_pump',role:'ab_pump',driver:5,pin:17,min:0,max:1,pwm_freq_hz:5000,pwm_res_bits:10}], bindings:[]},
      ab_trigger: {source:2, switch_pin:34, switch_active_h:true, input_pin:33, input_threshold:2048, requires_arm:true, arm_pin:35, arm_active_h:true}
    });
    await page.request.post(`${base}/__sim/scenario/minimal`);
    await goto(page, 'hardware.html', '#registry-inputs');
    assert.match(await text(page, '#registry-inputs'), /AB Flame/);
    assert.match(await text(page, '#builtin-inputs'), /Afterburner trigger and arm.*Physical trigger switch.*arm GPIO 35/is);
    assert.match(await text(page, '#save-msg'), /Loaded/i);
    assert.equal(await page.locator('.save-bar').evaluate(el => el.classList.contains('is-dirty')), false);
    results.push('canonical AB flame and trigger hardware loads as visible reviewable inventory');

    const abTriggerCard = page.locator('#builtin-inputs [data-workflow-key="ab_trigger"]');
    await abTriggerCard.locator('button', {hasText:'Edit'}).click();
    await abTriggerCard.locator('[data-ab-trigger-field="source"]').selectOption('3');
    assert.match(await text(page, '#builtin-inputs [data-workflow-key="ab_trigger"]'), /Trigger threshold \(V\).*rises above the threshold/is);
    const abThreshold = page.locator('[data-ab-trigger-field="input_threshold"]');
    await abThreshold.fill('2.50');
    await abThreshold.blur();
    assert.equal(await page.locator('#builtin-inputs [data-workflow-key="ab_trigger"]').evaluate(el => el.classList.contains('field-changed')), true);
    assert.equal(await page.locator('[data-ab-trigger-field="input_threshold"]').evaluate(el => el.classList.contains('field-changed')), true);
    assert.equal(await page.locator('#btn-save').isDisabled(), false, await page.evaluate(() => JSON.stringify({
      conflict: document.getElementById('pin-conflict-banner')?.textContent?.trim(),
      errors: Array.from(document.querySelectorAll('.registry-status-error')).map(el => el.textContent.trim()),
      message: document.getElementById('save-msg')?.textContent?.trim(),
      engineMode,
      trigger: cfg.ab_trigger
    })));
    await page.locator('#btn-save').click();
    await page.waitForSelector('#save-recap-modal', { state: 'visible' });
    assert.match(await text(page, '#save-recap-body'), /Afterburner trigger.*Trigger source.*Physical switch.*Analog or RC command input/is);
    assert.match(await text(page, '#save-recap-body'), /Afterburner trigger.*Trigger threshold.*V/is);
    await page.locator('#save-recap-modal button', { hasText: 'Cancel' }).click();
    results.push('AB command-input setup exposes its threshold, highlights edits, and includes them in the reboot recap');

    await reset(page);

    await goto(page, 'config.html', '#cf-rpm_limit');
    await page.locator('#btn-view-expert').click();
    await page.locator('#cf-rpm_limit').fill('96000');
    await page.locator('#btn-save').click();
    // The full-system fixture intentionally includes a relight threshold below
    // Minimum Running N1, so acknowledge that safety warning before the recap.
    if (await page.locator('#ot-app-dialog.show').isVisible())
      await page.locator('#ot-dialog-confirm').click();
    await page.waitForSelector('#save-recap-modal', { state: 'visible' });
    assert.match(await text(page, '#save-recap-subtitle'), /updated on the device/i);
    assert.doesNotMatch(await text(page, '#save-recap-subtitle'), /reboot/i);
    await page.locator('#save-recap-confirm-btn').click();
    await page.waitForFunction(() => document.querySelector('#save-msg').textContent.includes('Saved'));
    assert.match(await text(page, '#save-msg'), /Saved/i);
    assert.equal(await page.locator('#btn-save').isDisabled(), true);
    assert.equal(await page.locator('#btn-discard').isDisabled(), true);
    results.push('config save recap distinguishes live settings from hardware reboot saves');

    await reset(page);
    await goto(page, 'hardware.html', '#hardware-inputs-panel');
    await page.evaluate(() => setNested('controls', 'start_pin', Number(cfg.controls.stop_pin)));
    await page.waitForFunction(() => getComputedStyle(document.getElementById('pin-conflict-banner')).display !== 'none');
    const conflictText = await text(page, '#pin-conflict-banner');
    assert.match(conflictText, /GPIO/i);
    assert.match(conflictText, /Stop/i);
    assert.match(conflictText, /Start/i);
    assert.equal(await page.locator('#btn-save').isDisabled(), true);
    results.push('pin conflicts name the exact GPIO and devices, and block save');

    await reset(page);
    await patchHardware(page, {
      channel_registry: {version:1, inputs:[], outputs:[], bindings:[]},
      sensors: { n1_rpm: { enabled: false }, n2_rpm: { enabled: false }, tot: { enabled: false }, tit: { enabled: false }, oil_press: { enabled: false } },
      safety: { overspeed: true, overtemp: true, low_oil: true },
      controllers: { oil_loop: true, dynamic_idle: true }
    });
    await goto(page, 'hardware.html', '#hardware-safety-summary');
    const unavailableState = await page.evaluate(() => ({
      overspeed: cfg.safety.overspeed, overtemp: cfg.safety.overtemp, lowOil: cfg.safety.low_oil,
      oilLoop: cfg.controllers.oil_loop, dynamicIdle: cfg.controllers.dynamic_idle
    }));
    assert.deepEqual(unavailableState, { overspeed:false, overtemp:false, lowOil:false, oilLoop:false, dynamicIdle:false });
    await page.locator('#btn-edit-safety').click();
    await page.locator('#btn-edit-controllers').click();
    await page.evaluate(() => {
      cfg.i2c = {...(cfg.i2c || {}), enabled:false};
      cfg.spi = {...(cfg.spi || {}), enabled:false};
      document.getElementById('en-i2c').checked = false;
      document.getElementById('en-spi').checked = false;
      applyActuatorVisibility();
    });
    assert.equal(await page.locator('#hardware-buses-panel').isVisible(), true,
      'shared bus setup must remain visible after workflow views re-render');
    assert.equal(await page.locator('#hardware-buses-summary').isVisible(), true);
    assert.match(await text(page, '#hardware-buses-summary'), /I2C bus.*Disabled.*SPI bus.*Disabled/is);
    assert.equal(await page.locator('#hardware-i2c-card').isVisible(), false,
      'bus pin details should stay collapsed until the user chooses Edit buses');
    assert.equal(await page.locator('#hardware-spi-card').isVisible(), false,
      'bus pin details should stay collapsed until the user chooses Edit buses');
    await page.locator('#btn-edit-buses').click();
    assert.equal(await page.locator('#hardware-i2c-card').isVisible(), true,
      'Edit buses must expose disabled I2C setup');
    assert.equal(await page.locator('#hardware-spi-card').isVisible(), true,
      'Edit buses must expose disabled SPI setup');
    assert.doesNotMatch(await text(page, '#hardware-i2c-card'), /TCA9554 interrupt GPIO/i,
      'TCA9554-specific interrupt wiring does not belong in general I2C bus settings');
    await page.evaluate(() => {
      const inputs = registryRoot().inputs;
      inputs.push({
        id:'audit_tca_input', name:'Audit TCA input', role:'digital_switch',
        purpose:'digital_switch', driver:8, i2c_address:32, device_channel:0,
        pin:-1, min:0, max:1, active_high:true, pullup:false, pulldown:false,
        invert:false
      });
      _registryEditOpen.add(registryEditKey('input', inputs.length - 1));
      renderRegistryInventory();
    });
    const tcaInputCard = page.locator('#registry-inputs .registry-card').filter({hasText:'Audit TCA input'});
    assert.match((await tcaInputCard.textContent()).trim(), /Shared TCA9554 interrupt GPIO.*first installed TCA9554 input/is,
      'the optional shared INT line should appear on the installed TCA9554 input card');
    assert.equal(await page.evaluate(() => {
      cfg.i2c.interrupt_pin = 10;
      const index = registryRoot().inputs.findIndex(row => row.id === 'audit_tca_input');
      updateRegistryChannel('input', index, 'driver', 0);
      return cfg.i2c.interrupt_pin;
    }), -1, 'the hidden shared interrupt pin must clear when the last TCA9554 input is changed');
    await page.evaluate(() => {
      registryRoot().inputs = registryRoot().inputs.filter(row => row.id !== 'audit_tca_input');
      _registryEditOpen.clear();
      renderRegistryInventory();
    });
    await page.locator('#supported-bus-devices summary').click();
    const supportedBusText = await text(page, '#supported-bus-devices');
    assert.match(supportedBusText, /TCA9554.*TLA2528.*NAU7802/is);
    assert.match(supportedBusText, /MAX6675.*MAX31855.*MAX31856/is);
    assert.match(supportedBusText, /DS18B20.*OneWire/is);
    assert.ok(await page.locator('#hardware-safety-summary input:disabled').count() >= 3);
    assert.ok(await page.locator('#hardware-controllers-summary input:disabled').count() >= 2);
    assert.match(await text(page, '#btn-edit-safety'), /Done editing/i);
    assert.match(await text(page, '#btn-edit-controllers'), /Done editing/i);
    assert.match(await text(page, '#hardware-safety-summary'), /Not available yet:/i);
    assert.match(await text(page, '#hardware-controllers-summary'), /N2 commands fuel|Prop Pitch output makes pitch primary/i);
    const setupGuide = await text(page, '#shaft-control-setup-guide');
    assert.match(setupGuide, /N2-controlled idle.*Main Fuel.*N2 Speed.*Automatic idle control/is);
    assert.match(setupGuide, /Turboprop.*Prop Pitch.*pitch primary.*fuel.*fallback/is);
    assert.match(setupGuide, /Generator or turboshaft.*commands main fuel/is);
    assert.equal(await page.locator('#shaft-control-setup-guide a[href="/config.html#idle-control-cfg-section"]').count(), 1);
    assert.equal(await page.locator('#shaft-control-setup-guide a[href="/config.html#governor-cfg-section"]').count(), 2);
    assert.match(await text(page, '#protection-setup-guide'), /Combustion and startup.*Auxiliary protection/is);
    assert.equal(await page.locator('#hardware-safety-summary a[href="/config.html#cf-sf_bv"]').count(), 1);
    assert.match(await text(page, '#hardware-requirements-summary'), /Add a Main Fuel Pump.*Required before the ECU can run an engine/is);
    results.push('compact bus, controller and safety editors expose setup details and prerequisites on demand');

    await goto(page, 'config.html#cf-sf_bv', '#cf-sf_bv');
    assert.equal(await page.locator('.cfg-field.deep-link-target[data-key="sf_bv"]').count(), 1);
    assert.equal(await page.locator('#cf-sf_bv').isVisible(), true);
    assert.equal(await page.locator('#cf-sf_bv').evaluate(el => el.closest('.config-group')?.open), true);
    results.push('cross-page links reveal, open, and highlight their exact Config field');

    await reset(page);
    await goto(page, 'calibration.html#p2-cal-row', '#p2-cal-row');
    assert.equal(await page.locator('#p2-cal-row.deep-link-target').count(), 1);
    assert.equal(await page.locator('#p2-cal-row').isVisible(), true);
    await goto(page, 'sequence.html#tab-afterburner', '#tab-afterburner');
    assert.equal(await page.locator('#tab-afterburner.deep-link-target').count(), 1);
    assert.equal(await page.locator('#tab-afterburner').isVisible(), true);
    assert.equal(await page.locator('#tab-btn-afterburner').evaluate(el => el.classList.contains('active')), true);
    results.push('Calibration and Sequence links reveal and highlight the matching fitted-device workflow');

    await reset(page);
    await patchHardware(page, { cluster_serial: { enabled: false, tx_pin: -1, rx_pin: -1 } });
    await goto(page, 'config.html', '#cf-cl_n1');
    assert.equal(await page.locator('#cf-cl_en').count(), 0, 'cluster transmission must have only the Hardware enable');
    assert.equal(await page.locator('#cf-cl_n1').isVisible(), false, 'cluster thresholds stay hidden when cluster hardware is disabled');
    await goto(page, 'hardware.html', '#hardware-comms-summary');
    await page.locator('#btn-edit-comms').click();
    assert.match(await text(page, '#hardware-comms-summary'), /Cluster TX GPIO|Cluster RX GPIO|TX-only/i);
    assert.ok(await page.locator('#hardware-comms-summary option[value="-1"]').count() >= 1);
    results.push('cluster Hardware enable is authoritative and TX-only/two-way setup exposes the telemetry RX option');

    await reset(page);
    const timerOnlyHardware = (await (await page.request.get(`${base}/api/hardware`)).json());
    await patchHardware(page, {
      channel_registry: {
        ...timerOnlyHardware.channel_registry,
        inputs: timerOnlyHardware.channel_registry.inputs.filter(channel => ['throttle','idle'].includes(channel.purpose)),
        outputs: timerOnlyHardware.channel_registry.outputs.filter(channel => ['main_fuel','oil_pump','igniter'].includes(channel.purpose))
      }
    });
    await goto(page, 'sequence.html', '#add-startup-sel');
    assert.equal(await page.locator('#tab-startup > .add-row > button').count(), 2);
    assert.doesNotMatch(await text(page, '#tab-startup > .add-row'), /compressor pressure|pressure rise|stable pressure/i);
    assert.match(await text(page, '#tab-startup > .add-row'), /Add block.*Custom block/is);
    assert.equal(await page.locator('#add-startup-sel option[value="OilPrime"]').count(), 1);
    for (const block of ['StarterSpin','Spool','SafetyHold','WaitTOTCool']) {
      assert.equal(await page.locator(`#add-startup-sel option[value="${block}"]`).count(), 0, `${block} should not be offered without the feedback it requires`);
    }
    results.push('timer-only profiles do not offer sequence blocks that can only fault or do nothing without feedback hardware');

    await reset(page);
    const sequenceMismatchHardware = (await (await page.request.get(`${base}/api/hardware`)).json());
    await patchHardware(page, {
      channel_registry: {
        ...sequenceMismatchHardware.channel_registry,
        outputs: sequenceMismatchHardware.channel_registry.outputs.filter(channel => channel.purpose !== 'oil_pump')
      }
    });
    await scenario(page, 'minimal');
    await goto(page, 'sequence.html', '#save-btn');
    assert.equal(await page.locator('#save-btn').isDisabled(), true);
    assert.equal(await page.locator('#seq-discard-btn').isDisabled(), true);
    const missingOilBlock = page.locator('.block-card', { hasText: 'Oil Pump On' }).first();
    assert.match(await missingOilBlock.getAttribute('class'), /block-hardware-missing/);
    assert.match(await missingOilBlock.textContent(), /Missing hardware/i);
    await missingOilBlock.getByRole('button', { name: 'Move block down' }).click();
    assert.equal(await page.locator('#save-btn').isDisabled(), false);
    assert.equal(await page.locator('#seq-discard-btn').isDisabled(), false);
    await page.locator('#save-btn').click();
    await page.waitForSelector('#ot-app-dialog.show');
    assert.match(await page.locator('#ot-dialog-message').textContent(), /Oil Pump On.*cannot run with the fitted hardware/is);
    await page.locator('#ot-dialog-confirm').click();
    results.push('sequence cards expose missing hardware immediately and block an invalid save');

    await reset(page);
    await patchHardware(page, {
      has_two_shaft: false,
      has_afterburner: false,
      actuators: { prop_pitch: { enabled: false }, ab_sol: { enabled: true }, ab_pump: { enabled: true } },
      sensors: { n2_rpm: { enabled: true } }
    });
    await goto(page, 'sequence.html', '#save-btn');
    assert.equal(await visible(page, '#tab-btn-afterburner'), true);
    assert.equal(await page.locator('#add-startup-sel option[value*="AB"]').count(), 0);
    await page.locator('.seq-tab', { hasText: 'Control Rules' }).click();
    assert.equal(await page.locator('#rule-sensor-0 option[value="6"]').isDisabled(), false);
    assert.equal(await page.locator('#rule-act-0 option[value="11"]').isDisabled(), false);
    results.push('sequencer and rules expose fitted N2/afterburner devices without obsolete master flags');

    await reset(page);
    await patchHardware(page, {
      channel_registry: {version:1, inputs:[
        {id:'operator_throttle',name:'Throttle Input',purpose:'throttle',role:'operator',driver:3,pin:4,min:1000,max:2000},
        {id:'operator_idle',name:'Idle Input',purpose:'idle',role:'operator',driver:3,pin:16,min:1000,max:2000}
      ], outputs:[], bindings:[{key:'operator_throttle',channel:'operator_throttle'}]},
      sensors: {
        oil_press: { enabled: false },
        flame: { enabled: false },
        p1: { enabled: false },
        p2: { enabled: false },
        throttle_input: { enabled: true, rc_pwm: true },
        idle_input: { enabled: true, rc_pwm: true }
      }
    });
    await patchData(page, {
      has_oil_press: false,
      has_flame: false,
      has_p1: false,
      has_p2: false,
      throttle_input_type: 'servo',
      throttle_input_us: 1510,
      idle_input_type: 'servo',
      idle_input_us: 1320
    });
    await goto(page, 'calibration.html', '#throttle-cal-row');
    assert.equal(await visible(page, '#oil-press-cal-row'), false);
    assert.equal(await visible(page, '#flame-cal-row'), false);
    assert.equal(await visible(page, '#p1-cal-row'), false);
    assert.match(await text(page, '#cal-th-raw'), /1510.*(us|s)/i);
    assert.match(await text(page, '#cal-idle-raw'), /1320.*(us|s)/i);
    results.push('calibration hides absent sensors and labels servo pulse units');

    await reset(page);
    await goto(page, 'log.html', '#tab-session');
    await page.locator('#tab-session').click();
    await page.request.delete(`${base}/api/session/all`);
    await page.reload();
    await page.waitForSelector('#tab-session');
    await page.locator('#tab-session').click();
    await page.waitForTimeout(300);
    assert.match(await text(page, 'body'), /No session|No data|empty|CSV/i);
    results.push('session log page handles empty log state without breaking controls');

    await reset(page);
    await patchData(page, {
      config_version_mismatch: true,
      flash_free_kb: 24,
      mode: 'STANDBY',
      dev_mode: false,
      bench_mode: false
    });
    await goto(page, 'tools.html', '#tool-area');
    assert.match(await text(page, '#cfg-version-mismatch-banner'), /schema mismatch|review/i);
    assert.match(await text(page, '#card-WEB-ASSETS'), /without erasing config or logs/i);
    assert.equal(await visible(page, '#card-TOGGLE_BENCH_MODE'), false);
    await patchData(page, { dev_mode: true });
    await page.waitForFunction(() => {
      const el = document.querySelector('#card-TOGGLE_BENCH_MODE');
      return !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
    }, null, { timeout: 3000 });
    assert.equal(await visible(page, '#card-TOGGLE_BENCH_MODE'), true);
    results.push('tools page surfaces schema/version warnings and gates bench mode behind dev mode');

    for (const route of ['index.html', 'hardware.html', 'config.html', 'sequence.html', 'calibration.html', 'tools.html', 'log.html']) {
      await assertNoSevereLayoutIssues(page, route, { width: 390, height: 844 });
      assert.equal(await page.locator('#ot-nav-more').count(), 0, `${route} should not inject a floating More button`);
      await assertNoSevereLayoutIssues(page, route, { width: 1366, height: 768 });
    }
    results.push('main pages avoid major overflow, clipped controls, and stray floating navigation buttons');

    assert.deepEqual(consoleErrors, [], 'browser console should stay free of errors');
    assert.deepEqual(badResponses.filter(r => !/simulated|api\/ecu_config/.test(r)), [], 'browser should not request missing app resources');

    console.log(`Pre-hardware UX audit passed (${results.length} groups):`);
    for (const result of results) console.log(`- ${result}`);
  } finally {
    await browser.close();
  }
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
