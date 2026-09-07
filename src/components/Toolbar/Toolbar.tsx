// Тулбар полотна (SPEC §4.6): toggle «Показать интеграции» + зум −/%/+/fit.
// Справа сверху на обоих полотнах (артборды A1/A2 в design/*.dc.html).
//
// Рендерится РЯДОМ с <ReactFlow>, внутри общего <ReactFlowProvider> (см.
// Overview.tsx/StageDetail.tsx) — не ДЕТЬМИ <ReactFlow>, как EdgeMarkers/
// StartViewport. useReactFlow()/useViewport() требуют только контекст
// провайдера, а не сам смонтированный GraphView, поэтому сиблинг работает
// точно так же. Это важно для двух вещей:
//   1) кнопки тулбара не попадают внутрь `.react-flow` — там их бы посчитали
//      существующие тесты «фокусируемых элементов ровно N карточек»
//      (tests/App.test.tsx, tests/stageDetail.test.tsx), которые эту задачу
//      не трогает;
//   2) в DOM тулбар всё равно идёт ПОСЛЕ полотна (JSX-порядок в Overview/
//      StageDetail), поэтому кнопки не встают в Tab раньше карточек —
//      см. e2e/overview.spec.ts «до первой карточки этапа один Tab».
//
// Позиционирование — обычный position:absolute в .module.css, а не Panel из
// @xyflow/react: Panel рендерится ДЕТЬМИ <ReactFlow> (внутри `.react-flow`),
// что вернуло бы проблему (1).
import { useReactFlow, useViewport, type FitViewOptions } from '@xyflow/react';
import { iconUrl } from '../../assets/icons';
import { ru } from '../../i18n/ru';
import { useProcessStore } from '../../store/useProcessStore';
import { AddBlockActions } from './AddBlockActions';
import { EditorActions } from './EditorActions';
import styles from './Toolbar.module.css';

const MINUS_ICON = iconUrl('minus');
const PLUS_ICON = iconUrl('plus');
const FIT_ICON = iconUrl('fit');
const LINK_ICON = iconUrl('link');

export interface ToolbarProps {
  /**
   * Опции fitView для кнопки «Уместить в экран». Экран решает сам:
   *   · уровень 1 (Overview) передаёт то же, что использует автозапуск
   *     fitView при монтировании (см. FIT_VIEW_PADDING в overviewGraph.ts) —
   *     там пола читаемости нет;
   *   · уровень 2 (StageDetail) передаёт TOOLBAR_FIT_VIEW_OPTIONS из
   *     stageGraph.ts — с minZoom/maxZoom, равными START_ZOOM_MIN/MAX.
   *     Без этого fitView() ушёл бы ниже читаемого порога 12px и отменил
   *     эффект задачи process-map-l8a (см. её комментарии в stageGraph.ts).
   */
  fitViewOptions: FitViewOptions;
  /**
   * `true` — над полотном открыта боковая панель узла (SPEC §4.3). Тулбар
   * сдвигается влево на её ширину, иначе панель накрывает его целиком и все
   * кнопки SPEC §4.6 становятся недостижимы (см. .shifted в Toolbar.module.css).
   * Уровень 1 панели не имеет и проп не передаёт.
   */
  drawerOpen?: boolean;
  /**
   * SPEC §4.5, артборд A4 (process-map-jcz): в низком фрейме toggle интеграций
   * сворачивается в кнопку-иконку, а зум-ячейки сужаются. Подпись при этом не
   * исчезает, а переезжает в aria-label — он и так был именем кнопки, поэтому
   * доступное имя не меняется. Тот же приём, что у легенды (Legend.tsx).
   */
  compact?: boolean;
}

