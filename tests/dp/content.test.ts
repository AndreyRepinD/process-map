// Содержание карты DP: что именно задано authoring source владельца.
//
// ЗАЧЕМ ДОСЛОВНЫЕ СТРОКИ. tests/fixtures/dp/required-nodes.json генерирует сам
// импортёр, поэтому тихую регрессию разбора он не поймает: изменится разбор —
// изменится и фикстура. Здесь подписи выписаны РУКАМИ из согласованного
// scripts/author/dp.json, и это единственное место, где сверка
// «карта ↔ решение владельца» зафиксирована так, что её нельзя обойти
// перегенерацией. Тот же жанр, что tests/mrp/content.test.ts.
//
// СОДЕРЖАНИЕ ЗАМОРОЖЕНО (CONTENT_FROZEN, решение владельца от 06.09.2026,
// пересмотрено 17.09.2026 по слайдам «Стандартный функционал модуля Demand
// Planning» и «Процесс Планирования спроса»): label, порядок этапов и шагов,
// входы/выходы, keyOutputs, рёбра и description меняются только новым решением
// владельца. Красный тест здесь — это не «поправь
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
  'Промо-план из TPM/NRM',
  'Sell-Out, остатки и транзит клиента по EDI',
  'Открытые заказы сетей и дистрибьюторов по EDI',
  'Категорийный менеджмент: проверка BB',
  'Коммерческие финансы: цены, оценка в деньгах',
  'Sales/KAM: коммерческие допущения',
  'Получение ограниченного плана из модуля SNP',
];

/** Выход процесса в смежные модули. */
const OUTPUT = 'Передача неограниченного плана спроса в SNP и MEIO';

/** Ошибка прогноза по горизонту — вторая часть контракта с MEIO. */
const MEIO_ERROR_OUTPUT = 'Ошибка прогноза по горизонту в MEIO';

