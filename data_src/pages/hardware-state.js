// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
let cfg = {};
let _hwDirty = false;
let settingsCfg = {};
let pcbProfile = {state:'absent', ports:[]};
let engineMode = 'STANDBY';
let _loadedProfileId = 'OpenTurbine';
let _loadedHardwareCfg = {};
let _loadedSettingsCfg = {};

function cloneHardwareJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function hardwarePlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Registry rows have stable IDs, so merge them as records rather than treating
// the entire array as one stale replacement. This preserves a newer
// Calibration-page edit to an untouched field/card while Hardware is open.
function mergeHardwareRegistryRows(baseline, edited, fresh) {
  const baseRows = Array.isArray(baseline) ? baseline : [];
  const editRows = Array.isArray(edited) ? edited : [];
  const freshRows = Array.isArray(fresh) ? fresh : [];
  const baseById = new Map(baseRows.filter(row => row?.id).map(row => [String(row.id), row]));
  const editById = new Map(editRows.filter(row => row?.id).map(row => [String(row.id), row]));
  const freshById = new Map(freshRows.filter(row => row?.id).map(row => [String(row.id), row]));

  // A row deliberately removed in Hardware stays removed even if another page
  // changed one of its fields meanwhile.
  for (const id of baseById.keys()) if (!editById.has(id)) freshById.delete(id);

  for (const [id, editRow] of editById) {
    const baseRow = baseById.get(id);
    if (!baseRow) freshById.set(id, cloneHardwareJson(editRow));
    else freshById.set(id, mergeHardwareEdits(baseRow, editRow, freshById.get(id) || baseRow));
  }

  // Retain the Hardware ordering, then append any card added concurrently.
  const merged = [];
  const used = new Set();
  for (const row of editRows) {
    const id = String(row?.id || '');
    if (!id || used.has(id) || !freshById.has(id)) continue;
    merged.push(freshById.get(id)); used.add(id);
  }
  for (const row of freshRows) {
    const id = String(row?.id || '');
    if (!id || used.has(id) || !freshById.has(id)) continue;
    merged.push(freshById.get(id)); used.add(id);
  }
  return merged;
}

// Apply only Hardware-page edits to the latest committed hardware document.
// Most arrays are intentional replacement units. Registry input/output arrays
// are ID-keyed records and merge per field so concurrent calibration survives.
function mergeHardwareEdits(baseline, edited, fresh) {
  const base = hardwarePlainObject(baseline) ? baseline : {};
  const edit = hardwarePlainObject(edited) ? edited : {};
  const out = hardwarePlainObject(fresh) ? cloneHardwareJson(fresh) : {};
  const keys = new Set([...Object.keys(base), ...Object.keys(edit)]);
  for (const key of keys) {
    const hasEdit = Object.prototype.hasOwnProperty.call(edit, key);
    const before = base[key];
    const after = edit[key];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (!hasEdit) delete out[key];
    else if ((key === 'inputs' || key === 'outputs') &&
             Array.isArray(before) && Array.isArray(after) && Array.isArray(out[key]))
      out[key] = mergeHardwareRegistryRows(before, after, out[key]);
    else if (hardwarePlainObject(before) && hardwarePlainObject(after))
      out[key] = mergeHardwareEdits(before, after, out[key]);
    else out[key] = cloneHardwareJson(after);
  }
  return out;
}

function mergeHardwareSettingsCleanup(baseline, edited, fresh) {
  const out = cloneHardwareJson(fresh);
  const beforeUnderflow = baseline?.oil_advanced?.shutdown_on_underflow;
  const afterUnderflow = edited?.oil_advanced?.shutdown_on_underflow;
  if (beforeUnderflow !== afterUnderflow) {
    out.oil_advanced ||= {};
    out.oil_advanced.shutdown_on_underflow = !!afterUnderflow;
  }
  // Hardware only removes rules that reference a removed channel. Apply those
  // exact removals to the fresh array so concurrent rule additions/edits are
  // preserved rather than replacing the entire array from a stale tab.
  const editedRuleKeys = new Set((edited?.rules || []).map(rule => JSON.stringify(rule)));
  const removedRuleKeys = new Set((baseline?.rules || [])
    .map(rule => JSON.stringify(rule)).filter(key => !editedRuleKeys.has(key)));
  if (removedRuleKeys.size && Array.isArray(out.rules))
    out.rules = out.rules.filter(rule => !removedRuleKeys.has(JSON.stringify(rule)));
  return out;
}

function outputDriverIsOnOff(driver) { return [4,11].includes(Number(driver)); }
function outputDriverIsProportional(driver) { return [5,6].includes(Number(driver)); }

let ws;
let wsPullTimer = null;
let statusPollTimer = null;
let hardwareStatusInFlight = false;
let wsClosingForNavigation = false;
function requestHardwareTelemetry() {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send('p');
}
function stopHardwareTelemetry() {
  wsClosingForNavigation = true;
  if (wsPullTimer) { clearInterval(wsPullTimer); wsPullTimer = null; }
  if (i2cDiscoveryTimer) { clearInterval(i2cDiscoveryTimer); i2cDiscoveryTimer = null; }
  stopStatusPoll();
  if (ws) {
    try {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000, 'page navigation');
    } catch(_) {}
    ws = null;
  }
}
function connectWs() {
  if (wsClosingForNavigation) return;
  if (ws && ws.readyState <= WebSocket.OPEN) return;
  ws = new WebSocket('ws://' + location.host + '/ws');
  ws.onopen  = () => {
    setConn(true, 'Connected');
    stopStatusPoll();
    requestHardwareTelemetry();
    if (wsPullTimer) clearInterval(wsPullTimer);
    wsPullTimer = setInterval(requestHardwareTelemetry, 1000);
  };
  ws.onclose = () => {
    if (wsPullTimer) { clearInterval(wsPullTimer); wsPullTimer = null; }
    setConn(false, 'Reconnecting');
    if (!wsClosingForNavigation) {
      startStatusPoll();
      setTimeout(connectWs, 2000);
    }
  };
  ws.onerror = () => { try { ws.close(); } catch(_) {} };
  ws.onmessage = (e) => {
    try { applyHardwareTelemetry(JSON.parse(e.data)); } catch(_) {}
  };
}
function applyHardwareTelemetry(d) {
  engineMode = d.mode || 'STANDBY';
  updateSaveButton();
  if (d.di_channels) {
    d.di_channels.forEach((ch, i) => {
      const dot = document.getElementById('di-live-' + i);
      if (dot) {
        dot.className = 'dot ' + (ch.state ? 'green' : '');
        dot.title = ch.state ? 'ACTIVE' : 'inactive';
      }
    });
  }
}
window.addEventListener('pagehide', stopHardwareTelemetry);
window.addEventListener('beforeunload', stopHardwareTelemetry);
window.addEventListener('ot:navigation-start', stopHardwareTelemetry);
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  wsClosingForNavigation = false;
  if (cfg?.platform === 'esp32') startStatusPoll();
  else connectWs();
});
function setConn(ok, text) {
  const dot = document.getElementById('conn');
  const lbl = document.getElementById('conn-label');
  if (dot) dot.className = 'conn-dot ' + (ok ? 'connected' : 'disconnected');
  if (lbl) lbl.textContent = text || (ok ? 'Connected' : 'Disconnected');
}
async function refreshHardwareStatus() {
  if (hardwareStatusInFlight) return;
  hardwareStatusInFlight = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const r = await fetch('/api/telemetry', { cache:'no-store', signal:controller.signal });
    setConn(r.ok, r.ok ? 'Connected' : 'Disconnected');
    if (r.ok) applyHardwareTelemetry(await r.json());
  } catch (_) {
    setConn(false, 'Disconnected');
  } finally {
    clearTimeout(timeout);
    hardwareStatusInFlight = false;
  }
}
function startStatusPoll() {
  if (statusPollTimer) return;
  refreshHardwareStatus();
  statusPollTimer = setInterval(refreshHardwareStatus, 1000);
}
function stopStatusPoll() {
  if (!statusPollTimer) return;
  clearInterval(statusPollTimer);
  statusPollTimer = null;
}

