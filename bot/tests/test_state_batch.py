# -*- coding: utf-8 -*-
"""/state/_snapshot and /state/_batch (web-contract §2.2): whole-state reads that save round trips."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _paths
_paths.setup()

import ai_server
from state_store import StateStore


def _store(tmp_path):
    s = StateStore(tmp_path)
    s.write_doc("outline", {"areas": [{"key": "a"}]})
    s.write_doc("quiz-log", {"items": {}})
    s.write_record("terms", "ebs", {"kind": "term", "id": "ebs", "summary": {"type": "acronym"}, "data": {"headword": "EBS"}})
    s.write_record("terms", "efs", {"kind": "term", "id": "efs", "summary": {"type": "acronym"}, "data": {"headword": "EFS"}})
    return s


def _call(method, path, payload, store):
    return asyncio.run(ai_server.handle_state(method, path, payload, store))


def test_snapshot_has_docs_and_indexes_but_no_bodies(tmp_path):
    store = _store(tmp_path)
    status, body = _call("GET", "/state/_snapshot", {}, store)
    assert status == 200 and body["ok"]
    assert set(body["docs"]) == {"outline", "quiz-log"}
    assert body["docs"]["outline"]["areas"] == [{"key": "a"}]
    assert [e["id"] for e in body["indexes"]["terms"]["entries"]] == ["ebs", "efs"]
    assert "data" not in body["indexes"]["terms"]["entries"][0]
    assert _call("POST", "/state/_snapshot", {}, store)[0] == 405


def test_batch_reads_in_order_with_nulls(tmp_path):
    store = _store(tmp_path)
    reads = [{"doc": "outline"}, {"list": "terms"}, {"get": ["terms", "efs"]}, {"get": ["terms", "nope"]},
             {"doc": "missing"}, {"get": ["../x", "y"]}, {"what": 1}, "bad"]
    status, body = _call("POST", "/state/_batch", {"reads": reads}, store)
    assert status == 200 and body["ok"]
    r = body["results"]
    assert len(r) == len(reads)
    assert r[0]["areas"] == [{"key": "a"}]
    assert [e["id"] for e in r[1]["entries"]] == ["ebs", "efs"]
    assert r[2]["data"] == {"headword": "EFS"}
    assert r[3:] == [None, None, None, None, None]


def test_batch_limits(tmp_path):
    store = _store(tmp_path)
    assert _call("POST", "/state/_batch", {"reads": [{"doc": "outline"}] * 201}, store)[0] == 400
    assert _call("POST", "/state/_batch", {"reads": "x"}, store)[0] == 400
    assert _call("GET", "/state/_batch", {}, store)[0] == 405
