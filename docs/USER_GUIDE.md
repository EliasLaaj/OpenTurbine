# OpenTurbine 2.0 detailed user guide

OpenTurbine is an open-source ESP32 turbine engine controller with a built-in web interface. It is intended for experimental turbojets, APUs, generators, turboshafts, turboprops, and other small turbine installations.

The project aims to support the variety found in hobby turbines instead of prescribing one engine layout. The normal interface keeps common setup simple and shows only controls relevant to the fitted hardware; Advanced views, configurable sequences, custom controls, sensor models, and actuator choices remain available for unusual installations. Suggestions are starting points to verify, not mandatory engine settings. OpenTurbine should require an action only when needed to prevent an immediate unsafe operation, destructive data loss, or an internally invalid configuration.

> **Experimental engine control software:** A turbine can cause fire, burns, overspeed failure, fuel spray, projectiles, hearing damage, and death. OpenTurbine does not know the safe limits of your engine. You must verify every limit, output direction, shutdown path, and sequence on a safe test stand before introducing fuel.

## Download and install

### Windows—the easy path

**[Download OpenTurbine Setup Tool](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/releases/latest/download/OpenTurbineSetupTool.exe)**

1. Connect an ESP32 or supported ESP32-S3 board by USB.
2. Open `OpenTurbineSetupTool.exe`.
3. Choose **Clean install / reinstall**. This USB path erases the selected board and is correct for a blank board or an intentional fresh installation on an older board. If the older board still works, first download its complete engine file from Tools; the clean-install path cannot recover erased settings.
4. Select the detected board. For a clean install, choose **Development board** for the normal GPIO workflow, a compatible bundled **Official OpenTurbine PCB**, or **Custom PCB profile** for a chip-specific profile supplied with a PCB design.
5. After installation, join the Wi-Fi network shown by the tool and open `http://192.168.4.1`.

For normal upgrades, choose **Update and keep my setup**. That Wi-Fi path backs up the engine settings and updates firmware and web pages without resetting the existing setup.

If a requested download says **Not Found**, that release asset is not published. Do not download an installer offered by an unrelated third party. Official releases belong at [github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/releases](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/releases).

### If Windows blocks the installer

The current installer may be unsigned or may not yet have Microsoft download reputation, so Microsoft Edge, Chrome, or SmartScreen may warn about a new or uncommon application. Windows 11 Smart App Control can block unsigned or untrusted apps more strictly.

Only continue when you used the official OpenTurbine download link above. In SmartScreen choose **More info → Run anyway**. If a browser blocks the download, open its Downloads panel and choose to keep the file. Do not disable Windows security globally for OpenTurbine.

Normal installation does not require understanding checksums or file hashes. The Setup Tool automatically verifies the firmware package it downloads. Releases also include `.sha256` files for developers and users who deliberately want optional advanced verification.

The setup tool can install the USB serial driver needed by common CP210x and WCH CH340/CH341/CH343 boards. It detects the connected USB bridge hardware ID and offers only the matching driver. After driver installation it rescans Windows and continues automatically when the matching COM port appears; reconnect or restart only if the tool explicitly asks.

### Linux, macOS, or manual PlatformIO installation

The graphical setup tool is currently Windows-only. Developers and users comfortable with PlatformIO can install manually:

```bash
git clone https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU.git
cd OpenTurbine
python tools/build_web_sources.py
python tools/gzip_data.py

# Classic ESP32:
pio run -e esp32dev -t upload
pio run -e esp32dev -t uploadfs

# Or the supported ESP32-S3 DevKitC-1-compatible target (8 MB or larger flash):
pio run -e esp32s3dev -t upload
pio run -e esp32s3dev -t uploadfs
```

Use only the environment matching the board. The filesystem upload is required because it contains the web interface. Specify `--upload-port` when automatic port detection chooses incorrectly. A partition-table change requires both firmware and filesystem installation over USB.

### Development boards and PCB profiles

A development-board install leaves the dedicated PCB-profile partition erased. Hardware setup then works exactly as the normal manual workflow: choose electrical interfaces, GPIOs, buses, addresses, polarity, and calibration.

A PCB-profile install stores an immutable, chip-specific description of the soldered hardware during the USB clean install. In Hardware, you still add engine purposes such as N1, TOT, throttle input, starter, or oil pump, but **Connected to** offers only compatible labelled connections from that PCB. GPIOs, chip addresses, bus wiring, and fixed polarity are not editable. Calibration and operating ranges remain user settings.

The profile describes what the PCB was designed to contain; live device discovery reports whether supported I²C chips are actually responding. A missing fixed device cannot be selected for a new assignment. Existing dependent assignments remain visible as unhealthy and can be removed to free the rest of the setup. A damaged, wrong-chip, or unrecognized profile locks START instead of falling back to unrelated development-board pins.

Factory reset and Wi-Fi firmware updates preserve the PCB profile. Installing, changing, or removing one requires a USB clean install. A complete engine file containing profile-backed hardware can only be restored to the same PCB profile ID and revision. Custom profile authors should use [`pcb_profiles/README.md`](../pcb_profiles/README.md), validate the source file, and still provide electrical pull resistors that keep dangerous outputs safe during reset and bootloader operation.

## What you need

### To install and explore without running an engine

- Windows computer for the setup tool
- ESP32 development board with at least 4 MB flash, or an ESP32-S3 DevKitC-1-compatible board with at least 8 MB flash
- Data-capable USB cable
- A phone or computer with Wi-Fi and a browser

You can explore the web interface and configure hardware without connecting fuel, ignition, pumps, or a turbine.

### Before a fueled turbine test

The exact equipment depends on the engine. At minimum, a real installation needs:

- An ECU board and a stable power supply sized for every connected load
- A controllable main fuel output: pump/ESC, metering actuator, or equivalent
- A positive fuel shutoff method appropriate to the installation
- An ignition system
- A safe starting method: starter motor, air starter, or external air source
- Lubrication hardware required by the engine, including oil and scavenge pumps where applicable
- A physical emergency fuel/power stop independent of the browser
- Proper wiring protection, fusing, grounding, connectors, and flyback suppression
- A restrained outdoor test stand, exclusion zone, hearing/eye protection, and suitable fire suppression

