// ── Config schema — maps UI field key → JSON path + metadata ──
const ALL_CONFIG_SCHEMA = [
  { title: 'Engine Protection Limits', id: 'engine-limits', sectionNote:'N1 is the gas-generator or core shaft speed. TOT is turbine-outlet temperature; TIT is turbine-inlet temperature. Choose the temperature measurement used by your engine documentation.', fields: [
    { key:'rpm_limit',          path:['engine','rpm_limit'],          label:'Maximum N1 Speed', unit:'RPM', desc:'Hard overspeed limit for the gas-generator/core shaft. Used only when an N1 sensor is fitted.', step:1000, min:1000, basic:true },
    { key:'n2_rpm_limit',       path:['engine','n2_rpm_limit'],       label:'Maximum N2 Speed', unit:'RPM', zeroOff:true, desc:'Independent hard shutdown limit for the free power-turbine/output shaft. This is separate from gradual N2 throttle pullback. Used only when N2 overspeed safety is enabled in Hardware.', step:1000, min:0, basic:true },
    { key:'min_rpm',            path:['engine','min_rpm'],            label:'Minimum Running N1 Speed', unit:'RPM', zeroOff:true, desc:'Lowest N1 speed accepted after startup. Falling below it causes an underspeed shutdown. Set 0 to disable this independent underspeed check when N1 is informational only.', step:1000, min:0, basic:true },
    { key:'eg_src',             path:['safety','egt_source'],         label:'Primary Engine Temperature', type:'select', options:[{v:0,l:'Automatic: TOT if fitted, otherwise TIT'},{v:1,l:'Turbine outlet temperature (TOT)'},{v:2,l:'Turbine inlet temperature (TIT)'}], desc:'Temperature used for over-temperature protection, hot-start prevention, cooldown, throttle reduction, and flame confirmation.', basic:true },
    { key:'tot_limit',          path:['engine','tot_limit'],          label:'Outlet Temperature Limit (TOT)', unitType:'temp', zeroOff:true, desc:'Hard limit for turbine-outlet temperature. Active only when TOT is the primary engine temperature. 0 disables this limit.', step:10, min:0, basic:true },
    { key:'sf_tit',             path:['safety','tit_limit_c'],        label:'Inlet Temperature Limit (TIT)', unitType:'temp', zeroOff:true, wrapId:'field-sf-tit', desc:'Hard limit for turbine-inlet temperature. Active only when TIT is the primary engine temperature. 0 disables this limit.', step:10, min:0, basic:true },
    { key:'sf_p1t',             path:['safety','p1_trip_bar'],        label:'P1 High-Pressure Shutdown', unitType:'press', zeroOff:true, desc:'Stops fuel when P1 rises above this pressure for the configured confirmation time. 0 disables the P1 high-pressure trip.', step:0.1, min:0, max:1000, basic:true },
    { key:'sf_p2t',             path:['safety','p2_trip_bar'],        label:'P2 High-Pressure Shutdown', unitType:'press', zeroOff:true, desc:'Stops fuel when P2 rises above this pressure for the configured confirmation time. 0 disables the P2 high-pressure trip.', step:0.1, min:0, max:1000, basic:true },
    { key:'sf_tqt',             path:['safety','torque_trip_nm'],     label:'Shaft-Torque Hard Shutdown', unit:'Nm', zeroOff:true, desc:'Stops fuel when measured shaft torque remains above this independent limit for the configured confirmation time. 0 disables the torque hard trip.', step:1, min:0, max:1000000 },
    { key:'sf_p1d',             path:['safety','p1_trip_confirm_ms'], label:'Pressure 1 Hard-Trip Confirmation (ms)', desc:'Pressure 1 must remain above its hard limit for this long before shutdown. 0 is immediate.', step:25, min:0, max:60000 },
    { key:'sf_p2d',             path:['safety','p2_trip_confirm_ms'], label:'Pressure 2 Hard-Trip Confirmation (ms)', desc:'Pressure 2 must remain above its hard limit for this long before shutdown. 0 is immediate.', step:25, min:0, max:60000 },
    { key:'sf_tqd',             path:['safety','torque_trip_confirm_ms'], label:'Torque Hard-Trip Confirmation (ms)', desc:'Measured shaft torque must remain above its hard limit for this long before shutdown. 0 is immediate.', step:25, min:0, max:60000 },
    { key:'tot_safe_margin',    path:['engine','tot_safe_margin'],    label:'Temperature Warning Margin', unitType:'temp_delta', desc:'Distance below the active hard temperature limit where warnings and gradual throttle reduction begin.', step:5, min:0, basic:true },
  ]},
  { title: 'Oil Pressure Control', id: 'oil-config-section', sectionNote:'Normal pressure-controller behavior for the primary oil system. Additional oil-system targets and pump limits stay in their individual controller cards above.', fields: [
    { key:'oil_tm',  path:['oil','use_throttle_map'],   label:'Increase Oil Pressure with Throttle', desc:'Raise the oil-pressure target as throttle increases. Leave disabled for one constant running target.', type:'checkbox' },
    { key:'oil_mm',  path:['oil','map_min'],            label:'Normal Running Oil Pressure', unitType:'press', desc:'Target at idle and throughout running when throttle-based pressure is disabled. Keep it above the low-pressure shutdown value.', step:0.1, min:0, max:20, basic:true },
    { key:'oil_mx',  path:['oil','map_max'],            label:'Full-Throttle Oil Pressure', unitType:'press', desc:'Target at full throttle when throttle-based pressure is enabled.', step:0.1, min:0, max:20, wrapId:'field-oil_mx' },
    { key:'oil_as',  path:['oil','adjust_scale'],       label:'Oil Pressure Response Gain', desc:'How strongly pump output reacts to pressure error. Higher responds faster but can oscillate. Technical name: proportional or P gain.', step:0.05,min:0 },
    { key:'oil_mp',  path:['oil','min_pct'],            label:'Minimum Automatic Pump Output (%)', desc:'Lowest output used by automatic pressure regulation. Startup steps can still command a higher output.', step:1, min:0, max:100 },
    { key:'oa_db',   path:['oil_advanced','deadband_bar'], label:'No-Correction Pressure Band', unitType:'press', desc:'No small pump corrections are made while pressure is within this distance of the target. Technical name: deadband.', step:0.05, min:0 },
    { key:'oil_fd',  path:['oil','failsafe_delay_ms'],  label:'Pressure-Sensor Fault Delay (ms)', desc:'How long invalid oil-pressure feedback is tolerated before automatic pressure regulation stops and the fixed fallback output below takes over.', step:100, min:0 },
    { key:'oil_fp',  path:['oil','failsafe_pct'],       label:'Fixed Pump Output After Pressure-Sensor Failure (%)', desc:'Open-loop pump output used after oil-pressure feedback has remained invalid for the fault delay above. This is separate from windmilling protection.', step:5, min:0, max:100 },
  ]},
  { title: 'Oil Pressure Safety', id: 'oil-safety-section', sectionNote:'Independent oil-pressure, current, and flow protections. Startup oil requirements remain in the startup Sequence blocks where they act.', fields: [
    { key:'oil_rm',  path:['oil','running_min'],        label:'Running Low-Pressure Shutdown', unitType:'press', desc:'Protects against insufficient but still measurable lubrication while RUNNING. The ECU shuts down only after pressure stays below this value for the Low-Oil Confirmation time.', step:0.1, min:0, max:20, basic:true },
    { key:'oil_zb',  path:['oil_advanced','zero_bar'],  label:'No-Pressure Shutdown Threshold', unitType:'press', desc:'A faster catastrophic-loss check for pressure at or near zero, such as a stopped pump or broken line. Set this below the normal low-pressure threshold and use its shorter confirmation time.', step:0.05, min:0 },
    { key:'sf_lo_d', path:['safety','low_oil_confirm_ms'], label:'Low-Oil Confirmation (ms)', desc:'Oil pressure must remain below the running shutdown value for this long before shutdown. 0 is immediate.', step:50, min:0, max:60000 },
    { key:'sf_oz_d', path:['safety','oil_zero_confirm_ms'], label:'Near-Zero Oil Confirmation (ms)', desc:'Catastrophic near-zero oil pressure must persist for this time. Keep this shorter than the normal low-oil confirmation.', step:25, min:0, max:60000 },
    { key:'oil_ufd', path:['oil_advanced','pump_underflow_delay_ms'], label:'Low Oil-Flow Confirmation Delay (ms)', desc:'How long a monitored main or scavenge pump may remain below its own Hardware minimum-flow value before the ECU confirms a flow fault.', step:100, min:100, max:60000 },
    { key:'oil_ufs', path:['oil_advanced','shutdown_on_underflow'], label:'Shutdown on Confirmed Low Oil Flow', type:'checkbox', desc:'Off (default): report a warning and keep running. On: a confirmed low/no-flow fault requests an engine shutdown. Configure and test each pump flow meter in Hardware before enabling this.' },
  ]},
  { title: 'Throttle Response', id: 'throttle', sectionNote:'Normal operator-demand shaping and output movement limits. These settings do not replace independent hard engine shutdowns.', fields: [
    { key:'th_ru', path:['throttle','ramp_up_ms'],   label:'Full Opening Time (ms)', desc:'Time for the fuel/throttle output to move from 0 to 100%. A larger value opens more gently.', step:50, min:0, basic:true },
    { key:'th_rd', path:['throttle','ramp_down_ms'], label:'Full Closing Time (ms)', desc:'Time for the fuel/throttle output to move from 100% to 0. A smaller value closes faster.', step:50, min:0, basic:true },
    { key:'th_ex', path:['throttle','expo'],         label:'Low-Throttle Sensitivity', desc:'Softens response near idle while preserving full travel. 0 is linear; 1 is maximum softening. Technical name: throttle expo.', step:0.05, min:0, max:1 },
    { key:'pb_min', path:['throttle','pullback_min_pct'], label:'Minimum Fuel During Gradual Protection (%)', desc:'Common physical fuel floor for non-emergency gradual limiting. It prevents an enabled limiter from pulling the main engine below the user-tested stable minimum; STOP and hard shutdowns still cut fuel.', step:1, min:0, max:100 },
  ]},
  { title: 'Gradual Fuel Limit Protection', id: 'gradual-protection', sectionNote:'Optional non-emergency fuel reduction as a measured value approaches its configured boundary. Independent hard shutdown limits remain active and separate.', fields: [
    { key:'pb_n1e', path:['throttle','pullback_n1'], label:'Gradual N1 Limit Protection', type:'checkbox', desc:'Automatically reduce fuel as N1 approaches its configured limit.' },
    { key:'pb_n1s', path:['throttle','pullback_n1_soft_rpm'], label:'Begin N1 Throttle Reduction', unit:'RPM', desc:'N1 speed where gradual fuel reduction begins.', step:500, min:0, max:1000000000 },
    { key:'pb_n1h', path:['throttle','pullback_n1_hard_rpm'], label:'Full N1 Throttle Reduction', unit:'RPM', desc:'N1 speed where the gradual reduction reaches full authority. Hard shutdown protection remains separate.', step:500, min:0, max:1000000000 },
    { key:'pb_n1m', path:['throttle','pullback_n1_mode'], label:'N1 Reduction Method', type:'select', options:[{v:0,l:'Reactive — use current shaft speed'},{v:1,l:'Predictive — anticipate rising shaft speed'}], desc:'Predictive mode estimates where N1 will be after the selected look-ahead time and can reduce fuel before a rapidly accelerating shaft reaches the boundary.' },
    { key:'pb_n1l', path:['throttle','pullback_n1_lookahead_ms'], label:'N1 Prediction Time (ms)', desc:'How far into the future predictive N1 limiting projects the measured shaft acceleration.', step:100, min:0, max:5000 },
    { key:'pb_n1str', path:['throttle','pullback_n1_strength'], label:'N1 Reduction Strength', desc:'1.0 reaches the configured fuel floor at the full-reduction speed. Lower is gentler; higher reaches the floor sooner.', step:0.1, min:0, max:5 },
    { key:'pb_n2e', path:['throttle','pullback_n2'], label:'Gradual N2 Limit Protection', type:'checkbox', desc:'Automatically reduce fuel as the power-turbine/output shaft approaches its speed limit.' },
    { key:'pb_n2s', path:['throttle','pullback_n2_soft_rpm'], label:'Begin N2 Throttle Reduction', unit:'RPM', desc:'N2 speed where gradual fuel reduction begins.', step:500, min:0, max:1000000000 },
    { key:'pb_n2h', path:['throttle','pullback_n2_hard_rpm'], label:'Full N2 Throttle Reduction', unit:'RPM', desc:'N2 speed where gradual reduction reaches full authority.', step:500, min:0, max:1000000000 },
    { key:'pb_n2m', path:['throttle','pullback_n2_mode'], label:'N2 Reduction Method', type:'select', options:[{v:0,l:'Reactive — use current shaft speed'},{v:1,l:'Predictive — anticipate rising shaft speed'}], desc:'Predictive mode projects the power-turbine/output-shaft speed from its own acceleration and timing; it is independent of N1 tuning.' },
    { key:'pb_n2l', path:['throttle','pullback_n2_lookahead_ms'], label:'N2 Prediction Time (ms)', desc:'How far into the future predictive N2 limiting projects measured shaft acceleration.', step:100, min:0, max:5000 },
    { key:'pb_n2str', path:['throttle','pullback_n2_strength'], label:'N2 Reduction Strength', desc:'Strength of N2 fuel reduction within its configured band.', step:0.1, min:0, max:5 },
    { key:'pb_egte', path:['throttle','pullback_egt'], label:'Gradual Temperature Protection', type:'checkbox', desc:'Automatically reduce fuel as the selected engine temperature approaches its limit.' },
    { key:'pb_egts', path:['throttle','pullback_egt_soft_c'], label:'Begin Temperature Reduction', unitType:'temp', desc:'Temperature where gradual fuel reduction begins.', step:10, min:0, max:100000 },
    { key:'pb_egth', path:['throttle','pullback_egt_hard_c'], label:'Full Temperature Reduction', unitType:'temp', desc:'Temperature where gradual reduction reaches full authority.', step:10, min:0, max:100000 },
    { key:'pb_egtm', path:['throttle','pullback_egt_mode'], label:'Temperature Reduction Method', type:'select', options:[{v:0,l:'Reactive — use current temperature'},{v:1,l:'Predictive — anticipate temperature rise'}], desc:'Predictive mode uses the measured temperature rise rate. Temperature sensors are often slower than shaft sensors, so this timing is intentionally separate.' },
    { key:'pb_egtl', path:['throttle','pullback_egt_lookahead_ms'], label:'Temperature Prediction Time (ms)', desc:'How far ahead predictive temperature limiting projects the current rise rate.', step:100, min:0, max:5000 },
    { key:'pb_egtstr', path:['throttle','pullback_egt_strength'], label:'Temperature Reduction Strength', desc:'Strength of temperature-based fuel reduction within its configured band.', step:0.1, min:0, max:5 },
    { key:'pb_p1e', path:['throttle','pullback_p1'], label:'Gradual P1 Pressure Protection', type:'checkbox', desc:'Reduce fuel as P1 approaches its configured full-reduction value.' },
    { key:'pb_p1s', path:['throttle','pullback_p1_soft_bar'], label:'Begin P1 Fuel Reduction', unitType:'press', desc:'P1 pressure where gradual fuel reduction begins. Set it below the full-reduction pressure and below any independent P1 hard shutdown.', step:0.1, min:0, max:1000 },
    { key:'pb_p1h', path:['throttle','pullback_p1_hard_bar'], label:'Full P1 Fuel Reduction', unitType:'press', desc:'P1 pressure where gradual protection reaches its configured maximum fuel reduction. The independent P1 shutdown limit can still cut fuel completely.', step:0.1, min:0, max:1000 },
    { key:'pb_p1m', path:['throttle','pullback_p1_mode'], label:'Pressure 1 Reduction Method', type:'select', options:[{v:0,l:'Reactive — use current pressure'},{v:1,l:'Predictive — anticipate pressure rise'}], desc:'Predictive mode projects this user-named pressure input from its measured rate of rise.' },
    { key:'pb_p1l', path:['throttle','pullback_p1_lookahead_ms'], label:'Pressure 1 Prediction Time (ms)', desc:'Look-ahead used only for this pressure input.', step:100, min:0, max:5000 },
    { key:'pb_p1str', path:['throttle','pullback_p1_strength'], label:'Pressure 1 Reduction Strength', desc:'Strength of this pressure input’s fuel reduction.', step:0.1, min:0, max:5 },
    { key:'pb_p2e', path:['throttle','pullback_p2'], label:'Gradual P2 Pressure Protection', type:'checkbox', desc:'Reduce fuel as P2 approaches its configured full-reduction value.' },
    { key:'pb_p2s', path:['throttle','pullback_p2_soft_bar'], label:'Begin P2 Fuel Reduction', unitType:'press', desc:'P2 pressure where gradual fuel reduction begins. Set it below the full-reduction pressure and below any independent P2 hard shutdown.', step:0.1, min:0, max:1000 },
    { key:'pb_p2h', path:['throttle','pullback_p2_hard_bar'], label:'Full P2 Fuel Reduction', unitType:'press', desc:'P2 pressure where gradual protection reaches its configured maximum fuel reduction. The independent P2 shutdown limit can still cut fuel completely.', step:0.1, min:0, max:1000 },
    { key:'pb_p2m', path:['throttle','pullback_p2_mode'], label:'Pressure 2 Reduction Method', type:'select', options:[{v:0,l:'Reactive — use current pressure'},{v:1,l:'Predictive — anticipate pressure rise'}], desc:'Predictive mode projects this user-named pressure input independently from Pressure 1.' },
    { key:'pb_p2l', path:['throttle','pullback_p2_lookahead_ms'], label:'Pressure 2 Prediction Time (ms)', desc:'Look-ahead used only for this pressure input.', step:100, min:0, max:5000 },
    { key:'pb_p2str', path:['throttle','pullback_p2_strength'], label:'Pressure 2 Reduction Strength', desc:'Strength of this pressure input’s fuel reduction.', step:0.1, min:0, max:5 },
    { key:'pb_tqe', path:['throttle','pullback_torque'], label:'Gradual Shaft-Torque Protection', type:'checkbox', desc:'Reduce fuel as measured shaft torque approaches its configured full-reduction value.' },
    { key:'pb_tqs', path:['throttle','pullback_torque_soft_nm'], label:'Begin Torque Fuel Reduction', unit:'Nm', desc:'Measured shaft torque where gradual fuel reduction begins. Set it below the full-reduction torque and below any independent torque hard shutdown.', step:1, min:0, max:1000000 },
    { key:'pb_tqh', path:['throttle','pullback_torque_hard_nm'], label:'Full Torque Fuel Reduction', unit:'Nm', desc:'Measured shaft torque where gradual protection reaches its configured maximum fuel reduction. The independent torque shutdown can still cut fuel completely.', step:1, min:0, max:1000000 },
    { key:'pb_tqm', path:['throttle','pullback_torque_mode'], label:'Torque Reduction Method', type:'select', options:[{v:0,l:'Reactive — use current torque'},{v:1,l:'Predictive — anticipate torque rise'}], desc:'Predictive mode projects measured shaft torque from its own rate of rise.' },
    { key:'pb_tql', path:['throttle','pullback_torque_lookahead_ms'], label:'Torque Prediction Time (ms)', desc:'Look-ahead used only for measured shaft torque.', step:100, min:0, max:5000 },
    { key:'pb_tqstr', path:['throttle','pullback_torque_strength'], label:'Torque Reduction Strength', desc:'Strength of torque-based fuel reduction within its band.', step:0.1, min:0, max:5 },
    { key:'rl_ramp', path:['throttle','pullback_near_limit_rampup_ms'], label:'Near-Limit Full Opening Time (ms)', desc:'Slower full-opening time used near the predicted speed limit. Larger values make the approach gentler.', step:100, min:0 },
    { key:'rl_zone', path:['throttle','pullback_approach_zone_rpm'], label:'Begin Prediction This Far Below Limit (RPM)', desc:'Distance below the gradual limit where the ECU starts slowing fuel increases. 0 chooses this distance automatically.', step:500, min:0 },
    { key:'rl_acc', path:['throttle','rpm_accel_filter'], label:'Speed-Change Smoothing (0-1)', desc:'Smooths the estimated rate of RPM change. Lower values are steadier but slower; higher values react faster but pass more sensor noise.', step:0.01, min:0.02, max:1 },
  ]},
  { title: 'Reduced-Power Mode', id:'reduced-power-section', sectionNote:'This one cap is shared by manual Reduced-Power Mode and the automatic response to losing feedback required by an enabled shaft controller or safety protection. Sensor loss turns Reduced-Power Mode on; it does not create a separate hidden limit.', fields: [
    { key:'lm_mt', path:['limp_mode','max_throttle_pct'], label:'Maximum Fuel Output (%)', desc:'Shared main-fuel cap when Reduced-Power Mode is turned on from Tools or a configured switch, or automatically because feedback used by an enabled protection/controller becomes unhealthy. A high value also permits higher fuel after that safety feedback is lost.', step:5, min:0, max:100, basic:true },
  ]},
  { title: 'Idle', id:'idle-control-cfg-section', sectionNote:'Idle is the minimum normal-running fuel authority. Its calibrated low end comes from Hardware; Automatic Idle may raise that floor to hold selected shaft-speed or pressure feedback.', fields: [
    { key:'th_mx', path:['throttle','idle_max_pct'], label:'Maximum Normal Idle Fuel Output (%)', desc:'Highest fuel output available to the idle layer. The low end is the calibrated Minimum Reliable Fuel-Metering Output from Calibration. Shutdown, STOP, and hard safety may still command zero.', step:1, min:0, max:100, basic:true },
    { key:'di_src', path:['dynamic_idle','source'], label:'Idle Feedback Source', type:'select', options:[{v:0,l:'N1 core speed (normal / proven)'},{v:1,l:'N2 output-shaft speed (normal / proven)'},{v:2,l:'P1 pressure (experimental)'},{v:3,l:'P2 pressure (experimental)'}], desc:'N1/N2 speed feedback is the normal proven approach. Pressure feedback is available for experimental turbine arrangements and requires careful stand validation.', basic:true },
    { key:'di_tr', path:['dynamic_idle','target_rpm'],    label:'Idle Target (N1/N2)', unit:'RPM', desc:'Used when the selected feedback source is N1 or N2.', step:500, min:0, basic:true },
    { key:'di_tp', path:['dynamic_idle','target_pressure_bar'], label:'Idle Target (P1/P2)', unitType:'press', desc:'Used when the selected feedback source is P1 or P2.', step:0.01, min:0, max:1000, basic:true },
    { key:'di_ru', path:['dynamic_idle','ramp_up_ms'],    label:'Fuel Increase Time (ms)', desc:'How quickly automatic idle control may increase fuel.', step:500, min:0 },
    { key:'di_rd', path:['dynamic_idle','ramp_down_ms'],  label:'Fuel Decrease Time (ms)', desc:'How quickly automatic idle control may reduce fuel.', step:500, min:0 },
    { key:'di_db', path:['dynamic_idle','deadband_rpm'],  label:'No-Correction Band (N1/N2)', unit:'RPM', desc:'Used for an N1/N2 feedback source.', step:100, min:0 },
    { key:'di_rl', path:['dynamic_idle','rpm_limit'],     label:'Stop Controlling Above (N1/N2)', unit:'RPM', desc:'Used for an N1/N2 feedback source. 0 = Disabled - no automatic idle control.', step:1000, min:0 },
    { key:'di_pd', path:['dynamic_idle','pressure_deadband_bar'], label:'No-Correction Band (P1/P2)', unitType:'press', desc:'Used for a P1/P2 feedback source.', step:0.01, min:0, max:1000 },
    { key:'di_pl', path:['dynamic_idle','pressure_limit_bar'], label:'Stop Controlling Above (P1/P2)', unitType:'press', desc:'Used for a P1/P2 feedback source. 0 = Disabled - no automatic idle control.', step:0.1, min:0, max:1000 },
    { key:'di_mx', path:['dynamic_idle','max_multiplier'],label:'Maximum Fuel Range Multiplier', desc:'Allows the controller extra fuel authority above the configured maximum idle output.', step:0.05, min:1, max:3 },
    { key:'di_ig', path:['dynamic_idle','i_gain'],       label:'Long-Term Correction Strength', desc:'Removes a persistent speed error caused by changing accessory load. 0 disables this correction. Start small: 0.05–0.15. Technical name: integral gain.', step:0.01, min:0, max:2 },
    { key:'di_im', path:['dynamic_idle','i_max'],        label:'Maximum Long-Term Correction', desc:'Limits how much fuel the long-term correction may add or remove. 0.10 means 10% of the available fuel range.', step:0.01, min:0, max:0.5 },
    { key:'di_mode', path:['dynamic_idle','idle_mode'], label:'Idle-Control Method', type:'select', options:[{v:0,l:'Standard idle control (default)'},{v:1,l:'Predictive fast-deceleration control'}], desc:'Standard control corrects present feedback error and does not apply a predictive fuel drop. Predictive control adds optional learned fast-deceleration behavior.' },
    { key:'di_de', path:['dynamic_idle','decel_enter_rpm'], label:'Fast-Deceleration Entry Above Target (RPM)', zeroOff:true, desc:'Predictive deceleration catch can begin when RPM is at least this far above idle. 0 disables the fast-deceleration fuel drop.', step:100, min:0 },
    { key:'di_dd', path:['dynamic_idle','decel_drop_pct'], label:'Fast-Deceleration Fuel Reduction (%)', zeroOff:true, desc:'How far below learned steady-idle fuel the controller may drop. 0 disables the fast-deceleration fuel drop.', step:0.5, min:0 },
    { key:'di_lk', path:['dynamic_idle','lookahead_ms'], label:'Idle Speed Prediction Time (ms)', desc:'How far ahead predictive idle control estimates shaft speed.', step:100, min:0 },
    { key:'di_sb', path:['dynamic_idle','settle_band_rpm'], label:'Settled Speed Band (RPM)', desc:'The ECU considers idle stable and learns the required fuel output while RPM is within this distance of target.', step:100, min:0 },
    { key:'di_fr', path:['dynamic_idle','full_response_rpm'], label:'Speed Error for Full Correction (RPM)', desc:'RPM error where automatic idle control reaches its maximum correction rate.', step:500, min:0 },
    { key:'di_tu', path:['dynamic_idle','trim_up_pct_s'], label:'Maximum Fuel Correction Increase (%/s)', desc:'Fastest rate at which predictive idle control may add fuel.', step:0.5, min:0 },
    { key:'di_td', path:['dynamic_idle','trim_down_pct_s'], label:'Maximum Fuel Correction Decrease (%/s)', desc:'Fastest rate at which predictive idle control may remove fuel.', step:0.5, min:0 },
    { key:'di_lr', path:['dynamic_idle','learn_rate'], label:'Steady-Idle Learning Speed (0-1)', desc:'How quickly the learned steady-idle fuel output adapts after speed settles. Smaller values are steadier.', step:0.01, min:0 },
    { key:'di_la', path:['dynamic_idle','learn_accel_max'], label:'Maximum Speed Change While Learning (RPM/s)', desc:'The ECU learns steady-idle fuel only while RPM is changing more slowly than this value.', step:100, min:0 },
    { key:'di_pde', path:['dynamic_idle','pressure_decel_enter_bar'], label:'Catch Entry Above Target', unitType:'press', zeroOff:true, desc:'Predictive pressure deceleration catch can begin this far above target. 0 disables the fast-deceleration fuel drop.', step:0.01, min:0 },
    { key:'di_psb', path:['dynamic_idle','pressure_settle_band_bar'], label:'Settled Pressure Band', unit:'bar', desc:'Pressure band in which the ECU may learn the steady-idle fuel demand.', step:0.01, min:0 },
    { key:'di_pfr', path:['dynamic_idle','pressure_full_response_bar'], label:'Pressure Error for Full Correction', unit:'bar', desc:'Pressure error where predictive idle reaches its configured correction rate.', step:0.01, min:0 },
    { key:'di_plr', path:['dynamic_idle','pressure_learn_rate_max_bar_s'], label:'Maximum Pressure Change While Learning', unit:'bar/s', desc:'Learning pauses while pressure changes faster than this value.', step:0.01, min:0 },
  ]},
  { title: 'Combustion & Startup Protection', id: 'safety-monitor', sectionNote:'Combustion-loss handling and temperature protection specifically for starting and running. Test sensor behavior before relying on automatic shutdowns.', fields: [
    { key:'sf_ci', path:['safety','check_interval_ms'],    label:'Safety Check Interval (ms)', desc:'How often general safety conditions are evaluated. Hard overspeed and current-delay timing run independently. Restricted to 10-250 ms so protection cannot be delayed by configuration.', step:10, min:10, max:250 },
    { key:'sf_fo', path:['safety','flameout_shutdown_ms'], label:'Combustion-Loss Confirmation Time (ms)', desc:'How long the selected signal must indicate flameout before the ECU declares a fault.', step:200, min:100, basic:true },
    { key:'sf_fs', path:['safety','flameout_source'],      label:'How Combustion Loss Is Detected', type:'select', options:[{v:0,l:'Best available: flame, then N1, then EGT'},{v:1,l:'Flame sensor reports no flame'},{v:2,l:'N1 speed falls too low'},{v:3,l:'Engine temperature falls'}], desc:'Signal used to decide that combustion has been lost while RUNNING. A flame sensor is the most direct evidence; N1 is the preferred fallback. EGT-only detection is available when neither is fitted.', basic:true },
    { key:'sf_fn', path:['safety','flameout_n1_min_rpm'],  label:'N1 Flameout RPM', desc:'For N1-source flameout: declare flameout if N1 stays below this RPM. 0 uses Min RPM. This is delayed by Flameout Delay.', step:1000, min:0, basic:true },
    { key:'sf_eb', path:['safety','flameout_egt_below_c'],  label:'Low EGT for Flameout', unitType:'temp', zeroOff:true, desc:'For EGT-source flameout: combustion loss is suspected when selected EGT is below this value and still falling while RUNNING. The condition must persist for the Combustion-Loss Confirmation Time. 0 disables this low-temperature condition.', step:10, min:0, basic:true },
    { key:'sf_ef', path:['safety','flameout_egt_fall_rate_c_s'], label:'Rapid EGT Fall for Flameout', unitType:'temp_rate', zeroOff:true, desc:'For EGT-source flameout: also suspect combustion loss if selected EGT falls faster than this rate, even before it reaches the low-EGT threshold. Default 50 °C/s. 0 disables this rapid-fall condition.', step:5, min:0, basic:true },
    { key:'sf_hs', path:['sequence','startup','pre_start_egt_limit_c'], label:'Pre-Start EGT Maximum', unitType:'temp', zeroOff:true, desc:'Blocks START when selected EGT is already above this value. This check occurs before fuel or ignition is commanded; it does not trip on the normal ignition temperature rise. 0 disables the hot-engine start interlock.', step:10, min:0, basic:true },
    { key:'sf_st', path:['sequence','startup','startup_egt_limit_c'], label:'Maximum EGT During Startup', unitType:'temp', zeroOff:true, desc:'Hard selected-EGT shutdown limit while the startup sequence is active. 0 uses the normal TOT/TIT hard limit, so startup remains protected. Set a separate value only when the engine manufacturer permits a different transient startup limit.', step:10, min:0, basic:true },
  ]},
  { title: 'Automatic Flameout Relight', id:'relight-section', sectionNote:'A flame sensor, N1, or the configured EGT conditions can trigger combustion-loss handling. Automatic relight additionally requires healthy N1 feedback and will never energize ignition below the minimum relight speed.', fields: [
    { key:'rl_en', path:['relight','enabled'],      label:'Attempt Automatic Relight', desc:'After combustion loss, try to restore flame before committing to shutdown.', type:'checkbox', basic:true },
    { key:'rl_it', path:['relight','ignition_target'], label:'Ignition Output to Use', type:'select', options:[{v:0,l:'Primary igniter'},{v:1,l:'Afterburner / secondary igniter'},{v:2,l:'Glow plug / wet glow'}], desc:'Output energized during the relight attempt.' },
    { key:'rl_cs', path:['relight','confirm_source'], label:'How Successful Relight Is Confirmed', type:'select', options:[{v:0,l:'Match the combustion-loss sensor'},{v:1,l:'Flame sensor detects flame'},{v:2,l:'N1 speed recovers'},{v:3,l:'Engine temperature rises'}], desc:'Signal that confirms combustion has returned and allows ignition to turn off.' },
    { key:'rl_mr', path:['relight','min_rpm'],            label:'Minimum N1 to Fire Relight Ignition', unit:'RPM', desc:'The ECU will not energize automatic relight below this healthy N1 speed or below Minimum Running N1, whichever is higher. If N1 falls below the effective floor during an attempt, ignition is cut and the engine shuts down. Choose a speed that proves adequate self-sustaining airflow.', step:1000, min:1, basic:true },
    { key:'rl_cr', path:['relight','confirm_rpm'],         label:'N1 Recovery Confirmation', unit:'RPM', desc:'For N1 relight confirmation: ignition stays on until healthy N1 reaches this explicit speed. Normally set this at or above the minimum firing speed and above the N1 flameout trigger.', step:1000, min:1, basic:true },
    { key:'rl_tr', path:['relight','tot_rise_c'],          label:'EGT Recovery Rise', unitType:'temp_delta', desc:'For EGT relight confirmation: igniter stays on until selected EGT rises this much above the temperature at relight start. 0 prevents EGT-rise confirmation. Set too low and EGT noise/throttle changes can false-confirm; too high can reject a real relight. Verify on a real start.', step:5, min:0, basic:true },
    { key:'rl_to', path:['relight','relight_timeout_ms'], label:'Relight Timeout (ms)',      desc:'Maximum relight time after a flameout. If combustion is not restored, ignition is cut and the engine shuts down. 0 uses the hard 30-second maximum; shorter configured values win.', step:100, min:0, max:30000 },
  ]},
  { title: 'ECU Runtime', sectionNote:'Advanced control-loop scheduling. Logging frequency and channel selection are configured on the Log page.', fields: [
    { key:'tm_lh', path:['telemetry','control_loop_hz'], label:'ECU Loop Target Hz', desc:'Main control-loop target frequency. Default 400 Hz. Lower values reduce CPU use; higher values improve control granularity but increase load. Recommended range: 200-500 Hz. Takes effect after a reboot.', step:50, min:50, max:1000, basic:true },
  ]},
  { title: 'External Instrument Cluster Display', sectionNote:'Enable the OT Cluster link above. These optional display-only thresholds change gauge warning colours and status messages; they do not trigger ECU shutdowns.', fields: [
    { key:'cl_n1', path:['cluster','n1_warn_rpm'],  label:'N1 Warn RPM',   desc:'N1 warning zone start on cluster gauge (yellow). 0 = auto (RPM Limit × 0.9). N1_MAX comes from Engine Limits → RPM Limit', step:500, min:0 },
    { key:'cl_n2', path:['cluster','n2_warn_rpm'],  label:'N2 Warn RPM',   desc:'N2 RPM warning threshold for cluster display', step:500, min:0 },
    { key:'cl_tw', path:['cluster','tot_warn_c'],   label:'EGT Warn',   unitType:'temp',  zeroOff:true, desc:'Selected engine-temperature warning threshold for cluster status. 0 = auto (selected EGT limit minus safety margin).', step:10, min:0 },
    { key:'cl_ow', path:['cluster','oil_warn_bar'], label:'Oil Warn',   unitType:'press', desc:'Oil pressure warning status code threshold. 0 = auto (running minimum)', step:0.1, min:0 },
  ]},
  { title: 'Pulsed Starter Assist', id: 'starter-support-section', sectionNote:'Optional low-speed startup aid for Bendix-drive, splined-coupling, and similar proportional starters. During StarterSpin it alternates the configured ON and OFF times until N1 reaches the assist threshold. The repeated torque impulses help the coupling engage. It then latches off and normal ramped starter control continues to the StarterSpin target. It never operates during RUNNING.', fields: [
    { key:'sa_en', path:['starter_control','pulsed_assist_enabled'], label:'Enable Pulsed Starter Assist', type:'checkbox', desc:'Allow StarterSpin to use low-speed pulses. Requires a servo/PWM starter and healthy N1 feedback. Relay/on-off starters are intentionally unsupported.', basic:true },
    { key:'sa_pc', path:['starter_control','pulsed_assist_pwm_pct'], label:'Assist Starter Output', unit:'%', desc:'Starter demand during each ON pulse. Verify this output with the STANDBY-only Tools test before attempting a start.', step:1, min:0, max:100, basic:true },
    { key:'sa_er', path:['starter_control','pulsed_assist_until_rpm'], label:'Assist Until N1 Speed', unit:'RPM', desc:'Once healthy N1 reaches this value, pulsing finishes for the current StarterSpin block and ordinary starter control continues. Normally set this below the StarterSpin target.', step:100, min:0, basic:true },
    { key:'sa_on', path:['starter_control','pulsed_assist_on_ms'], label:'Pulse ON Time', unit:'ms', desc:'How long the starter remains energized during each assist pulse.', step:10, min:1, max:60000 },
    { key:'sa_off', path:['starter_control','pulsed_assist_off_ms'], label:'Pulse OFF Time', unit:'ms', desc:'Rest time between assist pulses.', step:10, min:1, max:60000 },
  ]},
  { title: 'Windmilling Oil Protection', id:'windmilling-oil-section', sectionNote:'Runs the oil pump while a shaft is still turning in standby, for example from airflow, vehicle movement, or residual momentum after shutdown. It uses the fixed/floor output below when no pressure target is selected. With a pressure target, it uses the normal oil-pressure regulator and never commands less than that floor. For a 100,000 RPM core shaft, 1,000 RPM is a conservative starting threshold; raise it only above verified sensor noise.', fields: [
    { key:'so_src', path:['standby_oil','source'], label:'Shaft to Monitor', type:'select', options:[{v:0,l:'Core shaft (N1)'},{v:1,l:'Power/output shaft (N2)'},{v:2,l:'Either fitted shaft'}], desc:'Choose which shaft can automatically request protective oil flow.' },
    { key:'so_rl', path:['standby_oil','rpm_limit'], label:'Start Oil Pump Above', unit:'RPM', desc:'Oil protection starts when the selected shaft exceeds this speed while the ECU is in standby. Keep it below that shaft\'s maximum speed or the protection can never activate.', step:10, min:0 },
    { key:'so_fp', path:['standby_oil','feed_pct'],  label:'Windmilling Fixed / Minimum Pump Output (%)', desc:'Used as the fixed windmilling output when the pressure target is 0, or as the minimum pump output while pressure is regulated.', step:5, min:0, max:100 },
    { key:'so_fb', path:['standby_oil','feed_bar'],  label:'Optional Windmilling Oil Pressure Target', unitType:'press', desc:'Above 0: use the normal automatic oil-pressure regulator to hold this target, with the fixed/minimum output as its floor. At 0: command only the fixed output. Pressure mode requires a fitted oil-pressure sensor and Oil pressure loop enabled in Hardware.', step:0.1, min:0, max:20 },
  ]},
  { title: 'Manual Relight', id:'manual-relight-section', fields: [
    { key:'ms_it', path:['misc','igniter_on_start_target'], label:'START Relight Output', type:'select', options:[{v:0,l:'Igniter 1'},{v:1,l:'Secondary Igniter'},{v:2,l:'Glow / Wet Glow'}], desc:'Which configured ignition output is held on while START is held during RUNNING.' },
    { key:'ms_is', path:['misc','igniter_on_start'],      label:'Igniter on START (running)', desc:'Fire igniter while START button is held during RUNNING — manual relight aid. Disable if accidental button presses are a concern.', type:'checkbox' },
  ]},
  { title: 'RPM Sensor Fault Detection', fields: [
    { key:'rh_jt', path:['rpm_health','jump_threshold'],   label:'Maximum RPM Change Rate', desc:'Maximum plausible shaft acceleration or deceleration, expressed as a fraction of that shaft\'s configured RPM limit per second. Example: 0.40 with a 100,000 RPM limit allows 40,000 RPM/s (4,000 RPM between 100 ms samples). Jump checking starts only after the previous accepted reading is above 500 RPM, so the first rise from zero does not fault.', step:0.05, min:0.05, max:1 },
    { key:'rh_zs', path:['rpm_health','zero_stuck_ticks'], label:'Zero Readings Before Fault', desc:'Number of consecutive zero readings required before a running RPM sensor is declared stuck at zero.', step:1, min:1 },
  ]},
  { title: 'Afterburner — Ignition Method', id: 'ab-ign-section', fields: [
    { key:'ab_ut',   path:['afterburner','use_torch'],         label:'Use Torch',           type:'checkbox', desc:'Spike main fuel demand through the turbine section to push burning exhaust into the AB duct. Configure torch timing in the fields below.', basic:true },
    { key:'ab_ui',   path:['afterburner','use_igniter'],       label:'Use AB Igniter',      type:'checkbox', desc:'Fire the dedicated afterburner igniter installed in Hardware during the ignition window. Can be used alone or with torch.', basic:true },
    { key:'ab_tpct', path:['afterburner','torch_spike_pct'],   label:'Torch Spike %',       desc:'Extra main-fuel-metering demand during the torch window. Higher values introduce more fuel. Typical: 20–40%.', step:5, min:0, max:100 },
    { key:'ab_tms',  path:['afterburner','torch_duration_ms'], label:'Torch Duration (ms)', desc:'How long to hold the fuel spike before cutting back. Typical: 300–600 ms.', step:50, min:0, max:3000 },
    { key:'ab_tgm',  path:['afterburner','torch_guard_mode'],  label:'Torch Temperature Guard', type:'select', options:[{v:0,l:'Automatic margin below engine shutdown'},{v:1,l:'Custom torch-only cut'},{v:2,l:'Off — use engine shutdown only'}], desc:'Automatic is the simple default. Off removes only the extra torch pulse at the normal engine over-temperature shutdown.', basic:true },
    { key:'ab_ttl',  path:['afterburner','torch_tot_limit'],   label:'Custom Torch EGT Cut',  unitType:'temp', desc:'Used only in Custom mode. It should be below the configured main-engine temperature shutdown.', step:10, min:0 },
    { key:'ab_lpp',  path:['afterburner','lightup_pump_pct'],  label:'Light-Up Pump %', desc:'AB fuel pump demand used while the light-up sequence is trying to establish a confirmed flame.', step:5, min:0, max:100 },
  ]},
  { title: 'Afterburner — Flame Confirmation', id: 'ab-flame-section', fields: [
    { key:'ab_fm',  path:['afterburner','flame_mode'],          label:'Light-up Evidence',    type:'select', options:[{v:0,l:'Verified flame sensor OFF → ON'},{v:1,l:'EGT-rise verification'},{v:2,l:'Timed assumption — unverified'},{v:3,l:'Externally conditioned flame level'}], desc:'Verified sensor mode rejects an input already ON before fuel. External level mode is for a separate flame controller whose asserted level is itself trusted. Timed mode provides no flame evidence.', basic:true },
    { key:'ab_tr',  path:['afterburner','tot_rise_deg_c'],      label:'EGT Rise', unitType:'temp_delta', desc:'Minimum selected EGT rise required to confirm ignition (EGT Rise mode). Typical: 20-50 C. Too low can false-confirm on noise/throttle changes; too high can reject a real light. Verify on a real start.', step:5, min:0 },
    { key:'ab_tw',  path:['afterburner','tot_rise_window_ms'],  label:'EGT Rise Window (ms)',desc:'Time window in which the required EGT rise must occur (EGT Rise mode). Typical: 1500-3000 ms.', step:100, min:0 },
    { key:'ab_ams', path:['afterburner','assume_ignited_ms'],   label:'Unverified Timed Delay (ms)',desc:'Delay before continuing without verifying flame. This is not flame confirmation. Typical starting point: 1000-2000 ms, verified on a restrained test setup.', step:100, min:0 },
    { key:'ab_fto', path:['afterburner','flame_timeout_ms'],    label:'Confirmation Timeout (ms)', desc:'Overall deadline for flame confirmation. Exceeding this triggers an AB fault and shuts down the afterburner. Typical: 3000-5000 ms.', step:200, min:0, max:3600000 },
  ]},
  { title: 'Afterburner — Running', id: 'ab-run-section', fields: [
    { key:'ab_pcm', path:['afterburner','pump_control_mode'],     label:'Pump Command Source',   type:'select', options:[{v:0,l:'Fixed Max Output'},{v:1,l:'Follow Main Throttle'},{v:2,l:'Dedicated AB Input'}], desc:'Choose how AB pump flow is commanded while lit. Dedicated AB Input uses the analog, RC, PWM-duty, or registry/I2C AB command configured in Hardware.' },
    { key:'ab_pmn', path:['afterburner','pump_min_pct'],         label:'Afterburner Fuel Pump Min %', desc:'Minimum afterburner fuel-pump demand for a variable command source. With a missing servo-PWM afterburner input, demand fails to this minimum.', step:5, min:0, max:100 },
    { key:'ab_pmx', path:['afterburner','pump_max_pct'],         label:'Afterburner Fuel Pump Max %', desc:'Maximum afterburner fuel-pump demand. Fixed Max Output holds this value while the afterburner is running.', step:5, min:0, max:100 },
    { key:'ab_mo',  path:['afterburner','main_fuel_offset_pct'], label:'Main Fuel Offset %',    desc:'Adds to main fuel while AB is running. A negative value may reduce fuel, but a running pump is held at its calibrated reliable minimum; an Off command remains Off. 0 = none.', step:2, min:-20, max:50 },
    { key:'ab_sms', path:['afterburner','stabilize_ms'],         label:'Stabilize Hold (ms)',   desc:'Hold time after confirmed ignition before declaring the afterburner Running. Typical: 500-2000 ms.', step:100, min:0, max:3600000 },
    { key:'ab_smt', path:['afterburner','stabilize_max_tot'],    label:'Stabilize Max EGT',  unitType:'temp', zeroOff:true, desc:'AB faults if selected EGT exceeds this during the stabilize hold. 0 = disabled.', step:10, min:0, max:100000 },
    { key:'ab_fld', path:['afterburner','flame_loss_delay_ms'], label:'Running Flame-Loss Delay (ms)', desc:'When flame-sensor verification is selected, shut down only the afterburner if its flame signal is absent or unhealthy for this long while Running. Default 1000 ms. The main engine keeps running.', step:100, min:0, max:60000 },
  ]},
  { title: 'Auxiliary Protection', id: 'safety-ext-section', sectionNote:'Independent protection for supporting systems. Each enabled threshold is paired with its own confirmation time.', fields: [
    { key:'sf_ot',  path:['safety','oil_temp_limit_c'],         label:'Oil Temp Limit',     unitType:'temp',  zeroOff:true, desc:'Maximum oil temperature before fault shutdown. 0 = disabled. Typical limit: 120–150 °C / 250–300 °F depending on oil grade.',                                   step:5,    min:0, basic:true },
    { key:'sf_ot_d', path:['safety','oil_temp_confirm_ms'], label:'Oil-Temperature Confirmation (ms)', desc:'High oil temperature must persist for this time before shutdown.', step:100, min:0, max:60000 },
    { key:'sf_fp',  path:['safety','fuel_press_min_bar'],       label:'Minimum Running Fuel Pressure',     unitType:'press', desc:'Low fuel pressure fault threshold during RUNNING. 0 = disabled. Typical: 0.5–2.0 bar / 7–30 PSI depending on pump type.',                                     step:0.1,  min:0, basic:true },
    { key:'sf_fp_d', path:['safety','fuel_press_confirm_ms'], label:'Fuel-Pressure Confirmation (ms)', desc:'Low running fuel pressure must persist for this time before shutdown.', step:50, min:0, max:60000 },
    { key:'sf_bv',  path:['safety','batt_volt_min_v'],          label:'Battery Min (V)',          desc:'Battery / bus undervoltage fault threshold. 0 = disabled. Set ~0.5 V below your minimum expected loaded voltage. Typical: 10.5 V for 3S LiPo.',    step:0.1,  min:0, basic:true },
    { key:'sf_bv_d', path:['safety','batt_low_confirm_ms'], label:'Bus-Voltage Confirmation (ms)', desc:'Low battery or bus voltage must persist for this time before shutdown.', step:100, min:0, max:60000 },
    { key:'sf_sg',  path:['safety','surge_detect_rpm_variance'],label:'Experimental Surge Detection (RPM²)', desc:'Experimental statistical N1-instability detector over a 10-sample rolling window, not an RPM limit. It requires tuning from recorded stable and surge data for this exact engine. 500,000 RPM² corresponds to about 707 RPM standard deviation. 0 disables it.', step:10000, min:0 },
  ]},
  { title: 'Automatic N2 Speed Control', id: 'governor-cfg-section', sectionNote:'Enable this controller in Hardware > Controllers. Generator/turboshaft setup uses proportional Main Fuel. Prop Pitch may be proportional, or an on/off relay using deliberate fine/coarse control and the N2 no-correction band. Overspeed fuel pullback remains separate.', fields: [
    { key:'gv_tr', path:['governor','target_rpm'],   label:'Target N2 RPM',      desc:'Power turbine (N2) speed setpoint for the governor. Set to your rated output shaft RPM. 0 = governor disabled. In prop-pitch mode the governor adds propeller load to hold this speed, so set it to your rated power-turbine RPM — too low can over-load and stall the core.',                                                             step:100,   min:0, basic:true },
    { key:'gv_bd', path:['governor','band_rpm'],     label:'No-Correction Speed Band (RPM)', desc:'The controller makes no correction while N2 is within this distance above or below the target. A small band prevents hunting. Typical: 200–500 RPM.', step:50, min:0, max:1000000000 },
    { key:'gv_kp', path:['governor','kp'], label:'Fuel Change at 1,000 RPM Error (%/s)', scale:100000, desc:'Fuel correction rate produced by a 1,000 RPM error outside the no-correction band. Example: 25 means fuel changes 25 percentage points per second at that error. Start around 10-25 and increase only while checking for hunting.', step:5, min:0, max:0.01 },
    { key:'gv_pk', path:['governor','pitch_kp'], label:'Pitch Change at 1,000 RPM Error (%/s)', scale:100000, desc:'Requested propeller-pitch correction rate at a 1,000 RPM error. A nonzero value selects pitch-primary control when a proportional pitch actuator is fitted. Actual movement is also limited by Full Propeller-Pitch Travel Time.', step:5, min:0, max:0.01 },
    { key:'gv_pr', path:['governor','pitch_ramp_sec'], label:'Full Propeller-Pitch Travel Time (s)', desc:'Shortest allowed time for the pitch actuator to travel through its full range. This prevents abrupt load changes. 0 allows immediate movement. Typical: 1–5 s.', step:0.5, min:0 },
  ]},
  { title: 'Glow Plug Preheat', id: 'glow-cfg-section', sectionNote:'Hardware installs and calibrates the glow output. Sequence decides where the Glow Preheat block runs. These settings define what that block does, so different startup sequences share one clearly tuned preheat profile.', fields: [
    { key:'gl_ms', path:['glow_plug','preheat_ms'],      label:'Preheat Duration (ms)', desc:'Time to ramp the glow plug from 0 to maximum duty before ignition. Longer = more heat soak. Typical: 8,000–15,000 ms.',                  step:500, min:0, max:3600000, basic:true },
    { key:'gl_mx', path:['glow_plug','preheat_max_pct'], label:'Preheat Peak Command (%)',  desc:'Peak glow command during the preheat ramp. PWM glow uses this as duty percent; relay glow turns ON for any nonzero command. Typical PWM value: 60–90%.', step:5, min:0, max:100 },
    { key:'gl_hd', path:['glow_plug','hold_pct'],        label:'Hold Command (%)',          desc:'Glow command held after preheat completes. PWM glow uses this as duty percent; relay glow stays ON for any nonzero hold command. Typical PWM value: 20–40%.', step:5, min:0, max:100 },
  ]},
  { title: 'RC / Servo Signal Loss Detection', id: 'rc-pwm-section', sectionNote:'Receiver-pulse endpoints are calibrated independently on the Calibration page; this timeout also protects registry PWM-duty inputs.', fields: [
    { key:'rc_fs', path:['rc_input','failsafe_ms'], label:'Signal-Loss Timeout (ms)', desc:'Marks a receiver input invalid when no valid pulse arrives in time. A lost operator-throttle signal returns main fuel toward the calibrated minimum output; STOP still performs the immediate fuel cut.', step:50, min:100 },
  ]},
];

