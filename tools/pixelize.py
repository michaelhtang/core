"""Pixelizer: make any art look like it belongs to the same pixel game.

Shrinks an image to a fixed pixel grid, snaps every colour to the vDAA palette (Wolves at aurora),
then scales it back up with hard nearest-neighbour edges. Whatever made the art (Canva, a student,
a free asset pack), the output shares one grid and one palette.

    python tools/pixelize.py in.png out.png [--grid 480] [--size 1920] [--dither]

--grid  width of the pixel grid (480 = each "pixel" is 4 screen pixels at 1920 wide)
--size  output width (height keeps the aspect ratio)
--dither  Floyd-Steinberg dithering (softer gradients; off = flat retro bands)
Needs Pillow (slide-studio/.venv has it).
"""
import argparse
from PIL import Image

# Wolves at aurora: night navies, DAA blues, ice, snow, honey wood, gold, lime, ember, aurora greens and violets.
PALETTE = [
    "070B1C", "0E1630", "16224A", "1E2F66", "283C80",   # night navy ramp
    "1F3FA6", "3158C8", "4C79E0", "7FA8F2",             # DAA royal-blue ramp
    "7FD3F7", "B8E9FB", "F4F8FF",                       # ice to snow
    "2A1E14", "4A3320", "7A5532", "B07E4A", "D9A86C", "F0CF98",  # wood ramp (glulam beams, stalls)
    "7A5410", "B98A1F", "F5C451", "FFE7A3",             # gold and lantern light
    "5E7A12", "B5D334",                                 # lime (mixer stairs)
    "9C3A1C", "F26B3A",                                 # ember (cushions)
    "0F5C4A", "1FA37A", "46E0B0",                       # aurora green
    "3B2470", "6A45C2", "A98BF0",                       # aurora violet
]


def palette_image():
    flat = []
    for h in PALETTE:
        flat += [int(h[i:i + 2], 16) for i in (0, 2, 4)]
    flat += [0, 0, 0] * (256 - len(PALETTE))
    img = Image.new("P", (1, 1))
    img.putpalette(flat)
    return img


def pixelize(src, dst, grid=480, size=1920, dither=False):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    gh = round(h * grid / w)
    small = im.resize((grid, gh), Image.BOX)   # BOX averages each block: clean, no ringing
    q = small.quantize(palette=palette_image(), dither=Image.Dither.FLOYDSTEINBERG if dither else Image.Dither.NONE)
    out = q.convert("RGB").resize((size, round(gh * size / grid)), Image.NEAREST)
    out.save(dst, optimize=True)
    return out.size


if __name__ == "__main__":
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("src"); a.add_argument("dst")
    a.add_argument("--grid", type=int, default=480)
    a.add_argument("--size", type=int, default=1920)
    a.add_argument("--dither", action="store_true")
    o = a.parse_args()
    print(pixelize(o.src, o.dst, o.grid, o.size, o.dither))
