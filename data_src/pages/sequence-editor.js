// Shared HTML-escape for every card/params/selector renderer in this page.
// (Was previously a local inside buildCard, which left buildParamsHtml's
// uses unresolved — a ReferenceError that blanked the whole sequence list.)
function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function setOutputAction(tab, idx) {
  ensureActionSlots(tab);
  return hwCfg[actionKey(tab, 'enter')]?.[idx]?.[0] || null;
}

function sequenceBlockLabel(bname, tab, idx) {
  if (bname !== 'SetOutput') return (BLOCKS[bname] || customBlocks[bname])?.label ?? bname;
  const meta = sideActionMeta(setOutputAction(tab, idx));
  return meta ? `Set ${meta.label}` : 'Set Output';
}

function buildCard(bname, idx, tab) {
  const def = BLOCKS[bname] || customBlocks[bname];
  const card = document.createElement('div');
  const setOutputMissing = bname === 'SetOutput' && !sideActionMeta(setOutputAction(tab, idx));
  const hardwareMissing = !def || setOutputMissing || !!(def.visibleIf && !def.visibleIf(hwCfg));
  card.className = `block-card${hardwareMissing ? ' block-hardware-missing' : ''}`;
  card.dataset.block = bname;
  card.dataset.idx   = idx;
  card.dataset.tab   = tab;

  // Build condition text for WHILE blocks
  const hw = flattenHw();
  const condText = bname === 'TimedDelay'
    ? `${seqRound(timedDelayValue(tab, idx) / 1000)} s`
    : (def ? (def.condition ? def.condition(hw) : null) : null);

  // Timeout badge
  let toPill = '';
  if (def?.timeout_action === 'fault')    toPill = `<span class="timeout-pill fault">timer FAULT</span>`;
  else if (def?.timeout_action === 'abort')   toPill = `<span class="timeout-pill abort">timer ABORT</span>`;
  else if (def?.timeout_action === 'continue')toPill = `<span class="timeout-pill cont">timer continue</span>`;
  else if (def?.timeout_action === 'complete')toPill = `<span class="timeout-pill cont">timer completes</span>`;

  const badge = def ? `<span class="block-badge ${esc(def.badgeClass)}">${esc(def.type.toUpperCase())}</span>` : '';
  const condHtml = condText ? `<span class="block-cond">${esc(condText)}</span>` : '';
  card.innerHTML = `
  <div class="block-header" title="${esc(def?.desc || 'Sequence block')}" onclick="toggleParams(this)">
    ${badge}
    <span class="block-name">${esc(sequenceBlockLabel(bname, tab, idx))}</span>
    ${condHtml}
    ${toPill}
    ${hardwareMissing ? `<span class="block-hardware-pill">${def ? 'Missing hardware' : 'Unknown block'}</span>` : ''}
    <div class="block-actions" onclick="event.stopPropagation()">
      <button type="button" class="blk-btn drag-handle" title="Drag to reorder; arrow keys also work" aria-label="Drag to reorder block; use up and down arrow keys"><span class="drag-grip" aria-hidden="true"></span></button>
      ${customBlocks[bname] ? `<button class="blk-btn" onclick="editCustomBlock('${bname}','${tab}')">Edit</button>` : ''}
      <button type="button" class="blk-btn bip-btn" aria-label="Explain ${esc(def?.label ?? bname)}" aria-expanded="false" title="Explain this block" onclick="showBlockInfo('${bname}',this)">?</button>
      <button class="blk-btn del" title="Remove this sequence block" aria-label="Remove this sequence block" onclick="removeBlock('${tab}',${idx})">Remove</button>
    </div>
  </div>
  <div class="block-info-panel" hidden></div>
  ${buildParamsHtml(bname, idx, tab)}`;

  wireBlockDragHandle(card, tab, idx);

  return card;
}

function wireBlockDragHandle(card, tab, originalIdx) {
  const handle = card.querySelector('.drag-handle');
  if (!handle) return;
  handle.addEventListener('keydown', event => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    moveBlock(tab, originalIdx, event.key === 'ArrowUp' ? -1 : 1);
  });
  handle.addEventListener('pointerdown', event => {
    if (event.button !== undefined && event.button !== 0) return;
    const list = card.parentElement;
    if (!list) return;
    event.preventDefault();
    event.stopPropagation();
    card.classList.add('block-dragging');

    const move = pointerEvent => {
      pointerEvent.preventDefault();
      const target = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest('.block-card');
      if (!target || target === card || target.parentElement !== list) return;
      const bounds = target.getBoundingClientRect();
      list.insertBefore(card, pointerEvent.clientY < bounds.top + bounds.height / 2 ? target : target.nextSibling);
    };
    const finish = pointerEvent => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      card.classList.remove('block-dragging');
      const newIdx = Array.from(list.children).filter(node => node.classList?.contains('block-card')).indexOf(card);
      if (newIdx >= 0 && newIdx !== originalIdx) moveBlockTo(tab, originalIdx, newIdx);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  });
}

function buildSideActionsHtml(tab, idx) {
  ensureActionSlots(tab);
  const acts = getEnabledActuators();
  const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const phaseHtml = (phase, title) => {
    const key = actionKey(tab, phase);
    const allRows = hwCfg[key]?.[idx] || [];
    const offset = phase === 'enter' && hwCfg[seqKey(tab)]?.[idx] === 'SetOutput' ? 1 : 0;
    const rows = allRows.map((a, ai) => ({a, ai})).filter(row => row.ai >= offset && actionAllowed(row.a));
    const rowHtml = rows.map(row => {
      const a = row.a;
      const ai = row.ai;
      const selectedMeta = sideActionMeta(a);
      const missingTarget = !selectedMeta ? String(a.target || ACT_KEY_BY_ENUM[Number(a.act)] || 'unknown') : '';
      const missingOption = missingTarget ? `<option value="${esc(missingTarget)}" selected disabled>Missing output: ${esc(missingTarget)}</option>` : '';
      const opts = missingOption + acts.map(meta => `<option value="${esc(meta.target)}" ${selectedMeta && String(meta.target)===String(selectedMeta.target)?'selected':''}>${esc(meta.label)}</option>`).join('');
      const val = actionDisplayValue(a, a.value);
      const valCtrl = !selectedMeta
        ? `<input class="param-input" type="text" value="Unavailable until an output is selected" disabled>`
        : selectedMeta.mode === 'pct'
        ? `<div style="display:flex;align-items:center;gap:.35rem"><input class="param-input" style="flex:1" type="number" min="0" max="100" step="1" value="${val}" aria-label="Output demand from 0 to 100 percent" oninput="updateSideAction('${tab}',${idx},'${phase}',${ai},null,this.value)"><span class="param-label" title="Full output range is 0 to 100 percent">%</span></div>`
        : `<select class="param-input" onchange="updateSideAction('${tab}',${idx},'${phase}',${ai},null,this.value)">
             <option value="1" ${val ? 'selected' : ''}>ON</option>
             <option value="0" ${!val ? 'selected' : ''}>OFF</option>
           </select>`;
      return `<div class="param-field">
        <span class="param-label">Also set</span>
        <select class="param-input" onchange="updateSideAction('${tab}',${idx},'${phase}',${ai},this.value,null)">${opts}</select>
        <span class="param-label">${selectedMeta?.mode === 'pct' ? 'Demand (0–100%)' : 'State'}</span>
        ${valCtrl}
        <button class="blk-btn del" type="button" onclick="removeSideAction('${tab}',${idx},'${phase}',${ai})">Remove</button>
      </div>`;
    }).join('');
    const canAdd = allRows.length < 4;
    return `<div style="margin-top:.55rem">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:.6rem;margin-bottom:.25rem">
        <span class="param-label">${title}</span>
        <button class="blk-btn" type="button" onclick="addSideAction('${tab}',${idx},'${phase}')" ${canAdd?'':'disabled'}>+ Action</button>
      </div>
      ${rowHtml || `<div style="font-size:.68rem;color:var(--dim)">No simultaneous output actions.</div>`}
    </div>`;
  };
  return `<div class="side-actions">
    ${phaseHtml('enter', 'At block start')}
    ${phaseHtml('exit', 'After block completes')}
  </div>`;
}

function addSideAction(tab, idx, phase) {
  ensureActionSlots(tab);
  const acts = getEnabledActuators();
  if (!acts.length) return;
  const key = actionKey(tab, phase);
  const rows = hwCfg[key][idx];
  if (rows.length >= 4) return;
  const first = acts[0];
  rows.push({ act: first.actuator, target:first.target, value: first.mode === 'pct' ? 0.5 : 1 });
  renderFast(tab);
}

function removeSideAction(tab, idx, phase, actionIdx) {
  ensureActionSlots(tab);
  const key = actionKey(tab, phase);
  hwCfg[key]?.[idx]?.splice(actionIdx, 1);
  renderFast(tab);
}

function updateSideAction(tab, idx, phase, actionIdx, newAct, newValue) {
  ensureActionSlots(tab);
  const key = actionKey(tab, phase);
  const row = hwCfg[key]?.[idx]?.[actionIdx];
  if (!row) return;
  let needsRender = false;
  if (newAct !== null && newAct !== undefined) {
    const previousMeta = sideActionMeta(row);
    const previousDisplay = actionDisplayValue(row, row.value);
    const meta = getEnabledActuators().find(a => String(a.target || '') === String(newAct || ''));
    if (!meta) return;
    row.act = meta.actuator;
    row.target = meta.target;
    // A Boolean ON and a proportional 1%/100% command are not interchangeable.
    // Preserve only transitions with the same electrical semantics; otherwise
    // reset to the de-energized value and require a deliberate new command.
    row.value = previousMeta?.mode === meta.mode ? actionStoredValue(row, previousDisplay) : 0;
    needsRender = true;
  }
  if (newValue !== null && newValue !== undefined) {
    row.value = actionStoredValue(row, newValue);
  }
  if (needsRender) renderFast(tab);
  else markSequenceDirty('Sequence edited — save to apply');
}

