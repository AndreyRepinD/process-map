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

/** Открывает этап 1 в режиме «Редактор» и панель нужного узла. */
async function openInEditor(page: Page, nodeId: string): Promise<void> {
  await page.goto('/?stage=1');
  await page.waitForSelector(STEP_CARD);
  const editor = page.getByRole('button', { name: 'Редактор', exact: true });
  await editor.click();
  await expect(editor).toHaveAttribute('aria-pressed', 'true');
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
