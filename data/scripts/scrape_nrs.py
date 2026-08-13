#!/usr/bin/env python3
"""Scrape the Nevada Revised Statutes into structured JSON.

Stdlib only, so there is nothing to pip install.

    python3 data/scripts/scrape_nrs.py --chapters 484B 490
    python3 data/scripts/scrape_nrs.py --all

Output: data/corpus/nrs-<chapter>.json, one file per chapter, matching the
StatuteSection type in data/types.ts.

Things about this source that will silently ruin your day if you forget them:

1. The pages are Microsoft Word HTML exports served as windows-1252, NOT utf-8.
   Decode first or every regex quietly matches zero and you think the chapter
   is empty.
2. Nevada separates "NRS" from the section number with an EN SPACE (&#8194;,
   U+2002), not a normal space. Searching for "NRS 484B.130" finds nothing.
   normalize() handles this along with nbsp.
3. Word hard-wraps text mid-phrase, so headings arrive containing newlines.
   Normalize whitespace before you match anything.
4. Chapters ship BOTH versions of a section when an amendment is pending,
   marked "[Effective ...]" / "[Effective through ...]" in the heading. Shipping
   the wrong one as current law is the worst bug this project could have, so we
   record it explicitly rather than silently taking the first match.
"""

import argparse
import html as html_mod
import json
import os
import re
import sys
import time
import urllib.request
from datetime import date

BASE = "https://www.leg.state.nv.us/NRS/"
INDEX = BASE
UA = "nvlaw-cac-student-project/0.1 (Congressional App Challenge; contact via GitHub)"
DELAY = 1.0  # seconds between requests. Be polite, this is a public service.

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW_DIR = os.path.join(ROOT, "data", "raw-html")
OUT_DIR = os.path.join(ROOT, "data", "corpus")

# Whitespace Nevada actually uses.   is the en space between NRS and number.
SPACES = "\xa0       　"


def normalize(s: str) -> str:
    """Unescape entities, flatten every exotic space, collapse runs."""
    s = html_mod.unescape(s)
    for ch in SPACES:
        s = s.replace(ch, " ")
    return re.sub(r"\s+", " ", s).strip()


def strip_tags(s: str) -> str:
    s = re.sub(r"(?is)<(script|style).*?</\1>", " ", s)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    return normalize(s)


def fetch(url: str, cache_name: str) -> str:
    """Fetch with an on-disk cache so reruns do not re-hammer the site."""
    os.makedirs(RAW_DIR, exist_ok=True)
    path = os.path.join(RAW_DIR, cache_name)
    if os.path.exists(path):
        with open(path, "rb") as f:
            raw = f.read()
    else:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
        with open(path, "wb") as f:
            f.write(raw)
        time.sleep(DELAY)
    # windows-1252, not utf-8. See module docstring.
    return raw.decode("windows-1252", errors="replace")


def list_chapters() -> list:
    """Return [(chapter, url)] from the NRS index page."""
    doc = fetch(INDEX, "_index.html")
    seen, out = set(), []
    for m in re.finditer(r'href="(?:.*?/)?NRS-([0-9]+[A-Z]?)\.html"', doc, re.I):
        ch = m.group(1).upper()
        if ch not in seen:
            seen.add(ch)
            out.append((ch, f"{BASE}NRS-{ch}.html"))
    return out


# <p class="COLeadline"><a href="#NRS484BSec130">NRS 484B.130</a>   Heading.</p>
#
# Word writes attributes UNQUOTED (<a name=NRS484BSec003>), so every attribute
# match here treats the quotes as optional. Requiring them silently yields zero
# bodies while the table of contents still parses fine, which looks like a
# working scraper producing empty statutes.
TOC_RE = re.compile(
    r'<p class="?COLeadline"?>\s*<a href="?#([A-Za-z0-9]+Sec[0-9A-Za-z.]+)"?>(.*?)</a>(.*?)</p>',
    re.I | re.S,
)
ANCHOR_RE = re.compile(r'<a name="?([A-Za-z0-9]+Sec[0-9A-Za-z.]+)"?[ >]', re.I)
EFFECTIVE_RE = re.compile(r"\[(Effective[^\]]*)\]", re.I)


DATE_RE = re.compile(r"([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})")


