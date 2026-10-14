#!/usr/bin/env python3
"""Compose deck/src/index.html: the approved art slides + code-rendered content slides (large, readable text).

Run: python3 deck/tools/compose.py && python3 deck/build.py
Chinese: fill ZH below (English string -> Chinese string); press L in the player to switch.
"""
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "index.html"
ZH_FILE = ROOT / "src" / "zh.json"
ZH = json.loads(ZH_FILE.read_text()) if ZH_FILE.exists() else {}


SEEN = []


def t(en):
    """Translatable text: English now, Chinese from src/zh.json when present."""
    if en not in SEEN:
        SEEN.append(en)
    z = ZH.get(en)
    if not z:
        return en
    return f'<span data-t-zh="{z}">{en}</span>'


# ------------------------------------------------------------------ icons (flat line icons)
ICONS = {
    "user": '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    "doc": '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h7M9 17h7"/>',
    "check": '<path d="M4 12.5l5 5L20 6.5"/>',
    "x": '<path d="M5 5l14 14M19 5L5 19"/>',
    "lock": '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    "link": '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    "layers": '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    "shield": '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    "eyeoff": '<path d="M3 3l18 18"/><path d="M10.6 6.1A9 9 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-3 3.5M6.5 7.5C4 9.3 3 12 3 12s4 6 9 6c1 0 2-.2 3-.6"/>',
    "cloud": '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-1 9z"/>',
    "laptop": '<rect x="4" y="5" width="16" height="11" rx="1"/><path d="M2 20h20"/>',
    "chart": '<path d="M5 20V10M12 20V4M19 20v-7"/>',
    "branch": '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 7v10M18 11a6 6 0 0 1-6 5H6"/>',
    "coin": '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-2 5-2 5 0s-5 1.5-5 3.5 5 2 5 0"/>',
    "cart": '<path d="M3 4h2l2.2 11h11l2-8H6"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
    "wallet": '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12.5h5"/>',
    "key": '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
    "chip": '<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    "search": '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>',
    "msg": '<path d="M4 5h16v11H9l-5 4z"/>',
    "star": '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
    "pen": '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
    "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "refresh": '<path d="M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4"/>',
    "db": '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    "store": '<path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9c0 2 3 2 4 0 1 2 3 2 4 0 1 2 3 2 4 0 1 2 4 2 4 0M10 20v-6h4v6"/>',
    "alert": '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
    "scene": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5"/>',
    "send": '<path d="M3 11l18-8-8 18-2-8z"/>',
}


def ic(name, size=40):
    return f'<svg class="i" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{ICONS[name]}</svg>'


def badge(name, big=False):
    return f'<span class="badge{" lg" if big else ""}">{ic(name, 66 if big else 46)}</span>'


ARROW = '<svg class="arw" viewBox="0 0 56 20" fill="none" stroke="#101012" stroke-width="1.6"><path d="M0 10h52M43 2l9 8-9 8"/></svg>'

# ------------------------------------------------------------------ building blocks
LOGO = '<div class="logo" aria-label="Obelisk"><span class="deck-word" aria-hidden="true"><span>Obe</span><img src="assets/wordmark-l.svg" alt=""><span>isk</span></span></div>'
FRAME = '<div class="frame"><i class="t1"></i><i class="b1"></i><i class="l1"></i><i class="r1"></i></div>'


def shell(title, label, body, cls=""):
    return f'''<section class="slide light code {cls}" data-title="{re.sub('<[^>]+>', '', title)}">
  {FRAME}{LOGO}<div class="label">{t(label)}</div>
  {body}
</section>'''


def rich(en_html, key):
    """A whole sentence, re-composed for Chinese (own line breaks and own highlight), keyed by `key` in zh.json."""
    if key not in SEEN:
        SEEN.append(key)
    z = ZH.get(key)
    return f'<span data-t-zh="{z}">{en_html}</span>' if z else en_html


def heading(l1, l2=None):
    en = f'{l1}<br><b>{l2}</b>' if l2 else l1
    key = l1 + "|" + (l2 or "")
    return f'<h2 class="ttl" data-r>{rich(en, key)}</h2>'


def row(n, name, cap, text, icon, mark=None, tone="g", hl=False):
    m = f'<div class="mk">{ic(mark, 44)}</div>' if mark else '<div class="mk"></div>'
    return f'''<div class="row {tone}{' hl' if hl else ''}" data-r style="--d:{n+1}">
      <span class="num">{n:02d}</span><div class="ht"></div>
      {badge(icon)}<div class="nm"><b>{t(name)}</b><small>{t(cap)}</small></div>
      <div class="tx">{t(text)}</div>{m}</div>'''


def rows(items, top=330):
    return f'<div class="rows n{len(items)}" style="top:{top}px">' + "".join(items) + "</div>"


def card(icon, text, hl=False, big=False):
    return f'<div class="cd{" hl" if hl else ""}"><div class="ht"></div>{badge(icon)}<span>{t(text)}</span></div>'


def col(n, head, cards, hl=False, extra=""):
    return f'''<div class="col{' hl' if hl else ''}" data-r style="--d:{n+1}">
      <div class="ch"><span>{n:02d}</span><b>{t(head)}</b></div>
      <div class="cb"><div class="ht"></div>{"".join(cards)}{extra}</div></div>'''


def cols(cs, top=350, h=580):
    inner = []
    for i, c in enumerate(cs):
        inner.append(c)
        if i < len(cs) - 1:
            inner.append(f'<div class="ca">{ARROW}</div>')
    return f'<div class="cols" style="top:{top}px;height:{h}px">' + "".join(inner) + "</div>"


