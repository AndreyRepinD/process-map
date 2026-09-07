// Тесты merge overrides и устойчивости хранилища (SPEC.md §3 «Overrides»).
// Работают на фикстуре buildSampleProcessMap(), а не на реальном process.json.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OVERRIDES_KEY,
  mergeOverrides,
  parseOverrides,
  readStoredOverrides,
  addNode,
  patchNodeContent,
  removeNode,
  removeNodeOverride,
  resetOverrides,
  safeParseOverrides,
  setNodeOverride,
  writeStoredOverrides,
} from '../src/data/loader';
import {
  LEGACY_OVERRIDES_STORAGE_KEY,
  type Overrides,
  type ProcessMap,
  type ScreenLink,
} from '../src/data/schema';
import { buildSampleProcessMap } from './fixtures/sample-process';

const JSON_SCREEN: ScreenLink = { title: 'Из JSON', url: 'https://example.com/json' };
const OVERRIDE_SCREEN: ScreenLink = { title: 'Из override', url: 'https://example.com/override' };

/** id узлов фикстуры стабильны по конструкции фабрики, не по данным презентации. */
function firstNodeId(map: ProcessMap): string {
  const id = map.stages[0]?.nodes[0]?.id;
  if (id === undefined) {
    throw new Error('фикстура должна содержать хотя бы один узел');
  }
  return id;
}

function secondNodeId(map: ProcessMap): string {
  const id = map.stages[0]?.nodes[1]?.id;
  if (id === undefined) {
    throw new Error('фикстура должна содержать хотя бы два узла');
  }
  return id;
}

/** Копия фикстуры, где у первого узла первого этапа задан screen из JSON. */
function mapWithJsonScreen(): ProcessMap {
  const base = buildSampleProcessMap();
  return {
    ...base,
    stages: base.stages.map((stage, stageIndex) =>
      stageIndex === 0
        ? {
            ...stage,
            nodes: stage.nodes.map((node, nodeIndex) =>
              nodeIndex === 0 ? { ...node, screen: { ...JSON_SCREEN } } : node,
            ),
          }
        : stage,
    ),
  };
}

function nodeById(map: ProcessMap, id: string) {
  const node = map.stages.flatMap((stage) => stage.nodes).find((candidate) => candidate.id === id);
  if (node === undefined) {
    throw new Error(`узел ${id} не найден`);
  }
  return node;
}

describe('mergeOverrides — три состояния override', () => {
  it('нет записи по узлу → screen берётся из JSON', () => {
    const map = mapWithJsonScreen();
    const id = firstNodeId(map);

    const merged = mergeOverrides(map, {});

    expect(nodeById(merged, id).screen).toEqual(JSON_SCREEN);
  });

  it('запись без поля screen ({}) равнозначна отсутствию записи', () => {
    const map = mapWithJsonScreen();
    const id = firstNodeId(map);

    const merged = mergeOverrides(map, { [id]: {} });

    expect(nodeById(merged, id).screen).toEqual(JSON_SCREEN);
  });

  it('{ screen: {...} } заменяет screen узла и имеет приоритет над JSON', () => {
    const map = mapWithJsonScreen();
    const id = firstNodeId(map);

    const merged = mergeOverrides(map, { [id]: { screen: OVERRIDE_SCREEN } });

    expect(nodeById(merged, id).screen).toEqual(OVERRIDE_SCREEN);
  });

  it('{ screen: null } — явно удалённая ссылка: поля screen нет и оно не откатывается к JSON', () => {
    const map = mapWithJsonScreen();
    const id = firstNodeId(map);

    const merged = mergeOverrides(map, { [id]: { screen: null } });
    const node = nodeById(merged, id);

    expect(node.screen).toBeUndefined();
    expect('screen' in node).toBe(false);
  });

  it('{ screen: {...} } добавляет ссылку узлу, у которого её не было в JSON', () => {
    const map = buildSampleProcessMap();
    const id = secondNodeId(map);
    expect(nodeById(map, id).screen).toBeUndefined();

    const merged = mergeOverrides(map, { [id]: { screen: OVERRIDE_SCREEN } });

    expect(nodeById(merged, id).screen).toEqual(OVERRIDE_SCREEN);
  });

  it('не мутирует исходную карту', () => {
    const map = mapWithJsonScreen();
    const id = firstNodeId(map);

    mergeOverrides(map, { [id]: { screen: null } });

    expect(nodeById(map, id).screen).toEqual(JSON_SCREEN);
  });

  it('игнорирует записи для несуществующих узлов', () => {
    const map = mapWithJsonScreen();

    const merged = mergeOverrides(map, { 'no-such-node': { screen: OVERRIDE_SCREEN } });

    expect(merged.stages.flatMap((stage) => stage.nodes)).toHaveLength(
      map.stages.flatMap((stage) => stage.nodes).length,
    );
    expect(nodeById(merged, firstNodeId(map)).screen).toEqual(JSON_SCREEN);
  });

  it('применяет разные состояния к разным узлам за один вызов', () => {
    const map = mapWithJsonScreen();
    const first = firstNodeId(map);
    const second = secondNodeId(map);

    const merged = mergeOverrides(map, {
      [first]: { screen: null },
      [second]: { screen: OVERRIDE_SCREEN },
    });

    expect(nodeById(merged, first).screen).toBeUndefined();
    expect(nodeById(merged, second).screen).toEqual(OVERRIDE_SCREEN);
  });
});

