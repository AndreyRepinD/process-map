// Аккуратный обзор пятиэтапной карты (решение владельца 17.09.2026, «поправь
// в dp чтобы аккуратно всё смотрелось»). Проверки на реальной карте DP:
//   · системы свимлейна стоят под своими этапами, когда систем меньше колонок;
//   · обратная связь компактного режима обходит карточки систем снизу, пока
//     этапы на расчётных местах, и возвращается к прежнему пути, когда
//     владелец их переставил.
import { describe, expect, it } from 'vitest';
import { buildOverviewGraph } from '../src/components/Overview/overviewGraph';
import { STAGE_HANDLE } from '../src/components/nodes/StageNode';
import { ProcessMapSchema } from '../src/data/schema.ts';
import { IO_NODE_SIZE, STAGE_NODE_SIZE } from '../src/theme/sizes.ts';
import dpJson from '../src/data/dp/process.json';
import snpJson from '../src/data/snp/process.json';

const dp = ProcessMapSchema.parse(dpJson);
const snp = ProcessMapSchema.parse(snpJson);

/** Макетные числа артборда A1 — см. tests/overviewRows.test.ts. */
const STAGE_X0 = 48;
const STAGE_STEP = 304;
const LANE_X = 20;

function underColumn(column: number): number {
  return Math.round(
    STAGE_X0 + column * STAGE_STEP + (STAGE_NODE_SIZE.width - IO_NODE_SIZE.width) / 2 - LANE_X,
  );
}

describe('свимлейны DP: системы под своими этапами', () => {
  const { nodes } = buildOverviewGraph(dp, true, false);
  const x = (id: string): number | undefined => nodes.find((node) => node.id === id)?.position.x;

  it('вход ERP — под этапом 1, вход SNP — под этапом 5', () => {
    expect(x('io-in-ERP')).toBe(underColumn(0));
    expect(x('io-in-SNP')).toBe(underColumn(4));
  });

  it('оба выхода этапа 5 — у пятого этапа, в порядке данных', () => {
    // SNP и IO приходят с одного этапа: одна колонка занята, второй достаётся
    // ближайшая свободная — слева, потому что справа колонок нет.
    expect(x('io-out-SNP')).toBe(underColumn(3));
    expect(x('io-out-IO')).toBe(underColumn(4));
  });

  it('карта SNP (систем столько же, сколько этапов) — прежняя равномерная раскладка', () => {
    const { nodes: snpNodes } = buildOverviewGraph(snp, true, false);
    const inputs = snpNodes
      .filter((node) => node.id.startsWith('io-in-'))
      .map((node) => node.position.x);
    expect(inputs).toEqual([40, 360, 680, 1000]);
  });
});

describe('обратная связь 5 → 2 в компактном режиме', () => {
  const edgeOf = (positions = {}) => {
    const { edges } = buildOverviewGraph(dp, true, true, positions);
    const back = dp.overviewEdges.find(
      (edge) => edge.kind === 'process' && edge.source.startsWith('stage-5'),
    );
    return edges.find((edge) => edge.id === back?.id);
  };

  it('идёт маршрутом под карточками систем и стартует справа', () => {
    const edge = edgeOf();
    expect(edge?.sourceHandle).toBe(STAGE_HANDLE.right);
    const route = (edge?.data as { route?: { x: number; y: number }[] } | undefined)?.route;
    expect(route).toHaveLength(2);
  });

  it('переставленный этап — прежний путь снизу, без маршрута', () => {
    const moved = edgeOf({ 'stage-5-publikaciya-i-kontrol-tochnosti': { x: 900, y: 400 } });
    expect(moved?.sourceHandle).toBe(STAGE_HANDLE.bottom);
    expect((moved?.data as { route?: unknown } | undefined)?.route).toBeUndefined();
  });
});
