# nvlaw

**You type what you're about to do. It shows you the Nevada laws about it, and links to the real statute.**

The entire Nevada Revised Statutes, 49,742 sections, searchable on your phone with
no internet connection and no AI running at search time.

Built for the 2026 Congressional App Challenge.

---

## The problem

You say "dirtbike." The law says "off-highway vehicle."

So when a normal person tries to look up the rules that govern their own life,
they get nothing, because they don't know the magic words. They end up on a blog
post that cites no source and might be five years out of date.

Nevada law is public. It is not accessible. Those are different things.

## How it works

**1. The whole legal code ships inside the app.**
All 835 chapters are scraped ahead of time, parsed, and compiled into a search
index bundled with the app. There is no server and no API call. It works in
airplane mode.

**2. A concept lexicon translates how people talk into how statutes are written.**
This is the part that makes the app work. It's a hand-built, hand-verified map
from colloquial language to statutory language:

```json
{
  "id": "ohv",
  "colloquial": ["dirtbike", "quad", "four wheeler", "atv", "side by side"],
  "statutory": ["off-highway vehicle", "all-terrain vehicle"],
  "chapters": ["490"]
}
```

Type "dirtbike" and the app searches for "off-highway vehicle," weights chapter
490 higher, and returns `NRS 490.105 Large all-terrain vehicle: Operation on
certain roads authorized`. The word "dirtbike" appears nowhere in Nevada law.

**3. Nothing is generated when you search.**
Search is keyword matching against a fixed index of real statutes. There is no
model in the runtime path, so the app cannot invent a law, misquote one, or
confidently answer a question it doesn't know. Every result carries its citation
and links to the source text on `leg.state.nv.us`.

For an app about law, where being confidently wrong is the worst possible
failure, that's a design position, not a limitation.

## What's in it

| | |
|---|---|
| Chapters | 835 |
| Sections indexed | 49,742 |
| Bundle size | 16.1 MB |
| Network calls at runtime | 0 |
| Search latency | offline, no request |

Every section is searchable. Full statute text ships offline for the chapters the
lexicon covers; everything else shows citation, heading and chapter, and taps
through to the official source.

## Built with

- **React Native** + **Expo SDK 54**, TypeScript (strict)
- **Python 3**, standard library only. No pip install, no dependencies.
- No backend, no database, no API keys, nothing to pay for or keep running.

## Notable engineering details

The Nevada legislature publishes statutes as Microsoft Word HTML exports, which
turned out to be a genuine adversary:

- **They're encoded windows-1252, not UTF-8.** Decode them wrong and every
  pattern match silently returns zero, so the scraper reports success while
  producing empty results.
- **"NRS" is separated from the section number by an en space (U+2002)**, not a
  regular space. Searching for `NRS 484B.130` finds nothing.
- **Word writes unquoted HTML attributes** (`<a name=NRS484BSec003>`). A parser
  that expects quotes will read the table of contents perfectly and return 198
  completely empty statute bodies.
- **Statutes ship two versions when an amendment is pending**, labeled "Effective
  through June 30 2026" and "Effective July 1 2026," meaning opposite things. The
  parser compares real dates rather than pattern-matching, because treating them
  the same marks current law as expired.

Search ranking weights headings 10x over body text, so a tax provision that
happens to contain the word "bicycle" cannot outrank the actual bicycle statute.

## Running it

```bash
python3 data/scripts/build_index.py    # corpus -> shipped index
cd app && npx expo start               # scan the QR with Expo Go
```

Re-scraping the corpus is rarely needed; it's committed. If you do:

```bash
python3 data/scripts/scrape_nrs.py --all
```

Testing search without a phone:

```bash
python3 data/scripts/test_search.py              # full suite
python3 data/scripts/test_search.py "jetski"     # one query
```

## Layout

    plans/    blueprint, session log, critique log
    data/     corpus, concept lexicon, scraper + index builder + test harness
    app/      Expo app and the shipped index

## Accuracy

Every rule in this app traces to statute text we can link to. Not a blog post,
not a summary, not a chatbot. If we can't point at the line, it doesn't ship.

The app carries a permanent, non-dismissible disclaimer: it is not legal advice,
statute text is stamped with its capture date, and every result links to the
official source so anyone can check our work.

## Credits

Built by two high school students in Nevada.

Implementation is Claude-driven. We designed the architecture, built and verified
the legal data layer, and own the correctness of what the app tells people. The
concept lexicon, the accuracy testing, and every claim the app makes about Nevada
law are ours.

---

## Working on this

Both of us work on `main`. Pull first, always.

```bash
git pull
git add -A && git commit -m "what changed"
git push
```

Commit messages say what changed, not "update":

    data: add vape concept, chapter 202 verified
    app: result screen renders effective-date flag

End every session with a couple of lines in `plans/log.md`: what you finished,
what you were mid-way through, what's blocking. We go days between sessions.

`plans/blueprint.md` is the source of truth for what's built and what's next.
Read it before starting.
