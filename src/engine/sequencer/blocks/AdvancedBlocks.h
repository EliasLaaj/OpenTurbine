#pragma once
#include "../IBlock.h"
#include "../../EngineData.h"
#include "../../../system/Config.h"
#include "../../../system/HardwareConfig.h"
#include <Arduino.h>

// ============================================================
//  AdvancedBlocks — sequence blocks for expanded hardware support
//
//  BleedOpen / BleedClose — compressor bleed valve control.
//    Used during unloaded start (open=less surge risk) or surge
//    prevention.  One-shot blocks — complete in a single tick.
//
//  GlowPreheat — ramps proportional glow power up from 0 → maxPct
//    over preheatMs, then holds at holdPct. Relay glow outputs turn on
//    for the bounded preheat period instead. Used as the first
//    sequence block before fuel delivery to pre-heat the ignition element
//    flame element.  Completes when preheat ramp finishes.
//
//  FuelPumpRamp — ramps fuelPump2Demand from startPct → endPct
//    over rampMs.  Useful for turboshaft fuel-metering systems
//    where the secondary pump follows a pre-programmed curve.
//
//  FuelPump2Set — sets fuelPump2Demand to a fixed % in one tick.
//    Simple companion to FuelPumpRamp for known set-points.
//
//  GovernorHold — waits until N2 is within bandRpm of targetRpm
//    (or times out).  Use after transitioning to RUNNING to
//    confirm the power turbine governor has taken hold.
// ============================================================

// ── Bleed valve blocks ────────────────────────────────────────

