#!/usr/bin/env python3
"""Generate full-slide artwork with Codex's image_gen, using the two approved slides as style anchors.

usage: python3 deck/tools/gen_slides.py [slide-key ...]     (no args = all)
Output: deck/gen/<key>.png   (picked up by deck/build.py via assets/ links after you copy/convert)
Prompts live in deck/prompts/<key>.txt so they can be tweaked and re-run one at a time.
"""
import subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WRAP = Path.home() / ".claude/skills/codex-imagegen/scripts/codex_image.sh"
R = ROOT / "refs"
STYLE = [R / "style-query.jpg", R / "style-loop.jpg"]

COMMON = """Use case: infographic-diagram
Asset type: 16:9 presentation slide for a hackathon pitch, at least 1672x941.
Style: match Image 1 and Image 2 exactly. They are FLAT UI-style slides: warm off-white paper (#f2f1ec) with fine grain, a thin black hairline frame with crop marks and tick marks, a small solid black square at the bottom-right, thin black outlined cards, a halftone dot-gradient strip on the left edge of cards, soft lavender (#d9d0fb, accent #8c73f2) highlight panels, small circular light-grey icon badges with simple line icons, and a big uppercase title in a wide rounded technical display typeface with the second line in violet.
Title weight: regular/medium weight like Image 1 and Image 2 (NOT extra-bold), title cap height about 6% of the image height, exactly two lines.\nStrictly flat: NO 3D, NO perspective, NO glass or metal render, NO shadows, NO photoreal objects.
READABILITY IS THE TOP PRIORITY. TEXT SIZE RULE: body text lines are about 3.6% of the image height (roughly 34px on a 941px-tall slide), card headings about 4.5%, the title about 9%. Cards are big and few; if text does not fit at that size, use fewer words, never smaller type. Every piece of text the audience must read is LARGE: card headings larger still, high-contrast dark ink on light, titles very large. Use fewer, bigger elements instead of many small ones. Only decorative captions (like 'WHO YOU ARE') may stay small, and the top-right label may stay small. No paragraphs, short phrases only, generous whitespace, nothing cramped.
Leave the top-left corner (22% width x 12% height) completely empty paper. Do not draw any logo or wordmark.
Render only the exact text listed below, verbatim and correctly spelled. Add no other text.
"""

ROWS = "Layout: stacked wide rows exactly like Image 2, but TALLER: each row is about 17% of the image height so the text inside can be large (halftone strip on the left of each row, a number, a name with a small caption, a text block on the right, a status mark at the far right)."
COLS = "Layout: three columns joined by thin arrows, exactly like Image 1's three-column structure (numbered column header with caption, then a stack of cards inside each column)."

