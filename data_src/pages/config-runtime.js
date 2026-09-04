// ── Dev Mode toggle ───────────────────────────────────────────
// ── Live sensor badge helpers ─────────────────────────────────
// Map from field key → function that returns badge text from telemetry data
function liveSensorFitted(d, telemetryKey, sensorKey, hwFlatKey) {
  if (d && d[telemetryKey] !== undefined) return !!d[telemetryKey];
  const hw = hwCfg || {};
  const sensors = hw.sensors || {};
  return !!(sensors[sensorKey]?.enabled || hw[hwFlatKey] || hw[telemetryKey]);
}
const LIVE_BADGE_KEYS = {
  'rpm_limit': d => liveSensorFitted(d, 'has_n1', 'n1_rpm', 'has_n1_rpm') && d.n1 !== undefined
    ? 'live: ' + fmtInt(d.n1) + ' RPM' : null,
  'n2_rpm_limit': d => liveSensorFitted(d, 'has_n2', 'n2_rpm', 'has_n2_rpm') && d.n2 !== undefined
    ? 'live: ' + fmtInt(d.n2) + ' RPM' : null,
  'tot_limit': d => liveSensorFitted(d, 'has_tot', 'tot', 'has_tot') && d.tot !== undefined
    ? 'live: ' + toDispTemp(Number(d.tot)).toFixed(1) + '\u00a0' + dispTempUnit() : null,
  'sf_tit': d => liveSensorFitted(d, 'has_tit', 'tit', 'has_tit') && d.tit !== undefined
    ? 'live: ' + toDispTemp(Number(d.tit)).toFixed(1) + '\u00a0' + dispTempUnit() : null,
  'oil_rm': d => liveSensorFitted(d, 'has_oil_press', 'oil_press', 'has_oil_press') && d.oil !== undefined
    ? 'live: ' + toDispPress(Number(d.oil)).toFixed(2) + '\u00a0' + dispPressUnit() : null,
  'oil_mm': d => liveSensorFitted(d, 'has_oil_press', 'oil_press', 'has_oil_press') && d.oil !== undefined
    ? 'live: ' + toDispPress(Number(d.oil)).toFixed(2) + '\u00a0' + dispPressUnit() : null,
};

function injectLiveBadges() {
  Object.keys(LIVE_BADGE_KEYS).forEach(key => {
    const inp = document.getElementById('cf-' + key);
    if (!inp) return;
    const field = inp.closest('.cfg-field');
    if (!field) return;
    const labelEl = field.querySelector('.cfg-label');
    if (!labelEl || labelEl.querySelector('.live-val')) return; // already injected
    const span = document.createElement('span');
    span.className = 'live-val';
    span.id = 'live-' + key;
    span.textContent = '';
    labelEl.appendChild(span);
  });
}

function updateLiveBadges(d) {
  Object.entries(LIVE_BADGE_KEYS).forEach(([key, fn]) => {
    const el = document.getElementById('live-' + key);
    if (!el) return;
    const text = fn(d);
    el.textContent = text || '';
  });
}

// ── WS integration — track locked state ──────────────────────
let configTelemetryInstallAttempts = 0;
function installConfigTelemetryExtension() {
const _base = window.applyData;
if (typeof _base !== 'function') {
  // The shared bootstrap loads app.js from the ECU at DOMContentLoaded. On a
  // cold/mobile connection that synchronous asset request can finish after
  // this page listener. Retry briefly instead of permanently missing the live
  // mode/lock extension for the lifetime of the page.
  if (configTelemetryInstallAttempts++ < 100)
    setTimeout(installConfigTelemetryExtension, 25);
  return;
}
if (_base._configExtended) return;
window.applyData = function(d) {
  const merged = _base(d);
  if (!merged) return;
  d = merged;
  updateLiveBadges(d);
  runtimeMode = d.mode || 'STANDBY';
  runtimeDevMode = !!d.dev_mode;
  const liveRun = runtimeMode === 'RUNNING' && runtimeDevMode;
  const activeMode = ['STARTUP','RUNNING','SHUTDOWN'].includes(runtimeMode);
  // The complete config remains locked in every active mode. On this page,
  // RUNNING Developer Mode exposes only the marked live-tuning fields.
  const locked = activeMode ? !liveRun : !!(d.config_locked ?? d.locked);
  if (locked !== isLocked && cfg.profile_id) {
    isLocked = locked;
    // The first telemetry frame can arrive after the user starts editing.
    // A lock-status refresh must never discard those page-owned changes.
    if (!_cfgDirty) {
      renderForm();
      _applyAllVisibility();
      _clearDirty();
      applyView();
      hookValidation();
    }
    const saveButton = document.getElementById('btn-save');
    if (saveButton) saveButton.disabled = locked || !_cfgDirty;
    runValidation();
  }

  // RC/PWM input capability from the current hardware topology.
  if (d.rc_pwm_active !== undefined && d.rc_pwm_active !== rcPwmActive) {
    rcPwmActive = !!d.rc_pwm_active;
    applyRcPwmVisibility();
  }

  // Governor / glow / safety-ext / starter-assist flags from hardware telemetry
  let extChanged = false;
  if (d.has_governor !== undefined && !!d.has_governor !== _hasGovernorCfg) {
    _hasGovernorCfg = !!d.has_governor; extChanged = true;
  }
  if (d.has_pulsed_starter_assist !== undefined && !!d.has_pulsed_starter_assist !== _hasStarterSupportCfg) {
    _hasStarterSupportCfg = !!d.has_pulsed_starter_assist; extChanged = true;
  }
  const hasSafetyExt = !!(d.has_oil_temp || d.has_batt_voltage || d.has_fuel_press || d.has_tit || d.has_governor || d.has_n1);
  if (hasSafetyExt !== _hasSafetyExtCfg) {
    _hasSafetyExtCfg = hasSafetyExt; extChanged = true;
  }
  // Show/hide TIT limit field based on whether TIT sensor is fitted
  if (d.has_tit !== undefined) {
    const titField = document.getElementById('field-sf-tit');
    if (titField) setCfgFieldVisibleByElement(titField, !!d.has_tit);
  }
  if (extChanged) { applyExtSectionVisibility(); applyHwConditions(); }
  applyDeveloperLiveFields();

  // Lock badge
  const badge = document.getElementById('cfg-lock-badge');
  if (badge) {
    if (runtimeMode === 'STARTUP' || runtimeMode === 'SHUTDOWN') {
      badge.textContent  = 'Read-only (engine active)';
      badge.style.color  = 'var(--red)';
    } else if (liveRun) {
      badge.textContent  = 'Limited live tuning';
      badge.style.color  = 'var(--yellow)';
    } else if (locked) {
      badge.textContent  = 'Locked';
      badge.style.color  = 'var(--red)';
    } else {
      badge.textContent  = 'Open';
      badge.style.color  = 'var(--green)';
    }
  }

  // Loop diagnostics and factory reset / restore button state
  updateLoopDiagnostics(d);
  const frBtn = document.getElementById('btn-factory-reset');
  if (frBtn) frBtn.disabled = !['STANDBY', 'FAULT'].includes(runtimeMode);
  const cfgRestoreBtn = document.getElementById('cfg-restore-btn');
  if (cfgRestoreBtn) cfgRestoreBtn.disabled = !['STANDBY', 'FAULT'].includes(runtimeMode);

  // Dev Mode button label
};
window.applyData._configExtended = true;
// app.js is injected by the shared DOMContentLoaded bootstrap. Its compact
// can deliver the first complete frame before this page-specific listener runs.
// Replay the already merged snapshot immediately so mode locks, fitted-feature
// visibility, and live badges are correct on the first rendered frame rather
// than waiting for the next telemetry interval.
if (typeof _lastData !== 'undefined' && _lastData) window.applyData(_lastData);
// Controllers and System do not hold a live telemetry stream merely to learn the ECU mode.
// Prime the compact status state now; the shared 3 s status heartbeat keeps it
// current while this page remains open.
fetch('/api/status', { cache:'no-store' })
  .then(response => response.ok ? response.json() : null)
  .then(status => { if (status) window.applyData(status); })
  .catch(() => {});
if (CONFIG_SURFACE === 'system') {
  setInterval(pollSystemTelemetry, 2000);
  pollSystemTelemetry();
}
}
document.addEventListener('DOMContentLoaded', installConfigTelemetryExtension, { once:true });