class BleedOpen : public IBlock {
public:
    const char* name() override { return "BleedOpen"; }
    void onEnter() override { auto& ed = EngineData::instance(); ed.bleedValveDemand = 1.0f; ed.bleedValveOpen = true; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class BleedClose : public IBlock {
public:
    const char* name() override { return "BleedClose"; }
    void onEnter() override { auto& ed = EngineData::instance(); ed.bleedValveDemand = 0.0f; ed.bleedValveOpen = false; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

// ── Glow plug preheat ramp ────────────────────────────────────

class GlowPreheat : public IBlock {
public:
    unsigned long preheatMs      = 10000;  // total ramp duration (ms)
    float         maxPct         = 80.0f;  // peak duty during ramp
    float         holdPct        = 30.0f;  // duty to hold after ramp
    bool          waitUntilHot   = false;  // hold at holdPct until current sensor confirms plug is hot
    unsigned long waitHotTimeout = 30000;  // max extra wait after ramp (ms); prevents infinite hang if sensor broken

    const char* name() override { return "GlowPreheat"; }

    void onEnter() override {
        _startMs = millis();
        // Always pull from Config so changes take effect without a reboot.
        // (applyConfig() copies these too, but onEnter is the authoritative source
        //  for blocks that aren't wired into Hardware::applyConfig.)
        preheatMs    = (unsigned long)Config::glowPreheatMs;
        const bool relayOutput = HardwareConfig::glowPlugOutputType == 1;
        maxPct       = relayOutput ? 100.0f : Config::glowPreheatMaxPct;
        holdPct      = relayOutput ? 100.0f : Config::glowHoldPct;
        waitUntilHot = Config::glowWaitUntilHot;
    }

    BlockResult tick() override {
        auto& ed = EngineData::instance();
        unsigned long elapsed = millis() - _startMs;
        if (elapsed < preheatMs) {
            // Linear ramp 0 → maxPct
            float frac = (float)elapsed / (float)preheatMs;
            ed.glowPlugDemand = (frac * maxPct) / 100.0f;
            return BlockResult::Running;
        }
        // Preheat done — hold at hold duty
        ed.glowPlugDemand = holdPct / 100.0f;
        // waitUntilHot requires the current sensor to confirm temperature.
        // In bench mode (or if sensor is not fitted), skip the wait.
        // waitHotTimeout prevents an infinite hang if the sensor is broken or
        // misconfigured — proceed after the deadline rather than stalling the
        // entire startup sequence permanently.
        if (waitUntilHot && !ed.benchMode) {
            if (!HardwareConfig::hasGlowCurrentSensor || !ed.glowCurrentHealthy)
                setWaitReason("Glow current feedback unavailable");
            else if (!ed.glowPlugHot)
                setWaitReason("Waiting for glow plug temperature");
            else {
                clearWaitReason();
                return BlockResult::Complete;
            }
            if ((millis() - _startMs) < preheatMs + waitHotTimeout) {
                return BlockResult::Running;
            }
            Serial.println("[GlowPreheat] waitUntilHot timeout - aborting startup");
            ed.glowPlugDemand = 0.0f;
            return BlockResult::Abort;
        }
        clearWaitReason();
        return BlockResult::Complete;
    }

    void onExit() override {
        // Leave glowPlugDemand at holdPct — engine needs heat during ignition
    }

private:
    unsigned long _startMs = 0;
};

// ── Fuel pump 2 ramp ──────────────────────────────────────────

class FuelPumpRamp : public IBlock {
public:
    float         startPct = 0.0f;    // starting demand (0–100 %)
    float         endPct   = 80.0f;   // ending demand (0–100 %)
    unsigned long rampMs   = 3000;    // ramp duration

    const char* name() override { return "FuelPumpRamp"; }

    void onEnter() override {
        _startMs = millis();
        _completed = false;
        auto& ed = EngineData::instance();
        ed.fuelPump2Demand = startPct / 100.0f;
    }

    BlockResult tick() override {
        auto& ed = EngineData::instance();
        unsigned long elapsed = millis() - _startMs;
        if (elapsed >= rampMs) {
            ed.fuelPump2Demand = endPct / 100.0f;
            _completed = true;
            return BlockResult::Complete;
        }
        float frac = (float)elapsed / (float)rampMs;
        ed.fuelPump2Demand = (startPct + frac * (endPct - startPct)) / 100.0f;
        return BlockResult::Running;
    }

    void onExit() override {
        // Keep the final demand after a normal ramp. Abort/fault exits clear a
        // partial ramp so the secondary pump cannot remain at a stale demand.
        if (!_completed) EngineData::instance().fuelPump2Demand = 0.0f;
    }

private:
    unsigned long _startMs = 0;
    bool          _completed = false;
};

// ── Fuel pump 2 set point (one-shot) ─────────────────────────

class FuelPump2Set : public IBlock {
public:
    float demandPct = 0.0f;  // target % (0–100)

    const char* name() override { return "FuelPump2Set"; }
    void onEnter() override {
        auto& ed = EngineData::instance();
        ed.fuelPump2Demand = demandPct / 100.0f;
    }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

// ── Governor stabilisation hold ───────────────────────────────

class FuelPump2On : public IBlock {
public:
    const char* name() override { return "FuelPump2On"; }
    void onEnter() override {
        auto& ed = EngineData::instance();
        ed.fuelPump2Demand = 1.0f;
    }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class FuelPump2Off : public IBlock {
public:
    const char* name() override { return "FuelPump2Off"; }
    void onEnter() override { EngineData::instance().fuelPump2Demand = 0.0f; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class GovernorHold : public IBlock {
public:
    unsigned long timeoutMs = 10000;  // max wait for N2 to stabilise
    float         bandRpm   = 500.0f; // success when N2 within this of target

    const char* name() override { return "GovernorHold"; }

    void onEnter() override {
        _startMs = millis();
        _inBandSinceMs = 0;
        EngineData::instance().governorHandoffActive = true;
        // bandRpm and timeoutMs are set by Hardware::applyConfig() before the
        // sequence runs — no need to re-read Config here.
    }

    BlockResult tick() override {
        if ((millis() - _startMs) >= timeoutMs) return BlockResult::Fault;
        auto& ed = EngineData::instance();
        if (!ed.n2Healthy) { _inBandSinceMs = 0; return BlockResult::Running; }
        float targetRpm = Config::governorTargetRpm;
        if (targetRpm <= 0) return BlockResult::Fault;
        if (fabsf(ed.n2Rpm - targetRpm) < bandRpm) {
            if (_inBandSinceMs == 0) _inBandSinceMs = millis();
            if (millis() - _inBandSinceMs >= 500) return BlockResult::Complete;
        } else _inBandSinceMs = 0;
        return BlockResult::Running;
    }

    void onExit() override { EngineData::instance().governorHandoffActive = false; }

private:
    unsigned long _startMs = 0;
    unsigned long _inBandSinceMs = 0;
};
