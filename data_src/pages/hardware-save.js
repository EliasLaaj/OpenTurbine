// ── Save-recap helpers ────────────────────────────────────────
function _getFieldLabel(el) {
  // en-* : label is the <b> text inside the same .hw-toggle wrapper
  if (el.id.startsWith('en-')) {
    let p = el.parentElement;
    while (p && !p.classList.contains('hw-toggle')) p = p.parentElement;
    if (p) {
      const b = p.querySelector('b');
      if (b) return b.textContent.trim();
    }
    return el.id.replace(/^en-/, '').replace(/-/g, ' ');
  }
  // f-* : label is in nearest .hw-field → .hw-label
  let p = el.parentElement;
  while (p && !p.classList.contains('hw-field')) p = p.parentElement;
  if (p) {
    const lbl = p.querySelector('.hw-label');
    if (lbl) return lbl.textContent.trim().replace(/\s*\(.*\)$/, '');
  }
  return el.id.replace(/^f-/, '').replace(/-/g, ' ');
}

function _formatValue(el, rawVal) {
  if (el.type === 'checkbox') return (rawVal === true || rawVal === 'true') ? 'Enabled' : 'Disabled';
  if (el.tagName === 'SELECT') {
    const opt = Array.from(el.options).find(o => String(o.value) === String(rawVal));
    return opt ? opt.text.replace(/\s*\[.*?\]/g, '').trim() : (rawVal === '-1' || rawVal === '' ? '— Not assigned —' : rawVal);
  }
  return rawVal !== '' && rawVal !== undefined ? String(rawVal) : '(empty)';
}


