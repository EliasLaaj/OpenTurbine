// Sequence persistence only. Custom running controllers belong to Controllers.
function validateSequenceHardwareForSave() {
  const errors = [];
  const tabs = [['Startup','startup'],['Shutdown','shutdown'],['Afterburner','afterburner'],['Afterburner shutdown','ab-shut']];
  tabs.forEach(([label, tab]) => (hwCfg[seqKey(tab)] || []).forEach((name, index) => {
    const def = BLOCKS[name] || customBlocks[name];
    if (!def) errors.push(`${label} block ${index + 1} (${name}) is unknown to this firmware.`);
    else if (!BLOCK_OUTPUT_PURPOSES[name] && def.visibleIf && !def.visibleIf(hwCfg))
      errors.push(`${label} block ${index + 1} (${def.label || name}) cannot run with the fitted hardware.`);
    if (BLOCK_OUTPUT_PURPOSES[name]) {
      ensureDeviceTargetSlots(tab);
      const target = String(hwCfg[deviceTargetSeqKey(tab)]?.[index] || '');
      const choices = compatibleBlockOutputs(name);
      if (!target)
        errors.push(`${label} block ${index + 1} (${def?.label || name}) needs an output device.`);
      else if (!choices.some(output => String(output.id || '') === target))
        errors.push(`${label} block ${index + 1} (${def?.label || name}) references missing output "${target}".`);
    }
    if (name === 'SetOutput') {
      const action = setOutputAction(tab, index);
      const target = String(action?.target || ACT_KEY_BY_ENUM[Number(action?.act)] || '');
      if (!action)
        errors.push(`${label} block ${index + 1} (Set Output) needs an output device.`);
      else if (!sideActionMeta(action))
        errors.push(`${label} block ${index + 1} (Set Output) references missing output "${target || 'unknown'}".`);
    }
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
    if (def?.type === 'while' && !sensors.some(sensor =>
      sensor.key === def?.condition?.sensor || sensor.source === def?.condition?.source))
      errors.push(`${label}: condition sensor is not configured.`);
    steps.forEach((step, index) => {
      if (step?.type === 'set_act' && !acts.some(act =>
        act.key === step.act && (!step.target || act.target === step.target)))
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
    if (typeof window.OTWaitForPageTelemetryIdle === 'function') {
      const idle = await window.OTWaitForPageTelemetryIdle(2500);
      if (!idle) throw new Error('Live sequence status did not become idle; save was not started');
    }
    await new Promise(resolve => setTimeout(resolve, 150));
    const settingsPatch = mergeSequenceEdits(loadedCfg, cfg, {});
    const hardwareKeys = [
      'startup_seq','shutdown_seq','ab_seq','ab_shut_seq',
      'startup_delay_ms','shutdown_delay_ms','ab_delay_ms','ab_shut_delay_ms',
      'startup_ignition_target','shutdown_ignition_target','ab_ignition_target','ab_shut_ignition_target',
      'startup_device_target','shutdown_device_target','ab_device_target','ab_shut_device_target',
      'startup_enter_actions','startup_exit_actions','shutdown_enter_actions','shutdown_exit_actions',
      'ab_enter_actions','ab_exit_actions','ab_shut_enter_actions','ab_shut_exit_actions',
      'custom_blocks','ab_trigger'
    ];
    const hardwarePatch = {};
    hardwareKeys.forEach(key => {
      if (JSON.stringify(loadedHwCfg[key]) !== JSON.stringify(hwCfg[key]) && hwCfg[key] !== undefined)
        hardwarePatch[key] = cloneSequenceJson(hwCfg[key]);
    });
    const hardwareReboot = Object.keys(hardwarePatch).length > 0;
    if (hardwareReboot) {
      const response = await fetch('/api/hardware?source=sequence', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(hardwarePatch)});
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false)
        throw new Error(result.error || result.detail || `Hardware HTTP ${response.status}`);
    }
    let settingsReboot = false;
    if (Object.keys(settingsPatch).length) {
      if (hardwareReboot) {
        setSaveStatus('Sequence hardware saved — reconnecting to save page settings…');
        await window.OTWaitForSaveRestart();
      }
      const settingsResponse = await fetch('/api/config', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(settingsPatch)});
      const settingsResult = await settingsResponse.json().catch(() => ({}));
      if (!settingsResponse.ok || settingsResult.ok === false)
        throw new Error(settingsResult.error || settingsResult.reason || `Settings HTTP ${settingsResponse.status}`);
      settingsReboot = settingsResult.reboot === true;
    }
    const rebooting = hardwareReboot || settingsReboot;
    if (window.OTSetup) OTSetup.mark('sequence');
    clearSequenceDirty(rebooting ? 'Saved — rebooting…' : 'Saved');
    if (rebooting) startRebootCountdown();
    else {
      loadedCfg = cloneSequenceJson(cfg);
      startSequenceTelemetryForPlatform();
    }
  } catch (error) {
    setSaveStatus('Warning: ' + error.message);
  }
}

function startRebootCountdown() {
  if (typeof window.OTShowRebootOverlay === 'function') {
    window.OTShowRebootOverlay({returnPath:'/sequence.html'});
    return;
  }
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

window.addEventListener('beforeunload', event => {
  if (!_seqDirty) return;
  event.preventDefault();
  event.returnValue = '';
});
document.addEventListener('click', async event => {
  const link = event.target.closest?.('a[href]');
  if (!link || !_seqDirty || event.defaultPrevented || event.button !== 0 ||
      event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === '_blank') return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
  event.preventDefault();
  if (await OTDialog.confirm('Sequence has unsaved changes. Leave and discard them?',
      {title:'Unsaved sequence changes', confirmText:'Discard and leave', danger:true})) {
    clearSequenceDirty();
    location.href = url.href;
  }
}, true);

async function discardSequenceChanges() {
  if (!_seqDirty) return;
  if (!await OTDialog.confirm('Discard every unsaved sequence change?', {title:'Discard changes?', confirmText:'Discard', danger:true})) return;
  await loadAll();
}
