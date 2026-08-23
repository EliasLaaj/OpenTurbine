#pragma once

#include <stdint.h>
#include <math.h>

namespace FeedbackControlMath {

struct State {
    bool active = false;
    float integral = 0.0f;
    uint32_t lastMs = 0;
};

inline float clamp(float value, float low, float high) {
    return value < low ? low : (value > high ? high : value);
}

inline void reset(State& state) {
    state.active = false;
    state.integral = 0.0f;
    state.lastMs = 0;
}

// Compact PI controller with bumpless first-tick handover. Gains are output
// fraction per engineering unit and output fraction per unit-second.
inline float step(State& state, uint32_t nowMs, float baseDemand,
                  float feedback, float target, float responseGain,
                  float integralGain, float deadband,
                  float outputMin, float outputMax) {
    float error = target - feedback;
    if (fabsf(error) <= deadband) error = 0.0f;
    if (!state.active) {
        state.integral = clamp(baseDemand - responseGain * error,
                               outputMin, outputMax);
        state.active = true;
    } else {
        const float dt = clamp((nowMs - state.lastMs) / 1000.0f, 0.0f, 0.1f);
        state.integral = clamp(state.integral + integralGain * error * dt,
                               outputMin, outputMax);
    }
    state.lastMs = nowMs;
    return clamp(state.integral + responseGain * error, outputMin, outputMax);
}

} // namespace FeedbackControlMath
