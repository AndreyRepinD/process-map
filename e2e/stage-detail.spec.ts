// e2e детализации уровня 2 (SPEC §7, §4.2, задача process-map-1ts).
//
// Смысл этих проверок — именно настоящий браузер: jsdom не делает hit-testing,
// поэтому дефект «React Flow глушит pointer-events у обёртки узла» юнит-тестом
// не ловится (fireEvent «сработает» и по мёртвому узлу). Здесь клик идёт
// реальной мышью по координатам, а попадание проверяется через
// document.elementFromPoint.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

import { openCalls, overridesKey } from './helpers';

const VIEWPORT = { width: 1280, height: 720 };

/** Ключ и формат overrides — SPEC §3, src/data/schema.ts. */
const OVERRIDES_KEY = overridesKey('snp');

/**
 * Карточка ШАГА. До process-map-73m этот класс носили и интеграции, поэтому
 * «первый .react-flow__node-step» на этапе 2 оказывался интеграцией, а не шагом
 * процесса. Теперь у интеграции свой тип узла.
 * Фильтр по aria-label оставлен вторым, независимым сторожем: класс приходит
 * из stageGraph.ts, подпись — из i18n, и поломка одного не отключает оба.
 */
const STEP_CARD = '.react-flow__node-step button[aria-label^="Шаг: "]';

/** Переход обзор → детализация настоящим кликом мыши по карточке этапа. */
async function openStage(page: Page, index: number): Promise<void> {
  await page.waitForSelector('.react-flow__node-stage');
  const card = page.locator('.react-flow__node-stage button').nth(index);
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  );
  await page.waitForSelector(STEP_CARD);
}

/**
 * Ждёт готовности полотна уровня 2, когда карточек уровня 1 на экране уже нет
 * (используется вместо openStage()). Актуально после page.reload(): deep-link
 * (?stage=…, SPEC §4.7, process-map-0y2) сам восстанавливает открытый этап —
 * приложение открывается сразу на уровне 2, а не на обзоре, поэтому кликать
 * по несуществующей карточке .react-flow__node-stage нельзя.
 */
async function waitForStageDetailReady(page: Page): Promise<void> {
  await page.waitForSelector(STEP_CARD);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
});

test('клик по карточке этапа открывает детализацию с крошками и узлами', async ({ page }) => {
  await page.goto('/');
  await openStage(page, 0);

  await expect(page.getByText('E2E-процесс')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Назад к обзору процесса' })).toBeVisible();
  await expect(page.getByText(/ · .+ · /)).toBeVisible();
  // Обзорных карточек этапов на уровне 2 быть не должно.
  await expect(page.locator('.react-flow__node-stage')).toHaveCount(0);
  // Этап 1: 2 группы + колонка входов + колонка выходов. Колонка выходов
  // появилась вместе с явным node.direction (задача process-map-24p): до неё
  // геометрическое правило зачисляло единственный выход этапа во входы.
  await expect(page.locator('.react-flow__node-groupBox')).toHaveCount(4);
});

test('центр карточки шага принимает события мыши, а не полотно', async ({ page }) => {
  await page.goto('/');
  await openStage(page, 0);

  const card = page.locator(STEP_CARD).first();
  const box = await card.boundingBox();
  expect(box).not.toBeNull();

  const hit = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return {
        tag: el?.tagName ?? null,
        insideNode: el?.closest('.react-flow__node-step') !== null,
        isPane: el?.classList.contains('react-flow__pane') ?? false,
      };
    },
    { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 },
  );

  expect(hit.isPane).toBe(false);
  expect(hit.insideNode).toBe(true);
});

test('настоящий клик мышью по узлу выбирает его', async ({ page }) => {
  await page.goto('/');
  await openStage(page, 0);

  const card = page.locator(STEP_CARD).first();
  await expect(card).not.toHaveAttribute('aria-current', 'true');

  const box = await card.boundingBox();
  await page.mouse.click(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  );

  await expect(card).toHaveAttribute('aria-current', 'true');
});