def is_current(label: str) -> bool:
    """Is this the version of the section in force TODAY?

    Two forms appear, and they mean opposite things:

        "Effective through June 30, 2026"  -> in force UNTIL that date
        "Effective July 1, 2026"           -> in force FROM that date

    Comparing dates matters. A naive "through == current" rule marks every
    already-commenced amendment as not-current, which would make the app show
    superseded law. If we cannot parse a date, return True and let the QA pass
    catch it, because hiding a real statute is worse than showing an extra one.
    """
    m = DATE_RE.search(label)
    if not m:
        return True
    try:
        d = date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2)))
    except (KeyError, ValueError):
        return True
    today = date.today()
    if re.search(r"through", label, re.I):
        return today <= d
    return today >= d


MONTHS = {
    m.lower(): i
    for i, m in enumerate(
        ["January", "February", "March", "April", "May", "June", "July",
         "August", "September", "October", "November", "December"], 1)
}


def parse_chapter(doc: str, chapter: str, url: str) -> list:
    title_m = re.search(r"<title>(.*?)</title>", doc, re.I | re.S)
    raw_title = normalize(title_m.group(1)) if title_m else f"CHAPTER {chapter}"
    chapter_title = re.sub(r"^NRS:?\s*CHAPTER\s*[0-9A-Z]+\s*-\s*", "", raw_title, flags=re.I)

    # 1. Table of contents gives us anchor -> (citation, heading).
    headings = {}
    for m in TOC_RE.finditer(doc):
        anchor, cite_html, head_html = m.groups()
        headings[anchor] = (normalize(strip_tags(cite_html)), strip_tags(head_html))

    # 2. Body: each <a name="..."> starts a section, running to the next one.
    marks = [(m.group(1), m.start()) for m in ANCHOR_RE.finditer(doc)]
    bodies = {}
    for i, (anchor, pos) in enumerate(marks):
        end = marks[i + 1][1] if i + 1 < len(marks) else len(doc)
        bodies.setdefault(anchor, strip_tags(doc[pos:end]))

    today = date.today().isoformat()
    out = []
    for anchor in headings:
        citation, heading = headings[anchor]
        text = bodies.get(anchor, "")
        if not citation:
            continue

        repealed = bool(re.match(r"^\s*Repealed\b", heading, re.I))
        eff = EFFECTIVE_RE.search(heading) or EFFECTIVE_RE.search(text[:400])

        sec = {
            "id": citation.replace(" ", "-"),
            "citation": citation,
            "chapter": chapter,
            "chapterTitle": chapter_title,
            "heading": heading,
            "text": text,
            "sourceUrl": f"{url}#{anchor}",
            "status": "repealed" if repealed else "active",
            "scrapedAt": today,
        }
        if eff:
            label = normalize(eff.group(1))
            sec["effective"] = {"label": label, "isCurrent": is_current(label)}
        out.append(sec)

    out.sort(key=lambda s: s["citation"])
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--chapters", nargs="*", help="e.g. 484B 490")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="cap chapters, for testing")
    args = ap.parse_args()

    if args.all or not args.chapters:
        chapters = list_chapters()
        print(f"index lists {len(chapters)} chapters")
        if args.limit:
            chapters = chapters[: args.limit]
    else:
        chapters = [(c.upper(), f"{BASE}NRS-{c.upper()}.html") for c in args.chapters]

    os.makedirs(OUT_DIR, exist_ok=True)
    total = repealed = dual = 0

    for ch, url in chapters:
        try:
            doc = fetch(url, f"NRS-{ch}.html")
        except Exception as e:
            print(f"  {ch}: FETCH FAILED {e}", file=sys.stderr)
            continue
        secs = parse_chapter(doc, ch, url)
        if not secs:
            print(f"  {ch}: 0 sections (check the parser before trusting this)")
            continue
        with open(os.path.join(OUT_DIR, f"nrs-{ch}.json"), "w", encoding="utf-8") as f:
            json.dump(secs, f, indent=1, ensure_ascii=False)
        r = sum(1 for s in secs if s["status"] == "repealed")
        d = sum(1 for s in secs if "effective" in s)
        total, repealed, dual = total + len(secs), repealed + r, dual + d
        print(f"  {ch}: {len(secs)} sections ({r} repealed, {d} dated) -> nrs-{ch}.json")

    print(f"\nTOTAL {total} sections, {repealed} repealed, {dual} with effective-date variants")
    return 0


if __name__ == "__main__":
    sys.exit(main())
