// ------ App state ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
let hwCfg = {};    // hardware section of ecu_config.json
let cfg   = {};    // settings section of ecu_config.json
let loadedHwCfg = {};
let loadedCfg = {};
let _seqDirty = false;
let paramVals = {}; // shared block settings plus per-slot TimedDelay edits
let activeTab = 'startup';
let engineMode = 'STANDBY';
let ws;
let lastIdleRaw = null;

const SEQUENCE_INPUT_PURPOSE = {
  n1_rpm:'n1_speed', n2_rpm:'n2_speed', tot:'tot', tit:'tit', oil_press:'oil_pressure',
  oil_temp:'oil_temperature', fuel_press:'fuel_pressure', fuel_flow:'fuel_flow',
  p1:'p1_pressure', p2:'p2_pressure', torque:'torque', batt_voltage:'battery_voltage',
  flame:'flame', ab_flame:'ab_flame', throttle_input:'throttle', idle_input:'idle'
};
const SEQUENCE_OUTPUT_PURPOSE = {
  throttle:'main_fuel', starter:'starter', starter_en:'starter_enable', oil_pump:'oil_pump',
  fuel_sol:'fuel_shutoff', igniter:'igniter', igniter2:'ab_igniter', glow_plug:'glow_plug',
  prop_pitch:'prop_pitch', cool_fan:'cooling_fan', oil_scavenge_pump:'scavenge_pump',
  bleed_valve:'valve', fuel_pump2:'fuel_pump', airstarter_sol:'air_starter',
  ab_sol:'ab_valve', ab_pump:'ab_pump', drain_valve:'drain_valve'
};
function sensorEnabled(key) {
  return !!registryInputPurpose(SEQUENCE_INPUT_PURPOSE[key]);
}
function actuatorEnabled(key) {
  const channel = registryOutputPurpose(SEQUENCE_OUTPUT_PURPOSE[key]);
  return key === 'bleed_valve' ? channel?.id === 'bleed_valve' : !!channel;
}
function actuatorIsRelay(key) {
  const registry = registryOutputPurpose(SEQUENCE_OUTPUT_PURPOSE[key]);
  return !!registry && [4,11].includes(Number(registry.driver));
}
function actuatorHasProportionalOutput(key) {
  const registry = registryOutputPurpose(SEQUENCE_OUTPUT_PURPOSE[key]);
  return !!registry && [5,6].includes(Number(registry.driver));
}
function registryLabel(c, fallback) {
  const name = (c?.name && c.name.trim()) || c?.id || fallback;
  return String(name || '').includes('_') ? plainRegistryName(name, fallback) : name;
}
function hasIgnitionOutput(hw = hwCfg) {
  return !!(registryOutputPurpose('igniter') || registryOutputPurpose('ab_igniter') || registryOutputPurpose('glow_plug'));
}
function demandText(key, pct, label = 'on') {
  return actuatorIsRelay(key) ? label : `${pct}%`;
}

// ── Display-unit helpers (this page does not load app.js) ────
// Read-only mirror of app.js's unit preference: same localStorage key
// ('ot_units'), same conversions, so seq temp params follow the site-wide
// °C/°F preference. This page never CHANGES the preference.
// These were referenced but never defined — the resulting ReferenceError
// was swallowed by the boot try/catch and silently blanked the AB criteria
// and afterburner criteria rendering.
function tempUnit() {
  try { return (JSON.parse(localStorage.getItem('ot_units') || '{}').temp) || 'C'; }
  catch (e) { return 'C'; }
}
function toDispTemp(c)   { return tempUnit() === 'F' ? c * 9 / 5 + 32 : c; }
function fromDispTemp(v) { return tempUnit() === 'F' ? (v - 32) * 5 / 9 : v; }
function dispTempUnit()  { return tempUnit() === 'F' ? '°F' : '°C'; }

function seqRound(value) {
  return String(Math.round(Number(value) * 1000) / 1000);
}

function seqDisplayValue(p, value) {
  if (p.zeroOff && Number(value) === 0) return '0';
  if (p.unitType === 'temp') return seqRound(toDispTemp(Number(value ?? 0)));
  if (p.unitType === 'duration_ms_as_s') return seqRound(Number(value ?? 0) / 1000);
  return value;
}

function seqStoredValue(p, rawVal) {
  const parsed = p.type === 'float' ? parseFloat(rawVal) : parseInt(rawVal);
  if (!Number.isFinite(parsed)) return undefined;
  if (p.zeroOff && parsed === 0) return 0;
  if (p.unitType === 'duration_ms_as_s') return Math.round(parsed * 1000);
  return p.unitType === 'temp' ? fromDispTemp(parsed) : parsed;
}

function seqDisplayAttr(p, value) {
  if (value === undefined) return '';
  if (p.zeroOff && Number(value) === 0) return '0';
  if (p.unitType === 'duration_ms_as_s') return seqRound(Number(value) / 1000);
  return p.unitType === 'temp' ? seqRound(toDispTemp(Number(value))) : String(value);
}

function seqDisplayStep(p) {
  if (p.unitType === 'duration_ms_as_s') return seqRound(Number(p.step || 100) / 1000);
  if (p.unitType === 'temp') {
    return seqRound(tempUnit() === 'F' ? Number(p.step || 1) * 9 / 5 : Number(p.step || 1));
  }
  return String(p.step || 1);
}