// Flatten relevant hw/config values for condition labels
function flattenHw() {
  const su = cfg?.sequence?.startup ?? {};
  const sd = cfg?.sequence?.shutdown ?? {};
  const en = cfg?.engine ?? {};
  const ms = cfg?.misc ?? {};
  return {
    oil_arm_min_bar:      paramVals['OilPrime.oil_arm_min_bar'] ?? 1.5,
    pre_ign_rpm:          su.pre_ign_rpm ?? 5000,
    flame_required_count: su.flame_required_count ?? 3,
    post_ign_dwell_ms:    ms.post_ign_dwell_ms ?? su.post_ign_dwell_ms ?? 1000,
    timed_delay_ms:       paramVals['TimedDelay.timed_delay_ms'] ?? 1000,
    temp_confirm_target:  paramVals['TempConfirm.temp_confirm_target'] ?? 200,
    rpm_target:           su.rpm_target ?? 32000,
    safety_hold_ms:       su.safety_hold_ms ?? 1000,
    rpm_drop_threshold:   sd.rpm_drop_threshold ?? 5000,
    tot_cooldown_target:  en.tot_cooldown_target ?? 150,
    rpm_zero_threshold:   sd.rpm_zero_threshold ?? 100,
    wait_for_input_ch:    su.wait_for_input_ch ?? 0,
    wait_for_input_state: su.wait_for_input_state !== false,
    fuel_pulse_ms:        paramVals['FuelPulse.fuel_pulse_ms']   ?? 200,
    wait_tot_target:      paramVals['WaitTOTCool.wait_tot_target'] ?? 150,
    throttle_set_pct:     paramVals['ThrottleSet.throttle_set_pct'] ?? 10,
    preheat_ms:           paramVals['PreHeat.preheat_ms']         ?? 3000,
    ab_stab_ms:           paramVals['ABStabilize.ab_stab_ms']     ?? 1000,
    gov_hold_band_rpm:    paramVals['GovernorHold.gov_hold_band_rpm'] ?? 500,
  };
}

function _buildHwWarningHtml(def) {
  if (!def?.hwWarnings?.length) return '';
  return (def.hwWarnings)
    .filter(w => !w.check(hwCfg))
    .map(w => {
      const isError = w.level === 'error';
      const bg  = isError ? 'rgba(220,50,50,.1)'  : 'rgba(255,180,0,.08)';
      const bdr = isError ? 'rgba(220,50,50,.55)' : 'rgba(255,180,0,.45)';
      const col = isError ? '#f06060'             : '#ffc840';
      return `<div style="font-size:.7rem;color:${col};background:${bg};border:1px solid ${bdr};border-radius:5px;padding:.35rem .65rem;margin-bottom:.4rem;line-height:1.5">${w.msg}</div>`;
    })
    .join('');
}

function isIgnitionBlock(bname) {
  return ['IgniterOn','IgniterOff','ABIgnOn','ABIgnOff','PreHeat','PreIgnSpark','GlowPreheat'].includes(bname);
}

const BLOCK_OUTPUT_PURPOSES = {
  IgniterOn:['igniter','ab_igniter','glow_plug'], IgniterOff:['igniter','ab_igniter','glow_plug'],
  ABIgnOn:['igniter','ab_igniter','glow_plug'], ABIgnOff:['igniter','ab_igniter','glow_plug'],
  PreHeat:['igniter','ab_igniter','glow_plug'], PreIgnSpark:['igniter','ab_igniter','glow_plug'],
  GlowPreheat:['glow_plug'],
  FuelOpen:['fuel_shutoff'], FuelSolClose:['fuel_shutoff'], FuelPulse:['fuel_shutoff'],
  StarterEnOn:['starter_enable'], StarterEnOff:['starter_enable'], StarterOff:['starter'],
  OilPumpOn:['oil_pump'], OilPumpOff:['oil_pump'],
  CoolFanOn:['cooling_fan'], CoolFanOff:['cooling_fan'],
  AirstarterOn:['air_starter'], AirstarterOff:['air_starter'],
  ABPumpOn:['ab_pump'], ABPumpOff:['ab_pump'],
  OilScavengeOn:['scavenge_pump'], OilScavengeOff:['scavenge_pump'],
  DrainValveOpen:['drain_valve'], DrainValveClose:['drain_valve'],
  BleedOpen:['bleed_valve'], BleedClose:['bleed_valve'],
  FuelPumpRamp:['fuel_pump'], FuelPump2Set:['fuel_pump'], FuelPump2On:['fuel_pump'], FuelPump2Off:['fuel_pump'],
  ABSolOpen:['ab_valve'], ABSolClose:['ab_valve'], ThrottleSet:['main_fuel'],
};

const PROPORTIONAL_OUTPUT_BLOCKS = new Set(['FuelPumpRamp','FuelPump2Set','ThrottleSet']);

function compatibleBlockOutputs(bname) {
  const purposes = BLOCK_OUTPUT_PURPOSES[bname];
  if (!purposes) return [];
  return (hwCfg.channel_registry?.outputs || []).filter(channel =>
    registryChannelInstalled(channel) && !String(channel.mirror_of || '') &&
    (!isIgnitionBlock(bname) || purposes.includes(String(channel.purpose || ''))) &&
    (!PROPORTIONAL_OUTPUT_BLOCKS.has(bname) || [5,6].includes(Number(channel.driver))) &&
    (bname !== 'ThrottleSet' || String(channel.purpose || '') === 'main_fuel'));
}

function suggestedBlockOutputs(bname) {
  const purposes = BLOCK_OUTPUT_PURPOSES[bname] || [];
  return compatibleBlockOutputs(bname).filter(channel =>
    purposes.includes(String(channel.purpose || '')));
}

function preferredLegacyTarget(bname, tab, idx, outputs) {
  // Old files had only a device category. It is safe to migrate that category
  // automatically only when it resolves to one physical device. With several
  // candidates, leave the reference visibly unresolved for the user to choose.
  if (isIgnitionBlock(bname)) {
    const legacy = Number(hwCfg[ignitionTargetSeqKey(tab)]?.[idx] ?? 0);
    const purpose = legacy === 1 ? 'ab_igniter' : legacy === 2 ? 'glow_plug' : 'igniter';
    const category = outputs.filter(output => String(output.purpose || '') === purpose);
    if (category.length === 1) return String(category[0].id || '');
    const suggested = suggestedBlockOutputs(bname);
    return suggested.length === 1 ? String(suggested[0].id || '') : '';
  }
  const suggested = suggestedBlockOutputs(bname);
  return suggested.length === 1 ? String(suggested[0].id || '') : '';
}

function migrateLegacyDeviceTargets() {
  ['startup','shutdown','afterburner','ab-shut'].forEach(tab => {
    ensureDeviceTargetSlots(tab);
    (hwCfg[seqKey(tab)] || []).forEach((bname, idx) => {
      if (!BLOCK_OUTPUT_PURPOSES[bname] || hwCfg[deviceTargetSeqKey(tab)][idx]) return;
      hwCfg[deviceTargetSeqKey(tab)][idx] = preferredLegacyTarget(
        bname, tab, idx, compatibleBlockOutputs(bname));
    });
  });
}

function deviceTargetInfo(targetId) {
  const output = (hwCfg.channel_registry?.outputs || []).find(row => String(row?.id || '') === String(targetId || ''));
  if (!output) return targetId ? 'Referenced device is missing. Restore it or choose another output.' : 'Choose the physical output this step commands.';
  const driver = Number(output.driver);
  const signal = [4,11].includes(driver) ? 'on/off output' : driver === 5 ? 'PWM output' : driver === 6 ? 'servo / ESC output' : 'configured output';
  return `${registryLabel(output, output.id)} · ${signal}`;
}

function wetGlowTimingWarning(bname, idx, tab, targetId) {
  const glow = hwCfg.actuators?.glow_plug || {};
  const output = (hwCfg.channel_registry?.outputs || []).find(row => String(row?.id || '') === String(targetId || ''));
  if (String(output?.purpose || '') !== 'glow_plug' || Number(glow.type || 0) !== 2) return '';
  const seq = hwCfg[seqKey(tab)] || [];
  const delayMs = Number(glow.fuel_delay_ms ?? 8000);
  let waitMs = bname === 'PreHeat' ? Number(paramVals['PreHeat.preheat_ms'] ?? 3000) : 0;
  const fuelOrConfirm = new Set(['FuelOpen', 'FuelPumpIdle', 'FuelPulse', 'TempConfirm', 'FlameConfirm', 'Spool']);
  for (let i = idx + 1; i < seq.length; i++) {
    const nm = seq[i];
    if (nm === 'TimedDelay') waitMs += Number(timedDelayValue(tab, i) || 0);
    else if (nm === 'PreHeat') waitMs += Number(paramVals['PreHeat.preheat_ms'] ?? 3000);
    if (fuelOrConfirm.has(nm)) break;
  }
  if (waitMs >= delayMs) return '';
  const delayS = (delayMs / 1000).toFixed(delayMs % 1000 ? 1 : 0);
  const waitS = (waitMs / 1000).toFixed(waitMs % 1000 ? 1 : 0);
  return `<span class="param-desc" style="display:block;font-size:.65rem;color:var(--yellow);line-height:1.35;margin-top:.22rem">Wet glow start fuel delay is ${delayS} s, but the next fuel/confirmation step is about ${waitS} s away. Add delay or increase Pre-Heat time if start fuel must be burning first.</span>`;
}

