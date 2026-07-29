# Flash-Time PCB Profiles

Status: implemented architecture and validation contract
Scope: optional, immutable physical-hardware descriptions for OpenTurbine PCBs

## 1. Product behavior

OpenTurbine has three clean-install choices, in this order:

1. **ESP32 development board** — flash no PCB profile. The Hardware page keeps
   its current manual GPIO, bus, chip, and signal-type workflow.
2. **Official OpenTurbine PCB** — flash a compatible profile bundled with the
   setup package.
3. **Custom PCB** — select a profile supplied with a third-party PCB design.

A valid profile changes only the physical-hardware part of configuration. Users
still add an engine function such as TOT, N1, idle demand, fuel flow, starter,
or main fuel and select where it is connected. They do not configure the
underlying GPIO, peripheral, chip address, polarity, or bus wiring.

Examples:

```text
TOT          -> Thermocouple 1
N1           -> High-speed input 1
Idle demand  -> Servo/pulse input 2
Fuel flow    -> Servo/pulse input 3
Starter      -> Servo output 1
Oil pump     -> High-current output 4
```

The choice list is capability based. A PCB port is not permanently labelled
"idle" or "fuel flow": a servo/pulse input may be offered for RC PWM, a
low-frequency flow sensor, a switch, or shaft speed when its declared
capabilities and limits support that use.

Every exposed expansion pin must also be described by the profile. Profile mode
never exposes an undeclared raw GPIO for editing.

## 2. Safety and fallback rules

These states must not be conflated:

| Profile partition state | Firmware behavior |
|---|---|
| Intentionally empty/erased | Generic development-board mode, exactly as today |
| Valid profile for this ESP chip | Named-port PCB mode |
| Recognizable profile with bad CRC, unsupported major version, wrong chip, or invalid topology | Profile fault: inhibit outputs and START; tell the user to reflash |

Falling back to generic pin defaults after detecting a damaged profile is
unsafe: those defaults could energize a different circuit on a soldered PCB.

The profile is read-only to firmware and has no web write endpoint. Factory
reset removes engine configuration, calibration, logs, and user settings but
does not touch the PCB profile. Wi-Fi/OTA updates preserve it. Installing,
changing, or removing a profile is a USB clean-install operation in the setup
tool.

PCB design must provide hardware pull resistors that hold dangerous outputs safe
during reset and bootloader operation. A profile safe state is applied as early
as firmware permits, but cannot replace electrical fail-safe design.

## 3. Separation of responsibilities

### Immutable PCB profile

- exact ESP32 family/variant;
- board identity and revision;
- fixed GPIO, SPI, I2C, ADC, PCNT, UART, and PWM routing;
- fitted chips and channels;
- named external connectors/ports;
- electrical and timing capabilities;
- active polarity and power-on safe state;
- composite relationships such as output current feedback;
- resource-sharing rules.

### User hardware assignment

- engine purpose;
- selected `port_id` and, only if genuinely ambiguous, `mode_id`;
- sensor/actuator calibration;
- operational electrical endpoints that are safe for the user to tune, such as
  servo pulse endpoints or sensor scaling.

### Engine configuration

- limits, controllers, sequencer, rules, logging, and telemetry.

The existing `ChannelRegistry` remains the runtime execution model. The profile
resolver produces the same driver/pin/address fields that generic configuration
currently supplies.

## 4. Source profile format

Profiles are UTF-8 JSON so PCB designers can review, diff, document, and publish
them with KiCad or other board sources. Stable string IDs are used throughout;
display labels are never identity keys.

Suggested source layout:

