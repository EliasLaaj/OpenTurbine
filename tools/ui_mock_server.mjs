import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data_src');
const port = Number(globalThis.OT_UI_SIM_PORT || process.env.OT_UI_SIM_PORT || 8765);
const host = globalThis.OT_UI_SIM_HOST || process.env.OT_UI_SIM_HOST || '127.0.0.1';
const sockets = new Set();

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

function mockI2cDiscovery() {
  return {
    bus_active:true,
    devices:[
      {address:42,type:'NAU7802',present:true,last_seen_ms:1000,errors:0},
      {address:32,type:'TCA9554',present:true,last_seen_ms:1000,errors:0},
      {address:16,type:'TLA2528',present:true,last_seen_ms:1000,errors:0}
    ]
  };
}

function makeHardware() {
  return {
    platform: 'esp32',
    profile_id: 'sim-dev',
    profile_desc: 'UI simulator',
    wifi_password: '',
    wifi_tx_power_dbm: 8,
    channel_registry: {
      version: 1,
      inputs: [
        {id:'n1_main',name:'N1 Speed',purpose:'n1_speed',role:'speed',driver:2,pin:34,min:0,max:100000,pulses_per_unit:1},
        {id:'n2_main',name:'N2 Speed',purpose:'n2_speed',role:'speed',driver:2,pin:35,min:0,max:100000,pulses_per_unit:1},
        {id:'tot_main',name:'Main TOT',purpose:'tot',role:'temperature',driver:1,pin:-1,min:0,max:4095,temp_interface:2,spi_clk:18,spi_cs:5,spi_miso:19,spi_mosi:-1,tc_type:'K'},
        {id:'tit_main',name:'Main TIT',purpose:'tit',role:'temperature',driver:1,pin:-1,min:0,max:4095,temp_interface:2,spi_clk:18,spi_cs:17,spi_miso:19,spi_mosi:-1,tc_type:'K'},
        {id:'oil_pressure_main',name:'Oil Pressure',purpose:'oil_pressure',role:'pressure',driver:1,pin:32,min:0,max:4095,analog_zero_mv:500,analog_mv_per_unit:400},
        {id:'flame_main',name:'Flame',purpose:'flame',role:'flame',driver:1,pin:33,min:0,max:4095,digital_threshold_raw:1800,digital_hysteresis_raw:64,active_high:true},
        {id:'fuel_flow',name:'Fuel Flow',purpose:'fuel_flow',role:'flow',driver:2,pin:25,min:0,max:100,pulses_per_unit:450},
        {id:'oil_flow',name:'Main Oil Flow',purpose:'oil_flow',role:'flow',driver:2,pin:26,min:0,max:20,pulses_per_unit:900},
        {id:'scavenge_flow',name:'Scavenge Flow',purpose:'scavenge_flow',role:'flow',driver:9,pin:-1,min:0,max:20,i2c_address:16,device_channel:1,analog_zero_mv:500,analog_mv_per_unit:100},
        {id:'fuel_pressure',name:'Fuel Pressure',purpose:'fuel_pressure',role:'pressure',driver:1,pin:36,min:0,max:4095,analog_zero_mv:161.2,analog_mv_per_unit:290.1},
        {id:'p1_main',name:'P1 Pressure',purpose:'p1_pressure',role:'pressure',driver:1,pin:39,min:0,max:4095,analog_zero_mv:161.2,analog_mv_per_unit:362.6},
        {id:'p2_main',name:'P2 Pressure',purpose:'p2_pressure',role:'pressure',driver:1,pin:34,min:0,max:4095,analog_zero_mv:161.2,analog_mv_per_unit:362.6},
        {id:'operator_throttle',name:'Throttle Input',purpose:'throttle',role:'operator',driver:3,pin:4,min:1000,max:2000},
        {id:'operator_idle',name:'Idle Input',purpose:'idle',role:'operator',driver:3,pin:16,min:1000,max:2000},
        {id:'oil_temperature',name:'Oil Temp',purpose:'oil_temperature',role:'temperature',driver:1,pin:15,min:0,max:4095,temp_interface:4,ntc_beta:3950,ntc_r0:10000,ntc_r_fixed:10000},
        {id:'battery_voltage',name:'Battery Volt',purpose:'battery_voltage',role:'voltage',driver:1,pin:14,min:0,max:4095,analog_divider:4.7},
        {id:'torque_main',name:'Torque',purpose:'torque',role:'torque',driver:1,pin:13,min:0,max:4095,analog_zero_mv:0,analog_mv_per_unit:1000},
        {id:'thrust_main',name:'Thrust',purpose:'thrust',role:'thrust',driver:10,pin:-1,min:-1000,max:10000,i2c_address:42,device_channel:0,loadcell_gain:128,loadcell_rate_sps:80,loadcell_zero:0,loadcell_n_per_count:0.001,lever_arm_m:1,filter_alpha:0.25},
        {id:'ab_flame_main',name:'AB Flame',purpose:'ab_flame',role:'flame',driver:1,pin:32,min:0,max:4095}
      ],
      outputs: [
        {id:'main_fuel',name:'Main Fuel Pump',purpose:'main_fuel',role:'fuel',driver:6,pin:21,min:1000,max:2000,safe_demand:0},
        {id:'starter',name:'Starter',purpose:'starter',role:'starter',driver:6,pin:22,min:1000,max:2000,safe_demand:0},
        {id:'oil_pump',name:'Oil Pump',purpose:'oil_pump',role:'oil_pump',driver:5,pin:23,min:0,max:1,pwm_freq_hz:5000,pwm_res_bits:10,safe_demand:0,has_flow_monitor:true,minimum_flow_l_min:1.2},
        {id:'fuel_shutoff',name:'Fuel Shutoff',purpose:'fuel_shutoff',role:'fuel_shutoff',driver:4,pin:2,min:0,max:1,safe_demand:0},
        {id:'igniter',name:'Igniter',purpose:'igniter',role:'igniter',driver:4,pin:0,min:0,max:1,safe_demand:0},
        {id:'ab_igniter',name:'AB Igniter',purpose:'ab_igniter',role:'ab_igniter',driver:4,pin:1,min:0,max:1,safe_demand:0},
        {id:'starter_enable',name:'Starter Enable',purpose:'starter_enable',role:'starter_en',driver:4,pin:22,min:0,max:1,safe_demand:0},
        {id:'ab_solenoid',name:'AB Fuel Valve',purpose:'ab_valve',role:'valve',driver:4,pin:27,min:0,max:1,safe_demand:0},
        {id:'air_starter',name:'Air Starter',purpose:'air_starter',role:'starter',driver:4,pin:26,min:0,max:1,safe_demand:0},
        {id:'cooling_fan',name:'Cooling Fan',purpose:'cooling_fan',role:'cooling_fan',driver:5,pin:25,min:0,max:1,pwm_freq_hz:5000,pwm_res_bits:10,safe_demand:0},
        {id:'ab_pump',name:'AB Fuel Pump',purpose:'ab_pump',role:'ab_pump',driver:5,pin:13,min:0,max:1,pwm_freq_hz:5000,pwm_res_bits:10,safe_demand:0},
        {id:'scavenge_pump',name:'Scavenge Pump',purpose:'scavenge_pump',role:'scavenge_pump',driver:5,pin:12,min:0,max:1,pwm_freq_hz:5000,pwm_res_bits:10,safe_demand:0,has_flow_monitor:true,minimum_flow_l_min:0.8},
        {id:'fuel_pump',name:'Aux Fuel Pump',purpose:'fuel_pump',role:'fuel_pump',driver:5,pin:14,min:0,max:1,pwm_freq_hz:5000,pwm_res_bits:10,safe_demand:0},
        {id:'bleed_valve',name:'Bleed Valve',purpose:'valve',role:'valve',driver:6,pin:15,min:1000,max:2000,safe_demand:0},
        {id:'prop_pitch',name:'Prop Pitch',purpose:'prop_pitch',role:'prop_pitch',driver:6,pin:16,min:1000,max:2000,safe_demand:0},
        {id:'glow_plug',name:'Glow Plug',purpose:'glow_plug',role:'glow_plug',driver:5,pin:17,min:0,max:1,pwm_freq_hz:1000,pwm_res_bits:8,safe_demand:0},
        {id:'drain_valve',name:'Drain Valve',purpose:'drain_valve',role:'valve',driver:11,pin:-1,min:0,max:1,safe_demand:0,inverted:true,i2c_address:32,device_channel:2}
      ],
      bindings: [
        {key:'primary_n1',channel:'n1_main'},{key:'primary_n2',channel:'n2_main'},
        {key:'primary_egt',channel:'tot_main'},{key:'operator_throttle',channel:'operator_throttle'},
        {key:'main_fuel_output',channel:'main_fuel'},{key:'main_fuel_shutoff',channel:'fuel_shutoff'},
        {key:'main_starter',channel:'starter'}
      ]
    },
    // The simulator has no physical GPIO bus; discovery below is injected so
    // browser tests can exercise assignment/removal without stealing a mock pin.
    i2c: { enabled:false, sda_pin:-1, scl_pin:-1, interrupt_pin:-1, frequency_hz:400000 },
    _i2c_discovery: mockI2cDiscovery(),
    controls: { stop_pin: 27, stop_active_h: false, stop_pullup: true, start_pin: 26, start_active_h: false, start_pullup: true },
    sensors: {
      n1_rpm: { enabled: true, pin: 34, ppr: 1 },
      n2_rpm: { enabled: true, pin: 35, ppr: 1 },
      tot: { enabled: true, chip: 'max31855', tc_type: 'K', clk: 18, cs: 5, miso: 19, mosi: -1 },
      tit: { enabled: true, chip: 'max31855', tc_type: 'K', clk: 18, cs: 17, miso: 19, mosi: -1 },
      oil_press: { enabled: true, pin: 32 },
      flame: { enabled: true, pin: 33 },
      fuel_flow: { enabled: true, pin: 25, type: 1, pulses_per_litre: 450 },
      fuel_press: { enabled: true, pin: 36 },
      p1: { enabled: true, pin: 39 },
      p2: { enabled: true, pin: 34 },
      throttle_input: { enabled: true, pin: 4, rc_pwm: true },
      idle_input: { enabled: true, pin: 16, rc_pwm: true },
      oil_temp: { enabled: true, chip: 'ntc', pin: 15, clk: -1, cs: -1, miso: -1, mosi: -1, tc_type: 'K', resolution: 10, ntc_beta: 3950, ntc_r0: 10000, ntc_r_fixed: 10000, use_raw_poly: false, poly_a: 0, poly_b: 0, poly_c: 0, poly_d: 0, poly_x_min: 0, poly_x_max: 4095 },
      batt_voltage: { enabled: true, pin: 14, divider: 4.7 },
      torque: { enabled: true, pin: 13, scale: 1, offset: 0, hx711: false, dt_pin: -1, clk_pin: -1, hx_scale: 1, hx_zero: 0 }
    },
    actuators: {
      throttle: { enabled: true, pin: 21, type: 0, min_us: 1000, max_us: 2000, inverted: false, ledc_freq: 50, ledc_bits: 16 },
      starter: { enabled: true, pin: 22, type: 0, min_us: 1000, max_us: 2000, inverted: false, ledc_freq: 50, ledc_bits: 16 },
      oil_pump: { enabled: true, pin: 23, type: 1, active_h: true, min_us: 1000, max_us: 2000, freq_hz: 5000, res_bits: 10, has_current: true, current_pin: 12, current_mv_a: 100, current_zero_v: 0, current_max_a: 12 },
      fuel_sol: { enabled: true, pin: 2, active_h: true },
      igniter: { enabled: true, pin: 0, active_h: true, pwm: false, dwell_ms: 50, rest_ms: 100, coil: false, coil_sat_a: 3, current_pin: 12, current_mv_a: 100, current_zero_v: 0, has_current: true },
      igniter2: { enabled: true, pin: 1, active_h: true, pwm: false, dwell_ms: 50, rest_ms: 100, coil: true, coil_sat_a: 3, current_pin: 3, current_mv_a: 100, current_zero_v: 0, has_current: true },
      starter_en: { enabled: true, pin: 22, active_h: true, delay_ms: 250 },
      ab_sol: { enabled: true, pin: 27, active_h: true },
      airstarter_sol: { enabled: true, pin: 26, active_h: true },
      cool_fan: { enabled: true, pin: 25, type: 1, active_h: true, min_us: 1000, max_us: 2000, freq_hz: 5000, res_bits: 10 },
      ab_pump: { enabled: true, pin: 13, type: 1, active_h: true, min_us: 1000, max_us: 2000, freq_hz: 5000, res_bits: 10 },
      oil_scavenge_pump: { enabled: true, pin: 12, type: 1, min_us: 1000, max_us: 2000, active_h: true, freq_hz: 5000, res_bits: 10 },
      fuel_pump2: { enabled: true, pin: 14, type: 1, active_h: true, min_us: 1000, max_us: 2000, freq_hz: 5000, res_bits: 10 },
      bleed_valve: { enabled: true, pin: 15, type: 2, active_h: true, min_us: 1000, max_us: 2000, freq_hz: 5000, res_bits: 10 },
      prop_pitch: { enabled: true, pin: 16, type: 0, min_us: 1000, max_us: 2000, freq_hz: 5000, res_bits: 10, active_h: true },
      glow_plug: { enabled: true, pin: 17, freq_hz: 1000, res_bits: 8, current_pin: 36, current_mv_a: 100, current_zero_v: 0, current_ready_a: 2, has_current: true },
      status_led: { enabled: true, pin: 2 }
    },
    cluster_serial: { enabled: true, tx_pin: 1, rx_pin: -1, baud: 115200, interval_ms: 100 },
    buzzer: { enabled: false, pin: -1 },
    mavlink: { enabled: true, tx_pin: 3, baud: 57600, interval_ms: 100 },
    controllers: { oil_loop: true, dynamic_idle: true, governor: true },
    safety: { overspeed: true, n2_overspeed: true, overtemp: true, low_oil: true, oil_zero: true, flameout: true, hot_start: true, oil_temp_high: true, fuel_press_low: true, batt_low: true, surge: true },
    startup_seq: ['OilPumpOn', 'TimedDelay', 'IgniterOn', 'FuelPumpIdle', 'TimedDelay', 'IgniterOff', 'TimedDelay'],
    startup_delay_ms: [0, 15000, 0, 0, 10000, 0, 5000],
    shutdown_seq: ['ImmediateCut', 'TimedDelay', 'OilPumpOff'],
    shutdown_delay_ms: [0, 15000, 0],
    ab_trigger: { source: 0, requires_arm: true, arm_pin: 35, arm_active_h: true, switch_pin: 34, switch_active_h: true, input_pin: -1, input_rc_pwm: false, input_min_us: 1000, input_max_us: 2000, input_threshold: 2048 },
    ab_seq: ['ABCheckReady', 'ABSolOpen', 'ABPumpOn', 'ABIgnite', 'ABFlameConfirm', 'ABStabilize'],
    ab_shut_seq: ['ABPumpOff', 'ABSolClose', 'ABIgnOff'],
    labels: { tot: 'TOT', tit: 'TIT', n1: 'N1', n2: 'N2', oil_press: 'Oil Press', oil_temp: 'Oil Temp', p1: 'Pressure 1', p2: 'Pressure 2', fuel_press: 'Fuel Press', fuel_flow: 'Fuel Flow', stop: 'Stop', start: 'Start', ab_arm: 'AB Arm' },
    di_channels: [
      { pin: 18, active_h: true, debounce_ms: 20, label: 'Door interlock', role: 'fault', fault_code: 20, fault_msg: 'Door open', active_modes: 7 },
      { pin: -1, active_h: true, debounce_ms: 20, label: '', role: 'none', fault_code: 0, fault_msg: '', active_modes: 0 },
      { pin: -1, active_h: true, debounce_ms: 20, label: '', role: 'none', fault_code: 0, fault_msg: '', active_modes: 0 },
      { pin: -1, active_h: true, debounce_ms: 20, label: '', role: 'none', fault_code: 0, fault_msg: '', active_modes: 0 }
    ]
  };
}

