# OpenTurbine bench rig (hardware-in-the-loop)

> **Current final qualification:** use
> [`HIL_QUALIFICATION_PLAN.md`](HIL_QUALIFICATION_PLAN.md). Historical result
> files and the basic suite below are useful test assets, but they do not qualify
> a new release candidate until they are rerun against its exact artifact hashes
> on both ESP32 Classic and ESP32-S3. A required SKIP is a qualification gap.
> The only automated release entrypoint is `harness/qualification.py`; it fails
> closed on a skip, missing artifact, failed repetition, changed worktree, or
> configuration that was not restored. Final release signoff additionally uses
> `harness/release_signoff.py` so dry HIL cannot substitute for independent
> scope, powered-load, and cold-spin evidence.

Two ESP32s on the table, wired pin-to-pin, so OpenTurbine can be exercised end to
end with no turbine attached:

- **DUT** — an ESP32-S3 running OpenTurbine (the firmware under test).
- **Tester** — a classic ESP32 running `firmware/` (OTBench), a dumb I/O slave.
- **Brain** — the PC. It drives the tester over USB serial and the DUT over its
  Wi-Fi web API, closing the loop: inject a stimulus on one side, assert the
  other side agrees.

```
   PC ──USB serial──> OTBench tester ──wires──> OpenTurbine S3 <──Wi-Fi── PC
        (drive/read)                  (pin↔pin)              (192.168.4.1)
```

`pinmap.json` is the single source of truth for the wiring and is shared by both
the tester firmware and the PC harness.

---

## 1. Wiring

`DUT GPIO` are OpenTurbine pins (set them on the S3 Hardware page); `Tester GPIO`
are fixed in the OTBench firmware. **Every link gets a 470 Ω–1 kΩ series
resistor**, and the two boards **must share ground**.

### Tester drives → DUT inputs

| Signal      | DUT S3 | Tester | Type            | Notes |
|-------------|-------:|-------:|-----------------|-------|
| START       | 13     | 13     | digital act-low | LOW = press, Hi-Z = release |
| STOP        | 15     | 14     | digital act-low | |
| N1 (RPM)    | 14     | 4      | pulse           | square wave, freq = rpm·ppr/60 |
| THROTTLE_IN | 4      | 25     | analog (DAC)    | true DAC |
| OILP        | 1      | 26     | analog (DAC)    | true DAC |
| FLAME       | 2      | 27     | digital         | HIGH/LOW crosses the flame threshold |
| IDLE_IN     | 5      | 32     | digital · opt   | extremes only (no 3rd DAC); or tie S3 G5 to GND |

### DUT outputs → tester reads

| Signal       | DUT S3 | Tester | Type      | Notes |
|--------------|-------:|-------:|-----------|-------|
| THROTTLE_OUT | 40     | 17     | servo PWM | 1000–2000 µs @ 50 Hz |
| STARTER_OUT  | 17     | 19     | servo PWM | only if OT_HAS_STARTER |
| OILPUMP_OUT  | 11     | 21     | LEDC PWM  | ~10 kHz, duty ≈ oil % |
| FUEL_SOL     | 12     | 22     | digital   | |
| IGNITER      | 21     | 23     | digital   | LEDC capture if using PWM dwell |
| STARTER_EN   | 39     | 33     | digital   | |

Plus **GND ↔ GND**. 13 signal jumpers + 1 ground.

Only two clean analog channels are available — the classic ESP32's true DACs
(GPIO 25/26), spent on THROTTLE_IN and OILP. With no smoothing caps, FLAME (a
threshold sensor) and IDLE_IN are driven as plain digital HIGH/LOW rather than a
swept voltage. The tester avoids input-only pins (34–39, and G36/G39 aren't
broken out on this board), GPIO 16/17 (PSRAM on WROVER modules) and the strapping
pins (0/2/5/12/15) so the DUT holding a line at power-on can't stop the tester
from flashing.

**Programming precaution:** the START jumper is active-low. During a tester
reset or flash, its GPIO can briefly transition before OTBench configures it
as released (Hi-Z). Keep the DUT in bench-safe conditions and issue STOP after
programming; for a real installation, disconnect START or add a physical
pull-up while flashing the tester.

---

## 2. Set up the DUT (ESP32-S3)

On the OpenTurbine **Hardware** web page, set pins to match the `DUT GPIO`
column and enable: N1 RPM, oil pressure, flame, throttle input (ADC), idle input
(ADC), throttle ESC, oil pump, fuel solenoid, igniter. `starter_en` and starter
ESC are optional (their tests skip if absent). `verify-wiring` (below) checks the
live config against the map.

The suite toggles **Dev Mode** and **Bench Mode** itself for the sequence test;
you don't need to pre-set them.

## 3. Flash the tester (classic ESP32)

```
cd bench/firmware
pio run -t upload            # add --upload-port COMx if needed
```

## 4. Run it (from the PC)

Wired Ethernet for internet, Wi-Fi joined to the S3 AP (`192.168.4.1`). The
tester is on its own COM port — pass it explicitly since several serial devices
are usually present.

```
cd bench/harness
pip install -r requirements.txt

python run.py --port COM6 doctor            # connectivity both sides
python run.py --port COM6 verify-wiring     # DUT config vs pin map
python run.py --port COM6 monitor --secs 20 # live telemetry + pin reads
python run.py --port COM6 run               # basic suite
python run.py --port COM6 run --advanced -v # + sequence, N2 and throttle-ESC when fitted
python run.py --port COM6 run --json out.json
python run.py --port COM6 run --advanced --require-all # strict development pass
```