def bignote(text, bottom=96):
    return f'<p class="note" data-r style="--d:6;bottom:{bottom}px">{t(text)}</p>'


def duo(items):
    out = []
    for i, (n, ic_, head, body, chips, hl) in enumerate(items):
        ch = "".join(f'<span class="chip">{t(c)}</span>' for c in chips)
        out.append(f'''<div class="big{' hl' if hl else ''}" data-r style="--d:{i+2}"><div class="ht"></div>
          <span class="bn">{n}</span>{badge(ic_, True)}<h3>{t(head)}</h3><p>{t(body)}</p><div class="chips">{ch}</div></div>''')
    return '<div class="duo">' + '<span class="plus">+</span>'.join(out) + "</div>"



# ------------------------------------------------------------------ real screenshots
def shot(img, x, y, w, h, marks=(), chips=(), cls=""):
    """Fit the image (aspect preserved, no cropping) inside the box and centre it."""
    from PIL import Image
    iw, ih = Image.open(ROOT / "assets" / img).size
    k = min(w / iw, h / ih)
    fw, fh = round(iw * k), round(ih * k)
    fx, fy = x + (w - fw) // 2, y + (h - fh) // 2
    ms = "".join(f'<span class="mkr" style="left:{mx}%;top:{my}%">{i}</span>' for i, (mx, my) in enumerate(marks, 1))
    cs = "".join(f'<span class="sc" style="{pos}">{t(txt)}</span>' for txt, pos in chips)
    return (f'<div class="shot {cls}" data-r="img" style="left:{fx}px;top:{fy}px;width:{fw}px;height:{fh}px">'
            f'<img src="assets/{img}" alt="">{ms}{cs}</div>')


def callrow(items, y, x=100, w=1720):
    out = "".join(f'<div class="cl" data-r style="--d:{i+2}"><span class="mkr s">{i}</span><span>{t(txt)}</span></div>' for i, txt in enumerate(items, 1))
    return f'<div class="cls row3" style="left:{x}px;top:{y}px;width:{w}px">{out}</div>'


CALLOUT_ICONS = {
    "Across sessions & harnesses": "layers", "Keep the method": "doc", "You make the call": "check",
    "Follow the thought over time": "clock", "Keep the wrong turns": "branch", "Keep your corrections": "pen",
    "Real use": "chart", "Outcomes, with sample size": "check", "Rework stays visible": "refresh", "See where it works": "scene",
    "Evidence before purchase": "shield", "Credit stays connected": "branch", "Find a method that fits": "search",
    "A history of real work": "clock", "Experience across projects": "layers", "Capabilities with sources": "link", "Market feedback, richer capability signals": "chart",
}


def callouts(items, x=100, y=330, w=560):
    rows = []
    for i, item in enumerate(items, 1):
        title, detail = item if isinstance(item, tuple) else (item, "")
        copy = f'<strong>{t(title)}</strong>' + (f'<small>{t(detail)}</small>' if detail else '')
        rows.append(f'<div class="cl" data-r style="--d:{i+2}"><span class="annotation-symbol">{ic(CALLOUT_ICONS.get(title, "doc"),36)}<span class="mkr s">{i}</span></span><div class="annotation-copy">{copy}</div></div>')
    return f'<div class="cls editorial" style="left:{x}px;top:{y}px;width:{w}px">' + ''.join(rows) + '</div>'


def cap(text, x, y, w):
    return f'<p class="cap" data-r style="--d:5;left:{x}px;top:{y}px;width:{w}px">{t(text)}</p>'

# ------------------------------------------------------------------ slides
S = []


def art(title, key, alt, logo=True, raw=False):
    zh = f' data-zh="assets/s-{key}-zh.jpg"' if (ROOT / "assets" / f"s-{key}-zh.jpg").exists() else ""
    return f'''<section class="slide light art" data-title="{title}">
  <img class="bg" src="assets/s-{key}.jpg"{zh} alt="{alt}">
  {LOGO if logo and not raw else ''}
</section>'''


S.append('''<section class="slide light cover" data-title="Cover">
  <img class="bg" src="assets/cover.jpg" alt="Obelisk — BOT Chain — Build Beyond · ETH Wuhan 2026">
</section>''')

# 2 landscape
S.append(shell("Two directions", "Industry landscape", heading("Two mainstream", "directions") + duo([
    ("01", "chip", "Memory", "Remember the user. Remember what happened.", ["Digital twin", "Brain-like recall"], False),
    ("02", "store", "Skill Market", "Package know-how as Skills. Share it. Sell it.", ["Plaintext Skills", "Knowledge-for-pay"], False),
])))

# 3 memory
S.append(shell("Memory problem", "Memory", heading("Profiles can be wrong.", "Facts can't.") + rows([
    row(1, "User profile", "Who you are", "A wrong guess gets corrected by the user. That helps.", "user", "check", "g"),
    row(2, "Factual recall", "What happened", "A wrong answer is silent, and decisions get built on it.", "doc", "x", "v", True),
], 340) + bignote("Facts are where memory must be exact.", 110)))

# 4 query (approved, untouched)
def query_entry(icon, title, text, time):
    return f'<div class="qe">{badge(icon)}<div><strong>{t(title)}</strong><p>{t(text)}</p></div><time>{time}</time></div>'

def query_step(icon, title, text):
    return f'<div class="qs">{ic(icon, 30)}<div><strong>{t(title)}</strong><p>{t(text)}</p></div></div>'

