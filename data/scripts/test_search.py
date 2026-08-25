#!/usr/bin/env python3
"""Test the app's search without a phone.

    python3 data/scripts/test_search.py                  # run the whole suite
    python3 data/scripts/test_search.py -v               # ...and show top hits
    python3 data/scripts/test_search.py "ride my ebike"  # try one query

WHY THIS EXISTS
---------------
The lexicon in data/concepts.json is the part of this project a human has to
build by hand, and until now the only way to check whether an edit helped was to
load a 16 MB bundle onto a phone and squint at it. That is slow enough that you
stop checking, which is how "skateboarding" ended up returning a statute about
trustees leaving office.

So: edit concepts.json, run build_index.py, run this. One command, real answer.

THE THREE RESULT STATES
-----------------------
    PASS  the expected chapter showed up in the top N. Keep it that way.
    FAIL  it used to work, or it obviously should, and it does not. A regression.
    TODO  we do not know the right answer yet because the lexicon entry is not
          researched. These are not failures, they are the worklist. Every TODO
          that turns into a PASS is a question the app can now answer.

A suite that is all PASS and no TODO means the lexicon is done.

KNOWN LIMITATION, READ THIS BEFORE YOU TRUST IT
-----------------------------------------------
The scoring below is a hand port of the TypeScript in app/App.tsx. Two copies of
one algorithm will drift apart the moment somebody edits one and not the other.
That is a real hazard and it is accepted deliberately: the alternative is a Node
build step, which is more machinery than this project needs.

**If you change ranking in App.tsx, change it here in the same sitting.** The
port covers tokenize(), stem(), expand() and the scoring block. Nothing else in
App.tsx affects results.
"""

import argparse
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INDEX = os.path.join(ROOT, "app", "assets", "nrs-index.json")
CONCEPTS = os.path.join(ROOT, "data", "concepts.json")
TESTS = os.path.join(ROOT, "data", "search-tests.json")


# ---------------------------------------------------------------- port of App.tsx

# Mirrors STOP in app/App.tsx.
STOP = set("""
the a an of to in for or and on is are can i my do need what me you
want wants wanna get got getting go going goes
have has had take taking takes use using used
out from with this that these those there here
allowed able let lets legal illegal law laws rule rules
about when where how why who which while
would should could will shall might must may
be been being was were am it its they them
their we us our he she her him your
if but not all any some just like really still
even only very much many more most also then
than little big one two old new say know think
""".split())


def stem(t):
    """Mirrors stem() in app/App.tsx."""
    for suf in ("ing", "ed", "es", "s"):
        if len(t) > len(suf) + 2 and t.endswith(suf):
            return t[: -len(suf)]
    return t


def tokenize(q):
    """Mirrors tokenize() in app/App.tsx."""
    q = re.sub(r"[^a-z0-9\s]", " ", q.lower())
    return [t for t in q.split() if len(t) > 2 and t not in STOP]


def flat(s):
    """Mirrors flat() in app/App.tsx."""
    return re.sub(r"[-\s]+", " ", s.lower()).strip()


def expand(tokens, raw, concepts):
    """Mirrors expand() in app/App.tsx. Returns (statutory phrases, chapter hints)."""
    terms, chapters = set(), set()
    q = raw.lower()
    stems = [s for s in (stem(t) for t in tokens) if len(s) >= 3]

    for c in concepts:
        hit = False
        for term in c["colloquial"]:
            if " " in term:
                if term in q:
                    hit = True
                    break
            elif term in tokens:
                hit = True
                break
            else:
                # Both sides must be 4+ chars; see the matching comment in
                # App.tsx. "off" used to prefix-match "offroad".
                ts = stem(term)
                if len(ts) >= 4 and any(
                    len(s) >= 4 and (s.startswith(ts) or ts.startswith(s))
                    for s in stems
                ):
                    hit = True
                    break
        if not hit:
            continue
        for phrase in c["statutory"]:
            terms.add(flat(phrase))
        for ch in c["chapters"]:
            chapters.add(ch)
    return terms, chapters


# --- rarity -----------------------------------------------------------------
# "school" is in 805 headings, "truancy" in 12. Scoring both at +10 let 805
# irrelevant sections drown the 12 relevant ones. A word's worth should fall
# as it gets commoner.
_DF = None


