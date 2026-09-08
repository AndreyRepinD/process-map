// Узел внешней системы (свимлейны уровня 1, SPEC §4.1 / §3 ExternalIO).
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { SystemCode } from '../../../data/schema';
import { ru } from '../../../i18n/ru';
import { useProcessStore } from '../../../store/useProcessStore';
import styles from './IntegrationNode.module.css';

export interface IntegrationNodeData extends Record<string, unknown> {
  system: SystemCode;
  /**
   * Компактный режим (SPEC §4.5, артборд A4): одна карточка на этап собирает
   * ВСЕ его системы, и в шапке карточки стоит список кодов «IO · ERP», а не
   * один код. Поле необязательное — в обычном режиме карточка по-прежнему про
   * одну систему и показывает `system`.
   */
  codes?: SystemCode[];
  /** Короткая подпись, видимая в карточке. */
  label: string;
  /** Полный список исходных ExternalIO.label — уходит в title (подсказку). */
  fullLabel: string;
  /** 'in' — система-источник (хэндл снизу), 'out' — приёмник (хэндл сверху). */
  direction: 'in' | 'out';
  /** Компактный режим: карточка шире (по ширине карточки этапа), см. A4. */
  compact?: boolean;
  /**
   * id карточки этапа, стоящей за этой подписью (overviewGraph::externalIoNodeId).
   *
   * Нужен, чтобы внешнюю карточку можно было править и с обзора, а не только с
   * экрана этапа (решение владельца 08.09.2026: «внешние карточки я тоже хочу
   * править… и снаружи»). undefined — сводная карточка компактного режима: за
   * ней стоит несколько записей, однозначного адреса у неё нет, и кнопкой она
   * не становится.
   */
  nodeId?: string;
}

export type IntegrationNodeType = Node<IntegrationNodeData, 'system'>;

export const SYSTEM_HANDLE = {
  /** Источник интеграционного ребра: система → этап. */
  bottom: 'bottom',
  /** Приёмник интеграционного ребра: этап → система. */
  top: 'top',
} as const;

export function IntegrationNode({ data }: NodeProps<IntegrationNodeType>) {
  const editable = useProcessStore((state) => state.mode === 'edit');
  const selectNode = useProcessStore((state) => state.selectNode);
  const codeText = (data.codes ?? [data.system]).join(' · ');

  /*
   * Подпись, дословно повторяющая код системы, — не подпись: карточка входа
   * ERP этапа 2 рисовалась на проде как «ERP ERP» (process-map-2od).
   *
   * Так вышло из презентации: бокс [49] слайда 2 содержит одно слово «ERP», а
   * import-pptx.py кладёт текст фигуры в label как есть. Что на самом деле
   * идёт из ERP в этап 2, в презентации не сказано вовсе (process-map-vjz.4).
   * Гипотеза про «потерянный текстбокс [131]» опровергнута задачей
   * process-map-qjl: [131] принадлежит входу из IO — его связь доказана
   * коннектором [144] с расстоянием 0, тогда как до ближайшей альтернативы
   * 166 тысяч EMU.
   * До ответа владельца дубль просто не показывается: додумывать содержание
   * процесса запрещено (CLAUDE.md), а показывать код дважды — хуже, чем один
   * раз. Правка живёт здесь, а не в process.json, потому что inputs/outputs
   * пересобираются импортёром с нуля и правка данных умерла бы на первом же
   * `npm run data`.
   */
  const showLabel =
    data.label.trim() !== '' && data.label.trim() !== codeText && data.label.trim() !== data.system;

  /** Подсказка не нужна, если в ней тот же код, что и в самой карточке. */
  const tooltip =
    data.fullLabel.trim() !== '' &&
    data.fullLabel.trim() !== codeText &&
    data.fullLabel.trim() !== data.system
      ? data.fullLabel
      : undefined;

  return (
    <>
      {data.direction === 'out' && (
        <Handle
          type="target"
          position={Position.Top}
          id={SYSTEM_HANDLE.top}
          isConnectable={false}
        />
      )}
      {/* В редакторе карточка — КНОПКА: она открывает ту же панель правки, что и
          на экране этапа, потому что правит тот же самый узел. В просмотре
          остаётся неинтерактивным div: читателю вики жать не на что. */}
      {editable && data.nodeId !== undefined ? (
        <button
          type="button"
          className={data.compact === true ? `${styles.card} ${styles.compact}` : styles.card}
          title={tooltip}
          aria-label={ru.overview.editExternal(data.label.trim() === '' ? codeText : data.label)}
          onClick={() => {
            selectNode(data.nodeId ?? '');
          }}
        >
          <span className={styles.code}>{codeText}</span>
          {showLabel && <span className={styles.label}>{data.label}</span>}
        </button>
      ) : (
        <div
          className={data.compact === true ? `${styles.card} ${styles.compact}` : styles.card}
          title={tooltip}
        >
          <span className={styles.code}>{codeText}</span>
          {showLabel && <span className={styles.label}>{data.label}</span>}
        </div>
      )}
      {data.direction === 'in' && (
        <Handle
          type="source"
          position={Position.Bottom}
          id={SYSTEM_HANDLE.bottom}
          isConnectable={false}
        />
      )}
    </>
  );
}
