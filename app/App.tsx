import { StatusBar } from 'expo-status-bar';
import { useDeferredValue, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import index from './assets/nrs-index.json';
import concepts from './assets/concepts.json';
import activities from './assets/activities.json';

// Every section is searchable. Only `t` (verbatim text) is selective, because
// carrying full text for all of NRS would be ~150 MB. See data/scripts/build_index.py
type Section = {
  i: string;
  c: string;  // citation, "NRS 484B.130"
  h: string;  // heading
  u: string;  // source URL
  k: string[];// keywords
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
type Cached = { h: string; fh: string; t: string | null; ft: string | null };
let CACHE: { sections: Cached[]; chapters: Record<string, string> } | null = null;

function cached() {
  if (!CACHE) {
    const chapters: Record<string, string> = {};
    for (const ch of Object.keys(CHAPTER_TITLES)) {
      chapters[ch] = CHAPTER_TITLES[ch].toLowerCase();
    }
    CACHE = {
      chapters,
      sections: SECTIONS.map((s) => ({
        h: s.h.toLowerCase(),
        fh: flat(s.h),
        t: s.t ? s.t.toLowerCase() : null,
        ft: s.t ? flat(s.t) : null,
      })),
    };
  }
  return CACHE;
}

// NOTE: data/scripts/test_search.py is a hand port of everything below. If you
// change ranking here, change it there in the same sitting or the tests lie.
function search(query: string): { hits: Section[]; total: number } {
  const tokens = tokenize(query);
  if (!tokens.length) return { hits: [], total: 0 };
  const { terms, chapters } = expand(tokens, query);
  const { sections: lc, chapters: lcChapter } = cached();

  const scored: { s: Section; score: number }[] = [];
  for (let i = 0; i < SECTIONS.length; i++) {
    const s = SECTIONS[i];
    const c = lc[i];
    let score = 0;

    for (const t of tokens) {
      // Heading matches are worth far more than body matches. Without this,
      // a tax provision that happens to say "bicycle" outranks the actual
      // bicycle statute.
      if (c.h.includes(t)) score += 10;
      if (s.k.some((k) => k.startsWith(t))) score += 6;
      if (lcChapter[s.ch] && lcChapter[s.ch].includes(t)) score += 2;
      if (c.t && c.t.includes(t)) score += 1;
    }

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

    if (s.r) score -= 20;                    // repealed, bury it
    if (s.e && s.ec === 0) score -= 15;      // not yet in force
    if (score > 0) scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return { hits: scored.slice(0, SHOWN).map((x) => x.s), total: scored.length };
}

// Statute text repeats its own citation and heading before the body. Showing
// that again under a heading we already rendered wastes the first screenful.
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

  // Scanning 49,742 sections on every keystroke stuttered badly on a real
  // phone. Deferring means the box stays live under your thumb and the results
  // catch up a frame later, instead of the keyboard fighting the search.
  const settled = useDeferredValue(query);
  const { hits, total } = useMemo(() => search(settled), [settled]);
  const hero = useMemo(() => matchActivity(settled), [settled]);
  const signals = useMemo(() => detectSignals(settled), [settled]);
  const age = useMemo(() => detectAge(settled), [settled]);
  const searching = tokenize(settled).length > 0;

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
        onBack={searching ? () => setQuery('') : undefined}
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
                  <Hero
                    activity={hero}
                    signals={signals}
                    age={age}
                    onOpen={(citation, url) => {
                      // Prefer our own reader so the statute opens in the app
                      // with its in-force flags; fall back to the official
                      // site only if the section is not in the index.
                      const s = SECTIONS.find((x) => x.c === citation);
                      if (s) setScreen({ kind: 'detail', section: s });
                      else Linking.openURL(url);
                    }}
                  />
                ) : null}
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
                  onPress={() => setQuery(e)}
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
          onPress={() => Linking.openURL(section.u)}
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
function Hero({
  activity,
  signals,
  age,
  onOpen,
}: {
  activity: Activity;
  signals: Set<string>;
  age: number | null;
  onOpen: (citation: string, url: string) => void;
}) {
  // Rules the person's own description runs into. Not a prediction about what
  // happens to them, just: you said X, and this rule says X is the problem.
  const tooYoung = (r: Rule) =>
    r.minAge !== undefined && age !== null && age < r.minAge;
  const conflicts = activity.rules.filter(
    (r) => r.brokenBy?.some((b) => signals.has(b)) || tooYoung(r)
  );

  return (
    <View style={styles.hero}>
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
  navMark: { width: 20, height: 20 },
  navWordmark: {
    color: C.ink, fontSize: 17, fontWeight: '700', letterSpacing: -0.3,
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
    backgroundColor: C.accentSoft, borderRadius: 14,
    paddingHorizontal: 11, paddingVertical: 7,
  },
  chipText: { color: C.accent, fontSize: 12.5, fontWeight: '600' },
  input: {
    backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 16,
    paddingVertical: 14, fontSize: 17, borderWidth: 1, borderColor: C.line,
    color: C.ink,
  },

  list: { paddingHorizontal: 16, paddingBottom: 24 },

  cardPoint: { flexDirection: 'row', gap: 7, marginTop: 10 },
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
  pointText: { flex: 1, color: C.ink, fontSize: 14, lineHeight: 20 },
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
  verdictText: { color: C.ink, fontSize: 14.5, lineHeight: 21, fontWeight: '600' },
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
  heroSummary: { color: C.ink, fontSize: 14.5, lineHeight: 21, marginTop: 8 },
  rule: {
    marginTop: 14, borderTopWidth: 1, borderTopColor: '#DDE3DA', paddingTop: 12,
  },
  ruleRow: { flexDirection: 'row', gap: 8 },
  bullet: { color: C.accent, fontSize: 14, lineHeight: 21, fontWeight: '800' },
  ruleText: { flex: 1, color: C.ink, fontSize: 14, lineHeight: 21 },
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
  count: { color: C.muted, fontSize: 13, marginBottom: 12, marginLeft: 2 },

  card: {
    backgroundColor: C.card, borderRadius: 14, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: C.line,
  },
  cardTop: { borderColor: C.accent, borderWidth: 1.5 },
  bestLabel: {
    color: C.accent, fontSize: 10, fontWeight: '800', letterSpacing: 0.9,
    marginBottom: 6,
  },
  heading: { color: C.ink, fontSize: 16, fontWeight: '600', lineHeight: 22 },
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
  preview: { marginTop: 10, color: C.muted, fontSize: 13, lineHeight: 20 },
  tapFor: { marginTop: 10, color: C.faint, fontSize: 13, fontStyle: 'italic' },

  detail: { paddingHorizontal: 20, paddingBottom: 40 },
  detailCitation: { color: C.accent, fontSize: 15, fontWeight: '800' },
  detailHeading: {
    color: C.ink, fontSize: 20, fontWeight: '700', lineHeight: 27, marginTop: 6,
  },
  detailChapter: {
    color: C.faint, fontSize: 12, marginTop: 8, textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailFlag: {
    backgroundColor: C.warnSoft, borderRadius: 8, paddingHorizontal: 12,
    paddingVertical: 4, marginTop: 14, alignSelf: 'flex-start',
  },
  detailBody: { color: C.ink, fontSize: 15, lineHeight: 24, marginTop: 18 },
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

  aboutTitle: { color: C.ink, fontSize: 26, fontWeight: '800' },
  aboutH: {
    color: C.accent, fontSize: 13, fontWeight: '800', marginTop: 24,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  aboutBody: { color: C.ink, fontSize: 15, lineHeight: 23, marginTop: 8 },

  disclaimer: {
    borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card,
    paddingHorizontal: 20, paddingVertical: 9,
  },
  disclaimerText: { color: C.faint, fontSize: 11, textAlign: 'center' },
});