function makeSettings() {
  return {
    profile_id: 'sim-dev',
    config_version: 9,
    engine: { rpm_limit: 95000, n2_rpm_limit: 30000, min_rpm: 12000, tot_limit: 720, tot_cooldown_target: 110, tot_safe_margin: 40 },
    oil: { startup_pressure: 1.5, startup_pct: 35, startup_min_bar: 0.5, running_min: 1.2, map_min: 1.5, map_max: 3.6, use_throttle_map: true, adjust_scale: 0.1, min_pct: 12, failsafe_delay_ms: 500, failsafe_pct: 70 },
    sequence: {
      startup: { oil_arm_timeout_ms: 5000, pre_ign_rpm: 6000, pre_ign_spark_ms: 300, flame_timeout_ms: 4000, flame_check_interval_ms: 100, flame_required_count: 3, rpm_target: 18000, rpm_timeout_ms: 12000, safety_hold_ms: 2000, final_check_rpm: 15000, starter_demand: 0.55, starter_timeout_ms: 10000, temp_confirm_target: 100, temp_confirm_timeout: 5000, timed_delay_ms: 500, wait_tot_target: 150, wait_tot_timeout: 10000, throttle_set_pct: 12, preheat_ms: 1500, oil_pump_on_pct: 100, fuel_pulse_ms: 120, fuel_off_ms: 200, wait_for_input_ch: 0, wait_for_input_state: true, wait_for_input_timeout: 3000, fp2_start_pct: 10, fp2_end_pct: 35, fp2_ramp_ms: 1000, fp2_demand_pct: 25, gov_hold_timeout_ms: 10000, pre_start_egt_limit_c: 150, startup_egt_limit_c: 0 },
      shutdown: { rpm_drop_threshold: 3000, rpm_drop_timeout_ms: 15000, cooldown_timeout_ms: 30000, final_stop_timeout_ms: 3000, oil_scavenge_ms: 4000, cooldown_use_scavenge: true, cooldown_use_starter: true, cooldown_use_oil: true, cooldown_starter_pct: 8, cooldown_oil_pct: 20, cooldown_oil_pressure_bar: 0.5, rpm_zero_threshold: 500 }
    },
    throttle: { ramp_up_ms: 800, ramp_down_ms: 500, fuel_pump_min_pct: 10, idle_max_pct: 20, expo: 1 },
    dynamic_idle: { source: 0, target_rpm: 24000, target_pressure_bar: 1.5, ramp_up_ms: 300, ramp_down_ms: 400, deadband_rpm: 200, pressure_deadband_bar: 0.05, rpm_limit: 40000, pressure_limit_bar: 3.0, max_multiplier: 1.5, use_n2: false, i_gain: 0.001, i_max: 0.2, pressure_decel_enter_bar: 0.12, pressure_settle_band_bar: 0.03, pressure_full_response_bar: 0.25, pressure_learn_rate_max_bar_s: 1.0 },
    safety: { check_interval_ms: 20, flameout_shutdown_ms: 500, flameout_egt_below_c: 300, flameout_egt_fall_rate_c_s: 50, tit_limit_c: 900, oil_temp_limit_c: 115, fuel_press_min_bar: 1.1, batt_volt_min_v: 10.5, surge_detect_rpm_variance: 5000 },
    governor: { target_rpm: 25000, band_rpm: 250, kp: 0.001, pitch_kp: 0.001, pitch_ramp_sec: 1, pitch_idle_deg: 5, pitch_max_deg: 35 },
    glow_plug: { preheat_ms: 1500, preheat_max_pct: 60, hold_pct: 20, wait_until_hot: false },
    calibration: { throttle_min_raw: 1000, throttle_max_raw: 2000, idle_min_raw: 1000, idle_max_raw: 2000, oil_poly: { a: 0, b: 0, c: 0.002, d: 0, x_min: 0, x_max: 4095 }, p1_raw_min: 200, p1_raw_max: 3800, p1_val_max: 8, p2_raw_min: 200, p2_raw_max: 3800, p2_val_max: 8, fuel_press_raw_min: 200, fuel_press_raw_max: 3800, fuel_press_val_max: 8, fuel_flow_raw_min: 0, fuel_flow_raw_max: 4095, fuel_flow_val_max: 50 },
    relight: { enabled: true, ignition_target: 0, confirm_source: 1, min_rpm: 6000, confirm_rpm: 8000, tot_rise_c: 30, relight_timeout_ms: 5000 },
    tools: { fuel_prime_ms: 3000, oil_prime_ms: 5000, ign_test_ms: 1000, start_test_ms: 2000, fuel_sol_test_ms: 1000 },
    telemetry: { ws_interval_ms: 100, snapshot_interval_ms: 500, log_standby: false },
    starter_control: { pulsed_assist_enabled: true, pulsed_assist_pwm_pct: 15, pulsed_assist_until_rpm: 1000, pulsed_assist_on_ms: 500, pulsed_assist_off_ms: 250, startup_ramp_pct_per_s: 5 },
    oil_advanced: { zero_bar: 0.05, deadband_bar: 0.1, pump_underflow_delay_ms: 5000, shutdown_on_underflow: false },
    standby_oil: { source: 0, rpm_limit: 500, feed_pct: 10 },
    limp_mode: { max_throttle_pct: 35 },
    misc: { cooldown_skip_hold_ms: 1500, igniter_on_start: true },
    rpm_health: { jump_threshold: 15000, zero_stuck_ticks: 20 },
    cluster: { n1_warn_rpm: 85000, n2_warn_rpm: 25000, tot_warn_c: 680, oil_warn_bar: 1.2, enabled: true },
    rc_input: { min_us: 1000, max_us: 2000, failsafe_ms: 500 },
    afterburner: { min_n1: 45000, max_n1: 92000, max_tot_for_light: 650, throttle_threshold: 0.8, use_torch: true, use_igniter: true, torch_spike_pct: 20, torch_duration_ms: 250, torch_tot_limit: 780, lightup_pump_pct: 80, flame_mode: 0, tot_rise_deg_c: 30, tot_rise_window_ms: 1000, assume_ignited_ms: 1500, flame_timeout_ms: 4000, flame_loss_delay_ms: 1000, pump_min_pct: 20, pump_max_pct: 80, pump_control_mode: 1, pump_follow_throttle: true, main_fuel_offset_pct: 0, stabilize_ms: 1000, stabilize_max_tot: 750 },
    session_log: { n1: true, n2: true, tot: true, oil: true, p1: true, p2: true, torque:true, thrust:true, throttle: true, mode: true, tit: true, batt: true, fuel_press: true, fuel_flow: true, glow: true, fp2: true, ab: true, prop: true, loop: false, interval_ms: 500 },
    rules: [{ enabled: true, name: 'Oil fan', kind: 0, sensor: 0, source: 'oil_temp', op: 0, threshold: 90, hysteresis: 5,
      actuator: 0, target: 'cooling_fan_main', on_value: 1, off_value: 0, input_min: 0, input_max: 1,
      output_min: 0, output_max: 1, mode_mask: 4 }]
  };
}

