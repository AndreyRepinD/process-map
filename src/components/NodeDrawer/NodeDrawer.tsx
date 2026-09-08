// Боковая панель узла, уровень 2 (SPEC §4.3, артборд A3).
//
// Панель живёт ВНУТРИ .canvas экрана детализации, а не в портале body: по
// артборду A3 затемнение начинается под шапкой крошек (top:52px), а .canvas —
// ровно этот прямоугольник (position: relative). Портал потребовал бы
// пересчитывать смещение шапки в JS.
//
// Своего состояния у панели нет: открытый узел — selectedNodeId в
// useProcessStore, закрытие — closeDrawer (Esc, клик по фону, крестик).
// Подсветка выбранного узла уже реализована в самих карточках
// (StepCard.module.css/.selected, DataNode.module.css/.selected) — здесь
// только затемнение полотна.
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { iconUrl } from '../../assets/icons';
import { algorithmsForMap } from '../../data/algorithms';
import { LOADED_MAP_ID } from '../../data/loader';
import type { ProcessNode } from '../../data/schema';
import { ru } from '../../i18n/ru';
import { useProcessMap } from '../../hooks/useProcessMap';
import { useProcessStore } from '../../store/useProcessStore';
import { openScreen } from '../../utils/url';
import { descriptionParagraphs } from './descriptionParagraphs';
import { NodeContentForm } from './NodeContentForm';
import { NodeEdgesSection } from './NodeEdgesSection';
import { AlgorithmSection } from './AlgorithmSection';
import { ScreenLinkSection } from './ScreenLinkSection';
import { Section } from './Section';
import styles from './NodeDrawer.module.css';

const CLOSE_ICON = iconUrl('x-close');

/**
 * Имена алгоритмов СВОЕЙ карты — считаются один раз на модуль, а не на каждое
 * открытие панели: реестр статичен, id карты выведен из данных бандла.
 */
const ALGORITHM_REGISTRY = algorithmsForMap(LOADED_MAP_ID);

/** Что считаем фокусируемым внутри панели (для Tab-ловушки). */
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface NodeDrawerProps {
  /** Узлы текущего этапа: `stage.nodes` из уже загруженной карты (см. loader.ts). */
  nodes: ProcessNode[];
}

export function NodeDrawer({ nodes }: NodeDrawerProps) {
  const selectedNodeId = useProcessStore((state) => state.selectedNodeId);
  const closeDrawer = useProcessStore((state) => state.closeDrawer);

  const node = nodes.find((candidate) => candidate.id === selectedNodeId);

  // Drawer закрыт либо выбранного узла нет среди узлов этапа (рассинхрон
  // deep-link, SPEC §4.7) — панель не рисуем. Ключ по id: смена узла должна
  // перемонтировать панель, чтобы заново отработали фокус и прокрутка.
  if (node === undefined) {
    return null;
  }

  return <NodeDrawerPanel key={node.id} node={node} onClose={closeDrawer} />;
}

interface NodeDrawerPanelProps {
  node: ProcessNode;
  onClose: () => void;
}

