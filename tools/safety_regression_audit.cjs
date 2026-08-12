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
const outputActivity = read('src/system/OutputActivity.h');
const configGate = read('src/system/ConfigApplyGate.h');
const pcnt = read('src/hal/sensors/PCNTRpmSensor.h');
const analog = read('src/hal/sensors/AnalogSensor.h');
const safety = read('src/engine/SafetyMonitor.h');
const rulesEngine = read('src/system/RulesEngine.h');
const engineData = read('src/engine/EngineData.h');
const engineDataCpp = read('src/engine/EngineData.cpp');
const sessionLogger = read('src/system/SessionLogger.cpp');
const clusterSerial = read('src/system/ClusterSerial.cpp');
const flightRecorder = read('src/system/FlightRecorder.cpp');
const governor = read('src/engine/controllers/PowerTurbineGovernor.h');
const feedback = read('src/system/FeedbackRequirements.h');
const channelRegistry = read('src/system/ChannelRegistry.h');
const piecewiseCalibration = read('src/hal/sensors/PiecewiseCalibration.h');
const adcThreshold = read('src/hal/AdcThreshold.h');
const i2cManager = read('src/hal/i2c/I2CDeviceManager.h');
const lossRecheck = read('src/hal/i2c/LossRecheck.h');
const ntc = read('src/hal/sensors/NTCSensor.h');
const sequenceHtml = read('data_src/sequence.html');
const sequenceRules = read('data_src/pages/sequence-rules-save.js');
const hardwareHtml = read('data_src/hardware.html');
const hardwareCatalog = read('data_src/pages/hardware-registry-catalog.js');
const hardwareSave = read('data_src/pages/hardware-save.js');
const hardwareState = read('data_src/pages/hardware-state.js');
const hardwareRegistryView = read('data_src/pages/hardware-registry-view.js');
const hardwareRegistryActions = read('data_src/pages/hardware-registry-actions.js');
const calibrationHtml = read('data_src/calibration.html');
const sequenceEngine = read('src/engine/sequencer/SequenceEngine.h');
const toolsHtml = read('data_src/tools.html');
const logHtml = read('data_src/log.html');
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
  web.includes('Config::persistJsonCandidateReleasing') &&
  web.includes('ConfigApplyGate::publishCandidate') &&
  main.includes('ConfigApplyGate::tryBeginStartTransition') &&
  main.includes('ConfigApplyGate::tryBeginCoreApply') &&
  main.includes('ConfigApplyGate::takeCandidate'));
expect('config PATCH acknowledgement follows the exact ECU-core generation',
  configGate.includes('completeCoreApply') && configGate.includes('_completedGeneration') &&
  web.includes('_awaitConfigApply') && main.includes('ConfigApplyGate::completeCoreApply'));
expect('live governor tuning cannot transfer between fuel and pitch authority',
  web.includes('_runtimeGovernorAuthorityPreserved') &&
  web.includes('Pitch Gain cannot cross zero while running'));
expect('registry oil pressure takes precedence over the legacy ADC adapter',
  hardware.indexOf('if (oilPressAnalog >= 0)') < hardware.indexOf('g_sensorOilPress.update()') &&
  hardware.includes('ed.oilPressureRaw = ed.registryInputRaw[oilPressAnalog]'));
expect('ordinary analog calibration is bounded and shared by local and I2C inputs',
  piecewiseCalibration.includes('MAX_POINTS = 6') &&
  piecewiseCalibration.includes('raw[i] <= raw[i - 1]') &&
  piecewiseCalibration.includes('direction != stepDirection') &&
  channelRegistry.includes('calibration_points') &&
  hardware.includes('PiecewiseCalibration::apply(rawCounts') &&
  i2cManager.includes('PiecewiseCalibration::apply((float)raw'));
expect('calibration telemetry follows the selected registry input',
  hardware.includes('ed.fuelPressRaw = ed.registryInputRaw[fuelPressAnalog]') &&
  hardware.includes('ed.p1Raw = ed.registryInputRaw[p1Analog]') &&
  hardware.includes('ed.p2Raw = ed.registryInputRaw[p2Analog]') &&
  hardware.includes('ed.fuelFlowRaw = ed.registryInputRaw[fuelFlowAnalog]') &&
  hardware.includes('ed.battVoltageRaw = ed.registryInputRaw[battAnalog]') &&
  web.includes('doc["p1_raw"]                = ed.p1Raw'));
expect('starting and ignition I2C loss is noncritical after pre-start readiness',
  hardware.includes('i2cOutputRequiresRunningFault') &&
  hardware.includes('strcmp(p, "starter")') && hardware.includes('strcmp(p, "igniter")') &&
  main.includes('unavailableRunningCriticalI2cOutput()') &&
  main.includes('unavailableEngineI2cOutput()'));
expect('binary oil pumps use the same enum and endpoint semantics outside RUNNING',
  hardware.includes('g_blkCooldownSpin.oilPumpBinary = hw.hasOilPump && hw.oilPumpType == 2') &&
  main.includes('bool binaryPump = hw.oilPumpType == 2') &&
  main.includes('ed.oilPumpPct = ed.oilPumpPct > 0.0f ? 100.0f : 0.0f'));
expect('TLA threshold switches and torque use valid firmware contracts',
  channelRegistry.includes('oneOf(Digital, Analog, I2cDigital, I2cAnalog)') &&
  channelRegistry.includes('oneOf(Analog, I2cAnalog, I2cLoadCell)') &&
  hwConfig.includes('torque->driver == ChannelRegistry::I2cAnalog') &&
  hardwareCatalog.includes("value:'torque'") && hardwareCatalog.includes('drivers:[1,9,10]'));
expect('native ADC and TLA ADC switches share threshold, hysteresis and polarity semantics',
  hardware.includes('g_registryAnalogSwitchState') &&
  hardware.includes('AdcThreshold::update((uint16_t)raw, c.digitalThresholdRaw') &&
  hardware.includes('AdcThreshold::logicalValue(state, c.activeHigh)') &&
  channelRegistry.includes('isSwitchCondition(c)') &&
  hardwareCatalog.includes("drivers:[0,1,8,9]") &&
  calibrationHtml.includes('Capture inactive') && calibrationHtml.includes('Capture active'));
expect('immutable registry routing is classified once instead of rescanned in control loops',
  hardware.includes('struct RegistryInputPlan') &&
  hardware.includes('buildRegistryInputPlan();') &&
  hardware.includes('struct RegistryOutputPlan') &&
  hardware.includes('g_registryOutputMeta[i] = kind | flags') &&
  hardware.includes('const int8_t registryThrottle = g_registryInputPlan.throttle') &&
  !hardware.includes('const int8_t registryThrottle = registryPurposeInputIndex'));
