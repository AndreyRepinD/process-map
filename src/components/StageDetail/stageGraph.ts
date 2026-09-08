// Сборка узлов и рёбер уровня 2 (SPEC §4.2). Чистая функция без React —
// поэтому полностью покрывается unit-тестами без рендера полотна
// (по образцу Overview/overviewGraph.ts).
//
// Координаты узлов здесь НЕ считаются: `position` у ProcessNode обязателен по
// схеме и уже посчитан scripts/layout.ts (dagre). Функция только
//   · переводит абсолютные координаты в координаты относительно контейнера,
//   · строит сами контейнеры (группы и колонки),
//   · выбирает хэндлы рёбер.
import type { Edge as FlowEdge, FitViewOptions } from '@xyflow/react';
import type { ProcessNode, Stage } from '../../data/schema';
import { ru } from '../../i18n/ru';
import { DATA_NODE_SIZE, STEP_NODE_SIZE, type NodeSize } from '../../theme/sizes';
import { splitStageDataNodes } from '../../utils/stageNodes';
import type { DataNodeType } from '../nodes/DataNode';
import type { GroupNodeType } from '../nodes/GroupNode';
import {
  STEP_HANDLE,
  type EventNodeType,
  type GatewayNodeType,
  type IntegrationNodeType,
  type SubprocessNodeType,
  type StepCardVariant,
  type StepNodeType,
} from '../nodes/StepNode';
import type { WarningNodeType } from '../nodes/WarningNode';

export type StageDetailNode =
  | GroupNodeType
  | StepNodeType
  | IntegrationNodeType
  | WarningNodeType
  | DataNodeType
  | GatewayNodeType
  | EventNodeType
  | SubprocessNodeType;

// ───────────────────────────── геометрия ─────────────────────────────

/**
 * React Flow ставит обёртке узла `pointer-events: none`, когда выключены все
 * флаги интерактивности (isSelectable || isDraggable || onClick || ...).
 * У нас выключены все — узлы не перетаскиваются и не выделяются (CLAUDE.md,
 * v1), — из-за чего до карточки не доходил бы ни клик, ни hover, ни title.
 * `node.style` разворачивается ПОСЛЕ вычисленного pointerEvents
 * (@xyflow/react: NodeWrapper), поэтому это корректный способ вернуть события
 * мыши, не включая перетаскивание. Регрессия из M1 — см. tests/App.test.ts.
 */
const INTERACTIVE_NODE_STYLE = { pointerEvents: 'all' } as const;

/**
 * Паддинги dashed-контейнера группы.
 *
 * По макету A2 они 16 / 48 / 28 (лево-право / верх / низ). Верх+низ = 76, но
 * scripts/layout.ts оставляет между соседними по вертикали группами ровно
 * 64 px (dagre nodesep 32 + половины карточек), и на этапах 2 и 3 рамки при
 * макетных паддингах накладываются друг на друга на 12 px. Поэтому по
 * вертикали 40 + 20 = 60 ≤ 64: заголовок (11px/14px) помещается, рамки не
 * пересекаются. Сторож — tests/stageGraph.test.ts, проверка непересечения
 * контейнеров на реальных данных всех этапов.
 */
export const GROUP_PADDING = { x: 16, top: 40, bottom: 20 } as const;

/** Высота заголовка колонки над её первой карточкой (макет A2: 108 − 84). */
export const COLUMN_TITLE_HEIGHT = 24;

/** Точечная сетка полотна — та же, что на уровне 1 (SPEC §4.1);
 *  про диаметр точки см. комментарий в Overview/overviewGraph.ts. */
export const GRID_GAP = 16;
export const GRID_DOT_SIZE = 2;
/**
 * Границы РУЧНОГО зума (колесо, тулбар M3). Нижняя граница меньше, чем на
 * уровне 1 (там 0.3): раскладки этапов до 3942 px шириной, и пользователь
 * вправе отдалить их целиком, чтобы увидеть форму процесса. К СТАРТОВОМУ виду
 * это отношения не имеет — см. START_ZOOM_MIN.
 */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2;

