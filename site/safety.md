---
layout: document
title: OpenTurbine experimental safety requirements
description: "Experimental turbine ECU safety requirements for OpenTurbine: independent shutdown, power protection, dry testing, controlled setup, and physical test-stand precautions."
lede: OpenTurbine is experimental, not certified, and cannot determine the safe limits of your turbine.
---

{% include safety-note.html %}

Use a restrained test stand, an exclusion zone, hearing and eye protection, and suitable fire suppression. Verify correct drivers, fusing, grounding, sensors, sensor failures, limits, shutdown sequences, and output polarity. Keep fuel and ignition isolated while configuring and testing. Perform dry tests before any fueled attempt.

The browser is not an emergency stop. A physical, independent stop must remove fuel or load power even if the ESP32, firmware, browser, or Wi-Fi is unavailable. Never infer certification or a safety guarantee from this project.

## Before applying power

- Read the complete [safety and operating guidance](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/blob/main/docs/USER_GUIDE.md#safety-and-operating-warning).
- Confirm the wiring against the board pin map and check output polarity with the engine disconnected.
- Use appropriately rated fuses, a common ground plan, and independent means to remove energy from actuators.
- Make sure a second person can operate the physical stop and that everyone is outside the test area.

## Test in stages

Start with a dry test: no fuel, no ignition, and no attached engine load. Check the displayed values, sensor-fault behavior, output states, and shutdown sequence. Add only one energy source at a time, and stop immediately if telemetry, wiring, or actuator behavior is not understood.

OpenTurbine does not replace local rules, competent supervision, or the safety information for the hardware being controlled.