// The old all-in-one Config page is intentionally split by ownership. Keep a
// single field definition source so labels, validation, live-edit rules and
// serialization cannot drift between the two pages.
const CONFIG_SURFACE = window.OT_CONFIG_SURFACE || 'controllers';
const SYSTEM_SECTIONS = new Set([
  'ECU Runtime',
  'External Instrument Cluster Display'
]);
const SCHEMA = ALL_CONFIG_SCHEMA.filter(section =>
  CONFIG_SURFACE === 'system'
    ? SYSTEM_SECTIONS.has(section.title)
    : !SYSTEM_SECTIONS.has(section.title));

let cfg      = {};
let isLocked = false;
let runtimeMode = 'STANDBY';
let runtimeDevMode = false;
const LIVE_CONFIG_KEYS = new Set([
  'th_ru','th_rd','gv_tr','gv_bd','gv_kp','gv_pk','gv_pr',
  'di_tr','di_tp','di_ru','di_rd','di_db','di_rl','di_pd','di_pl','di_mx','di_ig','di_im',
  'di_de','di_dd','di_lk','di_sb','di_fr','di_tu','di_td','di_lr','di_la',
  'di_pde','di_psb','di_pfr','di_plr'
]);
let _cfgDirty = false;
let _controllerRulesDirty = false;
let _controllerHardwareDirty = false;

