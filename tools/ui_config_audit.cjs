const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const port = 8800 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;

function readConstExpression(source, marker, closing) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const end = source.indexOf(closing, start);
  assert.notEqual(end, -1, `unterminated ${marker}`);
  return Function(`return (${source.slice(start + marker.length, end + closing.length - 1).trim().replace(/;$/, '')})`)();
}

function auditConfigStructure() {
  const root = path.resolve(__dirname, '..');
  const configSource = fs.readFileSync(path.join(root, 'data_src', 'config.html'), 'utf8');
  const sequenceSource = fs.readFileSync(path.join(root, 'data_src', 'sequence.html'), 'utf8');
  const logSource = fs.readFileSync(path.join(root, 'data_src', 'log.html'), 'utf8');
  const toolsSource = fs.readFileSync(path.join(root, 'data_src', 'tools.html'), 'utf8');
  const configCpp = fs.readFileSync(path.join(root, 'src', 'system', 'Config.cpp'), 'utf8');
  const schema = readConstExpression(configSource, 'const ALL_CONFIG_SCHEMA = ', '\n];');
  const groups = readConstExpression(configSource, 'const ALL_WORKSPACE_GROUPS = ', '\n];');
  const fields = schema.flatMap(section => section.fields.map(field => ({
    ...field, section: section.title, pathText: field.path.join('.')
  })));

  for (const property of ['key', 'pathText', 'label']) {
    const values = fields.map(field => field[property]);
    assert.equal(new Set(values).size, values.length, `Config contains a duplicate ${property}`);
  }
  assert.equal(new Set(schema.map(section => section.title)).size, schema.length,
    'Config contains duplicate section titles');
  const assignments = groups.flatMap(group => group.sections);
  const controllerOwnedSections = ['Automatic N2 Speed Control'];
  assert.deepEqual([...assignments, ...controllerOwnedSections].sort(), schema.map(section => section.title).sort(),
    'Every settings section must belong to a workspace group or one explicit output controller');
  assert.equal(assignments.includes('Automatic N2 Speed Control'), false,
    'N2 governing must not return as a duplicate standalone workspace');
  assert.equal(fields.some(field => field.pathText.startsWith('tools.')), false,
    'Bench-test settings must be owned only by Tools > Test settings');
  for (const key of ['sf_tit', 'sf_p1t', 'sf_p2t']) {
    const field = fields.find(candidate => candidate.key === key);
    assert.equal(field?.section, 'Engine Protection Limits', `${key} must be shown with the main engine limits`);
    assert.equal(field?.basic, true, `${key} must remain visible in Essentials`);
  }
  for (const key of ['pb_p1s', 'pb_p1h', 'pb_p2s', 'pb_p2h', 'sf_p1t', 'sf_p2t']) {
    assert.equal(fields.find(candidate => candidate.key === key)?.unitType, 'press', `${key} must follow the selected pressure unit`);
  }
  for (const bit of ['p1', 'p2', 'torque', 'starter'])
    assert.match(logSource, new RegExp(`data-bit="${bit}"`), `${bit.toUpperCase()} logging must be configured on the Log page`);
  assert.equal(fields.some(field => field.pathText.startsWith('session_log.')), false,
    'Session logging settings must not be duplicated on Config');
  assert.match(logSource, /id="session-current-download"[^>]*disabled/,
    'The current-session download must start disabled until its API confirms a log exists');
  assert.match(logSource, /No current session log; use Past Sessions above/,
    'The empty current-session state must not contradict the archived Past Sessions list');
  assert.match(configSource, /mode_mask:4/, 'Simple controls must be limited to the normal RUNNING owner phase');
  assert.match(configSource, /On \/ Off with hysteresis/, 'Simple controls must expose an understandable binary method');
  assert.match(configSource, /Map input to output/, 'Variable outputs must support proportional mapping');
  assert.match(configSource, /One normal owner per output/, 'Controller ownership must be explicit');
  assert.match(configSource, /Hold a feedback target/, 'Custom variable outputs must support feedback control');

  const firmwareToolKeys = [...new Set(
    [...configCpp.matchAll(/tl\["([^"]+)"\]\s*=/g)].map(match => match[1])
  )];
  const toolsUiKeys = new Set([
    ...[...toolsSource.matchAll(/configKey:'tools\.([^']+)'/g)].map(match => match[1]),
    ...[...toolsSource.matchAll(/:\s*'([^']+)'/g)].map(match => match[1])
  ]);
  assert.deepEqual(firmwareToolKeys.filter(key => !toolsUiKeys.has(key)), [],
    'Every firmware bench-test setting must remain editable from Tools');

  const blocks = readConstExpression(sequenceSource, 'const BLOCKS = ', '\n};');
  const mappings = readConstExpression(sequenceSource, 'const CONFIG_SECTIONS = ', '\n};');
  for (const [blockName, block] of Object.entries(blocks)) {
    for (const parameter of block.params || []) {
      const mapping = mappings[parameter.configKey];
      if (!mapping) continue;
      const configField = fields.find(field => field.pathText === `${mapping.sec}.${mapping.key}`);
      if (!configField) continue;
      assert.equal(parameter.min ?? null, configField.min ?? null,
        `${blockName}.${parameter.key} minimum differs between Config and Sequence`);
      assert.equal(parameter.max ?? null, configField.max ?? null,
        `${blockName}.${parameter.key} maximum differs between Config and Sequence`);
    }
  }
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

async function shown(page, selector) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    return !!el && getComputedStyle(el).display !== 'none';
  }, selector);
}