```json
{
  "format": "openturbine-pcb-profile",
  "format_version": {"major": 1, "minor": 0},
  "board": {
    "id": "openturbine-ecu-r1-s3",
    "name": "OpenTurbine ECU",
    "revision": "1",
    "manufacturer": "OpenTurbine",
    "description": "Official ESP32-S3 turbine ECU"
  },
  "target": {
    "chip": "esp32-s3",
    "minimum_flash_mb": 8
  },
  "buses": [
    {
      "id": "thermocouple_spi",
      "kind": "spi",
      "pins": {"sck": 12, "miso": 13, "mosi": -1}
    },
    {
      "id": "sensor_i2c",
      "kind": "i2c",
      "pins": {"sda": 8, "scl": 9, "interrupt": 10},
      "frequency_hz": 400000
    }
  ],
  "devices": [
    {
      "id": "tc_chip_1",
      "driver": "max6675",
      "bus": "thermocouple_spi",
      "select": {"gpio": 14},
      "expected": true
    },
    {
      "id": "adc_chip_1",
      "driver": "tla2528",
      "bus": "sensor_i2c",
      "address": 16,
      "expected": true
    }
  ],
  "ports": [
    {
      "id": "thermocouple_1",
      "label": "Thermocouple 1",
      "connector": "J4",
      "description": "K-type thermocouple input",
      "modes": [
        {
          "id": "temperature",
          "adapter": "spi_thermocouple",
          "device": "tc_chip_1"
        }
      ]
    },
    {
      "id": "servo_pulse_input_1",
      "label": "Servo / pulse input 1",
      "connector": "J7",
      "modes": [
        {
          "id": "servo_pwm",
          "adapter": "rc_pwm_input",
          "endpoint": {"gpio": 16},
          "limits": {"minimum_hz": 20, "maximum_hz": 500}
        },
        {
          "id": "frequency",
          "adapter": "pcnt_input",
          "endpoint": {"gpio": 16},
          "limits": {"maximum_hz": 20000}
        },
        {
          "id": "digital",
          "adapter": "digital_input",
          "endpoint": {"gpio": 16}
        }
      ]
    },
    {
      "id": "adc_1",
      "label": "ADC 1",
      "connector": "J8 pin 1",
      "modes": [
        {
          "id": "analog",
          "adapter": "i2c_adc_input",
          "device": "adc_chip_1",
          "channel": 0,
          "limits": {"minimum_mv": 0, "maximum_mv": 3300}
        }
      ]
    }
  ]
}
```

This is illustrative, not the final JSON Schema.

## 5. Extensibility model

The schema describes **ports, modes, adapters, resources, and limits**, not a
fixed list of turbine sensors. This avoids changing the profile format whenever
a new engine purpose is added.

Each firmware adapter declares:

- direction;
- signal classes it provides;
- required device driver or ESP peripheral;
- required and optional profile fields;
- ChannelRegistry driver/interface it resolves to;
- health provider;
- editable calibration fields;
- resource claims.

Initial signal classes include:

- `digital_level`;
- `analog_voltage`;
- `pulse_frequency`;
- `servo_pulse`;
- `pwm_duty_input`;
- `temperature`;
- `bridge_load_cell`;
- `digital_output`;
- `pwm_output`;
- `servo_output`.

Engine-purpose definitions declare which signal classes they accept and any
additional limits. For example:

- N1 accepts `pulse_frequency` or a future supported speed transmitter;
- fuel flow accepts `pulse_frequency` or `analog_voltage`;
- idle demand accepts `servo_pulse`, `analog_voltage`, or a supported digital
  command source;
- TOT accepts a supported `temperature` adapter;
- a relay actuator accepts `digital_output`;
- a variable pump accepts `pwm_output` or `servo_output`.

Adding a chip normally requires one new device driver and adapter. Existing
profiles and UI purpose definitions remain unchanged. Unknown optional fields
and unknown minor-version records are ignored. A port using an adapter unknown
to the installed firmware is shown as **Requires newer firmware**, while other
supported ports remain usable.

Profile source limits should initially allow at least 8 buses, 24 devices,
48 ports, and 4 modes per port. These are physical catalog limits, separate
from the number of channels actively assigned in `ChannelRegistry`.

## 6. Resource ownership

A whole physical port is exclusive once assigned, even when it has several
modes. This prevents the same GPIO from becoming both a servo input and a flow
counter.

Shared resources are explicit:

- SPI/I2C buses may be shared;
- chip-select pins, device channels, PCNT endpoints, ADC channels, and output
  controls are exclusive;
- a composite high-current output may own its control signal and fixed current
  feedback channel together;
- aliases require an explicit shared/alias declaration and a strict use case.

Compatibility filtering and conflict checking use the same resolved resource
claims. The UI must not implement an independent approximation of firmware
rules.

## 7. On-flash container

Add a small dedicated read-only data partition named `pcbprof` to both partition
tables. A clean USB install is already required when partition layout changes.
The first implementation can reserve 64 KiB and reduce LittleFS by the same
amount.

Container header:

```text
magic                 "OTPB"
container_version
payload_encoding      UTF-8 JSON initially
profile_format_major
profile_format_minor
target_chip
payload_length
payload_crc32
```

The container format leaves room for a compact encoding later without changing
source profiles. Firmware copies only bounded resolved port metadata into RAM
and frees the temporary JSON document after boot. Set and test explicit payload,
port, device, mode, string, and nesting limits.