expect('telemetry snapshots avoid long interrupt-disabled copies and publish at a bounded display rate',
  engineData.includes('publishSnapshot(uint32_t nowMs, bool force = false)') &&
  engineDataCpp.includes('SNAPSHOT_PERIOD_MS = 50') &&
  engineDataCpp.includes('__atomic_fetch_add(&g_snapshotSequence, 1U, __ATOMIC_ACQ_REL)') &&
  engineDataCpp.includes('if (before == after) return after >> 1') &&
  !engineDataCpp.includes('portENTER_CRITICAL'));
expect('auxiliary output-current ADC acquisition is bounded without slowing protection evaluation',
  hardware.includes('nowMs - g_registryOutputCurrentLastMs >= 10UL') &&
  hardware.includes('c.currentPin >= 0 && sampleAuxCurrent') &&
  safety.includes('ed.registryOutputCurrentAmps[i] > c.currentMaxAmps'));
expect('ADC threshold conditions are transport-neutral and preserve odd total deadbands',
  adcThreshold.includes('const int upperBand = hysteresis - lowerBand') &&
  hardware.includes('AdcThreshold::update') && i2cManager.includes('AdcThreshold::update') &&
  !hardware.includes('I2CThreshold::'));
expect('flame threshold advisories follow active polarity and include the zero-count extreme',
  calibrationHtml.includes('function flameThresholdAdvisory(thr, activeHigh = true)') &&
  calibrationHtml.includes("if (thr < 100) return activeHigh") &&
  calibrationHtml.includes('very high for active-below detection'));
expect('I2C device addresses match the supported chip families',
  channelRegistry.includes('c.i2cAddress >= 0x20 && c.i2cAddress <= 0x27') &&
  channelRegistry.includes('c.i2cAddress >= 0x10 && c.i2cAddress <= 0x17') &&
  channelRegistry.includes('c.i2cAddress == 0x2A') &&
  hardwareRegistryView.includes('Choose a compatible detected I2C device'));
expect('successful I2C input and output transactions fully reset the 500 ms loss window',
  i2cManager.includes('_record(c.i2cAddress, Tca9554, true)') &&
  i2cManager.includes('_record(c.i2cAddress, _typeForDriver(c.driver), true)') &&
  !i2cManager.includes('if (d) { d->present = true; d->lastSeenMs = _sampleMs[i]; }'));
expect('relay-style igniters expose and retain only simple on-off behavior',
  hwConfig.includes('if (!igniterPwm) igniterCoil = false') &&
  hwConfig.includes('c->driver == ChannelRegistry::Relay || c->driver == ChannelRegistry::I2cRelay') &&
  hardwareCatalog.includes('Relay-style outputs use Simple on/off') &&
  hardwareSave.includes('Simple on/off (relay capability)'));
expect('wet-glow registry fuel replaces rather than duplicates the nested GPIO',
  hwConfig.includes('wetGlowFuelPin = -1') && hwConfig.includes('strcmp(c.purpose, "pilot_fuel")') &&
  hardwareSave.includes("registryDerivedPurpose('output', c) === 'pilot_fuel'"));
expect('native pre-start safety inputs use their asserted physical level',
  main.includes('START blocked by DI ch%d') &&
  main.includes('channel.activeModes & (1u << (int)SysMode::STARTUP)') &&
  main.includes('digitalRead(channel.pin)'));
expect('a failed fitted throttle input cannot fall back to an engine-owned AB request',
  main.includes('} else if (hw.hasThrottleInput) {') &&
  main.includes('fallback is intentional only when no') &&
  main.includes('physical operator-throttle source is fitted'));
expect('START readiness is consumer-aware on both command paths',
  feedback.includes('requiredStartFailureMask') &&
  main.includes('FeedbackRequirements::requiredStartFailureMask') &&
  web.includes('FeedbackRequirements::eligibleSingleStartOverride'));
expect('sensor-fault restart is one-sensor-only and latches reduced-power safeguards',
  feedback.includes('(failed & (failed - 1UL)) != 0') &&
  feedback.includes('startupConsumes(failed)') &&
  main.includes('ed.limpOverrideSensor = limited ? overrideSensor') &&
  main.includes('ed.automaticLimpLatched = limited') &&
  safety.includes('ed.limpFailureMask |= observedFailure') &&
  !safety.includes('_trigger("MULTIPLE_SENSOR_FAILURE")') &&
  web.includes('Afterburner is disabled while reduced-power mode is active'));
expect('automatic limp cannot be cleared by manual controls during a run',
  engineData.includes('manualLimpRequested') &&
  engineData.includes('automaticLimpLatched') &&
  main.includes('ed.limpMode = ed.manualLimpRequested || ed.automaticLimpLatched') &&
  safety.includes('ed.automaticLimpLatched = true'));
expect('an unavailable registry reduced-power switch cannot silently remove its active fuel cap',
  main.includes('manualLimpInputUnavailable |= !healthy') &&
  main.includes('else if (!manualLimpInputUnavailable) ed.manualLimpRequested = false') &&
  !main.includes('registryPrevious[ChannelRegistry::MAX_INPUT_CHANNELS]'));
expect('bound RC throttle and idle inputs each have only the failsafe-aware interrupt owner',
  hardware.includes('registryInputBoundTo(c, "operator_throttle")') &&
  hardware.includes('registryInputBoundTo(c, "operator_idle")') &&
  hardware.includes('registryPurposeInputIndex("idle", "operator_idle")') &&
  channelRegistry.includes('!strcmp(b.key, "operator_idle")') &&
  hwConfig.includes('addDefaultBinding("operator_idle", "operator_idle"'));
expect('registry validation rejects ambiguous duplicate binding keys',
  channelRegistry.includes('if (!strcmp(bindings[i].key, bindings[j].key))') &&
  channelRegistry.includes('"Binding %s is assigned more than once"'));
expect('pulse fuel-flow cards expose only calibration consumed by the PCNT path',
  hardwareCatalog.includes("Number(c.driver) === 2 && purpose === 'fuel_flow'") &&
  hardwareCatalog.includes('No separate hidden flow range is applied'));
expect('AB flame health loss clears the polarity-aware hysteresis latch',
  hardware.includes('latch.resetInactive()') &&
  hardware.includes('fresh threshold crossing is required for flame confirmation'));
expect('canonical AB flame threshold is authoritative across calibration, telemetry, and runtime',
  !hwConfig.includes('abFlameThreshold') &&
  !hardware.includes('g_sensorAbFlame') &&
  calibrationHtml.includes("registryCalibrationPatch('ab_flame', {") &&
  calibrationHtml.includes('digital_threshold_raw: thr, digital_hysteresis_raw: hysteresis') &&
  web.includes('doc["ab_flame_raw"]          = ed.abFlameRaw') &&
  web.includes('ChannelRegistry::isAdcThresholdCondition(input)') &&
  hardwareCatalog.includes("['flame','ab_flame'].includes(purpose)") &&
  hardwareCatalog.includes('Flame active state'));