OpenTurbine can execute a purely timed sequence without sensors, but that is **not a recommendation for a fueled test**. For a responsible first run, fit feedback that can detect the failures relevant to your engine. Usually this means:

- N1/core RPM for gas-generator overspeed protection and, on a two-shaft engine, a separate N2 pickup for power-turbine overspeed protection
- TOT/EGT or TIT for over-temperature and hot-start protection
- Oil pressure when the engine uses a pressure-fed lubrication system
- A combustion indication such as flame sensing, RPM behavior, or EGT behavior

Sensor type and location matter. A safe value at one station may be unsafe or meaningless at another. Use the engine manufacturer’s information, sensor datasheets, mechanical gauges, and controlled bench data.

## Electrical and wiring basics

OpenTurbine assigns pins from the Hardware page, so there is no single universal wiring diagram. The Hardware page’s pin list and conflict checker are authoritative for the selected ESP32 target. The rules below explain how the common connections work.

### Before connecting anything

1. Disconnect fuel, ignition energy, starter power, pumps, and other high-current supplies.
2. Power the ESP32 from a clean regulated supply within the board manufacturer’s limits.
3. Confirm every external signal voltage with a meter before connecting it to a GPIO.
4. Join logic grounds unless an interface is intentionally isolated.
5. Keep sensor wiring away from igniter, starter, pump, and motor wiring.
6. Fuse load supplies and use wire/connectors rated for starting and stall current.

ESP32 GPIO is **3.3 V logic and is not 5 V tolerant**. A sensor advertised as “0.5–4.5 V” cannot connect directly to an ADC input; use a correctly calculated divider or signal conditioner that keeps the ECU pin at or below 3.3 V under every fault and supply condition.

### ESP32 pin rules

| Target | Analog inputs | Important restrictions |
|---|---|---|
| Classic ESP32 | Use ADC1 GPIO 32–39 while Wi-Fi is active | GPIO 34–39 are input-only. GPIO 6–11 are normally connected to internal flash. Avoid boot-strapping pins unless the external circuit cannot disturb boot. ADC2 is not reliable while Wi-Fi is active. |
| Supported ESP32-S3 DevKitC-1-compatible board | Use ADC1 GPIO 1–10 | GPIO 19/20 are native USB D−/D+. GPIO 22–25 are not implemented. GPIO 26–32 may be flash/PSRAM connections. The universal image needs at least 8 MB flash and does not require PSRAM; verify the exact module and use only Hardware-page choices. |

Never copy a classic ESP32 pin number into an S3 installation without reselecting the target and pins in Hardware.

### Shared I²C devices

OpenTurbine scans its configured SDA/SCL bus at startup and rechecks it while running. The Hardware page only offers a TCA9554, TLA2528, or NAU7802 for a new assignment when that device is responding. Detection does not guess a turbine function: add an input/output card, choose what it measures or controls, then select the detected device and channel.

On a development board, **Shared sensor buses** initially shows a compact
Enabled/Disabled summary. Choose **Edit buses** only when fitting or changing
I²C/SPI hardware. The expandable supported-device note lists current bus chips;
DS18B20 is also listed there for clarity, but it uses its own OneWire GPIO rather
than the shared I²C/SPI pins. A flashed PCB profile owns bus wiring and presents
it read-only.

- **TCA9554** adds eight on/off inputs or outputs. Polling always works. When at
  least one TCA9554 input is installed, its first Hardware card offers one
  optional shared open-drain INT GPIO; multiple TCA9554 input devices may share
  that pulled-up line.
- **TLA2528** adds eight analog inputs. Enter its real reference/supply voltage, valid voltage window, physical scale, and optional input filtering.
- **NAU7802** adds two bridge/load-cell channels. One chip can measure thrust and torque together when each uses a different channel; both channels share gain and sample rate.
- If a device stops responding, its saved assignments remain visible as **Disconnected**, but readings become unhealthy and unavailable.
- A disconnected device card offers **Remove device and assignments** to clear all of its channels, bindings, simple controls, and newly invalid controller/safety dependencies in one reviewed operation.

Native ESP32 GPIO is strongly recommended for fuel, ignition, starter, shutdown, and other safety-related outputs. If a TCA9554 or its bus is disconnected, the physical expander output may retain its last latch state. OpenTurbine blocks START when an engine-affecting expander output is unavailable and faults an operating engine on loss, but software cannot force a disconnected chip to change state. Use independent hardware shutdown and power isolation.

### Power and high-current outputs

An ESP32 pin is a logic signal, not a pump, starter, solenoid, relay-coil, glow-plug, or igniter power source.

```text
ESP32 output -> suitable gate/driver/ESC input -> actuator
ESP32 GND    -> driver/ESC signal ground
Load supply  -> fuse -> driver/ESC -> actuator
```

- Use a logic-level MOSFET driver, protected automotive driver, relay module with a valid 3.3 V input, or appropriate ESC.
- Fit flyback suppression across DC relay/solenoid coils unless the chosen driver already contains it.
- Keep motor and ignition current out of the ESP32 ground path. Use a deliberate grounding layout and adequate conductors.
- Verify active-high/active-low behavior with the load power disconnected first.
- Direct ignition-coil drive requires a proper current-limited switching stage. Never connect an ignition coil directly to the ESP32.

**Add mirrored output** creates another physical signal that follows the same
logical command. Use it for two separate igniters, pumps, valves, indicators,
or driver inputs that must act together; each mirror keeps its own pin, driver
type, polarity, endpoints, and current protection. It does not make two power
stages safe to wire in parallel. Parallel MOSFET/driver outputs only when the
hardware manufacturer explicitly supports current sharing; otherwise give each
load its own correctly rated driver or use one suitably rated stage.

### Servo or ESC output

```text
ESP32 configured servo/ESC output -> signal
ESP32/ECU ground                  -> signal ground
Separate suitable supply         -> servo/ESC/load power
```

Do not assume the ESC’s BEC is suitable for the ECU or that two power sources can be paralleled. Verify pulse endpoints and direction with fuel disconnected.

### Analog pressure, flame, torque, flow, or voltage sensor

For a typical three-wire analog sensor:

```text
Sensor supply -> correct regulated sensor voltage
Sensor ground -> ECU sensor ground
Sensor output -> ADC1 pin through required divider/filter/protection
```

