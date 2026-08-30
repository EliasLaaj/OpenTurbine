#pragma once
#include "../IBlock.h"
#include "../../EngineData.h"
#include "../../../system/HardwareConfig.h"
#include <Arduino.h>

// Pre-start oil priming gate.
// WITH oil pressure sensor: arms pump at target bar, waits for oil >= oilArmMinBar,
//   aborts on timeout (engine never fired — safe).
// WITHOUT oil pressure sensor: runs pump at startupOilPct % for timeoutMs, then
//   completes normally (no pressure feedback available).
class OilPrime : public IBlock {
public:
    float         oilArmMinBar     = 1.5f;
    unsigned long timeoutMs        = 3000;
    float         startupOilDemand = 2.5f;  // bar pressure target (with sensor)
    float         startupOilPct    = 80.0f; // pump duty % (no sensor)
    bool          useScavengePump  = false; // also activate scavenge pump during prime

    const char* name() override { return "OilPrime"; }

    void onEnter() override {
        _entryMs = millis();
        _completed = false;
        auto& ed = EngineData::instance();
        ed.oilMinBar = 0;  // not yet checking min during prime
        // Use the oil control loop to regulate to a pressure target ONLY when it is
        // actually running (sensor fitted, loop enabled, not bench). Otherwise drive the
        // pump directly at a fixed % — without this, a sensor-fitted build with the oil
        // loop OFF would set a target that nothing acts on and never prime (silent abort).
        _useLoop = HardwareConfig::hasOilPress && HardwareConfig::hasOilLoop && !ed.benchMode;
        if (_useLoop) {
            ed.oilTargetBar = startupOilDemand;   // P-controller regulates to this bar target
        } else {
            ed.oilPumpPct = startupOilPct;        // no loop / bench — drive the pump directly
        }
        if (HardwareConfig::hasOilScavengePump && useScavengePump) ed.oilScavengeDemand = 1.0f;
    }

    BlockResult tick() override {
        auto& ed = EngineData::instance();

        unsigned long elapsed = millis() - _entryMs;

        // When we drive the pump ourselves (no loop / bench), keep commanding it every tick
        // so nothing else quietly clears it during the prime.
        if (!_useLoop) ed.oilPumpPct = startupOilPct;

        if (!HardwareConfig::hasOilPress || ed.benchMode) {
            // No pressure sensor, OR bench mode — run pump for configured time then proceed
            if (elapsed >= timeoutMs) {
                clearWaitReason();
                _completed = true;
                return BlockResult::Complete;
            }
            char buf[80];
            snprintf(buf, sizeof(buf), "%sOil pump %.0f%% - %lu ms remaining",
                     ed.benchMode ? "[BENCH] " : "", startupOilPct,
                     timeoutMs - elapsed);
            setWaitReason(buf);
            return BlockResult::Running;
        }

        // Pressure sensor present and not bench mode — wait for pressure to come up
        if (ed.oilHealthy && ed.oilPressure >= oilArmMinBar) {
            clearWaitReason();
            _completed = true;
            return BlockResult::Complete;
        }
        if (elapsed > timeoutMs) {
            clearWaitReason();
            return BlockResult::Abort;  // oil never came up — safe to abort
        }
        char buf[80];
        snprintf(buf, sizeof(buf), "Oil pressure: %.2f / %.2f bar", ed.oilPressure, oilArmMinBar);
        setWaitReason(buf);
        return BlockResult::Running;
    }

    void onExit() override {
        // Arm oil safety check — sequencer sets the real threshold in StarterSpin
        auto& ed = EngineData::instance();
        if (_completed) ed.oilMinBar = oilArmMinBar;
        if (useScavengePump) ed.oilScavengeDemand = 0.0f;
    }

private:
    unsigned long _entryMs = 0;
    bool          _completed = false;
    bool          _useLoop = false;   // true = oil loop regulates to target; false = drive pump directly
};
