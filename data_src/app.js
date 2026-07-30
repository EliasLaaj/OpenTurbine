'use strict';

// ── Channel label cache (updated from telemetry labels object) ─
const _labels = {
  tot:'TOT', tit:'TIT', n1:'N1', n2:'N2',
  oil_press:'Oil Press', oil_temp:'Oil Temp',
  p1:'P1', p2:'P2', fuel_press:'Fuel Press', fuel_flow:'Fuel Flow',
  stop:'Stop', start:'Start', ab_arm:'AB Arm'
};
function lbl(key) { return _labels[key] || key; }
function plainRegistryName(raw, fallback = '') {
  const text = String(raw || '').trim();
  const key = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const direct = {
    user_throttle:'Throttle Input', operator_throttle:'Throttle Input', operator_thrott:'Throttle Input', throttle_input:'Throttle Input',
    user_idle:'Idle Input', operator_idle:'Idle Input', idle_input:'Idle Input',
    oil_pump:'Oil Pump', oil_pump_main:'Oil Pump', fuel_pump:'Pilot / Auxiliary Fuel Pump', main_fuel:'Main Fuel Pump',
    fuel_shutoff:'Main Fuel Shutoff', fuel_sol:'Main Fuel Shutoff', flame:'Flame Sensor', flame_main:'Flame Sensor',
    coolant_pump:'Coolant Pump', coolant_temperature:'Coolant Temperature',
    pilot_fuel:'Pilot Gas', purge_valve:'Purge Valve', air_starter:'Air Starter',
    ab_pump:'Afterburner Fuel Pump', ab_solenoid:'Afterburner Fuel Valve', ab_igniter:'Afterburner Igniter',
    prop_pitch:'Prop Pitch', nozzle_actuator:'Nozzle Actuator'
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
  return out || fallback || text;
}
function registryDisplayName(c, fallback = 'Output') {
  const name = (c?.name && String(c.name).trim()) || c?.id || fallback;
  return String(name || '').includes('_') ? plainRegistryName(name, fallback) : name;
}
function selectedEgtKey(d) {
  return d?.egt_source === 2 ? 'tit'
    : (d?.egt_source === 1 ? 'tot' : (d?.has_tot ? 'tot' : (d?.has_tit ? 'tit' : null)));
}
const SEQUENCE_BLOCK_LABELS = {
  OilPrime:'Build Oil Pressure', StarterSpin:'Starter Spin to Light-Off Speed', PreIgnSpark:'Igniter 1 Timed On',
  FuelOpen:'Open Main Fuel Shutoff', FlameConfirm:'Confirm Combustion by Flame Sensor',
  TempConfirm:'Confirm Combustion by Temperature', TimedDelay:'Timed Delay',
  FuelPumpIdle:'Set Main Fuel for Idle', ModifiedIdle:'Set Main Fuel for Raised Idle', Spool:'Accelerate to Idle',
  SafetyHold:'Final Startup Checks', AirstarterOn:'Air Starter Valve Open', AirstarterOff:'Air Starter Valve Close',
  CoolFanOn:'Cooling Fan On', CoolFanOff:'Cooling Fan Off', IgniterOn:'Ignition Output On', IgniterOff:'Ignition Output Off',
  FuelSolClose:'Close Main Fuel Shutoff', StarterEnOn:'Starter Enable On', StarterEnOff:'Starter Enable Off',
  OilPumpOn:'Oil Pump On', OilPumpOff:'Oil Pump Off', OilScavengeOn:'Scavenge On', OilScavengeOff:'Scavenge Off',
  StarterOff:'Starter Off', ImmediateCut:'Immediate Fuel and Ignition Cut', RPMDrop:'Wait for Rotor to Slow',
  CooldownSpin:'Cooldown', FinalStop:'Wait for Complete Stop', FuelPulse:'Pulse Main Fuel Shutoff',
  WaitTOTCool:'Wait for Safe Restart Temperature', ThrottleSet:'Set Main Fuel Demand',
  WaitForInput:'Wait for External Input', WaitForInputOff:'Wait for External Input to Release', PreHeat:'Pre-Heat',
  ABPumpOn:'Afterburner Fuel Pump On', ABPumpOff:'Afterburner Fuel Pump Off', ABIgnOn:'Afterburner Igniter On',
  ABIgnOff:'Afterburner Igniter Off', ABSolOpen:'Afterburner Fuel Valve Open', ABSolClose:'Afterburner Fuel Valve Close',
  ABCheckReady:'Check Afterburner Entry Conditions', ABIgnite:'Ignite Afterburner',
  ABFlameConfirm:'Confirm Afterburner Flame', ABStabilize:'Stabilize Afterburner',
  BleedOpen:'Bleed Valve Open', BleedClose:'Bleed Valve Close', GlowPreheat:'Glow Preheat',
  FuelPumpRamp:'Pilot / Auxiliary Fuel Pump Ramp', FuelPump2Set:'Pilot / Auxiliary Fuel Pump Set',
  FuelPump2On:'Pilot / Auxiliary Fuel Pump On', FuelPump2Off:'Pilot / Auxiliary Fuel Pump Off',
  GovernorHold:'Verify Power-Turbine Governor'
};
function sequenceBlockLabel(id) { return SEQUENCE_BLOCK_LABELS[id] || id || '—'; }
function friendlyEventText(text) {
  const value = String(text || '');
  const match = /^Seq:\s*(.+)$/.exec(value);
  return match ? `Sequence: ${sequenceBlockLabel(match[1])}` : value;
}

// ── Unit preferences (persisted in localStorage) ─────────────
const _unitPrefs = (() => { try { return JSON.parse(localStorage.getItem('ot_units') || '{}'); } catch { return {}; } })();
function _saveUP() { try { localStorage.setItem('ot_units', JSON.stringify(_unitPrefs)); } catch {} }
function tempUnit()   { return _unitPrefs.temp  || 'C'; }
function pressUnit()  { return _unitPrefs.press || 'bar'; }
function setTempUnit(v)  { _unitPrefs.temp  = v; _saveUP(); applyUnitLabels(); if (_lastData) applyData(_lastData); }
function setPressUnit(v) { _unitPrefs.press = v; _saveUP(); applyUnitLabels(); if (_lastData) applyData(_lastData); }
function toDispTemp(c)   { return tempUnit()  === 'F'   ? c * 9/5 + 32  : c; }
function fromDispTemp(v) { return tempUnit()  === 'F'   ? (v - 32) * 5/9 : v; }
function toDispTempDelta(c)   { return tempUnit() === 'F' ? c * 9/5 : c; }
function fromDispTempDelta(v) { return tempUnit() === 'F' ? v * 5/9 : v; }
function toDispPress(b)  { return pressUnit() === 'psi' ? b * 14.5038   : b; }
function fromDispPress(v){ return pressUnit() === 'psi' ? v / 14.5038   : v; }
function dispTempUnit()  { return tempUnit()  === 'F'   ? '°F' : '°C'; }
function dispPressUnit() { return pressUnit() === 'psi' ? 'PSI' : 'bar'; }
function fmtInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '-';
}
function applyUnitLabels() {
  document.querySelectorAll('[data-unit="temp"]').forEach( el => el.textContent = dispTempUnit());
  document.querySelectorAll('[data-unit="press"]').forEach(el => el.textContent = dispPressUnit());
  const bt = document.getElementById('unit-temp-btn');
  if (bt) {
    bt.textContent = dispTempUnit();
    bt.title = `Currently displaying ${dispTempUnit()}. Click to use ${tempUnit() === 'C' ? '°F' : '°C'}.`;
  }
  const bp = document.getElementById('unit-press-btn');
  if (bp) {
    bp.textContent = dispPressUnit();
    bp.title = `Currently displaying ${dispPressUnit()}. Click to use ${pressUnit() === 'bar' ? 'PSI' : 'bar'}.`;
  }
}

function applyContextTooltips(root = document) {
  root.querySelectorAll('.tool-card, .cfg-field, .hw-field, .hw-item-card').forEach(el => {
    if (el.title) return;
    const label = el.querySelector('.tool-name, .cfg-label, .hw-label, b')?.textContent?.trim() || '';
    const desc = el.querySelector('.tool-desc, .cfg-desc, .hw-desc')?.textContent?.trim() || '';
    if (desc) el.title = label ? label + ': ' + desc : desc;
  });
}
window.applyContextTooltips = applyContextTooltips;

function organizeDashboardCards() {
  const groups = {
    'temperature-cards': ['tot-card', 'tit-card', 'n1-card', 'n2-card'],
    'speed-cards': ['oil-card', 'oil-temp-card', 'oilpump-current-card'],
    'combustion-cards': ['flame-card', 'fuel-press-card', 'fuel-flow-card'],
    'pressure-cards': ['p1-card', 'p2-card'],
    'electrical-cards': ['batt-card', 'torque-card', 'thrust-card', 'glow-current-card',
      'igniter-current-card', 'igniter2-current-card']
  };
  Object.entries(groups).forEach(([targetId, cardIds]) => {
    const target = document.getElementById(targetId);
    if (!target) return;
    cardIds.forEach(cardId => {
      const card = document.getElementById(cardId);
      if (card) target.appendChild(card);
    });
  });
  const modeRow = document.querySelector('.mode-row');
  const advActSection = document.getElementById('adv-act-section');
  if (modeRow && advActSection) modeRow.insertAdjacentElement('afterend', advActSection);
  if (modeRow) {
    let outputCards = document.getElementById('actuator-output-cards');
    if (!outputCards) {
      outputCards = document.createElement('section');
      outputCards.id = 'actuator-output-cards';
      outputCards.className = 'grid-2 telemetry';
    }
    ['throttle-output-card', 'oil-output-card'].forEach(cardId => {
      const card = document.getElementById(cardId);
      if (card) outputCards.appendChild(card);
    });
    const anchor = advActSection || modeRow;
    anchor.insertAdjacentElement('afterend', outputCards);
  }
}

// ── Sparkline circular buffers ────────────────────────────────
function resolveCssColor(color) {
  const m = String(color || '').trim().match(/^var\((--[-_a-zA-Z0-9]+)\)$/);
  if (!m) return color;
  const v = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
  return v || color;
}

const SPARK_LEN = 60;
const SPARK_STORAGE_PREFIX = 'ot_dashboard_sparklines_v2';
const SPARK_MAX_AGE_MS = 15 * 60 * 1000;
let _sparkStorageKey = '';
let _storedSparks = {};
function sparkSeries(key) {
  const values = Array.isArray(_storedSparks[key]) ? _storedSparks[key] : [];
  return values.map(Number).filter(Number.isFinite).slice(-SPARK_LEN);
}
const _sparkN1       = sparkSeries('n1');
const _sparkN2       = sparkSeries('n2');
const _sparkTot      = sparkSeries('tot');
const _sparkTit      = sparkSeries('tit');
const _sparkOilTemp  = sparkSeries('oil_temp');
const _sparkBattVolt = sparkSeries('battery');
const _sparkTorque   = sparkSeries('torque');
const _sparkRegistryInputs = new Map();
let _lastSparkPersistMs = 0;

function registryInputSparkSeries(id) {
  const key = 'regin:' + String(id || '');
  if (!_sparkRegistryInputs.has(key)) _sparkRegistryInputs.set(key, sparkSeries(key));
  return _sparkRegistryInputs.get(key);
}

function persistSparklineHistory(force = false) {
  if (!_sparkStorageKey) return;
  const now = Date.now();
  if (!force && now - _lastSparkPersistMs < 1000) return;
  _lastSparkPersistMs = now;
  const series = {
    n1:_sparkN1,n2:_sparkN2,tot:_sparkTot,tit:_sparkTit,oil_temp:_sparkOilTemp,
    battery:_sparkBattVolt,torque:_sparkTorque
  };
  _sparkRegistryInputs.forEach((values, key) => { series[key] = values; });
  try {
    localStorage.setItem(_sparkStorageKey, JSON.stringify({saved_at:now,series}));
  } catch {}
}

function scopeSparklineHistory(profileId) {
  const profile = String(profileId || '').trim();
  if (!profile || _sparkStorageKey) return;
  _sparkStorageKey = `${SPARK_STORAGE_PREFIX}:${location.host}:${profile}`;
  try {
    const saved = JSON.parse(localStorage.getItem(_sparkStorageKey) || '{}');
    _storedSparks = saved.saved_at && Date.now() - Number(saved.saved_at) <= SPARK_MAX_AGE_MS
      ? (saved.series || {}) : {};
  } catch { _storedSparks = {}; }
  const restore = (arr, key) => arr.splice(0, arr.length, ...sparkSeries(key));
  restore(_sparkN1, 'n1'); restore(_sparkN2, 'n2'); restore(_sparkTot, 'tot');
  restore(_sparkTit, 'tit'); restore(_sparkOilTemp, 'oil_temp');
  restore(_sparkBattVolt, 'battery'); restore(_sparkTorque, 'torque');
}
window.addEventListener('pagehide', () => persistSparklineHistory(true));