async function fetchHardwareJson(url, attempts = 4) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {cache:'no-store'});
      if (response.ok) return await response.json();
      const detail = await response.json().catch(() => ({}));
      lastError = new Error(detail.error || `HTTP ${response.status}`);
      if (![409, 503].includes(response.status)) throw lastError;
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts) break;
    }
    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw lastError || new Error('No response');
}

async function loadHardware() {
  document.getElementById('save-msg').textContent = 'Loading…';
  try {
    cfg = await fetchHardwareJson('/api/hardware');
    // Live bus state has its own small endpoint; keep it out of the large,
    // mostly-static editor document and fetch it only after that response has
    // completed.
    try { cfg._i2c_discovery = await fetchHardwareJson('/api/i2c_discovery', 2); }
    catch (_) { cfg._i2c_discovery = {}; }
    pcbProfile = cfg._pcb_profile || {state:'absent', ports:[]};
    if (pcbProfile.state === 'valid') {
      const ports = [];
      const total = Number(pcbProfile.port_count || 0);
      for (let offset = 0; offset < total; offset += 12) {
        const page = await fetchHardwareJson(`/api/pcb_profile?offset=${offset}&limit=12`);
        ports.push(...(page.ports || []));
      }
      pcbProfile.ports = ports;
    }
    try {
      // Hardware only needs the settings section for dependency cleanup. Do
      // not fetch the much larger combined ECU document while the hardware
      // response and PCB catalog pages may still be leaving the TCP stack.
      settingsCfg = await fetchHardwareJson('/api/config');
    } catch (_) {
      settingsCfg = {};
    }
    _loadedProfileId = (cfg.profile_id || 'OpenTurbine').trim() || 'OpenTurbine';
    GPIO_DB = cfg.platform === 'esp32s3' ? GPIO_DB_ESP32S3 : GPIO_DB_ESP32;
    populate();
    _snapshotFields();   // baseline — any field that diverges from this gets the save-warning highlight
    // populate() renders workflow cards before their comparison baseline exists.
    // Render them once more against the completed snapshot so unchanged
    // Start/Stop cards do not retain a stale yellow "changed" border.
    renderHardwareWorkflowSummaries();
    _loadedHardwareCfg = cloneHardwareJson(cfg);
    delete _loadedHardwareCfg._i2c_discovery;
    _loadedSettingsCfg = cloneHardwareJson(settingsCfg);
    _hwDirty = false;
    document.querySelector('.save-bar')?.classList.remove('is-dirty');
    document.getElementById('save-msg').textContent = 'Loaded — no unsaved changes';
    document.getElementById('btn-discard').disabled = true;
    document.getElementById('hw-profile-badge').textContent = cfg.profile_id || 'OpenTurbine';
    updateSaveButton();
    startI2cDiscoveryPoll();
    return true;
  } catch(e) {
    document.getElementById('save-msg').textContent = 'Load failed: ' + e;
    return false;
  }
}

let i2cDiscoveryTimer = null;
function startI2cDiscoveryPoll() {
  if (i2cDiscoveryTimer) return;
  i2cDiscoveryTimer = setInterval(async () => {
    try {
      const latest = await fetchHardwareJson('/api/i2c_discovery', 2);
      cfg._i2c_discovery = latest || {};
      renderI2cDiscovery();
    } catch (_) {}
  }, 5000);
}

