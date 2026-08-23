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

function controllerChannelName(row) {
  if (!row) return '';
  const purposeNames = {
    throttle:'Throttle Input', idle:'Idle Input', n1_speed:'N1 Speed', n2_speed:'N2 Speed',
    oil_pressure:'Oil Pressure', main_fuel:'Main Fuel Pump', oil_pump:'Oil Pump',
    prop_pitch:'Propeller Pitch', ab_pump:'Afterburner Fuel Pump'
  };
  const raw = String(row.name || '').trim();
  const internalLooking = !raw || raw === String(row.id || '') ||
    /^(operator|primary|generic)_[a-z0-9_]+$/i.test(raw);
  return internalLooking ? (purposeNames[row.purpose] || 'Configured channel') : raw;
}

function _resolveControllerChannelId(value, rows, kind, numericValue) {
  const raw = String(value || '');
  const exact = rows.find(row => String(row.id) === raw);
  if (exact) return exact.id;
  const inputAliases = {oil_temp:'oil_temperature',tot:'tot',n1_rpm:'n1_speed',oil_press:'oil_pressure',tit:'tit',batt_v:'battery_voltage',n2_rpm:'n2_speed',fuel_press:'fuel_pressure',fuel_flow:'fuel_flow',p1:'p1',p2:'p2',torque:'torque',flame:'flame',throttle_input:'throttle',idle_input:'idle',ab_flame:'ab_flame',ab_input:'ab_input',start_switch:'start_switch',stop_switch:'stop_switch',thrust:'thrust'};
  const outputAliases = {cool_fan:'cooling_fan',bleed_valve:'bleed_valve',fuel_pump2:'fuel_pump',oil_scavenge:'oil_scavenge',throttle:'main_fuel',main_fuel:'main_fuel',starter:'starter',starter_enable:'starter_enable',oil_pump:'oil_pump',fuel_sol:'fuel_shutoff',igniter:'igniter',igniter2:'ab_igniter',ab_sol:'ab_fuel',ab_pump:'ab_pump',air_starter:'air_starter',glow_plug:'glow_plug',prop_pitch:'prop_pitch'};
  const aliases = kind === 'input' ? inputAliases : outputAliases;
  const purpose = aliases[raw] || raw;
  const byPurpose = rows.find(row => String(row.purpose) === purpose || String(row.role) === purpose);
  if (byPurpose) return byPurpose.id;
  const n = Number(numericValue);
  if (Number.isFinite(n)) {
    if (n >= 64 && rows[n - 64]) return rows[n - 64].id;
    const legacy = kind === 'input'
      ? ['oil_temperature','tot','n1_speed','oil_pressure','tit','battery_voltage','n2_speed','di0','di1','di2','di3','fuel_pressure','fuel_flow','p1','p2','torque','flame','throttle','idle','ab_flame','glow_current','igniter_current','igniter2_current','oil_pump_current','ab_input','start_switch','stop_switch','thrust'][n]
      : ['cooling_fan','bleed_valve','fuel_pump','oil_scavenge','main_fuel','starter','starter_enable','oil_pump','fuel_shutoff','igniter','ab_igniter','ab_fuel','ab_pump','','','air_starter','glow_plug','prop_pitch'][n];
    const found = rows.find(row => String(row.purpose) === legacy || String(row.role) === legacy);
    if (found) return found.id;
  }
  return raw;
}

function openControllerSection(anchor) {
  setWorkspaceFilter('configured');
  requestAnimationFrame(() => {
    const target = document.getElementById(anchor);
    if (!target) return;
    const group = target.closest('.config-group, .control-definition-card');
    if (group && 'open' in group) group.open = true;
    history.replaceState(null, '', `#${anchor}`);
    target.scrollIntoView({behavior:'smooth', block:'start'});
    target.classList.add('search-hit');
    setTimeout(() => target.classList.remove('search-hit'), 1800);
  });
}

function _controllerRuleForOutput(channel, index) {
  return (cfg.rules || []).find((rule) => {
    const target = String(rule.target || rule.actuator_id || '');
    return target === String(channel.id || '') || Number(rule.actuator) === 64 + index;
  });
}

function _removeControllerRuleForOutput(channel, index) {
  const before = (cfg.rules || []).length;
  cfg.rules = (cfg.rules || []).filter(rule => {
    const target = String(rule.target || rule.actuator_id || '');
    return target !== String(channel.id || '') && Number(rule.actuator) !== 64 + index;
  });
  if (cfg.rules.length !== before) _controllerRulesDirty = true;
}

function _defaultRuleForOutput(channel) {
  const inputs = simpleControlInputs();
  const relay = [4,11].includes(Number(channel.driver));
  const throttle = inputs.find(row => String(row.purpose) === 'throttle');
  const source = throttle || inputs[0];
  const minFuel = String(channel.purpose) === 'main_fuel'
    ? Math.max(0, Math.min(1, Number(cfg?.throttle?.fuel_pump_min_pct || 0) / 100)) : 0;
  return {enabled:true,kind:relay?0:1,op:0,threshold:0,hysteresis:0,on_value:1,off_value:0,
    input_min:0,input_max:1,output_min:minFuel,output_max:1,mode_mask:4,
    target_source_type:0,target_source:'',target_fixed:0,target_low:0,target_high:1,
    target_input_min:0,target_input_max:1,response_gain:.02,integral_gain:.005,deadband:.01,
    name:`${controllerChannelName(channel)} control`.slice(0,31),source:source?.id || '',target:channel.id};
}

function createControllerForOutput(outputId) {
  const outputs = simpleControlOutputs();
  const channel = outputs.find(row => String(row.id) === String(outputId));
  if (!channel || !simpleControlInputs().length || (cfg.rules || []).some(rule => String(rule.target) === String(outputId))) return;
  const purpose = String(channel.purpose || '');
  hwCfg.controllers ||= {};
  if (purpose === 'main_fuel' || purpose === 'prop_pitch') hwCfg.controllers.governor = false;
  if (purpose === 'oil_pump') {
    hwCfg.oil_loops = (hwCfg.oil_loops || []).filter(loop => String(loop.pump_output) !== String(channel.id));
    hwCfg.controllers.oil_loop = !!hwCfg.oil_loops.some(loop => loop.enabled !== false);
  }
  cfg.rules ||= [];
  cfg.rules.push(_defaultRuleForOutput(channel));
  _controllerRulesDirty = true;
  _controllerHardwareDirty = true;
  _markDirty();
  renderForm(true);
  _applyAllVisibility();
  applyView();
  runValidation();
}

function migrateLegacyControllerDefinitions() {
  if (Number(cfg?.controller_schema || 0) >= 1) return false;
  const outputs = simpleControlOutputs();
  const inputs = simpleControlInputs();
  cfg.rules ||= [];
  const owns = output => cfg.rules.some(rule =>
    _resolveControllerChannelId(rule.target, outputs, 'output', rule.actuator) === output.id);
  const mainFuel = outputs.find(row => String(row.purpose) === 'main_fuel');
  const propPitch = outputs.find(row => String(row.purpose) === 'prop_pitch');
  const throttle = inputs.find(row => String(row.purpose) === 'throttle');
  const n2 = inputs.find(row => String(row.purpose) === 'n2_speed');
  let hardwareChanged = false;

  if (hwCfg.controllers?.governor && n2) {
    const usePitch = propPitch && Number(cfg?.governor?.pitch_kp || 0) > 0;
    const output = usePitch ? propPitch : mainFuel;
    if (output && !owns(output)) {
      const rule = _defaultRuleForOutput(output);
      rule.name = `${controllerChannelName(output)} N2 control`.slice(0,31);
      rule.kind = 2;
      rule.source = n2.id;
      rule.target_source_type = throttle ? 2 : 0;
      rule.target_source = throttle?.id || '';
      rule.target_fixed = Number(cfg?.governor?.target_rpm || 0);
      rule.target_input_min = 0;
      rule.target_input_max = 1;
      rule.target_low = Number(cfg?.governor?.target_rpm || 0);
      rule.target_high = Number(cfg?.governor?.target_rpm || 0);
      rule.response_gain = Math.max(0, Number(cfg?.governor?.kp || .00025));
      rule.deadband = Math.max(0, Number(cfg?.governor?.band_rpm || 500));
      cfg.rules.push(rule);
    }
    hwCfg.controllers.governor = false;
    hardwareChanged = true;
  } else if (mainFuel && throttle && !owns(mainFuel)) {
    const rule = _defaultRuleForOutput(mainFuel);
    rule.name = 'Main Fuel';
    rule.kind = 1;
    rule.source = throttle.id;
    cfg.rules.push(rule);
  }

  cfg.controller_schema = 1;
  _controllerRulesDirty = true;
  if (hardwareChanged) _controllerHardwareDirty = true;
  return true;
}

