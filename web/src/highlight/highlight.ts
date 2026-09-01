// Self-contained syntax highlighter shared by every part. Returns HTML with <span class="tok-*">
// wrappers; the input is raw source (this function escapes it). No external dependency — the kit
// ships offline, so a CDN highlighter is not an option, and a bundled one would dwarf the app.
//
// Token classes: k(keyword) b(builtin/type) s(string) c(comment) n(number) f(call).
// Scope is deliberate: enough languages to cover generated projects, and a plain fallback that is
// never wrong. A wrong colour is worse than no colour.

export type Lang =
  | "python" | "js" | "ts" | "go" | "java" | "c" | "csharp" | "ruby" | "php" | "rust"
  | "sql" | "json" | "yaml" | "shell" | "html" | "css" | "text";

const BY_EXT: Record<string, Lang> = {
  py: "python", pyi: "python",
  js: "js", jsx: "js", mjs: "js", cjs: "js",
  ts: "ts", tsx: "ts",
  go: "go",
  java: "java", kt: "java",              // Kotlin shares enough keywords to read correctly
  c: "c", h: "c", cpp: "c", cc: "c", hpp: "c",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  rs: "rust",
  sql: "sql",
  json: "json",
  yaml: "yaml", yml: "yaml",
  sh: "shell", bash: "shell", zsh: "shell",
  html: "html", htm: "html", vue: "html",
  css: "css", scss: "css", less: "css",
  md: "text", txt: "text",
};

const ALIASES: Record<string, Lang> = {
  py: "python", python: "python", python3: "python",
  javascript: "js", js: "js", node: "js", jsx: "js",
  typescript: "ts", ts: "ts", tsx: "ts",
  go: "go", golang: "go",
  java: "java", kotlin: "java",
  c: "c", "c++": "c", cpp: "c", h: "c",
  "c#": "csharp", csharp: "csharp", cs: "csharp",
  ruby: "ruby", rb: "ruby",
  php: "php",
  rust: "rust", rs: "rust",
  sql: "sql",
  json: "json",
  yaml: "yaml", yml: "yaml",
  shell: "shell", sh: "shell", bash: "shell",
  html: "html", css: "css", scss: "css",
};

/** Accepts a language name (`python`, `ts`) or a file path (`app/service.py`). */
export function normLang(langOrPath?: string): Lang {
  const raw = (langOrPath || "").trim().toLowerCase();
  if (!raw) return "text";
  if (ALIASES[raw]) return ALIASES[raw];
  const dot = raw.lastIndexOf(".");
  if (dot >= 0) {
    const ext = raw.slice(dot + 1);
    if (BY_EXT[ext]) return BY_EXT[ext];
  }
  // A bare filename with no extension (Makefile, Dockerfile) stays plain.
  return "text";
}

type Code = Exclude<Lang, "text">;

const COMMON_KW =
  "if else for while return break continue switch case default do try catch finally throw new class extends implements import export from as in of typeof instanceof null true false this super void const let var function static public private protected async await yield";

