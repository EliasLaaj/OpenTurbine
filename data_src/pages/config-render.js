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

function _independentFittedOutputs() {
  return (hwCfg?.channel_registry?.outputs || []).filter(row =>
    registryChannelInstalled(row) && !String(row?.mirror_of || ''));
}

function _suggestedOutputOptions(path, purposes, chooseLabel) {
  const current = String(getPath(cfg, path) || '');
  const wanted = new Set((Array.isArray(purposes) ? purposes : [purposes]).map(String));
  const outputs = _independentFittedOutputs();
  const suggested = outputs.filter(row => wanted.has(String(row?.purpose || '')));
  const other = outputs.filter(row => !wanted.has(String(row?.purpose || '')));
  const options = [];
  if (current && !outputs.some(row => String(row.id || '') === current))
    options.push({v:current, l:`Missing device: ${current}`});
  if (!current) options.push({v:'', l:chooseLabel || 'Choose output'});
  suggested.forEach(row => options.push({v:String(row.id || ''), l:controllerChannelName(row), group:'Suggested'}));
  other.forEach(row => options.push({v:String(row.id || ''), l:controllerChannelName(row), group:'Other fitted outputs'}));
  return options;
}

function _installedIgnitionOutputs() {
  const wanted = new Set(['igniter','ab_igniter','glow_plug']);
  return _independentFittedOutputs().filter(row => wanted.has(String(row?.purpose || '')));
}

function ignitionOutputOptions(path) {
  return _suggestedOutputOptions(path, ['igniter','ab_igniter','glow_plug'], 'Choose ignition output');
}

function outputOptionsForPurpose(path, purpose, chooseLabel) {
  return _suggestedOutputOptions(path, [purpose], chooseLabel);
}

function migrateBuiltInOutputIds() {
  const migrate = (path, legacyPath) => {
    if (getPath(cfg, path)) return;
    const outputs = _installedIgnitionOutputs();
    if (!outputs.length) return;
    const legacy = Number(getPath(cfg, legacyPath) || 0);
    const purpose = legacy === 1 ? 'ab_igniter' : legacy === 2 ? 'glow_plug' : 'igniter';
    const matching = outputs.filter(row => String(row.purpose || '') === purpose);
    const choice = matching.length === 1 ? matching[0] : null;
    if (choice) setPath(cfg, path, String(choice.id || ''));
  };
  migrate(['relight','output_id'], ['relight','ignition_target']);
  migrate(['misc','igniter_on_start_output_id'], ['misc','igniter_on_start_target']);
  const oilOutputs = (hwCfg?.channel_registry?.outputs || []).filter(row => row?.installed !== false &&
    !String(row?.mirror_of || '') && String(row?.purpose || '') === 'oil_pump');
  if (!getPath(cfg, ['standby_oil','output_id']) && oilOutputs.length === 1)
    setPath(cfg, ['standby_oil','output_id'], String(oilOutputs[0].id || ''));
}

function controllerChannelName(row) {
  if (!row) return '';
  const purposeNames = {
    throttle:'Throttle Input', idle:'Idle Input', n1_speed:'N1 Speed', n2_speed:'N2 Speed',
    oil_pressure:'Oil Pressure', main_fuel:'Main Fuel Metering', oil_pump:'Oil Pump',
    prop_pitch:'Propeller Pitch', ab_pump:'Afterburner Fuel Pump'
  };
  const raw = String(row.name || '').trim();
  const internalLooking = !raw || raw === 'Main Fuel Pump' || raw === String(row.id || '') ||
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
  const purposeMatches = rows.filter(row => String(row.purpose) === purpose || String(row.role) === purpose);
  if (purposeMatches.length === 1) return purposeMatches[0].id;
  const n = Number(numericValue);
  if (Number.isFinite(n)) {
    if (n >= 64 && rows[n - 64]) return rows[n - 64].id;
    const legacy = kind === 'input'
      ? ['oil_temperature','tot','n1_speed','oil_pressure','tit','battery_voltage','n2_speed','di0','di1','di2','di3','fuel_pressure','fuel_flow','p1','p2','torque','flame','throttle','idle','ab_flame','glow_current','igniter_current','igniter2_current','oil_pump_current','ab_input','start_switch','stop_switch','thrust'][n]
      : ['cooling_fan','bleed_valve','fuel_pump','oil_scavenge','main_fuel','starter','starter_enable','oil_pump','fuel_shutoff','igniter','ab_igniter','ab_fuel','ab_pump','','','air_starter','glow_plug','prop_pitch'][n];
    const legacyMatches = rows.filter(row => String(row.purpose) === legacy || String(row.role) === legacy);
    if (legacyMatches.length === 1) return legacyMatches[0].id;
  }
  return raw;
}

function _defaultRuleForOutput(channel) {
  const inputs = simpleControlInputs();
  const relay = [4,11].includes(Number(channel.driver));
  // Main fuel naturally follows the sole throttle input. Every other new
  // controller starts as an explicit fixed command so merely creating it can
  // never make an unrelated first registry input control physical hardware.
  const source = String(channel.purpose) === 'main_fuel'
    ? inputs.find(row => String(row.purpose) === 'throttle') : null;
  const minFuel = String(channel.purpose) === 'main_fuel'
    ? Math.max(0, Math.min(1, Number(cfg?.throttle?.fuel_pump_min_pct || 0) / 100)) : 0;
  return {enabled:true,kind:source?(relay?0:1):3,op:0,threshold:0,hysteresis:0,on_value:source?1:0,off_value:0,
    input_min:0,input_max:1,output_min:minFuel,output_max:1,mode_mask:4,
    target_source_type:0,target_source:'',target_fixed:0,target_low:0,target_high:1,
    target_input_min:0,target_input_max:1,response_gain:.02,integral_gain:.005,deadband:.01,
    name:`${controllerChannelName(channel)} control`.slice(0,31),source:source?.id || '',target:channel.id};
}