/** Обмен с NRM: базовый прогноз уходит туда, промо-план приходит оттуда. */
const NRM_OUTPUT = 'Передача базового прогноза в NRM';

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

  it('двадцать восемь входов и четырнадцать выходов, каждый при своём этапе', () => {
    // Входов стало больше решением владельца от 17.09.2026 (исправление 7):
    // шаги пользовались данными, которых на карте не было, — календарями
    // дефицитов и событий, логистической схемой, ассортиментной матрицей,
    // фактом продаж для расчёта точности.
    // Ещё два входа и один выход — по аудиту карты (решение владельца
    // 17.09.2026, п.7–9): прогноз Sell-Out для баланса дистрибьютора,
    // коммерческие допущения Sales/KAM и ошибка прогноза для MEIO.
    expect(data).toHaveLength(42);
    // INPUTS — плашки слайда, называющие внешние системы. Кроме них в колонке
    // входов стоят карточки входных данных этапа (STAGE_INPUT_CARDS): они
    // систему не называют и ExternalIO не создают.
    for (const label of INPUTS) {
      expect(labels(data.filter((node) => node.direction === 'in'))).toContain(label);
    }
    expect(data.filter((node) => node.direction === 'in')).toHaveLength(28);
    for (const label of [
      'Справочник DFU и маппинг SKU',
      'Календарь OOS и дефицитов',
      'Логистическая схема и её изменения',
      'Ассортиментная матрица',
      'Коэффициенты подобия и каннибализации',
      'Факт продаж за закрытый период',
      'Прогноз Sell-Out с учтёнными эффектами',
    ]) {
      expect(labels(data.filter((node) => node.direction === 'in'))).toContain(label);
    }
    // Выходов больше, чем плашек на слайде: к единственной плашке-передаче
    // добавились карточки-результаты, порождённые из keyOutputs этапов
    // (решение владельца от 07.09.2026, приём карты SNP).
    expect(labels(data.filter((node) => node.direction === 'out'))).toContain(OUTPUT);
    expect(labels(data.filter((node) => node.direction === 'out'))).toContain(NRM_OUTPUT);
    expect(labels(data.filter((node) => node.direction === 'out'))).toContain(MEIO_ERROR_OUTPUT);
    expect(data.filter((node) => node.direction === 'out')).toHaveLength(14);

    const stageOf = (label: string): number | undefined =>
      map.stages.find((stage) => stage.nodes.some((node) => node.label === label))?.number;
    // Этап плашки определяется НЕ её координатой, а шагом, с которым она
    // связана: все входы лежат в общей левой полосе слайда (иначе импортёр
    // признал бы их выходами), и по абсциссе неотличимы друг от друга.
    expect(stageOf('История продаж и заказы из ERP / DWH')).toBe(1);
    expect(stageOf('Промо-план из TPM/NRM')).toBe(2);
    expect(stageOf(NRM_OUTPUT)).toBe(2);
    expect(stageOf('Sell-Out, остатки и транзит клиента по EDI')).toBe(3);
    expect(stageOf('Открытые заказы сетей и дистрибьюторов по EDI')).toBe(3);
    expect(stageOf('Категорийный менеджмент: проверка BB')).toBe(4);
    expect(stageOf('Коммерческие финансы: цены, оценка в деньгах')).toBe(4);
    expect(stageOf('Sales/KAM: коммерческие допущения')).toBe(4);
    expect(stageOf('Получение ограниченного плана из модуля SNP')).toBe(5);
    expect(stageOf(OUTPUT)).toBe(5);
    expect(stageOf(MEIO_ERROR_OUTPUT)).toBe(5);
  });

  it('входная карточка ведёт к шагу, который её использует', () => {
    // До 17.09.2026 все карточки этапа сходились к его первому шагу: пороги
    // точности «входили» в публикацию, календарь OOS — в проверку качества.
    // Потребитель теперь назван у каждой карточки (STAGE_WIRING.inputsTo).
    const consumerOf = (label: string): string[] => {
      const stage = map.stages.find((item) =>
        item.nodes.some((node) => node.label === label && node.direction === 'in'),
      );
      const node = stage?.nodes.find((item) => item.label === label && item.direction === 'in');
      return (stage?.edges ?? [])
        .filter((edge) => edge.source === node?.id)
        .map((edge) => edge.target);
    };
    expect(consumerOf('Календарь OOS и дефицитов')).toEqual(['podgotovka-sopostavimoy-istorii']);
    expect(consumerOf('Справочник DFU и маппинг SKU')).toEqual(['proverka-kachestva-dannyh']);
    expect(consumerOf('Ассортиментная матрица')).toEqual(['assortiment-metody-i-chempion']);
    expect(consumerOf('Коэффициенты подобия и каннибализации')).toEqual([
      'novinki-pohozhie-tovary',
    ]);
    expect(consumerOf('Целевой запас клиента в днях покрытия')).toEqual([
      'sell-out-balans-sell-in',
    ]);
    expect(consumerOf('Пороги точности и правила алертов')).toEqual(['kontrol-tochnosti-i-fva']);
    expect(consumerOf('Факт продаж за закрытый период')).toEqual(['kontrol-tochnosti-i-fva']);
    expect(consumerOf('Прогноз Sell-Out с учтёнными эффектами')).toEqual([
      'sell-out-balans-sell-in',
    ]);
    // Модель канала выбирает маршрут клиента, поэтому нужна обеим ветвям.
    expect(consumerOf('Модель канала по клиентам')).toEqual([
      'pryamye-kanaly-pryamoy-prognoz-sell-in',
      'sell-out-balans-sell-in',
    ]);
  });

  it('обе ветви Sell-In дают общий результат', () => {
    // Аудит 17.09.2026 (P0-2): прямая ветвь была тупиком — её прогноз никуда не
    // шёл, и «Прогноз Sell-In по каналам» считался только балансом дистрибьютора.
    const stage = map.stages[2];
    const result = stage?.nodes.find((node) => node.label === 'Прогноз Sell-In по каналам');
    const producers = (stage?.edges ?? [])
      .filter((edge) => edge.target === result?.id)
      .map((edge) => edge.source)
      .sort();
    expect(producers).toEqual([
      'pryamye-kanaly-pryamoy-prognoz-sell-in',
      'sell-out-balans-sell-in',
    ]);
  });

  it('рёбра внутри этапов: 10 + 13 + 10 + 7 + 13', () => {
    // Рёбер стало заметно больше решением владельца от 07.09.2026: карточки
    // входов и результатов перестали висеть отдельно от потока. До этого 49
    // узлов из 87 на двух картах не имели ни одной связи, и карта не показывала
    // главного — что из чего считается.
    //
    // «Прямые каналы» и «Sell-Out → баланс → Sell-In» по-прежнему параллельны и
    // между собой не связаны: общие у них вход (модель канала) и результат.
    expect(map.stages.map((stage) => stage.edges.length)).toEqual([10, 13, 10, 7, 13]);
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

  it('внешние системы: ERP на этапе 1, SNP и MEIO на этапе 5', () => {
    // Плашка «Передача неограниченного плана спроса в SNP и MEIO» называет ДВА
    // модуля сразу — одна подпись, две записи ExternalIO. Коды выведены через
    // SYSTEM_ALIASES (SNP → INPLAN, MEIO → IO): владелец уже закрепил их в
    // словаре систем, и вторых кодов на те же модули не заводят.
    // Плашка зависимого спроса собственной переработки (SNP и PS) снята
    // решением владельца от 17.09.2026: разделения потоков спроса на карте нет.
    // КОД SNP, А НЕ INPLAN (решение владельца 08.09.2026). До этого слово «SNP»
    // в подписи давало общий код платформы: своего кода у модуля не было. Теперь
    // есть, псевдоним снят, и подпись называет ровно тот модуль, что в тексте.
    expect(map.stages[0]?.inputs.map((io) => io.system)).toEqual(['ERP']);
    // Sell-Out, остатки и заказы клиента приходят от сетей и дистрибьюторов по
    // EDI, а не из собственной ERP (исправление 7 от 17.09.2026). Кода системы
    // у такой плашки нет, и ExternalIO она не создаёт.
    expect(map.stages[2]?.inputs).toEqual([]);
    expect(map.stages[4]?.inputs.map((io) => io.system)).toEqual(['SNP']);
    // Вторая запись IO — ошибка прогноза по горизонту (контракт с MEIO,
    // решение владельца 17.09.2026; сверка обеих карт — tests/dpMeioContract).
    expect(map.stages[4]?.outputs.map((io) => [io.system, io.label])).toEqual([
      ['SNP', OUTPUT],
      ['IO', OUTPUT],
      ['IO', MEIO_ERROR_OUTPUT],
    ]);
  });

  it('TPM, NRM, EDI и роли внешними системами НЕ стали', () => {
    // Кодов TPM и NRM в SystemCode нет, а «Категорийный менеджмент»,
    // «Коммерческие финансы» и данные клиента по EDI — роли и артефакты без
    // названной системы. Такие плашки остаются data-узлами без ExternalIO:
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
    ]);
  });

  it('у «Ассортимента» и «Новинок» свои пункты', () => {
    // Исправление 5 от 17.09.2026: «Референс, коэффициент, даты действия» —
    // подбор аналога для новинки, и в пунктах ассортимента он путал, что к чему.
    expect(nodes.find((node) => node.id === 'assortiment-metody-i-chempion')?.inputs).toEqual([
      'Статистика, ансамбли, ML',
      'Backtest, чемпион для серии',
      'Запуск по настройкам сегмента и расписанию',
      'Ассортимент на период прогноза: запуски и выводы',
    ]);
    expect(nodes.find((node) => node.id === 'novinki-pohozhie-tovary')?.inputs).toEqual([
      'Референс, коэффициент, даты действия',
      'Правило подобия',
      'Коэффициенты каннибализации',
    ]);
  });

  it('подписи серых карточек влезают в две строки', () => {
    // Карточка данных показывает не больше двух строк, остальное срезается
    // многоточием (замер в браузере 17.09.2026: ширина 172 px). «Коммерческие
    // финансы: цены и оценка плана в…» теряли главное — «в деньгах», поэтому
    // подписи отделов и ERP-плашки укорочены, а подробности ушли в пункты шагов.
    expect(nodes.find((node) => node.id === 'proverka-kachestva-dannyh')?.inputs?.[0]).toBe(
      'Полнота истории Sell-In, Sell-Out, Off-Take и пропуски',
    );
    for (const label of [
      'История продаж и заказы из ERP / DWH',
      'Категорийный менеджмент: проверка BB',
      'Коммерческие финансы: цены, оценка в деньгах',
      'Коэффициенты подобия и каннибализации',
    ]) {
      expect(labels(data)).toContain(label);
    }
  });

  it('описания ссылаются на регламент и не выдают требования за действующее', () => {
    // Решение владельца 17.09.2026 (п.15): детальные правила — в
    // docs/regulations/dp.md, на карте — ссылки на его разделы. Правило, чья
    // реализация в In.Plan не подтверждена, так и помечено (п.6, п.10).
    for (const step of steps) {
      expect(step.description, `шаг «${step.id}»`).toMatch(/Правила: регламент DP, §\d+/);
    }
    const quality = nodes.find((node) => node.id === 'proverka-kachestva-dannyh')?.description;
    expect(quality).toContain('реализация в In.Plan не подтверждена');
    const fva = nodes.find((node) => node.id === 'kontrol-tochnosti-i-fva')?.description;
    expect(fva).toContain('хранение промежуточных слоёв не проверено');
    // Знак BIAS не утверждается, пока не сверен с формулой In.Plan (п.4).
    expect(fva).not.toMatch(/положительн\S* BIAS|плюс\s*=\s*завыш/i);
  });

  it('редакторских пояснений и выдуманных правил в описаниях нет', () => {
    // П.1 и п.3 разбора аудита: «только действующей матрицы», пояснения
    // капсом и «единственный выход этапа 2» были моими формулировками.
    const text = steps.map((step) => step.description ?? '').join('\n');
    expect(text).not.toContain('действующей ассортиментной');
    expect(text).not.toContain('единственный выход');
    expect(text).not.toContain('ОТДЕЛЬНЫЙ ШАГ');
    expect(text).not.toContain('намеренно');
    expect(text).not.toContain('не присылают');
  });

  it('поглощение заказами — один раз и не в DP', () => {
    // П.12: на стенде In.Plan поглощение — процесс «SNP Поглощение прогноза»
    // (реестр процессов, 17.09.2026), в модели BPMN — SP-010-020.
    const publication = nodes.find((node) => node.id === 'publikaciya-plana-sprosa');
    expect(publication?.inputs).toContain('Без вычета заказов: поглощение — в SNP');
    expect(publication?.description).toContain('SNP Поглощение прогноза');
  });

  it('разделения потоков спроса на карте нет', () => {
    // Решение владельца от 17.09.2026 (пункт 9 разбора): не нужно.
    const text = JSON.stringify(processJson);
    expect(text).not.toContain('Разделение потоков');
    expect(text).not.toContain('собственной переработки');
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
      'Ошибка прогноза по горизонту и уровню для MEIO',
    ]);
    // Коммерческие финансы и Sales/KAM — участники встречи (п.2 и п.9 разбора
    // аудита от 17.09.2026); решение по разрыву — совместное (п.13).
    expect(nodes.find((node) => node.id === 'demand-review-meeting')?.owner).toBe(
      'Руководитель планирования спроса совместно с Sales/KAM и коммерческими финансами',
    );
    expect(
      nodes.find((node) => node.id === 'sverka-s-ogranichennym-planom-snp-i-reshenie-po-razryvu')
        ?.owner,
    ).toBe('Supply-планер, Sales/Marketing и руководитель планирования спроса; эскалация — S&OP');
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
