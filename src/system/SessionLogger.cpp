#include "SessionLogger.h"
#include "../hal/actuators/RelayDemand.h"
#include "SessionFiles.h"
#include "Config.h"
#include "HardwareConfig.h"
#include "../engine/EngineData.h"
#include "../engine/Types.h"
#include <LittleFS.h>
#include <Arduino.h>
#include <climits>
#include <cstring>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

// ── Row snapshot passed through the inter-core queue ─────────
// Plain-old-data struct — Core 1 fills it, Core 0 writes it.
struct SessionRow {
    uint32_t t_ms;
    uint32_t mask;
    float    n1, n2, tot, tit, oilTemp, oilPressure, p1, p2;
    float    throttleDemand, battVoltage, fuelPressure, fuelFlow;
    float    torque, shaftPower, thrust, starterDemand;
    float    glowPlugDemand, fuelPump2Demand, propPitchDemand, oilPumpPct;
    float    wetGlowFuelDemand;
    float    glowCurrentAmps, igniterCurrentAmps, igniter2CurrentAmps, oilPumpCurrentAmps;
    float    abPumpDemand, abFuelOffset;
    float    loopHz, loopExecAvgMs, loopExecMaxMs;
    int      abMode;
    bool     abFlameOn;
    bool     abRequest, abPermitted, abExecuting, abEvidence;
    uint32_t abUnconfirmedFuelMs;
    uint8_t  sysMode;   // SysMode cast to byte
};

static File              _file;
static volatile bool     _open      = false;
static volatile bool     _acceptRows = false;
static uint32_t          _lastMs    = 0;
static uint32_t          _rowCount  = 0;
static volatile uint32_t _droppedRows = 0;
static volatile bool     _healthy = true;
static volatile uint8_t  _errorCode = 0;
static uint32_t          _evictionCount = 0;
static uint32_t          _lastEvictedSession = 0;
static char              _currentPath[40] = {};
static QueueHandle_t     _rowQueue  = nullptr;
static volatile bool     _startPending = false;
static volatile bool     _endPending   = false;
static constexpr size_t  SESSION_MIN_FREE_BYTES = 150 * 1024;
static constexpr uint32_t SESSION_FREE_CHECK_MS = 5000;
static uint32_t          _lastFreeCheckMs = 0;
static bool              _lowSpaceDropActive = false;
static constexpr uint32_t SESSION_FLUSH_MS = 5000;
static uint32_t          _lastFlushMs = 0;
static constexpr uint16_t SESSION_QUEUE_ROWS = 64;

const char* SessionLogger::currentPath() {
    // Do not advertise a file to the async HTTP task until the STANDBY
    // persistence path has finished writing and closing it.
    return (_acceptRows || _startPending || _endPending || _open) ? "" : _currentPath;
}

uint32_t SessionLogger::droppedRows() { return _droppedRows; }
uint32_t SessionLogger::evictionCount() { return _evictionCount; }
uint32_t SessionLogger::lastEvictedSession() { return _lastEvictedSession; }
size_t SessionLogger::freeBytes() { return LittleFS.totalBytes() - LittleFS.usedBytes(); }
size_t SessionLogger::reserveBytes() { return SESSION_MIN_FREE_BYTES; }
bool SessionLogger::healthy() { return _healthy; }
uint8_t SessionLogger::errorCode() { return _errorCode; }

static void _evictOldSessions();

static const char* _modeStr(uint8_t m) {
    switch ((SysMode)m) {
        case SysMode::STANDBY:  return "STANDBY";
        case SysMode::STARTUP:  return "STARTUP";
        case SysMode::RUNNING:  return "RUNNING";
        case SysMode::SHUTDOWN: return "SHUTDOWN";
        case SysMode::FAULT:    return "FAULT";
        default:                return "?";
    }
}

