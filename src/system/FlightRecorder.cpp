#include "FlightRecorder.h"
#include "Config.h"
#include "HardwareConfig.h"
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <esp_attr.h>
#include <Arduino.h>
#include <esp_efuse.h>

SemaphoreHandle_t FlightRecorder::_mutex          = nullptr;
static volatile bool s_clearPending = false;
static volatile int  s_activeRawDownloads = 0;
static volatile uint32_t s_droppedEvents = 0;
unsigned long     FlightRecorder::_lastSnapshotMs  = 0;
float             FlightRecorder::_runMaxN1        = 0.0f;
static float      s_runMaxN2                        = 0.0f;
float             FlightRecorder::_runMaxTot       = 0.0f;
float             FlightRecorder::_runMaxTit       = 0.0f;
float             FlightRecorder::_runMinOil       = 9999.0f;
uint32_t          FlightRecorder::_runStartSec     = 0;

// Tracked in-memory line count so we don't re-count the file on every append.
// -1 means not yet initialised (counted on first drain after boot).
static int s_lineCount = -1;

// ── Producer → Core 0 append ring ────────────────────────────
// _append() only queues formatted lines here; Core 0 (runEviction, called
// from the web task only while the ECU is in STANDBY/FAULT) writes them to
// flash so LittleFS never stalls active engine control. Multi-producer:
// Core 1 (ECU loop) plus Core-0
// callers (logConfigChange from the web task, Config::load warnings), so
// slot write + head advance + drop counting are serialized with s_ringMux.
// Core 0 drains normally. While draining is paused, a full active-run queue
// may advance s_ringTail to preserve newest evidence.
static constexpr size_t RING_SLOT_LEN = 500;   // fits the largest (FAULT) record
#if defined(OT_PLATFORM_ESP32)
// Keep scarce classic DRAM contiguous for the mandatory FreeRTOS timer-task
// stack. RTC slow memory is internal, byte-addressable and always powered in
// normal operation, so it is safe for this low-frequency producer queue. The
// classic queue holds 14 pending records versus 15 on S3; normal draining is
// much faster than event production, and overflow remains explicitly counted.
static constexpr int RING_SLOTS = 15;
RTC_NOINIT_ATTR static char s_ring[RING_SLOTS][RING_SLOT_LEN];
#else
static constexpr int RING_SLOTS = 16;
static char s_ring[RING_SLOTS][RING_SLOT_LEN];
#endif
static volatile uint8_t s_ringHead = 0;
static volatile uint8_t s_ringTail = 0;
static volatile bool    s_drainActive = false;
static portMUX_TYPE     s_ringMux  = portMUX_INITIALIZER_UNLOCKED;
// Overwrites already reported with an EVENTS_DROPPED marker (written by Core 0
// only; s_droppedEvents is only incremented under s_ringMux and snapshotted by
// the drain, so neither counter is racy).
static uint32_t         s_droppedMarked = 0;

static void jsonSafeCopy(char* dst, size_t len, const char* src) {
    if (!dst || len == 0) return;
    size_t out = 0;
    for (size_t i = 0; src && src[i] && out + 1 < len; i++) {
        unsigned char c = (unsigned char)src[i];
        if (c == '"' || c == '\\') dst[out++] = '\'';
        else if (c < 0x20) dst[out++] = ' ';
        else dst[out++] = (char)c;
    }
    dst[out] = '\0';
}

void FlightRecorder::begin() {
    if (!LittleFS.exists(PATH) && LittleFS.exists("/logs/events.bak")) {
        LittleFS.rename("/logs/events.bak", PATH);
    }
    if (!LittleFS.exists("/logs")) {
        LittleFS.mkdir("/logs");
    }
    s_lineCount = -1;   // force recount on first drain
    if (!_mutex) _mutex = xSemaphoreCreateMutex();
}

