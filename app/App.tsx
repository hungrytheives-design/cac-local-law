import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Linking,
  Pressable,
  SafeAreaView,
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

const ACCENT = '#1B4965';
// Deliberately colloquial. These only work because of the lexicon.
const EXAMPLES = ['dirtbike', 'jetski', 'helmet', 'texting while driving'];

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'for', 'or', 'and',
  'on', 'is', 'are', 'can', 'i', 'my', 'do', 'need', 'what', 'me', 'you']);

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

// The plain-English to legal-English bridge. Nobody types "off-highway vehicle",
// they type "dirtbike". Without this the app can only find statutes you already
// know the legal name of, which defeats the point.
function expand(tokens: string[], raw: string) {
  const terms = new Set<string>();
  const chapters = new Set<string>();
  const q = raw.toLowerCase();

  for (const c of CONCEPTS) {
    const hit = c.colloquial.some((term) =>
      term.includes(' ') ? q.includes(term) : tokens.includes(term)
    );
    if (!hit) continue;
    // Keep statutory phrases WHOLE. Splitting "off-highway vehicle" into its
    // words matched 4,922 sections including "Use of may, must, shall", because
    // "all" and "vehicle" appear all over the code. The phrase is the signal.
    for (const phrase of c.statutory) terms.add(flat(phrase));
    for (const ch of c.chapters) chapters.add(ch);
  }
  return { terms: [...terms], chapters };
}

// Hyphens vary between the lexicon and the statute text, so flatten both sides.
function flat(s: string): string {
  return s.toLowerCase().replace(/[-\s]+/g, ' ').trim();
}

function search(query: string): Section[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
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
  return scored.slice(0, 40).map((x) => x.s);
}

export default function App() {
  const [query, setQuery] = useState('');
  const results = useMemo(() => search(query), [query]);
  const searching = tokenize(query).length > 0;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.title}>Nevada law lookup</Text>
        <Text style={styles.subtitle}>
          {META.sections.toLocaleString()} statutes across {META.chapters} chapters,
          searched on your phone with no internet
        </Text>
      </View>

      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder="What do you want to do?"
        placeholderTextColor="#8A9BA8"
        autoCorrect={false}
        accessibilityLabel="Search Nevada statutes"
      />

      {!searching && (
        <View style={styles.chips}>
          {EXAMPLES.map((e) => (
            <Pressable key={e} style={styles.chip} onPress={() => setQuery(e)}>
              <Text style={styles.chipText}>{e}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {searching && (
        <Text style={styles.count}>
          {results.length === 0
            ? 'No statute matched. Try different words.'
            : `${results.length} matching statute${results.length === 1 ? '' : 's'}`}
        </Text>
      )}

      <FlatList
        data={results}
        keyExtractor={(s) => s.i}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => Linking.openURL(item.u)}>
            <Text style={styles.citation}>{item.c}</Text>
            <Text style={styles.heading}>{item.h}</Text>
            {item.e ? (
              <Text style={styles.flag}>
                {item.ec === 1 ? 'In force now: ' : 'Not yet in force: '}
                {item.e}
              </Text>
            ) : null}
            {item.t ? (
              <Text style={styles.body} numberOfLines={4}>
                {item.t}
              </Text>
            ) : (
              <Text style={styles.tapFor}>Tap to read the full text</Text>
            )}
            <Text style={styles.link}>{CHAPTER_TITLES[item.ch]}</Text>
          </Pressable>
        )}
      />

      {/* Not dismissible. Required by the blueprint on every result view. */}
      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          Not legal advice. Statute text from leg.state.nv.us, captured{' '}
          {META.generated}. Always confirm against the linked source.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F4F7F9' },
  header: { backgroundColor: ACCENT, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18 },
  title: { color: '#fff', fontSize: 26, fontWeight: '700' },
  subtitle: { color: '#C6D8E4', fontSize: 13, marginTop: 4, lineHeight: 18 },
  input: {
    margin: 16, marginBottom: 8, backgroundColor: '#fff', borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 17,
    borderWidth: 1, borderColor: '#D6E0E8', color: '#10232E',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 8 },
  chip: {
    backgroundColor: '#E3ECF2', borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 9, minHeight: 44, justifyContent: 'center',
  },
  chipText: { color: ACCENT, fontWeight: '600', fontSize: 14 },
  count: { paddingHorizontal: 20, paddingVertical: 6, color: '#5A7183', fontSize: 13 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: '#E2EAF0',
  },
  citation: { color: ACCENT, fontWeight: '700', fontSize: 15 },
  heading: { color: '#10232E', fontSize: 15, marginTop: 4, lineHeight: 21 },
  flag: { marginTop: 6, fontSize: 12, color: '#8A5A00', fontWeight: '600' },
  body: { marginTop: 8, color: '#4A5C68', fontSize: 13, lineHeight: 19 },
  tapFor: { marginTop: 8, color: '#7A8B98', fontSize: 13, fontStyle: 'italic' },
  link: { marginTop: 10, color: '#5A7183', fontSize: 11, textTransform: 'uppercase' },
  disclaimer: { backgroundColor: '#10232E', paddingHorizontal: 20, paddingVertical: 12 },
  disclaimerText: { color: '#B9C9D4', fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