def query_panel(n, title, sub, body, accent=False):
    return f'<div class="query-column" data-r style="--d:{n}"><header><span>{n:02d}</span><div><h3>{t(title)}</h3><p>{t(sub)}</p></div></header><div class="query-panel {"accent" if accent else ""}"><div class="ht"></div>{body}</div></div>'

query_records = (query_entry("doc", "Project sessions", "Delivery, debugging and collaboration", "")
    + query_entry("pen", "Tool records", "Changes, execution and verification", "")
    + query_entry("msg", "User feedback", "What worked, what needed rework", "")
    + query_entry("shield", "Shareable evidence", "You choose what leaves your machine", ""))
query_agent = (f'<div class="query-ask">{badge("star")}<strong>Obelisk</strong></div><div class="query-prompt">{t("Create an AI resume from my work history. Show what I delivered, with evidence.")}{ARROW}</div>'
    + query_step("search", "Find relevant work", "Search projects and original sessions")
    + query_step("layers", "Connect actions to outcomes", "Trace decisions, fixes and delivery")
    + query_step("send", "Draft with references", "Review the claims and sharing scope"))
query_answer = (f'<div class="query-answer"><strong>{t("Your FDE calling card")}</strong><p>{t("Capabilities grounded in real work. Each claim leads back to evidence.")}</p></div><div class="query-sources">{ic("doc", 26)}{t("Sources")}</div>'
    + query_entry("doc", "Delivery & debugging", "Linked project sessions", "›")
    + query_entry("msg", "Collaboration & judgment", "Decisions and user feedback", "›")
    + query_entry("shield", "You control the evidence", "Share only what you approve", "›"))
S.append(shell("AI resume for FDEs", "Explicit memory",
    f'<h2 class="query-title" data-r>{t("An AI resume: your best FDE calling card")}</h2><p class="query-sub" data-r>{t("Tester-inspired scenario · FDE = Forward Deployed Engineer · Illustrative flow")}</p><div class="query-flow">'
    + query_panel(1, "Your real work", "Projects, actions and feedback", query_records)
    + f'<div class="query-arrow">{ARROW}</div>'
    + query_panel(2, "Ask for an AI resume", "The method takes shape here", query_agent, True)
    + f'<div class="query-arrow">{ARROW}</div>'
    + query_panel(3, "A resume you can back up", "Show what you can actually deliver", query_answer, True) + '</div>', "query-rebuilt resume-query"))

# Visual bridge: repeated outcomes reveal reusable steps.
def outcome_sheet(n):
    return f'<div class="outcome-sheet"><span class="outcome-id">0{n}</span>{ic("doc",42)}<div><strong>{t("AI resume")}</strong><i></i><i></i></div><span class="outcome-check">{ic("check",32)}</span></div>'

method_tracks = "".join(f'<div class="method-track"><span>{ic("search",32)}</span><i></i><span>{ic("link",32)}</span><i></i><span>{ic("check",32)}</span></div>' for _ in range(3))
S.append(shell("From outcomes to Skill", "From context to Skill",
    f'<h2 class="ttl" data-r>{t("Keep the method<br>that <b>keeps working.</b>")}</h2><div class="method-visual">'
    + f'<div class="method-scene" data-r style="--d:1"><h3>{t("03 / Useful outcomes")}</h3><div class="outcome-stack">{outcome_sheet(1)}{outcome_sheet(2)}{outcome_sheet(3)}</div></div>'
    + f'<div class="visual-connector" data-r style="--d:2">{ARROW}</div>'
    + f'<div class="method-scene" data-r style="--d:2"><h3>{t("02 / The method behind them")}</h3><div class="method-pattern"><div class="ht"></div><div class="pattern-labels"><span>{t("Find evidence")}</span><span>{t("Connect")}</span><span>{t("Review")}</span></div>{method_tracks}<p>{t("Repeated across sessions")}</p></div></div>'
    + f'<div class="visual-connector" data-r style="--d:3">{ARROW}</div>'
    + f'<div class="method-scene" data-r style="--d:3"><h3>{t("A Skill / Ready to reuse")}</h3><div class="method-asset"><div class="ht"></div><span class="asset-type">SKILL.md</span>{ic("doc",88)}<h4>{t("AI Resume Skill")}</h4><div class="asset-rules"><i></i><i></i><i></i></div><div class="asset-tags"><span>{t("Method")}</span><span>{t("Sources")}</span><span>{t("Limits")}</span></div><p class="asset-approved">{ic("check",25)}{t("Reviewed by you")}</p></div></div></div>'
    + f'<div class="method-return" data-r style="--d:4"><svg viewBox="0 0 1600 80" fill="none" aria-hidden="true"><path d="M1530 0v35q0 25-25 25H95q-25 0-25-25V10M60 23l10-13 10 13"/></svg><span>{t("Reuse. Check the outcome. Refine.")}</span></div><p class="method-takeaway" data-r style="--d:5">{t("Good results reveal good methods.")}</p>', "method-bridge"))

# 5 skill market
sm_rows = "".join([
    f'<div class="row sm {tn}" data-r style="--d:{i+1}"><span class="num">{i:02d}</span><div class="ht"></div>{badge(icn)}<div class="nm"><b>{t(nm)}</b><span class="sub">{t(tx)}</span></div></div>'
    for i, (nm, tx, icn, tn) in enumerate([
        ("Copyable", "Plain text. Copied everywhere.", "doc", "g"),
        ("Unproven value", "A description is not proof of usefulness.", "user", "g"),
        ("Bloat", "Too many Skills. Too much irrelevant context.", "layers", "g"),
    ], 1)])
