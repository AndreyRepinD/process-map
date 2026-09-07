// Секция «Экран в системе» боковой панели узла (SPEC §4.3, §4.4).
//
// В process.json поле screen не заполнено НИ У ОДНОГО узла: ссылки появляются
// только через редактор (SPEC §4.4) и живут в overrides localStorage, которые
// накладывает src/data/loader.ts. Поэтому состояние «ссылка не задана» здесь —
// норма, а не крайний случай.
//
// Сама секция ничего не валидирует и ничего не пишет: форма ScreenLinkForm
// знает про validateUrl и setNodeOverride, а секция только решает, что сейчас
// показывать — строку ссылки, пустое состояние или форму.
import { useEffect, useState } from 'react';
import { iconUrl } from '../../assets/icons';
import type { ProcessNode } from '../../data/schema';
import { ru } from '../../i18n/ru';
import { useProcessStore } from '../../store/useProcessStore';
import { ScreenLinkForm } from './ScreenLinkForm';
import { Section } from './Section';
import styles from './ScreenLinkSection.module.css';

// Путь считает сборщик, а не строка в рантайме (см. src/assets/icons/index.ts).
const LINK_EXTERNAL_ICON = iconUrl('link-external');

export interface ScreenLinkSectionProps {
  node: ProcessNode;
}

export function ScreenLinkSection({ node }: ScreenLinkSectionProps) {
  const mode = useProcessStore((state) => state.mode);
  const [editing, setEditing] = useState(false);
  const screen = node.screen;
  const editable = mode === 'edit';

  // Выход из редактора (SPEC §4.4) закрывает открытую форму: иначе в режиме
  // «Просмотр» на панели остались бы поля ввода и кнопка «Сохранить».
  // Несохранённый ввод при этом теряется — ровно как при «Отмена», записи
  // в localStorage не происходит.
  useEffect(() => {
    if (!editable) {
      setEditing(false);
    }
  }, [editable]);

  const closeForm = (): void => {
    setEditing(false);
  };

  return (
    <Section title={ru.drawer.screenSection}>
      {editable && editing ? (
        <ScreenLinkForm nodeId={node.id} screen={screen} onClose={closeForm} />
      ) : screen === undefined ? (
        <div className={styles.empty}>
          <span className={styles.emptyText}>{ru.drawer.screenEmpty}</span>
          {/* SPEC §4.3: action «Добавить» — только в режиме редактора. */}
          {editable && (
            <button
              type="button"
              className={styles.add}
              /* Доступное имя с названием секции: секций-ссылок на панели две
                 («Экран в системе» и «Алгоритмы в платформе»), видимая подпись
                 действия у обеих одинаковая. Глазу их различает заголовок
                 сверху, скринридеру — ничто: он читал бы подряд две кнопки
                 «Добавить». */
              aria-label={ru.drawer.linkActionAria(ru.drawer.screenAdd, ru.drawer.screenSection)}
              onClick={() => {
                setEditing(true);
              }}
            >
              {ru.drawer.screenAdd}
            </button>
          )}
        </div>
      ) : (
        <div className={styles.link}>
          {/* title на всю строку: и заголовок, и url усекаются многоточием,
              полное значение доступно наведением. */}
          <div className={styles.row} title={ru.drawer.screenHint(screen.title, screen.url)}>
            <img className={styles.icon} src={LINK_EXTERNAL_ICON} alt="" />
            <span className={styles.title}>{screen.title}</span>
            <span className={styles.url}>{screen.url}</span>
          </div>
          {/* Ссылку нужно уметь не только добавить, но и поправить и удалить
              (SPEC §4.4); удаление — кнопка внутри формы. */}
          {editable && (
            <button
              type="button"
              className={styles.add}
              /* Доступное имя с названием секции: секций-ссылок на панели две
                 («Экран в системе» и «Алгоритмы в платформе»), видимая подпись
                 действия у обеих одинаковая. Глазу их различает заголовок
                 сверху, скринридеру — ничто: он читал бы подряд две кнопки
                 «Добавить». */
              aria-label={ru.drawer.linkActionAria(ru.drawer.screenEdit, ru.drawer.screenSection)}
              onClick={() => {
                setEditing(true);
              }}
            >
              {ru.drawer.screenEdit}
            </button>
          )}
        </div>
      )}
    </Section>
  );
}
