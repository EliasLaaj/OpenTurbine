#pragma once

// Pure idle-demand mapping shared by the runtime and native behavior tests.
// All values are normalized 0..1 actuator demands.
class IdleFuelFloor {
public:
    static float fromOperator(float input, float minimum, float maximum) {
        input = clamp(input);
        minimum = clamp(minimum);
        maximum = clamp(maximum);
        if (maximum < minimum) maximum = minimum;
        return minimum + input * (maximum - minimum);
    }

    static float apply(float requested, float floor) {
        requested = clamp(requested);
        floor = clamp(floor);
        return requested < floor ? floor : requested;
    }

    // Preserve an authoritative zero when no startup idle was selected. Any
    // nonzero idle request must remain inside the reliable configured range.
    static float boundedNonzero(float requested, float minimum, float maximum) {
        requested = clamp(requested);
        if (requested == 0.0f) return 0.0f;
        minimum = clamp(minimum);
        maximum = clamp(maximum);
        if (maximum < minimum) maximum = minimum;
        return requested < minimum ? minimum : (requested > maximum ? maximum : requested);
    }

private:
    static float clamp(float value) {
        return value < 0.0f ? 0.0f : (value > 1.0f ? 1.0f : value);
    }
};
