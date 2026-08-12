"""Serial client for the OTBench tester firmware (classic ESP32).

Line protocol (see bench/firmware/src/main.cpp):
    PING / LIST / RESET / STATE
    SET <name> <value>   -> OK | ERR ...
    GET <name>           -> VAL <name> <k=v ...> | ERR ...
"""

import time

import serial  # pyserial


class TesterError(Exception):
    pass


class TesterTimeout(TesterError):
    pass


def _num(v):
    try:
        return int(v)
    except ValueError:
        try:
            return float(v)
        except ValueError:
            return v


class Tester:
    def __init__(self, port, baud=115200, timeout=2.5, boot_wait=2.0):
        self.port = port
        self.baud = baud
        self.timeout = timeout
        self.boot_wait = boot_wait
        self.ser = None
        # Classic ESP32 LEDC timer changes disable both DAC outputs. Preserve
        # the last analog stimuli and restore them as separate serial commands
        # after every N1/N2 update; this is the verified stable hardware order.
        self._held_analog = {}

    # ── lifecycle ────────────────────────────────────────────
    def open(self):
        # Prefer opening WITHOUT resetting the ESP32: holding DTR/RTS steady keeps
        # OTBench running across connects, so there's no reboot to glitch the wired
        # START line into the DUT. If the board doesn't answer (reset lines behaved
        # differently, or it hung), fall back to an explicit reset + boot wait.
        self.ser = serial.Serial(baudrate=self.baud, timeout=self.timeout)
        self.ser.port = self.port
        self.ser.dtr = False
        self.ser.rts = False
        self.ser.open()
        time.sleep(0.3)
        self.ser.reset_input_buffer()
        if not self._alive():
            self._reset_board()
        return self

    def _alive(self):
        try:
            self._send("PING")
            return self._wait_for(("OK", "ERR"), timeout=0.8).startswith("OK OTBench")
        except TesterError:
            return False

    def _reset_board(self):
        # Classic ESP32 reset: pulse EN low via RTS; IO0 (DTR) stays high -> normal boot.
        self.ser.dtr = False
        self.ser.rts = True
        time.sleep(0.12)
        self.ser.rts = False
        time.sleep(1.1)
        self.ser.reset_input_buffer()
        self._held_analog.clear()

    def close(self):
        if self.ser:
            try:
                self.ser.close()
            finally:
                self.ser = None

    def __enter__(self):
        return self.open()

    def __exit__(self, *exc):
        self.close()

    # ── framing ──────────────────────────────────────────────
    def _send(self, line):
        if not self.ser:
            raise TesterError("serial port not open")
        self.ser.reset_input_buffer()
        self.ser.write((line + "\n").encode("ascii"))
        self.ser.flush()

    def _wait_for(self, prefixes, timeout=None):
        """Read lines until one starts with any of `prefixes`; return it.
        Stray lines (boot banner, logs) are skipped."""
        deadline = time.time() + (timeout if timeout is not None else self.timeout)
        while time.time() < deadline:
            raw = self.ser.readline()
            if not raw:
                continue
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            if any(line.startswith(p) for p in prefixes):
                return line
        raise TesterTimeout("no reply starting with %s within %.1fs"
                            % ("/".join(prefixes), timeout if timeout is not None else self.timeout))

    # ── commands ─────────────────────────────────────────────
    def raw(self, line, timeout=None):
        self._send(line)
        try:
            return self._wait_for(("OK", "ERR", "VAL", "SIG"), timeout)
        except TesterTimeout:
            return ""

    def ping(self):
        self._send("PING")
        return self._wait_for(("OK", "ERR"))

    def reset(self):
        self._send("RESET")
        line = self._wait_for(("OK", "ERR"))
        if line.startswith("ERR"):
            raise TesterError(line)
        self._held_analog.clear()
        return line

    def set(self, name, value):
        line = self._cmd_retry("SET %s %s" % (name, value), ("OK", "ERR"))
        if line.startswith("ERR"):
            raise TesterError("SET %s %s -> %s" % (name, value, line))
        upper = name.upper()
        if upper in ("THROTTLE_IN", "OILP"):
            self._held_analog[upper] = value
        elif upper in ("N1", "N2"):
            for analog_name, analog_value in self._held_analog.items():
                restored = self._cmd_retry(
                    "SET %s %s" % (analog_name, analog_value), ("OK", "ERR"))
                if restored.startswith("ERR"):
                    raise TesterError(
                        "restore %s %s after %s -> %s" %
                        (analog_name, analog_value, upper, restored))
        return line

    def get(self, name):
        """Return a dict of the measured fields for an input signal."""
        line = self._cmd_retry("GET %s" % name, ("VAL", "ERR"))
        if line.startswith("ERR"):
            raise TesterError("GET %s -> %s" % (name, line))
        return self._parse_val(line)[1]

    def _cmd_retry(self, line_out, prefixes, tries=4):
        """Send a command and wait for a reply, riding out USB-serial transients.
        On a timeout the port handle is still valid, so we just flush and resend —
        we do NOT reboot the board, because a reboot glitches the DUT's START line.
        A full re-open happens only if the handle itself breaks."""
        for attempt in range(tries):
            try:
                self._send(line_out)
                return self._wait_for(prefixes)
            except TesterTimeout:
                if attempt == tries - 1:
                    raise
                time.sleep(0.15)
                try:
                    self.ser.reset_input_buffer()
                except Exception:
                    pass
            except (OSError, serial.SerialException):
                if attempt == tries - 1:
                    raise
                self._reconnect()      # port handle broken — must re-open

    def _reconnect(self):
        try:
            if self.ser:
                self.ser.close()
        except Exception:
            pass
        time.sleep(0.3)
        self.open()

    def state(self):
        """Snapshot all input signals in one round-trip -> flat dict."""
        self._send("STATE")
        line = self._wait_for(("VAL",))
        toks = line.split()
        fields = {}
        for t in toks[2:]:  # skip "VAL STATE"
            if "=" in t:
                k, v = t.split("=", 1)
                fields[k] = _num(v)
        return fields

    def list_signals(self):
        self._send("LIST")
        sigs = []
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            raw = self.ser.readline()
            if not raw:
                continue
            line = raw.decode("utf-8", errors="replace").strip()
            if line.startswith("OK"):
                break
            if line.startswith("SIG"):
                sigs.append(line)
        return sigs

    # ── helpers ──────────────────────────────────────────────
    @staticmethod
    def _parse_val(line):
        toks = line.split()
        name = toks[1] if len(toks) > 1 else ""
        fields = {}
        for t in toks[2:]:
            if "=" in t:
                k, v = t.split("=", 1)
                fields[k] = _num(v)
        return name, fields

    def get_level(self, name):
        return int(self.get(name).get("level", -1))

    def get_pwm(self, name):
        """Return (us_high, hz, duty, level)."""
        f = self.get(name)
        return f.get("us", 0), f.get("hz", 0.0), f.get("duty", 0.0), f.get("level", -1)

    # ── MAX6675 thermocouple emulator ────────────────────────
    def set_tot(self, celsius):
        """Drive the emulated TOT thermocouple. Pass a number (°C), 'open'
        (open-circuit fault), or 'off' (stop responding)."""
        self._send("SET TOT %s" % celsius)
        line = self._wait_for(("OK", "ERR"))
        if line.startswith("ERR"):
            raise TesterError("SET TOT %s -> %s" % (celsius, line))
        return line

    def get_tot(self):
        self._send("GET TOT")
        line = self._wait_for(("VAL", "ERR"))
        if line.startswith("ERR"):
            raise TesterError(line)
        return self._parse_val(line)[1]
