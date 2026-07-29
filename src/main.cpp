#include "system/version.h"
#include "Hardware.h"
#include "platform/esp32/PlatformInit.h"
#include "system/Config.h"
#include "system/HardwareConfig.h"
#include "system/HardwareCapabilities.h"
#include "system/ClusterSerial.h"
#include "system/FlightRecorder.h"
#include "system/SessionLogger.h"
#include "system/CommandQueue.h"
#include "system/Watchdog.h"
#include "system/web/WebServer.h"
#include "system/MAVLinkOutput.h"
#include "system/RulesEngine.h"
#include "system/ConfigApplyGate.h"
#include "system/FeedbackRequirements.h"
#include "system/pcb/PcbProfileManager.h"
#include "engine/EngineData.h"
#include "hal/RCInput.h"
#include "hal/sensors/SensorProtocolDecode.h"
#include <new>

// ── MAVLink serial output ─────────────────────────────────────
static MAVLinkOutput g_mavlink;
static HardwareSerial _mavSerial(2);  // UART2
// ── Global hardware objects (always compiled in) ──────────────
OT_DECLARE_HARDWARE;

// ── Sequence arrays — built from the ecu_config.json hardware section ─────
// Block name → pointer registry (all sequence blocks)
struct BlockEntry { const char* name; IBlock* blk; };
static const BlockEntry _blockRegistry[] = {
    // Core sequence blocks
    {"OilPrime",      &g_blkOilPrime},
    {"StarterSpin",   &g_blkStarterSpin},
    {"PreIgnSpark",   &g_blkPreIgnSpark},
    {"FuelOpen",      &g_blkFuelOpen},
    {"FlameConfirm",  &g_blkFlameConfirm},
    {"TempConfirm",   &g_blkTempConfirm},
    {"TimedDelay",    &g_blkTimedDelay},
    {"FuelPumpIdle",  &g_blkFuelPumpIdle},
    {"ModifiedIdle",  &g_blkModifiedIdle},
    {"Spool",         &g_blkSpool},
    {"SafetyHold",    &g_blkSafetyHold},
    {"ImmediateCut",  &g_blkImmediateCut},
    {"RPMDrop",       &g_blkRPMDrop},
    {"CooldownSpin",  &g_blkCooldownSpin},
    {"FinalStop",     &g_blkFinalStop},
    // Simple actuator blocks
    {"IgniterOn",     &g_blkIgniterOn},
    {"IgniterOff",    &g_blkIgniterOff},
    {"FuelSolClose",  &g_blkFuelSolClose},
    {"StarterEnOn",   &g_blkStarterEnOn},
    {"StarterEnOff",  &g_blkStarterEnOff},
    {"StarterOff",    &g_blkStarterOff},
    {"OilPumpOn",     &g_blkOilPumpOn},
    {"OilPumpOff",    &g_blkOilPumpOff},
    {"CoolFanOn",     &g_blkCoolFanOn},
    {"CoolFanOff",    &g_blkCoolFanOff},
    {"AirstarterOn",  &g_blkAirstarterOn},
    {"AirstarterOff", &g_blkAirstarterOff},
    {"ABPumpOn",      &g_blkABPumpOn},
    {"ABPumpOff",     &g_blkABPumpOff},
    {"ABIgnOn",       &g_blkABIgnOn},
    {"ABIgnOff",      &g_blkABIgnOff},
    {"OilScavengeOn",  &g_blkOilScavengeOn},
    {"OilScavengeOff", &g_blkOilScavengeOff},
    {"DrainValveOpen", &g_blkDrainValveOpen},
    {"DrainValveClose", &g_blkDrainValveClose},
    // Extended blocks
    {"FuelPulse",      &g_blkFuelPulse},
    {"WaitTOTCool",    &g_blkWaitTOTCool},
    {"WaitForInput",   &g_blkWaitForInput},
    {"WaitForInputOff",&g_blkWaitForInputOff},
    {"ThrottleSet",    &g_blkThrottleSet},
    {"PreHeat",        &g_blkPreHeat},
    // Advanced / extended hardware blocks
    {"BleedOpen",      &g_blkBleedOpen},
    {"BleedClose",     &g_blkBleedClose},
    {"GlowPreheat",    &g_blkGlowPreheat},
    {"FuelPumpRamp",   &g_blkFuelPumpRamp},
    {"FuelPump2Set",   &g_blkFuelPump2Set},
    {"FuelPump2On",    &g_blkFuelPump2On},
    {"FuelPump2Off",   &g_blkFuelPump2Off},
    {"GovernorHold",   &g_blkGovernorHold},
    // Afterburner blocks
    {"ABSolOpen",      &g_blkABSolOpen},
    {"ABSolClose",     &g_blkABSolClose},
    {"ABCheckReady",   &g_blkABCheckReady},
    {"ABIgnite",       &g_blkABIgnite},
    {"ABFlameConfirm", &g_blkABFlameConfirm},
    {"ABStabilize",    &g_blkABStabilize},
};
static constexpr size_t _blockRegistryLen = sizeof(_blockRegistry) / sizeof(BlockEntry);

// Pointer tables are populated once from the stored configuration. Keeping
// their small backing store on the heap preserves classic ESP32 static DRAM
// for ISR/runtime state without changing either target's sequence capacity.
static IBlock** const _sequenceBlockStorage =
    new (std::nothrow) IBlock*[HardwareConfig::MAX_SEQ_BLOCKS * 4]();
static TimedDelay* const _sequenceDelayStorage =
    new (std::nothrow) TimedDelay[HardwareConfig::MAX_SEQ_BLOCKS * 4]();
static IBlock** const _startupBlocks = _sequenceBlockStorage;
static TimedDelay* const _startupDelays = _sequenceDelayStorage;
class CustomSequenceBlock : public IBlock {
public:
    void bind(const HardwareConfig::CustomBlockDef* def) { _def = def; }
    const char* name() override { return (_def && _def->key[0]) ? _def->key : "CustomBlock"; }

    void onEnter() override {
        _entryMs = millis();
        _stepIdx = 0;
        _stepMs = 0;
        _stepDelayActive = false;
        _whileReleased = false;
        _conditionSinceMs = 0;
        _entrySensorValid = _def && RulesEngine::sensorReading(_def->sensor, _entrySensorValue);
        clearWaitReason();
    }

    BlockResult tick() override {
        if (!_def || !_def->enabled) return BlockResult::Abort;
        const bool benchMode = EngineData::instance().benchMode;

        if (_def->type == 1) {
            if (benchMode) return BlockResult::Complete;
            setWaitReason(_def->label[0] ? _def->label : _def->key);
            return (millis() - _entryMs) >= _def->durationMs ? BlockResult::Complete : BlockResult::Running;
        }

        if (_def->type == 2) {
            if (!_whileReleased) {
                if (benchMode) {
                    _whileReleased = true;
                } else {
                    setWaitReason(_def->label[0] ? _def->label : _def->key);
                    float threshold = _def->threshold;
                    if (_def->relativeToEntry) {
                        if (!_entrySensorValid) return BlockResult::Abort;
                        threshold += _entrySensorValue;
                    }
                    if (RulesEngine::sensorConditionMet(_def->sensor, _def->op, threshold)) {
                        if (_conditionSinceMs == 0) _conditionSinceMs = millis();
                        if (millis() - _conditionSinceMs >= _def->stableMs) {
                            _whileReleased = true;
                            clearWaitReason();
                        } else {
                            if (_def->timeoutMs > 0 && (millis() - _entryMs) >= _def->timeoutMs) {
                                if (_def->timeoutAction == 2) { _whileReleased = true; clearWaitReason(); }
                                else return _def->timeoutAction == 1 ? BlockResult::Fault : BlockResult::Abort;
                            }
                            return BlockResult::Running;
                        }
                    } else if (_def->timeoutMs > 0 && (millis() - _entryMs) >= _def->timeoutMs) {
                        if (_def->timeoutAction == 2) {
                            _whileReleased = true;
                            clearWaitReason();
                        } else {
                            return _def->timeoutAction == 1 ? BlockResult::Fault : BlockResult::Abort;
                        }
                    } else {
                        _conditionSinceMs = 0;
                        return BlockResult::Running;
                    }
                }
            }
            return tickSteps();
        }

        return tickSteps();
    }

    void onExit() override { clearWaitReason(); }

private:
    BlockResult tickSteps() {
        while (_stepIdx < _def->stepCount) {
            const auto& step = _def->steps[_stepIdx];
            if (step.type == 1) {
                if (!_stepDelayActive) {
                    _stepMs = millis();
                    _stepDelayActive = true;
                }
                if ((millis() - _stepMs) < step.delayMs) {
                    setWaitReason(_def->label[0] ? _def->label : _def->key);
                    return BlockResult::Running;
                }
                _stepMs = 0;
                _stepDelayActive = false;
                _stepIdx++;
                continue;
            }
            RulesEngine::applyActuatorDemand(step.actuator, step.value);
            _stepIdx++;
        }
        clearWaitReason();
        return BlockResult::Complete;
    }
    const HardwareConfig::CustomBlockDef* _def = nullptr;
    uint8_t _stepIdx = 0;
    unsigned long _entryMs = 0;
    unsigned long _stepMs = 0;
    bool _stepDelayActive = false;
    bool _whileReleased = false;
    unsigned long _conditionSinceMs = 0;
    float _entrySensorValue = 0.0f;
    bool _entrySensorValid = false;
};

class IgnitionCommandBlock : public IBlock {
public:
    void bind(const char* blockName, uint8_t target, unsigned long preheatMs) {
        _name = blockName;
        _target = constrain(target, 0, 2);
        _preheatMs = preheatMs;
    }

    const char* name() override { return _name ? _name : "IgnitionCommand"; }

    void onEnter() override {
        _entryMs = millis();
        if (strcmp(name(), "IgniterOff") == 0) _setTarget(false);
        else _setTarget(true);
    }

    BlockResult tick() override {
        if (strcmp(name(), "PreHeat") != 0) return BlockResult::Complete;
        return (millis() - _entryMs) >= _preheatMs ? BlockResult::Complete : BlockResult::Running;
    }

    void onExit() override {}

private:
    void _setTarget(bool on) {
        auto& ed = EngineData::instance();
        switch (_target) {
            case 1: ed.igniter2On = on; break;
            case 2: ed.glowPlugDemand = on ? (Config::glowHoldPct / 100.0f) : 0.0f; break;
            default: ed.igniterOn = on; break;
        }
    }

    const char* _name = nullptr;
    uint8_t _target = 0;
    unsigned long _preheatMs = 0;
    unsigned long _entryMs = 0;
};

static bool ignitionTargetAvailable(uint8_t target) {
    auto& hw = HardwareConfig::instance();
    switch (target) {
        case 1: return hw.hasIgniter2;
        case 2: return hw.hasGlowPlug;
        default: return hw.hasIgniter;
    }
}

static const char* ignitionTargetName(uint8_t target) {
    switch (target) {
        case 1: return "AB / Pilot Igniter";
        case 2: return "Glow/Wet Glow";
        default: return "Igniter 1";
    }
}

static void commandIgnitionTarget(uint8_t target, bool on) {
    auto& ed = EngineData::instance();
    switch (target) {
        case 1:
            ed.igniter2On = on;
            break;
        case 2:
            ed.glowPlugDemand = on ? (Config::glowHoldPct / 100.0f) : 0.0f;
            break;
        default:
            ed.igniterOn = on;
            break;
    }
}

static CustomSequenceBlock* const _sequenceCustomBlockStorage =
    new (std::nothrow) CustomSequenceBlock[HardwareConfig::MAX_SEQ_BLOCKS * 4]();
static IgnitionCommandBlock* const _sequenceIgnitionBlockStorage =
    new (std::nothrow) IgnitionCommandBlock[HardwareConfig::MAX_SEQ_BLOCKS * 4]();
static CustomSequenceBlock* const _startupCustomBlocks = _sequenceCustomBlockStorage;
static IgnitionCommandBlock* const _startupIgnitionBlocks = _sequenceIgnitionBlockStorage;
static int     _startupCount  = 0;
static IBlock** const _shutdownBlocks =
    _sequenceBlockStorage
        ? _sequenceBlockStorage + HardwareConfig::MAX_SEQ_BLOCKS : nullptr;
static TimedDelay* const _shutdownDelays =
    _sequenceDelayStorage
        ? _sequenceDelayStorage + HardwareConfig::MAX_SEQ_BLOCKS : nullptr;
static CustomSequenceBlock* const _shutdownCustomBlocks =
    _sequenceCustomBlockStorage
        ? _sequenceCustomBlockStorage + HardwareConfig::MAX_SEQ_BLOCKS : nullptr;
static IgnitionCommandBlock* const _shutdownIgnitionBlocks =
    _sequenceIgnitionBlockStorage
        ? _sequenceIgnitionBlockStorage + HardwareConfig::MAX_SEQ_BLOCKS : nullptr;
static int     _shutdownCount = 0;
static IBlock** const _abIgnBlocks =
    _sequenceBlockStorage
        ? _sequenceBlockStorage + HardwareConfig::MAX_SEQ_BLOCKS * 2 : nullptr;
static TimedDelay* const _abIgnDelays =
    _sequenceDelayStorage
        ? _sequenceDelayStorage + HardwareConfig::MAX_SEQ_BLOCKS * 2 : nullptr;
static CustomSequenceBlock* const _abIgnCustomBlocks =
    _sequenceCustomBlockStorage
        ? _sequenceCustomBlockStorage + HardwareConfig::MAX_SEQ_BLOCKS * 2 : nullptr;
static IgnitionCommandBlock* const _abIgnitionBlocks =
    _sequenceIgnitionBlockStorage
        ? _sequenceIgnitionBlockStorage + HardwareConfig::MAX_SEQ_BLOCKS * 2 : nullptr;
static int     _abIgnCount    = 0;
static IBlock** const _abShutBlocks =
    _sequenceBlockStorage
        ? _sequenceBlockStorage + HardwareConfig::MAX_SEQ_BLOCKS * 3 : nullptr;
static TimedDelay* const _abShutDelays =
    _sequenceDelayStorage
        ? _sequenceDelayStorage + HardwareConfig::MAX_SEQ_BLOCKS * 3 : nullptr;
static CustomSequenceBlock* const _abShutCustomBlocks =
    _sequenceCustomBlockStorage
        ? _sequenceCustomBlockStorage + HardwareConfig::MAX_SEQ_BLOCKS * 3 : nullptr;
static IgnitionCommandBlock* const _abShutIgnitionBlocks =
    _sequenceIgnitionBlockStorage
        ? _sequenceIgnitionBlockStorage + HardwareConfig::MAX_SEQ_BLOCKS * 3 : nullptr;
static int     _abShutCount   = 0;
static void validateSequences();  // defined after buildSequences
static bool _configApplyDeferred = false;

static void applyConfigOnEcuCore(const char* reason) {
    Hardware::applyConfig();
    validateSequences();
    ClusterSerial::beginIfNeeded();
    Serial.printf("[OT] Config block/hardware apply complete (%s)\n", reason);
}

static void buildSequences() {
    auto& hw = HardwareConfig::instance();
    if (!_sequenceBlockStorage || !_sequenceDelayStorage ||
        !_sequenceCustomBlockStorage || !_sequenceIgnitionBlockStorage) {
        _startupCount = _shutdownCount = _abIgnCount = _abShutCount = 0;
        auto& ed = EngineData::instance();
        ed.configLocked = true;
        strlcpy(ed.faultDescription,
                "Cannot start: sequence memory allocation failed. Reboot the ECU; "
                "if this repeats, export the engine file and reflash the firmware.",
                sizeof(ed.faultDescription));
        strlcpy(ed.lastEvent, "FAULT: sequence memory allocation failed",
                sizeof(ed.lastEvent));
        Serial.println("[OT] FATAL: sequence memory allocation failed; START locked");
        return;
    }
    auto findCustomDef = [&](const char* name) -> const HardwareConfig::CustomBlockDef* {
        if (!name || strncmp(name, "custom_", 7) != 0) return nullptr;
        for (int i = 0; i < hw.customBlockCount; i++) {
            if (hw.customBlocks[i].enabled && strcmp(hw.customBlocks[i].key, name) == 0)
                return &hw.customBlocks[i];
        }
        return nullptr;
    };
    auto addBlock = [&](const char* name, int delayMs, uint8_t ignitionTarget,
                       TimedDelay& delay, CustomSequenceBlock& custom, IgnitionCommandBlock& ignition,
                       IBlock** blocks, int& count) {
        if (strcmp(name, "TimedDelay") == 0) {
            delay.dwellMs = (unsigned long)(delayMs > 0 ? delayMs : Config::timedDelayMs);
            blocks[count++] = &delay;
            return;
        }
        if (strcmp(name, "IgniterOn") == 0 || strcmp(name, "IgniterOff") == 0 ||
            strcmp(name, "PreHeat") == 0) {
            ignition.bind(name, ignitionTarget, (unsigned long)Config::preHeatMs);
            blocks[count++] = &ignition;
            return;
        }
        if (const auto* def = findCustomDef(name)) {
            custom.bind(def);
            blocks[count++] = &custom;
            return;
        }
        for (size_t j = 0; j < _blockRegistryLen; j++) {
            if (strcmp(_blockRegistry[j].name, name) == 0) {
                blocks[count++] = _blockRegistry[j].blk;
                return;
            }
        }
    };
    _startupCount = 0;
    for (int i = 0; i < hw.startupSeqLen; i++) {
        addBlock(hw.startupSeq[i], hw.startupDelayMs[i], hw.startupIgnitionTarget[i],
                 _startupDelays[i], _startupCustomBlocks[i], _startupIgnitionBlocks[i],
                 _startupBlocks, _startupCount);
    }
    _shutdownCount = 0;
    for (int i = 0; i < hw.shutdownSeqLen; i++) {
        addBlock(hw.shutdownSeq[i], hw.shutdownDelayMs[i], hw.shutdownIgnitionTarget[i],
                 _shutdownDelays[i], _shutdownCustomBlocks[i], _shutdownIgnitionBlocks[i],
                 _shutdownBlocks, _shutdownCount);
    }
    // AB ignition sequence
    _abIgnCount = 0;
    for (int i = 0; i < hw.abSeqLen; i++) {
        addBlock(hw.abSeq[i], hw.abDelayMs[i], hw.abIgnitionTarget[i],
                 _abIgnDelays[i], _abIgnCustomBlocks[i], _abIgnitionBlocks[i],
                 _abIgnBlocks, _abIgnCount);
    }
    // AB shutdown sequence
    _abShutCount = 0;
    for (int i = 0; i < hw.abShutSeqLen; i++) {
        addBlock(hw.abShutSeq[i], hw.abShutDelayMs[i], hw.abShutIgnitionTarget[i],
                 _abShutDelays[i], _abShutCustomBlocks[i], _abShutIgnitionBlocks[i],
                 _abShutBlocks, _abShutCount);
    }
    Serial.printf("[OT] Sequences: startup=%d, shutdown=%d, ab_ign=%d, ab_shut=%d blocks\n",
                  _startupCount, _shutdownCount, _abIgnCount, _abShutCount);
    validateSequences();
}

