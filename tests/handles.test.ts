// Имена хэндлов узлов обязаны совпадать у ВСЕХ типов карточек.
//
// ЗАЧЕМ. src/components/StageDetail/stageGraph.ts адресует концы ребра по
// именам STEP_HANDLE — и для шага, и для карточки данных, и для интеграции:
// вперёд right→left, назад bottom→top. Тип узла при этом не смотрится.
//
// Пока у карточки данных были объявлены только left и right, ребро «назад»
// просило bottom/top, которых у неё нет, и НЕ РИСОВАЛОСЬ ВОВСЕ — без ошибки, без
// предупреждения, без следа. Нашёл это владелец глазами: «от серых квадратов не
// рисуются стрелочки». Такое расхождение обязано падать здесь.
import { describe, expect, it } from 'vitest';
import { STEP_HANDLE } from '../src/components/nodes/StepNode/StepNode';
import { DATA_HANDLE } from '../src/components/nodes/DataNode/DataNode';

describe('хэндлы узлов', () => {
  it('карточка данных объявляет те же стороны, что и карточка шага', () => {
    expect(Object.keys(DATA_HANDLE).sort()).toEqual(Object.keys(STEP_HANDLE).sort());
    for (const side of Object.keys(STEP_HANDLE) as (keyof typeof STEP_HANDLE)[]) {
      expect(DATA_HANDLE[side], `сторона «${side}»`).toBe(STEP_HANDLE[side]);
    }
  });

  it('сторон ровно четыре — раскладка пользуется всеми', () => {
    // Вперёд рисуется right→left, назад bottom→top (stageGraph.ts). Меньше
    // четырёх означает, что часть рёбер молча не отрисуется.
    expect(Object.keys(STEP_HANDLE)).toHaveLength(4);
  });
});
