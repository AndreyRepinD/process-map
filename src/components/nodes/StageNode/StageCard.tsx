// Презентационная карточка этапа (SPEC §4.1, артборд A1).
//
// Намеренно не зависит от React Flow: Handle'ы и NodeProps живут в StageNode.tsx,
// а карточку можно рендерить и тестировать без ReactFlowProvider и без моков
// размеров контейнера.
import { iconUrl } from '../../../assets/icons';
import type { Stage } from '../../../data/schema';
import { ru } from '../../../i18n/ru';
import { useProcessStore } from '../../../store/useProcessStore';
import styles from './StageCard.module.css';

// Путь считает сборщик, а не строка в рантайме: при `base: './'` (SPEC §6)
// рантайм-путь резолвился бы от URL документа и ломался бы во встраивании
// без завершающего слэша. Подробности — в src/assets/icons/index.ts.
const WARNING_ICON = iconUrl('warning-triangle');

/**
 * Компактный режим (SPEC §4.5, артборд A4) показывает ДВА ключевых выхода
 * вместо трёх. Число живёт здесь, а не в CSS: список обрезается в разметке —
 * скрытый третий пункт остался бы в дереве доступности и был бы прочитан
 * скринридером, хотя на экране его нет.
 */
const COMPACT_KEY_OUTPUTS = 2;

export interface StageCardProps {
  stage: Stage;
  /** SPEC §4.5: карточка 228×200, два выхода, без «эйбра» и подписи «Этап». */
  compact?: boolean;
}

export function StageCard({ stage, compact = false }: StageCardProps) {
  const navigateToStage = useProcessStore((state) => state.navigateToStage);
  const editable = useProcessStore((state) => state.mode === 'edit');
  const editStage = useProcessStore((state) => state.editStage);
  const isActive = useProcessStore((state) => state.currentStageId === stage.id);
  const warningsCount = stage.warningsCount ?? 0;
  const outputs = compact ? stage.keyOutputs.slice(0, COMPACT_KEY_OUTPUTS) : stage.keyOutputs;

  return (
    <>
      <button
        type="button"
        className={[styles.card, isActive ? styles.active : '', compact ? styles.compact : '']
          .filter(Boolean)
          .join(' ')}
        aria-label={ru.stageNode.ariaLabel(stage.number, stage.title)}
        aria-current={isActive ? 'step' : undefined}
        onClick={() => {
          navigateToStage(stage.id);
        }}
      >
        <div className={styles.head}>
          <span className={styles.number}>{stage.number}</span>
          {warningsCount > 0 ? (
            // В компактном режиме (A4) от счётчика остаётся одна иконка: места на
            // подпись нет. Число не пропадает — оно уходит в title/alt, то есть
            // остаётся и в подсказке, и для скринридера.
            <span className={styles.warnings} title={ru.stageNode.warnings(warningsCount)}>
              <img
                src={WARNING_ICON}
                alt={compact ? ru.stageNode.warnings(warningsCount) : ''}
                className={styles.warningsIcon}
              />
              {!compact && ru.stageNode.warnings(warningsCount)}
            </span>
          ) : (
            // Подпись «Этап»/«Выбранный этап» в компактном режиме не рисуется
            // (A4), но состояние карточки остаётся видимым: рамка, верхняя
            // полоска и фон номера — и aria-current на самой кнопке.
            !compact && (
              <span className={styles.caption}>
                {isActive ? ru.stageNode.captionActive : ru.stageNode.caption}
              </span>
            )
          )}
        </div>

        {/* shortTitle, а не title: карточка 274×210 фиксирована по SPEC §4.1, и
          полные названия этапов 3 и 4 в неё не влезали — клэмп срезал их
          многоточием («Анализ и корректировка результатов /Сценарное…»), хотя в
          данных для этого случая уже лежало короткое название (process-map-vjz.1).
          Полное остаётся в подсказке и в aria-label: срезать его для
          скринридера незачем. У этапов 1 и 2 оба поля совпадают. */}
        <div className={styles.title} title={stage.title}>
          {stage.shortTitle}
        </div>
        <div className={styles.divider} />
        {/* «Эйбр» блока в компактном режиме снят (A4): в 200 px высоты он занимал
          строку, которую забирает сам список выходов. */}
        {/* Заголовок только при непустом списке (process-map-3wh.11). Раньше он
          рисовался безусловно, потому что у SNP выходы есть у всех четырёх
          этапов. У карты MRP выход назван только у одного этапа из четырёх —
          три карточки показали бы подпись и под ней ~90 px пустоты. */}
        {!compact && outputs.length > 0 && (
          <div className={styles.outputsTitle}>{ru.stageNode.keyOutputs}</div>
        )}

        <ul className={styles.outputs}>
          {outputs.map((output) => (
            // Карточка 274×210 фиксирована по SPEC §4.1, а формулировки в данных
            // длиннее макетных, поэтому пункт обрезается многоточием, а не срезом
            // по краю карточки; полный текст доступен в подсказке.
            <li key={output} className={styles.output}>
              <span className={styles.dash} aria-hidden="true">
                —
              </span>
              <span className={styles.outputText} title={output}>
                {output}
              </span>
            </li>
          ))}
        </ul>

        {/* Строка появляется только при заполненной ссылке (SPEC §4.1);
          stage.screen наполняется редактором ссылок в M3. */}
        {stage.screen !== undefined && (
          <span className={styles.link}>{ru.stageNode.openInInplan}</span>
        )}
      </button>
      {/* Действие «Править этап» — ОТДЕЛЬНАЯ кнопка рядом, а не клик по карточке:
        карточка ведёт на уровень 2, и отбирать у неё это в редакторе значило бы
        лишить владельца перехода ровно тогда, когда он правит карту. Вложить
        кнопку в кнопку нельзя — разметка запрещает. */}
      {editable && (
        <button
          type="button"
          className={styles.edit}
          aria-label={`${ru.stageEditor.edit}: ${stage.title}`}
          onClick={() => {
            editStage(stage.id);
          }}
        >
          {ru.stageEditor.edit}
        </button>
      )}
    </>
  );
}
