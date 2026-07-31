// ------ Save ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Control rules are edited here because they alter sequence-time actuator behavior.
const RULE_SENSORS = [
  {v:0,l:'Oil Temp',u:'deg C',id:'oil_temp',ok:()=>sensorEnabled('oil_temp')},
  {v:1,l:'TOT',u:'deg C',id:'tot_main',ok:()=>sensorEnabled('tot')},
  {v:2,l:'N1 RPM',u:'RPM',id:'n1_main',ok:()=>sensorEnabled('n1_rpm')},
  {v:3,l:'Oil Pressure',u:'bar',id:'oil_pressure_main',ok:()=>sensorEnabled('oil_press')},
  {v:4,l:'TIT',u:'deg C',id:'tit_main',ok:()=>sensorEnabled('tit')},
  {v:5,l:'Battery V',u:'V',id:'batt_voltage',ok:()=>sensorEnabled('batt_voltage')},
  {v:6,l:'N2 RPM',u:'RPM',id:'n2_main',ok:()=>sensorEnabled('n2_rpm')},
  {v:7,l:'DI Channel 1',u:'0/1',id:'di0',ok:()=>((hwCfg.di_channels?.[0]?.pin ?? -1) >= 0)},
  {v:8,l:'DI Channel 2',u:'0/1',id:'di1',ok:()=>((hwCfg.di_channels?.[1]?.pin ?? -1) >= 0)},
  {v:9,l:'DI Channel 3',u:'0/1',id:'di2',ok:()=>((hwCfg.di_channels?.[2]?.pin ?? -1) >= 0)},
  {v:10,l:'DI Channel 4',u:'0/1',id:'di3',ok:()=>((hwCfg.di_channels?.[3]?.pin ?? -1) >= 0)},
  {v:11,l:'Fuel Pressure',u:'bar',id:'fuel_press',ok:()=>sensorEnabled('fuel_press')},
  {v:12,l:'Fuel Flow',u:'',id:'fuel_flow',ok:()=>sensorEnabled('fuel_flow')},
  {v:13,get l(){return registryLabel(registryInputPurpose('p1_pressure'), 'Pressure 1')},u:'bar',id:'p1',ok:()=>sensorEnabled('p1')},
  {v:14,get l(){return registryLabel(registryInputPurpose('p2_pressure'), 'Pressure 2')},u:'bar',id:'p2',ok:()=>sensorEnabled('p2')},
  {v:15,l:'Torque',u:'',id:'torque',ok:()=>sensorEnabled('torque')},
  {v:16,l:'Flame Detected',u:'0/1',id:'flame',ok:()=>sensorEnabled('flame')},
  {v:17,l:'Throttle Input',u:'%',id:'operator_throttle',ok:()=>sensorEnabled('throttle_input')},
  {v:18,l:'Idle Input',u:'%',id:'operator_idle',ok:()=>sensorEnabled('idle_input')},
  {v:19,l:'AB Flame',u:'0/1',id:'ab_flame',ok:()=>sensorEnabled('ab_flame')},
  {v:20,l:'Glow Current',u:'A',id:'glow_current',ok:()=>actuatorEnabled('glow_plug') && !!hwCfg.actuators?.glow_plug?.has_current},
  {v:21,l:'Igniter 1 Current',u:'A',id:'igniter_current',ok:()=>actuatorEnabled('igniter') && !!hwCfg.actuators?.igniter?.has_current},
  {v:22,l:'AB / Pilot Igniter Current',u:'A',id:'igniter2_current',ok:()=>actuatorEnabled('igniter2') && !!hwCfg.actuators?.igniter2?.has_current},
  {v:23,l:'Oil Pump Current',u:'A',id:'oil_pump_current',ok:()=>actuatorEnabled('oil_pump') && !!hwCfg.actuators?.oil_pump?.has_current},
  {v:24,l:'AB Input',u:'%',id:'ab_input',ok:()=>!!((hwCfg.ab_trigger?.input_pin ?? -1) >= 0)},
  {v:25,l:'Start Switch',u:'0/1',id:'start_switch',ok:()=>((hwCfg.controls?.start_pin ?? -1) >= 0)},
  {v:26,l:'Stop Switch',u:'0/1',id:'stop_switch',ok:()=>((hwCfg.controls?.stop_pin ?? -1) >= 0)},
  {v:27,l:'Thrust',u:'N',id:'thrust',ok:()=>!!registryInputPurpose('thrust')}
];
const RULE_OPS = [
  {v:0,l:'Goes above'},
  {v:1,l:'Goes below'}
];
const RULE_OUTPUTS = [
  {v:0,l:'Cooling Fan',id:'cooling_fan_main',ok:()=>actuatorEnabled('cool_fan')},
  {v:1,l:'Bleed Valve',id:'bleed_valve_main',ok:()=>actuatorEnabled('bleed_valve')},
  {v:2,l:'Pilot / Auxiliary Fuel Pump',id:'fuel_pump',ok:()=>actuatorEnabled('fuel_pump2')},
  {v:3,l:'Oil Scavenge Pump',id:'oil_scavenge_main',ok:()=>actuatorEnabled('oil_scavenge_pump')},
  {v:4,l:'Throttle Demand',id:'main_fuel',ok:()=>actuatorEnabled('throttle')},
  {v:5,l:'Starter Demand',id:'starter_main',ok:()=>actuatorEnabled('starter')},
  {v:7,l:'Oil Pump Demand',id:'oil_pump_main',ok:()=>actuatorEnabled('oil_pump')},
  {v:8,l:'Main Fuel Shutoff',id:'fuel_shutoff',ok:()=>actuatorEnabled('fuel_sol')},
  {v:9,l:'Igniter',id:'igniter',ok:()=>actuatorEnabled('igniter')},
  {v:10,l:'AB / Pilot Igniter',id:'ab_igniter',ok:()=>actuatorEnabled('igniter2')},
  {v:11,l:'Afterburner Fuel Valve',id:'ab_solenoid',ok:()=>actuatorEnabled('ab_sol')},
  {v:12,l:'Afterburner Fuel Pump',id:'ab_pump',ok:()=>actuatorEnabled('ab_pump')},
  {v:13,l:'Request Shutdown',id:'request_shutdown',ok:()=>true},
  {v:14,l:'Fault + Shutdown',id:'request_fault',ok:()=>true},
  {v:15,l:'Air Starter Valve',id:'air_starter',ok:()=>actuatorEnabled('airstarter_sol')},
  {v:16,l:'Glow Plug',id:'glow_plug',ok:()=>actuatorEnabled('glow_plug')},
  {v:17,l:'Prop Pitch',id:'prop_pitch',ok:()=>actuatorEnabled('prop_pitch')}
];
const RULE_PRESETS = [
  {kind:'oil_temp_fan', label:'Cooling fan from oil temperature', desc:'Simple on/off example: run the configured cooling fan above an oil-temperature threshold.'},
  {kind:'adc_pwm_dimmer', label:'ADC to PWM dimmer example', desc:'Map a fitted generic analog input to a fitted generic PWM output, for example to dim a warning lamp.'}
];
const RULE_REGISTRY_INPUT_BASE = 80;
const RULE_REGISTRY_OUTPUT_BASE = 64;
const RULE_CORE_INPUT_IDS = new Set([
  'n1_main','primary_n1','n2_main','primary_n2','tot_main','primary_egt',
  'oil_pressure_main','operator_throttle','operator_idle','idle_input','idle_input_main',
  'battery_voltage','batt_voltage','batt_voltage_main'
]);
const RULE_CORE_OUTPUT_IDS = new Set([
  'main_fuel_output','main_fuel','throttle',
  'main_starter','starter','starter_main',
  'starter_enable','starter_enable_main',
  'oil_pump','oil_pump_main',
  'cooling_fan','cooling_fan_main','cool_fan',
  'oil_scavenge_main','oil_scavenge_pump','scavenge_pump',
  'bleed_valve','bleed_valve_main',
  'igniter','igniter_main','ab_igniter','igniter2','igniter2_main',
  'main_fuel_shutoff','fuel_shutoff','fuel_sol','fuel_solenoid_main',
  'ab_solenoid','ab_solenoid_main','ab_sol',
  'air_starter','airstarter_main','airstarter_sol',
  'fuel_pump','fuel_pump2','fuel_pump2_main',
  'ab_pump','ab_pump_main','prop_pitch','prop_pitch_main','glow_plug','glow_plug_main'
]);
const RULE_CORE_OUTPUT_BINDINGS = new Set(['main_fuel_output','main_fuel_shutoff','main_starter']);
function plainRegistryName(raw, fallback = '') {
  const text = String(raw || '').trim();
  const key = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const direct = {
    user_throttle:'Throttle Input', operator_throttle:'Throttle Input', operator_thrott:'Throttle Input', throttle_input:'Throttle Input',
    user_idle:'Idle Input', operator_idle:'Idle Input', idle_input:'Idle Input',
    oil_pump:'Oil Pump', oil_pump_main:'Oil Pump', fuel_pump:'Pilot / Auxiliary Fuel Pump', main_fuel:'Main Fuel Pump',
    flame:'Flame Sensor', flame_main:'Flame Sensor', coolant_pump:'Coolant Pump',
    coolant_temperature:'Coolant Temperature', pilot_fuel:'Pilot Gas', purge_valve:'Purge Valve',
    air_starter:'Air Starter', prop_pitch:'Prop Pitch', nozzle_actuator:'Nozzle Actuator'
  };
  if (direct[key]) return direct[key];
  if (key.includes('throttle') || key.includes('thrott')) return 'Throttle Input';
  if (key.includes('idle')) return 'Idle Input';
  if (key.includes('flame')) return 'Flame Sensor';
  if (key.includes('oil') && key.includes('pump')) return 'Oil Pump';
  if (key.includes('fuel') && key.includes('pump')) return 'Fuel Pump';
  const out = key.split('_').filter(Boolean).map(part => {
    const upper = {n1:'N1', n2:'N2', tot:'TOT', tit:'TIT', egt:'EGT', ab:'AB', rc:'RC', pwm:'PWM', adc:'ADC', esc:'ESC', gpio:'GPIO', rpm:'RPM'};
    return upper[part] || part.charAt(0).toUpperCase() + part.slice(1);
  }).join(' ');
  return out || fallback;
}