// ── Sequence hardware validation ──────────────────────────────
// Checks each block in the active sequences against the configured
// hardware. Issues are stored in EngineData for telemetry / UI display.
// Errors (isError=true) block the START command unless bench mode is on.
// Warnings (isError=false) are informational — the sequence will proceed
// but may time out or behave differently than expected.
static void validateSequences() {
    auto& hw = HardwareConfig::instance();
    auto& ed = EngineData::instance();
    ed.seqIssueCount = 0;
    ed.seqHasErrors  = false;
    ed.seqHasStructuralErrors = false;

    auto ignitionTargetAvailable = [&](uint8_t target) {
        switch (constrain(target, 0, 2)) {
            case 1: return hw.hasIgniter2;
            case 2: return hw.hasGlowPlug;
            default: return hw.hasIgniter;
        }
    };

    auto addIssue = [&](const char* block, const char* reason, bool isError) {
        if (isError) ed.seqHasErrors = true;
        if (ed.seqIssueCount >= EngineData::MAX_SEQ_ISSUES) return;
        auto& iss = ed.seqIssues[ed.seqIssueCount++];
        strncpy(iss.blockName, block, sizeof(iss.blockName) - 1);
        iss.blockName[sizeof(iss.blockName) - 1] = '\0';
        strncpy(iss.reason, reason, sizeof(iss.reason) - 1);
        iss.reason[sizeof(iss.reason) - 1] = '\0';
        iss.isError = isError;
        Serial.printf("[VALIDATE] %s %s: %s\n",
                      isError ? "ERROR" : "WARN", block, reason);
    };

    // ── Check for unrecognized block names ────────────────────
    // Unknown names are silently skipped by buildSequences() — flag them so
    // the user can see exactly which name is wrong rather than just having
    // a mysteriously shorter sequence.
    auto customDefFor = [&](const char* key) -> const HardwareConfig::CustomBlockDef* {
        if (!key || strncmp(key, "custom_", 7) != 0) return nullptr;
        for (int i = 0; i < hw.customBlockCount; i++) {
            if (hw.customBlocks[i].enabled && strcmp(hw.customBlocks[i].key, key) == 0)
                return &hw.customBlocks[i];
        }
        return nullptr;
    };
    auto blockKnown = [&](const char* name) {
        if (customDefFor(name)) return true;
        for (size_t j = 0; j < _blockRegistryLen; j++) {
            if (strcmp(_blockRegistry[j].name, name) == 0) return true;
        }
        return false;
    };
    auto checkNames = [&](const char* seqLabel,
                          const char (*names)[24],
                          int len) {
        for (int i = 0; i < len; i++) {
            if (!names[i][0]) continue;
            if (!blockKnown(names[i])) {
                char reason[80];
                snprintf(reason, sizeof(reason),
                         "Unknown block in %s sequence - will be skipped", seqLabel);
                // Use block name as the key (truncated to fit blockName field)
                char truncated[24];
                strncpy(truncated, names[i], sizeof(truncated) - 1);
                truncated[sizeof(truncated) - 1] = '\0';
                addIssue(truncated, reason, true);
                ed.seqHasStructuralErrors = true;
            }
        }
    };
    checkNames("startup",  hw.startupSeq,  hw.startupSeqLen);
    checkNames("shutdown", hw.shutdownSeq, hw.shutdownSeqLen);
    checkNames("ab_ign",   hw.abSeq,       hw.abSeqLen);
    checkNames("ab_shut",  hw.abShutSeq,   hw.abShutSeqLen);

    auto checkCustomBlockHardware = [&](const char* nm) {
        const auto* def = customDefFor(nm);
        if (!def) return false;
        auto sensorConfigured = [&](uint8_t sensor) {
            switch (sensor) {
                case 0:  return hw.hasOilTemp;
                case 1:  return hw.hasTot;
                case 2:  return hw.hasN1Rpm;
                case 3:  return hw.hasOilPress;
                case 4:  return hw.hasTit;
                case 5:  return hw.hasBattVoltage;
                case 6:  return hw.hasTwoShaft && hw.hasN2Rpm;
                case 7:  return hw.diCh[0].pin >= 0;
                case 8:  return hw.diCh[1].pin >= 0;
                case 9:  return hw.diCh[2].pin >= 0;
                case 10: return hw.diCh[3].pin >= 0;
                case 11: return hw.hasFuelPress;
                case 12: return hw.hasFuelFlow;
                case 13: return hw.hasP1;
                case 14: return hw.hasP2;
                case 15: return hw.hasTorque;
                case 16: return hw.hasFlame;
                case 17: return hw.hasThrottleInput;
                case 18: return hw.hasIdleInput;
                case 19: return hw.hasAfterburner && hw.hasAbFlame;
                case 20: return hw.hasGlowPlug && hw.hasGlowCurrentSensor;
                case 21: return hw.hasIgniter && hw.hasIgniterCurrentSensor;
                case 22: return hw.hasIgniter2 && hw.hasIgniter2CurrentSensor;
                case 23: return hw.hasOilPump && hw.hasOilPumpCurrentSensor;
                case 24: return hw.hasAfterburner && hw.abInputPin >= 0;
                case 25: return hw.startPin >= 0;
                case 26: return hw.stopPin >= 0;
                default: return false;
            }
        };
        if (def->type == 2 && !sensorConfigured(def->sensor))
            addIssue(nm, "Custom while-block sensor is not configured", true);
        for (uint8_t i = 0; i < def->stepCount; i++) {
            const auto& step = def->steps[i];
            if (step.type == 0 && !RulesEngine::actuatorUsable(step.actuator))
                addIssue(nm, "Custom block commands an actuator that is not configured", true);
        }
        return true;
    };

    auto checkCommonBlockHardware = [&](const char* nm) {
        if (checkCustomBlockHardware(nm)) return;
        if (strcmp(nm, "FuelSolClose") == 0) {
            if (!hw.hasFuelSol)
                addIssue(nm, "No main fuel shutoff configured - close command has no physical output", false);
        }
        else if (strcmp(nm, "StarterEnOn") == 0 || strcmp(nm, "StarterEnOff") == 0) {
            if (!hw.hasStarterEn)
                addIssue(nm, "No starter enable relay configured - starter enable command has no physical output", false);
        }
        else if (strcmp(nm, "StarterOff") == 0) {
            if (!hw.hasStarter)
                addIssue(nm, "No starter actuator configured - starter command has no physical output", false);
        }
        else if (strcmp(nm, "OilPumpOff") == 0) {
            if (!hw.hasOilPump)
                addIssue(nm, "No oil pump actuator configured - off command has no physical output", false);
        }
        else if (strcmp(nm, "CoolFanOn") == 0 || strcmp(nm, "CoolFanOff") == 0) {
            if (!hw.hasCoolFan)
                addIssue(nm, "No cooling fan actuator configured - fan command has no physical output", false);
        }
        else if (strcmp(nm, "AirstarterOn") == 0 || strcmp(nm, "AirstarterOff") == 0) {
            if (!hw.hasAirstarterSol)
                addIssue(nm, "No air starter valve configured - command has no physical output", false);
        }
        else if (strcmp(nm, "OilScavengeOn") == 0 || strcmp(nm, "OilScavengeOff") == 0) {
            if (!hw.hasOilScavengePump)
                addIssue(nm, "No oil scavenge pump configured - scavenge command has no physical output", false);
        }
        else if (strcmp(nm, "DrainValveOpen") == 0 || strcmp(nm, "DrainValveClose") == 0) {
            bool hasDrainValve = false;
            for (uint8_t i = 0; i < hw.channelRegistry.outputCount; ++i)
                if (hw.channelRegistry.outputs[i].installed &&
                    !strcmp(hw.channelRegistry.outputs[i].purpose, "drain_valve"))
                    hasDrainValve = true;
            if (!hasDrainValve)
                addIssue(nm, "No drain valve configured - drain command has no physical output", false);
        }
        else if (strcmp(nm, "WaitTOTCool") == 0) {
            if (Config::effectiveEgtSource() == 0)
                addIssue(nm, "No selected EGT source - this block waits for its full timeout, then aborts startup or permits shutdown to finish", false);
        }
        else if (strcmp(nm, "FinalStop") == 0) {
            if (!hw.hasN1Rpm)
                addIssue(nm, "No N1 RPM sensor - cannot verify complete stop; uses the configured timeout as a spool-down delay", false);
        }
    };

    // ── Check startup blocks ──────────────────────────────────
    for (int i = 0; i < _startupCount; i++) {
        const char* nm = _startupBlocks[i]->name();
        checkCommonBlockHardware(nm);

        if (strcmp(nm, "StarterSpin") == 0) {
            if (!hw.hasN1Rpm)
                addIssue(nm, "Needs N1 RPM sensor - will hang for full timeout then fault", true);
            if (!hw.hasStarter)
                addIssue(nm, "No starter actuator configured - block will run with no physical effect", false);
        }
        else if (strcmp(nm, "Spool") == 0) {
            if (!hw.hasN1Rpm)
                addIssue(nm, "Needs N1 RPM sensor - will hang for full timeout then fault", true);
        }
        else if (strcmp(nm, "SafetyHold") == 0) {
            const bool anyFinalCheck = Config::safetyHoldCheckN1 || Config::safetyHoldCheckN2 ||
                Config::safetyHoldCheckP1 || Config::safetyHoldCheckP2 || Config::safetyHoldCheckOil ||
                Config::safetyHoldCheckEgt || Config::safetyHoldCheckFlame;
            if (!anyFinalCheck)
                addIssue(nm, "No Final Startup Check is enabled - choose at least one installed sensor", true);
            if (Config::safetyHoldCheckN1 && !hw.hasN1Rpm) addIssue(nm, "N1 check is enabled but N1 is not configured", true);
            if (Config::safetyHoldCheckN2 && !hw.hasN2Rpm) addIssue(nm, "N2 check is enabled but N2 is not configured", true);
            if (Config::safetyHoldCheckP1 && !hw.hasP1) addIssue(nm, "P1 check is enabled but P1 pressure is not configured", true);
            if (Config::safetyHoldCheckP2 && !hw.hasP2) addIssue(nm, "P2 check is enabled but P2 pressure is not configured", true);
            if (Config::safetyHoldCheckOil && !hw.hasOilPress) addIssue(nm, "Oil check is enabled but oil pressure is not configured", true);
            if (Config::safetyHoldCheckEgt && Config::effectiveEgtSource() == 0) addIssue(nm, "EGT check is enabled but no engine temperature source is selected", true);
            if (Config::safetyHoldCheckFlame && !hw.hasFlame) addIssue(nm, "Flame check is enabled but the flame sensor is not configured", true);
        }
        else if (strcmp(nm, "FlameConfirm") == 0) {
            if (!hw.hasFlame)
                // ERROR (not warning): without a flame sensor this block always aborts startup.
                // Bench mode bypasses the error gate so testing still works.
                addIssue(nm, "No flame sensor fitted - FlameConfirm will always abort startup. "
                             "Replace with TempConfirm (EGT sensor) or TimedDelay, "
                             "or enable Bench Mode to test without sensors.", true);
        }
        else if (strcmp(nm, "TempConfirm") == 0) {
            if (Config::effectiveEgtSource() == 0)
                // ERROR: TempConfirm without a selected EGT sensor always aborts.
                addIssue(nm, "No TOT/TIT sensor fitted - TempConfirm will always abort startup. "
                             "Replace with FlameConfirm (flame sensor) or TimedDelay, "
                             "or enable Bench Mode to test without sensors.", true);
        }
        else if (strcmp(nm, "OilPrime") == 0) {
            if (!hw.hasOilPump)
                addIssue(nm, "No oil pump actuator configured - block will run for timeout with no physical effect", false);
            // (OilPrime drives the pump directly at a fixed % when the oil control loop is
            //  off, so it still builds pressure without the loop — no warning needed.)
        }
        else if (strcmp(nm, "OilPumpOn") == 0) {
            if (!hw.hasOilPump)
                addIssue(nm, "No oil pump actuator configured - stock pre-lube step has no physical output", false);
        }
        else if (strcmp(nm, "GlowPreheat") == 0) {
            if (!hw.hasGlowPlug)
                addIssue(nm, "No glow plug configured - block will spend its configured time with no physical heating output", false);
            else if (Config::glowWaitUntilHot && !hw.hasGlowCurrentSensor)
                addIssue(nm, "Wait-until-hot requires calibrated glow-plug current feedback", true);
        }
        else if (strcmp(nm, "PreIgnSpark") == 0) {
            if (!hw.hasIgniter)
                addIssue(nm, "No Igniter 1 output configured - block will spend its configured time with no ignition output", false);
        }
        else if (strcmp(nm, "PreHeat") == 0) {
            if (!ignitionTargetAvailable(hw.startupIgnitionTarget[i]))
                addIssue(nm, "Selected ignition output (igniter/glow) not fitted - pre-heat has no effect", false);
        }
        else if (strcmp(nm, "IgniterOn") == 0) {
            if (!ignitionTargetAvailable(hw.startupIgnitionTarget[i]))
                addIssue(nm, "Selected ignition output (igniter/glow) not fitted - light-up has no ignition", false);
        }
        else if (strcmp(nm, "IgniterOff") == 0) {
            if (!ignitionTargetAvailable(hw.startupIgnitionTarget[i]))
                addIssue(nm, "Selected ignition output is not configured - off command has no physical output", false);
        }
        else if (strcmp(nm, "FuelOpen") == 0) {
            if (!hw.hasFuelSol)
                addIssue(nm, "No main fuel shutoff configured - main fuel cannot be opened", false);
        }
        else if (strcmp(nm, "FuelPulse") == 0) {
            if (!hw.hasFuelSol)
                addIssue(nm, "No main fuel shutoff configured - prime pulse has no physical output", false);
        }
        else if (strcmp(nm, "FuelPumpIdle") == 0) {
            if (!hw.hasThrottle)
                addIssue(nm, "No main fuel pump / metering output configured - idle fuel demand has no physical output", false);
        }
        else if (strcmp(nm, "ModifiedIdle") == 0 || strcmp(nm, "ThrottleSet") == 0) {
            if (!hw.hasThrottle)
                addIssue(nm, "No main fuel pump / metering output configured - fuel demand has no physical output", false);
        }
        else if (strcmp(nm, "WaitForInput") == 0) {
            if (Config::waitForInputChannel < 0 ||
                Config::waitForInputChannel >= HardwareConfig::MAX_DI ||
                hw.diCh[Config::waitForInputChannel].pin < 0)
                addIssue(nm, "No switch assigned to the selected DI channel - startup cannot continue", true);
        }
        else if (strcmp(nm, "BleedOpen") == 0 || strcmp(nm, "BleedClose") == 0) {
            if (!hw.hasBleedValve)
                addIssue(nm, "No bleed valve configured - block will complete with no effect", false);
        }
        else if (strcmp(nm, "FuelPump2Set") == 0 || strcmp(nm, "FuelPumpRamp") == 0 ||
                 strcmp(nm, "FuelPump2On") == 0 || strcmp(nm, "FuelPump2Off") == 0) {
            if (!hw.hasFuelPump2)
                addIssue(nm, "No secondary fuel pump configured - block will complete with no effect", false);
        }
        else if (strcmp(nm, "GovernorHold") == 0) {
            if (!hw.hasN2Rpm)
                addIssue(nm, "No N2 RPM sensor - GovernorHold will time out with no feedback", false);
            else if (Config::governorTargetRpm <= 0.0f)
                addIssue(nm, "Governor target RPM is 0 - GovernorHold will wait until timeout", false);
        }
    }

    // ── Startup sequence structural checks ────────────────────
    if (_startupCount == 0) {
        addIssue("startup", "Startup sequence is empty - engine will jump to RUNNING with no checks or actuator commands", true);
        // Structural: a zero-block sequence never completes or calls back —
        // STARTUP would hang. Bench mode must not be able to bypass this.
        ed.seqHasStructuralErrors = true;
    } else {
        // Warn if no sustained fuel-delivery block is present. FuelPulse is
        // intentionally pre-prime only and does not mark fuelEverOpened.
        bool hasFuelDelivery = false;
        bool hasFuelPulseOnly = false;
        bool hasSpoolAction = false;
        for (int i = 0; i < _startupCount; i++) {
            const char* nm = _startupBlocks[i]->name();
            if (strcmp(nm, "FuelPulse") == 0) hasFuelPulseOnly = true;
            if (strcmp(nm, "StarterSpin") == 0 || strcmp(nm, "Spool") == 0 ||
                strcmp(nm, "AirstarterOn") == 0)
                hasSpoolAction = true;
            if (strcmp(nm, "FuelOpen") == 0 || strcmp(nm, "FuelPumpIdle") == 0 ||
                strcmp(nm, "FuelPumpRamp") == 0 || strcmp(nm, "FuelPump2Set") == 0 ||
                strcmp(nm, "FuelPump2On") == 0) {
                hasFuelDelivery = true;
            }
        }
        if (!hasFuelDelivery) {
            addIssue("FuelOpen", hasFuelPulseOnly
                ? "Only FuelPulse is present. FuelPulse is a pre-prime pulse and does not count as sustained fuel delivery or trigger hot cooldown."
                : "No sustained fuel delivery block (FuelOpen/FuelPumpIdle or pilot/aux fuel pump block) in startup - engine will spin without fuel",
                false);
        }
        if (!hasSpoolAction) {
            addIssue("startup",
                "No starter, spool, or air-starter action is present. The sequence assumes the rotor is spooled externally; add a starter action unless manual/external starting is intentional.",
                false);
        }

        // ── Low-oil protection arming check ───────────────────
        // LOW_OIL only trips once a startup block sets oilMinBar > 0 (OilPrime on
        // completion, StarterSpin, Spool, or SafetyHold). A hand-built sequence with
        // none of these leaves low-oil protection disarmed even after reaching RUNNING
        // — the fault would be silent. Warn when low-oil is enabled and an oil sensor is
        // fitted but nothing arms the threshold. (flameMonitorActive has a comparable
        // backstop; oilMinBar relies entirely on the sequence.)
        if (hw.safetyLowOil && hw.hasOilPress) {
            bool armsOilMin = false;
            for (int i = 0; i < _startupCount; i++) {
                const char* nm = _startupBlocks[i]->name();
                if (strcmp(nm, "OilPrime") == 0 || strcmp(nm, "StarterSpin") == 0 ||
                    strcmp(nm, "Spool") == 0 || strcmp(nm, "SafetyHold") == 0) {
                    armsOilMin = true; break;
                }
            }
            if (!armsOilMin)
                addIssue("startup", "Low-oil protection is enabled but no startup block arms the oil-pressure minimum (OilPrime/StarterSpin/Spool/SafetyHold) - LOW_OIL will never trip. Add one of those blocks.", false);
        }
    }

    // ── Fitted-but-never-opened output checks ─────────────────
    // The fuel solenoid is driven solely from fuelSolOpen (FuelOpen/FuelPulse
    // or a custom-step / side-action FUEL_SOL demand). A pump-only sequence
    // cranks and "completes" with the valve shut — warn, don't block.
    // Same idea for the starter enable relay: starterDemand only reaches the
    // ESC while starterEnabled is true (StarterSpin sets it itself; custom
    // steps driving the starter need StarterEnOn or a STARTER_ENABLE action).
    {
        auto sideActionSets = [&](uint8_t actuator, float minVal) {
            for (int i = 0; i < hw.startupSeqLen; i++) {
                for (int j = 0; j < HardwareConfig::MAX_SEQ_SIDE_ACTIONS; j++) {
                    const auto& ea = hw.startupEnterActions[i][j];
                    const auto& xa = hw.startupExitActions[i][j];
                    if ((ea.enabled && ea.actuator == actuator && ea.value >= minVal) ||
                        (xa.enabled && xa.actuator == actuator && xa.value >= minVal))
                        return true;
                }
            }
            return false;
        };
        auto customStepSets = [&](const char* nm, uint8_t actuator, float minVal) {
            const auto* def = customDefFor(nm);
            if (!def) return false;
            for (uint8_t s = 0; s < def->stepCount; s++) {
                const auto& st = def->steps[s];
                if (st.type == 0 && st.actuator == actuator && st.value >= minVal)
                    return true;
            }
            return false;
        };

        if (hw.hasFuelSol) {
            bool solOpened = sideActionSets(RulesEngine::FUEL_SOL, 0.5f);
            for (int i = 0; i < _startupCount && !solOpened; i++) {
                const char* nm = _startupBlocks[i]->name();
                if (strcmp(nm, "FuelOpen") == 0 || strcmp(nm, "FuelPulse") == 0 ||
                    customStepSets(nm, RulesEngine::FUEL_SOL, 0.5f))
                    solOpened = true;
            }
            if (!solOpened)
                addIssue("FuelOpen", "Main fuel shutoff is fitted but no startup step opens it - the starter will motor the rotor with fuel isolated", false);
        }

        if (hw.hasStarterEn) {
            bool starterDriven = sideActionSets(RulesEngine::STARTER, 0.01f);
            bool enableOn      = sideActionSets(RulesEngine::STARTER_ENABLE, 0.5f);
            for (int i = 0; i < _startupCount; i++) {
                const char* nm = _startupBlocks[i]->name();
                if (strcmp(nm, "StarterSpin") == 0 || strcmp(nm, "StarterEnOn") == 0)
                    enableOn = true;
                if (customStepSets(nm, RulesEngine::STARTER, 0.01f))
                    starterDriven = true;
                if (customStepSets(nm, RulesEngine::STARTER_ENABLE, 0.5f))
                    enableOn = true;
            }
            if (starterDriven && !enableOn)
                addIssue("Starter", "Starter demand is commanded but nothing turns the starter enable relay on (StarterEnOn) - demand will not reach the ESC", false);
        }
    }

    // ── Startup combustion-confirmation sanity check ──────────
    bool hasCombustionConfirmation = false;
    bool hasTimedIgnition = false;
    bool ignitionOn = false;
    for (int i = 0; i < _startupCount; i++) {
        const char* nm = _startupBlocks[i]->name();
        if (strcmp(nm, "FlameConfirm") == 0 || strcmp(nm, "TempConfirm") == 0)
            hasCombustionConfirmation = true;
        if (strcmp(nm, "IgniterOn") == 0 || strcmp(nm, "PreIgnSpark") == 0)
            ignitionOn = true;
        if (strcmp(nm, "IgniterOff") == 0)
            ignitionOn = false;
        if (ignitionOn && strcmp(nm, "TimedDelay") == 0)
            hasTimedIgnition = true;
    }
    // Only advise sensor-based confirmation when a combustion sensor is
    // actually fitted — on a sensor-free timed engine, timed light-up is the
    // only option, so the warning would be noise.
    const bool combustionSensorFitted = hw.hasTot || hw.hasTit || hw.hasFlame || hw.hasN1Rpm;
    if (hasTimedIgnition && !hasCombustionConfirmation && combustionSensorFitted)
        addIssue("TimedDelay", "Timed light-up does not confirm combustion - replace with TempConfirm or FlameConfirm now that a sensor is fitted", false);

    // ── Shutdown sequence structural check ────────────────────
    if (_shutdownCount == 0) {
        addIssue("shutdown", "Shutdown sequence is empty - STOP/faults fall back to an immediate all-off with no cooldown", true);
        // Structural: you should not be able to start what you cannot stop.
        ed.seqHasStructuralErrors = true;
    }

    // ── Oil calibration sanity ────────────────────────────────
    // The default profile enables oil pressure, but the factory polynomial
    // is all-zero: the ADC reads healthy while the value is a constant
    // 0 bar, so OilPrime/SafetyHold/low-oil abort every start. Tell the
    // user the real cause instead of letting them chase oil-pressure
    // faults on an uncalibrated sensor. Warn-only by design.
    if (hw.hasOilPress
        && Config::oilPolyA == 0.0f && Config::oilPolyB == 0.0f
        && Config::oilPolyC == 0.0f && Config::oilPolyD == 0.0f) {
        addIssue("Oil Sensor", "Oil pressure is uncalibrated (reads 0 bar) - calibrate it or expect low-oil aborts", false);
    }

    for (int i = 0; i < _shutdownCount; i++) {
        const char* nm = _shutdownBlocks[i]->name();
        checkCommonBlockHardware(nm);
        if (strcmp(nm, "RPMDrop") == 0 && !hw.hasN1Rpm)
            addIssue(nm, "No N1 RPM sensor - will wait for full timeout then proceed", false);
        else if (strcmp(nm, "CooldownSpin") == 0) {
            const bool coolUsesStarter = hw.hasStarter && Config::cooldownUseStarter;
            const bool coolUsesOil = hw.hasOilPump && Config::cooldownUseOilPump;
            const bool coolUsesScavenge = hw.hasOilScavengePump && Config::cooldownUseScavengePump;
            if (!coolUsesStarter && !coolUsesOil && !coolUsesScavenge)
                addIssue(nm, "No fitted cooldown actuator is enabled - block will only wait for temperature or timeout", false);
            if (Config::effectiveEgtSource() == 0)
                addIssue(nm, "No selected EGT source - cooldown will run until timeout instead of stopping by temperature", false);
        }
        else if (strcmp(nm, "WaitForInputOff") == 0 &&
                 (Config::waitForInputChannel < 0 ||
                  Config::waitForInputChannel >= HardwareConfig::MAX_DI ||
                  hw.diCh[Config::waitForInputChannel].pin < 0))
            addIssue(nm, "No switch assigned to the selected DI channel - shutdown cannot finish", true);
    }

    // ── Check AB ignition blocks ──────────────────────────────
    // AB is optional equipment — issues here should never block main engine START.
    // Skip entirely if no AB hardware is fitted (hasAbSol / hasAbPump).
    auto checkAbActuatorBlockHardware = [&](const char* nm) {
        checkCommonBlockHardware(nm);
        if ((strcmp(nm, "ABPumpOn") == 0 || strcmp(nm, "ABPumpOff") == 0) && !hw.hasAbPump) {
            addIssue(nm, "No AB pump actuator configured - block has no physical output", false);
        } else if ((strcmp(nm, "ABSolOpen") == 0 || strcmp(nm, "ABSolClose") == 0) && !hw.hasAbSol) {
            addIssue(nm, "No AB solenoid configured - block has no physical output", false);
        } else if ((strcmp(nm, "ABIgnOn") == 0 || strcmp(nm, "ABIgnOff") == 0) && !hw.hasIgniter2) {
            addIssue(nm, "No AB igniter actuator configured - block has no physical output", false);
        }
    };
    auto checkAbIgnitionBlock = [&](const char* nm) {
        checkAbActuatorBlockHardware(nm);
        if (strcmp(nm, "ABIgnite") == 0) {
            const bool torchActive = g_blkABIgnite.useTorch && g_blkABIgnite.torchTotLimit > 0.0f;
            if (!torchActive && !g_blkABIgnite.useIgniter)
                addIssue(nm, "No active ignition method - enable AB igniter or set Torch EGT Cut above 0 so torch can run", false);
            if (g_blkABIgnite.useIgniter && !hw.hasIgniter2)
                addIssue(nm, "AB igniter is enabled but no AB / pilot igniter actuator is configured", false);
            // Torch is silently skipped at runtime when torchTotLimit == 0.
            // Warn so the user knows to set abTorchTotLimit in config.
            if (g_blkABIgnite.useTorch && g_blkABIgnite.torchTotLimit == 0.0f)
                addIssue(nm, "Use Torch is enabled but Torch EGT Cut is 0 - torch is disabled until an EGT cut limit is set", false);
        }
        else if (strcmp(nm, "ABFlameConfirm") == 0) {
            if (g_blkABFlameConfirm.flameMode == 0 && !hw.hasAbFlame)
                addIssue(nm, "AB flame sensor mode is selected but no dedicated AB flame sensor is configured", false);
            if (g_blkABFlameConfirm.flameMode == 1 && Config::effectiveEgtSource() == 0)
                addIssue(nm, "EGT-rise confirmation is selected but no TOT/TIT sensor is configured", false);
        }
        else if (strcmp(nm, "ABCheckReady") == 0) {
            if ((g_blkABCheckReady.minN1 > 0.0f || g_blkABCheckReady.maxN1 > 0.0f) && !hw.hasN1Rpm)
                addIssue(nm, "N1 ignition window is configured but no N1 RPM sensor is available - AB check will abort", false);
            if (g_blkABCheckReady.maxTotForLight > 0.0f && Config::effectiveEgtSource() == 0)
                addIssue(nm, "EGT light-up ceiling is configured but no TOT/TIT source is selected - AB check will abort", false);
        }
        else if (strcmp(nm, "ABStabilize") == 0) {
            if (g_blkABStabilize.stabilizeMaxTot > 0.0f && Config::effectiveEgtSource() == 0)
                addIssue(nm, "AB stabilize EGT limit is configured but no TOT/TIT source is selected - stabilize will fault", false);
        }
    };

    const bool abFitted = hw.hasAbSol || hw.hasAbPump;
    if (hw.hasAfterburner && !abFitted)
        addIssue("Afterburner", "Afterburner is enabled but no AB fuel output is configured", false);
    if (abFitted) {
        const bool hasRegistryAbCommand = Hardware::registryPurposeInputIndex("ab_command") >= 0;
        const bool hasRegistryAbFire = Hardware::registryPurposeInputIndex("ab_fire") >= 0;
        if (Config::abPumpControlMode == 2 && hw.abInputPin < 0 && !hasRegistryAbCommand)
            addIssue("AB Pump", "Dedicated AB input pump command is selected but no AB input pin is configured", false);
        if (hw.abTriggerSource == 2 && hw.abSwitchPin < 0 && !hasRegistryAbFire)
            addIssue("AB Trigger", "Physical-switch trigger is selected but no Afterburner command switch is configured", false);
        if (hw.abTriggerSource == 3 && hw.abInputPin < 0 && !hasRegistryAbCommand)
            addIssue("AB Trigger", "Analog / RC trigger is selected but no AB input pin is configured", false);
        if (_abIgnCount == 0) {
            const char* defAbIgn[] = {
                "ABCheckReady", "ABSolOpen", "ABPumpOn", "ABIgnite", "ABFlameConfirm", "ABStabilize"
            };
            for (const char* nm : defAbIgn) checkAbIgnitionBlock(nm);
        }
        for (int i = 0; i < _abIgnCount; i++) {
            checkAbIgnitionBlock(_abIgnBlocks[i]->name());
        }
        // ABStabilize is the block that normally promotes Igniting → Running.
        // Custom sequences must state their light-up evidence explicitly.
        // Stabilization is optional, but cannot substitute for confirmation.
        if (_abIgnCount > 0) {
            bool hasStabilize = false, hasFlameConfirm = false;
            for (int i = 0; i < _abIgnCount; i++) {
                if (strcmp(_abIgnBlocks[i]->name(), "ABStabilize") == 0) hasStabilize = true;
                if (strcmp(_abIgnBlocks[i]->name(), "ABFlameConfirm") == 0) hasFlameConfirm = true;
            }
            if (!hasFlameConfirm)
                addIssue("ABFlameConfirm", "Custom AB ignition sequence must include ABFlameConfirm. Select sensor, EGT-rise, or explicit timed-assumption mode in Config.", true);
            if (!hasStabilize)
                addIssue("ABStabilize", "AB ignition sequence has no stabilization hold; it enters Running immediately after explicit flame confirmation completes", false);
        }
        if (_abShutCount == 0) {
            const char* defAbShut[] = { "ABSolClose", "ABPumpOff" };
            for (const char* nm : defAbShut) checkAbActuatorBlockHardware(nm);
        }
        for (int i = 0; i < _abShutCount; i++) {
            checkAbActuatorBlockHardware(_abShutBlocks[i]->name());
        }
    }

    // ── Config sanity checks (not tied to a specific block) ──────
    if (hw.hasDynamicIdle &&
        ((Config::idleSource == 0 && !hw.hasN1Rpm) ||
         (Config::idleSource == 1 && !hw.hasN2Rpm) ||
         (Config::idleSource == 2 && !hw.hasP1) ||
         (Config::idleSource == 3 && !hw.hasP2)))
        addIssue("DynamicIdle", "The selected idle feedback source is not configured in Hardware", true);
    if (Config::pullbackN2Enabled) {
        if (!hw.hasTwoShaft || !hw.hasN2Rpm)
            addIssue("N2 Pullback", "N2 soft pullback is enabled but no effective N2 RPM sensor is configured", false);
        else if (Config::pullbackN2SoftRpm <= 0.0f || Config::pullbackN2HardRpm <= 0.0f)
            addIssue("N2 Pullback", "N2 soft pullback is enabled but start/full RPM is 0 - pullback will not reduce throttle", false);
    }

    if (hw.safetyOverspeed && !hw.hasN1Rpm)
        addIssue("Overspeed", "Overspeed safety is enabled but no N1 RPM sensor is configured", true);
    if (hw.safetyN2Overspeed) {
        if (!hw.hasN2Rpm)
            addIssue("N2 Overspeed", "N2 overspeed safety is enabled but no N2 RPM sensor is configured", true);
        else if (Config::n2RpmLimit <= 0.0f)
            addIssue("N2 Overspeed", "N2 overspeed safety is enabled but the hard N2 RPM limit is 0", true);
        else {
            if (Config::pullbackN2Enabled &&
                ((Config::pullbackN2SoftRpm > 0.0f && Config::pullbackN2SoftRpm >= Config::n2RpmLimit) ||
                 (Config::pullbackN2HardRpm > 0.0f && Config::pullbackN2HardRpm >= Config::n2RpmLimit)))
                addIssue("N2 Pullback", "N2 gradual pullback starts or reaches full authority at/above the hard N2 shutdown limit", false);
            if (hw.hasGovernor && Config::governorTargetRpm > 0.0f &&
                Config::governorTargetRpm + Config::governorBandRpm >= Config::n2RpmLimit)
                addIssue("N2 Governor", "Governor target plus no-correction band reaches the hard N2 shutdown limit", false);
            if (hw.hasDynamicIdle && Config::idleSource == 1 && Config::idleTargetRpm >= Config::n2RpmLimit)
                addIssue("DynamicIdle", "N2-based idle target is at/above the hard N2 shutdown limit", false);
            if (Config::n2WarnRpm > 0.0f && Config::n2WarnRpm >= Config::n2RpmLimit)
                addIssue("N2 Cluster Warning", "Cluster N2 warning is at/above the hard N2 shutdown limit", false);
        }
    }
    if (Config::pullbackP1Enabled && (!hw.hasP1 || Config::pullbackP1Hard <= Config::pullbackP1Soft))
        addIssue("P1 Pullback", !hw.hasP1 ? "P1 limiter enabled without a P1 sensor" : "P1 full-reduction value must be above its begin value", false);
    if (Config::pullbackP2Enabled && (!hw.hasP2 || Config::pullbackP2Hard <= Config::pullbackP2Soft))
        addIssue("P2 Pullback", !hw.hasP2 ? "P2 limiter enabled without a P2 sensor" : "P2 full-reduction value must be above its begin value", false);
    if (Config::pullbackTorqueEnabled && (!hw.hasTorque || Config::pullbackTorqueHard <= Config::pullbackTorqueSoft))
        addIssue("Torque Pullback", !hw.hasTorque ? "Torque limiter enabled without a torque sensor" : "Torque full-reduction value must be above its begin value", false);
    if (Config::p1TripLimit > 0.0f && !hw.hasP1) addIssue("P1 Hard Trip", "P1 hard trip is configured without a P1 sensor", true);
    if (Config::p2TripLimit > 0.0f && !hw.hasP2) addIssue("P2 Hard Trip", "P2 hard trip is configured without a P2 sensor", true);
    if (Config::torqueTripLimit > 0.0f && !hw.hasTorque) addIssue("Torque Hard Trip", "Torque hard trip is configured without a torque sensor", true);
    if (hw.safetyOvertemp) {
        if (Config::effectiveEgtSource() == 0)
            addIssue("Overtemp", "Overtemp safety is enabled but no selected TOT/TIT source is configured", true);
        else if (Config::primaryEgtLimitC() <= 0.0f)
            addIssue("Overtemp", "Selected EGT hard limit is 0 - overtemperature shutdown is disabled", false);
    }
    auto hasOilSafetySwitch = [&](const char* role) {
        for (int i = 0; i < HardwareConfig::MAX_DI; ++i) {
            if (hw.diCh[i].pin >= 0 && strcmp(hw.diCh[i].role, role) == 0) return true;
        }
        for (uint8_t i = 0; i < hw.channelRegistry.inputCount; ++i) {
            const auto& c = hw.channelRegistry.inputs[i];
            if (c.installed && (strcmp(c.role, role) == 0 || strcmp(c.purpose, role) == 0)) return true;
        }
        return false;
    };
    if (hw.safetyLowOil && !hw.hasOilPress && !hasOilSafetySwitch("low_oil_switch"))
        addIssue("Oil Safety", "Low-oil safety is enabled but no oil pressure sensor or low-oil switch is configured", true);
    if (hw.safetyOilZero && !hw.hasOilPress && !hasOilSafetySwitch("oil_zero_switch"))
        addIssue("Oil Safety", "Zero-oil safety is enabled but no oil pressure sensor or zero-oil switch is configured", true);
    if (hw.safetyLowOil && hw.hasOilPress && Config::oilRunningMin <= 0.0f)
        addIssue("Oil Safety", "Running oil minimum is 0 - low-oil shutdown is disabled", false);
    if (hw.safetyFlameout) {
        int flameoutSrc = Config::flameoutSource;
        if (flameoutSrc == 0) {
            if (hw.hasFlame) flameoutSrc = 1;
            else if (hw.hasN1Rpm) flameoutSrc = 2;
            else if (Config::effectiveEgtSource() != 0) flameoutSrc = 3;
        }
        if ((flameoutSrc == 1 && !hw.hasFlame) ||
            (flameoutSrc == 2 && !hw.hasN1Rpm) ||
            (flameoutSrc == 3 && Config::effectiveEgtSource() == 0) ||
            flameoutSrc == 0) {
            addIssue("Flameout", "Flameout safety is enabled but the selected source is not configured", true);
        }
        else if (flameoutSrc == 3 && Config::flameoutEgtBelowC <= 0.0f
                 && Config::flameoutEgtFallRateCPerSec <= 0.0f) {
            addIssue("Flameout", "Both EGT flameout conditions are disabled", false);
        }
    }
    if (hw.safetyHotStart) {
        if (!hw.hasTot && !hw.hasTit)
            addIssue("Hot Start", "Hot-start safety is enabled but no TOT or TIT sensor is configured", true);
        else if (Config::preStartEgtLimitC <= 0.0f)
            addIssue("Hot Start", "Pre-start EGT limit is 0 - the hot-engine START interlock is disabled", false);
    }
    if (hw.hasGovernor) {
        if (Config::governorTargetRpm <= 0.0f)
            addIssue("N2 speed control", "Automatic N2 speed control is enabled but Target N2 RPM is 0 - speed control will remain inactive", false);
        if (hw.hasPropPitch && hw.propPitchType == 2)
            addIssue("Governor", "Prop pitch is configured as on/off; governor will ignore it and use throttle only if throttle is fitted", false);
        else if (hw.hasPropPitch && Config::governorPitchKp <= 0.0f)
            addIssue("Governor", "Prop pitch actuator is configured but Pitch Gain is 0 - governor will use throttle only", false);
    }
    if (hw.safetyOilTempHigh) {
        if (!hw.hasOilTemp)
            addIssue("Oil Temp", "Oil temperature safety is enabled but no oil temperature sensor is configured", true);
        else if (Config::oilTempLimit <= 0.0f)
            addIssue("Oil Temp", "Oil temperature limit is 0 - oil temperature shutdown is disabled", false);
    }
    if (hw.safetyFuelPressLow) {
        if (!hw.hasFuelPress)
            addIssue("Fuel Pressure", "Fuel pressure safety is enabled but no fuel pressure sensor is configured", true);
        else if (Config::fuelPressMin <= 0.0f)
            addIssue("Fuel Pressure", "Fuel pressure minimum is 0 - low fuel pressure shutdown is disabled", false);
    }
    if (hw.safetyBattLow) {
        if (!hw.hasBattVoltage)
            addIssue("Battery", "Battery safety is enabled but no voltage sensor is configured", true);
        else if (Config::battVoltMin <= 0.0f)
            addIssue("Battery", "Battery minimum is 0 - undervoltage shutdown is disabled", false);
    }
    if (hw.safetySurge) {
        if (!hw.hasN1Rpm)
            addIssue("Surge", "Surge safety is enabled but no N1 RPM sensor is configured", true);
        else if (Config::surgeDetectRpmVariance <= 0.0f)
            addIssue("Surge", "Surge variance threshold is 0 - surge shutdown is disabled", false);
    }

    const uint8_t relightTarget = (uint8_t)constrain(Config::relightIgnitionTarget, 0, 2);
    const bool hasRelightTarget = ignitionTargetAvailable(relightTarget);
    if (Config::relightEnabled && (!hw.hasN1Rpm || !hasRelightTarget)) {
        const char* reason = !hw.hasN1Rpm
            ? "no N1 RPM sensor is configured. Relight requires N1 feedback to prove the engine is still windmilling."
            : "the selected relight ignition output is not configured in Hardware.";
        char msg[180];
        snprintf(msg, sizeof(msg), "Auto-relight is enabled but %s Selected output: %s.",
                 reason, ignitionTargetName(relightTarget));
        addIssue("AutoRelight", msg, false);
    }
    else if (Config::relightEnabled) {
        int relightConfirmSrc = Config::relightConfirmSource;
        if (relightConfirmSrc == 0) {
            if (Config::flameoutSource >= 1 && Config::flameoutSource <= 3)
                relightConfirmSrc = Config::flameoutSource;
            else if (hw.hasFlame) relightConfirmSrc = 1;
            else if (hw.hasN1Rpm) relightConfirmSrc = 2;
            else if (Config::effectiveEgtSource() != 0) relightConfirmSrc = 3;
        }
        if ((relightConfirmSrc == 1 && !hw.hasFlame) ||
            (relightConfirmSrc == 2 && !hw.hasN1Rpm) ||
            (relightConfirmSrc == 3 && Config::effectiveEgtSource() == 0) ||
            relightConfirmSrc == 0) {
            addIssue("AutoRelight", "Auto-relight confirmation source is not configured; relight will time out or abort", false);
        }
        else if (relightConfirmSrc == 3 && Config::relightTotRiseC <= 0.0f) {
            addIssue("AutoRelight", "EGT relight recovery rise is 0 - EGT-source relight cannot confirm success", false);
        }
        if (Config::relightMinRpm < Config::minRpm)
            addIssue("AutoRelight", "Minimum N1 to fire relight is below Minimum Running N1; the ECU will use the higher Minimum Running N1 value", false);
        if (Config::relightTimeoutMs == 0)
            addIssue("AutoRelight", "Relight timeout is 0 - igniter can stay active indefinitely during a failed relight attempt", false);
    }

    if (ed.seqIssueCount == 0)
        Serial.println("[VALIDATE] All sequences OK");
}