function createControllerForOutput(outputId) {
  const outputs = simpleControlOutputs();
  const channel = outputs.find(row => String(row.id) === String(outputId));
  if (!channel || (cfg.rules || []).some(rule => String(rule.target) === String(outputId))) return;
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
  const uniquePurpose = (rows, purpose) => {
    const matches = rows.filter(row => String(row.purpose) === purpose);
    return matches.length === 1 ? matches[0] : null;
  };
  const mainFuel = uniquePurpose(outputs, 'main_fuel');
  const propPitch = uniquePurpose(outputs, 'prop_pitch');
  const throttle = uniquePurpose(inputs, 'throttle');
  const n2 = uniquePurpose(inputs, 'n2_speed');
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
  const outputs = (hwCfg?.channel_registry?.outputs || []).filter(row =>
    row && row.installed !== false && !String(row.mirror_of || ''));
  const rules = cfg.rules || [];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const configuredCards = [...document.querySelectorAll('#simple-controls [data-controller-card]')];
  const configuredIds = new Set(rules.map(rule => String(rule.target || '')));
  const oilLoopOutputs = new Set((hwCfg.oil_loops || []).filter(loop => loop.enabled !== false).map(loop => String(loop.pump_output || '')));
  const oilLoopCards = outputs.filter(channel => oilLoopOutputs.has(String(channel.id)) && !configuredIds.has(String(channel.id))).map(channel =>
    `<details class="control-definition-card config-group" data-group="oil-loop-${esc(channel.id)}" data-purpose="oil_pump"><summary><span class="group-heading"><span class="group-title">${esc(controllerChannelName(channel))}</span><span class="control-path">Oil pressure feedback<span class="arrow">→</span>${esc(controllerChannelName(channel))}</span><span class="group-desc">User-configured pressure controller</span></span><span class="group-chevron">›</span></summary><div class="controller-card-body"><div class="controller-local-settings" data-oil-loop-settings="${esc(channel.id)}"></div></div></details>`
  ).join('');
  // The built-in AB running state owns its pump continuously while active.
  // Other transition outputs remain available to a user controller; sequence,
  // relight and safety commands still take authority in their defined states.
  const unavailableToRules = new Set([...oilLoopOutputs]);
  outputs.filter(channel => String(channel.purpose) === 'ab_pump').forEach(channel => unavailableToRules.add(String(channel.id)));
  const available = outputs.filter(channel => !configuredIds.has(String(channel.id)) && !unavailableToRules.has(String(channel.id)));
  const freeOilPumps = outputs.filter(channel => String(channel.purpose) === 'oil_pump' &&
    !configuredIds.has(String(channel.id)) && !oilLoopOutputs.has(String(channel.id)));
  const oilPressureInputs = controllerInputs('oil_pressure');
  const canAddOilLoop = freeOilPumps.length && oilPressureInputs.length;
  const oilLoopCreator = canAddOilLoop ? `<div class="cfg-grid"><label class="cfg-field"><span class="cfg-label">Oil pump</span><select id="new-oil-loop-output">${freeOilPumps.length>1?'<option value="">Choose pump</option>':''}${freeOilPumps.map(row=>`<option value="${esc(row.id)}">${esc(controllerChannelName(row))}</option>`).join('')}</select></label><label class="cfg-field"><span class="cfg-label">Pressure feedback</span><select id="new-oil-loop-pressure">${oilPressureInputs.length>1?'<option value="">Choose pressure input</option>':''}${oilPressureInputs.map(row=>`<option value="${esc(row.id)}">${esc(controllerChannelName(row))}</option>`).join('')}</select></label></div><button type="button" onclick="addControllerOilLoop(document.getElementById('new-oil-loop-output').value,document.getElementById('new-oil-loop-pressure').value)">Create oil-pressure controller</button>` : '';
  const availableHtml = (available.length || canAddOilLoop) ? `<details class="controller-create-card" data-always-visible="1"><summary class="controller-create-title"><span>+ Create controller</span><span class="group-chevron">›</span></summary><div class="controller-create-body">${available.length?`<label class="cfg-field"><span class="cfg-label">What do you want to control?</span><select id="new-controller-output">${available.map(row=>`<option value="${esc(row.id)}">${esc(controllerChannelName(row))}</option>`).join('')}</select><span class="cfg-desc">Create a threshold, mapping, feedback-target, or fixed-state controller.</span></label><button type="button" class="primary" onclick="createControllerForOutput(document.getElementById('new-controller-output').value)">Create controller</button>`:''}${oilLoopCreator}</div></details>` : '<div class="control-empty">Every fitted normal-operation output already has an owner.</div>';
  const purposes = new Set(outputs.map(channel => String(channel.purpose || '')));
  const builtIn = (id, title, desc) => `<details class="control-definition-card config-group built-in-subsystem" data-built-in="${id}"><summary><span class="group-heading"><span class="group-title">${title}</span><span class="group-desc">${desc}</span></span><span class="group-chevron">›</span></summary><div class="controller-card-body" data-built-in-settings="${id}"></div></details>`;
  const builtIns = [
    purposes.has('main_fuel') ? builtIn('fuel-support','Fuel-metering support','Throttle shaping, automatic idle, and reduced-power behavior') : '',
    purposes.has('starter') ? builtIn('starter-support','Starter support','Optional pulsed engagement behavior used by startup blocks') : '',
    (purposes.has('igniter') || purposes.has('ab_igniter') || purposes.has('glow_plug')) ? builtIn('relight','Ignition and relight','Automatic and operator-requested relight behavior during RUNNING') : '',
    purposes.has('oil_pump') ? builtIn('windmilling-oil','Windmilling oil protection','Protective oil flow while a fitted shaft rotates outside normal running') : '',
    (purposes.has('ab_pump') || purposes.has('ab_igniter') || purposes.has('ab_fuel') || purposes.has('ab_fuel_shutoff')) ? builtIn('afterburner','Afterburner subsystem','Light-up method, flame confirmation, and lit-running fuel behavior') : ''
  ].join('');
  root.innerHTML = `<div class="control-overview-head"><div><h2>Output controllers</h2><p>User-owned normal control for fitted outputs. One normal owner per output.</p></div></div><div id="configured-controller-cards" class="controller-definition-list"></div>${oilLoopCards}<div class="controller-create-wrap">${availableHtml}</div><div class="control-overview-head built-in-heading"><div><h2>Built-in turbine subsystems</h2><p>Optional ECU behaviors that temporarily command outputs during their defined sequence, protection, or relight state. They do not prevent a separate normal output controller.</p></div></div><div id="built-in-subsystems" class="controller-definition-list">${builtIns}</div>`;
  const list = document.getElementById('configured-controller-cards');
  configuredCards.forEach(card => list?.appendChild(card));
  root.style.display = '';
  _mountControllerLocalSettings(outputs);
}