function fullTelemetry() {
  return {
    mode: 'RUNNING', fw_version: 'sim-1.0.0', uptime_s: 3672, last_event: 'RUNNING',
    loop_counter: 482917, loop_hz: 326.4, loop_period_ms: 3.06, loop_exec_avg_ms: 0.84, loop_exec_max_ms: 2.31,
    n1: 62000, n2: 24200, tot: 640, oil: 2.15, p1: 1.42, p2: 3.55, oil_temp: 78, batt_voltage: 12.45, torque: 18.7, thrust:86.4, thrust_raw:86400, turbo_power_w: 4850,
    tit: 810, fuel_press: 2.6, fuel_flow: 12.25, fuel_flow_type: 1, throttle_demand: 0.61, throttle_input_type: 'servo', throttle_input_raw: 2500, throttle_input_us: 1500, throttle_input_norm: 0.5, rc_throttle_norm: 0.5, idle_input_type: 'servo', idle_input_us: 1280,
    oil_demand: 2.2, oil_pct: 43, oil_min_bar: 1.85, flame: true, flame_raw: 2810, flame_threshold: 1800,
    n1_healthy: true, n2_healthy: true, tot_healthy: true, oil_healthy: true, p1_healthy: true, p2_healthy: true, oil_temp_healthy: true, tit_healthy: true, fuel_press_healthy: true, fuel_flow_healthy: true, batt_healthy: true, torque_healthy: true, thrust_healthy:true,
    max_n1: 67100, max_n2: 24900, max_tot: 676, max_oil_temp: 82, max_tit: 848, max_fuel_press: 2.9, max_batt_voltage: 12.6, max_p1: 1.8, max_p2: 3.9,
    rpm_limit: 95000, n2_rpm_limit: 30000, n2_limit: 30000, tot_limit: 720, egt_source: 1, egt_limit: 720, oil_running_min: 1.2, oil_temp_limit: 115, tit_limit: 900, fuel_press_min: 1.1, batt_volt_min: 10.5, tot_rise_rate: 2.5,
    fuel_pump_min_pct: 10, fuel_idle_max_pct: 25, oil_pump_on_pct: 100, ws_interval_ms: 333,
    dynamic_idle_enabled: true, limp_mode: false, idle_target: 24000, idle_target_unit: 'RPM', idle_source: 'N1', idle_controller_state: 'Active', governor_controller_state: 'Active: prop pitch', throttle_command_owner: 'Operator / throttle input', prop_pitch_command_owner: 'N2 governor', oil_command_owner: 'Oil pressure loop', relight_enabled: true, relight_armed: true, relight_attempts: 0,
    dev_mode_fw: true, dev_mode: false, skip_safety_checks: false, bench_mode: false,
    has_n1: true, has_n2: true, has_tot: true, has_oil_press: true, has_flame: true, has_p1: true, has_p2: true, has_oil_temp: true, has_batt_voltage: true, has_torque: true, has_thrust:true, has_fuel_press: true, has_fuel_flow: true, has_tit: true, has_governor: true,
    has_glow_plug: true, has_glow_current: true, has_igniter_current: true, has_igniter2_current: true, has_oil_pump_current: true, has_bleed_valve: true, has_prop_pitch: true, has_fuel_pump2: true, has_cool_fan: true, has_airstarter: true, has_oil_scavenge: true, has_afterburner: true, has_ab_flame: true,
    has_throttle: true, has_oil_pump: true, has_dynamic_idle: true, has_oil_loop: true, has_mavlink: true, has_pulsed_starter_assist: true,
    glow_current_amps: 3.2, glow_plug_hot: true, igniter_current_amps: 0, igniter2_current_amps: 0, oil_pump_current_amps: 2.3, oil_pump_overcurrent: false,
    glow_plug_pct: 20, bleed_valve_open: false, prop_pitch_demand: 0.38, fuel_pump2_demand: 0.42, cool_fan_on: true, airstarter_open: false, oil_scavenge_on: true,
    ab_mode: 'Off', ab_sol_open: false, ab_arm_switch_on: true, ab_flame_on: false, ab_flame_raw: 760, ab_flame_threshold: 1800, ab_trigger_active: false,
    governor_target_rpm: 25000, flash_free_kb: 560, flash_used_kb: 256, flash_total_kb: 816, log_records: 14, log_max_records: 400, boot_count: 4, reset_reason: 1, run_count: 8, start_attempt_count: 12, total_run_seconds: 9860, profile_id: 'sim-dev',
    oil_raw: 1400, p1_raw: 810, p2_raw: 1740, fuel_press_raw: 1320, fuel_flow_raw: 1044, oil_flow_warning:false,
    registry_inputs:[
      {id:'oil_flow',name:'Main Oil Flow',purpose:'oil_flow',role:'flow',value:2.45,healthy:true,min:0,max:20},
      {id:'scavenge_flow',name:'Scavenge Flow',purpose:'scavenge_flow',role:'flow',value:1.72,healthy:true,min:0,max:20},
      {id:'thrust_main',name:'Thrust',purpose:'thrust',role:'thrust',value:86.4,healthy:true,min:-1000,max:10000},
      {id:'maintenance_interlock',name:'Maintenance Interlock',purpose:'digital_switch',role:'inhibit_start',driver:0,value:1,healthy:true}
    ],
    registry_outputs:[
      {id:'drain_valve',name:'Drain Valve',purpose:'drain_valve',role:'valve',demand:0}
    ],
    config_storage_fault: false, profile_match: true, config_version_mismatch: false,
    seq_has_errors: false, seq_has_structural_errors: false, seq_issues: [],
    labels: makeHardware().labels,
    di_channels: [{ pin: 18, label: 'Door interlock', state: false }, { pin: -1, label: '', state: false }, { pin: -1, label: '', state: false }, { pin: -1, label: '', state: false }]
  };
}

