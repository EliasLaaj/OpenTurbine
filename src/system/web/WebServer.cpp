#include "WebServer.h"
#include "../../hal/i2c/I2CDeviceManager.h"
#include "hardware_profile.h"
#include "../version.h"
#include "../Config.h"
#include "../HardwareConfig.h"
#include "../HardwareCapabilities.h"
#include "../ConfigApplyGate.h"
#include "../FeedbackRequirements.h"
#include "../pcb/PcbProfileManager.h"
#include "../OutputActivity.h"
#include "../FlightRecorder.h"
#include "../SessionLogger.h"
#include "../SessionFiles.h"
#include "../../engine/EngineData.h"
#include "../../hal/sensors/AnalogSensor.h"

// Forward-declare the specific sensor globals needed for raw-ADC telemetry.
// Defined in main.cpp via OT_DECLARE_HARDWARE — including Hardware.h here would
// drag in every sequencer/controller header and cause ODR violations.
extern AnalogLinearSensor g_sensorP1;
extern AnalogLinearSensor g_sensorP2;
extern AnalogLinearSensor g_sensorBattVolt;
extern AnalogLinearSensor g_sensorGlowCurrent;
extern AnalogLinearSensor g_sensorIgniterCurrent;
extern AnalogLinearSensor g_sensorIgniter2Current;
extern AnalogLinearSensor g_sensorOilPumpCurrent;
extern AnalogLinearSensor g_sensorFuelFlow;
#include <ESPAsyncWebServer.h>
#include <AsyncJson.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_heap_caps.h>
#include <esp_app_desc.h>
#include <ESPmDNS.h>
#include <DNSServer.h>
#include <Arduino.h>
#include <Update.h>
#include <mbedtls/sha256.h>
#include <new>

static volatile bool _otaPendingRestart      = false;
static volatile bool _otaInProgress          = false;
static bool          _otaError               = false;
static AsyncWebServerRequest* _otaUploadOwner = nullptr;
static unsigned long _otaUploadLastMs        = 0;
static volatile bool _assetUploadInProgress  = false;
static bool          _assetUploadError       = false;
static AsyncWebServerRequest* _assetUploadOwner = nullptr;
static File          _assetTempFile;
static uint16_t      _assetUploadMask        = 0;
static unsigned long _assetUploadLastMs      = 0;
static bool          _webAssetsComplete      = false;
static AsyncWebServerRequest* _configRestoreOwner = nullptr;
static File          _configRestoreFile;
static bool          _configRestoreError     = false;
static unsigned long _configRestoreLastMs    = 0;
static volatile bool _hwRebootPending        = false;
static unsigned long _hwRebootScheduledMs    = 0;
static char _pendingRestartBlocker[80] = {};
static const char*   _pendingRestartReason   = nullptr;

// ── WebSocket telemetry state ─────────────────────────────────
// _wsPendingResponse: set when a "p" arrived but canSend() was false.
// tick() detects this and sends a WS PING; the PONG fires WS_EVT_PONG
// inside the async_tcp task (correct context), which then delivers the
// queued telemetry frame without waiting for another "p" from the client.
static volatile bool _wsPendingResponse = false;
static unsigned long _wsPingMs          = 0;   // last ping timestamp
static AsyncWebSocketClient* s_activeWsClient = nullptr;
// Keep capacity while one page is live, then release it so configuration
// validation can reclaim the largest contiguous heap block.
static JsonDocument s_wsTelemetryDoc;
static JsonDocument s_restTelemetryDoc;

static void _releaseLiveTelemetryTransport() {
    if (s_activeWsClient) {
        AsyncClient* telemetry = s_activeWsClient->client();
        s_activeWsClient = nullptr;
        if (telemetry) telemetry->abort();
    }
    _wsPendingResponse = false;
    s_wsTelemetryDoc.clear();
    s_wsTelemetryDoc.shrinkToFit();
    s_restTelemetryDoc.clear();
    s_restTelemetryDoc.shrinkToFit();
}

// LittleFS usage stats — cached by tick() every 10 s so _buildTelemetry
// is never called with a blocking filesystem operation while running inside
// the async_tcp task (would cause priority-inversion against webTask writes).
static uint32_t      s_fsTotal = 0;
static uint32_t      s_fsUsed  = 0;
static constexpr const char* FACTORY_CONFIG_PATH = "/factory_config.json";

static bool _keyInList(const char* key, const char* const* allowed, size_t count) {
    for (size_t i = 0; i < count; ++i) if (!strcmp(key, allowed[i])) return true;
    return false;
}

static bool _runtimeTuningPatchAllowed(JsonObjectConst patch) {
    static const char* const throttleKeys[] = {"ramp_up_ms", "ramp_down_ms"};
    static const char* const governorKeys[] = {
        "target_rpm", "band_rpm", "kp", "pitch_kp", "pitch_ramp_sec"
    };
    static const char* const idleKeys[] = {
        "target_rpm", "target_pressure_bar", "ramp_up_ms", "ramp_down_ms",
        "deadband_rpm", "rpm_limit", "pressure_deadband_bar", "pressure_limit_bar",
        "max_multiplier", "i_gain", "i_max", "decel_enter_rpm", "decel_drop_pct",
        "lookahead_ms", "settle_band_rpm", "full_response_rpm", "trim_up_pct_s",
        "trim_down_pct_s", "learn_rate", "learn_accel_max",
        "pressure_decel_enter_bar", "pressure_settle_band_bar",
        "pressure_full_response_bar", "pressure_learn_rate_max_bar_s"
    };
    for (JsonPairConst section : patch) {
        const char* name = section.key().c_str();
        if (!section.value().is<JsonObjectConst>()) return false;
        const char* const* keys = nullptr;
        size_t count = 0;
        if (!strcmp(name, "throttle")) {
            keys = throttleKeys; count = sizeof(throttleKeys) / sizeof(throttleKeys[0]);
        } else if (!strcmp(name, "governor")) {
            keys = governorKeys; count = sizeof(governorKeys) / sizeof(governorKeys[0]);
        } else if (!strcmp(name, "dynamic_idle")) {
            keys = idleKeys; count = sizeof(idleKeys) / sizeof(idleKeys[0]);
        } else return false;
        for (JsonPairConst value : section.value().as<JsonObjectConst>())
            if (!_keyInList(value.key().c_str(), keys, count) || value.value().is<JsonObjectConst>() || value.value().is<JsonArrayConst>())
                return false;
    }
    return patch.size() > 0;
}

static bool _runtimeGovernorAuthorityPreserved(JsonObjectConst patch) {
    JsonVariantConst requested = patch["governor"]["pitch_kp"];
    if (requested.isNull()) return true;
    const auto& hw = HardwareConfig::instance();
    const bool twoPositionPitch = hw.hasPropPitch && hw.propPitchType == 2;
    const bool oldUsesPitch = hw.hasPropPitch &&
                              (twoPositionPitch || Config::governorPitchKp > 0.0f);
    const bool newUsesPitch = hw.hasPropPitch &&
                              (twoPositionPitch || requested.as<float>() > 0.0f);
    return oldUsesPitch == newUsesPitch;
}

// Shared buffers. Body handlers hold g_webRxOwner across all chunks so concurrent
// uploads cannot corrupt one another while RAM use remains bounded. Reserve them
// once before Wi-Fi starts to keep web-only workspace out of the Classic ESP32's
// small statically linkable DRAM region, without per-request heap allocation.
// Array-reference aliases retain the existing compile-time sizeof bounds.
#if defined(CONFIG_IDF_TARGET_ESP32S3)
// S3 registry capacity is 24 inputs. A legal all-analog layout with six-point
// calibration tables can exceed 16 KiB on upload. Keep that receive capacity,
// but do not permanently reserve the same oversized transmit buffer: ordinary
// API documents fit 16 KiB and GET /api/hardware already has a chunked
// ArduinoJson fallback for exceptional legal profiles. The recovered 8 KiB is
// internal DRAM needed by Wi-Fi/AsyncTCP after long navigation and HIL runs.
using WebRxBuffer = char[24576];
using WebTxBuffer = char[16384];
#else
using WebRxBuffer = char[16384];
// Classic's legal upload envelope still needs 16 KiB, but its ordinary API
// documents fit 12 KiB. Oversized Hardware GETs already use the chunked JSON
// fallback. Returning this 4 KiB to internal DRAM keeps a valid hardware POST
// parseable after normal navigation/config activity instead of making success
// depend on a freshly rebooted heap.
using WebTxBuffer = char[12288];
#endif
static WebRxBuffer* g_webRxStorage = nullptr;
static WebTxBuffer* g_webTxStorage = nullptr;
#define g_webRxBuf (*g_webRxStorage)
#define g_webTxBuf (*g_webTxStorage)
static size_t g_webRxLen     = 0;
static bool   g_webRxOverflow = false;
static AsyncWebServerRequest* g_webRxOwner = nullptr;
static unsigned long g_webRxClaimMs = 0;
// A large read-only response may borrow this otherwise-idle request buffer.
// Do not let the normal stale-upload timeout reclaim it mid-response.
static bool g_webRxResponseLease = false;
static portMUX_TYPE s_webRxMux = portMUX_INITIALIZER_UNLOCKED;

// Flash-backed log responses are intentionally single-reader. Several clients
// building heap-backed history responses at once can exhaust async_tcp buffers
// and trip the web-task watchdog. Telemetry remains fully multi-client.
static portMUX_TYPE s_logReadMux = portMUX_INITIALIZER_UNLOCKED;
static AsyncWebServerRequest* s_logReadOwner = nullptr;
static unsigned long s_logReadClaimMs = 0;

static bool _claimLogRead(AsyncWebServerRequest* req) {
    bool claimed = false;
    portENTER_CRITICAL(&s_logReadMux);
    if (!s_logReadOwner || millis() - s_logReadClaimMs > 30000UL) {
        s_logReadOwner = req;
        s_logReadClaimMs = millis();
        claimed = true;
    }
    portEXIT_CRITICAL(&s_logReadMux);
    return claimed;
}

static void _releaseLogRead(AsyncWebServerRequest* req) {
    portENTER_CRITICAL(&s_logReadMux);
    if (s_logReadOwner == req) s_logReadOwner = nullptr;
    portEXIT_CRITICAL(&s_logReadMux);
}

static bool _gateLogRead(AsyncWebServerRequest* req) {
    if (_claimLogRead(req)) return true;
    req->send(429, "application/json",
        "{\"error\":\"Another log view or download is in progress; retry shortly\"}");
    return false;
}

static void _printCsvField(Print& out, const char* value) {
    const char* p = value ? value : "";
    out.print('"');
    if (*p == '=' || *p == '+' || *p == '-' || *p == '@') out.print('\'');
    for (; *p; ++p) {
        if (*p == '"') out.print("\"\"");
        else if (*p == '\r' || *p == '\n') out.print(' ');
        else out.print(*p);
    }
    out.print('"');
}

static void _mergeJsonObject(JsonObject dst, JsonObjectConst patch) {
    for (JsonPairConst kv : patch) {
        JsonVariantConst src = kv.value();
        if (src.is<JsonObjectConst>()) {
            JsonVariant nestedVariant = dst[kv.key()];
            JsonObject nested = nestedVariant.is<JsonObject>()
                ? nestedVariant.as<JsonObject>()
                : nestedVariant.to<JsonObject>();
            _mergeJsonObject(nested, src.as<JsonObjectConst>());
        } else if (src.is<JsonArrayConst>()) {
            // Arrays are replacement values, including an explicitly empty
            // array. Assigning a collection variant over an existing array can
            // retain the old collection in ArduinoJson; remove the destination
            // member first so PATCH {"rules":[]} reliably clears all rules.
            dst.remove(kv.key());
            dst[kv.key()].set(src);
        } else {
            dst[kv.key()] = src;
        }
    }
}

static bool _claimWebRx(AsyncWebServerRequest* req, size_t index) {
    bool claimed = false;
    portENTER_CRITICAL(&s_webRxMux);
    if (index == 0) {
        // A client can disappear after the response acquires the shared
        // buffer but before AsyncWebServer calls its final fill/destructor.
        // Never let that abandoned response lease deadlock every later JSON
        // request indefinitely. Ten seconds is far longer than a 16 KiB local
        // AP transfer, while the owner check in _releaseWebRx() prevents a
        // late destructor from releasing a newer claimant.
        if (g_webRxOwner && (millis() - g_webRxClaimMs) < 10000) {
            portEXIT_CRITICAL(&s_webRxMux);
            req->send(409, "application/json",
                      "{\"error\":\"Another configuration transfer is in progress\"}");
            return false;
        }
        g_webRxOwner = req;
        g_webRxClaimMs = millis();
        g_webRxLen = 0;
        g_webRxOverflow = false;
        g_webRxResponseLease = false;
    }
    claimed = g_webRxOwner == req;
    portEXIT_CRITICAL(&s_webRxMux);
    return claimed;
}

static bool _appendWebRx(AsyncWebServerRequest* req, const uint8_t* data,
                         size_t len, size_t index) {
    if (!_claimWebRx(req, index)) return false;
    portENTER_CRITICAL(&s_webRxMux);
    if (g_webRxLen + len < sizeof(g_webRxBuf)) {
        memcpy(g_webRxBuf + g_webRxLen, data, len);
        g_webRxLen += len;
    } else {
        g_webRxOverflow = true;
    }
    g_webRxClaimMs = millis();
    portEXIT_CRITICAL(&s_webRxMux);
    return true;
}

static void _releaseWebRx(AsyncWebServerRequest* req) {
    portENTER_CRITICAL(&s_webRxMux);
    if (g_webRxOwner == req) {
        g_webRxOwner = nullptr;
        g_webRxResponseLease = false;
    }
    portEXIT_CRITICAL(&s_webRxMux);
}

static bool _outputsActiveForOta() {
    return OutputActivity::anyPhysicalDemand(false);
}

static const char* const WEB_ASSETS[] = {
    "app.js.gz", "calibration.html.gz", "config.html.gz", "hardware.html.gz",
    "index.html.gz", "log.html.gz", "sequence.html.gz", "style.css.gz",
    "tools.html.gz", "theme.js.gz", "ui_dialog.js.gz"
};
static constexpr uint16_t WEB_ASSET_COUNT = sizeof(WEB_ASSETS) / sizeof(WEB_ASSETS[0]);
static constexpr uint16_t WEB_ASSET_ALL = (1u << WEB_ASSET_COUNT) - 1u;
static constexpr const char* WEB_ASSET_MARKER = "/.assets_complete";
static constexpr const char* WEB_ASSET_MARKER_BACKUP = "/.assets_complete.backup";

static bool _webAssetDigest(char hex[65]) {
    mbedtls_sha256_context ctx;
    mbedtls_sha256_init(&ctx);
    if (mbedtls_sha256_starts(&ctx, 0) != 0) { mbedtls_sha256_free(&ctx); return false; }
    uint8_t buffer[512];
    for (uint16_t i = 0; i < WEB_ASSET_COUNT; ++i) {
        String path = "/";
        path += WEB_ASSETS[i];
        File file = LittleFS.open(path, "r");
        if (!file || file.size() < 2) { if (file) file.close(); mbedtls_sha256_free(&ctx); return false; }
        mbedtls_sha256_update(&ctx, reinterpret_cast<const uint8_t*>(WEB_ASSETS[i]), strlen(WEB_ASSETS[i]));
        size_t read = 0;
        while ((read = file.read(buffer, sizeof(buffer))) > 0)
            mbedtls_sha256_update(&ctx, buffer, read);
        file.close();
    }
    uint8_t digest[32];
    if (mbedtls_sha256_finish(&ctx, digest) != 0) { mbedtls_sha256_free(&ctx); return false; }
    mbedtls_sha256_free(&ctx);
    for (size_t i = 0; i < sizeof(digest); ++i) snprintf(hex + i * 2, 3, "%02x", digest[i]);
    hex[64] = '\0';
    return true;
}

static bool _writeWebAssetMarker() {
    char digest[65];
    if (!_webAssetDigest(digest)) return false;
    File marker = LittleFS.open(WEB_ASSET_MARKER, "w");
    const bool ok = marker && marker.println(digest) > 0;
    if (marker) marker.close();
    return ok;
}

static bool _verifyWebAssetMarker() {
    File marker = LittleFS.open(WEB_ASSET_MARKER, "r");
    if (!marker) return false;
    String expected = marker.readStringUntil('\n');
    marker.close();
    expected.trim();
    char actual[65];
    return expected.length() == 64 && _webAssetDigest(actual) && expected.equals(actual);
}

static bool _maintenanceUploadInProgress() {
    return _otaInProgress || _assetUploadInProgress || (_configRestoreOwner != nullptr);
}

// FAULT is the boot-time config-integrity state (profile mismatch / config load
// failure): a light lockout where only START is blocked. Every other STANDBY
// gate treats FAULT as standby-like so the user can repair the ECU — mirrors
// handleCommand()'s standbyLike in main.cpp.
static bool _isStandbyLike(SysMode mode) {
    return mode == SysMode::STANDBY || mode == SysMode::FAULT;
}

static bool _awaitConfigApply(uint32_t generation, bool& succeeded) {
    const uint32_t started = millis();
    while (millis() - started < 500UL) {
        if (ConfigApplyGate::completion(generation, succeeded)) return true;
        delay(1);
    }
    return ConfigApplyGate::completion(generation, succeeded);
}

static bool _isStandbyToolCommand(OTCommand cmd) {
    switch (cmd) {
        case OTCommand::FUEL_PRIME:
        case OTCommand::OIL_PRIME:
        case OTCommand::IGN_TEST:
        case OTCommand::IGN2_TEST:
        case OTCommand::START_TEST:
        case OTCommand::PULSED_STARTER_ASSIST_TEST:
        case OTCommand::FUEL_SOL_TEST:
        case OTCommand::IDLE_TEST:
        case OTCommand::SET_OIL_DEMAND:
        case OTCommand::SET_OIL_PCT:
        case OTCommand::SET_THROTTLE_PCT:
        case OTCommand::EXTRA_COOLDOWN:
        case OTCommand::CLEAR_LOG:
        case OTCommand::OIL_SCAV_TEST:
        case OTCommand::COOL_FAN_TEST:
        case OTCommand::AIRSTARTER_TEST:
        case OTCommand::BLEED_VALVE_TEST:
        case OTCommand::GLOW_TEST:
        case OTCommand::FUEL_PUMP2_TEST:
        case OTCommand::AB_SOL_TEST:
        case OTCommand::AB_PUMP_TEST:
        case OTCommand::STARTER_EN_TEST:
        case OTCommand::PROP_PITCH_TEST:
        case OTCommand::REGISTRY_OUTPUT_TEST:
            return true;
        default:
            return false;
    }
}

static bool _startsTimedActuatorTest(const OTPacket& pkt) {
    switch (pkt.cmd) {
        case OTCommand::FUEL_PRIME:
        case OTCommand::OIL_PRIME:
        case OTCommand::IGN_TEST:
        case OTCommand::IGN2_TEST:
        case OTCommand::START_TEST:
        case OTCommand::PULSED_STARTER_ASSIST_TEST:
        case OTCommand::FUEL_SOL_TEST:
        case OTCommand::IDLE_TEST:
        case OTCommand::OIL_SCAV_TEST:
        case OTCommand::COOL_FAN_TEST:
        case OTCommand::AIRSTARTER_TEST:
        case OTCommand::BLEED_VALVE_TEST:
        case OTCommand::GLOW_TEST:
        case OTCommand::FUEL_PUMP2_TEST:
        case OTCommand::AB_SOL_TEST:
        case OTCommand::AB_PUMP_TEST:
        case OTCommand::STARTER_EN_TEST:
        case OTCommand::PROP_PITCH_TEST:
        case OTCommand::REGISTRY_OUTPUT_TEST:
            return true;
        case OTCommand::EXTRA_COOLDOWN:
            return pkt.iParam > 0;
        default:
            return false;
    }
}

static const char* _missingHardwareForCommand(const OTPacket& pkt) {
    switch (pkt.cmd) {
        case OTCommand::FUEL_PRIME:
        case OTCommand::FUEL_SOL_TEST: return HardwareConfig::hasFuelSol ? nullptr : "Fuel solenoid is not configured";
        case OTCommand::OIL_PRIME:
        case OTCommand::SET_OIL_PCT:
        case OTCommand::SET_OIL_DEMAND: return HardwareConfig::hasOilPump ? nullptr : "Oil pump is not configured";
        case OTCommand::SET_THROTTLE_PCT: return HardwareConfig::hasThrottle ? nullptr : "Throttle output is not configured";
        case OTCommand::IGN_TEST: return HardwareConfig::hasIgniter ? nullptr : "Igniter 1 is not configured";
        case OTCommand::IGN2_TEST: return HardwareConfig::hasIgniter2 ? nullptr : "secondary igniter is not configured";
        case OTCommand::START_TEST: return HardwareConfig::hasStarter ? nullptr : "Starter is not configured";
        case OTCommand::IDLE_TEST: return HardwareConfig::hasThrottle ? nullptr : "Throttle output is not configured";
        case OTCommand::OIL_SCAV_TEST: return HardwareConfig::hasOilScavengePump ? nullptr : "Oil scavenge pump is not configured";
        case OTCommand::COOL_FAN_TEST: return HardwareConfig::hasCoolFan ? nullptr : "Cooling fan is not configured";
        case OTCommand::AIRSTARTER_TEST: return HardwareConfig::hasAirstarterSol ? nullptr : "Airstarter solenoid is not configured";
        case OTCommand::BLEED_VALVE_TEST: return HardwareConfig::hasBleedValve ? nullptr : "Bleed valve is not configured";
        case OTCommand::GLOW_TEST: return HardwareConfig::hasGlowPlug ? nullptr : "Glow plug is not configured";
        case OTCommand::FUEL_PUMP2_TEST: return HardwareConfig::hasFuelPump2 ? nullptr : "Secondary / auxiliary fuel pump is not configured";
        case OTCommand::AB_SOL_TEST:
            return (HardwareConfig::hasAfterburner && HardwareConfig::hasAbSol) ? nullptr : "Afterburner solenoid is not configured";
        case OTCommand::AB_PUMP_TEST:
            return (HardwareConfig::hasAfterburner && HardwareConfig::hasAbPump) ? nullptr : "Afterburner pump is not configured";
        case OTCommand::STARTER_EN_TEST: return HardwareConfig::hasStarterEn ? nullptr : "Starter enable output is not configured";
        case OTCommand::PROP_PITCH_TEST: return HardwareConfig::hasPropPitch ? nullptr : "Prop pitch actuator is not configured";
        case OTCommand::REGISTRY_OUTPUT_TEST: {
            if (pkt.iParam < 0 || pkt.iParam >= HardwareConfig::channelRegistry.outputCount)
                return "Registry output is not configured";
            const auto& c = HardwareConfig::channelRegistry.outputs[pkt.iParam];
            const bool physicalEndpoint =
                c.driver == ChannelRegistry::I2cRelay
                    ? I2CDeviceManager::channelAvailable(c)
                    : c.pin >= 0;
            if (!c.installed || !physicalEndpoint ||
                HardwareConfig::channelRegistry.ownsCoreOutput(c) ||
                HardwareConfig::channelRegistry.boundToCoreOutput(c))
                return "Registry output is not testable";
            return nullptr;
        }
        case OTCommand::TOGGLE_DYNAMIC_IDLE:
            return HardwareConfig::hasDynamicIdle ? nullptr : "Dynamic Idle is not enabled in hardware";
        case OTCommand::TOGGLE_LIMP_MODE:
            return HardwareConfig::hasThrottle ? nullptr : "Limp Mode requires a throttle output";
        case OTCommand::PULSED_STARTER_ASSIST_TEST:
            return (Config::starterAssistEnabled && HardwareConfig::hasStarter &&
                    HardwareConfig::starterType != 2 && HardwareConfig::hasN1Rpm)
                ? nullptr : "Pulsed Starter Assist requires its Config enable, a proportional starter, and N1 feedback";
        case OTCommand::AB_FIRE:
        case OTCommand::AB_STOP:
            return HardwareConfig::hasAfterburner ? nullptr : "Afterburner is not configured";
        default:
            return nullptr;
    }
}

