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
import zipfile
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

# ВЫСОТА КОНТЕЙНЕРА СЧИТАЕТСЯ ПО СОДЕРЖАНИЮ, а не задана числом.
#
# ЗАЧЕМ. Жёсткое ограничение слайда одно: ЦЕНТР шага обязан лежать внутри
# контейнера этапа, иначе импортёр останавливается (см. bd-память про профиль
# single-slide). Подписи входов и плашки-артефакты ниже последнего шага свисать
# могут — плашка наследует этап от связанного шага, а не от геометрии.
#
# При фиксированной высоте это ограничение проверялось только падением импорта
# после полной перегенерации: карта MEIO, где каждый алгоритм стал отдельным
# блоком, потребовала 10 798 000 EMU при 5 500 000 доступных. Поэтому высота
# выводится из самого высокого этапа карты, а _container_height ниже — ещё и
# сторож: он падает с числом, а не оставляет молчаливое переполнение.
#
# МИНИМУМ РАВЕН ПРЕЖНЕМУ ЗНАЧЕНИЮ намеренно. Карте DP (максимум 5 164 000) он не
# жмёт, и её слайд остаётся байт в байт прежним: иначе перестройка MEIO молча
# сдвинула бы плашки-входы DP — их разброс считается от высоты контейнера — и
# потянула бы за собой отпечаток чужой карты.
CONTAINER_H_MIN = 5_500_000
CONTAINER_H_PAD = 100_000
# Высота округляется ВВЕРХ до сетки: правка одной подписи не должна менять
# геометрию слайда и тянуть за собой отпечаток карты. Сетка же удерживает карту
# DP (нужно 5 164 000) ровно на прежних 5 500 000 — её слайд не меняется вовсе.
CONTAINER_H_GRID = 500_000

# Высота колонки плашек-входов — СВОЯ, не равна высоте контейнера.
#
# ЗАЧЕМ РАЗВЯЗАНО. Разброс входных плашек считался от CONTAINER_H, и в первой
# версии этой правки перестройка MEIO сдвинула плашки чужой карты DP на 1–2 px:
# её контейнер вырос на 64 000 EMU (5 164 000 + запас против прежних 5 500 000),
# плашки поехали, slidePosition изменился, отпечаток карты DP — вместе с ними.
# Ловится это только полным прогоном конвейера ОБЕИХ карт, то есть поздно и
# дорого. Вертикаль колонки входов ни на что в импортёре не влияет: вход от
# выхода отличается по ЛЕВОЙ координате (LEFT_MARGIN_LIMIT), а этап плашка
# наследует от связанного шага. Поэтому она фиксирована.
PLATE_COLUMN_H = 5_500_000

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


# Дата в записях zip-архива pptx. Фиксированная, а не текущая.
#
# ЗАЧЕМ. pptx — это zip, и python-pptx проставляет записям ВРЕМЯ СОХРАНЕНИЯ.
# Содержание при этом побайтово одинаково (проверено: у двух прогонов совпали
# все 38 записей архива, разошлись только метки времени), но сам файл каждый раз
# другой — то есть после каждого прогона конвейера git видит правку слайда,
# которой по смыслу нет. Требование проекта «два прогона дают побайтово
# одинаковый файл» относится и к нему, а не только к process.json.
#
# 1980-01-01 — нижняя граница формата zip, обычная договорённость
# воспроизводимых сборок.
ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)


def _freeze_zip(path: Path) -> None:
    """Перепаковывает архив с фиксированной датой, сохраняя порядок и сжатие."""
    with zipfile.ZipFile(path) as source:
        items = [(info, source.read(info.filename)) for info in source.infolist()]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as target:
        for info, payload in items:
            frozen = zipfile.ZipInfo(info.filename, date_time=ZIP_EPOCH)
            frozen.compress_type = info.compress_type
            frozen.external_attr = info.external_attr
            frozen.internal_attr = info.internal_attr
            frozen.create_system = info.create_system
            target.writestr(frozen, payload)


