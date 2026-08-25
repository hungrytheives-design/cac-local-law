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


def load_lexicon_chapters() -> set:
    """Chapters the concept lexicon points at.

    These are the chapters real user questions actually land in, so they are the
    only ones worth carrying full statute text for. Everything else stays fully
    searchable by heading and keyword and links out. As the lexicon grows, offline
    text coverage grows with it, which is a nice property: the human work directly
    expands what the app can show without touching this script.
    """
    path = os.path.join(ROOT, "data", "concepts.json")
    if not os.path.exists(path):
        return set()
    with open(path, encoding="utf-8") as f:
        return {ch for c in json.load(f) for ch in c.get("chapters", [])}


def user_facing(sec: dict, text_chapters: set) -> bool:
    if sec.get("status") == "repealed":
        return False
    if "effective" in sec and not sec["effective"].get("isCurrent", True):
        return False  # pending version, not the law today
    if BORING.match(sec.get("heading", "")):
        return False
    if sec.get("chapter") not in text_chapters:
        return False
    return len(sec.get("text", "")) >= 200


# --------------------------------------------------------- obligation extraction
#
# The curated tier answers eight topics because a human wrote each one. This
# covers the rest of the corpus WITHOUT writing anything: statutes are formulaic
# ("A person shall not...", "must be at least 16 years of age", "is guilty of a
# misdemeanor"), so the obligations can be lifted out mechanically.
#
# Every bullet produced here is a VERBATIM sentence from the statute. Nothing is
# paraphrased, summarised or generated, so this cannot say something the law does
# not say - the worst case is quoting a less useful sentence than the best one.

# An institution carrying the duty means the sentence is procedure, not a rule a
# person can follow. "The court shall provide the person with a list..." is not
# an answer to "can I do this".
PROCEDURAL = re.compile(
    r"\b(?:court|department|commission|board|division|director|administrator"
    r"|agency|bureau|legislature|governor)\s+(?:shall|must|may|is required)\b",
    re.I,
)

# A top-level rule names who it binds, up front. Sentences that match this are
# shown first, so an exception buried at (2) does not outrank the actual rule.
PRIMARY = re.compile(
    r"^(?:except[^,]{0,80},\s*)?(?:it is unlawful|no |a |an |any |every |each |the )?"
    r"\s*(?:person|operator|driver|owner|parent|guardian|employer|child|pupil"
    r"|applicant|bicycle|vehicle|motorist)\b",
    re.I,
)

SENTENCE = re.compile(r"(?<=[.;])\s+(?=[A-Z(])|\s+Ê\s+")

OBLIGATION = [
    ("no", re.compile(r"\b(?:shall|must|may)\s+not\b|\bis unlawful\b|\bprohibited\b", re.I)),
    ("age", re.compile(r"\b\d{1,2}\s+years of age\b", re.I)),
    ("penalty", re.compile(r"\bis guilty of a\b", re.I)),
    ("must", re.compile(r"\b(?:shall|must)\b(?!\s+not)", re.I)),
]

CRUFT = re.compile(r"\((?:Added to NRS|NRS A)[^)]*\)|—\(Substituted[^)]*\)")


# Full text is rationed by chapter because 54 MB of statute text cannot ship.
# Bullets are not: three sentences cost a fraction of a whole statute, so every
# live section in the code can carry them. This is what decouples "can the app
# answer you" from "did a human write a lexicon entry for your topic".
def has_bullets(sec: dict) -> bool:
    if sec.get("status") == "repealed":
        return False
    if "effective" in sec and not sec["effective"].get("isCurrent", True):
        return False
    if BORING.match(sec.get("heading", "")):
        return False
    return len(sec.get("text", "")) >= 200


# Two bullets at 300 characters is the point where corpus-wide coverage still
# fits in the bundle: 20,621 sections for 5.4 MB, against 13.2 MB for three
# uncapped bullets. Measured, not guessed.
MAX_BULLETS = 2
MAX_BULLET_CHARS = 300