function populate() {
  v('f-profile-id',  cfg.profile_id   || '');
  _checkProfileIdWarn();
  v('f-profile-desc',cfg.profile_desc || '');
  v('f-wifi-tx-power', cfg.wifi_tx_power_dbm ?? 8);
  const wifiTxLabel = document.getElementById('f-wifi-tx-power-val');
  if (wifiTxLabel) wifiTxLabel.textContent = (cfg.wifi_tx_power_dbm ?? 8) + ' dBm';
  v('f-wifi-password', '');
  const wifiPw = document.getElementById('f-wifi-password');
  if (wifiPw) wifiPw.placeholder = cfg.wifi_password === '__KEEP_PASSWORD__'
    ? '(saved password unchanged)' : '(open network)';
  updateFeaturesUI();
  cfg.i2c ||= {enabled:false,sda_pin:cfg.platform==='esp32s3'?8:26,scl_pin:cfg.platform==='esp32s3'?9:27,interrupt_pin:-1,frequency_hz:400000};
  const firstSavedSpi = (registryRoot().inputs || []).find(registryTemperatureIsSpi);
  cfg.spi ||= {
    enabled:!!firstSavedSpi,
    sck_pin:Number(firstSavedSpi?.spi_clk ?? -1),
    miso_pin:Number(firstSavedSpi?.spi_miso ?? -1),
    mosi_pin:Number(firstSavedSpi?.spi_mosi ?? -1)
  };
  const busesPanel = document.getElementById('hardware-buses-panel');
  const profilePanel = document.getElementById('hardware-profile-section');
  if (busesPanel && profilePanel && profilePanel.nextElementSibling !== busesPanel)
    profilePanel.insertAdjacentElement('afterend', busesPanel);
  chk('en-i2c', !!cfg.i2c.enabled);
  const i2cSda = document.getElementById('f-i2c-sda'), i2cScl = document.getElementById('f-i2c-scl');
  if (i2cSda) i2cSda.innerHTML = buildPinOptions(cfg.i2c.sda_pin ?? -1, 'i2c-sda');
  if (i2cScl) i2cScl.innerHTML = buildPinOptions(cfg.i2c.scl_pin ?? -1, 'i2c-scl');
  v('f-i2c-frequency', cfg.i2c.frequency_hz ?? 400000);
  chk('en-spi', !!cfg.spi.enabled);
  const spiSck = document.getElementById('f-spi-sck');
  const spiMiso = document.getElementById('f-spi-miso');
  const spiMosi = document.getElementById('f-spi-mosi');
  if (spiSck) spiSck.innerHTML = buildPinOptions(cfg.spi.sck_pin ?? -1, 'spi-clk');
  if (spiMiso) spiMiso.innerHTML = buildPinOptions(cfg.spi.miso_pin ?? -1, 'spi-miso');
  if (spiMosi) spiMosi.innerHTML = buildPinOptions(cfg.spi.mosi_pin ?? -1, 'spi-mosi');
  syncSharedSpiChannels();
  renderRegistryInventory();
  const i2cOwned = pcbOwnsBus('i2c');
  const spiOwned = pcbOwnsBus('spi');
  updateGroupEnabled('grp-i2c', !!cfg.i2c.enabled && !i2cOwned);
  updateGroupEnabled('grp-spi', !!cfg.spi.enabled && !spiOwned);
  const i2cToggle = document.getElementById('en-i2c');
  const spiToggle = document.getElementById('en-spi');
  if (i2cToggle) {
    i2cToggle.disabled = i2cOwned;
    i2cToggle.title = i2cOwned ? 'This I2C bus is defined by the flashed PCB profile and cannot be removed.' : '';
  }
  if (spiToggle) {
    spiToggle.disabled = spiOwned;
    spiToggle.title = spiOwned ? 'This SPI bus is defined by the flashed PCB profile and cannot be removed.' : '';
  }
  renderI2cDiscovery();
  if (busesPanel) {
    const desc = busesPanel.querySelector(':scope > .hw-desc');
    if (desc && pcbProfileActive())
      desc.textContent = 'Buses defined by the flashed PCB profile are shown read-only and cannot be removed. You may add a missing shared bus using only GPIOs that the PCB leaves free.';
  }
  for (const id of ['hardware-cluster-source-panel','hardware-mavlink-source-panel']) {
    const panel = document.getElementById(id);
    if (panel) panel.style.display = pcbProfileActive() ? 'none' : '';
  }
  const controlsNote = document.getElementById('required-controls-note');
  if (controlsNote && pcbProfileActive())
    controlsNote.innerHTML = '<strong>Required controls:</strong> add the Stop switch (and Start switch when used) below, then choose the labelled PCB connection. GPIO routing and available electrical modes come from the flashed PCB profile; choose the active state that matches the connected switch.';

  const c = cfg.controls || {};
  v('f-stop-pol', c.stop_active_h ? '1' : '0');
  chk('f-stop-pullup', c.stop_pullup !== false);
  chk('f-stop-pulldown', !!c.stop_pulldown);
  v('f-start-pol', c.start_active_h ? '1' : '0');
  chk('f-start-pullup', c.start_pullup !== false);
  chk('f-start-pulldown', !!c.start_pulldown);

  const cl = cfg.cluster_serial || {};
  chk('en-cluster', cl.enabled || false);
  updateGroupEnabled('grp-cluster', cl.enabled || false);
  const clBaud = document.getElementById('f-cl-baud');
  if (clBaud) {
    const bv = (cl.baud || 115200).toString();
    for (let o of clBaud.options) if (o.value === bv) { o.selected = true; break; }
  }
  v('f-cl-interval', cl.interval_ms ?? '');

  const mav = cfg.mavlink || {};
  chk('en-mavlink', mav.enabled || false);
  updateGroupEnabled('grp-mavlink', mav.enabled || false);
  const mavBaud = document.getElementById('f-mav-baud');
  if (mavBaud) {
    const mb = (mav.baud || 115200).toString();
    for (let o of mavBaud.options) if (o.value === mb) { o.selected = true; break; }
  }
  v('f-mav-interval', mav.interval_ms ?? 200);

  updateSafetyPrerequisites(false);
  updateHardwarePrerequisites(false);
  applyEnableDependencyTooltips();
  refreshAllPins();
  // Re-evaluate changed borders after pin selects have been rebuilt
  if (Object.keys(_fieldSnap).length) _refreshChangedBorders();
}

