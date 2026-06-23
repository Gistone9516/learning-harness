# Web parts kit (`web/parts/`)

A catalog of **self-contained, opt-in web components** (the web analog of the Discord `harness/` kit).
The app shell registers only the parts a subject enables; nothing runs until a part is registered.
See `web-contract.md` §1 for the formal contract.

## How to use (for the AI or a developer)

1. Read this index (or `index.json`) first; pick **only the parts the task needs**.
2. Open the part's entry file and read its header (the standard below).
3. Register it in the app shell and wire its `INPUT`/`EVENTS`.
4. Keep each part inside its own `parts/<id>/` folder; do not entangle parts.

## Header standard (every part entry file)

A top-of-file doc comment with these fields:

- `WHAT`  one line: what the part does.
- `DEPS`  npm libraries and other part ids it needs.
- `INPUT` the injected data shape it consumes.
- `EVENTS` the result / progress events it emits.
- `AI`    whether it calls `ai_server`, and how (none / generate / explain).
- `CONSTRAINTS` which invariants it observes (e.g. subject-agnostic, token0, binary).
- `DEMO`  how to run it standalone (with a mock input, no live AI).

## Hard constraints (every part)

- **Subject-agnostic.** Zero subject literal; areas, labels, copy, content are injected.
- **No secrets.** Nothing secret in the bundle. AI only via `ai_server` with a token the bundle never embeds.
- **Deterministic = token 0.** Formula eval, navigation, and answer grading run client-side with no AI call.
- **Binary grading.** Graded answers reduce to correct/incorrect via the engine grader port (`web/src/grade`).
- **Responsive + basic a11y.** Works on phone and PC. Heavy deps are isolated per part.
- **Self-contained.** A part folder is a working unit; avoid filenames that shadow shared modules.

## Catalog

The machine-readable list is `index.json`. Current parts:

- `sheet` — interactive spreadsheet with a formula engine and deterministic grading.