async function disabled(page, selector) {
  return page.evaluate(sel => document.querySelector(sel)?.disabled ?? null, selector);
}

async function checked(page, selector) {
  return page.evaluate(sel => document.querySelector(sel)?.checked ?? null, selector);
}

async function reset(page) {
  const response = await page.request.post(`${base}/__sim/reset`);
  assert.equal(response.ok(), true);
  if (page.url().startsWith(base)) await page.evaluate(() => sessionStorage.clear());
}

async function patchHardware(page, patch) {
  const response = await page.request.patch(`${base}/api/hardware`, { data: patch });
  assert.equal(response.ok(), true);
  if (page.url().startsWith(base)) await page.evaluate(() => sessionStorage.clear());
}

async function patchData(page, patch) {
  const response = await page.request.post(`${base}/__sim/data`, { data: patch });
  assert.equal(response.ok(), true);
  if (page.url().startsWith(base)) await page.evaluate(() => sessionStorage.clear());
}

async function goto(page, route, waitSelector) {
  await page.goto(`${base}/${route}`);
  await page.waitForSelector(waitSelector, { state: 'attached' });
}

(async () => {
  globalThis.OT_UI_SIM_PORT = port;
  await import('./ui_mock_server.mjs');
  const executablePath = installedBrowser();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage();
  page.on('pageerror', error => {
    throw error;
  });

  const results = [];
  try {
    auditConfigStructure();
    results.push('Config keys, paths, labels, section ownership, Tools ownership, and shared Sequence ranges are unique and consistent');
    await reset(page);

    await goto(page, 'hardware.html', '#hardware-profile-section');
    assert.equal(await page.locator('#f-saf-lowfuel').count(), 0);
    assert.equal(await page.evaluate(() => 'low_fuel' in (cfg.safety || {})), false);
    results.push('hardware page does not expose unsupported low-fuel flow safety');

    const safetyMatrix = await page.evaluate(() => {
      const sst = key => ({ disabled: !safetyAvailability(key).ok, checked: !!cfg.safety[key] });
      const cst = key => ({ disabled: !controllerAvailability(key).ok, checked: !!cfg.controllers[key] });
      function setSensor(key, enabled) {
        cfg.sensors[key].enabled = enabled;
        const purpose = ({
          n1_rpm:'n1_speed', n2_rpm:'n2_speed', tot:'tot', tit:'tit', flame:'flame', oil_press:'oil_pressure',
          fuel_press:'fuel_pressure', batt_voltage:'battery_voltage', oil_temp:'oil_temperature'
        })[key];
        cfg.channel_registry.inputs.forEach(channel => {
          if (registryDerivedPurpose('input', channel) === purpose) channel.installed = enabled;
        });
      }
      cfg.safety.overspeed = true;
      cfg.safety.surge = true;
      setSensor('n1_rpm', false);
      updateSafetyPrerequisites(true);
      const n1Off = { overspeed: sst('overspeed'), surge: sst('surge') };

      cfg.safety.n2_overspeed = true;
      setSensor('n2_rpm', false);
      updateSafetyPrerequisites(true);
      const n2Off = { n2Overspeed: sst('n2_overspeed') };
      setSensor('n2_rpm', true);

      cfg.safety.overtemp = true;
      cfg.safety.hot_start = true;
      setSensor('tot', false);
      setSensor('tit', false);
      updateSafetyPrerequisites(true);
      const totOff = { overtemp: sst('overtemp'), hotStart: sst('hot_start') };

      cfg.safety.flameout = true;
      setSensor('flame', false);
      setSensor('n1_rpm', false);
      setSensor('tot', false);
      setSensor('tit', false);
      updateSafetyPrerequisites(true);
      const combustionOff = { flameout: sst('flameout') };

      cfg.safety.low_oil = true;
      cfg.safety.oil_zero = true;
      cfg.controllers.oil_loop = true;
      setSensor('oil_press', false);
      updateSafetyPrerequisites(true);
      updateHardwarePrerequisites(true);
      const oilOff = {
        lowOil: sst('low_oil'),
        oilZero: sst('oil_zero'),
        oilLoop: cst('oil_loop')
      };

      cfg.safety.fuel_press_low = true;
      setSensor('fuel_press', false);
      cfg.safety.batt_low = true;
      setSensor('batt_voltage', false);
      setSensor('tit', false);
      cfg.safety.oil_temp_high = true;
      setSensor('oil_temp', false);
      updateSafetyPrerequisites(true);
      const optionalOff = {
        fuelPress: sst('fuel_press_low'),
        batt: sst('batt_low'),
        oilTemp: sst('oil_temp_high')
      };
      return { n1Off, n2Off, totOff, combustionOff, oilOff, optionalOff };
    });
    assert.equal(await page.locator('#f-saf-titovertemp').count(), 0);
    for (const [groupName, group] of Object.entries(safetyMatrix)) {
      for (const [stateName, state] of Object.entries(group)) {
        assert.equal(state.disabled, true, `${groupName}.${stateName} should be disabled`);
        assert.equal(state.checked, false, `${groupName}.${stateName} should be unchecked`);
      }
    }
    results.push('hardware safety cards disable and uncheck when required sensors disappear');

    const hardwareDeps = await page.evaluate(() => {
      cfg.has_two_shaft = false;
      cfg.has_afterburner = false;
      const staleOff = {
        n2: registryHasPurpose('input', 'n2_speed'),
        governor: controllerAvailability('governor').ok,
        afterburner: hardwareHasAfterburner()
      };
      cfg.has_two_shaft = true;
      cfg.has_afterburner = true;
      const staleOn = {
        n2: registryHasPurpose('input', 'n2_speed'),
        governor: controllerAvailability('governor').ok,
        afterburner: hardwareHasAfterburner()
      };
      return { staleOff, staleOn };
    });
    assert.deepEqual(hardwareDeps.staleOff, hardwareDeps.staleOn);
    assert.deepEqual(hardwareDeps.staleOn, { n2:true, governor:true, afterburner:true });
    results.push('hardware derives N2, governor, dynamic idle, and afterburner surfaces from fitted devices');

    const typeGroups = await page.evaluate(() => {
      const tempHtml = registryTemperatureInterfaceEditor({purpose:'tot', role:'temperature', driver:1, temp_interface:2}, 0);
      const oilTempHtml = registryTemperatureInterfaceEditor({purpose:'oil_temperature', role:'temperature', driver:1, temp_interface:4}, 0);
      const torqueHtml = registryTorqueInterfaceEditor('input', {purpose:'torque', role:'torque', driver:1, torque_interface:1}, 0);
      return {
        mainFuel: registryAllowedDrivers('output', 'fuel', 'main_fuel'),
        starter: registryAllowedDrivers('output', 'starter', 'starter'),
        oilPump: registryAllowedDrivers('output', 'oil_pump', 'oil_pump'),
        fuelFlow: registryAllowedDrivers('input', 'flow', 'fuel_flow'),
        abFlame: registryAllowedDrivers('input', 'flame', 'ab_flame'),
        tempInterfaces: ['MAX6675','MAX31855','MAX31856'].every(label => tempHtml.includes(label)) &&
          ['NTC','DS18B20'].every(label => oilTempHtml.includes(label)),
        torqueHx711: torqueHtml.includes('HX711') && torqueHtml.includes('SCK GPIO')
      };
    });
    assert.deepEqual(typeGroups, {
      mainFuel:[5,6], starter:[4,5,6,11], oilPump:[4,5,6,11], fuelFlow:[2,1,9],
      abFlame:[0,1,8,9], tempInterfaces:true, torqueHx711:true
    });
    results.push('hardware type selectors show compatible native and shared-I2C actuator, temperature, load, flow, and flame fields');

    const i2cRemoval = await page.evaluate(() => {
      cfg.i2c = {...(cfg.i2c || {}), enabled:true};
      cfg._i2c_discovery = {bus_active:true, devices:[]};
      renderI2cDiscovery();
      const before = (registryRoot().inputs || []).some(c => c.purpose === 'thrust' && Number(c.i2c_address) === 42);
      const newTotDrivers = registryDriverOptions('input', 1, 'temperature', 'tot');
      const savedThrustDrivers = registryDriverOptions('input', 10, 'thrust', 'thrust');
      const action = [...document.querySelectorAll('#i2c-discovery button')]
        .find(button => /Remove device/.test(button.textContent) &&
          /NAU7802|0x2A/i.test(button.closest('.hw-item-card')?.textContent || ''));
      if (action) action.click();
      const modalListsThrust = /Thrust/.test(document.getElementById('registry-remove-body')?.textContent || '');
      confirmRegistryRemoveChannel();
      return {
        before,
        action:!!action,
        modalListsThrust,
        removed:!(registryRoot().inputs || []).some(c => c.purpose === 'thrust'),
        cannotChooseMissingTla:!newTotDrivers.includes('TLA2528'),
        savedMissingNauVisible:savedThrustDrivers.includes('NAU7802') && savedThrustDrivers.includes('Disconnected')
      };
    });
    assert.deepEqual(i2cRemoval, {
      before:true, action:true, modalListsThrust:true, removed:true,
      cannotChooseMissingTla:true, savedMissingNauVisible:true
    });
    results.push('disconnected I2C hardware cannot be newly selected and can remove all saved channel dependencies in one action');

    await reset(page);
    await goto(page, 'hardware.html', '#hardware-profile-section');
    await patchHardware(page, { platform: 'esp32s3' });
    await goto(page, 'hardware.html', '#hardware-profile-section');
    const s3Pins = await page.evaluate(() => ({
      output22: buildPinOptions(22, 'out').includes('value="22"'),
      adc1: buildPinOptions(1, 'adc').includes('value="1"')
    }));
    assert.deepEqual(s3Pins, { output22:false, adc1:true });
    results.push('hardware GPIO lists switch to ESP32-S3-safe output and ADC choices');

    await reset(page);
    await goto(page, 'sequence.html', '#add-startup-sel');
    const seqDeps = await page.evaluate(() => {
      const fullSensors = getEnabledSensors().map(s => s.key);
      const fullActuators = getEnabledActuators().map(a => a.key);
      hwCfg.has_two_shaft = false;
      hwCfg.has_afterburner = false;
      hwCfg.sensors.n2_rpm.enabled = true;
      hwCfg.actuators.ab_sol.enabled = true;
      hwCfg.actuators.ab_pump.enabled = true;
      populateAddSelects();
      const abPump = getEnabledActuators().find(a => a.key === 'ab_pump');
      const hiddenMaster = {
        sensors: getEnabledSensors().map(s => s.key),
        actuators: getEnabledActuators().map(a => a.key),
        abPumpOptionCount: abPump ? Array.from(document.querySelectorAll('#add-afterburner-sel option'))
          .filter(option => option.value === `SetOutput::${abPump.target}`).length : 0
      };
      return { fullSensors, fullActuators, hiddenMaster };
    });
    assert.ok(seqDeps.fullSensors.includes('n1_rpm'));
    assert.ok(seqDeps.fullSensors.includes('n2_rpm'));
    assert.ok(seqDeps.fullActuators.includes('ab_sol'));
    assert.equal(seqDeps.hiddenMaster.sensors.includes('n2_rpm'), true);
    assert.equal(seqDeps.hiddenMaster.actuators.includes('ab_sol'), true);
    assert.equal(seqDeps.hiddenMaster.abPumpOptionCount, 1);
    results.push('sequence choices follow fitted N2/afterburner devices regardless of obsolete masters');

    await reset(page);
    await patchHardware(page, {
      has_afterburner: false,
      actuators: { igniter2: { enabled: false }, ab_sol: { enabled: false }, ab_pump: { enabled: false } },
      ab_flame: { enabled: false },
      ab_trigger: { source: 0, switch_pin: -1, input_pin: 4 }
    });
    await patchData(page, { mode:'STANDBY', config_locked:false });
    await goto(page, 'controllers.html', '#cf-tot_limit');
    assert.ok(await page.locator('[data-controller-card]').count() >= 1,
      'Controllers should render saved output-first controller definitions');
    assert.equal(await page.locator('#controller-hardware-setup').count(), 0,
      'Legacy controller-assignment toggles must not form a parallel control system');
    assert.equal(await page.locator('[data-group="bench"]').count(), 0,
      'Bench-test settings belong in Tools > Test settings, not Config');
    assert.equal(await page.locator('#btn-view-basic').count(), 0,
      'The redundant Essentials filter should not be shown');
    assert.equal(await page.locator('#btn-view-expert').getAttribute('class').then(v => v.includes('active')), true);
    assert.equal(await page.locator('#cfg-state-badge').textContent(), 'Saved');
    const configuredCount = await page.locator('.cfg-field').count();
    assert.ok(configuredCount > 0, 'Configured system should expose applicable settings');
    assert.match(await page.locator('#cf-lm_mt').evaluate(el => el.closest('.cfg-field')?.textContent || ''),
      /automatically because feedback used by an enabled protection\/controller becomes unhealthy/i);
    await page.locator('#cfg-search').fill('relight');
    assert.match(await page.locator('#cfg-result-count').textContent(), /^\d+ settings?$/);
    assert.equal(await shown(page, '[data-built-in="relight"]'), true);
    assert.equal(await shown(page, '[data-group="engine"]'), false);
    await page.locator('#cfg-search').fill('');
    assert.ok(await page.locator('.cfg-help').count() > 100,
      'Long engineering help should remain available through progressive disclosure');
    const incompleteHelp = await page.evaluate(() => Array.from(document.querySelectorAll('.cfg-section:not([data-always-visible]) .cfg-field')).flatMap(field => {
      const help = (field.querySelector('.cfg-desc')?.textContent || '').trim();
      const label = (field.querySelector('.cfg-label')?.textContent || '').trim();
      return !help || /^(undefined|null|value|setting)$/i.test(help) ? [label] : [];
    }));
    assert.deepEqual(incompleteHelp, [], `Every Config field needs meaningful help; incomplete: ${incompleteHelp.join(', ')}`);
    assert.ok(await page.locator('#cf-rl_oid optgroup[label="Suggested"] option').count() >= 1,
      'Relight should suggest fitted ignition devices');
    assert.ok(await page.locator('#cf-rl_oid optgroup[label="Other fitted outputs"] option').count() >= 1,
      'Relight should retain deliberate access to other fitted outputs');
    const windmillToggle = page.locator('#cf-so_en');
    if (!await windmillToggle.isChecked()) await windmillToggle.evaluate(el => {
      el.checked = true;
      el.dispatchEvent(new Event('change', {bubbles:true}));
    });
    assert.equal(await page.locator('#cf-so_oid').isDisabled(), false,
      'Enabling windmilling protection should reveal its output selector immediately');
    assert.ok(await page.locator('#cf-so_oid optgroup[label="Suggested"] option').count() >= 1,
      'Windmilling protection should suggest fitted oil pumps');
    assert.ok(await page.locator('#cf-so_oid optgroup[label="Other fitted outputs"] option').count() >= 1,
      'Windmilling protection should permit an explicit alternate fitted output');
    results.push('config workspace groups settings and searches field metadata without losing detailed help');
    const n2RelationshipWarnings = await page.evaluate(() => {
      const setNumber = (key, value) => { const el = document.getElementById('cf-' + key); if (el) el.value = String(value); };
      const setCheck = (key, value) => { const el = document.getElementById('cf-' + key); if (el) el.checked = value; };
      const setSelect = (key, value) => { const el = document.getElementById('cf-' + key); if (el) el.value = String(value); };
      hwCfg.safety.n2_overspeed = true;
      hwCfg.controllers.governor = true;
      hwCfg.controllers.dynamic_idle = true;
      setNumber('n2_rpm_limit', 30000);
      setSelect('pb_n2e', 1); setNumber('pb_n2s', 30000); setNumber('pb_n2h', 32000);
      setNumber('gv_tr', 29000); setNumber('gv_bd', 1500);
      setNumber('rpm_limit', 50000);
      setSelect('pb_n1e', 1); setNumber('pb_n1s', 50000); setNumber('pb_n1h', 52000);
      setNumber('di_src', 1); setNumber('di_tr', 30000);
      hwCfg.safety.hot_start = true;
      setNumber('tot_limit', 650); setNumber('sf_hs', 700); setNumber('sf_st', 0);
      setNumber('so_src', 0);
      setCheck('so_en', true);
      setNumber('so_rl', 500000); setNumber('so_fp', 0); setNumber('so_fb', 0);
      runValidation();
      return Array.from(document.querySelectorAll('.cfg-inline-warn')).map(el => el.textContent);
    });
    const n2WarningDetail = JSON.stringify(n2RelationshipWarnings);
    assert.ok(n2RelationshipWarnings.some(text => /pullback/i.test(text)), n2WarningDetail);
    assert.ok(n2RelationshipWarnings.some(text => /N1 pullback/i.test(text)), n2WarningDetail);
    assert.ok(n2RelationshipWarnings.some(text => /Idle target/i.test(text)), n2WarningDetail);
    assert.ok(n2RelationshipWarnings.some(text => /windmilling oil protection can never activate/i.test(text)), n2WarningDetail);
    assert.ok(n2RelationshipWarnings.some(text => /both zero/i.test(text)), n2WarningDetail);
    assert.ok(n2RelationshipWarnings.some(text => /Pre-start EGT maximum/i.test(text)), n2WarningDetail);
    const n1PullbackWithoutTrip = await page.evaluate(() => {
      hwCfg.safety.overspeed = false;
      runValidation();
      return Array.from(document.querySelectorAll('.cfg-inline-warn'))
        .map(el => el.textContent)
        .find(text => /N1 pullback/i.test(text)) || '';
    });
    assert.match(n1PullbackWithoutTrip, /Maximum N1 Speed/);
    assert.doesNotMatch(n1PullbackWithoutTrip, /hard N1 shutdown/);
    results.push('config warns about unsafe shaft, hot-start and windmilling-oil relationships');
    await goto(page, 'controllers.html', '#cf-tot_limit');
    assert.equal(await page.locator('#dev-mode-tools-link').getAttribute('href'), '/tools.html#card-dev-mode');
    assert.equal(await page.locator('#btn-dev-mode').count(), 0,
      'Config must not bypass the guarded Developer Mode control on Tools');
    assert.equal(await shown(page, '[data-built-in="afterburner"]'), true,
      'the fitted afterburner subsystem should be discoverable by default');
    for (const selector of ['#ab-ign-section', '#ab-flame-section', '#ab-run-section']) {
      assert.equal(await page.locator(selector).count(), 1,
        `${selector} should be attached inside the initially collapsed afterburner subsystem`);
    }
    assert.equal(await page.locator('#cf-ab_pcm option[value="2"]').isDisabled(), true,
      'a stale hidden input pin must not enable Dedicated AB Input unless that trigger source is active');
    assert.equal(await page.locator('#ab-cfg-section').count(), 0,
      'afterburner entry gates belong only to the Afterburner sequence page');
    results.push('Configured system exposes the fitted afterburner commissioning choices by default');
    const firstTot = await page.locator('#cf-tot_limit').inputValue();
    assert.ok(firstTot === '720' || firstTot === '1328');
    await page.locator('#unit-temp-btn').click();
    const secondTot = await page.locator('#cf-tot_limit').inputValue();
    assert.notEqual(secondTot, firstTot);
    assert.ok(secondTot === '720' || secondTot === '1328');
    await page.locator('#unit-press-btn').click();
    assert.equal(await page.locator('#cf-oil_rm').inputValue(), '17.405');
    const configFullHardware = await (await page.request.get(`${base}/api/hardware`)).json();
    await patchHardware(page, {
      has_afterburner: false,
      controllers: { governor: false },
      sensors: { n1_rpm: { enabled: false }, tit: { enabled: false }, oil_temp: { enabled: false }, fuel_press: { enabled: false }, batt_voltage: { enabled: false }, tot: { enabled: false } },
      actuators: { igniter2: { enabled: false }, ab_pump: { enabled: false } },
      ab_flame: { enabled: false },
      ab_trigger: { switch_pin: -1, input_pin: -1 },
      channel_registry: {
        ...configFullHardware.channel_registry,
        inputs: configFullHardware.channel_registry.inputs.filter(channel =>
          !['n1_speed', 'tot', 'tit', 'oil_temperature', 'fuel_pressure', 'battery_voltage', 'ab_flame'].includes(channel.purpose)),
        outputs: configFullHardware.channel_registry.outputs.filter(channel =>
          !['ab_igniter', 'ab_valve', 'ab_pump'].includes(channel.purpose))
      }
    });
    await patchData(page, {
      has_afterburner: false, has_governor: false, has_n1: false, has_tit: false, has_oil_temp: false,
      has_fuel_press: false, has_batt_voltage: false, has_tot: false,
      fuel_press_min: 0, tit_limit: 0
    });
    await page.reload();
    await page.waitForSelector('#cf-tot_limit', {state:'attached'});
    assert.equal(await shown(page, '#safety-ext-section'), false);
    assert.equal(await shown(page, '#governor-cfg-section'), false);
    for (const selector of ['#ab-ign-section', '#ab-flame-section', '#ab-run-section']) {
      assert.equal(await shown(page, selector), false, `${selector} should hide`);
    }
    results.push('config unit conversions preserve meaning and optional sections hide when hardware is absent');

    await reset(page);
    const noThrottleInputHardware = await (await page.request.get(`${base}/api/hardware`)).json();
    await patchHardware(page, {
      sensors: { throttle_input: { enabled: false, pin: -1 } },
      channel_registry: {
        ...noThrottleInputHardware.channel_registry,
        inputs: noThrottleInputHardware.channel_registry.inputs.filter(channel => channel.purpose !== 'throttle')
      }
    });
    await patchData(page, { mode:'STANDBY', config_locked:false });
    await goto(page, 'controllers.html', '#cf-th_ex');
    assert.equal(await disabled(page, '#cf-th_ex'), true,
      'Throttle Expo must lock when the main fuel output exists but no physical throttle input is fitted');
    assert.match(await page.locator('#cf-th_ex').evaluate(el => el.closest('.cfg-field')?.title || ''),
      /only applies to a physical throttle input/i);
    assert.equal(await disabled(page, '#cf-th_mx'), false,
      'Idle Max remains useful to startup and idle sequence blocks without an operator throttle input');
    results.push('Throttle Expo locks when no physical throttle input can consume it');


    await reset(page);
    const calibrationHardware = await (await page.request.get(`${base}/api/hardware`)).json();
    const hiddenCalibrationPurposes = new Set([
      'oil_pressure', 'flame', 'p1_pressure', 'p2_pressure', 'oil_temperature',
      'battery_voltage', 'torque', 'fuel_pressure', 'throttle', 'idle'
    ]);
    await patchHardware(page, {
      sensors: {
        oil_press: { enabled: false }, flame: { enabled: false }, p1: { enabled: false }, p2: { enabled: false },
        oil_temp: { enabled: false }, batt_voltage: { enabled: false }, torque: { enabled: false },
        fuel_press: { enabled: false }, fuel_flow: { enabled: true, type: 1 },
        throttle_input: { enabled: false }, idle_input: { enabled: false }
      },
      actuators: {
        glow_plug: { enabled: true, has_current: false },
        igniter: { enabled: true, has_current: false },
        igniter2: { enabled: true, has_current: false },
        oil_pump: { enabled: true, has_current: false }
      },
      channel_registry: {
        ...calibrationHardware.channel_registry,
        inputs: calibrationHardware.channel_registry.inputs.map(channel =>
          hiddenCalibrationPurposes.has(channel.purpose) ? { ...channel, installed: false } : channel),
        outputs: calibrationHardware.channel_registry.outputs.map(channel =>
          ['glow_plug', 'igniter', 'ab_igniter', 'oil_pump'].includes(channel.purpose)
            ? { ...channel, has_current: false } : channel)
      }
    });
    await goto(page, 'calibration.html', '#oil-press-cal-row');
    await patchData(page, {
      has_oil_press: false, has_flame: false, has_p1: false, has_p2: false,
      has_oil_temp: false, has_batt_voltage: false, has_torque: false,
      has_fuel_press: false, has_fuel_flow: true, fuel_flow_type: 1,
      has_glow_current: false, has_igniter_current: false, has_igniter2_current: false,
      has_oil_pump_current: false, throttle_input_type: 'none', idle_input_type: 'none'
    });
    await page.waitForTimeout(100);
    for (const selector of ['#oil-press-cal-row', '#flame-cal-row', '#p1-cal-row', '#p2-cal-row', '#oiltemp-cal-row', '#battvolt-cal-row', '#torque-cal-row', '#fuelpress-cal-row', '#fuelflow-cal-row', '#throttle-cal-row', '#idle-cal-row']) {
      assert.equal(await shown(page, selector), false, `${selector} should be hidden`);
    }
    await patchHardware(page, {
      sensors: {
        fuel_flow: { enabled: true, type: 0 },
        throttle_input: { enabled: true, rc_pwm: true },
        idle_input: { enabled: true, rc_pwm: true }
      },
      channel_registry: {
        ...calibrationHardware.channel_registry,
        inputs: calibrationHardware.channel_registry.inputs.map(channel =>
          ['fuel_flow', 'throttle', 'idle'].includes(channel.purpose)
            ? { ...channel, installed: true }
            : hiddenCalibrationPurposes.has(channel.purpose) ? { ...channel, installed: false } : channel)
      }
    });
    await patchData(page, { has_fuel_flow: true, fuel_flow_type: 0, throttle_input_type: 'servo', throttle_input_us: 1500, idle_input_type: 'servo', idle_input_us: 1300 });
    await page.reload();
    await page.waitForSelector('#oil-press-cal-row', { state: 'attached' });
    await page.waitForFunction(() => /us|µs/.test(document.querySelector('#cal-th-raw')?.textContent || ''), null, { timeout: 5000 });
    assert.equal(await shown(page, '#fuelflow-cal-row'), true);
    assert.equal(await shown(page, '#throttle-cal-row'), true);
    assert.equal(await shown(page, '#idle-cal-row'), true);
    assert.match(await page.locator('#cal-th-raw').textContent(), /us|µs/);
    assert.match(await page.locator('#cal-idle-raw').textContent(), /us|µs/);
    results.push('calibration rows and servo/ADC units follow fitted hardware and telemetry type');

    await patchData(page, { idle_input_type: 'servo', idle_input_us: 0 });
    await page.waitForFunction(() => document.querySelector('#cal-idle-raw')?.textContent === 'NO SIGNAL');
    assert.equal(await page.locator('#cal-idle-pct').textContent(), '—');
    assert.equal(await page.locator('#cal-idle-thr').textContent(), '—');
    results.push('missing idle RC pulses are shown as no signal, not a valid zero position');

    await reset(page);
    await goto(page, 'log.html', '#tab-session');
    await page.locator('#tab-session').click();
    await page.locator('#session-save-btn:not([disabled])').waitFor();
    assert.equal(await disabled(page, 'input[data-bit="n2"]'), false);
    assert.equal(await disabled(page, 'input[data-bit="ab"]'), false);
    assert.equal(await disabled(page, 'input[data-bit="prop"]'), false);
    const logHardware = await (await page.request.get(`${base}/api/hardware`)).json();
    await patchHardware(page, {
      has_afterburner: false,
      has_two_shaft: false,
      sensors: { n2_rpm: { enabled: false } },
      actuators: { prop_pitch: { enabled: false }, ab_sol: { enabled: false }, ab_pump: { enabled: false } },
      ab_flame: { enabled: false },
      ab_trigger: { switch_pin: -1, input_pin: -1 },
      channel_registry: {
        ...logHardware.channel_registry,
        inputs: logHardware.channel_registry.inputs.filter(channel => !['n2_speed', 'ab_flame'].includes(channel.purpose)),
        outputs: []
      }
    });
    await page.reload();
    await page.waitForSelector('#tab-session');
    await page.locator('#tab-session').click();
    await page.waitForFunction(() => document.querySelector('input[data-bit="ab"]')?.disabled === true);
    assert.equal(await disabled(page, 'input[data-bit="n2"]'), true);
    assert.equal(await disabled(page, 'input[data-bit="ab"]'), true);
    assert.equal(await disabled(page, 'input[data-bit="prop"]'), true);
    results.push('log session channels ghost when their hardware is not fitted');

    await reset(page);
    await patchData(page, { config_locked: true });
    await goto(page, 'log.html', '#tab-session');
    await page.locator('#tab-session').click();
    await page.waitForFunction(() => document.querySelector('#session-save-btn')?.disabled === true);
    assert.equal(await disabled(page, 'input[data-bit="n1"]'), true);
    assert.equal(await disabled(page, '#log-standby'), true);
    assert.equal(await disabled(page, '#session-save-btn'), true);
    assert.equal(await shown(page, '#session-lock-msg'), true);
    results.push('log session settings respect the saved-config lock state');

    await reset(page);
    await patchData(page, { mode:'STARTUP', dev_mode:true, config_locked:true });
    await goto(page, 'controllers.html', '#cf-th_ru');
    await page.waitForFunction(() => document.querySelector('#cfg-lock-badge')?.textContent.includes('Read-only'), null, { timeout: 10000 })
      .catch(async error => {
        const state = await page.evaluate(() => ({
          badge: document.querySelector('#cfg-lock-badge')?.textContent,
          runtimeMode: typeof runtimeMode === 'undefined' ? 'undefined' : runtimeMode,
          runtimeDevMode: typeof runtimeDevMode === 'undefined' ? 'undefined' : runtimeDevMode,
          connected: document.querySelector('#conn-label')?.textContent,
          applyDataType: typeof window.applyData,
          extended: window.applyData?._configExtended || false,
          installAttempts: typeof configTelemetryInstallAttempts === 'undefined' ? 'undefined' : configTelemetryInstallAttempts,
          lastMode: typeof _lastData === 'undefined' ? 'undefined' : _lastData?.mode
        }));
        throw new Error(`${error.message}\nControllers runtime state=${JSON.stringify(state)}`);
      });
    assert.equal(await disabled(page, '#cf-th_ru'), true);
    assert.equal(await disabled(page, '#cf-rpm_limit'), true);
    await patchData(page, { mode:'SHUTDOWN', dev_mode:true, config_locked:true });
    await page.waitForFunction(() => document.querySelector('#cfg-lock-badge')?.textContent.includes('Read-only'));
    assert.equal(await disabled(page, '#cf-th_ru'), true);
    await patchData(page, { mode:'RUNNING', dev_mode:true, config_locked:true });
    await page.waitForFunction(() => document.querySelector('#cfg-lock-badge')?.textContent.includes('Limited live'));
    assert.equal(await disabled(page, '#cf-th_ru'), false);
    assert.equal(await disabled(page, '#cf-rpm_limit'), true);
    results.push('STARTUP and SHUTDOWN stay read-only while RUNNING Developer Mode exposes only live-safe fields');

    const stalePage = await browser.newPage();
    await stalePage.goto(`${base}/controllers.html`);
    await stalePage.locator('[data-built-in="fuel-support"] > summary').click();
    await stalePage.locator('.controller-subcard').filter({hasText:'Throttle Response'}).first().locator(':scope > summary').click();
    await stalePage.waitForSelector('#cf-th_rd');
    if (!(await page.locator('[data-built-in="fuel-support"]').evaluate(el => el.open)))
      await page.locator('[data-built-in="fuel-support"] > summary').click();
    const liveThrottleCard = page.locator('[data-built-in="fuel-support"] .controller-subcard').filter({hasText:'Throttle Response'}).first();
    if (!(await liveThrottleCard.evaluate(el => el.open)))
      await liveThrottleCard.locator(':scope > summary').click();
    await page.locator('#cf-th_ru').fill('1700');
    await page.locator('#btn-save').click();
    if (await page.locator('#ot-app-dialog.show').isVisible()) await page.locator('#ot-dialog-confirm').click();
    await page.waitForSelector('#save-recap-modal', {state:'visible'});
    await page.locator('#save-recap-confirm-btn').click();
    await page.waitForFunction(() => /Saved|Applied live|Live update queued/.test(document.querySelector('#save-msg')?.textContent || ''));
    let simState = await (await page.request.get(`${base}/__sim/state`)).json();
    assert.deepEqual(simState.last_config_patch, { throttle:{ ramp_up_ms:1700 } });
    await stalePage.locator('#cf-th_rd').fill('1800');
    await stalePage.locator('#btn-save').click();
    if (await stalePage.locator('#ot-app-dialog.show').isVisible()) await stalePage.locator('#ot-dialog-confirm').click();
    await stalePage.waitForSelector('#save-recap-modal', {state:'visible'});
    await stalePage.locator('#save-recap-confirm-btn').click();
    await stalePage.waitForFunction(() => /Saved|Applied live|Live update queued/.test(document.querySelector('#save-msg')?.textContent || ''));
    simState = await (await page.request.get(`${base}/__sim/state`)).json();
    assert.deepEqual(simState.last_config_patch, { throttle:{ ramp_down_ms:1800 } });
    assert.equal(simState.settings.throttle.ramp_up_ms, 1700);
    assert.equal(simState.settings.throttle.ramp_down_ms, 1800);
    await stalePage.close();
    results.push('live saves PATCH only changed fields and preserve edits from another stale browser');

    await reset(page);
    await goto(page, 'tools.html', '#tool-area');
    assert.equal(await page.locator('#card-AB_SOL_TEST').isVisible(), true);
    await patchHardware(page, {
      has_afterburner: false,
      controllers: { dynamic_idle: false },
      sensors: { n1_rpm: { enabled: false }, n2_rpm: { enabled: false } },
      actuators: { throttle: { enabled: false }, ab_sol: { enabled: true }, ab_pump: { enabled: true } }
    });
    await page.reload();
    await page.waitForSelector('#tool-area');
    assert.equal(await page.locator('#card-AB_SOL_TEST').count(), 1);
    assert.equal(await page.locator('#card-AB_PUMP_TEST').count(), 1);
    assert.equal(await page.locator('#card-TOGGLE_DYNAMIC_IDLE').count(), 0);
    assert.equal(await page.locator('#card-TOGGLE_LIMP_MODE').count(), 0);
    results.push('tools page follows fitted actuator prerequisites and ignores obsolete master fields');

    console.log(`UI configuration audit passed (${results.length} groups):`);
    results.forEach(result => console.log(`- ${result}`));
  } finally {
    await browser.close();
  }
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
