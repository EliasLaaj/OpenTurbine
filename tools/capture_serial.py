"""Capture an ECU UART without intentionally toggling its reset/boot lines."""

from __future__ import annotations

import argparse
import time

import serial


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("port")
    parser.add_argument("output")
    parser.add_argument("--seconds", type=float, default=600)
    args = parser.parse_args()

    uart = serial.Serial(baudrate=115200, timeout=0.2)
    uart.port = args.port
    uart.dtr = False
    uart.rts = False
    uart.open()
    deadline = time.time() + args.seconds
    with open(args.output, "w", encoding="utf-8", newline="") as log:
        while time.time() < deadline:
            raw = uart.readline()
            if raw:
                log.write(raw.decode("utf-8", errors="replace"))
                log.flush()
    uart.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
