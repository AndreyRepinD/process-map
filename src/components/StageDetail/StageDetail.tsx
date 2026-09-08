// Экран «Детализация этапа, уровень 2» (SPEC §4.2, артборд A2).
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
import { moveNode } from '../../data/loader';
import { commitOverrides, useProcessMap } from '../../hooks/useProcessMap';
import { ru } from '../../i18n/ru';
import { useProcessStore } from '../../store/useProcessStore';
import { Breadcrumbs } from '../Breadcrumbs';
import { DataEdge, EdgeMarkers, IntegrationEdge, ProcessEdge, ProcessInnerEdge } from '../edges';
import { Legend } from '../Legend';
import { NodeDrawer } from '../NodeDrawer';
import { ScreenPanel } from '../ScreenPanel/ScreenPanel';
import { DataNode } from '../nodes/DataNode';
import { GroupNode } from '../nodes/GroupNode';
import { StepNode } from '../nodes/StepNode';
import { WarningNode } from '../nodes/WarningNode';
import { Toolbar } from '../Toolbar';
import {
  buildStageGraph,
  GRID_DOT_SIZE,
  GRID_GAP,
  MAX_ZOOM,
  MIN_ZOOM,
  TOOLBAR_FIT_VIEW_OPTIONS,
} from './stageGraph';
import { StartViewport } from './StartViewport';
import styles from './StageDetail.module.css';

// Объекты объявлены на уровне модуля: React Flow предупреждает, если nodeTypes
// или edgeTypes меняют идентичность между рендерами.
// Проверка типов настоящая, а не заглушённая: до process-map-ge3 здесь стояло
// `as unknown as`, и оно пропускало в карту что угодно — проба с числом вместо
// компонента не давала ни одной ошибки. `satisfies` сверяет объект с NodeTypes,
// но не расширяет тип переменной до Record, поэтому имена ключей остаются точными.
const nodeTypes = {
  groupBox: GroupNode,
  step: StepNode,
  // Интеграция — тот же компонент, отдельный тип (process-map-73m, process-map-e21):
  // тип попадает в класс узла, и общий тип означал бы, что `.react-flow__node-step`
  // выбирает «шаг ИЛИ интеграцию». Тот же приём, что у `lane` / `flowLane` уровня 1.
  integration: StepNode,
  warning: WarningNode,
  data: DataNode,
  // Типы BPMN (process-map-70e.7): та же карточка, свои типы узлов — см.
  // GatewayNodeType в StepNode.tsx.
  gateway: StepNode,
  event: StepNode,
  subprocess: StepNode,
} satisfies NodeTypes;

const edgeTypes = {
  process: ProcessEdge,
  // Поток внутри группы шагов рисуется серым (артборд A2, process-map-fxg).
  // Отдельный тип, а не проп: тип попадает в класс ребра, и общий тип слил бы
  // два вида в один счётчик — то же соображение, что у `lane` / `flowLane`.
  processInner: ProcessInnerEdge,
  integration: IntegrationEdge,
  // Ребро к артефакту данных (process-map-70e.6). Значение kind: 'data' было в
  // схеме с самого начала, но не отрисовывалось ничем.
  data: DataEdge,
} satisfies EdgeTypes;

/** Убирает ссылку-attribution React Flow — обоснование в Overview.tsx (4hv). */
const proOptions = { hideAttribution: true };

