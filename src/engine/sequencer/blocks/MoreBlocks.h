#pragma once
#include "../IBlock.h"
#include "../../EngineData.h"
#include "../../../system/Config.h"
#include <Arduino.h>

// ============================================================
//  FuelPulse — brief timed fuel solenoid pulse for line priming
//
//  Opens the fuel solenoid for pulseMs, closes it, then waits
//  offMs before completing.  Use before PreIgnSpark when the fuel
//  line has a long dead-leg or atomiser that needs pre-wetting.
//  A combustion attempt is not inferred here; the actuator boundary records
//  only real fuel-and-ignition overlap.
// ============================================================
class FuelPulse : public IBlock {
public:
    unsigned long pulseMs = 200;   // solenoid open duration
    unsigned long offMs   = 300;   // wait after close before completing

    const char* name() override { return "FuelPulse"; }

    void onEnter() override {
        _entryMs = millis();
        _phase   = 0;
        EngineData::instance().fuelSolOpen = true;
    }

    BlockResult tick() override {
        unsigned long now = millis();
        if (_phase == 0 && (now - _entryMs) >= pulseMs) {
            EngineData::instance().fuelSolOpen = false;
            _phaseMs = now;
            _phase   = 1;
        }
        if (_phase == 1 && (now - _phaseMs) >= offMs) {
            return BlockResult::Complete;
        }
        return BlockResult::Running;
    }

    void onExit() override {
        EngineData::instance().fuelSolOpen = false;
    }

private:
    unsigned long _entryMs = 0;
    unsigned long _phaseMs = 0;
    int           _phase   = 0;
};

// ============================================================
//  WaitTOTCool - hold until selected engine temperature falls below threshold
//
//  Useful between relight attempts, before hot restart, or as a
//  post-cooldown verification step.  On timeout → CONTINUES
//  (does not abort — operator is waiting for thermal settle).
//  If EGT is unavailable, waits until timeout; startup then aborts, while
//  non-startup use completes so shutdown cannot be trapped forever.
// ============================================================
class WaitTOTCool : public IBlock {
public:
    float         targetTot = 150.0f;   // deg C - complete when selected EGT falls below this
    unsigned long timeoutMs = 120000;   // 2 min default; continues (does not abort)

    const char* name() override { return "WaitTOTCool"; }

    void onEnter() override {
        _entryMs = millis();
    }

    BlockResult tick() override {
        auto& ed = EngineData::instance();
        if (!Config::primaryEgtHealthy(ed)) {
            setWaitReason("Selected EGT feedback unavailable");
            if ((millis() - _entryMs) > timeoutMs)
                return ed.mode == SysMode::STARTUP ? BlockResult::Abort : BlockResult::TimeoutContinue;
            return BlockResult::Running;
        }
        if (Config::primaryEgtC(ed) <= targetTot)   return BlockResult::Complete;
        if ((millis() - _entryMs) > timeoutMs)
            return ed.mode == SysMode::STARTUP ? BlockResult::Abort : BlockResult::TimeoutContinue;
        return BlockResult::Running;
    }

    void onExit() override { clearWaitReason(); }

private:
    unsigned long _entryMs = 0;
};

// ============================================================
//  ThrottleSet — explicitly set throttle to a fixed percentage
//
//  Writes throttleDemand and completes immediately.  Use for a
//  precise idle hold, warm-up hold, or test point.
//  Does NOT clamp against throttle slew controller limits —
//  the slew controller will ramp to this setpoint if active.
// ============================================================
class ThrottleSet : public IBlock {
public:
    float pct = 10.0f;   // throttle demand %

    const char* name() override { return "ThrottleSet"; }

    void onEnter() override {
        EngineData::instance().throttleDemand = pct / 100.0f;
    }

    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

// ============================================================
//  PreHeat — fire igniter for a fixed duration without opening fuel
//
//  Use for glow-plug ignition systems that need thermal pre-heat
//  before fuel introduction.  The igniter remains ON when the
//  block exits — place FuelOpen immediately after so fuel ignites
//  on contact with the hot element.
//  Also useful for relight warm-up: fire igniter briefly, then
//  add FuelOpen and FlameConfirm/TempConfirm for controlled relight.
// ============================================================
class PreHeat : public IBlock {
public:
    unsigned long preheatMs = 3000;   // how long to heat before completing

    const char* name() override { return "PreHeat"; }

    void onEnter() override {
        _entryMs = millis();
        EngineData::instance().igniterOn = true;
    }

    BlockResult tick() override {
        if ((millis() - _entryMs) >= preheatMs) return BlockResult::Complete;
        return BlockResult::Running;
    }

    void onExit() override {}  // igniter stays ON — turned off by FlameConfirm or IgniterOff

private:
    unsigned long _entryMs = 0;
};
