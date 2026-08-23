#pragma once

#include <Arduino.h>
#include <atomic>
#include <stddef.h>
#include <stdint.h>

// Serialises live configuration replacement against the final START
// transition. The web task stages a serialized candidate on Core 0; the ECU
// task validates and applies it to Config statics on Core 1. A single atomic state closes both
// directions of the old STANDBY-check/START race.
class ConfigApplyGate {
public:
    enum State : uint8_t { Idle, WebWriting, ReadyForCore, CoreApplying, StartTransition };

    static bool tryBeginWebWrite() {
        uint8_t expected = Idle;
        return _state.compare_exchange_strong(expected, WebWriting, std::memory_order_acq_rel);
    }

    static uint32_t markReadyForCore(uint32_t settleMs = 0) {
        const uint32_t generation =
            _nextGeneration.fetch_add(1, std::memory_order_acq_rel) + 1;
        _pendingGeneration.store(generation, std::memory_order_release);
        _readyAfterMs.store(millis() + settleMs, std::memory_order_release);
        _state.store(ReadyForCore, std::memory_order_release);
        return generation;
    }

    // Called only by the web writer while it owns WebWriting. Ownership of
    // the heap buffer transfers to the ECU core.
    static uint32_t publishCandidate(char* data, size_t length, uint32_t settleMs = 0) {
        _pendingData = data;
        _pendingLength = length;
        const uint32_t generation =
            _nextGeneration.fetch_add(1, std::memory_order_acq_rel) + 1;
        _pendingGeneration.store(generation, std::memory_order_release);
        _readyAfterMs.store(millis() + settleMs, std::memory_order_release);
        _state.store(ReadyForCore, std::memory_order_release);
        return generation;
    }

    // Called only after the ECU core has changed ReadyForCore to CoreApplying.
    static char* takeCandidate(size_t& length) {
        char* data = _pendingData;
        length = _pendingLength;
        _pendingData = nullptr;
        _pendingLength = 0;
        return data;
    }

    // A Classic streamed parse may temporarily overlap another small HTTP
    // response. Keep the exact persisted generation staged and retry later;
    // the gate remains non-idle, so START and subsequent writes stay blocked.
    static void retryStagedCandidate(size_t length, uint32_t settleMs) {
        _pendingData = nullptr;
        _pendingLength = length;
        _readyAfterMs.store(millis() + settleMs, std::memory_order_release);
        _state.store(ReadyForCore, std::memory_order_release);
    }

    static uint32_t pendingGeneration() {
        return _pendingGeneration.load(std::memory_order_acquire);
    }

    // Completes a published settings transaction. The result is recorded
    // before releasing the gate so the web core can acknowledge the exact
    // generation rather than racing a subsequent GET against stale statics.
    static void completeCoreApply(uint32_t generation, bool succeeded) {
        _completedSucceeded.store(succeeded, std::memory_order_relaxed);
        _completedGeneration.store(generation, std::memory_order_release);
        release();
    }

    static bool completion(uint32_t generation, bool& succeeded) {
        if (!generation || _completedGeneration.load(std::memory_order_acquire) != generation)
            return false;
        succeeded = _completedSucceeded.load(std::memory_order_relaxed);
        return true;
    }

    static bool tryBeginCoreApply() {
        const uint32_t ready = _readyAfterMs.load(std::memory_order_acquire);
        if (static_cast<int32_t>(millis() - ready) < 0) return false;
        // ReadyForCore is a one-shot ticket, not merely a level. A stale ready
        // state must never run Hardware::applyConfig() again: that operation is
        // intentionally heavyweight and repeating it in the control loop
        // starves Wi-Fi on Classic ESP32. Generation comparison also makes a
        // duplicate/corrupted state transition fail closed without blocking a
        // later, genuinely new web update.
        const uint32_t pending = _pendingGeneration.load(std::memory_order_acquire);
        if (!pending ||
            pending == _completedGeneration.load(std::memory_order_acquire)) {
            uint8_t stale = ReadyForCore;
            _state.compare_exchange_strong(stale, Idle, std::memory_order_acq_rel);
            return false;
        }
        uint8_t expected = ReadyForCore;
        return _state.compare_exchange_strong(expected, CoreApplying, std::memory_order_acq_rel);
    }

    // Claims an otherwise-idle gate so the ECU core can apply a configuration
    // that was deliberately deferred while the engine was active.
    static bool tryBeginDeferredCoreApply() {
        uint8_t expected = Idle;
        return _state.compare_exchange_strong(expected, CoreApplying, std::memory_order_acq_rel);
    }

    static bool tryBeginStartTransition() {
        uint8_t expected = Idle;
        return _state.compare_exchange_strong(expected, StartTransition, std::memory_order_acq_rel);
    }

    static void release() { _state.store(Idle, std::memory_order_release); }
    static bool busy() { return _state.load(std::memory_order_acquire) != Idle; }
    static State state() { return static_cast<State>(_state.load(std::memory_order_acquire)); }

private:
    static inline std::atomic<uint8_t> _state{Idle};
    static inline std::atomic<uint32_t> _nextGeneration{0};
    static inline std::atomic<uint32_t> _pendingGeneration{0};
    static inline std::atomic<uint32_t> _readyAfterMs{0};
    static inline std::atomic<uint32_t> _completedGeneration{0};
    static inline std::atomic<bool> _completedSucceeded{false};
    static inline char* _pendingData = nullptr;
    static inline size_t _pendingLength = 0;
};
