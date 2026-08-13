# Session log

Append after every session. Newest at the bottom.

Format:
## YYYY-MM-DD — who
- did:
- in progress:
- blocked on:

## 2026-08-12 — Cade
- did: ran setup-repo.sh, scaffolded Expo app into `app/`, got starter screen on
  phone via Expo Go
- setup gotchas, so nobody rediscovers them:
  - run commands from `nvlaw/app`, not from `~` and not from `CAC26`
  - `npm run ios` is the wrong command. It needs Xcode and only tests on a Mac.
    Use `npx expo start`, scan the QR with the Camera app, TAP the banner that
    slides down. Phone and laptop must be on the same Wi-Fi band.
  - `create-expo-app` scaffolds SDK 57; App Store Expo Go only supports SDK 54.
    Project is pinned to 54. Do not upgrade it.
  - We are NOT using EAS / cloud builds. Collaboration is git. See blueprint.
- in progress: Phase 0
- blocked on: CAC registration + confirming the district is hosting. GitHub push.

## 2026-08-12 (later) — Cade + Claude
- decided: PIVOT. Dropping the "8 hand-curated activities" cap. New architecture is
  full-corpus: scrape all of NRS, build a plain-language + keyword index at BUILD
  time, ship it, and search it offline at runtime. Curated tier shrinks to ~4 hero
  activities that double as the accuracy benchmark. Rationale and design are in the
  chat transcript; blueprint.md has NOT been rewritten yet.
- fixed:
  - `nv-lawlookup-blueprint.md` at CAC26 root had gone stale (missing 3 risk rows).
    Stubbed it to point at `plans/blueprint.md`. Do not make a second copy again.
  - `app/AGENTS.md` said to read Expo **v57** docs. Project is pinned to **SDK 54**.
    That would have broken Expo Go. Now says 54 with an explicit do-not-upgrade list.
  - **A git repo was rooted at `/Users/cadesylvain` (the whole home directory).**
    No commits, no remote, 639M. Combined with the README's `git add -A`, that could
    have pushed Library/, .zsh_history and .claude.json to GitHub. The real repo is
    `nvlaw/` (commit 7759ac2, made by setup-repo.sh). REMAINING ACTION: delete the
    stray home repo with `rm -rf ~/.git`. Nothing is lost, it has zero commits.
  - Hardened `nvlaw/.gitignore`: added ios/, android/, *.pem, .env.*, editor dirs,
    and data/raw-html/.
- corpus spike findings (these change how the scraper must be written):
  - NRS chapter pages are **Microsoft Word export HTML in windows-1252**, CRLF line
    endings. You MUST decode 1252 to UTF-8 first or every regex silently matches zero.
  - Section numbers contain Word line-wraps, e.g. `NRS\n484B.130`. Normalize all
    whitespace including nbsp (0xA0) before matching.
  - NRS 484B parsed cleanly to **53 unique sections**. At ~400-450 chapters that
    projects to roughly 20,000-24,000 sections statewide.
  - **68 effective-date variant markers in that one chapter.** Dual-version sections
    ("Effective through X" / "Effective X") are common, not an edge case. Shipping the
    wrong version as live law is the top correctness risk. Handle explicitly.
  - No bulk download or API exists. Scraping is the only path. Rate-limit politely.
- blocked on (unchanged, all human): CAC registration + district confirmation,
  Conrad Challenge registration (deadline Oct 30), GitHub remote + add teammate,
  and deciding who is DATA and who is APP.
