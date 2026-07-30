// ═══════════════════════════════════════════════════
//  PIN CONFLICT DETECTION
// ═══════════════════════════════════════════════════
// Maps each pin select element id → human-readable label for conflict messages
const PIN_SELECT_LABELS = {
  'f-stop-pin':       'Stop Switch',
  'f-start-pin':      'Start Switch',
  'f-n1-pin':         'N1 RPM',
  'f-n2-pin':         'N2 RPM',
  'f-tot-clk':        'TOT CLK',
  'f-tot-cs':         'TOT CS',
  'f-tot-miso':       'TOT MISO',
  'f-tot-mosi':       'TOT MOSI',
  'f-tit-clk':        'TIT CLK',
  'f-tit-cs':         'TIT CS',
  'f-tit-miso':       'TIT MISO',
  'f-tit-mosi':       'TIT MOSI',
  'f-oilpress-pin':   'Oil Pressure',
  'f-flame-pin':      'Flame Detector',
  'f-thinput-pin':    'Throttle Input',
  'f-idiinput-pin':   'Idle Input',
  'f-fuelflow-pin':   'Fuel Flow',
  'f-p1-pin':         'P1 Pressure',
  'f-p2-pin':         'P2 Pressure',
  'f-oiltemp-pin':    'Oil Temp (NTC)',
  'f-oiltemp-ow-pin': 'Oil Temp (DS18B20)',
  'f-oiltemp-clk':    'Oil Temp CLK',
  'f-oiltemp-cs':     'Oil Temp CS',
  'f-oiltemp-miso':   'Oil Temp MISO',
  'f-oiltemp-mosi':   'Oil Temp MOSI',
  'f-battvolt-pin':   'Battery Voltage',
  'f-torque-pin':     'Torque Sensor (ADC)',
  'f-torque-dt':      'Torque HX711 DT',
  'f-torque-clk':     'Torque HX711 CLK',
  'f-fuelpress-pin':  'Fuel Pressure',
  'f-glowcur-pin':      'Glow Current',
  'f-igncur-pin':       'Igniter 1 Current',
  'f-ign2cur-pin':      'AB / Pilot Igniter Current',
  'f-oilpumpcur-pin':   'Oil Pump Current',
  'f-thr-pin':        'Main Fuel Pump / Metering Output',
  'f-str-pin':        'Starter ESC',
  'f-op-pin':         'Oil Pump',
  'f-oscav-pin':      'Oil Scavenge Pump',
  'f-fsol-pin':       'Main Fuel Shutoff',
  'f-ign-pin':        'Igniter',
  'f-ign2-pin':       'AB / Pilot Igniter',
  'f-sen-pin':        'Starter Enable Output',
  'f-abs-pin':        'Afterburner Fuel Valve',
  'f-abp-pin':        'AB Fuel Pump',
  'f-airs-pin':       'Air Starter Valve',
  'f-fan-pin':        'Cooling Fan',
  'f-fp2-pin':        'Pilot / Auxiliary Fuel Pump',
  'f-bleed-pin':      'Bleed Valve',
  'f-pp-pin':         'Prop Pitch',
  'f-glow-pin':       'Glow Plug',
  'f-wetglow-pin':    'Wet Glow Fuel',
  'f-led-pin':        'Status LED',
  'f-buzzer-pin':     'Buzzer',
  'f-cl-tx':          'Cluster Serial TX',
  'f-cl-rx':          'Cluster Serial RX',
  'f-mav-tx':         'MAVLink TX',
  'f-ab-sw-pin':      'AB Switch',
  'f-ab-inp-pin':     'AB Input',
  'f-ab-arm-pin':     'AB Arm Switch',
  'f-ab-fl-pin':      'AB Flame Sensor',
};

let _pinConflictBlocking = false;

function shareableSpiEntries(entries) {
  const groups = [
    ['f-tot-clk','f-tit-clk','f-oiltemp-clk'],
    ['f-tot-miso','f-tit-miso','f-oiltemp-miso'],
    ['f-tot-mosi','f-tit-mosi','f-oiltemp-mosi']
  ];
  return groups.some(group => entries.length > 1 && entries.every(e => group.includes(e.selId)));
}

