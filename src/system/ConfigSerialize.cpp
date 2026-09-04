#include "Config.h"
#include "ConfigInternal.h"
#include "HardwareConfig.h"
#include "RulesEngine.h"
#include "hardware_profile.h"
#include <cstring>
#if defined(OT_PLATFORM_ESP32) || defined(OT_PLATFORM_ESP32S3)
#include <LittleFS.h>
#endif

namespace {

template <typename T>
struct ConfigField {
    const char* key;
    T* value;
};

template <typename T, size_t N>
void readConfigFields(JsonVariantConst object, const ConfigField<T> (&fields)[N]) {
    for (const auto& field : fields) {
        JsonVariantConst value = object[field.key];
        if (!value.isNull()) *field.value = value.as<T>();
    }
}

template <typename T, size_t N>
void writeConfigFields(JsonObject object, const ConfigField<T> (&fields)[N]) {
    for (const auto& field : fields) object[field.key] = *field.value;
}

template <typename T, size_t N>
bool liveSectionKeysValid(JsonObjectConst object, const ConfigField<T> (&fields)[N]) {
    for (JsonPairConst pair : object) {
        bool known = false;
        for (const auto& field : fields) {
            if (!strcmp(pair.key().c_str(), field.key)) { known = true; break; }
        }
        if (!known || pair.value().is<JsonObjectConst>() || pair.value().is<JsonArrayConst>())
            return false;
    }
    return object.size() > 0;
}

#define CONFIG_FIELD(name, jsonKey) {jsonKey, &Config::name}

const ConfigField<float> ENGINE_FLOAT_FIELDS[] = {
    CONFIG_FIELD(rpmLimit, "rpm_limit"), CONFIG_FIELD(n2RpmLimit, "n2_rpm_limit"),
    CONFIG_FIELD(minRpm, "min_rpm"), CONFIG_FIELD(totLimit, "tot_limit"),
    CONFIG_FIELD(totCooldownTarget, "tot_cooldown_target"),
    CONFIG_FIELD(totSafeMargin, "tot_safe_margin"),
};
const ConfigField<float> OIL_FLOAT_FIELDS[] = {
    CONFIG_FIELD(oilStartupPressure, "startup_pressure"), CONFIG_FIELD(oilStartupPct, "startup_pct"),
    CONFIG_FIELD(oilStartupMinBar, "startup_min_bar"), CONFIG_FIELD(oilRunningMin, "running_min"),
    CONFIG_FIELD(oilMapMin, "map_min"), CONFIG_FIELD(oilMapMax, "map_max"),
    CONFIG_FIELD(oilAdjustScale, "adjust_scale"), CONFIG_FIELD(oilMinPct, "min_pct"),
    CONFIG_FIELD(oilFailsafePct, "failsafe_pct"),
};
const ConfigField<int> OIL_INT_FIELDS[] = {CONFIG_FIELD(oilFailsafeDelayMs, "failsafe_delay_ms")};
const ConfigField<bool> OIL_BOOL_FIELDS[] = {CONFIG_FIELD(oilUseThrottleMap, "use_throttle_map")};

const ConfigField<float> THROTTLE_FLOAT_FIELDS[] = {
    CONFIG_FIELD(throttleRampUpMs, "ramp_up_ms"), CONFIG_FIELD(throttleRampDownMs, "ramp_down_ms"),
    CONFIG_FIELD(fuelPumpMinPct, "fuel_pump_min_pct"), CONFIG_FIELD(throttleIdleMaxPct, "idle_max_pct"),
    CONFIG_FIELD(throttleExpo, "expo"), CONFIG_FIELD(pullbackN1SoftRpm, "pullback_n1_soft_rpm"),
    CONFIG_FIELD(pullbackN1HardRpm, "pullback_n1_hard_rpm"), CONFIG_FIELD(pullbackN2SoftRpm, "pullback_n2_soft_rpm"),
    CONFIG_FIELD(pullbackN2HardRpm, "pullback_n2_hard_rpm"), CONFIG_FIELD(pullbackEgtSoftC, "pullback_egt_soft_c"),
    CONFIG_FIELD(pullbackEgtHardC, "pullback_egt_hard_c"), CONFIG_FIELD(pullbackP1Soft, "pullback_p1_soft_bar"),
    CONFIG_FIELD(pullbackP1Hard, "pullback_p1_hard_bar"), CONFIG_FIELD(pullbackP2Soft, "pullback_p2_soft_bar"),
    CONFIG_FIELD(pullbackP2Hard, "pullback_p2_hard_bar"), CONFIG_FIELD(pullbackTorqueSoft, "pullback_torque_soft_nm"),
    CONFIG_FIELD(pullbackTorqueHard, "pullback_torque_hard_nm"), CONFIG_FIELD(pullbackMinThrottlePct, "pullback_min_pct"),
    CONFIG_FIELD(pullbackNearLimitRampUpMs, "pullback_near_limit_rampup_ms"),
    CONFIG_FIELD(pullbackApproachZoneRpm, "pullback_approach_zone_rpm"),
    CONFIG_FIELD(rpmAccelFilter, "rpm_accel_filter"),
    CONFIG_FIELD(pullbackN1LookaheadMs, "pullback_n1_lookahead_ms"),
    CONFIG_FIELD(pullbackN2LookaheadMs, "pullback_n2_lookahead_ms"),
    CONFIG_FIELD(pullbackEgtLookaheadMs, "pullback_egt_lookahead_ms"),
    CONFIG_FIELD(pullbackP1LookaheadMs, "pullback_p1_lookahead_ms"),
    CONFIG_FIELD(pullbackP2LookaheadMs, "pullback_p2_lookahead_ms"),
    CONFIG_FIELD(pullbackTorqueLookaheadMs, "pullback_torque_lookahead_ms"),
    CONFIG_FIELD(pullbackN1Strength, "pullback_n1_strength"),
    CONFIG_FIELD(pullbackN2Strength, "pullback_n2_strength"),
    CONFIG_FIELD(pullbackEgtStrength, "pullback_egt_strength"),
    CONFIG_FIELD(pullbackP1Strength, "pullback_p1_strength"),
    CONFIG_FIELD(pullbackP2Strength, "pullback_p2_strength"),
    CONFIG_FIELD(pullbackTorqueStrength, "pullback_torque_strength"),
};
const ConfigField<int> THROTTLE_INT_FIELDS[] = {
    CONFIG_FIELD(pullbackN1Mode, "pullback_n1_mode"), CONFIG_FIELD(pullbackN2Mode, "pullback_n2_mode"),
    CONFIG_FIELD(pullbackEgtMode, "pullback_egt_mode"), CONFIG_FIELD(pullbackP1Mode, "pullback_p1_mode"),
    CONFIG_FIELD(pullbackP2Mode, "pullback_p2_mode"), CONFIG_FIELD(pullbackTorqueMode, "pullback_torque_mode")
};
const ConfigField<bool> THROTTLE_BOOL_FIELDS[] = {
    CONFIG_FIELD(pullbackN1Enabled, "pullback_n1"), CONFIG_FIELD(pullbackN2Enabled, "pullback_n2"),
    CONFIG_FIELD(pullbackEgtEnabled, "pullback_egt"), CONFIG_FIELD(pullbackP1Enabled, "pullback_p1"),
    CONFIG_FIELD(pullbackP2Enabled, "pullback_p2"), CONFIG_FIELD(pullbackTorqueEnabled, "pullback_torque"),
};

const ConfigField<float> IDLE_FLOAT_FIELDS[] = {
    CONFIG_FIELD(idleTargetRpm, "target_rpm"), CONFIG_FIELD(idleRampUpMs, "ramp_up_ms"),
    CONFIG_FIELD(idleRampDownMs, "ramp_down_ms"), CONFIG_FIELD(idleDeadbandRpm, "deadband_rpm"),
    CONFIG_FIELD(idleRpmLimit, "rpm_limit"),
    CONFIG_FIELD(idleMaxMultiplier, "max_multiplier"), CONFIG_FIELD(idleTargetPressure, "target_pressure_bar"),
    CONFIG_FIELD(idlePressureDeadband, "pressure_deadband_bar"), CONFIG_FIELD(idlePressureLimit, "pressure_limit_bar"),
    CONFIG_FIELD(idleIGain, "i_gain"), CONFIG_FIELD(idleIMax, "i_max"),
    CONFIG_FIELD(idleDecelEnterRpm, "decel_enter_rpm"), CONFIG_FIELD(idleDecelDropPct, "decel_drop_pct"),
    CONFIG_FIELD(idleLookaheadMs, "lookahead_ms"), CONFIG_FIELD(idleSettleBandRpm, "settle_band_rpm"),
    CONFIG_FIELD(idleFullResponseRpm, "full_response_rpm"), CONFIG_FIELD(idleTrimUpPctPerSec, "trim_up_pct_s"),
    CONFIG_FIELD(idleTrimDownPctPerSec, "trim_down_pct_s"), CONFIG_FIELD(idleLearnRate, "learn_rate"),
    CONFIG_FIELD(idleLearnAccelMax, "learn_accel_max"),
    CONFIG_FIELD(idlePressureDecelEnter, "pressure_decel_enter_bar"),
    CONFIG_FIELD(idlePressureSettleBand, "pressure_settle_band_bar"),
    CONFIG_FIELD(idlePressureFullResponse, "pressure_full_response_bar"),
    CONFIG_FIELD(idlePressureLearnRateMax, "pressure_learn_rate_max_bar_s"),
};
const ConfigField<int> IDLE_INT_FIELDS[] = {
    CONFIG_FIELD(idleSource, "source"), CONFIG_FIELD(idleMode, "idle_mode"),
};
const ConfigField<bool> IDLE_BOOL_FIELDS[] = {CONFIG_FIELD(idleUseN2, "use_n2")};

const ConfigField<float> SAFETY_FLOAT_FIELDS[] = {
    CONFIG_FIELD(flameoutShutdownMs, "flameout_shutdown_ms"),
    CONFIG_FIELD(flameoutN1MinRpm, "flameout_n1_min_rpm"),
    CONFIG_FIELD(flameoutEgtBelowC, "flameout_egt_below_c"),
    CONFIG_FIELD(flameoutEgtFallRateCPerSec, "flameout_egt_fall_rate_c_s"),
    CONFIG_FIELD(titLimit, "tit_limit_c"), CONFIG_FIELD(oilTempLimit, "oil_temp_limit_c"),
    CONFIG_FIELD(fuelPressMin, "fuel_press_min_bar"), CONFIG_FIELD(battVoltMin, "batt_volt_min_v"),
    CONFIG_FIELD(p1TripLimit, "p1_trip_bar"), CONFIG_FIELD(p2TripLimit, "p2_trip_bar"),
    CONFIG_FIELD(torqueTripLimit, "torque_trip_nm"),
    CONFIG_FIELD(surgeDetectRpmVariance, "surge_detect_rpm_variance"),
};
const ConfigField<int> SAFETY_INT_FIELDS[] = {
    CONFIG_FIELD(safetyCheckIntervalMs, "check_interval_ms"),
    CONFIG_FIELD(egtSource, "egt_source"), CONFIG_FIELD(flameoutSource, "flameout_source"),
    CONFIG_FIELD(p1TripConfirmMs, "p1_trip_confirm_ms"), CONFIG_FIELD(p2TripConfirmMs, "p2_trip_confirm_ms"),
    CONFIG_FIELD(torqueTripConfirmMs, "torque_trip_confirm_ms"),
};
const ConfigField<uint32_t> SAFETY_U32_FIELDS[] = {
    CONFIG_FIELD(lowOilConfirmMs, "low_oil_confirm_ms"),
    CONFIG_FIELD(oilZeroConfirmMs, "oil_zero_confirm_ms"),
    CONFIG_FIELD(oilTempConfirmMs, "oil_temp_confirm_ms"),
    CONFIG_FIELD(fuelPressConfirmMs, "fuel_press_confirm_ms"),
    CONFIG_FIELD(battLowConfirmMs, "batt_low_confirm_ms"),
};

const ConfigField<float> AFTERBURNER_FLOAT_FIELDS[] = {
    CONFIG_FIELD(abMinN1, "min_n1"), CONFIG_FIELD(abMaxN1, "max_n1"),
    CONFIG_FIELD(abMaxTotForLight, "max_tot_for_light"),
    CONFIG_FIELD(abThrottleThreshold, "throttle_threshold"),
    CONFIG_FIELD(abTorchSpikePct, "torch_spike_pct"), CONFIG_FIELD(abTorchTotLimit, "torch_tot_limit"),
    CONFIG_FIELD(abTotRiseDegC, "tot_rise_deg_c"), CONFIG_FIELD(abLightupPumpPct, "lightup_pump_pct"),
    CONFIG_FIELD(abPumpMinPct, "pump_min_pct"), CONFIG_FIELD(abPumpMaxPct, "pump_max_pct"),
    CONFIG_FIELD(abMainFuelOffsetPct, "main_fuel_offset_pct"),
    CONFIG_FIELD(abStabilizeMaxTot, "stabilize_max_tot"),
};
const ConfigField<int> AFTERBURNER_INT_FIELDS[] = {
    CONFIG_FIELD(abTorchDurationMs, "torch_duration_ms"), CONFIG_FIELD(abTorchGuardMode, "torch_guard_mode"),
    CONFIG_FIELD(abFlameMode, "flame_mode"),
    CONFIG_FIELD(abTotRiseWindowMs, "tot_rise_window_ms"), CONFIG_FIELD(abAssumeIgnitedMs, "assume_ignited_ms"),
    CONFIG_FIELD(abFlameTimeoutMs, "flame_timeout_ms"), CONFIG_FIELD(abFlameLossDelayMs, "flame_loss_delay_ms"),
    CONFIG_FIELD(abPumpControlMode, "pump_control_mode"), CONFIG_FIELD(abStabilizeMs, "stabilize_ms"),
};
const ConfigField<bool> AFTERBURNER_BOOL_FIELDS[] = {
    CONFIG_FIELD(abUseTorch, "use_torch"), CONFIG_FIELD(abUseIgniter, "use_igniter"),
};

const ConfigField<uint32_t> TOOL_U32_FIELDS[] = {
    CONFIG_FIELD(toolFuelPrimeMs, "fuel_prime_ms"), CONFIG_FIELD(toolOilPrimeMs, "oil_prime_ms"),
    CONFIG_FIELD(toolIgnTestMs, "ign_test_ms"), CONFIG_FIELD(toolIgn2TestMs, "ign2_test_ms"),
    CONFIG_FIELD(toolGlowTestMs, "glow_test_ms"), CONFIG_FIELD(toolStartTestMs, "start_test_ms"),
    CONFIG_FIELD(toolFuelSolTestMs, "fuel_sol_test_ms"), CONFIG_FIELD(toolIdleTestMs, "idle_test_ms"),
    CONFIG_FIELD(toolOilScavTestMs, "oil_scav_test_ms"), CONFIG_FIELD(toolCoolFanTestMs, "cool_fan_test_ms"),
    CONFIG_FIELD(toolAirstarterTestMs, "airstarter_test_ms"),
    CONFIG_FIELD(toolBleedValveTestMs, "bleed_valve_test_ms"),
    CONFIG_FIELD(toolFuelPump2TestMs, "fuel_pump2_test_ms"),
    CONFIG_FIELD(toolAbSolTestMs, "ab_sol_test_ms"), CONFIG_FIELD(toolAbPumpTestMs, "ab_pump_test_ms"),
    CONFIG_FIELD(toolStarterEnTestMs, "starter_en_test_ms"),
    CONFIG_FIELD(toolPropPitchTestMs, "prop_pitch_test_ms"),
};
const ConfigField<float> TOOL_FLOAT_FIELDS[] = {
    CONFIG_FIELD(toolGlowTestPct, "glow_test_pct"), CONFIG_FIELD(toolStartTestPct, "start_test_pct"),
    CONFIG_FIELD(toolFuelPump2TestPct, "fuel_pump2_test_pct"),
    CONFIG_FIELD(toolAbPumpTestPct, "ab_pump_test_pct"),
    CONFIG_FIELD(toolPropPitchTestPct, "prop_pitch_test_pct"),
};

const ConfigField<float> GOVERNOR_FLOAT_FIELDS[] = {
    CONFIG_FIELD(governorTargetRpm, "target_rpm"), CONFIG_FIELD(governorBandRpm, "band_rpm"),
    CONFIG_FIELD(governorKp, "kp"), CONFIG_FIELD(governorPitchKp, "pitch_kp"),
    CONFIG_FIELD(governorPitchRampSec, "pitch_ramp_sec"),
};
const ConfigField<float> LIVE_THROTTLE_FLOAT_FIELDS[] = {
    CONFIG_FIELD(throttleRampUpMs, "ramp_up_ms"),
    CONFIG_FIELD(throttleRampDownMs, "ramp_down_ms"),
};
const ConfigField<float> GLOW_FLOAT_FIELDS[] = {
    CONFIG_FIELD(glowPreheatMaxPct, "preheat_max_pct"), CONFIG_FIELD(glowHoldPct, "hold_pct"),
};
const ConfigField<int> GLOW_INT_FIELDS[] = {CONFIG_FIELD(glowPreheatMs, "preheat_ms")};
const ConfigField<bool> GLOW_BOOL_FIELDS[] = {CONFIG_FIELD(glowWaitUntilHot, "wait_until_hot")};

const ConfigField<float> CAL_FLOAT_FIELDS[] = {
    CONFIG_FIELD(p1ValMax, "p1_val_max"), CONFIG_FIELD(p2ValMax, "p2_val_max"),
    CONFIG_FIELD(fuelPressValMax, "fuel_press_val_max"), CONFIG_FIELD(fuelFlowValMax, "fuel_flow_val_max"),
};
const ConfigField<int> CAL_INT_FIELDS[] = {
    CONFIG_FIELD(throttleMinRaw, "throttle_min_raw"), CONFIG_FIELD(throttleMaxRaw, "throttle_max_raw"),
    CONFIG_FIELD(idleMinRaw, "idle_min_raw"), CONFIG_FIELD(idleMaxRaw, "idle_max_raw"),
    CONFIG_FIELD(p1RawMin, "p1_raw_min"),
    CONFIG_FIELD(p1RawMax, "p1_raw_max"), CONFIG_FIELD(p2RawMin, "p2_raw_min"),
    CONFIG_FIELD(p2RawMax, "p2_raw_max"), CONFIG_FIELD(fuelPressRawMin, "fuel_press_raw_min"),
    CONFIG_FIELD(fuelPressRawMax, "fuel_press_raw_max"), CONFIG_FIELD(fuelFlowRawMin, "fuel_flow_raw_min"),
    CONFIG_FIELD(fuelFlowRawMax, "fuel_flow_raw_max"),
};
const ConfigField<float> OIL_POLY_FLOAT_FIELDS[] = {
    CONFIG_FIELD(oilPolyA, "a"), CONFIG_FIELD(oilPolyB, "b"), CONFIG_FIELD(oilPolyC, "c"),
    CONFIG_FIELD(oilPolyD, "d"), CONFIG_FIELD(oilPolyXMin, "x_min"), CONFIG_FIELD(oilPolyXMax, "x_max"),
};

const ConfigField<float> RELIGHT_FLOAT_FIELDS[] = {
    CONFIG_FIELD(relightMinRpm, "min_rpm"), CONFIG_FIELD(relightConfirmRpm, "confirm_rpm"),
    CONFIG_FIELD(relightTotRiseC, "tot_rise_c"),
    CONFIG_FIELD(relightTriggerEgtBelowC, "trigger_egt_below_c"),
    CONFIG_FIELD(relightTriggerEgtFallRateCPerSec, "trigger_egt_fall_rate_c_s"),
};
const ConfigField<int> RELIGHT_INT_FIELDS[] = {
    CONFIG_FIELD(relightIgnitionTarget, "ignition_target"),
    CONFIG_FIELD(relightTriggerSource, "trigger_source"),
    CONFIG_FIELD(relightTriggerConfirmMs, "trigger_confirm_ms"),
    CONFIG_FIELD(relightConfirmSource, "confirm_source"),
    CONFIG_FIELD(relightTimeoutMs, "relight_timeout_ms"),
};
const ConfigField<bool> RELIGHT_BOOL_FIELDS[] = {CONFIG_FIELD(relightEnabled, "enabled")};

const ConfigField<uint32_t> TELEMETRY_U32_FIELDS[] = {
    CONFIG_FIELD(wsIntervalMs, "ws_interval_ms"), CONFIG_FIELD(snapshotIntervalMs, "snapshot_interval_ms"),
    CONFIG_FIELD(controlLoopHz, "control_loop_hz"),
};
const ConfigField<bool> TELEMETRY_BOOL_FIELDS[] = {CONFIG_FIELD(logStandby, "log_standby")};
const ConfigField<float> STARTER_CONTROL_FLOAT_FIELDS[] = {
    CONFIG_FIELD(starterAssistPwmPct, "pulsed_assist_pwm_pct"),
    CONFIG_FIELD(starterAssistUntilRpm, "pulsed_assist_until_rpm"),
    CONFIG_FIELD(starterStartupRampPctPerSec, "startup_ramp_pct_per_s"),
};
const ConfigField<uint32_t> STARTER_CONTROL_U32_FIELDS[] = {
    CONFIG_FIELD(starterAssistOnMs, "pulsed_assist_on_ms"),
    CONFIG_FIELD(starterAssistOffMs, "pulsed_assist_off_ms"),
};
const ConfigField<bool> STARTER_CONTROL_BOOL_FIELDS[] = {
    CONFIG_FIELD(starterAssistEnabled, "pulsed_assist_enabled"),
};

const ConfigField<float> STARTUP_FLOAT_FIELDS[] = {
    CONFIG_FIELD(preIgnRpm, "pre_ign_rpm"), CONFIG_FIELD(spoolRpmTarget, "rpm_target"),
    CONFIG_FIELD(safetyHoldFinalRpm, "final_check_rpm"),
    CONFIG_FIELD(safetyHoldFinalN2Rpm, "final_check_n2_rpm"),
    CONFIG_FIELD(safetyHoldFinalP1, "final_check_p1_bar"),
    CONFIG_FIELD(safetyHoldFinalP2, "final_check_p2_bar"),
    CONFIG_FIELD(safetyHoldFinalEgt, "final_check_egt_c"),
    CONFIG_FIELD(starterDemand, "starter_demand"), CONFIG_FIELD(tempConfirmTarget, "temp_confirm_target"),
    CONFIG_FIELD(modifiedIdleMultiplier, "modified_idle_multiplier"),
    CONFIG_FIELD(waitTotCoolTarget, "wait_tot_target"), CONFIG_FIELD(throttleSetPct, "throttle_set_pct"),
    CONFIG_FIELD(oilPumpOnPct, "oil_pump_on_pct"), CONFIG_FIELD(preStartEgtLimitC, "pre_start_egt_limit_c"),
    CONFIG_FIELD(startupEgtLimitC, "startup_egt_limit_c"), CONFIG_FIELD(fp2StartPct, "fp2_start_pct"),
    CONFIG_FIELD(fp2EndPct, "fp2_end_pct"), CONFIG_FIELD(fp2DemandPct, "fp2_demand_pct"),
};
const ConfigField<int> STARTUP_INT_FIELDS[] = {
    CONFIG_FIELD(startupOilArmTimeoutMs, "oil_arm_timeout_ms"),
    CONFIG_FIELD(preIgnSparkMs, "pre_ign_spark_ms"), CONFIG_FIELD(flameTimeoutMs, "flame_timeout_ms"),
    CONFIG_FIELD(flameCheckIntervalMs, "flame_check_interval_ms"),
    CONFIG_FIELD(flameRequiredCount, "flame_required_count"), CONFIG_FIELD(spoolTimeoutMs, "rpm_timeout_ms"),
    CONFIG_FIELD(safetyHoldMs, "safety_hold_ms"), CONFIG_FIELD(safetyHoldTimeoutMs, "safety_hold_timeout_ms"),
    CONFIG_FIELD(starterTimeoutMs, "starter_timeout_ms"), CONFIG_FIELD(tempConfirmTimeoutMs, "temp_confirm_timeout"),
    CONFIG_FIELD(waitForInputChannel, "wait_for_input_ch"),
    CONFIG_FIELD(waitForInputTimeoutMs, "wait_for_input_timeout"),
    CONFIG_FIELD(timedDelayMs, "timed_delay_ms"), CONFIG_FIELD(fuelPulsePulseMs, "fuel_pulse_ms"),
    CONFIG_FIELD(fuelPulseOffMs, "fuel_off_ms"), CONFIG_FIELD(waitTotCoolTimeoutMs, "wait_tot_timeout"),
    CONFIG_FIELD(preHeatMs, "preheat_ms"), CONFIG_FIELD(fp2RampMs, "fp2_ramp_ms"),
    CONFIG_FIELD(govHoldTimeoutMs, "gov_hold_timeout_ms"),
};
const ConfigField<bool> STARTUP_BOOL_FIELDS[] = {
    CONFIG_FIELD(safetyHoldCheckN1, "final_check_n1_enabled"),
    CONFIG_FIELD(safetyHoldCheckN2, "final_check_n2_enabled"),
    CONFIG_FIELD(safetyHoldCheckP1, "final_check_p1_enabled"),
    CONFIG_FIELD(safetyHoldCheckP2, "final_check_p2_enabled"),
    CONFIG_FIELD(safetyHoldCheckOil, "final_check_oil_enabled"),
    CONFIG_FIELD(safetyHoldCheckEgt, "final_check_egt_enabled"),
    CONFIG_FIELD(safetyHoldCheckFlame, "final_check_flame_enabled"),
    CONFIG_FIELD(waitForInputExpected, "wait_for_input_state"),
    CONFIG_FIELD(flameConfirmTurnOffIgniter, "flame_turn_off_igniter"),
    CONFIG_FIELD(safetyHoldTurnOffStarter, "safety_turn_off_starter"),
    CONFIG_FIELD(safetyHoldTurnOffStarterEn, "safety_turn_off_starter_en"),
    CONFIG_FIELD(safetyHoldTurnOffIgniter, "safety_turn_off_igniter"),
    CONFIG_FIELD(spoolCutStarterOnExit, "spool_cut_starter_on_exit"),
    CONFIG_FIELD(spoolCutStarterEnOnExit, "spool_cut_starter_en_on_exit"),
    CONFIG_FIELD(oilPrimeUseScavengePump, "oil_prime_use_scavenge"),
};

const ConfigField<float> SHUTDOWN_FLOAT_FIELDS[] = {
    CONFIG_FIELD(shutdownRpmDropThreshold, "rpm_drop_threshold"),
    CONFIG_FIELD(cooldownStarterPct, "cooldown_starter_pct"),
    CONFIG_FIELD(cooldownOilPct, "cooldown_oil_pct"),
    CONFIG_FIELD(cooldownOilPressureTarget, "cooldown_oil_pressure_bar"),
    CONFIG_FIELD(rpmZeroThreshold, "rpm_zero_threshold"),
};
const ConfigField<int> SHUTDOWN_INT_FIELDS[] = {
    CONFIG_FIELD(shutdownRpmDropTimeoutMs, "rpm_drop_timeout_ms"),
    CONFIG_FIELD(shutdownCooldownTimeoutMs, "cooldown_timeout_ms"),
    CONFIG_FIELD(shutdownFinalStopTimeoutMs, "final_stop_timeout_ms"),
    CONFIG_FIELD(finalStopOilScavengeMs, "oil_scavenge_ms"),
};
const ConfigField<bool> SHUTDOWN_BOOL_FIELDS[] = {
    CONFIG_FIELD(cooldownUseScavengePump, "cooldown_use_scavenge"),
    CONFIG_FIELD(cooldownUseStarter, "cooldown_use_starter"),
    CONFIG_FIELD(cooldownUseOilPump, "cooldown_use_oil"),
};

const ConfigField<float> OIL_ADVANCED_FLOAT_FIELDS[] = {
    CONFIG_FIELD(oilZeroBar, "zero_bar"), CONFIG_FIELD(oilPressureDeadband, "deadband_bar"),
};
const ConfigField<uint32_t> OIL_ADVANCED_U32_FIELDS[] = {
    CONFIG_FIELD(oilPumpUnderflowDelayMs, "pump_underflow_delay_ms"),
};
const ConfigField<bool> OIL_ADVANCED_BOOL_FIELDS[] = {
    CONFIG_FIELD(shutdownOnOilUnderflow, "shutdown_on_underflow"),
};
const ConfigField<float> STANDBY_OIL_FLOAT_FIELDS[] = {
    CONFIG_FIELD(standbyOilRpmLimit, "rpm_limit"), CONFIG_FIELD(standbyOilFeedPct, "feed_pct"),
    CONFIG_FIELD(standbyOilFeedBar, "feed_bar"),
};
const ConfigField<int> STANDBY_OIL_INT_FIELDS[] = {CONFIG_FIELD(standbyOilSource, "source")};
const ConfigField<bool> STANDBY_OIL_BOOL_FIELDS[] = {CONFIG_FIELD(standbyOilEnabled, "enabled")};
const ConfigField<int> MISC_INT_FIELDS[] = {
    CONFIG_FIELD(cooldownSkipHoldMs, "cooldown_skip_hold_ms"),
    CONFIG_FIELD(manualRelightIgnitionTarget, "igniter_on_start_target"),
};
const ConfigField<bool> MISC_BOOL_FIELDS[] = {CONFIG_FIELD(igniterOnStart, "igniter_on_start")};
const ConfigField<float> RPM_HEALTH_FLOAT_FIELDS[] = {CONFIG_FIELD(rpmJumpThreshold, "jump_threshold")};
const ConfigField<int> RPM_HEALTH_INT_FIELDS[] = {CONFIG_FIELD(rpmZeroStuckTicks, "zero_stuck_ticks")};
const ConfigField<float> CLUSTER_FLOAT_FIELDS[] = {
    CONFIG_FIELD(n1WarnRpm, "n1_warn_rpm"), CONFIG_FIELD(n2WarnRpm, "n2_warn_rpm"),
    CONFIG_FIELD(totWarnC, "tot_warn_c"), CONFIG_FIELD(oilWarnBar, "oil_warn_bar"),
};
const ConfigField<float> LIMP_FLOAT_FIELDS[] = {CONFIG_FIELD(limpMaxThrottlePct, "max_throttle_pct")};
const ConfigField<int> RC_INPUT_INT_FIELDS[] = {CONFIG_FIELD(rcFailsafeMs, "failsafe_ms")};

#undef CONFIG_FIELD

}  // namespace