SLIDES = {
"landscape": (None, """Layout: two tall outlined cards side by side with a small plus sign between them, each with a halftone strip on its left edge and one circular icon badge on top. Top-right small label: "INDUSTRY LANDSCAPE".
Title: "TWO MAINSTREAM" / "DIRECTIONS" (second line violet).
Left card: number "01", heading "MEMORY", body "Remember the user. Remember what happened."
Right card: number "02", heading "SKILL MARKET", body "Package know-how as Skills. Share it. Sell it." """),

"memory": (None, ROWS + """ Two rows. Top-right small label: "MEMORY".
Title: "PROFILES CAN BE WRONG." / "FACTS CAN'T." (second line violet).
Row 01 (grey): name "User profile", caption "WHO YOU ARE", text "A wrong guess gets corrected by the user. That helps.", mark at far right: calm check.
Row 02 (lavender, emphasised): name "Factual recall", caption "WHAT HAPPENED", text "A wrong answer is silent, and decisions get built on it.", mark at far right: cross.
Bottom centered line in large type: "Facts are where memory must be exact." """),

"skillmarket": (None, """Layout: three stacked rows on the left (Image 2 row style: number, bold name, one short line) and one black result panel on the right with two stacked entries, joined by a thin arrow. Top-right small label: "SKILL MARKET".
Title: "KNOWLEDGE-FOR-PAY," / "AS PLAINTEXT." (second line violet).
Rows: "01 Copyable" "Plain text. Copied everywhere." / "02 Unread" "Most just follow the crowd." / "03 Bloat" "Too many Skills slow the harness."
Black panel (white text, violet small captions): "RESULT" "No real monetization" "Income depends on traffic." and "RESULT" "No measurable utility" "Nobody knows if it works." """),

"distill": (None, ROWS + """ Three rows. Rows 01 and 02 have NO mark at the far right; only row 03 has a check mark. Top-right small label: "ONE / DISTILL".
Title: "ZERO-COST" / "DISTILLATION" (second line violet).
Row 01 name "Real sessions", caption "WHAT YOU ALREADY DID", text "Every run, every agent."
Row 02 name "Evidence", caption "WITH A SOURCE CARD", text "Patterns and anti-patterns, with origin."
Row 03 (lavender, emphasised) name "Skill", caption "REVIEWED, THEN MINTED", text "No curation. No cold start.", mark: check. """),

"fit": (None, ROWS + """ Three rows. Rows 01 and 02 have NO mark at the far right; only row 03 has a check mark. Top-right small label: "TWO / DELIVER".
Title: "KNOWLEDGE-FOR-PAY" / "2.0" (second line violet).
Row 01 name "How it was born", caption "THE TRAJECTORY", text "The original work behind it."
Row 02 name "Where it works", caption "THE SCENES", text "Where it really delivers."
Row 03 (lavender, emphasised) name "Matched to you", caption "YOUR CONTEXT", text "Fits what you do now.", mark: check. """),

"divider": ("cover", """Layout: section divider like the cover (Image 3, the cover): large empty paper on the left for the title, a flat line-art illustration on the right. Illustration: a row of five flat rectangular ledger blocks drawn as black line art with halftone shading, linked by a dashed line, the middle block highlighted in violet. FLAT line art only, absolutely no 3D render. Include thin orbital arcs and registration dots like the cover.
Top-right small label: "HACKATHON BUILD".
Title (three lines, last line violet): "PUTTING" / "CONTEXT" / "ON-CHAIN". Small readable line below the title: "BOT Chain. Provenance, usage, payment, privacy." """),

"gaps": (None, ROWS + """ Four rows with NO check or cross marks at the far right; in each row the left text shows the gap, then a thin arrow, then the on-chain answer in bold, and a small caption with the contract name at the far right. Top-right small label: "ON-CHAIN".
Title: "EVERY GAP GETS" / "AN ON-CHAIN ANSWER" (second line violet).
Row 01: "Copied, no credit" -> "Fingerprints and lineage" caption "SkillRegistry"
Row 02: "Can't measure use" -> "Real usage by scene" caption "UsageStats"
Row 03: "No way to earn" -> "Priced offers and royalties" caption "SkillMarket"
Row 04 (lavender): "Too private to send" -> "Encrypted shares" caption "KeyRegistry, ShareRegistry" """),

"relay": (None, COLS + """ Top-right small label: "ARCHITECTURE". Exactly two big cards in each column, no bottom line.
Title: "USERS SIGN." / "THE RELAY PAYS." (second line violet).
Column 01 "YOUR MACHINE": cards "Sessions stay local" / "You sign each action".
Column 02 "RELAY" (lavender): cards "Checks the signature" / "Never sees plaintext".
Column 03 "BOT CHAIN": cards "Five contracts" / "No admin key". """),

"lineage": (None, ROWS + """ Three rows. Top-right small label: "SKILL REGISTRY".
Title: "MINT IT." / "LINEAGE STAYS." (second line violet).
Row 01 name "Fingerprint", caption "EVERY VERSION", text "Every version is hashed."
Row 02 name "Parent", caption "EVERY FORK", text "Every fork points to its parent."
Row 03 (lavender) name "Birth scenes", caption "THE ORIGIN", text "Records the work it came from." Each row has a small line icon at the far right instead of a check. """),

"usage": (None, COLS + """ Top-right small label: "USAGE STATS".
Title: "READ THE EVIDENCE," / "NOT THE DESCRIPTION." (second line violet).
Column 01 "REPORTED": two big cards "Calls per version" / "Per signing wallet".
Column 02 "BY SCENE" (lavender): one big card containing three flat horizontal bars with large labels: "Creative decks" (long, violet), "Landing pages" (medium, dark grey), "E-commerce admin" (short, light grey). NO numbers or percentages anywhere on this card. A small outlined tag "ILLUSTRATIVE".
Column 03 "SMOOTH RATE": one big card with the large formula "Smooth / (Smooth + Rework + Failure)" and below it "Unknown excluded." """),

"market": (None, COLS + """ Top-right small label: "SKILL MARKET".
Title: "ROYALTIES FOLLOW" / "THE LINEAGE." (second line violet).
Column 01 "BUYER PAYS": one big card "One transaction. One receipt."
Column 02 "SPLIT BY LINEAGE" (lavender): a flat horizontal stacked bar of four blocks of different widths labelled "Author", "Parent", "Grandparent+", "Platform". NO numbers or percentages anywhere. A small outlined tag "ILLUSTRATIVE".
Column 03 "VERIFIABLE": one big card "Every receipt is on-chain."
Bottom row of two chips in large type: "Free · Per retrieval · Perpetual" and "Personal · Commercial". """),

"share": (None, COLS + """ Top-right small label: "PRIVATE SHARE".
Title: "HAND IT TO" / "ONE WALLET." (second line violet).
Column 01 "CHECK AND SEAL": two big cards "Secrets masked" / "Sealed on your machine".
Column 02 "RULES ON-CHAIN" (lavender): four chips in a 2x2 grid in large type: "One wallet" / "Open N times" / "Expires" / "Revocable".
Column 03 "OPEN WITH A RECEIPT": two big cards "Recipient signs" / "Open is recorded". """),

"loopdemo": (None, ROWS + """ Four rows. Top-right small label: "DEMO".
Title: "ONE LOOP," / "END TO END." (second line violet).
Row 01 name "Find", caption "BY MEASURED SCENES", text "Pick a resume Skill."
Row 02 name "Use", caption "LOCALLY", text "It reads your own history."
Row 03 name "Prove", caption "ON-CHAIN", text "Numbers link to on-chain records."
Row 04 (lavender) name "Show", caption "ONE WALLET", text "Share the evidence with a recruiter's wallet." """),

"status": (None, """Layout: two tall outlined cards side by side (halftone strip on the left of each), each with a heading, a chain ID caption, a status pill, and a short text. Top-right small label: "STATUS".
Title: "WHERE WE ARE" / "TODAY." (second line violet).
Left card (lavender): heading "TESTNET", caption "Chain ID 968", pill "LIVE", text "Full loop: sign, relay, mint, use, buy, settle."
Right card: heading "MAINNET", caption "Chain ID 677", pill "VERIFICATION", text "Same frozen code. A few real transactions with explorer links."
Bottom line: "Test tokens and simulated roles are labelled as such." """),
}