void FlightRecorder::tick() {
    auto& ed = EngineData::instance();
    auto& hw = HardwareConfig::instance();

    if (ed.mode == SysMode::STANDBY && !Config::logStandby) return;

    // Track run peaks (only meaningful during RUNNING, but harmless otherwise)
    if (ed.n1Rpm  > _runMaxN1)                              _runMaxN1 = ed.n1Rpm;
    if (hw.hasTwoShaft && hw.hasN2Rpm && ed.n2Rpm > s_runMaxN2) s_runMaxN2 = ed.n2Rpm;
    if (ed.tot    > _runMaxTot)                             _runMaxTot = ed.tot;
    if (hw.hasTit && ed.tit > _runMaxTit)                    _runMaxTit = ed.tit;
    if (hw.hasOilPress && ed.oilPressure < _runMinOil)      _runMinOil = ed.oilPressure;

    // Compact 10-second SNAP: essential sensors only
    uint32_t intervalMs = Config::snapshotIntervalMs > 0 ? Config::snapshotIntervalMs : 10000;
    unsigned long now = millis();
    if (now - _lastSnapshotMs < intervalMs) return;
    _lastSnapshotMs = now;

    // thr as 0-100 integer to save bytes
    int thrPct = (int)(ed.throttleDemand * 100.0f + 0.5f);

    char buf[260];
    int n = snprintf(buf, sizeof(buf),
        "{\"t\":%lu,\"ev\":\"SNAP\",\"n1\":%.0f,\"tot\":%.0f,\"thr\":%d",
        _uptimeSec(), ed.n1Rpm, ed.tot, thrPct);

    #define APPEND_EVENT_FIELD(...) do { \
        if (n >= 0 && n < (int)sizeof(buf)) { \
            int wrote = snprintf(buf + n, sizeof(buf) - (size_t)n, __VA_ARGS__); \
            if (wrote < 0) { \
                n = (int)sizeof(buf) - 1; \
            } else { \
                n += wrote; \
                if (n >= (int)sizeof(buf)) n = (int)sizeof(buf) - 1; \
            } \
        } \
    } while (0)

    if (hw.hasOilPress)
        APPEND_EVENT_FIELD(",\"oil\":%.2f,\"oilP\":%d", ed.oilPressure, (int)ed.oilPumpPct);
    if (hw.hasTwoShaft && hw.hasN2Rpm)
        APPEND_EVENT_FIELD(",\"n2\":%.0f", ed.n2Rpm);
    if (hw.hasTit)
        APPEND_EVENT_FIELD(",\"tit\":%.0f", ed.tit);
    if (hw.hasPropPitch)
        APPEND_EVENT_FIELD(",\"prop\":%d", (int)(ed.propPitchDemand * 100.0f + 0.5f));
    if (hw.hasAfterburner)
        APPEND_EVENT_FIELD(",\"ab\":%d,\"abP\":%d", (int)ed.abMode, (int)(ed.abPumpDemand * 100.0f + 0.5f));

    APPEND_EVENT_FIELD("}");
    #undef APPEND_EVENT_FIELD
    _append(buf);
}

void FlightRecorder::logBoot() {
    // Include EFUSE chip ID so logs from different boards can be correlated.
    uint64_t chipId = ESP.getEfuseMac();
    char chipHex[17];
    snprintf(chipHex, sizeof(chipHex), "%04X%08X",
             (unsigned)((chipId >> 32) & 0xFFFF),
             (unsigned)(chipId & 0xFFFFFFFF));
    char safeProfile[64];
    jsonSafeCopy(safeProfile, sizeof(safeProfile), HardwareConfig::profileId);
    char buf[160];
    snprintf(buf, sizeof(buf),
        "{\"t\":%lu,\"bc\":%lu,\"ev\":\"BOOT\",\"profile\":\"%s\",\"chip\":\"%s\"}",
        _uptimeSec(), (unsigned long)EngineData::instance().bootCount,
        safeProfile, chipHex);
    _append(buf);
}

void FlightRecorder::logStartAttempt() {
    auto& ed = EngineData::instance();
    char buf[128];
    snprintf(buf, sizeof(buf),
        "{\"t\":%lu,\"ev\":\"START_ATTEMPT\",\"n1Rpm\":%.0f,\"oilBar\":%.2f,\"totDegC\":%.1f}",
        _uptimeSec(), ed.n1Rpm, ed.oilPressure, ed.tot);
    _append(buf);
}

void FlightRecorder::logBlockEnter(const char* blockName) {
    char safeBlock[48];
    jsonSafeCopy(safeBlock, sizeof(safeBlock), blockName);
    char buf[96];
    snprintf(buf, sizeof(buf), "{\"t\":%lu,\"ev\":\"BLOCK_ENTER\",\"block\":\"%s\"}",
        _uptimeSec(), safeBlock);
    _append(buf);
}

