#pragma once
#include <stdint.h>

// Shared I2C loss contract: a responding device remains usable during a
// bounded recheck window, then becomes unavailable at the exact boundary.
namespace LossRecheck {
static constexpr uint32_t WINDOW_MS = 500UL;

inline bool expired(uint32_t nowMs, uint32_t lossSinceMs, bool lossActive) {
    return lossActive && (uint32_t)(nowMs - lossSinceMs) >= WINDOW_MS;
}
}
