import { StatusBar } from 'expo-status-bar';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import index from './assets/nrs-index.json';
import concepts from './assets/concepts.json';
import activities from './assets/activities.json';
import {
  answerQuestion,
  cachedAnswer,
  explain,
  explainAvailable,
  localReply,
  type CuratedRule,
  type Source,
} from './lib/explain';

// Every section is searchable. Only `t` (verbatim text) is selective, because
// carrying full text for all of NRS would be ~150 MB. See data/scripts/build_index.py
type Section = {
  i: string;
  c: string;  // citation, "NRS 484B.130"
  h: string;  // heading
  ch: string; // chapter number, "484B". Title comes from CHAPTER_TITLES.
  t?: string; // verbatim text, present for user-facing sections
  r?: number; // repealed
  e?: string; // effective-date label
  ec?: number;// 1 if that label is the version in force today
  p?: { k: string; t: string }[]; // verbatim duty/limit/penalty sentences
};

const SECTIONS = (index as any).sections as Section[];
const META = (index as any).meta as {
  generated: string;
  chapters: number;
  sections: number;
};
const CHAPTER_TITLES = (index as any).chapterTitles as Record<string, string>;

type Concept = {
  id: string;
  colloquial: string[];
  statutory: string[];
  chapters: string[];
};
const CONCEPTS = concepts as Concept[];

// The curated tier. Search finds the right statute; it cannot make one readable.
// NRS 488.730 is titled "Operation of certain power-driven vessels on interstate
// waters of State by persons born on or after January 1, 1983". Nobody learns
// "you need a boater education card" from that sentence, so for the activities
// people actually ask about, a human wrote the answer and cited every line.
type Rule = {
  id: string;
  text: string;
  citation: string;
  sourceUrl: string;
  appliesIf?: string;
  confidence: 'clear' | 'ambiguous';
  brokenBy?: string[];   // condition ids that directly contradict this rule
  minAge?: number;       // you must be at least this old for this to be allowed
};
type Activity = {
  id: string;
  displayName: string;
  keywords: string[];
  summary: string;
  rules: Rule[];
  lastVerified: string;
};
const ACTIVITIES = activities as Activity[];

// ---------------------------------------------------------------------- theme

// Sage, with the cream pulled right back. Full cream everywhere read soft and
// spa-like; the app is a reference tool, so the chrome is near-white and the
// sage does the work. The icon keeps its cream field because an icon needs to
// hold its own against a white home screen.
const C = {
  bg: '#FBFAF7',
  card: '#FFFFFF',
  ink: '#1A1F1A',      // warm near-black, never pure #000
  muted: '#5A6358',
  faint: '#8E958A',
  line: '#E7E7E1',
  accent: '#4A6046',   // deeper than the icon sage; carries small text legibly
  accentDeep: '#33452F',
  accentSoft: '#EEF1EC',
  warn: '#8A5A00',
  warnSoft: '#F7EFE0',
};

// Two families, doing different jobs. The serif carries anything the reader is
// meant to READ - the answer, statute headings, statute text - and gives the
// app the register of a reference book rather than a settings screen. The sans
// carries chrome: labels, counts, buttons. Georgia ships on iOS and Android;
// the fallbacks matter for web.
const F = Platform.select({
  ios: { read: 'Georgia', ui: 'System' },
  android: { read: 'serif', ui: 'sans-serif' },
  default: { read: 'Georgia, "Times New Roman", serif', ui: 'system-ui, sans-serif' },
}) as { read: string; ui: string };

// One scale instead of the twelve ad-hoc sizes this had grown. Everything on
// screen is one of these.
const T = { xs: 11, sm: 13, base: 15, lg: 17, xl: 20, xxl: 26 };

// Situations, not keywords. The app's whole pitch is "describe your plan", so
// the examples have to look like plans. Every one was checked against the real
// index first: each returns a correct statute in the top 3.
const EXAMPLES = [
  'ride my dirtbike on the street',
  'drive my dad’s boat on Lake Mead',
  'ride my ebike to school',
  'put my little brother in the front seat',
];

// How many results a person will actually look at. The index happily returns
// 40+, but a wall of 40 statutes reads as "no answer" to someone who just wants
// to know if they can drive the boat.
const SHOWN = 12;

// What kind of obligation a quoted sentence carries. The glyph does the work a
// label would, without spending a line on it.
const POINT_MARK: Record<string, string> = {
  no: '\u2715',      // a prohibition
  must: '\u2713',    // a requirement
  age: '#',           // an age limit
  penalty: '!',       // a penalty
};

// ---------------------------------------------------------------------- search

// Function words plus the generic verbs that wrecked real queries. "we want to
// have a party" used to rank "Department may contract with third party" because
// nothing filtered `want` and `have`. Content words are never stopped, only
// words that carry no signal about which statute you mean.
const STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'for', 'or', 'and', 'on', 'is', 'are',
  'can', 'i', 'my', 'do', 'need', 'what', 'me', 'you',
  'want', 'wants', 'wanna', 'get', 'got', 'getting', 'go', 'going', 'goes',
  'have', 'has', 'had', 'take', 'taking', 'takes', 'use', 'using', 'used',
  'out', 'from', 'with', 'this', 'that', 'these', 'those', 'there', 'here',
  'allowed', 'able', 'let', 'lets', 'legal', 'illegal', 'law', 'laws', 'rule',
  'rules', 'about', 'when', 'where', 'how', 'why', 'who', 'which', 'while',
  'would', 'should', 'could', 'will', 'shall', 'might', 'must', 'may',
  'be', 'been', 'being', 'was', 'were', 'am', 'it', 'its', 'they', 'them',
  'their', 'we', 'us', 'our', 'he', 'she', 'her', 'him', 'your',
  'if', 'but', 'not', 'all', 'any', 'some', 'just', 'like', 'really', 'still',
  'even', 'only', 'very', 'much', 'many', 'more', 'most', 'also', 'then',
  'than', 'little', 'big', 'one', 'two', 'old', 'new', 'say', 'know', 'think',
  // Vague nouns. "can i do the thing" returned 143 hits led by "Assignment of
  // thing in action", because rarity weighting gave "thing" real weight.
  'thing', 'things', 'stuff', 'something', 'anything', 'someone', 'anyone',
]);

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

// People type "skateboarding", the lexicon says "skateboard". Exact matching
// missed that and sent the query to a statute about trustees leaving office.
// A full stemmer is overkill; stripping the four common endings is enough.
function stem(t: string): string {
  for (const suf of ['ing', 'ed', 'es', 's']) {
    if (t.length > suf.length + 2 && t.endsWith(suf)) {
      return t.slice(0, -suf.length);
    }
  }
  return t;
}

// Hyphens vary between the lexicon and the statute text, so flatten both sides.
function flat(s: string): string {
  return s.toLowerCase().replace(/[-\s]+/g, ' ').trim();
}

