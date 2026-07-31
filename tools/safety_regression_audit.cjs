'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const checks = [];

function expect(label, condition) {
  if (!condition) throw new Error(`Safety regression audit failed: ${label}`);
  checks.push(label);
}

const configCpp = read('src/system/Config.cpp') + read('src/system/ConfigSerialize.cpp');
const configHtml = read('data_src/config.html');
const hardware = read('src/Hardware.h');
const hwConfig = read('src/system/HardwareConfig.cpp') +
  read('src/system/HardwareConfigSerialize.cpp');
const main = read('src/main.cpp');
const web = read('src/system/web/WebServer.cpp');
const configGate = read('src/system/ConfigApplyGate.h');
const pcnt = read('src/hal/sensors/PCNTRpmSensor.h');
const analog = read('src/hal/sensors/AnalogSensor.h');
const safety = read('src/engine/SafetyMonitor.h');
const sessionLogger = read('src/system/SessionLogger.cpp');
const flightRecorder = read('src/system/FlightRecorder.cpp');
const governor = read('src/engine/controllers/PowerTurbineGovernor.h');
const feedback = read('src/system/FeedbackRequirements.h');
const channelRegistry = read('src/system/ChannelRegistry.h');
const ntc = read('src/hal/sensors/NTCSensor.h');
const sequenceHtml = read('data_src/sequence.html');
const hardwareHtml = read('data_src/hardware.html');
const calibrationHtml = read('data_src/calibration.html');
const toolsHtml = read('data_src/tools.html');
const capabilities = read('src/system/HardwareCapabilities.h');
const cooldown = read('src/engine/sequencer/blocks/CooldownSpin.h');
const finalStop = read('src/engine/sequencer/blocks/FinalStop.h');
const starterSpin = read('src/engine/sequencer/blocks/StarterSpin.h');
const pulsedStarter = read('src/engine/sequencer/PulsedStarterAssist.h');
const throttleSlew = read('src/engine/controllers/ThrottleSlew.h');
const dynamicIdle = read('src/engine/controllers/DynamicIdle.h');
const tempConfirm = read('src/engine/sequencer/blocks/TempConfirm.h');
const abFlameConfirm = read('src/engine/sequencer/blocks/ABFlameConfirm.h');
const version = read('src/system/version.h');
const changelog = read('CHANGELOG.md');
const phase2Hil = read('dev/bench/campaign/phase2_safety_hil.py');
const commandQueue = read('src/system/CommandQueue.h');
const platformio = read('platformio.ini');

