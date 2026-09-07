// Экспорт/импорт JSON и «Сбросить правки» (SPEC §3 «Overrides», §4.4, §7,
// задача process-map-6q0).
//
// Здесь проверяется КОНТРАКТ обмена файлами, без DOM: сериализация, разбор,
// вычисление overrides и round-trip. Скачивание файла и настоящий <input
// type="file"> в jsdom не работают — их проверяет e2e/json-transfer.spec.ts
// (CLAUDE.md «Ловушки»).
//
// Merge overrides сам по себе покрыт в tests/loader-merge.test.ts и здесь не
// дублируется.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getMergedProcessMap,
  loadBaseProcessMap,
  mergeOverrides,
  readStoredOverrides,
  replaceOverrides,
  resetOverrides,
  setNodeOverride,
} from '../src/data/loader';
import type { ProcessMap, ScreenLink } from '../src/data/schema';
import {
  exportFileName,
  deriveOverrides,
  parseImportedOverrides,
  serializeProcessMap,
} from '../src/utils/processTransfer';

// Путь от корня репозитория, а не от import.meta.url: под Vitest он не
// file:-URL (та же оговорка есть в tests/sizes.test.ts).
const PROCESS_JSON_PATH = 'src/data/snp/process.json';

const LINK: ScreenLink = {
  title: 'Планирование поставок › Объёмный план',
  url: 'https://example.com/plan',
};
const OTHER_LINK: ScreenLink = { title: 'Другой экран', url: 'https://example.com/other' };

/**
 * Узлы первого этапа БЕЗ ссылки в самих данных (process-map-071).
 *
 * Раньше брались просто nodes[0] и nodes[1]. Пока screen не заполнен ни у
 * одного узла, разницы не было; первая же ссылка владельца в такой узел
 * покрасила бы проверки вида «после сброса ссылки нет» — она вернулась бы из
 * базы, и упал бы тест, а не код.
 */
function nodesWithoutScreen(map: ProcessMap): string[] {
  const ids = (map.stages[0]?.nodes ?? [])
    .filter((node) => node.screen === undefined)
    .map((node) => node.id);
  expect(ids.length, 'на этапе 1 не осталось узлов без ссылки').toBeGreaterThan(1);
  return ids;
}

function firstNodeId(map: ProcessMap): string {
  return nodesWithoutScreen(map)[0] ?? '';
}

function secondNodeId(map: ProcessMap): string {
  return nodesWithoutScreen(map)[1] ?? '';
}

