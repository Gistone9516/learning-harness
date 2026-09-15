// Prompt layer for the codeproj part. Everything the AI is told lives here, separated from the
// view and from the transport, so wording is reviewable and testable in one place.
//
// Subject-agnostic: these strings describe explanation shape only. The repository and the learner's
// request always arrive as injected input, never as a literal in this file.

import { DOC_DIALECT } from "../../src/doc/doc";
import { CONCEPT_MAX, CONCEPT_MIN } from "./concepts";
import type { AskRequest, ExplainRequest, CodeProject, Lens, ReadingRequest, Scrap } from "./model";
import { buildComponentDirective } from "./components/catalog";

export const LENS_LABELS: Record<Lens, string> = {
  overview: "개요",
  libs_methods: "라이브러리/메서드",
  flow: "호출 흐름",
  modify_tip: "수정 포인트",
  concepts: "개념 해설",
};

export const LENS_ORDER: Lens[] = ["overview", "libs_methods", "flow", "modify_tip", "concepts"];

/**
 * The concept lens answers in a fixed four-part shape so a learner can connect a line of code to
 * the idea behind it and to how the industry uses that idea. The last clause is a hallucination
 * guard: generic, widely documented practice is wanted here, not invented specifics about a named
 * company.
 */
const CONCEPT_LENS_FORMAT = [
  "다음 네 부분을 순서대로, 각각 소제목을 붙여 작성하세요.",
  "1. 개념: 이 코드에 사용된 소프트웨어 개념과 설계 패턴의 정의",
  "2. 일반 응용: 그 개념이 보통 어떤 상황에서 쓰이는지",
  "3. 실무 사례: 업계에서 통용되는 사용 방식",
  "4. 이 프로젝트에서의 사용: 지금 이 코드에서 실제로 어떻게 구현되어 있는지",
  "실무 사례는 널리 알려진 일반적 관례 수준으로 쓰고, 확인되지 않은 특정 기업의 내부 구현을 단정하지 마세요.",
].join("\n");

/**
 * Who every explanation is written for.
 *
 * Stated once and shared by the annotation pass, the short answer and the full one, because a
 * level written in three places drifts apart and then nobody can tell which one is the real
 * one. The reader knows the language's syntax and has not seen these conventions before --
 * measured against the first real session, where answers leaned on `__exit__`, transaction
 * semantics and exception propagation as if already shared.
 */
export const AUDIENCE_CLAUSE = [
  "[읽는 사람]",
  "이 언어로 쓰인 코드는 읽을 수 있지만, 이 코드가 쓰는 관례와 설계 방식은 처음 봅니다.",
  "- 전문 용어를 쓰려면 그 자리에서 한 마디로 풀어 주세요. 풀지 않을 거면 쓰지 마세요.",
  "- 무엇을 하는지 먼저, 왜 그렇게 했는지는 그 다음입니다.",
  "- 다른 파일을 이미 읽었다고 전제하지 마세요. 함수나 클래스 이름을 들면 그것이 무엇인지 한 마디 붙입니다.",
  "- 한 문장에 개념 하나. 여러 개를 겹치면 이미 아는 사람만 읽힙니다.",
  "- 쉽게 쓰되 줄이지 마세요. 어려운 것을 생략하는 것이 아니라, 모르는 사람이 따라올 수 있게 적는 것입니다.",
].join("\n");
// ── 학습자 요청 ──────────────────────────────────────────────────────────────
//
// The learner's own words about why they are reading this repository and what to look at. Passed
// through untouched, like a question: rewriting them into a template would put this file's idea of
// what they meant between them and the model.

/**
 * The request as a prompt section, or "" when both boxes were left empty.
 *
 * Nothing rather than "(없음)": an empty heading still reads as an instruction, and for a request
 * that says nothing the reader level in AUDIENCE_CLAUSE is already the right answer.
 */
export function requestClause(req?: Pick<ReadingRequest, "goal" | "focus">): string {
  const goal = req?.goal.trim() ?? "";
  const focus = req?.focus.trim() ?? "";
  if (!goal && !focus) return "";
  const lines = ["[학습자 요청]"];
  if (goal) lines.push(`학습 목적과 수준: ${goal}`);
  if (focus) lines.push(`집중할 곳: ${focus}`);
  lines.push(
    "설명의 깊이와 강조점을 이 요청에 맞춘다. 수준을 밝혔으면 [읽는 사람]보다 이 요청을 따른다.",
    "집중할 곳과 닿는 부분은 더 자세히 쓰되, 닿지 않는 부분을 빼지는 않는다.",
  );
  return lines.join("\n");
}