test('клик по карточке данных в колонке входов выбирает её', async ({ page }) => {
  await page.goto('/');
  await openStage(page, 0);

  // Колонка входов с задачи process-map-c18 остаётся слева ЗА КАДРОМ: стартовый
  // вид привязан к первой карточке шага, а не к углу габарита. Она доступна
  // панорамированием — им сюда и добираемся (panOnScroll включён), иначе
  // кликать было бы не по чему.
  const card = page.locator('.react-flow__node-data button').first();
  await page.mouse.move(640, 400);
  await expect
    .poll(async () => {
      await page.mouse.wheel(-200, 0);
      const box = await card.boundingBox();
      return box === null ? -1 : box.x;
    })
    .toBeGreaterThan(0);

  const box = await card.boundingBox();
  await page.mouse.click(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  );

  await expect(card).toHaveAttribute('aria-current', 'true');
  await expect(page.getByText('Входные данные')).toBeVisible();
});

// Ссылок в process.json нет ни у одного узла (они приходят из редактора M3),
// поэтому screen подкладывается штатным путём — overrides в localStorage,
// которые накладывает src/data/loader.ts при старте.
test('иконка link-external появляется при screen и не открывает Drawer (stopPropagation)', async ({
  page,
}) => {
  // Перехват window.open ставит авто-fixture из e2e/fixtures.ts — до этого тела
  // и до любого goto. Без него клик по иконке уводил страницу теста на
  // example.com, и ассерты гонялись с живой навигацией (process-map-6ja).
  await page.goto('/');
  await openStage(page, 0);

  // id узла берём из уже отрисованного приложения, чтобы тест не зависел от
  // конкретных строк в process.json.
  const stepId = await page
    .locator(STEP_CARD)
    .first()
    .evaluate((el) => el.closest('.react-flow__node')?.getAttribute('data-id') ?? null);
  expect(stepId, 'на полотне нет ни одной карточки шага').not.toBeNull();

  await page.evaluate(
    ({ key, id }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          [id]: { screen: { title: 'Объёмный план', url: 'https://example.com/' } },
        }),
      );
    },
    { key: OVERRIDES_KEY, id: stepId ?? '' },
  );

  await page.reload();
  await waitForStageDetailReady(page);

  const linkButton = page.locator(`[data-id="${stepId}"] button[aria-label^="Открыть экран"]`);
  await expect(linkButton).toHaveCount(1);

  const box = await linkButton.boundingBox();
  await page.mouse.click(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  );

  // Клик обязан дойти до openScreen. Без этой проверки тест остаётся зелёным и
  // тогда, когда кнопка вообще перестала открывать ссылку: «панель не открылась»
  // истинно и у мёртвой кнопки. В проекте такой пустой тест ловили уже не раз —
  // условие должно проверять тот механизм, ради которого написано.
  expect(await openCalls(page)).toEqual([['https://example.com/', '_blank']]);

  // Дальше — то, ради чего тест назван: клик по иконке НЕ выбрал узел и НЕ
  // открыл панель. Проверяется и то, и другое: aria-current — состояние в
  // store, панель — то, что видит пользователь (SPEC §4.2). Само отсутствие
  // всплытия события к обёртке узла проверяется юнит-тестом в
  // tests/stageDetail.test.tsx: соседство кнопок в разметке делает проверку
  // «узел не выбран» истинной и без stopPropagation.
  await expect(page.locator(`[data-id="${stepId}"] button[aria-current="true"]`)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-testid="drawer-scrim"]')).toHaveCount(0);

  await page.evaluate((key) => {
    window.localStorage.removeItem(key);
  }, OVERRIDES_KEY);
});

// Второе полотно приложения — attribution убран и здесь (process-map-4hv,
// обоснование в Overview.tsx). Отдельная проверка нужна потому, что proOptions
// задаётся в каждом <ReactFlow> свой.
test('ссылка-attribution React Flow на полотне детализации не отрисована', async ({ page }) => {
  await page.goto('/');
  await openStage(page, 0);

  await expect(page.locator('.react-flow__attribution')).toHaveCount(0);
});

