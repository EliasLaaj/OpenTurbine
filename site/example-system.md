---
layout: document
title: Explore a basic single-shaft turbine system
description: Walk through an ordinary OpenTurbine single-shaft example to understand the hardware, controllers, calibration, sequence, and safety decisions without copying engine-specific limits.
lede: A small, understandable example for learning how the pieces fit together—not a fuel schedule or wiring plan to copy unchanged.
---

{% include safety-note.html %}

This example is for someone who wants to explore OpenTurbine before designing a complete installation. It represents an ordinary electrically started, single-shaft experimental turbine with oil pressure and turbine-temperature monitoring.

It is intentionally not special, complete, or optimized for one engine. It does **not** provide engine-specific RPM limits, fuel demand, startup timing, temperature limits, pin assignments, wire sizes, driver ratings, or plumbing decisions. Those must come from measurements and the actual hardware.

## What this example contains

<div class="table-wrap"><table>
<thead><tr><th>Part of the system</th><th>Example choice</th><th>Why it is present</th></tr></thead>
<tbody>
<tr><td>ECU</td><td>Supported Classic ESP32 or ESP32-S3 board</td><td>Runs OpenTurbine and hosts the local browser interface.</td></tr>
<tr><td>Shaft feedback</td><td>One conditioned N1 speed signal</td><td>Shows core speed and supports acceleration checks, idle control, pullback, and independent overspeed shutdown.</td></tr>
<tr><td>Gas temperature</td><td>K-type thermocouple through a supported converter</td><td>Shows turbine temperature and supports hot-start and overtemperature protection.</td></tr>
<tr><td>Lubrication feedback</td><td>Conditioned oil-pressure sensor</td><td>Confirms pressure during startup and allows running oil-pressure protection or regulation.</td></tr>
<tr><td>Operator demand</td><td>Potentiometer or RC PWM throttle input</td><td>Provides the requested running demand after calibration. A logging-only or externally controlled system can omit it.</td></tr>
<tr><td>Main fuel metering</td><td>Rated pump driver, ESC, or metering-valve interface</td><td>Receives the protected proportional fuel command. The ESP32 pin is only a control signal.</td></tr>
<tr><td>Fuel isolation</td><td>Normally closed shutoff valve through a rated driver</td><td>Provides a separate physical fuel-isolation command during stop and fault handling.</td></tr>
<tr><td>Starting</td><td>Electric starter and, where required, a separate starter-enable output</td><td>Cranks the engine while the startup sequence checks time, speed, and temperature progress.</td></tr>
<tr><td>Ignition</td><td>Igniter through its specified isolated driver</td><td>Provides ignition energy only during the configured startup stages.</td></tr>
<tr><td>Oil delivery</td><td>Relay or proportional oil-pump driver</td><td>Primes before rotation, supports the run, and can continue through cooldown.</td></tr>
<tr><td>Independent stop</td><td>Hard-wired emergency-stop circuit</td><td>Removes fuel or relevant load power without relying on the ESP32, Wi-Fi, browser, or software.</td></tr>
</tbody>
</table></div>

The [hardware compatibility table]({{ '/hardware/#supported-sensor-and-expansion-devices' | relative_url }}) lists the converter and expansion chips currently supported. A compatible interface still needs suitable voltage levels, signal conditioning, load drivers, fusing, grounding, and transient protection.

## How the signals fit together

1. **N1, turbine temperature, and oil pressure** enter the ECU through suitable conditioners or supported converter modules.
2. **Throttle demand** asks for fuel; it does not bypass controller limits or shutdown logic.
3. **Main Fuel Metering** receives the final protected proportional demand.
4. **Fuel Shutoff, Starter, Igniter, and Oil Pump** are operated by the startup/shutdown sequence and applicable built-in subsystems.
5. The **independent emergency stop** removes energy outside the software path.

The browser is used to configure and observe the ECU. Losing the browser or Wi-Fi does not become a new engine command, but an operating installation must never depend on the browser as its only stop method.

## Build the example in the interface

You can explore this layout on a spare supported board with every load supply disconnected.

### 1. Hardware

Add only the devices in the example inventory. For every channel, choose the real electrical signal type and a valid pin for the selected board. A relay is binary; PWM and servo/ESC signals are proportional. Resolve every pin conflict and missing electrical requirement before saving.

Do not copy pin numbers from another board or installation. Classic ESP32 and ESP32-S3 have different usable pins, and a PCB profile may own its connections.

### 2. Controllers

Open the configured Main Fuel Metering controller. A straightforward starting point is operator demand commanding the fuel output, with engine-specific limits and automatic idle left for later commissioning.

If the oil pump is proportional and oil pressure is fitted, it may use an oil-pressure controller. A relay oil pump remains simple On/Off sequence hardware. Leave optional behavior disabled until its feedback and purpose are understood.

### 3. Calibration

Calibrate the throttle endpoints, verify N1 against an independent tachometer, compare turbine temperature with a trusted reference, and calibrate oil pressure at zero and against a gauge. Calibration makes a reading meaningful; it does not prove that a chosen safety limit is suitable.

### 4. Sequence

A typical startup concept is:

**Standby → pre-oil → crank → ignition → introduce fuel → confirm light-off → accelerate → final checks → running**

A typical shutdown concept is:

**Remove fuel and ignition → allow speed/temperature to fall → continue required oil or cooldown actions → stop all outputs**

The exact order can vary with the engine and starting system. Every wait needs a finite timeout and safe failure result. Do not copy example delays or demands from an unrelated turbine.

### 5. Protection

Enable a protection only after its input is fitted, calibrated, and proven healthy. Keep these ideas separate:

- **Pullback** gradually reduces fuel as a measured value approaches a configured boundary.
- **Hard shutdown** removes combustion authority when its independently configured trip condition is confirmed.
- **Reduced-Power operation** is a deliberate degraded option for eligible feedback failures; it is not a replacement for a working stop path.

### 6. Dry test

With fuel, ignition energy, starter power, and other load power isolated, verify:

- every input moves in the expected direction and reports believable units;
- each output uses the expected pin, polarity, signal type, and parked state;
- START advances only through conditions that are intentionally satisfied;
- sensor loss produces the expected warning, Reduced-Power choice, or lock;
- STOP, overspeed, overtemperature, and other configured trips remove the intended commands; and
- the independent emergency stop removes energy even if the ECU is unavailable.

## What to change for other systems

- A **logging-only installation** can omit fuel metering and every actuator; fit only the measurements that should be recorded.
- An **air-start system** replaces the electric starter path with its valve and interlocks.
- A **free-turbine or turboprop system** adds N2 and may assign a governor to fuel or propeller pitch.
- An **afterburning system** adds separate fuel and ignition hardware plus explicit arm, light-off evidence, and shutdown sequencing.
- A **sensor-light manual system** can retain external fuel control while using OpenTurbine for sequencing, selected protection, or logging.

These remain the same product: Hardware describes what exists, Controllers describe normal ownership, Sequence describes state changes, and System contains ECU-wide behavior.

## Continue from here

Use this example to understand the shape of a system, then design around the actual turbine and electronics:

<p class="document-nav"><a href="{{ '/get-started/' | relative_url }}">Install on a spare board</a><a href="{{ '/hardware/' | relative_url }}">Plan compatible hardware</a><a href="{{ '/user-guide/' | relative_url }}">Open the complete User Guide</a><a href="{{ '/safety/' | relative_url }}">Read the safety requirements</a></p>