function buildDeviceTargetHtml(bname, idx, tab) {
  if (!BLOCK_OUTPUT_PURPOSES[bname]) return '';
  ensureDeviceTargetSlots(tab);
  const avail = compatibleBlockOutputs(bname);
  const suggested = suggestedBlockOutputs(bname);
  const suggestedIds = new Set(suggested.map(output => String(output.id || '')));
  const other = avail.filter(output => !suggestedIds.has(String(output.id || '')));
  let target = String(hwCfg[deviceTargetSeqKey(tab)]?.[idx] || '');
  // Keep the selector visible and consistent even with one choice. Selecting
  // the sole compatible device here also covers newly restored old files and
  // blocks rendered before a separate migration pass.
  if (!target && suggested.length === 1) {
    target = String(suggested[0].id || '');
    hwCfg[deviceTargetSeqKey(tab)][idx] = target;
    if (isIgnitionBlock(bname)) {
      const output = suggested[0];
      hwCfg[ignitionTargetSeqKey(tab)][idx] = output.purpose === 'ab_igniter' ? 1 : output.purpose === 'glow_plug' ? 2 : 0;
    }
  }
  const exists = avail.some(output => String(output.id || '') === target);
  const missing = target && !exists
    ? `<option value="${esc(target)}" selected>Missing device: ${esc(target)}</option>` : '';
  const choose = !target ? '<option value="" selected>— Choose output —</option>' : '';
  const group = (label, rows) => rows.length ? `<optgroup label="${esc(label)}">${rows.map(output => `<option value="${esc(output.id)}" ${target===String(output.id)?'selected':''}>${esc(registryLabel(output, output.id))}</option>`).join('')}</optgroup>` : '';
  const opts = group('Suggested', suggested) + group('Other fitted outputs', other);
  const wetWarn = wetGlowTimingWarning(bname, idx, tab, target);
  return `<div class="param-field" style="margin-bottom:.55rem">
    <span class="param-label">Output device</span>
    <select class="param-input" onchange="setDeviceTarget('${tab}',${idx},this.value)">${missing}${choose}${opts}</select>
    <span class="param-desc" style="display:block;font-size:.65rem;color:${target && !exists ? '#f06060' : 'var(--dim)'};line-height:1.35;margin-top:.18rem">${esc(deviceTargetInfo(target))}</span>
    ${wetWarn}
  </div>`;
}

function setDeviceTarget(tab, idx, value) {
  ensureDeviceTargetSlots(tab);
  ensureIgnitionTargetSlots(tab);
  hwCfg[deviceTargetSeqKey(tab)][idx] = String(value || '');
  const output = (hwCfg.channel_registry?.outputs || []).find(row => String(row?.id || '') === String(value || ''));
  if (output && isIgnitionBlock(hwCfg[seqKey(tab)]?.[idx])) {
    hwCfg[ignitionTargetSeqKey(tab)][idx] = output.purpose === 'ab_igniter' ? 1 : output.purpose === 'glow_plug' ? 2 : 0;
  }
  renderFast(tab);
}

function buildParamsHtml(bname, idx, tab) {
  const def = BLOCKS[bname] || customBlocks[bname];
  const unavailableHtml = !def
    ? `<div style="font-size:.7rem;color:#f06060;background:rgba(220,50,50,.1);border:1px solid rgba(220,50,50,.55);border-radius:5px;padding:.35rem .65rem;margin-bottom:.4rem;line-height:1.5">This block is not supported by the current firmware. Remove it before saving.</div>`
    : def.visibleIf && !def.visibleIf(hwCfg)
      ? `<div style="font-size:.7rem;color:#f06060;background:rgba(220,50,50,.1);border:1px solid rgba(220,50,50,.55);border-radius:5px;padding:.35rem .65rem;margin-bottom:.4rem;line-height:1.5">This block cannot run with the current Hardware inventory. Restore its required device or remove this block before saving.</div>`
      : '';
  const warningHtml = unavailableHtml + _buildHwWarningHtml(def);
  const sideHtml = buildSideActionsHtml(tab, idx);
  const ignitionHtml = buildDeviceTargetHtml(bname, idx, tab);
  const outputCommandHtml = bname === 'SetOutput' ? buildSetOutputHtml(tab, idx) : '';
  const hasSharedParams = !!def?.params?.some(p => p.configKey && !(bname === 'TimedDelay' && p.key === 'timed_delay_ms'));
  const sharedNoteHtml = hasSharedParams
    ? `<div style="font-size:.65rem;color:var(--dim);line-height:1.35;margin:.35rem 0 .55rem">Shared setting: parameter changes here apply to every ${def.label || bname} block that uses this setting. Timed Delay values and output-device selections are per card.</div>`
    : '';
  if (!def || def.params.length === 0) {
    return `<div class="block-params"><div class="block-desc">${esc(def?.desc ?? '')}</div>${warningHtml}${ignitionHtml}${outputCommandHtml}${bname === 'SetOutput' ? '' : '<em style="font-size:.72rem;color:var(--dim)">No configurable parameters.</em>'}${sideHtml}</div>`;
  }
  const inputs = def.params.map(p => {
    // visibleIf - skip this param if hw condition is false
    if (p.visibleIf && !p.visibleIf(hwCfg)) return '';
    const vk  = bname + '.' + p.key;
    const perSlotDelay = bname === 'TimedDelay' && p.key === 'timed_delay_ms';
    const val = perSlotDelay ? timedDelayValue(tab, idx) : (paramVals[vk] ?? p.def);
    // showWhen - compute initial visibility
    const isVisible = !p.showWhen || p.showWhen(paramVals, bname);
    const hiddenStyle = isVisible ? '' : ' style="display:none"';
    if (p.type === 'bool') {
      const checked = val ? 'checked' : '';
      // Starter checkbox: when checked, oil pump checkbox is ghosted+forced-on
      const isOilPump   = (bname === 'CooldownSpin' && p.key === 'cooldown_use_oil_pump');
      const starterOn   = isOilPump && (paramVals['CooldownSpin.cooldown_use_starter'] ?? true);
      const disabledAttr = starterOn ? 'disabled' : '';
      const displayVal   = starterOn ? 'Yes (required by starter)' : (val ? 'Yes' : 'No');
      const boolDescHtml = p.desc ? `<span class="param-desc" style="display:block;font-size:.65rem;color:var(--dim);line-height:1.35;margin-bottom:.18rem">${p.desc}</span>` : '';
      return `<div class="param-field" id="pf-${tab}-${idx}-${bname}-${p.key}" data-bname="${bname}" data-pkey="${p.key}"${hiddenStyle}>
        <span class="param-label">${p.label}</span>
        ${boolDescHtml}<div style="display:flex;align-items:center;gap:.45rem;padding:.32rem 0">
          <input type="checkbox" id="p-${tab}-${idx}-${bname}-${p.key}" ${checked} ${disabledAttr}
            onchange="onParamChangeBool('${bname}','${p.key}','${p.configKey??''}',this.checked)">
          <label for="p-${tab}-${idx}-${bname}-${p.key}" style="font-size:.78rem;color:var(--dim);cursor:pointer">${displayVal}</label>
        </div>
      </div>`;
    }
    if (p.type === 'select') {
      const opts = (p.options || []).map(o =>
        `<option value="${o.v}" ${val == o.v ? 'selected' : ''}>${o.l}</option>`
      ).join('');
      const selDescHtml = p.desc ? `<span class="param-desc" style="display:block;font-size:.65rem;color:var(--dim);line-height:1.35;margin-bottom:.18rem">${p.desc}</span>` : '';
      return `<div class="param-field" id="pf-${tab}-${idx}-${bname}-${p.key}" data-bname="${bname}" data-pkey="${p.key}"${hiddenStyle}>
        <span class="param-label">${p.label}</span>
        ${selDescHtml}<select class="param-input" id="p-${tab}-${idx}-${bname}-${p.key}"
          onchange="onParamChangeSelect('${bname}','${p.key}','${p.configKey??''}',this.value)">${opts}</select>
      </div>`;
    }
    const descHtml = p.desc ? `<span class="param-desc" style="display:block;font-size:.65rem;color:var(--dim);line-height:1.35;margin-bottom:.18rem">${p.desc}</span>` : '';
    const displayVal = seqDisplayValue(p, val);
    const unitLabel = seqUnitLabel(p);
    return `<div class="param-field" id="pf-${tab}-${idx}-${bname}-${p.key}" data-bname="${bname}" data-pkey="${p.key}"${hiddenStyle}>
      <span class="param-label">${p.label}${unitLabel ? ` <span class="param-unit">(${unitLabel})</span>` : ''}</span>
      ${descHtml}<input class="param-input" type="number" id="p-${tab}-${idx}-${bname}-${p.key}"
        min="${seqDisplayAttr(p, p.min)}" max="${seqDisplayAttr(p, p.max)}" step="${seqDisplayStep(p)}" value="${displayVal}"
        oninput="onParamChange('${bname}','${p.key}','${p.configKey??''}',this.value,'${tab}',${idx})">
    </div>`;
  }).join('');
  return `<div class="block-params">
    <div class="block-desc">${esc(def.desc ?? '')}</div>
    ${warningHtml}${ignitionHtml}${sharedNoteHtml}<div class="param-grid">${inputs}</div>${sideHtml}
  </div>`;
}

