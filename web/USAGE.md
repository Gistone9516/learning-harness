# How an AI operates the web harness

This kit is a **tool an AI drives on a learner's behalf**, not a finished app. The parts (`sheet`,
`codeproj`, `conceptprob`) are empty instruments: they render and grade, but they carry no subject and
no content. The AI supplies the content — by injecting it or generating it at runtime — and the AI is
responsible for getting that content *right for this learner*. This document is the operating manual
for that role. The formal data contract is `specs/web-contract.md`; this is the behavioural layer on
top of it.

## The loop

For every study session the AI runs the same loop:

1. **Elicit intent.** Ask the learner what they want to study and how (see the protocol below). The kit
   ships no subject, so this step is not optional — there is nothing to fall back on.
2. **Confirm scope.** Play back what you understood in one line and get a yes before generating.
3. **Inject or generate.** Mount the right part with injected data, or call `ai_server` to generate it.
4. **Present and let them work.** The learner reads / answers in the part UI.
5. **Grade deterministically.** Graded answers are scored client-side by the engine grader port — the
   AI never decides correct/incorrect for a deterministic card (token 0, binary).
6. **Record progress.** Results land in `localStorage` (`web-contract.md` §5); use them to inform the
   next round's intent.

## Intent-first protocol (do not skip)

Before generating or selecting any material, **ask the learner for their intent** and wait for the
answer. Generating from an assumption is the main failure mode here: it wastes a session and quietly
bakes a subject the kit is supposed to stay clear of.

Ask only what changes the output, in one short round (not an interrogation):

- **Subject / area** — which domain or area from the configured taxonomy. Never assume it.
- **Concrete topic** — the specific thing inside that area ("a small library-management project",
  "closures", "VLOOKUP across two ranges").
- **Scale / difficulty** — how big or hard. For `codeproj` this is project scale; for `conceptprob`
  it is depth; for `sheet` it is the formula range.
- **Constraints** — anything to include or avoid, prior knowledge, language preference.

Then confirm in one line ("So: a small library system in Python, focused on how the parts connect —
right?") and only generate after a yes. If the learner is vague, ask one clarifying question rather
than guessing. If they say "you pick", that is a real answer — choose, then state what you chose.

This protocol is also a guardrail: because the kit holds no subject literal, eliciting intent from the
learner is the *only* correct source of subject — there is no default to reach for.

## Per-part quickstart

Mount everything through the shell: set `globalThis.LH_CONFIG` to an `AppConfig`
(`{ part, data, ai? }`) and the shell mounts the named part (`web/src/shell.ts`).

**Two content modes (they coexist).** Either generate content live (provide `ai`, ask intent first) or
**inject verified pre-baked content** and omit `ai` to run fully offline. Pre-baked is the safer default
for a curated study set: author and review the content once, then serve it with deterministic grading and
zero AI at study time. Intent-first (above) governs the live path only; pre-baked content is already
decided.

- **`sheet`** — fully deterministic, no AI needed. Inject a `SheetProblem` (prompt, grid, editable /
  target cells, expected values, optional `require_formula`). Ask: which spreadsheet skill and at what
  range. Grading is the formula engine plus the grader port.
- **`codeproj`** — top-down code reading. Either inject a pre-baked `project` (offline reading; the
  explain controls hide) or, with `ai`, `generate` one at the chosen scale and let the learner click
  lines to `explain` (one session, loaded once then resumed). Navigation is deterministic.
- **`conceptprob`** — area to concept to problem. Inject the `areas` taxonomy and concept outline. Either
  inject pre-baked `concepts` (`{concept_id: GeneratedConcept}`, rendered + graded offline) or, with
  `ai`, `generate` a concept on demand and optionally `deepen` it. Problems carry a `CardDef`-compatible
  `answer_spec`, so they grade deterministically — never by the AI. Concept bodies are Markdown
  (headings, tables, code); a problem `front` may include a `code` block for output-prediction / SQL.

## Guardrails the AI must honour

- **Deterministic grade is authoritative.** Do not override or second-guess a binary verdict. The only
  AI-graded path is an explicit open-ended card, and even it falls back to self-grading on any doubt.
- **Subject-agnostic.** Put no subject term in kit code or in anything that lands in the kit; all
  domain wording comes from config or from what the learner told you.
- **Secrets stay out of the bundle.** The AI server token is never embedded or shown; talk to
  `ai_server` over its token-gated HTTP boundary only.
- **Respect `output_lang`.** Learner-facing generated text follows the configured language (default
  Korean); apply the safety preamble on every call (`web-contract.md` §6).
- **Degrade gracefully.** If `ai_server` is unreachable, deterministic features keep working and AI
  features disable with a visible notice — never a silent dead button.
