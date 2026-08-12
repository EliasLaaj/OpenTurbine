#pragma once
#include "../IBlock.h"
#include "../../EngineData.h"
#include "../../../system/Config.h"
#include "../../../system/HardwareConfig.h"
#include <Arduino.h>

// ============================================================
//  FuelPumpIdle — set throttle / fuel ESC from idle input channel
//
//  ACTION block: reads idleInputRaw (0–4095), maps it linearly
//  through [Config::fuelPumpMinPct, maxPct], and writes the
//  result to ed.throttleDemand. Completes in one tick.
//
//  The low end is the calibrated fuel-pump minimum-spin percentage.
//  maxPct is set from Config::throttleIdleMaxPct (the unified idle ceiling)
//  via Hardware::applyConfig().
// ============================================================
class FuelPumpIdle : public IBlock {
public:
    float maxPct = 18.0f;   // throttle % when idle input is at maximum

    const char* name() override { return "FuelPumpIdle"; }

    void onEnter() override {
        auto& ed = EngineData::instance();
        _inputFault = HardwareConfig::hasIdleInput && !ed.idleInputValid && !ed.benchMode;
        if (_inputFault) {
            ed.throttleDemand = 0.0f;
            setWaitReason("Idle input unhealthy");
            return;
        }
        float norm;
        if (HardwareConfig::idleInputRcPwm) {
            norm = ed.rcIdleValid ? ed.rcIdleNorm : 0.0f;
        } else {
            int range = Config::idleMaxRaw - Config::idleMinRaw;
            norm = range == 0 ? 0.0f :
                constrain((ed.idleInputRaw - Config::idleMinRaw) / (float)range, 0.0f, 1.0f);
        }
        float minPct = constrain(Config::fuelPumpMinPct, 0.0f, 100.0f);
        float topPct = constrain(maxPct, minPct, 100.0f);
        float pct  = minPct + norm * (topPct - minPct);
        ed.throttleDemand = constrain(pct / 100.0f, 0.0f, 1.0f);
    }

    BlockResult tick() override {
        if (_inputFault) return BlockResult::Abort;
        clearWaitReason();
        return BlockResult::Complete;
    }

    void onExit() override {}

private:
    bool _inputFault = false;
};
