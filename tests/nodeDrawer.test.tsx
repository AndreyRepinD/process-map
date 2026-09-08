// Тесты боковой панели узла (SPEC §4.3, задача process-map-lo7).
//
// Оговорка про jsdom: hit-testing здесь нет, поэтому «клик прошёл» ничего не
// доказывает про реальный браузер. Клик мышью по затемнению и по кнопкам
// футера проверяется в e2e/node-drawer.spec.ts; здесь — структура панели,
// порядок секций, скрытие пустых секций, Esc, фокус и Tab-ловушка.
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { NodeDrawer, descriptionParagraphs } from '../src/components/NodeDrawer';
import { algorithmsForMap } from '../src/data/algorithms';
import { loadBaseProcessMap, LOADED_MAP_ID } from '../src/data/loader';
import type { ProcessNode } from '../src/data/schema';
import { ru } from '../src/i18n/ru';
import { createInitialState, useProcessStore } from '../src/store/useProcessStore';

/**
 * Есть ли у карты, против которой идёт прогон, реестр алгоритмов платформы.
 *
 * Прогон гоняется против РАЗНЫХ карт (переменная сборки MAP), а секция
 * «Алгоритмы в платформе» показывается только там, где реестр непуст: у snp и
 * mrp алгоритмов In.Plan не снято, и подсказывать им чужие имена нельзя.
 */
const HAS_ALGORITHM_REGISTRY = algorithmsForMap(LOADED_MAP_ID).length > 0;

const map = loadBaseProcessMap();

/** Узел из реальных данных по id — тесты не должны выдумывать содержание. */
function nodeById(id: string): ProcessNode {
  for (const stage of map.stages) {
    const found = stage.nodes.find((candidate) => candidate.id === id);
    if (found !== undefined) {
      return found;
    }
  }
  throw new Error(`В process.json нет узла "${id}"`);
}

// Описание — таблица из 7 строк «причина → действие» (SPEC §3, задача lo7).
const WARNING_WITH_TABLE = 'formirovanie-preduprezhdeniy-sp-posle-progona-planirovaniya-5-78';
// Описание — 9 строк с маркерами «- ».
const STEP_WITH_LIST = 'dezagregaciya-prognoza-po-produktu';

/**
 * Первый узел БЕЗ ссылки в данных (process-map-071).
 *
 * Тестам пустого состояния нужен именно такой узел, и брать для этого
 * STEP_WITH_LIST нельзя: ссылки проставляет владелец (process-map-lqa), и
 * попади она в этот узел — тесты покраснели бы не из-за дефекта, а из-за
 * выбора узла. Остальные проверки файла продолжают опираться на
 * STEP_WITH_LIST: им нужно описание ровно из 9 абзацев.
 */
function nodeWithoutScreen(): ProcessNode {
  for (const stage of map.stages) {
    const found = stage.nodes.find((node) => node.screen === undefined);
    if (found !== undefined) {
      return found;
    }
  }
  throw new Error('в process.json не осталось узлов без ссылки');
}

function openDrawer(nodes: ProcessNode[], nodeId: string) {
  useProcessStore.getState().selectNode(nodeId);
  return render(<NodeDrawer nodes={nodes} />);
}

/** Разворачивает результат querySelector: тест должен падать сообщением, а не TS-ошибкой. */
function required<T>(value: T | null, what: string): T {
  if (value === null) {
    throw new Error(`В панели не найден элемент: ${what}`);
  }
  return value;
}

/** Заголовки секций панели в порядке появления в DOM. */
function sectionTitles(dialog: HTMLElement): string[] {
  return Array.from(dialog.querySelectorAll('h3')).map((heading) => heading.textContent ?? '');
}

beforeEach(() => {
  useProcessStore.setState(createInitialState());
});

describe('descriptionParagraphs', () => {
  it('пустое описание и пробелы дают пустой список', () => {
    expect(descriptionParagraphs(undefined)).toEqual([]);
    expect(descriptionParagraphs('   \n  \n')).toEqual([]);
  });

  it('разбивает многострочные описания реальных узлов построчно', () => {
    // Числа взяты из process.json: 7 строк «причина → действие» и 9 строк списка.
    expect(descriptionParagraphs(nodeById(WARNING_WITH_TABLE).description)).toHaveLength(7);
    expect(descriptionParagraphs(nodeById(STEP_WITH_LIST).description)).toHaveLength(9);
  });
});