const commandEnumBody = commandQueue.match(
  /enum class OTCommand[^{]*\{([\s\S]*?)\};/
)?.[1] || '';
const commandNames = [...commandEnumBody.matchAll(
  /^\s*([A-Z][A-Z0-9_]*)\s*,/gm
)].map(match => match[1]);
const commandHandlerBody = main.slice(
  main.indexOf('static void handleCommand'),
  main.indexOf('static constexpr unsigned long SWITCH_DEBOUNCE_MS')
);
expect('every queued command has an explicit core handler',
  commandNames.length > 0 &&
  commandNames.every(name => commandHandlerBody.includes(`case OTCommand::${name}`)));

expect('repository PlatformIO launcher avoids the broken global shim',
  fs.existsSync(path.join(root, 'tools/pio.cmd')));
expect('priority-ten AsyncTCP work is pinned away from the engine-control core',
  platformio.includes('-DCONFIG_ASYNC_TCP_RUNNING_CORE=0'));
expect('PCNT failures are recoverable',
  !pcnt.includes('ESP_ERROR_CHECK') && pcnt.includes('feedback disabled without reboot'));
expect('analog filters use four samples', analog.includes('RollingAvg<4> _avg'));
expect('oil-pressure mapping is explicit',
  !hwConfig.includes('"oil_pressure_main", "pressure"'));
expect('legacy oil loop binds explicit oil-pressure purpose',
  hwConfig.includes('channelRegistry.inputs[i].purpose, "oil_pressure"') &&
  !hwConfig.includes('channelRegistry.inputs[i].role, "pressure"'));
expect('battery mapping is explicit',
  !hwConfig.includes('"battery_voltage", "voltage"'));
expect('OTA and START share the canonical output-demand scan',
  (web.match(/OutputActivity::anyPhysicalDemand/g) || []).length === 2);
expect('configuration writes and START share an atomic gate',
  web.includes('ConfigApplyGate::tryBeginWebWrite') &&
  main.includes('ConfigApplyGate::tryBeginStartTransition') &&
  main.includes('ConfigApplyGate::tryBeginCoreApply'));
expect('START readiness is consumer-aware on both command paths',
  feedback.includes('requiredStartFailureMask') &&
  main.includes('FeedbackRequirements::requiredStartFailureMask') &&
  web.includes('FeedbackRequirements::eligibleSingleStartOverride'));
expect('sensor-fault restart is one-sensor-only and keeps reduced-power safeguards',
  feedback.includes('(failed & (failed - 1UL)) != 0') &&
  feedback.includes('startupConsumes(failed)') &&
  main.includes('ed.limpOverrideSensor = limited ? overrideSensor') &&
  safety.includes('MULTIPLE_SENSOR_FAILURE') &&
  web.includes('Afterburner is disabled during a sensor-fault reduced-power run'));
expect('limp and governor feedback failure command coarse pitch',
  hardware.includes('ed.limpMode && hw.hasPropPitch') &&
  governor.includes('_pitchCurrent + maxStep'));
expect('transient feedback faults freeze fuel before latching reduced power',
  throttleSlew.includes('FeedbackRequirements::n1ForProtectionOrControl() && !ed.n1Healthy') &&
  safety.includes('FEEDBACK_LOSS_CONFIRM_MS = 500') &&
  safety.includes('_confirmed(feedbackBlind') &&
  !governor.includes('ed.limpMode = true'));
expect('fuel response protection follows fitted main-fuel hardware',
  hardware.includes('if (hw.hasThrottle)') &&
  main.includes('HardwareConfig::hasThrottle') &&
  feedback.includes('HardwareConfig::hasThrottle') &&
  !hwConfig.includes('throttle_slew') &&
  !hardware.includes('hasThrottleSlew') &&
  !main.includes('hasThrottleSlew'));
expect('fault shutdown commands coarse pitch',
  main.includes('ed.propPitchDemand = 1.0f') &&
  hardware.includes('if (HardwareConfig::hasPropPitch) ed.propPitchDemand = 1.0f'));
expect('surge detection consumes only fresh shaft samples',
  safety.includes('ed.n1SampleSeq != _lastSurgeN1SampleSeq'));
expect('pressure and torque hard trips require healthy feedback',
  safety.includes('HardwareConfig::hasP1 && ed.p1Healthy') &&
  safety.includes('HardwareConfig::hasP2 && ed.p2Healthy') &&
  safety.includes('HardwareConfig::hasTorque && ed.torqueHealthy'));
expect('startup temperature confirmation counts only new sensor samples',
  tempConfirm.includes('sampleSeq != _lastSampleSeq') &&
  tempConfirm.includes('_lastSampleSeq = sampleSeq'));
expect('pressure idle discards stale rate history when feedback is lost',
  dynamicIdle.includes('if (!installed || !healthy)') &&
  dynamicIdle.includes('_feedbackSeenSeq = _feedbackLastMs = 0'));
expect('secondary oil loops honor the configured feedback-loss delay',
  hardware.includes('g_registryOilLoopFailArmed') &&
  hardware.includes('Config::oilFailsafeDelayMs'));
expect('cooldown pressure control is loop-rate independent',
  cooldown.includes('dt * 400.0f'));
expect('generic overcurrent protection is timed',
  safety.includes('_registryOvercurrentSinceMs') && safety.includes('OUTPUT_OVERCURRENT'));
expect('oil-flow faults warn by default and require explicit shutdown opt-in',
  configCpp.includes('shutdownOnOilUnderflow = false') &&
  safety.includes('Config::shutdownOnOilUnderflow') &&
  safety.includes('_trigger("OIL_FLOW_LOW")') &&
  configHtml.includes('Shutdown on Confirmed Low Oil Flow'));
expect('main and scavenge pumps have independent flow feedback purposes',
  channelRegistry.includes('"oil_flow"') &&
  channelRegistry.includes('"scavenge_flow"') &&
  channelRegistry.includes('hasFlowMonitor') &&
  safety.includes('c.minimumFlow'));
expect('scavenge flow remains observable during shutdown without retriggering shutdown',
  safety.includes('m == SysMode::SHUTDOWN) _checkOilFlow') &&
  safety.includes('(mode == SysMode::STARTUP || mode == SysMode::RUNNING)'));
expect('electric drain valve is available to sequences and dynamic output rules',
  channelRegistry.includes('"drain_valve"') &&
  main.includes('"DrainValveOpen"') &&
  main.includes('"DrainValveClose"') &&
  hardwareHtml.includes('Electric drain valve') &&
  sequenceHtml.includes('DrainValveOpen'));
expect('all safety dwell confirmations reset across inactive and bypassed monitoring',
  (safety.match(/_resetDwellConfirmations\(/g) || []).length >= 4 &&
  safety.includes('memset(_registryOvercurrentSinceMs'));
expect('general safety scan is capped at 250 ms in firmware and UI',
  configCpp.includes('validInt(sf["check_interval_ms"], 10, 250)') &&
  configHtml.includes("path:['safety','check_interval_ms']") && configHtml.includes('max:250'));
expect('temperature safety defaults separate pre-start, startup, and flameout behavior',
  configCpp.includes('flameoutEgtBelowC          = 300.0f') &&
  configCpp.includes('flameoutEgtFallRateCPerSec = 50.0f') &&
  configCpp.includes('preStartEgtLimitC           = 150.0f') &&
  configCpp.includes('startupEgtLimitC            = 0.0f') &&
  configCpp.includes('standbyOilRpmLimit  = 1000.0f') &&
  configCpp.includes('prevHotStart') &&
  configCpp.includes('autofill:pre_start_egt_limit_c'));
expect('gradual limiters share the visible floor-based authority model',
  throttleSlew.includes('(unrestrictedTarget - floor) * over * pullbackStrength') &&
  !throttleSlew.includes('float authority') &&
  configHtml.includes('Gradual Limit-Protection Method'));
expect('afterburner EGT confirmation enforces its configured rise window',
  abFlameConfirm.includes('elapsed >= (unsigned long)totRiseWindowMs') &&
  abFlameConfirm.includes('EGT did not rise within configured window'));
expect('running afterburner flame loss has an AB-only configurable delay',
  configCpp.includes('abFlameLossDelayMs         = 1000') &&
  main.includes('Config::abFlameLossDelayMs') &&
  main.includes('shutting down afterburner only') &&
  configHtml.includes('Running Flame-Loss Delay'));
expect('custom afterburner ignition requires explicit confirmation',
  main.includes('Custom AB ignition sequence must include ABFlameConfirm') &&
  main.includes('Ignition sequence rejected: no explicit flame-confirmation block'));
expect('pre-start temperature is checked before STARTUP and startup has its own hard limit',
  main.includes('START blocked: selected EGT above pre-start limit') &&
  main.indexOf('START blocked: selected EGT above pre-start limit') < main.indexOf('ed.mode = SysMode::STARTUP') &&
  safety.includes('m == SysMode::STARTUP && Config::startupEgtLimitC > 0.0f') &&
  !safety.includes('TOT_RISE'));
expect('EGT flameout requires low-and-falling or independently rapid cooling',
  safety.includes('egt <= flameoutEgtBelowC && ed.totRiseRate < 0.0f') &&
  safety.includes('ed.totRiseRate <= -flameoutEgtFallRateCPerSec'));
expect('automatic relight has explicit nonzero firing and recovery speeds',
  configCpp.includes('validNumber(rl["min_rpm"], 1.0f') &&
  configCpp.includes('validNumber(rl["confirm_rpm"], 1.0f') &&
  main.includes('const float minimumRelightRpm = Config::effectiveRelightMinRpm()') &&
  main.includes('ed.n1Rpm < minimumRelightRpm') &&
  safety.includes('ed.n1Rpm >= Config::effectiveRelightMinRpm()') &&
  configCpp.includes('return fmaxf(relightMinRpm, minRpm)') &&
  !main.includes('Config::minRpm * 1.05f'));
expect('event log routes preserve specific downloads and reject malformed display records',
  web.indexOf('_server.on("/api/log/raw"') < web.indexOf('_server.on("/api/log",') &&
  web.indexOf('_server.on("/api/log/csv"') < web.indexOf('_server.on("/api/log",') &&
  web.includes("lineBuf[n - 1] == ','") &&
  web.includes("lineBuf[n - 1] != '}'") &&
  (web.match(/const int DISPLAY_LIMIT = 120/g) || []).length === 2 &&
  (web.match(/if \(!_gateLogRead\(req\)\) return;/g) || []).length === 3 &&
  web.includes('Another log view or download is in progress; retry shortly'));
expect('windmilling oil setup warns when it cannot activate or command oil',
  configHtml.includes('windmilling oil protection can never activate') &&
  configHtml.includes('both zero; this protection would command no oil'));
expect('large RC jet example is internally based on a 100000 RPM shaft',
  configHtml.includes("desc: 'Large RC Jet ~400N+, approximately 100,000 RPM'") &&
  configHtml.includes('rpm_limit: 100000') && configHtml.includes('pullback_n1_soft_rpm: 95000'));
expect('dedicated temperature interfaces ignore irrelevant analog range fields',
  channelRegistry.includes('c.temperatureInterface != 0') &&
  channelRegistry.includes('return temperatureInterfaceValid(c)'));
expect('low-temperature interfaces cannot masquerade as turbine-gas feedback',
  channelRegistry.includes('const bool lowTemperaturePurpose') &&
  channelRegistry.includes('if (!lowTemperaturePurpose || turbineGasPurpose) return false') &&
  hardwareHtml.includes('NTC and DS18B20 interfaces are only for oil, coolant, intake or ambient temperature'));
expect('GlowPreheat help redirects missing hardware to the installed-output editor',
  sequenceHtml.includes("bname === 'GlowPreheat' && !actuatorEnabled('glow_plug')") &&
  sequenceHtml.includes("/hardware.html#registry-outputs"));
expect('every forced STANDBY transition stops an active main sequence before all-off',
  main.includes('if (g_sequencer.isRunning()) g_sequencer.stopSequence();') &&
  main.indexOf('if (g_sequencer.isRunning()) g_sequencer.stopSequence();') < main.indexOf('ResetRecovery::markSafe();'));
expect('Pulsed Starter Assist is startup-owned and the RUNNING aid is gone',
  starterSpin.includes('PulsedStarterAssist') && pulsedStarter.includes('millisWrap()') &&
  pulsedStarter.includes('Phase::Cancelled') && !main.includes('checkStarterAssist') &&
  !main.includes('STARTER_LOW_RPM_SUPPORT') && !web.includes('STARTER_LOW_RPM_SUPPORT'));

for (const key of [
  'low_oil_confirm_ms', 'oil_zero_confirm_ms', 'oil_temp_confirm_ms',
  'fuel_press_confirm_ms', 'batt_low_confirm_ms'
]) {
  expect(`${key} round-trips through firmware and is editable`,
    configCpp.includes(`CONFIG_FIELD(`) &&
    configCpp.includes(`"${key}"`) &&
    configCpp.includes('readConfigFields(sf, SAFETY_U32_FIELDS)') &&
    configCpp.includes('writeConfigFields(sf, SAFETY_U32_FIELDS)') &&
    configHtml.includes(key));
}

expect('physical STOP remains mandatory while START is optional',
  hwConfig.includes('if (stopPin < 0') && hwConfig.includes('(startPin >= 0 && !gpioAllowed(startPin))'));
expect('NTC divider orientation reaches the resistance calculation',
  ntc.includes('_cal.fixedPullup') && hardware.includes('hw.ntcFixedPullup'));
expect('sequencer uses turbine startup terminology',
  sequenceHtml.includes("label:'Starter Spin to Light-Off Speed'") && !sequenceHtml.includes("label:'Crank Engine'"));
expect('hardware dependency warnings use the same turbine block names',
  hardwareHtml.includes("StarterSpin:'Starter Spin to Light-Off Speed'") && !hardwareHtml.includes("StarterSpin:'Crank Engine'"));
expect('zero minimum N1 remains a valid underspeed-disable setting',
  configCpp.includes('if (!isfinite(minRpm) || minRpm < 0.0f)') &&
  configHtml.includes('Set 0 to disable this independent underspeed check'));
expect('N1 feedback-loss limp is independent of the optional underspeed limit',
  safety.includes('if (HardwareConfig::hasN1Rpm && m == SysMode::RUNNING)') &&
  safety.includes('if (minRpm > 0.0f && ed.n1Healthy && ed.n1Rpm < minRpm)') &&
  safety.includes('LIMP: N1 feedback lost'));
expect('empty session-log selection does not write timestamp-only run files',
  sessionLogger.includes('if (Config::sessionLogMask == 0)') &&
  sessionLogger.includes('_startPending = false;'));
expect('flash persistence is prohibited while engine control is active',
  web.includes('const bool storageWritesSafe = mode == SysMode::STANDBY || mode == SysMode::FAULT') &&
  web.includes('if (storageWritesSafe) FlightRecorder::runEviction()') &&
  web.includes('if (storageWritesSafe) SessionLogger::drainQueue()') &&
  web.includes('if (storageWritesSafe && !_hwRebootPending) Config::flushPendingSave()') &&
  web.includes('if (storageWritesSafe) Config::flushPendingRuntimeStats()'));
expect('active session logging buffers a bounded newest tail in RAM',
  sessionLogger.includes('SESSION_QUEUE_ROWS = 64') &&
  sessionLogger.includes('xQueueReceive(_rowQueue, &oldest, 0)') &&
  sessionLogger.includes('_acceptRows = true;') &&
  sessionLogger.includes('if (!_acceptRows || !_rowQueue) return;') &&
  sessionLogger.includes('(_acceptRows || _startPending || _endPending || _open) ? "" : _currentPath'));
expect('flight recorder overflow preserves newest fault and shutdown evidence',
  flightRecorder.includes('s_drainActive') &&
  flightRecorder.includes('s_ringTail = (uint8_t)((s_ringTail + 1) % RING_SLOTS)') &&
  flightRecorder.includes('s_droppedEvents = s_droppedEvents + 1'));
expect('session-log listing cannot perform an unbounded directory walk',
  web.includes('checked < 4096 && millis() - started < 500'));
expect('valid slow igniter PWM cycles have sufficient LEDC timer resolution',
  hardware.includes('g_actIgniterLedc.begin(hw.igniterPin, freq, 14)') &&
  hardware.includes('g_actIgniter2Ledc.begin(hw.igniter2Pin, freq, 14)') &&
  hwConfig.includes('intRange(actuators["igniter"], "dwell_ms", 1, 200)') &&
  hwConfig.includes('intRange(actuators["igniter2"], "rest_ms", 1, 200)'));
expect('reduced-power caps total main fuel after the afterburner offset',
  hardware.includes('ed.throttleDemand + ed.abFuelOffset') &&
  hardware.indexOf('if (ed.limpMode &&',
    hardware.indexOf('ed.throttleDemand + ed.abFuelOffset')) >
    hardware.indexOf('ed.throttleDemand + ed.abFuelOffset'));
expect('startup feedback follows actual block consumers',
  feedback.includes('startupHas("FlameConfirm")') &&
  !feedback.includes('startupHas("StarterSpin") || startupHas("Spool") ||\n               startupHas("SafetyHold")'));
expect('startup validation warns when rotor spooling is entirely external',
  main.includes('No starter, spool, or air-starter action is present') &&
  main.includes('strcmp(nm, "AirstarterOn") == 0'));
expect('every enabled oil loop makes its pressure feedback operationally required',
  feedback.includes('allOilLoopFeedbackHealthy') && safety.includes('allOilLoopFeedbackHealthy'));
expect('pilot fuel and registry starter channels join the immediate shutdown cut',
  hardware.includes('!strcmp(purpose, "pilot_fuel")') &&
  hardware.includes('registryStarterPurpose') && main.includes('cutRegistryHazardousDemands'));
expect('standalone pilot fuel is not overwritten by wet-glow ownership',
  hardware.includes('const bool wetGlowOwned') &&
  hardware.includes('hw.hasGlowPlug && hw.glowPlugType == 2') &&
  !hardware.includes('if (!strcmp(c.purpose, "pilot_fuel") ||\n                !strcmp(c.purpose, "wet_glow_fuel"))'));
expect('critical safety capability checks reject generic temperature and voltage roles',
  !capabilities.includes('hasInputRole("temperature")') && !capabilities.includes('hasInputRole("voltage")'));
expect('cooldown defaults agree at sixty seconds',
  cooldown.includes('timeoutMs          = 60000') &&
  sequenceHtml.includes("def:60000, configKey:'cooldown_timeout_ms'"));
expect('FinalStop waits for its timeout when N1 is missing or unhealthy',
  finalStop.includes('bool stopped = HardwareConfig::hasN1Rpm') &&
  finalStop.includes('&& ed.n1Healthy') &&
  finalStop.includes('No N1 sensor (waiting %lu ms spool-down delay)') &&
  !finalStop.includes(': true;'));
expect('Developer Mode live config writes use the same runtime lock as Config',
  (web.match(/enable Developer Mode before starting to allow live settings updates/g) || []).length === 2 &&
  (web.match(/if \(Config::isLocked\(\)\)/g) || []).length >= 4);
expect('active Developer Mode writes defer disruptive copies until STANDBY',
  configGate.includes('tryBeginDeferredCoreApply') &&
  main.includes('_configApplyDeferred = true') &&
  main.includes('configMode == SysMode::STANDBY || configMode == SysMode::FAULT') &&
  web.includes('\\"block_hardware_apply\\":\\"deferred_until_standby\\"'));
expect('bench-test timing is edited only from Tools',
  !configHtml.includes("id:'bench', title:'Bench Test Timing'") &&
  toolsHtml.includes('openTestSettings()'));
expect('hardware loading cannot clear a platform storage-fault START lock',
  hwConfig.includes('!PcbProfileManager::faulted() && !bootState.configStorageFault') &&
  !hwConfig.includes('EngineData::instance().configStorageFault = false'));
expect('thermistor calibration explains the configured divider orientation',
  calibrationHtml.includes('ntc-divider-note') && calibrationHtml.includes('ntc_pullup: registryOil.ntc_pullup'));
expect('reduced-power cap discloses automatic safety-feedback activation',
  configHtml.includes('automatically because feedback used by an enabled protection/controller becomes unhealthy') &&
  toolsHtml.includes('feedback required by an enabled safety protection or shaft controller is lost'));
expect('afterburner-only save warnings require fitted afterburner hardware',
  configHtml.includes("hasActualAfterburnerHardware() &&") &&
  configHtml.includes("Number(gv(cfg, 'afterburner', 'flame_mode')) === 2"));
expect('release changelog covers the source firmware version',
  changelog.includes(`## [${version.match(/OT_VERSION\s+"([^"]+)"/)[1]}]`));
expect('phase-two HIL records the live DUT firmware version',
  phase2Hil.includes('self.firmware_before = self.dut.data().get("fw_version"') &&
  !phase2Hil.includes('"firmware": "1.9.2"'));
expect('sequence backing allocation fails into a repairable START lockout',
  main.includes('new (std::nothrow) IBlock*') &&
  main.includes('Cannot start: sequence memory allocation failed'));
expect('bounded web JSON serialization measures once and calls ArduinoJson',
  web.includes('const size_t required = measureJson(doc)') &&
  web.includes('return serializeJson(doc, buf, len);') &&
  web.includes('return _serializeJsonBounded(doc, buf, len);') &&
  !/_serializeJsonBounded\([^)]*\)\s*\{[\s\S]{0,350}return _serializeJsonBounded/.test(web));
expect('fixed web workspaces reserve once and fail into START lockout',
  web.includes('using WebIoBuffer = char[16384]') &&
  (web.match(/heap_caps_malloc\(sizeof\(WebIoBuffer\)/g) || []).length === 2 &&
  web.includes('Web service memory reservation failed; reboot or reflash before START') &&
  main.includes('const bool webServerReady = WebServer::begin()') &&
  main.includes('if (!webServerReady)') &&
  !web.includes('static char   g_webRxBuf[16384]') &&
  !web.includes('static char   g_webTxBuf[16384]'));
expect('pitch governor begins from the live sequencer demand',
  governor.includes('_pitchCurrent = constrain(ed.propPitchDemand, 0.0f, 1.0f)'));
expect('both boot loaders filter their unified JSON subtree and lock out oversized files',
  configCpp.includes('DeserializationOption::Filter(filter)') &&
  configCpp.includes('ecu_config.json is too large - START inhibited') &&
  hwConfig.includes('Stored config is too large - START inhibited') &&
  !hwConfig.includes('Stored config is too large - regenerating compiled defaults'));
const enterStandbyBody = main.slice(
  main.indexOf('static void enterStandby()'),
  main.indexOf('static void enterAbortStandby()'));
expect('entering STANDBY releases every temporary actuator-tool timer',
  ['_fuelPrimeUntilMs', '_oilPrimeUntilMs', '_ignTestUntilMs', '_ign2TestUntilMs',
   '_startTestUntilMs', '_idleTestUntilMs', '_oilScavTestUntilMs',
   '_coolFanTestUntilMs', '_airstarterTestUntilMs', '_bleedValveTestUntilMs',
   '_glowTestUntilMs', '_fuelPump2TestUntilMs', '_abSolTestUntilMs',
   '_abPumpTestUntilMs', '_starterEnTestUntilMs', '_propPitchTestUntilMs',
   '_registryOutputTestUntilMs'].every(name =>
     new RegExp(`${name}\\s*=\\s*0;`).test(enterStandbyBody)));

console.log(`Safety regression audit passed (${checks.length} checks).`);
