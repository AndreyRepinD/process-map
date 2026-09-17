// Аккуратная раскладка этапа: сквозные колонки карточек и маршруты рёбер
// (решение владельца 17.09.2026, «поправь в dp чтобы аккуратно всё смотрелось»).
//
// ЧТО СТОРОЖИТ ФАЙЛ. Эффект на реальных картах, а не то, что поле доехало:
//   · карточки-входы этапа стоят в ОДНОЙ колонке, а не лесенкой;
//   · маршрут ребра не проходит сквозь чужую карточку — ни горизонталью, ни
//     вертикалью;
//   · маршрут отдаётся, только пока карточки стоят на расчётных местах;
//   · ломаная кончается в хэндле цели или в пределах ROUTE_SNAP от него.
import { describe, expect, it } from 'vitest';
import { routedPath, ROUTE_SNAP_PX } from '../src/components/edges/edgeGeometry';
import { stageRoutes } from '../src/components/StageDetail/stageGraph';
import { ProcessMapSchema, type ProcessNode, type Stage } from '../src/data/schema.ts';
import { NODE_SIZE, ROUTE_SNAP, layoutStageDetailed } from '../src/layout/stageLayout.ts';
import dpJson from '../src/data/dp/process.json';
import meioJson from '../src/data/meio/process.json';

const maps = {
  dp: ProcessMapSchema.parse(dpJson),
  meio: ProcessMapSchema.parse(meioJson),
};

function stageOf(map: keyof typeof maps, number: number): Stage {
  const stage = maps[map].stages.find((item) => item.number === number);
  expect(stage).toBeTruthy();
  return stage as Stage;
}

function rect(node: ProcessNode) {
  const size = NODE_SIZE[node.type];
  return { x: node.position.x, y: node.position.y, ...size };
}

/** Ломаная маршрута в координатах раскладки: хэндл источника → изломы → цель. */
function polyline(stage: Stage, edgeId: string): [number, number][] {
  const edge = stage.edges.find((item) => item.id === edgeId);
  const source = stage.nodes.find((node) => node.id === edge?.source) as ProcessNode;
  const target = stage.nodes.find((node) => node.id === edge?.target) as ProcessNode;
  const sx = source.position.x + NODE_SIZE[source.type].width;
  const sy = source.position.y + NODE_SIZE[source.type].height / 2;
  const tx = target.position.x;
  const turns = layoutStageDetailed(stage).routes.get(edgeId) ?? [];
  const points: [number, number][] = [[sx, sy]];
  let y = sy;
  for (const turn of turns) {
    points.push([turn.x, y], [turn.x, turn.y]);
    y = turn.y;
  }
  points.push([tx, y]);
  return points;
}

function segmentHitsRect(
  [x1, y1]: [number, number],
  [x2, y2]: [number, number],
  box: { x: number; y: number; width: number; height: number },
): boolean {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return left < box.x + box.width && right > box.x && top < box.y + box.height && bottom > box.y;
}

describe('сквозные колонки карточек данных', () => {
  it('DP, этап 1: все семь входов стоят в одной колонке', () => {
    const stage = stageOf('dp', 1);
    const inputs = stage.nodes.filter(
      (node) => node.type === 'data' && !stage.edges.some((edge) => edge.target === node.id),
    );
    expect(inputs).toHaveLength(7);
    expect(new Set(inputs.map((node) => node.position.x)).size).toBe(1);
  });

  it('DP, этапы 2 и 5: входы — одна колонка, выходы — одна колонка', () => {
    for (const number of [2, 5]) {
      const stage = stageOf('dp', number);
      const data = stage.nodes.filter((node) => node.type === 'data');
      const inputs = data.filter((node) => !stage.edges.some((edge) => edge.target === node.id));
      const outputs = data.filter((node) => !stage.edges.some((edge) => edge.source === node.id));
      expect(new Set(inputs.map((node) => node.position.x)).size, `этап ${number}`).toBe(1);
      expect(new Set(outputs.map((node) => node.position.x)).size, `этап ${number}`).toBe(1);
    }
  });
});