function pushSparkline(arr, val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return;
  arr.push(n);
  while (arr.length > SPARK_LEN) arr.shift();
}

function drawSparkline(canvasId, data, color) {
  const c = document.getElementById(canvasId);
  if (!c) return;
  const ctx = c.getContext('2d');
  const w = c.width = c.offsetWidth || 200;
  const h = c.height = 36;
  ctx.clearRect(0, 0, w, h);
  if (!data.length) return;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  ctx.strokeStyle = resolveCssColor(color);
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = (i / Math.max(1, data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ── WebSocket live telemetry ──────────────────────────────────
// Architecture: client-pull model.
//
// The server pushes telemetry in response to a tiny "p" message sent by the
// client at the page-specific live interval.  This ensures the push runs inside the async_tcp task
// context (WS_EVT_DATA callback) rather than from webTask — eliminating the
// cross-task notification lag that caused 5-20 s burst-then-silence behaviour.
//
// setInterval at 333 ms is reliable for a visible foreground tab; if the tab
// is backgrounded the rate drops to ~1 s which is acceptable for monitoring.
let ws = null;
let _lastMsgMs = 0;
let _lastConnectMs = 0;
let _pullTimer = null;
let _pullPeriodMs = 0;
let _restFallbackTimer = null;
let _restFallbackInFlight = false;
let _wsRequestInFlight = false;
let _wsRequestSentMs = 0;
let _lastUptimeS = null;
let _lastBootCount = null;
let _statusHeartbeatTimer = null;
let _staleTimer = null;
let _telemetryStale = false;
let _dashboardBootstrapTimer = null;

function isLiveTelemetryPage() {
  if (document.body?.dataset?.page === 'dashboard') return true;
  return location.pathname === '/' ||
    location.pathname === '/index.html' ||
    location.pathname === '/calibration.html' ||
    location.pathname === '/config.html';
}
function isDashboardPage() {
  if (document.body?.dataset?.page === 'dashboard') return true;
  return location.pathname === '/' || location.pathname === '/index.html';
}
function isConfigPage() {
  return location.pathname === '/config.html';
}
function isCalibrationPage() {
  return location.pathname === '/calibration.html';
}
function usesGlobalTelemetry() {
  return isLiveTelemetryPage();
}
function pageStartsTelemetryAfterSetup() {
  return isConfigPage() || isCalibrationPage();
}
function hasPageLocalTelemetry() {
  return location.pathname === '/hardware.html' ||
    location.pathname === '/sequence.html' ||
    location.pathname === '/tools.html';
}

function desiredPullPeriodMs() {
  if (!isLiveTelemetryPage()) return 2000;
  if (isConfigPage()) return 1000;
  // Dashboard and Calibration are live-control pages.  Keep them at 3 Hz from
  // the first load; slower background pages still use the 2 s period above.
  return 333;
}

function startPullTimer() {
  const period = desiredPullPeriodMs();
  if (_pullTimer && _pullPeriodMs === period) return;
  if (_pullTimer) clearInterval(_pullTimer);
  _pullPeriodMs = period;
  requestTelemetryNow();
  _pullTimer = setInterval(requestTelemetryNow, period);
}

function requestTelemetryNow() {
  if (_wsRequestInFlight && Date.now() - _wsRequestSentMs > 1200) {
    _wsRequestInFlight = false;
  }
  if (ws && ws.readyState === WebSocket.OPEN && !_wsRequestInFlight) {
    _wsRequestInFlight = true;
    _wsRequestSentMs = Date.now();
    ws.send('p');
  }
}

async function restTelemetryFallbackNow() {
  if (!isLiveTelemetryPage() || document.hidden || _restFallbackInFlight) return;
  if (_lastMsgMs && Date.now() - _lastMsgMs < 2500) return;
  _restFallbackInFlight = true;
  try {
    const r = await fetch('/api/telemetry', { cache: 'no-store' });
    if (r.ok) {
      const d = await r.json();
      _lastMsgMs = Date.now();
      applyData(d);
    }
  } catch (_) {
  } finally {
    _restFallbackInFlight = false;
  }
}

function startRestFallbackTimer() {
  if (_restFallbackTimer || !isLiveTelemetryPage()) return;
  _restFallbackTimer = setInterval(restTelemetryFallbackNow, 1500);
}

function stopGlobalTelemetry() {
  if (_pullTimer) { clearInterval(_pullTimer); _pullTimer = null; _pullPeriodMs = 0; }
  if (_restFallbackTimer) { clearInterval(_restFallbackTimer); _restFallbackTimer = null; }
  if (_statusHeartbeatTimer) { clearInterval(_statusHeartbeatTimer); _statusHeartbeatTimer = null; }
  if (_dashboardBootstrapTimer) { clearTimeout(_dashboardBootstrapTimer); _dashboardBootstrapTimer = null; }
  _wsRequestInFlight = false;
  _restFallbackInFlight = false;
  if (ws) {
    try {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000, 'page navigation');
    } catch (_) {}
    ws = null;
  }
}

function setConnectionState(ok, text) {
  const dot = document.getElementById('conn');
  const lbl = document.getElementById('conn-label');
  if (dot) dot.className = 'conn-dot ' + (ok ? 'connected' : 'disconnected');
  if (lbl) {
    lbl.textContent = text || (ok ? 'Connected' : 'Disconnected');
    lbl.style.color = ok ? 'var(--green)' : 'var(--yellow)';
  }
}

function startStatusHeartbeat() {
  if (usesGlobalTelemetry() || hasPageLocalTelemetry() || _statusHeartbeatTimer) return;
  const poll = async () => {
    try {
      const r = await fetch('/api/status', { cache: 'no-store' });
      setConnectionState(r.ok, r.ok ? 'Connected' : 'Disconnected');
    } catch (_) {
      setConnectionState(false, 'Disconnected');
    }
  };
  poll();
  _statusHeartbeatTimer = setInterval(poll, 3000);
}

function connect() {
  if (!usesGlobalTelemetry()) return;
  if (ws && ws.readyState <= WebSocket.OPEN) return;
  startStaleMonitor();
  _lastConnectMs = Date.now();
  ws = new WebSocket('ws://' + location.host + '/ws');

  ws.onopen = () => {
    setConnectionState(true, 'Connected');
    _lastMsgMs = Date.now();
    // Start sending pull requests — server responds with compact live telemetry.
    // /api/data supplies full boot snapshots for slow labels and limits.
    // Dashboard and calibration require responsive live values. Keep them at 1-3 Hz;
    // other pages only need the connection indicator and can poll more slowly.
    startPullTimer();
  };

  ws.onclose = () => {
    _wsRequestInFlight = false;
    _wsRequestSentMs = 0;
    if (_pullTimer) { clearInterval(_pullTimer); _pullTimer = null; _pullPeriodMs = 0; }
    setConnectionState(false, 'Reconnecting - values retained');
    const wait = 1000 - (Date.now() - _lastConnectMs);
    if (wait <= 0) {
      connect();
    } else {
      setTimeout(connect, wait);
    }
  };

  ws.onerror = () => { ws.close(); };

  ws.onmessage = (ev) => {
    _wsRequestInFlight = false;
    _wsRequestSentMs = 0;
    _lastMsgMs = Date.now();
    try { applyData(JSON.parse(ev.data)); } catch(e) {}
  };
}

// ── Apply telemetry frame to DOM ──────────────────────────────
let _lastData = null;
function applyData(d) {
  setTelemetryStale(false, 0);
  if (d?.profile_id) scopeSparklineHistory(d.profile_id);
  let bootChanged = false;
  if (d && d.boot_count !== undefined) {
    const nextBootCount = Number(d.boot_count);
    if (Number.isFinite(nextBootCount) && _lastBootCount !== null && nextBootCount !== _lastBootCount) {
      _lastData = null;
      _lastUptimeS = null;
      bootChanged = true;
    }
    if (Number.isFinite(nextBootCount)) _lastBootCount = nextBootCount;
  }
  if (d && d.uptime_s !== undefined && _lastUptimeS !== null) {
    const nextUptime = Number(d.uptime_s);
    if (Number.isFinite(nextUptime) && nextUptime <= 5 && _lastUptimeS > 5) {
      _lastData = null;
      _lastUptimeS = null;
      bootChanged = true;
    }
    if (Number.isFinite(nextUptime) && nextUptime < _lastUptimeS && (_lastUptimeS - nextUptime) < 30) {
      return null;
    }
  }
  // Merge into _lastData rather than replace — fast frames only carry live
  // fields; slow fields (has_*, limits, max_oil_temp, etc.) must persist so
  // that applyData(_lastData) called by the unit-toggle buttons still has them.
  if (!_lastData) _lastData = {};
  // di_channels: fast frames only carry {state,pin} — merge per-entry so the
  // label/role fields from the /api/data snapshot survive fast WS frames.
  if (d && Array.isArray(d.di_channels) && Array.isArray(_lastData.di_channels)) {
    d.di_channels = d.di_channels.map((ch, i) => Object.assign({}, _lastData.di_channels[i], ch));
  }
  if (d && Array.isArray(d.registry_inputs)) {
    d.registry_inputs = mergeTelemetryChannels(_lastData.registry_inputs, d.registry_inputs);
  }
  if (d && Array.isArray(d.registry_outputs)) {
    d.registry_outputs = mergeTelemetryChannels(_lastData.registry_outputs, d.registry_outputs);
  }
  Object.assign(_lastData, d);
  d = _lastData;
  if (typeof window.updateFirstRunForMode === 'function') {
    window.updateFirstRunForMode(d.mode);
  }
  if (d.uptime_s !== undefined && Number.isFinite(Number(d.uptime_s))) {
    _lastUptimeS = Number(d.uptime_s);
  }
  if (ws && ws.readyState === WebSocket.OPEN) startPullTimer();
  if (bootChanged && usesGlobalTelemetry()) {
    fetch('/api/data', { cache: 'no-store' })
      .then(r => r.json())
      .then(full => { try { applyData(full); } catch(e) {} })
      .catch(() => {});
  }
  // ── Channel labels ─────────────────────────────────────────
  if (d.labels) {
    Object.assign(_labels, d.labels);
    const sl = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
    sl('lbl-n1',         lbl('n1') + ' RPM');
    sl('lbl-n2',         lbl('n2') + ' RPM');
    sl('lbl-tot',        lbl('tot'));
    sl('lbl-tit',        lbl('tit'));
    sl('lbl-oil',        lbl('oil_press'));
    sl('lbl-oil-temp',   lbl('oil_temp'));
    sl('lbl-p1',         lbl('p1'));         // unit shown by adjacent data-unit="press" span
    sl('lbl-p2',         lbl('p2'));
    sl('lbl-fuel-press', lbl('fuel_press'));
    sl('lbl-fuel-flow',  lbl('fuel_flow'));
  }
  // Coerce to Number so formatting works even if JSON sent as int
  setText('n1',  d.n1  !== undefined ? fmtInt(d.n1)  : '—');
  const n1Card = document.getElementById('n1-card');
  if (n1Card && d.has_n1 !== undefined) n1Card.style.display = d.has_n1 ? '' : 'none';
  setText('n2',  d.n2  !== undefined ? fmtInt(d.n2)  : '—');
  const n2Card = document.getElementById('n2-card');
  if (n2Card && d.has_n2 !== undefined) n2Card.style.display = d.has_n2 ? '' : 'none';
  setText('tot', d.tot !== undefined ? toDispTemp(Number(d.tot)).toFixed(1)       : '—');
  const totCard = document.getElementById('tot-card');
  if (totCard && d.has_tot !== undefined) totCard.style.display = d.has_tot ? '' : 'none';
  setText('max-n1',  d.max_n1  !== undefined ? fmtInt(d.max_n1) : '—');
  setText('max-n2',  d.max_n2  !== undefined ? fmtInt(d.max_n2) : '—');
  setText('max-tot', d.max_tot !== undefined ? toDispTemp(Number(d.max_tot)).toFixed(1) : '—');
  setText('oil', d.oil !== undefined ? toDispPress(Number(d.oil)).toFixed(2)       : '—');
  const oilCard = document.getElementById('oil-card');
  if (oilCard && d.has_oil_press !== undefined) oilCard.style.display = d.has_oil_press ? '' : 'none';
  setText('oil-demand-val', d.oil_demand !== undefined ? toDispPress(Number(d.oil_demand)).toFixed(2) : '—');
  const baseThrottle = d.throttle_demand !== undefined ? Number(d.throttle_demand) : undefined;
  const effectiveThrottle = d.throttle_effective !== undefined ? Number(d.throttle_effective) : baseThrottle;
  setText('throttle-demand', effectiveThrottle !== undefined
    ? (effectiveThrottle * 100).toFixed(1) + '%' : '—');
  const throttleOutputCard = document.getElementById('throttle-output-card');
  if (throttleOutputCard && d.has_throttle !== undefined) {
    throttleOutputCard.style.display = d.has_throttle ? '' : 'none';
  }
  // Throttle gauge bar
  if (effectiveThrottle !== undefined) {
    const gb = document.getElementById('throttle-gauge-bar');
    if (gb) gb.style.width = (effectiveThrottle * 100).toFixed(1) + '%';
  }
  const feedbackInhibit = document.getElementById('throttle-feedback-inhibit-note');
  if (feedbackInhibit) {
    const primaryEgtUnhealthy =
      d.egt_source === 1 ? (d.has_tot && d.tot_healthy === false) :
      d.egt_source === 2 ? (d.has_tit && d.tit_healthy === false) :
      ((d.has_tot && d.tot_healthy === false) || (d.has_tit && d.tit_healthy === false));
    const sensorBlocksIncrease = !d.bench_mode &&
      (d.mode === 'RUNNING' || d.mode === 'STARTUP') &&
      (primaryEgtUnhealthy ||
       (d.has_n1 && d.n1_healthy === false));
    feedbackInhibit.style.display = sensorBlocksIncrease ? '' : 'none';
  }
  // Physical throttle input display (when throttle input is configured)
  {
    const iRow = document.getElementById('throttle-input-row');
    const iVal = document.getElementById('throttle-input-pct');
    const hasInput = d.throttle_input_type && d.throttle_input_type !== 'none';
    if (iRow) iRow.style.display = hasInput && d.mode === 'RUNNING' ? '' : 'none';
    if (iVal && hasInput) {
      const rawNorm = d.throttle_input_raw !== undefined ? Number(d.throttle_input_raw) / 4095 : 0;
      const norm = d.throttle_input_norm !== undefined
        ? Number(d.throttle_input_norm)
        : (d.throttle_input_type === 'servo' && d.rc_throttle_norm !== undefined)
          ? Number(d.rc_throttle_norm) : rawNorm;
      const pct = (norm * 100).toFixed(1);
      iVal.textContent = pct;
    }
  }
  setText('oil-pct',     d.oil_pct  !== undefined ? d.oil_pct + '%'          : '—');
  const oilOutputCard = document.getElementById('oil-output-card');
  if (oilOutputCard && d.has_oil_pump !== undefined) {
    oilOutputCard.style.display = d.has_oil_pump ? '' : 'none';
  }
  const speedGroup = document.getElementById('speed-group');
  if (speedGroup) {
    const hasOilSystem = d.has_oil_press || d.has_oil_temp || d.has_oil_pump_current;
    speedGroup.style.display = hasOilSystem ? '' : 'none';
  }
  const temperatureGroup = document.getElementById('temperature-group');
  if (temperatureGroup) temperatureGroup.style.display =
    (d.has_tot || d.has_tit || d.has_n1 || d.has_n2) ? '' : 'none';
  setText('uptime',      d.uptime_s !== undefined ? formatUptime(d.uptime_s)  : '—');
  setText('last-event',  friendlyEventText(d.last_event) || '—');

  // Fuel-output sub-labels: calibrated minimum pump output + automatic idle target.
  // Non-standby commands below min-spin are displayed as zero after firmware
  // applies the same deadband used at the actuator output.
  if (d.fuel_pump_min_pct !== undefined) {
    setText('throttle-idle-floor', Number(d.fuel_pump_min_pct).toFixed(1));
  }
  const floorRow = document.getElementById('throttle-floor-row');
  if (floorRow) floorRow.style.display = d.mode === 'STARTUP' ? 'none' : '';
  const startupRangeRow = document.getElementById('throttle-startup-range-row');
  if (startupRangeRow) {
    const showStartupRange = d.mode === 'STARTUP' &&
      d.fuel_pump_min_pct !== undefined && d.fuel_idle_max_pct !== undefined;
    startupRangeRow.style.display = showStartupRange ? '' : 'none';
    if (showStartupRange) {
      setText('throttle-startup-range',
        Number(d.fuel_pump_min_pct).toFixed(1) + ' to ' + Number(d.fuel_idle_max_pct).toFixed(1));
    }
  }
  const effectiveNote = document.getElementById('throttle-effective-note');
  if (effectiveNote) {
    const showEffective = baseThrottle !== undefined && effectiveThrottle !== undefined &&
      Math.abs(effectiveThrottle - baseThrottle) > 0.0005;
    effectiveNote.style.display = showEffective ? '' : 'none';
    if (showEffective) setText('throttle-base-demand', (baseThrottle * 100).toFixed(1));
  }
  const oilStartupNote = document.getElementById('oil-startup-setting-note');
  if (oilStartupNote) {
    const showOilStartup = d.mode === 'STARTUP' && d.oil_pump_on_pct !== undefined;
    oilStartupNote.style.display = showOilStartup ? '' : 'none';
    if (showOilStartup) setText('oil-startup-setting', Number(d.oil_pump_on_pct).toFixed(1));
  }
  const diWrap = document.getElementById('throttle-di-wrap');
  if (diWrap) {
    const showDi = d.dynamic_idle_enabled && d.mode === 'RUNNING';
    diWrap.style.display = showDi ? '' : 'none';
    if (showDi && d.idle_target_rpm !== undefined) {
      setText('throttle-di-rpm', fmtInt(d.idle_target_rpm));
    }
  }

  // Relight status — hide card entirely when relight is disabled in config
  const relightCard = document.getElementById('relight-card');
  if (relightCard && d.relight_enabled !== undefined) relightCard.style.display = d.relight_enabled ? '' : 'none';

  if (d.relight_armed !== undefined || d.relight_attempts !== undefined) {
    const armed    = !!d.relight_armed;
    const attempts = d.relight_attempts !== undefined ? d.relight_attempts : 0;
    setText('relight-status', armed
      ? (attempts > 0 ? 'Armed — ' + attempts + ' attempt' + (attempts !== 1 ? 's' : '') : 'Armed')
      : 'Disarmed');
  }

  // Oil min bar (session minimum — only shown once engine has run)
  const oilMinRow = document.getElementById('oil-min-bar-row');
  if (oilMinRow) {
    const minVal = d.oil_min_bar !== undefined ? Number(d.oil_min_bar) : 0;
    oilMinRow.style.display = minVal > 0 ? '' : 'none';
    if (minVal > 0) setText('oil-min-bar-val', toDispPress(minVal).toFixed(2));
  }

  // Oil failsafe indicator
  const failsafeNote = document.getElementById('oil-failsafe-note');
  if (failsafeNote) failsafeNote.style.display = d.oil_failsafe_active ? '' : 'none';

  // Manual relight indicator
  const manualRelightNote = document.getElementById('manual-relight-note');
  if (manualRelightNote) manualRelightNote.style.display = d.manual_relight_active ? '' : 'none';

  // Extra cooldown indicator + countdown
  const ecCard = document.getElementById('extra-cooldown-card');
  if (ecCard) ecCard.style.display = d.extra_cooldown_active ? '' : 'none';
  if (d.extra_cooldown_remaining_s !== undefined)
    setText('extra-cooldown-remaining', d.extra_cooldown_remaining_s);

  // Windmilling oil-protection indicator
  const standbyOilNote = document.getElementById('standby-oil-feed-note');
  if (standbyOilNote) standbyOilNote.style.display = d.standby_oil_feed_active ? '' : 'none';

  // System stats — flash + log records
  if (d.flash_free_kb  !== undefined) setText('sys-flash-free',  d.flash_free_kb);
  if (d.flash_used_kb  !== undefined) setText('sys-flash-used',  d.flash_used_kb);
  if (d.flash_total_kb !== undefined) setText('sys-flash-total', d.flash_total_kb);
  if (d.log_records    !== undefined) setText('sys-log-records', d.log_records);
  if (d.log_max_records !== undefined) setText('sys-log-max',   d.log_max_records);
  if (d.boot_count     !== undefined) setText('sys-boot-count',  d.boot_count);
  if (d.reset_reason   !== undefined) {
    const reasons = ['UNKNOWN','POWER_ON','EXT','SW','PANIC','INT_WDT','TASK_WDT','WDT','DEEPSLEEP','BROWNOUT','SDIO'];
    setText('sys-reset-reason', reasons[d.reset_reason] || d.reset_reason);
  }

  // Flame progress bar + threshold marker
  if (d.has_flame === false) {
    setText('flame-raw-val', 'No data');
    const fill = document.getElementById('flame-bar-fill');
    if (fill) fill.style.width = '0%';
  } else if (d.flame_raw !== undefined) {
    const pct = Math.max(0, Math.min(100, (d.flame_raw / 4095) * 100));
    const fill = document.getElementById('flame-bar-fill');
    if (fill) {
      fill.style.width = pct + '%';
      fill.style.background = d.flame ? 'var(--green)' : 'var(--dim)';
    }
    setText('flame-raw-val', d.flame_raw + ' ADC');
  }
  if (d.flame_threshold !== undefined) {
    const thrPct = Math.max(0, Math.min(100, (d.flame_threshold / 4095) * 100));
    const mark = document.getElementById('flame-thr-mark');
    if (mark) mark.style.left = thrPct + '%';
    setText('flame-thr-label', 'thr: ' + d.flame_threshold);
  }

  // Pressure sensors — show/hide based on whether sensors are fitted
  const psSection = document.getElementById('pressure-section');
  if (psSection) psSection.style.display = (d.has_p1 || d.has_p2) ? '' : 'none';
  const p1Card = document.getElementById('p1-card');
  if (p1Card && d.has_p1 !== undefined) p1Card.style.display = d.has_p1 ? '' : 'none';
  const p2Card = document.getElementById('p2-card');
  if (p2Card && d.has_p2 !== undefined) p2Card.style.display = d.has_p2 ? '' : 'none';
  // A railed/disconnected optional pressure sensor now reports unhealthy —
  // show an explicit dash instead of a believable extrapolated number.
  const p1Ok = d.p1_healthy !== false, p2Ok = d.p2_healthy !== false;
  setText('p1', d.p1 !== undefined && p1Ok ? toDispPress(Number(d.p1)).toFixed(2) : '—');
  setText('p2', d.p2 !== undefined && p2Ok ? toDispPress(Number(d.p2)).toFixed(2) : '—');
  setText('max-p1', d.max_p1 !== undefined ? toDispPress(Number(d.max_p1)).toFixed(2) : '—');
  setText('max-p2', d.max_p2 !== undefined ? toDispPress(Number(d.max_p2)).toFixed(2) : '—');
  const p1El = document.getElementById('p1'), p2El = document.getElementById('p2');
  if (p1El) p1El.title = p1Ok ? '' : 'P1 sensor fault (railed/disconnected) — check wiring';
  if (p2El) p2El.title = p2Ok ? '' : 'P2 sensor fault (railed/disconnected) — check wiring';

  // Health dots
  // RPM health is only meaningful when the engine is running — zero RPM at standby is valid.
  // Pass null when not in an operational mode so the dot shows neutral (dim), not fault (red).
  const engineOp = (d.mode === 'RUNNING' || d.mode === 'STARTUP');
  // RPM health: green whenever the sensor has trustworthy data (any mode, so
  // live bench RPM shows green like every other sensor dot). A stopped shaft
  // reads 0 with no pulses (unhealthy) — show that as a red fault only while
  // operating; in STANDBY a still shaft is expected, so stay neutral (grey).
  setDot('n1-health',  d.n1_healthy ? true : (engineOp ? false : null), lbl('n1') + ' RPM');
  setDot('n2-health',  d.n2_healthy ? true : (engineOp ? false : null), lbl('n2') + ' RPM');
  setDot('tot-health', d.tot_healthy, lbl('tot'));
  setDot('oil-health', d.oil_healthy, lbl('oil_press'));
  setDot('p1-health', d.p1_healthy, lbl('p1'));
  setDot('p2-health', d.p2_healthy, lbl('p2'));
  // Flame dot: green = flame confirmed; red = no flame while the engine is
  // operating (running flameout cue); neutral = no flame otherwise (normal
  // at standby). Title set manually below to bypass setDot's generic
  // "sensor fault (check wiring)" text — flame-off is not a wiring fault.
  // Exception: a railed ADC at standby (flame_healthy=false) IS a wiring
  // hint — while running a strong flame can saturate legitimately, so the
  // rail check is only surfaced outside operational modes.
  const flameWiring = !engineOp && d.flame_healthy === false;
  setDot('flame-dot',  d.has_flame === false ? null
    : d.flame ? true : ((engineOp || flameWiring) ? false : null));
  {
    const flameDot = document.getElementById('flame-dot');
    if (flameDot) flameDot.title = d.has_flame === false ? 'Flame sensor'
      : flameWiring ? 'Flame sensor — ADC railed (check wiring)'
      : (d.flame ? 'Flame sensor — flame confirmed' : 'Flame sensor — no flame');
  }
  const flameCard = document.getElementById('flame-card');
  if (flameCard && d.has_flame !== undefined) flameCard.style.display = d.has_flame ? '' : 'none';
  const combustionGroup = document.getElementById('combustion-group');
  if (combustionGroup) combustionGroup.style.display =
    (d.has_flame || d.has_fuel_press || d.has_fuel_flow) ? '' : 'none';

  // Mode badge
  const badge = document.getElementById('mode-badge');
  if (badge) {
    badge.textContent = d.mode || '—';
    badge.className   = 'mode-badge ' + (d.mode || '');
  }

  // Banners
  const devBanner   = document.getElementById('dev-banner');
  if (devBanner) devBanner.style.display = d.dev_mode ? '' : 'none';
  const benchBanner = document.getElementById('bench-banner');
  if (benchBanner) benchBanner.style.display = d.bench_mode ? '' : 'none';
  const logDropBanner = document.getElementById('session-log-drop-banner');
  if (logDropBanner) {
    const dropped = Number(d.session_dropped_rows || 0);
    logDropBanner.style.display = dropped > 0 ? '' : 'none';
    if (dropped > 0) {
      logDropBanner.textContent = 'Session log dropped ' + dropped + ' row' + (dropped === 1 ? '' : 's') + '. CSV for this run is incomplete.';
    }
  }
  const flightDropBanner = document.getElementById('flight-log-drop-banner');
  if (flightDropBanner) {
    const dropped = Number(d.flight_dropped_events || 0);
    flightDropBanner.style.display = dropped > 0 ? '' : 'none';
    if (dropped > 0) {
      flightDropBanner.textContent = 'Event recorder dropped ' + dropped + ' event' + (dropped === 1 ? '' : 's') + '. Event log may be incomplete.';
    }
  }
  const storageBanner = document.getElementById('config-storage-banner');
  if (storageBanner) storageBanner.style.display = d.config_storage_fault ? '' : 'none';
  // Boot-config load warning (full frames: config_load_warning = string|null).
  // Dismiss hides it for this page load only; reappears on reload while it persists.
  const cfgLoadWarnBanner = document.getElementById('config-load-warn-banner');
  if (cfgLoadWarnBanner && d.config_load_warning !== undefined) {
    const warn = d.config_load_warning;
    if (warn) setText('config-load-warn-text', warn);
    cfgLoadWarnBanner.style.display = (warn && !window._cfgLoadWarnDismissed) ? 'flex' : 'none';
  }

  // Stop switch warning below start button
  const stopWarn = document.getElementById('stop-switch-warn');
  if (stopWarn) stopWarn.style.display = d.stop_switch_active ? '' : 'none';

  // Start/Stop buttons — disable + hardware glow when physical button is pressed
  const running = d.mode === 'RUNNING' || d.mode === 'STARTUP' || d.mode === 'SHUTDOWN';
  const startBtn = document.getElementById('btn-start');
  if (startBtn) {
    startBtn.textContent = d.mode === 'STARTUP' ? 'Starting...' : 'START';
    if (d.mode !== 'STANDBY' && startBtn._startTimeout) {
      clearTimeout(startBtn._startTimeout);
      startBtn._startTimeout = null;
    }
  }
  // Mirror the backend start-preflight reasons visible in telemetry, so
  // START is disabled with an explanation instead of accepting the click
  // and rejecting it server-side (backend remains the authority).
  let startBlock = '';
  if (!running) {
    if (d.mode === 'FAULT')                startBlock = 'ECU is in FAULT — fix config/profile first';
    else if (d.stop_switch_active)         startBlock = 'STOP switch is active';
    else if (d.profile_match === false)    startBlock = 'Profile mismatch — upload a matching config';
    // (boot config-load failure enters FAULT mode, caught above; telemetry
    // config_locked means "running, edits locked" and never applies here)
    else if (d.extra_cooldown_active)      startBlock = 'Extra cooldown is running — stop it on Tools';
    else if (d.seq_has_structural_errors)  startBlock = 'Startup sequence has structural errors — see Sequence page';
    else if (d.seq_has_errors && !d.bench_mode) startBlock = 'Sequence hardware errors — see Sequence page (Bench Mode bypasses)';
    else if (Array.isArray(d.di_channels) &&
             d.di_channels.some(ch => ch && ch.pin >= 0 && ch.state && ch.role === 'inhibit_start'))
                                           startBlock = 'Start-inhibit input is active';
  }
  setDisabled('btn-start', running || !!startBlock);
  if (startBtn) startBtn.title = startBlock;
  const sbr = document.getElementById('start-block-reason');
  if (sbr) {
    // stop-switch has its own warning line — avoid doubling it
    const show = startBlock && !d.stop_switch_active;
    sbr.style.display = show ? '' : 'none';
    if (show) sbr.textContent = '⚠ ' + startBlock;
  }
  setDisabled('btn-stop',  !running);
  setHwActive('btn-start', !!d.start_switch_active);
  setHwActive('btn-stop',  !!d.stop_switch_active);

  // ── Sequence progress ─────────────────────────────────────
  const seqSection = document.getElementById('seq-progress-section');
  if (seqSection) {
    const abSeqActive = d.mode === 'RUNNING' && (d.ab_mode === 'Igniting' || d.ab_mode === 'ShuttingDown');
    const inSeq = (d.mode === 'STARTUP' || d.mode === 'SHUTDOWN' || abSeqActive) && d.seq_block_total > 0;
    seqSection.style.display = inSeq ? '' : 'none';
    if (inSeq) {
      setText('seq-block-name', sequenceBlockLabel(d.current_block));
      setText('seq-wait-reason', d.seq_wait_reason || '');
      const step = (d.seq_block_idx || 0) + 1;
      const total = d.seq_block_total || 1;
      setText('seq-step-text', step + ' / ' + total);
      const pct = Math.round((step / total) * 100);
      const bar = document.getElementById('seq-progress-bar');
      if (bar) bar.style.width = pct + '%';
    }
  }

  // ── Fault description banner ──────────────────────────────
  const faultCard = document.getElementById('fault-card');
  if (faultCard) {
    const hasFaultDesc = d.fault_description && d.fault_description.length > 0;
    const showFault = hasFaultDesc && (d.mode === 'FAULT' || d.mode === 'STANDBY' || d.mode === 'SHUTDOWN');
    faultCard.style.display = showFault ? '' : 'none';
    if (showFault) setText('fault-desc-text', d.fault_description);
  }

  // ── Profile mismatch banner ───────────────────────────────
  const mismatchBanner = document.getElementById('profile-mismatch-banner');
  if (mismatchBanner) {
    const mismatch = d.profile_match === false;
    mismatchBanner.style.display = mismatch ? '' : 'none';
  }
  // Older pages may still include this compact profile-error element.
  const profErr = document.getElementById('profile-error');
  if (profErr) profErr.style.display = (d.profile_match === false) ? '' : 'none';

  // ── Config version mismatch banner ────────────────────────
  const verBanner = document.getElementById('config-version-banner');
  if (verBanner) verBanner.style.display = d.config_version_mismatch ? '' : 'none';

  // ── Hour meter ────────────────────────────────────────────
  if (d.start_attempt_count !== undefined) setText('hour-start-count', fmtInt(d.start_attempt_count));
  else if (d.run_count !== undefined) setText('hour-start-count', fmtInt(d.run_count));
  if (d.run_count !== undefined) setText('hour-run-count', fmtInt(d.run_count));
  if (d.total_run_seconds !== undefined) {
    const hrs = Math.floor(d.total_run_seconds / 3600);
    const mins = Math.floor((d.total_run_seconds % 3600) / 60);
    setText('hour-run-time', hrs + 'h ' + String(mins).padStart(2, '0') + 'm');
  }

  // ── EGT rate of rise ──────────────────────────────────────
  if (d.egt_rise_rate !== undefined || d.tot_rise_rate !== undefined) {
    const rate = Number(d.egt_rise_rate ?? d.tot_rise_rate);
    const rateText = toDispTempDelta(rate).toFixed(1) + ' ' + dispTempUnit() + '/s';
    const primary = selectedEgtKey(d);
    setText('tot-rise-rate-val', primary === 'tot' ? rateText : '—');
    setText('tit-rise-rate-val', primary === 'tit' ? rateText : '—');
  }

  // ── Color gauges + approach-to-limit warnings ────────────
  if (d.rpm_limit && d.n1 !== undefined) {
    const pct = Math.min(100, (d.n1 / d.rpm_limit) * 100);
    setGaugeBar('n1-gauge-bar', pct);
    const warn = document.getElementById('n1-approach-warn');
    if (warn) {
      const show = pct >= 85;
      warn.style.display = show ? '' : 'none';
      if (show) warn.textContent = '⚠ N1 at ' + pct.toFixed(0) + '% — '
        + fmtInt(d.n1) + ' / ' + fmtInt(d.rpm_limit) + ' RPM';
    }
    const absLbl = document.getElementById('n1-abs-label');
    if (absLbl) absLbl.textContent = fmtInt(d.n1) + ' / ' + fmtInt(d.rpm_limit) + ' RPM';
  }
  if (d.n2 !== undefined) {
    // This is the independent hard N2 shutdown limit. Gradual N2 pullback
    // points are separate control settings and must not be shown as a trip.
    const n2Limit = Number(d.n2_limit || 0);
    const pct = n2Limit > 0 ? Math.min(100, (Number(d.n2) / n2Limit) * 100) : 0;
    setGaugeBar('n2-gauge-bar', pct);
    const warn = document.getElementById('n2-approach-warn');
    if (warn) {
      const show = n2Limit > 0 && pct >= 85;
      warn.style.display = show ? '' : 'none';
      if (show) warn.textContent = '⚠ N2 at ' + pct.toFixed(0) + '% of hard limit — '
        + fmtInt(d.n2) + ' / ' + fmtInt(n2Limit) + ' RPM';
    }
    const absLbl = document.getElementById('n2-abs-label');
    if (absLbl) absLbl.textContent = n2Limit > 0
      ? fmtInt(d.n2) + ' / ' + fmtInt(n2Limit) + ' RPM'
      : fmtInt(d.n2) + ' RPM / OFF';
  }
  const selectedEgtSource = selectedEgtKey(d);
  const isPrimaryTot = selectedEgtSource === 'tot';
  const isPrimaryTit = selectedEgtSource === 'tit';

  if (d.tot !== undefined) {
    const totLimit = Number(d.tot_limit || 0);
    const pct = totLimit > 0 ? Math.min(100, (d.tot / totLimit) * 100) : 0;
    setGaugeBar('tot-gauge-bar', pct);
    const warn = document.getElementById('tot-approach-warn');
    if (warn) {
      const limit = Number(d.egt_limit || totLimit);
      const primaryPct = limit > 0 ? Math.min(100, (Number(d.tot) / limit) * 100) : 0;
      const show = isPrimaryTot && primaryPct >= 85;
      warn.style.display = show ? '' : 'none';
      if (show) warn.textContent = 'Warning: ' + lbl('tot') + ' at ' + primaryPct.toFixed(0) + '% - '
        + toDispTemp(Number(d.tot)).toFixed(0) + ' / ' + toDispTemp(limit).toFixed(0) + ' ' + dispTempUnit();
    }
    const absLbl = document.getElementById('tot-abs-label');
    if (absLbl) absLbl.textContent = totLimit > 0
      ? toDispTemp(Number(d.tot)).toFixed(0) + ' / ' + toDispTemp(totLimit).toFixed(0) + ' ' + dispTempUnit()
      : toDispTemp(Number(d.tot)).toFixed(0) + ' ' + dispTempUnit() + ' / OFF';
  }
  if (d.oil !== undefined) {
    const oilMin = Number(d.oil_running_min || 0);
    if (d.mode === 'RUNNING' || d.mode === 'SHUTDOWN') {
      // SHUTDOWN included: pump is still active and the engine is spinning,
      // and a low-oil red bar is the cue that explains a low-oil shutdown.
      // Oil is inverted vs the other gauges: LOW pressure is the fault state.
      // Width tracks pressure (minimum = 50% width, floor 8% so a red sliver
      // is always visible); color is forced — red below the running minimum,
      // amber within 15% above it, green otherwise. Previously a below-min
      // reading rendered as an EMPTY neutral bar, which read as "fine".
      const ratio = oilMin > 0 ? d.oil / oilMin : 0;
      const width = oilMin > 0 ? Math.min(100, Math.max(8, ratio * 50)) : 0;
      const cls = oilMin > 0
                ? (d.oil < oilMin ? 'danger' : d.oil < oilMin * 1.15 ? 'warn' : 'ok')
                : '';
      setGaugeBar('oil-gauge-bar', width, cls);
      const warn = document.getElementById('oil-approach-warn');
      if (warn) {
        const low = oilMin > 0 && d.oil < oilMin * 1.15;
        warn.style.display = low ? '' : 'none';
        if (low) warn.textContent = '⚠ Oil ' + toDispPress(Number(d.oil)).toFixed(2)
          + ' ' + dispPressUnit() + ' — near min ' + toDispPress(oilMin).toFixed(2) + ' ' + dispPressUnit();
      }
    } else {
      // STANDBY/FAULT and other non-op modes: keep the bar live but neutral —
      // clears a stale red 'danger' bar/warning left over from the last
      // RUNNING/SHUTDOWN frame.
      const ratio = oilMin > 0 ? d.oil / oilMin : 0;
      const width = oilMin > 0 ? Math.min(100, Math.max(0, ratio * 50)) : 0;
      setGaugeBar('oil-gauge-bar', width, 'ok');
      const warn = document.getElementById('oil-approach-warn');
      if (warn) warn.style.display = 'none';
    }
    const absLbl = document.getElementById('oil-abs-label');
    if (absLbl) absLbl.textContent = oilMin > 0
      ? toDispPress(Number(d.oil)).toFixed(2) + ' / ≥' + toDispPress(oilMin).toFixed(2) + ' ' + dispPressUnit()
      : toDispPress(Number(d.oil)).toFixed(2) + ' ' + dispPressUnit() + ' / OFF';
  }

  // ── Firmware version (shown once on first telemetry frame) ──
  if (d.fw_version) {
    const el = document.getElementById('fw-version');
    if (el && !el._set) { el.textContent = 'v' + d.fw_version; el._set = true; }
  }

  // ── Sparklines ────────────────────────────────────────────
  if (d.n1 !== undefined) {
    pushSparkline(_sparkN1, Number(d.n1));
    drawSparkline('n1-sparkline', _sparkN1, 'var(--accent)');
  }
  if (d.n2 !== undefined) {
    pushSparkline(_sparkN2, Number(d.n2));
    drawSparkline('n2-sparkline', _sparkN2, 'var(--accent)');
  }
  if (d.tot !== undefined) {
    pushSparkline(_sparkTot, Number(d.tot));
    drawSparkline('tot-sparkline', _sparkTot, 'var(--accent)');
  }
  if (d.tit !== undefined) {
    pushSparkline(_sparkTit, Number(d.tit));
    drawSparkline('tit-sparkline', _sparkTit, 'var(--accent)');
  }
  if (d.has_oil_temp && d.oil_temp !== undefined) {
    pushSparkline(_sparkOilTemp, Number(d.oil_temp));
    drawSparkline('oil-temp-sparkline', _sparkOilTemp, 'var(--accent)');
  }
  if (d.has_batt_voltage && d.batt_voltage !== undefined) {
    pushSparkline(_sparkBattVolt, Number(d.batt_voltage));
    drawSparkline('batt-sparkline', _sparkBattVolt, 'var(--accent)');
  }
  if (d.has_torque && d.torque !== undefined) {
    pushSparkline(_sparkTorque, Number(d.torque));
    drawSparkline('torque-sparkline', _sparkTorque, 'var(--accent)');
  }
  if (d.oil_pct !== undefined) {
    const oilPct = Number(d.oil_pct);
    setGaugeBar('oil-output-gauge-bar', Math.max(0, Math.min(100, oilPct)));
  }
  const oilFlowWarning = document.getElementById('oil-flow-warning-note');
  if (oilFlowWarning) oilFlowWarning.style.display = d.oil_flow_warning ? '' : 'none';
  renderRegistryOutputCards(d);
  const registryInputCount = renderRegistryInputCards(d);
  persistSparklineHistory();

  // ── Extended sensors (oil temp, battery, torque, current sensors) ──
  const extSection = document.getElementById('ext-sensors-section');
  if (extSection) {
    const anyExt = d.has_batt_voltage || d.has_torque ||
                   d.has_glow_current || d.has_igniter_current ||
                   d.has_igniter2_current || registryInputCount > 0;
    extSection.style.display = anyExt ? '' : 'none';
  }

  // Oil temperature card
  const oilTempCard = document.getElementById('oil-temp-card');
  if (oilTempCard) {
    oilTempCard.style.display = d.has_oil_temp ? '' : 'none';
    if (d.has_oil_temp) {
      setText('oil-temp', d.oil_temp !== undefined ? toDispTemp(Number(d.oil_temp)).toFixed(1) : '—');
      setText('max-oil-temp', d.max_oil_temp !== undefined ? toDispTemp(Number(d.max_oil_temp)).toFixed(1) : '—');
      setDot('oil-temp-health', d.oil_temp_healthy, lbl('oil_temp'));
      if (d.oil_temp !== undefined) {
        const oilTempLimit = Number(d.oil_temp_limit || 0);
        setGaugeBar('oil-temp-gauge-bar', oilTempLimit > 0 ? Math.min(100, (d.oil_temp / oilTempLimit) * 100) : 0);
      }
    }
  }

  // TIT card
  const titCard = document.getElementById('tit-card');
  if (titCard) {
    titCard.style.display = d.has_tit ? '' : 'none';
    if (d.has_tit) {
      setText('tit', d.tit !== undefined ? toDispTemp(Number(d.tit)).toFixed(1) : '—');
      setText('max-tit', d.max_tit !== undefined ? toDispTemp(Number(d.max_tit)).toFixed(1) : '—');
      setDot('tit-health', d.tit_healthy, lbl('tit'));
      if (d.tit !== undefined) {
        const titLimit = Number(d.tit_limit || 0);
        setGaugeBar('tit-gauge-bar', titLimit > 0 ? Math.min(100, (d.tit / titLimit) * 100) : 0);
        const warn = document.getElementById('tit-approach-warn');
        if (warn) {
          const limit = Number(d.egt_limit || titLimit);
          const primaryPct = limit > 0 ? Math.min(100, (Number(d.tit) / limit) * 100) : 0;
          const show = isPrimaryTit && primaryPct >= 85;
          warn.style.display = show ? '' : 'none';
          if (show) warn.textContent = 'Warning: ' + lbl('tit') + ' at ' + primaryPct.toFixed(0) + '% - '
            + toDispTemp(Number(d.tit)).toFixed(0) + ' / ' + toDispTemp(limit).toFixed(0) + ' ' + dispTempUnit();
        }
        const absLbl = document.getElementById('tit-abs-label');
        if (absLbl) absLbl.textContent = titLimit > 0
          ? toDispTemp(Number(d.tit)).toFixed(0) + ' / ' + toDispTemp(titLimit).toFixed(0) + ' ' + dispTempUnit()
          : toDispTemp(Number(d.tit)).toFixed(0) + ' ' + dispTempUnit() + ' / OFF';
      } else {
        const warn = document.getElementById('tit-approach-warn');
        if (warn) warn.style.display = 'none';
      }
    }
  }

  // Fuel pressure card
  const fuelPressCard = document.getElementById('fuel-press-card');
  if (fuelPressCard) {
    fuelPressCard.style.display = d.has_fuel_press ? '' : 'none';
    if (d.has_fuel_press) {
      setText('fuel-press', d.fuel_press !== undefined ? toDispPress(Number(d.fuel_press)).toFixed(2) : '—');
      setText('max-fuel-press', d.max_fuel_press !== undefined ? toDispPress(Number(d.max_fuel_press)).toFixed(2) : '—');
      setDot('fuel-press-health', d.fuel_press_healthy, lbl('fuel_press'));
      if (d.fuel_press !== undefined) {
        const fuelPressMin = Number(d.fuel_press_min || 0);
        // Gauge: 0% = at min threshold, 100% = 3× min (typical healthy range)
        const pct = fuelPressMin > 0 ? Math.min(100, Math.max(0,
          ((d.fuel_press - fuelPressMin) / (fuelPressMin * 2)) * 100)) : 0;
        setGaugeBar('fuel-press-gauge-bar', pct);
        const absLbl = document.getElementById('fuel-press-abs-label');
        if (absLbl) absLbl.textContent = fuelPressMin > 0
          ? toDispPress(Number(d.fuel_press)).toFixed(2) + ' / ≥' + toDispPress(fuelPressMin).toFixed(2) + ' ' + dispPressUnit()
          : toDispPress(Number(d.fuel_press)).toFixed(2) + ' ' + dispPressUnit() + ' / OFF';
      }
    }
  }

  // Battery voltage card
  const battCard = document.getElementById('batt-card');
  if (battCard) {
    battCard.style.display = d.has_batt_voltage ? '' : 'none';
    if (d.has_batt_voltage) {
      setText('batt-voltage', d.batt_voltage !== undefined ? Number(d.batt_voltage).toFixed(2) : '—');
      setText('max-batt-voltage', d.max_batt_voltage !== undefined ? Number(d.max_batt_voltage).toFixed(2) : '—');
      setDot('batt-health', d.batt_healthy, 'Battery voltage');
      {
        const battMin = Number(d.batt_volt_min || 0);
        setText('batt-volt-min', battMin > 0 ? battMin.toFixed(1) : 'OFF');
        if (d.batt_voltage !== undefined) {
          const v = Number(d.batt_voltage);
          // 0% width = at alarm threshold, 100% = 30% above threshold (typical full-charge headroom).
          const fullV = battMin * 1.3;
          const pct = battMin > 0 ? Math.min(100, Math.max(0,
            ((v - battMin) / (fullV - battMin)) * 100)) : 0;
          // Battery is inverted vs the temp/RPM gauges: a FULL pack is the good
          // state (green), a near-empty pack is the fault (red). Colour is forced
          // by voltage thresholds so a full battery never renders red. Optional
          // over-voltage (charger fault / wrong cell count) also flags once the
          // pack climbs meaningfully above the full reference.
          let cls = 'ok';
          if (battMin > 0) {
            if (v <= battMin)            cls = 'danger';   // at/below undervoltage alarm
            else if (v < battMin * 1.1)  cls = 'warn';     // within 10% of the alarm
            else if (v > fullV * 1.08)   cls = 'danger';   // over-voltage (well above full)
            else if (v > fullV)          cls = 'warn';     // slightly over full headroom
          }
          setGaugeBar('batt-gauge-bar', pct, battMin > 0 ? cls : 'ok');
        }
      }
    }
  }

  // Torque / shaft power card
  const torqueCard = document.getElementById('torque-card');
  if (torqueCard) {
    torqueCard.style.display = d.has_torque ? '' : 'none';
    if (d.has_torque) {
      setText('torque', d.torque !== undefined ? Number(d.torque).toFixed(1) : '—');
      setDot('torque-health', d.torque_healthy, 'Torque sensor');
      if (d.has_n2 && d.n2_healthy !== false && d.turbo_power_w !== undefined && d.turbo_power_w !== null) {
        const kw = Number(d.turbo_power_w) / 1000;
        setText('turbo-power', kw.toFixed(2));
      } else {
        setText('turbo-power', 'N2 required');
      }
    }
  }
  const thrustCard = document.getElementById('thrust-card');
  if (thrustCard) {
    thrustCard.style.display = d.has_thrust ? '' : 'none';
    if (d.has_thrust) {
      setText('thrust', d.thrust !== undefined ? Number(d.thrust).toFixed(1) : '—');
      setDot('thrust-health', d.thrust_healthy, 'Thrust sensor');
    }
  }

  // Glow plug current card
  const glowCurCard = document.getElementById('glow-current-card');
  if (glowCurCard) {
    glowCurCard.style.display = d.has_glow_current ? '' : 'none';
    if (d.has_glow_current) {
      setText('glow-current-val', d.glow_current_amps !== undefined ? Number(d.glow_current_amps).toFixed(1) : '—');
      const hot = !!d.glow_plug_hot;
      // Not-hot is a normal state (plug off or still heating), not a sensor
      // fault — render neutral instead of the red fault dot.
      setDot('glow-hot-dot', hot ? true : null);   // set class only; title managed below
      const ghDot = document.getElementById('glow-hot-dot');
      if (ghDot) ghDot.title = hot ? 'Glow plug — HOT (ready)' : 'Glow plug — cold / off';
      setText('glow-hot-label', hot ? 'HOT — ready' : 'not hot');
    }
  }

  // Igniter 1 / coil current card
  const ignCurCard = document.getElementById('igniter-current-card');
  if (ignCurCard) {
    ignCurCard.style.display = d.has_igniter_current ? '' : 'none';
    if (d.has_igniter_current) {
      setText('igniter-current-val', d.igniter_current_amps !== undefined ? Number(d.igniter_current_amps).toFixed(1) : '—');
    }
  }

  // AB / pilot igniter coil current card
  const ign2CurCard = document.getElementById('igniter2-current-card');
  if (ign2CurCard) {
    ign2CurCard.style.display = d.has_igniter2_current ? '' : 'none';
    if (d.has_igniter2_current) {
      setText('igniter2-current-val', d.igniter2_current_amps !== undefined ? Number(d.igniter2_current_amps).toFixed(1) : '—');
    }
  }

  // Oil pump current card
  const oilpCurCard = document.getElementById('oilpump-current-card');
  if (oilpCurCard) {
    oilpCurCard.style.display = d.has_oil_pump_current ? '' : 'none';
    if (d.has_oil_pump_current) {
      setText('oilpump-current-val', d.oil_pump_current_amps !== undefined ? Number(d.oil_pump_current_amps).toFixed(1) : '—');
      const oc = !!d.oil_pump_overcurrent;
      setDot('oilpump-oc-dot', !oc);         // set class only; title managed below
      const ocDot = document.getElementById('oilpump-oc-dot');
      if (ocDot) ocDot.title = oc ? 'Oil pump current — ⚠ OVERCURRENT' : 'Oil pump current — OK';
      setText('oilpump-oc-label', oc ? '⚠ OVERCURRENT' : 'OK');
    }
  }

  // Fuel flow card
  const fuelFlowCard = document.getElementById('fuel-flow-card');
  if (fuelFlowCard) {
    fuelFlowCard.style.display = d.has_fuel_flow ? '' : 'none';
    if (d.has_fuel_flow) {
      const ffOk = d.fuel_flow_healthy !== false;
      setText('fuel-flow-val', d.fuel_flow !== undefined && ffOk ? Number(d.fuel_flow).toFixed(2) : '—');
      setDot('fuel-flow-health', d.fuel_flow_healthy, lbl('fuel_flow'));
      const ffEl = document.getElementById('fuel-flow-val');
      if (ffEl) ffEl.title = ffOk ? '' : 'Fuel flow sensor fault (railed/disconnected) — check wiring';
    }
  }

  // ── General-purpose DI channel states ─────────────────────
  if (d.di_channels) {
    const wrap = document.getElementById('di-states-wrap');
    if (wrap) {
      const anyConfigured = d.di_channels.some(ch => ch.pin >= 0);
      wrap.style.display = anyConfigured ? 'flex' : 'none';
      d.di_channels.forEach((ch, i) => {
        if (ch.pin < 0) {
          const old = document.getElementById('di-badge-' + i);
          if (old) old.remove();
          return;
        }
        let el = document.getElementById('di-badge-' + i);
        if (!el) {
          el = document.createElement('span');
          el.id = 'di-badge-' + i;
          el.className = 'di-badge';
          wrap.appendChild(el);
        }
        const name = (ch.label && ch.label.length) ? ch.label : ('DI-' + (i + 1));
        el.textContent = name + ': ' + (ch.state ? 'ACTIVE' : 'off');
        // Color by role semantics: only fault/estop are alarming when active.
        // An active arm switch / interlock / start-inhibit is a normal state
        // and must not look like a fault.
        const alarmRole = ch.role === 'fault' || ch.role === 'estop';
        const activeColor = alarmRole ? 'var(--red)' : 'var(--yellow)';
        el.style.color = ch.state ? activeColor : 'var(--dim)';
        el.style.borderColor = ch.state ? activeColor : 'var(--border)';
      });
    }
  }

  // Surge warning banner
  const surgeBanner = document.getElementById('surge-warn-banner');
  if (surgeBanner) surgeBanner.style.display = d.surge_detected ? '' : 'none';

  // Governor status section
  const govSection = document.getElementById('governor-section');
  if (govSection) {
    govSection.style.display = d.has_governor ? '' : 'none';
    if (d.has_governor) {
      setText('gov-target-rpm', d.governor_target_rpm !== undefined ? fmtInt(d.governor_target_rpm) : '—');
      setText('gov-n2-actual',  d.n2 !== undefined ? fmtInt(d.n2) : '—');
      const govMode = document.getElementById('gov-mode');
      if (govMode) {
        if (d.governor_mode) {
          govMode.textContent = d.governor_mode === 'pitch' ? 'PROPELLER-PITCH CONTROL' : 'FUEL CONTROL';
          govMode.title = d.governor_mode === 'pitch'
            ? 'Holds N2 by adjusting propeller pitch/load — you set power with the throttle.'
            : 'Holds N2 by winding fuel/throttle directly — the governor owns the throttle.';
          govMode.style.display = '';
        } else {
          govMode.style.display = 'none';
        }
      }
    }
  }

  // ── Advanced actuators section (glow, bleed, prop pitch, pilot / auxiliary fuel pump, fan, airstarter, scavenge)
  const advActSection = document.getElementById('adv-act-section');
  if (advActSection) {
    const anyAdv = d.has_starter   || d.has_starter_en || d.has_fuel_sol  || d.has_igniter
                || d.has_igniter2  || d.has_glow_plug  || d.has_bleed_valve || d.has_prop_pitch || d.has_fuel_pump2
                || d.has_cool_fan  || d.has_airstarter  || d.has_oil_scavenge;
    advActSection.style.display = anyAdv ? '' : 'none';
    const actuatorIsRelay = type => Number(type) === 2;

    const advStarter = document.getElementById('adv-starter');
    if (advStarter) {
      advStarter.style.display = d.has_starter ? '' : 'none';
      if (d.has_starter && d.starter_demand !== undefined) {
        const pct = Math.round(Number(d.starter_demand) * 100);
        const relay = actuatorIsRelay(d.starter_type);
        setText('starter-pct', relay ? (pct > 0 ? 'ON' : 'OFF') : pct);
        setText('starter-unit', relay ? '' : '%');
        setGaugeBar('starter-gauge-bar', relay ? (pct > 0 ? 100 : 0) : pct);
      }
    }

    const advStarterEn = document.getElementById('adv-starter-en');
    if (advStarterEn) {
      advStarterEn.style.display = d.has_starter_en ? '' : 'none';
      if (d.has_starter_en) setText('starter-en-state', d.starter_enabled ? 'ON' : 'OFF');
    }

    const advFuelSol = document.getElementById('adv-fuel-sol');
    if (advFuelSol) {
      advFuelSol.style.display = d.has_fuel_sol ? '' : 'none';
      if (d.has_fuel_sol) setText('fuel-sol-state', d.fuel_sol_open ? 'OPEN' : 'CLOSED');
    }

    const advIgniter = document.getElementById('adv-igniter');
    if (advIgniter) {
      advIgniter.style.display = d.has_igniter ? '' : 'none';
      if (d.has_igniter) setText('igniter-state', d.igniter_on ? 'ON' : 'OFF');
    }

    const advIgniter2 = document.getElementById('adv-igniter2');
    if (advIgniter2) {
      advIgniter2.style.display = d.has_igniter2 ? '' : 'none';
      if (d.has_igniter2) setText('igniter2-state', d.igniter2_on ? 'ON' : 'OFF');
    }

    const advGlow = document.getElementById('adv-glow');
    if (advGlow) {
      advGlow.style.display = d.has_glow_plug ? '' : 'none';
      if (d.has_glow_plug && d.glow_plug_pct !== undefined) {
        const relay = Number(d.glow_plug_output_type || 0) === 1;
        setText('glow-pct', relay ? (Number(d.glow_plug_pct) > 0 ? 'ON' : 'OFF') : Math.round(d.glow_plug_pct));
        setText('glow-unit', relay ? '' : '%');
        setGaugeBar('glow-gauge-bar', relay ? (Number(d.glow_plug_pct) > 0 ? 100 : 0) : d.glow_plug_pct);
        const wetGlowFuel = document.getElementById('wet-glow-fuel-wrap');
        if (wetGlowFuel) wetGlowFuel.style.display = d.has_wet_glow ? '' : 'none';
        if (d.has_wet_glow && d.wet_glow_fuel_pct !== undefined) {
          const wetRelay = Number(d.wet_glow_fuel_type ?? 0) === 0;
          const wetPct = Number(d.wet_glow_fuel_pct);
          setText('wet-glow-fuel-pct', wetRelay ? (wetPct > 0 ? 'ON' : 'OFF') : Math.round(wetPct));
          setText('wet-glow-fuel-unit', wetRelay ? '' : '%');
        }
      }
    }

    const advBleed = document.getElementById('adv-bleed');
    if (advBleed) {
      advBleed.style.display = d.has_bleed_valve ? '' : 'none';
      if (d.has_bleed_valve) setText('bleed-state', d.bleed_valve_open ? 'OPEN' : 'CLOSED');
    }

    const advPitch = document.getElementById('adv-pitch');
    if (advPitch) {
      advPitch.style.display = d.has_prop_pitch ? '' : 'none';
      if (d.has_prop_pitch && d.prop_pitch_demand !== undefined) {
        const pct = Math.round(d.prop_pitch_demand * 100);
        const relay = actuatorIsRelay(d.prop_pitch_type);
        // Binary prop-pitch outputs are coarse/fine solenoids, not generic
        // on/off loads. Proportional servo/PWM installations retain 0-100%.
        setText('pitch-pct', relay ? (pct > 0 ? 'COARSE' : 'FINE') : pct);
        setText('pitch-unit', relay ? '' : '%');
        setGaugeBar('pitch-gauge-bar', relay ? (pct > 0 ? 100 : 0) : pct);
      }
    }

    const advFp2 = document.getElementById('adv-fp2');
    if (advFp2) {
      advFp2.style.display = d.has_fuel_pump2 ? '' : 'none';
      if (d.has_fuel_pump2 && d.fuel_pump2_demand !== undefined) {
        const pct = Math.round(d.fuel_pump2_demand * 100);
        const relay = actuatorIsRelay(d.fuel_pump2_type);
        setText('fp2-pct', relay ? (pct > 0 ? 'ON' : 'OFF') : pct);
        setText('fp2-unit', relay ? '' : '%');
        setGaugeBar('fp2-gauge-bar', relay ? (pct > 0 ? 100 : 0) : pct);
      }
    }

    const advFan = document.getElementById('adv-coolfan');
    if (advFan) {
      advFan.style.display = d.has_cool_fan ? '' : 'none';
      if (d.has_cool_fan) setText('coolfan-state', d.cool_fan_on ? 'ON' : 'OFF');
    }

    const advAir = document.getElementById('adv-airstarter');
    if (advAir) {
      advAir.style.display = d.has_airstarter ? '' : 'none';
      if (d.has_airstarter) setText('airstarter-state', d.airstarter_open ? 'OPEN' : 'CLOSED');
    }

    const advScav = document.getElementById('adv-scavenge');
    if (advScav) {
      advScav.style.display = d.has_oil_scavenge ? '' : 'none';
      if (d.has_oil_scavenge) setText('scavenge-state', d.oil_scavenge_on ? 'ON' : 'OFF');
    }
  }

  // ── Afterburner card
  const abSection = document.getElementById('ab-section');
  if (abSection) {
    const hasAB = !!(d.has_ab_pump || d.has_ab_sol || d.has_ab_flame ||
      d.ab_trigger_source > 0 || d.ab_input_fitted);
    abSection.style.display = hasAB ? '' : 'none';
    if (hasAB) {
      const abMode = d.ab_mode || 'Off';
      const modeEl = document.getElementById('ab-mode-val');
      if (modeEl) {
        modeEl.textContent = abMode.toUpperCase();
        modeEl.className   = 'ab-mode-val ab-mode-' + abMode;
      }
      // These are normal boolean STATES, not sensor health: closed solenoid /
      // arm off / trigger idle must render neutral, not red-fault. Titles are
      // set manually so the generic "sensor fault (check wiring)" text never
      // appears for a normal inactive state.
      setDot('ab-sol-dot',  d.ab_sol_open      ? true : null);
      setDot('ab-arm-dot',  d.ab_arm_switch_on ? true : null);
      setDot('ab-trig-dot', d.ab_trigger_active ? true : null);
      const _abT = (id, txt) => { const e = document.getElementById(id); if (e) e.title = txt; };
      _abT('ab-sol-dot',  'Afterburner fuel valve — ' + (d.ab_sol_open ? 'OPEN' : 'closed'));
      _abT('ab-arm-dot',  'AB arm switch — ' + (d.ab_arm_switch_on ? 'ARMED' : 'off'));
      _abT('ab-trig-dot', 'AB trigger — ' + (d.ab_trigger_active ? 'ACTIVE' : 'idle'));
      // AB flame: red only when the AB should be lit but no flame is seen —
      // that is a real cue; otherwise neutral (green when burning).
      const abExpectFlame = abMode === 'Igniting' || abMode === 'Running';
      setDot('ab-flame-dot', d.has_ab_flame === false ? null
                            : (d.ab_flame_on ? true : (abExpectFlame ? false : null)));
      _abT('ab-flame-dot', d.has_ab_flame === false ? 'AB flame sensor not fitted'
                          : (d.ab_flame_on ? 'AB flame — confirmed'
                             : (abExpectFlame ? 'AB flame — NOT DETECTED while lit' : 'AB flame — no flame')));
      if (d.ab_pump_demand !== undefined) setText('ab-pump-demand', Math.round(Number(d.ab_pump_demand) * 100));
      const abOffset = Number(d.ab_fuel_offset || 0);
      const abOffsetRow = document.getElementById('ab-fuel-offset-row');
      if (abOffsetRow) abOffsetRow.style.display = Math.abs(abOffset) > 0.001 ? '' : 'none';
      setText('ab-fuel-offset', Math.round(abOffset * 100));

      // Manual FIRE is only meaningful when Hardware trigger source is Manual command only.
      const manualAb = Number(d.ab_trigger_source ?? 0) === 0;
      const canFire = manualAb && d.mode === 'RUNNING' && (abMode === 'Off' || abMode === 'Fault');
      setDisabled('btn-ab-fire', !canFire);
      // STOP: only enabled when AB is active
      const abActive = abMode === 'Arming' || abMode === 'Igniting' || abMode === 'Running' || abMode === 'ShuttingDown';
      setDisabled('btn-ab-stop', !abActive);
    }
  }

  // ── Post-run summary + sequence timeline tracking ─────────
  _trackRunState(d);
  return d;
}

// ── Run state tracking ────────────────────────────────────────
let _prevMode        = null;
let _runStartMs      = null;
let _seqTimeline     = [];    // [{name, durationMs}] completed startup blocks
let _seqLastBlockIdx = -1;
let _seqBlockStart   = null;
let _seqCurBlockName = null;

function _trackRunState(d) {
  const mode = d.mode;
  const now  = Date.now();

  // ── Sequence timeline — track block transitions during STARTUP ──
  if (mode === 'STARTUP') {
    if (_prevMode !== 'STARTUP') {
      // New sequence starting — reset timeline
      _seqTimeline     = [];
      _seqLastBlockIdx = -1;
      _seqBlockStart   = now;
      _seqCurBlockName = sequenceBlockLabel(d.current_block);
    }
    const idx = d.seq_block_idx !== undefined ? d.seq_block_idx : -1;
    if (idx > _seqLastBlockIdx) {
      if (_seqLastBlockIdx >= 0) {
        // Previous block just completed — record it
        _seqTimeline.push({ name: _seqCurBlockName, durationMs: now - (_seqBlockStart || now) });
        _renderLiveTimeline();
      }
      _seqLastBlockIdx = idx;
      _seqCurBlockName = sequenceBlockLabel(d.current_block);
      _seqBlockStart   = now;
    }
  }

  // Live timeline strip inside seq-progress section
  const liveStrip = document.getElementById('seq-timeline-strip');
  if (liveStrip) {
    if (mode === 'STARTUP' && _seqTimeline.length > 0) {
      liveStrip.style.display = 'flex';
      _renderLiveTimeline();
    } else {
      liveStrip.style.display = 'none';
    }
  }

  // ── Post-run summary on transition back to idle ────────────
  const wasActive = _prevMode === 'RUNNING' || _prevMode === 'STARTUP' || _prevMode === 'SHUTDOWN';
  const nowIdle   = mode === 'STANDBY' || mode === 'FAULT';
  if (wasActive && nowIdle && _runStartMs !== null) {
    // Finalise timeline — push last block if we were in STARTUP
    if (_prevMode === 'STARTUP' && _seqCurBlockName) {
      _seqTimeline.push({ name: _seqCurBlockName, durationMs: now - (_seqBlockStart || now) });
    }
    _showRunSummary(d, now - _runStartMs);
    _runStartMs = null;
  }

  // Track engine start (STANDBY→STARTUP/RUNNING)
  if ((_prevMode === 'STANDBY' || _prevMode === 'FAULT' || _prevMode === null)
      && (mode === 'STARTUP' || mode === 'RUNNING')) {
    _runStartMs = now;
  }

  _prevMode = mode;
}

function _renderLiveTimeline() {
  const strip = document.getElementById('seq-timeline-strip');
  if (!strip) return;
  strip.innerHTML = _seqTimeline.map(b => _timelinePill(b)).join('');
}

// Escape user-influenced strings (e.g. custom sequence block names) before
// interpolating into innerHTML. Shared site-wide: app.js loads before every
// page's inline script, so pages use this instead of defining their own copy.
function escapeHtmlText(v) {
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const _escapeHtml = escapeHtmlText;  // internal alias (pre-unification name)

function _timelinePill(b) {
  const s = (b.durationMs / 1000).toFixed(1);
  return `<span style="font-size:.7rem;padding:.15rem .5rem;border-radius:3px;` +
    `background:rgba(255,255,255,.06);border:1px solid var(--border);` +
    `color:var(--dim);white-space:nowrap">${_escapeHtml(b.name)} ` +
    `<span style="color:var(--text)">${s}s</span></span>`;
}

function _showRunSummary(d, durationMs) {
  const card = document.getElementById('run-summary-card');
  if (!card) return;

  const faultText = String(d.fault_description || '').trim();
  const lastEvent = String(d.last_event || '');
  const isAbort = lastEvent.startsWith('Aborted') || faultText.startsWith('Startup aborted');
  const isFault  = d.mode === 'FAULT' || isAbort || faultText.length > 0 || lastEvent.startsWith('FAULT:');
  const titleEl  = document.getElementById('run-summary-title');
  if (titleEl) {
    titleEl.textContent = isFault ? (isAbort ? 'Run ended - Abort' : 'Run ended - Fault') : 'Run complete';
    titleEl.style.color = isFault ? 'var(--red)' : 'var(--green)';
  }

  const mins = Math.floor(durationMs / 60000);
  const secs = Math.round((durationMs % 60000) / 1000);
  const durStr = mins > 0 ? mins + 'm ' + secs + 's' : secs + 's';

  const stats = [
    { label: 'Duration', value: durStr },
    (d.has_n1 && d.max_n1 !== undefined) ? { label: 'Peak N1',  value: fmtInt(d.max_n1) + ' RPM' } : null,
    (d.has_n2 && d.max_n2 !== undefined) ? { label: 'Peak N2',  value: fmtInt(d.max_n2) + ' RPM' } : null,
    (d.has_tot && d.max_tot !== undefined) ? { label: 'Peak TOT', value: toDispTemp(Number(d.max_tot)).toFixed(0) + ' ' + dispTempUnit() } : null,
    (d.has_tit && d.max_tit !== undefined) ? { label: 'Peak TIT', value: toDispTemp(Number(d.max_tit)).toFixed(0) + ' ' + dispTempUnit() } : null,
    (d.has_oil_press && d.min_oil !== undefined && d.min_oil !== null)
      ? { label: 'Minimum oil pressure', value: toDispPress(Number(d.min_oil)).toFixed(2) + ' ' + dispPressUnit() } : null,
  ].filter(Boolean);

  const statsEl = document.getElementById('run-summary-stats');
  if (statsEl) {
    statsEl.innerHTML = stats.map(s =>
      `<span><span style="color:var(--dim)">${_escapeHtml(s.label)}:</span> <strong>${_escapeHtml(s.value)}</strong></span>`
    ).join('');
    if (isFault && faultText.length > 0) {
      const line = faultText.split('\n')[0].slice(0, 120);
      const faultEl = document.createElement('div');
      faultEl.style.cssText = 'width:100%;color:var(--red);font-size:.78rem;margin-top:.3rem';
      faultEl.textContent = (isAbort ? 'Abort: ' : 'Fault: ') + line;
      statsEl.appendChild(faultEl);
    }
  }

  // Sequence timeline
  const tlSection = document.getElementById('run-summary-timeline');
  const tlStrip   = document.getElementById('run-summary-timeline-strip');
  if (tlSection && tlStrip) {
    if (_seqTimeline.length > 0) {
      tlStrip.innerHTML = _seqTimeline.map(b => _timelinePill(b)).join('');
      tlSection.style.display = '';
    } else {
      tlSection.style.display = 'none';
    }
  }

  card.style.display = '';
}

function dismissRunSummary() {
  const card = document.getElementById('run-summary-card');
  if (card) card.style.display = 'none';
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setDot(id, ok, tooltip) {
  const el = document.getElementById(id);
  if (!el) return;
  // null/undefined → neutral gray dot (sensor not relevant in this mode)
  if (ok === null || ok === undefined) {
    el.className = 'dot';
    if (tooltip !== undefined) el.title = tooltip ? tooltip + ' — standby' : '';
  } else {
    el.className = 'dot ' + (ok ? 'ok' : 'fault');
    if (tooltip !== undefined) {
      el.title = ok
        ? tooltip + ' — OK'
        : tooltip + ' — sensor fault (check wiring)';
    }
  }
}

function setDisabled(id, dis) {
  const el = document.getElementById(id);
  if (el) el.disabled = dis;
}

function setHwActive(id, active) {
  const el = document.getElementById(id);
  if (!el) return;
  if (active) el.classList.add('hw-active');
  else        el.classList.remove('hw-active');
}

function setGaugeBar(id, pct, forceClass) {
  const bar = document.getElementById(id);
  if (!bar) return;
  const clamped = Math.min(100, Math.max(0, pct));
  bar.style.width = clamped + '%';
  // forceClass decouples color from width for gauges whose danger direction
  // is inverted (oil: LOW pressure is the dangerous state, not high).
  if (forceClass !== undefined) {
    bar.className = forceClass === 'ok' ? 'gauge-bar' : 'gauge-bar ' + forceClass;
    return;
  }
  if (pct >= 95) { bar.className = 'gauge-bar danger'; }
  else if (pct >= 80) { bar.className = 'gauge-bar warn'; }
  else { bar.className = 'gauge-bar'; }
}

function formatUptime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + sec + 's';
  return sec + 's';
}

// ── REST helpers ──────────────────────────────────────────────
function sendCmd(url) {
  return fetch(url, { method: 'POST' })
    .then(async r => {
      let d = {};
      try { d = await r.json(); } catch {}
      if (!r.ok || !d.ok) {
        const msg = d.error || ('HTTP ' + r.status);
        console.warn('Command failed', d);
        alert(msg);
      }
      return d;
    })
    .catch(e => {
      console.error('Network error', e);
      alert('Network error: ' + e.message);
      return { ok:false, error:e.message };
    });
}

function sendAbCmd(cmd) {
  fetch('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd })
  })
    .then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) throw new Error(d.error || d.reason || ('HTTP ' + r.status));
    })
    .catch(e => alert('Afterburner command failed: ' + e.message));
}

