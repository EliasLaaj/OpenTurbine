const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const port = 9300 + Math.floor(Math.random() * 500);
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

async function patchHardware(page, patch) {
  const response = await page.request.patch(`${base}/api/hardware`, { data: patch });
  assert.equal(response.ok(), true);
}

async function patchData(page, patch) {
  const response = await page.request.post(`${base}/__sim/data`, { data: patch });
  assert.equal(response.ok(), true);
}

async function goto(page, route, waitSelector) {
  await page.goto(`${base}/${route}`);
  await page.waitForSelector(waitSelector, { state: 'attached' });
  if (['config.html', 'controllers.html', 'system.html'].includes(route)) {
    // Controller pages intentionally start every card and subcard collapsed.
    // Reveal only the tested field's ancestry instead of depending on the old
    // wall-of-parameters layout.
    await page.evaluate(selector => {
      let node = document.querySelector(selector);
      while (node) {
        if (node.tagName === 'DETAILS') node.open = true;
        node = node.parentElement;
      }
    }, waitSelector);
  }
}

async function revealField(page, selector) {
  await page.evaluate(sel => {
    let node = document.querySelector(sel);
    while (node) {
      if (node.tagName === 'DETAILS') node.open = true;
      node = node.parentElement;
    }
  }, selector);
}

async function shown(page, selector) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    return !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  }, selector);
}

async function disabled(page, selector) {
  return page.evaluate(sel => document.querySelector(sel)?.disabled ?? null, selector);
}

async function checked(page, selector) {
  return page.evaluate(sel => document.querySelector(sel)?.checked ?? null, selector);
}

async function value(page, selector) {
  return page.locator(selector).inputValue();
}

async function visibleIds(page, ids) {
  return page.evaluate(ids => Object.fromEntries(ids.map(id => {
    const el = document.getElementById(id);
    return [id, !!el && getComputedStyle(el).display !== 'none'];
  })), ids);
}

async function optionDisabled(page, selector, value) {
  return page.evaluate(({ selector, value }) => {
    const opt = document.querySelector(`${selector} option[value="${value}"]`);
    return opt ? opt.disabled : null;
  }, { selector, value });
}

