const _registryEditOpen = new Set();
const _workflowEditOpen = new Set();
let _registrySnap = null;
function registryEditKey(direction, index) { return direction + ':' + index; }
function toggleRegistryEdit(direction, index) {
  const key = registryEditKey(direction, index);
  if (_registryEditOpen.has(key)) _registryEditOpen.delete(key); else _registryEditOpen.add(key);
  renderRegistryInventory();
}
function toggleWorkflowEditor(key) {
  if (_workflowEditOpen.has(key)) _workflowEditOpen.delete(key); else _workflowEditOpen.add(key);
  renderHardwareWorkflowSummaries();
}
function updateWorkflowEditButtons() {
  const map = {
    buses: ['btn-edit-buses', 'Edit buses', 'Done editing'],
    comms: ['btn-edit-comms', 'Edit devices', 'Done editing'],
    controllers: ['btn-edit-controllers', 'Edit controllers', 'Done editing'],
    safety: ['btn-edit-safety', 'Edit safeties', 'Done editing'],
  };
  Object.entries(map).forEach(([key, [id, closed, open]]) => {
    const btn = document.getElementById(id);
    if (btn) btn.textContent = _workflowEditOpen.has(key) ? open : closed;
  });
}
function registryRoleLabel(direction, role) {
  const roles = direction === 'input' ? REGISTRY_INPUT_ROLES : REGISTRY_OUTPUT_ROLES;
  return roles.find(([v]) => v === String(role || 'generic'))?.[1] || (role || 'Generic');
}
function registryPurposeLabel(direction, c) {
  return registryPurposeDefinition(direction, registryDerivedPurpose(direction,c))?.label || 'Generic channel';
}
const REGISTRY_SINGLETON_PURPOSES = {
  input: new Set(['n1_speed','n2_speed','tot','tit','oil_temperature','fuel_pressure','p1_pressure','p2_pressure','fuel_flow','flame','ab_flame','torque','thrust','battery_voltage','throttle','idle','ab_command']),
  output: new Set()
};
function registryPurposeIsSingleton(direction, purpose) {
  return REGISTRY_SINGLETON_PURPOSES[direction]?.has(String(purpose || '')) || false;
}
function registryFixedProfileFunction(direction, c) {
  if (!pcbProfileActive() || direction !== 'input') return '';
  if (registryDerivedPurpose(direction,c) === 'battery_voltage' &&
      pcbProfile?.fixed_functions?.supply_voltage?.available === true)
    return 'supply_voltage';
  return '';
}
function registryStatus(c) {
  if (!c?.id) return {kind:'error', text:'Internal device reference missing — remove and add this device again'};
  const direction = [0,1,2,3,7,8,9,10].includes(Number(c.driver)) ? 'input' : 'output';
  const purpose = registryDerivedPurpose(direction,c);
  if (!registryPurposeDefinitions(direction).some(p=>p.value===purpose)) return {kind:'error', text:'Unknown device purpose'};
  if (registryPurposeIsSingleton(direction, purpose) && (registryRoot()[direction+'s']||[]).filter(row=>registryDerivedPurpose(direction,row)===purpose).length > 1)
    return {kind:'error', text:`${registryPurposeLabel(direction,c)} is already assigned`};
  const profileBacked = pcbProfileActive();
  if (profileBacked) {
    if (registryFixedProfileFunction(direction,c)) return {kind:'ok', text:'Built in'};
    const port = (pcbProfile.ports || []).find(row=>row.id===c.physical_port);
    const mode = port?.modes?.find(row=>row.id===c.physical_mode);
    if (!port || !mode) return {kind:'error', text:'Choose a compatible PCB connection'};
    if (!pcbModeCompatible(direction,purpose,c.role,mode))
      return {kind:'error', text:'PCB connection is not compatible with this purpose'};
    if (mode.available === false)
      return {kind:'error', text:mode.status || 'Fitted PCB device is not responding'};
  }
  if (Number(c.temp_interface || 0) >= 1 && Number(c.temp_interface || 0) <= 3 && !['tot','tit','oil_temperature'].includes(purpose)) return {kind:'error', text:'Thermocouple interface requires TOT, TIT, or Oil temperature purpose'};
  if ([4,5].includes(Number(c.temp_interface || 0)) && !['oil_temperature','coolant_temp','intake_temperature'].includes(purpose)) return {kind:'error', text:'NTC and DS18B20 interfaces are only for oil, coolant, intake or ambient temperature'};
  const remote = Number(c.driver) >= 8;
  const thermocouple = registryTemperatureIsSpi(c);
  if (remote && !profileBacked) {
    if (cfg.i2c?.enabled === false) return {kind:'error', text:'Enable the shared I2C bus or remove this assignment'};
    const address = Number(c.i2c_address);
    const validAddress = Number(c.driver) === 10 ? address === 0x2A
      : [8,11].includes(Number(c.driver)) ? address >= 0x20 && address <= 0x27
      : Number(c.driver) === 9 && address >= 0x10 && address <= 0x17;
    if (!validAddress) return {kind:'error', text:'Choose a compatible detected I2C device'};
    const maxChannel = Number(c.driver) === 10 ? 2 : 8;
    if (Number(c.device_channel) < 0 || Number(c.device_channel) >= maxChannel) return {kind:'error', text:'I2C channel is invalid'};
    const device = (cfg._i2c_discovery?.devices || []).find(d=>Number(d.address)===Number(c.i2c_address));
    if (!device?.present) return {kind:'warn', text:'Disconnected — assignment preserved'};
  }
  if (thermocouple && !profileBacked) {
    if (!cfg.spi?.enabled) return {kind:'error', text:'Enable the shared SPI bus first'};
    if (Number(cfg.spi.sck_pin) < 0 || Number(cfg.spi.miso_pin) < 0 ||
        Number(c.spi_cs) < 0 || (Number(c.temp_interface) === 3 && Number(cfg.spi.mosi_pin) < 0))
      return {kind:'error', text:'Complete the shared SPI bus and CS pin'};
    if (GPIO_DB?.[Number(cfg.spi.sck_pin)]?.i || GPIO_DB?.[Number(c.spi_cs)]?.i ||
        (Number(c.temp_interface) === 3 && GPIO_DB?.[Number(cfg.spi.mosi_pin)]?.i))
      return {kind:'error', text:'SPI SCK, CS and MOSI require output-capable GPIO'};
  }
  if (!profileBacked && !remote && !thermocouple && (c.pin ?? -1) < 0) return {kind:'error', text:'Pin required'};
  if (!profileBacked && !remote && !thermocouple) {
    const pin = Number(c.pin);
    const info = GPIO_DB?.[pin];
    if (!info || info.r) return {kind:'error', text:`GPIO ${pin} is unavailable on this board`};
    if (direction === 'output' && info.i) return {kind:'error', text:`GPIO ${pin} is input-only`};
    if (direction === 'input' && Number(c.driver) === 1 && Number(c.temp_interface || 0) !== 5 && !registryTorqueIsHx711(c) && !info.adc1)
      return {kind:'error', text:`GPIO ${pin} is not ADC1-capable`};
  }
  if (registryTorqueIsHx711(c)) {
    const clk = Number(c.hx711_clk ?? -1), info = GPIO_DB?.[clk];
    if (clk < 0) return {kind:'error', text:'HX711 SCK pin required'};
    if (!info || info.r || info.i) return {kind:'error', text:`HX711 SCK GPIO ${clk} must be output-capable`};
    if (clk === Number(c.pin)) return {kind:'error', text:'HX711 DOUT and SCK need different GPIOs'};
    if (!(Number(c.hx711_scale) >= 0.000001) || Number(c.hx711_scale) > 1000000) return {kind:'error', text:'HX711 scale invalid'};
  }
  if (Number(c.temp_interface||0) === 4 && (!(Number(c.ntc_beta) > 0) || !(Number(c.ntc_r0) > 0) || !(Number(c.ntc_r_fixed) > 0))) return {kind:'error', text:'NTC calibration invalid'};
  if (Number(c.temp_interface||0) === 5 && (Number(c.temp_resolution) < 9 || Number(c.temp_resolution) > 12)) return {kind:'error', text:'DS18B20 resolution invalid'};
  const curveProblem = registryCurveProblem(c);
  if (curveProblem) return {kind:'error', text:curveProblem};
  const rangeProblem = registryRangeProblem(c);
  if (rangeProblem) return {kind:'error', text:rangeProblem};
  if (Number(c.min_run_demand ?? 0) < 0 || Number(c.min_run_demand ?? 0) > 1) return {kind:'error', text:'Minimum reliable command must be 0-100%'};
  if (c.pullup && c.pulldown) return {kind:'error', text:'Pull-up/down conflict'};
  const actKey = registryCoreActuatorKey(c);
  const engineActuatorPurpose = registryCoreActuatorPurposeKey(c);
  if (direction === 'output' && purpose !== 'prop_pitch' &&
      (engineActuatorPurpose || ['ab_valve','pilot_fuel'].includes(purpose)) &&
      Number(c.safe_demand || 0) !== 0)
    return {kind:'error', text:'Core engine outputs must initialize Off'};
  const dedicatedCurrent = ['oil_pump','glow_plug','igniter','igniter2'].includes(actKey) ? ensureActuatorObject(actKey) : null;
  const currentEnabled = dedicatedCurrent ? !!dedicatedCurrent.has_current : !!c.has_current;
  const currentPin = dedicatedCurrent ? dedicatedCurrent.current_pin : c.current_pin;
  const currentMvA = dedicatedCurrent ? dedicatedCurrent.current_mv_a : c.current_mv_a;
  const currentZeroV = dedicatedCurrent ? dedicatedCurrent.current_zero_v : c.current_zero_v;
  if (currentEnabled) {
    if ((currentPin ?? -1) < 0) return {kind:'error', text:'Current pin required'};
    if (!registryPinIsAdc(currentPin)) return {kind:'error', text:'Current pin must be ADC'};
    if (Number(currentMvA ?? 0) <= 0) return {kind:'error', text:'Current mV/A invalid'};
    if (Number(currentZeroV ?? 0) < 0 || Number(currentZeroV ?? 0) > 3.3) return {kind:'error', text:'Current zero invalid'};
  }
  if (direction === 'output' && c.has_flow_monitor) {
    const inputPurpose = purpose === 'oil_pump' ? 'oil_flow' : purpose === 'scavenge_pump' ? 'scavenge_flow' : '';
    if (!inputPurpose || !(Number(c.minimum_flow_l_min) > 0))
      return {kind:'error', text:'Flow monitor setup invalid'};
    if (!(registryRoot().inputs || []).some(row => registryDerivedPurpose('input', row) === inputPurpose))
      return {kind:'error', text:'Matching flow meter missing'};
  }
  if (Number(c.driver) === 5) {
    const frequency = Number(c.pwm_freq_hz ?? 5000), resolution = Number(c.pwm_res_bits ?? 10);
    const maxFrequency = Math.min(100000, Math.floor(80000000 / (2 ** resolution)));
    if (frequency < 1 || frequency > maxFrequency || resolution < 8 || resolution > 14)
      return {kind:'error', text:`PWM timing is not achievable: ${resolution} bits supports at most ${maxFrequency} Hz`};
  }
  if ((actKey === 'igniter' || actKey === 'igniter2') && ensureActuatorObject(actKey).coil && !ensureActuatorObject(actKey).has_current) {
    return {kind:'error', text:'Current sensing required'};
  }
  return {kind:'ok', text:'Ready'};
}
function registryDemandProblem(value) {
  const n = Number(value ?? 0);
  return !Number.isFinite(n) || n < 0 || n > 1 ? 'Demand 0-100%' : '';
}
function registryRangeProblem(c) {
  if (Number(c?.driver) >= 8) return '';
  if (registryTorqueIsHx711(c)) return '';
  if (String(c?.role || '') === 'temperature' && Number(c?.temp_interface || 0) !== 0) return '';
  const driver = Number(c?.driver);
  const min = Number(c?.min ?? 0);
  const max = Number(c?.max ?? 1);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 'Invalid range';
  if (driver === 0 || outputDriverIsOnOff(driver)) return '';
  if (max <= min) return 'Invalid range';
  if (driver === 1 && (min < 0 || max > 4095)) return 'ADC range 0-4095';
  if (driver === 1) {
    const role = String(c.role || '');
    if (role === 'voltage' && Number(c.analog_divider ?? registryDefaultAnalogCalibration(role).analog_divider) < 1) return 'Voltage divider invalid';
    if (!['generic','operator','flame','voltage'].includes(role) &&
        Number(c.analog_mv_per_unit ?? registryDefaultAnalogCalibration(role).analog_mv_per_unit) <= 0) return 'Analog scale invalid';
  }
  if (driver === 2) {
    if (min < 0) return 'Pulse range below 0';
    if (Number(c.pulses_per_unit ?? 1) <= 0) return 'Pulse scale invalid';
    if (String(c.role || '') === 'speed' && max > 1000000000) return 'RPM range max 1000000000';
  }
  if (driver === 7 && (min < 0 || max > 1)) return 'PWM duty range 0-100%';
  if ((driver === 3 || driver === 6) && (min < 500 || max > 2500)) return 'Pulse width 500-2500 us';
  if (driver === 5 && (min < 0 || max > 1)) return 'PWM range 0-100%';
  return '';
}
function registryOutputSummary(c) {
  const d = Number(c.driver);
  if (d === 4) return 'On/Off';
  if (d === 5) return `Proportional ${Math.round(Number(c.min || 0) * 100)}-${Math.round(Number(c.max ?? 1) * 100)}%`;
  if (d === 6) return `Servo ${Math.round(Number(c.min || 1000))}-${Math.round(Number(c.max || 2000))} us`;
  return '';
}
function registryPinSummary(c) {
  if (registryFixedProfileFunction('input',c)) {
    return pcbProfile.fixed_functions.supply_voltage.label || 'Built-in supply monitor';
  }
  if (pcbProfileActive() && c?.physical_port) {
    const port = (pcbProfile.ports || []).find(row=>row.id===c.physical_port);
    const mode = port?.modes?.find(row=>row.id===c.physical_mode);
    return port ? pcbChoiceLabel({port,mode}) : 'PCB connection missing';
  }
  if (Number(c?.driver) >= 8) return `I2C 0x${Number(c.i2c_address||0).toString(16).toUpperCase().padStart(2,'0')} channel ${Number(c.device_channel||0)}`;
  if (registryTorqueIsHx711(c)) return `DOUT GPIO${c.pin} / SCK GPIO${c.hx711_clk ?? 'not set'}`;
  if (registryTemperatureIsSpi(c)) {
    return `Shared SPI bus / CS GPIO${c.spi_cs}`;
  }
  if (String(c.role||'') === 'temperature' && Number(c.temp_interface) === 5)
    return (c.pin ?? -1) >= 0 ? `OneWire GPIO ${c.pin}` : 'OneWire GPIO not set';
  if (String(c.role||'') === 'temperature' && Number(c.temp_interface) === 4)
    return (c.pin ?? -1) >= 0 ? `NTC ADC GPIO ${c.pin}` : 'NTC ADC GPIO not set';
  if (String(c.role||'') === 'temperature' && Number(c.temp_interface) === 0)
    return (c.pin ?? -1) >= 0 ? `Analog GPIO ${c.pin}` : 'Analog GPIO not set';
  return (c.pin ?? -1) >= 0 ? `GPIO ${c.pin}` : 'GPIO not set';
}
function registryProfilePortEditor(direction, c, index) {
  if (!pcbProfileActive()) return '';
  if (registryFixedProfileFunction(direction,c)) {
    const label = pcbProfile.fixed_functions.supply_voltage.label || 'Built-in supply monitor';
    return `<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">Built-in connection</span><span class="hw-desc">${escapeHtmlText(label)} is permanently wired by this PCB profile. Its GPIO and voltage-divider calibration cannot be changed here.</span></div>`;
  }
  const purpose = registryDerivedPurpose(direction,c);
  const choices = pcbCompatibleChoices(direction,purpose,c.role,String(c.physical_port||''));
  const currentKey = `${c.physical_port||''}|${c.physical_mode||''}`;
  const options = choices.map(choice => {
    const key = `${choice.port.id}|${choice.mode.id}`;
    const unavailable = choice.mode.available === false;
    const suffix = unavailable ? ` — ${choice.mode.status || 'not responding'}` : '';
    return `<option value="${key}"${key===currentKey?' selected':''}${unavailable && key!==currentKey?' disabled':''}>${escapeHtmlText(pcbChoiceLabel(choice)+suffix)}</option>`;
  }).join('');
  return `<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">Connected to</span><span class="hw-desc">Physical connection defined by ${escapeHtmlText(pcbProfile.name||'the flashed PCB profile')}. GPIO, chip and bus wiring cannot be changed here.</span><select onchange="updateRegistryProfilePort('${direction}',${index},this.value)">${options || '<option value="">No compatible unassigned PCB connection</option>'}</select></div>`;
}
function updateRegistryProfilePort(direction,index,value) {
  if (!pcbProfileActive()) return;
  const [portId,modeId] = String(value||'').split('|');
  const port = (pcbProfile.ports||[]).find(row=>row.id===portId);
  const mode = port?.modes?.find(row=>row.id===modeId);
  const c = registryRoot()[direction+'s']?.[index];
  if (!c || !port || !mode) return;
  c.physical_port = portId;
  c.physical_mode = modeId;
  c.driver = PCB_ADAPTER_DRIVER[mode.adapter];
  if (mode.reference_mv) c.i2c_reference_mv = Number(mode.reference_mv);
  if (mode.adapter === 'i2c_adc_digital_input') {
    c.digital_threshold_raw ??= 2048;
    c.digital_hysteresis_raw ??= 64;
  }
  if (mode.adapter === 'spi_thermocouple') {
    c.temp_interface = ({max6675:1,max31855:2,max31856:3})[mode.device_driver] || 1;
  }
  if (mode.adapter === 'onewire_temperature') c.temp_interface = 5;
  dirty(); renderRegistryInventory(); updateSaveButton();
}
function registrySignalSummary(c) {
  if (registryTorqueIsHx711(c)) return 'HX711 load-cell amplifier';
  const tempNames = {1:'MAX6675 thermocouple', 2:'MAX31855 thermocouple', 3:'MAX31856 thermocouple', 4:'NTC thermistor divider', 5:'DS18B20 OneWire'};
  return tempNames[Number(c.temp_interface)] || driverName(c.driver);
}
function registryInvalidDetails() {
  const r = registryRoot();
  const out = [];
  for (const direction of ['input','output']) {
    (r[direction + 's'] || []).forEach((c, index) => {
      const status = registryStatus(c);
      if (status.kind === 'error') out.push({direction, index, channel:c, text:`${registryDisplayName(direction, c, direction)}: ${status.text}`, reason:status.text});
    });
  }
  return out;
}
function registryInvalidChannels() {
  return registryInvalidDetails().map(e => e.text);
}
function registryOriginalChannel(direction, index) {
  return _registrySnap?.[direction + 's']?.[index] || null;
}
function registryFieldChanged(direction, index, key) {
  const current = registryRoot()[direction + 's']?.[index];
  const original = registryOriginalChannel(direction, index);
  if (!current) return false;
  if (!original) return true;
  return String(current[key] ?? '') !== String(original[key] ?? '');
}
function registryFieldChangedClass(direction, index, key) {
  return registryFieldChanged(direction, index, key) ? 'field-changed' : '';
}
function registryChannelChanged(direction, index) {
  if (!_registrySnap) return false;
  const current = registryRoot()[direction + 's']?.[index];
  const original = registryOriginalChannel(direction, index);
  return JSON.stringify(current || null) !== JSON.stringify(original || null);
}
function focusRegistryInvalid(details) {
  if (!details) return;
  _registryEditOpen.add(registryEditKey(details.direction, details.index));
  renderRegistryInventory();
  setTimeout(() => {
    const rows = document.querySelectorAll(`#registry-${details.direction}s .registry-card`);
    const card = rows[details.index];
    if (card) {
      card.scrollIntoView({behavior:'smooth', block:'center'});
      card.classList.add('field-error-card');
      const first = card.querySelector('.field-error, select, input, button');
      if (first && typeof first.focus === 'function') first.focus();
    }
  }, 0);
}
function registryReferenceSummary(direction, id) {
  const users = registryCurrentUsers(direction, id);
  if (users.length) return `Used by: ${users.join(', ')}`;
  return direction === 'input' ? 'Monitoring only' : 'Available to controllers and sequences';
}
function registryImpactDisplay(text) {
  const s = String(text || '');
  if (/registry binding/i.test(s)) return 'Core firmware: controller binding';
  if (/oil loop/i.test(s)) return 'Controller: oil pressure loop';
  if (/sequence side action/i.test(s)) return 'Sequencer: side action';
  if (/custom block/i.test(s)) return 'Sequencer: custom block';
  if (/control rule/i.test(s)) return `Simple controls: ${s}`;
  return s;
}
function registryCurrentUsers(direction, id) {
  const rows = registryRoot()[direction + 's'] || [];
  const channel = rows.find(c => String(c?.id || '') === String(id || ''));
  const mirrors = direction === 'output' ? (registryRoot().outputs || [])
    .filter(row => String(row?.mirror_of || '') === String(id || ''))
    .map(row => `Mirrored output: ${registryDisplayName('output', row, row.id)}`) : [];
  return [...new Set([
    ...registryRoleUsage(direction, channel),
    ...registryRemovalImpact(direction, id).map(registryImpactDisplay),
    ...mirrors
  ].filter(Boolean))];
}
function registryBlockLabel(block) {
  const labels = {
    OilPrime:'Build Oil Pressure', StarterSpin:'Starter Spin to Light-Off Speed', PreIgnSpark:'Igniter 1 Timed On',
    FuelOpen:'Open Main Fuel Shutoff', FlameConfirm:'Confirm Combustion by Flame Sensor', TempConfirm:'Confirm Combustion by Temperature',
    FuelPumpIdle:'Set Main Fuel for Idle', ModifiedIdle:'Set Main Fuel for Raised Idle', Spool:'Accelerate to Idle',
    SafetyHold:'Final Startup Checks', OilPumpOn:'Oil Pump On', OilPumpOff:'Oil Pump Off',
    OilScavengeOn:'Scavenge On', OilScavengeOff:'Scavenge Off', StarterOff:'Starter Off',
    ImmediateCut:'Immediate Fuel and Ignition Cut', RPMDrop:'Wait for Rotor to Slow',
    CooldownSpin:'Cooldown', FinalStop:'Wait for Complete Stop', ThrottleSet:'Set Main Fuel Demand',
    GlowPreheat:'Glow Preheat', FuelPumpRamp:'Secondary / Auxiliary Fuel Pump Ramp', FuelPump2Set:'Secondary / Auxiliary Fuel Pump Set',
    FuelPump2On:'Secondary / Auxiliary Fuel Pump On', FuelPump2Off:'Secondary / Auxiliary Fuel Pump Off',
    CoolFanOn:'Cooling Fan On', CoolFanOff:'Cooling Fan Off',
    BleedOpen:'Bleed Valve Open', BleedClose:'Bleed Valve Close',
    AirstarterOn:'Air Starter Valve Open', AirstarterOff:'Air Starter Valve Close',
    StarterEnOn:'Starter Enable On', StarterEnOff:'Starter Enable Off',
    FuelSolClose:'Close Main Fuel Shutoff', FuelPulse:'Pulse Main Fuel Shutoff',
    IgniterOn:'Igniter On', IgniterOff:'Igniter Off', PreHeat:'Pre-Heat',
    ABPumpOn:'Afterburner Fuel Pump On', ABPumpOff:'Afterburner Fuel Pump Off', ABIgnOn:'Afterburner Igniter On',
    ABIgnOff:'Afterburner Igniter Off', ABSolOpen:'Afterburner Fuel Valve Open', ABSolClose:'Afterburner Fuel Valve Close',
    ABCheckReady:'Check Afterburner Entry Conditions', ABFlameConfirm:'Confirm Afterburner Flame', ABStabilize:'Stabilize Afterburner'
  };
  return labels[block] || String(block || '').replace(/([a-z])([A-Z])/g, '$1 $2');
}
function registrySequenceUsers(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return [];
  const configured = registryConfiguredSequenceBlockSet();
  return blocks.filter(block => configured.has(block)).map(registryBlockLabel);
}
function registryConfiguredSequenceBlockSet() {
  const names = new Set();
  ['startup_seq','shutdown_seq','ab_seq','ab_shut_seq'].forEach(key => {
    (cfg[key] || []).forEach(block => { if (block) names.add(String(block)); });
  });
  Object.values(cfg.custom_blocks || {}).forEach(block => {
    (block?.steps || []).forEach(step => { if (step?.block) names.add(String(step.block)); });
  });
  return names;
}
function registrySequenceHasAny(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return false;
  const configured = registryConfiguredSequenceBlockSet();
  return blocks.some(block => configured.has(block));
}
function registryInputSequenceBlocksForPurpose(purpose) {
  const map = {
    n1_speed: ['StarterSpin','Spool','SafetyHold','RPMDrop','Cooldown','FinalStop','ABCheckReady'],
    tot: ['TempConfirm','Cooldown','WaitEgtCool','ABCheckReady','ABStabilize'],
    tit: ['TempConfirm','Cooldown','WaitEgtCool','ABCheckReady','ABStabilize'],
    oil_pressure: ['OilPrime','StarterSpin','Spool','SafetyHold','Cooldown'],
    flame: ['FlameConfirm'],
    ab_flame: ['ABFlameConfirm'],
    idle: ['FuelPumpIdle','ModifiedIdle']
  };
  return map[purpose] || [];
}
function registryRoleUsage(direction, c) {
  if (!c) return [];
  const uses = new Set();
  const purpose = registryDerivedPurpose(direction, c);
  const role = String(c.role || '');
  const hasSettingRule = Array.isArray(settingsCfg?.rules) && settingsCfg.rules.some(rule => registryRuleReferencesChannel(rule, direction, c));
  if (hasSettingRule) uses.add('Simple control: input or output');
  if (direction === 'input') {
    const seq = registrySequenceUsers(registryInputSequenceBlocksForPurpose(purpose));
    if (seq.length) uses.add(`Sequencer: ${seq.join(', ')}`);
    if (purpose === 'n1_speed') {
      if (cfg.safety?.overspeed !== false) uses.add('Safety: N1 overspeed');
      if (cfg.safety?.surge) uses.add('Safety: surge detection');
      if (cfg.controllers?.dynamic_idle) uses.add('Controller: automatic idle speed control');
    } else if (purpose === 'n2_speed') {
      if (cfg.safety?.n2_overspeed) uses.add('Safety: N2 overspeed');
      if (cfg.controllers?.governor) uses.add('Controller: N2 governor');
      if (cfg.controllers?.dynamic_idle) uses.add('Controller: automatic idle speed control');
    } else if (purpose === 'tot' || purpose === 'tit') {
      if (cfg.safety?.overtemp !== false) uses.add('Safety: selected-EGT overtemperature');
      if (cfg.safety?.hot_start) uses.add('Safety: pre-start EGT interlock');
    } else if (purpose === 'oil_pressure') {
      if (cfg.controllers?.oil_loop) uses.add('Controller: oil pressure loop');
      if (cfg.safety?.low_oil !== false) uses.add('Safety: low oil pressure');
      if (cfg.safety?.oil_zero !== false) uses.add('Safety: zero oil pressure');
    } else if (purpose === 'low_oil_switch') {
      if (cfg.safety?.low_oil !== false) uses.add('Safety: low oil pressure');
    } else if (purpose === 'oil_zero_switch') {
      if (cfg.safety?.oil_zero !== false) uses.add('Safety: zero oil pressure');
    } else if (purpose === 'oil_temperature') {
      if (cfg.safety?.oil_temp_high) uses.add('Safety: oil overtemperature');
    } else if (purpose === 'fuel_pressure') {
      if (cfg.safety?.fuel_press_low) uses.add('Safety: low fuel pressure');
    } else if (purpose === 'battery_voltage') {
      if (cfg.safety?.batt_low) uses.add('Safety: battery undervoltage');
    } else if (purpose === 'flame') {
      if (cfg.safety?.flameout !== false) uses.add('Safety: flameout guard');
      uses.add('Sequencer: flame confirmation');
    } else if (purpose === 'throttle') {
      uses.add('Controller: throttle input mapping');
    } else if (purpose === 'idle') {
      uses.add('Controller: idle input mapping');
    } else if (purpose === 'start_switch') {
      uses.add('Core firmware: START command');
    } else if (purpose === 'stop_switch') {
      uses.add('Core firmware: hard stop and shutdown command');
    }
  } else {
    const actKey = registryCoreActuatorKey(c);
    const dep = ACT_DEPENDENCIES[actKey];
    const ownsCore = registryOutputOwnsCorePurpose(c);
    const mirrorsCore = !!String(c.mirror_of || '');
    if (purpose === 'main_fuel') {
      uses.add(ownsCore
        ? 'Controller: fuel response & limit protection'
        : mirrorsCore
          ? 'Mirrors the final protected Main Fuel Metering command'
          : 'Independent output: assign a controller, sequence action, or rule');
    }
    if (dep && (ownsCore || mirrorsCore)) {
      const controllerLabels = {
        oil_loop:'oil pressure loop',
        dynamic_idle:'automatic idle speed control',
        governor:'N2/prop governor'
      };
      (dep.controllers || []).forEach(k => { if (cfg.controllers?.[k]) uses.add(`Controller: ${controllerLabels[k] || k.replaceAll('_',' ')}`); });
      const seq = registrySequenceUsers(dep.blocks || []);
      if (seq.length) uses.add(`Sequencer: ${seq.join(', ')}`);
    }
  }
  return [...uses];
}
function registryCoreSensorKey(c) {
  const purpose = registryDerivedPurpose('input', c || {});
  const map = {
    n1_speed:'n1_rpm', n2_speed:'n2_rpm', tot:'tot', tit:'tit',
    oil_pressure:'oil_press', oil_temperature:'oil_temp', fuel_pressure:'fuel_press',
    fuel_flow:'fuel_flow', battery_voltage:'batt_voltage', p1_pressure:'p1',
    p2_pressure:'p2', torque:'torque', flame:'flame', throttle:'throttle_input',
    idle:'idle_input'
  };
  return map[purpose] || '';
}
function registryRuleReferencesChannel(rule, direction, c) {
  if (!rule || !c) return false;
  const aliases = registryReferenceAliases(direction, c.id);
  const refMatches = value => aliases.includes(String(value || ''));
  const rows = registryRoot()[direction + 's'] || [];
  const idx = rows.findIndex(row => String(row?.id || '') === String(c.id || ''));
  const handle = idx >= 0 ? (direction === 'input' ? 80 + idx : 64 + idx) : -999;
  if (direction === 'input') {
    const sensorKey = registryCoreSensorKey(c);
    const numericSensor = sensorKey ? SENSOR_RULE_ENUM[sensorKey] : undefined;
    return refMatches(rule.source) || refMatches(rule.target_source) || refMatches(rule.sensor_id) || Number(rule.sensor) === handle ||
      (numericSensor !== undefined && Number(rule.sensor) === Number(numericSensor));
  }
  const actuatorKey = registryCoreActuatorKey(c);
  const numericActuator = actuatorKey ? ACT_RULE_ENUM[actuatorKey] : undefined;
  return refMatches(rule.target) || refMatches(rule.actuator_id) || Number(rule.actuator) === handle ||
    (numericActuator !== undefined && Number(rule.actuator) === Number(numericActuator));
}
function registryHas(direction, predicate) {
  const rows = registryRoot()[direction + 's'] || [];
  return rows.some(c => c?.installed !== false && predicate(c));
}
function registryHasPurpose(direction, purpose) {
  return registryHas(direction, c => registryDerivedPurpose(direction, c) === purpose && registryStatus(c).kind === 'ok');
}
function hardwareHasDiRole(role) {
  return (cfg.di_channels || []).some(ch => Number(ch?.pin ?? -1) >= 0 && String(ch?.role || 'none') === role);
}
function renderHardwareBoardSummary() {
  const box = document.getElementById('hardware-board-summary');
  if (!box || !cfg) return;
  const r = registryRoot();
  const gpioEntries = Object.entries(GPIO_DB || {});
  const used = new Set(Array.from(collectUsedPins()).map(Number));
  [...(r.inputs || []), ...(r.outputs || [])].forEach(c => { if ((c?.pin ?? -1) >= 0) used.add(Number(c.pin)); });
  const freePins = gpioEntries.filter(([pin, meta]) => !meta.r && !used.has(Number(pin))).length;
  const freeOutputPins = gpioEntries.filter(([pin, meta]) => !meta.r && !meta.i && !used.has(Number(pin))).length;
  const freeAdcPins = gpioEntries.filter(([pin, meta]) => !meta.r && meta.adc1 && !used.has(Number(pin))).length;
  const platformName = cfg.platform === 'esp32s3' ? 'ESP32-S3' : 'ESP32';
  const target = cfg.platform || 'unknown target';
  const registryCounts = `${(r.inputs || []).length} input(s), ${(r.outputs || []).length} output(s), ${(r.bindings || []).length} binding(s)`;
  const identity = document.getElementById('pcb-profile-identity');
  if (pcbProfileActive()) {
    if (identity) {
      identity.style.display = '';
      identity.innerHTML = `<strong>PCB hardware profile:</strong> ${escapeHtmlText(pcbProfile.name)} · revision ${escapeHtmlText(pcbProfile.revision)} · ${escapeHtmlText(pcbProfile.origin === 'official' ? 'official OpenTurbine PCB' : 'custom PCB')}. Pin routing and fitted chips are fixed by the profile flashed with this firmware.`;
    }
    const assigned = new Set([...(r.inputs||[]),...(r.outputs||[])].map(c=>c.physical_port).filter(Boolean)).size;
    box.innerHTML = [
      `${escapeHtmlText(pcbProfile.name)} · revision ${escapeHtmlText(pcbProfile.revision)}`,
      `${escapeHtmlText(pcbProfile.origin === 'official' ? 'Official OpenTurbine profile' : 'Custom PCB profile')} · ${escapeHtmlText(platformName)}`,
      `${assigned}/${Number(pcbProfile.port_count||0)} named PCB connections assigned`,
      `Registry: ${escapeHtmlText(registryCounts)}`,
      'Physical GPIO, buses and fitted chips are fixed by the flash-time PCB profile.'
    ].map(line => `<div>${line}</div>`).join('');
    return;
  }
  if (identity) identity.style.display = 'none';
  box.innerHTML = [
    `${escapeHtmlText(platformName)} / ${escapeHtmlText(target)}`,
    `${freePins} total GPIO free`,
    `${freeOutputPins} output-capable GPIO free`,
    `${freeAdcPins} ADC-capable GPIO free`,
    `Registry: ${escapeHtmlText(registryCounts)}`
  ].map(line => `<div>${line}</div>`).join('');
}
function controlFieldChanged(which, key) {
  const before = key === 'label'
    ? (_workflowSnap?.labels || {})[which]
    : (_workflowSnap?.controls || {})[`${which}_${key}`];
  const after = key === 'label'
    ? (cfg?.labels || {})[which]
    : (cfg?.controls || {})[`${which}_${key}`];
  // Optional switch fields acquire explicit defaults while the Hardware page
  // loads. Compare their effective values so that undefined -> default does
  // not paint an unchanged Start/Stop card as an unsaved yellow change.
  if (key === 'label') {
    const fallback = which === 'stop' ? 'Stop' : 'Start';
    return String(before || fallback) !== String(after || fallback);
  }
  if (key === 'pin') return Number(before ?? -1) !== Number(after ?? -1);
  if (key === 'pullup') return (before !== false) !== (after !== false);
  if (key === 'active_h' || key === 'pulldown') return !!before !== !!after;
  return JSON.stringify(before) !== JSON.stringify(after);
}
function controlFieldClass(which, key) {
  return controlFieldChanged(which, key) ? 'field-changed' : '';
}
function controlCardChanged(which) {
  return ['label','pin','active_h','pullup','pulldown'].some(key => controlFieldChanged(which, key));
}
function digitalSwitchEditor(row) {
  const pinOptions = buildPinOptions(row.pin, 'in');
  const labelValue = escapeHtmlText(row.label || '');
  const activeLow = row.activeHigh ? '' : ' selected';
  const activeHigh = row.activeHigh ? ' selected' : '';
  const pull = row.pullup !== false ? 'checked' : '';
  const pullDown = row.pulldown ? 'checked' : '';
  return `<div class="registry-card-editor" style="display:block">
    <div class="hw-grid">
      <div class="hw-field"><span class="hw-label">Display label</span><input class="${controlFieldClass(row.key,'label')}" data-control-field="${row.key}_label" type="text" maxlength="31" placeholder="${escapeHtmlText(row.defaultLabel)}" value="${labelValue}" onchange="${row.labelSet}"></div>
      <div class="hw-field"><span class="hw-label">GPIO pin</span><span class="hw-desc">Strap pins can prevent boot if held at the wrong level during reset. UART0 pins can interfere with flashing or serial diagnostics; ordinary GPIO is preferred.</span><select class="${controlFieldClass(row.key,'pin')}" data-control-field="${row.key}_pin" onchange="${row.pinSet}">${pinOptions}</select></div>
      <div class="hw-field"><span class="hw-label">Active polarity</span><select class="${controlFieldClass(row.key,'active_h')}" data-control-field="${row.key}_active_h" onchange="${row.polSet}"><option value="0"${activeLow}>Active LOW</option><option value="1"${activeHigh}>Active HIGH</option></select></div>
      <div class="hw-field"><span class="hw-label">Input bias</span><span class="hw-desc">Use one internal resistor for a plain switch. Active LOW normally uses pull-up; active HIGH normally uses pull-down.</span><div class="hw-toggle-row">
        <label class="hw-toggle"><input class="${controlFieldClass(row.key,'pullup')}" data-control-field="${row.key}_pullup" type="checkbox" ${pull} onchange="${row.pullSet}"><span></span> Pull-up</label>
        <label class="hw-toggle"><input class="${controlFieldClass(row.key,'pulldown')}" data-control-field="${row.key}_pulldown" type="checkbox" ${pullDown} onchange="${row.pullDownSet}"><span></span> Pull-down</label>
      </div></div>
    </div>
  </div>`;
}
function setControlPull(which, pull, value) {
  if (!cfg.controls) cfg.controls = {};
  const up = `${which}_pullup`;
  const down = `${which}_pulldown`;
  cfg.controls[pull === 'up' ? up : down] = !!value;
  if (value) cfg.controls[pull === 'up' ? down : up] = false;
  dirty(); renderBuiltinInputSummary();
}
function abTriggerWorkflowCard() {
  if (!hardwareHasAfterburner()) return '';
  const abt = cfg.ab_trigger || {};
  const source = Number(abt.source || 0);
  const sourceLabel = ['Manual / browser command','Throttle threshold','Physical trigger switch','Analog or RC command input'][source] || 'Unknown source';
  const registryArmInput = registryHasPurpose('input','ab_arm');
  const usesDiArm = hardwareHasDiRole('ab_arm') || registryArmInput;
  const profileFireInput = registryHasPurpose('input','ab_fire');
  const profileCommandInput = registryHasPurpose('input','ab_command');
  const armDetail = source !== 0 && abt.requires_arm
    ? (usesDiArm ? ' · armed by an AB Arm inventory switch' : ` · arm GPIO ${Number(abt.arm_pin ?? -1) >= 0 ? abt.arm_pin : 'not set'}`)
    : '';
  const sourcePin = source === 2 ? Number(abt.switch_pin ?? -1) : source === 3 ? Number(abt.input_pin ?? -1) : 0;
  const pinRequired = (source === 2 && !profileFireInput) ||
                      (source === 3 && !profileCommandInput);
  const profileInputMissing = (source === 2 && pcbProfileActive() && !profileFireInput) ||
                              (source === 3 && pcbProfileActive() && !profileCommandInput);
  const armMissing = source !== 0 && abt.requires_arm && !usesDiArm &&
                     (pcbProfileActive() || Number(abt.arm_pin ?? -1) < 0);
  const status = (pinRequired && sourcePin < 0) || profileInputMissing || armMissing ? 'Input missing' : 'Ready';
  const editing = _workflowEditOpen.has('ab_trigger');
  const pinMode = abt.input_rc_pwm ? 'in' : 'adc';
  const triggerChanged = JSON.stringify(_workflowSnap?.ab_trigger || {}) !== JSON.stringify(abt);
  const fieldClass = key => JSON.stringify((_workflowSnap?.ab_trigger || {})[key]) !== JSON.stringify(abt[key]) ? 'field-changed' : '';
  const rawThreshold = Math.max(0, Math.min(4095, Math.round(abt.input_threshold ?? 2048)));
  const thresholdValue = abt.input_rc_pwm
    ? Math.round(rawThreshold * 100 / 4095)
    : (rawThreshold * 3.3 / 4095).toFixed(2);
  const editor = editing ? `<div class="registry-card-editor" style="display:block"><div class="hw-grid">
    <div class="hw-field"><span class="hw-label">Trigger source</span><span class="hw-desc">Choose what physically requests afterburner. For throttle mode, set Throttle Trigger % in Controllers → Afterburner.</span><select class="${fieldClass('source')}" data-ab-trigger-field="source" onchange="setAbTrigSrc(+this.value);renderHardwareWorkflowSummaries()"><option value="0"${source===0?' selected':''}>Manual / browser command</option><option value="1"${source===1?' selected':''}>Throttle threshold</option><option value="2"${source===2?' selected':''}>Physical switch</option><option value="3"${source===3?' selected':''}>Analog or RC command input</option></select></div>
    ${source===2 ? ((pcbProfileActive() || profileFireInput) ? `<div class="hw-field"><span class="hw-label">Physical command input</span><span class="hw-desc">${profileFireInput?'Uses the fitted Afterburner command switch from Inputs.':'Add an Afterburner command switch under Inputs and choose its named PCB connection.'}</span></div>` : `<div class="hw-field"><span class="hw-label">Trigger-switch GPIO</span><select class="${fieldClass('switch_pin')}" data-ab-trigger-field="switch_pin" onchange="setAbTrig('switch_pin',+this.value).then(()=>renderHardwareWorkflowSummaries())">${buildPinOptions(abt.switch_pin,'in')}</select></div><div class="hw-field"><span class="hw-label">Switch polarity</span><label class="hw-toggle"><input class="${fieldClass('switch_active_h')}" data-ab-trigger-field="switch_active_h" type="checkbox" ${abt.switch_active_h?'checked':''} onchange="setAbTrigBool('switch_active_h',this.checked);renderHardwareWorkflowSummaries()"><span></span> Active high</label></div>`) : ''}
    ${source===3 ? ((pcbProfileActive() || profileCommandInput) ? `<div class="hw-field"><span class="hw-label">Command input</span><span class="hw-desc">${profileCommandInput?'Uses the fitted Afterburner analog / RC command from Inputs. Its signal type and calibration live on that input card.':'Add an Afterburner analog / RC command under Inputs and choose its named PCB connection.'}</span></div><div class="hw-field"><span class="hw-label">Trigger threshold (%)</span><span class="hw-desc">Afterburner is requested when the normalized command rises above this percentage.</span><input class="${fieldClass('input_threshold')}" type="number" min="0" max="100" step="1" value="${Math.round(rawThreshold*100/4095)}" onchange="setAbProfileThreshold(this.value)"></div>` : `<div class="hw-field"><span class="hw-label">Command signal</span><select class="${fieldClass('input_rc_pwm')}" data-ab-trigger-field="input_rc_pwm" onchange="setAbInputType(this.value==='rc');renderHardwareWorkflowSummaries()"><option value="analog"${!abt.input_rc_pwm?' selected':''}>Analog 0-3.3 V</option><option value="rc"${abt.input_rc_pwm?' selected':''}>RC servo pulse</option></select></div><div class="hw-field"><span class="hw-label">Command-input GPIO</span><select class="${fieldClass('input_pin')}" data-ab-trigger-field="input_pin" onchange="setAbTrig('input_pin',+this.value).then(()=>renderHardwareWorkflowSummaries())">${buildPinOptions(abt.input_pin,pinMode)}</select></div><div class="hw-field"><span class="hw-label">Trigger threshold (${abt.input_rc_pwm?'%':'V'})</span><span class="hw-desc">Afterburner is requested when this command input rises above the threshold.</span><input class="${fieldClass('input_threshold')}" data-ab-trigger-field="input_threshold" type="number" min="0" max="${abt.input_rc_pwm?'100':'3.3'}" step="${abt.input_rc_pwm?'1':'0.01'}" value="${thresholdValue}" onchange="setAbWorkflowThreshold(this.value)"></div>${abt.input_rc_pwm?`<div class="hw-field"><span class="hw-label">RC pulse range (us)</span><span class="hw-desc">Pulse widths representing 0% and 100% command.</span><div style="display:flex;gap:.35rem"><input class="${fieldClass('input_min_us')}" data-ab-trigger-field="input_min_us" aria-label="RC pulse minimum" type="number" min="500" max="2500" value="${Number(abt.input_min_us ?? 1000)}" onchange="setAbTrigBool('input_min_us',+this.value)"><input class="${fieldClass('input_max_us')}" data-ab-trigger-field="input_max_us" aria-label="RC pulse maximum" type="number" min="500" max="2500" value="${Number(abt.input_max_us ?? 2000)}" onchange="setAbTrigBool('input_max_us',+this.value)"></div></div>`:''}`) : ''}
    ${source!==0 ? `<div class="hw-field"><span class="hw-label">Arming interlock</span><label class="hw-toggle"><input class="${fieldClass('requires_arm')}" data-ab-trigger-field="requires_arm" type="checkbox" ${abt.requires_arm?'checked':''} onchange="setAbTrigBool('requires_arm',this.checked);renderHardwareWorkflowSummaries()"><span></span> Require a separate arm switch</label></div>${abt.requires_arm&&!usesDiArm?(pcbProfileActive()?`<div class="hw-field"><span class="hw-label">Arm switch</span><span class="hw-desc">Add an Afterburner arm switch under Inputs and choose its named PCB connection.</span></div>`:`<div class="hw-field"><span class="hw-label">Arm-switch GPIO</span><select class="${fieldClass('arm_pin')}" data-ab-trigger-field="arm_pin" onchange="setAbTrig('arm_pin',+this.value).then(()=>renderHardwareWorkflowSummaries())">${buildPinOptions(abt.arm_pin,'in')}</select></div><div class="hw-field"><span class="hw-label">Arm polarity</span><label class="hw-toggle"><input class="${fieldClass('arm_active_h')}" data-ab-trigger-field="arm_active_h" type="checkbox" ${abt.arm_active_h?'checked':''} onchange="setAbTrigBool('arm_active_h',this.checked);renderHardwareWorkflowSummaries()"><span></span> Active high</label></div>`):''}` : ''}
  </div></div>` : '';
  return `<div class="hw-item-card ${editing?'registry-card-open':''} ${triggerChanged?'field-change-parent field-changed':''}" data-workflow-key="ab_trigger"><div class="registry-card-summary"><div><strong>Afterburner trigger and arm</strong><div class="hw-desc">${escapeHtmlText(sourceLabel + armDetail)}</div></div><div class="registry-card-actions"><span class="registry-status ${status==='Ready'?'registry-status-ok':'registry-status-error'}">${status}</span><button type="button" onclick="toggleWorkflowEditor('ab_trigger')">${editing?'Done':'Edit'}</button></div></div>${editor}</div>`;
}
function renderBuiltinInputSummary() {
  const box = document.getElementById('builtin-inputs');
  if (!box || !cfg) return;
  if (pcbProfileActive()) {
    box.innerHTML = '<div class="registry-empty"><strong>Switch wiring comes from this PCB profile.</strong><div class="hw-desc">Add Start switch, Stop switch, and any interlocks under Inputs, then choose their labelled PCB connections. Raw GPIO wiring is intentionally unavailable in PCB mode.</div></div>';
    return;
  }
  const rows = [];
  const controls = cfg.controls || {};
  const labels = cfg.labels || {};
  const rawPinStatus = pin => {
    if ((pin ?? -1) < 0) return 'Pin missing';
    const info = GPIO_DB?.[Number(pin)];
    return !info || info.r ? 'GPIO unavailable' : 'Ready';
  };
  const addSwitch = (key, title, pin, activeHigh, pullup, pulldown, detail) => rows.push({
    key,
    title,
    detail: `${detail} · Digital input · GPIO ${(pin ?? -1) >= 0 ? pin : 'not set'} · ${activeHigh ? 'Active HIGH' : 'Active LOW'}`,
    status: rawPinStatus(pin),
    pin,
    activeHigh,
    pullup,
    pulldown,
    label: labels[key] || '',
    defaultLabel: key === 'stop' ? 'Stop' : 'Start',
    pinSet: `setNested('controls','${key}_pin',+this.value)`,
    polSet: `setNested('controls','${key}_active_h',this.value==='1')`,
    pullSet: `setControlPull('${key}','up',this.checked)`,
    pullDownSet: `setControlPull('${key}','down',this.checked)`,
    labelSet: `setLabel('${key}',this.value)`
  });
  addSwitch('stop', labels.stop || 'Stop switch', controls.stop_pin, !!controls.stop_active_h, controls.stop_pullup, controls.stop_pulldown, 'Hard stop / shutdown command');
  addSwitch('start', labels.start || 'Start switch', controls.start_pin, !!controls.start_active_h, controls.start_pullup, controls.start_pulldown, 'Start command input');
  (cfg.di_channels || []).forEach((ch, i) => {
    if (!ch) return;
    const role = ch.role || 'none';
    const configured = (ch.pin ?? -1) >= 0 || role !== 'none' || (ch.label || '').trim();
    if (!configured) return;
    const roleLabel = DI_ROLES.find(r => r.val === role)?.lbl || role;
    rows.push({
      key: `di${i}`,
      title: ch.label || `Digital input ${i + 1}`,
      detail: `${roleLabel} · Digital input · GPIO ${(ch.pin ?? -1) >= 0 ? ch.pin : 'not set'} · ${ch.active_h ? 'Active HIGH' : 'Active LOW'}`,
      status: rawPinStatus(ch.pin),
      target: 'switches'
    });
  });
  box.innerHTML = rows.map(row => `<div class="hw-item-card ${!row.target && controlCardChanged(row.key) ? 'field-changed' : ''}" data-workflow-key="${escapeHtmlText(row.key)}">
    <div class="registry-card-summary">
      <div><strong>${escapeHtmlText(row.title)}</strong><div class="hw-desc">${escapeHtmlText(row.detail)}</div></div>
      <div class="registry-card-actions">
        <span class="registry-status ${row.status === 'Ready' ? 'registry-status-ok' : 'registry-status-error'}">${escapeHtmlText(row.status)}</span>
        ${row.target ? '' : `<button type="button" onclick="toggleWorkflowEditor('${row.key}')">${_workflowEditOpen.has(row.key) ? 'Done' : 'Edit'}</button>`}
      </div>
    </div>
    ${_workflowEditOpen.has(row.key) && !row.target ? digitalSwitchEditor(row) : ''}
  </div>`).join('') + abTriggerWorkflowCard();
}
function workflowCard(title, detail, state) {
  const ok = state === 'Enabled' || state === 'Ready';
  return `<div class="hw-item-card workflow-card">
    <div class="registry-card-summary">
      <div><strong>${escapeHtmlText(title)}</strong><div class="hw-desc">${escapeHtmlText(detail)}</div></div>
      <span class="registry-status ${ok ? 'registry-status-ok' : ''}">${escapeHtmlText(state)}</span>
    </div>
  </div>`;
}
function renderBusSummary() {
  const box = document.getElementById('hardware-buses-summary');
  const editor = document.getElementById('hardware-buses-editor');
  if (!box || !editor || !cfg) return;
  const editing = _workflowEditOpen.has('buses');
  editor.style.display = editing ? '' : 'none';
  box.style.display = editing ? 'none' : '';
  if (editing) return;
  const profileOwned = pcbProfileActive();
  const i2c = cfg.i2c || {};
  const spi = cfg.spi || {};
  const channels = [...(registryRoot().inputs || []), ...(registryRoot().outputs || [])];
  const assignedI2cAddresses = new Set(channels
    .filter(channel => Number(channel.driver) >= 8 && Number(channel.i2c_address) > 0)
    .map(channel => Number(channel.i2c_address)));
  const connectedI2cAddresses = new Set((cfg._i2c_discovery?.devices || [])
    .filter(device => device.present && Number(device.address) > 0)
    .map(device => Number(device.address)));
  const spiAssignments = (registryRoot().inputs || []).filter(registryTemperatureIsSpi).length;
  const i2cCount = `${connectedI2cAddresses.size} connected · ${assignedI2cAddresses.size} assigned`;
  const spiCount = `${spiAssignments} assigned device${spiAssignments === 1 ? '' : 's'}`;
  const i2cDetail = i2c.enabled
    ? (profileOwned ? 'Wiring is fixed by the flashed PCB profile'
      : `SDA GPIO ${Number(i2c.sda_pin ?? -1)}, SCL GPIO ${Number(i2c.scl_pin ?? -1)}, ${Number(i2c.frequency_hz ?? 400000) / 1000} kHz`) + ` · ${i2cCount}`
    : 'No I2C sensors or expansion devices enabled';
  const spiParts = [`SCK GPIO ${Number(spi.sck_pin ?? -1)}`, `MISO GPIO ${Number(spi.miso_pin ?? -1)}`];
  if (Number(spi.mosi_pin ?? -1) >= 0) spiParts.push(`MOSI GPIO ${Number(spi.mosi_pin)}`);
  const spiDetail = spi.enabled
    ? (profileOwned ? 'Wiring is fixed by the flashed PCB profile' : spiParts.join(', ')) + ` · ${spiCount}`
    : 'No shared SPI sensor bus enabled';
  box.innerHTML =
    workflowCard('I2C bus', i2cDetail, i2c.enabled ? 'Enabled' : 'Disabled') +
    workflowCard('SPI bus', spiDetail, spi.enabled ? 'Enabled' : 'Disabled');
}
function workflowFieldChanged(group, key) {
  return JSON.stringify((_workflowSnap?.[group] || {})[key]) !== JSON.stringify((cfg?.[group] || {})[key]);
}
function workflowDeviceObject(device) {
  if (device === 'status_led') return cfg?.actuators?.status_led || {};
  return cfg?.[device] || {};
}
function workflowDeviceChanged(device) {
  return JSON.stringify(_workflowSnap?.devices?.[device] || {}) !== JSON.stringify(workflowDeviceObject(device));
}
function workflowDeviceFieldClass(device, key) {
  const before = (_workflowSnap?.devices?.[device] || {})[key];
  const after = workflowDeviceObject(device)[key];
  return JSON.stringify(before) !== JSON.stringify(after) ? 'field-changed' : '';
}
function controllerLabel(key) {
  return ({
    oil_loop: 'oil pressure loop',
    dynamic_idle: 'automatic idle speed control',
    governor: 'automatic N2 speed control'
  })[key] || key;
}
function oilLoopChannels(direction, purpose) {
  return (registryRoot()[direction + 's'] || []).filter(c => c && c.installed !== false &&
    (registryDerivedPurpose(direction, c) === purpose ||
     (direction === 'output' && purpose === 'oil_pump' && c.role === 'oil_pump')));
}
function ensureOilLoops() {
  if (!Array.isArray(cfg.oil_loops)) cfg.oil_loops = [];
  if (!cfg.oil_loops.length) {
    const pressure = oilLoopChannels('input', 'oil_pressure')[0];
    const pump = oilLoopChannels('output', 'oil_pump')[0];
    if (pressure && pump) cfg.oil_loops.push({enabled:true,id:'main',pressure_input:pressure.id,pump_output:pump.id,target_source:0,target_bar:2.5,target_high_bar:2.5,speed_min_rpm:0,speed_max_rpm:20000,deadband_bar:.2,response_gain:1.8,failsafe_delay_ms:1500,failsafe_demand:.6,min_demand:.18,max_demand:1});
  }
  return cfg.oil_loops;
}
function updateOilLoop(index, key, value) {
  const loop = ensureOilLoops()[index];
  if (!loop) return;
  loop[key] = value;
  dirty();
  renderHardwareWorkflowSummaries();
}
function addOilLoop() {
  const loops = ensureOilLoops();
  const maxLoops = Math.max(1, Number(cfg?._capabilities?.max_oil_loops || 6));
  if (loops.length >= maxLoops) return;
  const used = new Set(loops.map(l => l.pump_output));
  const pressure = oilLoopChannels('input', 'oil_pressure')[0];
  const pump = oilLoopChannels('output', 'oil_pump').find(c => !used.has(c.id));
  if (!pressure || !pump) return;
  loops.push({enabled:true,id:`oil${loops.length+1}`,pressure_input:pressure.id,pump_output:pump.id,target_source:0,target_bar:2.5,target_high_bar:2.5,speed_min_rpm:0,speed_max_rpm:20000,deadband_bar:.2,response_gain:1.8,failsafe_delay_ms:1500,failsafe_demand:.6,min_demand:.18,max_demand:1});
  dirty();
  renderHardwareWorkflowSummaries();
}
function removeOilLoop(index) {
  ensureOilLoops().splice(index, 1);
  dirty();
  renderHardwareWorkflowSummaries();
}
function oilLoopInlineEditor() {
  const loops = ensureOilLoops();
  const pressures = oilLoopChannels('input', 'oil_pressure');
  const pumps = oilLoopChannels('output', 'oil_pump');
  const hasN1 = registryHasPurpose('input','n1_speed');
  const hasN2 = registryHasPurpose('input','n2_speed');
  const options = (rows, selected) => rows.map(c => `<option value="${escapeHtmlText(c.id)}"${c.id===selected?' selected':''}>${escapeHtmlText(c.name||c.id)}</option>`).join('');
  const num = (i,key,label,value,step,min=0,max='') => `<label class="hw-field"><span class="hw-label">${label}</span><input type="number" min="${min}" ${max!==''?`max="${max}"`:''} step="${step}" value="${Number(value)}" onchange="updateOilLoop(${i},'${key}',+this.value)"></label>`;
  const cards = loops.map((loop,i) => {
    const source = Number(loop.target_source || 0);
    const pump = pumps.find(c => c.id === loop.pump_output);
    const binary = pump && outputDriverIsOnOff(pump.driver);
    const loopWarnings = [];
    const lowTarget = Number(loop.target_bar ?? 2.5);
    const highTarget = Number(loop.target_high_bar ?? lowTarget);
    const runningMinimum = Number(settingsCfg?.oil?.running_min || 0);
    if (source !== 0 && highTarget < lowTarget) loopWarnings.push('Pressure decreases as fuel/speed increases. Keep this only if intentional.');
    if (runningMinimum > 0 && Math.min(lowTarget, source === 0 ? lowTarget : highTarget) < runningMinimum)
      loopWarnings.push(`A target is below the running low-oil fault threshold (${runningMinimum} bar).`);
    return `<div class="hw-item-card" style="grid-column:1/-1"><div class="registry-card-summary"><div><strong>Oil pressure loop ${i+1}</strong><div class="hw-desc">${binary?'On/off oil-pressure control. Requires a suitable accumulator or relief arrangement.':'Proportional oil-pump pressure control.'}</div></div>${loops.length>1?`<button class="btn-sm danger" onclick="removeOilLoop(${i})">Remove</button>`:''}</div><div class="registry-card-editor" style="display:grid">
      ${pressures.length>1?`<label class="hw-field"><span class="hw-label">Pressure input</span><select onchange="updateOilLoop(${i},'pressure_input',this.value)">${options(pressures,loop.pressure_input)}</select></label>`:''}
      ${pumps.length>1?`<label class="hw-field"><span class="hw-label">Pump output</span><select onchange="updateOilLoop(${i},'pump_output',this.value)">${options(pumps,loop.pump_output)}</select></label>`:''}
      <label class="hw-field"><span class="hw-label">Pressure target source</span><select onchange="updateOilLoop(${i},'target_source',+this.value)"><option value="0"${source===0?' selected':''}>Fixed pressure</option><option value="1"${source===1?' selected':''}>Effective core-fuel demand</option>${hasN1?`<option value="2"${source===2?' selected':''}>N1 shaft speed</option>`:''}${hasN2?`<option value="3"${source===3?' selected':''}>N2 shaft speed</option>`:''}</select></label>
      ${num(i,'target_bar',source===0?'Pressure target (bar)':'Low pressure target (bar)',loop.target_bar??2.5,.01)}
      ${source!==0?num(i,'target_high_bar','High pressure target (bar)',loop.target_high_bar??loop.target_bar??2.5,.01):''}
      ${source>=2?num(i,'speed_min_rpm','Low shaft speed (RPM)',loop.speed_min_rpm??0,100):''}
      ${source>=2?num(i,'speed_max_rpm','High shaft speed (RPM)',loop.speed_max_rpm??20000,100):''}
      ${num(i,'deadband_bar','Pressure deadband (bar)',loop.deadband_bar??.2,.01)}
      ${binary?'':num(i,'response_gain','Response gain',loop.response_gain??1.8,.05)}
      ${binary?'':`<label class="hw-field"><span class="hw-label">Minimum pump output (%)</span><input type="number" min="0" max="100" step="1" value="${Math.round(Number(loop.min_demand??.18)*100)}" onchange="updateOilLoop(${i},'min_demand',+this.value/100)"></label>`}
      ${binary?'':`<label class="hw-field"><span class="hw-label">Maximum pump output (%)</span><input type="number" min="0" max="100" step="1" value="${Math.round(Number(loop.max_demand??1)*100)}" onchange="updateOilLoop(${i},'max_demand',+this.value/100)"></label>`}
      ${num(i,'failsafe_delay_ms','Feedback-loss delay (ms)',loop.failsafe_delay_ms??1500,100)}
      <label class="hw-field"><span class="hw-label">Feedback-loss pump output (%)</span><input type="number" min="0" max="100" step="1" value="${Math.round(Number(loop.failsafe_demand??.6)*100)}" onchange="updateOilLoop(${i},'failsafe_demand',+this.value/100)"></label>
      ${loopWarnings.length?`<div class="workflow-prerequisite" style="grid-column:1/-1">Warning: ${escapeHtmlText(loopWarnings.join(' '))}</div>`:''}
    </div></div>`;
  }).join('');
  const maxLoops = Math.max(1, Number(cfg?._capabilities?.max_oil_loops || 6));
  const canAdd = loops.length < maxLoops && pumps.some(p => !loops.some(l => l.pump_output === p.id));
  return `<div class="registry-card-editor" style="display:grid">${cards}${canAdd?'<button class="btn-sm" onclick="addOilLoop()">Add another oil system</button>':''}</div>`;
}
function controllerAvailability(key) {
  const hasN1 = registryHasPurpose('input','n1_speed');
  const hasN2 = registryHasPurpose('input','n2_speed');
  const hasIdleFeedback = hasN1 || hasN2 || registryHasPurpose('input','p1_pressure') || registryHasPurpose('input','p2_pressure');
  const throttle = oilLoopChannels('output','main_fuel')[0];
  const hasThrottle = !!throttle;
  const hasMeteringThrottle = !!throttle && outputDriverIsProportional(throttle.driver);
  const hasOilPressure = registryHasPurpose('input','oil_pressure');
  const hasOilPump = registryHasPurpose('output','oil_pump');
  const propPitch = oilLoopChannels('output','prop_pitch')[0];
  const hasPropPitch = !!propPitch && (outputDriverIsOnOff(propPitch.driver) || outputDriverIsProportional(propPitch.driver));
  const map = {
    oil_loop: [hasOilPressure && hasOilPump, 'Requires oil-pressure input and oil-pump output.'],
    dynamic_idle: [hasMeteringThrottle && hasIdleFeedback, 'Requires proportional main-fuel output and N1, N2, P1, or P2 feedback input.'],
    governor: [hasN2 && (hasMeteringThrottle || hasPropPitch), 'Requires N2 speed input plus proportional main fuel or a supported proportional/relay prop-pitch output.']
  };
  const [ok, reason] = map[key] || [true, ''];
  return {ok, reason};
}
function controllerInlineEditor() {
  const c = cfg.controllers || {};
  const throttle = oilLoopChannels('output','main_fuel')[0];
  const hasThrottle = !!throttle;
  const hasMeteringThrottle = !!throttle && outputDriverIsProportional(throttle.driver);
  const cb = (key, label, desc, checked, handler) => {
    const availability = controllerAvailability(key);
    const enabled = availability.ok;
    const changed = workflowFieldChanged('controllers', key);
    const target = {oil_loop:'cf-oil_mm', dynamic_idle:'cf-di_src', governor:'cf-gv_tr'}[key];
    return `<div class="hw-item-card ${enabled ? '' : 'disabled-safety'} ${changed ? 'field-changed' : ''}" title="${enabled ? '' : escapeHtmlText(availability.reason)}">
    <div class="registry-card-summary">
      <div><strong>${escapeHtmlText(label)}</strong><div class="hw-desc">${escapeHtmlText(desc)}</div>${enabled ? '' : `<div class="workflow-prerequisite">Not available yet: ${escapeHtmlText(availability.reason)}</div>`}</div>
      <label class="hw-toggle"><input class="${changed ? 'field-changed' : ''}" type="checkbox" ${checked && enabled ? 'checked' : ''} ${enabled ? '' : 'disabled'} onchange="${handler}"><span></span> Enable</label>
    </div>
    ${target ? `<div class="context-links"><a href="/controllers.html#${target}">Open its Controller settings &rarr;</a></div>` : ''}
  </div>`;
  };
  return `<div class="registry-card-editor" style="display:block">
    ${cb('oil_loop', 'Oil pressure loop', 'Closed-loop oil pressure control. Requires oil pressure input and oil pump output.', !!c.oil_loop, "setController('oil_loop',this.checked)")}
    ${c.oil_loop ? oilLoopInlineEditor() : ''}
    ${hasThrottle ? `<div class="hw-item-card" style="grid-column:1/-1"><div class="registry-card-summary"><div><strong>Fuel response &amp; limit protection</strong><div class="hw-desc">Automatic with Main Fuel. Configure normal opening/closing response and N1, N2, temperature, P1, P2 or torque protection in <a href="/controllers.html#engine-limits">Controllers → Engine Limits &amp; Protection</a>.</div></div><span class="registry-status registry-status-ok">Ready</span></div></div>` : ''}
    ${cb('dynamic_idle', 'Automatic idle control', 'Commands the main fuel output to hold N1 or N2 speed (normal proven methods), or experimental P1/P2 pressure. Choose the feedback source and tune it in Config > Start, Run & Recovery.', !!c.dynamic_idle, "setController('dynamic_idle',this.checked)")}
    ${cb('governor', 'Automatic N2 speed control', 'Generator/turboshaft: proportional main fuel controls N2. Prop Pitch uses proportional control or deliberate relay fine/coarse control. Set N2 target and response in Config > Power System.', !!c.governor, "setController('governor',this.checked)")}
  </div>`;
}
function renderControllerSummary() {
  const box = document.getElementById('hardware-controllers-summary');
  if (!box || !cfg) return;
  const c = cfg.controllers || {};
  const rows = [
    ['oil_loop', 'Oil pressure loop', 'Closed-loop oil pressure control', !!c.oil_loop],
    [null, 'Fuel response & limit protection', 'Automatic with Main Fuel; limits and response are configured in Controllers', registryHasPurpose('output','main_fuel')],
    ['dynamic_idle', 'Automatic idle speed control', 'Automatically holds the configured idle speed', !!c.dynamic_idle],
    ['governor', 'Automatic N2 speed control', 'Holds power-turbine speed using fuel or propeller pitch', !!c.governor],
  ];
  const enabledRows = rows.filter(r => r[3]);
  const available = rows.filter(r => r[0] && !r[3] && controllerAvailability(r[0]).ok).length;
  const availability = available ? `<div class="workflow-availability">${available} more available to enable from the fitted hardware.</div>` : '';
  const editing = _workflowEditOpen.has('controllers');
  box.innerHTML = editing ? controllerInlineEditor() : (enabledRows.length
    ? enabledRows.map(r => workflowCard(r[1], r[2], 'Enabled')).join('') + availability
    : `<div class="registry-empty"><div>No optional controllers enabled.${available ? ` ${available} available to enable.` : ''}</div></div>`);
}
function safetyAvailability(key) {
  const hasSpeed = registryHasPurpose('input','n1_speed');
  const hasN2Speed = registryHasPurpose('input','n2_speed');
  const hasTot = registryHasPurpose('input','tot');
  const hasTit = registryHasPurpose('input','tit');
  const hasEgt = hasTot || hasTit;
  const hasOilPress = registryHasPurpose('input','oil_pressure');
  const hasLowOilSwitch = hardwareHasDiRole('low_oil_switch') || registryHasPurpose('input','low_oil_switch');
  const hasOilZeroSwitch = hardwareHasDiRole('oil_zero_switch') || registryHasPurpose('input','oil_zero_switch');
  const hasOilTemp = registryHasPurpose('input','oil_temperature');
  const hasFuelPress = registryHasPurpose('input','fuel_pressure');
  const hasBattery = registryHasPurpose('input','battery_voltage');
  const hasFlameConfirm = registryHasPurpose('input','flame') || hasSpeed || hasEgt;
  const map = {
    overspeed: [hasSpeed, 'Requires primary N1 speed input.'],
    n2_overspeed: [hasN2Speed, 'Requires N2 power-turbine speed input.'],
    overtemp: [hasEgt, 'Requires a TOT or TIT temperature input.'],
    low_oil: [hasOilPress || hasLowOilSwitch, 'Requires oil-pressure input or low-oil switch.'],
    oil_zero: [hasOilPress || hasOilZeroSwitch, 'Requires oil-pressure input or zero-oil switch.'],
    flameout: [hasFlameConfirm, 'Requires flame, N1, TOT or TIT confirmation.'],
    hot_start: [hasEgt, 'Requires turbine temperature input.'],
    oil_temp_high: [hasOilTemp, 'Requires oil-temperature input.'],
    fuel_press_low: [hasFuelPress, 'Requires fuel-pressure input.'],
    batt_low: [hasBattery, 'Requires battery-voltage input.'],
    surge: [hasSpeed, 'Requires N1 input.']
  };
  const [ok, reason] = map[key] || [true, ''];
  return {ok, reason};
}
function safetyInlineEditor() {
  const s = cfg.safety || {};
  const cb = (key, label, desc, checked) => {
    const availability = safetyAvailability(key);
    const enabled = availability.ok;
    const changed = workflowFieldChanged('safety', key);
    const target = {
      overspeed:'cf-rpm_limit', n2_overspeed:'cf-n2_rpm_limit',
      overtemp:'cf-eg_src', low_oil:'cf-oil_rm', oil_zero:'cf-oil_zb',
      flameout:'cf-sf_fs', hot_start:'cf-sf_hs', oil_temp_high:'cf-sf_ot',
      fuel_press_low:'cf-sf_fp', batt_low:'cf-sf_bv', surge:'cf-sf_sg'
    }[key];
    return `<div class="hw-item-card ${enabled ? '' : 'disabled-safety'} ${changed ? 'field-changed' : ''}" title="${enabled ? '' : escapeHtmlText(availability.reason)}">
    <div class="registry-card-summary">
      <div><strong>${escapeHtmlText(label)}</strong><div class="hw-desc">${escapeHtmlText(desc)}</div>${enabled ? '' : `<div class="workflow-prerequisite">Not available yet: ${escapeHtmlText(availability.reason)}</div>`}</div>
      <label class="hw-toggle"><input class="${changed ? 'field-changed' : ''}" type="checkbox" ${checked && enabled ? 'checked' : ''} ${enabled ? '' : 'disabled'} onchange="setSafety('${key}',this.checked,null)"><span></span> Enable</label>
    </div>
    <div class="context-links"><a href="/controllers.html#${target}">Open its limit and timing &rarr;</a></div>
  </div>`;
  };
  return `<div class="registry-card-editor" style="display:block">
    ${cb('overspeed', 'N1 overspeed', 'Requires primary N1 speed input.', s.overspeed !== false)}
    ${cb('n2_overspeed', 'N2 overspeed', 'Independent hard shutdown for the free power-turbine/output shaft. Set its RPM limit in Config.', !!s.n2_overspeed)}
    ${cb('overtemp', 'Turbine gas overtemperature', 'Watches the configured TOT/TIT temperature limits.', s.overtemp !== false)}
    ${cb('low_oil', 'Low oil pressure', 'Requires oil-pressure input or low-oil switch.', s.low_oil !== false)}
    ${cb('oil_zero', 'Zero oil pressure', 'Requires oil-pressure input or zero-oil switch.', s.oil_zero !== false)}
    ${cb('flameout', 'Flameout', 'Requires flame, N1, TOT or TIT confirmation.', s.flameout !== false)}
    ${cb('hot_start', 'Pre-start hot-engine interlock', 'Blocks START when fitted TOT/TIT is already above the configured pre-start maximum.', !!s.hot_start)}
    ${cb('oil_temp_high', 'Oil temperature high', 'Requires oil-temperature input.', !!s.oil_temp_high)}
    ${cb('fuel_press_low', 'Fuel pressure low', 'Requires fuel-pressure input.', !!s.fuel_press_low)}
    ${cb('batt_low', 'Battery undervoltage', 'Requires battery-voltage input.', !!s.batt_low)}
    ${cb('surge', 'Surge / compressor instability', 'Requires N1 input.', !!s.surge)}
  </div>`;
}
function renderSafetySummary() {
  const box = document.getElementById('hardware-safety-summary');
  if (!box || !cfg) return;
  const s = cfg.safety || {};
  const rows = [
    ['overspeed', 'N1 overspeed', 'Requires primary N1 speed input', s.overspeed !== false],
    ['n2_overspeed', 'N2 overspeed', 'Hard power-turbine shaft shutdown; limit is set in Controllers', !!s.n2_overspeed],
    ['overtemp', 'Turbine gas overtemperature', 'Watches configured TOT/TIT limits', s.overtemp !== false],
    ['low_oil', 'Low oil pressure', 'Requires oil-pressure input or low-oil switch', s.low_oil !== false],
    ['oil_zero', 'Zero oil pressure', 'Requires oil-pressure input or zero-oil switch', s.oil_zero !== false],
    ['flameout', 'Flameout', 'Requires flame, N1, TOT or TIT confirmation', s.flameout !== false],
    ['hot_start', 'Pre-start hot-engine interlock', 'Requires turbine temperature input', !!s.hot_start],
    ['oil_temp_high', 'Oil temperature high', 'Requires oil-temperature input', !!s.oil_temp_high],
    ['fuel_press_low', 'Fuel pressure low', 'Requires fuel-pressure input', !!s.fuel_press_low],
    ['batt_low', 'Battery undervoltage', 'Requires battery-voltage input', !!s.batt_low],
    ['surge', 'Surge / compressor instability', 'Requires N1 input', !!s.surge],
  ];
  const enabledRows = rows.filter(r => r[3]);
  const available = rows.filter(r => !r[3] && safetyAvailability(r[0]).ok).length;
  const availability = available ? `<div class="workflow-availability">${available} more available to enable from the fitted hardware.</div>` : '';
  const editing = _workflowEditOpen.has('safety');
  box.innerHTML = editing ? safetyInlineEditor() : (enabledRows.length
    ? enabledRows.map(r => workflowCard(r[1], r[2], 'Enabled')).join('') + availability
    : `<div class="registry-empty"><div>No safety interlocks enabled.${available ? ` ${available} available to enable.` : ''}</div></div>`);
}
function renderCommsIndicatorSummary() {
  const box = document.getElementById('hardware-comms-summary');
  if (!box || !cfg) return;
  const editing = _workflowEditOpen.has('comms');
  const cluster = cfg.cluster_serial || {};
  const mav = cfg.mavlink || {};
  const led = cfg.actuators?.status_led || {};
  if (cfg.platform !== 'esp32s3' && led.enabled !== false && (led.pin === undefined || led.pin === null || led.pin < 0)) {
    led.enabled = true;
    led.pin = 2;
    if (led.type === undefined) led.type = 0;
  }
  const buz = cfg.buzzer || {};
  const fixed = pcbProfile?.fixed_functions || {};
  const profileAllows = key => !pcbProfileActive() || fixed[key]?.available === true;
  const sharedProfileSerial = pcbProfileActive() &&
    fixed.cluster_serial?.connection &&
    fixed.cluster_serial.connection === fixed.mavlink?.connection;
  const statusClass = status => (status === 'Ready' || status === 'Disabled') ? 'registry-status-ok' : 'registry-status-error';
  const optionList = (values, selected) => values.map(v => `<option value="${v}"${Number(selected)===v?' selected':''}>${v}</option>`).join('');
  const card = (device, title, detail, status, installed, editor) => {
    if (!installed && !editing) return '';
    return `<div class="hw-item-card ${editing ? 'registry-card-open' : ''} ${workflowDeviceChanged(device) ? 'field-changed' : ''}">
      <div class="registry-card-summary">
        <div><strong>${escapeHtmlText(title)}</strong><div class="hw-desc">${escapeHtmlText(detail)}</div></div>
        <span class="registry-status ${statusClass(status)}">${escapeHtmlText(status)}</span>
      </div>
      ${editing ? editor : ''}
    </div>`;
  };
  const clusterStatus = cluster.enabled ? ((cluster.tx_pin ?? -1) >= 0 ? 'Ready' : 'TX pin missing') : 'Disabled';
  const mavStatus = mav.enabled ? ((mav.tx_pin ?? -1) >= 0 ? 'Ready' : 'TX pin missing') : 'Disabled';
  const ledEnabled = led.enabled !== false;
  const ledType = Number(led.type ?? (cfg.platform === 'esp32s3' ? 1 : 0));
  const ledMode = Number(led.mode ?? 0);
  const ledStatus = ledEnabled ? ((led.pin ?? -1) >= 0 ? 'Ready' : 'Pin missing') : 'Disabled';
  const buzStatus = buz.enabled ? ((buz.pin ?? -1) >= 0 ? 'Ready' : 'Pin missing') : 'Disabled';
  const cards = [
    profileAllows('cluster_serial') ? card('cluster_serial', 'OT Cluster serial',
      cluster.enabled ? `${pcbProfileActive() ? 'Fixed PCB serial connection' : `TX GPIO ${cluster.tx_pin ?? 'not set'}${(cluster.rx_pin ?? -1) >= 0 ? ` / RX GPIO ${cluster.rx_pin}` : ' / TX only'}`} / ${cluster.baud || 115200} baud` : 'External cluster telemetry link',
      clusterStatus,
      !!cluster.enabled,
      `<div class="registry-card-editor" style="display:block"><div class="hw-grid">
         ${pcbProfileActive() ? `<div class="hw-field"><span class="hw-label">Physical connection</span><span class="hw-desc">TX/RX wiring is fixed by the flashed PCB profile.${sharedProfileSerial?' The connector is shared with MAVLink.':''}</span></div>` : `<div class="hw-field"><span class="hw-label">Cluster TX GPIO</span><select class="${workflowDeviceFieldClass('cluster_serial','tx_pin')}" onchange="setNested('cluster_serial','tx_pin',+this.value);renderHardwareWorkflowSummaries()">${buildPinOptions(cluster.tx_pin, 'out')}</select></div>
         <div class="hw-field"><span class="hw-label">Cluster RX GPIO</span><span class="hw-desc">Optional. Leave unassigned for TX-only streaming.</span><select class="${workflowDeviceFieldClass('cluster_serial','rx_pin')}" onchange="setNested('cluster_serial','rx_pin',+this.value);renderHardwareWorkflowSummaries()">${buildPinOptions(cluster.rx_pin, 'in')}</select></div>`}
         <div class="hw-field"><a href="/system.html#system-device-setup">Enable the link and set its rate on System &rarr;</a></div>
      </div></div>`) : '',
    profileAllows('mavlink') ? card('mavlink', 'MAVLink telemetry',
      mav.enabled ? `${pcbProfileActive() ? 'Fixed PCB serial connection' : `TX GPIO ${mav.tx_pin ?? 'not set'}`} / ${mav.baud || 57600} baud / ${mav.interval_ms || 200} ms` : 'MAVLink telemetry output',
      mavStatus,
      !!mav.enabled,
      `<div class="registry-card-editor" style="display:block"><div class="hw-grid">
         ${pcbProfileActive() ? `<div class="hw-field"><span class="hw-label">Physical connection</span><span class="hw-desc">TX wiring is fixed by the flashed PCB profile.${sharedProfileSerial?' The connector is shared with OT Cluster.':''}</span></div>` : `<div class="hw-field"><span class="hw-label">MAVLink TX GPIO</span><select class="${workflowDeviceFieldClass('mavlink','tx_pin')}" onchange="setNested('mavlink','tx_pin',+this.value);renderHardwareWorkflowSummaries()">${buildPinOptions(mav.tx_pin, 'out')}</select></div>`}
         <div class="hw-field"><a href="/system.html#system-device-setup">Enable the link and set its rate on System &rarr;</a></div>
      </div></div>`) : '',
    profileAllows('status_led') ? card('status_led', 'Status LED',
      ledEnabled && (led.pin ?? -1) >= 0 ? `${ledType === 1 ? 'NeoPixel RGB' : 'GPIO LED'}${pcbProfileActive() ? ' / fixed PCB indicator' : ` / GPIO ${led.pin}`}` : 'Local status indicator LED',
      ledStatus,
      pcbProfileActive() || cfg.platform !== 'esp32s3' ? true : ledEnabled,
      `<div class="registry-card-editor" style="display:block"><div class="hw-grid">
         ${pcbProfileActive() ? '<div class="hw-field"><span class="hw-label">Installed indicator</span><span class="hw-desc">LED type, GPIO, polarity, and safe-off state are fixed by the flashed PCB profile.</span></div>' : `<div class="hw-field"><span class="hw-label">Status LED</span><label class="hw-toggle"><input class="${workflowDeviceFieldClass('status_led','enabled')}" type="checkbox" ${ledEnabled?'checked':''} onchange="setStatusLedEnabled(this.checked);renderHardwareWorkflowSummaries()"><span></span> Enable</label></div>
         <div class="hw-field"><span class="hw-label">LED type</span><select class="${workflowDeviceFieldClass('status_led','type')}" onchange="setStatusLedType(+this.value);renderHardwareWorkflowSummaries()"><option value="0"${ledType===0?' selected':''}>Plain GPIO on/off</option><option value="1"${ledType===1?' selected':''}>NeoPixel RGB data LED</option></select></div>
         <div class="hw-field"><span class="hw-label">Status LED GPIO</span><select class="${workflowDeviceFieldClass('status_led','pin')}" onchange="setAct('status_led','pin',+this.value);renderHardwareWorkflowSummaries()">${buildPinOptions(led.pin, 'status-led')}</select></div>`}
         ${ledType === 1 ? `<div class="hw-field"><span class="hw-label">NeoPixel mode</span><select class="${workflowDeviceFieldClass('status_led','mode')}" onchange="setStatusLedMode(+this.value);renderHardwareWorkflowSummaries()"><option value="0"${ledMode===0?' selected':''}>Blink pattern</option><option value="1"${ledMode===1?' selected':''}>State colors</option></select></div>` : ''}
         ${ledType === 1 && ledMode !== 1 ? `<div class="hw-field"><span class="hw-label">Blink color</span><input class="${workflowDeviceFieldClass('status_led','blink_color')}" type="color" value="${colorToHex(led.blink_color, '#0000ff')}" onchange="setStatusLedColor('blink_color',this.value)"></div>` : ''}
        ${ledType === 1 && ledMode === 1 ? `<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">State colors</span><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.5rem">
           <label>Standby <input class="${workflowDeviceFieldClass('status_led','standby_color')}" type="color" value="${colorToHex(led.standby_color, '#00ff40')}" onchange="setStatusLedColor('standby_color',this.value)"></label>
           <label>Startup <input class="${workflowDeviceFieldClass('status_led','startup_color')}" type="color" value="${colorToHex(led.startup_color, '#0060ff')}" onchange="setStatusLedColor('startup_color',this.value)"></label>
           <label>Running <input class="${workflowDeviceFieldClass('status_led','running_color')}" type="color" value="${colorToHex(led.running_color, '#00ff00')}" onchange="setStatusLedColor('running_color',this.value)"></label>
           <label>Shutdown <input class="${workflowDeviceFieldClass('status_led','shutdown_color')}" type="color" value="${colorToHex(led.shutdown_color, '#ff8000')}" onchange="setStatusLedColor('shutdown_color',this.value)"></label>
        </div></div>` : ''}
      </div></div>`) : '',
    profileAllows('buzzer') ? card('buzzer', 'Buzzer',
      buz.enabled ? (pcbProfileActive() ? 'Fixed PCB audible indicator' : `GPIO ${buz.pin ?? 'not set'}`) : 'Local audible indicator',
      buzStatus,
      pcbProfileActive() ? true : !!buz.enabled,
      `<div class="registry-card-editor" style="display:block"><div class="hw-grid">
         ${pcbProfileActive() ? '<div class="hw-field"><span class="hw-label">Installed indicator</span><span class="hw-desc">Buzzer GPIO and safe-off state are fixed by the flashed PCB profile.</span></div>' : `<div class="hw-field"><span class="hw-label">Buzzer</span><label class="hw-toggle"><input class="${workflowDeviceFieldClass('buzzer','enabled')}" type="checkbox" ${buz.enabled?'checked':''} onchange="setBuzzerEnabled(this.checked);renderHardwareWorkflowSummaries()"><span></span> Enable</label></div>
         <div class="hw-field"><span class="hw-label">Buzzer GPIO</span><select class="${workflowDeviceFieldClass('buzzer','pin')}" onchange="setNested('buzzer','pin',+this.value);refreshAllPins();renderHardwareWorkflowSummaries()">${buildPinOptions(buz.pin, 'out')}</select></div>`}
      </div></div>`) : ''
  ].filter(Boolean).join('');
  box.innerHTML = cards || '<div class="registry-empty"><div>No communication or indicator devices installed.</div></div>';
}
function renderHardwareWorkflowSummaries() {
  updateWorkflowEditButtons();
  renderBuiltinInputSummary();
  renderHardwareBoardSummary();
  renderBusSummary();
  renderCommsIndicatorSummary();
  renderControllerSummary();
  renderSafetySummary();
  applyContextTooltips(document);
}
function registryContextLinks(direction, c) {
  const purpose = registryDerivedPurpose(direction, c);
  const links = [];
  const add = (href, label) => {
    if (!links.some(link => link.href === href)) links.push({href, label});
  };
  if (direction === 'input') {
    const configTargets = {
      n1_speed:['/controllers.html#cf-rpm_limit','Set N1 protection'],
      n2_speed:['/controllers.html#cf-n2_rpm_limit','Set N2 protection'],
      tot:['/controllers.html#cf-tot_limit','Set TOT protection'],
      tit:['/controllers.html#cf-sf_tit','Set TIT protection'],
      oil_pressure:['/controllers.html#cf-oil_rm','Set oil protection'],
      low_oil_switch:['/controllers.html#cf-oil_rm','Set low-oil protection'],
      oil_zero_switch:['/controllers.html#cf-oil_zb','Set no-pressure protection'],
      p1_pressure:['/controllers.html#cf-sf_p1t','Set P1 protection'],
      p2_pressure:['/controllers.html#cf-sf_p2t','Set P2 protection'],
      oil_temperature:['/controllers.html#cf-sf_ot','Set oil-temperature protection'],
      fuel_pressure:['/controllers.html#cf-sf_fp','Set fuel-pressure protection'],
      battery_voltage:['/controllers.html#cf-sf_bv','Set undervoltage protection'],
      flame:['/controllers.html#cf-sf_fs','Set combustion-loss detection'],
      ab_flame:['/controllers.html#cf-ab_fm','Set AB flame confirmation'],
      torque:['/controllers.html#cf-sf_tqt','Set torque protection'],
      ab_command:['/controllers.html#cf-ab_pcm','Set AB command behavior'],
      limp_mode:['/controllers.html#cf-lm_mt','Set reduced-power limit']
    };
    const calibrationTargets = {
      oil_pressure:'oil-press-cal-row', p1_pressure:'p1-cal-row',
      p2_pressure:'p2-cal-row', oil_temperature:'oiltemp-cal-row',
      fuel_pressure:'fuelpress-cal-row', battery_voltage:'battvolt-cal-row',
      flame:'flame-cal-row', ab_flame:'ab-flame-cal-row',
      torque:'torque-cal-row', thrust:'thrust-cal-row',
      throttle:'throttle-cal-row', idle:'idle-cal-row'
    };
    if (configTargets[purpose]) add(...configTargets[purpose]);
    if (calibrationTargets[purpose]) add(`/calibration.html#${calibrationTargets[purpose]}`, 'Open its calibration');
    if (purpose === 'fuel_flow' && Number(c.driver) === 1) add('/calibration.html#fuelflow-cal-row', 'Calibrate fuel flow');
    if ((purpose === 'throttle' || purpose === 'idle') && Number(c.driver) === 3) {
      add('/controllers.html#cf-rc_fs', 'Set RC signal-loss timeout');
    }
    if (purpose === 'sequence_gate') add('/sequence.html#tab-startup', 'Open startup sequence');
    if (purpose === 'ab_arm' || purpose === 'ab_fire') {
      add('/controllers.html#cf-ab_mn', 'Set AB ignition conditions');
      add('/sequence.html#tab-afterburner', 'Open AB sequence');
    }
  } else {
    if (purpose === 'main_fuel') {
      add('/controllers.html#cf-th_ru', 'Set fuel response');
      add('/calibration.html#fuelpump-min-cal-row', 'Calibrate minimum fuel command');
    } else if (purpose === 'starter' || purpose === 'starter_enable' || purpose === 'air_starter') {
      add('/controllers.html#cf-sa_en', 'Set starter assist');
      add('/sequence.html#tab-startup', 'Open startup sequence');
    } else if (purpose === 'oil_pump') {
      add('/controllers.html#cf-oil_mm', 'Set oil-pressure control');
      add('/controllers.html#cf-so_rl', 'Set windmilling oil protection');
      add('/sequence.html#tab-startup', 'Open startup oil steps');
    } else if (purpose === 'scavenge_pump') {
      add('/controllers.html#cf-oil_ufd', 'Set flow-fault behavior');
      add('/sequence.html#tab-shutdown', 'Open shutdown sequence');
    } else if (purpose === 'igniter') {
      add('/controllers.html#cf-rl_it', 'Set relight behavior');
      add('/sequence.html#tab-startup', 'Open ignition sequence');
    } else if (purpose === 'glow_plug') {
      add('/controllers.html#cf-gl_ms', 'Set glow preheat');
      add('/sequence.html#tab-startup', 'Place the preheat block');
    } else if (purpose === 'ab_igniter') {
      add('/controllers.html#cf-ab_ui', 'Set AB ignition method');
      add('/sequence.html#tab-afterburner', 'Open AB sequence');
    } else if (purpose === 'ab_pump' || purpose === 'ab_valve') {
      add('/controllers.html#cf-ab_lpp', 'Set AB fuel behavior');
      add('/sequence.html#tab-afterburner', 'Open AB sequence');
    } else if (purpose === 'prop_pitch' || purpose === 'nozzle_actuator') {
      add('/controllers.html#cf-gv_tr', 'Set N2 governor target');
    } else if (['fuel_shutoff','pilot_fuel','purge_valve'].includes(purpose)) {
      add('/sequence.html#tab-startup', 'Open startup sequence');
    } else if (purpose === 'drain_valve') {
      add('/sequence.html#tab-shutdown', 'Open shutdown sequence');
    }
  }
  if (!links.length) return '';
  return `<div class="context-links"><strong>Continue setup:</strong>${links.map(link =>
    `<a href="${link.href}">${escapeHtmlText(link.label)} &rarr;</a>`).join('')}</div>`;
}
function renderRegistryInventory() {
  const r = registryRoot();
  const render = (direction, target) => {
    const rows = r[direction + 's'];
    let visibleRows = rows.map((c, i) => ({c, i})).filter(({c}) => {
      if (direction !== 'input') return true;
      const purpose = registryDerivedPurpose('input', c);
      if (!['oil_flow','scavenge_flow'].includes(purpose)) return true;
      const ownerPurpose = purpose === 'oil_flow' ? 'oil_pump' : 'scavenge_pump';
      return !(r.outputs || []).some(output => registryDerivedPurpose('output', output) === ownerPurpose);
    });
    if (direction === 'output') {
      // Keep each physical mirror visually attached to the command source
      // without changing registry indices used by controllers and sequences.
      const ordered = [];
      const placed = new Set();
      visibleRows.filter(({c}) => !String(c?.mirror_of || '')).forEach(source => {
        ordered.push(source);
        placed.add(source.i);
        visibleRows.filter(({c}) => String(c?.mirror_of || '') === String(source.c?.id || ''))
          .forEach(mirror => { ordered.push(mirror); placed.add(mirror.i); });
      });
      visibleRows.forEach(row => { if (!placed.has(row.i)) ordered.push(row); });
      visibleRows = ordered;
    }
    document.getElementById(target).innerHTML =
      (visibleRows.length ? visibleRows.map(({c, i}) => {
        const open = _registryEditOpen.has(registryEditKey(direction, i));
        const status = registryStatus(c);
        const fixedProfileFunction = registryFixedProfileFunction(direction,c);
        const proportional = direction === 'output' && (Number(c.driver) === 5 || Number(c.driver) === 6);
        const cardClass = [
          'hw-item-card',
          'registry-card',
          open ? 'registry-card-open' : '',
          registryChannelChanged(direction, i) ? 'field-changed' : '',
          status.kind === 'error' ? 'field-error-card' : ''
        ].filter(Boolean).join(' ');
        const nameClass = registryFieldChangedClass(direction, i, 'name');
        const purposeClass = registryFieldChangedClass(direction, i, 'purpose');
        const driverClass = registryFieldChangedClass(direction, i, 'driver');
        const pinClass = `${registryFieldChangedClass(direction, i, 'pin')}${(c.pin ?? -1) < 0 ? ' field-error' : ''}`;
        const displayName = registryDisplayName(direction, c, direction === 'input' ? `Input ${i+1}` : `Output ${i+1}`);
        const mirrorSource = direction === 'output' && c.mirror_of
          ? (registryRoot().outputs || []).find(row => String(row?.id || '') === String(c.mirror_of || '')) : null;
        return `<div class="${cardClass}" data-registry-direction="${direction}" data-registry-id="${escapeHtmlText(c.id || '')}" style="margin:.3rem 0" title="${status.kind === 'error' ? escapeHtmlText(status.text) : ''}">
        <div class="registry-card-summary">
          <div>
            <strong>${escapeHtmlText(displayName)}</strong>${mirrorSource ? ' <span class="registry-mirror-label">Mirrored output</span>' : ''}
            <div class="hw-desc">${escapeHtmlText(registryPurposeLabel(direction, c))} &middot; ${escapeHtmlText(registrySignalSummary(c))} &middot; ${escapeHtmlText(registryPinSummary(c))}${direction==='output' ? ' &middot; '+escapeHtmlText(registryOutputSummary(c)) : ''}</div>
            ${registryDerivedPurpose(direction,c)==='generic' ? `<div class="hw-desc">Normalized 0.00–1.00 · Sequencer and rules only</div>` : ''}
            <div class="hw-desc">${escapeHtmlText(registryReferenceSummary(direction, c.id))}</div>
            ${mirrorSource ? `<div class="hw-desc"><strong>Mirrored output of ${escapeHtmlText(registryDisplayName('output', mirrorSource, mirrorSource.id))}.</strong> It follows the source command; signal type, polarity, endpoints and protection remain specific to this physical output.</div>` : ''}
            ${direction === 'output' && registryCoreActuatorKey(c) && !registryOutputOwnsCorePurpose(c) && !mirrorSource
              ? `<div class="hw-desc"><strong>Independent command:</strong> this output is not driven by the built-in ${escapeHtmlText(registryPurposeLabel(direction, c))} command. Assign it to a controller, sequence action, or rule, or remove it and use Add mirrored output on the primary card.</div>` : ''}
          </div>
          <div class="registry-card-actions">
            <span class="registry-status registry-status-${status.kind}">${escapeHtmlText(status.text)}</span>
            ${fixedProfileFunction ? '' : `<button type="button" onclick="toggleRegistryEdit('${direction}',${i})">${open ? 'Done' : 'Edit'}</button>
             ${direction === 'output' ? `<button type="button" title="Add another physical output that follows this output's command. Its pin, driver, polarity, endpoints and protection are configured separately." onclick="duplicateRegistryChannel(${i})">Add mirrored output</button>` : ''}
             <button type="button" class="danger remove-action" onclick="removeRegistryChannel('${direction}',${i})">Remove</button>`}
          </div>
        </div>
        <div class="registry-card-editor" style="${open ? '' : 'display:none'}">
        ${mirrorSource ? `<div class="hw-item-card registry-subcard" style="margin:0 0 .6rem"><div class="registry-card-summary"><div><strong>Mirrored command</strong><div class="hw-desc">This physical output follows ${escapeHtmlText(registryDisplayName('output', mirrorSource, mirrorSource.id))}. Use an independent output instead when it needs its own controller or sequence command.</div></div><button type="button" onclick="makeRegistryOutputIndependent(${i})">Make independent</button></div></div>` : ''}
        <div class="hw-grid">
           <div class="hw-field"><span class="hw-label">Display name</span><span class="hw-desc">Plain name shown on Dashboard, Sequence and Tools. Example: Oil pump, Idle input, Flame sensor.</span><input class="${nameClass}" type="text" maxlength="23" value="${escapeHtmlText(displayName)}" oninput="updateRegistryChannel('${direction}',${i},'name',this.value)"></div>
           <div class="hw-field"><span class="hw-label">Purpose</span><span class="hw-desc">${pcbProfileActive() ? 'What this compatible connector does in the ECU. Only uses supported by its electrical mode are offered.' : 'What this channel does in the ECU. This controls which safety, controller, sequence and rule options can use it.'}</span><select class="${purposeClass}" onchange="updateRegistryChannel('${direction}',${i},'purpose',this.value)">${registryPurposeOptions(direction, registryDerivedPurpose(direction,c), c)}</select></div>
           ${registryProfilePortEditor(direction,c,i)}
           ${pcbProfileActive() ? '' : registrySignalTypeEditor(direction, c, i, driverClass)}
           ${pcbProfileActive() ? '' : registryI2cEditor(direction, c, i)}
           ${pcbProfileActive() ? '' : (direction==='input' ? registryTemperatureInterfaceEditor(c, i) : '')}
           ${pcbProfileActive() ? '' : registryTorqueInterfaceEditor(direction, c, i)}
           ${(!pcbProfileActive() || !c.physical_port) && Number(c.driver)<8 && !(direction==='input' && registryTemperatureIsSpi(c)) ? `<div class="hw-field"><span class="hw-label">${direction==='input' ? registryInputPinLabel(c) : 'GPIO pin'}</span><select class="${pinClass}" onchange="updateRegistryChannel('${direction}',${i},'pin',+this.value)">${buildPinOptions(c.pin, registryTorqueIsHx711(c) || Number(c.temp_interface||0)===5 ? 'in' : registryPinMode(direction, c.driver))}</select>${pcbProfileActive()?'<span class="hw-desc">Only unreserved ESP32 pins are offered. PCB-labelled connections are preferred when suitable.</span>':''}</div>` : ''}
           ${pcbProfileActive() ? '' : registryInputOptionsEditor(direction, c, i)}
           ${registryProfileInputTuningEditor(direction, c, i)}
           ${pcbProfileActive() ? '' : registryInvertEditor(direction, c, i)}
          ${registryPulseScaleEditor(direction, c, i)}
          ${registryAnalogScaleEditor(direction, c, i)}
          ${registryAnalogCurveEditor(direction, c, i)}
           ${!(direction==='input' && registryTemperatureIsSpi(c)) ? registryRangeEditor(direction, c, i) : ''}
           ${registryOutputSubcards(direction, c, i)}
           ${direction==='output' ? `<details style="grid-column:1/-1"><summary>Advanced output settings</summary><div class="hw-grid" style="margin-top:.65rem">${registryPwmTimingEditor(c, i)}${pcbProfileActive()?'':registryDemandEditor(c, i)}${registryFaultSafeEditor(c, i)}</div></details>` : ''}
           ${registryContextLinks(direction, c)}
        </div>
        </div>
      </div>`;
      }).join('') : `<div class="registry-empty"><div>No installed ${direction} channels.</div></div>`);
  };
  render('input', 'registry-inputs'); render('output', 'registry-outputs'); renderRegistryBindings(); renderHardwareWorkflowSummaries();
}