/**
 * Choose which files to annotate before the learner is let in.
 *
 * A model call rather than a path match because `focus` is a sentence ("인증 흐름 위주"), not a
 * glob, and the session already holds the code that says which files that sentence is about. The
 * paths are listed verbatim so the answer can be compared as strings; `annotationOrder` drops
 * anything that is not on the list.
 */
export function buildFocusSystem(): string {
  return [
    "너는 학습자가 저장소를 읽기 시작하기 전에, 먼저 읽을 파일을 고른다.",
    "Do not create, write or edit any file, and do not call tools.",
    "",
    "[고르는 기준]",
    "- 학습자 요청에 가장 직접 닿는 파일을 먼저 고른다.",
    "- 요청이 흐름을 말하면, 그 흐름이 시작되는 진입점과 핵심 처리 파일을 함께 고른다.",
    "- 설정, 테스트, 문서는 요청이 그것을 가리킬 때만 고른다.",
    "- 아래 목록에 있는 경로만, 문자열 그대로 쓴다.",
    "",
    "[출력]",
    'JSON 하나만 출력한다. {"paths": ["경로"]}',
    "읽을 순서대로 늘어놓는다. 설명 문장이나 코드펜스 없이 JSON만 출력한다.",
  ].join("\n");
}

export function buildFocusPrompt(paths: string[], req: ReadingRequest, max: number): string {
  return (
    `${requestClause(req)}\n\n` +
    `이 저장소의 파일:\n${paths.join("\n")}\n\n` +
    `먼저 읽을 파일을 최대 ${max}개 골라라.`
  );
}

/**
 * System clause for loading a codebase into a fresh session: once when a repository is first
 * loaded, and again whenever a lost session has to be put back.
 *
 * It spends three lines on what not to do because the server runs an agent CLI, and one handed a
 * codebase with no instruction treats it as work: it rewrites, summarises or writes files, and
 * the learner ends up reading something other than the repository they gave.
 */
export function buildReseedSystem(): string {
  return (
    "You are given an existing codebase to hold in context so you can answer questions about it.\n" +
    "Do not create, write or edit any file, and do not call tools.\n" +
    "Do not generate, rewrite, improve or summarise the code.\n" +
    "Reply with exactly one short line confirming the codebase is loaded."
  );
}

/** The whole project as one message. This is the expensive call the resume model exists to avoid. */
export function buildReseedPrompt(project: CodeProject): string {
  const files = project.files.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n");
  return (
    `[코드베이스 적재] ${project.title}\n\n` +
    `아래가 프로젝트 전체다. 문맥에 담아 두고 다음 질문을 기다려라.\n\n${files}`
  );
}
/**
 * The annotation pass explains code that already exists, so it repeats the reseed's prohibitions:
 * nothing is being written, and a model left to its defaults improves what it is shown.
 */
export function buildAnnotateSystem(): string {
  return (
    "You annotate an existing codebase for a learner reading it. Output ONLY valid JSON.\n" +
    "Do not create, write or edit any file, and do not call tools.\n" +
    "Do not modify, rewrite, improve or extend the code.\n" +
    "Write every sentence in Korean. Leave symbol names, paths and code fragments as they are." +
    "\n\n" +
    AUDIENCE_CLAUSE
  );
}
/**
 * Ask for one file's annotations, with the source restated and numbered.
 *
 * The line numbers are the entire join key between a note and the code, and a model counting
 * lines out of JSON already in its context is not something to rely on. Measured 2026-09-02:
 * with the source restated this way, a 61-line file produced 14 notes in 37s with zero ranges
 * outside the file.
 */
