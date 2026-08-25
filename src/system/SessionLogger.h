#pragma once

#include <stdint.h>
#include <stddef.h>

// ============================================================
//  SessionLogger — per-run CSV sensor log
//
//  Core 1 (ECU loop) calls tick() which snapshots EngineData
//  into a FreeRTOS queue — no file I/O on Core 1.
//  Core 0 (web task) calls drainQueue() only in STANDBY/FAULT.
//  ESP32 flash operations suspend both cores, so active-engine samples stay
//  in a bounded RAM queue and are persisted only after outputs are safe.
//
//  Lifecycle:
//    begin()        — called once in setup(); creates /logs/ dir
//    startSession() — called when mode enters STARTUP; starts RAM capture
//    endSession()   — called when mode returns to STANDBY; requests persistence
//    tick()         — Core 1: queue push only, no file I/O
//    drainQueue()   — Core 0: persists queued rows while storage is safe
// ============================================================

class SessionLogger {
public:
    // currentPath() becomes valid after the completed run is persisted.
    static const char* currentPath();

    static bool begin();         // init (mkdir /logs, create queue); call once in setup()
    static void startSession();  // begin bounded RAM capture; call at STARTUP
    static void endSession();    // request persist + close; call at STANDBY
    static void tick();          // Core 1: snapshot → queue push (no file I/O)
    static void drainQueue();    // Core 0: persist only in STANDBY/FAULT
    static uint32_t droppedRows();
    static uint32_t queuedRows();
    static uint32_t evictionCount();
    static uint32_t lastEvictedSession();
    static size_t freeBytes();
    static size_t reserveBytes();
    static bool healthy();
    static uint8_t errorCode();  // 0=ok, 1=queue, 2=open, 3=header, 4=backlog, 5=space, 6=write, 7=identity
    static bool captureActive();
    static uint32_t configuredMask();
};
