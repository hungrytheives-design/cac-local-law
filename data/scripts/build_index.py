#!/usr/bin/env python3
"""Turn the scraped corpus into a compact index the app can actually ship.

    python3 data/scripts/build_index.py

Reads  data/corpus/nrs-*.json
Writes app/assets/nrs-index.json

WHY THIS EXISTS
---------------
The raw corpus runs about 2.4 KB per section. Across all of NRS that is roughly
150 MB, which cannot go in an Expo Go bundle. But dropping statutes to save
space would gut the whole point of the app, which is that it covers everything.

So we keep EVERY section searchable and only vary how much we carry:

  userFacing  -> heading + keywords + FULL verbatim text
  everything  -> heading + keywords + citation + link, text fetched by tapping
  else           through to leg.state.nv.us

Coverage stays total. Only the payload shrinks. A search for something obscure
still finds the right statute and still links to the real text.

Triage here is a plain heuristic, deliberately. It is auditable, it runs offline,
it costs nothing, and it is easy to argue for. A generated plain-language pass
can be layered on later without changing this file's output shape.
"""

import glob
import json
import os
import re
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CORPUS = os.path.join(ROOT, "data", "corpus")
OUT = os.path.join(ROOT, "app", "assets", "nrs-index.json")

# Headings that mean "this section governs an agency, not a person."
# Kept searchable, just not carried with full text.
BORING = re.compile(
    r"^(definitions?|.*\bdefined\b|short title|legislative (findings|declaration|intent)"
    r"|applicability|construction of|severability|repealed"
    r"|(powers and )?duties of (the )?(department|board|commission|division|administrator)"
    r"|regulations|administration|deposit of|creation of|membership|meetings"
    r"|annual report|records|fees|account|fund|budget|appropriation)",
    re.I,
)

STOP = set(
    "the a an of to in for or and by on with certain other otherwise provided when "
    "which that this these those is are be been as at from not no any all such may "
    "shall must person persons required requirement use used using".split()
)


def keywords(heading: str, chapter_title: str) -> list:
    words = re.findall(r"[a-z]{3,}", (heading + " " + chapter_title).lower())
    out = []
    for w in words:
        if w not in STOP and w not in out:
            out.append(w)
    return out[:14]


def user_facing(sec: dict) -> bool:
    if sec.get("status") == "repealed":
        return False
    if "effective" in sec and not sec["effective"].get("isCurrent", True):
        return False  # pending version, not the law today
    if BORING.match(sec.get("heading", "")):
        return False
    return len(sec.get("text", "")) >= 200


def main() -> int:
    files = sorted(glob.glob(os.path.join(CORPUS, "nrs-*.json")))
    if not files:
        print("no corpus found. run scrape_nrs.py first.", file=sys.stderr)
        return 1

    sections, kept_text, chapters = [], 0, set()
    for path in files:
        with open(path, encoding="utf-8") as f:
            for sec in json.load(f):
                chapters.add(sec["chapter"])
                uf = user_facing(sec)
                entry = {
                    "i": sec["id"],
                    "c": sec["citation"],
                    "h": sec["heading"],
                    "u": sec["sourceUrl"],
                    "k": keywords(sec["heading"], sec.get("chapterTitle", "")),
                    "ct": sec.get("chapterTitle", ""),
                }
                if uf:
                    entry["t"] = sec["text"]
                    kept_text += 1
                if sec.get("status") == "repealed":
                    entry["r"] = 1
                if "effective" in sec:
                    entry["e"] = sec["effective"]["label"]
                    entry["ec"] = 1 if sec["effective"].get("isCurrent") else 0
                sections.append(entry)

    sections.sort(key=lambda s: s["c"])
    payload = {
        "meta": {
            "generated": date.today().isoformat(),
            "source": "Nevada Revised Statutes, leg.state.nv.us",
            "chapters": len(chapters),
            "sections": len(sections),
            "withFullText": kept_text,
        },
        "sections": sections,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    mb = os.path.getsize(OUT) / 1_000_000
    print(f"chapters      {len(chapters)}")
    print(f"sections      {len(sections)}  (all searchable)")
    print(f"w/ full text  {kept_text}  ({kept_text * 100 // max(len(sections),1)}%)")
    print(f"bundle size   {mb:.1f} MB -> app/assets/nrs-index.json")
    if mb > 25:
        print("\nWARNING: over 25 MB. Tighten the BORING heuristic or drop text length.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