// Clear all session peak values (max N1/N2/TOT/TIT/pressures/battery) — the
// firmware command existed but had no web control, so a bench spike could
// only be cleared by reboot or cluster command.
async function resetPeaks() {
  if (!await OTDialog.confirm('Reset all session peak values (max RPM, temperatures, pressures)?', {
    title:'Reset session peaks', confirmLabel:'Reset peaks'
  })) return;
  fetch('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'RESET_PEAKS' })
  })
    .then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) throw new Error(d.error || d.reason || ('HTTP ' + r.status));
      requestTelemetryNow();
    })
    .catch(e => alert('Peak reset failed: ' + e.message));
}

// ── Boot: prime dashboard via REST for instant first paint, then WS takes over ─
applyUnitLabels();
organizeDashboardCards();
document.addEventListener('DOMContentLoaded', () => {
  applyContextTooltips();
  new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeType === 1) applyContextTooltips(node);
    }));
  }).observe(document.body, { childList: true, subtree: true });
});
window.addEventListener('focus', requestTelemetryNow);
window.addEventListener('pageshow', (e) => {
  // bfcache restore (iOS Safari back/forward): pagehide tore down the WS and
  // all timers, but the DOM comes back showing the old green Connected dot.
  // Restart whichever telemetry path this page uses. Only on real restores
  // (e.persisted) — a normal first show must not defeat the staggered
  // startTelemetryBoot() below.
  if (!e.persisted) return;
  if (usesGlobalTelemetry()) {
    if (!ws) {
      setConnectionState(false, 'Reconnecting - values retained');
      connect();
      startRestFallbackTimer();
    }
    requestTelemetryNow();
  } else if (!hasPageLocalTelemetry()) {
    startStatusHeartbeat();
  }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) requestTelemetryNow();
});
window.addEventListener('pagehide', stopGlobalTelemetry);
window.addEventListener('beforeunload', stopGlobalTelemetry);
window.addEventListener('ot:navigation-start', stopGlobalTelemetry);
function startTelemetryBoot() {
  if (!usesGlobalTelemetry()) {
    if (!hasPageLocalTelemetry()) startStatusHeartbeat();
    return;
  }
  connect();
  startRestFallbackTimer();
  if (isDashboardPage()) {
    // Live values arrive immediately over WS. Delay the much larger full
    // snapshot until the user has actually remained on Dashboard; otherwise a
    // quick menu click can abandon this Classic ESP32 transfer behind the next
    // page request. The navigation teardown cancels this timer.
    _dashboardBootstrapTimer = setTimeout(() => {
      _dashboardBootstrapTimer = null;
      fetch('/api/data', { cache: 'no-store' })
        .then(r => r.json())
        .then(d => { try { applyData(d); } catch(e) {} })
        .catch(() => {});
    }, 2500);
  }
}

