// ── "Hide unselected" actuator toggle ────────────────────────
// Collapses fitted-hardware cards to enabled items. View-only; persisted per
// browser. Profile/settings cards without an enable checkbox remain visible.
var _hideUnselActive = true;
try { localStorage.setItem('ot_hide_unsel_act', '1'); } catch (e) {}

function applyActuatorVisibility() {
  var main = document.querySelector('main');
  if (!main) return;
  main.classList.toggle('hw-installed-view', _hideUnselActive);
  var cards = main.querySelectorAll('.hw-item-card');
  cards.forEach(function (card) {
    if (card.closest('#hardware-buses-panel')) {
      card.classList.remove('hw-hide-unselected');
      return;
    }
    var en = card.querySelector('input[type=checkbox][id^="en-"]');
    var checked = en ? en.checked : true;
    card.classList.toggle('hw-hide-unselected', _hideUnselActive && !checked);
  });
  // Hide an actuator sub-header when every card up to the next header is hidden.
  var sec = document.getElementById('hw-actuators');
  if (sec) {
    var kids = Array.prototype.slice.call(sec.children);
    for (var i = 0; i < kids.length; i++) {
      if (!kids[i].classList || !kids[i].classList.contains('hw-sub')) continue;
      var anyVisible = false;
      for (var j = i + 1; j < kids.length; j++) {
        if (kids[j].classList && kids[j].classList.contains('hw-sub')) break;
        if (kids[j].classList && kids[j].classList.contains('hw-item-card') && getComputedStyle(kids[j]).display !== 'none') { anyVisible = true; break; }
      }
      kids[i].classList.toggle('hw-hide-unselected', _hideUnselActive && !anyVisible);
    }
  }
  main.querySelectorAll('.hw-section').forEach(function (section) {
    if (['hardware-buses-panel','hardware-inputs-panel','hardware-outputs-panel','hardware-comms-panel',
         'hardware-controllers-panel','hardware-safety-panel','hardware-profile-section'].includes(section.id)) return;
    const title = (section.querySelector('.hw-title')?.textContent || '').trim();
    if (title === 'System Profile') return;
    const sectionCards = Array.from(section.querySelectorAll('.hw-item-card'));
    if (!sectionCards.length) return;
    const anyVisible = sectionCards.some(card => getComputedStyle(card).display !== 'none');
    section.classList.toggle('hw-hide-unselected', _hideUnselActive && !anyVisible);
  });
}