// Forward declarations for helpers that call mode-transition functions
// defined later in this file.
static void enterStandby();
static void enterShutdown();
static void enterFaultShutdown();
static void handleCommand(const OTPacket& pkt);

static void cutCombustionAndStarterNow() {
    auto& ed = EngineData::instance();
    ed.throttleDemand = 0.0f; ed.abFuelOffset = 0.0f;
    ed.fuelSolOpen = false; ed.fuelPump2Demand = 0.0f;
    ed.igniterOn = false; ed.igniter2On = false;
    ed.glowPlugDemand = 0.0f; ed.wetGlowFuelDemand = 0.0f;
    ed.abSolOpen = false; ed.abPumpDemand = 0.0f;
    ed.starterDemand = 0.0f; ed.starterEnabled = false;
    ed.airstarterOpen = false;
    Hardware::cutRegistryHazardousDemands();
}

// ── General-purpose DI debounce state ────────────────────────
static unsigned long _diLastChange[HardwareConfig::MAX_DI] = {};
static bool          _diRawLast[HardwareConfig::MAX_DI]    = {};

// ── Run-time tracking ─────────────────────────────────────────
static unsigned long _runStartMs            = 0;   // millis() when RUNNING entered

// ── Buzzer state machine ───────────────────────────────────────
// Drives a passive piezo on buzzerPin via tone()/noTone() (Arduino API).
// Patterns:
//   0 = silence
//   1 = fault     — rapid 2500 Hz beep (repeating, 100 ms on/off)
//   2 = RUNNING   — single 1800 Hz 500 ms beep (one-shot)
//   3 = STARTUP   — double chirp 1500 Hz (two 100 ms beeps, 150 ms gap, one-shot)
//   4 = SHUTDOWN  — single low 900 Hz 400 ms beep (one-shot)
static uint8_t       _buzzerPattern         = 0;
static uint8_t       _buzzerStep            = 0;
static unsigned long _buzzerNextMs          = 0;
static bool          _buzzerToneOn          = false;

static void buzzerTick() {
    if (!HardwareConfig::hasBuzzer || HardwareConfig::buzzerPin < 0) return;
    unsigned long now = millis();
    if ((int32_t)(now - _buzzerNextMs) < 0) return;
    if (_buzzerPattern == 0) {
        if (_buzzerToneOn) { noTone(HardwareConfig::buzzerPin); _buzzerToneOn = false; }
        return;
    }
    if (_buzzerPattern == 1) {  // fault: 100ms on / 100ms off rapid beep
        if (_buzzerToneOn) { noTone(HardwareConfig::buzzerPin); _buzzerToneOn = false; _buzzerNextMs = now + 100; }
        else               { tone(HardwareConfig::buzzerPin, 2500, 100); _buzzerToneOn = true; _buzzerNextMs = now + 100; }
    } else if (_buzzerPattern == 2) {  // RUNNING: 500ms single beep then stop
        tone(HardwareConfig::buzzerPin, 1800, 500);
        _buzzerPattern = 0; _buzzerStep = 0;
        _buzzerNextMs  = now + 500;
    } else if (_buzzerPattern == 3) {  // STARTUP begin: double chirp then stop
        if (_buzzerStep == 0) {
            tone(HardwareConfig::buzzerPin, 1500, 100);
            _buzzerStep = 1; _buzzerNextMs = now + 250;
        } else if (_buzzerStep == 1) {
            tone(HardwareConfig::buzzerPin, 1500, 100);
            _buzzerStep = 2; _buzzerNextMs = now + 100;
        } else {
            _buzzerPattern = 0; _buzzerStep = 0;
        }
    } else if (_buzzerPattern == 4) {  // SHUTDOWN: single low beep then stop
        tone(HardwareConfig::buzzerPin, 900, 400);
        _buzzerPattern = 0; _buzzerStep = 0;
        _buzzerNextMs  = now + 400;
    }
}