function checkPinConflicts() {
  // Use the same hardware-object inventory as save preflight. Hidden legacy
  // controls must never invent conflicts for an inactive sensor mode or an AB
  // trigger source that is not selected.
  const conflicts = _checkGpioConflicts().map(c => ({
    gpio:c.pin,
    entries:c.names.map(label => ({selId:'', label}))
  }));

  // Highlight conflicting fields
  const allSelIds = new Set(Object.keys(PIN_SELECT_LABELS));
  for (let i = 0; i < 4; i++) allSelIds.add('f-di' + i + '-pin');
  for (const selId of allSelIds) {
    const el = document.getElementById(selId);
    if (el) el.style.outline = '';
  }
  const conflictingIds = new Set();
  for (const { entries } of conflicts) {
    for (const { selId } of entries) if (selId) conflictingIds.add(selId);
  }
  for (const selId of conflictingIds) {
    const el = document.getElementById(selId);
    if (el) el.style.outline = '2px solid var(--red)';
  }

  // Show/hide banner
  const banner = document.getElementById('pin-conflict-banner');
  if (conflicts.length > 0) {
    const msgs = conflicts.map(({ gpio, entries }) => {
      const names = entries.map(e => e.label).join(' and ');
      return `⚠ Pin conflict: GPIO ${gpio} assigned to both ${names}`;
    });
    banner.innerHTML = msgs.map(escapeHtmlText).join('<br>');
    banner.style.display = '';
    _pinConflictBlocking = true;
  } else {
    banner.style.display = 'none';
    _pinConflictBlocking = false;
  }
  updateSaveButton();
}

// ── Per-field changed-state tracking ─────────────────────────
// Tracks two sets of elements:
//   f-*  : regular inputs/selects — yellow border on the control itself
//   en-* : sensor/actuator enable checkboxes — yellow border on the
//           containing .hw-item-card so the whole card highlights
let _fieldSnap = {};
let _workflowSnap = {controllers:{}, safety:{}, devices:{}, controls:{}, labels:{}, ab_trigger:{}};

function _snapshotFields() {
  _fieldSnap = {};
  document.querySelectorAll(
    'input[id^="f-"], select[id^="f-"], textarea[id^="f-"], input[id^="en-"]'
  ).forEach(el => {
    _fieldSnap[el.id] = (el.type === 'checkbox') ? el.checked : el.value;
  });
  _registrySnap = JSON.parse(JSON.stringify(registryRoot()));
  _workflowSnap = JSON.parse(JSON.stringify({
    controllers: cfg.controllers || {},
    safety: cfg.safety || {},
    devices: {
      cluster_serial: cfg.cluster_serial || {},
      mavlink: cfg.mavlink || {},
      status_led: cfg.actuators?.status_led || {},
      buzzer: cfg.buzzer || {}
    },
    controls: cfg.controls || {},
    ab_trigger: cfg.ab_trigger || {},
    labels: {
      stop: cfg.labels?.stop,
      start: cfg.labels?.start
    }
  }));
}

function _refreshChangedBorders() {
  document.querySelectorAll('.hw-item-card.field-change-parent').forEach(card => card.classList.remove('field-change-parent', 'field-changed'));
  const changedCards = new Set();
  // f-* : border on the control itself
  document.querySelectorAll('input[id^="f-"], select[id^="f-"], textarea[id^="f-"]')
    .forEach(el => {
      if (!(el.id in _fieldSnap)) return;
      const cur = (el.type === 'checkbox') ? el.checked : el.value;
      const changed = String(cur) !== String(_fieldSnap[el.id]);
      el.classList.toggle('field-changed', changed);
      const card = el.closest('.hw-item-card');
      if (changed && card) changedCards.add(card);
    });
  // en-* : border on the nearest .hw-item-card
  document.querySelectorAll('input[id^="en-"]').forEach(el => {
    if (!(el.id in _fieldSnap)) return;
    const changed = String(el.checked) !== String(_fieldSnap[el.id]);
    let card = el.parentElement;
    while (card && !card.classList.contains('hw-item-card')) card = card.parentElement;
    if (changed && card) changedCards.add(card);
  });
  changedCards.forEach(card => card.classList.add('field-change-parent', 'field-changed'));
}

function _clearChangedBorders() {
  document.querySelectorAll('.field-changed').forEach(el => el.classList.remove('field-changed'));
}

