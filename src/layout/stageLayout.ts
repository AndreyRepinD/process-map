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
  GROUP_FRAME_PADDING,
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

/** Излом маршрута: ребро идёт горизонтально до `x`, затем вертикально до `y`. */
export interface RouteTurn {
  x: number;
  y: number;
}

/** Раскладка этапа вместе с маршрутами рёбер потока (id ребра → изломы). */
export interface StageLayout {
  placements: Map<string, Placement>;
  routes: Map<string, RouteTurn[]>;
}

interface FlowLayout {
  placements: Map<string, Placement>;
  /** Точки dagre по каждому ребру потока (id ребра → точки), в координатах placements. */
  points: Map<string, { x: number; y: number }[]>;
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
 *
 * Проходов два: первый даёт ранги, по ним второй выравнивает крайние карточки
 * данных в сквозные колонки (edgeMinLengths).
 */
function layoutFlow(stage: Stage, members: readonly ProcessNode[]): FlowLayout {
  const first = runDagre(stage, members, new Map());
  const minlen = edgeMinLengths(stage, members, first.placements);
  if (minlen.size === 0) {
    return first;
  }
  const aligned = runDagre(stage, members, minlen);

  // Выравнивание оправдано, только если выровненная карточка связана со своим
  // шагом прямой линией с одним поворотом у цели. Если путь на своей высоте
  // перекрыт (чужая рамка, карточка) и ребру нужен объездной коридор,
  // карточка возвращается к своему шагу: длинная петля вокруг рамки читается
  // хуже, чем карточка вне общей колонки (этап 4 карты MEIO, 17.09.2026).
  const routes = routeEdges(stage, members, aligned.placements, aligned.points);
  const kept = new Map(minlen);
  for (const edge of innerEdges(stage, new Set(members.map((node) => node.id)))) {
    const key = edgeKey(edge.source, edge.target);
    if (!kept.has(key)) {
      continue;
    }
    const route = routes.get(edge.id);
    if (route === undefined || route.length > 1) {
      kept.delete(key);
    }
  }
  return kept.size === minlen.size ? aligned : runDagre(stage, members, kept);
}

interface Column {
  center: number;
  left: number;
  right: number;
}

/**
 * Колонки (ранги) раскладки: узлы одного ранга dagre ставит с общим центром по
 * X, поэтому колонка — это общий центр и крайние границы её узлов.
 */
function columnsOf(
  members: readonly ProcessNode[],
  placements: ReadonlyMap<string, Placement>,
): { columns: Column[]; indexOf: Map<string, number> } {
  const centerOf = (node: ProcessNode): number =>
    Math.round((placements.get(node.id)?.x ?? 0) + NODE_SIZE[node.type].width / 2);
  const byCenter = new Map<number, Column>();
  for (const node of members) {
    const center = centerOf(node);
    const left = placements.get(node.id)?.x ?? 0;
    const right = left + NODE_SIZE[node.type].width;
    const column = byCenter.get(center);
    byCenter.set(
      center,
      column === undefined
        ? { center, left, right }
        : { center, left: Math.min(column.left, left), right: Math.max(column.right, right) },
    );
  }
  const columns = [...byCenter.values()].sort((a, b) => a.center - b.center);
  const order = columns.map((column) => column.center);
  return {
    columns,
    indexOf: new Map(members.map((node) => [node.id, order.indexOf(centerOf(node))])),
  };
}

/**
 * Длины рёбер, которые выстраивают карточки данных в сквозные колонки
 * (решение владельца 17.09.2026: «чтобы аккуратно всё смотрелось»).
 *
 * Без них dagre ставит карточку-вход ровно рангом раньше её шага. У этапа, где
 * шаги стоят на разных рангах, входы расползаются лесенкой по трём-четырём
 * столбцам, а выходы — по стольким же: глаз не находит, где у этапа «вход» и
 * где «результат». С длиной ребра = рангу потребителя каждый вход оказывается
 * в нулевом ранге, с длиной = (последний ранг − ранг производителя) каждый
 * выход — в последнем. Ранги берутся из первого прохода.
 *
 * Трогаются только крайние карточки: вход без входящих рёбер и выход без
 * исходящих. Промежуточная карточка (из шага в шаг) остаётся между ними.
 * Длинное ребро dagre ведёт в обход узлов, и маршрут этого обхода рисуется
 * (routeEdges ниже) — иначе выравнивание дало бы линии поверх карточек.
 */
function edgeMinLengths(
  stage: Stage,
  members: readonly ProcessNode[],
  placements: ReadonlyMap<string, Placement>,
): Map<string, number> {
  const ids = new Set(members.map((node) => node.id));
  const byId = new Map(members.map((node) => [node.id, node]));
  const { indexOf: rank } = columnsOf(members, placements);
  const lastRank = Math.max(0, ...rank.values());
  const inner = innerEdges(stage, ids);
  const hasIncoming = new Set(inner.map((edge) => edge.target));
  const hasOutgoing = new Set(inner.map((edge) => edge.source));
  const result = new Map<string, number>();
  for (const edge of inner) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (source === undefined || target === undefined) {
      continue;
    }
    if (source.type === 'data' && !hasIncoming.has(source.id) && target.type !== 'data') {
      result.set(edgeKey(edge.source, edge.target), Math.max(1, rank.get(target.id) ?? 1));
    } else if (target.type === 'data' && !hasOutgoing.has(target.id) && source.type !== 'data') {
      result.set(
        edgeKey(edge.source, edge.target),
        Math.max(1, lastRank - (rank.get(source.id) ?? lastRank - 1)),
      );
    }
  }
  return result;
}