function _registryFieldLabel(key) {
  return ({
    id:'Stable ID', name:'Display name', purpose:'Purpose', role:'Purpose family', driver:'Signal type', pin:'GPIO pin',
    min:'Minimum mapped value', max:'Maximum mapped value', pulses_per_unit:'Pulse scale',
    analog_zero_mv:'Analog zero offset', analog_mv_per_unit:'Analog mV per unit', analog_divider:'Voltage divider ratio',
    calibration_points:'Multi-point calibration curve', i2c_address:'I2C address', device_channel:'Device channel',
    i2c_reference_mv:'ADC reference voltage', filter_alpha:'Input filter',
    loadcell_gain:'Load-cell gain', loadcell_rate_sps:'Load-cell sample rate', loadcell_zero:'Load-cell zero',
    loadcell_n_per_count:'Load-cell scale', lever_arm_m:'Torque lever arm',
    digital_threshold_raw:'Switch threshold', digital_hysteresis_raw:'Switch hysteresis',
    torque_interface:'Torque sensor interface', hx711_clk:'HX711 clock GPIO', hx711_scale:'HX711 scale', hx711_zero:'HX711 zero',
    temp_interface:'Temperature sensor interface', spi_clk:'SPI clock GPIO', spi_cs:'SPI chip-select GPIO',
    spi_miso:'SPI MISO GPIO', spi_mosi:'SPI MOSI GPIO', tc_type:'Thermocouple type',
    temp_resolution:'Temperature resolution', ntc_beta:'NTC beta coefficient', ntc_r0:'NTC resistance at 25 C',
    ntc_r_fixed:'NTC fixed resistor', ntc_pullup:'NTC divider orientation',
    safe_demand:'Power-on demand', mirror_of:'Mirrored command source', force_safe_on_fault:'Force safe state on fault', min_run_demand:'Minimum reliable command', pwm_freq_hz:'PWM carrier frequency', pwm_res_bits:'PWM resolution', invert:'Signal inversion',
    active_high:'Active polarity', pullup:'Internal pull-up', pulldown:'Internal pull-down',
    has_current:'Current sensing', current_pin:'Current sensor pin', current_mv_a:'Current sensor mV/A',
    current_zero_v:'Current zero voltage', current_max_a:'Current limit', current_ready_a:'Glow ready current', current_trip_delay_ms:'Overcurrent confirmation',
    ignition_mode:'Ignition mode', ignition_dwell_ms:'Ignition dwell', ignition_rest_ms:'Ignition rest',
    ignition_coil_sat_a:'Coil saturation current', ignition_preheat_ms:'Device preheat duration',
    ignition_peak_demand:'Glow peak command', ignition_hold_demand:'Glow hold command',
    ignition_wait_hot:'Wait for hot confirmation', ignition_hot_timeout_ms:'Hot-confirm timeout',
    paired_output:'Paired start-fuel output', paired_output_delay_ms:'Pilot-fuel delay',
    paired_output_demand:'Pilot-fuel command',
    has_flow_monitor:'Flow monitoring', minimum_flow_l_min:'Minimum oil flow', flow_input:'Flow sensor'
  })[key] || key.replace(/_/g, ' ');
}
function _registryFieldValue(key, value, direction) {
  if (['invert','active_high','pullup','pulldown','has_current','has_flow_monitor','force_safe_on_fault'].includes(key)) return value ? 'Enabled' : 'Disabled';
  if (value === undefined || value === null || value === '') return '(empty)';
  if (key === 'driver') return driverName(value);
  if (key === 'role') return registryRoleLabel(direction, value);
  if (['pin','current_pin','hx711_clk','spi_clk','spi_cs','spi_miso','spi_mosi'].includes(key)) return Number(value) >= 0 ? `GPIO${value}` : 'Not assigned';
  if (key === 'i2c_address') return Number(value) > 0 ? `0x${Number(value).toString(16).toUpperCase().padStart(2,'0')}` : 'Not assigned';
  if (key === 'calibration_points') return Array.isArray(value)
    ? (value.length ? value.map(p => `${Number(p.raw)} -> ${Number(p.value)}`).join(', ') : 'Linear calibration')
    : 'Linear calibration';
  if (key === 'safe_demand') return (Number(value) * 100).toFixed(0) + '%';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : String(value);
  return String(value);
}
function _registryChannelsById(rows) {
  const map = new Map();
  (rows || []).forEach(c => { if (c?.id) map.set(c.id, c); });
  return map;
}
function _registryAddedSummary(direction, channel) {
  return `Added ${registryRoleLabel(direction, channel.role)} / ${registrySignalSummary(channel)} / ${registryPinSummary(channel)}`;
}
function _registryFieldRelevant(direction, channel, key) {
  const common = new Set(['id','name','purpose','role','driver','pin','min','max']);
  if (common.has(key)) return true;
  const driver = Number(channel?.driver ?? (direction === 'input' ? 0 : 4));
  if (['i2c_address','device_channel'].includes(key)) return driver >= 8;
  if (direction === 'input') {
    if (key === 'invert') return !['flame','ab_flame'].includes(registryDerivedPurpose(direction, channel)) &&
      [1,2,3,7,9].includes(driver) &&
      ['generic','throttle','idle','flame'].includes(registryDerivedPurpose(direction, channel));
    if (key === 'active_high') return driver === 0 || driver === 8 ||
      ([1,9].includes(driver) && ['flame','ab_flame'].includes(registryDerivedPurpose(direction, channel))) ||
      ([1,9].includes(driver) && (registryIsSwitchRole(channel?.role) || ['start_switch','stop_switch'].includes(channel?.purpose)));
    if (['pullup','pulldown'].includes(key)) return driver === 0;
    if (key === 'pulses_per_unit') return driver === 2;
    const role = String(channel?.role || '');
    if (key === 'analog_divider') return [1,9].includes(driver) && role === 'voltage';
    if (['analog_zero_mv','analog_mv_per_unit'].includes(key))
      return [1,9].includes(driver) && !['generic','operator','flame','voltage'].includes(role);
    if (key === 'calibration_points') return [1,9].includes(driver) && String(channel?.role || '') !== 'flame';
    if (key === 'i2c_reference_mv') return driver === 9;
    if (['digital_threshold_raw','digital_hysteresis_raw'].includes(key))
      return ([1,9].includes(driver) && ['flame','ab_flame'].includes(registryDerivedPurpose(direction, channel))) ||
        ([1,9].includes(driver) && (registryIsSwitchRole(channel?.role) || ['start_switch','stop_switch'].includes(channel?.purpose)));
    if (key === 'filter_alpha') return [9,10].includes(driver);
    if (['loadcell_gain','loadcell_rate_sps','loadcell_zero','loadcell_n_per_count','lever_arm_m'].includes(key)) return driver === 10;
    const tempInterface = Number(channel?.temp_interface || 0);
    if (key === 'temp_interface') return channel?.role === 'temperature';
    if (['spi_clk','spi_cs','spi_miso','spi_mosi','tc_type'].includes(key)) return tempInterface >= 1 && tempInterface <= 3;
    if (['temp_resolution'].includes(key)) return tempInterface === 5;
    if (['ntc_beta','ntc_r0','ntc_r_fixed','ntc_pullup'].includes(key)) return tempInterface === 4;
    const torqueInterface = Number(channel?.torque_interface || 0);
    if (key === 'torque_interface') return channel?.role === 'torque';
    if (['hx711_clk','hx711_scale','hx711_zero'].includes(key)) return torqueInterface === 1;
    return false;
  }
  if (key === 'invert') return true;
  if (['safe_demand','mirror_of','force_safe_on_fault','min_run_demand'].includes(key)) return true;
  if (['pwm_freq_hz','pwm_res_bits'].includes(key)) return driver === 5;
  if (key === 'has_current') return true;
  if (['current_pin','current_mv_a','current_zero_v','current_max_a','current_trip_delay_ms'].includes(key)) return !!channel?.has_current;
  if (key === 'has_flow_monitor') return ['oil_pump','scavenge_pump'].includes(String(channel?.purpose || ''));
  if (['minimum_flow_l_min','flow_input'].includes(key)) return !!channel?.has_flow_monitor;
  return false;
}
function _registryEffectiveValue(key, value) {
  if (value !== undefined && value !== null && value !== '') return value;
  const defaults = {
    pulses_per_unit:1, analog_zero_mv:0, analog_mv_per_unit:1000, analog_divider:1,
    calibration_points:[], i2c_address:0, device_channel:0, i2c_reference_mv:3300,
    loadcell_gain:128, loadcell_rate_sps:80, loadcell_zero:0,
    loadcell_n_per_count:1, lever_arm_m:1, filter_alpha:1,
    digital_threshold_raw:2048, digital_hysteresis_raw:64,
    torque_interface:0, hx711_clk:-1, hx711_scale:1, hx711_zero:0,
    temp_interface:0, spi_clk:-1, spi_cs:-1, spi_miso:-1, spi_mosi:-1,
    tc_type:'K', temp_resolution:10, ntc_beta:3950, ntc_r0:10000,
    ntc_r_fixed:10000, ntc_pullup:true, safe_demand:0, mirror_of:'',
    force_safe_on_fault:false, min_run_demand:0, pwm_freq_hz:5000,
    pwm_res_bits:10, invert:false, active_high:true, pullup:false,
    pulldown:false, has_current:false, current_pin:-1, current_mv_a:100,
    current_zero_v:1.65, current_max_a:0, current_ready_a:3, current_trip_delay_ms:5000, has_flow_monitor:false,
    minimum_flow_l_min:0, flow_input:'', ignition_mode:0, ignition_dwell_ms:6,
    ignition_rest_ms:3, ignition_coil_sat_a:8, ignition_preheat_ms:10000,
    ignition_peak_demand:.8, ignition_hold_demand:.3, ignition_wait_hot:false,
    ignition_hot_timeout_ms:30000, paired_output:'', paired_output_delay_ms:8000,
    paired_output_demand:1
  };
  return Object.prototype.hasOwnProperty.call(defaults, key) ? defaults[key] : value;
}
function _registryDiffRows(direction) {
  if (!_registrySnap) return [];
  const nowRows = registryRoot()[direction + 's'] || [];
  const oldRows = _registrySnap[direction + 's'] || [];
  const now = _registryChannelsById(nowRows);
  const old = _registryChannelsById(oldRows);
  const rows = [];
  const title = direction === 'input' ? 'Input' : 'Output';
  now.forEach((c, id) => {
    const label = `${title} ${registryDisplayName(direction, c, id)}`;
    if (!old.has(id)) {
      rows.push({label, was:'Not installed', now:_registryAddedSummary(direction, c)});
      return;
    }
    const prev = old.get(id);
    Array.from(new Set([...Object.keys(prev || {}), ...Object.keys(c || {})]))
      .filter(k => k !== 'installed' && (_registryFieldRelevant(direction, prev, k) || _registryFieldRelevant(direction, c, k)))
      .forEach(k => {
      const a = _registryEffectiveValue(k, prev?.[k]);
      const b = _registryEffectiveValue(k, c?.[k]);
      if (JSON.stringify(a) === JSON.stringify(b)) return;
      rows.push({label:`${label} / ${_registryFieldLabel(k)}`, was:_registryFieldValue(k, a, direction), now:_registryFieldValue(k, b, direction)});
    });
  });
  old.forEach((c, id) => { if (!now.has(id)) rows.push({label:`${title} ${registryDisplayName(direction, c, id)}`, was:'Installed', now:'Removed'}); });
  return rows;
}
function _registryBindingDiffRows() {
  if (!_registrySnap) return [];
  const now = registryRoot().bindings || [];
  const old = _registrySnap.bindings || [];
  if (JSON.stringify(now) === JSON.stringify(old)) return [];
  const fmt = b => `${registryBindingLabel(b.key)} -> ${registryBindingChannelLabel(b.channel, b.key)}`;
  return [{label:'Controller links', was:old.map(fmt).join(', ') || 'None', now:now.map(fmt).join(', ') || 'None'}];
}
function _workflowDiffRows() {
  const rows = [];
  const labels = {
    oil_loop:'Automatic oil-pressure control',
    dynamic_idle:'Automatic idle speed control', governor:'Automatic N2 speed control',
    overspeed:'N1 overspeed safety', n2_overspeed:'N2 overspeed safety', overtemp:'Turbine overtemperature safety',
    low_oil:'Low-oil safety', oil_zero:'Zero-oil safety', flameout:'Flameout safety',
    hot_start:'Pre-start EGT interlock', oil_temp_high:'Oil-temperature safety',
    fuel_press_low:'Fuel-pressure safety', batt_low:'Battery-undervoltage safety',
    surge:'Surge detection'
  };
  for (const group of ['controllers','safety']) {
    const before = _workflowSnap[group] || {};
    const after = cfg[group] || {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!!before[key] === !!after[key]) continue;
      rows.push({label:labels[key] || key.replaceAll('_',' '), was:before[key] ? 'Enabled' : 'Disabled', now:after[key] ? 'Enabled' : 'Disabled'});
    }
  }
  return rows;
}