static const char* _commandPreflightRejectReason(const OTPacket& pkt) {
    const auto& ed = EngineData::instance();
    // tick() will call ESP.restart() unconditionally once the window elapses —
    // never begin a new actuator action that a reboot would interrupt mid-stream.
    // AB_STOP stays allowed: it only de-energizes outputs.
    if (_hwRebootPending && pkt.cmd != OTCommand::AB_STOP) {
        return "ECU is rebooting to apply a saved configuration. Reconnect and retry.";
    }
    if (const char* hw = _missingHardwareForCommand(pkt)) return hw;
    if (_isStandbyToolCommand(pkt.cmd) && !_isStandbyLike(ed.mode)) {
        return "Command is only available in STANDBY or FAULT";
    }
    if (_startsTimedActuatorTest(pkt) && _outputsActiveForOta()) {
        return "Another actuator output is already active";
    }
    if (pkt.cmd == OTCommand::EXTRA_COOLDOWN && pkt.iParam > 0) {
        const bool ecUseStarter = HardwareConfig::hasStarter && Config::cooldownUseStarter;
        const bool ecUseOil = HardwareConfig::hasOilPump && Config::cooldownUseOilPump;
        const bool ecUseScavenge = HardwareConfig::hasOilScavengePump && Config::cooldownUseScavengePump;
        if (!ecUseStarter && !ecUseOil && !ecUseScavenge) {
            return "No fitted cooldown actuator is enabled";
        }
    }
    if (pkt.cmd == OTCommand::TOGGLE_DEV_MODE && !_isStandbyLike(ed.mode)) {
        return "Developer Mode can only be changed in STANDBY or FAULT";
    }
    if (pkt.cmd == OTCommand::TOGGLE_BENCH_MODE) {
        if (!_isStandbyLike(ed.mode)) return "Bench Mode can only be changed in STANDBY or FAULT";
        if (!ed.devMode) return "Enable Developer Mode before Bench Mode";
    }
    if (pkt.cmd == OTCommand::TOGGLE_SAFETY_CHECKS) {
        if (!_isStandbyLike(ed.mode)) return "Safety bypass can only be changed in STANDBY or FAULT";
        if (!ed.devMode || !ed.benchMode) return "Enable Developer Mode and Bench Mode before safety bypass";
    }
    if ((pkt.cmd == OTCommand::TOGGLE_DYNAMIC_IDLE || pkt.cmd == OTCommand::TOGGLE_LIMP_MODE)
        && !(_isStandbyLike(ed.mode) || ed.mode == SysMode::RUNNING)) {
        return "Command is only available in STANDBY or RUNNING";
    }
    if (pkt.cmd == OTCommand::AB_FIRE) {
        if (ed.mode != SysMode::RUNNING) return "Afterburner can only be fired while RUNNING";
        if (ed.limpMode)
            return "Afterburner is disabled while reduced-power mode is active";
        if (HardwareConfig::abTriggerSource != 0) {
            return "Manual FIRE is only available when AB trigger source is Manual command only";
        }
        if (HardwareConfig::abRequiresArmSwitch && !ed.abArmSwitchOn) {
            return "Afterburner arm switch is not active";
        }
        if (!HardwareConfig::hasAbSol && !HardwareConfig::hasAbPump) {
            return "Afterburner fuel output is not configured";
        }
        if (!(ed.abMode == ABMode::Off || ed.abMode == ABMode::Fault)) {
            return "Afterburner is already active or shutting down";
        }
    }
    return nullptr;
}

static bool _outputActiveBlocksStart() {
    return OutputActivity::anyPhysicalDemand(true);
}

static bool _startInhibitActive() {
    const auto& ed = EngineData::instance();
    auto& hw = HardwareConfig::instance();
    for (int i = 0; i < HardwareConfig::MAX_DI; i++) {
        const char* role = hw.diCh[i].role;
        const bool safetyRole = !strcmp(role, "inhibit_start") ||
            !strcmp(role, "estop") || !strcmp(role, "fault") ||
            (hw.safetyLowOil && !strcmp(role, "low_oil_switch")) ||
            (hw.safetyOilZero && !strcmp(role, "oil_zero_switch"));
        if (hw.diCh[i].pin >= 0 && safetyRole &&
            (hw.diCh[i].activeModes & (1u << (int)SysMode::STARTUP)) && ed.diState[i]) {
            return true;
        }
    }
    for (uint8_t i = 0; i < hw.channelRegistry.inputCount; ++i) {
        const auto& channel = hw.channelRegistry.inputs[i];
        const char* role = strcmp(channel.purpose, "generic")
            ? channel.purpose : channel.role;
        const bool inhibit = !strcmp(role, "inhibit_start") ||
            !strcmp(role, "estop") || !strcmp(role, "fault") ||
            (hw.safetyLowOil && !strcmp(role, "low_oil_switch")) ||
            (hw.safetyOilZero && !strcmp(role, "oil_zero_switch"));
        // A configured safety interlock that cannot be read is not permission
        // to start. This mirrors the ECU-core final check.
        if (channel.installed && inhibit &&
            (!ed.registryInputHealthy[i] || ed.registryInputValue[i] >= 0.5f))
            return true;
    }
    return false;
}

static const char* _startPreflightRejectReason(bool allowEligibleSensorOverride = false) {
    const auto& ed = EngineData::instance();
    if (!_webAssetsComplete) {
        return "Web UI asset set is incomplete; re-upload the complete web assets or reflash the filesystem";
    }
    // A reboot scheduled by hardware save / factory reset / config restore fires
    // unconditionally in tick() — starting now would reboot mid-startup with the
    // fuel solenoid and igniter energized.
    if (_hwRebootPending) {
        return "ECU is rebooting to apply a saved configuration. Reconnect and retry.";
    }
    if (ed.mode == SysMode::FAULT) {
        return "ECU is in FAULT mode: hardware config or profile ID failed boot validation. "
               "Everything except START still works - fix and save the configuration to reboot into STANDBY.";
    }
    if (ed.mode != SysMode::STANDBY) {
        return "Engine is not in STANDBY or FAULT";
    }
    if (!Config::profileMatch || ed.configLocked) {
        return "Configuration is locked or profile ID does not match";
    }
    if (ConfigApplyGate::busy()) {
        return "Configuration update is still being applied";
    }
    if (ed.startSwitchConfigured && (!ed.startSwitchHealthy || !ed.startSwitchReady)) {
        return !ed.startSwitchHealthy
            ? "Physical START input is unavailable"
            : "Release the physical START input before starting";
    }
    if (ed.stopSwitchConfigured && !ed.stopSwitchHealthy) {
        return "Physical STOP input is unavailable; restore the required stop path before starting";
    }
    if (ed.recoveryLockout && !ed.skipSafetyChecks) {
        return "Abnormal-reset recovery is locked: release START, verify the engine is safe, then press STOP to acknowledge";
    }
    if ((!ed.hardwareReady || !ed.watchdogReady) && !ed.skipSafetyChecks) {
        return !ed.watchdogReady ? "Control-loop watchdog is not ready"
                                 : (ed.hardwareFault[0] ? ed.hardwareFault : "Configured hardware failed to initialize");
    }
    if (!ed.skipSafetyChecks && !ed.benchMode) {
        const uint32_t now = millis();
        if (!FeedbackRequirements::allRequiredStartFeedbackHealthy(ed, now) &&
            !(allowEligibleSensorOverride &&
              FeedbackRequirements::eligibleSingleStartOverride(ed, now) != FeedbackRequirements::NONE))
            return "Feedback used by configured control, safety, or startup logic is unhealthy or stale";
    }
    if (ed.stopSwitchActive) {
        return "STOP switch is active. Release STOP before pressing START.";
    }
    if (_startInhibitActive()) {
        return "A configured start/safety interlock is active or unavailable";
    }
    if (const char* feature = HardwareCapabilities::enabledFeatureRejectReason()) {
        return feature;
    }
    if (ed.extraCooldownActive) {
        return "Extra Cooldown is running. Stop it on the Tools page or wait for it to finish.";
    }
    if (_outputActiveBlocksStart()) {
        return "An actuator test or prime output is still active. Wait for Tools actions to finish.";
    }
    if (ed.seqHasStructuralErrors) {
        return "Startup sequence contains unknown or unavailable block names. Open Sequence, fix red errors, and save.";
    }
    if (ed.seqHasErrors && !ed.benchMode) {
        return "Startup sequence requires hardware that is not configured. Check Sequence, or enable Bench Mode for dry testing.";
    }
    return nullptr;
}

static void _sendCommandReject(AsyncWebServerRequest* req, int status, const char* reason) {
    snprintf(g_webTxBuf, sizeof(g_webTxBuf),
             "{\"ok\":false,\"error\":\"%s\"}", reason ? reason : "Command rejected");
    req->send(status, "application/json", g_webTxBuf);
}

static int _assetIndex(String filename) {
    int slash = max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
    if (slash >= 0) filename = filename.substring(slash + 1);
    for (uint16_t i = 0; i < WEB_ASSET_COUNT; i++) {
        if (filename == WEB_ASSETS[i]) return (int)i;
    }
    return -1;
}

static String _assetPath(uint16_t i, bool temp) {
    String path = "/";
    path += WEB_ASSETS[i];
    if (temp) path += ".upload";
    return path;
}

static String _assetBackupPath(uint16_t i) {
    String path = "/";
    path += WEB_ASSETS[i];
    path += ".backup";
    return path;
}

static void _discardAssetTemps() {
    if (_assetTempFile) _assetTempFile.close();
    for (uint16_t i = 0; i < WEB_ASSET_COUNT; i++) {
        String temp = _assetPath(i, true);
        if (LittleFS.exists(temp)) LittleFS.remove(temp);
    }
}

static void _finishAssetUpload() {
    _discardAssetTemps();
    _assetUploadOwner = nullptr;
    _assetUploadMask = 0;
    _assetUploadInProgress = false;
}

static const char* _limitedStartRejectReason() {
    const auto& ed = EngineData::instance();
    if (const char* reject = _startPreflightRejectReason(true)) return reject;
    if (FeedbackRequirements::eligibleSingleStartOverride(ed, millis()) == FeedbackRequirements::NONE)
        return "Reduced-power restart requires exactly one eligible failed sensor";
    return nullptr;
}

#if !defined(OT_PLATFORM_ESP32S3)
// Classic's 704 KiB LittleFS cannot hold both complete UI generations once
// configuration and logs are present. Install one completed upload at a time,
// retaining only that file's old copy until its replacement is in place.
static bool _installAssetRolling(uint16_t i) {
    String target = _assetPath(i, false);
    String temp = _assetPath(i, true);
    String backup = _assetBackupPath(i);
    if (LittleFS.exists(backup)) LittleFS.remove(backup);
    if (LittleFS.exists(target) && !LittleFS.rename(target, backup)) return false;
    if (!LittleFS.rename(temp, target)) {
        if (LittleFS.exists(backup)) LittleFS.rename(backup, target);
        return false;
    }
    if (LittleFS.exists(backup)) LittleFS.remove(backup);
    return true;
}
#endif

static void _recoverInterruptedAssetUpdate() {
    bool hasBackup = false;
    bool hasTemp = false;
    for (uint16_t i = 0; i < WEB_ASSET_COUNT; i++) {
        hasBackup |= LittleFS.exists(_assetBackupPath(i));
        hasTemp |= LittleFS.exists(_assetPath(i, true));
    }

    if (hasBackup && hasTemp) {
        Serial.println("[WebAssets] Interrupted swap detected - restoring previous pages");
        for (uint16_t i = 0; i < WEB_ASSET_COUNT; i++) {
            String target = _assetPath(i, false);
            String backup = _assetBackupPath(i);
            if (LittleFS.exists(backup)) {
                if (LittleFS.exists(target)) LittleFS.remove(target);
                LittleFS.rename(backup, target);
            }
        }
    } else if (hasBackup) {
        // Every staged file was installed before power was lost; discard old copies.
        Serial.println("[WebAssets] Completing installed page update cleanup");
        for (uint16_t i = 0; i < WEB_ASSET_COUNT; i++) {
            String backup = _assetBackupPath(i);
            if (LittleFS.exists(backup)) LittleFS.remove(backup);
        }
    }
    _discardAssetTemps();
}

static void _finishConfigRestore(bool discardTemp = true) {
    if (_configRestoreFile) _configRestoreFile.close();
    if (discardTemp) LittleFS.remove("/ecu_config.restore.tmp");
    LittleFS.remove("/ecu_config.section.tmp");
    LittleFS.remove("/ecu_config.settings.tmp");
    LittleFS.remove("/ecu_config.hardware.tmp");
    _configRestoreOwner = nullptr;
    _configRestoreError = false;
}

// Load one top-level object without ever holding the complete unified engine
// file and a copied section in RAM at the same time. ArduinoJson's filtered
// parse retains the top-level wrapper, so stage the selected object briefly,
// release that document, then parse the object as the destination root.
static bool _stageUnifiedConfigSection(const char* section, const char* path) {
    LittleFS.remove(path);
    File source = LittleFS.open("/ecu_config.restore.tmp", "r");
    if (!source) return false;

    // Locate a named object at depth one without building the complete selected
    // ArduinoJson tree while AsyncTCP still owns the upload buffers. This tiny
    // streaming scanner understands JSON strings and escapes, so braces or the
    // word "settings" inside labels/descriptions cannot confuse it.
    int depth = 0;
    bool inString = false;
    bool escaped = false;
    bool expectingKey = false;
    bool capturingKey = false;
    char key[24] = {};
    size_t keyLen = 0;
    bool found = false;
    while (source.available()) {
        const char ch = static_cast<char>(source.read());
        if (inString) {
            if (escaped) {
                escaped = false;
                if (capturingKey && keyLen + 1 < sizeof(key)) key[keyLen++] = ch;
            } else if (ch == '\\') {
                escaped = true;
            } else if (ch == '"') {
                inString = false;
                if (capturingKey) {
                    key[keyLen] = '\0';
                    found = strcmp(key, section) == 0;
                    capturingKey = false;
                    expectingKey = false;
                    if (found) break;
                }
            } else if (capturingKey && keyLen + 1 < sizeof(key)) {
                key[keyLen++] = ch;
            }
            continue;
        }
        if (ch == '"') {
            inString = true;
            escaped = false;
            capturingKey = depth == 1 && expectingKey;
            keyLen = 0;
        } else if (ch == '{') {
            ++depth;
            if (depth == 1) expectingKey = true;
        } else if (ch == '}') {
            --depth;
        } else if (ch == ',' && depth == 1) {
            expectingKey = true;
        }
    }
    if (!found) {
        source.close();
        return false;
    }

    int next = -1;
    do { next = source.read(); } while (next >= 0 && isspace(next));
    if (next != ':') { source.close(); return false; }
    do { next = source.read(); } while (next >= 0 && isspace(next));
    if (next != '{') { source.close(); return false; }

    File staged = LittleFS.open(path, "w");
    if (!staged) { source.close(); return false; }
    bool ok = staged.write(static_cast<uint8_t>('{')) == 1;
    int objectDepth = 1;
    inString = false;
    escaped = false;
    while (ok && objectDepth > 0 && source.available()) {
        const char ch = static_cast<char>(source.read());
        ok = staged.write(static_cast<uint8_t>(ch)) == 1;
        if (inString) {
            if (escaped) escaped = false;
            else if (ch == '\\') escaped = true;
            else if (ch == '"') inString = false;
        } else if (ch == '"') {
            inString = true;
        } else if (ch == '{') {
            ++objectDepth;
        } else if (ch == '}') {
            --objectDepth;
        }
    }
    source.close();
    staged.close();
    ok = ok && objectDepth == 0 && !inString;
    if (!ok) LittleFS.remove(path);
    return ok;
}

static bool _loadUnifiedConfigSection(const char* section, JsonDocument& out) {
    static constexpr const char* SECTION_PATH = "/ecu_config.section.tmp";
    if (!_stageUnifiedConfigSection(section, SECTION_PATH)) return false;

    File selected = LittleFS.open(SECTION_PATH, "r");
    const size_t selectedLen = selected ? selected.size() : 0;
    const bool readOk = selected && selectedLen > 0 && selectedLen < sizeof(g_webRxBuf) &&
        selected.read(reinterpret_cast<uint8_t*>(g_webRxBuf), selectedLen) == selectedLen;
    if (selected) selected.close();
    LittleFS.remove(SECTION_PATH);
    if (!readOk) return false;
    g_webRxBuf[selectedLen] = '\0';
    DeserializationError err = deserializeJson(out, g_webRxBuf, selectedLen);
    return err == DeserializationError::Ok && !out.overflowed();
}

static bool _copyLittleFsFile(const char* from, const char* to) {
    File src = LittleFS.open(from, "r");
    if (!src) return false;
    File dst = LittleFS.open(to, "w");
    if (!dst) {
        src.close();
        return false;
    }
    uint8_t buf[256];
    bool ok = true;
    while (src.available()) {
        size_t n = src.read(buf, sizeof(buf));
        if (dst.write(buf, n) != n) {
            ok = false;
            break;
        }
    }
    src.close();
    dst.close();
    if (!ok) LittleFS.remove(to);
    return ok;
}

class WebRxRelease {
public:
    explicit WebRxRelease(AsyncWebServerRequest* req) : _req(req) {}
    ~WebRxRelease() { _releaseWebRx(_req); }
private:
    AsyncWebServerRequest* _req;
};

// Serializes maintenance-upload state (Update handle, _assetTempFile,
// _configRestoreFile and their owner/flag variables) between the async_tcp
// upload handlers and the webTask tick() idle-timeout cleanup.  Without it a
// chunk arriving exactly at the 30 s timeout boundary can write a File object
// that tick() is concurrently closing.  Statically allocated in begin().
static StaticSemaphore_t _uploadMuxBuf;
static SemaphoreHandle_t _uploadMux = nullptr;

class UploadLock {
public:
    UploadLock()  { if (_uploadMux) xSemaphoreTake(_uploadMux, portMAX_DELAY); }
    ~UploadLock() { if (_uploadMux) xSemaphoreGive(_uploadMux); }
};

static AsyncWebServer  _server(80);
static AsyncWebSocket  _ws("/ws");
static DNSServer       _dns;                 // captive portal DNS
static portMUX_TYPE s_assetResponseMux = portMUX_INITIALIZER_UNLOCKED;
static uint16_t s_activeAssetResponses = 0;
static bool s_storageWriteActive = false;
static uint32_t s_lastAssetRequestMs = 0;

static bool _acquireAssetResponseLease() {
    // A background flash operation is normally only a few milliseconds. If an
    // asset arrives during one, wait for that bounded operation to finish
    // instead of returning a transient 503 that turns into a broken page. The
    // writer runs in webTask, so delaying the async_tcp callback yields Core 0.
    const uint32_t deadline = millis() + 2000UL;
    for (;;) {
        bool acquired = false;
        portENTER_CRITICAL(&s_assetResponseMux);
        s_lastAssetRequestMs = millis();
        if (!s_storageWriteActive) {
            ++s_activeAssetResponses;
            acquired = true;
        }
        portEXIT_CRITICAL(&s_assetResponseMux);
        if (acquired) return true;
        if ((int32_t)(millis() - deadline) >= 0) return false;
        vTaskDelay(1);
    }
}

static void _releaseAssetResponseLease() {
    portENTER_CRITICAL(&s_assetResponseMux);
    if (s_activeAssetResponses) --s_activeAssetResponses;
    portEXIT_CRITICAL(&s_assetResponseMux);
}

static bool _beginStorageWriteWindow() {
    bool acquired = false;
    const uint32_t now = millis();
    portENTER_CRITICAL(&s_assetResponseMux);
    // Let a newly loading page claim all of its flash-backed files before
    // deferred persistence resumes. This also prevents writer starvation from
    // the small gaps between a page's concurrent asset requests.
    if (!s_storageWriteActive && s_activeAssetResponses == 0 &&
        (uint32_t)(now - s_lastAssetRequestMs) >= 500UL) {
        s_storageWriteActive = true;
        acquired = true;
    }
    portEXIT_CRITICAL(&s_assetResponseMux);
    return acquired;
}

static void _endStorageWriteWindow() {
    portENTER_CRITICAL(&s_assetResponseMux);
    s_storageWriteActive = false;
    portEXIT_CRITICAL(&s_assetResponseMux);
}

class LeasedAssetResponse final : public AsyncFileResponse {
public:
    LeasedAssetResponse(const char* path, const char* contentType)
        : AsyncFileResponse(LittleFS, path, contentType) {}
    ~LeasedAssetResponse() { _releaseAssetResponseLease(); }
};

static void _sendGzipAsset(AsyncWebServerRequest* req, const char* path,
                           const char* contentType, const char* cacheControl) {
    if (!_webAssetsComplete) {
        if (strcmp(contentType, "text/html") == 0) {
            const char* page = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
                "<title>OpenTurbine recovery</title><body style='font:16px system-ui;max-width:42rem;margin:4rem auto;padding:1rem'>"
                "<h1>Web interface recovery required</h1><p>The ECU detected an incomplete or changed web-asset set. START is inhibited.</p>"
                "<p>Use OpenTurbine Setup Tool to upload the complete matching web assets, or reflash the filesystem over USB. Configuration and logs are not erased.</p></body>";
            AsyncWebServerResponse* resp = req->beginResponse(503, "text/html", page);
            resp->addHeader("Cache-Control", "no-store");
            req->send(resp);
        } else {
            req->send(503, "text/plain", "Web UI recovery required");
        }
        return;
    }
    if (!LittleFS.exists(path)) {
        AsyncWebServerResponse* resp = req->beginResponse(
            503, "text/plain", "Web UI asset missing - re-upload web assets or reflash filesystem");
        resp->addHeader("Cache-Control", "no-store");
        req->send(resp);
        return;
    }
    if (!_acquireAssetResponseLease()) {
        AsyncWebServerResponse* busy = req->beginResponse(
            503, "text/plain", "Web storage is busy; reload this page");
        busy->addHeader("Cache-Control", "no-store");
        busy->addHeader("Retry-After", "1");
        req->send(busy);
        return;
    }
    LeasedAssetResponse* resp = new (std::nothrow) LeasedAssetResponse(path, contentType);
    if (!resp || !resp->_sourceValid()) {
        if (!resp) _releaseAssetResponseLease();
        delete resp;
        req->send(503, "text/plain", "Web UI asset is temporarily unavailable");
        return;
    }
    resp->addHeader("Content-Encoding", "gzip");
    // Menu links carry the installed web-release token. Those exact page URLs
    // are immutable and should be transferred only once; a later web update
    // changes the token. Keep direct/unversioned entry URLs short-cached so a
    // manually refreshed root can still discover a newly installed release.
    const bool versionedPage = strcmp(contentType, "text/html") == 0 && req->hasParam("v");
    resp->addHeader("Cache-Control", versionedPage
        ? "public, max-age=31536000, immutable"
        : cacheControl);
    req->send(resp);
}

// Shared asset filenames stay stable for the maintenance updater, while every
// HTML page supplies a release-specific ?v= token. Cache that exact version
// permanently: revalidating four large flash-backed assets on every page change
// can occupy all browser/TCP slots and leave the next page stuck in "loading".
// A web update changes the token, so the browser still fetches the new files.
static constexpr const char* SHARED_ASSET_CACHE =
    "public, max-age=31536000, immutable";
// Page documents change only during a maintenance asset update, which reboots
// the ECU. A short cache keeps repeated back-and-forth navigation off the
// Classic's Wi-Fi/TCP path while still aging out quickly after an update.
static constexpr const char* PAGE_ASSET_CACHE =
    "private, max-age=60";

static void _finalizeJsonResponse(AsyncWebServerResponse* resp) {
    if (!resp) return;
    resp->addHeader("Cache-Control", "no-store");
    // API replies are complete, bounded documents rather than flash-backed
    // streaming assets.  Retiring their TCP transport after the declared body
    // is acknowledged prevents abandoned browser/editor requests from filling
    // AsyncTCP's client pool across repeated page navigation.  WebSocket
    // telemetry remains persistent, and HTML/JS/CSS file responses deliberately
    // retain keep-alive because they have different chunk-lifetime semantics.
    resp->addHeader("Connection", "close");
}

// ArduinoJson reports bytes actually written, not bytes required. A truncated
// buffer therefore normally returns capacity - 1 and can otherwise masquerade
// as a valid rollback snapshot or telemetry document.
static size_t _serializeJsonBounded(const JsonDocument& doc, char* buf, size_t len) {
    const size_t required = measureJson(doc);
    if (!buf || len == 0 || required >= len) {
        if (buf && len) buf[0] = '\0';
        return len;
    }
    return serializeJson(doc, buf, len);
}

// Keep the response snapshot in the response object itself. This avoids both
// AsyncBasicResponse's unchecked String copy and the much larger shared_ptr /
// std::function machinery on the flash-constrained Classic ESP32 target.
class OwnedJsonResponse final : public AsyncAbstractResponse {
public:
    OwnedJsonResponse(const char* json, size_t len, int status = 200)
        : _data(new (std::nothrow) uint8_t[len]), _index(0) {
        _code = status;
        _contentType = "application/json";
        _contentLength = len;
        if (_data && len) memcpy(_data, json, len);
    }

    ~OwnedJsonResponse() override { delete[] _data; }
    bool _sourceValid() const override { return _data != nullptr; }

    size_t _fillBuffer(uint8_t* out, size_t maxLen) override {
        if (!_data || _index >= _contentLength) return 0;
        size_t count = _contentLength - _index;
        if (count > maxLen) count = maxLen;
        memcpy(out, _data + _index, count);
        _index += count;
        return count;
    }

private:
    uint8_t* _data;
    size_t _index;
};

// The hardware document is assembled in the reserved request buffer. Borrow
// that storage until transmission completes instead of retaining a second
// 10-16 KB heap allocation on Classic ESP32.
class BorrowedWebRxJsonResponse final : public AsyncAbstractResponse {
public:
    BorrowedWebRxJsonResponse(AsyncWebServerRequest* owner, size_t len, int status = 200)
        : _owner(owner), _index(0), _released(false) {
        _code = status;
        _contentType = "application/json";
        _contentLength = len;
    }