function validateSequenceHardwareForSave() {
  const errors = [];
  const tabs = [
    ['Startup', 'startup'],
    ['Shutdown', 'shutdown'],
    ['Afterburner', 'afterburner'],
    ['Afterburner shutdown', 'ab-shut']
  ];
  tabs.forEach(([tabLabel, tab]) => {
    (hwCfg[seqKey(tab)] || []).forEach((bname, index) => {
      const def = BLOCKS[bname] || customBlocks[bname];
      if (!def) {
        errors.push(`${tabLabel} block ${index + 1} (${bname}) is unknown to this firmware.`);
      } else if (def.visibleIf && !def.visibleIf(hwCfg)) {
        errors.push(`${tabLabel} block ${index + 1} (${def.label || bname}) cannot run with the fitted hardware.`);
      }
    });
  });
  return errors;
}
function registryChannelLabel(c, fallback) {
  const name = (c?.name && c.name.trim()) || c?.id || fallback;
  return String(name || '').includes('_') ? plainRegistryName(name, fallback) : name;
}
function registryRuleUnit(c) {
  if (!c) return '';
  if (c.driver === 0 || c.role === 'digital_switch' || c.role === 'fault' ||
      c.role === 'estop' || c.role === 'inhibit_start' || c.role === 'sequence_gate' ||
      c.role === 'ab_arm' || c.role === 'ab_fire' || c.role === 'limp_mode' || c.role === 'flame') return '0/1';
  if (c.role === 'speed') return 'RPM';
  if (c.role === 'pressure') return 'bar';
  if (c.role === 'temperature') return 'deg C';
  if (c.role === 'voltage') return 'V';
  if (c.role === 'flow') return 'L/min';
  if (c.role === 'torque') return 'Nm';
  if (c.role === 'thrust') return 'N';
  if (c.role === 'operator') return '%';
  if (c.role === 'generic') return '%';
  return '';
}
function registryInputCoreBound(c) {
  return RULE_CORE_INPUT_IDS.has(String(c?.id || ''));
}
function registryRuleSensors() {
  const inputs = hwCfg.channel_registry?.inputs || [];
  const visible = inputs.map((c, i) => ({c, i})).filter(({c}) =>
    c?.installed !== false && (c?.pin ?? -1) >= 0 && !registryInputCoreBound(c));
  return visible.map(({c, i}) => ({
    v: RULE_REGISTRY_INPUT_BASE + i,
    id: c.id,
    l: registryChannelLabel(c, `Input ${i + 1}`),
    u: registryRuleUnit(c),
    ok: () => c?.installed !== false && (c?.pin ?? -1) >= 0
  }));
}
function registryOutputCoreBound(c) {
  if (!c?.id) return false;
  const id = String(c.id || '');
  if (RULE_CORE_OUTPUT_IDS.has(id)) return true;
  return (hwCfg.channel_registry?.bindings || []).some(b => RULE_CORE_OUTPUT_BINDINGS.has(String(b?.key || '')) && String(b?.channel || '') === id);
}
function registryRuleOutputs() {
  const outputs = hwCfg.channel_registry?.outputs || [];
  return outputs.map((c, i) => ({
    v: RULE_REGISTRY_OUTPUT_BASE + i,
    id: c.id,
    driver: c.driver,
    l: `${registryChannelLabel(c, `Output ${i + 1}`)} (custom output)`,
    ok: () => c?.installed !== false && (c?.pin ?? -1) >= 0 && !registryOutputCoreBound(c)
  }));
}
function ruleSensors() { return RULE_SENSORS.concat(registryRuleSensors()); }
function ruleOutputs() { return RULE_OUTPUTS.concat(registryRuleOutputs()); }
function ruleEsc(value) {
  return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function ruleOption(item, selected, selectedId = '', allowed = true) {
  const available = item.ok() && allowed;
  const isSelected = (selectedId && item.id === selectedId) || (!selectedId && item.v === selected);
  const idAttr = item.id ? ` data-id="${ruleEsc(item.id)}"` : '';
  const hidden = !available && !isSelected ? ' hidden style="display:none"' : '';
  return `<option value="${item.v}"${idAttr}${isSelected ? ' selected' : ''}${available ? '' : ' disabled'}${hidden}>${ruleEsc(item.l)}${available ? '' : ' (not configured)'}</option>`;
}
function missingRuleOption(id, selected, label = 'Missing') {
  return `<option value="${selected}" data-id="${ruleEsc(id)}" selected disabled>${ruleEsc(label)}: ${ruleEsc(id)}</option>`;
}
function ruleUnit(index) { return ruleSensors().find(s => s.v === index)?.u || ''; }
function ruleSensorScale(index) { return ruleUnit(index) === '%' ? 100 : 1; }
function ruleDisplaySensorValue(sensor, value) {
  const scale = ruleSensorScale(sensor);
  const v = Number(value ?? 0) * scale;
  return Number.isFinite(v) ? +v.toFixed(scale === 100 ? 1 : 3) : 0;
}
function ruleSensorValueToStored(sensor, displayValue) {
  const scale = ruleSensorScale(sensor);
  const v = Number(displayValue) || 0;
  return scale === 100 ? Math.max(0, Math.min(100, v)) / 100 : v;
}
function ruleDisplayThreshold(rule) {
  const scale = ruleSensorScale(rule.sensor);
  const v = Number(rule.threshold ?? 0) * scale;
  return Number.isFinite(v) ? +v.toFixed(scale === 100 ? 1 : 3) : 0;
}
function ruleThresholdToStored(sensor, displayValue) { return ruleSensorValueToStored(sensor, displayValue); }
function ruleDisplayHysteresis(rule) {
  const scale = ruleSensorScale(rule.sensor);
  const v = Number(rule.hysteresis ?? 0) * scale;
  return Number.isFinite(v) ? +v.toFixed(scale === 100 ? 1 : 3) : 0;
}
function ruleHysteresisToStored(sensor, displayValue) {
  const scale = ruleSensorScale(sensor);
  const v = Math.max(0, Number(displayValue) || 0);
  return scale === 100 ? Math.min(100, v) / 100 : v;
}
const RULE_ANALOG_ACTUATOR_KEYS = {
  2:'fuel_pump2',
  4:'throttle',
  5:'starter',
  7:'oil_pump',
  12:'ab_pump',
  17:'prop_pitch'
};
function ruleOutputIsAnalog(actuator) {
  const act = +actuator;
  if (act >= RULE_REGISTRY_OUTPUT_BASE) {
    const reg = ruleOutputs().find(o => o.v === act);
    return reg?.driver === 5 || reg?.driver === 6;
  }
  if (act === 16) return !actuatorIsRelay('glow_plug');
  const key = RULE_ANALOG_ACTUATOR_KEYS[act];
  if (!key) return false;
  return Number(hwCfg.actuators?.[key]?.type ?? 0) !== 2;
}
function ruleDisplayOutput(actuator, value) {
  const v = Number(value ?? 0);
  return ruleOutputIsAnalog(actuator) ? +(v * 100).toFixed(1) : (v >= 0.5 ? 1 : 0);
}
function ruleOutputText(actuator, value) {
  return ruleOutputIsAnalog(actuator)
    ? String(ruleDisplayOutput(actuator, value))
    : (Number(value ?? 0) >= 0.5 ? 'On' : 'Off');
}
function ruleOutputEditor(id, actuator, value, index) {
  if (ruleOutputIsAnalog(actuator)) {
    return `<div class="automation-unit-input"><input id="${id}" type="number" value="${ruleDisplayOutput(actuator, value)}" min="0" max="100" step="1" oninput="markRulesEdited(${index})"><span class="automation-unit">%</span></div>`;
  }
  const on = Number(value ?? 0) >= 0.5;
  return `<select id="${id}" onchange="markRulesEdited(${index})"><option value="1"${on ? ' selected' : ''}>On</option><option value="0"${on ? '' : ' selected'}>Off</option></select>`;
}
function ruleOutputToStored(actuator, value) {
  const v = Number(value) || 0;
  return ruleOutputIsAnalog(actuator) ? Math.max(0, Math.min(100, v)) / 100 : (v >= 0.5 ? 1 : 0);
}
function updateRuleAndRender(index) {
  collectRules();
  renderRules(index);
  markRulesEdited(index);
}
function changeRuleSource(index) {
  collectRules();
  const rule = cfg.rules?.[index];
  if (!rule) return;
  rule.threshold = 0;
  rule.hysteresis = 0;
  rule.input_min = 0;
  rule.input_max = 1;
  if (ruleUnit(rule.sensor) === '0/1') {
    rule.kind = 0;
    rule.op = 0;
    rule.threshold = 0.5;
  }
  renderRules(index);
  markRulesEdited(index);
}
function changeRuleOutput(index) {
  collectRules();
  const rule = cfg.rules?.[index];
  if (!rule) return;
  rule.on_value = 1;
  rule.off_value = 0;
  rule.output_min = 0;
  rule.output_max = 1;
  renderRules(index);
  markRulesEdited(index);
}
function ruleStateSummary(mask) {
  const states = [];
  if (mask & 1) states.push('Standby');
  if (mask & 2) states.push('Starting');
  if (mask & 4) states.push('Running');
  if (mask & 8) states.push('Shutdown');
  return states.join(' + ') || 'No states';
}
function ruleSentence(rule) {
  const source = ruleSensors().find(s => (rule.source && s.id === rule.source) || (!rule.source && s.v === Number(rule.sensor)))?.l || 'Input';
  const target = ruleOutputs().find(o => (rule.target && o.id === rule.target) || (!rule.target && o.v === Number(rule.actuator)))?.l || 'Output';
  const states = ruleStateSummary(rule.mode_mask ?? 14);
  if (ruleUnit(rule.sensor) === '0/1') {
    const suffix = ruleOutputIsAnalog(rule.actuator) ? '%' : '';
    return `${source} on → ${target} ${ruleOutputText(rule.actuator, rule.on_value ?? 1)}${suffix}; off → ${ruleOutputText(rule.actuator, rule.off_value ?? 0)}${suffix} · ${states}`;
  }
  if (Number(rule.kind || 0) === 1) {
    return `${source} ${ruleDisplaySensorValue(rule.sensor, rule.input_min ?? 0)}–${ruleDisplaySensorValue(rule.sensor, rule.input_max ?? 1)} ${ruleUnit(rule.sensor)} → ${target} ${ruleDisplayOutput(rule.actuator, rule.output_min ?? 0)}–${ruleDisplayOutput(rule.actuator, rule.output_max ?? 1)}${ruleOutputIsAnalog(rule.actuator) ? '%' : ''} · ${states}`;
  }
  const op = Number(rule.op || 0) === 1 ? 'below' : 'above';
  return `${source} ${op} ${ruleDisplayThreshold(rule)} ${ruleUnit(rule.sensor)} → ${target} ${ruleOutputText(rule.actuator, rule.on_value ?? 1)}${ruleOutputIsAnalog(rule.actuator) ? '%' : ''} · ${states}`;
}
function buildRuleRow(rule, index, forceOpen = false) {
  const binary = ruleUnit(rule.sensor) === '0/1';
  const pctSensor = ruleUnit(rule.sensor) === '%';
  const analogOut = ruleOutputIsAnalog(rule.actuator);
  const isMap = !binary && Number(rule.kind || 0) === 1;
  const sourceId = rule.source || '';
  const targetId = rule.target || '';
  let sensors = ruleSensors().map(s => ruleOption(s, rule.sensor, sourceId)).join('');
  let outputs = ruleOutputs().map(a => ruleOption(a, rule.actuator, targetId, !isMap || ruleOutputIsAnalog(a.v))).join('');
  if (sourceId && !ruleSensors().some(s => s.id === sourceId)) sensors += missingRuleOption(sourceId, rule.sensor);
  if (targetId && !ruleOutputs().some(a => a.id === targetId)) outputs += missingRuleOption(targetId, rule.actuator);
  if (!sourceId && !ruleSensors().some(s => s.v === Number(rule.sensor))) sensors += missingRuleOption('sensor ' + rule.sensor, rule.sensor, 'Unavailable');
  if (!targetId && !ruleOutputs().some(a => a.v === Number(rule.actuator))) outputs += missingRuleOption('output ' + rule.actuator, rule.actuator, 'Unavailable');
  const ops = RULE_OPS.map(o => `<option value="${o.v}"${o.v === rule.op ? ' selected' : ''}>${o.l}</option>`).join('');
  const modeMask = rule.mode_mask ?? 14;
  const sourceAttrs = binary ? 'min="0" max="1" step="1"' : (pctSensor ? 'min="0" max="100" step="1"' : 'step="any"');
  const outputAttrs = `min="0" max="${analogOut ? 100 : 1}" step="1"`;
  const inputUnit = ruleUnit(rule.sensor);
  const outputUnit = analogOut ? '%' : '0/1';
  const mapFields = `<div class="automation-field"><label>Input minimum</label><div class="automation-unit-input"><input id="rule-in-min-${index}" type="number" value="${ruleDisplaySensorValue(rule.sensor, rule.input_min ?? 0)}" ${sourceAttrs} oninput="markRulesEdited(${index})"><span class="automation-unit">${inputUnit}</span></div></div>
    <div class="automation-field"><label>Input maximum</label><div class="automation-unit-input"><input id="rule-in-max-${index}" type="number" value="${ruleDisplaySensorValue(rule.sensor, rule.input_max ?? 1)}" ${sourceAttrs} oninput="markRulesEdited(${index})"><span class="automation-unit">${inputUnit}</span></div></div>
    <div class="automation-field"><label>Output at minimum</label><div class="automation-unit-input"><input id="rule-out-min-${index}" type="number" value="${ruleDisplayOutput(rule.actuator, rule.output_min ?? 0)}" ${outputAttrs} oninput="markRulesEdited(${index})"><span class="automation-unit">${outputUnit}</span></div></div>
    <div class="automation-field"><label>Output at maximum</label><div class="automation-unit-input"><input id="rule-out-max-${index}" type="number" value="${ruleDisplayOutput(rule.actuator, rule.output_max ?? 1)}" ${outputAttrs} oninput="markRulesEdited(${index})"><span class="automation-unit">${outputUnit}</span></div></div>`;
  const switchFields = binary ? `<div class="automation-field wide"><span class="automation-label">Binary input behaviour</span><div class="automation-help">The output follows the switch directly. Set the desired output for each switch state.</div><input id="rule-op-${index}" type="hidden" value="0"><input id="rule-thresh-${index}" type="hidden" value="0.5"><input id="rule-hyst-${index}" type="hidden" value="0"></div>
    <div class="automation-field"><label>Output when switch is ON</label>${ruleOutputEditor(`rule-on-${index}`, rule.actuator, rule.on_value ?? 1, index)}</div>` : `<div class="automation-field"><label>Switch when input</label><select id="rule-op-${index}" onchange="markRulesEdited(${index})">${ops}</select></div>
    <div class="automation-field"><label>Threshold</label><div class="automation-unit-input"><input id="rule-thresh-${index}" type="number" value="${ruleDisplayThreshold(rule)}" ${sourceAttrs} oninput="markRulesEdited(${index})"><span id="rule-unit-${index}" class="automation-unit">${inputUnit}</span></div></div>
    <div class="automation-field"><label>Hysteresis <span class="automation-tip" title="Prevents rapid on/off switching near the threshold. Example: with 'Goes above 100 °C' and 5 °C hysteresis, the output turns on above 100 °C and stays on until the input falls to 95 °C.">(what is this?)</span></label><div class="automation-unit-input"><input id="rule-hyst-${index}" type="number" value="${ruleDisplayHysteresis(rule)}" min="0" ${pctSensor ? 'max="100"' : ''} step="${pctSensor ? '1' : 'any'}"${binary ? ' disabled' : ''} oninput="markRulesEdited(${index})"><span id="rule-hyst-unit-${index}" class="automation-unit">${inputUnit}</span></div></div>
    <div class="automation-field"><label>Output when on</label>${ruleOutputEditor(`rule-on-${index}`, rule.actuator, rule.on_value ?? 1, index)}</div>`;
  return `<details class="automation-card" data-rule-index="${index}"${forceOpen || index === 0 ? ' open' : ''}>
    <summary><span class="automation-summary"><span id="rule-title-${index}" class="automation-title">${ruleEsc(rule.name || `Control rule ${index + 1}`)}</span><span id="rule-summary-${index}" class="automation-sentence">${ruleEsc(ruleSentence(rule))}</span></span><span class="automation-kind">${isMap ? 'Map' : 'On / Off'}</span><span class="automation-chevron">›</span></summary>
    <div class="automation-body">
      <div class="automation-topline">
        <div class="automation-field"><label for="rule-name-${index}">Rule name</label><input type="text" id="rule-name-${index}" maxlength="23" value="${ruleEsc(rule.name || '')}" placeholder="Example: Starter test" oninput="markRulesEdited(${index})"></div>
        <div class="automation-field"><label for="rule-kind-${index}">Behaviour</label><select id="rule-kind-${index}" onchange="updateRuleAndRender(${index})"${binary ? ' disabled' : ''}><option value="0"${isMap ? '' : ' selected'}>${binary ? 'Follow switch state' : 'On / Off'}</option>${binary ? '' : `<option value="1"${isMap ? ' selected' : ''}>Map input to output</option>`}</select></div>
        <label class="automation-enabled"><input type="checkbox" id="rule-en-${index}" ${rule.enabled ? 'checked' : ''} onchange="markRulesEdited(${index})"> Rule enabled</label>
      </div>
      <div class="automation-grid">
        <div class="automation-field wide"><label for="rule-sensor-${index}">Input</label><select id="rule-sensor-${index}" onchange="changeRuleSource(${index})">${sensors}</select></div>
        <div class="automation-field wide"><label for="rule-act-${index}">Output</label><select id="rule-act-${index}" onchange="changeRuleOutput(${index})">${outputs}</select></div>
        ${isMap ? mapFields : switchFields}
        <div class="automation-field"><label>${binary ? 'Output when switch is OFF' : 'Off value'}</label>${ruleOutputEditor(`rule-off-${index}`, rule.actuator, rule.off_value ?? 0, index)}</div>
        <div class="automation-field wide"><span class="automation-label">Active engine states</span><div class="automation-states"><label class="automation-state"><input id="rule-mode-standby-${index}" type="checkbox" ${(modeMask & 1) ? 'checked' : ''} onchange="markRulesEdited(${index})">Standby</label><label class="automation-state"><input id="rule-mode-startup-${index}" type="checkbox" ${(modeMask & 2) ? 'checked' : ''} onchange="markRulesEdited(${index})">Starting</label><label class="automation-state"><input id="rule-mode-running-${index}" type="checkbox" ${(modeMask & 4) ? 'checked' : ''} onchange="markRulesEdited(${index})">Running</label><label class="automation-state"><input id="rule-mode-shutdown-${index}" type="checkbox" ${(modeMask & 8) ? 'checked' : ''} onchange="markRulesEdited(${index})">Shutdown</label></div></div>
      </div>
      <div class="automation-actions"><span class="automation-help">${isMap ? 'Values between the input limits are mapped linearly. Outside them, output is clamped.' : binary ? 'The rule applies the ON or OFF output value directly from the switch state.' : 'Hysteresis prevents the output chattering near the threshold.'}</span><button class="blk-btn del" title="Remove this control rule" onclick="removeRule(${index})">Remove</button></div>
    </div>
  </details>`;
}
function resolveRuleDisplayHandles(rule) {
  if (!rule) return;
  const source = ruleSensors().find(item => item.id && item.id === String(rule.source || ''));
  const target = ruleOutputs().find(item => item.id && item.id === String(rule.target || ''));
  if (source) rule.sensor = source.v;
  if (target) rule.actuator = target.v;
}
function renderRules(forceOpen = -1) {
  const list = document.getElementById('rules-list');
  if (!list) return;
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  rules.forEach(resolveRuleDisplayHandles);
  list.innerHTML = rules.length ? rules.map((rule,index) => buildRuleRow(rule,index,index === forceOpen)).join('') :
    '<div style="padding:1rem;border:1px dashed var(--border);border-radius:10px;font-size:.78rem;color:var(--dim)">No control rules yet. Add one below or choose a ready-made example.</div>';
  document.getElementById('rules-count-label').textContent = `${rules.length} / 16 rules`;
  const addBtn = document.getElementById('btn-add-rule');
  if (addBtn) addBtn.disabled = rules.length >= 16 || !hasAvailableRuleSensor() || !hasAvailableRuleOutput();
  renderRulePresets();
  renderRuleWarnings();
}
function hasAvailableRuleSensor() { return ruleSensors().some(item => item.ok()); }
function hasAvailableRuleOutput() { return ruleOutputs().some(item => item.ok()); }
function firstAvailable(list) {
  const item = list.find(item => item.ok());
  return item ? item.v : null;
}
function firstUnclaimedRuleOutput() {
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  return ruleOutputs().find(item => {
    if (!item.ok()) return false;
    if (Number(item.v) === 13 || Number(item.v) === 14) return true;
    return !rules.some(rule => item.id
      ? String(rule.target || '') === String(item.id)
      : !rule.target && Number(rule.actuator) === Number(item.v));
  })?.v ?? null;
}
function ruleSensorAvailable(v) {
  return !!ruleSensors().find(s => Number(s.v) === Number(v))?.ok();
}
function ruleOutputAvailable(v) {
  return !!ruleOutputs().find(o => Number(o.v) === Number(v))?.ok();
}
function ruleSensorLabel(v) {
  return ruleSensors().find(s => Number(s.v) === Number(v))?.l || `sensor ${v}`;
}
function ruleOutputLabel(v) {
  return ruleOutputs().find(o => Number(o.v) === Number(v))?.l || `output ${v}`;
}
function firstGenericAnalogRuleSensor() {
  const inputs = hwCfg.channel_registry?.inputs || [];
  const index = inputs.findIndex(c => c?.installed !== false && (c?.pin ?? -1) >= 0 &&
    Number(c.driver) === 1 && c.role === 'generic' && !registryInputCoreBound(c));
  return index >= 0 ? RULE_REGISTRY_INPUT_BASE + index : undefined;
}
function firstGenericPwmRuleOutput() {
  const outputs = hwCfg.channel_registry?.outputs || [];
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const index = outputs.findIndex((c, i) => c?.installed !== false && (c?.pin ?? -1) >= 0 &&
    Number(c.driver) === 5 && c.role === 'generic' && !registryOutputCoreBound(c) &&
    !rules.some(rule => String(rule.target || '') === String(c.id || '') ||
      (!rule.target && Number(rule.actuator) === RULE_REGISTRY_OUTPUT_BASE + i)));
  return index >= 0 ? RULE_REGISTRY_OUTPUT_BASE + index : undefined;
}
function rulePresetStatus(kind) {
  const missing = [];
  if ((cfg.rules || []).length >= 16) missing.push('maximum of 16 control rules reached');
  const needSensor = v => { if (!ruleSensorAvailable(v)) missing.push(`${ruleSensorLabel(v)} input in Hardware`); };
  const needOutput = v => { if (!ruleOutputAvailable(v)) missing.push(`${ruleOutputLabel(v)} output in Hardware`); };
  if (kind === 'adc_pwm_dimmer') {
    if (firstGenericAnalogRuleSensor() === undefined) missing.push('fitted generic analog input in Hardware');
    if (firstGenericPwmRuleOutput() === undefined) missing.push('fitted generic PWM output in Hardware');
  } else if (kind === 'oil_temp_fan') {
    needSensor(0);
    needOutput(0);
  }
  return {available: missing.length === 0, missing};
}
function renderRulePresets() {
  const host = document.getElementById('rule-presets');
  if (!host) return;
  host.innerHTML = RULE_PRESETS.map(preset => {
    const status = rulePresetStatus(preset.kind);
    const title = status.available
      ? preset.desc
      : `Unavailable - missing: ${status.missing.join(', ')}`;
    const cls = status.available ? 'rule-preset-btn' : 'rule-preset-btn rule-preset-unavailable';
    const aria = status.available ? 'false' : 'true';
    return `<button type="button" class="${cls}" data-rule-preset="${ruleEsc(preset.kind)}" aria-disabled="${aria}" title="${ruleEsc(title)}" onclick="if(this.getAttribute('aria-disabled')!=='true')addRulePreset('${ruleEsc(preset.kind)}')">${ruleEsc(preset.label)}</button>`;
  }).join('');
}
function addRule() {
  collectRules();
  cfg.rules = cfg.rules || [];
  if (cfg.rules.length >= 16) return;
  const sensor = firstAvailable(ruleSensors());
  const actuator = firstUnclaimedRuleOutput();
  if (sensor === null) {
    alert('No configured sensor is available for a control rule.');
    return;
  }
  if (actuator === null) {
    alert('No configured output is available for a control rule.');
    return;
  }
  cfg.rules.push({enabled:true,name:'',kind:0,sensor,op:0,threshold:0,
                  actuator,on_value:1,off_value:0,hysteresis:0,
                  input_min:0,input_max:1,output_min:0,output_max:1,mode_mask:4});
  renderRules(cfg.rules.length - 1); markRulesEdited(cfg.rules.length - 1);
}
function addRulePreset(kind) {
  collectRules();
  cfg.rules = cfg.rules || [];
  if (cfg.rules.length >= 16) return;
  const preset = rulePresetStatus(kind);
  if (!preset.available) return;
  const add = rule => {
    cfg.rules.push(Object.assign({enabled:true,kind:0,hysteresis:0,mode_mask:4,on_value:1,off_value:0,input_min:0,input_max:1,output_min:0,output_max:1}, rule));
    renderRules(cfg.rules.length - 1); markRulesEdited(cfg.rules.length - 1);
  };
  if (kind === 'adc_pwm_dimmer') {
    const sensor = firstGenericAnalogRuleSensor();
    const actuator = firstGenericPwmRuleOutput();
    const source = ruleSensors().find(item => item.v === sensor)?.id || '';
    const target = ruleOutputs().find(item => item.v === actuator)?.id || '';
    const rule = {name:'Warning light dimmer',kind:1,sensor,source,actuator,target,on_value:1,off_value:0,
      input_min:0,input_max:1,output_min:0,output_max:1,mode_mask:14};
    return add(rule);
  }
  if (kind === 'oil_temp_fan') {
    return add({name:'Oil temp fan',sensor:0,op:0,threshold:100,actuator:0,on_value:1,off_value:0,hysteresis:5,mode_mask:6});
  }
}
async function removeRule(index) {
  collectRules();
  const name = cfg.rules?.[index]?.name || `rule ${index + 1}`;
  if (!await OTDialog.confirm(`Remove ${name}?\n\nThe rule will be deleted when you save.`, {
    title: 'Remove control rule?', confirmText: 'Remove rule', danger: true
  })) return;
  cfg.rules.splice(index, 1);
  renderRules(); markRulesEdited();
}
function collectRules() {
  const rows = document.querySelectorAll('#rules-list .automation-card');
  if (!rows.length) { cfg.rules = []; return; }
  cfg.rules = Array.from(rows).map((_, i) => {
    const sensorSel = document.getElementById('rule-sensor-' + i);
    const actSel = document.getElementById('rule-act-' + i);
    const sensor = +sensorSel.value;
    const actuator = +actSel.value;
    const source = sensorSel.selectedOptions?.[0]?.dataset?.id || '';
    const target = actSel.selectedOptions?.[0]?.dataset?.id || '';
    const kind = +(document.getElementById('rule-kind-' + i)?.value || 0);
    const standbyMode = document.getElementById('rule-mode-standby-' + i)?.checked ? 1 : 0;
    const startMode = document.getElementById('rule-mode-startup-' + i)?.checked ? 2 : 0;
    const runMode = document.getElementById('rule-mode-running-' + i)?.checked ? 4 : 0;
    const shutdownMode = document.getElementById('rule-mode-shutdown-' + i)?.checked ? 8 : 0;
    const out = {
      enabled: document.getElementById('rule-en-' + i).checked,
      name: document.getElementById('rule-name-' + i).value.substring(0, 23),
      kind: ruleUnit(sensor) === '0/1' ? 0 : kind,
      sensor,
      op: ruleUnit(sensor) === '0/1' ? 0 : +(document.getElementById('rule-op-' + i)?.value || 0),
      threshold: ruleUnit(sensor) === '0/1' ? 0.5 : ruleThresholdToStored(sensor, document.getElementById('rule-thresh-' + i)?.value || 0),
      hysteresis: ruleUnit(sensor) === '0/1' ? 0 : ruleHysteresisToStored(sensor, document.getElementById('rule-hyst-' + i)?.value || 0),
      actuator,
      on_value: ruleOutputToStored(actuator, document.getElementById('rule-on-' + i)?.value ?? 1),
      off_value: ruleOutputToStored(actuator, document.getElementById('rule-off-' + i).value),
      input_min: ruleSensorValueToStored(sensor, document.getElementById('rule-in-min-' + i)?.value ?? 0),
      input_max: ruleSensorValueToStored(sensor, document.getElementById('rule-in-max-' + i)?.value ?? (ruleSensorScale(sensor) === 100 ? 100 : 1)),
      output_min: ruleOutputToStored(actuator, document.getElementById('rule-out-min-' + i)?.value ?? 0),
      output_max: ruleOutputToStored(actuator, document.getElementById('rule-out-max-' + i)?.value ?? (ruleOutputIsAnalog(actuator) ? 100 : 1)),
      mode_mask: standbyMode | startMode | runMode | shutdownMode
    };
    if (source) out.source = source;
    if (target) out.target = target;
    return out;
  });
}
function ruleWarnings(rules) {
  const warnings = [];
  const byAct = new Map();
  rules.forEach((rule, index) => {
    if (!rule.enabled) return;
    if (Number(rule.actuator) === 13 || Number(rule.actuator) === 14) return;
    const list = byAct.get(rule.actuator) || [];
    list.push(index + 1);
    byAct.set(rule.actuator, list);
    if (!Number(rule.mode_mask ?? 14)) warnings.push(`Rule ${rule.name || '#' + (index + 1)} has no active mode selected.`);
  });
  byAct.forEach((list, act) => {
    if (list.length > 1) {
      const out = ruleOutputs().find(o => o.v === Number(act))?.l || ('output ' + act);
      warnings.push(`${list.length} enabled rules target ${out}. Give each output only one rule.`);
    }
  });
  return warnings;
}
function renderRuleWarnings() {
  const box = document.getElementById('rules-warnings');
  if (!box) return;
  const warnings = ruleWarnings(Array.isArray(cfg.rules) ? cfg.rules : []);
  box.style.display = warnings.length ? '' : 'none';
  box.innerHTML = warnings.map(w => 'Warning: ' + ruleEsc(w)).join('<br>');
}
function markRulesEdited(index = -1) {
  collectRules();
  if (index >= 0 && cfg.rules?.[index]) {
    const title = document.getElementById('rule-title-' + index);
    const summary = document.getElementById('rule-summary-' + index);
    if (title) title.textContent = cfg.rules[index].name || `Control rule ${index + 1}`;
    if (summary) summary.textContent = ruleSentence(cfg.rules[index]);
  }
  renderRuleWarnings();
  markSequenceDirty('Control rules edited — save to apply');
}

function validateRulesForSave() {
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const errors = [];
  const targets = new Map();
  if (rules.length > 16) errors.push(`Control rules: ${rules.length}/16. Remove ${rules.length - 16} rule(s).`);
  rules.forEach((rule, index) => {
    const sensor = rule.source
      ? ruleSensors().find(s => s.id === rule.source)
      : ruleSensors().find(s => s.v === Number(rule.sensor));
    const output = rule.target
      ? ruleOutputs().find(o => o.id === rule.target)
      : ruleOutputs().find(o => o.v === Number(rule.actuator));
    const name = rule.name ? `"${rule.name}"` : `#${index + 1}`;
    if (!sensor || !sensor.ok()) errors.push(`Rule ${name}: selected sensor is not configured.`);
    if (!output || !output.ok()) errors.push(`Rule ${name}: selected output is not configured.`);
    if (!Number(rule.mode_mask || 0)) errors.push(`Rule ${name}: select at least one engine state.`);
    if (Number(rule.kind || 0) === 1) {
      if (!ruleOutputIsAnalog(rule.actuator)) errors.push(`Rule ${name}: mapping requires a variable PWM or servo output.`);
      if (!(Number(rule.input_max) > Number(rule.input_min))) errors.push(`Rule ${name}: input maximum must be greater than input minimum.`);
    }
    if (Number(rule.actuator) !== 13 && Number(rule.actuator) !== 14) {
      const targetKey = rule.target || `#${rule.actuator}`;
      if (targets.has(targetKey)) errors.push(`Rules ${targets.get(targetKey)} and ${name} target the same output. Keep one rule per output.`);
      else targets.set(targetKey, name);
    }
  });
  return errors;
}

function validateCustomBlockLimits() {
  const defs = hwCfg.custom_blocks || {};
  const entries = Object.entries(defs);
  const errors = [];
  const sensors = getEnabledSensors();
  const acts = getEnabledActuators();
  if (entries.length > MAX_CUSTOM_BLOCKS) {
    errors.push(`Custom blocks: ${entries.length}/${MAX_CUSTOM_BLOCKS}. Remove ${entries.length - MAX_CUSTOM_BLOCKS} block(s).`);
  }
  entries.forEach(([key, def]) => {
    const label = def?.label || key;
    if (key.length > MAX_CUSTOM_KEY_LEN) {
      errors.push(`${key}: key is ${key.length}/${MAX_CUSTOM_KEY_LEN} characters. Recreate it from the UI so firmware can match it safely.`);
    }
    if ((def?.label || '').length > MAX_CUSTOM_LABEL_LEN) {
      errors.push(`${label}: label is longer than ${MAX_CUSTOM_LABEL_LEN} characters.`);
    }
    if ((def?.desc || '').length > MAX_CUSTOM_DESC_LEN) {
      errors.push(`${label}: description is longer than ${MAX_CUSTOM_DESC_LEN} characters.`);
    }
    const steps = Array.isArray(def?.steps) ? def.steps : [];
    if (steps.length > MAX_CUSTOM_STEPS) {
      errors.push(`${label}: ${steps.length}/${MAX_CUSTOM_STEPS} steps. Remove ${steps.length - MAX_CUSTOM_STEPS} step(s).`);
    }
    if (def?.type === 'action' && steps.length === 0) {
      errors.push(`${label}: action block has no steps.`);
    }
    if (def?.type === 'while') {
      const sensor = def?.condition?.sensor;
      if (!sensor || !sensors.some(s => s.key === sensor)) {
        errors.push(`${label}: condition sensor is not configured.`);
      }
    }
    steps.forEach((step, index) => {
      if (step?.type === 'set_act' && !acts.some(a => a.key === step.act)) {
        errors.push(`${label}: step ${index + 1} actuator is not configured.`);
      }
    });
    if (def?.type !== 'action' && def?.type !== 'wait' && def?.type !== 'while') {
      errors.push(`${label}: unknown custom block type.`);
    }
  });
  return errors;
}

async function saveAll() {
  if (!_seqDirty) return;
  await refreshEngineStatus();
  if (engineMode !== 'STANDBY' && engineMode !== 'FAULT') {
    setSaveStatus('Warning: Engine must be in STANDBY or FAULT to save');
    return;
  }
  collectRules();
  ['startup','shutdown','afterburner','ab-shut'].forEach(ensureActionSlots);
  const ruleErrors = validateRulesForSave();
  if (ruleErrors.length) {
    setSaveStatus('Warning: Control rule hardware mismatch');
    alert('Control rule hardware mismatch:\n\n' + ruleErrors.map(e => '- ' + e).join('\n') +
      '\n\nEdit or remove those rules before saving.');
    return;
  }
  const customLimitErrors = validateCustomBlockLimits();
  if (customLimitErrors.length) {
    setSaveStatus('Warning: Custom block setup needs attention');
    alert('Custom block setup needs attention:\n\n' + customLimitErrors.map(e => '- ' + e).join('\n') +
      '\n\nFix these before saving so firmware and hardware stay matched.');
    return;
  }
  const sequenceHardwareErrors = validateSequenceHardwareForSave();
  if (sequenceHardwareErrors.length) {
    setSaveStatus('Warning: Sequence contains blocks with missing hardware');
    await OTDialog.alert('Sequence hardware mismatch:\n\n' + sequenceHardwareErrors.map(e => '- ' + e).join('\n') +
      '\n\nRestore the required devices in Hardware or remove these blocks before saving.',
      { title: 'Sequence needs hardware' });
    return;
  }
  // Validate that the startup sequence is not empty
  const startupBlocks = hwCfg['startup_seq'] || [];
  if (startupBlocks.length === 0) {
    setSaveStatus('Warning: Startup sequence is empty - add blocks before saving');
    alert('Startup sequence is empty.\n\nAdd at minimum: Oil Pump On -> Timed Delay -> Ignition Output On -> Set Main Fuel for Idle -> Timed Delay -> Ignition Output Off -> Timed Delay\nbefore saving. An empty startup sequence will allow the engine to start with no safety or control blocks.');
    return;
  }
  // Validate sequence safety: warn if critical blocks are missing
  const seqWarnings = _validateSequence(startupBlocks);
  if (seqWarnings.length > 0) {
    const proceed = await OTDialog.confirm(
      'Warning: Sequence warnings:\n\n' + seqWarnings.map(w => '- ' + w).join('\n') +
      '\n\nSaving anyway may create an unsafe or non-starting sequence.',
      { title: 'Sequence safety warnings', confirmText: 'Save anyway', danger: true }
    );
    if (!proceed) return;
  }
  setSaveStatus('Saving engine file...');
  // Sequence order and block parameters belong to one engine file; save both atomically.
  try {
    const cfgRes = await fetch('/api/ecu_config', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ hardware: hwCfg, settings: cfg })
    });
    const resp = await cfgRes.json();
    if (!cfgRes.ok || !resp.ok) {
      setSaveStatus('Warning: Save failed: ' + (resp.error || cfgRes.status));
      return;
    }
    if (window.OTSetup) OTSetup.mark('sequence');
    clearSequenceDirty('Saved — rebooting…');
    if (resp.reboot) startRebootCountdown();
  } catch(e) { setSaveStatus('Warning: ' + e.message); }
}