- Confirm whether the sensor output rises or falls with the measured value.
- Confirm its output range at the ECU pin, not only at the sensor connector.
- A 5 V-powered 0.5–4.5 V pressure transducer normally needs scaling before the ESP32.
- Capture zero with the real plumbing depressurized, then calibrate against a trusted gauge/reference.
- Battery/bus measurement always needs a divider and suitable over-voltage protection.

### Potentiometer throttle or idle input

```text
Potentiometer end 1 -> 3.3 V
Potentiometer end 2 -> GND
Potentiometer wiper -> configured ADC1 pin
```

A value around 10 kΩ is commonly practical, but verify noise and current for the actual installation. Calibrate both endpoints after wiring. For an RC/servo-PWM input, use the configured digital input type instead of wiring it as analog; ensure the pulse signal is 3.3 V compatible.

### N1/N2 RPM sensor

OpenTurbine expects a clean pulse signal and the correct pulses-per-revolution value.

```text
Hall/conditioner output -> configured RPM input
Sensor ground           -> ECU ground
Sensor supply           -> voltage required by sensor
```

- The GPIO must never receive more than 3.3 V.
- An open-collector/open-drain sensor needs a pull-up to 3.3 V.
- A magnetic pickup normally needs a dedicated zero-crossing/comparator conditioner; do not connect an unbounded pickup waveform directly.
- Set pulses per revolution from the actual target geometry and verify displayed RPM with an independent tachometer before enabling overspeed protection.
- N1 and N2 are independent shafts with independent limits. Never copy an N1 limit into N2, or vice versa, unless the engine manufacturer explicitly specifies that value for that measurement point.
- Test each input from zero through its expected operating range. A plausible idle reading alone does not prove the pulses-per-revolution setting is correct.
- The default 5 µs PCNT glitch filter rejects very short electrical spikes without discarding legitimate turbine-speed pulses. Increase it only for a measured noise problem and verify the resulting maximum readable pulse frequency.
- The PCNT plausibility ceiling is automatic at twice the applicable hard N1 or N2 shutdown speed. There is no separate sensor-maximum field to keep synchronized.

### TOT/EGT or TIT thermocouple

Thermocouples connect to a supported converter module, not directly to the ESP32. On the Hardware card, choose the actual **Sensor interface**: analog temperature transmitter, MAX6675, MAX31855, or MAX31856. A turbine-gas TOT/EGT or TIT card intentionally does not offer low-temperature NTC or DS18B20 interfaces.

In development-board mode, enable **Shared SPI bus** near the top of Hardware and select SCK, MISO, and optional MOSI once. Each thermocouple card then asks only for its own CS pin. In PCB-profile mode those common pins come from the flashed board profile and are read-only.

```text
Thermocouple -> converter module
Converter CLK/MISO/(MOSI) -> configured ESP32 SPI pins
Converter CS              -> its configured chip-select pin
Converter GND             -> ECU ground
Converter supply          -> module-compatible supply
```

- Several SPI temperature modules may share CLK, MISO, and MOSI, but each requires its own CS.
- MAX31856 requires MOSI because the ECU configures and verifies the chip.
- The shared bus must be enabled before an SPI device can be added. SCK and MISO are required; MOSI becomes required when a MAX31856 is fitted. Each device's CS must remain unique.
- Match thermocouple type, polarity, connector metals, and extension wire.
- Mount the probe at the temperature station whose limit you are configuring.

### NTC or other analog temperature sensor

The built-in NTC datasheet mode assumes:

```text
3.3 V -> fixed pull-up resistor -> ADC pin -> NTC -> GND
```

Enter the real pull-up resistance, NTC R₀, and beta value. For another analog circuit or sensor curve, use four well-spaced known-temperature points on Calibration instead.

### Torque, thrust, and load-cell sensors

Torque can use an **Analog 0–3.3 V transmitter**, **TLA2528 analog channel**, **HX711 load-cell amplifier**, or a detected **NAU7802**. Thrust supports the same conditioned local/TLA2528 analog transmitters and NAU7802 bridge channels. An HX711 requires two GPIOs: DOUT is an ECU input and SCK is an ECU output.

For a NAU7802, use Calibration to capture unloaded zero and a known force/mass. Thrust is stored in newtons. Torque uses the calibrated force multiplied by the entered perpendicular lever arm in metres and is stored in newton-metres. The known-load wizard accepts N, kg mass, g, kgf, or lbf and converts them to canonical newtons. Conditioned analog transmitters use the normal linear or advanced sensor-curve calibration. Do not treat default scale or zero values as a calibration.

### DS18B20 temperature sensor

Connect VCC to the sensor’s supported supply, GND to ECU ground, and DATA to the configured pin. A typical three-wire installation uses about a 4.7 kΩ pull-up from DATA to 3.3 V. Avoid parasite-power wiring for a noisy engine installation.

The default is 10-bit resolution, which provides a much faster conversion than 12-bit while retaining adequate low/medium-temperature resolution. Higher resolutions remain selectable when slower updates are acceptable.

### Current sensor

Route the measured conductor through or across the current sensor as its manufacturer specifies. Connect the sensor’s conditioned output to an ADC1 pin and keep it within 0–3.3 V. Calibrate using zero plus a trusted current measurement, or enter datasheet zero voltage and mV/A sensitivity measured at the ECU pin.

### Start, stop, arm, and other digital inputs

Wire switches according to the configured active level. A common active-low arrangement is:

```text
Configured input -> switch -> GND
```

with a pull-up keeping the released input high. For long/noisy wiring, use suitable filtering, shielding, transient protection, and a fail-safe circuit. The physical STOP must be tested independently and should remove fuel or actuator power even if the ESP32 or software is unavailable.

## First setup

The web interface is organized in the order a new installation should normally follow:

1. **Hardware** — add only what is physically fitted, select signal types, assign pins, and resolve inventory requirements.
2. **Controllers** — choose what owns each output and configure its local tuning and safety limits.
3. **System** — configure ECU-wide runtime, communications, logging, display, and housekeeping behavior.
4. **Calibration** — calibrate inputs and find minimum reliable fuel-metering and pump outputs.
5. **Sequence** — review ordered startup, shutdown, and afterburner transitions.
6. **Tools** — test one output at a time with fuel and ignition made safe.
7. **Dashboard** — perform dry sequences before any fueled attempt.