def obligations(citation: str, heading: str, text: str, limit: int = MAX_BULLETS) -> list:
    """Verbatim sentences from the statute that state a duty, limit or penalty."""
    prefix = f"{citation} {heading}"
    body = text[len(prefix):] if text.startswith(prefix) else text
    body = CRUFT.sub("", body).strip()

    primary, other = [], []
    for raw in SENTENCE.split(body):
        sent = re.sub(r"\s+", " ", raw).strip(" Ê")
        sent = re.sub(r"^\d+\.\s*", "", sent)
        sent = re.sub(r"^\[[^\]]*\]\s*", "", sent)   # drop a leading [Effective ...]
        if len(sent) < 30 or len(sent) > 700:
            continue
        if PROCEDURAL.search(sent):
            continue
        for kind, rx in OBLIGATION:
            if rx.search(sent):
                (primary if PRIMARY.match(sent) else other).append({"k": kind, "t": sent})
                break
    picked = [x for x in primary + other if len(x["t"]) <= MAX_BULLET_CHARS]
    return picked[:limit]


def main() -> int:
    files = sorted(glob.glob(os.path.join(CORPUS, "nrs-*.json")))
    if not files:
        print("no corpus found. run scrape_nrs.py first.", file=sys.stderr)
        return 1

    text_chapters = load_lexicon_chapters()
    sections, kept_text, titles = [], 0, {}
    with_points = 0
    for path in files:
        with open(path, encoding="utf-8") as f:
            for sec in json.load(f):
                # Chapter titles repeat across thousands of sections. Storing them
                # once in a lookup saves megabytes over repeating the string.
                titles.setdefault(sec["chapter"], sec.get("chapterTitle", ""))
                uf = user_facing(sec, text_chapters)
                entry = {
                    "i": sec["id"],
                    "c": sec["citation"],
                    "h": sec["heading"],
                    # Neither sourceUrl nor keywords are stored. The URL is a
                    # pure function of the citation; the keywords are a pure
                    # function of the heading and chapter title, both of which
                    # already ship. Together they cost 8.5 MB of repetition.
                    # urlOf() and the keyword pass in cached() rebuild them.
                    "ch": sec["chapter"],
                }
                if uf:
                    entry["t"] = sec["text"]
                    kept_text += 1
                if has_bullets(sec):
                    pts = obligations(
                        sec["citation"], sec["heading"], sec["text"]
                    )
                    if pts:
                        entry["p"] = pts
                        with_points += 1
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
            "chapters": len(titles),
            "sections": len(sections),
            "withFullText": kept_text,
        },
        "chapterTitles": titles,
        "sections": sections,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    # The lexicon lives in data/ (humans edit it there) but Metro can only bundle
    # files under app/, so mirror it across on every build.
    src = os.path.join(ROOT, "data", "concepts.json")
    if os.path.exists(src):
        with open(src, encoding="utf-8") as f:
            concepts = json.load(f)
        dst = os.path.join(ROOT, "app", "assets", "concepts.json")
        with open(dst, "w", encoding="utf-8") as f:
            json.dump(concepts, f, ensure_ascii=False, separators=(",", ":"))
        print(f"lexicon       {len(concepts)} concepts -> app/assets/concepts.json")

    # Same reason, for the curated tier: hand-written plain-language rules with
    # citations. Every citation is checked against the corpus first, because a
    # rule pointing at a section that does not exist is worse than no rule.
    src = os.path.join(ROOT, "data", "activities.json")
    if os.path.exists(src):
        with open(src, encoding="utf-8") as f:
            activities = json.load(f)
        known = {s["c"] for s in sections}
        missing = sorted(
            {
                r["citation"]
                for a in activities
                for r in a["rules"]
                if r["citation"] not in known
            }
        )
        if missing:
            print(f"\nERROR: activities.json cites sections not in the corpus: {missing}")
            return 1
        dst = os.path.join(ROOT, "app", "assets", "activities.json")
        with open(dst, "w", encoding="utf-8") as f:
            json.dump(activities, f, ensure_ascii=False, separators=(",", ":"))
        rules = sum(len(a["rules"]) for a in activities)
        print(f"curated       {len(activities)} activities, {rules} rules -> app/assets/activities.json")

    mb = os.path.getsize(OUT) / 1_000_000
    print(f"chapters      {len(titles)}")
    print(f"sections      {len(sections)}  (all searchable)")
    print(f"w/ bullets    {with_points}  (all chapters, not just lexicon)")
    print(f"w/ full text  {kept_text}  ({kept_text * 100 // max(len(sections),1)}%)")
    print(f"bundle size   {mb:.1f} MB -> app/assets/nrs-index.json")
    if mb > 25:
        print("\nWARNING: over 25 MB. Tighten the BORING heuristic or drop text length.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
