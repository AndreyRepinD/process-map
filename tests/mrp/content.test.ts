// Содержание карты MRP: что именно прочитано со слайда 8 (process-map-3wh.15).
//
// ЗАЧЕМ ДОСЛОВНЫЕ СТРОКИ. tests/fixtures/mrp/required-nodes.json генерирует сам
// импортёр, поэтому тихую регрессию разбора он не поймает: изменится разбор —
// изменится и фикстура. Здесь подписи выписаны РУКАМИ со слайда, и это
// единственное место, где сверка «карта ↔ презентация» зафиксирована так, что
// её нельзя обойти перегенерацией. Тот же жанр, что «группа „Публикация планов“
// связана целиком» в tests/snp/importPreserve.test.ts.
//
// Числа 4 / 12 / 5 / 13 / 4 — та сверка с презентацией, которую CLAUDE.md
// требует от роли data-migrator.
import { describe, expect, it } from 'vitest';
import { ProcessMapSchema, type ProcessNode } from '../../src/data/schema.ts';
import processJson from '../../src/data/mrp/process.json';

const map = ProcessMapSchema.parse(processJson);
const nodes = map.stages.flatMap((stage) => stage.nodes);
const steps = nodes.filter((node) => node.type !== 'data');

describe('карта MRP: четыре этапа', () => {
  it('ровно четыре этапа с номерами 1..4', () => {
    // Переехало из tests/mapContract.test.ts (process-map-70e.4) по той же
    // причине, что и у SNP: четвёрка — свойство слайда 8, а не контракта карты.
    expect(map.stages).toHaveLength(4);
    expect(map.stages.map((stage) => stage.number)).toEqual([1, 2, 3, 4]);
  });
});

/** Заголовки четырёх этапов — надписи над контейнерами слайда 8, дословно. */
const STAGE_TITLES = [
  'Расчёт потребности',
  'Обработка ошибок и предупреждений',
  'Анализ и корректировка результатов',
  'Сценарное планирование',
];

/** Двенадцать шагов слайда 8, по этапам и в порядке следования. */
const STEPS_BY_STAGE: string[][] = [
  ['Разузлование BOM', 'Расчёт брутто- и нетто-потребностей', 'Формирование заявок на закупку'],
  ['Анализ предупреждений', 'Исправление данных'],
  [
    'Проверка обеспеченности BOM',
    'Корректировка заявок',
    'Согласование изменений',
    'Согласование плана закупок',
  ],
  [
    'Создание альтернативных сценариев',
    'Сравнение по KPI (стоимость, риски, запасы)',
    'Утверждение финального сценария',
  ],
];

/** Колонка входов слева на слайде. */
const INPUTS = [
  'Плановые заказы из SNP, PS',
  'Основные и транзакционные данные из ERP',
  'Рекомендованные уровни запасов из MEIO',
  'Плановые первичные потребности и другие виды потребностей',
];

/** Единственный названный выход процесса. */
const OUTPUT = 'Передача плана в виде заявок на закупку в систему исполнения закупок';

function labels(list: ProcessNode[]): string[] {
  return list.map((node) => node.label).sort();
}

