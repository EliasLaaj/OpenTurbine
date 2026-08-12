#pragma once
#include <stdint.h>

// Transport-neutral ADC threshold condition used by native and shared-I2C
// channels. Hysteresis is the total deadband; odd counts put the extra count
// on the rising edge so no configured count is silently discarded.
namespace AdcThreshold {
inline bool update(uint16_t raw, uint16_t threshold, uint16_t hysteresis,
                   bool previousState) {
    const int lowerBand = hysteresis / 2;
    const int upperBand = hysteresis - lowerBand;
    const int switchOn = threshold + upperBand > 4095 ? 4095 : threshold + upperBand;
    const int switchOff = threshold < lowerBand ? 0 : threshold - lowerBand;
    if (previousState) return raw > switchOff;
    return raw >= switchOn;
}

inline float logicalValue(bool conditionedState, bool activeHigh) {
    return (activeHigh ? conditionedState : !conditionedState) ? 1.0f : 0.0f;
}
}