// The plain-English to legal-English bridge. Nobody types "off-highway vehicle",
// they type "dirtbike". Without this the app can only find statutes you already
// know the legal name of, which defeats the point.
function expand(tokens: string[], raw: string) {
  const terms = new Set<string>();
  const chapters = new Set<string>();
  const q = raw.toLowerCase();
  const stems = tokens.map(stem).filter((s) => s.length >= 3);

  for (const c of CONCEPTS) {
    const hit = c.colloquial.some((term) => {
      // Multi-word entries are matched against the raw string, since tokenizing
      // would split them and destroy the phrase.
      if (term.includes(' ')) return q.includes(term);
      if (tokens.includes(term)) return true;
      // Otherwise compare stems both directions, so "skateboarding" reaches
      // "skateboard" and "seat" reaches "seatbelt".
      // Both sides must be 4+ characters. Guarding only the lexicon term let
      // the three-letter token "off" prefix-match "offroad", so "walking my
      // dog off leash" pulled a +20 chapter boost toward off-highway vehicles.
      const ts = stem(term);
      if (ts.length < 4) return false;
      return stems.some((s) => s.length >= 4 && (s.startsWith(ts) || ts.startsWith(s)));
    });
    if (!hit) continue;
    // Keep statutory phrases WHOLE. Splitting "off-highway vehicle" into its
    // words matched 4,922 sections including "Use of may, must, shall", because
    // "all" and "vehicle" appear all over the code. The phrase is the signal.
    for (const phrase of c.statutory) terms.add(flat(phrase));
    for (const ch of c.chapters) chapters.add(ch);
  }
  return { terms: [...terms], chapters };
}

// Lowercased and flattened copies of every string the scorer reads. Without
// this, each keystroke re-lowercased all 49,742 headings and re-ran the flat()
// regex over 2.8 MB of statute text - and because flat(s.t) sat inside the
// terms loop, a two-term query did that text twice. Measured on the real index:
// 87 ms -> 36 ms for a three-token query, byte-identical results.
//
// Built on first search rather than at import, so it costs nothing at launch.
// This is a pure memoisation: no weight, threshold or comparison changed, so
// the hand port in test_search.py stays valid as written.
type Cached = {
  h: string;
  fh: string;
  t: string | null;
  ft: string | null;
  k: string[];
};

// Mirrors keywords() in build_index.py. Shipping these cost 5.3 MB when they
// are a pure function of the heading and chapter title, both already in the
// bundle. Rebuilt once, with the rest of the cache.
const KW_STOP = new Set(
  ('the a an of to in for or and by on with certain other otherwise provided when ' +
   'which that this these those is are be been as at from not no any all such may ' +
   'shall must person persons required requirement use used using').split(' ')
);

function keywordsOf(heading: string, chapterTitle: string): string[] {
  const words = `${heading} ${chapterTitle}`.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  const out: string[] = [];
  for (const w of words) {
    if (!KW_STOP.has(w) && !out.includes(w)) out.push(w);
  }
  return out.slice(0, 14);
}
let CACHE: {
  sections: Cached[];
  chapters: Record<string, string>;
  df: Record<string, number>;
} | null = null;

// "school" is in 805 headings, "truancy" in 12. Scoring both at +10 let 805
// irrelevant sections drown the 12 relevant ones, so a word is worth less the
// commoner it is. Document frequency is counted once, with the rest of the cache.
function rarity(token: string, df: Record<string, number>, n: number): number {
  return Math.log(n / (1 + (df[token] ?? 0))) / Math.log(n);
}

// Sections that administer the law rather than state it. They match query words
// as readily as real rules and then outrank them: "off highway vehicle
// registration" returned the Revolving Account for OHV Titling.
const ADMIN =
  /^(?:.*\b(?:regulations|account|fund|legislative declaration|appropriation|reports?|records|fees|budget|membership|meetings)\b|department|commission|board|division|director|administrator)/i;

