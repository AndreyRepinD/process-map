// Узел React Flow для карточки шага уровня 2 (SPEC §4.2).
// Вся вёрстка — в StepCard; здесь только точки подключения рёбер.
//
// Этим же компонентом рисуются узлы типа `integration` (variant в data):
// имя IntegrationNode уже занято карточкой внешней системы уровня 1
// (свимлейны A1), а раскладка (scripts/layout.ts::NODE_SIZE) трактует
// integration как карточку шага того же размера 318×52.
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { ProcessNode } from '../../../data/schema';
import { NodeResizeHandles } from '../NodeResizeHandles';
import { StepCard, type StepCardVariant } from './StepCard';

export interface StepNodeData extends Record<string, unknown> {
  node: ProcessNode;
  variant: StepCardVariant;
}

export type StepNodeType = Node<StepNodeData, 'step'>;

/**
 * Интеграция рисуется тем же компонентом, но отдельным типом узла
 * (process-map-73m, process-map-e21). Причина та же, что у пары
 * `lane` / `flowLane` уровня 1: React Flow кладёт тип в класс
 * `.react-flow__node-<type>`, и общий тип означал бы, что
 * `.react-flow__node-step` выбирает «шаг ИЛИ интеграцию». Это уже дважды
 * подставило — первый в DOM `.react-flow__node-step` на этапе 2 оказывался
 * интеграцией, и любая проверка «в кадре виден процесс» засчитывала её за шаг.
 * Разница видом не ограничивается: интеграции пропадают по toggle тулбара, шаги — нет.
 */
export type IntegrationNodeType = Node<StepNodeData, 'integration'>;

/**
 * Типы, приходящие из BPMN (process-map-70e.7). Тот же компонент и тот же
 * размер карточки, но отдельные типы React Flow — по той же причине, что у
 * интеграции: тип попадает в класс `.react-flow__node-<type>`, и без него
 * проверка «в кадре видно шаг» засчитывала бы шлюз за шаг, а e2e не смог бы
 * отличить одно от другого. Разница не только в виде: адаптер BPMN считает их
 * раздельно в отчёте о плотности отображения.
 */
export type GatewayNodeType = Node<StepNodeData, 'gateway'>;
export type EventNodeType = Node<StepNodeData, 'event'>;
export type SubprocessNodeType = Node<StepNodeData, 'subprocess'>;

/**
 * Идентификаторы хэндлов узлов потока — используются в stageGraph.ts.
 * Раскладка dagre идёт слева направо (rankdir LR), поэтому основная пара —
 * right → left; bottom → top остаётся для редких обратных рёбер.
 */
export const STEP_HANDLE = {
  left: 'left',
  right: 'right',
  top: 'top',
  bottom: 'bottom',
} as const;

/** Общие для StepNode и WarningNode хэндлы: цели слева/сверху, источники справа/снизу. */
export function StepHandles() {
  return (
    <>
      <Handle type="target" position={Position.Left} id={STEP_HANDLE.left} isConnectable={false} />
      <Handle type="target" position={Position.Top} id={STEP_HANDLE.top} isConnectable={false} />
      <Handle
        type="source"
        position={Position.Right}
        id={STEP_HANDLE.right}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id={STEP_HANDLE.bottom}
        isConnectable={false}
      />
    </>
  );
}

export function StepNode({ data }: NodeProps<StepNodeType>) {
  return (
    <>
      <NodeResizeHandles nodeId={data.node.id} />
      <StepHandles />
      <StepCard node={data.node} variant={data.variant} />
    </>
  );
}