S.append(shell("Skill Market problem", "Skill Market", f'<h2 class="ttl" data-r>{t("Skills worth paying for<br>need <b>evidence.</b>")}</h2>' + f'''
  <div class="smwrap" style="top:340px">
    <div class="rows sm3">{sm_rows}</div>
    <div class="ca2">{ARROW}</div>
    <div class="res" data-r style="--d:4"><div class="ht dk"></div>
      <div class="rs"><small>{t("Result")}</small><b>{t("Hard to reward creators")}</b><p>{t("Copies lose the link to their creators.")}</p></div>
      <div class="rs"><small>{t("Result")}</small><b>{t("No measurable utility")}</b><p>{t("Nobody knows if it works.")}</p></div>
    </div></div>'''))

# 6 distill (real sessions -> a method)
RIGHT = dict(x=760, y=330, w=1060, h=660)
S.append(shell("Zero-cost distillation", "One · Distill", heading("Across sessions and harnesses,", "distill what works.")
    + callouts([("Across sessions & harnesses", "Connect the experience scattered across your work."), ("Keep the method", "Distill what worked, with its original sources."), ("You make the call", "Review the draft, then mint the version you approve.")], 100, 340, 580)
    + shot("shot-distill.jpg", **RIGHT, marks=[(54.5, 33), (93, 33), (33.5, 13)])
    + cap("Example: a method distilled from a tester’s real session history", 760, 1010, 1060)))

# 7 pitfalls with origin
S.append(shell("Patterns and anti-patterns", "One · Distill", heading("Pitfalls kept,", "with their origin.")
    + callouts([("Follow the thought over time", "Connect conversations across time to recover what you really meant."), ("Keep the wrong turns", "The attempts that failed explain why the method changed."), ("Keep your corrections", "Trace the choices and feedback that shaped the final idea.")], 100, 340, 580)
    + shot("shot-prov.jpg", 840, 330, 900, 690, marks=[(95, 12), (95, 32), (95, 66)])))

# 8 thesis
S.append(f'''<section class="slide light statement" data-title="Thesis">
  <div class="hts l"></div><div class="hts r"></div>
  {FRAME}{LOGO}<div class="label">{t("Our thesis")}</div>
  <div class="copy">
    <h2 data-r>{rich("AI-Native should be<br><b>context-native</b> first.", "thesis")}</h2>
    <p data-r style="--d:2">{t("Useful knowledge should become your context, fitted to the scene you are in right now, not matched by name or tool facet.")}</p>
  </div>
</section>''')

# 9 loop (approved, untouched)
def memory_band(n, title, sub, body, kind, mark=""):
    return f'<div class="memory-band {kind}" data-r style="--d:{n}"><span class="memory-number">{n:02d}</span><div class="ht"></div><div class="memory-name"><h3>{t(title)}</h3><p>{t(sub)}</p></div><div class="memory-detail"><i></i>{t(body)}</div><div class="memory-mark">{ic(mark, 64) if mark else ""}</div></div>'
S.append(shell("Memory with the human in the loop", "Explicit memory",
    f'<h2 class="memory-title" data-r>{t("Memory,<br><b>with the human in the loop.</b>")}</h2><div class="memory-bands">'
    + memory_band(1,"Implicit memory","Hidden, not retained","Temporary context<br>Not persisted<br>Cleared when the session ends","muted","x")
    + memory_band(2,"Queryable sessions","Real conversations","Retrieve on demand<br>Recover relevant sessions<br>Ground the agent’s answers","normal")
    + memory_band(3,"Confirmed memory","Curated conclusions","Confirmed by you<br>Recorded on-chain<br>Persistent and verifiable","accent","check")
    + f'</div><div class="memory-foot"><span>OBELISK × AI × BLOCKCHAIN<br>BUILD BEYOND</span><p>{t("Memory architecture principle")}</p></div>', "memory-rebuilt"))

# 10 divider (generated art, text baked)
S.append(shell("On-chain", "Hackathon build", f'<div class="chain-art"><img src="assets/s-divider-zh.jpg" alt="Five linked context blocks, with a violet center and orbital lines"></div><h2 class="chain-title" data-r>{t("Putting context<br><em>on-chain.</em>")}</h2><p class="chain-sub" data-r style="--d:2">{t("BOT Chain: provenance, usage, payment, privacy.")}</p>', "chain-rebuilt"))

