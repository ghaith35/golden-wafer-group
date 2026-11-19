# Builds every app icon (web/PWA, Electron .ico/.icns, Android launcher) from the
# Golden Wafer Group badge. Usage: python3 scripts/make-icons-from-badge.py <badge.jpg>
import sys, os, subprocess, shutil
from PIL import Image, ImageDraw

SRC = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)

src = Image.open(SRC).convert("RGB")
bg = src.getpixel((4, 4))                      # near-black badge background
S = 1024
master = src.resize((S, S), Image.LANCZOS)

def rounded(im, radius_frac=0.2237):
    im = im.convert("RGBA")
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1],
                                        radius=int(im.size[0] * radius_frac), fill=255)
    im.putalpha(m)
    return im

def sized(im, n): return im.resize((n, n), Image.LANCZOS)

tile = rounded(master)                          # "any" icons: rounded tile
# --- web / PWA
tile.save(P("public/icons/logo-1024.png"))
sized(tile, 512).save(P("public/icons/logo-512.png"))
sized(tile, 192).save(P("public/icons/logo-192.png"))
src.save(P("public/icons/logo-source.png"))
sized(master, 180).save(P("public/apple-touch-icon.png"))   # iOS rounds it itself
sized(tile, 256).save(P("public/favicon.ico"), sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
# --- Electron
sized(tile, 256).save(P("build/icon.ico"), sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
iset = P("build/.icon.iconset"); shutil.rmtree(iset, ignore_errors=True); os.makedirs(iset)
for n in (16, 32, 128, 256, 512):
    sized(tile, n).save(f"{iset}/icon_{n}x{n}.png")
    sized(tile, n * 2).save(f"{iset}/icon_{n}x{n}@2x.png")
subprocess.check_call(["iconutil", "-c", "icns", iset, "-o", P("build/icon.icns")])
shutil.rmtree(iset)
# --- Android
res = P("android/app/src/main/res")
for d, n in {"mdpi":48,"hdpi":72,"xhdpi":96,"xxhdpi":144,"xxxhdpi":192}.items():
    legacy = sized(tile, n)
    legacy.save(f"{res}/mipmap-{d}/ic_launcher.png")
    r = Image.new("RGBA", (n, n), (0,0,0,0)); r.paste(sized(master, n), (0,0), Image.new("L",(n,n),0))
    circ = Image.new("L", (n*4, n*4), 0); ImageDraw.Draw(circ).ellipse([0,0,n*4-1,n*4-1], fill=255)
    rd = sized(master, n).convert("RGBA"); rd.putalpha(circ.resize((n, n), Image.LANCZOS))
    rd.save(f"{res}/mipmap-{d}/ic_launcher_round.png")
for d, n in {"mdpi":108,"hdpi":162,"xhdpi":216,"xxhdpi":324,"xxxhdpi":432}.items():
    fg = Image.new("RGBA", (n, n), bg + (255,))
    inner = int(n * 0.66)                       # keep badge inside adaptive safe zone
    fg.paste(sized(master, inner), ((n - inner)//2,)*2)
    fg.save(f"{res}/mipmap-{d}/ic_launcher_foreground.png")
open(f"{res}/values/ic_launcher_background.xml", "w").write(
 '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#%02X%02X%02X</color>\n</resources>\n' % bg)
print("done, bg =", bg)