// ──────────────────── стартовый вид (задача process-map-l8a) ────────────────────
//
// Раньше экран открывался через fitView. На реальных данных это давало масштаб
// 0.31…0.53, то есть подпись шага 13px рисовалась в 4.1…6.9 px — нечитаемо;
// вдобавок fitView центрирует раскладку, и этап 1 (3528×296) открывался тонкой
// полоской посреди пустого поля, а не с начала потока.
//
// Теперь стартовый вид считается сам: масштаб — читаемый, привязка — ПЕРВАЯ
// КАРТОЧКА ШАГА ПОТОКА (задача process-map-c18), а не левый верхний угол
// габарита, как было сразу после process-map-l8a.
//
// Почему угол габарита оказался неверной привязкой: слева от потока стоит
// колонка входных data-узлов (x = 0), за ней узлы-интеграции (x = 296), и на
// этапах 2 и 4 при 1024×600 в первый кадр попадали только они — ни одной
// карточки шага. Экран, который открывается, не показывая самого процесса,
// не выполняет своё назначение (PRD: «увидеть процесс целиком за один
// взгляд»). Колонка входов никуда не делась — она осталась слева за кадром и
// доступна панорамированием.

/** Кегль подписи шага в макете A2 (токен --pm-font-size-13). */
const STEP_LABEL_FONT_PX = 13;

/**
 * Нижняя граница читаемого кегля — 12 px, самый мелкий кегль ОСНОВНОГО текста в
 * дизайн-системе In.Plan (--scp-font-body-s / --scp-font-sizes-12). Меньше 12
 * в шкале есть только «эйбры» (--pm-font-size-10-5/11), и то для капса
 * заголовков, а не для читаемых подписей.
 */
const MIN_READABLE_FONT_PX = 12;

/**
 * Минимальный стартовый масштаб = 12/13 ≈ 0.923: подпись шага не мельче 12 px
 * ни на одном этапе и ни при какой высоте контейнера (в том числе в компактном
 * режиме SPEC §4.5, где полотно 1024×548).
 *
 * Порог выведен из шкалы кеглей, а не подобран на глаз: любое другое число
 * пришлось бы обосновывать отдельно.
 */
export const START_ZOOM_MIN = MIN_READABLE_FONT_PX / STEP_LABEL_FONT_PX;

/**
 * Стартовый масштаб не увеличивается выше 1: карточки не должны быть КРУПНЕЕ
 * макета A2, даже если раскладка целиком влезает в полотно.
 */
export const START_ZOOM_MAX = 1;

/** Отступ раскладки от краёв полотна в стартовом виде, px экрана. */
export const START_PADDING = 24;

/**
 * Опции fitView для кнопки тулбара «Уместить в экран» (SPEC §4.6).
 *
 * padding — своя, независимая от START_PADDING величина: START_PADDING в px
 * (initialViewport считает вьюпорт сам, вручную), а fitView() React Flow
 * принимает padding долей от габарита полотна. 0.05 — тот же порядок, что
 * FIT_VIEW_PADDING на уровне 1 (Overview/overviewGraph.ts).
 *
 * minZoom/maxZoom = START_ZOOM_MIN/MAX — тот же пол читаемости, что у
 * стартового вида. Без них fitView() ушёл бы к своему обычному результату
 * 0.25…0.53 (см. комментарий выше про fitView и process-map-l8a) и кнопка
 * fit отменяла бы то, что чинит initialViewport. В отличие от него, здесь
 * применяется штатный fitView() React Flow: он центрирует раскладку — это
 * уместнее для явного действия пользователя «показать всё целиком», чем
 * привязка к левому краю потока, нужная только самому первому кадру.
 */
export const TOOLBAR_FIT_VIEW_OPTIONS: FitViewOptions = {
  padding: 0.05,
  minZoom: START_ZOOM_MIN,
  maxZoom: START_ZOOM_MAX,
};

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface ContainerSize {
  width: number;
  height: number;
}

/**
 * Смещение по одной оси.
 *
 * · Раскладка влезает по оси целиком — центрирование. Этап 1 по вертикали
 *   полоса 296 px при 668 доступных: прижатая к верху полоса с пустотой в
 *   372 px снизу читается как поломка вёрстки.
 * · Не влезает — привязка к соответствующему краю ЯКОРЯ (первой карточки
 *   шага, см. pickStartAnchor), а не габарита. Результат зажимается в
 *   пределы габарита: показывать пустоту до начала или после конца раскладки
 *   стартовый вид не должен ни при каком якоре.
 *
 * @param containerSize размер полотна по этой оси, px экрана
 * @param boundsMin,boundsSize габарит раскладки по этой оси, координаты графа
 * @param anchorMin      начало якоря по этой оси, координаты графа
 */