Settings that cannot apply to the fitted hardware are hidden or ghosted in normal use. Controllers and System open in **Configured system**, showing everything that can affect the fitted turbine. **Explore all features** exposes every hardware-dependent value for advance planning: amber-bordered tuning values can be edited and saved, but remain inactive until their stated sensor, output, or controller prerequisite is configured in Hardware. Enable switches and choices that name missing hardware stay locked, so browsing or preparing values cannot arm a feature unexpectedly. **Changed** reviews pending edits; search also finds unavailable features.

## Complete first-time procedure

This is the literal path from an unopened board to a dry-tested ECU.

1. **Install the firmware.** Download the official setup tool, connect the board with a data-capable USB cable, and choose **Clean install / reinstall**. This erases the selected board, so use it only for a blank board or an intentional fresh installation. The tool detects the ESP32 target; if several connected boards are listed, choose the intended board and confirm the detected target. Choose Development board, a compatible official PCB, or a chip-matched custom PCB profile as appropriate. Wait for firmware, web files, and any selected profile to finish.
2. **Power only the ECU.** Keep every actuator/load power supply disconnected. Leave fuel and ignition energy physically isolated.
3. **Join the ECU Wi-Fi.** A fresh default installation advertises `OpenTurbine` with no password. Join it and open `http://192.168.4.1`. If you later change the profile id, the Wi-Fi name changes with it.
4. **Acknowledge the safety notice and choose a theme.** Confirm that the Dashboard loads and remains connected.
5. **Set identity and Wi-Fi security.** In System, set a recognizable engine name and an 8–63 character AP password if the ECU should not remain open. Save, let it reboot, then reconnect using the new network name/password.
6. **Configure one device at a time.** In Hardware, select the correct target, enable only fitted devices, choose electrical types, assign pins, and resolve every warning. Save and reboot.
7. **Verify the saved hardware.** Reopen Hardware after reboot and compare every pin/type with the wiring before applying actuator power.
8. **Check live inputs.** Power sensors only. Open Dashboard/Calibration and confirm plausible raw/live response. Do not enable a safety based on an uncalibrated sensor.
9. **Configure control and safety.** Review the fitted system in Controllers, using search when needed. Then review ECU-wide settings on System. Do not use example suggestions as authority.
10. **Calibrate inputs and pump minimums.** Follow the visible Calibration wizards with fuel/ignition made safe.
11. **Review sequences and simple controls.** Confirm startup/shutdown order, timing, sensor gates, abort behavior, output ownership, hysteresis, mappings, and safe inactive values.
12. **Test outputs at logic level.** With load power still isolated, confirm output polarity using a meter or test indicator.
13. **Connect and test loads individually.** Use Tools in STANDBY. Begin with short duration and conservative proportional output. Keep fuel and ignition separated until each path is proven.
14. **Test every stop path.** Verify web STOP, physical STOP, loss-of-signal behavior, and fuel shutoff. Do not continue if any stop path is ambiguous.
15. **Run complete dry sequences.** Fuel disconnected, ignition disabled where appropriate, and turbine restrained. Confirm mode/block progress and output order.
16. **Back up the engine file.** Download it from Tools and store it securely.
17. **Perform the pre-start review below.** Only then plan a controlled fueled test.

### 1. Hardware

Open **Hardware** and describe the actual installation. Do not enable a sensor or actuator merely because it appears in the list.

- Use **Installed Channel Inventory** for channels that controllers, sequences, and bindings need to reference by ID. The stable ID is the machine key; keep it short, unique, and unchanged after other features reference it. The display name is safe to edit.
- Inventory inputs can be digital, analog, pulse/frequency, or RC PWM. Digital switch roles can feed existing DI behaviors such as inhibit-start, E-stop, AB arm/fire, limp mode, sequence gate, and fault inputs. Registry-driven DI behavior currently uses the existing active-low/pull-up default unless a legacy DI channel supplies richer switch metadata.
- Inventory outputs can be relay, PWM, or servo/ESC. Relay outputs quantize at the driver boundary; PWM and servo outputs preserve the full 0-100% demand used by controllers, sequences, and Tools.
- General valves, bleed valves, purge/start-fuel valves, and air-starter actuators may use relay, PWM, or servo endpoints. The standard air-starter sequence blocks remain deliberately on/off, so a PWM/servo air-starter card moves between its configured 0% and 100% endpoints. Dedicated hard fuel-shutoff and afterburner-shutoff purposes remain relay-only.
- Repeatable outputs with the same role are allowed. For example, `Oil Pump 1` can be the main bound pump while `Oil Pump 2` is controlled by another oil-pressure controller, a simple control, Sequence, or Tools.
- The standard `AB igniter` inventory output bridges to the existing Igniter 2 / afterburner ignition path when it uses the standard `ab_igniter` or `igniter2_main` ID.
- Confirm the correct ESP32 target.
- With a flashed PCB profile, select the labelled **Connected to** port instead of a GPIO. An unavailable fixed I²C port means its chip is not responding; correct the hardware or remove the dependent channel.
- Assign each GPIO once; resolve every conflict reported by the page.
- Select the real electrical output type: relay, PWM, servo/ESC, or other offered mode.
- For output inventory channels, set boot-safe and fault-safe demand deliberately. Relay outputs still switch at the driver boundary, while PWM and servo/ESC outputs preserve proportional demand.
- Configure sensor chips and inputs exactly as wired.
- Enable safety functions only after their required sensors are fitted and calibrated.
- Save Hardware and allow the ECU to reboot.

After reboot, return to Hardware and verify that every saved device and pin is still correct.

### 2. Controllers and System

Open **Controllers**, which starts in **Configured system**. Begin from the output: confirm what controls it, the relevant mapping or target, local response tuning, and its safety overrides. Use **Explore all features** to inspect future options and **Changed** to review pending edits. Then open **System** for ECU-wide runtime, communications, logging, display, and housekeeping settings. Example suggestions are editable examples only; they are not safe values for your turbine.

Review at least:

- Maximum and minimum running shaft RPM
- Selected engine-temperature source and hard temperature limit
- Temperature warning/pullback margin
- Running oil-pressure target and low-oil shutdown threshold. Startup prime target, minimum pressure before ignition, and no-sensor pump duty are set in the Sequence blocks that use them.
- Throttle opening and closing rate
- Flameout source, EGT loss criteria, and confirmation time
- Pre-start and startup turbine-temperature limits
- Every fitted optional safety threshold

For a two-shaft engine, also review the hard N2 shutdown limit, N2 gradual-pullback points, governor target/band, any N2-based idle target, and the external-cluster N2 warning. OpenTurbine warns when those values do not leave sensible ordering below the hard trip, but the operator remains responsible for the actual margins.

If using multiple oil systems, define each oil loop with its pressure input, pump output, target pressure, deadband, and min/max demand. The first enabled loop feeds primary oil status and cooldown control; additional loops drive their own explicitly selected pumps. A target may be fixed, follow the previous final effective core-fuel demand, or map from N1/N2 shaft speed. Fuel-following deliberately uses the final protected core-fuel command from the preceding control tick, not afterburner fuel. Relay pumps use true on/off pressure hysteresis for accumulator/relief systems; PWM/servo pumps expose proportional minimum and maximum demand. Each enabled oil loop is the single normal owner of its selected pump.

`0` can mean disabled, automatic, or unlimited depending on the field. Read the description beside that specific control.

### Two-shaft N2 protection and governor setup

Treat N2 protection as a chain of separate functions, not one interchangeable RPM setting:

1. **Calibrate the N2 input.** Enter the real pulses per revolution and compare Dashboard N2 against an independent tachometer at several speeds.
2. **Enter Maximum N2 Speed.** This is the independent hard shutdown trip for the free power-turbine/output shaft. Use only an authoritative engine, gearbox, driven-load, or propeller-system limit referred to the same measurement point.
3. **Configure gradual N2 pullback if used.** `Begin N2 Throttle Reduction` should be below `Full N2 Throttle Reduction`, and both should normally be below Maximum N2 Speed. Pullback reduces fuel as the shaft approaches the limit; it is not the shutdown itself.
4. **Configure the governor if used.** The governor target plus its no-correction band must leave operating margin below Maximum N2 Speed. In fuel-control mode the governor adjusts fuel directly. In propeller-pitch mode it changes propeller load while the operator retains fuel authority.
5. **Check other N2 consumers.** An N2-based automatic-idle target and an external-cluster N2 warning should also remain below the hard trip.
6. **Enable N2 overspeed in Hardware.** Hardware owns whether the safety is armed; Config owns its RPM limit. START is blocked if the safety is enabled with no fitted N2 source or a zero hard limit.
7. **Prove the shutdown path without fuel.** Drive or simulate N2 first below and then above the configured trip. Verify the ECU enters shutdown/fault and physically removes fuel, ignition, and relevant actuator demand.

The Dashboard N2 gauge uses the hard shutdown limit. `OFF` means the hard N2 safety is not active; it does not mean the governor or gradual pullback is disabled. The Event Log records an N2 over-speed fault separately from N1 overspeed.

### Controller and limiter behavior

- **Throttle slew** limits how quickly effective fuel/throttle demand can rise or fall. Verify both directions with the turbine unfueled. Emergency shutdown bypasses normal gradual movement and commands the safe state immediately.
- **N1, N2, EGT, P1, P2, and torque protection** is presented as one expandable card per measurement under Controllers → Engine Limits & Protection. Each card keeps gradual fuel reduction beside its independent hard shutdown. The soft point begins intervention. At the full point, strength 1.0 reaches the configured Minimum Fuel During Gradual Protection; lower strength is gentler and greater than 1 reaches the floor sooner. When several are active, the lowest permitted fuel ceiling wins. Gradual reduction lowers the fuel ceiling; it never replaces the hard shutdown.
- **Predictive limit protection** projects N1/N2 speed, P1/P2 pressure, selected TOT/TIT, and torque from their measured rise rates, then begins a gentler approach before the current reading reaches the soft point. Start with reactive/simple behavior unless predictive tuning has been validated on the engine.
- **Sensor timing** is tied to real samples rather than Dashboard/control-loop refreshes. Shaft pulse inputs average over a longer window at low pulse rates and automatically publish faster as speed rises. Pressure, torque, and temperature rates update only when their driver reports a new measurement, so increasing the web refresh rate does not change controller behavior.
- **Automatic Idle Control** trims fuel near idle using one selected N1, N2, P1, or P2 source. N1/N2 speed control is the normal proven approach; P1/P2 control is explicitly experimental. RPM and pressure sources have separate target, deadband, and disengagement values. Verify the selected sensor is calibrated and that disconnecting it enters reduced-power mode without a fuel increase.
- **Automatic N2 speed control** uses proportional fuel, proportional propeller pitch, or deliberate fine/coarse relay pitch. Start response gains low, verify correction direction with a simulated speed error, and increase gains only while watching for hunting.
- **Oil-pressure control** adjusts each explicitly selected pump to its configured fixed, effective-fuel, N1, or N2 pressure target. Its target must remain above the low-pressure shutdown threshold. A relay pump switches fully off/on around its target and deadband; use that only with plumbing designed for two-position pressure control. Sensor failure uses the configured delay and fallback demand; validate that fallback physically.
- **Reduced-power mode** caps throttle after its configured input, an eligible feedback failure, or an explicit standby/tool request activates it. Treat it as a degraded-operation feature, not a substitute for stopping after a mechanical or lubrication fault.
- **Pulsed Starter Assist** repeatedly applies and releases proportional starter output during `StarterSpin` while healthy N1 remains below its configured threshold. These torque impulses can help Bendix drives and splined couplings engage; once the threshold is reached, normal ramped starter control continues. It needs no runtime arming, never operates in RUNNING, and cancels for that startup attempt if N1 becomes unhealthy. With load power isolated, use the short STANDBY-only Tools test to verify direction and output before a live start.
- **Windmilling oil protection** can run the oil pump in STANDBY while N1 or N2 remains above its threshold. A zero pressure target uses the configured fixed pump output. A nonzero target uses the normal oil-pressure controller, with that pump output as its minimum floor. Verify the selected shaft, mode, and that the pump releases after rotation stops.

