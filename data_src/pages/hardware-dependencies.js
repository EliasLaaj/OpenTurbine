function setBuzzerEnabled(val) {
  if (!cfg.buzzer) cfg.buzzer = {};
  cfg.buzzer.enabled = val;
  if (!val) cfg.buzzer.pin = -1;
  updateGroupEnabled('grp-buzzer', val);
  dirty(); refreshAllPins(); updateSaveButton();
}
function setSafety(key, val, cardId) {
  setNested('safety', key, val);
  setSafetyUI(key, val, cardId);
}
function setSafetyUI(key, val, cardId) {
  const map = {
    overspeed:'f-saf-overspeed', overtemp:'f-saf-overtemp', low_oil:'f-saf-lowoil',
    n2_overspeed:'f-saf-n2overspeed',
    oil_zero:'f-saf-oilzero', flameout:'f-saf-flameout',
    hot_start:'f-saf-hotstart', oil_temp_high:'f-saf-oiltemphi',
    fuel_press_low:'f-saf-fuelpresslo', batt_low:'f-saf-battlo', surge:'f-saf-surge',
  };
  chk(map[key], val);
  const card = document.getElementById(cardId);
  if (card) card.classList.toggle('disabled-safety', !val);
}

function updateSafetyPrerequisites(markDirty) {
  const requirements = {
    overspeed: ['n1_rpm', 'sc-overspeed', 'N1 RPM sensor required'],
    n2_overspeed: ['n2_rpm', 'sc-n2overspeed', 'N2 RPM sensor required'],
    overtemp: ['egt_source', 'sc-overtemp', 'TOT or TIT sensor required'],
    low_oil: ['oil_safety_low', 'sc-lowoil', 'Oil pressure sensor or low-oil switch required'],
    oil_zero: ['oil_safety_zero', 'sc-oilzero', 'Oil pressure sensor or zero-oil switch required'],
    flameout: ['combustion_source', 'sc-flameout', 'Flameout safety requires a flame sensor, N1 RPM, TOT, or TIT sensor'],
    hot_start: ['egt_source', 'sc-hotstart', 'TOT or TIT sensor required'],
    oil_temp_high: ['oil_temp', 'sc-oiltemphi', 'Oil temperature sensor required'],
    fuel_press_low: ['fuel_press', 'sc-fuelpresslo', 'Fuel pressure sensor required'],
    batt_low: ['batt_voltage', 'sc-battlo', 'Battery voltage sensor required'],
    surge: ['n1_rpm', 'sc-surge', 'N1 RPM sensor required'],
  };
  const inputs = {
    overspeed:'f-saf-overspeed', overtemp:'f-saf-overtemp', low_oil:'f-saf-lowoil',
    n2_overspeed:'f-saf-n2overspeed',
    oil_zero:'f-saf-oilzero', flameout:'f-saf-flameout',
    hot_start:'f-saf-hotstart',
    oil_temp_high:'f-saf-oiltemphi', fuel_press_low:'f-saf-fuelpresslo',
    batt_low:'f-saf-battlo', surge:'f-saf-surge',
  };
  const availableBySensor = sensor => {
    if (sensor === 'combustion_source') {
      return registryHasPurpose('input','flame') || registryHasPurpose('input','n1_speed') ||
        registryHasPurpose('input','tot') || registryHasPurpose('input','tit');
    }
    if (sensor === 'egt_source') {
      return registryHasPurpose('input','tot') || registryHasPurpose('input','tit');
    }
    if (sensor === 'n1_rpm') {
      return registryHasPurpose('input','n1_speed');
    }
    if (sensor === 'n2_rpm') return registryHasPurpose('input','n2_speed');
    if (sensor === 'oil_press') {
      return registryHasPurpose('input','oil_pressure');
    }
    if (sensor === 'oil_safety_low') {
      return availableBySensor('oil_press') || hardwareHasDiRole('low_oil_switch') || registryHasPurpose('input','low_oil_switch');
    }
    if (sensor === 'oil_safety_zero') {
      return availableBySensor('oil_press') || hardwareHasDiRole('oil_zero_switch') || registryHasPurpose('input','oil_zero_switch');
    }
    if (sensor === 'tit') return registryHasPurpose('input','tit');
    if (sensor === 'oil_temp') return registryHasPurpose('input','oil_temperature');
    if (sensor === 'fuel_press') return registryHasPurpose('input','fuel_pressure');
    if (sensor === 'batt_voltage') return registryHasPurpose('input','battery_voltage');
    return false;
  };
  for (const [key, [sensor, cardId, reason]] of Object.entries(requirements)) {
    const available = availableBySensor(sensor);
    const input = document.getElementById(inputs[key]);
    const card = document.getElementById(cardId);
    if (input) input.disabled = !available;
    if (card) card.title = available ? '' : reason;
    if (!available && cfg.safety?.[key]) {
      cfg.safety[key] = false;
      setSafetyUI(key, false, cardId);
      if (markDirty) dirty();
    }
  }
}