static uint8_t _csvColumnCount(uint32_t mask) {
    uint8_t count = 1; // t_ms
    if (mask & Config::SLOG_MODE)       count += 1;
    if (mask & Config::SLOG_N1)         count += 1;
    if (mask & Config::SLOG_N2)         count += 1;
    if (mask & Config::SLOG_TOT)        count += 1;
    if (mask & Config::SLOG_TIT)        count += 1;
    if (mask & Config::SLOG_OIL_TEMP)   count += 1;
    if (mask & Config::SLOG_OIL)        count += 1;
    if (mask & Config::SLOG_P1)         count += 1;
    if (mask & Config::SLOG_P2)         count += 1;
    if (mask & Config::SLOG_THR)        count += 1;
    if (mask & Config::SLOG_BATT)       count += 1;
    if (mask & Config::SLOG_FUEL_PRESS) count += 1;
    if (mask & Config::SLOG_FUEL_FLOW)  count += 1;
    if (mask & Config::SLOG_GLOW)       count += 1;
    if (mask & Config::SLOG_WET_GLOW)   count += 1;
    if (mask & Config::SLOG_GLOW_CURRENT) count += 1;
    if (mask & Config::SLOG_IGN_CURRENT)  count += 1;
    if (mask & Config::SLOG_IGN2_CURRENT) count += 1;
    if (mask & Config::SLOG_OIL_CURRENT)  count += 1;
    if (mask & Config::SLOG_FP2)        count += 1;
    if (mask & Config::SLOG_AB)         count += 9;
    if (mask & Config::SLOG_PROP)       count += 1;
    if (mask & Config::SLOG_OIL_PCT)    count += 1;
    if (mask & Config::SLOG_LOOP)       count += 3;
    if (mask & Config::SLOG_TORQUE)     count += 2;
    if (mask & Config::SLOG_THRUST)     count += 1;
    if (mask & Config::SLOG_STARTER)    count += 1;
    return count;
}