function cached() {
  if (!CACHE) {
    const chapters: Record<string, string> = {};
    for (const ch of Object.keys(CHAPTER_TITLES)) {
      chapters[ch] = CHAPTER_TITLES[ch].toLowerCase();
    }
    const df: Record<string, number> = {};
    for (const sec of SECTIONS) {
      const seen = new Set(sec.h.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
      for (const w of seen) df[w] = (df[w] ?? 0) + 1;
    }
    CACHE = {
      df,
      chapters,
      sections: SECTIONS.map((s) => ({
        h: s.h.toLowerCase(),
        fh: flat(s.h),
        t: s.t ? s.t.toLowerCase() : null,
        ft: s.t ? flat(s.t) : null,
        k: keywordsOf(s.h, CHAPTER_TITLES[s.ch] ?? ''),
      })),
    };
  }
  return CACHE;
}

// NOTE: data/scripts/test_search.py is a hand port of everything below. If you
// change ranking here, change it there in the same sitting or the tests lie.
function search(query: string): { hits: Section[]; total: number } {
  // Somebody who already has a citation - off a ticket, a form, a friend -
  // types it in. Search only ever looked at headings and text, never at the
  // citation itself, so "NRS 484B.783" found everything except NRS 484B.783.
  const cite = query.match(/\b(?:nrs\s*)?(\d{1,3}[A-Z]?)\.(\d+[A-Za-z]*)\b/i);
  if (cite) {
    const want = `NRS ${cite[1].toUpperCase()}.${cite[2]}`;
    const exact = SECTIONS.filter((s) => s.c === want);
    if (exact.length) return { hits: exact, total: exact.length };
  }

  const tokens = tokenize(query);
  if (!tokens.length) return { hits: [], total: 0 };
  const { terms, chapters } = expand(tokens, query);
  const { sections: lc, chapters: lcChapter, df } = cached();
  const N = SECTIONS.length;

  const scored: { s: Section; score: number }[] = [];
  for (let i = 0; i < SECTIONS.length; i++) {
    const s = SECTIONS[i];
    const c = lc[i];
    let score = 0;

    let matched = 0;
    for (const t of tokens) {
      // Heading matches are worth far more than body matches. Without this,
      // a tax provision that happens to say "bicycle" outranks the actual
      // bicycle statute. Each is scaled by how rare the word is.
      const w = rarity(t, df, N);
      let hit = false;
      if (c.h.includes(t)) { score += 10 * w; hit = true; }
      if (c.k.some((k) => k.startsWith(t))) { score += 6 * w; hit = true; }
      if (lcChapter[s.ch] && lcChapter[s.ch].includes(t)) { score += 2 * w; hit = true; }
      if (c.t && c.t.includes(t)) { score += 1 * w; hit = true; }
      if (hit) matched++;
    }

    // Catching one rare word is not the same as catching the question. Rarity
    // alone made "skipping school" return "Generation-skipping transfer".
    if (tokens.length) score *= matched / tokens.length;

    // Lexicon-derived phrases score lower than what the user actually typed, so
    // a literal match always beats an inferred one.
    for (const t of terms) {
      if (c.fh.includes(t)) score += 12;
      if (c.ft && c.ft.includes(t)) score += 2;
    }

    // Chapter hint is a boost, never a filter, so a wrong lexicon entry degrades
    // ranking instead of hiding real law. Weighted heavily on purpose: once the
    // lexicon has identified the topic, a section in the right chapter should
    // beat one that merely shares a common word. At +8 it lost, and "cutting
    // through someone's property" ranked a tax-abatement statute above
    // NRS 207.200 Unlawful trespass on the strength of "property" alone.
    if (score > 0 && chapters.has(s.ch)) score += 20;

    if (ADMIN.test(s.h)) score -= 6;         // administers the law, does not state it
    if (s.r) score -= 20;                    // repealed, bury it
    if (s.e && s.ec === 0) score -= 15;      // not yet in force
    if (score > 0) scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score);

  // If the best hit only caught a common word we have not answered the
  // question, and a confident wrong statute is worse than saying nothing.
  // "what are my rights" used to return marital property law. 0.45 is the
  // measured edge: at 0.48 the eval gains a case but "my friend wants to
  // drive me home from school" goes dark, which is the worse loss.
  let reach = 0;
  for (const t of tokens) reach += 10 * rarity(t, df, N);
  if (!scored.length || (reach && scored[0].score < 0.45 * reach)) {
    return { hits: [], total: 0 };
  }
  return { hits: scored.slice(0, SHOWN).map((x) => x.s), total: scored.length };
}

// Statute text repeats its own citation and heading before the body. Showing
// that again under a heading we already rendered wastes the first screenful.
// The official URL is a pure function of the citation, so it is rebuilt here
// instead of being stored 50,299 times. That repetition was 3.2 MB of bundle.
function urlOf(s: Section): string {
  const num = s.c.includes('.') ? s.c.split('.').slice(1).join('.') : '';
  return `https://www.leg.state.nv.us/NRS/NRS-${s.ch}.html#NRS${s.ch}Sec${num}`;
}

function bodyOf(s: Section): string {
  const t = s.t;
  if (!t) return '';
  const prefix = `${s.c} ${s.h}`;
  return (t.startsWith(prefix) ? t.slice(prefix.length) : t).trim();
}

// Statute headings cram the whole scope of the section into one sentence:
// "Traffic controlled by official traffic-control devices exhibiting different
// colored lights: Rights and duties of vehicular traffic and pedestrians
// depending upon particular signal displayed; exceptions for person driving
// motorcycle, moped or trimobile..." The part before the first colon or
// semicolon is the subject; everything after it is scope. Cards show the
// subject, the detail screen still shows the heading whole.
function titleOf(h: string): string {
  const cut = h.split(/[:;]/)[0].trim();
  return cut.length >= 12 && cut.length < h.length ? cut : h;
}

// Conditions a person states about their own plan. "drive to school alone with
// my permit" is not one fact but three: the activity (permit driving), and the
// condition (alone) that contradicts what the permit actually allows. Detecting
// the condition is what lets the app answer "no" instead of listing rules and
// leaving you to notice the conflict yourself.
//
// Phrase matching, not a model. Deliberately narrow: a missed condition just
// falls back to showing the rules, but a WRONG one would tell someone their
// legal plan is illegal, which is the worse failure.
const SIGNALS: { id: string; phrases: string[] }[] = [
  {
    id: 'alone',
    phrases: [
      'alone', 'by myself', 'on my own', 'without my parents', 'without a parent',
      'without my mom', 'without my dad', 'no adult', 'nobody else', 'by himself',
      'by herself', 'by themselves',
    ],
  },
  {
    id: 'on-pavement',
    phrases: [
      'on the street', 'on the road', 'on the highway', 'on pavement',
      'on a paved', 'down the street', 'through town', 'on the freeway',
    ],
  },
  {
    id: 'at-night',
    phrases: [
      'at night', 'after dark', 'at midnight', 'past midnight', 'late at night',
      'after 10', 'after 11', 'at 11pm', 'at midnight', 'overnight',
    ],
  },
];

// The number a teenager states about themselves is usually the whole question -
// "can I get a job at 15" is not a question about jobs, it is a question about
// 15 - and the tokenizer throws it away because it filters short tokens.
//
// The trap is times. "drive at 11pm" must not read as an eleven-year-old, so a
// number followed by am/pm or a colon is rejected outright.
function detectAge(raw: string): number | null {
  const q = raw.toLowerCase();
  const patterns = [
    /\b(\d{1,2})\s*(?:and a half\s*)?(?:years?|yrs?)\s*old\b/,
    /\b(?:i'?m|im|i am|he'?s|she'?s|they'?re)\s+(\d{1,2})\b/,
    /\bage\s+(?:of\s+)?(\d{1,2})\b/,
    /\b(?:at|turn|turning|turned|only)\s+(\d{1,2})\b/,
  ];
  for (const re of patterns) {
    const m = q.match(re);
    if (!m) continue;
    const at = m.index ?? 0;
    const after = q.slice(at + m[0].length, at + m[0].length + 3);
    if (/^\s*(?:am|pm|:)/.test(after)) continue;   // a clock time, not an age
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 25) return n;                // outside that it is not an age
  }
  return null;
}

function detectSignals(raw: string): Set<string> {
  const q = raw.toLowerCase();
  const found = new Set<string>();
  for (const sig of SIGNALS) {
    if (sig.phrases.some((ph) => q.includes(ph))) found.add(sig.id);
  }
  return found;
}

// Does this query name something we wrote a real answer for? Same matching
// shape as the lexicon: whole phrases against the raw string, single words
// against stems, so "ebikes" and "riding my ebike" both land on the e-bike card.
function matchActivity(query: string): Activity | null {
  // Hyphens are flattened on both sides. Without this "e-bike" tokenized to
  // ["bike"] - the one-letter "e" is dropped - and matched no keyword at all,
  // so the most obvious way to spell the thing returned nothing.
  const q = flat(query);
  const tokens = tokenize(query.replace(/-/g, ' '));
  const stems = tokens.map(stem).filter((s) => s.length >= 3);

  // Phrases first, across every activity, because a phrase is more specific
  // than any single word in it. Checking activities in order instead meant
  // "work permit" hit the driving card, since learners-permit owns "permit"
  // and is listed before minor-work.
  for (const a of ACTIVITIES) {
    for (const k of a.keywords) {
      const fk = flat(k);
      if (fk.includes(' ') && q.includes(fk)) return a;
    }
  }

  for (const a of ACTIVITIES) {
    for (const k of a.keywords) {
      if (flat(k).includes(' ')) continue;
      if (tokens.includes(k)) return a;
      // Both sides must be 4+ characters. Guarding only the keyword let the
      // three-letter token "off" prefix-match the keyword "offroad", so
      // "walking my dog off leash" opened the dirt bike card.
      const ks = stem(k);
      if (
        ks.length >= 4 &&
        stems.some((s) => s.length >= 4 && (s.startsWith(ks) || ks.startsWith(s)))
      ) {
        return a;
      }
    }
  }
  return null;
}