async function setController(key, val) {
  if (!val && cfg.controllers?.[key]) {
    const label = controllerLabel(key);
    if (!await OTDialog.confirm(`Disable ${label}?\n\nIts tuning values stay saved, but the controller will no longer act until enabled again.`, {
      title: 'Disable controller?', confirmText: 'Disable', danger: true
    })) {
      renderHardwareWorkflowSummaries();
      return;
    }
  }
  setNested('controllers', key, val);
  if (key === 'oil_loop' && val && typeof ensureOilLoops === 'function') ensureOilLoops();
  updateHardwarePrerequisites(true);
}

function updateHardwarePrerequisites(markDirty) {
  const sensors = cfg.sensors || {};
  const acts = cfg.actuators || {};
  if (!cfg.controllers) cfg.controllers = {};

  const controllerNeeds = {
    oil_loop: {id: 'f-ctrl-oil', ...controllerAvailability('oil_loop')},
    dynamic_idle: {id: 'f-ctrl-idle', ...controllerAvailability('dynamic_idle')},
    governor: {id: 'f-ctrl-gov', ...controllerAvailability('governor')}
  };
  for (const [key, requirement] of Object.entries(controllerNeeds)) {
    const input = document.getElementById(requirement.id);
    if (input) {
      input.disabled = !requirement.ok;
      input.title = requirement.ok ? '' : requirement.reason;
      const card = input.closest('.hw-item-card');
      if (card) {
        card.style.opacity = requirement.ok ? '' : '.5';
        card.title = requirement.ok ? '' : requirement.reason;
      }
    }
    if (!requirement.ok && cfg.controllers[key]) {
      cfg.controllers[key] = false;
      if (input) input.checked = false;
      if (markDirty) dirty();
    }
  }

  const currentOwners = [
    ['oil_pump', 'en-oilpumpcurrent', 'grp-oilpumpcurrent'],
    ['glow_plug', 'en-glowcurrent', 'grp-glowcurrent']
  ];
  for (const [key, inputId, groupId] of currentOwners) {
    const parentFitted = !!acts[key]?.enabled;
    const input = document.getElementById(inputId);
    if (input) {
      input.disabled = !parentFitted;
      input.title = parentFitted ? '' : 'Requires its parent actuator to be fitted.';
    }
    if (!parentFitted && acts[key]?.has_current) {
      acts[key].has_current = false;
      if (input) input.checked = false;
      setOptionalGroupVisible(groupId, false);
      if (markDirty) dirty();
    }
  }
}