describe('маршруты рёбер', () => {
  const cases: [keyof typeof maps, number][] = [
    ['dp', 1],
    ['dp', 2],
    ['dp', 3],
    ['dp', 4],
    ['dp', 5],
    ['meio', 1],
    ['meio', 2],
    ['meio', 3],
    ['meio', 4],
    ['meio', 5],
  ];

  it.each(cases)('%s, этап %i: маршрут не проходит сквозь чужие карточки', (map, number) => {
    const stage = stageOf(map, number);
    const routes = layoutStageDetailed(stage).routes;
    expect(routes.size, 'маршрутов нет вовсе').toBeGreaterThan(0);
    for (const [edgeId] of routes) {
      const edge = stage.edges.find((item) => item.id === edgeId);
      const points = polyline(stage, edgeId);
      for (const node of stage.nodes) {
        if (node.id === edge?.source || node.id === edge?.target) {
          continue;
        }
        for (let index = 1; index < points.length; index += 1) {
          const from = points[index - 1] as [number, number];
          const to = points[index] as [number, number];
          expect(
            segmentHitsRect(from, to, rect(node)),
            `${edgeId}: отрезок ${String(from)}→${String(to)} режет «${node.id}»`,
          ).toBe(false);
        }
      }
    }
  });

  it('DP, этап 5: веер «Публикации» в выходы идёт одним стволом', () => {
    const stage = stageOf('dp', 5);
    const routes = layoutStageDetailed(stage).routes;
    const fan = stage.edges.filter(
      (edge) =>
        edge.source === 'publikaciya-plana-sprosa' &&
        stage.nodes.find((node) => node.id === edge.target)?.type === 'data',
    );
    expect(fan.length).toBeGreaterThanOrEqual(2);
    const lanes = new Set(fan.map((edge) => routes.get(edge.id)?.at(-1)?.x));
    expect(lanes.size).toBe(1);
    for (const edge of fan) {
      expect(routes.get(edge.id), edge.id).toHaveLength(1);
    }
  });

  it('данные этапа совпадают с раскладкой — маршруты доступны экрану', () => {
    for (const map of Object.values(maps)) {
      for (const stage of map.stages) {
        expect(stageRoutes(stage), `${map.id}, этап ${stage.number}`).not.toBeNull();
      }
    }
  });

  it('сдвинутая или увеличенная карточка отключает маршруты этапа', () => {
    const stage = stageOf('dp', 5);
    const [first, ...rest] = stage.nodes;
    const moved: Stage = {
      ...stage,
      nodes: [{ ...(first as ProcessNode), position: { x: 5, y: 5 } }, ...rest],
    };
    expect(stageRoutes(moved)).toBeNull();
    const resized: Stage = {
      ...stage,
      nodes: [{ ...(first as ProcessNode), size: { width: 400, height: 90 } }, ...rest],
    };
    expect(stageRoutes(resized)).toBeNull();
  });
});

describe('ломаная по изломам', () => {
  it('идёт по изломам и кончается в хэндле цели', () => {
    const { path } = routedPath(0, 10, 300, 80, [
      { x: 100, y: 40 },
      { x: 250, y: 80 },
    ]);
    expect(path.startsWith('M 0 10')).toBe(true);
    expect(path.endsWith('L 300 80')).toBe(true);
    expect(path).toContain('Q 100 10');
    expect(path).toContain('Q 250 80');
  });

  it('разница с хэндлом в пределах ROUTE_SNAP — без ступеньки', () => {
    expect(ROUTE_SNAP_PX).toBe(ROUTE_SNAP);
    const { path } = routedPath(0, 50, 200, 58, [{ x: 100, y: 50 }]);
    expect(path).toBe('M 0 50 L 200 50');
  });

  it('устаревший излом дальше ROUTE_SNAP доводится до хэндла', () => {
    const { path } = routedPath(0, 50, 200, 120, [{ x: 100, y: 60 }]);
    expect(path.endsWith('L 200 120')).toBe(true);
  });
});
