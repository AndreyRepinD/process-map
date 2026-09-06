# -*- coding: utf-8 -*-
"""Генератор importer source для карты MEIO: scripts/author/meio.json → pptx.

    python scripts/author/meio.py

Печатает расхождения таблиц STEP_DESCRIPTIONS / STAGE_KEY_OUTPUTS импортёра с
authoring source и возвращает 1, если они есть. Устройство и правила разбора —
в docstring scripts/author/slidegen.py.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from slidegen import main  # noqa: E402 — путь надо поправить до импорта

if __name__ == "__main__":
    sys.exit(main("meio", "MEIO", "06-09-2026"))