describe('NodeDrawer', () => {
  it('ничего не рендерит при закрытом Drawer и при неизвестном узле', () => {
    const nodes = map.stages[0]?.nodes ?? [];

    const closed = render(<NodeDrawer nodes={nodes} />);
    expect(closed.container).toBeEmptyDOMElement();
    closed.unmount();

    useProcessStore.getState().selectNode('нет-такого-узла');
    const missing = render(<NodeDrawer nodes={nodes} />);
    expect(missing.container).toBeEmptyDOMElement();
  });

  it('панель — диалог с именем по label узла и затемнением полотна', () => {
    const node = nodeById(STEP_WITH_LIST);
    const { container } = openDrawer([node], node.id);

    const dialog = screen.getByRole('dialog');
    // aria-modal тут быть НЕ должно (process-map-9ji): панель немодальна по
    // замыслу — тулбар при ней остаётся рабочим. Раньше атрибут стоял и
    // утверждал обратное. Недоступность соседей выражена `inert` в
    // StageDetail.tsx, и проверяется она там же (tests/stageDetail.test.tsx).
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent(node.label);
    // Затемнение — отдельный слой поверх полотна (SPEC §4.3).
    expect(container.querySelector('[data-testid="drawer-scrim"]')).not.toBeNull();
  });

  it('многострочное описание выводится абзацами, а не одной простынёй', () => {
    const node = nodeById(WARNING_WITH_TABLE);
    openDrawer([node], node.id);

    const paragraphs = screen.getByRole('dialog').querySelectorAll('p');
    expect(paragraphs).toHaveLength(7);
    expect(paragraphs[0]?.textContent).toContain('Причина в низком приоритете спроса');
    expect(paragraphs[6]?.textContent).toContain('Прочие причины');
  });

  it('секции идут в порядке SPEC §4.3', () => {
    const base = nodeById(STEP_WITH_LIST);
    const full: ProcessNode = {
      ...base,
      inputs: ['Прогноз спроса'],
      outputs: ['Прогноз по продукту'],
      system: 'DP',
      owner: 'Планировщик спроса',
      screen: { title: 'Планирование поставок › Объёмный план', url: 'https://example.com/plan' },
    };
    openDrawer([full], full.id);

    // Секция «Алгоритмы в платформе» стоит сразу за экраном — обе отвечают на
    // вопрос «куда в платформе ведёт этот блок». Но её НЕТ у карты без реестра
    // алгоритмов (snp, mrp): предлагать планировщику SNP имена MEIO значило бы
    // подсказать заведомо неверную привязку. Поэтому ожидание зависит от карты,
    // против которой идёт прогон, а не зашито списком.
    expect(sectionTitles(screen.getByRole('dialog'))).toEqual([
      ru.drawer.screenSection,
      ...(HAS_ALGORITHM_REGISTRY ? [ru.drawer.algorithmSection] : []),
      ru.drawer.inputs,
      ru.drawer.outputs,
      ru.drawer.system,
      ru.drawer.owner,
    ]);
    // Описание идёт первым — до секции «Экран в системе».
    const dialog = screen.getByRole('dialog');
    const firstParagraph = required(dialog.querySelector('p'), 'абзац описания');
    const firstSection = required(dialog.querySelector('h3'), 'первая секция');
    expect(
      firstParagraph.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });

  it('пустые секции не рендерятся заголовками без содержимого', () => {
    // Узел из реальных данных: inputs/owner не заполнены ни у одного узла,
    // system и outputs — только у части.
    const node = nodeById(STEP_WITH_LIST);
    expect(node.inputs).toBeUndefined();
    expect(node.owner).toBeUndefined();
    // system заполнен только у 8 узлов из 103 — этот к ним не относится.
    expect(node.system).toBeUndefined();
    expect(node.outputs).toBeUndefined();

    openDrawer([node], node.id);

    const titles = sectionTitles(screen.getByRole('dialog'));
    expect(titles).not.toContain(ru.drawer.inputs);
    expect(titles).not.toContain(ru.drawer.owner);
    expect(titles).not.toContain(ru.drawer.system);
    expect(titles).not.toContain(ru.drawer.outputs);
    // «Экран в системе» показывается всегда — у неё есть пустое состояние.
    expect(titles).toContain(ru.drawer.screenSection);
  });

  it('пустой список outputs тоже не рендерится', () => {
    const node: ProcessNode = { ...nodeById(STEP_WITH_LIST), outputs: [] };
    openDrawer([node], node.id);
    expect(sectionTitles(screen.getByRole('dialog'))).not.toContain(ru.drawer.outputs);
  });

  it('без ссылки: «Ссылка не задана», «Добавить» скрыт вне редактора, кнопка модуля disabled', () => {
    const node = nodeWithoutScreen();
    openDrawer([node], node.id);

    expect(screen.getByText(ru.drawer.screenEmpty)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ru.drawer.screenAdd })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: ru.drawer.openInModule })).toBeDisabled();
  });

  it('в режиме редактора появляется action «Добавить» (SPEC §4.3)', () => {
    // «Добавить» есть только у узла без ссылки — у узла со ссылкой там
    // «Изменить» (process-map-071).
    const node = nodeWithoutScreen();
    useProcessStore.getState().setMode('edit');
    openDrawer([node], node.id);

    // ПО ДОСТУПНОМУ ИМЕНИ С НАЗВАНИЕМ СЕКЦИИ, а не по видимому «Добавить»:
    // секций-ссылок на панели две (экран и алгоритм), видимая подпись у них
    // одинаковая, и getByRole по ней падал бы на «найдено две» — ровно то, что
    // услышал бы и скринридер, если бы доступные имена не различались.
    expect(
      screen.getByRole('button', {
        name: ru.drawer.linkActionAria(ru.drawer.screenAdd, ru.drawer.screenSection),
      }),
    ).toBeInTheDocument();
    // Вторая такая кнопка есть только там, где есть секция алгоритмов.
    const algorithmAdd = screen.queryByRole('button', {
      name: ru.drawer.linkActionAria(ru.drawer.screenAdd, ru.drawer.algorithmSection),
    });
    if (HAS_ALGORITHM_REGISTRY) {
      expect(algorithmAdd).toBeInTheDocument();
    } else {
      expect(algorithmAdd).not.toBeInTheDocument();
    }
  });

  it('со ссылкой: заголовок и url в одной строке, кнопка модуля активна', () => {
    const screenLink = {
      title: 'Планирование поставок › Объёмный план',
      url: 'https://example.com/plan',
    };
    const node: ProcessNode = { ...nodeById(STEP_WITH_LIST), screen: screenLink };
    openDrawer([node], node.id);

    expect(screen.getByText(screenLink.title)).toBeInTheDocument();
    expect(screen.getByText(screenLink.url)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ru.drawer.openInModule })).toBeEnabled();
    // «Добавить» вместо ссылки не показывается даже в редакторе.
    expect(screen.queryByText(ru.drawer.screenEmpty)).not.toBeInTheDocument();
  });

  it('Esc и кнопка «Закрыть» вызывают closeDrawer', () => {
    const node = nodeById(STEP_WITH_LIST);
    const { unmount } = openDrawer([node], node.id);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useProcessStore.getState().selectedNodeId).toBeNull();
    unmount();

    useProcessStore.getState().selectNode(node.id);
    render(<NodeDrawer nodes={[node]} />);
    fireEvent.click(screen.getByRole('button', { name: ru.drawer.close }));
    expect(useProcessStore.getState().selectedNodeId).toBeNull();
  });

  it('фокус переводится в панель при открытии и возвращается на карточку узла', () => {
    const node = nodeById(STEP_WITH_LIST);
    useProcessStore.getState().selectNode(node.id);

    // Карточку узла подменяем таким же контейнером, какой рисует React Flow:
    // <div data-id="<id>"><button>…</button></div>.
    const { rerender } = render(
      <>
        <div data-id={node.id}>
          <button type="button">{node.label}</button>
        </div>
        <NodeDrawer nodes={[node]} />
      </>,
    );

    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dialog);

    // Первый Tab из панели попадает на её первый элемент — кнопку «Закрыть».
    const close = screen.getByRole('button', { name: ru.drawer.close });
    close.focus();
    expect(document.activeElement).toBe(close);

    // Закрытие идёт через store: подписчики NodeDrawer обновляются внутри act.
    act(() => {
      useProcessStore.getState().closeDrawer();
    });
    rerender(
      <>
        <div data-id={node.id}>
          <button type="button">{node.label}</button>
        </div>
        <NodeDrawer nodes={[node]} />
      </>,
    );

    expect(document.activeElement).toBe(screen.getByRole('button', { name: node.label }));
  });

  it('Tab-ловушка замыкает обход внутри панели', () => {
    const node: ProcessNode = {
      ...nodeById(STEP_WITH_LIST),
      screen: { title: 'Объёмный план', url: 'https://example.com/plan' },
    };
    openDrawer([node], node.id);

    const dialog = screen.getByRole('dialog');
    const focusable = Array.from(dialog.querySelectorAll('button'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    expect(first).toBe(screen.getByRole('button', { name: ru.drawer.close }));
    // Последняя в футере — «Открыть рядом», а не «Открыть в модуле»: с
    // 08.09.2026 в футере две кнопки, и панель экрана добавлена ВТОРОЙ,
    // потому что основной путь (новая вкладка) остаётся прежним.
    expect(last).toBe(screen.getByRole('button', { name: ru.screenPanel.openBeside }));

    // Tab с последнего элемента — на первый.
    last?.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    // Shift+Tab с первого — на последний.
    first?.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
