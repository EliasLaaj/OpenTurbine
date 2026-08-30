// Local applyContextTooltips (this page does not load app.js): hover help built
// from each .param-field's visible label + description; a MutationObserver keeps
// the dynamically-built block-editor fields covered too.
function applyContextTooltips(root) {
  (root || document).querySelectorAll('.param-field').forEach(function (el) {
    if (el.title) return;
    var lab = el.querySelector('.param-label');
    var des = el.querySelector('.param-desc');
    var l = lab && lab.textContent ? lab.textContent.trim() : '';
    var d = des && des.textContent ? des.textContent.trim() : '';
    var blockHelp = el.closest('.block-card')?.querySelector('.block-header')?.title || '';
    if (d || blockHelp) el.title = l ? l + ': ' + (d || blockHelp) : (d || blockHelp);
  });
}
document.addEventListener('DOMContentLoaded', function () {
  applyContextTooltips();
  new MutationObserver(function (recs) {
    recs.forEach(function (r) { r.addedNodes.forEach(function (n) { if (n.nodeType === 1) applyContextTooltips(n); }); });
  }).observe(document.body, { childList: true, subtree: true });
});

// ------ Block definitions ------------------------------------------------------------------------------------------------------------------------------------------------------------------
// type: 'while'=waits for condition  'action'=instant  'wait'=timer  'check'=verify+fault
// timeout_action: 'fault'|'abort'|'continue'|null
const BLOCKS = {
  SetOutput: {
    label:'Set Output', type:'action', badgeClass:'badge-action',
    condition:null, timeout_action:null,
    desc:'Commands one fitted output. Choose the device and set ON/OFF or a 0–100% demand according to its configured hardware driver.',
    params:[]
  },
  OilPrime: {
    label:'Build Oil Pressure', type:'while', badgeClass:'badge-while',
    visibleIf: hw => actuatorEnabled('oil_pump'),
    condition: hw => sensorEnabled('oil_press')
      ? `oil >= ${hw.oil_arm_min_bar ?? 1.5} bar`
      : `timer (no pressure sensor)`,
    timeout_action:'abort',
    desc:'Turns oil pump ON and pre-lubricates bearings. WITH pressure sensor: waits until oil >= arm threshold, aborts on timeout (safe - no fuel or ignition active). WITHOUT pressure sensor: runs pump at fixed duty % for the configured timeout, then completes automatically.',
    hwWarnings:[
      { check: hw => actuatorEnabled('oil_pump'),
        msg: 'Warning: No oil pump actuator configured - this block cannot actually pump oil. Add an oil pump in Hardware Config -> Actuators.' },
    ],
    params:[
      // ------ With oil pressure sensor ------------------------------------------------------------------------------------------------------------------------------
      {key:'startup_oil_demand', label:'Oil pressure target', unit:'bar', type:'float', min:0, max:20, step:0.1, def:2.5,
        visibleIf: hw => sensorEnabled('oil_press') && actuatorHasProportionalOutput('oil_pump'),
        configKey:'startup_oil_demand'},
      {key:'oil_arm_min_bar',    label:'Minimum pressure before ignition', unit:'bar', type:'float', min:0, max:20, step:0.1, def:1.5,
        visibleIf: hw => sensorEnabled('oil_press'), configKey:'oil_arm_min_bar'},
      // ------ Without oil pressure sensor ---------------------------------------------------------------------------------------------------------------------
      {key:'startup_oil_pct',    label:'Pump duty %',         unit:'%',  type:'float', min:0, max:100, step:5, def:80,
        visibleIf: hw => !sensorEnabled('oil_press') && actuatorHasProportionalOutput('oil_pump'),
        configKey:'startup_oil_pct',
        desc:'Pump runs at this fixed duty since no pressure sensor is fitted. Run timeout (below) determines how long the block holds.'},
      // ------ Common ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
      {key:'oil_arm_timeout_ms', label:'Timeout', unit:'ms', type:'int', min:500, max:30000, step:100, def:3000, configKey:'oil_arm_timeout_ms'},
      {key:'oil_prime_use_scavenge', label:'Run scavenge pump', type:'bool', def:false,
        configKey:'oil_prime_use_scavenge',
        visibleIf: hw => actuatorEnabled('oil_scavenge_pump')},
    ]
  },
  StarterSpin: {
    label:'Starter Spin to Light-Off Speed', type:'while', badgeClass:'badge-while',
    visibleIf: hw => actuatorEnabled('starter') && sensorEnabled('n1_rpm'),
    condition: hw => `N1 < ${hw.pre_ign_rpm ?? 5000} rpm`,
    timeout_action:'fault',
    desc:'Asserts starter enable output (if fitted), then ramps starter demand from 0 to target %. Waits for N1 to reach pre-ignition RPM. Starter enable delay (hardware config) is applied before the starter spins. On timeout -> FAULT SHUTDOWN. Outputs: starterEnabled=true, starterDemand ramping to target.',
    hwWarnings:[
      { check: hw => actuatorEnabled('starter'),
        msg: 'Warning: No starter actuator configured - starter output will have no physical effect. Add a starter in Hardware Config -> Actuators.',
        level: 'error' },
      { check: hw => sensorEnabled('n1_rpm'),
        msg: 'Warning: No N1 RPM sensor - block cannot verify target RPM. It will run for the full timeout, then FAULT SHUTDOWN. Enable bench mode for timer-only testing.' },
    ],
    params:[
      {key:'starter_demand',      label:'Starter demand',unit:'%',   type:'float', min:0,   max:100,   step:1,   def:60,    configKey:'starter_demand',
        visibleIf: hw => actuatorHasProportionalOutput('starter')},
      {key:'ramp_pct_per_s',     label:'Starter output increase rate', unit:'%/s', type:'float', min:0, max:200, step:5, def:30, configKey:'ramp_pct_per_s',
        visibleIf: hw => actuatorHasProportionalOutput('starter')},
      {key:'pre_ign_rpm',        label:'Starter cut target N1', unit:'rpm', type:'float', min:100, max:50000, step:100, def:5000, configKey:'pre_ign_rpm',
        visibleIf: hw => sensorEnabled('n1_rpm'),
        desc:'Starter runs until N1 exceeds this RPM. Without healthy N1 feedback the block runs to its timeout and then causes a fault shutdown.'},
      {key:'starter_timeout_ms', label:'Timeout',       unit:'ms',  type:'int',   min:1000,max:60000, step:500, def:8000,
        configKey:'starter_timeout_ms',
        desc:'Maximum spin time before fault shutdown. Bench Mode is the only mode where this timeout completes without verified N1 feedback.'},
      {key:'oil_startup_min_bar',label:'Oil arm min',   unit:'bar', type:'float', min:0,   max:20,    step:0.1, def:1.5,
        visibleIf: hw => sensorEnabled('oil_press'), configKey:'oil_startup_min_bar',
        desc:'Shared with OilPrime arm threshold - both use the same config value.'},
    ]
  },
  PreIgnSpark: {
    label:'Igniter 1 Timed On', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('igniter'),
    condition: null, timeout_action:null,
    desc:'Igniter-1-only block. Prefer Igniter On or Pre-Heat when you want to choose igniter 1, secondary igniter, glow, or wet glow from the block card. This block turns igniter 1 ON and leaves it ON when it exits.',
    params:[
      {key:'pre_ign_spark_ms', label:'Ignition on time', unit:'ms', type:'int', min:100, max:10000, step:100, def:1500, configKey:'pre_ign_spark_ms'},
    ]
  },
  FuelOpen: {
    label:'Open Main Fuel Shutoff', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('fuel_sol'),
    condition: null, timeout_action:null,
    desc:'Opens the main fuel shutoff and marks that combustion was attempted so Cooldown can run when needed. Instant action.',
    params:[]
  },
  FlameConfirm: {
    label:'Confirm Combustion by Flame Sensor', type:'while', badgeClass:'badge-while',
    visibleIf: hw => sensorEnabled('flame'),
    condition: hw => `flame count < ${hw.flame_required_count ?? 3}`,
    timeout_action:'abort',
    desc:'Waits until the flame sensor fires N consecutive times within the check interval. Confirms that combustion is self-sustained. On timeout -> ABORT. On exit: optionally cuts all ignition outputs.',
    hwWarnings:[
      { check: hw => sensorEnabled('flame'),
        msg: 'Blocked: No flame sensor configured - flame count will never increment. This block will always timeout and ABORT. Use TempConfirm as a replacement if a temperature sensor is fitted.',
        level: 'error' },
    ],
    params:[
      {key:'flame_required_count',    label:'Required detections',     type:'int', min:1, max:20, step:1, def:3, configKey:'flame_required_count',
        desc:'Consecutive flame detections required before the block confirms self-sustained combustion.'},
      {key:'flame_check_interval_ms', label:'Detection interval', unit:'ms', type:'int', min:50, max:2000, step:50, def:250, configKey:'flame_check_interval_ms',
        desc:'Time window for each required flame detection. Longer is more tolerant of slow/noisy sensors but delays startup.'},
      {key:'flame_timeout_ms',       label:'Timeout',                 unit:'ms', type:'int',  min:1000, max:30000, step:500, def:5000, configKey:'flame_timeout_ms'},
      {key:'flame_turn_off_igniter', label:'Release sequence ignition on exit', type:'bool', def:true, configKey:'flame_turn_off_igniter',
        desc:'Turns off only ignition devices energized by dedicated ignition blocks in this sequence. Unrelated controller or subsystem outputs are not changed.'},
    ]
  },
  TempConfirm: {
    label:'Confirm Combustion by Temperature', type:'while', badgeClass:'badge-while',
    visibleIf: hw => sensorEnabled('tot') || sensorEnabled('tit'),
    condition: hw => `EGT < ${fmtSeqTemp(hw.temp_confirm_target ?? 200)}`,
    timeout_action:'abort',
    desc:'Waits until selected engine temperature (TOT or TIT) rises above the configured threshold. Use as an alternative to or alongside FlameConfirm when a flame sensor is not fitted. On timeout -> ABORT. Does NOT change any actuator state.',
    hwWarnings:[
      { check: hw => sensorEnabled('tot') || sensorEnabled('tit'),
        msg: 'Blocked: No temperature (TOT/TIT) sensor configured - EGT will never rise above ambient. This block will always timeout and ABORT.',
        level: 'error' },
    ],
    params:[
      {key:'temp_confirm_target',  label:'Target EGT', unitType:'temp', type:'float', min:0, max:1000, step:10, def:200,  configKey:'temp_confirm_target'},
      {key:'temp_confirm_timeout', label:'Timeout',   unit:'ms', type:'int',   min:1000, max:60000, step:1000, def:10000, configKey:'temp_confirm_timeout'},
    ]
  },
  TimedDelay: {
    label:'Timed Delay', type:'wait', badgeClass:'badge-wait',
    condition: hw => `${hw.timed_delay_ms ?? 1000} ms`,
    timeout_action:null,
    desc:'Pauses the sequence for the configured duration. No actuator changes - all outputs remain in whatever state the previous block left them.',
    params:[
      {key:'timed_delay_ms', label:'Delay', unit:'ms', type:'int', min:100, max:60000, step:100, def:1000, configKey:'timed_delay_ms',
        desc:'How long the sequence waits while leaving every output in the state set by the preceding block.'},
    ]
  },
  FuelPumpIdle: {
    label:'Set Main Fuel for Idle', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorHasProportionalOutput('throttle'),
    condition: null, timeout_action:null,
    desc:'Sets fuel demand from the configured idle input. Its calibrated 0–100% travel maps from the minimum reliable fuel output up to Max%, whether the signal is analog, RC pulse, or a profiled PCB input. If no idle input is fitted, the calibrated minimum is used as fixed idle. Completes immediately.',
    params:[
      {key:'fp_idle_max_pct', label:'Maximum idle metering output', unit:'%', type:'float', min:0, max:100, step:0.5, def:18, configKey:'fp_idle_max_pct',
        desc:'Upper end of the idle-input range. With no idle input fitted, the calibrated minimum metering output is used instead.'},
    ]
  },
  ModifiedIdle: {
    label:'Set Main Fuel for Raised Idle', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorHasProportionalOutput('throttle'),
    condition: null, timeout_action:null,
    desc:'Sets throttle demand = idle input mapped through throttle idle range (Config -> Throttle) x multiplier. Use multiplier > 1.0 for a slightly higher idle on first spool. Completes immediately. throttleDemand is reset to 0 when the engine enters RUNNING. Outputs: throttleDemand set to scaled value.',
    params:[
      {key:'modified_idle_multiplier', label:'Idle fuel multiplier', unit:'x', type:'float', min:0.1, max:5, step:0.05, def:1.0, configKey:'modified_idle_multiplier'},
    ]
  },
  Spool: {
    label:'Accelerate to Idle', type:'while', badgeClass:'badge-while',
    visibleIf: hw => actuatorHasProportionalOutput('throttle') && sensorEnabled('n1_rpm'),
    condition: hw => `N1 < ${hw.rpm_target ?? 32000} rpm`,
    timeout_action:'fault',
    desc:'Sets main fuel demand to the calibrated minimum reliable metering output and holds until N1 reaches the idle-entry target. Flame monitoring is active; loss of combustion causes a fault shutdown. The running oil-pressure minimum is enforced from this block onward.',
    hwWarnings:[
      { check: hw => sensorEnabled('n1_rpm'),
        msg: 'Warning: No N1 RPM sensor - Spool cannot verify target RPM has been reached. Block will run until timeout -> FAULT SHUTDOWN.' },
    ],
    params:[
      {key:'rpm_target',                label:'Idle-entry N1 target', unit:'rpm',type:'float', min:1000, max:200000, step:500, def:32000, configKey:'rpm_target'},
      {key:'rpm_timeout_ms',            label:'Timeout',                    unit:'ms', type:'int',   min:1000, max:120000, step:1000, def:12000, configKey:'rpm_timeout_ms'},
      {key:'oil_running_min',           label:'Running oil min',            unit:'bar',type:'float', min:0,    max:20,     step:0.1,  def:2.8,   configKey:'oil_running_min',
        visibleIf: hw => sensorEnabled('oil_press'),
        desc:'Oil pressure minimum enforced from Spool start through running. Shared with SafetyHold - edit in either block or in Config -> Oil -> Running Min.'},
      {key:'spool_cut_starter_on_exit', label:'Cut starter demand on exit',            type:'bool',                                  def:true,  configKey:'spool_cut_starter_on_exit'},
      {key:'spool_cut_starter_en_on_exit',label:'Cut starter enable output on exit',   type:'bool',                                  def:true,  configKey:'spool_cut_starter_en_on_exit',
        visibleIf: hw => actuatorEnabled('starter_en')},
    ]
  },
  SafetyHold: {
    label:'Final Startup Checks', type:'check', badgeClass:'badge-check',
    visibleIf: hw => sensorEnabled('n1_rpm') || sensorEnabled('n2_rpm') || sensorEnabled('p1') || sensorEnabled('p2') || sensorEnabled('oil_press') || sensorEnabled('tot') || sensorEnabled('tit') || sensorEnabled('flame'),
    condition: hw => `${hw.safety_hold_ms ?? 1000} ms continuously stable`,
    timeout_action:'fault',
    desc:'Requires every enabled check to remain continuously valid for the stable time before RUNNING. A failed or unhealthy sensor resets the stable timer; the overall timeout causes a fault shutdown. Starter state is not treated as proof of engine health.',
    hwWarnings:[
      { check: hw => sensorEnabled('n1_rpm') || sensorEnabled('oil_press'),
        level: 'error',
        msg: 'Error: No N1 RPM or oil pressure sensor - SafetyHold has nothing to verify before RUNNING. Add N1 or oil pressure feedback, remove SafetyHold, or use Bench Mode for timer-only testing.' },
    ],
    params:[
      {key:'safety_hold_ms', label:'Stable time required',unit:'ms', type:'int', min:100, max:10000, step:100, def:1000, configKey:'safety_hold_ms'},
      {key:'safety_hold_timeout_ms', label:'Overall timeout',unit:'ms', type:'int', min:100, max:120000, step:500, def:15000, configKey:'safety_hold_timeout_ms'},
      {key:'final_check_n1_enabled',label:'Require N1',type:'bool',def:true,configKey:'final_check_n1_enabled',visibleIf:hw=>sensorEnabled('n1_rpm')},
      {key:'final_check_rpm',label:'Minimum accepted N1', unit:'rpm',type:'float', min:1000, max:200000, step:500, def:31000, configKey:'final_check_rpm',
        visibleIf: hw => sensorEnabled('n1_rpm'),
        desc:'N1 must remain at or above this value for the full stable time.'},
      {key:'final_check_n2_enabled',label:'Require N2',type:'bool',def:false,configKey:'final_check_n2_enabled',visibleIf:hw=>sensorEnabled('n2_rpm')},
      {key:'final_check_n2_rpm',label:'Minimum accepted N2',unit:'rpm',type:'float',min:0,max:200000,step:500,def:0,configKey:'final_check_n2_rpm',visibleIf:hw=>sensorEnabled('n2_rpm')},
      {key:'final_check_p1_enabled',label:'Require P1 pressure',type:'bool',def:false,configKey:'final_check_p1_enabled',visibleIf:hw=>sensorEnabled('p1')},
      {key:'final_check_p1_bar',label:'Minimum accepted P1',unit:'bar',type:'float',min:0,max:1000,step:0.1,def:0,configKey:'final_check_p1_bar',visibleIf:hw=>sensorEnabled('p1')},
      {key:'final_check_p2_enabled',label:'Require P2 pressure',type:'bool',def:false,configKey:'final_check_p2_enabled',visibleIf:hw=>sensorEnabled('p2')},
      {key:'final_check_p2_bar',label:'Minimum accepted P2',unit:'bar',type:'float',min:0,max:1000,step:0.1,def:0,configKey:'final_check_p2_bar',visibleIf:hw=>sensorEnabled('p2')},
      {key:'final_check_oil_enabled',label:'Require oil pressure',type:'bool',def:false,configKey:'final_check_oil_enabled',visibleIf:hw=>sensorEnabled('oil_press')},
      {key:'oil_running_min',label:'Minimum accepted oil pressure',unit:'bar',type:'float', min:0, max:20, step:0.1, def:2.8, configKey:'oil_running_min',
        visibleIf: hw => sensorEnabled('oil_press'),
        desc:'Same threshold as Spool running oil min - both read Config -> Oil -> Running Min.'},
      {key:'final_check_egt_enabled',label:'Require engine temperature',type:'bool',def:false,configKey:'final_check_egt_enabled',visibleIf:hw=>sensorEnabled('tot')||sensorEnabled('tit')},
      {key:'final_check_egt_c',label:'Minimum accepted EGT',unitType:'temp',type:'float',min:0,max:1400,step:10,def:0,configKey:'final_check_egt_c',visibleIf:hw=>sensorEnabled('tot')||sensorEnabled('tit')},
      {key:'final_check_flame_enabled',label:'Require flame detected',type:'bool',def:false,configKey:'final_check_flame_enabled',visibleIf:hw=>sensorEnabled('flame')},
      {key:'safety_turn_off_starter',    label:'Turn off starter on exit',             type:'bool', def:false, configKey:'safety_turn_off_starter'},
      {key:'safety_turn_off_starter_en', label:'Turn off starter enable output on exit',type:'bool', def:false, configKey:'safety_turn_off_starter_en',
        visibleIf: hw => actuatorEnabled('starter_en')},
      {key:'safety_turn_off_igniter',    label:'Release sequence ignition on exit',    type:'bool', def:false, configKey:'safety_turn_off_igniter',
        desc:'Turns off only ignition devices energized by dedicated ignition blocks in this sequence.'},
    ]
  },
  AirstarterOn: {
    label:'Air Starter Valve Open', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('airstarter_sol'),
    condition: null, timeout_action:null,
    desc:'Open the air starter valve so compressed air can spool the turbine.',
    params:[]
  },
  AirstarterOff: {
    label:'Air Starter Valve Close', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('airstarter_sol'),
    condition: null, timeout_action:null,
    desc:'Close the air starter valve.',
    params:[]
  },
  CoolFanOn: {
    label:'Cooling Fan On', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('cool_fan'),
    condition: null, timeout_action:null,
    desc:'Enable the cooling fan.',
    params:[]
  },
  CoolFanOff: {
    label:'Cooling Fan Off', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('cool_fan'),
    condition: null, timeout_action:null,
    desc:'Disable the cooling fan.',
    params:[]
  },
  // ------ Explicit actuator control blocks ------------------------------------------------------------------------------------------------------------
  IgniterOn: {
    label:'Ignition Output On', type:'action', badgeClass:'badge-action',
    visibleIf: hw => hasIgnitionOutput(hw),
    condition: null, timeout_action:null,
    desc:'Switch the selected ignition output on. Choose igniter 1, secondary igniter, glow plug, or wet glow from this card.',
    params:[]
  },
  IgniterOff: {
    label:'Ignition Output Off', type:'action', badgeClass:'badge-action',
    visibleIf: hw => hasIgnitionOutput(hw),
    condition: null, timeout_action:null,
    desc:'Switch the selected ignition output off.',
    params:[]
  },
  FuelSolClose: {
    label:'Close Main Fuel Shutoff', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('fuel_sol'),
    condition: null, timeout_action:null,
    desc:'Close the main fuel shutoff. Use to cut fuel without triggering the full emergency-stop path.',
    params:[]
  },
  StarterEnOn: {
    label:'Starter Enable On', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('starter_en'),
    condition: null, timeout_action:null,
    desc:'Assert the starter enable output or gate. Required on hardware with a separate starter arm circuit.',
    params:[]
  },
  StarterEnOff: {
    label:'Starter Enable Off', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('starter_en'),
    condition: null, timeout_action:null,
    desc:'De-assert the starter enable output.',
    params:[]
  },
  OilPumpOn: {
    label:'Oil Pump On', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('oil_pump'),
    condition: null, timeout_action:null,
    desc:'Start oil pump at the specified direct output demand. This sequence setting is independent of the closed-loop oil controller minimum duty.',
    params:[
      {key:'oil_pump_on_pct', label:'Startup oil pump demand', unit:'%', type:'float', min:0, max:100, step:5, def:100, configKey:'oil_pump_on_pct',
        visibleIf: hw => actuatorHasProportionalOutput('oil_pump'),
        desc:'Direct PWM output for this sequence step; it is not limited by Controllers > Oil & Lubrication Controllers > Minimum Pump Command.'},
    ]
  },
  OilPumpOff: {
    label:'Oil Pump Off', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('oil_pump'),
    condition: null, timeout_action:null,
    desc:'Stop the oil pump. For post-stop oil cut-off or intentional dry motoring.',
    params:[]
  },
  OilScavengeOn: {
    label:'Scavenge On', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('oil_scavenge_pump'),
    condition: null, timeout_action:null,
    desc:'Activates the dedicated oil scavenge pump. Use during startup priming, warmup holds, or anywhere you need scavenge running independently of the main oil pressure loop.',
    params:[]
  },
  OilScavengeOff: {
    label:'Scavenge Off', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('oil_scavenge_pump'),
    condition: null, timeout_action:null,
    desc:'Deactivates the oil scavenge pump.',
    params:[]
  },
  DrainValveOpen: {
    label:'Open Drain Valve', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('drain_valve'),
    condition:null, timeout_action:null,
    desc:'Opens the fitted electric drain valve. The Hardware output type and inversion determine the physical relay, PWM, or servo signal.',
    params:[]
  },
  DrainValveClose: {
    label:'Close Drain Valve', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('drain_valve'),
    condition:null, timeout_action:null,
    desc:'Closes the fitted electric drain valve.',
    params:[]
  },
  StarterOff: {
    label:'Starter Off', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('starter'),
    condition: null, timeout_action:null,
    desc:'Set starter demand to zero. Use after spool is established to disengage the starter motor.',
    params:[]
  },
  // ------ Shutdown blocks ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  ImmediateCut: {
    label:'Immediate Fuel and Ignition Cut', type:'action', badgeClass:'badge-action',
    condition: null, timeout_action:null,
    desc:'Instant emergency cut. Sets: throttleDemand=0, fuelSolOpen=false, igniterOn=false, starterDemand=0, starterEnabled=false. Use as first shutdown block.',
    params:[]
  },
  RPMDrop: {
    label:'Wait for Rotor to Slow', type:'while', badgeClass:'badge-while',
    condition: hw => `N1 > ${hw.rpm_drop_threshold ?? 5000} rpm`,
    timeout_action:'continue',
    desc:'Waits for N1 to fall below the threshold RPM before proceeding to cooldown. Ensures the starter motor is not fighting against residual turbine spin. On timeout -> continues anyway. No actuator changes.',
    hwWarnings:[
      { check: hw => sensorEnabled('n1_rpm'),
        msg: 'Warning: No N1 RPM sensor - RPM drop cannot be verified. Block will proceed after timeout (safe - timeout action is continue).' },
    ],
    params:[
      {key:'rpm_drop_threshold', label:'RPM threshold',unit:'rpm',type:'float',min:100, max:50000, step:100,  def:5000,   configKey:'rpm_drop_threshold'},
      {key:'rpm_drop_timeout_ms',label:'Timeout',      unit:'ms', type:'int',  min:1000,max:60000, step:1000, def:15000,  configKey:'rpm_drop_timeout_ms'},
    ]
  },
  CooldownSpin: {
    label:'Cooldown', type:'while', badgeClass:'badge-while',
    condition: hw => `EGT > ${fmtSeqTemp(hw.tot_cooldown_target ?? 150)}`,
    timeout_action:'continue',
    desc:'Spin starter and/or run oil pump to cool EGT below target. Skipped if fuel was never opened. Proceeds on timeout. With oil pressure sensor: pump is regulated to target pressure; without: runs at fixed %.',
    hwWarnings:[
      { check: hw => sensorEnabled('tot') || sensorEnabled('tit'),
        msg: 'Warning: No temperature sensor - cooldown cannot verify EGT has dropped. Block will run for the full timeout then continue (safe).' },
      { check: () => {
          const source = Number(cfg?.safety?.egt_source || 0);
          const hasTot = sensorEnabled('tot');
          const hasTit = sensorEnabled('tit');
          const limit = source === 1 && hasTot ? Number(cfg?.engine?.tot_limit || 0) :
                        source === 2 && hasTit ? Number(cfg?.safety?.tit_limit_c || 0) :
                        hasTot ? Number(cfg?.engine?.tot_limit || 0) :
                        hasTit ? Number(cfg?.safety?.tit_limit_c || 0) : 0;
          return limit <= 0 || Number(cfg?.engine?.tot_cooldown_target || 0) < limit;
        },
        msg: 'Warning: Cooldown EGT target is at or above the selected engine-temperature shutdown limit. Cooldown may complete immediately while the turbine is still hot; use a verified bearing/storage-safe target.' },
    ],
    params:[
      {key:'tot_cooldown_target',       label:'EGT target',              unitType:'temp', type:'float',min:0, max:100000, step:10, def:150, configKey:'tot_cooldown_target'},
      {key:'cooldown_timeout_ms',       label:'Timeout',                 unit:'ms', type:'int',  min:10000,max:600000, step:10000, def:60000, configKey:'cooldown_timeout_ms'},
      {key:'cooldown_skip_hold_ms',     label:'Manual skip hold',        unit:'ms', type:'int',  min:500,  max:30000,  step:500,   def:1000,  configKey:'cooldown_skip_hold_ms',
        desc:'During SHUTDOWN, hold START and STOP together for this long to deliberately skip the remaining cooldown.'},
      {key:'cooldown_use_starter',      label:'Use starter motor',                  type:'bool',                                  def:true,   configKey:'cooldown_use_starter',
        visibleIf: hw => actuatorEnabled('starter')},
      {key:'cooldown_starter_pct',      label:'Starter speed',           unit:'%',  type:'float',min:0,    max:100,    step:5,     def:40,     configKey:'cooldown_starter_pct',
        visibleIf: hw => actuatorHasProportionalOutput('starter')},
      {key:'cooldown_starter_en_relay', label:'Starter enable output asserted automatically', type:'bool', def:true,
        visibleIf: hw => actuatorEnabled('starter_en') && actuatorEnabled('starter'),
        desc:'When a dedicated starter enable output is fitted, it is always asserted before the starter motor runs. This is handled automatically - no action needed.'},
      {key:'cooldown_use_oil_pump',     label:'Run oil pump',                       type:'bool',                                  def:true,   configKey:'cooldown_use_oil',
        visibleIf: hw => actuatorEnabled('oil_pump')},
      {key:'cooldown_oil_pct',          label:'Oil pump %',              unit:'%',  type:'float',min:0,    max:100,    step:5,     def:30,     configKey:'cooldown_oil_pct',
        visibleIf: hw => actuatorHasProportionalOutput('oil_pump') && !sensorEnabled('oil_press')},
      {key:'cooldown_oil_pressure_bar', label:'Oil pressure target',     unit:'bar',type:'float',min:0.5,  max:10,     step:0.1,   def:2.0,    configKey:'cooldown_oil_pressure_bar',
        visibleIf: hw => actuatorHasProportionalOutput('oil_pump') && sensorEnabled('oil_press')},
      {key:'cooldown_use_scavenge',     label:'Run scavenge pump',                  type:'bool',                                  def:false,  configKey:'cooldown_use_scavenge',
        visibleIf: hw => actuatorEnabled('oil_scavenge_pump')},
    ]
  },
  FinalStop: {
    label:'Wait for Complete Stop', type:'while', badgeClass:'badge-while',
    condition: hw => sensorEnabled('n1_rpm')
      ? `N1 > ${hw.rpm_zero_threshold ?? 100} rpm`
      : `timer (no N1 sensor)`,
    timeout_action:'continue',
    desc:'Wait for complete stop. With healthy N1 feedback, the main oil pump cuts when speed reaches the stop threshold. If N1 is missing or unhealthy, the block waits for the full timeout as a conservative spool-down delay. A fitted scavenge pump can then continue to flush hot oil from bearings.',
    params:[
      {key:'rpm_zero_threshold',    label:'Stop threshold',   unit:'rpm',type:'float',min:0,   max:1000,  step:10,   def:100,
        visibleIf: hw => sensorEnabled('n1_rpm'),
        configKey:'rpm_zero_threshold',
        desc:'N1 below this is treated as "stopped". When N1 is missing or unhealthy, this threshold cannot be used and the block waits for the full timeout.'},
      {key:'final_stop_timeout_ms', label:'Timeout',          unit:'ms', type:'int',  min:1000,max:60000, step:1000, def:10000, configKey:'final_stop_timeout_ms'},
      {key:'oil_scavenge_ms', label:'Scavenge pump run time', unit:'ms', type:'int',
        min:0, max:120000, step:1000, def:0, configKey:'oil_scavenge_ms',
        visibleIf: hw => actuatorEnabled('oil_scavenge_pump')},
    ]
  },
  // ------ Extended / optional blocks ---------------------------------------------------------------------------------------------------------------------------------
  FuelPulse: {
    label:'Pulse Main Fuel Shutoff', type:'wait', badgeClass:'badge-wait',
    visibleIf: hw => actuatorEnabled('fuel_sol'),
    condition: hw => `fuel ${hw.fuel_pulse_ms ?? 200}ms`,
    timeout_action:null,
    desc:'Opens the main fuel shutoff for a brief pulse to wet the atomiser or clear the dead-leg before ignition. Does NOT mark combustion as attempted - use before Igniter 1 Timed On as a pre-prime step. The shutoff closes after the pulse, then the block waits before completing.',
    params:[
      {key:'fuel_pulse_ms', label:'Pulse duration',  unit:'ms', type:'int', min:50,  max:2000, step:50,  def:200, configKey:'fuel_pulse_ms'},
      {key:'fuel_off_ms',   label:'Wait after close', unit:'ms', type:'int', min:0,   max:5000, step:100, def:300, configKey:'fuel_off_ms'},
    ]
  },
  WaitTOTCool: {
    label:'Wait for Safe Restart Temperature', type:'while', badgeClass:'badge-while',
    visibleIf: hw => sensorEnabled('tot') || sensorEnabled('tit'),
    condition: hw => `EGT < ${fmtSeqTemp(hw.wait_tot_target ?? 150)}`,
    timeout_action:null,
    desc:'Holds until selected EGT is healthy and below the target. In STARTUP, an unhealthy/hot timeout aborts the start. In SHUTDOWN, timeout permits completion so shutdown cannot hang indefinitely.',
    params:[
      {key:'wait_tot_target',  label:'Target EGT', unitType:'temp', type:'float', min:0,    max:500,    step:10,   def:150,    configKey:'wait_tot_target'},
      {key:'wait_tot_timeout', label:'Timeout',    unit:'ms', type:'int',  min:5000, max:600000, step:5000, def:120000, configKey:'wait_tot_timeout'},
    ]
  },
  ThrottleSet: {
    label:'Set Main Fuel Demand', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorHasProportionalOutput('throttle'),
    condition: null, timeout_action:null,
    desc:'Immediately sets throttleDemand to a fixed percentage and completes. Use for a precise idle hold, warm-up step, or test point. If the throttle slew controller is active it will ramp to this setpoint.',
    params:[
      {key:'throttle_set_pct', label:'Main fuel demand', unit:'%', type:'float', min:0, max:100, step:1, def:10, configKey:'throttle_set_pct'},
    ]
  },
  WaitForInput: {
    label:'Wait for External Input', type:'while', badgeClass:'badge-while',
    visibleIf: hw => hw.di_channels?.some(ch => ch.pin >= 0),
    condition: hw => `DI-${(hw.wait_for_input_ch ?? 0) + 1} ${hw.wait_for_input_state !== false ? '-> active' : '-> inactive'}`,
    timeout_action:'abort',
    desc:'Holds the sequence until a digital input channel reaches the expected state. Useful for interlocks, limit switches, or external gate signals. The wait is always finite and aborts on timeout. Note: all WaitForInput blocks in a session share the same channel/state config.',
    hwWarnings:[
      { check: hw => hw.di_channels?.some(ch => ch.pin >= 0),
        msg: 'Warning: No digital inputs configured in Hardware. This block will never receive a signal and will always timeout/abort.',
        level: 'error' },
    ],
    params:[
      {key:'wait_for_input_ch',      label:'Channel',       type:'select', def:0,    configKey:'wait_for_input_ch',
        options:[{v:0,l:'DI-1'},{v:1,l:'DI-2'},{v:2,l:'DI-3'},{v:3,l:'DI-4'}],
        desc:'Digital input channel (DI-1..DI-4). Must match a channel configured in Hardware -> Digital Inputs.'},
      {key:'wait_for_input_state',   label:'Wait until active',        type:'bool', def:true, configKey:'wait_for_input_state',
        desc:'ON = hold until input goes active (high). OFF = hold until input goes inactive (low).'},
      {key:'wait_for_input_timeout', label:'Timeout',       unit:'ms', type:'int',  min:500, max:60000, step:500, def:30000, configKey:'wait_for_input_timeout',
        desc:'Maximum finite wait time. Remove the block if this gate is not required.'},
    ]
  },
  WaitForInputOff: {
    label:'Wait for External Input to Release', type:'while', badgeClass:'badge-while',
    visibleIf: hw => hw.di_channels?.some(ch => ch.pin >= 0),
    condition: hw => `DI-${(hw.wait_for_input_ch ?? 0) + 1} -> inactive`,
    timeout_action:'abort',
    desc:'Holds shutdown until the selected digital input is released. The stock shutdown uses this to wait for the fuel switch to turn off before stopping the oil pump.',
    hwWarnings:[
      { check: hw => hw.di_channels?.some(ch => ch.pin >= 0),
        msg: 'No digital inputs configured in Hardware. This block will never receive a switch signal.',
        level: 'error' },
    ],
    params:[]
  },
  PreHeat: {
    label:'Pre-Heat', type:'wait', badgeClass:'badge-wait',
    visibleIf: hw => hasIgnitionOutput(hw),
    condition: () => 'selected ignition device pre-heat',
    timeout_action:null,
    desc:'Turns the exact selected ignition output on for that device card\'s pre-heat duration without opening main fuel. The output remains ON when this block exits - place FuelOpen or a later Ignition Output Off block intentionally.',
    params:[]
  },
  // ------ Afterburner blocks ---------------------------------------------------------------------------------------------------------------------------------------------------------
  ABPumpOn: {
    label:'Afterburner Fuel Pump On', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('ab_pump'),
    condition: null, timeout_action:null,
    desc:'Enable the afterburner fuel pump at Config -> Afterburner -> Light-Up Pump %.',
    params:[]
  },
  ABPumpOff: {
    label:'Afterburner Fuel Pump Off', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('ab_pump'),
    condition: null, timeout_action:null,
    desc:'Disable the afterburner fuel pump.',
    params:[]
  },
  ABIgnOn: {
    label:'AB Igniter On', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('igniter2'),
    condition: null, timeout_action:null,
    desc:'Enable the afterburner / secondary igniter.',
    params:[]
  },
  ABIgnOff: {
    label:'AB Igniter Off', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('igniter2'),
    condition: null, timeout_action:null,
    desc:'Disable the afterburner igniter.',
    params:[]
  },
  ABSolOpen: {
    label:'Afterburner Fuel Valve Open', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('ab_sol'),
    condition: null, timeout_action:null,
    desc:'Open the afterburner fuel solenoid (abSolOpen = true).',
    params:[]
  },
  ABSolClose: {
    label:'Afterburner Fuel Valve Close', type:'action', badgeClass:'badge-action',
    visibleIf: hw => actuatorEnabled('ab_sol'),
    condition: null, timeout_action:null,
    desc:'Close the afterburner fuel solenoid (abSolOpen = false).',
    params:[]
  },
  ABCheckReady: {
    label:'Check Afterburner Entry Conditions', type:'check', badgeClass:'badge-check',
    condition: hw => 'entry conditions above',
    timeout_action:'abort',
    desc:'Gate block: checks the entry conditions configured above before proceeding with AB ignition. Aborts if any condition fails.',
    params:[]
  },
  ABIgnite: {
    label:'Ignite Afterburner', type:'action', badgeClass:'badge-action',
    condition: null, timeout_action:null,
    desc:'Fire AB ignition using the method configured in Config -> Afterburner - Ignition Method (torch, AB igniter, or both). Completes after the torch duration.',
    params:[]
  },
  ABFlameConfirm: {
    label:'Verify Afterburner Light-up', type:'while', badgeClass:'badge-while',
    condition: hw => 'Waiting for configured light-up evidence',
    timeout_action:'fault',
    desc:'Uses the configured flame sensor, EGT rise, or explicitly unverified timed assumption. Timed mode does not confirm flame. Faults if the overall timeout is exceeded.',
    params:[
      {key:'ab_flame_timeout', label:'Overall Timeout', unit:'ms', type:'int', min:0, max:3600000, step:200, def:3000, configKey:'ab_flame_timeout',
        desc:'Maximum time allowed for the selected afterburner light-up evidence before the sequence faults and removes afterburner fuel and ignition.'},
    ]
  },
  ABStabilize: {
    label:'Stabilize Afterburner', type:'while', badgeClass:'badge-while',
    condition: hw => `Hold ${hw.ab_stab_ms ?? 1000} ms, monitor EGT`,
    timeout_action:'complete',
    desc:'Hold after lighting. Monitors selected EGT - faults if too hot. On completion, sets AB state to Running.',
    params:[
      {key:'ab_stab_ms', label:'Hold Time', unit:'ms', type:'int', min:0, max:3600000, step:100, def:1000, configKey:'ab_stab_ms',
        desc:'Time to hold the light-up condition before declaring the afterburner stable and running.'},
      {key:'ab_stab_max_tot', label:'Max EGT (0=off)', unitType:'temp', zeroOff:true, type:'float', min:0, max:100000, step:10, def:0, configKey:'ab_stab_max_tot',
        desc:'Optional temperature ceiling during stabilization. Zero disables this local check; independent engine overtemperature protection remains active.'},
    ]
  },

  // ------ Advanced hardware blocks ------------------------------------------------------------------------------------------------
  BleedOpen: {
    label:'Bleed Valve Open', type:'action', badgeClass:'badge-action',
    condition: null, timeout_action: null,
    desc:'Opens the compressor bleed valve immediately (one tick). Use at the start of startup sequences to reduce surge risk during spool-up. Outputs: bleedValveOpen=true.',
    params:[],
    visibleIf: hw => actuatorEnabled('bleed_valve'),
  },
  BleedClose: {
    label:'Bleed Valve Close', type:'action', badgeClass:'badge-action',
    condition: null, timeout_action: null,
    desc:'Closes the compressor bleed valve immediately (one tick). Use after spool-up is complete to restore full pressure recovery. Outputs: bleedValveOpen=false.',
    params:[],
    visibleIf: hw => actuatorEnabled('bleed_valve'),
  },
  GlowPreheat: {
    label:'Glow Preheat', type:'action', badgeClass:'badge-action',
    condition: null, timeout_action: null,
    desc:'Runs the exact selected glow plug using that device card\'s own preheat ramp, hold command, hot-current confirmation, and paired pilot-fuel settings. The plug remains at its configured hold command when this block exits.',
    params:[],
    visibleIf: hw => actuatorEnabled('glow_plug'),
  },
  FuelPumpRamp: {
    label:'Secondary / Auxiliary Fuel Pump Ramp', type:'action', badgeClass:'badge-action',
    condition: null, timeout_action: null,
    desc:'Ramps secondary / auxiliary fuel pump demand linearly from startPct to endPct over rampMs. Completes when the ramp finishes. Useful for start fuel, turboshaft pre-metering, or staged fuel delivery.',
    params:[
      {key:'fp2_start_pct',      label:'Start %',                     unit:'%',  type:'float', min:0,  max:100,   step:1,   def:0,    configKey:'fp2_start_pct'},
      {key:'fp2_end_pct',        label:'End %',                       unit:'%',  type:'float', min:0,  max:100,   step:1,   def:80,   configKey:'fp2_end_pct'},
      {key:'fp2_ramp_ms',        label:'Ramp duration',               unit:'ms', type:'int',   min:100,max:60000, step:100, def:3000, configKey:'fp2_ramp_ms'},
    ],
    visibleIf: hw => actuatorHasProportionalOutput('fuel_pump2'),
  },
  FuelPump2Set: {
    label:'Secondary / Auxiliary Fuel Pump Set', type:'action', badgeClass:'badge-action',
    condition: null, timeout_action: null,
    desc:'Sets secondary / auxiliary fuel pump demand to a fixed value immediately. Use for known set-points after a ramp or as a quick preset.',
    params:[
      {key:'fp2_demand_pct',     label:'Demand %',                    unit:'%',  type:'float', min:0, max:100, step:1, def:0, configKey:'fp2_demand_pct'},
    ],
    visibleIf: hw => actuatorHasProportionalOutput('fuel_pump2'),
  },
  FuelPump2On: {
    label:'Secondary / Auxiliary Fuel Pump On', type:'action', badgeClass:'badge-action',
    condition: null, timeout_action: null,
    desc:'Switches relay-type secondary / auxiliary fuel pump on. This card is shown only when that pump is configured as an on/off output.',
    params:[],
    visibleIf: hw => actuatorEnabled('fuel_pump2') && actuatorIsRelay('fuel_pump2'),
  },
  FuelPump2Off: {
    label:'Secondary / Auxiliary Fuel Pump Off', type:'action', badgeClass:'badge-action',
    condition: null, timeout_action: null,
    desc:'Switches relay-type secondary / auxiliary fuel pump off.',
    params:[],
    visibleIf: hw => actuatorEnabled('fuel_pump2') && actuatorIsRelay('fuel_pump2'),
  },
  GovernorHold: {
    label:'Wait for N2 Speed Control', type:'while', badgeClass:'badge-while',
    condition: hw => `N2 within ${hw.gov_hold_band_rpm ?? 500} rpm of target`,
    timeout_action:'fault',
    desc:'Engages the real N2 speed controller bumplessly from the current demand, then requires healthy N2 feedback inside the selected band for 500 ms. Timeout faults startup and enters safe shutdown.',
    params:[
      {key:'gov_hold_timeout_ms', label:'Timeout', unit:'ms',  type:'int',   min:1000, max:60000, step:500,  def:10000, configKey:'gov_hold_timeout_ms'},
      {key:'gov_hold_band_rpm',   label:'Band',    unit:'rpm', type:'float', min:0, max:1000000000, step:50, def:500, configKey:'gov_hold_band_rpm'},
    ],
    visibleIf: hw => !!(hw.controllers?.governor && sensorEnabled('n2_rpm') &&
      (actuatorEnabled('throttle') || actuatorHasProportionalOutput('prop_pitch'))),
  },
};

