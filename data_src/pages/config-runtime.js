// ── Dev Mode toggle ───────────────────────────────────────────
// ── Live sensor badge helpers ─────────────────────────────────
// Map from field key → function that returns badge text from telemetry data
function liveSensorFitted(d, telemetryKey, sensorKey, hwFlatKey) {
  if (d && d[telemetryKey] !== undefined) return !!d[telemetryKey];
  const hw = hwCfg || {};
  const sensors = hw.sensors || {};
  return !!(sensors[sensorKey]?.enabled || hw[hwFlatKey] || hw[telemetryKey]);
}
const LIVE_BADGE_KEYS = {
  'rpm_limit': d => liveSensorFitted(d, 'has_n1', 'n1_rpm', 'has_n1_rpm') && d.n1 !== undefined
    ? 'live: ' + fmtInt(d.n1) + ' RPM' : null,
  'n2_rpm_limit': d => liveSensorFitted(d, 'has_n2', 'n2_rpm', 'has_n2_rpm') && d.n2 !== undefined
    ? 'live: ' + fmtInt(d.n2) + ' RPM' : null,
  'tot_limit': d => liveSensorFitted(d, 'has_tot', 'tot', 'has_tot') && d.tot !== undefined
    ? 'live: ' + toDispTemp(Number(d.tot)).toFixed(1) + '\u00a0' + dispTempUnit() : null,
  'sf_tit': d => liveSensorFitted(d, 'has_tit', 'tit', 'has_tit') && d.tit !== undefined
    ? 'live: ' + toDispTemp(Number(d.tit)).toFixed(1) + '\u00a0' + dispTempUnit() : null,
  'oil_rm': d => liveSensorFitted(d, 'has_oil_press', 'oil_press', 'has_oil_press') && d.oil !== undefined
    ? 'live: ' + toDispPress(Number(d.oil)).toFixed(2) + '\u00a0' + dispPressUnit() : null,
  'oil_mm': d => liveSensorFitted(d, 'has_oil_press', 'oil_press', 'has_oil_press') && d.oil !== undefined
    ? 'live: ' + toDispPress(Number(d.oil)).toFixed(2) + '\u00a0' + dispPressUnit() : null,
};

function injectLiveBadges() {
  Object.keys(LIVE_BADGE_KEYS).forEach(key => {
    const inp = document.getElementById('cf-' + key);
    if (!inp) return;
    const field = inp.closest('.cfg-field');
    if (!field) return;
    const labelEl = field.querySelector('.cfg-label');
    if (!labelEl || labelEl.querySelector('.live-val')) return; // already injected
    const span = document.createElement('span');
    span.className = 'live-val';
    span.id = 'live-' + key;
    span.textContent = '';
    labelEl.appendChild(span);
  });
}

function updateLiveBadges(d) {
  Object.entries(LIVE_BADGE_KEYS).forEach(([key, fn]) => {
    const el = document.getElementById('live-' + key);
    if (!el) return;
    const text = fn(d);
    el.textContent = text || '';
  });
}

// ── WS integration — track locked state ──────────────────────
const _base = window.applyData;
window.applyData = function(d) {
  const merged = _base(d);
  if (!merged) return;
  d = merged;
  updateLiveBadges(d);
  const locked = !!d.config_locked;
  if (locked !== isLocked && cfg.profile_id) {
    isLocked = locked;
    renderForm();
    _applyAllVisibility();
    _clearDirty();
    applyView();
    hookValidation();
    runValidation();
  }

  // RC PWM active flag from compile-time telemetry
  if (d.rc_pwm_active !== undefined && d.rc_pwm_active !== rcPwmActive) {
    rcPwmActive = !!d.rc_pwm_active;
    applyRcPwmVisibility();
  }

  // Governor / glow / safety-ext / starter-assist flags from hardware telemetry
  let extChanged = false;
  if (d.has_governor !== undefined && !!d.has_governor !== _hasGovernorCfg) {
    _hasGovernorCfg = !!d.has_governor; extChanged = true;
  }
  if (d.has_glow_plug !== undefined && !!d.has_glow_plug !== _hasGlowCfg) {
    _hasGlowCfg = !!d.has_glow_plug; extChanged = true;
  }
  if (d.has_pulsed_starter_assist !== undefined && !!d.has_pulsed_starter_assist !== _hasStarterSupportCfg) {
    _hasStarterSupportCfg = !!d.has_pulsed_starter_assist; extChanged = true;
  }
  const hasSafetyExt = !!(d.has_oil_temp || d.has_batt_voltage || d.has_fuel_press || d.has_tit || d.has_governor || d.has_n1);
  if (hasSafetyExt !== _hasSafetyExtCfg) {
    _hasSafetyExtCfg = hasSafetyExt; extChanged = true;
  }
  // Show/hide TIT limit field based on whether TIT sensor is fitted
  if (d.has_tit !== undefined) {
    const titField = document.getElementById('field-sf-tit');
    if (titField) setCfgFieldVisibleByElement(titField, !!d.has_tit);
  }
  if (extChanged) { applyExtSectionVisibility(); applyHwConditions(); }

  // Lock badge
  const badge = document.getElementById('cfg-lock-badge');
  if (badge) {
    if (locked) {
      badge.textContent  = 'Locked';
      badge.style.color  = 'var(--red)';
    } else if (d.dev_mode && d.mode && d.mode !== 'STANDBY') {
      badge.textContent  = 'Open (Dev Mode)';
      badge.style.color  = 'var(--yellow)';
    } else {
      badge.textContent  = 'Open';
      badge.style.color  = 'var(--green)';
    }
  }

  // Dev Mode button label
};