// ── Private helpers ───────────────────────────────────────────
bool Config::applyJsonRuntimeOnly(const JsonDocument& doc, bool allowActiveLive,
                                  bool validateHardwareDependencies) {
    if (isLocked() && !allowActiveLive) {
        Serial.println("[Config] Runtime candidate rejected: configuration is locked");
        return false;
    }
    if (!(validateHardwareDependencies ? validateJson(doc) : validateJsonValues(doc))) {
        Serial.printf("[Config] Runtime candidate rejected: validation failed (overflow=%d, bytes=%u)\n",
                      doc.overflowed() ? 1 : 0, (unsigned)measureJson(doc));
        return false;
    }
    const char* id = doc["profile_id"] | "";
    if (!id[0] || strcmp(id, HardwareConfig::profileId) != 0) {
        Serial.printf("[Config] Runtime candidate rejected: profile '%s' != '%s'\n",
                      id, HardwareConfig::profileId);
        return false;
    }
    _fromDoc(doc, validateHardwareDependencies);
    profileMatch = true;
    EngineData::instance().configVersionMismatch = false;
    return true;
}

bool Config::applyJsonLivePatch(const JsonDocument& patch) {
    JsonObjectConst root = patch.as<JsonObjectConst>();
    if (root.isNull() || root.size() == 0) return false;

    // The HTTP gate accepts only these three sections and their explicitly
    // live-safe scalar fields. Recheck the section envelope on Core 1 so a
    // future producer cannot turn this narrow transaction into a full config
    // replacement while an engine is active.
    for (JsonPairConst section : root) {
        const char* name = section.key().c_str();
        if (!section.value().is<JsonObjectConst>()) return false;
        JsonObjectConst values = section.value().as<JsonObjectConst>();
        if (!strcmp(name, "throttle")) {
            if (!liveSectionKeysValid(values, LIVE_THROTTLE_FLOAT_FIELDS)) return false;
        } else if (!strcmp(name, "governor")) {
            if (!liveSectionKeysValid(values, GOVERNOR_FLOAT_FIELDS)) return false;
        } else if (!strcmp(name, "dynamic_idle")) {
            if (!liveSectionKeysValid(values, IDLE_FLOAT_FIELDS)) return false;
        } else return false;
    }

    JsonVariantConst throttle = root["throttle"];
    JsonVariantConst governor = root["governor"];
    JsonVariantConst idle = root["dynamic_idle"];
    if (!throttle.isNull()) readConfigFields(throttle, LIVE_THROTTLE_FLOAT_FIELDS);
    if (!governor.isNull()) readConfigFields(governor, GOVERNOR_FLOAT_FIELDS);
    if (!idle.isNull()) readConfigFields(idle, IDLE_FLOAT_FIELDS);
    return true;
}

