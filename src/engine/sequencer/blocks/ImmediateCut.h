#pragma once
#include "../IBlock.h"
#include "../../EngineData.h"

// First shutdown block — cut all thrust sources immediately.
// Completes in one tick (synchronous clear).
class ImmediateCut : public IBlock {
public:
    const char* name() override { return "ImmediateCut"; }

    void onEnter() override {
        auto& ed = EngineData::instance();
        ed.throttleDemand     = 0;
        ed.fuelSolOpen        = false;
        ed.igniterOn          = false;
        ed.igniter2On         = false;
        ed.abSolOpen          = false;
        ed.abPumpDemand       = 0;
        ed.abFuelOffset       = 0;
        ed.fuelPump2Demand    = 0;
        ed.glowPlugDemand     = 0;
        ed.starterDemand      = 0;
        ed.starterEnabled     = false;
        ed.flameMonitorActive = false;
        ed.oilMinBar          = 0;        // stop oil safety check during cooldown
        ed.relightArmed       = false;
        // Limp remains latched through shutdown. enterStandby() is the single
        // clean ownership boundary that releases it.
        // Do NOT zero oilPumpPct here.
        // The P-loop does not run during SHUTDOWN, so oilPumpPct stays at whatever
        // the running loop last set — keeping the bearings lubricated through RPMDrop.
        // CooldownSpin.onEnter() will override it to 30 % when it starts.
        // CooldownSpin.onExit() zeros it after EGT has cooled.
        // enterStandby() also zeroes both oilTargetBar and oilPumpPct unconditionally.
        ed.oilTargetBar       = 0;   // clear bar target so P-loop (if ever re-enabled) starts fresh
    }

    BlockResult tick() override {
        return BlockResult::Complete;
    }

    void onExit() override {}
};
