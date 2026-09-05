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
    await patchData(page, { mode: 'STANDBY' });
    await page.reload();
    await page.waitForSelector('#getting-started-banner');
    const gs = await text(page, '#getting-started-banner');
    assert.match(gs, /Commissioning checklist/i);
    assert.match(gs, /Hardware/i);
    assert.match(gs, /safety limits/i);
    assert.match(gs, /Calibrate/i);
    assert.match(gs, /not physical verification/i);
    assert.doesNotMatch(gs, /completed on this browser/i);
    assert.equal(await page.locator('#getting-started-banner a[href="/hardware.html?v=20260905b"]').count(), 1);
    assert.equal(await page.locator('#getting-started-banner a[href="/controllers.html?v=20260905b"]').count(), 1);
    assert.equal(await page.locator('#getting-started-banner a[href="/calibration.html?v=20260905b"]').count(), 1);
    await page.evaluate(() => localStorage.setItem('openturbine_setup_progress_v1',
      JSON.stringify({ hardware: Date.now(), tools: Date.now() })));
    await page.reload();
    await page.waitForSelector('#getting-started-banner');
    assert.match(await text(page, '#gs-progress'), /2 of 5 setup activities recorded/i);
    assert.match(await text(page, '[data-setup-step="hardware"] .gs-step-state'), /Hardware saved/i);
    assert.match(await text(page, '[data-setup-step="tools"] .gs-step-state'), /Tool command completed/i);
    await page.evaluate(() => {
      localStorage.setItem('openturbine_setup_progress_v1', JSON.stringify({
        hardware: 1, config: 1, calibration: 1, sequence: 1, tools: 1
      }));
      OTSetup.mark('hardware');
    });
    assert.deepEqual(await page.evaluate(() => Object.keys(OTSetup.state()).sort()), ['hardware']);
    results.push('commissioning checklist gives a clear setup path without presenting browser activity as physical verification');

    const blankResponse = await page.request.post(`${base}/__sim/blank`);
    assert.equal(blankResponse.ok(), true);
    await goto(page, 'hardware.html', '#hardware-profile-section');
    await page.locator('button[onclick="addRegistryChannel(\'input\')"]').click();
    await page.locator('#registry-add-catalog .registry-add-option', { hasText: 'TOT / EGT' }).click();
    assert.match(await text(page, '#registry-add-error'), /MAX thermocouple amplifier.*shared SPI wiring.*SCK and MISO.*CS pin/is);
    const spiSetupButton = page.locator('#registry-add-error button[onclick="openRegistryBusPrerequisite(\'spi\')"]');
    assert.equal(await spiSetupButton.count(), 1);
    await spiSetupButton.click();
    assert.equal(await visible(page, '#hardware-buses-editor'), true);
    assert.equal(await page.locator('#en-spi').evaluate(el => document.activeElement === el), true);
    results.push('bus-dependent devices explain the electrical prerequisite and lead directly to its wiring controls');

    await reset(page);
    await goto(page, 'hardware.html', '#hardware-profile-section');
    assert.match(await text(page, '#save-msg'), /Loaded|Converted/i);
    assert.equal(await page.locator('#btn-save').isDisabled(), true);
    assert.equal(await page.locator('#btn-discard').isDisabled(), true);
    const migratedInputs = await text(page, '#registry-inputs');
    const migratedOutputs = await text(page, '#registry-outputs');
    for (const name of ['N1 Speed', 'N2 Speed', 'Main TOT', 'Fuel Pressure', 'Oil Temp', 'AB Flame'])
      assert.match(migratedInputs, new RegExp(name));
    for (const name of ['Main Fuel Metering', 'Starter', 'Fuel Shutoff', 'AB Igniter', 'AB Fuel Valve', 'AB Fuel Pump', 'Glow Plug'])
      assert.match(migratedOutputs, new RegExp(name));
    assert.match(await text(page, '#builtin-inputs'), /Afterburner trigger and arm.*Manual \/ browser command/is);
    const oilTempStatus = await page.locator('#registry-inputs .registry-card').evaluateAll(cards =>
      cards.find(card => card.querySelector('strong')?.textContent.trim() === 'Oil Temp')?.querySelector('.registry-status')?.textContent || '');
    assert.match(oilTempStatus, /GPIO 15 is not ADC1-capable/i);
    assert.match(await text(page, '#save-msg'), /Loaded/i);
    results.push('canonical inventory exposes every fitted sensor, actuator, AB control and invalid board pin before save');

    await goto(page, 'calibration.html', '#calibration-jump');
    const calibrationTargets = await page.locator('#calibration-jump option').allTextContents();
    for (const expected of ['Minimum Reliable Fuel-Metering Output', 'Oil Pressure', 'Flame / Ignition', 'Throttle Input', 'Battery Voltage'])
      assert.ok(calibrationTargets.some(label => label.includes(expected)), `calibration jump list should include ${expected}`);
    await page.locator('#calibration-jump').selectOption('oil-press-cal-row');
    assert.equal(await page.locator('#oil-press-cal-row').evaluate(row => row.classList.contains('deep-link-target')), true);
    assert.deepEqual(await page.locator('input:visible,select:visible').evaluateAll(fields =>
      fields.filter(field => !(field.title || field.closest('label')?.title))
        .map(field => field.id || field.getAttribute('aria-label') || field.type)), [],
      'every visible calibration field needs hover help');
    results.push('calibration page provides a compact index of fitted sensors and actuators');

    await goto(page, 'hardware.html', '#hardware-profile-section');
    await page.locator('button[onclick="addRegistryChannel(\'input\')"]').click();
    const inputAddChoices = await page.locator('#registry-add-catalog').evaluate(catalog =>
      Object.fromEntries(Array.from(catalog.querySelectorAll('button')).map(button => [
        button.childNodes[0]?.textContent?.trim(),
        { disabled: button.disabled, detail: button.querySelector('.registry-add-default')?.textContent?.trim() || '', description: button.querySelector('small')?.textContent?.trim() || '' }
      ]))
    );
    for (const label of ['N1 speed', 'N2 speed', 'TOT / EGT', 'TIT', 'AB flame', 'Throttle input', 'Idle input']) {
      assert.equal(inputAddChoices[label]?.disabled, true, `${label} should not be addable twice`);
      assert.match(inputAddChoices[label]?.detail || '', /already installed/i);
    }
    for (const label of ['Oil pressure', 'Additional shaft speed', 'Generic digital input']) {
      assert.doesNotMatch(inputAddChoices[label]?.detail || '', /already installed/i);
      if (inputAddChoices[label]?.disabled) assert.match(inputAddChoices[label]?.detail || '', /capacity full/i);
    }
    assert.match(inputAddChoices['N2 speed']?.description || '', /power-turbine|propeller shaft/i);
    assert.match(inputAddChoices['TOT / EGT']?.description || '', /MAX31855.*default/i);
    assert.match(inputAddChoices['TIT']?.description || '', /MAX31855.*default/i);
    assert.match(inputAddChoices['AB flame']?.description || '', /afterburner.*flame/i);
    assert.match(inputAddChoices['General flow']?.description || '', /repeatable user-named flow measurement/i);
    assert.match(inputAddChoices['General current']?.description || '', /not tied to an output/i);
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
    // Outputs may legitimately be multi-instance (series valves, redundant
    // pumps, auxiliary starters, etc.). A full test inventory can still make
    // every catalog entry unavailable because the channel capacity is real.
    for (const label of ['Main fuel pump', 'Starter', 'Starter enable', 'Fuel shutoff', 'Igniter', 'AB igniter', 'Afterburner fuel shutoff valve', 'Afterburner fuel pump', 'Glow plug', 'Pilot fuel', 'Prop pitch', 'Relay output', 'PWM output']) {
      assert.doesNotMatch(outputAddChoices[label]?.detail || '', /already installed/i);
      if (outputAddChoices[label]?.disabled) assert.match(outputAddChoices[label]?.detail || '', /capacity full/i);
    }
    assert.match(outputAddChoices['Afterburner fuel pump']?.description || '', /afterburner manifold/i);
    assert.match(outputAddChoices['Afterburner fuel shutoff valve']?.description || '', /admits fuel|normally closed/i);
    assert.match(outputAddChoices['Glow plug']?.description || '', /hot-surface ignition/i);
    assert.match(outputAddChoices['Pilot fuel']?.description || '', /Sequence and Controllers.*separate from.*wet glow plug/i);
    await page.locator('#registry-add-modal button[onclick="closeRegistryAddDialog()"]' ).click();
    assert.equal(await page.locator('#registry-inputs .registry-card[data-registry-id="oil_flow"]').count(), 0);
    const oilPumpCard = page.locator('#registry-outputs .registry-card[data-registry-id="oil_pump"]');
    await oilPumpCard.locator('button', {hasText:'Edit'}).click();
    assert.match((await oilPumpCard.textContent()).trim(), /Flow sensing & monitoring.*Main oil-pump flow sensor.*Pulses \/ litre.*Minimum flow.*Safety & Limits.*Oil Pressure Safety/is);
    assert.match((await oilPumpCard.textContent()).trim(), /Current sensing.*Calibration page/is);
    assert.equal(await oilPumpCard.locator('a[href="/controllers.html?v=20260905b#cf-oil_mm"]').count(), 1);
    assert.equal(await oilPumpCard.locator('a[href="/controllers.html?v=20260905b#cf-so_en"]').count(), 1);
    assert.equal(await oilPumpCard.locator('a[href="/sequence.html?v=20260905b#tab-startup"]').count(), 1);
    results.push('add-device catalog reserves singleton checks for sensors while multi-instance outputs and pump-owned monitoring remain clear');

    const savedHardware = await page.evaluate(() => structuredClone(cfg));
    await page.evaluate(() => {
      cfg.channel_registry = {version:1, bindings:[], inputs:[], outputs:[], input_capacity:16, output_capacity:16};
      cfg.actuators ||= {};
      renderRegistryInventory();
    });
    await page.locator('button[onclick="addRegistryChannel(\'output\')"]').click();
    await page.getByRole('button', {name:/^Glow plug /}).click();
    await page.evaluate(() => {
      setRegistryGlowType(2);
      setRegistryWetGlowDelaySeconds(3.5);
    });
    const wetGlow = await page.evaluate(() => ({
      outputs: cfg.channel_registry.outputs.map(({id,name,purpose}) => ({id,name,purpose})),
      legacyType: cfg.actuators.glow_plug.type,
      fuelPin: cfg.actuators.glow_plug.fuel_pin,
      fuelDelayMs: cfg.actuators.glow_plug.fuel_delay_ms
    }));
    assert.equal(wetGlow.outputs.length, 1);
    assert.deepEqual(wetGlow.outputs.map(row => row.purpose), ['glow_plug']);
    assert.equal(wetGlow.legacyType, 2);
    assert.equal(wetGlow.fuelPin, -1);
    assert.equal(wetGlow.fuelDelayMs, 3500);
    assert.match(await text(page, '#registry-outputs'), /Glow Plug.*Glow-plug type.*Wet glow plug.*Wet-glow pilot fuel.*Pilot-fuel GPIO.*Pilot-fuel delay \(seconds\)/is);
    await page.evaluate(saved => {
      Object.keys(cfg).forEach(key => delete cfg[key]);
      Object.assign(cfg, saved);
      renderRegistryInventory();
    }, savedHardware);
    results.push('Glow plug selects normal or wet mode in one card with dedicated delayed pilot-fuel hardware');

    const multiPumpFlow = await page.evaluate(() => {
      cfg.channel_registry = {version:1, bindings:[], inputs:[
        {id:'oil_flow',name:'Legacy Oil Flow',purpose:'oil_flow',role:'flow',driver:2,pin:4,min:0,max:1}
      ], outputs:[
        {id:'abcdefghij_primary',name:'Oil Pump 1',purpose:'oil_pump',role:'oil_pump',driver:5,pin:16,min:0,max:1,has_flow_monitor:true},
        {id:'abcdefghij_aux_one',name:'Oil Pump 2',purpose:'oil_pump',role:'oil_pump',driver:5,pin:17,min:0,max:1},
        {id:'abcdefghij_aux_two',name:'Oil Pump 3',purpose:'oil_pump',role:'oil_pump',driver:5,pin:18,min:0,max:1}
      ]};
      setPumpFlowSensorEnabled(0, true);
      setPumpFlowSensorEnabled(1, true);
      setPumpFlowSensorEnabled(2, true);
      return {
        links: cfg.channel_registry.outputs.map(row => row.flow_input || ''),
        ids: cfg.channel_registry.inputs.map(row => row.id),
        secondLookup: pumpFlowInput(cfg.channel_registry.outputs[1]).channel?.id || '',
        thirdLookup: pumpFlowInput(cfg.channel_registry.outputs[2]).channel?.id || ''
      };
    });
    assert.notEqual(multiPumpFlow.links[0], 'oil_flow', 'an unlinked standalone/legacy flow sensor must not be claimed when several pumps exist');
    assert.equal(multiPumpFlow.ids.includes('oil_flow'), true, 'standalone flow input must be preserved');
    assert.equal(new Set(multiPumpFlow.links).size, 3);
    assert.equal(new Set(multiPumpFlow.ids).size, 4);
    assert.equal(multiPumpFlow.secondLookup, multiPumpFlow.links[1]);
    assert.equal(multiPumpFlow.thirdLookup, multiPumpFlow.links[2]);
    results.push('multiple oil pumps receive deterministic independent flow sensors with collision-safe IDs');

    await reset(page);
    await goto(page, 'hardware.html', '#registry-inputs');

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
    await goto(page, 'system.html', '#system-device-setup');
    await scenario(page, 'startup');
    await page.reload();
    await page.waitForSelector('#cfg-restore-btn', {state:'attached'});
    await page.waitForFunction(() => typeof runtimeMode === 'string' && runtimeMode === 'STARTUP');
    assert.equal(await page.locator('#cfg-restore-btn').isDisabled(), true);
    await scenario(page, 'minimal');
    await page.reload();
    await page.waitForSelector('#cfg-restore-btn', {state:'attached'});
    await page.waitForFunction(() => !document.getElementById('cfg-restore-btn')?.disabled);
    assert.equal(await page.locator('#cfg-restore-btn').isDisabled(), false);
    assert.match(await text(page, '#system-backup-restore'), /STANDBY/i);
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
    await goto(page, 'hardware.html', '#hardware-profile-section');
    await page.waitForFunction(() => /Loaded|Converted/i.test(document.querySelector('#save-msg')?.textContent || ''));
    assert.match(await text(page, '#save-msg'), /Loaded|Converted/i);
    assert.equal(await page.locator('#btn-save').isDisabled(), true);
    assert.equal(await page.locator('#btn-discard').isDisabled(), true);
    assert.deepEqual(
      await page.evaluate(() => registryRoleUsage('input', { purpose:'start_switch', role:'switch' })),
      ['Core firmware: START command']
    );
    assert.deepEqual(
      await page.evaluate(() => registryRoleUsage('input', { purpose:'stop_switch', role:'switch' })),
      ['Core firmware: hard stop and shutdown command']
    );
    results.push('hardware page reaches a clear loaded state before edits');

    await page.locator('button', { hasText: '+ Add input' }).click();
    await page.getByRole('button', { name: /N2 speed/i }).click();
    const draftedN2 = page.locator('#registry-inputs .registry-card').last();
    const gpio32Option = draftedN2.locator('select').nth(2).locator('option[value="32"]');
    assert.equal(await gpio32Option.isDisabled(), false);
    assert.doesNotMatch(await gpio32Option.textContent(), /AB flame/i);
    await draftedN2.locator('select').nth(2).selectOption('35');
    await page.waitForFunction(() => {
      const card = Array.from(document.querySelectorAll('#registry-inputs .registry-card')).at(-1);
      return /GPIO 35/.test(card?.textContent || '') && /Ready/.test(card?.textContent || '');
    });
    assert.match(await draftedN2.textContent(), /N2 Speed.*GPIO 35.*Ready/is);
    assert.equal(await page.locator('#btn-save').isDisabled(), false);
    await page.locator('button', { hasText: '+ Add output' }).click();
    await page.getByRole('button', { name: /AB igniter/i }).click();
    const draftedAbIgniter = page.locator('#registry-outputs .registry-card').last();
    await draftedAbIgniter.locator('select').nth(2).selectOption('17');
    await page.waitForFunction(() => {
      const card = Array.from(document.querySelectorAll('#registry-outputs .registry-card')).at(-1);
      return /GPIO 17/.test(card?.textContent || '') && /Ready/.test(card?.textContent || '');
    });
    assert.equal(await draftedAbIgniter.locator('select').nth(1).inputValue(), '4');
    assert.equal(await draftedAbIgniter.locator('select').nth(3).inputValue(), '0',
      'a new relay output should default to Active high polarity');
    assert.equal(await draftedAbIgniter.locator('.registry-subcard', { hasText: 'Current sensing' }).locator('input[type="checkbox"]').isChecked(), false);
    assert.doesNotMatch(await draftedAbIgniter.textContent(), /Current sensing required/i);
    await page.reload();
    await page.waitForSelector('#registry-outputs .registry-card');
    results.push('new cards ignore phantom legacy pins, refresh readiness, and reset stale device-specific modes');

    const topologyMutation = await page.evaluate(() => {
      const oldRegistry = cfg.channel_registry;
      const oldStartup = cfg.startup_enter_actions;
      const oldCustom = cfg.custom_blocks;
      const oldRules = settingsCfg.rules;
      try {
        cfg.channel_registry = {
          inputs:[],
          outputs:[
            {id:'main_fuel',name:'Primary fuel',purpose:'main_fuel',role:'fuel',driver:5,pin:25,min:0,max:1},
            {id:'spare_pwm',name:'Spare PWM',purpose:'warning_indicator',role:'indicator',driver:5,pin:26,min:0,max:1},
            {id:'tail_pwm',name:'Tail PWM',purpose:'warning_indicator',role:'indicator',driver:5,pin:27,min:0,max:1}
          ],
          bindings:[{key:'main_fuel_output',channel:'main_fuel'}]
        };
        updateRegistryChannel('output', 1, 'purpose', 'main_fuel');
        const ownerPreserved = cfg.channel_registry.bindings.find(b => b.key === 'main_fuel_output')?.channel === 'main_fuel';

        cfg.startup_enter_actions = [[{act:66}]];
        cfg.custom_blocks = {tail_action:{type:'action',steps:[{actuator:66,act:66,target:66}]}};
        settingsCfg.rules = [{sensor:0,actuator:66}];
        cleanupRegistryReferences('output', 'spare_pwm');
        shiftRegistryNumericHandlesAfterRemoval('output', 1, 3);
        cfg.channel_registry.outputs.splice(1, 1);
        const refs = {
          side:cfg.startup_enter_actions[0][0].act,
          actuator:cfg.custom_blocks.tail_action.steps[0].actuator,
          act:cfg.custom_blocks.tail_action.steps[0].act,
          target:cfg.custom_blocks.tail_action.steps[0].target,
          rule:settingsCfg.rules[0].actuator
        };
        return {ownerPreserved, refs, tailId:cfg.channel_registry.outputs[1]?.id};
      } finally {
        cfg.channel_registry = oldRegistry;
        cfg.startup_enter_actions = oldStartup;
        cfg.custom_blocks = oldCustom;
        settingsCfg.rules = oldRules;
        renderRegistryInventory();
      }
    });
    assert.equal(topologyMutation.ownerPreserved, true,
      're-purposing a spare output must not silently steal the existing primary binding');
    assert.deepEqual(topologyMutation.refs, {side:65, actuator:65, act:65, target:65, rule:65});
    assert.equal(topologyMutation.tailId, 'tail_pwm');
    results.push('output re-purpose and removal keep explicit ownership and surviving numeric references attached to the same card');

    const mainFuelCard = page.locator('#registry-outputs .registry-card').first();
    assert.match(await mainFuelCard.locator('strong').first().textContent(), /Main Fuel Metering/);
    assert.equal(await mainFuelCard.locator('button', { hasText: 'Add mirrored output' }).count(), 1,
      'core-purpose outputs can explicitly add a second electrical endpoint for the same command');
    const mirrorBehavior = await page.evaluate(() => {
      const before = JSON.stringify(registryRoot().outputs);
      duplicateRegistryChannel(0);
      const source = registryRoot().outputs[0];
      const copy = registryRoot().outputs.at(-1);
      const result = {
        source: copy.mirror_of,
        expected: source.id,
        unassigned: copy.pin === -1,
        independentCurrent: copy.has_current === false,
        independentFlow: copy.has_flow_monitor === false,
        adjacent: (() => {
          const cards = [...document.querySelectorAll('#registry-outputs .registry-card')];
          const sourceIndex = cards.findIndex(card => card.dataset.registryId === source.id);
          return sourceIndex >= 0 && cards[sourceIndex + 1]?.dataset.registryId === copy.id;
        })(),
        marked: [...document.querySelectorAll('#registry-outputs .registry-card')]
          .find(card => card.dataset.registryId === copy.id)?.textContent.includes('Mirrored output of') === true
      };
      registryRoot().outputs = JSON.parse(before);
      renderRegistryInventory();
      return result;
    });
    assert.deepEqual(mirrorBehavior, {
      source:'main_fuel', expected:'main_fuel', unassigned:true,
      independentCurrent:true, independentFlow:true, adjacent:true, marked:true
    });
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
    const hardwareFieldsWithoutHelp = [];
    for (let i = 0; i < await installedOutputCards.count(); i++) {
      const card = installedOutputCards.nth(i);
      await card.locator('button', { hasText: 'Edit' }).click();
      hardwareFieldsWithoutHelp.push(...await card.locator('input,select,textarea').evaluateAll((fields, cardIndex) =>
        fields.filter(field => {
          const wrapper = field.closest('.hw-field') || field.closest('label');
          const subcard = field.closest('.current-sense-block, .registry-subcard');
          const help = wrapper?.querySelector('.hw-desc')?.textContent?.trim() ||
            subcard?.querySelector('.hw-desc')?.textContent?.trim() ||
            field.getAttribute('title')?.trim() || wrapper?.getAttribute('title')?.trim() || '';
          return help.length < 8;
        }).map(field => `output ${cardIndex + 1}: ${field.getAttribute('aria-label') || field.id || field.name || field.closest('label')?.textContent?.trim() || field.type}`), i));
      const fallback = card.locator('input[onchange*="force_safe_on_fault"]');
      const fixedInvariant = card.getByText('Running fault state', { exact:true });
      assert.equal((await fallback.count()) + (await fixedInvariant.count()), 1);
      if (await fallback.count()) assert.equal(await fallback.isChecked(), false);
      await card.locator('button', { hasText: 'Done' }).click();
    }
    assert.deepEqual(hardwareFieldsWithoutHelp, [],
      `every installed output field needs nearby explanatory help: ${hardwareFieldsWithoutHelp.join(', ')}`);
    const installedInputCards = page.locator('#registry-inputs .registry-card');
    const hardwareInputFieldsWithoutHelp = [];
    for (let i = 0; i < await installedInputCards.count(); i++) {
      const card = installedInputCards.nth(i);
      await card.locator('button', { hasText: 'Edit' }).click();
      hardwareInputFieldsWithoutHelp.push(...await card.locator('input,select,textarea').evaluateAll((fields, cardIndex) =>
        fields.filter(field => {
          const wrapper = field.closest('.hw-field') || field.closest('label');
          const subcard = field.closest('.registry-subcard');
          const help = wrapper?.querySelector('.hw-desc')?.textContent?.trim() ||
            subcard?.querySelector('.hw-desc')?.textContent?.trim() ||
            field.getAttribute('title')?.trim() || wrapper?.getAttribute('title')?.trim() || '';
          return help.length < 8;
        }).map(field => `input ${cardIndex + 1}: ${field.getAttribute('aria-label') || field.id || field.name || field.closest('label')?.textContent?.trim() || field.type}`), i));
      await card.locator('button', { hasText: 'Done' }).click();
    }
    assert.deepEqual(hardwareInputFieldsWithoutHelp, [],
      `every installed input field needs nearby explanatory help: ${hardwareInputFieldsWithoutHelp.join(', ')}`);
    const igniterCard = page.locator('#registry-outputs .registry-card[data-registry-id="igniter"]');
    await igniterCard.locator('button', { hasText: 'Edit' }).click();
    assert.equal(await igniterCard.evaluate(card => {
      const behavior = Array.from(card.querySelectorAll('strong')).find(el => el.textContent.trim().startsWith('Igniter behavior'));
      const advanced = Array.from(card.querySelectorAll('summary')).find(el => el.textContent.trim() === 'Advanced output settings');
      return !!behavior && !!advanced && !!(behavior.compareDocumentPosition(advanced) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), true);
    await igniterCard.locator('button', { hasText: 'Done' }).click();

    let faultOverrideCard = null;
    let mainFuelFaultFallback = null;
    for (let i = 0; i < await installedOutputCards.count(); i++) {
      const card = installedOutputCards.nth(i);
      await card.locator('button', { hasText: 'Edit' }).click();
      const advanced = card.locator('summary', { hasText: 'Advanced output settings' });
      if (await advanced.count()) await advanced.click();
      const candidate = card.locator('input[onchange*="force_safe_on_fault"]');
      if (await candidate.count()) { faultOverrideCard = card; mainFuelFaultFallback = candidate; break; }
      await card.locator('button', { hasText: 'Done' }).click();
    }
    assert.ok(faultOverrideCard, 'at least one general/mechanical output keeps the configurable fault override');
    await mainFuelFaultFallback.check();
    assert.equal(await faultOverrideCard.evaluate(el => el.classList.contains('field-changed')), true);
    const faultFallbackChanges = await page.evaluate(() => _buildChanges());
    assert.match(JSON.stringify(faultFallbackChanges), /Force safe state on fault.*Disabled.*Enabled/is);
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
    assert.match(await text(page, '#save-recap-body'), /Force safe state on fault.*Disabled.*Enabled/is);
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

    const registryCalibrationRecap = await page.evaluate(() => {
      const before = {version:1, bindings:[], inputs:[
        {id:'test_pressure',name:'Test Pressure',purpose:'coolant_pressure',role:'pressure',driver:9,pin:-1,
         i2c_address:16,device_channel:0,min:0,max:4095,analog_zero_mv:500,analog_mv_per_unit:400,
         analog_divider:1,i2c_reference_mv:3300,filter_alpha:1,calibration_points:[]},
        {id:'test_thrust',name:'Test Thrust',purpose:'thrust',role:'thrust',driver:10,pin:-1,
         i2c_address:42,device_channel:0,min:0,max:1,loadcell_gain:128,loadcell_rate_sps:80,
         loadcell_zero:0,loadcell_n_per_count:1,lever_arm_m:0,filter_alpha:.25}
      ], outputs:[
        {id:'test_scavenge',name:'Test Scavenge',purpose:'scavenge_pump',role:'scavenge_pump',driver:5,pin:18,
         min:0,max:1,has_flow_monitor:true,minimum_flow_l_min:.1,flow_input:'flow_a'},
        {id:'test_relay',name:'Test Relay',purpose:'generic',role:'generic',driver:11,pin:-1,
         i2c_address:32,device_channel:0,min:0,max:1,has_current:false}
      ]};
      cfg.channel_registry = structuredClone(before);
      _registrySnap = structuredClone(before);
      cfg.channel_registry.inputs[0].i2c_address = 17;
      cfg.channel_registry.inputs[0].device_channel = 3;
      cfg.channel_registry.inputs[0].analog_zero_mv = 625;
      cfg.channel_registry.inputs[0].calibration_points = [{raw:200,value:0},{raw:3800,value:12}];
      cfg.channel_registry.inputs[1].loadcell_gain = 64;
      cfg.channel_registry.inputs[1].loadcell_zero = 12345;
      cfg.channel_registry.inputs[1].loadcell_n_per_count = .002;
      cfg.channel_registry.outputs[0].flow_input = 'flow_b';
      cfg.channel_registry.outputs[1].i2c_address = 33;
      cfg.channel_registry.outputs[1].device_channel = 4;
      cfg.channel_registry.outputs[1].has_current = true;
      cfg.channel_registry.outputs[1].current_pin = 34;
      return [..._registryDiffRows('input'), ..._registryDiffRows('output')];
    });
    const registryCalibrationRecapText = JSON.stringify(registryCalibrationRecap);
    for (const expected of ['I2C address','Device channel','Analog zero offset','Multi-point calibration curve',
                            'Load-cell gain','Load-cell zero','Load-cell scale','Flow sensor','Current sensing','Current sensor pin'])
      assert.match(registryCalibrationRecapText, new RegExp(expected, 'i'));
    assert.equal((registryCalibrationRecapText.match(/I2C address/gi) || []).length, 2,
      'both input and output I2C routing changes must be reviewable');
    assert.doesNotMatch(registryCalibrationRecapText, /\[object Object\]/,
      'multi-point calibration recap must remain readable');
    await page.reload();
    await page.waitForSelector('#registry-outputs .registry-card');
    results.push('hardware save review includes every editable I2C, curve, load-cell, and flow-routing change');

    const concurrentRegistryMerge = await page.evaluate(() => {
      const base = {channel_registry:{version:1,bindings:[],inputs:[
        {id:'pressure_a',name:'Pressure A',purpose:'coolant_pressure',role:'pressure',driver:9,pin:-1,
         i2c_address:16,device_channel:0,min:0,max:4095,analog_zero_mv:500,analog_mv_per_unit:400},
        {id:'pressure_b',name:'Pressure B',purpose:'generic',role:'generic',driver:9,pin:-1,
         i2c_address:16,device_channel:1,min:0,max:4095,calibration_points:[]}
      ],outputs:[]}};
      const edited = structuredClone(base);
      edited.channel_registry.inputs[0].name = 'Oil Gallery';
      const fresh = structuredClone(base);
      fresh.channel_registry.inputs[0].analog_zero_mv = 612;
      fresh.channel_registry.inputs[1].calibration_points = [{raw:100,value:0},{raw:3900,value:10}];
      fresh.channel_registry.inputs.push({id:'fresh_input',name:'Fresh Input',purpose:'generic',role:'generic',driver:0,pin:21,min:0,max:1});
      const merged = mergeHardwareEdits(base, edited, fresh);
      return merged.channel_registry.inputs;
    });
    assert.equal(concurrentRegistryMerge.find(row => row.id === 'pressure_a').name, 'Oil Gallery');
    assert.equal(concurrentRegistryMerge.find(row => row.id === 'pressure_a').analog_zero_mv, 612);
    assert.equal(concurrentRegistryMerge.find(row => row.id === 'pressure_b').calibration_points.length, 2);
    assert.equal(concurrentRegistryMerge.some(row => row.id === 'fresh_input'), true);
    results.push('hardware three-way save preserves concurrent per-sensor calibration and newly added registry cards');

    const digitalRegistryEditors = await page.evaluate(() => {
      const tcaSwitch = {id:'remote_stop',purpose:'stop_switch',role:'digital_switch',driver:8,min:0,max:1,active_high:false};
      const tlaSwitch = {id:'remote_gate',purpose:'sequence_gate',role:'sequence_gate',driver:9,min:0,max:4095,active_high:true};
      tlaSwitch.i2c_reference_mv = 3300;
      tlaSwitch.digital_threshold_raw = 32;
      tlaSwitch.digital_hysteresis_raw = 64;
      const analogAbFlame = {id:'ab_flame_test',purpose:'ab_flame',role:'flame',driver:1,min:0,max:4095,invert:true,active_high:true};
      const holder = document.createElement('div');
      holder.innerHTML = registryI2cEditor('input', tlaSwitch, 1);
      const hysteresisField = Array.from(holder.querySelectorAll('.hw-field')).find(field =>
        field.querySelector('.hw-label')?.textContent.includes('Switch hysteresis'));
      return {
        tcaRange: registryRangeEditor('input', tcaSwitch, 0),
        tcaOptions: registryInputOptionsEditor('input', tcaSwitch, 0),
        tlaOptions: registryInputOptionsEditor('input', tlaSwitch, 1),
        tlaHysteresisMax: Number(hysteresisField?.querySelector('input')?.max),
        tlaHysteresisValue: Number(hysteresisField?.querySelector('input')?.value),
        abInvert: registryInvertEditor('input', analogAbFlame, 2)
      };
    });
    assert.match(digitalRegistryEditors.tcaRange, /inactive.*active.*active electrical state/is);
    assert.doesNotMatch(digitalRegistryEditors.tcaRange, /type="number"/i);
    assert.match(digitalRegistryEditors.tcaOptions, /Active state.*High.*Low/is);
    assert.match(digitalRegistryEditors.tlaOptions, /Active state.*above threshold.*below threshold/is);
    assert.ok(digitalRegistryEditors.tlaHysteresisMax > 0 && digitalRegistryEditors.tlaHysteresisMax < .1);
    assert.ok(digitalRegistryEditors.tlaHysteresisValue <= digitalRegistryEditors.tlaHysteresisMax);
    assert.equal(digitalRegistryEditors.abInvert, '');
    results.push('digital and threshold I2C inputs expose one real polarity control and no ignored range or AB inversion controls');

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
      channel_registry: {version:1, inputs:[{installed:true,id:'ab_flame_main',name:'AB Flame',purpose:'ab_flame',role:'flame',driver:1,pin:32,min:0,max:4095,digital_threshold_raw:900,digital_hysteresis_raw:80,active_high:false}], outputs:[{installed:true,id:'ab_pump',name:'AB Fuel Pump',purpose:'ab_pump',role:'ab_pump',driver:5,pin:17,min:0,max:1,pwm_freq_hz:5000,pwm_res_bits:10}], bindings:[]},
      ab_trigger: {source:2, switch_pin:34, switch_active_h:true, input_pin:33, input_threshold:2048, requires_arm:true, arm_pin:35, arm_active_h:true}
    });
    await page.request.post(`${base}/__sim/scenario/minimal`);
    await goto(page, 'hardware.html', '#registry-inputs');
    assert.match(await text(page, '#registry-inputs'), /AB Flame/);
    const abFlameCard = page.locator('#registry-inputs .registry-card[data-registry-id="ab_flame_main"]');
    await abFlameCard.locator('button', {hasText:'Edit'}).click();
    assert.match(await abFlameCard.textContent(), /Flame active state.*Below threshold.*Threshold: 900 raw ADC.*Hysteresis/is);
    assert.equal(await abFlameCard.locator('input[aria-label="AB flame hysteresis"]').inputValue(), '80');
    assert.match(await text(page, '#builtin-inputs'), /Afterburner trigger and arm.*Physical trigger switch.*arm GPIO 35/is);
    assert.match(await text(page, '#save-msg'), /Loaded/i);
    assert.equal(await page.locator('.save-bar').evaluate(el => el.classList.contains('is-dirty')), false);
    results.push('canonical AB flame and trigger hardware loads as visible reviewable inventory');

    await goto(page, 'calibration.html', '#ab-flame-cal-row');
    assert.equal(await page.locator('#ab-flame-thr-direct').inputValue(), '900');
    await page.locator('#ab-flame-thr-direct').fill('1234');
    await page.locator('#ab-flame-cal-row button', {hasText:'Set threshold'}).click();
    await page.waitForFunction(() => document.querySelector('#ab-flame-status')?.textContent.includes('1234'));
    const savedAbFlame = await state(page);
    assert.equal(savedAbFlame.hardware.ab_flame, undefined);
    assert.equal(savedAbFlame.hardware.channel_registry.inputs.find(row => row.id === 'ab_flame_main').digital_threshold_raw, 1234);
    await page.locator('#ab-flame-thr-direct').fill('3601');
    await page.locator('#ab-flame-cal-row button', {hasText:'Set threshold'}).click();
    await page.waitForFunction(() => document.querySelector('#ab-flame-status')?.textContent.includes('false flame detection'));
    assert.match(await text(page, '#ab-flame-status'), /active-below.*false flame detection/is);
    await page.locator('#ab-flame-thr-direct').fill('0');
    await page.locator('#ab-flame-cal-row button', {hasText:'Set threshold'}).click();
    await page.waitForFunction(() => document.querySelector('#ab-flame-status')?.textContent.includes('weak flame'));
    assert.match(await text(page, '#ab-flame-status'), /active-below.*weak flame may not be detected/is);
    results.push('AB flame Calibration updates only the canonical registry threshold');

    const digitalAbHardware = (await (await page.request.get(`${base}/api/hardware`)).json());
    const digitalAbFlame = digitalAbHardware.channel_registry.inputs.find(row => row.id === 'ab_flame_main');
    digitalAbFlame.driver = 0;
    digitalAbFlame.active_high = false;
    await patchHardware(page, { channel_registry: digitalAbHardware.channel_registry });
    await goto(page, 'calibration.html', '#ab-flame-cal-row');
    assert.equal(await page.locator('#ab-flame-cal-row > #ab-flame-threshold-tools').count(), 1);
    assert.equal(await page.locator('#flame-cal-row > #flame-threshold-tools').count(), 1);
    assert.equal(await visible(page, '#flame-threshold-tools'), true);
    assert.equal(await visible(page, '#ab-flame-threshold-tools'), false);
    assert.match(await text(page, '#ab-flame-digital-note'), /direct On\/Off state.*active-high or active-low.*no ADC threshold/is);
    results.push('digital AB flame inputs do not expose an ineffective analog threshold wizard');

    const adcSwitchHardware = (await (await page.request.get(`${base}/api/hardware`)).json());
    adcSwitchHardware.channel_registry.inputs.push({installed:true,id:'pressure_accumulator_ready',name:'Accumulator Ready',purpose:'digital_switch',role:'digital_switch',driver:1,pin:39,min:0,max:4095,digital_threshold_raw:2048,digital_hysteresis_raw:64,active_high:true});
    await patchHardware(page, {channel_registry:adcSwitchHardware.channel_registry});
    await patchData(page, {registry_inputs:[{id:'pressure_accumulator_ready',value:0,raw:700,healthy:true}]});
    await goto(page, 'calibration.html', '#adc-switch-cal-row');
    assert.equal(await visible(page, '#adc-switch-cal-row'), true);
    const adcSwitch = page.locator('#adc-switch-cal-list [data-channel-id="pressure_accumulator_ready"]');
    await adcSwitch.locator('button', {hasText:'Capture inactive'}).click();
    await page.waitForFunction(() => document.querySelector('[data-channel-id="pressure_accumulator_ready"] [data-adc-status]')?.textContent.includes('Inactive captured'));
    await patchData(page, {registry_inputs:[{id:'pressure_accumulator_ready',value:1,raw:3300,healthy:true}]});
    await adcSwitch.locator('button', {hasText:'Capture active'}).click();
    await page.waitForFunction(() => document.querySelector('[data-channel-id="pressure_accumulator_ready"] [data-adc-status]')?.textContent.includes('Calculated threshold'));
    assert.equal(await adcSwitch.locator('[data-adc-threshold]').inputValue(), '2000');
    assert.equal(await adcSwitch.locator('[data-adc-polarity]').inputValue(), '1');
    await adcSwitch.locator('button', {hasText:'Save'}).click();
    await page.waitForFunction(() => document.querySelector('[data-channel-id="pressure_accumulator_ready"] [data-adc-status]')?.textContent === 'Saved.');
    const savedAdcSwitch = (await state(page)).hardware.channel_registry.inputs.find(row => row.id === 'pressure_accumulator_ready');
    assert.equal(savedAdcSwitch.digital_threshold_raw, 2000);
    assert.equal(savedAdcSwitch.active_high, true);
    results.push('ADC switches capture inactive and active states and save one threshold contract');

    await goto(page, 'hardware.html', '#builtin-inputs');

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
    await patchData(page, { mode:'STANDBY', config_locked:false });

    await goto(page, 'config.html', '#cf-rpm_limit');
    await page.locator('#btn-view-expert').click();
    await page.locator('#cf-rpm_limit').evaluate(el => {
      let parent = el.parentElement;
      while (parent) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
    });
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
    await goto(page, 'hardware.html', '#hardware-profile-section');
    const unavailableState = await page.evaluate(() => ({
      overspeed: cfg.safety.overspeed, overtemp: cfg.safety.overtemp, lowOil: cfg.safety.low_oil,
      oilLoop: cfg.controllers.oil_loop, dynamicIdle: cfg.controllers.dynamic_idle
    }));
    assert.deepEqual(unavailableState, { overspeed:false, overtemp:false, lowOil:false, oilLoop:false, dynamicIdle:false });
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
    await goto(page, 'controllers.html', '#controller-overview');
    assert.ok(await page.locator('.safety-local-toggle input:disabled').count() >= 5);
    assert.match(await page.locator('#cfg-form').textContent(), /Requires Main Fuel and N1 or N2|Fit an N1 speed input/i);
    results.push('compact bus setup and Controllers prerequisites remain discoverable without duplicating control settings on Hardware');

    await patchData(page, { mode:'STANDBY', config_locked:false });
    await goto(page, 'controllers.html#cf-sf_bv', '#cf-sf_bv');
    assert.equal(await page.locator('.cfg-field.deep-link-target[data-key="sf_bv"]').count(), 1);
    assert.equal(await page.locator('#cf-sf_bv').isVisible(), true);
    assert.equal(await page.locator('#cf-sf_bv').evaluate(el => el.closest('.config-group')?.open), true);
    results.push('cross-page links reveal, open, and highlight their exact Controllers field');

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
    await goto(page, 'system.html', '#cf-cl_n1');
    assert.equal(await page.locator('#cf-cl_en').count(), 0, 'cluster transmission must have one System enable');
    assert.equal(await page.locator('#cf-cl_n1').isVisible(), false, 'cluster thresholds stay hidden when cluster hardware is disabled');
    await goto(page, 'hardware.html', '#hardware-comms-summary');
    assert.doesNotMatch(await text(page, '#hardware-comms-summary'), /OT Cluster serial/i,
      'disabled OT Cluster must stay out of the normal installed-device summary');
    await page.locator('#btn-edit-comms').click();
    assert.match(await text(page, '#hardware-comms-summary'), /Cluster TX GPIO|Cluster RX GPIO|TX-only/i);
    assert.ok(await page.locator('#hardware-comms-summary option[value="-1"]').count() >= 1);
    results.push('cluster System enable and Hardware serial wiring remain clearly separated');

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
    const missingOilBlock = page.locator('.block-card.block-hardware-missing', { hasText: 'Set Output' }).first();
    assert.match(await missingOilBlock.getAttribute('class'), /block-hardware-missing/);
    assert.match(await missingOilBlock.textContent(), /Missing hardware/i);
    await missingOilBlock.locator('.block-header').click();
    assert.match(await missingOilBlock.textContent(), /Missing output: oil_pump/i);
    await missingOilBlock.getByRole('button', { name: /Drag to reorder block/ }).press('ArrowDown');
    assert.equal(await page.locator('#save-btn').isDisabled(), false);
    assert.equal(await page.locator('#seq-discard-btn').isDisabled(), false);
    await page.locator('#save-btn').click();
    await page.waitForSelector('#ot-app-dialog.show');
    assert.match(await page.locator('#ot-dialog-message').textContent(), /Set Output.*missing output "oil_pump"/is);
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
    assert.equal((await page.evaluate(() => getEnabledSensors().map(row => row.key))).includes('n2_rpm'), true);
    assert.equal((await page.evaluate(() => getEnabledActuators().map(row => row.key))).includes('ab_sol'), true);
    results.push('sequencer exposes fitted N2/afterburner devices without obsolete master flags');

    await reset(page);
    const registryAbHardware = await (await page.request.get(`${base}/api/hardware`)).json();
    registryAbHardware.channel_registry.inputs.push({
      id:'ab_command', name:'AB Command', purpose:'ab_command', role:'operator',
      driver:3, pin:17, min:1000, max:2000
    });
    await patchHardware(page, { channel_registry: registryAbHardware.channel_registry });
    await goto(page, 'sequence.html', '#save-btn');
    assert.equal((await page.evaluate(() => getEnabledSensors().filter(row => row.key === 'ab_input').length)), 1);
    await goto(page, 'controllers.html', '#rc-pwm-section');
    await page.locator('#btn-view-expert').click();
    // Controller groups deliberately start collapsed for page navigation. Open
    // the owning group before asserting viewport visibility of this configured
    // section; its filter state is independent of the disclosure state.
    await page.locator('#rc-pwm-section').evaluate(section => {
      const group = section.closest('details.config-group');
      if (group) group.open = true;
    });
    await page.locator('#rc-pwm-section').waitFor({ state: 'visible' });
    assert.equal(await visible(page, '#rc-pwm-section'), true);
    assert.equal(await page.locator('#cf-ab_pcm option[value="2"]').isDisabled(), false);
    results.push('registry RC afterburner command is one named sequence source and exposes its signal-loss settings');

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
    await patchConfig(page, { calibration: {
      throttle_min_raw: 1075, throttle_max_raw: 1925,
      idle_min_raw: 1125, idle_max_raw: 1875
    }});
    await goto(page, 'calibration.html', '#throttle-cal-row');
    assert.equal(await visible(page, '#oil-press-cal-row'), false);
    assert.equal(await visible(page, '#flame-cal-row'), false);
    assert.equal(await visible(page, '#p1-cal-row'), false);
    assert.match(await text(page, '#cal-th-raw'), /1510.*(us|s)/i);
    assert.match(await text(page, '#cal-idle-raw'), /1320.*(us|s)/i);
    results.push('calibration hides absent sensors and labels servo pulse units');
    await goto(page, 'hardware.html', '#registry-inputs');
    const throttleCard = page.locator('#registry-inputs .registry-card[data-registry-id="operator_throttle"]');
    await throttleCard.locator('button', {hasText:'Edit'}).click();
    assert.match(await throttleCard.textContent(), /RC pulse calibration.*1075.*1925.*Calibration page.*authoritative/is);
    assert.equal(await throttleCard.locator('input[oninput*="updateRegistryRangeField"]').count(), 0,
      'Hardware must not expose RC endpoints that the ECU does not consume');
    assert.ok(await throttleCard.locator('a[href="/calibration.html?v=20260905b#throttle-cal-row"]').count() >= 1);
    results.push('canonical RC operator endpoints have one visible authority on the Calibration page');

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
    await goto(page, 'tools.html', '#tool-area');
    assert.match(await text(page, '#lock-warn'), /Stop engine/i);
    assert.match(await text(page, '#state-OIL_PRIME'), /Locked.*RUNNING/i);
    assert.equal(await page.locator('#btn-OIL_PRIME').isDisabled(), true);
    results.push('running-engine tool cards say they are locked instead of contradicting disabled controls with Ready');

    await patchData(page, {
      config_version_mismatch: true,
      flash_free_kb: 24,
      mode: 'STANDBY',
      dev_mode: false,
      bench_mode: false
    });
    await goto(page, 'tools.html', '#tool-area');
    assert.match(await text(page, '#cfg-version-mismatch-banner'), /schema mismatch|review/i);
    await goto(page, 'system.html', '#manual-update-tools');
    assert.match(await text(page, '#manual-update-tools'), /Web UI assets.*configuration and logs are retained/is);
    assert.equal(await page.locator('#ota-file').count(), 1);
    assert.equal(await page.locator('#assets-files').count(), 1);
    assert.match(await page.locator('body').evaluate(() => backupConfig.toString()), /Download started.*Confirm the complete engine file appears in Downloads/s);
    await goto(page, 'tools.html', '#tool-area');
    assert.equal(await page.locator('#manual-update-tools').count(), 0);
    assert.equal(await visible(page, '#card-TOGGLE_BENCH_MODE'), false);
    await patchData(page, { dev_mode: true });
    await page.waitForFunction(() => {
      const el = document.querySelector('#card-TOGGLE_BENCH_MODE');
      return !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
    }, null, { timeout: 3000 });
    assert.equal(await visible(page, '#card-TOGGLE_BENCH_MODE'), true);
    results.push('System owns manual firmware/web updates while Tools gates bench mode behind dev mode');

    await reset(page);
    await scenario(page, 'fault');
    await goto(page, 'hardware.html', '#hardware-profile-section');
    await page.evaluate(() => {
      engineMode = 'FAULT';
      _hwDirty = true;
      _pinConflictBlocking = false;
      cfg.channel_registry = { version:1, inputs:[], outputs:[], bindings:[] };
      updateSaveButton();
    });
    assert.equal(await page.locator('#btn-save').isDisabled(), false);
    assert.equal(await visible(page, '#standby-warn'), false);
    await goto(page, 'sequence.html', '#save-btn');
    await page.evaluate(() => {
      _seqDirty = true;
      updateEngineMode('FAULT');
      updateSequenceSaveControls();
    });
    assert.equal(await page.locator('#save-btn').isDisabled(), false);
    results.push('Hardware and Sequence keep their firmware-supported FAULT repair save path available');

    await reset(page);
    await goto(page, 'controllers.html', '#cfg-form');
    assert.equal(await page.locator('#cfg-form input, #cfg-form select').evaluateAll(elements =>
      elements.filter(el => !el.getAttribute('aria-label') && !(el.labels && el.labels.length)).length), 0);
    assert.ok((await page.locator('#cfg-search').getAttribute('title'))?.length > 0);
    await goto(page, 'system.html', '#system-engine-description');
    assert.ok((await page.locator('#system-engine-description').evaluate(el => el.labels?.[0]?.textContent.trim() || ''))?.length > 0);
    assert.ok((await page.locator('#system-wifi-tx-power').evaluate(el => el.labels?.[0]?.textContent.trim() || ''))?.length > 0);
    await goto(page, 'hardware.html', '#hardware-profile-section');
    assert.equal(await page.locator('#registry-bindings select:not([aria-label])').count(), 0);
    await goto(page, 'sequence.html', '#add-startup-sel');
    assert.ok((await page.locator('#add-startup-sel').getAttribute('aria-label'))?.length > 0);
    assert.ok((await page.locator('#add-startup-sel').getAttribute('title'))?.length > 0);
    assert.deepEqual(await page.locator('.param-field input,.param-field select').evaluateAll(fields =>
      fields.filter(field => !field.title && !field.closest('.param-field')?.title)
        .map(field => field.id || field.getAttribute('aria-label') || field.type)), [],
      'every sequence parameter needs hover help');
    await goto(page, 'tools.html', '#cooldown-slider');
    assert.ok((await page.locator('#cooldown-slider').getAttribute('aria-label'))?.length > 0);
    results.push('visible generated settings and static commissioning selectors expose programmatic labels, and every installed hardware field has nearby help');

    for (const route of ['index.html', 'hardware.html', 'controllers.html', 'system.html', 'sequence.html', 'calibration.html', 'tools.html', 'log.html']) {
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
