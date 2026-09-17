// Раскладка обзора при числе этапов больше четырёх (process-map-70e.16).
//
// Проверки построены так, чтобы поймать ОБЕ стороны правки:
//  · при N ≤ 4 геометрия обязана остаться прежней — иначе меняется вид карт
//    snp и mrp, а они соответствуют макету A1;
//  · при N > 4 карточки обязаны переноситься, а не уезжать за экран.
//
// Тесты на реальных картах живут в tests/overview.test.tsx и compact.test.tsx;
// здесь — синтетика, потому что карты с десятью этапами в репозитории нет и не
// будет: она приходит из загруженного пользователем файла BPMN.
import { describe, expect, it } from 'vitest';
import { buildOverviewGraph, FLOW_LANE_ID } from '../src/components/Overview/overviewGraph';
import { STAGE_HANDLE } from '../src/components/nodes/StageNode';
import { ProcessMapSchema, type ProcessMap, type Stage } from '../src/data/schema.ts';
import { STAGE_NODE_SIZE } from '../src/theme/sizes.ts';
import { buildSampleProcessMap } from './fixtures/sample-process.ts';

/** Макетные числа артборда A1: left 48/352/656/960 при ширине карточки 274. */
const STAGE_X0 = 48;
const STAGE_STEP = 304;

/** Карта из N этапов: первый этап фикстуры размножается с новыми id и номерами. */
function mapWithStages(count: number): ProcessMap {
  const sample = buildSampleProcessMap();
  const first = sample.stages[0];
  expect(first).toBeTruthy();
  const stages: Stage[] = Array.from({ length: count }, (_, index) => ({
    ...(first as Stage),
    id: `stage-${index + 1}`,
    number: index + 1,
    nodes: (first as Stage).nodes.map((node) => ({ ...node, id: `${node.id}-s${index + 1}` })),
    edges: [],
    groups: [],
  }));
  return ProcessMapSchema.parse({ ...sample, stages, overviewEdges: [] });
}

function stagePositions(map: ProcessMap, compact = false): { x: number; y: number }[] {
  const { nodes } = buildOverviewGraph(map, false, compact);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return map.stages.map((stage) => {
    const node = byId.get(stage.id);
    expect(node, `нет узла этапа ${stage.id}`).toBeTruthy();
    return node!.position;
  });
}

describe('обзор: при четырёх и менее этапах ряд остаётся прежним', () => {
  it.each([1, 2, 3, 4])('%i этапов — одна строка по макетной формуле', (count) => {
    const positions = stagePositions(mapWithStages(count));
    expect(positions.map((p) => p.x)).toEqual(
      Array.from({ length: count }, (_, i) => STAGE_X0 + i * STAGE_STEP),
    );
    // Все на одной высоте: перенос не сработал.
    expect(new Set(positions.map((p) => p.y)).size).toBe(1);
  });
});

describe('обзор: пять этапов — одним рядом (решение владельца 17.09.2026)', () => {
  it('пять этапов стоят в одну строку по той же формуле шага', () => {
    const positions = stagePositions(mapWithStages(5));
    expect(positions.map((p) => p.x)).toEqual(
      Array.from({ length: 5 }, (_, i) => STAGE_X0 + i * STAGE_STEP),
    );
    expect(new Set(positions.map((p) => p.y)).size).toBe(1);
  });

  it('с шести этапов — снова сетка по четыре', () => {
    const positions = stagePositions(mapWithStages(6));
    const rows = new Map<number, number>();
    for (const { y } of positions) {
      rows.set(y, (rows.get(y) ?? 0) + 1);
    }
    expect([...rows.values()]).toEqual([4, 2]);
  });
});

describe('обзор: шесть и более этапов переносятся на строки', () => {
  it('десять этапов ложатся 4 + 4 + 2', () => {
    const positions = stagePositions(mapWithStages(10));
    const rows = new Map<number, number>();
    for (const { y } of positions) {
      rows.set(y, (rows.get(y) ?? 0) + 1);
    }
    expect([...rows.values()]).toEqual([4, 4, 2]);
  });

  /*
   * Ради чего вся правка. Прежняя формула давала для десяти этапов
   * 48 + 9 * 304 + 274 = 3058 px при вьюпорте 1280: fitView сжимал полотно до
   * масштаба ≈0.40, и подписи внутри карточек становились нечитаемыми.
   */
  it('ширина не растёт после четвёртого этапа', () => {
    const widthOf = (count: number): number => {
      const positions = stagePositions(mapWithStages(count));
      return Math.max(...positions.map((p) => p.x)) + STAGE_NODE_SIZE.width;
    };
    const four = widthOf(4);
    expect(widthOf(10)).toBe(four);
    expect(widthOf(12)).toBe(four);
    expect(four).toBeLessThan(1280);
  });

  it('карточки этапов не накладываются друг на друга', () => {
    const positions = stagePositions(mapWithStages(10));
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const a = positions[i];
        const b = positions[j];
        expect(a && b).toBeTruthy();
        const apart =
          Math.abs(a!.x - b!.x) >= STAGE_NODE_SIZE.width ||
          Math.abs(a!.y - b!.y) >= STAGE_NODE_SIZE.height;
        expect(apart, `этапы ${i} и ${j} накладываются`).toBe(true);
      }
    }
  });

  it('рамка потока растёт вниз вслед за строками, а не вширь', () => {
    const laneOf = (count: number) => {
      const { nodes } = buildOverviewGraph(mapWithStages(count), false);
      const lane = nodes.find((node) => node.id === FLOW_LANE_ID);
      expect(lane, 'рамки потока нет').toBeTruthy();
      return lane!.style as { width: number; height: number };
    };
    const four = laneOf(4);
    const ten = laneOf(10);
    expect(ten.width).toBe(four.width);
    expect(ten.height).toBeGreaterThan(four.height);
  });

  it('в компактном режиме перенос тоже работает', () => {
    const positions = stagePositions(mapWithStages(10), true);
    expect(new Set(positions.map((p) => p.y)).size).toBe(3);
  });
});

describe('обзор: рёбра через перенос строки', () => {
  /**
   * Карта из N этапов с одним ребром между этапами `from` и `to` (по номерам).
   */
  function mapWithEdge(count: number, from: number, to: number): ProcessMap {
    const base = mapWithStages(count);
    return ProcessMapSchema.parse({
      ...base,
      overviewEdges: [
        { id: 'ov-1', source: `stage-${from}`, target: `stage-${to}`, kind: 'process' },
      ],
    });
  }

  const handleOf = (map: ProcessMap): string | null | undefined =>
    buildOverviewGraph(map, false).edges[0]?.sourceHandle;

  it('внутри строки прямое ребро выходит справа — как было', () => {
    expect(handleOf(mapWithEdge(10, 1, 2))).toBe(STAGE_HANDLE.right);
  });

  /*
   * Прямое ребро с конца одной строки на начало следующей идёт визуально ВЛЕВО.
   * С правого хэндла линия вернулась бы через весь ряд назад и пряталась бы за
   * карточками — тот же дефект, из-за которого обратные рёбра уже ведутся снизу
   * (process-map-3wh.17).
   */
  it('через перенос строки прямое ребро выходит снизу', () => {
    expect(handleOf(mapWithEdge(10, 4, 5))).toBe(STAGE_HANDLE.bottom);
  });

  it('обратное ребро по-прежнему выходит снизу', () => {
    expect(handleOf(mapWithEdge(10, 3, 1))).toBe(STAGE_HANDLE.bottom);
  });
});
