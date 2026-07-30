const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const base = 'http://127.0.0.1:8766';

async function waitShown(page, selector, shown) {
  await page.waitForFunction(
    ({ selector, shown }) => {
      const element = document.querySelector(selector);
      return element && (getComputedStyle(element).display !== 'none') === shown;
    },
    { selector, shown }
  );
}

async function text(page, selector) {
  return (await page.locator(selector).textContent()).trim();
}

async function state(page) {
  return (await page.request.get(`${base}/__sim/state`)).json();
}

async function scenario(page, name) {
  const response = await page.request.post(`${base}/__sim/scenario/${name}`);
  assert.equal(response.ok(), true, `scenario ${name} request failed`);
  if (page.url().startsWith(base)) await page.evaluate(() => sessionStorage.clear());
}

async function openConfigWorkspace(page) {
  await page.waitForSelector('.config-group', { state: 'attached' });
  await page.evaluate(() => document.querySelectorAll('.config-group').forEach(group => { group.open = true; }));
}

function installedBrowser() {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

(async () => {
  globalThis.OT_UI_SIM_PORT = 8766;
  await import('./ui_mock_server.mjs');
  const executablePath = installedBrowser();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage();
  page.on('pageerror', error => console.error(`Browser page error: ${error.message}`));
  page.on('dialog', async dialog => {
    console.error(`Browser dialog: ${dialog.message()}`);
    await dialog.dismiss();
  });
  const results = [];

  try {
    await page.goto(base);
    await page.evaluate(() => localStorage.clear());
    await scenario(page, 'full');
    await page.reload();
    await waitShown(page, '#n1-card', true);
    await waitShown(page, '#beta-ack-overlay', false);
    await waitShown(page, '#theme-firstrun', false);
    await waitShown(page, '#getting-started-banner', false);
    results.push('first-run overlays and commissioning guide never cover an active engine dashboard');
    await page.request.post(`${base}/__sim/data`, { data: { mode: 'STANDBY' } });

    // Fresh profile → the beta safety notice must appear and gate clicks;
    // acknowledge it the way a tester would, then continue the smoke run.
    await waitShown(page, '#beta-ack-overlay', true);
    await page.locator('#beta-ack-check').check();
    await page.locator('#beta-ack-btn').click();
    await waitShown(page, '#beta-ack-overlay', false);
    assert.equal(await page.evaluate(() => localStorage.getItem('ot_beta_notice_ack_v1')), '1');
    results.push('beta safety notice gates a fresh profile and is dismissible via checkbox + continue');
    // First-run theme chooser appears right after the beta notice; dismiss it like a tester would.
    await waitShown(page, '#theme-firstrun', true);
    await page.locator('#theme-firstrun button.primary').click();
    await waitShown(page, '#theme-firstrun', false);
    assert.equal(await page.evaluate(() => localStorage.getItem('ot_theme_onboarded_v1')), '1');
    results.push('first-run theme chooser appears after the beta notice and is dismissible');
    await scenario(page, 'full');
    await waitShown(page, '#getting-started-banner', false);
    assert.equal(await text(page, '#fw-version'), 'vsim-1.0.0');
    assert.equal(await text(page, '#throttle-input-pct'), '50.0');
    assert.equal(await page.evaluate(() =>
      ['tot-card', 'tit-card', 'n1-card', 'n2-card'].every(id =>
        document.querySelector('#temperature-cards').contains(document.getElementById(id)))), true);
    assert.equal(await page.evaluate(() =>
      ['tot-card', 'tit-card', 'n1-card', 'n2-card'].every(id =>
        document.getElementById(id)?.classList.contains('big')) &&
      ['tot-sparkline', 'tit-sparkline', 'n1-sparkline', 'n2-sparkline'].every(id =>
        document.getElementById(id) instanceof HTMLCanvasElement)), true);
    assert.equal(await page.evaluate(() =>
      ['gauge-bar', 'abs-label', 'approach-warn'].every(suffix =>
        document.getElementById(`n1-${suffix}`) && document.getElementById(`n2-${suffix}`))), true);
    assert.equal(await text(page, '#n2-abs-label'), '24,200 / 30,000 RPM');
    await page.evaluate(() => _showRunSummary({
      mode: 'STANDBY', has_n1: true, max_n1: 67100,
      has_n2: true, max_n2: 24900
    }, 65000));
    assert.match(await text(page, '#run-summary-stats'), /Peak N2:\s+24,900 RPM/);
    await page.locator('#run-summary-card button').click();
    assert.equal(await page.evaluate(() =>
      ['oil-card', 'oil-temp-card', 'oilpump-current-card'].every(id =>
        document.querySelector('#speed-cards').contains(document.getElementById(id)))), true);
    assert.equal(await page.evaluate(() => {
      const mode = document.querySelector('.mode-row');
      const outputs = document.getElementById('actuator-output-cards');
      const adv = document.getElementById('adv-act-section');
      return !!mode && !!outputs && !!adv &&
        !!(mode.compareDocumentPosition(adv) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        !!(adv.compareDocumentPosition(outputs) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), true);
    assert.equal(await text(page, '#hour-start-count'), '12');
    assert.equal(await page.locator('[data-registry-input-id="thrust_main"]').count(), 0);
    assert.equal(await page.locator('#thrust-card').isVisible(), true);
    await page.locator('#btn-ab-fire').click();
    assert.equal(await text(page, '#ot-dialog-title'), 'Fire afterburner?');
    assert.match(await text(page, '#ot-dialog-message'), /AB igniter, fuel valve, and fuel pump.*N1.*RPM.*TOT.*°C/is);
    await page.locator('#ot-dialog-cancel').click();
    results.push('dashboard prioritizes primary data, oil cards, and actuator outputs below start/stop');
    results.push('manual afterburner fire requires a live-state confirmation while AB stop remains immediate');
    await page.request.post(`${base}/__sim/data`, { data: {
      mode: 'STANDBY', bench_mode: false, stop_switch_active: false,
      has_n1: true, n1: 0, n1_healthy: true,
      has_tot: true, has_tit: true, egt_source: 1, tot: 24, tot_healthy: true,
      has_oil_press: true, oil: 0, oil_healthy: true
    } });
    await page.waitForFunction(() => document.getElementById('mode-badge')?.textContent === 'STANDBY');
    await page.evaluate(() => showStartConfirm());
    await page.waitForFunction(() => !document.getElementById('start-confirm-preflight')?.textContent?.includes('Checking'));
    const startPreflight = await text(page, '#start-confirm-preflight');
    assert.match(startPreflight, /ECU mode\s*STANDBY/i);
    assert.match(startPreflight, /N1\s*0 RPM\s*·\s*OK/i);
    assert.match(startPreflight, /TOT\s*24 °C\s*·\s*OK/i);
    assert.match(startPreflight, /Oil Press\s*0\.00 bar\s*·\s*OK/i);
    assert.match(startPreflight, /STOP input\s*Released/i);
    assert.match(startPreflight, /Safety state\s*Normal checks/i);
    assert.match(startPreflight, /Startup sequence\s*\d+ blocks?/i);
    await page.evaluate(() => cancelStart());
    const staleStartRequestSent = await page.evaluate(() => {
      _telemetryStale = true;
      let sent = false;
      const originalFetch = window.fetch;
      window.fetch = (...args) => {
        if (String(args[0]).includes('/api/hardware')) sent = true;
        return originalFetch(...args);
      };
      confirmStart();
      window.fetch = originalFetch;
      _telemetryStale = false;
      return sent;
    });
    assert.equal(staleStartRequestSent, false);
    assert.match(await text(page, '.ot-dialog-message'), /START is no longer available.*telemetry is stale/is);
    await page.locator('#ot-dialog-confirm').click();
    results.push('start confirmation exposes a compact live ECU preflight snapshot before command');
    assert.equal((await text(page, '#getting-started-banner')).match(/[⚙🔧📋🔨▶]/u), null);
    assert.equal(await page.locator('.gs-steps a').first().evaluate(el => getComputedStyle(el).color), 'rgb(245, 245, 247)');
    results.push('getting-started checklist uses the high-contrast text colour for plain-text actions');

    await page.request.post(`${base}/__sim/data`, { data: {
      mode: 'RUNNING', bench_mode: false, egt_source: 2,
      has_tit: true, tit_healthy: false,
      has_tot: true, tot_healthy: true,
      has_n1: true, n1_healthy: true
    } });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('throttle-feedback-inhibit-note')).display !== 'none');
    await page.waitForFunction(() => document.getElementById('tit-rise-rate-val')?.textContent?.includes('2.5'));
    assert.equal(await text(page, '#tot-rise-rate-val'), '—');
    await page.request.post(`${base}/__sim/data`, { data: { tit_healthy: true, egt_source: 1 } });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('throttle-feedback-inhibit-note')).display === 'none');
    await page.waitForFunction(() => document.getElementById('tot-rise-rate-val')?.textContent?.includes('2.5'));
    assert.equal(await text(page, '#tit-rise-rate-val'), '—');
    results.push('dashboard throttle inhibit warning follows selected EGT source, including TIT-primary setups');
    await scenario(page, 'full');

    await scenario(page, 'startup');
    await page.waitForFunction(() => document.getElementById('tot')?.textContent?.includes('175'));
    await page.waitForTimeout(450);
    await scenario(page, 'full');
    await page.waitForFunction(() => document.getElementById('tot')?.textContent?.includes('640'));
    await page.waitForTimeout(450);
    await page.goto(`${base}/config.html`);
    await page.waitForSelector('#cf-tot_limit');
    await openConfigWorkspace(page);
    await page.goto(base);
    await waitShown(page, '#n1-card', true);
    const retainedTrend = await page.evaluate(() =>
      JSON.parse(localStorage.getItem(`ot_dashboard_sparklines_v2:${location.host}:sim-dev`) || '{}').series?.tot || []);
    assert.equal(retainedTrend.some(v => Number(v) === 175), true);
    assert.equal(retainedTrend.some(v => Number(v) === 640), true);
    results.push('equivalent EGT/speed cards expose trends and dashboard history survives page navigation');

    await page.locator('#unit-temp-btn').click();
    await page.locator('#unit-press-btn').click();
    assert.equal(await text(page, '#tot'), '1184.0');
    assert.equal(await text(page, '#oil'), '31.18');
    assert.match(await text(page, '#tot-abs-label'), /F$/);
    assert.match(await text(page, '#oil-abs-label'), /PSI$/);
    results.push('dashboard temperature and pressure unit toggles convert live values and limit labels');

    await page.request.post(`${base}/__sim/data`, { data: {
      mode: 'RUNNING',
      n2_limit: 0,
      oil_running_min: 0,
      fuel_press_min: 0,
      batt_volt_min: 0,
      oil_temp_limit: 0,
      egt_source: 2,
      has_tit: true,
      tit: 720,
      tit_limit: 0
    } });
    await page.waitForFunction(() => document.getElementById('oil-abs-label')?.textContent?.includes('/ OFF'));
    assert.match(await text(page, '#fuel-press-abs-label'), /\/ OFF$/);
    assert.equal(await text(page, '#batt-volt-min'), 'OFF');
    assert.match(await text(page, '#tit-abs-label'), /\/ OFF$/);
    assert.match(await text(page, '#n2-abs-label'), /RPM \/ OFF$/);
    results.push('dashboard zero-disabled thresholds clear stale gauge limits instead of retaining old values');
    await scenario(page, 'full');
    await page.locator('#unit-temp-btn').click();

    const retainedTot = await text(page, '#tot');
    await page.evaluate(() => ws.close());
    await page.waitForTimeout(50);
    assert.equal(await text(page, '#tot'), retainedTot);
    await page.request.post(`${base}/__sim/data`, { data: { tot: 651 } });
    await page.waitForFunction(() => document.getElementById('tot')?.textContent?.includes('651'), null, { timeout: 5000 });
    results.push('brief telemetry reconnect retains values and REST fallback keeps live pages updating without navigation');
    await page.locator('#unit-temp-btn').click();

    await page.request.post(`${base}/__sim/data`, { data: { config_storage_fault: true } });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('config-storage-banner')).display !== 'none');
    await page.request.post(`${base}/__sim/data`, { data: { config_storage_fault: false } });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('config-storage-banner')).display === 'none');
    results.push('dashboard shows storage-fault lock banner from telemetry');

    await page.reload();
    await waitShown(page, '#n1-card', true);
    await scenario(page, 'minimal');
    await waitShown(page, '#n2-card', false);
    await waitShown(page, '#p1-card', false);
    await waitShown(page, '#speed-group', true);
    await waitShown(page, '#pressure-section', false);
    await waitShown(page, '#ext-sensors-section', false);
    await waitShown(page, '#ab-section', false);
    results.push('minimal hardware telemetry keeps oil visible and hides optional sections');

    await scenario(page, 'startup');
    await waitShown(page, '#seq-progress-section', true);
    assert.equal(await text(page, '#seq-block-name'), 'Confirm Combustion by Flame Sensor');
    assert.equal(await text(page, '#seq-step-text'), '4 / 6');
    await waitShown(page, '#throttle-startup-range-row', true);
    assert.match(await text(page, '#throttle-startup-range-row'), /10\.0 to 25\.0/);
    assert.match(await text(page, '#oil-startup-setting-note'), /100\.0/);
    results.push('startup scenario shows live sequence progress and direct startup output settings');

    await scenario(page, 'fault');
    await waitShown(page, '#fault-card', true);
    assert.equal(await text(page, '#fault-desc-text'), 'Oil pressure below running minimum');
    for (const route of ['/log.html', '/calibration.html', '/config.html', '/tools.html'])
      assert.equal(await page.locator(`#fault-card a[href="${route}"]`).count(), 1);
    results.push('fault scenario exposes the current diagnosis and direct investigation routes');

    await scenario(page, 'full');
    await page.goto(`${base}/config.html`);
    await page.waitForSelector('#cf-tot_limit');
    await openConfigWorkspace(page);
    assert.equal(await page.locator('#cf-tot_limit').inputValue(), '1328');
    assert.equal(await page.locator('#cf-tot_safe_margin').inputValue(), '72');
    // tot_limit is zeroOff ("0 = disabled"): the raw 0 sentinel must remain
    // enterable in every display unit, so min stays 0 even in °F mode.
    assert.equal(await page.locator('#cf-tot_limit').getAttribute('min'), '0');
    assert.equal(await page.locator('text=Automation Rules').count(), 0);
    assert.equal(await page.locator('#unit-temp-btn').textContent(),
      (await page.locator('#cf-tot_limit').evaluate(el => el.closest('.cfg-field').querySelector('.cfg-label').textContent.includes('°F'))) ? '°F' : '°C');
    assert.equal(await page.locator('#unit-press-btn').textContent(),
      (await page.locator('#cf-oil_rm').evaluate(el => el.closest('.cfg-field').querySelector('.cfg-label').textContent.includes('PSI'))) ? 'PSI' : 'bar');
    results.push('config loads converted values without duplicating control-rule editing');

    await page.locator('#unit-temp-btn').click();
    assert.equal(await page.locator('#cf-tot_limit').inputValue(), '720');
    assert.equal(await page.locator('#cf-tot_safe_margin').inputValue(), '40');
    await page.locator('#unit-temp-btn').click();
    assert.equal(await page.locator('#cf-tot_limit').inputValue(), '1328');
    assert.equal(await page.locator('#cf-tot_safe_margin').inputValue(), '72');
    results.push('switching config units converts configuration inputs without changing meaning');

    await page.locator('#btn-view-expert').click();
    await page.locator('#cf-tot_limit').fill('1220');
    await page.locator('#cf-tot_safe_margin').fill('90');
    await page.locator('#cf-oil_rm').fill('29.008');
    assert.equal(await page.locator('#cf-tot_limit').evaluate(el =>
      el.closest('.config-group').classList.contains('group-changed')), true,
      'A configuration group containing an edited field should have a yellow changed border');
    await page.locator('#btn-save').click();
    await page.locator('#ot-dialog-confirm').click();
    await page.locator('#save-recap-confirm-btn').click();
    await page.waitForFunction(() => document.querySelector('#save-msg').textContent.includes('Saved'));
    let saved = await state(page);
    assert.ok(Math.abs(saved.settings.engine.tot_limit - 660) < 0.001);
    assert.ok(Math.abs(saved.settings.engine.tot_safe_margin - 50) < 0.001);
    assert.ok(Math.abs(saved.settings.oil.running_min - 2) < 0.001);
    results.push('config saves converted F and PSI edits back as canonical C and bar values');
    await page.request.post(`${base}/__sim/data`, { data: {
      has_tit: true, tit_limit: 0, has_oil_temp: false,
      has_batt_voltage: false, fuel_press_min: 0, has_governor: false
    } });
    await waitShown(page, '#engine-limits', true);
    await waitShown(page, '#field-sf-tit', true);
    results.push('installed TIT sensor exposes its configurable limit before a limit is set');
    assert.equal(await page.locator('text=Download settings').count(), 0);
    assert.equal(await page.locator('text=Full engine file backup / restore').count(), 1);
    results.push('config page directs import and export to the unified engine file flow');

    await page.goto(`${base}/calibration.html`);
    await page.waitForFunction(() => document.querySelector('#th-wiz-steps').textContent.includes('servo signal'));
    assert.match(await text(page, '#cal-th-raw'), /us|µs/);
    await page.request.post(`${base}/__sim/data`, { data: { throttle_input_us: 1120, throttle_input_norm: 0.12 } });
    await page.waitForFunction(() => document.querySelector('#cal-th-raw').textContent.includes('1120'));
    await page.locator('#throttle-cal-row button', { hasText: 'Capture Min' }).click();
    await page.waitForFunction(() => document.querySelector('#th-status')?.textContent.includes('Min: 1120'));
    await page.request.post(`${base}/__sim/data`, { data: { throttle_input_us: 1880, throttle_input_norm: 0.88 } });
    await page.waitForFunction(() => document.querySelector('#cal-th-raw').textContent.includes('1880'));
    await page.locator('#throttle-cal-row button', { hasText: 'Capture Max' }).click();
    await page.waitForFunction(() => document.querySelector('#th-status')?.textContent.includes('Max: 1880'));
    await page.locator('#btn-th-save').click();
    await page.waitForTimeout(100);
    saved = await state(page);
    assert.equal(saved.settings.calibration.throttle_min_raw, 1135); // +2% of 760 span
    assert.equal(saved.settings.calibration.throttle_max_raw, 1872); // -1% of 760 span
    results.push('servo throttle calibration averages endpoints and persists the 2%/1% safety margins');

    await page.goto(`${base}/hardware.html`);
    await page.waitForFunction(() => /Loaded|Converted/i.test(document.querySelector('#save-msg')?.textContent || ''));
    assert.equal(await page.evaluate(() => cfg.sensors.throttle_input.rc_pwm), true);
    assert.equal(await page.locator('#f-wifi-tx-power').inputValue(), '8');
    results.push('hardware page restores servo-input source from saved hardware state');
    await page.evaluate(() => addRegistryChannel('input'));
    const inputCatalog = await text(page, '#registry-add-catalog');
    for (const label of ['Compressor inlet pressure (P1)', 'Compressor discharge pressure (P2)',
      'Coolant pressure', 'Coolant temperature', 'Intake / ambient temperature',
      'Low oil pressure switch', 'Zero oil pressure switch', 'Generic PWM duty input']) {
      assert.match(inputCatalog, new RegExp(label.replace(/[()]/g, '\\$&')));
    }
    await page.evaluate(() => closeRegistryAddDialog());
    await page.evaluate(() => addRegistryChannel('output'));
    const outputCatalog = await text(page, '#registry-add-catalog');
    for (const label of ['Coolant pump', 'Air starter', 'Pilot gas / start-fuel solenoid',
      'Air / fuel purge valve', 'Variable nozzle actuator']) {
      assert.match(outputCatalog, new RegExp(label.replace(/[()]/g, '\\$&')));
    }
    assert.doesNotMatch(outputCatalog, /Contactor/);
    await page.evaluate(() => closeRegistryAddDialog());
    assert.equal(await page.locator('body').textContent().then(t => /Fault demand/i.test(t)), false);
    const oilSwitchSafety = await page.evaluate(() => {
      const savedSensors = structuredClone(cfg.sensors);
      const savedSafety = structuredClone(cfg.safety);
      const savedRegistry = structuredClone(cfg.channel_registry);
      cfg.sensors.oil_press.enabled = false;
      cfg.safety.low_oil = true;
      cfg.channel_registry.inputs = [{
        installed: true, id: 'low_oil_switch', name: 'Low Oil Switch',
        role: 'low_oil_switch', purpose: 'low_oil_switch',
        driver: 0, pin: 12, active_high: false, pullup: true
      }];
      updateSafetyPrerequisites(true);
      const result = {
        disabled: !safetyAvailability('low_oil').ok,
        enabled: cfg.safety.low_oil === true
      };
      cfg.sensors = savedSensors;
      cfg.safety = savedSafety;
      cfg.channel_registry = savedRegistry;
      updateSafetyPrerequisites(false);
      return result;
    });
    assert.equal(oilSwitchSafety.disabled, false);
    assert.equal(oilSwitchSafety.enabled, true);
    const precisePurposeDeps = await page.evaluate(() => {
      const savedSensors = structuredClone(cfg.sensors);
      const savedSafety = structuredClone(cfg.safety);
      const savedControllers = structuredClone(cfg.controllers);
      const savedRegistry = structuredClone(cfg.channel_registry);
      cfg.sensors.tot.enabled = false;
      cfg.sensors.tit.enabled = false;
      cfg.sensors.oil_press.enabled = false;
      cfg.safety.overtemp = true;
      cfg.controllers.oil_loop = true;
      cfg.channel_registry.inputs = [
        { installed: true, id: 'coolant_temperature', name: 'Coolant Temp', role: 'temperature', purpose: 'coolant_temp', driver: 1, pin: 15, min: 0, max: 4095 },
        { installed: true, id: 'p1_main', name: 'P1 Pressure', role: 'pressure', purpose: 'p1_pressure', driver: 1, pin: 32, min: 0, max: 4095 }
      ];
      cfg.channel_registry.outputs = [{ installed: true, id: 'oil_pump_main', name: 'Oil Pump', role: 'oil_pump', purpose: 'oil_pump', driver: 5, pin: 23, min: 0, max: 1 }];
      updateSafetyPrerequisites(true);
      updateHardwarePrerequisites(true);
      const result = {
        overtempDisabled: !safetyAvailability('overtemp').ok,
        overtempCleared: cfg.safety.overtemp === false,
        oilLoopDisabled: !controllerAvailability('oil_loop').ok,
        oilLoopCleared: cfg.controllers.oil_loop === false
      };
      cfg.sensors = savedSensors;
      cfg.safety = savedSafety;
      cfg.controllers = savedControllers;
      cfg.channel_registry = savedRegistry;
      updateSafetyPrerequisites(false);
      updateHardwarePrerequisites(false);
      return result;
    });
    assert.equal(precisePurposeDeps.overtempDisabled, true);
    assert.equal(precisePurposeDeps.overtempCleared, true);
    assert.equal(precisePurposeDeps.oilLoopDisabled, true);
    assert.equal(precisePurposeDeps.oilLoopCleared, true);
    results.push('hardware picker exposes bounded turbine I/O roles and switch-based oil safety stays available');
    await page.evaluate(() => {
      cfg.sensors.p1.enabled = false;
      cfg.sensors.p1.pin = cfg.sensors.oil_press.pin;
      _releaseInactivePinConflicts();
    });
    assert.equal(await page.evaluate(() => cfg.sensors.p1.pin), -1);
    results.push('inactive hardware releases a pin when an enabled device uses it');
    const sharedSpi = await page.evaluate(() => {
      Object.values(cfg.sensors || {}).forEach(sensor => { sensor.enabled = false; });
      Object.values(cfg.actuators || {}).forEach(actuator => { actuator.enabled = false; });
      cfg.cluster_serial.enabled = false;
      cfg.mavlink.enabled = false;
      cfg.di_channels = [];
      cfg.channel_registry.inputs.forEach(channel => { channel.installed = false; });
      cfg.channel_registry.outputs.forEach(channel => { channel.installed = false; });
      const purposes = ['tot', 'tit', 'oil_temperature'];
      const channels = purposes.map(purpose => cfg.channel_registry.inputs.find(channel =>
        registryDerivedPurpose('input', channel) === purpose));
      channels.forEach((channel, index) => Object.assign(channel, {
        installed:true, driver:1, pin:-1, temp_interface:2,
        spi_clk:18, spi_cs:[5,17,16][index], spi_miso:19, spi_mosi:-1
      }));
      return {
        allConfigured: channels.every(channel => channel && channel.spi_clk === 18 && channel.spi_miso === 19),
        busConflict: _checkGpioConflicts().some(c => [18,19].includes(c.pin))
      };
    });
    assert.deepEqual(sharedSpi, { allConfigured:true, busConflict:false });
    results.push('hardware page allows configured SPI bus sharing across temperature sensors');

    await page.request.patch(`${base}/api/hardware`, { data: { platform: 'esp32s3' } });
    await page.reload();
    await page.waitForFunction(() => /Loaded|Converted/i.test(document.querySelector('#save-msg')?.textContent || ''));
    assert.deepEqual(await page.evaluate(() => ({
      output16: buildPinOptions(-1, 'out').includes('value="16"'),
      output22: buildPinOptions(-1, 'out').includes('value="22"'),
      adc1: buildPinOptions(-1, 'adc').includes('value="1"')
    })), { output16:true, output22:false, adc1:true });
    results.push('hardware page selects ESP32-S3 output and ADC pin choices from firmware platform');
    saved = await state(page);
    const renamedHardware = structuredClone(saved.hardware);
    renamedHardware.profile_id = 'renamed-bench-engine';
    let response = await page.request.post(`${base}/api/hardware`, { data: renamedHardware });
    assert.equal(response.ok(), true);
    saved = await state(page);
    assert.equal(saved.settings.profile_id, 'renamed-bench-engine');
    results.push('hardware engine identity save synchronizes the unified settings section');

    await scenario(page, 'minimal');
    await page.request.patch(`${base}/api/hardware`, { data: {
      controllers: { dynamic_idle: false },
      sensors: { n1_rpm: { enabled: false }, n2_rpm: { enabled: false } }
    } });
    await page.goto(`${base}/tools.html`);
    await page.waitForFunction(() => {
      const devButton = document.querySelector('#btn-dev-mode');
      const oilButton = document.querySelector('#btn-OIL_PRIME');
      return devButton && !devButton.disabled && oilButton && !oilButton.disabled;
    });
    assert.equal(await text(page, '#btn-dev-mode'), 'Enable Dev Mode');
    assert.equal(await page.locator('#card-TOGGLE_BENCH_MODE').isVisible(), false);
    assert.equal(await page.locator('#card-TOGGLE_SAFETY_CHECKS').isVisible(), false);
    assert.equal(await page.locator('#card-TOGGLE_DYNAMIC_IDLE').count(), 0);
    assert.equal(await page.locator('#btn-test-settings').count(), 1);
    assert.equal(await page.locator('.tool-card button[title*="bench-test timing"]').count(), 0);
    assert.match(await text(page, '#card-IDLE_TEST'), /minimum reliable fuel-pump output \(10%\)/i);
    await page.request.post(`${base}/__sim/data`, { data: { dev_mode: true } });
    await waitShown(page, '#card-TOGGLE_BENCH_MODE', true);
    assert.match(await text(page, '#card-WEB-ASSETS'), /without erasing config or logs/);
    await page.locator('#btn-OIL_PRIME').click();
    await page.waitForSelector('#ot-app-dialog.show');
    assert.match(await page.locator('#ot-dialog-message').textContent(), /energize.*5 s[\s\S]*safe test state[\s\S]*moving hardware is clear/i);
    await page.locator('#ot-dialog-check').check();
    await page.locator('#ot-dialog-confirm').click();
    await page.waitForTimeout(100);
    saved = await state(page);
    assert.equal(saved.commands.at(-1).cmd, 'OIL_PRIME');
    assert.equal(await page.evaluate(() => localStorage.getItem('ot_tool_confirmations_skip_all')), '1');
    await page.locator('#btn-test-settings').click();
    assert.equal(await page.locator('#tool-always-confirm').isChecked(), false);
    await page.locator('#tool-always-confirm').check();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(() => localStorage.getItem('ot_tool_confirmations_skip_all')), null);
    results.push('tools gates prerequisites and uses one restorable confirmation preference for the full page');

    await page.request.patch(`${base}/api/hardware`, { data: {
      controllers: { dynamic_idle: true },
      sensors: { n1_rpm: { enabled: true }, n2_rpm: { enabled: true } }
    } });

    await page.request.patch(`${base}/api/hardware`, { data: {
      sensors: { p1: { enabled: false } },
      actuators: { bleed_valve: { enabled: false } },
      has_afterburner: true,
      ab_trigger: { source: 3, input_pin: 32, input_rc_pwm: true, input_threshold: 2500, requires_arm: true, arm_pin: 33 }
    } });
    await page.goto(`${base}/sequence.html`);
    await page.waitForFunction(() => document.body.textContent.includes('Oil Pump On'));
    const delayInputs = page.locator('#list-startup .block-card[data-block="TimedDelay"] input[type="number"]');
    assert.equal(await delayInputs.count(), 3);
    assert.deepEqual(await delayInputs.evaluateAll(els => els.map(el => el.value)), ['15000', '10000', '5000']);
    await page.locator('#list-startup .block-card[data-block="TimedDelay"] .block-header').nth(2).click();
    await delayInputs.nth(2).fill('6000');
    await delayInputs.nth(2).dispatchEvent('input');
    await page.locator('#save-btn').click();
    await page.locator('#ot-dialog-confirm').click();
    await page.waitForFunction(() => document.querySelector('#reboot-overlay')?.classList.contains('show'));
    assert.match(await page.locator('body').textContent(), /Igniter On/);
    assert.match(await page.locator('body').textContent(), /Fuel Pump/);
    assert.ok((await page.locator('.block-header').first().getAttribute('title')).length > 10);
    await page.locator('.seq-tab', { hasText: 'Afterburner' }).click();
    assert.match(await text(page, '#ab-lightup-criteria'), /Analog \/ RC input/);
    assert.match(await text(page, '#ab-lightup-criteria'), /Arm switch must be active/);
    assert.match(await text(page, '#ab-shutoff-criteria'), /Analog \/ RC input drops below/);
    assert.equal(await page.locator('#ab-edit-input-wrap').isVisible(), true);
    assert.equal(await page.locator('#ab-edit-input-pct').inputValue(), '61');
    await page.locator('#ab-edit-input-pct').fill('72');
    await page.locator('#ab-edit-input-pct').dispatchEvent('input');
    await page.locator('#ab-edit-min-n1').fill('50000');
    await page.locator('#ab-edit-min-n1').dispatchEvent('input');
    assert.equal(await page.evaluate(() => hwCfg.ab_trigger.input_threshold), Math.round(72 * 4095 / 100));
    assert.equal(await page.evaluate(() => cfg.afterburner.min_n1), 50000);
    results.push('sequence editor keeps independent timed delays and edits AB input/gate thresholds in friendly units');
    await page.goto(`${base}/hardware.html`);
    await page.waitForFunction(() => /Loaded|Converted/i.test(document.querySelector('#save-msg')?.textContent || ''));
    assert.equal(await page.evaluate(() => cfg.ab_trigger.input_rc_pwm), true);
    results.push('hardware editor preserves dedicated AB servo-PWM command input type');
    await page.evaluate(() => {
      cfg.actuators.oil_pump.enabled = false;
      cfg.actuators.oil_pump.has_current = true;
      cfg.controllers.oil_loop = true;
      cfg.actuators.throttle.enabled = false;
      cfg.channel_registry.outputs.forEach(channel => {
        if (channel.purpose === 'oil_pump' || channel.purpose === 'main_fuel') channel.installed = false;
      });
      updateHardwarePrerequisites(true);
    });
    assert.deepEqual(await page.evaluate(() => ({
      currentDisabled: !registryHasPurpose('output', 'oil_pump'),
      oilDisabled: !controllerAvailability('oil_loop').ok,
      oilChecked: !!cfg.controllers.oil_loop,
      fuelResponseAutomatic: registryHasPurpose('output', 'main_fuel')
    })), { currentDisabled:true, oilDisabled:true, oilChecked:false, fuelResponseAutomatic:false });
    results.push('hardware editor ghosts current sensing/controllers and derives fuel protection from Main Fuel');
    await page.evaluate(() => {
      cfg.has_two_shaft = false;
      cfg.sensors.n2_rpm.enabled = true;
      cfg.channel_registry.inputs.find(channel => channel.purpose === 'n2_speed').installed = true;
      cfg.channel_registry.outputs.find(channel => channel.purpose === 'main_fuel').installed = true;
      cfg.controllers.governor = true;
      updateFeaturesUI();
      updateHardwarePrerequisites(true);
    });
    assert.equal(await page.evaluate(() => registryHasPurpose('input', 'n2_speed')), true);
    assert.equal(await page.evaluate(() => controllerAvailability('governor').ok && cfg.controllers.governor), true);
    results.push('fitted N2 and registry fuel output enable the governor without a legacy two-shaft master');
    await page.goto(`${base}/config.html`);
    await openConfigWorkspace(page);
    assert.equal(await page.locator('#cf-ab_pcm').inputValue(), '1');
    assert.equal(await page.locator('#cf-ab_fm option[value="0"]').isDisabled(), false);
    assert.equal(await page.locator('#cf-ab_pcm option[value="2"]').isDisabled(), false);
    const hardwareBeforeAbRemoval = await (await page.request.get(`${base}/api/hardware`)).json();
    await page.request.patch(`${base}/api/hardware`, { data: {
      sensors: { tot: { enabled: false } },
      actuators: { igniter2: { enabled: false }, ab_pump: { enabled: false } },
      ab_flame: { enabled: false },
      ab_trigger: { input_pin: -1 },
      channel_registry: {
        ...hardwareBeforeAbRemoval.channel_registry,
        inputs: hardwareBeforeAbRemoval.channel_registry.inputs.map(channel =>
          ['ab_flame', 'p1_pressure'].includes(channel.purpose) ? { ...channel, installed: false } : channel),
        outputs: hardwareBeforeAbRemoval.channel_registry.outputs.map(channel =>
          ['ab_igniter', 'ab_pump'].includes(channel.purpose) || channel.id === 'bleed_valve'
            ? { ...channel, installed: false } : channel)
      }
    } });
    await page.reload();
    assert.equal(await page.locator('#cf-ab_fm option[value="0"]').isDisabled(), true);
    assert.equal(await page.locator('#cf-ab_fm option[value="1"]').isDisabled(), false);
    assert.equal(await page.locator('#cf-ab_pcm option[value="2"]').isDisabled(), true);
    assert.equal(await page.locator('#cf-ab_ui').isDisabled(), true);
    results.push('config editor ghosts afterburner choices whose hardware is unavailable');
    await page.goto(`${base}/sequence.html`);
    await page.locator('.seq-tab', { hasText: 'Control Rules' }).click();
    assert.equal(await page.locator('#tab-rules iframe').count(), 0);
    assert.equal(await page.locator('#rule-sensor-0 option[value="13"]').isDisabled(), true);
    assert.equal(await page.locator('#rule-act-0 option[value="1"]').isDisabled(), true);
    await page.request.patch(`${base}/api/hardware`, { data: {
      has_afterburner: false,
      has_two_shaft: false,
      sensors: { n2_rpm: { enabled: true } },
      actuators: { ab_sol: { enabled: true }, ab_pump: { enabled: true } },
      ab_trigger: { input_pin: 32 },
      channel_registry: hardwareBeforeAbRemoval.channel_registry
    } });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#save-status')?.textContent === 'No unsaved changes');
    assert.equal(await page.locator('#add-afterburner-sel option[value="ABPumpOn"]').count(), 1);
    assert.equal(await page.locator('#add-afterburner-sel option[value="ABSolOpen"]').count(), 1);
    await page.locator('.seq-tab', { hasText: 'Control Rules' }).click();
    assert.equal(await page.locator('#rule-sensor-0 option[value="6"]').isDisabled(), false);
    assert.equal(await page.locator('#rule-sensor-0 option[value="24"]').isDisabled(), false);
    assert.equal(await page.locator('#rule-act-0 option[value="11"]').isDisabled(), false);
    results.push('sequence derives N2 and afterburner choices from fitted devices, ignoring legacy master flags');

    const automationState = await state(page);
    await page.request.patch(`${base}/api/hardware`, { data: { channel_registry: {
      ...automationState.hardware.channel_registry,
      inputs: automationState.hardware.channel_registry.inputs.map(channel => channel.id === 'torque_main'
        ? { id: 'lamp_dimmer_knob', name: 'Lamp Dimmer', purpose: 'generic', role: 'generic', driver: 1, pin: 37, min: 400, max: 3600, installed: true }
        : channel),
      outputs: automationState.hardware.channel_registry.outputs.concat([
        { id: 'warning_lamp_pwm', name: 'Warning Lamp', purpose: 'generic', role: 'generic', driver: 5, pin: 38, min: 0, max: 1, installed: true }
      ])
    } } });
    await page.reload();
    await page.locator('.seq-tab', { hasText: 'Control Rules' }).click();
    const dimmerPreset = page.locator('[data-rule-preset="adc_pwm_dimmer"]');
    assert.equal(await dimmerPreset.getAttribute('aria-disabled'), 'false');
    await dimmerPreset.click();
    assert.equal(await page.locator('#rules-list .automation-card').count(), 2);
    assert.equal(await page.locator('#rule-kind-1').inputValue(), '1');
    assert.match(await page.locator('#rule-sensor-1 option:checked').textContent(), /Lamp Dimmer/);
    assert.match(await page.locator('#rule-act-1 option:checked').textContent(), /Warning Lamp/);
    assert.equal(await page.locator('#rule-mode-standby-1').isChecked(), false);
    assert.equal(await page.locator('#rule-mode-startup-1').isChecked(), true);
    assert.equal(await page.locator('#rule-mode-running-1').isChecked(), true);
    assert.equal(await page.locator('#rule-mode-shutdown-1').isChecked(), true);
    await page.locator('#rule-in-min-1').fill('10');
    await page.locator('#rule-in-max-1').fill('90');
    await page.locator('#rule-out-min-1').fill('15');
    await page.locator('#rule-out-max-1').fill('65');
    await page.locator('#save-btn').click();
    await page.locator('#ot-dialog-confirm').click();
    await page.waitForFunction(() => document.querySelector('#reboot-overlay')?.classList.contains('show'));
    saved = await state(page);
    assert.equal(saved.hardware.profile_id, saved.settings.profile_id);
    assert.equal(saved.hardware.startup_delay_ms[6], 6000);
    assert.equal(saved.settings.rules.length, 2);
    assert.equal(saved.settings.rules[1].kind, 1);
    assert.equal(saved.settings.rules[1].mode_mask, 14);
    assert.equal(saved.settings.rules[1].input_min, 0.1);
    assert.equal(saved.settings.rules[1].input_max, 0.9);
    assert.equal(saved.settings.rules[1].output_min, 0.15);
    assert.equal(saved.settings.rules[1].output_max, 0.65);
    results.push('control rules expose each engine state directly and preserve canonical percentage saves');

    const unified = await (await page.request.get(`${base}/api/ecu_config`)).json();
    unified.hardware.profile_id = 'second-bench-engine';
    unified.settings.profile_id = 'second-bench-engine';
    response = await page.request.post(`${base}/api/ecu_config`, { data: unified });
    assert.equal(response.ok(), true);
    const crossed = structuredClone(unified);
    crossed.settings.profile_id = 'wrong-engine';
    response = await page.request.post(`${base}/api/ecu_config`, { data: crossed });
    assert.equal(response.status(), 400);
    saved = await state(page);
    assert.equal(saved.hardware.profile_id, saved.settings.profile_id);
    results.push('full engine-file restore accepts matching identities and rejects crossed sections');

    // The log page now follows the site-wide unit preference; earlier steps
    // in this run left °F/PSI active, so pin to canonical units first.
    await page.evaluate(() => localStorage.setItem('ot_units', JSON.stringify({ temp: 'C', press: 'bar' })));
    await page.goto(`${base}/log.html`);
    await page.waitForFunction(() => document.body.textContent.includes('Run #'));
    const logText = await page.locator('body').textContent();
    assert.match(logText, /Low_Oil|LOW_OIL|Fault/);
    assert.match(logText, /Peak TIT/);
    assert.match(logText, /TIT 840/);
    assert.match(logText, /Oil 0\.55 bar/);
    // And the same summaries convert when the preference is imperial.
    await page.evaluate(() => localStorage.setItem('ot_units', JSON.stringify({ temp: 'F', press: 'psi' })));
    await page.reload();
    await page.waitForFunction(() => document.body.textContent.includes('Run #'));
    assert.match(await page.locator('body').textContent(), /TIT 1544/);
    results.push('event log renders firmware event keys, TIT peaks, and follows the unit preference');

    await page.locator('#tab-session').click();
    await page.locator('#session-save-btn:not([disabled])').waitFor();
    assert.equal(await page.locator('[data-bit="p1"]').count(), 1);
    assert.equal(await page.locator('[data-bit="p2"]').count(), 1);
    await page.locator('#session-log-interval').fill('750');
    await page.locator('#event-snapshot-interval').fill('12500');
    await page.locator('#session-save-btn').click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#session-save-msg')).display !== 'none');
    saved = await state(page);
    assert.equal(saved.settings.session_log.interval_ms, 750);
    assert.equal(saved.settings.telemetry.snapshot_interval_ms, 12500);
    results.push('Log > Session Data owns channel selection and logging intervals');

    await page.evaluate(() => renderSummary([], 8));
    assert.match(await page.locator('#runs-container').textContent(), /No engine runs in the currently loaded log\. 8 diagnostic events are still available under All Events\./);
    await page.evaluate(() => renderSummary([], 0));
    assert.match((await page.locator('#runs-container').textContent()).trim(), /^No engine runs in the currently loaded log\..*return to STANDBY and click Refresh\.$/s);
    results.push('empty run summary distinguishes diagnostic events from engine runs');

    console.log(`UI smoke test passed (${results.length} checks):`);
    results.forEach(result => console.log(`- ${result}`));
  } finally {
    await browser.close();
  }
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
