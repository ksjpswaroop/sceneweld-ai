#!/usr/bin/env python3
"""Create a deterministic ZIP and SHA-256 sidecar for the desktop binary."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    args = parse_args()
    binary = args.binary.resolve(strict=True)
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    archive_name = binary.name
    info = ZipInfo(archive_name, FIXED_TIMESTAMP)
    info.compress_type = ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = (0o100755 & 0xFFFF) << 16

    with ZipFile(output, "w") as archive:
        archive.writestr(info, binary.read_bytes(), compresslevel=9)

    checksum = sha256(output)
    sidecar = output.with_suffix(f"{output.suffix}.sha256")
    sidecar.write_text(f"{checksum}  {output.name}{os.linesep}", encoding="utf-8")
    print(f"{output}: {checksum}")


if __name__ == "__main__":
    main()