function seqUnitLabel(p) {
  if (p.unitType === 'temp') return dispTempUnit();
  return p.unit || '';
}

function fmtSeqTemp(value, digits = 0) {
  return toDispTemp(Number(value ?? 0)).toFixed(digits) + ' ' + dispTempUnit();
}

const SEQ_ACTION_KEYS = {
  startup:     { enter:'startup_enter_actions',  exit:'startup_exit_actions' },
  shutdown:    { enter:'shutdown_enter_actions', exit:'shutdown_exit_actions' },
  afterburner: { enter:'ab_enter_actions',       exit:'ab_exit_actions' },
  'ab-shut':   { enter:'ab_shut_enter_actions',  exit:'ab_shut_exit_actions' },
};
const ACT_ENUM = {
  cool_fan:0, bleed_valve:1, fuel_pump2:2, oil_scavenge_pump:3,
  throttle:4, starter:5, starter_en:6, oil_pump:7,
  fuel_sol:8, igniter:9, igniter2:10, ab_sol:11, ab_pump:12,
  airstarter_sol:15, glow_plug:16, prop_pitch:17,
};
const ACT_KEY_BY_ENUM = Object.fromEntries(Object.entries(ACT_ENUM).map(([k,v]) => [v,k]));
function actionKey(tab, phase) {
  return SEQ_ACTION_KEYS[tab]?.[phase];
}
function ensureActionSlots(tab) {
  const seq = hwCfg[seqKey(tab)] || [];
  for (const phase of ['enter','exit']) {
    const key = actionKey(tab, phase);
    if (!key) continue;
    if (!Array.isArray(hwCfg[key])) hwCfg[key] = [];
    while (hwCfg[key].length < seq.length) hwCfg[key].push([]);
    if (hwCfg[key].length > seq.length) hwCfg[key].length = seq.length;
    for (let i = 0; i < seq.length; i++) {
      if (!Array.isArray(hwCfg[key][i])) hwCfg[key][i] = [];
      hwCfg[key][i] = hwCfg[key][i].filter(a => actionAllowed(a)).slice(0, 4);
    }
  }
}
function sideActionMeta(action) {
  const acts = getEnabledActuators();
  const target = String(action?.target || '');
  if (target) return acts.find(a => String(a.target || '') === target);
  const key = ACT_KEY_BY_ENUM[Number(action?.act)];
  return key ? acts.find(a => a.key === key) : undefined;
}
function actionAllowed(action) {
  if (!action || typeof action !== 'object') return false;
  const target = String(action.target || '').trim();
  if (target) return target.length <= 64;
  return Object.prototype.hasOwnProperty.call(ACT_KEY_BY_ENUM, Number(action.act));
}
function actionDisplayValue(action, value) {
  const meta = sideActionMeta(action);
  return meta?.mode === 'pct' ? Math.round((Number(value) || 0) * 100) : ((Number(value) || 0) >= 0.5 ? 1 : 0);
}
function actionStoredValue(action, raw) {
  const meta = sideActionMeta(action);
  return meta?.mode === 'pct' ? Math.max(0, Math.min(1, (Number(raw) || 0) / 100)) : (Number(raw) ? 1 : 0);
}

