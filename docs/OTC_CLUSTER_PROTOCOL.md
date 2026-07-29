# OpenTurbine Cluster Protocol v1

OTC is the serial protocol used by OpenTurbine for external instrument
clusters, companion displays, and small telemetry bridge devices.

MAVLink remains available for ground-station software. OTC is intended for
simple embedded displays that need the fitted hardware schema, live values,
status messages, warnings, and optional wired button commands.

A simple Arduino-style receiver is provided in
[`examples/OTCClusterClient.h`](../examples/OTCClusterClient.h). A practical wiring and implementation guide is available at
[`examples/cluster/README.md`](../examples/cluster/README.md). The client parses frames, validates CRC, learns the
schema, and exposes live values as ordinary variables.

## Link

- UART 8N1
- Default baud: 115200
- Default telemetry interval: 50 ms
- ECU TX is required
- ECU RX is optional; leave `cluster_serial.rx_pin = -1` for telemetry-only
- Hardware > Cluster Serial is the single link enable. When enabled with a
  valid TX connection, the ECU transmits live frames.
- Config contains the fitted cluster's warning/display thresholds and field
  choices; it does not contain a second transmission enable.

## Handshake Modes

### TX-only cluster

When only ECU TX is configured, the link is broadcast-only. The ECU sends HELLO,
FIELD_DEF, LIMITS, STATUS_DEF, and SCHEMA_END at boot and repeats the schema
periodically. HELLO capability bits advertise schema + telemetry only, so the
cluster knows command RX and subscriptions are unavailable. The cluster should
display the default stream and ignore any command UI that needs ECU RX.

### Two-way cluster

When ECU RX is configured, HELLO also advertises command RX and subscriptions.
The cluster may send `OTC:SCHEMA?` after boot and may change the stream with
`OTC:SUB,...`. The ECU acknowledges valid requests and resends schema for the
active subscription.

## Frame

All ECU-to-cluster binary frames use this layout:

```text
byte 0      'O'
byte 1      'T'
byte 2      protocol version: 1
byte 3      frame type
byte 4      sequence counter
byte 5..6   payload length, little endian
byte 7..N   payload
last 2      CRC16-CCITT-FALSE over bytes 2..N, little endian
```

CRC parameters: polynomial `0x1021`, initial value `0xFFFF`, no reflection,
no final xor.

Receivers should ignore unknown frame types and request the schema again if
field definitions are missing.

## Frame Types

| Type | Name | Direction | Payload |
|---:|---|---|---|
| 1 | HELLO | ECU to cluster | major, minor, capabilities, interval, baud, profile string |
| 2 | FIELD_DEF | ECU to cluster | field index, field id, type, unit, decimals, field key string |
| 3 | LIMITS | ECU to cluster | float32 limits: N1 max, N1 warn, N2 warn, selected EGT max, selected EGT warn, oil warn, oil zero |
| 4 | TELEMETRY | ECU to cluster | timestamp, mode, health flags, status, sequence progress, start index, float32 values |
| 5 | STATUS | ECU to cluster | status code, severity, label string |
| 6 | EVENT | ECU to cluster | severity, text string |
| 7 | ACK | ECU to cluster | ok flag, text string |
| 8 | SCHEMA_END | ECU to cluster | field count |
| 9 | STATUS_DEF | ECU to cluster | status code, severity, label string |

Strings are null-terminated inside the payload. `FIELD_DEF` sends the stable
field key used by `OTC:SUB,...`; display labels can be chosen by the cluster.

HELLO capability bits:

| Bit | Meaning |
|---:|---|
| 0 | schema frames are sent |
| 1 | telemetry frames are sent |
| 2 | ECU RX commands are available |
| 3 | subscriptions are available |

## Units

All numeric values are sent in canonical ECU units:

| Unit id | Unit |
|---:|---|
| 0 | none |
| 1 | RPM |
| 2 | deg C |
| 3 | bar |
| 4 | volt |
| 5 | Nm |
| 6 | watt |
| 7 | percent |
| 8 | flow units configured by calibration |
| 9 | raw counts (uncalibrated ADC/input value) |
| 10 | boolean (0 or 1) |
| 11 | milliseconds |
| 12 | count |
| 13 | ampere |

Clusters may convert to imperial or local display units after parsing.

## Telemetry Payload

```text
u32 millis
u8  SysMode
u32 health_flags
u8  last_status_code
u8  sequence_block_index
u8  sequence_block_total
u8  field_count
u8  field_start_index
f32 values[field_count]
```

`values[]` order matches the emitted `FIELD_DEF` index order starting at
`field_start_index`. Default streams normally fit in one frame. Larger
subscriptions may be chunked across multiple telemetry frames so the ECU does
not block on a large UART write.

## Health Flags

| Bit | Meaning |
|---:|---|
| 0 | N1 healthy |
| 1 | N2 healthy |
| 2 | TOT healthy |
| 3 | TIT healthy |
| 4 | oil pressure healthy |
| 5 | oil temperature healthy |
| 6 | fuel pressure healthy |
| 7 | battery voltage healthy |
| 8 | torque healthy |
| 9 | main flame detected |
| 10 | surge detected |
| 11 | afterburner flame detected |
| 12 | RC throttle signal valid |
| 13 | RC idle signal valid |
| 14 | config version mismatch |
| 15 | sequence validation has errors |

## Optional RX Commands

If ECU RX is wired, a cluster may send newline-terminated ASCII commands:

```text
OTC:PING
OTC:SCHEMA?
OTC:SUB,DEFAULT
OTC:SUB,ALL
OTC:SUB,N1_RPM,TOT_C,OIL_BAR,MODE
OTC:CMD,STOP
OTC:CMD,START
OTC:CMD,AB_STOP
OTC:CMD,RESET_PEAKS
OTC:CMD,LIMP_TOGGLE
OTC:CMD,DYNAMIC_IDLE_TOGGLE
```

The ECU replies with an ACK frame. Commands are queued through the same command
path as the web UI, so the normal mode and safety gates still apply. STOP uses
the emergency-stop queue path.

Command lines are limited to 167 characters. An over-long line is discarded
whole and NAK'd with `LINE_TOO_LONG`. This bounds `OTC:SUB,...` to about 159
characters of field keys per request.

`SUB,DEFAULT` returns to the compact default stream. `SUB,ALL` sends every
currently fitted/available field and intentionally omits empty hardware to avoid
traffic full of unused values. A named `SUB,...` request may include unavailable
fields; those values are returned as IEEE float `NaN`, which is the protocol's
NIL value.

`TOT_RATE` is a legacy-stable subscription key. Its
value is the selected primary EGT rise rate, so TIT-primary setups can still
stream the rate under the existing protocol field id/key.