### Flameout detection and relight

Flameout can use a flame input, N1 underspeed, or the selected EGT source. EGT declares possible combustion loss when temperature is below the configured threshold and falling, or when it falls faster than the configured rate; the confirmation time must still expire. Select evidence that can distinguish actual combustion loss from a normal throttle reduction. A dedicated flame sensor is preferred where practical.

Automatic relight always requires healthy N1 feedback to prove adequate windmilling airflow and requires the selected ignition output to be fitted. Configure an explicit **Minimum N1 for Relight**: the ECU never fires automatic relight below this speed or below **Minimum Running N1**, whichever is higher, regardless of whether flame, N1, or EGT triggered flameout. A normal combustor typically recovers within 1–2 seconds, which is why the default timeout is 2,000 ms; increase it only from verified engine evidence. Configure the attempt count, timeout, and explicit flame/N1/EGT recovery evidence separately. A failed relight proceeds to shutdown. Test relight only on a controlled stand with explicit abort criteria; repeated fuel without ignition can create an explosive accumulation.

The hot-engine interlock checks selected TOT/TIT before START and refuses to begin if it is above **Pre-start EGT Limit**. Once STARTUP begins, the overtemperature guard uses **Startup EGT Limit**; zero makes it inherit the normal selected TOT/TIT hard limit. RUNNING always uses the normal continuous hard limit. This allows a defensible startup allowance without weakening continuous protection. An instantaneous positive EGT-rise rule is intentionally not used because normal light-off produces a rapid rise.

Manual relight and cooldown override are operator tools. They remain subject to fitted-hardware and mode gates but require the same fuel-vapor precautions as a normal start.

### Afterburner installations

Afterburner support is shown only when the corresponding fuel and ignition hardware is fitted. Review the trigger source, arm requirement, ignition method, flame/EGT confirmation, pump range, main-fuel offset, stabilization time, and shutdown order.

The dedicated AB command may be a native analog/RC input or an addressable registry/I2C input. Both use the same normalized command, disconnect guard, Control Rule source, sequence-condition source, and shared RC/PWM signal-loss timeout. If an arm input is required, it remains continuous permission after firing; removing permission starts the configured AB shutdown sequence.

- AB arm is permission, not a fire command.
- A selected request may remain in **Arming** while minimum N1, maximum light-off EGT, throttle, or pre-fuel flame/EGT evidence is not ready. Those are waiting conditions, not failed ignition attempts. Once AB fuel/ignition actually starts, a sequence fault latches until the request is released before retrying.
- Confirm the AB valve and pump close immediately on STOP or fault.
- Use flame confirmation or a defensible EGT-rise method where possible.
- A custom AB ignition sequence must include the explicit confirmation block; select sensor, EGT rise, or the clearly labelled unverified timed mode.
- In flame-sensor mode, loss of the running AB flame for the configured delay (default 1,000 ms) closes AB fuel only. The main engine remains RUNNING.
- A zero stabilization EGT cap disables that protection.
- Test the complete AB shutdown sequence without fuel before any light attempt.

### Dashboard, health indications, and logs

Dashboard health dots show whether fitted sensors are currently usable; a plausible retained number with a red/failed health indication must not be trusted. N1 and N2 gauges show their hard limits, while temperature and oil gauges use their applicable configured thresholds. Optional P1, P2, fuel pressure, fuel flow, torque, oil temperature, battery, current, and shaft-power cards appear only when their sources are fitted.

After a run, the summary reports available duration, peaks, and the minimum healthy oil pressure measured while RUNNING. Use **Log** to review Event Log fault/configuration records and configure Session Data. CSV row interval, event-snapshot interval, standby snapshots, and all session channel selection—including P1/P2, torque and calculated shaft power, and starter demand—are owned by this page. During engine operation, the newest 64 session rows are retained in RAM and written to flash only after STANDBY/FAULT; if that buffer fills, older rows are dropped so the shutdown/fault tail is preserved. Choose an interval that covers the part of the run you need, and export important evidence before factory reset or a clean installation.

### 3. Calibration

For ordinary analog sensors, start with the visible two-point wizard or the sensor's linear voltage/current specification. This covers the common 0.5–4.5 V and 4–20 mA pressure, flow, temperature-transmitter, torque, and voltage inputs. If a resistive sender or its datasheet is not linear, open that input's **Advanced sensor curve** on Hardware and enter 2–6 measured or manufacturer points. ADC values must increase; physical values may consistently rise or fall. The ECU interpolates between points and clamps beyond the two endpoints, avoiding polynomial overshoot. A curve is optional and replaces the linear offset/scale only for that channel.

NTC thermistors normally use their dedicated resistance/beta model. If an automotive or manufacturer-specific NTC is supplied only as a temperature table, its Hardware card may instead use the same raw-ADC-to-temperature curve while retaining the dedicated NTC wiring setup. Thermocouple interfaces, pulse/frequency sensors, HX711/NAU7802 load cells, and digital probes keep their dedicated calibration models. Always compare the finished reading against an independent reference at several points before enabling a protection or controller that depends on it. Local ADC and TLA2528 I²C ADC channels use the same saved calibration behavior.

Calibrate only while the engine is in STANDBY/FAULT and the installation is made safe.

- **Fuel pump minimum:** run the slow sweep, stop when the pump first turns, fine-adjust, and verify several reliable restarts before saving.
- **Oil pressure:** capture the correct ambient zero reference, then use physical gauge points, automatic fitting, an explicit straight/curved fit, or sensor sensitivity in mV/bar.
- **Oil pump minimum:** sweep upward slowly and stop when the pump or pressure response begins.
- **Throttle and idle inputs:** hold each endpoint during the one-second capture. The ECU adds a small endpoint margin.
- **Flame sensor:** direct digital detectors need only the correct active-high/active-low choice. ADC detectors use active-above/below, a threshold, and hysteresis. Capture the no-flame noise floor with the igniter operating, keep the threshold close enough to detect weak light-off flame, and use only enough hysteresis to prevent noise chatter. The last-run average is reference information, not an automatic threshold.
- **ADC-backed switches:** capture the normal inactive state and the active state. Calibration calculates polarity, a midpoint threshold, and a noise-aware hysteresis; review the result, then save. Hysteresis is required to prevent vibration or electrical ripple near the threshold from rapidly changing the logical state. Direct digital switches do not use these fields.
- **Temperature:** use NTC datasheet values or four well-spaced known temperature points.
- **Current sensors:** use captured zero/reference current or datasheet zero voltage and mV/A sensitivity at the ECU ADC pin.
- **Oil flow meters:** calibrate main and scavenge meters separately in L/min. Enable monitoring on the matching pump Hardware card and set that pump's own minimum flow.

