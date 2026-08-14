"""Knock out black backgrounds, crop, and report layout metrics for HUD assets."""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageStat

ASSETS = Path(
    r"C:\Users\valle\.cursor\projects\c-Users-valle-Desktop-Juegos-Boli-Boli\assets"
)
OUT = Path(r"C:\Users\valle\Desktop\Juegos\Boli\Boli\public\hud")
OUT.mkdir(parents=True, exist_ok=True)

FILES = {
    "vida": "c__Users_valle_AppData_Roaming_Cursor_User_workspaceStorage_4242cb2c20de6e9876e0529323ef80fa_images_ChatGPT_Image_14_ago_2026__09_00_30-32cfee2c-3b9c-48b5-967e-3c9a8b6fc69c.png",
    "municion": "c__Users_valle_AppData_Roaming_Cursor_User_workspaceStorage_4242cb2c20de6e9876e0529323ef80fa_images_ChatGPT_Image_14_ago_2026__09_06_51-e36826bd-6dbb-4bad-978a-d26f27e39614.png",
    "comunicado": "c__Users_valle_AppData_Roaming_Cursor_User_workspaceStorage_4242cb2c20de6e9876e0529323ef80fa_images_ChatGPT_Image_14_ago_2026__09_06_49-e6b4a10c-b481-4e03-8eda-9f6e7a8df746.png",
}


def is_bg(r: int, g: int, b: int) -> bool:
    return r < 28 and g < 28 and b < 28 and max(r, g, b) - min(r, g, b) < 12


def flood_alpha(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    seen = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()

    def push(x: int, y: int) -> None:
        i = y * w + x
        if seen[i]:
            return
        r, g, b, _ = px[x, y]
        if not is_bg(r, g, b):
            return
        seen[i] = 1
        q.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)

    while q:
        x, y = q.popleft()
        r, g, b, _ = px[x, y]
        lum = (r + g + b) / 3
        a = 0 if lum < 18 else int(max(0, min(255, (lum - 18) * 10)))
        px[x, y] = (r, g, b, a)
        if x > 0:
            push(x - 1, y)
        if x + 1 < w:
            push(x + 1, y)
        if y > 0:
            push(x, y - 1)
        if y + 1 < h:
            push(x, y + 1)
    return rgba


def content_box(im: Image.Image, pad: int = 8) -> tuple[int, int, int, int]:
    w, h = im.size
    px = im.load()
    minx, miny, maxx, maxy = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 12:
                if x < minx:
                    minx = x
                if y < miny:
                    miny = y
                if x > maxx:
                    maxx = x
                if y > maxy:
                    maxy = y
    return (
        max(0, minx - pad),
        max(0, miny - pad),
        min(w, maxx + 1 + pad),
        min(h, maxy + 1 + pad),
    )


def connected_blobs(
    im: Image.Image,
    pred,
    min_area: int = 80,
) -> list[tuple[int, int, int, int, int]]:
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    blobs: list[tuple[int, int, int, int, int]] = []
    for y0 in range(h):
        for x0 in range(w):
            i0 = y0 * w + x0
            if seen[i0]:
                continue
            r, g, b, a = px[x0, y0]
            if a < 40 or not pred(r, g, b):
                seen[i0] = 1
                continue
            q = deque([(x0, y0)])
            seen[i0] = 1
            minx = maxx = x0
            miny = maxy = y0
            area = 0
            while q:
                x, y = q.popleft()
                area += 1
                if x < minx:
                    minx = x
                if x > maxx:
                    maxx = x
                if y < miny:
                    miny = y
                if y > maxy:
                    maxy = y
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    ni = ny * w + nx
                    if seen[ni]:
                        continue
                    rr, gg, bb, aa = px[nx, ny]
                    if aa < 40 or not pred(rr, gg, bb):
                        seen[ni] = 1
                        continue
                    seen[ni] = 1
                    q.append((nx, ny))
            if area >= min_area:
                blobs.append((minx, miny, maxx, maxy, area))
    blobs.sort(key=lambda b: b[0])
    return blobs