function renderControllerOverview() {
  const root = document.getElementById('controller-overview');
  if (!root || CONFIG_SURFACE !== 'controllers') return;
  const outputs = (hwCfg?.channel_registry?.outputs || []).filter(row => row && row.installed !== false);
  const rules = cfg.rules || [];
  const ignitionTarget = Number(cfg?.relight?.ignition_target || 0);
  const manualIgnitionTarget = Number(cfg?.misc?.igniter_on_start_target || 0);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const configuredCards = [...document.querySelectorAll('#simple-controls [data-controller-card]')];
  const configuredIds = new Set(rules.map(rule => String(rule.target || '')));
  const transitionPurposes = new Set(['starter','igniter','ab_igniter','ab_pump','ab_fuel','ab_fuel_shutoff','glow_plug']);
  const behaviorPurposes = new Set([...transitionPurposes,'oil_pump']);
  const behaviorCards = outputs.filter(channel => behaviorPurposes.has(String(channel.purpose)) && !configuredIds.has(String(channel.id))).map(channel => {
    const purpose = String(channel.purpose);
    const name = controllerChannelName(channel);
    const descriptions = {
      starter:['Startup sequence', 'StarterSpin owns transition demand; optional starter shaping stays here.'],
      igniter:['Startup / relight logic', 'Sequence owns startup ignition; enabled relight behavior may energize it while running.'],
      glow_plug:['Glow preheat / relight logic', 'Sequence owns preheat timing; the preheat profile and relight behavior stay here.'],
      ab_igniter:['Afterburner ignition sequence', 'The AB state machine owns ignition and fault shutdown.'],
      ab_pump:['Afterburner running metering', 'AB sequence owns entry and shutdown; this card owns running fuel metering.'],
      ab_fuel:['Afterburner sequence', 'AB fuel opens only after the configured entry gates pass.'],
      ab_fuel_shutoff:['Afterburner sequence', 'AB fuel opens only after the configured entry gates pass.'],
      oil_pump:['Sequence / windmilling protection', 'No normal pressure controller is assigned; transition and standby oil behavior remains available.']
    };
    let d = descriptions[purpose] || ['Sequence / direct command','Transition-owned output'];
    if (purpose === 'oil_pump') {
      const loop = (hwCfg.oil_loops || []).find(row => row.enabled !== false && String(row.pump_output) === String(channel.id));
      if (loop) d = ['Oil pressure feedback', 'Pressure target and pump response are configured here.'];
    }
    return `<details class="control-definition-card config-group" data-group="behavior-${esc(channel.id)}" data-behavior-output="${esc(channel.id)}" data-purpose="${esc(purpose)}"><summary><span class="group-heading"><span class="group-title">${esc(name)}</span><span class="control-path">${esc(d[0])}<span class="arrow">→</span>${esc(name)}</span><span class="group-desc">${esc(d[1])}</span></span><span class="group-chevron">›</span></summary><div class="controller-card-body"><div class="controller-local-settings" data-controller-settings="${esc(channel.id)}"></div></div></details>`;
  }).join('');
  const cooldownCard = `<details class="control-definition-card config-group" data-group="behavior-cooldown" data-behavior-output="cooldown" data-purpose="cooldown"><summary><span class="group-heading"><span class="group-title">Shutdown Cooldown</span><span class="control-path">Shutdown state<span class="arrow">→</span>Cooldown completion</span><span class="group-desc">Temperature target and deliberate manual skip</span></span><span class="group-chevron">›</span></summary><div class="controller-card-body"><div class="controller-local-settings" data-controller-settings="cooldown"></div></div></details>`;
  const available = outputs.filter(channel => !configuredIds.has(String(channel.id)) && !transitionPurposes.has(String(channel.purpose)));
  const availableHtml = available.length ? `<div class="controller-create-card" data-always-visible="1"><div class="controller-create-title">+ Add controller</div><div class="controller-create-body"><label class="cfg-field"><span class="cfg-label">What do you want to control?</span><select id="new-controller-output">${available.map(row=>`<option value="${esc(row.id)}">${esc(controllerChannelName(row))}</option>`).join('')}</select><span class="cfg-desc">Only fitted outputs without a normal owner are offered.</span></label><button type="button" class="primary" onclick="createControllerForOutput(document.getElementById('new-controller-output').value)">Create controller</button></div></div>` : '<div class="control-empty">Every fitted normal-operation output already has an owner.</div>';
  root.innerHTML = `<div class="control-overview-head"><div><h2>What controls what</h2><p>Open a controller to change its source, method, target, mapping, and tuning. One normal owner per output.</p></div></div><div id="configured-controller-cards" class="controller-definition-list"></div>${behaviorCards}${cooldownCard}<div class="controller-create-wrap">${availableHtml}</div>`;
  const list = document.getElementById('configured-controller-cards');
  configuredCards.forEach(card => list?.appendChild(card));
  root.style.display = '';
  _mountControllerLocalSettings(outputs);
}

