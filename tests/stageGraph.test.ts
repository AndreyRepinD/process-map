// Тесты сборки графа уровня 2 (SPEC §4.2, задача process-map-1ts).
// Проверки идут по РЕАЛЬНЫМ данным всех четырёх этапов: этапы устроены
// по-разному (12/30/39/22 узла, 2/2/5/1 группы), и синтетическая фикстура
// не поймала бы ни накладку контейнеров, ни обратное ребро.
import { describe, expect, it } from 'vitest';
import {
  buildStageGraph,
  COLUMN_IN_ID,
  COLUMN_OUT_ID,
  COLUMN_TITLE_HEIGHT,
  groupContainerId,
  GROUP_PADDING,
  initialViewport,
  START_PADDING,
  START_ZOOM_MAX,
  START_ZOOM_MIN,
} from '../src/components/StageDetail';
import { loadBaseProcessMap } from '../src/data/loader';
import type { ProcessNode, Stage } from '../src/data/schema';
import { ru } from '../src/i18n/ru';
import { DATA_NODE_SIZE, STEP_NODE_SIZE } from '../src/theme/sizes';
import { countStageNodes, splitStageDataNodes } from '../src/utils/stageNodes';

const map = loadBaseProcessMap();

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function sizeOf(node: ProcessNode): { width: number; height: number } {
  return node.type === 'data' ? DATA_NODE_SIZE : STEP_NODE_SIZE;
}

