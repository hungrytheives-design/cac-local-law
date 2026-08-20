#!/usr/bin/env python3
"""Score search quality on hard queries. A benchmark, not a gate.

    python3 data/scripts/eval_search.py
    python3 data/scripts/eval_search.py -v      # show what came back

search-tests.json is the REGRESSION suite: it must stay green, and every case
in it is a query the app already handles. This file is the opposite. It is a
deliberately unfair set - compound questions, vague ones, slang, topics whose
statutory word nobody knows, and questions Nevada law does not answer at all.

Most of these fail today. That is the point: the number is the honest measure
of the app's main feature, and it should go up over time.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_search import load, search

G, R, Y, D, O = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main():
    verbose = "-v" in sys.argv
    sections, titles, concepts = load()
    cases = json.load(open(os.path.join(ROOT, "data", "eval-queries.json")))

    by_group, order = {}, []
    for c in cases:
        if c["g"] not in by_group:
            by_group[c["g"]] = []
            order.append(c["g"])
        by_group[c["g"]].append(c)

    total = good = 0
    for g in order:
        gg = 0
        print(f"\n{g.upper()}")
        for c in by_group[g]:
            hits, _, _ = search(c["q"], sections, titles, concepts, 3)
            top = hits[:3]
            if c.get("none"):
                ok = not top
                want = "nothing"
            elif c.get("cite"):
                ok = any(s["c"] == c["cite"] for _, s in top)
                want = c["cite"]
            else:
                ok = any(s["ch"] in c["ch"] for _, s in top)
                want = "ch " + "/".join(c["ch"])
            got = f"{top[0][1]['c']} {top[0][1]['h'][:34]}" if top else "nothing"
            total += 1
            good += ok
            gg += ok
            mark = f"{G}ok  {O}" if ok else f"{R}MISS{O}"
            print(f"  {mark} {c['q'][:52]:<52} {D}{got}{O}")
            if verbose and not ok:
                print(f"       {D}wanted {want}{O}")
        print(f"  {D}{gg}/{len(by_group[g])}{O}")

    pct = good * 100 // max(total, 1)
    print(f"\n{'-'*70}\n  SCORE {good}/{total}  ({pct}%)\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