function setI2cField(key, value) {
  if (pcbOwnsBus('i2c')) return;
  cfg.i2c ||= {};
  cfg.i2c[key] = value;
  updateGroupEnabled('grp-i2c', !!cfg.i2c.enabled);
  dirty(); updateSaveButton(); refreshAllPins();
}
function syncSharedSpiChannels() {
  const spi = cfg.spi || {};
  (registryRoot().inputs || []).forEach(channel => {
    if (!registryTemperatureIsSpi(channel) || channel.physical_port) return;
    channel.spi_clk = Number(spi.sck_pin ?? -1);
    channel.spi_miso = Number(spi.miso_pin ?? -1);
    channel.spi_mosi = Number(channel.temp_interface) === 3 ? Number(spi.mosi_pin ?? -1) : -1;
    const purpose = registryDerivedPurpose('input', channel);
    const legacyKey = purpose === 'tot' ? 'tot' : purpose === 'tit' ? 'tit' :
      purpose === 'oil_temperature' ? 'oil_temp' : '';
    if (legacyKey && cfg.sensors?.[legacyKey]) {
      cfg.sensors[legacyKey].clk = channel.spi_clk;
      cfg.sensors[legacyKey].miso = channel.spi_miso;
      cfg.sensors[legacyKey].mosi = channel.spi_mosi;
      cfg.sensors[legacyKey].cs = Number(channel.spi_cs ?? -1);
    }
  });
}
function setSpiField(key, value) {
  if (pcbOwnsBus('spi')) return;
  cfg.spi ||= {enabled:false,sck_pin:-1,miso_pin:-1,mosi_pin:-1};
  cfg.spi[key] = value;
  syncSharedSpiChannels();
  updateGroupEnabled('grp-spi', !!cfg.spi.enabled);
  dirty(); updateSaveButton(); refreshAllPins(); renderRegistryInventory();
}
function pcbProfileActive() { return pcbProfile?.state === 'valid'; }
function pcbOwnsBus(kind) {
  return pcbProfileActive() && pcbProfile?.bus_ownership?.[kind] === true;
}
const PCB_ADAPTER_DRIVER = {
  digital_input:0, analog_input:1, pcnt_input:2, rc_pwm_input:3, pwm_duty_input:7,
  spi_thermocouple:1, onewire_temperature:1, i2c_digital_input:8,
  i2c_adc_input:9, i2c_adc_digital_input:9, i2c_load_cell:10, digital_output:4, relay_output:4,
  pwm_output:5, servo_output:6, i2c_digital_output:11
};
function pcbModeCompatible(direction, purpose, role, mode) {
  const adapter = String(mode?.adapter || '');
  const driver = PCB_ADAPTER_DRIVER[adapter];
  if (!Number.isInteger(driver)) return false;
  if (direction === 'input' && driver > 10) return false;
  if (direction === 'output' && ![4,5,6,11].includes(driver)) return false;
  if (!registryAllowedDrivers(direction, role, purpose).includes(driver)) return false;
  if (direction === 'input') {
    const analog = ['analog_input','i2c_adc_input'];
    const digital = ['digital_input','i2c_digital_input','i2c_adc_digital_input'];
    const switchPurposes = ['digital_switch','inhibit_start','estop','fault','low_oil_switch',
      'oil_zero_switch','sequence_gate','ab_arm','ab_fire','limp_mode','start_switch','stop_switch'];
    if (['throttle','idle','ab_command'].includes(purpose) &&
        ![...analog,'rc_pwm_input','pwm_duty_input'].includes(adapter)) return false;
    if (switchPurposes.includes(purpose) && !digital.includes(adapter)) return false;
    if (['n1_speed','n2_speed','shaft_speed','fuel_flow','oil_flow','scavenge_flow'].includes(purpose) &&
        ![...analog,'pcnt_input'].includes(adapter)) return false;
    if (['oil_pressure','fuel_pressure','p1_pressure','p2_pressure','coolant_pressure',
         'battery_voltage'].includes(purpose) && !analog.includes(adapter)) return false;
    if (['torque','thrust'].includes(purpose) &&
        ![...analog,'i2c_load_cell'].includes(adapter)) return false;
    if (['flame','ab_flame'].includes(purpose) &&
        ![...analog,...digital].includes(adapter)) return false;
    if (['tot','tit','oil_temperature','coolant_temp','intake_temperature'].includes(purpose) &&
        ![...analog,'spi_thermocouple','onewire_temperature'].includes(adapter)) return false;
  }
  if (adapter === 'spi_thermocouple' && !['tot','tit','oil_temperature'].includes(purpose)) return false;
  if (adapter === 'onewire_temperature' && !['oil_temperature','coolant_temp','intake_temperature'].includes(purpose)) return false;
  if (adapter === 'i2c_load_cell' && !['torque','thrust'].includes(purpose)) return false;
  return true;
}
function pcbCompatibleChoices(direction, purpose, role, currentPort = '') {
  const claimed = new Set([...(registryRoot().inputs||[]),...(registryRoot().outputs||[])]
    .map(c=>String(c.physical_port||'')).filter(id=>id && id!==currentPort));
  const choices = [];
  for (const port of (pcbProfile.ports || [])) {
    if (claimed.has(String(port.id))) continue;
    for (const mode of (port.modes || []))
      if (pcbModeCompatible(direction,purpose,role,mode)) choices.push({port,mode});
  }
  const score = choice => {
    const adapter = String(choice.mode?.adapter || '');
    const portId = String(choice.port?.id || '');
    if (['start_switch','stop_switch','digital_switch','inhibit_start','estop','fault',
         'low_oil_switch','oil_zero_switch','sequence_gate','ab_arm','ab_fire','limp_mode'].includes(purpose)) {
      if (portId.startsWith('switch_input_')) return 0;
      if (adapter === 'digital_input') return 10;
      if (adapter === 'i2c_adc_digital_input') return 20;
    }
    if (['n1_speed','n2_speed','shaft_speed'].includes(purpose)) {
      if (portId.startsWith('high_speed_input_') && adapter === 'pcnt_input') return 0;
      if (adapter === 'pcnt_input') return 5;
      return 20;
    }
    if (purpose === 'fuel_flow') return adapter === 'pcnt_input' ? 0 : 10;
    if (['throttle','idle','ab_command'].includes(purpose)) {
      if (adapter === 'rc_pwm_input') return 0;
      if (adapter === 'pwm_duty_input') return 2;
      if (adapter.includes('analog') || adapter === 'i2c_adc_input') return 5;
      return 10;
    }
    if (['tot','tit','oil_temperature','coolant_temp','intake_temperature'].includes(purpose))
      return adapter === 'spi_thermocouple' || adapter === 'onewire_temperature' ? 0 : 10;
    return 0;
  };
  return choices.sort((a,b) => score(a)-score(b) ||
    String(a.port.label).localeCompare(String(b.port.label)) ||
    String(a.mode.id).localeCompare(String(b.mode.id)));
}
function pcbModeLabel(mode) {
  const labels = {
    spi_thermocouple:'Thermocouple', onewire_temperature:'OneWire temperature',
    i2c_adc_input:'Analog voltage', i2c_adc_digital_input:'Voltage-threshold switch',
    analog_input:'Analog voltage', digital_input:'Digital on/off',
    i2c_digital_input:'Digital on/off', pcnt_input:'Pulse / frequency',
    rc_pwm_input:'RC servo pulse', pwm_duty_input:'PWM duty input',
    servo_output:'Servo / ESC pulse', pwm_output:'PWM output',
    digital_output:'Digital on/off output', relay_output:'On/off power output',
    i2c_digital_output:'Low-current on/off output', i2c_load_cell:'Load cell'
  };
  return labels[String(mode?.adapter || '')] || String(mode?.id || '').replaceAll('_',' ');
}
function pcbChoiceLabel(choice) {
  const suffix = choice.port.connector ? ` · ${choice.port.connector}` : '';
  const mode = choice.mode ? ` — ${pcbModeLabel(choice.mode)}` : '';
  return `${choice.port.label}${suffix}${mode}`;
}
function renderI2cDiscovery() {
  const box = document.getElementById('i2c-discovery');
  if (!box) return;
  const scan = cfg._i2c_discovery || {};
  const assignedChannels = [...(registryRoot().inputs||[]),...(registryRoot().outputs||[])]
    .filter(c => Number(c.driver) >= 8 && Number(c.i2c_address) > 0);
  const devices = Array.isArray(scan.devices) ? scan.devices.map(d=>({...d})) : [];
  assignedChannels.forEach(c => {
    const type = Number(c.driver) === 8 || Number(c.driver) === 11 ? 'TCA9554'
      : Number(c.driver) === 9 ? 'TLA2528' : 'NAU7802';
    if (!devices.some(d => Number(d.address) === Number(c.i2c_address) && d.type === type))
      devices.push({address:Number(c.i2c_address), type, present:false, saved_only:true});
  });
  if (!cfg.i2c?.enabled) {
    box.innerHTML = '<div class="registry-empty"><div>I2C bus disabled.</div></div>';
    return;
  }
  if (!devices.length) {
    box.innerHTML = '<div class="registry-empty"><div>No recognized I2C devices detected. Wiring assignments are preserved if a configured device is temporarily disconnected.</div></div>';
    return;
  }
  box.innerHTML = devices.map(d => {
    const address = `0x${Number(d.address||0).toString(16).toUpperCase().padStart(2,'0')}`;
    const assigned = assignedChannels.filter(c => Number(c.i2c_address) === Number(d.address)).length;
    const help = d.type === 'TCA9554' ? '8 binary inputs or outputs'
      : d.type === 'TLA2528' ? '8 analog input channels'
      : d.type === 'NAU7802' ? '2-channel bridge/load-cell ADC for thrust or torque' : 'recognized response';
    const remove = !d.present && assigned
      ? `<button type="button" class="danger" onclick="removeDisconnectedI2cDevice(${Number(d.address)},'${escapeHtmlText(d.type)}')">Remove device and assignments</button>` : '';
    const state = d.present ? 'Connected'
      : d.rechecking || d.state === 'rechecking' ? 'Unavailable — rechecking'
      : 'Faulted';
    const stateClass = d.present ? 'ok' : (state === 'Faulted' ? 'error' : 'warning');
    return `<div class="hw-item-card" style="margin-top:.55rem"><div class="registry-card-summary"><div><strong>${escapeHtmlText(d.type)} at ${address}</strong><div class="hw-desc">${help} · ${assigned} assigned channel${assigned===1?'':'s'}</div></div><div style="display:flex;gap:.45rem;align-items:center;flex-wrap:wrap"><span class="registry-status registry-status-${stateClass}">${state}</span>${remove}</div></div></div>`;
  }).join('');
}

