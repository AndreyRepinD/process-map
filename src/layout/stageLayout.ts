// Ядро автораскладки: dagre + колонки данных (process-map-70e.2).
//
// ПОЧЕМУ ЭТОТ КОД ПЕРЕЕХАЛ ИЗ scripts/ В src/. Раскладка нужна теперь дважды:
//   · на сборке — `npm run layout` пересчитывает координаты карт из
//     src/data/<карта>/process.json (scripts/layout.ts, обёртка над этим ядром);
//   · в рантайме — схема BPMN, загруженная пользователем в браузере, приходит
//     без `position` вовсе (эпик M6).
// Второй реализации быть не должно: разъехавшись, они дали бы одну и ту же
// карту в двух разных видах — на экране после загрузки файла и после того, как
// его положили в репозиторий и прогнали `npm run layout`. Поэтому ядро одно, а
// отличается только источник данных и то, что делают с результатом.
//
// СЛЕДСТВИЕ, ЗАПИСАННОЕ КАК ОТСТУПЛЕНИЕ: SPEC §1 утверждал, что dagre живёт
// только в скрипте и в рантайм-бандл не попадает. Теперь попадает (+29 KB gzip
// при бюджете PRD 400 KB), и это сознательный размен: одна реализация вместо
// двух. Поэтому же @dagrejs/dagre переехал из devDependencies в dependencies —
// модуль в src/ не имеет права зависеть от dev-зависимости.
//
// РАСШИРЕНИЯ `.ts` В ИМПОРТАХ НИЖЕ ОБЯЗАТЕЛЬНЫ и отличаются от остального src/.
// Файл импортируется не только Vite, но и Node из scripts/layout.ts через
// `--experimental-strip-types`, а тот требует явного расширения у РАНТАЙМНЫХ
// импортов. Соседние модули (src/theme/sizes.ts, src/utils/stageNodes.ts)
// обходятся без расширений только потому, что все их импорты — типовые и
// стираются до запуска.
import dagre from '@dagrejs/dagre';
import type { NodeType, ProcessMap, ProcessNode, Stage } from '../data/schema.ts';
import {
  DATA_NODE_SIZE,
  STAGE_NODE_SIZE as STAGE_SIZE,
  STEP_NODE_SIZE,
  type NodeSize,
} from '../theme/sizes.ts';
import { splitStageDataNodes as splitDataNodes } from '../utils/stageNodes.ts';

// @dagrejs/dagre — CommonJS-пакет: `module.exports = { graphlib, layout, … }`.
// Берётся ИМЕННО умолчательным импортом: он в обоих окружениях отдаёт весь
// module.exports целиком (проверено). Namespace-импорт не годится — под Node
// cjs-module-lexer распознаёт только `graphlib`, и `layout` оказывается
// undefined. Прежний обходной путь через createRequire('node:module') тоже
// отпал: в браузере такого модуля нет.
const { graphlib, layout: dagreLayout } = dagre;

// --------------------------------------------------------------------------------------
// Константы раскладки
// --------------------------------------------------------------------------------------

export type Size = NodeSize;

/**
 * Размеры узлов — из src/theme/sizes.ts, единственного источника истины
 * (он же сверяется с токенами --pm-*-node-* в tests/sizes.test.ts).
 * IntegrationNode и WarningNode отдельных размеров в SPEC не имеют и рисуются
 * карточкой шага, поэтому используют размер StepNode.
 *
 * Шлюз, событие и подпроцесс (BPMN, process-map-70e.4) — тоже размер карточки
 * шага. Это ОСОЗНАННОЕ ОТСТУПЛЕНИЕ ОТ НОТАЦИИ, а не экономия: ромб 50×50 и
 * круг 36×36 не вмещают подпись, и по стандарту BPMN она рисуется СНАРУЖИ
 * фигуры — на полотне её пришлось бы вынести, и она наехала бы на соседей.
 * Вид узла кодируется иконкой внутри карточки (задача process-map-70e.7).
 *
 * Эта таблица — единственный работающий сторож исчерпаемости NodeType: новое
 * значение перечисления роняет tsc здесь и заставляет назначить размер.
 */
export const NODE_SIZE: Record<NodeType, Size> = {
  step: STEP_NODE_SIZE,
  integration: STEP_NODE_SIZE,
  warning: STEP_NODE_SIZE,
  data: DATA_NODE_SIZE,
  gateway: STEP_NODE_SIZE,
  event: STEP_NODE_SIZE,
  subprocess: STEP_NODE_SIZE,
};

export const STAGE_NODE_SIZE: Size = STAGE_SIZE;

