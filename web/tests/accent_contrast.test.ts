// A colour drawn on an accent fill must come from a token, never a literal.
//
// The defect this pins down was measured on 2026-09-04: `color: #fff` was hardcoded on
// `background: var(--lh-primary)` in fifteen rules. That works for a light palette, whose accent is
// dark enough to carry white — and fails for a dark one, whose accent is bright: white on
// Coding-GO's `#6aa2d8` is 2.70:1, under the 4.5 bar and under even the 3.0 one. The literal cannot
// flip, so no instance could fix it without restating fifteen selectors.
//
// The rule is narrow on purpose. Accent fills only: `--lh-ok`, `--lh-bad` and `--lh-amber-accent`
// still carry literals and still fail their own contrast (2.7, 3.1, 2.4 against white in that same
// palette). They are left for a round that can look at what those states should be, and they are
// listed here so the gap is recorded rather than implied.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(join(import.meta.dirname, "..", "src", "styles", "app.css"), "utf-8");
const TOKENS = readFileSync(join(import.meta.dirname, "..", "src", "styles", "tokens.css"), "utf-8");

/** Split a stylesheet into `{ selector, body }` for every top-level rule. */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

describe("text on an accent fill", () => {
  it("is a token, so a palette can decide it", () => {
    const bad = rules(CSS)
      .filter((r) => /background(-color)?:\s*var\(--lh-primary\)/.test(r.body))
      .filter((r) => /color:\s*#[0-9a-fA-F]{3,8}/.test(r.body))
      .map((r) => r.selector.replace(/\s+/g, " "));
    expect(bad).toEqual([]);
  });

  it("has a default that leaves every existing consumer looking the same", () => {
    // The token was introduced into a stylesheet whose every consumer said #fff. Defaulting to
    // anything else would have silently restyled an instance that never asked for the change.
    expect(TOKENS).toMatch(/--lh-on-primary:\s*#ffffff/i);
  });

  it("keeps the accent-fill token in use rather than quietly abandoned", () => {
    // A token nothing reads is the same as no token, and the literals creep back.
    expect(CSS.match(/var\(--lh-on-primary\)/g)?.length ?? 0).toBeGreaterThanOrEqual(15);
  });
});

describe("known gaps, recorded rather than implied", () => {
  it("still has literal white on the status fills", () => {
    // Not a pass: a statement of what this guard deliberately does not cover, so that a later
    // reading of a green suite does not mistake it for "every fill is safe".
    const status = rules(CSS)
      .filter((r) => /background(-color)?:\s*var\(--lh-(ok|bad|amber-accent)\)/.test(r.body))
      .filter((r) => /color:\s*#fff/i.test(r.body));
    expect(status.length).toBeGreaterThan(0);
  });
});
