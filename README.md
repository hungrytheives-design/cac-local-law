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

DATA owns everything in `data/` except `types.ts`.
APP owns everything in `app/`.

`data/types.ts` is shared and **frozen**. Changing it breaks the other person's
work in progress. If it truly has to change, message the other person first and
do it together. This is the only file you can realistically conflict on.

Because ownership is by directory, you two should almost never hit a merge
conflict. That is deliberate. If you are getting conflicts, someone is working
outside their lane.

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