function startRebootCountdown() {
  const overlay = document.getElementById('reboot-overlay');
  const cnt     = document.getElementById('reboot-count');
  overlay.classList.add('show');
  let n = 10;
  cnt.textContent = n;
  const t = setInterval(() => {
    n--;
    cnt.textContent = n;
    if (n <= 0) {
      clearInterval(t);
      reconnect();
    }
  }, 1000);
}

function reconnect(attempts=0) {
  fetch('/api/data').then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    document.getElementById('reboot-overlay').classList.remove('show');
    loadAll();
  }).catch(() => {
    if (attempts < 20) setTimeout(() => reconnect(attempts+1), 1000);
    else document.getElementById('reboot-count').textContent = 'Reload page';
  });
}

function setSaveStatus(msg) {
  document.getElementById('save-status').textContent = msg;
}

function updateSequenceSaveControls() {
  const canSave = _seqDirty && (engineMode === 'STANDBY' || engineMode === 'FAULT');
  const save = document.getElementById('save-btn');
  const discard = document.getElementById('seq-discard-btn');
  if (save) save.disabled = !canSave;
  if (discard) discard.disabled = !_seqDirty;
}

function markSequenceDirty(message) {
  _seqDirty = true;
  document.getElementById('sequence-save-bar')?.classList.add('is-dirty');
  setSaveStatus(message || 'Unsaved changes — save to apply');
  updateSequenceSaveControls();
}

function clearSequenceDirty(message) {
  _seqDirty = false;
  document.getElementById('sequence-save-bar')?.classList.remove('is-dirty');
  setSaveStatus(message || 'No unsaved changes');
  updateSequenceSaveControls();
}

async function discardSequenceChanges() {
  if (!_seqDirty) return;
  if (!await OTDialog.confirm('Discard every unsaved sequence and control-rule change?', {
    title: 'Discard changes?', confirmText: 'Discard', danger: true
  })) return;
  await loadAll();
}
