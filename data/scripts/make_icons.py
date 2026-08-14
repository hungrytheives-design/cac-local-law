#!/usr/bin/env python3
"""Generate the app icon, splash mark and favicon. Stdlib only.

    python3 data/scripts/make_icons.py

Writes into app/assets/, overwriting the create-expo-app boilerplate.

WHY THIS IS A SCRIPT AND NOT A PNG SOMEBODY DREW
------------------------------------------------
The palette is going to change at least once before October, and hand-editing
six PNGs every time is how you end up with an icon that does not match the app.
Here the colors live in one place (PALETTE below), and every asset regenerates
in about two seconds.

There is no Pillow and no SVG rasterizer on the build machine, so this contains
a small PNG writer (zlib is stdlib, PNG framing is about 20 lines) and draws
shapes with signed distance fields, which gives clean antialiased edges without
supersampling.

THE MARK
--------
A sage leaf. Nevada is the Sagebrush State and "sage" also means wise counsel,
which is the whole pitch. Geometrically a leaf is the overlap of two circles,
so the shape is two distance tests and a rounded stem. It stays readable at
favicon size, which rules out anything more detailed.
"""

import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "app", "assets")

# Keep in sync with the C palette in app/App.tsx.
PALETTE = {
    "cream": (242, 237, 225),
    "sage": (94, 115, 81),
    "sage_deep": (74, 92, 63),
    "white": (255, 255, 255),
}


# ------------------------------------------------------------------ png writer

