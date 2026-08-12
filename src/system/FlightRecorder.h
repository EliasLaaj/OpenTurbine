#pragma once
#include "../engine/EngineData.h"
#include <stdint.h>
#include <stddef.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

// ============================================================
//  FlightRecorder — black-box event log to LittleFS
//
//  Combines lifecycle events (start/fault/shutdown/abort/config-change)
//  with compact 10-second SNAP records (N1, EGT, throttle + fitted
//  sensors) and a per-run RUN_SUMMARY (max N1, max TOT/TIT, min oil,
//  run duration).
//
//  Ring buffer of MAX_RECORDS.  At ~203 records per 30-min run, 2200
//  records covers ~10 complete runs.  Eviction drops the oldest 20 %
//  (~2 runs) so at least 8 full runs are always retained.
//
//  Producers (Core 1 ECU loop, plus Core-0 config-change logging) only
//  format events into a static ring buffer guarded by a spinlock —
//  no LittleFS access on the ECU core. Core 0 drains the ring only in
//  STANDBY/FAULT, because ESP32 flash writes suspend both cores. If the ring
//  fills during a run, it retains the newest records, counts overwritten
//  records, and writes an EVENTS_DROPPED marker when storage is safe.
// ============================================================

class FlightRecorder {
public:
    static constexpr const char* PATH       = "/logs/events.json";
    static constexpr int         MAX_RECORDS = 2200;

    static void begin();
    static void tick();   // called every ECU loop — writes SNAP + tracks run peaks

    // Log specific events
    static void logBoot();
    static void logStartAttempt();
    static void logBlockEnter(const char* blockName);
    static void logBlockExit(const char* blockName, const char* result);
    static void logRunningEntry();
    static void logFault(const char* code);
    static void logNormalShutdown();
    static void logFaultShutdown(const char* code);
    static void logAbort(const char* blockName, const char* reason);
    static void logConfigChange(const char* field, float oldVal, float newVal);
    static void logRelight(uint8_t attemptNum);
    static void logRunSummary();   // called automatically by shutdown handlers

    static void clear();
    static void requestClear();  // Core 1: defer file removal to Core 0

    // Current number of records in the log (0 before first write).
    static int recordCount();
    static uint32_t droppedEvents();
    static uint8_t pendingCount();
    static bool healthy();
    static uint8_t errorCode();
    static uint32_t lastDurableAppendMs();

    // For web download — writes full log JSON to buf, returns bytes written
    static size_t toJson(char* buf, size_t len);

    // Bracket direct file access (e.g. CSV handler) with these to prevent
    // racing against runEviction()'s file eviction (remove + rename).
    static void lockLog();
    static void unlockLog();
    static void beginRawDownload();
    static void endRawDownload();

    // Called from Core 0 only in STANDBY/FAULT: drains the event ring to flash,
    // evicts when the log is full, and performs deferred clear().
    static void runEviction();

private:
    static void   _append(const char* eventJson);
    static uint32_t _uptimeSec();

    // Mutex guards file access between Core 0 writers (runEviction/clear)
    // and readers (toJson, CSV/raw download handlers).
    // Protects the remove+rename sequence in log eviction.
    static SemaphoreHandle_t _mutex;

    // SNAP timing
    static unsigned long _lastSnapshotMs;

    // Run-peak accumulators — reset at RUNNING_ENTRY, written in RUN_SUMMARY
    static float    _runMaxN1;
    static float    _runMaxTot;
    static float    _runMaxTit;
    static float    _runMinOil;
    static uint32_t _runStartSec;
    static bool _runActive;
};
