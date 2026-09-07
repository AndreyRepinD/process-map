// Добавление блока на экране этапа (решение владельца от 07.09.2026).
//
// ПОЧЕМУ В ТУЛБАРЕ, А НЕ НА ПОЛОТНЕ. Кнопка на полотне должна была бы куда-то
// встать: React Flow рисует узлы по координатам, свободного места на схеме нет,
// а плавающая кнопка перекрыла бы карточки — ровно тот дефект, который уже
// ловили с легендой (process-map-6ja) и ловим сейчас с тулбаром на карте DP.
//
// ПОЧЕМУ ТРИ КНОПКИ, А НЕ ОДНА С ВЫБОРОМ. Тип узла решает, в какую колонку он
// попадёт: шаг — в поток, вход — слева, выход — справа. Спрашивать это вторым
// шагом значило бы завести диалог, которых в приложении нет вовсе.
import { addNode } from '../../data/loader';
import { commitOverrides, useProcessMap } from '../../hooks/useProcessMap';
import { ru } from '../../i18n/ru';
import { useProcessStore } from '../../store/useProcessStore';
import type { AddedNode } from '../../data/schema';
import styles from './EditorActions.module.css';

export function AddBlockActions() {
  const selectNode = useProcessStore((state) => state.selectNode);
  const currentStageId = useProcessStore((state) => state.currentStageId);
  const map = useProcessMap();
  const stage = map.stages.find((candidate) => candidate.id === currentStageId);

  // На обзоре добавлять некуда: там карточки этапов, а не узлы.
  if (stage === undefined) {
    return null;
  }
  const stageNumber = stage.number;

  const add = (draft: Omit<AddedNode, 'stage'>): void => {
    let created = '';
    commitOverrides(() => {
      created = addNode({ ...draft, stage: stageNumber }, ru.nodeEditor.addDefaultLabel);
    });
    // Панель открывается сразу: блок создан с подписью-заглушкой, и первое, что
    // с ним нужно сделать, — переименовать. Без этого пользователь ищет новую
    // карточку глазами среди десятка соседних.
    if (created !== '') {
      selectNode(created);
    }
  };

  return (
    <div className={styles.group}>
      <button type="button" className={styles.button} onClick={() => add({ type: 'step' })}>
        {ru.nodeEditor.addStep}
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => add({ type: 'data', direction: 'in' })}
      >
        {ru.nodeEditor.addInput}
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => add({ type: 'data', direction: 'out' })}
      >
        {ru.nodeEditor.addOutput}
      </button>
    </div>
  );
}
