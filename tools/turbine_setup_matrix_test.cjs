const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const port = 8767;
const base = `http://127.0.0.1:${port}`;
const BAD_VISIBLE_INTERNAL = /\b(operator_thrott|operator_throttle|user_throttle|generic_pwm_output|generic_pwm_duty_input|main_fuel_output|primary_n1|primary_egt|faultDemand|Fault demand|Semantic role|Binding key|undefined)\b/i;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function merge(target, patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
      merge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
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

async function api(method, pathName, body) {
  const response = await fetch(`${base}${pathName}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  assert.equal(response.ok, true, `${method} ${pathName} failed: ${text}`);
  return parsed;
}

async function assertVisibleTextClean(page, context) {
  const text = await page.evaluate(() => document.body.innerText || '');
  const match = text.match(BAD_VISIBLE_INTERNAL);
  assert.ok(!match, `${context} exposes internal implementation label: ${match ? match[0] : ''}`);
}

const regIn = (id, name, purpose, role, driver, pin, extra = {}) => ({
  installed: true, id, name, purpose, role, driver, pin,
  min: driver === 1 ? 0 : driver === 3 ? 1000 : 0,
  max: driver === 1 ? 4095 : driver === 3 ? 2000 : 1,
  ...extra
});

const regOut = (id, name, purpose, role, driver, pin, extra = {}) => ({
  installed: true, id, name, purpose, role, driver, pin,
  min: driver === 6 ? 1000 : 0,
  max: driver === 6 ? 2000 : 1,
  safe_demand: 0,
  pwm_freq_hz: driver === 5 ? 5000 : undefined,
  pwm_res_bits: driver === 5 ? 10 : undefined,
  ...extra
});

const baseRegistry = {
  inputs: [
    regIn('operator_throttle', 'Throttle Input', 'throttle', 'operator', 1, 32),
    regIn('operator_idle', 'Idle Input', 'idle', 'operator', 1, 33)
  ],
  outputs: [
    regOut('main_fuel', 'Main Fuel Pump', 'main_fuel', 'fuel', 6, 21),
    regOut('oil_pump_main', 'Oil Pump', 'oil_pump', 'oil_pump', 5, 23),
    regOut('igniter', 'Igniter', 'igniter', 'igniter', 4, 0)
  ],
  bindings: [
    { key: 'operator_throttle', channel: 'operator_throttle' },
    { key: 'main_fuel_output', channel: 'main_fuel' }
  ]
};

const setups = [
  {
    id: 'minimal_timer_turbojet',
    title: 'Minimal timer turbojet',
    hardware: {
      has_afterburner: false, has_two_shaft: false,
      sensors: { n1_rpm: { enabled: false }, tot: { enabled: false }, oil_press: { enabled: false }, flame: { enabled: false }, throttle_input: { enabled: true, rc_pwm: false }, idle_input: { enabled: true, rc_pwm: false } },
      actuators: { throttle: { enabled: true, type: 0 }, oil_pump: { enabled: true, type: 1, freq_hz: 5000, res_bits: 10 }, igniter: { enabled: true, pwm: false }, starter: { enabled: false }, fuel_sol: { enabled: false } },
      controllers: { oil_loop: false, dynamic_idle: false, governor: false },
      safety: { overspeed: false, overtemp: false, low_oil: false, oil_zero: false, flameout: false, hot_start: false },
      channel_registry: baseRegistry
    },
    config: { calibration: { throttle_min_raw: 220, throttle_max_raw: 3900, idle_min_raw: 260, idle_max_raw: 3600 }, throttle: { fuel_pump_min_pct: 9 } },
    commands: [{ cmd: 'OIL_PRIME' }, { cmd: 'IGN_TEST' }]
  },
  {
    id: 'sensored_single_shaft',
    title: 'Single-shaft with PCNT N1, TOT and oil loop',
    hardware: {
      has_afterburner: false, has_two_shaft: false,
      sensors: { n1_rpm: { enabled: true, pin: 34 }, tot: { enabled: true, chip: 'max31855' }, oil_press: { enabled: true }, flame: { enabled: true } },
      actuators: { starter: { enabled: true, type: 5 }, fuel_sol: { enabled: true }, oil_pump: { enabled: true, type: 1, freq_hz: 5000 } },
      controllers: { oil_loop: true, dynamic_idle: true, governor: false },
      safety: { overspeed: true, overtemp: true, low_oil: true, oil_zero: true, flameout: true, hot_start: true },
      channel_registry: merge(clone(baseRegistry), {
        inputs: [regIn('n1_main', 'N1 Speed', 'n1_speed', 'speed', 2, 34, { pulses_per_unit: 1 }), regIn('tot_main', 'Main TOT', 'tot', 'temperature', 1, -1, { temp_interface: 2, spi_clk: 18, spi_cs: 5, spi_miso: 19 }), regIn('oil_pressure_main', 'Oil Pressure', 'oil_pressure', 'pressure', 1, 32)],
        outputs: [regOut('starter', 'Starter', 'starter', 'starter', 5, 22), regOut('fuel_shutoff', 'Fuel Shutoff', 'fuel_shutoff', 'fuel_shutoff', 4, 2)]
      })
    },
    config: { engine: { rpm_limit: 98000, tot_limit: 730 }, oil: { running_min: 1.4, min_pct: 12 } },
    commands: [{ cmd: 'START_TEST' }, { cmd: 'FUEL_SOL_TEST' }, { cmd: 'OIL_PRIME' }]
  },
  {
    id: 'rc_pwm_generic_rules',
    title: 'RC operator input plus generic automation I/O',
    hardware: {
      sensors: { throttle_input: { enabled: true, rc_pwm: true }, idle_input: { enabled: true, rc_pwm: true } },
      channel_registry: merge(clone(baseRegistry), {
        inputs: [
          regIn('operator_throttle', 'operator_thrott', 'throttle', 'operator', 3, 4),
          regIn('generic_pwm_duty_input', 'PWM Duty Input', 'generic', 'generic', 7, 18, { invert: true })
        ],
        outputs: [regOut('generic_pwm_output', 'Telemetry Fan', 'generic', 'generic', 5, 25)]
      })
    },
    config: { calibration: { throttle_min_raw: 1040, throttle_max_raw: 1890 }, rules: [{ enabled: true, name: 'Generic input to fan', kind: 0, source: 'generic_pwm_duty_input', op: 0, threshold: 0.5, hysteresis: 0.05, target: 'generic_pwm_output', on_value: 1, off_value: 0, input_min: 0, input_max: 1, output_min: 0, output_max: 1, mode_mask: 4 }] },
    commands: [{ cmd: 'TOGGLE_DYNAMIC_IDLE' }]
  },
  {
    id: 'free_turbine_governor',
    title: 'Free turbine with N2 governor and servo prop pitch',
    hardware: {
      has_two_shaft: false,
      sensors: { n1_rpm: { enabled: true }, n2_rpm: { enabled: true }, tot: { enabled: true } },
      actuators: { prop_pitch: { enabled: true, type: 0, min_us: 980, max_us: 2020 }, throttle: { enabled: true, type: 0 } },
      controllers: { governor: true, dynamic_idle: true },
      channel_registry: merge(clone(baseRegistry), {
        inputs: [regIn('n1_main', 'N1 Speed', 'n1_speed', 'speed', 2, 34), regIn('n2_main', 'N2 Speed', 'n2_speed', 'speed', 2, 35), regIn('tot_main', 'TOT', 'tot', 'temperature', 1, -1, { temp_interface: 2, spi_clk: 18, spi_cs: 5, spi_miso: 19 })],
        outputs: [regOut('prop_pitch', 'Prop Pitch', 'prop_pitch', 'prop_pitch', 6, 16)]
      })
    },
    config: { governor: { target_rpm: 25500, pitch_idle_deg: 4, pitch_max_deg: 34 }, calibration: { throttle_min_raw: 1000, throttle_max_raw: 2000 } },
    commands: [{ cmd: 'PROP_PITCH_TEST', fParam: 0.42 }]
  },
  {
    id: 'turboprop_pwm_pitch_coolant',
    title: 'Turboprop with PWM prop pitch and coolant pump',
    hardware: {
      has_two_shaft: false,
      sensors: { n1_rpm: { enabled: true }, n2_rpm: { enabled: true }, oil_temp: { enabled: true, chip: 'ds18b20', pin: 15 } },
      actuators: { prop_pitch: { enabled: true, type: 1, freq_hz: 5000, res_bits: 10 }, cool_fan: { enabled: true, type: 1, freq_hz: 5000 } },
      channel_registry: merge(clone(baseRegistry), {
        inputs: [regIn('coolant_temperature', 'Coolant Temp', 'coolant_temp', 'temperature', 1, 15, { temp_interface: 5 })],
        outputs: [regOut('coolant_pump', 'Coolant Pump', 'coolant_pump', 'coolant_pump', 5, 26), regOut('prop_pitch', 'Prop Pitch', 'prop_pitch', 'prop_pitch', 5, 16)]
      })
    },
    config: { rules: [{ enabled: true, name: 'Coolant pump above 70C', kind: 0, source: 'coolant_temperature', op: 0, threshold: 70, hysteresis: 5, target: 'coolant_pump', on_value: 0.8, off_value: 0, input_min: 0, input_max: 1, output_min: 0, output_max: 1, mode_mask: 4 }] },
    commands: [{ cmd: 'PROP_PITCH_TEST', fParam: 0.55 }]
  },
  {
    id: 'afterburning_turbojet',
    title: 'Afterburner with arm switch, AB pump and AB igniter',
    hardware: {
      has_afterburner: false,
      sensors: { n1_rpm: { enabled: true }, tot: { enabled: true }, flame: { enabled: true } },
      actuators: { ab_sol: { enabled: true }, ab_pump: { enabled: true, type: 1, freq_hz: 5000 }, igniter2: { enabled: true, coil: true, has_current: true } },
      ab_trigger: { source: 3, input_pin: 32, input_rc_pwm: true, input_threshold: 2600, requires_arm: true, arm_pin: 33 },
      channel_registry: merge(clone(baseRegistry), {
        inputs: [regIn('ab_arm', 'AB Arm', 'ab_arm', 'ab_arm', 0, 33, { active_high: false, pullup: true })],
        outputs: [regOut('ab_pump', 'AB Pump', 'ab_pump', 'ab_pump', 5, 13), regOut('ab_igniter', 'AB Igniter', 'ab_igniter', 'ab_igniter', 5, 1)]
      })
    },
    config: { afterburner: { min_n1: 48000, pump_min_pct: 20, pump_max_pct: 78, flame_timeout_ms: 3500 } },
    commands: [{ cmd: 'AB_PUMP_TEST', fParam: 0.4 }, { cmd: 'IGN2_TEST' }]
  },
  {
    id: 'air_start_pilot_purge',
    title: 'Air start with pilot gas and purge valves',
    hardware: {
      actuators: { airstarter_sol: { enabled: true }, starter: { enabled: false }, fuel_sol: { enabled: true }, glow_plug: { enabled: true, has_current: true } },
      channel_registry: merge(clone(baseRegistry), {
        outputs: [regOut('air_starter', 'Air Starter', 'air_starter', 'starter', 4, 26), regOut('pilot_fuel', 'Pilot Gas', 'pilot_fuel', 'valve', 4, 27), regOut('purge_valve', 'Purge Valve', 'purge_valve', 'valve', 4, 14)]
      })
    },
    config: { glow_plug: { preheat_ms: 2200, preheat_max_pct: 65, hold_pct: 25 }, sequence: { startup: { preheat_ms: 2200 } } },
    commands: [{ cmd: 'AIRSTARTER_TEST' }, { cmd: 'GLOW_TEST', fParam: 0.5 }]
  },
  {
    id: 'dwell_igniter_wet_glow',
    title: 'Dwell igniter plus wet glow plug',
    hardware: {
      actuators: { igniter: { enabled: true, pwm: true, dwell_ms: 6, rest_ms: 4, coil: true, has_current: true, current_pin: 12 }, glow_plug: { enabled: true, has_current: true, wet: true } },
      channel_registry: merge(clone(baseRegistry), {
        outputs: [regOut('igniter', 'Dwell Igniter', 'igniter', 'igniter', 5, 0, { has_current: true, current_pin: 12 }), regOut('glow_plug', 'Wet Glow Plug', 'glow_plug', 'glow_plug', 5, 17, { has_current: true, current_pin: 36 })]
      })
    },
    config: { glow_plug: { wait_until_hot: true, preheat_ms: 2500 }, misc: { igniter_on_start: true } },
    commands: [{ cmd: 'IGN_TEST' }, { cmd: 'GLOW_TEST', fParam: 0.65 }]
  },
  {
    id: 'oil_switch_safety_only',
    title: 'Oil safety switches without analog pressure',
    hardware: {
      sensors: { oil_press: { enabled: false } },
      safety: { low_oil: true, oil_zero: true, overtemp: false, overspeed: false, flameout: false },
      controllers: { oil_loop: false },
      channel_registry: merge(clone(baseRegistry), {
        inputs: [regIn('low_oil_switch', 'Low Oil Switch', 'low_oil_switch', 'low_oil_switch', 0, 18, { active_high: false, pullup: true }), regIn('oil_zero_switch', 'Zero Oil Switch', 'oil_zero_switch', 'oil_zero_switch', 0, 19, { active_high: false, pullup: true })]
      })
    },
    config: { oil: { running_min: 0, min_pct: 18 } },
    commands: [{ cmd: 'OIL_PRIME' }]
  },
  {
    id: 'analog_rpm_and_servo_enable',
    title: 'Analog RPM converter with servo starter enable',
    hardware: {
      sensors: { n1_rpm: { enabled: false }, n2_rpm: { enabled: true } },
      actuators: { starter_en: { enabled: true }, starter: { enabled: true, type: 1, freq_hz: 5000 }, oil_pump: { enabled: true, has_current: true, current_pin: 12 } },
      channel_registry: merge(clone(baseRegistry), {
        inputs: [regIn('n1_main', 'N1 Analog RPM', 'n1_speed', 'speed', 1, 32, { analog_zero_mv: 0, analog_mv_per_unit: 0.033, min: 0, max: 4095 })],
        outputs: [regOut('starter_enable', 'Starter Enable Servo', 'starter_enable', 'starter_en', 6, 22), regOut('starter', 'Starter PWM', 'starter', 'starter', 5, 23), regOut('oil_pump_main', 'Oil Pump', 'oil_pump', 'oil_pump', 5, 24, { has_current: true, current_pin: 12 })]
      })
    },
    config: { starter_control: { pulsed_assist_enabled: true, pulsed_assist_pwm_pct: 18, pulsed_assist_until_rpm: 21000, pulsed_assist_on_ms: 500, pulsed_assist_off_ms: 250 }, calibration: { p1_raw_min: 200, p1_raw_max: 3800 } },
    commands: [{ cmd: 'START_TEST', fParam: 0.35 }]
  },
  {
    id: 'fuel_governed_generator',
    title: 'Generator or turboshaft with N2 commanding fuel',
    hardware: {
      sensors: { n1_rpm: { enabled: true }, n2_rpm: { enabled: true }, tot: { enabled: true } },
      actuators: { throttle: { enabled: true, type: 0 }, prop_pitch: { enabled: false } },
      controllers: { governor: true, dynamic_idle: false },
      safety: { overspeed: true, n2_overspeed: true, overtemp: true },
      channel_registry: {
        version: 1,
        inputs: [
          regIn('n1_main', 'N1 Speed', 'n1_speed', 'speed', 2, 34),
          regIn('n2_main', 'Generator Speed', 'n2_speed', 'speed', 2, 35),
          regIn('tot_main', 'Main TOT', 'tot', 'temperature', 1, -1,
            { temp_interface: 2, spi_clk: 18, spi_cs: 5, spi_miso: 19 })
        ],
        outputs: [regOut('main_fuel', 'Main Fuel Pump', 'main_fuel', 'fuel', 6, 21)],
        bindings: [
          { key: 'primary_n1', channel: 'n1_main' },
          { key: 'primary_n2', channel: 'n2_main' },
          { key: 'primary_egt', channel: 'tot_main' },
          { key: 'main_fuel_output', channel: 'main_fuel' }
        ]
      }
    },
    config: {
      engine: { rpm_limit: 90000, n2_rpm_limit: 32000, tot_limit: 700 },
      governor: { target_rpm: 28000, band_rpm: 300, kp: 0.0002, pitch_kp: 0 },
      throttle: { fuel_pump_min_pct: 12 }
    },
    commands: [{ cmd: 'IDLE_TEST' }]
  },
  {
    id: 'n2_idle_turboshaft',
    title: 'Free-turbine installation using N2 for automatic idle',
    hardware: {
      sensors: { n1_rpm: { enabled: true }, n2_rpm: { enabled: true }, tot: { enabled: true } },
      actuators: { throttle: { enabled: true, type: 0 } },
      controllers: { governor: false, dynamic_idle: true },
      safety: { overspeed: true, n2_overspeed: true, overtemp: true },
      channel_registry: {
        version: 1,
        inputs: [
          regIn('n1_main', 'N1 Speed', 'n1_speed', 'speed', 2, 34),
          regIn('n2_main', 'N2 Speed', 'n2_speed', 'speed', 2, 35),
          regIn('tot_main', 'Main TOT', 'tot', 'temperature', 1, -1,
            { temp_interface: 2, spi_clk: 18, spi_cs: 5, spi_miso: 19 })
        ],
        outputs: [regOut('main_fuel', 'Main Fuel Pump', 'main_fuel', 'fuel', 6, 21)],
        bindings: [
          { key: 'primary_n1', channel: 'n1_main' },
          { key: 'primary_n2', channel: 'n2_main' },
          { key: 'primary_egt', channel: 'tot_main' },
          { key: 'main_fuel_output', channel: 'main_fuel' }
        ]
      }
    },
    config: {
      engine: { rpm_limit: 90000, n2_rpm_limit: 30000, tot_limit: 700 },
      dynamic_idle: { source: 1, target_rpm: 9000, deadband_rpm: 250, rpm_limit: 14000 },
      throttle: { fuel_pump_min_pct: 10, idle_max_pct: 38 }
    },
    commands: [{ cmd: 'TOGGLE_DYNAMIC_IDLE' }]
  },
  {
    id: 'pressure_torque_protected_test_turbine',
    title: 'Instrumented development turbine with P1, P2 and torque fuel protection',
    hardware: {
      sensors: { n1_rpm: { enabled: true }, tot: { enabled: true }, p1: { enabled: true }, p2: { enabled: true }, torque: { enabled: true } },
      actuators: { throttle: { enabled: true, type: 0 } },
      controllers: { dynamic_idle: false, governor: false },
      safety: { overspeed: true, overtemp: true },
      channel_registry: {
        version: 1,
        inputs: [
          regIn('n1_main', 'N1 Speed', 'n1_speed', 'speed', 2, 34),
          regIn('tot_main', 'Main TOT', 'tot', 'temperature', 1, -1,
            { temp_interface: 2, spi_clk: 18, spi_cs: 5, spi_miso: 19 }),
          regIn('p1_main', 'Compressor Inlet P1', 'p1_pressure', 'pressure', 1, 32),
          regIn('p2_main', 'Compressor Outlet P2', 'p2_pressure', 'pressure', 1, 33),
          regIn('torque_main', 'Output Shaft Torque', 'torque', 'torque', 10, -1,
            { i2c_address: 42, device_channel: 0, load_cell_gain: 128, load_cell_rate: 80 })
        ],
        outputs: [regOut('main_fuel', 'Main Fuel Pump', 'main_fuel', 'fuel', 6, 21)],
        bindings: [
          { key: 'primary_n1', channel: 'n1_main' },
          { key: 'primary_egt', channel: 'tot_main' },
          { key: 'main_fuel_output', channel: 'main_fuel' }
        ]
      }
    },
    config: {
      safety: { p1_trip_bar: 2.2, p2_trip_bar: 4.8, torque_trip_nm: 90 },
      throttle: {
        pullback_p1: true, pullback_p1_soft_bar: 1.7, pullback_p1_hard_bar: 2.0,
        pullback_p2: true, pullback_p2_soft_bar: 3.8, pullback_p2_hard_bar: 4.4,
        pullback_torque: true, pullback_torque_soft_nm: 70, pullback_torque_hard_nm: 82,
        pullback_min_pct: 15, rpm_limiter_mode: 1
      }
    },
    commands: [{ cmd: 'SET_THROTTLE_PCT', fParam: 0.6 }]
  },
  {
    id: 'dual_egt_research_turbine',
    title: 'Development turbine using TIT as the primary gas-temperature limit',
    hardware: {
      sensors: { n1_rpm: { enabled: true }, tot: { enabled: true }, tit: { enabled: true } },
      actuators: { throttle: { enabled: true, type: 0 } },
      controllers: {},
      safety: { overspeed: true, overtemp: true, hot_start: true },
      channel_registry: {
        version: 1,
        inputs: [
          regIn('n1_main', 'N1 Speed', 'n1_speed', 'speed', 2, 34),
          regIn('tot_main', 'Outlet Temperature', 'tot', 'temperature', 1, -1,
            { temp_interface: 2, spi_clk: 18, spi_cs: 5, spi_miso: 19 }),
          regIn('tit_main', 'Turbine Inlet Temperature', 'tit', 'temperature', 1, -1,
            { temp_interface: 2, spi_clk: 18, spi_cs: 17, spi_miso: 19 })
        ],
        outputs: [regOut('main_fuel', 'Main Fuel Pump', 'main_fuel', 'fuel', 6, 21)],
        bindings: [
          { key: 'primary_n1', channel: 'n1_main' },
          { key: 'primary_egt', channel: 'tit_main' },
          { key: 'main_fuel_output', channel: 'main_fuel' }
        ]
      }
    },
    config: { safety: { egt_source: 2, tit_limit_c: 980, startup_egt_limit_c: 1050 }, engine: { tot_limit: 720 } },
    commands: [{ cmd: 'SET_THROTTLE_PCT', fParam: 0.35 }]
  },
  {
    id: 'windmilling_oil_free_turbine',
    title: 'Free turbine with fixed-output windmilling oil protection',
    hardware: {
      sensors: { n1_rpm: { enabled: false }, n2_rpm: { enabled: true }, oil_press: { enabled: false } },
      actuators: { throttle: { enabled: true, type: 0 }, oil_pump: { enabled: true, type: 1, freq_hz: 5000 } },
      controllers: { oil_loop: false, dynamic_idle: false, governor: false },
      channel_registry: {
        version: 1,
        inputs: [regIn('n2_main', 'Free Turbine Speed', 'n2_speed', 'speed', 2, 35)],
        outputs: [
          regOut('main_fuel', 'Main Fuel Pump', 'main_fuel', 'fuel', 6, 21),
          regOut('oil_pump_main', 'Oil Pump', 'oil_pump', 'oil_pump', 5, 23)
        ],
        bindings: [
          { key: 'primary_n2', channel: 'n2_main' },
          { key: 'main_fuel_output', channel: 'main_fuel' }
        ]
      }
    },
    config: { standby_oil: { source: 1, rpm_limit: 600, feed_pct: 35, feed_bar: 0 } },
    commands: [{ cmd: 'OIL_PRIME' }]
  },
  {
    id: 'dry_sump_flow_monitored_turbine',
    title: 'Dry-sump turbine with two oil-flow monitors and drain valve',
    hardware: {
      sensors: { oil_press: { enabled: false } },
      actuators: {
        oil_pump: { enabled: true, type: 1, freq_hz: 5000 },
        oil_scavenge_pump: { enabled: true, type: 1, freq_hz: 5000 }
      },
      channel_registry: {
        version: 2,
        inputs: [
          regIn('oil_flow', 'Main Oil Flow', 'oil_flow', 'flow', 2, 34, { pulses_per_unit: 900 }),
          regIn('scavenge_flow', 'Scavenge Flow', 'scavenge_flow', 'flow', 9, -1,
            { i2c_address: 16, device_channel: 1, analog_zero_mv: 500, analog_mv_per_unit: 1000 })
        ],
        outputs: [
          regOut('oil_pump_main', 'Oil Pump', 'oil_pump', 'oil_pump', 5, 23,
            { has_flow_monitor: true, minimum_flow_l_min: 0.35 }),
          regOut('scavenge_pump', 'Scavenge Pump', 'scavenge_pump', 'scavenge_pump', 5, 26,
            { has_flow_monitor: true, minimum_flow_l_min: 0.25 }),
          regOut('drain_valve', 'Drain Valve', 'drain_valve', 'valve', 11, -1,
            { i2c_address: 32, device_channel: 7, invert: true })
        ],
        bindings: []
      }
    },
    config: { oil_advanced: { pump_underflow_delay_ms: 3000, shutdown_on_underflow: true } },
    commands: []
  }
];

(async () => {
  globalThis.OT_UI_SIM_PORT = port;
  await import('./ui_mock_server.mjs');
  const browser = await chromium.launch({ headless: true, ...(installedBrowser() ? { executablePath: installedBrowser() } : {}) });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const results = [];

  try {
    for (const setup of setups) {
      let extraToolCommands = 0;
      await api('POST', '/__sim/reset');
      const state = await api('GET', '/__sim/state');
      const hardware = merge(clone(state.hardware), setup.hardware);
      const settings = merge(clone(state.settings), setup.config);
      hardware.profile_id = setup.id;
      hardware.profile_desc = setup.title;
      settings.profile_id = setup.id;
      await api('POST', '/api/ecu_config', { hardware, settings });

      if (setup.id === 'rc_pwm_generic_rules') {
        await api('POST', '/__sim/data', {
          registry_outputs: [{ id: 'generic_pwm_output', name: 'Telemetry Fan', purpose: 'generic', role: 'generic', driver: 5, min: 0, max: 1, demand: 0.42 }]
        });
      }
      await page.goto(`${base}/hardware.html#${setup.id}`);
      await page.waitForFunction(() => /Loaded|Converted/i.test(document.querySelector('#save-msg')?.textContent || ''));
      await assertVisibleTextClean(page, `${setup.id} hardware`);
      if (setup.id === 'minimal_timer_turbojet') {
        const mainFuelUsage = await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('#registry-outputs .registry-card'));
          const card = cards.find(card => /^Main Fuel Pump$/i.test((card.querySelector('strong')?.textContent || '').trim()));
          return card ? card.innerText : '';
        });
        assert.match(mainFuelUsage, /Controller: fuel response & limit protection/, 'main fuel should name its automatic protection user');
        assert.match(mainFuelUsage, /Core firmware: controller binding/, 'main fuel should name its controller binding');
        const removeDialogText = await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('#registry-outputs .registry-card'));
          const card = cards.find(card => /^Main Fuel Pump$/i.test((card.querySelector('strong')?.textContent || '').trim()));
          const remove = Array.from(card?.querySelectorAll('button') || []).find(btn => /remove/i.test(btn.textContent || ''));
          remove?.click();
          const text = document.querySelector('#registry-remove-modal')?.innerText || '';
          closeRegistryRemoveDialog();
          return text;
        });
        assert.match(removeDialogText, /currently used by/i, 'remove dialog should talk about current users');
        assert.match(removeDialogText, /Controller: fuel response & limit protection/, 'remove dialog should include specific controller user');
        assert.doesNotMatch(removeDialogText, /known references/i, 'remove dialog should not use vague reference wording');
      }
      if (setup.id === 'analog_rpm_and_servo_enable') {
        const oilPumpText = await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('#registry-outputs .registry-card'));
          const card = cards.find(card => /^Oil Pump$/i.test((card.querySelector('strong')?.textContent || '').trim()));
          return card ? card.innerText : '';
        });
        assert.match(oilPumpText || '', /Used by:/, 'oil pump should report actual current use');
        assert.doesNotMatch(oilPumpText || '', /Control rules/, 'oil pump must not claim control-rule use when no rule references it');
      }
      if (setup.id === 'rc_pwm_generic_rules') {
        const hwText = (await page.locator('#registry-inputs .registry-card-summary, #registry-outputs .registry-card-summary').allTextContents()).join(' ');
        assert.match(hwText, /Throttle Input/, 'internal throttle ID should render as plain label');
        assert.match(hwText, /PWM Duty Input/, 'generic PWM input should render as plain label');
        assert.match(hwText, /Telemetry Fan/, 'generic output should render its user-facing name');
        assert.match(hwText, /Used by: .*Control rules|Not used yet/, 'registry cards should show actual current use or not-used state');
        assert.doesNotMatch(hwText, /Available to:/, 'hardware cards should not imply availability is actual usage');
        assert.doesNotMatch(hwText, /Used by \/ available to/, 'hardware cards should not use mixed dependency wording');
        assert.doesNotMatch(hwText, /operator_throttle|generic_pwm_duty_input|generic_pwm_output/, 'hardware cards should not expose internal IDs in primary card text');
        assert.equal(await page.locator('.registry-output-live').count(), 0, 'hardware output cards should not show live output bars');
        const bindingText = await page.locator('#registry-bindings').textContent();
        assert.match(bindingText, /Throttle input/);
        assert.match(bindingText, /Main fuel pump output/);
        assert.doesNotMatch(bindingText, /operator_throttle|main_fuel_output/, 'advanced controller links should use plain labels');
      }
      if (setup.id === 'dry_sump_flow_monitored_turbine') {
        const pageText = await page.locator('#registry-inputs, #registry-outputs').allTextContents();
        const combined = pageText.join(' ');
        assert.match(combined, /Main oil-pump flow sensor/i);
        assert.match(combined, /Scavenge-pump flow sensor/i);
        assert.equal(await page.locator('#registry-inputs .registry-card[data-registry-id="oil_flow"]').count(), 0,
          'main oil flow sensor should live inside its pump card');
        assert.equal(await page.locator('#registry-inputs .registry-card[data-registry-id="scavenge_flow"]').count(), 0,
          'scavenge flow sensor should live inside its pump card');
        assert.match(combined, /Drain Valve/);
        assert.match(combined, /Flow sensing & monitoring/);
      }
      await page.goto(`${base}/config.html#${setup.id}`);
      await page.waitForSelector('#btn-save');
      await assertVisibleTextClean(page, `${setup.id} config`);
      if (setup.id === 'fuel_governed_generator') {
        const governorState = await page.evaluate(() => ({
          visible: !!document.querySelector('#governor-cfg-section')?.offsetParent,
          filterHidden: document.querySelector('#governor-cfg-section')?.classList.contains('filter-hidden'),
          controller: !!hwCfg.controllers?.governor,
          internalAvailable: _hasGovernorCfg,
          n2Inputs: (hwCfg.channel_registry?.inputs || []).filter(c => c.purpose === 'n2_speed').length,
          fuelOutputs: (hwCfg.channel_registry?.outputs || []).filter(c => c.purpose === 'main_fuel').length
        }));
        assert.equal(governorState.visible, true, JSON.stringify(governorState));
        assert.equal(await page.locator('#cf-gv_tr').inputValue(), '28000');
        assert.equal(await page.locator('#cf-gv_pk').isDisabled(), true,
          'fuel-governed generator should not expose inactive prop-pitch tuning');
      }
      if (setup.id === 'n2_idle_turboshaft') {
        const idleState = await page.evaluate(() => ({
          visible: !!document.querySelector('#idle-control-cfg-section')?.offsetParent,
          filterHidden: document.querySelector('#idle-control-cfg-section')?.classList.contains('filter-hidden'),
          controller: !!hwCfg.controllers?.dynamic_idle,
          hardwareUnavailable: document.querySelector('#idle-control-cfg-section')?.dataset.hardwareUnavailable,
          reason: document.querySelector('#idle-control-cfg-section')?.dataset.inactiveReason,
          n2Inputs: (hwCfg.channel_registry?.inputs || []).filter(c => c.purpose === 'n2_speed').length,
          fuelOutputs: (hwCfg.channel_registry?.outputs || []).filter(c => c.purpose === 'main_fuel').length
        }));
        assert.equal(idleState.visible, true, JSON.stringify(idleState));
        assert.equal(await page.locator('#cf-di_src').inputValue(), '1');
        assert.match(await page.locator('#cf-di_src option:checked').textContent(), /N2 output-shaft speed/i);
      }
      if (setup.id === 'pressure_torque_protected_test_turbine') {
        await page.locator('#btn-view-explore').click();
        for (const key of ['pb_p1e','pb_p2e','pb_tqe']) {
          assert.equal(await page.locator(`#cf-${key}`).isDisabled(), false, `${key} should be available`);
          assert.equal(await page.locator(`#cf-${key}`).isChecked(), true, `${key} should remain enabled`);
        }
        const limiterHelp = await page.locator('#engine-limits').textContent();
        assert.doesNotMatch(limiterHelp, /\bundefined\b/i);
      }
      if (setup.id === 'dual_egt_research_turbine') {
        assert.equal(await page.locator('#cf-eg_src').inputValue(), '2');
        assert.equal(await page.locator('#cf-sf_tit').isDisabled(), false);
        assert.equal(await page.locator('#cf-tot_limit').isDisabled(), true);
      }
      if (setup.id === 'windmilling_oil_free_turbine') {
        await page.locator('#btn-view-expert').click();
        assert.equal(await page.locator('#cf-so_src').inputValue(), '1');
        assert.equal(await page.locator('#cf-so_fp').inputValue(), '35');
        assert.equal(await page.locator('#cf-so_fb').inputValue(), '0');
      }
      if (setup.id === 'dry_sump_flow_monitored_turbine') {
        await page.locator('#btn-view-expert').click();
        assert.equal(await page.locator('#cf-oil_ufd').isDisabled(), false);
        assert.equal(await page.locator('#cf-oil_ufs').isDisabled(), false);
        assert.equal(await page.locator('#cf-oil_ufs').isChecked(), true);
      }
      await page.goto(`${base}/calibration.html#${setup.id}`);
      await page.waitForFunction(() => document.body.textContent.includes('Calibration'));
      await assertVisibleTextClean(page, `${setup.id} calibration`);
      if (setup.id === 'pressure_torque_protected_test_turbine') {
        assert.equal(await page.locator('#torque-cal-row').isVisible(), true,
          'NAU7802 torque channel must remain fitted on Calibration');
        assert.equal(await page.locator('#torque-loadcell-wizard').isVisible(), true);
        assert.match(await page.locator('#torque-loadcell-wizard').textContent(), /NAU7802.*Capture zero.*known load/is);
      }
      await page.goto(`${base}/sequence.html#${setup.id}`);
      await page.waitForSelector('#rules-list', { state: 'attached' });
      await assertVisibleTextClean(page, `${setup.id} sequence`);
      if (setup.id === 'dry_sump_flow_monitored_turbine') {
        const startupOptions = await page.locator('#add-startup-sel').textContent();
        const shutdownOptions = await page.locator('#add-shutdown-sel').textContent();
        assert.match(startupOptions, /Open Drain Valve/);
        assert.match(shutdownOptions, /Close Drain Valve/);
      }
      if (setup.id === 'rc_pwm_generic_rules') {
        await page.evaluate(() => switchTab('rules'));
        await page.waitForSelector('#rule-unit-0');
        assert.equal(await page.locator('#rule-unit-0').textContent(), '%');
        assert.equal(await page.locator('#rule-thresh-0').getAttribute('max'), '100');
        assert.equal(await page.locator('#rule-thresh-0').getAttribute('step'), '1');
        assert.match(await page.locator('#rule-sensor-0 option:checked').textContent(), /PWM Duty Input/);
        assert.doesNotMatch(await page.locator('#rule-sensor-0 option:checked').textContent(), /generic_pwm/);
      }
      await page.goto(`${base}/tools.html#${setup.id}`);
      await page.waitForSelector('#btn-test-settings');
      await assertVisibleTextClean(page, `${setup.id} tools`);
      if (setup.id === 'rc_pwm_generic_rules') {
        const fanTool = page.locator('.tool-card').filter({hasText:'Telemetry Fan Test'});
        assert.equal(await fanTool.count(), 1, 'generic proportional registry output needs a Tools test');
        const demand = fanTool.getByRole('spinbutton', {name:/test output percentage/i});
        assert.equal(await demand.inputValue(), '50');
        await demand.fill('25');
        await page.evaluate(() => localStorage.setItem('ot_tool_confirmations_skip_all', '1'));
        await api('POST', '/__sim/data', {mode:'STANDBY'});
        await page.waitForFunction(() => {
          const card = Array.from(document.querySelectorAll('.tool-card')).find(item => /Telemetry Fan Test/.test(item.textContent || ''));
          return card && !card.querySelector('button')?.disabled;
        });
        await fanTool.getByRole('button', {name:'Run'}).click();
        await page.waitForTimeout(100);
        const toolState = await api('GET', '/__sim/state');
        const command = toolState.commands.at(-1);
        assert.equal(command.cmd, 'REGISTRY_OUTPUT_TEST');
        assert.equal(command.fParam, 0.25, 'proportional registry-output test must use the chosen commissioning demand');
        extraToolCommands++;
      }
      if (setup.id === 'dry_sump_flow_monitored_turbine') {
        const drainTool = page.locator('.tool-card').filter({hasText:'Drain Valve Test'});
        assert.equal(await drainTool.count(), 1, 'I2C drain-valve output needs a Tools test');
        assert.equal(await drainTool.getByRole('spinbutton').count(), 0, 'binary output test should present ON/OFF semantics');
        await page.evaluate(() => localStorage.setItem('ot_tool_confirmations_skip_all', '1'));
        await api('POST', '/__sim/data', {mode:'STANDBY'});
        await page.waitForFunction(() => {
          const card = Array.from(document.querySelectorAll('.tool-card')).find(item => /Drain Valve Test/.test(item.textContent || ''));
          return card && !card.querySelector('button')?.disabled;
        });
        await drainTool.getByRole('button', {name:'Run'}).click();
        await page.waitForTimeout(100);
        const toolState = await api('GET', '/__sim/state');
        const command = toolState.commands.at(-1);
        assert.equal(command.cmd, 'REGISTRY_OUTPUT_TEST');
        assert.equal(command.fParam, 1, 'binary drain-valve test must command ON');
        extraToolCommands++;
      }
      if (setup.id === 'rc_pwm_generic_rules') {
        await page.goto(`${base}/#${setup.id}`);
        await page.waitForSelector('[data-registry-output-id="generic_pwm_output"]');
        await assertVisibleTextClean(page, `${setup.id} dashboard`);
        const dashText = await page.locator('[data-registry-output-id="generic_pwm_output"]').textContent();
        assert.match(dashText, /Telemetry Fan/);
        assert.match(dashText, /42\.0%/);
      }
      if (setup.id === 'turboprop_pwm_pitch_coolant') {
        await api('POST', '/__sim/data', {
          registry_inputs: [{ id: 'coolant_temperature', name: 'Coolant Temp', purpose: 'coolant_temp', role: 'temperature', driver: 1, value: 72.5, healthy: true }],
          registry_outputs: [{ id: 'coolant_pump', name: 'Coolant Pump', purpose: 'coolant_pump', role: 'coolant_pump', driver: 5, min: 0, max: 1, demand: 0.8 }]
        });
        await page.goto(`${base}/#${setup.id}`);
        await page.waitForSelector('[data-registry-input-id="coolant_temperature"]');
        await page.waitForSelector('[data-registry-output-id="coolant_pump"]');
        const coolantIn = await page.locator('[data-registry-input-id="coolant_temperature"]').textContent();
        const coolantOut = await page.locator('[data-registry-output-id="coolant_pump"]').textContent();
        assert.match(coolantIn, /Coolant Temp/);
        assert.match(coolantIn, /72\.5/);
        assert.match(coolantOut, /Coolant Pump/);
        assert.match(coolantOut, /80\.0%/);
      }

      await api('PATCH', '/api/config', setup.config);
      for (const command of setup.commands) {
        await api('POST', '/api/command', command);
      }
      await api('POST', '/api/start');
      await api('POST', '/api/stop');

      const saved = await api('GET', '/__sim/state');
      assert.equal(saved.hardware.profile_id, setup.id);
      assert.equal(saved.settings.profile_id, setup.id);
      assert.equal(saved.commands.length, setup.commands.length + extraToolCommands, `${setup.id} command count`);
      const registry = saved.hardware.channel_registry || {};
      assert.ok(Array.isArray(registry.inputs), `${setup.id} registry inputs missing`);
      assert.ok(Array.isArray(registry.outputs), `${setup.id} registry outputs missing`);
      const text = await page.locator('body').textContent();
      assert.doesNotMatch(text, /Fault demand/i, `${setup.id} shows removed fault demand`);
      results.push(`${setup.id}: ${setup.title}`);
    }

    assert.deepEqual(pageErrors, []);
    console.log(`Turbine setup matrix passed (${results.length} setups):`);
    results.forEach(result => console.log(`- ${result}`));
  } finally {
    await browser.close();
  }
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
