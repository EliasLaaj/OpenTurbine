function clearUnusedTcaInterrupt() {
  const hasTcaInput = (registryRoot().inputs || []).some(row => Number(row?.driver) === 8);
  if (!hasTcaInput && cfg.i2c) cfg.i2c.interrupt_pin = -1;
}

function pumpFlowPurpose(output) {
  const purpose = registryDerivedPurpose('output', output);
  return purpose === 'oil_pump' || output?.role === 'oil_pump' ? 'oil_flow' : purpose === 'scavenge_pump' ? 'scavenge_flow' : '';
}

function pumpFlowInput(output) {
  const purpose = pumpFlowPurpose(output);
  if (!purpose) return {channel:null, index:-1};
  const r = registryRoot();
  const inputs = r.inputs || [];
  let index = output?.flow_input
    ? inputs.findIndex(row => row.id === output.flow_input && registryDerivedPurpose('input', row) === purpose)
    : -1;
  if (index < 0 && !output?.flow_input) {
    // Old single-pump configs had no explicit link. Migrate only when both the
    // pump and its compatible flow input are unique; registry order must never
    // decide which physical device owns a safety monitor.
    const pumps = (r.outputs || []).filter(row => pumpFlowPurpose(row) === purpose);
    if (pumps.length === 1 && pumps[0] === output) {
      const claimed = new Set(pumps.map(row => row.flow_input).filter(Boolean));
      const compatible = inputs.map((row, candidateIndex) => ({row, candidateIndex})).filter(({row}) =>
        registryDerivedPurpose('input', row) === purpose && !claimed.has(row.id));
      if (compatible.length === 1) index = compatible[0].candidateIndex;
    }
  }
  return {channel:index >= 0 ? inputs[index] : null, index};
}

function removePumpFlowInput(output) {
  const {channel, index} = pumpFlowInput(output);
  if (!channel || index < 0) return;
  cleanupRegistryReferences('input', channel.id);
  shiftRegistryNumericHandlesAfterRemoval('input', index, registryRoot().inputs.length);
  registryRoot().inputs.splice(index, 1);
  _registryEditOpen.clear();
}

function setPumpFlowSensorEnabled(outputIndex, enabled) {
  const outputs = registryRoot().outputs || [];
  const output = outputs[outputIndex];
  const purpose = pumpFlowPurpose(output);
  if (!output || !purpose) return;
  if (enabled && pcbProfileActive()) {
    alert('A PCB profile must declare and assign the pump flow-meter connection. Raw profile wiring cannot be created from this card.');
    renderRegistryInventory();
    return;
  }
  let {channel} = pumpFlowInput(output);
  if (enabled && !channel) {
    if ((registryRoot().inputs || []).length >= registryCapacity('input')) {
      alert('Input registry capacity is full. Remove an unused input before adding this flow sensor.');
      return;
    }
    const main = purpose === 'oil_flow';
    const baseId = registryUniqueId(`${purpose}_${String(output.id || 'pump').replace(/[^a-zA-Z0-9_-]/g,'_')}`);
    if (!baseId) {
      alert('Could not create a unique flow-sensor reference. Rename the pump card and try again.');
      return;
    }
    channel = {
      id:baseId, name:main ? 'Oil Flow' : 'Scavenge Flow', purpose, role:'flow',
      driver:2, pin:-1, min:0, max:1, invert:false, active_high:true,
      pullup:false, pulldown:false, pulses_per_unit:1000
    };
    registryRoot().inputs.push(channel);
  } else if (!enabled && channel) {
    removePumpFlowInput(output);
  }
  if (enabled && channel) output.flow_input = channel.id;
  output.has_flow_monitor = !!enabled;
  if (!enabled) delete output.flow_input;
  if (enabled && !(Number(output.minimum_flow_l_min) > 0)) output.minimum_flow_l_min = 0.1;
  cleanupOilFlowShutdownDependency();
  refreshAllPins(); dirty(); updateSaveButton(); renderRegistryInventory();
}