function _changedFieldCount() {
  let count = 0;
  document.querySelectorAll(
    'input[id^="f-"], select[id^="f-"], textarea[id^="f-"], input[id^="en-"]'
  ).forEach(el => {
    if (!(el.id in _fieldSnap)) return;
    if (el.offsetParent === null) return;
    const cur = (el.type === 'checkbox') ? el.checked : el.value;
    if (String(cur) !== String(_fieldSnap[el.id])) count++;
  });
  count += _registryDiffRows('input').length + _registryDiffRows('output').length +
    _registryBindingDiffRows().length + _workflowDiffRows().length + _deviceDiffRows().length +
    _controlDiffRows().length + _abTriggerDiffRows().length;
  return count;
}

function dirty() {
  _hwDirty = true;
  document.getElementById('save-msg').textContent = 'Unsaved changes — save to apply';
  const changed = _changedFieldCount();
  document.getElementById('save-msg').textContent = changed
    ? `${changed} unsaved field change${changed === 1 ? '' : 's'} — review before saving`
    : 'Unsaved inventory changes — review before saving';
  document.querySelector('.save-bar').classList.add('is-dirty');
  document.getElementById('btn-discard').disabled = false;
  _refreshChangedBorders();
  renderHardwareWorkflowSummaries();
  checkPinConflicts();
  updateSaveButton();
}
function clearDirty() {
  _hwDirty = false;
  document.querySelector('.save-bar').classList.remove('is-dirty');
  _snapshotFields();       // new baseline = what was just saved
  _clearChangedBorders();  // remove all changed-field highlights
  document.getElementById('btn-discard').disabled = true;
  updateSaveButton();
}
function updateSaveButton() {
  const locked = (engineMode !== 'STANDBY' && engineMode !== 'FAULT');
  const hasConflict = _pinConflictBlocking;
  const registryInvalid = cfg ? registryInvalidChannels().length > 0 : false;
  document.getElementById('btn-save').disabled = !_hwDirty || locked || hasConflict || registryInvalid;
  document.getElementById('standby-warn').style.display = locked ? '' : 'none';
}

function ensureAbTrig() { if (!cfg.ab_trigger) cfg.ab_trigger = {}; return cfg.ab_trigger; }
function ensureAbFlame() { if (!cfg.ab_flame) cfg.ab_flame = {}; return cfg.ab_flame; }
async function setAbTrig(key, val)     {
  if (isPinField(key) && !await acceptPinChange(val)) { refreshAllPins(); return; }
  ensureAbTrig()[key] = val; refreshAllPins(); dirty();
}
function setAbTrigBool(key, val) { ensureAbTrig()[key] = val; dirty(); }
async function setAbFlame(key, val)    {
  if (isPinField(key) && !await acceptPinChange(val)) { refreshAllPins(); return; }
  ensureAbFlame()[key] = val; refreshAllPins(); dirty();
}
function setAbFlameBool(key, val){ ensureAbFlame()[key] = val; dirty(); }

function updateFuelFlowTypeUI() {
  const type = +(document.getElementById('f-fuelflow-type')?.value || 0);
  const pplGrp  = document.getElementById('grp-fuelflow-ppl');
  const pinHint = document.getElementById('f-fuelflow-pin-hint');
  if (pplGrp)  pplGrp.style.display  = type === 1 ? '' : 'none';
  if (pinHint) pinHint.textContent = type === 1
    ? 'Any digital-capable GPIO supported by your selected ESP32 target.'
    : 'Use an ADC1-capable GPIO for analog voltage sensors.';
  // Rebuild pin list with appropriate filter
  const curPin = cfg.sensors?.fuel_flow?.pin;
  refreshPinSel('f-fuelflow-pin', type === 1 ? 'any' : 'adc', curPin);
}

