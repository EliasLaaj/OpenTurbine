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
  await page.evaluate(() => document.querySelectorAll('.config-group,.protection-card').forEach(group => { group.open = true; }));
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
    if (dialog.type() === 'beforeunload') await dialog.accept();
    else {
      console.error(`Browser dialog: ${dialog.message()}`);
      await dialog.dismiss();
    }
  });
  const results = [];
  let saved;

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
    assert.equal(await text(page, '#registry-input-value-operator_throttle'), '50.0');
    assert.equal(await text(page, '#registry-input-value-operator_idle'), '28.0');
    assert.equal(await page.evaluate(() =>
      ['tot-card', 'tit-card', 'n1-card', 'n2-card'].every(id =>
        document.querySelector('#temperature-cards').contains(document.getElementById(id)))), true);
    assert.equal(await page.locator('[data-registry-input-id="operator_throttle"]').count(), 0);
    assert.equal(await page.locator('[data-registry-input-id="operator_idle"]').count(), 0);
    assert.equal(await page.locator('[data-registry-input-id="start_switch"]').count(), 0);
    assert.equal(await page.locator('[data-registry-input-id="stop_switch"]').count(), 0);
    assert.match(await text(page, '#di-state-items'), /Start Switch\s*OFF.*Stop Switch\s*OFF/s);
    const compactRender = await page.evaluate(() => {
      renderRegistryInputCards({ registry_inputs: [
        { id: 'operator_throttle', value: .42, healthy: true },
        { id: 'operator_idle', value: .17, healthy: true },
        { id: 'start_switch', value: 0, healthy: true },
        { id: 'stop_switch', value: 0, healthy: true }
      ] });
      return {
        throttle: document.getElementById('registry-input-value-operator_throttle')?.textContent,
        idle: document.getElementById('registry-input-value-operator_idle')?.textContent,
        switches: document.getElementById('di-state-items')?.textContent
      };
    });
    assert.equal(await page.locator('.registry-input-card').count(), 0);
    assert.equal(compactRender.throttle, '42.0');
    assert.equal(compactRender.idle, '17.0');
    assert.match(compactRender.switches, /Start Switch\s*OFF.*Stop Switch\s*OFF/s);
    const compactV2 = await page.evaluate(() => {
      const v = Array(72).fill(0);
      Object.assign(v, {0:12345, 4:654, 6:123, 7:101, 17:42, 20:37, 25:33, 37:15000});
      const prior = {
        registry_inputs:[{id:'pressure_test'}],
        registry_outputs:[{id:'starter_test'}]
      };
      const decoded = decodeCompactTelemetry({
        cv:2, s:91, m:1, v,
        f:(2 ** 3) + (2 ** 5) + (2 ** 18) + (2 ** 20),
        g:(2 ** 26) + (2 ** 27) + (2 ** 29) + (2 ** 31),
        io:1, ih:1, oo:1, oh:1, di:5,
        iv:[12.34], ir:[2048], ov:[67], oc:[12],
        am:2, sq:[3,8], u:99, bc:4, rr:1, lg:2, lq:3, lc:0, tr:7
      }, prior);
      return {
        mode:decoded.mode, n1:decoded.n1, tot:decoded.tot, oil:decoded.oil,
        p1:decoded.p1, throttle:decoded.throttle_input_norm,
        fuel:decoded.throttle_effective, starter:decoded.starter_demand,
        maxN1:decoded.max_n1, n1Healthy:decoded.n1_healthy,
        starterOn:decoded.starter_enabled, igniterOn:decoded.igniter_on,
        hardwareReady:decoded.hardware_ready, loggerHealthy:decoded.session_logger_healthy,
        limitedStart:decoded.limited_start_allowed, seq:[decoded.seq_block_idx,decoded.seq_block_total],
        input:decoded.registry_inputs[0], output:decoded.registry_outputs[0]
      };
    });
    assert.deepEqual(compactV2, {
      mode:'STARTUP', n1:12345, tot:654, oil:1.23, p1:1.01, throttle:.42,
      fuel:.37, starter:.33, maxN1:15000, n1Healthy:true, starterOn:true,
      igniterOn:true, hardwareReady:true, loggerHealthy:true, limitedStart:true,
      seq:[3,8], input:{id:'pressure_test',value:12.34,raw:2048,healthy:true},
      output:{id:'starter_test',demand:.67,current_amps:1.2,current_healthy:true}
    });
    results.push('compact v2 decodes all live numerical, health, input, and output arrays');
    await scenario(page, 'full');
    await page.waitForFunction(() => document.getElementById('di-state-items')?.textContent?.includes('Maintenance Interlock'));
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
    assert.equal(await page.locator('[data-registry-input-id="maintenance_interlock"]').count(), 0);
    assert.equal(await page.locator('#di-states-wrap').isVisible(), true);
    assert.match(await text(page, '#di-state-items'), /Maintenance Interlock\s*ON/);
    assert.equal(await page.locator('#di-state-items .switch-input-state.is-caution').count(), 1);
    assert.equal(await page.locator('#di-state-items .switch-input-state').first().evaluate(el =>
      ['', 'none'].includes(getComputedStyle(el, '::before').content)), true);
    assert.deepEqual(await page.evaluate(() => [
      formatTelemetryAge(5900), formatTelemetryAge(65400), formatTelemetryAge(3723000)
    ]), ['5 s', '1m 5s', '1h 2m 3s']);
    await page.evaluate(() => setTelemetryStale(true, 4200));
    const staleGeometry = await page.evaluate(() => {
      const nav = document.querySelector('nav').getBoundingClientRect();
      const banner = document.getElementById('telemetry-stale-banner').getBoundingClientRect();
      return { navBottom: nav.bottom, bannerTop: banner.top, bannerBottom: banner.bottom };
    });
    assert.ok(staleGeometry.bannerTop >= staleGeometry.navBottom - 0.5);
    assert.ok(staleGeometry.bannerBottom > staleGeometry.bannerTop);
    await page.evaluate(() => setTelemetryStale(false));
    results.push('compact switch/operator inputs stay out of sensor cards and stale telemetry stays below navigation');

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
    await page.waitForFunction(() => !document.getElementById('start-confirm-checks')?.textContent?.includes('Checking'));
    const startChecks = await text(page, '#start-confirm-checks');
    assert.match(startChecks, /ECU mode\s*STANDBY/i);
    assert.match(startChecks, /N1\s*0 RPM\s*·\s*OK/i);
    assert.match(startChecks, /TOT\s*24 °C\s*·\s*OK/i);
    assert.match(startChecks, /Oil Press\s*0\.00 bar\s*·\s*OK/i);
    assert.match(startChecks, /STOP input\s*Released/i);
    assert.match(startChecks, /Safety state\s*Normal checks/i);
    assert.match(startChecks, /Startup sequence\s*\d+ blocks?/i);
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
    results.push('start confirmation exposes compact live ECU start checks before command');

    await page.request.post(`${base}/__sim/data`, { data: {
      mode: 'STANDBY', tot: 731, tot_healthy: false, limited_start_allowed: true,
      limited_start_sensor: 'TOT', limp_throttle_cap: 35
    } });
    await page.waitForFunction(() => _lastData?.limited_start_allowed === true);
    const failedTotSparkLength = await page.evaluate(() => _sparkTot.length);
    assert.equal(await text(page, '#tot'), '—');
    await page.request.post(`${base}/__sim/data`, { data: { tot: 812, tot_healthy: false } });
    await page.waitForFunction(() => Number(_lastData?.tot) === 812);
    assert.equal(await text(page, '#tot'), '—');
    assert.equal(await page.evaluate(() => _sparkTot.length), failedTotSparkLength);
    await page.evaluate(() => showStartConfirm());
    assert.equal(await page.locator('#btn-limited-start').count(), 0);
    assert.equal(await page.locator('#btn-confirm-limited-start').count(), 0);
    assert.equal(await text(page, '#btn-confirm-start'), 'Start Reduced Power');
    assert.equal(await page.locator('#btn-confirm-start').isDisabled(), false);
    assert.match(await text(page, '#start-confirm-checks'), /TOT feedback is unavailable.*fuel cap.*afterburner.*unrelated interlock/is);
    await page.locator('#btn-confirm-start').click();
    await page.waitForFunction(() => _lastData?.mode === 'STARTUP' && _lastData?.limp_mode === true);
    saved = await state(page);
    assert.ok(saved.commands.some(command => command.cmd === 'START_LIMITED'));
    results.push('one eligible sensor failure changes the single confirmation action to reduced-power start and keeps failed readings stable');
    await scenario(page, 'full');
    await page.waitForFunction(() => _lastData?.mode === 'RUNNING' && Number(_lastData?.throttle_demand) === 0.61);

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
    assert.equal(await text(page, '#n1-rate-val'), '+850 rpm/s');
    assert.equal(await text(page, '#n2-rate-val'), '-120 rpm/s');
    assert.equal(await text(page, '#starter-en-state'), 'ON');
    assert.equal(await text(page, '#starter-pct'), '33');
    assert.equal(await text(page, '#fuel-sol-state'), 'OPEN');
    assert.equal(await text(page, '#igniter-state'), 'OFF');
    assert.equal(await text(page, '#igniter2-state'), 'OFF');
    assert.equal(await page.locator('#starter-en-state').evaluate(el => el.classList.contains('binary-state-active')), true);
    assert.equal(await page.locator('#fuel-sol-state').evaluate(el => el.classList.contains('binary-state-active')), true);
    assert.equal(await page.locator('#igniter-state').evaluate(el => el.classList.contains('binary-state-inactive')), true);
    assert.equal(await page.locator('#igniter-gauge-bar').count(), 0);
    assert.equal(await page.locator('#igniter2-gauge-bar').count(), 0);
    assert.equal(await text(page, '#glow-pct'), '20');
    assert.equal(await text(page, '#bleed-state'), '35');
    assert.equal(await text(page, '#bleed-unit'), '%');
    assert.equal(await text(page, '#coolfan-state'), '72');
    assert.equal(await text(page, '#coolfan-unit'), '%');
    assert.equal(await text(page, '#airstarter-state'), 'CLOSED');
    assert.equal(await text(page, '#scavenge-state'), '64');
    assert.equal(await text(page, '#scavenge-unit'), '%');
    assert.equal(await text(page, '#pitch-pct'), '38');
    assert.equal(await text(page, '#fp2-pct'), '42');
    assert.equal(await text(page, '#ab-pump-demand'), '27');
    assert.equal(await text(page, '#ab-pump-unit'), '%');
    assert.equal(await text(page, '#ab-sol-state'), 'VALVE CLOSED');
    assert.equal(await text(page, '#ab-arm-state'), 'ARMED');
    assert.equal(await page.locator('#ab-arm-state.ab-state-caution').count(), 1);
    assert.equal(await text(page, '#ab-flame-state'), 'NONE');
    assert.equal(await text(page, '#ab-trig-state'), 'IDLE');
    assert.equal(await page.locator('[data-registry-output-id="drain_valve"] .value').textContent(), 'ON');
    assert.equal(await page.locator('[data-registry-output-id="drain_valve"] .value.binary-state-active').count(), 1);
    assert.equal(await page.locator('[data-registry-output-id="drain_valve"] .gauge-bar-wrap').count(), 0);
    assert.equal(await page.locator('#starter-en-gauge-bar').count(), 0);
    assert.equal(await page.locator('#airstarter-gauge-bar').count(), 0);
    const gaugePercent = id => page.locator(id).evaluate(el =>
      100 * el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width);
    await page.waitForTimeout(400);
    assert.ok(Math.abs(await gaugePercent('#throttle-gauge-bar') - 61) < 1.5);
    assert.ok(Math.abs(await gaugePercent('#oil-output-gauge-bar') - 43) < 1.5);
    assert.ok(Math.abs(await gaugePercent('#starter-gauge-bar') - 33) < 1.5);
    assert.ok(Math.abs(await gaugePercent('#glow-gauge-bar') - 20) < 1.5);
    assert.ok(Math.abs(await gaugePercent('#bleed-gauge-bar') - 35) < 1.5);
    assert.ok(Math.abs(await gaugePercent('#pitch-gauge-bar') - 38) < 1.5);
    assert.ok(Math.abs(await gaugePercent('#fp2-gauge-bar') - 42) < 1.5);
    assert.ok(Math.abs(await gaugePercent('#coolfan-gauge-bar') - 72) < 1.5);
    assert.ok(Math.abs(await gaugePercent('#scavenge-gauge-bar') - 64) < 1.5);
    assert.ok(Math.abs(await gaugePercent('#ab-pump-gauge-bar') - 27) < 1.5);
    assert.equal(await page.locator('[data-registry-output-id="bleed_valve"]').count(), 0);
    assert.equal(await page.locator('[data-registry-output-id="air_starter"]').count(), 0);
    await page.request.post(`${base}/__sim/data`, { data: {
      oil_pct: 18, starter_demand: 0.33, glow_plug_pct: 20,
      prop_pitch_demand: 0.38, fuel_pump2_demand: 0.12, ab_pump_demand: 0.10,
      registry_outputs: [
        {id:'oil_pump',purpose:'oil_pump',driver:11,demand:1},
        {id:'starter',purpose:'starter',driver:11,demand:1},
        {id:'glow_plug',purpose:'glow_plug',driver:11,demand:1},
        {id:'prop_pitch',purpose:'prop_pitch',driver:11,demand:0},
        {id:'fuel_pump',purpose:'fuel_pump',driver:11,demand:1},
        {id:'ab_pump',purpose:'ab_pump',driver:11,demand:1}
      ]
    } });
    await page.waitForFunction(() => document.getElementById('oil-pct')?.textContent === 'ON');
    assert.equal(await text(page, '#starter-pct'), 'ON');
    assert.equal(await text(page, '#glow-pct'), 'ON');
    assert.equal(await text(page, '#pitch-pct'), 'FINE');
    assert.equal(await text(page, '#fp2-pct'), 'ON');
    assert.equal(await text(page, '#ab-pump-demand'), 'ON');
    for (const id of ['oil-output-gauge-bar','starter-gauge-bar','glow-gauge-bar','pitch-gauge-bar','fp2-gauge-bar','ab-pump-gauge-bar']) {
      assert.equal(await page.locator(`#${id}`).evaluate(el => getComputedStyle(el.parentElement).display), 'none');
    }
    await page.request.post(`${base}/__sim/data`, { data: {
      throttle_demand:0, throttle_effective:0, oil_pct:0, starter_demand:0,
      starter_enabled:false, fuel_sol_open:false, igniter_on:false, igniter2_on:false,
      glow_plug_pct:0, bleed_valve_open:false, bleed_valve_demand:0,
      prop_pitch_demand:0, fuel_pump2_demand:0, cool_fan_on:false, cool_fan_demand:0,
      airstarter_open:false, oil_scavenge_on:false, oil_scavenge_demand:0,
      ab_sol_open:false, ab_pump_demand:0,
      registry_outputs: [
        {id:'main_fuel',purpose:'main_fuel',driver:5,demand:.77},
        {id:'oil_pump',purpose:'oil_pump',driver:11,demand:1},
        {id:'starter',purpose:'starter',driver:11,demand:1},
        {id:'starter_enable',purpose:'starter_enable',driver:11,demand:1},
        {id:'fuel_shutoff',purpose:'fuel_shutoff',driver:11,demand:1},
        {id:'igniter',purpose:'igniter',driver:11,demand:1},
        {id:'ab_igniter',purpose:'ab_igniter',driver:11,demand:1},
        {id:'glow_plug',purpose:'glow_plug',driver:11,demand:1},
        {id:'bleed_valve',purpose:'bleed_valve',driver:11,demand:1},
        {id:'prop_pitch',purpose:'prop_pitch',driver:11,demand:1},
        {id:'fuel_pump',purpose:'fuel_pump',driver:11,demand:1},
        {id:'cooling_fan',purpose:'cooling_fan',driver:11,demand:1},
        {id:'air_starter',purpose:'air_starter',driver:11,demand:1},
        {id:'scavenge_pump',purpose:'scavenge_pump',driver:11,demand:1},
        {id:'ab_solenoid',purpose:'ab_valve',driver:11,demand:1},
        {id:'ab_pump',purpose:'ab_pump',driver:11,demand:1}
      ]
    } });
    await page.waitForFunction(() => document.getElementById('throttle-demand')?.textContent === '77.0%');
    assert.equal(await text(page, '#throttle-demand'), '77.0%');
    for (const id of ['oil-pct','starter-pct','starter-en-state','igniter-state','igniter2-state',
      'glow-pct','fp2-pct','coolfan-state','scavenge-state','ab-pump-demand'])
      assert.equal(await text(page, `#${id}`), 'ON');
    for (const id of ['fuel-sol-state','bleed-state','airstarter-state'])
      assert.equal(await text(page, `#${id}`), 'OPEN');
    assert.equal(await text(page, '#pitch-pct'), 'COARSE');
    assert.equal(await text(page, '#ab-sol-state'), 'VALVE OPEN');
    await scenario(page, 'full');
    results.push('dashboard actuator values, compact bars, and relay states follow configured output hardware');
    results.push('dashboard throttle inhibit warning follows selected EGT source, including TIT-primary setups');
    await scenario(page, 'full');

    await scenario(page, 'startup');
    await page.waitForFunction(() => document.getElementById('tot')?.textContent?.includes('175'));
    await page.waitForTimeout(1100);
    await scenario(page, 'full');
    await page.waitForFunction(() => document.getElementById('tot')?.textContent?.includes('640'));
    await page.waitForTimeout(1100);
    await page.goto(`${base}/controllers.html`);
    await page.waitForSelector('#cf-tot_limit', {state:'attached'});
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
    assert.equal(await text(page, '#tot'), '1184');
    assert.equal(await text(page, '#oil'), '31.2');
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
    await page.evaluate(() => stopGlobalTelemetry());
    await page.waitForTimeout(50);
    assert.equal(await text(page, '#tot'), retainedTot);
    await page.evaluate(() => startTelemetryBoot());
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
    const longFault = 'N2 over-speed: power-turbine RPM exceeded its hard shutdown limit.\nWhat to do: Do not restart until the driven load, shaft, coupling, N2 pickup, governor or propeller control, and configured N2 limit have been inspected.';
    await page.request.post(`${base}/__sim/data`, { data: { fault_description: longFault } });
    await page.waitForFunction(expected => document.getElementById('fault-desc-text')?.textContent === expected, longFault);
    assert.equal(await text(page, '#fault-desc-text'), longFault);
    assert.equal(await page.locator('#fault-desc-text').evaluate(el =>
      ['anywhere', 'break-word'].includes(getComputedStyle(el).overflowWrap)), true);
    for (const route of ['/log.html', '/calibration.html', '/controllers.html', '/tools.html'])
      assert.equal(await page.locator(`#fault-card a[href="${route}?v=20260905b"]`).count(), 1);
    results.push('fault scenario exposes the current diagnosis and direct investigation routes');

    await scenario(page, 'full');
    await page.request.post(`${base}/__sim/data`, { data: { mode:'STANDBY', config_locked:false } });
    await page.goto(`${base}/controllers.html`);
    await page.waitForSelector('#cf-tot_limit', {state:'attached'});
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

    await page.setViewportSize({ width: 412, height: 915 });
    await page.evaluate(() => document.querySelector('.save-bar').classList.add('is-dirty'));
    const mobileSaveBar = await page.locator('.save-bar').evaluate(el => {
      const r = el.getBoundingClientRect();
      return { left:r.left, right:r.right, bottom:innerHeight-r.bottom, width:r.width,
        position:getComputedStyle(el).position, viewport:innerWidth,
        docWidth:document.documentElement.scrollWidth };
    });
    assert.ok(mobileSaveBar.left >= 7 && mobileSaveBar.right <= mobileSaveBar.viewport - 7);
    assert.equal(mobileSaveBar.position, 'fixed');
    assert.ok(mobileSaveBar.bottom >= 7 && mobileSaveBar.bottom <= 16);
    assert.ok(mobileSaveBar.docWidth <= mobileSaveBar.viewport);
    await page.evaluate(() => document.querySelector('.save-bar').classList.remove('is-dirty'));
    await page.setViewportSize({ width: 1280, height: 720 });
    results.push('mobile Config save bar stays inside the viewport without creating horizontal overflow');

    await page.request.post(`${base}/__sim/data`, { data: { mode:'RUNNING', dev_mode:true, config_locked:true } });
    await page.waitForFunction(() => runtimeMode === 'RUNNING' && runtimeDevMode === true);
    for (const id of ['#cf-th_ru','#cf-di_tr','#cf-di_db','#cf-di_ig'])
      assert.equal(await page.locator(id).isEnabled(), true, `${id} should be live-editable in RUNNING Developer Mode`);
    assert.equal(await page.locator('#cf-tot_limit').isDisabled(), true);
    await page.locator('#cf-th_ru').fill('1700');
    await page.locator('#btn-save').click();
    if (await page.locator('#ot-dialog-confirm').isVisible().catch(() => false))
      await page.locator('#ot-dialog-confirm').click();
    await page.locator('#save-recap-confirm-btn').click();
    await page.waitForFunction(() => document.querySelector('#save-msg')?.textContent.includes('saves permanently after STOP'));
    saved = await state(page);
    assert.equal(saved.last_config_patch.throttle.ramp_up_ms, 1700);
    await page.request.post(`${base}/__sim/data`, { data: { mode:'STANDBY', dev_mode:true, config_locked:false } });
    await page.waitForFunction(() => runtimeMode === 'STANDBY');
    results.push('RUNNING Developer Mode exposes only live-safe tuning and clearly defers its flash save until STOP');

    await page.locator('#unit-temp-btn').click();
    assert.equal(await page.locator('#cf-tot_limit').inputValue(), '720');
    assert.equal(await page.locator('#cf-tot_safe_margin').inputValue(), '40');
    await page.locator('#unit-temp-btn').click();
    assert.equal(await page.locator('#cf-tot_limit').inputValue(), '1328');
    assert.equal(await page.locator('#cf-tot_safe_margin').inputValue(), '72');
    results.push('switching config units converts configuration inputs without changing meaning');

    await page.locator('#btn-view-expert').click();
    await openConfigWorkspace(page);
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
    saved = await state(page);
    assert.ok(Math.abs(saved.settings.engine.tot_limit - 660) < 0.001);
    assert.ok(Math.abs(saved.settings.engine.tot_safe_margin - 50) < 0.001);
    assert.ok(Math.abs(saved.settings.oil.running_min - 2) < 0.001);
    results.push('config saves converted F and PSI edits back as canonical C and bar values');
    await waitShown(page, '#engine-limits', true);
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

    assert.deepEqual(await page.locator('#flame-noise-mode option').allTextContents(), [
      'Fire igniter while sampling (recommended)',
      'Keep igniter off / use external flame source'
    ]);
    await page.evaluate(() => {
      oilPts = [{ raw: 500, b: 0 }];
      oilCalActive = true;
      document.getElementById('oil-mv-bar').value = '500';
      oilUseDatasheet();
    });
    assert.equal(await page.locator('#oil-step-3').isVisible(), true);
    assert.equal(await page.evaluate(() => oilPts.length), 2);
    assert.match(await text(page, '#oil-fit-summary'), /Datasheet straight-line calibration/);
    results.push('flame calibration makes igniter-off capture explicit and oil datasheet calibration creates a saveable curve');

    assert.deepEqual(await page.locator('#p1-zero-reference option').allTextContents(), [
      'Gauge (ambient = 0 bar)',
      'Absolute (ambient ≈ 1.013 bar)'
    ]);
    await page.evaluate(() => {
      window.applyData({ has_p1:true, p1_raw:1241, p1:1.01325 });
      document.getElementById('p1-zero-reference').value = '1.01325';
      _p12State.p1 = { mode:'physical', zeroRaw:620, refRaw:3102, refBar:5 };
      p12Save('p1');
    });
    await page.waitForFunction(() => document.querySelector('#p1-cal-status')?.textContent.includes('Saved'));
    assert.match(await text(page, '#cal-p1-raw'), /1000 mV/);
    saved = await state(page);
    const savedP1 = saved.hardware.channel_registry.inputs.find(c => c.purpose === 'p1_pressure');
    assert.ok(Math.abs(savedP1.calibration_points[0].value - 1.01325) < 0.00001);
    assert.equal(savedP1.calibration_points[0].raw, 620);
    assert.equal(savedP1.calibration_points[1].value, 5);
    assert.ok(savedP1.analog_zero_mv < 500);
    results.push('all pressure calibrations offer gauge/absolute references, save the selected basis, and show ADC-pin millivolts');

    await page.goto(`${base}/hardware.html`);
    await page.waitForFunction(() => /Loaded|Converted/i.test(document.querySelector('#save-msg')?.textContent || ''));
    assert.equal(await page.evaluate(() => cfg.sensors.throttle_input.rc_pwm), true);
    assert.equal(await page.evaluate(() => Number(cfg.wifi_tx_power_dbm)), 8);
    results.push('hardware page restores servo-input source from saved hardware state');
    await page.evaluate(() => addRegistryChannel('input'));
    const inputCatalog = await text(page, '#registry-add-catalog');
    for (const label of ['Pressure 1', 'Pressure 2',
      'Coolant pressure', 'Coolant temperature', 'Intake / ambient temperature',
      'Low oil pressure switch', 'Zero oil pressure switch', 'Generic PWM duty input']) {
      assert.match(inputCatalog, new RegExp(label.replace(/[()]/g, '\\$&')));
    }
    await page.evaluate(() => closeRegistryAddDialog());
    await page.evaluate(() => addRegistryChannel('output'));
    const outputCatalog = await text(page, '#registry-add-catalog');
    for (const label of ['Coolant pump', 'Air starter', 'Pilot fuel',
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

    const concurrentMerge = await page.evaluate(() => {
      const hardware = mergeHardwareEdits(
        {profile_desc:'old', startup_seq:['OldStart']},
        {profile_desc:'edited', startup_seq:['OldStart']},
        {profile_desc:'newer elsewhere', startup_seq:['FreshStart']});
      const settings = mergeHardwareSettingsCleanup(
        {oil_advanced:{shutdown_on_underflow:true}, rules:[{name:'removed'},{name:'kept'}]},
        {oil_advanced:{shutdown_on_underflow:false}, rules:[{name:'kept'}]},
        {oil_advanced:{shutdown_on_underflow:true}, rules:[{name:'removed'},{name:'kept',threshold:2},{name:'new'}]});
      return {hardware, settings};
    });
    assert.equal(concurrentMerge.hardware.profile_desc, 'edited');
    assert.deepEqual(concurrentMerge.hardware.startup_seq, ['FreshStart']);
    assert.equal(concurrentMerge.settings.oil_advanced.shutdown_on_underflow, false);
    assert.deepEqual(concurrentMerge.settings.rules,
      [{name:'kept',threshold:2},{name:'new'}]);
    results.push('hardware diff preserves concurrent unrelated edits before its page-owned save');

    await page.request.patch(`${base}/api/hardware`, { data: { platform: 'esp32s3' } });
    await page.evaluate(() => { _hwDirty = false; });
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
    await page.goto(`${base}/system.html`);
    await page.locator('#system-device-setup details.config-group').filter({hasText:'Interface color palette and display theme'}).locator('summary').click();
    await page.waitForSelector('#appearance-picker .ot-tile');
    assert.equal(await page.locator('#appearance-picker .ot-tile').count(), 6);
    await page.locator('#appearance-picker [data-theme-key="daylight"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'daylight');
    await page.waitForTimeout(100);
    assert.equal((await state(page)).settings.ui_theme, 'daylight');
    await page.locator('#appearance-picker [data-theme-key="carbon"]').click();
    assert.match(await text(page, '#manual-update-tools'), /Web UI assets.*configuration and logs are retained/is);
    results.push('appearance is owned by System and persists the selected ECU theme');
    await page.goto(`${base}/tools.html`);
    await page.waitForFunction(() => {
      const devButton = document.querySelector('#btn-dev-mode');
      const oilButton = document.querySelector('#btn-OIL_PRIME');
      return devButton && !devButton.disabled && oilButton && !oilButton.disabled;
    });
    assert.equal(await page.locator('#appearance-picker').count(), 0);
    assert.equal(await text(page, '#btn-dev-mode'), 'Enable Dev Mode');
    assert.equal(await page.locator('#card-TOGGLE_BENCH_MODE').isVisible(), false);
    assert.equal(await page.locator('#card-TOGGLE_SAFETY_CHECKS').isVisible(), false);
    assert.equal(await page.locator('#card-TOGGLE_DYNAMIC_IDLE').count(), 0);
    assert.equal(await page.locator('#btn-test-settings').count(), 1);
    assert.equal(await page.locator('.tool-card button[title*="bench-test timing"]').count(), 0);
    assert.match(await text(page, '#card-IDLE_TEST'), /main fuel metering.*minimum reliable output \(10%\)/i);
    await page.request.post(`${base}/__sim/data`, { data: { dev_mode: true } });
    await waitShown(page, '#card-TOGGLE_BENCH_MODE', true);
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
    results.push('tools gates prerequisites, renders and saves all themes, and uses one restorable confirmation preference for the full page');

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
    await page.evaluate(() => { window.__blockPickerSnapshot = JSON.parse(JSON.stringify(hwCfg)); });
    await page.locator('#tab-startup .add-btn', {hasText:'Add block'}).click();
    assert.equal(await page.locator('#block-picker-dlg').isVisible(), true);
    assert.ok(await page.locator('#block-picker-list .block-picker-option').count() > 3);
    const starterDefinition = await page.evaluate(() => ({
      label: BLOCKS.StarterSpin.label,
      keys: BLOCKS.StarterSpin.params.map(param => param.key)
    }));
    assert.equal(starterDefinition.label, 'Set Starter');
    for (const key of ['starter_demand','ramp_pct_per_s','pulsed_assist_enabled',
      'pulsed_assist_pwm_pct','pulsed_assist_until_rpm','pulsed_assist_on_ms','pulsed_assist_off_ms'])
      assert.ok(starterDefinition.keys.includes(key));
    for (const viewport of [{width:1000,height:800}, {width:390,height:844}]) {
      await page.setViewportSize(viewport);
      assert.equal(await page.locator('#block-picker-list').evaluate(list =>
        list.scrollWidth <= list.clientWidth + 1 && Array.from(list.children).every(choice =>
          choice.scrollWidth <= choice.clientWidth + 1 && choice.clientWidth >= list.clientWidth - 10)), true);
    }
    await page.setViewportSize({width:1280,height:720});
    await page.locator('#block-picker-list .block-picker-option', {hasText:'Timed Delay'}).click();
    assert.equal(await page.evaluate(() => hwCfg.startup_seq.at(-1)), 'TimedDelay');
    assert.equal(await page.evaluate(() => typeof window.OTWaitForSaveRestart), 'function');
    await page.evaluate(() => {
      hwCfg = window.__blockPickerSnapshot;
      delete window.__blockPickerSnapshot;
      render('startup', lastIdleRaw);
      populateAddSelects();
    });
    const unifiedOutputBlock = await page.evaluate(() => {
      const snapshot = JSON.parse(JSON.stringify(hwCfg));
      hwCfg.channel_registry.outputs.push({
        id:'pilot_fuel', name:'Pilot Fuel', purpose:'pilot_fuel', role:'valve',
        driver:4, pin:18, min:0, max:1, safe_demand:0, installed:true
      });
      populateAddSelects();
      const select = document.querySelector('#add-startup-sel');
      const option = Array.from(select.options).find(row => row.value.startsWith('SetOutput::'));
      if (!option) return {available:false};
      const pilotAction = getEnabledActuators().find(action => action.target === 'pilot_fuel');
      const pilotOption = Array.from(select.options).some(row => row.value === 'SetOutput::pilot_fuel');
      select.value = option.value;
      const expectedTarget = option.value.split('::')[1];
      addBlock('startup');
      const index = hwCfg.startup_seq.length - 1;
      const action = hwCfg.startup_enter_actions[index]?.[0];
      const label = document.querySelector(`#list-startup .block-card[data-idx="${index}"] .block-name`)?.textContent || '';
      const result = {
        available:true,
        block:hwCfg.startup_seq[index],
        target:action?.target || '',
        expectedTarget,
        professionalLabel:/^Set\s+\S/.test(label),
        pilotAvailable:!!pilotAction && pilotOption
      };
      hwCfg = snapshot;
      render('startup', lastIdleRaw);
      populateAddSelects();
      return result;
    });
    assert.deepEqual(unifiedOutputBlock, {
      available:true, block:'SetOutput', target:unifiedOutputBlock.expectedTarget,
      expectedTarget:unifiedOutputBlock.expectedTarget, professionalLabel:true, pilotAvailable:true
    });
    results.push('sequence block picker adds one clicked choice directly and the shared reboot wait is available');
    results.push('sequence offers one editable Set Output action per fitted device and stores its exact physical target');
    const stableDeviceBinding = await page.evaluate(() => {
      const snapshot = JSON.parse(JSON.stringify(hwCfg));
      const physicalActionsHaveIds = getEnabledActuators().every(action => !!action.target);
      const fuelOpenSuggested = suggestedBlockOutputs('FuelOpen');
      const fuelOpenAll = compatibleBlockOutputs('FuelOpen');
      const fuelOpenHtml = buildDeviceTargetHtml('FuelOpen', 0, 'startup');
      const groupedOverrides = fuelOpenSuggested.length >= 1 &&
        fuelOpenAll.length > fuelOpenSuggested.length &&
        fuelOpenHtml.includes('Suggested') && fuelOpenHtml.includes('Other fitted outputs');
      const tab = 'startup';
      const sequence = hwCfg[seqKey(tab)] || [];
      const index = sequence.findIndex((name, row) => name === 'SetOutput' && sideActionMeta(setOutputAction(tab, row)));
      if (index < 0) return {physicalActionsHaveIds, exercised:false};
      const originalMeta = sideActionMeta(setOutputAction(tab, index));
      const original = hwCfg.channel_registry.outputs.find(output => output.id === originalMeta.target);
      const duplicate = JSON.parse(JSON.stringify(original));
      duplicate.id = 'smoke_exact_output';
      duplicate.name = 'Smoke exact output';
      duplicate.mirror_of = '';
      duplicate.installed = true;
      hwCfg.channel_registry.outputs.push(duplicate);
      const choices = getEnabledActuators().length;
      ensureActionSlots(tab);
      const sideKey = actionKey(tab, 'enter');
      hwCfg[sideKey][index] = [{act:originalMeta.actuator, target:original.id, value:.5}];
      updateSetOutput(tab, index, duplicate.id, null);
      const exactSideAction = hwCfg[sideKey][index][0].target === duplicate.id &&
        hwCfg[sideKey][index][0].act >= 64;
      const destination = index === 0 ? 1 : 0;
      moveBlockTo(tab, index, destination);
      const followedReorder = hwCfg[sideKey][destination]?.[0]?.target === duplicate.id;
      hwCfg.channel_registry.outputs = hwCfg.channel_registry.outputs.filter(output => output.id !== duplicate.id);
      render(tab, lastIdleRaw);
      const missingVisible = Array.from(document.querySelectorAll('#list-startup select option'))
        .some(option => option.selected && option.textContent.includes('Missing output: smoke_exact_output'));
      const saveBlocked = validateSequenceHardwareForSave().some(error => error.includes('smoke_exact_output'));
      hwCfg = snapshot;
      migrateLegacyDeviceTargets();
      render(tab, lastIdleRaw);
      return {physicalActionsHaveIds, exercised:true, choices, exactSideAction, followedReorder, missingVisible, saveBlocked, groupedOverrides};
    });
    assert.equal(stableDeviceBinding.physicalActionsHaveIds, true);
    assert.equal(stableDeviceBinding.exercised, true);
    assert.ok(stableDeviceBinding.choices >= 2);
    assert.equal(stableDeviceBinding.exactSideAction, true);
    assert.equal(stableDeviceBinding.followedReorder, true);
    assert.equal(stableDeviceBinding.missingVisible, true);
    assert.equal(stableDeviceBinding.saveBlocked, true);
    assert.equal(stableDeviceBinding.groupedOverrides, true,
      'sequence output selectors should group purpose matches before explicit alternate outputs');
    const startupCards = page.locator('#list-startup .block-card');
    assert.equal(await page.locator('#list-startup .bip-btn').count(), await startupCards.count(),
      'every sequence block should expose the same help control');
    assert.equal(await page.locator('#block-info-panel').count(), 0,
      'sequence help must not use a detached panel at the bottom of the page');
    const firstInfoButton = page.locator('#list-startup .bip-btn').first();
    await firstInfoButton.click();
    const firstInfoPanel = page.locator('#list-startup .block-card').first().locator('.block-info-panel');
    assert.equal(await firstInfoPanel.isVisible(), true);
    assert.equal(await firstInfoButton.getAttribute('aria-expanded'), 'true');
    assert.ok((await firstInfoPanel.locator('.bip-desc').textContent()).trim().length > 10);
    await firstInfoPanel.locator('.bip-close').click();
    assert.equal(await firstInfoPanel.isVisible(), false);
    const reorderHandles = page.locator('#list-startup .drag-handle');
    assert.equal(await reorderHandles.count(), await page.locator('#list-startup .block-card').count());
    assert.match(await reorderHandles.first().getAttribute('aria-label'), /arrow keys/i);
    const initialBlockOrder = await page.locator('#list-startup .block-card').evaluateAll(cards => cards.map(card => card.dataset.block));
    const draggedHandle = page.locator(`#list-startup .block-card[data-block="${initialBlockOrder[0]}"] .drag-handle`).first();
    await draggedHandle.scrollIntoViewIfNeeded();
    const firstHandleBox = await draggedHandle.boundingBox();
    const secondCardBox = await page.locator('#list-startup .block-card').nth(1).boundingBox();
    assert.ok(firstHandleBox && secondCardBox);
    const pointerId = 7;
    await draggedHandle.dispatchEvent('pointerdown', {
      pointerId, pointerType: 'touch', button: 0,
      clientX: firstHandleBox.x + firstHandleBox.width / 2,
      clientY: firstHandleBox.y + firstHandleBox.height / 2
    });
    await draggedHandle.dispatchEvent('pointermove', {
      pointerId, pointerType: 'touch', button: 0,
      clientX: secondCardBox.x + secondCardBox.width / 2,
      clientY: secondCardBox.y + secondCardBox.height * .8
    });
    await draggedHandle.dispatchEvent('pointerup', {
      pointerId, pointerType: 'touch', button: 0,
      clientX: secondCardBox.x + secondCardBox.width / 2,
      clientY: secondCardBox.y + secondCardBox.height * .8
    });
    await page.waitForFunction(first => document.querySelectorAll('#list-startup .block-card')[1]?.dataset.block === first, initialBlockOrder[0]);
    await page.evaluate(() => moveBlockTo('startup', 1, 0));
    assert.deepEqual(await page.locator('#list-startup .block-card').evaluateAll(cards => cards.map(card => card.dataset.block)), initialBlockOrder);
    const finalStateColumns = await page.locator('#final-state-startup .fs-row').evaluateAll(rows => rows.map(row => {
      const label = row.querySelector('.fs-label').getBoundingClientRect();
      const value = row.querySelector('.fs-val').getBoundingClientRect();
      return { labelX: Math.round(label.x), valueX: Math.round(value.x), width: Math.round(row.getBoundingClientRect().width) };
    }));
    assert.equal(new Set(finalStateColumns.map(row => row.labelX)).size, 1);
    assert.equal(new Set(finalStateColumns.map(row => row.valueX)).size, 1);
    assert.equal(new Set(finalStateColumns.map(row => row.width)).size, 1);
    const delayInputs = page.locator('#list-startup .block-card[data-block="TimedDelay"] input[type="number"]');
    assert.equal(await delayInputs.count(), 3);
    assert.deepEqual(await delayInputs.evaluateAll(els => els.map(el => el.value)), ['15000', '10000', '5000']);
    await page.locator('#list-startup .block-card[data-block="TimedDelay"] .block-header').nth(2).click();
    await delayInputs.nth(2).click();
    await delayInputs.nth(2).press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await delayInputs.nth(2).type('6000', {delay:20});
    assert.equal(await delayInputs.nth(2).inputValue(), '6000');
    assert.equal(await delayInputs.nth(2).evaluate(el => document.activeElement === el), true);
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
    results.push('sequence editor preserves exact device IDs through reorder/removal, keeps independent delays, and edits AB gates in friendly units');
    // This test intentionally leaves the AB edits unsaved; clear its synthetic
    // dirty state before moving on after separately asserting dirty navigation.
    assert.equal(await page.evaluate(() => _seqDirty), true);
    await page.evaluate(() => clearSequenceDirty('Test navigation cleanup'));
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
    await page.evaluate(() => { _hwDirty = false; });
    await page.goto(`${base}/controllers.html`);
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
    assert.equal(await page.locator('#cf-ab_fm').count(), 0);
    assert.equal(await page.locator('#cf-ab_pcm').count(), 0);
    assert.equal(await page.locator('#cf-ab_ui').count(), 0);
    results.push('Controllers removes afterburner-only settings when their output controller hardware is unavailable');
    await page.goto(`${base}/sequence.html`);
    assert.equal(await page.locator('.seq-tab', { hasText: 'Control Rules' }).count(), 0);
    assert.equal((await page.evaluate(() => getEnabledSensors().map(row => row.key))).includes('p1'), false);
    assert.equal((await page.evaluate(() => getEnabledActuators().map(row => row.key))).includes('bleed_valve'), false);
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
    const afterburnerOutputChoices = await page.evaluate(() => {
      const choices = Array.from(document.querySelectorAll('#add-afterburner-sel option'))
        .filter(option => option.value.startsWith('SetOutput::'))
        .map(option => option.value.split('::')[1]);
      const actions = getEnabledActuators();
      return {
        choices,
        pump:actions.find(action => action.key === 'ab_pump')?.target || '',
        valve:actions.find(action => action.key === 'ab_sol')?.target || ''
      };
    });
    assert.ok(afterburnerOutputChoices.choices.includes(afterburnerOutputChoices.pump));
    assert.ok(afterburnerOutputChoices.choices.includes(afterburnerOutputChoices.valve));
    assert.equal((await page.evaluate(() => getEnabledSensors().map(row => row.key))).includes('n2_rpm'), true);
    assert.equal((await page.evaluate(() => getEnabledSensors().map(row => row.key))).includes('ab_input'), true);
    assert.equal((await page.evaluate(() => getEnabledActuators().map(row => row.key))).includes('ab_sol'), true);
    results.push('sequence derives N2 and afterburner choices from fitted devices, ignoring legacy master flags');

    const automationState = await state(page);
    await page.request.patch(`${base}/api/hardware`, { data: { channel_registry: {
      ...automationState.hardware.channel_registry,
      inputs: automationState.hardware.channel_registry.inputs.map(channel => channel.id === 'torque_main'
        ? { id: 'lamp_dimmer_knob', name: 'Lamp Dimmer', purpose: 'generic', role: 'generic', driver: 1, pin: 37, min: 400, max: 3600, installed: true }
        : channel),
      outputs: automationState.hardware.channel_registry.outputs.concat([
        { id: 'pilot_fuel', name: 'Pilot Fuel', purpose: 'pilot_fuel', role: 'valve', driver: 4, pin: 18, min: 0, max: 1, installed: true },
        { id: 'warning_lamp_pwm', name: 'Warning Lamp', purpose: 'generic', role: 'generic', driver: 5, pin: 38, min: 0, max: 1, installed: true }
      ])
    } } });
    await page.goto(`${base}/controllers.html`);
    await page.waitForSelector('#simple-controls');
    const igniterOwnerCard = page.locator('#controller-overview details[data-built-in="relight"]');
    await igniterOwnerCard.locator(':scope > summary').click();
    assert.equal(await page.locator('#controller-overview details[data-built-in="starter-support"]').count(), 0);
    assert.equal(await igniterOwnerCard.locator('#relight-section').count(), 1);
    assert.equal(await igniterOwnerCard.locator('#manual-relight-section').count(), 1);
    const creator = page.locator('#controller-overview .controller-create-card');
    await creator.locator(':scope > summary').click();
    await creator.locator('#new-controller-output').selectOption('warning_lamp_pwm');
    await creator.getByRole('button', {name:'Create controller', exact:true}).click();
    const simpleCard = page.locator('#controller-overview [data-controller-output="warning_lamp_pwm"]');
    if (!(await simpleCard.evaluate((el) => el.open))) {
      await simpleCard.locator(':scope > summary').click();
    }
    await simpleCard.getByLabel('Control method').selectOption('1');
    await simpleCard.getByLabel('Controlled by').selectOption('lamp_dimmer_knob');
    await page.evaluate(() => {
      const index = cfg.rules.length - 1;
      updateSimpleControl(index, 'input_min', 0.1);
      updateSimpleControl(index, 'input_max', 0.9);
      updateSimpleControl(index, 'output_min', 0.15);
      updateSimpleControl(index, 'output_max', 0.65);
      toggleSimpleControlMode(index, 1, true);
    });
    const simpleRule = await page.evaluate(() => cfg.rules.at(-1));
    response = await page.request.patch(`${base}/api/config`, {data:{rules:[simpleRule]}});
    assert.equal(response.ok(), true);
    saved = await state(page);
    assert.equal(saved.settings.rules.length, 1);
    assert.equal(saved.settings.rules[0].kind, 1);
    assert.equal(saved.settings.rules[0].mode_mask, 5);
    assert.equal(saved.settings.rules[0].input_min, 0.1);
    assert.equal(saved.settings.rules[0].input_max, 0.9);
    assert.equal(saved.settings.rules[0].output_min, 0.15);
    assert.equal(saved.settings.rules[0].output_max, 0.65);
    await simpleCard.getByRole('button', {name:'Delete controller'}).click();
    assert.equal(await page.locator('#controller-overview [data-controller-output="warning_lamp_pwm"]').count(), 0);
    assert.ok(await page.locator('#new-controller-output option[value="warning_lamp_pwm"]').count());
    assert.ok(await page.locator('#new-controller-output option[value="pilot_fuel"]').count());
    if (!(await creator.evaluate(el => el.open))) await creator.locator(':scope > summary').click();
    await creator.locator('#new-controller-output').selectOption('pilot_fuel');
    await creator.getByRole('button', {name:'Create controller', exact:true}).click();
    const pilotCard = page.locator('#controller-overview [data-controller-output="pilot_fuel"]');
    assert.equal(await pilotCard.count(), 1);
    if (!(await pilotCard.evaluate(el => el.open))) await pilotCard.locator(':scope > summary').click();
    await pilotCard.getByRole('button', {name:'Delete controller'}).click();
    results.push('Controllers uses expandable local output definitions, including Pilot Fuel, and creates, maps, and deletes them cleanly');

    response = await page.request.post(`${base}/api/ecu_config`, {data:{
      settings: automationState.settings,
      hardware: automationState.hardware
    }});
    assert.equal(response.ok(), true);
    await page.evaluate(() => _clearDirty());
    await page.reload();
    await page.waitForSelector('#controller-overview details[data-built-in="fuel-support"]');
    assert.equal(await page.locator('#controller-overview details[open]').count(), 0);
    const fuelSupportCard = page.locator('#controller-overview details[data-built-in="fuel-support"]');
    await fuelSupportCard.locator(':scope > summary').click();
    assert.equal(await fuelSupportCard.locator('.controller-subcard[open]').count(), 0);
    const throttleSubcard = fuelSupportCard.locator('.controller-subcard').filter({hasText:'Throttle Response'}).first();
    const idleSubcard = fuelSupportCard.locator('.controller-subcard').filter({hasText:'Minimum normal-running fuel authority'}).first();
    assert.equal(await throttleSubcard.locator('#cf-th_mx').count(), 0);
    assert.equal(await idleSubcard.locator('#cf-th_mx').count(), 1);
    await throttleSubcard.locator(':scope > summary').click();
    await throttleSubcard.locator('#cf-th_ru').fill('1650');
    assert.equal(await page.locator('#btn-save').isDisabled(), false,
      'editing a field moved into an output controller card must enable Save');
    await throttleSubcard.locator(':scope > summary').click();
    await idleSubcard.locator(':scope > summary').click();
    assert.equal(await fuelSupportCard.locator('#cf-di_tr').isVisible(), true);
    assert.equal(await fuelSupportCard.locator('#cf-di_tp').isVisible(), false);
    assert.equal(await fuelSupportCard.locator('#cf-di_de').isVisible(), false);
    assert.equal(await fuelSupportCard.locator('#cf-di_dd').isVisible(), false);
    await fuelSupportCard.locator('#cf-di_src').selectOption('2');
    assert.equal(await fuelSupportCard.locator('#cf-di_tr').isVisible(), false);
    assert.equal(await fuelSupportCard.locator('#cf-di_tp').isVisible(), true);
    await fuelSupportCard.locator('#cf-di_mode').selectOption('1');
    const predictiveTuning = fuelSupportCard.locator('#cf-di_pde').locator('xpath=ancestor::details[1]');
    await predictiveTuning.locator(':scope > summary').click();
    assert.equal(await fuelSupportCard.locator('#cf-di_de').isVisible(), false);
    assert.equal(await fuelSupportCard.locator('#cf-di_pde').isVisible(), true);
    assert.equal(await fuelSupportCard.locator('#cf-di_dd').isVisible(), true);
    assert.equal(await fuelSupportCard.locator('#cf-di_dd').getAttribute('min'), '0');
    results.push('Controller subcards start collapsed and Idle keeps its enable, fuel range, and source-relevant settings together');

    await scenario(page, 'minimal');
    await page.goto(`${base}/system.html`);
    await page.waitForSelector('#system-device-setup');
    assert.equal(await page.locator('.cfg-search-wrap').isVisible(), false);
    assert.equal(await page.locator('.cfg-toolbar').isVisible(), false);
    assert.equal(await page.locator('#dev-mode-tools-link').isVisible(), false);
    const cleanSystemBar = page.locator('.save-bar');
    assert.equal(await cleanSystemBar.isVisible(), false);
    await page.evaluate(() => document.querySelector('.save-bar').classList.add('is-dirty'));
    const desktopSystemBar = await cleanSystemBar.evaluate(el => {
      const r = el.getBoundingClientRect();
      return {left:r.left, right:r.right, viewport:innerWidth, width:r.width};
    });
    assert.ok(desktopSystemBar.left >= 0 && desktopSystemBar.right <= desktopSystemBar.viewport,
      `System save bar bounds ${JSON.stringify(desktopSystemBar)}`);
    await page.evaluate(() => document.querySelector('.save-bar').classList.remove('is-dirty'));
    assert.equal(await page.locator('#system-backup-restore').count(), 1);
    assert.equal(await page.locator('#loop-diag-card').count(), 1);
    assert.equal(await page.locator('#card-factory-reset').count(), 1);
    assert.equal(await page.locator('#manual-update-tools').count(), 1);
    assert.equal(await page.locator('#system-device-setup > .system-category').count(), 3);
    assert.match(await text(page, '#card-factory-reset'), /PCB profile is preserved/);
    await page.goto(`${base}/tools.html`);
    assert.equal(await page.locator('#system-backup-restore').count(), 0);
    assert.equal(await page.locator('#loop-diag-card').count(), 0);
    assert.equal(await page.locator('#card-factory-reset').count(), 0);
    assert.equal(await page.locator('#manual-update-tools').count(), 0);
    results.push('System groups identity, runtime, updates, backup, diagnostics, and reset while Tools stays focused on commissioning');

    await page.goto(`${base}/system.html`);
    await page.waitForSelector('#system-device-setup');

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

    const recoveredRun = await page.evaluate(() => parseRuns([
      {t:112, ev:'RUN_SUMMARY', runS:86, maxN1:67100, maxTot:676},
      {t:113, ev:'NORMAL_SHUTDOWN'}
    ])[0]);
    assert.equal(recoveredRun.outcome, 'NORMAL_SHUTDOWN');
    assert.equal(recoveredRun.tStart, 26);
    assert.equal(recoveredRun.runS, 86);
    assert.equal(recoveredRun.peakN1, 67100);
    results.push('completed-run summary recovers from the bounded event window even when START_ATTEMPT is older');

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
