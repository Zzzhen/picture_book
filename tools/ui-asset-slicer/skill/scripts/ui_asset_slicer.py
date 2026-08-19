#!/usr/bin/env python3
"""Run the bundled UI asset slicer engine from any working directory."""

from pathlib import Path
import sys


ENGINE = Path(__file__).resolve().parent / "engine"
sys.path.insert(0, str(ENGINE))

from slicer import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())