function buildSetOutputHtml(tab, idx) {
  ensureActionSlots(tab);
  const acts = getEnabledActuators();
  const key = actionKey(tab, 'enter');
  let row = hwCfg[key][idx][0];
  if (!row && acts.length) {
    const first = acts[0];
    row = {act:first.actuator, target:first.target, value:first.mode === 'pct' ? 0 : 1};
    hwCfg[key][idx][0] = row;
  }
  if (!row) return '<div class="block-hardware-pill">No fitted outputs</div>';
  const meta = sideActionMeta(row);
  const missingTarget = !meta ? String(row.target || ACT_KEY_BY_ENUM[Number(row.act)] || 'unknown') : '';
  const missingOption = missingTarget ? `<option value="${esc(missingTarget)}" selected disabled>Missing output: ${esc(missingTarget)}</option>` : '';
  const options = missingOption + acts.map(item => `<option value="${esc(item.target)}" ${meta && String(item.target)===String(meta.target)?'selected':''}>${esc(item.label)}</option>`).join('');
  const display = actionDisplayValue(row, row.value);
  const demand = !meta
    ? `<input class="param-input" type="text" value="Unavailable until an output is selected" disabled>`
    : meta.mode === 'pct'
    ? `<div style="display:flex;align-items:center;gap:.35rem"><input class="param-input" type="number" min="0" max="100" step="1" value="${display}" oninput="updateSetOutput('${tab}',${idx},null,this.value)"><span class="param-unit">%</span></div>`
    : `<select class="param-input" onchange="updateSetOutput('${tab}',${idx},null,this.value)"><option value="1" ${display?'selected':''}>ON</option><option value="0" ${!display?'selected':''}>OFF</option></select>`;
  const starterTransition = meta?.key === 'starter' && meta.mode === 'pct'
    ? `<div class="param-field"><span class="param-label">Speed change time <span class="param-unit">(s)</span></span>
        <input class="param-input" type="number" min="0" max="60" step="0.1" value="${Math.max(0, Number(row.transition_ms) || 0) / 1000}"
          oninput="updateSetOutput('${tab}',${idx},null,null,this.value)">
        <span class="param-desc">Time to move smoothly from the current starter demand to the requested demand. Set 0 for an immediate change. STOP and faults remain immediate.</span></div>`
    : '';
  return `<div class="param-grid">
    <div class="param-field"><span class="param-label">Output device</span><select class="param-input" onchange="updateSetOutput('${tab}',${idx},this.value,null)">${options}</select><span class="param-desc">Any fitted output may be selected. Hardware driver limits are always respected.</span></div>
    <div class="param-field"><span class="param-label">${meta?.mode === 'pct' ? 'Demand (0–100%)' : 'Command'}</span>${demand}<span class="param-desc">${!meta ? 'Choose a fitted output to restore this block.' : meta.mode === 'pct' ? 'Zero is off; 100% is the configured full output.' : 'Binary relay or switch output.'}</span></div>
    ${starterTransition}
  </div>`;
}

function updateSetOutput(tab, idx, newTarget, newValue, newTransitionSeconds = null) {
  ensureActionSlots(tab);
  const key = actionKey(tab, 'enter');
  const row = hwCfg[key]?.[idx]?.[0];
  if (!row) return;
  if (newTarget !== null && newTarget !== undefined) {
    const previousMeta = sideActionMeta(row);
    const previous = actionDisplayValue(row, row.value);
    const meta = getEnabledActuators().find(item => String(item.target) === String(newTarget));
    if (!meta) return;
    row.act = meta.actuator;
    row.target = meta.target;
    row.value = previousMeta?.mode === meta.mode ? actionStoredValue(row, previous) : 0;
    if (meta.key !== 'starter' || meta.mode !== 'pct') delete row.transition_ms;
    else if (!Number.isFinite(Number(row.transition_ms))) row.transition_ms = 0;
    renderFast(tab);
    return;
  }
  if (newTransitionSeconds !== null && newTransitionSeconds !== undefined) {
    row.transition_ms = Math.round(Math.max(0, Math.min(60, Number(newTransitionSeconds) || 0)) * 1000);
  } else {
    row.value = actionStoredValue(row, newValue);
  }
  markSequenceDirty('Sequence edited — save to apply');
}

function toggleParams(header) {
  const panel = header.closest('.block-card')?.querySelector('.block-params');
  if (panel) panel.classList.toggle('open');
}

function onParamChange(bname, pkey, configKey, rawVal, tab, idx) {
  const allBlocks = {...BLOCKS, ...customBlocks};
  const pdef = allBlocks[bname]?.params?.find(p => p.key === pkey);
  if (!pdef) return;
  const val = seqStoredValue(pdef, rawVal);
  if (val === undefined) return;
  if (bname === 'TimedDelay' && pkey === 'timed_delay_ms' && tab !== undefined) {
    ensureDelaySlots(tab);
    hwCfg[delaySeqKey(tab)][idx] = val;
    const card = document.querySelector(`#list-${tab} .block-card[data-idx="${idx}"]`);
    const summary = card?.querySelector('.block-cond');
    if (summary) summary.textContent = `${seqRound(val / 1000)} s`;
    markSequenceDirty('Sequence edited — save to apply');
    return;
  }
  const vk  = bname + '.' + pkey;
  paramVals[vk] = val;
  if (configKey) setConfigVal(configKey, val);
  refreshParamVisibility(bname);
}

function onParamChangeSelect(bname, pkey, configKey, rawVal) {
  const val = parseInt(rawVal);
  const vk  = bname + '.' + pkey;
  paramVals[vk] = val;
  if (configKey) setConfigVal(configKey, val);
  refreshParamVisibility(bname);
}

function refreshParamVisibility(bname) {
  const def = BLOCKS[bname] || customBlocks[bname];
  if (!def) return;
  def.params.forEach(p => {
    if (!p.showWhen) return;
    const show = p.showWhen(paramVals, bname);
    document.querySelectorAll(`.param-field[data-bname="${bname}"][data-pkey="${p.key}"]`)
      .forEach(el => { el.style.display = show ? '' : 'none'; });
  });
}

function onParamChangeBool(bname, pkey, configKey, checked) {
  const vk = bname + '.' + pkey;
  paramVals[vk] = checked;
  // Shared setting: sync checkbox + label in every card showing this param (ids are per tab+card)
  document.querySelectorAll(`.param-field[data-bname="${bname}"][data-pkey="${pkey}"]`).forEach(pf => {
    const cb  = pf.querySelector('input[type="checkbox"]');
    const lbl = pf.querySelector('label');
    if (cb)  cb.checked = checked;
    if (lbl) lbl.textContent = checked ? 'Yes' : 'No';
  });
  if (configKey) setConfigVal(configKey, checked);

  // CooldownSpin: when starter is toggled, ghost/force oil pump checkbox
  if (bname === 'CooldownSpin' && pkey === 'cooldown_use_starter') {
    if (checked) {
      // Starter on -> force oil pump on
      paramVals['CooldownSpin.cooldown_use_oil_pump'] = true;
      setConfigVal('cooldown_use_oil', true);
    }
    const cur = paramVals['CooldownSpin.cooldown_use_oil_pump'] ?? true;
    document.querySelectorAll('.param-field[data-bname="CooldownSpin"][data-pkey="cooldown_use_oil_pump"]').forEach(pf => {
      const oilCb  = pf.querySelector('input[type="checkbox"]');
      const oilLbl = pf.querySelector('label');
      if (!oilCb) return;
      if (checked) {
        // Starter on -> force oil pump on and disable the checkbox
        oilCb.checked  = true;
        oilCb.disabled = true;
        if (oilLbl) oilLbl.textContent = 'Yes (required by starter)';
      } else {
        // Starter off -> re-enable oil pump checkbox
        oilCb.disabled = false;
        if (oilLbl) oilLbl.textContent = cur ? 'Yes' : 'No';
      }
    });
  }
  refreshParamVisibility(bname);
}

// ------ Sequence order edits ---------------------------------------------------------------------------------------------------------------------------------------------------------
function moveBlock(tab, idx, dir) {
  moveBlockTo(tab, idx, idx + dir);
}

function moveBlockTo(tab, idx, ni) {
  const key = seqKey(tab);
  const seq = hwCfg[key];
  if (!seq) return;
  if (ni < 0 || ni >= seq.length) return;
  ensureDelaySlots(tab);
  ensureActionSlots(tab);
  ensureIgnitionTargetSlots(tab);
  ensureDeviceTargetSlots(tab);
  const reorder = rows => {
    if (!Array.isArray(rows)) return;
    const [item] = rows.splice(idx, 1);
    rows.splice(ni, 0, item);
  };
  reorder(seq);
  reorder(hwCfg[delaySeqKey(tab)]);
  reorder(hwCfg[ignitionTargetSeqKey(tab)]);
  reorder(hwCfg[deviceTargetSeqKey(tab)]);
  for (const phase of ['enter','exit']) {
    const ak = actionKey(tab, phase);
    if (!ak || !hwCfg[ak]) continue;
    reorder(hwCfg[ak]);
  }
  renderFast(tab);
}

async function removeBlock(tab, idx) {
  const name = hwCfg[seqKey(tab)]?.[idx] || 'this block';
  if (!await OTDialog.confirm(`Remove "${name}" from this sequence?\n\nThis cannot be undone after you save.`, {
    title: 'Remove sequence block?', confirmText: 'Remove block', danger: true
  })) return;
  ensureDelaySlots(tab);
  ensureActionSlots(tab);
  ensureIgnitionTargetSlots(tab);
  ensureDeviceTargetSlots(tab);
  hwCfg[seqKey(tab)].splice(idx, 1);
  hwCfg[delaySeqKey(tab)].splice(idx, 1);
  hwCfg[ignitionTargetSeqKey(tab)].splice(idx, 1);
  hwCfg[deviceTargetSeqKey(tab)].splice(idx, 1);
  for (const phase of ['enter','exit']) {
    const ak = actionKey(tab, phase);
    if (ak && hwCfg[ak]) hwCfg[ak].splice(idx, 1);
  }
  renderFast(tab);
}

