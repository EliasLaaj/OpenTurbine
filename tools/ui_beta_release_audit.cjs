const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

// The firmware/UI source assertions below read repo-relative paths (src/, data_src/),
// so anchor the working directory to the repo root regardless of where node was launched.
process.chdir(path.resolve(__dirname, '..'));

const port = 10300 + Math.floor(Math.random() * 500);
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

async function shown(page, selector) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    return !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  }, selector);
}

async function pageSweep(page, viewport) {
  await page.setViewportSize(viewport);
  const pages = [
    ['index.html', '#n1-card'],
    ['hardware.html', '#hardware-profile-section'],
    ['controllers.html', '#controller-overview'],
    ['system.html', '#system-device-setup'],
    ['sequence.html', '#save-btn'],
    ['calibration.html', 'body'],
    ['tools.html', 'body'],
    ['log.html', 'body']
  ];
  for (const [route, selector] of pages) {
    await page.goto(`${base}/${route}`);
    await page.waitForSelector(selector, { state: 'attached' });
    await page.waitForTimeout(250);
    const metrics = await page.evaluate(() => ({
      title: document.title,
      textLength: document.body.innerText.trim().length,
      overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      visibleInputs: document.querySelectorAll('input:not([type="hidden"]),select,button').length
    }));
    assert.ok(metrics.textLength > 50, `${route} should render meaningful content`);
    assert.ok(metrics.overflow <= 24, `${route} has horizontal overflow ${metrics.overflow}px at ${viewport.width}px`);
    assert.ok(metrics.visibleInputs > 0 || route === 'index.html' || route === 'log.html', `${route} should expose controls`);
    if (route === 'index.html') {
      await page.waitForFunction(() =>
        ['p1-health', 'p2-health', 'fuel-flow-health'].every(id =>
          document.getElementById(id)?.classList.contains('ok')), null, { timeout: 5000 });
      assert.equal(await page.evaluate(() =>
        ['p1-health', 'p2-health', 'fuel-flow-health'].every(id =>
          document.getElementById(id)?.classList.contains('ok'))), true,
        'fitted P1, P2 and fuel-flow sensors should expose green health dots');
      assert.equal((await page.locator('#fuel-flow-card .peak-val').textContent()).trim(), 'L/min');
    }
    if (route === 'hardware.html') {
      assert.equal(await page.locator('#btn-save').evaluate(el => el.classList.contains('primary')), true);
      assert.equal(await page.locator('#unit-temp-btn').evaluate(el => el.getBoundingClientRect().height >= 34), true);
      assert.equal(await page.locator('#unit-press-btn').evaluate(el => el.getBoundingClientRect().height >= 34), true);
    }
    if ((route === 'controllers.html' || route === 'system.html') && viewport.width <= 600) {
      const closedHeights = await page.locator('.config-group:not([open])').evaluateAll(groups =>
        groups.map(group => group.getBoundingClientRect().height));
      assert.ok(closedHeights.every(height => height <= 112),
        `closed mobile Configuration groups should stay compact; got ${closedHeights.join(', ')}`);
    }
    if (route === 'log.html' && viewport.width <= 600) {
      const widthRatios = await page.locator('.run-card').evaluateAll(cards => cards.map(card => {
        const stats = card.querySelector('.run-stats');
        return stats ? stats.getBoundingClientRect().width / card.getBoundingClientRect().width : 0;
      }));
      assert.ok(widthRatios.length > 0 && widthRatios.every(ratio => ratio > 0.85),
        `mobile Log statistics should use the card width; got ${widthRatios.join(', ')}`);
    }
  }
}