describe('карта MRP: содержание слайда 8', () => {
  it('четыре этапа с заголовками надписей над контейнерами', () => {
    expect(map.stages.map((stage) => stage.title)).toEqual(STAGE_TITLES);
    expect(map.stages.map((stage) => stage.number)).toEqual([1, 2, 3, 4]);
  });

  it('двенадцать шагов, по этапам, дословно', () => {
    expect(steps).toHaveLength(12);
    for (const [index, stage] of map.stages.entries()) {
      expect(
        labels(stage.nodes.filter((node) => node.type !== 'data')),
        `этап ${stage.number}`,
      ).toEqual([...(STEPS_BY_STAGE[index] ?? [])].sort());
    }
  });

  it('четыре входа у этапа 1 и один выход у этапа 3', () => {
    const data = nodes.filter((node) => node.type === 'data');
    expect(data).toHaveLength(5);
    expect(labels(data.filter((node) => node.direction === 'in'))).toEqual([...INPUTS].sort());
    expect(labels(data.filter((node) => node.direction === 'out'))).toEqual([OUTPUT]);

    const stageOf = (label: string): number | undefined =>
      map.stages.find((stage) => stage.nodes.some((node) => node.label === label))?.number;
    for (const input of INPUTS) {
      expect(stageOf(input), `вход «${input}»`).toBe(1);
    }
    expect(stageOf(OUTPUT)).toBe(3);
  });

  it('тринадцать рёбер внутри этапов: 6 + 1 + 4 + 2', () => {
    expect(map.stages.map((stage) => stage.edges.length)).toEqual([6, 1, 4, 2]);
  });

  it('четыре обзорных ребра, включая ОБРАТНУЮ связь этап 4 → этап 3', () => {
    // Обратное ребро — линия [112] слайда 8 («Утверждение финального сценария»
    // → «Согласование изменений»). Геометрия её теряет: bbox коннектора уходит
    // ниже кромки слайда. Находят её только привязки stCxn/endCxn, поэтому
    // проверка стоит отдельно — она сторожит именно этот механизм.
    const ids = map.stages.map((stage) => stage.id);
    const pairs = map.overviewEdges
      .filter((edge) => edge.kind === 'process')
      .map((edge) => [ids.indexOf(edge.source) + 1, ids.indexOf(edge.target) + 1]);
    expect(pairs).toHaveLength(4);
    expect(pairs).toContainEqual([1, 2]);
    expect(pairs).toContainEqual([2, 3]);
    expect(pairs).toContainEqual([3, 4]);
    expect(pairs, 'обратная связь этап 4 → этап 3 потеряна').toContainEqual([4, 3]);
  });

  it('внешние системы: четыре входа у этапа 1, ни одного выхода', () => {
    // Коды выведены через алиасы: на слайде модули названы полными именами
    // (SNP → INPLAN, MEIO → IO), потому что владелец уже закрепил эти коды в
    // словаре систем. Система выходной плашки в тексте не названа, и угадывать
    // её запрещено — ExternalIO для неё нет, и это отказ выдумывать.
    expect(
      map.stages
        .flatMap((stage) => stage.inputs)
        .map((io) => io.system)
        .sort(),
      // КОД SNP, А НЕ INPLAN: с 08.09.2026 у модуля свой код, псевдоним снят.
    ).toEqual(['ERP', 'IO', 'PS', 'SNP']);
    expect(map.stages.flatMap((stage) => stage.outputs)).toEqual([]);
    expect(map.stages[0]?.inputs).toHaveLength(4);

    // «Плановые заказы из SNP, PS» называет ДВА модуля сразу — одна подпись,
    // два входа. detect_system отдал бы только первый.
    const fromOneLabel = map.stages
      .flatMap((stage) => stage.inputs)
      .filter((io) => io.label === 'Плановые заказы из SNP, PS')
      .map((io) => io.system)
      .sort();
    expect(fromOneLabel).toEqual(['PS', 'SNP']);
  });

  it('каждая внешняя система связана с этапом на обзоре', () => {
    const integrations = map.overviewEdges.filter((edge) => edge.kind === 'integration');
    expect(integrations).toHaveLength(4);
    for (const edge of integrations) {
      expect(edge.target, 'вход обязан вести В этап').toBe(map.stages[0]?.id);
    }
  });

  it('ключевые выходы есть только у этапа 3', () => {
    // Решение владельца: принять как есть. На слайде назван один выход, и он
    // принадлежит третьему этапу; у остальных списки пусты, и карточка тогда
    // не рисует заголовок блока (process-map-3wh.11).
    expect(map.stages.map((stage) => stage.keyOutputs)).toEqual([[], [], [OUTPUT], []]);
  });

  it('длинные подписи ушли в inputs узлов, а не в outputs', () => {
    // Решение владельца: это перечни ИСХОДНЫХ данных шага. Правило SNP
    // отправило бы два из трёх в outputs, где они были бы враньём.
    expect(nodes.filter((node) => node.outputs !== undefined)).toEqual([]);
    const withInputs = nodes.filter((node) => node.inputs !== undefined);
    expect(withInputs.map((node) => node.label).sort()).toEqual(
      [
        'Разузлование BOM',
        'Расчёт брутто- и нетто-потребностей',
        'Формирование заявок на закупку',
      ].sort(),
    );
    expect(withInputs.flatMap((node) => node.inputs ?? [])).toHaveLength(12);
    // Заголовок перечня «Параметры закупки:» входом НЕ является и отрезается
    // (block_items_start, тот же дефект, что в process-map-t9j). Ни один вход
    // не оканчивается двоеточием.
    expect(
      withInputs.flatMap((node) => node.inputs ?? []).filter((line) => line.endsWith(':')),
    ).toEqual([]);
    expect(nodes.find((node) => node.id === 'formirovanie-zayavok-na-zakupku')?.inputs?.[0]).toBe(
      'Lead time, MOQ, min/max партия, кратность, периодичность',
    );
  });

  it('warningsCount не проставлен, группы пусты', () => {
    // Оба решения объяснены в process-map-3wh.1 и в build_single_slide_map:
    // счётчик предупреждений SNP означает другое, а группа стала этапом.
    for (const stage of map.stages) {
      expect(stage.warningsCount, `этап ${stage.number}`).toBeUndefined();
      expect(stage.groups, `этап ${stage.number}`).toEqual([]);
      expect(stage.nodes.every((node) => node.group === undefined)).toBe(true);
    }
  });
});