function addBlock(tab, selectedValue = '') {
  const sel   = document.getElementById('add-' + tab + '-sel');
  const selected = selectedValue || sel.value;
  if (!selected) return;
  const [bname, presetTarget = ''] = selected.split('::');
  const key = seqKey(tab);
  if (!hwCfg[key]) hwCfg[key] = [];
  hwCfg[key].push(bname);
  ensureDelaySlots(tab);
  ensureActionSlots(tab);
  ensureIgnitionTargetSlots(tab);
  ensureDeviceTargetSlots(tab);
  hwCfg[delaySeqKey(tab)][hwCfg[key].length - 1] =
    bname === 'TimedDelay' ? (cfg?.sequence?.startup?.timed_delay_ms || 1000) : 0;
  hwCfg[ignitionTargetSeqKey(tab)][hwCfg[key].length - 1] = 0;
  const choices = suggestedBlockOutputs(bname);
  hwCfg[deviceTargetSeqKey(tab)][hwCfg[key].length - 1] = choices.length === 1 ? String(choices[0].id || '') : '';
  if (bname === 'SetOutput') {
    const acts = getEnabledActuators();
    const first = acts.find(item => String(item.target) === presetTarget) || acts[0];
    if (first) hwCfg[actionKey(tab, 'enter')][hwCfg[key].length - 1] = [{
      act:first.actuator, target:first.target, value:first.mode === 'pct' ? 0 : 1
    }];
  }
  renderFast(tab);
}

function closeBlockPicker() {
  const dialog = document.getElementById('block-picker-dlg');
  if (dialog) dialog.style.display = 'none';
}
function openBlockPicker(tab) {
  const select = document.getElementById('add-' + tab + '-sel');
  const dialog = document.getElementById('block-picker-dlg');
  const list = document.getElementById('block-picker-list');
  if (!select || !dialog || !list) return;
  const names = {startup:'Startup',shutdown:'Shutdown',afterburner:'Afterburner light-up','ab-shut':'Afterburner light-off'};
  document.getElementById('block-picker-title').textContent = `Add ${names[tab] || ''} block`;
  list.innerHTML = '';
  Array.from(select.options).filter(option => option.value && !option.disabled).forEach(option => {
    const value = option.value;
    const bname = value.split('::')[0];
    const def = BLOCKS[bname] || customBlocks[bname] || {};
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'block-picker-option';
    const title = document.createElement('strong');
    title.textContent = option.textContent.replace(/^\[[^\]]+\]\s*/, '');
    const detail = document.createElement('small');
    const kind = option.textContent.match(/^\[([^\]]+)\]/)?.[1] || 'BLOCK';
    detail.textContent = `${kind} — ${def.desc || 'Add this block to the sequence.'}`;
    button.append(title, detail);
    button.addEventListener('click', () => { closeBlockPicker(); addBlock(tab, value); });
    list.appendChild(button);
  });
  if (!list.children.length) list.textContent = 'No blocks are currently available for the fitted hardware.';
  dialog.style.display = 'flex';
  list.querySelector('button')?.focus();
}

const _typeLabel = {while:'WHILE', action:'ACTION', wait:'WAIT', check:'CHECK'};

function populateAddSelects() {
  const lists = {startup: STARTUP_BLOCKS, shutdown: SHUTDOWN_BLOCKS, afterburner: AFTERBURNER_BLOCKS, 'ab-shut': AB_SHUT_BLOCKS};
  ['startup','shutdown','afterburner','ab-shut'].forEach(tab => {
    const sel = document.getElementById('add-' + tab + '-sel');
    sel.innerHTML = '<option value="">- select block to add -</option>';
    const allBlocks = {...BLOCKS, ...customBlocks};
    const blockList = lists[tab];
    blockList.forEach(b => {
      const def = allBlocks[b];
      if (b === 'SetOutput') {
        getEnabledActuators().forEach(meta => {
          const o = document.createElement('option');
          o.value = `SetOutput::${meta.target}`;
          o.text = `[ACTION] Set ${meta.label}`;
          sel.appendChild(o);
        });
        return;
      }
      // Device-targeted actions may deliberately use another fitted output;
      // their purpose match is a suggestion, not a hard UI restriction.
      if (BLOCK_OUTPUT_PURPOSES[b]) {
        if (!compatibleBlockOutputs(b).length) return;
      } else if (def?.visibleIf && !def.visibleIf(hwCfg)) return;
      const o = document.createElement('option');
      o.value = b;
      const tag = def ? `[${(_typeLabel[def.type] ?? def.type.toUpperCase())}] ` : '';
      o.text = tag + (def?.label ?? b);
      sel.appendChild(o);
    });
    Object.entries(customBlocks).forEach(([k, def]) => {
      const o = document.createElement('option');
      o.value = k; o.text = '[CUSTOM] ' + def.label;
      sel.appendChild(o);
    });
  });
}

function updateBlockPreview(tab) {
  const sel   = document.getElementById('add-' + tab + '-sel');
  const prev  = document.getElementById('preview-' + tab);
  if (!prev) return;
  const bname = sel?.value?.split('::')[0];
  const def   = bname ? (BLOCKS[bname] || customBlocks[bname]) : null;
  if (!bname || !def) { prev.innerHTML = ''; return; }
  const typeMap = {while:'WHILE - waits for condition', action:'ACTION - instant, completes in one tick', wait:'WAIT - fixed timer', check:'CHECK - verify then fault or complete'};
  const typeStr = typeMap[def.type] ?? def.type.toUpperCase();
  const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  prev.innerHTML = `<strong style="color:var(--text)">${esc(typeStr)}</strong> &nbsp;*&nbsp; ${esc(def.desc ?? '')}`;
}

// ------ Custom block dialog ------------------------------------------------------------------------------------------------------------------------------------------------------------
let _customDlgTab = 'startup';
let _cblkSteps    = [];   // [{type:'set_act',act,val} | {type:'delay_ms',val}]
let _editingKey   = null; // null = new block, string = editing existing

// ------ Sensor / actuator lists from hwCfg ------------------------------------------------------------------------------------------------------------
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
const SEQUENCE_CORE_INPUT_IDS = new Set([
  'n1_main','primary_n1','n2_main','primary_n2','tot_main','primary_egt','tit_main',
  'oil_pressure_main','oil_temperature','fuel_pressure','fuel_flow','p1_main','p2_main',
  'torque_main','flame_main','thrust_main','operator_throttle','operator_idle',
  'battery_voltage','ab_flame_main','ab_command','start_switch','stop_switch'
]);
const SEQUENCE_CORE_INPUT_PURPOSES = new Set([
  'n1_speed','n2_speed','tot','tit','oil_pressure','oil_temperature','fuel_pressure',
  'fuel_flow','p1_pressure','p2_pressure','torque','thrust','flame','battery_voltage',
  'throttle','idle','ab_flame','ab_command','start_switch','stop_switch'
]);
const SEQUENCE_CORE_OUTPUT_IDS = new Set([
  'main_fuel_output','main_fuel','main_starter','starter','starter_main','starter_enable',
  'oil_pump','oil_pump_main','cooling_fan','cooling_fan_main','oil_scavenge_main',
  'scavenge_pump','bleed_valve','bleed_valve_main','igniter','ab_igniter','igniter2_main',
  'main_fuel_shutoff','fuel_shutoff','ab_solenoid','air_starter','fuel_pump','ab_pump',
  'prop_pitch','glow_plug'
]);
const SEQUENCE_CORE_OUTPUT_PURPOSES = new Set([
  'main_fuel','fuel_shutoff','starter','starter_enable','oil_pump','scavenge_pump',
  'cooling_fan','fuel_pump','igniter','ab_igniter','ab_valve','glow_plug','ab_pump',
  'prop_pitch','air_starter'
]);
function registryInputCoreBound(channel) {
  if (!channel) return false;
  if (SEQUENCE_CORE_INPUT_IDS.has(String(channel.id || ''))) return true;
  const purpose = String(channel.purpose || '');
  if (!SEQUENCE_CORE_INPUT_PURPOSES.has(purpose)) return false;
  const peers = (hwCfg.channel_registry?.inputs || []).filter(item =>
    registryChannelInstalled(item) && String(item.purpose || '') === purpose);
  const preferred = peers.find(item => SEQUENCE_CORE_INPUT_IDS.has(String(item.id || '')));
  return (preferred || peers[0]) === channel;
}
function registryOutputCoreBound(channel) {
  if (!channel?.id) return false;
  const id = String(channel.id);
  const purpose = String(channel.purpose || '');
  if (!SEQUENCE_CORE_OUTPUT_PURPOSES.has(purpose)) return false;
  const bindingKey = ({main_fuel:'main_fuel_output',fuel_shutoff:'main_fuel_shutoff',starter:'main_starter',
    starter_enable:'starter_enable_output',oil_pump:'primary_oil_pump',scavenge_pump:'primary_scavenge_pump',
    cooling_fan:'primary_cooling_fan',bleed_valve:'primary_bleed_valve',fuel_pump:'primary_aux_fuel_pump',
    igniter:'primary_igniter',ab_igniter:'primary_secondary_igniter',ab_valve:'primary_ab_valve',
    glow_plug:'primary_glow_plug',ab_pump:'primary_ab_pump',prop_pitch:'primary_prop_pitch',
    air_starter:'primary_air_starter'})[purpose];
  const binding = bindingKey && (hwCfg.channel_registry?.bindings || []).find(row => String(row?.key || '') === bindingKey);
  if (binding) return String(binding.channel || '') === id;
  if (SEQUENCE_CORE_OUTPUT_IDS.has(id)) return true;
  const peers = (hwCfg.channel_registry?.outputs || []).filter(item =>
    registryChannelInstalled(item) && !String(item.mirror_of || '') &&
    String(item.purpose || '') === purpose);
  const preferred = peers.find(item => SEQUENCE_CORE_OUTPUT_IDS.has(String(item.id || '')));
  return preferred ? preferred === channel : peers.length === 1 && peers[0] === channel;
}
function registryInputPurpose(purpose) {
  return (hwCfg.channel_registry?.inputs || []).find(channel =>
    registryChannelInstalled(channel) && String(channel.purpose || channel.id || '') === purpose) || null;
}
function registryOutputPurpose(purpose) {
  return (hwCfg.channel_registry?.outputs || []).find(channel =>
    registryChannelInstalled(channel) && !String(channel.mirror_of || '') &&
    String(channel.purpose || channel.id || '') === purpose) || null;
}
function sequenceHasAfterburner() {
  return !!(registryOutputPurpose('ab_igniter') || registryOutputPurpose('ab_pump') || registryOutputPurpose('ab_valve'));
}

