// Что e2e/maps/smoke.spec.ts ожидает увидеть на каждой карте
// (задача process-map-3wh.3).
//
// ЗАЧЕМ ОТДЕЛЬНАЯ ТАБЛИЦА. Смоук — единственный спек, который гоняется для
// ОБЕИХ карт, поэтому литерала вроде «Модуль SNP» в нём быть не может: он
// покраснел бы на MRP. Ожидания выбираются по имени проекта Playwright.
//
// e2e намеренно не импортируют ничего из src/ (в том числе i18n и данные):
// проверка «что видит пользователь» не должна брать ожидаемое значение из
// того же места, откуда его берёт приложение.

export interface MapExpectations {
  /** Подпись рамки вокруг потока этапов (.react-flow__node-flowLane). */
  moduleLabel: string;
  /** Заголовок вкладки: его подставляет плагин сборки из данных карты. */
  pageTitle: string;
  /** Сколько карточек этапов на обзоре. */
  stageCount: number;
  /**
   * Текст бейджа в шапке целиком: «4 этапа», «5 этапов».
   *
   * ПОЧЕМУ СТРОКОЙ, А НЕ ФОРМУЛОЙ ОТ stageCount. Множественное число считает
   * pluralRu из src/utils/format.ts, а e2e намеренно ничего из src/ не
   * импортируют: проверка «что видит пользователь» не должна брать ожидаемое
   * значение оттуда же, откуда его берёт приложение. Формула здесь была бы
   * копией той же логики и молча повторила бы её ошибку.
   */
  stageBadge: string;
}

export const MAP_EXPECTATIONS: Record<string, MapExpectations> = {
  snp: {
    moduleLabel: 'Модуль SNP',
    pageTitle: 'E2E-процесс планирования поставок',
    stageCount: 4,
    stageBadge: '4 этапа',
  },
  mrp: {
    moduleLabel: 'Модуль MRP',
    pageTitle: 'Процесс планирования потребности в материалах',
    stageCount: 4,
    stageBadge: '4 этапа',
  },
  dp: {
    moduleLabel: 'Модуль DP',
    pageTitle: 'Процесс планирования спроса',
    // Пять этапов — первая карта репозитория не с четырьмя. Обзор раскладывает
    // их сеткой 4+1 (MAX_STAGE_COLUMNS в overviewGraph.ts), а не одним рядом.
    stageCount: 5,
    stageBadge: '5 этапов',
  },
  meio: {
    moduleLabel: 'Модуль MEIO',
    pageTitle: 'Процесс мультиэшелонной оптимизации запасов',
    stageCount: 4,
    stageBadge: '4 этапа',
  },
};

/**
 * Ожидания для текущего проекта Playwright.
 *
 * Проект Playwright назван по id карты (playwright.config.ts). Пустое имя —
 * запуск вне проектов (например, `npx playwright test` со старым конфигом);
 * тогда смоук гоняется против карты по умолчанию.
 */
export function expectationsFor(projectName: string): MapExpectations {
  const id = projectName === '' ? 'snp' : projectName;
  const expectations = MAP_EXPECTATIONS[id];
  if (expectations === undefined) {
    throw new Error(
      `Нет ожиданий для карты «${id}». Проект Playwright назван по id карты; ` +
        `добавьте запись в MAP_EXPECTATIONS (e2e/maps/expected.ts). ` +
        `Известны: ${Object.keys(MAP_EXPECTATIONS).join(', ')}.`,
    );
  }
  return expectations;
}