// ── Tool timers (STANDBY only) ────────────────────────────────
static unsigned long _fuelPrimeUntilMs      = 0;
static unsigned long _oilPrimeUntilMs       = 0;
static unsigned long _ignTestUntilMs        = 0;
static unsigned long _ign2TestUntilMs       = 0;
static unsigned long _startTestUntilMs      = 0;
static unsigned long _idleTestUntilMs       = 0;
static unsigned long _oilScavTestUntilMs    = 0;
static unsigned long _coolFanTestUntilMs    = 0;
static unsigned long _airstarterTestUntilMs = 0;
static unsigned long _bleedValveTestUntilMs = 0;
static unsigned long _glowTestUntilMs       = 0;
static unsigned long _fuelPump2TestUntilMs  = 0;
static unsigned long _abSolTestUntilMs      = 0;
static unsigned long _abPumpTestUntilMs     = 0;
static unsigned long _starterEnTestUntilMs  = 0;
static unsigned long _propPitchTestUntilMs  = 0;
static unsigned long _registryOutputTestUntilMs = 0;
static uint8_t       _registryOutputTestIndex = 255;

static bool anyToolTimerActive() {
    // Also block actuator tests while extra cooldown is running — it controls the
    // starter, oil pump, and potentially other outputs that tests would conflict with.
    if (EngineData::instance().extraCooldownActive) return true;
    return _fuelPrimeUntilMs      || _oilPrimeUntilMs       ||
           _ignTestUntilMs        || _ign2TestUntilMs        ||
           _startTestUntilMs      ||
           _idleTestUntilMs       || _oilScavTestUntilMs     ||
           _coolFanTestUntilMs    || _airstarterTestUntilMs  ||
           _bleedValveTestUntilMs || _glowTestUntilMs        ||
           _propPitchTestUntilMs  ||
           _registryOutputTestUntilMs ||
           _fuelPump2TestUntilMs  || _abSolTestUntilMs       ||
           _abPumpTestUntilMs     || _starterEnTestUntilMs;
}

// ── Relight state ─────────────────────────────────────────────
// Igniter held ON while relight criteria hold (flame gone, N1 above min, RUNNING).
// Cleared when: flame returns, N1 drops below min, or mode leaves RUNNING.
static bool          _relightActive    = false;
static unsigned long _relightBeginMs   = 0;
static float         _relightBeginEgt  = 0.0f;   // -1 = EGT unhealthy at relight start, baseline pending

static bool deadlineExpired(unsigned long now, unsigned long deadline) {
    return deadline && (long)(now - deadline) >= 0;
}

// Last manual SET_OIL_PCT demand — restored when the standby oil feed
// disengages or an oil-prime timer expires, so neither path silently wipes
// the operator's setting to 0. Reset on entering STANDBY.
static float _manualOilPct = 0.0f;

static void checkToolTimers() {
    // FAULT is standby-like: tools work there, so their timers must expire too.
    SysMode m = EngineData::instance().mode;
    if (m != SysMode::STANDBY && m != SysMode::FAULT) return;
    auto& ed = EngineData::instance();
    unsigned long now = millis();
    if (deadlineExpired(now, _fuelPrimeUntilMs))  { ed.fuelSolOpen   = false; _fuelPrimeUntilMs = 0; }
    if (deadlineExpired(now, _oilPrimeUntilMs))   {
        // Hand off to the operator's manual SET_OIL_PCT value (0 if none was
        // set), keeping the standby feed floor while windmill protection is
        // active — symmetric with checkStandbyOilFeed()'s disengage path so a
        // later feed cycle can't resurrect a stale prime demand.
        ed.oilPumpPct = ed.standbyOilFeedActive
                      ? max(_manualOilPct, Config::standbyOilFeedPct)
                      : _manualOilPct;
        _oilPrimeUntilMs = 0;
    }
    if (deadlineExpired(now, _ignTestUntilMs))     { ed.igniterOn      = false; _ignTestUntilMs   = 0; }
    if (deadlineExpired(now, _ign2TestUntilMs))    { ed.igniter2On     = false; _ign2TestUntilMs  = 0; }
    if (deadlineExpired(now, _startTestUntilMs))   { ed.starterDemand = 0; ed.starterEnabled = false; _startTestUntilMs = 0; }
    if (deadlineExpired(now, _idleTestUntilMs))    { ed.throttleDemand = 0;    _idleTestUntilMs  = 0; }
    if (deadlineExpired(now, _oilScavTestUntilMs))    { ed.oilScavengeDemand = 0.0f; ed.oilScavengeOn  = false; _oilScavTestUntilMs    = 0; }
    if (deadlineExpired(now, _coolFanTestUntilMs))    { ed.coolFanDemand = 0.0f; ed.coolFanOn       = false; _coolFanTestUntilMs    = 0; }
    if (deadlineExpired(now, _airstarterTestUntilMs)) { ed.airstarterOpen  = false; _airstarterTestUntilMs = 0; }
    if (deadlineExpired(now, _bleedValveTestUntilMs)) { ed.bleedValveDemand = 0.0f; ed.bleedValveOpen  = false; _bleedValveTestUntilMs = 0; }
    if (deadlineExpired(now, _glowTestUntilMs))       { ed.glowPlugDemand  = 0.0f;  _glowTestUntilMs       = 0; }
    if (deadlineExpired(now, _fuelPump2TestUntilMs))  { ed.fuelPump2Demand = 0.0f;  _fuelPump2TestUntilMs  = 0; }
    if (deadlineExpired(now, _abSolTestUntilMs))      { ed.abSolOpen       = false; _abSolTestUntilMs      = 0; }
    if (deadlineExpired(now, _abPumpTestUntilMs))     { ed.abPumpDemand  = 0.0f;  _abPumpTestUntilMs     = 0; }
    if (deadlineExpired(now, _starterEnTestUntilMs))  { ed.starterEnabled  = false; _starterEnTestUntilMs  = 0; }
    if (deadlineExpired(now, _propPitchTestUntilMs))  { ed.propPitchDemand = 0;     _propPitchTestUntilMs  = 0; }
    if (deadlineExpired(now, _registryOutputTestUntilMs)) {
        if (_registryOutputTestIndex < HardwareConfig::channelRegistry.outputCount)
            ed.registryOutputDemand[_registryOutputTestIndex] =
                constrain(HardwareConfig::channelRegistry.outputs[_registryOutputTestIndex].safeDemand, 0.0f, 1.0f);
        _registryOutputTestIndex = 255;
        _registryOutputTestUntilMs = 0;
    }
}

// ── Extra Cooldown monitor ────────────────────────────────────
// Runs while extraCooldownActive.  Stops when:
//   - Mode leaves STANDBY (e.g. START command cancels it)
//   - User-set timeout expires (iParam seconds from slider)
static void checkExtraCooldown() {
    auto& ed = EngineData::instance();
    if (!ed.extraCooldownActive) return;

    // Guard: cancel if mode changed (FAULT counts as standby-like)
    if (ed.mode != SysMode::STANDBY && ed.mode != SysMode::FAULT) {
        ed.extraCooldownActive = false;
        ed.starterDemand       = 0;
        ed.starterEnabled      = false;
        ed.oilPumpPct          = 0;
        ed.oilScavengeDemand   = 0.0f;
        ed.oilScavengeOn       = false;
        ed.extraCooldownUntilMs  = 0;
        return;
    }

    if (deadlineExpired(millis(), ed.extraCooldownUntilMs)) {
        ed.extraCooldownActive = false;
        ed.starterDemand       = 0;
        ed.starterEnabled      = false;
        ed.oilPumpPct          = 0;
        ed.oilScavengeDemand   = 0.0f;
        ed.oilScavengeOn       = false;
        ed.extraCooldownUntilMs  = 0;
        Serial.println("[OT] Extra cooldown complete (timeout)");
    }
}

// ── Relight monitor ───────────────────────────────────────────
// Keeps igniter ON continuously while relight criteria hold.
// Fuel stays open (engine was RUNNING) — SafetyMonitor detects re-ignition.
// Igniter type (relay = full-on / PWM = dwell pattern) is handled by Hardware layer.
static int effectiveRelightConfirmSource() {
    if (Config::relightConfirmSource >= 1 && Config::relightConfirmSource <= 3)
        return Config::relightConfirmSource;
    if (Config::flameoutSource >= 1 && Config::flameoutSource <= 3)
        return Config::flameoutSource;
    if (HardwareConfig::hasFlame) return 1;
    if (HardwareConfig::hasN1Rpm) return 2;
    if (Config::effectiveEgtSource() != 0) return 3;
    return 0;
}

static bool relightConfirmed(const EngineData& ed) {
    switch (effectiveRelightConfirmSource()) {
        case 1:
            return HardwareConfig::hasFlame && ed.flameDetected;
        case 2: {
            float target = Config::relightConfirmRpm;
            return HardwareConfig::hasN1Rpm && ed.n1Healthy && ed.n1Rpm >= target
                && (millis() - _relightBeginMs) >= 1000UL;
        }
        case 3:
            if (!Config::primaryEgtHealthy(ed)) return false;
            if (_relightBeginEgt < 0.0f) {
                // EGT was unhealthy when the relight began — baseline on the
                // first healthy reading instead of confirming against 0.
                _relightBeginEgt = Config::primaryEgtC(ed);
                return false;
            }
            return Config::relightTotRiseC > 0.0f
                && Config::primaryEgtC(ed) >= (_relightBeginEgt + Config::relightTotRiseC);
        default:
            return false;
    }
}

static void checkRelight() {
    if (!_relightActive) return;
    auto& ed = EngineData::instance();

    // Engine left RUNNING state — abort cleanly
    if (ed.mode != SysMode::RUNNING) {
        _relightActive  = false;
        _relightBeginMs = 0;
        commandIgnitionTarget((uint8_t)Config::relightIgnitionTarget, false);
        return;
    }
    // Success: flame returned — turn igniter off, SafetyMonitor will clear flameout timer
    if (relightConfirmed(ed)) {
        _relightActive  = false;
        commandIgnitionTarget((uint8_t)Config::relightIgnitionTarget, false);
        _relightBeginMs = 0;
        Serial.println("[OT] Relight successful");
        return;
    }
    // Abort: N1 dropped below minimum — engine winding down, stop trying.
    // A fitted N1 sensor must remain trustworthy throughout the attempt.
    const float minimumRelightRpm = Config::effectiveRelightMinRpm();
    if (!HardwareConfig::hasN1Rpm || !ed.n1Healthy || ed.n1Rpm < minimumRelightRpm) {
        _relightActive  = false;
        _relightBeginMs = 0;
        commandIgnitionTarget((uint8_t)Config::relightIgnitionTarget, false);
        Serial.printf("[OT] Relight aborted - N1 below min (%.0f < %.0f)\n",
            (double)ed.n1Rpm, (double)minimumRelightRpm);
        return;
    }
    // Criteria still met — keep igniter on continuously
    commandIgnitionTarget((uint8_t)Config::relightIgnitionTarget, true);
}

// ── Windmilling oil protection in standby ────────────────────
// When a selected shaft is windmilling in STANDBY, run oil pump at a low feed
// duty to protect bearings. Source: 0=N1, 1=N2, 2=either fitted shaft.
// (_manualOilPct is declared above checkToolTimers(), which shares it.)

static void checkStandbyOilFeed() {
    auto& hw = HardwareConfig::instance();
    auto& ed = EngineData::instance();
    if (!hw.hasOilPump) {
        ed.standbyOilFeedActive = false;
        return;
    }
    if (ed.mode != SysMode::STANDBY && ed.mode != SysMode::FAULT) {
        ed.standbyOilFeedActive = false;   // FAULT: windmill protection stays active
        return;
    }
    if (ed.extraCooldownActive) return;  // extra cooldown controls oil in standby

    const bool n1Ok = hw.hasN1Rpm && ed.n1Healthy && ed.n1Rpm >= Config::standbyOilRpmLimit;
    const bool n2Ok = hw.hasN2Rpm && ed.n2Healthy && ed.n2Rpm >= Config::standbyOilRpmLimit;
    bool windmilling = false;
    switch (Config::standbyOilSource) {
        case 1:  windmilling = n2Ok; break;
        case 2:  windmilling = n1Ok || n2Ok; break;
        default: windmilling = n1Ok; break;
    }

    if (windmilling) {
        if (!ed.standbyOilFeedActive) {
            ed.standbyOilFeedActive = true;
            Serial.printf("[OT] Windmilling oil protection ON (N1=%.0f N2=%.0f)\n",
                (double)ed.n1Rpm, (double)ed.n2Rpm);
        }
        // Pressure mode: with an oil sensor + the oil control loop enabled, regulate the
        // standby feed to a target pressure (bar) instead of a fixed pump %. Reuses the
        // tuned oil loop (dt-normalised, with its own sensor-fault failsafe); the fixed
        // feed % is kept as a hard floor so bearings always see at least the safe flow.
        // The loop no-ops in bench mode, so pressure mode is validated on a real start.
        if (Config::standbyOilFeedBar > 0.0f && hw.hasOilPress && hw.hasOilLoop) {
            ed.oilTargetBar = Config::standbyOilFeedBar;
            g_ctrlOilLoop.tick();
            if (ed.oilPumpPct < Config::standbyOilFeedPct)
                ed.oilPumpPct = Config::standbyOilFeedPct;
        } else if (ed.oilPumpPct < Config::standbyOilFeedPct) {
            // Fixed % mode (default, or when no sensor/loop is available).
            ed.oilPumpPct = Config::standbyOilFeedPct;
        }
    } else if (ed.standbyOilFeedActive) {
        ed.standbyOilFeedActive = false;
        const bool pressureMode = Config::standbyOilFeedBar > 0.0f && hw.hasOilPress && hw.hasOilLoop;
        if (pressureMode) {
            // Pressure mode owned the pump via the oil loop and may have regulated it
            // above the feed %, so the fixed-% "<=" guard below wouldn't clear it —
            // leaving the pump running in standby. Hand back to the operator's manual
            // value and clear the target so the loop stops holding pressure.
            ed.oilTargetBar = 0.0f;
            ed.oilPumpPct   = _manualOilPct;
        } else if (ed.oilPumpPct <= Config::standbyOilFeedPct) {
            // Fixed %: only drop demand if we were the highest bidder — don't cut a
            // running oil prime. Restore the operator's manual SET_OIL_PCT value.
            ed.oilPumpPct = _manualOilPct;
        }
        Serial.printf("[OT] Windmilling oil protection OFF (oil %.0f%%)\n", (double)ed.oilPumpPct);
    }
}