# Knowledge commerce: what changes for the buyer and the people who contribute.
S.append(shell("Knowledge commerce 2.0", "Knowledge commerce 2.0",
    f'<h2 class="commerce-title" data-r>{t("Turn someone’s experience<br>into <b>your ability to act.</b>")}</h2>'
    + f'<div class="commerce-old" data-r style="--d:1"><span class="commerce-era">1.0</span>{ic("doc",76)}<h3>{t("Buy content.")}</h3><p>{t("Read it. Understand it.<br>Work out how to apply it.")}</p><div class="commerce-old-path"><span>{t("Content")}</span><i>→</i><span>{t("You")}</span><i>→</i><span>{t("Practice")}</span></div></div>'
    + f'<div class="commerce-new" data-r style="--d:2"><span class="commerce-era">2.0</span><h3>{t("Put experience to work with AI.")}</h3><div class="commerce-path">'
    + f'<div class="commerce-node"><div class="commerce-drawing source">{ic("doc",70)}<span>SKILL</span><i></i><i></i></div><h4>{t("Someone’s working method")}</h4><p>{t("With sources and real usage")}</p></div><span class="commerce-arrow">→</span>'
    + f'<div class="commerce-node core"><div class="commerce-drawing context">{ic("chip",72)}<span>CONTEXT</span></div><h4>{t("AI + your task")}</h4><p>{t("The method enters the workflow")}</p></div><span class="commerce-arrow">→</span>'
    + f'<div class="commerce-node"><div class="commerce-drawing result">{ic("check",75)}<span>{t("YOUR WORK")}</span></div><h4>{t("Your next deliverable")}</h4><p>{t("For example: your AI résumé")}</p></div></div></div>'
    + f'<div class="commerce-loop" data-r style="--d:3"><span class="commerce-loop-arrow">↳</span><strong>{t("Make it better. Share the next version.")}</strong><span>{t("You earn. Earlier contributors benefit. The platform earns a service fee.")}</span></div>'
    + f'<div class="commerce-promises" data-r style="--d:4"><div><b>01</b><span>{t("Choose with evidence")}</span></div><div><b>02</b><span>{t("Use it as context")}</span></div><div><b>03</b><span>{t("Earn by building on it")}</span></div></div>', "commerce-slide"))


# 11 gaps
def gap(n, left, right, contract, icon, hl=False):
    return f'''<div class="row gp {'v hl' if hl else 'g'}" data-r style="--d:{n+1}"><span class="num">{n:02d}</span><div class="ht"></div>
      {badge(icon)}<div class="gl">{t(left)}</div><div class="gar">{ARROW}</div><div class="gr">{t(right)}</div><div class="gc">{contract}</div></div>'''
S.append(shell("Every gap, an answer", "On-chain", heading("Every gap gets", "an on-chain answer") + rows([
    gap(1, "Copied, no credit", "Fingerprints and lineage", "SkillRegistry", "key"),
    gap(2, "Can't measure use", "Real usage by scene", "UsageStats", "chart"),
    gap(3, "No way to earn", "Priced offers and royalties", "SkillMarket", "coin"),
    gap(4, "Too private to send", "Encrypted shares", "KeyRegistry<br>ShareRegistry", "lock", True),
], 320)))

# 12 relay
S.append(shell("Architecture", "Architecture", heading("Users sign.", "The relay pays.") + cols([
    col(1, "Your machine", [card("laptop", "Sessions stay local"), card("pen", "You sign each action")]),
    col(2, "Relay", [card("shield", "Checks the signature"), card("eyeoff", "Never sees plaintext")], True),
    col(3, "BOT Chain", [card("layers", "Five contracts"), card("lock", "No admin key")]),
])))


# The common interface is the agent; the CLI carries the operations.
S.append(shell("From your agent", "Agent side", heading("Done from", "your agent.")
    + f'<div class="agent-map"><div class="agent-clients" data-r><span>Claude Code</span><span>Codex</span><span>{t("Your coding agent")}</span></div><div class="agent-stem"></div><div class="agent-hub" data-r style="--d:2">Obelisk <small>SKILLS + CLI</small></div><div class="agent-branches"></div><div class="agent-actions" data-r style="--d:3">'
    + ''.join(f'<div>{ic(icon,48)}<strong>{t(label)}</strong></div>' for icon,label in [("search","Find & distill"),("doc","Mint & publish"),("coin","Buy & earn"),("lock","Share & revoke"),("chart","Usage & résumé")])
    + f'</div><p class="agent-natural" data-r style="--d:4">{t("Ask naturally. Review the preview. Confirm the action.")}</p></div>'
    + cap("One interface for the workflow. Terminal access and the matching skills are required; usage detection currently supports Claude Code and Codex.",100,980,1720), "agent-map-slide"))

# Real lineage, presented as a story of knowledge being adapted by different people.
S.append(shell("Skill lineage: knowledge passed on", "Lineage · real testnet relationships", heading("Shared knowledge.", "New possibilities.")
    + '<svg class="lineage-links" viewBox="0 0 1920 1080" fill="none" aria-hidden="true"><path d="M500 610H600V475H710M600 610V765H710" stroke="#9c83bd" stroke-width="3"/><path d="M1140 475H1225V610H1330M1140 765H1225V610" stroke="#b6a3c9" stroke-width="2" stroke-dasharray="8 9"/><path d="M1318 599l12 11-12 11" stroke="#b6a3c9" stroke-width="2"/></svg>'
    + f'<article class="lineage-origin" data-r><span class="lineage-id">#4 · AUTHOR A</span>{ic("doc",55)}<h3>{t("AI capability résumé")}</h3><p>{t("Real work. Traceable evidence.")}</p></article>'
    + f'<div class="lineage-edge" data-r style="--d:1">{t("Same foundation.<br>Different needs.")}</div>'
    + f'<article class="lineage-child first" data-r style="--d:2"><span class="lineage-id">#6 · AUTHOR B</span><h3>{t("Designer portfolio")}</h3><p>{t("Experience → design evidence.")}</p><small>{t("+ A designer’s perspective")}</small></article>'
    + f'<article class="lineage-child second" data-r style="--d:3"><span class="lineage-id">#20 · AUTHOR C</span><h3>{t("Portfolio retelling")}</h3><p>{t("Problem → process → result.")}</p><small>{t("+ A storytelling framework")}</small></article>'
    + f'<article class="lineage-next" data-r style="--d:4"><span class="lineage-id">{t("NEXT · YOUR TURN")}</span><span class="lineage-plus">＋</span><h3>{t("What would you add?")}</h3><p>{t("Your experience. A new use.")}</p><small>{t("A possible next chapter")}</small></article>'
    + f'<p class="lineage-takeaway" data-r style="--d:5">{t("New value grows. Original credit stays.")}</p>'
    + cap("Solid: real testnet lineage. Dashed: your next contribution.",100,1010,1720), "lineage-story"))