function getEnabledSensors() {
  const s  = hwCfg.sensors    || {};
  const hw = hwCfg;
  const list = [];
  const sourceFor = purpose => registryInputPurpose(purpose)?.id || '';
  if (registryInputPurpose('oil_temperature'))
                                  list.push({key:'oil_temp', source:sourceFor('oil_temperature'), label:'Oil Temp', unit:'deg C', def:50, step:1});
  if (registryInputPurpose('n1_speed'))
                                  list.push({key:'n1_rpm', source:sourceFor('n1_speed'), label:'N1 RPM', unit:'rpm', def:5000, step:100});
  if (registryInputPurpose('n2_speed'))
                                  list.push({key:'n2_rpm', source:sourceFor('n2_speed'), label:'N2 RPM', unit:'rpm', def:5000, step:100});
  if (registryInputPurpose('tot')) list.push({key:'tot', source:sourceFor('tot'), label:'TOT', unit:'deg C', def:200, step:5});
  if (registryInputPurpose('tit')) list.push({key:'tit', source:sourceFor('tit'), label:'TIT', unit:'deg C', def:300, step:5});
  if (registryInputPurpose('oil_pressure')) list.push({key:'oil_press', source:sourceFor('oil_pressure'), label:'Oil Pressure', unit:'bar', def:2.0, step:0.1});
  if (registryInputPurpose('fuel_pressure')) list.push({key:'fuel_press', source:sourceFor('fuel_pressure'), label:'Fuel Pressure', unit:'bar', def:1.0, step:0.1});
  if (registryInputPurpose('battery_voltage')) list.push({key:'batt_voltage', source:sourceFor('battery_voltage'), label:'Battery Voltage', unit:'V', def:10, step:0.1});
  if (registryInputPurpose('flame')) list.push({key:'flame', source:sourceFor('flame'), label:'Flame Detected', unit:'', def:1, bool:true});
  if (registryInputPurpose('throttle')) list.push({key:'throttle_in', source:sourceFor('throttle'), label:'Throttle Input', unit:'%', def:0, step:1});
  if (registryInputPurpose('idle')) list.push({key:'idle_in', source:sourceFor('idle'), label:'Idle Input', unit:'%', def:0, step:1});
  const pressure1 = registryInputPurpose('p1_pressure');
  const pressure2 = registryInputPurpose('p2_pressure');
  if (pressure1) list.push({key:'p1', source:pressure1.id, label:registryLabel(pressure1, 'Pressure 1'), unit:'bar', def:0, step:0.1});
  if (pressure2) list.push({key:'p2', source:pressure2.id, label:registryLabel(pressure2, 'Pressure 2'), unit:'bar', def:0, step:0.1});
  if (registryInputPurpose('fuel_flow')) list.push({key:'fuel_flow', source:sourceFor('fuel_flow'), label:'Fuel Flow', unit:'', def:0, step:1});
  if (registryInputPurpose('torque')) list.push({key:'torque', source:sourceFor('torque'), label:'Torque', unit:'Nm', def:0, step:1});
  if (registryInputPurpose('thrust')) list.push({key:'thrust', source:sourceFor('thrust'), label:'Thrust', unit:'N', def:0, step:1});
  (hw.di_channels || []).forEach((ch, idx) => {
    if ((ch?.pin ?? -1) >= 0 && idx < 4) list.push({key:'di' + idx, label:ch.label || `DI Channel ${idx + 1}`, unit:'', def:1, bool:true});
  });
  if (registryInputPurpose('ab_flame'))
                                  list.push({key:'ab_flame', source:sourceFor('ab_flame'), label:'AB Flame', unit:'', def:1, bool:true});
  if ((hw.ab_trigger?.input_pin ?? -1) >= 0 || registryInputPurpose('ab_command'))
                                  list.push({key:'ab_input', source:sourceFor('ab_command'), label:'AB Input', unit:'%', def:50, step:1});
  const a = hw.actuators || {};
  if (registryOutputPurpose('glow_plug') && a.glow_plug?.has_current)
                                  list.push({key:'glow_current', label:'Glow Current',   unit:'A',    def:1,    step:0.1});
  if (registryOutputPurpose('igniter') && a.igniter?.has_current)
                                  list.push({key:'igniter_current', label:'Igniter 1 Current', unit:'A', def:1, step:0.1});
  if (registryOutputPurpose('ab_igniter') && a.igniter2?.has_current)
                                  list.push({key:'igniter2_current', label:'Secondary Igniter Current', unit:'A', def:1, step:0.1});
  if (registryOutputPurpose('oil_pump') && a.oil_pump?.has_current)
                                  list.push({key:'oil_pump_current', label:'Oil Pump Current', unit:'A', def:1, step:0.1});
  if ((hw.controls?.start_pin ?? -1) >= 0 || registryInputPurpose('start_switch'))
                                  list.push({key:'start_switch', source:sourceFor('start_switch'), label:'Start Switch', unit:'', def:1, bool:true});
  if ((hw.controls?.stop_pin ?? -1) >= 0 || registryInputPurpose('stop_switch'))
                                  list.push({key:'stop_switch', source:sourceFor('stop_switch'), label:'Stop Switch', unit:'', def:1, bool:true});
  (hw.channel_registry?.inputs || []).forEach((c, i) => {
    if (!registryChannelInstalled(c)) return;
    if (registryInputCoreBound(c)) return;
    const role = String(c.role || '');
    const binary = Number(c.driver) === 0 || ['digital_switch','fault','estop','inhibit_start','sequence_gate','ab_arm','ab_fire','limp_mode','flame'].includes(role);
    const unit = binary ? '' : role === 'speed' ? 'rpm' : role === 'pressure' ? 'bar' : role === 'temperature' ? 'deg C' : role === 'voltage' ? 'V' : role === 'flow' ? 'L/min' : role === 'current' ? 'A' : role === 'torque' ? 'Nm' : role === 'thrust' ? 'N' : role === 'operator' ? '%' : role === 'generic' ? '0-1' : '';
    const step = role === 'speed' ? 100 : role === 'generic' ? 0.01 : 1;
    list.push({key:c.id, source:c.id, label:registryLabel(c, `Input ${i+1}`), unit, def:binary ? 1 : 0, step, bool:binary});
  });
  const outputs = hwCfg.channel_registry?.outputs || [];
  return list.map(meta => ({...meta,
    actuator:ACT_ENUM[meta.key] ?? (64 + outputs.findIndex(c => String(c?.id || '') === String(meta.target || '')))
  }));
}

function getEnabledActuators() {
  const a    = hwCfg.actuators || {};
  const hasAB = sequenceHasAfterburner();
  const list = [];
  const isOnOff = act => !act || act.type === 2;
  const effectiveAct = (fallbackActuator, purpose) => {
    const registry = registryOutputPurpose(purpose);
    return registry ? { ...fallbackActuator, enabled:true, type: [4,11].includes(Number(registry.driver)) ? 2 : (Number(registry.driver) === 5 ? 1 : 0) } : null;
  };
  const outputName = (purpose, fallback) => {
    const row = registryOutputPurpose(purpose);
    return row ? registryLabel(row, fallback) : fallback;
  };
  const throttleAct = effectiveAct(a.throttle, 'main_fuel');
  const starterAct = effectiveAct(a.starter, 'starter');
  const oilPumpAct = effectiveAct(a.oil_pump, 'oil_pump');
  const propPitchAct = effectiveAct(a.prop_pitch, 'prop_pitch');
  const targetFor = purpose => registryOutputPurpose(purpose)?.id || '';
  // Always-present outputs (if hardware enabled)
  if (throttleAct) list.push({key:'throttle', target:targetFor('main_fuel'), label:outputName('main_fuel', 'Main Fuel Metering'), mode:isOnOff(throttleAct) ? 'relay':'pct'});
  if (starterAct) list.push({key:'starter', target:targetFor('starter'), label:outputName('starter', 'Starter'), mode:isOnOff(starterAct) ? 'relay':'pct'});
  if (registryOutputPurpose('starter_enable')) list.push({key:'starter_en', target:targetFor('starter_enable'), label:outputName('starter_enable', 'Starter Enable'), mode:'relay'});
  if (oilPumpAct) list.push({key:'oil_pump', target:targetFor('oil_pump'), label:outputName('oil_pump', 'Oil Pump'), mode:isOnOff(oilPumpAct) ? 'relay':'pct'});
  if (registryOutputPurpose('fuel_shutoff')) list.push({key:'fuel_sol', target:targetFor('fuel_shutoff'), label:outputName('fuel_shutoff', 'Main Fuel Shutoff'), mode:'relay'});
  if (registryOutputPurpose('igniter')) list.push({key:'igniter', target:targetFor('igniter'), label:outputName('igniter', 'Igniter'), mode:'relay'});
  if (registryOutputPurpose('ab_igniter')) list.push({key:'igniter2', target:targetFor('ab_igniter'), label:outputName('ab_igniter', hasAB ? 'Afterburner Igniter' : 'Secondary Igniter'), mode:'relay'});
  if (registryOutputPurpose('air_starter')) list.push({key:'airstarter_sol', target:targetFor('air_starter'), label:outputName('air_starter', 'Air Starter Valve'), mode:'relay'});
  if (registryOutputPurpose('cooling_fan')) list.push({key:'cool_fan', target:targetFor('cooling_fan'), label:outputName('cooling_fan', 'Cooling Fan'), mode:'relay'});
  if (registryOutputPurpose('scavenge_pump')) list.push({key:'oil_scavenge_pump', target:targetFor('scavenge_pump'), label:outputName('scavenge_pump', 'Oil Scavenge Pump'), mode:'relay'});
  if (registryOutputPurpose('bleed_valve') || registryOutputPurpose('valve')?.id === 'bleed_valve') list.push({key:'bleed_valve', target:targetFor('bleed_valve') || targetFor('valve'), label:outputName('bleed_valve', 'Bleed Valve'), mode:'relay'});
  if (registryOutputPurpose('glow_plug')) list.push({key:'glow_plug', target:targetFor('glow_plug'), label:outputName('glow_plug', 'Glow Plug'), mode:actuatorIsRelay('glow_plug') ? 'relay':'pct'});
  const fuelPump2Act = effectiveAct(a.fuel_pump2, 'fuel_pump');
  if (fuelPump2Act) list.push({key:'fuel_pump2', target:targetFor('fuel_pump'), label:outputName('fuel_pump', 'Secondary / Auxiliary Fuel Pump'), mode:isOnOff(fuelPump2Act) ? 'relay':'pct'});
  if (propPitchAct) list.push({key:'prop_pitch', target:targetFor('prop_pitch'), label:outputName('prop_pitch', 'Propeller Pitch'), mode:isOnOff(propPitchAct) ? 'relay':'pct'});
  // AB outputs
  if (hasAB && registryOutputPurpose('ab_valve')) list.push({key:'ab_sol', target:targetFor('ab_valve'), label:outputName('ab_valve', 'Afterburner Fuel Valve'), mode:'relay'});
  const abPumpAct = effectiveAct(a.ab_pump, 'ab_pump');
  if (hasAB && abPumpAct) list.push({key:'ab_pump', target:targetFor('ab_pump'), label:outputName('ab_pump', 'Afterburner Fuel Metering'), mode:isOnOff(abPumpAct) ? 'relay':'pct'});
  (hwCfg.channel_registry?.outputs || []).forEach((c, i) => {
    if (!registryChannelInstalled(c) || String(c.mirror_of || '') || registryOutputCoreBound(c)) return;
    const relay = [4,11].includes(Number(c.driver));
    list.push({key:c.id, target:c.id, label:registryLabel(c, `Output ${i+1}`), mode:relay ? 'relay':'pct'});
  });
  const outputs = hwCfg.channel_registry?.outputs || [];
  return list.map(meta => ({
    ...meta,
    actuator: ACT_ENUM[meta.key] ?? (64 + outputs.findIndex(c => String(c?.id || '') === String(meta.target || ''))),
  }));
}