void FlightRecorder::logBlockExit(const char* blockName, const char* result) {
    char safeBlock[48];
    char safeResult[40];
    jsonSafeCopy(safeBlock, sizeof(safeBlock), blockName);
    jsonSafeCopy(safeResult, sizeof(safeResult), result);
    char buf[96];
    snprintf(buf, sizeof(buf), "{\"t\":%lu,\"ev\":\"BLOCK_EXIT\",\"block\":\"%s\",\"res\":\"%s\"}",
        _uptimeSec(), safeBlock, safeResult);
    _append(buf);
}

void FlightRecorder::logRunningEntry() {
    // Reset run-peak accumulators for the new run
    _runMaxN1    = 0.0f;
    s_runMaxN2   = 0.0f;
    _runMaxTot   = 0.0f;
    _runMaxTit   = 0.0f;
    _runMinOil   = 9999.0f;
    _runStartSec = _uptimeSec();

    auto& ed = EngineData::instance();
    char buf[128];
    snprintf(buf, sizeof(buf),
        "{\"t\":%lu,\"ev\":\"RUNNING_ENTRY\",\"n1Rpm\":%.0f,\"oilBar\":%.2f,\"totDegC\":%.1f}",
        _uptimeSec(), ed.n1Rpm, ed.oilPressure, ed.tot);
    _append(buf);
}

void FlightRecorder::logFault(const char* code) {
    auto& ed = EngineData::instance();
    // Truncate faultDescription to 120 chars to keep the record within the
    // 500-byte snprintf buffer without risking overflow.
    char desc[121];
    jsonSafeCopy(desc, sizeof(desc), ed.faultDescription);
    char safeCode[48];
    jsonSafeCopy(safeCode, sizeof(safeCode), code);
    char buf[500];
    snprintf(buf, sizeof(buf),
        "{\"t\":%lu,\"ev\":\"FAULT\",\"code\":\"%s\","
        "\"n1Rpm\":%.0f,\"totDegC\":%.1f,\"titDegC\":%.1f,"
        "\"oilBar\":%.2f,\"oilTempC\":%.1f,\"fuelBar\":%.2f,\"battV\":%.2f,"
        "\"desc\":\"%s\"}",
        _uptimeSec(), safeCode,
        ed.n1Rpm, ed.tot, ed.tit,
        ed.oilPressure, ed.oilTemp, ed.fuelPressure, ed.battVoltage,
        desc);
    _append(buf);
}

void FlightRecorder::logRunSummary() {
    // Skip if logRunningEntry() was never called this boot (engine faulted before RUNNING)
    if (_runStartSec == 0) return;

    uint32_t runS = _uptimeSec() - _runStartSec;
    char buf[220];
    int n = snprintf(buf, sizeof(buf),
        "{\"t\":%lu,\"ev\":\"RUN_SUMMARY\",\"runS\":%lu,\"maxN1\":%.0f,\"maxTot\":%.0f",
        _uptimeSec(), (unsigned long)runS, _runMaxN1, _runMaxTot);

    #define APPEND_SUMMARY_FIELD(...) do { \
        if (n >= 0 && n < (int)sizeof(buf)) { \
            int wrote = snprintf(buf + n, sizeof(buf) - (size_t)n, __VA_ARGS__); \
            if (wrote < 0) { \
                n = (int)sizeof(buf) - 1; \
            } else { \
                n += wrote; \
                if (n >= (int)sizeof(buf)) n = (int)sizeof(buf) - 1; \
            } \
        } \
    } while (0)

    if (HardwareConfig::hasTit)
        APPEND_SUMMARY_FIELD(",\"maxTit\":%.0f", _runMaxTit);
    if (HardwareConfig::hasTwoShaft && HardwareConfig::hasN2Rpm)
        APPEND_SUMMARY_FIELD(",\"maxN2\":%.0f", s_runMaxN2);
    if (_runMinOil < 9000.0f)
        APPEND_SUMMARY_FIELD(",\"minOil\":%.2f", _runMinOil);
    APPEND_SUMMARY_FIELD("}");
    #undef APPEND_SUMMARY_FIELD
    _append(buf);
    _runStartSec = 0;   // prevent duplicate summary if shutdown handlers chain
}

void FlightRecorder::logNormalShutdown() {
    logRunSummary();
    char buf[64];
    snprintf(buf, sizeof(buf), "{\"t\":%lu,\"ev\":\"NORMAL_SHUTDOWN\"}", _uptimeSec());
    _append(buf);
}

