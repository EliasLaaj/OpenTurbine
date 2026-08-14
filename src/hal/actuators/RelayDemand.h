#pragma once

// One normalized-demand contract for every relay transport.
// A relay cannot reproduce a partial command: zero is OFF and any deliberate
// nonzero request is ON. Two-position mechanisms (currently propeller pitch)
// must choose their position before reaching this boundary.
namespace RelayDemand {

constexpr bool requested(float demand) {
    return demand > 0.0f;
}

constexpr bool midpoint(float demand) {
    return demand >= 0.5f;
}

constexpr float binary(bool on) {
    return on ? 1.0f : 0.0f;
}

constexpr bool physicalLevel(float demand, bool inverted) {
    const bool logicalOn = requested(demand);
    return inverted ? !logicalOn : logicalOn;
}

static_assert(!requested(0.0f), "zero relay demand must be off");
static_assert(!requested(-0.01f), "invalid negative demand must not energize a relay");
static_assert(requested(0.01f), "an intentional nonzero relay demand must be on");
static_assert(!midpoint(0.49f) && midpoint(0.5f), "two-position midpoint contract changed");
static_assert(physicalLevel(0.0f, true) && !physicalLevel(1.0f, true),
              "relay polarity must invert the boolean state");

} // namespace RelayDemand