// ------ Tab switching ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
function switchTab(tab) {
  activeTab = tab;
  hideBlockInfo();
  const tabs = ['startup','shutdown','afterburner','rules'];
  document.querySelectorAll('.seq-tab').forEach((btn) => {
    const t = btn.getAttribute('onclick')?.match(/switchTab\('(\w+)'\)/)?.[1];
    if (t) btn.classList.toggle('active', t === tab);
  });
  tabs.forEach(t => {
    const el = document.getElementById('tab-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
}
function revealSequenceDeepLink() {
  const id = decodeURIComponent(String(location.hash || '').replace(/^#/, ''));
  if (!id) return;
  const tab = id.startsWith('tab-') ? id.slice(4) : '';
  if (['startup','shutdown','afterburner'].includes(tab)) switchTab(tab);
  const target = document.getElementById(id);
  if (!target || target.style.display === 'none') return;
  document.querySelectorAll('.deep-link-target').forEach(el => el.classList.remove('deep-link-target'));
  target.classList.add('deep-link-target');
  requestAnimationFrame(() => target.scrollIntoView({behavior:'smooth', block:'start'}));
}
window.addEventListener('hashchange', revealSequenceDeepLink);

// ------ Load data from device ------------------------------------------------------------------------------------------------------------------------------------------------------
async function loadAll() {
  setSaveStatus('Loading...');
  try {
    hwCfg = await fetchJsonWithRetry('/api/hardware');
    cfg   = await fetchJsonWithRetry('/api/config');
    loadedHwCfg = cloneSequenceJson(hwCfg);
    loadedCfg = cloneSequenceJson(cfg);
    // Rebuild runtime custom block defs from raw stored defs
    customBlocks = {};
    if (hwCfg.custom_blocks) {
      for (const [k, def] of Object.entries(hwCfg.custom_blocks)) {
        customBlocks[k] = buildRuntimeBlockDef(k, def);
      }
    }
    migrateLegacyDeviceTargets();
    buildParamVals();
    await refreshSequenceLiveData();
    render('startup', lastIdleRaw);
    render('shutdown', lastIdleRaw);
    render('afterburner', lastIdleRaw);
    render('ab-shut', lastIdleRaw);
    populateAddSelects();
    buildAbCriteriaHtml();
    // Show/hide afterburner tab based on hardware feature flag
    const abTabBtn = document.getElementById('tab-btn-afterburner');
    if (abTabBtn) abTabBtn.style.display = sequenceHasAfterburner() ? '' : 'none';
    revealSequenceDeepLink();
    // Keep the post-normalization baseline. Saving can then preserve unrelated
    // settings changed by another browser while this page was open.
    clearSequenceDirty('No unsaved changes');
  } catch(e) {
    setSaveStatus('Warning: Load failed: ' + e.message);
  }
}

async function fetchJsonWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!r.ok) throw new Error(url + ' returned HTTP ' + r.status);
    const text = await r.text();
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithRetry(url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchJsonWithTimeout(url);
    } catch (e) {
      lastError = e;
      await new Promise(resolve => setTimeout(resolve, 200 + i * 300));
    }
  }
  throw lastError;
}

// Build paramVals from the settings section using each block's configKey mapping.
function buildParamVals() {
  // Walk each block and each param, read from cfg using section path
  const allBlocks = {...BLOCKS, ...customBlocks};
  for (const [bname, bdef] of Object.entries(allBlocks)) {
    for (const p of bdef.params) {
      const vk = bname + '.' + p.key;
      if (p.configKey) {
        // Read from cfg using configKey (which matches the JSON key in config sections)
        const v = findConfigVal(p.configKey);
        paramVals[vk] = (v !== undefined) ? v : p.def;
      } else {
        // No configKey - use default (preserve existing bool values across renders)
        if (paramVals[vk] === undefined) paramVals[vk] = p.def;
      }
    }
  }
}

function findConfigVal(key) {
  const map = CONFIG_SECTIONS[key];
  if (!map) return undefined;
  const parts = map.sec.split('.');
  let obj = cfg;
  for (const p of parts) obj = obj?.[p];
  return obj?.[map.key];
}

function setConfigVal(key, val) {
  const map = CONFIG_SECTIONS[key];
  if (!map) return;
  const parts = map.sec.split('.');
  let obj = cfg;
  for (let i=0; i<parts.length; i++) {
    if (obj[parts[i]] === undefined) obj[parts[i]] = {};
    if (i < parts.length-1) obj = obj[parts[i]];
    else obj[parts[i]][map.key] = val;
  }
}

// ------ Render a sequence tab ------------------------------------------------------------------------------------------------------------------------------------------------------
function seqKey(tab) {
  if (tab === 'startup')   return 'startup_seq';
  if (tab === 'shutdown')  return 'shutdown_seq';
  if (tab === 'ab-shut')   return 'ab_shut_seq';
  return 'ab_seq';  // 'afterburner'
}
function delaySeqKey(tab) {
  if (tab === 'startup') return 'startup_delay_ms';
  if (tab === 'shutdown') return 'shutdown_delay_ms';
  if (tab === 'ab-shut') return 'ab_shut_delay_ms';
  return 'ab_delay_ms';
}
function ignitionTargetSeqKey(tab) {
  if (tab === 'startup') return 'startup_ignition_target';
  if (tab === 'shutdown') return 'shutdown_ignition_target';
  if (tab === 'ab-shut') return 'ab_shut_ignition_target';
  return 'ab_ignition_target';
}
function deviceTargetSeqKey(tab) {
  if (tab === 'startup') return 'startup_device_target';
  if (tab === 'shutdown') return 'shutdown_device_target';
  if (tab === 'ab-shut') return 'ab_shut_device_target';
  return 'ab_device_target';
}
function ensureDelaySlots(tab) {
  const seq = hwCfg[seqKey(tab)] || [];
  const key = delaySeqKey(tab);
  if (!Array.isArray(hwCfg[key])) hwCfg[key] = [];
  while (hwCfg[key].length < seq.length) hwCfg[key].push(0);
  if (hwCfg[key].length > seq.length) hwCfg[key].length = seq.length;
}
function ensureIgnitionTargetSlots(tab) {
  const seq = hwCfg[seqKey(tab)] || [];
  const key = ignitionTargetSeqKey(tab);
  if (!Array.isArray(hwCfg[key])) hwCfg[key] = [];
  while (hwCfg[key].length < seq.length) hwCfg[key].push(0);
  if (hwCfg[key].length > seq.length) hwCfg[key].length = seq.length;
}
function ensureDeviceTargetSlots(tab) {
  const seq = hwCfg[seqKey(tab)] || [];
  const key = deviceTargetSeqKey(tab);
  if (!Array.isArray(hwCfg[key])) hwCfg[key] = [];
  while (hwCfg[key].length < seq.length) hwCfg[key].push('');
  if (hwCfg[key].length > seq.length) hwCfg[key].length = seq.length;
}
function timedDelayValue(tab, idx) {
  ensureDelaySlots(tab);
  return hwCfg[delaySeqKey(tab)][idx] || cfg?.sequence?.startup?.timed_delay_ms || 1000;
}

function _openBlockKeys(tab) {
  const list = document.getElementById('list-' + tab);
  if (!list) return new Set();
  return new Set(Array.from(list.querySelectorAll('.block-card'))
    .filter(card => card.querySelector('.block-params.open'))
    .map(card => `${card.dataset.block}:${card.dataset.idx}`));
}

function render(tab, idleRaw, openKeys = new Set()) {
  const key = seqKey(tab);
  const seq  = hwCfg[key] || [];
  ensureDelaySlots(tab);
  ensureIgnitionTargetSlots(tab);
  ensureDeviceTargetSlots(tab);
  ensureActionSlots(tab);
  const list = document.getElementById('list-' + tab);
  list.innerHTML = '';
  seq.forEach((bname, idx) => {
    const card = buildCard(bname, idx, tab);
    if (openKeys.has(`${bname}:${idx}`)) card.querySelector('.block-params')?.classList.add('open');
    list.appendChild(card);
  });
  // Append final state summary card - pass live idle raw if available
  const stateCard = buildFinalStateCard(tab, seq, idleRaw);
  if (stateCard) list.appendChild(stateCard);
}

function renderWithLiveIdle(tab) {
  refreshSequenceLiveData().finally(() => render(tab, lastIdleRaw));
}

function renderAllTabsWithLiveIdle() {
  refreshSequenceLiveData().finally(() => {
    render('startup', lastIdleRaw);
    render('shutdown', lastIdleRaw);
    render('afterburner', lastIdleRaw);
    render('ab-shut', lastIdleRaw);
  });
}

async function refreshSequenceLiveData() {
  try {
    const r = await fetch('/api/data', { cache: 'no-store' });
    if (!r.ok) return;
    const d = await r.json();
    lastIdleRaw = d.idle_input_raw ?? lastIdleRaw;
    if (d.mode !== undefined) updateEngineMode(d.mode);
    if (d.seq_issues !== undefined) _applySeqValidation(d);
  } catch (_) {}
}

function renderFast(tab) {
  const openKeys = _openBlockKeys(tab);
  render(tab, lastIdleRaw, openKeys);
  markSequenceDirty('Sequence edited — save to apply');
}

// ------ Final state summary card ---------------------------------------------------------------------------------------------------------------------------------------------
function applySideActionsToState(tab, idx, phase, state) {
  const key = actionKey(tab, phase);
  const rows = hwCfg[key]?.[idx] || [];
  for (const a of rows) {
    const actKey = ACT_KEY_BY_ENUM[Number(a.act)];
    if (!actKey) continue;
    const on = Number(a.value) >= 0.5;
    const pct = `${Math.round((Number(a.value) || 0) * 100)}%`;
    switch (actKey) {
      case 'throttle': state.throttle = pct; break;
      case 'starter': state.starter = actuatorIsRelay('starter') ? (on ? 'on' : 'off') : pct; break;
      case 'starter_en': state.starterEn = on ? 'on' : 'off'; break;
      case 'oil_pump': state.oilPump = actuatorIsRelay('oil_pump') ? (on ? 'on' : 'off') : pct; break;
      case 'fuel_sol': state.fuelSol = on ? 'open' : 'closed'; break;
      case 'igniter': state.igniter = on ? 'on' : 'off'; break;
      case 'igniter2': state.igniter2 = on ? 'on' : 'off'; break;
      case 'oil_scavenge_pump': state.oilScav = on ? 'on' : 'off'; break;
      case 'airstarter_sol': state.airstarter = on ? 'open' : 'closed'; break;
      case 'cool_fan': state.coolFan = on ? 'on' : 'off'; break;
      case 'bleed_valve': state.bleed = on ? 'open' : 'closed'; break;
      case 'glow_plug': state.glow = actuatorIsRelay('glow_plug') ? (on ? 'on' : 'off') : pct; break;
      case 'fuel_pump2': state.fuelPump2 = actuatorIsRelay('fuel_pump2') ? (on ? 'on' : 'off') : pct; break;
      case 'ab_sol': state.abSol = on ? 'open' : 'closed'; break;
      case 'ab_pump': state.abPump = actuatorIsRelay('ab_pump') ? (on ? 'on' : 'off') : pct; break;
      case 'prop_pitch': state.propPitch = actuatorIsRelay('prop_pitch') ? (on ? 'on' : 'off') : pct; break;
    }
  }
}

function setIgnitionPreviewState(state, target, on) {
  const val = on ? 'on' : 'off';
  switch (Number(target) || 0) {
    case 1: state.igniter2 = val; break;
    case 2: state.glow = val; break;
    default: state.igniter = val; break;
  }
}

function clearTrackedIgnitionPreviewState(state, trackedTargets) {
  for (const target of trackedTargets) setIgnitionPreviewState(state, target, false);
  trackedTargets.clear();
}

function buildFinalStateCard(tab, seq, idleRaw) {
  if (!seq || seq.length === 0) return null;
  const hasAct = key => actuatorEnabled(key);

  const state = {
    throttle:  '0%',
    fuelSol:   'closed',
    igniter:   'off',
    igniter2:  'off',
    starter:   'off',
    starterEn: 'off',
    oilPump:   'off',
    oilScav:   'off',
    airstarter:'closed',
    coolFan:   'off',
    bleed:     'closed',
    glow:      'off',
    fuelPump2: 'off',
    abSol:     'closed',
    abPump:    'off',
    propPitch: '0%',
  };
  // Match the firmware's device-specific normal-exit cleanup. Emergency STOP
  // and FAULT still clear every combustion output, but FlameConfirm and
  // SafetyHold release only ignition devices commanded by this sequence.
  const sequenceIgnitionTargets = new Set();

  if (tab === 'startup') {
    for (let i = 0; i < seq.length; i++) {
      const bname = seq[i];
      if (bname === 'OilPrime')     state.oilPump   = actuatorIsRelay('oil_pump') ? 'on' : 'on - pressure ctrl';
      if (bname === 'StarterSpin')  { state.starter = 'on'; state.starterEn = 'on'; }
      if (bname === 'FuelOpen')     state.fuelSol   = 'open';
      if (bname === 'FuelPulse')    state.fuelSol   = 'closed';
      if (bname === 'IgniterOn' || bname === 'PreHeat' || bname === 'PreIgnSpark') {
        const target = Number(hwCfg[ignitionTargetSeqKey(tab)]?.[i] ?? 0);
        setIgnitionPreviewState(state, target, true);
        sequenceIgnitionTargets.add(target);
      }
      if (bname === 'IgniterOff') {
        const target = Number(hwCfg[ignitionTargetSeqKey(tab)]?.[i] ?? 0);
        setIgnitionPreviewState(state, target, false);
        sequenceIgnitionTargets.delete(target);
      }
      if (bname === 'FuelSolClose') state.fuelSol   = 'closed';
      if (bname === 'StarterEnOn')  state.starterEn = 'on';
      if (bname === 'StarterEnOff') state.starterEn = 'off';
      if (bname === 'StarterOff')   state.starter   = 'off';
      if (bname === 'OilPumpOn')    state.oilPump   = demandText('oil_pump', paramVals['OilPumpOn.oil_pump_on_pct'] ?? 100);
      if (bname === 'OilPumpOff')   state.oilPump   = 'off';
      if (bname === 'OilScavengeOn')  state.oilScav = 'on';
      if (bname === 'OilScavengeOff') state.oilScav = 'off';
      if (bname === 'DrainValveOpen') state.drainValve = 'open';
      if (bname === 'DrainValveClose') state.drainValve = 'closed';
      if (bname === 'AirstarterOn')  state.airstarter = 'open';
      if (bname === 'AirstarterOff') state.airstarter = 'closed';
      if (bname === 'CoolFanOn')     state.coolFan = 'on';
      if (bname === 'CoolFanOff')    state.coolFan = 'off';
      if (bname === 'BleedOpen')     state.bleed = 'open';
      if (bname === 'BleedClose')    state.bleed = 'closed';
      if (bname === 'GlowPreheat') {
        const targetId = String(hwCfg[deviceTargetSeqKey(tab)]?.[i] || '');
        const plug = (hwCfg.channel_registry?.outputs || []).find(row => String(row.id || '') === targetId);
        const relay = plug ? [4,11].includes(Number(plug.driver)) : actuatorIsRelay('glow_plug');
        const hold = Math.round(Number(plug?.ignition_hold_demand ?? .3) * 100);
        state.glow = relay ? 'on during preheat' : `${hold}% hold`;
      }
      if (bname === 'FuelPumpRamp')  state.fuelPump2 = demandText('fuel_pump2', paramVals['FuelPumpRamp.fp2_end_pct'] ?? 80);
      if (bname === 'FuelPump2Set')  state.fuelPump2 = demandText('fuel_pump2', paramVals['FuelPump2Set.fp2_demand_pct'] ?? 0);
      if (bname === 'FuelPump2On')   state.fuelPump2 = 'on';
      if (bname === 'FuelPump2Off')  state.fuelPump2 = 'off';
      applySideActionsToState(tab, i, 'enter', state);
      if (bname === 'FuelPumpIdle') {
        const mn = cfg?.throttle?.fuel_pump_min_pct ?? 0;
        const mx = paramVals['FuelPumpIdle.fp_idle_max_pct'] ?? 50;
        state.throttle = `${mn}-${mx}%  (minimum reliable output to idle maximum; position set by idle input)`;
      }
      if (bname === 'ModifiedIdle') {
        const mul = paramVals['ModifiedIdle.modified_idle_multiplier'] ?? 1.0;
        const mn  = cfg?.throttle?.fuel_pump_min_pct ?? 0;
        const mx  = cfg?.throttle?.idle_max_pct ?? 50;
        state.throttle = `${mn}-${mx}% x${mul}  (reset to 0 on RUNNING)`;
      }
      if (bname === 'Spool') {
        const pct = cfg?.throttle?.fuel_pump_min_pct ?? 0;
        state.throttle = `${pct}%  (calibrated min-spin, held during spool)`;
        // Update starter/enable state based on exit action checkboxes
        if (paramVals['Spool.spool_cut_starter_on_exit'] ?? true)    state.starter   = 'off';
        if (paramVals['Spool.spool_cut_starter_en_on_exit'] ?? true)  state.starterEn = 'off';
      }
      if (bname === 'FlameConfirm') {
        if (paramVals['FlameConfirm.flame_turn_off_igniter'] ?? true)
          clearTrackedIgnitionPreviewState(state, sequenceIgnitionTargets);
      }
      if (bname === 'SafetyHold') {
        if (paramVals['SafetyHold.safety_turn_off_starter']    ?? false) state.starter   = 'off';
        if (paramVals['SafetyHold.safety_turn_off_starter_en'] ?? false) state.starterEn = 'off';
        if (paramVals['SafetyHold.safety_turn_off_igniter']    ?? false)
          clearTrackedIgnitionPreviewState(state, sequenceIgnitionTargets);
      }
      applySideActionsToState(tab, i, 'exit', state);
    }
    // After startup completes (RUNNING), throttle tracks idle input
    if (seq.includes('SafetyHold')) {
      const mn = cfg?.throttle?.fuel_pump_min_pct ?? 0;
      const mx = paramVals['FuelPumpIdle.fp_idle_max_pct']
              ?? cfg?.throttle?.idle_max_pct ?? 50;
      if (idleRaw != null) {
        const norm = Math.max(0, Math.min(1, idleRaw / 4095));
        const pct  = (mn + norm * (mx - mn)).toFixed(1);
        state.throttle = `${pct}%  (idle input at ${Math.round(norm*100)}%, operator controlled)`;
      } else {
        state.throttle = `${mn}-${mx}%  (min-spin to idle maximum, operator controlled)`;
      }
    }

  } else if (tab === 'shutdown') {
    // enterStandby() zeros everything after shutdown sequence. These are the
    // ECU-enforced STANDBY boundaries, not inferred sequence-card actions.
    state.throttle  = '0%';
    state.fuelSol   = 'closed';
    state.igniter   = 'off';
    state.igniter2  = 'off';
    state.starter   = 'off';
    state.starterEn = 'off';
    state.oilPump   = 'off';
    state.oilScav   = 'off';
    state.airstarter= 'closed';
    state.coolFan   = 'off';
    state.bleed     = 'closed';
    state.glow      = 'off';
    state.fuelPump2 = 'off';
    state.abSol     = 'closed';
    state.abPump    = 'off';
    state.propPitch = '0%';
  } else if (tab === 'afterburner') {
    // After Light Up completes -> AB Running
    const ab = cfg?.afterburner ?? {};
    const minP = ab.pump_min_pct ?? 80;
    const maxP = ab.pump_max_pct ?? 100;
    const pumpMode = ab.pump_control_mode ?? 0;
    const pumpStr = actuatorIsRelay('ab_pump') ? 'on'
                  : pumpMode === 2 ? `${minP}-${maxP}%  (dedicated AB input)`
                  : pumpMode === 1 ? `${minP}-${maxP}%  (follows throttle)`
                  : `${maxP}%  (fixed)`;
    const offStr  = (ab.main_fuel_offset_pct ?? 0) !== 0 ? `+${ab.main_fuel_offset_pct}%` : 'none';
    const abState = {...state, abSol:'open', abPump:pumpStr, igniter2:'off'};
    for (let i = 0; i < seq.length; i++) {
      applySideActionsToState(tab, i, 'enter', abState);
      applySideActionsToState(tab, i, 'exit', abState);
    }
    const abRows = [
      hasAct('ab_sol') ? { label:'Afterburner Fuel Valve', val:abState.abSol } : null,
      hasAct('ab_pump') ? { label:'AB Fuel Pump', val: abState.abPump } : null,
      hasAct('igniter2') ? { label:'AB Igniter', val:abState.igniter2 === 'off' ? 'off  (fired during sequence)' : abState.igniter2 } : null,
      { label:'Main Fuel Offset',   val: offStr },
    ].filter(Boolean);
    const rowsHtml2 = abRows.map(r =>
      `<div class="fs-row"><span class="fs-label">${r.label}</span><span class="fs-val">${r.val}</span></div>`
    ).join('');
    const card2 = document.createElement('div');
    card2.className = 'final-state-card';
    card2.id = 'final-state-afterburner';
    card2.innerHTML = `<div class="fs-header">After Light Up -> AB Running</div><div class="fs-grid">${rowsHtml2}</div>`;
    return card2;
  } else if (tab === 'ab-shut') {
    // After Light Off completes -> AB Off
    const abState = {...state, abSol:'closed', abPump:'off', igniter2:'off'};
    for (let i = 0; i < seq.length; i++) {
      applySideActionsToState(tab, i, 'enter', abState);
      applySideActionsToState(tab, i, 'exit', abState);
    }
    const abOffRows = [
      hasAct('ab_sol') ? { label:'Afterburner Fuel Valve',  val:abState.abSol } : null,
      hasAct('ab_pump') ? { label:'AB Fuel Pump', val:abState.abPump } : null,
      hasAct('igniter2') ? { label:'AB Igniter',   val:abState.igniter2 } : null,
      { label:'Main engine',  val:'continues running normally' },
    ].filter(Boolean);
    const rowsHtml3 = abOffRows.map(r =>
      `<div class="fs-row"><span class="fs-label">${r.label}</span><span class="fs-val">${r.val}</span></div>`
    ).join('');
    const card3 = document.createElement('div');
    card3.className = 'final-state-card';
    card3.id = 'final-state-ab-shut';
    card3.innerHTML = `<div class="fs-header">After Light Off -> AB Off</div><div class="fs-grid">${rowsHtml3}</div>`;
    return card3;
  }

  const rows = [
    hasAct('throttle') ? { label:'Main Fuel Metering Output', val: state.throttle } : null,
    hasAct('fuel_sol') ? { label:'Main Fuel Shutoff',   val: state.fuelSol } : null,
    hasAct('igniter') ? { label:'Igniter',              val: state.igniter } : null,
    hasAct('igniter2') ? { label:'Secondary Igniter', val: state.igniter2 } : null,
    hasAct('starter') ? { label:'Starter',              val: state.starter } : null,
    hasAct('starter_en') ? { label:'Starter Enable',    val: state.starterEn } : null,
    hasAct('oil_pump') ? { label:'Oil Pump',            val: state.oilPump } : null,
    hasAct('oil_scavenge_pump') ? { label:'Scavenge Pump', val: state.oilScav } : null,
    hasAct('airstarter_sol') ? { label:'Air Starter Valve', val: state.airstarter } : null,
    hasAct('cool_fan') ? { label:'Cooling Fan',         val: state.coolFan } : null,
    hasAct('bleed_valve') ? { label:'Bleed Valve',      val: state.bleed } : null,
    hasAct('drain_valve') ? { label:'Drain Valve',      val: state.drainValve || 'closed' } : null,
    hasAct('glow_plug') ? { label:'Glow Plug',          val: state.glow } : null,
    hasAct('fuel_pump2') ? { label:'Secondary / Auxiliary Fuel Pump',   val: state.fuelPump2 } : null,
    hasAct('prop_pitch') ? { label:'Prop Pitch',         val: state.propPitch } : null,
    hasAct('ab_sol') ? { label:'Afterburner Fuel Valve', val: state.abSol } : null,
    hasAct('ab_pump') ? { label:'AB Fuel Pump', val: state.abPump } : null,
  ].filter(Boolean);
  if (!rows.length) return null;

  const rowsHtml = rows.map(r =>
    `<div class="fs-row"><span class="fs-label">${r.label}</span><span class="fs-val">${r.val}</span></div>`
  ).join('');

  const card = document.createElement('div');
  card.className = 'final-state-card';
  card.id = 'final-state-' + tab;
  card.innerHTML = `
    <div class="fs-header">Final state after ${tab === 'startup' ? 'Startup complete (RUNNING)' : 'Shutdown complete (STANDBY)'}</div>
    ${tab === 'shutdown' ? '<div class="hw-desc" style="padding:.55rem 1rem 0">When the sequence finishes, the ECU enters STANDBY and forces every actuator to its safe/off state. This final safety boundary applies even when no matching Off block is present.</div>' : ''}
    <div class="fs-grid">${rowsHtml}</div>`;
  return card;
}

// ------ AB entry/exit criteria info panels ------------------------------------------------------------------------------------------------------------
function buildAbCriteriaHtml() {
  const ab  = cfg?.afterburner ?? {};
  const src = hwCfg.ab_trigger?.source ?? hwCfg.abTriggerSource ?? 0; // 0=manual,1=throttle,2=switch,3=analog input
  const thresholdRaw = hwCfg.ab_trigger?.input_threshold ?? 0;
  const thresholdPct = Math.round(Math.max(0, Math.min(4095, thresholdRaw)) * 100 / 4095);
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = value;
  };
  setValue('ab-edit-throttle-pct', Math.round((ab.throttle_threshold ?? 0) * 100));
  setValue('ab-edit-input-pct', thresholdPct);
  setValue('ab-edit-min-n1', ab.min_n1 ?? 0);
  setValue('ab-edit-max-n1', ab.max_n1 ?? 0);
  const abMaxTot = Number(ab.max_tot_for_light ?? 0);
  setValue('ab-edit-max-tot', abMaxTot === 0 ? '0' : seqRound(toDispTemp(abMaxTot)));
  const maxTotInput = document.getElementById('ab-edit-max-tot');
  if (maxTotInput) {
    maxTotInput.min = '0';
    maxTotInput.max = seqRound(toDispTemp(1000));
    maxTotInput.step = seqRound(tempUnit() === 'F' ? 18 : 10);
  }
  // Keep the unit label in step with the value, which is shown in the user's
  // selected temperature unit (this page has no [data-unit] auto-updater).
  const totUnitEl = document.getElementById('ab-edit-tot-unit');
  if (totUnitEl) totUnitEl.textContent = dispTempUnit();
  const throttleWrap = document.getElementById('ab-edit-throttle-wrap');
  const inputWrap = document.getElementById('ab-edit-input-wrap');
  const totWrap = document.getElementById('ab-edit-tot-wrap');
  if (throttleWrap) throttleWrap.style.display = src === 1 ? '' : 'none';
  if (inputWrap) inputWrap.style.display = src === 3 ? '' : 'none';
  if (totWrap) totWrap.style.opacity = (sensorEnabled('tot') || sensorEnabled('tit')) ? '1' : '.45';
  const sourceNote = document.getElementById('ab-entry-source-note');
  if (sourceNote) {
    sourceNote.textContent = src === 0 ? 'Manual trigger selected in Hardware. Entry gate limits below still apply when AB Check Ready is present.'
      : src === 1 ? 'Throttle is the trigger source. Change the firing percentage here; source selection stays in Hardware.'
      : src === 2 ? 'Dedicated switch is the trigger source. The switch itself has no numeric threshold.'
      : 'Dedicated AB input is the trigger source. Change its firing point here; signal type and GPIO stay in Hardware.';
  }
  const gateActive = !(hwCfg.ab_seq || []).length || (hwCfg.ab_seq || []).includes('ABCheckReady');
  const gateNote = document.getElementById('ab-entry-gate-note');
  if (gateNote) gateNote.textContent = gateActive
    ? 'N1 and EGT limits are checked by AB Check Ready in the light-up sequence.'
    : 'AB Check Ready is not present in this custom light-up sequence, so the N1 and EGT gate values are not evaluated.';

  // Light-up entry conditions
  const upLines = [];
  if (src === 0)       upLines.push('<strong>Trigger:</strong> Manual only (from dashboard FIRE button)');
  else if (src === 1)  upLines.push(`<strong>Trigger:</strong> Throttle >= ${((ab.throttle_threshold??0)*100).toFixed(0)}%`);
  else if (src === 2)  upLines.push('<strong>Trigger:</strong> Dedicated AB switch');
  else if (src === 3)  upLines.push(`<strong>Trigger:</strong> Analog / RC input >= ${thresholdPct}%`);
  if (src !== 0 && hwCfg.ab_trigger?.requires_arm) upLines.push('<strong>Arm:</strong> Arm switch must be active');
  if ((ab.min_n1 ?? 0) > 0)              upLines.push(`<strong>Min N1:</strong> ${ab.min_n1} rpm`);
  if ((ab.max_n1 ?? 0) > 0)              upLines.push(`<strong>Max N1:</strong> ${ab.max_n1} rpm`);
  if ((ab.max_tot_for_light ?? 0) > 0)   upLines.push(`<strong>Max EGT to light:</strong> ${fmtSeqTemp(ab.max_tot_for_light)}`);

  const upBox = document.getElementById('ab-lightup-criteria');
  if (upBox) {
    if (upLines.length) {
      upBox.innerHTML = '<span style="font-size:.7rem;font-weight:600;color:var(--text);text-transform:uppercase;letter-spacing:.06em">Light-up entry conditions</span> &nbsp;-&nbsp; ' + upLines.join(' &nbsp;*&nbsp; ');
      upBox.style.display = '';
    } else {
      upBox.style.display = 'none';
    }
  }

  // Light-off exit conditions
  const offLines = [];
  if (src === 0)       offLines.push('<strong>Shutdown:</strong> Manual only (from dashboard AB STOP button)');
  else if (src === 1)  offLines.push(`<strong>Shutdown when:</strong> Throttle drops below ${((ab.throttle_threshold??0)*100).toFixed(0)}%`);
  else if (src === 2)  offLines.push('<strong>Shutdown when:</strong> AB switch released');
  else if (src === 3)  offLines.push(`<strong>Shutdown when:</strong> Analog / RC input drops below ${thresholdPct}%`);

  const offBox = document.getElementById('ab-shutoff-criteria');
  if (offBox) {
    if (offLines.length) {
      offBox.innerHTML = '<span style="font-size:.7rem;font-weight:600;color:var(--text);text-transform:uppercase;letter-spacing:.06em">Light-off trigger</span> &nbsp;-&nbsp; ' + offLines.join(' &nbsp;*&nbsp; ');
      offBox.style.display = '';
    } else {
      offBox.style.display = 'none';
    }
  }
}

function setAbEntryNumber(key, rawVal) {
  if (!cfg.afterburner) cfg.afterburner = {};
  const val = Number(rawVal);
  if (!Number.isFinite(val)) return;
  cfg.afterburner[key] = Math.max(0, val);
  buildParamVals();
  buildAbCriteriaHtml();
  renderWithLiveIdle('afterburner');
  markSequenceDirty('Afterburner entry conditions edited — save to apply');
}

function setAbEntryTemp(key, rawVal) {
  if (!cfg.afterburner) cfg.afterburner = {};
  const val = Number(rawVal);
  if (!Number.isFinite(val)) return;
  cfg.afterburner[key] = val === 0 ? 0 : Math.max(0, fromDispTemp(val));
  buildParamVals();
  buildAbCriteriaHtml();
  renderWithLiveIdle('afterburner');
  markSequenceDirty('Afterburner entry conditions edited — save to apply');
}

function setAbEntryPercent(key, rawVal) {
  if (!cfg.afterburner) cfg.afterburner = {};
  const pct = Math.max(0, Math.min(100, Number(rawVal) || 0));
  cfg.afterburner[key] = pct / 100;
  buildParamVals();
  buildAbCriteriaHtml();
  markSequenceDirty('Afterburner entry conditions edited — save to apply');
}

function cloneSequenceJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function sequencePlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Apply only differences made on this page to a freshly fetched document.
// Arrays are intentional units here (sequence order, actions and rules).
function mergeSequenceEdits(baseline, edited, fresh) {
  const base = sequencePlainObject(baseline) ? baseline : {};
  const edit = sequencePlainObject(edited) ? edited : {};
  const out = sequencePlainObject(fresh) ? cloneSequenceJson(fresh) : {};
  const keys = new Set([...Object.keys(base), ...Object.keys(edit)]);
  for (const key of keys) {
    const hasEdit = Object.prototype.hasOwnProperty.call(edit, key);
    const before = base[key];
    const after = edit[key];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (!hasEdit) {
      delete out[key];
    } else if (sequencePlainObject(before) && sequencePlainObject(after)) {
      out[key] = mergeSequenceEdits(before, after, out[key]);
    } else {
      out[key] = cloneSequenceJson(after);
    }
  }
  return out;
}
function setAbInputEntryPercent(rawVal) {
  if (!hwCfg.ab_trigger) hwCfg.ab_trigger = {};
  const pct = Math.max(0, Math.min(100, Number(rawVal) || 0));
  hwCfg.ab_trigger.input_threshold = Math.round(pct * 4095 / 100);
  buildAbCriteriaHtml();
  markSequenceDirty('Afterburner entry conditions edited — save to apply');
}