bool Config::persistJsonCandidateReleasing(JsonDocument& doc, char*& outJson,
                                           size_t& outLen, char* scratch,
                                           size_t scratchLen) {
    outJson = nullptr;
    outLen = 0;
    if (!validateJson(doc)) return false;
    const char* id = doc["profile_id"] | "";
    if (!id[0] || strcmp(id, HardwareConfig::profileId) != 0) return false;
    const size_t required = measureJson(doc);
    if (required == 0 || required > 32768) return false;
#if defined(OT_PLATFORM_ESP32) || defined(OT_PLATFORM_ESP32S3)
    // The web server owns two fixed transfer buffers already. Serialize into
    // its unused response buffer, release the complete merged ArduinoJson tree,
    // and only then call LittleFS.open(). Arduino FS constructs a heap-backed
    // shared_ptr internally; opening the file while the tree was resident could
    // throw bad_alloc and abort Classic ESP32 before its error path could run.
    if (!scratch || required >= scratchLen ||
        serializeJson(doc, scratch, scratchLen) != required) {
        Serial.println("[Config] Candidate does not fit the reserved web scratch buffer");
        return false;
    }
    doc.clear();
    doc.shrinkToFit();
    delay(0);
    if (ESP.getMaxAllocHeap() < 4096) {
        Serial.println("[Config] Candidate staging deferred - low contiguous heap after release");
        return false;
    }
    // The exact validated generation is already staged.  Do not read it into
    // a second heap buffer merely to write the same bytes back to the staging
    // file and then parse them on the ECU core.  Apart from being redundant,
    // that large short-lived allocation fragments the small internal DRAM
    // pool shared with Wi-Fi.  A non-zero length with a null pointer tells the
    // unified writer and ECU core to stream this staged generation directly.
    char* candidate = nullptr;
#else
    char* candidate = static_cast<char*>(malloc(required + 1));
    if (!candidate) return false;
    if (serializeJson(doc, candidate, required + 1) != required) {
        free(candidate);
        return false;
    }
    doc.clear();
    doc.shrinkToFit();
#endif
    const char* persistedCandidate = candidate ? candidate : scratch;
    if (!_saveSettingsJson(persistedCandidate, required)) {
        free(candidate);
        return false;
    }
    outJson = candidate;
    outLen = required;
    return true;
}

float Config::applyFuelPumpMinimum(float demand01) {
    float demand = constrain(demand01, 0.0f, 1.0f);
    float minDemand = constrain(fuelPumpMinPct / 100.0f, 0.0f, 1.0f);
    if (minDemand <= 0.0f) return demand;
    return (demand > 0.0f && demand < minDemand) ? 0.0f : demand;
}

float Config::effectiveMainFuelDemand(const EngineData& ed) {
    const float base = constrain(ed.throttleDemand, 0.0f, 1.0f);
    // An authoritative zero is Off. A stale or simultaneous AB coordination
    // request must never create main fuel from an already-off command.
    if (base <= 0.0f) return 0.0f;

    const float requestedOffset = ed.abFuelOffset;
    const float allowedOffset = (ed.mainFuelProtectionActive || ed.limpMode)
        ? min(requestedOffset, 0.0f) : requestedOffset;
    float demand = constrain(base + allowedOffset, 0.0f, 1.0f);

    // Negative AB coordination may reduce a running pump, but it may not push
    // that pump through the calibrated unreliable band and thereby turn it off.
    const float minRun = constrain(fuelPumpMinPct / 100.0f, 0.0f, 1.0f);
    const bool baseWasRunning = minRun <= 0.0f || base >= minRun;
    if (allowedOffset < 0.0f && baseWasRunning && demand < minRun) demand = minRun;

    if (ed.limpMode && (ed.mode == SysMode::STARTUP || ed.mode == SysMode::RUNNING))
        demand = min(demand, constrain(limpMaxThrottlePct / 100.0f, 0.0f, 1.0f));
    return ed.mode == SysMode::STANDBY ? demand : applyFuelPumpMinimum(demand);
}

