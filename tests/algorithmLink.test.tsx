// Привязка узла карты к алгоритмам Менеджера процессов In.Plan (process-map-trt).
//
// ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ И ПОЧЕМУ ИМЕННО ЭТО.
//
// 1. РЕЕСТР — снятый со стенда факт, а не догадка. Списки имён собраны в
//    аутентифицированной сессии владельца 07.09.2026. Тест фиксирует РАЗМЕР
//    списков: выпадающий список платформы виртуализован и отдаёт в DOM только
//    видимое окно, поэтому первый снимок дал 17 имён MEIO из 18 — потеря
//    «MEIO Оптимизатор (изолированный)» не была видна ни глазами, ни типами.
//    Число здесь — единственное место, где такая потеря станет заметной.
//
// 2. СПИСОК, А НЕ ОДНО ИМЯ. Соответствие шага и алгоритма не взаимно
//    однозначно: «Настройка параметров» в MEIO — это четыре расчёта CV и
//    усреднитель. Тест на несколько имён держит именно это свойство.
//
// 3. ДВА ПОЛЯ, А НЕ ОДНО. У шага бывают одновременно экран с данными и
//    алгоритмы, которые их считают. Обе привязки пишутся в ОДНУ запись
//    overrides, поэтому проверяется, что запись одной не стирает другую.
//
// 4. ПЕРЕНОС ЧЕРЕЗ ЭКСПОРТ. Правки живут в localStorage одного браузера, наружу
//    они выходят только файлом (SPEC §4.7). Поле, которое редактор пишет, а
//    экспорт не переносит, выглядит рабочим ровно до первой передачи карты.
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { algorithmsForMap, DP_ALGORITHMS, MEIO_ALGORITHMS } from '../src/data/algorithms';
import {
  loadBaseProcessMap,
  mergeOverrides,
  OVERRIDES_KEY,
  readStoredOverrides,
  setNodeAlgorithms,
  setNodeOverride,
} from '../src/data/loader';
import type { ProcessNode } from '../src/data/schema';
import { ru } from '../src/i18n/ru';
import { useProcessStore } from '../src/store/useProcessStore';
import { AlgorithmSection } from '../src/components/NodeDrawer/AlgorithmSection';
import { deriveOverrides } from '../src/utils/processTransfer';

const ADD = ru.drawer.linkActionAria(ru.drawer.screenAdd, ru.drawer.algorithmSection);
const EDIT = ru.drawer.linkActionAria(ru.drawer.screenEdit, ru.drawer.algorithmSection);

function firstStepNode(): ProcessNode {
  const map = loadBaseProcessMap();
  for (const stage of map.stages) {
    for (const node of stage.nodes) {
      if (node.type !== 'data') {
        return node;
      }
    }
  }
  throw new Error('В карте нет ни одного узла-шага');
}

/** Узел с уже проставленными алгоритмами — как его отдаёт merge. */
function nodeWith(algorithms: string[]): ProcessNode {
  return { ...firstStepNode(), algorithms };
}

beforeEach(() => {
  window.localStorage.clear();
  useProcessStore.getState().setMode('view');
});

describe('реестр алгоритмов', () => {
  it('MEIO — 18 имён, DP — 9: ровно столько отдал стенд', () => {
    expect(MEIO_ALGORITHMS).toHaveLength(18);
    expect(DP_ALGORITHMS).toHaveLength(9);
  });

  it('внутри списка нет повторов', () => {
    expect(new Set(MEIO_ALGORITHMS).size).toBe(MEIO_ALGORITHMS.length);
    expect(new Set(DP_ALGORITHMS).size).toBe(DP_ALGORITHMS.length);
  });

  it('имена, проверенные на стенде поимённо, в списке есть', () => {
    // Первое выбиралось в комбобоксе руками — так проверялось, меняется ли URL.
    // Второе — то самое, что потерялось при первом переносе списка.
    expect(MEIO_ALGORITHMS).toContain('MEIO Мультиэшелональный оптимизатор');
    expect(MEIO_ALGORITHMS).toContain('MEIO Оптимизатор (изолированный)');
  });

  it('карте без своего реестра подсказки не выдаются', () => {
    // Пустой список, а НЕ список чужого модуля: предложить планировщику SNP
    // имена MEIO значило бы подсказать заведомо неверную привязку.
    expect(algorithmsForMap('snp')).toEqual([]);
    expect(algorithmsForMap('mrp')).toEqual([]);
    expect(algorithmsForMap('meio')).toBe(MEIO_ALGORITHMS);
    expect(algorithmsForMap('dp')).toBe(DP_ALGORITHMS);
  });
});

