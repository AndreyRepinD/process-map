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
   * Узел с привязкой к алгоритмам Менеджера процессов и одно из его имён.
   *
   * `null` — у карты нет реестра алгоритмов (snp, mrp): их в платформе не
   * снимали, и секция «Алгоритмы в платформе» на такой карте не показывается
   * вовсе. Это не «пока не заполнено», а осознанное состояние — подсказать
   * планировщику SNP имена MEIO значило бы предложить неверную привязку.
   *
   * ЗАЧЕМ ЗДЕСЬ, А НЕ ИЗ src/data/algorithms.ts: e2e намеренно ничего из src/
   * не импортируют — проверка «что видит пользователь» не должна брать
   * ожидаемое значение оттуда же, откуда его берёт приложение.
   */
  algorithmNode: { stage: number; node: string; algorithm: string } | null;
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
    algorithmNode: null,
  },
  mrp: {
    moduleLabel: 'Модуль MRP',
    pageTitle: 'Процесс планирования потребности в материалах',
    stageCount: 4,
    stageBadge: '4 этапа',
    algorithmNode: null,
  },
  dp: {
    moduleLabel: 'Модуль DP',
    pageTitle: 'Процесс планирования спроса',
    // Пять этапов — первая карта репозитория не с четырьмя. Обзор раскладывает
    // их сеткой 4+1 (MAX_STAGE_COLUMNS в overviewGraph.ts), а не одним рядом.
    stageCount: 5,
    stageBadge: '5 этапов',
    algorithmNode: {
      stage: 1,
      node: 'proverka-kachestva-dannyh',
      algorithm: 'DP Проверка данных на консистентность',
    },
  },
  meio: {
    moduleLabel: 'Модуль MEIO',
    pageTitle: 'Процесс мультиэшелонной оптимизации запасов',
    stageCount: 4,
    stageBadge: '4 этапа',
    algorithmNode: {
      stage: 1,
      node: 'proverka-cepochki-na-svyazannost',
      algorithm: 'MEIO проверка цепочки на целостность',
    },
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
