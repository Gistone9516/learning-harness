# -*- coding: utf-8 -*-
"""엔진코어 에러 (SoT _인터페이스계약.md §6). 엔진은 ScoreInputError·SchemaVersionError만 raise.

복구 가능 손상(JSON parse 실패·migrate 예외)은 엔진이 throw하지 않는다 — 봇이 폴백+.bak 처리.
봇 레벨 에러(StorageError·ManifestMissingError·DeckNotFoundError·ContentInjectionError·AIInvokeError)는
봇 패키지에서 정의한다(엔진코어 무관, 엔진 순수성 유지).
"""
from __future__ import annotations


class EngineError(Exception):
    """엔진코어 에러 공통 베이스(식별 가능)."""


class ScoreInputError(EngineError):
    """mode↔user_answer 타입 불일치 · cloze 빈칸수 불일치 · self 비허용값 ·
    알 수 없는 grade_mode · 키에 콜론 포함. 호출자(봇)가 catch."""


class SchemaVersionError(EngineError):
    """저장 스키마 버전 > 코드 SCHEMA_VERSION(다운그레이드 금지). 로드 중단(데이터 보호)."""
