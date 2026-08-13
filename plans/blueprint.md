# Blueprint: nvlaw, Nevada law lookup

**Objective:** A phone app where you type a plain-language plan and get back the
Nevada statutes that apply, each one cited and linked to the real text.

**Competition:** 2026 Congressional App Challenge
**Hard deadline:** Oct 26, 2026, 12:00 pm ET = **9:00 am Pacific**
**Target submission date:** Oct 24 (two days of buffer, deliberately)
**Team:** 2 people, Cade + 1
**Repo:** https://github.com/hungrytheives-design/cac-local-law (public)

> Rewritten Aug 13 2026. The previous version of this document described a
> hand-curated 8-activity app. That plan was abandoned. Everything below reflects
> what is actually built.

---

## The architecture, in one paragraph

We do not curate answers. We curate **vocabulary**. The entire Nevada Revised
Statutes corpus is scraped at build time, indexed, and shipped inside the app. At
runtime the app does keyword matching over that fixed index, offline, with no
network call and no generative model anywhere in the path. The bridge between how
people talk and how statutes are written is a **concept lexicon**: a hand-verified
map from colloquial words ("dirtbike") to statutory terms ("off-highway vehicle")
and the chapters they live in.

**Why this beats the old plan:** the old app could answer 8 questions. This one
can surface a relevant statute for almost anything in Nevada law, and it still
structurally cannot invent a law, because there is no generative step at runtime.

---

## What is actually built, as of Aug 13

| Piece | State | File |
|---|---|---|
| NRS scraper | **Done** | `data/scripts/scrape_nrs.py` |
| Full corpus, 835 chapters / 49,742 sections | **Done** | `data/corpus/nrs-*.json` |
| Index builder + size triage | **Done** | `data/scripts/build_index.py` |
| Shipped index, 16.1 MB | **Done** | `app/assets/nrs-index.json` |
| Concept lexicon, 20 entries | **Seeded, unverified** | `data/concepts.json` |
| Search screen + ranking | **Done** | `app/App.tsx` |
| Statute detail screen | Not started | |
| About screen | Not started | |
| Accuracy measurement | Not started | |
| Video + submission | Not started | |

### The numbers that matter

- **49,742 sections, all searchable.** Not a subset. The whole code.
- **293 sections carry full offline text.** Everything else shows citation,
  heading and chapter, and taps through to leg.state.nv.us.
- **16.1 MB** shipped index, down from 68 MB before triage.
- **20 concepts** in the lexicon, of which **8 have verified chapters** and 12 are
  still empty.

That last line is the single most important number in this document. See P5.

---

## How the pieces fit

```
leg.state.nv.us
      │
      │  scrape_nrs.py        (build time, run rarely)
      ▼
data/corpus/nrs-*.json        835 files, committed
      │
      │  build_index.py       (build time, run on every lexicon change)
      ▼
app/assets/nrs-index.json     16.1 MB, shipped in the bundle
      │
      │  App.tsx              (runtime, offline, no AI)
      ▼
     phone
```

**The one coupling worth understanding:** `build_index.py` reads
`data/concepts.json` to decide which chapters get full offline text. So when you
add a verified chapter to the lexicon, you are simultaneously teaching the app a
new word *and* expanding what it can show without internet. Research work directly
grows the product. That is the nicest property this design has, and it is worth
saying out loud in the video.

---

## Ownership

Split by **kind of work**, not by directory, because both of us touch everything.

**Ours:**
- Reading statutes and verifying the concept lexicon (P5, the big one)
- QA sampling and producing a real accuracy number
- The curated hero tier
- Product decisions and scope
- Demo video and submission writeup
- Being able to explain how the whole thing works

**Claude-driven:**
- The scraper, the index builder, the app code

The submission form asks about AI usage. Answer it plainly: Claude Code wrote the
implementation, we designed the system, verified the legal data, and built the
submission.

---

## Phases

P0 through P4 are done. Do not redo them. Start at P5.

### P0 — Setup ✅ done
Expo SDK 54 (pinned, see risk register), TypeScript strict, repo live.

### P1 — Schema ✅ done
`data/types.ts`. `StatuteSection` is the corpus record; `ConceptEntry` is the
lexicon record. `Activity` / `Rule` remain for the curated tier in P7.

### P2 — Corpus acquisition ✅ done
Full crawl, 1s delay, cached to `data/raw-html/` (gitignored). Three parsing bugs
were found and fixed here; they are documented in `plans/log.md` and in the
scraper's module docstring. Read that docstring before touching the scraper.