function v(id, val)   { const e=document.getElementById(id); if(e) e.value=val; }
function chk(id, val) { const e=document.getElementById(id); if(e) e.checked=val; }

function updateGroupEnabled(grpId, enabled) {
  const el = document.getElementById(grpId);
  if (!el) return;
  el.querySelectorAll('input,select').forEach(i => i.disabled = !enabled);
}
function setOptionalGroupVisible(grpId, visible) {
  const el = document.getElementById(grpId);
  if (!el) return;
  el.style.display = visible ? '' : 'none';
  updateGroupEnabled(grpId, visible);
}

async function checkPinWarning(gpio) {
  const info = GPIO_DB[gpio];
  if (!info || !info.s) return true;
  return await OTDialog.confirm(
    `GPIO${gpio} is a strapping pin.\n\n` +
    `Strapping pins determine ESP32 boot mode at power-on. Using them may cause unexpected resets.\n\n` +
    `Suggested safe pins: GPIO 16, 17, 18, 19, 21, 22, 23, 25, 26, 27`,
    {title:'Strapping-pin warning', confirmLabel:'Use this GPIO anyway', danger:true});
}
function isPinField(key) {
  return key === 'pin' || key === 'fuel_pin' || /(^|_)pin$/.test(key);
}
async function acceptPinChange(gpio) {
  return gpio === undefined || gpio === null || gpio < 0 || await checkPinWarning(gpio);
}

function set(key, val) { cfg[key] = val; dirty(); }
function setProfileId(val) { cfg.profile_id = val; _checkProfileIdWarn(); dirty(); }
function _checkProfileIdWarn() {
  // Warn only (never block): the profile ID doubles as the softAP SSID (max 32 bytes).
  const warn = document.getElementById('profile-id-warn');
  if (!warn) return;
  const id = (cfg.profile_id || 'OpenTurbine').trim() || 'OpenTurbine';
  warn.style.display = new TextEncoder().encode(id).length > 32 ? '' : 'none';
}
function setWifiTxPower(raw) {
  const val = Math.max(2, Math.min(20, Number(raw) || 8));
  set('wifi_tx_power_dbm', val);
  const label = document.getElementById('f-wifi-tx-power-val');
  if (label) label.textContent = val + ' dBm';
}
function toggleWifiPassword() {
  const inp = document.getElementById('f-wifi-password');
  const btn = document.getElementById('btn-wifi-pw-toggle');
  if (!inp || !btn) return;
  const showing = inp.type === 'text';
  inp.type = showing ? 'password' : 'text';
  const icon = document.getElementById('btn-wifi-pw-icon');
  if (showing) {
    // now hidden — show plain eye
    if (icon) icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  } else {
    // now showing — eye with slash
    if (icon) icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
  }
  btn.title = showing ? 'Show password' : 'Hide password';
}
async function setNested(group, key, val) {
  if (isPinField(key) && !await acceptPinChange(val)) { refreshAllPins(); return; }
  if (!cfg[group]) cfg[group] = {};
  cfg[group][key] = val;
  if (isPinField(key)) refreshAllPins();
  dirty();
}
async function setProfileSerialEnabled(group, enabled) {
  await setNested(group, 'enabled', !!enabled);
  const fixed = pcbProfile?.fixed_functions || {};
  const shared = pcbProfileActive() && fixed.cluster_serial?.connection &&
    fixed.cluster_serial.connection === fixed.mavlink?.connection;
  if (enabled && shared) {
    const other = group === 'cluster_serial' ? 'mavlink' : 'cluster_serial';
    await setNested(other, 'enabled', false);
  }
  renderHardwareWorkflowSummaries();
}
function setLabel(key, val) {
  if (!cfg.labels) cfg.labels = {};
  cfg.labels[key] = val;
  dirty();
}
async function setDiChannel(idx, key, val) {
  if (key === 'pin' && !await acceptPinChange(val)) { refreshAllPins(); return; }
  if (!cfg.di_channels) cfg.di_channels = [{},{},{},{}];
  while (cfg.di_channels.length < 4) cfg.di_channels.push({});
  cfg.di_channels[idx][key] = val;
  if (key === 'pin') refreshAllPins();
  dirty();
}
function isSpiSensor(sensor) {
  const item = cfg.sensors?.[sensor];
  if (!item?.enabled) return false;
  return sensor !== 'oil_temp' || (item.chip !== 'ntc' && item.chip !== 'ds18b20');
}
function adoptExistingSpiBus(sensor) {
  if (!isSpiSensor(sensor)) return;
  const target = cfg.sensors[sensor];
  for (const other of ['tot', 'tit', 'oil_temp']) {
    if (other === sensor || !isSpiSensor(other)) continue;
    const source = cfg.sensors[other];
    if (source.clk >= 0) target.clk = source.clk;
    if (source.miso >= 0) target.miso = source.miso;
    if (source.mosi >= 0) target.mosi = source.mosi;
    return;
  }
}
async function setSensor(sensor, key, val) {
  if (!cfg.sensors) cfg.sensors = {};
  if (!cfg.sensors[sensor]) cfg.sensors[sensor] = {};
  if (['pin','clk','cs','miso','mosi'].includes(key)) {
    if (!await checkPinWarning(val)) { refreshAllPins(); return; }
  }
  cfg.sensors[sensor][key] = val;
  if (['pin','clk','cs','miso','mosi'].includes(key) ||
      (key === 'rc_pwm' && (sensor === 'throttle_input' || sensor === 'idle_input'))) {
    refreshAllPins();
  }
  dirty();
}

