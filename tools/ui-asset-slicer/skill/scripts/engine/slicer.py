#!/usr/bin/env python3
"""Command-line entry point for extracting visual UI assets."""

import argparse
import json
from pathlib import Path
import re
import shutil
import sys

from PIL import Image

from config import ConfigError, load_config
from pipeline import _foreground_mask, extract_region, resolve_regions
from report import alpha_metrics, build_validation, file_sha256, make_contact_sheet, write_json


SUPPORTED_SUFFIXES = {".png", ".jpg", ".jpeg"}


def _safe_name(name: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9._-]+", "-", name.strip().lower()).strip("-.")
    return normalized or "asset"


def _validate_box(box: tuple[int, int, int, int], size: tuple[int, int], name: str) -> None:
    x, y, width, height = box
    image_width, image_height = size
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > image_width or y + height > image_height:
        raise ValueError(f"region {name!r} is outside source bounds {size}: {box}")


def process_image(
    source: Path,
    output_root: Path,
    config_path: Path | None = None,
    padding: int | None = None,
    min_area: int | None = None,
    debug: bool = False,
    force: bool = False,
    write_reports: bool = True,
) -> dict:
    """Process one image and return its manifest and validation payloads."""
    source = source.resolve()
    output_root = output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    output_dir = (output_root / source.stem).resolve()
    if output_dir.parent != output_root:
        raise ValueError("output path escaped the requested output root")
    if output_dir.exists():
        if not force:
            raise FileExistsError(f"output already exists: {output_dir}; pass --force to replace it")
        shutil.rmtree(output_dir)
    assets_dir = output_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=False)

    with Image.open(source) as loaded:
        image = loaded.convert("RGB")
    config = load_config(config_path, source.name)
    effective_padding = config.padding if padding is None else padding
    effective_min_area = config.min_area if min_area is None else min_area
    if effective_padding < 0 or effective_min_area < 1:
        raise ValueError("padding must be non-negative and min-area must be positive")
    explicit = [
        {"name": region.name, "box": region.box, "action": region.action}
        for region in config.regions
    ]
    candidates = resolve_regions(image, explicit, min_area=effective_min_area)
    region_padding = {region.name: (region.padding if region.padding is not None else effective_padding)
                      for region in config.regions}
    manifest_assets: list[dict] = []
    used_names: set[str] = set()
    for candidate in candidates:
        _validate_box(candidate.box, image.size, candidate.name)
        name = _safe_name(candidate.name)
        if name in used_names:
            raise ValueError(f"duplicate output name after normalization: {candidate.name!r}")
        used_names.add(name)
        asset = extract_region(
            image,
            candidate.box,
            padding=region_padding.get(candidate.name, effective_padding),
            keep_shadows=config.keep_shadows,
        )
        asset_path = assets_dir / f"{name}.png"
        asset.save(asset_path, format="PNG")
        metrics = alpha_metrics(asset)
        manifest_assets.append({
            "name": name,
            "source_box": list(candidate.box),
            "output": str(asset_path.relative_to(output_dir)),
            "output_path": asset_path,
            "width": asset.width,
            "height": asset.height,
            "confidence": candidate.confidence,
            "source": candidate.source,
            **{key: value for key, value in metrics.items() if key != "passed"},
        })

    source_hash = file_sha256(source)
    validation = build_validation(source, image.size, source_hash, manifest_assets)
    public_assets = [{key: value for key, value in entry.items() if key != "output_path"}
                     for entry in manifest_assets]
    manifest = {
        "source": str(source),
        "source_size": list(image.size),
        "source_sha256": source_hash,
        "assets": public_assets,
    }
    if write_reports:
        write_json(output_dir / "manifest.json", manifest)
        write_json(output_dir / "validation.json", validation)
        make_contact_sheet(manifest_assets, output_dir / "contact-sheet.png")
    if debug:
        debug_dir = output_dir / "debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        debug_payload = [{
            "name": candidate.name,
            "box": list(candidate.box),
            "confidence": candidate.confidence,
            "source": candidate.source,
        } for candidate in candidates]
        write_json(debug_dir / "candidates.json", {"candidates": debug_payload})
        mask = Image.fromarray((_foreground_mask(image) * 255).astype("uint8"), mode="L")
        mask.save(debug_dir / "foreground-mask.png")
    return {"manifest": manifest, "validation": validation, "output_dir": output_dir}


def _inputs(path: Path) -> list[Path]:
    if path.is_file():
        if path.suffix.lower() not in SUPPORTED_SUFFIXES:
            raise ValueError(f"unsupported input type: {path.suffix}")
        return [path]
    if path.is_dir():
        files = sorted(item for item in path.iterdir()
                       if item.is_file() and item.suffix.lower() in SUPPORTED_SUFFIXES)
        if not files:
            raise ValueError(f"no PNG/JPG images found in {path}")
        return files
    raise FileNotFoundError(f"input does not exist: {path}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Extract visual UI assets as transparent PNGs.")
    parser.add_argument("input", type=Path, help="a PNG/JPG file or a directory of images")
    parser.add_argument("--out", required=True, type=Path, help="output root directory")
    parser.add_argument("--config", type=Path, help="optional JSON correction configuration")
    parser.add_argument("--mode", choices=["visuals"], default="visuals")
    parser.add_argument("--padding", type=int, help="extra crop padding in source pixels")
    parser.add_argument("--min-area", type=int, help="minimum automatic foreground area")
    parser.add_argument("--debug", action="store_true", help="write masks and candidate diagnostics")
    parser.add_argument("--force", action="store_true", help="replace an existing output directory")
    parser.add_argument("--no-report", action="store_true", help="skip manifest, validation, and contact sheet")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        results = []
        for source in _inputs(args.input):
            result = process_image(
                source=source,
                output_root=args.out,
                config_path=args.config,
                padding=args.padding,
                min_area=args.min_area,
                debug=args.debug,
                force=args.force,
                write_reports=not args.no_report,
            )
            results.append(result)
            print(f"Processed {source.name}: {len(result['manifest']['assets'])} assets -> {result['output_dir']}")
        if any(not result["validation"]["passed"] for result in results):
            print("Validation failed; inspect validation.json for details.", file=sys.stderr)
            return 1
        return 0
    except (ConfigError, FileExistsError, FileNotFoundError, OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
