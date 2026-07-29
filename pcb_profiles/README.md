# OpenTurbine 2.0 PCB profile authoring

A PCB profile is a chip-specific, immutable description of hardware soldered to
an ECU board. It is selected by the Windows setup tool during a USB clean
install. It is not an engine configuration and cannot be edited from the web
interface.

If no profile is flashed, OpenTurbine retains the full generic development-board
GPIO workflow.

## Start a profile

1. Copy `examples/esp32s3-example.otpcb.json`.
2. Set `target.chip` to `esp32` or `esp32-s3`.
3. Give the board and revision stable lowercase IDs. Changing physical routing
   requires a new revision.
4. Describe fixed buses and devices.
5. Describe each user-facing physical connection as one port with one or more
   electrical modes.
6. Validate it with the target catalog:

```powershell
python -X utf8 tools/pcb_profile.py pcb_profiles/examples/esp32s3-example.otpcb.json
```

To build a test container:

```powershell
python -X utf8 tools/pcb_profile.py my-board.otpcb.json --output my-board.bin
```

The setup tool accepts the JSON source file and builds this container itself.
Do not ask end users to flash the `.bin` manually.

## Mental model

- A **bus** owns fixed I2C, SPI, UART, or OneWire routing.
- A **device** is a fitted chip on a bus, or a chip with a fixed select GPIO.
- A **port** is one physical connector/channel the user recognizes.
- A **mode** says which firmware adapter can use that port.
- An engine **purpose** such as TOT, N1, idle input, or oil pump is selected by
  the end user and is not hard-coded into the PCB profile.

A multipurpose physical input can declare several modes over the same endpoint:

```json
{
  "id": "signal_input_1",
  "label": "Servo / pulse input 1",
  "connector": "J7",
  "modes": [
    {"id": "rc", "adapter": "rc_pwm_input", "endpoint": {"gpio": 16}},
    {"id": "frequency", "adapter": "pcnt_input", "endpoint": {"gpio": 16}},
    {"id": "switch", "adapter": "digital_input", "endpoint": {"gpio": 16}, "pull": "up"}
  ]
}
```

Once the user assigns the port, the whole physical port is reserved regardless
of which mode is selected.

## Supported adapters

Inputs:

- `digital_input`
- `analog_input`
- `pcnt_input`
- `rc_pwm_input`
- `pwm_duty_input`
- `spi_thermocouple`
- `onewire_temperature`
- `i2c_digital_input`
- `i2c_adc_input`
- `i2c_adc_digital_input`
- `i2c_load_cell`

Outputs:

- `digital_output`
- `relay_output`
- `pwm_output`
- `servo_output`
- `i2c_digital_output`

Unknown adapters are retained so a newer firmware can use them, but the current
firmware will not offer that mode.

Supported fitted I2C drivers currently include `tca9554`, `tla2528`, and
`nau7802`. An expected device that is absent at runtime is a PCB hardware fault.
Its ports remain visible for diagnosis but cannot be newly assigned.

## Fixed functions

`fixed_functions` can define:

- a GPIO or NeoPixel status LED;
- a buzzer;
- a global servo-output buffer enable;
- a fixed supply-voltage monitor;
- a cluster UART bus;
- a MAVLink UART bus.

These functions own their physical routing. The web UI exposes only operational
choices such as colours, baud rate, and update interval where applicable.

## Output safety

Every output mode requires `safe_demand` from 0 to 1. Fixed LED and buzzer
functions require zero. Native relay/digital outputs are parked at the declared
physical safe level before filesystem or engine configuration loading.
PWM/servo pins are held at their inactive static level until their driver owns
the pin; no waveform is emitted early. I2C output latches are set safely by the
device manager before direction changes.

All modes sharing one native output GPIO must produce the same physical boot-safe
level. The validator rejects disagreement.

Profiles cannot make reset or bootloader time electrically safe. PCB designs
must include pull resistors and driver enable circuitry that keep fuel,
ignition, starter, and other dangerous loads off while the ESP32 pins are
high-impedance.

## Validation policy

The source validator, setup tool, and firmware reject:

- a wrong ESP32 target;
- invalid or output-incapable GPIO use;
- missing IDs/references or duplicate stable IDs;
- separate ports claiming one exclusive GPIO/device channel;
- buses, chip-selects, fixed outputs, and ports colliding;
- invalid bus pin sets;
- outputs without safe demand;
- over-limit payloads/catalogs.

Custom profiles receive warnings for boot-strapping GPIOs and can continue after
review. Official profiles are strict: every warning is a release error. An
official board may list physically reviewed strap pins in
`target.reviewed_strapping_gpio`; this records a deliberate PCB-level review
rather than silently suppressing the check.

The profile source limits are 8 buses, 24 devices, 48 ports, 4 modes per port,
and a 24 KiB canonical JSON payload.

## Official profiles

Place reviewed profiles in `pcb_profiles/official/`. The release-package builder
validates them strictly, creates flash containers, hashes them, and adds only
chip-compatible choices to the setup tool.

The official OpenTurbine ECU profile is derived from its PCB project and records
its connector capabilities, fitted buses/devices, fixed supply monitor, and
output-buffer safety control.

The complete architecture and test contract are documented in
[`dev/PCB_PROFILE_DESIGN.md`](../dev/PCB_PROFILE_DESIGN.md).
