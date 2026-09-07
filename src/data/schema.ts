// Zod-схемы и типы модели данных process.json (SPEC.md §3).
// Типы выводятся из схем через z.infer — интерфейсы SPEC не дублируются руками.
import { z } from 'zod';

// Тип узла уровня 2. Первые четыре значения — исходная модель, снятая с
// презентаций; три последних добавлены импортом BPMN (эпик M6, задача
// process-map-70e.4).
//
// ПОЧЕМУ ТРИ ЗНАЧЕНИЯ, А НЕ ДВЕНАДЦАТЬ. Вид шлюза и вид события живут в
// отдельных полях ниже, а не в самом перечислении. Тип узла отображается
// ОДИН В ОДИН в тип узла React Flow (tests/stageGraph.test.ts) и в пункт
// легенды: плоское перечисление вида gatewayExclusive | eventStartMessage дало
// бы дюжину почти одинаковых компонентов в nodeTypes и дюжину пунктов легенды
// под полотном шириной 1024.
//
// ПЕРЕЧИСЛЕНИЕ ЗАКРЫТОЕ, и открывать его в z.string() нельзя: единственный
// работающий сторож исчерпаемости — NODE_SIZE: Record<NodeType, Size> в
// src/layout/stageLayout.ts. При добавлении значения tsc падает и заставляет
// назначить размер; с открытым союзом сторож исчез бы, а React Flow на
// незнакомый тип молча нарисовал бы узел по умолчанию. Разбор BPMN обязан
// СВОДИТЬ элементы Camunda к этим значениям, а не изобретать новые в рантайме.
export const NodeTypeSchema = z.enum([
  'step',
  'data',
  'integration',
  'warning',
  'gateway',
  'event',
  'subprocess',
]);
export type NodeType = z.infer<typeof NodeTypeSchema>;

// Вид шлюза BPMN. Имеет смысл только при type === 'gateway'.
export const GatewayKindSchema = z.enum([
  'exclusive',
  'parallel',
  'inclusive',
  'eventBased',
  'complex',
]);
export type GatewayKind = z.infer<typeof GatewayKindSchema>;

// Место события в потоке. Имеет смысл только при type === 'event'.
//
// Значения 'boundary' в перечислении НЕТ намеренно: узел не может быть
// прикреплён к узлу, и в модели владельца (In.Plan Process Model v11)
// граничных событий нет ни одного — заводить значение под конструкцию,
// которую нечем показать и которая не встречается, значило бы обещать
// поддержку, которой не будет.
export const EventKindSchema = z.enum(['start', 'intermediate', 'end']);
export type EventKind = z.infer<typeof EventKindSchema>;

// Определение события: чем оно вызывается или что бросает. 'none' — простое
// событие без определения; в модели владельца такие все, кроме 'link'.
export const EventDefinitionSchema = z.enum([
  'none',
  'link',
  'message',
  'timer',
  'error',
  'signal',
  'escalation',
  'terminate',
]);
export type EventDefinition = z.infer<typeof EventDefinitionSchema>;

export const SystemCodeSchema = z.enum(['DP', 'PS', 'IO', 'ERP', 'MRP', 'INPLAN', 'BI', 'EPM']);
export type SystemCode = z.infer<typeof SystemCodeSchema>;

export const ScreenLinkSchema = z.object({
  title: z.string(),
  url: z.string(),
});
export type ScreenLink = z.infer<typeof ScreenLinkSchema>;

// Направление артефакта относительно этапа: 'in' — этап его потребляет,
// 'out' — производит. Одна схема на две сущности (ProcessNode.direction и
// ExternalIO.direction) — намеренно: вопрос у них дословно один и тот же
// («в какой колонке этапа стоит артефакт»), и разводить два одинаковых
// перечисления значило бы завести два словаря для одного понятия. Отличаются
// они не смыслом направления, а тем, ЧТО именно направлено: ExternalIO — это
// свимлейн внешней системы уровня 1, ProcessNode — карточка внутри этапа.
export const DirectionSchema = z.enum(['in', 'out']);
export type Direction = z.infer<typeof DirectionSchema>;