    ~BorrowedWebRxJsonResponse() override { _releaseWebRx(_owner); }
    bool _sourceValid() const override {
        return _released || (_owner && g_webRxStorage && g_webRxOwner == _owner);
    }

    size_t _fillBuffer(uint8_t* out, size_t maxLen) override {
        if (_released || !_sourceValid() || _index >= _contentLength) return 0;
        size_t count = _contentLength - _index;
        if (count > maxLen) count = maxLen;
        memcpy(out, g_webRxBuf + _index, count);
        _index += count;
        // AsyncWebServer may retain the response object for the lifetime of a
        // keep-alive connection. The shared source is no longer needed once
        // its final bytes have been copied into TCP's send buffers, so release
        // it here instead of blocking every later configuration transfer until
        // the response destructor eventually runs.
        if (_index >= _contentLength) {
            _releaseWebRx(_owner);
            _owner = nullptr;
            _released = true;
        }
        return count;
    }

private:
    AsyncWebServerRequest* _owner;
    size_t _index;
    bool _released;
};

// Large read-only JSON documents cannot afford a second 7-16 KB heap-backed
// snapshot on Classic ESP32. Reserve the bounded request buffer and lend it to
// the response until AsyncTCP has transmitted the declared Content-Length.
// Request-body handlers must not use this helper because they already own that
// buffer through WebRxRelease.
static void _sendBorrowedWebRxJson(AsyncWebServerRequest* req, const char* json,
                                   size_t len, int status = 200) {
    if (!req || !json || len >= sizeof(g_webRxBuf)) {
        if (req) {
            AsyncWebServerResponse* error = req->beginResponse(
                500, "application/json", "{\"error\":\"JSON response too large\"}");
            _finalizeJsonResponse(error);
            req->send(error);
        }
        return;
    }
    if (!_claimWebRx(req, 0)) return;
    portENTER_CRITICAL(&s_webRxMux);
    g_webRxResponseLease = true;
    portEXIT_CRITICAL(&s_webRxMux);
    memcpy(g_webRxBuf, json, len);

    BorrowedWebRxJsonResponse* resp =
        new (std::nothrow) BorrowedWebRxJsonResponse(req, len, status);
    if (!resp || !resp->_sourceValid()) {
        delete resp;
        _releaseWebRx(req);
        AsyncWebServerResponse* error = req->beginResponse(
            503, "application/json", "{\"error\":\"ECU is busy; retry shortly\"}");
        error->addHeader("Retry-After", "1");
        _finalizeJsonResponse(error);
        req->send(error);
        return;
    }
    _finalizeJsonResponse(resp);
    req->send(resp);
}

// AsyncBasicResponse copies a const char* into an Arduino String. Under several
// simultaneous large requests that allocation can fail silently, producing a
// misleading HTTP 200 with an empty body. Own one checked snapshot per response
// and stream it with a fixed length so memory pressure becomes a retryable error.
static void _sendOwnedJson(AsyncWebServerRequest* req, const char* json, size_t len, int status = 200) {
    OwnedJsonResponse* resp = new (std::nothrow) OwnedJsonResponse(json, len, status);
    if (!resp || !resp->_sourceValid()) {
        delete resp;
        AsyncWebServerResponse* resp = req->beginResponse(
            503, "application/json", "{\"error\":\"ECU is busy; retry shortly\"}");
        resp->addHeader("Retry-After", "1");
        _finalizeJsonResponse(resp);
        req->send(resp);
        return;
    }
    _finalizeJsonResponse(resp);
    req->send(resp);
}

static bool _sendTelemetryFrame(AsyncWebSocketClient* client, const char* buf, size_t len) {
    // ESPAsyncWebServer copies each text frame into a heap-backed vector.
    // Avoid entering that allocator when RAM is already under pressure.
    static unsigned long lastDropLogMs = 0;
    const size_t reserve = len + 24576;
    if (!client || !client->canSend() ||
        ESP.getFreeHeap() <= reserve || ESP.getMaxAllocHeap() <= len + 8192) {
        if (millis() - lastDropLogMs >= 5000) {
            lastDropLogMs = millis();
            Serial.printf("[WebSocket] Telemetry deferred - low heap (frame=%u free=%u max_alloc=%u)\n",
                          (unsigned)len, (unsigned)ESP.getFreeHeap(),
                          (unsigned)ESP.getMaxAllocHeap());
        }
        return false;
    }
    return client->text(buf, len);
}


// ── WiFi AP setup ─────────────────────────────────────────────
static void _startWiFi() {
    // begin() is called once on a freshly booted runtime.  Do not stop and
    // immediately restart the WiFi driver here: on current IDF builds the stop
    // is asynchronous, and starting AP mode while it is still stopping fails
    // netstack registration with ESP_ERR_WIFI_STOP_STATE (0x3014).  That leaves
    // ICMP alive but HTTP unavailable for roughly a TCP timeout after warm boot.
    _dns.stop();
    MDNS.end();
    WiFi.persistent(false);
    WiFi.mode(WIFI_AP);
    const IPAddress apIP(192, 168, 4, 1);
    const IPAddress apGateway(192, 168, 4, 1);
    const IPAddress apSubnet(255, 255, 255, 0);
    WiFi.softAPConfig(apIP, apGateway, apSubnet);
    const char* ssidFull = HardwareConfig::profileId[0] ? HardwareConfig::profileId : "OpenTurbine";
    // IEEE 802.11 SSID max is 32 bytes — clamp an over-long profile_id at
    // use only (the stored profile_id keeps its full value; the Hardware
    // page warns above 32 bytes but never blocks the save).
    char ssid[33];
    strncpy(ssid, ssidFull, sizeof(ssid) - 1);
    ssid[sizeof(ssid) - 1] = '\0';
    if (strlen(ssidFull) > 32) {
        // don't end on a UTF-8 character split by the byte clamp
        int i = 31;
        while (i > 0 && ((unsigned char)ssid[i] & 0xC0) == 0x80) i--;
        unsigned char lead = (unsigned char)ssid[i];
        int expect = lead >= 0xF0 ? 4 : (lead >= 0xE0 ? 3 : (lead >= 0xC0 ? 2 : 1));
        if (i + expect > 32) ssid[i] = '\0';
    }
    const char* pwd  = HardwareConfig::wifiPassword[0] ? HardwareConfig::wifiPassword : nullptr;
    bool apOk = WiFi.softAP(ssid, pwd);  // SSID = hardware profile_id; password optional
    int8_t txPowerQdbm = (int8_t)constrain(HardwareConfig::wifiTxPowerDbm, 2, 20) * 4;
    esp_wifi_set_max_tx_power(txPowerQdbm);
    // Minimize WiFi power-save latency.  WIFI_PS_NONE keeps the ESP32 radio
    // always-on; DTIM=1 tells connected stations to wake at every beacon (~100 ms)
    // instead of the default every 3rd, preventing multi-second TCP stalls caused
    // by Windows/mobile WiFi adapters sleeping between beacons.
    esp_wifi_set_ps(WIFI_PS_NONE);
    {
        wifi_config_t ap_cfg;
        esp_wifi_get_config(WIFI_IF_AP, &ap_cfg);
        ap_cfg.ap.dtim_period = 1;
        esp_wifi_set_config(WIFI_IF_AP, &ap_cfg);
    }
    IPAddress activeIp = WiFi.softAPIP();
    Serial.printf("[WiFi] AP: %s  IP: %s  %s  TX=%d dBm %s\n", ssid, activeIp.toString().c_str(),
                  pwd ? "(password protected)" : "(open network)",
                  (int)HardwareConfig::wifiTxPowerDbm,
                  apOk ? "" : "(softAP start reported failure)");

    // Captive portal DNS — answers all DNS queries with our IP so phones
    // open the dashboard automatically when joining the AP.
    _dns.start(53, "*", activeIp);
    Serial.println("[WiFi] Captive portal DNS started");

    // mDNS — accessible as http://ot.local on any mDNS-capable client
    if (MDNS.begin("ot")) {
        MDNS.addService("http", "tcp", 80);
        Serial.println("[WiFi] mDNS: http://ot.local");
    }
}

static void _scheduleRestart(const char* reason, uint32_t delayMs = 5000) {
    _pendingRestartReason = reason;
    _hwRebootPending = true;
    _hwRebootScheduledMs = millis() + delayMs;
}

static void _restartCleanly(const char* reason) {
    Serial.printf("[WebServer] Restarting: %s\n", reason ? reason : "requested");
    // The response has already had the scheduled restart delay to flush. Stop
    // network services and hold the AP down long enough for stations to observe
    // a real disconnect before recreating the same SSID/BSSID. An abrupt reset
    // can leave Windows associated to a stale AP for roughly two minutes even
    // though the ECU itself has completed booting.
    _server.end();
    _dns.stop();
    MDNS.end();
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_OFF);
    delay(750);
    ESP.restart();
}