const scenarios = {
  full: () => fullTelemetry(),
  minimal: () => merge(fullTelemetry(), {
    mode: 'STANDBY', n1: 0, n2: 0, tot: 22, oil: 0, throttle_demand: 0,
    throttle_input_type: 'none', idle_input_type: 'none',
    has_n2: false, has_p1: false, has_p2: false, has_oil_temp: false, has_batt_voltage: false,
    has_torque: false, has_thrust:false, has_fuel_press: false, has_fuel_flow: false, has_tit: false, has_governor: false,
    has_glow_plug: false, has_glow_current: false, has_igniter_current: false, has_igniter2_current: false,
    has_oil_pump_current: false, has_bleed_valve: false, has_prop_pitch: false, has_fuel_pump2: false,
    has_cool_fan: false, has_airstarter: false, has_oil_scavenge: false, has_afterburner: false, has_ab_flame: false,
    has_mavlink: false, has_pulsed_starter_assist: false, relight_enabled: false,
    registry_inputs: [], registry_outputs: []
  }),
  startup: () => merge(fullTelemetry(), {
    mode: 'STARTUP', n1: 8200, n2: 0, tot: 175, oil: 1.55, throttle_demand: 0.18,
    current_block: 'FlameConfirm', seq_block_idx: 3, seq_block_total: 6, seq_wait_reason: 'Waiting for stable flame'
  }),
  fault: () => merge(fullTelemetry(), {
    mode: 'FAULT', n1: 57000, tot: 735, oil: 0.55, fault_description: 'Oil pressure below running minimum',
    oil_healthy: false, relight_armed: false, last_event: 'FAULT_SHUTDOWN'
  })
};