describe('safeParseOverrides / parseOverrides', () => {
  it('принимает валидные записи, включая null', () => {
    const raw = { a: { screen: null }, b: { screen: OVERRIDE_SCREEN }, c: {} };
    expect(safeParseOverrides(raw)).toEqual(raw);
    expect(parseOverrides(raw)).toEqual(raw);
  });

  it.each([
    ['строка', 'мусор'],
    ['число', 42],
    ['null', null],
    ['битая запись', { a: { screen: 42 } }],
    ['screen без url', { a: { screen: { title: 'x' } } }],
  ])('невалидное значение (%s) превращается в {}', (_name, raw) => {
    expect(safeParseOverrides(raw)).toEqual({});
  });

  it('parseOverrides бросает на невалидных данных', () => {
    expect(() => parseOverrides({ a: { screen: 42 } })).toThrow();
  });
});

describe('устойчивость localStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('пустое хранилище → {}', () => {
    expect(readStoredOverrides()).toEqual({});
  });

  it('битый JSON под ключом → {} и merge продолжает работать', () => {
    localStorage.setItem(OVERRIDES_KEY, '{не json');
    const map = mapWithJsonScreen();

    expect(readStoredOverrides()).toEqual({});
    expect(nodeById(mergeOverrides(map, readStoredOverrides()), firstNodeId(map)).screen).toEqual(
      JSON_SCREEN,
    );
  });

  it('чужая структура под ключом → {}', () => {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify({ foo: 'bar' }));
    expect(readStoredOverrides()).toEqual({});
  });

  it('отсутствие localStorage не роняет чтение и запись', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => undefined });
    try {
      expect(readStoredOverrides()).toEqual({});
      expect(writeStoredOverrides({ a: { screen: null } })).toBe(false);
      expect(() => resetOverrides()).not.toThrow();
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'localStorage', original);
      }
    }
  });

  it('переполнение квоты при записи → false, без исключения', () => {
    let calls = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      calls += 1;
      // Первый вызов — проба доступности хранилища, она должна проходить.
      if (calls > 1 || key === OVERRIDES_KEY) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
    });

    expect(writeStoredOverrides({ a: { screen: OVERRIDE_SCREEN } })).toBe(false);
  });

  it('setNodeOverride пишет запись, а null сохраняется как явное удаление', () => {
    const stored: Overrides = setNodeOverride('node-a', OVERRIDE_SCREEN);
    expect(stored).toEqual({ 'node-a': { screen: OVERRIDE_SCREEN } });
    expect(readStoredOverrides()).toEqual({ 'node-a': { screen: OVERRIDE_SCREEN } });

    setNodeOverride('node-a', null);
    expect(readStoredOverrides()).toEqual({ 'node-a': { screen: null } });
  });

  it('removeNodeOverride убирает только свою запись', () => {
    setNodeOverride('node-a', OVERRIDE_SCREEN);
    setNodeOverride('node-b', null);

    expect(removeNodeOverride('node-a')).toEqual({ 'node-b': { screen: null } });
    expect(readStoredOverrides()).toEqual({ 'node-b': { screen: null } });
  });

  // --- миграция со старого общего ключа (process-map-3wh.5) -----------------

  it('ключ карты отличается от легаси-ключа', () => {
    // Якорь формулы. Её повторяет e2e/helpers.ts (e2e намеренно не импортируют
    // src/), и без этого теста два места разъехались бы молча.
    expect(OVERRIDES_KEY).toBe('inplan-process-map:snp:overrides:v1');
    expect(LEGACY_OVERRIDES_STORAGE_KEY).toBe('inplan-process-map:overrides:v1');
  });

  it('правки со старого ключа читаются и копируются на ключ карты', () => {
    const legacy: Overrides = { 'node-a': { screen: OVERRIDE_SCREEN } };
    localStorage.setItem(LEGACY_OVERRIDES_STORAGE_KEY, JSON.stringify(legacy));

    expect(readStoredOverrides()).toEqual(legacy);
    expect(localStorage.getItem(OVERRIDES_KEY)).toBe(JSON.stringify(legacy));
    // Легаси-ключ остаётся: удаление необратимо, а сброс — решение пользователя.
    expect(localStorage.getItem(LEGACY_OVERRIDES_STORAGE_KEY)).not.toBeNull();
  });

  it('мигрирует СЫРУЮ строку, а не разобранное значение', () => {
    // Если бы миграция переносила результат safeParseOverrides, битое значение
    // превратилось бы в {} и записалось поверх — молчаливая потеря черновика.
    localStorage.setItem(LEGACY_OVERRIDES_STORAGE_KEY, '{не json');

    expect(readStoredOverrides()).toEqual({});
    expect(localStorage.getItem(OVERRIDES_KEY)).toBe('{не json');
  });

  it('легаси-значение чужой структуры копируется как есть, а не как пустой объект', () => {
    // Валидный JSON, но не Overrides. Шапка loader.ts обещает НЕ удалять
    // повреждённое значение молча — миграция обязана соблюдать то же обещание.
    // Мутация «писать разобранное значение» на битом JSON падает сразу (там
    // JSON.parse бросает), а здесь прошла бы незамеченной: под новым ключом
    // оказался бы {}, и черновик исчез бы безвозвратно.
    localStorage.setItem(LEGACY_OVERRIDES_STORAGE_KEY, '{"foo":"bar"}');

    expect(readStoredOverrides()).toEqual({});
    expect(localStorage.getItem(OVERRIDES_KEY)).toBe('{"foo":"bar"}');
  });

  it('ключ карты имеет приоритет: миграция не затирает уже перенесённое', () => {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify({ 'node-b': { screen: null } }));
    localStorage.setItem(
      LEGACY_OVERRIDES_STORAGE_KEY,
      JSON.stringify({ 'node-a': { screen: null } }),
    );

    expect(readStoredOverrides()).toEqual({ 'node-b': { screen: null } });
  });

  it('провал записи по квоте не мешает прочитать легаси-правки', () => {
    localStorage.setItem(
      LEGACY_OVERRIDES_STORAGE_KEY,
      JSON.stringify({ 'node-a': { screen: null } }),
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    // Перенос не «прилипнет», но пользователь свои правки видит; миграция
    // идемпотентно повторится при следующей загрузке.
    expect(readStoredOverrides()).toEqual({ 'node-a': { screen: null } });
  });

  it('resetOverrides удаляет ключ целиком', () => {
    setNodeOverride('node-a', OVERRIDE_SCREEN);
    resetOverrides();

    expect(localStorage.getItem(OVERRIDES_KEY)).toBeNull();
    expect(readStoredOverrides()).toEqual({});
  });
});

