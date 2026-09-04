"""Upload one OpenTurbine firmware image through the bounded OTA endpoint."""

import argparse
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("firmware", type=Path)
    parser.add_argument("--base", default="http://192.168.4.1")
    parser.add_argument("--chunk", type=int, default=4096)
    args = parser.parse_args()

    image = args.firmware.read_bytes()
    if not image:
        raise SystemExit("Firmware image is empty")
    offset = 0
    while offset < len(image):
        payload = image[offset : offset + args.chunk]
        final = offset + len(payload) == len(image)
        query = urllib.parse.urlencode({"offset": offset, "final": int(final)})
        request = urllib.request.Request(
            args.base.rstrip("/") + "/api/firmware_chunk?" + query,
            data=payload,
            method="POST",
            headers={"Content-Type": "application/octet-stream", "Connection": "close"},
        )
        last_error = None
        for attempt in range(5):
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    result = json.loads(response.read().decode("utf-8"))
                if not result.get("ok"):
                    raise RuntimeError(result)
                break
            except Exception as error:  # transport recovery is offset-safe
                last_error = error
                if attempt == 4:
                    raise
                time.sleep(0.8)
        else:  # pragma: no cover - loop either breaks or raises
            raise last_error
        offset += len(payload)
        print(f"\r{offset}/{len(image)} bytes", end="", flush=True)
    print("\nOTA accepted; waiting for reboot")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
