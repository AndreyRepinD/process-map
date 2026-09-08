// Загрузка ProcessMap и наложение пользовательских overrides (SPEC.md §3 «Overrides»).
//
// Файл разделён на две части:
//   1) чистые функции (parse/merge) — работают без браузера и покрыты тестами;
//   2) обёртки над localStorage — все обращения в try/catch, ни одна ошибка
//      хранилища не должна ронять приложение.
//
// Устойчивость (см. также tests/loader-merge.test.ts):
//   - localStorage отсутствует (SSR, node-окружение) → читатели возвращают {},
//     писатели возвращают false; приложение работает на «чистом» JSON;
//   - под ключом лежит битый или чужой JSON → он игнорируется (overrides = {}),
//     карта отдаётся без правок. Повреждённое значение НЕ удаляется молча:
//     решение о сбросе принимает пользователь кнопкой «Сбросить правки» (SPEC §4.4);
//   - переполнение квоты при записи (QuotaExceededError) → writeStoredOverrides
//     возвращает false, состояние в памяти остаётся корректным, вызывающий UI
//     решает, что показать пользователю.
// Данные собираемой карты. Какой именно — решает алиас @map в конфигах
// сборки (scripts/mapTarget.ts): в src/ нет ни process.env, ни import.meta.env,
// ни ветвлений, и в бандл попадает ровно один JSON.
import rawProcessJson from '@map/process.json';
import {
  LEGACY_OVERRIDES_MAP_ID,
  LEGACY_OVERRIDES_STORAGE_KEY,
  OverridesSchema,
  overridesStorageKey,
  ProcessMapSchema,
  type AddedNode,
  type Edge,
  type ExternalIO,
  type OverrideEntry,
  type Overrides,
  type ProcessMap,
  type ProcessNode,
  type ScreenLink,
  type Stage,
} from './schema';

/**
 * Идентификатор карты и её ключ overrides.
 *
 * Берётся ИЗ ДАННЫХ, а не из переменной сборки: тогда ключ выведен из того
 * самого файла, который реально попал в бандл. Забытый MAP=mrp даёт карту SNP
 * с ключом SNP — то есть просто вторую копию SNP, — а не данные MRP под чужим
 * ключом (process-map-3wh.5).
 */
const MAP_ID = rawProcessJson.id;

/** Ключ overrides ЗАГРУЖЕННОЙ карты. Экспортируется, чтобы тесты и отладка
 *  брали ровно то значение, которым пользуется код, а не повторяли формулу. */
export const OVERRIDES_KEY = overridesStorageKey(MAP_ID);

/**
 * id ЗАГРУЖЕННОЙ карты (`dp`, `meio`, `snp`, `mrp`).
 *
 * Экспортируется по той же причине, что и OVERRIDES_KEY: значение выведено из
 * файла, реально попавшего в бандл. Интерфейсу он нужен, чтобы подсказать
 * список алгоритмов СВОЕГО модуля (src/data/algorithms.ts), а не читать его из
 * переменной сборки, которую можно забыть выставить.
 */
export const LOADED_MAP_ID: string = MAP_ID;

// ───────────────────────────── чистые функции ─────────────────────────────

/** Валидирует произвольное значение как ProcessMap. Бросает ZodError при несоответствии. */
export function parseProcessMap(raw: unknown): ProcessMap {
  return ProcessMapSchema.parse(raw);
}

/** Валидирует overrides. Бросает ZodError — нужен для импорта JSON (M3). */
export function parseOverrides(raw: unknown): Overrides {
  return OverridesSchema.parse(raw);
}

/** Мягкая валидация overrides: всё, что не проходит схему, превращается в {}. */
export function safeParseOverrides(raw: unknown): Overrides {
  const result = OverridesSchema.safeParse(raw);
  return result.success ? result.data : {};
}

/**
 * Накладывает override на один узел. Три различимых состояния:
 *   - записи нет / entry.screen === undefined → screen остаётся из JSON;
 *   - entry.screen — объект → заменяет screen узла;
 *   - entry.screen === null → ссылка удалена явно, поле screen убирается из узла
 *     (именно убирается, а не откатывается к значению из JSON).
 *
 * Различие «нет ключа» и «null» опирается на то, что zod для .optional() не
 * создаёт ключ, которого не было во входных данных, поэтому undefined
 * однозначно означает «не трогали».
 */
/**
 * Накладывает правку на одно поле узла по общему правилу трёх состояний:
 * ключа нет — не трогали; null — очистили явно; значение — заменили.
 */