function updateRegistryChannel(direction, index, key, value) {
  const r = registryRoot();
  const c = r[direction + 's'][index];
  if (!c) return;
  if (key === 'pin') value = Number.isFinite(value) ? value : -1;
  if (direction === 'input' && (key === 'loadcell_gain' || key === 'loadcell_rate_sps')) {
    value = Number(value);
    (r.inputs || []).forEach(row => {
      if (Number(row.driver) === 10 &&
          Number(row.i2c_address || 42) === Number(c.i2c_address || 42))
        row[key] = value;
    });
    dirty(); updateSaveButton(); renderRegistryInventory(); return;
  }
  if (key === 'driver') {
    if ((direction === 'input' && ![0,1,2,3,7,8,9,10].includes(value)) || (direction === 'output' && ![4,5,6,11].includes(value))) return;
    if (!registryAllowedDrivers(direction, c.role, registryDerivedPurpose(direction,c)).includes(value)) return;
    if (value >= 8 && !pcbProfileActive() && !cfg.i2c?.enabled) {
      alert('Enable the shared I2C bus near the top of Hardware before choosing an I2C device.');
      document.getElementById('hardware-buses-panel')?.scrollIntoView({behavior:'smooth',block:'start'});
      return;
    }
    const range = registryDefaultRange(direction, value, c.role);
    c.min = range.min;
    c.max = range.max;
    if (direction === 'input' && ![1,9].includes(Number(value))) c.calibration_points = [];
     c[key] = value;
     if (direction === 'input') clearUnusedTcaInterrupt();
     if (value >= 8) {
       c.pin = -1;
       c.temp_interface = 0;
       c.torque_interface = 0;
       c.device_channel = Number(c.device_channel || 0);
       const expected = value === 8 || value === 11 ? 'TCA9554' : value === 9 ? 'TLA2528' : 'NAU7802';
       const detected = (cfg._i2c_discovery?.devices || []).find(d=>d.type===expected && d.present);
       c.i2c_address = Number(detected?.address || 0);
       if (value === 9) {
         c.i2c_reference_mv = Number(c.i2c_reference_mv || 3300);
         c.filter_alpha = Number(c.filter_alpha || 1);
       }
       if (value === 10) {
         c.loadcell_gain = Number(c.loadcell_gain || 128); c.loadcell_rate_sps = Number(c.loadcell_rate_sps || 80);
         c.loadcell_zero = Number(c.loadcell_zero || 0); c.loadcell_n_per_count = Number(c.loadcell_n_per_count || 1);
         c.lever_arm_m = Number(c.lever_arm_m || 1); c.filter_alpha = Number(c.filter_alpha || 0.25);
       }
     }
      if (direction === 'output' && value === 5) {
       c.pwm_freq_hz = Number(c.pwm_freq_hz ?? 5000) || 5000;
       c.pwm_res_bits = Number(c.pwm_res_bits ?? 10) || 10;
     }
    if (direction === 'input' && value === 1 && (c.pin ?? -1) >= 0 && !GPIO_DB?.[c.pin]?.adc1) c.pin = -1;
    if (direction === 'input' && (value === 1 || value === 9)) {
      c.pullup = false; c.pulldown = false; c.active_high = true;
      const cal = registryDefaultAnalogCalibration(c.role);
      c.analog_zero_mv = cal.analog_zero_mv;
      c.analog_mv_per_unit = cal.analog_mv_per_unit;
      c.analog_divider = cal.analog_divider;
    }
    if (direction === 'input' && value === 0 && c.active_high === undefined) c.active_high = true;
    dirty(); updateSaveButton(); renderRegistryInventory();
    return;
  }
  if (key === 'purpose') {
    const def = registryPurposeDefinitions(direction).find(p => p.value === value);
    if (!def) return;
    const oldPurpose = registryDerivedPurpose(direction,c);
    c.purpose = def.value;
    c.role = def.role;
    c.calibration_points = [];
    if (direction === 'output' && ['oil_pump','scavenge_pump'].includes(oldPurpose) && oldPurpose !== def.value) {
      removePumpFlowInput({...c, purpose:oldPurpose});
      c.has_flow_monitor = false;
    }
    if (!def.drivers.includes(Number(c.driver))) {
      c.driver = def.drivers[0];
      const range = registryDefaultRange(direction, c.driver, c.role);
      c.min = range.min; c.max = range.max;
    }
    if (direction === 'input') {
      if (c.role !== 'temperature') c.temp_interface = 0;
      // Do not retain an interface that the new purpose cannot use. Without
      // this, changing Coolant/Intake to TOT could leave a hidden DS18B20/NTC
      // selection, and the inverse change could retain hidden SPI pins.
      if (['coolant_temp','intake_temperature'].includes(def.value) && Number(c.temp_interface) >= 1 && Number(c.temp_interface) <= 3) c.temp_interface = 0;
      if (['tot','tit'].includes(def.value) && [4,5].includes(Number(c.temp_interface))) c.temp_interface = 0;
      if (registryIsSwitchRole(c.role) || (def.value === 'idle' && Number(c.driver) === 0)) {
        c.active_high = false; c.pullup = true; c.pulldown = false;
      } else if ([1,9].includes(Number(c.driver))) {
        c.pullup = false; c.pulldown = false;
      }
      if (direction === 'output' && value === 4) c.min_run_demand = 0;
    }
    const bindingForPurpose = {
      n1_speed:'primary_n1', n2_speed:'primary_n2', tot:'primary_egt', throttle:'operator_throttle', idle:'operator_idle',
      main_fuel:'main_fuel_output', fuel_shutoff:'main_fuel_shutoff', starter:'main_starter',
      starter_enable:'starter_enable_output', oil_pump:'primary_oil_pump', scavenge_pump:'primary_scavenge_pump',
      cooling_fan:'primary_cooling_fan', bleed_valve:'primary_bleed_valve', fuel_pump:'primary_aux_fuel_pump',
      igniter:'primary_igniter', ab_igniter:'primary_secondary_igniter', ab_valve:'primary_ab_valve',
      glow_plug:'primary_glow_plug', ab_pump:'primary_ab_pump', prop_pitch:'primary_prop_pitch',
      air_starter:'primary_air_starter'
    };
    const managedKeys = new Set(Object.values(bindingForPurpose));
    registryRoot().bindings = (registryRoot().bindings || []).filter(b => !(String(b.channel||'') === String(c.id) && managedKeys.has(String(b.key||''))));
    const bindingKey = bindingForPurpose[def.value];
    if (bindingKey) {
      const existing = registryRoot().bindings.find(b => String(b.key||'') === bindingKey);
      const otherOwner = (registryRoot()[direction + 's'] || []).some(row =>
        row !== c && registryDerivedPurpose(direction, row) === def.value);
      // Re-purposing a spare output must not silently steal a running
      // controller from an established card. Existing ownership changes only
      // through the explicit Advanced binding control. For the first card,
      // create the convenience binding as before.
      if (!otherOwner) {
        if (existing) existing.channel = c.id;
        else if (registryRoot().bindings.length < 24) registryRoot().bindings.push({key:bindingKey,channel:c.id});
      }
    }
    if ((!c.name || !String(c.name).trim()) && oldPurpose !== def.value) c.name = def.label.slice(0,23);
    dirty(); updateSaveButton(); renderRegistryInventory(); return;
  }
  if (key === 'role') {
    const allowed = (direction === 'input' ? REGISTRY_INPUT_ROLES : REGISTRY_OUTPUT_ROLES).some(([r]) => r === value);
    if (!allowed) return;
    c.role = value;
    c.calibration_points = [];
    if (!registryAllowedDrivers(direction, value, registryDerivedPurpose(direction,c)).includes(Number(c.driver))) {
      c.driver = registryAllowedDrivers(direction, value, registryDerivedPurpose(direction,c))[0];
      const range = registryDefaultRange(direction, c.driver, value);
      c.min = range.min;
      c.max = range.max;
    }
    if (direction === 'input' && registryIsSwitchRole(value)) {
      c.active_high = false;
      c.pullup = true;
      c.pulldown = false;
    }
    if (direction === 'input' && [1,9].includes(Number(c.driver))) {
      const cal = registryDefaultAnalogCalibration(value);
      if (c.analog_zero_mv === undefined) c.analog_zero_mv = cal.analog_zero_mv;
      if (c.analog_mv_per_unit === undefined) c.analog_mv_per_unit = cal.analog_mv_per_unit;
      if (c.analog_divider === undefined) c.analog_divider = cal.analog_divider;
    }
    dirty(); updateSaveButton(); renderRegistryInventory();
    return;
  }
  if (key === 'invert') value = !!value;
  if (key === 'ntc_pullup') value = !!value;
  if (key === 'active_high') value = !!value;
  if (key === 'pullup') { value = !!value; if (value) c.pulldown = false; }
  if (key === 'pulldown') { value = !!value; if (value) c.pullup = false; }
  if (key === 'has_current') {
    value = !!value;
    if (value) {
      if (c.current_mv_a === undefined || Number(c.current_mv_a) <= 0) c.current_mv_a = 100;
      if (c.current_zero_v === undefined) c.current_zero_v = 1.65;
      if (c.current_max_a === undefined) c.current_max_a = 0;
      if (registryDerivedPurpose(direction, c) === 'glow_plug' && c.current_ready_a === undefined) c.current_ready_a = 3;
      if (c.current_trip_delay_ms === undefined) c.current_trip_delay_ms = 5000;
    } else {
      c.current_pin = -1;
    }
  }
  if (key === 'current_pin') value = Number.isFinite(value) ? value : -1;
  if (key === 'torque_interface') {
    value = Number(value) === 1 ? 1 : 0;
    c.driver = 1; c.min = 0; c.max = 4095; c.torque_interface = value;
    if (value === 1) c.calibration_points = [];
    if (value === 1) {
      c.hx711_clk ??= -1; c.hx711_scale ??= 1; c.hx711_zero ??= 0;
    } else if ((c.pin ?? -1) >= 0 && !GPIO_DB?.[c.pin]?.adc1) {
      c.pin = -1;
    }
    syncRegistryTorqueAdapter(c);
    dirty(); updateSaveButton(); renderRegistryInventory(); return;
  }
  if (key === 'temp_interface') {
    value = Math.max(0, Math.min(5, Number(value) || 0));
    if (value >= 1 && value <= 3 && !pcbProfileActive() && !cfg.spi?.enabled) {
      alert('Enable the shared SPI bus near the top of Hardware before choosing an SPI thermocouple amplifier.');
      document.getElementById('hardware-buses-panel')?.scrollIntoView({behavior:'smooth',block:'start'});
      renderRegistryInventory();
      return;
    }
    c[key] = value;
    if (![0,4].includes(value)) c.calibration_points = [];
    if (value >= 1 && value <= 3) {
      c.pin = -1; c.spi_cs ??= -1; c.tc_type ??= 'K';
      syncSharedSpiChannels();
    }
    if (value === 4) { c.pin ??= -1; c.ntc_beta ??= 3950; c.ntc_r0 ??= 10000; c.ntc_r_fixed ??= 10000; }
    if (value === 5) { c.pin ??= -1; c.temp_resolution ??= 10; }
    dirty(); updateSaveButton(); renderRegistryInventory(); return;
  }
  if (key === 'pulses_per_unit') value = Math.max(0.001, Number(value) || 1);
  if (key === 'analog_zero_mv') value = Math.max(0, Math.min(3300, Number(value) || 0));
  if (key === 'analog_mv_per_unit') value = Math.max(0.000001, Number(value) || 1);
  if (key === 'analog_divider') value = Math.max(1, Math.min(100, Number(value) || 1));
  if (key === 'ntc_beta' || key === 'ntc_r0' || key === 'ntc_r_fixed') value = Math.max(0.001, Number(value) || 1);
  if (key === 'temp_resolution') value = Math.max(9, Math.min(12, Number(value) || 10));
  if (key === 'hx711_clk') value = Number.isFinite(value) ? value : -1;
  if (key === 'hx711_scale') value = Math.max(0.000001, Math.min(1000000, Number(value) || 1));
  if (key === 'hx711_zero') value = Math.round(Number(value) || 0);
  if (key === 'current_mv_a') value = Math.max(0.001, Number(value) || 100);
  if (key === 'current_zero_v') value = Math.max(0, Math.min(3.3, Number(value) || 0));
  if (key === 'current_max_a') value = Math.max(0, Number(value) || 0);
  if (key === 'current_ready_a') value = Math.max(0, Number(value) || 0);
  if (key === 'current_trip_delay_ms') value = Math.max(100, Math.min(60000, Math.round(Number(value) || 5000)));
  if (key === 'ignition_mode') value = Math.max(0, Math.min(2, Math.round(Number(value) || 0)));
  if (key === 'ignition_dwell_ms' || key === 'ignition_rest_ms') value = Math.max(1, Math.min(200, Math.round(Number(value) || 1)));
  if (key === 'ignition_coil_sat_a') value = Math.max(0.001, Math.min(1000, Number(value) || 8));
  if (key === 'ignition_preheat_ms' || key === 'paired_output_delay_ms') value = Math.max(0, Math.min(3600000, Math.round(Number(value) || 0)));
  if (key === 'ignition_hot_timeout_ms') value = Math.max(100, Math.min(3600000, Math.round(Number(value) || 30000)));
  if (key === 'ignition_peak_demand' || key === 'ignition_hold_demand' || key === 'paired_output_demand') value = Math.max(0, Math.min(1, Number(value) || 0));
  if (key === 'ignition_wait_hot') value = !!value;
  if (key === 'paired_output') value = String(value || '');
  if (key === 'minimum_flow_l_min') value = Math.max(0.001, Number(value) || 0.1);
  if (key === 'safe_demand') value = Math.max(0, Math.min(1, Number(value) || 0));
  if (key === 'min_run_demand') value = Math.max(0, Math.min(1, Number(value) || 0));
  if (key === 'min' || key === 'max') value = Number.isFinite(Number(value)) ? Number(value) : 0;
  c[key] = value;
  if (key.startsWith('ignition_') || key.startsWith('paired_output')) {
    // Once any device-local ignition field is edited, persist the complete
    // profile so the remaining values cannot silently fall back to globals.
    c.ignition_mode ??= 0;
    c.ignition_dwell_ms ??= 6;
    c.ignition_rest_ms ??= 3;
    c.ignition_coil_sat_a ??= 8;
    c.ignition_preheat_ms ??= 10000;
    c.ignition_peak_demand ??= .8;
    c.ignition_hold_demand ??= .3;
    c.ignition_wait_hot ??= false;
    c.ignition_hot_timeout_ms ??= 30000;
    c.paired_output ??= '';
    c.paired_output_delay_ms ??= 8000;
    c.paired_output_demand ??= 1;
    const actKey = registryCoreActuatorKey(c);
    if (actKey === 'igniter' || actKey === 'igniter2') {
      const act = ensureActuatorObject(actKey);
      act.pwm = c.ignition_mode === 1;
      act.coil = c.ignition_mode === 2;
      act.dwell_ms = c.ignition_dwell_ms;
      act.rest_ms = c.ignition_rest_ms;
      act.coil_sat_a = c.ignition_coil_sat_a;
    } else if (actKey === 'glow_plug') {
      const act = ensureActuatorObject(actKey);
      act.type = c.paired_output ? 2 : 0;
      act.fuel_delay_ms = c.paired_output_delay_ms;
      act.fuel_demand_pct = c.paired_output_demand * 100;
    }
  }
  if (direction === 'input' && registryTemperatureIsSpi(c) &&
      ['spi_cs','tc_type'].includes(key)) syncSharedSpiChannels();
  if (direction === 'input' && registryDerivedPurpose(direction, c) === 'torque') syncRegistryTorqueAdapter(c);
  dirty(); updateSaveButton();
  if (['pin','current_pin','spi_clk','spi_cs','spi_miso','spi_mosi','hx711_clk',
       'pullup','pulldown','active_high','invert','ntc_pullup','has_current','has_flow_monitor',
       'min_run_demand','force_safe_on_fault','ignition_mode','ignition_wait_hot','paired_output'].includes(key)) renderRegistryInventory();
}
function syncRegistryTorqueAdapter(c) {
  if (!cfg.sensors) cfg.sensors = {};
  const runtimeTorque = cfg.sensors.torque ||= {};
  const hx = registryTorqueIsHx711(c);
  runtimeTorque.enabled = true;
  runtimeTorque.hx711 = hx;
  runtimeTorque.pin = hx ? -1 : Number(c.pin ?? -1);
  runtimeTorque.dt_pin = hx ? Number(c.pin ?? -1) : -1;
  runtimeTorque.clk_pin = hx ? Number(c.hx711_clk ?? -1) : -1;
  runtimeTorque.hx_scale = Number(c.hx711_scale ?? 1);
  runtimeTorque.hx_zero = Math.round(Number(c.hx711_zero ?? 0));
  if (!hx) {
    const mvPerNm = Math.max(0.000001, Number(c.analog_mv_per_unit ?? 1000));
    runtimeTorque.scale = 1000 / mvPerNm;
    runtimeTorque.offset = Number(c.analog_zero_mv ?? 0) / mvPerNm;
  }
}
function registryBindingAccepts(key, direction, c) {
  const purpose = registryDerivedPurpose(direction,c);
  const requirements = {
    primary_n1:['input',['n1_speed']], primary_n2:['input',['n2_speed']], primary_egt:['input',['tot','tit']],
    operator_throttle:['input',['throttle']], operator_idle:['input',['idle']], main_fuel_output:['output',['main_fuel']],
    main_fuel_shutoff:['output',['fuel_shutoff']], main_starter:['output',['starter']],
    starter_enable_output:['output',['starter_enable']], primary_oil_pump:['output',['oil_pump']],
    primary_scavenge_pump:['output',['scavenge_pump']], primary_cooling_fan:['output',['cooling_fan']],
    primary_bleed_valve:['output',['bleed_valve']], primary_aux_fuel_pump:['output',['fuel_pump']],
    primary_igniter:['output',['igniter']], primary_secondary_igniter:['output',['ab_igniter']],
    primary_ab_valve:['output',['ab_valve']], primary_glow_plug:['output',['glow_plug']],
    primary_ab_pump:['output',['ab_pump']], primary_prop_pitch:['output',['prop_pitch']],
    primary_air_starter:['output',['air_starter']]
  };
  const req = requirements[String(key||'')];
  return !req || (direction === req[0] && req[1].includes(purpose));
}
function registryChannelOptions(selected, key) {
  const r = registryRoot();
  const inputs = r.inputs.map(c => ['input', c]);
  const outputs = r.outputs.map(c => ['output', c]);
  return inputs.concat(outputs).filter(([dir,c])=>registryBindingAccepts(key,dir,c)).map(([dir, c]) =>
    `<option value="${escapeHtmlText(c.id)}"${c.id===selected?' selected':''}>${escapeHtmlText(registryDisplayName(dir, c, c.id))} (${escapeHtmlText(registryPurposeLabel(dir,c))})</option>`
  ).join('');
}
const REGISTRY_BINDING_LABELS = {
  primary_n1:'Primary N1 speed sensor',
  primary_n2:'Primary N2 speed sensor',
  primary_egt:'Main turbine-gas temperature sensor',
  main_fuel_output:'Main fuel metering output',
  main_fuel_shutoff:'Fuel shutoff output',
  main_starter:'Starter output',
  starter_enable_output:'Starter enable output',
  primary_oil_pump:'Primary oil pump',
  primary_scavenge_pump:'Primary scavenge pump',
  primary_cooling_fan:'Primary cooling fan',
  primary_bleed_valve:'Primary bleed valve',
  primary_aux_fuel_pump:'Primary auxiliary fuel pump',
  primary_igniter:'Primary igniter',
  primary_secondary_igniter:'Primary secondary / afterburner igniter',
  primary_ab_valve:'Primary afterburner fuel valve',
  primary_glow_plug:'Primary glow plug',
  primary_ab_pump:'Primary afterburner pump',
  primary_prop_pitch:'Primary propeller-pitch output',
  primary_air_starter:'Primary air-starter valve',
  operator_throttle:'Throttle input',
  operator_idle:'Idle input'
};
const REGISTRY_BINDING_KEYS = Object.keys(REGISTRY_BINDING_LABELS);
function registryBindingLabel(key) {
  const raw = String(key || '');
  return REGISTRY_BINDING_LABELS[raw] || registryHumanizeIdentifier(raw, '');
}
function registryBindingChannelLabel(channelId, key) {
  const r = registryRoot();
  const rows = (r.inputs || []).map(c => ['input', c]).concat((r.outputs || []).map(c => ['output', c]));
  const found = rows.find(([dir, c]) => String(c.id || '') === String(channelId || '') && registryBindingAccepts(key, dir, c));
  if (found) return registryDisplayName(found[0], found[1], channelId);
  const any = rows.find(([, c]) => String(c.id || '') === String(channelId || ''));
  if (any) return registryDisplayName(any[0], any[1], channelId);
  return channelId ? registryHumanizeIdentifier(channelId, '') : 'No channel selected';
}
function renderRegistryBindings() {
  const r = registryRoot();
  const el = document.getElementById('registry-bindings');
  if (!el) return;
  const rows = r.bindings.length ? r.bindings.map((b, i) => {
    const keys = Array.from(new Set([String(b.key || ''), ...REGISTRY_BINDING_KEYS].filter(Boolean)));
    return `<div class="hw-item-card" style="margin:.3rem 0">
    <div class="hw-grid">
      <div class="hw-field">
        <span class="hw-label">Controller use</span>
        <select aria-label="Controller use ${i + 1}" onchange="updateRegistryBinding(${i},'key',this.value)">
          ${keys.map(k => `<option value="${k}"${String(b.key || '')===k?' selected':''}>${escapeHtmlText(registryBindingLabel(k))}</option>`).join('')}
        </select>
      </div>
      <div class="hw-field">
        <span class="hw-label">Device</span>
        <select aria-label="Controller device ${i + 1}" onchange="updateRegistryBinding(${i},'channel',this.value)">${registryChannelOptions(b.channel || '', b.key || '')}</select>
      </div>
      <div style="display:flex;align-items:end;justify-content:flex-end"><button type="button" class="danger remove-action" onclick="removeRegistryBinding(${i})">Remove</button></div>
    </div>
  </div>`;
  }).join('') : '<div class="hw-desc">No controller links configured. Purpose selections normally create these automatically.</div>';
  el.innerHTML = `<details class="hw-advanced" style="margin-top:.65rem">
    <summary>Internal device links — advanced (${r.bindings.length})</summary>
    <div class="hw-desc" style="margin:.45rem 0 .55rem"><strong>This does not select idle or governor behaviour.</strong> These links only identify which physical card supplies each core ECU signal. They are created automatically from each device's Purpose. Edit them only when several devices have the same purpose and the automatic choice is not the one you want. Choose N1/N2 idle feedback and governor tuning on the Controllers page.</div>
    ${rows}
  </details>`;
}
function updateRegistryBinding(index, key, value) {
  const r = registryRoot();
  if (!r.bindings[index]) return;
  if (key === 'key' && !/^[A-Za-z0-9_-]{0,19}$/.test(value)) return;
  r.bindings[index][key] = value;
  if (key === 'key') {
    const selected = r.bindings[index].channel;
    const root = registryRoot();
    const candidates = (root.inputs || []).map(c => ['input', c]).concat((root.outputs || []).map(c => ['output', c]));
    const ok = candidates.some(([dir, c]) => String(c.id || '') === String(selected || '') && registryBindingAccepts(value, dir, c));
    if (!ok) r.bindings[index].channel = '';
    renderRegistryBindings();
  }
  dirty(); updateSaveButton();
}
function removeRegistryBinding(index) {
  const r = registryRoot();
  r.bindings.splice(index, 1);
  renderRegistryBindings(); dirty(); updateSaveButton();
}
let _registryAddDirection = 'input';
let _pendingRegistryRemove = null;
function openRegistryAddDialog(direction) {
  _registryAddDirection = direction === 'output' ? 'output' : 'input';
  const title = document.getElementById('registry-add-title');
  if (title) title.textContent = _registryAddDirection === 'input' ? 'Add input' : 'Add output';
  const description = document.getElementById('registry-add-description');
  if (description) description.textContent = pcbProfileActive()
    ? 'Choose what the ECU should use, then select the labelled PCB connector where it is wired.'
    : 'Choose what the ECU should use. The device card opens next so you can assign its GPIO, electrical signal, and calibration.';
  const search = document.getElementById('registry-add-search');
  if (search) {
    search.value = '';
    search.style.display = '';
  }
  const err = document.getElementById('registry-add-error');
  if (err) err.style.display = 'none';
  document.getElementById('registry-add-modal').style.display = 'flex';
  const panel = document.querySelector('#registry-add-modal .registry-add-panel');
  if (panel) panel.scrollTop = 0;
  renderRegistryAddCatalog();
  setTimeout(() => search?.focus(), 0);
}
function closeRegistryAddDialog() {
  const modal = document.getElementById('registry-add-modal');
  if (modal) modal.style.display = 'none';
}
function openRegistryBusPrerequisite(bus) {
  const key = bus === 'i2c' ? 'i2c' : 'spi';
  closeRegistryAddDialog();
  _workflowEditOpen.add('buses');
  renderHardwareWorkflowSummaries();
  const panel = document.getElementById('hardware-buses-panel');
  panel?.scrollIntoView({behavior:'smooth', block:'start'});
  document.getElementById(`en-${key}`)?.focus();
}
function renderRegistryAddCatalog() {
  const box = document.getElementById('registry-add-catalog');
  if (!box) return;
  const presets = _registryAddDirection === 'input' ? REGISTRY_INPUT_PRESETS : REGISTRY_OUTPUT_PRESETS;
  const q = (document.getElementById('registry-add-search')?.value || '').trim().toLowerCase();
  const r = registryRoot();
  const used = (r[_registryAddDirection + 's'] || []).length;
  const max = registryCapacity(_registryAddDirection);
  const rows = presets
    .map((p, i) => ({p, i}))
    .filter(({p}) => !(_registryAddDirection === 'input' && ['oil_flow','scavenge_flow'].includes(p.purpose)))
    .filter(({p}) => !q || [p.group, p.label, p.name, p.purpose, p.role, p.id].some(v => String(v).toLowerCase().includes(q)));
  const capacity = `<div class="registry-add-capacity ${used >= max ? 'registry-add-capacity-full' : ''}" title="Firmware registry capacity is ${max} ${_registryAddDirection} channels on this build.">${used}/${max} ${_registryAddDirection} slots used${used >= max ? ' — capacity full; remove an unused channel before adding another.' : ''}</div>`;
  if (!rows.length) {
    box.innerHTML = capacity + '<div class="hw-desc">No matching hardware type.</div>';
    return;
  }
  const groups = [];
  rows.forEach(row => {
    let group = groups.find(g => g.name === (row.p.group || 'Other'));
    if (!group) { group = {name: row.p.group || 'Other', rows: []}; groups.push(group); }
    group.rows.push(row);
  });
  box.innerHTML = capacity + groups.map(group => `<div class="registry-add-group">
    <div class="registry-add-group-title">${escapeHtmlText(group.name)}</div>
    <div class="registry-add-group-grid">${group.rows.map(({p, i}) => {
      const purpose = p.purpose || registryDerivedPurpose(_registryAddDirection, p);
      const alreadyInstalled = registryPurposeIsSingleton(_registryAddDirection, purpose) &&
        (r[_registryAddDirection + 's'] || []).some(c => registryDerivedPurpose(_registryAddDirection, c) === purpose);
      const disabled = used >= max || alreadyInstalled;
      const detail = alreadyInstalled ? 'Already installed' : (used >= max ? 'Capacity full' :
        (pcbProfileActive() ? 'Choose a compatible PCB connector' :
          (Number(p.temp_interface) === 2 ? 'MAX31855 K-type default' : `${driverName(p.driver)} default`)));
      const description = registryPresetDescription(_registryAddDirection, p);
      const title = alreadyInstalled
        ? `${p.label} is already installed. Edit or remove its existing card instead.`
        : `${p.label}: ${description} Pin and detailed settings are edited after it is added.`;
      return `<button type="button" class="registry-add-option" title="${escapeHtmlText(title)}" ${disabled ? 'disabled aria-disabled="true"' : ''} onclick="selectRegistryAddPreset(${i})">${escapeHtmlText(p.label)}<small>${escapeHtmlText(description)}</small><small class="registry-add-default">${escapeHtmlText(detail)}</small></button>`;
    }).join('')}</div>
  </div>`).join('');
  applyContextTooltips(box);
}
function selectRegistryAddPreset(index) {
  const presets = _registryAddDirection === 'input' ? REGISTRY_INPUT_PRESETS : REGISTRY_OUTPUT_PRESETS;
  const preset = presets[index];
  if (!preset) return;
  const r = registryRoot();
  const rows = r[_registryAddDirection + 's'];
  const max = registryCapacity(_registryAddDirection);
  if (rows.length >= max) return registryAddError(`Registry capacity is full (${rows.length}/${max}). Remove an unused ${_registryAddDirection} first.`);
  const purpose = preset.purpose || registryDerivedPurpose(_registryAddDirection,preset);
  const existing = rows.filter(c=>registryDerivedPurpose(_registryAddDirection,c)===purpose).length;
  if (existing > 0 && registryPurposeIsSingleton(_registryAddDirection, purpose))
    return registryAddError(`${preset.label} is already installed. Edit or remove its existing card instead.`);
  if (!pcbProfileActive() && Number(preset.driver) >= 8 && !cfg.i2c?.enabled)
    return registryAddBusPrerequisite('i2c', preset.label);
  if (!pcbProfileActive() && Number(preset.temp_interface) >= 1 &&
      Number(preset.temp_interface) <= 3 && !cfg.spi?.enabled)
    return registryAddBusPrerequisite('spi', preset.label);
  if (pcbProfileActive()) {
    const choices = pcbCompatibleChoices(_registryAddDirection, purpose, preset.role);
    const box = document.getElementById('registry-add-catalog');
    document.getElementById('registry-add-title').textContent = `Connect ${preset.label}`;
    const search = document.getElementById('registry-add-search');
    if (search) search.style.display = 'none';
    box.innerHTML = `<div class="hw-desc" style="margin-bottom:.65rem">Choose a labelled PCB connection when available. Advanced builders may instead use a genuinely spare ESP32 GPIO; reserved PCB pins remain blocked.</div>
      <div class="registry-add-group"><div class="registry-add-group-title">Compatible connections</div><div class="registry-add-group-grid">
      ${choices.map(choice=>`<button type="button" class="registry-add-option" ${choice.mode.available===false?'disabled aria-disabled="true"':''} onclick="selectRegistryProfilePort(${index},'${choice.port.id}','${choice.mode.id}')">${escapeHtmlText(pcbChoiceLabel(choice))}<small>${escapeHtmlText(choice.mode.available===false?(choice.mode.status||'Fitted device is not responding'):(choice.port.description || choice.mode.adapter.replaceAll('_',' ')))}</small></button>`).join('')}
      <button type="button" class="registry-add-option" onclick="selectRegistryBareGpio(${index})">Spare ESP32 GPIO<small>Direct wiring; choose a valid unreserved pin on the device card.</small></button>
      </div></div>`;
    const panel = document.querySelector('#registry-add-modal .registry-add-panel');
    if (panel) panel.scrollTop = 0;
    return;
  }
  createRegistryChannelFromPreset(index, null);
}
function selectRegistryBareGpio(presetIndex) {
  createRegistryChannelFromPreset(presetIndex, null, true);
}
function selectRegistryProfilePort(presetIndex, portId, modeId) {
  const port = (pcbProfile.ports || []).find(row=>row.id===portId);
  const mode = port?.modes?.find(row=>row.id===modeId);
  if (!port || !mode) return registryAddError('That PCB connection is no longer available. Close this window and try again.');
  if (mode.available === false) return registryAddError(mode.status || 'That fitted PCB device is not responding.');
  createRegistryChannelFromPreset(presetIndex, {port,mode});
}
function createRegistryChannelFromPreset(index, pcbChoice, bareGpio = false) {
  const presets = _registryAddDirection === 'input' ? REGISTRY_INPUT_PRESETS : REGISTRY_OUTPUT_PRESETS;
  const preset = presets[index];
  if (!preset) return;
  const r = registryRoot();
  const rows = r[_registryAddDirection + 's'];
  const purpose = preset.purpose || registryDerivedPurpose(_registryAddDirection,preset);
  const existing = rows.filter(c=>registryDerivedPurpose(_registryAddDirection,c)===purpose).length;
  const name = existing > 0 && purpose !== 'generic' ? `${preset.name} ${existing + 1}` : preset.name;
  const selectedDriver = pcbChoice ? PCB_ADAPTER_DRIVER[pcbChoice.mode.adapter] : preset.driver;
  const range = registryDefaultRange(_registryAddDirection, selectedDriver, preset.role);
  const id = registryUniqueId(preset.role === 'generic' ? registrySlug(name) : preset.id);
  if (!id) return registryAddError('Could not create an internal device reference. Close this window and try again.');
  const safe = _registryAddDirection === 'output'
    ? (purpose === 'prop_pitch' ? 1 : 0) : undefined;
  const channel = {id, name:name.slice(0, 23), purpose, role:preset.role, driver:selectedDriver, pin:-1, min:range.min, max:range.max, invert:false};
  if (bareGpio) {
    channel.physical_port = '';
    channel.physical_mode = '';
  }
  if (pcbChoice) {
    channel.physical_port = pcbChoice.port.id;
    channel.physical_mode = pcbChoice.mode.id;
    if (pcbChoice.mode.reference_mv) channel.i2c_reference_mv = Number(pcbChoice.mode.reference_mv);
    if (pcbChoice.mode.adapter === 'i2c_adc_digital_input') {
      channel.digital_threshold_raw = 2048;
      channel.digital_hysteresis_raw = 64;
    }
  }
  if (_registryAddDirection === 'input' && selectedDriver === 2) channel.pulses_per_unit = preset.role === 'flow' ? 1000 : 1;
  if (_registryAddDirection === 'input' && [1,9].includes(selectedDriver) && !preset.temp_interface && pcbChoice?.mode.adapter !== 'spi_thermocouple' && pcbChoice?.mode.adapter !== 'onewire_temperature') Object.assign(channel, registryDefaultAnalogCalibration(preset.role));
  if (_registryAddDirection === 'input' && preset.role === 'temperature' && (preset.temp_interface || pcbChoice?.mode.adapter === 'spi_thermocouple' || pcbChoice?.mode.adapter === 'onewire_temperature')) {
    const profileThermocouple = ({max6675:1,max31855:2,max31856:3})[pcbChoice?.mode.device_driver] || 1;
    const tempInterface = pcbChoice?.mode.adapter === 'onewire_temperature' ? 5 :
      (pcbChoice?.mode.adapter === 'spi_thermocouple' ? profileThermocouple : (preset.temp_interface || 1));
    Object.assign(channel, {
      temp_interface:tempInterface,
      spi_clk:pcbChoice ? -1 : Number(cfg.spi?.sck_pin ?? -1),
      spi_cs:-1,
      spi_miso:pcbChoice ? -1 : Number(cfg.spi?.miso_pin ?? -1),
      spi_mosi:pcbChoice || tempInterface !== 3 ? -1 : Number(cfg.spi?.mosi_pin ?? -1),
      tc_type:'K'
    });
  }
  if (_registryAddDirection === 'output') { channel.safe_demand = safe; channel.force_safe_on_fault = false; channel.invert = false; channel.has_flow_monitor = false; channel.minimum_flow_l_min = 0; if (preset.driver === 5) { channel.pwm_freq_hz = 5000; channel.pwm_res_bits = 10; } }
  if (_registryAddDirection === 'input') {
    channel.active_high = pcbChoice?.mode.adapter === 'i2c_adc_digital_input'
      ? true : !registryIsSwitchRole(preset.role);
    channel.pullup = registryIsSwitchRole(preset.role);
    channel.pulldown = false;
  }
  if (existing === 0) resetRegistryPurposeDefaults(_registryAddDirection, purpose);
  rows.push(channel);
  closeRegistryAddDialog();
  _registryEditOpen.add(registryEditKey(_registryAddDirection, rows.length - 1));
  renderRegistryInventory();
  dirty(); updateSaveButton(); applyActuatorVisibility();
}
function resetRegistryPurposeDefaults(direction, purpose) {
  if (direction !== 'output') return;
  const actuatorKey = ({oil_pump:'oil_pump', igniter:'igniter', ab_igniter:'igniter2', glow_plug:'glow_plug'})[purpose];
  if (!actuatorKey) return;
  const act = ensureActuatorObject(actuatorKey);
  act.has_current = false;
  act.current_pin = -1;
  act.current_mv_a = actuatorKey === 'glow_plug' ? 185 : 100;
  act.current_zero_v = 1.65;
  if (actuatorKey === 'oil_pump') act.current_max_a = 0;
  if (actuatorKey === 'igniter' || actuatorKey === 'igniter2') {
    act.pwm = false;
    act.coil = false;
    act.dwell_ms = 6;
    act.rest_ms = 3;
    act.coil_sat_a = 8;
  }
  if (actuatorKey === 'glow_plug') {
    act.type = 0;
    act.freq_hz = 1000;
    act.res_bits = 8;
    act.fuel_pin = -1;
    act.fuel_type = 0;
    act.fuel_active_h = true;
    act.fuel_delay_ms = 8000;
    act.fuel_demand_pct = 100;
  }
}
function registryAddError(message) {
  const err = document.getElementById('registry-add-error');
  if (!err) return;
  err.textContent = message;
  err.style.display = '';
}
function registryAddBusPrerequisite(bus, deviceLabel) {
  const err = document.getElementById('registry-add-error');
  if (!err) return;
  const i2c = bus === 'i2c';
  const explanation = i2c
    ? 'This device uses the shared I2C wiring. Configure SDA and SCL once; its address and channel are selected on the device card.'
    : 'A MAX thermocouple amplifier uses the shared SPI wiring. Configure SCK and MISO once; each temperature probe then gets its own CS pin.';
  err.innerHTML = `<strong>${escapeHtmlText(deviceLabel)} needs shared ${i2c ? 'I2C' : 'SPI'} wiring.</strong>
    <span style="display:block;color:var(--text-2);margin:.3rem 0 .55rem">${explanation}</span>
    <button type="button" onclick="openRegistryBusPrerequisite('${i2c ? 'i2c' : 'spi'}')">Configure shared ${i2c ? 'I2C' : 'SPI'} wiring</button>`;
  err.style.display = '';
}
function addRegistryChannel(direction) {
  openRegistryAddDialog(direction);
}
function registryRemovalImpact(direction, id) {
  const r = registryRoot(), impact = [];
  const aliases = registryReferenceAliases(direction, id);
  const refMatches = value => aliases.includes(String(value || ''));
  const rows = r[direction + 's'] || [];
  const idx = rows.findIndex(c => String(c?.id || '') === String(id || ''));
  const channel = idx >= 0 ? rows[idx] : null;
  if (direction === 'input' && channel) {
    const purpose = registryDerivedPurpose('input', channel);
    const pumpPurpose = purpose === 'oil_flow' ? 'oil_pump' : purpose === 'scavenge_flow' ? 'scavenge_pump' : '';
    if (pumpPurpose && (r.outputs || []).some(out => registryDerivedPurpose('output',out) === pumpPurpose && out.has_flow_monitor))
      impact.push('the matching pump flow monitor');
    const shaftSource = purpose === 'n1_speed' ? 2 : purpose === 'n2_speed' ? 3 : 0;
    if (shaftSource && (cfg.oil_loops || []).some(loop => Number(loop?.target_source) === shaftSource))
      impact.push('the matching oil loop will change to fixed high pressure');
  }
  const handle = idx >= 0 ? (direction === 'input' ? 80 + idx : 64 + idx) : -999;
  const bindCount = r.bindings.filter(b => b.channel === id).length;
  if (bindCount) impact.push(`${bindCount} registry binding(s)`);
  if (direction === 'output') {
    const pairedOwners = (r.outputs || []).filter(out =>
      String(out?.paired_output || '') === String(id || ''));
    if (pairedOwners.length) impact.push(`${pairedOwners.length} wet-glow pilot-fuel pairing(s) will need repair`);
  }
  const loopCount = (cfg.oil_loops || []).filter(l => l && (l.pressure_input === id || l.pump_output === id)).length;
  if (loopCount) impact.push(`${loopCount} oil loop definition(s)`);
  const seqKeys = ['startup_enter_actions','startup_exit_actions','shutdown_enter_actions','shutdown_exit_actions','ab_enter_actions','ab_exit_actions','ab_shut_enter_actions','ab_shut_exit_actions'];
  let seqCount = 0;
  seqKeys.forEach(k => (cfg[k] || []).forEach(slot => (slot || []).forEach(a => {
    if (direction === 'output' && (refMatches(a?.target) || Number(a?.act) === handle)) seqCount++;
  })));
  if (seqCount) impact.push(`${seqCount} sequence side action(s)`);
  let customCount = 0;
  Object.values(cfg.custom_blocks || {}).forEach(b => {
    if (!b) return;
    if (direction === 'input' && (refMatches(b.condition?.source) || Number(b.condition?.sensor) === handle)) customCount++;
    (b.steps || []).forEach(s => {
      if (direction === 'output' && (refMatches(s?.target) || Number(s?.actuator) === handle || Number(s?.act) === handle)) customCount++;
    });
  });
  if (customCount) impact.push(`${customCount} custom block reference(s)`);
  const ruleCount = (settingsCfg.rules || []).filter(rule => channel
    ? registryRuleReferencesChannel(rule, direction, channel)
    : rule && (
      (direction === 'input' && (refMatches(rule.source) || refMatches(rule.target_source) || refMatches(rule.sensor_id) || Number(rule.sensor) === handle)) ||
      (direction === 'output' && (refMatches(rule.target) || refMatches(rule.actuator_id) || Number(rule.actuator) === handle))
    )).length;
  if (ruleCount) impact.push(`${ruleCount} custom controller reference(s)`);
  return impact;
}
function registryReferenceAliases(direction, id) {
  const aliases = [String(id || '')];
  if (direction === 'input') {
    if (id === 'operator_throttle') aliases.push('throttle_input', 'throttle_input_main', 'throttle_in');
    if (id === 'operator_idle') aliases.push('idle_input', 'idle_input_main', 'idle_in');
    if (id === 'battery_voltage') aliases.push('batt_voltage', 'batt_voltage_main');
  } else {
    if (id === 'main_fuel') aliases.push('main_fuel_output', 'throttle');
    if (id === 'oil_pump_main') aliases.push('oil_pump');
    if (id === 'glow_plug') aliases.push('glow_plug_main');
  }
  return [...new Set(aliases.filter(Boolean))];
}
function cleanupRegistryReferences(direction, id) {
  const r = registryRoot();
  const aliases = registryReferenceAliases(direction, id);
  const refMatches = value => aliases.includes(String(value || ''));
  const rows = r[direction + 's'] || [];
  const idx = rows.findIndex(c => String(c?.id || '') === String(id || ''));
  const handle = idx >= 0 ? (direction === 'input' ? 80 + idx : 64 + idx) : -999;
  r.bindings = r.bindings.filter(b => b.channel !== id);
  if (direction === 'output') (r.outputs || []).forEach(out => {
    if (String(out?.mirror_of || '') === String(id || '')) delete out.mirror_of;
    // Keep paired_output stable so the owning ignition card shows the missing
    // device and can be repaired. Never silently select another fuel output.
  });
  cfg.oil_loops = (cfg.oil_loops || []).filter(l => !(l && (refMatches(l.pressure_input) || refMatches(l.pump_output))));
  // Sequence side actions and custom sequence blocks keep stable string IDs.
  // Leave those references intact so the editor can show the missing device
  // and let the user restore or deliberately replace it. Numeric legacy
  // handles are shifted below only to preserve their historical meaning.
  const channel = idx >= 0 ? rows[idx] : null;
  if (direction === 'input' && channel) {
    const purpose = registryDerivedPurpose('input', channel);
    const shaftSource = purpose === 'n1_speed' ? 2 : purpose === 'n2_speed' ? 3 : 0;
    if (shaftSource) (cfg.oil_loops || []).forEach(loop => {
      if (Number(loop?.target_source) !== shaftSource) return;
      loop.target_source = 0;
      loop.target_bar = Number(loop.target_high_bar ?? loop.target_bar ?? 2.5);
    });
    const pumpPurpose = purpose === 'oil_flow' ? 'oil_pump' : purpose === 'scavenge_flow' ? 'scavenge_pump' : '';
    if (pumpPurpose) {
      const compatible = (r.inputs || []).filter(input =>
        input !== channel && registryDerivedPurpose('input', input) === purpose);
      (r.outputs || []).forEach(out => {
        if (registryDerivedPurpose('output',out) === pumpPurpose && out.has_flow_monitor &&
            (refMatches(out.flow_input) || (!out.flow_input && compatible.length === 0))) {
        out.has_flow_monitor = false;
        out.minimum_flow_l_min = 0;
        out.flow_input = '';
      }
      });
    }
  }
  if (settingsCfg.rules && channel) settingsCfg.rules = settingsCfg.rules.filter(rule => !registryRuleReferencesChannel(rule, direction, channel));
  else if (settingsCfg.rules && direction === 'input') settingsCfg.rules = settingsCfg.rules.filter(rule => !refMatches(rule?.source) && !refMatches(rule?.sensor_id) && Number(rule?.sensor) !== handle);
  else if (settingsCfg.rules && direction === 'output') settingsCfg.rules = settingsCfg.rules.filter(rule => !refMatches(rule?.target) && !refMatches(rule?.actuator_id) && Number(rule?.actuator) !== handle);
}
function shiftRegistryNumericHandlesAfterRemoval(direction, removedIndex, oldCount) {
  const base = direction === 'input' ? 80 : 64;
  const removed = base + removedIndex;
  const upper = base + oldCount;
  const shift = value => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > removed && numeric < upper ? numeric - 1 : value;
  };
  if (direction === 'output') {
    const seqKeys = ['startup_enter_actions','startup_exit_actions','shutdown_enter_actions','shutdown_exit_actions','ab_enter_actions','ab_exit_actions','ab_shut_enter_actions','ab_shut_exit_actions'];
    seqKeys.forEach(key => (cfg[key] || []).forEach(slot => (slot || []).forEach(action => {
      if (action && action.act !== undefined) action.act = shift(action.act);
    })));
    Object.values(cfg.custom_blocks || {}).forEach(block => (block?.steps || []).forEach(step => {
      if (step.target !== undefined && Number.isFinite(Number(step.target))) step.target = shift(step.target);
      if (step.actuator !== undefined) step.actuator = shift(step.actuator);
      if (step.act !== undefined) step.act = shift(step.act);
  }));
  const deviceTargetKeys = ['startup_device_target','shutdown_device_target','ab_device_target','ab_shut_device_target'];
  deviceTargetKeys.forEach(key => (cfg[key] || []).forEach(target => {
    if (direction === 'output' && refMatches(target)) seqCount++;
  }));
    (settingsCfg.rules || []).forEach(rule => { if (rule?.actuator !== undefined) rule.actuator = shift(rule.actuator); });
  } else {
    Object.values(cfg.custom_blocks || {}).forEach(block => {
      if (block?.condition?.sensor !== undefined) block.condition.sensor = shift(block.condition.sensor);
    });
    (settingsCfg.rules || []).forEach(rule => { if (rule?.sensor !== undefined) rule.sensor = shift(rule.sensor); });
  }
}
function cleanupOilFlowShutdownDependency() {
  const r = registryRoot();
  const monitored = (r.outputs || []).some(out => {
    if (!out?.has_flow_monitor) return false;
    const purpose = registryDerivedPurpose('output', out);
    const inputPurpose = purpose === 'oil_pump' ? 'oil_flow' : purpose === 'scavenge_pump' ? 'scavenge_flow' : '';
    return !!inputPurpose && (r.inputs || []).some(input => registryDerivedPurpose('input', input) === inputPurpose);
  });
  if (!monitored && settingsCfg?.oil_advanced)
    settingsCfg.oil_advanced.shutdown_on_underflow = false;
}
function duplicateRegistryChannel(index) {
  const r = registryRoot();
  const src = r.outputs[index];
  if (!src) return;
  const max = registryCapacity('output');
  if (r.outputs.length >= max) return alert(`Output registry capacity is full (${r.outputs.length}/${max}). Remove an unused output first.`);
  const role = src.role || 'generic';
  const n = registryRoleNumber('output', role);
  const baseName = registryDisplayName('output', src, 'Output').replace(/\s+\d+$/, '');
  const copy = {...src};
  copy.id = registryUniqueId(src.id || role || 'output');
  copy.name = `${baseName} ${n}`.slice(0, 23);
  copy.pin = -1;
  copy.physical_port = '';
  copy.physical_mode = '';
  copy.mirror_of = src.mirror_of || src.id;
  copy.force_safe_on_fault = false;
  copy.has_current = false;
  copy.current_pin = -1;
  copy.current_max_a = 0;
  copy.current_trip_delay_ms = 5000;
  copy.has_flow_monitor = false;
  copy.minimum_flow_l_min = 0;
  copy.flow_input = '';
  // A duplicated ignition device may reuse its tuning, but it must never
  // silently share the source device's pilot-fuel output.
  copy.paired_output = '';
  r.outputs.push(copy);
  _registryEditOpen.add(registryEditKey('output', r.outputs.length - 1));
  renderRegistryInventory();
  dirty(); updateSaveButton();
}
function makeRegistryOutputIndependent(index) {
  const row = registryRoot().outputs?.[index];
  if (!row) return;
  delete row.mirror_of;
  renderRegistryInventory();
  dirty(); updateSaveButton();
}
function closeRegistryRemoveDialog() {
  _pendingRegistryRemove = null;
  const modal = document.getElementById('registry-remove-modal');
  if (modal) modal.style.display = 'none';
}
function removeRegistryChannel(direction, index) {
  const r = registryRoot(), channel = r[direction + 's'][index];
  if (!channel) return;
  const users = registryCurrentUsers(direction, channel.id);
  _pendingRegistryRemove = {direction, index, id: channel.id};
  const title = document.getElementById('registry-remove-title');
  if (title) title.textContent = `Remove ${registryDisplayName(direction, channel, channel.id || 'device')}?`;
  const body = document.getElementById('registry-remove-body');
  if (body) body.innerHTML = users.length
    ? `<div>This channel is currently used by:</div><ul>${users.map(i => `<li>${escapeHtmlText(i)}</li>`).join('')}</ul><div>Sequence-step and custom-block bindings keep this exact device ID and remain visible as missing until repaired. Hardware bindings, oil loops, and normal controllers that cannot operate without this device are removed.</div>`
    : '<div>This channel is not currently used by controllers, safeties, sequencer blocks, rules or bindings.</div>';
  document.getElementById('registry-remove-modal').style.display = 'flex';
}
function removeDisconnectedI2cDevice(address, type) {
  const r = registryRoot();
  const channels = [];
  ['input','output'].forEach(direction => {
    (r[direction + 's'] || []).forEach(channel => {
      if (Number(channel.driver) >= 8 && Number(channel.i2c_address) === Number(address))
        channels.push({direction, id:channel.id, name:registryDisplayName(direction,channel,channel.id)});
    });
  });
  if (!channels.length) return;
  _pendingRegistryRemove = {deviceAddress:Number(address), deviceType:String(type||'I2C device'), channels};
  const title = document.getElementById('registry-remove-title');
  if (title) title.textContent = `Remove ${type} and all its assignments?`;
  const impacts = [];
  channels.forEach(item => registryRemovalImpact(item.direction,item.id).forEach(text => impacts.push(`${item.name}: ${text}`)));
  const body = document.getElementById('registry-remove-body');
  if (body) body.innerHTML =
    `<div>This disconnected device owns ${channels.length} configured channel${channels.length===1?'':'s'}:</div>
     <ul>${channels.map(item=>`<li>${escapeHtmlText(item.name)}</li>`).join('')}</ul>
     ${impacts.length ? `<div>The following dependent references will also be removed:</div><ul>${impacts.map(text=>`<li>${escapeHtmlText(text)}</li>`).join('')}</ul>` : ''}
     <div>After Save &amp; Reboot, controllers and safeties whose required hardware is gone are disabled by the normal dependency cleanup. Unrelated hardware and tuning are not changed.</div>`;
  document.getElementById('registry-remove-modal').style.display = 'flex';
}
function confirmRegistryRemoveChannel() {
  if (!_pendingRegistryRemove) return;
  if (_pendingRegistryRemove.channels) {
    const channels = _pendingRegistryRemove.channels;
    const r = registryRoot();
    // Remove from the highest index down. After each removal, shift surviving
    // legacy numeric handles so they continue to address the same stable card.
    const ordered = channels.map(item => ({...item, index:(r[item.direction + 's'] || []).findIndex(c => c.id === item.id)}))
      .filter(item => item.index >= 0)
      .sort((a,b) => a.direction === b.direction ? b.index - a.index : a.direction.localeCompare(b.direction));
    ordered.forEach(item => {
      const rows = r[item.direction + 's'] || [];
      const row = rows[item.index];
      if (!row) return;
      cleanupRegistryReferences(item.direction, item.id);
      if (item.direction === 'input') {
        const key = registryCoreSensorKey(row);
        if (key && cfg.sensors?.[key]) cfg.sensors[key].enabled = false;
      } else {
        if (pumpFlowPurpose(row)) removePumpFlowInput(row);
        const key = registryCoreActuatorKey(row);
        if (key && cfg.actuators?.[key]) cfg.actuators[key].enabled = false;
      }
      shiftRegistryNumericHandlesAfterRemoval(item.direction, item.index, rows.length);
      rows.splice(item.index, 1);
    });
    clearUnusedTcaInterrupt();
    cleanupOilFlowShutdownDependency();
    closeRegistryRemoveDialog();
    updateHardwarePrerequisites(true);
    applyEnableDependencyTooltips();
    renderRegistryInventory(); renderI2cDiscovery(); dirty(); updateSaveButton();
    return;
  }
  const {direction, index, id} = _pendingRegistryRemove;
  const r = registryRoot();
  if (!r[direction + 's'][index] || r[direction + 's'][index].id !== id) return closeRegistryRemoveDialog();
  cleanupRegistryReferences(direction, id);
  const removed = r[direction + 's'][index];
  if (direction === 'input') {
    const key = registryCoreSensorKey(removed);
    if (key && cfg.sensors?.[key]) cfg.sensors[key].enabled = false;
  } else {
    if (pumpFlowPurpose(removed)) removePumpFlowInput(removed);
    const key = registryCoreActuatorKey(removed);
    if (key && cfg.actuators?.[key]) cfg.actuators[key].enabled = false;
  }
  shiftRegistryNumericHandlesAfterRemoval(direction, index, r[direction + 's'].length);
  r[direction + 's'].splice(index, 1);
  clearUnusedTcaInterrupt();
  cleanupOilFlowShutdownDependency();
  closeRegistryRemoveDialog();
  updateHardwarePrerequisites(true);
  applyEnableDependencyTooltips();
  renderRegistryInventory(); dirty(); updateSaveButton();
}

async function setActEnabled(act, grpId, val) {
  if (!val && cfg.actuators?.[act]?.enabled && !await dependencyWarning('actuator', act)) {
    chk('en-' + grpId, true);
    return;
  }
  await setAct(act, 'enabled', val);
  if (!val) cleanupRemovedActuator(act);
  updateGroupEnabled('grp-' + grpId, val);
  updateHardwarePrerequisites(true);
  applyEnableDependencyTooltips();
  if (_hideUnselActive) applyActuatorVisibility();
}