def rarity(token, sections):
    global _DF
    if _DF is None:
        _DF = {}
        for s in sections:
            for w in set(re.findall(r"[a-z0-9]{3,}", s["h"].lower())):
                _DF[w] = _DF.get(w, 0) + 1
    n = len(sections)
    df = _DF.get(token, 0)
    return math.log(n / (1 + df)) / math.log(n)


# Sections that administer the law rather than state it. They match query words
# as readily as real rules and then outrank them: "off highway vehicle
# registration" returned the Revolving Account for OHV Titling.
ADMIN = re.compile(
    r"^(?:.*\b(?:regulations|account|fund|legislative declaration|appropriation"
    r"|reports?|records|fees|budget|membership|meetings)\b"
    r"|department|commission|board|division|director|administrator)",
    re.I,
)


# Mirrors keywords() in build_index.py and keywordsOf() in App.tsx. Keywords are
# no longer shipped: they are a pure function of the heading and chapter title,
# and storing them for 50,299 sections cost 5.3 MB.
_KW_STOP = set(
    "the a an of to in for or and by on with certain other otherwise provided when "
    "which that this these those is are be been as at from not no any all such may "
    "shall must person persons required requirement use used using".split()
)
_KW_CACHE = {}


def kw_of(sec, titles):
    key = sec["i"]
    if key not in _KW_CACHE:
        text = (sec["h"] + " " + titles.get(sec["ch"], "")).lower()
        out = []
        for w in re.findall(r"[a-z]{3,}", text):
            if w not in _KW_STOP and w not in out:
                out.append(w)
        _KW_CACHE[key] = out[:14]
    return _KW_CACHE[key]


def search(query, sections, titles, concepts, limit=10):
    """Mirrors search() in app/App.tsx. Returns [(score, section)]."""
    tokens = tokenize(query)
    if not tokens:
        return [], tokens, set()
    terms, chapters = expand(tokens, query, concepts)

    scored = []
    for s in sections:
        score = 0
        heading = s["h"].lower()
        text = s.get("t")

        matched = 0
        for t in tokens:
            w = rarity(t, sections)
            hit = False
            if t in heading:
                score += 10 * w
                hit = True
            if any(k.startswith(t) for k in kw_of(s, titles)):
                score += 6 * w
                hit = True
            if t in titles.get(s["ch"], "").lower():
                score += 2 * w
                hit = True
            if text and t in text.lower():
                score += 1 * w
                hit = True
            matched += hit

        # Catching one rare word is not the same as catching the question.
        # Rarity alone made "skipping school" return "Generation-skipping
        # transfer" defined, on the strength of "skipping" and nothing else.
        if tokens:
            score *= matched / len(tokens)

        fh = flat(s["h"])
        ft = flat(text) if text else None
        for t in terms:
            if t in fh:
                score += 12
            if ft and t in ft:
                score += 2

        if score > 0 and s["ch"] in chapters:
            score += 20
        if ADMIN.match(s["h"]):
            score -= 6          # administers the law, does not state it
        if s.get("r"):
            score -= 20
        if s.get("e") and s.get("ec") == 0:
            score -= 15
        if score > 0:
            scored.append((score, s))

    scored.sort(key=lambda x: -x[0])

    # 0.45 is the measured edge. At 0.48 the eval gains one case but
    # "my friend wants to drive me home from school" goes dark, which is a
    # real question and a worse loss than the gain.
    # If the best hit only caught a common word, we have not answered the
    # question, and a confident wrong statute is worse than saying nothing.
    # "what are my rights" used to return marital property law.
    reach = sum(10 * rarity(t, sections) for t in tokens)
    if not scored or (reach and scored[0][0] < 0.45 * reach):
        return [], tokens, chapters
    return scored[:limit], tokens, chapters


# ------------------------------------------------------------------------ runner

GREEN, RED, YELLOW, DIM, OFF = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def load():
    if not os.path.exists(INDEX):
        sys.exit("no index found. run: python3 data/scripts/build_index.py")
    with open(INDEX, encoding="utf-8") as f:
        idx = json.load(f)
    with open(CONCEPTS, encoding="utf-8") as f:
        concepts = json.load(f)
    return idx["sections"], idx["chapterTitles"], concepts