export const ProcessNodeSchema = z.object({
  id: z.string(),
  type: NodeTypeSchema,
  // Уточнение типа для узлов, пришедших из BPMN. Поля ставит разбор схемы по
  // элементу, а не человек: руками их не правят и в PRESERVED_NODE_FIELDS
  // импортёра они не входят — прецедент тот же, что у direction.
  //
  // Опциональны, а не обязательны при своём типе: zod не выражает зависимость
  // «поле обязательно, если type === X» без discriminatedUnion, а он
  // потребовал бы разбить ProcessNode на семь схем и переписать всех
  // потребителей. Цена — договорённость, а не проверка типом.
  gatewayKind: GatewayKindSchema.optional(),
  eventKind: EventKindSchema.optional(),
  eventDefinition: EventDefinitionSchema.optional(),
  label: z.string(),
  description: z.string().optional(),
  group: z.string().optional(),
  // Колонка, в которой стоит data-узел на экране детализации: 'in' — вход
  // этапа, 'out' — выход (SPEC §4.2). Для остальных типов узлов поле не имеет
  // смысла и не проставляется.
  //
  // ЗАЧЕМ ЯВНОЕ ПОЛЕ (задача process-map-24p). Раньше колонку выводили
  // геометрически: узел левее середины области шагов — вход. На реальных
  // слайдах это давало ноль выходов у этапов 1 и 2, хотя их карточки в обзоре
  // перечисляют по 2–3 ключевых выхода: блоки выходов презентация рисует не
  // справа от потока, а под контейнером этапа на слайде обзора, и по абсциссе
  // они попадали левее середины. Экран противоречил сам себе («15 входов ·
  // 0 выходов»), поэтому направление больше не выводится из координат.
  //
  // Значение ставит импортёр — не эвристикой, а ПО ПРОИСХОЖДЕНИЮ фигуры, см.
  // scripts/import-pptx.py::NodeDraft.direction: узлы левой колонки слайда
  // детализации — 'in', узлы блоков выходов этапа со слайда обзора — 'out'.
  // Других способов породить data-узел у импортёра нет, поэтому поле стоит
  // у всех узлов, и правкой руками это поле не является.
  //
  // Поле НЕОБЯЗАТЕЛЬНОЕ: документ без него (старый файл, экспорт из стороннего
  // инструмента) остаётся валидным, и такой узел раскладывается по прежнему
  // геометрическому правилу — src/utils/stageNodes.ts, единственный источник
  // правила. Сделать его обязательным значило бы сломать и такие документы,
  // и импорт JSON из §4.7.
  direction: DirectionSchema.optional(),
  inputs: z.array(z.string()).optional(),
  outputs: z.array(z.string()).optional(),
  system: SystemCodeSchema.optional(),
  owner: z.string().optional(),
  screen: ScreenLinkSchema.optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  // Исходная геометрия слайда презентации (левый верхний угол фигуры, px).
  //
  // ЗАЧЕМ ОТДЕЛЬНОЕ ПОЛЕ. `position` — ПРОИЗВОДНАЯ величина: её перезаписывает
  // `npm run layout` (dagre). Если бы раскладка сидировалась `position`, она
  // после первого же прогона опиралась бы на результат собственной прошлой
  // работы, а геометрия слайда была бы потеряна навсегда (задача
  // process-map-cxn). Поэтому импортёр кладёт координаты фигуры ещё и сюда, а
  // scripts/layout.ts берёт исходный порядок узлов и деление data-узлов на
  // колонки входов/выходов именно отсюда.
  //
  // Поле СЛУЖЕБНОЕ: в UI не используется (React Flow получает только
  // `position`), в рантайме не читается. Оно опционально — карта без него
  // (старый файл, экспорт из стороннего инструмента) остаётся валидной, а
  // раскладка в этом случае откатывается на `position` и громко сообщает,
  // что исходная геометрия утрачена.
  //
  // Имя НЕ `sourcePosition`: у React Flow `Node.sourcePosition` — это сторона
  // хэндла ('left' | 'right' | ...), и совпадение имён в этом проекте читалось
  // бы как ошибка (см. components/edges/*).
  slidePosition: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type ProcessNode = z.infer<typeof ProcessNodeSchema>;

export const GroupSchema = z.object({
  id: z.string(),
  label: z.string(),
});
export type Group = z.infer<typeof GroupSchema>;

export const EdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  kind: z.enum(['process', 'integration', 'data']),
  label: z.string().optional(),
});
export type Edge = z.infer<typeof EdgeSchema>;

