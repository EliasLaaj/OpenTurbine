// ------ WebSocket for engine mode ------------------------------------------------------------------------------------------------------------------------------------------
function updateEngineMode(mode) {
  engineMode = mode;
  const active = (engineMode === 'STANDBY' || engineMode === 'FAULT');
  updateSequenceSaveControls();
  if (!active) {
    setSaveStatus(`Warning: Engine is ${engineMode} - STANDBY or FAULT is required to save`);
  } else {
    const status = document.getElementById('save-status');
    if (status && /Engine is .*required to save/.test(status.textContent)) {
      setSaveStatus(_seqDirty ? 'Unsaved changes — save to apply' : 'No unsaved changes');
    }
  }
}

async function refreshEngineStatus() {
  try {
    const r = await fetch('/api/status', { cache: 'no-store' });
    if (!r.ok) { setSeqConnectionState(false, 'Disconnected'); return; }
    const d = await r.json();
    setSeqConnectionState(true, 'Connected');
    if (d.mode !== undefined) updateEngineMode(d.mode);
  } catch (_) { setSeqConnectionState(false, 'Disconnected'); }
}

let statusPollTimer = null;
let seqWsPullTimer = null;
let seqClosingForNavigation = false;
function setSeqConnectionState(ok, text) {
  const dot = document.getElementById('conn');
  const lbl = document.getElementById('conn-label');
  if (dot) dot.className = 'conn-dot ' + (ok ? 'connected' : 'disconnected');
  if (lbl) lbl.textContent = text || (ok ? 'Connected' : 'Disconnected');
}
function startStatusPoll() {
  if (statusPollTimer) return;
  refreshEngineStatus();
  statusPollTimer = setInterval(refreshEngineStatus, 3000);
}
function stopStatusPoll() {
  if (!statusPollTimer) return;
  clearInterval(statusPollTimer);
  statusPollTimer = null;
}

function startWS() {
  if (seqClosingForNavigation) return;
  if (ws && ws.readyState <= WebSocket.OPEN) return;
  ws = new WebSocket('ws://' + location.host + '/ws');
  const pull = () => { if (ws && ws.readyState === WebSocket.OPEN) ws.send('p'); };
  ws.onopen = () => {
    setSeqConnectionState(true, 'Connected');
    stopStatusPoll();
    pull();
    if (seqWsPullTimer) clearInterval(seqWsPullTimer);
    seqWsPullTimer = setInterval(pull, 1000);
  };
  ws.onmessage = e => {
    try {
      const d = JSON.parse(e.data);
      if (d.mode !== undefined) updateEngineMode(d.mode);
      if (d.seq_issues !== undefined) _applySeqValidation(d);
    } catch(_){}
  };
  ws.onclose = () => {
    if (seqWsPullTimer) { clearInterval(seqWsPullTimer); seqWsPullTimer = null; }
    setSeqConnectionState(false, 'Reconnecting');
    if (!seqClosingForNavigation) {
      startStatusPoll();
      setTimeout(startWS, 3000);
    }
  };
  ws.onerror = () => { try { ws.close(); } catch(_) {} };
}
function stopSequenceTelemetry() {
  seqClosingForNavigation = true;
  if (seqWsPullTimer) { clearInterval(seqWsPullTimer); seqWsPullTimer = null; }
  stopStatusPoll();
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
window.addEventListener('pagehide', stopSequenceTelemetry);
window.addEventListener('beforeunload', stopSequenceTelemetry);
window.addEventListener('ot:navigation-start', stopSequenceTelemetry);
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  seqClosingForNavigation = false;
  startStatusPoll();
  startWS();
});
startStatusPoll();

// ------ Sequence validation banner ---------------------------------------------------------------------------------------------------------------------------------------
function _applySeqValidation(d) {
  const issues   = d.seq_issues   || [];
  const hasErr   = d.seq_has_errors || false;
  const banner   = document.getElementById('seq-validation-banner');
  if (!banner) return;

  if (issues.length === 0) { banner.innerHTML = ''; return; }

  let html = '';
  if (hasErr) {
    html += `<div class="seq-val-start-blocked">` +
      `&#9888; START is blocked - one or more sequence errors must be resolved. ` +
      `Enable <b>Bench Mode</b> in Tools to override for testing without hardware.` +
      `</div>`;
  }
  for (const iss of issues) {
    const cls  = iss.error ? 'seq-val-error' : 'seq-val-warn';
    const icon = iss.error ? '&#10060;' : '&#9888;';
    const issueLabels = {
      AutoRelight:'Automatic Relight', Flameout:'Flameout Protection', Overtemp:'Overtemperature Protection',
      OilSafety:'Oil Protection', Battery:'Battery / Bus Protection', Governor:'Power-Turbine Governor',
      DynamicIdle:'Automatic Idle Control'
    };
    const friendlyBlock = BLOCKS[iss.block]?.label || issueLabels[iss.block] || iss.block || 'Sequence';
    const block = String(friendlyBlock).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const msg = String(iss.msg || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    html += `<div class="${cls}">` +
      `<span class="seq-val-icon">${icon}</span>` +
      `<span class="seq-val-text"><span class="seq-val-block">${block}:</span>${msg}</span>` +
      `</div>`;
  }
  banner.innerHTML = html;
}

// ------ Init ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
loadAll();
startWS();
