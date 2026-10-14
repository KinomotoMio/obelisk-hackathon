#!/usr/bin/env python3
"""Bundle deck/src/index.html into ONE self-contained HTML file.

- Google Fonts (latin subset) are downloaded once into deck/.cache and inlined as base64.
- Every `assets/<file>` reference is inlined as a data URI.
Output: deck/out/obelisk-deck.html  (no network needed to present it)
"""
import base64, mimetypes, re, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
CACHE = ROOT / ".cache"
OUT = ROOT / "out" / "obelisk-deck.html"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"
FONT_QUERY = (
    "family=Audiowide"
    "&family=Instrument+Serif:ital@0;1"
    "&family=Inter:wght@400;500;600"
    "&family=Montserrat:wght@400;500;600"
    "&family=JetBrains+Mono:wght@400;500"
)


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def fonts_css() -> str:
    CACHE.mkdir(exist_ok=True)
    cached = CACHE / "fonts.css"
    if cached.exists():
        return cached.read_text()
    css = get(f"https://fonts.googleapis.com/css2?{FONT_QUERY}&display=swap").decode()
    out = []
    for block in re.findall(r"@font-face\s*\{[^}]*\}", css):
        if "U+0000-00FF" not in block:  # keep the latin subset only
            continue
        url = re.search(r"url\(([^)]+)\)", block).group(1)
        b64 = base64.b64encode(get(url)).decode()
        block = re.sub(r"url\([^)]+\)", f"url(data:font/woff2;base64,{b64})", block)
        out.append(block)
    cached.write_text("\n".join(out))
    return cached.read_text()


def cjk_css() -> str:
    """Noto Sans SC, subset to exactly the characters used in src/zh.json (keeps the single file small)."""
    import hashlib, json, urllib.parse
    zh = (ROOT / "src" / "zh.json").read_text()
    chars = "".join(sorted(set("".join(json.loads(zh).values()) + "".join(chr(c) for c in range(32, 127)) + "·×—·")))
    key = hashlib.md5(chars.encode()).hexdigest()[:10]
    cached = CACHE / f"cjk-{key}.css"
    if cached.exists():
        return cached.read_text()
    url = f"https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;900&display=swap&text={urllib.parse.quote(chars)}"
    css = get(url).decode()
    out = []
    for block in re.findall(r"@font-face\s*\{[^}]*\}", css):
        u = re.search(r"url\(([^)]+)\)", block).group(1)
        b64 = base64.b64encode(get(u)).decode()
        out.append(re.sub(r"url\([^)]+\)", f"url(data:font/woff2;base64,{b64})", block))
    cached.write_text("\n".join(out))
    return cached.read_text()


def smiley_css() -> str:
    """Smiley Sans (SIL OFL, atelier-anchor/smiley-sans) subset to the characters in zh.json, inlined as WOFF."""
    import json
    from fontTools import subset
    src = ROOT / "fonts" / "SmileySans-Oblique.ttf"
    chars = "".join(sorted(set("".join(json.loads((ROOT / "src" / "zh.json").read_text()).values()) + "".join(chr(c) for c in range(32, 127)))))
    out = CACHE / "smiley.woff"
    opts = subset.Options(); opts.flavor = "woff"; opts.layout_features = ["*"]
    font = subset.load_font(str(src), opts)
    sub = subset.Subsetter(opts); sub.populate(text=chars); sub.subset(font)
    subset.save_font(font, str(out), opts)
    b64 = base64.b64encode(out.read_bytes()).decode()
    return "@font-face{font-family:'Smiley Sans';font-weight:400;font-style:normal;src:url(data:font/woff;base64,%s) format('woff')}" % b64


def data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def import_generated() -> None:
    """gen/<key>.png (Codex output) -> assets/s-<key>.jpg"""
    try:
        from PIL import Image
    except ImportError:
        return
    pairs = [(p, f"s-{p.stem}.jpg") for p in sorted((ROOT / "gen").glob("*.png"))]
    pairs += [(p, f"s-{p.stem}-zh.jpg") for p in sorted((ROOT / "gen-zh").glob("*.png"))]  # Chinese art (Codex)
    for png, name in pairs:
        dst = ROOT / "assets" / name
        if not dst.exists() or dst.stat().st_mtime < png.stat().st_mtime:
            Image.open(png).convert("RGB").save(dst, quality=90, optimize=True)


def main() -> None:
    import_generated()
    html = (ROOT / "src" / "index.html").read_text()
    html = html.replace("/*{{FONTS}}*/", fonts_css() + "\n" + (cjk_css() if (ROOT / "src" / "zh.json").exists() else ""))

    def inline(m: re.Match) -> str:
        p = ROOT / "assets" / m.group(1)
        if not p.exists():
            sys.exit(f"missing asset: {p}")
        return data_uri(p)

    html = re.sub(r"assets/([\w.-]+)", inline, html)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html)
    print(f"{OUT}  {OUT.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