Never calibrate pressure or flow using an unverified web reading as its own reference.

### 4. Startup and shutdown sequence

Open **Sequence** and read every block in order. A block being available does not mean it belongs in your engine.

Confirm that:

- Oil flow/pressure is established before ignition when required.
- The starter or air source reaches the required ignition speed.
- Ignition is active before fuel is introduced.
- Fuel begins at a deliberately conservative value.
- Light-off is confirmed by a fitted, calibrated source or an explicitly accepted timed method.
- The engine reaches self-sustaining speed without losing lubrication.
- Any configured Pressure 1/Pressure 2 startup evidence is established before ignition, rises after light-off, and remains stable before RUNNING.
- **Final Startup Checks** enables only the installed N1/N2/P1/P2/oil/EGT/flame evidence your installation requires. Every enabled check must remain valid for the full stable time; starter state is not sensor evidence.
- STOP closes fuel immediately.
- Shutdown keeps oil/scavenge/cooling outputs active for as long as the engine requires.
- Electric drain valves can use explicit Open/Close blocks. Output inversion and physical endpoints remain Hardware settings.

Use dry runs with fuel physically disconnected before a fueled test.

The editor also supports entry conditions, per-step enter/exit side actions, afterburner sequences, and bounded custom blocks. A custom condition can require continuous stability or measure its threshold relative to the reading at block entry. The three compressor-pressure buttons create guided versions of those checks; place them deliberately around ignition and light-off. Red structural errors block START; yellow warnings describe arrangements that may be intentional but require review. Never use Bench Mode to make an invalid real-engine sequence appear acceptable.

### 5. Custom controllers

Open **Controllers → Custom controllers** when a fitted output needs behavior not covered by a common turbine controller. Any fitted sensor, switch, or operator input can switch an unowned compatible output at a threshold with hysteresis, map an input range to a variable output, or hold a feedback target. Feedback targets may be fixed, selected by a switch, or mapped from another variable input.

- RUNNING is the default. Advanced builds may select STANDBY, STARTUP, RUNNING, and/or SHUTDOWN for each custom controller. Outside the selected states, Sequence or the previous ordinary owner resumes control. Custom controllers are always released in FAULT.
- Hysteresis prevents rapid switching near a threshold. For “above 100 °C” with 5 °C hysteresis, the output turns on above 100 °C and stays on until the input falls to 95 °C.
- Mapping clamps below/above its input limits and is useful for testing proportional outputs from a potentiometer.
- Keep one enabled normal controller per output. The UI will not offer an output already owned by an enabled dedicated controller. STOP, shutdown, and Hardware fault-safe behavior remain authoritative.
- A drain valve is an ordinary fitted output here, so it may also follow a switch or sensor controller instead of a sequence block.
- Feedback control inherits the exact pre-handover output on its first tick. Begin with gentle response values and verify direction, loss behavior, and stability on a safe bench setup before connecting a live process.
- Give registry channels stable IDs before controls reference them. Removing a referenced source or target also removes or disables the dependent control rather than leaving an orphaned owner.
- After saving, test minimum, midpoint, maximum, mode exit, sensor loss, reboot persistence, and physical output direction.

Add each main or scavenge flow meter inside its pump's **Flow sensing &
monitoring** subcard in Hardware; it is not a separate top-level input card.
Select its pulse, analog, or supported I²C signal there and enter its
pulses-per-litre or analog calibration. Oil-flow monitoring warns when a
commanded pump remains below its Hardware threshold. It does not shut the
engine down by default. Enable
**Controllers → Shutdown on Confirmed Low Oil Flow** only after both the meter and
threshold have been tested; the shared confirmation delay is configured beside
that option.

### 6. Bench-test outputs

Open **Tools** in STANDBY. The page shows only tests whose hardware is fitted. Use **Test settings** or the gear button on a test card to edit duration and proportional output.

Test outputs individually:

1. Fuel shutoff direction with no fuel pressure
2. Oil and scavenge pumps
3. Starter enable and starter direction
4. Igniter with fuel absent and vapors cleared
5. Throttle/fuel actuator direction and travel
6. Cooling fans, bleed valves, auxiliary pumps, and other accessories

The browser is not the emergency stop. Verify the independent physical stop before continuing.

Developer Mode exposes diagnostics and allows Bench Mode. While RUNNING, it permits live saves only for the small set of physically adaptable controller tuning fields identified as **Applies live** (throttle ramps, governor tuning, and automatic-idle tuning). Hardware assignments, calibration, modes, sensor sources, safety structure, and sequences stay read-only and must be saved outside RUNNING. This avoids a mixed old/new controller configuration. Bench Mode bypasses safety shutdowns and sensor waits for dry testing; it must never be enabled for a fueled or mechanically powered engine. `Skip safety checks` is similarly a development-only control, not an operating mode.

## Pre-start review

Before every first fueled run or major configuration change:

- Back up the full engine file from Tools.
- Confirm Hardware has no pin or dependency errors.
- Confirm every safety-critical sensor is healthy and calibrated.
- Compare Config limits against authoritative engine and sensor information.
- On two-shaft engines, confirm N2 pullback, governor band, N2-based idle, and display warning all leave margin below the hard N2 trip.
- Run the startup sequence dry.
- Confirm STOP cuts every fuel path from web, physical input, and any external controller.
- Confirm loss of browser/Wi-Fi cannot leave a manual test running indefinitely.
- Inspect fuel and oil plumbing for correct routing, restraint, leaks, and heat protection.
- Clear the exclusion zone and prepare fire suppression.

For a first light, use conservative fuel, short attempts, immediate abort criteria, and a second person where possible.

## Updating, backup, and recovery