void Config::_applyDefaults() {
    // Re-assign every field to its compile-time default so that load() is
    // idempotent: missing JSON keys restore to the default rather than
    // keeping a stale runtime value from a previous load() call.
    rpmLimit = 100000; n2RpmLimit = 0; minRpm = 30000; totLimit = 750;
    totCooldownTarget = 150; totSafeMargin = 50;
    oilStartupPressure = 2.5f; oilStartupPct = 80.0f; oilStartupMinBar = 1.5f;
    oilRunningMin = 2.8f; oilMapMin = 3.6f; oilMapMax = 4.4f;
    oilUseThrottleMap = false; oilAdjustScale = 1.80f; oilMinPct = 18.0f;
    oilFailsafeDelayMs = 1500; oilFailsafePct = 60.0f;
    startupOilArmTimeoutMs = 3000; preIgnRpm = 5000; preIgnSparkMs = 1500;
    flameTimeoutMs = 5000; flameCheckIntervalMs = 300; flameRequiredCount = 3;
    spoolRpmTarget = 32000; spoolTimeoutMs = 12000;
    safetyHoldMs = 1000; safetyHoldTimeoutMs = 15000; safetyHoldFinalRpm = 31000;
    safetyHoldCheckN1 = true; safetyHoldCheckN2 = false; safetyHoldCheckP1 = false;
    safetyHoldCheckP2 = false; safetyHoldCheckOil = false; safetyHoldCheckEgt = false;
    safetyHoldCheckFlame = false; safetyHoldFinalN2Rpm = 0.0f;
    safetyHoldFinalP1 = 0.0f; safetyHoldFinalP2 = 0.0f; safetyHoldFinalEgt = 0.0f;
    starterDemand = 60.0f; starterTimeoutMs = 8000;
    tempConfirmTarget = 200.0f; tempConfirmTimeoutMs = 10000;
    waitForInputChannel = 0; waitForInputExpected = true; waitForInputTimeoutMs = 0;
    timedDelayMs = 1000; modifiedIdleMultiplier = 1.0f;
    fuelPulsePulseMs = 200; fuelPulseOffMs = 300;
    waitTotCoolTarget = 150.0f; waitTotCoolTimeoutMs = 120000;
    throttleSetPct = 10.0f; preHeatMs = 3000; oilPumpOnPct = 100.0f;
    flameConfirmTurnOffIgniter = true;
    safetyHoldTurnOffStarter = false; safetyHoldTurnOffStarterEn = false; safetyHoldTurnOffIgniter = false;
    spoolCutStarterOnExit = true; spoolCutStarterEnOnExit = true;
    preStartEgtLimitC = 150.0f; startupEgtLimitC = 0.0f; finalStopOilScavengeMs = 0;
    oilPrimeUseScavengePump = false; cooldownUseScavengePump = false;
    shutdownRpmDropThreshold = 5000; shutdownRpmDropTimeoutMs = 15000;
    shutdownCooldownTimeoutMs = 60000; shutdownFinalStopTimeoutMs = 10000;
    rpmZeroThreshold = 100.0f;
    cooldownUseStarter = true; cooldownUseOilPump = true;
    cooldownStarterPct = 40.0f; cooldownOilPct = 30.0f; cooldownOilPressureTarget = 2.0f;
    throttleRampUpMs = 600; throttleRampDownMs = 800;
    throttleIdleMaxPct = 18; throttleExpo = 0.0f;
    fuelPumpMinPct = 0;
    pullbackN1Enabled = true; pullbackN2Enabled = false; pullbackEgtEnabled = true;
    pullbackP1Enabled = false; pullbackP2Enabled = false; pullbackTorqueEnabled = false;
    pullbackN1SoftRpm = 95000.0f; pullbackN1HardRpm = 100000.0f;
    pullbackN2SoftRpm = 0.0f; pullbackN2HardRpm = 0.0f;
    pullbackEgtSoftC = 700.0f; pullbackEgtHardC = 750.0f;
    pullbackP1Soft = pullbackP1Hard = pullbackP2Soft = pullbackP2Hard = 0.0f;
    pullbackTorqueSoft = pullbackTorqueHard = 0.0f;
    p1TripLimit = p2TripLimit = torqueTripLimit = 0.0f;
    p1TripConfirmMs = p2TripConfirmMs = torqueTripConfirmMs = 250;
    pullbackMinThrottlePct = 8.0f; pullbackNearLimitRampUpMs = 4000.0f;
    pullbackApproachZoneRpm = 0.0f; rpmAccelFilter = 0.20f;
    pullbackN1Mode = pullbackN2Mode = pullbackEgtMode = 0;
    pullbackP1Mode = pullbackP2Mode = pullbackTorqueMode = 0;
    pullbackN1LookaheadMs = pullbackN2LookaheadMs = pullbackEgtLookaheadMs = 1500.0f;
    pullbackP1LookaheadMs = pullbackP2LookaheadMs = pullbackTorqueLookaheadMs = 1500.0f;
    pullbackN1Strength = pullbackN2Strength = pullbackEgtStrength = 1.0f;
    pullbackP1Strength = pullbackP2Strength = pullbackTorqueStrength = 1.0f;
    idleTargetRpm = 44000; idleRampUpMs = 10000; idleRampDownMs = 20000;
    idleDeadbandRpm = 300; idleRpmLimit = 60000; idleMaxMultiplier = 1.50f;
    idleUseN2 = ConfigInternal::idleUseN2Default; idleIGain = 0.0f; idleIMax = 0.10f;
    idleSource = ConfigInternal::idleUseN2Default ? 1 : 0;
    idleTargetPressure = 1.0f; idlePressureDeadband = 0.03f; idlePressureLimit = 2.0f;
    idleMode = 0; idleDecelEnterRpm = 0.0f; idleDecelDropPct = 0.0f; idleLookaheadMs = 2500.0f;
    idleSettleBandRpm = 1500.0f; idleFullResponseRpm = 12000.0f; idleTrimUpPctPerSec = 4.0f;
    idleTrimDownPctPerSec = 2.0f; idleLearnRate = 0.02f; idleLearnAccelMax = 1200.0f;
    idlePressureDecelEnter = 0.0f; idlePressureSettleBand = 0.03f;
    idlePressureFullResponse = 0.25f; idlePressureLearnRateMax = 1.0f;
    safetyCheckIntervalMs = 100; flameoutShutdownMs = 3000;
    lowOilConfirmMs = 500; oilZeroConfirmMs = 100; oilTempConfirmMs = 1000;
    fuelPressConfirmMs = 500; battLowConfirmMs = 1000;
    egtSource = 0; flameoutSource = 0; flameoutN1MinRpm = 0.0f;
    flameoutEgtBelowC = 300.0f; flameoutEgtFallRateCPerSec = 50.0f;
    titLimit = 0.0f; oilTempLimit = 120.0f;
    fuelPressMin = 0.0f; battVoltMin = 0.0f; surgeDetectRpmVariance = 0.0f;
    relightEnabled = false; relightTriggerSource = 0; relightTriggerConfirmMs = 200;
    relightTriggerEgtBelowC = 300.0f; relightTriggerEgtFallRateCPerSec = 50.0f;
    relightIgnitionTarget = 0; relightConfirmSource = 0; relightMinRpm = 30000.0f;
    relightOutputId[0] = '\0';
    relightConfirmRpm = 35000.0f; relightTotRiseC = 30.0f; relightTimeoutMs = 2000;
    toolFuelPrimeMs = 3000; toolOilPrimeMs = 5000; toolIgnTestMs = 2000; toolIgn2TestMs = 2000;
    toolGlowTestMs = 10000; toolGlowTestPct = 100.0f;
    toolStartTestMs = 2000; toolStartTestPct = 30.0f; toolFuelSolTestMs = 1000;
    toolIdleTestMs = 3000; toolOilScavTestMs = 2000; toolCoolFanTestMs = 3000;
    toolAirstarterTestMs = 1000; toolBleedValveTestMs = 1000;
    toolFuelPump2TestMs = 3000; toolFuelPump2TestPct = 30.0f;
    toolAbSolTestMs = 1000; toolAbPumpTestMs = 2000; toolAbPumpTestPct = 30.0f;
    toolStarterEnTestMs = 1000; toolPropPitchTestMs = 3000; toolPropPitchTestPct = 50.0f;
    wsIntervalMs = 333; snapshotIntervalMs = 10000; controlLoopHz = 400; logStandby = false;
    strcpy(uiTheme, "carbon");
    starterAssistEnabled = false; starterAssistPwmPct = 15.0f; starterAssistUntilRpm = 1000.0f;
    starterAssistOnMs = 500; starterAssistOffMs = 250; starterStartupRampPctPerSec = 10.0f;
    oilZeroBar = 0.1f; oilPressureDeadband = 0.2f;
    oilPumpUnderflowDelayMs = 5000; shutdownOnOilUnderflow = false;
    standbyOilEnabled = false;
    standbyOilSource = 0; standbyOilRpmLimit = 1000.0f; standbyOilFeedPct = 25.0f;
    standbyOilFeedBar = 0.0f;
    standbyOilOutputId[0] = '\0';
    limpMaxThrottlePct = 50.0f; igniterOnStart = true; manualRelightIgnitionTarget = 0;
    cooldownSkipHoldMs = 1000;
    manualRelightOutputId[0] = '\0';
    fp2StartPct = 0.0f; fp2EndPct = 80.0f; fp2RampMs = 3000; fp2DemandPct = 0.0f;
    govHoldTimeoutMs = 10000;
    abMinN1 = 30000.0f; abMaxN1 = 0.0f; abMaxTotForLight = 0.0f;
    abThrottleThreshold = 0.80f; abUseTorch = false; abUseIgniter = false;
    abTorchSpikePct = 30.0f; abTorchDurationMs = 400; abTorchTotLimit = 0.0f; abTorchGuardMode = 0;
    abFlameMode = 2; abTotRiseDegC = 30.0f; abTotRiseWindowMs = 2000;
    abAssumeIgnitedMs = 1500; abFlameTimeoutMs = 3000; abFlameLossDelayMs = 1000;
    abLightupPumpPct = 80.0f; abPumpMinPct = 80.0f; abPumpMaxPct = 100.0f; abPumpControlMode = 0;
    abMainFuelOffsetPct = 0.0f; abStabilizeMs = 1000; abStabilizeMaxTot = 0.0f;
    rpmJumpThreshold = 0.40f; rpmZeroStuckTicks = 5;
    n1WarnRpm = 0.0f; n2WarnRpm = 22000.0f; totWarnC = 0.0f; oilWarnBar = 0.0f;  // n1 0 = auto (rpmLimit*0.9)
    rcFailsafeMs = 500;
    governorTargetRpm = 0.0f; governorBandRpm = 500.0f;
    governorKp = 0.00025f; governorPitchKp = 0.00020f; governorPitchRampSec = 10.0f;
    glowPreheatMs = 10000; glowPreheatMaxPct = 80.0f; glowHoldPct = 30.0f; glowWaitUntilHot = false;
    throttleMinRaw = 0; throttleMaxRaw = 4095;
    idleMinRaw = 0; idleMaxRaw = 4095;
    oilPolyA = 0; oilPolyB = 0; oilPolyC = 0; oilPolyD = 0;
    oilPolyXMin = 0; oilPolyXMax = 4095;
    p1RawMin = 0; p1RawMax = 4095; p1ValMax = 10.0f;
    p2RawMin = 0; p2RawMax = 4095; p2ValMax = 10.0f;
    fuelPressRawMin = 0; fuelPressRawMax = 4095; fuelPressValMax = 10.0f;
    fuelFlowRawMin = 0; fuelFlowRawMax = 4095; fuelFlowValMax = 10.0f;
    sessionLogMask = SLOG_DEFAULT; sessionLogIntervalMs = 1000;
    sessionRegistryInputCount = 0;
    memset(sessionRegistryInputIds, 0, sizeof(sessionRegistryInputIds));
    // New/factory profiles use the explicit output-first controller model.
    // Keep schema 0 only when loading an older saved document so the UI can
    // offer its reviewable one-time migration. A fresh ECU must never open
    // Controllers already claiming that untouched defaults are unsaved.
    controllerSchema = 1;
    ruleCount = 0;
    for (int i = 0; i < MAX_RULES; i++) rules[i] = {};
    {
        Rule& fuel = rules[ruleCount++];
        fuel.enabled = true;
        fuel.kind = 1;  // mapped input
        // Fresh defaults have not passed through _fromDoc(), so initialize
        // both runtime handles as well as their persistent IDs. Otherwise the
        // first hardware-dependency cleanup treats this valid default rule as
        // an unavailable sensor/output and silently removes it.
        fuel.sensor = RulesEngine::THROTTLE_INPUT;
        fuel.actuator = RulesEngine::THROTTLE;
        fuel.inputMin = 0.0f;
        fuel.inputMax = 1.0f;
        fuel.outputMin = 0.0f;
        fuel.outputMax = 1.0f;
        fuel.onValue = 1.0f;
        fuel.offValue = 0.0f;
        fuel.targetHigh = 1.0f;
        fuel.targetInputMax = 1.0f;
        fuel.responseGain = 0.02f;
        fuel.integralGain = 0.005f;
        fuel.deadband = 0.01f;
        fuel.modeMask = 4;  // RUNNING
        strlcpy(fuel.name, "Main Fuel", sizeof(fuel.name));
        strlcpy(fuel.sourceId, "operator_throttle", sizeof(fuel.sourceId));
        strlcpy(fuel.targetId, "main_fuel", sizeof(fuel.targetId));
    }
    loadWarning[0] = '\0';
    // Runtime stats are NOT reset here; hour meter data persists across config reloads.
}

