#pragma once
#include "../IBlock.h"
#include "../../EngineData.h"

// Open fuel solenoid. Completes immediately.
// Igniter should already be on from PreIgnSpark.
class FuelOpen : public IBlock {
public:
    const char* name() override { return "FuelOpen"; }

    void onEnter() override {
        auto& ed = EngineData::instance();
        ed.fuelSolOpen    = true;
    }

    BlockResult tick() override {
        return BlockResult::Complete;
    }

    void onExit() override {}
};
