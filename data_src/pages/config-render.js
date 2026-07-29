// ── JSON path helpers ─────────────────────────────────────────
function getPath(obj, path) {
  return path.reduce((cur, k) => (cur != null && typeof cur === 'object' ? cur[k] : undefined), obj);
}
function setPath(obj, path, val) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (cur[path[i]] == null || typeof cur[path[i]] !== 'object') cur[path[i]] = {};
    cur = cur[path[i]];
  }
  cur[path[path.length - 1]] = val;
}

// ── Render form ───────────────────────────────────────────────
const WORKSPACE_GROUPS = [
  { id:'engine', title:'Engine & Limits', desc:'One protection card per measured engine quantity, plus normal throttle response', sections:['Engine Protection Limits','Throttle Response','Gradual Fuel Limit Protection'] },
  { id:'oil', title:'Oil & Lubrication', desc:'Startup, running and windmilling oil protection', sections:['Oil System','Windmilling Oil Protection'] },
  { id:'operation', title:'Start, Run & Recovery', desc:'Idle control, relight, cooldown overrides, pulsed starter assist and glow', sections:['Automatic Idle Control','Reduced-Power Mode','Automatic Flameout Relight','Manual Relight and Cooldown Override','Pulsed Starter Assist','Glow Plug Preheat'] },
  { id:'safety', title:'Safety & Input Health', desc:'Combustion, startup, auxiliary-system and input-loss protection', sections:['Combustion & Startup Protection','Auxiliary Protection','RPM Sensor Fault Detection','RC / Servo Signal Loss Detection'] },
  { id:'power', title:'Power System', desc:'Automatic N2 speed control and afterburner tuning', sections:['Automatic N2 Speed Control','Afterburner — Ignition Conditions','Afterburner — Ignition Method','Afterburner — Flame Confirmation','Afterburner — Running'] },
  { id:'data', title:'Runtime & Display', desc:'Advanced ECU scheduling and optional cluster thresholds', sections:['ECU Runtime','External Instrument Cluster Display'] },
];
const SECTION_GROUP = new Map(WORKSPACE_GROUPS.flatMap(group => group.sections.map(title => [title, group.id])));
let _workspaceFilter = 'essential';
let _currentView = 'basic';
let _searchQuery = '';
let _workspaceRefreshFrame = 0;

function _scheduleWorkspaceRefresh() {
  cancelAnimationFrame(_workspaceRefreshFrame);
  _workspaceRefreshFrame = requestAnimationFrame(applyView);
}

function setWorkspaceFilter(filter) {
  _workspaceFilter = ['essential','configured','explore','changed'].includes(filter) ? filter : 'essential';
  _currentView = _workspaceFilter === 'essential' ? 'basic' : 'expert';
  applyView();
}

function _fieldIsHardwareInactive(field) {
  if (!field) return false;
  const section = field.closest('.cfg-section');
  return field.dataset.hardwareUnavailable === '1' ||
    field.dataset.forceHidden === '1' ||
    section?.dataset.hardwareUnavailable === '1' ||
    section?.dataset.forceHidden === '1';
}

function _fieldInactiveReason(field) {
  if (!field) return '';
  const section = field.closest('.cfg-section');
  return field.dataset.inactiveReason ||
    section?.dataset.inactiveReason ||
    'This setting has no effect until its required hardware or controller is configured.';
}

