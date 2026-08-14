#!/usr/bin/env node
// Deterministic public screenshots from the existing UI simulator. These never
// connect to a real ECU or include a user profile, password, path, or live run.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'site', 'assets', 'images');
const port = 11700 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const versionHeader = fs.readFileSync(path.join(root, 'src', 'system', 'version.h'), 'utf8');
const firmwareVersion = versionHeader.match(/#define\s+OT_VERSION\s+"([^"]+)"/)?.[1];
if (!firmwareVersion) throw new Error('Could not read OT_VERSION from src/system/version.h');

// A deliberately modest single-shaft example is more useful to a new user
// than the simulator's exhaustive all-features profile. Values are illustrative
// only and the captured UI is labelled as simulated.
async function installPublicExample(page) {
  const state = await (await page.request.get(`${base}/__sim/state`)).json();
  const hardware = state.hardware;
  const settings = state.settings;
  const keepInput = new Set(['n1_main', 'tot_main', 'oil_pressure_main', 'oil_temperature', 'battery_voltage', 'operator_throttle']);
  const keepOutput = new Set(['main_fuel', 'starter', 'oil_pump', 'fuel_shutoff', 'igniter', 'cooling_fan']);

  hardware.profile_id = 'public-single-shaft-example';
  hardware.profile_desc = 'Example single-shaft turbine';
  hardware.spi = { enabled: true, clk_pin: 18, miso_pin: 19, mosi_pin: -1 };
  hardware.i2c = { enabled: false, sda_pin: -1, scl_pin: -1, interrupt_pin: -1, frequency_hz: 400000 };
  hardware.channel_registry.inputs = hardware.channel_registry.inputs.filter(channel => keepInput.has(channel.id));
  hardware.channel_registry.outputs = hardware.channel_registry.outputs.filter(channel => keepOutput.has(channel.id));
  const inputPins = { n1_main: 34, tot_main: -1, oil_pressure_main: 32, oil_temperature: 33, battery_voltage: 35, operator_throttle: 4 };
  const outputPins = { main_fuel: 21, starter: 22, oil_pump: 23, fuel_shutoff: 25, igniter: 26, cooling_fan: 27 };
  hardware.channel_registry.inputs.forEach(channel => {
    channel.pin = inputPins[channel.id];
    if (channel.id === 'oil_temperature') Object.assign(channel, { temp_interface: 4, ntc_beta: 3950, ntc_r0: 10000, ntc_r_fixed: 10000 });
    if (channel.id === 'battery_voltage') channel.analog_divider = 4.7;
  });
  hardware.channel_registry.outputs.forEach(channel => { channel.pin = outputPins[channel.id]; });
  hardware.channel_registry.bindings = hardware.channel_registry.bindings.filter(binding =>
    ['primary_n1', 'primary_egt', 'operator_throttle', 'main_fuel_output', 'main_fuel_shutoff', 'main_starter'].includes(binding.key));
  hardware.controls = { stop_pin: 13, stop_active_h: false, stop_pullup: true, start_pin: 14, start_active_h: false, start_pullup: true };
  Object.keys(hardware.sensors).forEach(key => { hardware.sensors[key].enabled = false; });
  Object.assign(hardware.sensors, {
    n1_rpm: { enabled: true, pin: 34, ppr: 1 },
    tot: { enabled: true, chip: 'max31855', tc_type: 'K', clk: 18, cs: 5, miso: 19, mosi: -1 },
    oil_press: { enabled: true, pin: 32 },
    oil_temp: { enabled: true, chip: 'ntc', pin: 33, clk: -1, cs: -1, miso: -1, mosi: -1, tc_type: 'K', resolution: 12, ntc_beta: 3950, ntc_r0: 10000, ntc_r_fixed: 10000 },
    batt_voltage: { enabled: true, pin: 35, divider: 4.7 },
    throttle_input: { enabled: true, pin: 4, rc_pwm: true }
  });
  Object.keys(hardware.actuators).forEach(key => { hardware.actuators[key].enabled = false; });
  Object.assign(hardware.actuators, {
    throttle: { enabled: true, pin: 21, type: 0, min_us: 1000, max_us: 2000, inverted: false, ledc_freq: 50, ledc_bits: 16 },
    starter: { enabled: true, pin: 22, type: 0, min_us: 1000, max_us: 2000, inverted: false, ledc_freq: 50, ledc_bits: 16 },
    oil_pump: { enabled: true, pin: 23, type: 1, active_h: true, min_us: 1000, max_us: 2000, freq_hz: 5000, res_bits: 10, has_current: false, current_pin: -1 },
    fuel_sol: { enabled: true, pin: 25, active_h: true },
    igniter: { enabled: true, pin: 26, active_h: true, pwm: false, dwell_ms: 50, rest_ms: 100, coil: false, has_current: false, current_pin: -1 },
    cool_fan: { enabled: true, pin: 27, type: 1, active_h: true, min_us: 1000, max_us: 2000, freq_hz: 5000, res_bits: 10 }
  });
  hardware.controllers = { oil_loop: true, dynamic_idle: true, governor: false };
  hardware.safety = { overspeed: true, n2_overspeed: false, overtemp: true, low_oil: true, oil_zero: true, flameout: true, hot_start: true, oil_temp_high: true, fuel_press_low: false, batt_low: true, surge: false };
  hardware.startup_seq = ['OilPrime', 'StarterSpin', 'IgniterOn', 'FuelOpen', 'TempConfirm', 'IgniterOff', 'Spool', 'SafetyHold'];
  hardware.startup_delay_ms = [0, 0, 0, 0, 0, 0, 0, 0];
  hardware.shutdown_seq = ['ImmediateCut', 'RPMDrop', 'CooldownSpin', 'FinalStop'];
  hardware.shutdown_delay_ms = [0, 0, 0, 0];
  hardware.cluster_serial.enabled = false;
  hardware.mavlink.enabled = false;
  hardware.buzzer.enabled = false;
  hardware.di_channels = [];

  settings.profile_id = hardware.profile_id;
  Object.assign(settings.engine, { rpm_limit: 100000, n2_rpm_limit: 0, min_rpm: 45000, tot_limit: 720, tot_cooldown_target: 110, tot_safe_margin: 40 });
  Object.assign(settings.oil, { startup_pressure: 1.8, startup_min_bar: 1.2, running_min: 1.4, map_min: 2.0, map_max: 3.0, use_throttle_map: true, adjust_scale: 0.08, min_pct: 18, failsafe_delay_ms: 500, failsafe_pct: 55 });
  Object.assign(settings.throttle, { ramp_up_ms: 1800, ramp_down_ms: 700, fuel_pump_min_pct: 12, idle_max_pct: 28, expo: 0.7 });
  Object.assign(settings.dynamic_idle, { source: 0, target_rpm: 58000, deadband_rpm: 400, rpm_limit: 68000, i_gain: 0.08, i_max: 0.12 });
  Object.assign(settings.sequence.startup, { pre_ign_rpm: 8000, starter_demand: 0.5, starter_timeout_ms: 12000, temp_confirm_target: 120, temp_confirm_timeout: 7000, rpm_target: 50000, rpm_timeout_ms: 18000, safety_hold_ms: 3000, final_check_rpm: 48000 });
  Object.assign(settings.sequence.shutdown, { rpm_drop_threshold: 8000, rpm_drop_timeout_ms: 20000, cooldown_timeout_ms: 60000, cooldown_use_starter: true, cooldown_use_oil: true, cooldown_starter_pct: 10, cooldown_oil_pct: 30 });
  Object.assign(settings.safety, { check_interval_ms: 20, flameout_shutdown_ms: 1200, flameout_egt_below_c: 300, flameout_egt_fall_rate_c_s: 50, oil_temp_limit_c: 110, batt_volt_min_v: 10.8 });
  settings.relight.enabled = false;
  settings.rules = [{ enabled: true, name: 'Oil cooling fan', kind: 0, sensor: 0, source: 'oil_temp', op: 0, threshold: 85, hysteresis: 5,
    actuator: 0, target: '', on_value: 1, off_value: 0, input_min: 0, input_max: 1, output_min: 0, output_max: 1, mode_mask: 4 }];

  await page.request.post(`${base}/api/ecu_config`, { data: { hardware, settings } });
}

async function setRunState(page, patch = {}) {
  await page.request.post(`${base}/__sim/scenario/full`);
  await page.request.post(`${base}/__sim/data`, { data: {
    mode: 'RUNNING', fw_version: firmwareVersion, uptime_s: 847, last_event: 'RUNNING',
    n1: 58200, n2: 0, n1_rpm_accel: 120, n2_rpm_accel: 0, tot: 592, oil: 2.35, oil_temp: 74, batt_voltage: 12.4,
    throttle_demand: 0.36, throttle_input_us: 1360, throttle_input_norm: 0.36, rc_throttle_norm: 0.36,
    oil_demand: 2.3, oil_pct: 41, flame: true, max_n1: 61400, max_tot: 628, max_oil_temp: 76,
    rpm_limit: 100000, tot_limit: 720, egt_limit: 720, oil_running_min: 1.4, oil_temp_limit: 110,
    idle_target_rpm: 58000, dynamic_idle_enabled: true, relight_enabled: false, relight_armed: false,
    has_n1: true, has_n2: false, has_tot: true, has_tit: false, has_oil_press: true, has_oil_temp: true,
    has_batt_voltage: true, has_throttle: true, has_oil_pump: true, has_oil_loop: true, has_dynamic_idle: true,
    has_starter: false, has_starter_en: false, has_fuel_sol: false, has_igniter: false, has_igniter2: false,
    has_flame: false, has_p1: false, has_p2: false, has_torque: false, has_thrust: false, has_fuel_press: false, has_fuel_flow: false,
    has_governor: false, has_afterburner: false, has_ab_flame: false, has_glow_plug: false, has_fuel_pump2: false,
    has_prop_pitch: false, has_airstarter: false, has_oil_scavenge: false, has_bleed_valve: false, has_cool_fan: false,
    has_glow_current: false, has_igniter_current: false, has_igniter2_current: false, has_oil_pump_current: false,
    glow_current_amps: 0, igniter_current_amps: 0, igniter2_current_amps: 0, oil_pump_current_amps: 0,
    cool_fan_on: false, bench_mode: false, dev_mode: false,
    labels: { n1: 'N1', n2: 'N2', tot: 'TOT', oil_press: 'Oil Press', oil_temp: 'Oil Temp' },
    registry_inputs: [], registry_outputs: [], di_channels: [],
    ...patch
  } });
}

function installedBrowser() {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function prepare(page) {
  await page.goto(`${base}/index.html`);
  await page.evaluate(() => {
    localStorage.setItem('ot_beta_notice_ack_v1', '1');
    localStorage.setItem('ot_theme_onboarded_v1', '1');
    localStorage.setItem('ot_gs_dismissed', '1');
    localStorage.setItem('ot_theme', 'carbon');
    localStorage.setItem('ot_units', JSON.stringify({ temp: 'C', press: 'bar' }));
  });
  await page.reload();
  await installPublicExample(page);
  await setRunState(page);
}

async function capture(page, route, file, selector, scrollToSelector = false) {
  await page.goto(`${base}/${route}`);
  await page.waitForSelector(selector);
  // Dashboard gauges animate from zero. Capture only after their displayed
  // width has caught up with the already-updated numeric value.
  await page.waitForTimeout(450);
  if (scrollToSelector) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -72));
  }
  await page.screenshot({ path: path.join(output, file), type: 'png' });
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  globalThis.OT_UI_SIM_PORT = port;
  await import('./ui_mock_server.mjs');
  const executablePath = installedBrowser();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1050 }, deviceScaleFactor: 1 });
    await prepare(page);
    await capture(page, 'index.html', 'hero-dashboard.png', '#n1-card');
    await setRunState(page, { mode: 'STANDBY', last_event: 'STANDBY', uptime_s: 0, n1: 0, tot: 24, oil: 0, oil_raw: 500, oil_temp: 24, throttle_demand: 0, throttle_input_us: 1000, throttle_input_norm: 0, rc_throttle_norm: 0, idle_input_type: 'none', idle_input_us: 0, oil_pct: 0, flame: false });
    await capture(page, 'hardware.html', 'hardware-page.png', '#hardware-inputs-panel', true);
    await capture(page, 'config.html', 'config-page.png', '#cfg-form');
    await capture(page, 'calibration.html', 'calibration-page.png', '#throttle-cal-row');
    await capture(page, 'sequence.html', 'sequence-page.png', '#list-startup');
    await setRunState(page, { oil_temp: 88, cool_fan_on: true });
    await page.goto(`${base}/sequence.html`);
    await page.getByRole('button', { name: 'Control Rules' }).click();
    await page.waitForSelector('#rules-list');
    await page.screenshot({ path: path.join(output, 'control-rules-page.png'), type: 'png' });
    await setRunState(page, { mode: 'STANDBY', last_event: 'STANDBY', uptime_s: 0, n1: 0, tot: 24, oil: 0, oil_raw: 500, oil_temp: 24, throttle_demand: 0, throttle_input_us: 1000, throttle_input_norm: 0, rc_throttle_norm: 0, idle_input_type: 'none', idle_input_us: 0, oil_pct: 0, flame: false });
    await capture(page, 'tools.html', 'tools-page.png', '#tool-area');
    const heroData = fs.readFileSync(path.join(output, 'hero-dashboard.png')).toString('base64');
    const social = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
    await social.setContent(`<!doctype html><style>body{margin:0;background:#0c1218;color:#eef4f8;font:700 48px Arial,sans-serif;overflow:hidden}.copy{position:absolute;z-index:1;left:72px;top:104px;width:580px}.copy p{font-size:26px;line-height:1.35;color:#c8d3dd;font-weight:400}.rule{width:88px;height:7px;background:#ff6a00;margin-bottom:30px}.shot{position:absolute;right:-85px;bottom:-95px;width:760px;border:2px solid #354553;border-radius:18px;transform:rotate(-3deg);box-shadow:0 30px 80px #000}</style><div class="copy"><div class="rule"></div>OpenTurbine<p>Open-source turbine ECU for ESP32</p></div><img class="shot" src="data:image/png;base64,${heroData}"></html>`);
    await social.screenshot({ path: path.join(output, 'social-preview.png'), type: 'png' });
  } finally {
    await browser.close();
  }
  console.log(`Captured public UI screenshots in ${output}`);
  process.exit(0);
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