export function buildAnnotatePrompt(path: string, content: string, request?: ReadingRequest): string {
  const lines = content.split("\n");
  const numbered = lines
    .map((line, i) => `${String(i + 1).padStart(3, "0")}| ${line}`)
    .join("\n");
  // Every call restates the request. Annotation resumes across visits, and a file annotated on a
  // later one must be written for the same goal as the first -- the session may not be the same.
  const asked = requestClause(request);
  return (
    `[주석 생성 요청]\n대상 파일: ${path}\n\n` +
    `아래가 그 파일의 전체 내용이다. 각 줄 앞의 번호가 파일의 실제 줄 번호다.\n\n` +
    `${numbered}\n\n` +
    (asked ? `${asked}\n\n` : "") +
    "이 파일에 주석 5~15개를 만들어라. 파일이 짧으면 그에 맞게 줄여라.\n" +
    "대상은 파일 전체 역할 하나, import 묶음 하나, 각 클래스와 함수와 메서드 정의, " +
    "그리고 눈에 띄는 문장(상수, 설정값, 까다로운 한 줄, 예외 처리 지점)이다.\n" +
    "각 항목은 한 문장이고, 주석 하나의 전체 길이가 두세 문장을 넘지 않는다.\n" +
    "범위는 설명하는 대상만 감싼다. 함수를 설명하면 정의 줄과 핵심 몇 줄이지 본문 전체가 아니다. " +
    "범위가 넓으면 어느 줄에 주석이 있는지 미리 알 수 없게 된다.\n\n" +
    "JSON만 출력한다. 산문도 마크다운 펜스도 쓰지 마라.\n" +
    `{"file":"${path}","items":[{` +
    '"target":{"lines":[시작,끝],"symbol":"이름 또는 null"},' +
    '"kind":"file|class|function|method|import|statement|config",' +
    '"what":"한 문장","why":"한 문장(선택)","concept":"낱말(선택)",' +
    '"watch":"한 문장(선택)","refs":[{"path":"","line":0,"label":""}](선택)}]}'
  );
}
function describeTarget(target: ExplainRequest["target"], quoted?: string): string {
  let location = `파일: ${target.path}`;
  if (target.symbol) location += `, 심볼: ${target.symbol}`;
  if (target.lines) location += `, 라인: ${target.lines[0]}-${target.lines[1]}`;
  if (quoted) location += `\n선택한 코드:\n${quoted}`;
  return location;
}

export function buildExplainPrompt(req: ExplainRequest, quoted?: string): string {
  const head = `[설명 요청]\n${describeTarget(req.target, quoted)}\n렌즈: ${req.lens} (${LENS_LABELS[req.lens]})`;
  const body =
    req.lens === "concepts"
      ? CONCEPT_LENS_FORMAT
      : `위 대상에 대해 "${LENS_LABELS[req.lens]}" 관점에서 설명해 주세요.`;
  return `${head}\n\n${body}\n\n${AUDIENCE_CLAUSE}\n${buildComponentDirective("full")}`;
}

/** Collected regions, each labelled with where it came from so the model can reason across them. */
function describeScraps(scraps: Scrap[]): string {
  const blocks = scraps.map((s, i) => {
    const where = s.lines[0] === s.lines[1] ? `${s.lines[0]}행` : `${s.lines[0]}-${s.lines[1]}행`;
    return `[구간 ${i + 1}] ${s.path} ${where}\n${s.code}`;
  });
  return `선택한 ${scraps.length}개 구간:\n\n${blocks.join("\n\n")}`;
}

/** A learner's own wording is passed through untouched; only the code context is added. */
export function buildAskPrompt(req: AskRequest, quoted?: string): string {
  const context = req.scraps?.length
    ? describeScraps(req.scraps)
    : describeTarget(req.target, quoted);
  // What the annotation layer already said about this code. It is a generated artifact too,
  // so it is offered as a prior and explicitly loses to the code.
  const grounds = req.grounds
    ? `[이미 알려진 것]\n${req.grounds.what}${req.grounds.why ? `\n${req.grounds.why}` : ""}\n` +
      "이 내용을 근거로 삼되, 코드와 어긋나면 코드를 따르세요.\n\n"
    : "";
  return (
    `[질문]\n${context}\n\n` +
    grounds +
    `${req.question}\n\n` +
    "이 프로젝트의 실제 코드를 근거로 답하세요. 확실하지 않은 부분은 추측하지 말고 그렇다고 밝히세요.\n\n" +
    AUDIENCE_CLAUSE +
    buildComponentDirective(req.depth)
  );
}

