#!/usr/bin/env python3
"""OTBench harness CLI — drive the OpenTurbine HIL bench rig from the PC.

Examples:
    python run.py ports
    python run.py doctor
    python run.py monitor --secs 20
    python run.py verify-wiring
    python run.py tester GET IGNITER
    python run.py dut-cmd IGN_TEST
    python run.py run                 # basic suite
    python run.py run --advanced -v   # + sequence/start-switch tests
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from otbench import DUT, PinMap, Tester              # noqa: E402
from otbench import runner, suite                     # noqa: E402
from otbench.runner import Ctx                        # noqa: E402

try:
    from serial.tools import list_ports
except ImportError:
    list_ports = None


# ── port / object construction ───────────────────────────────
def available_ports():
    if not list_ports:
        return []
    return [p.device for p in list_ports.comports()]


def resolve_port(args):
    if args.port:
        return args.port
    env = os.environ.get("OTBENCH_PORT")
    if env:
        return env
    ports = available_ports()
    if len(ports) == 1:
        return ports[0]
    if not ports:
        sys.exit("No serial ports found. Plug in the OTBench tester or pass --port COMx.")
    sys.exit("Multiple serial ports found (%s). Choose one with --port." % ", ".join(ports))


def make_tester(args, open_it=True):
    t = Tester(resolve_port(args), baud=args.baud)
    if open_it:
        t.open()
    return t


def make_dut(args):
    return DUT(base=args.dut)


# ── commands ─────────────────────────────────────────────────
def cmd_ports(args):
    ports = available_ports()
    if not ports:
        print("(no serial ports)")
        return 0
    for p in list_ports.comports():
        print("%-8s %s" % (p.device, p.description))
    return 0


def cmd_doctor(args):
    pm = PinMap()
    print("Pin map: %s" % pm.path)
    print("  DUT %s   tester %s   %d signals"
          % (pm.meta.get("dut_board"), pm.meta.get("tester_board"), len(pm.signals)))

    print("\nTester (serial):")
    try:
        t = make_tester(args)
        print("  port %s" % t.port)
        print("  PING -> %s" % t.ping())
        sigs = t.list_signals()
        print("  %d signals reported by firmware" % len(sigs))
        t.close()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        print("  ERROR: %s" % e)

    print("\nDUT (%s):" % args.dut)
    dut = make_dut(args)
    ok, s = dut.ping()
    if ok:
        d = dut.data()
        print("  status: %s" % s)
        print("  fw=%s mode=%s dev=%s bench=%s"
              % (d.get("fw_version"), d.get("mode"), d.get("dev_mode"), d.get("bench_mode")))
    else:
        print("  UNREACHABLE: %s" % s)
        print("  (join the S3 Wi-Fi AP; default http://192.168.4.1)")
    return 0


def cmd_tester(args):
    t = make_tester(args)
    try:
        line = " ".join(args.words)
        print(t.raw(line))
    finally:
        t.close()
    return 0


def cmd_dut_data(args):
    d = make_dut(args).data()
    if args.key:
        print(d.get(args.key))
    else:
        print(json.dumps(d, indent=2))
    return 0


def cmd_dut_cmd(args):
    code, resp = make_dut(args).command(args.cmd, fParam=args.f, iParam=args.i)
    print("HTTP %s  %s" % (code, json.dumps(resp)))
    return 0 if code == 200 else 1


def cmd_dut_start(args):
    code, resp = make_dut(args).start()
    print("HTTP %s  %s" % (code, json.dumps(resp)))
    return 0 if code == 200 else 1


def cmd_dut_stop(args):
    code, resp = make_dut(args).stop()
    print("HTTP %s  %s" % (code, json.dumps(resp)))
    return 0 if code == 200 else 1


def cmd_monitor(args):
    pm = PinMap()
    t = make_tester(args)
    dut = make_dut(args)
    fields = ["mode", "n1", "tot", "oil", "throttle_effective", "oil_pct",
              "igniter_on", "fuel_sol_open", "starter_enabled"]
    print("Monitoring for %ds (Ctrl-C to stop)...\n" % args.secs)
    try:
        deadline = time.time() + args.secs
        while time.time() < deadline:
            try:
                d = dut.data()
                dut_str = "  ".join("%s=%s" % (k, d.get(k)) for k in fields)
            except Exception as e:  # noqa: BLE001
                dut_str = "DUT unreachable: %s" % e
            try:
                st = t.state()
                st_str = "  ".join("%s=%s" % (k, st[k]) for k in sorted(st))
            except Exception as e:  # noqa: BLE001
                st_str = "tester error: %s" % e
            print("DUT  " + dut_str)
            print("PINS " + st_str + "\n")
            time.sleep(args.interval)
    except KeyboardInterrupt:
        pass
    finally:
        t.close()
    return 0


def _walk(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from _walk(v, path + "/" + k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk(v, "%s[%d]" % (path, i))
    else:
        yield path, obj


def _enabled_pin(section, key):
    item = section.get(key, {}) if isinstance(section, dict) else {}
    if not isinstance(item, dict) or not item.get("enabled"):
        return set()
    pin = item.get("pin")
    return {pin} if isinstance(pin, int) and pin >= 0 else set()


def _registry_pins(hw, direction, purposes):
    registry = hw.get("channel_registry", {})
    channels = registry.get(direction, []) if isinstance(registry, dict) else []
    return {
        channel.get("pin")
        for channel in channels
        if isinstance(channel, dict)
        and channel.get("purpose") in purposes
        and isinstance(channel.get("pin"), int)
        and channel["pin"] >= 0
    }


def _configured_signal_pins(hw):
    """Return GPIOs assigned to each bench signal by the matching subsystem.

    GPIO ownership alone is insufficient: for example, I2C SDA on GPIO8 must
    not make verify-wiring claim that the optional N2 input is configured.
    Accept both legacy adapters and canonical registry channels, but only for
    the semantic role represented by each OTBench signal.
    """
    controls = hw.get("controls", {})
    sensors = hw.get("sensors", {})
    actuators = hw.get("actuators", {})

    def control_pin(key):
        pin = controls.get(key) if isinstance(controls, dict) else None
        return {pin} if isinstance(pin, int) and pin >= 0 else set()

    return {
        "START": control_pin("start_pin"),
        "STOP": control_pin("stop_pin"),
        "N1": _enabled_pin(sensors, "n1_rpm")
              | _registry_pins(hw, "inputs", {"n1_speed"}),
        "N2": _enabled_pin(sensors, "n2_rpm")
              | _registry_pins(hw, "inputs", {"n2_speed"}),
        "THROTTLE_IN": _enabled_pin(sensors, "throttle_input")
                       | _registry_pins(hw, "inputs", {"throttle"}),
        "OILP": _enabled_pin(sensors, "oil_press")
                | _registry_pins(hw, "inputs", {"oil_pressure"}),
        "FLAME": _enabled_pin(sensors, "flame")
                 | _registry_pins(hw, "inputs", {"flame"}),
        "IDLE_IN": _enabled_pin(sensors, "idle_input")
                   | _registry_pins(hw, "inputs", {"idle"}),
        "THROTTLE_OUT": _enabled_pin(actuators, "throttle")
                        | _registry_pins(hw, "outputs", {"main_fuel"}),
        "STARTER_OUT": _enabled_pin(actuators, "starter")
                       | _registry_pins(hw, "outputs", {"starter"}),
        "OILPUMP_OUT": _enabled_pin(actuators, "oil_pump")
                       | _registry_pins(hw, "outputs", {"oil_pump"}),
        "FUEL_SOL": _enabled_pin(actuators, "fuel_sol")
                    | _registry_pins(hw, "outputs", {"fuel_shutoff"}),
        "IGNITER": _enabled_pin(actuators, "igniter")
                   | _registry_pins(hw, "outputs", {"igniter"}),
        "STARTER_EN": _enabled_pin(actuators, "starter_en")
                      | _registry_pins(hw, "outputs", {"starter_en", "starter_enable"}),
    }


def cmd_verify_wiring(args):
    pm = PinMap()
    dut = make_dut(args)
    try:
        hw = dut.hardware()
    except Exception as e:  # noqa: BLE001
        sys.exit("Could not GET /api/hardware: %s" % e)
    pins = {p: v for p, v in _walk(hw)
            if p.split("/")[-1].endswith("pin") and isinstance(v, int) and v >= 0}
    signal_pins = _configured_signal_pins(hw)
    print("DUT reports these GPIOs in use:")
    for p, v in sorted(pins.items(), key=lambda kv: kv[1]):
        print("  GPIO %-3d  %s" % (v, p))
    print("\nExpected from pin map (DUT side):")
    problems = 0
    for s in pm.signals:
        g = s["dut_gpio"]
        configured = signal_pins.get(s["name"], set())
        status = "ok" if g in configured else (
            "configured on GPIO " + ", ".join(str(pin) for pin in sorted(configured))
            if configured else "NOT configured"
        )
        if g not in configured:
            problems += 1
        print("  %-13s GPIO %-3d  ot=%-22s  %s" % (s["name"], g, s["ot_signal"], status))
    print("\n%d signal(s) do not match the DUT config — enable/repin them on the Hardware page."
          % problems if problems else "\nAll pin-map GPIOs are present in the DUT config.")
    return 0


def cmd_run(args):
    pm = PinMap()
    only = set(args.only.split(",")) if args.only else None
    tests = suite.get_tests(advanced=args.advanced)
    dut = make_dut(args)
    ok, s = dut.ping()
    if not ok:
        sys.exit("DUT unreachable at %s: %s\nJoin the S3 Wi-Fi AP first." % (args.dut, s))
    t = make_tester(args)
    try:
        # Setup: safe tester pins, then make sure the DUT is idle in STANDBY
        # before any test runs (covers the ~15 s shutdown cooldown).
        t.reset()
        okm, d = dut.ensure_mode_standby(timeout=25)
        if not okm:
            print("WARNING: DUT is %s, not STANDBY — some tests may skip/fail" % d.get("mode"))
        ctx = Ctx(dut, t, pm, opts={"seq_secs": args.seq_secs})
        results = runner.run_tests(tests, ctx, only=only)
    finally:
        try:
            t.reset()
        except Exception:  # noqa: BLE001
            pass
        t.close()
    passed = runner.print_report(results, verbose=args.verbose)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump([r.to_dict() for r in results], f, indent=2)
        print("Wrote %s" % args.json)
    return 0 if passed else 1


# ── argparse ─────────────────────────────────────────────────
def build_parser():
    p = argparse.ArgumentParser(description="OTBench HIL harness for OpenTurbine")
    p.add_argument("--port", help="tester serial port (default: auto / OTBENCH_PORT env)")
    p.add_argument("--baud", type=int, default=115200)
    p.add_argument("--dut", default="http://192.168.4.1", help="DUT web API base URL")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("ports", help="list serial ports").set_defaults(func=cmd_ports)
    sub.add_parser("doctor", help="check tester + DUT connectivity").set_defaults(func=cmd_doctor)
    sub.add_parser("verify-wiring", help="compare DUT config pins to the pin map").set_defaults(func=cmd_verify_wiring)

    pt = sub.add_parser("tester", help="send a raw line to the tester")
    pt.add_argument("words", nargs="+")
    pt.set_defaults(func=cmd_tester)

    pd = sub.add_parser("dut-data", help="print /api/data (optionally one key)")
    pd.add_argument("key", nargs="?")
    pd.set_defaults(func=cmd_dut_data)

    pc = sub.add_parser("dut-cmd", help="POST /api/command")
    pc.add_argument("cmd")
    pc.add_argument("-f", type=float, default=0.0, help="fParam")
    pc.add_argument("-i", type=int, default=0, help="iParam")
    pc.set_defaults(func=cmd_dut_cmd)

    sub.add_parser("dut-start", help="POST /api/start").set_defaults(func=cmd_dut_start)
    sub.add_parser("dut-stop", help="POST /api/stop").set_defaults(func=cmd_dut_stop)

    pm = sub.add_parser("monitor", help="live DUT telemetry + tester pin reads")
    pm.add_argument("--secs", type=int, default=15)
    pm.add_argument("--interval", type=float, default=0.5)
    pm.set_defaults(func=cmd_monitor)

    pr = sub.add_parser("run", help="run the test suite")
    pr.add_argument("--advanced", action="store_true", help="also run sequence/start-switch tests")
    pr.add_argument("--only", help="comma-separated test names to run")
    pr.add_argument("--seq-secs", type=int, default=45, help="timeout for the bench sequence test")
    pr.add_argument("--json", help="write results as JSON to this path")
    pr.add_argument("-v", "--verbose", action="store_true")
    pr.set_defaults(func=cmd_run)

    return p


def main():
    args = build_parser().parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
