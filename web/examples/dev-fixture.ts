// Dev-only fixtures for `npm run dev` preview. NOT kit content — a consuming instance injects its own
// AppConfig (globalThis.LH_CONFIG). Lives under examples/, excluded from the subject-agnostic guard.
// Switch part by URL hash: #sheet (default) or #conceptprob (pre-baked, offline — no ai_server).
import type { AppConfig } from "../src/shell";
import type { SheetProblem } from "../parts/sheet/sheet";
import type { GeneratedConcept } from "../parts/conceptprob/conceptprob";

const demoSheet: SheetProblem = {
  problem_id: "demo-sheet-sum",
  prompt: "A1:A4의 합을 B1에 SUM 함수로 구하세요.",
  grid: { rows: 4, cols: 2, cells: { A1: "1", A2: "2", A3: "3", A4: "10" } },
  editable: ["B1"],
  target: ["B1"],
  expected: { B1: "16" },
  require_formula: ["B1"],
};

const sheetConfig: AppConfig = { part: "sheet", data: demoSheet };

// Pre-baked concept (verified content) — renders + grades with no AI to exercise the offline path.
const demoConcept: GeneratedConcept = {
  area: "fundamentals",
  concept_id: "variables",
  title: "변수와 자료형",
  body: [
    "변수는 값에 **이름을 붙여 저장**하는 공간이다. 프로그램은 이 이름으로 값을 읽고 바꾼다.",
    "",
    "## 기본 자료형",
    "자주 쓰는 자료형은 다음과 같다.",
    "",
    "| 자료형 | 예시 | 설명 |",
    "|---|---|---|",
    "| 정수 | `3` | 소수점 없는 수 |",
    "| 문자열 | `\"hello\"` | 글자의 나열 |",
    "| 불리언 | `true` | 참 또는 거짓 |",
    "",
    "## 선언 예시",
    "아래는 상수와 변수를 선언하는 코드다.",
    "",
    "```js",
    "const pi = 3.14;   // 다시 못 바꿈",
    "let count = 0;     // 바꿀 수 있음",
    "count = count + 1;",
    "```",
    "",
    "- `const` 다음으로 선언하면 재할당이 막힌다.",
    "- `let` 다음으로 선언하면 값을 바꿀 수 있다.",
  ].join("\n"),
  problems: [
    {
      card_id: "demo-exact",
      type: "func",
      grade_mode: "exact",
      front: { prompt: "재할당을 막는 선언 키워드는? (소문자)" },
      answer_spec: { normalize: ["nfkc", "trim", "lower"], accepted: ["const"] },
      links: { concept_ref: "variables" },
    },
    {
      card_id: "demo-code",
      type: "func",
      grade_mode: "exact",
      front: {
        prompt: "다음 코드가 출력하는 값은?",
        code: "let count = 0;\ncount = count + 2;\nconsole.log(count);",
        lang: "js",
      },
      answer_spec: { normalize: ["nfkc", "trim"], accepted: ["2"] },
      links: { concept_ref: "선언-예시" },
    },
  ],
};

const conceptprobConfig: AppConfig = {
  part: "conceptprob",
  // No `ai`: pre-baked concepts only, fully offline.
  data: {
    areas: [{ key: "fundamentals", label: "기초" }],
    conceptOutline: { fundamentals: [{ concept_id: "variables", title: "변수와 자료형" }] },
    concepts: { variables: demoConcept },
    subjectKey: "demo",
  },
};

const part = (typeof location !== "undefined" ? location.hash.replace("#", "") : "") || "sheet";
export const devConfig: AppConfig = part === "conceptprob" ? conceptprobConfig : sheetConfig;
