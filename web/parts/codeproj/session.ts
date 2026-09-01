// AI transport for the codeproj part: the load-once then resume cost model in three calls.
// Generation mints the session (the codebase enters its context once); explain and ask resume it,
// so a click costs a small follow-up instead of re-sending the project.

import type { AiSession } from "../../src/ai/client";
import type { AskRequest, ExplainRequest, GenerateInput, GeneratedProject, Lens, Scrap } from "./model";
import { parseProject, sliceLines } from "./model";
import {
  buildAskPrompt,
  buildExplainPrompt,
  buildGeneratePrompt,
  buildGenerateSystem,
  buildScrapExplainPrompt,
} from "./prompts";

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
): Promise<string> {
  const res = await session.send({
    prompt: buildExplainPrompt(req, quotedSelection(req, fileContent)),
    effort: "medium",
  });
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
): Promise<string> {
  const res = await session.send({
    prompt: buildAskPrompt(req, quotedSelection(req, fileContent)),
    effort: "medium",
  });
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
): Promise<string> {
  const res = await session.send({ prompt: buildScrapExplainPrompt(scraps, lens), effort: "medium" });
  if (!res.ok) {
    return `설명을 불러오지 못했습니다. (${res.error ?? "알 수 없는 오류"})`;
  }
  return res.text;
}