function NodeDrawerPanel({ node, onClose }: NodeDrawerPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const mode = useProcessStore((state) => state.mode);
  const currentStageId = useProcessStore((state) => state.currentStageId);
  const map = useProcessMap();
  const stage = map.stages.find((candidate) => candidate.id === currentStageId);
  const [editingContent, setEditingContent] = useState(false);

  // Выход из редактора закрывает форму — иначе в режиме «Просмотр» на панели
  // остались бы поля ввода. Тот же довод, что у ScreenLinkSection.
  useEffect(() => {
    if (mode !== 'edit') {
      setEditingContent(false);
    }
  }, [mode]);

  const paragraphs = useMemo(() => descriptionParagraphs(node.description), [node.description]);
  const hasDescription = paragraphs.length > 0;
  const screen = node.screen;

  const nodeId = node.id;

  // Фокус: при открытии — на саму панель (скринридер прочитает имя диалога,
  // а не «кнопка Закрыть»), при закрытии — обратно на карточку узла.
  // Регрессия M1: без этого до первого элемента панели было 18 нажатий Tab.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();

    return () => {
      // Карточка узла остаётся в DOM (её рисует React Flow), поэтому фокус
      // возвращается именно на неё; `opener` — запасной вариант, если узел
      // исчез вместе с этапом. id узлов — kebab-case (SPEC §3), кавычек и
      // спецсимволов в них нет, селектор безопасен.
      const card = document.querySelector<HTMLElement>(`[data-id="${nodeId}"] button`);
      (card ?? opener)?.focus();
    };
  }, [nodeId]);

  // Esc слушаем на документе, а не на панели: если фокус по какой-то причине
  // ушёл наружу, Esc обязан закрывать панель всё равно (SPEC §4.3).
  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Ловушка Tab: пока панель открыта, обход не должен уходить на крошки и
  // полотно за её пределами. С process-map-9ji это второй рубеж — соседей
  // помечает `inert` (StageDetail.tsx), — но не лишний: `inert` снимает с
  // обхода полотно, крошки и легенду, а тулбар остаётся живым намеренно, и
  // ловушка держит фокус в панели именно от него.
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') {
      return;
    }
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) {
      // Фокусируемых элементов нет вовсе — держим фокус на самой панели.
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey) {
      // Shift+Tab с первого элемента (или с самой панели) — на последний.
      if (active === first || active === panel) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <>
      {/* Клик по затемнённому полотну закрывает панель (SPEC §4.3). Элемент
          не интерактивный для скринридера: то же действие даёт и Esc, и
          кнопка «Закрыть» в шапке. */}
      <div
        className={styles.scrim}
        data-testid="drawer-scrim"
        aria-hidden="true"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        /* aria-modal НЕ ставим (process-map-9ji): панель немодальна по замыслу —
           тулбар при ней остаётся рабочим и лишь сдвигается (.shifted в
           Toolbar.module.css), а e2e/journey.spec.ts переключает интеграции с
           открытой панелью. aria-modal="true" утверждал бы, что всё остальное
           недоступно, и это была бы неправда. Недоступным помечено ровно то,
           что недоступно, — атрибутом `inert` в StageDetail.tsx. */
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className={styles.header}>
          <h2 className={styles.title} id={titleId} title={node.label}>
            {node.label}
          </h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={ru.drawer.close}
            title={ru.drawer.close}
          >
            <img className={styles.closeIcon} src={CLOSE_ICON} alt="" />
          </button>
        </header>

        {/* Порядок секций — строго по SPEC §4.3: описание → Экран в системе →
            Входы → Выходы → Система/модуль → Ответственный. Секции без данных
            не рендерятся вовсе (в process.json inputs/owner не заполнены ни у
            одного узла, outputs — у 23, system — у 8): пустой заголовок ничего
            не сообщает, а только удлиняет панель. Исключение — «Экран в
            системе»: у неё есть осмысленное пустое состояние. */}
        <div className={styles.content}>
          {/* Правка содержания — только в режиме редактора (SPEC §4.4). В режиме
              просмотра секция не рендерится вовсе, как и действие «Добавить» у
              ссылки на экран. */}
          {mode === 'edit' &&
            (editingContent ? (
              <NodeContentForm
                node={node}
                onClose={() => {
                  setEditingContent(false);
                }}
              />
            ) : (
              <button
                type="button"
                className={styles.editContent}
                onClick={() => {
                  setEditingContent(true);
                }}
              >
                {ru.nodeEditor.edit}
              </button>
            ))}

          {hasDescription && (
            <div className={styles.description}>
              {paragraphs.map((paragraph, index) => (
                <p className={styles.paragraph} key={`${index}-${paragraph}`}>
                  {paragraph}
                </p>
              ))}
            </div>
          )}

          <ScreenLinkSection node={node} />

          {/* Алгоритмы платформы — отдельная секция от экрана: у шага бывают
              обе связи сразу, и они отвечают на разные вопросы («где посмотреть
              данные» и «чем это считается»). Имена берутся из реестра СВОЕГО
              модуля; у карт без реестра (snp, mrp) он пуст и секции нет. */}
          <AlgorithmSection node={node} registry={ALGORITHM_REGISTRY} />

          {/* Связи правятся только в редакторе: читателю вики они видны
              стрелками на полотне, а список ему ни к чему. */}
          {mode === 'edit' && stage !== undefined && <NodeEdgesSection node={node} stage={stage} />}

          <ListSection title={ru.drawer.inputs} items={node.inputs} />
          <ListSection title={ru.drawer.outputs} items={node.outputs} />

          {node.system !== undefined && (
            <Section title={ru.drawer.system} tight>
              {/* Расшифровка появится в ru.systems, когда её пришлёт владелец
                  процесса (process-map-b67, SPEC §4.3). Пока словарь пуст —
                  показываем код, а не пустую строку. */}
              <span className={styles.fieldValue}>{ru.systems[node.system] || node.system}</span>
            </Section>
          )}
          {node.owner !== undefined && (
            <Section title={ru.drawer.owner} tight>
              <span className={styles.fieldValue}>{node.owner}</span>
            </Section>
          )}
        </div>

        <footer className={styles.footer}>
          {/* SPEC §4.3: кнопка «Подробнее» из макета в v1 не реализуется —
              решение владельца процесса (process-map-wo8). Она прокручивала бы
              к описанию, уже видимому на этой же панели, то есть обещала
              больше, чем делала на самом деле. В футере остаётся только
              «Открыть в модуле». */}
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            disabled={screen === undefined}
            title={screen === undefined ? ru.drawer.openInModuleEmpty : ru.drawer.openInModule}
            onClick={() => {
              // Кнопка disabled без ссылки, но сужение типа этого не знает:
              // проверка нужна компилятору и на случай программного клика.
              if (screen === undefined) {
                return;
              }
              // Открытие — только через utils/url.ts::openScreen (SPEC §4.8):
              // там цель берётся из config.linkTarget (по умолчанию новая
              // вкладка) и там же валидация url.
              openScreen(screen.url);
            }}
          >
            {ru.drawer.openInModule}
          </button>
        </footer>
      </div>
    </>
  );
}

interface ListSectionProps {
  title: string;
  items: string[] | undefined;
}

/** Секция-список (Входы/Выходы). Пустой или отсутствующий список не рендерится. */
function ListSection({ title, items }: ListSectionProps) {
  if (items === undefined || items.length === 0) {
    return null;
  }
  return (
    <Section title={title}>
      <ul className={styles.list}>
        {items.map((item, index) => (
          <li className={styles.listItem} key={`${index}-${item}`}>
            {item}
          </li>
        ))}
      </ul>
    </Section>
  );
}