// ── Oil throttle-map — show map-max only when enabled ────────
function applyOilMapVisibility() {
  const tmCb   = document.getElementById('cf-oil_tm');
  const mxWrap = document.getElementById('field-oil_mx');
  if (!tmCb || !mxWrap) return;
  const mxEl = document.getElementById('cf-oil_mx');
  function sync() {
    const hwAvailable = !_fieldIsHardwareInactive(tmCb.closest('.cfg-field'));
    const enabled = hwAvailable && !!tmCb.checked && !isLocked;
    mxWrap.style.display = '';
    mxWrap.dataset.logicalDisabled = tmCb.checked ? '0' : '1';
    mxWrap.title = !hwAvailable
      ? 'Oil pressure sensor is not configured in Hardware. Enable an oil pressure sensor to unlock Map Max.'
      : tmCb.checked
      ? 'Oil map maximum pressure at full throttle.'
      : 'Disabled because Throttle-Map Pressure is off. Turn Throttle-Map Pressure on to unlock Map Max.';
    if (mxEl) mxEl.disabled = !enabled;
    _refreshDependencyEditability();
  }
  tmCb.addEventListener('change', sync);
  sync();
}

// ── AB ignition method — conditional field visibility ─────────
function applyAbIgnitionParamVisibility() {
  const utEl = document.getElementById('cf-ab_ut');
  const fmEl = document.getElementById('cf-ab_fm');
  const useTorch  = utEl ? utEl.checked : false;
  const flameMode = fmEl ? parseInt(fmEl.value) : 2;
  function showF(key, show) {
    setCfgFieldHardHidden(key, !show);
    setCfgFieldVisible(key, show);
  }
  showF('ab_tpct', useTorch);
  showF('ab_tms',  useTorch);
  showF('ab_ttl',  useTorch);
  showF('ab_tr',   flameMode === 1);
  showF('ab_tw',   flameMode === 1);
  showF('ab_ams',  flameMode === 2);
  showF('ab_fld',  flameMode === 0);
  applyView();
}

function _cfgShowField(key, show) {
  setCfgFieldHardHidden(key, !show);
  setCfgFieldVisible(key, show);
}

function applyFlameoutRelightVisibility() {
  const flSrc = parseInt(document.getElementById('cf-sf_fs')?.value || '0', 10);
  const rlSrc = parseInt(document.getElementById('cf-rl_cs')?.value || '0', 10);
  const hasFlame = hasRegistryInput('flame');
  const hasN1 = hasRegistryInput('n1_speed');
  const hasTot = hasRegistryInput('tot');
  const hasTit = hasRegistryInput('tit');
  const hasEgt = hasTot || hasTit;
  const autoFlameSrc = hasFlame ? 1 : (hasN1 ? 2 : (hasEgt ? 3 : 0));
  const effFl = flSrc || autoFlameSrc;
  const effRl = rlSrc || effFl;
  _cfgShowField('sf_fn', effFl === 2);
  _cfgShowField('sf_eb', effFl === 3);
  _cfgShowField('sf_ef', effFl === 3);
  _cfgShowField('rl_cr', effRl === 2);
  _cfgShowField('rl_tr', effRl === 3);
  applyView();
}

// ── RC PWM section — show only when RC PWM is active ─────────
let rcPwmActive = false;
function applyRcPwmVisibility() {
  const sec = document.getElementById('rc-pwm-section');
  if (sec) {
    sec.dataset.forceHidden = rcPwmActive ? '0' : '1';
    sec.style.display = '';
  }
}

// ── AB sections — show only when hasAfterburner ───────────────
let hasAfterburnerCfg = false;
function applyAbCfgVisibility() {
  const ids = ['ab-cfg-section','ab-ign-section','ab-flame-section','ab-run-section'];
  ids.forEach(id => {
    const sec = document.getElementById(id);
    if (sec) {
      sec.dataset.forceHidden = hasAfterburnerCfg ? '0' : '1';
      sec.style.display = '';
    }
  });
}

// ── Safety-ext / Governor / Glow / StarterAssist sections — show when hardware fitted ──
let _hasGovernorCfg = false, _hasGlowCfg = false, _hasSafetyExtCfg = false, _hasStarterSupportCfg = false;
function refreshFeatureCachesFromHardware() {
  const a = hwCfg.actuators || {};
  hasAfterburnerCfg = hasActualAfterburnerHardware();
  _hasGovernorCfg = !!hwCfg.controllers?.governor;
  _hasGlowCfg = hasRegistryOutput('glow_plug');
  const starterDriver = Number(registryOutputByPurpose('starter')?.driver);
  _hasStarterSupportCfg = !!(hasRegistryOutput('starter') && starterDriver !== 4 && hasRegistryInput('n1_speed'));
  // AB servo-PWM input uses the same shared RC failsafe timeout, so an
  // AB-only RC setup must still see the RC Input section.
  const abRcPwm = !!(hasAfterburnerCfg && hwCfg.ab_trigger?.input_rc_pwm &&
                     (hwCfg.ab_trigger?.input_pin ?? -1) >= 0);
  rcPwmActive = !!(Number(registryInputByPurpose('throttle')?.driver) === 3 ||
                   Number(registryInputByPurpose('idle')?.driver) === 3 || abRcPwm);
  _hasSafetyExtCfg = !!(
    hasRegistryInput('tit') || hasRegistryInput('oil_temperature') ||
    hasRegistryInput('fuel_pressure') || hasRegistryInput('battery_voltage') ||
    hasRegistryInput('n1_speed')
  );
}
function applyExtSectionVisibility() {
  const safetyExts = ['sf_tit','sf_ot','sf_fp','sf_bv','sf_sg'];
  const anyExt = _hasSafetyExtCfg;
  const safetyExtSec = document.getElementById('safety-ext-section');
  if (safetyExtSec) { safetyExtSec.dataset.forceHidden = anyExt ? '0' : '1'; safetyExtSec.style.display = ''; }

  const govSec = document.getElementById('governor-cfg-section');
  if (govSec) { govSec.dataset.forceHidden = _hasGovernorCfg ? '0' : '1'; govSec.style.display = ''; }

  const glowSec = document.getElementById('glow-cfg-section');
  if (glowSec) { glowSec.dataset.forceHidden = _hasGlowCfg ? '0' : '1'; glowSec.style.display = ''; }

  const supportSec = document.getElementById('starter-support-section');
  if (supportSec) { supportSec.dataset.forceHidden = _hasStarterSupportCfg ? '0' : '1'; supportSec.style.display = ''; }
}

