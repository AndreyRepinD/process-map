# -*- coding: utf-8 -*-
"""
slidegen.py — importer source из authoring source.

Читает scripts/author/<map>.json (данные владельца, CONTENT_FROZEN) и рисует
ОДИН слайд в профиле `single-slide` импортёра — «In.Plan <MAP> process <дата>.pptx».

ЗАЧЕМ ГЕНЕРАТОР, А НЕ РУЧНАЯ ПРЕЗЕНТАЦИЯ. Профиль single-slide предъявляет к
фигурам требования, которые глазами не видны и руками не воспроизводятся
надёжно: заливка ровно `scheme:accent2` у плашек, `noFill` у контейнеров,
однострочный заголовок в окне 1 200 000 EMU над контейнером, а главное —
ВХОДОМ считается только плашка, левый край которой не дальше 1 828 800 EMU
(15 % ширины слайда) от кромки. Плашка, поставленная «поближе к своему этапу»,
опознаётся выходом и роняет импорт. Все эти правила замерены на синтетическом
зонде, а не выведены из описания.

ЭТО НОСИТЕЛЬ ДЛЯ ИМПОРТЁРА, А НЕ СЛАЙД ДЛЯ КОЛОДЫ (решение владельца от
06.09.2026). Из-за правила про левое поле все входы всех этапов стоят общей
левой колонкой и тянутся до своих шагов через весь слайд; часть коннекторов
пересекает текст подписей. Без переноса входов это не лечится, а перенос ломает
разбор. Слайд для показа людям собирается отдельно.

ЧТО ГЕНЕРАТОР МЕНЯТЬ ВПРАВЕ. Только координаты, размеры, переносы строк и
технические свойства фигур. Содержание (label, порядок, входы/выходы, рёбра)
приходит из authoring source и после «ок» владельца заморожено.

ЧЕГО ГЕНЕРАТОР НЕ ДЕЛАЕТ. Не рисует description и keyOutputs: на слайд они не
помещаются (замер: у DP этап 2 несёт 4 шага, и прозаические блоки описаний дают
8,4 млн EMU при 6,0 млн доступных). Они приходят таблицами решений владельца
STEP_DESCRIPTIONS / STAGE_KEY_OUTPUTS в scripts/import-pptx.py, а сверку таблиц
с этим же JSON делает scripts/author/<map>.py.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import MSO_THEME_COLOR
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Pt

# --- геометрия слайда (EMU) ------------------------------------------------
SLIDE_W = 12_192_000
SLIDE_H = 6_858_000

# Левое поле импортёра: плашка с left <= этого значения — вход, иначе выход.
# scripts/import-pptx.py::LEFT_MARGIN_LIMIT = SLIDE_WIDTH_EMU * 15 // 100.
LEFT_MARGIN_LIMIT = SLIDE_W * 15 // 100      # 1 828 800

PLATE_X = 100_000
PLATE_W = 1_600_000                          # правый край 1 700 000 < лимита
PLATE_MIN_H = 620_000

# Контейнер этапа обязан быть шире CONTAINER_MIN_WIDTH = 2 000 000, иначе
# импортёр не признает его контейнером и этапа не будет вовсе.
CONTAINER_MIN_W = 2_020_000
COLUMNS_X0 = 1_880_000
COLUMNS_X1 = 12_150_000
COLUMN_GAP = 30_000
CONTAINER_TOP = 980_000
CONTAINER_H = 5_500_000

TITLE_H = 380_000
TITLE_TOP = CONTAINER_TOP - 480_000          # в окне [top-1 200 000, top)

STEP_PAD = 60_000
STEP_H = 620_000
CAPTION_GAP = 100_000                        # в окне [-100 000, 400 000]
CAPTION_LINE_H = 168_000
BLOCK_GAP = 150_000

# Средняя ширина знака подписи (9 pt) в EMU. Нужна, чтобы считать высоту блока
# по ЧИСЛУ ВИЗУАЛЬНЫХ СТРОК, а не по числу пунктов: длинный пункт переносится, и
# блок из трёх пунктов может занять четыре строки. При расчёте по пунктам
# подпись под «Building Blocks и корректировки» налезала на следующую карточку.
CAPTION_CHAR_W = 58_000

# Дальше этого по горизонтали связь рисуется коленчатым коннектором.
FAR_CONNECTOR_SPAN = 2_600_000


def _fill(shape, accent: str) -> None:
    shape.fill.solid()
    shape.fill.fore_color.theme_color = {
        "accent1": MSO_THEME_COLOR.ACCENT_1,
        "accent2": MSO_THEME_COLOR.ACCENT_2,
    }[accent]


def _shape(slide, kind, left, top, width, height, text=None, size=Pt(10)):
    s = slide.shapes.add_shape(kind, Emu(left), Emu(top), Emu(width), Emu(height))
    tf = s.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf.text = "" if text is None else text
    for para in tf.paragraphs:
        para.alignment = PP_ALIGN.CENTER
        for run in para.runs:
            run.font.size = size
    return s


def _textbox(slide, left, top, width, height, paragraphs, size=Pt(9), bold=False):
    tb = slide.shapes.add_textbox(Emu(left), Emu(top), Emu(width), Emu(height))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.text = paragraphs[0]
    for extra in paragraphs[1:]:
        tf.add_paragraph().text = extra
    for para in tf.paragraphs:
        for run in para.runs:
            run.font.size = size
            run.font.bold = bold
    return tb


def _caption_height(items, width: int) -> int:
    """Высота блока подписи с учётом переносов длинных пунктов."""
    per_line = max(1, width // CAPTION_CHAR_W)
    lines = sum(max(1, -(-len(item) // per_line)) for item in items)
    return lines * CAPTION_LINE_H


def _connect(slide, src, dst) -> None:
    """
    Коннектор с ПРИВЯЗКАМИ. Импортёр читает a:stCxn/a:endCxn раньше геометрии,
    поэтому связь не теряется, даже если bbox коннектора уедет за кромку слайда
    (ровно этот дефект чинили привязками на слайде 8 карты MRP).

    Стороны выбираются по взаимному положению фигур: вниз — низ→верх,
    вправо — право→лево. Точка привязки прямоугольника: 0 верх, 1 лево,
    2 низ, 3 право.
    """
    sx, sy = int(src.left) + int(src.width) / 2, int(src.top) + int(src.height) / 2
    dx, dy = int(dst.left) + int(dst.width) / 2, int(dst.top) + int(dst.height) / 2
    if abs(dx - sx) >= abs(dy - sy):
        begin, end = (3, 1) if dx >= sx else (1, 3)
    else:
        begin, end = (2, 0) if dy >= sy else (0, 2)

    # Прямой коннектор через полслайда идёт диагональю поверх подписей соседних
    # этапов. Для дальних связей (плашки-входы лежат общей левой колонкой и
    # тянутся к своим шагам через весь слайд) берём коленчатый: он идёт по
    # ортогоналям и текст не перечёркивает. На разбор это не влияет — импортёр
    # читает привязки, а не форму линии.
    far = abs(dx - sx) > FAR_CONNECTOR_SPAN
    conn = slide.shapes.add_connector(
        MSO_CONNECTOR.ELBOW if far else MSO_CONNECTOR.STRAIGHT,
        Emu(int(sx)), Emu(int(sy)), Emu(int(dx)), Emu(int(dy)),
    )
    conn.begin_connect(src, begin)
    conn.end_connect(dst, end)
    # Стрелка на конце = направление начало→конец (read_line_ends).
    ln = conn.line._get_or_add_ln()  # noqa: SLF001 — публичного доступа нет
    ln.append(ln.makeelement(qn("a:tailEnd"), {"type": "triangle"}))


def build(author_path: Path, out_path: Path) -> dict:
    doc = json.loads(author_path.read_text(encoding="utf-8"))
    stages = doc["stages"]

    prs = Presentation()
    prs.slide_width = Emu(SLIDE_W)
    prs.slide_height = Emu(SLIDE_H)
    slide = prs.slides.add_slide(prs.slide_layouts[6])   # пустой макет: плейсхолдеров нет

    # Колонки этапов. Ширина не может быть меньше CONTAINER_MIN_W — иначе
    # контейнер перестаёт быть контейнером; при большом числе этапов это
    # обязано падать, а не молча ужиматься.
    count = len(stages)
    span = COLUMNS_X1 - COLUMNS_X0 - COLUMN_GAP * (count - 1)
    column_w = span // count
    if column_w < CONTAINER_MIN_W:
        raise SystemExit(
            f"{count} этапов не помещаются: колонка {column_w} EMU при минимуме "
            f"{CONTAINER_MIN_W}. Это решение владельца о раскладке, а не правка содержания."
        )

    shapes_by_key: dict[str, object] = {}
    inbound: list[dict] = []     # плашки-входы: рисуются общей левой колонкой

    for index, stage in enumerate(stages):
        left = COLUMNS_X0 + index * (column_w + COLUMN_GAP)
        container = _shape(slide, MSO_SHAPE.RECTANGLE, left, CONTAINER_TOP, column_w, CONTAINER_H)
        container.fill.background()          # noFill — признак контейнера
        container.line.fill.background()
        _textbox(slide, left, TITLE_TOP, column_w, TITLE_H, [stage["title"]], size=Pt(11), bold=True)

        cursor = CONTAINER_TOP + STEP_PAD
        step_w = column_w - 2 * STEP_PAD
        for step in stage["steps"]:
            box = _shape(
                slide, MSO_SHAPE.ROUNDED_RECTANGLE,
                left + STEP_PAD, cursor, step_w, STEP_H, step["label"],
            )
            _fill(box, "accent1")
            shapes_by_key[step["key"]] = box
            cursor += STEP_H
            items = step.get("inputs") or []
            if items:
                height = _caption_height(items, step_w)
                _textbox(slide, left + STEP_PAD, cursor + CAPTION_GAP, step_w, height, items)
                cursor += CAPTION_GAP + height
            cursor += BLOCK_GAP

        for external in stage.get("externals", []):
            if external["direction"] == "in":
                inbound.append(external)
                continue
            plate = _shape(
                slide, MSO_SHAPE.RECTANGLE,
                left + STEP_PAD, cursor, step_w, PLATE_MIN_H, external["label"], size=Pt(9),
            )
            _fill(plate, "accent2")           # признак плашки-артефакта
            shapes_by_key["out:" + external["label"]] = plate
            cursor += PLATE_MIN_H + BLOCK_GAP

    # Плашки-входы — ОБЩЕЙ левой колонкой, иначе импортёр признает их выходами.
    plate_top = CONTAINER_TOP
    available = CONTAINER_H - PLATE_MIN_H
    step_down = available // max(len(inbound) - 1, 1) if len(inbound) > 1 else 0
    for order, external in enumerate(inbound):
        plate = _shape(
            slide, MSO_SHAPE.RECTANGLE,
            PLATE_X, plate_top + order * step_down, PLATE_W, PLATE_MIN_H,
            external["label"], size=Pt(9),
        )
        _fill(plate, "accent2")
        shapes_by_key["in:" + external["label"]] = plate

    # Рёбра: сначала поток шагов, затем плашки к своим шагам.
    for edge in doc["edges"]:
        _connect(slide, shapes_by_key[edge["from"]], shapes_by_key[edge["to"]])
    for stage in stages:
        for external in stage.get("externals", []):
            if external["direction"] == "in":
                _connect(slide, shapes_by_key["in:" + external["label"]],
                         shapes_by_key[external["attachTo"]])
            else:
                _connect(slide, shapes_by_key[external["attachFrom"]],
                         shapes_by_key["out:" + external["label"]])

    out_path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(out_path))
    return {
        "stages": len(stages),
        "steps": sum(len(s["steps"]) for s in stages),
        "plates": sum(len(s.get("externals", [])) for s in stages),
        "edges": len(doc["edges"]) + sum(len(s.get("externals", [])) for s in stages),
        "column_w": column_w,
    }


# --------------------------------------------------------------------------------------
# Сверка таблиц импортёра с authoring source
# --------------------------------------------------------------------------------------


def _importer():
    """scripts/import-pptx.py как модуль: имя с дефисом обычным import не берётся."""
    import importlib.util
    import sys

    path = Path(__file__).resolve().parent.parent / "import-pptx.py"
    spec = importlib.util.spec_from_file_location("import_pptx", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["import_pptx"] = module      # dataclasses ищут модуль в sys.modules
    spec.loader.exec_module(module)
    return module


def verify(author_path: Path) -> list[str]:
    """
    Сверяет STEP_DESCRIPTIONS и STAGE_KEY_OUTPUTS импортёра с authoring source.

    ЗАЧЕМ. Содержание живёт в двух местах: authoring source (его правит владелец)
    и таблицы решений владельца в импортёре (их читает конвейер). Источник правды
    один — JSON, но импортёр его НЕ читает: внешний конфиг в конвейере данных —
    отдельное решение, а тесты уже разбирают исходник импортёра регулярками.
    Значит нужен механический сторож против расхождения, иначе через месяц карта
    начнёт молча расходиться с тем, что владелец согласовал.

    Возвращает список расхождений; пустой список — таблицы сошлись.
    """
    imp = _importer()
    doc = json.loads(author_path.read_text(encoding="utf-8"))
    key = doc["id"]
    problems: list[str] = []

    descriptions = imp.STEP_DESCRIPTIONS.get(key, {})
    key_outputs = imp.STAGE_KEY_OUTPUTS.get(key, {})

    expected_desc = {
        imp.slugify(step["label"]): step["description"]
        for stage in doc["stages"]
        for step in stage["steps"]
    }
    for node_id, text in expected_desc.items():
        if node_id not in descriptions:
            problems.append(f"STEP_DESCRIPTIONS[{key}]: нет записи для «{node_id}»")
        elif descriptions[node_id] != text:
            problems.append(f"STEP_DESCRIPTIONS[{key}]: текст «{node_id}» разошёлся с JSON")
    for node_id in descriptions:
        if node_id not in expected_desc:
            problems.append(f"STEP_DESCRIPTIONS[{key}]: лишняя запись «{node_id}»")

    for stage in doc["stages"]:
        short = re.split(r"\s/|/\s|\s\+\s", stage["title"])[0].strip()
        stage_id = imp.slugify(f"stage-{stage['number']}-{short}")
        declared = key_outputs.get(stage_id)
        if declared is None:
            problems.append(f"STAGE_KEY_OUTPUTS[{key}]: нет записи для «{stage_id}»")
        elif list(declared) != stage["keyOutputs"]:
            problems.append(f"STAGE_KEY_OUTPUTS[{key}]: список «{stage_id}» разошёлся с JSON")

    return problems


def main(map_key: str, slide_title: str, dated: str) -> int:
    here = Path(__file__).resolve().parent
    author_path = here / f"{map_key}.json"
    out_path = here.parent.parent / f"In.Plan {slide_title} process {dated}.pptx"

    info = build(author_path, out_path)
    print(
        f"записан слайд: {out_path.name}\n"
        f"  этапов {info['stages']}, шагов {info['steps']}, плашек {info['plates']}, "
        f"рёбер {info['edges']}, колонка этапа {info['column_w']} EMU"
    )

    problems = verify(author_path)
    if problems:
        print("\nРАСХОЖДЕНИЕ таблиц импортёра с authoring source:")
        for item in problems:
            print(f"  · {item}")
        print(
            "\nСодержание заморожено (CONTENT_FROZEN). Приведите таблицы в "
            "scripts/import-pptx.py к scripts/author/<map>.json — или, если менялось "
            "содержание, получите решение владельца."
        )
        return 1
    print("таблицы STEP_DESCRIPTIONS и STAGE_KEY_OUTPUTS сошлись с authoring source")
    print("дальше: npm run data -- --map " + map_key)
    return 0