const KW: Record<Code, Set<string>> = {
  python: new Set(("def class return if elif else for while in not and or is None True False import from as with try except finally "
    + "raise lambda yield global nonlocal pass break continue del assert async await match case").split(" ")),
  js: new Set(COMMON_KW.split(" ").concat(["=>", "delete"])),
  ts: new Set(COMMON_KW.split(" ").concat(["interface", "type", "enum", "namespace", "declare", "readonly", "keyof", "satisfies", "abstract", "override"])),
  go: new Set(("package import func var const type struct interface map chan go defer select case switch default if else for range return break continue "
    + "fallthrough goto nil true false").split(" ")),
  java: new Set(("public private protected class interface extends implements static final void int long double float char boolean byte short new return "
    + "if else for while do switch case break continue default this super null true false import package try catch finally throw throws abstract "
    + "synchronized instanceof enum record var").split(" ")),
  c: new Set(("int char float double void long short unsigned signed struct union enum typedef const static return if else for while do switch case break "
    + "continue default sizeof goto extern register volatile auto inline bool true false NULL class public private protected namespace template new delete "
    + "this virtual override").split(" ")),
  csharp: new Set(COMMON_KW.split(" ").concat(["namespace", "using", "internal", "sealed", "override", "virtual", "struct", "readonly", "string", "int", "bool", "var", "record"])),
  ruby: new Set(("def end class module if elsif else unless while until for in do begin rescue ensure raise return yield self nil true false and or not "
    + "require require_relative attr_accessor attr_reader attr_writer lambda proc puts").split(" ")),
  php: new Set(COMMON_KW.split(" ").concat(["echo", "elseif", "endif", "foreach", "endforeach", "array", "isset", "unset", "namespace", "use", "fn", "global"])),
  rust: new Set(("fn let mut const static struct enum impl trait for while loop if else match return break continue use mod pub crate self super where "
    + "as dyn ref move box async await unsafe type true false Some None Ok Err").split(" ")),
  sql: new Set(("SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE DROP ALTER ADD COLUMN PRIMARY KEY FOREIGN REFERENCES JOIN INNER LEFT "
    + "RIGHT FULL OUTER CROSS ON USING GROUP BY ORDER HAVING AS AND OR NOT NULL IN LIKE BETWEEN IS DISTINCT UNION ALL INTERSECT EXCEPT INDEX VIEW DEFAULT "
    + "CHECK UNIQUE CONSTRAINT COMMIT ROLLBACK DESC ASC LIMIT OFFSET EXISTS CASE WHEN THEN ELSE END BEGIN DECLARE CASCADE WITH").split(" ")),
  json: new Set(["true", "false", "null"]),
  yaml: new Set(["true", "false", "null", "yes", "no", "on", "off"]),
  shell: new Set(("if then else elif fi for while do done case esac function return export local readonly set unset echo cd exit source alias").split(" ")),
  html: new Set(("html head body div span a p ul ol li table tr td th form input button script style link meta title header footer nav section article "
    + "main aside img class id href src").split(" ")),
  css: new Set(("import media supports keyframes from to important root hover focus active before after not nth-child").split(" ")),
};

const BUILTIN: Record<Code, Set<string>> = {
  python: new Set(("print len range int str float list dict set tuple input type sum min max sorted map filter enumerate zip abs open round bool bytes "
    + "self cls super isinstance getattr setattr hasattr format join split append property staticmethod classmethod").split(" ")),
  js: new Set(("console log Object Array String Number Boolean Promise Math JSON Date Map Set RegExp Error window document fetch require module exports "
    + "process length push pop map filter reduce forEach then catch").split(" ")),
  ts: new Set(("console log Object Array String Number Boolean Promise Math JSON Date Map Set Record Partial Pick Omit Readonly unknown any never string "
    + "number boolean object symbol bigint undefined").split(" ")),
  go: new Set(("fmt Println Printf Sprintf error string int int64 float64 bool byte rune make len cap append copy delete panic recover new nil "
    + "context http json").split(" ")),
  java: new Set(("System out err println print printf String Integer Double Boolean Math Object List ArrayList Map HashMap Optional Stream length main args "
    + "Exception RuntimeException").split(" ")),
  c: new Set(("printf scanf malloc calloc realloc free sizeof strlen strcpy strcmp memcpy main include define NULL std cout cin endl vector string").split(" ")),
  csharp: new Set(("Console WriteLine ReadLine String Int32 Double Boolean List Dictionary Task IEnumerable Exception Math").split(" ")),
  ruby: new Set(("puts print p require gets String Integer Float Array Hash Symbol nil new each map select reject reduce").split(" ")),
  php: new Set(("echo print var_dump count strlen str_replace implode explode array_map array_filter json_encode json_decode isset empty").split(" ")),
  rust: new Set(("String Vec Option Result Box Rc Arc HashMap HashSet println format vec panic unwrap expect iter collect map filter i32 i64 u32 u64 f64 usize bool str").split(" ")),
  sql: new Set(("COUNT SUM AVG MIN MAX ROUND UPPER LOWER SUBSTR SUBSTRING LENGTH TRIM COALESCE CAST NOW VARCHAR CHAR DATE DATETIME NUMBER DECIMAL BOOLEAN "
    + "TEXT TIMESTAMP INTEGER SERIAL ROW_NUMBER RANK OVER PARTITION").split(" ")),
  json: new Set([]),
  yaml: new Set([]),
  shell: new Set(("ls cd rm cp mv mkdir cat grep sed awk find chmod curl wget git npm python pip docker make sudo").split(" ")),
  html: new Set([]),
  css: new Set(("color background display flex grid margin padding border font width height position top left right bottom gap align justify").split(" ")),
};

