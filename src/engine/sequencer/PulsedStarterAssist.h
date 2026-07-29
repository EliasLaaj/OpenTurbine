#pragma once
#include <stdint.h>

// Dependency-free state machine for the low-speed impact-style starter pulse.
// Keeping timing here makes the safety behavior reviewable and compile-time
// testable without pulling Arduino or EngineData into a host test.
class PulsedStarterAssist {
public:
    enum class Phase : uint8_t { Complete, On, Off, Cancelled };

    constexpr void begin(bool enabled, uint32_t now) {
        _phase = enabled ? Phase::On : Phase::Complete;
        _phaseStartedMs = now;
    }

    constexpr Phase update(uint32_t now, bool n1Healthy, float n1Rpm,
                           float untilRpm, uint32_t onMs, uint32_t offMs) {
        if (_phase == Phase::Complete || _phase == Phase::Cancelled) return _phase;
        if (!n1Healthy) {
            _phase = Phase::Cancelled;
            return _phase;
        }
        if (n1Rpm >= untilRpm) {
            _phase = Phase::Complete;
            return _phase;
        }

        const uint32_t duration = _phase == Phase::On ? onMs : offMs;
        // Unsigned subtraction is deliberately wrap-safe across millis().
        if (now - _phaseStartedMs >= duration) {
            _phase = _phase == Phase::On ? Phase::Off : Phase::On;
            _phaseStartedMs = now;
        }
        return _phase;
    }

    constexpr Phase phase() const { return _phase; }
    constexpr bool pulseOn() const { return _phase == Phase::On; }
    constexpr bool complete() const { return _phase == Phase::Complete; }
    constexpr bool cancelled() const { return _phase == Phase::Cancelled; }

private:
    Phase _phase = Phase::Complete;
    uint32_t _phaseStartedMs = 0;
};

// These compile on both firmware targets and pin down the timing, threshold,
// cancellation, re-entry, disabled, and millis-wrap contracts.
namespace PulsedStarterAssistChecks {
constexpr bool timingAndThreshold() {
    PulsedStarterAssist assist;
    assist.begin(true, 100);
    if (!assist.pulseOn()) return false;
    if (assist.update(599, true, 0, 1000, 500, 250) != PulsedStarterAssist::Phase::On) return false;
    if (assist.update(600, true, 0, 1000, 500, 250) != PulsedStarterAssist::Phase::Off) return false;
    if (assist.update(849, true, 0, 1000, 500, 250) != PulsedStarterAssist::Phase::Off) return false;
    if (assist.update(850, true, 0, 1000, 500, 250) != PulsedStarterAssist::Phase::On) return false;
    return assist.update(851, true, 1000, 1000, 500, 250) == PulsedStarterAssist::Phase::Complete;
}
constexpr bool cancellationAndReset() {
    PulsedStarterAssist assist;
    assist.begin(true, 0);
    if (assist.update(1, false, 0, 1000, 500, 250) != PulsedStarterAssist::Phase::Cancelled) return false;
    if (assist.update(2, true, 0, 1000, 500, 250) != PulsedStarterAssist::Phase::Cancelled) return false;
    assist.begin(true, 3);
    if (!assist.pulseOn()) return false;
    assist.begin(false, 4);
    return assist.complete();
}
constexpr bool millisWrap() {
    PulsedStarterAssist assist;
    assist.begin(true, 0xfffffff0u);
    return assist.update(0x10u, true, 0, 1000, 32, 16) == PulsedStarterAssist::Phase::Off;
}
static_assert(timingAndThreshold(), "Pulsed Starter Assist timing contract failed");
static_assert(cancellationAndReset(), "Pulsed Starter Assist cancellation contract failed");
static_assert(millisWrap(), "Pulsed Starter Assist millis wrap contract failed");
} // namespace PulsedStarterAssistChecks
