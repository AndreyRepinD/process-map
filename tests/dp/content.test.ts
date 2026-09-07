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
  ['Проверка качества данных', 'Подготовка сопоставимой истории'],
  [
    'Сегментация/кластеризация и настройка методов',
    'Ассортимент: методы и чемпион',
    'Новинки: похожие товары',
    'Промо light: прогноз промо-объёмов (опционально)',
  ],
  ['Прямые каналы: прямой прогноз Sell-In', 'Sell-Out → баланс → Sell-In'],
  ['Building Blocks и корректировки', 'Demand Review Meeting'],
  [
    'Публикация плана спроса',
    'Сверка с ограниченным планом SNP и решение по разрыву',
    'Контроль точности и FVA',
    'Анализ предупреждений',
  ],
];

/** Плашки-входы: все нарисованы общей левой колонкой слайда. */
const INPUTS = [
  'История продаж и заказы из ERP / DWH',
  'План производства собственной переработки из SNP и PS',
  'Промо-план из TPM/NRM',
  'Sell-Out и остатки клиента из ERP',
  'Открытые заказы и целевой запас клиента',
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
  it('четырнадцать шагов, по этапам, дословно', () => {
    // Было десять. Этап 5 разделён на три шага решением владельца от 07.09.2026:
    // публикация, сверка с ограниченным планом SNP и контроль точности — разные
    // вопросы к разным владельцам, и держать их одним шагом значило смешивать
    // выполнимость с точностью.
    expect(steps).toHaveLength(14);
    for (const [index, stage] of map.stages.entries()) {
      expect(
        labels(stage.nodes.filter((node) => node.type !== 'data')),
        `этап ${stage.number}`,
      ).toEqual([...(STEPS_BY_STAGE[index] ?? [])].sort());
    }
  });

  it('восемь входов и двенадцать выходов, каждый при своём этапе', () => {
    expect(data).toHaveLength(20);
    expect(labels(data.filter((node) => node.direction === 'in'))).toEqual([...INPUTS].sort());
    // Выходов больше, чем плашек на слайде: к единственной плашке-передаче
    // добавились карточки-результаты, порождённые из keyOutputs этапов
    // (решение владельца от 07.09.2026, приём карты SNP).
    expect(labels(data.filter((node) => node.direction === 'out'))).toContain(OUTPUT);
    expect(data.filter((node) => node.direction === 'out')).toHaveLength(12);

    const stageOf = (label: string): number | undefined =>
      map.stages.find((stage) => stage.nodes.some((node) => node.label === label))?.number;
    // Этап плашки определяется НЕ её координатой, а шагом, с которым она
    // связана: все входы лежат в общей левой полосе слайда (иначе импортёр
    // признал бы их выходами), и по абсциссе неотличимы друг от друга.
    expect(stageOf('История продаж и заказы из ERP / DWH')).toBe(1);
    expect(stageOf('План производства собственной переработки из SNP и PS')).toBe(1);
    expect(stageOf('Промо-план из TPM/NRM')).toBe(2);
    expect(stageOf('Sell-Out и остатки клиента из ERP')).toBe(3);
    expect(stageOf('Открытые заказы и целевой запас клиента')).toBe(3);
    expect(stageOf('Категорийный менеджмент: проверка Building Blocks')).toBe(4);
    expect(stageOf('Коммерческие финансы: консенсус-прогноз в деньгах')).toBe(4);
    expect(stageOf('Получение ограниченного прогноза из модуля SNP')).toBe(5);
    expect(stageOf(OUTPUT)).toBe(5);
  });

  it('рёбра внутри этапов: 3 + 5 + 2 + 3 + 5', () => {
    // «Прямые каналы» и «Sell-Out → баланс → Sell-In» по-прежнему параллельны и
    // между собой не связаны; два ребра этапа 3 — это связи плашек-входов со
    // своим шагом, а не поток между шагами.
    expect(map.stages.map((stage) => stage.edges.length)).toEqual([3, 5, 2, 3, 5]);
  });

  it('поток 1 → 2 → 3 → 4 → 5 и ОБРАТНАЯ связь 5 → 2 по точности', () => {
    // Обратное ребро 5 → 2 — решение владельца от 07.09.2026: ретроспектива
    // точности и FVA возвращается в сегментацию и настройку методов. Без него
    // ручной этап 4 остаётся без измерения качества, а контроль точности —
    // отчётом, который ни на что не влияет.
    //
    // Обратного ребра «следующий цикл» 5 → 1 по-прежнему НЕТ: на слайде это
    // подпись, а не поток.
    const ids = map.stages.map((stage) => stage.id);
    const pairs = map.overviewEdges
      .filter((edge) => edge.kind === 'process')
      .map((edge) => [ids.indexOf(edge.source) + 1, ids.indexOf(edge.target) + 1])
      .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0));
    expect(pairs).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 2],
    ]);
  });

  it('внешние системы: ERP и зависимый спрос на этапе 1, SNP и MEIO на этапе 5', () => {
    // Плашка «Передача неограниченного плана спроса в SNP и MEIO» называет ДВА
    // модуля сразу — одна подпись, две записи ExternalIO. Коды выведены через
    // SYSTEM_ALIASES (SNP → INPLAN, MEIO → IO): владелец уже закрепил их в
    // словаре систем, и вторых кодов на те же модули не заводят.
    // Зависимый спрос собственной переработки приходит из двух модулей сразу —
    // одна плашка, две записи ExternalIO, как и у выхода этапа 5.
    expect(map.stages[0]?.inputs.map((io) => io.system)).toEqual(['ERP', 'INPLAN', 'PS']);
    expect(map.stages[2]?.inputs.map((io) => io.system)).toEqual(['ERP']);
    expect(map.stages[4]?.inputs.map((io) => io.system)).toEqual(['INPLAN']);
    expect(map.stages[4]?.outputs.map((io) => io.system)).toEqual(['INPLAN', 'IO']);
    for (const io of map.stages[4]?.outputs ?? []) {
      expect(io.label).toBe(OUTPUT);
    }
  });

  it('TPM и роли внешними системами НЕ стали', () => {
    // Кода TPM в SystemCode нет, а «Категорийный менеджмент», «Коммерческие
    // финансы» и «Открытые заказы и целевой запас клиента» — роли и артефакты
    // без названной системы. Такие плашки остаются data-узлами без ExternalIO:
    // это отказ выдумывать, а не пропуск.
    expect(map.stages[1]?.inputs).toEqual([]);
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
      ['Отчёт качества данных', 'Сопоставимая история'],
      ['Базовый прогноз с чемпионом по серии', 'Промо-объёмы'],
      ['Прогноз Sell-In по каналам', 'Прогнозный остаток и дни покрытия у клиента'],
      ['Согласованный план спроса Sell-In'],
      [
        'Опубликованный план спроса в SNP и MEIO',
        'Решение по разрыву с планом SNP',
        'KPI точности и FVA',
        'Перечень предупреждений с приоритетом',
      ],
    ]);
  });

  it('у каждого шага есть описание, и коды BPMN стоят последним абзацем', () => {
    for (const step of steps) {
      expect(step.description, `шаг «${step.id}» без описания`).toBeTruthy();
    }
    const withCode = steps.filter((step) =>
      (step.description ?? '').split('\n\n').at(-1)?.startsWith('BPMN: '),
    );
    // Десять из двенадцати. Исключения два, и оба честные: «Прямые каналы:
    // прямой прогноз Sell-In» и «Сверка с ограниченным планом SNP и решение по
    // разрыву» — соответствующих задач в модели BPMN нет вовсе (SLIDE_ONLY,
    // docs/reconciliation/dp-meio-bpmn.md), и код не выдумывается.
    expect(withCode).toHaveLength(11);
    expect(
      steps.find((step) => step.label === 'Прямые каналы: прямой прогноз Sell-In')?.description,
    ).not.toContain('BPMN:');
    expect(
      steps.find((step) => step.label === 'Сверка с ограниченным планом SNP и решение по разрыву')
        ?.description,
    ).not.toContain('BPMN:');
  });

  it('маркеры слайда ушли в inputs узлов', () => {
    expect(nodes.flatMap((node) => node.inputs ?? []).filter((line) => line.endsWith(':'))).toEqual(
      [],
    );
    expect(nodes.find((node) => node.id === 'podgotovka-sopostavimoy-istorii')?.inputs).toEqual([
      'OOS, выбросы, промо, ML-очистка',
      'Перенос истории при смене схемы',
      'Замена SKU через DFU',
      'Исключения планеру',
      'Разделение потоков: рынок / внутренний передел / экспорт',
    ]);
  });

  it('группы внутри этапов: 0 + 2 + 2 + 2 + 2', () => {
    // Решение владельца от 07.09.2026. Этап с одним шагом группы не получает —
    // рамка вокруг единственной карточки ничего не сообщает.
    expect(map.stages.map((stage) => stage.groups.map((group) => group.label))).toEqual([
      [],
      ['Базовый прогноз', 'Новинки и промо'],
      ['Прямой канал', 'Через дистрибутора'],
      ['Обогащение', 'Согласование'],
      ['Публикация', 'Сверка и контроль'],
    ]);
  });

  it('каждый шаг сгруппированного этапа лежит в своей группе', () => {
    for (const stage of map.stages) {
      const ids = new Set(stage.groups.map((group) => group.id));
      for (const node of stage.nodes) {
        if (node.type === 'data') {
          expect(node.group, `плашка «${node.id}» не должна быть в группе`).toBeUndefined();
          continue;
        }
        if (ids.size === 0) {
          expect(node.group, `этап ${stage.number} без групп`).toBeUndefined();
        } else {
          expect(ids, `шаг «${node.id}»`).toContain(node.group);
        }
      }
    }
  });

  it('у каждого шага есть выходы и ответственный', () => {
    // Панель узла рисует секции «Выходы» и «Ответственный» только при наличии
    // данных. До 07.09.2026 обе были пусты у всех узлов обеих карт.
    for (const step of steps) {
      expect(step.outputs, `шаг «${step.id}» без выходов`).toBeTruthy();
      expect(step.outputs?.length, `шаг «${step.id}»`).toBeGreaterThan(0);
      expect(step.owner, `шаг «${step.id}» без ответственного`).toBeTruthy();
    }
    expect(steps.filter((step) => step.outputs !== undefined)).toHaveLength(14);
    expect(steps.filter((step) => step.owner !== undefined)).toHaveLength(14);

    // Дословно, из согласованного authoring source.
    expect(nodes.find((node) => node.id === 'kontrol-tochnosti-i-fva')?.outputs).toEqual([
      'KPI точности: FA, MAPE, BIAS, WAPE',
      'FVA по слоям',
      'Алерты точности',
    ]);
    expect(nodes.find((node) => node.id === 'demand-review-meeting')?.owner).toBe(
      'Руководитель планирования спроса',
    );
  });

  it('ОТВЕТСТВЕННЫЙ — ручное поле и переживает перегенерацию', () => {
    // serialize_node запрещено отдавать owner (самопроверка импортёра:
    // ключи узла обязаны лежать в IMPORTER_NODE_FIELDS, а owner из них исключён
    // как переносимое поле). Значит ответственные живут в этом файле и
    // восстанавливаются carry_over_manual_fields по id при каждом npm run data.
    // Тест сторожит, что их не стёрли очередной перегенерацией.
    expect(nodes.filter((node) => node.owner !== undefined).length).toBe(14);
  });

  it('warningsCount не проставлен', () => {
    for (const stage of map.stages) {
      expect(stage.warningsCount, `этап ${stage.number}`).toBeUndefined();
    }
  });
});