/** Внешняя система обзора — свимлейн-бейдж; размера в SPEC нет, значение номинальное. */
const SYSTEM_NODE_SIZE: Size = { width: 160, height: 56 };

/** Зазор между ранга́ми (по оси потока, X при rankdir=LR). */
const RANK_SEP = 32;
/** Зазор между узлами одного ранга. */
const NODE_SEP = 32;
/** Зазор между рёбрами одного ранга. */
const EDGE_SEP = 16;
/** Вертикальный шаг колонок data-узлов. */
const DATA_ROW_GAP = 16;
/** Горизонтальный отступ колонки data-узлов от потока шагов. */
const DATA_COLUMN_GAP = 96;

// --------------------------------------------------------------------------------------
// Геометрия и метрика пересечений
// --------------------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectOf(node: ProcessNode): Rect {
  const size = NODE_SIZE[node.type];
  return { x: node.position.x, y: node.position.y, width: size.width, height: size.height };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Число пар прямоугольников с ненулевой площадью пересечения — главная метрика раскладки. */
export function countOverlappingPairs(rects: readonly Rect[]): number {
  let count = 0;
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      if (a !== undefined && b !== undefined && overlaps(a, b)) {
        count += 1;
      }
    }
  }
  return count;
}

export function countStageOverlaps(stage: Stage): number {
  return countOverlappingPairs(stage.nodes.map(rectOf));
}

