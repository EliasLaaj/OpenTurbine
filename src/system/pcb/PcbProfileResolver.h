#pragma once

#include "../ChannelRegistry.h"

class PcbProfileResolver {
public:
    // Replaces every profile-backed channel's physical fields from the
    // immutable catalog and rejects raw/unmapped channels in profile mode.
    static bool resolve(ChannelRegistry& registry, char* reason, size_t reasonSize);

    // Applies immutable shared-bus wiring to HardwareConfig after its user
    // document is read.
    static void applyFixedBuses();

    // Applies soldered indicators and UART routing while leaving operational
    // enable/rate choices under user control.
    static void applyFixedPeripherals();
};
