export type Jurisdiction = "NV" | "Clark" | "LasVegas" | "Henderson";

export type Rule = {
  id: string;
  text: string;
  citation: string;
  sourceUrl: string;
  jurisdiction: Jurisdiction;
  appliesIf?: string;
  confidence: "clear" | "ambiguous";
};

export type Activity = {
  id: string;
  displayName: string;
  keywords: string[];
  summary: string;
  rules: Rule[];
  lastVerified: string; // ISO date, e.g. "2026-09-03"
};

// ---------------------------------------------------------------------------
// Full-corpus tier. Added 2026-08-12 for the pivot away from the 8-activity cap.
// Activity/Rule above are the CURATED tier and are unchanged. Nothing breaks.
// ---------------------------------------------------------------------------

// One section of the Nevada Revised Statutes, scraped and parsed at build time.
// Every field except the `plain*` ones is derived mechanically from the source
// HTML. The plain* fields are generated once at build time and committed, never
// produced at runtime.
export type StatuteSection = {
  id: string;           // "NRS-484B.130"
  citation: string;     // "NRS 484B.130"
  chapter: string;      // "484B"
  chapterTitle: string; // "RULES OF THE ROAD"
  heading: string;      // "Obedience to traffic-control devices."
  text: string;         // verbatim statute text, whitespace-normalized
  sourceUrl: string;    // ...NRS-484B.html#NRS484BSec130

  // Chapter pages ship BOTH versions of a section when an amendment is pending.
  // 68 such markers appeared in NRS 484B alone. Shipping the wrong one as live
  // law is the single worst correctness failure available to us, so it is typed,
  // not left implicit.
  status: "active" | "repealed";
  effective?: {
    label: string;     // "Effective through December 31, 2026"
    isCurrent: boolean;
  };

  // Build-time generated. Absent until the plain-language pass has run.
  plain?: string;         // one 8th-grade sentence
  plainKeywords?: string[];
  userFacing?: boolean;   // triage: false for agency/procedural/definitional

  scrapedAt: string;      // ISO date
};

// The plain-language to legal-language bridge. This is the hand-written layer
// that makes keyword search over raw statute text usable, and it is the main
// human job on the data side.
export type ConceptEntry = {
  id: string;
  colloquial: string[]; // "quad", "four-wheeler", "dirtbike", "side-by-side"
  statutory: string[];  // "off-highway vehicle"
  chapters: string[];   // ["490"] — used to boost ranking, not to filter
};