// ── Hardware-conditional visibility ──────────────────────
// Loaded from /api/hardware at boot — hides sections/fields that don't apply
// to the fitted hardware without requiring the user to manage them.
let hwCfg = {};

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
function registryInputByPurpose(...purposes) {
  const wanted = new Set(purposes.map(String));
  return (hwCfg.channel_registry?.inputs || []).find(channel =>
    registryChannelInstalled(channel) && wanted.has(String(channel.purpose || channel.id || '')));
}
function registryOutputByPurpose(...purposes) {
  const wanted = new Set(purposes.map(String));
  return (hwCfg.channel_registry?.outputs || []).find(channel =>
    registryChannelInstalled(channel) && wanted.has(String(channel.purpose || channel.id || '')));
}
function hasRegistryInput(...purposes) { return !!registryInputByPurpose(...purposes); }
function hasRegistryOutput(...purposes) { return !!registryOutputByPurpose(...purposes); }
function hasActualAfterburnerHardware(hw = hwCfg) {
  return hasRegistryOutput('ab_igniter', 'ab_pump', 'ab_valve');
}

function applyHwConditions() {
  const a  = hwCfg.actuators  || {};
  const hasOilPress    = hasRegistryInput('oil_pressure');
  const hasN1          = hasRegistryInput('n1_speed');
  const hasN2          = hasRegistryInput('n2_speed');
  const hasOilTemp     = hasRegistryInput('oil_temperature');
  const hasFuelPress   = hasRegistryInput('fuel_pressure');
  const hasBattVolt    = hasRegistryInput('battery_voltage');
  const hasFlame       = hasRegistryInput('flame');
  const hasTot         = hasRegistryInput('tot');
  const hasTit         = hasRegistryInput('tit');
  const hasP1          = hasRegistryInput('p1_pressure');
  const hasP2          = hasRegistryInput('p2_pressure');
  const hasTorque      = hasRegistryInput('torque');
  const hasAB          = hasActualAfterburnerHardware();
  const hasAbFlame     = !!(hasAB && hasRegistryInput('ab_flame'));
  const abTriggerSource = Number(hwCfg.ab_trigger?.source ?? hwCfg.abTriggerSource ?? 0);
  const hasAbInput     = !!(hasAB && abTriggerSource === 3 && (hwCfg.ab_trigger?.input_pin ?? -1) >= 0);
  const hasIgniter     = hasRegistryOutput('igniter');
  const hasIgniter2    = hasRegistryOutput('ab_igniter');
  const hasAbIgniter   = !!(hasAB && hasIgniter2);
  const hasThrottleOut = hasRegistryOutput('main_fuel');
  const hasThrottleInput = hasRegistryInput('throttle');
  const hasOilPump     = hasRegistryOutput('oil_pump');
  const oilPumpChannel = registryOutputByPurpose('oil_pump');
  const hasOilPumpCurrent = !!(a.oil_pump?.has_current || oilPumpChannel?.has_current);
  const hasStarter     = hasRegistryOutput('starter');
  const hasFuelSol     = hasRegistryOutput('fuel_shutoff');
  const hasPropPitch   = hasRegistryOutput('prop_pitch');
  const hasGlowPlug    = hasRegistryOutput('glow_plug');
  const hasFuelPump2   = hasRegistryOutput('fuel_pump');
  const hasCoolFan     = hasRegistryOutput('cooling_fan');
  const hasAirstarter  = hasRegistryOutput('air_starter');
  const hasOilScavenge = hasRegistryOutput('scavenge_pump');
  const oilScavengeChannel = registryOutputByPurpose('scavenge_pump');
  const hasMonitoredOilFlow = !!(
    (oilPumpChannel?.has_flow_monitor && hasRegistryInput('oil_flow')) ||
    (oilScavengeChannel?.has_flow_monitor && hasRegistryInput('scavenge_flow'))
  );
  const hasBleedValve  = hasRegistryOutput('bleed_valve');
  const hasStarterEn   = hasRegistryOutput('starter_enable');
  const hasAbSol       = !!(hasAB && hasRegistryOutput('ab_valve'));
  const hasAbPump      = !!(hasAB && hasRegistryOutput('ab_pump'));
  const hasAbFuelHardware = hasAbSol || hasAbPump;
  const hasClusterSerial = !!hwCfg.cluster_serial?.enabled;
  const hasDynamicIdle = !!(hwCfg.controllers?.dynamic_idle &&
    hasThrottleOut && (hasN1 || hasN2 || hasP1 || hasP2));
  const hasGovernorRequested = !!hwCfg.controllers?.governor;
  const registryPropPitch = registryOutputByPurpose('prop_pitch');
  const hasProportionalPropPitch = hasPropPitch && Number(registryPropPitch?.driver) !== 4;
  const hasGovernorControl = hasThrottleOut || hasProportionalPropPitch;
  const hasGovernor = hasGovernorRequested && hasN2 && hasGovernorControl;
  const actuatorPurposes = {
    throttle: 'main_fuel', starter: 'starter', oil_pump: 'oil_pump', fuel_sol: 'fuel_shutoff',
    prop_pitch: 'prop_pitch', glow_plug: 'glow_plug', fuel_pump2: 'fuel_pump', cool_fan: 'cooling_fan',
    airstarter_sol: 'air_starter', oil_scavenge_pump: 'scavenge_pump', bleed_valve: 'bleed_valve',
    starter_en: 'starter_enable', ab_sol: 'ab_valve', ab_pump: 'ab_pump'
  };
  const actuatorType = key => {
    const driver = Number(registryOutputByPurpose(actuatorPurposes[key] || key)?.driver);
    return driver === 4 ? 2 : (driver === 5 ? 1 : (driver === 6 ? 0 : NaN));
  };
  const isOnOffType = key => Number(actuatorType(key)) === 2;

  function showField(key, show) {
    setCfgFieldVisible(key, show);
  }

  function ghostField(key, available, reason) {
    const el = document.getElementById('cf-' + key);
    const wrap = el?.closest('.cfg-field');
    if (!el || !wrap) return;
    if (!wrap.dataset.baseTitle) {
      const label = wrap.querySelector('.cfg-label')?.textContent?.trim() || '';
      const desc = wrap.querySelector('.cfg-desc')?.textContent?.trim() || '';
      wrap.dataset.baseTitle = desc ? (label ? label + ': ' + desc : desc) : '';
    }
    wrap.dataset.hardwareUnavailable = available ? '0' : '1';
    wrap.dataset.inactiveReason = available ? '' : reason;
    if (!available) {
      wrap.title = reason;
    } else if (el.type === 'checkbox' && !el.checked) {
      const unlockHints = {
        oil_tm: 'Turn this on to unlock Map Max and make oil pressure target rise with throttle.',
        rl_en: 'Turn this on to allow automatic relight settings to affect running flameout recovery.',
        ab_ut: 'Turn this on to unlock torch fuel-spike duration and EGT cut settings.',
        ab_ui: 'Turn this on to fire the dedicated afterburner igniter during AB ignition.'
      };
      wrap.title = unlockHints[key] || wrap.dataset.baseTitle || '';
    } else {
      wrap.title = wrap.dataset.baseTitle || '';
    }
  }

  function ghostSectionByTitle(title, available, reason) {
    const sec = Array.from(document.querySelectorAll('.cfg-section'))
      .find(s => s.dataset.section === title);
    if (!sec) return;
    sec.dataset.hardwareUnavailable = available ? '0' : '1';
    sec.dataset.inactiveReason = available ? '' : reason;
    sec.title = available ? '' : reason;
  }

  function ghostSelectOption(key, value, available, reason) {
    const el = document.getElementById('cf-' + key);
    const opt = el?.querySelector(`option[value="${value}"]`);
    if (!opt) return;
    if (!opt.dataset.baseLabel) opt.dataset.baseLabel = opt.textContent;
    opt.dataset.hardwareUnavailable = available ? '0' : '1';
    opt.dataset.inactiveReason = available ? '' : reason;
    if (el && !available && String(el.value) === String(value)) {
      const wrap = el.closest('.cfg-field');
      if (wrap) wrap.title = reason;
    }
  }

  // ── Oil system: hide pressure-control fields when no sensor ──────────────
  // Without a sensor the closed-loop controller does not run; direct pump
  // output during startup and shutdown is configured on the Sequence page.
  const oilPressFields = ['oil_rm','oil_zb','oil_tm','oil_mm','oil_mx','oil_as','oil_mp','oa_db','oil_fd','oil_fp'];
  oilPressFields.forEach(k =>
    ghostField(k, hasOilPress, 'Oil pressure sensor is not configured in Hardware. Enable an oil pressure sensor to unlock closed-loop oil pressure settings.'));
  ghostField('oil_ocd', hasOilPump && hasOilPumpCurrent,
    !hasOilPump
      ? 'Oil pump output is not configured in Hardware.'
      : 'Oil-pump current sensing is not enabled in Hardware. This shutdown delay has no current signal to monitor.');
  ghostField('oil_ufd', hasMonitoredOilFlow,
    'No pump has flow monitoring enabled with its matching flow-meter input in Hardware.');
  ghostField('oil_ufs', hasMonitoredOilFlow,
    'Configure and enable a pump flow monitor in Hardware before allowing low flow to request shutdown.');
  const oilMpEl  = document.getElementById('cf-oil_mp');
  const oilMmEl  = document.getElementById('cf-oil_mm');
  if (oilMpEl) {
    const label = oilMpEl.closest('.cfg-field')?.querySelector('.cfg-label');
    if (label) label.textContent = 'Controller Minimum Duty %';
  }
  // Oil Target remains unavailable without pressure feedback; Advanced may
  // display it ghosted as reference, but it must never become editable.

  // Show/hide a no-sensor note inside the Oil System section
  let oilNote = document.getElementById('hw-oil-no-sensor-note');
  if (!hasOilPress) {
    if (!oilNote) {
      oilNote = document.createElement('div');
      oilNote.id = 'hw-oil-no-sensor-note';
      oilNote.style.cssText = 'font-size:.72rem;color:var(--yellow);background:rgba(255,196,0,.07);border:1px solid rgba(255,196,0,.3);border-radius:5px;padding:.35rem .65rem;margin:.15rem 0 .45rem;line-height:1.5;grid-column:1/-1';
      oilNote.textContent = 'No oil pressure sensor — closed-loop running-pressure settings are inactive. Set startup oil-pump duty in Sequence > Build Oil Pressure.';
      // Insert after the Oil System title
      const oilGrid = oilMpEl?.closest('.cfg-grid');
      if (oilGrid) oilGrid.prepend(oilNote);
    }
    oilNote.style.display = '';
  } else if (oilNote) {
    oilNote.style.display = 'none';
  }

  // ── Windmilling oil protection from N1/N2, no oil-pressure sensor required ─────
  const hasStandbyOilSource = hasN1 || hasN2;
  const standbyOilAvailable = hasOilPump && hasStandbyOilSource;
  ghostSectionByTitle('Windmilling Oil Protection', standbyOilAvailable,
    !hasOilPump
      ? 'Oil pump output is not configured in Hardware. Enable an oil pump to unlock windmilling oil protection.'
      : 'No N1 or N2 RPM sensor is configured. Enable a shaft RPM sensor to unlock windmilling oil protection.');
  ghostField('so_src', standbyOilAvailable,
    'Windmilling oil protection needs an oil pump and at least one shaft RPM sensor.');
  ghostSelectOption('so_src', 0, hasN1,
    'N1 RPM sensor is not configured in Hardware.');
  ghostSelectOption('so_src', 1, hasN2,
    'N2 RPM sensor is not configured in Hardware.');
  ghostSelectOption('so_src', 2, hasStandbyOilSource,
    'No N1 or N2 RPM sensor is configured in Hardware.');
  ['so_rl','so_fp','so_fb'].forEach(k => ghostField(k, standbyOilAvailable,
    'Windmilling oil protection needs an oil pump and at least one shaft RPM sensor.'));

  // ── Core sensor-dependent limits stay visible but ghosted so users can see
  // which common protections need hardware before they matter.
  const egtSel = Number((document.getElementById('cf-eg_src') || {}).value || 0);
  const egtSrc = egtSel === 1 && hasTot ? 1 :
                 egtSel === 2 && hasTit ? 2 :
                 hasTot ? 1 :
                 hasTit ? 2 : 0;
  const hasEgt = egtSrc !== 0;
  const usesTotEgt = egtSrc === 1;
  const usesTitEgt = egtSrc === 2;
  ghostField('eg_src', hasTot || hasTit, 'Primary engine temperature safety requires a configured TOT or TIT sensor.');
  ghostSelectOption('eg_src', 1, hasTot, 'TOT sensor is not configured in Hardware.');
  ghostSelectOption('eg_src', 2, hasTit, 'TIT sensor is not configured in Hardware.');
  ghostField('tot_limit', usesTotEgt, usesTitEgt ? 'TIT is selected as primary EGT; TIT Limit is used instead.' : 'TOT sensor is not configured in Hardware.');
  ['tot_safe_margin','tot_cooldown_target'].forEach(k =>
    ghostField(k, hasEgt, 'Selected EGT safety requires a configured TOT or TIT sensor.'));
  ghostField('sf_hs', hasEgt, 'Hot-start protection requires a configured TOT or TIT sensor.');
  ghostField('sf_st', hasEgt, 'The startup EGT hard limit requires a configured TOT or TIT sensor.');
  ghostField('sf_ot', hasOilTemp, 'Oil temperature sensor is not configured in Hardware.');
  ghostField('sf_ot_d', hasOilTemp, 'Oil-temperature confirmation has no effect without an oil-temperature sensor.');
  ghostField('sf_fp', hasFuelPress, 'Fuel pressure sensor is not configured in Hardware.');
  ghostField('sf_fp_d', hasFuelPress, 'Fuel-pressure confirmation has no effect without a fuel-pressure sensor.');
  ghostField('sf_bv', hasBattVolt, 'Battery voltage sensor is not configured in Hardware.');
  ghostField('sf_bv_d', hasBattVolt, 'Bus-voltage confirmation has no effect without a battery-voltage sensor.');
  ghostField('sf_tit', usesTitEgt, !hasTit ? 'TIT sensor is not configured in Hardware.' : 'TIT is not the selected primary engine temperature.');
  ghostField('sf_sg', hasN1, 'Surge detection requires an N1 RPM sensor.');
  ghostField('rh_jt', hasN1, 'RPM health checks require an N1 RPM sensor.');
  ghostField('rh_zs', hasN1, 'RPM health checks require an N1 RPM sensor.');
  // Fuel response shaping and gradual protection are automatic whenever the
  // main-fuel output exists; users configure the behavior here without a
  // second internal-controller enable.
  ghostField('th_ru', hasThrottleOut, 'Main fuel pump / metering output is not configured in Hardware.');
  ghostField('th_rd', hasThrottleOut, 'Main fuel pump / metering output is not configured in Hardware.');
  ghostField('th_mx', hasThrottleOut, 'Main fuel pump / metering output is not configured in Hardware.');
  ghostField('th_ex', hasThrottleOut && hasThrottleInput,
    !hasThrottleOut
      ? 'Main fuel pump / metering output is not configured in Hardware.'
      : 'Low-throttle sensitivity only applies to a physical throttle input configured in Hardware.');
  const hasN1Pb = hasRegistryInput('n1_speed');
  const hasEgtPb = hasRegistryInput('tot', 'tit');
  ['pb_n1e','pb_n1s','pb_n1h'].forEach(k =>
    ghostField(k, hasThrottleOut && hasN1Pb,
      !hasN1Pb ? 'N1 pullback requires an N1 RPM sensor in Hardware.' : 'Main fuel output is not configured in Hardware.'));
  ['pb_n2e','pb_n2s','pb_n2h'].forEach(k =>
    ghostField(k, hasThrottleOut && hasN2,
      !hasN2 ? 'N2 pullback requires an N2 RPM sensor in Hardware.' : 'Main fuel output is not configured in Hardware.'));
  ['pb_egte','pb_egts','pb_egth'].forEach(k =>
    ghostField(k, hasThrottleOut && hasEgtPb,
      !hasEgtPb ? 'EGT pullback requires a TOT or TIT sensor in Hardware.' : 'Main fuel output is not configured in Hardware.'));
  ['pb_p1e','pb_p1s','pb_p1h'].forEach(k =>
    ghostField(k, hasThrottleOut && hasP1,
      !hasP1 ? 'P1 pullback requires a P1 pressure sensor in Hardware.' : 'Main fuel output is not configured in Hardware.'));
  ['pb_p2e','pb_p2s','pb_p2h'].forEach(k =>
    ghostField(k, hasThrottleOut && hasP2,
      !hasP2 ? 'P2 pullback requires a P2 pressure sensor in Hardware.' : 'Main fuel output is not configured in Hardware.'));
  ['pb_tqe','pb_tqs','pb_tqh'].forEach(k =>
    ghostField(k, hasThrottleOut && hasTorque,
      !hasTorque ? 'Torque pullback requires a shaft-torque sensor in Hardware.' : 'Main fuel output is not configured in Hardware.'));
  const hasAnyPullbackSource = hasN1Pb || hasN2 || hasEgtPb || hasP1 || hasP2 || hasTorque;
  ['pb_min','pb_str'].forEach(k =>
    ghostField(k, hasThrottleOut && hasAnyPullbackSource,
      !hasAnyPullbackSource ? 'Pullback floor has no effect until an N1, N2, TOT, TIT, P1, P2, or torque sensor is configured in Hardware.' : 'Main fuel output is not configured in Hardware.'));
  ghostField('rl_mode', hasThrottleOut && (hasN1Pb || hasN2),
    !(hasN1Pb || hasN2) ? 'RPM limiter mode requires an N1 or N2 RPM sensor in Hardware.' : 'Main fuel output is not configured in Hardware.');
  ghostField('lm_mt', hasThrottleOut, 'Reduced-power mode requires a throttle/fuel output.');
  const hasAnyIgnitionOutput = hasIgniter || hasIgniter2 || hasGlowPlug;
  ghostField('ms_is', hasAnyIgnitionOutput, 'Igniter-on-START requires Igniter 1, AB / Pilot Igniter, or Glow/Wet Glow to be configured in Hardware.');
  ghostField('ms_it', hasAnyIgnitionOutput, 'START relight output requires Igniter 1, AB / Pilot Igniter, or Glow/Wet Glow to be configured in Hardware.');
  ghostSelectOption('ms_it', 0, hasIgniter, 'Igniter 1 is not configured in Hardware.');
  ghostSelectOption('ms_it', 1, hasIgniter2, 'AB / Pilot Igniter is not configured in Hardware.');
  ghostSelectOption('ms_it', 2, hasGlowPlug, 'Glow/Wet Glow is not configured in Hardware.');
  ghostField('tl_fp', hasFuelSol, 'Main Fuel Prime duration requires a main fuel shutoff output.');
  ghostField('tl_fs', hasFuelSol, 'Main Fuel Shutoff Pulse duration requires a main fuel shutoff output.');
  ghostField('tl_op', hasOilPump, 'Oil Prime duration requires an oil pump output.');
  ghostField('tl_ig', hasIgniter, 'Igniter 1 Test duration requires Igniter 1 to be configured in Hardware.');
  ghostField('tl_i2', hasIgniter2, 'AB / Pilot Igniter Test duration requires AB / Pilot Igniter to be configured in Hardware.');
  ghostField('tl_gl', hasGlowPlug, 'Glow Test duration requires a glow plug output.');
  ghostField('tl_gp', hasGlowPlug, 'Glow Test demand requires a glow plug output.');
  ghostField('tl_st', hasStarter, 'Starter Test duration requires a starter output.');
  ghostField('tl_sp', hasStarter && !isOnOffType('starter'), isOnOffType('starter')
    ? 'Starter is configured as relay/on-off. Starter Test % is ignored; use Starter Test ms to control pulse length.'
    : 'Starter Test demand requires a starter output.');
  ghostField('tl_it', hasThrottleOut, 'Idle Test duration requires a throttle/fuel output.');
  ghostField('tl_os', hasOilScavenge, 'Scavenge Test duration requires an oil scavenge pump output.');
  ghostField('tl_cf', hasCoolFan, 'Fan Test duration requires a cooling fan output.');
  ghostField('tl_as', hasAirstarter, 'Air Starter Valve Test duration requires an air starter valve output.');
  ghostField('tl_bv', hasBleedValve, 'Bleed Test duration requires a bleed valve output.');
  ghostField('tl_f2', hasFuelPump2, 'Pilot / Auxiliary Fuel Pump Test duration requires Pilot / Auxiliary Fuel Pump in Hardware.');
  ghostField('tl_f2p', hasFuelPump2 && !isOnOffType('fuel_pump2'), isOnOffType('fuel_pump2')
    ? 'Pilot / Auxiliary Fuel Pump is configured as relay/on-off. Test % is ignored; use test duration to control pulse length.'
    : 'Pilot / Auxiliary Fuel Pump Test demand requires Pilot / Auxiliary Fuel Pump in Hardware.');
  ghostField('tl_se', hasStarterEn, 'Starter Enable Test duration requires a starter enable output.');
  ghostField('tl_pp', hasPropPitch, 'Prop Pitch Test duration requires a prop-pitch actuator.');
  ghostField('tl_pq', hasPropPitch && !isOnOffType('prop_pitch'), isOnOffType('prop_pitch')
    ? 'Prop pitch is configured as relay/on-off. Prop Pitch Test % is ignored; use Prop Pitch Test ms to control pulse length.'
    : 'Prop Pitch Test demand requires a prop-pitch actuator.');
  ghostField('tl_abs', hasAbSol, 'The valve test requires an installed afterburner fuel shutoff valve.');
  ghostField('tl_abp', hasAbPump, 'The pump test requires an installed afterburner fuel pump.');
  ghostField('tl_abq', hasAbPump && !isOnOffType('ab_pump'), isOnOffType('ab_pump')
    ? 'The afterburner fuel pump is configured as relay/on-off. Pump Test % is ignored; use the test duration instead.'
    : 'Pump-test demand requires an installed afterburner fuel pump.');
  ['di_src','di_tr','di_tp','di_ru','di_rd','di_db','di_rl','di_pd','di_pl','di_mm','di_mx','di_ig','di_im','di_mode','di_de','di_dd','di_lk','di_sb','di_fr','di_tu','di_td','di_lr','di_la'].forEach(k =>
    ghostField(k, hasDynamicIdle, 'Automatic Idle must be enabled in Hardware > Controllers and needs a main fuel output plus N1, N2, P1, or P2 feedback.'));
  ghostSelectOption('di_src', 0, hasN1, 'N1 speed input is not configured in Hardware.');
  ghostSelectOption('di_src', 1, hasN2, 'N2 speed input is not configured in Hardware.');
  ghostSelectOption('di_src', 2, hasP1, 'P1 pressure input is not configured in Hardware.');
  ghostSelectOption('di_src', 3, hasP2, 'P2 pressure input is not configured in Hardware.');
  ghostSectionByTitle('Automatic Idle Control', hasDynamicIdle, 'Automatic idle control needs a throttle/fuel output and one installed N1, N2, P1 or P2 sensor.');

  const starterAssistAvailable = _hasStarterSupportCfg;
  ['sa_en','sa_pc','sa_er','sa_on','sa_off'].forEach(k => ghostField(k, starterAssistAvailable,
    !hasStarter ? 'Pulsed Starter Assist requires a configured starter output.' :
    !hasN1 ? 'Pulsed Starter Assist requires N1 speed feedback.' :
    'Pulsed Starter Assist supports proportional servo/PWM starters only; relay/on-off starters are intentionally excluded.'));
  ghostSectionByTitle('Pulsed Starter Assist', starterAssistAvailable,
    'Requires a proportional servo/PWM starter output and N1 speed feedback. Relay/on-off starters are not supported.');

  ghostSectionByTitle('Automatic N2 Speed Control', hasGovernor,
    !hasGovernorRequested
      ? 'Automatic N2 speed control is not enabled in Hardware > Controllers.'
      : !hasN2
      ? 'Automatic N2 speed control requires an N2 RPM sensor.'
      : 'Automatic N2 speed control requires a throttle/fuel output or proportional propeller-pitch actuator.');
  ['gv_tr','gv_bd','gv_kp'].forEach(k =>
    ghostField(k, hasGovernor, 'Automatic N2 speed control needs N2 RPM plus a throttle/fuel output or proportional propeller-pitch actuator.'));
  ['gv_pk','gv_pr'].forEach(k =>
    ghostField(k, hasGovernor && hasProportionalPropPitch, hasProportionalPropPitch
      ? 'Automatic N2 speed control needs N2 RPM plus a usable control output.'
      : 'Prop-pitch governor fields require a proportional prop-pitch actuator in Hardware.'));

  // ── N2 / two-shaft fields ────────────────────────────────────────────────
  // N2 may be planned before a second shaft sensor is installed. Keep its
  // cluster threshold available in Explore, but inactive until N2 exists.
  setCfgFieldHardHidden('cl_n2', false);
  showField('cl_n2', true);
  ghostField('cl_n2', hasN2, 'N2 RPM sensor is not configured in Hardware.');
  const clusterSec = Array.from(document.querySelectorAll('.cfg-section'))
    .find(sec => sec.dataset.section === 'Cluster');
  if (clusterSec) {
    clusterSec.dataset.forceHidden = hasClusterSerial ? '0' : '1';
    clusterSec.dataset.inactiveReason = hasClusterSerial ? '' : 'External cluster serial is not configured in Hardware.';
    clusterSec.style.display = '';
  }
  ['rpm_limit','min_rpm','cl_n1'].forEach(k =>
    ghostField(k, hasN1, 'N1 RPM sensor is not configured in Hardware. Standard timer/TOT setup does not use this value.'));
  ghostField('n2_rpm_limit', hasN2, 'N2 RPM sensor is not configured in Hardware. This hard power-turbine shutdown limit does not apply.');
  ghostField('sf_p1t', hasP1, 'P1 pressure sensor is not configured in Hardware. This hard shutdown limit does not apply.');
  ghostField('sf_p2t', hasP2, 'P2 pressure sensor is not configured in Hardware. This hard shutdown limit does not apply.');
  ghostField('sf_tqt', hasTorque, 'Shaft-torque sensor is not configured in Hardware. This hard shutdown limit does not apply.');
  ghostField('sf_pt_d', hasP1 || hasP2 || hasTorque, 'Pressure / torque confirmation has no fitted P1, P2, or torque input to protect.');
  ghostField('sf_lo_d', hasOilPress, 'Low-oil confirmation has no effect without an oil-pressure sensor.');
  ghostField('sf_oz_d', hasOilPress, 'Near-zero-oil confirmation has no effect without an oil-pressure sensor.');
  ['rpm_limit','n2_rpm_limit','tot_limit','sf_tit','sf_p1t','sf_p2t','sf_tqt'].forEach(keepUnavailableFieldVisible);
  ghostField('cl_tw', hasEgt, 'Cluster EGT warning needs a fitted TOT or TIT sensor.');
  ghostField('cl_ow', hasOilPress, 'Cluster oil warning needs a fitted oil pressure sensor.');

  ghostSelectOption('sf_fs', 1, hasFlame, 'Flame sensor is not configured in Hardware.');
  ghostSelectOption('sf_fs', 2, hasN1, 'N1 RPM sensor is not configured in Hardware.');
  ghostSelectOption('sf_fs', 3, hasEgt, 'No primary EGT source is configured in Hardware.');
  const hasFlameoutSource = hasFlame || hasN1 || hasEgt;
  ghostField('sf_fo', hasFlameoutSource, 'No flameout source is configured. Enable a flame sensor, N1 RPM sensor, or TOT/TIT EGT source in Hardware to unlock flameout monitoring.');
  ghostField('sf_fs', hasFlameoutSource, 'No flameout source is configured. Enable a flame sensor, N1 RPM sensor, or TOT/TIT EGT source in Hardware to unlock flameout monitoring.');
  ghostField('sf_fn', hasN1, 'N1 flameout threshold requires an N1 RPM sensor.');
  ghostField('sf_eb', hasEgt, 'The EGT flameout threshold requires a configured TOT or TIT sensor.');
  ghostField('sf_ef', hasEgt, 'The EGT flameout fall-rate condition requires a configured TOT or TIT sensor.');
  ghostSelectOption('rl_cs', 1, hasFlame, 'Flame sensor is not configured in Hardware.');
  ghostSelectOption('rl_cs', 2, hasN1, 'N1 RPM sensor is not configured in Hardware.');
  ghostSelectOption('rl_cs', 3, hasEgt, 'No primary EGT source is configured in Hardware.');
  ghostSelectOption('rl_it', 0, hasIgniter, 'Igniter 1 is not configured in Hardware.');
  ghostSelectOption('rl_it', 1, hasIgniter2, 'AB / Pilot Igniter is not configured in Hardware.');
  ghostSelectOption('rl_it', 2, hasGlowPlug, 'Glow/Wet Glow is not configured in Hardware.');
  const relightTarget = Number((document.getElementById('cf-rl_it') || {}).value || 0);
  const hasRelightIgnition = relightTarget === 1 ? hasIgniter2 : relightTarget === 2 ? hasGlowPlug : hasIgniter;
  const hasAutoRelightHardware = hasN1 && hasRelightIgnition;
  ghostField('rl_it', hasN1 && hasAnyIgnitionOutput,
    !hasN1
      ? 'Auto-relight requires N1 RPM feedback so the ECU can prove the engine is still windmilling.'
      : 'Auto-relight requires Igniter 1, AB / Pilot Igniter, or Glow/Wet Glow to be configured in Hardware.');
  ['rl_en','rl_mr','rl_cs','rl_cr','rl_tr','rl_to'].forEach(k =>
    ghostField(k, hasAutoRelightHardware,
      !hasN1
        ? 'Auto-relight requires N1 RPM feedback so the ECU can prove the engine is still windmilling.'
        : 'Auto-relight requires the selected ignition output to be configured in Hardware.'));
  ghostField('rl_tr', hasAutoRelightHardware && hasEgt, 'EGT relight recovery requires N1, the selected ignition output, and a configured TOT or TIT sensor.');

  ghostSelectOption('ab_fm', 0, hasAbFlame, 'AB flame sensor is not configured in Hardware.');
  ghostSelectOption('ab_fm', 1, hasEgt, 'No primary EGT source is configured in Hardware.');
  ghostSelectOption('ab_pcm', 2, hasAbInput, 'Dedicated AB input is not configured in Hardware.');
  ['ab_mn','ab_mx'].forEach(k =>
    ghostField(k, hasN1, 'Afterburner N1 entry limits require an N1 RPM sensor.'));
  ghostField('ab_tt', hasThrottleOut && abTriggerSource === 1,
    abTriggerSource === 1
      ? 'Afterburner throttle trigger requires a fitted throttle/fuel output.'
      : 'Afterburner trigger source is not Throttle; change it in Hardware under Afterburner trigger and arm.');
  ghostField('ab_ui', hasAbIgniter, 'AB igniter output is not configured in Hardware.');
  ghostField('ab_ut', hasThrottleOut, 'Main throttle/fuel output is not configured in Hardware.');
  ghostField('ab_mt', hasEgt, 'No primary EGT source is configured in Hardware.');
  ghostField('ab_tpct', hasThrottleOut, 'Torch fuel spike requires a main throttle/fuel output.');
  ghostField('ab_tms', hasThrottleOut, 'Torch duration requires a main throttle/fuel output.');
  ghostField('ab_ttl', hasEgt && hasThrottleOut, 'Torch EGT protection needs a primary EGT source and a main fuel output.');
  ghostField('ab_tr', hasEgt, 'AB EGT-rise confirmation requires a configured TOT or TIT sensor.');
  ghostField('ab_tw', hasEgt, 'AB EGT-rise confirmation requires a configured TOT or TIT sensor.');
  ghostField('ab_smt', hasEgt, 'No primary EGT source is configured in Hardware.');
  ghostField('ab_fld', hasAbFlame, 'Running flame-loss shutdown requires a dedicated AB flame sensor.');
  ghostField('ab_lpp', hasAbPump, 'Light-up pump demand requires afterburner hardware and an AB pump output.');
  ['ab_pcm','ab_pmn','ab_pmx','ab_mo','ab_sms'].forEach(k =>
    ghostField(k, hasAbPump, 'AB fuel pump output is not configured in Hardware.'));
  // A lone igniter or flame sensor is not an operable afterburner. Apply this
  // last so individual dependency checks cannot accidentally unlock a field.
  ['Afterburner — Ignition Conditions','Afterburner — Ignition Method',
   'Afterburner — Flame Confirmation','Afterburner — Running'].forEach(title =>
    ghostSectionByTitle(title, hasAbFuelHardware,
      'Configure an afterburner fuel pump or fuel valve in Hardware before tuning afterburner operation.'));

  _refreshDependencyEditability();
}