/** Абсолютный прямоугольник узла графа с учётом родителя-контейнера. */
function absoluteRects(stage: Stage): Map<string, Rect> {
  const { nodes } = buildStageGraph(stage);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const rects = new Map<string, Rect>();

  for (const node of nodes) {
    let x = node.position.x;
    let y = node.position.y;
    const parentId = 'parentId' in node ? node.parentId : undefined;
    if (parentId !== undefined) {
      const parent = byId.get(parentId);
      expect(parent, `родитель ${parentId} не найден`).toBeDefined();
      x += parent?.position.x ?? 0;
      y += parent?.position.y ?? 0;
    }
    const styleWidth = typeof node.style?.width === 'number' ? node.style.width : undefined;
    const styleHeight = typeof node.style?.height === 'number' ? node.style.height : undefined;
    rects.set(node.id, {
      x,
      y,
      width: node.width ?? styleWidth ?? 0,
      height: node.height ?? styleHeight ?? 0,
    });
  }
  return rects;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('buildStageGraph', () => {
  it.each(map.stages.map((stage) => [stage.number, stage] as const))(
    'этап %i: каждый узел данных попадает в граф ровно один раз и сохраняет координаты',
    (_number, stage) => {
      const { nodes } = buildStageGraph(stage);
      const rects = absoluteRects(stage);

      for (const node of stage.nodes) {
        const rect = rects.get(node.id);
        expect(rect, `узла ${node.id} нет в графе`).toBeDefined();
        // Позиция ребёнка контейнера хранится относительно родителя — сумма
        // обязана давать ровно то, что посчитал scripts/layout.ts.
        expect(rect?.x).toBe(node.position.x);
        expect(rect?.y).toBe(node.position.y);
        expect(rect?.width).toBe(sizeOf(node).width);
        expect(rect?.height).toBe(sizeOf(node).height);
      }

      const ids = nodes.map((node) => node.id);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  it.each(map.stages.map((stage) => [stage.number, stage] as const))(
    'этап %i: тип узла React Flow соответствует ProcessNode.type',
    (_number, stage) => {
      const { nodes } = buildStageGraph(stage);
      const byId = new Map(nodes.map((node) => [node.id, node]));

      for (const node of stage.nodes) {
        const flowNode = byId.get(node.id);
        // Соответствие один к одному: с process-map-73m у integration свой тип
        // узла. Раньше он рисовался типом `step`, и класс `.react-flow__node-step`
        // означал «шаг ИЛИ интеграция» — этот тест закреплял именно то слияние.
        expect(flowNode?.type).toBe(node.type);
        if (node.type === 'integration' || node.type === 'step') {
          expect(flowNode?.data).toMatchObject({ variant: node.type });
        }
      }
    },
  );

  it.each(map.stages.map((stage) => [stage.number, stage] as const))(
    'этап %i: контейнеры групп идут раньше своих детей и содержат их целиком',
    (_number, stage) => {
      const { nodes } = buildStageGraph(stage);
      const index = new Map(nodes.map((node, position) => [node.id, position]));
      const rects = absoluteRects(stage);

      const usedGroups = new Set(
        stage.nodes
          .filter((node) => node.type !== 'data')
          .map((node) => node.group)
          .filter((group): group is string => group !== undefined),
      );

      for (const group of stage.groups) {
        const containerId = groupContainerId(group.id);
        if (!usedGroups.has(group.id)) {
          expect(index.has(containerId)).toBe(false);
          continue;
        }
        expect(index.has(containerId)).toBe(true);
        const container = rects.get(containerId);
        expect(container).toBeDefined();

        for (const node of stage.nodes.filter((candidate) => candidate.group === group.id)) {
          expect(index.get(containerId)).toBeLessThan(index.get(node.id) ?? -1);
          const rect = rects.get(node.id);
          expect(rect).toBeDefined();
          expect(rect?.x).toBeGreaterThanOrEqual(container?.x ?? 0);
          expect(rect?.y).toBeGreaterThanOrEqual(container?.y ?? 0);
          expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBeLessThanOrEqual(
            (container?.x ?? 0) + (container?.width ?? 0),
          );
          expect((rect?.y ?? 0) + (rect?.height ?? 0)).toBeLessThanOrEqual(
            (container?.y ?? 0) + (container?.height ?? 0),
          );
        }
      }
    },
  );

  // Сторож паддинга GROUP_PADDING: макетные 48/28 давали накладку рамок на
  // 12 px, потому что scripts/layout.ts оставляет между группами 64 px.
  it.each(map.stages.map((stage) => [stage.number, stage] as const))(
    'этап %i: dashed-контейнеры не накладываются друг на друга и на узлы вне групп',
    (_number, stage) => {
      const rects = absoluteRects(stage);
      const containerIds = stage.groups
        .map((group) => groupContainerId(group.id))
        .filter((id) => rects.has(id));

      for (let i = 0; i < containerIds.length; i += 1) {
        for (let j = i + 1; j < containerIds.length; j += 1) {
          const a = rects.get(containerIds[i] ?? '');
          const b = rects.get(containerIds[j] ?? '');
          expect(a).toBeDefined();
          expect(b).toBeDefined();
          expect(
            a !== undefined && b !== undefined && overlaps(a, b),
            `${containerIds[i]} накладывается на ${containerIds[j]}`,
          ).toBe(false);
        }
      }

      const outsiders = stage.nodes.filter(
        (node) => node.type !== 'data' && node.group === undefined,
      );
      for (const node of outsiders) {
        const rect = rects.get(node.id);
        for (const containerId of containerIds) {
          const container = rects.get(containerId);
          expect(
            rect !== undefined && container !== undefined && overlaps(rect, container),
            `узел ${node.id} вне групп попал внутрь ${containerId}`,
          ).toBe(false);
        }
      }

      expect(GROUP_PADDING.top + GROUP_PADDING.bottom).toBeLessThanOrEqual(64);
    },
  );

  it.each(map.stages.map((stage) => [stage.number, stage] as const))(
    'этап %i: колонки входов/выходов совпадают со splitStageDataNodes и счётчиком крошек',
    (_number, stage) => {
      const { nodes } = buildStageGraph(stage);
      const split = splitStageDataNodes(stage);
      const counts = countStageNodes(stage);

      const childrenOf = (parentId: string): string[] =>
        nodes
          .filter((node) => ('parentId' in node ? node.parentId : undefined) === parentId)
          .map((node) => node.id);

      expect(childrenOf(COLUMN_IN_ID).sort()).toEqual(split.inputs.map((n) => n.id).sort());
      expect(childrenOf(COLUMN_OUT_ID).sort()).toEqual(split.outputs.map((n) => n.id).sort());
      expect(childrenOf(COLUMN_IN_ID)).toHaveLength(counts.inputs);
      expect(childrenOf(COLUMN_OUT_ID)).toHaveLength(counts.outputs);

      const byId = new Map(nodes.map((node) => [node.id, node]));
      // Пустая колонка контейнера не получает. После process-map-24p пустых
      // колонок в реальных данных нет — ветка остаётся для документов, где
      // одна из колонок действительно пуста.
      expect(byId.has(COLUMN_IN_ID)).toBe(split.inputs.length > 0);
      expect(byId.has(COLUMN_OUT_ID)).toBe(split.outputs.length > 0);

      if (split.inputs.length > 0) {
        expect(byId.get(COLUMN_IN_ID)?.data).toMatchObject({
          title: ru.stageDetail.inputsColumn,
          kind: 'column',
        });
        // Заголовок колонки живёт над её первой карточкой.
        const rects = absoluteRects(stage);
        const container = rects.get(COLUMN_IN_ID);
        const firstY = Math.min(...split.inputs.map((node) => node.position.y));
        expect(container?.y).toBe(firstY - COLUMN_TITLE_HEIGHT);
      }
    },
  );

  it.each(map.stages.map((stage) => [stage.number, stage] as const))(
    'этап %i: рёбра переносятся целиком, оба конца существуют',
    (_number, stage) => {
      const { nodes, edges } = buildStageGraph(stage);
      const ids = new Set(nodes.map((node) => node.id));

      expect(edges).toHaveLength(stage.edges.length);
      for (const edge of edges) {
        expect(ids.has(edge.source)).toBe(true);
        expect(ids.has(edge.target)).toBe(true);
        expect(['process', 'processInner', 'integration']).toContain(edge.type);
      }
    },
  );

  // process-map-fxg. Артборд A2 красит поток внутри группы серым, а фиолетовым
  // — только переход МЕЖДУ группами, и это несёт смысл: цвет показывает
  // структуру процесса. Признак берётся из уже существующего node.group;
  // исходная задача считала, что для этого нужно новое поле в данных.
  it.each(map.stages.map((stage) => [stage.number, stage] as const))(
    'этап %i: фиолетовым идёт только переход между группами шагов',
    (_number, stage) => {
      const byId = new Map(stage.nodes.map((node) => [node.id, node]));
      const { edges } = buildStageGraph(stage);

      let cross = 0;
      for (const edge of edges) {
        if (edge.type === 'integration') {
          continue;
        }
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        const crosses = source?.group !== target?.group;
        expect(edge.type, `ребро ${edge.id}`).toBe(crosses ? 'process' : 'processInner');
        if (crosses) {
          cross += 1;
        }
      }

      // Числа посчитаны по текущим данным и держат правило от вырождения:
      // если бы сравнение групп исчезло, фиолетовыми стали бы ВСЕ рёбра
      // потока, и проверка выше прошла бы только на этапе без групп.
      //
      // Шесть на этапе 3 — это переход монитор → корректировки, обратное ребро
      // из группы «Дефицит ГП» и четыре ребра корректировки → публикация,
      // достроенные решением владельца в process-map-7bz. Рёбер, у которых
      // один конец без группы, в текущих данных нет ни одного.
      expect(cross, 'межгрупповых переходов').toBe(stage.number === 3 ? 7 : 1);
    },
  );

  it('обратное ребро (target левее source) идёт снизу вверх, прямое — справа налево', () => {
    // НА ФИКСТУРЕ, А НЕ НА ДАННЫХ (process-map-3wh.16). Раньше единственное
    // обратное ребро уровня 2 было артефактом геометрии: одна и та же линия
    // слайда 4 разрешалась в обе стороны и давала взаимную пару. Привязки
    // коннекторов зафиксировали настоящее направление, дубль исчез — и вместе с
    // ним исчез предмет этой проверки. Механизм выбора хэндлов от этого не стал
    // менее нужным: обратное ребро появится на любой карте, где процесс
    // возвращается к предыдущему шагу.
    const stage = structuredClone(map.stages.find((candidate) => candidate.number === 2)) as Stage;
    const byId = new Map(stage.nodes.map((node) => [node.id, node]));
    const ordered = [...stage.nodes]
      .filter((node) => node.type !== 'data')
      .sort((a, b) => a.position.x - b.position.x);
    const left = ordered[0];
    const right = ordered[ordered.length - 1];
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(right!.position.x).toBeGreaterThan(left!.position.x);
    stage.edges.push({
      id: 'e-backward-fixture',
      source: right!.id,
      target: left!.id,
      kind: 'process',
    });

    const { edges } = buildStageGraph(stage);

    let backward = 0;
    for (const edge of edges) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (source === undefined || target === undefined) {
        continue;
      }
      if (target.position.x >= source.position.x) {
        expect(edge.sourceHandle).toBe('right');
        expect(edge.targetHandle).toBe('left');
      } else {
        backward += 1;
        expect(edge.sourceHandle).toBe('bottom');
        expect(edge.targetHandle).toBe('top');
      }
    }
    expect(backward, 'добавленное обратное ребро не распознано').toBe(1);
  });

  // Решение владельца процесса (задача process-map-7bz): все четыре узла
  // группы «Публикация планов» связаны с «Расчёт Ограниченных Планов».
  // В презентации нарисована лишь одна из этих стрелок — остальные три
  // объявлены в scripts/import-pptx.py::OWNER_DECISION_EDGES, и переживают
  // перегенерацию именно поэтому. Тест сторожит результат: если объявление
  // потеряется, следующий `npm run data` вернёт изолированные узлы, и это
  // должно быть видно тестом, а не глазами на экране.
  it('этап 3: все узлы группы publikaciya-planov связаны с расчётом ограниченных планов', () => {
    const stage = map.stages.find((candidate) => candidate.number === 3);
    expect(stage).toBeDefined();
    if (stage === undefined) {
      return;
    }
    const { nodes, edges } = buildStageGraph(stage);
    const ids = new Set(nodes.map((node) => node.id));

    const group = stage.nodes.filter((node) => node.group === 'publikaciya-planov');
    expect(group.map((node) => node.id).sort()).toEqual([
      'peredacha-ogranichennogo-prognoza-v-dp',
      'publikaciya-planovyh-zakazov',
      'publikaciya-zayavok-na-peremeschenie',
      'publikaciya-zayavok-na-zakupku',
    ]);

    for (const node of group) {
      expect(ids.has(node.id), `${node.id} не попал на полотно`).toBe(true);
      const incoming = edges.filter((edge) => edge.target === node.id);
      expect(
        incoming.map((edge) => edge.source),
        `${node.id}: входящие рёбра`,
      ).toEqual(['raschet-ogranichennyh-planov']);
    }
    expect(ids.has(groupContainerId('publikaciya-planov'))).toBe(true);
  });

  it.each(map.stages.map((stage) => [stage.number, stage] as const))(
    'этап %i: узлы принимают события мыши, контейнеры — нет',
    (_number, stage) => {
      const { nodes } = buildStageGraph(stage);
      const dataIds = new Set(stage.nodes.map((node) => node.id));

      for (const node of nodes) {
        if (dataIds.has(node.id)) {
          // Регрессия M1: без pointerEvents карточка не кликается в браузере.
          expect(node.style?.pointerEvents).toBe('all');
        } else {
          expect(node.style?.pointerEvents).toBeUndefined();
        }
        // ПЕРЕТАСКИВАНИЕ: у карточек СВОЕГО значения нет — они подчиняются
        // общему `nodesDraggable` полотна, включённому только в режиме
        // «Редактор» (StageDetail.tsx). Раньше здесь стояло `draggable: false` у
        // всех, и оно ПЕРЕКРЫВАЛО `nodesDraggable`: перетаскивание, заведённое
        // решением владельца 07.09.2026, не работало ни разу. Контейнеры групп и
        // колонок своё `false` сохраняют — таскать рамку смысла нет.
        expect(node.draggable, `${node.id}: draggable`).toBe(
          dataIds.has(node.id) ? undefined : false,
        );
        expect(node.connectable).toBe(false);
        expect(node.focusable).toBe(false);
      }
    },
  );
});

// ─────────────── стартовый вид полотна (задача process-map-l8a) ───────────────

/** Рабочая область полотна = высота окна минус шапка 52 px (--pm-header-height). */
const CANVAS_1280 = { width: 1280, height: 668 };
/** Компактный режим SPEC §4.5: окно 1024×600. */
const CANVAS_1024 = { width: 1024, height: 548 };

/** Кегль подписи шага в макете A2 — от него считается читаемость. */
const STEP_LABEL_FONT_PX = 13;
/** Нижняя граница читаемости — --scp-font-body-s дизайн-системы. */
const MIN_READABLE_FONT_PX = 12;

describe('startAnchor — первая карточка шага (задача process-map-c18)', () => {
  it('якорь совпадает с рамкой группы первой по (x, y, id) карточки шага', () => {
    for (const stage of map.stages) {
      const { startAnchor } = buildStageGraph(stage);
      const rects = absoluteRects(stage);

      const steps = stage.nodes
        .filter((node) => node.type === 'step')
        .sort(
          (a, b) =>
            a.position.x - b.position.x ||
            a.position.y - b.position.y ||
            a.id.localeCompare(b.id, 'en'),
        );
      const first = steps[0];
      expect(first, `Этап ${stage.number} без карточек шага`).toBeDefined();
      const firstStep = first as ProcessNode;

      // Якорь — рамка группы этой карточки (у всех четырёх этапов первая
      // карточка шага лежит в группе), поэтому он ОБЯЗАН накрывать карточку.
      const rect = rects.get(firstStep.id);
      expect(rect).toBeDefined();
      const stepRect = rect as Rect;
      expect(startAnchor.x).toBeLessThanOrEqual(stepRect.x);
      expect(startAnchor.y).toBeLessThanOrEqual(stepRect.y);
      expect(startAnchor.x + startAnchor.width).toBeGreaterThanOrEqual(stepRect.x + stepRect.width);
      expect(startAnchor.y + startAnchor.height).toBeGreaterThanOrEqual(
        stepRect.y + stepRect.height,
      );

      // И якорь — не колонка входов: она стоит левее любой карточки шага.
      expect(startAnchor.x).toBeGreaterThan(0);
    }
  });

  it('якорь не зависит от toggle «Показать интеграции» (SPEC §4.6)', () => {
    for (const stage of map.stages) {
      expect(buildStageGraph(stage, false).startAnchor).toEqual(
        buildStageGraph(stage, true).startAnchor,
      );
    }
  });

  it('этап без карточек шага откатывается к габариту раскладки', () => {
    const stage = map.stages[0] as Stage;
    const dataOnly: Stage = {
      ...stage,
      groups: [],
      edges: [],
      nodes: stage.nodes.filter((node) => node.type === 'data'),
    };
    const { bounds, startAnchor } = buildStageGraph(dataOnly);
    expect(startAnchor).toEqual(bounds);
  });

  it('порядок узлов в данных не влияет на якорь (сортировка полная)', () => {
    for (const stage of map.stages) {
      const reversed: Stage = { ...stage, nodes: [...stage.nodes].reverse() };
      expect(buildStageGraph(reversed).startAnchor).toEqual(buildStageGraph(stage).startAnchor);
    }
  });
});

describe('initialViewport', () => {
  it.each([
    ['1280×720', CANVAS_1280],
    ['1024×600', CANVAS_1024],
  ] as const)('%s: подпись шага ни на одном этапе не мельче 12 px', (_size, container) => {
    for (const stage of map.stages) {
      const { bounds } = buildStageGraph(stage);
      const viewport = initialViewport(bounds, container);

      expect(viewport.zoom).toBeGreaterThanOrEqual(START_ZOOM_MIN);
      expect(viewport.zoom).toBeLessThanOrEqual(START_ZOOM_MAX);
      // Главное утверждение задачи: fitView давал здесь 3.2…6.9 px.
      expect(STEP_LABEL_FONT_PX * viewport.zoom).toBeGreaterThanOrEqual(MIN_READABLE_FONT_PX);
    }
  });

  it.each([
    ['1280×720', CANVAS_1280],
    ['1024×600', CANVAS_1024],
  ] as const)(
    '%s: левый край ЯКОРЯ прижат к START_PADDING (начало потока шагов)',
    (_size, container) => {
      for (const stage of map.stages) {
        const { bounds, startAnchor } = buildStageGraph(stage);
        const viewport = initialViewport(bounds, container, startAnchor);

        // Ни один этап не влезает по ширине (2152…3942 px при читаемом
        // масштабе), поэтому по X всегда работает привязка к якорю.
        const screenLeft = viewport.x + startAnchor.x * viewport.zoom;
        expect(screenLeft).toBeCloseTo(START_PADDING, 6);
        // И якорь заведомо ПРАВЕЕ угла габарита — иначе задача process-map-c18
        // ничего не изменила бы.
        expect(startAnchor.x).toBeGreaterThan(bounds.x);
      }
    },
  );

  it('по вертикали: не влезает — привязка к якорю, влезает — центрирование', () => {
    for (const stage of map.stages) {
      const { bounds, startAnchor } = buildStageGraph(stage);
      const viewport = initialViewport(bounds, CANVAS_1280, startAnchor);
      const scaledHeight = bounds.height * viewport.zoom;

      if (scaledHeight <= CANVAS_1280.height - START_PADDING * 2) {
        // Этап 1 — полоса 296 px: центрируется, иначе снизу пустота в 372 px.
        const screenTop = viewport.y + bounds.y * viewport.zoom;
        expect(screenTop).toBeCloseTo((CANVAS_1280.height - scaledHeight) / 2, 6);
        expect(screenTop).toBeGreaterThan(START_PADDING);
      } else {
        // Верх якоря не выше START_PADDING: карточка видна с первой строки.
        const anchorTop = viewport.y + startAnchor.y * viewport.zoom;
        expect(anchorTop).toBeGreaterThanOrEqual(START_PADDING - 1e-6);
        // …и кадр не вылезает за раскладку: этап 3 из-за этого зажимается по
        // нижнему краю, и якорь оказывается ниже START_PADDING — так и надо.
        const boundsTop = viewport.y + bounds.y * viewport.zoom;
        const boundsBottom = viewport.y + (bounds.y + bounds.height) * viewport.zoom;
        expect(boundsTop).toBeLessThanOrEqual(START_PADDING + 1e-6);
        expect(boundsBottom).toBeGreaterThanOrEqual(CANVAS_1280.height - START_PADDING - 1e-6);
      }
    }
  });

  it('этап 1 центрируется по вертикали, этапы 2–4 привязаны к якорю', () => {
    const verdicts = map.stages.map((stage) => {
      const { bounds, startAnchor } = buildStageGraph(stage);
      const viewport = initialViewport(bounds, CANVAS_1280, startAnchor);
      const scaledHeight = bounds.height * viewport.zoom;
      return {
        number: stage.number,
        centred: scaledHeight <= CANVAS_1280.height - START_PADDING * 2,
      };
    });

    expect(verdicts).toEqual([
      { number: 1, centred: true },
      { number: 2, centred: false },
      { number: 3, centred: false },
      { number: 4, centred: false },
    ]);
  });

  it('привязка к якорю не показывает пустоту за пределами раскладки', () => {
    // Якорь у правого нижнего края: наивная привязка увела бы кадр за конец
    // раскладки, и пол-экрана заняла бы пустая сетка.
    const bounds = { x: 0, y: 0, width: 4000, height: 4000 };
    const anchor = { x: 3900, y: 3900, width: 100, height: 100 };
    const viewport = initialViewport(bounds, CANVAS_1280, anchor);

    const right = viewport.x + (bounds.x + bounds.width) * viewport.zoom;
    const bottom = viewport.y + (bounds.y + bounds.height) * viewport.zoom;
    expect(right).toBeCloseTo(CANVAS_1280.width - START_PADDING, 6);
    expect(bottom).toBeCloseTo(CANVAS_1280.height - START_PADDING, 6);
  });

  it('маленькая раскладка не увеличивается выше макета (потолок 1.0)', () => {
    const bounds = { x: 0, y: 0, width: 400, height: 200 };
    const viewport = initialViewport(bounds, CANVAS_1280);

    expect(viewport.zoom).toBe(START_ZOOM_MAX);
    // Влезает по обеим осям — центрируется по обеим (правило одно на ось:
    // влезло — центр, не влезло — якорь).
    expect(viewport.x + bounds.x * viewport.zoom).toBeCloseTo((CANVAS_1280.width - 400) / 2, 6);
    expect(viewport.y + bounds.y * viewport.zoom).toBeCloseTo((CANVAS_1280.height - 200) / 2, 6);
  });

  it('раскладка между полом и потолком берёт свой fit-масштаб', () => {
    // Ширина подобрана так, чтобы fit попал строго между START_ZOOM_MIN и 1.
    const bounds = { x: 0, y: 0, width: 1300, height: 400 };
    const viewport = initialViewport(bounds, CANVAS_1280);
    const fit = Math.min(
      (CANVAS_1280.width - START_PADDING * 2) / bounds.width,
      (CANVAS_1280.height - START_PADDING * 2) / bounds.height,
    );

    expect(fit).toBeGreaterThan(START_ZOOM_MIN);
    expect(fit).toBeLessThan(START_ZOOM_MAX);
    expect(viewport.zoom).toBeCloseTo(fit, 6);
  });

  it('неизмеренное полотно (0×0) не даёт NaN и Infinity', () => {
    for (const container of [
      { width: 0, height: 0 },
      { width: 1280, height: 0 },
      { width: 0, height: 668 },
    ]) {
      const viewport = initialViewport({ x: 0, y: 0, width: 3528, height: 296 }, container);
      expect(Number.isFinite(viewport.x)).toBe(true);
      expect(Number.isFinite(viewport.y)).toBe(true);
      expect(Number.isFinite(viewport.zoom)).toBe(true);
      expect(viewport.zoom).toBeGreaterThan(0);
    }
    // Пустая раскладка (этап без узлов) — тот же путь.
    const empty = initialViewport({ x: 0, y: 0, width: 0, height: 0 }, CANVAS_1280);
    expect(Number.isFinite(empty.zoom)).toBe(true);
  });

  // ─── задача process-map-c18: главное утверждение ───
  //
  // Не «вьюпорт равен такому-то числу», а «первый кадр показывает процесс».
  // До правки этап 4 при 1024×600 не показывал НИ ОДНОЙ карточки шага
  // (в кадр попадали колонка входов и узлы интеграций), этап 2 — ни одной
  // целиком. Проверка считает пересечение экранного прямоугольника с
  // прямоугольниками карточек шага в координатах графа.
  it.each([
    ['1280×720', CANVAS_1280],
    ['1024×600', CANVAS_1024],
  ] as const)('%s: в стартовом кадре каждого этапа видны карточки шагов', (_size, container) => {
    for (const stage of map.stages) {
      const { bounds, startAnchor } = buildStageGraph(stage);
      const viewport = initialViewport(bounds, container, startAnchor);
      const rects = absoluteRects(stage);

      // Видимая область в координатах графа.
      const view = {
        left: -viewport.x / viewport.zoom,
        top: -viewport.y / viewport.zoom,
        right: (container.width - viewport.x) / viewport.zoom,
        bottom: (container.height - viewport.y) / viewport.zoom,
      };

      const stepsInFrame = stage.nodes.filter((node) => {
        if (node.type !== 'step') {
          return false;
        }
        const rect = rects.get(node.id);
        if (rect === undefined) {
          return false;
        }
        return (
          rect.x >= view.left &&
          rect.y >= view.top &&
          rect.x + rect.width <= view.right &&
          rect.y + rect.height <= view.bottom
        );
      });

      expect(
        stepsInFrame.length,
        `Этап ${stage.number}: первый кадр не показывает ни одной карточки шага целиком`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it('bounds покрывает и узлы, и контейнеры групп/колонок', () => {
    for (const stage of map.stages) {
      const { bounds } = buildStageGraph(stage);
      const rects = absoluteRects(stage);

      for (const [id, rect] of rects) {
        expect(rect.x, `${id} левее bounds`).toBeGreaterThanOrEqual(bounds.x);
        expect(rect.y, `${id} выше bounds`).toBeGreaterThanOrEqual(bounds.y);
        expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      }

      // Рамка группы уходит выше карточек, заголовок колонки — тоже:
      // bounds.y обязан быть отрицательным, иначе верх раскладки срежется.
      expect(bounds.y).toBeLessThan(0);
    }
  });
});
