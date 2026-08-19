"""Manifests, validation evidence, and contact sheets for sliced assets."""

from hashlib import sha256
import json
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont, ImageOps
import numpy as np


def file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def alpha_metrics(image: Image.Image) -> dict:
    alpha = np.asarray(image.convert("RGBA").getchannel("A"), dtype=np.uint8)
    visible = alpha > 8
    coverage = float(np.count_nonzero(visible) / max(1, visible.size))
    corners = {
        "top_left": int(alpha[0, 0]),
        "top_right": int(alpha[0, -1]),
        "bottom_left": int(alpha[-1, 0]),
        "bottom_right": int(alpha[-1, -1]),
    }
    border = np.concatenate([
        alpha[0, :], alpha[-1, :], alpha[:, 0], alpha[:, -1]
    ])
    border_opaque_ratio = float(np.count_nonzero(border > 220) / max(1, border.size))
    warnings = []
    if coverage == 0:
        warnings.append("asset has no visible alpha pixels")
    # Keep a small antialiasing fringe acceptable; opaque paper pixels are still
    # caught by the border-opaque ratio below.
    if any(value > 16 for value in corners.values()):
        warnings.append("one or more output corners are not transparent")
    if border_opaque_ratio > 0.55:
        warnings.append("opaque pixels occupy most of the crop border")
    return {
        "alpha_coverage": round(coverage, 6),
        "corner_alpha": corners,
        "border_opaque_ratio": round(border_opaque_ratio, 6),
        "warnings": warnings,
        "passed": not warnings,
    }


def build_validation(source: Path, source_size: tuple[int, int], source_hash: str,
                     assets: Iterable[dict]) -> dict:
    asset_list = list(assets)
    warnings = [
        f"{entry['name']}: {warning}"
        for entry in asset_list
        for warning in entry.get("warnings", [])
    ]
    return {
        "passed": not warnings,
        "source": str(source),
        "source_size": list(source_size),
        "source_sha256": source_hash,
        "asset_count": len(asset_list),
        "warnings": warnings,
    }


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def make_contact_sheet(entries: list[dict], output_path: Path) -> None:
    if not entries:
        Image.new("RGB", (320, 180), "#e8e1d2").save(output_path)
        return
    columns = min(4, max(1, len(entries)))
    cell_width, cell_height = 240, 220
    rows = (len(entries) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell_width, rows * cell_height), "#f5f0e5")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, entry in enumerate(entries):
        image = Image.open(entry["output_path"]).convert("RGBA")
        checker = Image.new("RGBA", (cell_width - 24, cell_height - 48), "#f6f1e7")
        tile = 16
        tile_color = "#e4ddd0"
        tile_layer = Image.new("RGBA", checker.size, "#f6f1e7")
        tile_draw = ImageDraw.Draw(tile_layer)
        for y in range(0, checker.height, tile):
            for x in range(0, checker.width, tile):
                if (x // tile + y // tile) % 2:
                    tile_draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill=tile_color)
        thumbnail = ImageOps.contain(image, (checker.width - 12, checker.height - 12))
        checker.alpha_composite(tile_layer)
        checker.alpha_composite(thumbnail, ((checker.width - thumbnail.width) // 2,
                                            (checker.height - thumbnail.height) // 2))
        x = (index % columns) * cell_width + 12
        y = (index // columns) * cell_height + 8
        sheet.paste(checker.convert("RGB"), (x, y))
        draw.text((x, y + checker.height + 4), entry["name"], fill="#3c342a", font=font)
    sheet.save(output_path)
