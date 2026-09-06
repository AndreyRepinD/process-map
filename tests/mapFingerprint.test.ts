// Сторож даты «Обновлено» (process-map-vjz.10).
//
// ЗАЧЕМ. MAP_UPDATED_AT в scripts/import-pptx.py — объявленная константа, и
// иначе быть не может: содержание карты собирается из презентации И из таблиц
// решений владельца внутри импортёра, а у вторых метки времени нет. Значит дату
// ставит человек — и однажды он забудет. Ровно это и случилось: карта менялась
// пять раз, дата осталась прежней.
//
// ЧТО ДЕЛАЕТ ЭТОТ ФАЙЛ. Связывает объявленную дату с содержанием, которое она
// описывает: рядом с ней лежит отпечаток process.json, и разойтись они не могут
// молча. Автоматически пересчитывать отпечаток в импортёре НЕЛЬЗЯ — тогда он
// всегда совпадал бы и дата протухла бы тем же способом.
//
// ПОЧЕМУ ОДИН ФАЙЛ НА ВСЕ КАРТЫ (process-map-3wh.15). Константы карт объявлены
// плоскими именами с суффиксом (MAP_UPDATED_AT и MAP_UPDATED_AT_MRP), а не
// словарём, ИМЕННО ради этого теста: регулярка ^ИМЯ = "значение" тогда работает
// для любой карты, и добавление третьей стоит одной строки в таблице ниже.
//
// ПОЧЕМУ ЗДЕСЬ, А НЕ В PYTHON. Python в CI не запускается вовсе (см.
// .github/workflows/deploy.yml), поэтому проверка на стороне импортёра никого
// не остановила бы. Константы читаются из исходника регуляркой — тот же приём,
// что в tests/importPreserve.test.ts.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const IMPORTER_PATH = resolve(process.cwd(), 'scripts', 'import-pptx.py');
const importerSource = readFileSync(IMPORTER_PATH, 'utf8');

/** Карта → суффикс её констант в импортёре. У карты по умолчанию суффикса нет. */
const MAPS = [
  { id: 'snp', suffix: '' },
  { id: 'mrp', suffix: '_MRP' },
  { id: 'dp', suffix: '_DP' },
  { id: 'meio', suffix: '_MEIO' },
] as const;

/** Читает python-константу-строку верхнего уровня по имени. */
function readPythonString(name: string): string {
  // String.raw, а не обычный шаблон: в нём `\s` схлопывается в `s`, потому что
  // это не распознанная escape-последовательность. Регулярка тогда молча
  // перестаёт работать — на этом я и попался при написании теста.
  const match = new RegExp(String.raw`^${name}\s*=\s*"([^"]*)"`, 'm').exec(importerSource);
  if (match === null) {
    throw new Error(`В scripts/import-pptx.py не найдена константа ${name}`);
  }
  return match[1]!;
}

/**
 * Отпечаток содержания карты.
 *
 * updatedAt заменяется плейсхолдером, а НЕ удаляется: замена сохраняет порядок
 * ключей, а главное — разрывает круг «правка даты меняет хеш, а новый хеш
 * требует правки даты». С плейсхолдером правка даты отпечатка не требует, а
 * правка данных требует — ровно то, что нужно.
 *
 * position участвует: изменилась картинка — изменилась карта. Если апгрейд
 * dagre начнёт требовать бампа даты без содержательных правок, координаты можно
 * исключить здесь одной строкой (их корректность сторожит tests/layout.test.ts).
 */
function fingerprintOf(rawJson: string): string {
  const map: unknown = JSON.parse(rawJson);
  const canonical = { ...(map as Record<string, unknown>), updatedAt: '<updatedAt>' };
  return createHash('sha256')
    .update(JSON.stringify(canonical, null, 2) + '\n', 'utf8')
    .digest('hex');
}

describe.each(MAPS)('дата «Обновлено» описывает содержание карты $id', ({ id, suffix }) => {
  const jsonSource = readFileSync(
    resolve(process.cwd(), 'src', 'data', id, 'process.json'),
    'utf8',
  );

  it('отпечаток содержания совпадает с объявленным в импортёре', () => {
    const actual = fingerprintOf(jsonSource);
    const declared = readPythonString(`MAP_DATA_FINGERPRINT${suffix}`);

    expect(
      actual,
      [
        `Содержание src/data/${id}/process.json изменилось, а дата в шапке — нет.`,
        'В scripts/import-pptx.py поставьте:',
        `  MAP_UPDATED_AT${suffix} = "<дата правки, YYYY-MM-DD>"`,
        `  MAP_DATA_FINGERPRINT${suffix} = "${actual}"`,
        `и прогоните npm run data -- --map ${id}.`,
      ].join('\n'),
    ).toBe(declared);
  });

  it('объявленная дата доехала до данных и имеет формат ISO', () => {
    // Зеркальный случай к проверке выше и с ДРУГИМ диагнозом: константу
    // поправили, а конвейер не прогнали. Одинаковое сообщение на два инварианта
    // сделало бы красный тест нечитаемым.
    const declared = readPythonString(`MAP_UPDATED_AT${suffix}`);
    const inData = (JSON.parse(jsonSource) as { updatedAt: string }).updatedAt;

    expect(declared).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(inData, 'MAP_UPDATED_AT правили, а npm run data не прогоняли — данные отстали').toBe(
      declared,
    );
  });
});