function enumNames(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const body = source.slice(start, source.indexOf('};', start));
  return [...body.matchAll(/\b(F_[A-Z0-9_]+)\b/g)].map(match => match[1]);
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
    if (message.type() === 'error' && !/Failed to load resource/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on('response', response => {
    if (response.status() >= 400 && !/\/favicon\.ico($|\?)/.test(response.url())) {
      badResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  const results = [];
  try {
    await reset(page);

    for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      await pageSweep(page, viewport);
    }
    results.push('all main pages render consistently without console errors, blank mobile groups, narrow run statistics, or major horizontal overflow');

    const exported = await (await page.request.get(`${base}/api/ecu_config`)).json();
    assert.equal(exported.hardware.profile_id, exported.settings.profile_id);
    exported.hardware.profile_id = 'beta-release-engine';
    exported.settings.profile_id = 'beta-release-engine';
    let response = await page.request.post(`${base}/api/ecu_config`, { data: exported });
    assert.equal(response.ok(), true, 'matching full ECU file should restore');
    const crossed = structuredClone(exported);
    crossed.settings.profile_id = 'wrong-engine';
    response = await page.request.post(`${base}/api/ecu_config`, { data: crossed });
    assert.equal(response.status(), 400, 'crossed ECU file should be rejected');
    response = await page.request.post(`${base}/api/factory_reset`);
    assert.equal(response.ok(), true, 'factory reset endpoint should complete');
    const afterReset = await (await page.request.get(`${base}/api/ecu_config`)).json();
    assert.equal(afterReset.hardware.profile_id, afterReset.settings.profile_id);
    results.push('full ECU export/restore, crossed-file rejection, and factory reset path behave consistently');

    await reset(page);
    let hardware = await (await page.request.get(`${base}/api/hardware`)).json();
    const oilTempBefore = structuredClone(hardware.sensors.oil_temp);
    response = await page.request.patch(`${base}/api/hardware`, {
      data: { sensors: { oil_temp: { ntc_beta: oilTempBefore.ntc_beta + 25 } } }
    });
    assert.equal(response.ok(), true, 'nested calibration hardware patch should save');
    hardware = await (await page.request.get(`${base}/api/hardware`)).json();
    assert.equal(hardware.sensors.oil_temp.ntc_beta, oilTempBefore.ntc_beta + 25);
    assert.equal(hardware.sensors.oil_temp.enabled, oilTempBefore.enabled);
    assert.equal(hardware.sensors.oil_temp.pin, oilTempBefore.pin);
    assert.equal(hardware.sensors.oil_temp.chip, oilTempBefore.chip);
    response = await page.request.patch(`${base}/api/hardware`, {
      data: { sensors: { oil_temp: { use_raw_poly: true, poly_a: 0.000001, poly_b: -0.001, poly_c: 0.5, poly_d: -20, poly_x_min: 420, poly_x_max: 3400 } } }
    });
    assert.equal(response.ok(), true, 'known-point oil-temperature range should save');
    hardware = await (await page.request.get(`${base}/api/hardware`)).json();
    assert.equal(hardware.sensors.oil_temp.use_raw_poly, true);
    assert.equal(hardware.sensors.oil_temp.poly_x_min, 420);
    assert.equal(hardware.sensors.oil_temp.poly_x_max, 3400);
    assert.equal(hardware.sensors.oil_temp.pin, oilTempBefore.pin);
    results.push('nested calibration PATCH preserves sibling hardware topology fields');

    await reset(page);
    const profiles = [
      {
        name: 'single-shaft minimal cluster TX-only',
        disableInputs: ['n2_speed', 'ab_flame'],
        disableOutputs: ['ab_igniter', 'ab_pump', 'ab_valve', 'prop_pitch'],
        patch: {
          has_two_shaft: false,
          has_afterburner: false,
          cluster_serial: { enabled: true, tx_pin: 5, rx_pin: -1 },
          sensors: { n2_rpm: { enabled: true }, tit: { enabled: false }, fuel_press: { enabled: false } },
          actuators: { prop_pitch: { enabled: false }, ab_sol: { enabled: true }, ab_pump: { enabled: true } }
        },
        checks: async () => {
          assert.equal(await page.evaluate(() => registryHasPurpose('input', 'n2_rpm')), false);
          assert.equal(await page.evaluate(() => hardwareHasAfterburner()), false);
        }
      },
      {
        name: 'two-shaft turboprop governor',
        disableOutputs: ['ab_igniter', 'ab_pump', 'ab_valve'],
        patch: {
          has_two_shaft: true,
          has_afterburner: false,
          sensors: { n2_rpm: { enabled: true } },
          actuators: { prop_pitch: { enabled: true } },
          controllers: { governor: true }
        },
        checks: async () => {
          assert.equal(await page.evaluate(() => cfg.has_two_shaft && cfg.sensors.n2_rpm.enabled), true);
          assert.equal(await page.evaluate(() => registryHasPurpose('output', 'prop_pitch')), true);
          assert.equal(await page.evaluate(() => cfg.controllers.governor && controllerAvailability('governor').ok), true);
        }
      },
      {
        name: 'afterburner hardware',
        patch: {
          has_afterburner: true,
          actuators: { ab_sol: { enabled: true }, ab_pump: { enabled: true }, igniter2: { enabled: true } },
          ab_flame: { enabled: true }
        },
        checks: async () => {
          assert.equal(await page.evaluate(() => hardwareHasAfterburner()), true);
          assert.equal(await page.evaluate(() => registryHasPurpose('input', 'ab_flame')), true);
        }
      },
      {
        name: 'ESP32-S3 external telemetry',
        patch: {
          platform: 'esp32s3',
          cluster_serial: { enabled: true, tx_pin: 1, rx_pin: 46 },
          mavlink: { enabled: true, tx_pin: 4 },
          buzzer: { enabled: true, pin: 6 },
          actuators: { status_led: { enabled: true, pin: 5 } }
        },
        checks: async () => {
          assert.equal(await page.evaluate(() => buildPinOptions(46, 'out').includes('value="46"')), false);
        }
      }
    ];
    for (const profile of profiles) {
      await reset(page);
      const current = await (await page.request.get(`${base}/api/hardware`)).json();
      const disabledInputs = new Set(profile.disableInputs || []);
      const disabledOutputs = new Set(profile.disableOutputs || []);
      const profilePatch = {
        ...profile.patch,
        channel_registry: {
          ...current.channel_registry,
          inputs: current.channel_registry.inputs.map(channel => ({
            ...channel, installed: !disabledInputs.has(channel.purpose)
          })),
          outputs: current.channel_registry.outputs.map(channel => ({
            ...channel, installed: !disabledOutputs.has(channel.purpose)
          }))
        }
      };
      await patchHardware(page, profilePatch);
      await page.goto(`${base}/hardware.html`);
      await page.waitForSelector('#hardware-profile-section', { state: 'attached' });
      await page.waitForFunction(expected => typeof cfg !== 'undefined' && cfg?.platform === expected,
        profilePatch.platform || current.platform, { timeout: 5000 });
      await profile.checks();
    }
    results.push(`representative hardware profiles render expected feature gates (${profiles.map(p => p.name).join(', ')})`);

    await reset(page);
    await patchHardware(page, {
      has_two_shaft: false,
      has_afterburner: false,
      sensors: { n2_rpm: { enabled: true } },
      actuators: {
        prop_pitch: { enabled: false },
        glow_plug: { enabled: false },
        fuel_pump2: { enabled: false },
        bleed_valve: { enabled: false },
        oil_scavenge_pump: { enabled: false }
      },
      controllers: { governor: true }
    });
    await page.goto(`${base}/sequence.html`);
    await page.waitForSelector('#save-btn', { state: 'attached' });
    await page.waitForFunction(() => [...document.querySelectorAll('#add-startup-sel option,#add-shutdown-sel option')]
      .some(option => /N2 Speed Control|Governor/i.test(option.textContent)), null, { timeout: 5000 });
    const sequencer = await page.evaluate(() => {
      const optionText = [...document.querySelectorAll('#add-startup-sel option,#add-shutdown-sel option')].map(o => o.textContent);
      const ruleText = [...document.querySelectorAll('.rule-sensor option,.rule-actuator option')].map(o => o.textContent);
      return {
        hasAbBlock: optionText.some(t => /\bAB\b|Afterburner/i.test(t)),
        abTabVisible: getComputedStyle(document.getElementById('tab-btn-afterburner')).display !== 'none',
        hasGovernorBlock: optionText.some(t => /N2 Speed Control|Governor/i.test(t)),
        hasHiddenN2Rule: ruleText.some(t => /\bN2\b/i.test(t)),
        hasPropRule: ruleText.some(t => /Prop/i.test(t))
      };
    });
    assert.deepEqual(sequencer, { hasAbBlock: false, abTabVisible: true, hasGovernorBlock: true, hasHiddenN2Rule: false, hasPropRule: false });
    results.push('sequencer ignores obsolete master fields and follows the fitted N2 and afterburner devices');

    const ecuCluster = fs.readFileSync(path.join('src', 'system', 'ClusterSerial.cpp'), 'utf8');
    const client = fs.readFileSync(path.join('examples', 'OTCClusterClient.h'), 'utf8');
    assert.deepEqual(enumNames(client, 'enum FieldId'), enumNames(ecuCluster, 'enum FieldId'));
    assert.match(ecuCluster, /bool hasPrimaryEgt\(\) \{ return Config::effectiveEgtSource\(\) != 0; \}/);
    assert.match(ecuCluster, /bool hasShaftPower\(\) \{ return HardwareConfig::hasTorque && HardwareConfig::hasN2Rpm; \}/);
    assert.match(ecuCluster, /\{ F_TOT_RATE,[^}]*"TOT_RATE",\s*"EGT rise C\/s",\s*hasPrimaryEgt/s);
    assert.match(ecuCluster, /\{ F_POWER_W,[^}]*"POWER_W",\s*"Power W",\s*hasShaftPower/s);
    assert.match(ecuCluster, /\{ F_THROTTLE_PCT,[^}]*"THROTTLE_PCT",\s*"Main fuel pct",\s*hasThrottle/s);
    assert.match(client, /OTC:SUB,ALL/);
    assert.match(client, /OTC:CMD,STOP/);
    assert.match(client, /signalLost\(\)/);
    results.push('cluster example field ids and documented commands match the ECU protocol enum');

    const throttleSlew = fs.readFileSync(path.join('src', 'engine', 'controllers', 'ThrottleSlew.h'), 'utf8');
    // Zero-disabled limits must not produce pullback: the guard now lives
    // centrally inside applyPullback (hard<=soft covers hard==0 disabled).
    assert.match(throttleSlew, /if \(hard <= soft \|\| value <= soft\) return;/);
    const safetyMonitor = fs.readFileSync(path.join('src', 'engine', 'SafetyMonitor.h'), 'utf8');
    assert.match(safetyMonitor, /HardwareConfig::safetyN2Overspeed && HardwareConfig::hasN2Rpm/);
    assert.match(safetyMonitor, /n2RpmLimit > 0\.0f && ed\.n2Rpm > n2RpmLimit/);
    assert.match(safetyMonitor, /OVERSPEED_CONFIRM_MS[\s\S]*?_trigger\("N2_OVERSPEED"\)/);
    assert.match(safetyMonitor, /N2 over-speed: power-turbine RPM exceeded its hard shutdown limit/);
    // Relight needs a viable N1 AND the CONFIGURED ignition target fitted
    // (igniter / igniter2 / glow — no longer hardcoded to igniter 1).
    assert.match(safetyMonitor, /relightIgnitionOk && n1Ok/);
    assert.match(safetyMonitor, /case 1: relightIgnitionOk = HardwareConfig::hasIgniter2/);
    const configSource = fs.readFileSync(path.join('src', 'system', 'Config.cpp'), 'utf8') +
      fs.readFileSync(path.join('src', 'system', 'ConfigSerialize.cpp'), 'utf8');
    assert.match(configSource, /CONFIG_FIELD\(n2RpmLimit,\s*"n2_rpm_limit"\)/);
    assert.match(configSource, /readConfigFields\(eng,\s*ENGINE_FLOAT_FIELDS\)/);
    assert.match(configSource, /writeConfigFields\(eng,\s*ENGINE_FLOAT_FIELDS\)/);
    // Relight sanitization is target-aware: disabled when N1 is missing or
    // the SELECTED ignition output (igniter/igniter2/glow) is not fitted.
    assert.match(configSource, /case 1: relightTargetAvailable = HardwareConfig::hasIgniter2/);
    assert.match(configSource, /\(!HardwareConfig::hasN1Rpm \|\| !relightTargetAvailable\) && relightEnabled[\s\S]{0,80}relightEnabled = false/);
    assert.match(configSource, /case 6:\s+return HardwareConfig::hasTwoShaft && HardwareConfig::hasN2Rpm/);
    assert.match(configSource, /case 19:\s+return HardwareConfig::hasAfterburner && HardwareConfig::hasAbFlame/);
    assert.match(configSource, /case 20:\s+return HardwareConfig::hasGlowPlug && HardwareConfig::hasGlowCurrentSensor/);
    assert.match(configSource, /case 21:\s+return HardwareConfig::hasIgniter && HardwareConfig::hasIgniterCurrentSensor/);
    assert.match(configSource, /case 22:\s+return HardwareConfig::hasIgniter2 && HardwareConfig::hasIgniter2CurrentSensor/);
    assert.match(configSource, /case 23:\s+return HardwareConfig::hasOilPump && HardwareConfig::hasOilPumpCurrentSensor/);
    const rulesEngine = fs.readFileSync(path.join('src', 'system', 'RulesEngine.h'), 'utf8');
    assert.match(rulesEngine, /case N2_RPM:\s+return HardwareConfig::hasTwoShaft && HardwareConfig::hasN2Rpm && ed\.n2Healthy/);
    assert.match(rulesEngine, /case AB_FLAME:\s+return HardwareConfig::hasAfterburner && HardwareConfig::hasAbFlame/);
    assert.match(rulesEngine, /case GLOW_CURRENT:\s+return HardwareConfig::hasGlowPlug && HardwareConfig::hasGlowCurrentSensor/);
    const mainSource = fs.readFileSync(path.join('src', 'main.cpp'), 'utf8');
    assert.match(mainSource, /N2 overspeed safety is enabled but the hard N2 RPM limit is 0/);
    assert.match(mainSource, /N2 gradual pullback starts or reaches full authority at\/above the hard N2 shutdown limit/);
    assert.match(mainSource, /Governor target plus no-correction band reaches the hard N2 shutdown limit/);
    assert.match(mainSource, /N2-based idle target is at\/above the hard N2 shutdown limit/);
    assert.match(mainSource, /Cluster N2 warning is at\/above the hard N2 shutdown limit/);
    assert.match(mainSource, /case OTCommand::APPLY_CONFIG:[\s\S]*Hardware::applyConfig\(\);[\s\S]*validateSequences\(\);/);
    assert.match(mainSource, /Selected EGT hard limit is 0 - overtemperature shutdown is disabled", false/);
    assert.match(mainSource, /Running oil minimum is 0 - low-oil shutdown is disabled", false/);
    assert.match(mainSource, /Both EGT flameout conditions are disabled", false/);
    assert.match(mainSource, /EGT relight recovery rise is 0 - EGT-source relight cannot confirm success", false/);
    assert.match(mainSource, /Minimum N1 to fire relight is below Minimum Running N1; the ECU will use the higher Minimum Running N1 value", false/);
    const configSourceCpp = fs.readFileSync(path.join('src', 'system', 'Config.cpp'), 'utf8');
    assert.match(configSourceCpp,
      /Settings missing from ecu_config\.json - adding defaults[\s\S]*if \(!save\(\)\)/,
      'first boot must complete a hardware-only unified file even while PCB commissioning locks START');
    assert.doesNotMatch(configSourceCpp,
      /else if \(!EngineData::instance\(\)\.configLocked\) \{[\s\S]*Settings missing from ecu_config\.json - adding defaults/,
      'a missing required PCB assignment must not block creation of default settings');
    assert.match(configSourceCpp, /return fmaxf\(relightMinRpm, minRpm\)/);
    assert.match(mainSource, /Relight timeout is 0 - the ECU will use its hardcoded 30 second maximum", false/);
    assert.match(mainSource, /START blocked: actuator tool active/);
    assert.match(mainSource, /Cannot start: an actuator test or prime tool is still active/);
    assert.match(mainSource, /auto checkAbActuatorBlockHardware = \[\&\]\(const char\* nm\)/);
    assert.match(mainSource, /for \(int i = 0; i < _abShutCount; i\+\+\)[\s\S]*checkAbActuatorBlockHardware\(_abShutBlocks\[i\]->name\(\)\)/);
    assert.match(mainSource, /class CustomSequenceBlock : public IBlock/);
    assert.match(mainSource, /RulesEngine::sensorConditionMet\(_def->sensor, _def->op, threshold\)/);
    assert.match(mainSource, /RulesEngine::applyActuatorDemand\(step\.actuator, step\.value\)/);
    assert.match(mainSource, /custom\.bind\(def\);[\s\S]*blocks\[count\+\+\] = &custom/);
    assert.match(mainSource, /auto customDefFor = \[\&\]\(const char\* key\)/);
    assert.doesNotMatch(mainSource, /if \(EngineData::instance\(\)\.benchMode\) return BlockResult::Complete;/);
    assert.match(mainSource, /const bool benchMode = EngineData::instance\(\)\.benchMode/);
    assert.doesNotMatch(mainSource, /Overtemp safety requires a selected TOT\/TIT source and a limit above zero", true/);
    const hardwareHeader = fs.readFileSync(path.join('src', 'system', 'HardwareConfig.h'), 'utf8');
    assert.match(hardwareHeader, /MAX_CUSTOM_BLOCKS = 8/);
    assert.match(hardwareHeader, /struct CustomBlockDef/);
    const pcbProfileHeader = fs.readFileSync(path.join('src', 'system', 'pcb', 'PcbProfileManager.h'), 'utf8');
    assert.match(pcbProfileHeader, /Bus\* buses = nullptr/);
    assert.match(pcbProfileHeader, /Device\* devices = nullptr/);
    assert.match(pcbProfileHeader, /Port\* ports = nullptr/);
    assert.doesNotMatch(pcbProfileHeader, /Port ports\[MAX_PORTS\]/,
      'small classic PCB profiles must not retain the maximum 48-port catalog allocation');
    const hardwareConfig = fs.readFileSync(path.join('src', 'system', 'HardwareConfig.cpp'), 'utf8');
    assert.match(hardwareConfig, /void writeCustomBlocks\(JsonObject doc\)/);
    assert.match(hardwareConfig, /void readCustomBlocks\(const JsonDocument& doc\)/);
    assert.match(hardwareConfig, /doc\["custom_blocks"\]/);
    assert.match(hardwareConfig, /strncmp\(name, "custom_", 7\) == 0\) return customBlockAvailable\(name\)/);
    const channelRegistry = fs.readFileSync(path.join('src', 'system', 'ChannelRegistry.h'), 'utf8');
    assert.match(channelRegistry, /bool forceSafeOnFault = false/);
    assert.match(channelRegistry, /if \(c\.forceSafeOnFault\) o\["force_safe_on_fault"\] = true/);
    assert.match(channelRegistry, /c\.forceSafeOnFault = o\["force_safe_on_fault"\] \| false/);
    const runtimeHardware = fs.readFileSync(path.join('src', 'Hardware.h'), 'utf8');
    assert.match(runtimeHardware, /if \(!ed\.faultShutdownActive\) return/);
    assert.match(runtimeHardware, /if \(!c\.installed \|\| !c\.forceSafeOnFault\) continue/);
    assert.match(runtimeHardware, /const float safe = core \? 0\.0f : constrain\(c\.safeDemand/);
    assert.match(runtimeHardware, /inline void updateActuators\(\) \{[\s\S]*applyFaultSafeOutputs\(\)/);
    assert.match(runtimeHardware, /if \(expo > 0\.0f\) \{[\s\S]*norm = norm \* \(1\.0f - expo\) \+ norm \* norm \* norm \* expo/,
      'maximum Throttle Expo (1.0) must still apply the cubic response curve');
    const abIgnite = fs.readFileSync(path.join('src', 'engine', 'sequencer', 'blocks', 'ABIgnite.h'), 'utf8');
    assert.match(abIgnite, /_useIgniterEff = useIgniter;\s*_hasIgnitionAction = _doTorch \|\| _useIgniterEff/);
    assert.doesNotMatch(abIgnite, /falling back to the fitted AB igniter/,
      'an unchecked AB igniter option must never energize the fitted igniter');
    assert.match(mainSource, /ed\.mode = SysMode::SHUTDOWN;\s*cutCombustionAndStarterNow\(\);\s*ed\.faultShutdownActive = true/);
    assert.match(mainSource, /Hardware::allOff\(\);\s*ed\.faultShutdownActive = false/);
    const webSource = fs.readFileSync(path.join('src', 'system', 'web', 'WebServer.cpp'), 'utf8');
    assert.match(webSource, /doc\["has_ab_flame"\]\s+=\s+HardwareConfig::hasAfterburner && HardwareConfig::hasAbFlame/);
    assert.match(webSource, /doc\["has_n2"\]\s+=\s+HardwareConfig::hasTwoShaft && HardwareConfig::hasN2Rpm/);
    assert.match(webSource, /doc\["has_glow_current"\]\s+=\s+HardwareConfig::hasGlowPlug && HardwareConfig::hasGlowCurrentSensor/);
    assert.match(webSource, /doc\["has_igniter_current"\]\s+=\s+HardwareConfig::hasIgniter && HardwareConfig::hasIgniterCurrentSensor/);
    assert.match(webSource, /doc\["has_igniter2_current"\]\s+=\s+HardwareConfig::hasIgniter2 && HardwareConfig::hasIgniter2CurrentSensor/);
    assert.match(webSource, /doc\["has_oil_pump_current"\]\s+=\s+HardwareConfig::hasOilPump && HardwareConfig::hasOilPumpCurrentSensor/);
    assert.match(webSource, /doc\["uptime_s"\]\s+=\s+ed\.uptimeMs \/ 1000;\s*doc\["boot_count"\]\s+=\s+ed\.bootCount/);
    assert.match(webSource, /doc\["config_storage_fault"\]\s+=\s+ed\.configStorageFault/);
    assert.match(webSource, /char lineBuf\[640\];[\s\S]*readBytesUntil\('\\n', lineBuf, sizeof\(lineBuf\) - 1\)/);
    assert.match(webSource, /JsonDocument doc;[\s\S]*char lineBuf\[640\];[\s\S]*deserializeJson\(doc, lineBuf\)/);
    const calibrationHtml = fs.readFileSync(path.join('data_src', 'calibration.html'), 'utf8');
    assert.match(calibrationHtml, /function hwAbFlameEnabled\(hw\) \{\s*return !!registryChannelByPurpose\(hw, 'inputs', 'ab_flame'\);/);
    const sequenceHtml = fs.readFileSync(path.join('data_src', 'sequence.html'), 'utf8');
    for (const tab of ['startup', 'shutdown', 'afterburner', 'ab-shut']) {
      assert.match(sequenceHtml, new RegExp(`openCustomBlockDialog\\('${tab}'\\)`));
    }
    assert.match(sequenceHtml, /const MAX_CUSTOM_BLOCKS = 8/);
    assert.match(sequenceHtml, /const MAX_CUSTOM_STEPS = 8/);
    assert.match(sequenceHtml, /const MAX_CUSTOM_KEY_LEN = 23/);
    assert.match(sequenceHtml, /validateCustomBlockLimits\(\)/);
    assert.match(sequenceHtml, /def\.type === 'wait' \? \[\]/);
    assert.match(sequenceHtml, /if \(type !== 'wait'\) rawDef\.steps/);
    assert.doesNotMatch(sequenceHtml, /id="rules-list"|Control Rules/);
    const controllersHtml = fs.readFileSync(path.join('data_src', 'controllers.html'), 'utf8');
    assert.match(controllersHtml, /Custom controllers/);
    assert.match(controllersHtml, /Hold a feedback target/);
    assert.match(controllersHtml, /one normal owner/i);
    assert.doesNotMatch(sequenceHtml, /Default:\s*AB(?:CheckReady|SolClose|PumpOn)/);
    assert.match(sequenceHtml, /Default: check readiness &rarr; open the AB fuel valve &rarr; start the AB fuel pump &rarr; ignite &rarr; confirm flame &rarr; stabilize/);
    assert.match(sequenceHtml, /Default: stop the AB fuel pump &rarr; close the AB fuel valve &rarr; turn the AB igniter off/);
    results.push('runtime safety guards cover zero limits, inactive EGT flameout, and stale auto-relight prerequisites');

    const indexHtml = fs.readFileSync(path.join('data_src', 'index.html'), 'utf8');
    assert.doesNotMatch(indexHtml, /20260612b|20260617b|20260619a|20260625a|20260705a|Primary thermal limit/);
    assert.doesNotMatch(indexHtml, />Not saved<|No calibration saved|No successful test recorded/);
    assert.match(indexHtml, /Run a safe actuator or dry-sequence test/);
    assert.match(indexHtml, /20260816q/);
    for (const pageName of ['index.html', 'hardware.html', 'controllers.html', 'system.html', 'calibration.html', 'sequence.html', 'log.html', 'tools.html']) {
      const pageSource = fs.readFileSync(path.join('data_src', pageName), 'utf8');
      const sharedRefs = [...pageSource.matchAll(/\/(?:style\.css|app\.js|theme\.js|ui_dialog\.js)\?v=([^"'&]+)/g)];
      assert.ok(sharedRefs.length > 0, `${pageName} must version its shared assets`);
      assert.ok(sharedRefs.every(match => match[1] === '20260816q'), `${pageName} has a stale shared-asset cache key`);
    }
    assert.match(indexHtml, /<body data-page="dashboard">/);
    assert.match(indexHtml, /id="profile-mismatch-banner" style="display:none"/);
    const appSource = fs.readFileSync(path.join('data_src', 'app.js'), 'utf8');
    assert.match(appSource, /let _lastBootCount = null/);
    assert.match(appSource, /nextUptime <= 5 && _lastUptimeS > 5/);
    assert.match(appSource, /bootChanged && usesGlobalTelemetry\(\)/);
    results.push('all pages use the current shared-asset cache key and selected-EGT tooltip');

    await page.goto(`${base}/generate_204`);
    await page.waitForSelector('#n1-card', { state: 'attached' });
    await page.evaluate(() => startTelemetryBoot());
    await page.waitForFunction(() => _restFallbackTimer !== null, null, {
      timeout: 3000
    });
    const portalBoot = await page.evaluate(() => {
      return {
        path: location.pathname,
        isLive: isLiveTelemetryPage(),
        isDashboard: isDashboardPage(),
        desiredPeriod: desiredPullPeriodMs(),
        restActive: _restFallbackTimer !== null
      };
    });
    assert.deepEqual(portalBoot, {
      path: '/generate_204',
      isLive: true,
      isDashboard: true,
      desiredPeriod: 333,
      restActive: true
    });
    results.push('captive portal dashboard entry starts the same compact telemetry path as /index.html');

    const webServer = fs.readFileSync(path.join('src', 'system', 'web', 'WebServer.cpp'), 'utf8');
    // Shared filenames are replaced in place by the maintenance updater, so
    // every navigation must revalidate CSS/JS instead of retaining an old
    // immutable copy under the same URL.
    assert.match(webServer, /max-age=31536000, immutable/);
    assert.match(webServer, /app\.js\.gz", "application\/javascript", SHARED_ASSET_CACHE/);
    assert.match(webServer, /style\.css\.gz", "text\/css", SHARED_ASSET_CACHE/);
    results.push('shared CSS and JavaScript are revalidated after maintenance updates');
    assert.match(webServer, /static void _mergeJsonObject\(JsonObject dst, JsonObjectConst patch\)/);
    assert.equal((webServer.match(/_mergeJsonObject\(current\.as<JsonObject>\(\), patch\.as<JsonObjectConst>\(\)\)/g) || []).length, 2);
    assert.doesNotMatch(webServer, /2-level deep merge/);
    results.push('firmware PATCH handlers use recursive JSON merge for nested objects');

    assert.match(webServer, /esp_app_get_description\(\)->app_elf_sha256/);
    assert.match(webServer, /for \(uint8_t i = 0; i < 8; \+\+i\)/);
    assert.match(webServer, /doc\["build_id"\] = buildId/);
    results.push('device identity exposes a per-build ELF fingerprint for exact firmware verification');

    assert.match(webServer, /#if defined\(OT_PLATFORM_ESP32S3\)[\s\S]*String writePath = _assetPath\(\(uint16_t\)asset, true\)/);
    assert.match(webServer, /String writePath = _assetPath\(\(uint16_t\)asset, false\)/);
    assert.match(webServer, /START inhibited until the complete set is uploaded again/);
    const toolsSource = fs.readFileSync(path.join('data_src', 'tools.html'), 'utf8');
    const webAssetOrder = toolsSource.match(/const required = \[([\s\S]*?)\];/);
    assert.ok(webAssetOrder);
    assert.ok(webAssetOrder[1].lastIndexOf("'tools.html.gz'") >
              webAssetOrder[1].lastIndexOf("'ui_dialog.js.gz'"));
    results.push('Classic web asset updates fit the bounded filesystem and upload the recovery page last');

    await reset(page);
    await page.goto(`${base}/index.html`);
    await page.waitForSelector('#n1-card', { state: 'attached' });
    const scenarios = ['full', 'startup', 'fault', 'minimal'];
    for (let i = 0; i < 240; i++) {
      const name = scenarios[i % scenarios.length];
      response = await page.request.post(`${base}/__sim/scenario/${name}`);
      assert.equal(response.ok(), true);
      if (i % 20 === 0) await page.waitForTimeout(120);
    }
    await page.waitForTimeout(750);
    const dashText = await page.locator('body').innerText();
    assert.match(dashText, /N1|TOT|STANDBY|RUNNING|FAULT/);
    results.push('dashboard survives repeated telemetry scenario changes during a short mock soak');

    assert.deepEqual(consoleErrors, [], 'browser console should stay free of errors');
    assert.deepEqual(badResponses, [], 'browser should not request missing app resources');
    console.log(`Beta release audit passed (${results.length} groups):`);
    for (const result of results) console.log(`- ${result}`);
  } finally {
    await browser.close();
  }
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