// ------ Config section mapping ---------------------------------------------------------------------------------------------------------------------------------------------------
// Maps each block parameter to its JSON path in the settings section of ecu_config.json.
// The "section" is doc["sequence"]["startup"] or doc["sequence"]["shutdown"] etc.
const CONFIG_SECTIONS = {
  // startup sequence params (doc.sequence.startup.*)
  startup_oil_demand:      {sec:'oil',              key:'startup_pressure'},   // bar target (with sensor)
  startup_oil_pct:         {sec:'oil',              key:'startup_pct'},        // pump % (without sensor)
  oil_arm_min_bar:         {sec:'oil',              key:'startup_min_bar'},    // arm threshold (shared with StarterSpin)
  oil_startup_min_bar:     {sec:'oil',              key:'startup_min_bar'},    // same value, shown in StarterSpin context
  oil_arm_timeout_ms:      {sec:'sequence.startup', key:'oil_arm_timeout_ms'},
  starter_demand:          {sec:'sequence.startup', key:'starter_demand'},
  starter_timeout_ms:      {sec:'sequence.startup', key:'starter_timeout_ms'},
  temp_confirm_target:     {sec:'sequence.startup', key:'temp_confirm_target'},
  temp_confirm_timeout:    {sec:'sequence.startup', key:'temp_confirm_timeout'},
  pre_ign_rpm:             {sec:'sequence.startup', key:'pre_ign_rpm'},
  pre_ign_spark_ms:        {sec:'sequence.startup', key:'pre_ign_spark_ms'},
  flame_required_count:    {sec:'sequence.startup', key:'flame_required_count'},
  flame_check_interval_ms: {sec:'sequence.startup', key:'flame_check_interval_ms'},
  flame_timeout_ms:        {sec:'sequence.startup', key:'flame_timeout_ms'},
  rpm_target:              {sec:'sequence.startup', key:'rpm_target'},
  rpm_timeout_ms:          {sec:'sequence.startup', key:'rpm_timeout_ms'},
  safety_hold_ms:          {sec:'sequence.startup', key:'safety_hold_ms'},
  safety_hold_timeout_ms:  {sec:'sequence.startup', key:'safety_hold_timeout_ms'},
  final_check_n1_enabled:  {sec:'sequence.startup', key:'final_check_n1_enabled'},
  final_check_n2_enabled:  {sec:'sequence.startup', key:'final_check_n2_enabled'},
  final_check_p1_enabled:  {sec:'sequence.startup', key:'final_check_p1_enabled'},
  final_check_p2_enabled:  {sec:'sequence.startup', key:'final_check_p2_enabled'},
  final_check_oil_enabled: {sec:'sequence.startup', key:'final_check_oil_enabled'},
  final_check_egt_enabled: {sec:'sequence.startup', key:'final_check_egt_enabled'},
  final_check_flame_enabled:{sec:'sequence.startup', key:'final_check_flame_enabled'},
  final_check_n2_rpm:      {sec:'sequence.startup', key:'final_check_n2_rpm'},
  final_check_p1_bar:      {sec:'sequence.startup', key:'final_check_p1_bar'},
  final_check_p2_bar:      {sec:'sequence.startup', key:'final_check_p2_bar'},
  final_check_egt_c:       {sec:'sequence.startup', key:'final_check_egt_c'},
  final_check_rpm:         {sec:'sequence.startup', key:'final_check_rpm'},
  // shutdown params (doc.sequence.shutdown.*)
  rpm_drop_threshold:      {sec:'sequence.shutdown', key:'rpm_drop_threshold'},
  rpm_drop_timeout_ms:     {sec:'sequence.shutdown', key:'rpm_drop_timeout_ms'},
  tot_cooldown_target:     {sec:'engine',            key:'tot_cooldown_target'},
  cooldown_skip_hold_ms:   {sec:'misc',              key:'cooldown_skip_hold_ms'},
  cooldown_starter_pct:        {sec:'sequence.shutdown', key:'cooldown_starter_pct'},
  cooldown_oil_pct:            {sec:'sequence.shutdown', key:'cooldown_oil_pct'},
  cooldown_timeout_ms:         {sec:'sequence.shutdown', key:'cooldown_timeout_ms'},
  cooldown_use_starter:        {sec:'sequence.shutdown', key:'cooldown_use_starter'},
  cooldown_use_oil:            {sec:'sequence.shutdown', key:'cooldown_use_oil'},
  cooldown_oil_pressure_bar:   {sec:'sequence.shutdown', key:'cooldown_oil_pressure_bar'},
  final_stop_timeout_ms:   {sec:'sequence.shutdown', key:'final_stop_timeout_ms'},
  oil_scavenge_ms:         {sec:'sequence.shutdown', key:'oil_scavenge_ms'},
  rpm_zero_threshold:      {sec:'sequence.shutdown', key:'rpm_zero_threshold'},
  ramp_pct_per_s:          {sec:'starter_control', key:'startup_ramp_pct_per_s'},
  // new blocks
  timed_delay_ms:          {sec:'sequence.startup', key:'timed_delay_ms'},
  modified_idle_multiplier:{sec:'sequence.startup', key:'modified_idle_multiplier'},
  fuel_pulse_ms:           {sec:'sequence.startup', key:'fuel_pulse_ms'},
  fuel_off_ms:             {sec:'sequence.startup', key:'fuel_off_ms'},
  wait_tot_target:         {sec:'sequence.startup', key:'wait_tot_target'},
  wait_tot_timeout:        {sec:'sequence.startup', key:'wait_tot_timeout'},
  throttle_set_pct:        {sec:'sequence.startup', key:'throttle_set_pct'},
  oil_pump_on_pct:         {sec:'sequence.startup', key:'oil_pump_on_pct'},
  fp_idle_max_pct:         {sec:'throttle',         key:'idle_max_pct'},
  // FlameConfirm / SafetyHold exit action bools
  flame_turn_off_igniter:     {sec:'sequence.startup', key:'flame_turn_off_igniter'},
  safety_turn_off_starter:    {sec:'sequence.startup', key:'safety_turn_off_starter'},
  safety_turn_off_starter_en: {sec:'sequence.startup', key:'safety_turn_off_starter_en'},
  safety_turn_off_igniter:    {sec:'sequence.startup', key:'safety_turn_off_igniter'},
  // Spool / SafetyHold oil minimum (maps to Config::oilRunningMin - shared threshold)
  oil_running_min:              {sec:'oil',              key:'running_min'},
  // Spool exit action bools
  spool_cut_starter_on_exit:    {sec:'sequence.startup', key:'spool_cut_starter_on_exit'},
  spool_cut_starter_en_on_exit: {sec:'sequence.startup', key:'spool_cut_starter_en_on_exit'},
  // Oil scavenge pump sequence params
  oil_prime_use_scavenge: {sec:'sequence.startup', key:'oil_prime_use_scavenge'},
  cooldown_use_scavenge:  {sec:'sequence.shutdown', key:'cooldown_use_scavenge'},
  // Advanced block params (stored in cfg.sequence.startup and cfg.governor)
  fp2_start_pct:         {sec:'sequence.startup', key:'fp2_start_pct'},
  fp2_end_pct:           {sec:'sequence.startup', key:'fp2_end_pct'},
  fp2_ramp_ms:           {sec:'sequence.startup', key:'fp2_ramp_ms'},
  fp2_demand_pct:        {sec:'sequence.startup', key:'fp2_demand_pct'},
  gov_hold_timeout_ms:   {sec:'sequence.startup', key:'gov_hold_timeout_ms'},
  gov_hold_band_rpm:     {sec:'governor',         key:'band_rpm'},
  // AB sequence params (stored in cfg.afterburner.*)
  ab_min_n1:           {sec:'afterburner', key:'min_n1'},
  ab_max_n1:           {sec:'afterburner', key:'max_n1'},
  ab_max_tot_for_light:{sec:'afterburner', key:'max_tot_for_light'},
  ab_throttle_thr:     {sec:'afterburner', key:'throttle_threshold'},
  ab_use_torch:        {sec:'afterburner', key:'use_torch'},
  ab_use_igniter:      {sec:'afterburner', key:'use_igniter'},
  ab_torch_pct:        {sec:'afterburner', key:'torch_spike_pct'},
  ab_torch_ms:         {sec:'afterburner', key:'torch_duration_ms'},
  ab_torch_tl:         {sec:'afterburner', key:'torch_tot_limit'},
  ab_flame_mode:       {sec:'afterburner', key:'flame_mode'},
  ab_tot_rise:         {sec:'afterburner', key:'tot_rise_deg_c'},
  ab_tot_rise_win:     {sec:'afterburner', key:'tot_rise_window_ms'},
  ab_assume_ms:        {sec:'afterburner', key:'assume_ignited_ms'},
  ab_flame_timeout:    {sec:'afterburner', key:'flame_timeout_ms'},
  ab_stab_ms:          {sec:'afterburner', key:'stabilize_ms'},
  ab_stab_max_tot:     {sec:'afterburner', key:'stabilize_max_tot'},
  ab_pump_min_pct:     {sec:'afterburner', key:'pump_min_pct'},
  ab_pump_max_pct:     {sec:'afterburner', key:'pump_max_pct'},
  ab_main_offset:      {sec:'afterburner', key:'main_fuel_offset_pct'},
  // WaitForInput block params
  wait_for_input_ch:      {sec:'sequence.startup', key:'wait_for_input_ch'},
  wait_for_input_state:   {sec:'sequence.startup', key:'wait_for_input_state'},
  wait_for_input_timeout: {sec:'sequence.startup', key:'wait_for_input_timeout'},
};