void FlightRecorder::logFaultShutdown(const char* code) {
    logRunSummary();
    char safeCode[48];
    jsonSafeCopy(safeCode, sizeof(safeCode), code);
    char buf[96];
    snprintf(buf, sizeof(buf), "{\"t\":%lu,\"ev\":\"FAULT_SHUTDOWN\",\"code\":\"%s\"}", _uptimeSec(), safeCode);
    _append(buf);
}

void FlightRecorder::logAbort(const char* blockName, const char* reason) {
    char safeBlock[48];
    char safeReason[64];
    jsonSafeCopy(safeBlock, sizeof(safeBlock), blockName);
    jsonSafeCopy(safeReason, sizeof(safeReason), reason);
    char buf[128];
    snprintf(buf, sizeof(buf),
        "{\"t\":%lu,\"ev\":\"ABORT\",\"block\":\"%s\",\"reason\":\"%s\"}",
        _uptimeSec(), safeBlock, safeReason);
    _append(buf);
}

void FlightRecorder::logConfigChange(const char* field, float oldVal, float newVal) {
    char safeField[64];
    jsonSafeCopy(safeField, sizeof(safeField), field);
    char buf[128];
    snprintf(buf, sizeof(buf),
        "{\"t\":%lu,\"ev\":\"CONFIG_CHANGE\",\"field\":\"%s\",\"old\":%.4f,\"new\":%.4f}",
        _uptimeSec(), safeField, oldVal, newVal);
    _append(buf);
}

void FlightRecorder::logRelight(uint8_t attemptNum) {
    auto& ed = EngineData::instance();
    char buf[160];
    snprintf(buf, sizeof(buf),
        "{\"t\":%lu,\"ev\":\"RELIGHT_ATTEMPT\",\"attempt\":%u,"
        "\"n1Rpm\":%.0f,\"totDegC\":%.1f,\"oilBar\":%.2f}",
        _uptimeSec(), (unsigned)attemptNum, ed.n1Rpm, ed.tot, ed.oilPressure);
    _append(buf);
}

int FlightRecorder::recordCount() {
    return s_lineCount < 0 ? 0 : s_lineCount;
}

uint32_t FlightRecorder::droppedEvents() {
    return s_droppedEvents;
}

void FlightRecorder::clear() {
    if (_mutex) xSemaphoreTake(_mutex, portMAX_DELAY);
    LittleFS.remove(PATH);
    s_lineCount = 0;
    if (_mutex) xSemaphoreGive(_mutex);
}

void FlightRecorder::requestClear() {
    s_clearPending = true;
}

size_t FlightRecorder::toJson(char* buf, size_t len) {
    if (len < 4) return 0;

    // Take mutex so we don't read while runEviction() is mid-eviction (remove+rename).
    if (_mutex) xSemaphoreTake(_mutex, portMAX_DELAY);

    File f = LittleFS.open(PATH, "r");
    if (!f || f.size() == 0) {
        if (f) f.close();
        if (_mutex) xSemaphoreGive(_mutex);
        buf[0]='['; buf[1]=']'; buf[2]=0;
        return 2;
    }

    size_t pos = 0;
    buf[pos++] = '[';
    bool first = true;

    while (f.available() && pos < len - 8) {
        String line = f.readStringUntil('\n');
        line.trim();
        if (line.length() == 0 || line[0] != '{') continue;
        if (!first) { buf[pos++] = ','; }
        first = false;
        size_t ll = line.length();
        if (pos + ll >= len - 4) break;   // ran out of space
        memcpy(buf + pos, line.c_str(), ll);
        pos += ll;
    }

    buf[pos++] = ']';
    buf[pos]   = 0;
    f.close();
    if (_mutex) xSemaphoreGive(_mutex);
    return pos;
}

void FlightRecorder::lockLog() {
    if (_mutex) xSemaphoreTake(_mutex, portMAX_DELAY);
}

void FlightRecorder::unlockLog() {
    if (_mutex) xSemaphoreGive(_mutex);
}

void FlightRecorder::beginRawDownload() {
    if (_mutex) xSemaphoreTake(_mutex, portMAX_DELAY);
    s_activeRawDownloads = s_activeRawDownloads + 1;
    if (_mutex) xSemaphoreGive(_mutex);
}

