---
name: cac-critique
description: Critique this Congressional App Challenge project and score how likely it is to win its district. Use whenever someone says "critique the project," "score it," "how are we doing," "are we going to win," "grade this," or "reality check this" - and proactively at the end of any session that finished a phase, before recording the demo video, and before submitting. Adapts to whatever exists so far (plan only, half-built app, or finished submission), runs a disqualification check against the official 2026 rules, scores seven weighted dimensions 1-5 with concrete evidence, and names the three highest-leverage fixes. Re-runnable: appends to plans/critique-log.md so the trajectory is visible.
---

# CAC Critique

Score this project honestly and say what to do next.

This exists because the project's stated risk is not "the app is too hard." It is
spending eleven weeks on a nice shell and submitting with three activities because
the statute research never got done. A critique that says "great progress!" every
time is worse than useless - it burns the one instrument that could catch that.

## What the score is calibrated against

Researched from the official 2026 rules and the published judging rubric, not
guesses. These explain why the weights are shaped the way they are. Re-verify if
the competition year changes.

**Judging is per congressional district, by the Member of Congress and their office.**
Not a national panel, and usually not software engineers. Field size is district-
dependent and often small. Finishing and polish beat brilliance. 2025 district
winners included both an AI wildfire platform and an ordinary Kanban task app -
that spread is the whole calibration.

**Official criteria are three things:** quality of the idea (creativity, originality),
implementation of the idea (user experience, design), and demonstrated excellence of
coding skills.

**The published sample rubric scores each 1-5, and "Skill" is scored mechanically:**
1 for block code only, 3 for block code with some text-based code mixed in, 4 for one
text-based language, **5 for multiple text-based programming languages.** This is the
cheapest point in the competition. A TypeScript-only React Native app caps at 4.
Adding a real second text-based language - for example a Python script that validates
the dataset against the schema and checks that every `sourceUrl` resolves - is roughly
an hour, is genuinely useful, and moves a rubric line. This rubric is published as a
*sample*; offices may modify it. Best available signal, not a guarantee.

**Judges primarily see the video and the written answers.** They *may* request the app
and source code, and refusing is disqualifying, but the default artifact set is a 1-3
minute video plus six short answers. That asymmetry is why video quality is weighted
near completeness, and why a beautiful app with a rushed video loses to a plain app
with a sharp one.

**The six submission questions are published in advance.** Score drafts if they exist;
flag their absence after early October.

1. Title of your app
2. Explain the app's purpose
3. What inspired you to create this app
4. What technical/coding difficulty did you face, and how did you address it
5. What did you learn, what was your biggest takeaway
6. What would you change in a 2.0 version

**Civic relevance is not a rubric line.** It is an audience-fit bet: the judge is a
congressional office, and an app about which laws apply to you reads directly to that
audience. Weighted 10, not higher, because it is a tiebreaker rather than a scored
criterion. If a future run wants to argue it should be heavier, make that argument out
loud rather than silently reweighting.

## Step 0 - Take inventory before scoring anything

Do not assume file paths. Documented paths drift from real ones. Search for what is
actually there:

- List the project folder recursively. Note what exists and what does not.
- Read any blueprint, plan, handoff, or log file found (`plans/`).
- Count real activity records and, separately, count rules carrying both a citation
  and a resolving `sourceUrl`. These two numbers are the spine of the whole critique.
- Check `git log` for commit count, recency, and whether both teammates have commits.
  A repo with one contributor is a risk finding.
- Check whether the app runs, or whether there is evidence someone ran it.
- Find any video script, recording, submission draft, or answers to the six questions.

Then state the phase in one line: what exists, what does not, and what week it is
relative to the October 26 deadline. Every score is relative to this inventory.

**If almost nothing exists yet, still score it.** A plan-only project can legitimately
score well on scope discipline and civic relevance and score 1 on completeness. That is
the correct shape of an early critique. Do not refuse to score, and do not soften
completeness because it is early - the number is supposed to start low and climb. That
climb is the instrument.

## Step 1 - Disqualification check, before scoring

Scoring is pointless if the submission is invalid. Report any item unmet or
unverifiable. From the official 2026 rules.

- **AI usage disclosed.** Permitted only if fully disclosed in the submission
  materials, and AI must not constitute the entirety of the technical development.
  This project is built with heavy AI assistance. If no disclosure is drafted, that is
  a finding every single run until it exists.
- **Open-source libraries documented.** Expo, React Native, and every dependency need
  naming somewhere in the submission.
- **Video is 1-3 minutes,** public on YouTube or Vimeo, containing all six required
  elements: every participant's name, the app name, the purpose in one clear sentence,
  the target audience, the tools and coding languages used, and a functionality
  showcase. Videos outside the window may be penalized at judge discretion. Target
  2:30, not 2:59.
- **Registration** complete, in a district that is hosting the Challenge, one entry per
  person, team of four or fewer with at least half in the same district.
- **Source code available on request.** Refusing a judge's request is immediate
  disqualification, so the repo must be shareable and runnable by someone else.
- **Submitted before 12:00 pm EDT October 26** (9:00 am Pacific). Cannot be modified
  after submission.

## Step 2 - Score seven dimensions

Each gets a 1-5, at least one piece of concrete evidence with a file path or specific
observation, and one line naming what would move it up exactly one point.