function patchField<K extends keyof ProcessNode>(
  node: ProcessNode,
  key: K,
  value: ProcessNode[K] | null | undefined,
): ProcessNode {
  if (value === undefined) {
    return node;
  }
  if (value === null) {
    if (node[key] === undefined) {
      return node;
    }
    const stripped: ProcessNode = { ...node };
    delete stripped[key];
    return stripped;
  }
  return { ...node, [key]: value };
}

function applyNodeOverride(node: ProcessNode, overrides: Overrides): ProcessNode {
  const entry = overrides[node.id];
  if (entry === undefined) {
    return node;
  }
  let next = patchField(node, 'screen', entry.screen);
  next = patchField(next, 'algorithms', entry.algorithms);
  // label без null: подпись — обязательное поле схемы, «очистить» её нельзя,
  // а безымянная карточка на полотне была бы хуже неправленой.
  next = patchField(next, 'label', entry.label);
  next = patchField(next, 'description', entry.description);
  next = patchField(next, 'inputs', entry.inputs);
  next = patchField(next, 'outputs', entry.outputs);
  next = patchField(next, 'owner', entry.owner);
  next = patchField(next, 'position', entry.position);
  next = patchField(next, 'size', entry.size);
  return next;
}

/** Идентификатор ребра — тот же формат, что у импортёра (scripts/import-pptx.py). */
function edgeId(source: string, target: string): string {
  return `e-${source}--${target}`;
}

/**
 * Рёбра этапа после правок: снятые убраны, проведённые добавлены.
 *
 * ОБА КОНЦА ОБЯЗАНЫ БЫТЬ ЖИВЫ И ЛЕЖАТЬ В ЭТОМ ЖЕ ЭТАПЕ. Межэтапную связь
 * вручную не проводят: на обзоре она выводится из потока шагов, а нарисованная
 * поверх — рассказывала бы о процессе то, чего в нём нет.
 */
function mergeStageEdges(stage: Stage, overrides: Overrides, alive: Set<string>): Edge[] {
  const here = new Set(stage.nodes.map((node) => node.id));
  // СРАВНЕНИЕ ПО ПАРЕ КОНЦОВ, А НЕ ПО id. У рёбер из process.json id свой
  // (импортёр SNP выдаёт «stage-1-edge-1»), и сверка по вычисленному
  // «e-источник--цель» не нашла бы такое ребро: снятие молча не срабатывало бы,
  // а повторное добавление задваивало бы стрелку. Поймано тестом.
  const pair = (source: string, target: string): string => `${source}\u0000${target}`;

  const removed = new Set<string>();
  for (const [source, entry] of Object.entries(overrides)) {
    for (const target of entry.edgesRemoved ?? []) {
      removed.add(pair(source, target));
    }
  }

  const kept = stage.edges.filter(
    (edge) =>
      alive.has(edge.source) &&
      alive.has(edge.target) &&
      !removed.has(pair(edge.source, edge.target)),
  );
  const present = new Set(kept.map((edge) => pair(edge.source, edge.target)));

  const added: Edge[] = [];
  for (const [source, entry] of Object.entries(overrides)) {
    if (!here.has(source)) {
      continue;
    }
    for (const target of entry.edgesAdded ?? []) {
      const key = pair(source, target);
      if (!here.has(target) || source === target || present.has(key) || removed.has(key)) {
        continue;
      }
      present.add(key);
      added.push({ id: edgeId(source, target), source, target, kind: 'process' });
    }
  }
  return [...kept, ...added];
}

/**
 * Узлы, созданные правкой, — их нет в process.json.
 *
 * КООРДИНАТЫ СИНТЕЗИРУЮТСЯ ЗДЕСЬ, а не приходят из правки: position считает
 * scripts/layout.ts на сборке, и у нового узла его взяться неоткуда. Кладём под
 * последний узел своей колонки — так карточка попадает туда, где её ждут
 * (входы слева, выходы справа, шаги в потоке), и не наезжает на соседа.
 */
function addedNodesFor(stage: Stage, overrides: Overrides): ProcessNode[] {
  const created: ProcessNode[] = [];
  for (const [id, entry] of Object.entries(overrides)) {
    const added = entry.added;
    if (added === undefined || added.stage !== stage.number || entry.removed === true) {
      continue;
    }
    const sameColumn = stage.nodes.filter((node) =>
      added.type === 'data' ? node.direction === added.direction : node.type !== 'data',
    );
    const anchor = sameColumn.at(-1) ?? stage.nodes.at(-1);
    const position = {
      x: anchor?.position.x ?? 0,
      y: (anchor?.position.y ?? 0) + 88,
    };
    const node: ProcessNode = {
      id,
      type: added.type,
      label: entry.label ?? id,
      position,
      slidePosition: { ...position },
    };
    if (added.direction !== undefined) {
      node.direction = added.direction;
    }
    if (added.group !== undefined) {
      node.group = added.group;
    }
    created.push(applyNodeOverride(node, overrides));
  }
  return created;
}

