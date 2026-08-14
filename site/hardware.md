---
layout: document
title: OpenTurbine hardware and wiring guide
description: Hardware and wiring guidance for an ESP32 turbine ECU, including sensors, driver electronics, grounding, power protection, and independent emergency shutdown.
lede: Build a safe interface around the ESP32; a GPIO pin is a logic signal, never load power.
---

{% include safety-note.html %}

This guide covers the physical interface for an OpenTurbine ESP32 turbine ECU. It is not a universal turbine wiring diagram. Keep fuel, ignition, starter, and other load power disconnected while checking the installation.

New to electronics or microcontrollers? Use the [complete beginner user guide]({{ '/user-guide/' | relative_url }}) first. It now contains the enlarged wiring diagram, wire-by-wire connection patterns, every supported input/output purpose, every controller and safety function, calibration, sequencing, dry testing, and a source-generated reference for all Config fields.

## Supported ESP32 targets

Use a Classic ESP32 with at least 4 MB flash, or an ESP32-S3 DevKitC-1-compatible board with at least 8 MB flash. The universal S3 image runs on 8 MB and 16 MB modules and does not require PSRAM. ESP32-C3 and other unlisted families are not supported by the normal Windows setup path. Select the exact target in Hardware before assigning pins, and never copy a classic-ESP32 pin assignment to an S3 without rechecking it.

## Installed Channel Inventory

The Hardware page is the source of truth for what is physically connected. Add each fitted input and output once, give it a short unique stable ID, select its electrical driver, assign a valid GPIO, and set the real engineering range. Display names can change later; stable IDs should not change after sequences, rules, controllers, or telemetry refer to them.

Inputs can represent digital switches, analog measurements, pulse/frequency sensors, or RC PWM commands. Outputs can represent relays, proportional PWM loads, or servo/ESC commands. Set boot-safe and fault-safe output demand deliberately. Resolve every missing requirement, invalid-channel message, and GPIO conflict before saving; the firmware blocks unsafe or ambiguous hardware configurations rather than guessing.

On development boards, configure shared I²C and SPI wiring once under **Shared
sensor buses**. Its normal collapsed view reports Enabled/Disabled; **Edit
buses** opens the pins and supported-device help. Current I²C devices are
TCA9554, TLA2528, and NAU7802. Current shared-SPI thermocouple interfaces are
MAX6675, MAX31855, and MAX31856. DS18B20 uses a separate OneWire GPIO. A flashed
PCB profile owns these physical connections and shows board-labelled ports
instead of editable raw topology.

## Supported sensor and expansion devices

This is the current firmware compatibility list for planning a build. A module
using a different chip is not automatically compatible just because its listing
uses a similar description. Breakout-board voltage levels, reference voltage,
input protection and load-driving capability still need to suit the installation.

| Interface or chip | Supported use | Planning notes |
| --- | --- | --- |
| **MAX6675** | K-type thermocouple for TOT, TIT or oil temperature | Shared SPI clock/data with one unique CS per module. Read-only interface; no MOSI required. |
| **MAX31855** | K-type thermocouple for TOT, TIT or oil temperature | Shared SPI clock/data with one unique CS per module. Read-only interface; no MOSI required. |
| **MAX31856** | K, J, N, T, E, R, S or B thermocouple for TOT, TIT or oil temperature | Shared SPI plus MOSI so the ECU can configure and verify the converter; one unique CS per module. |
| **NTC thermistor** | Oil, coolant, intake or ambient temperature | Native ADC divider with beta/resistance model or calibrated nonlinear curve. Not offered for turbine-gas temperature. |
| **DS18B20** | Oil, coolant, intake or ambient temperature | Dedicated OneWire GPIO, external 4.7 kΩ pull-up to 3.3 V, selectable 9–12-bit resolution. Not offered for turbine-gas temperature. |
| **TCA9554** | Eight I²C on/off inputs or low-current logic outputs per chip | Addresses `0x20–0x27`; optional shared open-drain interrupt for inputs. Use external rated drivers for real loads. A disconnected expander cannot be forced to change its retained output latch. |
| **TLA2528** | Eight I²C analog inputs or analog-threshold switches per chip | Addresses `0x10–0x17`; configurable reference/supply scaling, valid-voltage window, engineering range and filtering. |
| **NAU7802** | Two I²C bridge/load-cell channels for torque or thrust | Fixed address `0x2A`; both channels share gain and sample rate. One device can measure torque and thrust when each uses a different channel. |
| **HX711** | Direct two-wire bridge/load-cell input for shaft torque | Uses one DOUT input and one SCK output GPIO. Calibration stores unloaded zero and torque scale. |
| **Native ESP32 inputs** | Digital switches, ADC sensors, pulse/frequency sensors, PWM-duty inputs and RC receiver pulses | Covers N1/N2 speed, pressures, voltage, flow, flame, operator commands and generic fitted channels when the signal is conditioned to the selected ESP32 input limits. |
| **Native ESP32 outputs** | On/off relay commands, proportional PWM and servo/ESC pulse commands | Covers fuel/oil pumps, starters, valves, ignition, propeller pitch and auxiliaries through suitable external driver electronics. GPIO never supplies load power. |

