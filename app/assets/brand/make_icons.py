"""Generate Wilma's app icons from the mascot artwork.

Run from the repo root:  pip install cairosvg pillow && python3 app/assets/brand/make_icons.py
Writes app/assets/images/* and app/assets/brand/play-store-icon-512.png.
"""
import io, pathlib
import cairosvg
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
IMG, BRAND = ROOT / "images", ROOT / "brand"
NAVY, AMB, SKIN, CORAL, PINK, HAIR = "#1B2466", "#FFC857", "#F2C29B", "#FF7A6B", "#FF8FA3", "#4A2E22"
GRAD = ('<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0" stop-color="#6A55F0"/><stop offset="1" stop-color="#2440B0"/></linearGradient>')

# Mascot drawn on a 512 x 512 grid.
BODY = f'''
<path d="M112 540 C112 430 176 384 256 384 C336 384 400 430 400 540 Z" fill="{CORAL}"/>
<path d="M226 384 L256 420 L286 384 Z" fill="#FFFFFF"/>
<rect x="236" y="330" width="40" height="64" rx="16" fill="{SKIN}"/>'''
BUN = f'<circle cx="256" cy="112" r="44" fill="{HAIR}"/><rect x="226" y="140" width="60" height="14" rx="7" fill="{AMB}"/>'
FACE = f'''<circle cx="256" cy="244" r="106" fill="{SKIN}"/>
<ellipse cx="220" cy="252" rx="13" ry="17" fill="{NAVY}"/><ellipse cx="292" cy="252" rx="13" ry="17" fill="{NAVY}"/>
<circle cx="225" cy="245" r="5" fill="#fff"/><circle cx="297" cy="245" r="5" fill="#fff"/>
<ellipse cx="194" cy="286" rx="17" ry="10" fill="{PINK}" opacity=".65"/><ellipse cx="318" cy="286" rx="17" ry="10" fill="{PINK}" opacity=".65"/>
<path d="M232 292 Q256 318 280 292" fill="none" stroke="{NAVY}" stroke-width="7" stroke-linecap="round"/>'''
CAP_D = "M150 236 Q150 132 256 128 Q362 132 362 236 Q340 184 290 176 Q300 200 270 210 Q250 180 196 196 Q168 206 150 236 Z"
CAP = f'<path d="{CAP_D}" fill="{HAIR}"/>'
HEADSET = f'''<path d="M140 246 A118 124 0 0 1 372 246" fill="none" stroke="{NAVY}" stroke-width="16" stroke-linecap="round"/>
<rect x="124" y="214" width="36" height="68" rx="16" fill="{AMB}" stroke="{NAVY}" stroke-width="6"/>
<rect x="352" y="214" width="36" height="68" rx="16" fill="{AMB}" stroke="{NAVY}" stroke-width="6"/>
<path d="M146 282 Q156 336 222 326" fill="none" stroke="{NAVY}" stroke-width="9" stroke-linecap="round"/>
<circle cx="226" cy="325" r="11" fill="{NAVY}"/>'''
MASCOT = BODY + BUN + FACE + CAP + HEADSET
SPARKS = (f'<path d="M420 96 l10 25 25 10 -25 10 -10 25 -10 -25 -25 -10 25 -10z" fill="{AMB}"/>'
          f'<circle cx="96" cy="118" r="7" fill="{AMB}" opacity=".8"/>')

def svg(inner, size=1024, defs=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 512 512">'
            f'<defs>{GRAD}<clipPath id="c"><rect width="512" height="512"/></clipPath>{defs}</defs>{inner}</svg>')

def render(s, size):
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=s.encode(), output_width=size, output_height=size))).convert("RGBA")

FULL = '<rect width="512" height="512" fill="url(#g)"/><g clip-path="url(#c)">' + MASCOT + "</g>" + SPARKS
# Adaptive-icon foreground: keep head and headset inside the 66% safe circle.
FG = '<g clip-path="url(#c)"><g transform="translate(256 262) scale(0.82) translate(-256 -236)">' + MASCOT + "</g></g>"
# Monochrome (Android themed icons): one colour, details cut out with a mask.
MONO_ART = f'''<rect width="512" height="512" fill="#000"/>
<g transform="translate(256 262) scale(0.82) translate(-256 -236)">
<g fill="#fff"><path d="M112 540 C112 430 176 384 256 384 C336 384 400 430 400 540 Z"/>
<rect x="236" y="330" width="40" height="64" rx="16"/><circle cx="256" cy="112" r="44"/>
<circle cx="256" cy="244" r="106"/><rect x="124" y="214" width="36" height="68" rx="16"/>
<rect x="352" y="214" width="36" height="68" rx="16"/></g>
<path d="{CAP_D}" fill="#fff" stroke="#000" stroke-width="8"/>
<rect x="226" y="140" width="60" height="14" rx="7" fill="#000"/>
<path d="M226 384 L256 420 L286 384 Z" fill="#000"/>
<ellipse cx="220" cy="252" rx="13" ry="17" fill="#000"/><ellipse cx="292" cy="252" rx="13" ry="17" fill="#000"/>
<path d="M232 292 Q256 318 280 292" fill="none" stroke="#000" stroke-width="8" stroke-linecap="round"/>
<path d="M146 282 Q156 336 222 326" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
<circle cx="226" cy="325" r="11" fill="#fff"/></g>'''
SPLASH = '<g transform="translate(256 256) scale(0.9) translate(-256 -236)">' + BUN + FACE + CAP + HEADSET + "</g>"

render(svg(FULL), 1024).save(IMG / "icon.png")
render(svg(FULL), 512).save(BRAND / "play-store-icon-512.png")
render(svg(FULL), 48).save(IMG / "favicon.png")
render(svg('<rect width="512" height="512" fill="url(#g)"/>' + SPARKS), 1024).save(IMG / "android-icon-background.png")
render(svg(FG), 1024).save(IMG / "android-icon-foreground.png")
lum = render(svg(MONO_ART), 1024).convert("L")  # white = shape, black = cut-out
mono = Image.new("RGBA", (1024, 1024), (255, 255, 255, 0)); mono.putalpha(lum)
mono.save(IMG / "android-icon-monochrome.png")
render(svg(SPLASH), 512).save(IMG / "splash-icon.png")
(BRAND / "wilma-mascot.svg").write_text(svg(FULL, 512))
print("icons written")