/**
 * Подписи внешних входов и выходов этапа — вслед за правкой их карточки.
 *
 * ЗАЧЕМ. Плашка внешней системы существует на карте ДВАЖДЫ: на экране этапа она
 * обычный data-узел (его и правит владелец), а на обзоре — запись ExternalIO,
 * из которой собирается карточка системы в свимлейне. Пока связи между ними не
 * было, переименованная на этапе плашка оставалась на обзоре со старой
 * подписью: одна вещь, два разных имени, и ни одно не помечено как устаревшее.
 *
 * Сопоставление по ИСХОДНОЙ подписи и направлению: именно так импортёр и
 * порождает обе записи из одной фигуры слайда. Правка ищется по базовому имени,
 * а подставляется новое — поэтому переименование не рвёт связь на втором заходе.
 */
function renameIo(stage: Stage, ios: ExternalIO[], overrides: Overrides): ExternalIO[] {
  if (ios.length === 0) {
    return ios;
  }
  // Ключ — только ПОДПИСЬ: у карты MEIO внешняя плашка это карточка данных с
  // направлением, а у SNP тот же обмен нарисован шагом и становится узлом
  // интеграции, у которого направления нет вовсе. Сверять направление можно
  // лишь там, где оно есть, иначе половина карт молча осталась бы без связи.
  const renamed = new Map<string, string>();
  for (const node of stage.nodes) {
    const next = overrides[node.id]?.label;
    if (next !== undefined) {
      renamed.set(node.label, next);
    }
  }
  if (renamed.size === 0) {
    return ios;
  }
  return ios.map((io) => {
    const label = renamed.get(io.label);
    return label === undefined ? io : { ...io, label };
  });
}

/**
 * Иммутабельно накладывает overrides поверх карты: входная карта не мутируется.
 * Overrides применяются только к узлам этапов (SPEC §3 задаёт значение как
 * Record<nodeId, …>); stage.screen не переопределяется — см. отчёт по задаче.
 * Ключи, которым не соответствует ни один узел, игнорируются.
 */
export function mergeOverrides(map: ProcessMap, overrides: Overrides): ProcessMap {
  if (Object.keys(overrides).length === 0) {
    return map;
  }
  const stages: Stage[] = map.stages.map((stage) => {
    const nodes = [
      ...stage.nodes
        .filter((node) => overrides[node.id]?.removed !== true)
        .map((node) => applyNodeOverride(node, overrides)),
      ...addedNodesFor(stage, overrides),
    ];
    return {
      ...stage,
      nodes,
      inputs: renameIo(stage, stage.inputs, overrides),
      outputs: renameIo(stage, stage.outputs, overrides),
    };
  });
  // Рёбра, повисшие на скрытых узлах, выбрасываются: React Flow на ребро в
  // никуда рисует стрелку из угла полотна, а validateIntegrity такой документ
  // и вовсе не пропустит при экспорте.
  const alive = new Set(stages.flatMap((stage) => stage.nodes.map((node) => node.id)));
  return {
    ...map,
    stages: stages.map((stage) => ({
      ...stage,
      edges: mergeStageEdges(stage, overrides, alive),
    })),
  };
}

// ─────────────────────────── работа с localStorage ───────────────────────────

function getStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    // Наличие объекта ещё не гарантирует работоспособность (Safari private mode
    // отдаёт localStorage, но бросает на setItem), поэтому проверяем записью.
    const probe = `${OVERRIDES_KEY}:probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/** Доступен ли localStorage для чтения и записи. */
export function isStorageAvailable(): boolean {
  return getStorage() !== null;
}

/**
 * Переносит правки со старого общего ключа на ключ карты SNP и возвращает их
 * СЫРУЮ строку. Ничего не найдено — null.
 *
 * Три вещи здесь сделаны намеренно и каждая проверена тестом:
 *   1) переносится сырая строка, а НЕ результат safeParseOverrides. Иначе
 *      битое легаси-значение превратилось бы в {} и записалось поверх — то
 *      есть молчаливая потеря, ровно та, которую этот файл обещает не делать;
 *   2) легаси-ключ НЕ удаляется. Удаление необратимо, а решение о сбросе
 *      принимает пользователь кнопкой (SPEC §4.4);
 *   3) миграция работает только для карты, которой ключ принадлежал. Для
 *      второй карты чужой черновик — не её данные.
 *
 * Провал записи по квоте не ошибка: значение всё равно возвращается, а
 * миграция идемпотентно повторится при следующей загрузке.
 */
function migrateLegacyOverrides(): string | null {
  if (MAP_ID !== LEGACY_OVERRIDES_MAP_ID) {
    return null;
  }
  try {
    const legacy = globalThis.localStorage?.getItem(LEGACY_OVERRIDES_STORAGE_KEY);
    if (legacy === null || legacy === undefined || legacy === '') {
      return null;
    }
    try {
      globalThis.localStorage?.setItem(OVERRIDES_KEY, legacy);
    } catch {
      // Квота: перенос не «прилипнет», но правки пользователь всё равно увидит.
    }
    return legacy;
  } catch {
    return null;
  }
}

/** Читает overrides из localStorage. Любая проблема → {}. */
export function readStoredOverrides(): Overrides {
  try {
    const raw = globalThis.localStorage?.getItem(OVERRIDES_KEY) ?? migrateLegacyOverrides();
    if (raw === null || raw === undefined) {
      return {};
    }
    return safeParseOverrides(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Пишет overrides в localStorage. false — хранилище недоступно или переполнено. */
export function writeStoredOverrides(overrides: Overrides): boolean {
  const storage = getStorage();
  if (storage === null) {
    return false;
  }
  try {
    storage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
    return true;
  } catch {
    return false;
  }
}

/**
 * Создаёт или обновляет override одного узла и сохраняет его.
 * `screen: null` — явное удаление ссылки (SPEC §4.4, кнопка «Удалить ссылку»).
 * Возвращает новый объект overrides, чтобы вызывающий код мог сразу пересчитать
 * merge, не перечитывая хранилище (и работать даже если запись не удалась).
 */
export function setNodeOverride(nodeId: string, screen: ScreenLink | null): Overrides {
  // СЛИЯНИЕ, А НЕ ЗАМЕНА ЗАПИСИ. До правок содержания в записи жило одно поле,
  // и `{ [nodeId]: { screen } }` было верно. Теперь там же лежат подпись,
  // описание, входы, выходы и признак добавленного узла — замена стирала бы их
  // при первой же правке ссылки, молча и без следа.
  const current = readStoredOverrides();
  const next: Overrides = { ...current, [nodeId]: { ...current[nodeId], screen } };
  writeStoredOverrides(next);
  return next;
}

/**
 * Записывает набор алгоритмов узла. `null` — владелец снял привязку целиком
 * (и это НЕ откат к значению из process.json); пустой список к записи не
 * допускается вызывающим кодом, он означал бы то же самое двумя способами.
 */
export function setNodeAlgorithms(nodeId: string, algorithms: string[] | null): Overrides {
  const current = readStoredOverrides();
  const next: Overrides = { ...current, [nodeId]: { ...current[nodeId], algorithms } };
  writeStoredOverrides(next);
  return next;
}

/** Поля содержания узла: подпись, описание, входы, выходы, ответственный. */
export type NodeContentPatch = Pick<
  OverrideEntry,
  'label' | 'description' | 'inputs' | 'outputs' | 'owner'
>;

/** Записывает правку содержания узла поверх уже имеющейся записи. */
export function patchNodeContent(nodeId: string, patch: NodeContentPatch): Overrides {
  const current = readStoredOverrides();
  const next: Overrides = { ...current, [nodeId]: { ...current[nodeId], ...patch } };
  writeStoredOverrides(next);
  return next;
}

/**
 * Идентификатор узла, созданного правкой.
 *
 * НЕ slug ОТ ПОДПИСИ, в отличие от импортёра. Транслитерация там живёт в
 * python-таблице scripts/import-pptx.py, и второй её экземпляр в браузере
 * разошёлся бы с первым при первой же правке таблицы — а id уходят в deep-link
 * и в ключи overrides, где расхождение стоит потерянных ссылок. Префикс `added-`
 * делает происхождение узла видимым в экспортированном JSON без сверки с базой.
 */
export function newNodeId(): string {
  return `added-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Создаёт узел, которого нет в process.json. Возвращает его id. */
export function addNode(draft: AddedNode, label: string): string {
  const id = newNodeId();
  const current = readStoredOverrides();
  writeStoredOverrides({ ...current, [id]: { added: draft, label } });
  return id;
}