/** The same collected regions can also be sent to a lens rather than a free-form question. */
export function buildScrapExplainPrompt(scraps: Scrap[], lens: Lens): string {
  const head = `[설명 요청]\n${describeScraps(scraps)}\n렌즈: ${lens} (${LENS_LABELS[lens]})`;
  const body =
    lens === "concepts"
      ? CONCEPT_LENS_FORMAT
      : `위 구간들을 함께 놓고 "${LENS_LABELS[lens]}" 관점에서 설명해 주세요. 구간 사이의 관계를 밝히세요.`;
  return `${head}\n\n${body}\n\n${AUDIENCE_CLAUSE}\n${buildComponentDirective("full")}`;
}


// ── 개념 문서 (FR-23) ────────────────────────────────────────────────────────
//
// Two calls, not one. The outline is cheap and has to exist before anything can show a list;
// each document is its own resumed call because a whole set is far past the 180s follow-up cap.
// Measured 2026-09-03 on a 9-file project: outline 12.2s / 8 concepts, one document 33.0s /
// 2,088 chars.

/** Ask what this codebase teaches. Returns seeds only -- no prose, so it stays cheap. */
export function buildConceptOutlineSystem(): string {
  return [
    "너는 이 세션에 적재된 코드베이스를 읽고, 그 코드가 실제로 쓰는 개념의 목록을 뽑는다.",
    "",
    "[무엇을 뽑는가]",
    "- 이 코드베이스가 실제로 쓰는 것만 뽑는다. 쓰지 않은 일반론은 넣지 않는다.",
    "- 파일 하나에만 있는 세부가 아니라, 이 코드를 읽어 내는 데 필요한 개념을 고른다.",
    "- 서로 겹치지 않게 나눈다. 같은 것을 두 이름으로 부르지 않는다.",
    "- 관련된 것끼리 이웃하게 늘어놓는다. 이 순서가 곧 읽는 순서가 된다.",
    "",
    "[출력]",
    'JSON 하나만 출력한다. {"concepts": [{"area": ..., "concept_id": ..., "title": ...}]}',
    "- concept_id: 소문자·숫자·하이픈만. 정규식 ^[a-z0-9][a-z0-9-]{0,63}$ 을 반드시 만족한다.",
    "- area: 개념을 묶는 갈래의 소문자 영문 키(예: structure, storage, errors).",
    "- title: 한국어 이름. 짧게.",
    "- " + String(CONCEPT_MIN) + "개 이상 " + String(CONCEPT_MAX) + "개 이하.",
    "설명 문장이나 코드펜스 없이 JSON만 출력한다.",
  ].join("\n");
}

/** The learner's request, when there is one, decides which of the codebase's concepts come first. */
export function buildConceptOutlinePrompt(request?: ReadingRequest): string {
  const asked = requestClause(request);
  return asked
    ? `${asked}\n\n이 프로젝트의 개념 목록을 뽑아라. 요청과 닿는 개념을 앞에 둔다.`
    : "이 프로젝트의 개념 목록을 뽑아라.";
}

/**
 * Write one concept up.
 *
 * The audience clause is the same one the annotations and the answers use: a reader who can read
 * the language but has not met these conventions. A concept page that assumes more than the notes
 * beside the code would be the one place in the product that talks down to nobody in particular.
 */
export function buildConceptDocSystem(): string {
  return [
    "너는 이 세션에 적재된 코드베이스를 근거로, 요청받은 개념 하나에 대한 해설 문서를 쓴다.",
    "",
    "[무엇을 쓰는가]",
    "- 이 코드베이스에서 그 개념이 실제로 어떻게 쓰였는지를 중심에 둔다. 파일과 함수 이름을 든다.",
    "- 일반론은 그 코드를 이해하는 데 필요한 만큼만 곁들인다.",
    "- 분량은 1,000~2,000자.",
    "",
    AUDIENCE_CLAUSE,
    "",
    DOC_DIALECT,
    "",
    "[출력]",
    'JSON 하나만 출력한다. {"area":..., "concept_id":..., "title":..., "body":...}',
    "body는 위 표기를 쓴 마크다운 문자열이다. 설명 문장이나 코드펜스 없이 JSON만 출력한다.",
  ].join("\n");
}

export function buildConceptDocPrompt(seed: { area: string; concept_id: string; title: string }): string {
  return JSON.stringify({ area: seed.area, concept_id: seed.concept_id, title: seed.title });
}