def _container_height(stages: list[dict], step_w: int) -> int:
    """Высота контейнера этапа: центр последнего шага самого высокого этапа + запас.

    Повторяет раскладку build() шаг в шаг — иначе сторож считал бы не то, что
    рисуется, и молчал бы ровно там, где нужен.
    """
    worst = 0
    for stage in stages:
        cursor = STEP_PAD
        for step in stage["steps"]:
            worst = max(worst, cursor + STEP_H // 2)
            cursor += STEP_H
            items = step.get("inputs") or []
            if items:
                cursor += CAPTION_GAP + _caption_height(items, step_w)
            cursor += BLOCK_GAP
    need = worst + CONTAINER_H_PAD
    snapped = -(-need // CONTAINER_H_GRID) * CONTAINER_H_GRID
    return max(CONTAINER_H_MIN, snapped)


def build(author_path: Path, out_path: Path) -> dict:
    doc = json.loads(author_path.read_text(encoding="utf-8"))
    stages = doc["stages"]

    prs = Presentation()
    slide = None    # создаётся ниже: высота слайда зависит от содержания

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

    step_w_probe = column_w - 2 * STEP_PAD
    container_h = _container_height(stages, step_w_probe)
    # Слайд обязан вмещать контейнер целиком. Импортёр проверяет только ШИРИНУ
    # слайда (SLIDE_WIDTH_EMU), высота ему безразлична — pptx здесь машинный
    # источник, а не презентация для показа.
    prs.slide_width = Emu(SLIDE_W)
    prs.slide_height = Emu(max(SLIDE_H, CONTAINER_TOP + container_h + CONTAINER_H_PAD))
    slide = prs.slides.add_slide(prs.slide_layouts[6])   # пустой макет: плейсхолдеров нет

    shapes_by_key: dict[str, object] = {}
    inbound: list[dict] = []     # плашки-входы: рисуются общей левой колонкой

    for index, stage in enumerate(stages):
        left = COLUMNS_X0 + index * (column_w + COLUMN_GAP)
        container = _shape(slide, MSO_SHAPE.RECTANGLE, left, CONTAINER_TOP, column_w, container_h)
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
            # Сторож на месте отрисовки, а не только в расчёте: если раскладка
            # и _container_height когда-нибудь разойдутся, падать должно здесь,
            # с именем шага, а не молчаливым выпадением его из импорта.
            centre = cursor + STEP_H // 2 - CONTAINER_TOP
            if centre >= container_h:
                raise SystemExit(
                    f"шаг «{step['key']}» выходит за контейнер этапа "
                    f"{stage['number']}: центр +{centre} EMU при высоте {container_h}"
                )
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
    available = PLATE_COLUMN_H - PLATE_MIN_H
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
    _freeze_zip(out_path)
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

    # Выходы шага — та же сверка, что у описаний.
    step_outputs = imp.STEP_OUTPUTS.get(key, {})
    for stage in doc["stages"]:
        for step in stage["steps"]:
            node_id = imp.slugify(step["label"])
            want = step.get("outputs") or []
            got = list(step_outputs.get(node_id, ()))
            if want != got:
                problems.append(f"STEP_OUTPUTS[{key}]: выходы «{node_id}» разошлись с JSON")

    # Группы: подпись и состав.
    stage_groups = imp.STAGE_GROUPS.get(key, {})
    for stage in doc["stages"]:
        short = re.split(r"\s/|/\s|\s\+\s", stage["title"])[0].strip()
        stage_id = imp.slugify(f"stage-{stage['number']}-{short}")
        want_groups: dict[str, list[str]] = {}
        for step in stage["steps"]:
            if step.get("group"):
                want_groups.setdefault(step["group"], []).append(imp.slugify(step["label"]))
        got_groups = {label: list(members) for label, members in stage_groups.get(stage_id, ())}
        if want_groups != got_groups:
            problems.append(f"STAGE_GROUPS[{key}]: группы этапа «{stage_id}» разошлись с JSON")

    # Ответственные живут в process.json: импортёру отдавать поле owner
    # запрещено самопроверкой serialize_node, оно переносится механизмом
    # сохранения ручных полей. Сверяем с картой, а не с таблицей.
    runtime = ROOT_JSON(key)
    if runtime is not None:
        by_id = {n["id"]: n for stage in runtime["stages"] for n in stage["nodes"]}
        for stage in doc["stages"]:
            for step in stage["steps"]:
                node_id = imp.slugify(step["label"])
                want_owner = step.get("owner")
                got_owner = by_id.get(node_id, {}).get("owner")
                if want_owner != got_owner:
                    problems.append(
                        f"owner «{node_id}»: в карте {got_owner!r}, в authoring source "
                        f"{want_owner!r}. Поле ручное — проставьте в src/data/{key}/process.json"
                    )

                # Алгоритмы Менеджера процессов — такое же ручное поле, с той
                # же причиной: на слайде их нет, потому что слайд рисует процесс,
                # а не привязку к конкретному стенду In.Plan. Хранятся ТОЛЬКО
                # имена: адреса на отдельный алгоритм платформа не даёт
                # (проверено 07.09.2026), он у всех один.
                want_algorithms = step.get("algorithms")
                got_algorithms = by_id.get(node_id, {}).get("algorithms")
                if want_algorithms != got_algorithms:
                    problems.append(
                        f"algorithms «{node_id}»: в карте {got_algorithms!r}, в authoring "
                        f"source {want_algorithms!r}. Поле ручное — проставьте в "
                        f"src/data/{key}/process.json"
                    )
                # Каждое имя обязано существовать в реестре стенда, иначе
                # привязка указывает в никуда: src/data/algorithms.ts —
                # единственный источник, и расхождение ловится здесь, а не
                # глазами при следующем чтении карты.
                for name in want_algorithms or ():
                    if name not in known_algorithms(key):
                        problems.append(
                            f"algorithms «{node_id}»: имени {name!r} нет в реестре модуля "
                            f"(src/data/algorithms.ts). Опечатка или новый алгоритм "
                            f"платформы — во втором случае дополните реестр."
                        )

    return problems


def known_algorithms(key: str) -> set[str]:
    """Имена алгоритмов модуля из src/data/algorithms.ts.

    ЧИТАЕТСЯ ИЗ TS-ФАЙЛА, А НЕ ДУБЛИРУЕТСЯ СПИСКОМ ЗДЕСЬ. Второй экземпляр
    реестра разошёлся бы с первым при первом же пополнении — и разошёлся бы
    молча, потому что обе копии остались бы синтаксически верными. Разбор
    намеренно грубый (регулярка по строковым литералам блока): формат файла
    задан здесь же, в репозитории, и меняется вместе с этой функцией.
    """
    path = Path(__file__).resolve().parent.parent.parent / "src" / "data" / "algorithms.ts"
    text = path.read_text(encoding="utf-8")
    const = {"meio": "MEIO_ALGORITHMS", "dp": "DP_ALGORITHMS"}.get(key)
    if const is None:
        return set()
    match = re.search(
        rf"export const {const}: readonly string\[\] = \[(.*?)\] as const;",
        text,
        re.S,
    )
    if match is None:
        raise SystemExit(
            f"В src/data/algorithms.ts не найден блок {const}. "
            f"Формат файла изменился — поправьте known_algorithms()."
        )
    return set(re.findall(r"'([^']+)'", match.group(1)))


def ROOT_JSON(key: str):
    """src/data/<map>/process.json, если он уже собран."""
    path = Path(__file__).resolve().parent.parent.parent / "src" / "data" / key / "process.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


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