void Config::_fromDoc(const JsonDocument& doc, bool resolveRuleHandles) {
    controllerSchema = constrain((int)(doc["controller_schema"] | 0), 0, 1);
    // Warn if an expected top-level section is entirely absent.
    // This typically means the file is truncated or severely corrupted —
    // individual missing fields within a section are normal during version upgrades
    // and are handled silently (they keep their compile-time defaults).
    const char* requiredSections[] = {
        "engine", "oil", "sequence", "throttle", "safety", "calibration"
    };
    for (const char* sec : requiredSections) {
        if (!doc[sec].is<JsonObjectConst>()) {
            _missingRequiredSections = true;
            // Do not spam UART from the boot task for every absent section:
            // on some USB/serial host states that can block long enough to trip
            // the interrupt watchdog. Config::load() emits one repair message
            // and saves a completed file after _fromDoc().
        }
    }

    // UI theme (cosmetic; the browser falls back to the default for unknown keys)
    { const char* th = doc["ui_theme"] | "";
      if (th[0]) { strncpy(uiTheme, th, sizeof(uiTheme) - 1); uiTheme[sizeof(uiTheme) - 1] = '\0'; } }

    auto eng = doc["engine"];
    readConfigFields(eng, ENGINE_FLOAT_FIELDS);

    auto oil = doc["oil"];
    readConfigFields(oil, OIL_FLOAT_FIELDS);
    readConfigFields(oil, OIL_INT_FIELDS);
    readConfigFields(oil, OIL_BOOL_FIELDS);

    auto su = doc["sequence"]["startup"];
    readConfigFields(su, STARTUP_FLOAT_FIELDS);
    readConfigFields(su, STARTUP_INT_FIELDS);
    readConfigFields(su, STARTUP_BOOL_FIELDS);

    auto sd = doc["sequence"]["shutdown"];
    readConfigFields(sd, SHUTDOWN_FLOAT_FIELDS);
    readConfigFields(sd, SHUTDOWN_INT_FIELDS);
    readConfigFields(sd, SHUTDOWN_BOOL_FIELDS);

    auto th = doc["throttle"];
    readConfigFields(th, THROTTLE_FLOAT_FIELDS);
    readConfigFields(th, THROTTLE_INT_FIELDS);
    readConfigFields(th, THROTTLE_BOOL_FIELDS);

    auto di = doc["dynamic_idle"];
    const bool hasPressureDecelEnter = !di["pressure_decel_enter_bar"].isNull();
    const bool hasPressureSettleBand = !di["pressure_settle_band_bar"].isNull();
    const bool hasPressureFullResponse = !di["pressure_full_response_bar"].isNull();
    const bool hasPressureLearnRate = !di["pressure_learn_rate_max_bar_s"].isNull();
    readConfigFields(di, IDLE_FLOAT_FIELDS);
    readConfigFields(di, IDLE_BOOL_FIELDS);
    const bool idleSourceMissing = di["source"].isNull();
    readConfigFields(di, IDLE_INT_FIELDS);
    if (idleSourceMissing) idleSource = idleUseN2 ? 1 : 0;
    // Predictive deceleration catch is opt-in. Older files without this field
    // must not silently acquire a fuel-drop behavior after an update.
    if (!hasPressureDecelEnter) idlePressureDecelEnter = 0.0f;
    if (!hasPressureSettleBand)
        idlePressureSettleBand = max(idlePressureDeadband, idleTargetPressure * 0.01f);
    if (!hasPressureFullResponse)
        idlePressureFullResponse = max(idlePressureDeadband, idleTargetPressure * 0.25f);
    if (!hasPressureLearnRate)
        idlePressureLearnRateMax = max(0.01f, idleTargetPressure);

    auto sf = doc["safety"];
    if (sf["egt_source"].isNull()) _missingRequiredSections = true;
    readConfigFields(sf, SAFETY_FLOAT_FIELDS);
    readConfigFields(sf, SAFETY_INT_FIELDS);
    readConfigFields(sf, SAFETY_U32_FIELDS);
    if (egtSource < 0 || egtSource > 2) egtSource = 0;

    auto gov = doc["governor"];
    readConfigFields(gov, GOVERNOR_FLOAT_FIELDS);

    auto glw = doc["glow_plug"];
    readConfigFields(glw, GLOW_FLOAT_FIELDS);
    readConfigFields(glw, GLOW_INT_FIELDS);
    readConfigFields(glw, GLOW_BOOL_FIELDS);

    auto cal = doc["calibration"];
    readConfigFields(cal, CAL_FLOAT_FIELDS);
    readConfigFields(cal, CAL_INT_FIELDS);

    auto poly = cal["oil_poly"];
    readConfigFields(poly, OIL_POLY_FLOAT_FIELDS);

    auto rl = doc["relight"];
    readConfigFields(rl, RELIGHT_FLOAT_FIELDS);
    readConfigFields(rl, RELIGHT_INT_FIELDS);
    readConfigFields(rl, RELIGHT_BOOL_FIELDS);
    strlcpy(relightOutputId, rl["output_id"] | "", sizeof(relightOutputId));

    auto tl = doc["tools"];
    readConfigFields(tl, TOOL_U32_FIELDS);
    readConfigFields(tl, TOOL_FLOAT_FIELDS);

    auto tm = doc["telemetry"];
    readConfigFields(tm, TELEMETRY_U32_FIELDS);
    readConfigFields(tm, TELEMETRY_BOOL_FIELDS);

    auto sa = doc["starter_control"];
    readConfigFields(sa, STARTER_CONTROL_FLOAT_FIELDS);
    readConfigFields(sa, STARTER_CONTROL_U32_FIELDS);
    readConfigFields(sa, STARTER_CONTROL_BOOL_FIELDS);

    auto oilx = doc["oil_advanced"];
    readConfigFields(oilx, OIL_ADVANCED_FLOAT_FIELDS);
    readConfigFields(oilx, OIL_ADVANCED_U32_FIELDS);
    readConfigFields(oilx, OIL_ADVANCED_BOOL_FIELDS);

    auto sob = doc["standby_oil"];
    readConfigFields(sob, STANDBY_OIL_FLOAT_FIELDS);
    readConfigFields(sob, STANDBY_OIL_INT_FIELDS);
    readConfigFields(sob, STANDBY_OIL_BOOL_FIELDS);
    strlcpy(standbyOilOutputId, sob["output_id"] | "", sizeof(standbyOilOutputId));

    auto limp = doc["limp_mode"];
    readConfigFields(limp, LIMP_FLOAT_FIELDS);

    auto misc = doc["misc"];
    readConfigFields(misc, MISC_INT_FIELDS);
    readConfigFields(misc, MISC_BOOL_FIELDS);
    strlcpy(manualRelightOutputId, misc["igniter_on_start_output_id"] | "", sizeof(manualRelightOutputId));

    auto rh = doc["rpm_health"];
    readConfigFields(rh, RPM_HEALTH_FLOAT_FIELDS);
    readConfigFields(rh, RPM_HEALTH_INT_FIELDS);

    auto cl = doc["cluster"];
    readConfigFields(cl, CLUSTER_FLOAT_FIELDS);

    auto rc = doc["rc_input"];
    readConfigFields(rc, RC_INPUT_INT_FIELDS);

    auto ab = doc["afterburner"];
    readConfigFields(ab, AFTERBURNER_FLOAT_FIELDS);
    readConfigFields(ab, AFTERBURNER_INT_FIELDS);
    readConfigFields(ab, AFTERBURNER_BOOL_FIELDS);

    // Session log mask stored as individual bools in JSON
    auto sl = doc["session_log"];
    if (!sl.isNull()) {
        uint32_t mask = 0;
        if (sl["n1"]       | false) mask |= SLOG_N1;
        if (sl["n2"]       | false) mask |= SLOG_N2;
        if (sl["tot"]      | false) mask |= SLOG_TOT;
        if (sl["oil_temp"] | false) mask |= SLOG_OIL_TEMP;
        if (sl["oil"]      | false) mask |= SLOG_OIL;
        if (sl["p1"]       | false) mask |= SLOG_P1;
        if (sl["p2"]       | false) mask |= SLOG_P2;
        if (sl["throttle"]   | false) mask |= SLOG_THR;
        if (sl["mode"]       | false) mask |= SLOG_MODE;
        if (sl["tit"]        | false) mask |= SLOG_TIT;
        if (sl["batt"]       | false) mask |= SLOG_BATT;
        if (sl["fuel_press"] | false) mask |= SLOG_FUEL_PRESS;
        if (sl["fuel_flow"]  | false) mask |= SLOG_FUEL_FLOW;
        if (sl["glow"]       | false) mask |= SLOG_GLOW;
        if (sl["wet_glow"]   | false) mask |= SLOG_WET_GLOW;
        if (sl["glow_current"] | false) mask |= SLOG_GLOW_CURRENT;
        if (sl["ign_current"]  | false) mask |= SLOG_IGN_CURRENT;
        if (sl["ign2_current"] | false) mask |= SLOG_IGN2_CURRENT;
        if (sl["oil_current"]  | false) mask |= SLOG_OIL_CURRENT;
        if (sl["fp2"]        | false) mask |= SLOG_FP2;
        if (sl["ab"]         | false) mask |= SLOG_AB;
        if (sl["prop"]       | false) mask |= SLOG_PROP;
        if (sl["oil_pct"]    | false) mask |= SLOG_OIL_PCT;
        if (sl["loop"]       | false) mask |= SLOG_LOOP;
        if (sl["torque"]     | false) mask |= SLOG_TORQUE;
        if (sl["starter"]    | false) mask |= SLOG_STARTER;
        if (sl["thrust"]     | false) mask |= SLOG_THRUST;
        sessionLogMask = mask;
        sessionLogIntervalMs = sl["interval_ms"] | sessionLogIntervalMs;
        sessionRegistryInputCount = 0;
        memset(sessionRegistryInputIds, 0, sizeof(sessionRegistryInputIds));
        JsonArrayConst registryInputs = sl["registry_inputs"].as<JsonArrayConst>();
        for (JsonVariantConst item : registryInputs) {
            const char* id = item.as<const char*>();
            if (!id || !id[0] || strlen(id) >= sizeof(sessionRegistryInputIds[0])) continue;
            bool duplicate = false;
            for (uint8_t i = 0; i < sessionRegistryInputCount; ++i)
                if (!strcmp(sessionRegistryInputIds[i], id)) { duplicate = true; break; }
            if (duplicate || sessionRegistryInputCount >= MAX_SESSION_REGISTRY_INPUTS) continue;
            strncpy(sessionRegistryInputIds[sessionRegistryInputCount], id,
                    sizeof(sessionRegistryInputIds[0]) - 1);
            ++sessionRegistryInputCount;
        }
    }

    auto stats = doc["stats"];
    if (!stats.isNull()) {
        // Read the file values first (ArduinoJson lookups), then take the mux
        // only for the compare-assign so the critical section stays tiny. A
        // missing key reads as 0, which never beats the running counter.
        uint32_t fileRunSeconds    = stats["total_run_seconds"]   | 0u;
        uint32_t fileStartAttempts = stats["start_attempt_count"] | 0u;
        uint32_t fileRuns          = stats["run_count"]           | 0u;
        portENTER_CRITICAL(&ConfigInternal::statsMux);
        if (fileRunSeconds    > totalRunSeconds)   totalRunSeconds   = fileRunSeconds;
        if (fileStartAttempts > startAttemptCount) startAttemptCount = fileStartAttempts;
        if (fileRuns          > runCount)          runCount          = fileRuns;
        portEXIT_CRITICAL(&ConfigInternal::statsMux);
    }

    // ── Automation rules ──────────────────────────────────────────
    auto rulesArr = doc["rules"];
    ruleCount = 0;
    for (int i = 0; i < MAX_RULES; i++) rules[i] = {};
    if (!rulesArr.isNull() && rulesArr.is<JsonArrayConst>()) {
        for (JsonObjectConst jr : rulesArr.as<JsonArrayConst>()) {
            if (ruleCount >= MAX_RULES) break;
            Rule& r = rules[ruleCount++];
            r.enabled   = jr["enabled"]   | false;
            r.kind      = (uint8_t)(jr["kind"]      | 0);
            r.op        = (uint8_t)(jr["op"]        | 0);
            r.threshold = jr["threshold"] | 0.0f;
            r.onValue   = jr["on_value"]  | 1.0f;
            r.offValue  = jr["off_value"] | 0.0f;
            r.hysteresis= jr["hysteresis"] | 0.0f;
            r.inputMin  = jr["input_min"]  | 0.0f;
            r.inputMax  = jr["input_max"]  | 1.0f;
            r.outputMin = jr["output_min"] | 0.0f;
            r.outputMax = jr["output_max"] | 1.0f;
            r.targetSourceType = (uint8_t)(jr["target_source_type"] | 0);
            r.targetFixed = jr["target_fixed"] | 0.0f;
            r.targetLow = jr["target_low"] | 0.0f;
            r.targetHigh = jr["target_high"] | 1.0f;
            r.targetInputMin = jr["target_input_min"] | 0.0f;
            r.targetInputMax = jr["target_input_max"] | 1.0f;
            r.responseGain = jr["response_gain"] | 0.01f;
            r.integralGain = jr["integral_gain"] | 0.001f;
            r.deadband = jr["deadband"] | 0.0f;
            r.modeMask  = (uint8_t)(jr["mode_mask"] | 0x0E);
            const char* n = jr["name"] | "";
            strncpy(r.name, n, sizeof(r.name) - 1);
            r.name[sizeof(r.name) - 1] = '\0';
            const char* source = jr["source"] | "";
            const char* target = jr["target"] | "";
            const char* targetSource = jr["target_source"] | "";
            strlcpy(r.sourceId, source, sizeof(r.sourceId));
            strlcpy(r.targetId, target, sizeof(r.targetId));
            strlcpy(r.targetSourceId, targetSource, sizeof(r.targetSourceId));
            if (resolveRuleHandles) {
                const int8_t sourceHandle = r.kind == 3 ? 0 :
                    ConfigInternal::ruleSourceHandle(r.sourceId);
                const int8_t targetHandle = ConfigInternal::ruleTargetHandle(r.targetId);
                const int8_t targetSourceHandle = r.targetSourceType == 0 ? 0 :
                    ConfigInternal::ruleSourceHandle(r.targetSourceId);
                if (sourceHandle < 0 || targetHandle < 0 || targetSourceHandle < 0) {
                    r.enabled = false;
                } else {
                    r.sensor = (uint8_t)sourceHandle;
                    r.actuator = (uint8_t)targetHandle;
                    r.targetSensor = (uint8_t)targetSourceHandle;
                }
            } else {
                // A full engine-file restore parses settings before replacing
                // the hardware registry to keep Classic heap usage bounded.
                // Preserve the stable IDs and enabled state until that uploaded
                // registry is resident; resolving against the old registry can
                // silently delete an otherwise valid controller during cleanup.
                r.sensor = 0;
                r.actuator = 0;
                r.targetSensor = 0;
            }
        }
    }

    // Structurally broken values (NaN, negative where nonsensical) fall back
    // to defaults; out-of-range-HIGH safety limits are accepted and warned
    // about below instead (never block the informed user).
    if (!isfinite(rpmLimit) || rpmLimit <= 0.0f) rpmLimit = 100000.0f;
    if (!isfinite(n2RpmLimit) || n2RpmLimit < 0.0f) n2RpmLimit = 0.0f;
    if (!isfinite(minRpm) || minRpm < 0.0f) minRpm = 30000.0f;
    if (minRpm > 0.0f && minRpm >= rpmLimit) minRpm = rpmLimit * 0.3f;
    if (!isfinite(totLimit) || totLimit < 0.0f) totLimit = 750.0f;
    if (totCooldownTarget < 0.0f) totCooldownTarget = 0.0f;
    totSafeMargin = totLimit > 0.0f
        ? constrain(totSafeMargin, 0.0f, totLimit)
        : max(0.0f, totSafeMargin);
    if (oilStartupMinBar < 0.0f) oilStartupMinBar = 1.5f;
    if (oilRunningMin < 0.0f) oilRunningMin = 2.8f;
    if (oilStartupPressure < 0.0f) oilStartupPressure = 0.0f;
    if (oilMapMin < 0.0f) oilMapMin = 0.0f;
    if (oilMapMax < oilMapMin) oilMapMax = oilMapMin;
    if (cooldownOilPressureTarget < 0.0f) cooldownOilPressureTarget = 0.0f;
    oilStartupPct = constrain(oilStartupPct, 0.0f, 100.0f);
    oilMinPct = constrain(oilMinPct, 0.0f, 100.0f);
    if (oilAdjustScale < 0.0f) oilAdjustScale = 0.0f;
    if (oilZeroBar < 0.0f) oilZeroBar = 0.0f;
    if (oilPressureDeadband < 0.0f) oilPressureDeadband = 0.0f;
    oilPumpUnderflowDelayMs = constrain(oilPumpUnderflowDelayMs, 100UL, 60000UL);
    if (safetyCheckIntervalMs < 10) safetyCheckIntervalMs = 10;
    if (safetyCheckIntervalMs > 250) safetyCheckIntervalMs = 250;
    if (flameoutShutdownMs < 100.0f) flameoutShutdownMs = 100.0f;
    flameoutSource = constrain(flameoutSource, 0, 3);
    if (flameoutN1MinRpm < 0.0f) flameoutN1MinRpm = 0.0f;
    if (flameoutEgtBelowC < 0.0f) flameoutEgtBelowC = 0.0f;
    if (flameoutEgtFallRateCPerSec < 0.0f) flameoutEgtFallRateCPerSec = 0.0f;
    if (preIgnRpm < 0.0f) preIgnRpm = 0.0f;
    if (spoolRpmTarget < 0.0f) spoolRpmTarget = 0.0f;
    if (safetyHoldFinalRpm < 0.0f) safetyHoldFinalRpm = 0.0f;
    if (safetyHoldFinalN2Rpm < 0.0f) safetyHoldFinalN2Rpm = 0.0f;
    if (safetyHoldFinalP1 < 0.0f) safetyHoldFinalP1 = 0.0f;
    if (safetyHoldFinalP2 < 0.0f) safetyHoldFinalP2 = 0.0f;
    if (safetyHoldFinalEgt < 0.0f) safetyHoldFinalEgt = 0.0f;
    if (waitTotCoolTarget < 0.0f) waitTotCoolTarget = 0.0f;
    if (shutdownRpmDropThreshold < 0.0f) shutdownRpmDropThreshold = 0.0f;
    if (rpmZeroThreshold < 0.0f) rpmZeroThreshold = 0.0f;
    if (preStartEgtLimitC < 0.0f) preStartEgtLimitC = 0.0f;
    if (startupEgtLimitC < 0.0f) startupEgtLimitC = 0.0f;
    if (startupOilArmTimeoutMs < 0) startupOilArmTimeoutMs = 0;
    if (starterTimeoutMs < 0) starterTimeoutMs = 0;
    if (preIgnSparkMs < 0) preIgnSparkMs = 0;
    if (flameTimeoutMs < 0) flameTimeoutMs = 0;
    if (flameCheckIntervalMs < 1) flameCheckIntervalMs = 1;
    if (flameRequiredCount < 1) flameRequiredCount = 1;
    if (tempConfirmTimeoutMs < 0) tempConfirmTimeoutMs = 0;
    if (spoolTimeoutMs < 0) spoolTimeoutMs = 0;
    if (safetyHoldMs < 0) safetyHoldMs = 0;
    if (safetyHoldTimeoutMs < safetyHoldMs) safetyHoldTimeoutMs = safetyHoldMs;
    if (waitForInputTimeoutMs < 0) waitForInputTimeoutMs = 0;
    if (timedDelayMs < 0) timedDelayMs = 0;
    if (fuelPulsePulseMs < 0) fuelPulsePulseMs = 0;
    if (fuelPulseOffMs < 0) fuelPulseOffMs = 0;
    if (waitTotCoolTimeoutMs < 0) waitTotCoolTimeoutMs = 0;
    if (preHeatMs < 0) preHeatMs = 0;
    if (finalStopOilScavengeMs < 0) finalStopOilScavengeMs = 0;
    if (shutdownRpmDropTimeoutMs < 0) shutdownRpmDropTimeoutMs = 0;
    if (shutdownCooldownTimeoutMs < 0) shutdownCooldownTimeoutMs = 0;
    if (shutdownFinalStopTimeoutMs < 0) shutdownFinalStopTimeoutMs = 0;
    if (throttleRampUpMs < 0.0f) throttleRampUpMs = 0.0f;
    if (throttleRampDownMs < 0.0f) throttleRampDownMs = 0.0f;
    if (idleRampUpMs < 0.0f) idleRampUpMs = 0.0f;
    if (idleRampDownMs < 0.0f) idleRampDownMs = 0.0f;
    if (glowPreheatMs < 0) glowPreheatMs = 0;
    if (relightTimeoutMs > 30000)
        Serial.printf("[Config] relight_timeout_ms %d exceeds hard maximum; using 30000 ms\n", relightTimeoutMs);
    relightTimeoutMs = constrain(relightTimeoutMs, 0, 30000);
    relightTriggerSource = constrain(relightTriggerSource, 0, 3);
    relightTriggerConfirmMs = constrain(relightTriggerConfirmMs, 0, 60000);
    if (relightTriggerEgtBelowC < 0.0f) relightTriggerEgtBelowC = 0.0f;
    if (relightTriggerEgtFallRateCPerSec < 0.0f) relightTriggerEgtFallRateCPerSec = 0.0f;
    relightIgnitionTarget = constrain(relightIgnitionTarget, 0, 2);
    relightConfirmSource = constrain(relightConfirmSource, 0, 3);
    if (relightMinRpm < 1.0f) relightMinRpm = max(1.0f, minRpm);
    if (relightConfirmRpm < 1.0f) relightConfirmRpm = max(relightMinRpm, minRpm);
    if (relightTotRiseC < 0.0f) relightTotRiseC = 0.0f;
    if (starterAssistUntilRpm < 0.0f) starterAssistUntilRpm = 0.0f;
    starterAssistOnMs = constrain(starterAssistOnMs, 1UL, 60000UL);
    starterAssistOffMs = constrain(starterAssistOffMs, 1UL, 60000UL);
    if (starterStartupRampPctPerSec < 0.0f) starterStartupRampPctPerSec = 0.0f;
    standbyOilSource = constrain(standbyOilSource, 0, 2);
    manualRelightIgnitionTarget = constrain(manualRelightIgnitionTarget, 0, 2);
    for (int i = 0; i < ruleCount; i++) {
        if (rules[i].kind != 3 && rules[i].sensor > RulesEngine::THRUST &&
            !ChannelRegistry::isInputSensor(rules[i].sensor))
            rules[i].enabled = false;
        rules[i].kind = constrain(rules[i].kind, 0, 3);
        rules[i].op = constrain(rules[i].op, 0, 1);
        if (rules[i].actuator > 17 && !ChannelRegistry::isOutputActuator(rules[i].actuator))
            rules[i].enabled = false;
        if (rules[i].hysteresis < 0.0f) rules[i].hysteresis = 0.0f;
        rules[i].onValue = constrain(rules[i].onValue, 0.0f, 1.0f);
        rules[i].offValue = constrain(rules[i].offValue, 0.0f, 1.0f);
        rules[i].outputMin = constrain(rules[i].outputMin, 0.0f, 1.0f);
        rules[i].outputMax = constrain(rules[i].outputMax, 0.0f, 1.0f);
        rules[i].targetSourceType = constrain(rules[i].targetSourceType, 0, 2);
        if (!isfinite(rules[i].targetFixed)) rules[i].targetFixed = 0.0f;
        if (!isfinite(rules[i].targetLow)) rules[i].targetLow = 0.0f;
        if (!isfinite(rules[i].targetHigh)) rules[i].targetHigh = 1.0f;
        if (!isfinite(rules[i].targetInputMin)) rules[i].targetInputMin = 0.0f;
        if (!isfinite(rules[i].targetInputMax) || rules[i].targetInputMax == rules[i].targetInputMin)
            rules[i].targetInputMax = rules[i].targetInputMin + 1.0f;
        if (!isfinite(rules[i].responseGain) || rules[i].responseGain < 0.0f) rules[i].responseGain = 0.01f;
        if (!isfinite(rules[i].integralGain) || rules[i].integralGain < 0.0f) rules[i].integralGain = 0.001f;
        if (!isfinite(rules[i].deadband) || rules[i].deadband < 0.0f) rules[i].deadband = 0.0f;
        if (!isfinite(rules[i].inputMin)) rules[i].inputMin = 0.0f;
        if (!isfinite(rules[i].inputMax) || rules[i].inputMax == rules[i].inputMin) rules[i].inputMax = rules[i].inputMin + 1.0f;
        rules[i].modeMask &= 0x0F;
        if (rules[i].modeMask == 0) rules[i].enabled = false;
    }
    if (standbyOilRpmLimit < 0.0f) standbyOilRpmLimit = 0.0f;
    auto clampToolMs = [](uint32_t& value, uint32_t fallback, uint32_t minMs) {
        if (value < minMs || value > 60000u) value = fallback;
    };
    clampToolMs(toolFuelPrimeMs, 3000u, 100u);
    clampToolMs(toolOilPrimeMs, 5000u, 100u);
    clampToolMs(toolIgnTestMs, 2000u, 100u);
    clampToolMs(toolIgn2TestMs, 2000u, 100u);
    clampToolMs(toolGlowTestMs, 10000u, 100u);
    toolGlowTestPct = constrain(toolGlowTestPct, 0.0f, 100.0f);
    clampToolMs(toolStartTestMs, 2000u, 100u);
    toolStartTestPct = constrain(toolStartTestPct, 0.0f, 100.0f);
    clampToolMs(toolFuelSolTestMs, 1000u, 50u);
    clampToolMs(toolIdleTestMs, 3000u, 100u);
    clampToolMs(toolOilScavTestMs, 2000u, 100u);
    clampToolMs(toolCoolFanTestMs, 3000u, 100u);
    clampToolMs(toolAirstarterTestMs, 1000u, 50u);
    clampToolMs(toolBleedValveTestMs, 1000u, 50u);
    clampToolMs(toolFuelPump2TestMs, 3000u, 100u);
    toolFuelPump2TestPct = constrain(toolFuelPump2TestPct, 0.0f, 100.0f);
    clampToolMs(toolAbSolTestMs, 1000u, 50u);
    clampToolMs(toolAbPumpTestMs, 2000u, 100u);
    toolAbPumpTestPct = constrain(toolAbPumpTestPct, 0.0f, 100.0f);
    clampToolMs(toolStarterEnTestMs, 1000u, 50u);
    clampToolMs(toolPropPitchTestMs, 3000u, 100u);
    toolPropPitchTestPct = constrain(toolPropPitchTestPct, 0.0f, 100.0f);
    // These bounds mirror the PATCH validator in validateJson (telemetry group)
    // so an accepted value survives a reboot unchanged — keep the two in sync.
    if (wsIntervalMs < 333u || wsIntervalMs > 60000u) wsIntervalMs = 333u;
    if (snapshotIntervalMs < 500u || snapshotIntervalMs > 3600000u) snapshotIntervalMs = 10000u;
    if (controlLoopHz < 50u || controlLoopHz > 1000u) controlLoopHz = 400u;
    if (sessionLogIntervalMs < 100u || sessionLogIntervalMs > 60000u) sessionLogIntervalMs = 1000u;
    if (cooldownSkipHoldMs < 0) cooldownSkipHoldMs = 0;
    if (fp2RampMs < 0) fp2RampMs = 0;
    if (govHoldTimeoutMs < 0) govHoldTimeoutMs = 0;
    starterDemand = constrain(starterDemand, 0.0f, 100.0f);
    throttleSetPct = constrain(throttleSetPct, 0.0f, 100.0f);
    oilPumpOnPct = constrain(oilPumpOnPct, 0.0f, 100.0f);
    cooldownStarterPct = constrain(cooldownStarterPct, 0.0f, 100.0f);
    cooldownOilPct = constrain(cooldownOilPct, 0.0f, 100.0f);
    fuelPumpMinPct     = constrain(fuelPumpMinPct, 0.0f, 100.0f);
    throttleIdleMaxPct = constrain(throttleIdleMaxPct, fuelPumpMinPct, 100.0f);
    throttleExpo = constrain(throttleExpo, 0.0f, 1.0f);
    pullbackN1SoftRpm = constrain(pullbackN1SoftRpm, 0.0f, 1000000000.0f);
    pullbackN1HardRpm = constrain(pullbackN1HardRpm, 0.0f, 1000000000.0f);
    if (pullbackN1HardRpm > 0.0f && pullbackN1HardRpm <= pullbackN1SoftRpm) pullbackN1HardRpm = pullbackN1SoftRpm + 1.0f;
    pullbackN2SoftRpm = constrain(pullbackN2SoftRpm, 0.0f, 1000000000.0f);
    pullbackN2HardRpm = constrain(pullbackN2HardRpm, 0.0f, 1000000000.0f);
    if (pullbackN2HardRpm > 0.0f && pullbackN2HardRpm <= pullbackN2SoftRpm) pullbackN2HardRpm = pullbackN2SoftRpm + 1.0f;
    pullbackEgtSoftC = constrain(pullbackEgtSoftC, 0.0f, 100000.0f);
    pullbackEgtHardC = constrain(pullbackEgtHardC, 0.0f, 100000.0f);
    if (pullbackEgtHardC > 0.0f && pullbackEgtHardC <= pullbackEgtSoftC) pullbackEgtHardC = pullbackEgtSoftC + 1.0f;
    auto sanitizePair = [](float& soft, float& hard, float maxValue) {
        soft = constrain(soft, 0.0f, maxValue);
        hard = constrain(hard, 0.0f, maxValue);
        if (hard > 0.0f && hard <= soft) hard = soft + 0.001f;
    };
    sanitizePair(pullbackP1Soft, pullbackP1Hard, 1000.0f);
    sanitizePair(pullbackP2Soft, pullbackP2Hard, 1000.0f);
    sanitizePair(pullbackTorqueSoft, pullbackTorqueHard, 1000000.0f);
    p1TripLimit = constrain(p1TripLimit, 0.0f, 1000.0f);
    p2TripLimit = constrain(p2TripLimit, 0.0f, 1000.0f);
    torqueTripLimit = constrain(torqueTripLimit, 0.0f, 1000000.0f);
    p1TripConfirmMs = constrain(p1TripConfirmMs, 0, 60000);
    p2TripConfirmMs = constrain(p2TripConfirmMs, 0, 60000);
    torqueTripConfirmMs = constrain(torqueTripConfirmMs, 0, 60000);
    pullbackMinThrottlePct = constrain(pullbackMinThrottlePct, 0.0f, 100.0f);
    pullbackNearLimitRampUpMs = constrain(pullbackNearLimitRampUpMs, 0.0f, 20000.0f);
    if (pullbackApproachZoneRpm < 0.0f) pullbackApproachZoneRpm = 0.0f;
    rpmAccelFilter = constrain(rpmAccelFilter, 0.02f, 1.0f);
    pullbackN1Mode = constrain(pullbackN1Mode, 0, 1); pullbackN2Mode = constrain(pullbackN2Mode, 0, 1);
    pullbackEgtMode = constrain(pullbackEgtMode, 0, 1); pullbackP1Mode = constrain(pullbackP1Mode, 0, 1);
    pullbackP2Mode = constrain(pullbackP2Mode, 0, 1); pullbackTorqueMode = constrain(pullbackTorqueMode, 0, 1);
    pullbackN1LookaheadMs = constrain(pullbackN1LookaheadMs, 0.0f, 5000.0f);
    pullbackN2LookaheadMs = constrain(pullbackN2LookaheadMs, 0.0f, 5000.0f);
    pullbackEgtLookaheadMs = constrain(pullbackEgtLookaheadMs, 0.0f, 5000.0f);
    pullbackP1LookaheadMs = constrain(pullbackP1LookaheadMs, 0.0f, 5000.0f);
    pullbackP2LookaheadMs = constrain(pullbackP2LookaheadMs, 0.0f, 5000.0f);
    pullbackTorqueLookaheadMs = constrain(pullbackTorqueLookaheadMs, 0.0f, 5000.0f);
    pullbackN1Strength = constrain(pullbackN1Strength, 0.0f, 5.0f);
    pullbackN2Strength = constrain(pullbackN2Strength, 0.0f, 5.0f);
    pullbackEgtStrength = constrain(pullbackEgtStrength, 0.0f, 5.0f);
    pullbackP1Strength = constrain(pullbackP1Strength, 0.0f, 5.0f);
    pullbackP2Strength = constrain(pullbackP2Strength, 0.0f, 5.0f);
    pullbackTorqueStrength = constrain(pullbackTorqueStrength, 0.0f, 5.0f);
    if (idleTargetRpm < 0.0f) idleTargetRpm = 0.0f;
    if (idleDeadbandRpm < 0.0f) idleDeadbandRpm = 0.0f;
    if (idleRpmLimit < 0.0f) idleRpmLimit = 0.0f;
    idleSource = constrain(idleSource, 0, 3);
    idleTargetPressure = constrain(idleTargetPressure, 0.0f, 1000.0f);
    idlePressureDeadband = constrain(idlePressureDeadband, 0.0f, 1000.0f);
    idlePressureLimit = constrain(idlePressureLimit, 0.0f, 1000.0f);
    idleMaxMultiplier = constrain(idleMaxMultiplier, 1.0f, 3.0f);
    idleIGain = constrain(idleIGain, 0.0f, 2.0f);
    idleIMax = constrain(idleIMax, 0.0f, 0.5f);
    idleMode = constrain(idleMode, 0, 1);
    if (idleDecelEnterRpm < 0.0f) idleDecelEnterRpm = 0.0f;
    idleDecelDropPct = constrain(idleDecelDropPct, 0.0f, 50.0f);
    idleLookaheadMs = constrain(idleLookaheadMs, 0.0f, 5000.0f);
    if (idleSettleBandRpm < 0.0f) idleSettleBandRpm = 0.0f;
    if (idleFullResponseRpm < 1.0f) idleFullResponseRpm = 1.0f;
    idleTrimUpPctPerSec = constrain(idleTrimUpPctPerSec, 0.0f, 50.0f);
    idleTrimDownPctPerSec = constrain(idleTrimDownPctPerSec, 0.0f, 50.0f);
    idleLearnRate = constrain(idleLearnRate, 0.0f, 1.0f);
    if (idleLearnAccelMax < 0.0f) idleLearnAccelMax = 0.0f;
    idlePressureDecelEnter = constrain(idlePressureDecelEnter, 0.0f, 1000.0f);
    idlePressureSettleBand = constrain(idlePressureSettleBand, 0.0f, 1000.0f);
    idlePressureFullResponse = constrain(idlePressureFullResponse, 0.0001f, 1000.0f);
    idlePressureLearnRateMax = constrain(idlePressureLearnRateMax, 0.0f, 1000.0f);
    glowPreheatMaxPct = constrain(glowPreheatMaxPct, 0.0f, 100.0f);
    glowHoldPct = constrain(glowHoldPct, 0.0f, 100.0f);
    starterAssistPwmPct = constrain(starterAssistPwmPct, 0.0f, 100.0f);
    standbyOilFeedPct = constrain(standbyOilFeedPct, 0.0f, 100.0f);
    standbyOilFeedBar = constrain(standbyOilFeedBar, 0.0f, 20.0f);
    if (modifiedIdleMultiplier < 0.0f) modifiedIdleMultiplier = 0.0f;
    fp2StartPct = constrain(fp2StartPct, 0.0f, 100.0f);
    fp2EndPct = constrain(fp2EndPct, 0.0f, 100.0f);
    fp2DemandPct = constrain(fp2DemandPct, 0.0f, 100.0f);
    if (oilFailsafeDelayMs < 0) oilFailsafeDelayMs = 0;
    oilFailsafePct = constrain(oilFailsafePct, 0.0f, 100.0f);
    if (!isfinite(titLimit) || titLimit < 0.0f) titLimit = 0.0f;
    if (!isfinite(oilTempLimit) || oilTempLimit < 0.0f) oilTempLimit = 0.0f;
    if (fuelPressMin < 0.0f) fuelPressMin = 0.0f;
    if (battVoltMin < 0.0f) battVoltMin = 0.0f;
    if (surgeDetectRpmVariance < 0.0f) surgeDetectRpmVariance = 0.0f;
    // jump_threshold <= 0 would flag every RPM change as a JUMP fault
    if (!isfinite(rpmJumpThreshold) || rpmJumpThreshold <= 0.0f) rpmJumpThreshold = 0.40f;
    if (rpmZeroStuckTicks < 1) rpmZeroStuckTicks = 1;
    if (rcFailsafeMs < 20) rcFailsafeMs = 500;
    if (throttleMinRaw == throttleMaxRaw) { throttleMinRaw = 0; throttleMaxRaw = 4095; }
    if (idleMinRaw == idleMaxRaw) { idleMinRaw = 0; idleMaxRaw = 4095; }
    oilPolyXMin = constrain(oilPolyXMin, 0.0f, 4095.0f);
    oilPolyXMax = constrain(oilPolyXMax, 0.0f, 4095.0f);
    if (oilPolyXMax <= oilPolyXMin) { oilPolyXMin = 0.0f; oilPolyXMax = 4095.0f; }
    auto sanitizeLinearCal = [](int& rawMin, int& rawMax, float& valMax) {
        rawMin = constrain(rawMin, 0, 4095);
        rawMax = constrain(rawMax, 0, 4095);
        if (rawMax <= rawMin) { rawMin = 0; rawMax = 4095; }
        if (valMax <= 0.0f) valMax = 10.0f;
    };
    sanitizeLinearCal(p1RawMin, p1RawMax, p1ValMax);
    sanitizeLinearCal(p2RawMin, p2RawMax, p2ValMax);
    sanitizeLinearCal(fuelPressRawMin, fuelPressRawMax, fuelPressValMax);
    sanitizeLinearCal(fuelFlowRawMin, fuelFlowRawMax, fuelFlowValMax);
    if (abTorchDurationMs < 0) abTorchDurationMs = 0;
    if (abMinN1 < 0.0f) abMinN1 = 0.0f;
    if (abMaxN1 < 0.0f) abMaxN1 = 0.0f;
    if (abMaxTotForLight < 0.0f) abMaxTotForLight = 0.0f;
    if (abTorchTotLimit < 0.0f) abTorchTotLimit = 0.0f;
    if (abTorchGuardMode < 0 || abTorchGuardMode > 2) abTorchGuardMode = 0;
    if (abFlameMode < 0 || abFlameMode > 3) abFlameMode = 2;
    if (abTotRiseDegC < 0.0f) abTotRiseDegC = 0.0f;
    if (abTotRiseWindowMs < 0) abTotRiseWindowMs = 0;
    if (abAssumeIgnitedMs < 0) abAssumeIgnitedMs = 0;
    if (abFlameTimeoutMs < abAssumeIgnitedMs) abFlameTimeoutMs = abAssumeIgnitedMs;
    if (abFlameLossDelayMs < 0) abFlameLossDelayMs = 0;
    if (abFlameLossDelayMs > 60000) abFlameLossDelayMs = 60000;
    if (abStabilizeMs < 0) abStabilizeMs = 0;
    if (abStabilizeMaxTot < 0.0f) abStabilizeMaxTot = 0.0f;
    abThrottleThreshold = constrain(abThrottleThreshold, 0.0f, 1.0f);
    abTorchSpikePct = constrain(abTorchSpikePct, 0.0f, 100.0f);
    abLightupPumpPct = constrain(abLightupPumpPct, 0.0f, 100.0f);
    abPumpMinPct = constrain(abPumpMinPct, 0.0f, 100.0f);
    abPumpMaxPct = constrain(abPumpMaxPct, abPumpMinPct, 100.0f);
    abPumpControlMode = constrain(abPumpControlMode, 0, 2);
    abMainFuelOffsetPct = constrain(abMainFuelOffsetPct, -20.0f, 50.0f);
    limpMaxThrottlePct = constrain(limpMaxThrottlePct, 0.0f, 100.0f);
    governorKp = constrain(governorKp, 0.0f, 0.01f);
    governorPitchKp = constrain(governorPitchKp, 0.0f, 0.01f);
    if (governorTargetRpm < 0.0f) governorTargetRpm = 0.0f;
    if (governorBandRpm < 0.0f) governorBandRpm = 0.0f;
    if (governorPitchRampSec < 0.0f) governorPitchRampSec = 1.0f;

    // ── Accept + warn ─────────────────────────────────────────────
    // Safety-relevant values beyond the recommended caps load as-is but
    // raise a persistent dashboard notice (telemetry "config_load_warning")
    // and an event-log marker. Recomputed on every load/upload so the
    // notice clears once the value is fixed.
    loadWarning[0] = '\0';
    char warnBuf[96];
    auto appendLoadWarning = [](const char* msg) {
        size_t used = strlen(loadWarning);
        snprintf(loadWarning + used, sizeof(loadWarning) - used, "%s%s",
                 used ? "; " : "", msg);
        Serial.printf("[Config] WARNING: %s\n", msg);
    };
    auto warnHighLimit = [&](const char* name, float value, float cap) {
        snprintf(warnBuf, sizeof(warnBuf), "%s %.0f exceeds recommended max %.0f",
                 name, value, cap);
        appendLoadWarning(warnBuf);
    };
    if (rpmLimit > 500000.0f)  warnHighLimit("rpm_limit", rpmLimit, 500000.0f);
    if (n2RpmLimit > 500000.0f) warnHighLimit("n2_rpm_limit", n2RpmLimit, 500000.0f);
    if (totLimit > 1400.0f)    warnHighLimit("tot_limit", totLimit, 1400.0f);
    if (titLimit > 1400.0f)    warnHighLimit("tit_limit_c", titLimit, 1400.0f);
    if (oilTempLimit > 300.0f) warnHighLimit("oil_temp_limit_c", oilTempLimit, 300.0f);
    if (totLimit > 0.0f && totCooldownTarget >= totLimit) {
        snprintf(warnBuf, sizeof(warnBuf),
                 "tot_cooldown_target %.0f is not below tot_limit %.0f - cooldown ends immediately",
                 totCooldownTarget, totLimit);
        appendLoadWarning(warnBuf);
    }
    // Oil target (oilMapMin) below the low-oil fault (oilRunningMin) makes the
    // pump aim beneath the shutdown line -> nuisance low-oil trips.
    if (oilRunningMin > 0.0f && oilMapMin > 0.0f && oilMapMin < oilRunningMin) {
        snprintf(warnBuf, sizeof(warnBuf),
                 "oil target %.1f is below low-oil fault %.1f bar - nuisance shutdowns likely",
                 (double)oilMapMin, (double)oilRunningMin);
        appendLoadWarning(warnBuf);
    }

    sanitizeForHardware();
    // Rules were reloaded (and possibly compacted) — stale hysteresis latch
    // state must not carry over to a different rule at the same index.
    RulesEngine::resetLatches();
}

