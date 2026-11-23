"""Erzeugt die App-Symbole (PNG) ohne Zusatzpakete: icons/icon-192.png, icon-512.png,
icon-maskable-512.png und apple-touch-icon.png (180 px)."""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).parent / "icons"
BG_TOP, BG_BOT = (18, 48, 86), (11, 18, 32)
ACCENT, HUB = (56, 189, 248), (230, 246, 255)


def bezier(p0, p1, p2, p3, n=24):
    pts = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3
        pts.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return pts


def rotate(pts, ang, cx, cy):
    ca, sa = math.cos(ang), math.sin(ang)
    return [(cx + (x - cx) * ca - (y - cy) * sa, cy + (x - cx) * sa + (y - cy) * ca) for x, y in pts]


def inside(poly, x, y):
    res, j = False, len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            res = not res
        j = i
    return res


def shapes(scale, dy):
    """Windrad im 24er-Raster, skaliert auf 0..1 Koordinaten."""
    def tf(p):
        return (0.5 + (p[0] - 12) / 24 * scale, 0.5 + (p[1] - 12 + dy) / 24 * scale)
    tower = [tf(p) for p in [(11.55, 11), (12.45, 11), (13, 22.5), (11, 22.5)]]
    blade = bezier((12, 10.5), (11.1, 7), (11.2, 3.4), (12, 1.2)) + bezier((12, 1.2), (12.8, 3.4), (12.9, 7), (12, 10.5))[1:]
    blades = [[tf(p) for p in rotate(blade, math.radians(a) + 0.35, 12, 10.5)] for a in (0, 120, 240)]
    hub = (*tf((12, 10.5)), 1.1 / 24 * scale)
    return tower, blades, hub


def bbox(poly):
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


def render(size, maskable, ss=3):
    scale = 0.62 if maskable else 0.78
    tower, blades, hub = shapes(scale, 1.0)
    polys = [(p, bbox(p)) for p in [tower, *blades]]
    radius = 0 if maskable else 0.22
    rows = []
    n = size * ss
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(ss):
                y = (py * ss + sy + 0.5) / n
                for sx in range(ss):
                    x = (px * ss + sx + 0.5) / n
                    # abgerundetes Quadrat
                    if radius:
                        cx = min(max(x, radius), 1 - radius)
                        cy = min(max(y, radius), 1 - radius)
                        if (x - cx) ** 2 + (y - cy) ** 2 > radius ** 2:
                            continue
                    t = (x + y) / 2
                    col = tuple(BG_TOP[i] * (1 - t) + BG_BOT[i] * t for i in range(3))
                    if (x - hub[0]) ** 2 + (y - hub[1]) ** 2 <= hub[2] ** 2:
                        col = HUB
                    else:
                        for poly, (x0, y0, x1, y1) in polys:
                            if x0 <= x <= x1 and y0 <= y <= y1 and inside(poly, x, y):
                                col = ACCENT
                                break
                    acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += 255
            k = ss * ss
            a = acc[3] / k
            if a:
                row += bytes((round(acc[0] / (acc[3] / 255)), round(acc[1] / (acc[3] / 255)), round(acc[2] / (acc[3] / 255)), round(a)))
            else:
                row += b"\0\0\0\0"
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\0" + r for r in rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)
    print(f"{path.name}: {size}px, {len(png) // 1024} KB")


def main():
    OUT.mkdir(exist_ok=True)
    for name, size, maskable in [("icon-192.png", 192, False), ("icon-512.png", 512, False),
                                 ("icon-maskable-512.png", 512, True), ("apple-touch-icon.png", 180, True)]:
        write_png(OUT / name, size, render(size, maskable))


if __name__ == "__main__":
    main()