test('узлы уровня 2 не перетаскиваются (CLAUDE.md, v1)', async ({ page }) => {
  await page.goto('/');
  await openStage(page, 0);

  const node = page.locator('.react-flow__node-step').first();
  // Сравнивается собственный transform узла, а не boundingBox: протаскивание
  // мышью панорамирует полотно, и экранные координаты законно меняются.
  const before = await node.evaluate((el) => (el as HTMLElement).style.transform);
  const box = await node.boundingBox();

  await page.mouse.move((box?.x ?? 0) + 20, (box?.y ?? 0) + 8);
  await page.mouse.down();
  await page.mouse.move((box?.x ?? 0) + 220, (box?.y ?? 0) + 120, { steps: 10 });
  await page.mouse.up();

  expect(await node.evaluate((el) => (el as HTMLElement).style.transform)).toBe(before);
});

test('кнопка «Назад» возвращает на обзор', async ({ page }) => {
  await page.goto('/');
  await openStage(page, 0);

  await page.getByRole('button', { name: 'Назад к обзору процесса' }).click();

  await expect(page.locator('.react-flow__node-stage')).toHaveCount(4);
  await expect(page.locator('.react-flow__node-step')).toHaveCount(0);
});

// ───────────── стартовый вид полотна (задача process-map-l8a) ─────────────
//
// fitView давал масштаб 0.25…0.53, то есть подпись шага 13px рисовалась в
// 3.2…6.9 px. Порог 12/13 ≈ 0.923 выведен из шкалы кеглей дизайн-системы
// (--scp-font-body-s = 12px — самый мелкий кегль основного текста).
const START_ZOOM_MIN = 12 / 13;

/** Масштаб вьюпорта React Flow из transform контейнера .react-flow__viewport. */
async function viewportZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
    return Number(/scale\(([^)]+)\)/.exec(viewport?.style.transform ?? '')?.[1] ?? '0');
  });
}

for (const index of [0, 1, 2, 3]) {
  test(`этап ${index + 1}: стартовый масштаб не мельче читаемого порога`, async ({ page }) => {
    await page.goto('/');
    await openStage(page, index);
    // Стартовый вьюпорт ставится в useEffect после измерения полотна.
    await page.waitForFunction(() => {
      const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
      return Number(/scale\(([^)]+)\)/.exec(viewport?.style.transform ?? '')?.[1] ?? '0') > 0.5;
    });

    const zoom = await viewportZoom(page);
    expect(zoom).toBeGreaterThanOrEqual(START_ZOOM_MIN - 0.001);
    expect(zoom).toBeLessThanOrEqual(1);
    // Тот же порог, но выраженный в том, что видит читатель.
    expect(13 * zoom).toBeGreaterThanOrEqual(12 - 0.01);
  });
}

// Переписан в задаче process-map-c18. Прежнее утверждение («самый левый узел
// графа виден слева») выполнялось буквально: слева оказывалась колонка входных
// данных и узлы-интеграции, а карточек шага в кадре не было ни одной — экран
// открывался, не показывая процесса. Теперь привязка идёт к первой карточке
// шага, и проверяется именно она.
test('этап открывается на первой карточке шага, а не на колонке входов', async ({ page }) => {
  await page.goto('/');
  await openStage(page, 0);
  await page.waitForFunction(() => {
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
    return Number(/scale\(([^)]+)\)/.exec(viewport?.style.transform ?? '')?.[1] ?? '0') > 0.5;
  });

  // Фильтр «Шаг: …» оставлен вторым сторожем поверх класса: до process-map-73m
  // он был единственным, потому что `.react-flow__node-step` носили и
  // интеграции, и проверка считала за процесс то, что процессом не является.
  const first = await page.evaluate(() => {
    let best: { id: string; x: number } | null = null;
    document.querySelectorAll('.react-flow__node-step').forEach((el) => {
      if (el.querySelector('button[aria-label^="Шаг: "]') === null) {
        return;
      }
      const rect = el.getBoundingClientRect();
      if (best === null || rect.x < best.x) {
        best = { id: el.getAttribute('data-id') ?? '', x: rect.x };
      }
    });
    return best as { id: string; x: number } | null;
  });

  expect(first).not.toBeNull();
  // Самая левая карточка ШАГА стоит в левой четверти экрана…
  expect(first?.x ?? 0).toBeGreaterThanOrEqual(0);
  expect(first?.x ?? 0).toBeLessThan(1280 / 4);
  // …и это именно первая карточка потока (минимальная по x в данных).
  expect(first?.id).toBe('sohranenie-predyduschih-versiy-planov');
});

