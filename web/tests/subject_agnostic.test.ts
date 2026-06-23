// Guardrail (web-contract.md §0.1 / §8): kit web code (src, parts) must contain NO subject literal.
// Mirrors bot/tests/test_subject_agnostic.py — same deny-list of subject vocabulary. Generic UI strings
// (채점/정답/오답 등) are allowed; only subject-specific terms are banned. Scope = kit SOURCE only
// (examples/ dev fixtures and *.test.ts excluded). A necessary check, not sufficient.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WEB_ROOT = join(import.meta.dirname, "..");
const DENY = ["영어", "영작", "토익", "토플", "단어", "문법", "숙어"];
const SCAN = ["src", "parts"];
const SKIP = new Set(["node_modules", "dist", "examples"]);

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("web kit subject-agnostic guard", () => {
  it("kit web source (src, parts) contains no subject literal", () => {
    const hits: string[] = [];
    for (const base of SCAN) {
      for (const f of tsFiles(join(WEB_ROOT, base))) {
        readFileSync(f, "utf-8").split("\n").forEach((line, i) => {
          for (const t of DENY) if (line.includes(t)) hits.push(`${relative(WEB_ROOT, f)}:${i + 1} [${t}]`);
        });
      }
    }
    expect(hits).toEqual([]);
  });
});