// ── 디버그 트레이스 (FR-24) ──────────────────────────────────────────────────
//
// One leg is one file. The model is never asked for a path per step -- inside a leg it only names
// a line in a file it was just handed, numbered. A path can therefore be invented in exactly one
// place, `leaves_to`, which is the one place the parser checks. Asking for a path on every step
// would open the same hallucination surface once per step and give the parser nothing better to
// check it against.
//
// WIRING IS COLLAPSED INTO ONE STEP (user directive 2026-09-10, measured the same day).
//
// The first version of this prompt said "실제로 실행되는 줄만 단계로 삼는다 ... 선언만 있고
// 지나가지 않는 줄은 넣지 마라", and the model obeyed it exactly while still spending most of a
// walkthrough on wiring -- because the rule filtered the wrong axis. `def list_overdue_loans(`
// and `limit: int = Query(default=20)` DO execute in Python: the decorator runs, the default is
// evaluated, FastAPI resolves the Depends before the body. They are executing lines, so nothing
// forbade them.
//
// Measured on two stored runs, and they fail in two different ways.
//
// `state/traces/prj-mtmhonko-n82lu6.json` (FastAPI, 32 steps across two runs): 8 landed on a
// signature or parameter default, 2 on `self._x = x` constructor plumbing, 5 on an `if x is not
// None:` that did not fire, 2 on a type annotation with an empty initialiser. 14 of 32 reached a
// line that computed or called anything, and the 24-step run did not arrive at the service logic
// until step 16.
//
// `state/traces/prj-mtnxg62p-jie43p.json` (a Node gateway, one 23-step run started at
// `src/server.js:1`) is worse and is NOT the same failure: every one of its 23 steps is module
// loading. It follows `import` after `import`, narrates `function readInt(`, `function
// serialize(`, `function formatLabels(` as they are merely defined, and repeats
// `metrics.js:11` twice. It never reaches a single line of what the gateway does. A rule written
// only against the FastAPI case would not have caught this one, which is why the wording below
// names module load explicitly and says to enter a definition when it is CALLED, not where it
// sits.
//
// So the axis is not "does this line execute" but "does the reader's understanding of the flow
// change here". Wiring is bundled into one step that says what came out of it, and the run moves
// on to the line that does something. Two consequences worth keeping in mind when editing:
//   - It must BUNDLE, never silently drop. A trace is a chain; a pointer that jumps with nothing
//     said is the defect `parseTraceLeg` refuses to create by cutting instead of skipping.
//   - `leaves_to` is told not to follow wiring into another file. That is what removes the
//     deps.py detour above -- five steps and a file boundary spent resolving two default values.
//
// The word for this is 묶다, never 생략: AUDIENCE_CLAUSE already uses 생략 to forbid shortening
// the explanation of a step that IS narrated, and one word doing both jobs in the same bundle
// would leave the model guessing which it meant.

/**
 * The trace pass predicts an order of execution over code that already exists, so it carries the
 * same prohibitions as the reseed and the annotation pass: nothing is being written, and a model
 * left to its defaults improves the project instead of walking it.
 */
export function buildTraceSystem(): string {
  return (
    "너는 코드가 특정 지점부터 어떻게 실행될지 예측해 한 단계씩 서술한다. Output ONLY valid JSON.\n" +
    "이것은 실제 실행이 아니라 코드를 근거로 한 너의 예측이다.\n" +
    "Do not create, write or edit any file, and do not call tools.\n" +
    "Do not modify, rewrite, improve or extend the code.\n" +
    "표준 라이브러리와 프레임워크 내부로는 들어가지 마라. 그런 호출은 한 단계로 요약하고, " +
    "이 프로젝트에 실제로 있는 파일일 때만 그 파일로 넘어가라.\n" +
    "한 단계는 흐름에 대한 이해가 그 줄에서 달라질 때만 쓴다. 값을 자리에 꽂기만 하는 배선은 " +
    "한 단계로 묶는다. 함수 시그니처와 매개변수 기본값, 프레임워크가 본문 실행 전에 채워 주는 " +
    "의존성, 생성자가 인자를 필드로 옮기는 줄이 그렇다.\n" +
    "모듈이 적재되는 과정도 배선이다. import, 함수와 클래스가 정의되기만 하는 줄, 모듈 수준 " +
    "상수 준비를 한 단계로 묶고, 프로그램이 실제로 일을 시작하는 지점부터 따라가라. " +
    "정의를 만나면 그 자리에서 서술하지 말고, 그것이 실제로 호출될 때 따라 들어간다.\n" +
    "묶을 때 말없이 건너뛰지는 마라. 그 한 단계에서 무엇이 준비되었는지 밝힌다.\n" +
    "각 단계는 그 줄에서 일어나는 일 한 문장과, 그 시점에 살아 있는 변수와 상태의 전체 목록이다.\n" +
    "매 단계 전체 목록을 다시 적어라. 바뀐 것만 적지 마라. 값이 그대로인 변수도 다시 적는다.\n" +
    "Write every sentence in Korean. Leave symbol names, paths and code fragments as they are." +
    "\n\n" +
    AUDIENCE_CLAUSE
  );
}