void Config::_toDoc(JsonDocument& doc) {
    doc.clear();
    _writeDoc(doc.to<JsonObject>());
}

void Config::_writeDoc(JsonObject doc) {
    sanitizeForHardware();
    doc["profile_id"]     = HardwareConfig::profileId[0] ? HardwareConfig::profileId : OT_PROFILE_ID;
    doc["config_version"] = CONFIG_VERSION;
    doc["controller_schema"] = controllerSchema;
    doc["ui_theme"]       = uiTheme;

    auto eng = doc["engine"].to<JsonObject>();
    writeConfigFields(eng, ENGINE_FLOAT_FIELDS);

    auto oil = doc["oil"].to<JsonObject>();
    writeConfigFields(oil, OIL_FLOAT_FIELDS);
    writeConfigFields(oil, OIL_INT_FIELDS);
    writeConfigFields(oil, OIL_BOOL_FIELDS);

    auto su = doc["sequence"]["startup"].to<JsonObject>();
    writeConfigFields(su, STARTUP_FLOAT_FIELDS);
    writeConfigFields(su, STARTUP_INT_FIELDS);
    writeConfigFields(su, STARTUP_BOOL_FIELDS);

    auto sd = doc["sequence"]["shutdown"].to<JsonObject>();
    writeConfigFields(sd, SHUTDOWN_FLOAT_FIELDS);
    writeConfigFields(sd, SHUTDOWN_INT_FIELDS);
    writeConfigFields(sd, SHUTDOWN_BOOL_FIELDS);

    auto th = doc["throttle"].to<JsonObject>();
    writeConfigFields(th, THROTTLE_FLOAT_FIELDS);
    writeConfigFields(th, THROTTLE_INT_FIELDS);
    writeConfigFields(th, THROTTLE_BOOL_FIELDS);

    auto di = doc["dynamic_idle"].to<JsonObject>();
    writeConfigFields(di, IDLE_FLOAT_FIELDS);
    writeConfigFields(di, IDLE_INT_FIELDS);
    writeConfigFields(di, IDLE_BOOL_FIELDS);

    auto sf = doc["safety"].to<JsonObject>();
    writeConfigFields(sf, SAFETY_FLOAT_FIELDS);
    writeConfigFields(sf, SAFETY_INT_FIELDS);
    writeConfigFields(sf, SAFETY_U32_FIELDS);

    auto gov = doc["governor"].to<JsonObject>();
    writeConfigFields(gov, GOVERNOR_FLOAT_FIELDS);

    auto glw = doc["glow_plug"].to<JsonObject>();
    writeConfigFields(glw, GLOW_FLOAT_FIELDS);
    writeConfigFields(glw, GLOW_INT_FIELDS);
    writeConfigFields(glw, GLOW_BOOL_FIELDS);

    auto cal = doc["calibration"].to<JsonObject>();
    writeConfigFields(cal, CAL_FLOAT_FIELDS);
    writeConfigFields(cal, CAL_INT_FIELDS);
    auto poly = cal["oil_poly"].to<JsonObject>();
    writeConfigFields(poly, OIL_POLY_FLOAT_FIELDS);

    auto rl = doc["relight"].to<JsonObject>();
    writeConfigFields(rl, RELIGHT_FLOAT_FIELDS);
    writeConfigFields(rl, RELIGHT_INT_FIELDS);
    writeConfigFields(rl, RELIGHT_BOOL_FIELDS);
    rl["output_id"] = relightOutputId;

    auto tl = doc["tools"].to<JsonObject>();
    writeConfigFields(tl, TOOL_U32_FIELDS);
    writeConfigFields(tl, TOOL_FLOAT_FIELDS);

    auto tm = doc["telemetry"].to<JsonObject>();
    writeConfigFields(tm, TELEMETRY_U32_FIELDS);
    writeConfigFields(tm, TELEMETRY_BOOL_FIELDS);

    auto sa = doc["starter_control"].to<JsonObject>();
    writeConfigFields(sa, STARTER_CONTROL_FLOAT_FIELDS);
    writeConfigFields(sa, STARTER_CONTROL_U32_FIELDS);
    writeConfigFields(sa, STARTER_CONTROL_BOOL_FIELDS);

    auto oilx = doc["oil_advanced"].to<JsonObject>();
    writeConfigFields(oilx, OIL_ADVANCED_FLOAT_FIELDS);
    writeConfigFields(oilx, OIL_ADVANCED_U32_FIELDS);
    writeConfigFields(oilx, OIL_ADVANCED_BOOL_FIELDS);


    auto sob = doc["standby_oil"].to<JsonObject>();
    writeConfigFields(sob, STANDBY_OIL_FLOAT_FIELDS);
    writeConfigFields(sob, STANDBY_OIL_INT_FIELDS);
    writeConfigFields(sob, STANDBY_OIL_BOOL_FIELDS);
    sob["output_id"] = standbyOilOutputId;

    auto limp = doc["limp_mode"].to<JsonObject>();
    writeConfigFields(limp, LIMP_FLOAT_FIELDS);

    auto misc = doc["misc"].to<JsonObject>();
    writeConfigFields(misc, MISC_INT_FIELDS);
    writeConfigFields(misc, MISC_BOOL_FIELDS);
    misc["igniter_on_start_output_id"] = manualRelightOutputId;


    auto rh = doc["rpm_health"].to<JsonObject>();
    writeConfigFields(rh, RPM_HEALTH_FLOAT_FIELDS);
    writeConfigFields(rh, RPM_HEALTH_INT_FIELDS);

    auto cl = doc["cluster"].to<JsonObject>();
    writeConfigFields(cl, CLUSTER_FLOAT_FIELDS);

    auto rc = doc["rc_input"].to<JsonObject>();
    writeConfigFields(rc, RC_INPUT_INT_FIELDS);

    auto ab = doc["afterburner"].to<JsonObject>();
    writeConfigFields(ab, AFTERBURNER_FLOAT_FIELDS);
    writeConfigFields(ab, AFTERBURNER_INT_FIELDS);
    writeConfigFields(ab, AFTERBURNER_BOOL_FIELDS);

    auto sl = doc["session_log"].to<JsonObject>();
    sl["n1"]       = (bool)(sessionLogMask & SLOG_N1);
    sl["n2"]       = (bool)(sessionLogMask & SLOG_N2);
    sl["tot"]      = (bool)(sessionLogMask & SLOG_TOT);
    sl["oil_temp"] = (bool)(sessionLogMask & SLOG_OIL_TEMP);
    sl["oil"]      = (bool)(sessionLogMask & SLOG_OIL);
    sl["p1"]       = (bool)(sessionLogMask & SLOG_P1);
    sl["p2"]       = (bool)(sessionLogMask & SLOG_P2);
    sl["throttle"] = (bool)(sessionLogMask & SLOG_THR);
    sl["mode"]       = (bool)(sessionLogMask & SLOG_MODE);
    sl["tit"]        = (bool)(sessionLogMask & SLOG_TIT);
    sl["batt"]       = (bool)(sessionLogMask & SLOG_BATT);
    sl["fuel_press"] = (bool)(sessionLogMask & SLOG_FUEL_PRESS);
    sl["fuel_flow"]  = (bool)(sessionLogMask & SLOG_FUEL_FLOW);
    sl["glow"]       = (bool)(sessionLogMask & SLOG_GLOW);
    sl["wet_glow"]   = (bool)(sessionLogMask & SLOG_WET_GLOW);
    sl["glow_current"] = (bool)(sessionLogMask & SLOG_GLOW_CURRENT);
    sl["ign_current"]  = (bool)(sessionLogMask & SLOG_IGN_CURRENT);
    sl["ign2_current"] = (bool)(sessionLogMask & SLOG_IGN2_CURRENT);
    sl["oil_current"]  = (bool)(sessionLogMask & SLOG_OIL_CURRENT);
    sl["fp2"]        = (bool)(sessionLogMask & SLOG_FP2);
    sl["ab"]         = (bool)(sessionLogMask & SLOG_AB);
    sl["prop"]       = (bool)(sessionLogMask & SLOG_PROP);
    sl["oil_pct"]    = (bool)(sessionLogMask & SLOG_OIL_PCT);
    sl["loop"]       = (bool)(sessionLogMask & SLOG_LOOP);
    sl["torque"]     = (bool)(sessionLogMask & SLOG_TORQUE);
    sl["starter"]    = (bool)(sessionLogMask & SLOG_STARTER);
    sl["thrust"]     = (bool)(sessionLogMask & SLOG_THRUST);
    sl["interval_ms"]= sessionLogIntervalMs;
    auto registryInputs = sl["registry_inputs"].to<JsonArray>();
    for (uint8_t i = 0; i < sessionRegistryInputCount; ++i)
        if (sessionRegistryInputIds[i][0]) registryInputs.add(sessionRegistryInputIds[i]);

    auto stats = doc["stats"].to<JsonObject>();
    stats["total_run_seconds"] = totalRunSeconds;
    stats["start_attempt_count"] = startAttemptCount;
    stats["run_count"] = runCount;

    // ── Automation rules ──────────────────────────────────────────
    if (ruleCount > 0) {
        auto arr = doc["rules"].to<JsonArray>();
        for (int i = 0; i < ruleCount; i++) {
            const Rule& r = rules[i];
            auto jr = arr.add<JsonObject>();
            jr["enabled"]   = r.enabled;
            jr["kind"]      = r.kind;
            jr["op"]        = r.op;
            jr["threshold"] = r.threshold;
            jr["on_value"]  = r.onValue;
            jr["off_value"] = r.offValue;
            jr["hysteresis"]= r.hysteresis;
            jr["input_min"] = r.inputMin;
            jr["input_max"] = r.inputMax;
            jr["output_min"]= r.outputMin;
            jr["output_max"]= r.outputMax;
            jr["target_source_type"] = r.targetSourceType;
            jr["target_source"] = r.targetSourceId;
            jr["target_fixed"] = r.targetFixed;
            jr["target_low"] = r.targetLow;
            jr["target_high"] = r.targetHigh;
            jr["target_input_min"] = r.targetInputMin;
            jr["target_input_max"] = r.targetInputMax;
            jr["response_gain"] = r.responseGain;
            jr["integral_gain"] = r.integralGain;
            jr["deadband"] = r.deadband;
            jr["mode_mask"] = r.modeMask;
            jr["name"]      = r.name;
            jr["source"]    = r.sourceId;
            jr["target"]    = r.targetId;
        }
    }
}
