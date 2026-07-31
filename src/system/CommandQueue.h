#pragma once
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

// ============================================================
//  CommandQueue — thread-safe one-way pipe: Web (Core 0) → ECU (Core 1)
//
//  FreeRTOS queue, capacity QUEUE_DEPTH.
//  push() is non-blocking (web task — drops if full).
//  drain() called at top of every ECU loop tick.
//  ECU never blocks waiting for commands.
// ============================================================

enum class OTCommand : uint8_t {
    START,
    START_LIMITED,        // reduced-power restart with one eligible failed sensor
    STOP,
    FUEL_PRIME,
    OIL_PRIME,
    IGN_TEST,
    IGN2_TEST,      // fire AB / pilot igniter briefly (STANDBY only)
    START_TEST,
    FUEL_SOL_TEST,
    IDLE_TEST,
    SET_OIL_DEMAND,       // fParam = bar target
    SET_OIL_PCT,          // iParam = percent
    SET_THROTTLE_PCT,     // iParam = percent — drive throttle/fuel-pump ESC in STANDBY (fuel-pump min-spin calibration)
    TOGGLE_LIMP_MODE,
    TOGGLE_DYNAMIC_IDLE,
    TOGGLE_SAFETY_CHECKS, // DEV_MODE only
    TOGGLE_DEV_MODE,      // standby-only toggle; enables live Config edits and bench diagnostics
    TOGGLE_BENCH_MODE,    // bench/debug: all sequencer waits proceed on timer, safety skipped
    EXTRA_COOLDOWN,       // toggle: run configured cooldown actuators in standby until timeout
    PULSED_STARTER_ASSIST_TEST, // one configured ON pulse; STANDBY only
    CLEAR_LOG,
    AB_FIRE,              // manual afterburner ignition (from web UI)
    AB_STOP,              // manual afterburner shutdown (from web UI)
    APPLY_CONFIG,         // re-apply block params from config (safe in STANDBY only)
    // ── Actuator test commands (STANDBY only, auto-expire) ─────
    OIL_SCAV_TEST,        // run oil scavenge pump briefly
    COOL_FAN_TEST,        // run cooling fan briefly
    AIRSTARTER_TEST,      // pulse airstarter solenoid
    BLEED_VALVE_TEST,     // pulse bleed valve open
    GLOW_TEST,            // run glow plug using configured tools.glow_test_* values
    FUEL_PUMP2_TEST,      // run secondary fuel pump using configured test demand
    AB_SOL_TEST,          // pulse AB fuel solenoid
    AB_PUMP_TEST,         // run AB pump using configured test demand
    STARTER_EN_TEST,      // energise starter enable relay briefly
    PROP_PITCH_TEST,      // move prop pitch servo to mid-travel briefly
    REGISTRY_OUTPUT_TEST, // iParam = registry output index, fParam = normalized demand
    RESET_PEAKS,          // clear session peak values (maxN1, maxN2, maxTot, maxP1, maxP2)
};

struct OTPacket {
    OTCommand cmd;
    float     fParam = 0.0f;
    int       iParam = 0;
};

using CommandHandler = void(*)(const OTPacket&);

class CommandQueue {
public:
    static constexpr int QUEUE_DEPTH = 16;

    static bool begin() {
        _queue = xQueueCreate(QUEUE_DEPTH, sizeof(OTPacket));
        return _queue != nullptr;
    }

    // Called from Core 0 (web handler) — non-blocking
    static bool push(const OTPacket& pkt) {
        if (!_queue) return false;
        return xQueueSendToBack(_queue, &pkt, 0) == pdTRUE;
    }

    static bool pushFront(const OTPacket& pkt) {
        if (!_queue) return false;
        return xQueueSendToFront(_queue, &pkt, 0) == pdTRUE;
    }

    // Safety-priority commands supersede pending web/cluster commands.
    static bool pushEmergencyFront(const OTPacket& pkt) {
        if (!_queue) return false;
        if (pushFront(pkt)) return true;
        xQueueReset(_queue);
        return pushFront(pkt);
    }

    static bool pushEmergencyStop(const OTPacket& pkt) {
        return pushEmergencyFront(pkt);
    }

    // Called from Core 1 (ECU loop) — drains all pending commands
    static void drain(CommandHandler handler) {
        if (!_queue || !handler) return;
        OTPacket pkt;
        while (xQueueReceive(_queue, &pkt, 0) == pdTRUE) {
            handler(pkt);
        }
    }

private:
    static QueueHandle_t _queue;
};