export const ExternalIOSchema = z.object({
  system: SystemCodeSchema,
  label: z.string(),
  stage: z.number(),
  direction: DirectionSchema,
});
export type ExternalIO = z.infer<typeof ExternalIOSchema>;

export const StageSchema = z.object({
  id: z.string(),
  // Номер этапа, начиная с единицы.
  //
  // БЫЛО z.union([1,2,3,4]) — жёсткая четвёрка, снятая с презентаций SNP и MRP.
  // Снято задачей process-map-70e.4: этапы загруженной схемы BPMN приходят из
  // подпроцессов верхнего уровня, и их столько, сколько в файле. В модели
  // владельца модулей двенадцать, из них непустых десять.
  //
  // Инвариант «ровно четыре» не исчез, а ПЕРЕЕХАЛ из tests/mapContract.test.ts
  // в tests/snp/content.test.ts и tests/mrp/content.test.ts: по таксономии
  // SPEC §7 это факт про поставляемые карты, а не про любую карту.
  number: z.number().int().min(1),
  title: z.string(),
  shortTitle: z.string(),
  keyOutputs: z.array(z.string()).max(4),
  warningsCount: z.number().optional(),
  screen: ScreenLinkSchema.optional(),
  groups: z.array(GroupSchema),
  nodes: z.array(ProcessNodeSchema),
  edges: z.array(EdgeSchema),
  inputs: z.array(ExternalIOSchema),
  outputs: z.array(ExternalIOSchema),
});
export type Stage = z.infer<typeof StageSchema>;

export const ProcessMapSchema = z.object({
  version: z.string(),
  // Идентификатор карты (process-map-3wh.4). Совпадает с именем каталога
  // src/data/<id>/ и задаёт ключ overrides в localStorage.
  //
  // ПОЧЕМУ В ДАННЫХ, А НЕ В СБОРКЕ. Ключ хранилища выводится из этого поля, то
  // есть из того самого файла, который реально попал в бандл: забытый MAP=mrp
  // даст карту SNP с ключом SNP, а не данные MRP под чужим ключом. Плюс
  // выгруженный process.json (он ходит из браузера в репозиторий руками —
  // docs/ссылки-на-экраны.md) становится самоописывающимся.
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  // Формат закреплён (process-map-vjz.10): формально это строка, но шапка
  // обзора гонит её через formatIsoDate, а тот при непопадании в ISO отдаёт
  // вход как есть — то есть пустое значение или «вчера» уехали бы на экран
  // сырьём. Экспорт всегда пишет date-only, поэтому времени в шаблоне нет.
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string(),
  // Подпись рамки вокруг всего потока этапов на обзоре: «Модуль SNP»,
  // «Модуль MRP». Была строкой интерфейса (ru.overview.laneFlow), но меняется
  // от карты к карте — значит это свойство документа, как title и updatedAt.
  //
  // ОБЯЗАТЕЛЬНОЕ. Опциональное с фолбэком на i18n дешевле на коммит, но
  // позволило бы второй карте уехать в прод с подписью первой, и никто бы не
  // заметил.
  moduleLabel: z.string(),
  stages: z.array(StageSchema),
  overviewEdges: z.array(EdgeSchema),
});
export type ProcessMap = z.infer<typeof ProcessMapSchema>;