(async () => {
  globalThis.OT_UI_SIM_PORT = port;
  await import('./ui_mock_server.mjs');
  const executablePath = installedBrowser();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage();
  page.on('pageerror', error => { throw error; });

  const results = [];
  try {
    await reset(page);

    await goto(page, 'index.html', '#n1-card');
    // Dashboard cards intentionally remain hidden until the first complete
    // telemetry snapshot arrives, preventing a brief incorrect all-sensors
    // layout on initial connection. Wait for that configured-device decision
    // before auditing the full profile.
    await page.waitForFunction(() => {
      const card = document.getElementById('n1-card');
      return card && getComputedStyle(card).display !== 'none';
    }, null, { timeout: 5000 });
    let cards = await visibleIds(page, [
      'n1-card', 'n2-card', 'tot-card', 'tit-card', 'oil-card', 'flame-card', 'p1-card', 'p2-card',
      'oil-temp-card', 'batt-card', 'torque-card', 'glow-current-card', 'igniter-current-card',
      'igniter2-current-card', 'oilpump-current-card', 'fuel-flow-card', 'fuel-press-card',
      'governor-section', 'adv-act-section', 'ab-section', 'relight-card'
    ]);
    for (const [id, isShown] of Object.entries(cards)) assert.equal(isShown, true, `${id} should show with full hardware`);
    results.push('dashboard shows every fitted full-hardware card and advanced section');

    await patchData(page, { has_torque: true, has_n2: true, n2_healthy: false, turbo_power_w: 12345 });
    await page.waitForFunction(() => document.getElementById('turbo-power')?.textContent.trim() === 'N2 required', null, {timeout:4000});
    assert.equal(await shown(page, '#torque-card'), true, 'torque card should still show when torque is fitted without N2');
    assert.equal((await page.locator('#turbo-power').textContent()).trim(), 'N2 required');
    results.push('dashboard shaft power display requires healthy fitted N2 feedback');

    await patchData(page, {
      has_n2: false, has_tit: false, has_oil_press: false, has_flame: false, has_p1: false, has_p2: false,
      has_oil_temp: false, has_batt_voltage: false, has_torque: false, has_glow_current: false,
      has_igniter_current: false, has_igniter2_current: false, has_oil_pump_current: false,
      has_fuel_flow: false, has_fuel_press: false, has_governor: false,
      has_thrust: false, registry_inputs: [], registry_outputs: [],
      has_glow_plug: false, has_bleed_valve: false, has_prop_pitch: false, has_fuel_pump2: false,
      has_starter: false, has_starter_en: false, has_fuel_sol: false, has_igniter: false, has_igniter2: false,
      has_cool_fan: false, has_airstarter: false, has_oil_scavenge: false, has_afterburner: false,
      has_ab_sol: false, has_ab_pump: false, has_ab_flame: false,
      relight_enabled: false
    });
    await page.waitForTimeout(750);
    cards = await visibleIds(page, [
      'n2-card', 'tit-card', 'oil-card', 'flame-card', 'p1-card', 'p2-card', 'oil-temp-card',
      'batt-card', 'torque-card', 'glow-current-card', 'igniter-current-card', 'igniter2-current-card',
      'oilpump-current-card', 'fuel-flow-card', 'fuel-press-card', 'governor-section',
      'adv-act-section', 'ab-section', 'relight-card'
    ]);
    for (const [id, isShown] of Object.entries(cards)) assert.equal(isShown, false, `${id} should hide when hardware is absent`);
    assert.equal(await shown(page, '#temperature-group'), true);
    assert.equal(await shown(page, '#combustion-group'), false);
    assert.equal(await shown(page, '#ext-sensors-section'), false);
    results.push('dashboard hides every absent optional card and empty section without losing core N1/TOT layout');

    await reset(page);
    await goto(page, 'hardware.html', '#hardware-profile-section');
    const hwPrereq = await page.evaluate(() => {
      function st(id) {
        const el = document.getElementById(id);
        return { disabled: !!el?.disabled, checked: !!el?.checked };
      }
      const sst = key => ({ disabled: !safetyAvailability(key).ok, checked: !!cfg.safety[key] });
      const cst = key => ({ disabled: !controllerAvailability(key).ok, checked: !!cfg.controllers[key] });
      cfg.safety.overspeed = cfg.safety.surge = cfg.safety.overtemp = cfg.safety.hot_start = true;
      cfg.safety.low_oil = cfg.safety.oil_zero = cfg.safety.flameout = true;
      cfg.safety.oil_temp_high = cfg.safety.fuel_press_low = cfg.safety.batt_low = true;
      for (const key of ['n1_rpm', 'tot', 'oil_press', 'flame', 'tit', 'oil_temp', 'fuel_press', 'batt_voltage']) {
        cfg.sensors[key].enabled = false;
      }
      cfg.channel_registry.inputs = [];
      cfg.channel_registry.outputs = [];
      updateSafetyPrerequisites(true);
      cfg.controllers.oil_loop = cfg.controllers.dynamic_idle = cfg.controllers.governor = true;
      cfg.actuators.oil_pump.enabled = false;
      cfg.actuators.throttle.enabled = false;
      cfg.has_two_shaft = false;
      cfg.sensors.n2_rpm.enabled = true;
      cfg.actuators.prop_pitch.enabled = false;
      updateFeaturesUI();
      updateHardwarePrerequisites(true);
       return {
        safety: {
          overspeed: sst('overspeed'), surge: sst('surge'), overtemp: sst('overtemp'),
          hotStart: sst('hot_start'), lowOil: sst('low_oil'), oilZero: sst('oil_zero'),
          flameout: sst('flameout'), oilTemp: sst('oil_temp_high'),
          fuelPress: sst('fuel_press_low'), batt: sst('batt_low')
        },
        controllers: { oil: cst('oil_loop'), idle: cst('dynamic_idle'), gov: cst('governor') },
        fuelResponseAutomatic: registryHasPurpose('output', 'main_fuel'),
        currentGroups: {
          oil: { disabled: !registryHasPurpose('output', 'oil_pump'), checked: false },
          glow: { disabled: !registryHasPurpose('output', 'glow_plug'), checked: false }
        },
        n2Visible: registryHasPurpose('input', 'n2_rpm')
      };
    });
    assert.equal(await page.locator('#f-saf-titovertemp').count(), 0);
    for (const state of Object.values(hwPrereq.safety)) assert.deepEqual(state, { disabled: true, checked: false });
    for (const state of Object.values(hwPrereq.controllers)) assert.deepEqual(state, { disabled: true, checked: false });
    assert.equal(hwPrereq.fuelResponseAutomatic, false);
    assert.deepEqual(hwPrereq.currentGroups.oil, { disabled: true, checked: false });
    assert.deepEqual(hwPrereq.currentGroups.glow, { disabled: true, checked: false });
    assert.equal(hwPrereq.n2Visible, false);
    results.push('hardware editor removes unsafe safety/controller dependencies when prerequisite sensors or actuators disappear');

    const typeMatrix = await page.evaluate(() => ({
      mainFuel: registryAllowedDrivers('output', 'fuel', 'main_fuel'),
      starter: registryAllowedDrivers('output', 'starter', 'starter'),
      oilPump: registryAllowedDrivers('output', 'oil_pump', 'oil_pump'),
      igniter: registryAllowedDrivers('output', 'igniter', 'igniter'),
      abPump: registryAllowedDrivers('output', 'ab_pump', 'ab_pump'),
      propPitch: registryAllowedDrivers('output', 'prop_pitch', 'prop_pitch'),
      tot: registryAllowedDrivers('input', 'temperature', 'tot'),
      torque: registryAllowedDrivers('input', 'torque', 'torque'),
      abFlame: registryAllowedDrivers('input', 'flame', 'ab_flame'),
      throttle: registryAllowedDrivers('input', 'operator', 'throttle')
    }));
    assert.deepEqual(typeMatrix, {
      mainFuel:[5,6], starter:[4,5,6,11], oilPump:[4,5,6,11], igniter:[4,5,11],
      abPump:[4,5,6,11], propPitch:[4,5,6,11], tot:[1,9], torque:[1,9,10],
      abFlame:[0,1,8,9], throttle:[1,3,2,7,9]
    });
    results.push('hardware editor type selectors include only compatible native and shared-I2C signal types');

    const igniterCapabilityUx = await page.evaluate(() => {
      cfg.actuators = cfg.actuators || {};
      cfg.actuators.igniter = {...(cfg.actuators.igniter || {}), pwm:true, coil:true};
      const relay = registryIgniterSubcards({driver:11}, 0, 'igniter');
      const pwm = registryIgniterSubcards({driver:5}, 0, 'igniter');
      return {
        relaySimple: relay.includes('Relay-style outputs use Simple on/off') &&
          !relay.includes('value="coil"') && !relay.includes('value="pwm"'),
        pwmAdvanced: pwm.includes('value="coil"') && pwm.includes('value="pwm"')
      };
    });
    assert.deepEqual(igniterCapabilityUx, {relaySimple:true, pwmAdvanced:true});
    results.push('igniter modes follow the selected output driver capability');

    const sensorInterfaceUx = await page.evaluate(() => {
      const base = {role:'temperature', driver:1, pin:4, min:0, max:4095};
      const intake = {...base, purpose:'intake_temperature', temp_interface:5, temp_resolution:12};
      const oilNtc = {...base, purpose:'oil_temperature', temp_interface:4, ntc_beta:3950, ntc_r0:10000, ntc_r_fixed:10000};
      const tot = {...base, purpose:'tot', temp_interface:2, spi_clk:12, spi_cs:13, spi_miso:14};
      const torque = {role:'torque', purpose:'torque', driver:1, pin:5, torque_interface:1, hx711_clk:6, hx711_scale:1, hx711_zero:0};
      const mv = registryRangeMeta('input', 1, 'temperature');
      return {
        intakeSummary: registrySignalSummary(intake),
        intakeEditor: registryTemperatureInterfaceEditor(intake, 0),
        intakeRange: registryRangeEditor('input', intake, 0),
        oilNtcRange: registryRangeEditor('input', oilNtc, 0),
        totSummary: registrySignalSummary(tot),
        totEditor: registryTemperatureInterfaceEditor(tot, 0),
        totSignalEditor: registrySignalTypeEditor('input', tot, 0, ''),
        torqueEditor: registryTorqueInterfaceEditor('input', torque, 0),
        torqueSignalEditor: registrySignalTypeEditor('input', torque, 0, ''),
         torquePins: registryPinSummary(torque),
         digitalRangeProblem: registryRangeProblem({...intake, min:4095, max:0}),
         unsafeTotInterface: registryStatus({...base, id:'unsafe_tot_probe', name:'Probe', purpose:'tot', temp_interface:5, temp_resolution:12}).text,
         mv
      };
    });
    assert.equal(sensorInterfaceUx.intakeSummary, 'DS18B20 OneWire');
    assert.match(sensorInterfaceUx.intakeEditor, /NTC thermistor/);
    assert.match(sensorInterfaceUx.intakeEditor, /DS18B20/);
    assert.doesNotMatch(sensorInterfaceUx.intakeEditor, /MAX31855/);
    assert.equal(sensorInterfaceUx.intakeRange, '');
    assert.equal(sensorInterfaceUx.oilNtcRange, '');
    assert.equal(sensorInterfaceUx.totSummary, 'MAX31855 thermocouple');
    assert.match(sensorInterfaceUx.totEditor, /MAX6675/);
    assert.match(sensorInterfaceUx.totEditor, /MAX31856/);
    assert.doesNotMatch(sensorInterfaceUx.totEditor, /DS18B20/);
    assert.match(sensorInterfaceUx.totSignalEditor, /TLA2528 (?:analog|ADC)/);
    assert.match(sensorInterfaceUx.totEditor, /Sensor interface/);
    assert.match(sensorInterfaceUx.torqueEditor, /HX711 SCK GPIO/);
    assert.match(sensorInterfaceUx.torqueEditor, /Sensor interface/);
    assert.match(sensorInterfaceUx.torqueSignalEditor, /NAU7802 load cell/);
    assert.match(sensorInterfaceUx.torquePins, /DOUT GPIO5 \/ SCK GPIO6/);
    assert.equal(sensorInterfaceUx.digitalRangeProblem, '');
    assert.match(sensorInterfaceUx.unsafeTotInterface, /only for oil, coolant, intake or ambient/i);
    assert.equal(sensorInterfaceUx.mv.min, 'Minimum valid signal (mV)');
    assert.equal(sensorInterfaceUx.mv.max, 'Maximum valid signal (mV)');
    assert.ok(Math.abs(sensorInterfaceUx.mv.scale - 3300/4095) < 0.000001);
    results.push('temperature and torque cards expose native, SPI, and shared-I2C interfaces with their wiring and ranges');

    await patchHardware(page, { platform: 'esp32s3', cluster_serial: { enabled: true, tx_pin: 1, rx_pin: -1 } });
    await goto(page, 'hardware.html', '#hardware-profile-section');
    const s3Pins = await page.evaluate(() => ({
      output22: buildPinOptions(22, 'out').includes('value="22"'),
      adc1: buildPinOptions(1, 'adc').includes('value="1"')
    }));
    assert.deepEqual(s3Pins, { output22:false, adc1:true });
    results.push('hardware GPIO choices switch by ESP32 target');

    const dependencyTips = await page.evaluate(() => ({
      n1: unlockTooltip('sensor', 'n1_rpm', false),
      cluster: unlockTooltip('feature', 'cluster', false),
      glowCurrent: unlockTooltip('feature', 'glow_current', false)
    }));
    const n1UnlockTip = dependencyTips.n1;
    assert.match(n1UnlockTip || '', /automatic idle/i);
    assert.match(n1UnlockTip || '', /windmilling oil/i);
    assert.match(n1UnlockTip || '', /overspeed/i);
    assert.match(dependencyTips.cluster, /external display/i);
    assert.match(dependencyTips.glowCurrent, /wait-until-hot/i);
    results.push('hardware enable checkboxes explain what currently disabled hardware unlocks');

    await reset(page);
    await patchHardware(page, {
      channel_registry: {version:1, inputs:[], outputs:[], bindings:[]},
      sensors: { oil_press: { enabled: false }, tot: { enabled: false }, flame: { enabled: false }, n1_rpm: { enabled: false }, tit: { enabled: false }, oil_temp: { enabled: false }, fuel_press: { enabled: false }, batt_voltage: { enabled: false } },
      actuators: { oil_pump: { enabled: false }, throttle: { enabled: false }, starter: { enabled: false }, glow_plug: { enabled: false }, ab_pump: { enabled: false }, igniter2: { enabled: false }, oil_scavenge_pump: { enabled: false } },
      controllers: { governor: false },
      has_afterburner: true,
      has_two_shaft: false,
      cluster_serial: { enabled: false },
      ab_flame: { enabled: false },
      ab_trigger: { input_pin: -1 }
    });
    await patchData(page, { mode:'STANDBY', config_locked:false });
    await goto(page, 'controllers.html', '#cf-oil_rm');
    const configGhosts = {
      oilSp: await shown(page, '#cf-oil_rm'),
      oilMm: await shown(page, '#cf-oil_mm'),
      oilSpDisabled: await disabled(page, '#cf-oil_rm'),
      oilMmPresent: await page.locator('#cf-oil_mm').count(),
      standby: await page.evaluate(() => Array.from(document.querySelectorAll('.cfg-section')).find(sec => sec.querySelector('.cfg-title')?.textContent.trim() === 'Windmilling Oil Protection')?.style.display !== 'none'),
      flameSection: await shown(page, '#flame-detect-section'),
      dynamicIdlePresent: await page.locator('#cf-di_tr').count(),
      relightPresent: await page.locator('#cf-rl_en').count(),
      abIgnPresent: await page.locator('#cf-ab_ui').count(),
      abTorchPresent: await page.locator('#cf-ab_ut').count(),
      abTotPresent: await page.locator('#cf-ab_mt').count(),
      abPumpModePresent: await page.locator('#cf-ab_pcm').count()
    };
    assert.deepEqual(configGhosts, {
      oilSp: false, oilMm: false, oilSpDisabled: true, oilMmPresent: 0,
      standby: true, flameSection: false, dynamicIdlePresent: 0,
      relightPresent: 0, abIgnPresent: 0, abTorchPresent: 0,
      abTotPresent: 0, abPumpModePresent: 0
    });
    await page.evaluate(() => setWorkspaceFilter('explore'));
    const futureFields = await page.evaluate(() => ({
      oilSpShown: !!document.querySelector('#cf-oil_rm')?.offsetParent,
      oilSpEditable: !document.querySelector('#cf-oil_rm')?.disabled,
      oilSpInactive: document.querySelector('#cf-oil_rm')?.closest('.cfg-field')?.classList.contains('cfg-field-inactive'),
      amberNote: document.querySelector('#cf-oil_rm')?.closest('.cfg-field')?.querySelector('.cfg-inactive-note')?.textContent || ''
    }));
    assert.deepEqual(futureFields, {
      oilSpShown: true, oilSpEditable: true, oilSpInactive: true,
      amberNote: 'Saved for future use; inactive now. Oil pressure sensor is not configured in Hardware. Enable an oil pressure sensor to unlock closed-loop oil pressure settings.'
    });
    const futureChange = await page.evaluate(() => {
      const el = document.querySelector('#cf-oil_rm');
      el.value = '2.7';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return _buildChanges().find(change => change.label.includes('Running Low-Pressure Shutdown'));
    });
    assert.equal(futureChange?.inactive, true, 'save recap must identify future-hardware edits as inactive');
    assert.match(futureChange?.inactiveReason || '', /oil pressure sensor is not configured/i);
    assert.equal(await page.locator('#cf-oil_tm, #cf-oil_mx').count(), 0,
      'Explore must not recreate oil-controller parameters without an owning oil output');
    await page.evaluate(() => setWorkspaceFilter('configured'));
    assert.equal(await disabled(page, '#cf-oil_rm'), true, 'Configured system must protect inactive future values');
    await page.locator('#btn-filter-changed').click();
    assert.equal(await shown(page, '#cf-oil_rm'), true, 'Changed view must show the inactive edited value');
    assert.equal(await disabled(page, '#cf-oil_rm'), false, 'Changed view must allow the inactive edited value to be corrected');
    results.push('Controllers omits parameters with no owning output while clearly marked future safety values remain editable in Explore and Changed');

    await reset(page);
    await patchHardware(page, {
      channel_registry: {version:1, inputs:[{id:'n1_main',name:'N1 Speed',purpose:'n1_speed',role:'speed',driver:2,pin:34,min:0,max:100000,pulses_per_unit:1}], outputs:[], bindings:[{key:'primary_n1',channel:'n1_main'}]},
      sensors: { oil_press: { enabled: false }, tot: { enabled: false }, tit: { enabled: false }, n1_rpm: { enabled: true } },
      cluster_serial: { enabled: true }
    });
    await patchData(page, { mode:'STANDBY', config_locked:false });
    await goto(page, 'system.html', '#cf-cl_n1');
    await page.evaluate(() => setWorkspaceFilter('configured'));
    assert.equal(await page.locator('#cf-cl_en').count(), 0, 'cluster has no redundant Config enable');
    assert.equal(await shown(page, '#cf-cl_tw'), false, 'Configured system should hide cluster EGT warning without an EGT source');
    assert.equal(await disabled(page, '#cf-cl_tw'), true, 'cluster EGT warning must ghost without TOT/TIT');
    assert.equal(await shown(page, '#cf-cl_ow'), false, 'Configured system should hide cluster oil warning without pressure feedback');
    assert.equal(await disabled(page, '#cf-cl_ow'), true, 'cluster oil warning must ghost without oil pressure sensor');
    await page.evaluate(() => setWorkspaceFilter('explore'));
    assert.equal(await shown(page, '#cf-cl_tw'), true);
    assert.equal(await disabled(page, '#cf-cl_tw'), false);
    assert.equal(await shown(page, '#cf-cl_ow'), true);
    assert.equal(await disabled(page, '#cf-cl_ow'), false);
    results.push('config cluster warnings stay relevant normally and allow clearly inactive future tuning in Explore');

    await reset(page);
    await patchHardware(page, {
      channel_registry: {
        version: 1,
        inputs: [
          { id: 'n1_main', name: 'N1 Speed', purpose: 'n1_speed', role: 'speed', driver: 2, pin: 34, min: 0, max: 100000, pulses_per_unit: 1 },
          { id: 'tot_main', name: 'Main TOT', purpose: 'tot', role: 'temperature', driver: 1, pin: -1, min: 0, max: 4095, temp_interface: 2, spi_clk: 18, spi_cs: 5, spi_miso: 19, spi_mosi: -1, tc_type: 'K' }
        ],
        outputs: [
          { id: 'main_fuel', name: 'Main Fuel Pump', purpose: 'main_fuel', role: 'fuel', driver: 6, pin: 21, min: 1000, max: 2000, safe_demand: 0 },
          { id: 'ab_igniter', name: 'AB Igniter', purpose: 'ab_igniter', role: 'ab_igniter', driver: 4, pin: 1, min: 0, max: 1, safe_demand: 0 },
          { id: 'ab_pump', name: 'AB Pump', purpose: 'ab_pump', role: 'ab_pump', driver: 5, pin: 13, min: 0, max: 1, pwm_freq_hz: 5000, pwm_res_bits: 10, safe_demand: 0 }
        ],
        bindings: [
          { key: 'primary_n1', channel: 'n1_main' },
          { key: 'primary_egt', channel: 'tot_main' },
          { key: 'main_fuel_output', channel: 'main_fuel' }
        ]
      },
      sensors: {
        throttle_input: { enabled: false },
        idle_input: { enabled: false },
        n1_rpm: { enabled: true },
        n2_rpm: { enabled: false },
        tot: { enabled: true },
        tit: { enabled: false },
        flame: { enabled: false }
      },
      actuators: {
        igniter2: { enabled: true },
        ab_pump: { enabled: true },
        throttle: { enabled: true }
      },
      cluster_serial: { enabled: true },
      ab_flame: { enabled: false }
    });
    await patchData(page, { mode:'STANDBY', config_locked:false });
    await goto(page, 'controllers.html', '#cf-sf_fs');
    await page.evaluate(() => setWorkspaceFilter('configured'));
    assert.equal(await shown(page, '#rc-pwm-section'), false, 'RC PWM section must stay hidden in Advanced view without servo inputs');
    assert.equal(await shown(page, '#cf-di_n2'), false, 'N2 dynamic-idle field must stay hidden in Advanced view on single-shaft hardware');
    await page.locator('#cf-sf_fs').selectOption('2');
    assert.equal(await shown(page, '#cf-sf_fn'), true, 'N1 flameout threshold should show for N1 flameout source');
    assert.equal(await shown(page, '#cf-sf_eb'), false, 'EGT low threshold should hide for N1 flameout source');
    assert.equal(await shown(page, '#cf-sf_ef'), false, 'EGT fall-rate field should hide for N1 flameout source');
    await page.locator('#cf-sf_fs').selectOption('3');
    assert.equal(await shown(page, '#cf-sf_fn'), false, 'N1 flameout threshold should hide for EGT flameout source');
    assert.equal(await shown(page, '#cf-sf_eb'), true, 'EGT low threshold should show for EGT flameout source');
    assert.equal(await shown(page, '#cf-sf_ef'), true, 'EGT fall-rate field should show for EGT flameout source');
    await revealField(page, '#cf-ab_ut');
    await page.locator('#cf-ab_ut').uncheck();
    await revealField(page, '#cf-ab_fm');
    await page.locator('#cf-ab_fm').selectOption('2');
    for (const selector of ['#cf-ab_tpct', '#cf-ab_tms', '#cf-ab_ttl', '#cf-ab_tr', '#cf-ab_tw']) {
      assert.equal(await shown(page, selector), false, `${selector} should stay hidden when torch is off and AB confirmation is timed`);
    }
    assert.equal(await shown(page, '#cf-ab_ams'), true, 'timed AB confirmation delay should show in timed mode');
    await page.locator('#cf-ab_fm').selectOption('1');
    assert.equal(await shown(page, '#cf-ab_tr'), true, 'EGT rise threshold should show in EGT AB confirmation mode');
    assert.equal(await shown(page, '#cf-ab_tw'), true, 'EGT rise window should show in EGT AB confirmation mode');
    assert.equal(await shown(page, '#cf-ab_ams'), false, 'timed AB confirmation delay should hide in EGT AB confirmation mode');
    results.push('config field-level conditional visibility survives Advanced view for RC, N2, flameout, and AB method controls');

    await reset(page);
    await patchHardware(page, {
      channel_registry: {
        version: 1,
        inputs: [{ id: 'n2_main', name: 'N2 Speed', purpose: 'n2_speed', role: 'speed', driver: 2, pin: 35, min: 0, max: 100000, pulses_per_unit: 1 }],
        outputs: [{ id: 'oil_pump', name: 'Oil Pump', purpose: 'oil_pump', role: 'oil_pump', driver: 5, pin: 23, min: 0, max: 1, safe_demand: 0 }],
        bindings: [{ key: 'primary_n2', channel: 'n2_main' }]
      },
      sensors: { n1_rpm: { enabled: false }, n2_rpm: { enabled: true } },
      actuators: { oil_pump: { enabled: true } }
    });
    await patchData(page, { mode:'STANDBY', config_locked:false });
    await goto(page, 'controllers.html', '#cf-so_src');
    assert.equal(await disabled(page, '#cf-so_src'), false);
    assert.equal(await optionDisabled(page, '#cf-so_src', '0'), true);
    assert.equal(await optionDisabled(page, '#cf-so_src', '1'), false);
    assert.equal(await optionDisabled(page, '#cf-so_src', '2'), false);
    await patchHardware(page, {
      channel_registry: {
        version: 1,
        inputs: [],
        outputs: [{ id: 'oil_pump', name: 'Oil Pump', purpose: 'oil_pump', role: 'oil_pump', driver: 5, pin: 23, min: 0, max: 1, safe_demand: 0 }],
        bindings: []
      },
      sensors: { n1_rpm: { enabled: false }, n2_rpm: { enabled: false } },
      actuators: { oil_pump: { enabled: true } }
    });
    await goto(page, 'controllers.html', '#cf-so_src');
    assert.equal(await disabled(page, '#cf-so_src'), true);
    assert.equal(await disabled(page, '#cf-so_rl'), true);
    assert.equal(await disabled(page, '#cf-so_fp'), true);
    assert.equal(await disabled(page, '#cf-pb_min'), null);
    assert.equal(await disabled(page, '#cf-pb_n1m'), true);
    assert.equal(await disabled(page, '#cf-pb_n2m'), true);
    results.push('standby oil feed requires oil pump plus a fitted N1 or N2 source and ghosts invalid shaft options');

    await reset(page);
    await patchHardware(page, {
      channel_registry: {
        version: 1,
        inputs: [
          { id: 'n1_main', name: 'N1 Speed', purpose: 'n1_speed', role: 'speed', driver: 2, pin: 34, min: 0, max: 100000, pulses_per_unit: 1 },
          { id: 'tit_main', name: 'Main TIT', purpose: 'tit', role: 'temperature', driver: 1, pin: -1, min: 0, max: 4095, temp_interface: 2, spi_clk: 18, spi_cs: 17, spi_miso: 19, spi_mosi: -1, tc_type: 'K' }
        ],
        outputs: [],
        bindings: [{ key: 'primary_n1', channel: 'n1_main' }, { key: 'primary_egt', channel: 'tit_main' }]
      },
      sensors: {
        tot: { enabled: false },
        tit: { enabled: true },
        flame: { enabled: false },
        n1_rpm: { enabled: true }
      },
      actuators: {
        throttle: { enabled: false },
        ab_pump: { enabled: false },
        igniter2: { enabled: false }
      },
      ab_flame: { enabled: false },
      ab_trigger: { input_pin: -1 }
    });
    await patchData(page, { mode:'STANDBY', config_locked:false });
    await goto(page, 'controllers.html', '#cf-eg_src');
    assert.equal(await optionDisabled(page, '#cf-eg_src', '1'), true);
    assert.equal(await optionDisabled(page, '#cf-eg_src', '2'), false);
    assert.equal(await disabled(page, '#cf-tot_limit'), true);
    assert.equal(await disabled(page, '#cf-sf_tit'), false);
    assert.equal(await disabled(page, '#cf-th_mx'), null,
      'throttle shaping must not exist without an owning fuel output');
    assert.equal(await disabled(page, '#cf-ab_ui'), null);
    assert.equal(await disabled(page, '#cf-ab_ut'), null);
    assert.equal(await disabled(page, '#cf-ab_pcm'), null);
    assert.equal(await optionDisabled(page, '#cf-ab_fm', '0'), null);
    assert.equal(await optionDisabled(page, '#cf-ab_fm', '1'), null);

    await patchHardware(page, {
      channel_registry: {
        version: 1,
        inputs: [
          { id: 'n1_main', name: 'N1 Speed', purpose: 'n1_speed', role: 'speed', driver: 2, pin: 34, min: 0, max: 100000, pulses_per_unit: 1 },
          { id: 'flame_main', name: 'Flame', purpose: 'flame', role: 'flame', driver: 1, pin: 33, min: 0, max: 4095 }
        ],
        outputs: [],
        bindings: [{ key: 'primary_n1', channel: 'n1_main' }]
      },
      sensors: {
        tot: { enabled: false },
        tit: { enabled: false },
        flame: { enabled: true },
        n1_rpm: { enabled: true }
      }
    });
    await goto(page, 'controllers.html', '#cf-eg_src');
    assert.equal(await disabled(page, '#cf-eg_src'), true);
    assert.equal(await disabled(page, '#cf-sf_hs'), true);
    assert.equal(await disabled(page, '#cf-sf_fo'), false);
    assert.equal(await optionDisabled(page, '#cf-sf_fs', '1'), false);
    assert.equal(await optionDisabled(page, '#cf-sf_fs', '2'), false);
    assert.equal(await optionDisabled(page, '#cf-sf_fs', '3'), true);

    await patchHardware(page, { has_afterburner: false });
    await goto(page, 'controllers.html', '#cf-eg_src');
    for (const selector of ['#ab-ign-section', '#ab-flame-section', '#ab-run-section']) {
      assert.equal(await shown(page, selector), false, `${selector} should hide when afterburner is not fitted`);
    }
    results.push('config page ghosts or hides dependent fields across TIT-only, no-EGT, no-throttle, and afterburner-off combinations');

    await reset(page);
    await goto(page, 'controllers.html', '#cf-tot_limit');
    const firstTotLimit = await value(page, '#cf-tot_limit');
    const firstFallRate = await value(page, '#cf-sf_ef');
    assert.ok(['720', '1328'].includes(firstTotLimit), `unexpected displayed TOT limit ${firstTotLimit}`);
    assert.equal(firstFallRate, '50');
    await page.locator('#unit-temp-btn').click();
    const secondTotLimit = await value(page, '#cf-tot_limit');
    const secondFallRate = await value(page, '#cf-sf_ef');
    assert.ok(['720', '1328'].includes(secondTotLimit), `unexpected toggled TOT limit ${secondTotLimit}`);
    assert.notEqual(secondTotLimit, firstTotLimit);
    assert.equal(secondFallRate, '90');
    assert.equal(await page.locator('#cf-tot_limit').getAttribute('min'), '0');
    await page.locator('#unit-temp-btn').click();
    assert.equal(await value(page, '#cf-tot_limit'), firstTotLimit);
    assert.equal(await value(page, '#cf-sf_ef'), firstFallRate);
    await page.locator('#unit-press-btn').click();
    const firstOilMin = await value(page, '#cf-oil_rm');
    assert.ok(['1.2', '17.405'].includes(firstOilMin), `unexpected displayed oil min ${firstOilMin}`);
    await page.locator('#unit-press-btn').click();
    const secondOilMin = await value(page, '#cf-oil_rm');
    assert.ok(['1.2', '17.405'].includes(secondOilMin), `unexpected toggled oil min ${secondOilMin}`);
    assert.notEqual(secondOilMin, firstOilMin);
    results.push('config temperature and pressure toggles preserve canonical meaning and displayed precision');

    await reset(page);
    await patchHardware(page, {
      channel_registry: {
        version: 1,
        inputs: [
          { id: 'n1_main', name: 'N1 Speed', purpose: 'n1_speed', role: 'speed', driver: 2, pin: 34, min: 0, max: 100000, pulses_per_unit: 1 },
          { id: 'tot_main', name: 'Main TOT', purpose: 'tot', role: 'temperature', driver: 1, pin: -1, min: 0, max: 4095, temp_interface: 2, spi_clk: 18, spi_cs: 5, spi_miso: 19, spi_mosi: -1, tc_type: 'K' },
          { id: 'tit_main', name: 'Main TIT', purpose: 'tit', role: 'temperature', driver: 1, pin: -1, min: 0, max: 4095, temp_interface: 2, spi_clk: 18, spi_cs: 17, spi_miso: 19, spi_mosi: -1, tc_type: 'K' },
          { id: 'oil_pressure_main', name: 'Oil Pressure', purpose: 'oil_pressure', role: 'pressure', driver: 1, pin: 32, min: 0, max: 4095 }
        ],
        outputs: [],
        bindings: [{ key: 'primary_n1', channel: 'n1_main' }, { key: 'primary_egt', channel: 'tot_main' }]
      },
      sensors: {
        n1_rpm: { enabled: true },
        tot: { enabled: true },
        tit: { enabled: true },
        oil_press: { enabled: true }
      }
    });
    await patchData(page, {
      has_n1: true,
      has_tot: true,
      has_tit: true,
      has_oil_press: true,
      n1: 12000,
      tot: 500,
      tit: 505,
      oil: 1.2
    });
    await goto(page, 'controllers.html', '#cf-rpm_limit');
    await page.waitForSelector('#live-rpm_limit', { state: 'attached' });
    await page.evaluate(() => {
      window.applyData({
        n1: 45678,
        tot: 612.3,
        tit: 620.1,
        oil: 2.34
      });
    });
    assert.match(await page.locator('#live-rpm_limit').textContent(), /45,678|45678/);
    assert.match(await page.locator('#live-tot_limit').textContent(), /612\.3/);
    assert.match(await page.locator('#live-sf_tit').textContent(), /620\.1/);
    assert.match(await page.locator('#live-oil_rm').textContent(), /2\.34/);
    results.push('config live badges keep updating from fast frames without repeated has_* flags');

    await reset(page);
    await patchHardware(page, {
      channel_registry: { version: 1, inputs: [], outputs: [], bindings: [] },
      sensors: {
        oil_press: { enabled: false },
        flame: { enabled: false },
        p1: { enabled: false },
        p2: { enabled: false },
        oil_temp: { enabled: false },
        batt_voltage: { enabled: false },
        torque: { enabled: false },
        fuel_press: { enabled: false },
        fuel_flow: { enabled: false },
        throttle_input: { enabled: false },
        idle_input: { enabled: false }
      },
      has_afterburner: false,
      actuators: {
        glow_plug: { enabled: false, has_current: false },
        igniter: { enabled: false, has_current: false },
        igniter2: { enabled: false, has_current: false },
        oil_pump: { enabled: false, has_current: false }
      },
      ab_flame: { enabled: false }
    });
    await patchData(page, {
      has_oil_press: false, has_flame: false, has_p1: false, has_p2: false, has_oil_temp: false,
      has_batt_voltage: false, has_torque: false, has_fuel_press: false, has_fuel_flow: false,
      has_glow_current: false, has_igniter_current: false, has_igniter2_current: false,
      has_oil_pump_current: false, has_ab_flame: false, throttle_input_type: 'none', idle_input_type: 'none'
    });
    await goto(page, 'calibration.html', '#oil-press-cal-row');
    await page.waitForFunction(() => document.querySelector('#throttle-cal-row')?.style.display === 'none');
    for (const selector of [
      '#oil-press-cal-row', '#flame-cal-row', '#p1-cal-row', '#p2-cal-row', '#oiltemp-cal-row',
      '#battvolt-cal-row', '#torque-cal-row', '#fuelpress-cal-row', '#fuelflow-cal-row',
      '#glow-current-cal-row', '#igniter-current-cal-row', '#igniter2-current-cal-row',
      '#oilpump-current-cal-row', '#throttle-cal-row', '#idle-cal-row', '#ab-flame-cal-row'
    ]) {
      assert.equal(await shown(page, selector), false, `${selector} should hide`);
    }
    await reset(page);
    await patchData(page, {
      has_fuel_flow: true, fuel_flow_type: 0, has_glow_current: true, has_igniter_current: true,
      has_igniter2_current: true, has_oil_pump_current: true, throttle_input_type: 'servo',
      throttle_input_us: 1500, idle_input_type: 'adc', idle_input_raw: 1234,
      has_ab_flame: true, ab_flame_raw: 760, ab_flame_threshold: 1234, ab_flame_on: false
    });
    await patchHardware(page, {
      has_afterburner: true,
      sensors: {
        oil_press: { enabled: true },
        flame: { enabled: true },
        fuel_flow: { enabled: true, type: 0 },
        p1: { enabled: true },
        p2: { enabled: true },
        fuel_press: { enabled: true },
        oil_temp: { enabled: true },
        batt_voltage: { enabled: true },
        torque: { enabled: true },
        throttle_input: { enabled: true, rc_pwm: true },
        idle_input: { enabled: true, rc_pwm: false }
      },
      actuators: {
        glow_plug: { enabled: true, has_current: true },
        igniter: { enabled: true, has_current: true },
        igniter2: { enabled: true, has_current: true },
        oil_pump: { enabled: true, has_current: true }
      },
      ab_flame: { enabled: true, threshold: 1234 }
    });
    await page.reload();
    await page.waitForSelector('#oil-press-cal-row', { state: 'attached' });
    await page.waitForFunction(() => /us|µs/.test(document.querySelector('#cal-th-raw')?.textContent || ''), null, { timeout: 5000 });
    assert.equal(await shown(page, '#fuelflow-cal-row'), true);
    assert.equal(await shown(page, '#glow-current-cal-row'), true);
    assert.equal(await shown(page, '#igniter-current-cal-row'), true);
    assert.equal(await shown(page, '#igniter2-current-cal-row'), true);
    assert.equal(await shown(page, '#oilpump-current-cal-row'), true);
    assert.equal(await shown(page, '#ab-flame-cal-row'), true);
    assert.match(await page.locator('#cal-th-raw').textContent(), /us|µs/);
    assert.match(await page.locator('#idle-raw-label').textContent(), /raw/i);
    await page.evaluate(() => {
      live = {};
      window.applyData({
        fuel_flow_type: 0,
        fuel_flow_raw: 1200,
        fuel_flow: 4.2,
        glow_current_raw: 1300,
        glow_current_amps: 6.1,
        igniter_current_raw: 1400,
        igniter_current_amps: 2.2,
        igniter2_current_raw: 1500,
        igniter2_current_amps: 2.4,
        oil_pump_current_raw: 1600,
        oil_pump_current_amps: 3.3,
        oil_pump_overcurrent: false,
        ab_flame_raw: 760,
        ab_flame_threshold: 1234,
        ab_flame_on: false,
        p1_raw: 810,
        p1: 1.23,
        p2_raw: 910,
        p2: 2.34,
        oil_raw: 1110,
        oil: 1.11,
        flame_raw: 1210,
        flame: true,
        fuel_press_raw: 1010,
        fuel_press: 3.45,
        oil_temp: 77.7,
        batt_voltage: 12.3,
        batt_voltage_raw: 2010,
        torque: 8.9,
        torque_raw: 2110
      });
    });
    for (const selector of [
      '#oil-press-cal-row', '#flame-cal-row', '#p1-cal-row', '#p2-cal-row',
      '#oiltemp-cal-row', '#battvolt-cal-row', '#torque-cal-row', '#fuelpress-cal-row',
      '#fuelflow-cal-row', '#glow-current-cal-row', '#igniter-current-cal-row',
      '#igniter2-current-cal-row', '#oilpump-current-cal-row', '#ab-flame-cal-row'
    ]) {
      assert.equal(await shown(page, selector), true, `${selector} should stay visible on fast frames without has_* flags`);
    }
    assert.match(await page.locator('#cal-ff').textContent(), /4\.200/);
    assert.match(await page.locator('#cal-p1').textContent(), /1\.230/);
    assert.match(await page.locator('#cal-fuelpress').textContent(), /3\.45/);
    results.push('calibration rows and raw-unit labels track fitted sensors and input source types');

    await reset(page);
    await patchHardware(page, {
      has_afterburner: true,
      sensors: {
        oil_press: { enabled: true },
        flame: { enabled: true },
        p1: { enabled: true },
        p2: { enabled: true },
        fuel_press: { enabled: true },
        fuel_flow: { enabled: true, type: 0 },
        oil_temp: { enabled: true, chip: 'ntc' },
        batt_voltage: { enabled: true },
        torque: { enabled: true, hx711: false },
        throttle_input: { enabled: true, rc_pwm: false },
        idle_input: { enabled: true, rc_pwm: true }
      },
      actuators: {
        glow_plug: { enabled: true, has_current: true },
        igniter: { enabled: true, has_current: true },
        igniter2: { enabled: true, has_current: true },
        oil_pump: { enabled: true, has_current: true }
      },
      ab_flame: { enabled: true, threshold: 1800 }
    });
    await goto(page, 'calibration.html', '#oil-press-cal-row');
    for (const selector of [
      '#oil-press-cal-row', '#flame-cal-row', '#p1-cal-row', '#p2-cal-row', '#fuelpress-cal-row',
      '#fuelflow-cal-row', '#oiltemp-cal-row', '#battvolt-cal-row', '#torque-cal-row',
      '#throttle-cal-row', '#idle-cal-row', '#glow-current-cal-row', '#igniter-current-cal-row',
      '#igniter2-current-cal-row', '#oilpump-current-cal-row', '#ab-flame-cal-row'
    ]) {
      assert.equal(await shown(page, selector), true, `${selector} should show when its hardware is fitted`);
    }
    assert.equal(await shown(page, '#oiltemp-ntc-wizard'), true);
    assert.equal(await shown(page, '#oiltemp-fixed-note'), false);
    assert.equal(await shown(page, '#torque-adc-wizard'), true);
    assert.equal(await shown(page, '#torque-hx711-wizard'), false);

    const calibrationHw = await (await page.request.get(`${base}/api/hardware`)).json();
    const calibrationInputs = calibrationHw.channel_registry.inputs.map(channel => {
      if (channel.purpose === 'fuel_flow') return { ...channel, driver: 2, pulses_per_unit: 450, min: 0, max: 100 };
      if (channel.purpose === 'oil_temperature') return { ...channel, pin: -1, temp_interface: 2, spi_clk: 18, spi_cs: 17, spi_miso: 19, spi_mosi: -1 };
      if (channel.purpose === 'torque') return { ...channel, pin: 33, driver: 1, torque_interface: 1, hx711_clk: 26, hx711_scale: 0.0001, hx711_zero: 0, min: 0, max: 4095 };
      return channel;
    });
    const calibrationOutputs = calibrationHw.channel_registry.outputs.filter(channel =>
      !['glow_plug', 'igniter', 'ab_igniter', 'oil_pump'].includes(channel.purpose));
    await patchHardware(page, {
      channel_registry: { ...calibrationHw.channel_registry, inputs: calibrationInputs, outputs: calibrationOutputs },
      has_afterburner: false,
      sensors: {
        fuel_flow: { enabled: true, type: 1 },
        oil_temp: { enabled: true, chip: 'max31855' },
        torque: { enabled: true, hx711: true }
      },
      actuators: {
        glow_plug: { enabled: false, has_current: true },
        igniter: { enabled: false, has_current: true },
        igniter2: { enabled: false, has_current: true },
        oil_pump: { enabled: false, has_current: true }
      },
      ab_flame: { enabled: true }
    });
    await goto(page, 'calibration.html', '#oil-press-cal-row');
    assert.equal(await shown(page, '#fuelflow-cal-row'), false, 'pulse fuel flow is configured by pulses-per-litre, not analog calibration');
    assert.equal(await shown(page, '#oiltemp-cal-row'), true, 'non-NTC oil temp still shows the calibration/config note');
    assert.equal(await shown(page, '#oiltemp-ntc-wizard'), false);
    assert.equal(await shown(page, '#oiltemp-fixed-note'), true);
    assert.equal(await shown(page, '#torque-adc-wizard'), false);
    assert.equal(await shown(page, '#torque-hx711-wizard'), true);
    for (const selector of ['#glow-current-cal-row', '#igniter-current-cal-row', '#igniter2-current-cal-row', '#oilpump-current-cal-row']) {
      assert.equal(await shown(page, selector), false, `${selector} should require its parent hardware feature`);
    }
    assert.equal(await shown(page, '#ab-flame-cal-row'), true, 'a fitted AB flame sensor must not be hidden by a legacy master field');
    results.push('calibration page has correct show/hide semantics for every fitted analog, temperature, flow, AB flame, and current sensor');

    await reset(page);
    await goto(page, 'sequence.html', '#add-startup-sel');
    const sequenceFull = await page.evaluate(() => ({
      startup: Array.from(document.querySelectorAll('#add-startup-sel option:not([disabled])')).map(o => o.value).filter(Boolean),
      shutdown: Array.from(document.querySelectorAll('#add-shutdown-sel option:not([disabled])')).map(o => o.value).filter(Boolean),
      afterburner: Array.from(document.querySelectorAll('#add-afterburner-sel option:not([disabled])')).map(o => o.value).filter(Boolean),
      sensors: getEnabledSensors().map(s => s.key),
      actuators: getEnabledActuators().map(a => a.key)
    }));
    for (const key of ['FuelPulse', 'PreHeat', 'ThrottleSet', 'WaitForInput', 'OilScavengeOn', 'AirstarterOn', 'CoolFanOn', 'BleedOpen', 'GlowPreheat', 'FuelPumpRamp', 'FuelPump2Set', 'GovernorHold']) {
      assert.ok(sequenceFull.startup.includes(key), `full startup should include ${key}`);
    }
    for (const key of ['ABSolOpen', 'ABPumpOn', 'ABIgnOn', 'ABFlameConfirm', 'ABStabilize']) {
      assert.ok(sequenceFull.afterburner.includes(key), `full AB should include ${key}`);
    }
    const sequenceHw = await (await page.request.get(`${base}/api/hardware`)).json();
    await patchHardware(page, {
      channel_registry: {
        ...sequenceHw.channel_registry,
        inputs: sequenceHw.channel_registry.inputs.filter(channel =>
          !['oil_temperature', 'fuel_pressure', 'battery_voltage', 'fuel_flow', 'torque', 'throttle', 'idle'].includes(channel.purpose)),
        outputs: sequenceHw.channel_registry.outputs.filter(channel =>
          !['fuel_shutoff', 'igniter', 'prop_pitch', 'scavenge_pump', 'fuel_pump', 'cooling_fan', 'air_starter', 'glow_plug'].includes(channel.purpose) && channel.id !== 'bleed_valve')
      },
      sensors: { n2_rpm: { enabled: true }, tit: { enabled: false } },
      actuators: {
        ab_sol: { enabled: true }, ab_pump: { enabled: true }, igniter2: { enabled: true },
        igniter: { enabled: false }, prop_pitch: { enabled: false }, oil_scavenge_pump: { enabled: false }, fuel_sol: { enabled: false },
        glow_plug: { enabled: false }, fuel_pump2: { enabled: false }, bleed_valve: { enabled: false },
        cool_fan: { enabled: false }, airstarter_sol: { enabled: false }
      },
      di_channels: [{ pin: -1 }, { pin: -1 }, { pin: -1 }, { pin: -1 }],
      ab_trigger: { input_pin: -1 }
    });
    await page.reload();
    await page.waitForSelector('#add-startup-sel');
    const sequenceHidden = await page.evaluate(() => ({
      startup: Array.from(document.querySelectorAll('#add-startup-sel option')).map(o => ({ value: o.value, disabled: o.disabled })).filter(o => o.value),
      afterburnerCount: document.querySelectorAll('#add-afterburner-sel option[value="ABPumpOn"],#add-afterburner-sel option[value="ABSolOpen"],#add-afterburner-sel option[value="ABIgnOn"]').length,
      sensors: getEnabledSensors().map(s => s.key),
      actuators: getEnabledActuators().map(a => a.key)
    }));
    assert.ok(sequenceHidden.startup.some(o => o.value === 'PreHeat' && !o.disabled), 'PreHeat should remain available when Igniter 2 is fitted');
    for (const absent of ['FuelPulse', 'WaitForInput', 'OilScavengeOn', 'AirstarterOn', 'CoolFanOn', 'BleedOpen', 'GlowPreheat', 'FuelPumpRamp', 'FuelPump2Set']) {
      const opt = sequenceHidden.startup.find(o => o.value === absent);
      assert.ok(!opt || opt.disabled, `${absent} should be absent/disabled`);
    }
    assert.ok(sequenceHidden.startup.some(o => o.value === 'GovernorHold' && !o.disabled));
    assert.equal(sequenceHidden.afterburnerCount, 3);
    assert.equal(sequenceHidden.sensors.includes('n2_rpm'), true);
    assert.equal(sequenceHidden.actuators.some(a => a.startsWith('ab_')), true);
    results.push('sequence editor derives N2 and afterburner options from fitted devices, not obsolete master fields');

    await reset(page);
    await patchHardware(page, {
      has_afterburner: false,
      has_two_shaft: false,
      sensors: { n2_rpm: { enabled: false }, tit: { enabled: false }, batt_voltage: { enabled: false }, fuel_flow: { enabled: false }, fuel_press: { enabled: false } },
      actuators: { prop_pitch: { enabled: false }, fuel_pump2: { enabled: false }, glow_plug: { enabled: false } }
    });
    await goto(page, 'log.html', '#tab-session');
    await page.locator('#tab-session').click();
    await page.waitForFunction(() =>
      document.querySelector('input[data-bit="n2"]')?.disabled === true &&
      document.querySelector('input[data-bit="ab"]')?.disabled === false);
    for (const bit of ['n2', 'tit', 'batt', 'fuel_press', 'fuel_flow', 'glow', 'fp2', 'prop']) {
      assert.equal(await disabled(page, `input[data-bit="${bit}"]`), true, `${bit} session log should be disabled`);
      assert.equal(await checked(page, `input[data-bit="${bit}"]`), false, `${bit} session log should be unchecked`);
    }
    assert.equal(await disabled(page, 'input[data-bit="ab"]'), false, 'AB logging follows fitted AB hardware, not the obsolete master field');
    results.push('log session channels are ghosted and unchecked for absent fitted hardware');

    await reset(page);
    await patchHardware(page, {
      has_afterburner: false,
      controllers: { dynamic_idle: false },
      sensors: { n1_rpm: { enabled: false }, n2_rpm: { enabled: true } },
      actuators: {
        fuel_sol: { enabled: false }, oil_pump: { enabled: false }, igniter: { enabled: false },
        igniter2: { enabled: true }, starter: { enabled: false }, starter_en: { enabled: false },
        oil_scavenge_pump: { enabled: false }, cool_fan: { enabled: false }, airstarter_sol: { enabled: false },
        bleed_valve: { enabled: false }, glow_plug: { enabled: false }, fuel_pump2: { enabled: false },
        ab_sol: { enabled: true }, ab_pump: { enabled: true }, prop_pitch: { enabled: false }, throttle: { enabled: false }
      }
    });
    await goto(page, 'tools.html', '#tool-area');
    for (const id of ['FUEL_PRIME', 'OIL_PRIME', 'IGN_TEST', 'START_TEST', 'FUEL_SOL_TEST', 'IDLE_TEST', 'STARTER_EN_TEST', 'OIL_SCAV_TEST', 'COOL_FAN_TEST', 'AIRSTARTER_TEST', 'BLEED_VALVE_TEST', 'GLOW_TEST', 'FUEL_PUMP2_TEST', 'PROP_PITCH_TEST', 'TOGGLE_DYNAMIC_IDLE', 'TOGGLE_LIMP_MODE']) {
      assert.equal(await page.locator(`#card-${id}`).count(), 0, `${id} tool should hide`);
    }
    assert.equal(await page.locator('#card-IGN2_TEST').count(), 1);
    assert.equal(await page.locator('#card-AB_SOL_TEST').count(), 1);
    assert.equal(await page.locator('#card-AB_PUMP_TEST').count(), 1);
    assert.match(await page.locator('#card-AB_SOL_TEST').textContent(), /AB Fuel Valve Test.*fuel valve/is);
    assert.match(await page.locator('#card-AB_PUMP_TEST').textContent(), /AB Fuel Pump Test.*fuel pump/is);
    results.push('tools page hides every actuator test/toggle whose prerequisites are not fitted');

    console.log(`UI beta dependency audit passed (${results.length} groups):`);
    results.forEach(result => console.log(`- ${result}`));
  } finally {
    await browser.close();
  }
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
