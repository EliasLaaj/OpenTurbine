#pragma once
#include <Arduino.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <esp_system.h>
#include "../../../hardware_profile.h"
#include "../../engine/EngineData.h"

namespace ResetRecovery {
    RTC_DATA_ATTR inline uint32_t activeMagic = 0;
    RTC_DATA_ATTR inline uint32_t activeMagicInv = 0;
    static constexpr uint32_t MAGIC = 0x4F545255UL;
    inline void markActive() { activeMagic = MAGIC; activeMagicInv = ~MAGIC; }
    inline void markSafe() { activeMagic = 0; activeMagicInv = ~0UL; }
    inline bool wasActive() { return activeMagic == MAGIC && activeMagicInv == ~MAGIC; }
}

// ============================================================
//  PlatformInit — one-time ESP32 board bring-up
//
//  Serial, LittleFS, NVS boot counter, ADC attenuation.
//  Everything MCU-specific that doesn't belong in HAL.
// ============================================================

class PlatformInit {
public:
    static void begin(bool genericDevBoardMode = true) {
        // Only an erased PCB-profile partition selects the generic development-board
        // pinout. A valid profile has already parked all of its native outputs;
        // a profile fault deliberately leaves pins high-impedance and locks
        // START instead of briefly driving unrelated generic GPIOs.
        if (genericDevBoardMode) {
            // External pull-offs are still required to guarantee the reset interval.
#ifdef OT_HAS_FUEL_SOL
            digitalWrite(OT_FUEL_SOL_PIN, OT_FUEL_SOL_ACTIVE_H ? LOW : HIGH);
            pinMode(OT_FUEL_SOL_PIN, OUTPUT);
#endif
#ifdef OT_HAS_IGNITER
            digitalWrite(OT_IGNITER_PIN, OT_IGNITER_ACTIVE_H ? LOW : HIGH);
            pinMode(OT_IGNITER_PIN, OUTPUT);
#endif
#ifdef OT_HAS_STARTER_EN
            digitalWrite(OT_STARTER_EN_PIN, OT_STARTER_EN_ACTIVE_H ? LOW : HIGH);
            pinMode(OT_STARTER_EN_PIN, OUTPUT);
#endif
        }

        Serial.begin(115200);
        delay(100);
        Serial.println("\n[OT] OpenTurbine booting - default profile: " OT_PROFILE_ID);

        // LittleFS
        // Never format automatically on a control-system boot: a transient
        // mount failure must not erase configuration and logs.
        // Configuration saves briefly need old/new/backup files while the web
        // server and Windows/phone captive-portal probes may still own asset
        // handles. Ten descriptors was reproducibly exhausted during a normal
        // Hardware-page save, leaving valid settings unsynchronised. Keep
        // enough headroom for those concurrent, bounded operations.
        bool fsOk = LittleFS.begin(false, "/littlefs", 16, "littlefs");
        if (!fsOk) {
            Serial.println("[OT] ERROR: LittleFS mount failed - storage unavailable");
            auto& ed = EngineData::instance();
            ed.configLocked = true;
            ed.configStorageFault = true;
            strncpy(ed.faultDescription,
                    "Cannot start: LittleFS storage failed to mount. Config, calibration, web assets, and logs are unavailable.",
                    sizeof(ed.faultDescription) - 1);
            ed.faultDescription[sizeof(ed.faultDescription) - 1] = '\0';
        } else {
            Serial.println("[OT] LittleFS OK");
        }

        // ADC: 12-bit, 11 dB attenuation (0–3.3V full range)
        analogReadResolution(12);
        analogSetAttenuation(ADC_11db);

        // NVS boot counter via Preferences
        Preferences prefs;
        uint32_t bc = 1;
        if (prefs.begin("ot", false)) {
            bc = prefs.getUInt("bootCount", 0) + 1;
            if (prefs.putUInt("bootCount", bc) == 0) {
                Serial.println("[OT] WARNING: boot counter NVS write failed");
            }
            prefs.end();
        } else {
            Serial.println("[OT] WARNING: NVS unavailable - boot counter not persisted");
        }
        EngineData::instance().bootCount = bc;

        Serial.printf("[OT] Boot #%lu\n", (unsigned long)bc);

        // Log reset reason so we can diagnose unexpected reboots
        esp_reset_reason_t rr = esp_reset_reason();
        EngineData::instance().resetReason = (uint8_t)rr;
        const char* rrStr = "UNKNOWN";
        switch (rr) {
            case ESP_RST_POWERON:  rrStr = "POWER_ON";   break;
            case ESP_RST_SW:       rrStr = "SOFTWARE";   break;
            case ESP_RST_PANIC:    rrStr = "PANIC/CRASH"; break;
            case ESP_RST_INT_WDT:  rrStr = "INT_WDT";    break;
            case ESP_RST_TASK_WDT: rrStr = "TASK_WDT";   break;
            case ESP_RST_WDT:      rrStr = "WDT";        break;
            case ESP_RST_DEEPSLEEP:rrStr = "DEEP_SLEEP"; break;
            case ESP_RST_BROWNOUT: rrStr = "BROWNOUT";   break;
            default: break;
        }
        Serial.printf("[OT] Reset reason: %s (%d)\n", rrStr, (int)rr);
        const bool abnormal = rr == ESP_RST_PANIC || rr == ESP_RST_INT_WDT ||
                              rr == ESP_RST_TASK_WDT || rr == ESP_RST_WDT ||
                              rr == ESP_RST_BROWNOUT;
        if (abnormal && ResetRecovery::wasActive()) {
            auto& ed = EngineData::instance();
            ed.recoveryLockout = true;
            strncpy(ed.faultDescription,
                    "Abnormal reset occurred while the engine was active. Release START, verify shaft speed/temperature, then press STOP to acknowledge.",
                    sizeof(ed.faultDescription) - 1);
            Serial.println("[OT] Recovery lockout armed: abnormal reset while active");
        }
        // Generic dev-board switch defaults. Profile-backed Start/Stop ports
        // are initialized from the resolved runtime hardware configuration.
        if (genericDevBoardMode) {
            pinMode(OT_STOP_PIN, INPUT_PULLUP);
#ifdef OT_START_PIN
            pinMode(OT_START_PIN, INPUT_PULLUP);
#endif
        }

#ifdef OT_DEV_MODE
        EngineData::instance().devMode = true;
        Serial.println("[OT] *** DEV MODE ACTIVE ***");
#endif
    }
};
