#include <cassert>
#include <cmath>
#include <iostream>

#include "src/system/FeedbackControlMath.h"

static bool near(float a, float b, float eps = 0.0001f) {
    return std::fabs(a - b) <= eps;
}

int main() {
    using namespace FeedbackControlMath;
    State state;

    // First tick inherits the exact previous demand despite an existing error.
    float output = step(state, 1000, 0.37f, 2.0f, 3.0f,
                        0.10f, 0.02f, 0.0f, 0.0f, 1.0f);
    assert(near(output, 0.37f));

    // Integral correction proceeds with bounded elapsed time.
    output = step(state, 1100, 0.0f, 2.0f, 3.0f,
                  0.10f, 0.02f, 0.0f, 0.0f, 1.0f);
    assert(output > 0.37f);

    // Deadband removes needless correction and all output remains bounded.
    reset(state);
    output = step(state, 2000, 0.42f, 2.98f, 3.0f,
                  10.0f, 10.0f, 0.05f, 0.2f, 0.8f);
    assert(near(output, 0.42f));
    output = step(state, 2100, 0.0f, -100.0f, 100.0f,
                  10.0f, 10.0f, 0.0f, 0.2f, 0.8f);
    assert(near(output, 0.8f));

    std::cout << "feedback control behavior passed\n";
    return 0;
}
