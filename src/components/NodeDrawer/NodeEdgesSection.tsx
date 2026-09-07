// Связи узла: показать, провести, снять (решение владельца от 07.09.2026).
//
// ПОЧЕМУ СПИСКОМ В ПАНЕЛИ, А НЕ ПЕРЕТАСКИВАНИЕМ ЗА ХЭНДЛЫ. Соединение мышью
// требует включить nodesConnectable у React Flow и раздать хэндлы всем типам
// узлов, а правило проекта прямо говорит: узлы не перетаскиваются и не
// соединяются (CLAUDE.md). Список даёт то же самое, работает с клавиатуры и не
// трогает раскладку — а перетаскивание можно добавить сверху потом.
//
// ТОЛЬКО ИСХОДЯЩИЕ СВЯЗИ И ТОЛЬКО ВНУТРИ ЭТАПА. Ребро хранится на
// узле-источнике (schema.ts), поэтому «ведёт к» — естественная форма. Межэтапные
// связи на обзоре выводятся из потока шагов, руками их не проводят.
import { useState } from 'react';
import { connectNodes, disconnectNodes } from '../../data/loader';
import type { ProcessNode, Stage } from '../../data/schema';
import { commitOverrides } from '../../hooks/useProcessMap';
import { ru } from '../../i18n/ru';
import { Section } from './Section';
import styles from './NodeDrawer.module.css';

export interface NodeEdgesSectionProps {
  node: ProcessNode;
  stage: Stage;
}

export function NodeEdgesSection({ node, stage }: NodeEdgesSectionProps) {
  const [target, setTarget] = useState('');

  const outgoing = stage.edges.filter((edge) => edge.source === node.id);
  const connected = new Set(outgoing.map((edge) => edge.target));
  const labelOf = new Map(stage.nodes.map((item) => [item.id, item.label]));
  const candidates = stage.nodes.filter((item) => item.id !== node.id && !connected.has(item.id));

  return (
    <Section title={ru.nodeEditor.edges}>
      {outgoing.length === 0 ? (
        <span className={styles.fieldValue}>{ru.nodeEditor.edgesEmpty}</span>
      ) : (
        <ul className={styles.edgeList}>
          {outgoing.map((edge) => (
            <li className={styles.edgeItem} key={edge.id}>
              <span className={styles.edgeLabel}>{labelOf.get(edge.target) ?? edge.target}</span>
              <button
                type="button"
                className={styles.edgeRemove}
                onClick={() => {
                  commitOverrides(() => disconnectNodes(node.id, edge.target));
                }}
              >
                {ru.nodeEditor.edgeRemove}
              </button>
            </li>
          ))}
        </ul>
      )}

      {candidates.length === 0 ? (
        <span className={styles.fieldValue}>{ru.nodeEditor.edgeNoTargets}</span>
      ) : (
        <div className={styles.edgeAdd}>
          <label className={styles.formLabel}>
            {ru.nodeEditor.edgeTarget}
            <select
              className={styles.formInput}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">—</option>
              {candidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.formPrimary}
            disabled={target === ''}
            onClick={() => {
              commitOverrides(() => connectNodes(node.id, target));
              setTarget('');
            }}
          >
            {ru.nodeEditor.edgeConnect}
          </button>
        </div>
      )}
    </Section>
  );
}
