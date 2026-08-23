// Sequence persistence only. Custom running controllers belong to Controllers.
function validateSequenceHardwareForSave() {
  const errors = [];
  const tabs = [['Startup','startup'],['Shutdown','shutdown'],['Afterburner','afterburner'],['Afterburner shutdown','ab-shut']];
  tabs.forEach(([label, tab]) => (hwCfg[seqKey(tab)] || []).forEach((name, index) => {
    const def = BLOCKS[name] || customBlocks[name];
    if (!def) errors.push(`${label} block ${index + 1} (${name}) is unknown to this firmware.`);
    else if (def.visibleIf && !def.visibleIf(hwCfg))
      errors.push(`${label} block ${index + 1} (${def.label || name}) cannot run with the fitted hardware.`);
  }));
  return errors;
}

function validateCustomBlockLimits() {
  const entries = Object.entries(hwCfg.custom_blocks || {});
  const errors = [];
  const sensors = getEnabledSensors();
  const acts = getEnabledActuators();
  if (entries.length > MAX_CUSTOM_BLOCKS)
    errors.push(`Custom blocks: ${entries.length}/${MAX_CUSTOM_BLOCKS}. Remove ${entries.length - MAX_CUSTOM_BLOCKS} block(s).`);
  entries.forEach(([key, def]) => {
    const label = def?.label || key;
    const steps = Array.isArray(def?.steps) ? def.steps : [];
    if (key.length > MAX_CUSTOM_KEY_LEN) errors.push(`${key}: key is longer than ${MAX_CUSTOM_KEY_LEN} characters.`);
    if ((def?.label || '').length > MAX_CUSTOM_LABEL_LEN) errors.push(`${label}: label is longer than ${MAX_CUSTOM_LABEL_LEN} characters.`);
    if ((def?.desc || '').length > MAX_CUSTOM_DESC_LEN) errors.push(`${label}: description is longer than ${MAX_CUSTOM_DESC_LEN} characters.`);
    if (steps.length > MAX_CUSTOM_STEPS) errors.push(`${label}: ${steps.length}/${MAX_CUSTOM_STEPS} steps.`);
    if (def?.type === 'action' && !steps.length) errors.push(`${label}: action block has no steps.`);
    if (def?.type === 'while' && !sensors.some(sensor => sensor.key === def?.condition?.sensor))
      errors.push(`${label}: condition sensor is not configured.`);
    steps.forEach((step, index) => {
      if (step?.type === 'set_act' && !acts.some(act => act.key === step.act))
        errors.push(`${label}: step ${index + 1} actuator is not configured.`);
    });
    if (!['action','wait','while'].includes(def?.type)) errors.push(`${label}: unknown custom block type.`);
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
  ['startup','shutdown','afterburner','ab-shut'].forEach(ensureActionSlots);
  try {
    // Merge only this page's changes onto the latest complete engine file.
    const latestHw = await fetchJsonWithRetry('/api/hardware');
    const latestCfg = await fetchJsonWithRetry('/api/config');
    hwCfg = mergeSequenceEdits(loadedHwCfg, hwCfg, latestHw);
    cfg = mergeSequenceEdits(loadedCfg, cfg, latestCfg);
    delete hwCfg._i2c_discovery;
  } catch (error) {
    setSaveStatus('Warning: Could not refresh engine file: ' + error.message);
    return;
  }
  const customErrors = validateCustomBlockLimits();
  if (customErrors.length) {
    setSaveStatus('Warning: Custom block setup needs attention');
    await OTDialog.alert('Custom block setup needs attention:\n\n' + customErrors.map(e => '- ' + e).join('\n'), {title:'Custom blocks need attention'});
    return;
  }
  const hardwareErrors = validateSequenceHardwareForSave();
  if (hardwareErrors.length) {
    setSaveStatus('Warning: Sequence contains blocks with missing hardware');
    await OTDialog.alert('Sequence hardware mismatch:\n\n' + hardwareErrors.map(e => '- ' + e).join('\n') + '\n\nRestore the required devices in Hardware or remove these blocks before saving.', {title:'Sequence needs hardware'});
    return;
  }
  const startup = hwCfg.startup_seq || [];
  if (!startup.length) {
    setSaveStatus('Warning: Startup sequence is empty');
    await OTDialog.alert('Add the startup actions and waits your turbine needs before saving.', {title:'Startup sequence is empty'});
    return;
  }
  const warnings = _validateSequence(startup);
  if (warnings.length && !await OTDialog.confirm('Sequence warnings:\n\n' + warnings.map(w => '- ' + w).join('\n') + '\n\nSave anyway?', {title:'Sequence safety warnings', confirmText:'Save anyway', danger:true})) return;
  setSaveStatus('Saving engine file...');
  try {
    if (typeof stopSequenceTelemetry === 'function') stopSequenceTelemetry();
    await new Promise(resolve => setTimeout(resolve, 250));
    const response = await fetch('/api/ecu_config', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({hardware:hwCfg, settings:cfg})});
    const result = await response.json();
    if (!response.ok || !result.ok) {
      setSaveStatus('Warning: Save failed: ' + (result.error || response.status));
      return;
    }
    if (window.OTSetup) OTSetup.mark('sequence');
    clearSequenceDirty('Saved — rebooting…');
    if (result.reboot) startRebootCountdown();
  } catch (error) {
    setSaveStatus('Warning: ' + error.message);
  }
}

function startRebootCountdown() {
  const overlay = document.getElementById('reboot-overlay');
  const count = document.getElementById('reboot-count');
  overlay?.classList.add('show');
  let remaining = 10;
  if (count) count.textContent = remaining;
  const timer = setInterval(() => {
    remaining--;
    if (count) count.textContent = remaining;
    if (remaining <= 0) { clearInterval(timer); reconnect(); }
  }, 1000);
}

function reconnect(attempts = 0) {
  fetch('/api/data').then(response => {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    document.getElementById('reboot-overlay')?.classList.remove('show');
    return loadAll();
  }).then(() => startSequenceTelemetryForPlatform()).catch(() => {
    if (attempts < 20) setTimeout(() => reconnect(attempts + 1), 1000);
    else if (document.getElementById('reboot-count')) document.getElementById('reboot-count').textContent = 'Reload page';
  });
}

function setSaveStatus(message) {
  const status = document.getElementById('save-status');
  if (status) status.textContent = message;
}

function updateSequenceSaveControls() {
  const save = document.getElementById('save-btn');
  const discard = document.getElementById('seq-discard-btn');
  if (save) save.disabled = !_seqDirty || (engineMode !== 'STANDBY' && engineMode !== 'FAULT');
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
  if (!await OTDialog.confirm('Discard every unsaved sequence change?', {title:'Discard changes?', confirmText:'Discard', danger:true})) return;
  await loadAll();
}