export function boundsOf(rects: readonly Rect[]): { width: number; height: number } {
  if (rects.length === 0) {
    return { width: 0, height: 0 };
  }
  let maxX = 0;
  let maxY = 0;
  for (const rect of rects) {
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { width: maxX, height: maxY };
}

// --------------------------------------------------------------------------------------
// Раскладка этапа (уровень 2)
// --------------------------------------------------------------------------------------

export interface Placement {
  x: number;
  y: number;
}

// Правило разделения data-узлов на колонки входов и выходов живёт в
// src/utils/stageNodes.ts — там же, откуда его берут экран StageDetail и
// счётчик в Breadcrumbs. Раскладка импортирует ту же функцию, чтобы не могла
// разойтись с тем, что нарисовано и посчитано в приложении.

/**
 * Исходная геометрия узла — координаты фигуры в документе-источнике: на слайде
 * презентации либо в `bpmndi:BPMNShape/dc:Bounds` схемы BPMN.
 *
 * Это ЕДИНСТВЕННЫЙ вход раскладки по геометрии. `position` здесь — запасной
 * вариант для документов, собранных до появления slidePosition: раскладка на
 * них работает как раньше (сидируется собственным прошлым результатом), и
 * скрипт об этом предупреждает — см. countWithoutSlidePosition.
 */
export function slidePositionOf(node: ProcessNode): { x: number; y: number } {
  return node.slidePosition ?? node.position;
}

/** Число узлов, потерявших исходную геометрию источника (нужно только для отчёта). */
export function countWithoutSlidePosition(stage: Stage): number {
  return stage.nodes.filter((node) => node.slidePosition === undefined).length;
}

/**
 * Копия этапа, у которой `position` = исходная геометрия источника.
 *
 * Нужна, чтобы отдать этап в splitStageDataNodes (src/utils/stageNodes.ts) —
 * единственный источник правила «левее середины — вход» — не заводя второй
 * копии правила и не добавляя в него параметр ради одного вызова.
 * Всё остальное (id, тип, группа) копируется как есть.
 */
function seedStage(stage: Stage): Stage {
  return {
    ...stage,
    nodes: stage.nodes.map((node) => ({ ...node, position: slidePositionOf(node) })),
  };
}

/** Порядок узлов внутри ранга сидируется исходной геометрией: сверху вниз, слева направо. */
function bySlideOrder(a: ProcessNode, b: ProcessNode): number {
  const first = slidePositionOf(a);
  const second = slidePositionOf(b);
  if (first.y !== second.y) {
    return first.y - second.y;
  }
  if (first.x !== second.x) {
    return first.x - second.x;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Раскладка потока шагов этапа.
 *
 * Граф компаундный (`compound: true`): каждая группа этапа становится кластером
 * dagre, а её узлы — детьми кластера. Благодаря этому dagre держит узлы одной
 * группы в смежных ранга́х и рядах, и dashed-контейнер группы (SPEC §4.2)
 * получается компактным прямоугольником, а не размазанным по всей раскладке.
 *
 * `members` — не обязательно только шаги. Data-узлы, СВЯЗАННЫЕ рёбрами, тоже
 * приходят сюда: см. wiredDataNodes ниже.
 */
function layoutFlow(stage: Stage, members: readonly ProcessNode[]): Map<string, Placement> {
  const flow = [...members].sort(bySlideOrder);
  const placements = new Map<string, Placement>();
  if (flow.length === 0) {
    return placements;
  }

  const graph = new graphlib.Graph({ compound: true, multigraph: false, directed: true });
  graph.setGraph({
    rankdir: 'LR',
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    edgesep: EDGE_SEP,
    marginx: 0,
    marginy: 0,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const flowIds = new Set(flow.map((node) => node.id));
  const usedGroups = new Set(
    flow.map((node) => node.group).filter((group): group is string => group !== undefined),
  );
  for (const group of stage.groups) {
    if (usedGroups.has(group.id)) {
      graph.setNode(`cluster:${group.id}`, {});
    }
  }

  for (const node of flow) {
    const size = NODE_SIZE[node.type];
    graph.setNode(node.id, { width: size.width, height: size.height });
    if (node.group !== undefined && usedGroups.has(node.group)) {
      graph.setParent(node.id, `cluster:${node.group}`);
    }
  }

  const edges = [...stage.edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const edge of edges) {
    if (flowIds.has(edge.source) && flowIds.has(edge.target) && edge.source !== edge.target) {
      graph.setEdge(edge.source, edge.target, {});
    }
  }

  dagreLayout(graph);

  // dagre отдаёт координаты ЦЕНТРА узла — переводим в левый верхний угол
  // (React Flow позиционирует узел по нему).
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const node of flow) {
    const laid = graph.node(node.id);
    const size = NODE_SIZE[node.type];
    const x = laid.x - size.width / 2;
    const y = laid.y - size.height / 2;
    placements.set(node.id, { x, y });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
  }
  for (const [id, placement] of placements) {
    placements.set(id, { x: placement.x - minX, y: placement.y - minY });
  }
  return placements;
}

/**
 * Data-узлы этапа, у которых есть хотя бы одна связь ВНУТРИ этапа.
 *
 * ЗАЧЕМ ЭТО РАЗЛИЧЕНИЕ (решение владельца 07.09.2026, «всё пересекается и
 * переплетается»). Колонки входов слева и выходов справа придуманы для карточек,
 * которые НИ С ЧЕМ не соединены: у карты SNP их 56 и ни одной связи, там колонка
 * — единственный способ показать, что артефакт относится к этапу.
 *
 * Как только карточка привязана к своему шагу, колонка начинает вредить: шаги
 * стоят на разных рангах, а все карточки — в одном столбце у края, и связь к
 * шагу третьего ранга пересекает всё полотно. На картах DP и MEIO связана каждая
 * карточка, и после разбиения MEIO по алгоритмам (21 шаг) читать это стало
 * нельзя.
 *
 * Поэтому связанные карточки идут в dagre наравне с шагами — он ставит вход
 * рангом раньше потребителя, выход рангом позже производителя и сам минимизирует
 * пересечения. Несвязанные остаются в колонках, и карта SNP не меняется вовсе.
 */
function wiredDataNodes(stage: Stage): Set<string> {
  const linked = new Set<string>();
  for (const edge of stage.edges) {
    linked.add(edge.source);
    linked.add(edge.target);
  }
  return new Set(
    stage.nodes.filter((node) => node.type === 'data' && linked.has(node.id)).map((n) => n.id),
  );
}

function stackColumn(nodes: readonly ProcessNode[]): number {
  return nodes.length === 0
    ? 0
    : nodes.length * NODE_SIZE.data.height + (nodes.length - 1) * DATA_ROW_GAP;
}

/**
 * Полная раскладка этапа.
 *
 * Поток посередине, колонки НЕСВЯЗАННЫХ карточек — слева (входы) и справа
 * (выходы), центрированные по высоте; порядок внутри колонки исходный.
 *
 * Связанные карточки в колонки не попадают: их раскладывает dagre вместе с
 * шагами, рядом со своим шагом (wiredDataNodes). На карте SNP связанных
 * карточек нет ни одной, поэтому её раскладка не меняется.
 */
export function layoutStage(stage: Stage): Map<string, Placement> {
  // Поток — шаги ПЛЮС связанные карточки данных (см. wiredDataNodes). Несвязанные
  // остаются колонкам: там карточка ничем, кроме колонки, к этапу не привязана.
  const wired = wiredDataNodes(stage);
  const flow = stage.nodes.filter((node) => node.type !== 'data' || wired.has(node.id));
  const flowPlacements = layoutFlow(stage, flow);
  const flowRects: Rect[] = flow.map((node) => {
    const placement = flowPlacements.get(node.id) ?? { x: 0, y: 0 };
    const size = NODE_SIZE[node.type];
    return { x: placement.x, y: placement.y, width: size.width, height: size.height };
  });
  const flowBounds = boundsOf(flowRects);

  // Деление на колонки считается по геометрии ИСТОЧНИКА, а не по текущим
  // координатам файла: иначе после первого прогона решение принималось бы по
  // результату этого же прогона (data-узел, положенный в левую колонку,
  // навсегда оставался бы входом). Правило — общее с приложением,
  // src/utils/stageNodes.ts.
  const { inputs, outputs } = splitDataNodes(seedStage(stage));
  const sortedInputs = [...inputs].filter((node) => !wired.has(node.id)).sort(bySlideOrder);
  const sortedOutputs = [...outputs].filter((node) => !wired.has(node.id)).sort(bySlideOrder);

  const inputsHeight = stackColumn(sortedInputs);
  const outputsHeight = stackColumn(sortedOutputs);
  const totalHeight = Math.max(flowBounds.height, inputsHeight, outputsHeight);

  const inputsX = 0;
  const flowX = sortedInputs.length > 0 ? NODE_SIZE.data.width + DATA_COLUMN_GAP : 0;
  const outputsX = flowX + flowBounds.width + DATA_COLUMN_GAP;

  const result = new Map<string, Placement>();

  const flowTop = (totalHeight - flowBounds.height) / 2;
  for (const node of flow) {
    const placement = flowPlacements.get(node.id) ?? { x: 0, y: 0 };
    result.set(node.id, {
      x: Math.round(flowX + placement.x),
      y: Math.round(flowTop + placement.y),
    });
  }

  const placeColumn = (nodes: readonly ProcessNode[], x: number, height: number): void => {
    const top = (totalHeight - height) / 2;
    nodes.forEach((node, index) => {
      result.set(node.id, {
        x: Math.round(x),
        y: Math.round(top + index * (NODE_SIZE.data.height + DATA_ROW_GAP)),
      });
    });
  };
  placeColumn(sortedInputs, inputsX, inputsHeight);
  placeColumn(sortedOutputs, outputsX, outputsHeight);

  return result;
}

// --------------------------------------------------------------------------------------
// Раскладка обзора (уровень 1)
// --------------------------------------------------------------------------------------

export interface OverviewPlacement {
  id: string;
  kind: 'stage' | 'system';
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Обзор: карточки этапов и внешние системы по overviewEdges.
 *
 * Результат НЕ записывается в JSON — у Stage в схеме нет поля position, а
 * координаты уровня 1 приложение считает само (overviewGraph.ts). Функция нужна
 * отчёту `npm run layout`, чтобы было видно габарит обзора и пересечения.
 */
export function layoutOverview(map: ProcessMap): OverviewPlacement[] {
  const stageIds = new Set(map.stages.map((stage) => stage.id));
  const systemIds: string[] = [];
  for (const edge of map.overviewEdges) {
    for (const endpoint of [edge.source, edge.target]) {
      if (!stageIds.has(endpoint) && !systemIds.includes(endpoint)) {
        systemIds.push(endpoint);
      }
    }
  }
  systemIds.sort();

  const graph = new graphlib.Graph({ multigraph: false, directed: true });
  graph.setGraph({
    rankdir: 'LR',
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    edgesep: EDGE_SEP,
    marginx: 0,
    marginy: 0,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const sizes = new Map<string, Size>();
  for (const stage of map.stages) {
    sizes.set(stage.id, STAGE_NODE_SIZE);
    graph.setNode(stage.id, { ...STAGE_NODE_SIZE });
  }
  for (const system of systemIds) {
    sizes.set(system, SYSTEM_NODE_SIZE);
    graph.setNode(system, { ...SYSTEM_NODE_SIZE });
  }
  for (const edge of [...map.overviewEdges].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    if (edge.source !== edge.target) {
      graph.setEdge(edge.source, edge.target, {});
    }
  }

  dagreLayout(graph);

  const raw: OverviewPlacement[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const id of [...map.stages.map((stage) => stage.id), ...systemIds]) {
    const size = sizes.get(id) ?? SYSTEM_NODE_SIZE;
    const laid = graph.node(id);
    const x = laid.x - size.width / 2;
    const y = laid.y - size.height / 2;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    raw.push({
      id,
      kind: stageIds.has(id) ? 'stage' : 'system',
      x,
      y,
      width: size.width,
      height: size.height,
    });
  }
  return raw.map((item) => ({
    ...item,
    x: Math.round(item.x - minX),
    y: Math.round(item.y - minY),
  }));
}
