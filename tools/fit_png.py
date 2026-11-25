"""Re-save each screenshot losslessly at the zlib level that lands it in the 300-350 KB the rules ask for.

Usage: python tools/fit_png.py <src dir> <dest dir>
Pixels never change: only the PNG compression level does. A file that cannot reach the band at any
level keeps the level closest to it, and the script says so.
"""
import io
import sys
from pathlib import Path

from PIL import Image

LOW, HIGH = 300_000, 350_000


def fit(src: Path, dest: Path) -> None:
    img = Image.open(src).convert("RGB")
    w, h = img.size
    assert max(w, h) <= 1440 and min(w, h) >= 800, f"{src.name}: {w}x{h} is outside the gate's sides"
    best = None
    for level in range(9, -1, -1):
        buf = io.BytesIO()
        img.save(buf, "PNG", compress_level=level, optimize=False)
        size = buf.tell()
        gap = 0 if LOW <= size <= HIGH else min(abs(size - LOW), abs(size - HIGH))
        if best is None or gap < best[0]:
            best = (gap, level, buf.getvalue())
        if gap == 0:
            break
    gap, level, data = best
    dest.write_bytes(data)
    note = "" if gap == 0 else f" (outside the band by {gap} bytes)"
    print(f"{dest.name}: {w}x{h}, zlib level {level}, {len(data)} bytes{note}")


if __name__ == "__main__":
    src_dir, dest_dir = Path(sys.argv[1]), Path(sys.argv[2])
    dest_dir.mkdir(parents=True, exist_ok=True)
    for name in ("1-board.png", "2-detail.png", "3-filtered.png"):
        fit(src_dir / name, dest_dir / name)
