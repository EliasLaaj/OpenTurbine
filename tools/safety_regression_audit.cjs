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

const configSerialize = read('src/system/ConfigSerialize.cpp');
const configCpp = read('src/system/Config.cpp') + configSerialize;
const configHtml = read('data_src/config.html');
const hardware = read('src/Hardware.h');
const hwConfig = read('src/system/HardwareConfig.cpp') +
  read('src/system/HardwareConfigSerialize.cpp');
const main = read('src/main.cpp');
const nothrowNew = read('src/platform/esp32/NothrowNew.cpp');
const web = read('src/system/web/WebServer.cpp');
const webApp = read('data_src/app.js');
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
const relayDemand = read('src/hal/actuators/RelayDemand.h');
const relayActuator = read('src/hal/actuators/RelayActuator.h');
const pcbProfileManager = read('src/system/pcb/PcbProfileManager.cpp');
const lossRecheck = read('src/hal/i2c/LossRecheck.h');
const ntc = read('src/hal/sensors/NTCSensor.h');
const sequenceHtml = read('data_src/sequence.html');
const sequenceRules = read('data_src/pages/sequence-editor.js');
const sequenceState = read('data_src/pages/sequence-state.js');
const sequenceIgnition = read('src/engine/sequencer/SequenceIgnition.h');
const abIgnite = read('src/engine/sequencer/blocks/ABIgnite.h');
const hardwareHtml = read('data_src/hardware.html');
const hardwareCatalog = read('data_src/pages/hardware-registry-catalog.js');
const hardwareSave = read('data_src/pages/hardware-save.js');
const hardwareState = read('data_src/pages/hardware-state.js');
const hardwareRegistryView = read('data_src/pages/hardware-registry-view.js');
const hardwareRegistryActions = read('data_src/pages/hardware-registry-actions.js');
const configRender = read('data_src/pages/config-render.js');
const registryFaultSafeEditor = hardwareHtml.match(
  /function registryFaultSafeEditor[\s\S]*?function registryPwmTimingEditor/
)?.[0] || '';
const customControllerRenderer = configRender.match(
  /function renderSimpleControls[\s\S]*?\/\/ ── Render form/
)?.[0] || '';
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
const buildPatches = read('tools/pio_s3_dynconfig.py');

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
expect('nothrow allocation returns null instead of aborting a heap-starved network task',
  nothrowNew.includes('operator new(std::size_t size, const std::nothrow_t&) noexcept') &&
  nothrowNew.includes('operator new[](std::size_t size, const std::nothrow_t&) noexcept') &&
  (nothrowNew.match(/std::malloc\(size \? size : 1\)/g) || []).length === 2);
expect('settings candidates release the merged JSON tree before opening LittleFS',
  configSerialize.includes('serializeJson(doc, scratch, scratchLen)') &&
  configSerialize.indexOf('serializeJson(doc, scratch, scratchLen)') <
    configSerialize.indexOf('doc.clear();') &&
  configSerialize.indexOf('doc.clear();') <
    configSerialize.indexOf('_saveSettingsJson(persistedCandidate, required)'));
expect('full engine restore atomically writes the uploaded runtime hardware instead of recopying the old file',
  web.includes('Config::save(true)') &&
  configCpp.includes('if (!writeRuntimeHardware && hadSourceConfig && ok)') &&
  configCpp.includes('if (hadSourceConfig && !writeRuntimeHardware)'));
expect('PCNT failures are recoverable',
  !pcnt.includes('ESP_ERROR_CHECK') && pcnt.includes('feedback disabled without reboot'));
expect('analog filters use four samples', analog.includes('RollingAvg<4> _avg'));
expect('native, registry, I2C, and PCB-profile relays share nonzero and polarity semantics',
  relayDemand.includes('return demand > 0.0f') &&
  relayActuator.includes('RelayDemand::requested(value)') &&
  hardware.includes('RelayDemand::physicalLevel(demand, c.inverted)') &&
  i2cManager.includes('RelayDemand::physicalLevel(demand, c.inverted)') &&
  pcbProfileManager.includes('RelayDemand::physicalLevel(first.safeDemand, !first.activeHigh)'));
expect('relay propeller pitch remains an explicit midpoint two-position command',
  hardware.includes('RelayDemand::binary(RelayDemand::midpoint(demand))') &&
  hardware.includes('RelayDemand::binary(RelayDemand::midpoint(ed.propPitchDemand))'));
expect('oil-pressure mapping is explicit',
  !hwConfig.includes('"oil_pressure_main", "pressure"'));
expect('legacy oil loop binds explicit oil-pressure purpose',
  hwConfig.includes('strcmp(candidate.purpose, "oil_pressure")') &&
  hwConfig.includes('if (matches != 1) pressure = nullptr') &&
  !hwConfig.includes('strcmp(candidate.role, "pressure")'));
expect('battery mapping is explicit',
  !hwConfig.includes('"battery_voltage", "voltage"'));
expect('all operational N2 paths follow the fitted sensor rather than the retired master flag',
  main.includes('case 6:  return hw.hasN2Rpm;') &&
  configCpp.includes('case 6:  return HardwareConfig::hasN2Rpm;') &&
  rulesEngine.includes('case N2_RPM:          return HardwareConfig::hasN2Rpm && ed.n2Healthy;') &&
  web.includes('doc["has_n2"]                = HardwareConfig::hasN2Rpm;') &&
  !flightRecorder.includes('hasTwoShaft &&'));
