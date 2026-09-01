// ── Cross-parameter inline validation warnings ────────────────
// Called after renderForm() and after any field edit.
// Reads values directly from the form inputs so they stay in sync.
function runValidation() {
  // Helper: read a numeric value from a form field by SCHEMA key
  function fv(key) {
    const el = document.getElementById('cf-' + key);
    if (!el) return undefined;
    const v = parseFloat(el.value);
    return isNaN(v) ? undefined : v;
  }

  // Build warnings list: { sectionTitle, message }
  const warnings = [];

  // Pre-ignition RPM comes from the loaded config (sequence.html param, not a config-form field)
  const preIgnRpmVal   = (cfg?.sequence?.startup?.pre_ign_rpm) ?? undefined;
  const spoolRpmTarget = (cfg?.sequence?.startup?.rpm_target)  ?? undefined;

  const idleTargetRpm  = fv('di_tr');          // dynamic_idle.target_rpm
  const rpmLimit       = fv('rpm_limit');
  const n2RpmLimit     = fv('n2_rpm_limit');

  // Compute startup values from cfg (these live in sequence/hardware, not config form)
  const startupCfg  = cfg?.sequence?.startup ?? {};
  const computedPreIgnRpm     = startupCfg.pre_ign_rpm     ?? preIgnRpmVal;
  const computedSpoolRpmTarget= startupCfg.rpm_target      ?? spoolRpmTarget;

  // 1. preIgnRpm > spoolRpmTarget
  if (computedPreIgnRpm !== undefined && computedSpoolRpmTarget !== undefined
      && computedPreIgnRpm > computedSpoolRpmTarget) {
    warnings.push({
      section: 'Engine Protection Limits',
      key:     'warn-preignrpm',
      msg:     '⚠ Pre-ignition RPM is above spool target — the later spool stage may already be satisfied and skip its intended acceleration step'
    });
  }

  // 2. Idle target must remain below the shaft limit it actually uses.
  const idleSource = Number(document.getElementById('cf-di_src')?.value || 0);
  const idleComparisonLimit = idleSource === 1 ? n2RpmLimit : (idleSource === 0 ? rpmLimit : 0);
  if (idleTargetRpm !== undefined && idleComparisonLimit !== undefined &&
      idleComparisonLimit > 0 && idleTargetRpm >= idleComparisonLimit) {
    warnings.push({
      section: 'Idle',
      key:     'warn-idlelimit',
      msg:     '⚠ Idle target is at or above the selected shaft hard limit.'
    });
  }

  const n1PullbackEnabled = Number(document.getElementById('cf-pb_n1e')?.value || 0) > 0;
  const n1PullbackSoft = fv('pb_n1s'), n1PullbackFull = fv('pb_n1h');
  if (n1PullbackEnabled && rpmLimit > 0 &&
      ((n1PullbackSoft > 0 && n1PullbackSoft >= rpmLimit) ||
       (n1PullbackFull > 0 && n1PullbackFull >= rpmLimit))) {
    const n1LimitLabel = hwCfg.safety?.overspeed
      ? 'the hard N1 shutdown limit'
      : 'Maximum N1 Speed';
    warnings.push({section:'Engine Protection Limits', key:'warn-n1-pullback-trip',
      msg:`⚠ N1 pullback starts or reaches full authority at/above ${n1LimitLabel}. Set both pullback points below that limit.`});
  }

  const governorTargetNow = fv('gv_tr');
  if (hwCfg.controllers?.governor && hasRegistryInput('n2_speed') &&
      !(governorTargetNow > 0)) {
    warnings.push({section:'Automatic N2 Speed Control', key:'warn-governor-zero',
      msg:'⚠ Automatic N2 speed control is enabled in Hardware, but Target N2 RPM is 0. The controller remains inactive until a rated target is entered.'});
  }

  const standbyOilEnabledNow = !!document.getElementById('cf-so_en')?.checked;
  const standbySourceNow = Number(document.getElementById('cf-so_src')?.value || 0);
  const standbyRpmNow = fv('so_rl') || 0;
  const standbyLimitsNow = standbySourceNow === 0 ? [rpmLimit || 0] :
                           standbySourceNow === 1 ? [n2RpmLimit || 0] :
                           [rpmLimit || 0, n2RpmLimit || 0];
  const usableStandbyLimitsNow = standbyLimitsNow.filter(v => v > 0);
  if (standbyOilEnabledNow && usableStandbyLimitsNow.length && usableStandbyLimitsNow.every(limit => standbyRpmNow >= limit)) {
    warnings.push({section:'Windmilling Oil Protection', key:'warn-standby-oil-rpm',
      msg:'⚠ Start threshold is at/above every selected shaft limit, so windmilling oil protection can never activate.'});
  }
  if (standbyOilEnabledNow && (fv('so_fp') || 0) <= 0 && (fv('so_fb') || 0) <= 0) {
    warnings.push({section:'Windmilling Oil Protection', key:'warn-standby-oil-output',
      msg:'⚠ Pump output and pressure target are both zero; this protection would command no oil.'});
  }
  const standbyPumpId = String(document.getElementById('cf-so_oid')?.value || '');
  const standbyPumps = (hwCfg?.channel_registry?.outputs || []).filter(row =>
    row?.installed !== false && !String(row?.mirror_of || '') &&
    String(row?.purpose || '') === 'oil_pump');
  const standbyPump = standbyPumps.find(row => String(row.id || '') === standbyPumpId);
  if (standbyOilEnabledNow && !standbyPump) {
    warnings.push({section:'Windmilling Oil Protection', key:'warn-standby-oil-device',
      msg:standbyPumps.length > 1
        ? '⚠ Choose which exact oil pump windmilling protection controls.'
        : standbyPumps.length === 1
          ? '⚠ The selected oil pump is missing or incompatible.'
          : '⚠ Fit an oil pump before enabling windmilling oil protection.'});
  } else if (standbyOilEnabledNow && standbyPump && (fv('so_fb') || 0) > 0) {
    const matchingLoop = (hwCfg?.oil_loops || []).some(loop => loop?.enabled !== false &&
      String(loop?.pump_output || '') === standbyPumpId && String(loop?.pressure_input || ''));
    if (!matchingLoop) warnings.push({section:'Windmilling Oil Protection', key:'warn-standby-oil-loop',
      msg:'⚠ This pressure target needs an enabled oil-pressure controller using the same pump. Otherwise use a fixed output.'});
  }

  const abMainOffsetNow = fv('ab_mo') || 0;
  const mainFuelMinimumNow = Number(cfg?.throttle?.fuel_pump_min_pct || 0);
  if (abMainOffsetNow < 0 && mainFuelMinimumNow > 0) {
    const floorStartsBelow = Math.min(100, mainFuelMinimumNow - abMainOffsetNow);
    warnings.push({section:'Afterburner — Running', key:'warn-ab-main-fuel-floor',
      msg:`⚠ Negative AB coordination reaches the reliable-fuel floor below ${floorStartsBelow.toFixed(1)}% main-fuel command. The running output will hold ${mainFuelMinimumNow.toFixed(1)}% rather than turn off.`});
  }

  // N2 control targets should leave operating margin below the independent trip.
  if (hwCfg.safety?.n2_overspeed && n2RpmLimit > 0) {
    const pbEnabled = Number(document.getElementById('cf-pb_n2e')?.value || 0) > 0;
    const pbSoft = fv('pb_n2s'), pbFull = fv('pb_n2h');
    if (pbEnabled && ((pbSoft > 0 && pbSoft >= n2RpmLimit) ||
                      (pbFull > 0 && pbFull >= n2RpmLimit))) {
      warnings.push({section:'Engine Protection Limits', key:'warn-n2-pullback-trip',
        msg:'⚠ N2 pullback starts or reaches full authority at/above the hard N2 shutdown limit. Set both pullback points below the trip.'});
    }
    const govTarget = fv('gv_tr'), govBand = fv('gv_bd') || 0;
    if (hwCfg.controllers?.governor && govTarget > 0 && govTarget + govBand >= n2RpmLimit) {
      warnings.push({section:'Automatic N2 Speed Control', key:'warn-n2-governor-trip',
        msg:'⚠ Governor target plus its no-correction band reaches the hard N2 shutdown limit. Leave operating margin below the trip.'});
    }
    const n2Warn = fv('cl_n2');
    if (n2Warn > 0 && n2Warn >= n2RpmLimit) {
      warnings.push({section:'External Instrument Cluster Display', key:'warn-n2-cluster-trip',
        msg:'⚠ Cluster N2 warning is at/above the hard shutdown limit, so the display may not warn before the ECU trips.'});
    }
  }

  const egtSourceVal = Number((document.getElementById('cf-eg_src') || {}).value || cfg?.safety?.egt_source || 0);
  const hasTotHw = hasRegistryInput('tot');
  const hasTitHw = hasRegistryInput('tit');
  const effectiveEgt = egtSourceVal === 1 && hasTotHw ? 1 :
                       egtSourceVal === 2 && hasTitHw ? 2 :
                       hasTotHw ? 1 :
                       hasTitHw ? 2 : 0;

  // 5. Safety-zero: selected EGT limit = 0 disables overtemperature protection
  const totLimitVal = fv('tot_limit');
  const totLimitCanonical = totLimitVal !== undefined ? _fieldFromDisplay(_fieldDef('tot_limit') || {}, totLimitVal) : undefined;
  const titLimitVal = fv('sf_tit');
  const titLimitCanonical = titLimitVal !== undefined ? _fieldFromDisplay(_fieldDef('sf_tit') || {}, titLimitVal) : undefined;
  const activeEgtLimit = effectiveEgt === 1 ? totLimitVal : (effectiveEgt === 2 ? titLimitVal : 0);
  const startupEgtLimit = fv('sf_st') || activeEgtLimit || 0;
  const preStartEgtLimit = fv('sf_hs') || 0;
  if (hwCfg.safety?.hot_start && preStartEgtLimit > 0 && startupEgtLimit > 0 &&
      preStartEgtLimit >= startupEgtLimit) {
    warnings.push({section:'Combustion & Startup Protection', key:'warn-prestart-egt-limit',
      msg:'⚠ Pre-start EGT maximum is at/above the startup hard EGT limit. Lower the pre-start value so a hot engine is blocked before START.'});
  }
  if (effectiveEgt === 1 && totLimitCanonical !== undefined && Math.abs(totLimitCanonical) < 0.001) {
    warnings.push({
      section: 'Engine Protection Limits',
      key:     'warn-tot-zero',
      msg:     '⚠ TOT Limit is 0 - overtemperature protection is DISABLED for the selected engine temperature source.'
    });
  }
  if (effectiveEgt === 2 && titLimitCanonical !== undefined && Math.abs(titLimitCanonical) < 0.001) {
    warnings.push({
      section: 'Engine Protection Limits',
      key:     'warn-tit-zero',
      msg:     '⚠ TIT Limit is 0 - overtemperature protection is DISABLED for the selected engine temperature source.'
    });
  }

  // 6. Safety-zero: oil running min = 0 disables oil pressure fault
  const oilRunningVal = fv('oil_rm');
  if (oilRunningVal !== undefined && oilRunningVal === 0) {
    warnings.push({
      section: 'Oil Pressure Safety',
      key:     'warn-oil-zero',
      msg:     '⚠ Running Oil Min is 0 — oil pressure fault protection is DISABLED. Set a value to protect the engine.'
    });
  }

  // Clear all existing inline warnings
  document.querySelectorAll('.cfg-inline-warn').forEach(el => el.remove());

  // Render each warning below the relevant section title
  warnings.forEach(w => {
    // Find the cfg-section whose cfg-title text matches the section name
    const sections = document.querySelectorAll('.cfg-section');
    let targetSection = null;
    sections.forEach(sec => {
      if (sec.dataset.section === w.section) {
        targetSection = sec;
      }
    });
    if (!targetSection) return;
    const titleEl = targetSection.querySelector('.cfg-title');
    if (!titleEl) return;
    // Avoid duplicate
    if (targetSection.querySelector('[data-warnkey="' + w.key + '"]')) return;
    const div = document.createElement('div');
    div.className = 'cfg-inline-warn';
    div.setAttribute('data-warnkey', w.key);
    div.style.cssText = 'font-size:.75rem;color:var(--yellow);background:rgba(255,196,0,.08);border:1px solid rgba(255,196,0,.3);border-radius:5px;padding:.28rem .65rem;margin:.3rem 0 .4rem;line-height:1.4';
    div.textContent = w.msg;
    titleEl.insertAdjacentElement('afterend', div);
    const group = targetSection.closest('.config-group');
    if (group) group.open = true;
  });
}

