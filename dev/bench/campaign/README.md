# Validation campaign scripts

Hardware-in-the-loop test scripts run against the DUT during the validation
campaign (see `../VALIDATION.md` for results). Each opens the tester once,
reconfigures the DUT as needed (verified), drives stimulus, and asserts.

Run any of them from this folder (they add `../harness` to the path):

```
python safety_A.py     # overspeed, overtemp, hot-start
python safety_B.py     # EGT rate-of-rise, low-oil
python safety_C.py     # RUNNING-mode: oil-zero, flameout
python safety_D.py     # pin-reuse: oil-temp-high, batt-low
python ctrl_slew.py    # throttle-slew rate limiting
python phase2_safety_hil.py  # registry-native 2.0 safety trips + physical fuel/ignition cut
python v2_controls_hil.py    # v2 pulsed starter + P1/P2 Automatic Idle physical qualification
python interaction_hil.py    # competing controllers/rules/limp/safety/STOP priority
python afterburner_limp_hil.py # AB fuel coordination versus Reduced-Power and STOP
python shutdown_output_ownership_hil.py # main-oil/scavenge ownership and cooldown override
python finalstop_live_config_hil.py # live config gate and deferred sequence-block apply
python session_logger_hil.py  # disabled/enabled session logging under live web polling
```

Set `OTBENCH_PROFILE` to one profile ID from `ten_build_webui_hil.py` to rerun
only that profile while diagnosing a failure. The original DUT configuration
is still backed up and restored.

The legacy `safety_A.py` through `safety_D.py` fixtures predate the canonical
channel registry. Do not use their result as a 2.0 safety sign-off unless their
hardware setup reports every required registry channel and safety enable as
verified. `phase2_safety_hil.py` performs those checks and aborts before START
when the profile is incomplete.

Prereqs: DUT (ESP32-S3) reachable at `http://192.168.4.1`, OTBench tester on a
COM port (edit the `Tester("COM3")` port if different), `pip install pyserial`.

Reusable helpers live in `../harness/otbench/` (`BenchRig`, `DutConfig`, `DUT`,
`Tester`). The one-off `*_demo.py` scripts (ntc/cal/tools/tot) reference absolute
scratchpad paths for data files and are kept as examples only.
