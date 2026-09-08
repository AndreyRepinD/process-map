// Экран «Обзор процесса, уровень 1» (SPEC §4.1, артборд A1).
import { useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useFrameSize } from '../../hooks/useFrameSize';
import { useProcessMap } from '../../hooks/useProcessMap';
import { ru } from '../../i18n/ru';
import { useProcessStore } from '../../store/useProcessStore';
import { EdgeMarkers, IntegrationEdge, ProcessEdge } from '../edges';
import { Legend } from '../Legend';
import { IntegrationNode } from '../nodes/IntegrationNode';
import { LaneNode } from '../nodes/LaneNode';
import { StageNode } from '../nodes/StageNode';
import { SystemsBadge } from '../nodes/SystemsBadge';
import { NodeDrawer } from '../NodeDrawer';
import { Toolbar } from '../Toolbar';
import { OverviewHeader } from './OverviewHeader';
import {
  buildOverviewGraph,
  FIT_VIEW_PADDING,
  GRID_DOT_SIZE,
  GRID_GAP,
  MAX_ZOOM,
  MIN_ZOOM,
} from './overviewGraph';
import { RefitViewport } from './RefitViewport';
import styles from './Overview.module.css';

// Объекты объявлены на уровне модуля: React Flow предупреждает, если nodeTypes
// или edgeTypes меняют идентичность между рендерами.
// Проверка типов настоящая, а не заглушённая: до process-map-ge3 здесь стояло
// `as unknown as`, и оно пропускало в карту что угодно — проба с числом вместо
// компонента не давала ни одной ошибки. `satisfies` сверяет объект с NodeTypes,
// но не расширяет тип переменной до Record, поэтому имена ключей остаются точными.
const nodeTypes = {
  lane: LaneNode,
  // Рамка вокруг потока этапов (process-map-sni) — тот же компонент, отдельный
  // тип: он попадает в класс узла, и общий тип слил бы счётчики в e2e.
  flowLane: LaneNode,
  system: IntegrationNode,
  stage: StageNode,
  systemsBadge: SystemsBadge,
} satisfies NodeTypes;

const edgeTypes = {
  process: ProcessEdge,
  integration: IntegrationEdge,
} satisfies EdgeTypes;

const fitViewOptions = { padding: FIT_VIEW_PADDING };

/*
 * Убирает ссылку-attribution React Flow из правого нижнего угла полотна
 * (решение владельца, process-map-4hv): карта встроена в In.Plan, и на демо
 * клиентам в углу висел посторонний бренд.
 *
 * hideAttribution — публичный проп библиотеки, а @xyflow/react распространяется
 * под обычным MIT без оговорок про attribution: подписка Pro у авторов — просьба
 * о поддержке, а не условие лицензии. Поэтому штатный проп, а не CSS-хак.
 */
const proOptions = { hideAttribution: true };

export function Overview() {
  const showIntegrations = useProcessStore((state) => state.showIntegrations);

  // SPEC §4.5: режим решает высота КОНТЕЙНЕРА, а не окна — приложение живёт в
  // iframe (SPEC §6). Измеряется корень экрана: он занимает всю высоту врезки.
  const { ref: rootRef, compact } = useFrameSize();

  // Карта = process.json + overrides из localStorage. useProcessMap()
  // подписывает экран на правки редактора (SPEC §4.4): после записи ссылки
  // ссылка обязана появиться сразу, без перезагрузки страницы. Ссылка на
  // объект карты стабильна, пока правок нет, поэтому useMemo ниже не
  // пересчитывается на каждый рендер — см. src/hooks/useProcessMap.ts.
  const map = useProcessMap();
  const { nodes, edges } = useMemo(
    () => buildOverviewGraph(map, showIntegrations, compact),
    [map, showIntegrations, compact],
  );

  // Узлы, доступные панели на обзоре, — ТОЛЬКО те, что стоят за внешними
  // карточками. Отдать ей все узлы карты значило бы, что deep-link ?node= на
  // любой шаг откроет панель поверх обзора, где этого шага не видно вовсе:
  // подсветки нет, возвращать фокус некуда. Тот же довод, что на экране этапа,
  // где панели отдаются только нарисованные узлы.
  const externalNodes = useMemo(() => {
    const ids = new Set(
      nodes.flatMap((node) =>
        node.type === 'system' && typeof node.data.nodeId === 'string' ? [node.data.nodeId] : [],
      ),
    );
    return map.stages.flatMap((stage) => stage.nodes.filter((node) => ids.has(node.id)));
  }, [map, nodes]);

  return (
    <div className={compact ? `${styles.root} ${styles.compact}` : styles.root} ref={rootRef}>
      <OverviewHeader
        title={map.title}
        stagesCount={map.stages.length}
        updatedAt={map.updatedAt}
        compact={compact}
      />
      {/* role="region", а не "application": схема статична, а application
          переводит скринридер в режим прямого прохода клавиш и глушит
          навигацию по элементам. */}
      <div className={styles.canvas} role="region" aria-label={ru.overview.canvasLabel}>
        {/* ReactFlowProvider — общий контекст для <ReactFlow> и тулбара:
            Toolbar рендерится РЯДОМ с полотном, не внутри него (см. подробное
            объяснение в Toolbar.tsx), поэтому его useReactFlow()/useViewport()
            нужен провайдер уровнем выше, а не автосозданный <ReactFlow>. */}
        <ReactFlowProvider>
          <EdgeMarkers>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              // Фокус несут <button> карточек этапов; собственные tabIndex узлов и
              // рёбер React Flow добавляли 18 лишних остановок Tab до первой карточки.
              nodesFocusable={false}
              edgesFocusable={false}
              panOnScroll
              fitView
              fitViewOptions={fitViewOptions}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              proOptions={proOptions}
            >
              <Background variant={BackgroundVariant.Dots} gap={GRID_GAP} size={GRID_DOT_SIZE} />
              {/* SPEC §4.5: при смене режима вид подгоняется заново — карточки
                  этапов меняют и размер, и координаты. */}
              <RefitViewport compact={compact} fitViewOptions={fitViewOptions} />
            </ReactFlow>
          </EdgeMarkers>
          {/* Тот же fitViewOptions, что и автозапуск fitView выше (SPEC §4.6):
              на уровне 1 пола читаемости нет, кнопка «Уместить в экран» просто
              повторяет исходный вид. */}
          <Toolbar fitViewOptions={fitViewOptions} compact={compact} />
        </ReactFlowProvider>
        {/* Панель правки внешней карточки. На обзоре у неё те же поля, что и на
            экране этапа, потому что правится ТОТ ЖЕ узел: плашка внешней
            системы существует на карте дважды, и вторая её копия — запись
            ExternalIO — идёт за подписью следом (loader.ts::renameIo).
            Секции связей здесь нет: она рисуется только при открытом этапе, а
            на обзоре этапа нет по определению. */}
        <NodeDrawer nodes={externalNodes} />
      </div>
      {/* Легенда — строка ПОД полотном, не поверх него: см. обоснование в
          Legend.module.css (плавающая панель рано или поздно перекрывает
          содержимое панорамируемого/масштабируемого полотна). Легенде не
          нужен React Flow, поэтому она и не внутри .canvas. */}
      {/* Компактный режим (SPEC §4.5) не убирает полосу, а ужимает её под
          кнопку-иконку: легенда остаётся вне полотна — см. Legend.tsx. */}
      <div className={styles.legendStrip}>
        <Legend compact={compact} />
      </div>
    </div>
  );
}
