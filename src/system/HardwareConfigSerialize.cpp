#include "HardwareConfig.h"
#include "HardwareConfigInternal.h"
#include "pcb/PcbProfileManager.h"

// ── _toDoc ────────────────────────────────────────────────────
void HardwareConfig::_toDoc(JsonObject doc) {
#ifdef OT_PLATFORM_ESP32S3
    doc["platform"]         = "esp32s3";
#else
    doc["platform"]         = "esp32";
#endif
    doc["profile_id"]       = profileId;
    doc["profile_desc"]     = profileDesc;
    doc["wifi_password"]    = wifiPassword;
    doc["wifi_tx_power_dbm"] = wifiTxPowerDbm;
    auto i2c = doc["i2c"].to<JsonObject>();
    i2c["enabled"] = i2cEnabled;
    i2c["sda_pin"] = i2cSdaPin;
    i2c["scl_pin"] = i2cSclPin;
    i2c["interrupt_pin"] = i2cInterruptPin;
    i2c["frequency_hz"] = i2cFrequencyHz;
    auto spi = doc["spi"].to<JsonObject>();
    spi["enabled"] = spiEnabled;
    spi["sck_pin"] = spiSckPin;
    spi["miso_pin"] = spiMisoPin;
    spi["mosi_pin"] = spiMosiPin;

    auto ctrl = doc["controls"].to<JsonObject>();
    ctrl["stop_pin"]      = stopPin;
    ctrl["stop_active_h"] = stopActiveH;
    ctrl["stop_pullup"]   = stopPullup;
    ctrl["stop_pulldown"] = stopPulldown;
    ctrl["start_pin"]     = startPin;
    ctrl["start_active_h"]= startActiveH;
    ctrl["start_pullup"]  = startPullup;
    ctrl["start_pulldown"]= startPulldown;

    auto sensors = doc["sensors"].to<JsonObject>();

    auto n1 = sensors["n1_rpm"].to<JsonObject>();
    n1["enabled"] = hasN1Rpm; n1["pin"] = n1RpmPin; n1["ppr"] = n1RpmPpr;

    auto n2 = sensors["n2_rpm"].to<JsonObject>();
    n2["enabled"] = hasN2Rpm; n2["pin"] = n2RpmPin; n2["ppr"] = n2RpmPpr;

    auto tot = sensors["tot"].to<JsonObject>();
    tot["enabled"] = hasTot; tot["chip"] = totChip; tot["tc_type"] = totTcType;
    tot["clk"] = totClk; tot["cs"] = totCs; tot["miso"] = totMiso; tot["mosi"] = totMosi;

    auto tit = sensors["tit"].to<JsonObject>();
    tit["enabled"] = hasTit; tit["chip"] = titChip; tit["tc_type"] = titTcType;
    tit["clk"] = titClk; tit["cs"] = titCs; tit["miso"] = titMiso; tit["mosi"] = titMosi;

    auto oil = sensors["oil_press"].to<JsonObject>();
    oil["enabled"] = hasOilPress; oil["pin"] = oilPressPin;

    auto fl = sensors["flame"].to<JsonObject>();
    fl["enabled"] = hasFlame; fl["pin"] = flamePin;

    auto ff = sensors["fuel_flow"].to<JsonObject>();
    ff["enabled"] = hasFuelFlow; ff["pin"] = fuelFlowPin;
    ff["type"] = fuelFlowType; ff["pulses_per_litre"] = fuelFlowPulsesPerLitre;

    auto fpress = sensors["fuel_press"].to<JsonObject>();
    fpress["enabled"] = hasFuelPress; fpress["pin"] = fuelPressPin;

    auto p1 = sensors["p1"].to<JsonObject>();
    p1["enabled"] = hasP1; p1["pin"] = p1Pin;

    auto p2 = sensors["p2"].to<JsonObject>();
    p2["enabled"] = hasP2; p2["pin"] = p2Pin;

    auto thi = sensors["throttle_input"].to<JsonObject>();
    thi["enabled"] = hasThrottleInput; thi["pin"] = throttleInputPin; thi["rc_pwm"] = throttleInputRcPwm;

    auto idi = sensors["idle_input"].to<JsonObject>();
    idi["enabled"] = hasIdleInput; idi["pin"] = idleInputPin; idi["rc_pwm"] = idleInputRcPwm;

    auto oilt = sensors["oil_temp"].to<JsonObject>();
    oilt["enabled"] = hasOilTemp; oilt["chip"] = oilTempChip;
    oilt["pin"] = oilTempPin; oilt["clk"] = oilTempPin; oilt["cs"] = oilTempCs;
    oilt["miso"] = oilTempMiso; oilt["mosi"] = oilTempMosi;
    oilt["tc_type"] = oilTempTcType;
    oilt["resolution"]  = oilTempResolution;
    oilt["ntc_beta"]    = ntcBeta;
    oilt["ntc_r0"]      = ntcR0;
    oilt["ntc_r_fixed"] = ntcRFixed;
    oilt["ntc_pullup"]  = ntcFixedPullup;
    oilt["use_raw_poly"] = oilTempUseRawPoly;
    oilt["poly_a"] = oilTempPolyA; oilt["poly_b"] = oilTempPolyB;
    oilt["poly_c"] = oilTempPolyC; oilt["poly_d"] = oilTempPolyD;
    oilt["poly_x_min"] = oilTempPolyXMin; oilt["poly_x_max"] = oilTempPolyXMax;

    auto bvs = sensors["batt_voltage"].to<JsonObject>();
    bvs["enabled"] = hasBattVoltage; bvs["pin"] = battVoltPin;
    bvs["divider"] = battVoltDivider;

    auto torqs = sensors["torque"].to<JsonObject>();
    torqs["enabled"] = hasTorque; torqs["pin"] = torquePin;
    torqs["scale"] = torqueScale; torqs["offset"] = torqueOffset;
    torqs["hx711"] = torqueHx711; torqs["dt_pin"] = torqueDtPin;
    torqs["clk_pin"] = torqueClkPin; torqs["hx_scale"] = torqueHxScale;
    torqs["hx_zero"] = torqueHxZero;

    auto acts = doc["actuators"].to<JsonObject>();

    auto thr = acts["throttle"].to<JsonObject>();
    thr["enabled"]   = hasThrottle; thr["pin"] = throttlePin;
    thr["type"]      = throttleType;
    thr["min_us"]    = throttleMinUs; thr["max_us"] = throttleMaxUs;
    thr["inverted"]  = throttleInverted;
    thr["active_h"]   = throttleActiveH;
    thr["ledc_freq"] = throttleLedcFreqHz; thr["ledc_bits"] = throttleLedcBits;
    thr["pwm_min_pct"] = throttlePwmMinPct; thr["pwm_max_pct"] = throttlePwmMaxPct;

    auto str = acts["starter"].to<JsonObject>();
    str["enabled"]   = hasStarter; str["pin"] = starterPin;
    str["type"]      = starterType;
    str["min_us"]    = starterMinUs; str["max_us"] = starterMaxUs;
    str["inverted"]         = starterInverted;
    str["active_h"]         = starterActiveH;
    str["ledc_freq"]        = starterLedcFreqHz; str["ledc_bits"] = starterLedcBits;
    str["pwm_min_pct"]      = starterPwmMinPct; str["pwm_max_pct"] = starterPwmMaxPct;

    auto oilp = acts["oil_pump"].to<JsonObject>();
    oilp["enabled"] = hasOilPump; oilp["pin"] = oilPumpPin;
    oilp["type"] = oilPumpType; oilp["active_h"] = oilPumpActiveH;
    oilp["min_us"] = oilPumpMinUs; oilp["max_us"] = oilPumpMaxUs;
    oilp["freq_hz"] = oilPumpFreqHz; oilp["res_bits"] = oilPumpResBits;
    oilp["pwm_min_pct"] = oilPumpPwmMinPct; oilp["pwm_max_pct"] = oilPumpPwmMaxPct;
    oilp["has_current"]     = hasOilPumpCurrentSensor;
    oilp["current_pin"]     = oilPumpCurrentPin;
    oilp["current_mv_a"]    = oilPumpCurrentMvPerA;
    oilp["current_zero_v"]  = oilPumpCurrentZeroV;
    oilp["current_max_a"]   = oilPumpCurrentMaxAmps;

    auto fsol = acts["fuel_sol"].to<JsonObject>();
    fsol["enabled"] = hasFuelSol; fsol["pin"] = fuelSolPin; fsol["active_h"] = fuelSolActiveH;

    auto ign = acts["igniter"].to<JsonObject>();
    ign["enabled"] = hasIgniter; ign["pin"] = igniterPin; ign["active_h"] = igniterActiveH;
    ign["pwm"] = igniterPwm; ign["dwell_ms"] = igniterDwellMs; ign["rest_ms"] = igniterRestMs;
    ign["coil"]            = igniterCoil;
    ign["coil_sat_a"]      = igniterCoilSatAmps;
    ign["current_pin"]     = igniterCurrentPin;
    ign["current_mv_a"]    = igniterCurrentMvPerA;
    ign["current_zero_v"]  = igniterCurrentZeroV;
    ign["has_current"]     = hasIgniterCurrentSensor;

    auto ign2 = acts["igniter2"].to<JsonObject>();
    ign2["enabled"] = hasIgniter2; ign2["pin"] = igniter2Pin; ign2["active_h"] = igniter2ActiveH;
    ign2["pwm"] = igniter2Pwm; ign2["dwell_ms"] = igniter2DwellMs; ign2["rest_ms"] = igniter2RestMs;
    ign2["coil"]            = igniter2Coil;
    ign2["coil_sat_a"]      = igniter2CoilSatAmps;
    ign2["current_pin"]     = igniter2CurrentPin;
    ign2["current_mv_a"]    = igniter2CurrentMvPerA;
    ign2["current_zero_v"]  = igniter2CurrentZeroV;
    ign2["has_current"]     = hasIgniter2CurrentSensor;

    auto sen = acts["starter_en"].to<JsonObject>();
    sen["enabled"] = hasStarterEn; sen["pin"] = starterEnPin; sen["active_h"] = starterEnActiveH;
    sen["delay_ms"] = starterEnDelayMs;

    auto abs = acts["ab_sol"].to<JsonObject>();
    abs["enabled"] = hasAbSol; abs["pin"] = abSolPin; abs["active_h"] = abSolActiveH;

    auto airs = acts["airstarter_sol"].to<JsonObject>();
    airs["enabled"] = hasAirstarterSol; airs["pin"] = airstarterSolPin;
    airs["active_h"] = airstarterSolActiveH;

    auto fan = acts["cool_fan"].to<JsonObject>();
    fan["enabled"] = hasCoolFan; fan["pin"] = coolFanPin;
    fan["type"] = coolFanType; fan["active_h"] = coolFanActiveH;
    fan["min_us"] = coolFanMinUs; fan["max_us"] = coolFanMaxUs;
    fan["freq_hz"] = coolFanFreqHz; fan["res_bits"] = coolFanResBits;
    fan["pwm_min_pct"] = coolFanPwmMinPct; fan["pwm_max_pct"] = coolFanPwmMaxPct;

    auto abp = acts["ab_pump"].to<JsonObject>();
    abp["enabled"] = hasAbPump; abp["pin"] = abPumpPin;
    abp["type"] = abPumpType; abp["active_h"] = abPumpActiveH;
    abp["min_us"] = abPumpMinUs; abp["max_us"] = abPumpMaxUs;
    abp["freq_hz"] = abPumpFreqHz; abp["res_bits"] = abPumpResBits;
    abp["pwm_min_pct"] = abPumpPwmMinPct; abp["pwm_max_pct"] = abPumpPwmMaxPct;

    auto scav = acts["oil_scavenge_pump"].to<JsonObject>();
    scav["enabled"]   = hasOilScavengePump;
    scav["pin"]       = oilScavPumpPin;
    scav["type"]      = oilScavPumpType;
    scav["min_us"]    = oilScavPumpMinUs;
    scav["max_us"]    = oilScavPumpMaxUs;
    scav["active_h"]  = oilScavPumpActiveH;
    scav["freq_hz"]   = oilScavPumpFreqHz;
    scav["res_bits"]  = oilScavPumpResBits;
    scav["pwm_min_pct"] = oilScavPumpPwmMinPct;
    scav["pwm_max_pct"] = oilScavPumpPwmMaxPct;

    auto fp2 = acts["fuel_pump2"].to<JsonObject>();
    fp2["enabled"]  = hasFuelPump2; fp2["pin"] = fuelPump2Pin;
    fp2["type"]     = fuelPump2Type; fp2["active_h"] = fuelPump2ActiveH;
    fp2["min_us"]   = fuelPump2MinUs; fp2["max_us"] = fuelPump2MaxUs;
    fp2["freq_hz"]  = fuelPump2FreqHz; fp2["res_bits"] = fuelPump2ResBits;
    fp2["pwm_min_pct"] = fuelPump2PwmMinPct; fp2["pwm_max_pct"] = fuelPump2PwmMaxPct;

    auto blv = acts["bleed_valve"].to<JsonObject>();
    blv["enabled"] = hasBleedValve; blv["pin"] = bleedValvePin;
    blv["type"] = bleedValveType; blv["active_h"] = bleedValveActiveH;
    blv["min_us"] = bleedValveMinUs; blv["max_us"] = bleedValveMaxUs;
    blv["freq_hz"] = bleedValveFreqHz; blv["res_bits"] = bleedValveResBits;
    blv["pwm_min_pct"] = bleedValvePwmMinPct; blv["pwm_max_pct"] = bleedValvePwmMaxPct;

    auto pps = acts["prop_pitch"].to<JsonObject>();
    pps["enabled"] = hasPropPitch; pps["pin"] = propPitchPin;
    pps["type"] = propPitchType;
    pps["min_us"] = propPitchMinUs; pps["max_us"] = propPitchMaxUs;
    pps["freq_hz"] = propPitchFreqHz; pps["res_bits"] = propPitchResBits;
    pps["pwm_min_pct"] = propPitchPwmMinPct; pps["pwm_max_pct"] = propPitchPwmMaxPct;
    pps["active_h"] = propPitchActiveH;

    auto glw = acts["glow_plug"].to<JsonObject>();
    glw["enabled"] = hasGlowPlug; glw["pin"] = glowPlugPin;
    glw["type"] = glowPlugType;
    glw["output_type"] = glowPlugOutputType;
    glw["active_h"] = glowPlugActiveH;
    glw["freq_hz"] = glowPlugFreqHz; glw["res_bits"] = glowPlugResBits;
    glw["pwm_min_pct"] = glowPlugPwmMinPct; glw["pwm_max_pct"] = glowPlugPwmMaxPct;
    glw["fuel_pin"] = wetGlowFuelPin;
    glw["fuel_type"] = wetGlowFuelType;
    glw["fuel_active_h"] = wetGlowFuelActiveH;
    glw["fuel_min_us"] = wetGlowFuelMinUs;
    glw["fuel_max_us"] = wetGlowFuelMaxUs;
    glw["fuel_freq_hz"] = wetGlowFuelFreqHz;
    glw["fuel_res_bits"] = wetGlowFuelResBits;
    glw["fuel_pwm_min_pct"] = wetGlowFuelPwmMinPct;
    glw["fuel_pwm_max_pct"] = wetGlowFuelPwmMaxPct;
    glw["fuel_demand_pct"] = wetGlowFuelDemandPct;
    glw["fuel_delay_ms"] = wetGlowFuelDelayMs;
    glw["current_pin"]    = glowCurrentPin;
    glw["current_mv_a"]   = glowCurrentMvPerA;
    glw["current_zero_v"] = glowCurrentZeroV;
    glw["current_ready_a"]= glowCurrentReadyAmps;
    glw["has_current"]    = hasGlowCurrentSensor;

    auto led = acts["status_led"].to<JsonObject>();
    led["enabled"] = hasStatusLed; led["pin"] = statusLedPin; led["type"] = statusLedType;
    led["mode"] = statusLedMode;
    led["standby_color"] = statusLedStandbyColor;
    led["startup_color"] = statusLedStartupColor;
    led["running_color"] = statusLedRunningColor;
    led["shutdown_color"] = statusLedShutdownColor;
    led["blink_color"] = statusLedBlinkColor;

    auto clus = doc["cluster_serial"].to<JsonObject>();
    clus["enabled"] = hasClusterSerial; clus["tx_pin"] = clusterTxPin;
    clus["rx_pin"] = clusterRxPin;
    clus["baud"] = clusterBaud; clus["interval_ms"] = clusterIntervalMs;

    auto buz = doc["buzzer"].to<JsonObject>();
    buz["enabled"] = hasBuzzer; buz["pin"] = buzzerPin;

    auto mvl = doc["mavlink"].to<JsonObject>();
    mvl["enabled"] = hasMAVLink; mvl["tx_pin"] = mavlinkTxPin;
    mvl["baud"] = mavlinkBaud; mvl["interval_ms"] = mavlinkIntervalMs;

    auto contrl = doc["controllers"].to<JsonObject>();
    contrl["oil_loop"]      = hasOilLoop;
    contrl["dynamic_idle"]  = hasDynamicIdle;
    contrl["governor"]      = hasGovernor;
    auto loops = doc["oil_loops"].to<JsonArray>();
    for (uint8_t i = 0; i < oilLoopCount; i++) {
        const auto& l = oilLoops[i];
        auto o = loops.add<JsonObject>();
        o["id"] = l.id;
        o["enabled"] = l.enabled;
        o["pressure_input"] = l.pressureInputIndex < channelRegistry.inputCount
            ? channelRegistry.inputs[l.pressureInputIndex].id : "";
        o["pump_output"] = l.pumpOutputIndex < channelRegistry.outputCount
            ? channelRegistry.outputs[l.pumpOutputIndex].id : "";
        o["target_bar"] = l.targetCentiBar / 100.0f;
        o["deadband_bar"] = l.deadbandCentiBar / 100.0f;
        o["min_demand"] = l.minDemandPct / 100.0f;
        o["max_demand"] = l.maxDemandPct / 100.0f;
    }

    auto saf = doc["safety"].to<JsonObject>();
    saf["overspeed"]  = safetyOverspeed;
    saf["n2_overspeed"] = safetyN2Overspeed;
    saf["overtemp"]   = safetyOvertemp;
    saf["low_oil"]    = safetyLowOil;
    saf["oil_zero"]   = safetyOilZero;
    saf["flameout"]   = safetyFlameout;
    saf["hot_start"]      = safetyHotStart;
    saf["oil_temp_high"]  = safetyOilTempHigh;
    saf["fuel_press_low"] = safetyFuelPressLow;
    saf["batt_low"]       = safetyBattLow;
    saf["surge"]          = safetySurge;

    auto ss = doc["startup_seq"].to<JsonArray>();
    for (int i = 0; i < startupSeqLen; i++) ss.add(startupSeq[i]);
    auto ssd = doc["startup_delay_ms"].to<JsonArray>();
    for (int i = 0; i < startupSeqLen; i++) ssd.add(startupDelayMs[i]);
    auto ssit = doc["startup_ignition_target"].to<JsonArray>();
    for (int i = 0; i < startupSeqLen; i++) ssit.add(startupIgnitionTarget[i]);
    HardwareConfigInternal::writeSequenceSideActions(doc, "startup_enter_actions", startupSeqLen, startupEnterActions);
    HardwareConfigInternal::writeSequenceSideActions(doc, "startup_exit_actions", startupSeqLen, startupExitActions);

    auto ds = doc["shutdown_seq"].to<JsonArray>();
    for (int i = 0; i < shutdownSeqLen; i++) ds.add(shutdownSeq[i]);
    auto dsd = doc["shutdown_delay_ms"].to<JsonArray>();
    for (int i = 0; i < shutdownSeqLen; i++) dsd.add(shutdownDelayMs[i]);
    auto dsit = doc["shutdown_ignition_target"].to<JsonArray>();
    for (int i = 0; i < shutdownSeqLen; i++) dsit.add(shutdownIgnitionTarget[i]);
    HardwareConfigInternal::writeSequenceSideActions(doc, "shutdown_enter_actions", shutdownSeqLen, shutdownEnterActions);
    HardwareConfigInternal::writeSequenceSideActions(doc, "shutdown_exit_actions", shutdownSeqLen, shutdownExitActions);

    auto abt = doc["ab_trigger"].to<JsonObject>();
    abt["source"]           = abTriggerSource;
    abt["requires_arm"]     = abRequiresArmSwitch;
    abt["arm_pin"]          = abArmSwitchPin;
    abt["arm_active_h"]     = abArmSwitchActiveH;
    abt["switch_pin"]       = abSwitchPin;
    abt["switch_active_h"]  = abSwitchActiveH;
    abt["input_pin"]        = abInputPin;
    abt["input_rc_pwm"]     = abInputRcPwm;
    abt["input_min_us"]     = abInputMinUs;
    abt["input_max_us"]     = abInputMaxUs;
    abt["input_threshold"]  = abInputThreshold;

    auto abfl = doc["ab_flame"].to<JsonObject>();
    abfl["enabled"]   = hasAbFlame;
    abfl["pin"]       = abFlamePin;
    abfl["threshold"] = abFlameThreshold;

    auto as = doc["ab_seq"].to<JsonArray>();
    for (int i = 0; i < abSeqLen; i++) as.add(abSeq[i]);
    auto asd = doc["ab_delay_ms"].to<JsonArray>();
    for (int i = 0; i < abSeqLen; i++) asd.add(abDelayMs[i]);
    auto asit = doc["ab_ignition_target"].to<JsonArray>();
    for (int i = 0; i < abSeqLen; i++) asit.add(abIgnitionTarget[i]);
    HardwareConfigInternal::writeSequenceSideActions(doc, "ab_enter_actions", abSeqLen, abEnterActions);
    HardwareConfigInternal::writeSequenceSideActions(doc, "ab_exit_actions", abSeqLen, abExitActions);

    auto ass = doc["ab_shut_seq"].to<JsonArray>();
    for (int i = 0; i < abShutSeqLen; i++) ass.add(abShutSeq[i]);
    auto assd = doc["ab_shut_delay_ms"].to<JsonArray>();
    for (int i = 0; i < abShutSeqLen; i++) assd.add(abShutDelayMs[i]);
    auto assit = doc["ab_shut_ignition_target"].to<JsonArray>();
    for (int i = 0; i < abShutSeqLen; i++) assit.add(abShutIgnitionTarget[i]);
    HardwareConfigInternal::writeSequenceSideActions(doc, "ab_shut_enter_actions", abShutSeqLen, abShutEnterActions);
    HardwareConfigInternal::writeSequenceSideActions(doc, "ab_shut_exit_actions", abShutSeqLen, abShutExitActions);
    HardwareConfigInternal::writeCustomBlocks(doc);

    auto lbl = doc["labels"].to<JsonObject>();
    lbl["tot"]        = labelTot;
    lbl["tit"]        = labelTit;
    lbl["n1"]         = labelN1;
    lbl["n2"]         = labelN2;
    lbl["oil_press"]  = labelOilPress;
    lbl["oil_temp"]   = labelOilTemp;
    lbl["p1"]         = labelP1;
    lbl["p2"]         = labelP2;
    lbl["fuel_press"] = labelFuelPress;
    lbl["fuel_flow"]  = labelFuelFlow;
    lbl["stop"]       = labelStop;
    lbl["start"]      = labelStart;
    lbl["ab_arm"]     = labelAbArm;

    auto diArr = doc["di_channels"].to<JsonArray>();
    for (int i = 0; i < MAX_DI; i++) {
        auto ch = diArr.add<JsonObject>();
        ch["pin"]          = diCh[i].pin;
        ch["active_h"]     = diCh[i].activeH;
        ch["debounce_ms"]  = diCh[i].debounceMs;
        ch["label"]        = diCh[i].label;
        ch["role"]         = diCh[i].role;
        ch["fault_code"]   = diCh[i].faultCode;
        ch["fault_msg"]    = diCh[i].faultMsg;
        // Only 5 SysMode bits exist — never serialize a value validators
        // would flag (a raw 0xFF here used to brick the next boot).
        ch["active_modes"] = (uint8_t)(diCh[i].activeModes & 0x1F);
    }
    auto registry = doc["channel_registry"].to<JsonObject>();
    registry["version"] = CHANNEL_REGISTRY_VERSION;
    channelRegistry.toJson(registry);
    PcbProfileManager::toJson(doc["_pcb_profile"].to<JsonObject>(), false);
}