/** Line-comment marker per language. */
const LINE_COMMENT: Record<Code, string | null> = {
  python: "#", js: "//", ts: "//", go: "//", java: "//", c: "//", csharp: "//", ruby: "#",
  php: "//", rust: "//", sql: "--", json: null, yaml: "#", shell: "#", html: null, css: null,
};

/** Languages whose keywords match regardless of case. */
const CASE_INSENSITIVE: Partial<Record<Code, boolean>> = { sql: true };

/** Languages that support /* … *​/ block comments. */
const BLOCK_COMMENT: Partial<Record<Code, boolean>> = {
  js: true, ts: true, go: true, java: true, c: true, csharp: true, php: true, rust: true, css: true, sql: true,
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Highlight `code` for `lang` (a language name or a file path).
 * Unknown language → escaped plain text, still monospaced by the surrounding <pre>.
 */
export function highlightCode(code: string, lang?: string): string {
  const L = normLang(lang);
  if (L === "text") return esc(code);

  const kw = KW[L];
  const bi = BUILTIN[L];
  const ci = !!CASE_INSENSITIVE[L];
  const lineC = LINE_COMMENT[L];
  const blockC = !!BLOCK_COMMENT[L];
  const n = code.length;
  const word = (c: string): boolean => /[A-Za-z0-9_]/.test(c);

  let out = "";
  let i = 0;
  while (i < n) {
    const c = code[i];

    if (lineC && code.startsWith(lineC, i)) {
      let j = code.indexOf("\n", i);
      if (j < 0) j = n;
      out += `<span class="tok-c">${esc(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    if (blockC && c === "/" && code[i + 1] === "*") {
      let j = code.indexOf("*/", i + 2);
      j = j < 0 ? n : j + 2;
      out += `<span class="tok-c">${esc(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    // Python triple-quoted strings, which are also its docstrings.
    if (L === "python" && (code.startsWith('"""', i) || code.startsWith("'''", i))) {
      const q = code.slice(i, i + 3);
      let j = code.indexOf(q, i + 3);
      j = j < 0 ? n : j + 3;
      out += `<span class="tok-s">${esc(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && code[j] !== c) {
        if (code[j] === "\\") j++;
        if (code[j] === "\n" && c !== "`") break;   // unterminated: stop at the line end
        j++;
      }
      j = Math.min(j + 1, n);
      out += `<span class="tok-s">${esc(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(code[i + 1] || ""))) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-FxXbBoO._]/.test(code[j])) j++;
      out += `<span class="tok-n">${esc(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    if (/[A-Za-z_@$]/.test(c)) {
      let j = i + 1;
      while (j < n && (word(code[j]) || code[j] === "$")) j++;
      const w = code.slice(i, j);
      const key = ci ? w.toUpperCase() : w;
      let k = j;
      while (k < n && /[ \t]/.test(code[k])) k++;
      const isCall = code[k] === "(";
      if (kw.has(key)) out += `<span class="tok-k">${esc(w)}</span>`;
      else if (bi.has(key)) out += `<span class="tok-b">${esc(w)}</span>`;
      else if (isCall) out += `<span class="tok-f">${esc(w)}</span>`;
      else out += esc(w);
      i = j;
      continue;
    }

    out += esc(c);
    i++;
  }
  return out;
}

/**
 * Highlight `code` and return one HTML string per line, with tags balanced inside each line.
 *
 * A viewer that renders one row per line cannot simply split highlightCode() on newlines: a
 * docstring or block comment spans several lines, so the split would leave an unclosed <span> on
 * one row and a stray </span> on another. Here any span still open at a line break is closed and
 * reopened on the next line, so every row is valid on its own.
 */
export function highlightLines(code: string, lang?: string): string[] {
  const html = highlightCode(code, lang);
  const lines: string[] = [];
  let open: string | null = null;      // class of the span currently open, if any
  let current = open ? "" : "";
  let i = 0;

  const flush = () => {
    lines.push(open ? current + "</span>" : current);
    current = open ? `<span class="${open}">` : "";
  };

  while (i < html.length) {
    if (html.startsWith("<span ", i)) {
      const end = html.indexOf(">", i);
      const m = /class="([^"]+)"/.exec(html.slice(i, end));
      open = m ? m[1] : null;
      current += html.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (html.startsWith("</span>", i)) {
      open = null;
      current += "</span>";
      i += 7;
      continue;
    }
    if (html[i] === "\n") {
      flush();
      i++;
      continue;
    }
    current += html[i];
    i++;
  }
  lines.push(open ? current + "</span>" : current);
  return lines;
}