function _refreshDependencyEditability() {
  const explore = _workspaceFilter === 'explore';
  const futureEditMode = explore || _workspaceFilter === 'changed';
  document.querySelector('.cfg-workspace')?.classList.toggle('explore-active', explore);
  document.getElementById('cfg-form')?.classList.toggle('config-explore', futureEditMode);

  document.querySelectorAll('.cfg-field').forEach(field => {
    const inactive = _fieldIsHardwareInactive(field);
    const logicallyDisabled = field.dataset.logicalDisabled === '1' || field.dataset.hardHidden === '1';
    const control = field.querySelector('input,select');
    // Future tuning values may be prepared before their hardware is installed,
    // but an enable checkbox must never be armed while its prerequisites are
    // absent. Otherwise adding hardware later could unexpectedly activate a
    // controller or protection with uncommissioned settings.
    const activationLocked = inactive && control?.type === 'checkbox';
    const inactiveEditable = inactive && futureEditMode && !activationLocked;
    field.classList.toggle('cfg-field-inactive', inactive);
    field.classList.toggle('inactive-editable', inactiveEditable && !isLocked && !logicallyDisabled);

    let badge = field.querySelector('.cfg-inactive-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'cfg-inactive-badge';
      badge.textContent = 'Inactive';
      field.querySelector('.cfg-field-head')?.appendChild(badge);
    }
    let note = field.querySelector('.cfg-inactive-note');
    if (!note) {
      note = document.createElement('div');
      note.className = 'cfg-inactive-note';
      field.appendChild(note);
    }
    note.textContent = inactive
      ? (activationLocked
          ? 'Cannot be enabled until its prerequisites are configured. ' + _fieldInactiveReason(field)
          : futureEditMode
          ? 'Saved for future use; inactive now. ' + _fieldInactiveReason(field)
          : _fieldInactiveReason(field))
      : '';
    if (control) control.disabled = isLocked || logicallyDisabled || (inactive && (!futureEditMode || activationLocked));
  });

  document.querySelectorAll('select option[data-hardware-unavailable]').forEach(option => {
    const inactive = option.dataset.hardwareUnavailable === '1';
    // Missing sensor/output choices stay unavailable in every view. Selecting
    // one is an activation decision, not harmless future-value tuning.
    option.disabled = inactive;
    option.textContent = (option.dataset.baseLabel || option.textContent) +
      (inactive ? ' (not configured)' : '');
  });
}

function setConfigSearch(value) {
  _searchQuery = String(value || '').trim().toLowerCase();
  applyView();
}

function _updateWorkspaceState() {
  const changes = _buildChanges();
  const count = changes.length;
  const state = document.getElementById('cfg-state-badge');
  const saveCount = document.getElementById('save-change-count');
  const discard = document.getElementById('btn-discard');
  const save = document.getElementById('btn-save');
  if (state) state.textContent = count ? `${count} unsaved` : 'Saved';
  if (saveCount) saveCount.textContent = count ? `${count} unsaved change${count === 1 ? '' : 's'}` : 'No unsaved changes';
  if (discard) discard.disabled = !count;
  if (save) save.disabled = isLocked || !count;
}