### Back up

In **Tools**, download the full engine file before an update. It contains hardware, settings, sequences, calibration, and the ECU Wi-Fi AP password. Treat it as sensitive.

### Update

Use **OpenTurbine Setup Tool → Update and keep my setup** for normal Wi-Fi updates. It backs up the engine settings and does not perform a factory reset. Use **Clean install / reinstall** for a blank board, corrupted installation, intentional clean start, or partition-table change; that USB path erases everything on the selected board.

Classic ESP32 v2.0.1 and later rebalance the clean-install partition table to leave more
room for firmware updates. Existing boards may update over Wi-Fi because the
image still fits the earlier slots, but only a USB clean install applies the new
table. The Setup Tool cannot preserve settings or logs across that erase, so
download them first.

Do not interrupt power during firmware or web-asset installation.

After an update, reconnect to the ECU, verify the displayed firmware version, open every main page once, confirm the hardware/profile identity still matches, and repeat a dry STOP/output-safety check before introducing fuel. A normal update preserves configuration; it cannot prove that an old configuration is safe for newly added features.

### Recovery

- If the ECU Wi-Fi appears but pages fail, reinstall/update the web assets.
- If the board does not appear over USB, try a data cable, another USB port, the official driver page opened by the setup tool, and the board’s BOOT/RESET procedure.
- If a configuration error puts the ECU in FAULT, the web interface remains available for repair.
- If a restored engine file is rejected, verify that it is a complete matching OpenTurbine `ecu_config.json`, not only one section.
- Factory reset erases hardware, settings, calibration, and logs. Back up first.

## Troubleshooting index

Use Ctrl+F for the symptom or keyword.

| Symptom | Checks |
|---|---|
| Download says Not Found | No GitHub release with the required asset exists yet. Use only the official Releases page. |
| Windows blocked installer / SmartScreen | Verify the official URL, then use Downloads → Keep or SmartScreen → More info → Run anyway. |
| No COM port / board not detected | Data cable, direct USB port, setup-tool-selected CP210x/WCH driver, reconnect only when prompted, close serial monitors. |
| Upload cannot connect / bootloader timeout | Hold BOOT, tap EN/RESET, start upload, release BOOT when connection begins. |
| OpenTurbine Wi-Fi missing | Confirm successful firmware boot and power; reinstall over USB; check serial output if developing. |
| Wi-Fi connects but page does not open | Browse directly to `http://192.168.4.1`; disable mobile-data/VPN captive routing temporarily; reinstall web assets if necessary. |
| Page reports disconnected | Stay on the ECU Wi-Fi, reload once, check ECU power/noise, and verify another client is not overwhelming the AP. |
| Hardware save rejected | Return to STANDBY/FAULT; resolve missing pins, conflicts, unsupported types, and dependent safety/controller settings. |
| Controller or System field hidden | Start in Configured system; use Explore all features for inactive future settings; confirm prerequisite hardware is fitted. |
| Calibration command rejected | ECU must be STANDBY/FAULT, required hardware must be fitted, and no other actuator test may be active. |
| Sensor reads zero/full-scale/fault | Verify supply, common ground, signal voltage, selected pin/type, ADC1 use, divider, polarity, and calibration. |
| RPM is wrong | Verify pulse conditioning, 3.3 V level, pulses per revolution, target geometry, and independent tachometer reading. |
| N2 gauge says OFF | Hard N2 overspeed shutdown is not active. Verify the N2 channel and limit, then enable N2 overspeed in Hardware if the engine requires it. Governor and pullback settings are separate. |
| N2 configuration warning | Put pullback points, governor target/band, N2 idle target, and display warning below the authoritative hard N2 trip with suitable operating margin. |
| Temperature is wrong | Verify converter chip, thermocouple type/polarity/location, shared SPI wiring, unique CS, and cold-junction/module supply. |
| Pump/servo moves backward | Remove fuel/load, correct active level or servo/PWM endpoints/direction, then repeat Tools testing. |
| Engine enters FAULT at boot | Read the visible fault/config warning; Hardware, Config, Calibration, Tools, and restore remain available for repair. |
| Full engine restore rejected | Use the complete matching `ecu_config.json`; do not cross hardware/settings sections from different profiles. |
| Wi-Fi password forgotten | Recover over USB and restore/reset configuration. Factory reset removes all settings and calibration. |

Use exactly one active browser tab for the ECU panel. This applies to both
Classic ESP32 and ESP32-S3 targets. Close the old tab before opening the panel
in another tab, window, browser, phone, or computer. The control loop remains
independent of the web interface, but simultaneous dashboard clients can
exhaust the ESP32 network service and require an ECU reset.

## External display or custom controller

OpenTurbine provides the **OpenTurbine Cluster (OTC)** serial protocol for embedded displays and companion devices.

- [Start building a cluster or companion device](../examples/cluster/README.md)
- [Single-file Arduino/ESP32 client](../examples/OTCClusterClient.h)
- [Complete OTC wire protocol](OTC_CLUSTER_PROTOCOL.md)

OTC supports TX-only telemetry or optional two-way commands/subscriptions. Normal ECU safety and mode gates still apply to commands received over OTC.

## Support and reporting problems

Use the repository’s [Issues page](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/issues) for reproducible problems. Include:

- Firmware version and ESP32 target
- What hardware is actually fitted
- The exact operating mode and sequence block
- Expected and observed behavior
- Relevant Event Log or Session Data
- A sanitized engine file when safe to share—remove the Wi-Fi password first

Do not publish secrets, personal network information, or an unreviewed engine file.

## Developers and beta testers

Most users can stop reading here. Source layout, manual builds, release packaging, validation tools, internal plans, and beta reporting are indexed in [Developer and beta documentation](README.md).

Quick developer build:

```bash
git clone https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU.git
cd OpenTurbine
pio run -e esp32dev
pio run -e esp32s3dev
```

Editable split web sources live in `data_src/pages/` plus the remaining
top-level files in `data_src/`. Run `python tools/build_web_sources.py` first,
then `python tools/gzip_data.py` to produce deterministic LittleFS assets in
`data/`. The complete local release gate is `python tools/run_release_checks.py`.

## License

OpenTurbine is released under the [MIT License](../LICENSE).