expect('OTA and START share the canonical output-demand scan',
  (web.match(/OutputActivity::anyPhysicalDemand/g) || []).length >= 2 &&
  web.includes('OutputActivity::anyPhysicalDemand(false)') &&
  web.includes('OutputActivity::anyPhysicalDemand(true)'));
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
  main.includes('ChannelRegistry::driverIsOnOffOutput(selected->driver)') &&
  main.includes('loopPct = 100.0f') && main.includes('loopPct = 0.0f') &&
  main.includes('RulesEngine::applyActuatorDemand((uint8_t)selectedActuator'));
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
  channelRegistry.includes('c.driver == Relay || c.driver == I2cRelay') &&
  hardwareCatalog.includes('This relay-style output is a simple on/off igniter') &&
  hardwareSave.includes('c.ignition_mode = 0') &&
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
expect('current-trip feedback loss follows canonical demand for every physical output',
  safety.includes('#include "../system/OutputActivity.h"') &&
  safety.includes('OutputActivity::hasPhysicalEndpoint(c)') &&
  safety.includes('OutputActivity::logicalDemand(c, i, ed)') &&
  !safety.includes('!reg.ownsCoreOutput(c) && RelayDemand::requested(ed.registryOutputDemand[i])') &&
  !safety.includes('HardwareConfig::hasOilPumpCurrentSensor && HardwareConfig::oilPumpCurrentMaxAmps'));
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
expect('repeatable general typed sensors remain first-class registry inputs',
  ['general_temperature','general_pressure','general_flow','general_current',
   'general_voltage','general_torque','general_thrust'].every(purpose =>
    channelRegistry.includes(`"${purpose}"`)) &&
  hardwareHtml.includes('General temperature') &&
  hardwareHtml.includes('General pressure') &&
  hardwareHtml.includes('General flow') &&
  hardwareHtml.includes('General current'));
expect('each glow plug owns the behavior used by its exact sequence target',
  main.includes('output->ignitionHoldDemand') &&
  main.includes('const float demand = on ? _onDemand : 0.0f') &&
  hardwareCatalog.includes('Ignition behavior for this glow plug') &&
  hardwareCatalog.includes('Paired start-fuel output') &&
  !configHtml.includes('Shared preheat profile used by Glow Preheat sequence blocks'));
expect('windmilling oil protection is explicit opt-in and cannot drive a pump while disabled',
  configCpp.includes('standbyOilEnabled   = false') &&
  main.includes('!Config::standbyOilEnabled || !selectedUsable') &&
  configHtml.includes('Enable Windmilling Oil Protection'));
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
expect('gradual limiters share the physical fuel floor but tune each feedback response independently',
  throttleSlew.includes('(unrestrictedTarget - floor) * over * sourceStrength') &&
  throttleSlew.includes('n1LookaheadMs') && throttleSlew.includes('egtLookaheadMs') &&
  !throttleSlew.includes('float authority') &&
  configHtml.includes('N1 Fuel-Limiting Mode') && configHtml.includes('Temperature Fuel-Limiting Mode') &&
  configHtml.includes('Simple — measured value') && configHtml.includes('Advanced — predictive') &&
  !configHtml.includes('N1 Reduction Method'));
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
expect('dedicated temperature interfaces ignore irrelevant analog range fields',
  channelRegistry.includes('c.temperatureInterface != 0') &&
  channelRegistry.includes('return temperatureInterfaceValid(c)'));
expect('low-temperature interfaces cannot masquerade as turbine-gas feedback',
  channelRegistry.includes('const bool lowTemperaturePurpose') &&
  channelRegistry.includes('if (!lowTemperaturePurpose || turbineGasPurpose) return false') &&
  hardwareHtml.includes('NTC and DS18B20 interfaces require a low-range or general temperature purpose'));
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
  hwConfig.includes('if (!registryStop && stopPin < 0 && !PcbProfileManager::active()) return false') &&
  (hwConfig.match(/assign the required Stop switch to a PCB connection in Hardware/g) || []).length === 2 &&
  hwConfig.includes('(startPin >= 0 && !gpioAllowed(startPin))'));
expect('standby control-rule masks survive validation and both load paths',
  configCpp.includes('validInt(rule["mode_mask"], 1, 15)') &&
  (configCpp.match(/modeMask &= 0x0F/g) || []).length === 2 &&
  !configCpp.includes('r.modeMask &= 0x0E') &&
  !configCpp.includes('rules[i].modeMask &= 0x0E'));
expect('full restore publishes its reboot guard before releasing maintenance ownership',
  (() => {
    const route = web.slice(web.indexOf('POST /api/ecu_config'), web.indexOf('// 404'));
    const reply = route.lastIndexOf('req->send(200, "application/json"');
    const guard = route.lastIndexOf('_scheduleRestart("engine config restore")');
    const release = route.lastIndexOf('_finishConfigRestore()');
    return reply >= 0 && reply < guard && guard < release;
  })());
expect('Classic full restore streams the exact validated settings and borrows fixed web workspaces safely',
  web.includes('static constexpr const char* SETTINGS_STAGE = "/config_apply.tmp"') &&
  web.includes('static constexpr const char* HARDWARE_STAGE = "/ecu_config.hardware.tmp"') &&
  web.includes('heap_caps_free(g_webRxStorage)') &&
  web.includes('heap_caps_free(g_webTxStorage)') &&
  web.includes('Config::saveStagedJsonCandidate(uploadedSettingsLen, true)') &&
  configCpp.includes('bool Config::saveStagedJsonCandidate(size_t settingsLen'));
expect('registry import enforces the browser purpose-role-driver contract',
  channelRegistry.includes('purposeRoleDriverValid(c.direction, c.purpose, c.role, c.driver)') &&
  channelRegistry.includes('if (!strcmp(purpose, "main_fuel")) return output("fuel", false, true, true, false)') &&
  channelRegistry.includes('!strcmp(purpose, "ab_flame")'));