# 16 usage (real)
S.append(shell("Skill #4, measured", "Usage stats · live", heading("Read the evidence,", "not the description.")
    + callouts([("Real use", "6 calls from 1 wallet."), ("Outcomes, with sample size", "83% smooth across 6 assessed calls."), ("Rework stays visible", "Errors and user corrections remain part of the record."), ("See where it works", "Weekly calls and observed use cases show the context.")], 100, 340, 580)
    + shot("shot-usage2.jpg", 740, 330, 1080, 660, marks=[(23.5, 20.5), (49, 20.5), (74, 20.5), (98, 45)])
    + cap("Smooth rate = Smooth / (Smooth + Rework + Failure). Unknown is excluded.", 740, 1010, 1080)))

# 17 market (live)
S.append(shell("Market", "Skill Market · live", heading("Skills that speak", "with real usage.")
    + callouts([("Evidence before purchase", "Minting, calls and derivatives come from chain records."), ("Credit stays connected", "Each derivative points back to its parent Skill."), ("Find a method that fits", "Explore by recency, real calls or unique wallets.")], 100, 340, 580)
    + shot("web-market.jpg", 740, 330, 1080, 660, marks=[(49.5, 41), (61.5, 62), (97, 48)])
    + cap("Public page · BOT Chain testnet", 740, 1010, 1080)))

# Editable reconstruction of docs/vision/mockups/market-and-revenue.html.
S.append(shell("Royalties", "Knowledge, shared returns", heading("Royalties follow", "the lineage.")
    + f'<div class="royalty-mock" data-r><div class="royalty-bar"><span>● ● ●</span><span>{t("One purchase. Three perspectives.")}</span><small>{t("Illustrative allocation · not a transaction receipt")}</small></div><div class="royalty-flow"><div class="royalty-pay"><small class="royalty-icon-label">{ic("cart",24)}{t("Buyer · market")}</small><h3>{t("AI Resume Skill")}</h3><b>0.50 <small>BOT</small></b><p>{t("Choose by value.<br>Review price and license.")}</p></div><span class="royalty-arr">→</span><div class="royalty-contract"><span class="royalty-icon-label">{ic("chip",29)}SkillMarket</span><strong>{t("One transaction")}</strong><p>{t("Distribute by agreed rules")}</p></div><div class="royalty-forks"><i></i><i></i><i></i><i></i></div><div class="royalty-payees">'
    + ''.join(f'<div class="royalty-share {kind}" style="--share:{pct}%"><span class="royalty-share-fill" aria-hidden="true"></span><span class="royalty-role-icon" aria-hidden="true">{ic(icon,27)}</span><span class="royalty-role-label"><small>{tier}</small>{t(label)}</span><span class="royalty-share-value"><b>{pct}%</b><small>{value} BOT</small></span></div>' for label,value,pct,icon,tier,kind in [("This Skill’s creator","0.30",60,"pen","THIS SKILL","current"),("Parent contributor","0.10",20,"branch","↑ PARENT","parent"),("Earlier contributor","0.05",10,"layers","↑↑ ANCESTOR","ancestor"),("Platform service","0.05",10,"store","PLATFORM","platform")])
    + f'</div></div><div class="royalty-views"><div><small>{t("Creator · local App")}</small><strong>{t("My sales + derivative income")}</strong><p>{t("See your returns and the transactions behind them.")}</p></div><div><small>{t("Platform · operations")}</small><strong>{t("Service income + distributions")}</strong><p>{t("Reconcile fees and where each payment went.")}</p></div></div></div>'
    + cap("Sharing your knowledge rewards you, and the people who made your next step possible.",100,999,1720), "royalty-slide"))

# Member-generated resume; only the minted count is an explicitly labeled illustration.
S.append(shell("Proof you can show", "Gazerrr03 · Real output", heading("An AI résumé,", "from real work.")
    + callouts([("A history of real work", "601 sessions across 126 active days."), ("Experience across projects", "112 project directories in local history."), ("Capabilities with sources", "Each capability connects to the work behind it."), ("Market feedback, richer capability signals", "Explore how Skill usage and outcomes can enrich the capability profile.")], 100, 340, 580)
    + shot("gazerrr03-resume-demo.png", 740, 330, 1080, 660, marks=[(26, 31), (70, 31), (37, 55), (91, 31)], chips=[("Generated by Gazerrr03 · 2026-10-07", "left:16px;bottom:-26px")])
    + cap("Gazerrr03 · From working history to an AI capability résumé.", 100, 1008, 1720)))

# 18 status
def stat(i, head, chain, pill, text, hl):
    return f'''<div class="big st{' hl' if hl else ''}" data-r style="--d:{i+2}"><div class="ht"></div>
      <div class="stt"><h3>{t(head)}</h3><span class="pill{' on' if hl else ''}">{t(pill)}</span></div>
      <div class="cid">{chain}</div><p>{t(text)}</p></div>'''


def num(n, label):
    return f'<div class="nb"><b>{n}</b><span>{t(label)}</span></div>'


