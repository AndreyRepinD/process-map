// Тесты формы ссылки на экран — редактор (SPEC §4.4, задача process-map-0sb).
//
// Оговорка про jsdom (CLAUDE.md «Ловушки»): здесь проверяются валидация,
// запись overrides и реактивность панели. Доступность полей и кнопок настоящей
// мышью (форма живёт в панели ПОВЕРХ полотна React Flow) проверяется только в
// e2e/screen-link-editor.spec.ts через elementFromPoint и mouse.click.
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NodeDrawer, ScreenLinkSection, TITLE_MAX_LENGTH } from '../src/components/NodeDrawer';
import { loadBaseProcessMap, readStoredOverrides, setNodeOverride } from '../src/data/loader';
import { overridesStorageKey, type ProcessNode } from '../src/data/schema';
import { refreshProcessMap, useProcessMap } from '../src/hooks/useProcessMap';
import { ru } from '../src/i18n/ru';
import { createInitialState, useProcessStore } from '../src/store/useProcessStore';

const map = loadBaseProcessMap();
// Ключ берётся из id загруженной карты, а не из литерала: у каждой карты свой
// (process-map-3wh.5).
const storageKey = overridesStorageKey(map.id);

/**
 * Узел из реальных данных: тесты не выдумывают содержание процесса.
 *
 * Берётся ПЕРВЫЙ БЕЗ ССЫЛКИ (process-map-071), а не по захардкоженному id: весь
 * файл начинает с пустого состояния и жмёт «Добавить», которого у узла со
 * ссылкой не будет — там «Изменить». Ссылки проставляет владелец
 * (process-map-lqa), и попади первая из них в прежний узел
 * `dezagregaciya-prognoza-po-produktu` — покраснел бы весь файл.
 */
const NODE_ID =
  map.stages.flatMap((stage) => stage.nodes).find((node) => node.screen === undefined)?.id ?? '';

function nodeById(id: string): ProcessNode {
  for (const stage of map.stages) {
    const found = stage.nodes.find((candidate) => candidate.id === id);
    if (found !== undefined) {
      return found;
    }
  }
  throw new Error(`В process.json нет узла "${id}"`);
}

/** Сырое содержимое ключа overrides — важно РАЗЛИЧАТЬ «нет записи» и «screen: null». */
function rawOverrides(): unknown {
  const raw = localStorage.getItem(storageKey);
  return raw === null ? null : JSON.parse(raw);
}

/**
 * Панель узла, подписанная на карту через useProcessMap: ровно так же, как это
 * делает StageDetail. Именно этот путь доказывает реактивность — узел приходит
 * из слитой карты, а не из зафиксированной в тесте переменной.
 */
function DrawerHarness({ nodeId }: { nodeId: string }) {
  const current = useProcessMap();
  const stage = current.stages.find((candidate) =>
    candidate.nodes.some((node) => node.id === nodeId),
  );
  return <NodeDrawer nodes={stage?.nodes ?? []} />;
}

/**
 * Доступные имена действий секции «Экран в системе».
 *
 * ПОЧЕМУ НЕ ПРОСТО «Добавить». На панели две секции с привязкой (экран и
 * алгоритмы), видимая подпись действия у них одна и та же, различает их только
 * доступное имя с названием секции (ru.drawer.linkActionAria). Тесты этого
 * файла — про ссылку на ЭКРАН, поэтому адресуются именно к его кнопкам.
 */
const SCREEN_ADD = ru.drawer.linkActionAria(ru.drawer.screenAdd, ru.drawer.screenSection);
const SCREEN_EDIT = ru.drawer.linkActionAria(ru.drawer.screenEdit, ru.drawer.screenSection);

function openFormInDrawer(nodeId: string, action: string = SCREEN_ADD) {
  useProcessStore.getState().setMode('edit');
  useProcessStore.getState().selectNode(nodeId);
  const result = render(<DrawerHarness nodeId={nodeId} />);
  fireEvent.click(screen.getByRole('button', { name: action }));
  return result;
}

/** Секция сама по себе — без панели, когда панель в тесте не нужна. */
function renderSection(node: ProcessNode) {
  return render(<ScreenLinkSection node={node} />);
}