// ------ Dialog open / close ---------------------------------------------------------------------------------------------------------------------------------------------------------
function openCustomBlockDialog(tab) {
  const count = Object.keys(hwCfg.custom_blocks || {}).length;
  if (count >= MAX_CUSTOM_BLOCKS) {
    alert(`Maximum custom blocks reached (${MAX_CUSTOM_BLOCKS}). Edit or remove an existing custom block before adding another.`);
    return;
  }
  _customDlgTab = tab;
  _cblkSteps    = [];
  _editingKey   = null;
  document.getElementById('cblk-dlg-title').textContent = 'New Custom Block';
  document.getElementById('cblk-confirm-btn').textContent = 'Add Block';
  document.getElementById('cblk-label').value = '';
  document.getElementById('cblk-desc').value  = '';
  document.getElementById('cblk-type').value  = 'action';
  document.getElementById('cblk-dur').value   = 1000;
  document.getElementById('cblk-timeout-action').value = 'abort';
  document.getElementById('cblk-cond-val').value = 100;
  document.getElementById('cblk-stable-ms').value = 0;
  document.getElementById('cblk-relative').checked = false;
  _buildCondSensorSelect(null);
  updateCustomBlockTypeUI();
  _renderStepRows();
  document.getElementById('custom-dlg').style.display = 'flex';
}

function editCustomBlock(key, tab) {
  const def = hwCfg.custom_blocks?.[key];
  if (!def) return;
  _customDlgTab = tab;
  _cblkSteps = JSON.parse(JSON.stringify(def.steps || []));
  _editingKey   = key;
  document.getElementById('cblk-dlg-title').textContent = 'Edit Custom Block';
  document.getElementById('cblk-confirm-btn').textContent = 'Update Block';
  document.getElementById('cblk-label').value = def.label || '';
  document.getElementById('cblk-desc').value  = def.desc  || '';
  document.getElementById('cblk-type').value  = def.type  || 'action';
  document.getElementById('cblk-dur').value   = def.timeout_ms || def.duration_ms || 1000;
  document.getElementById('cblk-timeout-action').value = def.timeout_action || 'abort';
  _buildCondSensorSelect(def.condition?.source || def.condition?.sensor || null);
  if (def.condition) {
    document.getElementById('cblk-cond-op').value  = def.condition.op    || '<';
    document.getElementById('cblk-cond-val').value = def.condition.value ?? 100;
    document.getElementById('cblk-stable-ms').value = def.condition.stable_ms ?? 0;
    document.getElementById('cblk-relative').checked = !!def.condition.relative_to_entry;
  }
  updateCustomBlockTypeUI();
  _renderStepRows();
  document.getElementById('custom-dlg').style.display = 'flex';
}

function closeCustomBlockDialog() {
  document.getElementById('custom-dlg').style.display = 'none';
}

// ------ Condition sensor select ---------------------------------------------------------------------------------------------------------------------------------------------
function _buildCondSensorSelect(selectedKey) {
  const sel = document.getElementById('cblk-cond-sensor');
  const sensors = getEnabledSensors();
  const selectedExists = sensors.some(s => s.key === selectedKey || s.source === selectedKey);
  const missing = selectedKey && !selectedExists
    ? `<option value="${esc(selectedKey)}" data-source="${esc(selectedKey)}" selected>Missing input: ${esc(selectedKey)}</option>` : '';
  sel.innerHTML = sensors.length || missing
    ? missing + sensors.map(s => `<option value="${s.key}" data-source="${esc(s.source || '')}" ${s.key===selectedKey || s.source===selectedKey?'selected':''}>${esc(s.label)}</option>`).join('')
    : '<option value="">No sensors enabled</option>';
  updateCustomCondUI();
}

function updateCustomCondUI() {
  const sensors = getEnabledSensors();
  const key = document.getElementById('cblk-cond-sensor').value;
  const s = sensors.find(s => s.key === key);
  document.getElementById('cblk-cond-unit').textContent = s?.unit ? `(${s.unit})` : '';
  if (s?.bool) {
    document.getElementById('cblk-cond-op').innerHTML = '<option value="==">==</option>';
    document.getElementById('cblk-cond-val').max = 1; document.getElementById('cblk-cond-val').min = 0;
  } else {
    document.getElementById('cblk-cond-op').innerHTML =
      `<option value="<">&lt;</option><option value=">">&gt;</option><option value="<=">&lt;=</option><option value=">=">&gt;=</option>`;
  }
  updateCustomCondPreview();
}

function updateCustomCondPreview() {
  const sensors = getEnabledSensors();
  const sKey = document.getElementById('cblk-cond-sensor').value;
  const s    = sensors.find(s => s.key === sKey);
  const op   = document.getElementById('cblk-cond-op').value;
  const val  = document.getElementById('cblk-cond-val').value;
  const prev = document.getElementById('cblk-cond-preview');
  if (s) {
    prev.style.display = '';
    prev.textContent = `WHILE ${s.label} ${op} ${val}${s.unit ? ' ' + s.unit : ''}`;
  } else {
    prev.style.display = 'none';
  }
}

// ------ Type UI visibility ------------------------------------------------------------------------------------------------------------------------------------------------------------
function updateCustomBlockTypeUI() {
  const type = document.getElementById('cblk-type').value;
  // Steps section: visible for action and while (while can also have steps on completion)
  document.getElementById('cblk-steps-section').style.display   = type !== 'wait' ? '' : 'none';
  document.getElementById('cblk-cond-section').style.display    = type === 'while' ? '' : 'none';
  document.getElementById('cblk-timer-section').style.display   = type !== 'action' ? '' : 'none';
  document.getElementById('cblk-timeout-action-wrap').style.display = type === 'while' ? '' : 'none';
  document.getElementById('cblk-timer-label').textContent =
    type === 'wait' ? 'Duration (ms)' : 'Timeout (ms)';
  if (type === 'while') updateCustomCondPreview();
}

