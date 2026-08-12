#include "EngineData.h"
#include <Arduino.h>
#include <string.h>

namespace {
alignas(EngineData) uint8_t g_publishedSnapshot[sizeof(EngineData)] = {};
alignas(uint32_t) uint32_t g_snapshotSequence = 0;
uint32_t g_lastSnapshotMs = 0;
constexpr uint32_t SNAPSHOT_PERIOD_MS = 50;
}

EngineData& EngineData::instance() {
    static EngineData inst;
    return inst;
}

void EngineData::publishSnapshot(uint32_t nowMs, bool force) {
    // Web telemetry is normally sent at about 3 Hz. A 20 Hz immutable source
    // is comfortably fresher than its consumer and avoids copying this large
    // structure on every 50-1000 Hz control tick.
    if (!force && __atomic_load_n(&g_snapshotSequence, __ATOMIC_RELAXED) != 0 &&
        nowMs - g_lastSnapshotMs < SNAPSHOT_PERIOD_MS) return;
    g_lastSnapshotMs = nowMs;

    // Single-writer sequence lock: Core 1 marks the buffer busy, copies with
    // interrupts fully available, then publishes one even generation. Core 0
    // retries if a publication overlaps its copy. This avoids holding a
    // cross-core critical section over several kilobytes of memcpy.
    __atomic_fetch_add(&g_snapshotSequence, 1U, __ATOMIC_ACQ_REL);
    memcpy(g_publishedSnapshot, this, sizeof(EngineData));
    __atomic_fetch_add(&g_snapshotSequence, 1U, __ATOMIC_RELEASE);
}

uint32_t EngineData::readPublishedSnapshot(void* destination, size_t destinationSize) {
    if (!destination || destinationSize < sizeof(EngineData)) return 0;
    for (;;) {
        const uint32_t before = __atomic_load_n(&g_snapshotSequence, __ATOMIC_ACQUIRE);
        if (before & 1U) continue;
        memcpy(destination, g_publishedSnapshot, sizeof(EngineData));
        const uint32_t after = __atomic_load_n(&g_snapshotSequence, __ATOMIC_ACQUIRE);
        if (before == after) return after >> 1;
    }
}