function updateLoopDiagnostics(d) {
  if (!d) return;
  const hz = Number(d.loop_hz);
  const period = Number(d.loop_period_ms);
  const periodMax = Number(d.loop_period_max_ms);
  const avg = Number(d.loop_exec_avg_ms);
  const max = Number(d.loop_exec_max_ms);
  const overruns = Number(d.loop_overrun_count);
  const count = Number(d.loop_counter);
  const fmtMs = v => Number.isFinite(v) ? v.toFixed(3) + ' ms' : '-';
  const fmtInt = v => Number.isFinite(v) ? v.toLocaleString() : '-';
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set('diag-loop-hz', Number.isFinite(hz) ? hz.toFixed(1) + ' Hz' : '-');
  set('diag-loop-period', Number.isFinite(period) ? period.toFixed(2) + ' ms' : '-');
  set('diag-loop-period-max', fmtMs(periodMax));
  set('diag-loop-avg', fmtMs(avg));
  set('diag-loop-max', fmtMs(max));
  set('diag-loop-overruns', Number.isFinite(overruns) ? fmtInt(overruns) : '-');
  set('diag-loop-count', Number.isFinite(count) ? fmtInt(count) : '-');
  set('diag-loop-sensors', fmtMs(Number(d.loop_sensors_ms)));
  set('diag-loop-sequencer', fmtMs(Number(d.loop_sequencer_ms)));
  set('diag-loop-controllers', fmtMs(Number(d.loop_controllers_ms)));
  set('diag-loop-actuators', fmtMs(Number(d.loop_actuators_ms)));
  set('diag-loop-logging', fmtMs(Number(d.loop_logging_ms)));
  set('diag-loop-led', fmtMs(Number(d.loop_led_ms)));
  const stateEl = document.getElementById('loop-diag-state');
  if (stateEl && Number.isFinite(hz) && hz > 0) {
    stateEl.textContent = 'Live';
    stateEl.style.color = 'var(--green)';
    stateEl.style.borderColor = 'var(--green)';
  }
}
window.updateLoopDiagnostics = updateLoopDiagnostics;

async function factoryReset() {
  if (typeof runtimeMode !== 'undefined' && runtimeMode !== 'STANDBY' && runtimeMode !== 'FAULT') {
    alert('Factory reset is only permitted in STANDBY or FAULT.');
    return;
  }
  if (!await OTDialog.confirm('⚠ Factory Reset\n\nThis will permanently ERASE:\n• Engine settings and sequences\n• Hardware assignments\n• All calibration\n• Wi-Fi password\n• Event and session logs\n\nDownload a complete engine file first if you may need this setup.', {
    title: 'Factory reset this ECU?', confirmText: 'Continue', danger: true
  })) return;
  const typed = await OTDialog.prompt('Type RESET to erase this ECU and reboot with built-in defaults.', {
    title: 'Final factory-reset confirmation', confirmText: 'Erase and reset', placeholder: 'RESET'
  });
  if (typed !== 'RESET') {
    alert('Factory reset cancelled. Nothing was erased.');
    return;
  }
  const msg = document.getElementById('factory-reset-msg');
  const btn = document.getElementById('btn-factory-reset');
  if (btn) btn.disabled = true;
  fetch('/api/factory_reset', { method: 'POST' })
    .then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) throw new Error(d.error || d.reason || ('HTTP ' + r.status));
      return d;
    })
    .then(d => {
      if (d.ok) {
        if (msg) { msg.textContent = 'Reset sent — device rebooting…'; msg.style.color = 'var(--yellow)'; msg.style.display = ''; }
        setTimeout(() => location.reload(), 8000);
      } else {
        if (msg) { msg.textContent = d.error || 'Reset failed'; msg.style.color = 'var(--red)'; msg.style.display = ''; }
        if (btn) btn.disabled = false;
      }
    })
    .catch(e => {
      if (msg) { msg.textContent = 'Reset request failed: ' + e.message; msg.style.color = 'var(--red)'; msg.style.display = ''; }
      if (btn) btn.disabled = false;
    });
}

function compactEngineFileForRestore(text) {
  const root = JSON.parse(text);
  const registry = root?.hardware?.channel_registry;
  const defaults = {
    pulses_per_unit:1,
    analog_zero_mv:0, analog_mv_per_unit:1000, analog_divider:1,
    digital_threshold_raw:2048, digital_hysteresis_raw:64,
    torque_interface:0, hx711_clk:-1, hx711_scale:1, hx711_zero:0,
    temp_interface:0, spi_clk:-1, spi_cs:-1, spi_miso:-1, spi_mosi:-1,
    tc_type:'K', temp_resolution:10, ntc_beta:3950, ntc_r0:10000,
    ntc_r_fixed:10000, ntc_pullup:true,
    safe_demand:0, force_safe_on_fault:false, min_run_demand:0,
    pwm_freq_hz:5000, pwm_res_bits:10,
    invert:false, pullup:false, pulldown:false,
    has_current:false, current_pin:-1, current_mv_a:100,
    current_zero_v:1.65, current_max_a:0,
    has_flow_monitor:false, minimum_flow_l_min:0
  };
  for (const channel of [...(registry?.inputs || []), ...(registry?.outputs || [])]) {
    if (!channel || typeof channel !== 'object') continue;
    for (const [key, value] of Object.entries(defaults)) {
      if (Object.is(channel[key], value)) delete channel[key];
    }
  }
  return JSON.stringify(root);
}

async function backupConfig() {
  const msg = document.getElementById('cfg-backup-msg');
  const state = document.getElementById('cfg-backup-state');
  const fetchEngineFile = async () => {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const cfgRes = await fetch('/api/ecu_config', { cache:'no-store' });
        if (!cfgRes.ok) throw new Error('HTTP ' + cfgRes.status);
        return JSON.parse(await cfgRes.text());
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)));
      }
    }
    throw lastError || new Error('No response');
  };
  fetchEngineFile()
    .then(async cfg => {
      const dataRes = await fetch('/api/data');
      const live = dataRes.ok ? await dataRes.json() : {};
      return [cfg, live];
    })
    .then(([cfg, live]) => {
      cfg._backup_meta = {
        timestamp:    new Date().toISOString(),
        fw_version:   live.fw_version || 'unknown',
        profile:      (cfg.hardware || {}).profile_id || 'unknown',
        uptime_s:     live.uptime_s  || 0
      };
      const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
      const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const profile = String(cfg._backup_meta.profile || 'OpenTurbine')
        .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'OpenTurbine';
      const profilePart = /^openturbine$/i.test(profile) ? '' : profile + '_';
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = 'OpenTurbine_' + profilePart + ts + '.json';
      a.click();
      URL.revokeObjectURL(url);
      if (state) {
        state.textContent = 'Download started';
        state.className   = 'tool-state done';
      }
      if (msg) {
        msg.textContent = 'Download started. Confirm the complete engine file appears in Downloads before relying on it.';
        msg.style.color = 'var(--green)';
        msg.style.display = '';
      }
      setTimeout(() => {
        if (state) {
          state.textContent = 'Ready';
          state.className   = 'tool-state off';
        }
        if (msg) msg.style.display = 'none';
      }, 3000);
    })
    .catch(e => {
      if (msg) {
        msg.textContent = 'Backup failed: ' + e.message;
        msg.style.color = 'var(--red)';
        msg.style.display = '';
      }
    });
}
window.backupConfig = backupConfig;

