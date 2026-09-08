// Правка карты прямо в браузере: подпись и описание, удаление блока, связи.
//
// ЗАЧЕМ ЭТОТ ФАЙЛ (08.09.2026). Владелец спросил подряд: можно ли двигать блоки,
// удалять их, менять название и описание, соединять между собой. На все четыре
// вопроса код отвечал «да», но проверки не было НИ ОДНОЙ — и первый же прогон
// показал, что перетаскивание не работало вовсе (узлам стоял `draggable: false`,
// перекрывавший `nodesDraggable` полотна). Ответ «сделано» без прогона в
// браузере в этом репозитории больше не считается ответом.
//
// Проверяется весь путь целиком: правка через интерфейс → запись в overrides →
// перезагрузка. Отдельно записанный override ничего не доказывает: правка может
// лечь в localStorage и не примениться при чтении.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const VIEWPORT = { width: 1280, height: 720 };
const STEP_CARD = '.react-flow__node-step button[aria-label^="Шаг: "]';

/** Узел этапа 1 карты SNP: он в группе и у него есть исходящие связи. */
const NODE = 'sohranenie-predyduschih-versiy-planov';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
});

/**
 * Открывает панель узла, если её ещё нет.
 *
 * После page.reload() панель открывается САМА: deep-link (?stage=&node=,
 * SPEC §4.7) восстанавливает выбранный узел. Клик по карточке в этот момент
 * перехватывает затемнение полотна — и тест падал бы на верной правке.
 */
async function ensureDrawer(page: Page, nodeId: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  if ((await dialog.count()) === 0) {
    await page.locator(`[data-id="${nodeId}"] button`).first().click();
  }
  await expect(dialog).toBeVisible();
}

/** Открывает этап 1 в режиме «Редактор». Панель узла НЕ открывает. */
async function enterEditor(page: Page): Promise<void> {
  await page.goto('/?stage=1');
  await page.waitForSelector(STEP_CARD);
  const editor = page.getByRole('button', { name: 'Редактор', exact: true });
  await editor.click();
  await expect(editor).toHaveAttribute('aria-pressed', 'true');
}

/**
 * Редактор плюс открытая панель узла.
 *
 * ОТДЕЛЬНО ОТ enterEditor НАМЕРЕННО: открытая панель затемняет полотно, и
 * затемнение перехватывает жесты по нему. Тест изменения размера тянет рамку
 * прямо на полотне и падал именно из-за этого — с диагнозом «карточка не
 * растянулась», хотя растягивание работало.
 */
async function openInEditor(page: Page, nodeId: string): Promise<void> {
  await enterEditor(page);
  await ensureDrawer(page, nodeId);
}

test('подпись и описание блока правятся и переживают перезагрузку', async ({ page }) => {
  await openInEditor(page, NODE);

  await page.getByRole('button', { name: 'Править блок' }).click();
  const label = page.getByLabel('Подпись');
  await label.fill('Сохранение версий (правка владельца)');
  const description = page.getByLabel('Описание');
  await description.fill('Описание, введённое прямо на карте.');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();

  // Подпись видна на самой карточке, а не только в панели.
  const card = page.locator(`[data-id="${NODE}"]`);
  await expect(card).toContainText('Сохранение версий (правка владельца)');

  await page.reload();
  await page.waitForSelector(STEP_CARD);
  await expect(page.locator(`[data-id="${NODE}"]`)).toContainText(
    'Сохранение версий (правка владельца)',
  );
  await ensureDrawer(page, NODE);
  await expect(page.getByRole('dialog')).toContainText('Описание, введённое прямо на карте.');
});

test('блок соединяется с другим и связь переживает перезагрузку', async ({ page }) => {
  await openInEditor(page, NODE);

  const dialog = page.getByRole('dialog');
  const select = dialog.getByLabel('Соединить с');
  const target = await select.locator('option').nth(1).getAttribute('value');
  expect(target).not.toBeNull();
  const targetName = await select.locator('option').nth(1).innerText();
  await select.selectOption(target ?? '');
  await dialog.getByRole('button', { name: 'Соединить' }).click();

  // Связь появилась в списке исходящих.
  await expect(dialog).toContainText(targetName);

  await page.reload();
  await page.waitForSelector(STEP_CARD);
  // Режим после перезагрузки всегда «Просмотр» (useProcessStore: он намеренно не
  // сохраняется), а секция связей рисуется только в редакторе — читателю вики
  // связи видны стрелками на полотне, а список ему ни к чему.
  const editorAgain = page.getByRole('button', { name: 'Редактор', exact: true });
  await editorAgain.click();
  await expect(editorAgain).toHaveAttribute('aria-pressed', 'true');
  await ensureDrawer(page, NODE);
  await expect(page.getByRole('dialog')).toContainText(targetName);
  // И нарисована ребром на полотне, а не только в списке.
  await expect(page.locator(`.react-flow__edge`).filter({ hasText: '' })).not.toHaveCount(0);
});

