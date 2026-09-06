// Содержание карты DP: что именно задано authoring source владельца.
//
// ЗАЧЕМ ДОСЛОВНЫЕ СТРОКИ. tests/fixtures/dp/required-nodes.json генерирует сам
// импортёр, поэтому тихую регрессию разбора он не поймает: изменится разбор —
// изменится и фикстура. Здесь подписи выписаны РУКАМИ из согласованного
// scripts/author/dp.json, и это единственное место, где сверка
// «карта ↔ решение владельца» зафиксирована так, что её нельзя обойти
// перегенерацией. Тот же жанр, что tests/mrp/content.test.ts.
//
// СОДЕРЖАНИЕ ЗАМОРОЖЕНО (CONTENT_FROZEN, решение владельца от 06.09.2026):
// label, порядок этапов и шагов, входы/выходы, keyOutputs, рёбра и description
// меняются только новым решением владельца. Красный тест здесь — это не «поправь
// ожидание», а «кто-то поменял замороженное содержание».
import { describe, expect, it } from 'vitest';
import { ProcessMapSchema, type ProcessNode } from '../../src/data/schema.ts';
import processJson from '../../src/data/dp/process.json';

const map = ProcessMapSchema.parse(processJson);
const nodes = map.stages.flatMap((stage) => stage.nodes);
const steps = nodes.filter((node) => node.type !== 'data');
const data = nodes.filter((node) => node.type === 'data');

/** Заголовки пяти этапов, дословно. */
const STAGE_TITLES = [
  'Подготовка истории',
  'Расчёт прогноза',
  'Sell-In по модели канала',
  'Обогащение и согласование',
  'Публикация и контроль точности',
];

/** Десять шагов, по этапам. */
const STEPS_BY_STAGE: string[][] = [
  ['Подготовка сопоставимой истории'],
  [
    'Сегментация/кластеризация и настройка методов',
    'Ассортимент: методы и чемпион',
    'Новинки: похожие товары',
    'Промо light: прогноз промо-объёмов (опционально)',
  ],
  ['Прямые каналы: прямой прогноз Sell-In', 'Sell-Out → баланс → Sell-In'],
  ['Building Blocks и корректировки', 'Demand Review Meeting'],
  ['Публикация и анализ точности'],
];

/** Плашки-входы: все нарисованы общей левой колонкой слайда. */
const INPUTS = [
  'История продаж и заказы из ERP / DWH',
  'Промо-план из TPM/NRM',
  'Категорийный менеджмент: проверка Building Blocks',
  'Коммерческие финансы: консенсус-прогноз в деньгах',
  'Получение ограниченного прогноза из модуля SNP',
];

/** Единственный выход процесса. */
const OUTPUT = 'Передача неограниченного плана спроса в SNP и MEIO';

function labels(list: ProcessNode[]): string[] {
  return list.map((node) => node.label).sort();
}

