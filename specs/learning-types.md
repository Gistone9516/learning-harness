# v5 Learning Types Spec (Capability Registry)

> buildflow per-folder contract. **Conforms to SoT(`specs/_interface-contract.md`)**, especially §4 `LearningCapability`.
> Scope: defines 4-layer learning capabilities as **registry entries** (`capability_id` is authoritative). bot-contract maps `handler` implementations.
> Source: `_ideation_capability-catalog.md` (+ `_ideation_original.json`). tier: core=daily essentials, extension=opt-in.
> Table columns: `capability_id` | tier | primitives(harness) | engine_fns / needs_ai | interaction contract (handler responsibility).

---

## Layer 1 — Engine Core Capabilities (layer 1, Discord-agnostic)

> These are engine-contract functions rather than capabilities per se. Listed in the registry for reference only (no handler; bot calls them directly).

| capability_id | engine_fns | notes |
|---|---|---|
| `scoring` | `score`,`normalize` | 4-mode binary scoring (engine-contract §3) |
| `leitner` | `leitner_transition`,`next_due_at`,`is_due` | box transition (§1) |
| `queue` | `build_queue` | due-first, weight, interleaving, D-day (§2) |
| `dashboard` | `get_dashboard_data` | 4 aggregation types (§5) |
| `persist` | `load_progress`,`save_progress` | store JSON (§4) |

---

## Layer 2 — Discord Learning Capabilities (layer 2)

**Presentation and input**
| capability_id | tier | primitives | engine_fns | interaction contract |
|---|---|---|---|---|
| `card_render` | core | output/cards | — | Show front of card (with a "show answer" button). Back is revealed after response. |
| `recall_self` | core | output/cards, interaction/confirm | scoring(self),leitner | Front → show answer → Yes/No self-judgment → verdict |
| `mcq_buttons` | core | interaction/buttons, output/cards | scoring(exact),leitner | Up to 5 choice buttons → immediate correctness + explanation |
| `mcq_select` | core | interaction/selects | scoring(exact) | 6–25 choices via dropdown |
| `short_modal` | core | interaction/form, output/cards | scoring(exact/keyword) | Modal short-answer input → normalized scoring → matched/missed |
| `cloze_modal` | core | interaction/form | scoring(cloze) | Modal multi-field (fields = blanks) → per-blank scoring |
| `seq_modal` | core | interaction/form | scoring(exact) | Modal N-field sequence input → exact match. recall_seq scored in exact mode (sequence, engine-contract §3.1) |
| `reaction_quick` | core | output/reactions, output/cards | scoring(self) | Single emoji click O/X (no modal, minimal friction) |
| `quiz_poll` | extension | interaction/poll | scoring(exact) | Native poll multiple choice (with deadline) |

**Feedback**
| capability_id | tier | primitives | interaction contract |
|---|---|---|---|
| `feedback_inline` | core | live/livecard, output/cards | In-place verdict + answer + matched/missed highlight on the same message (correct = green, incorrect = yellow) |
| `concept_link` | extension | output/reply, output/suppress | After a wrong answer, show `links.concept_ref` source (suppress URL embed) |
| `paginate` | core | interaction/paginator | Prev/Next for concept and wrong-answer lists |

**Recall reinforcement**
| capability_id | tier | primitives | engine_fns | interaction contract |
|---|---|---|---|---|
| `confidence_rate` | core | interaction/buttons | persist | Easy/Med/Hard rating **before** answer reveal → stored as sidecar (no engine schema change) |
| `hint_progressive` | core | interaction/buttons | persist | Step-by-step hints without revealing answer (max 3 levels). **needs_ai=False fixed** (non-AI). AI hints delegated to layer 3 `ai_hint`. |
| `preview_then_test` | extension | output/cards, interaction/confirm | leitner | New card: show answer first → switch to retrieval |
| `elaborate_ask` | core | interaction/form, output/embeds | persist | "Why is this so?" free response → stored (non-AI elaboration) |
| `read_resume` | core | interaction/paginator | persist | Store and restore reading position (idx) |

**SRS and sessions**
| capability_id | tier | primitives | engine_fns | interaction contract |
|---|---|---|---|---|
| `srs_due_alert` | core | automation/watcher,scheduler, output/mention | queue | Due rising edge → @mention/DM (channel parameter). Store deduplication |
| `session_thread` | extension | channels/threads | — | Session isolated in thread, auto-archived |
| `session_progress` | core | live/progressbar | — | Real-time session completion progress bar |
| `exam_delayed` | extension | interaction/poll, automation/digest | scoring | Exam mode: defer scoring → batch reveal (delayed feedback) |

**Diagnostics and dashboard**
| capability_id | tier | primitives | engine_fns | interaction contract |
|---|---|---|---|---|
| `dashboard_live` | core | live/livecard | dashboard | Real-time single card showing recall rate, box, and due count (absorbs metricpush) |
| `box_table` | core | live/livetable | dashboard | Box distribution table by unit and area |
| `mastery_chart` | extension | live/livechart, media/imagesend | dashboard | Mastery curve image (matplotlib) |
| `digest_weekly` | core | automation/digest | dashboard | Daily/weekly study summary |
| `weakness_wiki` | extension | channels/forum, interaction/selects | dashboard | Unit-tagged weakness forum archive |

