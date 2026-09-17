// Контракт между картами DP и MEIO: что DP отдаёт, то MEIO и ждёт.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ТЕСТ (решение владельца 17.09.2026, п.8 разбора аудита
// карты DP). До этого две карты одного репозитория противоречили друг другу:
// MEIO ждала от DP «Спрос и волатильность» и «Ошибку прогноза по горизонту», а
// DP отдавала в MEIO только неограниченный план. Каждая карта по отдельности
// была зелёной — противоречие видно только при сравнении двух файлов.
//
// Контракт: прогноз спроса и показатели ошибки прогноза по горизонту.
// Волатильность продаж — другой показатель, MEIO считает её сама по истории
// отгрузок, и от DP её не ждут.
//
// ПОЧЕМУ ПРОВЕРЯЮТСЯ ИМЕННО ExternalIO, а не data-узлы. При переименовании
// входа MEIO вторая интеграция DP молча исчезла с обзора: импортёр склеил две
// похожие по словам подписи в одну передачу (process-map-9tg), а data-узел
// остался. Тест по узлам остался бы зелёным.
import { describe, expect, it } from 'vitest';
import { ProcessMapSchema } from '../src/data/schema.ts';
import dpJson from '../src/data/dp/process.json';
import meioJson from '../src/data/meio/process.json';

const dp = ProcessMapSchema.parse(dpJson);
const meio = ProcessMapSchema.parse(meioJson);

const dpToMeio = dp.stages.flatMap((stage) =>
  stage.outputs.filter((io) => io.system === 'IO').map((io) => io.label),
);
const meioFromDp = meio.stages.flatMap((stage) =>
  stage.inputs.filter((io) => io.system === 'DP').map((io) => io.label),
);

describe('контракт DP → MEIO', () => {
  it('DP отдаёт в MEIO прогноз спроса и ошибку прогноза по горизонту', () => {
    expect(dpToMeio).toEqual([
      'Передача неограниченного плана спроса в SNP и MEIO',
      'Ошибка прогноза по горизонту в MEIO',
    ]);
  });

  it('MEIO ждёт от DP ровно это же — двумя отдельными интеграциями', () => {
    expect(meioFromDp).toEqual(['Прогноз спроса из DP', 'Ошибка прогноза по горизонту из DP']);
  });

  it('волатильность от DP не ждут: это другой показатель', () => {
    for (const label of [...dpToMeio, ...meioFromDp]) {
      expect(label.toLowerCase()).not.toContain('волатильн');
    }
  });
});
