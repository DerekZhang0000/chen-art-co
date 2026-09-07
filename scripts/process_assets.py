#!/usr/bin/env python3
"""
Processes everything in assets/Named/ into assets/Processed/:
  - Videos (.mov) are muted and transcoded to browser-compatible .mp4
    (H.264/yuv420p instead of iPhone's HEVC).
  - HEIC photos (.heic) are converted to .png.
  - Already-compatible images (.jpg/.jpeg/.png) are copied through as-is.
  - Every output filename is rewritten to kebab-case.

Requires ffmpeg on PATH. No pip dependencies.

Usage:
    python scripts/process_assets.py [--force]

    --force   re-process every file even if a matching output already
              exists and is newer than its source (by default, unchanged
              files are skipped so re-runs are fast).
"""

import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = REPO_ROOT / "assets" / "Named"
DEST_DIR = REPO_ROOT / "assets" / "Processed"

HEIC_EXTS = {".heic"}
VIDEO_EXTS = {".mov"}
PASSTHROUGH_EXTS = {".jpg", ".jpeg", ".png"}


def kebab_case(stem: str) -> str:
    """'Frieren Staff and Sword 2' -> 'frieren-staff-and-sword-2'"""
    stem = stem.lower()
    stem = re.sub(r"[^a-z0-9]+", "-", stem)
    return stem.strip("-")


def is_up_to_date(source: Path, dest: Path) -> bool:
    return dest.exists() and dest.stat().st_mtime >= source.stat().st_mtime


def convert_heic_to_png(source: Path, dest: Path) -> None:
    # No -map override: HEIC photos are often stored as a grid of tiles,
    # and letting ffmpeg auto-select streams is what makes it reassemble
    # the full-resolution image instead of grabbing a single small tile.
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(source), "-frames:v", "1", "-update", "1", str(dest)],
        check=True,
        capture_output=True,
    )


def convert_video_to_mp4(source: Path, dest: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(source),
            "-an",  # mute: drop the audio track entirely
            "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-pix_fmt", "yuv420p",  # not iPhone's 10-bit HEVC - broadly decodable
            "-movflags", "+faststart",
            str(dest),
        ],
        check=True,
        capture_output=True,
    )


def process_file(source: Path) -> None:
    ext = source.suffix.lower()
    name = kebab_case(source.stem)
    rel_dir = source.parent.relative_to(SOURCE_DIR)
    out_dir = DEST_DIR / rel_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    if ext in HEIC_EXTS:
        dest = out_dir / f"{name}.png"
    elif ext in VIDEO_EXTS:
        dest = out_dir / f"{name}.mp4"
    elif ext in PASSTHROUGH_EXTS:
        dest = out_dir / f"{name}{ext}"
    else:
        print(f"  skip (unrecognized type): {source.relative_to(SOURCE_DIR)}")
        return

    if not FORCE and is_up_to_date(source, dest):
        print(f"  up to date: {dest.relative_to(DEST_DIR)}")
        return

    print(f"  {source.relative_to(SOURCE_DIR)} -> {dest.relative_to(DEST_DIR)}")
    try:
        if ext in HEIC_EXTS:
            convert_heic_to_png(source, dest)
        elif ext in VIDEO_EXTS:
            convert_video_to_mp4(source, dest)
        else:
            shutil.copy2(source, dest)
    except subprocess.CalledProcessError as err:
        print(f"    FAILED: {err.stderr.decode(errors='replace').strip().splitlines()[-1:]}")


def main() -> None:
    global FORCE
    FORCE = "--force" in sys.argv[1:]

    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg is required but wasn't found on PATH.")

    if not SOURCE_DIR.is_dir():
        sys.exit(f"Source folder not found: {SOURCE_DIR}")

    DEST_DIR.mkdir(parents=True, exist_ok=True)

    files = [p for p in SOURCE_DIR.rglob("*") if p.is_file()]
    print(f"Processing {len(files)} file(s) from {SOURCE_DIR} into {DEST_DIR}...")
    for source in files:
        process_file(source)
    print("Done.")


if __name__ == "__main__":
    main()