// ── General-purpose DI channel polling ───────────────────────
// Debounces each configured DI channel and fires role actions on rising edge.
// SysMode enum bit positions: STANDBY=0, STARTUP=1, RUNNING=2, SHUTDOWN=3, FAULT=4
static void checkGeneralDI() {
    auto& hw = HardwareConfig::instance();
    auto& ed = EngineData::instance();
    unsigned long now = millis();
    bool hasDiAbArm = false;
    bool diAbArmActive = false;

    for (int i = 0; i < HardwareConfig::MAX_DI; i++) {
        if (hw.diCh[i].pin < 0) continue;

        bool rawActive = (digitalRead(hw.diCh[i].pin) == (hw.diCh[i].activeH ? HIGH : LOW));

        // Debounce: only commit a change if the raw state has been stable for debounceMs
        if (rawActive != _diRawLast[i]) {
            _diLastChange[i] = now;
            _diRawLast[i]    = rawActive;
        }

        bool prevState = ed.diState[i];
        if ((now - _diLastChange[i]) >= (unsigned long)hw.diCh[i].debounceMs) {
            ed.diState[i] = rawActive;
        }

        const char* roleForLevel = hw.diCh[i].role;
        uint8_t modeBitNow = (uint8_t)(1u << (int)ed.mode);
        const bool activeInMode = (hw.diCh[i].activeModes & modeBitNow) != 0;
        if (strcmp(roleForLevel, "ab_arm") == 0 && activeInMode) {
            hasDiAbArm = true;
            if (ed.diState[i]) diAbArmActive = true;
        }

        // Fault and E-Stop are LEVEL-sensitive while the engine operates:
        // an interlock already active when STARTUP begins must trip
        // immediately — edge-only handling missed a held-active input until
        // it was released and re-asserted. Still suppressed outside
        // STARTUP/RUNNING (noise in STANDBY must not block starts; firing in
        // FAULT would run the shutdown sequence and silently clear the
        // lockout). Triggering changes mode, so this fires once per event.
        const bool isFaultRole = strcmp(roleForLevel, "fault") == 0;
        const bool isEstopRole = strcmp(roleForLevel, "estop") == 0;
        const bool isLowOilSwitch = strcmp(roleForLevel, "low_oil_switch") == 0 && hw.safetyLowOil;
        const bool isOilZeroSwitch = strcmp(roleForLevel, "oil_zero_switch") == 0 && hw.safetyOilZero;
        if ((isFaultRole || isEstopRole || isLowOilSwitch || isOilZeroSwitch) && ed.diState[i] && activeInMode
            && (ed.mode == SysMode::STARTUP || ed.mode == SysMode::RUNNING)) {
            if (isFaultRole || isLowOilSwitch || isOilZeroSwitch) {
                // Replicate SafetyMonitor fault path:
                // set faultDescription with user message, then trigger shutdown
                if (hw.diCh[i].faultMsg[0]) {
                    strncpy(ed.faultDescription, hw.diCh[i].faultMsg,
                            sizeof(ed.faultDescription) - 1);
                    ed.faultDescription[sizeof(ed.faultDescription) - 1] = '\0';
                } else if (hw.diCh[i].faultCode[0]) {
                    snprintf(ed.faultDescription, sizeof(ed.faultDescription),
                             "DI fault: %s", hw.diCh[i].faultCode);
                } else {
                    snprintf(ed.faultDescription, sizeof(ed.faultDescription),
                             "DI fault: channel %d triggered", i + 1);
                }
                // Inject the DI fault code into SafetyMonitor so that
                // enterFaultShutdown() reads the correct string via lastFault().
                // Without this, lastFault() returns null (or a stale code from a
                // previous safety fault), corrupting the event log and lastEvent.
                const char* diCode = isLowOilSwitch ? "LOW_OIL" :
                                     isOilZeroSwitch ? "OIL_ZERO" :
                                     (hw.diCh[i].faultCode[0] ? hw.diCh[i].faultCode : "DI_FAULT");
                g_safety.setExternalFault(diCode);
                Serial.printf("[DI] ch%d fault role triggered: %s\n", i, diCode);
                enterFaultShutdown();
            } else {
                strncpy(ed.lastEvent, "Emergency stop - DI channel", sizeof(ed.lastEvent) - 1);
                Serial.printf("[DI] ch%d estop role triggered\n", i);
                enterShutdown();
            }
            continue;
        }

        // Rising edge: channel just became active
        if (ed.diState[i] && !prevState) {
            const char* role = hw.diCh[i].role;
            if (strcmp(role, "none") == 0 || strcmp(role, "sequence_gate") == 0) continue;

            // Check activeModes bitmask
            uint8_t modeBit = (uint8_t)(1u << (int)ed.mode);
            if (!(hw.diCh[i].activeModes & modeBit)) continue;

            if (strcmp(role, "ab_arm") == 0) {
                ed.abArmSwitchOn = true;
                Serial.printf("[DI] ch%d ab_arm active\n", i);

            } else if (strcmp(role, "limp_mode") == 0) {
                ed.limpMode = true;
                Serial.printf("[DI] ch%d limp_mode activated\n", i);

            } else if (strcmp(role, "ab_fire") == 0) {
                // Trigger AB fire — same effect as pressing AB FIRE button in the UI.
                // DI polling already runs on the ECU core, so avoid losing the
                // one-shot edge if the web command queue happens to be full.
                handleCommand({OTCommand::AB_FIRE});
                Serial.printf("[DI] ch%d ab_fire triggered\n", i);
            }
            // "inhibit_start" role: state is stored in ed.diState[i] and checked in handleCommand(START)
        }

        // Falling edge: level-sensitive roles that clear on release
        if (!ed.diState[i] && prevState) {
            const char* role = hw.diCh[i].role;
            if (strcmp(role, "ab_arm") == 0) {
                ed.abArmSwitchOn = false;
                Serial.printf("[DI] ch%d ab_arm inactive\n", i);
            } else if (strcmp(role, "limp_mode") == 0) {
                ed.limpMode = false;
                Serial.printf("[DI] ch%d limp_mode deactivated\n", i);
            }
        }

        // limp_mode is level-authoritative while the switch is HELD: re-assert
        // ON every tick so a software TOGGLE_LIMP_MODE can't desync from a
        // physically-held switch. Release is handled by the falling edge above,
        // and a software toggle still works when no limp switch is held.
        if (strcmp(hw.diCh[i].role, "limp_mode") == 0 && ed.diState[i] &&
            (hw.diCh[i].activeModes & (uint8_t)(1u << (int)ed.mode))) {
            ed.limpMode = true;
        }
    }

    // Registry digital channels (including TCA9554 inputs) use the same
    // turbine semantics as native DI channels. Safety interlocks fail closed:
    // a configured but disconnected safety input blocks START and faults an
    // operating engine instead of silently assuming the switch is clear.
    static bool registryPrevious[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    bool hasRegistryAbArm = false, registryAbArmActive = false;
    for (uint8_t i = 0; i < hw.channelRegistry.inputCount; ++i) {
        const auto& channel = hw.channelRegistry.inputs[i];
        const char* role = strcmp(channel.purpose, "generic") ? channel.purpose : channel.role;
        const bool safetyRole = !strcmp(role, "fault") || !strcmp(role, "estop") ||
            (!strcmp(role, "low_oil_switch") && hw.safetyLowOil) ||
            (!strcmp(role, "oil_zero_switch") && hw.safetyOilZero);
        const bool healthy = ed.registryInputHealthy[i];
        const bool active = healthy && ed.registryInputValue[i] >= 0.5f;
        const bool unavailableTrip = safetyRole && !healthy;
        if (!strcmp(role, "ab_arm")) {
            hasRegistryAbArm = true;
            registryAbArmActive |= active;
        } else if (!strcmp(role, "limp_mode") && healthy) {
            ed.limpMode = active;
        } else if (!strcmp(role, "ab_fire") && active && !registryPrevious[i]) {
            handleCommand({OTCommand::AB_FIRE});
        }
        if (safetyRole && (active || unavailableTrip) &&
            (ed.mode == SysMode::STARTUP || ed.mode == SysMode::RUNNING)) {
            const bool estop = !strcmp(role, "estop");
            if (estop && !unavailableTrip) {
                strncpy(ed.lastEvent, "Emergency stop - registry input", sizeof(ed.lastEvent) - 1);
                enterShutdown();
            } else {
                const char* code = unavailableTrip ? "I2C_INTERLOCK_LOST" :
                    !strcmp(role, "low_oil_switch") ? "LOW_OIL" :
                    !strcmp(role, "oil_zero_switch") ? "OIL_ZERO" : "REGISTRY_FAULT";
                snprintf(ed.faultDescription, sizeof(ed.faultDescription),
                         unavailableTrip ? "Safety input %s is disconnected or stale." :
                                           "Safety input %s is active.",
                         channel.name[0] ? channel.name : channel.id);
                g_safety.setExternalFault(code);
                enterFaultShutdown();
            }
        }
        registryPrevious[i] = active;
    }

    // A lost TCA9554 cannot be commanded to its safe state and may physically
    // retain its last latch value. Treat loss of an engine-affecting expander
    // output as a control fault instead of pretending the command succeeded.
    if ((ed.mode == SysMode::STARTUP || ed.mode == SysMode::RUNNING) &&
        Hardware::unavailableEngineI2cOutput()) {
        const auto* channel = Hardware::unavailableEngineI2cOutput();
        snprintf(ed.faultDescription, sizeof(ed.faultDescription),
                 "I2C output %s is disconnected; its physical state cannot be guaranteed.",
                 channel->name[0] ? channel->name : channel->id);
        g_safety.setExternalFault("I2C_OUTPUT_LOST");
        enterFaultShutdown();
    }

    if (hasDiAbArm || hasRegistryAbArm) {
        bool dedicatedArmActive = false;
        if (hw.abRequiresArmSwitch && hw.abArmSwitchPin >= 0) {
            dedicatedArmActive = (digitalRead(hw.abArmSwitchPin) ==
                                  (hw.abArmSwitchActiveH ? HIGH : LOW));
        }
        ed.abArmSwitchOn = dedicatedArmActive || diAbArmActive || registryAbArmActive;
    }
}

// ── Afterburner state machine ─────────────────────────────────
// Separate parallel state machine running alongside main engine loop.
// AB can only run in RUNNING mode. Trigger sources: manual (web),
// throttle threshold, dedicated switch, or analog/RC input.

static bool _abInShutSeq = false;   // true while running ab shutdown sequence

static void enterABIgniting() {
    auto& ed = EngineData::instance();
    if (!HardwareConfig::hasAfterburner) return;
    if (ed.mode != SysMode::RUNNING) return;
    if (ed.abMode != ABMode::Off && ed.abMode != ABMode::Arming) return;

    ed.abMode = ABMode::Igniting;
    _abInShutSeq = false;
    FlightRecorder::logBlockEnter("AB_IGN_START");
    Serial.println("[AB] Entering ignition sequence");

    // Default sequence if nothing configured:
    //   ABCheckReady → ABSolOpen → ABPumpOn → ABIgnite(torch) → ABFlameConfirm → ABStabilize
    if (_abIgnCount == 0) {
        static IBlock* _defAbBlocks[] = {
            &g_blkABCheckReady, &g_blkABSolOpen, &g_blkABPumpOn,
            &g_blkABIgnite, &g_blkABFlameConfirm, &g_blkABStabilize
        };
        g_abSequencer.startSequence(_defAbBlocks, 6);
    } else {
        g_abSequencer.startSequence(_abIgnBlocks, _abIgnCount,
                                    HardwareConfig::abEnterActions,
                                    HardwareConfig::abExitActions);
    }
}

static void enterABShutdown() {
    auto& ed = EngineData::instance();
    if (ed.abMode == ABMode::Off || ed.abMode == ABMode::ShuttingDown) return;
    ed.abMode     = ABMode::ShuttingDown;
    _abInShutSeq  = true;

    // Cut main fuel offset immediately — don't wait for the shutdown sequence
    ed.abFuelOffset = 0.0f;
    // Cut igniter immediately
    ed.igniter2On = false;
    // AB fuel is never left to configurable shutdown timing. The custom
    // sequence may still run purge/cooling actions after this hard boundary.
    ed.abSolOpen = false;
    ed.abPumpDemand = 0.0f;

    Serial.println("[AB] Entering shutdown sequence");
    if (_abShutCount == 0) {
        // Default: close solenoid then cut pump — AB flame dies immediately
        static IBlock* _defAbShut[] = { &g_blkABSolClose, &g_blkABPumpOff };
        g_abSequencer.startSequence(_defAbShut, 2);
    } else {
        g_abSequencer.startSequence(_abShutBlocks, _abShutCount,
                                    HardwareConfig::abShutEnterActions,
                                    HardwareConfig::abShutExitActions);
    }
}

// Called when AB ignition sequence completes (g_abSequencer done callback)
static void abSequenceDone() {
    auto& ed = EngineData::instance();
    if (_abInShutSeq) {
        // Shutdown sequence done
        ed.abMode         = ABMode::Off;
        ed.abSolOpen      = false;
        ed.abPumpDemand = 0;
        ed.igniter2On     = false;
        _abInShutSeq      = false;
        Serial.println("[AB] Shutdown complete - AB Off");
    }
    // Ignition seq done: abMode is normally set to Running by ABStabilize.onExit().
    // A custom sequence may omit stabilization, but it may never omit the
    // explicit confirmation step.
    else {
        bool explicitlyConfirmed = _abIgnCount == 0;
        for (int i = 0; i < _abIgnCount; ++i) {
            if (strcmp(_abIgnBlocks[i]->name(), "ABFlameConfirm") == 0) {
                explicitlyConfirmed = true;
                break;
            }
        }
        if (!explicitlyConfirmed) {
            ed.abMode = ABMode::Fault;
            ed.abSolOpen = false;
            ed.abPumpDemand = 0.0f;
            ed.abFuelOffset = 0.0f;
            ed.igniter2On = false;
            Serial.println("[AB] Ignition sequence rejected: no explicit flame-confirmation block");
        } else if (ed.abMode == ABMode::Igniting) {
            ed.abMode = ABMode::Running;
            Serial.println("[AB] Ignition confirmed - entering Running without stabilization hold");
        }
    }
}

static void abSequenceAbort() {
    auto& ed = EngineData::instance();
    ed.abSolOpen      = false;
    ed.abPumpDemand = 0;
    ed.abFuelOffset   = 0.0f;
    ed.igniter2On     = false;
    if (_abInShutSeq) {
        // Shutdown sequence aborted — treat as complete; AB is off
        ed.abMode    = ABMode::Off;
        _abInShutSeq = false;
        Serial.println("[AB] Shutdown sequence aborted - AB Off");
    } else {
        // Ignition sequence aborted (e.g. ABCheckReady conditions not met).
        // Set Fault rather than Off so checkABTrigger() doesn't immediately
        // re-enter the ignition sequence on the next tick while the trigger
        // is still asserted — which would create a rapid re-entry loop.
        // User must release and re-assert the trigger to retry.
        ed.abMode = ABMode::Fault;
        Serial.println("[AB] Ignition sequence aborted - requires trigger release to retry");
    }
}

static void abSequenceFault() {
    auto& ed = EngineData::instance();
    ed.abMode         = ABMode::Fault;
    ed.abSolOpen      = false;
    ed.abPumpDemand = 0;
    ed.abFuelOffset   = 0.0f;
    ed.igniter2On     = false;
    _abInShutSeq      = false;
    Serial.println("[AB] Sequence FAULT - ignition failed");
    // Don't fault the main engine; AB fault is non-critical
    // Leave abMode=Fault until next start attempt
}

static void checkABTrigger() {
    if (!HardwareConfig::hasAfterburner) return;
    auto& ed  = EngineData::instance();
    auto& hw  = HardwareConfig::instance();
    static bool _abTriggerPrev = false;
    static bool _abFlameLossArmed = false;
    static unsigned long _abFlameLossSinceMs = 0;

    // If AB is running and main engine shuts down, close AB
    // (handled above)

    // ── Evaluate trigger ─────────────────────────────────────
    bool triggerAsserted = false;
    auto registrySwitchActive = [&](const char* purpose, bool& found) {
        const auto& reg = hw.channelRegistry;
        found = false;
        bool active = false;
        for (uint8_t i = 0; i < reg.inputCount; ++i) {
            const auto& channel = reg.inputs[i];
            if (!channel.installed || strcmp(channel.purpose, purpose)) continue;
            found = true;
            active |= ed.registryInputHealthy[i] && ed.registryInputValue[i] >= 0.5f;
        }
        return active;
    };

    switch (hw.abTriggerSource) {
        case 0: // manual only — no automatic trigger polling
            break;

        case 1: // throttle threshold
            // Use the protected demand when slew is active; otherwise the ordinary
            // controller demand is already clean because AB offset is applied at output.
            triggerAsserted = ((hw.hasThrottle ? g_ctrlThrottleSlew.currentDemand()
                                                   : ed.throttleDemand)
                                >= Config::abThrottleThreshold);
            break;

        case 2: { // dedicated switch
            bool registryFound = false;
            triggerAsserted = registrySwitchActive("ab_fire", registryFound);
            if (!registryFound && hw.abSwitchPin >= 0)
                triggerAsserted = (digitalRead(hw.abSwitchPin) ==
                                   (hw.abSwitchActiveH ? HIGH : LOW));
            break;
        }

        case 3: // analog / RC input
            triggerAsserted = ed.abInputValid && (ed.abInputRaw >= hw.abInputThreshold);
            break;
    }

    ed.abTriggerActive = triggerAsserted;

    // Apply arm switch gate (source 1/2/3 only; not manual)
    if (hw.abTriggerSource != 0 && hw.abRequiresArmSwitch) {
        if (!ed.abArmSwitchOn) triggerAsserted = false;
    }

    if (ed.mode != SysMode::RUNNING) {
        _abFlameLossArmed = false;
        _abTriggerPrev = triggerAsserted;
        if (ed.abMode != ABMode::Off) {
            enterABShutdown();
        }
        return;
    }

    // ── State transitions ────────────────────────────────────
    // Rising-edge latch: only re-enter from Off/Fault on a fresh trigger assertion.
    // Without this, a Fault set while the trigger is still held causes an immediate
    // re-entry on the very next tick — creating the same rapid loop as Off did.
    bool triggerRisingEdge = triggerAsserted && !_abTriggerPrev;

    switch (ed.abMode) {
        case ABMode::Off:
        case ABMode::Fault:
            if (triggerRisingEdge && hw.abTriggerSource != 0) {
                enterABIgniting();
            }
            break;

        case ABMode::Running:
            if (Config::abFlameMode == 0 && HardwareConfig::hasAbFlame) {
                const bool flameLost = !ed.abFlameHealthy || !ed.abFlameOn;
                const unsigned long now = millis();
                if (flameLost) {
                    if (!_abFlameLossArmed) {
                        _abFlameLossArmed = true;
                        _abFlameLossSinceMs = now;
                    } else if (now - _abFlameLossSinceMs >=
                               (unsigned long)Config::abFlameLossDelayMs) {
                        Serial.println("[AB] Running flame lost - shutting down afterburner only");
                        _abFlameLossArmed = false;
                        enterABShutdown();
                        break;
                    }
                } else {
                    _abFlameLossArmed = false;
                }
            } else {
                _abFlameLossArmed = false;
            }
            // AB main fuel offset: stored in ed.abFuelOffset and applied at the
            // actuator write in Hardware::updateActuators().  Do NOT add it to
            // throttleDemand — that value is ThrottleSlew's input/output and
            // writing an inflated value there causes the slew to drift upward
            // (toward throttleDemand, which is already offset) every tick.
            ed.abFuelOffset = Config::abMainFuelOffsetPct / 100.0f;
            // Apply AB pump demand: follow throttle (lerp min→max) or fixed at max.
            // Track the protected throttle demand when available.
            {
                float pct;
                if (Config::abPumpControlMode == 1) {
                    float throttle = hw.hasThrottle ? g_ctrlThrottleSlew.currentDemand()
                                                        : ed.throttleDemand;
                    pct = Config::abPumpMinPct + (Config::abPumpMaxPct - Config::abPumpMinPct)
                          * throttle;
                } else if (Config::abPumpControlMode == 2) {
                    float command = ed.abInputValid ? ed.abInputNorm : 0.0f;
                    pct = Config::abPumpMinPct + (Config::abPumpMaxPct - Config::abPumpMinPct)
                          * command;
                } else {
                    pct = Config::abPumpMaxPct;
                }
                ed.abPumpDemand = constrain(pct / 100.0f, 0.0f, 1.0f);
            }
            // Shut down if trigger released
            if (!triggerAsserted && hw.abTriggerSource != 0) {
                enterABShutdown();
            }
            break;

        case ABMode::Igniting:
        case ABMode::Arming:
            // For hardware-triggered AB, releasing the trigger or losing the
            // arm gate during light-up must cut fuel promptly instead of
            // allowing the ignition sequence to finish.
            if (!triggerAsserted && hw.abTriggerSource != 0) {
                enterABShutdown();
            }
            break;

        case ABMode::ShuttingDown:
            break;  // sequencer is running — let it finish
    }

    _abTriggerPrev = triggerAsserted;
}

// ── Cooldown skip (hold START+STOP in SHUTDOWN) ───────────────
// Holding both buttons simultaneously for cooldownSkipHoldMs
// while in SHUTDOWN mode aborts cooldown and goes directly to STANDBY.
static unsigned long _cooldownSkipHoldStart = 0;

static void checkCooldownSkip() {
    auto& ed = EngineData::instance();
    if (ed.mode != SysMode::SHUTDOWN) {
        _cooldownSkipHoldStart = 0;
        return;
    }
    auto& hcfg = HardwareConfig::instance();
    bool startHeld = hcfg.startPin >= 0 &&
                     (digitalRead(hcfg.startPin) == (hcfg.startActiveH ? HIGH : LOW));
    bool stopHeld  = hcfg.stopPin >= 0 &&
                     (digitalRead(hcfg.stopPin) == (hcfg.stopActiveH ? HIGH : LOW));
    if (startHeld && stopHeld) {
        if (_cooldownSkipHoldStart == 0) _cooldownSkipHoldStart = millis();
        else if ((millis() - _cooldownSkipHoldStart)
                 >= (unsigned long)Config::cooldownSkipHoldMs)
        {
            _cooldownSkipHoldStart = 0;
            Serial.println("[OT] Cooldown skip - both buttons held");
            strncpy(ed.lastEvent, "Cooldown skipped by operator", sizeof(ed.lastEvent) - 1);
            enterStandby();
        }
    } else {
        _cooldownSkipHoldStart = 0;
    }
}

// ── Mode transitions ──────────────────────────────────────────

static void enterRunning() {
    auto& ed = EngineData::instance();
    ed.mode               = SysMode::RUNNING;
    ed.faultShutdownActive = false;
    // Dev mode and bench mode runs are not real engine starts — don't count toward run log
    if (!ed.benchMode && !ed.devMode) {
        ed.runCount = ed.runCount + 1;          // per-boot (kept for any internal use)
        Config::incRunCount();                  // persisted lifetime count (guarded RMW)
        Config::requestRuntimeStatsSave();
    }
    ed.relightArmed       = true;   // arm relight for this run
    ed.relightAttempts    = 0;      // reset attempt counter
    // Ensure flameout detection is armed regardless of which startup sequence was
    // used.  Spool::onEnter() normally sets this, but custom sequences that omit
    // Spool would silently leave flameMonitorActive=false and flameout would
    // never be detected in RUNNING mode.
    ed.flameMonitorActive = true;
    // Custom startup sequences may omit Spool/SafetyHold. Never enter RUNNING
    // with configured low-oil protection silently disarmed.
    if (HardwareConfig::safetyLowOil && HardwareConfig::hasOilPress)
        ed.oilMinBar = fmaxf(ed.oilMinBar, Config::oilRunningMin);
    ed.lastRunFlameAvg = 0;
    ed.lastRunFlameSamples = 0;
    ed.minOilPressure = -1.0f;
    _runStartMs        = millis();
    ed.runStartMs      = _runStartMs;   // mirror for the live hour meter in telemetry
    strncpy(ed.lastEvent, "Startup complete - engine self-sustained", sizeof(ed.lastEvent) - 1);
    _buzzerPattern = 2;  // startup OK beep
    Hardware::initControllers();
    FlightRecorder::logRunningEntry();
    Serial.println("[OT] RUNNING");
}

static void enterShutdown() {
    auto& ed = EngineData::instance();
    if (ed.mode == SysMode::SHUTDOWN) return;  // already shutting down
    ed.mode = SysMode::SHUTDOWN;
    cutCombustionAndStarterNow();
    ed.faultShutdownActive = false;
    _buzzerPattern = 4; _buzzerStep = 0;  // single low beep: normal stop
    // Clear operator-hold states so igniter/flags don't persist into cooldown.
    // The manual relight target may be igniter2 or glow — cut it explicitly;
    // checkStartSwitch's cut path is skipped once the flag is cleared here.
    if (ed.manualRelightActive)
        commandIgnitionTarget((uint8_t)Config::manualRelightIgnitionTarget, false);
    ed.manualRelightActive = false;
    ed.igniterOn           = false;
    if (HardwareConfig::hasAfterburner) enterABShutdown();
    strncpy(ed.lastEvent, "Normal shutdown commanded", sizeof(ed.lastEvent) - 1);
    FlightRecorder::logNormalShutdown();
    if (_shutdownCount == 0) {
        // A zero-block sequence never completes and never calls back — the
        // ECU would sit in SHUTDOWN forever with outputs untouched (fuel
        // included). Safe-stop directly instead.
        Serial.println("[OT] Shutdown sequence empty - immediate all-off to STANDBY");
        enterStandby();  // zeroes demands + Hardware::allOff()
        return;
    }
    g_sequencer.startSequence(_shutdownBlocks, _shutdownCount,
                              HardwareConfig::shutdownEnterActions,
                              HardwareConfig::shutdownExitActions);
    Serial.println("[OT] SHUTDOWN");
}

static void enterFaultShutdown() {
    auto& ed = EngineData::instance();
    const char* fault = g_safety.lastFault();
    if (!fault || !fault[0]) fault = "UNKNOWN";
    if (ed.mode == SysMode::SHUTDOWN) {
        ed.faultShutdownActive = true;
        // Already shutting down — log the additional fault but keep the
        // running shutdown sequence. Restarting it from block 0 would
        // interrupt spindown/cooldown (and a deterministic fault would
        // restart it forever). Block faults raised BY the shutdown sequence
        // itself go through sequenceFaulted() instead.
        FlightRecorder::logFault(fault);
        snprintf(ed.lastEvent, sizeof(ed.lastEvent), "FAULT: %s", fault);
        Serial.printf("[OT] FAULT during SHUTDOWN (sequence continues): %s\n", fault);
        return;
    }
    FlightRecorder::logFault(fault);           // sensor snapshot at moment of fault
    FlightRecorder::logFaultShutdown(fault);   // shutdown event record
    ed.mode = SysMode::SHUTDOWN;
    cutCombustionAndStarterNow();
    ed.faultShutdownActive = true;
    if (HardwareConfig::hasPropPitch) ed.propPitchDemand = 1.0f;
    // Synchronously stop any active AB sequence so igniter2, solenoid and
    // AB pump are cut immediately rather than waiting for the next
    // checkABTrigger() tick.
    if (HardwareConfig::hasAfterburner) enterABShutdown();
    snprintf(ed.lastEvent, sizeof(ed.lastEvent), "FAULT: %s", fault);
    _buzzerPattern = 1;  // rapid fault beep
    if (_shutdownCount == 0) {
        // Same rationale as enterShutdown(): a zero-block sequence would
        // leave the ECU in SHUTDOWN forever with fuel state untouched.
        Serial.printf("[OT] FAULT SHUTDOWN (%s): empty sequence - immediate all-off to STANDBY\n", fault);
        enterStandby();  // zeroes demands + Hardware::allOff()
        return;
    }
    g_sequencer.startSequence(_shutdownBlocks, _shutdownCount,
                              HardwareConfig::shutdownEnterActions,
                              HardwareConfig::shutdownExitActions);
    Serial.printf("[OT] FAULT SHUTDOWN: %s\n", fault);
    if (HardwareConfig::hasClusterSerial) {
        // Send fault-specific cluster status code (more descriptive than generic ShuttingDown)
        if      (strcmp(fault, "OVERSPEED") == 0)   ClusterSerial::sendStatus(ClCode::Overspeed);
        else if (strcmp(fault, "FLAMEOUT")  == 0)   ClusterSerial::sendStatus(ClCode::FlameOut);
        else if (strcmp(fault, "LOW_OIL")   == 0)   ClusterSerial::sendStatus(ClCode::OilPressureLow);
        else if (strcmp(fault, "OIL_ZERO")  == 0)   ClusterSerial::sendStatus(ClCode::OilZero);
        else                                         ClusterSerial::sendStatus(ClCode::ShuttingDown);
    }
    if (HardwareConfig::hasMAVLink) {
        char buf[50];
        snprintf(buf, sizeof(buf), "FAULT: %s", fault ? fault : "?");
        g_mavlink.sendStatusText(buf);
    }
}

static void enterStandby() {
    auto& ed = EngineData::instance();
    // Some paths intentionally bypass normal sequence completion (most
    // notably the operator's START+STOP cooldown override). Stop the active
    // block before changing mode so it cannot tick again in STANDBY and
    // re-energize a side action, oil/scavenge pump, starter or cooling output.
    // sequenceComplete() reaches here with the sequencer already stopped, so
    // the normal completion path remains unchanged.
    if (g_sequencer.isRunning()) g_sequencer.stopSequence();
    ResetRecovery::markSafe();
    SessionLogger::endSession();   // close session log for this run
    // Accumulate engine-on time (only if we actually entered RUNNING this session)
    if (_runStartMs > 0) {
        // Bench / dev mode runs are not real engine time — don't count toward total
        if (!ed.benchMode && !ed.devMode) {
            uint32_t elapsed = (millis() - _runStartMs) / 1000;
            Config::addRunSeconds(elapsed);     // guarded RMW
            // Runtime statistics are not engine configuration. Persist them
            // through NVS so stopping a run does not rewrite ecu_config.json.
            Config::requestRuntimeStatsSave();
        }
        _runStartMs = 0;
        ed.runStartMs = 0;   // stop the live hour meter; persisted total now reflects this run
    }
    _buzzerPattern = 0;  // silence any buzzer
    ed.mode               = SysMode::STANDBY;
    ed.throttleDemand     = 0;
    ed.propPitchDemand    = 0;
    ed.abPumpDemand       = 0;
    ed.fuelPump2Demand    = 0;
    ed.oilTargetBar          = 0;
    ed.oilPumpPct       = 0;      // clear pump % — prevents stuck-at-failsafe in standby
    ed.oilFailsafeActive  = false;
    ed.fuelSolOpen        = false;
    ed.igniterOn          = false;
    ed.starterDemand      = 0;
    ed.starterEnabled     = false;
    ed.manualRelightActive = false;
    ed.flameMonitorActive = false;
    ed.oilMinBar          = 0;
    ed.relightArmed       = false;
    ed.relightAttempts    = 0;
    ed.extraCooldownActive = false;
    ed.extraCooldownUntilMs  = 0;
    // STANDBY is the clean ownership boundary for all temporary Tools-page
    // actions.  A FAULT reset may enter here before a test timer naturally
    // expires; retaining any timer would leave outputs safely off but make
    // subsequent tests and START look busy until that hidden timer elapsed.
    _fuelPrimeUntilMs      = 0;
    _oilPrimeUntilMs       = 0;
    _ignTestUntilMs        = 0;
    _ign2TestUntilMs       = 0;
    _startTestUntilMs      = 0;
    _idleTestUntilMs       = 0;
    _oilScavTestUntilMs    = 0;
    _coolFanTestUntilMs    = 0;
    _airstarterTestUntilMs = 0;
    _bleedValveTestUntilMs = 0;
    _glowTestUntilMs       = 0;
    _fuelPump2TestUntilMs  = 0;
    _abSolTestUntilMs      = 0;
    _abPumpTestUntilMs     = 0;
    _starterEnTestUntilMs  = 0;
    _propPitchTestUntilMs  = 0;
    _registryOutputTestUntilMs = 0;
    _registryOutputTestIndex = 255;
    _relightActive         = false;
    _relightBeginMs        = 0;
    _relightBeginEgt       = 0.0f;
    _manualOilPct          = 0.0f;
    ed.limpMode           = false;
    ed.clusterCode        = 0;
    ed.fuelEverOpened     = false;
    // AB cleanup
    if (g_abSequencer.isRunning()) g_abSequencer.stopSequence();
    ed.abMode          = ABMode::Off;
    ed.abSolOpen       = false;
    ed.abTriggerActive = false;
    _abInShutSeq       = false;
    if (ed.lastEvent[0] == 0) {
        strncpy(ed.lastEvent, "Ready", sizeof(ed.lastEvent) - 1);
    }
    // Keep any startup-abort or fault explanation visible after the ECU returns
    // to STANDBY. START clears it before a new attempt.
    Hardware::allOff();
    ed.faultShutdownActive = false;
    Serial.println("[OT] STANDBY");
}

static void enterAbortStandby() {
    auto& ed = EngineData::instance();
    const char* blockName = ed.currentBlock[0] ? ed.currentBlock : "UNKNOWN";
    snprintf(ed.lastEvent, sizeof(ed.lastEvent), "Aborted at: %s", blockName);
    FlightRecorder::logAbort(blockName, "startup_abort");
    // Set a plain-language description for the fault/abort banner
    if (strcmp(blockName, "OilPrime") == 0 || strcmp(blockName, "OilPump") == 0) {
        strncpy(ed.faultDescription,
            "Startup aborted: oil prime did not reach target pressure in time.\n"
            "What to do: Check oil level, oil pump wiring and duty settings, "
            "and oil line connections. Try running Oil Prime from the Tools page to diagnose.",
            sizeof(ed.faultDescription) - 1);
    } else if (strcmp(blockName, "FlameConfirm") == 0) {
        strncpy(ed.faultDescription,
            "Startup aborted: flame was not detected within the allowed time.\n"
            "What to do: Check fuel supply, main fuel shutoff, igniter operation, "
            "and flame sensor threshold. Try Igniter Test from the Tools page.",
            sizeof(ed.faultDescription) - 1);
    } else if (strcmp(blockName, "Spool") == 0) {
        strncpy(ed.faultDescription,
            "Startup aborted: engine did not reach spool RPM in time.\n"
            "What to do: Check starter motor, throttle calibration, and fuel flow. "
            "Increase spool timeout in Sequence settings if the engine is healthy.",
            sizeof(ed.faultDescription) - 1);
    } else {
        snprintf(ed.faultDescription, sizeof(ed.faultDescription),
            "Startup aborted at sequence step: %s.\n"
            "What to do: Check the Event Log for details. "
            "Verify all sensors and actuators are working correctly.",
            blockName);
    }
    ed.faultDescription[sizeof(ed.faultDescription) - 1] = '\0';
    _buzzerPattern = 1;  // rapid fault beep

    if (ed.fuelEverOpened) {
        // Fuel was opened this attempt — engine may have partial combustion and hot EGT.
        // Run the full shutdown sequence (ImmediateCut → RPMDrop → CooldownSpin → FinalStop)
        // to keep bearings oiled through spindown and cool the turbine before standby.
        ed.mode = SysMode::SHUTDOWN;
        cutCombustionAndStarterNow();
        ed.faultShutdownActive = true;
        FlightRecorder::logFaultShutdown("STARTUP_ABORT");
        g_sequencer.startSequence(_shutdownBlocks, _shutdownCount,
                                  HardwareConfig::shutdownEnterActions,
                                  HardwareConfig::shutdownExitActions);
        Serial.printf("[OT] Startup abort (fuel was open) -> SHUTDOWN for safe spindown\n");
    } else {
        // Aborted before any ignition attempt — safe to go directly to STANDBY.
        enterStandby();
    }
}

// ── Sequence complete dispatcher ──────────────────────────────
// The sequencer uses a single Complete callback for both startup and shutdown.
// We check current mode to decide which transition to make.
static void sequenceComplete() {
    if (EngineData::instance().mode == SysMode::STARTUP) {
        enterRunning();   // startup finished successfully → RUNNING
    } else {
        enterStandby();   // shutdown finished → STANDBY
    }
}

// ── Sequencer fault callback ──────────────────────────────────
// A block fault during startup runs the normal fault-shutdown path. A block
// fault raised BY the shutdown sequence itself must not restart the sequence
// from block 0 (a deterministic fault would loop forever, never reaching
// STANDBY and flooding the event log) — cut all outputs and land in STANDBY.
static void sequenceFaulted() {
    auto& ed = EngineData::instance();
    if (ed.mode != SysMode::SHUTDOWN) {
        enterFaultShutdown();
        return;
    }
    const char* blockName = ed.currentBlock[0] ? ed.currentBlock : "UNKNOWN";
    FlightRecorder::logFault("SHUTDOWN_SEQ_FAULT");
    snprintf(ed.lastEvent, sizeof(ed.lastEvent), "Shutdown fault at: %s", blockName);
    _buzzerPattern = 1;  // rapid fault beep
    Serial.printf("[OT] Shutdown sequence FAULT at %s - cutting outputs, STANDBY\n", blockName);
    enterStandby();      // zeroes demands + Hardware::allOff()
}

// ── Command handler (called from ECU loop on Core 1) ─────────

static void handleCommand(const OTPacket& pkt) {
    auto& ed = EngineData::instance();
    // FAULT is a light lockout: START stays blocked, but tools, toggles and
    // dev mode behave exactly as in STANDBY so the user can diagnose and fix.
    const bool standbyLike = (ed.mode == SysMode::STANDBY || ed.mode == SysMode::FAULT);

    auto mayEnergizeOutput = [](OTCommand cmd) {
        switch (cmd) {
            case OTCommand::SET_OIL_DEMAND:
            case OTCommand::SET_OIL_PCT:
            case OTCommand::SET_THROTTLE_PCT:
            case OTCommand::FUEL_PRIME:
            case OTCommand::OIL_PRIME:
            case OTCommand::IGN_TEST:
            case OTCommand::IGN2_TEST:
            case OTCommand::START_TEST:
            case OTCommand::FUEL_SOL_TEST:
            case OTCommand::IDLE_TEST:
            case OTCommand::EXTRA_COOLDOWN:
            case OTCommand::PULSED_STARTER_ASSIST_TEST:
            case OTCommand::AB_FIRE:
            case OTCommand::OIL_SCAV_TEST:
            case OTCommand::COOL_FAN_TEST:
            case OTCommand::AIRSTARTER_TEST:
            case OTCommand::BLEED_VALVE_TEST:
            case OTCommand::GLOW_TEST:
            case OTCommand::FUEL_PUMP2_TEST:
            case OTCommand::AB_SOL_TEST:
            case OTCommand::AB_PUMP_TEST:
            case OTCommand::STARTER_EN_TEST:
            case OTCommand::PROP_PITCH_TEST:
            case OTCommand::REGISTRY_OUTPUT_TEST:
                return true;
            default:
                return false;
        }
    };
    if (mayEnergizeOutput(pkt.cmd) &&
        (!Config::profileMatch || ed.configLocked || ed.configStorageFault)) {
        strncpy(ed.lastEvent, "Output blocked: repair configuration first", sizeof(ed.lastEvent) - 1);
        Serial.println("[OT] Output command blocked: configuration is not trusted");
        return;
    }

    if (WebServer::otaInProgress() &&
        pkt.cmd != OTCommand::STOP && pkt.cmd != OTCommand::AB_STOP) {
        if (pkt.cmd == OTCommand::START) {
            strncpy(ed.lastEvent, "START blocked: maintenance upload in progress", sizeof(ed.lastEvent) - 1);
        }
        Serial.println("[OT] Command blocked: maintenance upload in progress");
        return;
    }

    // Web START is already preflight-rejected while an apply-reboot is
    // scheduled, but the physical START button and cluster serial queue
    // commands directly — without this gate they could start the engine
    // seconds before ESP.restart() fires.
    if (WebServer::rebootPending() &&
        pkt.cmd != OTCommand::STOP && pkt.cmd != OTCommand::AB_STOP) {
        if (pkt.cmd == OTCommand::START) {
            strncpy(ed.lastEvent, "START blocked: rebooting to apply saved configuration", sizeof(ed.lastEvent) - 1);
        }
        Serial.println("[OT] Command blocked: reboot pending to apply configuration");
        return;
    }

    switch (pkt.cmd) {
        case OTCommand::START:
            if (ed.mode == SysMode::FAULT) {
                // faultDescription still carries the boot-time reason
                strncpy(ed.lastEvent, "START blocked: ECU is in FAULT state", sizeof(ed.lastEvent) - 1);
                Serial.println("[OT] START blocked: FAULT state - fix config/profile and reboot");
                break;
            }
            if (ed.mode == SysMode::STANDBY && Config::profileMatch && !ed.configLocked) {
                if (HardwareConfig::startPin >= 0 && !ed.startReleasedSinceBoot) {
                    strncpy(ed.lastEvent, "START blocked: release START after boot", sizeof(ed.lastEvent) - 1);
                    break;
                }
                if (ed.recoveryLockout && !ed.skipSafetyChecks) {
                    strncpy(ed.lastEvent, "START blocked: abnormal-reset recovery", sizeof(ed.lastEvent) - 1);
                    break;
                }
                if ((!ed.hardwareReady || !ed.watchdogReady) && !ed.skipSafetyChecks) {
                    snprintf(ed.lastEvent, sizeof(ed.lastEvent), "START blocked: hardware readiness fault");
                    snprintf(ed.faultDescription, sizeof(ed.faultDescription), "Cannot start: %s%s",
                             !ed.watchdogReady ? "control watchdog is not ready" : ed.hardwareFault,
                             ". Enable the explicit safety-check override only for controlled diagnostics.");
                    break;
                }
                if (!ed.skipSafetyChecks && !ed.benchMode) {
                    unsigned long sn = millis();
                    if (!FeedbackRequirements::allRequiredStartFeedbackHealthy(ed, sn)) {
                        strncpy(ed.lastEvent, "START blocked: critical feedback not fresh", sizeof(ed.lastEvent) - 1);
                        strncpy(ed.faultDescription,
                                "Cannot start: feedback used by configured control, safety, or startup logic is unhealthy or stale. Check wiring and calibration.",
                                sizeof(ed.faultDescription) - 1);
                        break;
                    }
                    // This is a pre-start interlock, not a STARTUP running
                    // limit. Once fuel and ignition are active, the separate
                    // startup EGT hard limit in SafetyMonitor takes over.
                    if (HardwareConfig::safetyHotStart
                        && Config::preStartEgtLimitC > 0.0f
                        && Config::primaryEgtHealthy(ed)
                        && Config::primaryEgtC(ed) > Config::preStartEgtLimitC) {
                        snprintf(ed.lastEvent, sizeof(ed.lastEvent),
                                 "START blocked: selected EGT above pre-start limit");
                        snprintf(ed.faultDescription, sizeof(ed.faultDescription),
                                "Hot-start prevention: selected engine temperature is %.0f C, above the %.0f C pre-start limit. "
                                 "Wait for the turbine section to cool before trying again.",
                                 (double)Config::primaryEgtC(ed), (double)Config::preStartEgtLimitC);
                        Serial.println("[OT] START blocked: pre-start EGT too high");
                        break;
                    }
                }
                if (ed.stopSwitchActive) {
                    snprintf(ed.lastEvent, sizeof(ed.lastEvent), "START blocked: stop switch active");
                    snprintf(ed.faultDescription, sizeof(ed.faultDescription),
                             "Cannot start: STOP switch is active. Release STOP before pressing START.");
                    Serial.println("[OT] START blocked: stop switch active");
                    break;
                }
                // Extra cooldown owns the configured CooldownSpin actuators. Starting now
                // would race its cancel path: checkExtraCooldown() zeroes
                // actuator demands AFTER the first startup block's
                // onEnter() ran — on builds without an oil pressure sensor,
                // OilPrime's fixed pump duty is wiped and the prime runs to
                // "Complete" having delivered no oil.
                if (ed.extraCooldownActive) {
                    snprintf(ed.lastEvent, sizeof(ed.lastEvent), "START blocked: extra cooldown active");
                    snprintf(ed.faultDescription, sizeof(ed.faultDescription),
                             "Cannot start: Extra Cooldown is running. Stop it on the Tools page "
                             "or wait for it to finish before starting the engine.");
                    Serial.println("[OT] START blocked: extra cooldown active");
                    break;
                }
                if (anyToolTimerActive()) {
                    snprintf(ed.lastEvent, sizeof(ed.lastEvent), "START blocked: actuator tool active");
                    snprintf(ed.faultDescription, sizeof(ed.faultDescription),
                             "Cannot start: an actuator test or prime tool is still active. "
                             "Wait for the Tools page action to finish before starting.");
                    Serial.println("[OT] START blocked: actuator tool active");
                    break;
                }
                // Check inhibit_start DI channels
                {
                    auto& hwi = HardwareConfig::instance();
                    bool inhibited = false;
                    for (int _i = 0; _i < HardwareConfig::MAX_DI; _i++) {
                        if (hwi.diCh[_i].pin >= 0
                            && strcmp(hwi.diCh[_i].role, "inhibit_start") == 0
                            && ed.diState[_i])
                        {
                            const char* label = hwi.diCh[_i].label[0] ? hwi.diCh[_i].label : "inhibit_start";
                            snprintf(ed.lastEvent, sizeof(ed.lastEvent), "START blocked: inhibit input active");
                            snprintf(ed.faultDescription, sizeof(ed.faultDescription),
                                     "Cannot start: inhibit input is active on DI channel %d (%s). "
                                     "Release that switch or fix the input wiring before pressing START.",
                                     _i + 1, label);
                            Serial.printf("[OT] START inhibited by DI ch%d (%s)\n", _i, label);
                            inhibited = true;
                            break;
                        }
                    }
                    for (uint8_t _i = 0; !inhibited && _i < hwi.channelRegistry.inputCount; ++_i) {
                        const auto& channel = hwi.channelRegistry.inputs[_i];
                        const bool inhibitRole = !strcmp(channel.role, "inhibit_start") ||
                                                 !strcmp(channel.purpose, "inhibit_start");
                        const bool safetyRole = inhibitRole || !strcmp(channel.role, "estop") ||
                            !strcmp(channel.purpose, "estop") || !strcmp(channel.role, "fault") ||
                            !strcmp(channel.purpose, "fault") ||
                            ((hwi.safetyLowOil) && (!strcmp(channel.role, "low_oil_switch") ||
                                                   !strcmp(channel.purpose, "low_oil_switch"))) ||
                            ((hwi.safetyOilZero) && (!strcmp(channel.role, "oil_zero_switch") ||
                                                    !strcmp(channel.purpose, "oil_zero_switch")));
                        const bool unavailable = safetyRole && !ed.registryInputHealthy[_i];
                        const bool active = ed.registryInputHealthy[_i] &&
                                            ed.registryInputValue[_i] >= 0.5f;
                        if (unavailable || (safetyRole && active)) {
                            snprintf(ed.lastEvent, sizeof(ed.lastEvent),
                                     "START blocked: registry interlock");
                            snprintf(ed.faultDescription, sizeof(ed.faultDescription),
                                     unavailable ? "Cannot start: safety input %s is disconnected or stale." :
                                                   "Cannot start: safety input %s is active.",
                                     channel.name[0] ? channel.name : channel.id);
                            inhibited = true;
                        }
                    }
                if (inhibited) break;
                }
                if (PcbProfileManager::active()) {
                    const auto* catalog = PcbProfileManager::catalog();
                    const PcbProfileManager::Device* missing = nullptr;
                    if (catalog) {
                        for (uint8_t i = 0; i < catalog->deviceCount; ++i) {
                            const auto& device = catalog->devices[i];
                            if (!device.expected) continue;
                            uint8_t driver = 255;
                            if (!strcmp(device.driver, "tca9554")) driver = ChannelRegistry::I2cDigital;
                            else if (!strcmp(device.driver, "tla2528")) driver = ChannelRegistry::I2cAnalog;
                            else if (!strcmp(device.driver, "nau7802")) driver = ChannelRegistry::I2cLoadCell;
                            else continue;
                            if (!I2CDeviceManager::assignmentAvailable(driver, device.address)) {
                                missing = &device;
                                break;
                            }
                        }
                    }
                    if (missing) {
                        strncpy(ed.lastEvent, "START blocked: fitted PCB device missing",
                                sizeof(ed.lastEvent) - 1);
                        snprintf(ed.faultDescription, sizeof(ed.faultDescription),
                                 "Cannot start: fitted PCB device %s (%s at I2C 0x%02X) is not responding. Check PCB power, wiring, and the shared bus.",
                                 missing->id, missing->driver, missing->address);
                        break;
                    }
                }
                if (const auto* channel = Hardware::unavailableEngineI2cOutput()) {
                    strncpy(ed.lastEvent, "START blocked: I2C output unavailable",
                            sizeof(ed.lastEvent) - 1);
                    snprintf(ed.faultDescription, sizeof(ed.faultDescription),
                             "Cannot start: I2C output %s is disconnected. Its physical state cannot be guaranteed.",
                             channel->name[0] ? channel->name : channel->id);
                    break;
                }
                // Never allow a START to proceed with an invalid imported
                // registry. POST validation rejects this too, but this guard
                // protects restored/corrupt files and stale in-memory state.
                if (!HardwareConfig::channelRegistry.validate()) {
                    strncpy(ed.lastEvent, "START blocked: invalid channel registry", sizeof(ed.lastEvent) - 1);
                    strncpy(ed.faultDescription,
                            "Cannot start: hardware channel inventory has invalid IDs, pins, bindings, or safe demands. Fix it on the Hardware page.",
                            sizeof(ed.faultDescription) - 1);
                    ed.lastEvent[sizeof(ed.lastEvent) - 1] = '\0';
                    ed.faultDescription[sizeof(ed.faultDescription) - 1] = '\0';
                    Serial.println("[OT] START blocked: invalid channel registry");
                    break;
                }
                if (const char* featureReject = HardwareCapabilities::enabledFeatureRejectReason()) {
                    strncpy(ed.lastEvent, "START blocked: missing hardware dependency", sizeof(ed.lastEvent) - 1);
                    snprintf(ed.faultDescription, sizeof(ed.faultDescription),
                             "Cannot start: %s. Fix the Hardware page inventory or disable that feature.",
                             featureReject);
                    ed.lastEvent[sizeof(ed.lastEvent) - 1] = '\0';
                    ed.faultDescription[sizeof(ed.faultDescription) - 1] = '\0';
                    Serial.printf("[OT] START blocked: %s\n", featureReject);
                    break;
                }
                // Block structural sequence errors in every mode. Bench mode can
                // bypass missing hardware for dry testing, but it must not hide
                // imported/unknown block names that buildSequences() skipped.
                if (ed.seqHasStructuralErrors || (ed.seqHasErrors && !ed.benchMode)) {
                    if (ed.seqHasStructuralErrors) {
                        Serial.println("[OT] START blocked: sequence contains unknown blocks");
                        strncpy(ed.faultDescription,
                                "Cannot start: sequence contains unknown or unavailable block names. "
                                "Open the Sequence page, fix the red errors, and save again.",
                                sizeof(ed.faultDescription) - 1);
                    } else {
                        Serial.println("[OT] START blocked: sequence has hardware errors - enable bench mode to override");
                        strncpy(ed.faultDescription,
                                "Cannot start: sequence requires hardware that is not configured. "
                                "Check Sequence page for details, or enable Bench Mode to override.",
                                sizeof(ed.faultDescription) - 1);
                    }
                    ed.faultDescription[sizeof(ed.faultDescription) - 1] = '\0';
                    break;
                }
                // This is the final transition point. Claim it atomically
                // against Core 0 configuration replacement, then publish the
                // non-STANDBY mode before releasing the gate.
                if (!ConfigApplyGate::tryBeginStartTransition()) {
                    strncpy(ed.lastEvent, "START blocked: configuration update in progress", sizeof(ed.lastEvent) - 1);
                    break;
                }
                if (ed.mode != SysMode::STANDBY) {
                    ConfigApplyGate::release();
                    break;
                }
                ed.mode = SysMode::STARTUP;
                ConfigApplyGate::release();
                ResetRecovery::markActive();
                ed.faultShutdownActive = false;
                _buzzerPattern = 3; _buzzerStep = 0;  // double chirp: sequence starting
                ed.faultDescription[0] = '\0';  // clear previous fault/abort description
                strncpy(ed.lastEvent, "Start sequence initiated", sizeof(ed.lastEvent) - 1);
                Hardware::applyConfig();  // re-apply config before each start
                if (!ed.benchMode && !ed.devMode) {
                    Config::incStartAttemptCount(); // guarded RMW
                    Config::requestRuntimeStatsSave();
                }
                FlightRecorder::logStartAttempt();
                SessionLogger::startSession();  // request a new session CSV on the web task
                g_sequencer.startSequence(_startupBlocks, _startupCount,
                                          HardwareConfig::startupEnterActions,
                                          HardwareConfig::startupExitActions);
                Serial.println("[OT] START commanded");
            }
            break;

        case OTCommand::STOP:
            if (ed.mode == SysMode::RUNNING || ed.mode == SysMode::STARTUP) {
                enterShutdown();
            } else if (ed.mode == SysMode::SHUTDOWN) {
                // Already shutting down — do nothing
            }
            break;

        case OTCommand::TOGGLE_DYNAMIC_IDLE:
            if (!HardwareConfig::hasDynamicIdle)
                ed.dynamicIdleEnabled = false;   // feature absent — force off
            else if (standbyLike || ed.mode == SysMode::RUNNING)
                ed.dynamicIdleEnabled = !ed.dynamicIdleEnabled;
            // STARTUP/SHUTDOWN: ignore mid-transition (don't disturb the
            // current setting), matching the other toggle commands.
            break;

        case OTCommand::TOGGLE_LIMP_MODE:
            if (HardwareConfig::hasThrottle &&
                (standbyLike || ed.mode == SysMode::RUNNING)) {
                ed.limpMode = !ed.limpMode;
            }
            break;

        case OTCommand::TOGGLE_SAFETY_CHECKS:
            if (ed.devMode && ed.benchMode && standbyLike)
                ed.skipSafetyChecks = !ed.skipSafetyChecks;
            break;

        case OTCommand::TOGGLE_DEV_MODE:
            // Intentional: beta builds keep a standby-only operator-gated dev path
            // for bench validation without reflashing. Bench/safety bypass controls
            // remain unavailable until this is explicitly enabled in STANDBY.
            if (standbyLike) {
                ed.devMode = !ed.devMode;
                if (!ed.devMode) {
                    ed.skipSafetyChecks = false;
                    ed.benchMode        = false;
                }
                Serial.printf("[OT] Dev mode %s\n", ed.devMode ? "ENABLED" : "disabled");
            }
            break;

        case OTCommand::TOGGLE_BENCH_MODE:
            // Bench mode only active in dev mode and only changeable in STANDBY
            if (ed.devMode && standbyLike) {
                ed.benchMode = !ed.benchMode;
                if (!ed.benchMode) ed.skipSafetyChecks = false;
                Serial.printf("[OT] Bench mode %s\n", ed.benchMode ? "ENABLED - safety/sensor waits bypassed" : "disabled");
            }
            break;

        case OTCommand::SET_OIL_DEMAND:
            if (standbyLike) {
                ed.oilTargetBar = constrain(pkt.fParam, 0.0f, 20.0f);  // bar; 20 is well above any real turbine oil pressure
            }
            break;

        case OTCommand::SET_OIL_PCT:
            // Manual oil override is allowed only in STANDBY.
            if (standbyLike) {
                // fParam gives calibration tools fractional-percent control;
                // iParam remains as a fallback for older clients.
                ed.oilPumpPct = constrain((pkt.fParam != 0.0f) ? pkt.fParam : (float)pkt.iParam,
                                          0.0f, 100.0f);
                _manualOilPct = ed.oilPumpPct;  // restored when standby oil feed disengages
            }
            break;

        case OTCommand::SET_THROTTLE_PCT:
            // Fuel-pump min-spin calibration: drive the throttle/fuel-pump ESC to a
            // commanded % in STANDBY so the user can ramp it and find where the pump
            // starts to spin. Reuses the idle-test timer, so it auto-returns to 0 if
            // the UI stops refreshing it.
            if (HardwareConfig::hasThrottle && standbyLike && !anyToolTimerActive()) {
                ed.throttleDemand = constrain((pkt.fParam != 0.0f) ? pkt.fParam : (float)pkt.iParam,
                                               0.0f, 100.0f) / 100.0f;
                _idleTestUntilMs  = millis() + Config::toolIdleTestMs;
            }
            break;

        case OTCommand::FUEL_PRIME:
            if (HardwareConfig::hasFuelSol && standbyLike && !anyToolTimerActive()) {
                ed.fuelSolOpen    = true;
                _fuelPrimeUntilMs = millis() + Config::toolFuelPrimeMs;
            }
            break;

        case OTCommand::OIL_PRIME:
            if (HardwareConfig::hasOilPump && standbyLike && !anyToolTimerActive()) {
                ed.oilPumpPct  = 100.0f;
                _oilPrimeUntilMs = millis() + Config::toolOilPrimeMs;
            }
            break;

        case OTCommand::IGN_TEST:
            if (HardwareConfig::hasIgniter && standbyLike && !anyToolTimerActive()) {
                ed.igniterOn     = true;
                _ignTestUntilMs  = millis() + Config::toolIgnTestMs;
            }
            break;

        case OTCommand::IGN2_TEST:
            if (HardwareConfig::hasIgniter2 && standbyLike && !anyToolTimerActive()) {
                ed.igniter2On    = true;
                _ign2TestUntilMs = millis() + Config::toolIgn2TestMs;
            }
            break;

        case OTCommand::START_TEST:
            if (HardwareConfig::hasStarter && standbyLike && !anyToolTimerActive()) {
                ed.starterEnabled  = true;
                ed.starterDemand   = constrain(Config::toolStartTestPct / 100.0f, 0.0f, 1.0f);
                // If a starter-enable output is configured, the starter motor
                // is intentionally gated until starterEnDelayMs has elapsed.
                // Keep the test active long enough that "starter test" always
                // produces a visible starter output after that hardware delay.
                _startTestUntilMs  = millis() + Config::toolStartTestMs +
                                     (HardwareConfig::hasStarterEn
                                          ? (unsigned long)HardwareConfig::starterEnDelayMs
                                          : 0UL);
            }
            break;

        case OTCommand::FUEL_SOL_TEST:
            // Brief solenoid pulse — audible click only, reuses fuel prime timer
            if (HardwareConfig::hasFuelSol && standbyLike && !anyToolTimerActive()) {
                ed.fuelSolOpen    = true;
                _fuelPrimeUntilMs = millis() + Config::toolFuelSolTestMs;
            }
            break;

        case OTCommand::IDLE_TEST:
            // Move throttle/fuel output to the calibrated min-spin position for
            // the configured test duration.
            if (HardwareConfig::hasThrottle && standbyLike && !anyToolTimerActive()) {
                ed.throttleDemand = Config::fuelPumpMinPct / 100.0f;
                _idleTestUntilMs  = millis() + Config::toolIdleTestMs;
            }
            break;

        case OTCommand::EXTRA_COOLDOWN:
            {
            const bool ecUseStarter = HardwareConfig::hasStarter && Config::cooldownUseStarter;
            const bool ecUseOil = HardwareConfig::hasOilPump && Config::cooldownUseOilPump;
            const bool ecUseScavenge = HardwareConfig::hasOilScavengePump && Config::cooldownUseScavengePump;
            if ((ecUseStarter || ecUseOil || ecUseScavenge) && standbyLike) {
                if (!ed.extraCooldownActive && pkt.iParam > 0) {
                    // iParam = duration in seconds from UI slider (60–300 s)
                    int seconds = constrain(pkt.iParam, 60, 300);
                    unsigned long durationMs  = (unsigned long)seconds * 1000UL;
                    ed.extraCooldownActive    = true;
                    ed.oilFailsafeActive      = false;  // take manual control
                    ed.starterEnabled         = ecUseStarter;
                    ed.starterDemand          = ecUseStarter ? (Config::cooldownStarterPct / 100.0f) : 0.0f;
                    ed.oilPumpPct             = ecUseOil ? Config::cooldownOilPct : 0.0f;
                    ed.oilScavengeDemand      = ecUseScavenge ? 1.0f : 0.0f;
                    ed.oilScavengeOn          = ecUseScavenge;
                    ed.extraCooldownUntilMs     = millis() + durationMs;
                    Serial.printf("[OT] Extra cooldown started (%lu s)\n",
                        (unsigned long)seconds);
                } else {
                    // Cancel — either toggle-off or iParam == 0 (stop button)
                    ed.extraCooldownActive = false;
                    ed.oilFailsafeActive   = false;
                    ed.starterDemand       = 0;
                    ed.starterEnabled      = false;
                    ed.oilPumpPct          = 0;
                    ed.oilScavengeDemand   = 0.0f;
                    ed.oilScavengeOn       = false;
                    ed.extraCooldownUntilMs  = 0;
                    Serial.println("[OT] Extra cooldown cancelled");
                }
            }
            }
            break;

        case OTCommand::PULSED_STARTER_ASSIST_TEST:
            if (Config::starterAssistEnabled && HardwareConfig::hasStarter &&
                HardwareConfig::starterType != 2 && HardwareConfig::hasN1Rpm &&
                standbyLike && !anyToolTimerActive()) {
                ed.starterEnabled = true;
                ed.starterDemand = constrain(Config::starterAssistPwmPct / 100.0f, 0.0f, 1.0f);
                _startTestUntilMs = millis() + Config::starterAssistOnMs +
                    (HardwareConfig::hasStarterEn ? (unsigned long)HardwareConfig::starterEnDelayMs : 0UL);
            }
            break;

        case OTCommand::CLEAR_LOG:
            if (standbyLike) {
                FlightRecorder::requestClear();
            } else {
                Serial.println("[OT] CLEAR_LOG ignored: engine not in STANDBY");
            }
            break;

        case OTCommand::AB_FIRE:
            // Manual AB ignition — only allowed in RUNNING and if AB is off/fault
            if (HardwareConfig::hasAfterburner
                && HardwareConfig::abTriggerSource == 0
                && (HardwareConfig::hasAbSol || HardwareConfig::hasAbPump)
                && ed.mode == SysMode::RUNNING
                && (ed.abMode == ABMode::Off || ed.abMode == ABMode::Fault))
            {
                Serial.println("[AB] Manual fire command received");
                enterABIgniting();
            }
            break;

        case OTCommand::AB_STOP:
            // Manual AB shutdown
            if (HardwareConfig::hasAfterburner
                && ed.abMode != ABMode::Off
                && ed.abMode != ABMode::ShuttingDown)
            {
                Serial.println("[AB] Manual stop command received");
                enterABShutdown();
            }
            break;

        case OTCommand::APPLY_CONFIG:
            // Re-apply block params from config — only safe in STANDBY.
            // Controller static values (gains, limits) are updated by Config::fromJson
            // in the PATCH handler immediately; applyConfig() copies them into block
            // instances and reinitialises actuator mappings.
            if (standbyLike) {
                Hardware::applyConfig();
                // Readiness issues include setting-dependent checks (for
                // example a newly configured hard N2 safety limit). Rebuild
                // them after every live settings apply so a valid correction
                // cannot remain blocked by the pre-save cache until reboot.
                validateSequences();
                // Cluster serial can be enabled live in Config, but begin()
                // only ran at boot (and early-returned if disabled then) —
                // without this the setting looks saved while the UART stays
                // dead until reboot.
                ClusterSerial::beginIfNeeded();
                Serial.println("[OT] APPLY_CONFIG: block params reloaded from config");
            } else {
                // In any other mode the command is deferred — config values are live
                // in memory but hardware block instances won't be updated until the
                // next STANDBY transition.  Log so this isn't a silent surprise.
                Serial.println("[OT] APPLY_CONFIG: deferred - not in STANDBY, hardware blocks update on next STANDBY");
            }
            break;

        // ── Actuator tests (STANDBY only, auto-expire via checkToolTimers) ────
        case OTCommand::OIL_SCAV_TEST:
            if (HardwareConfig::hasOilScavengePump && standbyLike && !anyToolTimerActive()) {
                ed.oilScavengeDemand = 1.0f; ed.oilScavengeOn = true;
                _oilScavTestUntilMs = millis() + Config::toolOilScavTestMs;
            }
            break;

        case OTCommand::COOL_FAN_TEST:
            if (HardwareConfig::hasCoolFan && standbyLike && !anyToolTimerActive()) {
                ed.coolFanDemand = 1.0f; ed.coolFanOn = true;
                _coolFanTestUntilMs  = millis() + Config::toolCoolFanTestMs;
            }
            break;

        case OTCommand::AIRSTARTER_TEST:
            if (HardwareConfig::hasAirstarterSol && standbyLike && !anyToolTimerActive()) {
                ed.airstarterOpen       = true;
                _airstarterTestUntilMs  = millis() + Config::toolAirstarterTestMs;
            }
            break;

        case OTCommand::BLEED_VALVE_TEST:
            if (HardwareConfig::hasBleedValve && standbyLike && !anyToolTimerActive()) {
                ed.bleedValveDemand = 1.0f; ed.bleedValveOpen = true;
                _bleedValveTestUntilMs  = millis() + Config::toolBleedValveTestMs;
            }
            break;

        case OTCommand::GLOW_TEST:
            if (HardwareConfig::hasGlowPlug && standbyLike && !anyToolTimerActive()) {
                ed.glowPlugDemand = constrain(Config::toolGlowTestPct / 100.0f, 0.0f, 1.0f);
                _glowTestUntilMs  = millis() + Config::toolGlowTestMs;
            }
            break;

        case OTCommand::FUEL_PUMP2_TEST:
            if (HardwareConfig::hasFuelPump2 && standbyLike && !anyToolTimerActive()) {
                ed.fuelPump2Demand     = constrain(Config::toolFuelPump2TestPct / 100.0f, 0.0f, 1.0f);
                _fuelPump2TestUntilMs  = millis() + Config::toolFuelPump2TestMs;
            }
            break;

        case OTCommand::AB_SOL_TEST:
            if (HardwareConfig::hasAfterburner && HardwareConfig::hasAbSol &&
                standbyLike && !anyToolTimerActive()) {
                ed.abSolOpen      = true;
                _abSolTestUntilMs = millis() + Config::toolAbSolTestMs;
            }
            break;

        case OTCommand::AB_PUMP_TEST:
            if (HardwareConfig::hasAfterburner && HardwareConfig::hasAbPump &&
                standbyLike && !anyToolTimerActive()) {
                ed.abPumpDemand   = constrain(Config::toolAbPumpTestPct / 100.0f, 0.0f, 1.0f);
                _abPumpTestUntilMs  = millis() + Config::toolAbPumpTestMs;
            }
            break;

        case OTCommand::STARTER_EN_TEST:
            if (HardwareConfig::hasStarterEn && standbyLike && !anyToolTimerActive()) {
                ed.starterEnabled      = true;
                _starterEnTestUntilMs  = millis() + Config::toolStarterEnTestMs;
            }
            break;

        case OTCommand::PROP_PITCH_TEST:
            // Move prop pitch to mid-travel (0.5) for 3 s — verify servo range
            if (HardwareConfig::hasPropPitch && standbyLike && !anyToolTimerActive()) {
                ed.propPitchDemand     = constrain(Config::toolPropPitchTestPct / 100.0f, 0.0f, 1.0f);
                _propPitchTestUntilMs  = millis() + Config::toolPropPitchTestMs;
            }
            break;

        case OTCommand::REGISTRY_OUTPUT_TEST:
            if (standbyLike && !anyToolTimerActive()) {
                uint8_t idx = (uint8_t)constrain(pkt.iParam, 0, (int)ChannelRegistry::MAX_OUTPUT_CHANNELS - 1);
                if (idx < HardwareConfig::channelRegistry.outputCount &&
                    !HardwareConfig::channelRegistry.ownsCoreOutput(HardwareConfig::channelRegistry.outputs[idx]) &&
                    !HardwareConfig::channelRegistry.boundToCoreOutput(HardwareConfig::channelRegistry.outputs[idx])) {
                    ed.registryOutputDemand[idx] = constrain(pkt.fParam, 0.0f, 1.0f);
                    _registryOutputTestIndex = idx;
                    _registryOutputTestUntilMs = millis() + 3000UL;
                }
            }
            break;

        case OTCommand::RESET_PEAKS:
            ed.maxN1           = 0;
            ed.maxN2           = 0;
            ed.maxTot          = 0;
            ed.maxTit          = 0;
            ed.maxP1           = 0;
            ed.maxP2           = 0;
            ed.maxOilTemp      = 0;
            ed.maxBattVoltage  = 0;
            ed.maxFuelPressure = 0;
            ed.minOilPressure  = -1.0f;
            break;

        default:
            break;
    }
}

// ── Stop / Start switch polling ───────────────────────────────

// Dedicated START/STOP lines get a short fixed debounce (the general DI
// channels have a configurable one; these did not, and switch bounce on a
// long bench harness caused repeated START attempts / shutdown re-entry).
// 30 ms rejects contact bounce while adding no operator-perceptible latency
// to the STOP path.
static constexpr unsigned long SWITCH_DEBOUNCE_MS = 30;

static void checkStopSwitch() {
    auto& ed = EngineData::instance();
    auto& hc  = HardwareConfig::instance();
    if (hc.stopPin < 0) {
        ed.stopSwitchActive = false;
        return;
    }
    bool raw = (digitalRead(hc.stopPin) == (hc.stopActiveH ? HIGH : LOW));
    static bool          _rawLast    = false;
    static bool          _debounced  = false;
    static unsigned long _lastChange = 0;
    static bool          _wasDebounced = false;
    unsigned long now = millis();
    if (raw != _rawLast) { _lastChange = now; _rawLast = raw; }
    if (now - _lastChange >= SWITCH_DEBOUNCE_MS) _debounced = raw;
    ed.stopSwitchActive = _debounced;
    if (_debounced && !_wasDebounced && ed.recoveryLockout && ed.startReleasedSinceBoot) {
        ed.recoveryLockout = false;
        ed.faultDescription[0] = '\0';
        strncpy(ed.lastEvent, "Recovery lockout acknowledged", sizeof(ed.lastEvent) - 1);
    }
    _wasDebounced = _debounced;
    if (_debounced) {
        if (ed.mode == SysMode::RUNNING || ed.mode == SysMode::STARTUP) {
            enterShutdown();
            strncpy(ed.lastEvent, "Stop switch activated", sizeof(ed.lastEvent) - 1);
        }
    }
}

static void checkStartSwitch() {
    // Edge-detect: normalise to active-low convention (cur==LOW means "pressed")
    // so all downstream logic is unchanged regardless of startActiveH.
    auto& hca = HardwareConfig::instance();
    if (hca.startPin < 0) {
        auto& ed = EngineData::instance();
        ed.startSwitchActive = false;
        ed.startReleasedSinceBoot = true;
        return;
    }
    int  rawLevel = digitalRead(hca.startPin);
    bool rawPressed = hca.startActiveH ? (rawLevel == HIGH) : (rawLevel == LOW);
    // Debounce the raw level first — the edge detect and the manual-relight
    // hold logic below both act on the debounced state.
    static bool          _rawLast    = false;
    static bool          _pressed    = false;
    static unsigned long _lastChange = 0;
    static bool          _initialized = false;
    unsigned long nowSw = millis();
    static int _last = HIGH;
    if (!_initialized) {
        _rawLast = rawPressed;
        _pressed = rawPressed;
        _lastChange = nowSw;
        _last = rawPressed ? LOW : HIGH;
        _initialized = true;
        auto& ed0 = EngineData::instance();
        ed0.startSwitchActive = rawPressed;
        ed0.startReleasedSinceBoot = !rawPressed;
        return;
    }
    if (rawPressed != _rawLast) { _lastChange = nowSw; _rawLast = rawPressed; }
    if (nowSw - _lastChange >= SWITCH_DEBOUNCE_MS) _pressed = rawPressed;
    const bool pressed = _pressed;
    // Represent as a synthetic LOW/HIGH for the _last comparison below
    int cur = pressed ? LOW : HIGH;
    auto& ed = EngineData::instance();
    ed.startSwitchActive = pressed;
    if (!pressed) ed.startReleasedSinceBoot = true;

    if (_last == HIGH && cur == LOW) {
        // Only send START command in STANDBY — in RUNNING the hold logic below handles it.
        // FAULT: push anyway so handleCommand reports the block reason on the dashboard.
        if (ed.mode == SysMode::STANDBY || ed.mode == SysMode::FAULT) {
            CommandQueue::push({ OTCommand::START });
        }
    }

    // Manual relight: operator holds START while RUNNING → force igniter on
    // Controlled by Config::igniterOnStart (configurable in Misc section).
    // The cleanup path is gated only on mode == RUNNING (igniterOnStart is
    // checked inside) so that clearing igniterOnStart live while START is held
    // still releases the igniter instead of latching it on until the next stop.
    if (ed.mode == SysMode::RUNNING) {
        if (Config::igniterOnStart && cur == LOW) {
            if (!ed.manualRelightActive) {
                const uint8_t target = (uint8_t)Config::manualRelightIgnitionTarget;
                if (ignitionTargetAvailable(target)) {
                    ed.manualRelightActive = true;
                    commandIgnitionTarget(target, true);
                    Serial.printf("[OT] Manual relight - START held (%s)\n", ignitionTargetName(target));
                }
            }
        } else if (ed.manualRelightActive) {
            // START released, or manual relight disabled live → cut the igniter
            ed.manualRelightActive = false;
            commandIgnitionTarget((uint8_t)Config::manualRelightIgnitionTarget, false);
            Serial.println("[OT] Manual relight - igniter cut");
        }
    } else {
        // Not RUNNING (fault, shutdown) — cut igniter immediately if it was lit
        // by manual relight.  ImmediateCut also clears it, but doing it here
        // avoids a one-frame gap.
        if (ed.manualRelightActive) {
            commandIgnitionTarget((uint8_t)Config::manualRelightIgnitionTarget, false);
        }
        ed.manualRelightActive = false;
    }

    _last = cur;
}

// ── Web server task (Core 0) ──────────────────────────────────

static void webTask(void*) {
    for (;;) {
        WebServer::tick();
        // Give web more CPU in STANDBY; engine is priority when active.
        // FAULT is standby-like — the web UI is the repair path there.
        SysMode m = EngineData::instance().mode;
        bool engineActive = (m != SysMode::STANDBY && m != SysMode::FAULT);
        vTaskDelay(pdMS_TO_TICKS(engineActive ? 20 : 5));
    }
}

// ── Arduino entry points ──────────────────────────────────────

void setup() {
    // Classify the immutable flash-time PCB profile before touching any
    // compile-time generic pins. A valid profile parks all profile-owned
    // native outputs immediately; a damaged/wrong-target profile locks START
    // without driving either profile or generic pins.
    PcbProfileManager::begin();
    PlatformInit::begin(PcbProfileManager::state() == PcbProfileManager::State::Absent);

    // Load hardware topology FIRST (pins, feature flags, sequence order).
    // Must be called after LittleFS is mounted (PlatformInit::begin() does that).
    HardwareConfig::load();

    // Park the runtime-configured relay outputs inactive right away — the
    // config may remap them off the compile-time OT_* pins PlatformInit::begin()
    // already parked, leaving the real output floating until initActuators().
    Hardware::driveBootSafeStates();

    // Re-init stop/start GPIO with runtime pins from ecu_config.json.
    {
        auto& hcfg = HardwareConfig::instance();
        if (hcfg.stopPin >= 0)
            pinMode(hcfg.stopPin, hcfg.stopPullup ? INPUT_PULLUP : (hcfg.stopPulldown ? INPUT_PULLDOWN : INPUT));
        if (hcfg.startPin >= 0)
            pinMode(hcfg.startPin, hcfg.startPullup ? INPUT_PULLUP : (hcfg.startPulldown ? INPUT_PULLDOWN : INPUT));
    }

    Config::load();
    Config::loadRuntimeStats();
    buildSequences();
    // Runtime toggle state must match the fitted controller after configuration
    // dependencies have been normalized by HardwareConfig::load().
    EngineData::instance().dynamicIdleEnabled = HardwareConfig::hasDynamicIdle;
    // Enter FAULT (light lockout) on a profile-ID mismatch or a hardware-config
    // load/validation failure. START is inhibited with a clear reason, but the
    // web UI, config/hardware uploads, tools and dev mode all keep working so
    // the user can fix the problem — uploading a corrected config reboots into
    // STANDBY via the normal save-and-restart path.
    {
        auto& edf = EngineData::instance();
        if (!Config::profileMatch || edf.configLocked) {
            edf.mode = SysMode::FAULT;
            if (edf.faultDescription[0] == '\0') {
                strncpy(edf.faultDescription,
                        "Cannot start: the stored configuration failed to load or its "
                        "profile IDs do not match. Fix and re-save the config from the web UI.",
                        sizeof(edf.faultDescription) - 1);
                edf.faultDescription[sizeof(edf.faultDescription) - 1] = '\0';
            }
            snprintf(edf.lastEvent, sizeof(edf.lastEvent), "FAULT: %s",
                     !Config::profileMatch ? "config profile mismatch/load failure"
                                           : "hardware config invalid");
        }
    }
    if (EngineData::instance().mode == SysMode::FAULT) {
        Serial.println("[OT] FAULT: config/profile problem - START locked, web UI and tools stay available");
        // Web server still starts so user can see the error and fix config
    }

    // Cross-check: hardware and settings sections in ecu_config.json share one profile_id.
    // A divergence means the file has mixed engine sections and START is inhibited.
    if (HardwareConfig::profileId[0] != '\0'
        && Config::profileId[0] != '\0'
        && strcmp(HardwareConfig::profileId, Config::profileId) != 0)
    {
        Serial.printf("[OT] WARNING: hardware profile_id (%s) differs from settings profile_id (%s)"
                      " - update both sections to the same value\n",
                      HardwareConfig::profileId, Config::profileId);
    }

#ifdef OT_DEV_MODE
    EngineData::instance().devMode = true;
    Serial.println("[OT] DEV_MODE: enabled - config locks bypassed, NEVER ship this build");
#endif

    Hardware::applyConfig();

    FlightRecorder::begin();
    if (!SessionLogger::begin()) {
        Serial.println("[OT] ERROR: session logger queue allocation failed; CSV logging unavailable");
    }
    const bool commandQueueReady = CommandQueue::begin();
    if (!commandQueueReady) {
        Serial.println("[OT] FATAL: command queue allocation failed; controls unavailable");
    }

    // Bring the AP up before runtime sensor/peripheral init.  Some field
    // profiles can use aggressive GPIO/peripheral combinations; the repair UI
    // must still come up deterministically so the user can fix hardware config.
    Serial.println("[OT] Starting web server");
    const bool webServerReady = WebServer::begin();
    Serial.println(webServerReady ? "[OT] Web server ready"
                                  : "[OT] Web server unavailable - START will remain locked");

    Hardware::initSensors();
    Hardware::initActuators();
    if (!webServerReady) {
        auto& startupState = EngineData::instance();
        startupState.hardwareReady = false;
        strlcpy(startupState.hardwareFault,
                "Web service memory reservation failed; reboot or reflash before START",
                sizeof(startupState.hardwareFault));
    }
    if (!commandQueueReady) {
        auto& startupState = EngineData::instance();
        if (startupState.hardwareReady || startupState.hardwareFault[0] == '\0') {
            strlcpy(startupState.hardwareFault,
                    "Control command queue allocation failed",
                    sizeof(startupState.hardwareFault));
        }
        startupState.hardwareReady = false;
    }
    {
        bool hasConfiguredServo = false;
        for (uint8_t i = 0; i < HardwareConfig::channelRegistry.outputCount; ++i) {
            const auto& output = HardwareConfig::channelRegistry.outputs[i];
            if (output.installed && output.driver == ChannelRegistry::Servo) {
                hasConfiguredServo = true;
                break;
            }
        }
        const auto& startupState = EngineData::instance();
        PcbProfileManager::setServoOutputsEnabled(
            hasConfiguredServo && startupState.hardwareReady &&
            startupState.mode != SysMode::FAULT);
    }
    Hardware::initStatusLED();
    RCInput::begin();

    // ── DI pin mode + initial debounce state ──────────────────
    // Set pin mode for each configured DI channel and seed _diRawLast
    // from the actual current reading so the first loop() tick does not
    // produce a spurious rising-edge trigger on any channel that is
    // already active at power-up.
    {
        auto& hdi = HardwareConfig::instance();
        for (int i = 0; i < HardwareConfig::MAX_DI; i++) {
            if (hdi.diCh[i].pin < 0) continue;
            // Active-low channels use pullup; active-high use floating input.
            pinMode(hdi.diCh[i].pin,
                    hdi.diCh[i].activeH ? INPUT : INPUT_PULLUP);
            bool state = (digitalRead(hdi.diCh[i].pin) ==
                          (hdi.diCh[i].activeH ? HIGH : LOW));
            _diRawLast[i]    = state;
            _diLastChange[i] = millis();
            // Also pre-seed EngineData so the first poll sees no change
            EngineData::instance().diState[i] = state;
            if (state && strcmp(hdi.diCh[i].role, "ab_arm") == 0) {
                EngineData::instance().abArmSwitchOn = true;
            } else if (state && strcmp(hdi.diCh[i].role, "limp_mode") == 0) {
                EngineData::instance().limpMode = true;
            }
        }
    }

    g_sequencer.setCallbacks(sequenceComplete, enterAbortStandby, sequenceFaulted);
    g_abSequencer.setCallbacks(abSequenceDone, abSequenceAbort, abSequenceFault);
    g_safety.begin(enterShutdown, enterFaultShutdown);
    RulesEngine::begin(enterShutdown, [](const char* code) {
        g_safety.setExternalFault(code);
        enterFaultShutdown();
    });
    // Safety thresholds are applied via Hardware::applyConfig() above

    // Relight callback — fires on flameout if relightEnabled and conditions met.
    // Igniter stays ON continuously; checkRelight() turns it off when done.
    g_safety.setRelightCallback([]() {
        auto& ed = EngineData::instance();
        if (!_relightActive) {
            // First call for this flameout event — start continuous ignition.
            // SafetyMonitor owns the timeout; this callback just lights the igniter.
            ed.relightAttempts = ed.relightAttempts + 1;
            _relightActive     = true;
            _relightBeginMs    = millis();
            // -1 sentinel: baseline set on first healthy reading in relightConfirmed()
            _relightBeginEgt   = Config::primaryEgtHealthy(ed) ? Config::primaryEgtC(ed) : -1.0f;
            ed.clusterCode     = 2;   // ClCode::RelightActive
            FlightRecorder::logRelight(ed.relightAttempts);
            Serial.printf("[OT] Relight started - N1=%.0f RPM\n", (double)ed.n1Rpm);
        }
        // Keep igniter on — checkRelight() clears this when flame returns or N1 drops
        commandIgnitionTarget((uint8_t)Config::relightIgnitionTarget, true);
    });

    // Web maintenance tick on Core 0 — independent FreeRTOS task
    // Stack needs to hold char buf[5120] + ArduinoJson + call frames from webTask tick
    // Priority 8: high enough to time-share Core 0 with async_tcp (prio 10)
    // instead of being fully preempted during file serving. Keeps WS updates
    // regular even when the browser is fetching pages.
    if (xTaskCreatePinnedToCore(webTask, "web", 12288, nullptr, 8, nullptr, 0) != pdPASS) {
        Serial.println("[OT] ERROR: web task allocation failed; network controls and log draining unavailable");
    }

    FlightRecorder::logBoot();

    if (HardwareConfig::hasClusterSerial)
        ClusterSerial::begin();   // sends boot table + initial status; before watchdog (uses delay())

    if (HardwareConfig::hasMAVLink && HardwareConfig::mavlinkTxPin >= 0) {
        _mavSerial.setTxBufferSize(512);  // must precede begin(); buffers fault STATUSTEXT bursts
        _mavSerial.begin(HardwareConfig::mavlinkBaud, SERIAL_8N1,
                         -1, HardwareConfig::mavlinkTxPin);
        g_mavlink.begin(_mavSerial);
        Serial.printf("[OT] MAVLink TX on GPIO %d @ %d baud\n",
                      HardwareConfig::mavlinkTxPin, HardwareConfig::mavlinkBaud);
    }

    EngineData::instance().watchdogReady = Watchdog::begin();
    if (!EngineData::instance().watchdogReady)
        Serial.println("[OT] ERROR: control-loop watchdog initialization failed; START inhibited");

    Serial.println("[OT] Setup complete");
}

void loop() {
    const uint32_t loopStartUs = micros();
    static uint32_t lastLoopStartUs = 0;
    static uint32_t loopWindowStartMs = 0;
    static uint32_t loopWindowMaxUs = 0;
    static uint32_t loopWorstSensorsUs = 0;
    static uint32_t loopWorstSequencersUs = 0;
    static uint32_t loopWorstControllersUs = 0;
    static uint32_t loopWorstActuatorsUs = 0;
    static uint32_t loopWorstLoggingUs = 0;
    static uint32_t loopWorstLedUs = 0;
    static float loopExecAvgUs = 0.0f;
    if (!Watchdog::feed()) EngineData::instance().watchdogReady = false;

    // Core 0 has finished validating, persisting, and publishing a complete
    // settings document. Runtime-safe Config statics are already visible. A
    // full block/hardware copy is allowed only at the safe-output STANDBY/FAULT
    // boundary; Developer Mode may save while active, in which case the newest
    // copy remains queued.
    if (ConfigApplyGate::tryBeginCoreApply()) {
        const SysMode configMode = EngineData::instance().mode;
        if (configMode == SysMode::STANDBY || configMode == SysMode::FAULT) {
            applyConfigOnEcuCore("web update");
            _configApplyDeferred = false;
        } else {
            _configApplyDeferred = true;
            Serial.println("[OT] Config saved while active: block/hardware apply deferred until STANDBY");
        }
        ConfigApplyGate::release();
    }

    // Claim the same transaction gate before consuming a deferred update. This
    // prevents a simultaneous web write or START transition from observing a
    // partly copied configuration.
    const SysMode deferredMode = EngineData::instance().mode;
    if (_configApplyDeferred &&
        (deferredMode == SysMode::STANDBY || deferredMode == SysMode::FAULT) &&
        ConfigApplyGate::tryBeginDeferredCoreApply()) {
        applyConfigOnEcuCore("deferred update at STANDBY");
        _configApplyDeferred = false;
        ConfigApplyGate::release();
    }

    checkStopSwitch();
    checkStartSwitch();

    CommandQueue::drain(handleCommand);
    uint32_t afterCommandsUs = micros();

    Hardware::updateSensors();
    // One sample per second is enough for a useful last-run flame reference and
    // avoids spending control-loop time continuously accumulating statistics.
    static uint32_t lastFlameAverageMs = 0;
    auto& flameEd = EngineData::instance();
    if (flameEd.mode == SysMode::RUNNING && HardwareConfig::hasFlame &&
        millis() - lastFlameAverageMs >= 1000) {
        lastFlameAverageMs = millis();
        const uint32_t n = flameEd.lastRunFlameSamples;
        flameEd.lastRunFlameAvg = (flameEd.lastRunFlameAvg * n + flameEd.flameSensorRaw) / (n + 1);
        flameEd.lastRunFlameSamples = n + 1;
    }
    uint32_t afterSensorsUs = micros();

    // RC PWM input — updates rcIdle*/rcThrottle* and synthesises pot ADC values
    RCInput::tick();

    g_safety.check();

    g_sequencer.tick();
    g_abSequencer.tick();
    uint32_t afterSequencersUs = micros();

    Hardware::runControllers();

    checkToolTimers();
    checkExtraCooldown();
    checkRelight();
    checkABTrigger();
    checkStandbyOilFeed();
    checkGeneralDI();
    buzzerTick();
    checkCooldownSkip();

    // Rules may override ordinary demand targets; throttle still passes
    // through limp limits and slew/sensor safeguards before output.
    RulesEngine::evaluate();
    Hardware::applyThrottleProtection();
    uint32_t afterControllersUs = micros();

    Hardware::updateActuators();
    uint32_t afterActuatorsUs = micros();

    FlightRecorder::tick();
    SessionLogger::tick();
    uint32_t afterLoggingUs = micros();

    if (HardwareConfig::hasClusterSerial)
        ClusterSerial::tick();

    if (HardwareConfig::hasMAVLink)
        g_mavlink.tick();
    uint32_t afterTelemetryUs = micros();

    Hardware::tickStatusLED();
    uint32_t afterLedUs = micros();

    // Session peak tracking — health-gated so a failed sensor can't corrupt max values
    auto& edp = EngineData::instance();
    if (edp.n1Healthy        && edp.n1Rpm        > edp.maxN1)           edp.maxN1           = edp.n1Rpm;
    if (edp.n2Healthy        && edp.n2Rpm        > edp.maxN2)           edp.maxN2           = edp.n2Rpm;
    if (edp.totHealthy       && edp.tot          > edp.maxTot)          edp.maxTot          = edp.tot;
    if (edp.titHealthy       && edp.tit          > edp.maxTit)          edp.maxTit          = edp.tit;
    if (edp.fuelPressHealthy && edp.fuelPressure > edp.maxFuelPressure) edp.maxFuelPressure = edp.fuelPressure;
    if (HardwareConfig::hasP1         && edp.p1Healthy
                                       && edp.p1          > edp.maxP1)          edp.maxP1          = edp.p1;
    if (HardwareConfig::hasP2         && edp.p2Healthy
                                       && edp.p2          > edp.maxP2)          edp.maxP2          = edp.p2;
    if (HardwareConfig::hasOilTemp    && edp.oilTempHealthy
                                       && edp.oilTemp    > edp.maxOilTemp)     edp.maxOilTemp     = edp.oilTemp;
    if (HardwareConfig::hasBattVoltage && edp.battHealthy
                                       && edp.battVoltage > edp.maxBattVoltage) edp.maxBattVoltage = edp.battVoltage;
    if (edp.mode == SysMode::RUNNING && HardwareConfig::hasOilPress && edp.oilHealthy &&
        (edp.minOilPressure < 0.0f || edp.oilPressure < edp.minOilPressure))
        edp.minOilPressure = edp.oilPressure;

    const uint32_t loopEndUs = micros();
    const uint32_t execUs = loopEndUs - loopStartUs;
    if (execUs > loopWindowMaxUs) {
        loopWindowMaxUs = execUs;
        loopWorstSensorsUs = afterSensorsUs - afterCommandsUs;
        loopWorstSequencersUs = afterSequencersUs - afterSensorsUs;
        loopWorstControllersUs = afterControllersUs - afterSequencersUs;
        loopWorstActuatorsUs = afterActuatorsUs - afterControllersUs;
        loopWorstLoggingUs = afterLoggingUs - afterActuatorsUs;
        loopWorstLedUs = afterLedUs - afterTelemetryUs;
    }
    loopExecAvgUs = (loopExecAvgUs <= 0.0f)
        ? (float)execUs
        : (loopExecAvgUs * 0.92f + (float)execUs * 0.08f);

    edp.loopCounter = edp.loopCounter + 1;
    if (lastLoopStartUs != 0) {
        const uint32_t periodUs = loopStartUs - lastLoopStartUs;
        if (periodUs > 0) {
            edp.loopPeriodMs = (float)periodUs / 1000.0f;
            edp.loopHz = 1000000.0f / (float)periodUs;
        }
    }
    lastLoopStartUs = loopStartUs;

    const uint32_t nowMs = millis();
    if (loopWindowStartMs == 0) loopWindowStartMs = nowMs;
    if (nowMs - loopWindowStartMs >= 1000) {
        edp.loopExecMaxMs = (float)loopWindowMaxUs / 1000.0f;
        // Report the section breakdown from that same worst loop, rather than
        // unrelated values from whichever loop happened to end the window.
        edp.loopSensorsMs = (float)loopWorstSensorsUs / 1000.0f;
        edp.loopSequencerMs = (float)loopWorstSequencersUs / 1000.0f;
        edp.loopControllersMs = (float)loopWorstControllersUs / 1000.0f;
        edp.loopActuatorsMs = (float)loopWorstActuatorsUs / 1000.0f;
        edp.loopLoggingMs = (float)loopWorstLoggingUs / 1000.0f;
        edp.loopLedMs = (float)loopWorstLedUs / 1000.0f;
        loopWindowMaxUs = 0;
        loopWorstSensorsUs = loopWorstSequencersUs = loopWorstControllersUs = 0;
        loopWorstActuatorsUs = loopWorstLoggingUs = loopWorstLedUs = 0;
        loopWindowStartMs = nowMs;
    }
    edp.loopExecAvgMs = loopExecAvgUs / 1000.0f;
    edp.uptimeMs = nowMs;
    edp.publishSnapshot();

    const uint32_t loopElapsedUs = micros() - loopStartUs;
    const uint32_t targetHz = constrain((uint32_t)Config::controlLoopHz, 50u, 1000u);
    const uint32_t targetPeriodUs = 1000000u / targetHz;
    if (loopElapsedUs < targetPeriodUs) {
        uint32_t waitUs = targetPeriodUs - loopElapsedUs;
        if (waitUs >= 1000u) {
            delay(waitUs / 1000u);
            waitUs %= 1000u;
        }
        if (waitUs > 0u) delayMicroseconds(waitUs);
    }
}
