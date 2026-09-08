// Состояние UI карты процесса (SPEC.md §4.1–§4.7).
//
// В store лежит ТОЛЬКО состояние интерфейса. Сам ProcessMap сюда не кладётся:
// данные статичны и уже валидируются/сливаются в src/data/loader.ts, а два
// источника истины (loader + store) неизбежно разъезжались бы после правки
// ссылки в редакторе.
//
// Персистентности нет намеренно: `mode` персистить прямо запрещено (SPEC §4.4 —
// при загрузке всегда «Просмотр»), а уровень/выбранный узел восстанавливаются
// из deep-link (§4.7), а не из хранилища.
import { create } from 'zustand';

export type ViewMode = 'view' | 'edit';

export interface ProcessState {
  /** id текущего этапа; null — уровень 1 (обзор). */
  currentStageId: string | null;
  /** id узла с открытым Drawer; null — Drawer закрыт. */
  selectedNodeId: string | null;
  /** Режим тулбара. Всегда 'view' при загрузке, в localStorage не сохраняется. */
  mode: ViewMode;
  /** Toggle «Показать интеграции» (SPEC §4.6). По макету включён по умолчанию. */
  showIntegrations: boolean;
  /**
   * Экран платформы, открытый ПАНЕЛЬЮ РЯДОМ С КАРТОЙ; null — панель закрыта.
   *
   * Решение владельца 08.09.2026: «можно открыть экран не новой ссылкой, а как у
   * платформы — рядом с картой». Раньше ссылка всегда уводила в новую вкладку, и
   * карта с экраном оказывались в разных окнах — сверять их приходилось
   * переключением.
   *
   * Здесь, а не в состоянии компонента: панель переживает открытие и закрытие
   * боковой карточки узла, и её обязаны закрывать переходы между уровнями.
   */
  embeddedScreen: { url: string; title: string } | null;

  /** Переход на уровень 2. Всегда закрывает Drawer — см. комментарий ниже. */
  navigateToStage: (stageId: string) => void;
  /** Возврат на уровень 1 (обзор). */
  back: () => void;
  /** Открыть Drawer узла. */
  selectNode: (nodeId: string) => void;
  /** Закрыть Drawer (Esc, клик по фону). */
  closeDrawer: () => void;
  /** Переключить показ интеграционных рёбер и узлов систем. */
  toggleIntegrations: () => void;
  /** Просмотр ↔ Редактор. */
  setMode: (mode: ViewMode) => void;
  /** Открыть экран платформы панелью рядом с картой. */
  openEmbedded: (url: string, title: string) => void;
  /** Закрыть панель экрана. */
  closeEmbedded: () => void;
}

export interface ProcessUiState {
  currentStageId: string | null;
  selectedNodeId: string | null;
  mode: ViewMode;
  showIntegrations: boolean;
  embeddedScreen: { url: string; title: string } | null;
}

/** Начальные значения. Вынесены отдельно, чтобы тесты могли сбрасывать store. */
export function createInitialState(): ProcessUiState {
  return {
    currentStageId: null,
    selectedNodeId: null,
    mode: 'view',
    showIntegrations: true,
    embeddedScreen: null,
  };
}

export const useProcessStore = create<ProcessState>()((set) => ({
  ...createInitialState(),

  // Drawer не должен «протекать» между экранами: узел принадлежит конкретному
  // этапу, поэтому при смене уровня выбор всегда сбрасывается.
  // Deep-link ?stage=2&node=x реализуется как navigateToStage(...) → selectNode(...);
  // порядок вызовов важен, обратный порядок закроет Drawer.
  // Панель экрана закрывается вместе со сменой уровня: экран открывали ПОД
  // конкретный блок, и на другом этапе он относится уже не к тому, что на виду.
  navigateToStage: (stageId) =>
    set({ currentStageId: stageId, selectedNodeId: null, embeddedScreen: null }),

  // На уровне 1 узлов с Drawer нет, поэтому выбор сбрасывается вместе с этапом.
  back: () => set({ currentStageId: null, selectedNodeId: null, embeddedScreen: null }),

  // selectNode/closeDrawer меняют только выбор, уровень не трогают.
  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
  closeDrawer: () => set({ selectedNodeId: null }),

  // Ни toggle интеграций, ни смена режима не закрывают Drawer: выход из
  // редактора не должен ронять открытую карточку узла.
  toggleIntegrations: () => set((state) => ({ showIntegrations: !state.showIntegrations })),
  setMode: (mode) => set({ mode }),

  openEmbedded: (url, title) => set({ embeddedScreen: { url, title } }),
  closeEmbedded: () => set({ embeddedScreen: null }),
}));
