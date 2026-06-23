// Formula engine (web-sheet.md §2). Pure, deterministic, token 0. A1 refs + rectangular ranges,
// arithmetic/comparison/concat operators, and the v1 function set. No volatile functions, so grading
// is reproducible. Errors propagate as #REF!/#DIV/0!/#NAME?/#VALUE!/#CYCLE.

export type CellRef = string; // "A1"
export type CellError = { error: string };
export type CellValue = number | string | boolean | CellError;
export type Grid = Record<CellRef, string>; // raw cell content: literal or "=formula"

const isErr = (v: CellValue): v is CellError => typeof v === "object" && v !== null && "error" in v;

// ── A1 references ──────────────────────────────────────────────────────────────

const A1_RE = /^([A-Z]+)([0-9]+)$/;

function colToNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n; // A=1
}
function numToCol(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function parseRef(ref: string): { col: number; row: number } | null {
  const m = A1_RE.exec(ref);
  if (!m) return null;
  return { col: colToNum(m[1]), row: parseInt(m[2], 10) };
}
function expandRange(a: string, b: string): CellRef[] {
  const pa = parseRef(a);
  const pb = parseRef(b);
  if (!pa || !pb) return [];
  const out: CellRef[] = [];
  const c0 = Math.min(pa.col, pb.col), c1 = Math.max(pa.col, pb.col);
  const r0 = Math.min(pa.row, pb.row), r1 = Math.max(pa.row, pb.row);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(numToCol(c) + r);
  return out;
}

// ── Tokenizer ──────────────────────────────────────────────────────────────────

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "ref"; v: string }
  | { t: "range"; a: string; b: string }
  | { t: "name"; v: string }
  | { t: "op"; v: string }
  | { t: "lp" } | { t: "rp" } | { t: "comma" };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const s = src;
  const isWs = (c: string) => c === " " || c === "\t";
  while (i < s.length) {
    const c = s[i];
    if (isWs(c)) { i++; continue; }
    if (c === '"') {
      let j = i + 1, buf = "";
      while (j < s.length && s[j] !== '"') { buf += s[j]; j++; }
      toks.push({ t: "str", v: buf }); i = j + 1; continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++;
      toks.push({ t: "num", v: parseFloat(s.slice(i, j)) }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      const word = s.slice(i, j).toUpperCase(); i = j;
      // a cell ref or range, else a function/name
      if (A1_RE.test(word)) {
        if (s[i] === ":") {
          let k = i + 1; while (k < s.length && /[A-Za-z0-9]/.test(s[k])) k++;
          const b = s.slice(i + 1, k).toUpperCase();
          if (A1_RE.test(b)) { toks.push({ t: "range", a: word, b }); i = k; continue; }
        }
        toks.push({ t: "ref", v: word }); continue;
      }
      if (word === "TRUE" || word === "FALSE") { toks.push({ t: "bool", v: word === "TRUE" }); continue; }
      toks.push({ t: "name", v: word }); continue;
    }
    if (c === "(") { toks.push({ t: "lp" }); i++; continue; }
    if (c === ")") { toks.push({ t: "rp" }); i++; continue; }
    if (c === ",") { toks.push({ t: "comma" }); i++; continue; }
    // operators (two-char first)
    const two = s.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") { toks.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/^&=<>".includes(c)) { toks.push({ t: "op", v: c }); i++; continue; }
    throw { error: "#NAME?" };
  }
  return toks;
}

// ── Parser (recursive descent) → AST ─────────────────────────────────────────────

