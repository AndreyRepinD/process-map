// Содержание карты MEIO: что именно задано authoring source владельца.
//
// ЗАЧЕМ ДОСЛОВНЫЕ СТРОКИ — см. шапку tests/dp/content.test.ts: фикстуру пишет
// сам импортёр, и тихую регрессию разбора она не поймает.
//
// СОДЕРЖАНИЕ ЗАМОРОЖЕНО (CONTENT_FROZEN, решение владельца от 06.09.2026).
import { describe, expect, it } from 'vitest';
import { ProcessMapSchema, type ProcessNode } from '../../src/data/schema.ts';
import processJson from '../../src/data/meio/process.json';

const map = ProcessMapSchema.parse(processJson);
const nodes = map.stages.flatMap((stage) => stage.nodes);
const steps = nodes.filter((node) => node.type !== 'data');
const data = nodes.filter((node) => node.type === 'data');

const STAGE_TITLES = [
  'Получение данных',
  'Подготовка к расчёту',
  'Расчёт и анализ',
  'Оценка эффектов',
];

const STEPS_BY_STAGE: string[][] = [
  ['Подготовка данных'],
  ['Настройка параметров для расчёта уровней запасов', 'Сегментация'],
  ['Расчёт рекомендаций по уровням запасов', 'Анализ полученных значений'],
  ['Оценка эффектов'],
];

const INPUTS = [
  'Структура текущих запасов и фактические отгрузки из ERP',
  'Спрос и волатильность из DP',
  'Параметры цепочки из ERP',
  'Сроки годности и требования сетей к остаточному сроку из ERP',
  'Ошибка прогноза по горизонту из DP',
];

const OUTPUTS = ['Уровни запасов в SNP/PS и MRP', 'Оценка эффектов и рекомендации'];

function labels(list: ProcessNode[]): string[] {
  return list.map((node) => node.label).sort();
}

describe('карта MEIO: четыре этапа', () => {
  it('ровно четыре этапа с номерами 1..4 и заголовками дословно', () => {
    expect(map.stages).toHaveLength(4);
    expect(map.stages.map((stage) => stage.number)).toEqual([1, 2, 3, 4]);
    expect(map.stages.map((stage) => stage.title)).toEqual(STAGE_TITLES);
  });
});