The Hardware page only offers a detected shared-I²C device for a new assignment.
Previously saved assignments remain visible but unhealthy if that chip or bus is
lost, allowing the installation to be diagnosed or deliberately cleaned up.

## Power supply

Power the controller from a clean regulated supply within the board manufacturer's limits. Fuse the ECU supply and each load supply appropriately. Keep starter, pump, motor, and ignition current away from sensor wiring and the ESP32 ground return. Use connectors, wire sizes, strain relief, and enclosure protection appropriate for vibration, heat, and current.

## 3.3 V GPIO limits

ESP32 GPIO is 3.3 V logic and is not 5 V tolerant. Measure every external signal at the ECU pin under normal and fault conditions. A 5 V sensor, relay module, magnetic pickup, or actuator must use a divider, level shifter, isolator, or suitable driver/conditioner before it reaches a GPIO.

## ADC restrictions

On a Classic ESP32, use ADC1 GPIO 32-39 while Wi-Fi is active. GPIO 34-39 are input-only, and ADC2 is unreliable with Wi-Fi. On the supported ESP32-S3 target, use the input choices provided by the Hardware page; native USB and flash/PSRAM pins are not general-purpose replacements. Resolve the Hardware page's conflict warnings rather than forcing a pin choice.

## Driver electronics

An ESP32 output does not power a pump, valve, starter, relay coil, glow plug, or igniter. Use a suitable logic-level MOSFET driver, protected automotive driver, relay module with a valid 3.3 V input, ESC input, or dedicated ignition stage between the GPIO and the load. Test active-high/active-low behavior with the load supply disconnected first.

## Flyback protection

DC relay and solenoid coils need suitable flyback suppression unless the selected driver already includes it. Use the protection method specified for the driver and load; a generic diode is not appropriate for every switching speed or shutdown requirement. Keep suppression physically near the inductive load or driver as its documentation requires.

## Grounding

Join logic grounds only where an interface is not intentionally isolated. Use a deliberate return path so starter, pump, and ignition current cannot lift the sensor reference. Keep thermocouple, RPM, analog-sensor, and communication wiring separated from high-current and high-voltage wiring. Shield and filter long/noisy sensor runs as the sensor and interface documentation requires.

## RPM sensors

N1/N2 inputs require a clean, conditioned 3.3 V-compatible pulse signal and the correct pulses-per-revolution value. Open-collector sensors normally need a pull-up to 3.3 V. Magnetic pickups need a dedicated conditioner or comparator; do not connect an unbounded pickup waveform directly to a GPIO. Verify displayed RPM with an independent tachometer before enabling overspeed protection.

## Thermocouple interfaces

TOT/EGT and TIT thermocouples connect through supported converter modules, not directly to the ESP32. Select the actual converter type and connect its SPI lines and chip-select as required. Several SPI modules may share the bus but need individual chip-select pins. Verify thermocouple type, polarity, connector metals, cold-junction behavior, and probe location before using a temperature limit.

## Pressure sensors

Most pressure transducers need a regulated supply, a common sensor ground, and a conditioned output that remains within the ADC range. A typical 0.5-4.5 V automotive sensor cannot connect directly to a 3.3 V ADC. Use correctly calculated scaling and protection, then calibrate at zero and against a trusted gauge with the real plumbing depressurized.

## Pump control

Drive fuel, oil, or scavenge pumps through a rated driver or ESC, with a separately fused load supply. Confirm the command direction and minimum reliable output without fuel pressure. Do not treat a GPIO, breadboard trace, or undersized relay as a pump power path. Test physical fuel shutoff independently from any software command.

## Starter control

Use a rated starter contactor, motor controller, or air-start valve driver for the starting system. Keep high starting current out of the ECU supply and ground reference. Test direction, interlocks, and timeout behavior with the engine made safe. The controller must not be the only means to stop starter energy.

## Ignition control

Use the ignition system's specified driver and isolation method. Never connect an ignition coil directly to an ESP32 output. Keep high-voltage ignition wiring away from sensor and communication wires, verify that vapors are cleared before a test, and retain an independent means to remove ignition and fuel energy.

## Independent emergency stop

Install a physical, independent emergency stop that removes fuel or relevant load power even if the ESP32, browser, Wi-Fi, or firmware is unavailable. Test it from a safe position before every fueled attempt. A dashboard STOP button is useful but is not an independent emergency stop.

## Dry wiring checklist

Before applying load power, confirm:

- the selected ESP32 target and every GPIO assignment match the actual board;
- all external inputs are conditioned to safe 3.3 V logic or ADC ranges;
- each pump, valve, starter, relay, and igniter has a rated driver and fuse;
- flyback and transient protection are fitted where required;
- sensor grounds, load returns, and high-current paths are deliberately routed;
- no pin conflict or hardware dependency warning remains;
- output polarity is verified at logic level; and
- the physical emergency stop removes energy independently.

For the setup order and calibration workflow, continue to the [OpenTurbine user guide]({{ '/user-guide/' | relative_url }}).
