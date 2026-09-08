// Маркеры изменения размера карточки — общая деталь StepNode и DataNode.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ КОМПОНЕНТ. NodeResizer из @xyflow/react рисуется ВНУТРИ узла,
// то есть в каждом компоненте узла отдельно. Вторая копия условий («только в
// редакторе», минимумы, запись правки) разошлась бы с первой при первой же
// правке — и разошлась бы молча, потому что обе остались бы рабочими.
//
// ПОЧЕМУ МИНИМУМЫ ЗАДАНЫ ЗДЕСЬ И В СХЕМЕ ОДНОВРЕМЕННО. Здесь — чтобы карточку
// нельзя было схлопнуть жестом; в схеме (src/data/schema.ts) — чтобы этого
// нельзя было сделать импортом чужого JSON. Границы одни и те же, и разойтись
// им нельзя: значения берутся из одной константы.
import { NodeResizer } from '@xyflow/react';
import { resizeNode } from '../../data/loader';
import { commitOverrides } from '../../hooks/useProcessMap';
import { ru } from '../../i18n/ru';
import { useProcessStore } from '../../store/useProcessStore';

/** Минимальный габарит карточки. Совпадает со схемой (ProcessNodeSchema.size). */
export const MIN_NODE_SIZE = { width: 80, height: 28 } as const;

export interface NodeResizeHandlesProps {
  nodeId: string;
}

export function NodeResizeHandles({ nodeId }: NodeResizeHandlesProps) {
  const editable = useProcessStore((state) => state.mode === 'edit');

  return (
    <NodeResizer
      isVisible={editable}
      minWidth={MIN_NODE_SIZE.width}
      minHeight={MIN_NODE_SIZE.height}
      // Запись — по КОНЦУ жеста, а не по каждому кадру: иначе в localStorage
      // уходили бы десятки промежуточных габаритов за одно перетаскивание.
      onResizeEnd={(_, params) => {
        commitOverrides(() =>
          resizeNode(nodeId, {
            width: Math.round(params.width),
            height: Math.round(params.height),
          }),
        );
      }}
      lineClassName="pm-resize-line"
      handleClassName="pm-resize-handle"
      aria-label={ru.nodeEditor.resize}
    />
  );
}