function setThrType(t) { setAct('throttle','type',t); updateThrTypeUI(t); }
function updateThrTypeUI(t) {
  document.getElementById('grp-thr-servo').style.display = t === 0 ? '' : 'none';
  document.getElementById('grp-thr-ledc').style.display  = t === 1 ? '' : 'none';
  document.getElementById('grp-thr-onoff').style.display = t === 2 ? '' : 'none';
}
function setStrType(t) { setAct('starter','type',t); updateStrTypeUI(t); }
function updateStrTypeUI(t) {
  document.getElementById('grp-str-servo').style.display  = t === 0 ? '' : 'none';
  document.getElementById('grp-str-ledc').style.display   = t === 1 ? '' : 'none';
  document.getElementById('grp-str-onoff').style.display  = t === 2 ? '' : 'none';
}
function setTotChip(chip) { setSensor('tot','chip',chip); updateTotChipUI(chip); }
function updateTotChipUI(chip) {
  document.getElementById('grp-tot-mosi').style.display   = chip === 'max31856' ? '' : 'none';
  document.getElementById('grp-tot-tctype').style.display = chip === 'max31856' ? '' : 'none';
}
function setTitChip(chip) { setSensor('tit','chip',chip); updateTitChipUI(chip); }
function updateTitChipUI(chip) {
  document.getElementById('grp-tit-mosi').style.display   = chip === 'max31856' ? '' : 'none';
  document.getElementById('grp-tit-tctype').style.display = chip === 'max31856' ? '' : 'none';
}
function setOilTempChip(chip) {
  setSensor('oil_temp','chip',chip);
  adoptExistingSpiBus('oil_temp');
  refreshAllPins();
  updateOilTempChipUI(chip);
}
function updateOilTempChipUI(chip) {
  const isNtc = chip === 'ntc';
  const isOw  = chip === 'ds18b20';
  const isSpi = !isNtc && !isOw;
  document.getElementById('grp-oiltemp-ntc').style.display    = isNtc ? '' : 'none';
  document.getElementById('grp-oiltemp-onewire').style.display= isOw  ? '' : 'none';
  document.getElementById('grp-oiltemp-spi').style.display    = isSpi ? '' : 'none';
  document.getElementById('grp-oiltemp-mosi').style.display   = chip === 'max31856' ? '' : 'none';
  document.getElementById('grp-oiltemp-tctype').style.display = chip === 'max31856' ? '' : 'none';
}
function setPropPitchType(t) { setAct('prop_pitch','type',t); updatePropPitchTypeUI(t); }
function updatePropPitchTypeUI(t) {
  document.getElementById('grp-pp-servo').style.display = t === 0 ? '' : 'none';
  document.getElementById('grp-pp-pwm').style.display   = t === 1 ? '' : 'none';
  document.getElementById('grp-pp-onoff').style.display = t === 2 ? '' : 'none';
}
function setBleedType(t) { setAct('bleed_valve','type',t); updateBleedTypeUI(t); }
function updateBleedTypeUI(t) {
  document.getElementById('grp-bleed-servo').style.display  = t === 0 ? '' : 'none';
  document.getElementById('grp-bleed-pwm').style.display    = t === 1 ? '' : 'none';
  document.getElementById('grp-bleed-onoff').style.display  = t === 2 ? '' : 'none';
}
function setFp2Type(t) { setAct('fuel_pump2','type',t); updateFp2TypeUI(t); }
function updateFp2TypeUI(t) {
  document.getElementById('grp-fp2-servo').style.display = t === 0 ? '' : 'none';
  document.getElementById('grp-fp2-pwm').style.display   = t === 1 ? '' : 'none';
  document.getElementById('grp-fp2-onoff').style.display = t === 2 ? '' : 'none';
}
function setOpType(t) { setAct('oil_pump','type',t); updateOpTypeUI(t); }
function updateOpTypeUI(t) {
  document.getElementById('grp-op-servo').style.display = t === 0 ? '' : 'none';
  document.getElementById('grp-op-pwm').style.display   = t === 1 ? '' : 'none';
  document.getElementById('grp-op-onoff').style.display = t === 2 ? '' : 'none';
}
function setOscavType(t) { setAct('oil_scavenge_pump','type',t); updateOscavTypeUI(t); }
function updateOscavTypeUI(t) {
  document.getElementById('grp-oscav-servo').style.display  = t === 0 ? '' : 'none';
  document.getElementById('grp-oscav-pwm').style.display    = t === 1 ? '' : 'none';
  document.getElementById('grp-oscav-onoff').style.display  = t === 2 ? '' : 'none';
}
function setAbpType(t) { setAct('ab_pump','type',t); updateAbpTypeUI(t); }
function updateAbpTypeUI(t) {
  document.getElementById('grp-abp-servo').style.display = t === 0 ? '' : 'none';
  document.getElementById('grp-abp-pwm').style.display   = t === 1 ? '' : 'none';
  document.getElementById('grp-abp-onoff').style.display = t === 2 ? '' : 'none';
}
function setFanType(t) { setAct('cool_fan','type',t); updateFanTypeUI(t); }
function updateFanTypeUI(t) {
  document.getElementById('grp-fan-servo').style.display = t === 0 ? '' : 'none';
  document.getElementById('grp-fan-pwm').style.display   = t === 1 ? '' : 'none';
  document.getElementById('grp-fan-onoff').style.display = t === 2 ? '' : 'none';
}
function setGlowCurrentEnabled(en) {
  if (!cfg.actuators) cfg.actuators = {};
  if (!cfg.actuators.glow_plug) cfg.actuators.glow_plug = {};
  cfg.actuators.glow_plug.has_current = en;   // independent of glow type (plain/wet)
  const row = (registryRoot().outputs || []).find(c => registryCoreActuatorKey(c) === 'glow_plug');
  if (row) row.has_current = !!en;
  setOptionalGroupVisible('grp-glowcurrent', en);
  refreshAllPins(); dirty();
}
function setGlowType(type) {
  if (!cfg.actuators) cfg.actuators = {};
  if (!cfg.actuators.glow_plug) cfg.actuators.glow_plug = {};
  // Plain(0) or Wet(2). Current sensing is the separate "Enable current
  // sensing" checkbox (has_current), not a glow type.
  cfg.actuators.glow_plug.type = (Number(type) === 2) ? 2 : 0;
  setOptionalGroupVisible('grp-wetglow', cfg.actuators.glow_plug.type === 2);
  refreshAllPins(); dirty();
}
function setGlowOutputType(type) {
  if (!cfg.actuators) cfg.actuators = {};
  if (!cfg.actuators.glow_plug) cfg.actuators.glow_plug = {};
  cfg.actuators.glow_plug.output_type = Math.max(0, Math.min(1, Number(type) || 0));
  updateGlowOutputModeUI();
  dirty();
}
function setOilPumpCurrentEnabled(en) {
  if (!cfg.actuators) cfg.actuators = {};
  if (!cfg.actuators.oil_pump) cfg.actuators.oil_pump = {};
  cfg.actuators.oil_pump.has_current = en;
  const row = (registryRoot().outputs || []).find(c => registryCoreActuatorKey(c) === 'oil_pump');
  if (row) row.has_current = !!en;
  setOptionalGroupVisible('grp-oilpumpcurrent', en);
  refreshAllPins(); dirty();
}
// Write an oil-pump inline current sensor field into actuators.oil_pump
// field: 'pin' | 'mv_a' | 'zero_v' | 'max_a'
async function setActCurrentSensor(actKey, field, val) {
  if (field === 'pin' && !await acceptPinChange(val)) { refreshAllPins(); return; }
  if (!cfg.actuators) cfg.actuators = {};
  if (!cfg.actuators[actKey]) cfg.actuators[actKey] = {};
  const keyMap = { pin: 'current_pin', mv_a: 'current_mv_a',
                   zero_v: 'current_zero_v', max_a: 'current_max_a',
                   ready_a: 'current_ready_a' };
  const key = keyMap[field] || field;
  cfg.actuators[actKey][key] = val;
  const row = (registryRoot().outputs || []).find(c => registryCoreActuatorKey(c) === actKey);
  if (row && ['current_pin','current_mv_a','current_zero_v','current_max_a','current_trip_delay_ms'].includes(key)) row[key] = val;
  if (field === 'pin') refreshAllPins();
  dirty();
}
function setIgniterCurrentEnabled(en) {
  if (!cfg.actuators) cfg.actuators = {};
  if (!cfg.actuators.igniter) cfg.actuators.igniter = {};
  cfg.actuators.igniter.has_current = en;
  const row = (registryRoot().outputs || []).find(c => registryCoreActuatorKey(c) === 'igniter');
  if (row) row.has_current = !!en;
  refreshAllPins(); dirty();
}

