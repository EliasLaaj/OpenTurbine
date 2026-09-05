#!/usr/bin/env python3
"""
Compress web assets from data_src/ into data/ as .gz files.
Run this after editing any HTML/JS/CSS file, then do: pio run -t uploadfs
"""
import gzip, hashlib, os, re

from build_web_sources import main as build_web_sources

SRC = os.path.join(os.path.dirname(__file__), "..", "data_src")
DST = os.path.join(os.path.dirname(__file__), "..", "data")

EXTS = {".html", ".js", ".css"}
WEB_ASSETS = [
    "app.js.gz", "calibration.html.gz", "controllers.html.gz", "hardware.html.gz",
    "index.html.gz", "log.html.gz", "sequence.html.gz", "style.css.gz",
    "system.html.gz", "tools.html.gz", "theme.js.gz", "ui_dialog.js.gz",
]

build_web_sources()

for fname in os.listdir(SRC):
    if os.path.splitext(fname)[1] not in EXTS:
        continue
    # /config.html is a compatibility redirect served by firmware. Keep the
    # generated source for browser/static audits, but do not spend LittleFS on
    # a byte-identical second copy of the Controllers page.
    if fname == "config.html":
        continue
    src_path = os.path.join(SRC, fname)
    dst_path = os.path.join(DST, fname + ".gz")
    tmp_path = dst_path + ".tmp"
    with open(src_path, "rb") as f_in:
        data = f_in.read()
    # Normalize line endings to LF so the gzip output is byte-identical
    # regardless of the checkout OS (Windows autocrlf yields CRLF working
    # trees). Text assets only (.html/.js/.css), so this cannot corrupt bytes.
    data = data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    # Source-only HTML comments are useful to maintainers but cost scarce
    # Classic LittleFS space. They are not part of the browser contract.
    if os.path.splitext(fname)[1] == ".html":
        data = re.sub(rb"<!--(?!\[if\b).*?-->", b"", data, flags=re.DOTALL | re.IGNORECASE)
    elif os.path.splitext(fname)[1] == ".js":
        # Standalone source comments remain in data_src for maintainers, but
        # are not part of the browser contract and consume scarce Classic
        # LittleFS space. Only remove complete comment lines; inline tokens,
        # strings, regexes, and executable code remain byte-for-byte intact.
        data = re.sub(rb"(?m)^[ \t]*//[^\r\n]*(?:\r?\n|$)", b"", data)
    with open(tmp_path, "wb") as raw_out:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_out,
                           compresslevel=9, mtime=0) as f_out:
            f_out.write(data)
    os.replace(tmp_path, dst_path)
    src_kb = os.path.getsize(src_path) / 1024
    dst_kb = os.path.getsize(dst_path) / 1024
    print(f"  {fname}: {src_kb:.0f}KB -> {dst_kb:.0f}KB gz")

digest = hashlib.sha256()
for fname in WEB_ASSETS:
    digest.update(fname.encode("utf-8"))
    with open(os.path.join(DST, fname), "rb") as asset:
        for chunk in iter(lambda: asset.read(65536), b""):
            digest.update(chunk)
marker_tmp = os.path.join(DST, ".assets_complete.tmp")
with open(marker_tmp, "w", encoding="ascii", newline="\n") as marker:
    marker.write(digest.hexdigest() + "\n")
os.replace(marker_tmp, os.path.join(DST, ".assets_complete"))

print("Done. Flash with uploadfs once, or choose all generated data/*.gz files in System > Maintenance > Manual firmware & web update.")
