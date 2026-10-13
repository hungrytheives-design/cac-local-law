// Optional plain-English layer.
//
// WHAT THIS DOES AND DOES NOT DO
// ------------------------------
// It does NOT decide which law applies. Retrieval stays local, deterministic
// and offline: the app finds the statutes by itself, exactly as before. This
// only takes statute text the app has ALREADY found and rewrites it in plain
// English, and it is told in the strongest terms to use nothing else.
//
// That containment is the whole point. A model asked "what is the law about X"
// can invent a statute. A model handed one and asked "say this simply" can only
// misread text the reader can see for themselves, printed directly underneath.
//
// If there is no API key, no network, or the daily quota is gone, this returns
// null and the app behaves exactly as it does today. It is never load-bearing.
//
// KEY HANDLING
// ------------
// Expo inlines EXPO_PUBLIC_* into the JS bundle, so the key IS extractable from
// a shipped build. That is acceptable for a demo with a throwaway free-tier key
// and is NOT acceptable for a public release; for that, put a proxy in front of
// it so the key lives on a server. The key must never be committed: it comes
// from app/.env, which is gitignored.

const KEY = process.env.EXPO_PUBLIC_OPENROUTER_KEY ?? '';
const MODEL = process.env.EXPO_PUBLIC_OPENROUTER_MODEL ?? 'liquid/lfm-2.5-2.6b:free';

// ---------------------------------------------------------------- money guards
//
// Four independent layers, because one of them silently failing should not cost
// anyone money. Listed weakest to strongest.
//
// 1. FREE MODELS ONLY. OpenRouter charges for anything without the :free
//    suffix, so a non-free model turns the whole feature off rather than
//    quietly billing.
// 2. max_price 0. OpenRouter will not route a request no provider can serve at
//    that price, so this fails CLOSED - the call errors instead of costing.
// 3. allow_fallbacks false. Without it, an unavailable free provider can be
//    swapped for a working paid one mid-request.
// 4. A local daily cap under the free tier's own 50/day, plus a minimum gap
//    between calls, so a render loop cannot burn the quota in seconds.
//
// The real backstop is not in this file: an OpenRouter account with no payment
// method on it cannot be charged at all. Keep it that way.

// A chain, not a bet. Free-tier models are volatile: on one run both Gemmas
// returned 429 because the provider was busy, apodex burned its budget
// reasoning and returned nothing, and lfm answered correctly in 109 SECONDS.
// Any single choice is a coin flip, so try them in order and take the first
// that actually answers. The env var, when set, goes first.
// Order matters more than the list. Instruction-tuned models first, because
// they answer in seconds; the reasoners last, because lfm took 152 SECONDS on
// a hard question and then echoed the formatting instruction into its own
// output. The env var is an override, appended rather than promoted, so
// pointing it at a slow model cannot put that model in front again.
const MODELS = [
  'google/gemma-4-31b-it:free',      // instruction-tuned, not a reasoner
  'google/gemma-4-26b-a4b-it:free',
  // lfm sits here, not last. It answers - measured first token at 1.3s over a
  // stream - and the only thing that ever made it look slow was oversized
  // input. apodex is deliberately NOT in this list: it returns HTTP 200 and
  // then emits reasoning only, which exclude:true discards, so it streams
  // nothing at all and costs a full watchdog timeout before the chain moves on.
  'liquid/lfm-2.5-2.6b:free',
  MODEL,
].filter((m, i, a) => m && m.trim().endsWith(':free') && a.indexOf(m) === i);

// Two clocks, because "slow" and "stuck" are different problems. A model gets
// FIRST_TOKEN_MS to say anything at all; after that it only has to keep
// talking, with IDLE_MS between tokens. A fixed total budget killed the one
// model that worked: streaming showed first token at 2.3s and completion at
// 2.9s on a focused payload, but an 18-second total cap still aborted it on
// longer answers that were streaming along perfectly well.
const FIRST_TOKEN_MS = 14000;
const IDLE_MS = 12000;

const FREE_ONLY = MODELS.length > 0;

const DAILY_CAP = 40;        // free tier allows 50; leave headroom
const MIN_GAP_MS = 1500;     // free tier allows 20/min