def show(hits, indent="      "):
    if not hits:
        print(f"{indent}{DIM}(no results){OFF}")
    for score, s in hits:
        flag = ""
        if s.get("r"):
            flag = " [REPEALED]"
        elif s.get("e") and s.get("ec") == 0:
            flag = " [NOT YET IN FORCE]"
        print(f"{indent}{DIM}{score:4d}{OFF}  {s['c']:<15} {s['h'][:62]}{flag}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query", nargs="*", help="run one query instead of the suite")
    ap.add_argument("-v", "--verbose", action="store_true", help="show top hits")
    ap.add_argument("-n", "--limit", type=int, default=5)
    args = ap.parse_args()

    sections, titles, concepts = load()

    # Ad-hoc mode: one query, show what comes back.
    if args.query:
        q = " ".join(args.query)
        hits, tokens, chapters = search(q, sections, titles, concepts, args.limit)
        print(f"\n{q!r}")
        print(f"  tokens        {tokens}")
        print(f"  chapter hints {sorted(chapters) or '(none - lexicon did not fire)'}")
        print()
        show(hits, indent="  ")
        print()
        return 0

    if not os.path.exists(TESTS):
        sys.exit(f"no test suite at {TESTS}")
    with open(TESTS, encoding="utf-8") as f:
        cases = json.load(f)

    npass = nfail = ntodo = 0
    failures = []

    for case in cases:
        q = case["query"]
        top_n = case.get("topN", 3)
        hits, tokens, chapters = search(
            q, sections, titles, concepts, max(top_n, args.limit)
        )
        top = hits[:top_n]

        want_ch = case.get("expectChapter")
        want_cite = case.get("expectCitation")

        # Some topics genuinely are not in NRS (body art is county health
        # district, not state law). Returning nothing is the correct answer
        # there, so it needs to be assertable rather than sitting as a TODO.
        if case.get("expectNone"):
            if not top:
                npass += 1
                print(f"{GREEN}PASS{OFF}  {q}")
                print(f"      {DIM}no results, as expected (not state law){OFF}")
            else:
                nfail += 1
                got = f"{top[0][1]['c']} ({top[0][1]['h'][:40]})"
                print(f"{RED}FAIL{OFF}  {q}")
                print(f"      {DIM}expected no results, got {got}{OFF}")
                failures.append((q, "no results", got))
            continue

        if want_ch is None and want_cite is None:
            ntodo += 1
            print(f"{YELLOW}TODO{OFF}  {q}")
            if case.get("todo"):
                print(f"      {DIM}-> {case['todo']}{OFF}")
            if top:
                print(f"      {DIM}currently: {top[0][1]['c']} {top[0][1]['h'][:48]}{OFF}")
            if args.verbose:
                show(top)
            continue

        ok = False
        if want_cite:
            ok = any(s["c"] == want_cite for _, s in top)
        elif want_ch:
            # A topic can legitimately live in more than one chapter: fishing is
            # split between 502 (licences) and 503 (manner and means), and either
            # is a correct answer. Accept a string or a list.
            wanted = want_ch if isinstance(want_ch, list) else [want_ch]
            ok = any(s["ch"] in wanted for _, s in top)

        if ok:
            npass += 1
            got = top[0][1]
            print(f"{GREEN}PASS{OFF}  {q}")
            print(f"      {DIM}{got['c']} {got['h'][:56]}{OFF}")
            if args.verbose:
                show(top)
        else:
            nfail += 1
            want = want_cite or f"chapter {want_ch}"
            got = f"{top[0][1]['c']} ({top[0][1]['h'][:40]})" if top else "nothing"
            print(f"{RED}FAIL{OFF}  {q}")
            print(f"      {DIM}wanted {want} in top {top_n}, got {got}{OFF}")
            failures.append((q, want, got))
            if args.verbose:
                show(top)

    total = npass + nfail + ntodo
    print(f"\n{'-' * 66}")
    print(
        f"  {GREEN}{npass} pass{OFF}   {RED}{nfail} fail{OFF}   "
        f"{YELLOW}{ntodo} todo{OFF}   ({total} cases)"
    )

    if ntodo:
        print(f"\n  {YELLOW}TODO cases are the lexicon worklist, not bugs.{OFF}")
        print(f"  {DIM}Research the chapter, add it to data/concepts.json, set{OFF}")
        print(f"  {DIM}expectChapter in data/search-tests.json, rebuild, rerun.{OFF}")
    if nfail:
        print(f"\n  {RED}Failures are regressions. Something that worked, broke.{OFF}")
        for q, want, got in failures:
            print(f"  {DIM}- {q}: wanted {want}, got {got}{OFF}")

    return 1 if nfail else 0


if __name__ == "__main__":
    sys.exit(main())
