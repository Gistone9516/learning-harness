# -*- coding: utf-8 -*-
"""State store: record-per-file storage with a derived index (state layer contract).

Covers the invariants the layer promises: one record is one file, the index is a pure derivative
that can always be rebuilt, drift is detectable, and names can never escape the state root.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from state_store import StateError, StateStore  # noqa: E402


def _record(rid: str, kind: str = "project", **summary):
    return {"id": rid, "kind": kind, "summary": summary or {"title": rid}, "data": {"body": "x"}}


@pytest.fixture()
def store(tmp_path):
    ticks = {"n": 1_000}

    def clock():
        ticks["n"] += 1
        return ticks["n"]

    return StateStore(tmp_path, clock=clock)


def test_record_is_one_file_and_index_is_derived(store, tmp_path):
    store.write_record("projects", "prj-a", _record("prj-a", title="A"))
    store.write_record("projects", "prj-b", _record("prj-b", title="B"))

    files = sorted(p.name for p in (tmp_path / "projects").glob("*.json"))
    assert files == ["index.json", "prj-a.json", "prj-b.json"]

    entries = store.read_index("projects")["entries"]
    assert [e["id"] for e in entries] == ["prj-a", "prj-b"]
    # The entry carries the record summary verbatim; the payload stays out of the index.
    assert entries[0]["summary"] == {"title": "A"}
    assert "data" not in entries[0]


def test_write_is_upsert_and_preserves_created_at(store):
    first = store.write_record("projects", "prj-a", _record("prj-a", title="A"))
    second = store.write_record("projects", "prj-a", _record("prj-a", title="A2"))

    assert second["created_at"] == first["created_at"]
    assert second["updated_at"] > first["updated_at"]
    assert len(store.read_index("projects")["entries"]) == 1
    assert store.read_record("projects", "prj-a")["summary"]["title"] == "A2"


def test_delete_removes_file_and_entry(store):
    store.write_record("projects", "prj-a", _record("prj-a"))
    assert store.delete_record("projects", "prj-a") is True
    assert store.read_record("projects", "prj-a") is None
    assert store.read_index("projects")["entries"] == []
    assert store.delete_record("projects", "prj-a") is False


def test_verify_detects_drift_and_rebuild_repairs(store, tmp_path):
    store.write_record("projects", "prj-a", _record("prj-a"))
    store.write_record("projects", "prj-b", _record("prj-b"))

    # Simulate a record file removed behind the store's back, and one added without an entry.
    (tmp_path / "projects" / "prj-b.json").unlink()
    with (tmp_path / "projects" / "prj-c.json").open("w", encoding="utf-8") as fh:
        json.dump({"id": "prj-c", "kind": "project", "created_at": 1, "updated_at": 1,
                   "summary": {"title": "C"}, "data": {}}, fh)

    issues = {(i["issue"], i["id"]) for i in store.verify("projects")}
    assert ("missing_record", "prj-b") in issues
    assert ("missing_entry", "prj-c") in issues

    assert store.rebuild("projects") == 2
    assert store.verify("projects") == []
    assert {e["id"] for e in store.read_index("projects")["entries"]} == {"prj-a", "prj-c"}


def test_missing_collection_reads_as_empty_index(store):
    assert store.read_index("history")["entries"] == []
    assert store.read_record("history", "none") is None


@pytest.mark.parametrize("bad", ["../escape", "a/b", "UPPER", "with_underscore", "", "x" * 65, ".hidden"])
def test_names_that_could_escape_the_root_are_rejected(store, bad):
    with pytest.raises(StateError) as e:
        store.write_record(bad, "prj-a", _record("prj-a"))
    assert e.value.status == 400

    with pytest.raises(StateError):
        store.write_record("projects", bad, _record("prj-a"))


def test_reserved_actions_cannot_be_record_ids(store):
    # The id pattern forbids underscores, so _verify / _rebuild can never name a record.
    for reserved in ("_verify", "_rebuild"):
        with pytest.raises(StateError):
            store.write_record("projects", reserved, _record(reserved))


def test_envelope_validation(store):
    with pytest.raises(StateError):  # id in body disagrees with the path
        store.write_record("projects", "prj-a", _record("prj-other"))
    with pytest.raises(StateError):  # kind is required
        store.write_record("projects", "prj-a", {"id": "prj-a", "summary": {}})
    with pytest.raises(StateError):  # summary must stay small enough to index
        store.write_record("projects", "prj-a", {"id": "prj-a", "kind": "project",
                                                 "summary": {"blob": "x" * 5000}})


def test_docs_round_trip_and_stamp_updated_at(store):
    assert store.read_doc("tuning") is None
    written = store.write_doc("tuning", {"defaults": {"scale": "medium"}})
    assert written["defaults"]["scale"] == "medium"
    assert written["updated_at"] > 0
    assert store.read_doc("tuning")["defaults"]["scale"] == "medium"


def test_no_partial_file_survives_a_failed_write(store, tmp_path, monkeypatch):
    import state_store

    def boom(*_a, **_k):
        raise OSError("disk full")

    monkeypatch.setattr(state_store.os, "replace", boom)
    with pytest.raises(StateError):
        store.write_record("projects", "prj-a", _record("prj-a"))

    leftovers = list((tmp_path / "projects").glob("*"))
    assert leftovers == [], f"temp file left behind: {leftovers}"
