# -*- coding: utf-8 -*-
"""진도/사이드카 파일 I/O (봇 계층, SoT §2·§2.1·§3).

엔진코어가 하지 않는 파일 I/O 전담. harness Store 위에서 동작.
원자적 쓰기(.tmp + replace), .bak 손상 폴백. discord 무관.
"""
from __future__ import annotations

import os
import json
import shutil
import logging
from typing import Any

import _paths
_paths.setup()

from models import ProgressStore, CardProgress, BOX_MIN, SCHEMA_VERSION
from migrate import migrate
from bot_errors import StorageError

log = logging.getLogger(__name__)


def _progress_path(mount: str, deck_namespace: str) -> str:
    """진도 파일 경로: <mount>/_상태/progress-<deck_namespace>.json"""
    return os.path.join(mount, "_상태", f"progress-{deck_namespace}.json")


def _sidecar_path(mount: str, capability_id: str, deck_namespace: str) -> str:
    """사이드카 파일 경로: <mount>/_상태/sidecar-<capability_id>-<deck_namespace>.json"""
    return os.path.join(mount, "_상태", f"sidecar-{capability_id}-{deck_namespace}.json")


def _ensure_state_dir(mount: str) -> None:
    """_상태 디렉터리가 없으면 생성."""
    state_dir = os.path.join(mount, "_상태")
    os.makedirs(state_dir, exist_ok=True)


def _atomic_write(path: str, data: dict) -> None:
    """원자적 JSON 쓰기. 실패 시 StorageError."""
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except OSError as e:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise StorageError(f"파일 쓰기 실패: {path} - {e}") from e


def _load_json_with_bak(path: str) -> dict | None:
    """JSON 로드. parse 실패 시 .bak 시도. 둘 다 실패 시 None 반환(throw 아님)."""
    bak = path + ".bak"
    for target in [path, bak]:
        if not os.path.exists(target):
            continue
        try:
            with open(target, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            log.warning("JSON 로드 실패(%s): %s", target, e)
    return None


def load_progress(mount: str, deck_namespace: str) -> ProgressStore:
    """진도 JSON 로드 -> migrate -> ProgressStore.

    파일 없음 또는 손상 시 빈 스토어 폴백(SchemaVersionError는 재raise).
    """
    path = _progress_path(mount, deck_namespace)
    raw = _load_json_with_bak(path)
    if raw is None:
        log.info("진도 파일 없거나 손상(%s), 빈 스토어로 시작.", path)
        return ProgressStore(schema_version=SCHEMA_VERSION, deck_namespace=deck_namespace)

    # 손상 파일이 있으면 .bak 보존
    bak = path + ".bak"
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                json.load(f)
        except (json.JSONDecodeError, OSError):
            if not os.path.exists(bak):
                shutil.copy2(path, bak)

    try:
        return migrate(raw)
    except Exception as e:
        # SchemaVersionError는 재raise(봇이 판단), 그 외 parse 예외는 폴백
        # 엔진코어의 SchemaVersionError를 클래스 이름으로 판별
        if type(e).__name__ == "SchemaVersionError":
            raise
        log.warning("migrate 실패(%s): %s, 빈 스토어로 폴백.", path, e)
        if os.path.exists(path) and not os.path.exists(bak):
            shutil.copy2(path, bak)
        return ProgressStore(schema_version=SCHEMA_VERSION, deck_namespace=deck_namespace)


def save_progress(mount: str, store: ProgressStore) -> None:
    """ProgressStore -> JSON 원자적 저장. 실패 시 StorageError."""
    _ensure_state_dir(mount)
    path = _progress_path(mount, store.deck_namespace)

    cards_data = {}
    for card_id, cp in store.cards.items():
        cards_data[card_id] = {
            "card_id": cp.card_id,
            "box": cp.box,
            "due_at": cp.due_at,
            "graduated": cp.graduated,
            "cold_attempts": cp.cold_attempts,
            "cold_correct": cp.cold_correct,
            "last_attempt_at": cp.last_attempt_at,
            "last_verdict": cp.last_verdict,
        }

    data = {
        "schema_version": store.schema_version,
        "deck_namespace": store.deck_namespace,
        "cards": cards_data,
    }
    _atomic_write(path, data)


def load_sidecar(mount: str, capability_id: str, deck_namespace: str) -> dict:
    """사이드카 JSON 로드. 없거나 손상 시 빈 dict 폴백."""
    path = _sidecar_path(mount, capability_id, deck_namespace)
    raw = _load_json_with_bak(path)
    return raw if isinstance(raw, dict) else {}


def save_sidecar(mount: str, capability_id: str, deck_namespace: str, data: dict) -> None:
    """사이드카 JSON 원자적 저장."""
    _ensure_state_dir(mount)
    path = _sidecar_path(mount, capability_id, deck_namespace)
    _atomic_write(path, data)
