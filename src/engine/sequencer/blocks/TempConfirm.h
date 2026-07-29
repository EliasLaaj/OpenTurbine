#pragma once
#include "../IBlock.h"
#include "../../EngineData.h"
#include "../../../system/Config.h"
#include <Arduino.h>

// Wait for the selected engine temperature source to rise above a target.
// Alternative to FlameConfirm for engines without a flame sensor.
// Requires requiredCount consecutive readings above tempTarget to avoid
// triggering on a single sensor glitch.
// Abort if timeout is reached without EGT meeting the threshold.
class TempConfirm : public IBlock {
public:
    float         tempTarget    = 200.0f;   // °C
    unsigned long timeoutMs     = 10000;
    unsigned long checkIntervalMs = 300;    // space checks so each samples a fresh EGT reading
    int           requiredCount = 3;        // consecutive readings above target needed

    const char* name() override { return "TempConfirm"; }

    void onEnter() override {
        _entryMs   = millis();
        _lastCheck = millis();
        _lastSampleSeq = 0;
        _count     = 0;
        clearWaitReason();
    }

    BlockResult tick() override {
        auto& ed = EngineData::instance();
        // Bench mode: immediately simulate EGT above threshold - no sensor, no wait.
        if (ed.benchMode) {
            clearWaitReason();
            Serial.println("[TempConfirm] BENCH: simulating EGT threshold met");
            return BlockResult::Complete;
        }
        if ((millis() - _entryMs) > timeoutMs) {
            clearWaitReason();
            return BlockResult::Abort;
        }
        // Count only newly arrived EGT samples. The interval remains a
        // configurable minimum spacing, but can never manufacture multiple
        // confirmations from one held sensor value.
        unsigned long now = millis();
        const uint32_t sampleSeq = Config::effectiveEgtSource() == 2
            ? ed.titSampleSeq : ed.totSampleSeq;
        if (sampleSeq != 0 && sampleSeq != _lastSampleSeq &&
            now - _lastCheck >= checkIntervalMs) {
            _lastCheck = now;
            _lastSampleSeq = sampleSeq;
            if (Config::primaryEgtHealthy(ed) && Config::primaryEgtC(ed) >= tempTarget) {
                if (++_count >= requiredCount) {
                    clearWaitReason();
                    return BlockResult::Complete;
                }
            } else {
                _count = 0;  // reset on any reading below threshold
            }
        }
        return BlockResult::Running;
    }

    void onExit() override { clearWaitReason(); }

private:
    unsigned long _entryMs   = 0;
    unsigned long _lastCheck = 0;
    int           _count     = 0;
    uint32_t      _lastSampleSeq = 0;
};