function applyView() {
  const search = _searchQuery;
  _refreshDependencyEditability();
  let visibleFields = 0;
  document.querySelectorAll('.cfg-field').forEach(field => {
    const hardHidden = field.dataset.hardHidden === '1';
    const unavailable = _fieldIsHardwareInactive(field);
    const keepUnavailableVisible = field.dataset.keepUnavailableVisible === '1';
    const essential = field.dataset.level === 'essential';
    const bench = field.closest('.config-group')?.dataset.group === 'bench';
    const changed = !!field.querySelector('.field-changed');
    const haystack = field.dataset.search || '';
    const searchMatch = !search || search.split(/\s+/).every(token => haystack.includes(token));
    let show = false;
    if (!hardHidden && searchMatch) {
      if (search) show = true;
      else if (_workspaceFilter === 'essential') show = essential && (!unavailable || keepUnavailableVisible) && !bench;
      else if (_workspaceFilter === 'configured') show = !unavailable || keepUnavailableVisible;
      else if (_workspaceFilter === 'explore') show = true;
      else if (_workspaceFilter === 'changed') show = changed;
    }
    field.classList.toggle('filter-hidden', !show);
    field.classList.toggle('search-hit', !!search && show);
    if (show) visibleFields++;
  });

  document.querySelectorAll('.cfg-section').forEach(section => {
    const fields = Array.from(section.querySelectorAll('.cfg-field'));
    const count = fields.filter(field => !field.classList.contains('filter-hidden')).length;
    const featureHidden = section.dataset.forceHidden === '1' ||
      section.dataset.hardwareUnavailable === '1';
    const hiddenBench = ['tools-primary-section','tools-accessory-section','tools-ab-section'].includes(section.id) && _workspaceFilter !== 'configured' && _workspaceFilter !== 'explore' && !search;
    const hideUnavailableFeature = featureHidden && _workspaceFilter !== 'explore' && !search;
    section.classList.toggle('filter-hidden', hideUnavailableFeature || count === 0 || hiddenBench);
    section.classList.toggle('feature-unavailable', featureHidden);
    section.classList.toggle('search-reveal', featureHidden && !!search);
    if (featureHidden && !section.dataset.unavailableBound) {
      section.dataset.unavailableBound = '1';
      section.querySelector('.cfg-title')?.addEventListener('click', () => {
        section.classList.toggle('unavailable-open');
      });
    }
    const badge = section.querySelector('.cfg-title-count');
    if (badge) badge.textContent = count ? `${count} setting${count === 1 ? '' : 's'}` : '';
  });

  document.querySelectorAll('.protection-card').forEach(card => {
    const count = card.querySelectorAll('.cfg-field:not(.filter-hidden)').length;
    card.classList.toggle('filter-hidden', count === 0);
    if ((_searchQuery || _workspaceFilter === 'changed') && count) card.open = true;
  });

  document.querySelectorAll('.config-group').forEach(group => {
    const sections = Array.from(group.querySelectorAll('.cfg-section'));
    const shownSections = sections.filter(section => !section.classList.contains('filter-hidden'));
    const count = shownSections.reduce((sum, section) => sum + section.querySelectorAll('.cfg-field:not(.filter-hidden)').length, 0);
    group.classList.toggle('filter-hidden', count === 0);
    const meta = group.querySelector('.group-meta');
    if (meta) meta.textContent = count ? `${count} setting${count === 1 ? '' : 's'}` : '';
    if ((search || _workspaceFilter === 'changed') && count) group.open = true;
  });

  // Field filtering runs before feature-gated sections are resolved. Recount
  // after the section/group pass so hidden governor/afterburner children never
  // inflate the result total or create an apparently empty expandable group.
  visibleFields = Array.from(document.querySelectorAll('.cfg-field:not(.filter-hidden)'))
    .filter(field => !field.closest('.cfg-section')?.classList.contains('filter-hidden') &&
                     !field.closest('.config-group')?.classList.contains('filter-hidden')).length;

  const empty = document.getElementById('cfg-empty');
  if (empty) empty.hidden = visibleFields !== 0;
  const result = document.getElementById('cfg-result-count');
  if (result) result.textContent = `${visibleFields} setting${visibleFields === 1 ? '' : 's'}`;
  const buttonMap = { essential:'btn-view-basic', configured:'btn-view-expert', explore:'btn-view-explore', changed:'btn-filter-changed' };
  Object.entries(buttonMap).forEach(([name,id]) => {
    const button = document.getElementById(id);
    if (!button) return;
    const active = _workspaceFilter === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  _updateWorkspaceState();
}

function initWorkspaceControls() {
  const search = document.getElementById('cfg-search');
  if (search && !search.dataset.bound) {
    search.dataset.bound = '1';
    search.addEventListener('input', () => setConfigSearch(search.value));
    search.addEventListener('keydown', event => {
      if (event.key === 'Escape') { search.value = ''; setConfigSearch(''); search.blur(); }
    });
  }
  document.querySelectorAll('.config-group').forEach(group => {
    const key = 'ot_cfg_group_' + group.dataset.group;
    try {
      const stored = sessionStorage.getItem(key);
      if (stored !== null) group.open = stored === '1';
    } catch (e) {}
    group.addEventListener('toggle', () => {
      if (_searchQuery || _workspaceFilter === 'changed') return;
      try { sessionStorage.setItem(key, group.open ? '1' : '0'); } catch (e) {}
    });
  });
  if (!document.documentElement.dataset.cfgKeysBound) {
    document.documentElement.dataset.cfgKeysBound = '1';
    document.addEventListener('keydown', event => {
      const tag = event.target?.tagName;
      if (event.key === '/' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
        event.preventDefault(); document.getElementById('cfg-search')?.focus();
      }
    });
  }
}

function setCfgFieldVisibleByElement(wrap, show) {
  if (!wrap) return;
  wrap.dataset.forceHidden = show ? '0' : '1';
  wrap.title = show ? '' : 'Unavailable with the current fitted hardware or controller selection.';
  if (!show && !wrap.dataset.inactiveReason) {
    wrap.dataset.inactiveReason = 'Unavailable with the current fitted hardware or controller selection.';
  }
  _refreshDependencyEditability();
  _scheduleWorkspaceRefresh();
}

function setCfgFieldVisible(key, show) {
  const el = document.getElementById('cf-' + key);
  setCfgFieldVisibleByElement(el?.closest('.cfg-field'), show);
}
function setCfgFieldHardHidden(key, hidden) {
  const wrap=document.getElementById('cf-'+key)?.closest('.cfg-field');
  if(!wrap)return;
  wrap.dataset.hardHidden=hidden?'1':'0';
  _scheduleWorkspaceRefresh();
}
function keepUnavailableFieldVisible(key) {
  const wrap = document.getElementById('cf-' + key)?.closest('.cfg-field');
  if (wrap) wrap.dataset.keepUnavailableVisible = '1';
}

// Mode-specific tuning fields appear only when their controller selects the
// advanced algorithm; the workspace then exposes them under Configured system.
// The field's own description also rewrites to explain the CURRENTLY selected
// mode, so picking Simple or Advanced shows exactly what that choice does.
const _RL_MODE_DESC = {
  0: 'Simple (reactive) — original behaviour: throttle eases back based on the shaft\'s current RPM as it approaches the soft limit.',
  1: 'Advanced (predictive) — anticipates RPM from its rate of rise (spool rate) and eases fuel off BEFORE an overshoot during a fast spool, then slows the throttle-open ramp as RPM nears the limit. EGT pullback stays reactive. Tune with the fields below in Configured system.'
};
const _DI_MODE_DESC = {
  0: 'Simple (PI) — original behaviour: a proportional-integral loop holds the idle RPM setpoint.',
  1: 'Advanced (decel-catch) — on a fast chop from high RPM it drops just below a learned idle-hold so it settles without hanging high or dipping toward flameout; near idle it trims against predicted RPM and re-learns the hold. Tune with the fields below in Configured system.'
};
function _setFieldDesc(key, text) {
  const el = document.getElementById('cf-' + key);
  const wrap = el ? el.closest('.cfg-field') : null;
  const d = wrap ? wrap.querySelector('.cfg-desc') : null;
  if (d) d.textContent = text;
}
function updateRpmLimiterFields() {
  const adv = parseInt((document.getElementById('cf-rl_mode') || {}).value || 0) === 1;
  _setFieldDesc('rl_mode', _RL_MODE_DESC[adv ? 1 : 0]);
  ['rl_look', 'rl_ramp', 'rl_zone', 'rl_acc'].forEach(k => setCfgFieldVisible(k, adv));
}
function updateIdleModeFields() {
  const adv = parseInt((document.getElementById('cf-di_mode') || {}).value || 0) === 1;
  _setFieldDesc('di_mode', _DI_MODE_DESC[adv ? 1 : 0]);
  ['di_de', 'di_dd', 'di_lk', 'di_sb', 'di_fr', 'di_tu', 'di_td', 'di_lr', 'di_la'].forEach(k => setCfgFieldVisible(k, adv));
}
function updateIdleSourceFields() {
  const source = parseInt((document.getElementById('cf-di_src') || {}).value || 0, 10);
  const pressure = source >= 2;
  ['di_tr','di_db','di_rl'].forEach(k => setCfgFieldHardHidden(k, pressure));
  ['di_tp','di_pd','di_pl'].forEach(k => setCfgFieldHardHidden(k, !pressure));
  _setFieldDesc('di_src', pressure
    ? 'Experimental pressure-based idle feedback. Validate stability carefully on a restrained test setup; N1/N2 shaft speed remains the normal proven method.'
    : 'N1/N2 shaft-speed feedback is the normal proven method for automatic idle control.');
}

function _fieldToDisplay(f, value) {
  let out = value;
  if (f.zeroOff && Number(out) === 0) return 0;
  if (f.unitType === 'temp') out = toDispTemp(out);
  else if (f.unitType === 'temp_delta' || f.unitType === 'temp_rate') out = toDispTempDelta(out);
  else if (f.unitType === 'press') out = toDispPress(out);
  return f.scale ? out * f.scale : out;
}

function _fieldFromDisplay(f, value) {
  if (f.zeroOff && Number(value) === 0) return 0;
  let out = f.scale ? value / f.scale : value;
  if (f.unitType === 'temp') return fromDispTemp(out);
  if (f.unitType === 'temp_delta' || f.unitType === 'temp_rate') return fromDispTempDelta(out);
  if (f.unitType === 'press') return fromDispPress(out);
  return out;
}

function _fieldStepToDisplay(f, value) {
  let out = value;
  if (f.unitType === 'temp' || f.unitType === 'temp_delta' || f.unitType === 'temp_rate') {
    out = tempUnit() === 'F' ? out * 9 / 5 : out;
  } else if (f.unitType === 'press') {
    out = toDispPress(out);
  }
  return f.scale ? out * f.scale : out;
}

function _roundedDisplay(value) {
  return String(Math.round(value * 1000) / 1000);
}

function _fieldDef(key) {
  for (const sec of SCHEMA) {
    const found = sec.fields.find(f => f.key === key);
    if (found) return found;
  }
  return null;
}

function _switchConfigUnit(unitTypes, setter, nextUnit) {
  const fields = [];
  SCHEMA.forEach(sec => sec.fields.forEach(f => {
    if (!unitTypes.includes(f.unitType)) return;
    const el = document.getElementById('cf-' + f.key);
    if (!el || el.type === 'checkbox') return;
    const current = parseFloat(el.value);
    const snap = parseFloat(_fieldSnap[el.id]);
    fields.push({
      f, el,
      current: isNaN(current) ? null : _fieldFromDisplay(f, current),
      snap: isNaN(snap) ? null : _fieldFromDisplay(f, snap)
    });
  }));
  setter(nextUnit);
  fields.forEach(({ f, el, current, snap }) => {
    if (current !== null) el.value = _roundedDisplay(_fieldToDisplay(f, current));
    if (snap !== null) _fieldSnap[el.id] = _roundedDisplay(_fieldToDisplay(f, snap));
    if (f.min !== undefined) el.min = _roundedDisplay(_fieldToDisplay(f, f.min));
    if (f.max !== undefined) el.max = _roundedDisplay(_fieldToDisplay(f, f.max));
    if (f.step !== undefined) el.step = _roundedDisplay(_fieldStepToDisplay(f, f.step));
  });
  _refreshChangedBorders();
  runValidation();
}

function setConfigTempUnit(value) {
  _switchConfigUnit(['temp', 'temp_delta', 'temp_rate'], setTempUnit, value);
}

function setConfigPressUnit(value) {
  _switchConfigUnit(['press'], setPressUnit, value);
}

function renderForm() {
  const protectionGroups = [
    {id:'n1', title:'N1 core speed', desc:'Gradual fuel reduction, overspeed shutdown, and minimum running speed.',
      keys:['pb_n1e','pb_n1s','pb_n1h','rpm_limit','min_rpm']},
    {id:'n2', title:'N2 output-shaft speed', desc:'Gradual fuel reduction and independent power-turbine overspeed shutdown.',
      keys:['pb_n2e','pb_n2s','pb_n2h','n2_rpm_limit']},
    {id:'egt', title:'Turbine temperature', desc:'Select TOT/TIT, reduce fuel near the limit, then shut down at the hard limit.',
      keys:['eg_src','pb_egte','pb_egts','pb_egth','tot_limit','sf_tit','tot_safe_margin']},
    {id:'p1', title:'P1 compressor-inlet pressure', desc:'Gradual fuel reduction followed by an optional high-pressure shutdown.',
      keys:['pb_p1e','pb_p1s','pb_p1h','sf_p1t']},
    {id:'p2', title:'P2 compressor-discharge pressure', desc:'Gradual fuel reduction followed by an optional high-pressure shutdown.',
      keys:['pb_p2e','pb_p2s','pb_p2h','sf_p2t']},
    {id:'torque', title:'Shaft torque', desc:'Gradual fuel reduction followed by an optional over-torque shutdown.',
      keys:['pb_tqe','pb_tqs','pb_tqh','sf_tqt']},
    {id:'shared', title:'Shared protection behavior', desc:'Fuel floor, response strength, prediction, and hard-trip confirmation.',
      keys:['pb_min','pb_str','rl_mode','rl_look','rl_ramp','rl_zone','rl_acc','sf_pt_d']},
  ];
  const gradualSection = SCHEMA.find(section => section.title === 'Gradual Fuel Limit Protection');

  const renderField = (f, sec, group) => {
    let val = getPath(cfg, f.path);
    const isCb  = f.type === 'checkbox';
    const isSel = f.type === 'select';
    if (!isCb && !isSel && (f.unitType || f.scale) && val !== undefined) {
      val = _fieldToDisplay(f, val);
      val = Math.round(val * 1000) / 1000;
    }
    const isTempUnit = f.unitType === 'temp' || f.unitType === 'temp_delta';
    const unitSuffix = (!isSel && f.unitType)
      ? f.unitType === 'temp_rate'
        ? ` (<span data-unit="temp">${dispTempUnit()}</span>/s)`
        : ` (<span data-unit="${isTempUnit ? 'temp' : 'press'}">${isTempUnit ? dispTempUnit() : dispPressUnit()}</span>)`
      : (!isSel && f.unit ? ` (${f.unit})` : '');
    const min = (!isCb && !isSel && f.min !== undefined) ? ` min="${_roundedDisplay(_fieldToDisplay(f, f.min))}"` : '';
    const max = (!isCb && !isSel && f.max !== undefined) ? ` max="${_roundedDisplay(_fieldToDisplay(f, f.max))}"` : '';
    const step = (!isCb && !isSel) ? _roundedDisplay(_fieldStepToDisplay(f, f.step || 1)) : null;
    const inp = isCb
      ? `<input type="checkbox" id="cf-${f.key}"${val ? ' checked' : ''}${isLocked ? ' disabled' : ''}>`
      : isSel
      ? `<select id="cf-${f.key}"${isLocked ? ' disabled' : ''}>${(f.options||[]).map(o => `<option value="${o.v}"${val == o.v ? ' selected' : ''}>${o.l}</option>`).join('')}</select>`
      : `<input type="number" id="cf-${f.key}" value="${val !== undefined ? val : ''}"
        step="${step}"${min}${max}${isLocked ? ' disabled' : ''}>`;
    const wid = f.wrapId ? ` id="${f.wrapId}"` : '';
    const level = f.basic ? 'essential' : 'advanced';
    const searchText = `${f.key} ${f.label} ${f.desc} ${sec.title} ${sec.sectionNote || ''} ${group.title}`.toLowerCase();
    return `<div class="cfg-field"${wid} data-key="${f.key}" data-level="${level}" data-search="${_escHtml(searchText)}">
      <div class="cfg-field-head"><div class="cfg-label">${f.label}${unitSuffix}</div>
        ${level === 'advanced' ? '<span class="field-level">Advanced</span>' : ''}</div>
      ${inp}
      <details class="cfg-help"><summary>About this setting</summary><div class="cfg-desc">${f.desc}</div></details>
    </div>`;
  };

  const renderSection = (sec, group) => {
    if (sec.title === 'Gradual Fuel Limit Protection') return '';
    const noteHtml = sec.sectionNote
      ? `<div style="font-size:.72rem;color:var(--dim);background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:5px;padding:.35rem .65rem;margin:.25rem 0 .5rem;line-height:1.5">${sec.sectionNote}</div>`
      : '';
    const isProtection = sec.id === 'engine-limits';
    const displayTitle = isProtection ? 'Engine Limits & Protection' : sec.title;
    const allProtectionFields = isProtection ? [...sec.fields, ...(gradualSection?.fields || [])] : sec.fields;
    const fieldHtml = isProtection
      ? `<div class="protection-stack">${protectionGroups.map((card, index) => {
          const fields = card.keys.map(key => allProtectionFields.find(field => field.key === key)).filter(Boolean);
          return `<details class="protection-card" data-protection="${card.id}"${index < 3 ? ' open' : ''}>
            <summary><span><span class="protection-card-title">${card.title}</span><span class="protection-card-desc">${card.desc}</span></span><span class="protection-card-chevron">›</span></summary>
            <div class="cfg-grid">${fields.map(field => renderField(field, sec, group)).join('')}</div>
          </details>`;
        }).join('')}</div>`
      : `<div class="cfg-grid">${sec.fields.map(field => renderField(field, sec, group)).join('')}</div>`;
    return `
    <section class="cfg-section"${sec.id ? ` id="${sec.id}"` : ''} data-section="${_escHtml(sec.title)}">
      <div class="cfg-title">${displayTitle}<span class="cfg-title-count"></span></div>
      ${noteHtml}${fieldHtml}
    </section>`;
  };

  const sectionByTitle = new Map(SCHEMA.map(section => [section.title, section]));
  const groupsHtml = WORKSPACE_GROUPS.map((group, index) => {
    const sections = group.sections.map(title => sectionByTitle.get(title)).filter(Boolean);
    return `<details class="config-group" data-group="${group.id}"${index === 0 ? ' open' : ''}>
      <summary>
        <span class="group-heading"><span class="group-title">${group.title}</span><span class="group-desc">${group.desc}</span></span>
        <span class="group-meta"></span><span class="group-chevron" aria-hidden="true">›</span>
      </summary>
      <div class="group-content">${sections.map(section => renderSection(section, group)).join('')}</div>
    </details>`;
  }).join('');
  document.getElementById('cfg-form').innerHTML = groupsHtml +
    '<div id="cfg-empty" class="cfg-empty" hidden>No settings match this search and filter.</div>';
  initWorkspaceControls();

  document.getElementById('btn-save').disabled = isLocked || !_cfgDirty;
  document.getElementById('lock-warn').style.display = isLocked ? '' : 'none';

  // Inject live sensor badges next to relevant fields
  injectLiveBadges();

  // Show/hide oil map max field based on throttle-map toggle
  applyOilMapVisibility();

  // Wire AB ignition method conditional fields
  applyAbIgnitionParamVisibility();
  const _abUtEl = document.getElementById('cf-ab_ut');
  const _abFmEl = document.getElementById('cf-ab_fm');
  if (_abUtEl) _abUtEl.addEventListener('change', applyAbIgnitionParamVisibility);
  if (_abFmEl) _abFmEl.addEventListener('change', applyAbIgnitionParamVisibility);
  const _egSrcEl = document.getElementById('cf-eg_src');
  if (_egSrcEl) _egSrcEl.addEventListener('change', () => {
    applyHwConditions();
    applyFlameoutRelightVisibility();
    runValidation();
  });
  const _flSrcEl = document.getElementById('cf-sf_fs');
  const _rlSrcEl = document.getElementById('cf-rl_cs');
  if (_flSrcEl) _flSrcEl.addEventListener('change', applyFlameoutRelightVisibility);
  if (_rlSrcEl) _rlSrcEl.addEventListener('change', applyFlameoutRelightVisibility);
  applyFlameoutRelightVisibility();

  // Wire RPM-limiter & dynamic-idle advanced-mode conditional fields
  updateRpmLimiterFields();
  updateIdleModeFields();
  updateIdleSourceFields();
  const _rlModeEl = document.getElementById('cf-rl_mode');
  const _diModeEl = document.getElementById('cf-di_mode');
  const _diSourceEl = document.getElementById('cf-di_src');
  if (_rlModeEl) _rlModeEl.addEventListener('change', () => { updateRpmLimiterFields(); applyView(); });
  if (_diModeEl) _diModeEl.addEventListener('change', () => { updateIdleModeFields(); applyView(); });
  if (_diSourceEl) _diSourceEl.addEventListener('change', () => { updateIdleSourceFields(); applyHwConditions(); applyView(); runValidation(); });

  // Mark form dirty whenever any input changes
  const cfgForm = document.getElementById('cfg-form');
  if (cfgForm) {
    cfgForm.addEventListener('input',  _markDirty, { passive: true });
    cfgForm.addEventListener('change', _markDirty, { passive: true });
  }

  // Apply current view filter
  applyView();
}