// Hook runValidation into all number inputs after form render
function hookValidation() {
  document.querySelectorAll('#cfg-form input[type="number"]').forEach(inp => {
    inp.addEventListener('input', runValidation);
  });
}

// ── Save validation ───────────────────────────────────────────
async function validateBeforeSave(cfg) {
  const errors = [];
  const warns  = [];

  function gv(obj, ...keys) {
    return keys.reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
  }

  const rpmLimit   = gv(cfg, 'engine', 'rpm_limit');
  const n2RpmLimit = gv(cfg, 'engine', 'n2_rpm_limit');
  const minRpm     = gv(cfg, 'engine', 'min_rpm');
  const idleTarget = gv(cfg, 'dynamic_idle', 'target_rpm');
  const idleSource = Number(gv(cfg, 'dynamic_idle', 'source') || 0);
  const hasN1 = hasRegistryInput('n1_speed');
  const hasN2 = hasRegistryInput('n2_speed');
  const hasP1 = hasRegistryInput('p1_pressure');
  const hasP2 = hasRegistryInput('p2_pressure');
  const hasFlame = hasRegistryInput('flame');
  const hasAnyIdleRpm = hasN1 || hasN2;

  const windmillEnabled = !!gv(cfg, 'standby_oil', 'enabled');
  const windmillPumpId = String(gv(cfg, 'standby_oil', 'output_id') || '');
  const fittedOutputs = _independentFittedOutputs();
  const fittedOilPumps = fittedOutputs.filter(row => String(row?.purpose || '') === 'oil_pump');
  const windmillPump = fittedOutputs.find(row => String(row.id || '') === windmillPumpId);
  if (windmillEnabled && !windmillPump)
    errors.push(fittedOilPumps.length
      ? 'Windmilling Oil Protection: choose the fitted output this protection should command.'
      : 'Windmilling Oil Protection: choose a fitted output or turn this optional protection off.');
  if (windmillEnabled && windmillPump && Number(gv(cfg, 'standby_oil', 'feed_bar') || 0) > 0) {
    const matchingLoop = (hwCfg?.oil_loops || []).some(loop => loop?.enabled !== false &&
      String(loop?.pump_output || '') === windmillPumpId && String(loop?.pressure_input || ''));
    if (!matchingLoop)
      errors.push('Windmilling Oil Protection: its pressure target needs an enabled oil-pressure controller using the same pump. Use a fixed output or configure that loop.');
  }

  const customControls = _controllerRulesDirty && Array.isArray(cfg.rules) ? cfg.rules : [];
  const installedInputs = new Set(simpleControlInputs().map(row => String(row.id || '')));
  const availableOutputs = new Set(simpleControlOutputs().map(row => String(row.id || '')));
  const claimedOutputs = new Set();
  customControls.forEach((control, index) => {
    const label = String(control.name || `Custom controller ${index + 1}`);
    const output = String(control.target || '');
    const kind = Number(control.kind || 0);
    if ((Number(control.mode_mask ?? 4) & 0x0f) === 0)
      errors.push(`${label}: select at least one operating state.`);
    if (kind !== 3 && !installedInputs.has(String(control.source || '')))
      errors.push(`${label}: choose a fitted input or feedback signal.`);
    if (!availableOutputs.has(output))
      errors.push(`${label}: its output is unavailable or already belongs to a dedicated controller.`);
    if (control.enabled !== false && claimedOutputs.has(output))
      errors.push(`${label}: another custom controller already owns this output.`);
    if (control.enabled !== false) claimedOutputs.add(output);
    if (kind === 1 && Number(control.input_min) === Number(control.input_max))
      errors.push(`${label}: mapped input low and high cannot be equal.`);
    if (kind === 2) {
      const targetType = Number(control.target_source_type || 0);
      if (targetType !== 0 && !installedInputs.has(String(control.target_source || '')))
        errors.push(`${label}: choose a fitted target-source input.`);
      if (targetType === 2 && Number(control.target_input_min) === Number(control.target_input_max))
        errors.push(`${label}: target-source input low and high cannot be equal.`);
      if (Number(control.output_min) > Number(control.output_max))
        errors.push(`${label}: minimum output must not exceed maximum output.`);
    }
  });

  if (hasN1 && rpmLimit !== undefined && minRpm !== undefined && minRpm >= rpmLimit)
    errors.push('Min RPM (' + minRpm + ') must be below RPM Limit (' + rpmLimit + ').');
  if (hwCfg.safety?.n2_overspeed && (!hasN2 || !(Number(n2RpmLimit) > 0)))
    errors.push('N2 overspeed safety requires a fitted N2 RPM input and a Maximum N2 Speed above 0.');
  const idleSourceAvailable = [hasN1, hasN2, hasP1, hasP2][idleSource] === true;
  if (hwCfg.controllers?.dynamic_idle && !idleSourceAvailable)
    errors.push('Automatic Idle feedback source is not configured. Choose an available N1, N2, P1, or P2 source before saving.');

  const assistEnabled = !!gv(cfg, 'starter_control', 'pulsed_assist_enabled');
  const starter = registryOutputByPurpose('starter');
  if (assistEnabled && (!starter || ![5,6].includes(Number(starter.driver)) || !hasN1))
    errors.push('Pulsed Starter Assist requires a proportional servo/PWM starter and an N1 speed input.');
  const assistThreshold = Number(gv(cfg, 'starter_control', 'pulsed_assist_until_rpm') || 0);
  const starterTarget = Number(gv(cfg, 'sequence', 'startup', 'pre_ign_rpm') || 0);
  if (assistEnabled && starterTarget > 0 && assistThreshold >= starterTarget)
    warns.push('Pulsed Starter Assist threshold is at or above the StarterSpin target. Normal ramped starter control will not run before the block completes.');

  if (gv(cfg, 'relight', 'enabled')) {
    const relightMin = Number(gv(cfg, 'relight', 'min_rpm') || 0);
    const relightConfirm = Number(gv(cfg, 'relight', 'confirm_rpm') || 0);
    const relightTriggerSource = Number(gv(cfg, 'relight', 'trigger_source') || 0);
    const relightConfirmSource = Number(gv(cfg, 'relight', 'confirm_source') || 0);
    const automaticSource = hasFlame ? 1 : (hasN1 ? 2 : ((hasRegistryInput('tot') || hasRegistryInput('tit')) ? 3 : 0));
    const effectiveTriggerSource = relightTriggerSource || automaticSource;
    const effectiveConfirmSource = relightConfirmSource || effectiveTriggerSource;
    if (relightMin <= 0)
      errors.push('Automatic relight requires an explicit Minimum N1 to Fire Relight Ignition above 0 RPM.');
    if (effectiveConfirmSource === 2 && relightConfirm <= 0)
      errors.push('N1-based relight confirmation requires an explicit N1 Recovery Confirmation above 0 RPM.');
    if (!effectiveTriggerSource)
      errors.push('Automatic relight requires its own fitted flame, N1, TOT, or TIT trigger source.');
    if (effectiveTriggerSource === 3 &&
        Number(gv(cfg, 'relight', 'trigger_egt_below_c') || 0) <= 0 &&
        Number(gv(cfg, 'relight', 'trigger_egt_fall_rate_c_s') || 0) <= 0)
      errors.push('EGT-triggered automatic relight requires a low-temperature threshold, a fall-rate threshold, or both.');
    const minimumRunningN1 = Number(gv(cfg, 'engine', 'min_rpm') || 0);
    const effectiveRelightMin = Math.max(relightMin, minimumRunningN1);
    if (effectiveTriggerSource === 2 && relightConfirm <= effectiveRelightMin)
      errors.push('N1-triggered automatic relight needs its trigger/recovery speed above the effective minimum firing speed, creating a usable relight band.');
    if (relightMin > 0 && minimumRunningN1 > 0 && relightMin < minimumRunningN1)
      warns.push(`Minimum N1 to fire relight is below Minimum Running N1. The ECU will use ${Math.round(minimumRunningN1)} RPM as the automatic-relight floor.`);
    if (effectiveConfirmSource === 2 && relightConfirm < effectiveRelightMin)
      warns.push('N1 recovery confirmation is below the effective speed allowed to fire relight ignition. Normally set recovery at or above that firing floor.');
  }

  if (idleSource < 2 && hasAnyIdleRpm && idleTarget !== undefined && minRpm !== undefined && idleTarget < minRpm)
    warns.push('Idle target RPM (' + idleTarget + ') is below Min RPM (' + minRpm + '). Engine may fault at idle.');

  if (hwCfg.controllers?.dynamic_idle) {
    const idleDeadband = Number(gv(cfg, 'dynamic_idle', idleSource >= 2 ? 'pressure_deadband_bar' : 'deadband_rpm') || 0);
    const idleCutoff = Number(gv(cfg, 'dynamic_idle', idleSource >= 2 ? 'pressure_limit_bar' : 'rpm_limit') || 0);
    const selectedTarget = Number(gv(cfg, 'dynamic_idle', idleSource >= 2 ? 'target_pressure_bar' : 'target_rpm') || 0);
    if (idleCutoff > 0 && selectedTarget + idleDeadband >= idleCutoff)
      warns.push('Automatic Idle target plus its no-correction band reaches Stop Controlling Above. The controller may release before settling at its target.');
  }

  if (hwCfg.safety?.n2_overspeed && Number(n2RpmLimit) > 0) {
    const pbN2Enabled = !!gv(cfg, 'throttle', 'pullback_n2');
    const pbN2Soft = Number(gv(cfg, 'throttle', 'pullback_n2_soft_rpm') || 0);
    const pbN2Full = Number(gv(cfg, 'throttle', 'pullback_n2_hard_rpm') || 0);
    if (pbN2Enabled && ((pbN2Soft > 0 && pbN2Soft >= n2RpmLimit) ||
                        (pbN2Full > 0 && pbN2Full >= n2RpmLimit)))
      warns.push('N2 pullback should begin and reach full authority below Maximum N2 Speed (' + n2RpmLimit + ' RPM), otherwise the hard shutdown can occur before gradual reduction is effective.');
    const governorTarget = Number(gv(cfg, 'governor', 'target_rpm') || 0);
    const governorBand = Number(gv(cfg, 'governor', 'band_rpm') || 0);
    if (hwCfg.controllers?.governor && governorTarget > 0 && governorTarget + governorBand >= n2RpmLimit)
      warns.push('Governor target plus no-correction band (' + (governorTarget + governorBand) + ' RPM) reaches Maximum N2 Speed (' + n2RpmLimit + ' RPM). Leave operating margin below the hard trip.');
    if (hwCfg.controllers?.dynamic_idle && idleSource === 1 && Number(idleTarget) >= n2RpmLimit)
      warns.push('N2-based idle target (' + idleTarget + ' RPM) is at or above Maximum N2 Speed (' + n2RpmLimit + ' RPM).');
    const clusterN2Warn = Number(gv(cfg, 'cluster', 'n2_warn_rpm') || 0);
    if (clusterN2Warn > 0 && clusterN2Warn >= n2RpmLimit)
      warns.push('Cluster N2 warning (' + clusterN2Warn + ' RPM) is at or above Maximum N2 Speed (' + n2RpmLimit + ' RPM), so the display may not warn before shutdown.');
  }
  const pbN1Enabled = !!gv(cfg, 'throttle', 'pullback_n1');
  const pbN1Soft = Number(gv(cfg, 'throttle', 'pullback_n1_soft_rpm') || 0);
  const pbN1Full = Number(gv(cfg, 'throttle', 'pullback_n1_hard_rpm') || 0);
  if (pbN1Enabled && Number(rpmLimit) > 0 &&
      ((pbN1Soft > 0 && pbN1Soft >= rpmLimit) ||
       (pbN1Full > 0 && pbN1Full >= rpmLimit))) {
    const consequence = hwCfg.safety?.overspeed
      ? 'the hard shutdown can occur before gradual reduction is effective'
      : 'gradual reduction cannot finish before the configured maximum';
    warns.push('N1 pullback should begin and reach full authority below Maximum N1 Speed (' + rpmLimit + ' RPM), otherwise ' + consequence + '.');
  }
  const governorTarget = Number(gv(cfg, 'governor', 'target_rpm') || 0);
  if (hwCfg.controllers?.governor && hasN2 && governorTarget <= 0)
    warns.push('Automatic N2 speed control is enabled in Hardware, but Target N2 RPM is 0. The governor remains inactive until you enter the rated output-shaft speed.');

  // Windmilling oil protection must be able to trigger and command oil.
  const standbyEnabled = !!gv(cfg, 'standby_oil', 'enabled');
  const standbySource = Number(gv(cfg, 'standby_oil', 'source') || 0);
  const standbyRpm = Number(gv(cfg, 'standby_oil', 'rpm_limit') || 0);
  const standbyPct = Number(gv(cfg, 'standby_oil', 'feed_pct') || 0);
  const standbyBar = Number(gv(cfg, 'standby_oil', 'feed_bar') || 0);
  const sourceLimits = standbySource === 0 ? [Number(rpmLimit) || 0] :
                       standbySource === 1 ? [Number(n2RpmLimit) || 0] :
                       [Number(rpmLimit) || 0, Number(n2RpmLimit) || 0];
  const usableLimits = sourceLimits.filter(v => v > 0);
  if (standbyEnabled && usableLimits.length && usableLimits.every(limit => standbyRpm >= limit))
    warns.push('Windmilling-oil start threshold (' + standbyRpm + ' RPM) is at or above every selected shaft limit. The protective oil pump can never start; use a threshold well below normal shaft speed.');
  if (standbyEnabled && standbyPct <= 0 && standbyBar <= 0)
    warns.push('Windmilling-oil protection commands neither pump output nor pressure. Set a protective pump percentage or pressure target, or it will run without delivering oil.');

  // Oil system cross-checks
  const oilRunning   = gv(cfg, 'oil', 'running_min');
  const oilStartup   = gv(cfg, 'oil', 'startup_min_bar');
  const oilMapMin    = gv(cfg, 'oil', 'map_min');
  const oilMapMax    = gv(cfg, 'oil', 'map_max');
  if (oilStartup !== undefined && oilRunning !== undefined && oilStartup < oilRunning)
    warns.push('Oil Arm Minimum (' + oilStartup + ' bar) is below Running Min (' + oilRunning + ' bar). Startup may pass and then immediately fault when the stricter running limit becomes active.');
  if (oilMapMin !== undefined && oilMapMax !== undefined && oilMapMin > oilMapMax)
    errors.push('Running Oil (' + oilMapMin + ' bar) is greater than Map Max (' + oilMapMax + ' bar). Swap them.');
  if (oilMapMin !== undefined && oilRunning !== undefined && oilMapMin < oilRunning)
    warns.push('Running Oil (' + oilMapMin + ' bar) is below Running Min (' + oilRunning + ' bar). The running oil setpoint should be at or above the fault threshold.');

  // EGT / temperature cross-checks
  const totLimit    = gv(cfg, 'engine', 'tot_limit');
  const titLimit    = gv(cfg, 'safety', 'tit_limit_c');
  const totMargin   = gv(cfg, 'engine', 'tot_safe_margin');
  const sourcePref = gv(cfg, 'safety', 'egt_source') || 0;
  const hasTotHw = hasRegistryInput('tot');
  const hasTitHw = hasRegistryInput('tit');
  const primaryLimit = sourcePref === 1 && hasTotHw ? totLimit :
                       sourcePref === 2 && hasTitHw ? titLimit :
                       hasTotHw ? totLimit :
                       hasTitHw ? titLimit : undefined;
  const primaryLabel = sourcePref === 2 && hasTitHw ? 'TIT' :
                       sourcePref === 1 && hasTotHw ? 'TOT' :
                       hasTotHw ? 'TOT' : (hasTitHw ? 'TIT' : 'EGT');
  if (primaryLimit !== undefined && totMargin !== undefined && totMargin >= primaryLimit)
    errors.push('EGT Soft Margin (' + totMargin + '°) must be less than selected ' + primaryLabel + ' limit (' + primaryLimit + '°).');
  const preStartLimit = Number(gv(cfg, 'sequence', 'startup', 'pre_start_egt_limit_c') || 0);
  const separateStartupLimit = Number(gv(cfg, 'sequence', 'startup', 'startup_egt_limit_c') || 0);
  const effectiveStartupLimit = separateStartupLimit > 0 ? separateStartupLimit : Number(primaryLimit || 0);
  if (hwCfg.safety?.hot_start && preStartLimit > 0 && effectiveStartupLimit > 0 &&
      preStartLimit >= effectiveStartupLimit)
    warns.push('Pre-Start EGT Maximum (' + preStartLimit + '°) is at/above the startup hard EGT limit (' + effectiveStartupLimit + '°). Lower it so a hot engine is blocked before START.');

  // AB pump range — backend rejects max < min; name the fields before submit
  const abPmn = gv(cfg, 'afterburner', 'pump_min_pct');
  const abPmx = gv(cfg, 'afterburner', 'pump_max_pct');
  if (abPmn !== undefined && abPmx !== undefined && abPmx < abPmn)
    errors.push('Afterburner Fuel Pump Max % (' + abPmx + ') is below Min % (' + abPmn + '). Swap them.');
  const abMainOffset = Number(gv(cfg, 'afterburner', 'main_fuel_offset_pct') || 0);
  const mainFuelMinimum = Number(gv(cfg, 'throttle', 'fuel_pump_min_pct') || 0);
  if (abMainOffset < 0 && mainFuelMinimum > 0)
    warns.push('Negative AB main-fuel coordination will hold a running pump at its ' + mainFuelMinimum.toFixed(1) + '% reliable minimum rather than turn it off.');

  // Throttle pullback ordering — backend rejects hard limits at/below the
  // soft/start limit; catch each pair here with a named message.
  const pbPairs = [
    ['throttle', 'pullback_n1_soft_rpm',  'throttle', 'pullback_n1_hard_rpm',  'N1 Pullback Start', 'N1 Pullback Full'],
    ['throttle', 'pullback_n2_soft_rpm',  'throttle', 'pullback_n2_hard_rpm',  'N2 Pullback Start', 'N2 Pullback Full'],
    ['throttle', 'pullback_egt_soft_c',   'throttle', 'pullback_egt_hard_c',   'EGT Pullback Start', 'EGT Pullback Full'],
  ];
  pbPairs.forEach(([s1, k1, s2, k2, l1, l2]) => {
    const soft = gv(cfg, s1, k1), full = gv(cfg, s2, k2);
    if (soft !== undefined && full !== undefined && soft > 0 && full > 0 && full <= soft)
      errors.push(l2 + ' (' + full + ') must be above ' + l1 + ' (' + soft + ').');
  });

  // Safety-zero checks: 0 = disabled in SafetyMonitor - warn loudly
  if (primaryLimit !== undefined && primaryLimit === 0)
    warns.push(primaryLabel + ' Limit is 0 - overtemperature protection is DISABLED. The engine will not shut down on over-temperature.');
  if (oilRunning !== undefined && oilRunning === 0)
    warns.push('Running Oil Min is 0 — oil pressure fault protection is DISABLED. The engine will not shut down on oil loss.');

  if (hasActualAfterburnerHardware() &&
      Number(gv(cfg, 'afterburner', 'flame_mode')) === 2) {
    warns.push('Afterburner uses a timed assumption with no flame verification. A failed light-up can continue feeding fuel.');
    if (Number(gv(cfg, 'afterburner', 'stabilize_max_tot')) === 0)
      warns.push('Afterburner timed assumption is combined with disabled stabilization EGT protection. Fit flame/EGT feedback or configure a verified stabilization limit.');
  }

  if (errors.length) {
    alert('Cannot save — fix these errors:\n\n' + errors.map(e => '• ' + e).join('\n'));
    return false;
  }
  if (warns.length) {
    return await OTDialog.confirm('Warnings:\n\n' + warns.map(w => '• ' + w).join('\n'), {
      title:'Review safety warnings', confirmLabel:'Save anyway', danger:true
    });
  }
  return true;
}

