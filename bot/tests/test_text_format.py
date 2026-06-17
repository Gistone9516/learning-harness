# -*- coding: utf-8 -*-
"""Tests for the kit-wide table formatter (bot/text_format.py)."""
import os
import sys

_BOT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BOT_ROOT)

import _paths
_paths.setup()

from text_format import display_width, pad, render_table, format_tables


def test_display_width_cjk_is_double():
    assert display_width("ab") == 2
    assert display_width("현재") == 4        # each Korean char = 2
    assert display_width("a현") == 3
    assert display_width("") == 0


def test_pad_to_display_width():
    assert display_width(pad("현재", 8)) == 8
    assert display_width(pad("ab", 8)) == 8
    assert pad("abcd", 2) == "abcd"          # never truncates


def test_render_table_aligns_cjk_exactly():
    out = render_table(["a", "b"], [["현재", "x"], ["c", "넓은값"]])
    expected = "```\na     b\n----  ------\n현재  x\nc     넓은값\n```"
    assert out == expected


def test_format_tables_converts_pipe_table():
    text = "비교표\n| 시제 | 예문 |\n|---|---|\n| 현재 | I eat |\n끝."
    out = format_tables(text)
    assert "```" in out
    assert "비교표" in out and "끝." in out      # prose preserved
    assert "|---|" not in out                     # separator gone
    assert "시제" in out and "I eat" in out       # cells preserved
    assert "| 시제 |" not in out                  # raw pipe header converted


def test_format_tables_noop_on_plain_text():
    assert format_tables("hello world\nno tables here") == "hello world\nno tables here"
    assert format_tables("") == ""


def test_format_tables_skips_fenced_block():
    text = "```\n| a | b |\n|---|---|\n| 1 | 2 |\n```"
    assert format_tables(text) == text            # inside a code fence: untouched


def test_format_tables_ignores_header_without_separator():
    text = "| a | b |\njust text, not a separator"
    assert format_tables(text) == text            # no |---| row -> not a table


def test_livetable_korean_render_smoke():
    from livetable import LiveTable
    t = LiveTable(None, "제목", columns=["영역", "개수"])
    t.set_row("k1", 영역="문법", 개수="3")
    t.set_row("k2", 영역="숙어표현", 개수="12")
    view = t._render()                            # delegates to render_table, CJK-aware
    assert view is not None