The profile is an integrity boundary, not a security boundary: anyone with
physical flash access can also replace firmware. Official profile files and
package manifest entries still receive SHA-256 hashes so corrupt release
payloads are rejected before erase.

## 8. Firmware architecture

Add:

```text
src/system/pcb/PcbProfileManager.*
src/system/pcb/PcbProfileTypes.h
src/system/pcb/PcbProfileResolver.*
src/generated/PcbTargetCapabilities.h
```

Boot order:

1. initialize storage needed to read `pcbprof`;
2. classify the partition as absent, valid, or faulty;
3. validate target and profile structure;
4. load the bounded port/device catalog;
5. load `ecu_config.json`;
6. resolve every profile-backed channel into a temporary canonical
   `ChannelRegistry::Channel`;
7. reject unresolved, incompatible, duplicate, or unavailable assignments;
8. initialize outputs using profile-defined safe states;
9. continue normal Hardware initialization.

Add persisted fields to registry channels:

```text
physical_port_id
physical_mode_id
```

Generic channels leave these empty and retain current raw topology fields.
Profile-backed channels treat raw pin/bus/address/interface fields as derived
values. They are overwritten from the immutable profile on every load and are
never trusted from a web POST or restored engine file.

Do not reuse the existing engine `profile_id`; add distinct terms:

- `pcb_profile_id`;
- `pcb_profile_revision`;
- `pcb_profile_format`;
- `pcb_profile_origin` (`official` or `custom`).

`/api/device_info` reports these for diagnostics and update checks.

## 9. Web API and Hardware UI

Add a read-only profile summary and port catalog to `/api/hardware`, or expose a
small read-only `/api/pcb_profile` endpoint if response-size measurements favor
separation.

Generic mode must exercise the existing page unchanged.

Profile mode changes the channel editor:

- keep the existing **Add device** purpose catalog;
- replace signal type, GPIO, bus, address, and chip fields with
  **Connected to**;
- list compatible, healthy, unclaimed ports by friendly label;
- show connector and description as secondary text;
- automatically select the only compatible mode;
- ask for a mode only when two genuinely different compatible interpretations
  remain;
- show occupied ports and their owners;
- show expected-but-unhealthy hardware with a specific reason;
- retain calibration and operational endpoints that are meant for users;
- expose resolved GPIO/chip details read-only only in diagnostics/expert view.

The backend—not JavaScript—returns or validates compatible choices. A crafted
POST cannot bind a purpose to an incompatible port or alter derived wiring.

Engine-file restore requires the same PCB profile ID and revision for its
hardware assignments. A mismatched restore is rejected clearly; settings-only
import can be considered separately later.

## 10. Runtime hardware truth

The profile says what the PCB is designed to contain. Runtime drivers say
whether it is responding:

- expected I2C devices use the shared I2C manager's live health;
- SPI/OneWire and future devices expose adapter-specific health;
- a missing device makes its ports unavailable for new assignment;
- saved assignments remain visible but unhealthy;
- engine-affecting failures use the existing START-block/fault behavior;
- dependency removal remains available for user-added external devices, while a
  fixed PCB port is freed by removing its assignment—not by deleting the
  immutable device from the profile.

An official fixed device that is missing should be reported as a PCB hardware
fault. It cannot be removed from the board profile in the web UI.

## 11. Setup tool

After USB chip detection and before the erase confirmation, clean install adds a
board-type screen:

1. **ESP32 development board**
2. **Official OpenTurbine PCB**
3. **Custom PCB profile…**

Only profiles for the detected ESP chip are selectable.

The release package adds:

```text
pcb_profiles/official/*.otpcb.json
pcb_profiles/targets/esp32.json
pcb_profiles/targets/esp32-s3.json
```

and profile metadata/hashes in `manifest.json`.

For an official profile, the setup tool performs strict validation. For a
custom profile it performs only hard compatibility checks and presents
questionable choices as overridable warnings.

Hard failures:

- unreadable/malformed file;
- wrong profile format;
- wrong detected ESP chip;
- nonexistent GPIO/peripheral;
- duplicate stable IDs;
- missing required references;
- payload beyond firmware limits;
- topology the firmware cannot represent;
- output mode without a defined safe state.

Warnings for custom profiles:

- strapping/boot-sensitive pins;
- unusual shared resources;
- I2C expanders used for engine-critical outputs;
- missing feedback;
- optimistic frequency/electrical limits;
- connector or description metadata omitted.