expect('repeatable safety switches retain independent pins and aggregate any-active with all-channel health',
  channelRegistry.includes('!strcmp(purpose, "ab_flame")') &&
  channelRegistry.includes('!strcmp(purpose, "ab_command")') &&
  channelRegistry.includes('if (!strcmp(purpose, "start_switch") || !strcmp(purpose, "stop_switch")') &&
  main.includes('healthy = healthy && channelHealthy;') &&
  main.includes('active = active || (channelHealthy && ed.registryInputValue[i] >= 0.5f);') &&
  !read('data_src/pages/hardware-registry-view.js').includes("'start_switch','stop_switch','low_oil_switch','oil_zero_switch'") &&
  hwConfig.includes('(!registryStop && !addPin(stopPin))') &&
  !hwConfig.includes('if (canonicalControl) continue;') &&
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
  sessionLogger.includes('if (Config::sessionLogMask == 0 && _registryCaptureMask == 0)') &&
  sessionLogger.includes('_startPending = false;'));
expect('general sensor session logging persists and resolves stable selected channel IDs',
  configSerialize.includes('sl["registry_inputs"].as<JsonArrayConst>()') &&
  configSerialize.includes('sl["registry_inputs"].to<JsonArray>()') &&
  sessionLogger.includes('_prepareRegistryCaptureMask()') &&
  sessionLogger.includes('Config::sessionRegistryInputIds[selected]') &&
  sessionLogger.includes('row.registryInputs[i] = ed.registryInputValue[i]'));
expect('logging UI offers each fitted general sensor independently',
  logHtml.includes('data-registry-log-id') &&
  logHtml.includes("purpose.startsWith('general_')") &&
  logHtml.includes('patch.session_log.registry_inputs') &&
  !logHtml.includes('data-bit="general_inputs"'));
expect('flash persistence is prohibited while engine control is active',
  web.includes('const bool storageWritesSafe = mode == SysMode::STANDBY || mode == SysMode::FAULT') &&
  web.includes('if (storageWriteWindow) FlightRecorder::runEviction()') &&
  web.includes('if (storageWriteWindow) SessionLogger::drainQueue()') &&
  web.includes('if (storageWriteWindow && !_hwRebootPending) Config::flushPendingSave()') &&
  web.includes('if (storageWriteWindow) Config::flushPendingRuntimeStats()'));
expect('flash-backed asset responses lease LittleFS against concurrent writes',
  web.includes('class LeasedAssetResponse final : public AsyncAbstractResponse') &&
  web.includes('++s_activeAssetResponses') &&
  web.includes('if (s_activeAssetResponses) --s_activeAssetResponses') &&
  web.includes('new (std::nothrow) LeasedAssetResponse(source, path, contentType)') &&
  web.includes("File source = LittleFS.open(path, \"r\")") &&
  web.includes('~LeasedAssetResponse() override') &&
  web.includes('_releaseAssetResponseLease();') &&
  web.includes('s_storageWriteActive = true') &&
  web.includes('if (storageWriteWindow) _endStorageWriteWindow()'));
expect('config UI PATCH sends only recap-listed changed fields',
  configHtml.includes('const changedKeys = new Set(_buildChanges().map(change => change.key))') &&
  configHtml.includes('if (!changedKeys.has(field.key)) return') &&
  !configHtml.includes('let payload = cfg'));
expect('config UI does not race a full settings reread after minimal PATCH',
  configHtml.includes('Developer-Mode live tuning is deliberately kept') &&
  !configHtml.includes('cfg = await fetchAppliedConfig()'));
const pioHook = fs.readFileSync(path.join(root, 'tools', 'pio_s3_dynconfig.py'), 'utf8');
expect('Tools polls compact live telemetry after loading its configuration and hardware documents',
  toolsHtml.includes("fetchJsonWithTimeout('/api/telemetry', 3000)") &&
  !toolsHtml.includes("fetchJsonWithTimeout('/api/data', 3000)"));
expect('Classic and S3 browser telemetry use one compact persistent HTTP transport',
  webApp.includes("fetch('/api/telemetry'") &&
  webApp.includes('return 500;') &&
  !webApp.includes('new WebSocket(') &&
  !webApp.includes("info?.target !== 'esp32dev'"));
expect('runtime configuration heap pressure fails without rebooting the ECU',
  main.includes('Config apply abandoned without reboot') &&
  !main.includes('rebooting safely into persisted settings'));
expect('mirrored outputs use an explicit stable source and retain independent electrical protection',
  hardware.includes('if (c.mirrorOf[0])') &&
  hardware.includes('OutputActivity::logicalDemand(*source, sourceIndex, ed)') &&
  channelRegistry.includes('char mirrorOf[20]') &&
  channelRegistry.includes('currentTripDelayMs'));
expect('one canonical output activity lookup follows applied fuel and qualified starter demand',
  outputActivity.includes('ed.mainFuelAppliedDemand') &&
  outputActivity.includes('ed.effectiveStarterDemand') &&
  hardware.includes('OutputActivity::logicalDemand(c, i, ed)') &&
  !hardware.includes('auto sourceDemand ='));
expect('bleed valve has one built-in owner across native and I2C output paths',
  channelRegistry.includes('!strcmp(purpose, "bleed_valve")') &&
  outputActivity.includes('return constrain(ed.bleedValveDemand, 0.0f, 1.0f)') &&
  hardware.includes('case REG_OUTPUT_BLEED_VALVE: if (coreOwner)'));
expect('HTTP TIME_WAIT diagnostics never mutate live lwIP PCB state',
  web.includes('if (pcb->local_port == 80) ++count;') &&
  web.includes('s_httpTimeWaitPcbs = count') &&
  !web.includes('tcp_abort(oldest)') &&
  !web.includes('MIN_REAP_AGE_TICKS'));