/** Запоминает координаты, поставленные перетаскиванием. */
export function resizeNode(nodeId: string, size: { width: number; height: number }): Overrides {
  const current = readStoredOverrides();
  const next: Overrides = { ...current, [nodeId]: { ...current[nodeId], size } };
  writeStoredOverrides(next);
  return next;
}

export function moveNode(nodeId: string, position: { x: number; y: number }): Overrides {
  const current = readStoredOverrides();
  // Округление до целого: React Flow отдаёт дробные координаты, а лишние знаки
  // раздували бы хранилище и диффы экспортированного JSON без всякой пользы.
  const rounded = { x: Math.round(position.x), y: Math.round(position.y) };
  const next: Overrides = { ...current, [nodeId]: { ...current[nodeId], position: rounded } };
  writeStoredOverrides(next);
  return next;
}

/** Разворачивает связь: то, что вело A → B, начинает вести B → A. */
export function reverseEdge(source: string, target: string): Overrides {
  disconnectNodes(source, target);
  return connectNodes(target, source);
}

/** Проводит связь между двумя узлами ОДНОГО этапа. */
export function connectNodes(source: string, target: string): Overrides {
  const current = readStoredOverrides();
  const entry = current[source] ?? {};
  const added = new Set(entry.edgesAdded ?? []);
  added.add(target);
  const removed = (entry.edgesRemoved ?? []).filter((item) => item !== target);
  const next: Overrides = {
    ...current,
    [source]: { ...entry, edgesAdded: [...added], edgesRemoved: removed },
  };
  writeStoredOverrides(next);
  return next;
}

/**
 * Снимает связь.
 *
 * Ребро могло прийти и из process.json, и из правки, поэтому нужны оба
 * действия: убрать из добавленных И записать в снятые. Одного мало — снятие
 * только из добавленных не тронуло бы ребро из карты, а только запись в снятые
 * оставила бы его среди добавленных и вернула бы после перезагрузки.
 */
export function disconnectNodes(source: string, target: string): Overrides {
  const current = readStoredOverrides();
  const entry = current[source] ?? {};
  const removed = new Set(entry.edgesRemoved ?? []);
  removed.add(target);
  const next: Overrides = {
    ...current,
    [source]: {
      ...entry,
      edgesAdded: (entry.edgesAdded ?? []).filter((item) => item !== target),
      edgesRemoved: [...removed],
    },
  };
  writeStoredOverrides(next);
  return next;
}

/**
 * Убирает узел с карты.
 *
 * Для СОЗДАННОГО правкой узла запись удаляется целиком — иначе в overrides
 * копился бы мусор из добавленных и тут же убранных карточек. Для узла из
 * process.json ставится признак `removed`: самого узла в хранилище нет, и
 * «отсутствие записи» означало бы «показывать как есть».
 */
export function removeNode(nodeId: string): Overrides {
  const current = readStoredOverrides();
  const next: Overrides = { ...current };
  if (current[nodeId]?.added !== undefined) {
    delete next[nodeId];
  } else {
    next[nodeId] = { ...current[nodeId], removed: true };
  }
  writeStoredOverrides(next);
  return next;
}

/** Удаляет override одного узла — узел возвращается к значению из JSON. */
export function removeNodeOverride(nodeId: string): Overrides {
  const next: Overrides = { ...readStoredOverrides() };
  delete next[nodeId];
  writeStoredOverrides(next);
  return next;
}

/** Полный сброс правок («Сбросить правки», SPEC §4.4). */
export function resetOverrides(): void {
  try {
    globalThis.localStorage?.removeItem(OVERRIDES_KEY);
  } catch {
    // Хранилище недоступно — сбрасывать нечего.
  }
}

/** Заменяет все overrides целиком (импорт JSON, M3). */
export function replaceOverrides(overrides: Overrides): boolean {
  return writeStoredOverrides(overrides);
}

// ───────────────────────────── публичная загрузка ─────────────────────────────

/** Валидированная карта из process.json, без пользовательских правок. */
export function loadBaseProcessMap(): ProcessMap {
  return parseProcessMap(rawProcessJson);
}

/** Карта из process.json с наложенными overrides из localStorage. */
export function loadProcessMap(): ProcessMap {
  return mergeOverrides(loadBaseProcessMap(), readStoredOverrides());
}

/**
 * Полный слитый ProcessMap для «Экспорт JSON» (SPEC §4.4): экспорт отдаёт
 * готовый process.json, а не только правки.
 */
export function getMergedProcessMap(): ProcessMap {
  return loadProcessMap();
}