// ─────────────── правки содержания (решение владельца 07.09.2026) ───────────────

describe('mergeOverrides — правки содержания узла', () => {
  const firstNodeId = (map: ProcessMap): string => {
    const id = map.stages[0]?.nodes[0]?.id;
    expect(id, 'в фикстуре нет ни одного узла').toBeTruthy();
    return id as string;
  };

  it('подпись заменяется, остальные поля не трогаются', () => {
    const map = buildSampleProcessMap();
    const id = firstNodeId(map);
    const before = map.stages[0]?.nodes[0];
    const merged = mergeOverrides(map, { [id]: { label: 'Новая подпись' } });
    const after = merged.stages[0]?.nodes[0];
    expect(after?.label).toBe('Новая подпись');
    expect(after?.type).toBe(before?.type);
    expect(after?.position).toEqual(before?.position);
  });

  it('null очищает поле, а отсутствие ключа оставляет как было', () => {
    const map = buildSampleProcessMap();
    const id = firstNodeId(map);
    const withText = mergeOverrides(map, { [id]: { description: 'Текст' } });
    expect(withText.stages[0]?.nodes[0]?.description).toBe('Текст');

    // null — «очистили явно»: ключа в узле остаться не должно вовсе.
    const cleared = mergeOverrides(withText, { [id]: { description: null } });
    expect(cleared.stages[0]?.nodes[0]).not.toHaveProperty('description');

    // Пустая запись ничего не меняет.
    expect(mergeOverrides(withText, { [id]: {} }).stages[0]?.nodes[0]?.description).toBe('Текст');
  });

  it('входы и выходы заменяются списком целиком', () => {
    const map = buildSampleProcessMap();
    const id = firstNodeId(map);
    const merged = mergeOverrides(map, { [id]: { inputs: ['A', 'B'], outputs: ['C'] } });
    expect(merged.stages[0]?.nodes[0]?.inputs).toEqual(['A', 'B']);
    expect(merged.stages[0]?.nodes[0]?.outputs).toEqual(['C']);
  });
});