function initialState() {
  return {
    hardware: makeHardware(),
    settings: makeSettings(),
    data: scenarios.full(),
    commands: [],
    logs: [
      { t: 10, ev: 'START_ATTEMPT', n1Rpm: 0, oilBar: 0, totDegC: 22, titDegC: 25 },
      { t: 14, ev: 'BLOCK', block: 'Ignition', n1: 6300, tot: 84, tit: 110 },
      { t: 26, ev: 'RUNNING_ENTRY', n1Rpm: 61000, oilBar: 2.1, totDegC: 620, titDegC: 760 },
      { t: 112, ev: 'RUN_SUMMARY', runS: 86, maxN1: 67100, maxTot: 676, maxTit: 848, minOil: 1.8 },
      { t: 113, ev: 'NORMAL_SHUTDOWN' },
      { t: 210, ev: 'START_ATTEMPT', n1Rpm: 0, oilBar: 0.2, totDegC: 90, titDegC: 110 },
      { t: 226, ev: 'FAULT', code: 'LOW_OIL', n1Rpm: 57000, totDegC: 735, titDegC: 840, oilBar: 0.55 },
      { t: 227, ev: 'RUN_SUMMARY', runS: 17, maxN1: 57000, maxTot: 735, maxTit: 840, minOil: 0.55 },
      { t: 228, ev: 'FAULT_SHUTDOWN', code: 'LOW_OIL', block: 'SafetyHold' }
    ],
    sessionCsv: 't_s,n1_rpm,n2_rpm,tot_c,tit_c,oil_bar,p1_bar,p2_bar,throttle_pct,batt_v,fuel_press_bar,fuel_flow,glow_pct,fp2_pct,ab_mode,prop_pct,mode\n0,1000,0,35,40,1.1,0.2,0.3,8,12.5,1.3,1,0,0,0,0,STARTUP\n2,62000,24200,640,810,2.15,1.42,3.55,61,12.45,2.6,12.25,20,42,0,38,RUNNING\n'
  };
}

