# AI usage disclosure

The 2026 Congressional App Challenge rules permit AI tools **provided all AI usage
is fully disclosed**, that AI does **not constitute the entirety** of the technical
development, and that participants demonstrate **significant individual
contributions and technical understanding**.

Keep this file current as you work. Do not try to reconstruct it in October. An
accurate, specific disclosure is a strength. A vague one written from memory the
night before submission looks like exactly what the rule is guarding against.

## Tool used

Claude Code (Anthropic), used as a pair-programming assistant throughout.

## Written primarily by AI, reviewed by us

| Thing | File |
|---|---|
| NRS scraper and HTML parser | `data/scripts/scrape_nrs.py` |
| Index builder and triage heuristic | `data/scripts/build_index.py` |
| App UI and search ranking | `app/App.tsx` |

## Written or owned by us

Fill this in as you go. This section is the one the rule actually cares about.

| Thing | Who | Notes |
|---|---|---|
| Concept lexicon (`data/concepts.json`) | | Seeded with 20 entries by AI; every `statutory` term and `chapters` value needs human verification against real NRS text, and the list needs extending |
| Statute verification / QA sampling | | Sample sections, check the parse against the live page, record a real accuracy number |
| Curated hero activities | | Hand-read statutes, plain-language rules with citations |
| Product decisions | Cade | Scope, the pivot from 8 activities to full-corpus, dropping Conrad |
| Demo video | | |

## Technical understanding: be able to explain these out loud

If a judge asks how it works, these are the answers. Do not memorize them, follow
the code until they make sense.

1. **Why the scraper decodes windows-1252 first.** The NRS pages are Microsoft
   Word HTML exports. If you read them as UTF-8, every pattern match silently
   returns zero and you get a scraper that reports success with empty results.
2. **Why Nevada's en-space broke the first parse.** They separate "NRS" from the
   section number with U+2002, not a normal space, so searching for "NRS 484B.130"
   finds nothing.
3. **Why unquoted HTML attributes mattered.** Word writes `<a name=NRS484BSec003>`
   with no quotes. A regex requiring quotes parsed the table of contents perfectly
   while returning 198 completely empty statute bodies.
4. **Why effective dates are compared, not pattern-matched.** "Effective through
   June 30 2026" means in force until that date; "Effective July 1 2026" means in
   force from it. Treating both the same marked 34 current statutes as not-current.
5. **Why search ranking weights headings 10x over body text.** Otherwise a tax
   provision that happens to contain the word "bicycle" outranks the actual
   bicycle statute.
6. **Why the index carries full text for some sections and not others.** Full text
   for all of NRS is far too large to ship in the app. Every section stays
   searchable; only the payload varies.
7. **Why no AI runs when you search.** Everything is built ahead of time and
   shipped. The app does keyword matching over a fixed index, offline. It cannot
   invent a law because it has no generative step at runtime.
