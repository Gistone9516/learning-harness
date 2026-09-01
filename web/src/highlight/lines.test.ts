import { describe, it, expect } from "vitest";
import { highlightLines, highlightCode } from "./highlight";

/** Every row must be valid on its own: equal numbers of opening and closing span tags. */
function balanced(html: string): boolean {
  const open = (html.match(/<span /g) || []).length;
  const close = (html.match(/<\/span>/g) || []).length;
  return open === close;
}

describe("highlightLines", () => {
  it("returns one entry per line", () => {
    const lines = highlightLines("a = 1\nb = 2\nc = 3", "python");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("b");
  });

  it("keeps a multi-line docstring balanced on every row", () => {
    const src = '"""첫 줄\n둘째 줄\n"""\nx = 1';
    const lines = highlightLines(src, "python");

    expect(lines).toHaveLength(4);
    for (const line of lines) expect(balanced(line)).toBe(true);
    // The string colour continues across the rows rather than stopping at the first newline.
    expect(lines[0]).toContain('class="tok-s"');
    expect(lines[1]).toContain('class="tok-s"');
    expect(lines[2]).toContain('class="tok-s"');
    expect(lines[3]).not.toContain('class="tok-s"');
  });

  it("keeps a block comment balanced on every row", () => {
    const lines = highlightLines("/* one\n   two */\nconst x = 1;", "ts");
    for (const line of lines) expect(balanced(line)).toBe(true);
    expect(lines[0]).toContain('class="tok-c"');
    expect(lines[1]).toContain('class="tok-c"');
  });

  it("preserves the text content of each line", () => {
    const src = 'def f():\n    return "hi"';
    const stripped = highlightLines(src, "python").map((l) => l.replace(/<[^>]+>/g, ""));
    expect(stripped[0]).toBe("def f():");
    expect(stripped[1]).toBe("    return &quot;hi&quot;".replace("&quot;", '"').replace("&quot;", '"'));
  });

  it("handles an empty file and a trailing newline without losing rows", () => {
    expect(highlightLines("", "python")).toEqual([""]);
    expect(highlightLines("a\n", "python")).toHaveLength(2);
  });

  it("agrees with highlightCode once the rows are rejoined", () => {
    const src = 'x = "a"\n# note\ny = 2';
    const joined = highlightLines(src, "python").join("\n");
    expect(joined.replace(/<[^>]+>/g, "")).toBe(highlightCode(src, "python").replace(/<[^>]+>/g, ""));
  });
});