// ── Write one queued row to the open file (Core 0 only) ──────
static void _writeRow(const SessionRow& row) {
    uint32_t mask = row.mask;
    static char r[768];
    int n = snprintf(r, sizeof(r), "%lu", (unsigned long)row.t_ms);

    #define APPEND_ROW_FIELD(...) do { \
        if (n >= 0 && n < (int)sizeof(r)) { \
            int wrote = snprintf(r + n, sizeof(r) - (size_t)n, __VA_ARGS__); \
            if (wrote < 0) { \
                n = (int)sizeof(r) - 1; \
            } else { \
                n += wrote; \
                if (n >= (int)sizeof(r)) n = (int)sizeof(r) - 1; \
            } \
        } \
    } while (0)

    if (mask & Config::SLOG_MODE)       APPEND_ROW_FIELD(",%s",  _modeStr(row.sysMode));
    if (mask & Config::SLOG_N1)         APPEND_ROW_FIELD(",%.0f",(double)row.n1);
    if (mask & Config::SLOG_N2)         APPEND_ROW_FIELD(",%.0f",(double)row.n2);
    if (mask & Config::SLOG_TOT)        APPEND_ROW_FIELD(",%.1f",(double)row.tot);
    if (mask & Config::SLOG_TIT)        APPEND_ROW_FIELD(",%.1f",(double)row.tit);
    if (mask & Config::SLOG_OIL_TEMP)   APPEND_ROW_FIELD(",%.1f",(double)row.oilTemp);
    if (mask & Config::SLOG_OIL)        APPEND_ROW_FIELD(",%.2f",(double)row.oilPressure);
    if (mask & Config::SLOG_P1)         APPEND_ROW_FIELD(",%.2f",(double)row.p1);
    if (mask & Config::SLOG_P2)         APPEND_ROW_FIELD(",%.2f",(double)row.p2);
    if (mask & Config::SLOG_THR)        APPEND_ROW_FIELD(",%.1f",(double)(row.throttleDemand * 100.0f));
    if (mask & Config::SLOG_BATT)       APPEND_ROW_FIELD(",%.2f",(double)row.battVoltage);
    if (mask & Config::SLOG_FUEL_PRESS) APPEND_ROW_FIELD(",%.2f",(double)row.fuelPressure);
    if (mask & Config::SLOG_FUEL_FLOW)  APPEND_ROW_FIELD(",%.3f",(double)row.fuelFlow);
    if (mask & Config::SLOG_GLOW) {
        const float glowPct = (HardwareConfig::glowPlugOutputType == 1)
            ? (RelayDemand::requested(row.glowPlugDemand) ? 100.0f : 0.0f)
            : (row.glowPlugDemand * 100.0f);
        APPEND_ROW_FIELD(",%.0f", (double)glowPct);
    }
    if (mask & Config::SLOG_WET_GLOW)   APPEND_ROW_FIELD(",%.0f",(double)(row.wetGlowFuelDemand * 100.0f));
    if (mask & Config::SLOG_GLOW_CURRENT) APPEND_ROW_FIELD(",%.2f",(double)row.glowCurrentAmps);
    if (mask & Config::SLOG_IGN_CURRENT)  APPEND_ROW_FIELD(",%.2f",(double)row.igniterCurrentAmps);
    if (mask & Config::SLOG_IGN2_CURRENT) APPEND_ROW_FIELD(",%.2f",(double)row.igniter2CurrentAmps);
    if (mask & Config::SLOG_OIL_CURRENT)  APPEND_ROW_FIELD(",%.2f",(double)row.oilPumpCurrentAmps);
    if (mask & Config::SLOG_FP2)        APPEND_ROW_FIELD(",%.1f",(double)(row.fuelPump2Demand * 100.0f));
    if (mask & Config::SLOG_AB)         APPEND_ROW_FIELD(",%d,%d,%.1f,%.1f,%d,%d,%d,%d,%lu",
                                                         row.abMode,
                                                         row.abFlameOn ? 1 : 0,
                                                         (double)(row.abPumpDemand * 100.0f),
                                                         (double)(row.abFuelOffset * 100.0f),
                                                         row.abRequest ? 1 : 0,
                                                         row.abPermitted ? 1 : 0,
                                                         row.abExecuting ? 1 : 0,
                                                         row.abEvidence ? 1 : 0,
                                                         (unsigned long)row.abUnconfirmedFuelMs);
    if (mask & Config::SLOG_PROP)       APPEND_ROW_FIELD(",%.1f",(double)(row.propPitchDemand * 100.0f));
    if (mask & Config::SLOG_OIL_PCT)    APPEND_ROW_FIELD(",%.1f",(double)row.oilPumpPct);
    if (mask & Config::SLOG_LOOP)       APPEND_ROW_FIELD(",%.1f,%.3f,%.3f",
                                                         (double)row.loopHz,
                                                         (double)row.loopExecAvgMs,
                                                         (double)row.loopExecMaxMs);
    if (mask & Config::SLOG_TORQUE)     APPEND_ROW_FIELD(",%.2f,%.1f",
                                                         (double)row.torque,
                                                         (double)row.shaftPower);
    if (mask & Config::SLOG_THRUST)     APPEND_ROW_FIELD(",%.2f",(double)row.thrust);
    if (mask & Config::SLOG_STARTER)    APPEND_ROW_FIELD(",%.1f",
                                                         (double)(row.starterDemand * 100.0f));

    #undef APPEND_ROW_FIELD

    r[sizeof(r) - 1] = 0;
    const uint32_t nowMs = millis();
    if (_lowSpaceDropActive || nowMs - _lastFreeCheckMs >= SESSION_FREE_CHECK_MS) {
        _lastFreeCheckMs = nowMs;
        _lowSpaceDropActive = (LittleFS.totalBytes() - LittleFS.usedBytes()) < SESSION_MIN_FREE_BYTES;
    }
    if (_lowSpaceDropActive) {
        _evictOldSessions();
        _lastFreeCheckMs = nowMs;
        _lowSpaceDropActive = (LittleFS.totalBytes() - LittleFS.usedBytes()) < SESSION_MIN_FREE_BYTES;
        if (_lowSpaceDropActive) {
            _droppedRows = _droppedRows + 1;
            _healthy = false;
            _errorCode = 5;
            return;
        }
    }
    if (_file.println(r) == 0) {
        _droppedRows = _droppedRows + 1;
        _healthy = false;
        _errorCode = 6;
        _lowSpaceDropActive = true;
        return;
    }
    _rowCount++;
}

// ── One-time init ─────────────────────────────────────────────
bool SessionLogger::begin() {
    if (!LittleFS.exists("/logs")) LittleFS.mkdir("/logs");
    if (!_rowQueue) _rowQueue = xQueueCreate(SESSION_QUEUE_ROWS, sizeof(SessionRow));
    _healthy = _rowQueue != nullptr;
    _errorCode = _healthy ? 0 : 1;
    return _healthy;
}

