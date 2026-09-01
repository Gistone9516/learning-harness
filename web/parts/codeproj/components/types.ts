// Explanation component catalog: the shapes an AI answer may be built from.
//
// An answer is a list of blocks rather than one lump of prose, so it can be skimmed, so a mention
// of a code location becomes something you can click, and so the same lens always looks the same.
// Type keys are short (`t`) because they travel in every generated answer.
//
// Adding a component means: a type here, a renderer in render.ts, and a line in catalog.ts. No
// other file needs to change.

/** A place in the project. Renderers turn this into something clickable. */
export interface CodeRef {
  path: string;
  lines?: [number, number];
  note?: string;
}

// ── skeleton ──────────────────────────────────────────────────────────────────

export interface LeadBlock { t: "lead"; text: string }
export interface AnswerBlock { t: "answer"; text: string }
export interface TextBlock { t: "text"; text: string }
export interface ListBlock { t: "list"; items: string[] }
export interface StepsBlock { t: "steps"; items: { title: string; text?: string }[] }

// ── code-linked ───────────────────────────────────────────────────────────────

export interface RefBlock { t: "ref"; path: string; lines?: [number, number]; note?: string }
export interface FocusBlock { t: "focus"; lines: [number, number]; note?: string }
export interface SignatureBlock {
  t: "signature";
  sig: string;
  params?: { name: string; desc: string }[];
  returns?: string;
}
export interface IoBlock { t: "io"; input: string; output: string }
export interface CallsBlock { t: "calls"; callers?: CodeRef[]; callees?: CodeRef[] }
export interface FlowBlock {
  t: "flow";
  items: { title: string; text?: string; path?: string; lines?: [number, number] }[];
}
export interface AltBlock {
  t: "alt";
  current: { title: string; text: string };
  other: { title: string; text: string };
}

// ── concepts ──────────────────────────────────────────────────────────────────

/** The four-part concept shape: definition, general use, industry practice, use in this project. */
export interface ConceptBlock {
  t: "concept";
  name: string;
  definition: string;
  general: string;
  industry: string;
  here: string;
}
export interface TagBlock { t: "tag"; names: string[] }
export interface TermsBlock { t: "terms"; items: { term: string; def: string }[] }
export interface CompareBlock { t: "compare"; headers: string[]; rows: string[][] }
export interface CautionBlock { t: "caution"; text: string }
export interface WhyBlock { t: "why"; decision: string; reason: string }

// ── learning aids ─────────────────────────────────────────────────────────────

export interface QuizBlock { t: "quiz"; items: { q: string; a: string }[] }
export interface FinditBlock { t: "findit"; q: string; answer: CodeRef; hint?: string }
export interface NextBlock { t: "next"; items: { label: string; path?: string; lines?: [number, number] }[] }
export interface RelatedBlock { t: "related"; items: CodeRef[] }

// ── trust ─────────────────────────────────────────────────────────────────────

/** Marks a claim as read off the code, with the location that backs it. */
export interface EvidenceBlock { t: "evidence"; text: string; path?: string; lines?: [number, number] }
/** Marks a claim the model could not confirm. Guards against invented specifics. */
export interface UncertainBlock { t: "uncertain"; text: string }

export type Block =
  | LeadBlock | AnswerBlock | TextBlock | ListBlock | StepsBlock
  | RefBlock | FocusBlock | SignatureBlock | IoBlock | CallsBlock | FlowBlock | AltBlock
  | ConceptBlock | TagBlock | TermsBlock | CompareBlock | CautionBlock | WhyBlock
  | QuizBlock | FinditBlock | NextBlock | RelatedBlock
  | EvidenceBlock | UncertainBlock;

export type BlockType = Block["t"];

/** Every type the renderer knows. Anything else degrades to plain text (never dropped silently). */
export const KNOWN_BLOCKS: BlockType[] = [
  "lead", "answer", "text", "list", "steps",
  "ref", "focus", "signature", "io", "calls", "flow", "alt",
  "concept", "tag", "terms", "compare", "caution", "why",
  "quiz", "findit", "next", "related",
  "evidence", "uncertain",
];

/** An answer as the model returns it. */
export interface Composed {
  blocks: Block[];
}