const SENSOR_RULE_ENUM = {
  oil_temp:0, tot:1, n1_rpm:2, oil_press:3, tit:4, batt_voltage:5, n2_rpm:6,
  fuel_press:11, fuel_flow:12, p1:13, p2:14, torque:15, flame:16,
  throttle_input:17, idle_input:18
};
const ACT_RULE_ENUM = {
  cool_fan:0, bleed_valve:1, fuel_pump2:2, oil_scavenge_pump:3,
  throttle:4, starter:5, starter_en:6, oil_pump:7, fuel_sol:8,
  igniter:9, igniter2:10, ab_sol:11, ab_pump:12, airstarter_sol:15,
  glow_plug:16, prop_pitch:17
};
const SEQ_ACTION_KEYS = [
  'startup_enter_actions','startup_exit_actions','shutdown_enter_actions','shutdown_exit_actions',
  'ab_enter_actions','ab_exit_actions','ab_shut_enter_actions','ab_shut_exit_actions'
];
const SENSOR_DEPENDENCIES = {
  n1_rpm: { name:'N1 RPM sensor', safety:['overspeed','surge'], logs:['n1'], rules:[2],
            functions:['N1 overspeed protection','Surge protection','automatic idle speed feedback','windmilling oil protection source','automatic relight windmilling check','flameout detection','startup RPM checks','N1 session logging','rules using N1 RPM'] },
  n2_rpm: { name:'N2 RPM sensor', safety:['n2_overspeed'], logs:['n2'], rules:[6],
            functions:['N2 hard overspeed protection','Automatic N2 speed control','automatic idle N2 feedback','windmilling oil protection source','shaft power calculation with torque sensor','N2 session logging','rules using N2 RPM'] },
  tot: { name:'TOT sensor', safety:['overtemp','hot_start'], logs:['tot'], rules:[1],
         functions:['Primary EGT safety when selected','Hot-start guard','TOT session logging','rules using TOT'] },
  tit: { name:'TIT sensor', safety:['overtemp','hot_start'], logs:['tit'], rules:[4],
         functions:['Primary EGT safety when selected','Hot-start guard','TIT session logging','rules using TIT'] },
  oil_press: { name:'Oil pressure sensor', safety:['low_oil','oil_zero'], controllers:['oil_loop'], logs:['oil'], rules:[3],
               functions:['Low oil pressure guard','Zero oil pressure guard','Oil pressure loop','Oil pressure logging','rules using oil pressure'] },
  oil_temp: { name:'Oil temperature sensor', safety:['oil_temp_high'], logs:['oil_temp'], rules:[0],
              functions:['Oil temperature high guard','Oil temperature logging','rules using oil temperature'] },
  fuel_press: { name:'Fuel pressure sensor', safety:['fuel_press_low'], logs:['fuel_press'], rules:[11],
                functions:['Fuel pressure low guard','Fuel pressure logging','rules using fuel pressure'] },
  fuel_flow: { name:'Fuel flow sensor', logs:['fuel_flow'], rules:[12], functions:['Fuel flow logging','rules using fuel flow'] },
  batt_voltage: { name:'Battery voltage sensor', safety:['batt_low'], logs:['batt'], rules:[5],
                  functions:['Battery low guard','Battery voltage logging','rules using battery voltage'] },
  p1: { name:'P1 sensor', logs:['p1'], rules:[13], functions:['P1 logging','rules using P1'] },
  p2: { name:'P2 sensor', logs:['p2'], rules:[14], functions:['P2 logging','rules using P2'] },
  torque: { name:'Torque sensor', rules:[15], functions:['shaft power calculation with N2 RPM sensor','rules using torque'] },
  flame: { name:'Flame sensor', rules:[16], functions:['FlameConfirm / flameout source if selected','rules using flame'] },
  throttle_input: { name:'Throttle input', rules:[17], functions:['rules using throttle input'] },
  idle_input: { name:'Idle input', rules:[18], functions:['idle input mapping','rules using idle input'] },
};
const ACT_DEPENDENCIES = {
  oil_scavenge_pump: { name:'Oil scavenge pump', rules:[3], logs:[], blocks:['OilScavengeOn','OilScavengeOff'],
                       functions:['Scavenge sequence blocks','sequencer side-actions using scavenge pump','rules driving scavenge pump'] },
  oil_pump: { name:'Oil pump', controllers:['oil_loop'], logs:['oil_pct'], rules:[7], blocks:['OilPumpOn','OilPumpOff','OilPrime'],
              functions:['Automatic oil-pressure control','windmilling oil protection output','Oil pump logging','oil-pump sequence actions','rules driving oil pump'] },
  starter: { name:'Starter', rules:[5], blocks:['StarterSpin','StarterOff'], functions:['Starter sequence blocks','starter side-actions','rules driving starter'] },
  throttle: { name:'Main fuel pump / metering ESC', controllers:['dynamic_idle','governor'], logs:['throttle'], rules:[4],
              blocks:['FuelPumpIdle','ModifiedIdle','Spool','ThrottleSet'], functions:['Fuel sequence blocks','automatic idle/N2 speed-control output','fuel/throttle logging','rules driving throttle'] },
  fuel_pump2: { name:'Secondary / auxiliary fuel pump', logs:['fp2'], rules:[2], blocks:['FuelPumpRamp','FuelPump2Set','FuelPump2On','FuelPump2Off'],
                functions:['Secondary / auxiliary fuel pump sequence blocks','secondary / auxiliary fuel logging','rules driving secondary / auxiliary fuel'] },
  glow_plug: { name:'Glow plug', logs:['glow'], rules:[16], blocks:['GlowPreheat'], functions:['GlowPreheat block','glow logging','rules driving glow plug'] },
  prop_pitch: { name:'Prop pitch', controllers:['governor'], logs:['prop'], rules:[17], functions:['Governor prop-pitch output','prop pitch logging','rules driving prop pitch'] },
  cool_fan: { name:'Cooling fan', rules:[0], blocks:['CoolFanOn','CoolFanOff'], functions:['Cooling fan sequence blocks','rules driving cooling fan'] },
  bleed_valve: { name:'Bleed valve', rules:[1], blocks:['BleedOpen','BleedClose'], functions:['Bleed valve sequence blocks','rules driving bleed valve'] },
  fuel_sol: { name:'Main fuel shutoff', rules:[8], blocks:['FuelOpen','FuelSolClose','FuelPulse'], functions:['Main fuel shutoff sequence blocks','rules driving the main fuel shutoff'] },
  igniter: { name:'Igniter 1', rules:[9], blocks:['IgniterOn','IgniterOff','PreIgnSpark','PreHeat'], functions:['Ignition sequence blocks','rules driving igniter'] },
  igniter2: { name:'secondary igniter', rules:[10], blocks:['ABIgnOn','ABIgnOff'], functions:['secondary ignition blocks','rules driving secondary igniter'] },
  ab_sol: { name:'Afterburner fuel valve', rules:[11], blocks:['ABSolOpen','ABSolClose'], functions:['afterburner fuel-valve sequence blocks','rules driving the afterburner fuel valve'] },
  ab_pump: { name:'Afterburner fuel pump', logs:['ab'], rules:[12], blocks:['ABPumpOn','ABPumpOff'], functions:['afterburner fuel-pump sequence blocks','afterburner logging','rules driving the afterburner fuel pump'] },
  airstarter_sol: { name:'Air starter valve', rules:[15], blocks:['AirstarterOn','AirstarterOff'], functions:['Air starter valve sequence blocks','rules driving the air starter valve'] },
  starter_en: { name:'Starter enable output', blocks:['StarterEnOn','StarterEnOff'], functions:['Starter enable sequencing managed automatically with starter demand'] },
  status_led: { name:'Status LED', functions:['mode blink indication','rapid fault flash','bench-test visual status'] },
};

