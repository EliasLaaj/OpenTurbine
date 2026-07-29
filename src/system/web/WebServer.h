#pragma once
#include "../../system/CommandQueue.h"

// ============================================================
//  WebServer — ESPAsyncWebServer + WebSocket telemetry
//
//  Runs on Core 0 (AsyncWebServer is FreeRTOS-native).
//  Static files served from LittleFS (/index.html, etc.)
//  WebSocket (/ws) serves client-pulled EngineData snapshots.
//
//  REST endpoints:
//    GET  /              → index.html
//    GET  /api/data      → live EngineData JSON snapshot
//    GET  /api/config    → current settings section from ecu_config.json
//    POST /api/config    → replace settings section in ecu_config.json
//    PATCH /api/config   → merge settings patch into ecu_config.json
//    GET  /api/hardware  → current hardware section from ecu_config.json
//    POST /api/hardware  → replace hardware section, validate, reboot
//    PATCH /api/hardware → calibration-only hardware patch
//    GET  /api/ecu_config  → download full hardware+settings engine file
//    POST /api/ecu_config → restore full hardware+settings engine file, reboot
//    GET  /api/log       → full flight recorder log
//    GET  /api/session/list, /api/session/log, /api/session/all
//    POST /api/command   → queue OTCommand
//    POST /api/start     → queue START
//    POST /api/stop      → queue STOP (high priority)
//    POST /api/factory_reset
//    POST /update        → OTA firmware upload
//    POST /api/web_assets → gzipped web UI asset upload
//    GET  /api/status    → mode + health summary
//    WS   /ws            → live telemetry, client-pulled snapshots
// ============================================================

class WebServer {
public:
    // False means the fixed web workspace could not be reserved. The caller
    // must retain this as a START-readiness fault after hardware init.
    static bool begin();
    static void tick();
    static bool otaInProgress();
    // True while a hardware/config save has scheduled the apply-reboot.
    // Core-1 command handling must reject START in this window too — the
    // physical button and cluster serial bypass the web preflight.
    static bool rebootPending();

private:
    static void _setupRoutes();
};