// ── Telemetry JSON builder ────────────────────────────────────
// full=true  → complete frame: all fields (served by /api/data REST)
// full=false → fast frame: only real-time sensor/state fields (WebSocket)
//
// The JS keeps the last received value for every field, so omitting slow
// fields on fast frames has no visible effect after the first full frame.
static size_t _buildTelemetry(char* buf, size_t len, JsonDocument& doc, bool full) {
    alignas(EngineData) uint8_t snapshotStorage[sizeof(EngineData)];
    const uint32_t snapshotVersion = EngineData::readPublishedSnapshot(snapshotStorage, sizeof(snapshotStorage));
    const auto& ed = *reinterpret_cast<const EngineData*>(snapshotStorage);
    doc.clear();
    doc["snapshot_id"] = snapshotVersion;
    const float p1Bar = ed.p1;
    const float p2Bar = ed.p2;
    const float maxP1Bar = ed.maxP1;
    const float maxP2Bar = ed.maxP2;

    // ── Fast fields — sent every pull cycle (~500 ms) ─────────────────────
    doc["mode"]                  = sysModeStr(ed.mode);
    doc["n1"]                    = (int)ed.n1Rpm;
    doc["n2"]                    = (int)ed.n2Rpm;
    doc["n1_rpm_accel"]          = (int)ed.n1RpmAccel;   // RPM/s — predictive limiter / advanced idle
    doc["n2_rpm_accel"]          = (int)ed.n2RpmAccel;
    doc["tot"]                   = (float)(int)(ed.tot * 10) / 10.0f;
    doc["tit"]                   = (float)(int)(ed.tit * 10) / 10.0f;
    doc["oil"]                   = (float)(int)(ed.oilPressure * 100) / 100.0f;
    doc["oil_raw"]               = ed.oilPressureRaw;
    doc["oil_demand"]            = (float)(int)(ed.oilTargetBar * 100) / 100.0f;
    doc["flame"]                 = ed.flameDetected;
    doc["flame_raw"]             = ed.flameSensorRaw;
    doc["last_run_flame_avg"]    = (float)(int)(ed.lastRunFlameAvg * 10) / 10.0f;
    doc["last_run_flame_samples"] = ed.lastRunFlameSamples;
    doc["torque_raw"]            = ed.torqueRaw;
    doc["p1"]                    = (float)(int)(std::max(0.0f, p1Bar) * 100) / 100.0f;
    doc["p2"]                    = (float)(int)(std::max(0.0f, p2Bar) * 100) / 100.0f;
    doc["p1_raw"]                = ed.p1Raw;
    doc["p2_raw"]                = ed.p2Raw;
    doc["p1_healthy"]            = ed.p1Healthy;
    doc["p2_healthy"]            = ed.p2Healthy;
    doc["flame_healthy"]         = ed.flameHealthy;
    doc["max_p1"]                = (float)(int)(maxP1Bar * 100) / 100.0f;
    doc["max_p2"]                = (float)(int)(maxP2Bar * 100) / 100.0f;
    float fuelPressBar           = (float)(int)(ed.fuelPressure * 100) / 100.0f;
    doc["fuel_press"]            = fuelPressBar;
    doc["fuel_press_raw"]        = ed.fuelPressRaw;
    doc["fuel_press_healthy"]    = ed.fuelPressHealthy;
    doc["max_fuel_press"]        = (float)(int)(ed.maxFuelPressure * 100) / 100.0f;
    doc["fuel_flow_healthy"]     = ed.fuelFlowHealthy;
    doc["fuel_flow"]             = (float)(int)(ed.fuelFlow * 100) / 100.0f;
    doc["fuel_flow_type"]        = HardwareConfig::fuelFlowType;
    doc["fuel_flow_raw"]         = ed.fuelFlowRaw;
    doc["batt_voltage_raw"]      = ed.battVoltageRaw;
    doc["glow_current_raw"]      = g_sensorGlowCurrent.rawCounts();
    doc["igniter_current_raw"]   = g_sensorIgniterCurrent.rawCounts();
    doc["igniter2_current_raw"]  = g_sensorIgniter2Current.rawCounts();
    doc["oil_pump_current_raw"]  = g_sensorOilPumpCurrent.rawCounts();
    // ── Throttle / idle demand ─────────────────────────────────────────────
    doc["throttle_input_raw"]    = ed.throttleInputRaw;
    {
        float inputNorm = 0.0f;
        if (HardwareConfig::throttleInputRcPwm) {
            inputNorm = ed.rcThrottleValid ? ed.rcThrottleNorm : 0.0f;
        } else {
            int range = Config::throttleMaxRaw - Config::throttleMinRaw;
            if (range != 0) inputNorm = constrain((ed.throttleInputRaw - Config::throttleMinRaw) /
                                                  (float)range, 0.0f, 1.0f);
        }
        doc["throttle_input_norm"] = (float)(int)(inputNorm * 1000) / 1000.0f;
    }
    doc["throttle_demand"]       = (float)(int)(ed.throttleDemand * 1000) / 1000.0f;
    // Report the command actually written at the actuator boundary. Computing
    // it again here can race the control loop between its per-tick demand reset
    // and controller passes, briefly displaying zero while fuel is physically
    // being commanded.
    float throttleEffective = ed.mainFuelAppliedDemand;
    doc["throttle_effective"]    = (float)(int)(throttleEffective * 1000) / 1000.0f;
    doc["ab_fuel_offset"]        = (float)(int)(ed.abFuelOffset * 1000) / 1000.0f;
    doc["starter_demand"]        = (float)(int)(ed.starterDemand * 1000) / 1000.0f;
    doc["starter_enabled"]       = ed.starterEnabled;
    doc["fuel_sol_open"]         = ed.fuelSolOpen;
    doc["igniter_on"]            = ed.igniterOn;
    doc["igniter2_on"]           = ed.igniter2On;
    doc["idle_input_raw"]        = ed.idleInputRaw;
    doc["throttle_input_type"]   = !HardwareConfig::hasThrottleInput ? "none" :
                                   (HardwareConfig::throttleInputRcPwm ? "servo" : "adc");
    doc["idle_input_type"]       = !HardwareConfig::hasIdleInput ? "none" :
                                   (HardwareConfig::idleInputRcPwm ? "servo" : "adc");
    if (HardwareConfig::throttleInputRcPwm) doc["throttle_input_us"] = ed.throttleInputRaw;
    if (HardwareConfig::idleInputRcPwm)     doc["idle_input_us"]     = ed.idleInputRaw;
    doc["rc_throttle_norm"]      = (float)(int)(ed.rcThrottleNorm * 1000) / 1000.0f;
    // ── Health, actuators, switches ───────────────────────────────────────
    doc["oil_pct"]               = (int)ed.oilPumpPct;
    doc["n1_healthy"]            = ed.n1Healthy;
    doc["n2_healthy"]            = ed.n2Healthy;
    doc["tot_healthy"]           = ed.totHealthy;
    doc["tit_healthy"]           = ed.titHealthy;
    doc["oil_healthy"]           = ed.oilHealthy;
    doc["dynamic_idle_enabled"]  = ed.dynamicIdleEnabled;
    const bool idlePressureSource = Config::idleSource >= 2;
    doc["idle_target"]           = idlePressureSource ? Config::idleTargetPressure
                                                       : Config::idleTargetRpm;
    doc["idle_target_unit"]      = idlePressureSource ? "bar" : "rpm";
    doc["idle_source"]           = Config::idleSource == 1 ? "N2" :
                                    Config::idleSource == 2 ? "P1" :
                                    Config::idleSource == 3 ? "P2" : "N1";
    doc["idle_controller_state"] = ed.limpMode ? "Reduced-power mode" :
                                                   ed.idleControllerState;
    doc["throttle_command_owner"] = ed.throttleCommandOwner;
    doc["prop_pitch_command_owner"] = ed.propPitchCommandOwner;
    doc["oil_command_owner"] = ed.oilCommandOwner;
    doc["idle_target_rpm"]       = Config::idleTargetRpm; // legacy client compatibility
    doc["limp_mode"]             = ed.limpMode;
    doc["stop_switch_active"]    = ed.stopSwitchActive;
    doc["start_switch_active"]   = ed.startSwitchActive;
    doc["start_switch_raw_level"] = ed.startSwitchRawLevel;
    doc["start_switch_configured"] = ed.startSwitchConfigured;
    doc["start_switch_healthy"] = ed.startSwitchHealthy;
    doc["start_switch_active_high"] = ed.startSwitchActiveHigh;
    doc["start_switch_ready"] = ed.startSwitchReady;
    doc["manual_relight_active"] = ed.manualRelightActive;
    doc["oil_failsafe_active"]   = ed.oilFailsafeActive;
    doc["oil_min_bar"]           = (float)(int)(ed.oilMinBar * 100) / 100.0f;
    doc["standby_oil_feed_active"] = ed.standbyOilFeedActive;
    doc["last_event"]            = ed.lastEvent;
    doc["dev_mode"]              = ed.devMode;
    doc["skip_safety_checks"]    = ed.skipSafetyChecks;
    doc["bench_mode"]            = ed.benchMode;
    doc["relight_armed"]         = ed.relightArmed;
    doc["relight_attempts"]      = (int)ed.relightAttempts;
    doc["extra_cooldown_active"] = ed.extraCooldownActive;
    {
        unsigned long now = millis();
        long remainingMs = (long)(ed.extraCooldownUntilMs - now);
        int remS = (ed.extraCooldownActive && remainingMs > 0)
                   ? (int)((unsigned long)remainingMs / 1000UL) : 0;
        doc["extra_cooldown_remaining_s"] = remS;
    }
    doc["profile_match"]         = Config::profileMatch;
    doc["config_version_mismatch"] = ed.configVersionMismatch;
    doc["fw_version"]            = OT_VERSION;
    doc["uptime_s"]              = ed.uptimeMs / 1000;
    doc["boot_count"]            = ed.bootCount;
    doc["loop_counter"]          = ed.loopCounter;
    doc["loop_hz"]               = ed.loopHz;
    doc["loop_period_ms"]        = ed.loopPeriodMs;
    doc["loop_exec_avg_ms"]      = ed.loopExecAvgMs;
    doc["loop_exec_max_ms"]      = ed.loopExecMaxMs;
    doc["loop_sensors_ms"]       = ed.loopSensorsMs;
    doc["loop_sequencer_ms"]     = ed.loopSequencerMs;
    doc["loop_controllers_ms"]   = ed.loopControllersMs;
    doc["loop_actuators_ms"]     = ed.loopActuatorsMs;
    doc["loop_logging_ms"]       = ed.loopLoggingMs;
    doc["loop_led_ms"]           = ed.loopLedMs;
    doc["session_dropped_rows"]  = SessionLogger::droppedRows();
    doc["session_logger_healthy"] = SessionLogger::healthy();
    doc["session_logger_error"]   = SessionLogger::errorCode();
    doc["session_log_path"]       = SessionLogger::currentPath();
    doc["session_eviction_count"] = SessionLogger::evictionCount();
    doc["session_last_evicted"]   = SessionLogger::lastEvictedSession();
    doc["session_free_bytes"]     = SessionLogger::freeBytes();
    doc["session_reserve_bytes"]  = SessionLogger::reserveBytes();
    doc["restart_pending"]        = _hwRebootPending;
    doc["restart_blocker"]        = _pendingRestartBlocker;
    doc["event_dropped_events"]  = FlightRecorder::droppedEvents();
    doc["event_pending_count"]    = FlightRecorder::pendingCount();
    doc["event_recorder_healthy"] = FlightRecorder::healthy();
    doc["event_recorder_error"]   = FlightRecorder::errorCode();
    doc["event_last_append_ms"]   = FlightRecorder::lastDurableAppendMs();
    doc["runtime_stats_pending"]  = Config::runtimeStatsPending();
    doc["runtime_stats_healthy"]  = Config::runtimeStatsHealthy();
    doc["runtime_stats_error"]    = Config::runtimeStatsError();
    doc["log_records"]           = FlightRecorder::recordCount();
    doc["max_n1"]                = (int)ed.maxN1;
    doc["max_n2"]                = (int)ed.maxN2;
    doc["max_tot"]               = (float)(int)(ed.maxTot * 10) / 10.0f;
    doc["tot_rise_rate"]         = (float)(int)(ed.totRiseRate * 10) / 10.0f;
    doc["egt_rise_rate"]         = (float)(int)(ed.totRiseRate * 10) / 10.0f;
    doc["surge_detected"]        = ed.surgeDetected;
    // ── Afterburner runtime state ──────────────────────────────────────────
    {
        const char* abStr = "Off";
        switch (ed.abMode) {
            case ABMode::Off:         abStr = "Off";          break;
            case ABMode::Arming:      abStr = "Arming";       break;
            case ABMode::Igniting:    abStr = "Igniting";     break;
            case ABMode::Running:     abStr = "Running";      break;
            case ABMode::ShuttingDown:abStr = "ShuttingDown"; break;
            case ABMode::Fault:       abStr = "Fault";        break;
        }
        doc["ab_mode"]           = abStr;
    }
    doc["ab_trigger_active"]     = ed.abTriggerActive;
    doc["ab_trigger_source"]     = HardwareConfig::abTriggerSource;
    doc["ab_arm_switch_on"]      = ed.abArmSwitchOn;
    doc["ab_flame_on"]           = ed.abFlameOn;
    doc["ab_flame_healthy"]      = ed.abFlameHealthy;
    doc["ab_flame_value"]        = ed.abFlameValue;
    doc["ab_flame_sample_seq"]   = ed.abFlameSampleSeq;
    doc["ab_evidence_valid"]     = ed.abEvidenceValid;
    doc["ab_request_active"]     = ed.abTriggerActive;
    doc["ab_permitted"]          = ed.abPermitted;
    doc["ab_execution_active"]   = ed.abExecutionActive;
    doc["ab_inhibit_reason"]     = ed.abInhibitReason;
    doc["ab_fault_reason"]       = ed.abFaultReason;
    doc["main_fuel_protection_active"] = ed.mainFuelProtectionActive;
    doc["ab_flame_raw"]          = ed.abFlameRaw;
    doc["ab_sol_open"]           = ed.abSolOpen;
    doc["ab_pump_demand"]        = (float)(int)(ed.abPumpDemand * 1000) / 1000.0f;
    // ── Sequence progress + fault ─────────────────────────────────────────
    doc["current_block"]         = ed.currentBlock;
    doc["seq_block_idx"]         = (int)ed.seqBlockIdx;
    doc["seq_block_total"]       = (int)ed.seqBlockTotal;
    doc["seq_wait_reason"]       = ed.seqWaitReason[0] ? ed.seqWaitReason : nullptr;
    doc["seq_last_result"]       = ed.seqLastResult[0] ? ed.seqLastResult : nullptr;
    doc["seq_fault_block"]       = ed.seqFaultBlock[0] ? ed.seqFaultBlock : nullptr;
    doc["seq_started_ms"]        = ed.seqStartedMs;
    doc["seq_ended_ms"]          = ed.seqEndedMs;
    doc["ab_current_block"]      = ed.abCurrentBlock;
    doc["ab_seq_block_idx"]      = (int)ed.abSeqBlockIdx;
    doc["ab_seq_block_total"]    = (int)ed.abSeqBlockTotal;
    doc["ab_seq_wait_reason"]    = ed.abSeqWaitReason[0] ? ed.abSeqWaitReason : nullptr;
    doc["ab_seq_last_result"]    = ed.abSeqLastResult[0] ? ed.abSeqLastResult : nullptr;
    doc["ab_seq_fault_block"]    = ed.abSeqFaultBlock[0] ? ed.abSeqFaultBlock : nullptr;
    doc["ab_seq_started_ms"]     = ed.abSeqStartedMs;
    doc["ab_seq_ended_ms"]       = ed.abSeqEndedMs;
    doc["fault_description"]     = ed.faultDescription;
    doc["limp_override_sensor"]  =
        ed.limpOverrideSensor != FeedbackRequirements::NONE
            ? FeedbackRequirements::sensorName(ed.limpOverrideSensor) : nullptr;
    doc["limp_failure_mask"]     = ed.limpFailureMask;
    doc["limp_automatic"]        = ed.automaticLimpLatched;
    doc["limp_manual"]           = ed.manualLimpRequested;
    doc["limited_start_allowed"] = _limitedStartRejectReason() == nullptr;
    {
        const uint32_t eligible =
            FeedbackRequirements::eligibleSingleStartOverride(ed, millis());
        doc["limited_start_sensor"] =
            eligible != FeedbackRequirements::NONE
                ? FeedbackRequirements::sensorName(eligible) : nullptr;
    }
    // ── Extended sensor values (has_* flags are in the slow section) ───────
    doc["oil_temp"]              = (float)(int)(ed.oilTemp * 10) / 10.0f;
    doc["oil_temp_raw"]          = ed.oilTempRaw;
    doc["oil_temp_healthy"]      = ed.oilTempHealthy;
    doc["max_oil_temp"]          = (float)(int)(ed.maxOilTemp * 10) / 10.0f;
    if (ed.minOilPressure >= 0.0f)
        doc["min_oil"] = (float)(int)(ed.minOilPressure * 100) / 100.0f;
    else
        doc["min_oil"] = nullptr;
    doc["batt_voltage"]          = (float)(int)(ed.battVoltage * 100) / 100.0f;
    doc["batt_healthy"]          = ed.battHealthy;
    doc["max_batt_voltage"]      = (float)(int)(ed.maxBattVoltage * 100) / 100.0f;
    doc["torque"]                = (float)(int)(ed.torque * 10) / 10.0f;
    if (HardwareConfig::hasTorque && HardwareConfig::hasN2Rpm &&
        ed.torqueHealthy && ed.n2Healthy && ed.n2Rpm > 0) {
        doc["turbo_power_w"]     = (int)ed.turboPower;
    } else {
        doc["turbo_power_w"]     = nullptr;
    }
    doc["torque_healthy"]        = ed.torqueHealthy;
    doc["thrust"]                = (float)(int)(ed.thrust * 10) / 10.0f;
    doc["thrust_raw"]            = ed.thrustRaw;
    doc["thrust_healthy"]        = ed.thrustHealthy;
    doc["fuel_press"]            = (float)(int)(ed.fuelPressure * 100) / 100.0f;
    doc["fuel_press_healthy"]    = ed.fuelPressHealthy;
    doc["max_fuel_press"]        = (float)(int)(ed.maxFuelPressure * 100) / 100.0f;
    doc["glow_plug_pct"]         = (int)(ed.glowPlugDemand * 100.0f);
    doc["wet_glow_fuel_pct"]     = (int)(ed.wetGlowFuelDemand * 100.0f);
    doc["glow_plug_hot"]         = ed.glowPlugHot;
    doc["glow_current_amps"]     = (float)(int)(ed.glowCurrentAmps * 10) / 10.0f;
    doc["glow_current_healthy"]  = ed.glowCurrentHealthy;
    doc["igniter_current_amps"]  = (float)(int)(ed.igniterCurrentAmps  * 10) / 10.0f;
    doc["igniter_current_healthy"] = ed.igniterCurrentHealthy;
    doc["igniter2_current_amps"] = (float)(int)(ed.igniter2CurrentAmps * 10) / 10.0f;
    doc["igniter2_current_healthy"] = ed.igniter2CurrentHealthy;
    doc["oil_pump_current_amps"] = (float)(int)(ed.oilPumpCurrentAmps  * 10) / 10.0f;
    doc["oil_pump_current_healthy"] = ed.oilPumpCurrentHealthy;
    doc["oil_pump_overcurrent"]  = ed.oilPumpOvercurrent;
    doc["oil_flow_warning"] = ed.oilFlowWarningActive;
    doc["bleed_valve_open"]      = ed.bleedValveOpen;
    doc["bleed_valve_demand"]    = (float)(int)(ed.bleedValveDemand * 1000) / 1000.0f;
    doc["prop_pitch_demand"]     = (float)(int)(ed.propPitchDemand * 1000) / 1000.0f;
    doc["fuel_pump2_demand"]     = (float)(int)(ed.fuelPump2Demand * 1000) / 1000.0f;
    doc["cool_fan_on"]           = ed.coolFanOn;
    doc["cool_fan_demand"]       = (float)(int)(ed.coolFanDemand * 1000) / 1000.0f;
    doc["airstarter_open"]       = ed.airstarterOpen;
    doc["oil_scavenge_on"]       = ed.oilScavengeOn;
    doc["oil_scavenge_demand"]   = (float)(int)(ed.oilScavengeDemand * 1000) / 1000.0f;
    doc["governor_target_rpm"]   = (int)Config::governorTargetRpm;
    doc["governor_controller_state"] = ed.limpMode ? "Reduced-power mode" :
                                                      ed.governorControllerState;
    // Which governor axis is live (same selection as Hardware runControllers): prop-pitch
    // mode holds N2 with pitch/load and leaves the throttle to the operator; throttle-driven
    // mode winds fuel/throttle to hold N2. Lets the dashboard show the active mode.
    doc["governor_mode"]         = (HardwareConfig::hasPropPitch &&
                                    Config::governorPitchKp > 0.0f)
                                    ? (HardwareConfig::propPitchType == 2 ? "two_position_pitch" : "pitch")
                                    : "throttle";
    doc["max_tit"]               = (float)(int)(ed.maxTit * 10) / 10.0f;
    // ── DI channel states (config fields — pin/label/role — are in slow) ──
    {
        auto diArr = doc["di_channels"].to<JsonArray>();
        for (int i = 0; i < HardwareConfig::MAX_DI; i++) {
            auto ch = diArr.add<JsonObject>();
            ch["state"] = ed.diState[i];
            ch["pin"]   = HardwareConfig::diCh[i].pin;  // needed by JS show/hide logic
        }
    }
    {
        auto inArr = doc["registry_inputs"].to<JsonArray>();
        for (uint8_t i = 0; i < HardwareConfig::channelRegistry.inputCount; i++) {
            auto ch = inArr.add<JsonObject>();
            ch["id"]      = HardwareConfig::channelRegistry.inputs[i].id;
            ch["value"]   = (float)(int)(ed.registryInputValue[i] * 1000) / 1000.0f;
            ch["raw"]     = ed.registryInputRaw[i];
            ch["healthy"] = ed.registryInputHealthy[i];
        }
        auto outArr = doc["registry_outputs"].to<JsonArray>();
        for (uint8_t i = 0; i < HardwareConfig::channelRegistry.outputCount; i++) {
            auto ch = outArr.add<JsonObject>();
            ch["id"]     = HardwareConfig::channelRegistry.outputs[i].id;
            ch["demand"] = (float)(int)(ed.registryOutputDemand[i] * 1000) / 1000.0f;
            ch["current_amps"] = (float)(int)(ed.registryOutputCurrentAmps[i] * 100) / 100.0f;
            ch["current_healthy"] = ed.registryOutputCurrentHealthy[i];
        }
    }

    // ── Slow fields — sent on connect + every ~30 s ───────────────────────
    // Hardware config flags, safety limits, labels, calibration raw values,
    // boot/session stats.  These never change during normal engine operation.
    if (full) {
        doc["has_fuel_flow"]         = HardwareConfig::hasFuelFlow;
        int flameThreshold = 0;
        bool hasFlameThreshold = false;
        for (uint8_t i = 0; i < HardwareConfig::channelRegistry.inputCount; ++i) {
            const auto& input = HardwareConfig::channelRegistry.inputs[i];
            if (!strcmp(input.purpose, "flame") &&
                (input.driver == ChannelRegistry::Analog ||
                 input.driver == ChannelRegistry::I2cAnalog)) {
                flameThreshold = input.digitalThresholdRaw;
                hasFlameThreshold = true;
                break;
            }
        }
        if (hasFlameThreshold) doc["flame_threshold"] = flameThreshold;
        // Input type strings (hardware topology — doesn't change at runtime)
        bool rcPwmActive =
            (HardwareConfig::hasThrottleInput && HardwareConfig::throttleInputRcPwm &&
             HardwareConfig::throttleInputPin >= 0) ||
            (HardwareConfig::hasIdleInput && HardwareConfig::idleInputRcPwm &&
             HardwareConfig::idleInputPin >= 0) ||
            (HardwareConfig::hasAfterburner && HardwareConfig::abInputRcPwm &&
             HardwareConfig::abInputPin >= 0);
        for (uint8_t i = 0; i < HardwareConfig::channelRegistry.inputCount && !rcPwmActive; ++i) {
            const auto& input = HardwareConfig::channelRegistry.inputs[i];
            rcPwmActive = ChannelRegistry::channelAddressable(input) &&
                          (input.driver == ChannelRegistry::RcPwm ||
                           input.driver == ChannelRegistry::PwmDuty);
        }
        doc["rc_pwm_active"]         = rcPwmActive;
        doc["limp_throttle_cap"]     = Config::limpMaxThrottlePct;
        doc["fuel_idle_max_pct"]     = Config::throttleIdleMaxPct;  // unified idle ceiling
        doc["fuel_pump_min_pct"]     = Config::fuelPumpMinPct;
        doc["oil_pump_on_pct"]       = Config::oilPumpOnPct;
        doc["has_throttle"]          = HardwareConfig::hasThrottle;
        doc["has_starter"]           = HardwareConfig::hasStarter;
        doc["starter_type"]          = HardwareConfig::starterType;
        doc["has_starter_en"]        = HardwareConfig::hasStarterEn;
        doc["has_fuel_sol"]          = HardwareConfig::hasFuelSol;
        doc["has_igniter"]           = HardwareConfig::hasIgniter;
        doc["has_igniter2"]          = HardwareConfig::hasIgniter2;
        doc["has_ab_sol"]            = HardwareConfig::hasAbSol;
        doc["has_ab_pump"]           = HardwareConfig::hasAbPump;
        doc["has_oil_pump"]          = HardwareConfig::hasOilPump;
        doc["has_dynamic_idle"]      = HardwareConfig::hasDynamicIdle;
        doc["ws_interval_ms"]        = Config::wsIntervalMs;
        bool relightIgnitionOk = false;
        switch (Config::relightIgnitionTarget) {
            case 1: relightIgnitionOk = HardwareConfig::hasIgniter2; break;
            case 2: relightIgnitionOk = HardwareConfig::hasGlowPlug; break;
            default: relightIgnitionOk = HardwareConfig::hasIgniter; break;
        }
        doc["relight_enabled"]       = Config::relightEnabled
                                       && HardwareConfig::hasN1Rpm
                                       && relightIgnitionOk;
        doc["flameout_source"]       = Config::flameoutSource;
        doc["flameout_n1_min_rpm"]   = Config::flameoutN1MinRpm;
        doc["flameout_egt_below_c"]  = Config::flameoutEgtBelowC;
        doc["flameout_egt_fall_rate_c_s"] = Config::flameoutEgtFallRateCPerSec;
        doc["dev_mode_fw"]           = true;
        doc["config_locked"]         = Config::isLocked();
    doc["config_storage_fault"]  = ed.configStorageFault;
    doc["hardware_ready"]        = ed.hardwareReady;
    doc["watchdog_ready"]        = ed.watchdogReady;
    doc["recovery_lockout"]      = ed.recoveryLockout;
    doc["hardware_fault"]        = ed.hardwareFault;
        // Boot-load accept+warn notice (out-of-cap safety limits etc.)
        doc["config_load_warning"]   = Config::loadWarning[0] ? Config::loadWarning : nullptr;
        doc["profile_id"]            = HardwareConfig::profileId;
        doc["ui_theme"]              = Config::uiTheme;
        // Session / boot stats
        doc["run_count"]             = Config::runCount;   // persisted lifetime count
        doc["start_attempt_count"]   = Config::startAttemptCount;
        doc["reset_reason"]          = ed.resetReason;
        // Live hour meter: the persisted total only bumps on stop, so add the
        // in-progress run's elapsed time (real runs only — bench/dev don't count)
        // so the dashboard ticks up during a run instead of looking frozen.
        {
            uint32_t liveTotal = Config::totalRunSeconds;
            if (ed.mode == SysMode::RUNNING && !ed.benchMode && !ed.devMode)
                liveTotal += (millis() - ed.runStartMs) / 1000;
            doc["total_run_seconds"] = liveTotal;
        }
        // Flash usage (cached by tick() — never call LittleFS from async_tcp context)
        doc["log_max_records"]       = FlightRecorder::MAX_RECORDS;
        doc["flash_total_kb"]        = (int)s_fsTotal;
        doc["flash_used_kb"]         = (int)s_fsUsed;
        doc["flash_free_kb"]         = (int)(s_fsTotal - s_fsUsed);
        doc["max_p1"]                = (float)(int)(maxP1Bar * 100) / 100.0f;
        doc["max_p2"]                = (float)(int)(maxP2Bar * 100) / 100.0f;
        // Safety limits (for color gauge thresholds)
        doc["rpm_limit"]             = (int)Config::rpmLimit;
        // Independent hard N2 shutdown limit. Gradual pullback points are sent
        // separately so clients cannot mistake a controller setting for a trip.
        doc["n2_limit"]              = HardwareConfig::safetyN2Overspeed
                                         ? (int)Config::n2RpmLimit : 0;
        doc["n2_pullback_soft"]      = Config::pullbackN2Enabled ? (int)Config::pullbackN2SoftRpm : 0;
        doc["n2_pullback_hard"]      = Config::pullbackN2Enabled ? (int)Config::pullbackN2HardRpm : 0;
        doc["tot_limit"]             = Config::totLimit;
        doc["egt_source"]            = Config::effectiveEgtSource();
        doc["egt_limit"]             = Config::primaryEgtLimitC();
        doc["oil_running_min"]       = Config::oilRunningMin;
        doc["oil_temp_limit"]        = Config::oilTempLimit;
        doc["tit_limit"]             = Config::titLimit;
        doc["batt_volt_min"]         = Config::battVoltMin;
        doc["fuel_press_min"]        = Config::fuelPressMin;
        // has_* capability flags
        doc["has_afterburner"]       = HardwareConfig::hasAfterburner;
        doc["has_ab_flame"]          = HardwareConfig::hasAfterburner && HardwareConfig::hasAbFlame;
        if (HardwareConfig::hasAbFlame) {
            for (uint8_t i = 0; i < HardwareConfig::channelRegistry.inputCount; ++i) {
                const auto& input = HardwareConfig::channelRegistry.inputs[i];
                if (input.installed && !strcmp(input.purpose, "ab_flame") &&
                    ChannelRegistry::isAdcThresholdCondition(input)) {
                    doc["ab_flame_threshold"] = input.digitalThresholdRaw;
                    break;
                }
            }
        }
        doc["has_n1"]                = HardwareConfig::hasN1Rpm;
        doc["has_n2"]                = HardwareConfig::hasTwoShaft && HardwareConfig::hasN2Rpm;
        doc["has_tot"]               = HardwareConfig::hasTot;
        doc["has_oil_press"]         = HardwareConfig::hasOilPress;
        doc["has_flame"]             = HardwareConfig::hasFlame;
        doc["has_p1"]                = HardwareConfig::hasP1;
        doc["has_p2"]                = HardwareConfig::hasP2;
        doc["has_oil_temp"]          = HardwareConfig::hasOilTemp;
        doc["has_batt_voltage"]      = HardwareConfig::hasBattVoltage;
        doc["has_torque"]            = HardwareConfig::hasTorque;
        doc["has_thrust"]            = HardwareConfig::hasThrust;
        doc["has_fuel_press"]        = HardwareConfig::hasFuelPress;
        doc["has_governor"]          = HardwareConfig::hasGovernor;
        doc["has_glow_plug"]         = HardwareConfig::hasGlowPlug;
        doc["glow_plug_output_type"] = HardwareConfig::glowPlugOutputType;
        doc["has_wet_glow"]          = HardwareConfig::hasGlowPlug && HardwareConfig::glowPlugType == 2;
        doc["wet_glow_fuel_type"]    = HardwareConfig::wetGlowFuelType;
        doc["has_glow_current"]      = HardwareConfig::hasGlowPlug && HardwareConfig::hasGlowCurrentSensor;
        doc["has_igniter_current"]   = HardwareConfig::hasIgniter && HardwareConfig::hasIgniterCurrentSensor;
        doc["has_igniter2_current"]  = HardwareConfig::hasIgniter2 && HardwareConfig::hasIgniter2CurrentSensor;
        doc["has_oil_pump_current"]  = HardwareConfig::hasOilPump && HardwareConfig::hasOilPumpCurrentSensor;
        doc["has_bleed_valve"]       = HardwareConfig::hasBleedValve;
        doc["has_prop_pitch"]        = HardwareConfig::hasPropPitch;
        doc["prop_pitch_type"]       = HardwareConfig::propPitchType;
        doc["has_fuel_pump2"]        = HardwareConfig::hasFuelPump2;
        doc["fuel_pump2_type"]       = HardwareConfig::fuelPump2Type;
        doc["has_cool_fan"]          = HardwareConfig::hasCoolFan;
        doc["has_airstarter"]        = HardwareConfig::hasAirstarterSol;
        doc["has_oil_scavenge"]      = HardwareConfig::hasOilScavengePump;
        doc["has_tit"]               = HardwareConfig::hasTit;
        doc["has_pulsed_starter_assist"] = HardwareConfig::hasStarter &&
                                             HardwareConfig::starterType != 2 &&
                                             HardwareConfig::hasN1Rpm;
        // ── Channel labels ────────────────────────────────────────────────
        auto tlbl = doc["labels"].to<JsonObject>();
        tlbl["tot"]        = HardwareConfig::labelTot;
        tlbl["tit"]        = HardwareConfig::labelTit;
        tlbl["n1"]         = HardwareConfig::labelN1;
        tlbl["n2"]         = HardwareConfig::labelN2;
        tlbl["oil_press"]  = HardwareConfig::labelOilPress;
        tlbl["oil_temp"]   = HardwareConfig::labelOilTemp;
        tlbl["p1"]         = HardwareConfig::labelP1;
        tlbl["p2"]         = HardwareConfig::labelP2;
        tlbl["fuel_press"] = HardwareConfig::labelFuelPress;
        tlbl["fuel_flow"]  = HardwareConfig::labelFuelFlow;
        tlbl["stop"]       = HardwareConfig::labelStop;
        tlbl["start"]      = HardwareConfig::labelStart;
        tlbl["ab_arm"]     = HardwareConfig::labelAbArm;
        // ── Sequence validation issues ────────────────────────────────────
        doc["seq_has_errors"] = ed.seqHasErrors;
        doc["seq_has_structural_errors"] = ed.seqHasStructuralErrors;
        auto issArr = doc["seq_issues"].to<JsonArray>();
        for (int i = 0; i < ed.seqIssueCount; i++) {
            auto obj = issArr.add<JsonObject>();
            obj["block"] = ed.seqIssues[i].blockName;
            obj["msg"]   = ed.seqIssues[i].reason;
            obj["error"] = ed.seqIssues[i].isError;
        }
        // ── DI channel config (label / role — state + pin already in fast) ──
        // Clear the fast array before adding full objects; ArduinoJson::to<JsonArray>()
        // returns the existing array when one is already present.
        doc["di_channels"].clear();
        auto diArr = doc["di_channels"].to<JsonArray>();
        for (int i = 0; i < HardwareConfig::MAX_DI; i++) {
            auto ch = diArr.add<JsonObject>();
            ch["state"] = ed.diState[i];
            ch["pin"]   = HardwareConfig::diCh[i].pin;
            if (HardwareConfig::diCh[i].label[0]) {
                ch["label"] = HardwareConfig::diCh[i].label;
            } else {
                char lbuf[8];
                snprintf(lbuf, sizeof(lbuf), "DI-%d", i + 1);
                ch["label"] = lbuf;  // ArduinoJson copies char* (non-const ptr)
            }
            ch["role"] = HardwareConfig::diCh[i].role;
        }
        doc["registry_inputs"].clear();
        auto rin = doc["registry_inputs"].to<JsonArray>();
        for (uint8_t i = 0; i < HardwareConfig::channelRegistry.inputCount; i++) {
            const auto& c = HardwareConfig::channelRegistry.inputs[i];
            auto ch = rin.add<JsonObject>();
            ch["id"] = c.id;
            ch["name"] = c.name;
            ch["role"] = c.role;
            ch["purpose"] = c.purpose;
            ch["driver"] = (uint8_t)c.driver;
            ch["pin"] = c.pin;
            ch["min"] = c.minValue;
            ch["max"] = c.maxValue;
            ch["active_high"] = c.activeHigh;
            ch["pullup"] = c.pullup;
            ch["pulldown"] = c.pulldown;
            ch["invert"] = c.inverted;
            ch["value"] = (float)(int)(ed.registryInputValue[i] * 1000) / 1000.0f;
            ch["healthy"] = ed.registryInputHealthy[i];
        }
        doc["registry_outputs"].clear();
        auto rout = doc["registry_outputs"].to<JsonArray>();
        for (uint8_t i = 0; i < HardwareConfig::channelRegistry.outputCount; i++) {
            const auto& c = HardwareConfig::channelRegistry.outputs[i];
            auto ch = rout.add<JsonObject>();
            ch["id"] = c.id;
            ch["name"] = c.name;
            ch["role"] = c.role;
            ch["purpose"] = c.purpose;
            ch["driver"] = (uint8_t)c.driver;
            ch["pin"] = c.pin;
            ch["min"] = c.minValue;
            ch["max"] = c.maxValue;
            ch["safe_demand"] = c.safeDemand;
            ch["force_safe_on_fault"] = c.forceSafeOnFault;
            ch["min_run_demand"] = c.minimumRunDemand;
            ch["invert"] = c.inverted;
            ch["has_current"] = c.hasCurrent;
            ch["current_pin"] = c.currentPin;
            ch["current_mv_a"] = c.currentMvPerA;
            ch["current_zero_v"] = c.currentZeroV;
            ch["current_max_a"] = c.currentMaxAmps;
            ch["has_flow_monitor"] = c.hasFlowMonitor;
            ch["minimum_flow_l_min"] = c.minimumFlow;
            ch["demand"] = (float)(int)(ed.registryOutputDemand[i] * 1000) / 1000.0f;
            ch["current_amps"] = (float)(int)(ed.registryOutputCurrentAmps[i] * 100) / 100.0f;
            ch["current_healthy"] = ed.registryOutputCurrentHealthy[i];
        }
    }
    return _serializeJsonBounded(doc, buf, len);
}

