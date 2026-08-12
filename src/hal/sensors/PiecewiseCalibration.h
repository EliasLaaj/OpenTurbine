#pragma once

#include <math.h>
#include <stdint.h>

// Small, deterministic calibration helper for ordinary analog sensors.
// Raw points are ordered ADC counts. Values may consistently rise or fall,
// which covers voltage/current transmitters and common resistive senders.
namespace PiecewiseCalibration {
static constexpr uint8_t MAX_POINTS = 6;

inline bool valid(uint8_t count, const uint16_t* raw, const float* value) {
    if (count == 0) return true;       // legacy/default linear calibration
    if (count < 2 || count > MAX_POINTS || !raw || !value) return false;
    if (!isfinite(value[0])) return false;
    int8_t direction = 0;
    for (uint8_t i = 1; i < count; ++i) {
        if (raw[i] <= raw[i - 1] || !isfinite(value[i])) return false;
        const float delta = value[i] - value[i - 1];
        if (!isfinite(delta) || delta == 0.0f) return false;
        const int8_t stepDirection = delta > 0.0f ? 1 : -1;
        if (!direction) direction = stepDirection;
        else if (direction != stepDirection) return false;
    }
    return true;
}

inline float apply(float input, uint8_t count, const uint16_t* raw, const float* value) {
    if (count < 2 || !raw || !value) return NAN;
    if (input <= raw[0]) return value[0];
    if (input >= raw[count - 1]) return value[count - 1];
    for (uint8_t i = 1; i < count; ++i) {
        if (input > raw[i]) continue;
        const float fraction = (input - raw[i - 1]) / (float)(raw[i] - raw[i - 1]);
        return value[i - 1] + fraction * (value[i] - value[i - 1]);
    }
    return value[count - 1];
}
} // namespace PiecewiseCalibration
