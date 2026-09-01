// System-owned backup, restore, runtime diagnostics, and factory reset.
// Kept out of Tools so that page remains a focused commissioning workspace.
(function () {
  if (CONFIG_SURFACE !== 'system') return;

  let maintenanceMode = 'UNKNOWN';
  let diagnosticsTimer = null;
  let diagnosticsBusy = false;
  let configReady = false;
  const standbyLike = () => maintenanceMode === 'STANDBY' || maintenanceMode === 'FAULT';
  const byId = id => document.getElementById(id);
  const setText = (id, value) => { const el = byId(id); if (el) el.textContent = value; };
  const showMessage = (text, color = 'var(--dim)') => {
    const el = byId('cfg-backup-msg');
    if (!el) return;
    el.textContent = text;
    el.style.color = color;
    el.style.display = text ? '' : 'none';
  };

  function renderMaintenance() {
    const root = byId('system-maintenance');
    if (!root) return;
    root.innerHTML = `
      <details class="config-group" id="system-maintenance-group" data-always-visible="1">
        <summary>
          <span class="group-heading"><span class="group-title">Backup, diagnostics &amp; reset</span><span class="group-desc">Complete engine files, live ECU timing, and recovery</span></span>
          <span class="group-meta">3 items</span><span class="group-chevron">›</span>
        </summary>
        <div class="group-content system-maintenance-grid">
          <section class="maintenance-card" id="card-CONFIG_BACKUP" title="Export or restore the complete engine configuration while the engine is stopped.">
            <div class="maintenance-head"><span class="maintenance-title">Engine File Backup &amp; Restore</span><span class="maintenance-state" id="cfg-backup-state">Ready</span></div>
            <div class="maintenance-desc">Download one complete engine file containing hardware assignments, settings, sequences, and calibration, or restore one previously saved. Restore is available only in STANDBY or FAULT. The file includes the Wi-Fi password, so review it before sharing.</div>
            <div class="maintenance-actions">
              <button id="cfg-backup-btn" onclick="systemBackupConfig()" title="Download the complete current engine setup as JSON.">Download engine file</button>
              <label style="cursor:pointer"><input type="file" id="cfg-restore-file" accept=".json" style="display:none" onchange="systemRestoreConfig(this)"><button id="cfg-restore-btn" onclick="document.getElementById('cfg-restore-file').click()" title="Replace the current setup with a complete OpenTurbine engine file and reboot.">Restore engine file…</button></label>
            </div>
          </section>

          <section class="maintenance-card" id="loop-diag-card" title="Live main-loop timing. Timing is diagnostic only and never changes the control-loop priority.">
            <div class="maintenance-head"><span class="maintenance-title">ECU Loop Timing</span><span class="maintenance-state">Live · 2 s refresh</span></div>
            <div class="maintenance-desc">Confirms that the real-time engine-control loop is meeting its schedule. Worst cycle includes scheduling; missed deadlines count loop bodies longer than the configured period.</div>
            <div class="maintenance-metrics">
              <div class="maintenance-metric"><span>Loop rate</span><strong id="diag-loop-hz">—</strong></div>
              <div class="maintenance-metric"><span>Period</span><strong id="diag-loop-period">—</strong></div>
              <div class="maintenance-metric"><span>Worst cycle</span><strong id="diag-loop-period-max">—</strong></div>
              <div class="maintenance-metric"><span>Execution average</span><strong id="diag-loop-avg">—</strong></div>
              <div class="maintenance-metric"><span>Execution maximum</span><strong id="diag-loop-max">—</strong></div>
              <div class="maintenance-metric"><span>Missed deadlines</span><strong id="diag-loop-overruns">—</strong></div>
              <div class="maintenance-metric"><span>Sensors</span><strong id="diag-loop-sensors">—</strong></div>
              <div class="maintenance-metric"><span>Sequencer</span><strong id="diag-loop-sequencer">—</strong></div>
              <div class="maintenance-metric"><span>Controllers</span><strong id="diag-loop-controllers">—</strong></div>
              <div class="maintenance-metric"><span>Actuators</span><strong id="diag-loop-actuators">—</strong></div>
              <div class="maintenance-metric"><span>Logging</span><strong id="diag-loop-logging">—</strong></div>
              <div class="maintenance-metric"><span>Status LED</span><strong id="diag-loop-led">—</strong></div>
            </div>
          </section>

          <section class="maintenance-card maintenance-danger" id="card-factory-reset">
            <div class="maintenance-head"><span class="maintenance-title">Factory Reset</span><span class="maintenance-state" id="state-factory-reset">STANDBY / FAULT only</span></div>
            <div class="maintenance-desc">Erases the turbine setup, hardware assignments, calibration, Wi-Fi password, and logs, then reboots. An installed PCB profile is preserved because it describes the physical board. After reset, only safe defaults explicitly supplied by that profile are assigned; other turbine devices must be configured in Hardware. A separately installed factory engine file, when present, supplies the full reset setup.</div>
            <div class="maintenance-actions"><button onclick="systemFactoryReset()" class="danger" id="btn-factory-reset" title="Erase the turbine setup and logs while preserving the installed physical PCB profile.">Factory reset…</button></div>
          </section>
          <div id="cfg-backup-msg" class="maintenance-message" aria-live="polite"></div>
        </div>
      </details>`;
    updateMaintenanceLocks();
  }

  function updateMaintenanceLocks() {
    const allowed = standbyLike();
    const restore = byId('cfg-restore-btn');
    const reset = byId('btn-factory-reset');
    if (restore) restore.disabled = !allowed;
    if (reset) reset.disabled = !allowed;
    setText('state-factory-reset', allowed ? 'Ready' : `Locked · ${maintenanceMode}`);
  }

  function applyDiagnostics(d) {
    maintenanceMode = d.mode || maintenanceMode;
    updateMaintenanceLocks();
    const ms = value => Number.isFinite(Number(value)) ? Number(value).toFixed(3) + ' ms' : '—';
    const integer = value => Number.isFinite(Number(value)) ? Math.round(Number(value)).toLocaleString() : '—';
    setText('diag-loop-hz', Number.isFinite(Number(d.loop_hz)) ? Number(d.loop_hz).toFixed(1) + ' Hz' : '—');
    setText('diag-loop-period', Number.isFinite(Number(d.loop_period_ms)) ? Number(d.loop_period_ms).toFixed(2) + ' ms' : '—');
    setText('diag-loop-period-max', ms(d.loop_period_max_ms));
    setText('diag-loop-avg', ms(d.loop_exec_avg_ms));
    setText('diag-loop-max', ms(d.loop_exec_max_ms));
    setText('diag-loop-overruns', integer(d.loop_overrun_count));
    setText('diag-loop-sensors', ms(d.loop_sensors_ms));
    setText('diag-loop-sequencer', ms(d.loop_sequencer_ms));
    setText('diag-loop-controllers', ms(d.loop_controllers_ms));
    setText('diag-loop-actuators', ms(d.loop_actuators_ms));
    setText('diag-loop-logging', ms(d.loop_logging_ms));
    setText('diag-loop-led', ms(d.loop_led_ms));
  }

  async function pollDiagnostics() {
    // Do not overlap the two large documents loaded by this page. On the
    // Classic, avoiding that overlap is more important than early diagnostics.
    if (diagnosticsBusy || document.hidden || !configReady) return;
    diagnosticsBusy = true;
    try {
      const response = await fetch('/api/loop_diagnostics', {cache:'no-store'});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      applyDiagnostics(await response.json());
    } catch (_) {
      setText('state-factory-reset', 'Connection unavailable');
    } finally {
      diagnosticsBusy = false;
    }
  }

  function stopDiagnostics() {
    if (diagnosticsTimer) clearInterval(diagnosticsTimer);
    diagnosticsTimer = null;
  }

  function startDiagnostics() {
    if (diagnosticsTimer) return;
    configReady = true;
    pollDiagnostics();
    diagnosticsTimer = setInterval(pollDiagnostics, 2000);
  }

  async function systemBackupConfig() {
    const button = byId('cfg-backup-btn');
    if (button) button.disabled = true;
    stopDiagnostics();
    showMessage('Preparing complete engine file…');
    try {
      let engineFile;
      let lastError;
      for (let attempt = 0; attempt < 3 && !engineFile; attempt++) {
        try {
          const response = await fetch('/api/ecu_config', {cache:'no-store'});
          if (!response.ok) throw new Error('HTTP ' + response.status);
          engineFile = JSON.parse(await response.text());
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)));
        }
      }
      if (!engineFile) throw lastError || new Error('No response');
      const statusResponse = await fetch('/api/status', {cache:'no-store'});
      const status = statusResponse.ok ? await statusResponse.json() : {};
      engineFile._backup_meta = {
        timestamp:new Date().toISOString(),
        fw_version:status.fw_version || 'unknown',
        profile:(engineFile.hardware || {}).profile_id || 'unknown',
        uptime_s:status.uptime_s || 0
      };
      const blob = new Blob([JSON.stringify(engineFile, null, 2)], {type:'application/json'});
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const profile = String(engineFile._backup_meta.profile || 'OpenTurbine').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'OpenTurbine';
      const profilePart = /^openturbine$/i.test(profile) ? '' : profile + '_';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'OpenTurbine_' + profilePart + stamp + '.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setText('cfg-backup-state', 'Downloaded');
      showMessage('Download started. Confirm the file appears in Downloads before relying on it.', 'var(--green)');
    } catch (error) {
      setText('cfg-backup-state', 'Error');
      showMessage('Backup failed: ' + error.message, 'var(--red)');
    } finally {
      if (button) button.disabled = false;
      diagnosticsTimer = setInterval(pollDiagnostics, 2000);
    }
  }

  function compactEngineFile(text) {
    const root = JSON.parse(text);
    const registry = root?.hardware?.channel_registry;
    const defaults = {pulses_per_unit:1,analog_zero_mv:0,analog_mv_per_unit:1000,analog_divider:1,digital_threshold_raw:2048,digital_hysteresis_raw:64,torque_interface:0,hx711_clk:-1,hx711_scale:1,hx711_zero:0,temp_interface:0,spi_clk:-1,spi_cs:-1,spi_miso:-1,spi_mosi:-1,tc_type:'K',temp_resolution:10,ntc_beta:3950,ntc_r0:10000,ntc_r_fixed:10000,ntc_pullup:true,safe_demand:0,force_safe_on_fault:false,min_run_demand:0,pwm_freq_hz:5000,pwm_res_bits:10,invert:false,pullup:false,pulldown:false,has_current:false,current_pin:-1,current_mv_a:100,current_zero_v:1.65,current_max_a:0,has_flow_monitor:false,minimum_flow_l_min:0};
    for (const channel of [...(registry?.inputs || []), ...(registry?.outputs || [])]) {
      if (!channel || typeof channel !== 'object') continue;
      for (const [key, value] of Object.entries(defaults)) if (Object.is(channel[key], value)) delete channel[key];
    }
    return JSON.stringify(root);
  }

  async function systemRestoreConfig(input) {
    const file = input.files[0];
    if (!file) return;
    if (!standbyLike()) {
      alert('Engine must be in STANDBY or FAULT to restore an engine file.');
      input.value = '';
      return;
    }
    if (!await OTDialog.confirm('Restore complete engine file from "' + file.name + '"?\n\nThis replaces hardware assignments, settings, sequences, calibration, profile/Wi-Fi details, and runtime statistics, then reboots. Current event and session logs remain.', {title:'Restore complete engine file?', confirmText:'Restore and reboot', danger:true})) {
      input.value = '';
      return;
    }
    stopDiagnostics();
    if (typeof stopGlobalTelemetry === 'function') stopGlobalTelemetry();
    const button = byId('cfg-restore-btn');
    if (button) button.disabled = true;
    setText('cfg-backup-state', 'Restoring…');
    try {
      const payload = compactEngineFile(await file.text());
      let response;
      try {
        response = await fetch('/api/ecu_config', {method:'POST', headers:{'Content-Type':'application/json'}, body:payload});
      } catch (postError) {
        // A successful restore reboots immediately and can close the response.
        // Never repeat this mutation: observe one disconnect/reconnect cycle.
        setText('cfg-backup-state', 'Checking after restart…');
        let sawDisconnect = false;
        let recovered = false;
        for (let attempt = 0; attempt < 45; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          try {
            const status = await fetch('/api/status', {cache:'no-store'});
            if (status.ok && sawDisconnect) { recovered = true; break; }
          } catch (_) { sawDisconnect = true; }
        }
        if (!recovered) throw new Error(sawDisconnect
          ? 'The ECU restarted but did not reconnect. Rejoin its Wi-Fi and verify the setup before trying again.'
          : 'The restore response was lost. It was not sent again because repeating a restore may reboot the ECU twice. Reconnect and verify the current setup.');
        response = new Response(JSON.stringify({ok:true,recovered:true}), {status:200, headers:{'Content-Type':'application/json'}});
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result.error || result.reason || ('HTTP ' + response.status));
      setText('cfg-backup-state', 'Done · rebooting');
      showMessage('Engine file restored. The ECU is rebooting.', 'var(--green)');
    } catch (error) {
      setText('cfg-backup-state', 'Error');
      showMessage('Restore failed: ' + error.message, 'var(--red)');
      if (button) button.disabled = false;
    }
    input.value = '';
  }

  async function systemFactoryReset() {
    if (!standbyLike()) return;
    if (!await OTDialog.confirm('Factory reset permanently erases the turbine setup, assignments, calibration, Wi-Fi password, and logs. The installed physical PCB profile is preserved.\n\nDownload an engine file first if this setup may be needed.', {title:'Factory reset this ECU?', confirmText:'Continue', danger:true})) return;
    const typed = await OTDialog.prompt('Type RESET to erase the setup and reboot.', {title:'Final factory-reset confirmation', confirmText:'Erase and reset', placeholder:'RESET'});
    if (typed !== 'RESET') return;
    const button = byId('btn-factory-reset');
    if (button) button.disabled = true;
    showMessage('Sending factory reset…', 'var(--yellow)');
    try {
      const response = await fetch('/api/factory_reset', {method:'POST'});
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result.error || result.reason || ('HTTP ' + response.status));
      showMessage('Reset accepted. The ECU is rebooting…', 'var(--yellow)');
      setTimeout(() => location.reload(), 8000);
    } catch (error) {
      showMessage('Factory reset failed: ' + error.message, 'var(--red)');
      if (button) button.disabled = false;
    }
  }

  window.systemBackupConfig = systemBackupConfig;
  window.systemRestoreConfig = systemRestoreConfig;
  window.systemFactoryReset = systemFactoryReset;

  document.addEventListener('DOMContentLoaded', () => {
    renderMaintenance();
    document.addEventListener('ot:config-loaded', startDiagnostics, {once:true});
    // A very fast cached config load can complete before this page-owned
    // listener is installed. The delayed fallback is intentionally later than
    // both large startup reads and starts the same single small request path.
    setTimeout(startDiagnostics, 5000);
    if (location.hash === '#system-maintenance') byId('system-maintenance-group').open = true;
  }, {once:true});
  window.addEventListener('pagehide', stopDiagnostics);
  window.addEventListener('ot:navigation-prepare', stopDiagnostics);
})();