// ----------------------------------------------------------------------- views

type Screen =
  | { kind: 'search' }
  | { kind: 'detail'; section: Section }
  | { kind: 'about' };

export default function App() {
  const [query, setQuery] = useState('');
  const [screen, setScreen] = useState<Screen>({ kind: 'search' });

  // Search runs on ENTER, not on every keystroke. Results used to appear and
  // reshuffle under the reader while they were still typing the question, which
  // is exactly the wrong moment to be showing anything.
  const [asked, setAsked] = useState('');
  const { hits, total } = useMemo(() => search(asked), [asked]);
  const hero = useMemo(() => matchActivity(asked), [asked]);
  const signals = useMemo(() => detectSignals(asked), [asked]);
  const age = useMemo(() => detectAge(asked), [asked]);
  const searching = asked.trim().length > 0;
  const greeting = localReply(asked);

  const ask = (q: string) => {
    const t = q.trim();
    if (!t) return;
    setQuery(t);
    setAsked(t);
  };

  if (screen.kind === 'detail') {
    return (
      <Detail section={screen.section} onBack={() => setScreen({ kind: 'search' })} />
    );
  }
  if (screen.kind === 'about') {
    return <About onBack={() => setScreen({ kind: 'search' })} />;
  }

  // Home and results are ONE tree, not two returns. They used to be separate
  // branches, so the moment tokenize() found its first real word - your third
  // letter - the whole screen swapped, the TextInput unmounted, and the
  // keyboard closed mid-sentence. Same element in both states now, so typing
  // never interrupts itself. The box stays pinned at the bottom either way and
  // results grow upward above it.
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />

      {/* Clearing the query is the way back to the home screen. Without this
          there was no exit from a search at all. */}
      <Nav
        onAbout={() => setScreen({ kind: 'about' })}
        onBack={
          searching
            ? () => {
                setQuery('');
                setAsked('');
              }
            : undefined
        }
      />

      <KeyboardAvoidingView
        style={styles.fill}
        // iOS reports the keyboard but does not resize for it; Android already
        // resizes the window, and adding padding on top of that double-counts.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {searching ? (
          <FlatList
            style={styles.fill}
            data={hits}
            keyExtractor={(s) => s.i}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View>
                {hero ? (
                  <Verdict activity={hero} signals={signals} age={age} />
                ) : null}

                <Answer
                  question={asked}
                  hits={hits}
                  activity={hero}
                  onOpen={(citation, url) => {
                      // Prefer our own reader so the statute opens in the app
                      // with its in-force flags; fall back to the official
                      // site only if the section is not in the index.
                    const s = SECTIONS.find((x) => x.c === citation);
                    if (s) setScreen({ kind: 'detail', section: s });
                    // Citation chips pass no url; a section we cannot find is
                    // simply not tappable rather than opening nothing.
                    else if (url) Linking.openURL(url);
                  }}
                />
                {greeting ? null : (
                  <>
                    {hero ? (
                      <Text style={styles.listLabel}>EVERY MATCHING STATUTE</Text>
                    ) : null}
                    <Text style={styles.count}>
                      {total === 0
                        ? 'Nothing matched. Try different words.'
                        : total > SHOWN
                        ? `Closest ${SHOWN} of ${total}. Add detail to narrow it down.`
                        : `${total} match${total === 1 ? '' : 'es'}`}
                    </Text>
                  </>
                )}
              </View>
            }
            renderItem={({ item, index: rank }) => (
              <Pressable
                style={[styles.card, rank === 0 && styles.cardTop]}
                onPress={() => setScreen({ kind: 'detail', section: item })}
                accessibilityRole="button"
                accessibilityLabel={`${item.c}. ${item.h}`}
              >
                {rank === 0 && <Text style={styles.bestLabel}>CLOSEST MATCH</Text>}
                <Text style={styles.heading} numberOfLines={3}>
                  {titleOf(item.h)}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={styles.citation}>{item.c}</Text>
                  <Text style={styles.chapterTag} numberOfLines={1}>
                    {CHAPTER_TITLES[item.ch]}
                  </Text>
                </View>
                {item.e ? (
                  <Text style={[styles.flag, item.ec !== 1 && styles.flagWarn]}>
                    {item.ec === 1 ? 'In force now · ' : 'Not yet in force · '}
                    {item.e}
                  </Text>
                ) : null}
                {item.p?.length ? (
                  <View style={styles.cardPoint}>
                    <Text style={styles.pointMark}>
                      {POINT_MARK[item.p[0].k] ?? '\u2022'}
                    </Text>
                    <Text style={styles.preview} numberOfLines={3}>
                      {item.p[0].t}
                    </Text>
                  </View>
                ) : item.t ? (
                  <Text style={styles.preview} numberOfLines={3}>
                    {bodyOf(item)}
                  </Text>
                ) : (
                  <Text style={styles.tapFor}>Tap to open the official text</Text>
                )}
              </Pressable>
            )}
          />
        ) : (
          <View style={styles.fill} />
        )}

        <View style={styles.composer}>
          {searching ? null : (
            <View style={styles.chips}>
              {EXAMPLES.map((e) => (
                <Pressable
                  key={e}
                  style={styles.chip}
                  onPress={() => ask(e)}
                  accessibilityRole="button"
                  accessibilityLabel={`Search: ${e}`}
                >
                  <Text style={styles.chipText}>{e}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="What are you planning to do?"
            placeholderTextColor={C.faint}
            autoCorrect={false}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={() => ask(query)}
            accessibilityLabel="Describe what you are planning to do"
          />
        </View>

        {/* Inside the avoider, so the disclaimer rides above the keyboard
            instead of hiding behind it. It has to be visible on every view. */}
        <Disclaimer />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Plain-English rewrite of THIS section, when a key is configured. Retrieval
// already happened locally; this only restates text the reader can see below.
function Explain({ section, body }: { section: Section; body: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [text, setText] = useState('');
  const [why, setWhy] = useState('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  if (!explainAvailable() || !body) return null;

  const run = async () => {
    setState('loading');
    abort.current?.abort();
    abort.current = new AbortController();
    const src: Source[] = [
      { citation: section.c, heading: section.h, text: body },
    ];
    try {
      const out = await explain(`What does ${section.c} require?`, src, abort.current.signal);
      if (out) {
        setText(out);
        setState('done');
      } else {
        setWhy('No answer came back.');
        setState('error');
      }
    } catch (e: any) {
      setWhy(
        e?.message === 'rate-limited'
          ? "Today's free requests are used up. The statute text below is unaffected."
          : 'Could not reach the service. The statute text below is unaffected.'
      );
      setState('error');
    }
  };

  return (
    <View style={styles.explain}>
      {state === 'idle' ? (
        <Pressable onPress={run} style={styles.explainBtn} accessibilityRole="button">
          <Text style={styles.explainBtnText}>What does this mean?</Text>
        </Pressable>
      ) : null}

      {state === 'loading' ? (
        <View style={styles.explainRow}>
          <ActivityIndicator color={C.accent} />
          <Text style={styles.explainWait}>Reading the statute…</Text>
        </View>
      ) : null}

      {state === 'done' ? (
        <>
          <Text style={styles.explainText}>{text}</Text>
          <Text style={styles.explainFoot}>
            Based only on the statute text below. The official wording is right
            there, so check it.
          </Text>
        </>
      ) : null}

      {state === 'error' ? <Text style={styles.explainWait}>{why}</Text> : null}
    </View>
  );
}

function Detail({ section, onBack }: { section: Section; onBack: () => void }) {
  const body = bodyOf(section);
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.topbar}>
        <Pressable onPress={onBack} style={styles.backBtn} accessibilityRole="button">
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.detail}>
        <Text style={styles.detailCitation}>{section.c}</Text>
        <Text style={styles.detailHeading}>{section.h}</Text>
        <Text style={styles.detailChapter}>
          Chapter {section.ch} · {CHAPTER_TITLES[section.ch]}
        </Text>

        {section.e ? (
          <View style={styles.detailFlag}>
            <Text style={[styles.flag, section.ec !== 1 && styles.flagWarn]}>
              {section.ec === 1 ? 'In force now · ' : 'Not yet in force · '}
              {section.e}
            </Text>
          </View>
        ) : null}
        {section.r ? (
          <View style={styles.detailFlag}>
            <Text style={[styles.flag, styles.flagWarn]}>
              This section has been repealed.
            </Text>
          </View>
        ) : null}

        <Explain section={section} body={body} />

        {section.p?.length ? (
          <View style={styles.points}>
            <Text style={styles.pointsLabel}>WHAT THIS SECTION SAYS</Text>
            {section.p.map((pt, n) => (
              <View key={`pt-${n}`} style={styles.pointRow}>
                <Text style={styles.pointMark}>
                  {POINT_MARK[pt.k] ?? '\u2022'}
                </Text>
                <Text style={styles.pointText}>{pt.t}</Text>
              </View>
            ))}
            <Text style={styles.pointsFoot}>
              Quoted word for word from the statute below, picked out by looking
              for the sentences that state a duty, a limit or a penalty. Nothing
              here is reworded, so read the full text before relying on it.
            </Text>
          </View>
        ) : null}

        {body ? (
          <Text style={styles.detailBody}>{body}</Text>
        ) : (
          <Text style={styles.detailMissing}>
            The full text of this section is not stored in the app. Open it on the
            Nevada Legislature website below.
          </Text>
        )}

        <Pressable
          style={styles.sourceBtn}
          onPress={() => Linking.openURL(urlOf(section))}
          accessibilityRole="link"
          accessibilityLabel={`Open ${section.c} on the Nevada Legislature website`}
        >
          <Text style={styles.sourceBtnText}>View official source ↗</Text>
        </Pressable>

        <Text style={styles.captured}>
          Captured from leg.state.nv.us on {META.generated}. Always confirm against
          the official source.
        </Text>
      </ScrollView>

      <Disclaimer />
    </SafeAreaView>
  );
}

function About({ onBack }: { onBack: () => void }) {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.topbar}>
        <Pressable onPress={onBack} style={styles.backBtn} accessibilityRole="button">
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.detail}>
        <Text style={styles.aboutTitle}>About Sage</Text>

        <Text style={styles.aboutBody}>
          You say “dirtbike.” The law says “off-highway vehicle.” That gap is why
          looking up the rules that apply to your own life usually fails. This app
          closes it.
        </Text>

        <Text style={styles.aboutH}>What is in here</Text>
        <Text style={styles.aboutBody}>
          All {META.sections.toLocaleString()} sections of the Nevada Revised
          Statutes, across {META.chapters} chapters, captured on {META.generated}.
          Everything is stored inside the app.
        </Text>

        <Text style={styles.aboutH}>How search works</Text>
        <Text style={styles.aboutBody}>
          We built a translation list by hand that maps everyday words onto the
          legal terms statutes actually use. Your words are matched against that
          list and against real statute headings and text. Results are ranked, and
          statutes that are repealed or not yet in force are pushed down.
        </Text>

        <Text style={styles.aboutH}>No AI runs when you search</Text>
        <Text style={styles.aboutBody}>
          Everything is prepared ahead of time and shipped with the app. Searching
          is keyword matching against a fixed list of real statutes. There is no
          model running, so the app cannot invent a law or reword one into
          something it does not say. It works in airplane mode.
        </Text>

        <Text style={styles.aboutH}>This is not legal advice</Text>
        <Text style={styles.aboutBody}>
          This app helps you find statutes. It does not tell you what they mean for
          your situation, and it does not cover city or county rules, which often
          apply on top of state law. Every result links to the official text so you
          can read it yourself. If something matters, talk to a real lawyer.
        </Text>

        <Text style={styles.aboutH}>Source</Text>
        <Text style={styles.aboutBody}>
          Nevada Revised Statutes, published by the Nevada Legislature at
          leg.state.nv.us. Built for the 2026 Congressional App Challenge.
        </Text>
      </ScrollView>

      <Disclaimer />
    </SafeAreaView>
  );
}

// The answer, before the search results. Every line is hand-written and every
// line carries the statute it came from, so a reader can check us rather than
// trust us. Rules we are not certain about say so instead of being dropped.
// Citations in the written answer become tappable chips instead of staying as
// "(NRS 484B.363, NRS 484B.350)" clutter mid-sentence. The reader gets the
// claim and a way to check it in the same breath, which is the entire point of
// grounding the answer in real statutes.
//
// Matches a parenthesised run of citations, or a bare one inside a sentence
// ("Under NRS 392.220, any person..."). A trailing subsection like 205.222(b)
// stays plain text, since the section is what we can actually open.
const CITE_RE =
  /\((?:\s*NRS\s+\d+[A-Z]?\.\d+[A-Za-z]*\s*[,;]?\s*)+\)|NRS\s+\d+[A-Z]?\.\d+[A-Za-z]*/g;
const ONE_CITE = /NRS\s+\d+[A-Z]?\.\d+[A-Za-z]*/g;

type Seg = { t: 'text' | 'cite'; v: string };

function segments(raw: string): Seg[] {
  // Drop the brackets first, keeping one space in front, so a sentence ending
  // "...requirements (NRS 484B.783)." becomes "...requirements NRS 484B.783."
  // and the full stop stays attached to the chip instead of drifting off.
  const text = raw
    .replace(
      /\s*\(\s*((?:NRS\s+\d+[A-Z]?\.\d+[A-Za-z]*\s*[,;]?\s*)+)\)/g,
      (_m, inner: string) => ' ' + inner.trim()
    )
    // Collapse runs of SPACES only. An earlier \s{2,} here also ate the
    // newlines between bullets and flattened the answer into one paragraph.
    .replace(/[ \t]{2,}/g, ' ')
    // The model formats its list as real newlines on one run and as inline
    // " - " separators on the next. Normalise so the reader always gets a list
    // rather than a wall of prose that happens to contain dashes.
    .replace(/\s+-\s+(?=[A-Z])/g, '\n- ')
    .trim();

  const out: Seg[] = [];
  let last = 0;
  for (const m of text.matchAll(ONE_CITE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ t: 'text', v: text.slice(last, at) });
    out.push({ t: 'cite', v: m[0].replace(/\s+/g, ' ').trim() });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

function Inline({
  text,
  style,
  onOpen,
}: {
  text: string;
  style: any;
  onOpen: (citation: string) => void;
}) {
  return (
    <Text style={style}>
      {segments(text).map((seg, i) =>
        seg.t === 'text' ? (
          <Text key={i}>{seg.v}</Text>
        ) : (
          <Text
            key={i}
            style={styles.citeChip}
            onPress={() => onOpen(seg.v)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${seg.v}`}
          >
            {seg.v}
          </Text>
        )
      )}
    </Text>
  );
}

// The lead sentence is the answer; the bullets are the detail. Rendering them
// as one blob of text with newlines gave loose, evenly-spaced paragraphs with
// no shape. Real rows, a marker column and tighter leading make it scannable.
function Cited({
  text,
  onOpen,
}: {
  text: string;
  onOpen: (citation: string) => void;
}) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const lead: string[] = [];
  const bullets: string[] = [];
  for (const l of lines) {
    const m = l.match(/^(?:[-*\u2022]|\d+[.)])\s+(.*)$/);
    if (m) bullets.push(m[1]);
    else if (bullets.length) bullets.push(l);   // wrapped continuation
    else lead.push(l);
  }

  return (
    <View>
      {lead.length ? (
        <Inline text={lead.join(' ')} style={styles.answerLead} onOpen={onOpen} />
      ) : null}
      {bullets.map((b, i) => (
        <View key={i} style={styles.bulletRow}>
          <Text style={styles.bulletDot}>•</Text>
          <Inline text={b} style={styles.answerText} onOpen={onOpen} />
        </View>
      ))}
    </View>
  );
}

// The written answer to what was actually asked. Local search has already
// decided WHICH statutes are relevant and that decision is never delegated;
// this only writes them up. When the topic is curated, the hand-checked rules
// go in alongside the statute text and the model is told to prefer them.
//
// Degrades all the way down: no key, no network or no quota, and the curated
// rules render on their own exactly as they did before any of this existed.
function Answer({
  question,
  hits,
  activity,
  onOpen,
}: {
  question: string;
  hits: Section[];
  activity: Activity | null;
  onOpen: (citation: string, url: string) => void;
}) {
  const [text, setText] = useState('');
  const [state, setState] = useState<
    'idle' | 'loading' | 'done' | 'greeting' | 'fallback'
  >('idle');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    // A greeting is not a legal question. Answering it locally is instant and
    // does not spend one of the day's 50 requests.
    const canned = localReply(question);
    if (canned) {
      setText(canned);
      setState('greeting');
      return;
    }
    // Straight from cache when this question has been answered already, so
    // coming back from a statute is instant instead of another long spinner.
    const seen = cachedAnswer(question);
    if (seen) {
      setText(seen);
      setState('done');
      return;
    }
    if (!explainAvailable() || (!hits.length && !activity)) {
      setState('fallback');
      return;
    }

    const ctrl = new AbortController();
    abort.current?.abort();
    abort.current = ctrl;
    setState('loading');
    setText('');

    const sources: Source[] = hits
      .filter((h) => h.t)
      .slice(0, 4)
      .map((h) => ({ citation: h.c, heading: h.h, text: bodyOf(h) }));
    const curated: CuratedRule[] = (activity?.rules ?? []).map((r) => ({
      text: r.text,
      citation: r.citation,
    }));

    answerQuestion(question, sources, curated, ctrl.signal)
      .then((out) => {
        if (ctrl.signal.aborted) return;
        if (out) {
          setText(out);
          setState('done');
        } else {
          setState('fallback');
        }
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setState('fallback');
      });

    return () => ctrl.abort();
  }, [question, hits, activity]);

  if (state === 'loading') {
    return (
      <View style={styles.answerWait}>
        <ActivityIndicator color={C.accent} />
        <Text style={styles.answerWaitText}>Reading the statutes…</Text>
      </View>
    );
  }

  // A greeting gets the words and nothing else: no statute footnote, because
  // there are no statutes behind "hey".
  if (state === 'greeting') {
    return (
      <View style={styles.answer}>
        <Text style={styles.answerText}>{text}</Text>
      </View>
    );
  }

  if (state === 'done') {
    return (
      <View style={styles.answer}>
        <Cited text={text} onOpen={(c) => onOpen(c, '')} />
        <Text style={styles.answerFoot}>
          Every statute this is based on is listed below. Not legal advice.
        </Text>
      </View>
    );
  }

  // Fallback: the hand-written rules, which is what the app showed before.
  if (activity) return <Curated activity={activity} onOpen={onOpen} />;
  return null;
}

// Deterministic, and kept whatever else happens: this is hand-tagged data, not
// a guess, so it sits above the written answer rather than inside it.
function Verdict({
  activity,
  signals,
  age,
}: {
  activity: Activity;
  signals: Set<string>;
  age: number | null;
}) {
  const tooYoung = (r: Rule) =>
    r.minAge !== undefined && age !== null && age < r.minAge;
  const conflicts = activity.rules.filter(
    (r) => r.brokenBy?.some((b) => signals.has(b)) || tooYoung(r)
  );
  if (!conflicts.length) return null;

  return (
    <View>
      {conflicts.length > 0 ? (
        <View style={styles.verdict}>
          <Text style={styles.verdictLabel}>THIS LOOKS LIKE A PROBLEM</Text>
          {conflicts.map((r) => (
            <View key={`v-${r.id}`}>
              <Text style={styles.verdictText}>{r.text}</Text>
              {tooYoung(r) ? (
                <Text style={styles.verdictIf}>
                  You said {age}. This one needs {r.minAge}.
                </Text>
              ) : null}
              {r.appliesIf ? (
                <Text style={styles.verdictIf}>Applies if: {r.appliesIf}</Text>
              ) : null}
              <Text style={styles.verdictCite}>{r.citation}</Text>
            </View>
          ))}
          <Text style={styles.verdictFoot}>
            Based on what you described. Read the rest before you decide, and
            remember this is not legal advice.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// Fallback only. When there is no written answer available - no key, no
// network, quota gone - the hand-written rules still carry the topic.
function Curated({
  activity,
  onOpen,
}: {
  activity: Activity;
  onOpen: (citation: string, url: string) => void;
}) {
  return (
    <View style={styles.hero}>
      <Text style={styles.heroLabel}>WHAT YOU NEED TO KNOW</Text>
      <Text style={styles.heroTitle}>{activity.displayName}</Text>
      <Text style={styles.heroSummary}>{activity.summary}</Text>

      {activity.rules.map((r) => (
        <View key={r.id} style={styles.rule}>
          <View style={styles.ruleRow}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.ruleText}>{r.text}</Text>
          </View>
          {r.appliesIf ? (
            <Text style={styles.ruleIf}>Only if: {r.appliesIf}</Text>
          ) : null}
          <View style={styles.ruleFoot}>
            <Pressable
              onPress={() => onOpen(r.citation, r.sourceUrl)}
              accessibilityRole="button"
              accessibilityLabel={`Read ${r.citation}`}
              hitSlop={6}
            >
              <Text style={styles.ruleCite}>{r.citation} ›</Text>
            </Pressable>
            {r.confidence === 'ambiguous' ? (
              <Text style={styles.ruleFlag}>NOT SETTLED</Text>
            ) : null}
          </View>
        </View>
      ))}

      <Text style={styles.heroFoot}>
        Written by hand against the statute text and last checked{' '}
        {activity.lastVerified}. State law only, and it does not cover city or
        county rules.
      </Text>
    </View>
  );
}

// One bar across every screen. The leaf is the About affordance, which keeps
// identity and navigation in the same strip instead of spending a headline on
// the app's own name every time you look at it.
function Nav({ onAbout, onBack }: { onAbout: () => void; onBack?: () => void }) {
  return (
    <View style={styles.nav}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          style={styles.navBack}
          accessibilityRole="button"
          accessibilityLabel="Clear search and return home"
        >
          <Text style={styles.navBackText}>←</Text>
        </Pressable>
      ) : (
        <View style={styles.navBack} />
      )}

      <Pressable
        onPress={onAbout}
        style={styles.navBrand}
        accessibilityRole="button"
        accessibilityLabel="About Sage"
      >
        <Image
          source={require('./assets/splash-icon.png')}
          style={styles.navMark}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <Text style={styles.navWordmark}>Sage</Text>
      </Pressable>

      <View style={styles.navBack} />
    </View>
  );
}

// Required on every view that shows statute content. Not dismissible.
function Disclaimer() {
  return (
    <View style={styles.disclaimer}>
      <Text style={styles.disclaimerText}>
        Not legal advice · Statute text captured {META.generated}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------- styles

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },

  topbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12,
  },
  backBtn: { minHeight: 44, justifyContent: 'center', paddingRight: 16, marginLeft: -4 },
  backText: { color: C.accent, fontSize: 16, fontWeight: '600' },

  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingTop: 4, paddingBottom: 6,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  navBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  navBackText: { color: C.accent, fontSize: 22, fontWeight: '600' },
  navBrand: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    minHeight: 44, paddingHorizontal: 8,
  },
  navMark: { width: 24, height: 24 },
  navWordmark: {
    color: C.ink, fontSize: T.xl, fontWeight: '700', letterSpacing: 0.2,
    fontFamily: F.read,
  },

  // The empty space above the box on the home screen, and the results list once
  // there is one. Both take the same slot so the composer below never moves.
  fill: { flex: 1 },

  // Box pinned to the bottom, suggestions stacked directly on top of it, where
  // a thumb reaches them without covering what you are typing.
  composer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  chips: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10,
  },
  chip: {
    backgroundColor: C.accentSoft, borderRadius: 16,
    paddingHorizontal: 13, paddingVertical: 8,
  },
  chipText: { color: C.accent, fontSize: T.sm, fontWeight: '600', fontFamily: F.ui },
  input: {
    backgroundColor: C.card, borderRadius: 26, paddingHorizontal: 20,
    paddingVertical: 15, fontSize: T.lg, borderWidth: 1, borderColor: C.line,
    color: C.ink, fontFamily: F.read,
    shadowColor: '#2A3327', shadowOpacity: 0.07, shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },

  list: { paddingHorizontal: 16, paddingBottom: 24 },

  cardPoint: { flexDirection: 'row', gap: 7, marginTop: 10 },

  answer: {
    backgroundColor: C.card, borderRadius: 18, padding: 20, marginBottom: 22,
    borderWidth: 1, borderColor: C.line,
    // A soft lift instead of a hard outline. The old card was four 1px borders
    // fighting each other.
    shadowColor: '#2A3327', shadowOpacity: 0.06, shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  answerLead: {
    color: C.ink, fontSize: T.lg, lineHeight: 26, fontFamily: F.read,
    fontWeight: '600', marginBottom: 12,
  },
  answerText: {
    flex: 1, color: C.ink, fontSize: T.base, lineHeight: 22, fontFamily: F.read,
  },
  bulletRow: { flexDirection: 'row', gap: 9, marginBottom: 8 },
  bulletDot: {
    color: C.accent, fontSize: T.base, lineHeight: 22, fontWeight: '700',
  },
  citeChip: {
    color: C.accentDeep, fontSize: T.sm, fontWeight: '700', fontFamily: F.ui,
    backgroundColor: C.accentSoft, paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: 5, overflow: 'hidden',
  },
  answerFoot: {
    color: C.faint, fontSize: T.xs, lineHeight: 17, marginTop: 16,
    borderTopWidth: 1, borderTopColor: C.line, paddingTop: 11,
    fontFamily: F.ui,
  },
  answerWait: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 26,
    justifyContent: 'center',
  },
  answerWaitText: { color: C.muted, fontSize: T.base, fontFamily: F.ui },

  explain: { marginTop: 18 },
  explainBtn: {
    borderWidth: 1, borderColor: C.accent, borderRadius: 12, minHeight: 44,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14,
  },
  explainBtnText: { color: C.accent, fontSize: 14, fontWeight: '700' },
  explainRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  explainWait: { color: C.muted, fontSize: 13, lineHeight: 19 },
  explainText: { color: C.ink, fontSize: T.base, lineHeight: 24, fontFamily: F.read },
  explainFoot: {
    color: C.muted, fontSize: 11.5, lineHeight: 17, marginTop: 10,
    borderTopWidth: 1, borderTopColor: C.line, paddingTop: 9,
  },
  points: {
    backgroundColor: C.accentSoft, borderRadius: 12, padding: 14, marginTop: 18,
    borderLeftWidth: 3, borderLeftColor: C.accent,
  },
  pointsLabel: {
    color: C.accent, fontSize: 10, fontWeight: '800', letterSpacing: 0.9,
    marginBottom: 10,
  },
  pointRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  pointMark: {
    color: C.accent, fontSize: 13, fontWeight: '800', lineHeight: 20,
    minWidth: 12,
  },
  pointText: { flex: 1, color: C.ink, fontSize: T.base, lineHeight: 23, fontFamily: F.read },
  pointsFoot: {
    color: C.muted, fontSize: 11.5, lineHeight: 17, marginTop: 4,
    borderTopWidth: 1, borderTopColor: '#DDE3DA', paddingTop: 9,
  },

  // The curated answer. Sage field and a left rule so it reads as OUR writing,
  // clearly separated from the verbatim statute cards below it.
  hero: {
    backgroundColor: C.accentSoft, borderRadius: 14, padding: 16,
    marginBottom: 22, borderLeftWidth: 3, borderLeftColor: C.accent,
  },
  // The verdict. Amber, not red: this is "you have run into a rule", not a
  // prediction that you will be arrested.
  verdict: {
    backgroundColor: C.warnSoft, borderRadius: 10, padding: 13, marginBottom: 14,
    borderLeftWidth: 3, borderLeftColor: C.warn,
  },
  verdictLabel: {
    color: C.warn, fontSize: 10, fontWeight: '800', letterSpacing: 0.9,
    marginBottom: 7,
  },
  verdictText: { color: C.ink, fontSize: T.base, lineHeight: 23, fontWeight: '600', fontFamily: F.read },
  verdictIf: { color: C.muted, fontSize: 12.5, lineHeight: 18, marginTop: 5, fontStyle: 'italic' },
  verdictCite: { color: C.warn, fontSize: 12.5, fontWeight: '700', marginTop: 6 },
  verdictFoot: {
    color: C.muted, fontSize: 11.5, lineHeight: 17, marginTop: 10,
    borderTopWidth: 1, borderTopColor: '#E7D9BC', paddingTop: 8,
  },
  heroLabel: {
    color: C.accent, fontSize: 10, fontWeight: '800', letterSpacing: 0.9,
  },
  heroTitle: {
    color: C.ink, fontSize: 19, fontWeight: '700', marginTop: 6,
    lineHeight: 25,
  },
  heroSummary: { color: C.ink, fontSize: T.base, lineHeight: 23, marginTop: 10, fontFamily: F.read },
  rule: {
    marginTop: 14, borderTopWidth: 1, borderTopColor: '#DDE3DA', paddingTop: 12,
  },
  ruleRow: { flexDirection: 'row', gap: 8 },
  bullet: { color: C.accent, fontSize: 14, lineHeight: 21, fontWeight: '800' },
  ruleText: { flex: 1, color: C.ink, fontSize: T.base, lineHeight: 23, fontFamily: F.read },
  ruleIf: {
    color: C.muted, fontSize: 12.5, lineHeight: 18, marginTop: 6,
    marginLeft: 16, fontStyle: 'italic',
  },
  ruleFoot: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8,
    marginLeft: 16,
  },
  ruleCite: { color: C.accentDeep, fontSize: 12.5, fontWeight: '700' },
  ruleFlag: {
    color: C.warn, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6,
    backgroundColor: C.warnSoft, paddingHorizontal: 6, paddingVertical: 3,
    borderRadius: 5, overflow: 'hidden',
  },
  heroFoot: {
    color: C.muted, fontSize: 11.5, lineHeight: 17, marginTop: 16,
    borderTopWidth: 1, borderTopColor: '#DDE3DA', paddingTop: 10,
  },
  listLabel: {
    color: C.faint, fontSize: 10, fontWeight: '800', letterSpacing: 0.9,
    marginLeft: 2, marginBottom: 6,
  },
  count: { color: C.faint, fontSize: T.sm, marginBottom: 14, marginLeft: 2, fontFamily: F.ui },

  card: {
    backgroundColor: C.card, borderRadius: 16, padding: 18, marginBottom: 12,
    borderWidth: 1, borderColor: C.line,
  },
  cardTop: { borderColor: C.accent, borderWidth: 1.5 },
  bestLabel: {
    color: C.accent, fontSize: 10, fontWeight: '800', letterSpacing: 0.9,
    marginBottom: 6,
  },
  heading: {
    color: C.ink, fontSize: T.lg, lineHeight: 25, fontFamily: F.read,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8,
  },
  citation: { color: C.accent, fontWeight: '700', fontSize: 13 },
  chapterTag: {
    color: C.faint, fontSize: 11, textTransform: 'uppercase', flexShrink: 1,
    letterSpacing: 0.3,
  },
  flag: { fontSize: 12, color: C.muted, fontWeight: '600', marginTop: 8 },
  flagWarn: { color: C.warn },
  preview: {
    marginTop: 10, color: C.muted, fontSize: T.sm, lineHeight: 21,
    fontFamily: F.read,
  },
  tapFor: { marginTop: 10, color: C.faint, fontSize: 13, fontStyle: 'italic' },

  detail: { paddingHorizontal: 20, paddingBottom: 40 },
  detailCitation: { color: C.accent, fontSize: 15, fontWeight: '800' },
  detailHeading: {
    color: C.ink, fontSize: T.xl, fontWeight: '700', lineHeight: 29,
    marginTop: 8, fontFamily: F.read,
  },
  detailChapter: {
    color: C.faint, fontSize: 12, marginTop: 8, textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailFlag: {
    backgroundColor: C.warnSoft, borderRadius: 8, paddingHorizontal: 12,
    paddingVertical: 4, marginTop: 14, alignSelf: 'flex-start',
  },
  detailBody: {
    color: C.ink, fontSize: T.base, lineHeight: 26, marginTop: 20,
    fontFamily: F.read,
  },
  detailMissing: {
    color: C.muted, fontSize: 15, lineHeight: 23, marginTop: 18,
    fontStyle: 'italic',
  },
  sourceBtn: {
    backgroundColor: C.accent, borderRadius: 12, minHeight: 48,
    alignItems: 'center', justifyContent: 'center', marginTop: 24,
  },
  sourceBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  captured: { color: C.faint, fontSize: 12, lineHeight: 18, marginTop: 16 },

  aboutTitle: { color: C.ink, fontSize: T.xxl, fontWeight: '700', fontFamily: F.read },
  aboutH: {
    color: C.accent, fontSize: 13, fontWeight: '800', marginTop: 24,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  aboutBody: { color: C.ink, fontSize: T.base, lineHeight: 25, marginTop: 10, fontFamily: F.read },

  disclaimer: {
    borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card,
    paddingHorizontal: 20, paddingVertical: 9,
  },
  disclaimerText: { color: C.faint, fontSize: 11, textAlign: 'center' },
});