// Overrides (localStorage), SPEC.md §3 «Overrides».
//
// ТРИ СОСТОЯНИЯ У КАЖДОГО ПОЛЯ, и различать их обязательно:
//   · ключа нет  — «не трогали», берём значение из process.json;
//   · null       — «очистили явно» (кнопка «Удалить ссылку» и её аналоги);
//   · значение   — «заменили».
// Поэтому у полей .nullable().optional(), а не просто .optional().
//
// ЗАЧЕМ ЗДЕСЬ СОДЕРЖАНИЕ, А НЕ ТОЛЬКО ССЫЛКА (решение владельца от 07.09.2026).
// Раньше правки в браузере ограничивались полем screen: содержание карты
// собирается конвейером из authoring source, и правка в process.json была бы
// затёрта следующим прогоном. Теперь владелец правит содержание прямо на карте,
// а обратно в authoring source оно попадает через «Экспорт JSON» — тем же
// путём, которым уже ходят ссылки на экраны (docs/ссылки-на-экраны.md).
//
// ЧТО ЗДЕСЬ НЕ РЕДАКТИРУЕТСЯ И ПОЧЕМУ. position и slidePosition: координаты —
// производная величина, их считает scripts/layout.ts, и правка руками была бы
// затёрта. Рёбра: связь принадлежит этапу, а не узлу, и в Record<nodeId, …> её
// не выразить.
export const AddedNodeSchema = z.object({
  /** Номер этапа, в который добавлен узел (Stage.number). */
  stage: z.number().int().min(1),
  type: NodeTypeSchema,
  /** Колонка для data-узла: вход или выход. */
  direction: DirectionSchema.optional(),
  /** id группы внутри этапа, если узел кладётся в группу. */
  group: z.string().optional(),
});
export type AddedNode = z.infer<typeof AddedNodeSchema>;

export const OverrideEntrySchema = z.object({
  screen: ScreenLinkSchema.nullable().optional(),
  label: z.string().optional(),
  description: z.string().nullable().optional(),
  inputs: z.array(z.string()).nullable().optional(),
  outputs: z.array(z.string()).nullable().optional(),
  owner: z.string().nullable().optional(),
  /**
   * Узел скрыт правкой. Именно `true`, а не булев флаг: значение false
   * означало бы «восстановлен», а восстановление делается удалением записи —
   * два способа сказать одно и то же расходятся при первом же рассинхроне.
   */
  removed: z.literal(true).optional(),
  /** Узел, которого в process.json нет вовсе: он создан правкой. */
  added: AddedNodeSchema.optional(),
});
export type OverrideEntry = z.infer<typeof OverrideEntrySchema>;

export const OverridesSchema = z.record(z.string(), OverrideEntrySchema);
export type Overrides = z.infer<typeof OverridesSchema>;

/**
 * Ключ overrides в localStorage — СВОЙ У КАЖДОЙ КАРТЫ (process-map-3wh.5).
 *
 * ЗАЧЕМ. Карты раздаются с одного origin (корень и подкаталог /mrp/), а
 * localStorage общий на origin. С единым ключом обе карты писали бы правки в
 * одно пространство имён по nodeId. Визуально это не ломается: mergeOverrides
 * молча игнорирует неизвестные id, поэтому чужие правки просто «не работают».
 * Но «Сбросить правки» на одной карте стирал бы черновик другой, а «Экспорт
 * JSON» отдавал бы чистый файл сразу после правки. Такое ловится жалобой, а не
 * тестом.
 */
export function overridesStorageKey(mapId: string): string {
  return `inplan-process-map:${mapId}:overrides:v1`;
}

/**
 * Ключ до разделения карт. Оставлен ТОЛЬКО для миграции: под ним лежат правки,
 * сделанные владельцем до этой задачи (docs/ссылки-на-экраны.md — черновик,
 * который переносят в репозиторий руками). Новых записей под ним не бывает,
 * и loader его НЕ УДАЛЯЕТ: удаление необратимо, а решение о сбросе принимает
 * пользователь кнопкой (SPEC §4.4).
 */
export const LEGACY_OVERRIDES_STORAGE_KEY = 'inplan-process-map:overrides:v1';

/** Карта, которой принадлежал легаси-ключ: мигрируем правки только в неё. */
export const LEGACY_OVERRIDES_MAP_ID = 'snp';