function _mountControllerLocalSettings(outputs) {
  const sectionMap = {
    main_fuel:['throttle','idle-control-cfg-section','reduced-power-section'],
    starter:['starter-support-section'],
    igniter:['relight-section','manual-relight-section'],
    glow_plug:['glow-cfg-section'],
    oil_pump:['windmilling-oil-section'],
    ab_pump:['ab-cfg-section','ab-flame-section','ab-run-section'],
    ab_igniter:['ab-ign-section']
  };
  const localSectionIds = new Set(Object.values(sectionMap).flat().concat(['cooldown-section','oil-config-section','governor-cfg-section']));
  const mounted = new Set();
  const wrapSection = (host, section, title, desc='') => {
    if (!section) return null;
    const card = document.createElement('details');
    card.className = 'protection-card controller-subcard';
    card.dataset.subcard = title;
    card.innerHTML = `<summary><span><span class="protection-card-title">${_escHtml(title)}</span>${desc?`<span class="protection-card-desc">${_escHtml(desc)}</span>`:''}</span><span class="protection-card-chevron">›</span></summary><div class="controller-subcard-content"></div>`;
    card.querySelector('.controller-subcard-content').appendChild(section);
    host.appendChild(card);
    mounted.add(section.id);
    return card;
  };
  const mountOilLoop = (host, channel) => {
    const pressures = controllerInputs('oil_pressure');
    const pumps = controllerOutputs('oil_pump');
    const loopIndex = (hwCfg.oil_loops || []).findIndex(loop => String(loop.pump_output) === String(channel.id));
    if (loopIndex < 0) {
      const empty = document.createElement('div');
      empty.className = 'controller-empty-action';
      empty.innerHTML = pressures.length
        ? `<span>No pressure-feedback controller is assigned. Sequence and direct commands can still operate this pump.</span><button type="button" onclick="addControllerOilLoop('${_escHtml(String(channel.id))}')">+ Add pressure controller</button>`
        : '<span>No pressure-feedback controller is assigned. Fit an oil-pressure input to add one; sequence and direct commands remain available.</span>';
      host.appendChild(empty);
      return;
    }
    const loop = hwCfg.oil_loops[loopIndex];
    const binary = [4,11].includes(Number(channel.driver));
    const source = Number(loop.target_source || 0);
    const options = (rows, selected) => rows.map(row => `<option value="${_escHtml(row.id)}"${String(row.id)===String(selected)?' selected':''}>${_escHtml(controllerChannelName(row))}</option>`).join('');
    const number = (key,label,value,step,min=0,max='',percent=false) => `<label class="cfg-field"><span class="cfg-label">${_escHtml(label)}${percent?' (%)':''}</span><input type="number" min="${min}"${max!==''?` max="${max}"`:''} step="${step}" value="${Number(value)}" onchange="updateControllerOilLoop(${loopIndex},'${key}',+this.value${percent?'/100':''})"></label>`;
    const pressure = (key,label,value,step,max=20) => `<label class="cfg-field"><span class="cfg-label">${_escHtml(label)} (${dispPressUnit()})</span><input type="number" min="0" max="${toDispPress(max)}" step="${toDispPress(step)}" value="${Math.round(toDispPress(Number(value))*1000)/1000}" onchange="updateControllerOilLoop(${loopIndex},'${key}',fromDispPress(+this.value))"></label>`;
    const card = document.createElement('details');
    card.className = 'protection-card controller-subcard';
    card.dataset.subcard = 'Oil Pressure Control';
    card.innerHTML = `<summary><span><span class="protection-card-title">Oil Pressure Control</span><span class="protection-card-desc">${binary?'On/off pressure regulation':'Variable pressure regulation'}</span></span><span class="protection-card-chevron">›</span></summary><div class="controller-subcard-content"><div class="cfg-grid">
      <label class="cfg-field"><span class="cfg-label">Pressure feedback</span><select onchange="updateControllerOilLoop(${loopIndex},'pressure_input',this.value)">${options(pressures,loop.pressure_input)}</select></label>
      <label class="cfg-field"><span class="cfg-label">Controlled pump</span><select onchange="updateControllerOilLoop(${loopIndex},'pump_output',this.value)">${options(pumps,loop.pump_output)}</select></label>
      <label class="cfg-field"><span class="cfg-label">Pressure target set by</span><select onchange="updateControllerOilLoop(${loopIndex},'target_source',+this.value)"><option value="0"${source===0?' selected':''}>Fixed pressure</option><option value="1"${source===1?' selected':''}>Main fuel demand</option>${controllerInputs('n1_speed').length?`<option value="2"${source===2?' selected':''}>N1 speed</option>`:''}${controllerInputs('n2_speed').length?`<option value="3"${source===3?' selected':''}>N2 speed</option>`:''}</select></label>
      ${pressure('target_bar',source===0?'Pressure target':'Low pressure target',loop.target_bar??2.5,.01)}
      ${source!==0?pressure('target_high_bar','High pressure target',loop.target_high_bar??2.5,.01):''}
      ${source>=2?number('speed_min_rpm','Low shaft speed (RPM)',loop.speed_min_rpm??0,100,0,1000000):''}
      ${source>=2?number('speed_max_rpm','High shaft speed (RPM)',loop.speed_max_rpm??20000,100,0,1000000):''}
      ${pressure('deadband_bar','Pressure deadband',loop.deadband_bar??.2,.01,5)}
      ${binary?'':number('response_gain','Response gain',loop.response_gain??1.8,.05,0,100)}
      ${binary?'':number('min_demand','Minimum pump command',Math.round(Number(loop.min_demand??.18)*100),1,0,100,true)}
      ${binary?'':number('max_demand','Maximum pump command',Math.round(Number(loop.max_demand??1)*100),1,0,100,true)}
      ${number('failsafe_delay_ms','Feedback-loss delay (ms)',loop.failsafe_delay_ms??1500,100,0,60000)}
      ${number('failsafe_demand','Feedback-loss pump command',Math.round(Number(loop.failsafe_demand??.6)*100),1,0,100,true)}
      <div class="cfg-field"><button type="button" class="danger" onclick="removeControllerOilLoop(${loopIndex})">Remove pressure controller</button></div>
    </div></div>`;
    host.appendChild(card);
  };
  outputs.forEach((channel) => {
    const host = document.querySelector(`[data-controller-settings="${CSS.escape(String(channel.id))}"]`);
    if (!host) return;
    if (String(channel.purpose) === 'main_fuel') {
      const idleAvailable = controllerInputs('n1_speed').length || controllerInputs('n2_speed').length || controllerInputs('p1_pressure').length || controllerInputs('p2_pressure').length;
      wrapSection(host, document.getElementById('throttle'), 'Throttle Response', 'Normal operator-demand movement and sensitivity');
      const idleCard = wrapSection(host, document.getElementById('idle-control-cfg-section'), 'Idle', 'Minimum normal-running fuel authority');
      if (idleCard) {
        idleCard.querySelector('.controller-subcard-content').insertAdjacentHTML('afterbegin', `<div class="controller-option-row" data-always-visible="1"><label><input type="checkbox" ${hwCfg.controllers?.dynamic_idle?'checked':''} ${idleAvailable?'':'disabled'} onchange="setControllerEnabled('dynamic_idle',this.checked)"> Automatic Idle</label><span>${idleAvailable?'Hold fitted shaft-speed or pressure feedback by adjusting the idle fuel floor.':'Fit N1, N2, P1, or P2 feedback to enable automatic idle.'}</span></div>`);
      }
      wrapSection(host, document.getElementById('reduced-power-section'), 'Reduced-Power Mode', 'Fuel cap used after selected feedback is lost or when requested manually');
      return;
    }
    if (String(channel.purpose) === 'oil_pump') mountOilLoop(host, channel);
    (sectionMap[String(channel.purpose || '')] || []).forEach(id => {
      if (mounted.has(id)) return;
      const section = document.getElementById(id);
      if (section) wrapSection(host, section, section.dataset.section || section.querySelector('.cfg-title')?.textContent || 'Settings');
    });
  });
  const cooldownHost = document.querySelector('[data-controller-settings="cooldown"]');
  if (cooldownHost) wrapSection(cooldownHost, document.getElementById('cooldown-section'), 'Cooldown', 'How SHUTDOWN decides that cooling is complete');
  localSectionIds.forEach(id => {
    if (mounted.has(id)) return;
    document.getElementById(id)?.remove();
  });
  document.querySelectorAll('#cfg-form .config-group').forEach(group => {
    if (!group.querySelector('.cfg-section')) group.remove();
  });
  const assignment = document.getElementById('controller-hardware-setup');
  if (assignment && !assignment.textContent.trim()) assignment.remove();
}

function simpleControlInputs() {
  return (hwCfg?.channel_registry?.inputs || []).filter(row => row && row.installed !== false);
}
function simpleControlOutputs() {
  return (hwCfg?.channel_registry?.outputs || []).filter(row =>
    row && row.installed !== false &&
    !['ab_pump','ab_fuel','ab_fuel_shutoff','ab_igniter'].includes(String(row.purpose || '')));
}
function feedbackDefaultsForInput(id) {
  const row = simpleControlInputs().find(input => String(input.id) === String(id));
  const purpose = String(row?.purpose || '');
  if (purpose === 'n1_speed' || purpose === 'n2_speed' || purpose === 'shaft_speed')
    return {response_gain:0.00001,integral_gain:0.000001,deadband:100};
  if (purpose.includes('pressure')) return {response_gain:0.1,integral_gain:0.02,deadband:0.05};
  if (purpose.includes('temperature') || purpose === 'tot' || purpose === 'tit')
    return {response_gain:0.005,integral_gain:0.001,deadband:1};
  return {response_gain:0.02,integral_gain:0.005,deadband:0.01};
}
function updateSimpleControl(index, key, value) {
  const rule = cfg.rules?.[index];
  if (!rule) return;
  rule[key] = value;
  _controllerRulesDirty = true;
  if (key === 'kind') {
    // Changing topology removes the runtime effect of fields that no longer
    // apply. Defaults remain unsurprising if the user changes back later.
    if (Number(value) === 0) {
      rule.threshold ??= 0;
      rule.hysteresis ??= 0;
      rule.on_value ??= 1;
      rule.off_value ??= 0;
    } else if (Number(value) === 1) {
      rule.input_min ??= 0;
      rule.input_max ??= 1;
      rule.output_min ??= 0;
      rule.output_max ??= 1;
    } else {
      const tuning = feedbackDefaultsForInput(rule.source);
      rule.target_source_type ??= 0;
      rule.target_source ??= '';
      rule.target_fixed ??= 0;
      rule.target_low ??= 0;
      rule.target_high ??= 1;
      rule.target_input_min ??= 0;
      rule.target_input_max ??= 1;
      rule.output_min ??= 0;
      rule.output_max ??= 1;
      rule.off_value ??= 0;
      Object.entries(tuning).forEach(([field, fallback]) => rule[field] ??= fallback);
    }
  }
  if (key === 'source' && Number(rule.kind) === 2)
    Object.assign(rule, feedbackDefaultsForInput(value));
  if (key === 'target_source_type' && Number(value) !== 0 && !rule.target_source)
    rule.target_source = simpleControlInputs()[0]?.id || '';
  if (key === 'target') {
    const target = simpleControlOutputs().find(row => String(row.id) === String(value));
    if (target && [4,11].includes(Number(target.driver)) && Number(rule.kind) !== 0)
      rule.kind = 0;
  }
  _markDirty();
  renderForm(true);
  _applyAllVisibility();
  applyView();
  runValidation();
}
function toggleSimpleControlMode(index, bit, checked) {
  const rule = cfg.rules?.[index];
  if (!rule) return;
  const current = Number(rule.mode_mask ?? 4) & 0x0f;
  rule.mode_mask = checked ? (current | bit) : (current & ~bit);
  _controllerRulesDirty = true;
  _markDirty();
}
function addSimpleControl() {
  const inputs = simpleControlInputs();
  const outputs = simpleControlOutputs();
  const used = new Set((cfg.rules || []).map(rule => String(rule.target || '')));
  const output = outputs.find(row => !used.has(String(row.id || '')));
  if (!inputs.length || !output || (cfg.rules || []).length >= 16) return;
  cfg.rules ||= [];
  cfg.rules.push({enabled:true,kind:0,op:0,threshold:0,hysteresis:0,on_value:1,off_value:0,
    input_min:0,input_max:1,output_min:0,output_max:1,mode_mask:4,
    target_source_type:0,target_source:'',target_fixed:0,target_low:0,target_high:1,
    target_input_min:0,target_input_max:1,response_gain:.02,integral_gain:.005,deadband:.01,
    name:`${output.name || output.id} control`.slice(0,31),source:inputs[0].id,target:output.id});
  _controllerRulesDirty = true;
  _markDirty();
  renderForm(true);
  _applyAllVisibility();
  applyView();
  runValidation();
}
function removeSimpleControl(index) {
  const rule = cfg.rules?.[index];
  const target = simpleControlOutputs().find(row => String(row.id) === String(rule?.target));
  if (String(target?.purpose || '') === 'main_fuel') {
    hwCfg.controllers ||= {};
    hwCfg.controllers.dynamic_idle = false;
    hwCfg.controllers.governor = false;
    _controllerHardwareDirty = true;
  }
  cfg.rules?.splice(index, 1);
  _controllerRulesDirty = true;
  _markDirty();
  renderForm(true);
  _applyAllVisibility();
  applyView();
  runValidation();
}

