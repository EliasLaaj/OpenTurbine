#pragma once
#include "../IBlock.h"
#include "../../EngineData.h"
#include "../../../system/HardwareConfig.h"
#include <Arduino.h>

// Final shutdown: wait for N1=0, cut main oil, run scavenge pump (if fitted), enter STANDBY.
class FinalStop : public IBlock {
public:
    float         rpmZeroThreshold = 100.0f;
    unsigned long timeoutMs        = 10000;
    unsigned long oilScavengeMs    = 0;      // scavenge pump extra runtime after main oil cut (0 = disabled)

    const char* name() override { return "FinalStop"; }

    void onEnter() override {
        _entryMs    = millis();
        _stoppedMs  = 0;
        _phase      = 0;
        _timedOut   = false;
    }

    BlockResult tick() override {
        auto& ed = EngineData::instance();
        unsigned long now = millis();

        if (_phase == 0) {
            // Unhealthy N1 must not read as "stopped" — the shaft may still be
            // spinning. Wait out timeoutMs instead (same policy as RPMDrop).
            // With no N1 sensor there is no proof that the shaft has stopped.
            // Use the configured time as a conservative spool-down delay, just
            // as we do when fitted N1 feedback becomes unhealthy.
            bool stopped = HardwareConfig::hasN1Rpm
                         && ed.n1Healthy
                         && (ed.n1Rpm <= rpmZeroThreshold);
            _timedOut = !stopped && (now - _entryMs) > timeoutMs;
            if (stopped || _timedOut) {
                // Cut main oil pump
                ed.oilTargetBar    = 0;
                ed.oilPumpPct = 0;
                // Start scavenge phase if pump is fitted and duration > 0
                if (oilScavengeMs > 0 && HardwareConfig::hasOilScavengePump) {
                    ed.oilScavengeDemand = 1.0f;
                    _stoppedMs = now;
                    _phase     = 1;
                } else {
                    clearWaitReason();
                    return _timedOut ? BlockResult::TimeoutContinue : BlockResult::Complete;
                }
            } else {
                char _buf[80];
                if (!HardwareConfig::hasN1Rpm)
                    snprintf(_buf, sizeof(_buf), "No N1 sensor (waiting %lu ms spool-down delay)", timeoutMs);
                else if (!ed.n1Healthy)
                    snprintf(_buf, sizeof(_buf), "N1 sensor unhealthy (waiting %lu ms timeout)", timeoutMs);
                else
                    snprintf(_buf, sizeof(_buf), "N1: %d RPM (waiting for zero)", (int)ed.n1Rpm);
                setWaitReason(_buf);
            }
        }
        if (_phase == 1) {
            if ((now - _stoppedMs) >= oilScavengeMs) {
                clearWaitReason();
                return _timedOut ? BlockResult::TimeoutContinue : BlockResult::Complete;
            }
            char _buf[80];
            snprintf(_buf, sizeof(_buf), "Scavenge: %lu ms remaining", oilScavengeMs - (now - _stoppedMs));
            setWaitReason(_buf);
        }
        return BlockResult::Running;
    }

    void onExit() override {
        auto& ed = EngineData::instance();
        ed.oilTargetBar     = 0;
        ed.oilPumpPct  = 0;
        ed.oilScavengeDemand = 0.0f;
    }

private:
    unsigned long _entryMs   = 0;
    unsigned long _stoppedMs = 0;
    int           _phase     = 0;
    bool          _timedOut  = false;
};