function _abTriggerDiffRows() {
  const before = _workflowSnap.ab_trigger || {};
  const after = cfg.ab_trigger || {};
  const labels = {
    source:'Trigger source', switch_pin:'Trigger-switch GPIO', switch_active_h:'Switch polarity',
    input_rc_pwm:'Command signal', input_pin:'Command-input GPIO', input_threshold:'Trigger threshold',
    input_min_us:'RC pulse minimum', input_max_us:'RC pulse maximum', requires_arm:'Arming interlock',
    arm_pin:'Arm-switch GPIO', arm_active_h:'Arm polarity'
  };
  const sourceNames = ['Manual / browser command','Throttle threshold','Physical switch','Analog or RC command input'];
  const format = (key, value, state) => {
    if (key === 'source') return sourceNames[Number(value || 0)] || 'Unknown source';
    if (['switch_pin','input_pin','arm_pin'].includes(key)) return Number(value) >= 0 ? `GPIO${value}` : 'Not assigned';
    if (['switch_active_h','arm_active_h'].includes(key)) return value ? 'Active HIGH' : 'Active LOW';
    if (key === 'requires_arm') return value ? 'Required' : 'Not required';
    if (key === 'input_rc_pwm') return value ? 'RC servo pulse' : 'Analog 0-3.3 V';
    if (key === 'input_threshold') {
      const raw = Math.max(0, Math.min(4095, Number(value ?? 2048)));
      return state.input_rc_pwm ? `${Math.round(raw * 100 / 4095)}%` : `${(raw * 3.3 / 4095).toFixed(2)} V`;
    }
    if (['input_min_us','input_max_us'].includes(key)) return `${Number(value ?? (key === 'input_min_us' ? 1000 : 2000))} us`;
    return value === undefined || value === null || value === '' ? '(default)' : String(value);
  };
  const rows = [];
  for (const key of Object.keys(labels)) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    rows.push({label:`Afterburner trigger / ${labels[key]}`, was:format(key, before[key], before), now:format(key, after[key], after)});
  }
  return rows;
}

function _deviceDiffRows() {
  const before = _workflowSnap.devices || {};
  const after = {
    cluster_serial: cfg.cluster_serial || {},
    mavlink: cfg.mavlink || {},
    status_led: cfg.actuators?.status_led || {},
    buzzer: cfg.buzzer || {}
  };
  const deviceLabels = {
    cluster_serial:'OT Cluster serial', mavlink:'MAVLink telemetry',
    status_led:'Status LED', buzzer:'Buzzer'
  };
  const fieldLabels = {
    enabled:'Installed', tx_pin:'TX GPIO', rx_pin:'RX GPIO', pin:'GPIO pin',
    baud:'Baud rate', interval_ms:'Update interval', type:'LED type', mode:'LED mode',
    blink_color:'Blink color', standby_color:'Standby color', startup_color:'Startup color',
    running_color:'Running color', shutdown_color:'Shutdown color'
  };
  const format = (key, value) => {
    if (key === 'enabled') return value ? 'Enabled' : 'Disabled';
    if (['pin','tx_pin','rx_pin'].includes(key)) return Number(value) >= 0 ? `GPIO${value}` : 'Not assigned';
    if (value === undefined || value === null || value === '') return '(empty)';
    return String(value);
  };
  const rows = [];
  for (const device of Object.keys(deviceLabels)) {
    const oldDevice = before[device] || {};
    const newDevice = after[device] || {};
    for (const key of new Set([...Object.keys(oldDevice), ...Object.keys(newDevice)])) {
      const was = oldDevice[key], now = newDevice[key];
      if (JSON.stringify(was) === JSON.stringify(now)) continue;
      rows.push({
        label:`${deviceLabels[device]} / ${fieldLabels[key] || key.replaceAll('_',' ')}`,
        was:format(key, was), now:format(key, now)
      });
    }
  }
  return rows;
}

function _controlDiffRows() {
  const rows = [];
  const beforeControls = _workflowSnap.controls || {};
  const afterControls = cfg.controls || {};
  const beforeLabels = _workflowSnap.labels || {};
  const afterLabels = cfg.labels || {};
  const fieldLabels = {
    pin:'GPIO pin', active_h:'Active polarity', pullup:'Pull-up resistor',
    pulldown:'Pull-down resistor'
  };
  const format = (key, value) => {
    if (key === 'pin') return Number(value) >= 0 ? `GPIO${value}` : 'Not assigned';
    if (key === 'active_h') return value ? 'Active HIGH' : 'Active LOW';
    return value ? 'Enabled' : 'Disabled';
  };
  for (const which of ['stop','start']) {
    const title = which === 'stop' ? 'Stop switch' : 'Start switch';
    if (JSON.stringify(beforeLabels[which]) !== JSON.stringify(afterLabels[which])) {
      rows.push({label:`${title} / Display label`, was:beforeLabels[which] || '(default)', now:afterLabels[which] || '(default)'});
    }
    for (const key of Object.keys(fieldLabels)) {
      const fullKey = `${which}_${key}`;
      const was = beforeControls[fullKey];
      const now = afterControls[fullKey];
      if (JSON.stringify(was) === JSON.stringify(now)) continue;
      rows.push({label:`${title} / ${fieldLabels[key]}`, was:format(key, was), now:format(key, now)});
    }
  }
  return rows;
}

function _buildChanges() {
  const changes = [];
  document.querySelectorAll(
    'input[id^="f-"], select[id^="f-"], textarea[id^="f-"], input[id^="en-"]'
  ).forEach(el => {
    if (!(el.id in _fieldSnap)) return;
    const cur  = (el.type === 'checkbox') ? el.checked : el.value;
    const snap = _fieldSnap[el.id];
    if (String(cur) === String(snap)) return;
    if (el.disabled) return;
    if (el.offsetParent === null) return;
    changes.push({
      label: _getFieldLabel(el),
      was:   _formatValue(el, snap),
      now:   _formatValue(el, cur),
    });
  });
  changes.push(..._registryDiffRows('input'), ..._registryDiffRows('output'),
    ..._registryBindingDiffRows(), ..._workflowDiffRows(), ..._deviceDiffRows(),
    ..._controlDiffRows(), ..._abTriggerDiffRows());
  return changes;
}

function _checkGpioConflicts() {
  const usage = collectPinUsage();
  return [...usage.entries()]
    .filter(([, entries]) => {
      if (entries.length < 2) return false;
      const group = entries[0].group || '';
      return !(group && entries.every(entry => entry.group === group));
    })
    .map(([pin, entries]) => ({ pin: +pin, names: entries.map(entry => entry.label) }));
}

function _releaseInactivePinConflicts() {
  const active = collectUsedPins();
  let changed = false;
  function release(obj, fields) {
    if (!obj) return;
    fields.forEach(field => {
      if ((obj[field] ?? -1) >= 0 && active.has(+obj[field])) {
        obj[field] = -1;
        changed = true;
      }
    });
  }
  for (const [key, item] of Object.entries(cfg.sensors || {})) {
    if (!item?.enabled) release(item, ['pin', 'clk', 'cs', 'miso', 'mosi', 'dt_pin', 'clk_pin']);
  }
  for (const item of Object.values(cfg.actuators || {})) {
    if (!item?.enabled) release(item, ['pin', 'current_pin', 'fuel_pin']);
    else if (!item.has_current) release(item, ['current_pin']);
  }
  if (Number(cfg.actuators?.glow_plug?.type || 0) !== 2) {
    release(cfg.actuators?.glow_plug, ['fuel_pin']);
  }
  if (!cfg.cluster_serial?.enabled) release(cfg.cluster_serial, ['tx_pin', 'rx_pin']);
  if (!cfg.mavlink?.enabled) release(cfg.mavlink, ['tx_pin']);
  if (!cfg.buzzer?.enabled) release(cfg.buzzer, ['pin']);
  const abt = cfg.ab_trigger || {};
  if (abt.source !== 2) release(abt, ['switch_pin']);
  if (abt.source !== 3) release(abt, ['input_pin']);
  if (abt.source === 0 || !abt.requires_arm) release(abt, ['arm_pin']);
  if (changed) {
    refreshAllPins();
    _refreshChangedBorders();
  }
  return changed;
}