function setIgniterMode(mode) {
  setAct('igniter','pwm',  mode === 'pwm');
  setAct('igniter','coil', mode === 'coil');
  // Auto-enable/disable the igniter 1 current sensor alongside the car coil mode
  setIgniterCurrentEnabled(mode === 'coil');
  updateIgniterModeUI(mode);
}
function updateIgniterModeUI(mode) {
  document.getElementById('grp-ign-relay').style.display    = mode === 'relay' ? '' : 'none';
  document.getElementById('grp-ign-pwm').style.display      = mode === 'pwm'   ? '' : 'none';
  document.getElementById('grp-ign-coil').style.display     = mode === 'coil'  ? '' : 'none';
  document.getElementById('grp-ign-coil-cur').style.display = mode === 'coil'  ? '' : 'none';
}
function setIgniter2Mode(mode) {
  setAct('igniter2','pwm',  mode === 'pwm');
  setAct('igniter2','coil', mode === 'coil');
  // Auto-enable/disable the secondary igniter current sensor (stored under actuators.igniter2)
  if (!cfg.actuators) cfg.actuators = {};
  if (!cfg.actuators.igniter2) cfg.actuators.igniter2 = {};
  cfg.actuators.igniter2.has_current = (mode === 'coil');
  const row = (registryRoot().outputs || []).find(c => registryCoreActuatorKey(c) === 'igniter2');
  if (row) row.has_current = mode === 'coil';
  refreshAllPins(); dirty();
  updateIgniter2ModeUI(mode);
}
function updateIgniter2ModeUI(mode) {
  document.getElementById('grp-ign2-relay').style.display    = mode === 'relay' ? '' : 'none';
  document.getElementById('grp-ign2-pwm').style.display      = mode === 'pwm'   ? '' : 'none';
  document.getElementById('grp-ign2-coil').style.display     = mode === 'coil'  ? '' : 'none';
  document.getElementById('grp-ign2-coil-cur').style.display = mode === 'coil'  ? '' : 'none';
}
// Torque sensor type switch (ADC vs HX711)
function setTorqueType(t) {
  setSensor('torque', 'hx711', t === 1);
  updateTorqueTypeUI(t);
}
function updateTorqueTypeUI(t) {
  const isHX = t === 1;
  ['torque-adc-pin','torque-adc-scale','torque-adc-offset'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = isHX ? 'none' : '';
  });
  ['torque-hx-dt','torque-hx-clk','torque-hx-scale','torque-hx-zero'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = isHX ? '' : 'none';
  });
  const lbl = document.getElementById('torque-type-label');
  if (lbl) lbl.textContent = isHX ? '(HX711 load cell)' : '(ADC, 0–3.3 V output)';
}
