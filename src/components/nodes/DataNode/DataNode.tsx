// Узел данных колонок входов/выходов, уровень 2 (SPEC §4.2, артборд A2 200×56).
//
// Подпись-источник (вторая строка макета: «ERP», «Этап 1», «В PS · этап 3»)
// берётся из node.system и показывается ТОЛЬКО когда система задана. В текущем
// process.json ни у одного data-узла нет ни system, ни owner — сочинять текст
// для 56 узлов нельзя (CLAUDE.md «Не изобретать процесс»), поэтому карточка в
// этом случае показывает один заголовок по центру. Заполнение источников —
// вопрос к данным, не к экрану.
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { ProcessNode } from '../../../data/schema';
import { ru } from '../../../i18n/ru';
import { useProcessStore } from '../../../store/useProcessStore';
import { NodeResizeHandles } from '../NodeResizeHandles';
import styles from './DataNode.module.css';

export interface DataNodeData extends Record<string, unknown> {
  node: ProcessNode;
}

export type DataNodeType = Node<DataNodeData, 'data'>;

/**
 * Хэндлы карточки данных — ЧЕТЫРЕ, как у карточки шага.
 *
 * Раскладка адресует концы ребра по именам STEP_HANDLE независимо от типа узла
 * (stageGraph.ts): вперёд — right→left, назад — bottom→top. Пока у карточки
 * данных были объявлены только left и right, ребро «назад» просило хэндлы
 * bottom/top, которых у неё нет, и НЕ РИСОВАЛОСЬ ВОВСЕ — молча, без ошибки в
 * консоли. Владелец 08.09.2026: «от серых квадратов не рисуются стрелочки».
 *
 * Имена совпадают со STEP_HANDLE намеренно: их равенство проверяет
 * tests/handles.test.ts, иначе расхождение снова окажется невидимым.
 */
export const DATA_HANDLE = {
  left: 'left',
  right: 'right',
  top: 'top',
  bottom: 'bottom',
} as const;

export function DataNode({ data }: NodeProps<DataNodeType>) {
  const selectNode = useProcessStore((state) => state.selectNode);
  const node = data.node;
  const isSelected = useProcessStore((state) => state.selectedNodeId === node.id);

  return (
    <>
      <NodeResizeHandles nodeId={node.id} />
      {/* Рёбер к data-узлам в текущих данных нет (все edge.source/target —
          узлы потока), хэндлы объявлены на случай их появления. */}
      <Handle type="target" position={Position.Left} id={DATA_HANDLE.left} isConnectable={false} />
      <Handle type="target" position={Position.Top} id={DATA_HANDLE.top} isConnectable={false} />
      <button
        type="button"
        className={
          isSelected
            ? `${styles.card} ${node.system === undefined ? styles.neutral : styles.system} ${styles.selected}`
            : `${styles.card} ${node.system === undefined ? styles.neutral : styles.system}`
        }
        aria-current={isSelected ? 'true' : undefined}
        aria-label={ru.dataNode.ariaLabel(node.label)}
        title={node.description === undefined ? node.label : `${node.label}\n\n${node.description}`}
        onClick={() => {
          selectNode(node.id);
        }}
      >
        <span className={styles.label}>{node.label}</span>
        {node.system !== undefined && <span className={styles.source}>{node.system}</span>}
      </button>
      <Handle
        type="source"
        position={Position.Right}
        id={DATA_HANDLE.right}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id={DATA_HANDLE.bottom}
        isConnectable={false}
      />
    </>
  );
}
