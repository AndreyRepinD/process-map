// Каждая переменная, на которую ссылается CSS, обязана быть объявлена в теме.
//
// ЗАЧЕМ ЭТОТ СТОРОЖ (08.09.2026). Владелец не мог найти на карте, чем менять
// название блока. Кнопка «Править блок» была на месте и работала — но её цвет
// брался из `--scp-content-action-brand`, которого в src/theme/tokens.css нет.
// Несуществующая переменная в CSS НЕ ПАДАЕТ: объявление просто отбрасывается,
// и кнопка унаследовала чёрный цвет заголовка. Для глаза она перестала быть
// кнопкой, для кода осталась ею — ни тест, ни сборка не возражали.
//
// Это ровно случай «мёртвая константа врёт тише, чем падает»: сборка зелёная,
// интерфейс сломан. Одной такой находки достаточно, чтобы завести проверку —
// тем более что вместе с ней нашлись ещё две, обе свежие.
//
// ПОЧЕМУ РЕГУЛЯРКОЙ, А НЕ РАЗБОРОМ CSS. Проверяется ровно одно: имя переменной
// в `var(--…)` встречается среди объявлений темы. Для этого парсер не нужен, а
// его поведение на @-правилах пришлось бы отдельно объяснять.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const TOKENS_FILE = join(SRC, 'theme', 'tokens.css');

/** Имена, объявленные в теме: `--scp-…:` или `--pm-…:`. */
function declaredTokens(): Set<string> {
  const text = readFileSync(TOKENS_FILE, 'utf8');
  return new Set([...text.matchAll(/(--(?:scp|pm)-[a-z0-9-]+)\s*:/g)].map((m) => m[1] ?? ''));
}

function cssFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...cssFiles(full));
    } else if (entry.endsWith('.css') && full !== TOKENS_FILE) {
      found.push(full);
    }
  }
  return found;
}

describe('переменные темы', () => {
  const tokens = declaredTokens();

  it('тема не пуста — иначе проверка ниже была бы пустой формальностью', () => {
    expect(tokens.size).toBeGreaterThan(100);
  });

  it('каждая var(--scp-*/--pm-*) объявлена в src/theme/tokens.css', () => {
    const dead: string[] = [];
    for (const file of cssFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/var\(\s*(--(?:scp|pm)-[a-z0-9-]+)/g)) {
        const name = match[1] ?? '';
        if (!tokens.has(name)) {
          dead.push(`${file.slice(SRC.length + 1)}: ${name}`);
        }
      }
    }
    // Сообщение перечисляет ФАЙЛ И ИМЯ: «где-то есть мёртвый токен» пришлось бы
    // искать глазами по трёмстам объявлениям.
    expect(dead, `ссылки на необъявленные переменные:\n${dead.join('\n')}`).toEqual([]);
  });
});