test('блок удаляется с карты и не возвращается после перезагрузки', async ({ page }) => {
  await openInEditor(page, NODE);
  const before = await page.locator('.react-flow__node-step').count();

  page.once('dialog', (confirm) => void confirm.accept());
  await page.getByRole('button', { name: 'Править блок' }).click();
  await page.getByRole('button', { name: 'Удалить блок' }).click();

  await expect(page.locator(`[data-id="${NODE}"]`)).toHaveCount(0);
  expect(await page.locator('.react-flow__node-step').count()).toBe(before - 1);

  await page.reload();
  await page.waitForSelector(STEP_CARD);
  await expect(page.locator(`[data-id="${NODE}"]`)).toHaveCount(0);
});

test('размер блока меняется и переживает перезагрузку', async ({ page }) => {
  // Вопрос владельца 08.09.2026: «размер можно менять блоков?». До правки — нет:
  // габарит брался из констант темы и ничем не менялся.
  //
  // Меряется ШИРИНА самой карточки, а не узла React Flow: карточка обязана
  // тянуться за узлом. Иначе рамка растянулась бы, а прямоугольник на экране
  // остался прежним — правка «сработала» бы только в хранилище.
  // Панель узла НЕ открывается: её затемнение перехватило бы жест по рамке.
  await enterEditor(page);
  // Меряется КАРТОЧКА (button), а не узел React Flow: узел растягивается сам по
  // себе, а видимый прямоугольник обязан идти за ним. Мерить узел значило бы
  // проверять React Flow, а не карту.
  const card = page.locator(`[data-id="${NODE}"] button`).first();
  const widthOf = async (): Promise<number> => (await card.boundingBox())?.width ?? 0;
  const before = await widthOf();

  // Правая ГРАНЬ рамки, а не угловой маркер: она меняет только ширину, и жест
  // по ней не смешивает две величины в одном измерении.
  const handle = page.locator(`[data-id="${NODE}"] .pm-resize-line.right`).first();
  await expect(handle).toBeVisible();
  const grip = await handle.boundingBox();
  const gx = (grip?.x ?? 0) + (grip?.width ?? 0) / 2;
  const gy = (grip?.y ?? 0) + (grip?.height ?? 0) / 2;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + 20, gy, { steps: 4 });
  await page.mouse.move(gx + 120, gy, { steps: 10 });
  await page.mouse.up();

  const after = await widthOf();
  expect(after, 'карточка не растянулась').toBeGreaterThan(before + 40);

  await page.reload();
  await page.waitForSelector(STEP_CARD);
  expect(await widthOf(), 'размер не пережил перезагрузку').toBeCloseTo(after, 0);
});

test('внешняя карточка правится с ОБЗОРА, и подпись меняется в обоих местах', async ({ page }) => {
  // Решение владельца 08.09.2026: «внешние карточки я тоже хочу править — не
  // только то, что внутри этапов, но и снаружи».
  //
  // Плашка внешней системы существует на карте ДВАЖДЫ: на экране этапа это
  // обычный data-узел, на обзоре — запись ExternalIO в свимлейне. Правится один
  // и тот же узел, поэтому проверяется именно СВЯЗЬ: переименовали с обзора —
  // изменилось и там, и на этапе.
  await page.goto('/');
  await page.waitForSelector('.react-flow__node-stage');

  const editor = page.getByRole('button', { name: 'Редактор', exact: true });
  await editor.click();
  await expect(editor).toHaveAttribute('aria-pressed', 'true');

  // В просмотре карточка не кнопка — читателю вики жать не на что; в редакторе
  // становится кнопкой с доступным именем.
  const card = page.getByRole('button', { name: /^Править внешнюю карточку: / }).first();
  await expect(card).toBeVisible();
  await card.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Править блок' }).click();
  await dialog.getByLabel('Подпись').fill('Внешний вход, правка с обзора');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();

  // Подпись видна на самом обзоре, в свимлейне внешних систем.
  await expect(
    page.getByRole('button', { name: 'Править внешнюю карточку: Внешний вход, правка с обзора' }),
  ).toBeVisible();

  // И на экране этапа — та же карточка с той же подписью: узел один.
  await page.goto('/?stage=1');
  await page.waitForSelector(STEP_CARD);
  await expect(page.getByText('Внешний вход, правка с обзора').first()).toBeVisible();
});