### P3 — Index build ✅ done
Every section searchable, full text only for lexicon-referenced chapters. Chapter
titles deduplicated into a lookup table.

### P4 — Search screen ✅ done
Ranking weights: heading match 10, keyword prefix 6, chapter title 2, body 1;
lexicon phrase in heading 8, in body 2; chapter hint +8; repealed −20; not yet in
force −15. Top 40 results. Non-dismissible disclaimer bar.

---

### P5 — Lexicon verification and expansion 🔴 next, and it is the priority

**Owner:** both, human work, cannot be delegated to Claude
**Estimate:** 10-14 hours
**Why it matters most:** the lexicon is the only thing standing between "type
dirtbike, get the OHV statute" and "type dirtbike, get nothing." Twelve of twenty
entries currently have no chapter, which means those twelve concepts get no chapter
boost and no offline text.

**Method, per concept:**
1. Open `data/concepts.json`, pick an entry with `"chapters": []`.
2. Search leg.state.nv.us for the statutory term you think applies.
3. Read enough of the chapter to confirm it actually governs the thing.
4. Fix `statutory` to match the words the statute really uses. The seeded values
   are guesses. "Employment of minors" may not be the phrase NRS uses.
5. Add the chapter number to `chapters`.
6. Re-run `python3 data/scripts/build_index.py`.
7. Re-run `python3 data/scripts/test_search.py` and confirm the TODO flipped to
   PASS. Set `expectChapter` for that case in `data/search-tests.json`.

**The test harness is how you work this phase.** `test_search.py` runs 21 real
queries and reports PASS / FAIL / TODO. The 11 TODOs *are* this phase's worklist,
written as failing tests. When the suite is all PASS with zero TODO, P5 is done.
No phone required, and it takes about two seconds.

```bash
python3 data/scripts/test_search.py            # the suite
python3 data/scripts/test_search.py "vaping"   # try one query, see why it fails
```

**Do these first** (highest-traffic, most demo-relevant): `driving-teen`,
`minor-work`, `curfew`, `vape`, `alcohol`.

**Two leads already visible from the harness output:** `vape` queries surface
NRS 202.2493 (chapter **202**) and `driving-teen` queries surface NRS 483.255
(chapter **483**). Confirm both by reading the chapters, do not just paste them in.
`tattoo` returns zero results, which suggests it is county-regulated, not state.

**Also extend the list.** Twenty concepts is thin. Every concept you add is a
question the app can answer that it currently cannot.

**Exit criteria**
- Zero entries with empty `chapters`
- Every `statutory` term confirmed to appear in real NRS text
- 30+ concepts total
- For each concept, the colloquial word returns a correct statute in the top 3

---

### P6 — Accuracy measurement and QA 🔴

**Owner:** both | **Estimate:** 5 hours

You need a real number to say in the video. "It searches all of Nevada law" is a
claim; "we sampled 50 sections and 48 parsed correctly" is evidence.

**Tasks**
1. Sample 50 random sections from the index. Open each `sourceUrl`. Confirm the
   heading and text match the live page. Record the hit rate.
2. **Resolve the dual-version problem.** Some statutes ship two versions when an
   amendment is pending ("Effective through X" / "Effective X"). They appear to
   share one HTML anchor, so we may only be capturing one body. 484B had zero
   duplicate citations, which is suspicious rather than reassuring. Check a
   chapter with known pending amendments and find out what we are actually doing.
3. Write 25 realistic questions, run them, record how many surface a correct
   statute in the top 3. That is the headline accuracy number.
4. Log all three results in `plans/log.md` with the date.

**Exit criteria:** a written accuracy number you can defend out loud.

---

### P7 — Curated hero tier 🔴

**Owner:** both | **Estimate:** 6 hours

Pick **4** activities and hand-write plain-language rules with citations, using
the `Activity` / `Rule` types already in `data/types.ts`.

Suggested: **e-bike** (no license needed, contradicts what everyone assumes),
**OHV** (registration *is* required, great contrast), **learner's permit**
(high stakes, specific rules), **boating on Lake Mead**.

This tier does two jobs. It gives the demo a polished path, and it doubles as the
accuracy benchmark: if full-corpus search does not surface the same statutes you
found by hand, search has a bug.

---

### P8 — App completion and polish 🔴

**Owner:** both | **Estimate:** 8 hours

1. **Statute detail screen.** Right now every result opens the browser. Sections
   with offline text should open in-app, with the tap-out as a secondary action.
2. **About screen.** What this is, who built it, where the data came from, when it
   was captured, the full disclaimer, and the "no AI at runtime" explanation.