function controllerInputs(purpose) {
  return (hwCfg?.channel_registry?.inputs || []).filter(row => row && row.installed !== false && String(row.purpose || '') === purpose);
}
function controllerOutputs(purpose) {
  return (hwCfg?.channel_registry?.outputs || []).filter(row => row && row.installed !== false && String(row.purpose || '') === purpose);
}
function markControllerHardwareDirty() {
  _controllerHardwareDirty = true;
  _markDirty();
  renderForm(true);
  _applyAllVisibility();
  applyView();
  runValidation();
}
function setControllerEnabled(key, enabled) {
  hwCfg.controllers ||= {};
  hwCfg.controllers[key] = !!enabled;
  markControllerHardwareDirty();
}
function setSafetyEnabled(key, enabled) {
  hwCfg.safety ||= {};
  hwCfg.safety[key] = !!enabled;
  markControllerHardwareDirty();
}
function controllerSafetyToggle(key, label, available, requirement, locked = false) {
  const checked = !!hwCfg?.safety?.[key];
  return `<div class="safety-local-toggle"><label><input type="checkbox" ${checked?'checked':''} ${available&&!locked?'':'disabled'} onchange="setSafetyEnabled('${key}',this.checked)"> ${label} enabled</label><span>${available?'Independent safety override; its limits are configured here.':requirement}</span></div>`;
}
function updateControllerOilLoop(index, key, value) {
  const loop = hwCfg.oil_loops?.[index];
  if (!loop) return;
  loop[key] = value;
  markControllerHardwareDirty();
}
function addControllerOilLoop(pumpOutputId = '') {
  hwCfg.oil_loops ||= [];
  const used = new Set(hwCfg.oil_loops.map(loop => String(loop.pump_output || '')));
  const pressure = controllerInputs('oil_pressure')[0];
  const pump = controllerOutputs('oil_pump').find(row =>
    !used.has(String(row.id || '')) && (!pumpOutputId || String(row.id) === String(pumpOutputId)));
  const maxLoops = Math.max(1, Number(hwCfg?._capabilities?.max_oil_loops || 6));
  if (!pressure || !pump || hwCfg.oil_loops.length >= maxLoops) return;
  hwCfg.oil_loops.push({enabled:true,id:`oil${hwCfg.oil_loops.length + 1}`,pressure_input:pressure.id,pump_output:pump.id,
    target_source:0,target_bar:2.5,target_high_bar:2.5,speed_min_rpm:0,speed_max_rpm:20000,
    deadband_bar:.2,response_gain:1.8,failsafe_delay_ms:1500,failsafe_demand:.6,min_demand:.18,max_demand:1});
  hwCfg.controllers ||= {};
  hwCfg.controllers.oil_loop = true;
  markControllerHardwareDirty();
}
function removeControllerOilLoop(index) {
  hwCfg.oil_loops?.splice(index, 1);
  hwCfg.controllers ||= {};
  hwCfg.controllers.oil_loop = !!hwCfg.oil_loops?.some(loop => loop.enabled !== false);
  markControllerHardwareDirty();
}
function renderControllerHardwareSetup() {
  const root = document.getElementById('controller-hardware-setup');
  if (!root || CONFIG_SURFACE !== 'controllers') return;
  // Dedicated owner toggles and oil-loop cards used to form a second control
  // system above the editable definitions. The output-first controller cards
  // now own this workflow; keep this mount empty while older runtime helpers
  // remain available during the targeted migration.
  root.innerHTML = '';
  return;
  // Legacy renderer retained below until the runtime migration is complete.
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const optionRows = (rows, selected) => rows.map(row => `<option value="${esc(row.id)}"${String(row.id)===String(selected)?' selected':''}>${esc(row.name || row.id)}</option>`).join('');
  const n1 = controllerInputs('n1_speed').length > 0;
  const n2 = controllerInputs('n2_speed').length > 0;
  const fuel = controllerOutputs('main_fuel').length > 0;
  const pressures = controllerInputs('oil_pressure');
  const pumps = controllerOutputs('oil_pump');
  const num = (i,key,label,value,step,min=0,max='') => `<label class="cfg-field"><span class="cfg-label">${label}</span><input type="number" min="${min}"${max!==''?` max="${max}"`:''} step="${step}" value="${Number(value)}" onchange="updateControllerOilLoop(${i},'${key}',+this.value)"></label>`;
  const loops = hwCfg.oil_loops || [];
  const loopCards = loops.map((loop,i) => {
    const pump = pumps.find(row => row.id === loop.pump_output);
    const binary = pump && [4,11].includes(Number(pump.driver));
    const source = Number(loop.target_source || 0);
    return `<details class="protection-card"><summary><span><span class="protection-card-title">${esc(pump?.name || `Oil system ${i+1}`)}</span><span class="protection-card-desc">${binary?'On/off pressure control':'Proportional pressure control'}</span></span><span class="protection-card-chevron">›</span></summary><div class="cfg-grid">
      <label class="cfg-field"><span class="cfg-label">Pressure input</span><select onchange="updateControllerOilLoop(${i},'pressure_input',this.value)">${optionRows(pressures,loop.pressure_input)}</select></label>
      <label class="cfg-field"><span class="cfg-label">Pump output</span><select onchange="updateControllerOilLoop(${i},'pump_output',this.value)">${optionRows(pumps,loop.pump_output)}</select></label>
      <label class="cfg-field"><span class="cfg-label">Pressure target set by</span><select onchange="updateControllerOilLoop(${i},'target_source',+this.value)"><option value="0"${source===0?' selected':''}>Fixed pressure</option><option value="1"${source===1?' selected':''}>Main fuel demand</option>${n1?`<option value="2"${source===2?' selected':''}>N1 speed</option>`:''}${n2?`<option value="3"${source===3?' selected':''}>N2 speed</option>`:''}</select></label>
      ${num(i,'target_bar',source===0?'Pressure target (bar)':'Low pressure target (bar)',loop.target_bar??2.5,.01)}
      ${source!==0?num(i,'target_high_bar','High pressure target (bar)',loop.target_high_bar??2.5,.01):''}
      ${source>=2?num(i,'speed_min_rpm','Low shaft speed (RPM)',loop.speed_min_rpm??0,100):''}
      ${source>=2?num(i,'speed_max_rpm','High shaft speed (RPM)',loop.speed_max_rpm??20000,100):''}
      ${num(i,'deadband_bar','Pressure deadband (bar)',loop.deadband_bar??.2,.01)}
      ${binary?'':num(i,'response_gain','Response gain',loop.response_gain??1.8,.05)}
      ${binary?'':`<label class="cfg-field"><span class="cfg-label">Minimum pump command (%)</span><input type="number" min="0" max="100" step="1" value="${Math.round(Number(loop.min_demand??.18)*100)}" onchange="updateControllerOilLoop(${i},'min_demand',+this.value/100)"></label>`}
      ${binary?'':`<label class="cfg-field"><span class="cfg-label">Maximum pump command (%)</span><input type="number" min="0" max="100" step="1" value="${Math.round(Number(loop.max_demand??1)*100)}" onchange="updateControllerOilLoop(${i},'max_demand',+this.value/100)"></label>`}
      ${num(i,'failsafe_delay_ms','Feedback-loss delay (ms)',loop.failsafe_delay_ms??1500,100,0,60000)}
      <label class="cfg-field"><span class="cfg-label">Feedback-loss pump command (%)</span><input type="number" min="0" max="100" step="1" value="${Math.round(Number(loop.failsafe_demand??.6)*100)}" onchange="updateControllerOilLoop(${i},'failsafe_demand',+this.value/100)"></label>
      <div class="cfg-field"><button type="button" class="danger" onclick="removeControllerOilLoop(${i})">Remove this oil controller</button></div>
    </div></details>`;
  }).join('');
  const maxLoops = Math.max(1, Number(hwCfg?._capabilities?.max_oil_loops || 6));
  const canAddOil = pressures.length && pumps.some(p => !loops.some(loop => loop.pump_output === p.id)) && loops.length < maxLoops;
  root.innerHTML = `<div class="cfg-title">Controller assignments</div><div class="cfg-desc">Hardware defines what exists. Enable the normal controllers that should own those outputs; their tuning stays with the controller below.</div>
    <div class="control-overview-grid" style="margin-top:.7rem"><article class="control-summary-card"><h3>Automatic idle</h3><label><input type="checkbox" ${hwCfg.controllers?.dynamic_idle?'checked':''} ${fuel&&(n1||n2)?'':'disabled'} onchange="setControllerEnabled('dynamic_idle',this.checked)"> Enabled</label><div class="control-summary-meta">${fuel&&(n1||n2)?'Maintains the minimum normal-running fuel authority':'Requires Main Fuel and N1 or N2'}</div></article>
    <article class="control-summary-card"><h3>Automatic N2 control</h3><label><input type="checkbox" ${hwCfg.controllers?.governor?'checked':''} ${fuel&&n2?'':'disabled'} onchange="setControllerEnabled('governor',this.checked)"> Enabled</label><div class="control-summary-meta">${fuel&&n2?'Uses fuel or fitted propeller pitch to hold N2':'Requires Main Fuel and N2'}</div></article></div>
    <div class="cfg-title" style="margin-top:1rem">Oil pressure controllers</div>${loopCards || '<div class="control-empty">No oil pressure controller configured. Fit an oil-pressure input and oil-pump output to add one.</div>'}<button type="button" style="margin-top:.6rem" ${canAddOil?'':'disabled'} onclick="addControllerOilLoop()">+ Add oil pressure controller</button>`;
}

