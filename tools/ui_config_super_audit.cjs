const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const port = 9850 + Math.floor(Math.random() * 100);
const base = `http://127.0.0.1:${port}`;

function installedBrowser() {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

async function reset(page) {
  const response = await page.request.post(`${base}/__sim/reset`);
  assert.equal(response.ok(), true);
}

async function patchHardware(page, patch) {
  const current = await (await page.request.get(`${base}/api/hardware`)).json();
  const registry = structuredClone(current.channel_registry || { version: 1, inputs: [], outputs: [], bindings: [] });
  const sensorPurpose = {
    n1_rpm: 'n1_speed', n2_rpm: 'n2_speed', tot: 'tot', tit: 'tit', flame: 'flame',
    oil_press: 'oil_pressure', oil_temp: 'oil_temperature', fuel_press: 'fuel_pressure',
    batt_voltage: 'battery_voltage', fuel_flow: 'fuel_flow', p1: 'p1_pressure', p2: 'p2_pressure',
    throttle_input: 'throttle', idle_input: 'idle'
  };
  const actuatorPurpose = {
    throttle: 'main_fuel', starter: 'starter', oil_pump: 'oil_pump', fuel_sol: 'fuel_shutoff',
    igniter: 'igniter', igniter2: 'ab_igniter', ab_pump: 'ab_pump', ab_sol: 'ab_valve',
    glow_plug: 'glow_plug', oil_scavenge_pump: 'scavenge_pump', fuel_pump2: 'fuel_pump',
    prop_pitch: 'prop_pitch', cool_fan: 'cooling_fan', airstarter_sol: 'air_starter',
    bleed_valve: 'bleed_valve', starter_en: 'starter_enable'
  };
  for (const [key, change] of Object.entries(patch.sensors || {})) {
    if (change?.enabled === undefined) continue;
    for (const channel of registry.inputs || []) {
      if (channel.purpose === sensorPurpose[key]) channel.installed = !!change.enabled;
    }
  }
  if (patch.ab_flame?.enabled !== undefined) {
    for (const channel of registry.inputs || []) {
      if (channel.purpose === 'ab_flame') channel.installed = !!patch.ab_flame.enabled;
    }
  }
  for (const [key, change] of Object.entries(patch.actuators || {})) {
    if (change?.enabled === undefined) continue;
    for (const channel of registry.outputs || []) {
      if (channel.purpose === actuatorPurpose[key]) channel.installed = !!change.enabled;
    }
  }
  const response = await page.request.patch(`${base}/api/hardware`, {
    data: { ...patch, channel_registry: registry }
  });
  assert.equal(response.ok(), true);
}

async function patchConfig(page, patch) {
  const response = await page.request.patch(`${base}/api/config`, { data: patch });
  assert.equal(response.ok(), true);
}

async function gotoConfig(page) {
  const stateResponse = await page.request.post(`${base}/__sim/data`, {
    data: { mode:'STANDBY', config_locked:false }
  });
  assert.equal(stateResponse.ok(), true);
  await page.goto(`${base}/config.html`);
  await page.waitForSelector('#cf-eg_src', { state: 'attached' });
  await page.evaluate(() => document.querySelectorAll('.config-group,.protection-card').forEach(group => { group.open = true; }));
}

async function gotoSystem(page) {
  const stateResponse = await page.request.post(`${base}/__sim/data`, {
    data: { mode:'STANDBY', config_locked:false }
  });
  assert.equal(stateResponse.ok(), true);
  await page.goto(`${base}/system.html`);
  await page.waitForSelector('#cf-cl_n1', { state:'attached' });
  await page.evaluate(() => document.querySelectorAll('.config-group,.protection-card').forEach(group => { group.open = true; }));
}

async function shown(page, selector) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    const field = el?.closest('.cfg-field') || el;
    const section = el?.closest('.cfg-section') || el;
    return !!el && getComputedStyle(field).display !== 'none' && getComputedStyle(section).display !== 'none';
  }, selector);
}

async function disabled(page, selector) {
  return page.evaluate(sel => document.querySelector(sel)?.disabled ?? null, selector);
}

async function optionDisabled(page, selector, value) {
  return page.evaluate(({ selector, value }) => {
    const opt = document.querySelector(selector)?.querySelector(`option[value="${value}"]`);
    return opt ? opt.disabled : null;
  }, { selector, value });
}

