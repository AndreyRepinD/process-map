// Форма правки содержания узла (решение владельца от 07.09.2026).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ КОМПОНЕНТ, А НЕ ПОЛЯ В ПАНЕЛИ. Панель показывает содержание,
// форма его меняет — это разные режимы одной секции, ровно как у ссылки на
// экран (ScreenLinkSection ↔ ScreenLinkForm). Держать оба состояния в одном
// компоненте значило бы ветвить каждую строку разметки.
//
// ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Координат: их считает scripts/layout.ts на сборке,
// и правка руками была бы затёрта. Рёбер: связь принадлежит этапу, а не узлу,
// и в Record<nodeId, …> её не выразить. Типа узла: смена типа меняет и вид, и
// колонку, и смысл — это не правка подписи, а другой блок.
import { useId, useState } from 'react';
import { patchNodeContent, removeNode } from '../../data/loader';
import { SystemCodeSchema, type ProcessNode, type SystemCode } from '../../data/schema';
import { ru } from '../../i18n/ru';
import { commitOverrides } from '../../hooks/useProcessMap';
import styles from './NodeDrawer.module.css';

export interface NodeContentFormProps {
  node: ProcessNode;
  onClose: () => void;
  /**
   * Группы ЭТОГО этапа парами «id — заголовок».
   *
   * Пары, а не одни заголовки: в узле лежит id, а правится подпись, и без
   * обратного перевода форма показывала бы пустое поле у карточки, которая на
   * самом деле в группе, — а сохранение молча вывело бы её из рамки.
   *
   * Подсказка списком, а не выбором: владелец должен мочь завести новую рамку,
   * набрав название, которого ещё нет. На обзоре групп нет вовсе, поэтому поле
   * там не показывается — список пуст.
   */
  groups?: readonly { id: string; label: string }[];
}

/** Коды систем из схемы: второй список разошёлся бы с первым (SystemCodeSchema). */
const SYSTEM_CODES: readonly SystemCode[] = SystemCodeSchema.options;

/**
 * Заголовок группы узла.
 *
 * В узле лежит id, а в форме правится подпись — перевод делается по списку
 * заголовков этапа. Узел без группы и группа, которой в списке нет (такого быть
 * не должно, но данные приходят и из чужих файлов), дают пустое поле.
 */
function groupLabelOf(node: ProcessNode, groups: readonly { id: string; label: string }[]): string {
  if (node.group === undefined) {
    return '';
  }
  return groups.find((group) => group.id === node.group)?.label ?? '';
}

/** Список из textarea: пустые строки отбрасываются, порядок сохраняется. */
function parseList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export function NodeContentForm({ node, onClose, groups = [] }: NodeContentFormProps) {
  const groupsId = useId();
  const [system, setSystem] = useState<string>(node.system ?? '');
  const [group, setGroup] = useState(groupLabelOf(node, groups));
  const [label, setLabel] = useState(node.label);
  const [description, setDescription] = useState(node.description ?? '');
  const [inputs, setInputs] = useState((node.inputs ?? []).join('\n'));
  const [outputs, setOutputs] = useState((node.outputs ?? []).join('\n'));
  const [owner, setOwner] = useState(node.owner ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const trimmed = label.trim();
    if (trimmed === '') {
      // Подпись обязательна по схеме, и безымянная карточка на полотне хуже
      // неправленой — поэтому пустую не сохраняем, а не сохраняем «как есть».
      setError(ru.nodeEditor.labelEmpty);
      return;
    }
    const nextInputs = parseList(inputs);
    const nextOutputs = parseList(outputs);
    const nextDescription = description.trim();
    const nextOwner = owner.trim();
    commitOverrides(() =>
      patchNodeContent(node.id, {
        label: trimmed,
        // null — «очистили явно», отличается от «не трогали» (см. schema.ts).
        description: nextDescription === '' ? null : nextDescription,
        inputs: nextInputs.length === 0 ? null : nextInputs,
        outputs: nextOutputs.length === 0 ? null : nextOutputs,
        owner: nextOwner === '' ? null : nextOwner,
        system: system === '' ? null : (system as SystemCode),
        group: group.trim() === '' ? null : group.trim(),
      }),
    );
    onClose();
  };

  const drop = (): void => {
    // Подтверждение удаления штатным диалогом браузера: правка необратима до
    // «Сбросить правки», а своего модального окна в макете нет и заводить его
    // ради одного действия незачем.
    if (!globalThis.confirm(ru.nodeEditor.removeConfirm)) {
      return;
    }
    commitOverrides(() => removeNode(node.id));
    onClose();
  };

  return (
    <form className={styles.contentForm} onSubmit={submit} aria-label={ru.nodeEditor.title}>
      <label className={styles.formLabel}>
        {ru.nodeEditor.labelField}
        <input
          className={styles.formInput}
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
            setError(null);
          }}
        />
      </label>
      {error !== null && <p className={styles.formError}>{error}</p>}

      <label className={styles.formLabel}>
        {ru.nodeEditor.descriptionField}
        <textarea
          className={styles.formArea}
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className={styles.formLabel}>
        {ru.nodeEditor.inputsField}
        <textarea
          className={styles.formArea}
          rows={3}
          value={inputs}
          onChange={(event) => setInputs(event.target.value)}
        />
      </label>
      <label className={styles.formLabel}>
        {ru.nodeEditor.outputsField}
        <textarea
          className={styles.formArea}
          rows={3}
          value={outputs}
          onChange={(event) => setOutputs(event.target.value)}
        />
      </label>
      <label className={styles.formLabel}>
        {ru.nodeEditor.ownerField}
        <input
          className={styles.formInput}
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
        />
      </label>

      <label className={styles.formLabel}>
        {ru.nodeEditor.systemField}
        <select
          className={styles.formInput}
          value={system}
          onChange={(event) => {
            setSystem(event.target.value);
          }}
        >
          <option value="">{ru.nodeEditor.systemNone}</option>
          {SYSTEM_CODES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      {/* Группы нет на обзоре: там рамок вокруг карточек не рисуют вовсе. */}
      {groups.length > 0 || node.group !== undefined ? (
        <label className={styles.formLabel}>
          {ru.nodeEditor.groupField}
          <input
            className={styles.formInput}
            list={groupsId}
            value={group}
            onChange={(event) => {
              setGroup(event.target.value);
            }}
          />
          <datalist id={groupsId}>
            {groups.map((item) => (
              <option key={item.id} value={item.label} />
            ))}
          </datalist>
          <span className={styles.formHint}>{ru.nodeEditor.groupHint}</span>
        </label>
      ) : null}

      <div className={styles.formActions}>
        <button type="submit" className={styles.formPrimary}>
          {ru.nodeEditor.save}
        </button>
        <button type="button" className={styles.formGhost} onClick={onClose}>
          {ru.nodeEditor.cancel}
        </button>
        <button type="button" className={styles.formDanger} onClick={drop}>
          {ru.nodeEditor.remove}
        </button>
      </div>
    </form>
  );
}
