"""Validated JSON configuration for the UI asset slicer."""

from dataclasses import dataclass, field
import json
from pathlib import Path
from typing import Any


class ConfigError(ValueError):
    """Raised when a slicer configuration cannot be used safely."""


@dataclass(frozen=True)
class RegionSpec:
    name: str
    box: tuple[int, int, int, int]
    action: str = "include"
    padding: int | None = None


@dataclass(frozen=True)
class SlicerConfig:
    padding: int = 4
    keep_shadows: bool = True
    min_area: int = 120
    regions: tuple[RegionSpec, ...] = field(default_factory=tuple)


def _positive_int(value: Any, path: str, default: int) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ConfigError(f"{path} must be a non-negative integer")
    return value


def load_config(path: Path | None, image_name: str) -> SlicerConfig:
    """Load defaults and the selected image's region overrides."""
    if path is None:
        return SlicerConfig()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ConfigError(f"cannot read config {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ConfigError(f"config is not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise ConfigError("config root must be an object")

    defaults = raw.get("defaults", {})
    images = raw.get("images", {})
    if not isinstance(defaults, dict):
        raise ConfigError("defaults must be an object")
    if not isinstance(images, dict):
        raise ConfigError("images must be an object")
    image = images.get(image_name, {})
    if not isinstance(image, dict):
        raise ConfigError(f"images.{image_name} must be an object")

    region_items = image.get("regions", [])
    if not isinstance(region_items, list):
        raise ConfigError(f"images.{image_name}.regions must be an array")

    regions: list[RegionSpec] = []
    for index, item in enumerate(region_items):
        prefix = f"images.{image_name}.regions[{index}]"
        if not isinstance(item, dict):
            raise ConfigError(f"{prefix} must be an object")
        name = item.get("name")
        box = item.get("box")
        action = item.get("action", "include")
        if not isinstance(name, str) or not name.strip():
            raise ConfigError(f"{prefix}.name must be a non-empty string")
        if (not isinstance(box, list) or len(box) != 4 or
                any(isinstance(value, bool) or not isinstance(value, int) for value in box) or
                box[0] < 0 or box[1] < 0 or box[2] <= 0 or box[3] <= 0):
            raise ConfigError(f"{prefix}.box must be [x, y, width, height] with positive size")
        if action not in {"include", "exclude", "merge"}:
            raise ConfigError(f"{prefix}.action must be include, exclude, or merge")
        padding = item.get("padding")
        if padding is not None:
            padding = _positive_int(padding, f"{prefix}.padding", 0)
        regions.append(RegionSpec(name.strip(), tuple(box), action, padding))

    names = [region.name for region in regions]
    if len(names) != len(set(names)):
        raise ConfigError(f"images.{image_name}.regions contains duplicate names")
    return SlicerConfig(
        padding=_positive_int(defaults.get("padding"), "defaults.padding", 4),
        keep_shadows=bool(defaults.get("keep_shadows", True)),
        min_area=_positive_int(defaults.get("min_area"), "defaults.min_area", 120),
        regions=tuple(regions),
    )