function blankCommissioningState() {
  const next = initialState();
  next.hardware.profile_id = 'blank-devboard';
  next.hardware.profile_desc = 'Blank dev-board commissioning profile';
  next.hardware.channel_registry = { version: 2, inputs: [], outputs: [], bindings: [] };
  next.hardware.i2c = { enabled:false, sda_pin:-1, scl_pin:-1, interrupt_pin:-1, frequency_hz:400000 };
  next.hardware.spi = { enabled:false, clk_pin:-1, miso_pin:-1, mosi_pin:-1 };
  next.hardware.sensors = {};
  next.hardware.actuators = {};
  next.hardware.controllers = { oil_loop:false, dynamic_idle:false, governor:false };
  next.hardware.safety = {
    overspeed:false, n2_overspeed:false, overtemp:false, low_oil:false, oil_zero:false,
    flameout:false, hot_start:false, oil_temp_high:false, fuel_press_low:false,
    batt_low:false, surge:false
  };
  next.hardware.cluster_serial = { enabled:false, tx_pin:-1, rx_pin:-1, baud:115200, interval_ms:100 };
  next.hardware.mavlink = { enabled:false, tx_pin:-1, baud:57600, interval_ms:100 };
  next.hardware.buzzer = { enabled:false, pin:-1 };
  next.hardware.di_channels = [];
  next.settings.profile_id = 'blank-devboard';
  next.settings.relight.enabled = false;
  next.data = scenarios.minimal();
  syncDataFromHardware(next.data, next.hardware);
  return next;
}