The flasher wraps the selected JSON in the `OTPB` container and writes it to the
partition address supplied by the release manifest. Development-board mode
writes no profile after the full erase. Changing a profile always follows the
clean-install warning because old engine assignments may refer to different
physical outputs.

Wi-Fi update reads the current profile identity from `/api/device_info`, checks
that the new firmware supports its major format, and never writes `pcbprof`.

## 12. Shared target capability data

ESP32 pin capabilities must have one maintained source rather than separate
handwritten rules in firmware, browser JavaScript, Python packaging, and Go.

Add machine-readable target catalogs and generate the compact C++ tables used by
firmware. The setup tool and profile validator consume the same catalogs.
Generated-file checks in CI fail when a catalog changes without regenerating
its firmware representation.

Profiles are explicitly chip-specific. Even when two board revisions have
identical routing, publish distinct target files if they use different ESP32
variants.

## 13. Validation and test plan

### Parser and resolver

- empty partition selects generic mode;
- valid ESP32 and ESP32-S3 profiles load;
- corrupted header/CRC, truncation, wrong target, unsupported major version,
  over-limit arrays/strings, and bad references enter profile fault;
- unknown minor fields and unsupported optional adapters do not break unrelated
  ports;
- every mode resolves to the expected ChannelRegistry fields;
- exclusive/shared/composite resource ownership is correct;
- fuzz malformed profile inputs without crashes or unbounded allocation.

### Generic-mode regression

- serialized hardware defaults and Hardware UI behavior remain unchanged with
  no profile;
- both existing board builds and all current UI audits pass;
- factory reset and full engine-file backup/restore remain unchanged.

### Profile-mode UI

- adding each engine-purpose family offers only compatible ports;
- multipurpose servo/pulse input supports idle, throttle, low-frequency flow,
  switches, and shaft speed as declared;
- two MAX6675 ports appear by PCB labels;
- eight external ADC channels appear independently;
- selecting a port reserves every exclusive resource it owns;
- removing a device frees its port and dependencies;
- raw topology fields never become editable;
- crafted incompatible or raw-pin POSTs are rejected;
- disconnected expected chips are visible and cannot be newly assigned.

### Setup tool

- choice order and default are correct;
- official list filters by detected chip;
- custom browse, cancel, validation warnings, and wrong-chip rejection work;
- profile container bytes, CRC, address, and package hashes are verified before
  erase;
- dev-board flash leaves the partition empty;
- OTA preserves the exact profile bytes;
- re-profile requires the clean-install path.

### Hardware and safety

- test official profile on every PCB revision;
- verify each named port against the schematic and connector;
- scope reset/boot/runtime safe states with actuator power isolated;
- test missing I2C/SPI devices, stuck bus, shorted interrupt, stale ADC/load-cell
  data, and recovery;
- verify START inhibition and operating-engine fault behavior;
- confirm factory reset retains profile and clears only user assignments;
- swap tester/DUT and exercise representative turbine sequences.

### Resource budgets

- build both targets on every change;
- retain at least 64 KiB app-slot headroom on classic ESP32;
- measure temporary boot heap during maximum-size profile parsing;
- keep a bounded runtime catalog and verify no profile parsing occurs in the
  control loop;
- measure `/api/hardware` size and browser rendering with the maximum catalog.

## 14. Implementation phases

1. **Schema and tooling**
   - finalize JSON Schema and target catalogs;
   - add validator/container builder and example profiles;
   - add official-profile CI checks.
2. **Storage and firmware core**
   - partition tables and profile reader;
   - safe absent/valid/fault state machine;
   - bounded catalog and adapter registry;
   - device-info diagnostics.
3. **Channel resolution**
   - persisted port/mode IDs;
   - immutable derivation into ChannelRegistry;
   - resource and compatibility enforcement;
   - profile-aware restore checks.
4. **Hardware UI**
   - board summary and connected-to selector;
   - backend compatibility API;
   - occupied/unhealthy/unsupported states;
   - exact generic-mode regression.
5. **Setup tool**
   - three clean-install choices;
   - official manifest/profile packaging;
   - custom upload and permissive warnings;
   - profile partition flashing and verification.
6. **Official profile and hardware acceptance**
   - encode the official schematic;
   - schematic-to-profile peer review;
   - full bench matrix on every named port;
   - user documentation and third-party profile-author guide.

Do not begin with a large set of special cases for named sensors. Complete the
profile container, adapter contract, port resolver, and one end-to-end port of
each major signal class first; then additional chips become small adapter
additions rather than schema or UI rewrites.
