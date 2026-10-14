#!/usr/bin/env python3
"""Screenshot the live public pages and the fictional resume page with headless Chrome. Output: deck/assets/web-*.jpg"""
import subprocess
from pathlib import Path
from PIL import Image

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE = "https://obelisk-service.kinomotomiovo.workers.dev"
OUT = Path(__file__).resolve().parent.parent / "assets"
TMP = Path("/tmp/deck-web")
TMP.mkdir(exist_ok=True)
RESUME = Path.home() / "Downloads/evidence-0b84f02/samples/虚构履历页.html"


def shoot(url, name, w, h):
    png = TMP / f"{name}.png"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--window-size={w},{h}",
                    "--virtual-time-budget=9000", f"--screenshot={png}", url], capture_output=True)
    return Image.open(png).convert("RGB")


def save(im, name, width=1700, box=None):
    if box:
        w, h = im.size
        im = im.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(OUT / name, quality=88, optimize=True)
    print(name, im.size)


save(shoot(f"{BASE}/market", "market", 1600, 1000), "web-market.jpg", 1700, box=(0.1, 0.07, 0.9, 0.63))
save(shoot(f"{BASE}/market/stage-2", "stage2", 1600, 1500), "web-stage2.jpg", 1700, box=(0.15, 0.49, 0.85, 0.765))
save(shoot(f"{BASE}/preview", "preview", 1600, 1100), "web-preview.jpg", 1700, box=(0.095, 0.235, 0.905, 0.86))
save(shoot(RESUME.as_uri(), "resume", 1440, 1500), "web-resume.jpg", 1700, box=(0.1, 0.02, 0.9, 0.66))
