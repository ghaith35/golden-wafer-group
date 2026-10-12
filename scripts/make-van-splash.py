# Van APK splash screens — crisp regeneration (light theme).
# Light, impressive launch screen: white→pale-lime gradient, radial glow,
# big soft-shadowed logo tile, letter-spaced wordmark. The tile always comes
# from the 1254px master by DOWNSCALE only (LANCZOS) — never upscaled.
# Regenerate: python3 scripts/make-van-splash.py
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO = os.path.join(ROOT, "public", "icons", "logo-source.png")
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")

TOP = (255, 255, 255)       # white
BOT = (238, 250, 222)       # pale lime
GLOW = (255, 255, 255)      # white highlight behind the tile
INK = (22, 33, 11)          # deep green-slate wordmark
LIME = (77, 124, 15)        # lime-700 sub-brand
RULE = (132, 190, 60)       # accent rule

# (res dir, width, height) — exact native pixels per density bucket
TARGETS = [
    ("drawable-port-mdpi", 320, 480),
    ("drawable-port-hdpi", 480, 800),
    ("drawable-port-xhdpi", 720, 1280),
    ("drawable-port-xxhdpi", 960, 1600),
    ("drawable-port-xxxhdpi", 1280, 1920),
    ("drawable-land-mdpi", 480, 320),
    ("drawable-land-hdpi", 800, 480),
    ("drawable-land-xhdpi", 1280, 720),
    ("drawable-land-xxhdpi", 1600, 960),
    ("drawable-land-xxxhdpi", 1920, 1280),
    ("drawable", 1080, 1920),  # unqualified fallback
]

FONT_CANDIDATES = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/ArialHB.ttc",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def vgrad(w, h):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        k = y / max(1, h - 1)
        c = tuple(int(TOP[i] + (BOT[i] - TOP[i]) * k) for i in range(3))
        for x in range(w):
            px[x, y] = c
    return img


def draw_tracked(d, cx, y, text, font, fill):
    """Centered letter-spaced caps line. Returns its height."""
    tracking = max(1, int(font.size * 0.18))
    widths = [d.textlength(ch, font=font) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = cx - total / 2
    ascent, descent = font.getmetrics()
    for ch, wch in zip(text, widths):
        d.text((x, y), ch, font=font, fill=fill)
        x += wch + tracking
    return ascent + descent


def soft_spot(base, box, color, blur, opacity=1.0):
    """Paste a blurred ellipse of `color`. Correct pattern: the blurred mask
    becomes the layer's ALPHA (putalpha). Using Image.composite instead mixes
    the transparent image's black RGB into every half-mask pixel and leaves
    a gray veil — that bug cost an hour."""
    w, h = base.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse(box, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(blur))
    if opacity < 1.0:
        mask = mask.point(lambda v: int(v * opacity))
    layer = Image.new("RGBA", (w, h), color + (255,))
    layer.putalpha(mask)
    return Image.alpha_composite(base, layer)


def render(w, h):
    img = vgrad(w, h).convert("RGBA")
    d = ImageDraw.Draw(img)
    portrait = h >= w
    cx = w / 2

    # Soft white highlight behind the logo (mask-blurred: no gray halo).
    glow_r = int(min(w, h) * (0.36 if portrait else 0.30))
    glow_cy = int(h * (0.42 if portrait else 0.50))
    img = soft_spot(img, [cx - glow_r, glow_cy - glow_r, cx + glow_r, glow_cy + glow_r],
                    GLOW, max(8, glow_r // 3))
    d = ImageDraw.Draw(img)

    # Logo tile: big, always downscaled from the 1254px master.
    tile = Image.open(LOGO).convert("RGBA")
    side = int((w * 0.52) if portrait else (h * 0.56))
    side = min(side, 1000)
    tile = tile.resize((side, side), Image.LANCZOS)

    # Floor shadow + paste: portrait places immediately; landscape defers
    # both to the measured branch below (tile shrinks to fit the row).
    r = side // 2
    if portrait:
        tx, ty = cx - r, glow_cy - r
        img = soft_spot(img, [tx + side * 0.10, ty + side * 0.86, tx + side * 0.90, ty + side * 1.04],
                        (46, 80, 20), 12, opacity=0.5)
        img.paste(tile, (int(tx), int(ty)), tile)
        d = ImageDraw.Draw(img)
    d = ImageDraw.Draw(img)

    title_font = load_font(max(12, int(w * 0.075)) if portrait else max(12, int(h * 0.10)))
    sub_font = load_font(max(10, int(w * 0.036)) if portrait else max(10, int(h * 0.05)))

    if portrait:
        y = int(ty + side + h * 0.045)
        th = draw_tracked(d, cx, y, "DISTRIBUILI", title_font, INK)
        y += th + int(h * 0.012)
        # Accent rule.
        rw = int(w * 0.16)
        d.rounded_rectangle([cx - rw / 2, y, cx + rw / 2, y + max(2, h // 480)], radius=2, fill=RULE)
        y += int(h * 0.016)
        draw_tracked(d, cx, y, "VAN", sub_font, LIME)
    else:
        # Row layout, measured then centered: tile + gap + text block.
        # The tile shrinks until the whole row fits with margins.
        gap = int(w * 0.045)
        t_dili = "DISTRIBUILI"
        tracking = max(1, int(title_font.size * 0.18))
        tw = sum(d.textlength(ch, font=title_font) for ch in t_dili) + tracking * (len(t_dili) - 1)
        b0 = d.textbbox((0, 0), t_dili, font=title_font)
        th = b0[3] - b0[1]
        b1 = d.textbbox((0, 0), "VAN", font=sub_font)
        sh_ = b1[3] - b1[1]
        max_side = int(min(h * 0.52, w - tw - gap * 2 - w * 0.10))
        side = min(side, max(64, max_side))
        tile = tile.resize((side, side), Image.LANCZOS)
        row_w = side + gap + tw
        tx = int((w - row_w) / 2)
        text_h = th + int(h * 0.03) + sh_
        ty_tile = int(h / 2 - side / 2)
        img = soft_spot(img, [tx + side * 0.10, ty_tile + side * 0.86, tx + side * 0.90, ty_tile + side * 1.04],
                        (46, 80, 20), 12, opacity=0.5)
        img.paste(tile, (tx, ty_tile), tile)
        d = ImageDraw.Draw(img)
        ty = int(h / 2 - text_h / 2)
        tx2 = int(tx + side + gap)
        x = tx2
        for ch in t_dili:
            d.text((x, ty), ch, font=title_font, fill=INK)
            x += d.textlength(ch, font=title_font) + tracking
        ty += th + int(h * 0.02)
        rw = int(tw * 0.35)
        d.rounded_rectangle([tx2, ty, tx2 + rw, ty + max(2, h // 360)], radius=2, fill=RULE)
        ty += int(h * 0.025)
        x = tx2
        tracking2 = max(1, int(sub_font.size * 0.18))
        for ch in "VAN":
            d.text((x, ty), ch, font=sub_font, fill=LIME)
            x += d.textlength(ch, font=sub_font) + tracking2
    return img.convert("RGB")


def main():
    for dirname, w, h in TARGETS:
        out = os.path.join(RES, dirname, "splash.png")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        render(w, h).save(out, optimize=True)
        print(f"{dirname}/splash.png {w}x{h}")


if __name__ == "__main__":
    main()