type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "ref"; v: string }
  | { k: "range"; a: string; b: string }
  | { k: "bin"; op: string; l: Node; r: Node }
  | { k: "neg"; e: Node }
  | { k: "call"; name: string; args: Node[] };

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}
  peek(): Tok | undefined { return this.toks[this.i]; }
  next(): Tok { return this.toks[this.i++]; }
  expr(): Node { return this.comparison(); }
  comparison(): Node {
    let n = this.concat();
    while (this.isOp(["=", "<>", "<", "<=", ">", ">="])) { const op = (this.next() as any).v; n = { k: "bin", op, l: n, r: this.concat() }; }
    return n;
  }
  concat(): Node {
    let n = this.additive();
    while (this.isOp(["&"])) { this.next(); n = { k: "bin", op: "&", l: n, r: this.additive() }; }
    return n;
  }
  additive(): Node {
    let n = this.term();
    while (this.isOp(["+", "-"])) { const op = (this.next() as any).v; n = { k: "bin", op, l: n, r: this.term() }; }
    return n;
  }
  term(): Node {
    let n = this.power();
    while (this.isOp(["*", "/"])) { const op = (this.next() as any).v; n = { k: "bin", op, l: n, r: this.power() }; }
    return n;
  }
  power(): Node {
    let n = this.unary();
    while (this.isOp(["^"])) { this.next(); n = { k: "bin", op: "^", l: n, r: this.unary() }; }
    return n;
  }
  unary(): Node {
    if (this.isOp(["-"])) { this.next(); return { k: "neg", e: this.unary() }; }
    if (this.isOp(["+"])) { this.next(); return this.unary(); }
    return this.primary();
  }
  primary(): Node {
    const t = this.peek();
    if (!t) throw { error: "#VALUE!" };
    if (t.t === "num") { this.next(); return { k: "num", v: t.v }; }
    if (t.t === "str") { this.next(); return { k: "str", v: t.v }; }
    if (t.t === "bool") { this.next(); return { k: "bool", v: t.v }; }
    if (t.t === "ref") { this.next(); return { k: "ref", v: t.v }; }
    if (t.t === "range") { this.next(); return { k: "range", a: t.a, b: t.b }; }
    if (t.t === "lp") { this.next(); const e = this.expr(); if (this.peek()?.t !== "rp") throw { error: "#VALUE!" }; this.next(); return e; }
    if (t.t === "name") {
      this.next();
      if (this.peek()?.t !== "lp") throw { error: "#NAME?" };
      this.next();
      const args: Node[] = [];
      if (this.peek()?.t !== "rp") {
        args.push(this.expr());
        while (this.peek()?.t === "comma") { this.next(); args.push(this.expr()); }
      }
      if (this.peek()?.t !== "rp") throw { error: "#VALUE!" };
      this.next();
      return { k: "call", name: t.v, args };
    }
    throw { error: "#VALUE!" };
  }
  isOp(ops: string[]): boolean { const t = this.peek(); return !!t && t.t === "op" && ops.includes(t.v); }
}

// ── Evaluator ────────────────────────────────────────────────────────────────────

const num = (v: CellValue): number => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") { if (v === "") return 0; const n = Number(v); if (Number.isNaN(n)) throw { error: "#VALUE!" }; return n; }
  throw v; // error propagates
};
const str = (v: CellValue): string => {
  if (isErr(v)) throw v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
};