async function restoreConfig(input) {
  const file = input.files[0];
  if (!file) return;
  const msg = document.getElementById('cfg-backup-msg');
  const btn = document.getElementById('cfg-restore-btn');
  const state = document.getElementById('cfg-backup-state');
  if (typeof runtimeMode !== 'undefined' && !['STANDBY', 'FAULT'].includes(runtimeMode)) {
    alert('Engine must be in STANDBY (or FAULT) to restore an engine file.');
    input.value = '';
    return;
  }
  if (!await OTDialog.confirm('Restore complete engine file from "' + file.name + '"?\n\nThis replaces hardware assignments, settings, sequences, calibration, profile/Wi-Fi details, and runtime statistics, then reboots. Current event and session logs remain on this ECU.\n\nDownload the current engine file first if it may be needed.', {
    title: 'Restore complete engine file?', confirmText: 'Restore and reboot', danger: true
  })) {
    input.value = '';
    return;
  }
  if (btn) btn.disabled = true;
  if (state) {
    state.textContent = 'Restoring…';
    state.className   = 'tool-state active';
  }
  const reader = new FileReader();
  reader.onload = ev => {
    const postRestore = async () => {
      const payload = compactEngineFileForRestore(ev.target.result);
      try {
        return await fetch('/api/ecu_config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        });
      } catch (error) {
        if (state) state.textContent = 'Checking after ECU restart…';
        let sawDisconnect = false;
        for (let attempt = 0; attempt < 45; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          try {
            const status = await fetch('/api/status', {cache:'no-store'});
            if (status.ok && sawDisconnect) {
              return new Response(JSON.stringify({ok:true,reboot:true,recovered:true}), {
                status:200, headers:{'Content-Type':'application/json'}
              });
            }
          } catch (_) {
            sawDisconnect = true;
          }
        }
        throw new Error(sawDisconnect
          ? 'The ECU restarted but did not reconnect. Rejoin its Wi-Fi and verify the engine file before trying again.'
          : 'The restore response was lost. The file was not sent again because repeating a restore may reboot the ECU twice. Reconnect and verify the current engine file.');
      }
    };
    postRestore()
    .then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) throw new Error(d.error || d.reason || ('HTTP ' + r.status));
      return d;
    })
    .then(d => {
      if (d.ok) {
        if (state) {
          state.textContent = 'Done — rebooting…';
          state.className   = 'tool-state done';
        }
        if (msg) {
          msg.textContent = 'Config restored. Device is rebooting.';
          msg.style.color = 'var(--green)';
          msg.style.display = '';
        }
      } else {
        throw new Error(d.error || 'Unknown error');
      }
    })
    .catch(e => {
      if (state) {
        state.textContent = 'Error';
        state.className   = 'tool-state fault';
      }
      if (msg) {
        msg.textContent = 'Restore failed: ' + e.message;
        msg.style.color = 'var(--red)';
        msg.style.display = '';
      }
      if (btn) btn.disabled = false;
    });
    input.value = '';
  };
  reader.readAsText(file);
}
window.restoreConfig = restoreConfig;

let _systemTelemetryInFlight = false;
async function pollSystemTelemetry() {
  if (CONFIG_SURFACE !== 'system' || _systemTelemetryInFlight || document.hidden) return;
  _systemTelemetryInFlight = true;
  try {
    const r = await fetch('/api/data', { cache: 'no-store' });
    if (r.ok) {
      const d = await r.json();
      window._lastSystemData = d;
      if (window.applyData) window.applyData(d);
      else updateLoopDiagnostics(d);
    }
  } catch (_) {}
  finally {
    _systemTelemetryInFlight = false;
  }
}

function applyDeveloperLiveFields() {
  const liveRun = runtimeMode === 'RUNNING' && runtimeDevMode;
  const activeMode = ['STARTUP','RUNNING','SHUTDOWN'].includes(runtimeMode);
  SCHEMA.forEach(section => section.fields.forEach(field => {
    const el = document.getElementById('cf-' + field.key);
    const wrap = el?.closest('.cfg-field');
    if (!el || !wrap) return;
    const fieldLocked = activeMode && !(liveRun && LIVE_CONFIG_KEYS.has(field.key));
    if (fieldLocked) {
      el.dataset.activeLocked = '1';
      wrap.classList.add('feature-unavailable');
      wrap.title = runtimeMode === 'RUNNING'
        ? 'Stop the engine to change this setting.'
        : 'Settings are read-only during ' + runtimeMode + '.';
    } else if (el.dataset.activeLocked) {
      delete el.dataset.activeLocked;
      wrap.classList.remove('feature-unavailable');
      if (wrap.title.startsWith('Stop the engine') || wrap.title.startsWith('Settings are read-only')) wrap.title = '';
    }
    if (liveRun && LIVE_CONFIG_KEYS.has(field.key)) {
      wrap.title = 'Applies live through the existing controller limits.';
      wrap.dataset.appliesLive = '1';
    } else if (wrap.dataset.appliesLive) {
      delete wrap.dataset.appliesLive;
      if (wrap.title === 'Applies live through the existing controller limits.') wrap.title = '';
    }
  }));
  _refreshDependencyEditability();
}

// ── Oil throttle-map — show map-max only when enabled ────────
function applyOilMapVisibility() {
  const tmCb   = document.getElementById('cf-oil_tm');
  const mxWrap = document.getElementById('field-oil_mx');
  if (!tmCb || !mxWrap) return;
  const mxEl = document.getElementById('cf-oil_mx');
  function sync() {
    const hwAvailable = !_fieldIsHardwareInactive(tmCb.closest('.cfg-field'));
    const enabled = hwAvailable && !!tmCb.checked && !isLocked;
    mxWrap.style.display = '';
    mxWrap.dataset.logicalDisabled = tmCb.checked ? '0' : '1';
    mxWrap.title = !hwAvailable
      ? 'Oil pressure sensor is not configured in Hardware. Enable an oil pressure sensor to unlock Map Max.'
      : tmCb.checked
      ? 'Oil map maximum pressure at full throttle.'
      : 'Disabled because Throttle-Map Pressure is off. Turn Throttle-Map Pressure on to unlock Map Max.';
    if (mxEl) mxEl.disabled = !enabled;
    _refreshDependencyEditability();
  }
  tmCb.addEventListener('change', sync);
  sync();
}

// ── AB ignition method — conditional field visibility ─────────
function applyAbIgnitionParamVisibility() {
  const utEl = document.getElementById('cf-ab_ut');
  const fmEl = document.getElementById('cf-ab_fm');
  const useTorch  = utEl ? utEl.checked : false;
  const flameMode = fmEl ? parseInt(fmEl.value) : 2;
  function showF(key, show) {
    setCfgFieldHardHidden(key, !show);
    setCfgFieldVisible(key, show);
  }
  showF('ab_tpct', useTorch);
  showF('ab_tms',  useTorch);
  showF('ab_ttl',  useTorch);
  showF('ab_tr',   flameMode === 1);
  showF('ab_tw',   flameMode === 1);
  showF('ab_ams',  flameMode === 2);
  showF('ab_fld',  flameMode === 0);
  applyView();
}

function _cfgShowField(key, show) {
  setCfgFieldHardHidden(key, !show);
  setCfgFieldVisible(key, show);
}

function applyFlameoutRelightVisibility() {
  const flSrc = parseInt(document.getElementById('cf-sf_fs')?.value || '0', 10);
  const rlTriggerSrc = parseInt(document.getElementById('cf-rl_ts')?.value || '0', 10);
  const rlSrc = parseInt(document.getElementById('cf-rl_cs')?.value || '0', 10);
  const hasFlame = hasRegistryInput('flame');
  const hasN1 = hasRegistryInput('n1_speed');
  const hasTot = hasRegistryInput('tot');
  const hasTit = hasRegistryInput('tit');
  const hasEgt = hasTot || hasTit;
  const autoFlameSrc = hasFlame ? 1 : (hasN1 ? 2 : (hasEgt ? 3 : 0));
  const effFl = flSrc || autoFlameSrc;
  const effTrigger = rlTriggerSrc || autoFlameSrc;
  const effRl = rlSrc || effTrigger;
  _cfgShowField('sf_fn', effFl === 2);
  _cfgShowField('sf_eb', effFl === 3);
  _cfgShowField('sf_ef', effFl === 3);
  _cfgShowField('rl_tb', effTrigger === 3);
  _cfgShowField('rl_tf', effTrigger === 3);
  _cfgShowField('rl_cr', effTrigger === 2 || effRl === 2);
  _cfgShowField('rl_tr', effRl === 3);
  applyView();
}

// ── RC PWM section — show only when RC PWM is active ─────────
let rcPwmActive = false;
function applyRcPwmVisibility() {
  const sec = document.getElementById('rc-pwm-section');
  if (sec) {
    sec.dataset.forceHidden = rcPwmActive ? '0' : '1';
    sec.style.display = '';
  }
}

// ── AB sections — show only when hasAfterburner ───────────────
let hasAfterburnerCfg = false;
function applyAbCfgVisibility() {
  const ids = ['ab-ign-section','ab-flame-section','ab-run-section'];
  ids.forEach(id => {
    const sec = document.getElementById(id);
    if (sec) {
      sec.dataset.forceHidden = hasAfterburnerCfg ? '0' : '1';
      sec.style.display = '';
    }
  });
}

