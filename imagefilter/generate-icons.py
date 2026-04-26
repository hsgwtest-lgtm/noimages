#!/usr/bin/env python3
"""
TealGrade · generate-icons.py
Run this once to create icon-192.png and icon-512.png.
Requires only Python stdlib (struct + zlib).
"""

import struct
import zlib
import math

# ─── Palette ────────────────────────────────────────────
BG    = (12,  12,  14)
TEAL  = (0,  220, 200)
DARK  = (18,  18,  22)


def create_png_bytes(width: int, height: int, pixels: list[tuple]) -> bytes:
    """Encode RGB pixel list to raw PNG bytes using only stdlib."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)

    sig  = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))

    # Build raw scanlines (filter byte 0 = None per row)
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type: None
        for x in range(width):
            r, g, b = pixels[y * width + x]
            raw += bytes([r, g, b])

    idat = chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    iend = chunk(b'IEND', b'')

    return sig + ihdr + idat + iend


def lerp_color(a: tuple, b: tuple, t: float) -> tuple:
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def aa_circle(cx: float, cy: float, r: float, x: int, y: int) -> float:
    """Return anti-aliased coverage [0,1] for a filled circle."""
    dx, dy = x - cx, y - cy
    dist = math.sqrt(dx * dx + dy * dy)
    edge = 1.0  # AA width in pixels
    return max(0.0, min(1.0, (r - dist + edge * 0.5) / edge))


def make_icon_pixels(size: int) -> list[tuple]:
    """
    Render the TealGrade icon:
      - Dark background with subtle radial glow
      - Centered teal diamond (◈ shape)
    """
    cx, cy = size / 2.0, size / 2.0

    # Diamond half-size
    half = size * 0.30
    # Inner ring radius for the ◈ shape
    inner = half * 0.55

    pixels = []
    for y in range(size):
        for x in range(size):
            # ── Background radial glow ──────────────────
            dx, dy = (x - cx) / size, (y - cy) / size
            glow = max(0.0, 1.0 - (dx*dx + dy*dy) * 12)
            bg = lerp_color(BG, (0, 55, 50), glow * 0.4)

            # ── Diamond mask ────────────────────────────
            # Rotated square (|dx|+|dy| ≤ half)
            ax, ay = abs(x - cx), abs(y - cy)
            in_outer = (ax + ay) < (half + 1)
            in_inner = (ax + ay) < (inner - 0.5)

            if in_outer and not in_inner:
                # Teal diamond ring — with 1px AA on outer edge
                aa = min(1.0, max(0.0, (half - (ax + ay) + 1)))
                aa_in = min(1.0, max(0.0, (ax + ay) - inner + 1))
                alpha = min(aa, aa_in)
                px = lerp_color(bg, TEAL, alpha)
            elif in_inner:
                # Inner void (transparent-ish → slight teal tint)
                px = lerp_color(bg, TEAL, 0.12)
            else:
                px = bg

            pixels.append(px)

    return pixels


def write_icon(filename: str, size: int) -> None:
    pixels = make_icon_pixels(size)
    data   = create_png_bytes(size, size, pixels)
    with open(filename, 'wb') as f:
        f.write(data)
    print(f'  ✓ {filename}  ({size}×{size})')


if __name__ == '__main__':
    print('Generating TealGrade icons…')
    write_icon('icon-192.png', 192)
    write_icon('icon-512.png', 512)
    print('Done.')