def write_png(path, w, h, px):
    """px is a bytearray of w*h*4 RGBA bytes."""
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)  # filter type 0 (none) for each scanline
        raw += px[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    blob = b"\x89PNG\r\n\x1a\n"
    blob += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    blob += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    blob += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(blob)


# ------------------------------------------------------------- shape math (sdf)

def leaf_sdf(x, y, scale, tilt):
    """Signed distance to a leaf. Negative inside.

    A leaf is the lens where two equal circles overlap. Offsetting their centers
    by 0.62r gives a height:width ratio near 2.06, which reads as 'leaf' rather
    than 'eye' or 'seed'.
    """
    c, s = math.cos(tilt), math.sin(tilt)
    xr = (x * c - y * s) / scale
    yr = (x * s + y * c) / scale

    r, a = 1.0, 0.62
    d1 = math.hypot(xr - a, yr) - r
    d2 = math.hypot(xr + a, yr) - r
    leaf = max(d1, d2)  # intersection of the two discs

    # Stem: a capsule from the lower tip, angled to match the tilt.
    ty = 0.784           # lower tip of the lens, sqrt(r^2 - a^2)
    sx, sy = 0.0, ty
    ex, ey = 0.20, ty + 0.42
    vx, vy = ex - sx, ey - sy
    px, py = xr - sx, yr - sy
    t = max(0.0, min(1.0, (px * vx + py * vy) / (vx * vx + vy * vy)))
    stem = math.hypot(px - vx * t, py - vy * t) - 0.052

    return min(leaf, stem) * scale


def midrib_sdf(x, y, scale, tilt):
    """The vein. Drawn as negative space so the leaf reads at small sizes."""
    c, s = math.cos(tilt), math.sin(tilt)
    xr = (x * c - y * s) / scale
    yr = (x * s + y * c) / scale
    sx, sy = 0.0, -0.70
    ex, ey = 0.0, 0.72
    vx, vy = ex - sx, ey - sy
    px, py = xr - sx, yr - sy
    t = max(0.0, min(1.0, (px * vx + py * vy) / (vx * vx + vy * vy)))
    # Taper the vein toward both ends so it does not look like a stuck-on bar.
    width = 0.026 * (1.0 - abs(t - 0.5) * 1.5)
    return (math.hypot(px - vx * t, py - vy * t) - max(width, 0.004)) * scale


def coverage(d, px):
    """Antialias: convert a signed distance to 0..1 coverage across one pixel."""
    return max(0.0, min(1.0, 0.5 - d / px))


def auto_center(scale, tilt, probe=96):
    """Return the (x, y) pixel offset that centres the mark in its frame.

    The leaf is defined about the origin but the stem hangs off one end, so the
    drawn shape's midpoint is nowhere near (0, 0), and rotating it moves that
    midpoint again. Rather than hand-tuning constants that go stale the moment
    the tilt changes, measure the bounding box of what actually gets drawn on a
    small probe grid and correct by half its offset.
    """
    span = scale * 3.0  # generous: the shape never exceeds ~1.3 * scale
    lo_x = lo_y = 1e9
    hi_x = hi_y = -1e9
    step = (2 * span) / probe
    for i in range(probe + 1):
        py = -span + i * step
        for j in range(probe + 1):
            pxx = -span + j * step
            # The vein is negative space inside the leaf, so the leaf alone
            # defines the bounding box.
            if leaf_sdf(pxx, py, scale, tilt) <= 0:
                lo_x = min(lo_x, pxx); hi_x = max(hi_x, pxx)
                lo_y = min(lo_y, py);  hi_y = max(hi_y, py)
    if hi_x < lo_x:
        return 0.0, 0.0
    return -(lo_x + hi_x) / 2.0, -(lo_y + hi_y) / 2.0


def render(size, bg, fg, mark_scale, vein=True):
    """bg=None means transparent. Returns an RGBA bytearray."""
    buf = bytearray(size * size * 4)
    px = 1.0  # one pixel in device units
    cx = cy = size / 2.0
    scale = size * mark_scale
    tilt = math.radians(-18)
    ox, oy = auto_center(scale, tilt)

    br, bgc, bb = bg if bg else (0, 0, 0)
    fr, fgc, fb = fg

    for y in range(size):
        dy = y + 0.5 - cy - oy
        row = y * size * 4
        for x in range(size):
            dx = x + 0.5 - cx - ox
            a_leaf = coverage(leaf_sdf(dx, dy, scale, tilt), px)
            if vein and a_leaf > 0:
                a_leaf *= 1.0 - coverage(midrib_sdf(dx, dy, scale, tilt), px)

            i = row + x * 4
            if bg:
                r = br + (fr - br) * a_leaf
                g = bgc + (fgc - bgc) * a_leaf
                b = bb + (fb - bb) * a_leaf
                buf[i:i + 4] = bytes((int(r + 0.5), int(g + 0.5), int(b + 0.5), 255))
            else:
                buf[i:i + 4] = bytes((fr, fgc, fb, int(a_leaf * 255 + 0.5)))
    return buf


# ------------------------------------------------------------------------ main

def main():
    cream = PALETTE["cream"]
    sage = PALETTE["sage"]
    white = PALETTE["white"]
    os.makedirs(OUT, exist_ok=True)

    jobs = [
        # iOS icon is full-bleed and opaque; the system rounds the corners.
        ("icon.png", 1024, cream, sage, 0.34, True),
        # Splash mark sits on the splash backgroundColor, so keep it transparent.
        ("splash-icon.png", 1024, None, sage, 0.30, True),
        # Android adaptive foreground gets cropped: keep the mark inside ~66%.
        ("android-icon-foreground.png", 1024, None, sage, 0.24, True),
        ("android-icon-background.png", 1024, cream, cream, 0.001, False),
        # Monochrome (themed icons) must be a flat silhouette, no vein.
        ("android-icon-monochrome.png", 1024, None, white, 0.22, False),
        ("favicon.png", 64, cream, sage, 0.32, False),
    ]

    for name, size, bg, fg, ms, vein in jobs:
        buf = render(size, bg, fg, ms, vein)
        path = os.path.join(OUT, name)
        write_png(path, size, size, buf)
        kb = os.path.getsize(path) / 1000
        print(f"  {name:<34} {size}x{size}  {kb:6.1f} kB")

    print(f"\nwrote {len(jobs)} assets to app/assets/")


if __name__ == "__main__":
    main()
