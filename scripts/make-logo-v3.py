# Distribuili logo v3 — cream tile, giant glossy D, road through the counter,
# white van + parcel, lime pin. Regenerate: python3 scripts/make-logo-v3.py
# (then rebuild icon formats + DMG).
from PIL import Image, ImageDraw, ImageFont, ImageFilter

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

def vgrad(size, top, bot):
    t = Image.new("RGBA", size)
    px = t.load()
    for y in range(size[1]):
        k = y / (size[1] - 1)
        c = tuple(int(top[i] + (bot[i] - top[i]) * k) for i in range(3)) + (255,)
        for x in range(size[0]):
            px[x, y] = c
    return t

def soft_shadow(shape_fn, blur, alpha, offset=(0, 0)):
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    shape_fn(d)
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    black = Image.new("RGBA", (S, S), (0, 0, 0, alpha))
    layer = Image.composite(black, Image.new("RGBA", (S, S), (0, 0, 0, 0)), layer.split()[3])
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(layer, offset, layer)
    return out

# 1. cream tile
tile = vgrad((S, S), (0xf7, 0xfa, 0xe8), (0xe2, 0xea, 0xcf))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S, S], radius=225, fill=255)
img.paste(tile, (0, 0), mask)

# 2. giant glossy D
DFONT = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
fD = ImageFont.truetype(DFONT, 950)
DX, DY = 512, 545
img = Image.alpha_composite(img, soft_shadow(lambda d: d.text((DX, DY), "D", font=fD, fill="white", anchor="mm"), 20, 90, (0, 16)))
gmask = Image.new("L", (S, S), 0)
ImageDraw.Draw(gmask).text((DX, DY), "D", font=fD, fill=255, anchor="mm")
gbody = vgrad((S, S), (0x8a, 0xbd, 0x2f), (0x2c, 0x59, 0x0a))
img.paste(gbody, (0, 0), gmask)
gl = vgrad((S, S), (255, 255, 255), (255, 255, 255))
glm = Image.new("L", (S, S), 0)
ImageDraw.Draw(glm).text((DX, DY - 60), "D", font=fD, fill=30, anchor="mm")
ImageDraw.Draw(glm).rectangle([0, 430, S, S], fill=0)
img.paste(gl, (0, 0), glm)
d = ImageDraw.Draw(img)

# 3. thin road through the counter to the pin
road_pts = [(430, 990), (470, 830), (545, 700), (620, 560), (690, 430), (735, 345)]
img = Image.alpha_composite(img, soft_shadow(lambda d: d.line(road_pts, fill="white", width=60, joint="curve"), 12, 70, (0, 8)))
d = ImageDraw.Draw(img)
d.line(road_pts, fill=(222, 230, 214), width=46, joint="curve")
d.line(road_pts, fill="white", width=34, joint="curve")

# 4. van shadow + white van with parcel
img = Image.alpha_composite(img, soft_shadow(lambda d: d.rounded_rectangle([310, 560, 710, 810], radius=48, fill="white"), 20, 90, (0, 16)))
img = Image.alpha_composite(img, soft_shadow(lambda d: d.ellipse([280, 820, 740, 900], fill="white"), 16, 70, (0, 0)))
d = ImageDraw.Draw(img)
body = vgrad((400, 250), (255, 255, 255), (0xd9, 0xe4, 0xd2))
bm = Image.new("L", (400, 250), 0)
ImageDraw.Draw(bm).rounded_rectangle([0, 0, 400, 250], radius=48, fill=255)
img.paste(body, (310, 560), bm)
d = ImageDraw.Draw(img)
d.rectangle([310, 730, 710, 810], fill=(0x19, 0x34, 0x1a))
d.line([(520, 570), (520, 730)], fill=(0xb9, 0xc9, 0xb4), width=5)
# windshield
d.rounded_rectangle([560, 585, 680, 675], radius=20, fill=(0x14, 0x2e, 0x1e))
d.rounded_rectangle([570, 595, 670, 665], radius=14, fill=(0x9e, 0xcf, 0xee))
d.polygon([(606, 595), (628, 595), (658, 665), (636, 665)], fill="white")
# parcel on cargo
d.polygon([(365, 615), (455, 615), (455, 715), (365, 715)], fill=(0xd9, 0xa4, 0x5e))
d.polygon([(365, 615), (455, 615), (455, 638), (365, 638)], fill=(0xe8, 0xbd, 0x7e))
d.polygon([(365, 615), (455, 615), (455, 715), (365, 715)], outline=(0x9a, 0x6f, 0x32), width=4)
d.rectangle([(402, 615), (418, 715)], fill=(0x9a, 0x6f, 0x32))
# speed lines
for y, w in [(600, 90), (648, 120), (696, 70)]:
    d.rounded_rectangle([196, y, 196 + w, y + 24], radius=12, fill=(0x65, 0xa3, 0x0d))
# wheels
for wx in (400, 620):
    d.ellipse([wx - 55, 735, wx + 55, 845], fill=(0x14, 0x2e, 0x1e))
    d.ellipse([wx - 26, 764, wx + 26, 816], fill=(0xe9, 0xf3, 0xe4))
    d.ellipse([wx - 12, 778, wx + 12, 802], fill=(0x65, 0xa3, 0x0d))
# headlight
d.rounded_rectangle([694, 668, 712, 696], radius=9, fill=(0xff, 0xe1, 0x8a))

# 5. lime pin at road end
ex, ey = road_pts[-1]
img = Image.alpha_composite(img, soft_shadow(lambda d: (d.ellipse([ex - 52, ey - 128, ex + 52, ey - 24], fill="white"), d.polygon([(ex - 24, ey - 56), (ex + 24, ey - 56), (ex, ey - 2)], fill="white")), 10, 80, (0, 10)))
d = ImageDraw.Draw(img)
d.ellipse([ex - 52, ey - 128, ex + 52, ey - 24], fill=(0xa6, 0xd6, 0x3a))
d.polygon([(ex - 24, ey - 56), (ex + 24, ey - 56), (ex, ey - 2)], fill=(0xa6, 0xd6, 0x3a))
d.ellipse([ex - 52, ey - 128, ex + 52, ey - 24], outline=(0x3c, 0x74, 0x0e), width=5)
d.ellipse([ex - 23, ey - 103, ex + 23, ey - 57], fill=(0x14, 0x2e, 0x1e))
d.ellipse([ex - 23, ey - 103, ex + 23, ey - 87], fill=(0x3a, 0x55, 0x38))
d.ellipse([ex - 38, ey - 121, ex - 24, ey - 107], fill="white")

img.save("public/icons/logo-1024.png")
print("saved")