function findNode(map: ProcessMap, nodeId: string) {
  for (const stage of map.stages) {
    const found = stage.nodes.find((node) => node.id === nodeId);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * Клон базовой карты, в котором у узла `nodeId` ЕСТЬ ссылка прямо в JSON.
 *
 * Нужен для проверки «пользователь удалил ссылку»: узел для тестов берётся
 * заведомо без ссылки (см. nodesWithoutScreen), поэтому на нём разница между
 * «удалил» и «не было» ненаблюдаема и тест был бы пустым. Синтетическая база
 * делает её наблюдаемой независимо от того, что лежит в реальных данных.
 */
function baseWithScreen(nodeId: string, screen: ScreenLink): ProcessMap {
  const map = loadBaseProcessMap();
  return {
    ...map,
    stages: map.stages.map((stage) => ({
      ...stage,
      nodes: stage.nodes.map((node) => (node.id === nodeId ? { ...node, screen } : node)),
    })),
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('экспорт: формат файла', () => {
  it('совпадает байт в байт с src/data/snp/process.json, когда правок нет', () => {
    // Единственная надёжная проверка «того же формата, что у
    // scripts/import-pptx.py и scripts/layout.ts»: сравнить с самим файлом.
    // Покрывает разом отступ 2, отсутствие \u-экранирования кириллицы,
    // порядок ключей и завершающий перевод строки.
    const onDisk = readFileSync(PROCESS_JSON_PATH, 'utf8');

    expect(serializeProcessMap(getMergedProcessMap())).toBe(onDisk);
  });

  it('заканчивается ровно одним LF и не содержит CRLF', () => {
    const text = serializeProcessMap(loadBaseProcessMap());

    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text).not.toContain('\r');
  });

  it('не экранирует кириллицу (аналог ensure_ascii=False)', () => {
    const text = serializeProcessMap(loadBaseProcessMap());

    expect(text).toContain(loadBaseProcessMap().title);
    expect(text).not.toContain('\\u04');
  });

  it('отдаёт ПОЛНУЮ слитую карту, а не overrides (SPEC §3)', () => {
    const base = loadBaseProcessMap();
    const nodeId = firstNodeId(base);
    setNodeOverride(nodeId, LINK);

    const exported = JSON.parse(serializeProcessMap(getMergedProcessMap())) as ProcessMap;

    // Это именно карта: версия, все этапы и все узлы на месте.
    expect(exported.version).toBe(base.version);
    expect(exported.stages).toHaveLength(base.stages.length);
    // И правка в неё влита.
    expect(findNode(exported, nodeId)?.screen).toEqual(LINK);
  });

  it('добавленный overrides ключ screen не ломает порядок ключей узла', () => {
    const base = loadBaseProcessMap();
    const nodeId = firstNodeId(base);
    setNodeOverride(nodeId, LINK);

    const text = serializeProcessMap(getMergedProcessMap());
    const node = (JSON.parse(text) as ProcessMap).stages[0]?.nodes[0];

    // Порядок ключей схемы (src/data/schema.ts): … screen, position, slidePosition.
    // slidePosition — служебная геометрия слайда, её пишет scripts/import-pptx.py;
    // в экспорте она обязана сохраниться и остаться на своём месте, иначе файл
    // перестанет совпадать с src/data/snp/process.json побайтово.
    expect(Object.keys(node ?? {}).slice(-3)).toEqual(['screen', 'position', 'slidePosition']);
  });

  it('имя файла называет карту: process.<id>.json (SPEC §4.4)', () => {
    // С одинаковым именем у двух карт файл из вкладки MRP, положенный по пути
    // SNP, затёр бы SNP целиком (process-map-3wh.13).
    expect(exportFileName(loadBaseProcessMap())).toBe('process.snp.json');
    expect(exportFileName({ ...loadBaseProcessMap(), id: 'mrp' })).toBe('process.mrp.json');
  });
});

describe('импорт: round-trip экспорт → импорт', () => {
  it('после импорта своего же экспорта карта идентична', () => {
    const base = loadBaseProcessMap();
    const nodeId = firstNodeId(base);
    const otherId = secondNodeId(base);
    setNodeOverride(nodeId, LINK);
    setNodeOverride(otherId, OTHER_LINK);

    const exported = serializeProcessMap(getMergedProcessMap());

    // Пользователь пришёл в чистый браузер: правок нет, есть только файл.
    localStorage.clear();
    expect(getMergedProcessMap()).toEqual(base);

    const imported = parseImportedOverrides(exported, loadBaseProcessMap());
    expect(imported).not.toBeNull();
    replaceOverrides(imported ?? {});

    // 1. Карта после импорта — та же самая.
    expect(serializeProcessMap(getMergedProcessMap())).toBe(exported);
    // 2. И правки восстановлены поимённо, а не «похоже».
    expect(findNode(getMergedProcessMap(), nodeId)?.screen).toEqual(LINK);
    expect(findNode(getMergedProcessMap(), otherId)?.screen).toEqual(OTHER_LINK);
    expect(readStoredOverrides()).toEqual({
      [nodeId]: { screen: LINK },
      [otherId]: { screen: OTHER_LINK },
    });
  });

  it('round-trip устойчив к повторению: второй проход ничего не меняет', () => {
    const nodeId = firstNodeId(loadBaseProcessMap());
    setNodeOverride(nodeId, LINK);

    const first = serializeProcessMap(getMergedProcessMap());
    replaceOverrides(parseImportedOverrides(first, loadBaseProcessMap()) ?? {});
    const second = serializeProcessMap(getMergedProcessMap());
    replaceOverrides(parseImportedOverrides(second, loadBaseProcessMap()) ?? {});
    const third = serializeProcessMap(getMergedProcessMap());

    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('файл без правок очищает ранее сохранённые overrides', () => {
    const base = loadBaseProcessMap();
    const nodeId = firstNodeId(base);
    const pristine = serializeProcessMap(base);
    setNodeOverride(nodeId, LINK);

    const imported = parseImportedOverrides(pristine, base);
    expect(imported).toEqual({});
    replaceOverrides(imported ?? {});

    expect(findNode(getMergedProcessMap(), nodeId)?.screen).toBeUndefined();
  });
});

describe('импорт: удалённая ссылка (screen: null)', () => {
  // Самая хрупкая часть контракта: «пользователь удалил ссылку» не должно
  // превратиться в «ссылки не было» — второе означает откат к значению из
  // process.json (см. src/data/loader.ts::applyNodeOverride).
  it('ссылка, удалённая из файла, даёт именно { screen: null }, а не пустой override', () => {
    const nodeId = firstNodeId(loadBaseProcessMap());
    const base = baseWithScreen(nodeId, LINK);
    // Файл, из которого пользователь ссылку убрал.
    const withoutLink = serializeProcessMap(mergeOverrides(base, { [nodeId]: { screen: null } }));

    const imported = parseImportedOverrides(withoutLink, base);

    expect(imported).toEqual({ [nodeId]: { screen: null } });
    // Ключ должен присутствовать со значением null, а не отсутствовать:
    // отсутствие означало бы «правки нет» и вернуло бы ссылку из JSON.
    expect(imported).toHaveProperty(nodeId);
    expect(imported?.[nodeId]?.screen).toBeNull();
  });

  it('screen: null переживает полный round-trip: ссылка не воскресает', () => {
    const nodeId = firstNodeId(loadBaseProcessMap());
    const base = baseWithScreen(nodeId, LINK);

    // Экспорт карты, из которой ссылку удалили.
    const exported = serializeProcessMap(mergeOverrides(base, { [nodeId]: { screen: null } }));
    expect(exported).not.toContain(LINK.url);

    // Импорт → merge → снова экспорт.
    const imported = parseImportedOverrides(exported, base);
    const roundTripped = serializeProcessMap(mergeOverrides(base, imported ?? {}));

    expect(roundTripped).toBe(exported);
    expect(findNode(mergeOverrides(base, imported ?? {}), nodeId)?.screen).toBeUndefined();
  });

  it('изменённая (а не удалённая) ссылка приходит объектом, не null', () => {
    const nodeId = firstNodeId(loadBaseProcessMap());
    const base = baseWithScreen(nodeId, LINK);
    const edited = serializeProcessMap(mergeOverrides(base, { [nodeId]: { screen: OTHER_LINK } }));

    expect(parseImportedOverrides(edited, base)).toEqual({ [nodeId]: { screen: OTHER_LINK } });
  });

  it('нетронутая ссылка из JSON не порождает override', () => {
    const nodeId = firstNodeId(loadBaseProcessMap());
    const base = baseWithScreen(nodeId, LINK);

    expect(parseImportedOverrides(serializeProcessMap(base), base)).toEqual({});
  });
});

describe('импорт: непригодные файлы', () => {
  it('битый JSON отвергается и хранилище не трогает', () => {
    const base = loadBaseProcessMap();
    const nodeId = firstNodeId(base);
    setNodeOverride(nodeId, LINK);
    const before = readStoredOverrides();

    expect(parseImportedOverrides('{ это не json', base)).toBeNull();
    expect(parseImportedOverrides('', base)).toBeNull();
    expect(parseImportedOverrides('<html></html>', base)).toBeNull();

    expect(readStoredOverrides()).toEqual(before);
  });

  it('чужая валидная JSON-форма отвергается', () => {
    const base = loadBaseProcessMap();

    expect(parseImportedOverrides('{"foo":"bar"}', base)).toBeNull();
    expect(parseImportedOverrides('[]', base)).toBeNull();
    expect(parseImportedOverrides('null', base)).toBeNull();
    expect(parseImportedOverrides('42', base)).toBeNull();
    // Карта без обязательного поля stages — тоже не карта.
    expect(
      parseImportedOverrides('{"version":"1.0.0","updatedAt":"2026-08-24","title":"x"}', base),
    ).toBeNull();
  });

  it('форма, похожая на карту, но не проходящая схему, отвергается zod, а не случайно', () => {
    // Этот случай нашла мутационная проверка: если убрать
    // ProcessMapSchema.safeParse, все остальные «плохие» файлы всё равно
    // отвергаются — на них deriveOverrides падает и падение ловится. А вот
    // такой файл пройдёт насквозь и вернёт пустые overrides, то есть МОЛЧА
    // сотрёт все правки пользователя. Отвергать его обязана именно схема.
    const base = loadBaseProcessMap();

    expect(parseImportedOverrides('{"stages":[{"nodes":[]}]}', base)).toBeNull();
    expect(parseImportedOverrides('{"stages":[]}', base)).toBeNull();
    // …и карта, у которой отсутствует только overviewEdges.
    const almost = JSON.parse(serializeProcessMap(base)) as Partial<ProcessMap>;
    delete almost.overviewEdges;
    expect(parseImportedOverrides(JSON.stringify(almost), base)).toBeNull();
  });

  it('файл overrides импортом НЕ принимается: импорт ждёт полную карту', () => {
    // Осознанное решение задачи process-map-6q0: форматы экспорта и импорта в
    // SPEC §3 расходятся, и примирены они в пользу полной карты — иначе файл,
    // который приложение отдаёт, оно же и не принимает. См. шапку
    // src/utils/processTransfer.ts.
    const base = loadBaseProcessMap();
    const nodeId = firstNodeId(base);

    expect(parseImportedOverrides(JSON.stringify({ [nodeId]: { screen: LINK } }), base)).toBeNull();
  });

  it('узел, которого нет в базовой карте, считается ДОБАВЛЕННЫМ правкой', () => {
    // Контракт изменён решением владельца от 07.09.2026: правки содержания
    // умеют создавать узлы, и незнакомый id в файле СВОЕЙ карты означает
    // «его добавили», а не «мусор». До этого такие узлы игнорировались.
    const base = loadBaseProcessMap();
    const alien = JSON.parse(serializeProcessMap(base)) as ProcessMap;
    const stage = alien.stages[0];
    expect(stage).toBeDefined();
    stage?.nodes.push({
      id: 'node-kotorogo-net-v-baze',
      type: 'step',
      label: 'Чужой узел',
      screen: LINK,
      position: { x: 0, y: 0 },
    });

    const overrides = parseImportedOverrides(JSON.stringify(alien), base);
    expect(overrides?.['node-kotorogo-net-v-baze']?.added?.stage).toBe(stage?.number);
    expect(overrides?.['node-kotorogo-net-v-baze']?.label).toBe('Чужой узел');
  });

  it('файл ДРУГОЙ карты отвергается целиком', () => {
    // Сторож против дыры, которую открыло предыдущее правило: раз незнакомый
    // узел теперь добавляется, файл чужой карты влил бы в текущую все свои узлы
    // разом. Карты различаются по ProcessMap.id — ради этого он и заведён.
    const base = loadBaseProcessMap();
    const foreign = { ...(JSON.parse(serializeProcessMap(base)) as ProcessMap), id: 'chuzhaya' };

    expect(parseImportedOverrides(JSON.stringify(foreign), base)).toBeNull();
  });
});

describe('deriveOverrides', () => {
  it('узел, вырезанный из файла, считается УДАЛЁННЫМ, а не потерявшим ссылку', () => {
    // Контракт изменён решением владельца от 07.09.2026 вместе с правками
    // содержания. Раньше вырезанный узел не порождал ничего: удалять узлы было
    // нечем, и «его нет в файле» могло означать только неполный файл. Теперь
    // экспорт всегда отдаёт карту ЦЕЛИКОМ, поэтому отсутствие узла — это
    // осознанное удаление.
    //
    // Важно, что это НЕ `screen: null`: разница между «удалили ссылку» и
    // «удалили узел» — та самая, которую сторожил прежний тест, и она осталась.
    const nodeId = firstNodeId(loadBaseProcessMap());
    const base = baseWithScreen(nodeId, LINK);
    const trimmed: ProcessMap = {
      ...base,
      stages: base.stages.map((stage) => ({
        ...stage,
        nodes: stage.nodes.filter((node) => node.id !== nodeId),
      })),
    };

    const derived = deriveOverrides(base, trimmed);
    expect(derived[nodeId]).toEqual({ removed: true });
    expect(derived[nodeId]).not.toHaveProperty('screen');
  });
});

describe('сброс правок', () => {
  it('resetOverrides убирает все правки и возвращает базовую карту', () => {
    const base = loadBaseProcessMap();
    const nodeId = firstNodeId(base);
    setNodeOverride(nodeId, LINK);
    expect(findNode(getMergedProcessMap(), nodeId)?.screen).toEqual(LINK);

    resetOverrides();

    expect(readStoredOverrides()).toEqual({});
    expect(getMergedProcessMap()).toEqual(base);
    expect(serializeProcessMap(getMergedProcessMap())).toBe(
      readFileSync(PROCESS_JSON_PATH, 'utf8'),
    );
  });

  it('сброс после импорта тоже работает: правки импорта не «прилипают»', () => {
    const base = loadBaseProcessMap();
    const nodeId = firstNodeId(base);
    const exported = serializeProcessMap(mergeOverrides(base, { [nodeId]: { screen: LINK } }));
    replaceOverrides(parseImportedOverrides(exported, base) ?? {});
    expect(readStoredOverrides()).not.toEqual({});

    resetOverrides();

    expect(readStoredOverrides()).toEqual({});
  });
});
