import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Linking,
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

// ---------------------------------------------------------------------- theme

// Sage and cream. Nevada is the Sagebrush State and "sage" also means wise
// counsel. Keep in sync with PALETTE in data/scripts/make_icons.py, which
// generates the app icon from these same values.
const C = {
  bg: '#F2EDE1',       // cream, matches the icon and splash background
  card: '#FBF9F3',
  ink: '#22271E',      // warm near-black, never pure #000 on cream
  muted: '#5D6656',
  faint: '#8B9382',
  line: '#E3DDCD',
  accent: '#5E7351',   // sage
  accentDeep: '#43542F',
  accentSoft: '#E7E6D4',
  warn: '#8A5A00',
  warnSoft: '#F6EBD6',
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
      const ts = stem(term);
      if (ts.length < 4) return false;
      return stems.some((s) => s.startsWith(ts) || ts.startsWith(s));
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

// NOTE: data/scripts/test_search.py is a hand port of everything below. If you
// change ranking here, change it there in the same sitting or the tests lie.
function search(query: string): { hits: Section[]; total: number } {
  const tokens = tokenize(query);
  if (!tokens.length) return { hits: [], total: 0 };
  const { terms, chapters } = expand(tokens, query);

  const scored: { s: Section; score: number }[] = [];
  for (const s of SECTIONS) {
    let score = 0;
    const heading = s.h.toLowerCase();

    for (const t of tokens) {
      // Heading matches are worth far more than body matches. Without this,
      // a tax provision that happens to say "bicycle" outranks the actual
      // bicycle statute.
      if (heading.includes(t)) score += 10;
      if (s.k.some((k) => k.startsWith(t))) score += 6;
      if ((CHAPTER_TITLES[s.ch] || '').toLowerCase().includes(t)) score += 2;
      if (s.t && s.t.toLowerCase().includes(t)) score += 1;
    }

    // Lexicon-derived phrases score lower than what the user actually typed, so
    // a literal match always beats an inferred one.
    const flatHeading = flat(s.h);
    for (const t of terms) {
      if (flatHeading.includes(t)) score += 8;
      if (s.t && flat(s.t).includes(t)) score += 2;
    }

    // Chapter hint is a boost, never a filter, so a wrong lexicon entry degrades
    // ranking instead of hiding real law.
    if (score > 0 && chapters.has(s.ch)) score += 8;

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

// ----------------------------------------------------------------------- views

type Screen =
  | { kind: 'search' }
  | { kind: 'detail'; section: Section }
  | { kind: 'about' };

export default function App() {
  const [query, setQuery] = useState('');
  const [screen, setScreen] = useState<Screen>({ kind: 'search' });
  const { hits, total } = useMemo(() => search(query), [query]);
  const searching = tokenize(query).length > 0;

  if (screen.kind === 'detail') {
    return (
      <Detail section={screen.section} onBack={() => setScreen({ kind: 'search' })} />
    );
  }
  if (screen.kind === 'about') {
    return <About onBack={() => setScreen({ kind: 'search' })} />;
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />

      <View style={styles.topbar}>
        <View>
          <Text style={styles.wordmark}>Sage</Text>
          <Text style={styles.tagline}>Nevada law, offline</Text>
        </View>
        <Pressable
          onPress={() => setScreen({ kind: 'about' })}
          style={styles.aboutBtn}
          accessibilityRole="button"
          accessibilityLabel="About this app"
        >
          <Text style={styles.aboutBtnText}>About</Text>
        </Pressable>
      </View>

      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder="What are you planning to do?"
        placeholderTextColor={C.faint}
        autoCorrect={false}
        accessibilityLabel="Describe what you are planning to do"
      />

      {!searching && (
        <ScrollView contentContainerStyle={styles.examples}>
          <Text style={styles.sectionLabel}>Try describing a plan</Text>
          {EXAMPLES.map((e) => (
            <Pressable
              key={e}
              style={styles.example}
              onPress={() => setQuery(e)}
              accessibilityRole="button"
              accessibilityLabel={`Search: ${e}`}
            >
              <Text style={styles.exampleText}>{e}</Text>
              <Text style={styles.exampleArrow}>→</Text>
            </Pressable>
          ))}
          <Text style={styles.blurb}>
            {META.sections.toLocaleString()} Nevada statutes are stored in this app.
            Searching works with no internet connection.
          </Text>
        </ScrollView>
      )}

      {searching && (
        <FlatList
          data={hits}
          keyExtractor={(s) => s.i}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Text style={styles.count}>
              {total === 0
                ? 'Nothing matched. Try different words.'
                : total > SHOWN
                ? `Closest ${SHOWN} of ${total}. Add detail to narrow it down.`
                : `${total} match${total === 1 ? '' : 'es'}`}
            </Text>
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
                {item.h}
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
              {item.t ? (
                <Text style={styles.preview} numberOfLines={3}>
                  {bodyOf(item)}
                </Text>
              ) : (
                <Text style={styles.tapFor}>Tap to open the official text</Text>
              )}
            </Pressable>
          )}
        />
      )}

      <Disclaimer />
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
  wordmark: { color: C.accent, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  tagline: { color: C.faint, fontSize: 12, marginTop: 1 },
  aboutBtn: {
    minHeight: 44, justifyContent: 'center', paddingHorizontal: 12,
    marginRight: -12,
  },
  aboutBtnText: { color: C.accent, fontSize: 15, fontWeight: '600' },
  backBtn: { minHeight: 44, justifyContent: 'center', paddingRight: 16, marginLeft: -4 },
  backText: { color: C.accent, fontSize: 16, fontWeight: '600' },

  input: {
    marginHorizontal: 16, marginBottom: 12, backgroundColor: C.card,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 17,
    borderWidth: 1, borderColor: C.line, color: C.ink,
  },

  examples: { paddingHorizontal: 16, paddingBottom: 24 },
  sectionLabel: {
    color: C.faint, fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
    textTransform: 'uppercase', marginBottom: 10, marginLeft: 2,
  },
  example: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.accentSoft, borderRadius: 12, paddingHorizontal: 16,
    minHeight: 48, marginBottom: 8,
  },
  exampleText: {
    color: C.accent, fontWeight: '600', fontSize: 15, flexShrink: 1,
    paddingVertical: 13,
  },
  exampleArrow: { color: C.accent, fontSize: 16, opacity: 0.45, paddingLeft: 12 },
  blurb: {
    color: C.faint, fontSize: 13, lineHeight: 19, marginTop: 20,
    marginHorizontal: 2,
  },

  list: { paddingHorizontal: 16, paddingBottom: 24 },
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
