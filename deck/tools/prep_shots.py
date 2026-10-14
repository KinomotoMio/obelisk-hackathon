#!/usr/bin/env python3
"""Prepare real product screenshots for the deck (from the test-evidence export). Output: deck/assets/shot-*.jpg

Only screenshots that contain fictional demo data or public testnet data are used.
Deliberately NOT used: anything under screenshots/contains-real-content/, the draft-review pages
(they quote real sessions) and the Settings page (shows local user paths).
"""
from pathlib import Path
from PIL import Image

SRC = Path.home() / "Downloads" / "evidence-0b84f02" / "screenshots"
OUT = Path(__file__).resolve().parent.parent / "assets"


def save(src, name, width, box=None, q=88):
    im = Image.open(SRC / src).convert("RGB")
    if box:
        w, h = im.size
        im = im.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(OUT / name, quality=q, optimize=True)
    print(name, im.size)


save("app-auto/A-skill4-after-correction.png", "shot-usage.jpg", 1700)
save("app-auto/A-skill4-after-correction-scenes.png", "shot-lineage.jpg", 1700)
save("t1-manual/3-1_阅读页_打码与水印.webp", "shot-reader.jpg", 1100)
save("t1-manual/3-3_Share_已读与已撤回.webp", "shot-sharetab.jpg", 1600)
# the dialog is not centred in the original capture (card spans x 532-1456, y 138-562): crop symmetrically around it
save("t1-manual/3-5_撤回页.png", "shot-revoked.jpg", 1200, box=(277 / 1508, 60 / 886, 1495 / 1508, 720 / 886))
save("t1-manual/4-3_App确认并铸造_执行结果.png", "shot-mint.jpg", 1100, box=(0.0, 0.392, 0.955, 0.875))
save("t1-manual/1-2_F4_分享预览只有摘要.png", "shot-preview.jpg", 1100)

# real sessions -> methodology (the tester's own history; shown with permission)
save("app-auto/A-skill5-draft-review.png", "shot-distill.jpg", 1800)
save("t1-manual/4-2_继续修改_prompt.webp", "shot-prov.jpg", 1000, box=(0.575, 0.2, 0.975, 0.77))
save("app-auto/A-skill4-after-correction-scenes.png", "shot-scenes.jpg", 1500, box=(0.2, 0.15, 0.97, 0.74))
save("app-auto/A-skill4-after-correction-scenes.png", "shot-lineage2.jpg", 1500, box=(0.2, 0.575, 0.97, 0.885))
save("t1-manual/9-2_App详情页与Web对比.webp", "shot-usage2.jpg", 1500)
