// Какую карту собираем — единственная точка, где это известно (process-map-3wh.6).
//
// ЗАЧЕМ. Приложение показывает ОДНУ карту, но карт в репозитории несколько
// (src/data/<id>/process.json). Выбор делается на сборке, а не в рантайме:
// роутера и переключателя карт в интерфейсе нет (решение владельца), в бандл
// попадает ровно один JSON, а разные карты раздаются с разных адресов
// (корень — snp, подкаталог /mrp/ — mrp).
//
// ПОЧЕМУ ЗДЕСЬ, А НЕ В КАЖДОМ КОНФИГЕ. vitest.config.ts — отдельный файл, и
// Vitest при его наличии vite.config.ts НЕ ЧИТАЕТ ВОВСЕ (заменяет, а не
// мержит). Алиас, объявленный только в одном из них, даёт зелёный `npm run
// build` и красный `vitest run` — и наоборот. Оба конфига обязаны брать его
// отсюда; инлайнить путь в конфиге нельзя.
//
// Файл лежит в scripts/, потому что eslint.config.js уже разрешает там
// globals.node, а src/** уезжает в браузер и process в нём запрещён.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Карты, которые умеет собирать проект. Второй экземпляр этого списка —
 * реестр MAPS в scripts/import-pptx.py (там же презентации и профили разбора);
 * их совпадение сторожит tests/mapRegistry.test.ts.
 */
export const MAP_IDS = ['snp', 'mrp', 'dp', 'meio'] as const;
export type MapId = (typeof MAP_IDS)[number];

/** Карта, которая раздаётся из корня сайта и собирается без флагов. */
export const DEFAULT_MAP: MapId = 'snp';

/**
 * Корень репозитория. Считается ЛЕНИВО: модуль импортируется в том числе из
 * тестов через scripts/layout.ts, а там import.meta.url — не file:-URL, и
 * вычисление на уровне модуля уронило бы импорт (тот же довод, что у
 * jsonPath() в scripts/layout.ts).
 */
function root(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

export function isMapId(value: string): value is MapId {
  return (MAP_IDS as readonly string[]).includes(value);
}

function assertMapId(value: string, source: string): MapId {
  if (!isMapId(value)) {
    throw new Error(`Неизвестная карта «${value}» (${source}). Известны: ${MAP_IDS.join(', ')}.`);
  }
  return value;
}

/**
 * Карта из переменной окружения MAP; пусто — карта по умолчанию.
 *
 * Неизвестное значение роняет сборку, а не откатывается на карту по умолчанию:
 * опечатка в MAP собрала бы под адресом второй карты первую, и заметить это
 * можно было бы только глазами на стенде.
 */
export function mapIdFromEnv(raw: string | undefined = process.env['MAP']): MapId {
  if (raw === undefined || raw === '') {
    return DEFAULT_MAP;
  }
  return assertMapId(raw, 'переменная MAP');
}

/** Карта из аргументов командной строки: `--map <id>`. */
export function mapIdFromArgv(argv: readonly string[]): MapId {
  const index = argv.indexOf('--map');
  if (index === -1) {
    return DEFAULT_MAP;
  }
  const value = argv[index + 1];
  if (value === undefined) {
    throw new Error('--map требует значение, например: --map snp');
  }
  return assertMapId(value, '--map');
}

/** Каталог данных карты. */
export function mapDir(id: MapId): string {
  return resolve(root(), 'src', 'data', id);
}

/** Файл данных карты — для scripts/layout.ts и для чтения заголовка на сборке. */
export function mapJsonPath(id: MapId): string {
  return resolve(mapDir(id), 'process.json');
}

/**
 * Алиас `@map` для resolve.alias в vite.config.ts И в vitest.config.ts.
 * Через него src/data/loader.ts импортирует данные, не зная, какая это карта.
 */
export function mapAlias(id: MapId): Record<string, string> {
  return { '@map': mapDir(id) };
}

/**
 * Каталог сборки. Карта по умолчанию раздаётся из корня, остальные — из
 * подкаталога по своему id: base в vite.config.ts относительный ('./'),
 * поэтому подкаталог работает без правок путей к ассетам.
 */
export function mapOutDir(id: MapId): string {
  return id === DEFAULT_MAP ? 'dist' : `dist/${id}`;
}

/** Заголовок карты из её данных — единственный источник и для страницы, и для вкладки. */
export function mapTitle(id: MapId): string {
  const raw = JSON.parse(readFileSync(mapJsonPath(id), 'utf8')) as { title?: unknown };
  if (typeof raw.title !== 'string' || raw.title === '') {
    throw new Error(`В ${mapJsonPath(id)} нет непустого поля title`);
  }
  return raw.title;
}