function setSystemHardware(path, value) {
  setPath(hwCfg, path.split('.'), value);
  _controllerHardwareDirty = true;
  _markDirty();
  renderSystemSetup();
}
function renderSystemSetup() {
  const root = document.getElementById('system-device-setup');
  if (!root || CONFIG_SURFACE !== 'system') return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cluster = hwCfg.cluster_serial || {};
  const mav = hwCfg.mavlink || {};
  const group = (title, desc, body, open=true) => `<details class="config-group"${open?' open':''}><summary><span class="group-heading"><span class="group-title">${title}</span><span class="group-desc">${desc}</span></span><span class="group-chevron" aria-hidden="true">›</span></summary><div class="group-content"><div class="cfg-section"><div class="cfg-grid">${body}</div></div></div></details>`;
  const identity = `
      <label class="cfg-field"><span class="cfg-label">Engine / Wi-Fi name</span><span class="cfg-desc">Identifies this engine and names its ECU access point.</span><input id="system-engine-name" maxlength="63" value="${esc(hwCfg.profile_id || 'OpenTurbine')}" onchange="setSystemHardware('profile_id',this.value.trim()||'OpenTurbine')"></label>
      <label class="cfg-field"><span class="cfg-label">Engine description</span><span class="cfg-desc">A short name or note used to distinguish this ECU and its saved engine file.</span><input id="system-engine-description" maxlength="63" value="${esc(hwCfg.profile_desc || '')}" onchange="setSystemHardware('profile_desc',this.value)"></label>`;
  const wifi = `
      <label class="cfg-field"><span class="cfg-label">New Wi-Fi password</span><span class="cfg-desc">Leave untouched to keep the saved password. Use 8–63 characters, or choose Open network below.</span><input type="password" autocomplete="new-password" maxlength="63" placeholder="Saved password unchanged" onchange="if(this.value)setSystemHardware('wifi_password',this.value)"></label>
      <div class="cfg-field"><span class="cfg-label">Wi-Fi access</span><button type="button" class="danger" onclick="setSystemHardware('wifi_password','')">Use open network</button><span class="cfg-desc">An open network remains allowed, but anyone nearby who joins it can access ECU controls.</span></div>
      <label class="cfg-field"><span class="cfg-label">Wi-Fi transmit power (dBm)</span><span class="cfg-desc">Use only as much radio power as the installation needs.</span><input id="system-wifi-tx-power" type="number" min="2" max="20" step="1" value="${Number(hwCfg.wifi_tx_power_dbm ?? 8)}" onchange="setSystemHardware('wifi_tx_power_dbm',+this.value)"></label>`;
  const clusterFields = `
      <div class="cfg-field"><span class="cfg-label">Instrument-cluster link</span><label><input type="checkbox" ${cluster.enabled?'checked':''} onchange="setSystemHardware('cluster_serial.enabled',this.checked)"> Enabled</label><span class="cfg-desc">${(cluster.tx_pin??-1)>=0?`TX GPIO ${cluster.tx_pin}${(cluster.rx_pin??-1)>=0?` / RX GPIO ${cluster.rx_pin}`:' / one-way'}`:'Assign its serial GPIO on Hardware first.'}</span></div>
      ${cluster.enabled?`<label class="cfg-field"><span class="cfg-label">Baud rate</span><select onchange="setSystemHardware('cluster_serial.baud',+this.value)">${[9600,19200,38400,57600,115200,230400,460800,921600].map(v=>`<option value="${v}"${Number(cluster.baud||115200)===v?' selected':''}>${v}</option>`).join('')}</select></label>
      <label class="cfg-field"><span class="cfg-label">Update interval (ms)</span><input type="number" min="10" max="5000" value="${Number(cluster.interval_ms??200)}" onchange="setSystemHardware('cluster_serial.interval_ms',+this.value)"></label>`:''}
      <div class="cfg-field"><span class="cfg-label">Physical connection</span><a href="/hardware.html#hardware-comms-panel">Configure serial GPIO on Hardware &rarr;</a><span class="cfg-desc">Hardware owns pins and electrical capabilities.</span></div>`;
  const mavFields = `
      <div class="cfg-field"><span class="cfg-label">MAVLink telemetry</span><label><input type="checkbox" ${mav.enabled?'checked':''} onchange="setSystemHardware('mavlink.enabled',this.checked)"> Enabled</label><span class="cfg-desc">${(mav.tx_pin??-1)>=0?`TX GPIO ${mav.tx_pin}`:'Assign its TX GPIO on Hardware first.'}</span></div>
      ${mav.enabled?`<label class="cfg-field"><span class="cfg-label">Baud rate</span><select onchange="setSystemHardware('mavlink.baud',+this.value)">${[57600,115200,230400].map(v=>`<option value="${v}"${Number(mav.baud||57600)===v?' selected':''}>${v}</option>`).join('')}</select></label>
      <label class="cfg-field"><span class="cfg-label">Update interval (ms)</span><input type="number" min="50" max="5000" step="50" value="${Number(mav.interval_ms??200)}" onchange="setSystemHardware('mavlink.interval_ms',+this.value)"></label>`:''}
      <div class="cfg-field"><span class="cfg-label">Physical connection</span><a href="/hardware.html#hardware-comms-panel">Configure serial GPIO on Hardware &rarr;</a><span class="cfg-desc">Hardware owns pins and electrical capabilities.</span></div>`;
  root.innerHTML = `<div class="cfg-title">Device setup</div>${group('Engine identity','How this ECU identifies itself and its saved engine setup',identity)}${group('Wi-Fi access','Local browser connection settings; internet is never required',wifi)}${group('Instrument cluster','Optional OpenTurbine serial display',clusterFields,false)}${group('MAVLink telemetry','Optional serial telemetry for external systems',mavFields,false)}`;
  ['cl_n1','cl_n2','cl_tw','cl_ow','cl_fw','cl_bw'].forEach(key => setCfgFieldHardHidden(key, !cluster.enabled));
}
function renderSimpleControls() {
  const root = document.getElementById('simple-controls');
  if (!root || CONFIG_SURFACE !== 'controllers') return;
  const inputs = simpleControlInputs();
  const outputs = simpleControlOutputs();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const optionRows = (rows, selected, disabled = new Set()) => rows.map(row =>
    `<option value="${esc(row.id)}"${String(row.id)===String(selected)?' selected':''}${disabled.has(String(row.id))&&String(row.id)!==String(selected)?' disabled':''}>${esc(controllerChannelName(row))}</option>`).join('');
  const numberField = (index, key, label, value, attrs='step="any"') => `<label class="cfg-field"><span class="cfg-label">${label}</span><input type="number" ${attrs} value="${Number(value)}" onchange="updateSimpleControl(${index},'${key}',+this.value)"></label>`;
  const rules = cfg.rules || [];
  rules.forEach(rule => {
    rule.source = _resolveControllerChannelId(rule.source, inputs, 'input', rule.sensor);
    rule.target = _resolveControllerChannelId(rule.target, outputs, 'output', rule.actuator);
    if (Number(rule.target_source_type || 0) !== 0)
      rule.target_source = _resolveControllerChannelId(rule.target_source, inputs, 'input', rule.target_sensor);
  });
  const cards = rules.map((rule, index) => {
    const kind = Number(rule.kind || 0);
    const usedByOthers = new Set(rules.filter((_, i) => i !== index).map(row => String(row.target || '')));
    const target = outputs.find(row => row.id === rule.target);
    const relay = target && [4,11].includes(Number(target.driver));
    const dangerous = ['fuel_shutoff','igniter','ab_igniter','starter','starter_enable','air_starter'].includes(String(target?.purpose || ''));
    const targetSourceType = Number(rule.target_source_type || 0);
    const modeMask = Number(rule.mode_mask ?? 4) & 0x0f;
    const inputChoice = `<label class="cfg-field"><span class="cfg-label">${kind===2?'Feedback signal':'Controlled by'}</span><select onchange="updateSimpleControl(${index},'source',this.value)">${optionRows(inputs,rule.source)}</select></label>`;
    let topology = '';
    if (kind === 0) {
      topology = `${inputChoice}<label class="cfg-field"><span class="cfg-label">Direction</span><select onchange="updateSimpleControl(${index},'op',+this.value)"><option value="0"${Number(rule.op||0)===0?' selected':''}>Turn on above</option><option value="1"${Number(rule.op||0)===1?' selected':''}>Turn on below</option></select></label>${numberField(index,'threshold','Switch point',rule.threshold??0)}${numberField(index,'hysteresis','Hysteresis',rule.hysteresis??0,'min="0" step="any"')}${relay?'':`${numberField(index,'on_value','On output (%)',Math.round(Number(rule.on_value??1)*100),'min="0" max="100" step="1"').replace("+this.value)","+this.value/100)")}${numberField(index,'off_value','Off output (%)',Math.round(Number(rule.off_value??0)*100),'min="0" max="100" step="1"').replace("+this.value)","+this.value/100)")}`}`;
    } else if (kind === 1) {
      topology = `${inputChoice}${numberField(index,'input_min','Input low',rule.input_min??0)}${numberField(index,'input_max','Input high',rule.input_max??1)}${numberField(index,'output_min','Output low (%)',Math.round(Number(rule.output_min??0)*100),'min="0" max="100" step="1"').replace("+this.value)","+this.value/100)")}${numberField(index,'output_max','Output high (%)',Math.round(Number(rule.output_max??1)*100),'min="0" max="100" step="1"').replace("+this.value)","+this.value/100)")}`;
    } else {
      const targetSource = targetSourceType === 0 ? '' : `<label class="cfg-field"><span class="cfg-label">Target set by</span><select onchange="updateSimpleControl(${index},'target_source',this.value)">${optionRows(inputs,rule.target_source)}</select></label>`;
      const targetValues = targetSourceType === 0
        ? numberField(index,'target_fixed','Target',rule.target_fixed??0)
        : targetSourceType === 1
          ? `${numberField(index,'target_low','Switch OFF target',rule.target_low??0)}${numberField(index,'target_high','Switch ON target',rule.target_high??1)}`
          : `${numberField(index,'target_input_min','Target input low',rule.target_input_min??0)}${numberField(index,'target_input_max','Target input high',rule.target_input_max??1)}${numberField(index,'target_low','Target at input low',rule.target_low??0)}${numberField(index,'target_high','Target at input high',rule.target_high??1)}`;
      topology = `${inputChoice}<label class="cfg-field"><span class="cfg-label">Target source</span><select onchange="updateSimpleControl(${index},'target_source_type',+this.value)"><option value="0"${targetSourceType===0?' selected':''}>Fixed value</option><option value="1"${targetSourceType===1?' selected':''}>Two-state switch</option><option value="2"${targetSourceType===2?' selected':''}>Variable input mapping</option></select></label>${targetSource}${targetValues}${numberField(index,'output_min','Minimum output (%)',Math.round(Number(rule.output_min??0)*100),'min="0" max="100" step="1"').replace("+this.value)","+this.value/100)")}${numberField(index,'output_max','Maximum output (%)',Math.round(Number(rule.output_max??1)*100),'min="0" max="100" step="1"').replace("+this.value)","+this.value/100)")}<details class="protection-card" style="grid-column:1/-1"><summary><span><span class="protection-card-title">Response tuning</span><span class="protection-card-desc">Start gently, then tune during safe bench tests</span></span><span class="protection-card-chevron">›</span></summary><div class="cfg-grid">${numberField(index,'response_gain','Immediate response (% / unit)',Number(rule.response_gain??.02)*100,'min="0" step="any"').replace("+this.value)","+this.value/100)")}${numberField(index,'integral_gain','Correction rate (% / unit / s)',Number(rule.integral_gain??.005)*100,'min="0" step="any"').replace("+this.value)","+this.value/100)")}${numberField(index,'deadband','Target deadband',rule.deadband??0,'min="0" step="any"')}${numberField(index,'off_value','Feedback-loss output (%)',Math.round(Number(rule.off_value??0)*100),'min="0" max="100" step="1"').replace("+this.value)","+this.value/100)")}</div></details>`;
    }
    const sourceName = controllerChannelName(inputs.find(row => String(row.id) === String(rule.source))) || 'Choose input';
    const outputName = controllerChannelName(target) || 'Choose output';
    const targetName = targetSourceType === 0 ? `${Number(rule.target_fixed??0)}` : (controllerChannelName(inputs.find(row => String(row.id) === String(rule.target_source))) || 'Choose target source');
    const path = kind === 2 ? `${targetName} → ${sourceName} target → ${outputName}` : `${sourceName} → ${outputName}`;
    const methodName = kind === 2 ? 'Feedback target' : (kind === 1 ? 'Mapped input' : 'On / off with hysteresis');
    return `<details class="control-definition-card config-group" data-group="controller-${index}" data-purpose="${esc(target?.purpose || '')}" data-always-visible="1" data-controller-card data-controller-rule="${index}" data-controller-output="${esc(rule.target || '')}">
      <summary><span class="group-heading"><span class="group-title">${esc(rule.name || outputName)}</span><span class="control-path">${esc(path)}</span><span class="group-desc">${rule.enabled!==false?'Enabled':'Disabled'} · ${methodName}</span></span><span class="group-chevron" aria-hidden="true">›</span></summary>
      <div class="controller-card-body"><div class="controller-card-actions"><label class="controller-enabled"><input aria-label="Controller enabled" type="checkbox" ${rule.enabled!==false?'checked':''} onchange="updateSimpleControl(${index},'enabled',this.checked)"> Enabled</label><button type="button" class="danger" onclick="removeSimpleControl(${index})">Delete controller</button></div>
      <div class="cfg-grid">
        <label class="cfg-field"><span class="cfg-label">Controller name</span><input aria-label="Controller name" value="${esc(rule.name || '')}" maxlength="31" onchange="updateSimpleControl(${index},'name',this.value)"></label>
        <label class="cfg-field"><span class="cfg-label">Output</span><select onchange="updateSimpleControl(${index},'target',this.value)">${optionRows(outputs,rule.target,usedByOthers)}</select></label>
        <label class="cfg-field"><span class="cfg-label">Control method</span><select onchange="updateSimpleControl(${index},'kind',+this.value)"><option value="0"${kind===0?' selected':''}>On / Off with hysteresis</option>${relay?'':`<option value="1"${kind===1?' selected':''}>Map input to output</option><option value="2"${kind===2?' selected':''}>Hold a feedback target</option>`}</select></label>
        ${topology}
      </div><details class="protection-card" style="margin-top:.65rem"><summary><span><span class="protection-card-title">When this controller is active</span><span class="protection-card-desc">RUNNING by default; advanced turbine arrangements may choose other normal states</span></span><span class="protection-card-chevron">›</span></summary><div class="cfg-grid"><label class="cfg-field"><span class="cfg-label">Operating states</span><span class="automation-states"><label class="automation-state"><input type="checkbox" ${modeMask&1?'checked':''} onchange="toggleSimpleControlMode(${index},1,this.checked)"> Standby</label><label class="automation-state"><input type="checkbox" ${modeMask&2?'checked':''} onchange="toggleSimpleControlMode(${index},2,this.checked)"> Startup</label><label class="automation-state"><input type="checkbox" ${modeMask&4?'checked':''} onchange="toggleSimpleControlMode(${index},4,this.checked)"> Running</label><label class="automation-state"><input type="checkbox" ${modeMask&8?'checked':''} onchange="toggleSimpleControlMode(${index},8,this.checked)"> Shutdown</label></span><span class="cfg-desc">The controller owns this output only in checked states. It is always released in FAULT, and STOP/shutdown safety remains authoritative.</span></label></div></details>${dangerous?'<div class="cfg-desc" style="color:var(--yellow);margin-top:.55rem">Warning: this output can affect starting, combustion, or shutdown. Check the selected operating states carefully; STOP, FAULT, and hardware safety remain authoritative.</div>':''}<div class="controller-local-settings" data-controller-settings="${esc(rule.target || '')}"></div></div>
    </details>`;
  }).join('');
  const used = new Set(rules.map(rule => String(rule.target || '')));
  const canAdd = inputs.length && outputs.some(row => !used.has(String(row.id || ''))) && rules.length < 16;
  root.innerHTML = `${cards}<span data-controller-create-capable="${canAdd?'1':'0'}" hidden></span>`;
}

