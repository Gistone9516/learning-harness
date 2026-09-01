import { describe, it, expect } from "vitest";
import { highlightCode, normLang } from "./highlight";

describe("highlightCode", () => {
  it("maps language aliases", () => {
    expect(normLang("py")).toBe("python");
    expect(normLang("Python")).toBe("python");
    expect(normLang("C++")).toBe("c");
    expect(normLang("SQL")).toBe("sql");
    expect(normLang("typescript")).toBe("ts");
    expect(normLang("golang")).toBe("go");
    expect(normLang("brainfuck")).toBe("text");
  });

  it("infers the language from a file path, which is all a project file carries", () => {
    expect(normLang("app/service.py")).toBe("python");
    expect(normLang("src/hooks/useBoard.ts")).toBe("ts");
    expect(normLang("cmd/main.go")).toBe("go");
    expect(normLang("config.yaml")).toBe("yaml");
    expect(normLang("Makefile")).toBe("text");
  });

  it("escapes HTML so code content cannot inject markup", () => {
    const out = highlightCode("a < b && c > d", "c");
    expect(out).toContain("&lt;");
    expect(out).toContain("&gt;");
    expect(out).toContain("&amp;&amp;");
    expect(out).not.toContain("<b>");
  });

  it("colors python keywords, builtins, strings, comments, numbers", () => {
    const out = highlightCode('def f():\n    print("hi")  # note\n    return 42', "python");
    expect(out).toContain('<span class="tok-k">def</span>');
    expect(out).toContain('<span class="tok-b">print</span>');
    expect(out).toContain('<span class="tok-s">"hi"</span>');
    expect(out).toContain('<span class="tok-c"># note</span>');
    expect(out).toContain('<span class="tok-n">42</span>');
    expect(out).toContain('<span class="tok-k">return</span>');
  });

  it("matches SQL keywords case-insensitively and highlights functions", () => {
    const out = highlightCode("select count(*) from t where x = 1", "sql");
    expect(out).toContain('<span class="tok-k">select</span>');
    expect(out).toContain('<span class="tok-b">count</span>');
    expect(out).toContain('<span class="tok-n">1</span>');
  });

  it("treats a call identifier as a function", () => {
    const out = highlightCode("foo(1)", "java");
    expect(out).toContain('<span class="tok-f">foo</span>');
  });

  it("returns escaped plain text for unknown languages", () => {
    // A wrong colour is worse than none, so anything unrecognised stays plain.
    expect(highlightCode("x < 1", "brainfuck")).toBe("x &lt; 1");
    expect(highlightCode("x < 1")).toBe("x &lt; 1");
  });

  it("covers the languages generated projects actually use", () => {
    expect(highlightCode("const x = 1;", "ts")).toContain('<span class="tok-k">const</span>');
    expect(highlightCode("func main() {}", "go")).toContain('<span class="tok-k">func</span>');
    expect(highlightCode("let mut v = 1;", "rust")).toContain('<span class="tok-k">let</span>');
    expect(highlightCode("# title", "yaml")).toContain('<span class="tok-c">');
  });

  it("keeps a python docstring in one string span", () => {
    const out = highlightCode('"""대출 도메인 규칙"""\nx = 1', "python");
    expect(out).toContain('<span class="tok-s">"""대출 도메인 규칙"""</span>');
  });
});
