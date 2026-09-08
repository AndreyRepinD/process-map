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
   * id этапа, чья карточка правится на обзоре; null — форма закрыта.
   *
   * Отдельно от selectedNodeId: у этапа правятся свои поля (заголовок, короткое
   * название, ключевые выходы), и переиспользовать выбор узла значило бы, что
   * одно значение означает две разные вещи в зависимости от уровня.
   */
  editingStageId: string | null;

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
  /** Открыть форму правки карточки этапа (обзор, режим редактора). */
  editStage: (stageId: string) => void;
  /** Закрыть форму правки карточки этапа. */
  closeStageEditor: () => void;
}

export interface ProcessUiState {
  currentStageId: string | null;
  selectedNodeId: string | null;
  mode: ViewMode;
  showIntegrations: boolean;
  editingStageId: string | null;
}

/** Начальные значения. Вынесены отдельно, чтобы тесты могли сбрасывать store. */
export function createInitialState(): ProcessUiState {
  return {
    currentStageId: null,
    selectedNodeId: null,
    mode: 'view',
    showIntegrations: true,
    editingStageId: null,
  };
}

export const useProcessStore = create<ProcessState>()((set) => ({
  ...createInitialState(),

  // Drawer не должен «протекать» между экранами: узел принадлежит конкретному
  // этапу, поэтому при смене уровня выбор всегда сбрасывается.
  // Deep-link ?stage=2&node=x реализуется как navigateToStage(...) → selectNode(...);
  // порядок вызовов важен, обратный порядок закроет Drawer.
  navigateToStage: (stageId) => set({ currentStageId: stageId, selectedNodeId: null }),

  // На уровне 1 узлов с Drawer нет, поэтому выбор сбрасывается вместе с этапом.
  back: () => set({ currentStageId: null, selectedNodeId: null }),

  // selectNode/closeDrawer меняют только выбор, уровень не трогают.
  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
  closeDrawer: () => set({ selectedNodeId: null }),

  // Ни toggle интеграций, ни смена режима не закрывают Drawer: выход из
  // редактора не должен ронять открытую карточку узла.
  toggleIntegrations: () => set((state) => ({ showIntegrations: !state.showIntegrations })),
  setMode: (mode) => set({ mode }),

  editStage: (stageId) => set({ editingStageId: stageId }),
  closeStageEditor: () => set({ editingStageId: null }),
}));