// ── Route setup ───────────────────────────────────────────────
void WebServer::_setupRoutes() {
    // ── Captive portal redirect ───────────────────────────────
    // Phones check connectivity by fetching well-known URLs (generate_204,
    // hotspot-detect.html, etc.).  Any request whose Host header is not our
    // IP or "ot.local" gets a 302 → dashboard so the OS pops up the captive
    // portal browser automatically.
    auto isCaptive = [](AsyncWebServerRequest* req) -> bool {
        String host = req->host();
        // allow direct IP and our mDNS hostname
        if (host == WiFi.softAPIP().toString()) return false;
        if (host == "ot.local")                 return false;
        return true;
    };
    auto redirectCaptiveToIp = [isCaptive](AsyncWebServerRequest* req) -> bool {
        if (!isCaptive(req)) return false;
        String target = "http://";
        target += WiFi.softAPIP().toString();
        target += req->url();
        req->redirect(target);
        return true;
    };

    // ── Captive portal landing ─────────────────────────────────
    // Serve a SMALL, self-contained landing page to OS captive probes — NOT the full
    // dashboard. The dashboard opens a WebSocket, and the OS captive-portal mini-browser
    // (CNA/WebView) that shows this page would then hold the single /ws slot
    // (cleanupClients keeps only 1), starving the real browser's dashboard/hardware pages
    // and forcing them onto the slow status-poll fallback. A static page with a link keeps
    // the /ws slot free and gives a clearer "open in your browser" prompt.
    auto sendPortalPage = [](AsyncWebServerRequest* req) {
        String ip = WiFi.softAPIP().toString();
        String html = F("<!DOCTYPE html><html><head><meta charset=utf-8>"
            "<meta name=viewport content=\"width=device-width,initial-scale=1\">"
            "<title>OpenTurbine</title></head>"
            "<body style=\"font-family:system-ui,-apple-system,sans-serif;background:#101012;"
            "color:#eee;text-align:center;padding:2.2rem 1rem;margin:0\">"
            "<h2 style=\"margin:.2rem 0 1rem\">OpenTurbine</h2>"
            "<p style=\"color:#bbb\">Open the control panel in your browser.</p>"
            "<p><a href=\"http://");
        html += ip;
        html += F("/\" style=\"display:inline-block;padding:.85rem 1.5rem;background:#ee7620;"
            "color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:1.05rem\">"
            "Open Control Panel</a></p>"
            "<p style=\"color:#888;font-size:.85rem;margin-top:1.4rem\">or type <b>");
        html += ip;
        html += F("</b> into Safari or Chrome</p></body></html>");
        auto* resp = req->beginResponse(200, "text/html", html);
        resp->addHeader("Cache-Control", "no-store");
        req->send(resp);
    };
    // Redirect the OS connectivity probes to the portal with a 302 + Location header.
    // A bare 200 page leaves Windows unable to learn the portal URL, so it opens its own
    // default (msn.com) instead. The Location points at a lightweight /portal page (no
    // WebSocket) so it never hogs the single /ws slot.
    auto redirectToPortal = [](AsyncWebServerRequest* req) {
        auto* resp = req->beginResponse(302, "text/plain", "");
        resp->addHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/portal");
        resp->addHeader("Cache-Control", "no-store");
        req->send(resp);
    };
    _server.on("/portal", HTTP_GET, sendPortalPage);
    _server.on("/generate_204", HTTP_GET, redirectToPortal);
    _server.on("/gen_204", HTTP_GET, redirectToPortal);          // some Android builds
    _server.on("/hotspot-detect.html", HTTP_GET, redirectToPortal);
    _server.on("/library/test/success.html", HTTP_GET, redirectToPortal);
    _server.on("/connecttest.txt", HTTP_GET, redirectToPortal);
    _server.on("/ncsi.txt", HTTP_GET, redirectToPortal);
    _server.on("/fwlink", HTTP_GET, redirectToPortal);
    _server.on("/redirect", HTTP_GET, redirectToPortal);
    _server.on("/canonical.html", HTTP_GET, redirectToPortal);

    // Shared assets are versioned by the ?v= token in each HTML page. Let the
    // browser reuse them while navigating; repeatedly streaming CSS/JS in
    // parallel with large HTML pages can overrun the ESP AP/LittleFS path and
    // produce truncated responses in Chrome.
    _server.on("/app.js", HTTP_GET, [](AsyncWebServerRequest* req) {
        _sendGzipAsset(req, "/app.js.gz", "application/javascript", SHARED_ASSET_CACHE);
    });
    _server.on("/style.css", HTTP_GET, [](AsyncWebServerRequest* req) {
        _sendGzipAsset(req, "/style.css.gz", "text/css", SHARED_ASSET_CACHE);
    });
    _server.on("/theme.js", HTTP_GET, [](AsyncWebServerRequest* req) {
        _sendGzipAsset(req, "/theme.js.gz", "application/javascript", SHARED_ASSET_CACHE);
    });
    _server.on("/ui_dialog.js", HTTP_GET, [](AsyncWebServerRequest* req) {
        _sendGzipAsset(req, "/ui_dialog.js.gz", "application/javascript", SHARED_ASSET_CACHE);
    });
    _server.on("/", HTTP_GET, [redirectCaptiveToIp](AsyncWebServerRequest* req) {
        if (redirectCaptiveToIp(req)) return;
        _sendGzipAsset(req, "/index.html.gz", "text/html", PAGE_ASSET_CACHE);
    });
    _server.on("/index.html", HTTP_GET, [redirectCaptiveToIp](AsyncWebServerRequest* req) {
        if (redirectCaptiveToIp(req)) return;
        _sendGzipAsset(req, "/index.html.gz", "text/html", PAGE_ASSET_CACHE);
    });
    _server.on("/hardware.html", HTTP_GET, [redirectCaptiveToIp](AsyncWebServerRequest* req) {
        if (redirectCaptiveToIp(req)) return;
        _sendGzipAsset(req, "/hardware.html.gz", "text/html", PAGE_ASSET_CACHE);
    });
    _server.on("/calibration.html", HTTP_GET, [redirectCaptiveToIp](AsyncWebServerRequest* req) {
        if (redirectCaptiveToIp(req)) return;
        _sendGzipAsset(req, "/calibration.html.gz", "text/html", PAGE_ASSET_CACHE);
    });
    _server.on("/config.html", HTTP_GET, [redirectCaptiveToIp](AsyncWebServerRequest* req) {
        if (redirectCaptiveToIp(req)) return;
        _sendGzipAsset(req, "/config.html.gz", "text/html", PAGE_ASSET_CACHE);
    });
    _server.on("/sequence.html", HTTP_GET, [redirectCaptiveToIp](AsyncWebServerRequest* req) {
        if (redirectCaptiveToIp(req)) return;
        _sendGzipAsset(req, "/sequence.html.gz", "text/html", PAGE_ASSET_CACHE);
    });
    _server.on("/log.html", HTTP_GET, [redirectCaptiveToIp](AsyncWebServerRequest* req) {
        if (redirectCaptiveToIp(req)) return;
        _sendGzipAsset(req, "/log.html.gz", "text/html", PAGE_ASSET_CACHE);
    });
    _server.on("/tools.html", HTTP_GET, [redirectCaptiveToIp](AsyncWebServerRequest* req) {
        if (redirectCaptiveToIp(req)) return;
        _sendGzipAsset(req, "/tools.html.gz", "text/html", PAGE_ASSET_CACHE);
    });
    _server.on("/ecu_config.json", HTTP_GET, [](AsyncWebServerRequest* req) {
        req->send(403, "text/plain", "Forbidden");
    });
    _server.on("/hardware.json", HTTP_GET, [](AsyncWebServerRequest* req) {
        req->send(403, "text/plain", "Forbidden");
    });

    // GET /api/data — live snapshot. Uses g_webTxBuf (static) to avoid a 6 KB stack
    // allocation inside the async TCP task callback (task stack is ~8 KB).
    _server.on("/api/data", HTTP_GET, [](AsyncWebServerRequest* req) {
        static JsonDocument doc;   // static: avoids re-allocating ArduinoJson heap every call
        size_t n = _buildTelemetry(g_webTxBuf, sizeof(g_webTxBuf), doc, true);
        if (n >= sizeof(g_webTxBuf)) {
            AsyncWebServerResponse* resp = req->beginResponse(
                500, "application/json", "{\"error\":\"telemetry frame too large\"}");
            _finalizeJsonResponse(resp);
            req->send(resp);
            return;
        }
        // The full boot snapshot builds a large ArduinoJson tree. Retaining its
        // pool on Classic ESP32 can starve a following hardware/configuration
        // POST even though the serialized frame is already safe in g_webTxBuf.
        doc.clear();
        doc.shrinkToFit();
        _sendBorrowedWebRxJson(req, g_webTxBuf, n);
    });

    // GET /api/status
    _server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest* req) {
        auto& ed = EngineData::instance();
        char buf[240];
        snprintf(buf, sizeof(buf),
            "{\"mode\":\"%s\",\"locked\":%s,\"profile_match\":%s,\"config_apply_busy\":%s,"
            "\"free_heap\":%u,\"max_alloc_heap\":%u}",
            sysModeStr(ed.mode),
            Config::isLocked() ? "true" : "false",
            Config::profileMatch ? "true" : "false",
            ConfigApplyGate::busy() ? "true" : "false",
            static_cast<unsigned>(ESP.getFreeHeap()),
            static_cast<unsigned>(ESP.getMaxAllocHeap()));
        AsyncWebServerResponse* resp = req->beginResponse(200, "application/json", buf);
        _finalizeJsonResponse(resp);
        req->send(resp);
    });

    // GET /api/device_info - updater-friendly board identity and maintenance state.
    _server.on("/api/device_info", HTTP_GET, [](AsyncWebServerRequest* req) {
        auto& ed = EngineData::instance();
#if defined(OT_PLATFORM_ESP32S3)
        const char* target = "esp32s3dev";
        const char* chip = "ESP32-S3";
#else
        const char* target = "esp32dev";
        const char* chip = "ESP32";
#endif
        const bool standbyLike = _isStandbyLike(ed.mode);
        const bool outputsActive = _outputsActiveForOta();
        const bool otaAllowed = standbyLike && !outputsActive && !_maintenanceUploadInProgress();

        JsonDocument doc;
        char buildId[17] = {};
        static constexpr char HEX_DIGITS[] = "0123456789abcdef";
        const uint8_t* elfSha = esp_app_get_description()->app_elf_sha256;
        for (uint8_t i = 0; i < 8; ++i) {
            buildId[i * 2] = HEX_DIGITS[elfSha[i] >> 4];
            buildId[i * 2 + 1] = HEX_DIGITS[elfSha[i] & 0x0F];
        }
        doc["project"] = "OpenTurbine";
        doc["firmware_version"] = OT_VERSION;
        doc["build_id"] = buildId;
        doc["target"] = target;
        doc["chip"] = chip;
        doc["state"] = sysModeStr(ed.mode);
        doc["outputs_active"] = outputsActive;
        doc["ota_allowed"] = otaAllowed;
        JsonObject pcb = doc["pcb_profile"].to<JsonObject>();
        PcbProfileManager::toJson(pcb, false);
        size_t n = serializeJson(doc, g_webTxBuf, sizeof(g_webTxBuf));
        _sendOwnedJson(req, g_webTxBuf, n);
    });

    // GET /api/config — expose the settings section for page editors.
    // Serialize into the static TX buffer and send with a fixed
    // Content-Length (same path as /api/data). AsyncResponseStream silently
    // truncates a large JSON under AP heap pressure — serializeJson ignores
    // the stream's short writes — which the editor pages saw as
    // "Unterminated string in JSON".
    _server.on("/api/config", HTTP_GET, [](AsyncWebServerRequest* req) {
        JsonDocument doc;
        Config::toJson(doc);
        if (measureJson(doc) + 1 > sizeof(g_webTxBuf)) {
            AsyncWebServerResponse* resp = req->beginResponse(
                500, "application/json", "{\"error\":\"config response too large\"}");
            _finalizeJsonResponse(resp);
            req->send(resp);
            return;
        }
        size_t n = serializeJson(doc, g_webTxBuf, sizeof(g_webTxBuf));
        doc.clear();
        doc.shrinkToFit();
        _sendBorrowedWebRxJson(req, g_webTxBuf, n);
    });

    // POST /api/config — replace only the settings section in ecu_config.json.
    // Body is accumulated across chunks before parsing — this section is ~2-3 KB
    // and may arrive in multiple TCP segments.
    _server.on("/api/config", HTTP_POST,
        [](AsyncWebServerRequest* req) {},
        nullptr,
        [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
            if (index == 0 && _maintenanceUploadInProgress()) {
                req->send(423, "application/json", "{\"error\":\"maintenance upload in progress\"}");
                return;
            }
            if (!_appendWebRx(req, data, len, index)) return;
            if (index + len < total) return;   // wait for more chunks
            WebRxRelease release(req);
            if (g_webRxOverflow) {
                req->send(400, "application/json", "{\"error\":\"request body too large\"}");
                return;
            }
            auto& patchEdBeforeGate = EngineData::instance();
            const bool liveWindowBeforeGate =
                patchEdBeforeGate.mode == SysMode::RUNNING && patchEdBeforeGate.devMode;
            if (Config::isLocked() && !liveWindowBeforeGate) {
                req->send(423, "application/json", "{\"error\":\"settings are read-only during STARTUP and SHUTDOWN; RUNNING permits only marked live fields when Developer Mode was enabled before start\"}");
                return;
            }
            if (!_isStandbyLike(EngineData::instance().mode)) {
                req->send(423, "application/json", "{\"error\":\"full settings replacement is available only while not running; use PATCH for fields marked Applies live\"}");
                return;
            }
            if (!ConfigApplyGate::tryBeginWebWrite()) {
                req->send(409, "application/json", "{\"error\":\"START transition or another configuration update is in progress\"}");
                return;
            }
            auto& patchEdAfterGate = EngineData::instance();
            const bool liveWindowAfterGate =
                patchEdAfterGate.mode == SysMode::RUNNING && patchEdAfterGate.devMode;
            if (Config::isLocked() && !liveWindowAfterGate) {
                ConfigApplyGate::release();
                req->send(409, "application/json", "{\"error\":\"configuration became locked before it could be applied\"}");
                return;
            }
            if (!_isStandbyLike(EngineData::instance().mode)) {
                ConfigApplyGate::release();
                req->send(409, "application/json", "{\"error\":\"engine became active before full settings replacement\"}");
                return;
            }
            JsonDocument incoming;
            if (deserializeJson(incoming, g_webRxBuf, g_webRxLen) !=
                    DeserializationError::Ok ||
                !Config::validateJson(incoming)) {
                ConfigApplyGate::release();
                req->send(400, "application/json", "{\"ok\":false,\"error\":\"settings rejected - check JSON and loaded engine profile_id\"}");
                return;
            }
            char* candidateJson = nullptr;
            size_t candidateLen = 0;
            bool ok = Config::persistJsonCandidateReleasing(incoming, candidateJson, candidateLen);
            if (!ok) {
                ConfigApplyGate::release();
                req->send(500, "application/json", "{\"ok\":false,\"error\":\"settings were valid but could not be written to storage\"}");
                return;
            }
            bool active = !_isStandbyLike(EngineData::instance().mode);
            // Release HTTP request/response memory before Core 1 constructs
            // the complete runtime tree. The gate keeps START and another save
            // blocked until this exact persisted generation has been applied.
            ConfigApplyGate::publishCandidate(candidateJson, candidateLen, 250);
            req->send(200, "application/json", active
                ? "{\"ok\":true,\"saved\":true,\"applying\":true,\"live_now\":false}"
                : "{\"ok\":true,\"saved\":true,\"applying\":true}");
        });

    // PATCH /api/config — partial update to the settings section.
    // Merges incoming JSON over the current settings and saves the unified engine file.
    _server.on("/api/config", HTTP_PATCH,
        [](AsyncWebServerRequest* req) {},
        nullptr,
        [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
            if (index == 0 && _maintenanceUploadInProgress()) {
                req->send(423, "application/json", "{\"error\":\"maintenance upload in progress\"}");
                return;
            }
            if (!_appendWebRx(req, data, len, index)) return;
            if (index + len < total) return;   // wait for more chunks
            WebRxRelease release(req);
            if (g_webRxOverflow) {
                req->send(400, "application/json", "{\"error\":\"request body too large\"}");
                return;
            }
            auto& patchEdBeforeGate = EngineData::instance();
            const bool liveWindowBeforeGate =
                patchEdBeforeGate.mode == SysMode::RUNNING && patchEdBeforeGate.devMode;
            if (Config::isLocked() && !liveWindowBeforeGate) {
                req->send(423, "application/json", "{\"error\":\"settings are read-only during STARTUP and SHUTDOWN; RUNNING permits only marked live fields when Developer Mode was enabled before start\"}");
                return;
            }
            if (!ConfigApplyGate::tryBeginWebWrite()) {
                req->send(409, "application/json", "{\"error\":\"START transition or another configuration update is in progress\"}");
                return;
            }
            auto& patchEdAfterGate = EngineData::instance();
            const bool liveWindowAfterGate =
                patchEdAfterGate.mode == SysMode::RUNNING && patchEdAfterGate.devMode;
            if (Config::isLocked() && !liveWindowAfterGate) {
                ConfigApplyGate::release();
                req->send(409, "application/json", "{\"error\":\"configuration became locked before it could be applied\"}");
                return;
            }
            JsonDocument patch;
            if (deserializeJson(patch, g_webRxBuf, g_webRxLen) != DeserializationError::Ok) {
                ConfigApplyGate::release();
                req->send(400, "application/json", "{\"error\":\"bad json\"}");
                return;
            }
            const SysMode patchMode = EngineData::instance().mode;
            const bool activePatch = !_isStandbyLike(patchMode);
            if (activePatch &&
                (patchMode != SysMode::RUNNING ||
                 !EngineData::instance().devMode ||
                 !_runtimeTuningPatchAllowed(patch.as<JsonObjectConst>()))) {
                ConfigApplyGate::release();
                req->send(423, "application/json",
                    "{\"ok\":false,\"error\":\"while running, only fields marked Applies live may be changed; stop the engine for all other settings\"}");
                return;
            }
            if (activePatch && !_runtimeGovernorAuthorityPreserved(patch.as<JsonObjectConst>())) {
                ConfigApplyGate::release();
                req->send(423, "application/json",
                    "{\"ok\":false,\"error\":\"Pitch Gain cannot cross zero while running because that would transfer governor authority between fuel and propeller pitch; stop the turbine to change control mode\"}");
                return;
            }
            // Load current config into a document, merge patch on top, re-apply.
            // Recursive merge keeps sibling fields inside nested sections.
            JsonDocument current;
            Config::toJson(current);
            _mergeJsonObject(current.as<JsonObject>(), patch.as<JsonObjectConst>());
            if (!Config::validateJson(current)) {
                ConfigApplyGate::release();
                req->send(400, "application/json",
                    "{\"ok\":false,\"error\":\"settings validation failed; reload Config and review invalid values\"}");
                return;
            }
            if (strcmp(current["profile_id"] | "", HardwareConfig::profileId) != 0) {
                ConfigApplyGate::release();
                req->send(409, "application/json",
                    "{\"ok\":false,\"error\":\"engine profile mismatch\"}");
                return;
            }
            patch.clear();
            patch.shrinkToFit();
            char* candidateJson = nullptr;
            size_t candidateLen = 0;
            bool ok = Config::persistJsonCandidateReleasing(current, candidateJson, candidateLen);
            if (!ok) {
                ConfigApplyGate::release();
                req->send(500, "application/json",
                    "{\"ok\":false,\"error\":\"settings were valid but could not be written to storage\"}");
                return;
            }
            FlightRecorder::logConfigChange("config.patch", 0, 0);
            bool active = !_isStandbyLike(EngineData::instance().mode);
            ConfigApplyGate::publishCandidate(candidateJson, candidateLen, 250);
            req->send(200, "application/json", active
                ? "{\"ok\":true,\"saved\":true,\"applying\":true,\"live_now\":false}"
                : "{\"ok\":true,\"saved\":true,\"applying\":true}");
        });

    // GET /api/theme — tiny first-visit bootstrap. Avoid downloading the full
    // telemetry/config snapshot merely to adopt the ECU's saved appearance.
    _server.on("/api/theme", HTTP_GET, [](AsyncWebServerRequest* req) {
        char body[48];
        snprintf(body, sizeof(body), "{\"theme\":\"%s\"}", Config::uiTheme);
        req->send(200, "application/json", body);
    });

    // POST /api/theme?t=<key> — persist the web UI theme into ecu_config.json so it
    // travels with the engine file. Cosmetic: not mode-gated, no APPLY_CONFIG, no event log.
    _server.on("/api/theme", HTTP_POST, [](AsyncWebServerRequest* req) {
        if (!req->hasParam("t")) {
            req->send(400, "application/json", "{\"ok\":false,\"error\":\"missing t\"}");
            return;
        }
        String t = req->getParam("t")->value();
        static const char* const VALID[] = { "carbon", "ember", "slate", "midnight", "contrast", "daylight" };
        bool ok = false;
        for (const char* v : VALID) if (t == v) { ok = true; break; }
        if (!ok) {
            req->send(400, "application/json", "{\"ok\":false,\"error\":\"unknown theme\"}");
            return;
        }
        strncpy(Config::uiTheme, t.c_str(), sizeof(Config::uiTheme) - 1);
        Config::uiTheme[sizeof(Config::uiTheme) - 1] = '\0';
        Config::requestSave();
        req->send(200, "application/json", "{\"ok\":true,\"persist\":\"deferred_until_safe\"}");
    });

    // GET /api/log/raw — full event log download as NDJSON (one JSON object per line).
    // Uses AsyncFileResponse: reads LittleFS in 1460-byte TCP chunks without heap buffering.
    _server.on("/api/log/raw", HTTP_GET, [](AsyncWebServerRequest* req) {
        if (!_isStandbyLike(EngineData::instance().mode) || Config::logStandby) {
            req->send(423, "application/json",
                "{\"error\":\"Raw log download requires STANDBY with standby logging disabled\"}");
            return;
        }
        if (!LittleFS.exists(FlightRecorder::PATH)) {
            req->send(404, "text/plain", "No log");
            return;
        }
        if (!_gateLogRead(req)) return;
        FlightRecorder::beginRawDownload();
        req->onDisconnect([req]() {
            FlightRecorder::endRawDownload();
            _releaseLogRead(req);
        });
        AsyncWebServerResponse* resp = req->beginResponse(
            LittleFS, FlightRecorder::PATH, "application/x-ndjson");
        resp->addHeader("Content-Disposition", "attachment; filename=\"event_log.ndjson\"");
        resp->addHeader("Cache-Control", "no-store");
        resp->addHeader("Connection", "close");
        req->send(resp);
    });

    // GET /api/log/csv — spreadsheet-friendly recent event export.
    // AsyncResponseStream is heap-buffered, so keep this bounded like /api/log.
    // Use /api/log/raw for the complete zero-copy NDJSON download.
    _server.on("/api/log/csv", HTTP_GET, [](AsyncWebServerRequest* req) {
        if (!_isStandbyLike(EngineData::instance().mode) || Config::logStandby) {
            req->send(423, "application/json",
                "{\"error\":\"Log download requires STANDBY with standby logging disabled\"}");
            return;
        }
        if (!_gateLogRead(req)) return;
        req->onDisconnect([req]() { _releaseLogRead(req); });
        // Keep the heap-backed CSV response below the ESP async-stream ceiling.
        // Full history remains available from the zero-copy /api/log/raw route.
        const int DISPLAY_LIMIT = 120;
        AsyncResponseStream* resp = req->beginResponseStream("text/csv");
        resp->addHeader("Content-Disposition", "attachment; filename=\"event_log.csv\"");
        resp->print("t,ev,details\r\n");
        FlightRecorder::lockLog();
        File f = LittleFS.open(FlightRecorder::PATH, "r");
        int total = FlightRecorder::recordCount();
        int skip  = total > DISPLAY_LIMIT ? total - DISPLAY_LIMIT : 0;
        int seen  = 0;
        if (f) {
            JsonDocument doc;   // declared once outside the loop — avoids 2200× heap alloc/free
            char lineBuf[640];
            while (f.available()) {
                int n = f.readBytesUntil('\n', lineBuf, sizeof(lineBuf) - 1);
                if (n <= 0) continue;
                while (n > 0 && (lineBuf[n - 1] == '\r' || lineBuf[n - 1] == ' ' ||
                                 lineBuf[n - 1] == '\t')) n--;
                if (n > 0 && lineBuf[n - 1] == ',') n--;
                while (n > 0 && (lineBuf[n - 1] == ' ' || lineBuf[n - 1] == '\t')) n--;
                lineBuf[n] = '\0';
                if (n < 2 || lineBuf[0] != '{' || lineBuf[n - 1] != '}') continue;
                if (seen++ < skip) continue;
                doc.clear();
                if (deserializeJson(doc, lineBuf)) continue;
                unsigned long t  = doc["t"] | 0UL;
                const char*   ev = doc["ev"] | "";
                char detail[220] = {};
                int  dpos = 0;
                for (JsonPair kv : doc.as<JsonObject>()) {
                    if (strcmp(kv.key().c_str(), "t")  == 0) continue;
                    if (strcmp(kv.key().c_str(), "ev") == 0) continue;
                    if (dpos > 0 && dpos < (int)sizeof(detail) - 1) detail[dpos++] = ' ';
                    dpos += snprintf(detail + dpos, sizeof(detail) - dpos,
                                     "%s=%s", kv.key().c_str(),
                                     kv.value().as<const char*>() ? kv.value().as<const char*>()
                                                                   : kv.value().as<String>().c_str());
                    if (dpos >= (int)sizeof(detail) - 1) break;
                }
                resp->print(t);
                resp->print(',');
                _printCsvField(*resp, ev);
                resp->print(',');
                _printCsvField(*resp, detail);
                resp->print("\r\n");
            }
            f.close();
        }
        FlightRecorder::unlockLog();
        resp->addHeader("Cache-Control", "no-store");
        resp->addHeader("Connection", "close");
        req->send(resp);
    });

    // Frequent dynamic data only. Static labels, limits, capabilities and
    // registry metadata remain in the one-time /api/data boot snapshot.
    _server.on("/api/telemetry", HTTP_GET, [](AsyncWebServerRequest* req) {
        size_t n = _buildTelemetry(g_webTxBuf, sizeof(g_webTxBuf), s_restTelemetryDoc, false);
        if (n >= sizeof(g_webTxBuf)) {
            req->send(500, "application/json", "{\"error\":\"telemetry response too large\"}");
            return;
        }
        _sendOwnedJson(req, g_webTxBuf, n);
    });

    // Register the base route after /raw and /csv. ESPAsyncWebServer matches
    // path prefixes, so placing /api/log first would steal both download routes.
    // The display response is capped so AsyncResponseStream stays bounded.
    _server.on("/api/log", HTTP_GET, [](AsyncWebServerRequest* req) {
        if (!_isStandbyLike(EngineData::instance().mode) || Config::logStandby) {
            req->send(423, "application/json",
                "{\"error\":\"Log viewing requires STANDBY with standby logging disabled\"}");
            return;
        }
        if (!_gateLogRead(req)) return;
        req->onDisconnect([req]() { _releaseLogRead(req); });
        // Typical 120-record payloads stay comfortably below the async response
        // stream's practical ~16 KB ceiling even with several connected clients.
        const int DISPLAY_LIMIT = 120;
        AsyncResponseStream* resp = req->beginResponseStream("application/json");
        FlightRecorder::lockLog();
        File f = LittleFS.open(FlightRecorder::PATH, "r");
        int total = FlightRecorder::recordCount();
        int skip  = total > DISPLAY_LIMIT ? total - DISPLAY_LIMIT : 0;
        resp->print('[');
        bool first = true;
        int  seen  = 0;
        if (f) {
            char lineBuf[640];
            while (f.available()) {
                int n = f.readBytesUntil('\n', lineBuf, sizeof(lineBuf) - 1);
                if (n <= 0) continue;
                while (n > 0 && (lineBuf[n - 1] == '\r' || lineBuf[n - 1] == ' ' ||
                                 lineBuf[n - 1] == '\t')) n--;
                // Older/interrupted writes may contain a trailing array comma.
                // Strip it and require a complete object so one damaged record
                // can never invalidate the entire in-browser JSON response.
                if (n > 0 && lineBuf[n - 1] == ',') n--;
                while (n > 0 && (lineBuf[n - 1] == ' ' || lineBuf[n - 1] == '\t')) n--;
                lineBuf[n] = '\0';
                if (n < 2 || lineBuf[0] != '{' || lineBuf[n - 1] != '}') continue;
                if (seen++ < skip) continue;
                if (!first) resp->print(',');
                first = false;
                resp->print(lineBuf);
            }
            f.close();
        }
        resp->print(']');
        FlightRecorder::unlockLog();
        _finalizeJsonResponse(resp);
        req->send(resp);
    });

    // POST /api/start
    _server.on("/api/start", HTTP_POST, [](AsyncWebServerRequest* req) {
        if (_maintenanceUploadInProgress()) {
            req->send(423, "application/json", "{\"ok\":false,\"error\":\"Maintenance upload in progress\"}");
            return;
        }
        // Report the reject reason via the HTTP response only.  EngineData
        // strings are Core-1-owned; writing them from async_tcp (Core 0) races
        // the ECU loop's own fault/event writes (CommandQueue-only rule).
        if (const char* reject = _startPreflightRejectReason()) {
            _sendCommandReject(req, 409, reject);
            return;
        }
        const uint32_t requestId = CommandQueue::nextRequestId();
        CommandQueue::beginResult(requestId);
        OTPacket packet{OTCommand::START};
        packet.requestId = requestId;
        if (!CommandQueue::push(packet)) {
            req->send(503, "application/json", "{\"ok\":false,\"error\":\"Command queue full\"}");
            return;
        }
        bool accepted = false;
        char reason[120] = {};
        if (!CommandQueue::waitResult(requestId, 150, accepted, reason, sizeof(reason))) {
            if (CommandQueue::cancelPendingResult(requestId)) {
                req->send(504, "application/json",
                    "{\"ok\":false,\"error\":\"ECU core did not claim START in time; request canceled\"}");
                return;
            }
            // The ECU atomically claimed the request before cancellation. Its
            // decision path is synchronous; wait for that definitive result.
            if (!CommandQueue::waitResult(requestId, 1000, accepted, reason, sizeof(reason))) {
                req->send(504, "application/json",
                    "{\"ok\":false,\"error\":\"ECU reset or became unavailable while deciding START; verify ECU state before retrying\"}");
                return;
            }
        }
        if (!accepted) {
            _sendCommandReject(req, 409, reason);
        } else {
            snprintf(g_webTxBuf, sizeof(g_webTxBuf),
                     "{\"ok\":true,\"started\":true,\"request_id\":%lu}",
                     (unsigned long)requestId);
            req->send(200, "application/json", g_webTxBuf);
        }
    });

    // POST /api/stop
    _server.on("/api/stop", HTTP_POST, [](AsyncWebServerRequest* req) {
        if (CommandQueue::pushEmergencyStop({ OTCommand::STOP })) {
            req->send(200, "application/json", "{\"ok\":true}");
        } else {
            req->send(503, "application/json", "{\"ok\":false,\"error\":\"STOP could not be queued\"}");
        }
    });

    // POST /api/command — generic command dispatch
    _server.on("/api/command", HTTP_POST,
        [](AsyncWebServerRequest* req) {},
        nullptr,
        [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
            if (!_appendWebRx(req, data, len, index)) return;
            if (index + len < total) return;
            WebRxRelease release(req);
            if (g_webRxOverflow) { req->send(400, "application/json", "{\"error\":\"request too large\"}"); return; }
            static JsonDocument doc;   // static: one allocation reused across all /api/command calls
            doc.clear();
            if (deserializeJson(doc, g_webRxBuf, g_webRxLen)) {
                req->send(400); return;
            }
            const char* cmdStr = doc["cmd"] | "";
            OTPacket pkt;
            if      (strcmp(cmdStr, "FUEL_PRIME")     == 0) pkt.cmd = OTCommand::FUEL_PRIME;
            else if (strcmp(cmdStr, "OIL_PRIME")      == 0) pkt.cmd = OTCommand::OIL_PRIME;
            else if (strcmp(cmdStr, "IGN_TEST")       == 0) pkt.cmd = OTCommand::IGN_TEST;
            else if (strcmp(cmdStr, "IGN2_TEST")      == 0) pkt.cmd = OTCommand::IGN2_TEST;
            else if (strcmp(cmdStr, "START_TEST")     == 0) pkt.cmd = OTCommand::START_TEST;
            else if (strcmp(cmdStr, "FUEL_SOL_TEST")        == 0) pkt.cmd = OTCommand::FUEL_SOL_TEST;
            else if (strcmp(cmdStr, "IDLE_TEST")            == 0) pkt.cmd = OTCommand::IDLE_TEST;
            else if (strcmp(cmdStr, "TOGGLE_DYNAMIC_IDLE")  == 0) pkt.cmd = OTCommand::TOGGLE_DYNAMIC_IDLE;
            else if (strcmp(cmdStr, "TOGGLE_LIMP_MODE")     == 0) pkt.cmd = OTCommand::TOGGLE_LIMP_MODE;
            else if (strcmp(cmdStr, "TOGGLE_DEV_MODE")        == 0) pkt.cmd = OTCommand::TOGGLE_DEV_MODE;
            else if (strcmp(cmdStr, "TOGGLE_SAFETY_CHECKS")  == 0) pkt.cmd = OTCommand::TOGGLE_SAFETY_CHECKS;
            else if (strcmp(cmdStr, "TOGGLE_BENCH_MODE")     == 0) pkt.cmd = OTCommand::TOGGLE_BENCH_MODE;
            else if (strcmp(cmdStr, "SET_OIL_PCT")          == 0) pkt.cmd = OTCommand::SET_OIL_PCT;
            else if (strcmp(cmdStr, "SET_THROTTLE_PCT")     == 0) pkt.cmd = OTCommand::SET_THROTTLE_PCT;
            else if (strcmp(cmdStr, "SET_OIL_DEMAND")        == 0) pkt.cmd = OTCommand::SET_OIL_DEMAND;
            else if (strcmp(cmdStr, "EXTRA_COOLDOWN")        == 0) pkt.cmd = OTCommand::EXTRA_COOLDOWN;
            else if (strcmp(cmdStr, "PULSED_STARTER_ASSIST_TEST") == 0) pkt.cmd = OTCommand::PULSED_STARTER_ASSIST_TEST;
            else if (strcmp(cmdStr, "CLEAR_LOG")            == 0) pkt.cmd = OTCommand::CLEAR_LOG;
            else if (strcmp(cmdStr, "AB_FIRE")              == 0) pkt.cmd = OTCommand::AB_FIRE;
            else if (strcmp(cmdStr, "AB_STOP")              == 0) pkt.cmd = OTCommand::AB_STOP;
            else if (strcmp(cmdStr, "OIL_SCAV_TEST")        == 0) pkt.cmd = OTCommand::OIL_SCAV_TEST;
            else if (strcmp(cmdStr, "COOL_FAN_TEST")        == 0) pkt.cmd = OTCommand::COOL_FAN_TEST;
            else if (strcmp(cmdStr, "AIRSTARTER_TEST")      == 0) pkt.cmd = OTCommand::AIRSTARTER_TEST;
            else if (strcmp(cmdStr, "BLEED_VALVE_TEST")     == 0) pkt.cmd = OTCommand::BLEED_VALVE_TEST;
            else if (strcmp(cmdStr, "GLOW_TEST")            == 0) pkt.cmd = OTCommand::GLOW_TEST;
            else if (strcmp(cmdStr, "FUEL_PUMP2_TEST")      == 0) pkt.cmd = OTCommand::FUEL_PUMP2_TEST;
            else if (strcmp(cmdStr, "AB_SOL_TEST")          == 0) pkt.cmd = OTCommand::AB_SOL_TEST;
            else if (strcmp(cmdStr, "AB_PUMP_TEST")         == 0) pkt.cmd = OTCommand::AB_PUMP_TEST;
            else if (strcmp(cmdStr, "STARTER_EN_TEST")      == 0) pkt.cmd = OTCommand::STARTER_EN_TEST;
            else if (strcmp(cmdStr, "PROP_PITCH_TEST")      == 0) pkt.cmd = OTCommand::PROP_PITCH_TEST;
            else if (strcmp(cmdStr, "REGISTRY_OUTPUT_TEST")  == 0) pkt.cmd = OTCommand::REGISTRY_OUTPUT_TEST;
            else if (strcmp(cmdStr, "RESET_PEAKS")          == 0) pkt.cmd = OTCommand::RESET_PEAKS;
            else { req->send(400); return; }
            pkt.fParam = doc["fParam"] | 0.0f;
            pkt.iParam = doc["iParam"] | 0;
            if (_maintenanceUploadInProgress() && pkt.cmd != OTCommand::AB_STOP) {
                req->send(423, "application/json", "{\"ok\":false,\"error\":\"Maintenance upload in progress\"}");
                return;
            }
            if (const char* reject = _commandPreflightRejectReason(pkt)) {
                _sendCommandReject(req, 409, reject);
                return;
            }
            bool queued = pkt.cmd == OTCommand::AB_STOP
                        ? CommandQueue::pushEmergencyFront(pkt) : CommandQueue::push(pkt);
            if (queued) {
                req->send(200, "application/json", "{\"ok\":true}");
            } else {
                req->send(503, "application/json", "{\"ok\":false,\"error\":\"Command queue full\"}");
            }
        });

    // DELETE /api/session/all — wipe every session_N.csv file from /logs
    _server.on("/api/session/all", HTTP_DELETE, [](AsyncWebServerRequest* req) {
        if (_maintenanceUploadInProgress()) {
            req->send(423, "application/json", "{\"error\":\"maintenance upload in progress\"}");
            return;
        }
        if (!_isStandbyLike(EngineData::instance().mode)) {
            req->send(423, "application/json",
                "{\"error\":\"Engine must be in STANDBY or FAULT to delete session logs\"}");
            return;
        }
        File dir = LittleFS.open("/logs");
        if (dir) {
            File entry = dir.openNextFile();
            while (entry) {
                int num = -1;
                // entry.name() may return the full path (/logs/session_1.csv) or just the
                // basename (session_1.csv) depending on LittleFS version — strip the dir prefix.
                if (SessionFiles::parseRunNumber(entry.name(), num)) {
                    char path[40];
                    snprintf(path, sizeof(path), "/logs/session_%d.csv", num);
                    entry.close();
                    LittleFS.remove(path);
                } else {
                    entry.close();
                }
                entry = dir.openNextFile();
            }
            dir.close();
        }
        req->send(200, "application/json", "{\"ok\":true}");
    });

    // POST /api/factory_reset - reset to defaults, erase logs, reboot.
    // Removes ecu_config.json so the next boot regenerates from the compiled
    // hardware_profile.h defaults (identical to a fresh device). If an optional
    // /factory_config.json override is present it is restored instead; none
    // ships by default, so factory reset == first boot.
    _server.on("/api/factory_reset", HTTP_POST, [](AsyncWebServerRequest* req) {
        if (_maintenanceUploadInProgress()) {
            req->send(423, "application/json", "{\"error\":\"maintenance upload in progress\"}");
            return;
        }
        if (!_isStandbyLike(EngineData::instance().mode)) {
            req->send(423, "application/json",
                "{\"error\":\"Engine must be in STANDBY or FAULT to perform factory reset\"}");
            return;
        }
        // Same idle-outputs rule as OTA/restore: this path reboots, and a
        // standby tool (glow, oil prime, starter test, extra cooldown) must
        // not be left mid-action when ESP.restart() fires.
        if (_outputsActiveForOta()) {
            req->send(423, "application/json",
                "{\"error\":\"Stop active actuator tools/cooldown before factory reset\"}");
            return;
        }
        // Drain any already-pending save to a known state, then wipe the config.
        Config::flushPendingSave();
        bool wipeOk = true;
        auto removeAndVerify = [&](const char* path) {
            if (LittleFS.exists(path) && !LittleFS.remove(path)) wipeOk = false;
            if (LittleFS.exists(path)) wipeOk = false;
        };
        removeAndVerify(Config::PATH);
        removeAndVerify(HardwareConfig::PATH);
        // Optional override: if a curated /factory_config.json is present, restore
        // it; otherwise leave the config removed so the reboot regenerates from
        // the compiled hardware_profile.h defaults (the normal case).
        if (LittleFS.exists(FACTORY_CONFIG_PATH)) {
            if (!_copyLittleFsFile(FACTORY_CONFIG_PATH, Config::PATH)) {
                Serial.println("[WebServer] factory_config.json restore failed - falling back to compiled defaults");
                wipeOk = false;
            }
        }
        removeAndVerify(FlightRecorder::PATH);
        if (!Config::clearRuntimeStats()) wipeOk = false;
        File dir = LittleFS.open("/logs");
        if (dir) {
            File entry = dir.openNextFile();
            while (entry) {
                int num = -1;
                char path[40] = {};
                if (SessionFiles::parseRunNumber(entry.name(), num))
                    snprintf(path, sizeof(path), "/logs/session_%d.csv", num);
                entry.close();
                if (path[0]) removeAndVerify(path);
                entry = dir.openNextFile();
            }
            dir.close();
        }
        if (!wipeOk) {
            Serial.println("[WebServer] Factory reset incomplete - reboot cancelled; retry is safe");
            req->send(500, "application/json",
                "{\"ok\":false,\"error\":\"Factory reset incomplete; one or more files or runtime counters remain. Retry after stopping downloads.\"}");
            return;
        }
        _scheduleRestart("factory reset");
        Serial.println("[WebServer] Factory reset - regenerating defaults, erased logs, rebooting");
        req->send(200, "application/json", "{\"ok\":true}");
        // Reboot was already scheduled at the top of the handler (see note there).
    });

    // GET /api/session/list — JSON array of available run numbers, newest first
    _server.on("/api/session/list", HTTP_GET, [](AsyncWebServerRequest* req) {
        int runs[64];
        int count = 0;
        const uint32_t started = millis();
        uint16_t checked = 0;
        // Enumerate actual files: restored counters and oldest-first eviction
        // intentionally allow gaps, so probing a presumed contiguous range can
        // hide valid evidence. Bound both entries and wall time for the network task.
        File dir = LittleFS.open("/logs");
        File entry = dir ? dir.openNextFile() : File();
        while (entry && checked < 4096 && millis() - started < 500) {
            int run = -1;
            if (SessionFiles::parseRunNumber(entry.name(), run) && run > 0) {
                if (count < 64) {
                    runs[count++] = run;
                } else {
                    // Retain only the newest 64 durable identities.
                    int oldestAt = 0;
                    for (int i = 1; i < count; ++i)
                        if (runs[i] < runs[oldestAt]) oldestAt = i;
                    if (run > runs[oldestAt]) runs[oldestAt] = run;
                }
            }
            entry.close();
            entry = dir.openNextFile();
            checked++;
        }
        if (entry) entry.close();
        if (dir) dir.close();
        // Sort descending (simple insertion sort — at most 64 entries)
        for (int i = 1; i < count; i++) {
            int v = runs[i], j = i - 1;
            while (j >= 0 && runs[j] < v) { runs[j+1] = runs[j]; j--; }
            runs[j+1] = v;
        }
        AsyncResponseStream* resp = req->beginResponseStream("application/json");
        resp->print('[');
        for (int i = 0; i < count; i++) {
            if (i) resp->print(',');
            resp->print(runs[i]);
        }
        resp->print(']');
        _finalizeJsonResponse(resp);
        req->send(resp);
    });

    // GET /api/session/log?run=N — download a specific session CSV
    // Without ?run=N serves the most recent (current) session.
    _server.on("/api/session/log", HTTP_GET, [](AsyncWebServerRequest* req) {
        if (!_isStandbyLike(EngineData::instance().mode)) {
            req->send(423, "application/json",
                "{\"error\":\"Session logs are available after the engine returns to STANDBY\"}");
            return;
        }
        char path[40];
        if (req->hasParam("run")) {
            int run = req->getParam("run")->value().toInt();
            snprintf(path, sizeof(path), "/logs/session_%d.csv", run);
        } else {
            const char* cur = SessionLogger::currentPath();
            if (!cur || cur[0] == '\0') {
                req->send(404, "text/plain", "No session log");
                return;
            }
            strncpy(path, cur, sizeof(path) - 1);
            path[sizeof(path) - 1] = '\0';
        }
        if (!LittleFS.exists(path)) {
            req->send(404, "text/plain", "Session not found");
            return;
        }
        // Extract filename from path for Content-Disposition
        const char* fname = strrchr(path, '/');
        fname = fname ? fname + 1 : path;
        char disp[64];
        snprintf(disp, sizeof(disp), "attachment; filename=\"%s\"", fname);
        AsyncWebServerResponse* resp = req->beginResponse(LittleFS, path, "text/csv");
        resp->addHeader("Content-Disposition", disp);
        resp->addHeader("Cache-Control", "no-store");
        resp->addHeader("Connection", "close");
        req->send(resp);
    });

    // POST /update — OTA firmware upload (works over AP, no internet needed)
    // Browser sends multipart/form-data with the compiled .bin file.
    // ESP32 writes it to the inactive OTA partition and reboots.
    _server.on("/update", HTTP_POST,
        // Response callback — runs after all upload chunks received
        [](AsyncWebServerRequest* req) {
            UploadLock lock;
            if (_otaUploadOwner != req) {
                req->send(409, "application/json",
                    "{\"ok\":false,\"error\":\"Another OTA upload is in progress\"}");
                return;
            }
            bool ok = !_otaError && !Update.hasError();
            req->send(ok ? 200 : 400, "application/json",
                ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"Update failed\"}");
            if (ok) {
                // AsyncWebServer has only queued the response at this point.
                // Use the same delayed, guarded restart path as configuration
                // restore so the browser receives success before the AP drops.
                _otaPendingRestart = true;
                _scheduleRestart("firmware OTA", 3000);
            } else {
                _otaInProgress = false;
                _otaUploadOwner = nullptr;
            }
        },
        // Upload handler — called per chunk
        [](AsyncWebServerRequest* req, String filename, size_t index,
           uint8_t* data, size_t len, bool final) {
            UploadLock lock;
            if (!index) {
                if (_otaUploadOwner && _otaUploadOwner != req) return;
                _otaUploadOwner = req;
                _otaError = false;
                _otaUploadLastMs = millis();
                if (_assetUploadInProgress || _configRestoreOwner) {
                    Serial.println("[OTA] Rejected: another maintenance upload is in progress");
                    _otaError = true;
                    return;
                }
                // Guard: never flash firmware while the engine is running.
                // FAULT is accepted — OTA is a legitimate repair path.
                if (!_isStandbyLike(EngineData::instance().mode)) {
                    Serial.println("[OTA] Rejected: engine must be in STANDBY for OTA update");
                    _otaError = true;
                    return;
                }
                // Reserve the update window before evaluating outputs so a
                // queued START/tool command cannot begin between this check
                // and the first flash write.
                _otaInProgress = true;
                if (_outputsActiveForOta()) {
                    Serial.println("[OTA] Rejected: controlled output is active");
                    _otaInProgress = false;
                    _otaError = true;
                    return;
                }
                Serial.printf("[OTA] Upload start: %s\n", filename.c_str());
                if (!Update.begin(UPDATE_SIZE_UNKNOWN, U_FLASH)) {
                    Update.printError(Serial);
                    _otaInProgress = false;
                    _otaError = true;
                }
            }
            if (_otaUploadOwner != req) return;
            _otaUploadLastMs = millis();
            if (!_otaError && !_isStandbyLike(EngineData::instance().mode)) {
                Serial.println("[OTA] Aborted: engine left STANDBY during upload");
                Update.abort();
                _otaInProgress = false;
                _otaError = true;
            }
            if (!_otaError) {
                if (Update.write(data, len) != len) {
                    Update.printError(Serial);
                    Update.abort();
                    _otaInProgress = false;
                    _otaError = true;
                }
            }
            if (final) {
                if (!_otaError && Update.end(true)) {
                    Serial.printf("[OTA] Success: %u bytes - rebooting\n", index + len);
                } else if (!_otaError) {
                    Update.printError(Serial);
                    _otaInProgress = false;
                    _otaError = true;
                }
            }
        });

    // POST /api/web_assets - replace only compressed UI files in LittleFS.
    // This intentionally does not accept a raw LittleFS image: the filesystem
    // also contains configuration and logs that must survive a web update.
    _server.on("/api/web_assets", HTTP_POST,
        [](AsyncWebServerRequest* req) {
            UploadLock lock;
            if (_assetUploadOwner != req) {
                req->send(409, "application/json",
                    "{\"ok\":false,\"error\":\"Another web asset upload is in progress\"}");
                return;
            }
            bool ok = !_assetUploadError && _assetUploadMask == WEB_ASSET_ALL;
#if defined(OT_PLATFORM_ESP32S3)
            if (ok) {
                for (uint16_t i = 0; i < WEB_ASSET_COUNT; i++) {
                    String target = _assetPath(i, false);
                    String temp = _assetPath(i, true);
                    String backup = _assetBackupPath(i);
                    if (LittleFS.exists(backup)) LittleFS.remove(backup);
                    if (LittleFS.exists(target) && !LittleFS.rename(target, backup)) {
                        ok = false;
                        break;
                    }
                    if (!LittleFS.rename(temp, target)) {
                        ok = false;
                        break;
                    }
                }
            }
            if (!ok) {
                // Restore the complete old page set if any staged swap failed.
                for (uint16_t i = 0; i < WEB_ASSET_COUNT; i++) {
                    String target = _assetPath(i, false);
                    String backup = _assetBackupPath(i);
                    if (LittleFS.exists(backup)) {
                        if (LittleFS.exists(target)) LittleFS.remove(target);
                        LittleFS.rename(backup, target);
                    }
                }
            } else {
                for (uint16_t i = 0; i < WEB_ASSET_COUNT; i++) {
                    String backup = _assetBackupPath(i);
                    if (LittleFS.exists(backup)) LittleFS.remove(backup);
                }
            }
#endif
            if (ok) {
                ok = _writeWebAssetMarker();
                if (ok) LittleFS.remove(WEB_ASSET_MARKER_BACKUP);
            }
#if defined(OT_PLATFORM_ESP32S3)
            if (!ok && LittleFS.exists(WEB_ASSET_MARKER_BACKUP)) {
                LittleFS.remove(WEB_ASSET_MARKER);
                LittleFS.rename(WEB_ASSET_MARKER_BACKUP, WEB_ASSET_MARKER);
                _webAssetsComplete = _verifyWebAssetMarker();
            } else
#endif
            _webAssetsComplete = ok;
            req->send(ok ? 200 : 400, "application/json",
                ok ? "{\"ok\":true,\"reboot\":true}"
                   : "{\"ok\":false,\"error\":\"Web asset update failed; upload the full asset set again\"}");
            _finishAssetUpload();
            if (ok) {
                Serial.println("[WebAssets] Update complete - rebooting");
                _scheduleRestart("web asset update");
            }
        },
        [](AsyncWebServerRequest* req, String filename, size_t index,
           uint8_t* data, size_t len, bool final) {
            UploadLock lock;
            if (!_assetUploadOwner) {
                _assetUploadOwner = req;
                _assetUploadError = false;
                _assetUploadMask = 0;
                _assetUploadInProgress = true;
                _assetUploadLastMs = millis();
                if (!_isStandbyLike(EngineData::instance().mode) ||
                    _otaInProgress || _configRestoreOwner || _outputsActiveForOta()) {
                    Serial.println("[WebAssets] Rejected: idle STANDBY required");
                    _assetUploadError = true;
                }
                if (!_assetUploadError) {
                    LittleFS.remove(WEB_ASSET_MARKER_BACKUP);
                    if (LittleFS.exists(WEB_ASSET_MARKER))
                        LittleFS.rename(WEB_ASSET_MARKER, WEB_ASSET_MARKER_BACKUP);
                    _webAssetsComplete = false;
                }
            }
            if (_assetUploadOwner != req || _assetUploadError) return;
            _assetUploadLastMs = millis();
            if (!_isStandbyLike(EngineData::instance().mode) || _outputsActiveForOta()) {
                Serial.println("[WebAssets] Aborted: ECU no longer idle");
                _assetUploadError = true;
                _discardAssetTemps();
                return;
            }
            const int asset = _assetIndex(filename);
            if (asset < 0 || (_assetUploadMask & (1u << asset))) {
                Serial.printf("[WebAssets] Rejected file: %s\n", filename.c_str());
                _assetUploadError = true;
                _discardAssetTemps();
                return;
            }
            if (!index) {
                String temp = _assetPath((uint16_t)asset, true);
                if (LittleFS.exists(temp)) LittleFS.remove(temp);
                _assetTempFile = LittleFS.open(temp, "w");
                if (!_assetTempFile) {
                    _assetUploadError = true;
                    _discardAssetTemps();
                    return;
                }
            }
            if (!_assetTempFile || _assetTempFile.write(data, len) != len) {
                _assetUploadError = true;
                _discardAssetTemps();
                return;
            }
            if (final) {
                _assetTempFile.close();
#if !defined(OT_PLATFORM_ESP32S3)
                if (!_installAssetRolling((uint16_t)asset)) {
                    Serial.printf("[WebAssets] Could not install %s\n", filename.c_str());
                    _assetUploadError = true;
                    _discardAssetTemps();
                    return;
                }
#endif
                _assetUploadMask |= (1u << asset);
            }
        });

    // GET /api/hardware — return the hardware section of ecu_config.json.
    // AsyncJsonResponse owns the document and serializes it in response-sized
    // chunks. A legal sequence can contain hundreds of side actions, so the
    // hardware document must not be constrained by the small general-purpose
    // web scratch buffers.
    _server.on("/api/hardware", HTTP_GET, [](AsyncWebServerRequest* req) {
        // Normal configurations fit the static buffers. Finish and destroy
        // ArduinoJson's temporary pool before AsyncTCP starts transmitting;
        // retaining that pool for the response lifetime fragments heap across
        // repeated Hardware-page visits. Very large legal sequences retain the
        // chunked fallback below.
        size_t n = HardwareConfig::toJson(g_webTxBuf, sizeof(g_webTxBuf), true);
        if (n < sizeof(g_webTxBuf)) {
            _sendBorrowedWebRxJson(req, g_webTxBuf, n);
            return;
        }
        AsyncJsonResponse* resp = new (std::nothrow) AsyncJsonResponse(false);
        if (!resp) {
            req->send(503, "application/json", "{\"error\":\"insufficient memory for hardware response\"}");
            return;
        }
        JsonObject doc = resp->getRoot().as<JsonObject>();
        HardwareConfig::toJson(doc, true);
        resp->setLength();
        if (resp->overflowed() || !resp->_sourceValid()) {
            delete resp;
            req->send(503, "application/json",
                      "{\"error\":\"could not build complete hardware response\"}");
            return;
        }
        _finalizeJsonResponse(resp);
        req->send(resp);
    });

    // Lightweight live view for the Hardware page. Discovery changes at
    // runtime, but returning the complete hardware/profile document every few
    // seconds wastes heap and can starve AsyncTCP while telemetry is active.
    _server.on("/api/i2c_discovery", HTTP_GET, [](AsyncWebServerRequest* req) {
        JsonDocument doc;
        I2CDeviceManager::requestScan();
        JsonObject discovery = doc.to<JsonObject>();
        discovery["bus_active"] = I2CDeviceManager::enabled();
        JsonArray devices = discovery["devices"].to<JsonArray>();
        for (uint8_t i = 0; i < I2CDeviceManager::deviceCount(); ++i) {
            const auto& device = I2CDeviceManager::device(i);
            JsonObject item = devices.add<JsonObject>();
            item["address"] = device.address;
            item["type"] = I2CDeviceManager::typeName(device.type);
            item["present"] = device.present;
            item["rechecking"] = device.present && device.lossActive;
            item["state"] = !device.present ? "FAULTED" :
                            device.lossActive ? "UNAVAILABLE_RECHECKING" : "AVAILABLE";
            item["last_seen_ms"] = device.lastSeenMs;
            item["errors"] = device.errors;
        }
        if (measureJson(doc) + 1 > sizeof(g_webTxBuf)) {
            req->send(500, "application/json", "{\"error\":\"I2C discovery response too large\"}");
            return;
        }
        size_t n = serializeJson(doc, g_webTxBuf, sizeof(g_webTxBuf));
        _sendOwnedJson(req, g_webTxBuf, n);
    });

    // Explicitly accepts one eligible failed sensor and runs the normal
    // sequence with every unrelated interlock active and the reduced-power
    // fuel cap enforced in both STARTUP and RUNNING.
    _server.on("/api/start-limited", HTTP_POST, [](AsyncWebServerRequest* req) {
        if (_maintenanceUploadInProgress()) {
            req->send(423, "application/json", "{\"ok\":false,\"error\":\"Maintenance upload in progress\"}");
            return;
        }
        if (const char* reject = _limitedStartRejectReason()) {
            _sendCommandReject(req, 409, reject);
            return;
        }
        const uint32_t requestId = CommandQueue::nextRequestId();
        CommandQueue::beginResult(requestId);
        OTPacket packet{OTCommand::START_LIMITED};
        packet.requestId = requestId;
        if (!CommandQueue::push(packet)) {
            req->send(503, "application/json", "{\"ok\":false,\"error\":\"Command queue full\"}");
            return;
        }
        bool accepted = false;
        char reason[120] = {};
        if (!CommandQueue::waitResult(requestId, 150, accepted, reason, sizeof(reason))) {
            if (CommandQueue::cancelPendingResult(requestId)) {
                req->send(504, "application/json",
                    "{\"ok\":false,\"error\":\"ECU core did not claim reduced-power START in time; request canceled\"}");
                return;
            }
            if (!CommandQueue::waitResult(requestId, 1000, accepted, reason, sizeof(reason))) {
                req->send(504, "application/json",
                    "{\"ok\":false,\"error\":\"ECU reset or became unavailable while deciding reduced-power START; verify ECU state before retrying\"}");
                return;
            }
        }
        if (!accepted) {
            _sendCommandReject(req, 409, reason);
        } else {
            snprintf(g_webTxBuf, sizeof(g_webTxBuf),
                     "{\"ok\":true,\"started\":true,\"mode\":\"reduced_power\",\"request_id\":%lu}",
                     (unsigned long)requestId);
            req->send(200, "application/json", g_webTxBuf);
        }
    });

    _server.on("/api/hardware/capability", HTTP_GET, [](AsyncWebServerRequest* req) {
        const char* feature = req->hasParam("feature") ? req->getParam("feature")->value().c_str() : "";
        JsonDocument doc; HardwareCapabilities::toJson(doc.to<JsonObject>(), feature);
        size_t n = serializeJson(doc, g_webTxBuf, sizeof(g_webTxBuf));
        _sendOwnedJson(req, g_webTxBuf, n);
    });

    // Read-only immutable PCB catalog, paged so even a maximum custom profile
    // stays inside the bounded web response buffer.
    _server.on("/api/pcb_profile", HTTP_GET, [](AsyncWebServerRequest* req) {
        int offset = req->hasParam("offset") ? req->getParam("offset")->value().toInt() : 0;
        int limit = req->hasParam("limit") ? req->getParam("limit")->value().toInt() : 12;
        offset = constrain(offset, 0, PcbProfileManager::MAX_PORTS);
        limit = constrain(limit, 1, 12);
        JsonDocument doc;
        PcbProfileManager::toJson(doc.to<JsonObject>(), true,
                                  static_cast<uint8_t>(offset), static_cast<uint8_t>(limit));
        // The immutable profile describes fitted topology; live discovery says
        // whether a soldered I2C device is actually responding right now.
        for (JsonObject port : doc["ports"].as<JsonArray>()) {
            for (JsonObject modeJson : port["modes"].as<JsonArray>()) {
                const char* portId = port["id"] | "";
                const char* modeId = modeJson["id"] | "";
                const auto* profilePort = PcbProfileManager::findPort(portId);
                const auto* mode = profilePort
                    ? PcbProfileManager::findMode(*profilePort, modeId) : nullptr;
                if (!mode || !mode->deviceId[0]) {
                    modeJson["available"] = mode != nullptr;
                    if (!mode) modeJson["status"] = "Profile entry is invalid";
                    continue;
                }
                const auto* device = PcbProfileManager::findDevice(mode->deviceId);
                uint8_t driver = 255;
                if (!strcmp(mode->adapter, "i2c_digital_input")) driver = ChannelRegistry::I2cDigital;
                else if (!strcmp(mode->adapter, "i2c_adc_input")) driver = ChannelRegistry::I2cAnalog;
                else if (!strcmp(mode->adapter, "i2c_load_cell")) driver = ChannelRegistry::I2cLoadCell;
                else if (!strcmp(mode->adapter, "i2c_digital_output")) driver = ChannelRegistry::I2cRelay;
                if (device && driver != 255) {
                    const bool available =
                        I2CDeviceManager::assignmentAvailable(driver, device->address);
                    modeJson["available"] = available;
                    if (!available)
                        modeJson["status"] = "Fitted I2C device is not responding";
                } else {
                    // SPI and OneWire health is checked by their runtime
                    // drivers after assignment; unsupported adapters stay
                    // unavailable instead of silently becoming generic GPIO.
                    modeJson["available"] = driver == 255 &&
                        strncmp(mode->adapter, "i2c_", 4) != 0;
                    if (strncmp(mode->adapter, "i2c_", 4) == 0)
                        modeJson["status"] = "Requires newer firmware support";
                }
            }
        }
        if (measureJson(doc) + 1 > sizeof(g_webTxBuf)) {
            req->send(500, "application/json", "{\"error\":\"PCB profile page is too large\"}");
            return;
        }
        size_t n = serializeJson(doc, g_webTxBuf, sizeof(g_webTxBuf));
        // Profile pages are fetched back-to-back during Hardware-page load.
        // Give each page its own bounded response snapshot so a keep-alive
        // response cannot hold the shared request buffer and make the next
        // catalog page appear to be missing.
        _sendOwnedJson(req, g_webTxBuf, n);
    });

    // POST /api/hardware — validate + replace the hardware section, schedule reboot
    // Engine must be in STANDBY (or FAULT). Changes take effect after reboot.
    _server.on("/api/hardware", HTTP_POST,
        [](AsyncWebServerRequest* req) {},
        nullptr,
        [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
            if (index == 0 && _maintenanceUploadInProgress()) {
                req->send(423, "application/json", "{\"error\":\"maintenance upload in progress\"}");
                return;
            }
            if (!_appendWebRx(req, data, len, index)) return;
            if (index + len < total) return;   // wait for more chunks
            WebRxRelease release(req);
            if (g_webRxOverflow) {
                req->send(400, "application/json", "{\"error\":\"request body too large\"}");
                return;
            }

            // Only allow hardware changes in STANDBY (or FAULT — the repair path)
            if (!_isStandbyLike(EngineData::instance().mode)) {
                req->send(423, "application/json",
                    "{\"error\":\"Engine must be in STANDBY or FAULT to change hardware config\"}");
                return;
            }
            // Hardware save schedules a reboot — same idle-outputs rule as
            // OTA/restore so a running standby tool isn't cut mid-action.
            if (_outputsActiveForOta()) {
                req->send(423, "application/json",
                    "{\"error\":\"Stop active actuator tools/cooldown before saving hardware config\"}");
                return;
            }
            // A complete hardware map takes effect only after reboot. Keep the
            // transaction gate claimed until then so START cannot observe a
            // partly replaced map while the old peripherals are still live.
            if (!ConfigApplyGate::tryBeginWebWrite()) {
                req->send(409, "application/json", "{\"error\":\"START transition or another configuration update is in progress\"}");
                return;
            }
            if (!_isStandbyLike(EngineData::instance().mode)) {
                ConfigApplyGate::release();
                req->send(409, "application/json", "{\"error\":\"engine left STANDBY before hardware update\"}");
                return;
            }
            size_t previousLen = HardwareConfig::toJson(g_webTxBuf, sizeof(g_webTxBuf));
            if (previousLen >= sizeof(g_webTxBuf)) {
                ConfigApplyGate::release();
                req->send(500, "application/json",
                    "{\"ok\":false,\"error\":\"Current hardware section is too large to stage safely\"}");
                return;
            }
            // Hardware inventory is physical truth. Permit an unchanged saved
            // assignment to remain when its device is temporarily missing, but
            // do not accept a new/changed device or channel unless that exact
            // chip type is responding on the live bus now.
            {
                JsonDocument proposed;
                JsonDocument previous;
                JsonDocument registryFilter;
                registryFilter["channel_registry"]["inputs"] = true;
                registryFilter["channel_registry"]["outputs"] = true;
                if (deserializeJson(proposed, g_webRxBuf, g_webRxLen,
                                    DeserializationOption::Filter(registryFilter)) ==
                        DeserializationError::Ok &&
                    deserializeJson(previous, g_webTxBuf, previousLen,
                                    DeserializationOption::Filter(registryFilter)) ==
                        DeserializationError::Ok) {
                    bool unavailableAssignment = false;
                    const char* unavailableId = nullptr;
                    for (const char* listName : {"inputs", "outputs"}) {
                        JsonArrayConst proposedList =
                            proposed["channel_registry"][listName].as<JsonArrayConst>();
                        JsonArrayConst previousList =
                            previous["channel_registry"][listName].as<JsonArrayConst>();
                        for (JsonObjectConst row : proposedList) {
                            if (!(row["installed"] | true)) continue;
                            uint8_t driver = row["driver"] | 255;
                            uint8_t address = row["i2c_address"] | 0;
                            uint8_t channel = row["device_channel"] | 255;
                            const char* physicalPort = row["physical_port"] | "";
                            const char* physicalMode = row["physical_mode"] | "";
                            if (PcbProfileManager::active()) {
                                const auto* port = PcbProfileManager::findPort(physicalPort);
                                const auto* mode = port
                                    ? PcbProfileManager::findMode(*port, physicalMode) : nullptr;
                                const auto* device = mode && mode->deviceId[0]
                                    ? PcbProfileManager::findDevice(mode->deviceId) : nullptr;
                                if (!mode || !device) continue;
                                if (!strcmp(mode->adapter, "i2c_digital_input")) driver = ChannelRegistry::I2cDigital;
                                else if (!strcmp(mode->adapter, "i2c_adc_input")) driver = ChannelRegistry::I2cAnalog;
                                else if (!strcmp(mode->adapter, "i2c_load_cell")) driver = ChannelRegistry::I2cLoadCell;
                                else if (!strcmp(mode->adapter, "i2c_digital_output")) driver = ChannelRegistry::I2cRelay;
                                else continue;
                                address = device->address;
                                channel = mode->channel;
                            }
                            if (driver < (uint8_t)ChannelRegistry::I2cDigital ||
                                driver > (uint8_t)ChannelRegistry::I2cRelay) continue;
                            const char* id = row["id"] | "";
                            bool unchanged = false;
                            for (JsonObjectConst old : previousList) {
                                const bool sameProfilePort = PcbProfileManager::active() &&
                                    !strcmp(old["id"] | "", id) &&
                                    !strcmp(old["physical_port"] | "", physicalPort) &&
                                    !strcmp(old["physical_mode"] | "", physicalMode);
                                const bool sameGenericDevice = !PcbProfileManager::active() &&
                                    !strcmp(old["id"] | "", id) &&
                                    (uint8_t)(old["driver"] | 255) == driver &&
                                    (uint8_t)(old["i2c_address"] | 0) == address &&
                                    (uint8_t)(old["device_channel"] | 255) == channel;
                                if (sameProfilePort || sameGenericDevice) {
                                    unchanged = true;
                                    break;
                                }
                            }
                            if (!unchanged &&
                                !I2CDeviceManager::assignmentAvailable(driver, address)) {
                                unavailableAssignment = true;
                                unavailableId = id;
                                break;
                            }
                        }
                        if (unavailableAssignment) break;
                    }
                    if (unavailableAssignment) {
                        ConfigApplyGate::release();
                        JsonDocument errorDoc;
                        errorDoc["ok"] = false;
                        errorDoc["error"] = "I2C device is not connected";
                        errorDoc["detail"] =
                            "New I2C assignments can only use a device detected on the live bus.";
                        errorDoc["channel"] = unavailableId ? unavailableId : "";
                        size_t errorLen =
                            serializeJson(errorDoc, g_webTxBuf, sizeof(g_webTxBuf));
                        _sendOwnedJson(req, g_webTxBuf, errorLen, 409);
                        return;
                    }
                }
            }
            // Snapshot threshold-based safety enable flags before applying,
            // so we can auto-fill a default threshold for any newly-enabled one.
            bool prevSafOilT = HardwareConfig::safetyOilTempHigh;
            bool prevSafFP   = HardwareConfig::safetyFuelPressLow;
            bool prevSafBatt = HardwareConfig::safetyBattLow;
            bool prevSafSurge= HardwareConfig::safetySurge;
            bool prevSafHot  = HardwareConfig::safetyHotStart;
            bool ok = HardwareConfig::fromJson(
                g_webRxBuf, g_webRxLen, &HardwareConfig::channelRegistry);
            if (!ok) {
                char rejection[160];
                strlcpy(rejection, HardwareConfig::lastValidationError(), sizeof(rejection));
                const bool restored = HardwareConfig::fromJson(
                    g_webTxBuf, previousLen, &HardwareConfig::channelRegistry);
                ConfigApplyGate::release();
                JsonDocument errorDoc;
                errorDoc["ok"] = false;
                errorDoc["error"] = "Hardware setup was rejected";
                errorDoc["detail"] = rejection;
                if (!restored) {
                    errorDoc["rebooting"] = true;
                    _scheduleRestart("hardware validation rollback");
                }
                size_t errorLen = serializeJson(errorDoc, g_webTxBuf, sizeof(g_webTxBuf));
                _sendOwnedJson(req, g_webTxBuf, errorLen, 400);
                return;
            }
            Config::sanitizeForHardware();
            // Auto-fill a sane threshold for any safety just enabled (and still
            // active after sanitize) whose threshold is 0, so it isn't silently off.
            Config::autoFillNewlyEnabledSafety(prevSafOilT, prevSafFP,
                                               prevSafBatt, prevSafSurge, prevSafHot);
            if (!HardwareConfig::saveUnified()) {
                HardwareConfig::fromJson(
                    g_webTxBuf, previousLen, &HardwareConfig::channelRegistry);
                Config::load();
                ConfigApplyGate::release();
                req->send(500, "application/json",
                    "{\"ok\":false,\"error\":\"Failed to atomically save hardware and settings\"}");
                return;
            }
            Serial.printf("[WebServer] POST /api/hardware: saved (%u bytes) - reboot in 1s\n",
                          (unsigned)g_webRxLen);
            req->send(200, "application/json", "{\"ok\":true,\"reboot\":true}");
            _scheduleRestart("hardware config save");
        });

    // PATCH /api/hardware — partial update of hardware section (calibration fields only, no reboot)
    _server.on("/api/hardware", HTTP_PATCH,
        [](AsyncWebServerRequest* req) {},
        nullptr,
        [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
            if (index == 0 && _maintenanceUploadInProgress()) {
                req->send(423, "application/json", "{\"error\":\"maintenance upload in progress\"}");
                return;
            }
            // Hardware config changes take effect immediately on the live control loop
            // (HardwareConfig static fields are read every tick).  Reject unless
            // STANDBY (or FAULT — the control loop is equally idle there).
            // Gate on index == 0 so a multi-chunk body cannot req->send(409) once per
            // chunk (double send corrupts ESPAsyncWebServer response state).
            if (index == 0 && !_isStandbyLike(EngineData::instance().mode)) {
                req->send(409, "application/json",
                    "{\"ok\":false,\"error\":\"engine not in STANDBY or FAULT\"}");
                return;
            }
            if (!_appendWebRx(req, data, len, index)) return;
            if (index + len < total) return;
            WebRxRelease release(req);
            if (g_webRxOverflow) {
                req->send(400, "application/json", "{\"error\":\"request body too large\"}");
                return;
            }
            // Re-check on completion: the engine may have left STANDBY between chunks.
            if (!_isStandbyLike(EngineData::instance().mode)) {
                req->send(409, "application/json",
                    "{\"ok\":false,\"error\":\"engine not in STANDBY or FAULT\"}");
                return;
            }
            JsonDocument patch;
            if (deserializeJson(patch, g_webRxBuf, g_webRxLen) != DeserializationError::Ok) {
                req->send(400, "application/json", "{\"error\":\"bad json\"}");
                return;
            }
            bool calibrationOnly = true;
            for (JsonPair top : patch.as<JsonObject>()) {
                const char* topKey = top.key().c_str();
                if (strcmp(topKey, "sensors") == 0 && top.value().is<JsonObject>()) {
                    for (JsonPair sensor : top.value().as<JsonObject>()) {
                        const char* sensorKey = sensor.key().c_str();
                        if (!sensor.value().is<JsonObject>()) { calibrationOnly = false; break; }
                        for (JsonPair field : sensor.value().as<JsonObject>()) {
                            const char* fieldKey = field.key().c_str();
                            bool allowed = (strcmp(sensorKey, "oil_temp") == 0 &&
                                            (strcmp(fieldKey, "ntc_beta") == 0 ||
                                             strcmp(fieldKey, "ntc_r0") == 0 ||
                                             strcmp(fieldKey, "ntc_r_fixed") == 0 ||
                                             strcmp(fieldKey, "use_raw_poly") == 0 ||
                                             strcmp(fieldKey, "poly_a") == 0 || strcmp(fieldKey, "poly_b") == 0 ||
                                             strcmp(fieldKey, "poly_c") == 0 || strcmp(fieldKey, "poly_d") == 0 ||
                                             strcmp(fieldKey, "poly_x_min") == 0 || strcmp(fieldKey, "poly_x_max") == 0))
                                        || (strcmp(sensorKey, "batt_voltage") == 0 &&
                                            strcmp(fieldKey, "divider") == 0)
                                        || (strcmp(sensorKey, "torque") == 0 &&
                                            (strcmp(fieldKey, "scale") == 0 ||
                                             strcmp(fieldKey, "offset") == 0));
                            if (!allowed) { calibrationOnly = false; break; }
                        }
                        if (!calibrationOnly) break;
                    }
                } else if (strcmp(topKey, "actuators") == 0 && top.value().is<JsonObject>()) {
                    for (JsonPair actuator : top.value().as<JsonObject>()) {
                        const char* actuatorKey = actuator.key().c_str();
                        bool validActuator = strcmp(actuatorKey, "oil_pump") == 0 ||
                                             strcmp(actuatorKey, "glow_plug") == 0 ||
                                             strcmp(actuatorKey, "igniter") == 0 ||
                                             strcmp(actuatorKey, "igniter2") == 0;
                        if (!validActuator || !actuator.value().is<JsonObject>()) {
                            calibrationOnly = false;
                            break;
                        }
                        for (JsonPair field : actuator.value().as<JsonObject>()) {
                            const char* fieldKey = field.key().c_str();
                            if (strcmp(fieldKey, "current_zero_v") != 0 &&
                                strcmp(fieldKey, "current_mv_a") != 0) {
                                calibrationOnly = false;
                                break;
                            }
                        }
                        if (!calibrationOnly) break;
                    }
                } else if (strcmp(topKey, "ab_flame") == 0 && top.value().is<JsonObject>()) {
                    for (JsonPair field : top.value().as<JsonObject>()) {
                        if (strcmp(field.key().c_str(), "threshold") != 0) {
                            calibrationOnly = false;
                            break;
                        }
                    }
                } else if (strcmp(topKey, "channel_registry_calibration") == 0 && top.value().is<JsonObject>()) {
                    // Calibration-only updates for registry inputs. Topology
                    // (pins, roles and drivers) remains protected by the full
                    // Hardware Save path; this endpoint only accepts numeric
                    // calibration fields for an existing input card.
                    bool hasId = false;
                    for (JsonPair field : top.value().as<JsonObject>()) {
                        const char* key = field.key().c_str();
                        if (strcmp(key, "id") == 0) hasId = true;
                        else if (strcmp(key, "analog_zero_mv") != 0 &&
                                 strcmp(key, "min") != 0 &&
                                 strcmp(key, "max") != 0 &&
                                 strcmp(key, "analog_mv_per_unit") != 0 &&
                                 strcmp(key, "analog_divider") != 0 &&
                                 strcmp(key, "calibration_points") != 0 &&
                                 strcmp(key, "pulses_per_unit") != 0 &&
                                 strcmp(key, "ntc_beta") != 0 &&
                                 strcmp(key, "ntc_r0") != 0 &&
                                 strcmp(key, "ntc_r_fixed") != 0 &&
                                 strcmp(key, "temp_resolution") != 0 &&
                                 strcmp(key, "loadcell_zero") != 0 &&
                                  strcmp(key, "loadcell_n_per_count") != 0 &&
                                  strcmp(key, "lever_arm_m") != 0 &&
                                  strcmp(key, "digital_threshold_raw") != 0 &&
                                  strcmp(key, "filter_alpha") != 0) {
                            calibrationOnly = false;
                            break;
                        }
                    }
                    if (!hasId) calibrationOnly = false;
                } else {
                    calibrationOnly = false;
                }
                if (!calibrationOnly) break;
            }
            if (!calibrationOnly) {
                req->send(400, "application/json",
                    "{\"error\":\"hardware PATCH accepts calibration fields only; use Hardware Save for topology changes\"}");
                return;
            }
            // Merge directly in the ArduinoJson tree. A legal hardware section
            // may exceed the small general-purpose web scratch buffers.
            JsonDocument current;
            HardwareConfig::toJson(current);
            if (patch["channel_registry_calibration"].is<JsonObject>()) {
                JsonObjectConst cal = patch["channel_registry_calibration"].as<JsonObjectConst>();
                const char* id = cal["id"] | "";
                bool applied = false;
                JsonArray inputs = current["channel_registry"]["inputs"].as<JsonArray>();
                for (JsonObject ch : inputs) {
                    if (strcmp(ch["id"] | "", id) != 0) continue;
                    for (JsonPairConst field : cal) {
                        if (strcmp(field.key().c_str(), "id") != 0)
                            ch[field.key()] = field.value();
                    }
                    applied = true;
                    break;
                }
                if (!applied) {
                    req->send(400, "application/json", "{\"error\":\"registry calibration channel not found\"}");
                    return;
                }
                patch.remove("channel_registry_calibration");
            }
            _mergeJsonObject(current.as<JsonObject>(), patch.as<JsonObjectConst>());
            if (!ConfigApplyGate::tryBeginWebWrite()) {
                req->send(409, "application/json", "{\"error\":\"START transition or another configuration update is in progress\"}");
                return;
            }
            if (!_isStandbyLike(EngineData::instance().mode)) {
                ConfigApplyGate::release();
                req->send(409, "application/json", "{\"error\":\"engine left STANDBY before calibration update\"}");
                return;
            }
            if (!HardwareConfig::validateJson(current, &HardwareConfig::channelRegistry)) {
                current.clear();
                current.shrinkToFit();
                HardwareConfig::load();
                ConfigApplyGate::release();
                req->send(400, "application/json", "{\"error\":\"hardware patch rejected\"}");
                return;
            }
            HardwareConfig::applyValidatedJsonRuntimeOnly(current);
            // fromJson has copied the merged values into HardwareConfig. Release
            // both temporary JSON trees before save() allocates its full unified
            // config document.
            current.clear();
            current.shrinkToFit();
            patch.clear();
            patch.shrinkToFit();
            if (!HardwareConfig::save()) {
                HardwareConfig::load();
                ConfigApplyGate::release();
                req->send(500, "application/json", "{\"error\":\"failed to write hardware config\"}");
                return;
            }
            FlightRecorder::logConfigChange("hardware.patch", 0, 0);
            ConfigApplyGate::markReadyForCore();
            req->send(200, "application/json", "{\"ok\":true,\"applying\":true}");
        });

    // GET /api/ecu_config — download full unified config (hardware + settings)
    // Deliberately serves the file verbatim incl. plaintext wifi_password: the JSON
    // must restore 1:1 on another ESP32 (portability by design — do not redact here).
    _server.on("/api/ecu_config", HTTP_GET, [](AsyncWebServerRequest* req) {
        if (!LittleFS.exists(Config::PATH)) {
            req->send(404, "application/json", "{\"error\":\"ecu_config.json not found\"}");
            return;
        }
        AsyncWebServerResponse* resp = req->beginResponse(
            LittleFS, Config::PATH, "application/json");
        resp->addHeader("Content-Disposition", "attachment; filename=\"ecu_config.json\"");
        resp->addHeader("Cache-Control", "no-store");
        resp->addHeader("Connection", "close");
        req->send(resp);
    });

    // POST /api/ecu_config — upload full unified config, apply all sections, reboot
    _server.on("/api/ecu_config", HTTP_POST,
        [](AsyncWebServerRequest* req) {},
        nullptr,
        [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
            UploadLock lock;
            if (index == 0) {
                if (_configRestoreOwner) {
                    req->send(409, "application/json",
                        "{\"error\":\"Another full configuration restore is in progress\"}");
                    return;
                }
                if (_otaInProgress || _assetUploadInProgress) {
                    req->send(409, "application/json",
                        "{\"error\":\"Another maintenance upload is in progress\"}");
                    return;
                }
                if (!_isStandbyLike(EngineData::instance().mode) || _outputsActiveForOta()) {
                    req->send(423, "application/json",
                        "{\"error\":\"Engine must be idle in STANDBY or FAULT to upload config\"}");
                    return;
                }
                // Release the heap-backed live telemetry frame before the
                // complete engine file arrives. Waiting until the last body
                // chunk left too little contiguous heap to parse Hardware on
                // a busy S3/Classic UI session.
                _releaseLiveTelemetryTransport();
                _configRestoreOwner = req;
                // Boot accepts this same maximum. The browser must be able to
                // restore every engine file the firmware can legally load,
                // including maximum sequence actions and calibration curves.
                _configRestoreError = total > 196608UL;
                _configRestoreLastMs = millis();
                LittleFS.remove("/ecu_config.restore.tmp");
                if (!_configRestoreError) {
                    _configRestoreFile = LittleFS.open("/ecu_config.restore.tmp", "w");
                    _configRestoreError = !_configRestoreFile;
                }
            }
            if (_configRestoreOwner != req) return;
            _configRestoreLastMs = millis();
            if (index > 196608UL || len > 196608UL - index) _configRestoreError = true;
            if (!_configRestoreError && _configRestoreFile.write(data, len) != len)
                _configRestoreError = true;
            if (index + len < total) return;
            if (_configRestoreFile) _configRestoreFile.close();
            if (_configRestoreError) {
                req->send(400, "application/json", "{\"error\":\"configuration file is too large or could not be staged\"}");
                _finishConfigRestore();
                return;
            }

            if (!_isStandbyLike(EngineData::instance().mode)) {
                req->send(423, "application/json",
                    "{\"error\":\"Engine must be in STANDBY or FAULT to upload config\"}");
                _finishConfigRestore();
                return;
            }
            // Extract settings while the restore starts with maximum free
            // contiguous heap. After hardware validation/runtime staging, the
            // Classic registry owns additional allocations and a second
            // filtered parse of the complete engine file can fail even though
            // the uploaded JSON is valid. The staged root is small, temporary,
            // and parsed only after the hardware document has been released.
            static constexpr const char* SETTINGS_STAGE = "/ecu_config.settings.tmp";
            if (!_stageUnifiedConfigSection(Config::SECTION, SETTINGS_STAGE)) {
                req->send(400, "application/json",
                    "{\"error\":\"bad json or missing settings section\"}");
                _finishConfigRestore();
                return;
            }

            bool previousConfigMismatch = EngineData::instance().configVersionMismatch;
            auto restoreRuntime = [&]() {
                // The committed engine file is unchanged until Config::save()
                // succeeds, so it remains the authoritative rollback image.
                HardwareConfig::load();
                Config::load();
                EngineData::instance().configVersionMismatch = previousConfigMismatch;
            };

            // Parse and apply settings before rebuilding the uploaded hardware
            // registry. Classic cannot allocate this document after that larger
            // registry is resident. Temporarily align only the profile string;
            // dependency cleanup still runs after the validated hardware apply.
            JsonDocument uploadedSettings;
            File stagedSettings = LittleFS.open(SETTINGS_STAGE, "r");
            const size_t uploadedSettingsLen = stagedSettings ? stagedSettings.size() : 0;
            const bool settingsRead = stagedSettings && uploadedSettingsLen > 0 &&
                uploadedSettingsLen < sizeof(g_webRxBuf) &&
                stagedSettings.read(reinterpret_cast<uint8_t*>(g_webRxBuf), uploadedSettingsLen) == uploadedSettingsLen;
            if (stagedSettings) stagedSettings.close();
            if (settingsRead) g_webRxBuf[uploadedSettingsLen] = '\0';
            // The mutable overload stores strings in g_webRxBuf instead of
            // duplicating them into ArduinoJson's allocator. This is the only
            // way a maximum legal settings tree and the live Classic runtime
            // fit together during a web restore.
            DeserializationError settingsError = settingsRead
                ? deserializeJson(uploadedSettings, g_webRxBuf, uploadedSettingsLen)
                : DeserializationError::NoMemory;
            if (settingsError != DeserializationError::Ok || uploadedSettings.overflowed() ||
                !Config::validateJsonValues(uploadedSettings)) {
                req->send(400, "application/json", "{\"error\":\"settings section rejected\"}");
                _finishConfigRestore();
                return;
            }
            char uploadedSettingsProfile[65];
            char liveHardwareProfile[65];
            strlcpy(uploadedSettingsProfile, uploadedSettings["profile_id"] | "",
                    sizeof(uploadedSettingsProfile));
            strlcpy(liveHardwareProfile, HardwareConfig::profileId, sizeof(liveHardwareProfile));
            strlcpy(HardwareConfig::profileId, uploadedSettingsProfile,
                    sizeof(HardwareConfig::profileId));
            const bool settingsApplied = Config::applyJsonRuntimeOnly(
                uploadedSettings, false, false);
            strlcpy(HardwareConfig::profileId, liveHardwareProfile,
                    sizeof(HardwareConfig::profileId));
            uploadedSettings.clear();
            uploadedSettings.shrinkToFit();
            if (!settingsApplied) {
                restoreRuntime();
                req->send(400, "application/json",
                    "{\"error\":\"config dependency cleanup rejected uploaded settings\"}");
                _finishConfigRestore();
                return;
            }

            JsonDocument hwDoc;
            if (!_loadUnifiedConfigSection(HardwareConfig::SECTION, hwDoc)) {
                req->send(400, "application/json",
                    "{\"error\":\"bad json or missing hardware section\"}");
                _finishConfigRestore();
                return;
            }
            if (strcmp(hwDoc["wifi_password"] | "", "__KEEP_PASSWORD__") == 0) {
                hwDoc["wifi_password"] = HardwareConfig::wifiPassword;
            }
            const bool hardwareEditorSave = req->hasParam("source") &&
                req->getParam("source")->value() == "hardware";
            const bool prevSafOilT = HardwareConfig::safetyOilTempHigh;
            const bool prevSafFP = HardwareConfig::safetyFuelPressLow;
            const bool prevSafBatt = HardwareConfig::safetyBattLow;
            const bool prevSafSurge = HardwareConfig::safetySurge;
            const bool prevSafHot = HardwareConfig::safetyHotStart;
            // Validation may safely use the live registry as bounded scratch:
            // restore is STANDBY-only, all physical demands are zero, and the
            // committed engine file remains the rollback image until the final
            // atomic rename. This avoids a second large contiguous allocation.
            if (!HardwareConfig::validateJson(hwDoc, &HardwareConfig::channelRegistry)) {
                char rejection[160];
                strlcpy(rejection, HardwareConfig::lastValidationError(), sizeof(rejection));
                hwDoc.clear();
                hwDoc.shrinkToFit();
                restoreRuntime();
                JsonDocument errorDoc;
                errorDoc["error"] = "hardware section rejected";
                errorDoc["detail"] = rejection;
                size_t errorLen = serializeJson(errorDoc, g_webTxBuf, sizeof(g_webTxBuf));
                _sendOwnedJson(req, g_webTxBuf, errorLen, 400);
                _finishConfigRestore();
                return;
            }

            char uploadedProfile[65];
            strlcpy(uploadedProfile, hwDoc["profile_id"] | "", sizeof(uploadedProfile));
            if (strcmp(uploadedProfile, uploadedSettingsProfile) != 0) {
                hwDoc.clear();
                hwDoc.shrinkToFit();
                restoreRuntime();
                req->send(400, "application/json",
                    "{\"error\":\"hardware and settings profile_id must identify the same engine\"}");
                _finishConfigRestore();
                return;
            }
            HardwareConfig::applyValidatedJsonRuntimeOnly(hwDoc);
            hwDoc.clear();
            hwDoc.shrinkToFit();
            Config::sanitizeForHardware();
            if (hardwareEditorSave) {
                Config::autoFillNewlyEnabledSafety(prevSafOilT, prevSafFP,
                                                   prevSafBatt, prevSafSurge,
                                                   prevSafHot);
            }
            // Config::save() is the canonical Classic-safe writer: it streams
            // hardware and settings sequentially and commits them atomically,
            // without requiring either uploaded tree to remain allocated.
            if (!Config::save()) {
                restoreRuntime();
                req->send(500, "application/json", "{\"error\":\"failed to atomically save ecu_config.json\"}");
                _finishConfigRestore();
                return;
            }

            Serial.printf("[WebServer] POST /api/ecu_config: %u bytes - reboot in 1s\n", (unsigned)total);
            // Publish the reboot guard before releasing the restore owner. START
            // must never observe a gap between these two cross-core guards while
            // the committed hardware and the initialized drivers differ.
            _scheduleRestart("engine config restore");
            _finishConfigRestore();
            req->send(200, "application/json", "{\"ok\":true,\"reboot\":true}");
        });

    // 404
    _server.onNotFound([isCaptive](AsyncWebServerRequest* req) {
        if (isCaptive(req)) {
            // Send captive clients to the lightweight portal page (no WebSocket), not the
            // dashboard, so they get a clear "open the panel" prompt without hogging /ws.
            String target = "http://";
            target += WiFi.softAPIP().toString();
            target += "/portal";
            req->redirect(target);
            return;
        }
        req->send(404);
    });

    // WebSocket — client-pull model with PING/PONG rescue.
    //
    // Core problem: async_tcp (AsyncTCP 3.x + IDF5) intermittently blocks for
    // 2–20 s waiting for events, even when "p" messages are arriving every 500 ms.
    // This is the same root cause that required CONFIG_ASYNC_TCP_USE_WDT=0.
    //
    // Primary path: JS sends "p" periodically and WS_EVT_DATA replies inside
    // async_tcp. WebSocket messages are live-data frames only; each page loads
    // one full snapshot from /api/data during boot for limits and labels. This
    // prevents large full frames growing the async TCP telemetry allocation.
    //
    // Rescue path: if canSend() was false when "p" arrived (previous frame still
    // in-flight), _wsPendingResponse is set.  tick() notices and calls pingAll()
    // every 200 ms — a tiny PING that crosses the task boundary cheaply.  The
    // client auto-replies with PONG, which fires WS_EVT_PONG inside async_tcp,
    // where canSend() will be true and the pending frame is delivered.
    _ws.onEvent([](AsyncWebSocket*, AsyncWebSocketClient* client, AwsEventType type,
                   void*, uint8_t*, size_t) {
        bool shouldSend = false;
        bool full       = false;

        if (type == WS_EVT_CONNECT) {
            // This ECU intentionally serves one live telemetry browser. A page
            // navigation can establish its replacement socket before the old
            // page's graceful close completes; abort the superseded transport
            // immediately so it cannot consume a Classic ESP32 TCP slot for
            // the acknowledgement timeout.
            if (s_activeWsClient && s_activeWsClient != client) {
                AsyncClient* superseded = s_activeWsClient->client();
                s_activeWsClient = nullptr;
                if (superseded) superseded->abort();
            }
            s_activeWsClient = client;
            _wsPendingResponse = false;
            // Every UI client sends an immediate pull from its onopen handler.
            // Do not also enqueue an unsolicited frame here: two back-to-back
            // 5 KiB frames make page teardown race a still-queued TCP write on
            // Classic and eventually exhaust its small connection pool.
            return;
        } else if (type == WS_EVT_DISCONNECT) {
            // A superseded client's delayed disconnect may arrive after its
            // replacement is already active. It no longer owns the shared
            // telemetry document and must not clear the replacement's state.
            if (s_activeWsClient == client) {
                s_activeWsClient = nullptr;
                _wsPendingResponse = false;
                s_wsTelemetryDoc.clear();
                s_wsTelemetryDoc.shrinkToFit();
            }
            return;
        } else if (type == WS_EVT_DATA) {
            if (!client->canSend()) {
                _wsPendingResponse = true;
                return;
            }
            // A new pull from the browser is already proof that the socket is
            // responsive again; resume immediately instead of waiting for ping.
            _wsPendingResponse = false;
            full = false;
            shouldSend = true;
        } else if (type == WS_EVT_PONG && _wsPendingResponse) {
            // Rescue: tick() sent a PING because canSend() was false; now we are
            // back inside async_tcp context and the pipe should be clear.
            shouldSend = true;
            full       = false;
        }

        if (!shouldSend || !client || !client->canSend()) return;
        _wsPendingResponse = false;
        // Keep each WebSocket frame small. ESPAsyncWebServer copies outgoing text
        // into a heap-backed vector; the previous full-frame size could exhaust
        // ESP32 heap and throw from operator new in the async TCP task.
        static char buf[6144];
        JsonDocument& doc = s_wsTelemetryDoc;
        size_t n = _buildTelemetry(buf, sizeof(buf), doc, full);
        if (n < sizeof(buf)) {
            if (!_sendTelemetryFrame(client, buf, n)) _wsPendingResponse = true;
        } else if (full) {
            Serial.printf("[WebSocket] Full telemetry frame too large (%u >= %u), falling back to fast frame\n",
                          (unsigned)n, (unsigned)sizeof(buf));
            doc.clear();
            n = _buildTelemetry(buf, sizeof(buf), doc, false);
            if (n >= sizeof(buf) || !_sendTelemetryFrame(client, buf, n))
                _wsPendingResponse = true;
        } else {
            Serial.printf("[WebSocket] Fast telemetry frame too large (%u >= %u)\n",
                          (unsigned)n, (unsigned)sizeof(buf));
            _wsPendingResponse = true;
        }
    });
    _server.addHandler(&_ws);
}

