# -*- coding: utf-8 -*-
"""Engine errors (SoT specs/_interface-contract.md §6). The engine raises only ScoreInputError and SchemaVersionError.

Recoverable corruption (JSON parse failure, migrate exceptions) is not thrown by the engine — the bot handles fallback and .bak processing.
Bot-level errors (StorageError, ManifestMissingError, DeckNotFoundError, ContentInjectionError, AIInvokeError) are
defined in the bot package (unrelated to the engine, keeping the engine pure).
"""
from __future__ import annotations


class EngineError(Exception):
    """Common base for engine errors (identifiable)."""


class ScoreInputError(EngineError):
    """mode vs user_answer type mismatch, cloze blank-count mismatch, invalid self value,
    unknown grade_mode, or colon in key. Caught by the caller (bot)."""


class SchemaVersionError(EngineError):
    """Storage schema version > code SCHEMA_VERSION (downgrade not allowed). Aborts load to protect data."""