export function StageDetail() {
  const currentStageId = useProcessStore((state) => state.currentStageId);
  const mode = useProcessStore((state) => state.mode);
  const showIntegrations = useProcessStore((state) => state.showIntegrations);
  const selectedNodeId = useProcessStore((state) => state.selectedNodeId);

  // SPEC §4.5: режим решает высота КОНТЕЙНЕРА (приложение в iframe, SPEC §6).
  const { ref: rootRef, compact } = useFrameSize();

  // Карта с наложенными overrides, реактивно к правкам редактора (SPEC §4.4):
  // сохранённая в панели ссылка сразу появляется и в самой панели, и иконкой
  // link-external на карточке шага (SPEC §4.2). См. src/hooks/useProcessMap.ts.
  const map = useProcessMap();
  const stage = map.stages.find((candidate) => candidate.id === currentStageId);
  const graph = useMemo(
    () => (stage === undefined ? undefined : buildStageGraph(stage, showIntegrations)),
    [stage, showIntegrations],
  );

  // Уровень выбирает App.tsx по currentStageId, поэтому сюда можно попасть
  // только с существующим этапом. Рассинхрон (например, id из старого
  // deep-link) не должен ронять приложение — показываем пустой экран, решение
  // о возврате на уровень 1 принимает пользователь кнопкой «Назад» в крошках.
  if (stage === undefined || graph === undefined) {
    return null;
  }

  // Панели отдаются только те узлы, которые СЕЙЧАС нарисованы на полотне, а не
  // все узлы этапа. Иначе выключенный toggle «Показать интеграции» (SPEC §4.6)
  // убирал карточку узла-интеграции с полотна, но оставлял открытой панель с
  // его описанием: подсветки нет, затемнение лежит на пустом месте, и вернуть
  // фокус на карточку при закрытии тоже некуда. Это тот же принцип, что уже
  // записан в store (navigateToStage/back сбрасывают selectedNodeId): панель
  // не переживает исчезновение своего узла с экрана. Список берётся из
  // graph.nodes, а не пересобирается своим фильтром, — правило видимости
  // остаётся одно, в buildStageGraph. Контейнеры групп/колонок отсеиваются
  // сами: их id (`group:…`, `column:…`) не совпадают ни с одним ProcessNode.
  const renderedIds = new Set(graph.nodes.map((node) => node.id));
  const visibleNodes = stage.nodes.filter((node) => renderedIds.has(node.id));
  const drawerOpen = visibleNodes.some((node) => node.id === selectedNodeId);

  return (
    <div className={compact ? `${styles.root} ${styles.compact}` : styles.root} ref={rootRef}>
      <Breadcrumbs stages={map.stages} compact={compact} />
      {/* Полотно и панель экрана — в один ряд: панель ужимает карту, а не
          накрывает её. Тем она и отличается от боковой карточки узла, которая
          лежит поверх и затемняет полотно. */}
      <div className={styles.split}>
        {/* role="region", а не "application" — см. комментарий в Overview.tsx. */}
        <div className={styles.canvas} role="region" aria-label={ru.stageDetail.canvasLabel}>
          {/* key по этапу на самом провайдере (не только на <ReactFlow> ниже):
            смена этапа обязана пересобрать ОБЩИЙ store React Flow целиком,
            иначе Toolbar (сиблинг <ReactFlow>, читает viewport из того же
            store — см. Toolbar.tsx) на миг унаследовал бы масштаб/сдвиг
            предыдущего этапа, пока StartViewport его не перезапишет. Раскладки
            отличаются в разы (3942×1088 у этапа 2 против 3528×296 у этапа 1). */}
          <ReactFlowProvider key={stage.id}>
            <EdgeMarkers>
              <ReactFlow
                nodes={graph.nodes}
                edges={graph.edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                // ПЕРЕТАСКИВАНИЕ ТОЛЬКО В РЕДАКТОРЕ (решение владельца от
                // 07.09.2026). Правило «узлы не перетаскиваются» вводилось для
                // читателя вики: там таскать нечего и незачем, а сдвинутая
                // карточка выглядела бы сломанной вёрсткой. Владельцу карты
                // раскладку править нужно, и его правки живут в overrides —
                // пересчёт координат конвейером их не затирает.
                nodesDraggable={mode === 'edit'}
                onNodeDragStop={(_, dragged) => {
                  // КООРДИНАТА ПРИВОДИТСЯ К АБСОЛЮТНОЙ. Узел внутри группы —
                  // ребёнок контейнера (parentId в stageGraph.ts), и React Flow
                  // отдаёт его позицию ОТНОСИТЕЛЬНО родителя. В process.json и в
                  // overrides координаты абсолютные, и запись относительной
                  // означала бы, что при следующем открытии карточка уедет на
                  // смещение группы — тем дальше, чем правее группа.
                  const parent =
                    dragged.parentId === undefined
                      ? undefined
                      : graph.nodes.find((node) => node.id === dragged.parentId);
                  const position =
                    parent === undefined
                      ? dragged.position
                      : {
                          x: dragged.position.x + parent.position.x,
                          y: dragged.position.y + parent.position.y,
                        };
                  commitOverrides(() => moveNode(dragged.id, position));
                }}
                nodesConnectable={false}
                elementsSelectable={false}
                // Фокус несут <button> карточек узлов (см. overviewGraph.ts).
                nodesFocusable={false}
                edgesFocusable={false}
                panOnScroll
                // fitView намеренно НЕ используется: он опускал масштаб до 0.25…0.53
                // и делал подписи нечитаемыми. Стартовый вид — StartViewport.
                // minZoom/maxZoom здесь остаются границами РУЧНОГО зума (колесо,
                // тулбар): отдалить схему целиком пользователь по-прежнему может.
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                proOptions={proOptions}
                /* process-map-9ji: при открытой панели полотно выпадает и из
                 обхода Tab, и из режима чтения скринридера. Помечено РОВНО
                 полотно — то, что накрывает затемнение. Крошки и легенда лежат
                 вне .canvas, затемнение до них не достаёт, и они обязаны
                 оставаться рабочими (e2e/journey.spec.ts, «открытая панель не
                 отменяет остальной интерфейс»); тулбар лежит внутри .canvas, но
                 живёт поверх панели и лишь сдвигается (.shifted).
                 Атрибут ложится на обёртку полотна: ReactFlowProps наследует
                 HTMLAttributes<HTMLDivElement>, и лишние пропы спредятся на неё. */
                inert={drawerOpen ? '' : undefined}
              >
                <StartViewport bounds={graph.bounds} anchor={graph.startAnchor} compact={compact} />
                <Background variant={BackgroundVariant.Dots} gap={GRID_GAP} size={GRID_DOT_SIZE} />
              </ReactFlow>
            </EdgeMarkers>
            {/* Кнопка «Уместить в экран» уважает тот же пол читаемости, что и
              стартовый вид (SPEC §4.6) — см. комментарий у TOOLBAR_FIT_VIEW_OPTIONS
              в stageGraph.ts. */}
            {/* drawerOpen: панель шириной 360 накрывает правый верхний угол
              полотна вместе со всем тулбаром — см. .shifted в Toolbar.module.css. */}
            <Toolbar
              fitViewOptions={TOOLBAR_FIT_VIEW_OPTIONS}
              drawerOpen={drawerOpen}
              compact={compact}
            />
          </ReactFlowProvider>
          {/* Боковая панель узла — внутри .canvas, чтобы затемнение начиналось
            под шапкой крошек, как в артборде A3 (SPEC §4.3). */}
          <NodeDrawer nodes={visibleNodes} />
        </div>
        <ScreenPanel />
      </div>
      {/* Легенда — строка ПОД полотном, не поверх него: раскладка потока
          шагов на реальных данных занимает весь угол/край полотна на всех
          4 этапах (см. Legend.module.css) — плавающая панель гарантированно
          перекрыла бы что-нибудь. Легенде не нужен React Flow, поэтому она
          и не внутри .canvas/<ReactFlowProvider>. */}
      {/* Компактный режим (SPEC §4.5) ужимает полосу под кнопку-иконку,
          но не возвращает легенду на полотно — см. Legend.tsx. */}
      <div className={styles.legendStrip}>
        <Legend compact={compact} />
      </div>
    </div>
  );
}