function setTelemetryStale(stale, ageMs = 0) {
  if (!isLiveTelemetryPage()) return;
  _telemetryStale = !!stale;
  document.body?.classList.toggle('telemetry-stale', _telemetryStale);
  let banner = document.getElementById('telemetry-stale-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'telemetry-stale-banner';
    banner.style.cssText = 'display:none;position:sticky;top:48px;z-index:95;padding:.65rem 1rem;text-align:center;background:#7f1d1d;color:#fff;border-bottom:2px solid #ef4444;font-weight:800;letter-spacing:.04em';
    document.body.insertBefore(banner, document.body.firstChild?.nextSibling || null);
  }
  banner.style.display = _telemetryStale ? '' : 'none';
  if (_telemetryStale) {
    banner.textContent = `TELEMETRY STALE - last update ${(ageMs / 1000).toFixed(1)} s ago`;
    ['btn-start','btn-ab-fire'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });
  }
}

function startStaleMonitor() {
  if (_staleTimer || !isLiveTelemetryPage()) return;
  _staleTimer = setInterval(() => {
    if (!_lastMsgMs || document.hidden) return;
    const age = Date.now() - _lastMsgMs;
    const staleAfter = Math.max(2500, desiredPullPeriodMs() * 3 + 500);
    setTelemetryStale(age > staleAfter, age);
  }, 500);
}