function axisOffset(
  containerSize: number,
  boundsMin: number,
  boundsSize: number,
  anchorMin: number,
  zoom: number,
): number {
  const scaled = boundsSize * zoom;
  if (scaled <= containerSize - START_PADDING * 2) {
    return (containerSize - scaled) / 2 - boundsMin * zoom;
  }
  // Пределы: не левее/выше начала габарита и не правее/ниже его конца.
  const atBoundsStart = START_PADDING - boundsMin * zoom;
  const atBoundsEnd = containerSize - START_PADDING - (boundsMin + boundsSize) * zoom;
  const atAnchor = START_PADDING - anchorMin * zoom;
  return Math.max(atBoundsEnd, Math.min(atBoundsStart, atAnchor));
}

/**
 * Стартовый вьюпорт полотна.
 *
 * Масштаб: сколько влезает целиком, но не мельче START_ZOOM_MIN и не крупнее
 * START_ZOOM_MAX.
 *
 * Смещение считается по каждой оси функцией axisOffset выше: центрирование,
 * когда раскладка влезает, иначе привязка к якорю с зажимом в габарит.
 *
 * Координаты раскладки бывают отрицательными (рамка группы уходит выше и левее
 * карточек, заголовок колонки — выше), поэтому смещение считается от
 * bounds.x/bounds.y и anchor.x/anchor.y, а не от нуля.
 *
 * @param anchor якорь стартового вида — `graph.startAnchor` из
 *   buildStageGraph. По умолчанию сам габарит: так функция сохраняет прежнее
 *   поведение для вызовов без якоря (и для этапа без единой карточки шага).
 */
export function initialViewport(
  bounds: Box,
  container: ContainerSize,
  anchor: Box = bounds,
): Viewport {
  // Полотно ещё не измерено (первый кадр, jsdom) — считать нечего, отдаём
  // читаемый масштаб без сдвига.
  if (container.width <= 0 || container.height <= 0 || bounds.width <= 0 || bounds.height <= 0) {
    return { x: START_PADDING, y: START_PADDING, zoom: START_ZOOM_MAX };
  }

  const fit = Math.min(
    (container.width - START_PADDING * 2) / bounds.width,
    (container.height - START_PADDING * 2) / bounds.height,
  );
  const zoom = Math.min(START_ZOOM_MAX, Math.max(START_ZOOM_MIN, fit));

  return {
    x: axisOffset(container.width, bounds.x, bounds.width, anchor.x, zoom),
    y: axisOffset(container.height, bounds.y, bounds.height, anchor.y, zoom),
    zoom,
  };
}

/** id контейнера группы — с префиксом, чтобы не столкнуться с id узлов. */
export function groupContainerId(groupId: string): string {
  return `group:${groupId}`;
}

/** id контейнера колонки данных. */
export const COLUMN_IN_ID = 'column:in';
export const COLUMN_OUT_ID = 'column:out';

function sizeOf(node: ProcessNode): NodeSize {
  // Правка размера владельцем перебивает умолчание темы; её отсутствие —
  // обычный случай, и тогда действует размер из src/theme/sizes.ts.
  return node.size ?? (node.type === 'data' ? DATA_NODE_SIZE : STEP_NODE_SIZE);
}

