# -*- coding: utf-8 -*-
"""Parity + integrity tests for the capability registry.

Guards that the registry-derived sets exactly equal the pre-refactor boot.py
literals (frozen snapshots below), and that every declared file/handler exists.
"""
import os
import sys

# Add bot root to sys.path (same convention as the other bot tests).
_BOT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BOT_ROOT)

import _paths
_paths.setup()

import capability_registry as reg

_ROOT = os.path.dirname(_BOT_ROOT)

# ── Frozen snapshots of the original boot.py literals (pre-refactor) ────────────
OLD_WHITELIST = {
    "card_render", "recall_self", "mcq_buttons", "mcq_select", "short_modal",
    "cloze_modal", "seq_modal", "reaction_quick",
    "feedback_inline", "paginate",
    "confidence_rate", "hint_progressive", "elaborate_ask", "read_resume",
    "srs_due_alert", "session_progress",
    "dashboard_live", "box_table", "digest_weekly",
    "gating", "event_trigger", "heartbeat", "coalesce_base",
    "quiz_poll", "concept_link", "preview_then_test", "session_thread",
    "exam_delayed", "mastery_chart", "weakness_wiki", "content_hotreload",
    "curate_contextmenu", "pin_rotate", "control_panel",
    "perm_preflight", "presence_signal", "channel_scaffold", "dm_private",
    "ai_openend_grade", "ai_socratic", "ai_hint", "ai_generate_items",
    "ai_personal_feedback", "ai_misconception", "ai_adaptive_weight",
    "ai_session_summary", "ai_stream_render", "ai_variant_q",
    "ai_persona", "ai_proactive_remind",
}

OLD_DEFAULT_CORE = {
    "card_render", "recall_self", "mcq_buttons", "mcq_select",
    "short_modal", "cloze_modal", "seq_modal", "reaction_quick",
    "feedback_inline", "paginate",
    "confidence_rate", "hint_progressive", "elaborate_ask", "read_resume",
    "srs_due_alert", "session_progress",
    "dashboard_live", "box_table", "digest_weekly",
    "gating", "event_trigger", "heartbeat", "coalesce_base",
}

OLD_LAYER4_ALWAYS = {"gating", "event_trigger", "heartbeat", "coalesce_base"}


def test_whitelist_parity():
    assert set(reg.all_ids()) == OLD_WHITELIST


def test_default_core_parity():
    assert set(reg.default_core_ids()) == OLD_DEFAULT_CORE


def test_layer4_always_parity():
    assert set(reg.layer4_always()) == OLD_LAYER4_ALWAYS


def test_declared_files_exist():
    missing = [p for p in reg.files_for(reg.all_ids()) if not os.path.exists(os.path.join(_ROOT, p))]
    assert missing == [], f"declared files missing on disk: {missing}"


def test_handler_modules_map_to_files():
    # "handlers.recall_self" -> bot/handlers/recall_self.py must exist.
    for cid, (mod, fn) in reg.handlers_for(reg.all_ids()).items():
        rel = "bot/" + mod.replace(".", "/") + ".py"
        assert os.path.exists(os.path.join(_ROOT, rel)), f"{cid}: handler file {rel} missing"
        assert fn == "handle", f"{cid}: unexpected handler_fn {fn!r}"


def test_command_owners_cover_gated_commands():
    owners = reg.command_owners()
    # Every command owned by a capability resolves to >=1 owner; spot-check the known set.
    for cmd in ("dashboard", "digest", "socratic", "misconception", "strategy", "generate", "variant"):
        assert cmd in owners and owners[cmd], f"command {cmd} has no owning capability"


def test_core_kernel_files_exist():
    for p in reg.CORE_KERNEL_FILES:
        # study_select.py and wiring.py are created later in the refactor; allow them to be absent for now.
        if p in ("bot/study_select.py", "bot/wiring.py"):
            continue
        assert os.path.exists(os.path.join(_ROOT, p)), f"core kernel file missing: {p}"