/**
 * Проверка ссылочной целостности ProcessMap:
 * - все edge.source/edge.target указывают на существующие id: для stage.edges —
 *   на узлы ТОГО ЖЕ этапа, для overviewEdges — см. ниже;
 * - id узлов уникальны глобально по всему документу (не только внутри этапа);
 * - id рёбер уникальны глобально (React Flow требует уникальных id в пределах
 *   отрисовываемого графа);
 * - node.group, если задан, ссылается на существующую group своего этапа.
 *
 * Для overviewEdges допустимыми source/target считаются:
 *   - id любого этапа (stage.id) — рёбра этап → этап;
 *   - код внешней системы (SystemCode), присутствующий хотя бы в одном
 *     ExternalIO (stage.inputs/stage.outputs) какого-либо этапа — рёбра
 *     система → этап (SPEC §3, §4.1: свимлейны уровня 1 — это внешние
 *     системы, а не узлы графа с собственным id).
 * Это два разных пространства идентификаторов (kebab-case id этапов и
 * короткие коды систем DP/PS/IO/ERP/MRP/INPLAN/BI/EPM), поэтому конфликтов имён
 * не возникает и ложных ошибок не даёт.
 */
export function validateIntegrity(map: ProcessMap): string[] {
  const problems: string[] = [];

  const allNodeIds = new Set<string>();
  const duplicateNodeIds = new Set<string>();
  for (const stage of map.stages) {
    for (const node of stage.nodes) {
      if (allNodeIds.has(node.id)) {
        duplicateNodeIds.add(node.id);
      }
      allNodeIds.add(node.id);
    }
  }
  for (const id of duplicateNodeIds) {
    problems.push(`Дублирующийся id узла: "${id}"`);
  }

  const stageIds = new Set(map.stages.map((stage) => stage.id));
  const systemCodes = new Set<string>();
  for (const stage of map.stages) {
    for (const io of [...stage.inputs, ...stage.outputs]) {
      systemCodes.add(io.system);
    }
  }

  const seenEdgeIds = new Set<string>();
  const checkEdgeId = (edge: Edge, scope: string): void => {
    if (seenEdgeIds.has(edge.id)) {
      problems.push(`Дублирующийся id ребра: "${edge.id}" (${scope})`);
    }
    seenEdgeIds.add(edge.id);
  };

  for (const stage of map.stages) {
    const groupIds = new Set(stage.groups.map((group) => group.id));

    for (const node of stage.nodes) {
      if (node.group !== undefined && !groupIds.has(node.group)) {
        problems.push(
          `Узел "${node.id}" (этап "${stage.id}") ссылается на несуществующую группу "${node.group}"`,
        );
      }
    }

    // Рёбра этапа проверяются против узлов ЭТОГО этапа, а не против глобального
    // множества: stage.edges рисуются внутри одного экрана детализации (SPEC §4.2),
    // и ссылка на узел чужого этапа — ошибка данных, а не допустимая связь.
    const stageNodeIds = new Set(stage.nodes.map((node) => node.id));

    for (const edge of stage.edges) {
      checkEdgeId(edge, `этап "${stage.id}"`);
      if (!stageNodeIds.has(edge.source)) {
        problems.push(
          `Ребро "${edge.id}" (этап "${stage.id}"): source "${edge.source}" не найден среди узлов этого этапа`,
        );
      }
      if (!stageNodeIds.has(edge.target)) {
        problems.push(
          `Ребро "${edge.id}" (этап "${stage.id}"): target "${edge.target}" не найден среди узлов этого этапа`,
        );
      }
    }
  }

  const isValidOverviewEndpoint = (value: string): boolean =>
    stageIds.has(value) || systemCodes.has(value);

  for (const edge of map.overviewEdges) {
    checkEdgeId(edge, 'обзор');
    if (!isValidOverviewEndpoint(edge.source)) {
      problems.push(
        `Ребро обзора "${edge.id}": source "${edge.source}" не является ни id этапа, ни кодом системы`,
      );
    }
    if (!isValidOverviewEndpoint(edge.target)) {
      problems.push(
        `Ребро обзора "${edge.id}": target "${edge.target}" не является ни id этапа, ни кодом системы`,
      );
    }
  }

  return problems;
}
