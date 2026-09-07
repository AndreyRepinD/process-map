// Экспорт и импорт карты процесса (SPEC §3 «Overrides», §4.4 «тулбар редактора»).
//
// ПОЧЕМУ ЭТОТ ФАЙЛ ВЫГЛЯДИТ СЛОЖНЕЕ, ЧЕМ «сохранить и прочитать»
// -------------------------------------------------------------
// SPEC §3 описывает два конца одной кнопочной пары РАЗНЫМИ форматами:
//   «Экспорт отдаёт полный слитый `process.json`; импорт валидирует zod'ом
//    и заменяет overrides.»
// Экспорт — это ProcessMap (вся карта), а хранилище — Overrides
// (Record<nodeId, { screen?: ScreenLink | null, … }>). Если понять импорт
// буквально как «файл overrides», round-trip «экспорт → импорт» не сойдётся:
// пользователь выгрузит одно, а положить обратно сможет только другое, и
// единственный файл, который приложение отдаёт, оно же и не примет.
//
// Здесь противоречие снимается так: импорт принимает ФАЙЛ ПОЛНОЙ КАРТЫ (ровно
// то, что отдал экспорт), валидирует его ProcessMapSchema (это и есть
// «валидирует zod'ом»), а затем ВЫЧИСЛЯЕТ overrides как разницу между
// импортированной картой и базовым process.json — и заменяет ими хранилище
// (это и есть «заменяет overrides»). Оба требования SPEC выполняются, а
// round-trip замыкается.
//
// Ключевой случай, который эта разница обязана пережить, — «ссылка удалена
// пользователем»:
//   база: node.screen задан  →  в файле screen нет  →  override { screen: null }
// то есть «пользователь удалил ссылку», а НЕ «ссылки не было». Обратное
// сопоставление (нет записи в overrides) означало бы откат к значению из
// process.json — см. комментарии в src/data/loader.ts::applyNodeOverride.
//
// Чего импорт СОЗНАТЕЛЬНО не переносит: всё, что не является node.screen —
// version/updatedAt/title, координаты, рёбра, stage.screen, новые узлы.
// Overrides (SPEC §3) физически не умеют это выразить, поэтому такие правки
// в файле игнорируются молча. Файл при этом остаётся валидным и импорт не
// падает.
import { parseOverrides, parseProcessMap } from '../data/loader';
import {
  ProcessMapSchema,
  type AddedNode,
  type OverrideEntry,
  type Overrides,
  type ProcessMap,
  type ProcessNode,
  type ScreenLink,
} from '../data/schema';

/**
 * Имя скачиваемого файла: `process.<id карты>.json` (SPEC §4.4).
 *
 * ЗАЧЕМ ИМЯ КАРТЫ В ФАЙЛЕ (решение владельца, process-map-3wh.13). Карт две, а
 * инструкция владельцу говорит «положи скачанный файл в src/data/<карта>/».
 * С одинаковым именем `process.json` файл, выгруженный из вкладки MRP и
 * положенный по пути SNP, затёр бы карту SNP целиком. Побайтовый тест такое
 * поймал бы, но только если больше ничего не менялось. Имя, которое само
 * говорит, откуда файл, делает ошибку невозможной, а не маловероятной.
 *
 * Берётся из ТОЙ САМОЙ карты, которую сериализуем, а не из константы сборки:
 * имя и содержимое тогда не могут разойтись.
 */
export function exportFileName(map: ProcessMap): string {
  return `process.${map.id}.json`;
}

/**
 * Текст файла экспорта — байт в байт в формате репозитория, чтобы выгруженный
 * файл можно было положить в src/data/snp/process.json без diff-шума:
 * отступ 2 пробела, кириллица без \u-экранирования (JSON.stringify её не
 * экранирует, как и `ensure_ascii=False` в scripts/import-pptx.py), перевод
 * строки в конце, LF. То же самое делает scripts/layout.ts::serialize.
 *
 * Карта прогоняется через parseProcessMap не ради валидации, а ради
 * НОРМАЛИЗАЦИИ: zod пересобирает объекты в порядке ключей схемы. Без этого
 * узел, которому overrides добавили screen, получил бы ключ screen последним
 * (после position) — файл остался бы валидным, но перестал совпадать с
 * порядком ключей в process.json.
 */
export function serializeProcessMap(map: ProcessMap): string {
  return `${JSON.stringify(parseProcessMap(map), null, 2)}\n`;
}

function screensEqual(a: ScreenLink | undefined, b: ScreenLink | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.title === b.title && a.url === b.url;
}

