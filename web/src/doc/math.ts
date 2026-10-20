// Formula typesetting (CP-1): TeX in a "$$" block or an inline "\( \)" becomes MathML through KaTeX.
//
// KaTeX is imported on the first formula only, so a page without one never downloads it. MathML
// output needs no KaTeX font or CSS files: the browser draws it, which keeps the kit working offline
// and keeps vite's fixed asset names (vite.config.ts) from colliding over a dozen font files.
// Until KaTeX answers, or if it never does, the element keeps showing the raw TeX it was built with.

import type katexType from "katex";

type Katex = typeof katexType;

/** Class on an element whose text is TeX waiting to be typeset. */
export const MATH_CLASS = "lh-math";
const DONE = "lh-math--done";
const BUSY = "lh-math--busy";

let loading: Promise<Katex | null> | null = null;
let settled: Promise<void> = Promise.resolve();

function loadKatex(): Promise<Katex | null> {
  if (!loading) loading = import("katex").then((m) => (m.default ?? m) as Katex).catch(() => null);
  return loading;
}

/** Typeset every pending math element in `root` (root included). Display mode comes from `data-display`. */
export function typesetMath(root: HTMLElement): Promise<void> {
  const nodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>("." + MATH_CLASS))]
    .filter((n) => n.classList.contains(MATH_CLASS) && !n.classList.contains(DONE) && !n.classList.contains(BUSY));
  if (!nodes.length) return settled;
  // Claim the nodes and read their TeX now: a nested render may reach the same node before KaTeX loads.
  const jobs = nodes.map((n) => { n.classList.add(BUSY); return { n, tex: n.textContent ?? "", display: n.dataset["display"] === "1" }; });
  const run = loadKatex().then((katex) => {
    for (const { n, tex, display } of jobs) {
      n.classList.remove(BUSY);
      if (!katex) continue;
      n.innerHTML = katex.renderToString(tex, { displayMode: display, output: "mathml", throwOnError: false, strict: "ignore" });
      n.classList.add(DONE);
    }
  });
  settled = Promise.all([settled, run]).then(() => undefined);
  return settled;
}

/** Resolves once every typesetting started so far has finished. */
export function mathSettled(): Promise<void> {
  return settled;
}