// ── Render form ───────────────────────────────────────────────
const ALL_WORKSPACE_GROUPS = [
  { id:'fuel', title:'Main Fuel & Idle', desc:'Normal fuel demand, idle authority, and reduced-power behavior', sections:['Throttle Response','Idle','Reduced-Power Mode'] },
  { id:'power', title:'Power Turbine & Afterburner', desc:'N2 control and afterburner ignition/running behavior', sections:['Afterburner — Ignition Conditions','Afterburner — Ignition Method','Afterburner — Flame Confirmation','Afterburner — Running'] },
  { id:'oil', title:'Oil & Lubrication Controllers', desc:'Normal pressure response and windmilling oil behavior', sections:['Oil Pressure Control','Windmilling Oil Protection'] },
  { id:'recovery', title:'Start & Recovery Controllers', desc:'Relight, cooldown, starter assist, and glow behavior', sections:['Automatic Flameout Relight','Cooldown Control','Manual Relight','Pulsed Starter Assist','Glow Plug Preheat'] },
  { id:'safety', title:'Safety & Limits', desc:'Independent limits and input-loss actions that may override every controller', sections:['Engine Protection Limits','Gradual Fuel Limit Protection','Oil Pressure Safety','Combustion & Startup Protection','Auxiliary Protection','RPM Sensor Fault Detection','RC / Servo Signal Loss Detection'] },
  { id:'runtime', title:'ECU Runtime', desc:'Control-loop scheduling and device-wide execution', sections:['ECU Runtime'] },
  { id:'display', title:'External Display Thresholds', desc:'Display-only warning zones for the optional instrument cluster', sections:['External Instrument Cluster Display'] },
];
const WORKSPACE_GROUPS = ALL_WORKSPACE_GROUPS
  .filter(group => CONFIG_SURFACE === 'system'
    ? ['runtime','display'].includes(group.id)
    : !['runtime','display'].includes(group.id))
  .map(group => ({...group, sections:group.sections.filter(title =>
    SCHEMA.some(section => section.title === title))}))
  .filter(group => group.sections.length);