expect('digital AB flame calibration hides the irrelevant analog threshold workflow',
  calibrationHtml.includes("![0,8].includes(Number(registryAbFlame.driver))") &&
  calibrationHtml.includes('Digital AB flame input uses its direct On/Off state'));
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
  abFlameConfirm.includes('totRiseWindowMs > 0') &&
  abFlameConfirm.includes('elapsed >= (unsigned long)totRiseWindowMs') &&
  abFlameConfirm.includes('EGT DID NOT RISE IN AB WINDOW'));
expect('running afterburner flame loss has an AB-only configurable delay',
  configCpp.includes('abFlameLossDelayMs         = 1000') &&
  main.includes('Config::abFlameLossDelayMs') &&
  main.includes('shutting down afterburner only') &&
  configHtml.includes('Running Flame-Loss Delay'));
expect('custom afterburner ignition requires explicit confirmation',
  main.includes('Custom AB ignition sequence must include ABFlameConfirm') &&
  main.includes('[AB] Ignition sequence rejected: %s'));
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
  hwConfig.includes('if (!registryStop && stopPin < 0) return false') &&
  hwConfig.includes('(startPin >= 0 && !gpioAllowed(startPin))'));
expect('standby control-rule masks survive validation and both load paths',
  configCpp.includes('validInt(rule["mode_mask"], 1, 15)') &&
  (configCpp.match(/modeMask &= 0x0F/g) || []).length === 2 &&
  !configCpp.includes('r.modeMask &= 0x0E') &&
  !configCpp.includes('rules[i].modeMask &= 0x0E'));
expect('full restore publishes its reboot guard before releasing maintenance ownership',
  /_scheduleRestart\("engine config restore"\);\s*_finishConfigRestore\(\);/.test(web));
expect('registry import enforces the browser purpose-role-driver contract',
  channelRegistry.includes('purposeRoleDriverValid(c.direction, c.purpose, c.role, c.driver)') &&
  channelRegistry.includes('if (!strcmp(purpose, "main_fuel")) return output("fuel", false, true, true, false)') &&
  channelRegistry.includes('!strcmp(purpose, "ab_flame")'));
expect('mirrored canonical control and AB inputs cannot self-collide during pin validation',
  channelRegistry.includes('!strcmp(purpose, "ab_flame")') &&
  channelRegistry.includes('!strcmp(purpose, "ab_command")') &&
  channelRegistry.includes('!strcmp(purpose, "start_switch") || !strcmp(purpose, "stop_switch")') &&
  hwConfig.includes('if (registryMirrorsLegacyPin(ch)) continue') &&
  hwConfig.includes('if (!addPin(ch.pin)) return false'));
expect('local digital flame detectors use GPIO rather than ADC-only validation',
  hwConfig.includes('localDigital ? gpioAllowed : adcGpioAllowed') &&
  channelRegistry.includes('!strcmp(purpose, "flame") || !strcmp(purpose, "ab_flame")'));
expect('canonical main and afterburner digital flame adapters use logical values rather than ADC thresholds',
  hardware.includes('Registry digital adapters already apply active-high/low') &&
  hardware.includes('c.driver == ChannelRegistry::I2cDigital') &&
  hardware.includes('TCA9554 raw sample is 0/1 rather than ADC counts') &&
  hardware.includes('const int8_t flameRegistry = inputPlan.flame') &&
  !hardware.includes('g_sensorFlame'));
expect('registry-backed AB command remains available to control rules without a local GPIO pin',
  rulesEngine.includes('_registryInputPurposePresent("ab_command")') &&
  hwConfig.includes('case 24: return HardwareConfig::hasAfterburner &&') &&
  hwConfig.includes('registryHasAddressablePurpose(registry, ChannelRegistry::Input, "ab_command")') &&
  sequenceRules.includes("registryInputPurpose('ab_command')"));
expect('canonical AB and command-switch rule sources are shown once rather than as custom duplicates',
  sequenceRules.includes("'ab_command','start_switch','stop_switch'") &&
  sequenceRules.includes("'throttle','idle','ab_flame','ab_command','start_switch','stop_switch'"));
expect('all AB rule, condition, settings, and telemetry paths recognize the registry command',
  configCpp.includes('registryInputPurposeAvailable("ab_command")') &&
  main.includes('registryPurposeConfigured("ab_command")') &&
  hwConfig.includes('registryHasAddressablePurpose(registry, ChannelRegistry::Input, "start_switch")') &&
  hwConfig.includes('registryHasAddressablePurpose(registry, ChannelRegistry::Input, "stop_switch")') &&
  sequenceRules.includes("registryInputPurpose('ab_command')") &&
  clusterSerial.includes('HardwareConfig::abInputPin >= 0 || hasRegistryAbCommand()'));
expect('shared RC signal-loss telemetry includes registry RC and PWM-duty inputs',
  web.includes('HardwareConfig::hasThrottleInput && HardwareConfig::throttleInputRcPwm') &&
  web.includes('HardwareConfig::hasAfterburner && HardwareConfig::abInputRcPwm') &&
  web.includes('input.driver == ChannelRegistry::RcPwm') &&
  web.includes('input.driver == ChannelRegistry::PwmDuty') &&
  web.includes('doc["rc_pwm_active"]         = rcPwmActive') &&
  read('data_src/pages/config-runtime.js').includes('[3, 7].includes(Number(input.driver))'));
expect('dedicated AB pump command does not require using the same input as the fire trigger',
  read('data_src/pages/config-runtime.js').includes("hasAB && (hasRegistryInput('ab_command')") &&
  read('data_src/pages/config-runtime.js').includes('abTriggerSource === 3 || savedAbPumpSource === 2') &&
  read('src/hal/RCInput.h').includes('_registryAbCommandPresent()') &&
  hardware.includes('if (hw.hasAfterburner && hw.abInputPin >= 0 && !hw.abInputRcPwm &&'));
expect('canonical registry AB command has one GPIO sampler and cannot be overwritten by the legacy adapter',
  hardware.includes('registryPurposeInputIndex("ab_command") < 0') &&
  hardware.includes('abCommandRegistry < 0 &&') &&
  read('src/hal/RCInput.h').includes('!_registryAbCommandPresent()'));
expect('canonical analog inputs do not initialize unused legacy ADC owners',
  hardware.includes('hw.hasBattVoltage && hw.battVoltPin >= 0 && !battRegistryAnalog') &&
  hardware.includes('hw.hasTorque && hw.torquePin >= 0 && !torqueRegistryAnalog') &&
  hardware.includes('else if (!fuelFlowRegistryAnalog)') &&
  hardware.includes('hw.hasFuelPress && !fuelPressRegistryAnalog') &&
  !hardware.includes('g_sensorAbFlame'));