void FlightRecorder::endRawDownload() {
    if (_mutex) xSemaphoreTake(_mutex, portMAX_DELAY);
    if (s_activeRawDownloads > 0) s_activeRawDownloads = s_activeRawDownloads - 1;
    if (_mutex) xSemaphoreGive(_mutex);
}

// ── Core 0 drain + eviction (offloaded from ECU loop) ─────────

// Mutex held. Rewrite the log keeping only records after the first dropFirst.
// Returns the new record count, or -1 if the copy could not be completed
// (typically flash too full to hold the temporary copy).
static int _copyTailLocked(int dropFirst) {
    File fr = LittleFS.open(FlightRecorder::PATH, "r");
    File fw = LittleFS.open("/logs/events.tmp", "w");
    if (!fr || !fw) {
        if (fr) fr.close();
        if (fw) fw.close();
        LittleFS.remove("/logs/events.tmp");
        return -1;
    }
    int seen = 0;
    int kept = 0;
    bool writeOk = true;
    int yielded = 0;
    while (fr.available()) {
        String line = fr.readStringUntil('\n');
        line.trim();
        if (line.length() == 0 || line[0] != '{') continue;
        seen++;
        if (seen > dropFirst) {
            if (fw.println(line.c_str()) == 0) {
                writeOk = false;
                break;
            }
            kept++;
        }
        if (++yielded >= 32) {
            yielded = 0;
            delay(0);
        }
    }
    fr.close();
    fw.close();
    if (!writeOk) {
        LittleFS.remove("/logs/events.tmp");
        return -1;
    }
    LittleFS.remove("/logs/events.bak");
    bool hadOriginal = LittleFS.exists(FlightRecorder::PATH);
    if (hadOriginal && !LittleFS.rename(FlightRecorder::PATH, "/logs/events.bak")) {
        LittleFS.remove("/logs/events.tmp");
        return -1;
    }
    if (!LittleFS.rename("/logs/events.tmp", FlightRecorder::PATH)) {
        const bool restored = !hadOriginal ||
            LittleFS.rename("/logs/events.bak", FlightRecorder::PATH);
        LittleFS.remove("/logs/events.tmp");
        if (!restored) {
            // begin() will retry this recovery on the next boot.
            Serial.println("[FlightRecorder] rollback failed; preserving events.bak");
        }
        return -1;
    }
    if (hadOriginal) LittleFS.remove("/logs/events.bak");
    return kept;
}

// Mutex held. Make room when the log is full. Tries the normal keep-newest-80%
// eviction first; if flash is too full for that copy (~190 KB), falls back to
// keeping only the newest 10%, and as a last resort starts a fresh log — the
// black box must keep accepting FAULT events rather than dropping them forever.
static void _makeRoomLocked() {
    int before = s_lineCount;
    int kept = _copyTailLocked(FlightRecorder::MAX_RECORDS / 5);
    bool fallback = false;
    if (kept < 0) {
        fallback = true;
        int dropFirst = before - FlightRecorder::MAX_RECORDS / 10;
        if (dropFirst < 0) dropFirst = 0;
        kept = _copyTailLocked(dropFirst);
    }
    if (kept < 0) {
        LittleFS.remove(FlightRecorder::PATH);
        kept = 0;
    }
    s_lineCount = kept;
    if (fallback) {
        // Leave a visible trace that history was cut harder than usual.
        File fa = LittleFS.open(FlightRecorder::PATH, "a");
        if (fa) {
            char buf[96];
            snprintf(buf, sizeof(buf),
                "{\"t\":%lu,\"ev\":\"LOG_TRUNCATED\",\"kept\":%d}",
                (unsigned long)(millis() / 1000), kept);
            if (fa.println(buf) != 0) s_lineCount++;
            fa.close();
        }
    }
}