async function sectionVisible(page, title) {
  return page.evaluate(title => {
    const sec = Array.from(document.querySelectorAll('.cfg-section'))
      .find(s => s.querySelector('.cfg-title')?.textContent.trim() === title);
    return !!sec && getComputedStyle(sec).display !== 'none';
  }, title);
}

(async () => {
  console.log('super-audit: boot');
  globalThis.OT_UI_SIM_PORT = port;
  await import('./ui_mock_server.mjs');

  const executablePath = installedBrowser();
  const browser = await chromium.launch({ headless: true, timeout: 8000, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => { throw error; });

  const results = [];
  try {
    await reset(page);
    console.log('super-audit: minimal hardware');
    await patchHardware(page, {
      has_afterburner: false,
      has_two_shaft: false,
      cluster_serial: { enabled: false },
      sensors: {
        n1_rpm: { enabled: false },
        n2_rpm: { enabled: false },
        tot: { enabled: false },
        tit: { enabled: false },
        flame: { enabled: false },
        oil_press: { enabled: false },
        oil_temp: { enabled: false },
        fuel_press: { enabled: false },
        batt_voltage: { enabled: false },
        fuel_flow: { enabled: false },
        p1: { enabled: false },
        p2: { enabled: false }
      },
      actuators: {
        oil_pump: { enabled: true },
        throttle: { enabled: false },
        starter: { enabled: false },
        igniter: { enabled: false },
        glow_plug: { enabled: false },
        oil_scavenge_pump: { enabled: false },
        fuel_pump2: { enabled: false },
        prop_pitch: { enabled: false },
        ab_sol: { enabled: false },
        ab_pump: { enabled: false },
        igniter2: { enabled: false }
      },
      controllers: { dynamic_idle: false, governor: false },
      ab_flame: { enabled: false },
      ab_trigger: { input_pin: -1 }
    });
    await gotoConfig(page);
    for (const selector of [
      '#cf-eg_src', '#cf-tot_limit', '#cf-tot_safe_margin', '#cf-tot_cooldown_target',
      '#cf-sf_hs', '#cf-sf_st', '#cf-sf_fo', '#cf-sf_fs',
      '#cf-rh_jt', '#cf-rh_zs',
    ]) {
      assert.equal(await disabled(page, selector), true, `${selector} should be locked without its hardware`);
    }
    for (const selector of ['#cf-th_ru', '#cf-th_rd', '#cf-th_mx', '#cf-th_ex', '#cf-lm_mt', '#cf-ms_is'])
      assert.equal(await page.locator(selector).count(), 0, `${selector} should stay out of a build without its owning output`);
    assert.equal(await sectionVisible(page, 'Cluster'), false);
    assert.equal(await shown(page, '#ab-cfg-section'), false);
    assert.equal(await shown(page, '[data-group="power"]'), false,
      'Power System must not remain as an empty expandable group without governor or afterburner hardware');
    results.push('minimal hardware locks unavailable temperature, flameout, throttle, cluster, and AB config');

    await reset(page);
    console.log('super-audit: tool durations');
    await patchHardware(page, {
      has_fuel_sol: false,
      has_oil_pump: false,
      has_igniter: false,
      has_igniter2: false,
      has_starter: false,
      actuators: {
        fuel_sol: { enabled: false },
        oil_pump: { enabled: false },
        igniter: { enabled: false },
        igniter2: { enabled: false },
        starter: { enabled: false }
      }
    });
    await page.goto(`${base}/tools.html`);
    await page.waitForFunction(() => !!hwCfg?.actuators);
    await page.evaluate(() => { engineMode = 'STANDBY'; });
    await page.locator('#btn-test-settings').click();
    for (const key of ['fuel_prime_ms', 'oil_prime_ms', 'ign_test_ms', 'start_test_ms', 'fuel_sol_test_ms']) {
      assert.equal(await page.locator(`.test-setting[data-key="${key}"]`).count(), 0,
        `${key} should be absent when its tool actuator is not fitted`);
    }

    await patchHardware(page, {
      actuators: {
        fuel_sol: { enabled: true },
        oil_pump: { enabled: true },
        igniter: { enabled: false },
        igniter2: { enabled: true },
        starter: { enabled: true }
      }
    });
    await page.goto(`${base}/tools.html`);
    await page.waitForFunction(() => !!hwCfg?.actuators);
    await page.evaluate(() => { engineMode = 'STANDBY'; });
    await page.locator('#btn-test-settings').click();
    for (const key of ['fuel_prime_ms', 'oil_prime_ms', 'start_test_ms', 'fuel_sol_test_ms']) {
      assert.ok(await page.locator(`.test-setting[data-key="${key}"]`).count() > 0,
        `${key} should appear when its tool actuator is fitted`);
    }
    // Igniter tool timings are per-output: with only Igniter 2 fitted, the
    // Igniter 1 duration stays ghosted and the Igniter 2 duration unlocks.
    assert.equal(await page.locator('.test-setting[data-key="ign_test_ms"]').count(), 0,
      'Igniter 1 timing must stay absent when only Igniter 2 is fitted');
    assert.ok(await page.locator('.test-setting[data-key="ign2_test_ms"]').count() > 0,
      'Igniter 2 timing should appear when Igniter 2 is fitted');
    await patchHardware(page, { actuators: { igniter: { enabled: true } } });
    await page.goto(`${base}/tools.html`);
    await page.waitForFunction(() => !!hwCfg?.actuators);
    await page.evaluate(() => { engineMode = 'STANDBY'; });
    await page.locator('#btn-test-settings').click();
    assert.ok(await page.locator('.test-setting[data-key="ign_test_ms"]').count() > 0,
      'Igniter 1 timing should appear when Igniter 1 is fitted');
    results.push('Tools > Test settings follows per-output actuator availability, including the igniter 1/2 split');

    await reset(page);
    console.log('super-audit: optional sections');
    await patchHardware(page, {
      has_starter: false,
      has_glow_plug: false,
      actuators: {
        starter: { enabled: false },
        glow_plug: { enabled: false }
      },
      sensors: {
        throttle_input: { enabled: false, rc_pwm: false },
        idle_input: { enabled: false, rc_pwm: false }
      }
    });
    await gotoConfig(page);
    await page.locator('#btn-view-expert').click();
    assert.equal(await shown(page, '#starter-support-section'), false, 'starter support section should hide without starter hardware');
    assert.equal(await shown(page, '#glow-cfg-section'), false, 'glow section should hide without glow plug hardware');
    assert.equal(await shown(page, '#rc-pwm-section'), false, 'RC PWM section should hide without servo PWM inputs');
    await page.locator('#btn-view-explore').click();
    assert.equal(await page.locator('#starter-support-section').count(), 0,
      'an output-owned starter controller should not clutter builds without a starter output');
    await page.locator('#btn-view-expert').click();
    assert.equal(await shown(page, '#starter-support-section'), false, 'Configured system should hide unavailable starter assist');
    await page.locator('#btn-view-explore').click();
    await page.locator('#cfg-search').fill('Bendix starter');
    assert.equal(await page.locator('#cf-sa_en').count(), 0, 'search must not recreate a controller whose output is not fitted');
    await page.locator('#cfg-search').fill('');

    await patchHardware(page, {
      has_starter: true,
      actuators: {
        starter: { enabled: true, type: 0 },
        glow_plug: { enabled: true }
      },
      sensors: {
        throttle_input: { enabled: true, rc_pwm: true },
        idle_input: { enabled: false, rc_pwm: false }
      }
    });
    await gotoConfig(page);
    await page.locator('#btn-view-expert').click();
    assert.equal(await shown(page, '#starter-support-section'), true, 'starter support settings should show when support and N1 are available');
    assert.equal(await shown(page, '#glow-cfg-section'), true, 'glow section should show with glow plug hardware');
    assert.equal(await shown(page, '#rc-pwm-section'), true, 'RC PWM section should show with servo PWM throttle input');
    await patchHardware(page, {
      sensors: { n1_rpm: { enabled: false } }
    });
    await gotoConfig(page);
    await page.locator('#btn-view-expert').click();
    assert.equal(await shown(page, '#starter-support-section'), false, 'starter support settings should hide without N1 feedback');
    results.push('optional Pulsed Starter Assist, glow, and RC PWM sections follow fitted hardware and feedback prerequisites');

    await reset(page);
    console.log('super-audit: cluster toggle');
    await patchHardware(page, {
      cluster_serial: { enabled: true },
      has_two_shaft: false,
      sensors: {
        n1_rpm: { enabled: true },
        n2_rpm: { enabled: false },
        tot: { enabled: false },
        tit: { enabled: false },
        oil_press: { enabled: false }
      }
    });
    await gotoSystem(page);
    assert.equal(await page.locator('#cf-cl_en').count(), 0, 'cluster has no redundant Config enable');
    assert.equal(await shown(page, '#cf-cl_n1'), true);
    assert.equal(await disabled(page, '#cf-cl_n1'), false);
    assert.equal(await shown(page, '#cf-cl_n2'), false, 'Configured system should hide an N2 threshold without N2 hardware');
    assert.equal(await shown(page, '#cf-cl_tw'), false);
    assert.equal(await disabled(page, '#cf-cl_tw'), true);
    assert.equal(await shown(page, '#cf-cl_ow'), false);
    assert.equal(await disabled(page, '#cf-cl_ow'), true);
    results.push('System keeps cluster thresholds focused on the sensors fitted to the configured display');

    await reset(page);
    console.log('super-audit: TIT-only');
    await patchHardware(page, {
      sensors: { tot: { enabled: false }, tit: { enabled: true }, n1_rpm: { enabled: false }, oil_press: { enabled: true } },
      actuators: { throttle: { enabled: true }, oil_pump: { enabled: true } }
    });
    await gotoConfig(page);
    assert.equal(await optionDisabled(page, '#cf-eg_src', '1'), true);
    assert.equal(await optionDisabled(page, '#cf-eg_src', '2'), false);
    assert.equal(await disabled(page, '#cf-tot_limit'), true);
    assert.equal(await disabled(page, '#cf-sf_tit'), false);
    assert.equal(await disabled(page, '#cf-sf_hs'), false);
    assert.equal(await disabled(page, '#cf-rl_en'), true);
    results.push('TIT-only setups unlock TIT safety but keep TOT and N1 relight locked');

    await reset(page);
    console.log('super-audit: relight igniter prerequisite');
    await patchHardware(page, {
      sensors: { n1_rpm: { enabled: true }, tot: { enabled: true } },
      actuators: { igniter: { enabled: false } }
    });
    await gotoConfig(page);
    assert.equal(await page.locator('#cf-rl_en').count(), 0);
    assert.equal(await page.locator('#cf-rl_mr').count(), 0);

    await patchHardware(page, {
      actuators: { igniter: { enabled: true } }
    });
    await gotoConfig(page);
    assert.equal(await disabled(page, '#cf-rl_en'), false);
    assert.equal(await disabled(page, '#cf-rl_mr'), false);
    results.push('auto-relight requires both N1 feedback and Igniter 1 hardware');

    await reset(page);
    await patchHardware(page, {
      sensors: { flame: { enabled: true }, n1_rpm: { enabled: false }, tot: { enabled: false }, tit: { enabled: false } },
      actuators: { throttle: { enabled: true } }
    });
    await patchConfig(page, {
      safety: { flameout_source: 2 },
      relight: { confirm_source: 3 }
    });
    await gotoConfig(page);
    await page.locator('#btn-view-expert').click();
    assert.equal(await shown(page, '#cf-sf_fn'), false);
    assert.equal(await disabled(page, '#cf-sf_fn'), true);
    assert.equal(await shown(page, '#cf-rl_tr'), false);
    assert.equal(await disabled(page, '#cf-rl_tr'), true);
    await page.locator('#btn-view-explore').click();
    assert.equal(await shown(page, '#cf-sf_fn'), true);
    assert.equal(await disabled(page, '#cf-sf_fn'), false);
    assert.equal(await shown(page, '#cf-rl_tr'), true);
    assert.equal(await disabled(page, '#cf-rl_tr'), false);
    results.push('stale flameout/relight source selections stay hidden normally but can be prepared safely in Explore');

    await reset(page);
    console.log('super-audit: dual EGT');
    await patchHardware(page, {
      sensors: { tot: { enabled: true }, tit: { enabled: true }, n1_rpm: { enabled: true } },
      actuators: { throttle: { enabled: true } }
    });
    await gotoConfig(page);
    await page.locator('#cf-eg_src').selectOption('1');
    assert.equal(await disabled(page, '#cf-tot_limit'), false);
    assert.equal(await disabled(page, '#cf-sf_tit'), true);
    await page.locator('#cf-eg_src').selectOption('2');
    assert.equal(await disabled(page, '#cf-tot_limit'), true);
    assert.equal(await disabled(page, '#cf-sf_tit'), false);
    results.push('dual TOT/TIT source switching enables the selected limit and ghosts the inactive one');

    await reset(page);
    console.log('super-audit: oil map/dynamic idle');
    await patchHardware(page, {
      sensors: { oil_press: { enabled: true }, n1_rpm: { enabled: true }, n2_rpm: { enabled: false } },
      actuators: { oil_pump: { enabled: true }, throttle: { enabled: false } },
      controllers: { dynamic_idle: true },
      oil_loops: [{ enabled:true, id:'oil1', pressure_input:'oil_pressure_main', pump_output:'oil_pump',
        target_source:1, target_bar:2.2, target_high_bar:3.1, speed_min_rpm:0, speed_max_rpm:20000,
        deadband_bar:.2, response_gain:1.8, failsafe_delay_ms:1500, failsafe_demand:.6,
        min_demand:.18, max_demand:1 }],
      has_two_shaft: false
    });
    await gotoConfig(page);
    assert.equal(await page.locator('#cf-di_tr').count(), 0,
      'automatic-idle tuning should be absent when there is no Main Fuel output to control');
    await page.locator('#btn-view-expert').click();
    const oilCard = page.locator('[data-purpose="oil_pump"]');
    assert.equal(await oilCard.getByText('Oil Pressure Control', {exact:true}).count() > 0, true);
    assert.equal(await oilCard.getByLabel('High pressure target (bar)').count(), 1);
    await oilCard.getByLabel('Pressure target set by').selectOption('0');
    assert.equal(await oilCard.getByLabel('High pressure target (bar)').count(), 0);
    assert.equal(await oilCard.getByLabel('Pressure target (bar)').count(), 1);
    results.push('per-pump oil-pressure controller settings live inside the owning Oil Pump card and follow the selected target source');

    await reset(page);
    console.log('super-audit: pressure-only dynamic idle');
    await patchConfig(page, {
      dynamic_idle: { source: 2, target_pressure_bar: 1.8, pressure_deadband_bar: 0.05, pressure_limit_bar: 3.0 }
    });
    await patchHardware(page, {
      sensors: { n1_rpm: { enabled: false }, n2_rpm: { enabled: false }, p1: { enabled: true }, p2: { enabled: false } },
      actuators: { throttle: { enabled: true } },
      controllers: { dynamic_idle: true },
      has_two_shaft: false
    });
    await gotoConfig(page);
    await page.locator('#btn-view-expert').click();
    assert.equal(await disabled(page, '#cf-di_src'), false, 'P1-only profile should make Automatic Idle available');
    assert.equal(await page.locator('#cf-di_src').inputValue(), '2');
    assert.equal(await shown(page, '#cf-di_tp'), true);
    assert.equal(await shown(page, '#cf-di_pd'), true);
    assert.equal(await shown(page, '#cf-di_pl'), true);
    assert.equal(await shown(page, '#cf-di_tr'), false);
    assert.equal(await shown(page, '#cf-di_db'), false);
    assert.equal(await shown(page, '#cf-di_rl'), false);
    assert.equal(await optionDisabled(page, '#cf-di_src', '3'), true, 'unfitted P2 source should be unavailable');
    await patchConfig(page, { dynamic_idle: { source: 3 } });
    await patchHardware(page, { sensors: { p1: { enabled: false }, p2: { enabled: true } } });
    await gotoConfig(page);
    await page.locator('#btn-view-expert').click();
    assert.equal(await disabled(page, '#cf-di_src'), false, 'P2-only profile should make Automatic Idle available');
    assert.equal(await page.locator('#cf-di_src').inputValue(), '3');
    assert.equal(await shown(page, '#cf-di_tp'), true);
    assert.equal(await shown(page, '#cf-di_tr'), false);
    assert.equal(await optionDisabled(page, '#cf-di_src', '2'), true, 'unfitted P1 source should be unavailable');
    results.push('P1-only and P2-only Automatic Idle expose pressure settings and hide shaft-speed settings');

    await reset(page);
    await patchHardware(page, {
      has_two_shaft: false,
      sensors: { n2_rpm: { enabled: false } },
      actuators: { throttle: { enabled: false }, prop_pitch: { enabled: false } },
      controllers: { governor: true }
    });
    await gotoConfig(page);
    if (await shown(page, '#governor-cfg-section')) {
      assert.equal(await disabled(page, '#cf-gv_tr'), true);
      assert.equal(await disabled(page, '#cf-gv_kp'), true);
    }

    await patchHardware(page, {
      has_two_shaft: true,
      sensors: { n2_rpm: { enabled: true } },
      actuators: { throttle: { enabled: true }, prop_pitch: { enabled: false }, igniter: { enabled: true } },
      controllers: { governor: true }
    });
    await gotoConfig(page);
    assert.equal(await disabled(page, '#cf-lm_mt'), false);
    assert.equal(await disabled(page, '#cf-ms_is'), false);
    await page.locator('#btn-view-expert').click();
    assert.equal(await page.locator('#cf-gv_tr').count(), 0);

    await patchHardware(page, {
      has_two_shaft: true,
      sensors: { n2_rpm: { enabled: true } },
      actuators: { throttle: { enabled: false }, prop_pitch: { enabled: true } },
      controllers: { governor: true }
    });
    await gotoConfig(page);
    await page.locator('#btn-view-expert').click();
    assert.equal(await page.locator('#cf-gv_tr').count(), 0);
    assert.equal(await page.locator('#new-controller-output option[value="prop_pitch"]').count(), 1,
      'a fitted unowned pitch output should be offered by the unified controller creator');
    results.push('N2 control uses the unified owning-output controller definition instead of a second legacy governor panel');

    await reset(page);
    console.log('super-audit: afterburner missing deps');
    await patchConfig(page, {
      afterburner: { use_torch: true, flame_mode: 1 }
    });
    await patchHardware(page, {
      has_afterburner: true,
      sensors: { tot: { enabled: false }, tit: { enabled: false }, flame: { enabled: false }, n1_rpm: { enabled: false } },
      actuators: { throttle: { enabled: false }, ab_sol: { enabled: false }, ab_pump: { enabled: false }, igniter2: { enabled: false } },
      ab_flame: { enabled: false },
      ab_trigger: { input_pin: -1 }
    });
    await gotoConfig(page);
    assert.equal(await shown(page, '#ab-cfg-section'), false, 'Setup hides an afterburner feature with no usable hardware path');
    await page.locator('#btn-view-expert').click();
    assert.equal(await shown(page, '#ab-cfg-section'), false, 'stale afterburner flags must not reveal settings without canonical AB hardware');
    for (const selector of ['#cf-ab_mn','#cf-ab_mx','#cf-ab_tt','#cf-ab_tpct','#cf-ab_tms','#cf-ab_ui','#cf-ab_ut','#cf-ab_mt','#cf-ab_tr','#cf-ab_tw','#cf-ab_pcm','#cf-ab_fm'])
      assert.equal(await page.locator(selector).count(), 0, `${selector} should be absent without an owning AB output`);
    results.push('stale afterburner flags cannot reveal settings without canonical AB hardware');

    await reset(page);
    await patchHardware(page, {
      has_afterburner: true,
      sensors: { n1_rpm: { enabled: true }, tot: { enabled: true } },
      actuators: { throttle: { enabled: true }, ab_pump: { enabled: true }, igniter2: { enabled: true } },
      ab_trigger: { source: 1, input_pin: -1 },
      ab_flame: { enabled: false }
    });
    await gotoConfig(page);
    assert.equal(await disabled(page, '#cf-ab_mn'), false);
    assert.equal(await disabled(page, '#cf-ab_mx'), false);
    assert.equal(await disabled(page, '#cf-ab_tt'), false);
    assert.equal(await disabled(page, '#cf-ab_ui'), false);
    assert.equal(await disabled(page, '#cf-ab_pcm'), false);
    assert.equal(await page.locator('#cf-ab_tt').inputValue(), '80');
    results.push('afterburner entry fields unlock when throttle trigger, N1, and AB hardware are fitted');

    console.log(`Config super audit passed (${results.length} groups):`);
    for (const result of results) console.log(`- ${result}`);
    await browser.close();
    process.exit(0);
  } catch (error) {
    await browser.close();
    throw error;
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