3. App icon and splash screen.
4. Contrast check in bright sunlight. Half your users are outdoors.
5. Screen reader labels on every control.
6. Confirm airplane mode: everything works except the tap-out links.

---

### P9 — Video and submission 🔴

**Owner:** both | **Estimate:** 8 hours | **Start no later than Oct 12**

**Script first, record second.** Suggested arc:
- 0:00-0:20 The problem. You are 15, you got an e-bike, googling gives you ten
  contradictory blog posts and none of them cite anything.
- 0:20-1:00 Demo. Type "dirtbike." Land on a real statute with a real citation.
- 1:00-1:30 The contrast: e-bike needs no registration, OHV does. Same app, and
  both answers are cited.
- 1:30-2:10 **The technical story, which is your differentiator.** All 49,742
  sections of Nevada law are in the app. It works in airplane mode. There is no AI
  at search time, so it cannot invent a law. Show airplane mode on camera.
- 2:10-2:40 The lexicon. Nobody types "off-highway vehicle." We built the bridge
  by hand from real statute text.
- 2:40-3:00 Civics angle: why a young person knowing which laws apply to them
  matters.

Both team members speak. Video under 3 minutes. Test the link in an incognito
window. **Submit Oct 24.**

---

## Schedule

About 10 weeks from today to Oct 24. Roughly 41 hours of work left.

| Weeks | Focus |
|---|---|
| Aug 13 - Sep 7 | P5 lexicon. The long pole. Chip at it every session. |
| Sep 8 - Sep 21 | P6 accuracy + P7 hero tier |
| Sep 22 - Oct 11 | P8 polish |
| Oct 12 - Oct 24 | P9 video and submission. Does not compress. |

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Lexicon verification never happens | **High** | It is the only human-gated task left and everything demo-worthy depends on it. Do 2 concepts per session minimum. |
| Dual-version statutes are being captured wrong | **Medium-high** | P6 task 2. This is the worst possible bug: showing superseded law as current. |
| 16.1 MB index makes Expo Go slow to load | Medium | Measure on a real phone early. If bad, drop `t` text for the least-used chapters. |
| Expo Go App Store version lags project SDK | **Hit already** | Pinned to SDK 54. Never run `expo install expo@latest` or `npx expo upgrade`. |
| leg.state.nv.us changes their HTML | Low | Corpus is committed, so the app keeps working. Only a re-scrape would break. |
| Statute text is wrong and someone relies on it | Medium | Non-dismissible disclaimer, every result links to the real source, capture date stamped in-app. |
| Video left to the last week | Medium | Hard start Oct 12. |
| One team member goes quiet | Medium | Every phase has a context brief so the other can pick it up cold. |

---

## Gotchas that will waste your day if you forget them

These are all real bugs we already hit. They are in the code comments too.

1. NRS pages are **windows-1252**, not UTF-8. Read them as UTF-8 and every regex
   silently matches zero, so the scraper reports success with empty results.
2. Nevada separates "NRS" from the section number with an **en space (U+2002)**.
   Searching for "NRS 484B.130" finds nothing.
3. Word writes **unquoted HTML attributes** (`<a name=NRS484BSec003>`). A regex
   requiring quotes parsed the table of contents perfectly and returned 198
   completely empty statute bodies.
4. Effective dates must be **compared, not pattern-matched**. "Effective through
   June 30 2026" means in force *until*; "Effective July 1 2026" means in force
   *from*. Treating them the same marked 34 current statutes as not-current.
5. Lexicon phrases must stay **whole**. Splitting "off-highway vehicle" into words
   matched 4,922 sections including "Use of may, must, shall."

---

## Weekly cadence

Start: `/ecc:resume-session` · End: `/ecc:save-session`

You have days between sessions. That pair is what stops you spending the first 30
minutes remembering where you were.

Before the video and before submitting, run `/cac-critique`.

---

## Stretch list, in priority order

Only after P9 is submission-ready.

1. **The civics feature.** For 3 statutes, hand-build the history: which NV bill
   created it, who sponsored it, how your district's legislators voted. For a
   *congressional* competition this is the single most memorable thing you could
   add.
2. Clark County / Las Vegas municipal ordinances alongside state law.
3. Saved and recent searches.
4. Build-time plain-language summaries per section (AI at build time only, never
   at runtime, and the generated text ships next to the verbatim text rather than
   replacing it).

Item 1 is worth more than 2, 3 and 4 combined. If you find spare hours in October,
spend them there.
