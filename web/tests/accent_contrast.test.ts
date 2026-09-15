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

/**
 * Split a stylesheet into `{ selector, body }` for every top-level rule.
 *
 * Comments go first. Left in, a comment above a rule became part of its selector, so the hover
 * check below compared "<comment> #app .x" with "#app .x:hover" and silently skipped every
 * commented rule -- measured 2026-09-15 by deleting the hover background from two such buttons:
 * neither was reported until the comments were stripped.
 */
function rules(css: string): { selector: string; body: string }[] {
  const bare = css
    .split("/*")
    .map((part, i) => (i === 0 ? part : part.slice(part.indexOf("*/") + 2)))
    .join("");
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bare))) out.push({ selector: m[1].trim(), body: m[2] });
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

describe("a restyled button restates its background on every state", () => {
  // `#app button:hover { background: var(--lh-primary-strong) }` is the kit's default. A rule that
  // repaints a button at rest but changes only the border or the opacity on :hover leaves the
  // background to fall through to that default, and the control floods with the accent under the
  // pointer. Measured 2026-09-04: the archive row's title hit 1.89:1 and its delete icon 1.33:1
  // exactly when the pointer arrived — which is when that icon is supposed to become visible.
  /** Only the part this instance mounts. See the recorded gap below for why the rest is not swept. */
  const CODEPROJ = /lh-codeproj|archive|scrap|note-|confirm-|summary-toggle|depth-|entry-|concept-|load-|launcher-|cp-back|head-row/;

  it("has no :hover rule that repaints a codeproj button without setting its background", () => {
    const all = rules(CSS).filter((r) => CODEPROJ.test(r.selector));
    const painted = new Set(
      all
        .filter((r) => /background(-color)?:/.test(r.body) && !/:hover|:active|:focus/.test(r.selector))
        .flatMap((r) => r.selector.split(",").map((s) => s.trim())),
    );
    const leaks = all
      .filter((r) => /:hover/.test(r.selector))
      .filter((r) => !/background(-color)?:/.test(r.body))
      .flatMap((r) => r.selector.split(",").map((s) => s.trim()))
      .filter((s) => s.includes(":hover"))
      .filter((s) => painted.has(s.replace(/:hover/g, "").trim()));
    expect(leaks).toEqual([]);
  });

  it("still leaks on conceptprob's own controls, and says so", () => {
    // Ten of them. Fixing those changes how the sibling instance looks on hover, which is not a
    // thing to do quietly inside a round about this instance's delete button. Recorded so a green
    // suite is not read as "no button floods anywhere".
    const all = rules(CSS).filter((r) => !CODEPROJ.test(r.selector));
    const painted = new Set(
      all
        .filter((r) => /background(-color)?:/.test(r.body) && !/:hover|:active|:focus/.test(r.selector))
        .flatMap((r) => r.selector.split(",").map((s) => s.trim())),
    );
    const leaks = all
      .filter((r) => /:hover/.test(r.selector))
      .filter((r) => !/background(-color)?:/.test(r.body))
      .flatMap((r) => r.selector.split(",").map((s) => s.trim()))
      .filter((s) => s.includes(":hover"))
      .filter((s) => painted.has(s.replace(/:hover/g, "").trim()));
    expect(leaks.length).toBeGreaterThan(0);
  });
});