expect('core output-current telemetry mirrors the exact sample used by protection logic',
  hardware.includes('bool mirroredCoreCurrent = false') &&
  hardware.includes('ed.registryOutputCurrentAmps[i] = ed.glowCurrentAmps') &&
  hardware.includes('ed.registryOutputCurrentAmps[i] = ed.igniterCurrentAmps') &&
  hardware.includes('ed.registryOutputCurrentAmps[i] = ed.igniter2CurrentAmps') &&
  hardware.includes('ed.registryOutputCurrentAmps[i] = ed.oilPumpCurrentAmps') &&
  hardware.includes('c.currentPin >= 0 && sampleAuxCurrent'));
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
  web.includes('if (storageWriteWindow) FlightRecorder::runEviction()') &&
  web.includes('if (storageWriteWindow) SessionLogger::drainQueue()') &&
  web.includes('if (storageWriteWindow && !_hwRebootPending) Config::flushPendingSave()') &&
  web.includes('if (storageWriteWindow) Config::flushPendingRuntimeStats()'));
expect('flash-backed asset responses lease LittleFS against concurrent writes',
  web.includes('class LeasedAssetResponse final : public AsyncFileResponse') &&
  web.includes('++s_activeAssetResponses') &&
  web.includes('if (s_activeAssetResponses) --s_activeAssetResponses') &&
  web.includes('new (std::nothrow) LeasedAssetResponse(path, contentType)') &&
  web.includes('s_storageWriteActive = true') &&
  web.includes('if (storageWriteWindow) _endStorageWriteWindow()'));
expect('config UI PATCH sends only recap-listed changed fields',
  configHtml.includes('const changedKeys = new Set(_buildChanges().map(change => change.key))') &&
  configHtml.includes('if (!changedKeys.has(field.key)) return') &&
  !configHtml.includes('let payload = cfg'));
expect('config UI does not race a full settings reread after minimal PATCH',
  configHtml.includes('Keep the exact values just sent as the new baseline') &&
  !configHtml.includes('cfg = await fetchAppliedConfig()'));
const pioHook = fs.readFileSync(path.join(root, 'tools', 'pio_s3_dynconfig.py'), 'utf8');
expect('HTTP completion leaves advertised close to peer without ECU TIME_WAIT exhaustion or browser resets',
  pioHook.includes('ESPAsyncWebServer completion patch expected 2 close sites') &&
  pioHook.includes('Peer closes the advertised Connection: close response') &&
  !pioHook.includes('new = "_client->abort()'));
expect('OTA success uses delayed guarded restart so its HTTP response can leave first',
  web.includes('_scheduleRestart("firmware OTA", 3000)') &&
  !web.includes('if (_otaPendingRestart) {\n        _restartCleanly("firmware OTA")'));
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
expect('sequencer runs configured exit actions only on success or accepted timeout',
  sequenceEngine.includes('case BlockResult::Complete:') &&
  sequenceEngine.includes('case BlockResult::TimeoutContinue:') &&
  (sequenceEngine.match(/_applyActions\(_exitActions, _idx\)/g) || []).length === 3);
expect('session-log listing cannot perform an unbounded directory walk',
  web.includes('checked < 4096 && millis() - started < 500'));
expect('valid slow igniter PWM cycles have sufficient LEDC timer resolution',
  hardware.includes('g_actIgniterLedc.begin(hw.igniterPin, freq, 14)') &&
  hardware.includes('g_actIgniter2Ledc.begin(hw.igniter2Pin, freq, 14)') &&
  hwConfig.includes('intRange(actuators["igniter"], "dwell_ms", 1, 200)') &&
  hwConfig.includes('intRange(actuators["igniter2"], "rest_ms", 1, 200)'));
expect('reduced-power caps total main fuel after the afterburner offset',
  hardware.includes('Config::effectiveMainFuelDemand(ed)') &&
  configCpp.includes('base + allowedOffset') &&
  configCpp.indexOf('if (ed.limpMode &&', configCpp.indexOf('base + allowedOffset')) >
    configCpp.indexOf('base + allowedOffset'));
expect('startup feedback follows actual block consumers',
  feedback.includes('startupHas("FlameConfirm")') &&
  !feedback.includes('startupHas("StarterSpin") || startupHas("Spool") ||\n               startupHas("SafetyHold")'));
expect('startup validation warns when rotor spooling is entirely external',
  main.includes('No starter, spool, or air-starter action is present') &&
  main.includes('strcmp(nm, "AirstarterOn") == 0'));
expect('every enabled oil loop makes its pressure feedback operationally required',
  feedback.includes('allOilLoopFeedbackHealthy') && safety.includes('allOilLoopFeedbackHealthy'));
expect('start fuel and registry starter channels join the immediate shutdown cut',
  hardware.includes('!strcmp(purpose, "pilot_fuel")') &&
  hardware.includes('registryStarterPurpose') && main.includes('cutRegistryHazardousDemands'));
expect('standalone start fuel is not overwritten by wet-glow ownership',
  hardware.includes('const bool wetGlowOwned') &&
  hardware.includes('hw.hasGlowPlug && hw.glowPlugType == 2') &&
  !hardware.includes('if (!strcmp(c.purpose, "pilot_fuel") ||\n                !strcmp(c.purpose, "wet_glow_fuel"))'));
expect('critical safety capability checks reject generic temperature and voltage roles',
  !capabilities.includes('hasInputRole("temperature")') && !capabilities.includes('hasInputRole("voltage")'));
expect('cooldown defaults agree at sixty seconds',
  cooldown.includes('timeoutMs          = 60000') &&
  sequenceHtml.includes("def:60000, configKey:'cooldown_timeout_ms'"));
expect('configuration warnings describe actual startup and cooldown ordering',
  configHtml.includes('later spool stage may already be satisfied') &&
  configHtml.includes('Startup may pass and then immediately fault') &&
  configHtml.includes('Cooldown may complete immediately while the turbine is still hot'));
expect('rule help and collisions disclose final command ownership',
  sequenceHtml.includes('Outside the selected engine states, the rule releases the output') &&
  sequenceHtml.includes('false or unavailable input applies the configured off value') &&
  sequenceHtml.includes('overlapping RUNNING owners') &&
  sequenceHtml.includes('later rule command is final'));
expect('oil-loop editor separates binary and proportional hardware semantics',
  hardwareHtml.includes('On/off oil-pressure control') &&
  hardwareHtml.includes('Minimum pump output (%)') &&
  hardwareHtml.includes('Effective core-fuel demand') &&
  hardwareHtml.includes('N1 shaft speed') && hardwareHtml.includes('N2 shaft speed'));
expect('multiple oil systems use explicit pressure and pump bindings',
  channelRegistry.includes('strcmp(purpose, "oil_pressure") && isCoreManagedInputPurpose') &&
  channelRegistry.includes('if (d == Output) return false;') &&
  hwConfig.includes('strcmp(pressureCh->purpose, "oil_pressure") != 0') &&
  hardwareHtml.includes("input: new Set(['n1_speed','n2_speed','tot','tit','oil_temperature'") &&
  hardwareHtml.includes('output: new Set()'));
expect('FinalStop waits for its timeout when N1 is missing or unhealthy',
  finalStop.includes('bool stopped = HardwareConfig::hasN1Rpm') &&
  finalStop.includes('&& ed.n1Healthy') &&
  finalStop.includes('No N1 sensor (waiting %lu ms spool-down delay)') &&
  !finalStop.includes(': true;'));
