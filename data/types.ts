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