describe('карта MEIO: содержание', () => {
  it('шесть шагов, по этапам, дословно', () => {
    expect(steps).toHaveLength(6);
    for (const [index, stage] of map.stages.entries()) {
      expect(
        labels(stage.nodes.filter((node) => node.type !== 'data')),
        `этап ${stage.number}`,
      ).toEqual([...(STEPS_BY_STAGE[index] ?? [])].sort());
    }
  });

  it('пять входов и два выхода, каждый при своём этапе', () => {
    expect(data).toHaveLength(7);
    expect(labels(data.filter((node) => node.direction === 'in'))).toEqual([...INPUTS].sort());
    expect(labels(data.filter((node) => node.direction === 'out'))).toEqual([...OUTPUTS].sort());

    const stageOf = (label: string): number | undefined =>
      map.stages.find((stage) => stage.nodes.some((node) => node.label === label))?.number;
    expect(stageOf('Структура текущих запасов и фактические отгрузки из ERP')).toBe(1);
    expect(stageOf('Спрос и волатильность из DP')).toBe(2);
    expect(stageOf('Параметры цепочки из ERP')).toBe(2);
    expect(stageOf('Сроки годности и требования сетей к остаточному сроку из ERP')).toBe(2);
    expect(stageOf('Ошибка прогноза по горизонту из DP')).toBe(2);
    expect(stageOf('Уровни запасов в SNP/PS и MRP')).toBe(3);
    expect(stageOf('Оценка эффектов и рекомендации')).toBe(4);
  });

  it('рёбра внутри этапов: 1 + 5 + 2 + 1', () => {
    expect(map.stages.map((stage) => stage.edges.length)).toEqual([1, 5, 2, 1]);
  });

  it('обзорные рёбра — линейный поток 1 → 2 → 3 → 4 без обратного', () => {
    // Обратной связи «анализ → расчёт» нет: шлюз «Необх. корректировка?» есть в
    // BPMN (docs/reconciliation/dp-meio-bpmn.md, BPMN_ONLY), но на слайде
    // отсутствует, а рёбра не из презентации заводятся только решением владельца.
    const ids = map.stages.map((stage) => stage.id);
    const pairs = map.overviewEdges
      .filter((edge) => edge.kind === 'process')
      .map((edge) => [ids.indexOf(edge.source) + 1, ids.indexOf(edge.target) + 1])
      .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
    expect(pairs).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
  });

  it('выход этапа 3 называет ТРИ модуля одной подписью', () => {
    // Решение владельца от 06.09.2026: подпись называет модуль тем именем,
    // которое знает словарь систем. Исходная формулировка «Уровни запасов в
    // SP/PS и MRP» дала бы PS и MRP: токена «SP» в SYSTEM_TOKENS нет, а «PS»
    // есть, и INPLAN потерялся бы молча. SNP → INPLAN через SYSTEM_ALIASES.
    expect(map.stages[2]?.outputs.map((io) => io.system)).toEqual(['INPLAN', 'PS', 'MRP']);
    for (const io of map.stages[2]?.outputs ?? []) {
      expect(io.label).toBe('Уровни запасов в SNP/PS и MRP');
    }
  });

  it('внешние системы входов: ERP на этапе 1, по два DP и ERP на этапе 2', () => {
    expect(map.stages[0]?.inputs.map((io) => io.system)).toEqual(['ERP']);
    expect(map.stages[1]?.inputs.map((io) => io.system)).toEqual(['DP', 'ERP', 'ERP', 'DP']);
  });

  it('две плашки одной системы у этапа дают ОДИН свимлейн на обзоре', () => {
    // У этапа 2 по два входа из ERP (параметры цепочки, сроки годности) и из DP
    // (спрос с волатильностью, ошибка прогноза). Свимлейн на обзоре один на
    // систему, поэтому связей «ERP → этап 2» и «DP → этап 2» тоже по одной.
    //
    // До дедупликации оба ребра получали дословно один id (ov-ERP--stage-2-...)
    // и check_unique_ids роняла импорт. Дефект был латентным: у карт, где на
    // этапе все входы из разных систем, он не проявлялся.
    const integrations = map.overviewEdges.filter((edge) => edge.kind === 'integration');
    expect(new Set(integrations.map((edge) => edge.id)).size).toBe(integrations.length);
    for (const system of ['ERP', 'DP']) {
      expect(
        integrations.filter((edge) => edge.source === system && edge.target === map.stages[1]?.id),
        `свимлейн ${system} → этап 2`,
      ).toHaveLength(1);
    }
  });

  it('«Оценка эффектов и рекомендации» внешней системой НЕ стала', () => {
    // Отчёт для бизнеса: системы в тексте нет, и угадывать её запрещено. Плашка
    // остаётся data-узлом направления out без ExternalIO — поэтому у этапа 4
    // выходов среди внешних систем нет, хотя выходная плашка есть.
    expect(map.stages[3]?.outputs).toEqual([]);
    expect(data.find((node) => node.label === 'Оценка эффектов и рекомендации')?.direction).toBe(
      'out',
    );
  });

  it('у карты есть и вход, и выход', () => {
    expect(map.stages.flatMap((stage) => stage.inputs).length).toBeGreaterThan(0);
    expect(map.stages.flatMap((stage) => stage.outputs).length).toBeGreaterThan(0);
  });

  it('ключевые выходы объявлены у каждого этапа', () => {
    expect(map.stages.map((stage) => stage.keyOutputs)).toEqual([
      ['Модель данных для расчёта'],
      ['Настроенные параметры расчёта', 'Сегментация по пяти признакам'],
      [
        'Оптимизационный расчёт распределения запасов по эшелонам в разрезе продукт-локация-период',
        'Три сценария',
      ],
      ['Комплексная оценка эффектов и параметров поставок на основе трёх сценариев'],
    ]);
  });

  it('срок годности — ограничение расчёта, а не пожелание', () => {
    // Решение владельца от 07.09.2026: для охлаждённой продукции целевое
    // покрытие выше остаточного срока превращается не в излишек, а в списание.
    // Ограничение и стоимость списаний живут в шаге расчёта, параметры срока —
    // в шаге настройки.
    const setup = steps.find(
      (step) => step.label === 'Настройка параметров для расчёта уровней запасов',
    );
    expect(setup?.inputs).toContain('Срок годности и остаточный срок при приёмке');
    expect(setup?.inputs).toContain('Политика FEFO');

    const calc = steps.find((step) => step.label === 'Расчёт рекомендаций по уровням запасов');
    expect(calc?.inputs).toContain('Ограничение: покрытие ≤ остаточного срока годности');
    expect(calc?.inputs).toContain('Стоимость списаний и уценки');
  });

  it('база неопределённости — параметр настройки: расчёт в модуле ИЛИ ошибка из DP', () => {
    // Уточнение владельца от 07.09.2026: сначала было решено считать разброс
    // только внутри модуля, затем — что готовую ошибку прогноза можно получать
    // и из DP. Оба источника допустимы, выбор делается по сегментам, поэтому на
    // карте это параметр настройки, а не жёсткое правило.
    const setup = steps.find(
      (step) => step.label === 'Настройка параметров для расчёта уровней запасов',
    );
    expect(setup?.inputs).toContain(
      'База неопределённости: расчёт в модуле или ошибка прогноза из DP',
    );
    expect(setup?.description).toContain('ПАРАМЕТР НАСТРОЙКИ');
    expect(setup?.description).toContain('собственной истории прогноза и факта');

    // Второй источник виден на карте отдельной плашкой, а не только словами.
    expect(
      map.stages[1]?.inputs.filter((io) => io.label === 'Ошибка прогноза по горизонту из DP'),
    ).toHaveLength(1);
  });

  it('у каждого шага есть описание; сноска про сценарии — в описании, не в подписи', () => {
    for (const step of steps) {
      expect(step.description, `шаг «${step.id}» без описания`).toBeTruthy();
    }
    const analysis = steps.find((step) => step.label === 'Анализ полученных значений');
    expect(analysis?.description).toContain('уточнены по ходу проекта');
    expect(analysis?.label).not.toContain('уточнены');

    // У «Сегментации» кода BPMN нет: отдельной задачи сегментации в модуле IO
    // модели нет вовсе (SLIDE_ONLY). Остальные пять шагов код несут.
    const withCode = steps.filter((step) =>
      (step.description ?? '').split('\n\n').at(-1)?.startsWith('BPMN: '),
    );
    expect(withCode).toHaveLength(5);
    expect(steps.find((step) => step.label === 'Сегментация')?.description).not.toContain('BPMN:');
  });

  it('группы внутри этапов: 0 + 2 + 2 + 0', () => {
    // Этапы 1 и 4 несут по одному шагу — группа вокруг единственной карточки
    // ничего не сообщает и не заводится (решение владельца от 07.09.2026).
    expect(map.stages.map((stage) => stage.groups.map((group) => group.label))).toEqual([
      [],
      ['Параметры расчёта', 'Сегментация'],
      ['Расчёт', 'Анализ'],
      [],
    ]);
  });

  it('у каждого шага есть выходы и ответственный', () => {
    for (const step of steps) {
      expect(step.outputs, `шаг «${step.id}» без выходов`).toBeTruthy();
      expect(step.owner, `шаг «${step.id}» без ответственного`).toBeTruthy();
    }
    expect(steps.filter((step) => step.outputs !== undefined)).toHaveLength(6);
    expect(steps.filter((step) => step.owner !== undefined)).toHaveLength(6);

    expect(
      nodes.find((node) => node.id === 'raschet-rekomendaciy-po-urovnyam-zapasov')?.outputs,
    ).toEqual([
      'Рекомендованные уровни запасов',
      'Точка заказа',
      'Рекомендованный уровень сервиса',
    ]);
    expect(nodes.find((node) => node.id === 'ocenka-effektov')?.owner).toBe(
      'Планер запасов совместно с финансами',
    );
  });

  it('ОТВЕТСТВЕННЫЙ — ручное поле и переживает перегенерацию', () => {
    // Импортёру запрещено отдавать owner (самопроверка serialize_node), поэтому
    // поле живёт в этом файле и восстанавливается carry_over_manual_fields.
    expect(nodes.filter((node) => node.owner !== undefined).length).toBe(6);
  });

  it('warningsCount не проставлен', () => {
    for (const stage of map.stages) {
      expect(stage.warningsCount, `этап ${stage.number}`).toBeUndefined();
    }
  });
});