expect('Developer Mode keeps the full config locked and opens only the RUNNING PATCH window',
  configCpp.includes('return active;') &&
  web.includes('liveWindowBeforeGate') && web.includes('liveWindowAfterGate') &&
  web.includes('patchEdBeforeGate.mode == SysMode::RUNNING && patchEdBeforeGate.devMode') &&
  web.includes('!EngineData::instance().devMode ||'));
expect('active Developer Mode accepts only narrow atomic controller tuning',
  web.includes('_runtimeTuningPatchAllowed') &&
  web.includes('only fields marked Applies live may be changed') &&
  main.includes('Hardware::applyLiveControllerTuning()') &&
  main.includes('_configApplyDeferred = false') &&
  hardware.includes('inline void applyLiveControllerTuning()'));
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
  web.includes('#if defined(CONFIG_IDF_TARGET_ESP32S3)') &&
  web.includes('using WebRxBuffer = char[24576]') &&
  web.includes('using WebRxBuffer = char[16384]') &&
  web.includes('using WebTxBuffer = char[16384]') &&
  web.includes('using WebTxBuffer = char[12288]') &&
  (web.match(/heap_caps_malloc\(sizeof\(WebRxBuffer\)/g) || []).length === 1 &&
  (web.match(/heap_caps_malloc\(sizeof\(WebTxBuffer\)/g) || []).length === 1 &&
  web.includes('Web service memory reservation failed; reboot or reflash before START') &&
  main.includes('const bool webServerReady = WebServer::begin()') &&
  main.includes('if (!webServerReady)') &&
  !web.includes('static char   g_webRxBuf[16384]') &&
  !web.includes('static char   g_webTxBuf[16384]'));
expect('maximum legal hardware JSON is streamed independently of fixed web scratch buffers',
  web.includes('new (std::nothrow) AsyncJsonResponse(false)') &&
  web.includes('HardwareConfig::toJson(doc, true)') &&
  web.includes('_configRestoreError = total > 196608UL') &&
  web.includes('len > 196608UL - index') &&
  !web.includes('current hardware exceeds rollback buffer'));
expect('large hardware calibration merges without serialized web-buffer snapshots', (() => {
  const patchRoute = web.slice(web.indexOf('// PATCH /api/hardware'), web.indexOf('// GET /api/ecu_config'));
  return patchRoute.includes('HardwareConfig::toJson(current)') &&
    patchRoute.includes('HardwareConfig::validateJson(current, &HardwareConfig::channelRegistry)') &&
    !patchRoute.includes('HardwareConfig::toJson(g_webTxBuf') &&
    !patchRoute.includes('_serializeJsonBounded(current');
})());
expect('rules and custom conditions accept thrust plus addressable generic I2C channels',
  configCpp.includes('return RulesEngine::THRUST') &&
  configCpp.includes('case 27: return HardwareConfig::hasThrust') &&
  configCpp.includes('rules[i].sensor > RulesEngine::THRUST') &&
  configCpp.includes('ChannelRegistry::channelAddressable(HardwareConfig::channelRegistry.inputs[idx])') &&
  configCpp.includes('return ChannelRegistry::channelAddressable(out) &&') &&
  hwConfig.includes('case 27: return "thrust_main"') &&
  hwConfig.includes('for (uint8_t i = 0; i <= 27; ++i)') &&
  hwConfig.includes('"stop_switch", "thrust"') &&
  main.includes('case 27: return hw.hasThrust') &&
  main.includes('ChannelRegistry::channelAddressable(hw.channelRegistry.inputs[index])'));
expect('afterburner flame availability accepts local and shared-I2C detector adapters',
  hwConfig.includes('c.driver == ChannelRegistry::I2cDigital || c.driver == ChannelRegistry::I2cAnalog') &&
  hwConfig.includes('ChannelRegistry::channelAddressable(c)') &&
  hwConfig.includes('hasAbFlame = true'));
expect('hardware full-engine save refreshes and three-way merges concurrent browser edits',
  hardwareState.includes('function mergeHardwareEdits(') &&
  hardwareState.includes('function mergeHardwareRegistryRows(') &&
  hardwareState.includes("(key === 'inputs' || key === 'outputs')") &&
  hardwareState.includes('_loadedSettingsCfg = cloneHardwareJson(settingsCfg)') &&
  hardwareSave.includes("fetch('/api/ecu_config', {cache:'no-store'})") &&
  hardwareSave.includes('mergeHardwareEdits(_loadedHardwareCfg, saveCfg, latestEngine.hardware)') &&
  hardwareState.includes('function mergeHardwareSettingsCleanup(') &&
  hardwareState.includes('removedRuleKeys.has(JSON.stringify(rule))') &&
  hardwareSave.includes('mergeHardwareSettingsCleanup(_loadedSettingsCfg, settingsCfg, latestEngine.settings)') &&
  hardwareSave.includes("fetch('/api/ecu_config?source=hardware'") &&
  hardwareSave.includes('mergedSettings.profile_id = mergedHardware.profile_id') &&
  hardwareSave.includes('JSON.stringify({hardware:mergedHardware, settings:mergedSettings})') &&
  web.includes('if (hardwareEditorSave)') &&
  web.includes('Config::autoFillNewlyEnabledSafety(prevSafOilT, prevSafFP'));
expect('hardware reboot recap includes every editable registry calibration and routing field',
  hardwareSave.includes("['i2c_address','device_channel'].includes(key)) return driver >= 8") &&
  hardwareSave.includes("key === 'analog_divider'") &&
  hardwareSave.includes("['analog_zero_mv','analog_mv_per_unit'].includes(key)") &&
  hardwareSave.includes("key === 'calibration_points'") &&
  hardwareSave.includes("['loadcell_gain','loadcell_rate_sps','loadcell_zero','loadcell_n_per_count','lever_arm_m'].includes(key)") &&
  hardwareSave.includes("['minimum_flow_l_min','flow_input'].includes(key)") &&
  hardwareSave.includes("if (key === 'has_current') return true") &&
  hardwareSave.includes("value.map(p => `${Number(p.raw)} -> ${Number(p.value)}`"));
expect('I2C digital inputs use active polarity without ignored range or AB inversion fields',
  hardwareCatalog.includes("if (['flame','ab_flame'].includes(registryDerivedPurpose(direction,c))) return ''") &&
  hardwareCatalog.includes('if (d === 0 || d === 8)') &&
  hardwareCatalog.includes('const activeStateEditor = (d === 8') &&
  hardwareSave.includes("!['flame','ab_flame'].includes(registryDerivedPurpose(direction, channel))"));
expect('all ADC threshold inputs keep hysteresis inside the selected threshold rails',
  channelRegistry.includes('const bool thresholdInput') &&
  channelRegistry.includes('c.digitalHysteresisRaw > 2U * railDistance') &&
  hardwareCatalog.includes('const maxHysteresisRaw = Math.max(0,Math.min(2047,2*Math.min(thresholdRaw,4095-thresholdRaw)))') &&
  calibrationHtml.includes('digital_threshold_raw: thr, digital_hysteresis_raw: hysteresis'));
expect('main and afterburner flame use the same registry threshold contract',
  hardware.includes('struct RegistryThresholdLatch') &&
  hardware.includes('return AdcThreshold::logicalValue(state, activeHigh) >= 0.5f') &&
  !hardware.includes('ed.flameSensorRaw > Config::flameThreshold') &&
  hardwareCatalog.includes("['flame','ab_flame'].includes(purpose)") &&
  calibrationHtml.includes("registryCalibrationPatch('flame'") &&
  calibrationHtml.includes('function renderAdcSwitchCalibration') &&
  calibrationHtml.includes('id="fuelpump-min-tools"') &&
  calibrationHtml.includes('id="ab-flame-threshold-tools"'));
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
expect('paired registry and compatibility calibration writes are serialized with a bounded handoff retry',
  calibrationHtml.includes('function patchHardwareThenConfig') &&
  calibrationHtml.includes('patchConfig(configPatch, msg, onConfigOk, 20)') &&
  calibrationHtml.includes('e.status === 409 && gateRetries > 0') &&
  !/patchConfig\([\s\S]{0,850}if \([^\n]*RegistryPatch\) patchHardware/.test(calibrationHtml));
expect('all configured I2C engine outputs participate in pre-start readiness, including cooling fans',
  hardware.includes('!strcmp(p, "cooling_fan")') &&
  hardware.includes('unavailableEngineI2cOutput()'));
expect('starter and ignition loss do not fault an established run but fuel and cooling outputs do',
  hardware.includes('strcmp(p, "starter") && strcmp(p, "starter_enable")') &&
  hardware.includes('strcmp(p, "igniter") && strcmp(p, "ab_igniter")') &&
  hardware.includes('unavailableRunningCriticalI2cOutput()'));
expect('canonical oil NTC applies an optional registry table without losing hardware health checks',
  hardware.includes('channel.temperatureInterface == 4 && channel.calibrationPointCount >= 2') &&
  hardware.includes('ed.oilTempHealthy = ed.oilTempHealthy && isfinite(calibrated)') &&
  hardware.includes('registryAnalogPhysicalInput(ed.oilTempRaw, channel)'));
expect('captured oil-temperature points persist as the same bounded monotonic registry curve',
  calibrationHtml.includes("[0,4].includes(Number(registry.temp_interface || 0))") &&
  calibrationHtml.includes('const points = curve.map(p=>({raw:Math.round(p.raw),value:p.b}))') &&
  calibrationHtml.includes("registryCalibrationPatch('oil_temperature', { calibration_points: points })"));
expect('local registry oil pressure is sampled directly instead of circularly mirroring itself',
  !hardware.includes('ed.registryInputValue[i] = ed.oilPressure') &&
  !hardware.includes('return 6;') &&
  hardware.includes('ed.oilPressure = ed.registryInputValue[oilPressAnalog]'));
expect('canonical torque and thrust consume one registry sample across analog and I2C adapters',
  hardware.includes('const bool registryOwnsTorque') &&
  hardware.includes('ed.torque = ed.registryInputValue[torqueRegistry]') &&
  hardware.includes('ed.thrust = ed.registryInputValue[thrustRegistry]') &&
  hwConfig.includes('thrust->driver == ChannelRegistry::I2cAnalog') &&
  hardwareCatalog.includes("{value:'thrust',label:'Thrust',role:'thrust',drivers:[10,1,9]"));
expect('NTC tables cannot consume the electrical fault rails and threshold-only flame cards do not advertise curves',
  channelRegistry.includes('c.calibrationRaw[0] == 0') &&
  channelRegistry.includes('c.calibrationRaw[c.calibrationPointCount - 1] >= 4095') &&
  channelRegistry.includes('!strcmp(c.role, "flame")') &&
  hardwareCatalog.includes("if (String(c?.role||'') === 'flame') return false"));
expect('calibration PATCH uses the actual persisted channel id after purpose-based lookup',
  calibrationHtml.includes('id:String(card.id)') &&
  calibrationHtml.includes("registryCalibrationPatch('torque',") &&
  !calibrationHtml.includes("registryCalibrationPatch('torque_main',"));
expect('calibration settings save only changed fields and cannot overwrite a stale full snapshot',
  calibrationHtml.includes("fetch('/api/config', {method:'PATCH'") &&
  !calibrationHtml.includes("fetch('/api/config').then"));
expect('session logging settings patch only their owned fields',
  logHtml.includes("method: 'PATCH'") &&
  logHtml.includes('body: JSON.stringify(patch)') &&
  !logHtml.includes("method: 'POST',\n      body: JSON.stringify(cfg)"));
expect('coolant pressure offers the same local and shared-I2C analog adapters as other pressure sensors',
  hardwareCatalog.includes("{value:'coolant_pressure',label:'Coolant pressure',role:'pressure',drivers:[1,9]"));
expect('atomic sequence saves preserve unrelated settings changed after the page was loaded',
  sequenceHtml.includes('loadedHwCfg = cloneSequenceJson(hwCfg)') &&
  sequenceHtml.includes('loadedCfg = cloneSequenceJson(cfg)') &&
  sequenceHtml.includes("fetchJsonWithRetry('/api/hardware')") &&
  sequenceHtml.includes("fetchJsonWithRetry('/api/config')") &&
  sequenceHtml.includes('mergeSequenceEdits(loadedHwCfg, hwCfg, latestHw)') &&
  sequenceHtml.includes('mergeSequenceEdits(loadedCfg, cfg, latestCfg)'));
expect('generic shared-I2C channels are first-class custom-block and control-rule channels',
  sequenceHtml.includes('if (!registryChannelInstalled(c)) return;') &&
  sequenceHtml.includes('registryChannelInstalled(c) && !registryInputCoreBound(c)') &&
  sequenceHtml.includes('registryChannelInstalled(c) && !registryOutputCoreBound(c)') &&
  sequenceHtml.includes('[1,9].includes(Number(c.driver))'));
expect('configured I2C drain and purge valves participate in device-loss guards',
  hardware.includes('!strcmp(p, "purge_valve") || !strcmp(p, "drain_valve")'));
expect('Sequence custom-channel ownership follows semantic canonical owners after channel renames',
  sequenceHtml.includes('RULE_CORE_INPUT_PURPOSES') &&
  sequenceHtml.includes('RULE_CORE_OUTPUT_PURPOSES') &&
  sequenceHtml.includes('return (preferred || peers[0]) === c;'));
expect('every main-engine shutdown entry handles an empty shutdown sequence',
  (main.match(/if \(_shutdownCount == 0\)/g) || []).length >= 3 &&
  main.includes('Startup abort: shutdown sequence empty - immediate all-off to STANDBY'));
expect('STOP-input and startup-sequence faults publish stable fault identities',
  main.includes('g_safety.setExternalFault("STOP_INPUT_LOST")') &&
  main.includes('g_safety.setExternalFault("STARTUP_SEQUENCE_FAULT")') &&
  main.includes('Startup sequence fault at %s'));
expect('web START readiness mirrors canonical STOP health and registry inhibit checks',
  web.includes('ed.stopSwitchConfigured && !ed.stopSwitchHealthy') &&
  web.includes('const char* role = strcmp(channel.purpose, "generic")') &&
  web.includes('!strcmp(role, "inhibit_start")') &&
  web.includes('!ed.registryInputHealthy[i] || ed.registryInputValue[i] >= 0.5f'));
expect('every remappable core actuator is parked before peripheral attachment',
  hardware.includes('parkProportional(hw.hasCoolFan') &&
  hardware.includes('parkProportional(hw.hasBleedValve') &&
  hardware.includes('parkProportional(hw.hasPropPitch') &&
  hardware.includes('parkProportional(hw.hasOilPump, hw.oilPumpPin, hw.oilPumpType, hw.oilPumpActiveH, !hw.oilPumpActiveH)') &&
  hardware.includes('driveInactive(hw.igniterPin, hw.igniterActiveH)') &&
  hardware.includes('driveInactive(hw.glowPlugPin, hw.glowPlugActiveH)'));
expect('registry-owned proportional starter gates use one writer and pass readiness',
  hardware.includes('if (registryOutputManaged(output) && output.pin >= 0) return;') &&
  hardware.includes('if (!starterEnable || starterEnable->driver == ChannelRegistry::Relay)') &&
  hardware.includes('if (!airStarter || airStarter->driver == ChannelRegistry::Relay)') &&
  hardware.includes('if (!output || output->driver == ChannelRegistry::Relay)'));
expect('physical-output activity follows the real core owner and accepts neutral parked pitch',
  outputActivity.includes('const bool core = reg.ownsCoreOutput(c) || reg.boundToCoreOutput(c)') &&
  outputActivity.includes('!strcmp(p, "bleed_valve") || !strcmp(c.id, "bleed_valve")') &&
  outputActivity.includes('demand >= parked - 0.001f && demand <= parked + 0.001f') &&
  outputActivity.includes('return index < ChannelRegistry::MAX_OUTPUT_CHANNELS'));
expect('firmware and Hardware UI enforce fixed-Off boot demand for core engine outputs',
  channelRegistry.includes('const bool fixedOffAtBoot') &&
  channelRegistry.includes('!fixedOffAtBoot || c.safeDemand == 0.0f') &&
  channelRegistry.includes('!strcmp(c.purpose, "pilot_fuel")') &&
  hardwareRegistryView.includes("['ab_valve','pilot_fuel'].includes(purpose)") &&
  hardwareRegistryView.includes('Core engine outputs must initialize Off'));
expect('external conditioned AB flame mode is accepted from UI through runtime',
  configHtml.includes("{v:3,l:'Externally conditioned flame level'}") &&
  configCpp.includes('validInt(ab["flame_mode"], 0, 3)') &&
  configCpp.includes('if (abFlameMode < 0 || abFlameMode > 3)') &&
  abFlameConfirm.includes('case 3:'));
expect('advanced controller selectors and tuning use the normal save-time range contract',
  configCpp.includes('validInt(th["rpm_limiter_mode"], 0, 1)') &&
  configCpp.includes('validNumber(th["rpm_accel_filter"], 0.02f, 1.0f)') &&
  configCpp.includes('validInt(di["idle_mode"], 0, 1)') &&
  configCpp.includes('validNumber(di["learn_rate"], 0.0f, 1.0f)') &&
  configCpp.includes('validInt(ab["torch_guard_mode"], 0, 2)'));
expect('both sensor-based AB evidence modes require usable feedback before fuel',
  main.includes('const bool flameSensorMode = Config::abFlameMode == 0 || Config::abFlameMode == 3') &&
  main.includes('const bool flameInputReady = !flameSensorMode || ed.abFlameHealthy') &&
  main.includes('WAITING FOR FLAME FEEDBACK') &&
  main.includes('WAITING FOR FLAME INPUT OFF'));
expect('AB arm requirement applies to manual FIRE in web and ECU core',
  web.includes('HardwareConfig::abRequiresArmSwitch && !ed.abArmSwitchOn') &&
  web.includes('Afterburner arm switch is not active') &&
  main.includes('(!HardwareConfig::abRequiresArmSwitch || ed.abArmSwitchOn)'));
expect('AB arm permission remains enforced after every trigger path starts',
  main.includes('if (!armPermitted) {') &&
  main.includes('if (ed.abMode != ABMode::Off && ed.abMode != ABMode::ShuttingDown)\n            enterABShutdown();'));
expect('bounded absolute output timers cannot alias the inactive zero sentinel at millis rollover',
  main.includes('static unsigned long deadlineAfter(unsigned long now, unsigned long durationMs)') &&
  main.includes('return deadline ? deadline : 1UL;') &&
  main.includes('_emergencyShutdownUntilMs = deadlineAfter(millis(), 10000UL);') &&
  !main.includes('_startTestUntilMs = millis() +'));
expect('temporary actuator tools and extra cooldown have one mutually exclusive owner',
  main.includes('if (EngineData::instance().extraCooldownActive) return true;') &&
  main.includes('if (anyToolTimerActive()) break;') &&
  main.includes('if (standbyLike && !anyToolTimerActive()) {\n                // fParam gives calibration tools fractional-percent control;') &&
  toolsHtml.includes("btn.disabled = forcedOff || !modeOk || (ecActive && !isToggle)") &&
  toolsHtml.includes("cooldownLocked ? 'Locked · cooldown'"));
expect('starter test countdown includes the configured starter-enable lead time',
  toolsHtml.includes('function starterEnableDelayMs()') &&
  toolsHtml.includes("tool?.id === 'START_TEST' ? starterEnableDelayMs() : 0") &&
  toolsHtml.includes('const runDurationMs = toolRunDurationMs(tool);') &&
  toolsHtml.includes('then starter ${outputText'));
expect('starter-enable settling delay is editable, persisted, and bounded',
  hardwareCatalog.includes('function registryStarterEnableSubcard(c)') &&
  hardwareCatalog.includes("setAct('starter_en','delay_ms',+this.value)") &&
  hwConfig.includes('if (!intRange(item, "delay_ms", 0, 30000)) return false;') &&
  hwConfig.includes('starterEnDelayMs = constrain(starterEnDelayMs, 0, 30000);') &&
  hwConfig.includes('sen["delay_ms"] = starterEnDelayMs;'));
expect('disabling pitch governing releases coarse-safe pitch retained after feedback loss',
  governor.includes('_wasActive || (usePropPitch && _pitchCurrent > 0.0f)') &&
  governor.includes('_releasing = usePropPitch && _pitchCurrent > 0.0f;') &&
  governor.includes('float maxStep      = twoPositionPitch ? 1.0f'));
expect('starter-enable qualification accepts millis zero as a valid start timestamp',
  hardware.includes('const bool starterEnableQualified = starterEnableRequested && starterEnableHealthy;') &&
  hardware.includes('starterEnableQualified &&\n             millis() - starterEnableSinceMs') &&
  !hardware.includes('starterEnableQualified && starterEnableSinceMs &&'));
expect('engine run accounting uses explicit lifecycle state instead of timestamp zero',
  main.includes('static bool          _runTimingActive       = false;') &&
  main.includes('_runTimingActive   = true;') &&
  main.includes('if (_runTimingActive) {') &&
  web.includes('ed.mode == SysMode::RUNNING && !ed.benchMode && !ed.devMode'));
expect('automatic relight window and extra cooldown use explicit idempotent state',
  safety.includes('if (!_relightWindowActive) {') &&
  safety.includes('_relightWindowActive = true;') &&
  main.includes('if (pkt.iParam > 0 && !ed.extraCooldownActive)') &&
  main.includes('} else if (pkt.iParam <= 0) {'));
expect('I2C loss recheck treats millis zero as a valid failure timestamp',
  i2cManager.includes('bool lossActive;') &&
  i2cManager.includes('d->lossActive = true;') &&
  i2cManager.includes('d->lossActive = false;') &&
  lossRecheck.includes('lossSinceMs, bool lossActive') &&
  lossRecheck.includes('return lossActive &&'));
expect('flight recorder run summary uses explicit run lifecycle state',
  flightRecorder.includes('FlightRecorder::_runActive') &&
  flightRecorder.includes('_runActive = true;') &&
  flightRecorder.includes('if (!_runActive) return;') &&
  flightRecorder.includes('_runActive = false;'));
expect('governor handoff and ownership labels reset across non-operating modes',
  hardware.includes('if (mode != SysMode::RUNNING && mode != SysMode::STARTUP) {\n            governorHandoffWasActive = false;') &&
  main.includes('const bool controllersMayOwn = ownerEd.mode == SysMode::STARTUP ||') &&
  main.includes('if (controllersMayOwn && !strncmp(ownerEd.governorControllerState') &&
  main.includes('if (controllersMayOwn && !strncmp(ownerEd.idleControllerState'));
expect('AB fuel and shutdown ignition have a final actuator-boundary invariant',
  hardware.includes('inline void applyAfterburnerCombustionInvariant()') &&
  hardware.includes('const bool fuelPermitted = ed.abMode == ABMode::Igniting ||') &&
  hardware.includes('if (!strcmp(purpose, "ab_valve") || !strcmp(purpose, "ab_pump"))') &&
  hardware.includes('ed.abMode == ABMode::ShuttingDown || ed.abMode == ABMode::Fault') &&
  hardware.includes('applyAfterburnerCombustionInvariant();'));
expect('output channels remain multi-instance while one explicit card owns each built-in controller',
  channelRegistry.includes('if (d == Output) return false;') &&
  hardwareRegistryView.includes('output: new Set()') &&
  hardware.includes('const bool coreOwner = reg.ownsCoreOutput(c);') &&
  hardware.includes('case REG_OUTPUT_FUEL_SHUTOFF: if (coreOwner)') &&
  hardware.includes('case REG_OUTPUT_PROP_PITCH: if (coreOwner)'));
expect('duplicate-purpose output UI shares firmware ownership and keeps auxiliary settings independent',
  channelRegistry.includes('An explicit advanced binding is the clearest statement') &&
  hardwareCatalog.includes('function registryOutputOwnsCorePurpose(c)') &&
  hardwareCatalog.includes('return registryOutputOwnsCorePurpose(c) ? registryCoreActuatorPurposeKey(c) :') &&
  hardwareRegistryView.includes('const engineActuatorPurpose = registryCoreActuatorPurposeKey(c);'));
expect('adding an auxiliary output cannot reset the established primary controller settings',
  hardwareRegistryActions.includes('if (existing === 0) resetRegistryPurposeDefaults(_registryAddDirection, purpose);'));
expect('PWM timing is constrained by real timer capability in firmware and Hardware UI',
  channelRegistry.includes('static bool pwmTimingValid(uint32_t frequency, uint8_t resolution)') &&
  channelRegistry.includes('frequency * (1UL << resolution) <= 80000000UL') &&
  hwConfig.includes('ChannelRegistry::pwmTimingValid(item["fuel_freq_hz"] | 1000') &&
  hardwareCatalog.includes('const maxFreq = Math.min(100000, Math.floor(80000000 /') &&
  hardwareRegistryView.includes('PWM timing is not achievable'));
expect('glow PWM has one canonical timing authority while wet-glow fuel keeps its independent timer',
  hardwareCatalog.includes('Glow PWM carrier and resolution are configured once under Advanced output settings below.') &&
  hardwareCatalog.includes("setAct('glow_plug','fuel_freq_hz'") &&
  !hardwareCatalog.includes("setAct('glow_plug','freq_hz'"));
expect('web START timeout cancels unclaimed work and the ECU discards every canceled request',
  commandQueue.includes('claimPendingResult(uint32_t requestId)') &&
  commandQueue.includes('cancelPendingResult(uint32_t requestId)') &&
  main.includes('!CommandQueue::claimPendingResult(pkt.requestId)') &&
  (web.match(/CommandQueue::cancelPendingResult\(requestId\)/g) || []).length === 2 &&
  web.includes('ECU core did not claim START in time; request canceled'));
expect('pending reboot releases and freezes automation ownership so a rule cannot strand the restart',
  main.includes('if (!WebServer::rebootPending()) RulesEngine::evaluate();') &&
  main.includes('Rule ownership was released above'));
expect('reset recovery follows settled physical demand instead of command intent alone',
  main.includes('if (OutputActivity::anyPhysicalDemand(false)) ResetRecovery::markActive();') &&
  main.indexOf('if (OutputActivity::anyPhysicalDemand(false)) ResetRecovery::markActive();') <
    main.indexOf('Hardware::updateActuators();') &&
  !main.includes('if (mayEnergizeOutput(pkt.cmd)) ResetRecovery::markActive();'));
expect('output re-purpose and removal preserve explicit ownership and stable numeric references',
  hardwareRegistryActions.includes('if (!otherOwner) {') &&
  hardwareRegistryActions.includes('function shiftRegistryNumericHandlesAfterRemoval(') &&
  hardwareRegistryActions.includes('shiftRegistryNumericHandlesAfterRemoval(item.direction, item.index, rows.length);') &&
  hardwareRegistryActions.includes("shiftRegistryNumericHandlesAfterRemoval(direction, index, r[direction + 's'].length);"));
expect('STOP cleanup explicitly clears both bleed-valve state representations',
  main.includes('ed.bleedValveDemand = 0.0f;\n    ed.bleedValveOpen = false;'));

console.log(`Safety regression audit passed (${checks.length} checks).`);
