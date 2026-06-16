# -*- coding: utf-8 -*-
"""봇 레벨 에러 (SoT _인터페이스계약.md §6).

엔진코어 에러(ScoreInputError, SchemaVersionError)와 별개로 봇 계층에서만 발생하는 에러.
discord import 없음 — 순수 파이썬.
"""
from __future__ import annotations


class BotError(Exception):
    """봇 레벨 에러 공통 베이스."""


class StorageError(BotError):
    """파일 쓰기 실패 또는 쿼터 초과. throw 후 export 권고(SoT §6)."""


class ManifestMissingError(BotError):
    """마운트 경로에 manifest.json 없음. 부트 실패(SoT §6)."""


class DeckNotFoundError(BotError):
    """요청한 namespace가 레지스트리에 없음(SoT §6)."""


class ContentInjectionError(BotError):
    """주입 콘텐츠 또는 config 스키마 위반. 부트 차단(SoT §6, 주입인터페이스 §6)."""


class AIInvokeError(BotError):
    """claude -p 서브프로세스 실패 또는 타임아웃. catch 후 graceful 폴백(SoT §6)."""