// ── Per-field changed-state tracking (mirrors hardware.html) ──
let _fieldSnap = {};

function _snapshotFields() {
  _fieldSnap = {};
  document.querySelectorAll('input[id^="cf-"], select[id^="cf-"]')
    .forEach(el => {
      _fieldSnap[el.id] = (el.type === 'checkbox') ? el.checked : el.value;
    });
}

function _getFieldLabel(el) {
  let p = el.parentElement;
  while (p && !p.classList.contains('cfg-field')) p = p.parentElement;
  if (p) {
    const lbl = p.querySelector('.cfg-label');
    if (lbl) {
      const clean = lbl.cloneNode(true);
      clean.querySelectorAll('.live-val').forEach(node => node.remove());
      const label = clean.textContent.trim().replace(/\s*\(.*?\)\s*$/, '');
      const section = p.closest('.cfg-section')?.dataset.section;
      return section ? `${section} / ${label}` : label;
    }
  }
  return el.id.replace(/^cf-/, '').replace(/_/g, ' ');
}

function _formatValue(el, rawVal) {
  if (el.type === 'checkbox') return rawVal ? 'ON' : 'OFF';
  if (el.tagName === 'SELECT') {
    const opt = Array.from(el.options).find(o => String(o.value) === String(rawVal));
    return opt ? opt.text.trim() : (rawVal !== '' ? rawVal : '(empty)');
  }
  return rawVal !== '' && rawVal !== undefined ? String(rawVal) : '(empty)';
}

