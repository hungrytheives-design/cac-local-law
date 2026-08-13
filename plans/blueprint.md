# Blueprint: Nevada activity-law lookup app

**Objective:** Ship a React Native app where a user types a plain-language plan and gets back the Nevada rules that apply, each cited to a statute.

**Competition:** 2026 Congressional App Challenge
**Hard deadline:** Oct 26, 2026, 12:00 pm ET = **9:00 am Pacific**
**Last usable work session:** Oct 25
**Team:** 2 people. Referred to below as DATA and APP.
**Mode:** Direct mode (no git remote assumed). If you set up a GitHub repo, treat each phase as one PR.

---

## Scope verdict: 45 hours is not enough for the scope as written

Honest breakdown of the original scope:

| Phase | Original scope | Hours |
|---|---|---|
| Setup + scope freeze | | 7 |
| Dataset | 12 activities, 2 jurisdictions | 16 |
| App shell | Expo, nav, search, results | 10 |
| Query matching | LLM API integration | 6 |
| Polish | | 6 |
| Video + writeup | | 8 |
| **Total** | | **53** |

That is 53 against a floor budget of 45, with zero slack, on a project where neither of you has shipped a mobile app before. First-time Expo setup alone eats an unplanned evening roughly every time.

### What I cut, and why

**Cut 1: the LLM API call. Moved to stretch.**

This is the significant one, and it is a product improvement, not just a schedule concession. v1 matches queries with a local keyword and synonym table instead of a model call. Reasons:

- It structurally cannot hallucinate law. Not "instructed not to" - *cannot*. That is a much stronger claim to make to judges than a prompt-engineering promise.
- It works with no internet. Your demo video will not die on venue wifi.
- No API key to manage, no cost, no rate limit, no latency spinner.
- It is roughly 5 hours of work instead of 6+ plus debugging plus a secrets story.

The tradeoff is real: a local matcher handles "ebike vegas" and "can I ride my electric bike" fine, but not "me and my buddies wanna cruise around on those scooter things." Mitigate by writing a generous synonym list and making the no-match screen genuinely good (it should suggest the closest activities, not just shrug).

**Cut 2: 12 activities down to 8.**

The dataset is your longest pole and the one you will underestimate. Reading actual statute text and pulling out enforceable specifics is slow, roughly 90 minutes per activity per jurisdiction pair once you have a rhythm. Eight is enough to look substantial in a demo. Add more only in the slack you find.

**Cut 3: Washoe County drops to stretch.**

v1 covers Nevada state law plus Clark County / Las Vegas / Henderson. That is where the users are and where your team is. Statewide rules already apply everywhere, so the app is still useful in Reno; it just does not show Reno-specific ordinances.

### Revised budget

| Phase | Hours | Owner |
|---|---|---|
| P0 Setup and verification | 2 | Both |
| P1 Scope freeze and schema | 3 | Both |
| P2 Dataset build | 13 | DATA |
| P3 App shell | 9 | APP |
| P4 Matcher and no-match | 5 | APP |
| P5 Polish and disclaimer | 5 | Both |
| P6 Video and submission | 8 | Both |
| **Total** | **45** | |

Your actual available hours are 42 to 126 depending on whether you hit 2 or 6 hours each per week. This plan commits to the floor. Everything above 45 goes to the stretch list at the bottom, in order.

---

## Dependency graph

```
P0 ──> P1 ──┬──> P2 (DATA) ──┐
            │                 ├──> P5 ──> P6
            └──> P3 (APP) ────┤
                     └─> P4 ──┘
```

P2 and P3 run fully in parallel. This is the whole reason for the schema-first phase: once the record shape is frozen in P1, DATA can write records and APP can build against fake records without either waiting.

**The one blocking edge:** APP cannot finish P4 (matcher) without at least 3 real records from DATA to test against. DATA must deliver 3 finished records by end of week 4 or P4 slips. Put this on a calendar.

---

## Phase 0 — Setup and verification

**Owner:** Both | **Hours:** 2 | **Sessions:** 1

### Context brief
Nothing exists yet. Neither team member has run Expo before. This phase exists so that the first real build session does not get eaten by tooling.

