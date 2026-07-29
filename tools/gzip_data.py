#!/usr/bin/env python3
"""
Compress web assets from data_src/ into data/ as .gz files.
Run this after editing any HTML/JS/CSS file, then do: pio run -t uploadfs
"""
import gzip, os

from build_web_sources import main as build_web_sources

SRC = os.path.join(os.path.dirname(__file__), "..", "data_src")
DST = os.path.join(os.path.dirname(__file__), "..", "data")

EXTS = {".html", ".js", ".css"}

build_web_sources()

for fname in os.listdir(SRC):
    if os.path.splitext(fname)[1] not in EXTS:
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
    with open(tmp_path, "wb") as raw_out:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_out,
                           compresslevel=9, mtime=0) as f_out:
            f_out.write(data)
    os.replace(tmp_path, dst_path)
    src_kb = os.path.getsize(src_path) / 1024
    dst_kb = os.path.getsize(dst_path) / 1024
    print(f"  {fname}: {src_kb:.0f}KB -> {dst_kb:.0f}KB gz")

print("Done. Flash with uploadfs once, or choose all generated data/*.gz files in Tools > Web UI Assets Update.")