// ── Evict oldest session files if flash is low ────────────────
static void _evictOldSessions() {
    while (LittleFS.totalBytes() - LittleFS.usedBytes() < SESSION_MIN_FREE_BYTES) {
        File dir = LittleFS.open("/logs");
        if (!dir) break;

        int  oldest     = INT_MAX;
        char oldestPath[40] = {};
        bool sawCurrent = false;
        File entry = dir.openNextFile();
        while (entry) {
            int num = -1;
            // entry.name() may return the full path or just the basename.
            if (SessionFiles::parseRunNumber(entry.name(), num)) {
                char candidate[40];
                snprintf(candidate, sizeof(candidate), "/logs/session_%d.csv", num);
                if (_open && strcmp(candidate, _currentPath) == 0) {
                    sawCurrent = true;
                } else if (num < oldest) {
                    oldest = num;
                    strncpy(oldestPath, candidate, sizeof(oldestPath) - 1);
                    oldestPath[sizeof(oldestPath) - 1] = '\0';
                }
            }
            entry.close();
            entry = dir.openNextFile();
        }
        dir.close();

        if (oldest == INT_MAX) {
            if (sawCurrent) Serial.println("[SessionLogger] Flash low - current session is the only log left");
            break;
        }
        if (!LittleFS.remove(oldestPath)) {
            // remove() fails while the file is held open (e.g. an active
            // /api/session/log download) — bail out instead of re-selecting
            // the same file forever; rows are dropped and counted until the
            // next eviction attempt succeeds.
            Serial.printf("[SessionLogger] Could not evict %s (in use?) - will retry\n", oldestPath);
            break;
        }
        _evictionCount++;
        _lastEvictedSession = (uint32_t)oldest;
        Serial.printf("[SessionLogger] Evicted %s - flash low\n", oldestPath);
    }
}