// ── Public API ────────────────────────────────────────────────
bool WebServer::begin() {
    g_webRxStorage = static_cast<WebRxBuffer*>(
        heap_caps_malloc(sizeof(WebRxBuffer), MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL));
    g_webTxStorage = static_cast<WebTxBuffer*>(
        heap_caps_malloc(sizeof(WebTxBuffer), MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL));
    if (!g_webRxStorage || !g_webTxStorage) {
        if (g_webRxStorage) heap_caps_free(g_webRxStorage);
        if (g_webTxStorage) heap_caps_free(g_webTxStorage);
        g_webRxStorage = nullptr;
        g_webTxStorage = nullptr;
        auto& ed = EngineData::instance();
        ed.hardwareReady = false;
        strlcpy(ed.hardwareFault,
                "Web service memory reservation failed; reboot or reflash before START",
                sizeof(ed.hardwareFault));
        strlcpy(ed.faultDescription,
                "Cannot start: the ECU could not reserve its fixed web-service workspace. "
                "Reboot once; if this repeats, reflash over USB and inspect the serial log.",
                sizeof(ed.faultDescription));
        strlcpy(ed.lastEvent, "START locked: web memory unavailable", sizeof(ed.lastEvent));
        Serial.printf("[WebServer] FATAL: buffer allocation failed (free=%u max=%u)\n",
                      (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap());
        return false;
    }
    _uploadMux = xSemaphoreCreateMutexStatic(&_uploadMuxBuf);
    _recoverInterruptedAssetUpdate();
    _webAssetsComplete = _verifyWebAssetMarker();
    if (!_webAssetsComplete)
        Serial.println("[WebAssets] Complete-generation marker missing or hash mismatch; START inhibited");
    _startWiFi();
    _setupRoutes();
    _server.begin();
    Serial.println("[WebServer] Started on port 80");
    return true;
}

void WebServer::tick() {
    unsigned long _t0 = millis();
    _dns.processNextRequest();
    unsigned long _t1 = millis();
    const SysMode mode = EngineData::instance().mode;
    // SPI-flash program/erase operations suspend the other ESP32 core while
    // caches are disabled. LittleFS/NVS persistence must therefore never run
    // while the ECU is controlling an engine. Producers keep bounded RAM
    // queues during STARTUP/RUNNING/SHUTDOWN and drain them once outputs are
    // already safe in STANDBY or FAULT.
    // LittleFS program/erase and an AsyncFileResponse read must not overlap.
    // On Classic this could make an otherwise healthy gzip response end before
    // its declared Content-Length. The response lease is released on normal
    // completion and on aborted page navigation, so queued record/session
    // writes simply drain on the next web-task tick.
    const bool storageWritesSafe = mode == SysMode::STANDBY || mode == SysMode::FAULT;
    const bool storageWriteWindow = storageWritesSafe && _beginStorageWriteWindow();
    if (storageWriteWindow) FlightRecorder::runEviction();
    unsigned long _t2 = millis();
    if (storageWriteWindow) SessionLogger::drainQueue();
    unsigned long _t3 = millis();
    // Skip while a reboot is pending: factory reset / config restore just replaced
    // the on-disk file, and a deferred save would overwrite it with the old
    // in-memory settings during the 5 s pre-reboot window.
    if (storageWriteWindow && !_hwRebootPending) Config::flushPendingSave();
    unsigned long _t4 = millis();
    if (storageWriteWindow) Config::flushPendingRuntimeStats();
    unsigned long _t5 = millis();
    if (_t5 - _t0 > 200) {
        Serial.printf("[tick] SLOW %lums: dns=%lu evict=%lu drain=%lu save=%lu stats=%lu\n",
            _t5-_t0, _t1-_t0, _t2-_t1, _t3-_t2, _t4-_t3, _t5-_t4);
    }

    // ── LittleFS stats cache ──────────────────────────────────
    // Refresh every 10 s from webTask so _buildTelemetry never has to call
    // usedBytes() from inside the async_tcp task context (avoids FS mutex
    // contention / priority inversion with SessionLogger writes).
    {
        static bool _fsStatInit = false;
        static unsigned long _fsStatMs = 0;
        unsigned long now = millis();
        // Compute on the very first webTask tick, then refresh every 10 s.
        // Without the init flag the cache stays 0 for the first 10 s after boot,
        // so the dashboard shows a scary "0 KB free · 0 / 0 KB used".
        if (storageWriteWindow && (!_fsStatInit || now - _fsStatMs >= 10000)) {
            _fsStatInit = true;
            _fsStatMs  = now;
            s_fsTotal  = LittleFS.totalBytes() / 1024;
            s_fsUsed   = LittleFS.usedBytes()  / 1024;
        }
    }
    if (storageWriteWindow) _endStorageWriteWindow();

    // ── PING rescue ───────────────────────────────────────────
    // If a "p" pull arrived while canSend() was false, _wsPendingResponse is
    // set.  Send a tiny WS PING every 200 ms; the client auto-replies with
    // PONG, which fires WS_EVT_PONG inside async_tcp — the correct context to
    // deliver the pending telemetry frame without a cross-task handoff.
    if (_wsPendingResponse && _ws.count() > 0) {
        unsigned long now = millis();
        if (now - _wsPingMs >= 200) {
            _wsPingMs = now;
            _ws.pingAll();
        }
    }

    // Successful OTA uses the normal delayed restart scheduler below. Keeping
    // _otaPendingRestart asserted excludes its completed upload from the
    // interrupted-upload timeout until that restart occurs.
    // Interrupted OTA upload: if the client disconnects mid-upload no further
    // chunk or completion callback ever runs, so without this timeout the
    // maintenance lock (423 on start/command/save) persists until power cycle
    // and _otaUploadOwner dangles.  Idle-timeout pattern matches the asset and
    // config-restore cleanups below; re-check under the lock closes the race
    // against a chunk arriving exactly at the boundary.
    if (_otaUploadOwner && !_otaPendingRestart && (millis() - _otaUploadLastMs) > 30000) {
        UploadLock lock;
        if (_otaUploadOwner && !_otaPendingRestart && (millis() - _otaUploadLastMs) > 30000) {
            Serial.println("[OTA] Timed out - aborting interrupted firmware upload");
            if (Update.isRunning()) Update.abort();
            _otaError = true;
            _otaInProgress = false;
            _otaUploadOwner = nullptr;
        }
    }
    if (_assetUploadInProgress && (millis() - _assetUploadLastMs) > 30000) {
        UploadLock lock;
        if (_assetUploadInProgress && (millis() - _assetUploadLastMs) > 30000) {
            Serial.println("[WebAssets] Timed out - discarding staged upload");
            _assetUploadError = true;
            _finishAssetUpload();
        }
    }
    if (_configRestoreOwner && (millis() - _configRestoreLastMs) > 30000) {
        UploadLock lock;
        if (_configRestoreOwner && (millis() - _configRestoreLastMs) > 30000) {
            Serial.println("[Config] Timed out - discarding staged full restore");
            _finishConfigRestore();
        }
    }
    // Reboot only after the HTTP response has had time to leave and network
    // clients have seen the AP disappear cleanly.
    if (_hwRebootPending && (long)(millis() - _hwRebootScheduledMs) >= 0) {
        const char* blocker = OutputActivity::firstPhysicalDemand(false);
        if (blocker || !_isStandbyLike(mode)) {
            snprintf(_pendingRestartBlocker, sizeof(_pendingRestartBlocker), "%s",
                     blocker ? blocker : "engine is not in a safe mode");
            _hwRebootScheduledMs = millis() + 1000UL;
            Serial.printf("[WebServer] Restart postponed: %s remains active\n", _pendingRestartBlocker);
        } else {
            _pendingRestartBlocker[0] = '\0';
            _restartCleanly(_pendingRestartReason);
        }
    }
    // Purge stale WebSocket clients promptly (handles page navigations that leave
    // ghost connections).  Keep at most 1 — multiple stale connections cause
    // canSend() to return false and eventually exhaust async TCP clients. Run even
    // with no station connected so a departed browser cannot leave resources behind.
    unsigned long now = millis();
    static unsigned long _lastCleanMs = 0;
    if (now - _lastCleanMs >= 250) {
        _lastCleanMs = now;
        for (uint8_t i = 0; i < 4 && _ws.count() > 1; ++i) {
            _ws.cleanupClients(1);
        }
        _ws.cleanupClients(1);
    }
}

bool WebServer::otaInProgress() {
    return _maintenanceUploadInProgress();
}

bool WebServer::rebootPending() {
    return _hwRebootPending;
}