const SPECIAL_DEPENDENCIES = {
  oil_pump_current: { name:'Oil pump current sensor', functions:['oil-pump current live data','oil-pump current calibration','oil-pump current session logging'] },
  glow_current: { name:'Glow plug current sensor', functions:['wait-until-hot glow preheat','glow current live data','glow current calibration','glow current session logging'] },
  ab_flame: { name:'Afterburner flame sensor', functions:['AB flame-confirm mode','AB flame live data','rules and diagnostics using AB flame state'] },
  buzzer: { name:'Buzzer', functions:['audible mode transitions','audible fault indication','bench-test tone output'] },
  cluster: { name:'OT Cluster serial', functions:['external display telemetry','cluster warning thresholds','optional cluster command RX'] },
  mavlink: { name:'MAVLink serial output', functions:['Mission Planner / QGroundControl telemetry','MAVLink HEARTBEAT','MAVLink NAMED_VALUE_FLOAT data'] }
};

const HW_ENABLE_DEP_KEYS = {
  'en-n1rpm': ['sensor', 'n1_rpm'],
  'en-n2rpm': ['sensor', 'n2_rpm'],
  'en-tot': ['sensor', 'tot'],
  'en-tit': ['sensor', 'tit'],
  'en-oilpress': ['sensor', 'oil_press'],
  'en-oiltemp': ['sensor', 'oil_temp'],
  'en-fuelpress': ['sensor', 'fuel_press'],
  'en-fuelflow': ['sensor', 'fuel_flow'],
  'en-battvolt': ['sensor', 'batt_voltage'],
  'en-p1': ['sensor', 'p1'],
  'en-p2': ['sensor', 'p2'],
  'en-torque': ['sensor', 'torque'],
  'en-flame': ['sensor', 'flame'],
  'en-thinput': ['sensor', 'throttle_input'],
  'en-idiinput': ['sensor', 'idle_input'],
  'en-throttle': ['actuator', 'throttle'],
  'en-starter': ['actuator', 'starter'],
  'en-starteren': ['actuator', 'starter_en'],
  'en-airstarter': ['actuator', 'airstarter_sol'],
  'en-fuelsol': ['actuator', 'fuel_sol'],
  'en-oilpump': ['actuator', 'oil_pump'],
  'en-oilscav': ['actuator', 'oil_scavenge_pump'],
  'en-igniter': ['actuator', 'igniter'],
  'en-igniter2': ['actuator', 'igniter2'],
  'en-absol': ['actuator', 'ab_sol'],
  'en-abpump': ['actuator', 'ab_pump'],
  'en-coolfan': ['actuator', 'cool_fan'],
  'en-fuelpump2': ['actuator', 'fuel_pump2'],
  'en-bleedvalve': ['actuator', 'bleed_valve'],
  'en-proppitch': ['actuator', 'prop_pitch'],
  'en-glowplug': ['actuator', 'glow_plug'],
  'en-statusled': ['actuator', 'status_led'],
  'en-oilpumpcurrent': ['special', 'oil_pump_current'],
  'en-glowcurrent': ['special', 'glow_current'],
  'en-buzzer': ['special', 'buzzer'],
  'en-cluster': ['special', 'cluster'],
  'en-mavlink': ['special', 'mavlink']
};

function dependencyFor(kind, key) {
  if (kind === 'sensor') return SENSOR_DEPENDENCIES[key];
  if (kind === 'actuator') return ACT_DEPENDENCIES[key];
  return SPECIAL_DEPENDENCIES[key];
}

function unlockTooltip(kind, key, enabled) {
  const dep = dependencyFor(kind, key);
  if (!dep) return '';
  const list = [...new Set(dep.functions || [])];
  if (!list.length) return enabled ? dep.name + ' is enabled.' : 'Enable ' + dep.name + '.';
  return (enabled ? dep.name + ' is enabled. Provides: ' : 'Enable ' + dep.name + ' to unlock: ') + list.join(', ') + '.';
}

function applyEnableDependencyTooltips() {
  for (const [id, [kind, key]] of Object.entries(HW_ENABLE_DEP_KEYS)) {
    const input = document.getElementById(id);
    if (!input) continue;
    const text = unlockTooltip(kind, key, input.checked);
    input.title = text;
    const label = input.closest('label') || input.parentElement;
    if (label) label.title = text;
    const card = input.closest('.hw-item-card');
    if (card) card.title = text;
  }
}

document.addEventListener('change', ev => {
  if (ev.target?.id && HW_ENABLE_DEP_KEYS[ev.target.id]) {
    setTimeout(applyEnableDependencyTooltips, 0);
  }
});