// ── Safety-ext / Governor / Glow / StarterAssist sections — show when hardware fitted ──
let _hasGovernorCfg = false, _hasSafetyExtCfg = false, _hasStarterSupportCfg = false;
function refreshFeatureCachesFromHardware() {
  const a = hwCfg.actuators || {};
  hasAfterburnerCfg = hasActualAfterburnerHardware();
  _hasGovernorCfg = !!hwCfg.controllers?.governor;
  const starterDriver = Number(registryOutputByPurpose('starter')?.driver);
  _hasStarterSupportCfg = !!(hasRegistryOutput('starter') && starterDriver !== 4 && hasRegistryInput('n1_speed'));
  // AB servo-PWM input uses the same shared RC failsafe timeout, so an
  // AB-only RC setup must still see the RC Input section.
  const registrySignalInput = (hwCfg.channel_registry?.inputs || []).some(input =>
    registryChannelInstalled(input) && [3, 7].includes(Number(input.driver)));
  const abRcPwm = !!(hasAfterburnerCfg &&
    (hwCfg.ab_trigger?.input_rc_pwm && (hwCfg.ab_trigger?.input_pin ?? -1) >= 0));
  rcPwmActive = !!(Number(registryInputByPurpose('throttle')?.driver) === 3 ||
                   Number(registryInputByPurpose('idle')?.driver) === 3 ||
                   registrySignalInput || abRcPwm);
  _hasSafetyExtCfg = !!(
    hasRegistryInput('tit') || hasRegistryInput('oil_temperature') ||
    hasRegistryInput('fuel_pressure') || hasRegistryInput('battery_voltage') ||
    hasRegistryInput('n1_speed')
  );
}
function applyExtSectionVisibility() {
  const safetyExts = ['sf_tit','sf_ot','sf_fp','sf_bv','sf_sg'];
  const anyExt = _hasSafetyExtCfg;
  const safetyExtSec = document.getElementById('safety-ext-section');
  if (safetyExtSec) { safetyExtSec.dataset.forceHidden = anyExt ? '0' : '1'; safetyExtSec.style.display = ''; }

  const govSec = document.getElementById('governor-cfg-section');
  if (govSec) { govSec.dataset.forceHidden = _hasGovernorCfg ? '0' : '1'; govSec.style.display = ''; }

  const supportSec = document.getElementById('starter-support-section');
  if (supportSec) { supportSec.dataset.forceHidden = _hasStarterSupportCfg ? '0' : '1'; supportSec.style.display = ''; }
}

// ── Hardware-conditional visibility ──────────────────────
// Loaded from /api/hardware at boot — hides sections/fields that don't apply
// to the fitted hardware without requiring the user to manage them.
let hwCfg = {};

function registryChannelInstalled(channel) {
  if (!channel || channel.installed === false) return false;
  const driver = Number(channel.driver);
  if (driver >= 8 && driver <= 11) {
    const address = Number(channel.i2c_address);
    const validAddress = driver === 10 ? address === 0x2A
      : (driver === 8 || driver === 11) ? address >= 0x20 && address <= 0x27
      : driver === 9 && address >= 0x10 && address <= 0x17;
    return validAddress && Number(channel.device_channel) >= 0;
  }
  const tempInterface = Number(channel.temp_interface || 0);
  if (tempInterface >= 1 && tempInterface <= 3) {
    return Number(channel.spi_clk) >= 0 && Number(channel.spi_cs) >= 0 &&
      Number(channel.spi_miso) >= 0 && (tempInterface !== 3 || Number(channel.spi_mosi) >= 0);
  }
  return Number(channel.pin) >= 0;
}
function registryInputByPurpose(...purposes) {
  const wanted = new Set(purposes.map(String));
  return (hwCfg.channel_registry?.inputs || []).find(channel =>
    registryChannelInstalled(channel) && wanted.has(String(channel.purpose || channel.id || '')));
}
function registryOutputByPurpose(...purposes) {
  const wanted = new Set(purposes.map(String));
  return (hwCfg.channel_registry?.outputs || []).find(channel =>
    registryChannelInstalled(channel) && !String(channel.mirror_of || '') &&
    wanted.has(String(channel.purpose || channel.id || '')));
}
function hasRegistryInput(...purposes) { return !!registryInputByPurpose(...purposes); }
function hasRegistryOutput(...purposes) { return !!registryOutputByPurpose(...purposes); }
function hasActualAfterburnerHardware(hw = hwCfg) {
  return hasRegistryOutput('ab_igniter', 'ab_pump', 'ab_valve');
}