// Available block names per tab
const STARTUP_BLOCKS = [
  'OilPrime','StarterSpin','SetOutput','PreHeat','FlameConfirm','TempConfirm',
  'TimedDelay','FuelPumpIdle','Spool','SafetyHold','WaitForInput'
];
const SHUTDOWN_BLOCKS    = [
  'ImmediateCut','RPMDrop','CooldownSpin','FinalStop','TimedDelay','SetOutput',
  'WaitTOTCool','WaitForInput','WaitForInputOff'
];
// AB ignition sequence blocks (ab_seq)
const AFTERBURNER_BLOCKS = [
  'ABCheckReady','SetOutput','ABIgnite','ABFlameConfirm','ABStabilize','TimedDelay',
];
// AB light-off sequence blocks (ab_shut_seq)
const AB_SHUT_BLOCKS = [
  'SetOutput','TimedDelay',
];

// User-defined custom blocks (stored in hwCfg.custom_blocks or local state)
const MAX_CUSTOM_BLOCKS = 8;
const MAX_CUSTOM_STEPS = 8;
const MAX_CUSTOM_KEY_LEN = 23;
const MAX_CUSTOM_LABEL_LEN = 31;
const MAX_CUSTOM_DESC_LEN = 95;
let customBlocks = {};

// ------ Block info map - describes what config each block uses ---------------------------------------------------
const BLOCK_INFO = {
  OilPrime: {
    desc: 'Turns the oil pump ON and waits until oil pressure exceeds the arm threshold. Safe to abort - no fuel or ignition active.',
    links: []
  },
  StarterSpin: {
    desc: 'Enables starter relay and ramps starter demand until N1 reaches pre-ignition RPM. Fault shutdown on timeout.',
    links: []
  },
  PreIgnSpark: {
    desc: 'Igniter-1-only spark. Prefer target-selectable Igniter On or Pre-Heat when the block should choose between multiple ignition outputs.',
    links: []
  },
  FuelOpen: {
    desc: 'Opens the main fuel shutoff and marks that combustion was attempted so Cooldown can run when needed.',
    links: []
  },
  FlameConfirm: {
    desc: 'Waits until the flame sensor fires N consecutive times. Can turn off all ignition outputs on exit.',
    links: [
      { label: 'Combustion-Loss Confirmation Time', url: '/controllers.html#safety-monitor' },
    ]
  },
  TempConfirm: {
    desc: 'Waits until selected EGT rises above the configured threshold. Alternative to FlameConfirm when no flame sensor is fitted.',
    links: [
      { label: 'Engine Temperature Source', url: '/controllers.html#engine-limits' },
    ]
  },
  Spool: {
    desc: 'Holds main fuel at the calibrated minimum reliable metering output and waits for N1 to reach the idle-entry target. Flame monitoring remains active.',
    links: [
      { label: 'Minimum Reliable Fuel-Metering Output', url: '/calibration.html#fuelpump-min-cal-row' },
      { label: 'Throttle Open Speed', url: '/controllers.html#throttle' },
      { label: 'Running Oil Min',     url: '/controllers.html#oil-config-section' },
    ]
  },
  SafetyHold: {
    desc: 'Requires all enabled final sensor checks to remain continuously stable before RUNNING. Optional exit actions can turn off starter and ignition outputs.',
    links: [
      { label: 'Min RPM',         url: '/controllers.html#engine-limits' },
      { label: 'Running Oil Min', url: '/controllers.html#oil-config-section' },
    ]
  },
  CooldownSpin: {
    desc: 'Spins starter and/or runs oil pump to cool EGT below target temperature. Skipped if fuel was never opened.',
    links: []
  },
  FinalStop: {
    desc: 'Waits for N1 to reach zero. Oil pump cuts; scavenge pump continues if configured.',
    links: []
  },
  RPMDrop: {
    desc: 'Waits for N1 to fall below threshold RPM before proceeding to cooldown. Continues on timeout.',
    links: [
      { label: 'Min RPM', url: '/controllers.html#engine-limits' },
    ]
  },
  ImmediateCut: {
    desc: 'Emergency cut: zeros all main/start/afterburner fuel demands, closes fuel valves, and turns off ignition and starter outputs instantly.',
    links: []
  },
  FuelPumpIdle: {
    desc: 'Maps idle input (pot or RC) from the calibrated minimum reliable fuel-metering output up to maximum metering output. The minimum is edited on Calibration.',
    links: [
      { label: 'Minimum Reliable Fuel-Metering Output', url: '/calibration.html#fuelpump-min-cal-row' },
    ]
  },
  ModifiedIdle: {
    desc: 'Sets main-fuel demand from the calibrated minimum reliable metering output to the configured maximum idle output, then applies the multiplier.',
    links: [
      { label: 'Minimum Reliable Fuel-Metering Output', url: '/calibration.html#fuelpump-min-cal-row' },
      { label: 'Throttle Idle Max %', url: '/controllers.html#throttle' },
    ]
  },
  TimedDelay: {
    desc: 'Pauses the sequence for the configured duration. No actuator changes.',
    links: []
  },
  PreHeat: {
    desc: 'Turns the selected ignition output on for a fixed duration without opening fuel.',
    links: [{ label: 'Configure ignition device', url: '/hardware.html#registry-outputs' }]
  },
  ABCheckReady: {
    desc: 'Gate block: checks N1, selected EGT, and throttle conditions before proceeding with AB ignition.',
    links: []
  },
  ABIgnite: {
    desc: 'Fires AB ignition - torch (fuel spike through turbine), AB igniter, or both.',
    links: [
      { label: 'Afterburner Ignition Method', url: '/controllers.html#ab-ign-section' },
    ]
  },
  ABFlameConfirm: {
    desc: 'Waits for AB flame confirmation using sensor, selected EGT rise, or timed mode.',
    links: [
      { label: 'AB Flame Confirmation Config', url: '/controllers.html#ab-flame-section' },
    ]
  },
  ABStabilize: {
    desc: 'Hold period after AB lights. Monitors selected EGT - faults if too hot. Transitions to AB Running on exit.',
    links: [
      { label: 'AB Running Config', url: '/controllers.html#ab-run-section' },
    ]
  },
  GlowPreheat: {
    desc: 'Runs the selected glow plug\'s device-local preheat profile. A wet glow plug also commands its own paired pilot-fuel output.',
    links: [{ label: 'Configure glow-plug device', url: '/hardware.html#registry-outputs' }]
  },
  GovernorHold: {
    desc: 'Waits until N2 is within bandRpm of the governor target RPM before completing.',
    links: [
      { label: 'Automatic N2 Speed Control', url: '/controllers.html#governor-cfg-section' },
    ]
  },
  FuelPumpRamp: {
    desc: 'Ramps secondary / auxiliary fuel pump demand linearly from startPct to endPct over rampMs.',
    links: []
  },
  FuelPump2Set: {
    desc: 'Sets secondary / auxiliary fuel pump demand to a fixed value immediately.',
    links: []
  },
  FuelPump2On: {
    desc: 'Switches relay-type secondary / auxiliary fuel pump on.',
    links: []
  },
  FuelPump2Off: {
    desc: 'Switches relay-type secondary / auxiliary fuel pump off.',
    links: []
  },
};

