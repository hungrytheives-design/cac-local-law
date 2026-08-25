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
const MODEL = process.env.EXPO_PUBLIC_OPENROUTER_MODEL ?? 'nvidia/nemotron-3.5-lightning:free';

export const explainAvailable = () => KEY.length > 0;

export type Source = { citation: string; heading: string; text: string };

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

export async function explain(
  question: string,
  sources: Source[],
  signal?: AbortSignal
): Promise<string | null> {
  if (!KEY || !sources.length) return null;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: messages(question, sources),
      // Low temperature: this is a rewriting job, not a creative one.
      temperature: 0.1,
      max_tokens: 400,
    }),
  });

  if (!res.ok) {
    // 429 is the free-tier daily cap. Everything else is equally non-fatal:
    // the caller falls back to the verbatim bullets it already has.
    throw new Error(res.status === 429 ? 'rate-limited' : `http ${res.status}`);
  }

  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content;
  return typeof out === 'string' && out.trim() ? out.trim() : null;
}