function syncDataFromHardware(data, hardware) {
  const s = hardware.sensors || {};
  const a = hardware.actuators || {};
  const registryInputs = hardware.channel_registry?.inputs || [];
  const registryOutputs = hardware.channel_registry?.outputs || [];
  const hasInputPurpose = purpose => registryInputs.some(c => c?.installed !== false && c.purpose === purpose);
  const hasOutputPurpose = purpose => registryOutputs.some(c => c?.installed !== false && c.purpose === purpose);
  data.has_n1 = !!s.n1_rpm?.enabled;
  data.has_n2 = !!(s.n2_rpm?.enabled || hasInputPurpose('n2_speed'));
  data.has_tot = !!s.tot?.enabled;
  data.has_tit = !!s.tit?.enabled;
  if (data.egt_source === 1 && !data.has_tot) data.egt_source = data.has_tit ? 2 : 0;
  if (data.egt_source === 2 && !data.has_tit) data.egt_source = data.has_tot ? 1 : 0;
  if (!data.egt_source) data.egt_source = data.has_tot ? 1 : (data.has_tit ? 2 : 0);
  data.egt_limit = data.egt_source === 2 ? data.tit_limit : data.tot_limit;
  data.has_oil_press = !!s.oil_press?.enabled;
  data.has_flame = !!s.flame?.enabled;
  data.has_p1 = !!s.p1?.enabled;
  data.has_p2 = !!s.p2?.enabled;
  data.has_oil_temp = !!s.oil_temp?.enabled;
  data.has_batt_voltage = !!s.batt_voltage?.enabled;
  data.has_torque = !!s.torque?.enabled;
  data.has_thrust = hasInputPurpose('thrust');
  data.has_fuel_press = !!s.fuel_press?.enabled;
  data.has_fuel_flow = !!s.fuel_flow?.enabled;
  data.fuel_flow_type = s.fuel_flow?.type ?? data.fuel_flow_type;
  data.has_throttle = !!a.throttle?.enabled;
  data.has_oil_pump = !!a.oil_pump?.enabled;
  data.has_glow_plug = !!a.glow_plug?.enabled;
  data.has_glow_current = !!(a.glow_plug?.enabled && a.glow_plug?.has_current);
  data.has_igniter_current = !!(a.igniter?.enabled && a.igniter?.has_current);
  data.has_igniter2_current = !!(a.igniter2?.enabled && a.igniter2?.has_current);
  data.has_oil_pump_current = !!(a.oil_pump?.enabled && a.oil_pump?.has_current);
  data.has_bleed_valve = !!a.bleed_valve?.enabled;
  data.has_prop_pitch = !!a.prop_pitch?.enabled;
  data.has_fuel_pump2 = !!a.fuel_pump2?.enabled;
  data.has_cool_fan = !!a.cool_fan?.enabled;
  data.has_airstarter = !!a.airstarter_sol?.enabled;
  data.has_oil_scavenge = !!a.oil_scavenge_pump?.enabled;
  data.has_afterburner = !!(a.ab_sol?.enabled || a.ab_pump?.enabled || a.igniter2?.enabled ||
    hasOutputPurpose('ab_pump') || hasOutputPurpose('ab_igniter') || hasInputPurpose('ab_flame'));
  data.has_ab_flame = hasInputPurpose('ab_flame');
  data.has_governor = !!(hardware.controllers?.governor && data.has_n2);
  data.has_dynamic_idle = !!(hardware.controllers?.dynamic_idle && data.has_throttle &&
    (data.has_n1 || data.has_n2 || data.has_p1 || data.has_p2));
  data.has_oil_loop = !!(hardware.controllers?.oil_loop && data.has_oil_pump && data.has_oil_press);
  data.has_mavlink = !!hardware.mavlink?.enabled;
  data.has_pulsed_starter_assist = !!(data.has_n1 &&
    (a.starter?.enabled || hardware.has_starter) &&
    a.starter?.type !== 2);
  data.relight_enabled = !!(hardware.safety?.flameout && data.has_n1 && a.igniter?.enabled);
  data.throttle_input_type = s.throttle_input?.enabled ? (s.throttle_input?.rc_pwm ? 'servo' : 'adc') : 'none';
  data.idle_input_type = s.idle_input?.enabled ? (s.idle_input?.rc_pwm ? 'servo' : 'adc') : 'none';
  data.rc_pwm_active = !!((s.throttle_input?.enabled && s.throttle_input?.rc_pwm) ||
    (s.idle_input?.enabled && s.idle_input?.rc_pwm) ||
    (hardware.ab_trigger?.input_rc_pwm && Number(hardware.ab_trigger?.input_pin) >= 0) ||
    (hardware.channel_registry?.inputs || []).some(input =>
      input?.installed !== false && [3, 7].includes(Number(input?.driver))));
  return data;
}

let state = initialState();

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendText(res, status, body, type = 'text/plain') {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

async function bodyJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function wsFrame(text) {
  const payload = Buffer.from(text);
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function pushData(socket) {
  if (socket.writable) socket.write(wsFrame(JSON.stringify(state.data)));
}

function broadcast() {
  for (const socket of sockets) pushData(socket);
}

function acceptWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '', ''
  ].join('\r\n'));
  sockets.add(socket);
  pushData(socket);
  socket.on('data', () => pushData(socket));
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => sockets.delete(socket));
}

