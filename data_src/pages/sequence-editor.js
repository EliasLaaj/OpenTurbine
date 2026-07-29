// Shared HTML-escape for every card/params/selector renderer in this page.
// (Was previously a local inside buildCard, which left buildParamsHtml's
// uses unresolved — a ReferenceError that blanked the whole sequence list.)
function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildCard(bname, idx, tab, total) {
  const def = BLOCKS[bname] || customBlocks[bname];
  const card = document.createElement('div');
  const hardwareMissing = !def || !!(def.visibleIf && !def.visibleIf(hwCfg));
  card.className = `block-card${hardwareMissing ? ' block-hardware-missing' : ''}`;
  card.dataset.block = bname;
  card.dataset.idx   = idx;
  card.dataset.tab   = tab;

  // Build condition text for WHILE blocks
  const hw = flattenHw();
  const condText = bname === 'TimedDelay'
    ? `${timedDelayValue(tab, idx)} ms`
    : (def ? (def.condition ? def.condition(hw) : null) : null);

  // Timeout badge
  let toPill = '';
  if (def?.timeout_action === 'fault')    toPill = `<span class="timeout-pill fault">timer FAULT</span>`;
  else if (def?.timeout_action === 'abort')   toPill = `<span class="timeout-pill abort">timer ABORT</span>`;
  else if (def?.timeout_action === 'continue')toPill = `<span class="timeout-pill cont">timer continue</span>`;
  else if (def?.timeout_action === 'complete')toPill = `<span class="timeout-pill cont">timer completes</span>`;

  const badge = def ? `<span class="block-badge ${esc(def.badgeClass)}">${esc(def.type.toUpperCase())}</span>` : '';
  const condHtml = condText ? `<span class="block-cond">${esc(condText)}</span>` : '';
  const canMoveUp = idx > 0;
  const canMoveDown = idx < total - 1;
  const moveUpHtml = canMoveUp
    ? `<button class="blk-btn icon-btn" onclick="moveBlock('${tab}',${idx},-1)" title="Move up" aria-label="Move block up">^</button>`
    : `<span class="blk-btn-spacer" aria-hidden="true"></span>`;
  const moveDownHtml = canMoveDown
    ? `<button class="blk-btn icon-btn" onclick="moveBlock('${tab}',${idx},+1)" title="Move down" aria-label="Move block down">v</button>`
    : `<span class="blk-btn-spacer" aria-hidden="true"></span>`;

  card.innerHTML = `
  <div class="block-header" title="${esc(def?.desc || 'Sequence block')}" onclick="toggleParams(this)">
    ${badge}
    <span class="block-name">${esc(def?.label ?? bname)}</span>
    ${condHtml}
    ${toPill}
    ${hardwareMissing ? `<span class="block-hardware-pill">${def ? 'Missing hardware' : 'Unknown block'}</span>` : ''}
    <div class="block-actions" onclick="event.stopPropagation()">
      ${moveUpHtml}
      ${moveDownHtml}
      ${customBlocks[bname] ? `<button class="blk-btn" onclick="editCustomBlock('${bname}','${tab}')">Edit</button>` : ''}
      ${BLOCK_INFO[bname] ? `<button class="blk-btn bip-btn" aria-label="Explain ${esc(def?.label ?? bname)}" title="${esc(def?.desc || 'What does this block use?')}" onclick="showBlockInfo('${bname}')">?</button>` : ''}
      <button class="blk-btn del" title="Remove this sequence block" aria-label="Remove this sequence block" onclick="removeBlock('${tab}',${idx})">Remove</button>
    </div>
  </div>
  ${buildParamsHtml(bname, idx, tab)}`;

  return card;
}

