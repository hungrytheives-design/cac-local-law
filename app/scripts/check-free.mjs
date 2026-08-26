#!/usr/bin/env node
// Prove the money guards hold, against the live API.
//
//   cd app && node scripts/check-free.mjs
//
// Reads the key from app/.env. Never prints it. Run this once after adding a
// key, and again any time the model is changed.

import { readFileSync } from 'node:fs';

let env = {};
try {
  env = Object.fromEntries(
    readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
} catch {
  console.error('no app/.env found. cp .env.example .env and add your key.');
  process.exit(1);
}

const KEY = env.EXPO_PUBLIC_OPENROUTER_KEY;
const MODEL = env.EXPO_PUBLIC_OPENROUTER_MODEL || 'nvidia/nemotron-3.5-lightning:free';
if (!KEY) {
  console.error('EXPO_PUBLIC_OPENROUTER_KEY is empty in app/.env');
  process.exit(1);
}

const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const ok = (b) => (b ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m');
let bad = 0;

// 1. The account itself. limit_remaining null + usage 0 on a free key is fine;
//    what matters is that nothing has been spent and no credits are attached.
const acct = await fetch('https://openrouter.ai/api/v1/key', { headers: H })
  .then((r) => r.json())
  .catch(() => null);
const d = acct?.data ?? {};
console.log('\naccount');
console.log(`  usage so far      $${d.usage ?? '?'}`);
console.log(`  credit limit      ${d.limit ?? 'none set'}`);
console.log(`  is free tier      ${d.is_free_tier ?? '?'}`);
const spent = Number(d.usage ?? 0);
console.log(`  ${ok(spent === 0)} nothing has been charged`);
if (spent !== 0) bad++;

// 2. The configured model must be free.
console.log('\nconfigured model');
const free = MODEL.trim().endsWith(':free');
console.log(`  ${ok(free)} ${MODEL} ${free ? 'is a :free model' : 'IS NOT FREE - app disables itself'}`);
if (!free) bad++;

const body = (model) => ({
  model,
  messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  max_tokens: 5,
  max_price: { prompt: 0, completion: 0 },
  provider: { allow_fallbacks: false },
});

// 3. A free call should work.
console.log('\nfree model call');
const r1 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST', headers: H, body: JSON.stringify(body(MODEL)),
});
console.log(`  ${ok(r1.ok)} http ${r1.status}`);
if (!r1.ok) {
  bad++;
  console.log(`      ${(await r1.text()).slice(0, 160)}`);
}

// 4. THE IMPORTANT ONE. A paid model, with the same zero price ceiling, must be
//    refused rather than billed.
console.log('\npaid model, blocked by max_price 0');
const r2 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST', headers: H, body: JSON.stringify(body('openai/gpt-4o')),
});
const refused = !r2.ok;
console.log(`  ${ok(refused)} http ${r2.status} ${refused ? '(refused, as intended)' : '(WENT THROUGH - this would cost money)'}`);
if (!refused) bad++;

// 5. Confirm the paid attempt did not move the meter.
const after = await fetch('https://openrouter.ai/api/v1/key', { headers: H })
  .then((r) => r.json()).catch(() => null);
const spent2 = Number(after?.data?.usage ?? 0);
console.log(`\n  ${ok(spent2 === spent)} spend unchanged after the test ($${spent2})`);
if (spent2 !== spent) bad++;

console.log(bad ? `\n\x1b[31m${bad} problem(s)\x1b[0m\n` : '\n\x1b[32mall guards holding\x1b[0m\n');
process.exit(bad ? 1 : 0);