// ------ Block info panel ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
let _openBlockInfoPanel = null;

function showBlockInfo(bname, trigger) {
  const card = trigger?.closest('.block-card');
  const panel = card?.querySelector('.block-info-panel');
  if (!panel) return;

  if (_openBlockInfoPanel === panel && !panel.hidden) {
    hideBlockInfo(panel);
    return;
  }

  hideBlockInfo();
  const def = BLOCKS[bname] || {};
  const info = BLOCK_INFO[bname] || { desc: def.desc || 'This block is configured entirely within the sequence.', links: [] };
  const missingGlowHardware = bname === 'GlowPreheat' && !actuatorEnabled('glow_plug');
  const infoLinks = missingGlowHardware
    ? [{label:'Install or configure Glow Plug hardware', url:'/hardware.html#registry-outputs'}]
    : (info.links || []);
  const linksHtml = infoLinks.length
    ? `<div class="bip-links-label">${missingGlowHardware ? 'Hardware required:' : 'Config fields used:'}</div><div class="bip-links">` +
      infoLinks.map(l => `<a class="bip-link" href="${l.url}">${l.label}</a>`).join('') +
      '</div>'
    : '<div class="bip-links-label" style="color:var(--dim)">No external config fields - all parameters are set directly on this block.</div>';
  panel.innerHTML = `
    <div class="bip-header">
      <span class="bip-name">${def.label ?? bname}</span>
      <button type="button" class="bip-close" aria-label="Close block explanation" onclick="hideBlockInfo(this.closest('.block-info-panel'))">Close</button>
    </div>
    <div class="bip-desc">${info.desc}</div>
    ${linksHtml}`;
  panel.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  trigger.classList.add('active');
  _openBlockInfoPanel = panel;
}

function hideBlockInfo(panel = _openBlockInfoPanel) {
  if (!panel) return;
  panel.hidden = true;
  const trigger = panel.closest('.block-card')?.querySelector('.bip-btn');
  if (trigger) {
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('active');
  }
  if (_openBlockInfoPanel === panel) _openBlockInfoPanel = null;
}