function registryRoot() {
  if (!cfg.channel_registry) cfg.channel_registry = {version:2, inputs:[], outputs:[], bindings:[]};
  cfg.channel_registry.inputs ||= []; cfg.channel_registry.outputs ||= []; cfg.channel_registry.bindings ||= [];
  return cfg.channel_registry;
}
function registryCapacity(direction) {
  const r = registryRoot();
  const reported = Number(r[direction === 'input' ? 'input_capacity' : 'output_capacity']);
  return Number.isInteger(reported) && reported > 0 ? reported : 16;
}
const _unitPrefs = (() => { try { return JSON.parse(localStorage.getItem('ot_units') || '{}'); } catch (_) { return {}; } })();
function _saveUnitPrefs() { try { localStorage.setItem('ot_units', JSON.stringify(_unitPrefs)); } catch (_) {} }
function tempUnit() { return _unitPrefs.temp || 'C'; }
function pressUnit() { return _unitPrefs.press || 'bar'; }
function dispTempUnit() { return tempUnit() === 'F' ? '°F' : '°C'; }
function dispPressUnit() { return pressUnit() === 'psi' ? 'PSI' : 'bar'; }
function setHardwareTempUnit(value) { _unitPrefs.temp = value; _saveUnitPrefs(); updateHardwareUnitButtons(); renderRegistryInventory(); }
function setHardwarePressUnit(value) { _unitPrefs.press = value; _saveUnitPrefs(); updateHardwareUnitButtons(); renderRegistryInventory(); }
function updateHardwareUnitButtons() {
  const bt = document.getElementById('unit-temp-btn');
  const bp = document.getElementById('unit-press-btn');
  if (bt) {
    bt.textContent = dispTempUnit();
    bt.title = `Currently displaying ${dispTempUnit()}. Click to use ${tempUnit() === 'C' ? '°F' : '°C'}.`;
  }
  if (bp) {
    bp.textContent = dispPressUnit();
    bp.title = `Currently displaying ${dispPressUnit()}. Click to use ${pressUnit() === 'bar' ? 'PSI' : 'bar'}.`;
  }
}
function driverName(n) { return ({0:'On/off switch input',1:'Analog voltage input (ADC)',2:'Pulse / frequency input',3:'RC receiver pulse input',4:'On/off relay output',5:'High-frequency duty PWM output',6:'RC servo / ESC pulse output (1000–2000 µs)',7:'PWM duty measurement input',8:'TCA9554 digital input',9:'TLA2528 analog input',10:'NAU7802 load cell',11:'TCA9554 relay output'})[Number(n)] || 'Unknown'; }
const REGISTRY_INPUT_ROLES=[
  ['generic','Generic input'],['speed','Speed input'],['pressure','Pressure input'],['temperature','Temperature input'],
  ['flame','Flame input'],['flow','Flow input'],['current','Current input'],['torque','Torque input'],['thrust','Thrust input'],['voltage','Voltage input'],['operator','Operator input'],['digital_switch','Digital switch'],
  ['fault','Fault switch'],['estop','E-stop switch'],['inhibit_start','Inhibit-start switch'],['low_oil_switch','Low oil pressure switch'],['oil_zero_switch','Zero oil pressure switch'],['sequence_gate','Sequence gate switch'],
  ['ab_arm','Afterburner arm switch'],['ab_fire','Afterburner command switch'],['limp_mode','Reduced-power mode switch']
];
const REGISTRY_OUTPUT_ROLES=[
  ['generic','Generic output'],['fuel','Fuel metering'],['fuel_shutoff','Fuel shutoff'],['starter','Starter'],
  ['starter_en','Starter enable'],['oil_pump','Oil pump'],['coolant_pump','Coolant pump'],['scavenge_pump','Scavenge pump'],['cooling_fan','Cooling fan'],
  ['valve','Valve / solenoid'],['igniter','Igniter'],['ab_igniter','AB igniter'],['glow_plug','Glow plug'],
  ['fuel_pump','Secondary / auxiliary fuel pump'],['ab_pump','Afterburner fuel pump'],['prop_pitch','Prop pitch'],
  ['indicator','Warning / indicator light']
];
const REGISTRY_INPUT_PURPOSES=[
  {value:'n1_speed',label:'N1 speed',role:'speed',drivers:[2,1,9],group:'Engine sensors'},
  {value:'n2_speed',label:'N2 speed',role:'speed',drivers:[2,1,9],group:'Engine sensors'},
  {value:'shaft_speed',label:'General / additional shaft speed',role:'speed',drivers:[2,1,9],group:'General-purpose sensors'},
  {value:'tot',label:'Turbine outlet temperature (TOT / EGT)',role:'temperature',drivers:[1,9],group:'Engine sensors'},
  {value:'tit',label:'Turbine inlet temperature (TIT)',role:'temperature',drivers:[1,9],group:'Engine sensors'},
  {value:'oil_pressure',label:'Oil pressure',role:'pressure',drivers:[1,9],group:'Engine sensors'},
  {value:'fuel_pressure',label:'Fuel pressure',role:'pressure',drivers:[1,9],group:'Engine sensors'},
  {value:'p1_pressure',label:'Pressure 1',role:'pressure',drivers:[1,9],group:'Engine sensors'},
  {value:'p2_pressure',label:'Pressure 2',role:'pressure',drivers:[1,9],group:'Engine sensors'},
  {value:'coolant_pressure',label:'Coolant pressure',role:'pressure',drivers:[1,9],group:'Engine sensors'},
  {value:'oil_temperature',label:'Oil / gearbox temperature',role:'temperature',drivers:[1,9],group:'Engine sensors'},
  {value:'coolant_temp',label:'Coolant temperature',role:'temperature',drivers:[1,9],group:'Engine sensors'},
  {value:'intake_temperature',label:'Intake / ambient temperature',role:'temperature',drivers:[1,9],group:'Engine sensors'},
  {value:'fuel_flow',label:'Fuel flow',role:'flow',drivers:[2,1,9],group:'Engine sensors'},
  {value:'general_temperature',label:'General temperature',role:'temperature',drivers:[1,9],group:'General-purpose sensors'},
  {value:'general_pressure',label:'General pressure',role:'pressure',drivers:[1,9],group:'General-purpose sensors'},
  {value:'general_flow',label:'General flow',role:'flow',drivers:[2,1,9],group:'General-purpose sensors'},
  {value:'general_current',label:'General current',role:'current',drivers:[1,9],group:'General-purpose sensors'},
  {value:'general_voltage',label:'General voltage',role:'voltage',drivers:[1,9],group:'General-purpose sensors'},
  {value:'general_torque',label:'General torque',role:'torque',drivers:[1,9,10],group:'General-purpose sensors'},
  {value:'general_thrust',label:'General thrust',role:'thrust',drivers:[1,9,10],group:'General-purpose sensors'},
  {value:'oil_flow',label:'Main oil-pump flow',role:'flow',drivers:[2,1,9],group:'Engine sensors'},
  {value:'scavenge_flow',label:'Scavenge-pump flow',role:'flow',drivers:[2,1,9],group:'Engine sensors'},
  {value:'flame',label:'Flame sensor',role:'flame',drivers:[0,1,8,9],group:'Engine sensors'},
  {value:'ab_flame',label:'Afterburner flame sensor',role:'flame',drivers:[0,1,8,9],group:'Engine sensors'},
  {value:'torque',label:'Torque',role:'torque',drivers:[1,9,10],group:'Engine sensors'},
  {value:'thrust',label:'Thrust',role:'thrust',drivers:[10,1,9],group:'Engine sensors'},
  {value:'battery_voltage',label:'Battery / bus voltage',role:'voltage',drivers:[1,9],group:'Engine sensors'},
  {value:'throttle',label:'Throttle input',role:'operator',drivers:[1,3,2,7,9],group:'Operator inputs'},
  {value:'idle',label:'Idle input',role:'operator',drivers:[0,1,3,2,7,8,9],group:'Operator inputs'},
  {value:'ab_command',label:'Afterburner analog / RC command',role:'operator',drivers:[1,3,7,9],group:'Operator inputs'},
  {value:'start_switch',label:'Start switch',role:'digital_switch',drivers:[0,1,8,9],group:'Switches and interlocks'},
  {value:'stop_switch',label:'Stop switch',role:'digital_switch',drivers:[0,1,8,9],group:'Switches and interlocks'},
  {value:'digital_switch',label:'Digital interlock',role:'digital_switch',drivers:[0,1,8,9],group:'Switches and interlocks'},
  {value:'inhibit_start',label:'Inhibit-start switch',role:'inhibit_start',drivers:[0,1,8,9],group:'Switches and interlocks'},
  {value:'estop',label:'Emergency-stop switch',role:'estop',drivers:[0,1,8,9],group:'Switches and interlocks'},
  {value:'fault',label:'Fault switch',role:'fault',drivers:[0,1,8,9],group:'Switches and interlocks'},
  {value:'low_oil_switch',label:'Low oil pressure safety switch',role:'low_oil_switch',drivers:[0,1,8,9],group:'Switches and interlocks'},
  {value:'oil_zero_switch',label:'Zero oil pressure safety switch',role:'oil_zero_switch',drivers:[0,1,8,9],group:'Switches and interlocks'},
  {value:'sequence_gate',label:'Sequence gate switch',role:'sequence_gate',drivers:[0,1,8,9],group:'Switches and interlocks'},
  {value:'ab_arm',label:'Afterburner arm switch',role:'ab_arm',drivers:[0,1,8,9],group:'Switches and interlocks'},
  {value:'ab_fire',label:'Afterburner command switch',role:'ab_fire',drivers:[0,1,8,9],group:'Switches and interlocks'},
  {value:'limp_mode',label:'Reduced-power mode switch',role:'limp_mode',drivers:[0,1,8,9],group:'Switches and interlocks'},
  {value:'generic',label:'Generic automation input',role:'generic',drivers:[0,1,2,3,7,8,9],group:'Generic automation I/O'}
];
const REGISTRY_OUTPUT_PURPOSES=[
  {value:'main_fuel',label:'Main fuel metering',role:'fuel',drivers:[5,6],group:'Engine actuators'},
  {value:'fuel_shutoff',label:'Fuel shutoff',role:'fuel_shutoff',drivers:[4,11],group:'Engine actuators'},
  {value:'starter',label:'Starter',role:'starter',drivers:[4,5,6,11],group:'Engine actuators'},
  {value:'starter_enable',label:'Starter enable',role:'starter_en',drivers:[4,5,6,11],group:'Engine actuators'},
  {value:'oil_pump',label:'Oil pump',role:'oil_pump',drivers:[4,5,6,11],group:'Pumps and cooling'},
  {value:'coolant_pump',label:'Coolant pump',role:'coolant_pump',drivers:[4,5,6,11],group:'Pumps and cooling'},
  {value:'scavenge_pump',label:'Oil scavenge pump',role:'scavenge_pump',drivers:[4,5,6,11],group:'Pumps and cooling'},
  {value:'cooling_fan',label:'Cooling fan',role:'cooling_fan',drivers:[4,5,6,11],group:'Pumps and cooling'},
  {value:'fuel_pump',label:'Secondary / auxiliary fuel pump',role:'fuel_pump',drivers:[4,5,6,11],group:'Pumps and cooling'},
  {value:'bleed_valve',label:'Compressor bleed valve',role:'valve',drivers:[4,5,6,11],group:'Valves and auxiliaries'},
  {value:'igniter',label:'Igniter',role:'igniter',drivers:[4,5,11],group:'Ignition'},
  {value:'ab_igniter',label:'Afterburner igniter',role:'ab_igniter',drivers:[4,5,11],group:'Ignition'},
  {value:'glow_plug',label:'Glow plug',role:'glow_plug',drivers:[4,5,11],group:'Ignition'},
  {value:'valve',label:'Valve / actuator',role:'valve',drivers:[4,5,6,11],group:'Valves and auxiliaries'},
  {value:'ab_valve',label:'Afterburner fuel shutoff valve',role:'valve',drivers:[4,11],group:'Valves and auxiliaries'},
  {value:'air_starter',label:'Air-starter valve / actuator',role:'starter',drivers:[4,5,6,11],group:'Valves and auxiliaries'},
  {value:'pilot_fuel',label:'Pilot fuel',role:'valve',drivers:[4,5,6,11],group:'Valves and auxiliaries'},
  {value:'purge_valve',label:'Air / fuel purge valve',role:'valve',drivers:[4,5,6,11],group:'Valves and auxiliaries'},
  {value:'drain_valve',label:'Electric drain valve',role:'valve',drivers:[4,5,6,11],group:'Valves and auxiliaries'},
  {value:'nozzle_actuator',label:'Variable nozzle actuator',role:'prop_pitch',drivers:[5,6],group:'Valves and auxiliaries'},
  {value:'ab_pump',label:'Afterburner fuel pump',role:'ab_pump',drivers:[4,5,6,11],group:'Valves and auxiliaries'},
  {value:'prop_pitch',label:'Propeller pitch',role:'prop_pitch',drivers:[4,5,6,11],group:'Valves and auxiliaries'},
  {value:'warning_indicator',label:'Warning / indicator light',role:'indicator',drivers:[4,5,11],group:'Warnings and indicators'},
  {value:'generic',label:'Generic automation output',role:'generic',drivers:[4,5,6,11],group:'Generic automation I/O'}
];
function registryPurposeDefinitions(direction) { return direction === 'input' ? REGISTRY_INPUT_PURPOSES : REGISTRY_OUTPUT_PURPOSES; }
function registryPurposeDefinition(direction, purpose) {
  return registryPurposeDefinitions(direction).find(p => p.value === String(purpose || 'generic')) || registryPurposeDefinitions(direction).find(p => p.value === 'generic');
}
function registryDerivedPurpose(direction, c) {
  if (c?.purpose && registryPurposeDefinitions(direction).some(p => p.value === c.purpose)) return c.purpose;
  const id=String(c?.id||''), role=String(c?.role||'generic');
  const ids = direction === 'input'
    ? {n1_main:'n1_speed',primary_n1:'n1_speed',n2_main:'n2_speed',primary_n2:'n2_speed',tot_main:'tot',primary_egt:'tot',tit_main:'tit',oil_pressure_main:'oil_pressure',fuel_pressure:'fuel_pressure',p1_main:'p1_pressure',p1:'p1_pressure',p2_main:'p2_pressure',p2:'p2_pressure',coolant_pressure:'coolant_pressure',oil_temperature:'oil_temperature',coolant_temperature:'coolant_temp',intake_temperature:'intake_temperature',fuel_flow:'fuel_flow',general_temperature:'general_temperature',general_pressure:'general_pressure',general_flow:'general_flow',general_current:'general_current',general_voltage:'general_voltage',general_torque:'general_torque',general_thrust:'general_thrust',oil_flow:'oil_flow',scavenge_flow:'scavenge_flow',flame_main:'flame',torque_main:'torque',battery_voltage:'battery_voltage',batt_voltage_main:'battery_voltage',operator_throttle:'throttle',operator_idle:'idle'}
    : {main_fuel:'main_fuel',main_fuel_output:'main_fuel',fuel_shutoff:'fuel_shutoff',main_fuel_shutoff:'fuel_shutoff',starter:'starter',main_starter:'starter',starter_enable:'starter_enable',oil_pump:'oil_pump',coolant_pump:'coolant_pump',scavenge_pump:'scavenge_pump',cooling_fan:'cooling_fan',fuel_pump:'fuel_pump',bleed_valve:'bleed_valve',bleed_valve_main:'bleed_valve',igniter:'igniter',ab_igniter:'ab_igniter',ab_solenoid:'ab_valve',glow_plug:'glow_plug',ab_pump:'ab_pump',prop_pitch:'prop_pitch',air_starter:'air_starter',pilot_fuel:'pilot_fuel',purge_valve:'purge_valve',drain_valve:'drain_valve',nozzle_actuator:'nozzle_actuator'};
  if (ids[id]) return ids[id];
  if (registryPurposeDefinitions(direction).some(p => p.value === role)) return role;
  if (direction === 'input' && role === 'speed') return 'shaft_speed';
  if (direction === 'input' && role === 'temperature') return 'general_temperature';
  if (direction === 'input' && role === 'pressure') return 'general_pressure';
  if (direction === 'input' && role === 'flow') return 'general_flow';
  if (direction === 'input' && role === 'current') return 'general_current';
  if (direction === 'input' && role === 'voltage') return 'general_voltage';
  if (direction === 'input' && role === 'torque') return 'general_torque';
  if (direction === 'input' && role === 'thrust') return 'general_thrust';
  if (direction === 'output' && role === 'fuel') return 'main_fuel';
  if (direction === 'output' && role === 'starter_en') return 'starter_enable';
  if (direction === 'output' && role === 'indicator') return 'warning_indicator';
  return 'generic';
}
function registryPurposeOptions(direction, selected, channel = null) {
  let defs=registryPurposeDefinitions(direction);
  let assignedMode = null;
  if (pcbProfileActive() && channel?.physical_port && channel?.physical_mode) {
    const port = (pcbProfile.ports || []).find(row=>row.id===channel.physical_port);
    assignedMode = port?.modes?.find(row=>row.id===channel.physical_mode) || null;
    if (assignedMode) defs = defs.filter(p=>p.value===selected || pcbModeCompatible(direction,p.value,p.role,assignedMode));
  }
  const rows = registryRoot()[direction+'s'] || [];
  const groups=[];
  defs.forEach(p=>{let g=groups.find(x=>x.name===p.group);if(!g){g={name:p.group,rows:[]};groups.push(g);}g.rows.push(p);});
  return groups.map(g=>`<optgroup label="${escapeHtmlText(g.name)}">${g.rows.map(p=>{
    const duplicate = p.value!==selected && registryPurposeIsSingleton(direction,p.value) &&
      rows.some(row=>row!==channel && registryDerivedPurpose(direction,row)===p.value);
    const incompatible = assignedMode && p.value===selected && !pcbModeCompatible(direction,p.value,p.role,assignedMode);
    const suffix = duplicate ? ' — already assigned' : (incompatible ? ' — incompatible with connector' : '');
    return `<option value="${p.value}"${p.value===selected?' selected':''}${duplicate?' disabled':''}>${escapeHtmlText(p.label+suffix)}</option>`;
  }).join('')}</optgroup>`).join('');
}
const REGISTRY_INPUT_PRESETS=[
  {group:'Engine sensors',purpose:'n1_speed',role:'speed',label:'N1 speed',id:'n1_main',name:'N1 Speed',driver:2},
  {group:'Engine sensors',purpose:'n2_speed',role:'speed',label:'N2 speed',id:'n2_main',name:'N2 Speed',driver:2},
  {group:'General-purpose sensors',purpose:'shaft_speed',role:'speed',label:'General / additional shaft speed',id:'shaft_speed',name:'Shaft Speed',driver:2},
  {group:'Engine sensors',purpose:'tot',role:'temperature',label:'TOT / EGT',id:'tot_main',name:'Main TOT',driver:1,temp_interface:2},
  {group:'Engine sensors',purpose:'tit',role:'temperature',label:'TIT',id:'tit_main',name:'Main TIT',driver:1,temp_interface:2},
  {group:'Engine sensors',purpose:'oil_pressure',role:'pressure',label:'Oil pressure',id:'oil_pressure_main',name:'Oil Pressure',driver:1},
  {group:'Engine sensors',purpose:'p1_pressure',role:'pressure',label:'Pressure 1',id:'p1_main',name:'Pressure 1',driver:1},
  {group:'Engine sensors',purpose:'p2_pressure',role:'pressure',label:'Pressure 2',id:'p2_main',name:'Pressure 2',driver:1},
  {group:'Engine sensors',purpose:'coolant_pressure',role:'pressure',label:'Coolant pressure',id:'coolant_pressure',name:'Coolant Press',driver:1},
  {group:'Engine sensors',purpose:'oil_temperature',role:'temperature',label:'Oil temperature',id:'oil_temperature',name:'Oil Temp',driver:1},
  {group:'Engine sensors',purpose:'coolant_temp',role:'temperature',label:'Coolant temperature',id:'coolant_temperature',name:'Coolant Temp',driver:1},
  {group:'Engine sensors',purpose:'intake_temperature',role:'temperature',label:'Intake / ambient temperature',id:'intake_temperature',name:'Intake Temp',driver:1},
  {group:'Engine sensors',purpose:'fuel_pressure',role:'pressure',label:'Fuel pressure',id:'fuel_pressure',name:'Fuel Pressure',driver:1},
  {group:'Engine sensors',purpose:'fuel_flow',role:'flow',label:'Fuel flow',id:'fuel_flow',name:'Fuel Flow',driver:2},
  {group:'General-purpose sensors',purpose:'general_temperature',role:'temperature',label:'General temperature',id:'general_temperature',name:'Temperature Sensor',driver:1},
  {group:'General-purpose sensors',purpose:'general_pressure',role:'pressure',label:'General pressure',id:'general_pressure',name:'Pressure Sensor',driver:1},
  {group:'General-purpose sensors',purpose:'general_flow',role:'flow',label:'General flow',id:'general_flow',name:'Flow Sensor',driver:2},
  {group:'General-purpose sensors',purpose:'general_current',role:'current',label:'General current',id:'general_current',name:'Current Sensor',driver:1},
  {group:'General-purpose sensors',purpose:'general_voltage',role:'voltage',label:'General voltage',id:'general_voltage',name:'Voltage Sensor',driver:1},
  {group:'General-purpose sensors',purpose:'general_torque',role:'torque',label:'General torque',id:'general_torque',name:'Torque Sensor',driver:1},
  {group:'General-purpose sensors',purpose:'general_thrust',role:'thrust',label:'General thrust',id:'general_thrust',name:'Thrust Sensor',driver:1},
  {group:'Engine sensors',purpose:'oil_flow',role:'flow',label:'Main oil-pump flow',id:'oil_flow',name:'Oil Flow',driver:2},
  {group:'Engine sensors',purpose:'scavenge_flow',role:'flow',label:'Scavenge-pump flow',id:'scavenge_flow',name:'Scavenge Flow',driver:2},
  {group:'Engine sensors',purpose:'flame',role:'flame',label:'Flame',id:'flame_main',name:'Flame',driver:1},
  {group:'Engine sensors',purpose:'ab_flame',role:'flame',label:'AB flame',id:'ab_flame_main',name:'AB Flame',driver:1},
  {group:'Engine sensors',purpose:'torque',role:'torque',label:'Torque',id:'torque_main',name:'Torque',driver:1},
  {group:'Engine sensors',purpose:'thrust',role:'thrust',label:'Thrust',id:'thrust_main',name:'Thrust',driver:10,i2c_address:42,device_channel:0},
  {group:'Engine sensors',purpose:'battery_voltage',role:'voltage',label:'Battery voltage',id:'battery_voltage',name:'Battery Volt',driver:1},
  {group:'Operator and interlock inputs',purpose:'throttle',role:'operator',label:'Throttle input',id:'operator_throttle',name:'Throttle Input',driver:1},
  {group:'Operator and interlock inputs',purpose:'idle',role:'operator',label:'Idle input',id:'operator_idle',name:'Idle Input',driver:1},
  {group:'Operator and interlock inputs',purpose:'ab_command',role:'operator',label:'Afterburner analog / RC command',id:'ab_command',name:'AB Command',driver:1},
  {group:'Operator and interlock inputs',purpose:'start_switch',role:'digital_switch',label:'Start switch',id:'start_switch',name:'Start Switch',driver:0},
  {group:'Operator and interlock inputs',purpose:'stop_switch',role:'digital_switch',label:'Stop switch',id:'stop_switch',name:'Stop Switch',driver:0},
  {group:'Operator and interlock inputs',purpose:'digital_switch',role:'digital_switch',label:'Digital interlock',id:'digital_interlock',name:'Interlock',driver:0},
  {group:'Operator and interlock inputs',purpose:'inhibit_start',role:'inhibit_start',label:'Inhibit-start switch',id:'inhibit_start',name:'Inhibit Start',driver:0},
  {group:'Operator and interlock inputs',purpose:'estop',role:'estop',label:'E-stop switch',id:'estop',name:'E-Stop',driver:0},
  {group:'Operator and interlock inputs',purpose:'fault',role:'fault',label:'Fault switch',id:'fault_switch',name:'Fault Switch',driver:0},
  {group:'Operator and interlock inputs',purpose:'low_oil_switch',role:'low_oil_switch',label:'Low oil pressure switch',id:'low_oil_switch',name:'Low Oil Switch',driver:0},
  {group:'Operator and interlock inputs',purpose:'oil_zero_switch',role:'oil_zero_switch',label:'Zero oil pressure switch',id:'oil_zero_switch',name:'Zero Oil Switch',driver:0},
  {group:'Operator and interlock inputs',purpose:'sequence_gate',role:'sequence_gate',label:'Sequence gate switch',id:'sequence_gate',name:'Sequence Gate',driver:0},
  {group:'Operator and interlock inputs',purpose:'ab_arm',role:'ab_arm',label:'Afterburner arm switch',id:'ab_arm',name:'Afterburner Arm',driver:0},
  {group:'Operator and interlock inputs',purpose:'ab_fire',role:'ab_fire',label:'Afterburner command switch',id:'ab_fire',name:'Afterburner Command',driver:0},
  {group:'Operator and interlock inputs',purpose:'limp_mode',role:'limp_mode',label:'Reduced-power mode switch',id:'limp_mode',name:'Reduced-Power Mode',driver:0},
  {group:'Generic inputs',role:'generic',label:'Generic digital input',id:'generic_digital_input',name:'Digital Input',driver:0},
  {group:'Generic inputs',role:'generic',label:'Generic analog input',id:'generic_analog_input',name:'Analog Input',driver:1},
  {group:'Generic inputs',role:'generic',label:'Generic pulse/frequency',id:'generic_pulse_input',name:'Pulse Input',driver:2},
  {group:'Generic inputs',role:'generic',label:'Generic RC PWM input',id:'generic_rc_input',name:'RC Input',driver:3},
  {group:'Generic inputs',role:'generic',label:'Generic PWM duty input',id:'generic_pwm_duty_input',name:'PWM Duty Input',driver:7}
];
const REGISTRY_OUTPUT_PRESETS=[
  {group:'Engine actuators',role:'fuel',label:'Main fuel metering',id:'main_fuel',name:'Main Fuel Metering',driver:5},
  {group:'Engine actuators',role:'starter',label:'Starter',id:'starter',name:'Starter',driver:5},
  {group:'Engine actuators',role:'starter_en',label:'Starter enable',id:'starter_enable',name:'Starter Enable',driver:4},
  {group:'Engine actuators',role:'oil_pump',label:'Oil pump',id:'oil_pump',name:'Oil Pump',driver:5},
  {group:'Engine actuators',purpose:'coolant_pump',role:'coolant_pump',label:'Coolant pump',id:'coolant_pump',name:'Coolant Pump',driver:5},
  {group:'Engine actuators',role:'scavenge_pump',label:'Scavenge pump',id:'scavenge_pump',name:'Scavenge Pump',driver:5},
  {group:'Engine actuators',role:'fuel_shutoff',label:'Fuel shutoff',id:'fuel_shutoff',name:'Fuel Shutoff',driver:4},
  {group:'Engine actuators',role:'igniter',label:'Igniter',id:'igniter',name:'Igniter',driver:4},
  {group:'Engine actuators',role:'ab_igniter',label:'AB igniter',id:'ab_igniter',name:'AB Igniter',driver:4},
  {group:'Engine actuators',role:'glow_plug',label:'Glow plug',id:'glow_plug',name:'Glow Plug',driver:5},
  {group:'Engine actuators',purpose:'air_starter',role:'starter',label:'Air starter',id:'air_starter',name:'Air Starter',driver:4},
  {group:'Engine actuators',purpose:'pilot_fuel',role:'valve',label:'Pilot fuel',id:'pilot_fuel',name:'Pilot Fuel',driver:4},
  {group:'Engine actuators',purpose:'purge_valve',role:'valve',label:'Air / fuel purge valve',id:'purge_valve',name:'Purge Valve',driver:4},
  {group:'Engine actuators',purpose:'drain_valve',role:'valve',label:'Electric drain valve',id:'drain_valve',name:'Drain Valve',driver:4},
  {group:'Engine actuators',purpose:'nozzle_actuator',role:'prop_pitch',label:'Variable nozzle actuator',id:'nozzle_actuator',name:'Nozzle Actuator',driver:6},
  {group:'Engine actuators',role:'cooling_fan',label:'Cooling fan',id:'cooling_fan',name:'Cooling Fan',driver:5},
  {group:'Engine actuators',role:'fuel_pump',label:'Secondary / auxiliary fuel pump',id:'fuel_pump',name:'Secondary / Aux Fuel',driver:5},
  {group:'Engine actuators',purpose:'bleed_valve',role:'valve',label:'Bleed valve',id:'bleed_valve',name:'Bleed Valve',driver:4},
  {group:'Engine actuators',role:'prop_pitch',label:'Prop pitch',id:'prop_pitch',name:'Prop Pitch',driver:6},
  {group:'Engine actuators',purpose:'ab_valve',role:'valve',label:'Afterburner fuel shutoff valve',id:'ab_solenoid',name:'AB Fuel Valve',driver:4},
  {group:'Engine actuators',role:'ab_pump',label:'Afterburner fuel pump',id:'ab_pump',name:'AB Fuel Pump',driver:5},
  {group:'Warnings and indicators',purpose:'warning_indicator',role:'indicator',label:'Warning / indicator light',id:'warning_indicator',name:'Warning Light',driver:4},
  {group:'Generic outputs',role:'generic',label:'Relay output',id:'generic_relay_output',name:'Relay Output',driver:4},
  {group:'Generic outputs',role:'generic',label:'PWM output',id:'generic_pwm_output',name:'PWM Output',driver:5},
  {group:'Generic outputs',role:'generic',label:'Servo/ESC output',id:'generic_servo_output',name:'Servo Output',driver:6}
];
const REGISTRY_PRESET_HELP = {
  input: {
    n1_speed:'Core or gas-generator shaft RPM. Used for overspeed protection, startup and idle control.',
    n2_speed:'Free power-turbine or propeller shaft RPM. Required by the power-turbine governor.',
    shaft_speed:'A repeatable user-named shaft-speed channel for dashboard data, logging, controllers, rules and sequencing. Pulse inputs use scarce ESP32 PCNT hardware; the ECU rejects configurations that exceed the board limit.',
    tot:'Turbine-outlet thermocouple or temperature transmitter. A K-type thermocouple with MAX31855 is the default starting point; other supported interfaces remain selectable. Used for temperature limits and hot-start protection.',
    tit:'Turbine-inlet thermocouple or temperature transmitter. A K-type thermocouple with MAX31855 is the default starting point; other supported interfaces remain selectable. Use when the engine limit is specified as TIT rather than exhaust temperature.',
    oil_pressure:'Oil-system pressure feedback for protection and optional closed-loop pump control.',
    fuel_pressure:'Fuel-manifold pressure feedback for low-pressure protection and diagnostics.',
    p1_pressure:'General calibrated pressure channel 1. Rename it for the actual measurement; it can feed display, logging, rules, idle feedback, fuel limiting, or shutdown protection.',
    p2_pressure:'General calibrated pressure channel 2. Rename it for the actual measurement; it can feed display, logging, rules, idle feedback, fuel limiting, or shutdown protection.',
    coolant_pressure:'Liquid-cooling circuit pressure for custom rules, sequencing and logging.',
    oil_temperature:'Oil or gearbox temperature for overtemperature protection and calibration.',
    coolant_temp:'Liquid-cooling temperature for fan/pump rules and protection logic.',
    intake_temperature:'Ambient or compressor-inlet air temperature for logging and custom rules.',
    fuel_flow:'Fuel flow-meter signal for consumption logging and custom limits.',
    general_temperature:'A repeatable user-named temperature measurement with temperature units and calibration. Available to dashboard data, logging, controllers, rules and sequencing.',
    general_pressure:'A repeatable user-named pressure measurement with pressure units and calibration. Available to dashboard data, logging, controllers, rules and sequencing.',
    general_flow:'A repeatable user-named flow measurement for coolant, air, auxiliary fluids, or any other circuit. It does not imply a pump link and is available to dashboard data, logging, controllers, rules and sequencing.',
    general_current:'A repeatable user-named current measurement for a bus or accessory. It is not tied to an output and creates no automatic shutdown; use a controller or protection rule when an action is required.',
    general_voltage:'A repeatable user-named voltage measurement with voltage-divider calibration. Available to dashboard data, logging, controllers, rules and sequencing.',
    general_torque:'A repeatable user-named torque measurement. Available to dashboard data, logging, controllers, rules and sequencing.',
    general_thrust:'A repeatable user-named thrust or load measurement. Available to dashboard data, logging, controllers, rules and sequencing.',
    oil_flow:'Flow meter for the main oil-pump circuit. It can warn about low or missing flow while that pump is commanded on.',
    scavenge_flow:'Flow meter for the scavenge/return circuit. It can warn about low or missing flow while that pump is commanded on.',
    flame:'Main combustor flame detector used to confirm light-off and detect flameout.',
    ab_flame:'Afterburner flame detector used to confirm afterburner light-off.',
    torque:'Shaft torque sensor, including analog transmitters, HX711 modules, and fitted NAU7802 load-cell channels.',
    thrust:'Load-cell thrust measurement for test stands, performance logging, and custom protection rules.',
    battery_voltage:'ECU supply or battery voltage for undervoltage protection.',
    throttle:'Operator throttle demand from an analog, RC PWM, pulse-duty or generic input.',
    idle:'Separate idle-demand input used by idle and startup sequencing.',
    ab_command:'Dedicated normalized analog, RC pulse, or PWM-duty command used to request afterburner and optionally schedule its pump.',
    start_switch:'Physical start command. The ECU starts only on a debounced press after the switch has been released once after boot.',
    stop_switch:'Dedicated hard stop command. This input is required and requests shutdown immediately when activated.',
    digital_switch:'General hardwired interlock state for rules and sequence conditions.',
    inhibit_start:'Switch that prevents a start while the external inhibit is active.',
    estop:'Emergency-stop input that requests immediate shutdown.',
    fault:'External fault input that puts the ECU into fault shutdown.',
    low_oil_switch:'Discrete low-oil-pressure switch for running protection.',
    oil_zero_switch:'Discrete zero-oil-pressure switch for immediate protection.',
    sequence_gate:'Physical permission switch used to gate a sequence action.',
    ab_arm:'Physical afterburner arm/permission switch.',
    ab_fire:'Physical afterburner fire-request switch.',
    limp_mode:'Physical switch that requests the shared Reduced-Power cap. The ECU can also turn this same mode on automatically if feedback required by an enabled safety protection or shaft controller is lost.',
    generic:'Unassigned normalized input for custom rules or sequence logic.'
  },
  output: {
    main_fuel:'Primary proportional fuel-pump or throttle-ESC command used to control engine power.',
    fuel_shutoff:'Normally closed main-fuel safety valve. It opens for fuel admission and closes on every shutdown.',
    starter:'Electric starter motor, starter ESC or starter solenoid used to spool the engine.',
    starter_enable:'Separate enable/contactor command for starter electronics that need both enable and demand.',
    oil_pump:'Main oil-pump motor command used by startup/shutdown steps and the optional pressure loop.',
    coolant_pump:'Liquid-cooling circulation pump for sequence actions or temperature rules.',
    scavenge_pump:'Oil scavenge/return pump that clears oil from the bearing or gearbox sump.',
    cooling_fan:'Cooling fan output controlled by sequence actions or temperature rules.',
    fuel_pump:'Secondary, auxiliary or start-fuel pump; separate from the primary engine fuel command.',
    igniter:'Main combustor ignition exciter or coil command used during light-off.',
    ab_igniter:'Dedicated afterburner ignition exciter used during afterburner light-up.',
    glow_plug:'Glow element output for engines that use hot-surface ignition.',
    valve:'General on/off valve or solenoid for custom sequence actions and rules.',
    bleed_valve:'Compressor bleed valve controlled by startup/shutdown sequence blocks, direct commands, or a user controller.',
    ab_valve:'Normally closed valve that admits fuel to the afterburner manifold during light-up and closes on stop or fault.',
    air_starter:'Solenoid that admits compressed air to an air starter.',
    pilot_fuel:'Independent pilot-fuel pump or valve available to Sequence and Controllers. It is separate from the pilot-fuel hardware built into a wet glow plug.',
    purge_valve:'Air or fuel purge valve used to clear the manifold during startup or shutdown.',
    drain_valve:'Electric drain valve that can be opened or closed by sequence blocks and control rules.',
    nozzle_actuator:'Proportional variable exhaust-nozzle actuator.',
    ab_pump:'Dedicated pump or ESC that meters fuel to the afterburner manifold.',
    prop_pitch:'Propeller-pitch actuator used by the N2/power-turbine governor. Relay outputs provide deliberate fine/coarse two-position control.',
    warning_indicator:'Warning lamp or indicator commanded by rules and sequence actions.',
    generic:'Unassigned output for custom rules or sequence actions.'
  }
};
function registryPresetDescription(direction, preset) {
  const purpose = preset.purpose || registryDerivedPurpose(direction, preset);
  return REGISTRY_PRESET_HELP[direction]?.[purpose] || REGISTRY_PRESET_HELP[direction]?.generic || '';
}
function registryRoleOptions(direction, selected) {
  const roles = direction === 'input' ? REGISTRY_INPUT_ROLES : REGISTRY_OUTPUT_ROLES;
  return roles.map(([v,label]) => `<option value="${v}"${String(selected||'generic')===v?' selected':''}>${label}</option>`).join('');
}
function registrySlug(s) {
  return String(s||'channel').toLowerCase().replace(/[^a-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,19) || 'channel';
}
function registryUniqueId(base) {
  const r=registryRoot(), used=new Set([...r.inputs,...r.outputs].map(c=>c.id));
  base=registrySlug(base).slice(0,19);
  if(!used.has(base)) return base;
  for(let n=2;n<100;n++){
    const suffix='_'+n, id=base.slice(0,19-suffix.length)+suffix;
    if(!used.has(id)) return id;
  }
  return '';
}
function registryRoleNumber(direction, role) {
  const rows=registryRoot()[direction+'s'];
  return rows.filter(c=>String(c.role||'generic')===role).length+1;
}
function registryHumanizeIdentifier(raw, direction) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const key = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const direct = {
    user_throttle:'Throttle Input', operator_throttle:'Throttle Input', operator_thrott:'Throttle Input', throttle_input:'Throttle Input',
    user_idle:'Idle Input', operator_idle:'Idle Input', idle_input:'Idle Input',
    oil_pump:'Oil Pump', oil_pump_main:'Oil Pump', fuel_pump:'Secondary / Auxiliary Fuel Pump', main_fuel:'Main Fuel Metering',
    fuel_shutoff:'Fuel Shutoff', fuel_sol:'Fuel Shutoff',
    flame:'Flame Sensor', flame_main:'Flame Sensor',
    low_oil_switch:'Low Oil Switch', oil_zero_switch:'Zero Oil Pressure Switch',
    coolant_pump:'Coolant Pump', coolant_temperature:'Coolant Temperature',
    pilot_fuel:'Start Fuel', purge_valve:'Purge Valve', air_starter:'Air Starter',
    ab_pump:'Afterburner Fuel Pump', ab_solenoid:'Afterburner Fuel Valve', ab_igniter:'Afterburner Igniter',
    prop_pitch:'Prop Pitch', nozzle_actuator:'Nozzle Actuator'
  };
  if (direct[key]) return direct[key];
  if (direction === 'input' && (key.includes('throttle') || key.includes('thrott'))) return 'Throttle Input';
  if (direction === 'input' && key.includes('idle')) return 'Idle Input';
  if (key.includes('oil') && key.includes('pump')) return 'Oil Pump';
  if (key.includes('fuel') && key.includes('pump')) return 'Fuel Pump';
  if (key.includes('flame')) return 'Flame Sensor';
  return key.split('_').filter(Boolean).map(part => {
    const upper = {n1:'N1', n2:'N2', tot:'TOT', tit:'TIT', egt:'EGT', ab:'AB', rc:'RC', pwm:'PWM', adc:'ADC', esc:'ESC', gpio:'GPIO', rpm:'RPM'};
    return upper[part] || (part.charAt(0).toUpperCase() + part.slice(1));
  }).join(' ') || text;
}
function registryNameLooksInternal(name) {
  const s = String(name || '').trim();
  if (!s) return false;
  return s.includes('_') || /^[a-z0-9_-]+$/.test(s);
}
function registryDisplayName(direction, c, fallback) {
  const raw = String(c?.name || '').trim();
  if (direction === 'output' && registryDerivedPurpose(direction, c) === 'main_fuel' &&
      ['Main Fuel Pump','Main Fuel Meteri'].includes(raw)) return 'Main Fuel Metering';
  if (raw && !registryNameLooksInternal(raw)) return raw;
  if (raw) return registryHumanizeIdentifier(raw, direction);
  const purpose = registryPurposeLabel(direction, c);
  if (purpose && purpose !== 'Generic channel') return purpose;
  return registryHumanizeIdentifier(c?.id || fallback || (direction === 'input' ? 'Input' : 'Output'), direction);
}
function registryDefaultRange(direction, driver, role) {
  if (direction === 'input') {
    if (driver === 1 || driver === 9) return {min:0, max:4095};
    if (driver === 2) {
      if (role === 'speed') return {min:0, max:120000};
      if (role === 'flow') return {min:0, max:1000};
      return {min:0, max:10000};
    }
    if (driver === 3) return {min:1000, max:2000};
    if (driver === 7) return {min:0, max:1};
    return {min:0, max:1};
  }
  if (driver === 6) return {min:1000, max:2000};
  return {min:0, max:1};
}
function registryDefaultAnalogCalibration(role) {
  if (role === 'voltage') return {analog_zero_mv:0, analog_mv_per_unit:1000, analog_divider:11};
  if (role === 'speed') return {analog_zero_mv:0, analog_mv_per_unit:0.0066, analog_divider:1};
  if (role === 'pressure') return {analog_zero_mv:500, analog_mv_per_unit:400, analog_divider:1};
  if (role === 'temperature') return {analog_zero_mv:500, analog_mv_per_unit:10, analog_divider:1};
  if (role === 'flow') return {analog_zero_mv:0, analog_mv_per_unit:10, analog_divider:1};
  if (role === 'current') return {analog_zero_mv:1650, analog_mv_per_unit:100, analog_divider:1};
  if (role === 'torque' || role === 'thrust') return {analog_zero_mv:0, analog_mv_per_unit:10, analog_divider:1};
  return {analog_zero_mv:0, analog_mv_per_unit:1000, analog_divider:1};
}
function registryFormatValue(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : Number(0).toFixed(digits);
}
function registryParseValue(value) {
  return Number(String(value).replace(',', '.'));
}
function registryIsSwitchRole(role) {
  return ['digital_switch','fault','estop','inhibit_start','low_oil_switch','oil_zero_switch','sequence_gate','ab_arm','ab_fire','limp_mode'].includes(String(role || ''));
}
function registryAllowedDrivers(direction, role, purpose) {
  return registryPurposeDefinition(direction, purpose)?.drivers || (direction === 'input' ? [0,1,2,3,7] : [4,5,6]);
}
function registryPinMode(direction, driver) {
  if (direction === 'input') return Number(driver) === 1 ? 'adc' : 'in';
  return 'out';
}
function registryLoadCellIsHx711(c) {
  return ['torque','general_torque','thrust','general_thrust'].includes(registryDerivedPurpose('input', c || {})) && Number(c?.torque_interface || 0) === 1;
}
function registryTorqueInterfaceEditor(direction, c, index) {
  const purpose = registryDerivedPurpose(direction, c);
  if (direction !== 'input' || !['torque','general_torque','thrust','general_thrust'].includes(purpose)) return '';
  if (Number(c.driver) === 10) return '';
  const hx = registryLoadCellIsHx711(c);
  const unit = ['thrust','general_thrust'].includes(purpose) ? 'N' : 'Nm';
  const clk = Number(c.hx711_clk ?? -1);
  const scale = Number(c.hx711_scale ?? 1);
  const zero = Number(c.hx711_zero ?? 0);
  const clkClass = `${registryFieldChangedClass('input', index, 'hx711_clk')}${clk < 0 ? ' field-error' : ''}`;
  return `<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">Sensor interface</span><span class="hw-desc">Choose the sensor hardware actually connected. HX711 uses a bridge/load-cell amplifier with separate DOUT and SCK wires.</span><select onchange="updateRegistryChannel('input',${index},'torque_interface',+this.value)"><option value="0"${hx?'':' selected'}>Analog 0–3.3 V transmitter</option><option value="1"${hx?' selected':''}>HX711 load-cell amplifier</option></select></div>
    ${hx ? `<div class="hw-field"><span class="hw-label">HX711 SCK GPIO</span><span class="hw-desc">Clock output from the ECU to HX711 SCK.</span><select class="${clkClass}" onchange="updateRegistryChannel('input',${index},'hx711_clk',+this.value)">${buildPinOptions(clk,'out')}</select></div>
    <div class="hw-field"><span class="hw-label">HX711 scale (${unit}/count)</span><input type="number" min="0.000001" max="1000000" step="0.000001" value="${registryFormatValue(scale,6)}" oninput="updateRegistryChannel('input',${index},'hx711_scale',registryParseValue(this.value))"></div>
    <div class="hw-field"><span class="hw-label">HX711 zero count</span><input type="number" step="1" value="${Math.round(zero)}" oninput="updateRegistryChannel('input',${index},'hx711_zero',+this.value)"></div>` : ''}`;
}
function registryInvertEditor(direction, c, index) {
  if (direction === 'input') {
    if (['flame','ab_flame'].includes(registryDerivedPurpose(direction,c))) return '';
    const normalized = ['generic','throttle','idle','flame'].includes(registryDerivedPurpose(direction,c));
    if (!normalized || [0,8].includes(Number(c.driver))) return '';
    return `<div class="hw-field"><span class="hw-label">Input direction</span><span class="hw-desc">Reverse the normalized value after reading the electrical signal. A high input becomes 0.00 and a low input becomes 1.00.</span><label class="hw-toggle"><input type="checkbox" ${c.invert ? 'checked' : ''} onchange="updateRegistryChannel('input',${index},'invert',this.checked)"><span></span> Invert input</label></div>`;
  }
  if (outputDriverIsOnOff(c.driver)) {
    return `<div class="hw-field"><span class="hw-label">Output polarity</span><span class="hw-desc">Active high means GPIO HIGH energizes the output. Active low means GPIO LOW energizes it.</span><select onchange="updateRegistryChannel('${direction}',${index},'invert',this.value==='1')"><option value="0"${c.invert?'':' selected'}>Active high</option><option value="1"${c.invert?' selected':''}>Active low</option></select></div>`;
  }
  return `<div class="hw-field"><span class="hw-label">Output direction</span><span class="hw-desc">Reversed maps semantic 0% to the configured 100% electrical endpoint and semantic 100% to the 0% endpoint.</span><select onchange="updateRegistryChannel('${direction}',${index},'invert',this.value==='1')"><option value="0"${c.invert?'':' selected'}>Normal</option><option value="1"${c.invert?' selected':''}>Reversed</option></select></div>`;
}
function registryDemandEditor(c, index) {
  const safeChanged = registryFieldChangedClass('output', index, 'safe_demand');
  const safeInvalid = registryDemandProblem(c.safe_demand) ? ' field-error' : '';
  if (registryDerivedPurpose('output', c) === 'prop_pitch') {
    return `<div class="hw-field"><span class="hw-label">Power-up / standby pitch (%)</span><span class="hw-desc">Semantic 0% is fine/minimum load; 100% is coarse/maximum load. Inversion maps these meanings to physical travel. Running N2-feedback loss, Reduced-Power mode and fault always command 100% coarse.</span><input class="${safeChanged}${safeInvalid}" type="number" min="0" max="100" step="1" value="${Math.round(Number(c.safe_demand ?? 1)*100)}" oninput="updateRegistryChannel('output',${index},'safe_demand',(+this.value)/100)"></div>`;
  }
  if (registryCoreActuatorPurposeKey(c)) {
    return `<div class="hw-field"><span class="hw-label">Post-boot initialization demand</span><span class="hw-desc">Demand written after firmware gains control. Electrical reset and bootloader behavior still depends on external wiring and driver bias.</span><output>Off (fixed)</output></div>`;
  }
  if (outputDriverIsOnOff(c.driver)) {
    return `<div class="hw-field"><span class="hw-label">Post-boot initialization demand</span><span class="hw-desc">Written only after firmware gains control; it cannot guarantee the output during reset or bootloader time. Keep Off unless the attached hardware requires another initialized position.</span><select class="${safeChanged}${safeInvalid}" onchange="updateRegistryChannel('output',${index},'safe_demand',+this.value)"><option value="0"${Number(c.safe_demand||0)<0.5?' selected':''}>Off</option><option value="1"${Number(c.safe_demand||0)>=0.5?' selected':''}>On</option></select></div>`;
  }
  return `<div class="hw-field"><span class="hw-label">Power-on demand (%)</span><span class="hw-desc">Demand written while this general-purpose output is initialised. Keep 0% unless the attached hardware explicitly requires another boot position.</span><input class="${safeChanged}${safeInvalid}" type="number" min="0" max="100" step="1" value="${Math.round((c.safe_demand||0)*100)}" oninput="updateRegistryChannel('output',${index},'safe_demand',(+this.value)/100)"></div>`;
}
function registryFaultSafeEditor(c, index) {
  const purpose = registryDerivedPurpose('output', c);
  if (['main_fuel','fuel_shutoff','fuel_pump','pilot_fuel','igniter','ab_igniter',
       'ab_valve','ab_pump','glow_plug'].includes(purpose))
    return `<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">Running fault state</span><output>Combustion fuel and ignition are cut and held Off</output></div>`;
  if (purpose === 'prop_pitch')
    return `<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">Running fault state</span><output>100% coarse / maximum load (fixed)</output></div>`;
  const demand = Number(c.safe_demand || 0);
  const state = registryCoreActuatorKey(c) ? 'Off' : (outputDriverIsOnOff(c.driver) ? (demand >= .5 ? 'On' : 'Off') : `${Math.round(demand * 100)}%`);
  return `<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">Fault override</span><span class="hw-desc">Normally the shutdown sequence stays in control. Enable this only when this output must be held at its initialized demand (${escapeHtmlText(state)}) for the entire fault shutdown, regardless of sequence actions.</span><label class="hw-toggle"><input class="${registryFieldChangedClass('output',index,'force_safe_on_fault')}" type="checkbox" ${c.force_safe_on_fault ? 'checked' : ''} onchange="updateRegistryChannel('output',${index},'force_safe_on_fault',this.checked)"><span></span> Force initialized safe demand during fault shutdown</label></div>`;
}
function registryPwmTimingEditor(c, index) {
  if (Number(c.driver) !== 5) return '';
  const freq = Number(c.pwm_freq_hz ?? 5000);
  const bits = Number(c.pwm_res_bits ?? 10);
  const maxFreq = Math.min(100000, Math.floor(80000000 / (2 ** Math.max(8, Math.min(14, bits)))));
  const invalid = freq < 1 || freq > maxFreq || bits < 8 || bits > 14;
  const cls = invalid ? ' field-error' : '';
  return `<div class="hw-field"><span class="hw-label">PWM carrier frequency (Hz)</span><span class="hw-desc">Switching frequency for a MOSFET, motor driver or PWM-capable ESC. At ${bits} bits this ESP32 timer supports up to ${maxFreq} Hz.</span><input class="${registryFieldChangedClass('output',index,'pwm_freq_hz')}${cls}" type="number" min="1" max="${maxFreq}" step="1" value="${freq}" oninput="updateRegistryChannel('output',${index},'pwm_freq_hz',+this.value)"></div>
          <div class="hw-field"><span class="hw-label">PWM resolution (bits)</span><span class="hw-desc">Duty-cycle resolution from 8–14 bits. The editor shows the real frequency limit for the selected resolution.</span><input class="${registryFieldChangedClass('output',index,'pwm_res_bits')}${cls}" type="number" min="8" max="14" step="1" value="${bits}" oninput="updateRegistryChannel('output',${index},'pwm_res_bits',+this.value);renderRegistryInventory()"></div>`;
}
function registryRangeMeta(direction, driver, role, referenceMv = 3300) {
  const d = Number(driver);
  if (direction === 'input') {
    if (d === 0 || d === 8) return {hide:true, note:'Digital input reads inactive as 0.00 and active as 1.00. Choose the active electrical state below.'};
    if (d === 1 || d === 9) {
      const ref = d === 9 ? Math.max(1000,Math.min(5500,Number(referenceMv)||3300)) : 3300;
      const mv = {min:'Minimum valid signal (mV)', max:'Maximum valid signal (mV)', step:'0.1', scale:ref/4095, limitMin:0, limitMax:ref};
      if (role === 'temperature') return {...mv, note:`Measured voltage validity window. Physical output uses the mV per ${dispTempUnit()} calibration below.`};
      if (role === 'pressure') return {...mv, note:`Measured voltage validity window. Physical output uses mV per bar internally and displays system-wide as ${dispPressUnit()}.`};
      if (role === 'speed') return {...mv, note:'Measured voltage validity window. Physical output is RPM using the mV/RPM calibration below. Pulse/PCNT is preferred for N1/N2.'};
      if (role === 'voltage') return {...mv, note:'Measured ADC-pin voltage validity window. Battery/bus volts use the divider ratio below.'};
      return {...mv, note:'Measured voltage window accepted as healthy. Raw ADC counts remain available in diagnostics.'};
    }
    if (d === 2) {
      if (role === 'speed') return {min:'Minimum speed (RPM)', max:'Maximum speed (RPM)', step:'100', limitMin:0, limitMax:1000000000,
        note:'N1/N2 speed registry cards are claimed by the ESP32 PCNT RPM path, not the low-rate generic interrupt counter. Set pulses/rev below.'};
      if (role === 'flow') return {min:'Minimum flow (L/min)', max:'Maximum flow (L/min)', step:'0.01', limitMin:0,
        note:'Fuel-flow pulse cards use pulses/litre below; displayed flow is litres/min before any page-level unit conversion.'};
      return {min:'Minimum frequency (Hz)', max:'Maximum frequency (Hz)', step:'0.01', limitMin:0,
        note:'Generic pulse inputs are interrupt counted. For high-rate shaft RPM use the N1/N2 speed roles so the PCNT path is used.'};
    }
    if (d === 3) return {min:'Minimum pulse width (us)', max:'Maximum pulse width (us)', step:'0.01', limitMin:500, limitMax:2500};
    if (d === 7) return {min:'Minimum duty (%)', max:'Maximum duty (%)', step:'0.01', scale:100, limitMin:0, limitMax:100,
      note:'PWM duty is normalized across these endpoints. Frequency is detected automatically; use a clean 3.3 V logic signal.'};
  } else {
    if (d === 4) return {hide:true, note:'Relay output uses Off/On states. Use Output polarity for active-low relay boards.'};
    if (d === 5) return {min:'Duty at 0% command', max:'Duty at 100% command', step:'0.01', scale:100, limitMin:0, limitMax:100,
      note:'Electrical output endpoints. A pump minimum reliable-running calibration is a separate setting layered inside this range.'};
    if (d === 6) return {min:'Pulse at 0% command (us)', max:'Pulse at 100% command (us)', step:'0.01', limitMin:500, limitMax:2500,
      note:'Electrical pulse endpoints. Operational calibration does not rewrite these values.'};
  }
  return {min:'Minimum mapped value', max:'Maximum mapped value', step:'0.01'};
}
function registryRangeEditor(direction, c, index) {
  if (registryFixedProfileFunction(direction,c)) return '';
  if (direction === 'input' && registryLoadCellIsHx711(c)) return '';
  const purpose = registryDerivedPurpose(direction,c);
  const isSwitch = registryIsSwitchRole(c.role) || ['start_switch','stop_switch'].includes(purpose);
  if (direction === 'input' && Number(c.driver) === 1 && isSwitch) {
    const threshold = Math.max(0, Math.min(4095, Math.round(Number(c.digital_threshold_raw ?? 2048))));
    const maxHysteresis = Math.max(0, Math.min(2047, 2 * Math.min(threshold, 4095-threshold)));
    const hysteresis = Math.max(0, Math.min(maxHysteresis, Math.round(Number(c.digital_hysteresis_raw ?? 64))));
    return `<div class="hw-field"><span class="hw-label">Switch threshold (raw ADC)</span><span class="hw-desc">Use the guided inactive/active capture on <a href="/calibration.html#adc-switch-cal-row">Calibration</a>, or enter the raw threshold here.</span><input type="number" min="0" max="4095" step="1" value="${threshold}" oninput="updateRegistryChannel('input',${index},'digital_threshold_raw',+this.value)"></div>
      <div class="hw-field"><span class="hw-label">Switch hysteresis (raw ADC)</span><span class="hw-desc">Total deadband around the threshold; limited by the nearest ADC rail.</span><input type="number" min="0" max="${maxHysteresis}" step="1" value="${hysteresis}" oninput="updateRegistryChannel('input',${index},'digital_hysteresis_raw',+this.value)"></div>`;
  }
  if (direction === 'input' && Number(c.driver) === 3 && ['throttle','idle'].includes(purpose)) {
    const prefix = purpose === 'throttle' ? 'throttle' : 'idle';
    const fallbackMin = Number(c.min ?? 1000);
    const fallbackMax = Number(c.max ?? 2000);
    let min = Number(settingsCfg?.calibration?.[`${prefix}_min_raw`] ?? fallbackMin);
    let max = Number(settingsCfg?.calibration?.[`${prefix}_max_raw`] ?? fallbackMax);
    const standardFallback = min === 0 && max === 4095;
    if (standardFallback) { min = 1000; max = 2000; }
    return `<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">RC pulse calibration</span><span class="hw-desc">${standardFallback?'Uncalibrated ECU default':'Current ECU endpoints'}: ${registryFormatValue(min)}–${registryFormatValue(max)} µs. Calibrate this operator input on the <a href="/calibration.html#${prefix}-cal-row">Calibration page</a>; those endpoints are authoritative while running.</span></div>`;
  }
  if (direction === 'input' && Number(c.driver) === 2 && purpose === 'fuel_flow')
    return `<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">Flow conversion</span><span class="hw-desc">The dedicated pulse counter measures frequency and the pulses-per-litre value below converts it to L/min. No separate hidden flow range is applied.</span></div>`;
  if (direction === 'input' && [1,9].includes(Number(c.driver)) && ['flame','ab_flame'].includes(purpose)) {
    const threshold = Math.max(0, Math.min(4095, Math.round(Number(c.digital_threshold_raw ?? 2048))));
    const maxHysteresis = Math.max(0, Math.min(2047, 2 * Math.min(threshold, 4095 - threshold)));
    const hysteresis = Math.max(0, Math.min(maxHysteresis, Math.round(Number(c.digital_hysteresis_raw ?? 64))));
    const polarityClass = registryFieldChangedClass(direction, index, 'active_high');
    const hysteresisClass = registryFieldChangedClass(direction, index, 'digital_hysteresis_raw');
    const calAnchor = purpose === 'flame' ? 'flame-cal-row' : 'ab-flame-cal-row';
    const ariaPrefix = purpose === 'flame' ? 'Main' : 'AB';
    return `<div class="hw-field"><span class="hw-label">Flame active state</span><span class="hw-desc">Choose whether flame is reported above or below the calibrated threshold.</span><select class="${polarityClass}" onchange="updateRegistryChannel('input',${index},'active_high',this.value==='1')"><option value="1"${c.active_high !== false?' selected':''}>Above threshold</option><option value="0"${c.active_high === false?' selected':''}>Below threshold</option></select></div>
      <div class="hw-field"><span class="hw-label">Threshold and hysteresis</span><span class="hw-desc">Threshold: ${threshold} raw ADC, set on <a href="/calibration.html#${calAnchor}">Calibration</a>. Hysteresis is total deadband around it.</span><input class="${hysteresisClass}" aria-label="${ariaPrefix} flame hysteresis" type="number" min="0" max="${maxHysteresis}" step="1" value="${hysteresis}" oninput="updateRegistryChannel('input',${index},'digital_hysteresis_raw',+this.value)"></div>`;
  }
  if (direction === 'input' && Number(c.driver) === 2 && String(c.role) === 'speed')
    return `<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">Speed plausibility range</span><span class="hw-desc">Automatic: up to twice the applicable N1 or N2 hard shutdown speed set in Config. This avoids a second conflicting RPM limit here.</span></div>`;
  if (direction === 'input' && Number(c.driver) === 9 &&
      (registryIsSwitchRole(c.role) || ['start_switch','stop_switch'].includes(registryDerivedPurpose(direction,c)))) return '';
  if (direction === 'input' && String(c.role||'') === 'temperature' &&
      Number(c.temp_interface||0) !== 0) return '';
  const meta = registryRangeMeta(direction, c.driver, c.role, c.i2c_reference_mv);
  if (meta.hide) return `<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">Mapped value</span><span class="hw-desc">${escapeHtmlText(meta.note)}</span></div>`;
  const scale = Number(meta.scale || 1);
  const minAttr = meta.limitMin !== undefined ? ` min="${meta.limitMin}"` : '';
  const maxAttr = meta.limitMax !== undefined ? ` max="${meta.limitMax}"` : '';
  const problem = registryRangeProblem(c);
  const minClass = `${registryFieldChangedClass(direction, index, 'min')}${problem ? ' field-error' : ''}`;
  const maxClass = `${registryFieldChangedClass(direction, index, 'max')}${problem ? ' field-error' : ''}`;
  const desc = meta.note ? `<span class="hw-desc">${escapeHtmlText(meta.note)}</span>` : '';
  return `<div class="hw-field"><span class="hw-label">${escapeHtmlText(meta.min)}</span>${desc}<input class="${minClass}" type="number" inputmode="decimal"${minAttr}${maxAttr} step="${escapeHtmlText(meta.step || '0.01')}" value="${registryFormatValue((c.min ?? 0) * scale)}" oninput="updateRegistryRangeField('${direction}',${index},'min',registryParseValue(this.value),${scale})"></div>
          <div class="hw-field"><span class="hw-label">${escapeHtmlText(meta.max)}</span>${desc}<input class="${maxClass}" type="number" inputmode="decimal"${minAttr}${maxAttr} step="${escapeHtmlText(meta.step || '0.01')}" value="${registryFormatValue((c.max ?? 1) * scale)}" oninput="updateRegistryRangeField('${direction}',${index},'max',registryParseValue(this.value),${scale})"></div>`;
}
function registryPulseScaleEditor(direction, c, index) {
  if (direction !== 'input' || Number(c.driver) !== 2) return '';
  const role = String(c.role || '');
  const purpose = registryDerivedPurpose(direction,c);
  if (['generic','throttle','idle'].includes(purpose)) return '';
  const label = role === 'speed' ? 'Pulses / revolution' : (role === 'flow' ? 'Pulses / litre' : 'Pulses / unit');
  const desc = role === 'speed'
    ? 'Hall/VR conditioner pulses per shaft revolution. Used by the PCNT RPM path for N1/N2 speed cards.'
    : (role === 'flow' ? 'Flowmeter calibration. Flow is pulses/min divided by this value.' : 'Scale used by pulse input conversion.');
  const cls = `${registryFieldChangedClass(direction, index, 'pulses_per_unit')}${Number(c.pulses_per_unit ?? 1) <= 0 ? ' field-error' : ''}`;
  return `<div class="hw-field"><span class="hw-label">${escapeHtmlText(label)}</span><span class="hw-desc">${escapeHtmlText(desc)}</span><input class="${cls}" type="number" min="0.001" step="0.001" value="${registryFormatValue(c.pulses_per_unit ?? 1)}" oninput="updateRegistryChannel('${direction}',${index},'pulses_per_unit',registryParseValue(this.value))"></div>`;
}
function registryAnalogScaleEditor(direction, c, index) {
  if (registryFixedProfileFunction(direction,c)) return '';
  if (direction !== 'input' || ![1,9].includes(Number(c.driver))) return '';
  if (registryLoadCellIsHx711(c)) return '';
  if (registryIsSwitchRole(c.role) ||
      ['start_switch','stop_switch'].includes(registryDerivedPurpose(direction,c))) return '';
  if (String(c.role||'') === 'temperature' && Number(c.temp_interface||0) !== 0) return '';
  if (Array.isArray(c.calibration_points) && c.calibration_points.length >= 2)
    return `<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">Analog conversion</span><span class="hw-desc">The multi-point sensor curve below is authoritative. Choose Use linear calibration there to edit the normal offset/scale fields again.</span></div>`;
  const role = String(c.role || '');
  if (role === 'generic' || role === 'operator' || role === 'flame') return '';
  const cal = registryDefaultAnalogCalibration(role);
  if (role === 'voltage') {
    const cls = `${registryFieldChangedClass(direction, index, 'analog_divider')}${Number(c.analog_divider ?? cal.analog_divider) < 1 ? ' field-error' : ''}`;
    return `<div class="hw-field"><span class="hw-label">Voltage divider ratio</span><span class="hw-desc">Battery volts = ADC pin volts × this ratio. Example: 100k/10k divider is 11.0.</span><input class="${cls}" type="number" min="1" max="100" step="0.01" value="${registryFormatValue(c.analog_divider ?? cal.analog_divider)}" oninput="updateRegistryChannel('${direction}',${index},'analog_divider',registryParseValue(this.value))"></div>`;
  }
  const unit = role === 'speed' ? 'RPM' : role === 'pressure' ? 'bar' : role === 'temperature' ? '°C' : role === 'flow' ? 'L/min' : role === 'current' ? 'A' : role === 'torque' ? 'Nm' : role === 'thrust' ? 'N' : 'unit';
  const zeroClass = registryFieldChangedClass(direction, index, 'analog_zero_mv');
  const scaleClass = `${registryFieldChangedClass(direction, index, 'analog_mv_per_unit')}${Number(c.analog_mv_per_unit ?? cal.analog_mv_per_unit) <= 0 ? ' field-error' : ''}`;
  const scaleDigits = role === 'speed' ? 4 : 3;
  const scaleStep = role === 'speed' ? '0.0001' : '0.001';
  return `<div class="hw-field"><span class="hw-label">Zero offset (mV)</span><span class="hw-desc">Sensor output voltage at 0 ${escapeHtmlText(unit)}.</span><input class="${zeroClass}" type="number" min="0" max="3300" step="0.1" value="${registryFormatValue(c.analog_zero_mv ?? cal.analog_zero_mv)}" oninput="updateRegistryChannel('${direction}',${index},'analog_zero_mv',registryParseValue(this.value))"></div>
          <div class="hw-field"><span class="hw-label">mV per ${escapeHtmlText(unit)}</span><span class="hw-desc">Physical value = (ADC mV - zero offset) / this factor.</span><input class="${scaleClass}" type="number" min="0.000001" step="${scaleStep}" value="${registryFormatValue(c.analog_mv_per_unit ?? cal.analog_mv_per_unit, scaleDigits)}" oninput="updateRegistryChannel('${direction}',${index},'analog_mv_per_unit',registryParseValue(this.value))"></div>`;
}
function registryTemperatureIsSpi(c) {
  const iface = Number(c?.temp_interface || 0);
  return String(c?.role || '') === 'temperature' && iface >= 1 && iface <= 3;
}
function registryTemperatureIsDigital(c) {
  const iface = Number(c?.temp_interface || 0);
  return String(c?.role || '') === 'temperature' && [1,2,3,5].includes(iface);
}
function registrySignalTypeEditor(direction, c, index, driverClass) {
  if (direction === 'input' && registryTemperatureIsDigital(c)) {
    const signal = Number(c.temp_interface) === 5 ? 'Digital / OneWire' : 'Digital / SPI';
    return `<div class="hw-field"><span class="hw-label">Signal type</span><span class="hw-desc">Set by the selected digital temperature-sensor interface.</span><select class="${driverClass}" disabled><option selected>${signal}</option></select></div>`;
  }
  return `<div class="hw-field"><span class="hw-label">Signal type</span><span class="hw-desc">The electrical signal connected to this device.</span><select class="${driverClass}" onchange="updateRegistryChannel('${direction}',${index},'driver',+this.value)">${registryDriverOptions(direction, c.driver, c.role, registryDerivedPurpose(direction,c))}</select></div>`;
}
function registryInputPinLabel(c) {
  if (registryLoadCellIsHx711(c)) return 'HX711 DOUT GPIO';
  if (String(c?.role||'') === 'temperature') {
    if (Number(c.temp_interface) === 5) return 'OneWire data GPIO';
    if ([0,4].includes(Number(c.temp_interface||0))) return 'ADC GPIO';
  }
  return 'GPIO pin';
}
function registryTemperatureInterfaceEditor(c, index) {
  if (String(c.role||'') !== 'temperature' || Number(c.driver) !== 1) return '';
  const iface = Number(c.temp_interface || 0), purpose = registryDerivedPurpose('input',c);
  const oil = purpose === 'oil_temperature', coolant = purpose === 'coolant_temp';
  const general = purpose === 'general_temperature';
  const lowTemperature = oil || coolant || purpose === 'intake_temperature' || general;
  const turbineGas = purpose === 'tot' || purpose === 'tit';
  const option = (n,label) => `<option value="${n}"${iface===n?' selected':''}>${label}</option>`;
  const pin = (key, mode) => {
    const busMode = mode;
    const pinClass = `${registryFieldChangedClass('input', index, key)}${Number(c[key] ?? -1) < 0 ? ' field-error' : ''}`;
    return `<div class="hw-field"><span class="hw-label">${key.replace('spi_','').toUpperCase()} GPIO</span><span class="hw-desc">Dedicated chip-select output for this sensor on the shared SPI bus.</span><select class="${pinClass}" onchange="updateRegistryChannel('input',${index},'${key}',+this.value)">${buildPinOptions(c[key] ?? -1, busMode)}</select></div>`;
  };
  let choices = `${option(0,'Analog temperature transmitter')}`;
  if (turbineGas || oil || general) choices += `${option(1,'MAX6675 (K-type)')}${option(2,'MAX31855 (K-type)')}${option(3,'MAX31856 (configurable TC type)')}`;
  if (lowTemperature) choices += `${option(4,'NTC thermistor (ADC divider)')}${option(5,'DS18B20 (OneWire)')}`;
  const heading = iface >= 1 && iface <= 3
    ? 'Dedicated turbine-rated thermocouple amplifier on the shared SPI bus. Every sensor needs its own CS GPIO.'
    : lowTemperature ? 'Choose the actual low-temperature sensor interface. NTC and DS18B20 must never be used for turbine-gas temperatures.'
    : 'Calibrated analog transmitter. Choose a MAX thermocouple amplifier for turbine-gas temperature probes.';
  let details = '';
  if (iface >= 1 && iface <= 3) details = `<div class="hw-field"><span class="hw-label">Shared SPI bus</span><span class="hw-desc">${cfg.spi?.enabled ? `SCK GPIO ${Number(cfg.spi.sck_pin ?? -1)}, MISO GPIO ${Number(cfg.spi.miso_pin ?? -1)}${iface===3?`, MOSI GPIO ${Number(cfg.spi.mosi_pin ?? -1)}`:''}. Change these once under Shared sensor buses.` : 'SPI bus is disabled. Enable it under Shared sensor buses before this device can work.'}</span></div>${pin('spi_cs','out')}${iface===3?`<div class="hw-field"><span class="hw-label">Thermocouple type</span><span class="hw-desc">Select the probe alloy fitted to this MAX31856 channel.</span><select onchange="updateRegistryChannel('input',${index},'tc_type',this.value)">${['K','J','N','T','E','R','S','B'].map(v=>`<option value="${v}"${String(c.tc_type||'K')===v?' selected':''}>${v}</option>`).join('')}</select></div>`:''}`;
  if (iface === 4) details = `<div class="hw-field"><span class="hw-label">Divider orientation</span><span class="hw-desc">This is the external calibrated resistor, not an internal GPIO pull.</span><select onchange="updateRegistryChannel('input',${index},'ntc_pullup',this.value==='1')"><option value="1"${c.ntc_pullup!==false?' selected':''}>Fixed resistor to 3.3 V, NTC to ground</option><option value="0"${c.ntc_pullup===false?' selected':''}>NTC to 3.3 V, fixed resistor to ground</option></select></div><div class="hw-field"><span class="hw-label">NTC beta coefficient</span><span class="hw-desc">Beta value from the thermistor datasheet, normally specified between 25 °C and 50 °C.</span><input type="number" min="1" step="1" value="${registryFormatValue(c.ntc_beta ?? 3950)}" oninput="updateRegistryChannel('input',${index},'ntc_beta',registryParseValue(this.value))"></div><div class="hw-field"><span class="hw-label">NTC resistance at 25 °C (Ω)</span><span class="hw-desc">Nominal thermistor resistance at 25 °C from its datasheet.</span><input type="number" min="1" step="1" value="${registryFormatValue(c.ntc_r0 ?? 10000)}" oninput="updateRegistryChannel('input',${index},'ntc_r0',registryParseValue(this.value))"></div><div class="hw-field"><span class="hw-label">Fixed divider resistor (Ω)</span><span class="hw-desc">Measured value of the external fixed resistor paired with the thermistor.</span><input type="number" min="1" step="1" value="${registryFormatValue(c.ntc_r_fixed ?? 10000)}" oninput="updateRegistryChannel('input',${index},'ntc_r_fixed',registryParseValue(this.value))"></div>`;
  if (iface === 5) details = `<div class="hw-field"><span class="hw-label">DS18B20 resolution</span><span class="hw-desc">Uses one data GPIO and an external 4.7 kΩ pull-up to 3.3 V. The 10-bit default updates in about 188 ms; higher resolution is slower.</span><select onchange="updateRegistryChannel('input',${index},'temp_resolution',+this.value)">${[9,10,11,12].map(v=>`<option value="${v}"${Number(c.temp_resolution ?? 10)===v?' selected':''}>${v}-bit</option>`).join('')}</select></div>`;
  return `<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">Sensor interface</span><span class="hw-desc">${heading}</span><select onchange="updateRegistryChannel('input',${index},'temp_interface',+this.value)">${choices}</select></div>${details}`;
}
function registryInputOptionsEditor(direction, c, index) {
  if (direction !== 'input') return '';
  if (registryLoadCellIsHx711(c)) return `<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">HX711 wiring</span><span class="hw-desc">DOUT is an input and SCK is an output. No internal pull-up or pull-down is applied.</span></div>`;
  const d = Number(c.driver);
  const purpose = registryDerivedPurpose(direction,c);
  const activeStateEditor = (d === 8 || ([1,9].includes(d) &&
      (registryIsSwitchRole(c.role) || ['start_switch','stop_switch'].includes(purpose))))
    ? `<div class="hw-field"><span class="hw-label">Active state</span><span class="hw-desc">Choose which electrical level means On, active, or flame present.</span><select class="${registryFieldChangedClass('input', index, 'active_high')}" onchange="updateRegistryChannel('input',${index},'active_high',this.value==='1')"><option value="1"${c.active_high !== false ? ' selected' : ''}>High / above threshold is On</option><option value="0"${c.active_high === false ? ' selected' : ''}>Low / below threshold is On</option></select></div>`
    : '';
  if (d === 1) {
    if (registryTemperatureIsSpi(c)) return '';
    if (String(c.role||'') === 'temperature' && Number(c.temp_interface||0) === 5)
      return `<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">OneWire wiring</span><span class="hw-desc">Use an external 4.7 kΩ pull-up to 3.3 V. Internal pull-up/down is not used for a DS18B20 bus.</span></div>`;
    return `${activeStateEditor}<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">Input bias</span><span class="hw-desc">ADC inputs leave internal pull-up and pull-down resistors disabled so the analog reading is not biased.</span></div>`;
  }
  if (d !== 0 && d !== 2) return `${activeStateEditor}<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">Input bias</span><span class="hw-desc">This driven signal does not use the ESP32 internal pull-up or pull-down.</span></div>`;
  const polarityClass = registryFieldChangedClass(direction, index, 'active_high');
  const pullupClass = registryFieldChangedClass(direction, index, 'pullup');
  const pulldownClass = registryFieldChangedClass(direction, index, 'pulldown');
  const pullConflict = c.pullup && c.pulldown ? ' field-error' : '';
  const polarity = d === 0 ? `<div class="hw-field"><span class="hw-label">Active polarity</span><select class="${polarityClass}" onchange="updateRegistryChannel('input',${index},'active_high',this.value==='1')"><option value="1"${c.active_high !== false ? ' selected' : ''}>Active HIGH</option><option value="0"${c.active_high === false ? ' selected' : ''}>Active LOW</option></select></div>` : '';
  return `${polarity}
          <div class="hw-field"><span class="hw-label">Input bias</span><span class="hw-desc">Use one internal resistor for a plain switch or pulse sensor. Active LOW normally uses pull-up; active HIGH normally uses pull-down.</span><div class="hw-toggle-row">
            <label class="hw-toggle"><input class="${pullupClass}${pullConflict}" type="checkbox" ${c.pullup ? 'checked' : ''} onchange="updateRegistryChannel('input',${index},'pullup',this.checked)"><span></span> Pull-up</label>
            <label class="hw-toggle"><input class="${pulldownClass}${pullConflict}" type="checkbox" ${c.pulldown ? 'checked' : ''} onchange="updateRegistryChannel('input',${index},'pulldown',this.checked)"><span></span> Pull-down</label>
          </div></div>`;
}
function updateRegistryRangeField(direction, index, key, value, scale) {
  updateRegistryChannel(direction, index, key, Number(value) / Number(scale || 1));
}
function registryCoreActuatorPurposeKey(c) {
  const id = String(c?.id || '');
  const purpose = registryDerivedPurpose('output',c);
  const purposeMap = {
    main_fuel:'throttle', starter:'starter', starter_enable:'starter_en', fuel_shutoff:'fuel_sol',
    igniter:'igniter', ab_igniter:'igniter2', oil_pump:'oil_pump', scavenge_pump:'oil_scavenge_pump',
    cooling_fan:'cool_fan', fuel_pump:'fuel_pump2', ab_pump:'ab_pump', prop_pitch:'prop_pitch',
    glow_plug:'glow_plug', air_starter:'airstarter_sol'
  };
  if (purposeMap[purpose]) return purposeMap[purpose];
  const map = {
    main_fuel:'throttle', main_fuel_output:'throttle',
    starter:'starter', starter_main:'starter', main_starter:'starter',
    starter_enable:'starter_en',
    fuel_shutoff:'fuel_sol', main_fuel_shutoff:'fuel_sol',
    igniter:'igniter', ab_igniter:'igniter2', igniter2_main:'igniter2',
    oil_pump:'oil_pump', oil_pump_main:'oil_pump',
    scavenge_pump:'oil_scavenge_pump', oil_scavenge_main:'oil_scavenge_pump',
    cooling_fan:'cool_fan', cooling_fan_main:'cool_fan',
    fuel_pump:'fuel_pump2', ab_pump:'ab_pump',
    bleed_valve:'bleed_valve', bleed_valve_main:'bleed_valve',
    prop_pitch:'prop_pitch', glow_plug:'glow_plug',
    ab_solenoid:'ab_sol', air_starter:'airstarter_sol'
  };
  if (map[id]) return map[id];
  return '';
}
function registryOutputOwnsCorePurpose(c) {
  if (!c) return false;
  const purpose = registryDerivedPurpose('output', c);
  if (!registryCoreActuatorPurposeKey(c)) return false;
  const rows = registryRoot().outputs || [];
  const bindingKey = ({main_fuel:'main_fuel_output',fuel_shutoff:'main_fuel_shutoff',starter:'main_starter',
    starter_enable:'starter_enable_output',oil_pump:'primary_oil_pump',scavenge_pump:'primary_scavenge_pump',
    cooling_fan:'primary_cooling_fan',bleed_valve:'primary_bleed_valve',fuel_pump:'primary_aux_fuel_pump',
    igniter:'primary_igniter',ab_igniter:'primary_secondary_igniter',ab_valve:'primary_ab_valve',
    glow_plug:'primary_glow_plug',ab_pump:'primary_ab_pump',prop_pitch:'primary_prop_pitch',
    air_starter:'primary_air_starter'})[purpose];
  const bound = bindingKey && (registryRoot().bindings || []).find(b => String(b?.key || '') === bindingKey);
  if (bound) return String(bound.channel || '') === String(c.id || '');
  if (REGISTRY_CORE_OUTPUT_IDS.has(String(c.id || ''))) return true;
  const peers = rows.filter(row => registryDerivedPurpose('output', row) === purpose);
  const canonical = peers.find(row => REGISTRY_CORE_OUTPUT_IDS.has(String(row?.id || '')));
  return canonical ? canonical === c : peers.length === 1 && peers[0] === c;
}
function registryCoreActuatorKey(c) {
  return registryOutputOwnsCorePurpose(c) ? registryCoreActuatorPurposeKey(c) : '';
}
function registryPinIsAdc(pin) {
  const p = Number(pin);
  return p >= 0 && !!GPIO_DB?.[p]?.adc1;
}
const REGISTRY_CORE_INPUT_IDS = new Set([
  'n1_main','primary_n1','n2_main','primary_n2','tot_main','primary_egt',
  'oil_pressure_main','p1_main','p1','p2_main','p2','operator_throttle','operator_idle',
  'battery_voltage','batt_voltage_main','ab_flame_main'
]);
const REGISTRY_CORE_OUTPUT_IDS = new Set([
  'main_fuel_output','main_fuel',
  'main_starter','starter','starter_main',
  'starter_enable',
  'oil_pump','oil_pump_main',
  'cooling_fan','cooling_fan_main',
  'oil_scavenge_main','scavenge_pump',
  'bleed_valve','bleed_valve_main',
  'igniter','ab_igniter','igniter2_main',
  'main_fuel_shutoff','fuel_shutoff',
  'ab_solenoid','air_starter','fuel_pump','ab_pump','prop_pitch','glow_plug'
]);
const REGISTRY_CORE_OUTPUT_BINDING_KEYS = new Set([
  'main_fuel_output','main_fuel_shutoff','main_starter','starter_enable_output','primary_oil_pump',
  'primary_scavenge_pump','primary_cooling_fan','primary_bleed_valve','primary_aux_fuel_pump',
  'primary_igniter','primary_secondary_igniter','primary_ab_valve','primary_glow_plug','primary_ab_pump',
  'primary_prop_pitch','primary_air_starter'
]);
function registryIsCoreManagedInput(c) {
  const purpose = registryDerivedPurpose('input', c);
  const keyMap = {
    n1_speed:'n1_rpm', n2_speed:'n2_rpm', tot:'tot', tit:'tit', oil_pressure:'oil_press',
    oil_temperature:'oil_temp', fuel_pressure:'fuel_press', p1_pressure:'p1', p2_pressure:'p2',
    flame:'flame', fuel_flow:'fuel_flow', torque:'torque', battery_voltage:'batt_voltage',
    throttle:'throttle_input', idle:'idle_input'
  };
  const runtimeSensor = cfg.sensors?.[keyMap[purpose]];
  if (!runtimeSensor?.enabled) return false;
  if (purpose === 'torque' && registryLoadCellIsHx711(c)) {
    return !!(runtimeSensor.hx711 && Number(runtimeSensor.dt_pin) === Number(c.pin) &&
      Number(runtimeSensor.clk_pin) === Number(c.hx711_clk));
  }
  if (Number(c?.temp_interface || 0) > 0) {
    return Number(runtimeSensor.clk) === Number(c.spi_clk) && Number(runtimeSensor.cs) === Number(c.spi_cs) &&
      Number(runtimeSensor.miso) === Number(c.spi_miso);
  }
  return Number(runtimeSensor.pin) === Number(c?.pin);
}
function registryIsCoreManagedOutput(c) {
  const purpose = registryDerivedPurpose('output',c);
  const keyMap = {
    main_fuel:'throttle', fuel_shutoff:'fuel_sol', starter:'starter', starter_enable:'starter_en',
    oil_pump:'oil_pump', scavenge_pump:'oil_scavenge_pump', cooling_fan:'cool_fan',
    fuel_pump:'fuel_pump2', igniter:'igniter', ab_igniter:'igniter2', glow_plug:'glow_plug',
    ab_pump:'ab_pump', prop_pitch:'prop_pitch', air_starter:'airstarter_sol'
  };
  const runtimeActuator = cfg.actuators?.[keyMap[purpose]];
  return !!(runtimeActuator?.enabled && Number(runtimeActuator.pin) === Number(c?.pin));
}
function ensureActuatorObject(key) {
  if (!cfg.actuators) cfg.actuators = {};
  if (!cfg.actuators[key]) cfg.actuators[key] = {};
  return cfg.actuators[key];
}
function setCoreActuatorCurrentEnabled(actKey, enabled) {
  const act = ensureActuatorObject(actKey);
  if (!enabled && (actKey === 'igniter' || actKey === 'igniter2') && act.coil) {
    act.coil = false;
    act.pwm = true;
  }
  act.has_current = !!enabled;
  if (enabled && (act.current_mv_a === undefined || act.current_mv_a <= 0)) act.current_mv_a = actKey === 'glow_plug' ? 185 : 100;
  if (enabled && act.current_zero_v === undefined) act.current_zero_v = 1.65;
  if (enabled && actKey === 'glow_plug' && act.current_ready_a === undefined) act.current_ready_a = 3;
  if (!enabled) act.current_pin = -1;
  refreshAllPins(); dirty(); updateSaveButton(); renderRegistryInventory();
}
function setCoreIgniterMode(actKey, mode) {
  const act = ensureActuatorObject(actKey);
  act.pwm = mode === 'pwm';
  act.coil = mode === 'coil';
  if (mode === 'coil') {
    act.has_current = true;
    if (act.coil_sat_a === undefined) act.coil_sat_a = 8;
    if (act.current_mv_a === undefined) act.current_mv_a = 100;
    if (act.current_zero_v === undefined) act.current_zero_v = 1.65;
  }
  dirty(); refreshAllPins(); updateSaveButton(); renderRegistryInventory();
}
function ensureRegistryIgnitionProfileDefaults(c, actKey) {
  const act = actKey ? ensureActuatorObject(actKey) : {};
  const purpose = registryDerivedPurpose('output', c);
  const legacyGlow = settingsCfg?.glow_plug || {};
  c.ignition_mode ??= act.coil ? 2 : act.pwm ? 1 : 0;
  c.ignition_dwell_ms ??= Number(act.dwell_ms ?? 6);
  c.ignition_rest_ms ??= Number(act.rest_ms ?? 3);
  c.ignition_coil_sat_a ??= Number(act.coil_sat_a ?? 8);
  c.ignition_preheat_ms ??= purpose === 'glow_plug' ? Number(legacyGlow.preheat_ms ?? 10000) : 3000;
  c.ignition_peak_demand ??= purpose === 'glow_plug' ? Number(legacyGlow.preheat_max_pct ?? 80) / 100 : .8;
  c.ignition_hold_demand ??= purpose === 'glow_plug' ? Number(legacyGlow.hold_pct ?? 30) / 100 : .3;
  c.ignition_wait_hot ??= purpose === 'glow_plug' ? !!legacyGlow.wait_until_hot : false;
  c.ignition_hot_timeout_ms ??= 30000;
}
function registryCurrentEditor(direction, c, index) {
  if (direction !== 'output') return '';
  const actKey = registryCoreActuatorKey(c);
  const dedicated = ['oil_pump','glow_plug','igniter','igniter2'].includes(actKey);
  const act = dedicated ? ensureActuatorObject(actKey) : null;
  const enabled = dedicated ? !!act.has_current : !!c.has_current;
  const setEnabled = dedicated
    ? `setCoreActuatorCurrentEnabled('${actKey}',this.checked)`
    : `updateRegistryChannel('output',${index},'has_current',this.checked)`;
  const pin = dedicated ? act.current_pin : c.current_pin;
  const mvA = dedicated ? (act.current_mv_a ?? (actKey === 'glow_plug' ? 185 : 100)) : (c.current_mv_a ?? 100);
  const zeroV = dedicated ? (act.current_zero_v ?? 1.65) : (c.current_zero_v ?? 1.65);
  const maxA = dedicated ? (act.current_max_a ?? 0) : (c.current_max_a ?? 0);
  const readyA = dedicated ? (act.current_ready_a ?? 3) : (c.current_ready_a ?? 3);
  const tripDelay = dedicated ? (act.current_trip_delay_ms ?? 5000) : (c.current_trip_delay_ms ?? 5000);
  const fieldSet = dedicated
    ? (field, expr) => `setActCurrentSensor('${actKey}','${field}',${expr})`
    : (field, expr) => {
        const keyMap = {pin:'current_pin', mv_a:'current_mv_a', zero_v:'current_zero_v', ready_a:'current_ready_a', current_max_a:'current_max_a', current_trip_delay_ms:'current_trip_delay_ms'};
        return `updateRegistryChannel('output',${index},'${keyMap[field] || field}',${expr})`;
      };
  return `<div class="hw-item-card registry-subcard" style="grid-column:1/-1;margin:.35rem 0 0">
    <div class="registry-card-summary">
      <div><strong>Current sensing</strong><div class="hw-desc">${dedicated ? 'Feeds dedicated telemetry, rules, logging and protection for this actuator. Enter datasheet values here or use its live wizard on the <a href="/calibration.html">Calibration page</a>.' : 'Samples this output current and exposes it in registry telemetry. Zero voltage and sensitivity below are this sensor’s calibration.'}</div></div>
      <label class="hw-toggle"><input type="checkbox" ${enabled ? 'checked' : ''} onchange="${setEnabled}"><span></span> Enable</label>
    </div>
    ${enabled ? `<div class="registry-card-editor" style="display:block"><div class="hw-grid">
      <div class="hw-field"><span class="hw-label">Current sensor ADC GPIO</span><span class="hw-desc">ADC-capable GPIO connected to the current sensor output.</span><select onchange="${fieldSet('pin','+this.value')}">${buildPinOptions(pin, 'adc')}</select></div>
      <div class="hw-field"><span class="hw-label">Sensor sensitivity (mV/A)</span><span class="hw-desc">Datasheet sensitivity at the ECU ADC pin. Example: ACS712-20A = 100 mV/A.</span><input type="number" min="1" max="10000" step="1" value="${registryFormatValue(mvA)}" oninput="${fieldSet('mv_a','+this.value')}"></div>
      <div class="hw-field"><span class="hw-label">Zero-current voltage (V)</span><span class="hw-desc">Sensor output voltage when no current flows.</span><input type="number" min="0" max="3.3" step="0.01" value="${registryFormatValue(zeroV)}" oninput="${fieldSet('zero_v','+this.value')}"></div>
       ${registryDerivedPurpose('output',c) === 'glow_plug' ? `<div class="hw-field"><span class="hw-label">Ready current (A)</span><span class="hw-desc">This plug is considered hot when its measured current falls to or below this value after preheat.</span><input type="number" min="0" max="1000" step="0.1" value="${registryFormatValue(readyA)}" oninput="${fieldSet('ready_a','+this.value')}"></div>` : ''}
       <div class="hw-field"><span class="hw-label">Overcurrent shutdown (A)</span><span class="hw-desc">Warn immediately and shut down if this output remains above the limit. 0 disables this output's overcurrent trip.</span><input type="number" min="0" max="1000" step="0.1" value="${registryFormatValue(maxA)}" oninput="${fieldSet('current_max_a','+this.value')}"></div>
       <div class="hw-field"><span class="hw-label">Overcurrent confirmation (ms)</span><span class="hw-desc">Current must remain continuously above the limit for this long before the ECU shuts down. Shorter spikes are ignored.</span><input type="number" min="100" max="60000" step="100" value="${Math.round(Number(tripDelay))}" oninput="${fieldSet('current_trip_delay_ms','+this.value')}"></div>
    </div></div>` : ''}
  </div>`;
}
function registryIgniterSubcards(c, index, actKey) {
  ensureRegistryIgnitionProfileDefaults(c, actKey);
  const simpleOnly = [4,11].includes(Number(c.driver));
  const mode = simpleOnly ? 0 : Number(c.ignition_mode || 0);
  return `<div class="hw-item-card registry-subcard" style="grid-column:1/-1;margin:.35rem 0 0">
    <div class="registry-card-summary"><div><strong>Igniter behavior for this device</strong><div class="hw-desc">${simpleOnly ? 'This relay-style output is a simple on/off igniter. An external ignition module may enforce its own dwell.' : 'These dwell and coil settings belong only to this fitted igniter.'}</div></div></div>
    <div class="registry-card-editor" style="display:block"><div class="hw-grid">
      <div class="hw-field"><span class="hw-label">Igniter mode</span><span class="hw-desc">Choose how this physical output is driven whenever a sequence, subsystem, or custom controller commands it on.</span><select onchange="updateRegistryChannel('output',${index},'ignition_mode',+this.value)">
        <option value="0"${mode===0?' selected':''}>Simple on/off</option>
        ${simpleOnly ? '' : `<option value="1"${mode===1?' selected':''}>Dwell / rest PWM cycle</option>
        <option value="2"${mode===2?' selected':''}>Current-limited coil dwell</option>`}
      </select></div>
      ${mode !== 0 ? `<div class="hw-field"><span class="hw-label">Dwell time (ms)</span><span class="hw-desc">Maximum energized time in each ignition cycle.</span><input type="number" min="1" max="200" value="${Number(c.ignition_dwell_ms)}" oninput="updateRegistryChannel('output',${index},'ignition_dwell_ms',+this.value)"></div>
      <div class="hw-field"><span class="hw-label">Rest time (ms)</span><span class="hw-desc">Output-off cooling time between dwell pulses.</span><input type="number" min="1" max="200" value="${Number(c.ignition_rest_ms)}" oninput="updateRegistryChannel('output',${index},'ignition_rest_ms',+this.value)"></div>` : ''}
      ${mode === 2 ? `<div class="hw-field"><span class="hw-label">Coil saturation current (A)</span><span class="hw-desc">Current feedback may end a charge early; dwell time remains the hard safety cap.</span><input type="number" min="0.1" max="1000" step="0.1" value="${registryFormatValue(c.ignition_coil_sat_a)}" oninput="updateRegistryChannel('output',${index},'ignition_coil_sat_a',+this.value)"></div>` : ''}
      <div class="hw-field"><span class="hw-label">Pre-heat step duration (ms)</span><span class="hw-desc">Used when a Pre-Heat sequence block selects this igniter. Ordinary Igniter On/Off steps are unaffected.</span><input type="number" min="0" max="3600000" step="100" value="${Number(c.ignition_preheat_ms)}" oninput="updateRegistryChannel('output',${index},'ignition_preheat_ms',+this.value)"></div>
    </div></div>
  </div>`;
}
function registryGlowSubcards(c, index) {
  const actKey = registryCoreActuatorKey(c);
  ensureRegistryIgnitionProfileDefaults(c, actKey);
  const act = ensureActuatorObject('glow_plug');
  const wet = Number(act.type || 0) === 2;
  const fuelType = Number(act.fuel_type || 0);
  const fuelDelayS = Math.max(0, Number(act.fuel_delay_ms ?? 8000) / 1000);
  const relay = outputDriverIsOnOff(c.driver);
  return `<div class="hw-item-card registry-subcard" style="grid-column:1/-1;margin:.35rem 0 0">
    <div class="registry-card-summary"><div><strong>Glow-plug type and ignition behavior</strong><div class="hw-desc">Wet glow includes its own pilot-fuel hardware in this device. A separately added Pilot Fuel output remains independent.</div></div></div>
    <div class="registry-card-editor" style="display:block"><div class="hw-grid">
      <div class="hw-field"><span class="hw-label">Glow-plug type</span><span class="hw-desc">Wet glow turns on its own pilot fuel after the configured delay whenever the glow plug is commanded on.</span><select onchange="setRegistryGlowType(+this.value)"><option value="0"${!wet?' selected':''}>Normal glow plug</option><option value="2"${wet?' selected':''}>Wet glow plug</option></select></div>
      <div class="hw-field"><span class="hw-label">Preheat duration (ms)</span><span class="hw-desc">Time for Glow Preheat to ramp this plug before holding.</span><input type="number" min="0" max="3600000" step="100" value="${Number(c.ignition_preheat_ms)}" oninput="updateRegistryChannel('output',${index},'ignition_preheat_ms',+this.value)"></div>
      ${relay ? '' : `<div class="hw-field"><span class="hw-label">Peak command (%)</span><span class="hw-desc">Highest command reached at the end of the preheat ramp.</span><input type="number" min="0" max="100" value="${Math.round(Number(c.ignition_peak_demand)*100)}" oninput="updateRegistryChannel('output',${index},'ignition_peak_demand',+this.value/100)"></div>
      <div class="hw-field"><span class="hw-label">Hold command (%)</span><span class="hw-desc">Command retained after preheat until another owner turns this plug off.</span><input type="number" min="0" max="100" value="${Math.round(Number(c.ignition_hold_demand)*100)}" oninput="updateRegistryChannel('output',${index},'ignition_hold_demand',+this.value/100)"></div>`}
      <div class="hw-field"><span class="hw-label">Hot confirmation</span><span class="hw-desc">Optionally wait for this device's own current feedback after the preheat ramp.</span><label class="hw-toggle"><input type="checkbox" ${c.ignition_wait_hot?'checked':''} ${c.has_current?'':'disabled'} onchange="updateRegistryChannel('output',${index},'ignition_wait_hot',this.checked)"><span></span> Wait until hot</label></div>
      ${c.ignition_wait_hot ? `<div class="hw-field"><span class="hw-label">Hot-confirm timeout (ms)</span><span class="hw-desc">Abort startup if this plug does not reach its ready-current condition in time.</span><input type="number" min="100" max="3600000" step="100" value="${Number(c.ignition_hot_timeout_ms)}" oninput="updateRegistryChannel('output',${index},'ignition_hot_timeout_ms',+this.value)"></div>` : ''}
    </div></div>
    ${wet ? `<div class="registry-card-editor" style="display:block;margin-top:.65rem"><div class="registry-card-summary"><div><strong>Wet-glow pilot fuel</strong><div class="hw-desc">This output belongs only to this wet glow plug and follows its command automatically.</div></div></div><div class="hw-grid">
      <div class="hw-field"><span class="hw-label">Pilot-fuel GPIO</span><span class="hw-desc">GPIO driving the wet glow plug's own pilot-fuel pump or valve.</span><select onchange="setAct('glow_plug','fuel_pin',+this.value)">${buildPinOptions(Number(act.fuel_pin ?? -1),'out')}</select></div>
      <div class="hw-field"><span class="hw-label">Pilot-fuel signal</span><select onchange="setRegistryWetGlowFuelType(+this.value)"><option value="0"${fuelType===0?' selected':''}>Relay / on-off</option><option value="1"${fuelType===1?' selected':''}>PWM</option><option value="2"${fuelType===2?' selected':''}>Servo / ESC</option></select></div>
      <div class="hw-field"><span class="hw-label">Active state</span><select onchange="setAct('glow_plug','fuel_active_h',this.value==='1')"><option value="1"${act.fuel_active_h!==false?' selected':''}>Active high</option><option value="0"${act.fuel_active_h===false?' selected':''}>Active low</option></select></div>
      <div class="hw-field"><span class="hw-label">Pilot-fuel delay (seconds)</span><span class="hw-desc">Time from wet glow activation until its pilot fuel turns on.</span><input type="number" min="0" max="3600" step="0.1" value="${registryFormatValue(fuelDelayS,1)}" oninput="setRegistryWetGlowDelaySeconds(+this.value)"></div>
      ${fuelType===1 ? `<div class="hw-field"><span class="hw-label">PWM frequency (Hz)</span><input type="number" min="1" max="100000" value="${Number(act.fuel_freq_hz ?? 1000)}" oninput="setAct('glow_plug','fuel_freq_hz',+this.value)"></div><div class="hw-field"><span class="hw-label">PWM resolution (bits)</span><input type="number" min="8" max="14" value="${Number(act.fuel_res_bits ?? 10)}" oninput="setAct('glow_plug','fuel_res_bits',+this.value)"></div><div class="hw-field"><span class="hw-label">Minimum PWM duty (%)</span><input type="number" min="0" max="100" step="0.1" value="${Number(act.fuel_pwm_min_pct ?? 0)}" oninput="setAct('glow_plug','fuel_pwm_min_pct',+this.value)"></div><div class="hw-field"><span class="hw-label">Maximum PWM duty (%)</span><input type="number" min="0" max="100" step="0.1" value="${Number(act.fuel_pwm_max_pct ?? 100)}" oninput="setAct('glow_plug','fuel_pwm_max_pct',+this.value)"></div>` : ''}
      ${fuelType===2 ? `<div class="hw-field"><span class="hw-label">Minimum pulse (µs)</span><input type="number" min="500" max="2500" value="${Number(act.fuel_min_us ?? 1000)}" oninput="setAct('glow_plug','fuel_min_us',+this.value)"></div><div class="hw-field"><span class="hw-label">Maximum pulse (µs)</span><input type="number" min="500" max="2500" value="${Number(act.fuel_max_us ?? 2000)}" oninput="setAct('glow_plug','fuel_max_us',+this.value)"></div>` : ''}
      ${fuelType!==0 ? `<div class="hw-field"><span class="hw-label">Pilot-fuel command (%)</span><span class="hw-desc">Demand applied after the delay.</span><input type="number" min="0" max="100" step="0.1" value="${Number(act.fuel_demand_pct ?? 100)}" oninput="setAct('glow_plug','fuel_demand_pct',+this.value)"></div>` : ''}
    </div></div>` : ''}
  </div>`;
}
function registryStarterEnableSubcard(c) {
  if (registryCoreActuatorKey(c) !== 'starter_en') return '';
  const act = ensureActuatorObject('starter_en');
  return `<div class="hw-item-card registry-subcard" style="grid-column:1/-1;margin:.35rem 0 0">
    <div class="registry-card-summary"><div><strong>Starter enable timing</strong><div class="hw-desc">Optional settling time after the separate enable/contactor turns on and before starter demand begins.</div></div></div>
    <div class="registry-card-editor" style="display:block"><div class="hw-grid">
      <div class="hw-field"><span class="hw-label">Enable delay (ms)</span><span class="hw-desc">Use 0 when no delay is needed. Maximum 30000 ms.</span><input type="number" min="0" max="30000" step="10" value="${Number(act.delay_ms ?? 1000)}" oninput="setAct('starter_en','delay_ms',+this.value)"></div>
    </div></div>
  </div>`;
}
function registryMinimumRunEditor(c, index) {
  const purpose = registryDerivedPurpose('output',c);
  if (purpose === 'main_fuel') return `<div class="hw-item-card registry-subcard" style="grid-column:1/-1;margin:.35rem 0 0"><div class="registry-card-summary"><div><strong>Minimum reliable fuel-pump command</strong><div class="hw-desc">Calibrated on the <a href="/calibration.html">Calibration page</a>. It is applied inside the electrical endpoints above and does not rewrite them.</div></div></div></div>`;
  if (!['oil_pump','fuel_pump','coolant_pump','scavenge_pump','cooling_fan'].includes(purpose) || outputDriverIsOnOff(c.driver)) return '';
  const pct = Math.max(0,Math.min(100,Number(c.min_run_demand||0)*100));
  const electricalDemand = c.invert ? 1 - pct/100 : pct/100;
  let physical = '';
  if (Number(c.driver) === 5) {
    const lo=Number(c.min||0)*100, hi=Number(c.max??1)*100;
    physical = `${(lo + electricalDemand*(hi-lo)).toFixed(1)}% PWM duty${c.invert ? ' (inverted)' : ''}`;
  } else if (Number(c.driver) === 6) {
    const lo=Number(c.min||1000), hi=Number(c.max||2000);
    physical = `${Math.round(lo + electricalDemand*(hi-lo))} us pulse${c.invert ? ' (inverted)' : ''}`;
  }
  return `<div class="hw-item-card registry-subcard" style="grid-column:1/-1;margin:.35rem 0 0">
    <div class="registry-card-summary"><div><strong>Minimum reliable running command</strong><div class="hw-desc">A nonzero command below this hardware value is raised to it. The output remains fully off at 0%. An automatic oil-pressure controller may apply its own higher minimum in Config.</div></div></div>
    <div class="registry-card-editor" style="display:block"><div class="hw-grid">
      <div class="hw-field"><span class="hw-label">Minimum reliable command (%)</span><input type="number" min="0" max="100" step="0.1" value="${registryFormatValue(pct,1)}" onchange="updateRegistryChannel('output',${index},'min_run_demand',Math.max(0,Math.min(1,(+this.value||0)/100)))"></div>
      <div class="hw-field"><span class="hw-label">Calculated electrical signal</span><span class="hw-desc">Derived from the electrical endpoints; rerun or review this calibration after changing them.</span><output>${escapeHtmlText(physical || 'On / off')}</output></div>
    </div></div>
  </div>`;
}
function registryCurveSupported(direction, c) {
  if (direction !== 'input' || ![1,9].includes(Number(c?.driver))) return false;
  if (registryLoadCellIsHx711(c)) return false;
  if (String(c?.role||'') === 'flame') return false;
  if (registryIsSwitchRole(c.role) ||
      ['start_switch','stop_switch'].includes(registryDerivedPurpose(direction,c))) return false;
  return !(String(c.role||'') === 'temperature' && ![0,4].includes(Number(c.temp_interface||0)));
}
function registryCurveUnit(c) {
  const role = String(c?.role || '');
  if (['generic','operator','flame'].includes(role)) return 'normalized 0.00–1.00';
  return role === 'speed' ? 'RPM' : role === 'pressure' ? 'bar' :
    role === 'temperature' ? '°C' : role === 'flow' ? 'L/min' :
    role === 'current' ? 'A' : role === 'torque' ? 'Nm' :
    role === 'thrust' ? 'N' : role === 'voltage' ? 'V' : 'physical value';
}
function registryLinearValueAtRaw(c, raw) {
  const role = String(c?.role || '');
  if (role === 'temperature' && Number(c.temp_interface||0) === 4) {
    const x = Math.max(1,Math.min(4094,Number(raw)));
    const fixed = Math.max(0.001,Number(c.ntc_r_fixed ?? 10000));
    const r0 = Math.max(0.001,Number(c.ntc_r0 ?? 10000));
    const beta = Math.max(0.001,Number(c.ntc_beta ?? 3950));
    const resistance = c.ntc_pullup === false ? fixed*(4095-x)/x : fixed*x/(4095-x);
    return 1/(1/298.15+Math.log(resistance/r0)/beta)-273.15;
  }
  if (['generic','operator','flame'].includes(role)) {
    const lo = Number(c.min ?? 0), hi = Number(c.max ?? 4095);
    return hi > lo ? Math.max(0,Math.min(1,(raw-lo)/(hi-lo))) : 0;
  }
  const referenceMv = Number(c.driver) === 9 ? Number(c.i2c_reference_mv ?? 3300) : 3300;
  const mv = raw * referenceMv / 4095;
  if (role === 'voltage') return mv / 1000 * Math.max(1,Number(c.analog_divider ?? 1));
  return (mv - Number(c.analog_zero_mv ?? 0)) /
    Math.max(0.000001,Number(c.analog_mv_per_unit ?? 1000));
}
function registryCurveProblem(c) {
  const points = Array.isArray(c?.calibration_points) ? c.calibration_points : [];
  if (!points.length) return '';
  if (points.length < 2 || points.length > 6) return 'Sensor curve needs 2–6 points';
  const ntc = String(c?.role||'') === 'temperature' && Number(c?.temp_interface||0) === 4;
  let direction = 0;
  for (let i=0;i<points.length;i++) {
    const raw = Number(points[i]?.raw), value = Number(points[i]?.value);
    if (!Number.isFinite(raw) || raw < 0 || raw > 4095 || !Number.isFinite(value)) return 'Sensor curve contains an invalid point';
    if (ntc && (raw <= 0 || raw >= 4095)) return 'NTC curve points must stay between ADC 1 and 4094 so open/short rails remain faults';
    if (i && raw <= Number(points[i-1]?.raw)) return 'Sensor curve ADC values must increase';
    if (i) {
      const delta = value - Number(points[i-1]?.value);
      if (!delta) return 'Sensor curve physical values must change at every point';
      const step = delta > 0 ? 1 : -1;
      if (!direction) direction = step;
      else if (direction !== step) return 'Sensor curve physical values must move in one direction';
    }
  }
  return '';
}
function setRegistryCurveEnabled(index, enabled) {
  const c = registryRoot().inputs[index];
  if (!c) return;
  if (!enabled) c.calibration_points = [];
  else {
    let lo = Math.max(0,Math.min(4095,Math.round(Number(c.min ?? 0))));
    let hi = Math.max(0,Math.min(4095,Math.round(Number(c.max ?? 4095))));
    if (hi <= lo) { lo = 0; hi = 4095; }
    if (String(c.role||'') === 'temperature' && Number(c.temp_interface||0) === 4) {
      lo = Math.max(1,lo); hi = Math.min(4094,hi);
    }
    c.calibration_points = [
      {raw:lo,value:registryLinearValueAtRaw(c,lo)},
      {raw:hi,value:registryLinearValueAtRaw(c,hi)}
    ];
  }
  dirty(); updateSaveButton(); renderRegistryInventory();
}
function updateRegistryCurvePoint(index, pointIndex, field, value) {
  const c = registryRoot().inputs[index], points = c?.calibration_points;
  if (!Array.isArray(points) || !points[pointIndex]) return;
  points[pointIndex][field] = field === 'raw' ? Math.round(Number(value)) : Number(value);
  dirty(); updateSaveButton(); renderRegistryInventory();
}
function addRegistryCurvePoint(index) {
  const c = registryRoot().inputs[index], points = c?.calibration_points;
  if (!Array.isArray(points) || points.length < 2 || points.length >= 6) return;
  let insert = points.length - 1;
  let left = points[insert-1], right = points[insert];
  if (Number(right.raw)-Number(left.raw) <= 1) {
    insert = 1; left = points[0]; right = points[1];
  }
  const raw = Math.round((Number(left.raw)+Number(right.raw))/2);
  if (raw <= Number(left.raw) || raw >= Number(right.raw)) return;
  points.splice(insert,0,{raw,value:(Number(left.value)+Number(right.value))/2});
  dirty(); updateSaveButton(); renderRegistryInventory();
}
function removeRegistryCurvePoint(index, pointIndex) {
  const c = registryRoot().inputs[index], points = c?.calibration_points;
  if (!Array.isArray(points) || points.length <= 2) return;
  points.splice(pointIndex,1);
  dirty(); updateSaveButton(); renderRegistryInventory();
}
function registryAnalogCurveEditor(direction, c, index) {
  if (!registryCurveSupported(direction,c)) return '';
  const points = Array.isArray(c.calibration_points) ? c.calibration_points : [];
  if (!points.length) return `<details style="grid-column:1/-1"><summary>Advanced sensor curve</summary><div class="hw-grid" style="margin-top:.65rem"><div class="hw-field" style="grid-column:1/-1"><span class="hw-desc">Most voltage and current-output sensors are linear and need no curve. Enable this for a resistive sender, an NTC with a manufacturer temperature table, or another sensor whose datasheet provides several calibration points.</span><button type="button" onclick="setRegistryCurveEnabled(${index},true)">Use multi-point curve</button></div></div></details>`;
  const problem = registryCurveProblem(c);
  const ntc = String(c?.role||'') === 'temperature' && Number(c?.temp_interface||0) === 4;
  const rows = points.map((p,n)=>`<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">Calibration point ${n+1}</span><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.55rem;align-items:end"><label><span class="hw-label">ADC reading</span><input class="${problem?'field-error':''}" style="width:100%" type="number" min="${ntc?1:0}" max="${ntc?4094:4095}" step="1" value="${Math.round(Number(p.raw))}" onchange="updateRegistryCurvePoint(${index},${n},'raw',this.value)"></label><label><span class="hw-label">Physical value (${escapeHtmlText(registryCurveUnit(c))})</span><input class="${problem?'field-error':''}" style="width:100%" type="number" step="any" value="${registryFormatValue(p.value,4)}" onchange="updateRegistryCurvePoint(${index},${n},'value',this.value)"></label>${points.length>2?`<button type="button" class="danger" onclick="removeRegistryCurvePoint(${index},${n})">Remove point ${n+1}</button>`:''}</div></div>`).join('');
  return `<details open style="grid-column:1/-1"><summary>Advanced sensor curve (${points.length} points)</summary><div class="hw-grid" style="margin-top:.65rem"><div class="hw-field" style="grid-column:1/-1"><span class="hw-desc">Enter 2–6 datasheet or measured points. ADC values must increase; physical values may consistently increase or decrease. Values outside the endpoints are safely clamped.</span>${problem?`<span class="field-error-text">${escapeHtmlText(problem)}</span>`:''}</div>${rows}<div class="hw-field" style="grid-column:1/-1;display:flex;gap:.5rem"><button type="button" ${points.length>=6?'disabled':''} onclick="addRegistryCurvePoint(${index})">Add point</button><button type="button" onclick="setRegistryCurveEnabled(${index},false)">Use linear calibration</button></div></div></details>`;
}
function registryOilFlowMonitorEditor(c, index) {
  const purpose = registryDerivedPurpose('output', c);
  if (!['oil_pump','scavenge_pump'].includes(purpose) && c.role !== 'oil_pump') return '';
  const sensorName = purpose === 'oil_pump' ? 'Main oil-pump flow sensor' : 'Scavenge-pump flow sensor';
  const owned = pumpFlowInput(c);
  const sensor = owned.channel;
  const sensorIndex = owned.index;
  const fitted = !!sensor;
  const compatible = (registryRoot().inputs || []).filter(row => registryDerivedPurpose('input', row) === pumpFlowPurpose(c));
  const driver = Number(sensor?.driver ?? 2);
  const pinEditor = sensor && driver < 8
    ? `<div class="hw-field"><span class="hw-label">${driver === 2 ? 'Pulse GPIO' : 'Analog ADC GPIO'}</span><select onchange="updateRegistryChannel('input',${sensorIndex},'pin',+this.value)">${buildPinOptions(sensor.pin, driver === 1 ? 'adc' : 'in')}</select></div>`
    : '';
  const deviceEditor = sensor && driver >= 8 ? registryI2cEditor('input', sensor, sensorIndex) : '';
  const calibration = sensor
    ? `${registryPulseScaleEditor('input',sensor,sensorIndex)}${registryAnalogScaleEditor('input',sensor,sensorIndex)}`
    : '';
  return `<div class="hw-item-card registry-subcard" style="grid-column:1/-1;margin:.35rem 0 0">
    <div class="registry-card-summary"><div><strong>Flow sensing &amp; monitoring</strong><div class="hw-desc">Adds this pump's own flow meter here. Low or missing flow warns by default; Config can optionally make a confirmed fault shut the engine down.</div></div>
      <label class="hw-toggle"><input type="checkbox" ${fitted?'checked':''} onchange="setPumpFlowSensorEnabled(${index},this.checked)"><span></span> Fit flow sensor</label>
    </div>
    ${fitted ? `<div class="registry-card-editor" style="display:block"><div class="hw-grid">
      <div class="hw-field" style="grid-column:1/-1"><span class="hw-label">${sensorName}</span><span class="hw-desc">This internal input belongs to this pump and is not added separately under Inputs. Its calibration is stored with the sensor.</span></div>
      ${compatible.length > 1 ? `<div class="hw-field"><span class="hw-label">Flow input for this pump</span><select onchange="updateRegistryChannel('output',${index},'flow_input',this.value);renderRegistryInventory()">${compatible.map(row=>`<option value="${escapeHtmlText(row.id)}"${row.id===(c.flow_input||sensor.id)?' selected':''}>${escapeHtmlText(row.name||row.id)}</option>`).join('')}</select></div>` : ''}
      ${pcbProfileActive() ? '' : registrySignalTypeEditor('input',sensor,sensorIndex,registryFieldChangedClass('input',sensorIndex,'driver'))}
      ${pinEditor}${deviceEditor}${calibration}
      <div class="hw-field"><span class="hw-label">Low-flow monitoring</span><span class="hw-desc">Check this sensor whenever the pump is commanded on.</span><label class="hw-toggle"><input type="checkbox" ${c.has_flow_monitor?'checked':''} onchange="updateRegistryChannel('output',${index},'has_flow_monitor',this.checked)"><span></span> Monitor low flow</label></div>
      <div class="hw-field"><span class="hw-label">Minimum flow (L/min)</span><span class="hw-desc">Flow below this value is considered a fault while this pump is on.</span><input type="number" min="0.001" max="10000" step="0.01" value="${registryFormatValue(c.minimum_flow_l_min ?? 0.1)}" onchange="updateRegistryChannel('output',${index},'minimum_flow_l_min',Math.max(0.001,+this.value||0.1))"></div>
      <div class="hw-field"><span class="hw-label">Protection behavior</span><span class="hw-desc">Confirmation time and optional shutdown are in <a href="/controllers.html#oil-config-section">Controllers → Safety &amp; Limits → Oil Pressure Safety</a>.</span></div>
    </div></div>` : `<div class="hw-desc" style="margin-top:.45rem">Enable this subcard to add and calibrate the pump's matching flow meter.</div>`}
  </div>`;
}
function registryOutputSubcards(direction, c, index) {
  if (direction !== 'output') return '';
  const actKey = registryCoreActuatorKey(c);
  const purpose = registryDerivedPurpose('output', c);
  return `${purpose === 'igniter' || purpose === 'ab_igniter' ? registryIgniterSubcards(c, index, actKey) : ''}
          ${purpose === 'glow_plug' ? registryGlowSubcards(c, index) : ''}
          ${registryStarterEnableSubcard(c)}
          ${registryMinimumRunEditor(c, index)}
          ${registryOilFlowMonitorEditor(c, index)}
          ${pcbProfileActive() ? '' : registryCurrentEditor(direction, c, index)}`;
}
function registryI2cEditor(direction, c, index) {
  const driver = Number(c.driver);
  if (driver < 8) return '';
  const expected = driver === 8 || driver === 11 ? 'TCA9554' : driver === 9 ? 'TLA2528' : 'NAU7802';
  const detected = (cfg._i2c_discovery?.devices || []).filter(d => d.type === expected);
  const currentAddress = Number(c.i2c_address || 0);
  const connected = detected.filter(d => d.present);
  const addresses = [...new Set([currentAddress, ...connected.map(d=>Number(d.address))])].filter(Boolean);
  const addressOptions = addresses.map(a => {
    const present = connected.some(d=>Number(d.address)===a);
    const selected = currentAddress === a;
    return `<option value="${a}"${selected?' selected':''}${!present?' disabled':''}>0x${a.toString(16).toUpperCase().padStart(2,'0')} — ${present?'connected':'Disconnected (saved assignment)'}</option>`;
  }).join('');
  const channelMax = expected === 'NAU7802' ? 2 : 8;
  const safety = direction === 'output'
    ? '<div class="hw-desc" style="color:var(--warning)">Native ESP GPIO is recommended for turbine safety and combustion outputs. The expander can retain its last physical latch state if it or the bus is unplugged.</div>' : '';
  const firstTcaInput = (registryRoot().inputs || []).findIndex(row => Number(row?.driver) === 8);
  const showSharedInterrupt = direction === 'input' && driver === 8 && index === firstTcaInput;
  const interruptPin = Number(cfg.i2c?.interrupt_pin ?? -1);
  const interruptEditor = showSharedInterrupt
    ? `<div class="hw-field"><span class="hw-label">Shared TCA9554 interrupt GPIO (optional)</span><span class="hw-desc">Shown here because this is the first installed TCA9554 input. Leave unassigned for polling. Multiple TCA9554 open-drain INT outputs may share this one pulled-up ESP32 input.</span><select class="${workflowFieldChanged('i2c','interrupt_pin') ? 'field-changed' : ''}" onchange="setI2cField('interrupt_pin',+this.value)">${buildPinOptions(interruptPin, 'in')}</select></div>`
    : '';
  let calibration = '';
  if (driver === 9) {
    const referenceMv = Number(c.i2c_reference_mv ?? 3300);
    const isDigital = registryIsSwitchRole(c.role) || ['start_switch','stop_switch'].includes(registryDerivedPurpose(direction,c));
    const thresholdRaw = Math.max(0,Math.min(4095,Math.round(Number(c.digital_threshold_raw ?? 2048))));
    const maxHysteresisRaw = Math.max(0,Math.min(2047,2*Math.min(thresholdRaw,4095-thresholdRaw)));
    const hysteresisRaw = Math.max(0,Math.min(maxHysteresisRaw,Math.round(Number(c.digital_hysteresis_raw ?? 64))));
    const thresholdV = thresholdRaw * referenceMv / 4095 / 1000;
    const hysteresisV = hysteresisRaw * referenceMv / 4095 / 1000;
    const maxHysteresisV = maxHysteresisRaw * referenceMv / 4095 / 1000;
    calibration = `<div class="hw-field"><span class="hw-label">ADC reference / supply (mV)</span><input type="number" min="1000" max="5500" step="1" value="${referenceMv}" onchange="updateRegistryChannel('${direction}',${index},'i2c_reference_mv',+this.value)"></div>
      ${isDigital ? `<div class="hw-field"><span class="hw-label">Switch threshold (V)</span><span class="hw-desc">The analog connector is treated as On above this voltage. Input polarity can reverse the logical state.</span><input type="number" min="0" max="${referenceMv/1000}" step="0.01" value="${registryFormatValue(thresholdV,2)}" onchange="updateRegistryChannel('input',${index},'digital_threshold_raw',Math.round(Math.max(0,Math.min(${referenceMv/1000},+this.value))*1000/${referenceMv}*4095))"></div>
      <div class="hw-field"><span class="hw-label">Switch hysteresis (V)</span><span class="hw-desc">Required voltage movement around the threshold before the state changes; limited by the distance to the nearest ADC rail.</span><input type="number" min="0" max="${maxHysteresisV}" step="0.01" value="${registryFormatValue(hysteresisV,2)}" onchange="updateRegistryChannel('input',${index},'digital_hysteresis_raw',Math.round(Math.max(0,Math.min(${maxHysteresisV},+this.value))*1000/${referenceMv}*4095))"></div>`
      : `<div class="hw-field"><span class="hw-label">Input filter response</span><span class="hw-desc">1.0 follows every new ADC sample; lower values smooth electrical noise.</span><input type="number" min="0.01" max="1" step="0.01" value="${Number(c.filter_alpha??1)}" onchange="updateRegistryChannel('input',${index},'filter_alpha',+this.value)"></div>`}`;
  }
  if (driver === 10) calibration = `
    <div class="hw-field"><span class="hw-label">PGA gain</span><span class="hw-desc">Shared by both channels on this NAU7802.</span><select onchange="updateRegistryChannel('input',${index},'loadcell_gain',+this.value)">${[1,2,4,8,16,32,64,128].map(v=>`<option value="${v}"${Number(c.loadcell_gain??128)===v?' selected':''}>${v}×</option>`).join('')}</select></div>
    <div class="hw-field"><span class="hw-label">Sample rate</span><span class="hw-desc">Shared by both channels on this NAU7802.</span><select onchange="updateRegistryChannel('input',${index},'loadcell_rate_sps',+this.value)">${[10,20,40,80,320].map(v=>`<option value="${v}"${Number(c.loadcell_rate_sps??80)===v?' selected':''}>${v} SPS</option>`).join('')}</select></div>
    <div class="hw-field"><span class="hw-label">Zero-load raw count</span><input type="number" step="1" value="${Number(c.loadcell_zero??0)}" onchange="updateRegistryChannel('input',${index},'loadcell_zero',+this.value)"></div>
    <div class="hw-field"><span class="hw-label">Newtons per raw count</span><span class="hw-desc">Use Calibration for guided zero and known-load capture.</span><input type="number" step="0.000000001" value="${Number(c.loadcell_n_per_count??1)}" onchange="updateRegistryChannel('input',${index},'loadcell_n_per_count',+this.value)"></div>
    ${String(c.role)==='torque'?`<div class="hw-field"><span class="hw-label">Lever arm (m)</span><span class="hw-desc">Torque = calibrated force × perpendicular lever arm.</span><input type="number" min="0.000001" max="100" step="0.001" value="${Number(c.lever_arm_m??1)}" onchange="updateRegistryChannel('input',${index},'lever_arm_m',+this.value)"></div>`:''}
    <div class="hw-field"><span class="hw-label">Filter response</span><span class="hw-desc">1.0 is fastest; lower values smooth vibration and load-cell noise.</span><input type="number" min="0.01" max="1" step="0.01" value="${Number(c.filter_alpha??0.25)}" onchange="updateRegistryChannel('input',${index},'filter_alpha',+this.value)"></div>`;
  return `<div class="hw-field" style="grid-column:1/-1"><span class="hw-label">${expected} connection</span>${safety}<div class="hw-grid" style="margin-top:.5rem"><div class="hw-field"><span class="hw-label">Detected device</span><span class="hw-desc">Only devices responding on the live bus can be assigned. A saved missing device remains visible but cannot be selected for a new assignment.</span><select onchange="updateRegistryChannel('${direction}',${index},'i2c_address',+this.value)">${addressOptions || '<option value="">No connected device detected</option>'}</select></div><div class="hw-field"><span class="hw-label">Device channel</span><select onchange="updateRegistryChannel('${direction}',${index},'device_channel',+this.value)">${Array.from({length:channelMax},(_,v)=>`<option value="${v}"${Number(c.device_channel||0)===v?' selected':''}>Channel ${v}</option>`).join('')}</select></div>${interruptEditor}${calibration}</div></div>`;
}
function registryProfileInputTuningEditor(direction, c, index) {
  if (!pcbProfileActive() || direction !== 'input') return '';
  const purpose = registryDerivedPurpose(direction,c);
  const isSwitch = registryIsSwitchRole(c.role) || ['start_switch','stop_switch'].includes(purpose);
  if (!isSwitch) return '';
  const polarity = `<div class="hw-field"><span class="hw-label">Active state</span><span class="hw-desc">Choose which electrical state means the switch or interlock is On.</span><select onchange="updateRegistryChannel('input',${index},'active_high',this.value==='1')"><option value="1"${c.active_high !== false ? ' selected' : ''}>High / above threshold is On</option><option value="0"${c.active_high === false ? ' selected' : ''}>Low / below threshold is On</option></select></div>`;
  if (Number(c.driver) === 0 || Number(c.driver) === 2) {
    const pullConflict = c.pullup && c.pulldown ? ' field-error' : '';
    return `${polarity}<div class="hw-field"><span class="hw-label">Input bias</span><span class="hw-desc">Choose an internal pull-up, pull-down, or leave both off when the connected signal provides its own bias.</span><div class="hw-toggle-row">
      <label class="hw-toggle"><input class="${pullConflict}" type="checkbox" ${c.pullup ? 'checked' : ''} onchange="updateRegistryChannel('input',${index},'pullup',this.checked)"><span></span> Pull-up</label>
      <label class="hw-toggle"><input class="${pullConflict}" type="checkbox" ${c.pulldown ? 'checked' : ''} onchange="updateRegistryChannel('input',${index},'pulldown',this.checked)"><span></span> Pull-down</label>
    </div></div>`;
  }
  if (Number(c.driver) !== 9) return polarity;
  const referenceMv = Number(c.i2c_reference_mv ?? 5000);
  const thresholdV = Number(c.digital_threshold_raw ?? 2048) * referenceMv / 4095 / 1000;
  const hysteresisV = Number(c.digital_hysteresis_raw ?? 64) * referenceMv / 4095 / 1000;
  return `${polarity}
    <div class="hw-field"><span class="hw-label">Switch threshold (V)</span><span class="hw-desc">Defaults to 50% of this connector's ${registryFormatValue(referenceMv/1000,1)} V measurement range.</span><input type="number" min="0" max="${referenceMv/1000}" step="0.01" value="${registryFormatValue(thresholdV,2)}" onchange="updateRegistryChannel('input',${index},'digital_threshold_raw',Math.round(Math.max(0,Math.min(${referenceMv/1000},+this.value))*1000/${referenceMv}*4095))"></div>
    <div class="hw-field"><span class="hw-label">Switch hysteresis (V)</span><span class="hw-desc">Prevents a noisy voltage near the threshold from rapidly switching On and Off.</span><input type="number" min="0" max="${referenceMv/2000}" step="0.01" value="${registryFormatValue(hysteresisV,2)}" onchange="updateRegistryChannel('input',${index},'digital_hysteresis_raw',Math.round(Math.max(0,Math.min(${referenceMv/2000},+this.value))*1000/${referenceMv}*4095))"></div>`;
}
function registryDriverOptions(direction, selected) {
  const role = arguments.length > 2 ? arguments[2] : null;
  const purpose = arguments.length > 3 ? arguments[3] : 'generic';
  const allowed = new Set(registryAllowedDrivers(direction, role, purpose));
  const pulseLabel = ['n1_speed','n2_speed','shaft_speed'].includes(purpose) ? 'Hardware pulse counter (PCNT)' : 'Frequency';
  const drivers = direction === 'input'
    ? [[0,'Digital switch'],[1,'Analog / ADC'],[2,pulseLabel],[3,'RC pulse width'],[7,'PWM duty'],[8,'TCA9554 digital'],[9,'TLA2528 ADC / threshold switch'],[10,'NAU7802 load cell']]
    : [[4,'Relay'],[5,'PWM'],[6,'Servo/ESC'],[11,'TCA9554 on/off output']];
  const remotePresent = v => {
    const type = v === 8 || v === 11 ? 'TCA9554' : v === 9 ? 'TLA2528' : v === 10 ? 'NAU7802' : '';
    return !type || (cfg._i2c_discovery?.devices || []).some(d => d.type === type && d.present);
  };
  return drivers
    .filter(([v]) => allowed.has(v) && (v < 8 || Number(selected) === v || remotePresent(v)))
    .map(([v, label]) => `<option value="${v}"${Number(selected)===v?' selected':''}>${label}${v>=8&&Number(selected)===v&&!remotePresent(v)?' — Disconnected':''}</option>`)
    .join('');
}
