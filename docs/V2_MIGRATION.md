# Moving to OpenTurbine 2.0

OpenTurbine 2.0 is an intentional configuration and hardware-model break. It
prioritizes one maintainable fitted-hardware model over compatibility with
pre-2.0 experiments. Do not install v2 immediately before an engine run and
assume an older setup remains valid.

## Recommended upgrade

1. On the old ECU, download the complete engine file and relevant logs for
   reference. Treat the file as sensitive because it can contain the ECU Wi-Fi
   password.
2. Record the physical wiring, output polarity, sensor types, calibration
   references, engine limits, and sequence behavior independently.
3. Use **Clean install / reinstall** for the intended board. Choose
   **Development board**, the compatible bundled **Official OpenTurbine PCB**,
   or a chip-matched **Custom PCB profile**.
4. Rebuild the installation in v2 Hardware from what is physically fitted.
   Do not restore crossed Hardware and Settings sections or use an old file as
   proof that a channel is still connected correctly.
5. Review every Config value, recalibrate every safety-relevant sensor and
   actuator, rebuild/review startup and shutdown sequences, and retest every
   physical STOP path with fuel and ignition isolated.

## Important v2 changes

- Hardware is the single source of truth. Config can preserve inactive future
  tuning values, but missing hardware cannot be enabled from Config.
- Main and afterburner flame detectors are canonical Hardware input cards.
  Standalone pre-v2 flame pin/threshold mirrors are not imported; recreate the
  detector card and recalibrate its threshold, hysteresis, and active state.
- Development boards configure shared I²C/SPI buses once. Supported I²C devices
  are TCA9554, TLA2528, and NAU7802; shared SPI supports MAX6675, MAX31855, and
  MAX31856. DS18B20 uses a separate OneWire GPIO.
- Optional immutable PCB profiles replace raw topology with board-labelled
  compatible connections. A missing or wrong profile inhibits START.
- Automatic relight requires healthy N1 and never fires below the higher of its
  configured firing speed and Minimum Running N1.
- Startup temperature protection uses separate pre-start and active-start hard
  limits instead of a simple EGT rise-rate trip.
- Gradual N1/N2/TOT-or-TIT/P1/P2/torque fuel limiting keeps selectable simple
  and rate-predictive modes. Independent hard trips remain separate.
- Main and scavenge oil pumps may have separate flow meters. Underflow warns by
  default and shuts down only when explicitly selected in Config.
- Electric drain valves are normal fitted outputs available to Sequence,
  Control Rules, and standby Tools testing.
- Logging setup lives on Log. Binary rule values are shown as On/Off.
- The v2.0.1-and-later Classic ESP32 clean-install layout uses 1.625 MiB OTA slots and
  576 KiB LittleFS. A Wi-Fi update cannot replace a partition table; use a USB
  **Clean install / reinstall** to gain the larger OTA reserve. Back up the
  engine file and logs first because clean install erases them.

## Before fuel

Run the full v2 dry commissioning path:

**Hardware → Config → Calibration → Sequence/Rules → Tools → Dashboard/Log**

Verify physical direction and safe state for every output, sensor-loss behavior,
hard safety trips, overlapping limiters/controllers, shutdown order, reboot
behavior, and the independent energy-removing emergency stop. A successful file
restore, clean release build, or browser test does not replace this hardware
verification.