function buildSideActionsHtml(tab, idx) {
  ensureActionSlots(tab);
  const acts = getEnabledActuators();
  if (!acts.length) return '';
  const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const phaseHtml = (phase, title) => {
    const key = actionKey(tab, phase);
    const rows = (hwCfg[key]?.[idx] || []).filter(a => actionAllowed(a.act));
    const rowHtml = rows.map((a, ai) => {
      const selectedKey = ACT_KEY_BY_ENUM[Number(a.act)];
      const selectedMeta = acts.find(x => x.key === selectedKey) || acts[0];
      const opts = acts.map(meta => `<option value="${ACT_ENUM[meta.key]}" ${ACT_ENUM[meta.key]===Number(a.act)?'selected':''}>${esc(meta.label)}</option>`).join('');
      const val = actionDisplayValue(a.act, a.value);
      const valCtrl = selectedMeta.mode === 'pct'
        ? `<input class="param-input" type="number" min="0" max="100" step="1" value="${val}" oninput="updateSideAction('${tab}',${idx},'${phase}',${ai},null,this.value)">`
        : `<select class="param-input" onchange="updateSideAction('${tab}',${idx},'${phase}',${ai},null,this.value)">
             <option value="1" ${val ? 'selected' : ''}>ON</option>
             <option value="0" ${!val ? 'selected' : ''}>OFF</option>
           </select>`;
      return `<div class="param-field">
        <span class="param-label">Also set</span>
        <select class="param-input" onchange="updateSideAction('${tab}',${idx},'${phase}',${ai},this.value,null)">${opts}</select>
        <span class="param-label">Demand</span>
        ${valCtrl}
        <button class="blk-btn del" type="button" onclick="removeSideAction('${tab}',${idx},'${phase}',${ai})">Remove</button>
      </div>`;
    }).join('');
    const canAdd = rows.length < 4;
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
  rows.push({ act: ACT_ENUM[first.key], value: first.mode === 'pct' ? 0.5 : 1 });
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
    row.act = Number(newAct);
    row.value = actionStoredValue(row.act, actionDisplayValue(row.act, row.value));
    needsRender = true;
  }
  if (newValue !== null && newValue !== undefined) {
    row.value = actionStoredValue(row.act, newValue);
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
  return bname === 'IgniterOn' || bname === 'IgniterOff' || bname === 'PreHeat';
}

function ignitionTargets() {
  const a = hwCfg.actuators || {};
  const out = [];
  if (actuatorEnabled('igniter')) out.push({v:0, l:'Igniter 1', info: a.igniter?.coil ? 'coil igniter' : (a.igniter?.pwm ? 'PWM igniter' : 'relay igniter')});
  if (actuatorEnabled('igniter2')) out.push({v:1, l:'AB / Pilot Igniter', info: a.igniter2?.coil ? 'coil igniter' : (a.igniter2?.pwm ? 'PWM igniter' : 'relay igniter')});
  if (actuatorEnabled('glow_plug')) {
    const glow = a.glow_plug || {};
    const wet = Number(glow.type || 0) === 2;
    const delayS = ((glow.fuel_delay_ms ?? 8000) / 1000).toFixed(1);
    out.push({v:2, l: wet ? 'Wet glow plug' : 'Glow plug',
      info: wet ? `wet glow plug, pilot fuel starts ${delayS} s after ON` : 'glow plug'});
  }
  return out.length ? out : [{v:0, l:'Igniter 1', info:'ignition output is not configured'}];
}

function ignitionInfoForTarget(target) {
  const found = ignitionTargets().find(t => Number(t.v) === Number(target));
  return found?.info || 'ignition output is not configured';
}

function wetGlowTimingWarning(bname, idx, tab, target) {
  const glow = hwCfg.actuators?.glow_plug || {};
  if (Number(target) !== 2 || Number(glow.type || 0) !== 2) return '';
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
  return `<span class="param-desc" style="display:block;font-size:.65rem;color:var(--yellow);line-height:1.35;margin-top:.22rem">Wet glow pilot fuel delay is ${delayS} s, but the next fuel/confirmation step is about ${waitS} s away. Add delay or increase Pre-Heat time if pilot fuel must be burning first.</span>`;
}

function buildIgnitionTargetHtml(bname, idx, tab) {
  if (!isIgnitionBlock(bname)) return '';
  ensureIgnitionTargetSlots(tab);
  const key = ignitionTargetSeqKey(tab);
  const avail = ignitionTargets();
  let target = hwCfg[key]?.[idx] ?? 0;
  // A stored target that isn't fitted (e.g. the default 0 = Igniter 1 on a
  // glow-only build) would render as the first visible option while the
  // saved value silently stayed stale — snap the stored value to the option
  // the user actually sees.
  if (!avail.some(t => Number(t.v) === Number(target))) {
    target = Number(avail[0].v);
    if (hwCfg[key]) hwCfg[key][idx] = target;
  }
  const opts = avail.map(t => `<option value="${t.v}" ${Number(target)===Number(t.v)?'selected':''}>${t.l}</option>`).join('');
  const esc = v => String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const wetWarn = wetGlowTimingWarning(bname, idx, tab, target);
  return `<div class="param-field" style="margin-bottom:.55rem">
    <span class="param-label">Ignition output</span>
    <select class="param-input" onchange="setIgnitionTarget('${tab}',${idx},this.value)">${opts}</select>
    <span class="param-desc" style="display:block;font-size:.65rem;color:var(--dim);line-height:1.35;margin-top:.18rem">${esc(ignitionInfoForTarget(target))}</span>
    ${wetWarn}
  </div>`;
}

function setIgnitionTarget(tab, idx, value) {
  ensureIgnitionTargetSlots(tab);
  hwCfg[ignitionTargetSeqKey(tab)][idx] = Math.max(0, Math.min(2, Number(value) || 0));
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
  const ignitionHtml = buildIgnitionTargetHtml(bname, idx, tab);
  const hasSharedParams = !!def?.params?.some(p => p.configKey && !(bname === 'TimedDelay' && p.key === 'timed_delay_ms'));
  const sharedNoteHtml = hasSharedParams
    ? `<div style="font-size:.65rem;color:var(--dim);line-height:1.35;margin:.35rem 0 .55rem">Shared setting: parameter changes here apply to every ${def.label || bname} block that uses this setting. Timed Delay values and Igniter output selection are per card.</div>`
    : '';
  if (!def || def.params.length === 0) {
    return `<div class="block-params"><div class="block-desc">${esc(def?.desc ?? '')}</div>${warningHtml}${ignitionHtml}<em style="font-size:.72rem;color:var(--dim)">No configurable parameters.</em>${sideHtml}</div>`;
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

function toggleParams(header) {
  const panel = header.nextElementSibling;
  panel.classList.toggle('open');
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
    renderFast(tab);
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
  const key = seqKey(tab);
  const seq = hwCfg[key];
  if (!seq) return;
  const ni = idx + dir;
  if (ni < 0 || ni >= seq.length) return;
  [seq[idx], seq[ni]] = [seq[ni], seq[idx]];
  ensureDelaySlots(tab);
  ensureActionSlots(tab);
  ensureIgnitionTargetSlots(tab);
  const delays = hwCfg[delaySeqKey(tab)];
  [delays[idx], delays[ni]] = [delays[ni], delays[idx]];
  const targets = hwCfg[ignitionTargetSeqKey(tab)];
  [targets[idx], targets[ni]] = [targets[ni], targets[idx]];
  for (const phase of ['enter','exit']) {
    const ak = actionKey(tab, phase);
    if (!ak || !hwCfg[ak]) continue;
    [hwCfg[ak][idx], hwCfg[ak][ni]] = [hwCfg[ak][ni], hwCfg[ak][idx]];
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
  hwCfg[seqKey(tab)].splice(idx, 1);
  hwCfg[delaySeqKey(tab)].splice(idx, 1);
  hwCfg[ignitionTargetSeqKey(tab)].splice(idx, 1);
  for (const phase of ['enter','exit']) {
    const ak = actionKey(tab, phase);
    if (ak && hwCfg[ak]) hwCfg[ak].splice(idx, 1);
  }
  renderFast(tab);
}

function addBlock(tab) {
  const sel   = document.getElementById('add-' + tab + '-sel');
  const bname = sel.value;
  if (!bname) return;
  const key = seqKey(tab);
  if (!hwCfg[key]) hwCfg[key] = [];
  hwCfg[key].push(bname);
  ensureDelaySlots(tab);
  ensureActionSlots(tab);
  ensureIgnitionTargetSlots(tab);
  hwCfg[delaySeqKey(tab)][hwCfg[key].length - 1] =
    bname === 'TimedDelay' ? (cfg?.sequence?.startup?.timed_delay_ms || 1000) : 0;
  hwCfg[ignitionTargetSeqKey(tab)][hwCfg[key].length - 1] = 0;
  renderFast(tab);
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
      // Hide blocks whose hardware requirement is not met
      if (def?.visibleIf && !def.visibleIf(hwCfg)) return;
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
  const bname = sel?.value;
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
    return Number(channel.i2c_address) >= 0x08 && Number(channel.i2c_address) <= 0x77 &&
      Number(channel.device_channel) >= 0;
  }
  const tempInterface = Number(channel.temp_interface || 0);
  if (tempInterface >= 1 && tempInterface <= 3) {
    return Number(channel.spi_clk) >= 0 && Number(channel.spi_cs) >= 0 &&
      Number(channel.spi_miso) >= 0 && (tempInterface !== 3 || Number(channel.spi_mosi) >= 0);
  }
  return Number(channel.pin) >= 0;
}
function registryInputPurpose(purpose) {
  return (hwCfg.channel_registry?.inputs || []).find(channel =>
    registryChannelInstalled(channel) && String(channel.purpose || channel.id || '') === purpose) || null;
}
function registryOutputPurpose(purpose) {
  return (hwCfg.channel_registry?.outputs || []).find(channel =>
    registryChannelInstalled(channel) && String(channel.purpose || channel.id || '') === purpose) || null;
}
function sequenceHasAfterburner() {
  return !!(registryOutputPurpose('ab_igniter') || registryOutputPurpose('ab_pump') || registryOutputPurpose('ab_valve'));
}

function getEnabledSensors() {
  const s  = hwCfg.sensors    || {};
  const hw = hwCfg;
  const list = [];
  if (registryInputPurpose('oil_temperature'))
                                  list.push({key:'oil_temp',     label:'Oil Temp',         unit:'deg C', def:50,   step:1});
  if (registryInputPurpose('n1_speed'))
                                  list.push({key:'n1_rpm',       label:'N1 RPM',           unit:'rpm',  def:5000, step:100});
  if (registryInputPurpose('n2_speed'))
                                  list.push({key:'n2_rpm',       label:'N2 RPM',           unit:'rpm',  def:5000, step:100});
  if (registryInputPurpose('tot')) list.push({key:'tot', label:'TOT', unit:'deg C', def:200, step:5});
  if (registryInputPurpose('tit')) list.push({key:'tit', label:'TIT', unit:'deg C', def:300, step:5});
  if (registryInputPurpose('oil_pressure')) list.push({key:'oil_press', label:'Oil Pressure', unit:'bar', def:2.0, step:0.1});
  if (registryInputPurpose('fuel_pressure')) list.push({key:'fuel_press', label:'Fuel Pressure', unit:'bar', def:1.0, step:0.1});
  if (registryInputPurpose('battery_voltage')) list.push({key:'batt_voltage', label:'Battery Voltage', unit:'V', def:10, step:0.1});
  if (registryInputPurpose('flame')) list.push({key:'flame', label:'Flame Detected', unit:'', def:1, bool:true});
  if (registryInputPurpose('throttle')) list.push({key:'throttle_in', source:'operator_throttle', label:'Throttle Input', unit:'%', def:0, step:1});
  if (registryInputPurpose('idle')) list.push({key:'idle_in', source:'operator_idle', label:'Idle Input', unit:'%', def:0, step:1});
  if (registryInputPurpose('p1_pressure')) list.push({key:'p1', label:'P1 Pressure', unit:'bar', def:0, step:0.1});
  if (registryInputPurpose('p2_pressure')) list.push({key:'p2', label:'P2 Pressure', unit:'bar', def:0, step:0.1});
  if (registryInputPurpose('fuel_flow')) list.push({key:'fuel_flow', label:'Fuel Flow', unit:'', def:0, step:1});
  if (registryInputPurpose('torque')) list.push({key:'torque', label:'Torque', unit:'Nm', def:0, step:1});
  if (registryInputPurpose('thrust')) list.push({key:'thrust', label:'Thrust', unit:'N', def:0, step:1});
  (hw.di_channels || []).forEach((ch, idx) => {
    if ((ch?.pin ?? -1) >= 0 && idx < 4) list.push({key:'di' + idx, label:ch.label || `DI Channel ${idx + 1}`, unit:'', def:1, bool:true});
  });
  if (registryInputPurpose('ab_flame'))
                                  list.push({key:'ab_flame',   label:'AB Flame',         unit:'',     def:1,    bool:true});
  if ((hw.ab_trigger?.input_pin ?? -1) >= 0)
                                  list.push({key:'ab_input',   label:'AB Input',         unit:'%',    def:50,   step:1});
  const a = hw.actuators || {};
  if (registryOutputPurpose('glow_plug') && a.glow_plug?.has_current)
                                  list.push({key:'glow_current', label:'Glow Current',   unit:'A',    def:1,    step:0.1});
  if (registryOutputPurpose('igniter') && a.igniter?.has_current)
                                  list.push({key:'igniter_current', label:'Igniter 1 Current', unit:'A', def:1, step:0.1});
  if (registryOutputPurpose('ab_igniter') && a.igniter2?.has_current)
                                  list.push({key:'igniter2_current', label:'AB / Pilot Igniter Current', unit:'A', def:1, step:0.1});
  if (registryOutputPurpose('oil_pump') && a.oil_pump?.has_current)
                                  list.push({key:'oil_pump_current', label:'Oil Pump Current', unit:'A', def:1, step:0.1});
  if ((hw.controls?.start_pin ?? -1) >= 0)
                                  list.push({key:'start_switch', label:'Start Switch',   unit:'',     def:1,    bool:true});
  if ((hw.controls?.stop_pin ?? -1) >= 0)
                                  list.push({key:'stop_switch',  label:'Stop Switch',    unit:'',     def:1,    bool:true});
  (hw.channel_registry?.inputs || []).forEach((c, i) => {
    if (!c || c.installed === false || (c.pin ?? -1) < 0) return;
    if (registryInputCoreBound(c)) return;
    const role = String(c.role || '');
    const binary = Number(c.driver) === 0 || ['digital_switch','fault','estop','inhibit_start','sequence_gate','ab_arm','ab_fire','limp_mode','flame'].includes(role);
    const unit = binary ? '' : role === 'speed' ? 'rpm' : role === 'pressure' ? 'bar' : role === 'temperature' ? 'deg C' : role === 'voltage' ? 'V' : role === 'flow' ? 'L/min' : role === 'operator' ? '%' : role === 'generic' ? '0-1' : '';
    const step = role === 'speed' ? 100 : role === 'generic' ? 0.01 : 1;
    list.push({key:c.id, source:c.id, label:registryLabel(c, `Input ${i+1}`), unit, def:binary ? 1 : 0, step, bool:binary});
  });
  return list;
}

function getEnabledActuators() {
  const a    = hwCfg.actuators || {};
  const hasAB = sequenceHasAfterburner();
  const list = [];
  const isOnOff = act => !act || act.type === 2;
  const demandLabel = (act, pctLabel, relayLabel) => isOnOff(act) ? relayLabel : pctLabel;
  const effectiveAct = (fallbackActuator, purpose) => {
    const registry = registryOutputPurpose(purpose);
    return registry ? { ...fallbackActuator, enabled:true, type: Number(registry.driver) === 4 ? 2 : (Number(registry.driver) === 5 ? 1 : 0) } : null;
  };
  const throttleAct = effectiveAct(a.throttle, 'main_fuel');
  const starterAct = effectiveAct(a.starter, 'starter');
  const oilPumpAct = effectiveAct(a.oil_pump, 'oil_pump');
  const propPitchAct = effectiveAct(a.prop_pitch, 'prop_pitch');
  // Always-present outputs (if hardware enabled)
  if (throttleAct) list.push({key:'throttle', label:demandLabel(throttleAct, 'Throttle %', 'Throttle Relay'), mode: isOnOff(throttleAct) ? 'relay':'pct'});
  if (starterAct) list.push({key:'starter', label:demandLabel(starterAct, 'Starter Demand %', 'Starter Relay'), mode: isOnOff(starterAct) ? 'relay':'pct'});
  if (registryOutputPurpose('starter_enable')) list.push({key:'starter_en', label:'Starter Enable Output', mode:'relay'});
  if (oilPumpAct) list.push({key:'oil_pump', label:demandLabel(oilPumpAct, 'Oil Pump %', 'Oil Pump Relay'), mode: isOnOff(oilPumpAct) ? 'relay':'pct'});
  if (registryOutputPurpose('fuel_shutoff')) list.push({key:'fuel_sol', label:'Main Fuel Shutoff', mode:'relay'});
  if (registryOutputPurpose('igniter')) list.push({key:'igniter', label:'Igniter 1', mode:'relay'});
  if (registryOutputPurpose('ab_igniter')) list.push({key:'igniter2', label:hasAB ? 'Afterburner Igniter' : 'AB / Pilot Igniter', mode:'relay'});
  if (registryOutputPurpose('air_starter')) list.push({key:'airstarter_sol', label:'Air Starter Valve', mode:'relay'});
  if (registryOutputPurpose('cooling_fan')) list.push({key:'cool_fan', label:'Cooling Fan', mode:'relay'});
  if (registryOutputPurpose('scavenge_pump')) list.push({key:'oil_scavenge_pump', label:'Oil Scavenge Pump', mode:'relay'});
  if (registryOutputPurpose('bleed_valve') || registryOutputPurpose('valve')?.id === 'bleed_valve') list.push({key:'bleed_valve', label:'Bleed Valve', mode:'relay'});
  if (registryOutputPurpose('glow_plug')) list.push({key:'glow_plug', label:Number(registryOutputPurpose('glow_plug').driver) === 4 ? 'Glow Plug Relay' : 'Glow Plug %', mode:Number(registryOutputPurpose('glow_plug').driver) === 4 ? 'relay':'pct'});
  const fuelPump2Act = effectiveAct(a.fuel_pump2, 'fuel_pump');
  if (fuelPump2Act) list.push({key:'fuel_pump2', label:demandLabel(fuelPump2Act, 'Pilot / Auxiliary Fuel Pump %', 'Pilot / Auxiliary Fuel Pump Relay'), mode:isOnOff(fuelPump2Act) ? 'relay':'pct'});
  if (propPitchAct) list.push({key:'prop_pitch', label:demandLabel(propPitchAct, 'Prop Pitch %', 'Prop Pitch Relay'), mode: isOnOff(propPitchAct) ? 'relay':'pct'});
  // AB outputs
  if (hasAB && registryOutputPurpose('ab_valve')) list.push({key:'ab_sol', label:'Afterburner Fuel Valve', mode:'relay'});
  const abPumpAct = effectiveAct(a.ab_pump, 'ab_pump');
  if (hasAB && abPumpAct) list.push({key:'ab_pump', label:demandLabel(abPumpAct, 'AB Fuel Pump %', 'AB Fuel Pump Relay'), mode:isOnOff(abPumpAct) ? 'relay':'pct'});
  (hwCfg.channel_registry?.outputs || []).forEach((c, i) => {
    if (!c || c.installed === false || (c.pin ?? -1) < 0 || registryOutputCoreBound(c)) return;
    const relay = Number(c.driver) === 4;
    list.push({key:c.id, target:c.id, label:registryLabel(c, `Output ${i+1}`) + (relay ? '' : ' %'), mode:relay ? 'relay':'pct'});
  });
  return list;
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
  sel.innerHTML = sensors.length
    ? sensors.map(s => `<option value="${s.key}" data-source="${esc(s.source || '')}" ${s.key===selectedKey || s.source===selectedKey?'selected':''}>${esc(s.label)}</option>`).join('')
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
      ? `<button class="cblk-mv-btn" onclick="moveStep(${i},-1)" title="Move up" aria-label="Move step up">^</button>`
      : '<span class="cblk-mv-spacer" aria-hidden="true"></span>';
    const dnBtn   = i < _cblkSteps.length-1
      ? `<button class="cblk-mv-btn" onclick="moveStep(${i},1)" title="Move down" aria-label="Move step down">v</button>`
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
      const actOpts = acts.map(a =>
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
      warnings.push('Open Main Fuel Shutoff appears before Starter Spin to Light-Off Speed. Fuel may enter before rotor airflow is established, risking unburned fuel pooling. Move the starter-spin block before main fuel opens.');
    }
  }
  // SafetyHold without Spool - valid but unusual
  if (has('SafetyHold') && !has('Spool')) {
    warnings.push('SafetyHold present but no Spool block. Without Spool the starter keeps running indefinitely. This may be intentional for air-start configurations.');
  }
  return warnings;
}
