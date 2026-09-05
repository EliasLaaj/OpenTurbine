#pragma once
#include <math.h>

namespace ThrottleCommandLatch {
    inline float clamp01(float value) {
        return value < 0.0f ? 0.0f : value > 1.0f ? 1.0f : value;
    }

    inline float retain(float publishedDemand, float currentDemand,
                        float retainedDemand) {
        // A value equal to the last published slew step is controller feedback,
        // not a replacement for the one-shot sequence target. Any different
        // value is a fresh command, including an immediate zero from STOP.
        return fabsf(publishedDemand - currentDemand) > 0.0001f
            ? clamp01(publishedDemand) : retainedDemand;
    }
}
