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

const FREE_ONLY = MODEL.trim().endsWith(':free');

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
  if (!FREE_ONLY) return `${MODEL} is not a :free model, so it is blocked`;
  return null;
}

export const explainAvailable = () => !!KEY && FREE_ONLY;

export type Source = { citation: string; heading: string; text: string };

/** Hand-written, human-verified rules for the topic, when we have them. */
export type CuratedRule = { text: string; citation: string };

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
function answerMessages(
  question: string,
  sources: Source[],
  curated: CuratedRule[]
) {
  const verified = curated.length
    ? 'HAND-CHECKED RULES for this topic, written by a person. Prefer these:\n' +
      curated.map((r) => `- ${r.text} (${r.citation})`).join('\n') +
      '\n\n'
    : '';

  const corpus = sources
    .map((s) => `${s.citation} - ${s.heading}\n${s.text.slice(0, 2200)}`)
    .join('\n\n---\n\n');

  return [
    {
      role: 'system',
      content: [
        'You are Sage. You answer questions about Nevada law for teenagers,',
        'in plain English, using only material you are given.',
        '',
        'RULES, in order of importance:',
        '1. Use ONLY the rules and statute text in the user message. You have no',
        '   other knowledge of Nevada law. Never add a rule, number, age, fee or',
        '   deadline that is not written there.',
        '2. If what you were given does not answer the question, say so plainly',
        '   in one sentence and suggest what to search instead. Do not guess.',
        '3. Cite the NRS number for every factual point, like (NRS 484B.157).',
        '   Never widen who a rule covers. If a section punishes a person who',
        '   induces a child to miss school, it does NOT say the child is',
        '   punished. Say who the section actually names and no one else.',
        '4. Answer the question that was actually asked. If they said they are a',
        '   certain age or doing something specific, speak to that.',
        '5. Not legal advice. Say what the law requires; do not tell them what to',
        '   do or predict what will happen to them.',
        '6. Never refer to the material you were given. Do not write "the',
        '   provided statutes", "the text provided", "the hand-check note" or',
        '   anything like them. Say "Nevada law" or name the section instead.',
        '   If nothing answers the question, write "Nevada law here does not',
        '   answer that" - not "the provided statutes do not address it".',
        '7. Do not tell the reader what to do. No "you should", no "you may need',
        '   to", no suggesting court, forms or next steps. State what the law',
        '   requires and stop. Telling someone to file in small claims court is',
        '   legal advice and it is not yours to give.',
        '',
        'FORMAT, followed exactly:',
        'Line 1 is a single plain sentence that answers the question directly.',
        'If the thing they described is not allowed, it starts with "No".',
        'If it is allowed, it starts with "Yes".',
        'Otherwise say what it depends on. Never write "Yes" in front of a',
        'sentence that goes on to say they cannot do it.',
        'It is not optional and it never starts with a bullet.',
        'Then a blank line, then up to 4 bullets, one sentence each.',
        'Put each citation once, at the end of its sentence. Never repeat a',
        'citation twice in the same sentence. No sign-off.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Question: ${question}\n\n${verified}STATUTE TEXT:\n\n${corpus}`,
    },
  ];
}

export async function answerQuestion(
  question: string,
  sources: Source[],
  curated: CuratedRule[] = [],
  signal?: AbortSignal
): Promise<string | null> {
  if (!explainAvailable()) return null;
  if (!sources.length && !curated.length) return null;
  return post(answerMessages(question, sources, curated), signal);
}

export async function explain(
  question: string,
  sources: Source[],
  signal?: AbortSignal
): Promise<string | null> {
  if (!explainAvailable() || !sources.length) return null;
  return post(messages(question, sources), signal);
}

async function post(
  body: { role: string; content: string }[],
  signal?: AbortSignal
): Promise<string | null> {
  if (!quotaLeft()) throw new Error('rate-limited');

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
      model: MODEL,
      messages: body,
      // Low temperature: this is a rewriting job, not a creative one.
      temperature: 0.1,
      // Every free model on OpenRouter today is a reasoner: the first live test
      // returned content:null with 1,600 characters of thinking and
      // finish_reason "length". They need room to finish thinking BEFORE the
      // answer exists, so the budget is generous. Tokens are free here; the
      // only cost is latency.
      max_tokens: 2000,
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
    throw new Error(res.status === 429 ? 'rate-limited' : `http ${res.status}`);
  }

  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content;
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
        !/^\s*(?:you should\b|you may need to\b|you can pursue\b|you would need to consult\b)/i.test(sent)
    )
    .join(' ');

  // Models append a sign-off the format explicitly forbids: "Source: Nevada
  // Revised Statutes 609.240 and 609.190". The citations are already inline and
  // every statute is listed under the answer, so it is pure noise.
  t = t.replace(/\n+\s*(?:source|sources|references?|citations?)\s*:.*$/is, '').trim();

  if (!t) return null;
  if (THINKING.test(t)) return null;
  // A wall of prose with no bullet is not the format we asked for.
  if (t.length > 900 && !/^\s*(?:[-*\u2022]|\d+[.)])\s+/m.test(t)) return null;
  return t;
}