function innerEdges(stage: Stage, ids: ReadonlySet<string>): Stage['edges'] {
  return [...stage.edges]
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Ключ пары узлов. `|` в id не встречается: id — слаги из латиницы, цифр и дефиса. */
function edgeKey(source: string, target: string): string {
  return `${source}|${target}`;
}

/**
 * Исходный порядок узлов для dagre: шаги — по геометрии источника, крайние
 * карточки данных — по геометрии СВОЕГО шага.
 *
 * ЗАЧЕМ. dagre начинает упорядочивание рангов с исходного порядка и улучшает
 * его локально. На слайде все плашки-входы стоят общей колонкой в порядке
 * этапов, а не шагов, и вход нижнего шага оказывался в колонке выше входов
 * верхнего — после выравнивания в общий ранг его линия пересекала их все.
 * Вход без входящих рёбер сортируется по первому потребителю, выход без
 * исходящих — по первому производителю, а уже внутри своего шага — по себе.
 */
function seedOrder(stage: Stage, members: readonly ProcessNode[]): ProcessNode[] {
  const byId = new Map(members.map((node) => [node.id, node]));
  const inner = innerEdges(stage, new Set(byId.keys()));
  const hasIncoming = new Set(inner.map((edge) => edge.target));
  const hasOutgoing = new Set(inner.map((edge) => edge.source));
  const anchorOf = (node: ProcessNode): ProcessNode => {
    if (node.type !== 'data') {
      return node;
    }
    const partner = !hasIncoming.has(node.id)
      ? inner.find((edge) => edge.source === node.id)?.target
      : !hasOutgoing.has(node.id)
        ? inner.find((edge) => edge.target === node.id)?.source
        : undefined;
    return (partner === undefined ? undefined : byId.get(partner)) ?? node;
  };
  return [...members].sort((a, b) => bySlideOrder(anchorOf(a), anchorOf(b)) || bySlideOrder(a, b));
}

function runDagre(
  stage: Stage,
  members: readonly ProcessNode[],
  minlen: ReadonlyMap<string, number>,
): FlowLayout {
  const flow = seedOrder(stage, members);
  const placements = new Map<string, Placement>();
  const points = new Map<string, { x: number; y: number }[]>();
  if (flow.length === 0) {
    return { placements, points };
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

  const edgeEnds = new Map<string, { source: string; target: string }>();
  for (const edge of innerEdges(stage, flowIds)) {
    const length = minlen.get(edgeKey(edge.source, edge.target));
    graph.setEdge(edge.source, edge.target, length === undefined ? {} : { minlen: length });
    edgeEnds.set(edge.id, { source: edge.source, target: edge.target });
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
  for (const [id, ends] of edgeEnds) {
    const laid = graph.edge(ends.source, ends.target) as
      { points?: { x: number; y: number }[] } | undefined;
    points.set(
      id,
      (laid?.points ?? []).map((point) => ({ x: point.x - minX, y: point.y - minY })),
    );
  }
  return { placements, points };
}

/** Зазор, который маршрут держит от карточек по вертикали, px раскладки. */
const ROUTE_CLEARANCE = 4;
/** Шаг между параллельными вертикалями в одном промежутке, px раскладки. */
const LANE_STEP = 8;
/** Отступ крайней вертикали от карточек промежутка, px раскладки. */
const LANE_MARGIN = 4;
/**
 * Разница высот, которую маршрут не превращает в ступеньку, px раскладки.
 * Карточка данных (56) и шаг (52) разной высоты, и dagre ставит их центры на
 * несколько пикселей врозь: излом в 4–8 px читается как дрожание линии, а не
 * как поворот. Меньше половины высоты карточки — стрелка всё равно упирается
 * в её край.
 */
export const ROUTE_SNAP = 12;

interface PendingTurn {
  y: number;
  gap: number;
  /** Рёбра с одним ключом идут одной вертикалью (веер из шага или в шаг). */
  lane: string;
  /** Высота, по которой полосы упорядочиваются слева направо. */
  order: number;
}

/**
 * Маршруты прямых рёбер потока (id ребра → изломы).
 *
 * ЗАЧЕМ. React Flow рисует ребро smoothstep с одним изломом посередине пути. Для
 * соседних рангов середина лежит в промежутке между колонками, а для длинного
 * ребра — внутри чужой колонки: вертикаль режет карточки и рамки групп. dagre
 * для длинного ребра уже оставил свободный коридор — фиктивный узел в каждом
 * промежуточном ранге. Маршрут идёт по этим коридорам: горизонтально сквозь
 * колонку на высоте коридора, вертикально — только в промежутках между
 * колонками, где карточек нет по построению.
 *
 * ПОЛОСЫ. В одном промежутке поворачивают рёбра от разных шагов к разным
 * карточкам; на общей вертикали не видно, какая линия куда идёт. Поэтому у
 * каждого излома есть полоса: рёбра, сходящиеся в одну цель, — полоса цели;
 * остальные — полоса источника (веер из шага остаётся одним стволом);
 * промежуточные изломы — своя. Полосы разводятся на LANE_STEP в пределах
 * промежутка.
 *
 * СНАЧАЛА ПРЯМО. Коридор нужен, только когда путь на своей высоте занят:
 * карточкой этой колонки или рамкой чужой группы. Иначе ребро идёт прямо —
 * так веер из одного шага в несколько выходов получает общий ствол, а не
 * расходится по отдельным коридорам.
 *
 * Маршрут проверяется: если на высоте коридора в колонке всё же стоит карточка,
 * у ребра маршрута нет, и оно рисуется как раньше.
 */
function routeEdges(
  stage: Stage,
  members: readonly ProcessNode[],
  placements: ReadonlyMap<string, Placement>,
  points: ReadonlyMap<string, { x: number; y: number }[]>,
): Map<string, RouteTurn[]> {
  const { columns, indexOf } = columnsOf(members, placements);
  const byId = new Map(members.map((node) => [node.id, node]));
  const handleY = (node: ProcessNode): number =>
    (placements.get(node.id)?.y ?? 0) + NODE_SIZE[node.type].height / 2;
  const blocked = (column: number, y: number, except: ReadonlySet<string>): boolean =>
    members.some((node) => {
      if (except.has(node.id) || indexOf.get(node.id) !== column) {
        return false;
      }
      const top = (placements.get(node.id)?.y ?? 0) - ROUTE_CLEARANCE;
      const bottom = top + NODE_SIZE[node.type].height + ROUTE_CLEARANCE * 2;
      return y >= top && y <= bottom;
    });

  // Рамки групп — как их рисует экран этапа (stageGraph.ts): габарит карточек
  // группы плюс GROUP_FRAME_PADDING.
  const frames = new Map<string, Rect>();
  for (const node of members) {
    if (node.group === undefined || node.type === 'data') {
      continue;
    }
    const placement = placements.get(node.id) ?? { x: 0, y: 0 };
    const size = NODE_SIZE[node.type];
    const frame = frames.get(node.group);
    const x0 = Math.min(frame?.x ?? Number.POSITIVE_INFINITY, placement.x);
    const y0 = Math.min(frame?.y ?? Number.POSITIVE_INFINITY, placement.y);
    const x1 = Math.max(frame === undefined ? 0 : frame.x + frame.width, placement.x + size.width);
    const y1 = Math.max(
      frame === undefined ? 0 : frame.y + frame.height,
      placement.y + size.height,
    );
    frames.set(node.group, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  const foreignFrame = (column: number, y: number, own: ReadonlySet<string>): boolean => {
    const band = columns[column];
    return (
      band !== undefined &&
      [...frames].some(([group, box]) => {
        if (own.has(group)) {
          return false;
        }
        const left = box.x - GROUP_FRAME_PADDING.x;
        const right = box.x + box.width + GROUP_FRAME_PADDING.x;
        const top = box.y - GROUP_FRAME_PADDING.top;
        const bottom = box.y + box.height + GROUP_FRAME_PADDING.bottom;
        return y >= top && y <= bottom && left <= band.right && right >= band.left;
      })
    );
  };

  const incoming = new Map<string, number>();
  for (const edge of innerEdges(stage, new Set(byId.keys()))) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  const pending = new Map<string, PendingTurn[]>();
  for (const edge of innerEdges(stage, new Set(byId.keys()))) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    const from = indexOf.get(edge.source);
    const to = indexOf.get(edge.target);
    if (source === undefined || target === undefined || from === undefined || to === undefined) {
      continue;
    }
    if (to - from < 1) {
      continue;
    }
    const except = new Set([source.id, target.id]);
    const own = new Set(
      [source.group, target.group].filter((group): group is string => group !== undefined),
    );
    const turns: PendingTurn[] = [];
    let y = handleY(source);
    let valid = true;
    for (let column = from + 1; column < to; column += 1) {
      if (!blocked(column, y, except) && !foreignFrame(column, y, own)) {
        continue;
      }
      const band = columns[column];
      const corridor = (points.get(edge.id) ?? []).find(
        (point) => band !== undefined && point.x >= band.left && point.x <= band.right,
      );
      if (corridor === undefined || blocked(column, corridor.y, except)) {
        valid = false;
        break;
      }
      const straight = Math.abs(corridor.y - y) <= ROUTE_SNAP && !blocked(column, y, except);
      if (!straight && Math.round(corridor.y) !== Math.round(y)) {
        const fanOut = column === from + 1 && target.type === 'data';
        turns.push({
          y: Math.round(corridor.y),
          gap: column,
          lane: fanOut ? `out:${source.id}` : `edge:${edge.id}`,
          order: y,
        });
        y = corridor.y;
      }
    }
    if (!valid) {
      continue;
    }
    const fanIn = (incoming.get(target.id) ?? 0) > 1;
    const targetY = handleY(target);
    turns.push({
      // Почти на уровне цели — без ступеньки: ребро входит в карточку чуть
      // выше или ниже её середины (ROUTE_SNAP).
      y: Math.round(Math.abs(targetY - y) <= ROUTE_SNAP ? y : targetY),
      gap: to,
      // Сходящиеся в одну цель рёбра — одной вертикалью у цели; иначе ребро
      // идёт полосой своего источника, и веер из шага остаётся одним стволом.
      lane: fanIn ? `in:${target.id}` : `out:${source.id}`,
      order: fanIn ? handleY(target) : handleY(source),
    });
    pending.set(edge.id, turns);
  }

  // Полосы: в каждом промежутке ключи упорядочиваются по высоте и
  // раскладываются симметрично относительно середины промежутка.
  const lanesByGap = new Map<number, Map<string, number>>();
  for (const turns of pending.values()) {
    for (const turn of turns) {
      const lanes = lanesByGap.get(turn.gap) ?? new Map<string, number>();
      lanes.set(turn.lane, Math.min(lanes.get(turn.lane) ?? Number.POSITIVE_INFINITY, turn.order));
      lanesByGap.set(turn.gap, lanes);
    }
  }
  const laneX = new Map<string, number>();
  for (const [gap, lanes] of lanesByGap) {
    const previous = columns[gap - 1];
    const current = columns[gap];
    if (previous === undefined || current === undefined) {
      continue;
    }
    const center = (previous.right + current.left) / 2;
    const room = Math.max(0, current.left - previous.right - LANE_MARGIN * 2);
    const ordered = [...lanes.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
    const step = ordered.length > 1 ? Math.min(LANE_STEP, room / (ordered.length - 1)) : 0;
    ordered.forEach(([lane], index) => {
      laneX.set(`${gap}|${lane}`, Math.round(center + (index - (ordered.length - 1) / 2) * step));
    });
  }

  const routes = new Map<string, RouteTurn[]>();
  for (const [id, turns] of pending) {
    routes.set(
      id,
      turns.map((turn) => ({ x: laneX.get(`${turn.gap}|${turn.lane}`) ?? 0, y: turn.y })),
    );
  }
  return routes;
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
 * С 17.09.2026 крайние связанные карточки выравниваются в первый и последний
 * ранг (edgeMinLengths), а длинные рёбра к ним идут по маршрутам dagre.
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
  return layoutStageDetailed(stage).placements;
}

/** То же, что layoutStage, плюс маршруты прямых рёбер потока (routeEdges). */
export function layoutStageDetailed(stage: Stage): StageLayout {
  // Поток — шаги ПЛЮС связанные карточки данных (см. wiredDataNodes). Несвязанные
  // остаются колонкам: там карточка ничем, кроме колонки, к этапу не привязана.
  const wired = wiredDataNodes(stage);
  const flow = stage.nodes.filter((node) => node.type !== 'data' || wired.has(node.id));
  const { placements: flowPlacements, points } = layoutFlow(stage, flow);
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

  const shifted = new Map(
    [...points].map(([id, list]) => [
      id,
      list.map((point) => ({ x: point.x + flowX, y: point.y + flowTop })),
    ]),
  );
  return { placements: result, routes: routeEdges(stage, flow, result, shifted) };
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