function typeInto(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function save(): void {
  fireEvent.click(screen.getByRole('button', { name: ru.screenLinkForm.save }));
}

beforeEach(() => {
  localStorage.clear();
  // Снимок карты в useProcessMap кэшируется — после очистки хранилища его
  // нужно перечитать, иначе тест увидит правки соседнего теста.
  refreshProcessMap();
  useProcessStore.setState(createInitialState());
});

describe('ScreenLinkSection: открытие формы', () => {
  it('в режиме просмотра формы нет и открыть её нечем', () => {
    renderSection(nodeById(NODE_ID));

    expect(screen.queryByRole('button', { name: SCREEN_ADD })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(ru.screenLinkForm.titleLabel)).not.toBeInTheDocument();
  });

  it('«Добавить» в редакторе открывает форму с пустыми полями', () => {
    useProcessStore.getState().setMode('edit');
    renderSection(nodeById(NODE_ID));

    fireEvent.click(screen.getByRole('button', { name: SCREEN_ADD }));

    expect(screen.getByLabelText(ru.screenLinkForm.titleLabel)).toHaveValue('');
    expect(screen.getByLabelText(ru.screenLinkForm.urlLabel)).toHaveValue('');
    // Удалять нечего — кнопки «Удалить ссылку» нет.
    expect(
      screen.queryByRole('button', { name: ru.screenLinkForm.remove }),
    ).not.toBeInTheDocument();
  });

  it('«Изменить» у узла со ссылкой открывает форму с её значениями', () => {
    const screenLink = { title: 'Объёмный план', url: 'https://example.com/plan' };
    useProcessStore.getState().setMode('edit');
    renderSection({ ...nodeById(NODE_ID), screen: screenLink });

    fireEvent.click(screen.getByRole('button', { name: SCREEN_EDIT }));

    expect(screen.getByLabelText(ru.screenLinkForm.titleLabel)).toHaveValue(screenLink.title);
    expect(screen.getByLabelText(ru.screenLinkForm.urlLabel)).toHaveValue(screenLink.url);
    expect(screen.getByRole('button', { name: ru.screenLinkForm.remove })).toBeInTheDocument();
  });

  it('выход из режима редактора закрывает открытую форму', () => {
    useProcessStore.getState().setMode('edit');
    renderSection(nodeById(NODE_ID));
    fireEvent.click(screen.getByRole('button', { name: SCREEN_ADD }));
    expect(screen.getByLabelText(ru.screenLinkForm.titleLabel)).toBeInTheDocument();

    act(() => {
      useProcessStore.getState().setMode('view');
    });

    expect(screen.queryByLabelText(ru.screenLinkForm.titleLabel)).not.toBeInTheDocument();
    expect(screen.getByText(ru.drawer.screenEmpty)).toBeInTheDocument();
  });
});

describe('ScreenLinkForm: валидация', () => {
  it('пустой title блокирует сохранение и показывает ru.screenLinkForm.titleEmpty', () => {
    openFormInDrawer(NODE_ID);

    typeInto(ru.screenLinkForm.urlLabel, 'https://example.com/plan');
    save();

    expect(screen.getByText(ru.screenLinkForm.titleEmpty)).toBeInTheDocument();
    expect(rawOverrides()).toBeNull();
    // Форма осталась открытой — пользователю есть что исправлять.
    expect(screen.getByLabelText(ru.screenLinkForm.titleLabel)).toBeInTheDocument();
  });

  // Ключи ru.screenLinkForm названы по reason из validateUrl — таблица ниже
  // проверяет как раз это соответствие, а не сам разбор URL (он в url.test.ts).
  it.each([
    ['', ru.screenLinkForm.urlEmpty],
    ['не ссылка', ru.screenLinkForm.urlMalformed],
    ['javascript:alert(1)', ru.screenLinkForm.urlUnsupportedProtocol],
  ])('невалидный url «%s» блокирует сохранение и показывает свой текст', (value, message) => {
    openFormInDrawer(NODE_ID);

    typeInto(ru.screenLinkForm.titleLabel, 'Объёмный план');
    typeInto(ru.screenLinkForm.urlLabel, value);
    save();

    expect(screen.getByText(message)).toBeInTheDocument();
    // Главное: в localStorage не ушло ничего.
    expect(rawOverrides()).toBeNull();
    expect(screen.getByLabelText(ru.screenLinkForm.urlLabel)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('ошибка исчезает, как только url исправили', () => {
    openFormInDrawer(NODE_ID);
    typeInto(ru.screenLinkForm.titleLabel, 'Объёмный план');
    typeInto(ru.screenLinkForm.urlLabel, 'не ссылка');
    save();
    expect(screen.getByText(ru.screenLinkForm.urlMalformed)).toBeInTheDocument();

    typeInto(ru.screenLinkForm.urlLabel, 'https://example.com/plan');

    expect(screen.queryByText(ru.screenLinkForm.urlMalformed)).not.toBeInTheDocument();
  });

  it('http: — предупреждение, а НЕ ошибка: сохранение проходит (SPEC §4.4)', () => {
    openFormInDrawer(NODE_ID);

    typeInto(ru.screenLinkForm.titleLabel, 'Объёмный план');
    typeInto(ru.screenLinkForm.urlLabel, 'http://inplan.local/plan');

    // Предупреждение видно сразу, до попытки сохранить.
    expect(screen.getByText(ru.screenLinkForm.urlInsecureWarning)).toBeInTheDocument();
    // И поле при этом не помечено ошибочным.
    expect(screen.getByLabelText(ru.screenLinkForm.urlLabel)).toHaveAttribute(
      'aria-invalid',
      'false',
    );

    save();

    expect(readStoredOverrides()[NODE_ID]?.screen).toEqual({
      title: 'Объёмный план',
      url: 'http://inplan.local/plan',
    });
  });

  it('счётчик символов показывает предел 80 и не даёт его превысить', () => {
    openFormInDrawer(NODE_ID);

    expect(
      screen.getByText(ru.screenLinkForm.titleCounter(0, TITLE_MAX_LENGTH)),
    ).toBeInTheDocument();

    typeInto(ru.screenLinkForm.titleLabel, 'а'.repeat(12));
    expect(
      screen.getByText(ru.screenLinkForm.titleCounter(12, TITLE_MAX_LENGTH)),
    ).toBeInTheDocument();

    // Вставка длиннее предела обрезается: состояния длиннее 80 не существует.
    typeInto(ru.screenLinkForm.titleLabel, 'б'.repeat(TITLE_MAX_LENGTH + 30));
    expect(screen.getByLabelText(ru.screenLinkForm.titleLabel)).toHaveValue(
      'б'.repeat(TITLE_MAX_LENGTH),
    );
    expect(
      screen.getByText(ru.screenLinkForm.titleCounter(TITLE_MAX_LENGTH, TITLE_MAX_LENGTH)),
    ).toBeInTheDocument();
  });
});

describe('ScreenLinkForm: запись overrides', () => {
  it('«Сохранить» пишет override и ссылка сразу видна в панели (без перезагрузки)', () => {
    openFormInDrawer(NODE_ID);

    typeInto(ru.screenLinkForm.titleLabel, '  Планирование поставок › Объёмный план  ');
    typeInto(ru.screenLinkForm.urlLabel, 'https://example.com/plan');
    save();

    // 1. Запись в localStorage — в формате SPEC §3.
    expect(rawOverrides()).toEqual({
      [NODE_ID]: {
        screen: { title: 'Планирование поставок › Объёмный план', url: 'https://example.com/plan' },
      },
    });
    // 2. Панель показывает ссылку немедленно: карта перечитана через
    //    commitOverrides → useProcessMap (реактивность, а не перезагрузка).
    expect(screen.getByText('Планирование поставок › Объёмный план')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/plan')).toBeInTheDocument();
    expect(screen.queryByLabelText(ru.screenLinkForm.titleLabel)).not.toBeInTheDocument();
    // 3. И кнопка «Открыть в модуле» перестала быть заблокированной.
    expect(screen.getByRole('button', { name: ru.drawer.openInModule })).toBeEnabled();
  });

  it('«Отмена» закрывает форму и не пишет ничего', () => {
    openFormInDrawer(NODE_ID);

    typeInto(ru.screenLinkForm.titleLabel, 'Объёмный план');
    typeInto(ru.screenLinkForm.urlLabel, 'https://example.com/plan');
    fireEvent.click(screen.getByRole('button', { name: ru.screenLinkForm.cancel }));

    expect(rawOverrides()).toBeNull();
    expect(screen.getByText(ru.drawer.screenEmpty)).toBeInTheDocument();

    // Повторное открытие формы даёт исходные (пустые) значения, а не набранные.
    fireEvent.click(screen.getByRole('button', { name: SCREEN_ADD }));
    expect(screen.getByLabelText(ru.screenLinkForm.titleLabel)).toHaveValue('');
  });

  it('«Удалить ссылку» пишет screen: null, а не удаляет запись (SPEC §3)', () => {
    // Ссылка уже есть — кладём её штатным путём, через overrides.
    setNodeOverride(NODE_ID, { title: 'Объёмный план', url: 'https://example.com/plan' });
    refreshProcessMap();

    openFormInDrawer(NODE_ID, SCREEN_EDIT);
    fireEvent.click(screen.getByRole('button', { name: ru.screenLinkForm.remove }));

    // Ключевое различие трёх состояний override: запись ОСТАЁТСЯ и содержит
    // null. Удаление записи означало бы «вернуть значение из process.json».
    expect(rawOverrides()).toEqual({ [NODE_ID]: { screen: null } });
    expect(Object.keys(readStoredOverrides())).toContain(NODE_ID);
    expect(readStoredOverrides()[NODE_ID]?.screen).toBeNull();

    // И панель сразу вернулась к пустому состоянию.
    expect(screen.getByText(ru.drawer.screenEmpty)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ru.drawer.openInModule })).toBeDisabled();
  });

  it('правка существующей ссылки заменяет её, а не добавляет вторую запись', () => {
    setNodeOverride(NODE_ID, { title: 'Старое', url: 'https://example.com/old' });
    refreshProcessMap();

    openFormInDrawer(NODE_ID, SCREEN_EDIT);
    typeInto(ru.screenLinkForm.titleLabel, 'Новое');
    typeInto(ru.screenLinkForm.urlLabel, 'https://example.com/new');
    save();

    expect(rawOverrides()).toEqual({
      [NODE_ID]: { screen: { title: 'Новое', url: 'https://example.com/new' } },
    });
  });
});