describe('карта DP: пять этапов', () => {
  it('ровно пять этапов с номерами 1..5', () => {
    // ПЕРВАЯ карта репозитория не с четырьмя этапами. Четвёрка была не только
    // в тестах: её держала константа STAGE_COUNT в scripts/import-pptx.py с
    // комментарием «ограничение zod-схемы», устаревшим ещё в process-map-70e.4.
    // Число этапов переехало в реестр карт (MapSpec.stages_expected).
    expect(map.stages).toHaveLength(5);
    expect(map.stages.map((stage) => stage.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it('заголовки этапов дословно', () => {
    expect(map.stages.map((stage) => stage.title)).toEqual(STAGE_TITLES);
  });
});

describe('карта DP: содержание', () => {
  it('десять шагов, по этапам, дословно', () => {
    expect(steps).toHaveLength(10);
    for (const [index, stage] of map.stages.entries()) {
      expect(
        labels(stage.nodes.filter((node) => node.type !== 'data')),
        `этап ${stage.number}`,
      ).toEqual([...(STEPS_BY_STAGE[index] ?? [])].sort());
    }
  });

  it('пять входов и один выход, каждый при своём этапе', () => {
    expect(data).toHaveLength(6);
    expect(labels(data.filter((node) => node.direction === 'in'))).toEqual([...INPUTS].sort());
    expect(labels(data.filter((node) => node.direction === 'out'))).toEqual([OUTPUT]);

    const stageOf = (label: string): number | undefined =>
      map.stages.find((stage) => stage.nodes.some((node) => node.label === label))?.number;
    // Этап плашки определяется НЕ её координатой, а шагом, с которым она
    // связана: все входы лежат в общей левой полосе слайда (иначе импортёр
    // признал бы их выходами), и по абсциссе неотличимы друг от друга.
    expect(stageOf('История продаж и заказы из ERP / DWH')).toBe(1);
    expect(stageOf('Промо-план из TPM/NRM')).toBe(2);
    expect(stageOf('Категорийный менеджмент: проверка Building Blocks')).toBe(4);
    expect(stageOf('Коммерческие финансы: консенсус-прогноз в деньгах')).toBe(4);
    expect(stageOf('Получение ограниченного прогноза из модуля SNP')).toBe(5);
    expect(stageOf(OUTPUT)).toBe(5);
  });

  it('рёбра внутри этапов: 1 + 5 + 0 + 3 + 2', () => {
    // У этапа 3 рёбер нет намеренно: «Прямые каналы» и «Sell-Out → баланс →
    // Sell-In» параллельны и между собой не связаны (решение владельца, §5).
    expect(map.stages.map((stage) => stage.edges.length)).toEqual([1, 5, 0, 3, 2]);
  });

  it('обзорные рёбра — линейный поток 1 → 2 → 3 → 4 → 5 без обратных', () => {
    // Обратного ребра «следующий цикл» 5 → 1 нет: на слайде это подпись, а не
    // поток. Появится только через OWNER_DECISION_EDGES.
    const ids = map.stages.map((stage) => stage.id);
    const pairs = map.overviewEdges
      .filter((edge) => edge.kind === 'process')
      .map((edge) => [ids.indexOf(edge.source) + 1, ids.indexOf(edge.target) + 1])
      .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
    expect(pairs).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ]);
  });

  it('внешние системы: ERP на этапе 1, SNP и MEIO на этапе 5', () => {
    // Плашка «Передача неограниченного плана спроса в SNP и MEIO» называет ДВА
    // модуля сразу — одна подпись, две записи ExternalIO. Коды выведены через
    // SYSTEM_ALIASES (SNP → INPLAN, MEIO → IO): владелец уже закрепил их в
    // словаре систем, и вторых кодов на те же модули не заводят.
    expect(map.stages[0]?.inputs.map((io) => io.system)).toEqual(['ERP']);
    expect(map.stages[4]?.inputs.map((io) => io.system)).toEqual(['INPLAN']);
    expect(map.stages[4]?.outputs.map((io) => io.system)).toEqual(['INPLAN', 'IO']);
    for (const io of map.stages[4]?.outputs ?? []) {
      expect(io.label).toBe(OUTPUT);
    }
  });

  it('TPM и роли внешними системами НЕ стали', () => {
    // Кода TPM в SystemCode нет, а «Категорийный менеджмент» и «Коммерческие
    // финансы» — роли, а не системы. Такие плашки остаются data-узлами без
    // ExternalIO: это отказ выдумывать, а не пропуск. У этапов 2, 3 и 4 внешних
    // систем нет вовсе, и это ожидаемое состояние, а не регрессия.
    expect(map.stages[1]?.inputs).toEqual([]);
    expect(map.stages[2]?.inputs).toEqual([]);
    expect(map.stages[3]?.inputs).toEqual([]);
    for (const stage of map.stages.slice(0, 4)) {
      expect(stage.outputs, `этап ${stage.number}`).toEqual([]);
    }
  });

  it('у карты есть и вход, и выход', () => {
    // Инвариант по КАРТЕ, а не по этапу (решение владельца от 06.09.2026):
    // у DP этап 3 внешних связей не имеет вовсе. Это сторож регрессии 24p
    // («0 выходов»), а не требование ко всем этапам сразу.
    expect(map.stages.flatMap((stage) => stage.inputs).length).toBeGreaterThan(0);
    expect(map.stages.flatMap((stage) => stage.outputs).length).toBeGreaterThan(0);
  });

  it('ключевые выходы объявлены у каждого этапа', () => {
    // В профиле single-slide keyOutputs выводятся только из плашек-выходов, и
    // у DP выходная плашка одна — на этапе 5. Остальные четыре этапа получили бы
    // пустые списки. Значения приходят таблицей STAGE_KEY_OUTPUTS.
    expect(map.stages.map((stage) => stage.keyOutputs)).toEqual([
      ['Сопоставимая история'],
      ['Базовый прогноз с чемпионом по серии', 'Промо-объёмы'],
      ['Прогноз Sell-In по каналам'],
      ['Согласованный план спроса Sell-In'],
      ['Опубликованный план спроса в SNP и MEIO', 'KPI точности прогноза'],
    ]);
  });

  it('у каждого шага есть описание, и коды BPMN стоят последним абзацем', () => {
    for (const step of steps) {
      expect(step.description, `шаг «${step.id}» без описания`).toBeTruthy();
    }
    const withCode = steps.filter((step) =>
      (step.description ?? '').split('\n\n').at(-1)?.startsWith('BPMN: '),
    );
    // Девять из десяти. Единственное исключение — «Прямые каналы: прямой
    // прогноз Sell-In»: соответствующей задачи в модели BPMN нет вовсе
    // (SLIDE_ONLY, docs/reconciliation/dp-meio-bpmn.md), и код не выдумывается.
    expect(withCode).toHaveLength(9);
    expect(
      steps.find((step) => step.label === 'Прямые каналы: прямой прогноз Sell-In')?.description,
    ).not.toContain('BPMN:');
  });

  it('маркеры слайда ушли в inputs узлов, а не в outputs', () => {
    expect(nodes.filter((node) => node.outputs !== undefined)).toEqual([]);
    expect(nodes.flatMap((node) => node.inputs ?? []).filter((line) => line.endsWith(':'))).toEqual(
      [],
    );
    expect(nodes.find((node) => node.id === 'podgotovka-sopostavimoy-istorii')?.inputs).toEqual([
      'OOS, выбросы, промо, ML-очистка',
      'Перенос истории при смене схемы',
      'Замена SKU через DFU',
      'Исключения планеру',
    ]);
  });

  it('warningsCount не проставлен, группы пусты', () => {
    for (const stage of map.stages) {
      expect(stage.warningsCount, `этап ${stage.number}`).toBeUndefined();
      expect(stage.groups, `этап ${stage.number}`).toEqual([]);
      expect(stage.nodes.every((node) => node.group === undefined)).toBe(true);
    }
  });
});
