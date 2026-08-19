"""Deterministic candidate detection and transparent asset extraction."""

from dataclasses import dataclass
from collections import deque

from PIL import Image, ImageFilter
import numpy as np


@dataclass(frozen=True)
class Candidate:
    name: str
    box: tuple[int, int, int, int]
    confidence: float
    source: str = "auto"


def _border_color(array: np.ndarray) -> np.ndarray:
    pixels = np.concatenate([
        array[0, :, :], array[-1, :, :], array[:, 0, :], array[:, -1, :]
    ], axis=0)
    return np.median(pixels, axis=0)


def _border_palette(array: np.ndarray, limit: int = 24) -> np.ndarray:
    border = np.concatenate([
        array[0, :, :], array[-1, :, :], array[:, 0, :], array[:, -1, :]
    ], axis=0)
    quantized = (border // 8) * 8
    values, counts = np.unique(quantized.reshape(-1, 3), axis=0, return_counts=True)
    return values[np.argsort(counts)[-limit:]]


def _palette_distance(rgb: np.ndarray, palette: np.ndarray) -> np.ndarray:
    distances = np.sqrt(np.sum(
        (rgb.astype(np.float32)[:, :, None, :] - palette[None, None, :, :]) ** 2,
        axis=3,
    ))
    return distances.min(axis=2)


def _connected_background(distance: np.ndarray, threshold: float = 24.0) -> np.ndarray:
    """Flood-fill border-connected pixels close to the local background palette."""
    height, width = distance.shape
    seed = distance <= threshold
    visited = np.zeros_like(seed, dtype=bool)
    queue = deque()
    for row, column in (
        *((0, column) for column in range(width)),
        *((height - 1, column) for column in range(width)),
        *((row, 0) for row in range(height)),
        *((row, width - 1) for row in range(height)),
    ):
        if seed[row, column] and not visited[row, column]:
            visited[row, column] = True
            queue.append((row, column))
    while queue:
        row, column = queue.popleft()
        for next_row, next_column in (
            (row - 1, column), (row + 1, column),
            (row, column - 1), (row, column + 1),
        ):
            if (0 <= next_row < height and 0 <= next_column < width and
                    seed[next_row, next_column] and not visited[next_row, next_column]):
                visited[next_row, next_column] = True
                queue.append((next_row, next_column))
    return visited


def _soft_alpha(rgb: np.ndarray, background: np.ndarray, keep_shadows: bool) -> np.ndarray:
    if max(rgb.shape[:2]) <= 120:
        distance = np.sqrt(np.sum((rgb.astype(np.float32) - background) ** 2, axis=2))
        if max(rgb.shape[:2]) <= 40:
            low, high = ((26.0, 58.0) if keep_shadows else (30.0, 62.0))
        else:
            low, high = ((18.0, 48.0) if keep_shadows else (22.0, 52.0))
        alpha = np.clip((distance - low) / (high - low), 0.0, 1.0)
        alpha[distance <= low] = 0.0
        return (alpha * 255.0).astype(np.uint8)
    palette_distance = _palette_distance(rgb, _border_palette(rgb))
    global_distance = np.sqrt(np.sum((rgb.astype(np.float32) - background) ** 2, axis=2))
    distance = np.maximum(palette_distance, global_distance * 0.65)
    low, high = ((7.0, 42.0) if keep_shadows else (14.0, 48.0))
    alpha = np.clip((distance - low) / (high - low), 0.0, 1.0)
    alpha[distance <= low] = 0.0
    alpha[_connected_background(palette_distance, threshold=40.0)] = 0.0
    return (alpha * 255.0).astype(np.uint8)


def extract_region(
    image: Image.Image,
    box: tuple[int, int, int, int],
    padding: int = 4,
    keep_shadows: bool = True,
) -> Image.Image:
    """Extract a source box and make local paper-like background transparent."""
    x, y, width, height = box
    if width <= 0 or height <= 0:
        raise ValueError("region width and height must be positive")
    crop = image.convert("RGB").crop((x, y, x + width, y + height))
    array = np.asarray(crop)
    background = _border_color(array)
    alpha = _soft_alpha(array, background, keep_shadows)
    alpha_image = Image.fromarray(alpha, mode="L").filter(ImageFilter.GaussianBlur(0.35))
    rgba = crop.convert("RGBA")
    rgba.putalpha(alpha_image)
    bbox = alpha_image.getbbox()
    if bbox is None:
        return Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    left = max(0, bbox[0] - padding)
    top = max(0, bbox[1] - padding)
    right = min(rgba.width, bbox[2] + padding)
    bottom = min(rgba.height, bbox[3] + padding)
    return rgba.crop((left, top, right, bottom))


def _foreground_mask(image: Image.Image) -> np.ndarray:
    rgb = np.asarray(image.convert("RGB"))
    background = _border_color(rgb)
    distance = np.sqrt(np.sum((rgb.astype(np.float32) - background) ** 2, axis=2))
    mask = (distance > 16.0).astype(np.uint8) * 255
    # Close small gaps so a compact illustration becomes one candidate while
    # leaving the broad paper/card background flat and filtered out.
    mask_image = Image.fromarray(mask, mode="L").filter(ImageFilter.MaxFilter(5))
    mask_image = mask_image.filter(ImageFilter.MinFilter(5))
    return np.asarray(mask_image) > 0


def _connected_components(mask: np.ndarray, min_area: int) -> list[tuple[int, int, int, int, int]]:
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    components: list[tuple[int, int, int, int, int]] = []
    for top in range(height):
        for left in range(width):
            if not mask[top, left] or visited[top, left]:
                continue
            queue = deque([(top, left)])
            visited[top, left] = True
            area = 0
            min_x = max_x = left
            min_y = max_y = top
            while queue:
                row, column = queue.popleft()
                area += 1
                min_x = min(min_x, column)
                max_x = max(max_x, column)
                min_y = min(min_y, row)
                max_y = max(max_y, row)
                for next_row, next_column in (
                    (row - 1, column), (row + 1, column),
                    (row, column - 1), (row, column + 1),
                ):
                    if (0 <= next_row < height and 0 <= next_column < width and
                            mask[next_row, next_column] and not visited[next_row, next_column]):
                        visited[next_row, next_column] = True
                        queue.append((next_row, next_column))
            if area >= min_area:
                components.append((min_x, min_y, max_x + 1, max_y + 1, area))
    return components


def auto_candidates(image: Image.Image, min_area: int = 120) -> list[Candidate]:
    """Find non-flat visual regions and filter page-scale/text-like shapes."""
    width, height = image.size
    mask = _foreground_mask(image)
    candidates: list[Candidate] = []
    for index, (left, top, right, bottom, area) in enumerate(
        _connected_components(mask, min_area), start=1
    ):
        box_width = right - left
        box_height = bottom - top
        box_area = box_width * box_height
        fill = area / max(1, box_area)
        if box_width > width * 0.80 or box_height > height * 0.35:
            continue
        if (box_width > width * 0.35 and box_height > height * 0.08) or box_area > width * height * 0.12:
            continue
        if top > height * 0.86 and box_height > 80:
            continue
        # Horizontal rows and compact glyphs are generally text, not visual assets.
        if box_height <= 55 and box_width >= box_height * 1.7:
            continue
        is_right_edge_icon = left >= width * 0.85 and box_width <= 20
        if not is_right_edge_icon and min(box_width, box_height) < 42:
            continue
        if box_width >= 80 and box_height < 80:
            continue
        if box_height <= 120 and box_width < box_height * 0.45:
            continue
        if fill < 0.015:
            continue
        confidence = min(0.99, max(0.15, 0.35 + min(0.55, area / max(1, box_area))))
        candidates.append(Candidate(
            name=f"asset-{index:03d}",
            box=(left, top, box_width, box_height),
            confidence=confidence,
        ))
    return candidates


def _overlap(left: tuple[int, int, int, int], right: tuple[int, int, int, int]) -> float:
    left_x, left_y, left_w, left_h = left
    right_x, right_y, right_w, right_h = right
    x1 = max(left_x, right_x)
    y1 = max(left_y, right_y)
    x2 = min(left_x + left_w, right_x + right_w)
    y2 = min(left_y + left_h, right_y + right_h)
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    return intersection / max(1, min(left_w * left_h, right_w * right_h))


def resolve_regions(
    image: Image.Image,
    explicit_regions: list[dict] | tuple[dict, ...] | None = None,
    min_area: int = 120,
) -> list[Candidate]:
    """Resolve explicit include/exclude regions over automatic candidates."""
    specs = list(explicit_regions or [])
    includes = [item for item in specs if item.get("action", "include") in {"include", "merge"}]
    excludes = [item for item in specs if item.get("action") == "exclude"]
    if includes:
        candidates = [Candidate(
            name=item["name"],
            box=tuple(item["box"]),
            confidence=1.0,
            source="config",
        ) for item in includes]
    else:
        candidates = auto_candidates(image, min_area=min_area)
    return [candidate for candidate in candidates if not any(
        _overlap(candidate.box, tuple(item["box"])) >= 0.35 for item in excludes
    )]
