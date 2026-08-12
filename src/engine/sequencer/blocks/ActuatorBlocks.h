#pragma once
#include "../IBlock.h"
#include "../../EngineData.h"
#include "../../../system/HardwareConfig.h"

// ============================================================
//  Simple one-shot actuator control blocks.
//  Each sets a single EngineData field and completes in one tick.
//  Use as explicit sequence steps where you need precise control
//  over when an actuator turns on or off.
// ============================================================

class IgniterOn : public IBlock {
public:
    const char* name() override { return "IgniterOn"; }
    void onEnter() override { EngineData::instance().igniterOn = true; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class IgniterOff : public IBlock {
public:
    const char* name() override { return "IgniterOff"; }
    void onEnter() override { EngineData::instance().igniterOn = false; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class FuelSolClose : public IBlock {
public:
    const char* name() override { return "FuelSolClose"; }
    void onEnter() override { EngineData::instance().fuelSolOpen = false; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class StarterEnOn : public IBlock {
public:
    const char* name() override { return "StarterEnOn"; }
    void onEnter() override { EngineData::instance().starterEnabled = true; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class StarterEnOff : public IBlock {
public:
    const char* name() override { return "StarterEnOff"; }
    void onEnter() override { EngineData::instance().starterEnabled = false; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class StarterOff : public IBlock {
public:
    const char* name() override { return "StarterOff"; }
    void onEnter() override { EngineData::instance().starterDemand = 0; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class OilPumpOn : public IBlock {
public:
    float demandPct = 80.0f;  // direct % — bypasses pressure P-controller
    const char* name() override { return "OilPumpOn"; }
    void onEnter() override { EngineData::instance().oilPumpPct = demandPct; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class OilPumpOff : public IBlock {
public:
    const char* name() override { return "OilPumpOff"; }
    void onEnter() override {
        auto& ed = EngineData::instance();
        ed.oilTargetBar    = 0;
        ed.oilPumpPct = 0;
    }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class CoolFanOn : public IBlock {
public:
    const char* name() override { return "CoolFanOn"; }
    void onEnter() override { auto& ed = EngineData::instance(); ed.coolFanDemand = 1.0f; ed.coolFanOn = true; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class CoolFanOff : public IBlock {
public:
    const char* name() override { return "CoolFanOff"; }
    void onEnter() override { auto& ed = EngineData::instance(); ed.coolFanDemand = 0.0f; ed.coolFanOn = false; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class OilScavengeOn : public IBlock {
public:
    const char* name() override { return "OilScavengeOn"; }
    void onEnter() override { auto& ed = EngineData::instance(); ed.oilScavengeDemand = 1.0f; ed.oilScavengeOn = true; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class OilScavengeOff : public IBlock {
public:
    const char* name() override { return "OilScavengeOff"; }
    void onEnter() override { auto& ed = EngineData::instance(); ed.oilScavengeDemand = 0.0f; ed.oilScavengeOn = false; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

inline void setDrainValveDemand(float demand) {
    auto& ed = EngineData::instance();
    const auto& reg = HardwareConfig::channelRegistry;
    for (uint8_t i = 0; i < reg.outputCount; ++i) {
        if (reg.outputs[i].installed && !strcmp(reg.outputs[i].purpose, "drain_valve"))
            ed.registryOutputDemand[i] = constrain(demand, 0.0f, 1.0f);
    }
}

class DrainValveOpen : public IBlock {
public:
    const char* name() override { return "DrainValveOpen"; }
    void onEnter() override { setDrainValveDemand(1.0f); }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class DrainValveClose : public IBlock {
public:
    const char* name() override { return "DrainValveClose"; }
    void onEnter() override { setDrainValveDemand(0.0f); }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class AirstarterOn : public IBlock {
public:
    const char* name() override { return "AirstarterOn"; }
    void onEnter() override { EngineData::instance().airstarterOpen = true; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class AirstarterOff : public IBlock {
public:
    const char* name() override { return "AirstarterOff"; }
    void onEnter() override { EngineData::instance().airstarterOpen = false; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

// ── Afterburner actuator blocks ───────────────────────────────────────────────

class ABPumpOn : public IBlock {
public:
    float demandPct = 80.0f;
    const char* name() override { return "ABPumpOn"; }
    void onEnter() override { auto& ed = EngineData::instance(); ed.abPumpDemand = demandPct / 100.0f; if (!ed.abFirstFuelMs) ed.abFirstFuelMs = millis(); }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class ABPumpOff : public IBlock {
public:
    const char* name() override { return "ABPumpOff"; }
    void onEnter() override { EngineData::instance().abPumpDemand = 0; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class ABIgnOn : public IBlock {
public:
    const char* name() override { return "ABIgnOn"; }
    void onEnter() override { auto& ed = EngineData::instance(); ed.igniter2On = true; if (!ed.abFirstIgnitionMs) ed.abFirstIgnitionMs = millis(); }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class ABIgnOff : public IBlock {
public:
    const char* name() override { return "ABIgnOff"; }
    void onEnter() override { EngineData::instance().igniter2On = false; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class ABSolOpen : public IBlock {
public:
    const char* name() override { return "ABSolOpen"; }
    void onEnter() override { auto& ed = EngineData::instance(); ed.abSolOpen = true; if (!ed.abFirstFuelMs) ed.abFirstFuelMs = millis(); }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};

class ABSolClose : public IBlock {
public:
    const char* name() override { return "ABSolClose"; }
    void onEnter() override { EngineData::instance().abSolOpen = false; }
    BlockResult tick() override { return BlockResult::Complete; }
    void onExit() override {}
};
