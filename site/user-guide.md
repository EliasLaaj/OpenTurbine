---
layout: document
title: OpenTurbine 2.0 complete beginner user guide
description: A source-matched, step-by-step guide to building, wiring, configuring, calibrating, dry-testing and operating an OpenTurbine ESP32 turbine ECU.
lede: Start with no electronics experience; finish with a wired, configured and thoroughly dry-tested ECU.
---

{% include safety-note.html %}

OpenTurbine is an experimental controller for turbine test projects. This guide explains the whole supported path, including what the words mean, what connects where, and what every current Config field does. It does **not** make an unknown turbine, sensor, driver, fuel system or ignition system safe. Obtain the manuals and limits for the exact parts you use, and have a competent person inspect the wiring before any fuel or ignition test.

Keep fuel disconnected, ignition energy disabled, starter/load power isolated, and the turbine unable to move while completing Parts 1–10. A browser STOP button is not an emergency stop.

<a id="guide-contents"></a>
## Contents

1. [Words used in this guide](#part-1-words-used-in-this-guide)
2. [What you need](#part-2-what-you-need)
3. [How the system is connected](#part-3-how-the-system-is-connected)
4. [Wire the ECU power and emergency stop](#part-4-wire-the-ecu-power-and-emergency-stop)
5. [Wire inputs and sensors](#part-5-wire-inputs-and-sensors)
6. [Wire outputs and actuators](#part-6-wire-outputs-and-actuators)
7. [Install OpenTurbine and connect](#part-7-install-openturbine-and-connect)
8. [Describe the hardware in the dashboard](#part-8-describe-the-hardware-in-the-dashboard)
9. [Understand controllers and safety functions](#part-9-understand-controllers-and-safety-functions)
10. [Configure Controllers and System](#part-10-configure-controllers-and-system)
11. [Calibrate inputs and outputs](#part-11-calibrate-inputs-and-outputs)
12. [Build startup and shutdown sequences](#part-12-build-startup-and-shutdown-sequences)
13. [Use custom controllers](#part-13-use-custom-controllers)
14. [Dry-test the complete ECU](#part-14-dry-test-the-complete-ecu)
15. [Prepare for a first fueled test](#part-15-prepare-for-a-first-fueled-test)
16. [Operate, back up, update and diagnose](#part-16-operate-back-up-update-and-diagnose)

## Part 1: Words used in this guide

You only need these basic ideas to begin:

- **ECU** means electronic control unit. Here it is the ESP32 board running OpenTurbine.
- **GPIO** means a numbered electrical pin on the ESP32. The Hardware page only offers pins valid for the selected board.
- **Input** is information entering the ECU: temperature, RPM, pressure, a switch, or a throttle command.
- **Output** is a low-power command leaving the ECU. It tells a separate driver, relay, ESC or servo what to do.
- **Sensor** measures something. Its raw electrical signal often needs a converter or conditioner before the ESP32 can read it.
- **Actuator** does something physical: a pump, starter, valve, igniter, fan or servo.
- **Driver** has two meanings in this guide. An electrical output driver carries load current; a USB driver lets Windows communicate with the ESP32.
- **N1** is the gas-generator/core shaft speed. **N2** is a separate free power-turbine/output shaft speed where fitted.
- **TOT/EGT** is turbine-outlet/exhaust gas temperature. **TIT** is turbine-inlet temperature. Use the measurement and limit specified by the engine documentation.
- **ADC** converts a safe analog voltage into a number. The ESP32 ADC pin must never receive more than its permitted voltage.
- **PWM** is rapid on/off switching used to request a proportional output. A servo/ESC signal is a different pulse format and must be selected as such.
- **Active LOW** means the function is active when the signal is connected to ground. **Active HIGH** means active when voltage is present.
- **Pull-up** gently holds an unconnected digital input HIGH. A switch can then connect it to ground to make it active LOW.
- **Closed loop** means the ECU measures the result and adjusts an output to reach a target. Open loop sends a fixed output without measuring the result.
- **Fail-safe** is the state selected for a missing signal or software fault. **Independent emergency stop** is separate hardware that removes hazardous energy even if the ECU has failed.

## Part 2: What you need

### Required for the normal supported path

- A Classic ESP32 board with at least 4 MB flash, or an ESP32-S3 DevKitC-1-compatible board with at least 8 MB flash. The universal S3 image works on 8 MB and 16 MB modules without requiring PSRAM.
- A Windows computer and a USB **data** cable. A charge-only cable will power the board but cannot install firmware.
- A clean regulated ECU power supply within the board maker's limits, with a fuse.
- A multimeter and the datasheets for the board, every sensor, every converter and every output driver.
- Correct connectors, wire sizes, strain relief, enclosure, fuses and transient protection for the environment.
- A hardwired emergency-stop circuit that removes fuel or relevant load power independently of the ESP32.

### Add only what the engine actually needs

Common minimum instrumentation is N1 speed plus TOT or TIT. Oil-lubricated systems commonly add oil pressure. The firmware supports many more inputs and outputs, but fitting every possible item does not automatically make a better system. Every added part creates another wiring, calibration and failure path.

Do not use solderless breadboards for a fueled or vibrating turbine installation. They are useful only for low-energy bench learning.

## Part 3: How the system is connected

Click or tap the diagram to enlarge it.

<figure>
  <img class="system-diagram" src="{{ '/assets/images/ecu-wiring-overview.svg' | relative_url }}" width="1400" height="920" alt="OpenTurbine wiring overview showing conditioned sensor inputs, ESP32 ECU, protected output drivers, separate fused load power and independent emergency stop">
  <figcaption>The Hardware page chooses the GPIO numbers. This diagram shows the electrical pattern: condition inputs, use drivers for outputs, separate load power, and provide a hardwired stop.</figcaption>
</figure>

There are four paths to keep separate:

1. **ECU power:** supply → fuse → regulator → ESP32 VIN and GND.
2. **Sensor signals:** sensor → required conditioner/converter → selected ESP32 input GPIO.
3. **Output signals:** selected ESP32 output GPIO → driver/ESC/relay input. The GPIO carries only a command.
4. **Load power:** separately fused supply → emergency-stop/contact path where required → driver → pump, valve, starter or ignition load.

Use a deliberate star-ground or similarly engineered return scheme. Starter, pump and ignition current must not flow through the sensor ground path. If an interface is intentionally isolated, follow its isolation design and do not add a ground that defeats it.

## Part 4: Wire the ECU power and emergency stop

### 4.1 Build the power path

1. Read the exact ESP32 board's VIN/5V and 3V3 limits. Do not guess from another board.
2. With power off, connect the regulated supply positive through an appropriately rated fuse to the board input specified by its manufacturer.
3. Connect the supply negative to the planned ECU ground point.
4. Leave every sensor, driver and load disconnected.
5. Set a current-limited bench supply conservatively, power the board, and measure its input and 3.3 V rail.
6. Remove power before adding each new circuit.

Never feed external voltage into an unpowered ESP32 GPIO. It can back-power and damage the board.

### 4.2 Build the independent stop

The emergency stop must directly remove the energy that can keep fuel flowing or a hazardous load operating. A common pattern uses a normally closed fuel valve or a power contactor whose coil circuit passes through a latching emergency-stop button. The exact components and ratings depend on the system.

Test these cases without fuel:

- stop pressed while the ECU is running normally;
- ESP32 unplugged or frozen;
- Wi-Fi and browser unavailable;
- output driver signal wire shorted or disconnected; and
- power restored after a stop.

The safe result must not depend on code executing.

<p class="guide-return"><a href="#guide-contents">Back to contents</a></p>

## Part 5: Wire inputs and sensors

### 5.1 The rule for every input

Before connecting a signal to the ESP32, answer all five questions from its datasheet:

1. What powers the sensor?
2. What is the lowest and highest possible output, including a fault?
3. Is it digital, analog voltage, pulse/frequency, RC PWM, SPI, 1-Wire, I²C or a load-cell bridge?
4. Does it need a divider, pull-up, filter, comparator, isolator or converter?
5. Which ground/reference must be shared?

Measure the conditioned output before attaching it to the GPIO. ESP32 GPIO uses 3.3 V logic and is not 5 V tolerant.

### 5.2 Typical wiring by electrical type

Click or tap this diagram to enlarge it. These four drawings show the exact meaning of power, ground and signal; replace the generic GPIO label with the pin you saved on the Hardware page.

<figure>
  <img class="system-diagram" src="{{ '/assets/images/sensor-switch-wiring.svg' | relative_url }}" width="1400" height="1040" alt="Four basic OpenTurbine wiring diagrams showing a three-wire 3.3 volt sensor, a 5 volt analog sensor through a divider, an open-collector pulse sensor with a pull-up, and an active-low command switch">
  <figcaption>Basic input wiring. Red is power, grey is ground and blue is signal. Confirm every voltage from the actual component datasheet before connecting the ESP32.</figcaption>
</figure>

<div class="table-wrap"><table>
<thead><tr><th>Electrical type selected in Hardware</th><th>Connection pattern</th><th>Important fields</th></tr></thead>
<tbody>
<tr><td>Digital switch</td><td>For the usual active-LOW arrangement: selected GPIO → switch → sensor ground; enable a pull-up. The input reads active when the switch closes.</td><td>GPIO, active polarity, input bias. Use an external resistor and protection for long/noisy wires.</td></tr>
<tr><td>Analog voltage / ADC</td><td>Sensor output → protection/filter and, if needed, voltage divider → ADC-capable GPIO. Sensor ground returns to the sensor reference point.</td><td>GPIO, minimum/maximum raw ADC counts, mapped engineering range. Calibrate with a trusted reference.</td></tr>
<tr><td>Pulse/frequency</td><td>Open-collector sensor: pull up to 3.3 V. Magnetic/variable-reluctance pickup: use a proper conditioner/comparator. Conditioner output → GPIO.</td><td>GPIO, pulses per revolution/litre/unit, frequency or engineering endpoints. Shaft-speed PCNT inputs default to a 5 µs glitch filter and derive their plausibility ceiling from twice the applicable hard shutdown speed.</td></tr>
<tr><td>RC PWM</td><td>Receiver signal must be 3.3 V compatible; receiver and ECU need a valid reference unless isolated. Do not power a receiver from an unsuitable pin.</td><td>GPIO, minimum/maximum pulse width, signal-loss timeout, calibrated command endpoints.</td></tr>
<tr><td>PWM duty input</td><td>Condition the external PWM to 3.3 V logic, then connect to the selected input GPIO.</td><td>GPIO and mapped endpoints. This reads duty/frequency; it is not a servo pulse unless RC PWM is selected.</td></tr>
<tr><td>MAX31855 / MAX31856 / MAX6675</td><td>Thermocouple → matching converter terminals; converter VCC/GND → permitted supply/reference. Enable the shared SPI bus and choose SCK/MISO once; MAX31856 also needs shared MOSI. Each module needs its own CS GPIO.</td><td>Shared bus pins at the top of Hardware; interface type, unique CS, thermocouple type and polarity on the device card.</td></tr>
<tr><td>DS18B20</td><td>VDD and GND as specified; DQ → selected GPIO with the required pull-up to the correct logic supply.</td><td>GPIO, discovered sensor/address behavior and resolution. The 10-bit default updates substantially faster than 12-bit. Keep the bus away from ignition noise.</td></tr>
<tr><td>NTC thermistor</td><td>Thermistor plus a known resistor form a voltage divider; divider midpoint → ADC GPIO.</td><td>GPIO, nominal resistance, beta/coefficient and calibration. Divider values must keep the pin safe.</td></tr>
<tr><td>HX711</td><td>Load cell/bridge → HX711 inputs; HX711 data and clock → their selected GPIOs; power and grounding follow the module/load-cell specifications.</td><td>Data/clock pins, zero and scale calibration.</td></tr>
<tr><td>TCA9554 / TLA2528 / NAU7802 I²C</td><td>Connect every device to the configured shared SDA/SCL bus with suitable pull-ups and 3.3 V-compatible levels. The Hardware page discovers responding chips automatically.</td><td>Only connected devices can receive new assignments. TCA9554 provides binary I/O, TLA2528 analog inputs, and NAU7802 thrust/torque load-cell channels.</td></tr>
</tbody></table></div>

Classic ESP32 note: use ADC1 GPIO 32–39 while Wi-Fi is active. GPIO 34–39 are input-only. ADC2 readings are unreliable while Wi-Fi is operating. On ESP32-S3, use only choices offered for that selected target; native USB and flash/PSRAM pins are not spare pins.

If an I²C chip is unplugged, its channels become unhealthy and its saved assignments are shown as **Disconnected**. Use **Remove device and assignments** to clear all channels and dependencies belonging to a permanently removed chip. Native ESP32 GPIO remains strongly recommended for turbine fuel, ignition, starter, and shutdown outputs because a disconnected TCA9554 can physically retain its last output latch.

### 5.3 Every available input purpose

The **Purpose** field tells the firmware how an installed channel may be used. The current code offers these purposes:

<div class="table-wrap"><table>
<thead><tr><th>Input purpose</th><th>What it does and how to use it</th></tr></thead>
<tbody>
<tr><td>N1 speed</td><td>Primary core-shaft RPM. Used by startup checks, overspeed, flameout/surge logic, idle control, windmilling protection and logs. Wire only a clean conditioned pulse and set pulses/revolution.</td></tr>
<tr><td>N2 speed</td><td>Free power-turbine/output-shaft RPM. Enables N2 overspeed, N2 idle feedback, shaft power and the N2 governor.</td></tr>
<tr><td>Additional shaft speed</td><td>Extra speed channel for simple controls, custom sequencing and logs. It does not replace the primary N1 or N2 purpose.</td></tr>
<tr><td>TOT / EGT</td><td>Turbine-outlet temperature, normally through a supported thermocouple converter. Can be the primary engine-temperature safety source.</td></tr>
<tr><td>TIT</td><td>Turbine-inlet temperature. Use when the engine documentation specifies a TIT limit; never substitute a TOT limit.</td></tr>
<tr><td>Oil pressure</td><td>Feedback for oil protection and optional closed-loop oil-pump control. Wire and calibrate the exact transducer range.</td></tr>
<tr><td>Fuel pressure</td><td>Fuel-manifold feedback for diagnostics and optional low-pressure shutdown.</td></tr>
<tr><td>P1 / P2 / coolant pressure</td><td>Compressor inlet, compressor discharge and cooling-system measurements used for display, logging, controllers and calculated behavior where supported.</td></tr>
<tr><td>Oil, coolant or intake temperature</td><td>Auxiliary temperature channels. Oil temperature can enable its dedicated shutdown; others are available to logging and automation.</td></tr>
<tr><td>Fuel flow</td><td>Pulse or analog flow measurement for consumption logs and supported controls. Enter the manufacturer's pulses/litre or calibrated mapping.</td></tr>
<tr><td>Main / scavenge oil flow</td><td>Separate flow feedback for the corresponding pump. Calibrate in L/min, enable monitoring on that pump's Hardware card, and test its minimum-flow threshold. Confirmed underflow warns by default; shutdown is a separate Config choice.</td></tr>
<tr><td>Main flame / afterburner flame</td><td>Dedicated combustion detectors. Main flame can confirm startup/flameout; AB flame can confirm afterburner light-off.</td></tr>
<tr><td>Torque</td><td>Analog, HX711, or NAU7802 measurement. NAU7802 calibration captures unloaded zero plus known force and lever arm. With N2 it supports shaft-power calculation; it is also available to controllers.</td></tr>
<tr><td>Thrust</td><td>Conditioned local/TLA2528 analog transmitter or NAU7802 load-cell measurement. Analog inputs use linear or multi-point calibration; NAU7802 uses unloaded zero plus a known force or mass. Canonical display, telemetry, controllers and logs use newtons.</td></tr>
<tr><td>Battery / bus voltage</td><td>Scaled ADC measurement for display, logs and undervoltage protection. A battery must never connect directly to an ADC pin.</td></tr>
<tr><td>Throttle input</td><td>Operator demand from analog, RC PWM, pulse-duty or another supported input. Calibrate low/high endpoints and signal-loss behavior.</td></tr>
<tr><td>Idle input</td><td>Separate idle/startup demand, usable as digital, analog, RC PWM, pulse or duty depending on the installation.</td></tr>
<tr><td>Digital interlock</td><td>General switch for simple controls and sequence conditions.</td></tr>
<tr><td>Inhibit-start</td><td>Prevents a start while the external inhibit is active.</td></tr>
<tr><td>Emergency-stop request</td><td>Requests ECU shutdown. Useful in addition to, never instead of, the hardwired energy-removing stop.</td></tr>
<tr><td>Fault switch</td><td>External equipment can request fault shutdown.</td></tr>
<tr><td>Low-oil / zero-oil switch</td><td>Discrete alternatives or supplements to an analog oil-pressure transducer for their corresponding protections.</td></tr>
<tr><td>Sequence gate</td><td>Physical permission/condition used by a Wait For Input sequence block.</td></tr>
<tr><td>Afterburner arm / command</td><td>Separate permission and fire-request switches for afterburner installations.</td></tr>
<tr><td>Reduced-power mode</td><td>Requests the configured output cap.</td></tr>
<tr><td>Generic automation input</td><td>Normalized digital, analog, pulse, RC or duty input for custom rules/sequence logic; it has no built-in engine meaning.</td></tr>
</tbody></table></div>

## Part 6: Wire outputs and actuators

### 6.1 Never power a load from a GPIO

An ESP32 GPIO can provide only a logic command. Use an interface rated for the real voltage, continuous current, starting/stall current, inductive energy, switching rate and fault conditions.

<div class="table-wrap"><table>
<thead><tr><th>Output driver selected in Hardware</th><th>Signal connection</th><th>Typical use</th></tr></thead>
<tbody>
<tr><td>Relay / on-off</td><td>GPIO → 3.3 V-compatible protected relay/MOSFET driver input. Driver output switches the load supply. Fit appropriate coil/load suppression.</td><td>Normally closed fuel valve, contactor enable, solenoid, simple igniter enable.</td></tr>
<tr><td>PWM</td><td>GPIO PWM → protected motor/power driver command. The driver, not the ESP32, carries load current.</td><td>DC pump, fan, glow driver or proportional power stage.</td></tr>
<tr><td>Servo / ESC</td><td>GPIO signal → servo/ESC control input; reference grounds only as the interface requires. Load power comes from its separately rated supply.</td><td>Fuel-pump ESC, starter ESC, propeller pitch or nozzle actuator.</td></tr>
</tbody></table></div>

### 6.2 Every available output purpose

<div class="table-wrap"><table>
<thead><tr><th>Output purpose</th><th>What OpenTurbine commands</th></tr></thead>
<tbody>
<tr><td>Main fuel metering output</td><td>Primary proportional engine-power command, whether the hardware is a pump, valve, metering unit or ESC. Used by sequences, throttle slew, idle control, governor and protections. Calibrate its minimum reliable command with fuel isolated.</td></tr>
<tr><td>Fuel shutoff</td><td>Normally closed main-fuel safety valve. It opens for fuel admission and closes on shutdown. Its de-energized state should be safe.</td></tr>
<tr><td>Starter</td><td>Relay, PWM driver or ESC demand used to spool the engine.</td></tr>
<tr><td>Starter enable</td><td>Separate contactor/enable for starter electronics that require enable plus proportional demand.</td></tr>
<tr><td>Oil pump</td><td>Fixed or pressure-controlled oil delivery, startup priming and windmilling protection.</td></tr>
<tr><td>Coolant pump / scavenge pump / cooling fan</td><td>Auxiliary pumping and cooling outputs usable from Sequence and Controllers. Scavenge can continue into shutdown where configured.</td></tr>
<tr><td>Secondary / auxiliary fuel pump</td><td>Independent second fuel output for Sequence or Controller use. It does not automatically mirror main throttle.</td></tr>
<tr><td>Igniter / afterburner igniter / glow plug</td><td>Commands the appropriate external ignition or glow driver. The ESP32 never drives a coil or glow element directly.</td></tr>
<tr><td>Valve / solenoid</td><td>Bleed or other on/off valve through a rated driver.</td></tr>
<tr><td>Afterburner valve / pump</td><td>Dedicated afterburner fuel shutoff and delivery outputs used by AB sequences.</td></tr>
<tr><td>Air starter</td><td>Air-start valve through an on/off driver.</td></tr>
<tr><td>Pilot fuel</td><td>Independent pilot-fuel pump or valve available to sequencing and controllers, including wet-glow pairing.</td></tr>
<tr><td>Air / fuel purge valve</td><td>Valve that can be placed in a custom safe sequence.</td></tr>
<tr><td>Electric drain valve</td><td>Open/close output available to startup/shutdown sequences, simple Controllers and standby Tools tests. Configure its physical polarity or endpoints in Hardware.</td></tr>
<tr><td>Variable nozzle / propeller pitch</td><td>Proportional servo/ESC output, or deliberate fine/coarse relay pitch; propeller pitch can be the N2 governor's controlled output.</td></tr>
<tr><td>Generic automation output</td><td>Relay, PWM or servo output controlled by a simple Controller or sequence step, with no built-in engine role.</td></tr>
</tbody></table></div>

For every output, set a **Power-on state / Boot safe demand** and a **Fault safe demand** that are electrically safe. Verify actual polarity at the driver input and load terminals; a label in software cannot correct a wrongly wired active-low module.

## Part 7: Install OpenTurbine and connect

If this ECU previously ran a pre-2.0 build, keep its engine file only as a
reference and follow the
[v2 migration guide](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/blob/main/docs/V2_MIGRATION.md).
Version 2.0 intentionally changed the hardware model and several startup/safety
settings; recommission it instead of assuming an old file is safe.

1. Download the [guided Windows Setup Tool]({{ '/get-started/' | relative_url }}).
2. Disconnect all load power. Connect exactly one intended ESP32 by USB.
3. For a blank board choose **Clean install / reinstall**. It erases that board. For an existing working ECU, make a backup and choose **Update and keep my setup**.
4. If the tool identifies a CP210x or WCH USB bridge without a COM port, accept only the matching driver it offers. If a COM port exists but the board does not respond, close serial monitors and follow the BOOT/RESET instructions.
5. After installation, join the Wi-Fi network created by the ECU and browse to `http://192.168.4.1`.
6. Complete the safety acknowledgement and first-run prompts.

Keep exactly one OpenTurbine browser tab open at a time. This applies to both Classic ESP32 and ESP32-S3 ECUs. Close the old dashboard before opening it in another tab, window, browser, phone, or computer.

If the Wi-Fi appears but the page does not, stay connected to that network and type the numeric address directly. See [Troubleshooting]({{ '/troubleshooting/' | relative_url }}) if needed.

## Part 8: Describe the hardware in the dashboard

The dashboard cannot discover ordinary wired sensors and actuators. You must describe exactly what you fitted.

### 8.1 Choose the board first

Open **Hardware**, select the exact Classic ESP32 or supported ESP32-S3 target, and save/reboot if requested. A GPIO number on one board is not automatically safe on another.

### 8.2 Add one channel at a time

1. In **Inputs**, choose **Add input** and pick the preset matching the physical sensor or switch.
2. In **Outputs**, choose **Add output** and pick the matching actuator.
3. Complete the card fields described below.
4. Resolve every red requirement, pin conflict or invalid-channel message.
5. Save, let the ECU reboot, reopen Hardware, and compare the saved page with the physical wire list.

### 8.3 What every channel-card field means

<div class="table-wrap"><table>
<thead><tr><th>Field</th><th>What to enter</th></tr></thead>
<tbody>
<tr><td>Display name / label</td><td>A short human-readable name shown in the dashboard and logs, such as “Main oil pressure”. Renaming it does not break stable references.</td></tr>
<tr><td>Stable ID</td><td>A short unique machine name such as <code>oil_pressure_main</code>. Set it once; controllers, sequences and telemetry may refer to it.</td></tr>
<tr><td>Purpose</td><td>The built-in ECU meaning listed in Parts 5 and 6. This determines which safety, controller and sequence options can use the channel.</td></tr>
<tr><td>Controller use / binding</td><td>Assigns the installed device to a core job such as primary N1 or main fuel output. Do not bind two devices to one exclusive role.</td></tr>
<tr><td>Electrical driver</td><td>The real signal type: digital, ADC, pulse, RC, PWM duty, thermocouple interface, relay, PWM or servo/ESC. It must match the wiring.</td></tr>
<tr><td>GPIO / CS / CLK / MISO / MOSI / data</td><td>The physical board pins used by that interface. Choose only offered pins and use each exclusive pin once. Shared SPI clock/data lines are allowed only where the UI explicitly accepts the shared bus.</td></tr>
<tr><td>Active polarity</td><td>Whether HIGH or LOW means active. For an active-LOW switch to ground, select active LOW and a pull-up.</td></tr>
<tr><td>Input bias</td><td>Internal pull-up, pull-down or none. Use only when electrically appropriate; never enable both.</td></tr>
<tr><td>Minimum/maximum raw value</td><td>The measured electrical endpoints: ADC counts, frequency or pulse width. Minimum must be below maximum.</td></tr>
<tr><td>Minimum/maximum mapped value</td><td>The engineering quantity those raw endpoints represent, such as 0–10 bar or 0–100%.</td></tr>
<tr><td>Pulses per revolution/litre/unit</td><td>The sensor's real pulse count from its datasheet or calibration. A wrong value produces a proportionally wrong reading.</td></tr>
<tr><td>PWM frequency and resolution</td><td>Must match the receiving driver. Higher resolution can limit available carrier frequency.</td></tr>
<tr><td>Duty/pulse at 0% and 100%</td><td>The actual PWM duty or servo pulse produced at the two command endpoints. These are electrical endpoints, not the pump's minimum-running calibration.</td></tr>
<tr><td>Minimum non-zero / reliable command</td><td>Smallest nonzero command that reliably keeps an applicable motor/driver moving. Find it cautiously in Calibration/Tools.</td></tr>
<tr><td>Output polarity / reverse</td><td>Reverses the electrical interpretation. Verify with a meter before connecting a load.</td></tr>
<tr><td>Power-on / boot-safe demand</td><td>Command applied during initialization and after some tests. Choose the physically safe state.</td></tr>
<tr><td>Fault-safe demand</td><td>Command used when the ECU enters fault handling. This is not a replacement for a de-energized safe design.</td></tr>
<tr><td>Current-sensor fields</td><td>ADC GPIO, sensor mV/A, zero-current voltage and overcurrent limit for an attached current sensor. Calibrate zero with the load off.</td></tr>
</tbody></table></div>

<p class="guide-return"><a href="#guide-contents">Back to contents</a></p>

## Part 9: Understand controllers and safety functions

### 9.1 Controllers

A controller continuously changes an output based on a measurement. Enable it only after its sensor and output work independently.

<div class="table-wrap"><table>
<thead><tr><th>Controller</th><th>How it works</th><th>When to enable it</th></tr></thead>
<tbody>
<tr><td>Oil pressure loop</td><td>Compares measured oil pressure with a fixed, effective-fuel, N1, or N2 target and changes its explicitly selected pump. Proportional pumps modulate; relay pumps use full off/on hysteresis for accumulator systems. Fallback handles a failed sensor.</td><td>After the pressure input, selected pump, plumbing and safe fallback demand are proven.</td></tr>
<tr><td>Smooth fuel/throttle movement</td><td>Limits how quickly the main fuel output opens or closes. It also supports gradual limit protection behavior.</td><td>Normally enabled for a proportional main-fuel output. Set opening/closing times from controlled tests, not examples.</td></tr>
<tr><td>Automatic idle control</td><td>Measures one selected N1, N2, P1, or P2 source and adjusts fuel within configured bounds to hold idle. N1/N2 is the normal proven method; pressure control is experimental and has separate target, deadband, and disengagement settings.</td><td>Only after manual/fixed idle behavior is stable, the selected feedback is calibrated, and fuel limits are safe.</td></tr>
<tr><td>Automatic N2 speed control</td><td>Compares N2 with its target and changes proportional main fuel, proportional propeller pitch, or deliberate fine/coarse relay pitch. Coarser pitch increases load to restrain speed.</td><td>Only on an appropriate two-shaft system with verified N2, output direction, travel limits and conservative gains.</td></tr>
</tbody></table></div>

### 9.2 Safety functions

Enabling a checkbox does not prove the protection. You must force a safe simulated fault and confirm the response.

<div class="table-wrap"><table>
<thead><tr><th>Safety</th><th>Trigger and prerequisite</th></tr></thead>
<tbody>
<tr><td>N1 overspeed</td><td>Hard shutdown above Maximum N1 Speed; requires primary N1.</td></tr>
<tr><td>N2 overspeed</td><td>Independent hard shutdown above Maximum N2 Speed; requires N2.</td></tr>
<tr><td>Turbine gas overtemperature</td><td>Watches the startup-specific selected TOT/TIT limit during STARTUP and the normal hard limit during RUNNING. A zero startup limit inherits the normal limit.</td></tr>
<tr><td>Low oil pressure</td><td>Shutdown after configured low-pressure behavior; requires oil pressure or a low-oil switch.</td></tr>
<tr><td>Zero oil pressure</td><td>Detects effectively absent oil pressure; requires oil pressure or a zero-oil switch.</td></tr>
<tr><td>Flameout</td><td>Declares combustion loss using the selected flame, N1, or EGT evidence after its confirmation time. EGT evidence means temperature is below its threshold and falling, or is falling faster than the configured rate.</td></tr>
<tr><td>Hot start</td><td>Blocks START when selected turbine temperature is already above the pre-start limit. The normal/startup overtemperature guard then protects the active start.</td></tr>
<tr><td>Oil temperature high</td><td>Shutdown above the oil-temperature limit; requires that input.</td></tr>
<tr><td>Fuel pressure low</td><td>Shutdown below the running fuel-pressure threshold; requires fuel-pressure input.</td></tr>
<tr><td>Battery undervoltage</td><td>Fault behavior below the configured bus-voltage threshold; requires a scaled, calibrated voltage input.</td></tr>
<tr><td>Surge / compressor instability</td><td>Uses rolling N1 variance to detect oscillation. It requires a clean N1 signal and engine-specific validation to avoid false trips.</td></tr>
</tbody></table></div>

Controllers disables protections whose required input is not fitted. Each expandable safety card keeps its enable, source, thresholds and confirmation timing together. A value of zero disables several thresholds; read each field explanation carefully.

## Part 10: Configure Controllers and System

### 10.1 Safe order

1. Open **Controllers** only after Hardware saves without errors; use **System** for ECU-wide behavior and communications.
2. Start in **Configured system**, which opens by default and shows the controls supported by the fitted hardware. Enter limits from the exact engine, sensor and actuator documentation.
3. Use **Changed** to review every edit. Yellow fields are not saved yet.
4. Use **Explore all features** to inspect or preconfigure features whose required hardware/controller is absent. Amber-bordered tuning values save normally but remain inactive until Hardware satisfies the displayed prerequisite. Enable switches and choices for missing hardware remain locked, so Explore cannot arm a feature unexpectedly. Search also reveals unavailable settings; neither Explore nor Developer Mode bypasses a missing physical prerequisite.
5. Save one related group at a time and read the save recap.
6. Reopen the page and confirm values survived the reboot/save.

Never copy “typical”, example or preset values into a fueled turbine without verifying them. Units matter: RPM, milliseconds, percent, pressure and °C/°F are not interchangeable.

### 10.2 Complete source-matched field reference

The expandable sections below document every field rendered by Controllers and System. This list is generated from their shared source schema rather than maintained as a second handwritten list. If a field is unavailable, Hardware has not provided its prerequisite.

{% include generated-config-fields.html %}

## Part 11: Calibrate inputs and outputs

Calibration makes a displayed number match reality. Do it in **STANDBY** or **FAULT**, with hazardous energy isolated.

Direct digital flame detectors and switches need only the correct active electrical state. ADC-backed flame detectors and switches use one common condition model: active above/below, threshold, and hysteresis. For an ADC switch, capture its inactive and active states on Calibration; OpenTurbine calculates polarity, a midpoint threshold, and a noise-aware deadband. Hysteresis prevents vibration or electrical noise near the threshold from making the state chatter.

Most analog voltage/current transmitters need only the normal two-point calibration. For a nonlinear resistive sender, open **Advanced sensor curve** on its Hardware card and enter 2–6 measured or datasheet points. Raw ADC points must increase; physical values may consistently increase or decrease. The ECU interpolates between points and clamps outside the endpoints. NTC inputs normally use their resistance/beta model, but may use this curve when the manufacturer supplies a temperature table. Thermocouple, pulse/frequency, and load-cell inputs retain their dedicated calibration methods.

1. Open **Calibration** and confirm it shows only fitted hardware.
2. Start with raw readings. A disconnected sensor should not look like a believable safe value.
3. Apply a known low reference, capture/enter the low point, and record the physical value.
4. Apply a known high reference, capture/enter the high point, and record the physical value.
5. Test one or more points between them. If the middle is wrong, the sensor may be nonlinear or the electrical type may be incorrect.
6. Save, reboot, and repeat the check.

Specific checks:

- **N1/N2:** compare several speeds with an independent tachometer. Correct pulses/revolution first.
- **TOT/TIT:** verify thermocouple type, polarity, connector metals, converter and probe location. Compare ambient and a controlled reference.
- **Pressure:** zero only while safely depressurized, then compare with a trusted gauge at multiple pressures.
- **Voltage/current:** compare with a meter at several loads; verify the divider ratio and current-sensor zero.
- **Throttle/idle/AB input:** capture true low and high endpoints, then test signal loss and reversed travel.
- A native or registry/I2C AB command uses the same normalized input and disconnect guard. A required AB arm input remains continuous permission and starts normal AB shutdown when released.
- **Main fuel/oil/starter proportional outputs:** test the command signal into a meter or disconnected driver first. Find minimum reliable behavior only in a suitably safe rig.

## Part 12: Build startup and shutdown sequences

A sequence is an ordered list. Each block either performs an action, waits for a condition, waits for time, or checks a condition. The editor hides blocks whose required hardware is absent and explains each block with its **?** button.

### 12.1 Beginner startup order

Do not copy this blindly; make it match the engine. A common logic pattern is:

1. **Build Oil Pressure (OilPrime):** runs the oil pump and waits for pressure, or uses a timed fixed output if no pressure sensor exists.
2. **Starter Spin to Light-Off Speed (StarterSpin):** enables/ramps the starter and waits for the configured light-off N1.
3. **Set Output / Pre-Heat:** energizes the selected ignition or glow output. A Set Output card always names the exact fitted device and can be changed between ON/OFF or a proportional demand where its Hardware driver allows that.
4. **Set Output / Fuel Pulse:** opens the selected fuel-shutoff device or applies a bounded priming pulse where that is deliberately required.
5. **Confirm Combustion:** uses FlameConfirm or TempConfirm; never leave light-off unverified merely because a timer expired.
6. **Spool / Modified Idle / Fuel Pump Idle:** increases fuel toward the idle-entry condition.
7. **Verify Stable Idle (SafetyHold):** confirms RPM/oil conditions before RUNNING.

Use **Timed Delay** only when time itself is the correct requirement. **Wait For Input** is for an installed permission switch. Use **Set Output** for ordinary device commands; the add list presents one professionally named action for each fitted output and the card remains editable afterward. Purpose-specific blocks remain only where the ECU must perform real turbine logic rather than merely command an output.

On a fresh generic development-board installation, the safe example profile contains throttle and idle inputs plus Main Fuel Metering, Oil Pump and Igniter outputs. Its example startup builds oil, enables ignition, establishes minimum fuel and uses delays; its shutdown immediately cuts combustion, keeps oil running for the configured delay, then switches the selected oil pump off. It is a commissioning example, not a tune or sequence to copy into an engine. Add the actual sensors, starter, fuel shutoff and feedback checks your installation requires before introducing energy.

### 12.2 Beginner shutdown order

1. **Immediate Cut:** zeroes throttle, closes fuel, and disables ignition/starter immediately.
2. **RPM Drop:** waits for N1 to fall below the configured threshold.
3. **Cooldown Spin:** uses starter/oil behavior to cool where the engine requires it.
4. **Wait TOT Cool:** holds until the selected temperature is below its target if appropriate.
5. **Final Stop:** waits for zero N1, cuts the main oil pump and preserves configured scavenge behavior.

Verify that STOP removes fuel immediately. Cooling, purge or scavenge actions may continue only as deliberately required. Test web STOP, loss of throttle/RC, a simulated sensor fault and the independent hardwired stop separately.

### 12.3 Every block field

- **Block name/type** identifies the behavior.
- **Condition** is what must become true before a “while” block exits.
- **Demand / duty / percent** is the normalized actuator command.
- **Threshold / target** is the sensor value the block is trying to reach or cross.
- **Timeout** is the maximum wait. Read whether expiry causes continue, abort or fault; these are intentionally different outcomes.
- **Run on entry/exit** side actions switch selected actuators when a sequence or block boundary is crossed.
- **Custom block steps** either set a fitted actuator or delay. A custom condition compares a fitted input with a threshold. Keep custom blocks small enough to reason about.

Run the full startup and shutdown sequence repeatedly with no fuel and ignition energy disabled.

<p class="guide-return"><a href="#guide-contents">Back to contents</a></p>

## Part 13: Use custom controllers

Open **Controllers → Custom controllers** for behavior that is not covered by a common turbine controller. Any fitted sensor, switch, or operator input can control an unowned compatible output. Each output may have one enabled normal owner.

### Threshold control

Choose an input, **above** or **below**, a threshold, hysteresis, on value and off value. Example: a fan turns on above 100 °C with 5 °C hysteresis; it stays on until temperature falls to 95 °C. Hysteresis prevents rapid chatter near the threshold.

### Mapping control

Choose an input minimum/maximum and an output minimum/maximum. The ECU maps linearly between them and clamps outside the range. Use it for a verified proportional relationship, not a safety shutdown.

### Feedback control

Choose the measured feedback signal, then choose whether its target is fixed, selected by a switch, or mapped from another variable input. The controller inherits the existing output at RUNNING handover, applies the configured output limits, and uses the feedback-loss output if either required input becomes unhealthy. Start with gentle response values and tune on a safe bench setup.

### Fields common to both

- **Enabled** makes the control active.
- **Input / feedback** is a fitted registry channel.
- **Output** is the fitted actuator this controller owns. Outputs already owned by an enabled dedicated turbine controller are not offered.
- The control owns that output only while the ECU is RUNNING. Sequence and safe-state logic own it in other modes.
- **Off value** is commanded when RUNNING ends or its input becomes unavailable.

Common turbine controllers remain the simplest route, but a custom controller may replace an ordinary direct owner when no dedicated controller is enabled for that output. RUNNING is the default; advanced builds may select any combination of STANDBY, STARTUP, RUNNING, and SHUTDOWN. Afterburner fuel remains state-machine-owned. Fault handling returns every output to its hardware-safe state; custom controllers never run in FAULT or override fault safety.

## Part 14: Dry-test the complete ECU

“Dry” means no fuel can reach the engine and ignition cannot create hazardous energy. Use a meter, indicator lamp or safe dummy load before a real actuator.

1. Compare every Hardware GPIO with a physical wire-by-wire checklist.
2. On the dashboard, move or stimulate each input and verify direction, units, range and plausible failure behavior.
3. Open **Tools → Test settings** and reduce test duration/demand to a conservative value.
4. Test one output at a time: logic pin first, then driver with no load, then a safe dummy load, then the real isolated actuator where appropriate.
5. Confirm active-high/low behavior, power-on state, end-of-test state and fault-safe state.
6. Run a complete dry startup. Confirm every condition and timeout.
7. Run normal STOP, fault shutdown and loss-of-signal tests.
8. Cut Wi-Fi/browser access and prove the independent stop still removes hazardous energy.
9. Power-cycle at unexpected points and confirm no output energizes unexpectedly.
10. Download a backup and the dry-test logs.

Do not proceed while any pin conflict, unavailable dependency, implausible reading, unexplained reboot, unexpected output pulse or failed stop test remains.

## Part 15: Prepare for a first fueled test

A first fueled turbine test is beyond beginner electronics assembly. Have the complete installation reviewed by someone competent in the turbine, fuel, electrical and test-cell hazards.

Before fuel is connected, verify all of these:

- limits come from authoritative documentation for this exact engine and probe location;
- fuel and oil plumbing is restrained, routed safely and leak-tested;
- pumps, starter, valves and igniters use rated drivers, wiring and fuses;
- every safety input is calibrated and its fault response was forced safely;
- the turbine is restrained in a suitable outdoor/test-cell exclusion zone;
- fire suppression, hearing/eye protection and remote observation are ready;
- another competent person is present where the risk assessment requires it; and
- the physical emergency stop was tested immediately before the attempt.

Stop for any unexpected temperature, RPM, oil, vibration, fuel, wiring, actuator or controller behavior. Do not continue merely because the ECU has not declared a fault.

## Part 16: Operate, back up, update and diagnose

### Normal operation

Observe the engine itself, independent instruments and dashboard. Do not rely on Wi-Fi or a browser remaining connected. After a run, inspect the event log and session CSV for maximums, faults and sensor dropouts.

### Backups

In **Tools**, download the complete engine file before major changes and before every update. It contains hardware, calibration, sequences, controllers and Wi-Fi credentials. Store it securely and remove credentials before sharing. Logs are separate downloads.

### Updates

Use **Update and keep my setup** for a working controller. Use clean install only for a blank board, deliberate erasure or recovery. Do not interrupt power while firmware or web assets are being installed. Read the [release notes](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/releases) first.

### Useful fault report

Record the board target, OpenTurbine version, fitted channel list, engine state, active sequence block, exact expected behavior and exact observed behavior. Include sanitized engine backup and logs where appropriate. Setup Tool diagnostics are under `%LOCALAPPDATA%\OpenTurbine\SetupTool\logs`.

Use [symptom-based troubleshooting]({{ '/troubleshooting/' | relative_url }}) or open [Setup Help](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/issues/new?template=setup_help.yml). Do not share Wi-Fi credentials or sensitive installation details publicly.

<p class="guide-return"><a href="#guide-contents">Back to contents</a></p>

<p class="document-nav"><a href="{{ '/get-started/' | relative_url }}">Get Started</a><a href="{{ '/hardware/' | relative_url }}">Hardware quick reference</a><a href="{{ '/troubleshooting/' | relative_url }}">Troubleshooting</a></p>