def is_red(r: int, g: int, b: int) -> bool:
    return r > 150 and r > g + 40 and r > b + 40 and g < 140


def is_gray_heart(r: int, g: int, b: int) -> bool:
    return abs(r - g) < 22 and abs(g - b) < 22 and 90 < r < 190 and 90 < g < 190


def is_gold(r: int, g: int, b: int) -> bool:
    return r > 180 and g > 140 and b < 90 and r >= g


def is_cream(r: int, g: int, b: int) -> bool:
    return r > 210 and g > 200 and b > 180 and abs(r - g) < 40


def is_bar_blue(r: int, g: int, b: int) -> bool:
    return b > 140 and b > r + 30 and b > g + 10 and r < 140


def sample_rect(im: Image.Image, box: tuple[int, int, int, int]) -> tuple[int, int, int]:
    crop = im.crop(box).convert("RGB")
    stat = ImageStat.Stat(crop)
    return tuple(int(v) for v in stat.mean[:3])  # type: ignore[return-value]


def process(name: str, filename: str) -> None:
    src = Image.open(ASSETS / filename)
    rgba = flood_alpha(src)
    box = content_box(rgba, pad=10)
    cropped = rgba.crop(box)
    cropped.save(OUT / f"{name}.png", optimize=True)
    w, h = cropped.size
    print(f"\n=== {name} ===")
    print(f"saved {w}x{h}  crop={box}")

    if name == "vida":
        reds = connected_blobs(cropped, is_red, min_area=120)
        grays = connected_blobs(cropped, is_gray_heart, min_area=120)
        print("red hearts", [(b[0], b[1], b[2] - b[0], b[3] - b[1], b[4]) for b in reds])
        print("gray hearts", [(b[0], b[1], b[2] - b[0], b[3] - b[1], b[4]) for b in grays])
        hearts = [b for b in reds + grays if 20 < (b[2] - b[0]) < 120]
        hearts.sort(key=lambda b: b[0])
        print("heart pct:")
        for b in hearts:
            cx = (b[0] + b[2]) / 2 / w * 100
            cy = (b[1] + b[3]) / 2 / h * 100
            bw = (b[2] - b[0]) / w * 100
            bh = (b[3] - b[1]) / h * 100
            print(f"  left={cx:.2f}% top={cy:.2f}% w={bw:.2f}% h={bh:.2f}%")
        blues = connected_blobs(cropped, is_bar_blue, min_area=400)
        print("blue regions", [(b[0], b[1], b[2] - b[0], b[3] - b[1]) for b in blues[:8]])

    if name == "municion":
        golds = connected_blobs(cropped, is_gold, min_area=80)
        print("gold", [(b[0], b[1], b[2] - b[0], b[3] - b[1], b[4]) for b in golds])
        print("bullet pct:")
        for b in golds:
            cx = (b[0] + b[2]) / 2 / w * 100
            cy = (b[1] + b[3]) / 2 / h * 100
            bw = (b[2] - b[0]) / w * 100
            bh = (b[3] - b[1]) / h * 100
            print(f"  left={cx:.2f}% top={cy:.2f}% w={bw:.2f}% h={bh:.2f}%")

    if name == "comunicado":
        creams = connected_blobs(cropped, is_cream, min_area=2000)
        print("cream", [(b[0], b[1], b[2] - b[0], b[3] - b[1], b[4]) for b in creams])
        for b in creams:
            print(
                "cream pct",
                f"left={b[0]/w*100:.2f}% top={b[1]/h*100:.2f}%",
                f"right={(w-b[2])/w*100:.2f}% bottom={(h-b[3])/h*100:.2f}%",
            )


for key, fname in FILES.items():
    process(key, fname)
print("\ndone")
