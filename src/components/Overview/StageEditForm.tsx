// Правка карточки этапа на обзоре (решение владельца 08.09.2026).
//
// ЗАЧЕМ ОТДЕЛЬНАЯ ФОРМА, А НЕ ПАНЕЛЬ УЗЛА. У этапа свои поля: заголовок,
// короткое название и ключевые выходы. Панель узла правит подпись, описание,
// входы, выходы, ответственного, систему и группу — ни одно из них у этапа не
// существует. Общая форма означала бы восемь полей, из которых пять всегда
// пусты, и ни одного из трёх нужных.
//
// ПОЧЕМУ КОРОТКОЕ НАЗВАНИЕ ОТДЕЛЬНЫМ ПОЛЕМ. Карточка обзора фиксирована по
// SPEC §4.1 и показывает shortTitle: полные названия в неё не влезают и
// срезаются многоточием. Полное живёт в подсказке и в крошках. Свести их в одно
// поле значило бы либо обрезанную карточку, либо потерянное полное название.
import { useState } from 'react';
import { patchStage } from '../../data/loader';
import type { Stage } from '../../data/schema';
import { commitOverrides } from '../../hooks/useProcessMap';
import { ru } from '../../i18n/ru';
import { useProcessStore } from '../../store/useProcessStore';
import styles from './StageEditForm.module.css';

/** Ключевых выходов на карточке не больше четырёх — ограничение схемы. */
const MAX_KEY_OUTPUTS = 4;

export interface StageEditFormProps {
  stage: Stage;
}

export function StageEditForm({ stage }: StageEditFormProps) {
  const close = useProcessStore((state) => state.closeStageEditor);
  const [title, setTitle] = useState(stage.title);
  const [shortTitle, setShortTitle] = useState(stage.shortTitle);
  const [outputs, setOutputs] = useState(stage.keyOutputs.join('\n'));
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const nextTitle = title.trim();
    const nextShort = shortTitle.trim();
    if (nextTitle === '' || nextShort === '') {
      // Оба названия обязательны по схеме, и безымянная карточка на обзоре хуже
      // неправленой: по ней не найти этап ни глазами, ни скринридером.
      setError(ru.stageEditor.titleEmpty);
      return;
    }
    const nextOutputs = outputs
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .slice(0, MAX_KEY_OUTPUTS);

    commitOverrides(() =>
      patchStage(stage.id, {
        title: nextTitle,
        shortTitle: nextShort,
        keyOutputs: nextOutputs,
      }),
    );
    close();
  };

  return (
    <aside className={styles.panel} role="dialog" aria-label={ru.stageEditor.title}>
      <header className={styles.header}>
        <h2 className={styles.heading}>{ru.stageEditor.title}</h2>
        <button type="button" className={styles.close} onClick={close} aria-label={ru.drawer.close}>
          ×
        </button>
      </header>

      <form className={styles.form} onSubmit={submit}>
        <label className={styles.label}>
          {ru.stageEditor.titleField}
          <input
            className={styles.input}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setError(null);
            }}
          />
        </label>
        <label className={styles.label}>
          {ru.stageEditor.shortTitleField}
          <input
            className={styles.input}
            value={shortTitle}
            onChange={(event) => {
              setShortTitle(event.target.value);
              setError(null);
            }}
          />
          <span className={styles.hint}>{ru.stageEditor.shortTitleHint}</span>
        </label>
        <label className={styles.label}>
          {ru.stageEditor.keyOutputsField}
          <textarea
            className={styles.area}
            rows={4}
            value={outputs}
            onChange={(event) => {
              setOutputs(event.target.value);
            }}
          />
          <span className={styles.hint}>{ru.stageEditor.keyOutputsHint(MAX_KEY_OUTPUTS)}</span>
        </label>
        {error !== null && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button type="submit" className={styles.primary}>
            {ru.nodeEditor.save}
          </button>
          <button type="button" className={styles.ghost} onClick={close}>
            {ru.nodeEditor.cancel}
          </button>
        </div>
      </form>
    </aside>
  );
}
