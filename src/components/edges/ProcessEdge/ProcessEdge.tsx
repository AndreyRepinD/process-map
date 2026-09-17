// Рёбра потока: фиолетовое 1.8 px и серое 1.4 px, оба smoothstep.
//
// ДВА ТИПА НА ОДНУ ГЕОМЕТРИЮ (process-map-fxg). На уровне 1 фиолетовым идёт
// весь поток этап → этап (SPEC §4.1). На уровне 2 артборд A2 красит фиолетовым
// ТОЛЬКО переход между группами шагов, а поток внутри группы — серым: так
// структура процесса читается цветом, а не только рамками. Тип выбирается в
// stageGraph.ts сравнением node.group у концов ребра.
//
// Тип, а не проп в data, — по тому же соображению, что у `lane` / `flowLane` и
// `step` / `integration`: React Flow кладёт тип в класс `.react-flow__edge-<type>`,
// и общий тип слил бы два вида рёбер в один счётчик в тестах.
import { BaseEdge, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';
import { EdgeLabel } from '../EdgeLabel';
import { EDGE_BORDER_RADIUS, routedPath, type EdgeTurn } from '../edgeGeometry';
import { useEdgeMarkers } from '../edgeMarkerContext';
import styles from '../edges.module.css';

export type ProcessEdgeType = Edge<Record<string, unknown>, 'process'>;

/** Ребро внутри группы шагов, уровень 2 (SPEC §4.2, артборд A2). */
export type ProcessInnerEdgeType = Edge<Record<string, unknown>, 'processInner'>;

/**
 * Путь и точка подписи.
 *
 * `getSmoothStepPath` отдаёт `labelX`/`labelY` третьим и четвёртым значением —
 * раньше они выбрасывались, и поле `label` из схемы не рисовалось ничем
 * (process-map-70e.6).
 */
function isTurnList(value: unknown): value is EdgeTurn[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { x?: unknown }).x === 'number' &&
        typeof (item as { y?: unknown }).y === 'number',
    )
  );
}

function smoothStepPathOf({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
}: Pick<
  EdgeProps<ProcessEdgeType>,
  'sourceX' | 'sourceY' | 'sourcePosition' | 'targetX' | 'targetY' | 'targetPosition' | 'data'
>): { path: string; labelX: number; labelY: number } {
  // Ребро этапа идёт по маршруту раскладки (stageGraph.ts::stageRoutes): у
  // длинного ребра излом посередине пути пришёлся бы на чужую колонку.
  const route: unknown = data?.route;
  if (isTurnList(route)) {
    return routedPath(sourceX, sourceY, targetX, targetY, route);
  }
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: EDGE_BORDER_RADIUS,
  });
  return { path, labelX, labelY };
}

export function ProcessEdge(props: EdgeProps<ProcessEdgeType>) {
  const markers = useEdgeMarkers();
  const { path, labelX, labelY } = smoothStepPathOf(props);

  return (
    <>
      <BaseEdge path={path} className={styles.process} markerEnd={`url(#${markers.process})`} />
      <EdgeLabel label={props.label} x={labelX} y={labelY} />
    </>
  );
}

export function ProcessInnerEdge(props: EdgeProps<ProcessInnerEdgeType>) {
  const markers = useEdgeMarkers();
  const { path, labelX, labelY } = smoothStepPathOf(props);

  return (
    <>
      <BaseEdge
        path={path}
        className={styles.processInner}
        markerEnd={`url(#${markers.processInner})`}
      />
      <EdgeLabel label={props.label} x={labelX} y={labelY} />
    </>
  );
}