EDITS = {}


def run(key):
    out = ROOT / "gen" / f"{key}.png"
    out.parent.mkdir(exist_ok=True)
    (ROOT / "prompts").mkdir(exist_ok=True)
    cmd = [str(WRAP), "-o", str(out)]
    if key in EDITS:
        src, prompt = EDITS[key]
        cmd += ["-i", str(R / src)]
    else:
        ref, brief = SLIDES[key]
        prompt = COMMON + "\n" + brief
        for s in STYLE:
            cmd += ["-i", str(s)]
        if ref:
            c = ROOT / "assets" / "cover.jpg" if ref == "cover" else R / (ref + ".jpg")
            cmd += ["-i", str(c)]
            prompt = prompt.replace("Content reference Image 3", "Content reference Image 3 (layout/concept inspiration only; do not copy its text or colors)", 1)
    (ROOT / "prompts" / f"{key}.txt").write_text(prompt)
    cmd.append(prompt)
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(key, "OK" if r.returncode == 0 else "FAIL", (r.stdout.strip().splitlines() or [r.stderr[-300:]])[-1], flush=True)


if __name__ == "__main__":
    keys = sys.argv[1:] or list(SLIDES) + list(EDITS)
    with ThreadPoolExecutor(max_workers=5) as ex:
        list(ex.map(run, keys))