// Mutex held. Write queued events (and any pending drop marker) to flash.
static void _drainRingLocked() {
    // Lazy-init: count existing lines on first drain after boot
    if (s_lineCount < 0) {
        s_lineCount = 0;
        File fc = LittleFS.open(FlightRecorder::PATH, "r");
        if (fc) {
            int yielded = 0;
            while (fc.available()) {
                String line = fc.readStringUntil('\n');
                line.trim();
                if (line.length() > 0 && line[0] == '{') s_lineCount++;
                if (++yielded >= 64) {
                    yielded = 0;
                    delay(0);
                }
            }
            fc.close();
        }
    }

    while (s_ringTail != s_ringHead || s_droppedEvents != s_droppedMarked) {
        if (s_lineCount >= FlightRecorder::MAX_RECORDS) _makeRoomLocked();

        File fa = LittleFS.open(FlightRecorder::PATH, "a");
        if (!fa) return;   // FS unusable — leave events queued, retry next tick

        // Record a marker for events dropped while the ring was full, so gaps
        // in the black box are never silent. Snapshot the counter: Core 1 may
        // increment it while we write.
        uint32_t dropped = s_droppedEvents;
        if (dropped != s_droppedMarked) {
            char marker[80];
            snprintf(marker, sizeof(marker),
                "{\"t\":%lu,\"ev\":\"EVENTS_DROPPED\",\"n\":%lu}",
                (unsigned long)(millis() / 1000),
                (unsigned long)(dropped - s_droppedMarked));
            if (fa.println(marker) == 0) { fa.close(); return; }   // retry next tick
            s_droppedMarked = dropped;
            s_lineCount++;
        }

        int writtenSinceYield = 0;
        while (s_ringTail != s_ringHead && s_lineCount < FlightRecorder::MAX_RECORDS) {
            if (fa.println(s_ring[s_ringTail]) == 0) {
                fa.close();
                return;   // write failed (flash full?) — keep event, retry next tick
            }
            s_lineCount++;
            s_ringTail = (uint8_t)((s_ringTail + 1) % RING_SLOTS);
            if (++writtenSinceYield >= 4) {
                writtenSinceYield = 0;
                delay(0);
            }
        }
        fa.close();
    }
}

void FlightRecorder::runEviction() {
    if (s_activeRawDownloads > 0) return;
    bool ringPending = (s_ringTail != s_ringHead) || (s_droppedEvents != s_droppedMarked);
    if (!s_clearPending && !ringPending) return;

    // portMAX_DELAY is safe — this runs on Core 0 (web task), not the ECU loop.
    if (_mutex && xSemaphoreTake(_mutex, portMAX_DELAY) != pdTRUE) return;
    if (s_activeRawDownloads > 0) {
        if (_mutex) xSemaphoreGive(_mutex);
        return;
    }

    portENTER_CRITICAL(&s_ringMux);
    s_drainActive = true;
    portEXIT_CRITICAL(&s_ringMux);

    if (s_clearPending) {
        LittleFS.remove(PATH);
        s_lineCount = 0;
        s_clearPending = false;
    }

    _drainRingLocked();
    portENTER_CRITICAL(&s_ringMux);
    s_drainActive = false;
    portEXIT_CRITICAL(&s_ringMux);
    if (_mutex) xSemaphoreGive(_mutex);
}

// ── Private ───────────────────────────────────────────────────

void FlightRecorder::_append(const char* eventJson) {
    // Queue only — no LittleFS access here. Flash writes happen on Core 0 in
    // runEviction(), and only after the ECU reaches STANDBY/FAULT. A flash
    // program/erase suspends both cores and can otherwise delay safety checks.
    // Multiple producers reach this (Core 1 ECU loop, Core-0 config-change /
    // load-warning logging), so slot claim + copy + head advance must be
    // atomic. The bounded <500-byte copy keeps the critical section a few µs.
    portENTER_CRITICAL(&s_ringMux);
    uint8_t head = s_ringHead;
    uint8_t next = (uint8_t)((head + 1) % RING_SLOTS);
    if (next == s_ringTail) {
        // Preserve newest evidence while persistence is paused. If Core 0 has
        // already started draining, leave the consumer-owned tail untouched
        // and drop this new record instead.
        s_droppedEvents = s_droppedEvents + 1;
        if (s_drainActive) {
            portEXIT_CRITICAL(&s_ringMux);
            return;
        }
        s_ringTail = (uint8_t)((s_ringTail + 1) % RING_SLOTS);
    }
    strncpy(s_ring[head], eventJson, RING_SLOT_LEN - 1);
    s_ring[head][RING_SLOT_LEN - 1] = '\0';
    s_ringHead = next;
    portEXIT_CRITICAL(&s_ringMux);
}

uint32_t FlightRecorder::_uptimeSec() {
    return (uint32_t)(millis() / 1000);
}