### Tasks
1. Both: register at congressionalappchallenge.us, confirm your congressional district and that your district is participating. Confirm team-of-2 is permitted and read the video requirements.
2. Both: install Node LTS, then `npx create-expo-app@latest nvlaw --template blank-typescript`. Run it. Get "Hello World" onto both of your physical phones with Expo Go.
3. Create a shared folder (Drive, Dropbox, or a GitHub repo) with `plans/`, `data/`, `app/`.
4. Copy this blueprint into it.

### Exit criteria
- Both phones render the Expo starter screen
- CAC registration confirmed and video requirements written down in your own words
- Shared folder exists

### Verification
```bash
npx expo start
# scan QR on both phones, confirm hot reload works on both
```

**If this phase takes more than 3 hours, stop and say so.** Tooling pain here predicts tooling pain later, and you would want to know in week 1, not week 8.

---

## Phase 1 — Scope freeze and schema

**Owner:** Both | **Hours:** 3 | **Sessions:** 1

### Context brief
The single highest-risk failure mode for this project is unbounded content work. This phase ends with a frozen list you are not allowed to add to.

### Tasks

**1. Pick exactly 8 activities.** Criteria: a teenager or young adult in Las Vegas would plausibly do it, and Nevada actually regulates it in a findable way. Suggested starting list, swap freely:

| # | Activity | Why it works |
|---|---|---|
| 1 | Riding an e-bike | Hero example. Class system is genuinely confusing |
| 2 | Riding an electric scooter | Different rules from e-bikes, common confusion |
| 3 | Driving with a learner's permit | High-stakes, specific hour and passenger rules |
| 4 | Boating on Lake Mead | Your original adult example. Federal + state overlap |
| 5 | Getting a job under 18 | Work permits, hour limits |
| 6 | Off-road / OHV riding | Registration actually IS required, good contrast with e-bikes |
| 7 | Curfew in Clark County | Directly affects "going out," very local |
| 8 | Fishing | Licenses, age exemptions, easy to verify |

Note how #1 and #6 pair up: one needs no registration, one does. That contrast is a great 20 seconds of demo video.

**2. Freeze the record schema.** Both of you agree on this and do not change it after today:

```ts
type Rule = {
  id: string;
  text: string;              // one plain sentence, written for a 14-year-old
  citation: string;          // "NRS 484B.017" or "Clark County Code 12.04.110"
  sourceUrl: string;         // direct link to statute text
  jurisdiction: "NV" | "Clark" | "LasVegas" | "Henderson";
  appliesIf?: string;        // "you are under 18", "class 3 only"
  confidence: "clear" | "ambiguous";
};

type Activity = {
  id: string;
  displayName: string;
  keywords: string[];        // matcher input, be generous
  summary: string;           // one sentence shown at top of results
  rules: Rule[];
  lastVerified: string;      // ISO date, e.g. "2026-09-03"
};
```

**3. APP writes 2 fake activity records** conforming to this schema so P3 has something to render immediately.

### Exit criteria
- `data/activities.md` contains the frozen list of 8 with owner initials
- `app/types.ts` contains the schema above
- `data/fake-activities.json` has 2 dummy records
- Both of you have said out loud that the list is frozen

---

## Phase 2 — Dataset build

**Owner:** DATA | **Hours:** 13 | **Sessions:** 4-6

### Context brief
You are writing the actual content of the app. Every rule must come from reading primary source text, not from a blog post and not from memory. This is the phase that makes the project credible.

### Method, per activity
1. Find the governing NRS chapter at leg.state.nv.us. For local rules, use the Clark County and Las Vegas municipal code sites.
2. Read the statute text. Actually read it.
3. Extract 3-6 rules a normal person would care about. Skip definitional and procedural sections.
4. Write each rule as one plain sentence. Target reading level: 8th grade.
5. Record the exact citation and a working direct URL.
6. If the statute is genuinely unclear about a common case, mark `confidence: "ambiguous"` and say so in the rule text. Do not resolve ambiguity by guessing.
7. Stamp `lastVerified` in ISO format.

### Verified starter content for activity #1

