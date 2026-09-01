# -*- coding: utf-8 -*-
"""Generic record store for instance state (web-contract state layer).

Model: a mounted state root holds *docs* (bounded settings, one JSON file) and *collections*
(one record per file plus a derived index). Records are never appended to a shared log file:
one record is one file, and the index is regenerated from those files at any time.

    <root>/<doc>.json                     doc
    <root>/<collection>/<id>.json         record
    <root>/<collection>/index.json        derived index (entries copied from each record summary)

The index is a pure derivative of the records, so it cannot drift: rebuild() reproduces it by
scanning the folder and verify() reports any mismatch.

Subject-agnostic: collection names, record kinds and summary fields are decided by the consuming
instance, never by this module. Pure synchronous file logic with no HTTP or asyncio concern; the
server owns concurrency (one lock per collection) and transport.
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any, Callable

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
INDEX_FILE = "index.json"
INDEX_VERSION = 1
SCHEMA_VERSION = 1
MAX_SUMMARY_BYTES = 4096


class StateError(Exception):
    """Store-level failure carrying the HTTP status the server should report."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _now_ms() -> int:
    return int(time.time() * 1000)


def _check_name(name: str, what: str) -> str:
    """Names are the only thing that reaches the filesystem, so they are strictly validated.

    The pattern excludes dots, slashes and underscores, which rules out path traversal and keeps
    the reserved _verify / _rebuild actions from ever colliding with a real id.
    """
    if not isinstance(name, str) or not NAME_RE.match(name):
        raise StateError(400, f"invalid {what}")
    return name


def _read_json(path: Path) -> Any | None:
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError) as e:
        raise StateError(500, f"unreadable file: {e}")