async function saveHardware() {
  _releaseInactivePinConflicts();
  syncSharedSpiChannels();
  // Firmware string capacities are byte based. HTML maxlength counts UTF-16
  // characters, so accented text and symbols can otherwise pass the browser
  // check and be rejected only after the user reviews the save.
  const utf8Bytes = value => new TextEncoder().encode(String(value || '')).length;
  const profileId = String(cfg.profile_id || '').trim();
  const profileDesc = String(cfg.profile_desc || '');
  const wifiPassword = String(cfg.wifi_password || '');
  if (!profileId || utf8Bytes(profileId) > 63) {
    alert('Engine profile name must be 1–63 bytes. Shorten it and try again.');
    document.getElementById('f-profile-id')?.focus();
    return;
  }
  if (utf8Bytes(profileDesc) > 63) {
    alert('Engine description must be at most 63 bytes. Symbols and accented characters can use more than one byte. Shorten it and try again.');
    document.getElementById('f-profile-desc')?.focus();
    return;
  }
  if (wifiPassword !== '__KEEP_PASSWORD__' && wifiPassword &&
      (utf8Bytes(wifiPassword) < 8 || utf8Bytes(wifiPassword) > 63)) {
    alert('Wi-Fi password must be empty for an open hotspot or 8–63 bytes long.');
    document.getElementById('f-wifi-password')?.focus();
    return;
  }
  const igniterModeConversions = [];
  for (const [purpose, key, label] of [
    ['igniter','igniter','Igniter'], ['ab_igniter','igniter2','Afterburner / Secondary Igniter']
  ]) {
    (registryRoot().outputs || []).filter(c => registryDerivedPurpose('output', c) === purpose)
      .forEach(c => {
        if ([4,11].includes(Number(c.driver)) && Number(c.ignition_mode || 0) !== 0) {
          igniterModeConversions.push({label:(c.name || label) + ' / Igniter mode',
            was:Number(c.ignition_mode) === 2 ? 'Current-limited coil dwell' : 'Dwell / rest PWM cycle',
            now:'Simple on/off (relay capability)'});
          c.ignition_mode = 0;
        }
      });
    const channel = (registryRoot().outputs || []).find(c =>
      registryDerivedPurpose('output', c) === purpose && registryOutputOwnsCorePurpose(c));
    const actuator = cfg.actuators?.[key];
    if (channel && [4,11].includes(Number(channel.driver)) && actuator && (actuator.pwm || actuator.coil)) {
      igniterModeConversions.push({label:label + ' / Igniter mode', was:actuator.coil ? 'Current-limited coil dwell' : 'Dwell / rest PWM cycle', now:'Simple on/off (relay capability)'});
      actuator.pwm = false;
      actuator.coil = false;
    }
  }
  const hasDiRoleInMode = (role, modeBit) =>
    (cfg.di_channels || []).some(ch =>
      (ch?.pin ?? -1) >= 0 &&
      ch.role === role &&
      (((ch.active_modes ?? 0xFF) & modeBit) !== 0));
  if (cfg.platform === 'esp32s3') {
    if (!cfg.actuators) cfg.actuators = {};
    if (!cfg.actuators.status_led) cfg.actuators.status_led = {};
    if (cfg.actuators.status_led.mode === 1) {
      cfg.actuators.status_led.enabled = true;
      cfg.actuators.status_led.type = 1;
    }
    if (cfg.actuators.status_led.enabled !== false && cfg.actuators.status_led.type === undefined) {
      cfg.actuators.status_led.type = 1;
      cfg.actuators.status_led.pin = 48;
    }
    if (cfg.actuators.status_led.type === 1 &&
        (cfg.actuators.status_led.pin === undefined || cfg.actuators.status_led.pin === null ||
         cfg.actuators.status_led.pin < 0 || cfg.actuators.status_led.pin === 38)) {
      cfg.actuators.status_led.pin = 48;
    }
    if (cfg.actuators.status_led.mode === undefined) cfg.actuators.status_led.mode = 0;
    if (cfg.actuators.status_led.standby_color === undefined) cfg.actuators.status_led.standby_color = 0x00FF40;
    if (cfg.actuators.status_led.startup_color === undefined) cfg.actuators.status_led.startup_color = 0x0060FF;
    if (cfg.actuators.status_led.running_color === undefined) cfg.actuators.status_led.running_color = 0x00FF00;
    if (cfg.actuators.status_led.shutdown_color === undefined) cfg.actuators.status_led.shutdown_color = 0xFF8000;
  if (cfg.actuators.status_led.blink_color === undefined) cfg.actuators.status_led.blink_color = 0x0000FF;
  }
  const missing = [];
  const hasRegistryInput = purpose => (registryRoot().inputs || []).some(c =>
    registryDerivedPurpose('input', c) === purpose);
  const hasRegistryOutput = (purpose, id = '') => (registryRoot().outputs || []).some(c =>
    registryDerivedPurpose('output', c) === purpose || (id && c.id === id));
  const requirePin = (obj, key, label) => {
    if (!obj || obj[key] === undefined || obj[key] === null || obj[key] < 0) missing.push(label);
  };
  const usesI2c = [...(registryRoot().inputs || []), ...(registryRoot().outputs || [])]
    .some(channel => Number(channel.driver) >= 8);
  const usesSpi = (registryRoot().inputs || []).some(registryTemperatureIsSpi);
  if (usesI2c && !cfg.i2c?.enabled) missing.push('Shared I2C bus (enable it first)');
  if (usesSpi && !cfg.spi?.enabled) missing.push('Shared SPI bus (enable it first)');
  if (cfg.i2c?.enabled) {
    requirePin(cfg.i2c, 'sda_pin', 'Shared I2C SDA');
    requirePin(cfg.i2c, 'scl_pin', 'Shared I2C SCL');
  }
  if (cfg.spi?.enabled) {
    requirePin(cfg.spi, 'sck_pin', 'Shared SPI SCK');
    requirePin(cfg.spi, 'miso_pin', 'Shared SPI MISO');
    if ((registryRoot().inputs || []).some(channel =>
        registryTemperatureIsSpi(channel) && Number(channel.temp_interface) === 3))
      requirePin(cfg.spi, 'mosi_pin', 'Shared SPI MOSI (MAX31856)');
  }
  if (!registryHasPurpose('input', 'stop_switch')) {
    if (pcbProfileActive()) missing.push('Stop switch PCB connection');
    else requirePin(cfg.controls, 'stop_pin', 'Stop button');
  }
  for (const [key, purpose, label] of [['stop_pin','stop_switch','Stop button'],['start_pin','start_switch','Start button']]) {
    if (registryHasPurpose('input', purpose)) continue;
    const pin = Number(cfg.controls?.[key] ?? -1);
    if (pin >= 0 && (!GPIO_DB?.[pin] || GPIO_DB[pin].r))
      missing.push(`${label} uses GPIO ${pin}, which is unavailable on this target`);
  }
  const sensorPurposes = {
    n1_rpm:'n1_speed', n2_rpm:'n2_speed', oil_press:'oil_pressure', flame:'flame',
    fuel_flow:'fuel_flow', fuel_press:'fuel_pressure', p1:'p1_pressure', p2:'p2_pressure',
    throttle_input:'throttle', idle_input:'idle', batt_voltage:'battery_voltage'
  };
  for (const [key, label] of Object.entries({
    n1_rpm:'N1 RPM', n2_rpm:'N2 RPM', oil_press:'Oil Pressure', flame:'Flame Detector',
    fuel_flow:'Fuel Flow', fuel_press:'Fuel Pressure', p1:'Pressure 1', p2:'Pressure 2',
    throttle_input:'Throttle Input', idle_input:'Idle Input', batt_voltage:'Battery Voltage'
  })) {
    const item = cfg.sensors?.[key];
    if (item?.enabled && !hasRegistryInput(sensorPurposes[key])) requirePin(item, 'pin', label);
  }
  const actuatorPurposes = {
    throttle:'main_fuel', starter:'starter', oil_pump:'oil_pump', oil_scavenge_pump:'scavenge_pump',
    fuel_sol:'fuel_shutoff', igniter:'igniter', igniter2:'ab_igniter', starter_en:'starter_enable',
    ab_sol:'ab_valve', ab_pump:'ab_pump', airstarter_sol:'air_starter', cool_fan:'cooling_fan',
    fuel_pump2:'fuel_pump', bleed_valve:'valve', prop_pitch:'prop_pitch', glow_plug:'glow_plug',
    status_led:'warning_indicator'
  };
  for (const [key, label] of Object.entries({
    throttle:'Main Fuel Metering', starter:'Starter', oil_pump:'Oil Pump',
    oil_scavenge_pump:'Oil Scavenge Pump', fuel_sol:'Main Fuel Shutoff', igniter:'Igniter',
    igniter2:'Afterburner / Secondary Igniter', starter_en:'Starter Enable', ab_sol:'Afterburner Fuel Valve',
    ab_pump:'Afterburner Fuel Pump', airstarter_sol:'Air Starter Valve', cool_fan:'Cooling Fan', fuel_pump2:'Secondary / Auxiliary Fuel Pump',
    bleed_valve:'Bleed Valve', prop_pitch:'Prop Pitch', glow_plug:'Glow Plug',
    status_led:'Status LED'
  })) {
    const item = cfg.actuators?.[key];
    const registryOwned = key === 'bleed_valve'
      ? (registryRoot().outputs || []).some(c => c.id === 'bleed_valve')
      : hasRegistryOutput(actuatorPurposes[key]);
    if (item?.enabled && !registryOwned) requirePin(item, 'pin', label);
  }
  if (cfg.actuators?.glow_plug?.enabled && Number(cfg.actuators.glow_plug.type || 0) === 2) {
    const registryFuel = (registryRoot().outputs || []).some(c =>
      registryDerivedPurpose('output', c) === 'pilot_fuel');
    if (!registryFuel) requirePin(cfg.actuators.glow_plug, 'fuel_pin', 'Wet Glow Fuel');
  }
  for (const [key, label] of [['tot','TOT'], ['tit','TIT']]) {
    const item = cfg.sensors?.[key];
    if (item?.enabled && !hasRegistryInput(key)) {
      requirePin(item, 'clk', label + ' CLK');
      requirePin(item, 'cs', label + ' CS');
      requirePin(item, 'miso', label + ' MISO');
    }
  }
  const ot = cfg.sensors?.oil_temp;
  if (ot?.enabled && !hasRegistryInput('oil_temperature')) {
    if (ot.chip === 'ntc' || ot.chip === 'ds18b20') requirePin(ot, 'pin', 'Oil Temperature');
    else {
      requirePin(ot, 'clk', 'Oil Temperature CLK');
      requirePin(ot, 'cs', 'Oil Temperature CS');
      requirePin(ot, 'miso', 'Oil Temperature MISO');
    }
  }
  const tq = cfg.sensors?.torque;
  if (tq?.enabled && !hasRegistryInput('torque')) {
    if (tq.hx711) {
      requirePin(tq, 'dt_pin', 'Torque HX711 DT');
      requirePin(tq, 'clk_pin', 'Torque HX711 CLK');
    } else requirePin(tq, 'pin', 'Torque Sensor');
  }
  if (cfg.cluster_serial?.enabled) requirePin(cfg.cluster_serial, 'tx_pin', 'Cluster Serial TX');
  if (cfg.buzzer?.enabled) requirePin(cfg.buzzer, 'pin', 'Buzzer');
  if (hardwareHasAfterburner()) {
    const abt = cfg.ab_trigger || {};
    if ((abt.source ?? 0) === 2 && !registryHasPurpose('input','ab_fire'))
      requirePin(abt, 'switch_pin', 'AB trigger switch');
    if ((abt.source ?? 0) === 3 && !registryHasPurpose('input','ab_command'))
      requirePin(abt, 'input_pin', 'AB analog / servo input');
    if ((abt.source ?? 0) !== 0 && abt.requires_arm &&
        !registryHasPurpose('input','ab_arm') && !hasDiRoleInMode('ab_arm', 4))
      requirePin(abt, 'arm_pin', 'AB arm switch');
  }
  // Backend-required pins the validation used to miss — the save looked
  // complete, then the backend rejected it.
  if (cfg.mavlink?.enabled) requirePin(cfg.mavlink, 'tx_pin', 'MAVLink TX');
  for (const [key, label] of [['glow_plug','Glow Current'], ['igniter','Igniter 1 Current'],
                              ['igniter2','Secondary Igniter Current'], ['oil_pump','Oil Pump Current']]) {
    const item = cfg.actuators?.[key];
    if (item?.enabled && item.has_current) requirePin(item, 'current_pin', label);
  }
  (cfg.di_channels || []).forEach((ch, i) => {
    if (ch && ch.role && ch.role !== 'none' && (ch.pin ?? -1) < 0)
      missing.push('DI channel ' + (i + 1) + ' (' + ch.role + ')');
  });
  const registryErrors = registryInvalidDetails();
  if (registryErrors.length) {
    alert('Fix hardware registry channel(s) before saving:\n\n' + registryErrors.map(e => '• ' + e.text).join('\n'));
    focusRegistryInvalid(registryErrors[0]);
    updateSaveButton();
    return;
  }
  // MAX31856 needs MOSI (driver readback-verifies its config registers)
  for (const [key, label] of [['tot','TOT'], ['tit','TIT'], ['oil_temp','Oil Temperature']]) {
    const item = cfg.sensors?.[key];
    if (item?.enabled && item.chip === 'max31856') requirePin(item, 'mosi', label + ' MOSI (MAX31856)');
  }
  if (missing.length) {
    alert('Please set pin for ' + missing.join(', '));
    return;
  }
  // Reversed output ranges: the backend rejects PWM max% < min% and silently
  // resets reversed servo pulse pairs after accepting — name the output here
  // instead of a generic rejection or a value that changes after reboot.
  const rangeErrs = [];
  for (const [key, item] of Object.entries(cfg.actuators || {})) {
    if (!item?.enabled) continue;
    if (item.min_us !== undefined && item.max_us !== undefined &&
        Number(item.max_us) <= Number(item.min_us))
      rangeErrs.push(key + ': servo Max us (' + item.max_us + ') must be above Min us (' + item.min_us + ')');
    if (item.pwm_min_pct !== undefined && item.pwm_max_pct !== undefined &&
        Number(item.pwm_max_pct) < Number(item.pwm_min_pct))
      rangeErrs.push(key + ': PWM Max % (' + item.pwm_max_pct + ') must not be below PWM Min % (' + item.pwm_min_pct + ')');
  }
  if (rangeErrs.length) {
    alert('Fix reversed output ranges before saving:\n\n' + rangeErrs.map(e => '• ' + e).join('\n'));
    return;
  }
  // ── GPIO conflict check ───────────────────────────────────────
  const conflicts = _checkGpioConflicts();
  if (conflicts.length) {
    const lines = conflicts.map(c => `  GPIO ${c.pin}:  ${c.names.join('  +  ')}`).join('\n');
    // Shared SPI bus lines (CLK/MISO/MOSI) are the one legitimate case —
    // confirmable. Everything else is hard-rejected by backend uniqueness
    // validation, so "Proceed anyway?" only led to a failed save.
    const spiOnly = conflicts.every(c => c.names.every(n => /CLK|MISO|MOSI/.test(n)));
    if (!spiOnly) {
      alert('⚠ GPIO conflict — the same pin is assigned to multiple devices:\n\n' + lines +
            '\n\nThe ECU rejects conflicting pin assignments. Fix the highlighted pins before saving.');
      return;
    }
  }

  const idleSource = Number(settingsCfg?.dynamic_idle?.source ?? 0);
  const idleSources = [
    ['N1 shaft speed', registryHasPurpose('input','n1_speed')],
    ['N2 shaft speed', registryHasPurpose('input','n2_speed')],
    ['P1 pressure (experimental)', registryHasPurpose('input','p1_pressure')],
    ['P2 pressure (experimental)', registryHasPurpose('input','p2_pressure')]
  ];
  const idleFallback = idleSources.findIndex(source => source[1]);
  const idleSourceWillChange = !!cfg.controllers?.dynamic_idle &&
    !idleSources[idleSource]?.[1] && idleFallback >= 0;
  const changes = _buildChanges();
  changes.push(...igniterModeConversions);
  if (idleSourceWillChange) {
    changes.push({
      label:'Automatic Idle / Feedback source',
      was:idleSources[idleSource]?.[0] || 'Unknown',
      now:idleSources[idleFallback][0] + ' (automatic fallback)'
    });
  }
  if (!changes.length) {
    // Never reboot from a hardware save that cannot first explain what changed.
    alert('No reviewable hardware changes were found. Nothing was saved or rebooted.\n\nClose and reopen the editor, then try the change again.');
    return;
  }
  const modal    = document.getElementById('save-recap-modal');
  const body     = document.getElementById('save-recap-body');
  const subtitle = document.getElementById('save-recap-subtitle');
  const renamedWifi = (cfg.profile_id || 'OpenTurbine').trim() || 'OpenTurbine';
  const profileWillChange = renamedWifi !== (_loadedProfileId || 'OpenTurbine');
  subtitle.textContent = changes.length + ' field' + (changes.length > 1 ? 's' : '') +
    ' changed. Hardware saves require a reboot — the device will restart.' +
    (profileWillChange ? ` Its Wi-Fi network name will change to “${renamedWifi}”; reconnect to that network afterward.` : '') +
    (idleSourceWillChange ? ' Review the highlighted Automatic Idle feedback-source fallback before continuing.' : '');

  let rows = changes.map(c =>
    `<tr>
      <td>${escapeHtmlText(c.label)}</td>
      <td class="val-was">${escapeHtmlText(c.was)}</td>
      <td class="val-now">${escapeHtmlText(c.now)}</td>
    </tr>`
  ).join('');
  body.innerHTML =
    `<table class="save-recap-table">
      <thead><tr><th>Setting</th><th>Was</th><th>Now</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  const confirmButton = document.getElementById('save-recap-confirm-btn');
  if (confirmButton) confirmButton.disabled = false;
  modal.style.display = 'flex';
}

function _cancelSaveRecap() {
  document.getElementById('save-recap-modal').style.display = 'none';
  // Re-enable save button (it was not disabled — but confirm button may have been)
  const cb = document.getElementById('save-recap-confirm-btn');
  if (cb) cb.disabled = false;
}

async function _doSave() {
  const cb = document.getElementById('save-recap-confirm-btn');
  if (cb) cb.disabled = true;
  document.getElementById('save-recap-modal').style.display = 'none';
  document.getElementById('save-msg').textContent = 'Saving…';
  document.getElementById('btn-save').disabled = true;
  const nextProfileId = (cfg.profile_id || 'OpenTurbine').trim() || 'OpenTurbine';
  const profileChanged = nextProfileId !== (_loadedProfileId || 'OpenTurbine');
  const controller = new AbortController();
  let started = 0;
  let timeout = null;
  let savePosted = false;
  try {
    // Hardware owns this page. Release live telemetry, then send only the
    // hardware document to its dedicated validator/save endpoint; firmware
    // performs dependency cleanup and persists the unified file atomically.
    stopHardwareTelemetry();
    await new Promise(resolve => setTimeout(resolve, 250));
    const saveCfg = {...cfg};
    delete saveCfg._i2c_discovery;
    const hardwarePatch = mergeHardwareEdits(_loadedHardwareCfg, saveCfg, {});
    started = Date.now();
    timeout = setTimeout(() => controller.abort(), 8000);
    savePosted = true;
    const r = await fetch('/api/hardware?source=hardware', {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(hardwarePatch),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const text = await r.text();
    let j = {};
    try { j = text ? JSON.parse(text) : {}; }
    catch (_) {
      if (r.ok) j = { ok:true, reboot:true };
      else throw new Error(text || 'invalid save response');
    }
    if (j.ok) {
      if (window.OTSetup) OTSetup.mark('hardware');
      clearDirty();
      document.getElementById('save-msg').textContent = 'Saved — rebooting…';
      showRebootOverlay(profileChanged ? nextProfileId : '');
    } else {
      const message = friendlyHardwareSaveError(j);
      document.getElementById('save-msg').textContent = 'Not saved — ' + message;
      alert('Hardware was not saved.\n\n' + message);
      updateSaveButton();
    }
  } catch(e) {
    clearTimeout(timeout);
    // Hardware saves intentionally reboot the ESP32. Chrome can keep the POST
    // pending if Wi-Fi drops before the JSON response is fully consumed. Do not
    // leave the page stuck at "Saving..." in that normal reboot window.
    if (savePosted && (e.name === 'AbortError' || Date.now() - started > 1000)) {
      document.getElementById('save-msg').textContent = 'Save response lost — reconnecting…';
      showRebootOverlay(profileChanged ? nextProfileId : '');
    } else {
      document.getElementById('save-msg').textContent = 'Not saved — the ECU could not be reached';
      alert('Hardware was not saved because the ECU could not be reached.\n\nCheck that you are still connected to the OpenTurbine Wi-Fi, then try again.');
      updateSaveButton();
    }
  }
}

function friendlyHardwareSaveError(response) {
  const rawDetail = String(response?.detail || '').trim();
  const detail = rawDetail.toLowerCase();
  const map = [
    ['malformed json', 'The browser produced incomplete setup data. Reload Hardware, repeat the change, and try again.'],
    ['channel registry', 'One of the installed device cards is invalid or incomplete. Check its purpose, signal type, GPIO, and range.'],
    ['hardware dependencies', 'An enabled controller or safety needs hardware that is no longer fitted. Open Controllers, disable the unavailable item, or restore its required device.'],
    ['sequence references', 'A sequence or custom action still refers to a removed device. Open Sequence, fix the unavailable block or action, and save it before retrying Hardware.'],
    ['platform pins', 'A GPIO, electrical range, or sensor interface is not valid for this ESP32 board. Check the red device card and Requirements section.'],
    ['oil loops', 'An automatic oil loop refers to a missing pressure input or oil-pump output. Restore those devices or remove the unused oil loop.'],
    ['profile_desc', 'The engine description is too long. Keep it within 63 UTF-8 bytes and try again.'],
    ['profile_id', 'The engine profile name is missing or too long. Use a short profile name and try again.'],
    ['wifi_password', 'The Wi-Fi password must be empty for an open hotspot or 8–63 characters long.'],
    ['display labels', 'A display label is too long or contains invalid data. Shorten the edited label and try again.'],
    ['custom block strings', 'A custom sequence block contains a name or description that is too long. Shorten it on the Sequence page.'],
    ['n1 pulses', 'N1 pulses per revolution must be greater than zero. Open the N1 input card and correct Pulse scale.'],
    ['n2 pulses', 'N2 pulses per revolution must be greater than zero. Open the N2 input card and correct Pulse scale.']
  ];
  const match = map.find(([key]) => detail.includes(key));
  if (match) return match[1];
  return response?.error
    ? `${response.error}. Review the Requirements section and any red device cards, then try again.`
    : 'The ECU rejected the setup. Review the Requirements section and any red device cards, then try again.';
}

function showRebootOverlay(nextWifiName = '') {
  if (typeof window.OTShowRebootOverlay === 'function') {
    window.OTShowRebootOverlay({nextWifiName, returnPath:location.pathname});
    return;
  }
  const ov = document.getElementById('reboot-overlay');
  ov.style.display = 'flex';
  let secs = 12;
  const t = document.getElementById('reboot-timer');
  const note = document.getElementById('reboot-wifi-note');
  const apUrl = 'http://192.168.4.1' + location.pathname;
  if (note) {
    note.innerHTML = nextWifiName
      ? 'Wi-Fi name changed. Connect to <strong>' + escapeHtmlText(nextWifiName) + '</strong>, then open <a href="' + apUrl + '" style="color:var(--accent)">192.168.4.1</a>.'
      : 'Keep this page open while the ECU restarts. If the browser does not reconnect, open <a href="' + apUrl + '" style="color:var(--accent)">192.168.4.1</a>.';
  }
  const iv = setInterval(() => {
    secs--;
    t.textContent = secs > 0 ? 'Reconnecting in ~' + secs + 's…' : 'Reconnecting…';
    if (secs <= 0) {
      clearInterval(iv);
      if (nextWifiName) {
        t.textContent = 'Connect to Wi-Fi "' + nextWifiName + '" if needed. Redirecting to 192.168.4.1...';
        setTimeout(() => { location.href = apUrl; }, 500);
        return;
      }
      const poll = setInterval(async () => {
        try { const r = await fetch('/api/status',{cache:'no-store'}); if(r.ok){clearInterval(poll);location.reload();} } catch(_) {}
      }, 1000);
    }
  }, 1000);
}

async function resetDefaults() {
  if (!await OTDialog.confirm('Discard unsaved changes and reload the last saved hardware configuration?', {
    title: 'Discard hardware changes?', confirmText: 'Discard changes', danger: true
  })) return;
  await loadHardware();
  document.getElementById('save-msg').textContent = 'Changes discarded — reverted to last saved configuration.';
}

// Backup/restore lives on the Tools page (the card above just links there);
// the old page-local downloadBackup()/handleRestore() helpers were unused
// and have been removed so nobody wires them back by accident.

// Local copy of app.js's applyContextTooltips (this page deliberately does not
// load app.js). Gives every documented .hw-field a hover tooltip built from its
// visible label + description, so a user can hover any control for help without
// reading the docs — matching the other pages that load app.js.
function applyContextTooltips(root) {
  const fallback = {
    'Display name': 'Shown throughout the dashboard, logs, rules and sequence editors. Renaming it does not break saved references.',
    'Display label': 'Human-readable name shown in the dashboard, event log and related UI.',
    'Controller use': 'Core firmware function this fitted device satisfies, such as primary N1 or main fuel output.',
    'Device': 'Fitted hardware device assigned to this core controller use.',
    'Purpose': 'Tells OpenTurbine what this channel does, so rules, safety and sequence blocks can offer the right choices.',
    'Electrical driver': 'Select the real signal type wired to the pin. Changing this changes the valid pin list and the settings shown below.',
    'GPIO pin': 'Physical ESP32 GPIO used by this channel. Leave unassigned only while drafting; save is blocked for installed channels without a pin.',
    'Active polarity': 'Choose which electrical level means active. Active LOW is typical for switches wired to ground with a pull-up.',
    'Internal pull-up': 'Enables the ESP32 internal pull-up resistor. Use for switches to ground; do not use together with pull-down.',
    'Internal pull-down': 'Enables the ESP32 internal pull-down resistor. Use for active-high switches; do not use together with pull-up.',
    'Input bias': 'Select the ESP32 internal pull-up or pull-down used by switch and pulse inputs. Analog and driven inputs leave bias disabled.',
    'Output polarity': 'Use this when the output board is active-low or the PWM/servo demand must be reversed.',
    'Pulses / revolution': 'Number of electrical pulses produced for one shaft revolution. N1/N2 speed cards use this with the PCNT RPM path.',
    'Pulses / litre': 'Fuel-flow sensor calibration. Flow is pulse rate converted to pulses/min, then divided by pulses/litre.',
    'Pulses / unit': 'Pulse scaling used for generic pulse/frequency conversion.',
    'Minimum speed (RPM)': 'Lower RPM endpoint for mapping this speed input.',
    'Maximum speed (RPM)': 'Upper RPM endpoint for mapping this speed input. Extremely high values are accepted for unusual turbines but should be checked against the sensor and counter bandwidth.',
    'Minimum flow (L/min)': 'Lower flow endpoint for mapping this pulse flow input.',
    'Maximum flow (L/min)': 'Upper flow endpoint for mapping this pulse flow input.',
    'Mapped value': 'The firmware maps raw electrical input/output values into the normalized value used by rules and telemetry.',
    'Minimum valid signal (mV)': 'Lowest measured voltage accepted as healthy. Raw ADC counts remain available in diagnostics.',
    'Maximum valid signal (mV)': 'Highest measured voltage accepted as healthy. It must be above the minimum and no higher than 3300 mV.',
    'Minimum frequency (Hz)': 'Input frequency that maps to 0.00. This is a scaling endpoint, not a guaranteed hardware minimum.',
    'Maximum frequency (Hz)': 'Input frequency that maps to 1.00. This is a scaling endpoint, not a guaranteed hardware ceiling; generic registry pulse inputs use interrupt counting sampled every 100 ms, while built-in N1/N2 RPM inputs use the ESP32 PCNT driver.',
    'Minimum mapped value': 'Raw value that maps to 0.00. Must be lower than the maximum.',
    'Maximum mapped value': 'Raw value that maps to 1.00. Must be higher than the minimum.',
    'Minimum pulse width (us)': 'Servo/RC pulse width that maps to the low end of the range. Typical minimum is 1000 us.',
    'Maximum pulse width (us)': 'Servo/RC pulse width that maps to the high end of the range. Typical maximum is 2000 us.',
    'Min pulse (µs)': 'Servo/ESC pulse at 0% command. Typical value is 1000 µs.',
    'Max pulse (µs)': 'Servo/ESC pulse at 100% command. Typical value is 2000 µs.',
    'Servo min/max us': 'Servo/ESC pulse range. Typical range is 1000-2000 us.',
    'Frequency (Hz)': 'PWM carrier frequency. Match the ESC, MOSFET driver or sensor datasheet.',
    'PWM frequency (Hz)': 'PWM carrier frequency. Match the ESC, MOSFET driver or load requirements.',
    'Resolution (bits)': 'PWM resolution. Higher bit depth can reduce the maximum usable PWM frequency.',
    'Min non-zero (%)': 'Smallest output sent for any nonzero demand. Use this when a pump or ESC does not respond below a certain level.',
    'Max output (%)': 'Maximum PWM duty the firmware is allowed to command.',
    'PWM min/max %': 'Minimum and maximum PWM duty used for this output.',
    'Output type': 'Electrical output mode: servo/ESC, PWM, or relay/on-off.',
    'Minimum command (%)': 'Lowest command the firmware may send for this proportional output.',
    'Maximum command (%)': 'Highest command the firmware may send for this proportional output.',
    'Duty at 0% command': 'Physical PWM duty produced by a normalized 0.00 command. This is an electrical endpoint, not the pump minimum-running calibration.',
    'Duty at 100% command': 'Physical PWM duty produced by a normalized 1.00 command.',
    'Pulse at 0% command (us)': 'Physical servo/ESC pulse produced by a normalized 0.00 command.',
    'Pulse at 100% command (us)': 'Physical servo/ESC pulse produced by a normalized 1.00 command.',
    'Post-boot initialization demand': 'Output demand written after firmware gains control; reset and bootloader state depend on external wiring.',
    'Boot safe demand (%)': 'Proportional demand written when outputs initialize or a registry output test ends.',
    'Minimum reliable command (%)': 'Lowest nonzero normalized command that reliably keeps this motor or fan running. It is applied inside the electrical PWM/servo range.',
    'Current sensor ADC': 'ADC-capable pin connected to the current sensor output.',
    'Current sensor ADC GPIO': 'ADC-capable GPIO connected to the current sensor output.',
    'Sensor sensitivity (mV/A)': 'Current sensor sensitivity from the datasheet. Example: ACS712-20A = 100 mV/A.',
    'Sensor mV/A': 'Current sensor sensitivity from the datasheet. Example: ACS712-20A = 100 mV/A.',
    'Zero-current voltage (V)': 'Sensor output voltage at 0 A, usually half supply voltage.',
    'Zero-current voltage': 'Sensor output voltage at 0 A, usually half supply voltage.',
    'Overcurrent limit (A)': 'Trips overcurrent protection above this current. Set 0 to disable the limit.',
    'Ready current (A)': 'Glow plug is considered hot when current has dropped below this value.',
    'Igniter mode': 'Simple relay is on/off. Dwell mode pulses the coil. Current-limited dwell stops charging when current reaches the threshold.',
    'Dwell time (ms)': 'Maximum coil charge time before spark. Keep within the coil/driver safe operating range.',
    'Rest time (ms)': 'Off time between spark pulses so the coil and driver can recover.',
    'Coil saturation current (A)': 'Current threshold that ends coil dwell early in current-limited mode.',
    'Glow mode': 'Plain glow drives only the glow plug. Wet glow also drives a delayed start-fuel output.',
    'Glow PWM frequency (Hz)': 'PWM carrier for glow MOSFET control. Resistive glow elements usually tolerate low PWM frequencies.',
    'PWM resolution (bits)': 'PWM duty resolution. Higher resolution can limit maximum PWM frequency.',
    'Start fuel GPIO': 'Output pin for the wet-glow start fuel solenoid or small pump.',
    'Start fuel driver': 'Electrical driver for the wet-glow fuel output: relay/on-off, PWM, or servo/ESC.',
    'Fuel output mode': 'Electrical driver for the wet-glow start fuel output.',
    'Fuel active polarity': 'Choose whether the wet-glow fuel output is active when the GPIO is high or low.',
    'Fuel active high': 'When enabled, GPIO HIGH turns the wet-glow fuel output on.',
    'Fuel delay (ms)': 'Delay after glow starts before wet-glow start fuel is enabled.',
    'Fuel delay after glow ON (ms)': 'Delay after the glow plug is commanded on before wet-glow start fuel starts.',
    'Fuel demand (%)': 'Demand sent to the wet-glow fuel output while it is active.',
    'Fuel servo pulse (us)': 'Servo/ESC pulse range used by the wet-glow fuel output.',
    'Fuel PWM freq / bits': 'PWM carrier frequency and resolution for the wet-glow fuel output.',
    'Fuel PWM min / max (%)': 'Minimum and maximum duty used by the wet-glow fuel output.',
    'PWM freq / bits': 'PWM carrier frequency and resolution for this output.',
    'CLK pin': 'SPI clock pin shared by thermocouple amplifier chips on the same bus.',
    'CS pin': 'SPI chip-select pin. Each SPI thermocouple amplifier needs its own CS pin.',
    'MISO pin': 'SPI data pin from the thermocouple amplifier to the ESP32.',
    'Cluster serial': 'Enables OpenTurbine cluster-display telemetry over a UART.',
    'Cluster TX GPIO': 'UART transmit pin from ECU to the cluster display.',
    'Cluster RX GPIO': 'Optional UART receive pin. Leave unassigned for one-way telemetry.',
    'Baud rate': 'Must match the receiving device, or the serial link will not decode correctly.',
    'Interval (ms)': 'Telemetry send interval. Lower values update faster but use more serial bandwidth.',
    'MAVLink': 'Enables MAVLink telemetry output for a ground station or companion device.',
    'MAVLink TX GPIO': 'UART transmit pin for MAVLink telemetry.',
    'Status LED': 'Enables a local status LED indicator.',
    'LED type': 'Plain GPIO drives a normal LED. NeoPixel RGB drives a WS2812-style LED.',
    'Status LED GPIO': 'GPIO connected to the LED or NeoPixel data input.',
    'NeoPixel mode': 'Blink pattern keeps code-style flashes. State colors show a color per engine state.',
    'Blink color': 'NeoPixel color used by blink-pattern status mode.',
    'State colors': 'NeoPixel colors used for each engine state.',
    'Buzzer': 'Enables local audible status/fault tones.',
    'Buzzer GPIO': 'GPIO connected to the buzzer driver.'
  };
  (root || document).querySelectorAll('.hw-field').forEach(el => {
    if (el.title) return;
    const lab = el.querySelector('.hw-label, b');
    const des = el.querySelector('.hw-desc');
    const l = lab && lab.textContent ? lab.textContent.trim() : '';
    const d = des && des.textContent ? des.textContent.trim() : (fallback[l] || '');
    if (d) el.title = l ? l + ': ' + d : d;
  });
}

function collapseLegacyPwmTiming() {
  const groups = [
    ['f-thr-lfreq', 'f-thr-lbits'],
    ['f-str-lfreq', 'f-str-lbits'],
    ['f-op-freq', 'f-op-bits'],
    ['f-oscav-freq', 'f-oscav-bits'],
    ['f-abp-freq', 'f-abp-bits'],
    ['f-fan-freq', 'f-fan-bits'],
    ['f-fp2-freq', 'f-fp2-bits'],
    ['f-bleed-freq', 'f-bleed-bits'],
    ['f-pp-freq', 'f-pp-bits'],
    ['f-glow-freq', 'f-glow-bits'],
    ['f-wetglow-freq', 'f-wetglow-bits']
  ];
  groups.forEach(ids => {
    const fields = ids.map(id => document.getElementById(id)?.closest('.hw-field')).filter(Boolean);
    if (!fields.length || fields[0].closest('details.source-pwm-advanced')) return;
    const parent = fields[0].parentElement;
    if (!parent) return;
    const details = document.createElement('details');
    details.className = 'source-pwm-advanced';
    details.style.gridColumn = '1 / -1';
    const summary = document.createElement('summary');
    summary.textContent = 'Advanced PWM timing';
    const desc = document.createElement('div');
    desc.className = 'hw-desc';
    desc.textContent = 'Normally leave this at the firmware default. Change only when the ESC, MOSFET driver, or load requires a specific carrier or duty resolution.';
    const grid = document.createElement('div');
    grid.className = 'hw-grid';
    grid.style.marginTop = '.45rem';
    details.append(summary, desc, grid);
    parent.insertBefore(details, fields[0]);
    fields.forEach(field => grid.appendChild(field));
  });
}

window.addEventListener('load', async () => {
  updateHardwareUnitButtons();
  collapseLegacyPwmTiming();
  // Load the comparatively large editor document before starting live polls.
  // On Classic, constructing both responses at once can temporarily consume
  // every affordable HTTP/TCP allocation and leave the page half-loaded.
  // Hardware indicators do not need telemetry until their cards exist.
  const loaded = await loadHardware();
  if (loaded) startStatusPoll();
  applyContextTooltips();
});