// ── Save ──────────────────────────────────────────────────────
// Stage 1: collect form values into cfg, validate, then show recap modal.
async function saveConfig() {
  if (isLocked) { alert('Config is locked - stop the engine first. (Live editing requires Dev Mode enabled beforehand, from Tools while in STANDBY.)'); return; }

  // Read form values into cfg (needed so _buildChanges has current cfg for validation)
  SCHEMA.forEach(sec => {
    sec.fields.forEach(f => {
      const el = document.getElementById('cf-' + f.key);
      if (!el) return;
      if (f.type === 'pullback_mode') {
        const mode = Number(el.value || 0);
        setPath(cfg, f.path, mode > 0);
        setPath(cfg, f.modePath, mode === 2 ? 1 : 0);
      } else if (f.type === 'checkbox') {
        setPath(cfg, f.path, el.checked);
      } else if (f.string) {
        setPath(cfg, f.path, String(el.value || ''));
      } else {
        let v = parseFloat(el.value);
        if (!isNaN(v)) {
          v = _fieldFromDisplay(f, v);
          setPath(cfg, f.path, v);
        }
      }
    });
  });

  // Run hard validation first (errors block save entirely)
  if (!await validateBeforeSave(cfg)) return;

  // Build the change list for the recap
  const changes = _buildChanges();
  if (!changes.length) {
    // Nothing differs from snapshot — skip recap and save directly
    _doSave();
    return;
  }

  const modal    = document.getElementById('save-recap-modal');
  const body     = document.getElementById('save-recap-body');
  const subtitle = document.getElementById('save-recap-subtitle');
  const inactiveChanges = changes.filter(change => change.inactive);
  subtitle.textContent = changes.length + ' field' + (changes.length > 1 ? 's' : '') +
    ' will be updated on the device.' +
    (inactiveChanges.length
      ? ` ${inactiveChanges.length} amber-marked value${inactiveChanges.length === 1 ? ' is' : 's are'} being saved for future hardware and will remain inactive for now.`
      : '');

  const rows = changes.map(c =>
    `<tr>
      <td>${_escHtml(c.label)}${c.inactive ? '<br><span style="color:var(--yellow);font-size:.68rem">Inactive with current hardware</span>' : ''}</td>
      <td class="val-was">${_escHtml(c.was)}</td>
      <td class="val-now">${_escHtml(c.now)}</td>
    </tr>`
  ).join('');
  body.innerHTML =
    `<table class="save-recap-table">
      <thead><tr><th>Setting</th><th>Was</th><th>Now</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  modal.style.display = 'flex';
}

function _cancelSaveRecap() {
  document.getElementById('save-recap-modal').style.display = 'none';
  const cb = document.getElementById('save-recap-confirm-btn');
  if (cb) cb.disabled = false;
}

async function _saveUnifiedControllerChanges(payload, saveMsg, confirmButton) {
  const merge = (target, patch) => {
    for (const [key, value] of Object.entries(patch || {})) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
        merge(target[key], value);
      } else target[key] = value;
    }
  };
  if (typeof stopGlobalTelemetry === 'function') stopGlobalTelemetry();
  await new Promise(resolve => setTimeout(resolve, 200));
  const latestResponse = await fetch('/api/ecu_config', {cache:'no-store'});
  if (!latestResponse.ok) throw new Error('could not refresh the current engine file');
  const engine = await latestResponse.json();
  if (!engine.hardware || !engine.settings) throw new Error('current engine file is incomplete');
  merge(engine.settings, payload);
  let hardwareChanged = false;
  if (CONFIG_SURFACE === 'controllers') {
    const nextControllers = JSON.parse(JSON.stringify(hwCfg.controllers || {}));
    const nextSafety = JSON.parse(JSON.stringify(hwCfg.safety || {}));
    const nextOilLoops = JSON.parse(JSON.stringify(hwCfg.oil_loops || []));
    hardwareChanged = JSON.stringify(engine.hardware.controllers || {}) !== JSON.stringify(nextControllers) ||
      JSON.stringify(engine.hardware.safety || {}) !== JSON.stringify(nextSafety) ||
      JSON.stringify(engine.hardware.oil_loops || []) !== JSON.stringify(nextOilLoops);
    engine.hardware.controllers = nextControllers;
    engine.hardware.safety = nextSafety;
    engine.hardware.oil_loops = nextOilLoops;
  } else if (CONFIG_SURFACE === 'system') {
    for (const key of ['profile_id','profile_desc','wifi_password','wifi_tx_power_dbm','cluster_serial','mavlink']) {
      if (hwCfg[key] !== undefined) engine.hardware[key] = JSON.parse(JSON.stringify(hwCfg[key]));
    }
    engine.settings.profile_id = engine.hardware.profile_id;
  }
  // Dependency normalization can mark the hardware side dirty even when its
  // resulting controller/safety assignments are byte-for-byte unchanged.
  // Keep that ordinary settings save on the smaller settings-only transaction;
  // a full engine restore needlessly consumes Classic's filesystem/parser
  // resources and revalidates unchanged hardware.
  const settingsOnly = CONFIG_SURFACE === 'controllers' && !hardwareChanged;
  const response = await fetch(settingsOnly ? '/api/config' : '/api/ecu_config?source=controllers', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify(settingsOnly ? engine.settings : engine)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.detail || result.error || `HTTP ${response.status}`);
  _clearDirty();
  saveMsg.textContent = '✓ Saved — ECU rebooting…';
  saveMsg.style.color = 'var(--green)';
  if (confirmButton) confirmButton.disabled = true;
  setTimeout(() => { location.href = CONFIG_SURFACE === 'system' ? '/system.html' : '/controllers.html'; }, 12000);
}

// Stage 2: user confirmed — actually send to device.
function _doSave() {
  const cb = document.getElementById('save-recap-confirm-btn');
  if (cb) cb.disabled = true;
  document.getElementById('save-recap-modal').style.display = 'none';
  const saveMsg = document.getElementById('save-msg');
  saveMsg.textContent = 'Saving…';
  saveMsg.style.color = '';
  // PATCH exactly the fields shown in the recap. Sending the complete Settings
  // tree made a one-field edit a ~9 KiB upload, increased Classic ESP32 TCP/RAM
  // pressure, and could overwrite a newer edit made from another browser.
  const payload = {};
  const changedKeys = new Set(_buildChanges().map(change => change.key));
  const runningLive = runtimeMode === 'RUNNING' && runtimeDevMode;
  SCHEMA.forEach(section => section.fields.forEach(field => {
    if (!changedKeys.has(field.key)) return;
    if (runningLive && !LIVE_CONFIG_KEYS.has(field.key)) return;
    const value = field.path.reduce((obj, key) => obj?.[key], cfg);
    if (value !== undefined) setPath(payload, field.path, value);
    if (field.type === 'pullback_mode') {
      const modeValue = field.modePath.reduce((obj, key) => obj?.[key], cfg);
      if (modeValue !== undefined) setPath(payload, field.modePath, modeValue);
    }
  }));
  if (_controllerRulesDirty) {
    payload.rules = JSON.parse(JSON.stringify(cfg.rules || []));
    payload.controller_schema = Number(cfg.controller_schema || 1);
  }
  if (_controllerHardwareDirty) {
    _saveUnifiedControllerChanges(payload, saveMsg, cb).catch(error => {
      saveMsg.textContent = '✗ ' + (error?.message || error);
      saveMsg.style.color = '#f55';
      if (cb) cb.disabled = false;
      if (typeof startTelemetryBoot === 'function') startTelemetryBoot();
    });
    return;
  }
  // A Classic ESP32 can be close to its largest-contiguous-block limit while
  // the live WebSocket owns queued frames. Pause it briefly for the durable
  // filesystem transaction, then resume normal telemetry automatically.
  const pauseTelemetry = typeof stopGlobalTelemetry === 'function';
  const sendSave = async () => {
    if (typeof window.OTSaveConfigPatch !== 'function')
      throw new Error('Shared save support did not load; reload this page and retry');
    const { response, data } = await window.OTSaveConfigPatch(payload);
    if (response?.ok && data?.ok !== false) return data;
    throw new Error(data?.error || data?.reason || ('HTTP ' + (response?.status || 0)));
  };
  const finishSave = () => sendSave().then(async d => {
    if (d.ok) {
      if (window.OTSetup) OTSetup.mark('config');
      // Firmware returns success after validation and queueing. Ordinary saves
      // are already durable; Developer-Mode live tuning is deliberately kept
      // out of flash until the engine reaches a safe mode.
      // A full immediate /api/config reread is both unnecessary (PATCH contains
      // no stale sibling fields) and unreliable on Classic while the prior
      // large response finishes releasing its bounded shared-buffer lease.
      renderForm();
      _applyAllVisibility();
      _clearDirty();
      applyView();
      hookValidation();
      applyDeveloperLiveFields();
      runValidation();
      saveMsg.textContent = (d.warn ? 'Saved — ' + d.warn :
        (d.persist === 'deferred_until_safe'
          ? '✓ Live update queued — saves permanently after STOP'
          : (d.live_now ? '✓ Applied live — ' : '✓ Saved — ') + new Date().toLocaleTimeString()));
      saveMsg.style.color = d.warn ? 'var(--yellow)' : 'var(--green)';
      if (cb) cb.disabled = false;
    } else {
      saveMsg.textContent = '✗ ' + JSON.stringify(d);
      saveMsg.style.color = '#f55';
      if (cb) cb.disabled = false;
    }
  }).catch(e => {
    saveMsg.textContent = '✗ ' + e;
    saveMsg.style.color = '#f55';
    if (cb) cb.disabled = false;
  }).finally(() => {
    if (pauseTelemetry && typeof startTelemetryBoot === 'function') startTelemetryBoot();
  });
  // Closing the WebSocket is asynchronous; give AsyncTCP one scheduling slice
  // to release its frame/connection storage before opening LittleFS.
  if (pauseTelemetry) {
    const idle = typeof window.OTWaitForTelemetryIdle === 'function'
      ? window.OTWaitForTelemetryIdle(1600) : Promise.resolve(true);
    idle.finally(async () => {
      stopGlobalTelemetry();
      // WebSocket messages are copied into heap-backed send buffers. Their
      // ACK/destructors can trail close() briefly on Classic. Wait until the
      // ECU reports a useful contiguous block instead of racing LittleFS and
      // returning a low-memory save error. This normally completes in well
      // under a second and is bounded so a status fault cannot hang Save.
      for (let attempt = 0; attempt < 16; attempt++) {
        try {
          const status = await fetch('/api/status', { cache:'no-store' }).then(r => r.ok ? r.json() : null);
          if (status && Number(status.max_alloc_heap) >= 12000 && Number(status.ws_clients || 0) === 0) break;
        } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      finishSave();
    });
  } else finishSave();
}