let day = '';
let used = 0;
let lastCall = 0;

function quotaLeft(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    used = 0;
  }
  return used < DAILY_CAP;
}

/** Why the feature is off, or null when it is on. For humans, not for logic. */
export function explainDisabledReason(): string | null {
  if (!KEY) return 'no API key configured';
  if (!FREE_ONLY) return `no :free model configured (${MODEL} is blocked)`;
  return null;
}

export const explainAvailable = () => !!KEY && FREE_ONLY;

export type Source = { citation: string; heading: string; text: string };

/** Hand-written, human-verified rules for the topic, when we have them. */
export type CuratedRule = { text: string; citation: string };

/** Rules the reader's own description already runs into, if any. */
export type Conflict = { text: string; citation: string };

// A greeting is not a legal question, and burning one of 50 daily requests to
// have a model say hello is waste. These get answered locally and instantly.
const GREETING =
  /^\s*(?:hi|hey+|hello|yo+|sup|wassup|what'?s up|howdy|good (?:morning|afternoon|evening)|test|hru|how are you)\b[\s!.?]*$/i;

export function localReply(question: string): string | null {
  if (GREETING.test(question)) {
    return "Hey. Ask me what you're planning to do and I'll find the Nevada law that covers it, in plain English. Something like \"ride my dirtbike on the street\" or \"can I get a job at 15\".";
  }
  return null;
}

// Everything hangs on this prompt. It is written to make refusal the easy path:
// the model is told what it may use, told to say so when the text does not
// answer, and told not to advise.
function messages(question: string, sources: Source[]) {
  const corpus = sources
    .map((s) => `${s.citation} - ${s.heading}\n${s.text.slice(0, 3500)}`)
    .join('\n\n---\n\n');

  return [
    {
      role: 'system',
      content: [
        'You explain Nevada statutes to a teenager in plain English.',
        '',
        'RULES, in order of importance:',
        '1. Use ONLY the statute text provided by the user. It is the only source',
        '   you have. You have no other knowledge of Nevada law.',
        '2. If the provided text does not answer the question, say exactly that.',
        '   Do not fill the gap. Saying "these sections do not answer that" is a',
        '   correct and useful answer.',
        '3. Never state a rule, number, age, fee or deadline that is not written',
        '   in the provided text.',
        '4. Cite the NRS number in each point, like (NRS 484B.157).',
        '5. This is not legal advice. Describe what the statute says. Do not tell',
        '   the reader what to do, and do not predict what will happen to them.',
        '',
        'FORMAT: at most 4 short bullet points, each one sentence, plain words.',
        'No preamble, no sign-off.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Question: ${question}\n\nStatute text you may use:\n\n${corpus}`,
    },
  ];
}

// The whole-question answer. Local search has already decided WHICH statutes
// are relevant; this only writes them up. The model is given the retrieved text
// and, when the topic is one of the curated ones, the hand-verified rules too,
// because those were checked by a person and are better than anything a model
// would infer from raw statute prose.
// Send the part of the statute that is actually about the question.
//
// Slicing from the start is wrong for long sections. NRS 200.364 is a list of
// definitions, and "statutory sexual seduction" - the one that decides a
// question about ages - sits well past the first 700 characters. The model was
// handed definitions of "offense involving a pupil" and told to answer about
// age of consent, so it correctly said it could not.
//
// Instead: score windows by how many of the asker's words they contain and send
// the best one, snapped outward to sentence boundaries so it does not open
// mid-clause.
function relevantSlice(text: string, question: string, max: number): string {
  if (text.length <= max) return text;

  const words = (question.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(
    (w, i, a) => a.indexOf(w) === i
  );
  if (!words.length) return text.slice(0, max);

  const lower = text.toLowerCase();
  const step = Math.max(120, Math.floor(max / 6));
  let bestAt = 0;
  let bestScore = -1;

  for (let at = 0; at + 1 <= text.length; at += step) {
    const window = lower.slice(at, at + max);
    let score = 0;
    for (const w of words) if (window.includes(w)) score++;
    if (score > bestScore) {
      bestScore = score;
      bestAt = at;
    }
  }

  let start = bestAt;
  let end = Math.min(text.length, bestAt + max);
  // Snap to a sentence start so the excerpt does not begin mid-clause.
  const back = text.lastIndexOf('. ', start);
  if (start > 0 && back > start - 220 && back !== -1) start = back + 2;
  const fwd = text.indexOf('. ', end);
  if (fwd !== -1 && fwd < end + 220) end = fwd + 1;

  const cut = text.slice(start, end).trim();
  return (start > 0 ? '…' : '') + cut + (end < text.length ? '…' : '');
}

function answerMessages(
  question: string,
  sources: Source[],
  curated: CuratedRule[],
  conflicts: Conflict[] = []
) {
  const verified = curated.length
    ? 'HAND-CHECKED RULES for this topic, written by a person. Prefer these:\n' +
      curated.map((r) => `- ${r.text} (${r.citation})`).join('\n') +
      '\n\n'
    : '';

  // Two sections at 1200 characters, not four at 2200. Every free model here
  // is a reasoner, and reasoning cost scales with how much you hand it: four
  // long statutes on a sensitive question burned the whole budget before an
  // answer existed. The pinned sections rank first, so the two that arrive are
  // the two that matter.
  const corpus = sources
    .slice(0, 2)
    .map((s) => `${s.citation} - ${s.heading}\n${relevantSlice(s.text, question, 1200)}`)
    .join('\n\n---\n\n');

  return [
    {
      role: 'system',
      content: [
        'You explain Nevada law to a 15 year old, in plain English.',
        '',
        'Use ONLY the rules and statute text below. You know nothing else about',
        'Nevada law. Never state an age, number, fee or deadline that is not',
        'written there. Never widen who a rule covers: if a section punishes an',
        'adult for doing something to a minor, it does not punish the minor.',
        'If the text does not answer the question, say so in one sentence.',
        '',
        'Cite the NRS number for each fact, like (NRS 484B.157).',
        'Say what the law requires. Never tell the reader what to do.',
        'Short words. Do not reuse legal words people never say out loud.',
        '',
        'Write one plain sentence answering the question, then up to 4 short',
        'bullets each starting with "- ". Put **double asterisks** around only',
        'the two or three words that decide the answer.',
      ].join('\n'),
    },
    {
      role: 'user',
      content:
        `Question: ${question}\n\n` +
        (conflicts.length
          ? 'ALREADY ESTABLISHED, and you must agree with it. What this person\n' +
            'described runs into these rules, so your first sentence has to say\n' +
            'NO or "not as described". Do not open by saying they can do it:\n' +
            conflicts.map((c) => `- ${c.text} (${c.citation})`).join('\n') +
            '\n\n'
          : '') +
        `${verified}STATUTE TEXT:\n\n${corpus}`,
    },
  ];
}

// Answers are cached by question for the session. Opening a statute and
// pressing back used to refire the whole request and sit on a spinner for
// fifteen seconds, which made reading the sources feel like a punishment.
const ANSWERS = new Map<string, string>();

export function cachedAnswer(question: string): string | null {
  return ANSWERS.get(question.trim().toLowerCase()) ?? null;
}

export async function answerQuestion(
  question: string,
  sources: Source[],
  curated: CuratedRule[] = [],
  conflicts: Conflict[] = [],
  signal?: AbortSignal,
  onToken?: (soFar: string) => void
): Promise<string | null> {
  if (!explainAvailable()) return null;
  if (!sources.length && !curated.length) return null;

  const key = question.trim().toLowerCase() + '|' + conflicts.map((c) => c.citation).join(',');
  const hit = ANSWERS.get(key);
  if (hit) return hit;

  const body = answerMessages(question, sources, curated, conflicts);
  let out: string | null = null;

  for (const model of MODELS) {
    if (signal?.aborted) break;

    // Each attempt gets its own clock, linked to the caller's abort so closing
    // the screen still cancels everything.
    const ctrl = new AbortController();
    const relay = () => ctrl.abort();
    signal?.addEventListener('abort', relay);

    // Watchdog: fires only when nothing has arrived for a while.
    let last = Date.now();
    let seen = false;
    const watch = setInterval(() => {
      const quiet = Date.now() - last;
      if (quiet > (seen ? IDLE_MS : FIRST_TOKEN_MS)) ctrl.abort();
    }, 1000);

    try {
      out = await post(body, model, ctrl.signal, (soFar) => {
        last = Date.now();
        seen = true;
        onToken?.(soFar);
      });
      if (out) break;
    } catch (e: any) {
      // Our own daily cap is the one failure another model cannot fix.
      if (e?.message === 'local-cap') throw e;
      // Everything else - 429 from a busy provider, a reasoner that ran out of
      // budget, this model simply being too slow - means try the next one.
    } finally {
      clearInterval(watch);
      signal?.removeEventListener('abort', relay);
    }
  }

  if (out) ANSWERS.set(key, out);
  return out;
}

export async function explain(
  question: string,
  sources: Source[],
  signal?: AbortSignal
): Promise<string | null> {
  if (!explainAvailable() || !sources.length) return null;
  return post(messages(question, sources), MODELS[0] ?? MODEL, signal);
}

// Streaming. The answer arrives a few words at a time instead of after a long
// blank pause, which is the difference between "is this broken?" and watching
// it think. onToken is optional: the non-streaming path is unchanged for the
// per-statute explainer.
async function post(
  body: { role: string; content: string }[],
  model: string,
  signal?: AbortSignal,
  onToken?: (soFar: string) => void
): Promise<string | null> {
  // OUR cap, which no other model can get around.
  if (!quotaLeft()) throw new Error('local-cap');

  const gap = Date.now() - lastCall;
  if (gap < MIN_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_GAP_MS - gap));
  }
  lastCall = Date.now();
  used += 1;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: body,
      stream: !!onToken,
      // Low temperature: this is a rewriting job, not a creative one.
      temperature: 0.1,
      // Every free model on OpenRouter today is a reasoner: the first live test
      // returned content:null with 1,600 characters of thinking and
      // finish_reason "length". They need room to finish thinking BEFORE the
      // answer exists, so the budget is generous. Tokens are free here; the
      // only cost is latency.
      // Raising this to 4000 did not fix the empty answer, it just turned a
      // blank card into a 90-second hang. The budget was never the lever: the
      // fix is giving a reasoning model LESS to chew on, which is why sources
      // are capped hard below. 2500 is headroom, not an invitation.
      max_tokens: 2500,
      reasoning: { effort: 'low', exclude: true },
      // Refuse to route anywhere that costs anything. If no provider can serve
      // this for free the request fails, which is the outcome we want.
      max_price: { prompt: 0, completion: 0 },
      // And never swap a free provider for a paid one to satisfy the request.
      provider: { allow_fallbacks: false },
    }),
  });

  if (!res.ok) {
    // 429 is the free-tier daily cap. Everything else is equally non-fatal:
    // the caller falls back to the verbatim bullets it already has.
    // A 429 here is a BUSY PROVIDER, not our quota - a different thing with the
    // same status code. Conflating the two made one busy Gemma kill the whole
    // chain before it ever reached a model that would have answered.
    throw new Error(res.status === 429 ? 'busy' : `http ${res.status}`);
  }

  if (onToken && res.body) {
    const reader = res.body.getReader();
    const decode = new TextDecoder();
    let buf = '';
    let text = '';
    let finish: string | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decode.decode(value, { stream: true });

      // Server-sent events: one JSON object per "data:" line.
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload);
          const c = j?.choices?.[0];
          if (c?.finish_reason) finish = c.finish_reason;
          const piece = c?.delta?.content;
          if (piece) {
            text += piece;
            onToken(text);
          }
        } catch {
          // A partial frame; the next chunk completes it.
        }
      }
    }

    if (finish === 'length' && !text) throw new Error('truncated');
    const kept = clean(text);
    if (__DEV__ && !kept) {
      console.log(`[sage] ${model}: streamed ${text.length} chars, clean() kept none`);
    }
    return kept;
  }

  const data = await res.json();
  const choice = data?.choices?.[0];
  const out = choice?.message?.content;

  // Ran out of budget mid-thought. Distinguishable from "model said nothing
  // useful", because the fix is different: send it less to chew on.
  if (choice?.finish_reason === 'length' && !out) throw new Error('truncated');

  return typeof out === 'string' ? clean(out) : null;
}

