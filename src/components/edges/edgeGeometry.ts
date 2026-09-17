// Геометрия рёбер (SPEC §4.1). Вынесено в константы: CLAUDE.md запрещает
// хардкод размеров в компонентах, а не только hex-цветов.

/**
 * Радиус скругления углов ортогонального пути `smoothstep`.
 * В макете A1 линии рисованы прямыми углами через <path>, значение подобрано
 * так, чтобы скругление читалось, но не превращало угол в дугу.
 */
export const EDGE_BORDER_RADIUS = 8;

/** Допуск прилипания к хэндлу цели — ROUTE_SNAP раскладки (src/layout/stageLayout.ts). */
export const ROUTE_SNAP_PX = 12;

/** Излом маршрута: горизонтально до `x`, затем вертикально до `y` (см. RouteTurn раскладки). */
export interface EdgeTurn {
  x: number;
  y: number;
}

/**
 * Ортогональный путь по изломам маршрута со скруглёнными углами.
 *
 * Маршрут считает раскладка этапа (src/layout/stageLayout.ts::routeEdges)
 * по коридорам dagre. Последний излом приводит к высоте цели — или оставляет
 * ребро на своей высоте, если разница не больше ROUTE_SNAP: тогда стрелка
 * входит в карточку чуть выше или ниже середины, без ступеньки. Излом, который
 * уводит дальше ROUTE_SNAP от хэндла цели, считается устаревшим, и путь
 * доводится до хэндла.
 */
export function routedPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  turns: readonly EdgeTurn[],
): { path: string; labelX: number; labelY: number } {
  const points: [number, number][] = [[sourceX, sourceY]];
  let y = sourceY;
  turns.forEach((turn, index) => {
    const last = index === turns.length - 1;
    const nextY = last && Math.abs(turn.y - targetY) > ROUTE_SNAP_PX ? targetY : turn.y;
    points.push([turn.x, y], [turn.x, nextY]);
    y = nextY;
  });
  points.push([targetX, y]);
  const distinct = points.filter(
    (point, index) =>
      index === 0 || point[0] !== points[index - 1]?.[0] || point[1] !== points[index - 1]?.[1],
  );
  // Точка посреди прямого участка — не угол: скругление на ней дало бы
  // вырожденную кривую и лишний узел пути.
  const compact = distinct.filter((point, index) => {
    const previous = distinct[index - 1];
    const next = distinct[index + 1];
    if (previous === undefined || next === undefined) {
      return true;
    }
    const horizontal = previous[1] === point[1] && point[1] === next[1];
    const vertical = previous[0] === point[0] && point[0] === next[0];
    return !horizontal && !vertical;
  });

  const parts = [`M ${compact[0]?.[0] ?? sourceX} ${compact[0]?.[1] ?? sourceY}`];
  for (let index = 1; index < compact.length; index += 1) {
    const [x, y1] = compact[index] ?? [targetX, targetY];
    const previous = compact[index - 1] ?? [x, y1];
    const next = compact[index + 1];
    if (next === undefined) {
      parts.push(`L ${x} ${y1}`);
      continue;
    }
    const inLength = Math.hypot(x - previous[0], y1 - previous[1]);
    const outLength = Math.hypot(next[0] - x, next[1] - y1);
    const radius = Math.min(EDGE_BORDER_RADIUS, inLength / 2, outLength / 2);
    const beforeX = x - Math.sign(x - previous[0]) * radius;
    const beforeY = y1 - Math.sign(y1 - previous[1]) * radius;
    const afterX = x + Math.sign(next[0] - x) * radius;
    const afterY = y1 + Math.sign(next[1] - y1) * radius;
    parts.push(`L ${beforeX} ${beforeY}`, `Q ${x} ${y1} ${afterX} ${afterY}`);
  }
  const middle = compact[Math.floor((compact.length - 1) / 2)] ?? [sourceX, sourceY];
  const after = compact[Math.floor((compact.length - 1) / 2) + 1] ?? middle;
  return {
    path: parts.join(' '),
    labelX: (middle[0] + after[0]) / 2,
    labelY: (middle[1] + after[1]) / 2,
  };
}