describe('секция «Алгоритмы в платформе»', () => {
  it('без реестра секции нет вовсе', () => {
    const { container } = render(<AlgorithmSection node={firstStepNode()} registry={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('в режиме просмотра показывает пустое состояние без действий', () => {
    render(<AlgorithmSection node={firstStepNode()} registry={MEIO_ALGORITHMS} />);

    expect(screen.getByText(ru.drawer.algorithmSection)).toBeInTheDocument();
    expect(screen.getByText(ru.drawer.algorithmEmpty)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ADD })).not.toBeInTheDocument();
    // Переход на экран показывается только при непустой привязке: кнопка
    // «Открыть Менеджер процессов» у узла без алгоритмов обещала бы, что там
    // что-то про него есть.
    expect(screen.queryByRole('button', { name: ru.drawer.algorithmOpen })).not.toBeInTheDocument();
  });

  it('привязанные имена перечислены, переход и оговорка показаны', () => {
    render(
      <AlgorithmSection
        node={nodeWith(['MEIO Сегментация', 'MEIO ABC - Классификация'])}
        registry={MEIO_ALGORITHMS}
      />,
    );

    expect(screen.getByText('MEIO Сегментация')).toBeInTheDocument();
    expect(screen.getByText('MEIO ABC - Классификация')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ru.drawer.algorithmOpen })).toBeInTheDocument();
    // Оговорка про отсутствие диплинка обязана быть видна, иначе одинаковый
    // переход у десяти узлов читается как ошибка привязки.
    expect(screen.getByText(ru.drawer.algorithmNote)).toBeInTheDocument();
  });

  it('в редакторе перечень предлагает весь реестр модуля', () => {
    useProcessStore.getState().setMode('edit');
    render(<AlgorithmSection node={firstStepNode()} registry={MEIO_ALGORITHMS} />);
    fireEvent.click(screen.getByRole('button', { name: ADD }));

    expect(screen.getAllByRole('checkbox')).toHaveLength(MEIO_ALGORITHMS.length);
    expect(screen.getByText(ru.drawer.algorithmPick(MEIO_ALGORITHMS.length))).toBeInTheDocument();
  });

  it('отметка флажка пишет имя, не трогая ссылку на экран', () => {
    const node = firstStepNode();
    setNodeOverride(node.id, { title: 'Таблица', url: 'https://example.com/t' });

    useProcessStore.getState().setMode('edit');
    render(<AlgorithmSection node={node} registry={MEIO_ALGORITHMS} />);
    fireEvent.click(screen.getByRole('button', { name: ADD }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'MEIO Сегментация' }));

    const entry = readStoredOverrides()[node.id];
    expect(entry?.algorithms).toEqual(['MEIO Сегментация']);
    // Соседняя привязка на месте: обе пишутся в одну запись overrides.
    expect(entry?.screen).toEqual({ title: 'Таблица', url: 'https://example.com/t' });
  });

  it('несколько алгоритмов на одном шаге хранятся в порядке реестра', () => {
    // Ради этого свойства поле и сделано списком: «Настройка параметров» MEIO —
    // это четыре расчёта CV и усреднитель, одно значение потеряло бы остальные.
    const node = nodeWith(['MEIO Усреднитель']);
    useProcessStore.getState().setMode('edit');
    render(<AlgorithmSection node={node} registry={MEIO_ALGORITHMS} />);
    fireEvent.click(screen.getByRole('button', { name: EDIT }));
    // Отмечаем имя, которое в реестре стоит РАНЬШЕ уже отмеченного.
    fireEvent.click(screen.getByRole('checkbox', { name: 'MEIO Расчет CV' }));

    // Порядок реестра, а не порядок кликов: иначе один и тот же набор у двух
    // узлов выглядел бы разным списком.
    expect(readStoredOverrides()[node.id]?.algorithms).toEqual([
      'MEIO Расчет CV',
      'MEIO Усреднитель',
    ]);
  });

  it('снятие последнего флажка пишет null, а не пустой список', () => {
    const node = nodeWith(['MEIO Сегментация']);
    useProcessStore.getState().setMode('edit');
    render(<AlgorithmSection node={node} registry={MEIO_ALGORITHMS} />);
    fireEvent.click(screen.getByRole('button', { name: EDIT }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'MEIO Сегментация' }));

    // Пустой список и «привязки нет» — одно состояние; два способа его записать
    // разошлись бы при первом же сравнении.
    expect(readStoredOverrides()[node.id]?.algorithms).toBeNull();
  });

  it('выход из режима редактора сворачивает перечень', () => {
    const node = firstStepNode();
    useProcessStore.getState().setMode('edit');
    const { rerender } = render(<AlgorithmSection node={node} registry={MEIO_ALGORITHMS} />);
    fireEvent.click(screen.getByRole('button', { name: ADD }));
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);

    // act: смена режима — это обновление стора снаружи React-события, и без
    // обёртки React справедливо ругается, что проверяется состояние, которого
    // пользователь ещё не увидел бы.
    act(() => {
      useProcessStore.getState().setMode('view');
    });
    rerender(<AlgorithmSection node={node} registry={MEIO_ALGORITHMS} />);

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});

