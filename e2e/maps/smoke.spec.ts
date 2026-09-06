// Смоук карты: единственный спек, который гоняется для КАЖДОЙ карты
// (задача process-map-3wh.3).
//
// ЗАЧЕМ ОН ОДИН. Остальные десять спеков — про механику интерфейса, и второй
// прогон их для другой карты не добавляет сигнала, зато добавляет времени и
// новый класс падений: они содержат подписи и id узлов SNP дословно. Поэтому
// они лежат вне e2e/maps/ и гоняются только для карты по умолчанию, а сюда
// вынесено то, что обязано работать на любой карте.
//
// ВСЁ, ЧТО ЗАВИСИТ ОТ КАРТЫ, берётся из e2e/maps/expected.ts по имени проекта
// Playwright. Литералов вроде «Модуль SNP» здесь быть не должно.
import { expect, test } from '../fixtures';
import { expectationsFor } from './expected';

const VIEWPORT = { width: 1280, height: 720 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/');
  await page.waitForSelector('.react-flow__node-stage');
});

test('обзор: шапка, карточки этапов, дата', async ({ page }, testInfo) => {
  // Здесь же ловится дефект относительных путей к ассетам (base: './'): при
  // нерабочем base бандл не загрузился бы и полотно осталось бы пустым.
  //
  // ЧИСЛО ЭТАПОВ — ИЗ ТАБЛИЦЫ, А НЕ ЛИТЕРАЛОМ. Было зашито «4 этапа» и
  // toHaveCount(4): четвёрка держалась на том, что обе карты репозитория
  // четырёхэтапные. Карта DP пятиэтапная, и литерал уронил бы смоук на ней —
  // причём с диагнозом «не загрузилось», хотя загрузилось всё.
  const expected = expectationsFor(testInfo.project.name);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(expected.stageBadge)).toBeVisible();
  await expect(page.getByText(/^Обновлено /)).toBeVisible();
  await expect(page.locator('.react-flow__node-stage')).toHaveCount(expected.stageCount);
});

test('заголовок вкладки — заголовок этой карты', async ({ page }, testInfo) => {
  // Подставляется плагином сборки (vite.config.ts) из данных карты. Без этой
  // проверки промах подстановки был бы невидим: сборка осталась бы зелёной, а
  // на странице второй карты стоял бы заголовок первой.
  await expect(page).toHaveTitle(expectationsFor(testInfo.project.name).pageTitle);
});

test('поток этапов обведён рамкой с подписью своего модуля', async ({ page }, testInfo) => {
  const frame = page.locator('.react-flow__node-flowLane');
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveText(expectationsFor(testInfo.project.name).moduleLabel);
});

test('переход на уровень 2 и возврат кнопкой «Назад»', async ({ page }, testInfo) => {
  const card = page.locator('.react-flow__node-stage button').first();
  await expect(card).toHaveAttribute('aria-label', /^Этап \d: /);

  // Настоящий клик мышью по центру, а не click() по локатору: React Flow
  // глушит pointer-events у обёртки узла, и синтетический клик доказывал бы
  // меньше (тот же приём в e2e/journey.spec.ts).
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  );

  await page.waitForSelector('.react-flow__node-step');
  await expect(page.locator('.react-flow__node-stage')).toHaveCount(0);

  // Корень крошек — <span>, а не ссылка: назад ведёт отдельная кнопка слева
  // (Breadcrumbs.tsx). Подпись корня одинакова для всех карт, поэтому её можно
  // проверять литералом и здесь.
  await expect(page.getByText('E2E-процесс')).toBeVisible();
  await page.getByRole('button', { name: 'Назад к обзору процесса' }).click();
  await expect(page.locator('.react-flow__node-stage')).toHaveCount(
    expectationsFor(testInfo.project.name).stageCount,
  );
});