async function dependencyWarning(kind, key) {
  const dep = kind === 'sensor' ? SENSOR_DEPENDENCIES[key] : ACT_DEPENDENCIES[key];
  if (!dep) return true;
  const impacted = new Set(dep.functions || []);
  const s = settingsCfg || {};
  (dep.safety || []).forEach(k => { if (cfg.safety?.[k]) impacted.add('Safety: ' + k.replaceAll('_',' ')); });
  (dep.controllers || []).forEach(k => { if (cfg.controllers?.[k]) impacted.add('Controller: ' + k.replaceAll('_',' ')); });
  (dep.logs || []).forEach(k => { if (s.session_log?.[k]) impacted.add('Session log: ' + k.replaceAll('_',' ')); });
  if (dep.rules?.length && Array.isArray(s.rules) && s.rules.some(r => dep.rules.includes(Number(kind === 'sensor' ? r.sensor : r.actuator)))) {
    impacted.add('Control rules using this ' + kind);
  }
  if (kind === 'actuator') {
    const actVal = ACT_RULE_ENUM[key];
    if (SEQ_ACTION_KEYS.some(k => (cfg[k] || []).some(slot => (slot || []).some(a => Number(a.act) === actVal)))) {
      impacted.add('Sequencer simultaneous actions using this actuator');
    }
    if ((dep.blocks || []).some(b => ['startup_seq','shutdown_seq','ab_seq','ab_shut_seq'].some(k => (cfg[k] || []).includes(b)))) {
      impacted.add('Sequencer blocks for this actuator');
    }
  }
  if (!impacted.size) return true;
  return await OTDialog.confirm('Removing ' + dep.name + ' will also remove/disable:\n\n- ' +
    [...impacted].join('\n- '), {title:'Remove hardware and dependencies', confirmLabel:'Remove and disable', danger:true});
}

function cleanupRemovedSensor(sensor) {
  const dep = SENSOR_DEPENDENCIES[sensor];
  if (!dep) return;
  if (cfg.safety) (dep.safety || []).forEach(k => cfg.safety[k] = false);
  if (cfg.controllers) (dep.controllers || []).forEach(k => cfg.controllers[k] = false);
  updateSafetyPrerequisites(false);
  updateHardwarePrerequisites(false);
}

function cleanupRemovedActuator(act) {
  const dep = ACT_DEPENDENCIES[act];
  if (!dep) return;
  if (cfg.controllers) (dep.controllers || []).forEach(k => cfg.controllers[k] = false);
  const actVal = ACT_RULE_ENUM[act];
  if (actVal !== undefined) {
    SEQ_ACTION_KEYS.forEach(k => {
      if (!Array.isArray(cfg[k])) return;
      cfg[k] = cfg[k].map(slot => Array.isArray(slot) ? slot.filter(a => Number(a.act) !== actVal) : []);
    });
  }
  (dep.blocks || []).forEach(block => {
    ['startup_seq','shutdown_seq','ab_seq','ab_shut_seq'].forEach((seqKey, idx) => {
      if (!Array.isArray(cfg[seqKey])) return;
      const delayKey = ['startup_delay_ms','shutdown_delay_ms','ab_delay_ms','ab_shut_delay_ms'][idx];
      for (let i = cfg[seqKey].length - 1; i >= 0; i--) {
        if (cfg[seqKey][i] !== block) continue;
        cfg[seqKey].splice(i, 1);
        if (Array.isArray(cfg[delayKey])) cfg[delayKey].splice(i, 1);
        SEQ_ACTION_KEYS.slice(idx * 2, idx * 2 + 2).forEach(k => { if (Array.isArray(cfg[k])) cfg[k].splice(i, 1); });
      }
    });
  });
  updateHardwarePrerequisites(false);
}

async function setSensorEnabled(sensor, grpId, val) {
  if (!val && cfg.sensors?.[sensor]?.enabled && !await dependencyWarning('sensor', sensor)) {
    chk('en-' + grpId, true);
    return;
  }
  setSensor(sensor, 'enabled', val);
  if (!val) cleanupRemovedSensor(sensor);
  if (val && ['tot','tit','oil_temp'].includes(sensor)) {
    adoptExistingSpiBus(sensor);
    refreshAllPins();
  }
  updateGroupEnabled('grp-' + grpId, val);
  updateSafetyPrerequisites(true);
  updateHardwarePrerequisites(true);
  if (sensor === 'n1_rpm') {
    const starterType = cfg.actuators?.starter?.type ?? 0;
    updateStrTypeUI(starterType);
  }
  applyEnableDependencyTooltips();
}
async function setAct(act, key, val) {
  if (!cfg.actuators) cfg.actuators = {};
  if (!cfg.actuators[act]) cfg.actuators[act] = {};
  if (isPinField(key)) {
    if (!await checkPinWarning(val)) { refreshAllPins(); return; }
  }
  cfg.actuators[act][key] = val;
  if (isPinField(key)) refreshAllPins();
  dirty();
}
function setStatusLedType(val) {
  if (!cfg.actuators) cfg.actuators = {};
  if (!cfg.actuators.status_led) cfg.actuators.status_led = {};
  cfg.actuators.status_led.type = val;
  cfg.actuators.status_led.enabled = true;
  if (cfg.platform === 'esp32s3' && val === 1 &&
      (cfg.actuators.status_led.pin === undefined || cfg.actuators.status_led.pin === null ||
       cfg.actuators.status_led.pin < 0 || cfg.actuators.status_led.pin === 38)) {
    cfg.actuators.status_led.pin = 48;
  }
  if (val !== 1) cfg.actuators.status_led.mode = 0;
  dirty();
  updateStatusLedTypeUI();
  refreshAllPins();
}

function setStatusLedEnabled(val) {
  if (!cfg.actuators) cfg.actuators = {};
  if (!cfg.actuators.status_led) cfg.actuators.status_led = {};
  cfg.actuators.status_led.enabled = !!val;
  if (!val) {
    cfg.actuators.status_led.pin = -1;
  } else if ((cfg.actuators.status_led.pin ?? -1) < 0) {
    cfg.actuators.status_led.pin = cfg.platform === 'esp32s3' ? 48 : 2;
  }
  dirty();
  refreshAllPins();
  updateSaveButton();
}

function setStatusLedMode(val) {
  if (!cfg.actuators) cfg.actuators = {};
  if (!cfg.actuators.status_led) cfg.actuators.status_led = {};
  const colorMode = val === 1;
  if (colorMode) {
    cfg.actuators.status_led.enabled = true;
    cfg.actuators.status_led.type = 1;
    if (cfg.platform === 'esp32s3' &&
        (cfg.actuators.status_led.pin === undefined || cfg.actuators.status_led.pin === null ||
         cfg.actuators.status_led.pin < 0 || cfg.actuators.status_led.pin === 38)) {
      cfg.actuators.status_led.pin = 48;
    }
  }
  cfg.actuators.status_led.mode = colorMode ? 1 : 0;
  dirty();
  updateStatusLedTypeUI();
  refreshAllPins();
}

function setStatusLedColor(key, value) {
  if (!cfg.actuators) cfg.actuators = {};
  if (!cfg.actuators.status_led) cfg.actuators.status_led = {};
  cfg.actuators.status_led[key] = hexToColor(value, cfg.actuators.status_led[key] || 0);
  dirty();
  updateStatusLedTypeUI();
}
