// AI transport for the codeproj part: the load-once then resume cost model in three calls.
// Generation mints the session (the codebase enters its context once); explain and ask resume it,
// so a click costs a small follow-up instead of re-sending the project.

import type { AiResponse, AiSession } from "../../src/ai/client";
import { parseAnnotations, type AnnotationSet, type FileAnnotations } from "./annotations";
import { carveJson } from "./components/parse";
import type { AskRequest, ExplainRequest, GenerateInput, GeneratedProject, Lens, Scrap } from "./model";
import { parseProject, sliceLines } from "./model";
import {
  buildAskPrompt,
  buildExplainPrompt,
  buildGeneratePrompt,
  buildGenerateSystem,
  buildAnnotatePrompt,
  buildAnnotateSystem,
  buildReseedPrompt,
  buildReseedSystem,
  buildScrapExplainPrompt,
} from "./prompts";

/**
 * Put the codebase back and report whether it worked. Supplied by the mount, which owns the
 * project and the once-per-mount budget; undefined when there is nothing to reseed from.
 */
export type Reseed = () => Promise<boolean>;

/**
 * Send, and if the server says the session it was told to resume is gone, reseed and ask again.
 *
 * This lives here rather than in the flow layer because `error_kind` dies at this boundary:
 * explain/ask flatten the whole response into a human sentence, so a caller downstream can no
 * longer tell a lost session from a bad model or a timeout. Only "resume_missing" retries --
 * re-sending a codebase after a timeout would spend a full context on a model that is still busy.
 */
async function sendResuming(
  session: AiSession,
  req: Parameters<AiSession["send"]>[0],
  reseed?: Reseed,
): Promise<AiResponse> {
  const res = await session.send(req);
  if (res.error_kind !== "resume_missing" || !reseed) return res;
  if (!(await reseed())) return res;
  return session.send(req);
}

/**
 * Reload a codebase into a fresh session. `reset()` clears the id, so this goes out as a new
 * session and the server gives it the generation timeout rather than the follow-up one.
 * Expensive by nature, which is why it runs only after a resume actually failed.
 */
export async function reseedSession(session: AiSession, project: GeneratedProject): Promise<boolean> {
  session.reset();
  const res = await session.send({
    prompt: buildReseedPrompt(project),
    system: buildReseedSystem(),
    effort: "medium",
  });
  return res.ok;
}

/**
 * generateProject: one generation call (force_json) into a new session.
 * Returns null on AI failure or parse failure, so the caller can offer a retry.
 */
export async function generateProject(
  session: AiSession,
  input: GenerateInput,
): Promise<GeneratedProject | null> {
  // Generation always mints a fresh session. Resuming would hand the model its own previous
  // attempt: after a failed generation a retry gets "I already built this last turn" instead of a
  // project, and the load-once cost model assumes the codebase enters a clean context anyway.
  session.reset();

  // Generation is the one call whose output is read for hours, so it gets the deepest setting.
  // Every other call stays at the medium default: the measured floor for any call is ~5s
  // regardless of effort or model, so lowering it buys no speed and costs explanation quality.
  const res = await session.send({
    prompt: buildGeneratePrompt(input),
    system: buildGenerateSystem(),
    effort: "xhigh",
  });
  if (!res.ok) return null;
  return parseProject(res.text);
}


/**
 * Annotate one file. Failure is contained here: the caller keeps going, because a project with
 * thirteen annotated files and one that failed is still worth reading.
 */
export async function annotateFile(
  session: AiSession,
  path: string,
  content: string,
): Promise<FileAnnotations> {
  const res = await session.send({
    prompt: buildAnnotatePrompt(path, content),
    system: buildAnnotateSystem(),
    effort: "medium",
  });
  if (!res.ok) return { status: "failed", items: [], reason: "call" };
  const carved = carveJson(res.text);
  if (!carved) return { status: "failed", items: [], reason: "parse" };
  let raw: unknown;
  try {
    raw = JSON.parse(carved);
  } catch {
    return { status: "failed", items: [], reason: "parse" };
  }
  // The file's own length is what separates a real line range from an invented one.
  const parsed = parseAnnotations(raw, content.split("\n").length);
  if (parsed.status === "failed") {
    // Nothing survived, or too much was thrown away for what is left to be worth showing.
    return { status: "failed", items: [], reason: parsed.total === 0 ? "parse" : "dropped" };
  }
  return { status: parsed.status, items: parsed.items };
}

/**
 * Annotate a whole project, one file at a time, on the session that already holds its code.
 *
 * One call per file rather than one call for the project: resuming a session puts the request
 * in the follow-up class, which the server cuts off at 180s, and a whole medium project is far
 * past that. Sequential by construction, so no separate serialisation is needed.
 *
 * This runs before the learner reaches the project (design 08 §3.2), which is why no request
 * of theirs can queue behind it.
 */
export async function annotateProject(
  session: AiSession,
  project: GeneratedProject,
  onProgress?: (done: number, total: number, path: string) => void,
): Promise<AnnotationSet> {
  const set: AnnotationSet = { files: {} };
  for (let i = 0; i < project.files.length; i += 1) {
    const file = project.files[i];
    onProgress?.(i, project.files.length, file.path);
    set.files[file.path] = await annotateFile(session, file.path, file.content);
  }
  onProgress?.(project.files.length, project.files.length, "");
  return set;
}
/** Quote the selected lines so the model sees exactly what the learner pointed at. */
function quotedSelection(req: { target: { lines?: [number, number] } }, content?: string): string | undefined {
  if (!content || !req.target.lines) return undefined;
  return sliceLines(content, req.target.lines);
}

/**
 * explain: resume the session for a targeted explanation.
 * Returns the explanation text, or a human-readable error string on failure.
 */
export async function explain(
  session: AiSession,
  req: ExplainRequest,
  fileContent?: string,
  reseed?: Reseed,
): Promise<string> {
  const res = await sendResuming(session, {
    prompt: buildExplainPrompt(req, quotedSelection(req, fileContent)),
    effort: "medium",
  }, reseed);
  if (!res.ok) {
    return `설명을 불러오지 못했습니다. (${res.error ?? "알 수 없는 오류"})`;
  }
  return res.text;
}

/**
 * ask: resume the session with the learner's own question about the current target.
 * Same failure contract as explain.
 */
export async function ask(
  session: AiSession,
  req: AskRequest,
  fileContent?: string,
  reseed?: Reseed,
): Promise<string> {
  const res = await sendResuming(session, {
    prompt: buildAskPrompt(req, quotedSelection(req, fileContent)),
    effort: "medium",
  }, reseed);
  if (!res.ok) {
    return `답변을 불러오지 못했습니다. (${res.error ?? "알 수 없는 오류"})`;
  }
  return res.text;
}

/** Lens explanation over several collected regions at once. */
export async function explainScraps(
  session: AiSession,
  scraps: Scrap[],
  lens: Lens,
  reseed?: Reseed,
): Promise<string> {
  const res = await sendResuming(session, { prompt: buildScrapExplainPrompt(scraps, lens), effort: "medium" }, reseed);
  if (!res.ok) {
    return `설명을 불러오지 못했습니다. (${res.error ?? "알 수 없는 오류"})`;
  }
  return res.text;
}