// ── Core 0 lifecycle work requested by ECU transitions ───────
static void _openSession() {
    if (_open) {
        _acceptRows = false;
        _open = false;
        _file.flush();
        _file.close();
    }

    _evictOldSessions();

    uint32_t highestStored = 0;
    File dir = LittleFS.open("/logs");
    if (dir) {
        File entry = dir.openNextFile();
        while (entry) {
            int num = -1;
            if (SessionFiles::parseRunNumber(entry.name(), num) && num > 0)
                highestStored = max(highestStored, (uint32_t)num);
            entry.close();
            entry = dir.openNextFile();
        }
        dir.close();
    }
    const uint32_t durableRun = EngineData::instance().runCount;
    const uint32_t base = max(durableRun, highestStored);
    if (base == UINT32_MAX) {
        _currentPath[0] = '\0';
        _healthy = false;
        _errorCode = 7;
        Serial.println("[SessionLogger] Session identity exhausted");
        return;
    }
    const uint32_t run = base + 1U;
    snprintf(_currentPath, sizeof(_currentPath), "/logs/session_%lu.csv", (unsigned long)run);

    _file = LittleFS.open(_currentPath, "w");
    if (!_file) {
        Serial.printf("[SessionLogger] Failed to create %s\n", _currentPath);
        _currentPath[0] = '\0';
        _healthy = false;
        _errorCode = 2;
        return;
    }

    uint32_t mask = Config::sessionLogMask;
    _file.print("t_ms");
    if (mask & Config::SLOG_MODE)       _file.print(",mode");
    if (mask & Config::SLOG_N1)         _file.print(",n1_rpm");
    if (mask & Config::SLOG_N2)         _file.print(",n2_rpm");
    if (mask & Config::SLOG_TOT)        _file.print(",tot_c");
    if (mask & Config::SLOG_TIT)        _file.print(",tit_c");
    if (mask & Config::SLOG_OIL_TEMP)   _file.print(",oil_temp_c");
    if (mask & Config::SLOG_OIL)        _file.print(",oil_bar");
    if (mask & Config::SLOG_P1)         _file.print(",p1_bar");
    if (mask & Config::SLOG_P2)         _file.print(",p2_bar");
    if (mask & Config::SLOG_THR)        _file.print(",thr_pct");
    if (mask & Config::SLOG_BATT)       _file.print(",batt_v");
    if (mask & Config::SLOG_FUEL_PRESS) _file.print(",fuel_press_bar");
    if (mask & Config::SLOG_FUEL_FLOW)  _file.print(",fuel_flow");
    if (mask & Config::SLOG_GLOW)       _file.print(",glow_pct");
    if (mask & Config::SLOG_WET_GLOW)   _file.print(",wet_glow_fuel_pct");
    if (mask & Config::SLOG_GLOW_CURRENT) _file.print(",glow_current_a");
    if (mask & Config::SLOG_IGN_CURRENT)  _file.print(",ign_current_a");
    if (mask & Config::SLOG_IGN2_CURRENT) _file.print(",ign2_current_a");
    if (mask & Config::SLOG_OIL_CURRENT)  _file.print(",oil_current_a");
    if (mask & Config::SLOG_FP2)        _file.print(",fp2_pct");
    if (mask & Config::SLOG_AB)         _file.print(",ab_mode,ab_flame,ab_pump_pct,ab_offset_pct,ab_request,ab_permitted,ab_executing,ab_evidence,ab_unconfirmed_fuel_ms");
    if (mask & Config::SLOG_PROP)       _file.print(",prop_pct");
    if (mask & Config::SLOG_OIL_PCT)    _file.print(",oil_pump_pct");
    if (mask & Config::SLOG_LOOP)       _file.print(",loop_hz,loop_exec_avg_ms,loop_exec_max_ms");
    if (mask & Config::SLOG_TORQUE)     _file.print(",torque_nm,shaft_power_w");
    if (mask & Config::SLOG_THRUST)     _file.print(",thrust_n");
    if (mask & Config::SLOG_STARTER)    _file.print(",starter_pct");
    if (_file.println() == 0) {
        Serial.printf("[SessionLogger] Failed to write CSV header to %s\n", _currentPath);
        _file.close();
        _currentPath[0] = '\0';
        _droppedRows = _droppedRows + 1;
        _healthy = false;
        _errorCode = 3;
        return;
    }
    _healthy = _droppedRows == 0;
    _errorCode = _healthy ? 0 : 4;
    _lastFreeCheckMs = 0;
    _lowSpaceDropActive = false;
    _lastFlushMs = millis();
    _open     = true;
    Serial.printf("[SessionLogger] Session started - %u columns -> %s\n",
        (unsigned)_csvColumnCount(mask), _currentPath);
}

static void _closeSession() {
    if (!_open) return;
    _acceptRows = false;

    // Drain any rows Core 0 hasn't written yet before marking the session
    // closed. Low-space eviction uses _open/_currentPath to protect the active
    // file, including this final close path.
    if (_rowQueue) {
        SessionRow row;
        while (xQueueReceive(_rowQueue, &row, 0) == pdTRUE) _writeRow(row);
    }

    _open = false;
    _file.flush();
    _file.close();
    Serial.printf("[SessionLogger] Session ended - %u rows\n", (unsigned)_rowCount);
}

// ── Core 1: snapshot sensor state → queue (no file I/O) ──────
void SessionLogger::startSession() {
    _acceptRows = false;
    // An empty field mask would otherwise create timestamp-only files and
    // periodically flush LittleFS during every run. Besides wasting flash,
    // those flushes can stall the ESP32 Wi-Fi task for hundreds of
    // milliseconds. Treat "no fields selected" as logging disabled.
    if (Config::sessionLogMask == 0) {
        _startPending = false;
        if (_open) _endPending = true;
        return;
    }
    if (_rowQueue) xQueueReset(_rowQueue);
    _currentPath[0] = '\0';
    _rowCount = 0;
    _droppedRows = 0;
    _healthy = true;
    _errorCode = 0;
    _lastMs = 0;
    _startPending = true;
    _endPending = false;
    _acceptRows = true;
}

void SessionLogger::endSession() {
    _acceptRows = false;
    _endPending = true;
}