test('компактное окно 1024×600: стартовый вид тоже читаем (SPEC §4.5)', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto('/');
  await openStage(page, 2);
  await page.waitForFunction(() => {
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
    return Number(/scale\(([^)]+)\)/.exec(viewport?.style.transform ?? '')?.[1] ?? '0') > 0.5;
  });

  const zoom = await viewportZoom(page);
  expect(zoom).toBeGreaterThanOrEqual(START_ZOOM_MIN - 0.001);
  expect(13 * zoom).toBeGreaterThanOrEqual(12 - 0.01);
});

test('ручной зум колесом по-прежнему позволяет отдалить схему целиком', async ({ page }) => {
  await page.goto('/');
  await openStage(page, 1);
  await page.waitForFunction(() => {
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
    return Number(/scale\(([^)]+)\)/.exec(viewport?.style.transform ?? '')?.[1] ?? '0') > 0.5;
  });

  // Порог 0.923 ограничивает ТОЛЬКО стартовый вид: minZoom полотна остался 0.1.
  await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane') as HTMLElement;
    for (let i = 0; i < 40; i += 1) {
      pane.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: 120,
          ctrlKey: true,
          clientX: 640,
          clientY: 400,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  });
  await page.waitForTimeout(500);

  expect(await viewportZoom(page)).toBeLessThan(START_ZOOM_MIN);
});

test('в редакторе блок двигается и сдвиг переживает перезагрузку', async ({ page }) => {
  // ВОПРОС ВЛАДЕЛЬЦА 08.09.2026: «а сами блоки можно двигать?». Перетаскивание
  // было заявлено 07.09.2026 (nodesDraggable в режиме «Редактор» + onNodeDragStop
  // → moveNode), но НЕ РАБОТАЛО: каждому узлу stageGraph.ts проставлял
  // `draggable: false`, а он перекрывает общий `nodesDraggable`. Теста не было —
  // соседний проверяет ровно обратное, что в «Просмотре» узел не двигается, и
  // оставался зелёным при полностью сломанной правке.
  //
  // СРАВНИВАЕТСЯ style.transform, а НЕ boundingBox. Оба соседних теста этого
  // файла уже объясняют половину причины: протаскивание панорамирует полотно.
  // Вторая половина видна только здесь: после перезагрузки габарит карты стал
  // другим (узел уехал), StartViewport выбирает другой масштаб, и ЭКРАННЫЕ
  // расстояния масштабируются вместе с ним. transform живёт в координатах схемы
  // и от масштаба не зависит.
  //
  // Узел ВНУТРИ ГРУППЫ выбран намеренно: React Flow отдаёт его position
  // относительно контейнера, а в overrides координаты абсолютные. На узле без
  // группы обе величины совпадают, и ошибка приведения координат осталась бы
  // невидимой ровно там, где она есть.
  const MOVED = 'sohranenie-predyduschih-versiy-planov';

  await page.goto('/?stage=1');
  await waitForStageDetailReady(page);
  const moved = page.locator(`.react-flow__node-step[data-id="${MOVED}"]`);
  await expect(moved).toBeVisible();

  const transform = async (): Promise<string> =>
    moved.evaluate((el) => (el as HTMLElement).style.transform);

  const before = await transform();

  const editor = page.getByRole('button', { name: 'Редактор', exact: true });
  await editor.click();
  await expect(editor).toHaveAttribute('aria-pressed', 'true');

  // Настоящая последовательность мыши с промежуточными шагами: React Flow тащит
  // узел по pointermove и «мгновенный» переход из точки в точку игнорирует.
  const box = await moved.boundingBox();
  await page.mouse.move((box?.x ?? 0) + 20, (box?.y ?? 0) + 8);
  await page.mouse.down();
  await page.mouse.move((box?.x ?? 0) + 140, (box?.y ?? 0) + 180, { steps: 12 });
  await page.mouse.up();

  const after = await transform();
  expect(after, 'карточка не сдвинулась в режиме «Редактор»').not.toBe(before);

  // Сдвиг обязан пережить перезагрузку: правки живут в overrides localStorage.
  await page.reload();
  await waitForStageDetailReady(page);
  expect(await transform(), 'сдвиг не пережил перезагрузку').toBe(after);
});