expect('HTTP completion leaves advertised close ownership with the peer',
  pioHook.includes('Let the HTTP peer retire completed') &&
  pioHook.includes('a short page tour exhausts Classic. Waiting') &&
  pioHook.includes('for the peer FIN moves TIME_WAIT') &&
  pioHook.includes('if (!_response->_finished())') &&
  !pioHook.includes('AsyncTCP retains the PCB and retries'));
expect('AsyncTCP retries graceful close instead of aborting queued response bytes',
  pioHook.includes('patch_asynctcp_graceful_close') &&
  pioHook.includes('_bind_tcp_callbacks(pcb, msg->close)') &&
  pioHook.includes('retry on a later ACK instead of truncating via abort()'));
expect('cold browser asset streams use one MSS each to bound Classic peak heap',
  pioHook.includes('patch_async_webserver_stream_buffer') &&
  pioHook.includes('#define ASYNC_RESPONCE_BUFF_SIZE CONFIG_LWIP_TCP_MSS') &&
  pioHook.includes('lowers first-page memory pressure'));
expect('fixed-length streams drain their final pending chunk before graceful close',
  pioHook.includes('patch_async_webserver_final_stream_flush') &&
  pioHook.includes('Do not enter RESPONSE_END here') &&
  pioHook.includes('next ACK drains'));
expect('HTTP accept rejects low-memory requests without throwing through firmware',
  pioHook.includes('new (std::nothrow) AsyncWebServerRequest') &&
  pioHook.includes('#include <new>') &&
  pioHook.includes('ESP.getFreeHeap() < 16384') &&
  pioHook.includes('ESP.getMaxAllocHeap() < 4096'));
expect('top-level HTTP response allocation fails closed instead of terminating on fragmented heap',
  pioHook.includes('patch_async_webserver_responses') &&
  pioHook.includes('new (std::nothrow) AsyncBasicResponse'));
expect('HTTP requests retain only headers needed after parsing on the Classic heap',
  pioHook.includes('patch_async_webserver_header_retention') &&
  pioHook.includes('const bool retainHeader') &&
  pioHook.includes('Sec-WebSocket-Key') &&
  pioHook.includes('If-None-Match'));
expect('protocol-owned HTTP response headers do not allocate STL nodes at send time',
  pioHook.includes('patch_async_webserver_default_response_headers') &&
  pioHook.includes('appendDefault(T_Connection, T_close)') &&
  pioHook.includes('char contentLength[24]') &&
  pioHook.includes('without allocating std::list nodes'));
expect('Classic rejects unrelated HTTP work while an atomic config apply owns its candidate buffer',
  web.includes('request->method() == HTTP_GET &&') &&
  web.includes('(ConfigApplyGate::busy() || _maintenanceUploadInProgress() ||') &&
  web.includes('AsyncBasicResponse builds several throwing STL header nodes'));
expect('OTA releases live browser telemetry before streaming flash data',
  web.includes('OTA is a maintenance takeover') &&
  web.includes('_releaseLiveTelemetryWorkspace();'));
expect('maintenance transactions release disposable compact telemetry state',
  web.includes('static void _releaseLiveTelemetryWorkspace()') &&
  web.includes('s_restTelemetryDoc.clear();') &&
  web.includes('s_restTelemetryDoc.shrinkToFit();'));