/**
 * Разница «импортированная карта минус базовый process.json» в виде overrides.
 *
 * Правила (base → imported):
 *   - screen совпал                → записи нет (правки нет);
 *   - в файле есть, в базе нет/иной → { screen: {...} };
 *   - в базе есть, в файле нет      → { screen: null } (ссылка удалена);
 *   - узла нет в файле              → записи нет (нечего сравнивать).
 * Узлы, которых нет в базе, игнорируются: overrides адресуются по id узла
 * базовой карты, а добавление узлов v1 не поддерживает.
 */
/** Совпадают ли два списка построчно. undefined и пустой список — разное. */
function listsEqual(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export function deriveOverrides(base: ProcessMap, imported: ProcessMap): Overrides {
  const importedNodes = new Map<string, ProcessNode>();
  const importedStageOf = new Map<string, number>();
  for (const stage of imported.stages) {
    for (const node of stage.nodes) {
      importedNodes.set(node.id, node);
      importedStageOf.set(node.id, stage.number);
    }
  }

  const overrides: Overrides = {};
  const seen = new Set<string>();
  for (const stage of base.stages) {
    for (const node of stage.nodes) {
      seen.add(node.id);
      const next = importedNodes.get(node.id);
      if (next === undefined) {
        // Узла нет в файле — значит его убрали правкой. Отличается от «файл
        // про этот узел ничего не говорит»: файл экспортируется целиком.
        overrides[node.id] = { removed: true };
        continue;
      }
      const entry: OverrideEntry = {};
      if (!screensEqual(node.screen, next.screen)) {
        // undefined здесь означает «в базе ссылка была, в файле её нет», то есть
        // явное удаление — null, а не отсутствие записи.
        entry.screen = next.screen ?? null;
      }
      if (!listsEqual(node.algorithms, next.algorithms)) {
        entry.algorithms = next.algorithms ?? null;
      }
      if (node.label !== next.label) {
        entry.label = next.label;
      }
      if (node.description !== next.description) {
        entry.description = next.description ?? null;
      }
      if (node.owner !== next.owner) {
        entry.owner = next.owner ?? null;
      }
      if (!listsEqual(node.inputs, next.inputs)) {
        entry.inputs = next.inputs ?? null;
      }
      if (!listsEqual(node.outputs, next.outputs)) {
        entry.outputs = next.outputs ?? null;
      }
      if (Object.keys(entry).length > 0) {
        overrides[node.id] = entry;
      }
    }
  }

  // Узлы, которых в базовой карте нет вовсе: их создали правкой. Восстанавливаем
  // и признак added — без него узел не попал бы обратно на карту при импорте.
  for (const [id, node] of importedNodes) {
    if (seen.has(id)) {
      continue;
    }
    const added: AddedNode = { stage: importedStageOf.get(id) ?? 1, type: node.type };
    if (node.direction !== undefined) {
      added.direction = node.direction;
    }
    if (node.group !== undefined) {
      added.group = node.group;
    }
    const entry: OverrideEntry = { added, label: node.label };
    if (node.description !== undefined) {
      entry.description = node.description;
    }
    if (node.owner !== undefined) {
      entry.owner = node.owner;
    }
    if (node.inputs !== undefined) {
      entry.inputs = node.inputs;
    }
    if (node.outputs !== undefined) {
      entry.outputs = node.outputs;
    }
    if (node.screen !== undefined) {
      entry.screen = node.screen;
    }
    if (node.algorithms !== undefined) {
      entry.algorithms = node.algorithms;
    }
    overrides[id] = entry;
  }
  return overrides;
}

/**
 * Разбирает текст импортируемого файла в overrides, готовые к записи.
 * `null` — файл не подошёл (битый JSON или не карта процесса); вызывающий код
 * обязан это учесть и НЕ писать в хранилище.
 *
 * parseOverrides в конце — не формальность: replaceOverrides() ничего не
 * валидирует (см. src/data/loader.ts), поэтому единственная гарантия, что в
 * localStorage попадёт разбираемая форма, — строгая проверка здесь.
 */
export function parseImportedOverrides(text: string, base: ProcessMap): Overrides | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  const parsed = ProcessMapSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  // ФАЙЛ ДОЛЖЕН БЫТЬ ОТ ЭТОЙ ЖЕ КАРТЫ. Раньше проверки не было и она была не
  // нужна: узлы с незнакомыми id просто игнорировались, и файл карты SNP,
  // загруженный в MEIO, давал пустой результат. С правками содержания
  // незнакомый узел означает «его создали правкой», и тот же чужой файл влил бы
  // в карту все свои узлы разом. Поэтому карта теперь сверяется по id — тому
  // самому, ради которого ProcessMap.id и заведён (schema.ts).
  if (parsed.data.id !== base.id) {
    return null;
  }

  try {
    return parseOverrides(deriveOverrides(base, parsed.data));
  } catch {
    return null;
  }
}
