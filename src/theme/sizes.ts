// Единственный источник истины по размерам узлов и хрома (SPEC §4.1, §4.2, §4.5).
//
// Зачем модуль, а не одни только CSS-переменные: числа нужны трём потребителям
// с несовместимыми форматами —
//   · CSS-модулям компонентов — как `var(--pm-*)` в px;
//   · React Flow (src/components/Overview/overviewGraph.ts, StageDetail) —
//     как числа в `node.width`/`node.height`/`position`;
//   · dagre (scripts/layout.ts) — как числа в `graph.setNode({ width, height })`.
//
// Поэтому числа живут здесь, а токены в src/theme/tokens.css обязаны им
// соответствовать. Соответствие не «на честном слове»: карта SIZE_TOKENS ниже
// связывает имя токена с константой, а tests/sizes.test.ts парсит tokens.css и
// падает при любом расхождении. Правка одного числа здесь — и вёрстка, и
// раскладка, и тест меняются согласованно; правка только токена — красный тест.
//
// Модуль импортируется ядром раскладки (src/layout/stageLayout.ts), а его в
// свою очередь запускает Node через `--experimental-strip-types`: здесь
// допустимы только стираемые конструкции (никаких enum и namespace) и никаких
// импортов рантайм-значений извне.

export interface NodeSize {
  readonly width: number;
  readonly height: number;
}

/**
 * StageNode, уровень 1 (SPEC §4.1).
 *
 * Высота 232, а не 210 из артборда A1: лимит «Ключевых выходов» поднят с трёх
 * до четырёх (process-map-24i), потому что презентация перечисляет у этапа 3
 * ровно четыре опубликованных плана. Четвёртая строка в 210 не влезала —
 * у карточки с двухстрочным заголовком запас под списком был -1 px, и пункт
 * оставался в дереве доступности, но не на экране. Ширина 274 из макета.
 */
export const STAGE_NODE_SIZE: NodeSize = { width: 274, height: 232 };

/** StageNode в компактном режиме, высота контейнера < config.compactHeight (SPEC §4.5). */
export const STAGE_NODE_SIZE_COMPACT: NodeSize = { width: 228, height: 200 };

/** Карточка внешней системы в свимлейне уровня 1 (макет A1). */
export const IO_NODE_SIZE: NodeSize = { width: 200, height: 40 };

/**
 * StepNode, уровень 2 (SPEC §4.2). IntegrationNode и WarningNode собственного
 * размера в SPEC не имеют и рисуются той же карточкой шага.
 */
export const STEP_NODE_SIZE: NodeSize = { width: 318, height: 52 };

/** DataNode, уровень 2 (SPEC §4.2). */
export const DATA_NODE_SIZE: NodeSize = { width: 200, height: 56 };

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
export const GROUP_FRAME_PADDING = { x: 16, top: 40, bottom: 20 } as const;

/** Drawer (SPEC §4.3). */
export const DRAWER_WIDTH = 360;

/** Шапка: обычная (SPEC §4.1) и компактная (SPEC §4.5). */
export const HEADER_HEIGHT = 52;
export const HEADER_HEIGHT_COMPACT = 44;

/**
 * Имя CSS-переменной в src/theme/tokens.css → её числовое значение в px.
 * Сторож tests/sizes.test.ts требует, чтобы каждый токен из этой карты
 * присутствовал в tokens.css ровно с этим значением.
 */
export const SIZE_TOKENS: Readonly<Record<string, number>> = {
  '--pm-stage-node-width': STAGE_NODE_SIZE.width,
  '--pm-stage-node-height': STAGE_NODE_SIZE.height,
  '--pm-stage-node-width-compact': STAGE_NODE_SIZE_COMPACT.width,
  '--pm-stage-node-height-compact': STAGE_NODE_SIZE_COMPACT.height,
  '--pm-io-node-width': IO_NODE_SIZE.width,
  '--pm-io-node-height': IO_NODE_SIZE.height,
  '--pm-step-node-width': STEP_NODE_SIZE.width,
  '--pm-step-node-height': STEP_NODE_SIZE.height,
  '--pm-data-node-width': DATA_NODE_SIZE.width,
  '--pm-data-node-height': DATA_NODE_SIZE.height,
  '--pm-drawer-width': DRAWER_WIDTH,
  '--pm-header-height': HEADER_HEIGHT,
  '--pm-header-height-compact': HEADER_HEIGHT_COMPACT,
};