function mergeTelemetryChannels(previousRows, nextRows) {
  if (!Array.isArray(nextRows)) return nextRows;
  const prevById = new Map((Array.isArray(previousRows) ? previousRows : [])
    .filter(row => row && row.id)
    .map(row => [String(row.id), row]));
  return nextRows.map((row, index) => {
    if (!row) return row;
    const prev = row.id ? prevById.get(String(row.id)) : (Array.isArray(previousRows) ? previousRows[index] : null);
    return prev ? Object.assign({}, prev, row) : row;
  });
}

const DASHBOARD_CORE_OUTPUT_PURPOSES = new Set([
  'main_fuel','fuel_shutoff','starter','starter_enable','oil_pump','scavenge_pump',
  'cooling_fan','fuel_pump','igniter','ab_igniter','glow_plug','ab_pump','prop_pitch',
  'air_starter'
]);
const DASHBOARD_CORE_OUTPUT_IDS = new Set([
  'main_fuel_output','main_fuel','throttle','main_starter','starter','starter_main',
  'starter_enable','starter_enable_main','oil_pump','oil_pump_main','fuel_shutoff',
  'main_fuel_shutoff','fuel_sol','igniter','igniter_main','ab_igniter','igniter2',
  'glow_plug','glow_plug_main','ab_pump','ab_pump_main','prop_pitch','prop_pitch_main',
  'fuel_pump','fuel_pump2','cooling_fan','cool_fan','air_starter','airstarter_sol',
  'scavenge_pump','oil_scavenge_pump'
]);
function registryOutputAlreadyHasCoreCard(ch) {
  const id = String(ch?.id || '');
  const purpose = String(ch?.purpose || '');
  return DASHBOARD_CORE_OUTPUT_IDS.has(id) || DASHBOARD_CORE_OUTPUT_PURPOSES.has(purpose);
}
const DASHBOARD_CORE_INPUT_PURPOSES = new Set([
  'n1_speed','n2_speed','tot','tit','oil_pressure','oil_temperature','fuel_pressure',
  'fuel_flow','p1_pressure','p2_pressure','flame','torque','thrust','battery_voltage','throttle','idle'
]);
const DASHBOARD_CORE_INPUT_IDS = new Set([
  'n1_main','primary_n1','n2_main','primary_n2','tot_main','primary_egt','tit_main',
  'oil_pressure_main','oil_temperature','fuel_pressure','fuel_flow','p1_main','p1',
  'p2_main','p2','flame_main','torque_main','thrust_main','battery_voltage','batt_voltage_main',
  'operator_throttle','operator_idle','throttle_input','idle_input'
]);
function registryInputAlreadyHasCoreCard(ch) {
  const id = String(ch?.id || '');
  const purpose = String(ch?.purpose || '');
  return DASHBOARD_CORE_INPUT_IDS.has(id) || DASHBOARD_CORE_INPUT_PURPOSES.has(purpose);
}
function registryInputIsBinary(ch) {
  const role = String(ch?.role || '');
  return Number(ch?.driver) === 0 || ['digital_switch','fault','estop','inhibit_start','low_oil_switch','oil_zero_switch','sequence_gate','ab_arm','ab_fire','limp_mode','flame'].includes(role);
}
function registryInputDisplay(ch) {
  const value = Number(ch?.value);
  if (!Number.isFinite(value)) return {value:'—', unit:'', numeric:null};
  const role = String(ch?.role || '');
  const purpose = String(ch?.purpose || '');
  if (registryInputIsBinary(ch)) return {value:value >= 0.5 ? 'ON' : 'OFF', unit:'', numeric:value};
  if (role === 'temperature') return {value:toDispTemp(value).toFixed(1), unit:dispTempUnit(), numeric:value};
  if (role === 'pressure') return {value:toDispPress(value).toFixed(2), unit:dispPressUnit(), numeric:value};
  if (role === 'speed') return {value:fmtInt(value), unit:'RPM', numeric:value};
  if (role === 'voltage') return {value:value.toFixed(2), unit:'V', numeric:value};
  if (role === 'flow') return {value:value.toFixed(2), unit:'L/min', numeric:value};
  if (role === 'torque') return {value:value.toFixed(1), unit:'Nm', numeric:value};
  if (role === 'thrust') return {value:value.toFixed(1), unit:'N', numeric:value};
  if (role === 'operator') return {value:(value * 100).toFixed(1), unit:'%', numeric:value};
  if (purpose === 'generic' || role === 'generic') return {value:value.toFixed(3), unit:'0-1', numeric:value};
  return {value:value.toFixed(2), unit:'', numeric:value};
}
function registryInputRangeText(ch) {
  const role = String(ch?.role || '');
  const purpose = String(ch?.purpose || '');
  if (registryInputIsBinary(ch)) return 'digital On/Off input';
  if (role === 'temperature') return purpose === 'coolant_temp' ? 'coolant temperature' : 'temperature input';
  if (role === 'pressure') return 'pressure input';
  if (role === 'speed') return 'speed input';
  if (role === 'voltage') return 'voltage input';
  if (role === 'flow') return 'flow input';
  if (purpose === 'generic' || role === 'generic') return 'normalized automation input';
  return 'registry input';
}
function renderRegistryInputCards(d) {
  const hostParent = document.getElementById('electrical-cards');
  if (!hostParent) return 0;
  let host = document.getElementById('registry-input-cards');
  if (!host) {
    host = document.createElement('div');
    host.id = 'registry-input-cards';
    host.style.display = 'contents';
    hostParent.appendChild(host);
  }
  const rows = (Array.isArray(d.registry_inputs) ? d.registry_inputs : [])
    .filter(ch => ch && ch.id && !registryInputAlreadyHasCoreCard(ch));
  if (!rows.length) {
    host.innerHTML = '';
    return 0;
  }
  host.innerHTML = rows.map((ch, i) => {
    const safeId = String(ch.id || `input_${i}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const name = registryDisplayName(ch, 'Input');
    const display = registryInputDisplay(ch);
    const range = registryInputRangeText(ch);
    const health = ch.healthy === false ? ' bad' : '';
    return `<div class="card small registry-input-card" data-registry-input-id="${escapeHtmlText(safeId)}" title="${escapeHtmlText(name)} live value. ${escapeHtmlText(range)}.">
      <div class="label">${escapeHtmlText(name)} <span class="dot${health}" title="${ch.healthy === false ? 'Unhealthy' : 'Healthy'}"></span></div>
      <div class="value small">${escapeHtmlText(display.value)}</div>
      <div class="peak-val">${escapeHtmlText(display.unit || range)}</div>
      <canvas class="sparkline" id="regin-spark-${escapeHtmlText(safeId)}"></canvas>
    </div>`;
  }).join('');
  rows.forEach((ch, i) => {
    const safeId = String(ch.id || `input_${i}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const display = registryInputDisplay(ch);
    if (display.numeric !== null) {
      const arr = registryInputSparkSeries(ch.id);
      pushSparkline(arr, display.numeric);
      drawSparkline('regin-spark-' + safeId, arr, 'var(--accent)');
    }
  });
  return rows.length;
}
function registryOutputRangeText(ch) {
  const driver = Number(ch?.driver);
  if (driver === 4) return 'relay output';
  if (driver === 5) return `${Math.round(Number(ch?.min || 0) * 100)}–${Math.round(Number(ch?.max ?? 1) * 100)}% PWM range`;
  if (driver === 6) return `${Math.round(Number(ch?.min || 1000))}–${Math.round(Number(ch?.max || 2000))} us servo range`;
  return 'output range';
}
function renderRegistryOutputCards(d) {
  const outputCards = document.getElementById('actuator-output-cards');
  if (!outputCards) return;
  let host = document.getElementById('registry-output-cards');
  if (!host) {
    host = document.createElement('div');
    host.id = 'registry-output-cards';
    host.style.display = 'contents';
    outputCards.appendChild(host);
  }
  const rows = (Array.isArray(d.registry_outputs) ? d.registry_outputs : [])
    .filter(ch => ch && ch.id && !registryOutputAlreadyHasCoreCard(ch));
  if (!rows.length) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = rows.map((ch, i) => {
    const driver = Number(ch.driver);
    const relay = driver === 4;
    const demand = Math.max(0, Math.min(1, Number(ch.demand || 0)));
    const pct = demand * 100;
    const id = String(ch.id || `output_${i}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const value = relay ? (demand >= 0.5 ? 'ON' : 'OFF') : `${pct.toFixed(1)}%`;
    const name = registryDisplayName(ch);
    const range = registryOutputRangeText(ch);
    const current = ch.has_current
      ? `<div class="oil-sub">current: ${Number.isFinite(Number(ch.current_amps)) ? Number(ch.current_amps).toFixed(2) + ' A' : '—'}${ch.current_healthy === false ? ' ⚠' : ''}</div>`
      : '';
    return `<div class="card small registry-output-card" data-registry-output-id="${escapeHtmlText(id)}" title="${escapeHtmlText(name)} current command. ${escapeHtmlText(range)}.">
      <div class="label">${escapeHtmlText(name)}</div>
      <div class="value small">${value}</div>
      <div class="gauge-bar-wrap"><div class="gauge-bar" style="width:${relay ? (demand >= 0.5 ? 100 : 0) : pct}%"></div></div>
      <div class="oil-sub">${escapeHtmlText(range)}</div>
      ${current}
    </div>`;
  }).join('');
}
window.startTelemetryBoot = startTelemetryBoot;
function scheduleTelemetryBoot() {
  if (pageStartsTelemetryAfterSetup()) return;
  const delay = isDashboardPage() ? 0 : 400;
  const boot = () => setTimeout(startTelemetryBoot, delay);
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot, { once: true });
}
scheduleTelemetryBoot();

// Show banner if startup sequence is empty (checked once at page load)
const _emptySeqBanner = document.getElementById('empty-seq-banner');
if (_emptySeqBanner) {
  fetch('/api/hardware')
    .then(r => r.json())
    .then(hw => {
      _emptySeqBanner.style.display = (hw.startup_seq && hw.startup_seq.length > 0) ? 'none' : '';
    })
    .catch(() => {});
}