S.append(shell("Status", "Status", heading("Where we are", "today.")
    + '<div class="duo" style="height:350px">'
    + stat(0, "Testnet", "Chain ID 968", "Live", "Mint, use, share, revoke and fork all run here.", True)
    + stat(1, "Mainnet", "Chain ID 677", "Deployed", "All five contracts are live. Same frozen code.", False)
    + "</div>"
    + '<div class="nbs" data-r style="--d:5">' + num("119", "business transactions") + num("24", "Skills minted") + num("15", "private shares") + num("13", "opens, with receipts") + "</div>"
    + bignote("Testnet + mainnet · recorded on 2026-10-08. Transactions count successful contract events; deployment and funding excluded.", 84)))

# A deliberate pause, then the direction beyond compressed Skills.
S.append('<section class="slide light one-more" data-title="One more thing"><h2 data-r>one more thing<span>.</span></h2></section>')

# Three clear stages: original conversations, a shareable connected selection, a new task.
context_sources = '<svg viewBox="0 0 420 300" fill="none" aria-hidden="true"><g stroke="#c1b8cc" stroke-width="2"><path d="M45 60H370M45 145H370M45 230H370"/></g><g fill="#f2f1ec" stroke="#9e8bb5" stroke-width="2"><circle cx="65" cy="60" r="9"/><circle cx="180" cy="60" r="9"/><circle cx="330" cy="60" r="9"/><circle cx="100" cy="145" r="9"/><circle cx="240" cy="145" r="9"/><circle cx="355" cy="145" r="9"/><circle cx="60" cy="230" r="9"/><circle cx="200" cy="230" r="9"/><circle cx="315" cy="230" r="9"/></g><path d="M180 60L240 145L200 230" stroke="#6d4bcc" stroke-width="3" stroke-dasharray="5 7"/><g fill="#6d4bcc"><circle cx="180" cy="60" r="9"/><circle cx="240" cy="145" r="9"/><circle cx="200" cy="230" r="9"/></g></svg>'
context_bundle = '<svg viewBox="0 0 420 300" fill="none" aria-hidden="true"><rect x="27" y="20" width="366" height="260" rx="18" fill="#eee8f5" stroke="#baa8ce"/><path d="M115 90L210 205L310 90M115 90H310" stroke="#9e83c5" stroke-width="2"/><g fill="#faf8f4" stroke="#9e83c5" stroke-width="2"><rect x="72" y="50" width="86" height="80" rx="5"/><rect x="267" y="50" width="86" height="80" rx="5"/><rect x="167" y="165" width="86" height="80" rx="5"/></g><g stroke="#b6a5c9" stroke-width="3"><path d="M89 72h50m-50 13h38m-38 13h45M284 72h50m-50 13h38m-38 13h45M184 186h50m-50 13h38m-38 13h45"/></g><rect x="89" y="109" width="41" height="6" rx="3" fill="#5c4c70"/><circle cx="362" cy="249" r="24" fill="#6843b0"/><path d="M352 248v-5a10 10 0 0 1 20 0v5m-23 0h26v17h-26z" stroke="#fff" stroke-width="2"/></svg>'
S.append(shell("Beyond the Skill", "An idea we are exploring", heading("Share the context.", "Carry the thinking forward.")
    + f'<p class="context-question" data-r>{t("Beyond one session: preserve the connections. Share what matters.")}</p>'
    + '<div class="context-flow">'
    + f'<div class="context-step" data-r style="--d:1"><span class="context-step-no">01 / SOURCE</span><h3>{t("Across conversations")}</h3>{context_sources}<p>{t("Decisions. Attempts. Corrections.")}</p></div>'
    + '<span class="context-flow-arrow" aria-hidden="true">→</span>'
    + f'<div class="context-step" data-r style="--d:2"><span class="context-step-no">02 / SHARE</span><h3>{t("Connected, with consent")}</h3>{context_bundle}<p>{t("Redact the private. Keep the relations.")}</p></div>'
    + '<span class="context-flow-arrow" aria-hidden="true">→</span>'
    + f'<div class="context-step" data-r style="--d:3"><span class="context-step-no">03 / ACT</span><h3>{t("Into someone else’s task")}</h3><div class="context-use-art"><div class="context-task-request">{ic("msg",26)}<span>{t("A new task")}</span></div><div class="context-use-path"></div><div class="context-use-hub">Obelisk<span>{t("Retrieve · Recompose")}</span></div><div class="context-use-path"></div><div class="context-task-result">{ic("check",26)}<span>{t("Build on real experience")}</span></div></div><p>{t("Relevant experience, ready to act on.")}</p></div></div>'
    + f'<div class="context-thesis" data-r style="--d:4"><strong>{t("Context-native first.")}</strong><span>CONTEXT INFRASTRUCTURE</span></div>'
    + f'<p class="context-progress">{t("Already exploring this direction · not fully demonstrated during this hackathon.")}</p>', "context-insight"))

# Existing session-sharing capability grounds the one-more-thing direction.
S.append(shell("The recipient's view", "Session sharing · already working", heading("Share the context.", "Keep control.")
    + shot("shot-reader.jpg", 100, 330, 690, 672, chips=[("Secrets masked", "left:16px;top:16px"), ("Watermarked with the recipient wallet", "left:16px;bottom:16px")])
    + shot("shot-sharetab.jpg", 850, 330, 970, 326, chips=[("Sender: read and revoked", "right:14px;bottom:14px")])
    + shot("shot-revoked.jpg", 850, 700, 560, 302, chips=[("Revoked", "left:14px;bottom:-22px")])
    + f'<p class="sidenote" data-r style="--d:5;left:1450px;top:700px;width:370px;height:302px">{t("Revoke, and the ciphertext is deleted.")}</p>'))