async function serveStatic(urlPath, res) {
  const portalPaths = new Set([
    '/generate_204',
    '/hotspot-detect.html',
    '/library/test/success.html',
    '/connecttest.txt',
    '/ncsi.txt',
    '/fwlink',
    '/redirect',
    '/canonical.html'
  ]);
  const requested = (urlPath === '/' || portalPaths.has(urlPath)) ? '/index.html' : urlPath;
  const cleaned = path.normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(root, cleaned);
  if (!filePath.startsWith(root)) return sendText(res, 403, 'Forbidden');
  try {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/api/data' || url.pathname === '/api/telemetry')) return sendJson(res, 200, state.data);
    if (req.method === 'GET' && url.pathname === '/api/status') return sendJson(res, 200, { ok: true, mode: state.data.mode, locked: !!state.data.config_locked });
    if (req.method === 'GET' && url.pathname === '/api/device_info') return sendJson(res, 200, {
      project: 'OpenTurbine', firmware_version: 'test', build_id: 'ui-mock',
      target: 'esp32s3dev', chip: 'ESP32-S3', state: state.data.mode,
      outputs_active: false, ota_allowed: true
    });
    if (req.method === 'GET' && url.pathname === '/api/theme') return sendJson(res, 200, { theme: state.settings.ui_theme || 'carbon' });
    if (req.method === 'GET' && url.pathname === '/api/config') return sendJson(res, 200, state.settings);
    if (req.method === 'GET' && url.pathname === '/api/hardware') {
      const hardware = clone(state.hardware);
      hardware._i2c_discovery = mockI2cDiscovery();
      return sendJson(res, 200, hardware);
    }
    if (req.method === 'GET' && url.pathname === '/api/i2c_discovery')
      return sendJson(res, 200, mockI2cDiscovery());
    if (req.method === 'GET' && url.pathname === '/api/pcb_profile') {
      const profile = clone(state.hardware._pcb_profile || {state:'absent', ports:[], port_count:0});
      const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
      const limit = Math.max(1, Math.min(12, Number(url.searchParams.get('limit') || 12)));
      const allPorts = profile.ports || [];
      profile.port_count = Number(profile.port_count ?? allPorts.length);
      profile.port_offset = offset;
      profile.ports = allPorts.slice(offset, offset + limit);
      return sendJson(res, 200, profile);
    }
    if (req.method === 'GET' && url.pathname === '/api/ecu_config') {
      const hardware = clone(state.hardware);
      hardware._i2c_discovery = mockI2cDiscovery();
      return sendJson(res, 200, { hardware, settings: state.settings });
    }
    if (req.method === 'GET' && url.pathname === '/api/log') return sendJson(res, 200, state.logs);
    if (req.method === 'GET' && url.pathname === '/api/log/raw') return sendText(res, 200, state.logs.map(item => JSON.stringify(item)).join('\n') + '\n', 'application/x-ndjson');
    if (req.method === 'GET' && url.pathname === '/api/log/csv') return sendText(res, 200, 't,ev,n1,tot,tit,oil\n' + state.logs.map(item => `${item.t},${item.ev},${item.n1 ?? item.n1Rpm ?? item.maxN1 ?? ''},${item.tot ?? item.totDegC ?? item.maxTot ?? ''},${item.tit ?? item.titDegC ?? item.maxTit ?? ''},${item.oil ?? item.oilBar ?? item.minOil ?? ''}`).join('\n') + '\n', 'text/csv');
    if (req.method === 'GET' && url.pathname === '/api/session/list') return sendJson(res, 200, [8]);
    if (req.method === 'GET' && url.pathname === '/api/session/log') return sendText(res, 200, state.sessionCsv, 'text/csv');
    if (req.method === 'GET' && url.pathname === '/__sim/state') return sendJson(res, 200, state);

    if ((req.method === 'POST' || req.method === 'PATCH') && url.pathname === '/api/config') {
      const body = await bodyJson(req);
      if (req.method === 'PATCH') state.last_config_patch = clone(body);
      state.settings = req.method === 'POST' ? body : merge(state.settings, body);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/theme') {
      state.settings.ui_theme = url.searchParams.get('t') || state.settings.ui_theme;
      return sendJson(res, 200, { ok: true });
    }
    if ((req.method === 'POST' || req.method === 'PATCH') && url.pathname === '/api/hardware') {
      const body = await bodyJson(req);
      delete body._i2c_discovery;
      if (req.method === 'PATCH' && body.channel_registry_calibration) {
        const calibration = body.channel_registry_calibration;
        const channel = (state.hardware.channel_registry?.inputs || []).find(row => row.id === calibration.id);
        if (channel) merge(channel, Object.fromEntries(Object.entries(calibration).filter(([key]) => key !== 'id')));
        delete body.channel_registry_calibration;
      }
      state.hardware = req.method === 'POST' ? body : merge(state.hardware, body);
      syncDataFromHardware(state.data, state.hardware);
      if (req.method === 'POST' && state.hardware.profile_id) {
        state.settings.profile_id = state.hardware.profile_id;
      }
      return sendJson(res, 200, { ok: true, reboot: req.method === 'POST' });
    }
    if (req.method === 'POST' && url.pathname === '/api/ecu_config') {
      const body = await bodyJson(req);
      if (!body.hardware || !body.settings) return sendJson(res, 400, { error: 'hardware and settings required' });
      if (!body.hardware.profile_id || body.hardware.profile_id !== body.settings.profile_id) {
        return sendJson(res, 400, { error: 'hardware and settings profile_id must identify the same engine' });
      }
      if (body.hardware.wifi_password === '__KEEP_PASSWORD__') {
        body.hardware.wifi_password = state.hardware.wifi_password;
      }
      state.hardware = body.hardware;
      state.settings = body.settings;
      syncDataFromHardware(state.data, state.hardware);
      return sendJson(res, 200, { ok: true, reboot: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/start') {
      state.data = scenarios.startup();
      broadcast();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/stop') {
      state.data = scenarios.minimal();
      broadcast();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/command') {
      const command = await bodyJson(req);
      state.commands.push(command);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'DELETE' && url.pathname === '/api/session/all') {
      state.sessionCsv = '';
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/factory_reset') {
      state = initialState();
      broadcast();
      return sendJson(res, 200, { ok: true, reboot: true });
    }
    if (req.method === 'POST' && url.pathname === '/__sim/reset') {
      state = initialState();
      broadcast();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/__sim/blank') {
      state = blankCommissioningState();
      broadcast();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/__sim/data') {
      state.data = merge(state.data, await bodyJson(req));
      broadcast();
      return sendJson(res, 200, state.data);
    }
    if (req.method === 'POST' && url.pathname.startsWith('/__sim/scenario/')) {
      const name = url.pathname.split('/').pop();
      if (!scenarios[name]) return sendJson(res, 404, { error: 'unknown scenario', known: Object.keys(scenarios) });
      state.data = scenarios[name]();
      broadcast();
      return sendJson(res, 200, { ok: true, scenario: name, data: state.data });
    }
    return serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.on('upgrade', (req, socket) => {
  if (new URL(req.url, `http://${host}:${port}`).pathname !== '/ws') return socket.destroy();
  acceptWebSocket(req, socket);
});

server.listen(port, host, () => {
  console.log(`OpenTurbine UI simulator listening on http://${host}:${port}`);
  console.log('Scenarios: POST /__sim/scenario/full, /minimal, /startup, /fault');
});