// ── Re-render form when user switches units ───────────────────

// ── Shared re-render helper ──────────────────────────────
function _applyAllVisibility() {
  refreshFeatureCachesFromHardware();
  applyRcPwmVisibility();
  applyAbCfgVisibility();
  applyAbIgnitionParamVisibility();
  applyFlameoutRelightVisibility();
  applyExtSectionVisibility();
  applyHwConditions();
  applyOilMapVisibility();
  // Re-run view filter AFTER hw conditions — applyHwConditions() may un-hide expert-only
  // sections (e.g. Windmilling Oil Protection) which the basic view should still mask.
  applyView();
}

function _escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Boot: load config + hardware config, then render ────────
async function fetchJsonWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!r.ok) throw new Error(url + ' returned HTTP ' + r.status);
    const text = await r.text();
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}
async function fetchJsonWithRetry(url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchJsonWithTimeout(url);
    } catch (e) {
      lastError = e;
      await new Promise(resolve => setTimeout(resolve, 200 + i * 300));
    }
  }
  throw lastError;
}

function revealConfigDeepLink() {
  const id = decodeURIComponent(String(location.hash || '').replace(/^#/, ''));
  if (!id) return;
  const target = document.getElementById(id);
  if (!target) return;
  const field = target.closest('.cfg-field');
  const revealTarget = field || target;
  const section = revealTarget.closest('.cfg-section');
  const group = revealTarget.closest('.config-group');
  const protectionCard = revealTarget.closest('.protection-card');
  const filtered = field?.classList.contains('filter-hidden') ||
    section?.classList.contains('filter-hidden') ||
    group?.classList.contains('filter-hidden');
  if (filtered || (field && _fieldIsHardwareInactive(field))) {
    setWorkspaceFilter('explore');
  }
  if (group) group.open = true;
  if (protectionCard) protectionCard.open = true;
  section?.classList.remove('filter-hidden');
  field?.classList.remove('filter-hidden');
  document.querySelectorAll('.deep-link-target').forEach(el => el.classList.remove('deep-link-target'));
  revealTarget.classList.add('deep-link-target');
  requestAnimationFrame(() => revealTarget.scrollIntoView({ behavior:'smooth', block:'center' }));
}

(async () => {
  return Promise.all([
    fetchJsonWithRetry('/api/config'),
    fetchJsonWithRetry('/api/hardware')
  ]);
})()
  .then(([c, hw]) => {
    cfg   = c;
    hwCfg = hw;
    renderForm();
    _applyAllVisibility();
    _clearDirty();       // baseline after dependency selectors finish normalizing
    applyView();
    hookValidation();
    runValidation();
    if (typeof startTelemetryBoot === 'function') startTelemetryBoot();
    // Form controls are generated after load, so reveal the exact cross-page
    // destination only after rendering and dependency visibility are settled.
    revealConfigDeepLink();
    window.addEventListener('hashchange', revealConfigDeepLink);
  })
  .catch(e => {
    const msg = e && e.message ? e.message : e;
    document.getElementById('cfg-form').innerHTML =
      `<p style="color:var(--red);font-size:.85rem">Error loading config: ${_escHtml(msg || 'unknown error')}</p>`;
  });
