# nvlaw

Nevada activity-law lookup app. 2026 Congressional App Challenge.

Type what you want to do, get the Nevada rules that apply, each cited to a statute.

**Deadline: Oct 26 2026, 9:00 am Pacific. We submit Oct 24.**

The plan lives in `plans/`. Read it before you start a session.

## Layout

    plans/    the blueprint, session log
    data/     activities.json, types.ts   <- DATA owns
    app/      Expo app                    <- APP owns

## Who owns what

Neither of us writes code by hand. We drive Claude Code. So splitting the work
into "DATA person" and "APP person" does not describe reality. We split by the
kind of work instead:

**Human work. Claude cannot do this for us and it is what makes the project
credible:**

- Reading actual statute text and confirming a rule really says what we claim
- Building the concept lexicon (`data/concepts.json`): the plain-English to
  legal-English bridge, e.g. "dirtbike" maps to "off-highway vehicle"
- QA sampling the generated plain-language layer and recording a real accuracy number
- Being able to explain how the app works, out loud, without notes
- The demo video

**Claude-driven work:**

- The NRS scraper and parser
- The search index and ranking
- The Expo app itself

Either of us can drive either side. Just say in `plans/log.md` what you touched
so we do not both rewrite the same file on the same night.

`data/types.ts` is shared. Changing it can break the other person's work in
progress, so say so in the log when you do. It is the one file we can
realistically conflict on.

## Working separately

Both of us work on `main`. Branches would be overhead we do not need at this size.

Every session, in this order:

    git pull                # ALWAYS first. Do not skip this.
    ... do your work ...
    git add -A
    git commit -m "what you did"
    git push

If `git pull` complains about divergent branches:

    git pull --rebase

If push is rejected, you forgot to pull. Pull, then push.

## Commit messages

Say what changed, not "update". Examples:

    data: add ebike rules, 6 cited
    app: result screen renders rules grouped by jurisdiction
    data: mark curfew rule ambiguous, statute unclear on 17yos

## End of every session

Append a couple of lines to `plans/log.md`: what you finished, what you were in
the middle of, what is blocking you. We go days between sessions and neither of
us will remember otherwise. This is the cheapest thing in the whole project and
it will save hours.

## Hard rule

No rule goes into `data/activities.json` unless you read the actual statute text
and can link to it. Not a blog post, not memory, not a chatbot. The whole
credibility of this project is that every answer cites something real.