/**
 * Ask for one file's steps, with the source restated and numbered.
 *
 * Same join-key reasoning as `buildAnnotatePrompt`: the line number is the entire link between a
 * step and the code, and a model counting lines out of JSON already in its context is not
 * something to rely on. The project's paths are listed verbatim so `leaves_to.path` can be
 * compared as a string rather than guessed at.
 */
export function buildTraceLegPrompt(leg: {
  path: string;
  content: string;
  startLine: number;
  /** The variable set the previous leg ended with, so state survives a file boundary. */
  carried: { name: string; value: string; scope?: string }[];
  steps: number;
  paths: string[];
}): string {
  const numbered = leg.content
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(3, "0")}| ${line}`)
    .join("\n");
  // The previous leg's ending state, offered as a prior. It is a generated artifact too, so it
  // loses to the code -- the same clause the ask path uses for annotation grounds.
  const carried = leg.carried.length
    ? `[이 지점까지의 변수 상태]\n${JSON.stringify(leg.carried)}\n` +
      "이어받되, 코드와 어긋나면 코드를 따르세요.\n\n"
    : "";
  return (
    `[실행 흐름 요청]\n대상 파일: ${leg.path}\n시작 줄: ${leg.startLine}\n\n` +
    `아래가 그 파일의 전체 내용이다. 각 줄 앞의 번호가 파일의 실제 줄 번호다.\n\n` +
    `${numbered}\n\n` +
    carried +
    `${leg.startLine}행에서 시작해 이어질 단계를 최대 ${leg.steps}개까지 서술하라.\n` +
    "실행되는 줄이라고 전부 단계가 되지는 않는다. 빈 줄과 닫는 괄호는 넣지 마라.\n" +
    "시그니처·매개변수 기본값·의존성 주입·필드 대입처럼 값을 자리에 꽂기만 하는 줄, import와 " +
    "정의만 하고 아직 부르지 않는 함수·클래스 줄, 그리고 확인만 하고 아무 일도 일어나지 않는 " +
    "조건 줄이 이어지면, 묶어서 한 단계로 만들고 그 단계는 배선을 촉발한 줄에 둔다. " +
    "그 다음 단계는 실제로 일하는 줄이다.\n" +
    "시작 줄이 import나 정의라면 거기서부터 읽어 내려가지 말고, 이 파일이 실제로 일을 시작하는 " +
    "지점을 찾아 그곳을 첫 단계로 삼아라.\n" +
    "배선을 따라가려고 다른 파일로 넘어가지 마라. leaves_to는 실제로 일이 일어나는 곳에만 쓴다.\n" +
    "같은 줄을 연달아 두 번 단계로 삼지 마라.\n" +
    "이 파일을 벗어나 아래 목록의 다른 파일로 넘어가면, 넘어가기 직전 단계까지만 적고 " +
    "leaves_to에 그 파일의 경로와 줄을 적어라. 경로는 아래 목록의 문자열을 그대로 쓴다.\n" +
    `이 프로젝트의 파일: ${leg.paths.join(", ")}\n` +
    "반환·종료·응답처럼 더 따라갈 곳이 없으면 done을 true로 하고 leaves_to는 null로 둔다.\n\n" +
    "JSON만 출력한다. 산문도 마크다운 펜스도 쓰지 마라.\n" +
    '{"steps":[{"line":숫자,"explain":"한 문장",' +
    '"vars":[{"name":"이름","value":"이 시점의 값","scope":"함수명(선택)"}]}],' +
    '"leaves_to":{"path":"","line":0},"done":false}'
  );
}