describe('слияние и перенос', () => {
  it('override с algorithms попадает в карту', () => {
    const base = loadBaseProcessMap();
    const node = firstStepNode();
    const names = ['MEIO Расчет CV', 'MEIO Усреднитель'];

    const merged = mergeOverrides(base, { [node.id]: { algorithms: names } });
    const got = merged.stages.flatMap((stage) => stage.nodes).find((n) => n.id === node.id);

    expect(got?.algorithms).toEqual(names);
  });

  it('экспортированная карта возвращает привязку обратно правкой', () => {
    const base = loadBaseProcessMap();
    const node = firstStepNode();
    const names = ['MEIO Усреднитель'];

    // Тот же путь, что у файла из «Экспорт JSON» → «Импорт JSON».
    const exported = mergeOverrides(base, { [node.id]: { algorithms: names } });
    const derived = deriveOverrides(base, exported);

    expect(derived[node.id]?.algorithms).toEqual(names);
  });

  it('снятая привязка переносится как null, а не теряется', () => {
    const base = loadBaseProcessMap();
    const node = firstStepNode();
    const withNames = mergeOverrides(base, { [node.id]: { algorithms: ['MEIO Сегментация'] } });

    // База «карта с привязкой» → импортируют файл БЕЗ неё: это удаление.
    const derived = deriveOverrides(withNames, base);
    expect(derived[node.id]?.algorithms).toBeNull();
  });

  it('setNodeAlgorithms сливает запись, а не заменяет её', () => {
    const node = firstStepNode();
    setNodeOverride(node.id, { title: 'Таблица', url: 'https://example.com/t' });
    setNodeAlgorithms(node.id, ['MEIO Сегментация']);
    setNodeAlgorithms(node.id, null);

    const entry = readStoredOverrides()[node.id];
    expect(entry?.algorithms).toBeNull();
    expect(entry?.screen).toEqual({ title: 'Таблица', url: 'https://example.com/t' });
  });

  it('ключ хранилища не изменился: старые правки не осиротели', () => {
    // Добавление поля не должно менять адрес записи — иначе у владельца молча
    // пропали бы все уже проставленные ссылки на экраны.
    expect(OVERRIDES_KEY).toMatch(/^inplan-process-map:[a-z]+:overrides:v1$/);
  });
});