Preliminary research found the following for Nevada e-bikes. **Treat this as a lead, not as sourced content** - it came from secondary sources, so confirm each line against the NRS text before it goes in the app:

- Nevada adopted the 3-class e-bike system via SB 383 (2021)
- Class 1: pedal-assist, motor cuts at 20 mph
- Class 2: throttle, motor cuts at 20 mph
- Class 3: pedal-assist, motor cuts at 28 mph
- No driver's license required
- No registration or license plates required
- No insurance required
- No statewide adult helmet requirement
- Riders under 18 on a Class 3 must wear a helmet
- Clark County, Las Vegas, Henderson, and Boulder City have their own minor helmet rules; Henderson and Boulder City extend theirs to regular bicycles

This is a good hero example precisely because it contradicts what people assume. Your demo can open with "everyone thinks you need a license. You don't. Here's what you actually need."

### Pacing
Roughly 90 minutes per activity. Do them in this order so that if you run out of time, the ones you finished are the ones the demo needs: 1, 6, 3, 7, 2, 4, 8, 5.

### Exit criteria
- 8 activities in `data/activities.json`, schema-valid
- Every rule has a citation and a URL that resolves
- Zero rules that DATA cannot point to a line of statute for
- 3 activities delivered to APP by **end of week 4** (this unblocks P4)

### Verification
Open every `sourceUrl`. Any 404 means that rule is not done.

---

## Phase 3 — App shell

**Owner:** APP | **Hours:** 9 | **Sessions:** 3-4

### Context brief
Build the whole app against `fake-activities.json` from P1. Do not wait for real data. The schema is frozen, so anything you build against fakes will work against real records.

### Tasks
1. Expo Router with three routes: `/` (search), `/result/[id]`, `/about`
2. Search screen: one text input, a "what can I ask?" hint, and 4 example chips users can tap
3. Result screen: activity name, one-line summary, rules grouped by jurisdiction, each rule showing its citation as a tappable link
4. Ambiguous rules render visually distinct with a "the law isn't clear here" marker
5. Persistent disclaimer bar, always visible on the result screen, not dismissible
6. About screen: what this is, who built it, where the data came from, the full disclaimer

### Exit criteria
- Runs on both phones via Expo Go
- Can search a fake activity and see its rules
- Citation links open in the system browser
- Disclaimer is visible on every result screen without scrolling

### Verification
```bash
npx expo start
# on device: search -> result -> tap citation -> browser opens correct statute
```

---

## Phase 4 — Matcher and no-match

**Owner:** APP | **Hours:** 5 | **Sessions:** 2
**Blocked by:** 3 real records from P2

### Context brief
Turn free text into an activity id. Local only. No network call. This is the phase where the "cannot hallucinate" property is established, so keep it dumb on purpose.

### Tasks
1. Normalize input: lowercase, strip punctuation, split to tokens
2. Score each activity by keyword overlap. Weight exact `displayName` matches highest
3. Return the top match if score clears a threshold, otherwise no-match
4. Build the keyword lists out generously. For e-bike: `ebike, e-bike, electric bike, electric bicycle, bike with a motor, motorized bike, ride around, cruise`
5. **No-match screen is a real feature, not an error state.** It should say what the app does cover, list all 8 activities as tappable, and invite the user to try different words. A judge will absolutely type something you did not plan for. Make that moment look intentional.
6. Write a plain test file with 20 phrasings mapped to expected ids. Include 3 that should return no-match.

### Exit criteria
- 20/20 test phrasings resolve correctly
- No-match screen looks designed, not broken
- No network request anywhere in the matcher path

### Verification
Turn the phone to airplane mode. Every feature except citation links still works.

---

## Phase 5 — Polish

**Owner:** Both | **Hours:** 5 | **Sessions:** 2

### Context brief
Judges score how it looks. Two hours here moves the needle more than two more activities.

### Tasks
1. Pick one accent color and one font. Apply consistently. Resist adding a third.
2. Real app icon and splash screen
3. Every text element passes contrast. Test in bright sunlight, since half your users are outdoors
4. Screen reader labels on the search input and all buttons
5. Every touch target at least 44pt
6. Fix the loading flash on result screen
7. Final read-through of all 8 activities on the phone, checking for typos and confusing phrasing