function _buildChanges() {
  const changes = [];
  document.querySelectorAll('input[id^="cf-"], select[id^="cf-"]')
    .forEach(el => {
      if (!(el.id in _fieldSnap)) return;
      const cur  = (el.type === 'checkbox') ? el.checked : el.value;
      const snap = _fieldSnap[el.id];
      if (String(cur) === String(snap)) return;
      const wrap = el.closest('.cfg-field');
      const inactive = _fieldIsHardwareInactive(wrap);
      changes.push({
        key:   el.id.slice(3),
        label: _getFieldLabel(el),
        was:   _formatValue(el, snap),
        now:   _formatValue(el, cur),
        inactive,
        inactiveReason: inactive ? _fieldInactiveReason(wrap) : '',
      });
    });
  if (_controllerRulesDirty) changes.push({key:'__simple_controls', label:'Custom controllers', was:'Saved setup', now:'Updated setup', inactive:false});
  if (_controllerHardwareDirty) changes.push({key:'__controller_hardware', label:'Controller assignments and safety enables', was:'Saved setup', now:'Updated setup', inactive:false});
  return changes;
}

function _refreshChangedBorders() {
  document.querySelectorAll('.config-group.group-changed').forEach(group => group.classList.remove('group-changed'));
  const changedGroups = new Set();
  document.querySelectorAll('input[id^="cf-"], select[id^="cf-"]')
    .forEach(el => {
      if (!(el.id in _fieldSnap)) return;
      const cur = (el.type === 'checkbox') ? el.checked : el.value;
      const changed = String(cur) !== String(_fieldSnap[el.id]);
      el.classList.toggle('field-changed', changed);
      if (changed) {
        const group = el.closest('.config-group');
        if (group) changedGroups.add(group);
      }
    });
  changedGroups.forEach(group => group.classList.add('group-changed'));
  _updateWorkspaceState();
  if (_workspaceFilter === 'changed') _scheduleWorkspaceRefresh();
}