export function evaluateSheet(grid: Grid): Record<CellRef, CellValue> {
  const cache: Record<CellRef, CellValue> = {};
  const visiting = new Set<CellRef>();

  function cellValue(ref: CellRef): CellValue {
    if (ref in cache) return cache[ref];
    if (visiting.has(ref)) return { error: "#CYCLE" };
    const raw = grid[ref];
    if (raw === undefined || raw === "") return cache[ref] = "";
    if (!raw.startsWith("=")) {
      // literal: number if parseable, else string; TRUE/FALSE → boolean
      const t = raw.trim();
      if (t === "TRUE") return cache[ref] = true;
      if (t === "FALSE") return cache[ref] = false;
      const n = Number(t);
      return cache[ref] = (t !== "" && !Number.isNaN(n)) ? n : raw;
    }
    visiting.add(ref);
    let result: CellValue;
    try {
      const ast = new Parser(tokenize(raw.slice(1))).expr();
      result = evalNode(ast);
    } catch (e: any) {
      result = isErr(e) ? e : { error: "#VALUE!" };
    }
    visiting.delete(ref);
    return cache[ref] = result;
  }

  function refValues(refs: CellRef[]): CellValue[] { return refs.map(cellValue); }

  function evalNode(n: Node): CellValue {
    switch (n.k) {
      case "num": return n.v;
      case "str": return n.v;
      case "bool": return n.v;
      case "ref": return cellValue(n.v);
      case "range": throw { error: "#VALUE!" }; // a bare range is only valid inside a function arg
      case "neg": return -num(evalNode(n.e));
      case "bin": return evalBin(n.op, n.l, n.r);
      case "call": return evalCall(n.name, n.args);
    }
  }

  function evalBin(op: string, ln: Node, rn: Node): CellValue {
    const l = evalNode(ln), r = evalNode(rn);
    if (isErr(l)) return l; if (isErr(r)) return r;
    switch (op) {
      case "+": return num(l) + num(r);
      case "-": return num(l) - num(r);
      case "*": return num(l) * num(r);
      case "/": { const d = num(r); if (d === 0) return { error: "#DIV/0!" }; return num(l) / d; }
      case "^": return Math.pow(num(l), num(r));
      case "&": return str(l) + str(r);
      case "=": return looseEq(l, r);
      case "<>": return !looseEq(l, r);
      case "<": return num(l) < num(r);
      case "<=": return num(l) <= num(r);
      case ">": return num(l) > num(r);
      case ">=": return num(l) >= num(r);
      default: return { error: "#NAME?" };
    }
  }

  function looseEq(a: CellValue, b: CellValue): boolean {
    if (typeof a === "number" || typeof b === "number") { try { return num(a) === num(b); } catch { return str(a) === str(b); } }
    return str(a) === str(b);
  }

  // collect numeric values from args (refs, ranges, literals); ranges/refs flattened
  function argNums(args: Node[]): number[] {
    const out: number[] = [];
    for (const a of args) {
      if (a.k === "range") { for (const v of refValues(expandRange(a.a, a.b))) { if (isErr(v)) throw v; if (v !== "" && !(typeof v === "string" && Number.isNaN(Number(v)))) out.push(num(v)); } }
      else { const v = evalNode(a); if (isErr(v)) throw v; if (v !== "") out.push(num(v)); }
    }
    return out;
  }
  function argCells(args: Node[]): CellValue[] {
    const out: CellValue[] = [];
    for (const a of args) {
      if (a.k === "range") out.push(...refValues(expandRange(a.a, a.b)));
      else out.push(evalNode(a));
    }
    return out;
  }

  function evalCall(name: string, args: Node[]): CellValue {
    try {
      switch (name) {
        case "SUM": return argNums(args).reduce((a, b) => a + b, 0);
        case "AVERAGE": { const ns = argNums(args); if (!ns.length) return { error: "#DIV/0!" }; return ns.reduce((a, b) => a + b, 0) / ns.length; }
        case "MIN": { const ns = argNums(args); return ns.length ? Math.min(...ns) : 0; }
        case "MAX": { const ns = argNums(args); return ns.length ? Math.max(...ns) : 0; }
        case "COUNT": return argNums(args).length;
        case "COUNTA": return argCells(args).filter((v) => v !== "" && !isErr(v)).length;
        case "IF": { const c = evalNode(args[0]); if (isErr(c)) return c; return truthy(c) ? evalNode(args[1]) : (args[2] ? evalNode(args[2]) : false); }
        case "AND": return argCells(args).every((v) => truthy(v));
        case "OR": return argCells(args).some((v) => truthy(v));
        case "NOT": return !truthy(evalNode(args[0]));
        case "ROUND": { const x = num(evalNode(args[0])); const d = args[1] ? num(evalNode(args[1])) : 0; const f = Math.pow(10, d); return Math.round(x * f) / f; }
        case "ABS": return Math.abs(num(evalNode(args[0])));
        case "MOD": { const a = num(evalNode(args[0])); const b = num(evalNode(args[1])); if (b === 0) return { error: "#DIV/0!" }; return ((a % b) + b) % b; }
        case "INT": return Math.floor(num(evalNode(args[0])));
        case "LEN": return str(evalNode(args[0])).length;
        case "CONCAT": return argCells(args).map((v) => str(v)).join("");
        case "LEFT": { const s = str(evalNode(args[0])); const k = args[1] ? num(evalNode(args[1])) : 1; return s.slice(0, k); }
        case "RIGHT": { const s = str(evalNode(args[0])); const k = args[1] ? num(evalNode(args[1])) : 1; return k <= 0 ? "" : s.slice(-k); }
        case "TRIM": return str(evalNode(args[0])).trim();
        case "UPPER": return str(evalNode(args[0])).toUpperCase();
        case "LOWER": return str(evalNode(args[0])).toLowerCase();
        case "SUMIF": { const rng = args[0]; const crit = str(evalNode(args[1])); if (rng.k !== "range") return { error: "#VALUE!" }; const cells = refValues(expandRange(rng.a, rng.b)); let sum = 0; cells.forEach((v) => { if (isErr(v)) throw v; if (matchCrit(v, crit)) sum += num(v); }); return sum; }
        case "COUNTIF": { const rng = args[0]; const crit = str(evalNode(args[1])); if (rng.k !== "range") return { error: "#VALUE!" }; const cells = refValues(expandRange(rng.a, rng.b)); return cells.filter((v) => !isErr(v) && matchCrit(v, crit)).length; }
        default: return { error: "#NAME?" };
      }
    } catch (e: any) {
      return isErr(e) ? e : { error: "#VALUE!" };
    }
  }

  function truthy(v: CellValue): boolean {
    if (isErr(v)) throw v;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    return v !== "" && v.toUpperCase() !== "FALSE";
  }
  function matchCrit(v: CellValue, crit: string): boolean {
    const c = crit.trim();
    const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(c)!;
    const op = m[1] || "="; const rhs = m[2];
    const rn = Number(rhs);
    if (!Number.isNaN(rn) && typeof v === "number") {
      switch (op) { case "=": return v === rn; case "<>": return v !== rn; case "<": return v < rn; case "<=": return v <= rn; case ">": return v > rn; case ">=": return v >= rn; }
    }
    const sv = str(v);
    return op === "<>" ? sv !== rhs : sv === rhs;
  }

  // evaluate every non-empty cell
  for (const ref of Object.keys(grid)) cellValue(ref);
  return cache;
}

// Format a CellValue for display/compare.
export function formatValue(v: CellValue): string {
  if (isErr(v)) return v.error;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
  return v;
}