/** Прямоугольник в координатах раскладки (не экрана). */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boundingBox(nodes: readonly ProcessNode[]): Box {
  const x0 = Math.min(...nodes.map((node) => node.position.x));
  const y0 = Math.min(...nodes.map((node) => node.position.y));
  const x1 = Math.max(...nodes.map((node) => node.position.x + sizeOf(node).width));
  const y1 = Math.max(...nodes.map((node) => node.position.y + sizeOf(node).height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// ───────────────────────────── сборка ─────────────────────────────

export interface StageGraph {
  nodes: StageDetailNode[];
  edges: FlowEdge[];
  /**
   * Габарит всей раскладки в координатах графа, включая dashed-рамки групп и
   * заголовки колонок (они уходят выше и левее самих карточек, поэтому
   * bounds.x/y бывают отрицательными). Нужен для стартового вьюпорта —
   * см. initialViewport.
   */
  bounds: Box;
  /**
   * Якорь стартового вида — прямоугольник, левый верхний угол которого
   * стартовый вид ставит в START_PADDING от края полотна (задача
   * process-map-c18). См. pickStartAnchor.
   */
  startAnchor: Box;
}

/**
 * Прямоугольник, к которому привязывается стартовый вид этапа.
 *
 * Правило детерминированное, без «первый в массиве»:
 *   1. Берутся узлы `type === 'step'` — именно карточки шагов. НЕ data
 *      (колонки входов/выходов — это данные, а не сам процесс), НЕ integration
 *      (передача между системами) и НЕ warning (предупреждение о шаге):
 *      ровно они и заполняли первый кадр вместо процесса до этой задачи.
 *   2. Из них выбирается минимальный по (position.x, position.y, id).
 *      Третий ключ — id: сортировка обязана быть полной, иначе при двух
 *      карточках в одной точке результат зависел бы от порядка в JSON.
 *   3. Якорь — dashed-рамка ГРУППЫ этой карточки, если карточка в группе:
 *      рамка уходит на GROUP_PADDING левее и выше, и привязка к самой
 *      карточке срезала бы у края полотна рамку вместе с её заголовком.
 *      Карточка вне группы — якорем становится она сама.
 *   4. Ни одной карточки шага на этапе нет (в текущих данных такого нет, но
 *      схема этого не запрещает) — якоря нет, и initialViewport вернётся к
 *      прежнему поведению «угол габарита».
 */
function pickStartAnchor(stage: Stage, groupOrigin: ReadonlyMap<string, Box>, bounds: Box): Box {
  const steps = stage.nodes.filter((node) => node.type === 'step');
  if (steps.length === 0) {
    return bounds;
  }

  let first = steps[0] as ProcessNode;
  for (const candidate of steps) {
    if (
      candidate.position.x < first.position.x ||
      (candidate.position.x === first.position.x &&
        (candidate.position.y < first.position.y ||
          (candidate.position.y === first.position.y && candidate.id < first.id)))
    ) {
      first = candidate;
    }
  }

  const groupBox = first.group === undefined ? undefined : groupOrigin.get(first.group);
  if (groupBox !== undefined) {
    return groupBox;
  }
  return { x: first.position.x, y: first.position.y, ...sizeOf(first) };
}

/**
 * Тип узла React Flow по ProcessNode.type. `integration` рисуется карточкой шага,
 * но своим типом узла, а не типом `step` — см. IntegrationNodeType в StepNode.tsx.
 */
function flowNodeOf(node: ProcessNode, parentId: string | undefined, origin: Box | undefined) {
  const size = sizeOf(node);
  const position =
    origin === undefined
      ? { ...node.position }
      : { x: node.position.x - origin.x, y: node.position.y - origin.y };

  const common = {
    id: node.id,
    position,
    width: size.width,
    height: size.height,
    style: INTERACTIVE_NODE_STYLE,
    // `draggable` здесь НЕ ставится намеренно: узел без своего значения
    // подчиняется общему `nodesDraggable` полотна, а тот включён только в
    // режиме «Редактор» (StageDetail.tsx).
    //
    // ПОЧЕМУ ЭТО ВАЖНО. Раньше стояло `draggable: false`, и оно ПЕРЕКРЫВАЛО
    // `nodesDraggable`: перетаскивание, заведённое решением владельца 07.09.2026,
    // не работало ни разу — карточка не двигалась и в редакторе. Поймано только
    // 08.09.2026, потому что тест был лишь на обратное («в просмотре не
    // двигается»), и он оставался зелёным при полностью сломанной правке.
    // Контейнеры групп и колонок свой `draggable: false` сохраняют — таскать
    // рамку смысла нет.
    selectable: false,
    connectable: false,
    // Фокус несёт <button> внутри карточки: иначе до первого узла десятки Tab.
    focusable: false,
    // `extent: 'parent'` НЕ ставится (08.09.2026). Он зажимал карточку внутри
    // рамки группы, а рамка считается по габариту самих карточек и на каждой
    // загрузке пересчитывается: перетащенный к краю узел подклинивало обратно
    // на несколько пикселей, и сдвиг «то переживал перезагрузку, то нет».
    // Второй довод содержательный: владелец должен мочь вынести блок из группы,
    // а зажим это запрещал молча.
    ...(parentId === undefined ? {} : { parentId }),
  };

  /*
   * SWITCH С НЕВОЗМОЖНОЙ ВЕТКОЙ, а не цепочка if (process-map-70e.7).
   *
   * Раньше последней строкой стоял безусловный возврат карточки шага, то есть
   * ЛЮБОЙ новый тип узла молча рисовался бы шагом. Дефект был бы невидим:
   * инвариант «тип узла React Flow равен ProcessNode.type»
   * (tests/stageGraph.test.ts) покраснел бы только на карте, где такой узел
   * есть, — а в snp и mrp их нет. Теперь новый тип роняет tsc здесь.
   */
  switch (node.type) {
    case 'data':
      return { ...common, type: 'data' as const, data: { node } } satisfies DataNodeType;
    case 'warning':
      return { ...common, type: 'warning' as const, data: { node } } satisfies WarningNodeType;
    case 'integration':
      return {
        ...common,
        type: 'integration' as const,
        data: { node, variant: 'integration' satisfies StepCardVariant },
      } satisfies IntegrationNodeType;
    case 'gateway':
      return {
        ...common,
        type: 'gateway' as const,
        data: { node, variant: 'gateway' satisfies StepCardVariant },
      } satisfies GatewayNodeType;
    case 'event':
      return {
        ...common,
        type: 'event' as const,
        data: { node, variant: 'event' satisfies StepCardVariant },
      } satisfies EventNodeType;
    case 'subprocess':
      return {
        ...common,
        type: 'subprocess' as const,
        data: { node, variant: 'subprocess' satisfies StepCardVariant },
      } satisfies SubprocessNodeType;
    case 'step':
      return {
        ...common,
        type: 'step' as const,
        data: { node, variant: 'step' satisfies StepCardVariant },
      } satisfies StepNodeType;
    default: {
      const unreachable: never = node.type;
      throw new Error(`Неизвестный тип узла: ${String(unreachable)}`);
    }
  }
}

function containerNode(
  id: string,
  box: Box,
  title: string,
  kind: 'group' | 'column',
): GroupNodeType {
  return {
    id,
    type: 'groupBox',
    position: { x: box.x, y: box.y },
    data: { title, kind },
    style: { width: box.width, height: box.height },
    draggable: false,
    selectable: false,
    connectable: false,
    focusable: false,
  };
}

/**
 * Узлы и рёбра одного этапа.
 *
 * Порядок массива значим: React Flow требует, чтобы родительский узел шёл
 * раньше своих детей.
 *
 * @param showIntegrations toggle тулбара (SPEC §4.6). По умолчанию true —
 *   существующие вызовы (тесты, до появления тулбара) продолжают видеть
 *   прежнюю картину без правок. false прячет узлы `ProcessNode.type ===
 *   'integration'` и рёбра `kind === 'integration'`, а также любое ребро,
 *   у которого скрытый интеграционный узел остался бы висящим концом (у
 *   такого ребра `kind` может быть 'process' — сам переход к интеграции,
 *   а не она сама). Геометрия (боксы групп/колонок, bounds) считается по
 *   ПОЛНОМУ набору узлов независимо от toggle: раскладка не должна дрожать
 *   при переключении, должны исчезать только сами карточка/линия.
 */
export function buildStageGraph(stage: Stage, showIntegrations = true): StageGraph {
  const containers: GroupNodeType[] = [];
  const children: StageDetailNode[] = [];
  const loose: StageDetailNode[] = [];

  // ── группы шагов ──
  const byGroup = new Map<string, ProcessNode[]>();
  for (const node of stage.nodes) {
    if (node.type === 'data' || node.group === undefined) {
      continue;
    }
    const bucket = byGroup.get(node.group);
    if (bucket === undefined) {
      byGroup.set(node.group, [node]);
    } else {
      bucket.push(node);
    }
  }

  const groupOrigin = new Map<string, Box>();
  for (const group of stage.groups) {
    const members = byGroup.get(group.id);
    // Группа без узлов контейнера не получает: пустая dashed-рамка на полотне
    // не значит ничего.
    if (members === undefined || members.length === 0) {
      continue;
    }
    // То же самое, когда выключенный toggle спрятал ВСЕ узлы группы. С задачи
    // process-map-7v1 такая группа появилась: все четыре узла «Публикации
    // планов» — интеграции, и при выключенном toggle от неё оставалась рамка
    // 323×336 с заголовком и пустотой внутри.
    if (!showIntegrations && members.every((node) => node.type === 'integration')) {
      continue;
    }
    // Габарит считается по ПОЛНОМУ набору узлов, а не по видимым: иначе
    // частично скрытая группа меняла бы размер при переключении toggle и
    // раскладка прыгала бы.
    const bbox = boundingBox(members);
    const box: Box = {
      x: bbox.x - GROUP_PADDING.x,
      y: bbox.y - GROUP_PADDING.top,
      width: bbox.width + GROUP_PADDING.x * 2,
      height: bbox.height + GROUP_PADDING.top + GROUP_PADDING.bottom,
    };
    groupOrigin.set(group.id, box);
    containers.push(containerNode(groupContainerId(group.id), box, group.label, 'group'));
  }

  // ── колонки входов и выходов ──
  // splitStageDataNodes — ЕДИНСТВЕННЫЙ источник правила (src/utils/stageNodes.ts):
  // его же используют scripts/layout.ts и счётчик в Breadcrumbs, поэтому
  // колонки на экране не могут разойтись с числами в шапке.
  const split = splitStageDataNodes(stage);
  // Колонкой обводятся ТОЛЬКО несвязанные карточки — те же, что и в раскладке
  // (src/layout/stageLayout.ts::wiredDataNodes, решение владельца 07.09.2026).
  // Связанная карточка стоит рядом со своим шагом, и рамка «Входы» вокруг
  // разбросанных по полотну карточек охватила бы весь этап целиком, объявив
  // входом в том числе шаги.
  const linked = new Set(stage.edges.flatMap((edge) => [edge.source, edge.target]));
  const withoutEdges = (nodes: ProcessNode[]): ProcessNode[] =>
    nodes.filter((node) => !linked.has(node.id));
  const columnOrigin = new Map<'in' | 'out', Box>();
  const columns: { direction: 'in' | 'out'; id: string; title: string; nodes: ProcessNode[] }[] = [
    {
      direction: 'in',
      id: COLUMN_IN_ID,
      title: ru.stageDetail.inputsColumn,
      nodes: withoutEdges(split.inputs),
    },
    {
      direction: 'out',
      id: COLUMN_OUT_ID,
      title: ru.stageDetail.outputsColumn,
      nodes: withoutEdges(split.outputs),
    },
  ];

  for (const column of columns) {
    if (column.nodes.length === 0) {
      continue;
    }
    const bbox = boundingBox(column.nodes);
    const box: Box = {
      x: bbox.x,
      y: bbox.y - COLUMN_TITLE_HEIGHT,
      width: bbox.width,
      height: bbox.height + COLUMN_TITLE_HEIGHT,
    };
    columnOrigin.set(column.direction, box);
    containers.push(containerNode(column.id, box, column.title, 'column'));
  }

  const inputIds = new Set(split.inputs.map((node) => node.id));

  // ── сами узлы ──
  for (const node of stage.nodes) {
    // SPEC §4.6: выключенный toggle прячет узлы-интеграции наравне со
    // свимлейнами/системами уровня 1 (overviewGraph.ts). Геометрия групп
    // выше уже посчитана по полному набору — здесь только не кладём карточку
    // в children/loose, дырка в контейнере остаётся, раскладка не прыгает.
    if (node.type === 'integration' && !showIntegrations) {
      continue;
    }
    if (node.type === 'data') {
      const direction = inputIds.has(node.id) ? 'in' : 'out';
      const origin = columnOrigin.get(direction);
      const parentId =
        origin === undefined ? undefined : direction === 'in' ? COLUMN_IN_ID : COLUMN_OUT_ID;
      children.push(flowNodeOf(node, parentId, origin));
      continue;
    }
    const origin = node.group === undefined ? undefined : groupOrigin.get(node.group);
    if (origin === undefined) {
      loose.push(flowNodeOf(node, undefined, undefined));
    } else {
      children.push(flowNodeOf(node, groupContainerId(node.group ?? ''), origin));
    }
  }

  // ── рёбра ──
  const nodeById = new Map(stage.nodes.map((node) => [node.id, node]));
  const edges: FlowEdge[] = [];
  for (const edge of stage.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (source === undefined || target === undefined) {
      continue;
    }
    // Скрытый toggle прячет и само ребро-интеграцию (kind: 'integration'),
    // и любое другое ребро, зависшее на удалённом узле-интеграции — иначе
    // React Flow получил бы edge.source/target без соответствующего node.id.
    if (
      !showIntegrations &&
      (edge.kind === 'integration' ||
        source.type === 'integration' ||
        target.type === 'integration')
    ) {
      continue;
    }
    // Раскладка идёт слева направо, поэтому основная пара хэндлов right → left.
    // Обратное ребро (target левее source) пускаем снизу вверх, иначе smoothstep
    // рисует петлю поверх карточек. В текущих данных такое ребро одно (этап 2).
    const forward = target.position.x >= source.position.x;
    // Цвет ребра потока (артборд A2, process-map-fxg): фиолетовым идёт только
    // переход МЕЖДУ группами, поток внутри группы — серым.
    //
    // Признак берётся из уже существующего node.group, нового поля в данных не
    // заводится — исходная задача предполагала обратное. Узел без группы
    // (loose) считается своей «группой»: ребро от него к шагу внутри рамки —
    // это тоже переход, а не движение внутри одного блока.
    const crossesGroups = source.group !== target.group;
    const processType = crossesGroups ? 'process' : 'processInner';
    /*
     * ЯВНОЕ СОПОСТАВЛЕНИЕ, а не тернарник «всё, что не integration — поток»
     * (process-map-70e.6). Прежняя запись отправляла в поток и рёбра
     * kind: 'data', то есть третье значение схемы было мёртвым: в картах из
     * презентаций таких рёбер нет, и заметить это было негде.
     */
    const edgeType =
      edge.kind === 'integration' ? 'integration' : edge.kind === 'data' ? 'data' : processType;
    edges.push({
      id: edge.id,
      type: edgeType,
      source: edge.source,
      target: edge.target,
      sourceHandle: forward ? STEP_HANDLE.right : STEP_HANDLE.bottom,
      targetHandle: forward ? STEP_HANDLE.left : STEP_HANDLE.top,
      ...(edge.label === undefined ? {} : { label: edge.label }),
    });
  }

  // ── габарит раскладки ──
  // Считается по УЖЕ построенным прямоугольникам: узлы + контейнеры. Контейнеры
  // обязательны — dashed-рамка группы уходит на GROUP_PADDING левее и выше
  // своих карточек, а заголовок колонки на COLUMN_TITLE_HEIGHT выше, и без них
  // стартовый вид срезал бы рамку у края полотна.
  const rects: Box[] = [
    ...stage.nodes.map((node) => ({
      x: node.position.x,
      y: node.position.y,
      ...sizeOf(node),
    })),
    ...[...groupOrigin.values(), ...columnOrigin.values()],
  ];
  const bounds: Box =
    rects.length === 0
      ? { x: 0, y: 0, width: 0, height: 0 }
      : (() => {
          const x0 = Math.min(...rects.map((rect) => rect.x));
          const y0 = Math.min(...rects.map((rect) => rect.y));
          const x1 = Math.max(...rects.map((rect) => rect.x + rect.width));
          const y1 = Math.max(...rects.map((rect) => rect.y + rect.height));
          return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
        })();

  return {
    nodes: [...containers, ...children, ...loose],
    edges,
    bounds,
    // Якорь считается по ПОЛНОМУ набору узлов и групп, независимо от
    // showIntegrations: выключенный toggle прячет карточки интеграций, но не
    // должен двигать стартовый вид — иначе один и тот же этап открывался бы
    // в разных местах в зависимости от состояния тулбара.
    startAnchor: pickStartAnchor(stage, groupOrigin, bounds),
  };
}