function applyHwConditions() {
  const a  = hwCfg.actuators  || {};
  const hasOilPress    = hasRegistryInput('oil_pressure');
  const hasN1          = hasRegistryInput('n1_speed');
  const hasN2          = hasRegistryInput('n2_speed');
  const hasOilTemp     = hasRegistryInput('oil_temperature');
  const hasFuelPress   = hasRegistryInput('fuel_pressure');
  const hasBattVolt    = hasRegistryInput('battery_voltage');
  const hasFlame       = hasRegistryInput('flame');
  const hasTot         = hasRegistryInput('tot');
  const hasTit         = hasRegistryInput('tit');
  const hasP1          = hasRegistryInput('p1_pressure');
  const hasP2          = hasRegistryInput('p2_pressure');
  const hasTorque      = hasRegistryInput('torque');
  const hasAB          = hasActualAfterburnerHardware();
  const hasAbFlame     = !!(hasAB && hasRegistryInput('ab_flame'));
  const abTriggerSource = Number(hwCfg.ab_trigger?.source ?? hwCfg.abTriggerSource ?? 0);
  const savedAbPumpSource = Number(getPath(cfg, ['afterburner', 'pump_control_mode']) ?? 0);
  const hasAbInput     = !!(hasAB && (hasRegistryInput('ab_command') ||
    ((hwCfg.ab_trigger?.input_pin ?? -1) >= 0 &&
     (abTriggerSource === 3 || savedAbPumpSource === 2))));
  const hasIgniter     = hasRegistryOutput('igniter');
  const hasIgniter2    = hasRegistryOutput('ab_igniter');
  const hasAbIgniter   = !!(hasAB && hasIgniter2);
  const hasThrottleOut = hasRegistryOutput('main_fuel');
  const hasThrottleInput = hasRegistryInput('throttle');
  const hasOilPump     = hasRegistryOutput('oil_pump');
  const oilPumpChannel = registryOutputByPurpose('oil_pump');
  const hasOilPumpCurrent = !!(a.oil_pump?.has_current || oilPumpChannel?.has_current);
  const hasStarter     = hasRegistryOutput('starter');
  const hasFuelSol     = hasRegistryOutput('fuel_shutoff');
  const hasPropPitch   = hasRegistryOutput('prop_pitch');
  const hasGlowPlug    = hasRegistryOutput('glow_plug');
  const hasFuelPump2   = hasRegistryOutput('fuel_pump');
  const hasCoolFan     = hasRegistryOutput('cooling_fan');
  const hasAirstarter  = hasRegistryOutput('air_starter');
  const hasOilScavenge = hasRegistryOutput('scavenge_pump');
  const oilScavengeChannel = registryOutputByPurpose('scavenge_pump');
  const hasMonitoredOilFlow = !!(
    (oilPumpChannel?.has_flow_monitor && hasRegistryInput('oil_flow')) ||
    (oilScavengeChannel?.has_flow_monitor && hasRegistryInput('scavenge_flow'))
  );
  const hasBleedValve  = hasRegistryOutput('bleed_valve');
  const hasStarterEn   = hasRegistryOutput('starter_enable');
  const hasAbSol       = !!(hasAB && hasRegistryOutput('ab_valve'));
  const hasAbPump      = !!(hasAB && hasRegistryOutput('ab_pump'));
  const hasAbFuelHardware = hasAbSol || hasAbPump;
  const hasClusterSerial = !!hwCfg.cluster_serial?.enabled;
  const mainFuelChannel = registryOutputByPurpose('main_fuel');
  const driverIsOnOff = driver => [4,11].includes(Number(driver));
  const driverIsProportional = driver => [5,6].includes(Number(driver));
  const hasMeteringFuel = !!mainFuelChannel && driverIsProportional(mainFuelChannel.driver);
  const hasDynamicIdle = !!(hwCfg.controllers?.dynamic_idle &&
    hasMeteringFuel && (hasN1 || hasN2 || hasP1 || hasP2));
  const hasGovernorRequested = !!hwCfg.controllers?.governor;
  const registryPropPitch = registryOutputByPurpose('prop_pitch');
  const hasPitchAuthority = hasPropPitch && (driverIsOnOff(registryPropPitch?.driver) || driverIsProportional(registryPropPitch?.driver));
  const hasProportionalPropPitch = hasPropPitch && driverIsProportional(registryPropPitch?.driver);
  const hasGovernorControl = hasMeteringFuel || hasPitchAuthority;
  const hasGovernor = hasGovernorRequested && hasN2 && hasGovernorControl;
  const actuatorPurposes = {
    throttle: 'main_fuel', starter: 'starter', oil_pump: 'oil_pump', fuel_sol: 'fuel_shutoff',
    prop_pitch: 'prop_pitch', glow_plug: 'glow_plug', fuel_pump2: 'fuel_pump', cool_fan: 'cooling_fan',
    airstarter_sol: 'air_starter', oil_scavenge_pump: 'scavenge_pump', bleed_valve: 'bleed_valve',
    starter_en: 'starter_enable', ab_sol: 'ab_valve', ab_pump: 'ab_pump'
  };
  const actuatorType = key => {
    const driver = Number(registryOutputByPurpose(actuatorPurposes[key] || key)?.driver);
    return driverIsOnOff(driver) ? 2 : (driver === 5 ? 1 : (driver === 6 ? 0 : NaN));
  };
  const isOnOffType = key => Number(actuatorType(key)) === 2;

  function showField(key, show) {
    setCfgFieldVisible(key, show);
  }

  function ghostField(key, available, reason) {
    const el = document.getElementById('cf-' + key);
    const wrap = el?.closest('.cfg-field');
    if (!el || !wrap) return;
    if (!wrap.dataset.baseTitle) {
      const label = wrap.querySelector('.cfg-label')?.textContent?.trim() || '';
      const desc = wrap.querySelector('.cfg-desc')?.textContent?.trim() || '';
      wrap.dataset.baseTitle = desc ? (label ? label + ': ' + desc : desc) : '';
    }
    wrap.dataset.hardwareUnavailable = available ? '0' : '1';
    wrap.dataset.inactiveReason = available ? '' : reason;
    if (!available) {
      wrap.title = reason;
    } else if (el.type === 'checkbox' && !el.checked) {
      const unlockHints = {
        oil_tm: 'Turn this on to unlock Map Max and make oil pressure target rise with throttle.',
        rl_en: 'Turn this on to run the independent automatic-relight detector and ignition attempt.',
        ab_ut: 'Turn this on to unlock torch fuel-spike duration and EGT cut settings.',
        ab_ui: 'Turn this on to fire the dedicated afterburner igniter during AB ignition.'
      };
      wrap.title = unlockHints[key] || wrap.dataset.baseTitle || '';
    } else {
      wrap.title = wrap.dataset.baseTitle || '';
    }
  }

  function ghostSectionByTitle(title, available, reason) {
    const sec = Array.from(document.querySelectorAll('.cfg-section'))
      .find(s => s.dataset.section === title);
    if (!sec) return;
    sec.dataset.hardwareUnavailable = available ? '0' : '1';
    sec.dataset.inactiveReason = available ? '' : reason;
    sec.title = available ? '' : reason;
  }

  function ghostSelectOption(key, value, available, reason) {
    const el = document.getElementById('cf-' + key);
    const opt = el?.querySelector(`option[value="${value}"]`);
    if (!opt) return;
    if (!opt.dataset.baseLabel) opt.dataset.baseLabel = opt.textContent;
    opt.dataset.hardwareUnavailable = available ? '0' : '1';
    opt.dataset.inactiveReason = available ? '' : reason;
    if (el && !available && String(el.value) === String(value)) {
      const wrap = el.closest('.cfg-field');
      if (wrap) wrap.title = reason;
    }
  }

  // ── Oil system: hide pressure-control fields when no sensor ──────────────
  // Without a sensor the closed-loop controller does not run; direct pump
  // output during startup and shutdown is configured on the Sequence page.
  const oilPressFields = ['oil_rm','oil_zb','oil_tm','oil_mm','oil_mx','oil_as','oil_mp','oa_db','oil_fd','oil_fp'];
  oilPressFields.forEach(k =>
    ghostField(k, hasOilPress, 'Oil pressure sensor is not configured in Hardware. Enable an oil pressure sensor to unlock closed-loop oil pressure settings.'));
  ghostField('oil_ufd', hasMonitoredOilFlow,
    'No pump has flow monitoring enabled with its matching flow-meter input in Hardware.');
  ghostField('oil_ufs', hasMonitoredOilFlow,
    'Configure and enable a pump flow monitor in Hardware before allowing low flow to request shutdown.');
  const oilMpEl  = document.getElementById('cf-oil_mp');
  const oilMmEl  = document.getElementById('cf-oil_mm');
  if (oilMpEl) {
    const label = oilMpEl.closest('.cfg-field')?.querySelector('.cfg-label');
    if (label) label.textContent = 'Controller Minimum Duty %';
  }
  // Oil Target remains unavailable without pressure feedback; Advanced may
  // display it ghosted as reference, but it must never become editable.

  // Show/hide a no-sensor note inside the oil-pressure controller section.
  let oilNote = document.getElementById('hw-oil-no-sensor-note');
  if (!hasOilPress) {
    if (!oilNote) {
      oilNote = document.createElement('div');
      oilNote.id = 'hw-oil-no-sensor-note';
      oilNote.style.cssText = 'font-size:.72rem;color:var(--yellow);background:rgba(255,196,0,.07);border:1px solid rgba(255,196,0,.3);border-radius:5px;padding:.35rem .65rem;margin:.15rem 0 .45rem;line-height:1.5;grid-column:1/-1';
      oilNote.textContent = 'No oil pressure sensor — closed-loop running-pressure settings are inactive. Set startup oil-pump duty in Sequence > Build Oil Pressure.';
      // Insert after the oil-pressure controller title.
      const oilGrid = oilMpEl?.closest('.cfg-grid');
      if (oilGrid) oilGrid.prepend(oilNote);
    }
    oilNote.style.display = '';
  } else if (oilNote) {
    oilNote.style.display = 'none';
  }

  // ── Windmilling oil protection from N1/N2, no oil-pressure sensor required ─────
  const hasStandbyOilSource = hasN1 || hasN2;
  const hasStandbyOilActuator = _independentFittedOutputs().length > 0;
  const standbyOilAvailable = hasStandbyOilActuator && hasStandbyOilSource;
  const standbyOilEnabled = !!document.getElementById('cf-so_en')?.checked;
  ghostSectionByTitle('Windmilling Oil Protection', standbyOilAvailable,
    !hasStandbyOilActuator
      ? 'No fitted output is available. Add an oil pump (recommended) or another usable output in Hardware.'
      : 'No N1 or N2 RPM sensor is configured. Enable a shaft RPM sensor to unlock windmilling oil protection.');
  ghostField('so_en', standbyOilAvailable,
    'Windmilling oil protection needs a fitted output and at least one shaft RPM sensor.');
  ghostField('so_src', standbyOilAvailable && standbyOilEnabled,
    'Windmilling oil protection needs a fitted output and at least one shaft RPM sensor.');
  ghostSelectOption('so_src', 0, hasN1,
    'N1 RPM sensor is not configured in Hardware.');
  ghostSelectOption('so_src', 1, hasN2,
    'N2 RPM sensor is not configured in Hardware.');
  ghostSelectOption('so_src', 2, hasStandbyOilSource,
    'No N1 or N2 RPM sensor is configured in Hardware.');
  ['so_oid','so_rl','so_fp','so_fb'].forEach(k => ghostField(k, standbyOilAvailable && standbyOilEnabled,
    standbyOilEnabled
      ? 'Windmilling oil protection needs a fitted output and at least one shaft RPM sensor.'
      : 'Enable Windmilling Oil Protection to edit this setting.'));

  // ── Core sensor-dependent limits stay visible but ghosted so users can see
  // which common protections need hardware before they matter.
  const egtSel = Number((document.getElementById('cf-eg_src') || {}).value || 0);
  const egtSrc = egtSel === 1 && hasTot ? 1 :
                 egtSel === 2 && hasTit ? 2 :
                 hasTot ? 1 :
                 hasTit ? 2 : 0;
  const hasEgt = egtSrc !== 0;
  const usesTotEgt = egtSrc === 1;
  const usesTitEgt = egtSrc === 2;
  ghostField('eg_src', hasTot || hasTit, 'Primary engine temperature safety requires a configured TOT or TIT sensor.');
  ghostSelectOption('eg_src', 1, hasTot, 'TOT sensor is not configured in Hardware.');
  ghostSelectOption('eg_src', 2, hasTit, 'TIT sensor is not configured in Hardware.');
  ghostField('tot_limit', usesTotEgt, usesTitEgt ? 'TIT is selected as primary EGT; TIT Limit is used instead.' : 'TOT sensor is not configured in Hardware.');
  ['tot_safe_margin'].forEach(k =>
    ghostField(k, hasEgt, 'Selected EGT safety requires a configured TOT or TIT sensor.'));
  ghostField('sf_hs', hasEgt, 'Hot-start protection requires a configured TOT or TIT sensor.');
  ghostField('sf_st', hasEgt, 'The startup EGT hard limit requires a configured TOT or TIT sensor.');
  ghostField('sf_ot', hasOilTemp, 'Oil temperature sensor is not configured in Hardware.');
  ghostField('sf_ot_d', hasOilTemp, 'Oil-temperature confirmation has no effect without an oil-temperature sensor.');
  ghostField('sf_fp', hasFuelPress, 'Fuel pressure sensor is not configured in Hardware.');
  ghostField('sf_fp_d', hasFuelPress, 'Fuel-pressure confirmation has no effect without a fuel-pressure sensor.');
  ghostField('sf_bv', hasBattVolt, 'Battery voltage sensor is not configured in Hardware.');
  ghostField('sf_bv_d', hasBattVolt, 'Bus-voltage confirmation has no effect without a battery-voltage sensor.');
  ghostField('sf_tit', usesTitEgt, !hasTit ? 'TIT sensor is not configured in Hardware.' : 'TIT is not the selected primary engine temperature.');
  ghostField('sf_sg', hasN1, 'Surge detection requires an N1 RPM sensor.');
  ghostField('rh_jt', hasN1, 'RPM health checks require an N1 RPM sensor.');
  ghostField('rh_zs', hasN1, 'RPM health checks require an N1 RPM sensor.');
  // Fuel response shaping and gradual protection are automatic whenever the
  // main-fuel output exists; users configure the behavior here without a
  // second internal-controller enable.
  ghostField('th_ru', hasThrottleOut, 'Main fuel metering output is not configured in Hardware.');
  ghostField('th_rd', hasThrottleOut, 'Main fuel metering output is not configured in Hardware.');
  ghostField('th_mx', hasThrottleOut, 'Main fuel metering output is not configured in Hardware.');
  ghostField('th_ex', hasThrottleOut && hasThrottleInput,
    !hasThrottleOut
      ? 'Main fuel metering output is not configured in Hardware.'
      : 'Low-throttle sensitivity only applies to a physical throttle input configured in Hardware.');
  const hasN1Pb = hasRegistryInput('n1_speed');
  const hasEgtPb = hasRegistryInput('tot', 'tit');
  ['pb_n1e','pb_n1s','pb_n1h','pb_n1l','pb_n1str','rl_ramp','rl_zone','rl_acc'].forEach(k =>
    ghostField(k, hasThrottleOut && hasN1Pb,
      !hasN1Pb ? 'N1 pullback requires an N1 RPM sensor in Hardware.' : 'Main fuel output is not configured in Hardware.'));
  ['pb_n2e','pb_n2s','pb_n2h','pb_n2l','pb_n2str'].forEach(k =>
    ghostField(k, hasThrottleOut && hasN2,
      !hasN2 ? 'N2 pullback requires an N2 RPM sensor in Hardware.' : 'Main fuel output is not configured in Hardware.'));
  ['pb_egte','pb_egts','pb_egth','pb_egtl','pb_egtstr'].forEach(k =>
    ghostField(k, hasThrottleOut && hasEgtPb,
      !hasEgtPb ? 'EGT pullback requires a TOT or TIT sensor in Hardware.' : 'Main fuel output is not configured in Hardware.'));
  ['pb_p1e','pb_p1s','pb_p1h','pb_p1l','pb_p1str'].forEach(k =>
    ghostField(k, hasThrottleOut && hasP1,
      !hasP1 ? 'P1 pullback requires a P1 pressure sensor in Hardware.' : 'Main fuel output is not configured in Hardware.'));
  ['pb_p2e','pb_p2s','pb_p2h','pb_p2l','pb_p2str'].forEach(k =>
    ghostField(k, hasThrottleOut && hasP2,
      !hasP2 ? 'P2 pullback requires a P2 pressure sensor in Hardware.' : 'Main fuel output is not configured in Hardware.'));
  ['pb_tqe','pb_tqs','pb_tqh','pb_tql','pb_tqstr'].forEach(k =>
    ghostField(k, hasThrottleOut && hasTorque,
      !hasTorque ? 'Torque pullback requires a shaft-torque sensor in Hardware.' : 'Main fuel output is not configured in Hardware.'));
  const hasAnyPullbackSource = hasN1Pb || hasN2 || hasEgtPb || hasP1 || hasP2 || hasTorque;
  ['pb_min'].forEach(k =>
    ghostField(k, hasThrottleOut && hasAnyPullbackSource,
      !hasAnyPullbackSource ? 'Pullback floor has no effect until an N1, N2, TOT, TIT, P1, P2, or torque sensor is configured in Hardware.' : 'Main fuel output is not configured in Hardware.'));
  const configurePullbackVisibility = (modeKey, normalKeys, predictiveKeys) => {
    const mode = Number(document.getElementById('cf-' + modeKey)?.value || 0);
    const enabled = mode > 0;
    const predictive = mode === 2;
    normalKeys.forEach(key => setCfgFieldHardHidden(key, !enabled));
    predictiveKeys.forEach(key => setCfgFieldHardHidden(key, !enabled || !predictive));
  };
  configurePullbackVisibility('pb_n1e',['pb_n1s','pb_n1h'],['pb_n1l','pb_n1str','rl_ramp','rl_zone','rl_acc']);
  configurePullbackVisibility('pb_n2e',['pb_n2s','pb_n2h'],['pb_n2l','pb_n2str']);
  configurePullbackVisibility('pb_egte',['pb_egts','pb_egth'],['pb_egtl','pb_egtstr']);
  configurePullbackVisibility('pb_p1e',['pb_p1s','pb_p1h'],['pb_p1l','pb_p1str']);
  configurePullbackVisibility('pb_p2e',['pb_p2s','pb_p2h'],['pb_p2l','pb_p2str']);
  configurePullbackVisibility('pb_tqe',['pb_tqs','pb_tqh'],['pb_tql','pb_tqstr']);
  ghostField('lm_mt', hasThrottleOut, 'Reduced-power mode requires a throttle/fuel output.');
  const hasAnyIgnitionOutput = hasIgniter || hasIgniter2 || hasGlowPlug;
  ghostField('ms_is', hasAnyIgnitionOutput, 'Igniter-on-START requires Igniter 1, Secondary Igniter, or Glow/Wet Glow to be configured in Hardware.');
  const manualRelightId = String((document.getElementById('cf-ms_oid') || {}).value || cfg?.misc?.igniter_on_start_output_id || '');
  const hasManualRelightOutput = _installedIgnitionOutputs().some(row => String(row.id || '') === manualRelightId);
  ghostField('ms_oid', hasAnyIgnitionOutput,
    hasAnyIgnitionOutput
      ? 'Choose the fitted ignition device controlled while START is held during RUNNING.'
      : 'START relight requires an Igniter, Afterburner Igniter, or Glow/Wet Glow output in Hardware.');
  ghostField('ms_is', hasManualRelightOutput,
    hasAnyIgnitionOutput
      ? 'Select a fitted START relight output first.'
      : 'Igniter-on-START requires a fitted ignition output in Hardware.');
  ghostField('tl_fp', hasFuelSol, 'Main Fuel Prime duration requires a main fuel shutoff output.');
  ghostField('tl_fs', hasFuelSol, 'Main Fuel Shutoff Pulse duration requires a main fuel shutoff output.');
  ghostField('tl_op', hasOilPump, 'Oil Prime duration requires an oil pump output.');
  ghostField('tl_ig', hasIgniter, 'Igniter 1 Test duration requires Igniter 1 to be configured in Hardware.');
  ghostField('tl_i2', hasIgniter2, 'Secondary Igniter Test duration requires Secondary Igniter to be configured in Hardware.');
  ghostField('tl_gl', hasGlowPlug, 'Glow Test duration requires a glow plug output.');
  ghostField('tl_gp', hasGlowPlug, 'Glow Test demand requires a glow plug output.');
  ghostField('tl_st', hasStarter, 'Starter Test duration requires a starter output.');
  ghostField('tl_sp', hasStarter && !isOnOffType('starter'), isOnOffType('starter')
    ? 'Starter is configured as relay/on-off. Starter Test % is ignored; use Starter Test ms to control pulse length.'
    : 'Starter Test demand requires a starter output.');
  ghostField('tl_it', hasThrottleOut, 'Idle Test duration requires a throttle/fuel output.');
  ghostField('tl_os', hasOilScavenge, 'Scavenge Test duration requires an oil scavenge pump output.');
  ghostField('tl_cf', hasCoolFan, 'Fan Test duration requires a cooling fan output.');
  ghostField('tl_as', hasAirstarter, 'Air Starter Valve Test duration requires an air starter valve output.');
  ghostField('tl_bv', hasBleedValve, 'Bleed Test duration requires a bleed valve output.');
  ghostField('tl_f2', hasFuelPump2, 'Secondary / Auxiliary Fuel Pump Test duration requires Secondary / Auxiliary Fuel Pump in Hardware.');
  ghostField('tl_f2p', hasFuelPump2 && !isOnOffType('fuel_pump2'), isOnOffType('fuel_pump2')
    ? 'Secondary / Auxiliary Fuel Pump is configured as relay/on-off. Test % is ignored; use test duration to control pulse length.'
    : 'Secondary / Auxiliary Fuel Pump Test demand requires Secondary / Auxiliary Fuel Pump in Hardware.');
  ghostField('tl_se', hasStarterEn, 'Starter Enable Test duration requires a starter enable output.');
  ghostField('tl_pp', hasPropPitch, 'Prop Pitch Test duration requires a prop-pitch actuator.');
  ghostField('tl_pq', hasPropPitch && !isOnOffType('prop_pitch'), isOnOffType('prop_pitch')
    ? 'Prop pitch is configured as relay/on-off. Prop Pitch Test % is ignored; use Prop Pitch Test ms to control pulse length.'
    : 'Prop Pitch Test demand requires a prop-pitch actuator.');
  ghostField('tl_abs', hasAbSol, 'The valve test requires an installed afterburner fuel shutoff valve.');
  ghostField('tl_abp', hasAbPump, 'The pump test requires an installed afterburner fuel pump.');
  ghostField('tl_abq', hasAbPump && !isOnOffType('ab_pump'), isOnOffType('ab_pump')
    ? 'The afterburner fuel pump is configured as relay/on-off. Pump Test % is ignored; use the test duration instead.'
    : 'Pump-test demand requires an installed afterburner fuel pump.');
  ['di_src','di_tr','di_tp','di_ru','di_rd','di_db','di_rl','di_pd','di_pl','di_mx','di_ig','di_im','di_mode','di_de','di_dd','di_lk','di_sb','di_fr','di_tu','di_td','di_lr','di_la','di_pde','di_psb','di_pfr','di_plr'].forEach(k =>
    ghostField(k, hasDynamicIdle, 'Automatic Idle must be enabled in Hardware > Controllers and needs a main fuel output plus N1, N2, P1, or P2 feedback.'));
  ghostSelectOption('di_src', 0, hasN1, 'N1 speed input is not configured in Hardware.');
  ghostSelectOption('di_src', 1, hasN2, 'N2 speed input is not configured in Hardware.');
  ghostSelectOption('di_src', 2, hasP1, 'P1 pressure input is not configured in Hardware.');
  ghostSelectOption('di_src', 3, hasP2, 'P2 pressure input is not configured in Hardware.');
  // Idle remains available for its normal fuel range even when automatic
  // feedback is off. Individual Automatic Idle fields are gated above.

  const starterAssistAvailable = _hasStarterSupportCfg;
  ['sa_en','sa_pc','sa_er','sa_on','sa_off'].forEach(k => ghostField(k, starterAssistAvailable,
    !hasStarter ? 'Pulsed Starter Assist requires a configured starter output.' :
    !hasN1 ? 'Pulsed Starter Assist requires N1 speed feedback.' :
    'Pulsed Starter Assist supports proportional servo/PWM starters only; relay/on-off starters are intentionally excluded.'));
  ghostSectionByTitle('Pulsed Starter Assist', starterAssistAvailable,
    'Requires a proportional servo/PWM starter output and N1 speed feedback. Relay/on-off starters are not supported.');

  ghostSectionByTitle('Automatic N2 Speed Control', hasGovernor,
    !hasGovernorRequested
      ? 'Automatic N2 speed control is not enabled in Hardware > Controllers.'
      : !hasN2
      ? 'Automatic N2 speed control requires an N2 RPM sensor.'
      : 'Automatic N2 speed control requires proportional main fuel or a supported proportional/relay prop-pitch actuator.');
  ['gv_tr','gv_bd','gv_kp'].forEach(k =>
    ghostField(k, hasGovernor, 'Automatic N2 speed control needs N2 RPM plus proportional main fuel or a supported prop-pitch actuator.'));
  ['gv_pk','gv_pr'].forEach(k =>
    ghostField(k, hasGovernor && hasProportionalPropPitch, hasProportionalPropPitch
      ? 'Automatic N2 speed control needs N2 RPM plus a usable control output.'
      : 'Prop-pitch governor fields require a proportional prop-pitch actuator in Hardware.'));

  // ── N2 / two-shaft fields ────────────────────────────────────────────────
  // N2 may be planned before a second shaft sensor is installed. Keep its
  // cluster threshold available in Explore, but inactive until N2 exists.
  setCfgFieldHardHidden('cl_n2', false);
  showField('cl_n2', true);
  ghostField('cl_n2', hasN2, 'N2 RPM sensor is not configured in Hardware.');
  const clusterSec = Array.from(document.querySelectorAll('.cfg-section'))
    .find(sec => sec.dataset.section === 'Cluster');
  if (clusterSec) {
    clusterSec.dataset.forceHidden = hasClusterSerial ? '0' : '1';
    clusterSec.dataset.inactiveReason = hasClusterSerial ? '' : 'External cluster serial is not configured in Hardware.';
    clusterSec.style.display = '';
  }
  ['rpm_limit','min_rpm','cl_n1'].forEach(k =>
    ghostField(k, hasN1, 'N1 RPM sensor is not configured in Hardware. Standard timer/TOT setup does not use this value.'));
  ghostField('n2_rpm_limit', hasN2, 'N2 RPM sensor is not configured in Hardware. This hard power-turbine shutdown limit does not apply.');
  ghostField('sf_p1t', hasP1, 'P1 pressure sensor is not configured in Hardware. This hard shutdown limit does not apply.');
  ghostField('sf_p2t', hasP2, 'P2 pressure sensor is not configured in Hardware. This hard shutdown limit does not apply.');
  ghostField('sf_tqt', hasTorque, 'Shaft-torque sensor is not configured in Hardware. This hard shutdown limit does not apply.');
  ghostField('sf_p1d', hasP1, 'Pressure 1 hard-trip confirmation has no fitted Pressure 1 input.');
  ghostField('sf_p2d', hasP2, 'Pressure 2 hard-trip confirmation has no fitted Pressure 2 input.');
  ghostField('sf_tqd', hasTorque, 'Torque hard-trip confirmation has no fitted torque input.');
  ghostField('sf_lo_d', hasOilPress, 'Low-oil confirmation has no effect without an oil-pressure sensor.');
  ghostField('sf_oz_d', hasOilPress, 'Near-zero-oil confirmation has no effect without an oil-pressure sensor.');
  ghostField('cl_tw', hasEgt, 'Cluster EGT warning needs a fitted TOT or TIT sensor.');
  ghostField('cl_ow', hasOilPress, 'Cluster oil warning needs a fitted oil pressure sensor.');

  ghostSelectOption('sf_fs', 1, hasFlame, 'Flame sensor is not configured in Hardware.');
  ghostSelectOption('sf_fs', 2, hasN1, 'N1 RPM sensor is not configured in Hardware.');
  ghostSelectOption('sf_fs', 3, hasEgt, 'No primary EGT source is configured in Hardware.');
  const hasFlameoutSource = hasFlame || hasN1 || hasEgt;
  ghostField('sf_fo', hasFlameoutSource, 'No flameout source is configured. Enable a flame sensor, N1 RPM sensor, or TOT/TIT EGT source in Hardware to unlock flameout monitoring.');
  ghostField('sf_fs', hasFlameoutSource, 'No flameout source is configured. Enable a flame sensor, N1 RPM sensor, or TOT/TIT EGT source in Hardware to unlock flameout monitoring.');
  ghostField('sf_fn', hasN1, 'N1 flameout threshold requires an N1 RPM sensor.');
  ghostField('sf_eb', hasEgt, 'The EGT flameout threshold requires a configured TOT or TIT sensor.');
  ghostField('sf_ef', hasEgt, 'The EGT flameout fall-rate condition requires a configured TOT or TIT sensor.');
  ghostSelectOption('rl_cs', 1, hasFlame, 'Flame sensor is not configured in Hardware.');
  ghostSelectOption('rl_cs', 2, hasN1, 'N1 RPM sensor is not configured in Hardware.');
  ghostSelectOption('rl_cs', 3, hasEgt, 'No primary EGT source is configured in Hardware.');
  ghostSelectOption('rl_ts', 1, hasFlame, 'Flame sensor is not configured in Hardware.');
  ghostSelectOption('rl_ts', 2, hasN1, 'N1 RPM sensor is not configured in Hardware.');
  ghostSelectOption('rl_ts', 3, hasEgt, 'No primary EGT source is configured in Hardware.');
  const relightOutputId = String((document.getElementById('cf-rl_oid') || {}).value || cfg?.relight?.output_id || '');
  const hasRelightIgnition = _installedIgnitionOutputs().some(row => String(row.id || '') === relightOutputId);
  const hasAutoRelightHardware = hasN1 && hasRelightIgnition;
  ghostField('rl_oid', hasN1 && hasAnyIgnitionOutput,
    !hasN1
      ? 'Auto-relight requires N1 RPM feedback so the ECU can prove the engine is still windmilling.'
      : 'Auto-relight requires Igniter 1, Secondary Igniter, or Glow/Wet Glow to be configured in Hardware.');
  ['rl_en','rl_ts','rl_td','rl_tb','rl_tf','rl_mr','rl_cs','rl_cr','rl_tr','rl_to'].forEach(k =>
    ghostField(k, hasAutoRelightHardware,
      !hasN1
        ? 'Auto-relight requires N1 RPM feedback so the ECU can prove the engine is still windmilling.'
        : 'Auto-relight requires the selected ignition output to be configured in Hardware.'));
  ghostField('rl_tr', hasAutoRelightHardware && hasEgt, 'EGT relight recovery requires N1, the selected ignition output, and a configured TOT or TIT sensor.');
  ghostField('rl_tb', hasAutoRelightHardware && hasEgt, 'An EGT relight trigger requires N1, the selected ignition output, and a configured TOT or TIT sensor.');
  ghostField('rl_tf', hasAutoRelightHardware && hasEgt, 'An EGT relight trigger requires N1, the selected ignition output, and a configured TOT or TIT sensor.');

  ghostSelectOption('ab_fm', 0, hasAbFlame, 'AB flame sensor is not configured in Hardware.');
  ghostSelectOption('ab_fm', 1, hasEgt, 'No primary EGT source is configured in Hardware.');
  ghostSelectOption('ab_pcm', 2, hasAbInput, 'Dedicated AB input is not configured in Hardware.');
  ['ab_mn','ab_mx'].forEach(k =>
    ghostField(k, hasN1, 'Afterburner N1 entry limits require an N1 RPM sensor.'));
  ghostField('ab_tt', hasThrottleOut && abTriggerSource === 1,
    abTriggerSource === 1
      ? 'Afterburner throttle trigger requires a fitted throttle/fuel output.'
      : 'Afterburner trigger source is not Throttle; change it in Hardware under Afterburner trigger and arm.');
  ghostField('ab_ui', hasAbIgniter, 'AB igniter output is not configured in Hardware.');
  ghostField('ab_ut', hasThrottleOut, 'Main throttle/fuel output is not configured in Hardware.');
  ghostField('ab_mt', hasEgt, 'No primary EGT source is configured in Hardware.');
  ghostField('ab_tpct', hasThrottleOut, 'Torch fuel spike requires a main throttle/fuel output.');
  ghostField('ab_tms', hasThrottleOut, 'Torch duration requires a main throttle/fuel output.');
  ghostField('ab_ttl', hasEgt && hasThrottleOut, 'Torch EGT protection needs a primary EGT source and a main fuel output.');
  ghostField('ab_tr', hasEgt, 'AB EGT-rise confirmation requires a configured TOT or TIT sensor.');
  ghostField('ab_tw', hasEgt, 'AB EGT-rise confirmation requires a configured TOT or TIT sensor.');
  ghostField('ab_smt', hasEgt, 'No primary EGT source is configured in Hardware.');
  ghostField('ab_fld', hasAbFlame, 'Running flame-loss shutdown requires a dedicated AB flame sensor.');
  const hasProportionalAbPump = hasAbPump && !isOnOffType('ab_pump');
  const relayAbPumpReason = 'The afterburner pump is configured as relay/on-off. It is ON during light-up and while the afterburner runs; percentage and command-source settings apply only to PWM or servo/ESC pumps.';
  ghostField('ab_lpp', hasProportionalAbPump, hasAbPump ? relayAbPumpReason : 'Light-up pump demand requires afterburner hardware and an AB pump output.');
  ['ab_pcm','ab_pmn','ab_pmx'].forEach(k =>
    ghostField(k, hasProportionalAbPump, hasAbPump ? relayAbPumpReason : 'AB fuel pump output is not configured in Hardware.'));
  ['ab_mo','ab_sms'].forEach(k =>
    ghostField(k, hasAbPump, 'AB fuel pump output is not configured in Hardware.'));
  // A lone igniter or flame sensor is not an operable afterburner. Apply this
  // last so individual dependency checks cannot accidentally unlock a field.
  ['Afterburner — Ignition Method','Afterburner — Flame Confirmation','Afterburner — Running'].forEach(title =>
    ghostSectionByTitle(title, hasAbFuelHardware,
      'Configure an afterburner fuel pump or fuel valve in Hardware before tuning afterburner operation.'));

  _refreshDependencyEditability();
}

