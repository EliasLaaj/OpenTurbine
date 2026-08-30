#pragma once
#include "../IBlock.h"
#include "../../EngineData.h"
#include "../../../system/HardwareConfig.h"
#include "../../../system/Config.h"
#include "../SequenceIgnition.h"
#include <Arduino.h>

// User-facing "Final Startup Checks". Every enabled and installed check must
// remain continuously valid for holdMs before RUNNING is allowed.
class SafetyHold : public IBlock {
public:
    unsigned long holdMs = 1000;
    unsigned long timeoutMs = 15000;
    float finalCheckRpm = 31000.0f;
    float finalCheckN2Rpm = 0.0f;
    float finalCheckP1 = 0.0f;
    float finalCheckP2 = 0.0f;
    float finalCheckEgt = 0.0f;
    float runningOilMin = 2.8f;
    bool checkN1 = true;
    bool checkN2 = false;
    bool checkP1 = false;
    bool checkP2 = false;
    bool checkOil = false;
    bool checkEgt = false;
    bool checkFlame = false;

    bool turnOffStarterOnExit = false;
    bool turnOffStarterEnOnExit = false;
    bool turnOffIgniterOnExit = false;

    const char* name() override { return "SafetyHold"; }

    void onEnter() override {
        _entryMs = millis();
        _stableSinceMs = 0;
        if (EngineData::instance().oilMinBar < runningOilMin)
            EngineData::instance().oilMinBar = runningOilMin;
    }

    BlockResult tick() override {
        auto& ed = EngineData::instance();
        const unsigned long now = millis();
        const unsigned long elapsed = now - _entryMs;
        if (ed.benchMode) {
            if (elapsed >= holdMs) { clearWaitReason(); return BlockResult::Complete; }
            snprintf(_reason, sizeof(_reason), "Final checks (bench): %lu ms remaining", holdMs - elapsed);
            setWaitReason(_reason);
            return BlockResult::Running;
        }

        bool any = false;
        const char* failed = nullptr;
        auto require = [&](bool enabled, bool installed, bool passed, const char* label) {
            if (!enabled) return;
            any = true;
            if ((!installed || !passed) && !failed) failed = label;
        };
        require(checkN1, HardwareConfig::hasN1Rpm, ed.n1Healthy && ed.n1Rpm >= finalCheckRpm, "N1");
        require(checkN2, HardwareConfig::hasN2Rpm, ed.n2Healthy && ed.n2Rpm >= finalCheckN2Rpm, "N2");
        require(checkP1, HardwareConfig::hasP1, ed.p1Healthy && ed.p1 >= finalCheckP1, "P1 pressure");
        require(checkP2, HardwareConfig::hasP2, ed.p2Healthy && ed.p2 >= finalCheckP2, "P2 pressure");
        require(checkOil, HardwareConfig::hasOilPress,
                ed.oilHealthy && ed.oilPressure >= runningOilMin, "oil pressure");
        require(checkEgt, Config::effectiveEgtSource() != 0,
                Config::primaryEgtHealthy(ed) && Config::primaryEgtC(ed) >= finalCheckEgt,
                "engine temperature");
        require(checkFlame, HardwareConfig::hasFlame,
                ed.flameHealthy && ed.flameDetected, "flame");

        if (!any) return BlockResult::Fault;
        if (failed) {
            _stableSinceMs = 0;
            snprintf(_reason, sizeof(_reason), "Final checks: waiting for %s", failed);
            setWaitReason(_reason);
        } else {
            if (_stableSinceMs == 0) _stableSinceMs = now;
            const unsigned long stable = now - _stableSinceMs;
            if (stable >= holdMs) { clearWaitReason(); return BlockResult::Complete; }
            snprintf(_reason, sizeof(_reason), "Final checks stable: %lu ms remaining", holdMs - stable);
            setWaitReason(_reason);
        }
        const unsigned long finiteTimeout = timeoutMs ? timeoutMs : 15000UL;
        if (elapsed >= finiteTimeout) return BlockResult::Fault;
        return BlockResult::Running;
    }

    void onExit() override {
        auto& ed = EngineData::instance();
        if (turnOffStarterOnExit) ed.starterDemand = 0;
        if (turnOffStarterEnOnExit) ed.starterEnabled = false;
        if (turnOffIgniterOnExit) {
            clearSequenceIgnitionOutputs();
        }
    }

private:
    unsigned long _entryMs = 0;
    unsigned long _stableSinceMs = 0;
    char _reason[96] = {};
};
