// Секция «Алгоритмы в платформе» боковой панели узла (process-map-trt).
//
// ЧЕМ ОНА ОТЛИЧАЕТСЯ ОТ ССЫЛКИ НА ЭКРАН, и почему это не та же самая секция:
//
//   · У экрана свой адрес, у алгоритма — нет. Платформа не даёт адреса на
//     конкретный алгоритм (проверено 07.09.2026: выбор процесса в комбобоксе
//     «Менеджера процессов» не меняет ни путь, ни строку запроса). Значит
//     редактировать нечего — url один на всех, и поле ввода url было бы полем,
//     в котором один и тот же ответ набирают двадцать раз.
//   · У шага бывает НЕСКОЛЬКО алгоритмов: «Настройка параметров» в MEIO — это
//     четыре расчёта CV и усреднитель. Поэтому список, а не одно значение.
//   · Имена не выдумываются, а выбираются: реестр снят со стенда
//     (src/data/algorithms.ts). Свободный ввод дал бы имя, которого в платформе
//     нет, и такая привязка молча указывала бы в никуда.
//
// Отсюда форма: не поля ввода, а перечень флажков по реестру своего модуля.
// Карта без реестра (snp, mrp) секцию не показывает вовсе — предлагать
// планировщику SNP имена MEIO значило бы подсказать заведомо неверную привязку.
import { useEffect, useState } from 'react';
import { iconUrl } from '../../assets/icons';
import { PROCESS_MANAGER_URL } from '../../data/algorithms';
import { setNodeAlgorithms } from '../../data/loader';
import type { ProcessNode } from '../../data/schema';
import { commitOverrides } from '../../hooks/useProcessMap';
import { ru } from '../../i18n/ru';
import { useProcessStore } from '../../store/useProcessStore';
import { Section } from './Section';
import styles from './AlgorithmSection.module.css';

const LINK_EXTERNAL_ICON = iconUrl('link-external');

export interface AlgorithmSectionProps {
  node: ProcessNode;
  /** Реестр алгоритмов своего модуля. Пустой — секции нет. */
  registry: readonly string[];
}

export function AlgorithmSection({ node, registry }: AlgorithmSectionProps) {
  const mode = useProcessStore((state) => state.mode);
  const openEmbedded = useProcessStore((state) => state.openEmbedded);
  const editable = mode === 'edit';
  const [editing, setEditing] = useState(false);
  const selected = node.algorithms ?? [];

  // Выход из редактора закрывает открытый перечень — тот же довод, что у
  // ScreenLinkSection: в режиме «Просмотр» на панели не должно остаться
  // флажков, которые ничего не переключают.
  useEffect(() => {
    if (!editable) {
      setEditing(false);
    }
  }, [editable]);

  if (registry.length === 0) {
    return null;
  }

  const toggle = (name: string): void => {
    const next = selected.includes(name)
      ? selected.filter((item) => item !== name)
      : // Порядок реестра, а не порядок кликов: иначе один и тот же набор
        // алгоритмов у двух узлов выглядел бы разным списком.
        registry.filter((item) => item === name || selected.includes(item));
    // Пустой список и «привязки нет» — одно и то же состояние; двумя способами
    // его записывать нельзя, иначе они разойдутся при первом же сравнении.
    commitOverrides(() => setNodeAlgorithms(node.id, next.length > 0 ? [...next] : null));
  };

  return (
    <Section title={ru.drawer.algorithmSection}>
      {selected.length === 0 ? (
        <p className={styles.empty}>{ru.drawer.algorithmEmpty}</p>
      ) : (
        <ul className={styles.list}>
          {selected.map((name) => (
            <li className={styles.item} key={name}>
              {name}
            </li>
          ))}
        </ul>
      )}

      {/* Кнопка ведёт на экран Менеджера процессов целиком: адреса на отдельный
          алгоритм у платформы нет. Строка рядом говорит об этом прямо — иначе
          одинаковый переход у десяти узлов читался бы как ошибка привязки. */}
      {selected.length > 0 && (
        <button
          type="button"
          className={styles.open}
          // Рядом с картой, а не новой вкладкой (решение владельца 08.09.2026):
          // алгоритм в Менеджере процессов ищут, сверяясь с блоком на карте, и
          // в разных окнах это сверка вслепую. Заголовок панели — имя первого
          // привязанного алгоритма: искать в комбобоксе всё равно по нему.
          onClick={() => {
            openEmbedded(PROCESS_MANAGER_URL, selected[0] ?? ru.drawer.algorithmOpen);
          }}
        >
          <img className={styles.icon} src={LINK_EXTERNAL_ICON} alt="" />
          {ru.drawer.algorithmOpen}
        </button>
      )}
      {selected.length > 0 && <p className={styles.note}>{ru.drawer.algorithmNote}</p>}

      {editable && !editing && (
        <button
          type="button"
          className={styles.action}
          // Доступное имя с названием секции — по той же причине, что и в
          // ScreenLinkSection: подпись «Добавить» на панели встречается дважды.
          aria-label={ru.drawer.linkActionAria(
            selected.length === 0 ? ru.drawer.screenAdd : ru.drawer.screenEdit,
            ru.drawer.algorithmSection,
          )}
          onClick={() => {
            setEditing(true);
          }}
        >
          {selected.length === 0 ? ru.drawer.screenAdd : ru.drawer.screenEdit}
        </button>
      )}

      {editable && editing && (
        <fieldset className={styles.picker}>
          <legend className={styles.legend}>{ru.drawer.algorithmPick(registry.length)}</legend>
          {registry.map((name) => (
            <label className={styles.option} key={name}>
              <input
                type="checkbox"
                checked={selected.includes(name)}
                onChange={() => {
                  toggle(name);
                }}
              />
              <span className={styles.optionText}>{name}</span>
            </label>
          ))}
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              setEditing(false);
            }}
          >
            {ru.drawer.algorithmDone}
          </button>
        </fieldset>
      )}
    </Section>
  );
}