// ── Re-render form when user switches units ───────────────────

// ── Shared re-render helper ──────────────────────────────
function _applyAllVisibility() {
  refreshFeatureCachesFromHardware();
  applyRcPwmVisibility();
  applyAbCfgVisibility();
  applyAbIgnitionParamVisibility();
  applyFlameoutRelightVisibility();
  applyExtSectionVisibility();
  applyHwConditions();
  applyOilMapVisibility();
  // Re-run view filter AFTER hw conditions — applyHwConditions() may un-hide expert-only
  // sections (e.g. Windmilling Oil Protection) which the basic view should still mask.
  applyView();
}

function _escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Boot: load config + hardware config, then render ────────
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

function revealConfigDeepLink() {
  const id = decodeURIComponent(String(location.hash || '').replace(/^#/, ''));
  if (!id) return;
  const target = document.getElementById(id);
  if (!target) return;
  const field = target.closest('.cfg-field');
  const revealTarget = field || target;
  const section = revealTarget.closest('.cfg-section');
  const group = revealTarget.closest('.config-group');
  const protectionCard = revealTarget.closest('.protection-card');
  const filtered = field?.classList.contains('filter-hidden') ||
    section?.classList.contains('filter-hidden') ||
    group?.classList.contains('filter-hidden');
  if (filtered || (field && _fieldIsHardwareInactive(field))) {
    setWorkspaceFilter('explore');
  }
  if (group) group.open = true;
  if (protectionCard) protectionCard.open = true;
  section?.classList.remove('filter-hidden');
  field?.classList.remove('filter-hidden');
  document.querySelectorAll('.deep-link-target').forEach(el => el.classList.remove('deep-link-target'));
  revealTarget.classList.add('deep-link-target');
  requestAnimationFrame(() => revealTarget.scrollIntoView({ behavior:'smooth', block:'center' }));
}

document.addEventListener('DOMContentLoaded', () => {
(async () => {
  // These are the ECU's two largest configuration documents and share one
  // bounded transfer buffer. Read them in order so an ordinary page open never
  // has to recover from an expected HTTP 409 collision.
  const loadedConfig = await fetchJsonWithRetry('/api/config');
  const loadedHardware = await fetchJsonWithRetry('/api/hardware');
  return [loadedConfig, loadedHardware];
})()
  .then(([c, hw]) => {
    cfg   = c;
    hwCfg = hw;
    migrateBuiltInOutputIds();
    const controllerMigrated = CONFIG_SURFACE === 'controllers' && migrateLegacyControllerDefinitions();
    renderForm();
    _applyAllVisibility();
    _clearDirty();       // baseline after dependency selectors finish normalizing
    if (controllerMigrated) {
      _controllerRulesDirty = true;
      _controllerHardwareDirty = true;
      _markDirty();
      const badge = document.getElementById('cfg-state-badge');
      if (badge) badge.textContent = 'Review migrated controls';
    }
    applyView();
    hookValidation();
    runValidation();
    if (typeof startTelemetryBoot === 'function') startTelemetryBoot();
    // Form controls are generated after load, so reveal the exact cross-page
    // destination only after rendering and dependency visibility are settled.
    revealConfigDeepLink();
    window.addEventListener('hashchange', revealConfigDeepLink);
  })
  .catch(e => {
    const msg = e && e.message ? e.message : e;
    document.getElementById('cfg-form').innerHTML =
      `<p style="color:var(--red);font-size:.85rem">Error loading config: ${_escHtml(msg || 'unknown error')}</p>`;
  });
}, { once:true });