test('подпись системы и белая рамка группы правятся из панели', async ({ page }) => {
  // Вопросы владельца 08.09.2026: «белый фон также можно добавить? и подпись к
  // нему? там где шаг идёт» и «под серыми плашками у тебя ещё подпись есть DP
  // например — как её добавить?».
  //
  // Оба — поля УЗЛА, которых просто не было в форме: код системы (подпись под
  // карточкой) и группа (белая рамка с заголовком вокруг карточек этапа).
  await openInEditor(page, NODE);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Править блок' }).click();

  await dialog.getByLabel('Код системы под карточкой').selectOption('ERP');
  await dialog.getByLabel('Группа (белая рамка с заголовком)').fill('Новая рамка владельца');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();

  // Рамка с заголовком появилась на полотне, и карточка внутри неё.
  await expect(page.getByText('Новая рамка владельца')).toBeVisible();

  await page.reload();
  await page.waitForSelector(STEP_CARD);
  await expect(page.getByText('Новая рамка владельца')).toBeVisible();

  // Подпись системы переживает перезагрузку вместе с рамкой.
  const editor = page.getByRole('button', { name: 'Редактор', exact: true });
  await editor.click();
  await ensureDrawer(page, NODE);
  await page.getByRole('dialog').getByRole('button', { name: 'Править блок' }).click();
  await expect(page.getByRole('dialog').getByLabel('Код системы под карточкой')).toHaveValue('ERP');
  await expect(
    page.getByRole('dialog').getByLabel('Группа (белая рамка с заголовком)'),
  ).toHaveValue('Новая рамка владельца');
});

test('на обзоре карточки двигаются в редакторе и остаются на месте', async ({ page }) => {
  // Владелец 08.09.2026: «на центральной странице хочу двигать блоки также —
  // сейчас не могу». Обзор считает раскладку сам (у Stage и ExternalIO нет
  // position в схеме), поэтому переставленное место живёт в тех же правках
  // браузера и подставляется при сборке графа.
  await page.goto('/');
  await page.waitForSelector('.react-flow__node-stage');

  const card = page.locator('.react-flow__node-stage').first();
  const cardId = await card.getAttribute('data-id');
  const transform = async (): Promise<string> =>
    page
      .locator(`.react-flow__node-stage[data-id="${cardId ?? ''}"]`)
      .evaluate((el) => (el as HTMLElement).style.transform);

  const before = await transform();

  // В просмотре карточка не двигается — читателю вики двигать нечего.
  const box = await card.boundingBox();
  await page.mouse.move((box?.x ?? 0) + 30, (box?.y ?? 0) + 12);
  await page.mouse.down();
  await page.mouse.move((box?.x ?? 0) + 160, (box?.y ?? 0) + 120, { steps: 10 });
  await page.mouse.up();
  expect(await transform(), 'в просмотре карточка сдвинулась').toBe(before);

  const editor = page.getByRole('button', { name: 'Редактор', exact: true });
  await editor.click();
  await expect(editor).toHaveAttribute('aria-pressed', 'true');

  const box2 = await card.boundingBox();
  await page.mouse.move((box2?.x ?? 0) + 30, (box2?.y ?? 0) + 12);
  await page.mouse.down();
  await page.mouse.move((box2?.x ?? 0) + 160, (box2?.y ?? 0) + 120, { steps: 10 });
  await page.mouse.up();

  const after = await transform();
  expect(after, 'в редакторе карточка не сдвинулась').not.toBe(before);

  await page.reload();
  await page.waitForSelector('.react-flow__node-stage');
  expect(await transform(), 'сдвиг не пережил перезагрузку').toBe(after);
});