function setAbTrigSrc(v) {
  const abt = ensureAbTrig();
  abt.source = v;
  if (v === 0) abt.requires_arm = false;
  updateAbTrigUI(v);
  updateAbArmUI(!!abt.requires_arm);
  refreshAllPins();
  dirty();
}
function setAbInputType(rcPwm) {
  setAbTrigBool('input_rc_pwm', rcPwm);
  updateAbInputTypeUI(rcPwm);
  refreshPinSel('f-ab-inp-pin', rcPwm ? 'in' : 'adc', (cfg.ab_trigger || {}).input_pin);
  refreshAllPins();
}
function abThresholdRaw() {
  const abt = cfg.ab_trigger || {};
  return Math.max(0, Math.min(4095, Math.round(abt.input_threshold ?? 2048)));
}
function abThresholdToDisplay(raw, rcPwm) {
  return rcPwm ? Math.round(raw * 100 / 4095) : raw;
}
function setAbInputThresholdDisplay(val) {
  const abt = ensureAbTrig();
  const rcPwm = !!abt.input_rc_pwm;
  abt.input_threshold = rcPwm
    ? Math.max(0, Math.min(4095, Math.round(Math.max(0, Math.min(100, val)) * 4095 / 100)))
    : Math.max(0, Math.min(4095, Math.round(val)));
  dirty();
}
function setAbWorkflowThreshold(val) {
  const abt = ensureAbTrig();
  const n = Number(val);
  abt.input_threshold = abt.input_rc_pwm
    ? Math.max(0, Math.min(4095, Math.round(Math.max(0, Math.min(100, n)) * 4095 / 100)))
    : Math.max(0, Math.min(4095, Math.round(Math.max(0, Math.min(3.3, n)) * 4095 / 3.3)));
  dirty();
}
function setAbProfileThreshold(val) {
  const abt = ensureAbTrig();
  const n = Math.max(0, Math.min(100, Number(val) || 0));
  abt.input_threshold = Math.round(n * 4095 / 100);
  dirty();
}
function updateAbInputTypeUI(rcPwm) {
  ['grp-ab-inp-min-us', 'grp-ab-inp-max-us'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = rcPwm ? '' : 'none';
  });
  const lbl = document.getElementById('lbl-ab-inp-thr');
  const desc = document.getElementById('desc-ab-inp-thr');
  const inp = document.getElementById('f-ab-inp-thr');
  if (lbl) lbl.textContent = rcPwm ? 'Trigger threshold (%)' : 'Trigger threshold (ADC count)';
  if (desc) desc.textContent = rcPwm
    ? 'Percent of the configured PWM pulse range. Stored internally as normalized 0-4095.'
    : 'Raw ADC threshold, 0-4095.';
  if (inp) {
    inp.min = 0;
    inp.max = rcPwm ? 100 : 4095;
    inp.step = rcPwm ? 1 : 1;
    inp.value = abThresholdToDisplay(abThresholdRaw(), rcPwm);
  }
}
function updateAbTrigUI(src) {
  const grpSw  = document.getElementById('grp-ab-sw');
  const grpInp = document.getElementById('grp-ab-inp');
  const grpArm = document.getElementById('grp-ab-arm');
  const help = document.getElementById('ab-trigger-help');
  if (grpSw)  grpSw.style.display  = (src === 2) ? '' : 'none';
  if (grpInp) grpInp.style.display = '';
  updateAbInputTypeUI(!!(cfg.ab_trigger || {}).input_rc_pwm);
  if (grpArm) grpArm.style.display = (src >= 1)  ? '' : 'none';
  if (help) {
    help.textContent = [
      'Manual mode only fires from the web UI or a command.',
      'Afterburner requests when main throttle passes the configured AB threshold.',
      'Afterburner requests while the dedicated switch is active.',
      'Afterburner requests when the dedicated analog or servo input passes its threshold.'
    ][src] || '';
  }
}
function updateAbArmUI(checked) {
  const pins = document.getElementById('grp-ab-arm-pins');
  if (pins) pins.style.display = checked ? '' : 'none';
}
function updateAbFlameUI(checked) {
  const grp = document.getElementById('grp-ab-flame');
  if (grp) grp.style.display = checked ? '' : 'none';
}


function updateFeaturesUI() {
  const hasAB  = hardwareHasAfterburner();
  const has2sh = registryHasPurpose('input','n2_speed');
  // N2 sensor
  const n2sec = document.getElementById('section-n2rpm');
  if (n2sec) n2sec.style.display = has2sh ? '' : 'none';
  // AB actuator block
  const abActSec = document.getElementById('section-ab-actuators');
  if (abActSec) abActSec.style.display = hasAB ? '' : 'none';
  // Labels: AB / pilot igniter
  const lblIgn2 = document.getElementById('lbl-igniter2');
  if (lblIgn2) lblIgn2.textContent = hasAB ? 'Afterburner Igniter' : 'AB / Pilot Igniter';
  // Labels: AB Fuel Pump / auxiliary fuel pump output
  const lblAbp = document.getElementById('lbl-abpump');
  if (lblAbp) lblAbp.textContent = hasAB ? 'Afterburner Fuel Pump Motor / ESC' : 'Pilot / Auxiliary Fuel Pump Motor / ESC';
}