The basic commands are for fixture development. A release run is deliberately
long: three complete core passes, repeated safety/interaction/I2C campaigns,
100 causal plant lifecycles, and a 24-hour continuous plant soak.

```
python qualification.py --target s3 --port COM6 --fixture-revision rig-A ^
  --artifact firmware=C:\path\firmware.bin ^
  --artifact elf=C:\path\firmware.elf ^
  --artifact filesystem=C:\path\littlefs.bin ^
  --artifact partitions=C:\path\partitions.bin ^
  --artifact setup_package=C:\path\OpenTurbine-setup.zip ^
  --artifact tester_firmware=C:\path\otbench.bin ^
  --artifact pcb_profile=C:\path\profile.bin
```

The S3 DUT uses `pinmap.json` by default. For fixture development with a
Classic DUT, pass `--pinmap ..\pinmap-classic-role-reversed.json`. That file
deliberately cannot pass release mode yet: it records the present role-reversed
wiring and its missing analogue/starter transports. Replace it with the exact
completed external-fixture revision when those links are built and verified.

Use `--quick` only while developing the fixture. A quick run is permanently
marked non-qualifying even if every command succeeds. After both target result
files pass, copy `../evidence_template.json`, attach and review the independent
evidence, then run:

```
python release_signoff.py --s3 C:\results\s3\qualification.json ^
  --classic C:\results\classic\qualification.json ^
  --evidence C:\results\evidence.json --out C:\results\release-signoff.json
```

Ad-hoc probing:

```
python run.py --port COM6 tester GET IGNITER
python run.py --port COM6 tester SET N1 83
python run.py --port COM6 dut-cmd IGN_TEST
python run.py --port COM6 dut-data mode
```

Set `OTBENCH_PORT=COM6` to skip `--port`.

---

## 5. What the suite checks

- **Input paths:** RPM readback, throttle-input voltage sweep, oil-pressure
  voltage, flame threshold, STOP switch → assert DUT telemetry matches.
- **Output paths:** fire the STANDBY actuator self-tests (IGN_TEST, OIL_PRIME,
  FUEL_SOL_TEST, STARTER_EN_TEST) → assert the tester measures the pin drive.
- **Advanced:** START switch, a bench-mode timed startup that confirms the oil
  pump, ignition, configured fuel/starter actions, sequence progress, and a
  successful RUNNING outcome, plus N2 and throttle-output checks when fitted.
- **Closed-loop plant:** physical starter, oil, fuel, shutoff, and ignition
  outputs drive a deterministic low-order N1/N2/EGT/oil/flame model. The ECU
  must causally complete startup, respond to operator demand, and cut and latch
  combustion outputs on physical STOP. This is an ECU behavior oracle, not a
  turbine thermodynamic model.

## 6. Serial protocol (PC ↔ tester)

Newline-terminated ASCII, 115200 baud, one reply line per command:

```
PING                 -> OK OTBench <ver>
LIST                 -> SIG <name> <kind> gpio=<n> ...  then OK
RESET                -> OK                 (all driven outputs to safe/idle)
SET <name> <value>   -> OK | ERR ...       digital: 1/0 · freq: Hz · analog: volts
SET IDLE_IN HIGH|LOW -> OK                 (S3 role-reversed tester: static ADC rail test)
GET <name>           -> VAL <name> level=.. | us=.. hz=.. duty=.. level=..
STATE                -> VAL STATE <name>=.. ...   (all inputs in one shot)
EMU MAX6675 <C|open> -> OK                 (S3 tester in role-reversed harness)
EMU MAX31855 <C|open> -> OK
EMU MAX31856 <C|open> -> OK
EMU HX711 <counts>   -> OK
EMU OFF 0            -> OK                 (restore normal bench signal roles)
```

## 7. Limits / next steps

- **Role-reversed digital sensors:** OTBench 0.6 can emulate MAX6675, MAX31855,
  MAX31856 and HX711 traffic when the S3 is the tester and the classic ESP32 is
  the DUT. This validates GPIO transactions, decoding, fault state and ECU
  calibration, but it does not reproduce thermocouple cold-junction accuracy,
  a load-cell bridge, excitation, analogue noise, grounding or engine-bay EMI.
- **Only 2 clean analog (DAC) channels** on the tester (GPIO 25/26 → THROTTLE_IN,
  OILP). Without smoothing caps, FLAME and IDLE_IN are digital HIGH/LOW, not swept.
  In the role-reversed S3-tester build there is no DAC; `SET IDLE_IN HIGH|LOW`
  still proves the connected classic ESP32 ADC1 channel at both rails. Add an
  MCP4728 (4-ch I²C DAC) if you need calibrated intermediate-voltage sweeps.
- **NeoPixel status LED** (WS2812) isn't decoded — use a plain-GPIO status LED on
  the bench profile if you want to assert LED state.
- **Independent timing remains mandatory.** Serial/HTTP HIL proves the state and
  physical output agree, but the final STOP/fault latency claim must use a logic
  analyser or oscilloscope included in the release evidence.
- **Classic role reversal has no analogue DAC.** Full Classic qualification
  therefore needs the external DAC/device fixture specified in the final plan;
  a missing transport is a failure, not a waived skip.
- Passing dry HIL is not permission for an unattended wet start. Powered-load
  tests and a mechanically safe cold spin are explicit final signoff gates.