**Content and curation**
| capability_id | tier | primitives | interaction contract |
|---|---|---|---|
| `content_hotreload` | extension | automation/filedrop | Detect new deck in content folder → notify |
| `curate_contextmenu` | extension | interaction/contextmenu | Right-click message → add card/list (self) |
| `pin_rotate` | extension | output/pins | Pin mastery cards (list_pins + unpin rotation) |

---

## Layer 3 — AI Learning Capabilities (layer 3, needs_ai=True, depends on `_invoke`)

> All are token-controlled (ai-mode). Opt-in via config `capabilities.ai.enabled`.

| capability_id | tier | primitives | interaction contract |
|---|---|---|---|
| `ai_openend_grade` | core | interaction/form, output/typing_indicator | Essay, translation, or short answer → AI binary verdict (JSON-forced; falls back to self on failure) |
| `ai_socratic` | core | channels/threads, channels/webhook | Explanation → AI follow-up questions (sliding 4-turn window) |
| `ai_hint` | core | interaction/buttons | Dynamic hints by level (max 3) |
| `ai_generate_items` | core | automation/driver, live/progressbar | Seed list → batch card draft generation |
| `ai_personal_feedback` | core | output/cards, channels/webhook | Personalized correction after wrong answer (last 3 wrong answers as context) |
| `ai_misconception` | extension | automation/scheduler | Diagnose repeated-error patterns by unit (top 5 cards) |
| `ai_adaptive_weight` | extension | automation/scheduler | **needs_ai=True. AI provides only a text-form strategy suggestion.** Deterministic weight recalculation is separate (rule-based; sidecar `adaptive_weight` record → buildQueue weight_overrides, SoT §2.1). Token-0 recalculation is layer 1/2; AI suggestion only is layer 3. |
| `ai_session_summary` | extension | automation/digest | End-of-session study log (1 call) |
| `ai_stream_render` | core | live/livecard, output/typing_indicator | Per-token stream rendering |
| `ai_variant_q` | extension | automation/driver | Variant questions for box 3 cards |
| `ai_persona` | extension | channels/webhook | Examiner/grader/coach persona |
| `ai_proactive_remind` | extension | automation/scheduler, output/mention | Due-based encouragement (not called when due=0) |

---

## Layer 4 — Infrastructure (layer 4, not learning core)

> Bot correctness, survival, and security. Always wired as bot boot/common middleware, no handler (registry reference only).

| capability_id | tier | primitives | responsibility |
|---|---|---|---|
| `gating` | core | automation/gating | First line of every handler: allowlist (ALLOWED_USER_ID) — required |
| `event_trigger` | core | automation/events | on_message/reaction/thread → enter session |
| `heartbeat` | core | automation/heartbeat | Detect silence in batch driver/scheduler → mention |
| `coalesce_base` | core | automation/ratelimit | Common coalescing base for live/* (max 1/sec) |
| `perm_preflight` | extension | meta/checklist, meta/botinvite | on_ready permission check and invite URL |
| `presence_signal` | extension | meta/presence | Show studying/grading status |
| `channel_scaffold` | extension | community/categories, channels/channels | Auto-configure subject channels and categories |
| `dm_private` | extension | meta/dm | Private DM feedback |

---

## Activation and Defaults (linked to injection-interface §7)

- `capabilities.enabled` not set → **all core tier active** (including layer 4 gating, event, heartbeat, coalesce).
- extension and layer 3 (ai) require explicit opt-in. Unknown `capability_id` = `ContentInjectionError`.
- Inter-capability dependencies (e.g. `ai_*` needs `gating` and `_invoke`; `srs_due_alert` needs `queue` and `persist`) are validated by bot-contract at boot (missing dependency = warning + deactivation).
- **needs_ai (SoT §4 required)**: layers 1, 2, 4 = `False`; layer 3 = `True` (all rows have fixed values). Determined by the layer shown in the table above.
- **Sidecar (SoT §2.1)**: capabilities that use auxiliary state outside CardProgress — `confidence_rate`(confidence), `read_resume`(read_pos), `elaborate_ask`(elaboration), `srs_due_alert`(alert_sent deduplication), adaptive_weight (weight recalculation) — follow the SoT §2.1 sidecar contract (managed by bot/harness, no engine schema pollution, path `<mount>/_state/sidecar-<capability_id>-<deck>.json`).

> [OPEN-B] Resolution (bot-contract): `handler` maps as a `capability_id → bot handler function` dispatch table.

## Machine registry (implementation)

This document is the human authority. Its machine projection is `bot/capability_registry.py`
(`REGISTRY: dict[capability_id → CapSpec]` with layer, tier, handler_module, slash_commands,
needs_ai, files, shared_bases, dep_capabilities). `bot/boot.py` derives the validation whitelist
and the default-core set from it; `bot/wiring.py` registers handlers and verifies required files for
the enabled set; `tools/clone.py` uses `files`/`shared_bases` to copy only the enabled capabilities
into a consuming project. Keep the two in sync: a new capability is added here AND as a `CapSpec` row.
