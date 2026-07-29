# Building an OpenTurbine cluster or companion device

OpenTurbine Cluster Protocol (OTC) is a small UART protocol for external displays, loggers, bridges, and custom control panels. It advertises which signals are actually fitted, streams live values and status, and can optionally accept a limited command set.

This folder is the practical starting point. The reusable implementation currently lives one level up as [`OTCClusterClient.h`](../OTCClusterClient.h) so existing projects and links remain compatible.

A compilable minimal sketch is provided as [`OTCClusterExample.ino`](OTCClusterExample.ino).

## What the client does

`OTCClusterClient.h` is a single-file Arduino-style client that:

- Finds and validates binary `OT` frames
- Checks CRC16-CCITT-FALSE
- Learns the ECU’s fitted-field schema
- Reassembles chunked telemetry
- Exposes values such as N1, N2, TOT, TIT, oil pressure, temperature, fuel pressure, battery voltage, actuator demand, mode, and status
- Ignores unknown future fields safely
- Detects signal loss
- Supports schema requests, subscriptions, and allowed commands when the return UART is wired

## Hardware connection

Both devices must use compatible 3.3 V UART logic and share ground.

### Telemetry-only

```text
OpenTurbine ECU cluster TX  -> companion RX
OpenTurbine ECU GND         -> companion GND
```

Leave ECU cluster RX disabled (`-1`). The ECU periodically repeats its schema, so a display can reconnect without transmitting.

### Two-way

```text
OpenTurbine ECU cluster TX  -> companion RX
Companion TX                -> OpenTurbine ECU cluster RX
OpenTurbine ECU GND         -> companion GND
```

Never connect two push-pull TX pins together. Confirm voltage levels before wiring a non-ESP32 device.

## Configure the ECU

1. Open **Hardware**.
2. Enable **Cluster Serial**.
3. Choose ECU TX, optional ECU RX, and baud rate.
4. Save Hardware and reboot.
5. Open **Config → Cluster** only to review the fitted display's warning
   thresholds and field choices. Hardware is the single transmission enable.

The default link is UART 8N1 at 115200 baud with a nominal 50 ms telemetry interval.

## Minimal Arduino/ESP32 program

Copy [`OTCClusterClient.h`](../OTCClusterClient.h) into your project:

```cpp
#include "OTCClusterClient.h"

HardwareSerial EcuSerial(2);
OTCClusterClient otc;

void setup() {
  Serial.begin(115200);

  // Companion-side pins: RX=16 receives ECU TX; TX=17 is optional.
  EcuSerial.begin(115200, SERIAL_8N1, 16, 17);
  otc.begin(EcuSerial);

  // Useful in two-way mode. Harmless if the companion TX is not connected.
  otc.requestSchema();
}

void loop() {
  otc.update();

  if (otc.dataReceived) {
    Serial.printf("mode=%s N1=%.0f EGT=%.1f oil=%.2f status=%s\n",
                  otc.modeText(), otc.n1Rpm, otc.totC,
                  otc.oilBar, otc.statusText);
  }

  if (otc.signalLost()) {
    // Show NO DATA and do not keep displaying stale values as live.
  }
}
```

Check the header for the exact public variables and helpers available in the current client version.

## Build the display from the learned schema

Do not assume every ECU has N1, N2, TOT, oil pressure, afterburner, or a power turbine. Wait for `schemaReceived`, then use the client’s `has...` flags to decide which gauges and warnings to display.

Values arrive in canonical ECU units:

- Temperature: °C
- Pressure: bar
- Speed: RPM
- Voltage: V
- Current: A
- Torque: Nm
- Power: W
- Actuator commands: percent

Convert units on the display side. Keep raw values internally so warning comparisons remain consistent.

## Status and safety behavior

A cluster should always make these states obvious:

- No telemetry / stale telemetry
- STANDBY, STARTUP, RUNNING, SHUTDOWN, and FAULT
- Current sequence progress during startup/shutdown
- Active warning/fault status
- Sensor health for every displayed safety-critical value

Do not display a stale last value without a visible NO DATA indication.

## Optional commands

Two-way wiring can request schema/subscriptions and send supported commands such as STOP, START, reset peaks, limp toggle, or dynamic-idle toggle. Check `commandsAvailable()` before showing command controls.

Commands still pass through the ECU’s normal mode, hardware, and safety gates. A cluster command is not a way around ECU protections. STOP uses the emergency command path, but a custom cluster must not replace the installation’s independent physical fuel/power stop.

## Extending or porting the client

For a non-Arduino platform, implement these layers:

1. UART byte transport
2. `OT` frame synchronizer
3. Length-bounded payload buffer
4. CRC16-CCITT-FALSE validation
5. HELLO capability parser
6. FIELD_DEF/schema table
7. TELEMETRY chunk application by start index
8. STATUS/EVENT handling
9. Signal timeout
10. Optional newline ASCII command transmitter

Receivers must ignore unknown field and frame types so newer ECU firmware can remain compatible.

The exact frame layout, field ids, health bits, capabilities, commands, CRC, and limits payload are documented in [`../../docs/OTC_CLUSTER_PROTOCOL.md`](../../docs/OTC_CLUSTER_PROTOCOL.md).