void SessionLogger::tick() {
    if (!_acceptRows || !_rowQueue) return;

    uint32_t now      = millis();
    uint32_t interval = Config::sessionLogIntervalMs > 0 ? Config::sessionLogIntervalMs : 500;
    if (now - _lastMs < interval) return;
    _lastMs = now;

    auto&    ed   = EngineData::instance();
    uint32_t mask = Config::sessionLogMask;

    SessionRow row;
    row.t_ms            = now;
    row.mask            = mask;
    row.n1              = ed.n1Rpm;
    row.n2              = ed.n2Rpm;
    row.tot             = ed.tot;
    row.tit             = ed.tit;
    row.oilTemp         = ed.oilTemp;
    row.oilPressure     = ed.oilPressure;
    row.p1              = ed.p1;
    row.p2              = ed.p2;
    row.throttleDemand  = ed.throttleDemand;
    row.battVoltage     = ed.battVoltage;
    row.fuelPressure    = ed.fuelPressure;
    row.fuelFlow        = ed.fuelFlow;
    row.torque          = ed.torque;
    row.shaftPower      = ed.turboPower;
    row.thrust          = ed.thrust;
    row.starterDemand   = ed.starterDemand;
    row.glowPlugDemand  = ed.glowPlugDemand;
    row.wetGlowFuelDemand = ed.wetGlowFuelDemand;
    row.glowCurrentAmps = ed.glowCurrentAmps;
    row.igniterCurrentAmps = ed.igniterCurrentAmps;
    row.igniter2CurrentAmps = ed.igniter2CurrentAmps;
    row.oilPumpCurrentAmps = ed.oilPumpCurrentAmps;
    row.fuelPump2Demand = ed.fuelPump2Demand;
    row.propPitchDemand = ed.propPitchDemand;
    row.oilPumpPct      = ed.oilPumpPct;
    row.abPumpDemand    = ed.abPumpDemand;
    row.abFuelOffset    = ed.abFuelOffset;
    row.loopHz          = ed.loopHz;
    row.loopExecAvgMs   = ed.loopExecAvgMs;
    row.loopExecMaxMs   = ed.loopExecMaxMs;
    row.abMode          = (int)ed.abMode;
    row.abFlameOn       = ed.abFlameOn;
    row.abRequest       = ed.abTriggerActive;
    row.abPermitted     = ed.abPermitted;
    row.abExecuting     = ed.abExecutionActive;
    row.abEvidence      = ed.abEvidenceValid;
    row.abUnconfirmedFuelMs = ed.abFirstFuelMs && !ed.abConfirmedMs ? millis() - ed.abFirstFuelMs : 0;
    row.sysMode         = (uint8_t)ed.mode;

    // Active-engine flash writes are forbidden, so retain a bounded tail in
    // RAM. If a long/high-rate run fills the queue, discard the oldest row and
    // keep the newest shutdown/fault context. Telemetry reports the loss.
    if (xQueueSendToBack(_rowQueue, &row, 0) != pdTRUE) {
        SessionRow oldest;
        (void)xQueueReceive(_rowQueue, &oldest, 0);
        (void)xQueueSendToBack(_rowQueue, &row, 0);
        _droppedRows = _droppedRows + 1;
        _healthy = false;
        _errorCode = 4;
    }
}

// ── Core 0: persist queued rows once engine outputs are safe ───
void SessionLogger::drainQueue() {
    // Both flags are normally observed together after a run because this
    // function is deliberately not called while engine control is active.
    if (_startPending) {
        _startPending = false;
        _openSession();
    }
    if (_endPending) {
        _endPending = false;
        _closeSession();
        return;
    }
    if (!_open || !_rowQueue) return;
    SessionRow row;
    static constexpr uint8_t MAX_ROWS_PER_DRAIN = 2;
    uint8_t drained = 0;
    while (_open && drained < MAX_ROWS_PER_DRAIN &&
           xQueueReceive(_rowQueue, &row, 0) == pdTRUE) {
        _writeRow(row);
        drained++;
    }
    // This path also supports a session opened while already safe (for tests
    // and recovery). Active-engine calls are blocked by WebServer::tick().
    if (_open && millis() - _lastFlushMs >= SESSION_FLUSH_MS) {
        _lastFlushMs = millis();
        _file.flush();
    }
}