expect('config PATCH releases its large temporary JSON tree before allocating the response',
  /ConfigApplyGate::publishCandidate\([\s\S]{0,700}current\.clear\(\);[\s\S]{0,200}current\.shrinkToFit\(\);[\s\S]{0,200}req->send\(200, "application\/json", active/.test(web));
expect('Developer live tuning avoids flash and defers persistence until outputs are safe',
  web.includes('Live tuning must never program or read flash while the ECU') &&
  /publishCandidate\(candidateJson, candidateLen,\s*activePatch \? 100 : 1000,\s*activePatch\)/.test(web) &&
  web.includes('persist\\\":\\\"deferred_until_safe') &&
  main.includes('Config::applyJsonLivePatch(candidate)') &&
  main.includes('if (!livePatchCandidate && hasCandidate && !retryForHeap)') &&
  main.includes('if (livePatchCandidate) Config::requestSave();') &&
  configCpp.includes('bool Config::applyJsonLivePatch(const JsonDocument& patch)'));
expect('settings saves retire disposable live telemetry before constructing full validation trees',
  (web.match(/_releaseLiveTelemetryWorkspace\(\);/g) || []).length >= 4 &&
  web.includes('handoff live instead of rebooting into the persisted file'));
expect('live telemetry has no dead WebSocket transport or client ownership state',
  !web.includes('AsyncWebSocket') &&
  !web.includes('s_activeWsClient') &&
  !web.includes('_sendTelemetryFrame') &&
  !web.includes('_ws.cleanupClients'));
expect('Classic live telemetry is a bounded complete REST document',
  web.includes('static constexpr size_t COMPACT_TELEMETRY_MAX = 1400;') &&
  web.includes('static size_t _buildCompactTelemetry(') &&
  web.includes('measured > COMPACT_TELEMETRY_MAX') &&
  web.includes('_sendOwnedJson(req, g_webTxBuf, n)'));
expect('OTA success uses delayed guarded restart so its HTTP response can leave first',
  web.includes('_scheduleRestart("firmware OTA", 3000)') &&
  !web.includes('if (_otaPendingRestart) {\n        _restartCleanly("firmware OTA")'));
expect('active session logging buffers a bounded newest tail in RAM',
  sessionLogger.includes('SESSION_QUEUE_ROWS = 64') &&
  sessionLogger.includes('xQueueReceive(_rowQueue, &oldest, 0)') &&
  sessionLogger.includes('_acceptRows = true;') &&
  sessionLogger.includes('if (!_acceptRows || !_rowQueue) return;') &&
  sessionLogger.includes('(_acceptRows || _startPending || _endPending || _open) ? "" : _currentPath'));
expect('compact telemetry keeps live session-recorder state current',
  web.includes('doc["session_dropped_rows"] = SessionLogger::droppedRows();') &&
  web.includes('doc["session_queued_rows"] = SessionLogger::queuedRows();') &&
  web.includes('doc["session_logger_healthy"] = SessionLogger::healthy();') &&
  web.includes('doc["session_capture_active"] = SessionLogger::captureActive();') &&
  web.includes('doc["session_log_path"] = SessionLogger::currentPath();'));
expect('session logger reports an unavailable queue instead of pretending to record',
  /void SessionLogger::startSession\(\) \{[\s\S]{0,300}if \(!_rowQueue\) \{[\s\S]{0,180}_healthy = false;[\s\S]{0,100}_errorCode = 1;/.test(sessionLogger));
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
expect('fuel and ignition safety descriptions cover every firmware immediate-cut purpose',
  ['main_fuel','fuel_shutoff','fuel_pump','pilot_fuel','igniter','ab_igniter',
   'ab_valve','ab_pump','glow_plug'].every(purpose =>
    registryFaultSafeEditor.includes(`'${purpose}'`) &&
    customControllerRenderer.includes(`'${purpose}'`)));
expect('generic output overcurrent shutdown preserves the configured actuator name',
  safety.includes('_trigger("OUTPUT_OVERCURRENT", c.name[0] ? c.name : c.id);') &&
  safety.includes('strcmp(code, "OUTPUT_OVERCURRENT") == 0') &&
  safety.includes('detail && detail[0] ? detail : "An output"'));
expect('accepted STOP and fault transitions cut hazardous hardware before sensor work',
  hardware.includes('inline void cutHazardousOutputsNow(bool includeStarter = true)') &&
  hardware.includes('Oil, scavenge and cooling outputs are deliberately left') &&
  main.includes('if (writePhysical) Hardware::cutHazardousOutputsNow();') &&
  main.indexOf('checkStopSwitch();') < main.indexOf('Hardware::updateSensors();'));
expect('standalone start fuel is not overwritten by wet-glow ownership',
  hardware.includes('const bool wetGlowOwned') &&
  hardware.includes('hw.hasGlowPlug && hw.glowPlugType == 2') &&
  !hardware.includes('if (!strcmp(c.purpose, "pilot_fuel") ||\n                !strcmp(c.purpose, "wet_glow_fuel"))'));
expect('wet-glow registry fuel has one supported pilot-fuel purpose and owner',
  !hardware.includes('REG_OUTPUT_WET_GLOW_FUEL') &&
  !hardware.includes('g_registryOutputPlan.wetGlowFuel') &&
  !outputActivity.includes('wet_glow_fuel') &&
  !registryFaultSafeEditor.includes("'wet_glow_fuel'") &&
  !customControllerRenderer.includes("'wet_glow_fuel'"));
expect('critical safety capability checks reject generic temperature and voltage roles',
  !capabilities.includes('hasInputRole("temperature")') && !capabilities.includes('hasInputRole("voltage")'));
expect('cooldown defaults agree at sixty seconds',
  cooldown.includes('timeoutMs          = 60000') &&
  sequenceHtml.includes("def:60000, configKey:'cooldown_timeout_ms'"));
expect('configuration warnings describe actual startup and cooldown ordering',
  configHtml.includes('later spool stage may already be satisfied') &&
  configHtml.includes('Startup may pass and then immediately fault') &&
  sequenceHtml.includes('Cooldown may complete immediately while the turbine is still hot'));
expect('custom controllers disclose single ownership and safety authority',
  configHtml.includes('One normal owner per output') &&
  configHtml.includes('STOP, FAULT, and hardware safety remain authoritative'));
expect('custom feedback control has target-source choices, bumpless handover, and bounded PI state',
  configHtml.includes('Hold a feedback target') &&
  configHtml.includes('Two-state switch') && configHtml.includes('Variable input mapping') &&
  rulesEngine.includes('FeedbackControlMath::step') &&
  rulesEngine.includes('Automatic Idle is a floor') &&
  rulesEngine.includes('ed.dynamicIdleFloorDemand'));
expect('custom controllers expose normal operating states but never FAULT ownership',
  configHtml.includes('When this controller is active') &&
  configHtml.includes('Standby') && configHtml.includes('Startup') &&
  configHtml.includes('Running') && configHtml.includes('Shutdown') &&
  rulesEngine.includes('FAULT is never an automation state'));
expect('built-in auxiliary requests remain authoritative beside optional user controllers',
  configHtml.includes('Built-in turbine subsystems') &&
  configHtml.includes('They do not prevent a separate normal output controller') &&
  rulesEngine.includes('_usesAdditiveSubsystemAuthority') &&
  rulesEngine.includes('demand = max(demand, baseDemand)'));
expect('starter-enable output resolves as a supported custom on-off target',
  configCpp.includes('starter_enable_main') &&
  configCpp.includes('case 6:  return HardwareConfig::hasStarterEn'));
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
expect('auxiliary actuator limits follow the explicit primary owner instead of registry order',
  hardware.includes('if (reg.ownsCoreOutput(c))') &&
  hardware.includes('Use the explicit core owner, never the') &&
  !hardware.includes('kind == REG_OUTPUT_COOLING_FAN && g_registryOutputPlan.coolingFan < 0') &&
  channelRegistry.includes('Several %s outputs are fitted; select one primary device'));
expect('shared wet-glow pilot fuel is used only when exactly one candidate exists',
  hardware.includes('if (pilotFuelCount == 1) g_registryOutputPlan.pilotFuel = solePilotFuel') &&
  hardware.includes('Device-local wet-glow pairing is preferred'));
expect('normal sequence ignition cleanup is exact while emergency cuts remain category-wide',
  sequenceIgnition.includes('sequenceIgnitionMask') &&
  sequenceIgnition.includes('RulesEngine::applyActuatorDemand') &&
  sequenceIgnition.includes('ed.igniter2On = false') &&
  abIgnite.includes('setSequenceIgnitionTracked(outputIndex, true)') &&
  sequenceState.includes('clearTrackedIgnitionPreviewState') &&
  main.includes('cutCombustionAndStarterNow()'));
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
expect('TX and RX workspaces are reserved before Wi-Fi service starts',
  web.includes('#if defined(CONFIG_IDF_TARGET_ESP32S3)') &&
  web.includes('using WebRxBuffer = char[24576]') &&
  web.includes('using WebRxBuffer = char[16384]') &&
  web.includes('using WebTxBuffer = char[16384]') &&
  web.includes('using WebTxBuffer = char[12288]') &&
  web.includes('static WebRxBuffer* _allocateWebRxStorage()') &&
  web.includes('g_webRxStorage = _allocateWebRxStorage()') &&
  web.includes('if (!g_webRxStorage || !g_webTxStorage)') &&
  web.includes('g_webRxLen = 0;') &&
  !web.includes('released = g_webRxStorage') &&
  (web.match(/heap_caps_malloc\(sizeof\(WebTxBuffer\)/g) || []).length === 1 &&
  main.includes('const bool webServerReady = WebServer::begin()') &&
  main.includes('Web server unavailable - physical engine control remains available') &&
  !main.includes('if (!webServerReady)') &&
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
  web.includes('if (configurationEditorSave)') &&
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
  calibrationHtml.includes('window.OTSaveConfigPatch(patch)') &&
  webApp.includes("fetch('/api/config', {") &&
  webApp.includes("method:'PATCH'") &&
  webApp.includes("const engineResponse = await fetch('/api/ecu_config', {cache:'no-store'});") &&
  webApp.includes('merge(engine.settings, patch);') &&
  !calibrationHtml.includes("fetch('/api/config').then"));
expect('session logging settings patch only their owned fields',
  logHtml.includes('const patch = {') &&
  logHtml.includes('session_log:{interval_ms:Math.round(sessionInterval)}') &&
  logHtml.includes('patch.session_log.registry_inputs =') &&
  logHtml.includes('window.OTSaveConfigPatch(patch)'));
expect('coolant pressure offers the same local and shared-I2C analog adapters as other pressure sensors',
  hardwareCatalog.includes("{value:'coolant_pressure',label:'Coolant pressure',role:'pressure',drivers:[1,9]"));
expect('atomic sequence saves preserve unrelated settings changed after the page was loaded',
  sequenceHtml.includes('loadedHwCfg = cloneSequenceJson(hwCfg)') &&
  sequenceHtml.includes('loadedCfg = cloneSequenceJson(cfg)') &&
  sequenceHtml.includes("fetchJsonWithRetry('/api/hardware')") &&
  sequenceHtml.includes("fetchJsonWithRetry('/api/config')") &&
  sequenceHtml.includes('mergeSequenceEdits(loadedHwCfg, hwCfg, latestHw)') &&
  sequenceHtml.includes('mergeSequenceEdits(loadedCfg, cfg, latestCfg)'));
expect('generic shared-I2C channels are first-class custom-block and simple-control channels',
  sequenceHtml.includes('if (!registryChannelInstalled(c)) return;') &&
  sequenceHtml.includes('if (registryInputCoreBound(c)) return;') &&
  sequenceHtml.includes("if (!registryChannelInstalled(c) || String(c.mirror_of || '') || registryOutputCoreBound(c)) return;") &&
  configHtml.includes('function simpleControlInputs()') &&
  configHtml.includes('function simpleControlOutputs()'));
expect('configured I2C drain and purge valves participate in device-loss guards',
  hardware.includes('!strcmp(p, "purge_valve") || !strcmp(p, "drain_valve")'));
expect('Sequence custom-channel ownership follows semantic canonical owners after channel renames',
  sequenceHtml.includes('SEQUENCE_CORE_INPUT_PURPOSES') &&
  sequenceHtml.includes('SEQUENCE_CORE_OUTPUT_PURPOSES') &&
  sequenceHtml.includes('return (preferred || peers[0]) === channel;'));
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
  outputActivity.includes('if (!strcmp(p, "bleed_valve"))') &&
  hwConfig.includes('strlcpy(output.purpose, "bleed_valve", sizeof(output.purpose))') &&
  outputActivity.includes('demand >= parked - 0.001f && demand <= parked + 0.001f') &&
  outputActivity.includes('return index < ChannelRegistry::MAX_OUTPUT_CHANNELS'));
expect('pitch park zero survives serialization and hardware-save restart handoff',
  channelRegistry.includes('c.safeDemand != 0.0f || !strcmp(c.purpose, "prop_pitch")') &&
  web.includes('float parkedPitch = HardwareConfig::hasPropPitch ? 1.0f : 0.0f') &&
  web.includes('EngineData::instance().propPitchDemand = parkedPitch'));
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
  configCpp.includes('const char* limiterModes[]') &&
  configCpp.includes('pullback_n1_mode') && configCpp.includes('pullback_egt_lookahead_ms') &&
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
expect('automatic relight trigger and extra cooldown use explicit idempotent state',
  safety.includes('if (!_relightLatched &&') &&
  safety.includes('_relightLatched = true;') &&
  main.includes('if (pkt.iParam > 0 && !ed.extraCooldownActive)') &&
  main.includes('} else if (pkt.iParam <= 0) {'));
expect('combustion-loss shutdown and automatic relight are independent monitors',
  safety.includes('Independent combustion-loss protection') &&
  safety.includes('Config::relightEnabled') &&
  safety.includes('_relightTriggerLost(ed)') &&
  safety.includes('_trigger("FLAMEOUT")') &&
  main.includes('g_safety.setExternalFault("RELIGHT_FAILED")') &&
  configHtml.includes('How Relight Is Triggered') &&
  configHtml.includes('does not enable, disable, or delay the separate combustion-loss shutdown protection'));
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
expect('flight recorder event snapshots and run summaries omit unfitted sensors',
  flightRecorder.includes('if (hw.hasN1Rpm)') &&
  flightRecorder.includes('if (hw.hasTot)') &&
  flightRecorder.includes('if (HardwareConfig::hasN1Rpm && s_runN1Seen)') &&
  flightRecorder.includes('if (HardwareConfig::hasTot && s_runTotSeen)') &&
  (flightRecorder.match(/appendFittedSensorFields\(buf, sizeof\(buf\), n\)/g) || []).length === 4);
expect('flight recorder run peaks reject unhealthy samples and omit never-valid fields',
  flightRecorder.includes('hw.hasN1Rpm && ed.n1Healthy') &&
  flightRecorder.includes('hw.hasN2Rpm && ed.n2Healthy') &&
  flightRecorder.includes('hw.hasTot && ed.totHealthy') &&
  flightRecorder.includes('hw.hasTit && ed.titHealthy') &&
  flightRecorder.includes('hw.hasOilPress && ed.oilHealthy') &&
  flightRecorder.includes('if (s_runOilSeen)'));
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
  hardwareCatalog.includes('PWM carrier frequency (Hz)') &&
  hardwareCatalog.includes('paired_output_delay_ms') &&
  hardwareCatalog.includes('Pilot-fuel delay (ms)') &&
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
expect('bleed, fan and scavenge On/Off telemetry derives from canonical demand',
  web.includes('RelayDemand::requested(ed.bleedValveDemand)') &&
  web.includes('RelayDemand::requested(ed.coolFanDemand)') &&
  web.includes('RelayDemand::requested(ed.oilScavengeDemand)') &&
  !engineData.includes('bleedValveOpen') &&
  !engineData.includes('coolFanOn') &&
  !engineData.includes('oilScavengeOn'));
expect('central runtime data has no write-only AB adapter or protected-throttle mirrors',
  !engineData.includes('abFlameAdapter') &&
  !engineData.includes('protectedThrottleDemand') &&
  !hardware.includes('abFlameAdapter') &&
  !read('src/engine/controllers/ThrottleSlew.h').includes('protectedThrottleDemand'));
expect('full telemetry defers without a conflict when the bounded response workspace is busy',
  web.includes('bool allowDeferredSnapshot = false') &&
  web.includes('{\\"_snapshot_deferred\\":true}') &&
  web.includes('_sendBorrowedWebRxJson(req, g_webTxBuf, n, 200, true);') &&
  webApp.includes('async function loadDashboardSnapshot(attempt = 0)') &&
  webApp.includes('data?._snapshot_deferred') &&
  webApp.includes('loadDashboardSnapshot(attempt + 1)'));
expect('low-heap request rejection uses the framework-safe abort path only on Classic',
  web.includes('#if defined(OT_PLATFORM_ESP32)') &&
  web.includes('request->method() == HTTP_GET &&') &&
  web.includes('(ConfigApplyGate::busy() || _maintenanceUploadInProgress() ||') &&
  web.includes('ESP.getFreeHeap() < 24576 || ESP.getMaxAllocHeap() < 8192)') &&
  (web.match(/request->abort\(\)/g) || []).length >= 1 &&
  web.includes('if (req->client()) req->abort();') &&
  !web.includes('req->client()->close()'));
expect('dependency header-retention patch is idempotent across repeated builds',
  buildPatches.includes('if retain_needed in text:') &&
  buildPatches.includes('pass\n    elif retain_all in text:'));
expect('both targets use the bounded transfer workspace for large config reads',
  web.includes('Settings can exceed 7 KB') &&
  web.includes('_sendLargeReadJson(req, g_webTxBuf, n);') &&
  !web.includes('#if defined(OT_PLATFORM_ESP32S3)\n        _sendLargeReadJson(req, g_webTxBuf, n);\n#else\n        _sendOwnedJson(req, g_webTxBuf, n);'));
expect('completed bounded log views release their read gate before TCP keep-alive teardown',
  web.includes('The LittleFS read and response construction are complete.') &&
  (web.match(/_releaseLogRead\(req\);/g) || []).length >= 3);
expect('complete engine restores separate portable value checks from uploaded-hardware dependencies',
  configCpp.includes('return validateSettingsDoc(doc, false);') &&
  configCpp.includes('bool Config::validateRuntimeHardwareDependencies()') &&
  web.includes('HardwareConfig::applyValidatedJsonRuntimeOnly(*hwDoc);') &&
  web.includes('if (!Config::validateRuntimeHardwareDependencies())'));
expect('Classic engine restore parses staged settings after releasing the receive workspace',
  web.includes('Parse directly from the staged file') &&
  web.includes('heap_caps_free(g_webRxStorage);') &&
  web.includes('deserializeJson(*uploadedSettings, stagedSettings)'));
expect('abandoned large read responses cannot strand same-tab page navigation',
  web.includes('A new same-tab read must supersede that response') &&
  web.includes('if (g_webRxOwner && !g_webRxResponseLease &&') &&
  web.includes('g_webRxOwner = req;'));
expect('session logging keeps usable target-aware filesystem headroom',
  sessionLogger.includes('LittleFS.totalBytes() / 8U') &&
  sessionLogger.includes('SESSION_MIN_RESERVE_BYTES = 32 * 1024') &&
  sessionLogger.includes('SESSION_MAX_RESERVE_BYTES = 150 * 1024') &&
  sessionLogger.includes('SESSION_MAX_RESERVE_BYTES = 48 * 1024') &&
  sessionLogger.includes('return min(SESSION_MAX_RESERVE_BYTES'));
expect('idle event snapshots honor the disabled toggle in both STANDBY and FAULT and omit absent channels',
  flightRecorder.includes('ed.mode == SysMode::STANDBY || ed.mode == SysMode::FAULT') &&
  flightRecorder.includes('if (idleMode && !Config::logStandby) return;') &&
  flightRecorder.includes('if (hw.hasN1Rpm)') &&
  flightRecorder.includes('if (hw.hasTot)') &&
  flightRecorder.includes('if (hw.hasThrottle)'));
expect('Classic live telemetry stays within one transport response and rotates optional channels',
  web.includes('static size_t _buildCompactTelemetry(') &&
  web.includes('measured > COMPACT_TELEMETRY_MAX') &&
  web.includes('const uint8_t thisGroup = group++ & 0x03u;') &&
  web.includes('constexpr uint8_t CHANNELS_PER_FRAME = 3;') &&
  web.includes('size_t n = _buildCompactTelemetry(\n            g_webTxBuf'));
expect('dashboard compact telemetry has one in-flight request and a bounded timeout',
  webApp.includes('if (!isLiveTelemetryPage() || document.hidden || _restFallbackInFlight) return;') &&
  webApp.includes('const timeout = setTimeout(() => controller.abort(), 1800);') &&
  webApp.includes("fetch('/api/telemetry'") &&
  webApp.includes('_restFallbackInFlight = false;'));
expect('normal dashboard and calibration telemetry use a uniform 2 Hz compact HTTP path',
  webApp.includes('return 500;') &&
  webApp.includes('const period = Math.max(500, desiredPullPeriodMs());') &&
  webApp.includes('setInterval(restTelemetryFallbackNow, period);'));
expect('web assets and JSON replies declare the server one-response lifecycle',
  (web.match(/addHeader\("Connection", "close"\)/g) || []).length >= 3 &&
  !web.includes('addHeader("Connection", "keep-alive")') &&
  web.includes('do not invite') &&
  web.includes('State the actual one-response lifecycle') &&
  buildPatches.includes('Let the HTTP peer retire completed'));
expect('Hardware uses its sufficient one-hertz REST status path without competing websocket ownership',
  hardwareState.includes("fetch('/api/telemetry'") &&
  hardwareState.includes('setInterval(refreshHardwareStatus, 1000)') &&
  hardwareState.includes('setTimeout(() => controller.abort(), 8000)') &&
  hardwareHtml.includes('const loaded = await loadHardware();') &&
  hardwareHtml.includes('if (loaded) startStatusPoll();') &&
  !hardwareState.includes('new WebSocket('));
expect('sequence device selectors group purpose matches and auto-select only a sole suggested output',
  sequenceRules.includes("group('Suggested', suggested)") &&
  sequenceRules.includes("group('Other fitted outputs', other)") &&
  sequenceRules.includes('if (!target && suggested.length === 1)') &&
  sequenceRules.includes('hwCfg[deviceTargetSeqKey(tab)][idx] = target;') &&
  sequenceRules.includes("return suggested.length === 1 ? String(suggested[0].id || '') : '';"));
expect('ignition sequence targets remain limited to fitted ignition devices',
  sequenceRules.includes("(!isIgnitionBlock(bname) || purposes.includes(String(channel.purpose || '')))") &&
  main.includes('!ignitionOutputPurpose(output->purpose)') &&
  main.includes('isIgnitionTargetBlock(names[i]) &&'));
expect('Sequence and Tools use compact REST telemetry without page-local websocket ownership',
  sequenceRules !== undefined &&
  read('data_src/pages/sequence-runtime.js').includes("fetch('/api/telemetry'") &&
  !read('data_src/pages/sequence-runtime.js').includes('new WebSocket(') &&
  toolsHtml.includes("fetchJsonWithTimeout('/api/telemetry', 3000)") &&
  !toolsHtml.includes('new WebSocket('));
expect('factory auxiliary-output bindings use the fitted registry IDs',
  hwConfig.includes('"primary_scavenge_pump", "scavenge_pump"') &&
  hwConfig.includes('"primary_cooling_fan", "cooling_fan"') &&
  hwConfig.includes('"primary_bleed_valve", "bleed_valve"') &&
  !hwConfig.includes('"primary_scavenge_pump", "oil_scavenge_main"') &&
  !hwConfig.includes('"primary_cooling_fan", "cooling_fan_main"') &&
  !hwConfig.includes('"primary_bleed_valve", "bleed_valve_main"'));
expect('fresh factory sequences expose simple device commands as editable Set Output blocks',
  hwConfig.includes('auto modernizeDefaultActions =') &&
  hwConfig.includes('strlcpy(names[i], "SetOutput"') &&
  hwConfig.includes('strlcpy(enter[i][0].targetId, outputId') &&
  hwConfig.includes('modernizeDefaultActions(startupSeq, startupSeqLen, startupEnterActions);') &&
  hwConfig.includes('modernizeDefaultActions(shutdownSeq, shutdownSeqLen, shutdownEnterActions);') &&
  hwConfig.includes('modernizeDefaultActions(abSeq, abSeqLen, abEnterActions);') &&
  hwConfig.includes('modernizeDefaultActions(abShutSeq, abShutSeqLen, abShutEnterActions);'));

console.log(`Safety regression audit passed (${checks.length} checks).`);