function _mountControllerLocalSettings(outputs) {
  const sectionMap = {
    'fuel-support':['throttle','idle-control-cfg-section','reduced-power-section'],
    'starter-support':['starter-support-section'],
    relight:['relight-section','manual-relight-section'],
    'windmilling-oil':['windmilling-oil-section'],
    afterburner:['ab-ign-section','ab-flame-section','ab-run-section']
  };
  const localSectionIds = new Set(Object.values(sectionMap).flat().concat(['oil-config-section','governor-cfg-section']));
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
    const lowResponse = Number(loop.low_pressure_response ?? 2);
    const feedbackResponse = Number(loop.feedback_loss_response ?? 2);
    const responseOptions = selected => `<option value="0"${selected===0?' selected':''}>Disabled</option><option value="1"${selected===1?' selected':''}>Warning only</option><option value="2"${selected===2?' selected':''}>Normal fault shutdown</option><option value="3"${selected===3?' selected':''}>Immediate dry-oil stop</option>`;
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
      <label class="cfg-field"><span class="cfg-label">If pressure feedback is lost</span><select onchange="updateControllerOilLoop(${loopIndex},'feedback_loss_response',+this.value)">${responseOptions(feedbackResponse)}</select><span class="cfg-desc">The fixed feedback-loss pump command above remains active for Warning or Normal shutdown. Immediate mode cuts every hazardous output first.</span></label>
      ${pressure('low_pressure_bar','Low-pressure threshold',loop.low_pressure_bar??1,.01)}
      ${number('low_pressure_confirm_ms','Low-pressure confirmation (ms)',loop.low_pressure_confirm_ms??500,50,0,60000)}
      <label class="cfg-field"><span class="cfg-label">If running pressure stays low</span><select onchange="updateControllerOilLoop(${loopIndex},'low_pressure_response',+this.value)">${responseOptions(lowResponse)}</select><span class="cfg-desc">Warning reports only. Normal shutdown cuts combustion and runs the configured shutdown sequence. Immediate mode skips that sequence to protect dry bearings.</span></label>
      ${lowResponse===3||feedbackResponse===3?number('immediate_pump_run_s','Pump-only time after immediate stop (s)',loop.immediate_pump_run_s??10,.5,0,120):''}
      ${lowResponse===3||feedbackResponse===3?'<div class="cfg-field"><span class="cfg-label">Immediate dry-oil behavior</span><span class="cfg-desc">Fuel, ignition, starter, afterburner, cooling and scavenge outputs turn off immediately. Only this selected oil pump keeps its feedback-loss command for the bounded time above. Restart stays locked until the fault is cleared; reboot also clears faults.</span></div>':''}
      <div class="cfg-field"><button type="button" class="danger" onclick="removeControllerOilLoop(${loopIndex})">Remove pressure controller</button></div>
    </div></div>`;
    host.appendChild(card);
  };
  outputs.filter(channel => String(channel.purpose) === 'oil_pump').forEach(channel => {
    const host = document.querySelector(`[data-oil-loop-settings="${CSS.escape(String(channel.id))}"]`);
    if (host) mountOilLoop(host, channel);
  });
  Object.entries(sectionMap).forEach(([subsystem, ids]) => {
    const host = document.querySelector(`[data-built-in-settings="${CSS.escape(subsystem)}"]`);
    if (!host) return;
    if (subsystem === 'fuel-support') {
      const idleAvailable = controllerInputs('n1_speed').length || controllerInputs('n2_speed').length || controllerInputs('p1_pressure').length || controllerInputs('p2_pressure').length;
      wrapSection(host, document.getElementById('throttle'), 'Throttle Response', 'Normal operator-demand movement and sensitivity');
      const idleCard = wrapSection(host, document.getElementById('idle-control-cfg-section'), 'Idle', 'Minimum normal-running fuel authority');
      if (idleCard) {
        const idleReason = idleAvailable
          ? 'Hold fitted shaft-speed or pressure feedback by adjusting the idle fuel floor.'
          : 'Unavailable: Automatic Idle needs a fitted N1, N2, Pressure 1, or Pressure 2 feedback input.';
        idleCard.querySelector('.controller-subcard-content').insertAdjacentHTML('afterbegin', `<div class="controller-option-row" data-always-visible="1" title="${_escHtml(idleReason)}"><label title="${_escHtml(idleReason)}"><input type="checkbox" title="${_escHtml(idleReason)}" ${hwCfg.controllers?.dynamic_idle?'checked':''} ${idleAvailable?'':'disabled'} aria-describedby="automatic-idle-reason" onchange="setControllerEnabled('dynamic_idle',this.checked)"> Automatic Idle</label><span id="automatic-idle-reason" title="${_escHtml(idleReason)}">ⓘ ${_escHtml(idleReason)}</span></div>`);
      }
      wrapSection(host, document.getElementById('reduced-power-section'), 'Reduced-Power Mode', 'Fuel cap used after selected feedback is lost or when requested manually');
      return;
    }
    ids.forEach(id => {
      if (mounted.has(id)) return;
      const section = document.getElementById(id);
      if (section) {
        const card = wrapSection(host, section, section.dataset.section || section.querySelector('.cfg-title')?.textContent || 'Settings');
        if (id === 'windmilling-oil-section' && card &&
            !controllerInputs('n1_speed').length && !controllerInputs('n2_speed').length) {
          card.querySelector('.controller-subcard-content').insertAdjacentHTML('afterbegin',
            '<div class="controller-empty-action"><span>Unavailable because no shaft-speed input is fitted. Windmilling protection needs N1 or N2 feedback to know that a stopped engine is still rotating.</span></div>');
        }
      }
    });
  });
  localSectionIds.forEach(id => {
    if (mounted.has(id)) return;
    document.getElementById(id)?.remove();
  });
  document.querySelectorAll('#cfg-form .config-group').forEach(group => {
    if (!group.querySelector('.cfg-section')) group.remove();
  });
}

function simpleControlInputs() {
  return (hwCfg?.channel_registry?.inputs || []).filter(row => row && row.installed !== false);
}
function simpleControlOutputs() {
  return (hwCfg?.channel_registry?.outputs || []).filter(row =>
    row && row.installed !== false && !String(row.mirror_of || ''));
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
  const previousTarget = key === 'target'
    ? simpleControlOutputs().find(row => String(row.id) === String(rule.target))
    : null;
  rule[key] = value;
  _controllerRulesDirty = true;
  if (key === 'kind') {
    // Changing topology removes the runtime effect of fields that no longer
    // apply. Defaults remain unsurprising if the user changes back later.
    if (Number(value) === 0) {
      rule.threshold ??= 0;
      rule.hysteresis ??= 0;
      rule.on_value = 0;
      rule.off_value = 0;
    } else if (Number(value) === 1) {
      rule.input_min = 0;
      rule.input_max = 1;
      rule.output_min = 0;
      rule.output_max = 1;
    } else if (Number(value) === 2) {
      const tuning = feedbackDefaultsForInput(rule.source);
      rule.target_source_type = 0;
      rule.target_source = '';
      rule.target_fixed = 0;
      rule.target_low = 0;
      rule.target_high = 1;
      rule.target_input_min = 0;
      rule.target_input_max = 1;
      rule.output_min = 0;
      rule.output_max = 1;
      rule.off_value = 0;
      Object.assign(rule, tuning);
    } else {
      rule.on_value = 0;
    }
  }
  if (key === 'source' && Number(rule.kind) === 2)
    Object.assign(rule, feedbackDefaultsForInput(value));
  if (key === 'target_source_type' && Number(value) !== 0 && !rule.target_source)
    rule.target_source = '';
  if (key === 'target') {
    const target = simpleControlOutputs().find(row => String(row.id) === String(value));
    const wasRelay = previousTarget && [4,11].includes(Number(previousTarget.driver));
    const isRelay = target && [4,11].includes(Number(target.driver));
    if (previousTarget && target && wasRelay !== isRelay) {
      rule.on_value = 0;
      rule.off_value = 0;
      rule.output_min = 0;
      rule.output_max = 1;
    }
    if (target && [4,11].includes(Number(target.driver)) && [1,2].includes(Number(rule.kind)))
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
  return (hwCfg?.channel_registry?.outputs || []).filter(row => row && row.installed !== false &&
    !String(row.mirror_of || '') && String(row.purpose || '') === purpose);
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
  const reason = available ? 'Independent protection; its limits and response are configured in this card.' : requirement;
  const state = checked && available ? '<b class="controller-state controller-state-ok">● ACTIVE</b>'
    : checked ? '<b class="controller-state controller-state-warn">● NEEDS ATTENTION</b>'
    : '<b class="controller-state">○ OFF</b>';
  return `<div class="safety-local-toggle" title="${_escHtml(reason)}"><label title="${_escHtml(reason)}"><input type="checkbox" title="${_escHtml(reason)}" ${checked?'checked':''} ${available&&!locked?'':'disabled'} onchange="setSafetyEnabled('${key}',this.checked)"> ${label} enabled</label>${state}<span>ⓘ ${_escHtml(reason)}</span></div>`;
}
function updateControllerOilLoop(index, key, value) {
  const loop = hwCfg.oil_loops?.[index];
  if (!loop) return;
  loop[key] = value;
  markControllerHardwareDirty();
}
function addControllerOilLoop(pumpOutputId = '', pressureInputId = '') {
  hwCfg.oil_loops ||= [];
  const used = new Set(hwCfg.oil_loops.map(loop => String(loop.pump_output || '')));
  const pressures = controllerInputs('oil_pressure');
  const pressure = pressures.find(row => String(row.id) === String(pressureInputId)) ||
    (pressures.length === 1 ? pressures[0] : null);
  const pump = controllerOutputs('oil_pump').find(row =>
    !used.has(String(row.id || '')) && (!pumpOutputId || String(row.id) === String(pumpOutputId)));
  const maxLoops = Math.max(1, Number(hwCfg?._capabilities?.max_oil_loops || 6));
  if (!pressure || !pump || hwCfg.oil_loops.length >= maxLoops) return;
  hwCfg.oil_loops.push({enabled:true,id:`oil${hwCfg.oil_loops.length + 1}`,pressure_input:pressure.id,pump_output:pump.id,
    target_source:0,target_bar:2.5,target_high_bar:2.5,speed_min_rpm:0,speed_max_rpm:20000,
    deadband_bar:.2,response_gain:1.8,failsafe_delay_ms:1500,failsafe_demand:.6,min_demand:.18,max_demand:1,
    low_pressure_bar:1,low_pressure_confirm_ms:500,low_pressure_response:2,feedback_loss_response:2,immediate_pump_run_s:10});
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
function setSystemHardware(path, value) {
  if (!_systemHardwareOriginalValues.has(path))
    _systemHardwareOriginalValues.set(path, getPath(hwCfg, path.split('.')));
  setPath(hwCfg, path.split('.'), value);
  _systemHardwareDirty = true;
  _systemHardwareChangedPaths.add(path);
  _markDirty();
  renderSystemSetup();
  // The System groups are rebuilt after each edit. Recompute the fixed save
  // bar after that replacement so its count and enabled state cannot retain
  // the pre-edit snapshot (notably on the slower Classic page load path).
  _updateWorkspaceState();
}
function renderSystemSetup() {
  const root = document.getElementById('system-device-setup');
  if (!root || CONFIG_SURFACE !== 'system') return;
  const openGroups = new Set(Array.from(root.querySelectorAll(':scope > details[open] .group-title'))
    .map(node => node.textContent.trim()));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cluster = hwCfg.cluster_serial || {};
  const mav = hwCfg.mavlink || {};
  const group = (title, desc, body, open=true, id='') => `<details${id?` id="${id}"`:''} class="config-group"${open?' open':''}><summary><span class="group-heading"><span class="group-title">${title}</span><span class="group-desc">${desc}</span></span><span class="group-chevron" aria-hidden="true">›</span></summary><div class="group-content"><div class="cfg-section"><div class="cfg-grid">${body}</div></div></div></details>`;
  const category = (title, desc, body, open=false, id='') => `<details${id?` id="${id}"`:''} class="system-category"${open?' open':''}><summary><span class="group-heading"><span class="group-title">${title}</span><span class="group-desc">${desc}</span></span><span class="group-chevron" aria-hidden="true">›</span></summary><div class="system-category-body"><div class="system-subcard-grid">${body}</div></div></details>`;
  const identity = `
      <label class="cfg-field"><span class="cfg-label">Engine / Wi-Fi name</span><span class="cfg-desc">Identifies this engine and names its ECU access point.</span><input id="system-engine-name" maxlength="63" value="${esc(hwCfg.profile_id || 'OpenTurbine')}" onchange="setSystemHardware('profile_id',this.value.trim()||'OpenTurbine')"></label>
      <label class="cfg-field"><span class="cfg-label">Engine description</span><span class="cfg-desc">A short name or note used to distinguish this ECU and its saved engine file.</span><input id="system-engine-description" maxlength="63" value="${esc(hwCfg.profile_desc || '')}" onchange="setSystemHardware('profile_desc',this.value)"></label>`;
  const wifi = `
      <label class="cfg-field"><span class="cfg-label">New Wi-Fi password</span><span class="cfg-desc">Leave untouched to keep the saved password. Use 8–63 characters, or choose Open network below.</span><input type="password" autocomplete="new-password" maxlength="63" placeholder="Saved password unchanged" onchange="if(this.value)setSystemHardware('wifi_password',this.value)"></label>
      <div class="cfg-field"><span class="cfg-label">Wi-Fi access</span><button type="button" class="danger" onclick="setSystemHardware('wifi_password','')">Use open network</button><span class="cfg-desc">An open network remains allowed, but anyone nearby who joins it can access ECU controls.</span></div>
      <label class="cfg-field"><span class="cfg-label">Wi-Fi transmit power (dBm)</span><span class="cfg-desc">Use only as much radio power as the installation needs.</span><input id="system-wifi-tx-power" type="number" min="2" max="20" step="1" value="${Number(hwCfg.wifi_tx_power_dbm ?? 8)}" onchange="setSystemHardware('wifi_tx_power_dbm',+this.value)"></label>`;
  const clusterFields = `
      <div class="cfg-field"><span class="cfg-label">Instrument-cluster link</span><label><input type="checkbox" ${cluster.enabled?'checked':''} onchange="setSystemHardware('cluster_serial.enabled',this.checked)"> Enabled</label><span class="cfg-desc">${(cluster.tx_pin??-1)>=0?`TX GPIO ${cluster.tx_pin}${(cluster.rx_pin??-1)>=0?` / RX GPIO ${cluster.rx_pin}`:' / one-way'}`:'Assign its serial GPIO on Hardware first.'}</span><span class="cfg-desc">The default stream is chosen automatically from fitted primary sensors and actuators: N1 plus any configured N2, EGT/TIT, oil, fuel, electrical, torque/thrust and output data. With RX connected, a compatible cluster may request all or a named subset at runtime; field selection is therefore not duplicated in this ECU page.</span></div>
      ${cluster.enabled?`<label class="cfg-field"><span class="cfg-label">Baud rate</span><select onchange="setSystemHardware('cluster_serial.baud',+this.value)">${[9600,19200,38400,57600,115200,230400,460800,921600].map(v=>`<option value="${v}"${Number(cluster.baud||115200)===v?' selected':''}>${v}</option>`).join('')}</select></label>
      <label class="cfg-field"><span class="cfg-label">Update interval (ms)</span><input type="number" min="10" max="5000" value="${Number(cluster.interval_ms??200)}" onchange="setSystemHardware('cluster_serial.interval_ms',+this.value)"></label>`:''}
      <div class="cfg-field"><span class="cfg-label">Physical connection</span><a href="/hardware.html#hardware-comms-panel">Configure serial GPIO on Hardware &rarr;</a><span class="cfg-desc">Hardware owns pins and electrical capabilities.</span></div>`;
  const mavFields = `
      <div class="cfg-field"><span class="cfg-label">MAVLink telemetry</span><label><input type="checkbox" ${mav.enabled?'checked':''} onchange="setSystemHardware('mavlink.enabled',this.checked)"> Enabled</label><span class="cfg-desc">${(mav.tx_pin??-1)>=0?`TX GPIO ${mav.tx_pin}`:'Assign its TX GPIO on Hardware first.'}</span></div>
      ${mav.enabled?`<label class="cfg-field"><span class="cfg-label">Baud rate</span><select onchange="setSystemHardware('mavlink.baud',+this.value)">${[57600,115200,230400].map(v=>`<option value="${v}"${Number(mav.baud||57600)===v?' selected':''}>${v}</option>`).join('')}</select></label>
      <label class="cfg-field"><span class="cfg-label">Update interval (ms)</span><input type="number" min="50" max="5000" step="50" value="${Number(mav.interval_ms??200)}" onchange="setSystemHardware('mavlink.interval_ms',+this.value)"></label>`:''}
      <div class="cfg-field"><span class="cfg-label">Physical connection</span><a href="/hardware.html#hardware-comms-panel">Configure serial GPIO on Hardware &rarr;</a><span class="cfg-desc">Hardware owns pins and electrical capabilities.</span></div>`;
  const appearanceFields = `
      <div class="cfg-field" style="grid-column:1/-1">
        <div id="appearance-picker"></div>
        <span class="cfg-desc" style="margin-top:.45rem">Interface theme for this device — applies instantly.</span>
      </div>`;
  const runtimeHz = Number(getPath(cfg, ['telemetry','control_loop_hz']) ?? 400);
  const runtimeFields = `
      <div class="cfg-field" data-key="tm_lh" data-level="essential" style="grid-column:1/-1">
        <div class="cfg-field-head"><div class="cfg-label">ECU Loop Target Hz (Hz)</div></div>
        <input type="number" id="cf-tm_lh" aria-label="ECU Loop Target Hz" value="${runtimeHz}" step="50" min="50" max="1000" ${isLocked ? 'disabled' : ''}>
        <details class="cfg-help"><summary>About this setting</summary><div class="cfg-desc">Main control-loop target frequency. Default 400 Hz. Lower values reduce CPU use; higher values improve control granularity but increase load. Recommended range: 200-500 Hz. Takes effect after a reboot.</div></details>
      </div>`;
  const loopTimingFields = `
      <div class="cfg-field" style="grid-column:1/-1">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem">
          <span class="cfg-label">Live loop metrics</span>
          <span class="tool-state off" id="loop-diag-state" style="font-size:.65rem;padding:.15rem .5rem;border-radius:999px;border:1px solid var(--border);color:var(--dim)">Live</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.65rem">
          <div><div class="cfg-desc">Loop rate</div><div style="font-family:var(--font-mono);font-weight:700;color:var(--text)" id="diag-loop-hz">-</div></div>
          <div><div class="cfg-desc">Period</div><div style="font-family:var(--font-mono);font-weight:700;color:var(--text)" id="diag-loop-period">-</div></div>
          <div><div class="cfg-desc">Worst cycle</div><div style="font-family:var(--font-mono);font-weight:700;color:var(--text)" id="diag-loop-period-max">-</div></div>
          <div><div class="cfg-desc">Exec avg</div><div style="font-family:var(--font-mono);font-weight:700;color:var(--text)" id="diag-loop-avg">-</div></div>
          <div><div class="cfg-desc">Exec max</div><div style="font-family:var(--font-mono);font-weight:700;color:var(--text)" id="diag-loop-max">-</div></div>
          <div><div class="cfg-desc">Missed deadlines</div><div style="font-family:var(--font-mono);font-weight:700;color:var(--text)" id="diag-loop-overruns">-</div></div>
          <div><div class="cfg-desc">Counter</div><div style="font-family:var(--font-mono);font-weight:700;color:var(--text)" id="diag-loop-count">-</div></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(115px,1fr));gap:.55rem;margin-top:.8rem;padding-top:.75rem;border-top:1px solid var(--border)">
          <div><div class="cfg-desc">Sensors</div><div style="font-family:var(--font-mono);font-weight:700;color:var(--text)" id="diag-loop-sensors">-</div></div>
          <div><div class="cfg-desc">Sequencer</div><div style="font-family:var(--font-mono);font-weight:700;color:var(--text)" id="diag-loop-sequencer">-</div></div>
          <div><div class="cfg-desc">Controllers</div><div style="font-family:var(--font-mono);font-weight:700;color:var(--text)" id="diag-loop-controllers">-</div></div>
          <div><div class="cfg-desc">Actuators</div><div style="font-family:var(--font-mono);font-weight:700;color:var(--text)" id="diag-loop-actuators">-</div></div>
          <div><div class="cfg-desc">Logging</div><div style="font-family:var(--font-mono);font-weight:700;color:var(--text)" id="diag-loop-logging">-</div></div>
          <div><div class="cfg-desc">Status LED</div><div style="font-family:var(--font-mono);font-weight:700;color:var(--text)" id="diag-loop-led">-</div></div>
        </div>
        <span class="cfg-desc" style="margin-top:.75rem">Main ECU loop speed and execution timing. Worst cycle includes waiting and scheduling; missed deadlines count loop bodies that took longer than the configured period.</span>
      </div>`;
  const backupRestoreFields = `
      <div class="cfg-field" style="grid-column:1/-1">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem">
          <span class="cfg-label">Engine configuration file</span>
          <span class="tool-state off" id="cfg-backup-state" style="font-size:.65rem;padding:.15rem .5rem;border-radius:999px;border:1px solid var(--border);color:var(--dim)">Ready</span>
        </div>
        <span class="cfg-desc">
          Download one complete engine file containing hardware, settings, sequences,
          and calibration, or restore a previously saved file. The engine must be in
          STANDBY (or FAULT) to restore.
          <br><span style="color:var(--yellow)">Note: the backup is complete by design —
          it includes the Wi-Fi AP password. Review before sharing the file.</span>
        </span>
        <div style="display:flex;gap:.5rem;margin-top:.6rem;flex-wrap:wrap">
          <button type="button" id="cfg-backup-btn" onclick="backupConfig()">Download backup</button>
          <label style="cursor:pointer">
            <input type="file" id="cfg-restore-file" accept=".json" style="display:none" onchange="restoreConfig(this)">
            <button type="button" id="cfg-restore-btn" onclick="document.getElementById('cfg-restore-file').click()">Upload &amp; restore…</button>
          </label>
        </div>
        <div id="cfg-backup-msg" style="font-size:.72rem;margin-top:.45rem;display:none"></div>
      </div>`;
  const factoryResetFields = `
      <div class="cfg-field" style="grid-column:1/-1">
        <span class="cfg-label" style="color:var(--red)">Factory Reset</span>
        <span class="cfg-desc">
          Erases all engine settings, sequences, hardware assignments, calibration,
          Wi-Fi password, event logs, and session logs, then reboots to the built-in
          minimal profile. The PCB profile is preserved. Download a complete engine file first if anything may be
          needed later. <b style="color:var(--red)">Cannot be undone.</b>
        </span>
        <div style="margin-top:.6rem">
          <button type="button" onclick="factoryReset()" class="danger" id="btn-factory-reset">Factory Reset</button>
        </div>
        <div id="factory-reset-msg" style="font-size:.72rem;margin-top:.45rem;display:none"></div>
      </div>`;
  const manualUpdateFields = `
      <div class="cfg-field" style="grid-column:1/-1">
        <div class="maintenance-upload"><div class="maintenance-upload-copy"><span class="cfg-label">Firmware image</span><span class="cfg-desc">Upload a matching compiled <code>firmware.bin</code>. Firmware and web pages are separate; use the complete asset update below when the dashboard changed.</span></div><span id="ota-state" class="maintenance-state">Ready</span><label><input type="file" id="ota-file" accept=".bin" hidden onchange="startSystemOTA(this)"><button type="button" id="ota-btn" onclick="document.getElementById('ota-file').click()">Choose .bin</button></label></div>
        <div id="ota-prog-track" class="maintenance-progress" style="display:none"><div id="ota-prog-fill" class="maintenance-progress-fill"></div></div><div id="ota-msg" class="cfg-desc" style="display:none;margin-top:.45rem"></div>
      </div>
      <div class="cfg-field" style="grid-column:1/-1">
        <div class="maintenance-upload"><div class="maintenance-upload-copy"><span class="cfg-label">Web UI assets</span><span class="cfg-desc">Upload all twelve generated <code>data/*.gz</code> files together. Configuration and logs are retained.</span></div><span id="assets-state" class="maintenance-state">Ready</span><label><input type="file" id="assets-files" accept=".gz" multiple hidden onchange="startSystemWebAssetsUpdate(this)"><button type="button" id="assets-btn" onclick="document.getElementById('assets-files').click()">Choose .gz files</button></label></div>
        <div id="assets-prog-track" class="maintenance-progress" style="display:none"><div id="assets-prog-fill" class="maintenance-progress-fill"></div></div><div id="assets-msg" class="cfg-desc" style="display:none;margin-top:.45rem"></div>
      </div>`;
  root.innerHTML =
    category('Identity & access','Engine name, Wi-Fi connection, and dashboard appearance',
      group('Engine identity','Name used by the dashboard, Wi-Fi AP, and saved engine file',identity,true) +
      group('Wi-Fi access','Password and radio settings for the local ECU network',wifi,false) +
      group('Appearance','Interface color palette and display theme',appearanceFields,false),true,'system-identity-access') +
    category('Connections & runtime','External telemetry links and ECU execution diagnostics',
      group('Instrument cluster','Optional OpenTurbine serial display',clusterFields,false) +
      group('MAVLink telemetry','Optional serial telemetry for external systems',mavFields,false) +
      group('ECU runtime','Control-loop scheduling and device-wide execution',runtimeFields,false) +
      group('ECU loop timing','Main ECU loop speed and execution timing diagnostics',loopTimingFields,false,'loop-diag-card'),false,'system-connections-runtime') +
    category('Maintenance','Backups, advanced updates, and recovery actions',
      group('Backup & restore','Download or restore the complete configuration file',backupRestoreFields,false,'system-backup-restore') +
      group('Manual firmware & web update','Advanced update controls for matching compiled files',manualUpdateFields,false,'manual-update-tools') +
      group('Factory reset','Permanently erase all configuration and logs to restore factory defaults',factoryResetFields,false,'card-factory-reset'),false,'system-maintenance');
  root.querySelectorAll('details.config-group').forEach(card => {
    const title = card.querySelector('.group-title')?.textContent.trim();
    if (openGroups.size) card.open = openGroups.has(title);
  });
  if (window.OTTheme?.renderPicker) {
    window.OTTheme.renderPicker(document.getElementById('appearance-picker'));
  }
  if (window._lastSystemData && typeof window.updateLoopDiagnostics === 'function') {
    window.updateLoopDiagnostics(window._lastSystemData);
  }
  const frBtn = document.getElementById('btn-factory-reset');
  if (frBtn) frBtn.disabled = !['STANDBY', 'FAULT'].includes(runtimeMode);
  const cfgRestoreBtn = document.getElementById('cfg-restore-btn');
  if (cfgRestoreBtn) cfgRestoreBtn.disabled = !['STANDBY', 'FAULT'].includes(runtimeMode);
  ['cl_n1','cl_n2','cl_tw','cl_ow','cl_fw','cl_bw'].forEach(key => setCfgFieldHardHidden(key, !cluster.enabled));
}
function renderSimpleControls() {
  const root = document.getElementById('simple-controls');
  if (!root || CONFIG_SURFACE !== 'controllers') return;
  const inputs = simpleControlInputs();
  const outputs = simpleControlOutputs();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const optionRows = (rows, selected, disabled = new Set()) =>
    (!String(selected || '') ? '<option value="" selected>Choose device</option>' : '') + rows.map(row =>
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
    const dangerous = ['main_fuel','fuel_shutoff','fuel_pump','pilot_fuel','igniter',
      'ab_igniter','ab_valve','ab_pump','glow_plug',
      'starter','starter_enable','air_starter'].includes(String(target?.purpose || ''));
    const targetSourceType = Number(rule.target_source_type || 0);
    const modeMask = Number(rule.mode_mask ?? 4) & 0x0f;
    const inputChoice = `<label class="cfg-field"><span class="cfg-label">${kind===2?'Feedback signal':'Controlled by'}</span><select onchange="updateSimpleControl(${index},'source',this.value)">${optionRows(inputs,rule.source)}</select></label>`;
    let topology = '';
    if (kind === 0) {
      topology = `${inputChoice}<label class="cfg-field"><span class="cfg-label">Direction</span><select onchange="updateSimpleControl(${index},'op',+this.value)"><option value="0"${Number(rule.op||0)===0?' selected':''}>Turn on above</option><option value="1"${Number(rule.op||0)===1?' selected':''}>Turn on below</option></select></label>${numberField(index,'threshold','Switch point',rule.threshold??0)}${numberField(index,'hysteresis','Hysteresis',rule.hysteresis??0,'min="0" step="any"')}${relay?'':`${numberField(index,'on_value','On output (%)',Math.round(Number(rule.on_value??1)*100),'min="0" max="100" step="1"').replace("+this.value)","+this.value/100)")}${numberField(index,'off_value','Off output (%)',Math.round(Number(rule.off_value??0)*100),'min="0" max="100" step="1"').replace("+this.value)","+this.value/100)")}`}`;
    } else if (kind === 1) {
      topology = `${inputChoice}${numberField(index,'input_min','Input low',rule.input_min??0)}${numberField(index,'input_max','Input high',rule.input_max??1)}${numberField(index,'output_min','Output low (%)',Math.round(Number(rule.output_min??0)*100),'min="0" max="100" step="1"').replace("+this.value)","+this.value/100)")}${numberField(index,'output_max','Output high (%)',Math.round(Number(rule.output_max??1)*100),'min="0" max="100" step="1"').replace("+this.value)","+this.value/100)")}`;
    } else if (kind === 2) {
      const targetSource = targetSourceType === 0 ? '' : `<label class="cfg-field"><span class="cfg-label">Target set by</span><select onchange="updateSimpleControl(${index},'target_source',this.value)">${optionRows(inputs,rule.target_source)}</select></label>`;
      const targetValues = targetSourceType === 0
        ? numberField(index,'target_fixed','Target',rule.target_fixed??0)
        : targetSourceType === 1
          ? `${numberField(index,'target_low','Switch OFF target',rule.target_low??0)}${numberField(index,'target_high','Switch ON target',rule.target_high??1)}`
          : `${numberField(index,'target_input_min','Target input low',rule.target_input_min??0)}${numberField(index,'target_input_max','Target input high',rule.target_input_max??1)}${numberField(index,'target_low','Target at input low',rule.target_low??0)}${numberField(index,'target_high','Target at input high',rule.target_high??1)}`;
      topology = `${inputChoice}<label class="cfg-field"><span class="cfg-label">Target source</span><select onchange="updateSimpleControl(${index},'target_source_type',+this.value)"><option value="0"${targetSourceType===0?' selected':''}>Fixed value</option><option value="1"${targetSourceType===1?' selected':''}>Two-state switch</option><option value="2"${targetSourceType===2?' selected':''}>Variable input mapping</option></select></label>${targetSource}${targetValues}${numberField(index,'output_min','Minimum output (%)',Math.round(Number(rule.output_min??0)*100),'min="0" max="100" step="1"').replace("+this.value)","+this.value/100)")}${numberField(index,'output_max','Maximum output (%)',Math.round(Number(rule.output_max??1)*100),'min="0" max="100" step="1"').replace("+this.value)","+this.value/100)")}<details class="protection-card" style="grid-column:1/-1"><summary><span><span class="protection-card-title">Response tuning</span><span class="protection-card-desc">Start gently, then tune during safe bench tests</span></span><span class="protection-card-chevron">›</span></summary><div class="cfg-grid">${numberField(index,'response_gain','Immediate response (% / unit)',Number(rule.response_gain??.02)*100,'min="0" step="any"').replace("+this.value)","+this.value/100)")}${numberField(index,'integral_gain','Correction rate (% / unit / s)',Number(rule.integral_gain??.005)*100,'min="0" step="any"').replace("+this.value)","+this.value/100)")}${numberField(index,'deadband','Target deadband',rule.deadband??0,'min="0" step="any"')}${numberField(index,'off_value','Feedback-loss output (%)',Math.round(Number(rule.off_value??0)*100),'min="0" max="100" step="1"').replace("+this.value)","+this.value/100)")}</div></details>`;
    } else {
      topology = `${numberField(index,'on_value',relay?'Fixed state (0 = Off, above 0 = On)':'Fixed output (%)',Math.round(Number(rule.on_value??0)*100),'min="0" max="100" step="1"').replace("+this.value)","+this.value/100)")}<div class="cfg-field"><span class="cfg-label">No feedback input required</span><span class="cfg-desc">Applied only in the selected operating states. Outside them, the previous sequence or normal-controller command resumes.</span></div>`;
    }
    const sourceName = controllerChannelName(inputs.find(row => String(row.id) === String(rule.source))) || 'Choose input';
    const outputName = controllerChannelName(target) || 'Choose output';
    const targetName = targetSourceType === 0 ? `${Number(rule.target_fixed??0)}` : (controllerChannelName(inputs.find(row => String(row.id) === String(rule.target_source))) || 'Choose target source');
    const path = kind === 3 ? `Fixed command → ${outputName}` : (kind === 2 ? `${targetName} → ${sourceName} target → ${outputName}` : `${sourceName} → ${outputName}`);
    const methodName = kind === 3 ? 'Fixed output by operating state' : (kind === 2 ? 'Feedback target' : (kind === 1 ? 'Mapped input' : 'On / off with hysteresis'));
    return `<details class="control-definition-card config-group" data-group="controller-${index}" data-purpose="${esc(target?.purpose || '')}" data-always-visible="1" data-controller-card data-controller-rule="${index}" data-controller-output="${esc(rule.target || '')}">
      <summary><span class="group-heading"><span class="group-title">${esc(rule.name || outputName)}</span><span class="control-path">${esc(path)}</span><span class="group-desc">${rule.enabled!==false?'Enabled':'Disabled'} · ${methodName}</span></span><span class="group-chevron" aria-hidden="true">›</span></summary>
      <div class="controller-card-body"><div class="controller-card-actions"><label class="controller-enabled"><input aria-label="Controller enabled" type="checkbox" ${rule.enabled!==false?'checked':''} onchange="updateSimpleControl(${index},'enabled',this.checked)"> Enabled</label><button type="button" class="danger" onclick="removeSimpleControl(${index})">Delete controller</button></div>
      <div class="cfg-grid">
        <label class="cfg-field"><span class="cfg-label">Controller name</span><input aria-label="Controller name" value="${esc(rule.name || '')}" maxlength="31" onchange="updateSimpleControl(${index},'name',this.value)"></label>
        <label class="cfg-field"><span class="cfg-label">Output</span><select onchange="updateSimpleControl(${index},'target',this.value)">${optionRows(outputs,rule.target,usedByOthers)}</select></label>
        <label class="cfg-field"><span class="cfg-label">Control method</span><select onchange="updateSimpleControl(${index},'kind',+this.value)"><option value="0"${kind===0?' selected':''}>On / Off with hysteresis</option>${relay?'':`<option value="1"${kind===1?' selected':''}>Map input to output</option><option value="2"${kind===2?' selected':''}>Hold a feedback target</option>`}<option value="3"${kind===3?' selected':''}>Fixed output in selected states</option></select></label>
        ${topology}
      </div><details class="protection-card" style="margin-top:.65rem"><summary><span><span class="protection-card-title">When this controller is active</span><span class="protection-card-desc">RUNNING by default; advanced turbine arrangements may choose other normal states</span></span><span class="protection-card-chevron">›</span></summary><div class="cfg-grid"><label class="cfg-field"><span class="cfg-label">Operating states</span><span class="automation-states"><label class="automation-state"><input type="checkbox" ${modeMask&1?'checked':''} onchange="toggleSimpleControlMode(${index},1,this.checked)"> Standby</label><label class="automation-state"><input type="checkbox" ${modeMask&2?'checked':''} onchange="toggleSimpleControlMode(${index},2,this.checked)"> Startup</label><label class="automation-state"><input type="checkbox" ${modeMask&4?'checked':''} onchange="toggleSimpleControlMode(${index},4,this.checked)"> Running</label><label class="automation-state"><input type="checkbox" ${modeMask&8?'checked':''} onchange="toggleSimpleControlMode(${index},8,this.checked)"> Shutdown</label></span><span class="cfg-desc">The controller owns this output only in checked states. It is always released in FAULT, and STOP/shutdown safety remains authoritative.</span></label></div></details>${dangerous?'<div class="cfg-desc" style="color:var(--yellow);margin-top:.55rem">Warning: this output can affect starting, combustion, or shutdown. Check the selected operating states carefully; STOP, FAULT, and hardware safety remain authoritative.</div>':''}<div class="controller-local-settings" data-controller-settings="${esc(rule.target || '')}"></div></div>
    </details>`;
  }).join('');
  const used = new Set(rules.map(rule => String(rule.target || '')));
  const canAdd = outputs.some(row => !used.has(String(row.id || ''))) && rules.length < 16;
  root.innerHTML = `${cards}<span data-controller-create-capable="${canAdd?'1':'0'}" hidden></span>`;
}

// ── Render form ───────────────────────────────────────────────
const ALL_WORKSPACE_GROUPS = [
  { id:'fuel', title:'Main Fuel & Idle', desc:'Normal fuel demand, idle authority, and reduced-power behavior', sections:['Throttle Response','Idle','Reduced-Power Mode'] },
  { id:'power', title:'Power Turbine & Afterburner', desc:'N2 control and afterburner ignition/running behavior', sections:['Afterburner — Ignition Method','Afterburner — Flame Confirmation','Afterburner — Running'] },
  { id:'oil', title:'Oil & Lubrication Controllers', desc:'Normal pressure response and windmilling oil behavior', sections:['Oil Pressure Control','Windmilling Oil Protection'] },
  { id:'recovery', title:'Start & Recovery Controllers', desc:'Relight and starter-assist behavior', sections:['Automatic Relight','Manual Relight','Pulsed Starter Assist'] },
  { id:'safety', title:'Shutdown & Protection', desc:'Gradual fuel pullbacks, reactive or predictive limiting, hard shutdowns, and input-loss actions', sections:['Engine Protection Limits','Gradual Fuel Limit Protection','Oil Pressure Safety','Combustion & Startup Protection','Auxiliary Protection','RPM Sensor Fault Detection','RC / Servo Signal Loss Detection'] },
  { id:'runtime', title:'ECU Runtime', desc:'Control-loop scheduling and device-wide execution', sections:['ECU Runtime'] },
  { id:'display', title:'External Display Thresholds', desc:'Display-only warning zones for the optional instrument cluster', sections:['External Instrument Cluster Display'] },
];
const WORKSPACE_GROUPS = ALL_WORKSPACE_GROUPS
  .filter(group => CONFIG_SURFACE === 'system'
    ? ['display'].includes(group.id)
    : !['runtime','display'].includes(group.id))
  .map(group => ({...group, sections:group.sections.filter(title =>
    SCHEMA.some(section => section.title === title))}))
  .filter(group => group.sections.length);
const SECTION_GROUP = new Map(WORKSPACE_GROUPS.flatMap(group => group.sections.map(title => [title, group.id])));
let _workspaceFilter = 'configured';
let _searchQuery = '';
let _workspaceRefreshFrame = 0;

function _scheduleWorkspaceRefresh() {
  cancelAnimationFrame(_workspaceRefreshFrame);
  _workspaceRefreshFrame = requestAnimationFrame(applyView);
}

function setWorkspaceFilter(filter) {
  _workspaceFilter = ['configured','explore','changed'].includes(filter) ? filter : 'configured';
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
      else if (_workspaceFilter === 'configured') show = !unavailable;
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
    const alwaysVisible = group.dataset.alwaysVisible === '1' &&
      (_workspaceFilter !== 'changed' || _controllerRulesDirty || _controllerHardwareDirty);
    group.classList.toggle('filter-hidden', !alwaysVisible && count === 0);
    const meta = group.querySelector('.group-meta');
    if (meta && !alwaysVisible) meta.textContent = count ? `${count} setting${count === 1 ? '' : 's'}` : '';
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
  const buttonMap = { configured:'btn-view-expert', explore:'btn-view-explore', changed:'btn-filter-changed' };
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
  const configuredOilPumps = (hwCfg?.channel_registry?.outputs || []).filter(channel =>
    channel?.installed !== false && !String(channel?.mirror_of || '') &&
    String(channel.purpose || channel.role || '') === 'oil_pump');
  const oilPumpIsBinary = channel => [4, 11].includes(Number(channel?.driver));
  const allOilPumpsBinary = configuredOilPumps.length > 0 && configuredOilPumps.every(oilPumpIsBinary);
  const mixedOilPumpDrivers = configuredOilPumps.some(oilPumpIsBinary) && configuredOilPumps.some(channel => !oilPumpIsBinary(channel));
  const protectionGroups = [
    {id:'n1', title:'N1 core speed', desc:'Fuel pullback before the limit, hard overspeed shutdown at the maximum, and minimum running speed.',
      keys:['pb_n1e','pb_n1s','pb_n1h','rpm_limit','min_rpm'], advanced:['pb_n1l','pb_n1str','rl_ramp','rl_zone','rl_acc']},
    {id:'n2', title:'N2 output-shaft speed', desc:'Gradual fuel reduction and independent power-turbine overspeed shutdown.',
      keys:['pb_n2e','pb_n2s','pb_n2h','n2_rpm_limit'], advanced:['pb_n2l','pb_n2str']},
    {id:'egt', title:'Turbine temperature', desc:'Select TOT/TIT, reduce fuel near the limit, then shut down at the hard limit.',
      keys:['eg_src','pb_egte','pb_egts','pb_egth','tot_limit','sf_tit','tot_safe_margin'], advanced:['pb_egtl','pb_egtstr']},
    {id:'p1', title:`${controllerChannelName(controllerInputs('p1_pressure')[0]) || 'Pressure 1'} protection`, desc:'User-named pressure input: gradual fuel reduction followed by an optional high-pressure shutdown.',
      keys:['pb_p1e','pb_p1s','pb_p1h','sf_p1t','sf_p1d'], advanced:['pb_p1l','pb_p1str']},
    {id:'p2', title:`${controllerChannelName(controllerInputs('p2_pressure')[0]) || 'Pressure 2'} protection`, desc:'User-named pressure input: gradual fuel reduction followed by an optional high-pressure shutdown.',
      keys:['pb_p2e','pb_p2s','pb_p2h','sf_p2t','sf_p2d'], advanced:['pb_p2l','pb_p2str']},
    {id:'torque', title:'Shaft torque', desc:'Gradual fuel reduction followed by an optional over-torque shutdown.',
      keys:['pb_tqe','pb_tqs','pb_tqh','sf_tqt','sf_tqd'], advanced:['pb_tql','pb_tqstr']},
  ];
  const gradualSection = SCHEMA.find(section => section.title === 'Gradual Fuel Limit Protection');

  const renderField = (f, sec, group) => {
    let val = getPath(cfg, f.path);
    if (f.type === 'pullback_mode') {
      const enabled = !!val;
      const predictive = Number(getPath(cfg, f.modePath) || 0) === 1;
      val = enabled ? (predictive ? 2 : 1) : 0;
    }
    const isCb  = f.type === 'checkbox';
    const binaryOilFallback = f.key === 'oil_fp' && allOilPumpsBinary;
    const isSel = f.type === 'select' || f.type === 'pullback_mode' || binaryOilFallback;
    const runtimeOptions = binaryOilFallback
      ? [{v:0,l:'Off'},{v:100,l:'On'}]
      : f.type === 'pullback_mode'
      ? [{v:0,l:'Off — hard shutdown only'},{v:1,l:'Simple — measured value'},{v:2,l:'Advanced — predictive'}]
      : (typeof f.options === 'function' ? f.options() : (f.options || []));
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
    const renderOptions = options => {
      let html = '';
      let group = '';
      options.forEach(o => {
        const nextGroup = String(o.group || '');
        if (nextGroup !== group) {
          if (group) html += '</optgroup>';
          group = nextGroup;
          if (group) html += `<optgroup label="${_escHtml(group)}">`;
        }
        html += `<option value="${_escHtml(o.v)}"${val == o.v ? ' selected' : ''}>${_escHtml(o.l)}</option>`;
      });
      if (group) html += '</optgroup>';
      return html;
    };
    const inp = isCb
      ? `<input type="checkbox" id="cf-${f.key}"${aria}${val ? ' checked' : ''}${isLocked ? ' disabled' : ''}>`
      : isSel
      ? `<select id="cf-${f.key}"${aria}${isLocked ? ' disabled' : ''}>${renderOptions(runtimeOptions)}</select>`
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
    const displayTitle = isProtection ? 'Fuel Limiting & Hard Shutdowns' : sec.title;
    const allProtectionFields = isProtection ? [...sec.fields, ...(gradualSection?.fields || [])] : sec.fields;
    const localSafety = {
      'Oil Pressure Safety': [
        {key:'low_oil',label:'Low oil pressure',available:controllerInputs('oil_pressure').length||controllerInputs('low_oil_switch').length,requirement:'Fit oil pressure or a low-oil switch',keys:['oil_rm','sf_lo_d'],desc:'Insufficient but measurable running pressure; uses the normal confirmation delay'},
        {key:'oil_zero',label:'No oil pressure',available:controllerInputs('oil_pressure').length||controllerInputs('oil_zero_switch').length,requirement:'Fit oil pressure or a no-pressure switch',keys:['oil_zb','sf_oz_d'],desc:'Catastrophic near-zero pressure; normally uses a faster confirmation'},
        {label:'Low oil flow',available:true,keys:['oil_ufd','oil_ufs'],desc:'Flow-fault confirmation and optional shutdown'}
      ],
      'Combustion & Startup Protection': [
        {key:'flameout',label:'Combustion loss',available:controllerInputs('flame').length||controllerInputs('n1_speed').length||controllerInputs('tot').length||controllerInputs('tit').length,requirement:'Fit flame, N1, TOT, or TIT feedback',keys:['sf_fo','sf_fs','sf_fn','sf_eb','sf_ef'],desc:'Independent confirmed-loss timer; expiry cuts fuel and fault-shuts down'},
        {key:'hot_start',label:'Hot-start protection',available:controllerInputs('tot').length||controllerInputs('tit').length,requirement:'Fit a TOT or TIT input',keys:['sf_hs','sf_st'],desc:'Pre-start and startup temperature limits'},
        {label:'Safety evaluation timing',available:true,keys:['sf_ci'],desc:'General protection check interval'}
      ],
      'Auxiliary Protection': [
        {key:'oil_temp_high',label:'High oil temperature',available:controllerInputs('oil_temperature').length,requirement:'Fit an oil-temperature input',keys:['sf_ot','sf_ot_d'],desc:'Temperature shutdown threshold and confirmation'},
        {key:'fuel_press_low',label:'Low fuel pressure',available:controllerInputs('fuel_pressure').length,requirement:'Fit a fuel-pressure input',keys:['sf_fp','sf_fp_d'],desc:'Running pressure threshold and confirmation'},
        {key:'batt_low',label:'Low supply voltage',available:controllerInputs('battery_voltage').length,requirement:'Fit a voltage input',keys:['sf_bv','sf_bv_d'],desc:'Bus-voltage threshold and confirmation'},
        {key:'surge',label:'Surge detection',available:controllerInputs('n1_speed').length,requirement:'Fit an N1 speed input',keys:['sf_sg'],desc:'Experimental N1 instability threshold'}
      ],
      'RPM Sensor Fault Detection': [
        {label:'Shaft-speed signal fault detection',available:controllerInputs('n1_speed').length||controllerInputs('n2_speed').length,requirement:'Fit an N1 or N2 shaft-speed input',keys:['rh_jt','rh_zs'],desc:'Reject implausible speed jumps and detect a running sensor stuck at zero'}
      ],
      'RC / Servo Signal Loss Detection': [
        {label:'Pulse and servo-signal fault detection',available:true,keys:['rc_fs'],desc:'Timeout for RC pulse, servo pulse, and registry PWM-duty inputs'}
      ]
    }[sec.title] || [];
    const localSafetyHtml = localSafety.length ? `<div class="protection-stack">${localSafety.map(item => {
      const fields = item.keys.map(key => sec.fields.find(field => field.key === key)).filter(Boolean);
      const toggle = item.key ? controllerSafetyToggle(item.key,item.label,item.available,item.requirement,isLocked) : '';
      const active = item.key && hwCfg?.safety?.[item.key] && item.available;
      const attention = item.key && hwCfg?.safety?.[item.key] && !item.available;
      const summaryState = active ? '<b class="controller-state controller-state-ok">● ACTIVE</b>' : attention ? '<b class="controller-state controller-state-warn">● CHECK</b>' : '';
      return `<details class="protection-card" data-protection="${item.key || item.id || item.label.toLowerCase().replace(/[^a-z0-9]+/g,'-')}">
        <summary><span><span class="protection-card-title">${item.label}</span><span class="protection-card-desc">${item.available ? item.desc : item.requirement}</span></span>${summaryState}<span class="protection-card-chevron">›</span></summary>
        ${toggle}<div class="cfg-grid">${fields.map(field => renderField(field, sec, group)).join('')}</div>
      </details>`;
    }).join('')}</div>` : '';
    let fieldHtml = isProtection
      ? `<div class="protection-stack">${protectionGroups.map((card, index) => {
          const fields = card.keys.map(key => allProtectionFields.find(field => field.key === key)).filter(Boolean);
          const advancedFields = (card.advanced || []).map(key => allProtectionFields.find(field => field.key === key)).filter(Boolean);
          const safety = card.id === 'n1' ? controllerSafetyToggle('overspeed','N1 overspeed',controllerInputs('n1_speed').length,'Fit an N1 speed input',isLocked)
            : card.id === 'n2' ? controllerSafetyToggle('n2_overspeed','N2 overspeed',controllerInputs('n2_speed').length,'Fit an N2 speed input',isLocked)
            : card.id === 'egt' ? controllerSafetyToggle('overtemp','Engine overtemperature',controllerInputs('tot').length||controllerInputs('tit').length,'Fit a TOT or TIT input',isLocked) : '';
          const safetyKey = card.id === 'n1' ? 'overspeed' : card.id === 'n2' ? 'n2_overspeed' : card.id === 'egt' ? 'overtemp' : '';
          const safetyAvailable = card.id === 'n1' ? controllerInputs('n1_speed').length : card.id === 'n2' ? controllerInputs('n2_speed').length : card.id === 'egt' ? (controllerInputs('tot').length||controllerInputs('tit').length) : true;
          const summaryState = safetyKey && hwCfg?.safety?.[safetyKey]
            ? `<b class="controller-state ${safetyAvailable?'controller-state-ok':'controller-state-warn'}">● ${safetyAvailable?'ACTIVE':'CHECK'}</b>` : '';
          return `<details class="protection-card" data-protection="${card.id}">
            <summary><span><span class="protection-card-title">${card.title}</span><span class="protection-card-desc">${card.desc}</span></span>${summaryState}<span class="protection-card-chevron">›</span></summary>
            ${safety}<div class="cfg-grid">${fields.map(field => renderField(field, sec, group)).join('')}</div>
            ${advancedFields.length ? `<div class="cfg-grid protection-predictive-fields" data-predictive-for="${card.id}">${advancedFields.map(field => renderField(field, sec, group)).join('')}</div>` : ''}
          </details>`;
        }).join('')}</div>`
      : localSafety.length ? localSafetyHtml : `<div class="cfg-grid">${sec.fields.map(field => renderField(field, sec, group)).join('')}</div>`;
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
    (CONFIG_SURFACE === 'system' ? '<section id="system-device-setup" class="cfg-section" data-always-visible="1" data-section="Device and communications"></section>' : '') +
    normalGroupsHtml +
    (CONFIG_SURFACE === 'controllers' ? '<section id="simple-controls" class="cfg-section" data-always-visible="1" data-section="Custom controllers"></section>' : '') +
    safetyGroupsHtml +
    '<div id="cfg-empty" class="cfg-empty" hidden>No settings match this search and filter.</div>';
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
  const _rlTriggerEl = document.getElementById('cf-rl_ts');
  const _rlSrcEl = document.getElementById('cf-rl_cs');
  if (_flSrcEl) _flSrcEl.addEventListener('change', applyFlameoutRelightVisibility);
  if (_rlTriggerEl) _rlTriggerEl.addEventListener('change', applyFlameoutRelightVisibility);
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
  ['pb_n1e','pb_n2e','pb_egte','pb_p1e','pb_p2e','pb_tqe'].forEach(key => {
    const el = document.getElementById('cf-' + key);
    if (el) el.addEventListener('change', () => { applyHwConditions(); applyView(); runValidation(); });
  });

  // Controller cards and their local settings are mounted beside cfg-form,
  // so both workspace surfaces own dirty tracking. Property handlers avoid
  // stacking duplicate listeners when a controller topology rerenders.
  [document.getElementById('cfg-form'), document.getElementById('controller-overview')]
    .filter(Boolean).forEach(surface => {
      surface.oninput = _markDirty;
      surface.onchange = () => {
        _markDirty();
        // Dependency-controlled subcards must react immediately. In
        // particular, enabling windmilling oil protection reveals its output
        // selector without requiring a reload or view-filter change.
        _applyAllVisibility();
        runValidation();
      };
    });

  // Apply current view filter
  applyView();
}