// Belt and braces for the same problem. Even with reasoning excluded, a model
// can narrate its plan. Showing that to a reader is worse than showing nothing,
// so anything that still looks like scratch work is dropped rather than
// displayed, and the caller falls back to the verbatim bullets.
const THINKING =
  /^(?:here'?s? (?:a|my) (?:thinking|thought)|let me|first,? i|i need to|okay,? so|analysis:|step \d)/i;

function clean(raw: string): string | null {
  let t = raw.replace(/<\/?think(?:ing)?>/gi, '').trim();

  // Drop a preamble before the first bullet ONLY when it reads as scratch work
  // or runs long. The format asks for one plain sentence up top that answers
  // the question, and an earlier version of this cut exactly that sentence off.
  const bullet = t.search(/^\s*(?:[-*\u2022]|\d+[.)])\s+/m);
  if (bullet > 0) {
    const intro = t.slice(0, bullet).trim();
    if (THINKING.test(intro) || intro.length > 300) t = t.slice(bullet);
  }
  t = t.trim();

  // Models cite inline AND append the citation the format asked for, giving
  // "(NRS 490.090). (NRS 490.090)". Collapse the repeat.
  t = t.replace(/\((NRS [^)]+)\)\.?\s*\(\1\)/g, '($1)');
  t = t.replace(/\((NRS [^)]+)\)([^\n]*?)\(\1\)/g, '($1)$2');

  // The model still leaks the mechanism now and then: "the provided statutes do
  // not address...". The substance is right and worth keeping, so rewrite the
  // phrase rather than dropping the sentence.
  t = t
    .replace(/\bthe (?:provided|given|above) statutes?\b/gi, 'Nevada law')
    .replace(/\bthe statutes? (?:provided|given|above)\b/gi, 'Nevada law')
    .replace(/\bthe (?:provided|given) text\b/gi, 'Nevada law')
    .replace(/\bthe hand-check(?:ed)? (?:note|rules?)\b/gi, 'the note above');

  // Advice, which rule 7 forbids and which models produce anyway. These are
  // whole sentences telling the reader what to do, so drop them outright.
  t = t
    .split(/(?<=[.!?])\s+/)
    .filter(
      (sent) =>
        !/^\s*(?:you should\b|you'?d need to\b|you would need to\b|you may need to\b|you can pursue\b|to ride legally\b)/i.test(sent)
    )
    .join(' ');

  // Models append a sign-off the format explicitly forbids: "Source: Nevada
  // Revised Statutes 609.240 and 609.190". The citations are already inline and
  // every statute is listed under the answer, so it is pure noise.
  t = t.replace(/\n+\s*(?:source|sources|references?|citations?)\s*:.*$/is, '').trim();

  // Small models echo the instructions back. One answer ended with "Double
  // asterisks needed around the two or three words that decide the answer".
  // Any line talking about asterisks, bullets or "the statutes provided" as a
  // formatting instruction is the prompt leaking, not an answer.
  t = t
    .split('\n')
    .filter(
      (l) =>
        !/\b(?:double asterisks|asterisks around|bullets? each starting|NRS 484B\.157\)?\s*$)/i.test(l) &&
        // Models narrate their own formatting choices: "Deciding words:
        // *unpaved county roads*, *registration*". That is working notes, not
        // an answer, and it appeared at the end of a finished bullet list.
        !/^\s*\*{0,2}(?:deciding|key|emphasi[sz]ed?|important)\s+words?\b/i.test(l)
    )
    .join('\n')
    .trim();

  // Single-asterisk italics are not rendered, so they arrive as literal
  // characters mid-sentence. Double asterisks are kept: those drive emphasis.
  t = t.replace(/(^|[^*])\*(?!\*)([^*\n]+)\*(?!\*)/g, '$1$2');

  if (!t) return null;
  if (THINKING.test(t)) return null;
  // There used to be a rule here rejecting anything over 900 characters that
  // had no line-starting bullet. The model returns inline " - " separators
  // about half the time, so that rule silently binned perfectly good answers
  // and the app fell back to the pre-written card - which read to a user as the
  // summary being random. The renderer normalises those separators into a list
  // now, so the rule had nothing left to protect and has been removed.
  return t;
}