def _write_json_atomic(path: Path, payload: Any) -> None:
    """Write through a temp file in the same directory, then replace.

    A crash mid-write leaves the previous file intact instead of a truncated one becoming the
    source of truth.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    try:
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except OSError as e:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise StateError(500, f"write failed: {e}")


def _entry_of(record: dict) -> dict:
    return {
        "id": record["id"],
        "kind": record["kind"],
        "created_at": record["created_at"],
        "updated_at": record["updated_at"],
        "summary": record.get("summary") or {},
    }


class StateStore:
    """File-backed record store rooted at a mounted state folder."""

    def __init__(self, root: str | Path, *, clock: Callable[[], int] = _now_ms) -> None:
        self.root = Path(root)
        self._clock = clock

    # ── paths ────────────────────────────────────────────────────────────────

    def _doc_path(self, name: str) -> Path:
        return self.root / f"{_check_name(name, 'doc name')}.json"

    def _coll_dir(self, collection: str) -> Path:
        return self.root / _check_name(collection, "collection")

    def _record_path(self, collection: str, record_id: str) -> Path:
        return self._coll_dir(collection) / f"{_check_name(record_id, 'id')}.json"

    def _index_path(self, collection: str) -> Path:
        return self._coll_dir(collection) / INDEX_FILE

    # ── docs ─────────────────────────────────────────────────────────────────

    def read_doc(self, name: str) -> dict | None:
        doc = _read_json(self._doc_path(name))
        return doc if isinstance(doc, dict) else None

    def write_doc(self, name: str, doc: dict) -> dict:
        if not isinstance(doc, dict):
            raise StateError(400, "doc must be an object")
        payload = dict(doc)
        payload.setdefault("schema_version", SCHEMA_VERSION)
        payload["updated_at"] = self._clock()
        _write_json_atomic(self._doc_path(name), payload)
        return payload

    # ── records ──────────────────────────────────────────────────────────────

    def read_record(self, collection: str, record_id: str) -> dict | None:
        record = _read_json(self._record_path(collection, record_id))
        return record if isinstance(record, dict) else None

    def write_record(self, collection: str, record_id: str, record: dict) -> dict:
        """Validate, persist the record, then refresh its index entry.

        Returns the index entry that was stored. The record file is written first: if the process
        dies before the index is updated the record still exists and rebuild() recovers the entry,
        whereas the reverse order would advertise a record that was never written.
        """
        _check_name(collection, "collection")
        _check_name(record_id, "id")
        if not isinstance(record, dict):
            raise StateError(400, "record must be an object")

        body_id = record.get("id", record_id)
        if body_id != record_id:
            raise StateError(400, "id mismatch between path and body")
        kind = record.get("kind")
        if not isinstance(kind, str) or not kind.strip():
            raise StateError(400, "record.kind is required")
        summary = record.get("summary") or {}
        if not isinstance(summary, dict):
            raise StateError(400, "record.summary must be an object")
        if len(json.dumps(summary, ensure_ascii=False).encode("utf-8")) > MAX_SUMMARY_BYTES:
            raise StateError(400, "record.summary too large")

        now = self._clock()
        existing = self.read_record(collection, record_id)
        created_at = record.get("created_at")
        if not isinstance(created_at, int):
            created_at = existing.get("created_at") if isinstance(existing, dict) else None
        if not isinstance(created_at, int):
            created_at = now

        stored = dict(record)
        stored["schema_version"] = record.get("schema_version", SCHEMA_VERSION)
        stored["id"] = record_id
        stored["kind"] = kind
        stored["created_at"] = created_at
        stored["updated_at"] = now
        stored["summary"] = summary
        stored.setdefault("data", {})

        _write_json_atomic(self._record_path(collection, record_id), stored)
        entry = _entry_of(stored)
        self._upsert_entry(collection, entry)
        return entry

    def delete_record(self, collection: str, record_id: str) -> bool:
        path = self._record_path(collection, record_id)
        existed = path.exists()
        try:
            path.unlink(missing_ok=True)
        except OSError as e:
            raise StateError(500, f"delete failed: {e}")
        self._remove_entry(collection, record_id)
        return existed

    # ── index ────────────────────────────────────────────────────────────────

    def read_index(self, collection: str) -> dict:
        index = _read_json(self._index_path(collection))
        if not isinstance(index, dict) or not isinstance(index.get("entries"), list):
            return {"version": INDEX_VERSION, "collection": collection, "updated_at": 0, "entries": []}
        index.setdefault("collection", collection)
        return index

    def _write_index(self, collection: str, entries: list[dict]) -> None:
        entries.sort(key=lambda e: (e.get("created_at", 0), e.get("id", "")))
        _write_json_atomic(
            self._index_path(collection),
            {
                "version": INDEX_VERSION,
                "collection": collection,
                "updated_at": self._clock(),
                "entries": entries,
            },
        )

    def _upsert_entry(self, collection: str, entry: dict) -> None:
        entries = [e for e in self.read_index(collection)["entries"] if e.get("id") != entry["id"]]
        entries.append(entry)
        self._write_index(collection, entries)

    def _remove_entry(self, collection: str, record_id: str) -> None:
        entries = [e for e in self.read_index(collection)["entries"] if e.get("id") != record_id]
        self._write_index(collection, entries)

    def _record_files(self, collection: str) -> list[Path]:
        folder = self._coll_dir(collection)
        if not folder.is_dir():
            return []
        return [
            p for p in sorted(folder.glob("*.json"))
            if p.name != INDEX_FILE and not p.name.startswith(".")
        ]

    def rebuild(self, collection: str) -> int:
        """Regenerate the index from the record files. The index is a derivative, so this is
        always safe and is the repair path for any drift verify() reports."""
        entries: list[dict] = []
        for path in self._record_files(collection):
            record = _read_json(path)
            if not isinstance(record, dict) or not record.get("kind"):
                continue
            record.setdefault("id", path.stem)
            record.setdefault("created_at", 0)
            record.setdefault("updated_at", record["created_at"])
            entries.append(_entry_of(record))
        self._write_index(collection, entries)
        return len(entries)

    def verify(self, collection: str) -> list[dict]:
        """Report index/record mismatches without changing anything.

        issue kinds: missing_record (indexed but no file), missing_entry (file but not indexed),
        stale_entry (updated_at differs), unreadable_record.
        """
        issues: list[dict] = []
        indexed = {e.get("id"): e for e in self.read_index(collection)["entries"] if e.get("id")}
        on_disk: dict[str, dict] = {}
        for path in self._record_files(collection):
            record = _read_json(path)
            if not isinstance(record, dict):
                issues.append({"issue": "unreadable_record", "id": path.stem})
                continue
            on_disk[record.get("id", path.stem)] = record

        for rid in sorted(set(indexed) - set(on_disk)):
            issues.append({"issue": "missing_record", "id": rid})
        for rid in sorted(set(on_disk) - set(indexed)):
            issues.append({"issue": "missing_entry", "id": rid})
        for rid in sorted(set(indexed) & set(on_disk)):
            if indexed[rid].get("updated_at") != on_disk[rid].get("updated_at"):
                issues.append({"issue": "stale_entry", "id": rid})
        return issues

    def collections(self) -> list[str]:
        if not self.root.is_dir():
            return []
        return sorted(p.name for p in self.root.iterdir() if p.is_dir() and NAME_RE.match(p.name))