// ------ Steps list ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
function _renderStepRows() {
  const acts = getEnabledActuators();
  const container = document.getElementById('cblk-outputs');
  const empty     = document.getElementById('cblk-outputs-empty');
  container.innerHTML = '';
  _cblkSteps.forEach((step, i) => {
    const row = document.createElement('div');
    row.className = 'cblk-output-row';
    const isDelay = step.type === 'delay_ms';
    const upBtn   = i > 0
      ? `<button class="cblk-mv-btn" onclick="moveStep(${i},-1)" title="Move up" aria-label="Move step up">↑</button>`
      : '<span class="cblk-mv-spacer" aria-hidden="true"></span>';
    const dnBtn   = i < _cblkSteps.length-1
      ? `<button class="cblk-mv-btn" onclick="moveStep(${i},1)" title="Move down" aria-label="Move step down">↓</button>`
      : '<span class="cblk-mv-spacer" aria-hidden="true"></span>';
    if (isDelay) {
      row.innerHTML = `
        <div style="display:flex;gap:3px">${upBtn}${dnBtn}</div>
        <span class="cblk-step-badge" style="background:rgba(0,240,160,0.1);color:var(--green);border:1px solid rgba(0,240,160,0.3)">DELAY</span>
        <input type="number" min="10" max="600000" step="50" value="${step.val??500}"
          oninput="updateStepVal(${i},+this.value)" placeholder="ms" style="text-align:center;max-width:90px">
        <span style="font-size:.7rem;color:var(--dim);align-self:center">ms</span>
        <button class="cblk-rm-btn" onclick="removeStep(${i})">x</button>`;
    } else {
      const act = acts.find(a => a.key === step.act);
      const mode = act?.mode ?? 'relay';
      const missingKey = step.target || step.act;
      const missing = !act && missingKey
        ? `<option value="${esc(step.act || missingKey)}" data-target="${esc(step.target || missingKey)}" selected>Missing output: ${esc(missingKey)}</option>` : '';
      const actOpts = missing + acts.map(a =>
        `<option value="${a.key}" data-target="${esc(a.target || '')}" ${a.key===step.act?'selected':''}>${a.label}</option>`
      ).join('');
      const valCtrl = mode === 'relay'
        ? `<select onchange="updateStepVal(${i},+this.value)" style="max-width:80px">
             <option value="1" ${step.val?'selected':''}>ON</option>
             <option value="0" ${!step.val?'selected':''}>OFF</option>
           </select>`
        : `<input type="number" min="0" max="100" step="5" value="${step.val??50}"
             oninput="updateStepVal(${i},+this.value)" placeholder="%" style="text-align:center;max-width:72px">
           <span style="font-size:.7rem;color:var(--dim);align-self:center">%</span>`;
      row.innerHTML = `
        <div style="display:flex;gap:3px">${upBtn}${dnBtn}</div>
        <span class="cblk-step-badge" style="background:rgba(56,200,255,0.1);color:var(--blue);border:1px solid rgba(56,200,255,0.3)">SET</span>
        <select onchange="updateStepAct(${i},this.value)" style="flex:1;min-width:0">${actOpts}</select>
        ${valCtrl}
        <button class="cblk-rm-btn" onclick="removeStep(${i})">x</button>`;
    }
    container.appendChild(row);
  });
  empty.style.display = _cblkSteps.length ? 'none' : '';
}

function addCustomStep(type) {
  if (_cblkSteps.length >= MAX_CUSTOM_STEPS) {
    alert(`Maximum custom steps reached (${MAX_CUSTOM_STEPS}).`);
    return;
  }
  if (type === 'delay_ms') {
    _cblkSteps.push({type:'delay_ms', val:500});
  } else {
    const acts = getEnabledActuators();
    if (!acts.length) { alert('No actuators enabled in hardware configuration.'); return; }
    _cblkSteps.push({type:'set_act', act: acts[0].key, target: acts[0].target || undefined, val: acts[0].mode === 'relay' ? 1 : 50});
  }
  _renderStepRows();
}
function removeStep(i) {
  _cblkSteps.splice(i, 1);
  _renderStepRows();
}
function moveStep(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= _cblkSteps.length) return;
  [_cblkSteps[i], _cblkSteps[j]] = [_cblkSteps[j], _cblkSteps[i]];
  _renderStepRows();
}
function updateStepAct(i, key) {
  const acts = getEnabledActuators();
  const act  = acts.find(a => a.key === key);
  _cblkSteps[i] = {type:'set_act', act: key, target: act?.target || undefined, val: act?.mode === 'relay' ? 1 : 50};
  _renderStepRows();
}
function updateStepVal(i, val) {
  _cblkSteps[i].val = val;
}

// ------ Build runtime block def from raw stored def ---------------------------------------------------------------------------------
function buildRuntimeBlockDef(key, def) {
  const badgeMap = {action:'badge-action', wait:'badge-wait', while:'badge-while'};
  const sensors  = getEnabledSensors();
  const acts     = getEnabledActuators();
  let condFn = null;
  if (def.condition) {
    const s = sensors.find(s => s.key === def.condition.sensor);
    const sLabel = s ? s.label : def.condition.sensor;
    const unit   = s?.unit ?? '';
    condFn = () => `${sLabel} ${def.condition.op} ${def.condition.value}${unit?' '+unit:''}`;
  } else if (def.type === 'wait') {
    condFn = () => `${def.duration_ms ?? 1000} ms`;
  }
  const timerKey = def.type === 'while' ? 'timeout_ms' : 'duration_ms';
  const timerDef = def.type === 'while' ? (def.timeout_ms ?? 10000) : (def.duration_ms ?? 1000);
  const rawSteps = def.type === 'wait' ? [] : (def.steps || []);
  const stepLines = rawSteps.map((s, idx) => {
    if (s.type === 'delay_ms') return `${idx+1}. DELAY ${s.val} ms`;
    const a = acts.find(a => a.key === s.act);
    const valStr = a?.mode === 'relay' ? (s.val ? 'ON' : 'OFF') : `${s.val}%`;
    return `${idx+1}. SET ${a?.label ?? s.act} -> ${valStr}`;
  });
  const fullDesc = [def.desc, ...stepLines].filter(Boolean).join('\n');
  return {
    label: def.label,
    type: def.type,
    badgeClass: badgeMap[def.type] || 'badge-action',
    condition: condFn,
    timeout_action: def.timeout_action || null,
    desc: fullDesc || def.label,
    params: def.type !== 'action'
      ? [{key: timerKey, label: def.type==='while'?'Timeout':'Duration',
          unit:'ms', type:'int', min:100, max:600000, step:100, def:timerDef}]
      : [],
    _custom: true,
    _def: def,
  };
}

// ------ Confirm (add / update) ------------------------------------------------------------------------------------------------------------------------------------------------
function confirmCustomBlock() {
  const label = document.getElementById('cblk-label').value.trim();
  if (!label) { alert('Enter a block name.'); return; }
  const type = document.getElementById('cblk-type').value;
  const desc = document.getElementById('cblk-desc').value.trim();
  if (!_editingKey && Object.keys(hwCfg.custom_blocks || {}).length >= MAX_CUSTOM_BLOCKS) {
    alert(`Maximum custom blocks reached (${MAX_CUSTOM_BLOCKS}). Edit or remove an existing custom block before adding another.`);
    return;
  }
  if (_cblkSteps.length > MAX_CUSTOM_STEPS) {
    alert(`Custom blocks can contain at most ${MAX_CUSTOM_STEPS} steps.`);
    return;
  }
  if (type === 'action' && _cblkSteps.length === 0) {
    alert('Add at least one step (Set Actuator or Delay) before saving an action block.');
    return;
  }

  const rawDef = { label, type, desc };
  if (type !== 'wait') rawDef.steps = JSON.parse(JSON.stringify(_cblkSteps));

  if (type === 'while') {
    const sKey = document.getElementById('cblk-cond-sensor').value;
    if (!sKey) { alert('Select a sensor for the condition.'); return; }
    rawDef.condition = {
      sensor: sKey,
      op:     document.getElementById('cblk-cond-op').value,
      value:  parseFloat(document.getElementById('cblk-cond-val').value) || 0,
      stable_ms: Math.max(0, parseInt(document.getElementById('cblk-stable-ms').value) || 0),
      relative_to_entry: document.getElementById('cblk-relative').checked,
    };
    const selectedSensor = getEnabledSensors().find(s => s.key === sKey);
    if (selectedSensor?.source) rawDef.condition.source = selectedSensor.source;
    rawDef.timeout_ms      = parseInt(document.getElementById('cblk-dur').value) || 10000;
    rawDef.timeout_action  = document.getElementById('cblk-timeout-action').value;
  } else if (type === 'wait') {
    rawDef.duration_ms = parseInt(document.getElementById('cblk-dur').value) || 1000;
  }

  const key = _editingKey || ('custom_' + Date.now());
  if (!hwCfg.custom_blocks) hwCfg.custom_blocks = {};
  hwCfg.custom_blocks[key] = rawDef;
  customBlocks[key] = buildRuntimeBlockDef(key, rawDef);

  if (!_editingKey) {
    const sk = seqKey(_customDlgTab);
    if (!hwCfg[sk]) hwCfg[sk] = [];
    hwCfg[sk].push(key);
  }

  closeCustomBlockDialog();
  populateAddSelects();
  renderAllTabsWithLiveIdle();
}

// ------ Sequence validation ------------------------------------------------------------------------------------------------------------------------------------------------------------
function _validateSequence(blocks) {
  const warnings = [];
  const has = b => blocks.includes(b);
  const manualFuelWorkflow = has('OilPumpOn') && has('FuelPumpIdle');

  // Must have flame confirmation - otherwise ignition failure goes undetected
  if (!has('FlameConfirm') && !has('TempConfirm')) {
    warnings.push('Timer-based light-up cannot confirm combustion. When a temperature or flame sensor is configured, replace the ignition hold TimedDelay with TempConfirm or FlameConfirm before live engine testing.');
  }
  // Should have oil priming - running without it risks bearing damage
  if (!manualFuelWorkflow && !has('OilPrime')) {
    warnings.push('No OilPrime block. Oil lubrication is not guaranteed before ignition. Add OilPrime early in the sequence to protect engine bearings.');
  }
  // Spool without a SafetyHold means no final RPM/oil sanity check before RUNNING
  if (has('Spool') && !has('SafetyHold')) {
    warnings.push('Spool block present but no SafetyHold. Consider adding SafetyHold after Spool to verify N1 and oil pressure before entering RUNNING.');
  }
  // FuelOpen before StarterSpin risks unspun fuel ingestion
  if (has('FuelOpen') && has('StarterSpin')) {
    const fuelIdx   = blocks.indexOf('FuelOpen');
    const startIdx  = blocks.indexOf('StarterSpin');
    if (fuelIdx < startIdx) {
      warnings.push('Open Main Fuel Shutoff appears before Set Starter. Fuel may enter before rotor airflow is established, risking unburned fuel pooling. Move the starter block before main fuel opens.');
    }
  }
  // SafetyHold without Spool - valid but unusual
  if (has('SafetyHold') && !has('Spool')) {
    warnings.push('SafetyHold present but no Spool block. Without Spool the starter keeps running indefinitely. This may be intentional for air-start configurations.');
  }
  return warnings;
}