The "what moves this up one point" line is the most valuable output in the report. Make
it a specific action someone could do this week, not a restatement of the dimension.
"Improve the dataset" is useless. "Finish activities 6 and 3 so the OHV contrast in the
video works" is the job.

**Calibrate hard. A 3 is average - an ordinary, complete, unremarkable submission.**
Most work is a 3. Do not award a 4 because something exists and looks fine; a 4 means
noticeably better than the typical district submission. A 5 means a judge would
remember it. Awarding 4s and 5s early makes the score unable to move later, which
destroys the point of re-running this.

| # | Dimension | Weight | What it measures |
|---|---|---|---|
| 1 | Completeness | 25 | How close to a finished, submittable thing. Working end-to-end beats feature count. Counts finished activities with resolving citations, not planned ones. |
| 2 | Demo video quality | 20 | Script, clarity, the six required elements, pacing, whether the surprise lands. Before a script exists this is a 1, and that is correct. |
| 3 | Polish and UX | 15 | Maps to official "Design." Consistent color and type, real icon and splash, contrast, touch targets, no placeholder text, no console warnings. A stranger using it with no instructions. |
| 4 | Technical credibility | 15 | Maps to official "Skill." Count distinct text-based languages actually used. Also: does the architecture hold up if a judge asks a pointed question. |
| 5 | Correctness and honesty | 10 | Every rule traceable to statute text. Ambiguity marked rather than resolved by guessing. Disclaimer present and non-dismissible. Graceful failure - the no-match screen looks designed, not broken. |
| 6 | Civic relevance | 10 | How clearly this reads as a *congressional* app. The legislator-votes feature, if built, is the strongest version. |
| 7 | Scope discipline | 5 | Whether the frozen list stayed frozen, whether cut features stayed cut, whether stretch items are being touched before the core is done. Scope creep here is the documented failure mode. |

Weighted composite = sum of (score x weight) / 100.

## Step 3 - Convert to a likelihood band, not a percentage

Do not produce a number like "68% chance of winning." Field size is unknown and
district-dependent, so a percentage is false precision. Use bands:

| Composite | Band |
|---|---|
| Below 2.0 | Not submittable. Would not place. |
| 2.0 - 2.7 | Loses to any complete submission. |
| 2.7 - 3.4 | Competitive only in a small or weak field. |
| 3.4 - 4.2 | Likely winner in a typical district field. |
| Above 4.2 | Strong favorite. |

**Two hard caps, applied after the arithmetic.** These exist because the composite can
be gamed by a gorgeous unfinished thing, and unfinished things lose to boring complete
ones:

- If **Completeness is below 3**, cap the band at "Competitive only in a small or weak
  field" no matter what the other scores say.
- If there is **no finished video** within two weeks of the deadline, cap at "Loses to
  any complete submission." The video is the artifact judges actually watch.

State plainly when a cap is applied and which one.

Also give a one-line **on-pace verdict** - on pace / at risk / behind - comparing the
inventory against the calendar and the phase plan. Separate from the score. A project
can score 2.1 and be perfectly on pace in week three.

## Step 4 - Name the three highest-leverage fixes

Exactly three. Ranked. Each with the dimension it moves, a rough hour cost, and who
should do it if owners are known.

Pick for leverage, not score arithmetic. An hour that unblocks a blocked teammate beats
an hour that adds a fourth score to a dimension. Watch specifically for the known
blocking edge: the matcher phase cannot finish without three real activity records, so
if that delivery is slipping, it outranks almost anything else.

If a cheap mechanical point is available and unclaimed - the second text-based
language, the AI disclosure, the missing video elements - say so. Cheap points are
still points, and they are the least glamorous thing to notice, which is exactly why
they get missed.

## Step 5 - Log the score so the trajectory is visible

Append one row to `plans/critique-log.md`, creating it with a header row if absent. A
single score is nearly meaningless; the shape of the line over eleven weeks is the
signal. A flat or falling completeness score across two runs is a louder finding than
any individual number.

```
| Date | Phase | Complete | Video | Polish | Tech | Honesty | Civic | Scope | Composite | Band |
```

## Output format

```markdown
# CAC Critique - [date]

**Inventory:** [one paragraph: what exists, what doesn't, weeks to deadline]
**On pace:** [on pace / at risk / behind] - [one line why]

## Disqualification check
[Only unmet or unverifiable items. If all clear, say so in one line.]

## Scores

### 1. Completeness - X/5 (weight 25)
[Evidence, with file paths or specific observations]
**Up one point:** [specific action]

[...repeat for all seven...]

## Composite: X.X - [band]
[Note any cap applied and why]

## Do these three things next
1. **[Action]** - moves [dimension], ~Xh, [owner]
2. ...
3. ...

## What I'd push back on
[Anything in the current plan or build that looks wrong, over-scoped, or self-
deceiving. Omit only if there is genuinely nothing. There is usually something.]
```

## Tone

Direct. No flattery, no congratulation padding, no em dashes. If the honest read is
"this is behind and the dataset is the reason," open with that. A soft critique of a
project whose main risk is quiet under-delivery is an actively harmful output.

Being harsh is not the goal either - inflated pessimism is as uncalibrated as inflated
praise, and it makes the score useless in the other direction. Score what is actually
there, cite it, and say what to do about it.
