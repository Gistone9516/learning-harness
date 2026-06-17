# -*- coding: utf-8 -*-
"""Capability registry — single source of truth for capability metadata.

Pure data module (NO discord / engine / harness imports) so BOTH the runtime
wiring (bot/wiring.py, bot/boot.py) AND the clone tool (tools/clone.py) can
import it without side effects.

learning-types.md stays the human authority for layer/tier/needs_ai; this module
is its machine projection. The set of capability_id keys here is exactly the set a
consuming project may list in config.capabilities.enabled (boot validation whitelist).

Fields (CapSpec):
- capability_id: stable id.
- layer: 2 (discord learning) | 3 (AI) | 4 (infrastructure). Layer 1 engine fns are
  reference-only and not config-selectable, so they are intentionally absent.
- tier: "core" (on by default) | "extension" (opt-in).
- handler_module / handler_fn: importable dispatch handler (e.g. "handlers.recall_self", "handle").
  Only card-presentation capabilities have one. None means no dispatch handler.
- slash_commands: command names this capability owns (a command is registered when any owner is enabled).
- needs_ai: True for layer 3 (requires the claude CLI via bot/ai.py).
- files: repo-relative paths that MUST exist for this capability (verified at boot, copied by the clone tool).
- shared_bases: repo-relative files shared with other capabilities (deduped by the clone tool).
- dep_capabilities: other capability_ids this one needs at runtime.

Capabilities with empty files are recognized ids whose behavior lives in the core
kernel or is not yet implemented (no dedicated module to clone or verify).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CapSpec:
    capability_id: str
    layer: int
    tier: str
    handler_module: str | None = None
    handler_fn: str | None = None
    slash_commands: tuple[str, ...] = ()
    needs_ai: bool = False
    files: tuple[str, ...] = ()
    shared_bases: tuple[str, ...] = ()
    dep_capabilities: tuple[str, ...] = ()


# ── Core kernel: always cloned, never gated ────────────────────────────────────
CORE_KERNEL_FILES: tuple[str, ...] = (
    # bot core
    "bot/_paths.py",
    "bot/boot.py",
    "bot/context.py",
    "bot/session.py",
    "bot/dispatch.py",
    "bot/persist.py",
    "bot/commands.py",
    "bot/bot_errors.py",
    "bot/sidecar.py",
    "bot/main.py",
    "bot/review_select.py",
    "bot/study_select.py",
    "bot/capability_registry.py",
    "bot/wiring.py",
    # engine core (pure)
    "engine/models.py",
    "engine/leitner.py",
    "engine/selection.py",
    "engine/migrate.py",
    "engine/errors.py",
    # layer-4 always-on infra
    "bot/harness/automation/gating.py",
)

# Package __init__.py markers to copy when any module lands in these packages.
CORE_PACKAGE_INITS: tuple[str, ...] = (
    "bot/handlers/__init__.py",
    "bot/caps/__init__.py",
    "bot/caps_ai/__init__.py",
    "bot/render/__init__.py",
)

# Shared AI base pulled in by any layer-3 capability.
_AI_BASE = ("bot/ai.py", "bot/ai_caps.py")
_SCORING = ("engine/scoring.py",)
_DASHBOARD = ("engine/dashboard.py",)


REGISTRY: dict[str, CapSpec] = {
    # ── Layer 2 — Discord learning, core tier ──────────────────────────────────
    "card_render": CapSpec("card_render", 2, "core"),
    "recall_self": CapSpec(
        "recall_self", 2, "core",
        handler_module="handlers.recall_self", handler_fn="handle",
        files=("bot/handlers/recall_self.py",),
    ),
    "mcq_buttons": CapSpec(
        "mcq_buttons", 2, "core",
        handler_module="handlers.mcq_buttons", handler_fn="handle",
        files=("bot/handlers/mcq_buttons.py",), shared_bases=_SCORING,
    ),
    "mcq_select": CapSpec(
        "mcq_select", 2, "core",
        handler_module="handlers.mcq_select", handler_fn="handle",
        files=("bot/handlers/mcq_select.py",),
        shared_bases=_SCORING + ("bot/harness/interaction/selects.py",),
    ),
    "short_modal": CapSpec(
        "short_modal", 2, "core",
        handler_module="handlers.short_modal", handler_fn="handle",
        files=("bot/handlers/short_modal.py",), shared_bases=_SCORING,
    ),
    "cloze_modal": CapSpec(
        "cloze_modal", 2, "core",
        handler_module="handlers.cloze_modal", handler_fn="handle",
        files=("bot/handlers/cloze_modal.py",), shared_bases=_SCORING,
    ),
    "seq_modal": CapSpec(
        "seq_modal", 2, "core",
        handler_module="handlers.seq_modal", handler_fn="handle",
        files=("bot/handlers/seq_modal.py",), shared_bases=_SCORING,
    ),
    "reaction_quick": CapSpec("reaction_quick", 2, "core"),
    "feedback_inline": CapSpec("feedback_inline", 2, "core"),
    "paginate": CapSpec("paginate", 2, "core"),
    "confidence_rate": CapSpec(
        "confidence_rate", 2, "core",
        files=("bot/caps/confidence_rate.py",),
    ),
    "hint_progressive": CapSpec(
        "hint_progressive", 2, "core",
        files=("bot/caps/hint_progressive.py",),
    ),
    "elaborate_ask": CapSpec(
        "elaborate_ask", 2, "core",
        files=("bot/caps/elaborate_ask.py",),
        shared_bases=("bot/harness/interaction/form.py",),
    ),
    "read_resume": CapSpec(
        "read_resume", 2, "core",
        files=("bot/caps/read_resume.py",),
        shared_bases=("bot/harness/interaction/paginator.py",),
    ),
    "srs_due_alert": CapSpec(
        "srs_due_alert", 2, "core",
        files=("bot/caps/srs_due_alert.py", "bot/srs_push.py"),
        shared_bases=("bot/harness/output/mention.py", "bot/harness/automation/scheduler.py"),
    ),
    "session_progress": CapSpec("session_progress", 2, "core"),
    "dashboard_live": CapSpec(
        "dashboard_live", 2, "core", slash_commands=("dashboard",),
        files=("bot/render/dashboard_live.py",),
        shared_bases=_DASHBOARD + ("bot/harness/output/cards.py",),
    ),
    "box_table": CapSpec(
        "box_table", 2, "core", slash_commands=("dashboard",),
        files=("bot/render/box_table.py",),
        shared_bases=_DASHBOARD + ("bot/harness/live/livetable.py",),
    ),
    "digest_weekly": CapSpec(
        "digest_weekly", 2, "core", slash_commands=("digest",),
        files=("bot/render/digest_weekly.py",),
        shared_bases=_DASHBOARD + ("bot/harness/automation/digest.py",),
    ),

    # ── Layer 2 — extension tier ───────────────────────────────────────────────
    "quiz_poll": CapSpec("quiz_poll", 2, "extension"),
    "concept_link": CapSpec("concept_link", 2, "extension"),
    "preview_then_test": CapSpec("preview_then_test", 2, "extension"),
    "session_thread": CapSpec("session_thread", 2, "extension"),
    "exam_delayed": CapSpec("exam_delayed", 2, "extension"),
    "mastery_chart": CapSpec(
        "mastery_chart", 2, "extension", slash_commands=("dashboard",),
        files=("bot/render/mastery_chart.py",),
        shared_bases=_DASHBOARD + ("bot/harness/media/imagesend.py",),
    ),
    "weakness_wiki": CapSpec(
        "weakness_wiki", 2, "extension",
        files=("bot/render/weakness_wiki.py",),
        shared_bases=_DASHBOARD + ("bot/harness/channels/forum.py",),
    ),
    "content_hotreload": CapSpec("content_hotreload", 2, "extension"),
    "curate_contextmenu": CapSpec("curate_contextmenu", 2, "extension"),
    "pin_rotate": CapSpec("pin_rotate", 2, "extension"),
    "control_panel": CapSpec(
        "control_panel", 2, "extension", slash_commands=("ui",),
        files=("bot/control_panel.py",),
    ),

    # ── Layer 3 — AI (needs_ai), core tier ─────────────────────────────────────
    "ai_openend_grade": CapSpec(
        "ai_openend_grade", 3, "core",
        handler_module="caps_ai.ai_openend_grade", handler_fn="handle", needs_ai=True,
        files=("bot/caps_ai/ai_openend_grade.py",), shared_bases=_AI_BASE,
    ),
    "ai_socratic": CapSpec(
        "ai_socratic", 3, "core", slash_commands=("socratic",), needs_ai=True,
        files=("bot/caps_ai/ai_socratic.py",), shared_bases=_AI_BASE,
    ),
    "ai_hint": CapSpec(
        "ai_hint", 3, "core", needs_ai=True,
        files=("bot/caps_ai/ai_hint.py",), shared_bases=_AI_BASE,
    ),
    "ai_generate_items": CapSpec(
        "ai_generate_items", 3, "core", slash_commands=("generate",), needs_ai=True,
        files=("bot/caps_ai/ai_generate_items.py",), shared_bases=_AI_BASE,
    ),
    "ai_personal_feedback": CapSpec(
        "ai_personal_feedback", 3, "core", needs_ai=True,
        files=("bot/caps_ai/ai_personal_feedback.py",), shared_bases=_AI_BASE,
    ),
    "ai_stream_render": CapSpec("ai_stream_render", 3, "core", needs_ai=True),
    "ai_practice": CapSpec(
        "ai_practice", 3, "core", needs_ai=True,
        files=("bot/caps_ai/ai_practice.py",), shared_bases=_AI_BASE,
        dep_capabilities=("recall_self",),
    ),
    "ai_convo": CapSpec(
        "ai_convo", 3, "core", needs_ai=True,
        files=("bot/caps_ai/ai_convo.py",),
        shared_bases=_AI_BASE + (
            "bot/caps_ai/ai_socratic.py",
            "bot/harness/channels/threads.py",
        ),
    ),

    # ── Layer 3 — AI, extension tier ───────────────────────────────────────────
    "ai_misconception": CapSpec(
        "ai_misconception", 3, "extension", slash_commands=("misconception",), needs_ai=True,
        files=("bot/caps_ai/ai_misconception.py",), shared_bases=_AI_BASE,
    ),
    "ai_adaptive_weight": CapSpec(
        "ai_adaptive_weight", 3, "extension", slash_commands=("strategy",), needs_ai=True,
        files=("bot/caps_ai/ai_adaptive_weight_suggest.py",), shared_bases=_AI_BASE,
    ),
    "ai_session_summary": CapSpec(
        "ai_session_summary", 3, "extension", needs_ai=True,
        files=("bot/caps_ai/ai_session_summary.py",), shared_bases=_AI_BASE,
    ),
    "ai_variant_q": CapSpec(
        "ai_variant_q", 3, "extension", slash_commands=("variant",), needs_ai=True,
        files=("bot/caps_ai/ai_variant_q.py",), shared_bases=_AI_BASE,
    ),
    "ai_persona": CapSpec("ai_persona", 3, "extension", needs_ai=True),
    "ai_proactive_remind": CapSpec(
        "ai_proactive_remind", 3, "extension", needs_ai=True,
        files=("bot/caps_ai/ai_proactive_remind.py",), shared_bases=_AI_BASE,
        dep_capabilities=("srs_due_alert",),
    ),

    # ── Layer 4 — infrastructure, core (always active) ─────────────────────────
    "gating": CapSpec("gating", 4, "core", files=("bot/harness/automation/gating.py",)),
    "event_trigger": CapSpec("event_trigger", 4, "core"),
    "heartbeat": CapSpec("heartbeat", 4, "core"),
    "coalesce_base": CapSpec("coalesce_base", 4, "core"),

    # ── Layer 4 — infrastructure, extension ────────────────────────────────────
    "perm_preflight": CapSpec("perm_preflight", 4, "extension"),
    "presence_signal": CapSpec("presence_signal", 4, "extension"),
    "channel_scaffold": CapSpec("channel_scaffold", 4, "extension"),
    "dm_private": CapSpec("dm_private", 4, "extension"),
}


# ── Derived sets (boot.py / wiring.py / clone tool consume these) ──────────────

def all_ids() -> frozenset[str]:
    """Every config-selectable capability_id (the boot validation whitelist)."""
    return frozenset(REGISTRY)


def default_core_ids() -> frozenset[str]:
    """Active set when config.capabilities.enabled is unset: all core layer-2 + layer-4."""
    return frozenset(
        cid for cid, s in REGISTRY.items() if s.tier == "core" and s.layer in (2, 4)
    )


def layer4_always() -> frozenset[str]:
    """Layer-4 core capabilities wired regardless of the enabled set."""
    return frozenset(cid for cid, s in REGISTRY.items() if s.layer == 4 and s.tier == "core")


def handlers_for(enabled: set[str] | frozenset[str]) -> dict[str, tuple[str, str]]:
    """capability_id -> (handler_module, handler_fn) for enabled caps that have a dispatch handler."""
    out: dict[str, tuple[str, str]] = {}
    for cid in enabled:
        s = REGISTRY.get(cid)
        if s and s.handler_module and s.handler_fn:
            out[cid] = (s.handler_module, s.handler_fn)
    return out


def commands_for(enabled: set[str] | frozenset[str]) -> set[str]:
    """Set of slash command names owned by at least one enabled capability."""
    out: set[str] = set()
    for cid in enabled:
        s = REGISTRY.get(cid)
        if s:
            out.update(s.slash_commands)
    return out


def command_owners() -> dict[str, set[str]]:
    """slash command name -> set of capability_ids that own it."""
    out: dict[str, set[str]] = {}
    for cid, s in REGISTRY.items():
        for cmd in s.slash_commands:
            out.setdefault(cmd, set()).add(cid)
    return out


def files_for(enabled: set[str] | frozenset[str]) -> set[str]:
    """All required files (files + shared_bases) across the enabled caps, transitive over deps."""
    seen: set[str] = set()
    out: set[str] = set()
    stack = list(enabled)
    while stack:
        cid = stack.pop()
        if cid in seen:
            continue
        seen.add(cid)
        s = REGISTRY.get(cid)
        if not s:
            continue
        out.update(s.files)
        out.update(s.shared_bases)
        stack.extend(s.dep_capabilities)
    return out
