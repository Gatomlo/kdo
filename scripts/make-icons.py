# Genere les icones d'installation de Kdo (meme dessin que public/icon.svg) : paquet cadeau
# creme, ruban et noeud violets, sur fond framboise.
# Usage : python scripts/make-icons.py   (Pillow requis)
import math
import os
from PIL import Image, ImageDraw

RED = (217, 64, 90, 255)
CREAM = (255, 246, 236, 255)
LID = (255, 255, 255, 255)
PLUM = (91, 75, 183, 255)
PLUM_DARK = (70, 56, 150, 255)
SHADOW = (190, 45, 72, 255)
OUT = os.path.join(os.path.dirname(__file__), '..', 'public')


def ellipse_poly(cx, cy, rx, ry, angle_deg, n=48):
    a = math.radians(angle_deg)
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x, y = rx * math.cos(t), ry * math.sin(t)
        pts.append((cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a)))
    return pts


def draw(size, full_bleed, glyph=1.0):
    k = 4  # sur-echantillonnage pour lisser les bords
    S = size * k
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if full_bleed:
        d.rectangle([0, 0, S, S], fill=RED)
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 14 / 64, fill=RED)
    u = S / 64 * glyph
    off = (S - 64 * u) / 2
    P = lambda x, y: (off + x * u, off + y * u)
    R = lambda x0, y0, x1, y1: [*P(x0, y0), *P(x1, y1)]
    # Ombre douce sous le paquet.
    d.rounded_rectangle(R(14, 50, 50, 54), radius=2 * u, fill=SHADOW)
    # Boite et couvercle.
    d.rounded_rectangle(R(15, 32, 49, 52), radius=3 * u, fill=CREAM)
    d.rounded_rectangle(R(12, 25, 52, 34), radius=3 * u, fill=LID)
    # Ruban vertical.
    d.rectangle(R(29, 25, 35, 52), fill=PLUM)
    # Noeud : deux boucles inclinees et le noeud central.
    for cx, ang in ((25.2, -28), (38.8, 28)):
        d.polygon([P(x, y) for x, y in ellipse_poly(cx, 19.5, 7.2, 4.6, ang)], fill=PLUM)
        d.polygon([P(x, y) for x, y in ellipse_poly(cx, 19.5, 3.4, 1.8, ang)], fill=PLUM_DARK)
    d.ellipse(R(28.6, 20.4, 35.4, 27.2), fill=PLUM)
    return img.resize((size, size), Image.LANCZOS)


def save(img, name, opaque=False):
    if opaque:
        img = img.convert('RGB')
    img.save(os.path.join(OUT, name), optimize=True)
    print(name)


save(draw(192, False), 'icon-192.png')
save(draw(512, False), 'icon-512.png')
save(draw(512, True, 0.76), 'icon-maskable-512.png')   # dessin dans la zone sure (cercle de 80 %)
save(draw(180, True, 0.86), 'apple-touch-icon.png', opaque=True)  # iOS arrondit lui-meme les coins
save(draw(32, False), 'favicon-32.png')