# Closing sequence: the idea, its people, then the concrete entry points.
def teammate(n, name, url, university, role, copy):
    person = f'<a href="{url}" target="_blank" rel="noopener noreferrer">{name} ↗</a>' if url else name
    school = f'<p class="team-school">{t(university)}</p>' if university else '<p class="team-school">&nbsp;</p>'
    avatar = f'<img class="team-avatar" src="assets/avatar-{name}.{("jpg" if name in ("KinomotoMio", "Gazerrr03", "Yuu") else "png")}" alt="{name} GitHub avatar">' if url else '<span class="team-avatar team-initials" aria-label="Shen Tuo initials">ST</span>'
    return f'<article class="team-member" data-r style="--d:{n}"><div class="team-person">{avatar}<div><h3>{person}</h3>{school}</div></div><h4>{t(role)}</h4><p class="team-copy">{t(copy)}</p></article>'

S.append(shell("Team", "The team", f'<h2 class="ttl" data-r>{t("Built <b>together.</b>")}</h2><div class="team-grid">'
    + teammate(1, "KinomotoMio", "https://github.com/KinomotoMio", "Huazhong University of Science and Technology", "Team Lead · Concept & Engineering", "From the first idea to working code.")
    + teammate(2, "z652011350", "https://github.com/z652011350", "University of Chinese Academy of Sciences", "Experience & Value Validation", "Tests the experience and checks that AI output delivers the value we intended.")
    + teammate(3, "Gazerrr03", "https://github.com/Gazerrr03", "Shenzhen University", "Visual Design Lead", "Shapes the visual language and how the project is presented.")
    + teammate(4, "Shen Tuo", None, None, "Hackathon & Vibe Coding Newcomer", "Exploring how to build with AI.")
    + teammate(5, "Yuu", "https://github.com/tommy0103", "Upstream open-source project", "Obelisk Founder", "Created the foundation that makes real sessions queryable.")
    + f'<article class="team-member team-invite" data-r style="--d:6"><div class="team-person"><span class="team-avatar team-initials" aria-hidden="true">＋</span><div><h3>{t("Your name here")}</h3><p class="team-school">Obelisk Valley</p></div></div><h4>{t("Join us. Build together.")}</h4><p class="team-copy">{t("Bring your questions, experience and ideas.")}</p><figure class="community-qr"><img src="assets/community-qr.svg" alt="Obelisk Valley WeChat group QR code"><figcaption>{t("Scan to join · valid before Oct 14")}</figcaption></figure></article>'
    + f'</div><p class="team-upstream">{t("Obelisk was founded by Yuu and is co-maintained with KinomotoMio.")}</p>', "team-slide"))

def closing_link(title, detail, url, short):
    return f'<a class="ending-link" href="{url}" target="_blank" rel="noopener noreferrer"><div><strong>{t(title)}</strong><small>{t(detail)}</small></div><span>{short} ↗</span></a>'

S.append(shell("Context-native first", "Explore Obelisk", f'<div class="ending-art"><img src="assets/closing-towers.png" alt="Connected obelisks with violet accents and halftone texture"></div><h2 class="ending-title" data-r>{t("AI-Native should be<br><em>context native first.</em>")}</h2><div class="ending-links" data-r style="--d:2">'
    + closing_link("Mainnet market", "Live on BOT Chain · competition entry", "https://obelisk-service-mainnet.kinomotomiovo.workers.dev/market", "obelisk-service-mainnet.<br>kinomotomiovo.workers.dev/market")
    + closing_link("Hackathon source", "The on-chain extension built for this hackathon", "https://github.com/KinomotoMio/obelisk-hackathon", "github.com/KinomotoMio/<br>obelisk-hackathon")
    + closing_link("Upstream source", "The session history and memory foundation", "https://github.com/tommy0103/obelisk", "github.com/tommy0103/obelisk")
    + closing_link("Nine-step guided tour", "Nine illustrative steps through Obelisk’s Hackathon journey", "https://obelisk-service.kinomotomiovo.workers.dev/preview", "obelisk-service.<br>kinomotomiovo.workers.dev/preview")
    + closing_link("Official website", "Learn more and get started", "https://obelisk.antinomie.org", "obelisk.antinomie.org")
    + f'</div><p class="ending-footer">{t("Open the links. Explore the evidence.")}<span>BUILT ON BOT CHAIN</span></p>', "ending-slide"))

# ------------------------------------------------------------------ page
CSS = (ROOT / "tools" / "deck.css").read_text()
js = (ROOT / "tools" / "player.js").read_text()
html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Obelisk — Context-native first</title>
<style>
/*{{{{FONTS}}}}*/
{CSS}
</style>
</head>
<body>
<div id="bar"></div>
<div id="stage">

{chr(10).join(S)}

</div>
<div id="help">← → navigate · O overview · F fullscreen · L language · P print/PDF</div>
<script>
{js}
</script>
</body>
</html>
'''
html = html.replace("/*{{{{FONTS}}}}*/", "/*{{FONTS}}*/")
OUT.write_text(html)
print(len(S), "slides ->", OUT)
missing = [e for e in SEEN if e not in ZH]
if missing:
    print("untranslated:", len(missing))
    (ROOT / "src" / "zh.todo.json").write_text(json.dumps({e: "" for e in missing}, ensure_ascii=False, indent=1))
