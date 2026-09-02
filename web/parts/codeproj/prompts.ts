// Prompt layer for the codeproj part. Everything the AI is told lives here, separated from the
// view and from the transport, so wording is reviewable and testable in one place.
//
// Subject-agnostic: these strings describe software quality and explanation shape only. The topic,
// stack and constraints always arrive as injected input, never as a literal in this file.

import type { AskRequest, ExplainRequest, GenerateInput, GeneratedProject, Lens, Scrap } from "./model";
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
 * Quality clause injected into every generation call.
 *
 * The learner reads this code to learn from it, so it has to look like code a professional would
 * ship: layered, conventional for its stack, and persisting data as one record per file behind an
 * index rather than appending to one growing file. Toy code teaches the wrong habits, which is why
 * this is part of the contract rather than a nice-to-have.
 */
export const QUALITY_CLAUSE = [
  "Code quality requirements (mandatory):",
  "- Imitate how professionals and companies actually write software in the chosen stack:",
  "  conventional directory layout, naming, configuration separated from code, error handling,",
  "  input validation, logging, at least one test file, and a README.",
  "- Separate layers: entry point, domain/service logic, storage/adapters and configuration must",
  "  not be mixed into one file.",
  "- If the project persists data, store one record per file with a separate index; never append",
  "  records into a single growing file.",
  "- No toy or textbook-abridged code. Write it as real service code, scaled down only in size.",
  "- Code stays in the project's language; explanatory prose (summary, comments) follows the",
  "  configured output language.",
].join("\n");

const SCALE_GUIDE: Record<string, string> = {
  small: "3-6 files, ~300 lines total",
  medium: "7-15 files, ~600 lines total",
  large: "16-30 files, ~1200 lines total",
};

export function buildGenerateSystem(): string {
  return (
    "You are a project generator. Output ONLY valid JSON matching the GeneratedProject schema: " +
    '{ "title": string, "summary": string, "files": [{path, content, lang?}], "entrypoints"?: string[] }. ' +
    "No prose, no markdown outside the JSON. The codebase must be complete, coherent, and self-consistent.\n" +
    // The server runs an agent CLI, so it has to be told the project belongs in the response and
    // not on disk; without this it writes the files somewhere and reports back in prose.
    "Return the project as JSON only: do not create, write or edit any file, and do not call tools.\n\n" +
    QUALITY_CLAUSE
  );
}

export function buildGeneratePrompt(input: GenerateInput): string {
  return (
    `Generate a project: topic="${input.topic}", scale=${input.scale} ` +
    `(${SCALE_GUIDE[input.scale] ?? input.scale})` +
    (input.seed ? `, constraints/stack: ${input.seed}` : "") +
    "."
  );
}

/**
 * System clause for a reseed: put a codebase back into a fresh session so questions can carry on.
 *
 * QUALITY_CLAUSE is deliberately absent. It governs code the model writes, and a reseed writes
 * none -- handing it over would invite the model to "improve" the project the learner is reading.
 * That absence is what keeps this path structurally separate from generation.
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
export function buildReseedPrompt(project: GeneratedProject): string {
  const files = project.files.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n");
  return (
    `[코드베이스 적재] ${project.title}\n\n` +
    `아래가 프로젝트 전체다. 문맥에 담아 두고 다음 질문을 기다려라.\n\n${files}`
  );
}
/**
 * The annotation pass explains code that already exists. QUALITY_CLAUSE is absent for the same
 * reason as in the reseed: nothing is being written, and offering the clause invites the model
 * to improve the project the learner is about to read.
 */
export function buildAnnotateSystem(): string {
  return (
    "You annotate an existing codebase for a learner reading it. Output ONLY valid JSON.\n" +
    "Do not create, write or edit any file, and do not call tools.\n" +
    "Do not modify, rewrite, improve or extend the code.\n" +
    "Write every sentence in Korean. Leave symbol names, paths and code fragments as they are."
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
export function buildAnnotatePrompt(path: string, content: string): string {
  const lines = content.split("\n");
  const numbered = lines
    .map((line, i) => `${String(i + 1).padStart(3, "0")}| ${line}`)
    .join("\n");
  return (
    `[주석 생성 요청]\n대상 파일: ${path}\n\n` +
    `아래가 그 파일의 전체 내용이다. 각 줄 앞의 번호가 파일의 실제 줄 번호다.\n\n` +
    `${numbered}\n\n` +
    "이 파일에 주석 5~15개를 만들어라. 파일이 짧으면 그에 맞게 줄여라.\n" +
    "대상은 파일 전체 역할 하나, import 묶음 하나, 각 클래스와 함수와 메서드 정의, " +
    "그리고 눈에 띄는 문장(상수, 설정값, 까다로운 한 줄, 예외 처리 지점)이다.\n" +
    "각 항목은 한 문장이고, 주석 하나의 전체 길이가 두세 문장을 넘지 않는다.\n\n" +
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
  return `${head}\n\n${body}\n${buildComponentDirective("full")}`;
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
    "이 프로젝트의 실제 코드를 근거로 답하세요. 확실하지 않은 부분은 추측하지 말고 그렇다고 밝히세요." +
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
  return `${head}\n\n${body}\n${buildComponentDirective("full")}`;
}