### Exit criteria
- A stranger can use it with no instructions
- No lorem ipsum, no placeholder text, no console warnings
- Both team members have used it end-to-end on their own phone without hitting a rough edge

---

## Phase 6 — Video and submission

**Owner:** Both | **Hours:** 8 | **Sessions:** 3
**Start no later than Oct 12.** This phase does not compress.

### Context brief
The video is a graded artifact. Teams routinely code until the deadline and submit a rushed one. You are not doing that.

### Tasks
1. **Script first, record second.** Write it out. Roughly:
   - 0:00-0:20 The problem. You are 15, you got an e-bike, you have no idea what the rules are, and googling gives you ten contradictory blog posts
   - 0:20-1:10 Demo the e-bike query. Land on the surprise: no license, no plates. Then show a rule that *does* bite, the under-18 Class 3 helmet rule
   - 1:10-1:40 Show the OHV query for contrast: this one DOES need registration
   - 1:40-2:10 Show the citations. Every answer links to actual statute. Explain that the data is hand-curated and the app cannot invent law
   - 2:10-2:40 The civics angle, even if you did not build the voting feature. Talk about why a young person knowing which laws apply to them matters
   - 2:40-3:00 What you learned, what you would build next
2. Screen record on device. Re-record until it is clean. Budget 3 takes minimum.
3. Both team members speak in the video.
4. Write the submission text: what it does, how you built it, what was hard.
5. **Submit by Oct 24.** Two days of buffer, not zero. The deadline is 9am Pacific on the 26th, which means a Sunday-night crunch is not available to you.

### Exit criteria
- Video under 3 minutes, uploaded, link works in an incognito window
- Submission form complete
- Confirmation email received

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Dataset takes longer than 13h | High | Ship with 5-6 activities rather than cutting polish or video |
| Expo setup eats week 1 | Medium | P0 has a hard 3h tripwire; ask for help immediately if hit |
| DATA slips past week 4, blocking P4 | Medium | APP keeps building against fakes; matcher works on fakes too |
| One team member goes quiet | Medium | Every phase has a named owner; the other can pick up any phase from its context brief |
| A rule turns out to be wrong | Medium | `confidence: "ambiguous"` exists for this; when unsure, say so in-app |
| Deadline is 9am PT, not end of day | **Confirmed** | Submit Oct 24 |
| Expo Go App Store version lags the project SDK | **Hit in P0** | Project pinned to SDK 54 to match Expo Go. Do not run `expo install expo@latest` |
| Demo device runs an iOS developer beta | Medium | Record the video on the non-beta phone. Stop taking beta updates Oct 1 through submission |
| Solo stretch: one person doing both DATA and APP | Medium | Parallelism assumption breaks; 45h becomes 45h of one person's time. Re-cut scope if this persists past week 3 |

---

## Weekly cadence

Start every session:
```
/ecc:resume-session
```

End every session, without exception:
```
/ecc:save-session
```

You have days of gap between sessions. The save/resume pair is what keeps you from spending your first 30 minutes each week remembering where you were. Skipping it costs you roughly 5 hours over the project.

---

## Stretch list, in priority order

Only touch these once P6 is done and submitted-ready.

1. **Washoe County / Reno rules** for the existing 8 activities
2. **Activities 9-12**
3. **LLM query matching** as a fallback when the local matcher returns no-match. Note the architecture: local first, model only on miss, and the model still only selects from existing records. Never generates rules
4. **The civics feature.** For 2-3 of your activities, hand-build the bill history: which NV bill created this rule, who sponsored it, how your district's legislators voted. Even three of these is a strong differentiator for a congressional competition
5. Saved / recent searches

Item 4 is the one that makes this memorable to a congressional office. If you find yourself with 15 spare hours in October, spend them there rather than on activities 9-12.

---

## Notes on what was cut and when to revisit

The LLM matcher was cut for schedule and for safety. If you get it back in as a stretch, keep the local matcher as the primary path. "AI narrows to a record we already verified" is a defensible design. "AI answers legal questions" is not, and the difference will matter if a judge asks a pointed question.