function _clearChangedBorders() {
  document.querySelectorAll('.field-changed').forEach(el => el.classList.remove('field-changed'));
  document.querySelectorAll('.group-changed').forEach(group => group.classList.remove('group-changed'));
}

function _markDirty() {
  _cfgDirty = true;
  const btn  = document.getElementById('btn-save');
  const discard = document.getElementById('btn-discard');
  const bar  = document.querySelector('.save-bar');
  const msg  = document.getElementById('save-msg');
  if (btn) { btn.disabled = isLocked; btn.classList.add('primary'); }
  if (discard) discard.disabled = false;
  if (bar) bar.classList.add('is-dirty');
  if (msg && !msg.textContent.startsWith('✓')) msg.textContent = 'Unsaved changes';
  _refreshChangedBorders();
}
function _clearDirty() {
  _cfgDirty = false;
  _controllerRulesDirty = false;
  _controllerHardwareDirty = false;
  const btn = document.getElementById('btn-save');
  const discard = document.getElementById('btn-discard');
  const bar = document.querySelector('.save-bar');
  if (btn) { btn.disabled = true; btn.classList.remove('primary'); }
  if (discard) discard.disabled = true;
  if (bar) bar.classList.remove('is-dirty');
  _snapshotFields();
  _clearChangedBorders();
  _updateWorkspaceState();
}

async function reloadConfigPage() {
  if (_cfgDirty && !await OTDialog.confirm('Discard every unsaved configuration change?', {
    title:'Discard changes', confirmLabel:'Discard', danger:true
  })) return;
  location.reload();
}