export function Toolbar({ fitViewOptions, drawerOpen = false, compact = false }: ToolbarProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  const showIntegrations = useProcessStore((state) => state.showIntegrations);
  const toggleIntegrations = useProcessStore((state) => state.toggleIntegrations);
  const mode = useProcessStore((state) => state.mode);
  const setMode = useProcessStore((state) => state.setMode);

  return (
    <div
      className={`${styles.toolbar}${drawerOpen ? ` ${styles.shifted}` : ''}${
        compact ? ` ${styles.compact}` : ''
      }`}
    >
      {/* Переключатель «Просмотр / Редактор» (SPEC §4.4). Значение живёт в
          store и НЕ персистится: при каждой загрузке — «Просмотр», иначе
          режим редактора «залипал» бы у читателя вики.

          Два <button aria-pressed>, а не radiogroup: у radiogroup своя
          клавиатурная модель (стрелки + roving tabindex), которую пришлось бы
          писать руками ради двух значений; кнопки-переключатели работают
          Tab'ом и Enter'ом сами. Тулбар — на обоих уровнях: режим глобален,
          и переключатель, исчезающий на уровне 1, скрывал бы от пользователя
          тот факт, что он всё ещё в редакторе. */}
      <div className={styles.modeGroup} role="group" aria-label={ru.toolbar.mode}>
        <button
          type="button"
          className={
            mode === 'view' ? `${styles.modeButton} ${styles.modeActive}` : styles.modeButton
          }
          aria-pressed={mode === 'view'}
          onClick={() => {
            setMode('view');
          }}
        >
          {ru.toolbar.modeView}
        </button>
        <button
          type="button"
          className={
            mode === 'edit' ? `${styles.modeButton} ${styles.modeActive}` : styles.modeButton
          }
          aria-pressed={mode === 'edit'}
          onClick={() => {
            setMode('edit');
          }}
        >
          {ru.toolbar.modeEdit}
        </button>
      </div>

      {/* «Экспорт JSON» / «Импорт JSON» / «Сбросить правки» — SPEC §4.4 прямо
          говорит «в тулбаре РЕДАКТОРА», поэтому группа не рендерится в режиме
          просмотра вовсе (а не прячется disabled'ом): читателю вики нечего
          делать ни с одной из трёх кнопок, а «Сбросить правки» ему ещё и
          опасна. */}
      {mode === 'edit' && <EditorActions />}
      {/* Добавлять блок можно только внутри этапа: на обзоре узлов нет, там
          карточки этапов. Открытый этап компонент находит сам — тулбару о нём
          знать незачем, у него и так семь пропсов. */}
      {mode === 'edit' && <AddBlockActions />}

      {/* Роль, aria-checked, aria-label и onClick одинаковы в обоих видах —
          меняется только содержимое. Это и позволяет свернуть кнопку, не
          тронув ни один из существующих тестов: они ищут её как
          getByRole('switch', { name: 'Показать интеграции' }). В компактном
          виде подпись не прячется стилями, а не рендерится: скрытый DOM всё
          равно читается скринридером. */}
      <button
        type="button"
        role="switch"
        aria-checked={showIntegrations}
        aria-label={ru.toolbar.showIntegrations}
        className={compact ? `${styles.toggle} ${styles.toggleCompact}` : styles.toggle}
        title={compact ? ru.toolbar.showIntegrations : undefined}
        onClick={toggleIntegrations}
      >
        {compact ? (
          <img src={LINK_ICON} alt="" className={styles.toggleIcon} />
        ) : (
          <>
            <span className={styles.switchTrack} aria-hidden="true">
              <span className={styles.switchKnob} />
            </span>
            <span className={styles.toggleLabel}>{ru.toolbar.showIntegrations}</span>
          </>
        )}
      </button>

      <div className={styles.zoomGroup}>
        <button
          type="button"
          className={styles.zoomButton}
          aria-label={ru.toolbar.zoomOut}
          title={ru.toolbar.zoomOut}
          onClick={() => {
            void zoomOut();
          }}
        >
          <img src={MINUS_ICON} alt="" className={styles.zoomIcon} />
        </button>

        <span className={styles.zoomDisplay}>{ru.toolbar.zoomPercent(Math.round(zoom * 100))}</span>

        <button
          type="button"
          className={styles.zoomButton}
          aria-label={ru.toolbar.zoomIn}
          title={ru.toolbar.zoomIn}
          onClick={() => {
            void zoomIn();
          }}
        >
          <img src={PLUS_ICON} alt="" className={styles.zoomIcon} />
        </button>

        <button
          type="button"
          className={styles.zoomButton}
          aria-label={ru.toolbar.fitView}
          title={ru.toolbar.fitView}
          onClick={() => {
            void fitView(fitViewOptions);
          }}
        >
          <img src={FIT_ICON} alt="" className={styles.zoomIconFit} />
        </button>
      </div>
    </div>
  );
}
