from PIL import Image, ImageDraw, ImageFont
import math
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

# tile: deep lime gradient + rounded mask
tile = vgrad((S, S), (0x86, 0xbb, 0x1c), (0x2e, 0x4a, 0x0c))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S, S], radius=225, fill=255)
img.paste(tile, (0, 0), mask)
d = ImageDraw.Draw(img)
# top gloss
gloss = Image.new("RGBA", (S, 300), (255, 255, 255, 255))
gm = Image.new("L", (S, 300), 0)
ImageDraw.Draw(gm).rounded_rectangle([0, -40, S, 190], radius=90, fill=22)
img.paste(gloss, (0, 0), gm)
d = ImageDraw.Draw(img)

# ground shadow
sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(sh).ellipse([150, 770, 880, 880], fill=(0, 0, 0, 90))
img = Image.alpha_composite(img, sh)
d = ImageDraw.Draw(img)

# route dashes (quadratic curve) above van
def qpoint(p0, p1, p2, t):
    return ((1-t)**2*p0[0] + 2*(1-t)*t*p1[0] + t*t*p2[0],
            (1-t)**2*p0[1] + 2*(1-t)*t*p1[1] + t*t*p2[1])
p0, p1, p2 = (110, 350), (390, 180), (700, 285)
t = 0.0
while t < 0.97:
    x, y = qpoint(p0, p1, p2, t)
    d.ellipse([x-11, y-11, x+11, y+11], fill=(217, 249, 157, 235))
    t += 0.055

# pin at curve end
px_, py_ = qpoint(p0, p1, p2, 1.0)
dy = 8
d.ellipse([px_-62, py_-168+dy, px_+62, py_-44+dy], fill=(0, 0, 0, 45))
d.polygon([(px_-30, py_-80+dy), (px_+30, py_-80+dy), (px_, py_-6+dy)], fill=(0, 0, 0, 45))  # pin shadow
d.ellipse([px_-62, py_-168, px_+62, py_-44], fill="white")
d.polygon([(px_-30, py_-80), (px_+30, py_-80), (px_, py_-6)], fill="white")
d.ellipse([px_-26, py_-132, px_+26, py_-80], fill=(0x65, 0xa3, 0x0d))

# van body: cargo box with 3D top face
cargo = vgrad((500, 330), (0x9b, 0xd4, 0x45), (0x5c, 0x92, 0x1e))
cm = Image.new("L", (500, 330), 0)
ImageDraw.Draw(cm).rounded_rectangle([0, 0, 500, 330], radius=36, fill=255)
img.paste(cargo, (140, 380), cm)
d = ImageDraw.Draw(img)
# top face highlight (3D lid)
d.polygon([(140, 402), (204, 346), (704, 346), (640, 402)], fill=(0xb5, 0xe3, 0x74))
d.polygon([(140, 402), (204, 346), (704, 346), (640, 402)], fill=None, outline=(0x4a, 0x76, 0x17), width=4)
# side shading
d.rectangle([140, 640, 640, 710], fill=(0x4a, 0x76, 0x17))
# white D on cargo
font = ImageFont.truetype("/System/Library/Fonts/HelveticaNeue.ttc", 210, index=1)
d.text((390, 545), "D", font=font, fill="white", anchor="mm")

# cabin
d.polygon([(640, 430), (790, 430), (880, 560), (880, 710), (640, 710)], fill=(0x77, 0xa8, 0x30))
# windshield (glass gradient feel: light + shine stripe)
d.polygon([(668, 458), (778, 458), (848, 560), (668, 560)], fill=(0xd8, 0xec, 0xfa))
d.polygon([(700, 458), (748, 458), (818, 560), (770, 560)], fill="white")
# headlight
d.rounded_rectangle([852, 600, 884, 640], radius=12, fill=(0xff, 0xe1, 0x8a))
d.rounded_rectangle([852, 600, 884, 620], radius=12, fill=(0xff, 0xf3, 0xc4))
# bumper
d.rounded_rectangle([640, 668, 892, 716], radius=20, fill=(0x33, 0x55, 0x10))

# wheels
for wx in (300, 720):
    d.ellipse([wx-78, 668, wx+78, 824], fill=(0, 0, 0, 60))  # shadow
    d.ellipse([wx-72, 662, wx+72, 806], fill=(0x18, 0x18, 0x18))
    d.ellipse([wx-64, 670, wx+64, 798], fill=(0x2b, 0x2b, 0x2b))
    d.ellipse([wx-34, 700, wx+34, 768], fill=(0xe8, 0xe8, 0xe8))
    d.ellipse([wx-13, 721, wx+13, 747], fill=(0x65, 0xa3, 0x0d))
    d.ellipse([wx-26, 706, wx-18, 714], fill="white")  # specular

img.save("public/icons/logo-1024.png")
print("saved")
