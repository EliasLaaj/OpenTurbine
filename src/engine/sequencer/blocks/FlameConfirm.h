#pragma once
#include "../IBlock.h"
#include "../../EngineData.h"
#include "../../../system/FlightRecorder.h"
#include <Arduino.h>

// Wait for sustained flame detection before allowing spool.
// Requires N consecutive detections within timeout.
// Abort if timeout reached with no flame (fuel never ignited — safe to abort).
class FlameConfirm : public IBlock {
public:
    unsigned long timeoutMs           = 5000;
    unsigned long checkIntervalMs     = 300;
    int           requiredCount       = 3;
    bool          turnOffIgniterOnExit = true;   // default: keep existing behaviour

    const char* name() override { return "FlameConfirm"; }

    void onEnter() override {
        _entryMs   = millis();
        _lastCheck = millis();
        _lastSampleSeq = 0;
        _count     = 0;
        clearWaitReason();
    }

    BlockResult tick() override {
        auto& ed = EngineData::instance();

        // Bench mode: immediately simulate a successful flame confirm — no sensor, no wait
        if (ed.benchMode) {
            clearWaitReason();
            Serial.println("[FlameConfirm] BENCH: simulating flame confirm");
            return BlockResult::Complete;
        }

        if ((millis() - _entryMs) > timeoutMs) {
            clearWaitReason();
            // Log the specific reason so the user sees "no ignition" rather than a generic abort.
            FlightRecorder::logAbort("FlameConfirm", "no_ignition_timeout");
            Serial.println("[FlameConfirm] Abort: flame not detected within timeout - check igniter, fuel nozzle, and fuel valve");
            return BlockResult::Abort;
        }

        unsigned long now = millis();
        if (ed.flameSampleSeq != 0 && ed.flameSampleSeq != _lastSampleSeq &&
            now - _lastCheck >= checkIntervalMs) {
            _lastCheck = now;
            _lastSampleSeq = ed.flameSampleSeq;
            if (ed.flameDetected) {
                if (++_count >= requiredCount) {
                    clearWaitReason();
                    return BlockResult::Complete;
                }
            } else {
                _count = 0;
            }
        }

        return BlockResult::Running;
    }

    void onExit() override {
        clearWaitReason();
        if (turnOffIgniterOnExit) {
            // Flame is confirmed self-sustaining — cut igniter
            auto& ed = EngineData::instance();
            ed.igniterOn = false;
            ed.igniter2On = false;
            ed.glowPlugDemand = 0.0f;
        }
    }

private:
    unsigned long _entryMs   = 0;
    unsigned long _lastCheck = 0;
    int           _count     = 0;
    uint32_t      _lastSampleSeq = 0;
};
