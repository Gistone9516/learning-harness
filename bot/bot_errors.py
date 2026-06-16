# -*- coding: utf-8 -*-
"""Bot-level errors (SoT _interface-contract.md §6).

Errors raised only in the bot layer, separate from engine errors
(ScoreInputError, SchemaVersionError). No discord import — pure Python.
"""
from __future__ import annotations


class BotError(Exception):
    """Common base for bot-level errors."""


class StorageError(BotError):
    """File write failed or quota exceeded. Recommend export after throw (SoT §6)."""


class ManifestMissingError(BotError):
    """manifest.json missing at mount path. Boot failure (SoT §6)."""


class DeckNotFoundError(BotError):
    """Requested namespace not found in registry (SoT §6)."""


class ContentInjectionError(BotError):
    """Injected content or config violates schema. Blocks boot (SoT §6, injection-interface §6)."""


class AIInvokeError(BotError):
    """claude -p subprocess failed or timed out. Catch and fall back gracefully (SoT §6)."""