const SECTION_GROUP = new Map(WORKSPACE_GROUPS.flatMap(group => group.sections.map(title => [title, group.id])));
let _workspaceFilter = CONFIG_SURFACE === 'system' ? 'configured' : 'essential';
let _currentView = CONFIG_SURFACE === 'system' ? 'expert' : 'basic';
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
    const activeLocked = control?.dataset.activeLocked === '1';
    // Future tuning values may be prepared before their hardware is installed,
    // but an enable checkbox must never be armed while its prerequisites are
    // absent. Otherwise adding hardware later could unexpectedly activate a
    // controller or protection with uncommissioned settings.
    const activationLocked = inactive && control?.type === 'checkbox';
    const inactiveEditable = inactive && futureEditMode && !activationLocked;
    field.classList.toggle('cfg-field-inactive', inactive);
    field.classList.toggle('inactive-editable', inactiveEditable && !isLocked && !logicallyDisabled && !activeLocked);

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
    if (control) control.disabled = isLocked || activeLocked || logicallyDisabled || (inactive && (!futureEditMode || activationLocked));
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
    const customAlways = !!field.closest('[data-always-visible="1"]');
    const haystack = field.dataset.search || '';
    const searchMatch = !search || search.split(/\s+/).every(token => haystack.includes(token));
    let show = false;
    if (customAlways && !hardHidden && searchMatch) {
      show = _workspaceFilter !== 'changed' || _controllerRulesDirty || _controllerHardwareDirty;
    } else if (!hardHidden && searchMatch) {
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
    const alwaysVisible = section.dataset.alwaysVisible === '1' &&
      (_workspaceFilter !== 'changed' || _controllerRulesDirty || _controllerHardwareDirty);
    section.classList.toggle('filter-hidden', !alwaysVisible && (hideUnavailableFeature || count === 0 || hiddenBench));
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
    const count = Array.from(group.querySelectorAll('.cfg-field:not(.filter-hidden)')).filter(field => {
      const section = field.closest('.cfg-section');
      return !section || !section.classList.contains('filter-hidden');
    }).length;
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
    // A fresh Controllers/System view starts as a compact overview. Search
    // and explicit deep links reopen only the card the user asked for.
    group.open = false;
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
  const pressure = parseInt((document.getElementById('cf-di_src') || {}).value || 0, 10) >= 2;
  _setFieldDesc('di_mode', _DI_MODE_DESC[adv ? 1 : 0]);
  ['di_dd', 'di_lk', 'di_tu', 'di_td', 'di_lr'].forEach(k => setCfgFieldHardHidden(k, !adv));
  ['di_de', 'di_sb', 'di_fr', 'di_la'].forEach(k => setCfgFieldHardHidden(k, !adv || pressure));
  ['di_pde', 'di_psb', 'di_pfr', 'di_plr'].forEach(k => setCfgFieldHardHidden(k, !adv || !pressure));
}
function updateIdleSourceFields() {
  const source = parseInt((document.getElementById('cf-di_src') || {}).value || 0, 10);
  const pressure = source >= 2;
  ['di_tr','di_db','di_rl'].forEach(k => setCfgFieldHardHidden(k, pressure));
  ['di_tp','di_pd','di_pl'].forEach(k => setCfgFieldHardHidden(k, !pressure));
  updateIdleModeFields();
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

function _captureControllerOpenState() {
  if (CONFIG_SURFACE !== 'controllers') return [];
  return [...document.querySelectorAll('#controller-overview details[open]')].map(card => {
    const owner = card.closest('[data-controller-output], [data-behavior-output]');
    if (!owner) return null;
    const ownerType = owner.hasAttribute('data-controller-output') ? 'controller' : 'behavior';
    const ownerId = owner.getAttribute(ownerType === 'controller' ? 'data-controller-output' : 'data-behavior-output');
    return {ownerType, ownerId, subcard:card.dataset.subcard || ''};
  }).filter(Boolean);
}

function _restoreControllerOpenState(state) {
  (state || []).forEach(item => {
    const attr = item.ownerType === 'controller' ? 'data-controller-output' : 'data-behavior-output';
    const owner = document.querySelector(`#controller-overview [${attr}="${CSS.escape(String(item.ownerId))}"]`);
    if (!owner) return;
    const card = item.subcard
      ? [...owner.querySelectorAll('.controller-subcard')].find(row => row.dataset.subcard === item.subcard)
      : owner;
    if (card && 'open' in card) card.open = true;
  });
}

function renderForm(preserveControllerOpenState = false) {
  const controllerOpenState = preserveControllerOpenState ? _captureControllerOpenState() : [];
  document.body.classList.toggle('system-surface', CONFIG_SURFACE === 'system');
  const workspaceTitle = document.querySelector('.cfg-workspace-title');
  if (workspaceTitle) workspaceTitle.textContent = CONFIG_SURFACE === 'system' ? 'System' : 'Controllers';
  const presetBar = document.getElementById('preset-bar');
  if (presetBar) presetBar.style.display = CONFIG_SURFACE === 'controllers' ? '' : 'none';
  const configuredOilPumps = (hwCfg?.channel_registry?.outputs || []).filter(channel =>
    channel?.installed !== false && String(channel.purpose || channel.role || '') === 'oil_pump');
  const oilPumpIsBinary = channel => [4, 11].includes(Number(channel?.driver));
  const allOilPumpsBinary = configuredOilPumps.length > 0 && configuredOilPumps.every(oilPumpIsBinary);
  const mixedOilPumpDrivers = configuredOilPumps.some(oilPumpIsBinary) && configuredOilPumps.some(channel => !oilPumpIsBinary(channel));
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
    const binaryOilFallback = f.key === 'oil_fp' && allOilPumpsBinary;
    const isSel = f.type === 'select' || binaryOilFallback;
    const runtimeOptions = binaryOilFallback
      ? [{v:0,l:'Off'},{v:100,l:'On'}]
      : (f.options || []);
    if (binaryOilFallback) val = Number(val) > 0 ? 100 : 0;
    const fieldLabel = binaryOilFallback ? 'Pump State After Pressure-Sensor Failure' : f.label;
    const fieldDesc = f.key === 'oil_fp' && mixedOilPumpDrivers
      ? `${f.desc} Binary pumps use 0% as Off and any positive value as On.`
      : f.desc;
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
    const aria = ` aria-label="${_escHtml(fieldLabel)}"`;
    const inp = isCb
      ? `<input type="checkbox" id="cf-${f.key}"${aria}${val ? ' checked' : ''}${isLocked ? ' disabled' : ''}>`
      : isSel
      ? `<select id="cf-${f.key}"${aria}${isLocked ? ' disabled' : ''}>${runtimeOptions.map(o => `<option value="${o.v}"${val == o.v ? ' selected' : ''}>${o.l}</option>`).join('')}</select>`
      : `<input type="number" id="cf-${f.key}"${aria} value="${val !== undefined ? val : ''}"
        step="${step}"${min}${max}${isLocked ? ' disabled' : ''}>`;
    const wid = f.wrapId ? ` id="${f.wrapId}"` : '';
    const level = f.basic ? 'essential' : 'advanced';
    const searchText = `${f.key} ${fieldLabel} ${fieldDesc} ${sec.title} ${sec.sectionNote || ''} ${group.title}`.toLowerCase();
    return `<div class="cfg-field"${wid} data-key="${f.key}" data-level="${level}" data-search="${_escHtml(searchText)}">
      <div class="cfg-field-head"><div class="cfg-label">${fieldLabel}${unitSuffix}</div>
        ${level === 'advanced' ? '<span class="field-level">Advanced</span>' : ''}</div>
      ${inp}
      <details class="cfg-help"><summary>About this setting</summary><div class="cfg-desc">${fieldDesc}</div></details>
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
    const localSafety = {
      'Oil Pressure Safety': [
        ['low_oil','Low oil pressure',controllerInputs('oil_pressure').length||controllerInputs('low_oil_switch').length,'Fit oil pressure or a low-oil switch'],
        ['oil_zero','No oil pressure',controllerInputs('oil_pressure').length||controllerInputs('oil_zero_switch').length,'Fit oil pressure or a no-pressure switch']
      ],
      'Combustion & Startup Protection': [
        ['flameout','Combustion loss',controllerInputs('flame').length||controllerInputs('n1_speed').length||controllerInputs('tot').length||controllerInputs('tit').length,'Fit flame, N1, TOT, or TIT feedback'],
        ['hot_start','Hot-start protection',controllerInputs('tot').length||controllerInputs('tit').length,'Fit a TOT or TIT input']
      ],
      'Auxiliary Protection': [
        ['oil_temp_high','High oil temperature',controllerInputs('oil_temperature').length,'Fit an oil-temperature input'],
        ['fuel_press_low','Low fuel pressure',controllerInputs('fuel_pressure').length,'Fit a fuel-pressure input'],
        ['batt_low','Low supply voltage',controllerInputs('battery_voltage').length,'Fit a voltage input'],
        ['surge','Surge detection',controllerInputs('n1_speed').length,'Fit an N1 speed input']
      ]
    }[sec.title] || [];
    const localSafetyHtml = localSafety.length ? `<div class="safety-local-grid">${localSafety.map(row=>controllerSafetyToggle(...row,isLocked)).join('')}</div>` : '';
    let fieldHtml = isProtection
      ? `<div class="protection-stack">${protectionGroups.map((card, index) => {
          const fields = card.keys.map(key => allProtectionFields.find(field => field.key === key)).filter(Boolean);
          const safety = card.id === 'n1' ? controllerSafetyToggle('overspeed','N1 overspeed',controllerInputs('n1_speed').length,'Fit an N1 speed input',isLocked)
            : card.id === 'n2' ? controllerSafetyToggle('n2_overspeed','N2 overspeed',controllerInputs('n2_speed').length,'Fit an N2 speed input',isLocked)
            : card.id === 'egt' ? controllerSafetyToggle('overtemp','Engine overtemperature',controllerInputs('tot').length||controllerInputs('tit').length,'Fit a TOT or TIT input',isLocked) : '';
          return `<details class="protection-card" data-protection="${card.id}">
            <summary><span><span class="protection-card-title">${card.title}</span><span class="protection-card-desc">${card.desc}</span></span><span class="protection-card-chevron">›</span></summary>
            ${safety}<div class="cfg-grid">${fields.map(field => renderField(field, sec, group)).join('')}</div>
          </details>`;
        }).join('')}</div>`
      : `${localSafetyHtml}<div class="cfg-grid">${sec.fields.map(field => renderField(field, sec, group)).join('')}</div>`;
    if (!isProtection && sec.id === 'idle-control-cfg-section') {
      const byKey = key => sec.fields.find(field => field.key === key);
      const renderKeys = keys => keys.map(byKey).filter(Boolean).map(field => renderField(field, sec, group)).join('');
      const primary = ['di_src','di_tr','di_tp','di_db','di_pd','di_rl','di_pl','di_mode'];
      const response = ['di_ru','di_rd','di_mx','di_ig','di_im'];
      const predictive = ['di_de','di_dd','di_lk','di_sb','di_fr','di_tu','di_td','di_lr','di_la','di_pde','di_psb','di_pfr','di_plr'];
      const automaticIdleFields = hwCfg.controllers?.dynamic_idle ? `<div class="automatic-idle-settings"><div class="cfg-title">Automatic Idle settings</div><div class="cfg-grid">${renderKeys(primary)}</div>
        <div class="protection-stack idle-tuning-stack">
          <details class="protection-card"><summary><span><span class="protection-card-title">Response tuning</span><span class="protection-card-desc">Fuel movement and long-term idle correction</span></span><span class="protection-card-chevron">›</span></summary><div class="cfg-grid">${renderKeys(response)}</div></details>
          <details class="protection-card"><summary><span><span class="protection-card-title">Predictive tuning</span><span class="protection-card-desc">Shown only for the predictive method; a zero fuel drop keeps deceleration catch off</span></span><span class="protection-card-chevron">›</span></summary><div class="cfg-grid">${renderKeys(predictive)}</div></details>
        </div></div>` : '';
      fieldHtml = `<div class="cfg-grid">${renderKeys(['th_mx'])}</div>${automaticIdleFields}`;
    }
    return `
    <section class="cfg-section"${sec.id ? ` id="${sec.id}"` : ''} data-section="${_escHtml(sec.title)}">
      <div class="cfg-title">${displayTitle}<span class="cfg-title-count"></span></div>
      ${noteHtml}${fieldHtml}
    </section>`;
  };

  const sectionByTitle = new Map(SCHEMA.map(section => [section.title, section]));
  const renderGroups = groups => groups.map((group, index) => {
    const sections = group.sections.map(title => sectionByTitle.get(title)).filter(Boolean);
    return `<details class="config-group" data-group="${group.id}">
      <summary>
        <span class="group-heading"><span class="group-title">${group.title}</span><span class="group-desc">${group.desc}</span></span>
        <span class="group-meta"></span><span class="group-chevron" aria-hidden="true">›</span>
      </summary>
      <div class="group-content">${sections.map(section => renderSection(section, group)).join('')}</div>
    </details>`;
  }).join('');
  const normalGroupsHtml = renderGroups(WORKSPACE_GROUPS.filter(group => group.id !== 'safety'));
  const safetyGroupsHtml = renderGroups(WORKSPACE_GROUPS.filter(group => group.id === 'safety'));
  document.getElementById('cfg-form').innerHTML =
    (CONFIG_SURFACE === 'controllers' ? '<section id="controller-hardware-setup" class="cfg-section" data-always-visible="1" data-section="Controller assignments"></section>' : '') +
    (CONFIG_SURFACE === 'system' ? '<section id="system-device-setup" class="cfg-section" data-always-visible="1" data-section="Device and communications"></section>' : '') +
    normalGroupsHtml +
    (CONFIG_SURFACE === 'controllers' ? '<section id="simple-controls" class="cfg-section" data-always-visible="1" data-section="Custom controllers"></section>' : '') +
    safetyGroupsHtml +
    '<div id="cfg-empty" class="cfg-empty" hidden>No settings match this search and filter.</div>';
  renderControllerHardwareSetup();
  renderSystemSetup();
  renderSimpleControls();
  // Controller cards are the workspace itself. Build them only after the
  // generated field sections and editable definitions exist so their local
  // settings can be mounted inside the correct output card.
  renderControllerOverview();
  initWorkspaceControls();
  _restoreControllerOpenState(controllerOpenState);

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

  // Controller cards and their local settings are mounted beside cfg-form,
  // so both workspace surfaces own dirty tracking. Property handlers avoid
  // stacking duplicate listeners when a controller topology rerenders.
  [document.getElementById('cfg-form'), document.getElementById('controller-overview')]
    .filter(Boolean).forEach(surface => {
      surface.oninput = _markDirty;
      surface.onchange = _markDirty;
    });

  // Apply current view filter
  applyView();
}