describe('mergeOverrides — удаление узла', () => {
  it('узел исчезает, а рёбра, которые на нём висели, выбрасываются', () => {
    const map = buildSampleProcessMap();
    const stage = map.stages[0];
    expect(stage).toBeTruthy();
    const doomed = stage?.edges[0]?.source;
    expect(doomed, 'в фикстуре нет рёбер — тест не о чем').toBeTruthy();

    const merged = mergeOverrides(map, { [doomed as string]: { removed: true } });
    const ids = merged.stages.flatMap((s) => s.nodes.map((n) => n.id));
    expect(ids).not.toContain(doomed);
    // Ребро в никуда — это стрелка из угла полотна и непроходимый
    // validateIntegrity при экспорте, поэтому оно обязано исчезнуть вместе с узлом.
    for (const s of merged.stages) {
      for (const edge of s.edges) {
        expect(edge.source).not.toBe(doomed);
        expect(edge.target).not.toBe(doomed);
      }
    }
  });
});

describe('mergeOverrides — добавленный узел', () => {
  it('появляется в своём этапе с подписью и направлением', () => {
    const map = buildSampleProcessMap();
    const merged = mergeOverrides(map, {
      'added-x': { added: { stage: 1, type: 'data', direction: 'out' }, label: 'Новый выход' },
    });
    const node = merged.stages[0]?.nodes.find((n) => n.id === 'added-x');
    expect(node?.label).toBe('Новый выход');
    expect(node?.direction).toBe('out');
    expect(node?.type).toBe('data');
    // Координаты синтезируются: их неоткуда взять, layout.ts считает на сборке.
    expect(node?.position).toBeTruthy();
    expect(node?.slidePosition).toBeTruthy();
  });

  it('в чужой этап не попадает и правки содержания к нему применяются', () => {
    const map = buildSampleProcessMap();
    const merged = mergeOverrides(map, {
      'added-y': {
        added: { stage: 2, type: 'step' },
        label: 'Шаг',
        description: 'Пояснение',
        outputs: ['Результат'],
      },
    });
    expect(merged.stages[0]?.nodes.some((n) => n.id === 'added-y')).toBe(false);
    const node = merged.stages.find((s) => s.number === 2)?.nodes.find((n) => n.id === 'added-y');
    expect(node?.description).toBe('Пояснение');
    expect(node?.outputs).toEqual(['Результат']);
  });
});

describe('запись правок в хранилище', () => {
  it('правка ссылки НЕ стирает правку содержания того же узла', () => {
    // Регрессия по построению: до правок содержания setNodeOverride заменял
    // запись целиком (`{ [id]: { screen } }`), и первая же правка ссылки унесла
    // бы подпись и описание молча.
    patchNodeContent('n1', { label: 'Подпись', description: 'Текст' });
    setNodeOverride('n1', { title: 'Экран', url: 'https://example.test' });
    const stored = readStoredOverrides();
    expect(stored['n1']?.label).toBe('Подпись');
    expect(stored['n1']?.description).toBe('Текст');
    expect(stored['n1']?.screen?.url).toBe('https://example.test');
  });

  it('добавленный узел удаляется записью целиком, а узел карты — признаком', () => {
    const id = addNode({ stage: 1, type: 'step' }, 'Черновик');
    expect(readStoredOverrides()[id]?.added).toBeTruthy();
    removeNode(id);
    expect(readStoredOverrides()[id]).toBeUndefined();

    removeNode('n2');
    expect(readStoredOverrides()['n2']?.removed).toBe(true);
  });
});
