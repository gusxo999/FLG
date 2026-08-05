import { create } from 'zustand';
import { subscribeWithSelector, persist, createJSONStorage } from 'zustand/middleware';
import type {
  LayoutGrid,
  GridCell,
  Direction,
  ViewportState,
  SelectionState,
  GridPosition,
} from '../../types/layout';
import type { ModuleSlot } from '../../types/layout';
import {
  EntityType,
  createEmptyGrid,
  createEmptyCell,
  cellIndex,
  getCell,
} from '../../types/layout';
import { getEntitySizeRotated } from '../../factorio/entitySize';
import { useToastStore } from './toastStore';
import { t } from '../i18n';
import { nanoid } from './nanoid';

/**
 * 같은 카테고리의 엔티티는 정보 모달 없이 덮어쓰기 허용.
 * Belt 위 Belt, Pipe/PipeUnderground 위 Pipe/PipeUnderground.
 */
function canOverwrite(selected: EntityType, existing: EntityType): boolean {
  if (selected === EntityType.Belt && existing === EntityType.Belt) return true;
  const isPipeFamily = (t: EntityType) =>
    t === EntityType.Pipe || t === EntityType.PipeUnderground || t === EntityType.InfinityPipe;
  if (isPipeFamily(selected) && isPipeFamily(existing)) return true;
  return false;
}

const DEFAULT_GRID_WIDTH = 256;
const DEFAULT_GRID_HEIGHT = 256;
const DEFAULT_TILE_SIZE = 32; // pixels per tile at zoom=1

// ─── 음수 좌표는 존재하지 않는다 ──────────────────────────────────────────────
//
// 예전엔 음수 좌표에 놓으면 **그리드 전체를 밀어** 공간을 만들고, 밀린 양을 `gridOriginX/Y`
// 로 누적해 표시 좌표를 되돌렸다. 그 누적이 네 번째 좌표 프레임이었다 —
// *표시 좌표 = 내부 좌표 + gridOrigin*. 밀기는 **범위 밖으로 나간 셀을 조용히 버리기도** 했다.
//
// 이제 음수 좌표는 **거절한다**(사용자 결정, 2026-08-05). 밀 일이 없으니 누적도 없고,
// 프레임이 셋(모듈-로컬 · 레이아웃 · 그리드)으로 준다. 자동배치 결과는 `unifyLeaf` 가
// 모든 좌표를 ≥ 1 로 보장하므로 애초에 음수가 오지 않는다.

/** 배치·이동의 좌상단이 그리드 안인가. 음수면 거절한다(밀지 않는다). */
function inGrid(grid: LayoutGrid, x: number, y: number, w: number, h: number): boolean {
  return x >= 0 && y >= 0 && x + w <= grid.width && y + h <= grid.height;
}

interface HistoryEntry {
  cells: GridCell[];
  label: string;
}

interface LayoutState {
  grid: LayoutGrid;
  tileSize: number;
  viewport: ViewportState;
  selection: SelectionState;
  /** 다중 선택된 엔티티 ID들 (drag selection 결과) */
  selectedEntityIds: Set<string>;
  /** Currently selected entity type to place */
  selectedEntityType: EntityType;
  /** Currently selected entity name (Factorio internal name) */
  selectedEntityName: string;
  /** Currently selected direction */
  selectedDirection: Direction;
  /** Undo stack */
  undoStack: HistoryEntry[];
  /** Redo stack */
  redoStack: HistoryEntry[];
  /** 자동 레이아웃 계산 실행 중 여부 (화면 하단 처리중 표시용) */
  autoLayoutRunning: boolean;
  /** Blueprint(머신+라우팅) 영역 bbox. 렌더러의 내부/외부 경계선. */
  externalAreaBbox: { x: number; y: number; w: number; h: number } | null;
  /** 전체 캔버스 bbox (ghost cell 포함). 렌더러가 이 범위의 외부 영역을 초록으로 칠한다. */
  autoLayoutCanvasBbox: { x: number; y: number; w: number; h: number } | null;
  /** 클릭한 연결선(오버레이) — `RoutingConnectionModal` 이 이걸로 열린다. 편집과 무관하다. */
  selectedRoutingId: string | null;

  // Grid actions
  resizeGrid: (width: number, height: number) => void;
  clearGrid: () => void;
  setCell: (x: number, y: number, entity: Partial<GridCell>) => void;
  /** 단일 클릭 배치. 실패 시 toast 노출. 성공 여부 반환 (drag-place 진입 판단용) */
  placeEntity: (x: number, y: number) => boolean;
  /** Drag-place에서 사용. 실패 시 toast 없이 silently 무시. */
  placeEntitySilent: (x: number, y: number) => void;
  removeEntity: (x: number, y: number) => void;
  fillGridFromCells: (cells: GridCell[], width: number, height: number) => void;
  /**
   * 자동 레이아웃 결과처럼 좌표 + GridCell 묶음을 한 번에 그리드에 쓴다.
   * 하나의 undo entry 로 묶이며, 그리드 경계 밖 좌표는 무시한다.
   */
  applyPlacedCells: (placed: ReadonlyArray<{ x: number; y: number; cell: GridCell }>) => void;
  setAutoLayoutRunning: (v: boolean) => void;
  setExternalAreaBbox: (bbox: { x: number; y: number; w: number; h: number } | null) => void;
  setAutoLayoutCanvasBbox: (bbox: { x: number; y: number; w: number; h: number } | null) => void;
  setSelectedRouting: (id: string | null) => void;
  /** InfinityChest/InfinityPipe 를 새 위치로 이동. 성공 여부 반환. */
  moveEntityById: (entityId: string, toX: number, toY: number) => boolean;

  // Multi-selection (drag rectangle)
  selectEntitiesInRect: (x1: number, y1: number, x2: number, y2: number) => void;
  clearMultiSelection: () => void;
  deleteSelectedEntities: () => void;

  /** 배치된 instance(entityId)에 레시피 바인딩. recipe=undefined면 해제. */
  setCellRecipe: (entityId: string, recipe: string | undefined) => void;

  /**
   * 배치된 instance의 특정 슬롯에 모듈 설정. moduleSlot=null이면 그 슬롯 비우기.
   * slotCount는 해당 entity의 module_slots 값(배열 길이 보장용).
   */
  setCellModule: (
    entityId: string,
    slotIndex: number,
    moduleSlot: ModuleSlot | null,
    slotCount: number,
  ) => void;

  // Viewport actions
  setViewport: (viewport: Partial<ViewportState>) => void;
  pan: (dx: number, dy: number) => void;
  zoom: (delta: number, pivotX?: number, pivotY?: number) => void;
  resetViewport: () => void;

  // Selection actions
  setSelection: (selection: Partial<SelectionState>) => void;
  clearSelection: () => void;

  // Tool actions
  setSelectedEntity: (type: EntityType, name: string) => void;
  setSelectedDirection: (direction: Direction) => void;
  rotateSelected: () => void;

  // History
  undo: () => void;
  redo: () => void;
  pushHistory: (label: string) => void;
}

/**
 * localStorage 용량 절약을 위해 비어있는 셀(entityId===null)은 저장하지 않는
 * sparse 압축 스토리지. 읽을 때 빈 셀을 다시 채워서 반환한다.
 */
/** localStorage 에 실제로 저장되는 조각 — [partialize] 가 고르는 필드와 같아야 한다. */
type PersistedLayout = Pick<
  LayoutState,
  | 'grid'
  | 'viewport'
  | 'externalAreaBbox'
  | 'autoLayoutCanvasBbox'
>;

const compressedGridStorage = {
  getItem(name: string): string | null {
    const raw = localStorage.getItem(name);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed.state?.grid) {
        const { width, height, cells } = parsed.state.grid as {
          width: number;
          height: number;
          cells: Record<number, GridCell>;
        };
        const fullCells: GridCell[] = Array.from(
          { length: width * height },
          (_, i) => cells[i] ?? createEmptyCell()
        );
        parsed.state.grid = { width, height, cells: fullCells };
      }
      return JSON.stringify(parsed);
    } catch {
      return null;
    }
  },
  setItem(name: string, value: string): void {
    try {
      const parsed = JSON.parse(value);
      if (parsed.state?.grid) {
        const { width, height, cells } = parsed.state.grid as {
          width: number;
          height: number;
          cells: GridCell[];
        };
        const sparse: Record<number, GridCell> = {};
        cells.forEach((cell, i) => {
          if (cell.entityId !== null) sparse[i] = cell;
        });
        parsed.state.grid = { width, height, cells: sparse };
      }
      localStorage.setItem(name, JSON.stringify(parsed));
    } catch {
      // 용량 초과 or 파싱 오류 → 저장 생략
    }
  },
  removeItem(name: string): void {
    localStorage.removeItem(name);
  },
};

export const useLayoutStore = create<LayoutState>()(
  subscribeWithSelector(
  persist(
  (set, get) => ({
    grid: createEmptyGrid(DEFAULT_GRID_WIDTH, DEFAULT_GRID_HEIGHT),
    tileSize: DEFAULT_TILE_SIZE,
    viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
    selection: { active: false, startX: 0, startY: 0, endX: 0, endY: 0 },
    selectedEntityIds: new Set<string>(),
    selectedEntityType: EntityType.Empty,
    selectedEntityName: '',
    selectedDirection: 0,
    undoStack: [],
    redoStack: [],
    autoLayoutRunning: false,
    externalAreaBbox: null,
    autoLayoutCanvasBbox: null,
    selectedRoutingId: null,

    resizeGrid: (width, height) => {
      get().pushHistory('resizeGrid');
      set({ grid: createEmptyGrid(width, height) });
    },

    clearGrid: () => {
      get().pushHistory('clearGrid');
      const { grid } = get();
      set({
        grid: createEmptyGrid(grid.width, grid.height),
        externalAreaBbox: null,
        autoLayoutCanvasBbox: null,
        selectedRoutingId: null,
      });
    },

    setCell: (x, y, entity) => {
      const { grid } = get();
      const idx = cellIndex(grid, x, y);
      if (idx < 0 || idx >= grid.cells.length) return;
      const newCells = [...grid.cells];
      newCells[idx] = { ...newCells[idx], ...entity };
      set({ grid: { ...grid, cells: newCells } });
    },

    placeEntity: (x, y) => {
      const { grid, selectedEntityType, selectedEntityName, selectedDirection } = get();

      if (selectedEntityType === EntityType.Empty) {
        get().removeEntity(x, y);
        return false;
      }

      const size = getEntitySizeRotated(selectedEntityType, selectedEntityName, selectedDirection);

      // 그리드 밖(음수 포함)은 **거절**한다 — 예전엔 음수면 전체를 밀어 받아들였다.
      if (!inGrid(grid, x, y, size.width, size.height)) {
        useToastStore.getState().show(t('toasts.outOfBounds'), 'warning');
        return false;
      }

      // 동일 카테고리(Belt, Pipe) 덮어쓰기 허용. 그 외 점유 셀은 차단.
      const overwriteIds = new Set<string>();
      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          const cell = getCell(grid, x + dx, y + dy);
          if (cell && cell.entityId !== null) {
            if (canOverwrite(selectedEntityType, cell.entityType)) {
              overwriteIds.add(cell.entityId!);
              continue;
            }
            useToastStore.getState().show(t('toasts.occupied'), 'warning');
            return false;
          }
        }
      }

      get().pushHistory('placeEntity');
      const entityId = nanoid();
      const newCells = overwriteIds.size > 0
        ? grid.cells.map((c) =>
            c.entityId && overwriteIds.has(c.entityId) ? createEmptyCell() : c,
          )
        : [...grid.cells];

      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          const idx = cellIndex(grid, x + dx, y + dy);
          const isOrigin = dx === 0 && dy === 0;
          newCells[idx] = {
            entityId,
            entityName: selectedEntityName,
            entityType: selectedEntityType,
            direction: selectedDirection,
            tileOffset: { x: dx, y: dy },
            isOrigin,
          };
        }
      }

      set({ grid: { ...grid, cells: newCells } });
      return true;
    },

    /** Drag-place 전용: 실패 시 toast 없이 무시. history도 매 호출마다 push하지 않고 한 번만(첫 성공 시) push. */
    placeEntitySilent: (x, y) => {
      const { grid, selectedEntityType, selectedEntityName, selectedDirection } = get();

      if (selectedEntityType === EntityType.Empty) return;

      const size = getEntitySizeRotated(selectedEntityType, selectedEntityName, selectedDirection);

      // 그리드 밖(음수 포함)은 조용히 무시 — 드래그가 경계를 스쳐도 배치가 안 밀린다.
      if (!inGrid(grid, x, y, size.width, size.height)) return;

      const overwriteIds = new Set<string>();
      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          const cell = getCell(grid, x + dx, y + dy);
          if (cell && cell.entityId !== null) {
            if (canOverwrite(selectedEntityType, cell.entityType)) {
              overwriteIds.add(cell.entityId!);
              continue;
            }
            return;
          }
        }
      }

      const entityId = nanoid();
      const newCells = overwriteIds.size > 0
        ? grid.cells.map((c) =>
            c.entityId && overwriteIds.has(c.entityId) ? createEmptyCell() : c,
          )
        : [...grid.cells];

      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          const idx = cellIndex(grid, x + dx, y + dy);
          const isOrigin = dx === 0 && dy === 0;
          newCells[idx] = {
            entityId,
            entityName: selectedEntityName,
            entityType: selectedEntityType,
            direction: selectedDirection,
            tileOffset: { x: dx, y: dy },
            isOrigin,
          };
        }
      }

      set({ grid: { ...grid, cells: newCells } });
    },

    removeEntity: (x, y) => {
      const { grid } = get();
      const cell = getCell(grid, x, y);
      if (!cell || cell.entityId === null) return;

      const entityId = cell.entityId;
      get().pushHistory('removeEntity');
      const newCells = grid.cells.map((c) =>
        c.entityId === entityId ? createEmptyCell() : c
      );
      set({ grid: { ...grid, cells: newCells } });
    },

    fillGridFromCells: (cells, width, height) => {
      set({ grid: { width, height, cells } });
    },

    applyPlacedCells: (placed) => {
      if (placed.length === 0) return;
      const { grid } = get();

      // 여기 오는 좌표는 **이미 그리드 좌표**다 — `unifyLeaf` 가 모든 좌표를 ≥ 1 로 옮겨 놓는다.
      // 예전엔 이 자리에서 음수를 보고 그리드 전체를 밀었는데, 그것이 네 번째 좌표 프레임의
      // 출처였다. 음수가 온다면 정규화 실패이므로 **조용히 자르지 않고 드러낸다** — 잘라 버리면
      // "성공했다는데 셀이 몇 개 사라진" 배치가 된다.
      const out = placed.filter(({ x, y }) => x < 0 || y < 0);
      if (out.length > 0) {
        console.error(
          `[layout] 음수 좌표 셀 ${out.length}개 — unifyLeaf 정규화가 깨졌다.`,
          out.slice(0, 5),
        );
      }

      get().pushHistory('applyPlacedCells');
      const newCells = [...grid.cells];
      for (const { x, y, cell } of placed) {
        if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
        newCells[cellIndex(grid, x, y)] = cell;
      }
      set({ grid: { ...grid, cells: newCells } });
    },

    setAutoLayoutRunning: (v) => set({ autoLayoutRunning: v }),

    setExternalAreaBbox: (bbox) => set({ externalAreaBbox: bbox }),
    setAutoLayoutCanvasBbox: (bbox) => set({ autoLayoutCanvasBbox: bbox }),

    setSelectedRouting: (id) => set({ selectedRoutingId: id }),

    moveEntityById: (entityId, toX, toY) => {
      const { grid } = get();

      // Find origin cell
      let originX = -1, originY = -1;
      let entityType: (typeof EntityType)[keyof typeof EntityType] = EntityType.Empty;
      let entityName: string | null = null;
      let direction: Direction = 0;
      let recipe: string | undefined;

      for (let i = 0; i < grid.cells.length; i++) {
        const cell = grid.cells[i];
        if (cell.entityId === entityId && cell.isOrigin) {
          originX = i % grid.width;
          originY = Math.floor(i / grid.width);
          entityType = cell.entityType;
          entityName = cell.entityName;
          direction = cell.direction;
          recipe = cell.recipe;
          break;
        }
      }

      if (originX < 0) return false;
      if (originX === toX && originY === toY) return false;

      const size = getEntitySizeRotated(entityType, entityName ?? '', direction);

      // 그리드 밖(음수 포함)으로는 못 옮긴다 — 예전엔 음수면 전체를 밀어 받아들였다.
      if (!inGrid(grid, toX, toY, size.width, size.height)) return false;

      // Collision check (자기 자신이 지금 차지한 칸은 뺀다 — 겹쳐 이동하는 경우)
      const currentKeys = new Set<string>();
      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          currentKeys.add(`${originX + dx},${originY + dy}`);
        }
      }
      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          const tx = toX + dx, ty = toY + dy;
          if (currentKeys.has(`${tx},${ty}`)) continue;
          const cell = getCell(grid, tx, ty);
          if (cell?.entityId !== null) return false;
        }
      }

      const newCells = [...grid.cells];

      // Clear old entity position
      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          const idx = cellIndex(grid, originX + dx, originY + dy);
          if (idx >= 0 && idx < newCells.length) newCells[idx] = createEmptyCell();
        }
      }

      // Place at new position
      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          const idx = cellIndex(grid, toX + dx, toY + dy);
          if (idx >= 0 && idx < newCells.length) {
            newCells[idx] = {
              entityId,
              entityName,
              entityType,
              direction,
              tileOffset: { x: dx, y: dy },
              isOrigin: dx === 0 && dy === 0,
              ...(recipe !== undefined ? { recipe } : {}),
            };
          }
        }
      }

      // pushHistory 는 실제로 상태를 바꾸는 경로에서만 호출 (set() 직전).
      get().pushHistory('moveEntityById');
      set({ grid: { ...grid, cells: newCells } });
      return true;
    },

    selectEntitiesInRect: (x1, y1, x2, y2) => {
      const { grid } = get();
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      const ids = new Set<string>();
      for (let yy = minY; yy <= maxY; yy++) {
        for (let xx = minX; xx <= maxX; xx++) {
          const cell = getCell(grid, xx, yy);
          if (cell?.entityId) ids.add(cell.entityId);
        }
      }
      set({ selectedEntityIds: ids });
    },

    clearMultiSelection: () =>
      set({ selectedEntityIds: new Set<string>() }),

    deleteSelectedEntities: () => {
      const { grid, selectedEntityIds } = get();
      if (selectedEntityIds.size === 0) return;
      get().pushHistory('deleteSelectedEntities');
      const newCells = grid.cells.map((c) =>
        c.entityId && selectedEntityIds.has(c.entityId) ? createEmptyCell() : c
      );
      set({
        grid: { ...grid, cells: newCells },
        selectedEntityIds: new Set<string>(),
      });
    },

    setCellRecipe: (entityId, recipe) => {
      const { grid } = get();
      // 해당 instance에 속한 셀이 있는지 확인 (없으면 no-op)
      const exists = grid.cells.some((c) => c.entityId === entityId);
      if (!exists) return;
      get().pushHistory('setCellRecipe');
      const newCells = grid.cells.map((c) =>
        c.entityId === entityId ? { ...c, recipe } : c
      );
      set({ grid: { ...grid, cells: newCells } });
    },

    setCellModule: (entityId, slotIndex, moduleSlot, slotCount) => {
      const { grid } = get();
      const exists = grid.cells.some((c) => c.entityId === entityId);
      if (!exists) return;
      if (slotIndex < 0 || slotIndex >= slotCount) return;
      get().pushHistory('setCellModule');
      const newCells = grid.cells.map((c) => {
        if (c.entityId !== entityId) return c;
        // 슬롯 배열 정규화: slotCount 길이 보장 + 빈 곳은 null
        const baseModules: Array<ModuleSlot | null> = c.modules
          ? [...c.modules]
          : [];
        while (baseModules.length < slotCount) baseModules.push(null);
        baseModules.length = slotCount;
        baseModules[slotIndex] = moduleSlot;
        // 모두 null이면 modules 필드 자체 제거 (export 깔끔)
        const allEmpty = baseModules.every((m) => m === null);
        if (allEmpty) {
          const { modules: _drop, ...rest } = c;
          void _drop;
          return rest;
        }
        return { ...c, modules: baseModules };
      });
      set({ grid: { ...grid, cells: newCells } });
    },

    setViewport: (viewport) =>
      set((state) => ({ viewport: { ...state.viewport, ...viewport } })),

    pan: (dx, dy) =>
      set((state) => ({
        viewport: {
          ...state.viewport,
          offsetX: state.viewport.offsetX + dx,
          offsetY: state.viewport.offsetY + dy,
        },
      })),

    zoom: (delta, pivotX?: number, pivotY?: number) => {
      set((state) => {
        const oldZoom = state.viewport.zoom;
        const newZoom = Math.max(0.25, Math.min(4, oldZoom + delta));
        const ratio = newZoom / oldZoom;
        let { offsetX, offsetY } = state.viewport;
        if (pivotX !== undefined && pivotY !== undefined) {
          // 커서 위치를 기준으로 줌: 커서 아래의 그리드 타일이 고정되도록 offset 보정
          offsetX = pivotX - (pivotX - offsetX) * ratio;
          offsetY = pivotY - (pivotY - offsetY) * ratio;
        }
        return { viewport: { ...state.viewport, zoom: newZoom, offsetX, offsetY } };
      });
    },

    resetViewport: () =>
      set({ viewport: { offsetX: 0, offsetY: 0, zoom: 1 } }),

    setSelection: (selection) =>
      set((state) => ({ selection: { ...state.selection, ...selection } })),

    clearSelection: () =>
      set({ selection: { active: false, startX: 0, startY: 0, endX: 0, endY: 0 } }),

    setSelectedEntity: (type, name) => {
      set({ selectedEntityType: type, selectedEntityName: name });
    },

    setSelectedDirection: (direction) => set({ selectedDirection: direction }),

    rotateSelected: () =>
      set((state) => ({
        // cardinal 4방향 회전: 0 → 4 → 8 → 12 → 0 (Factorio 2.0 16-방향 인코딩)
        selectedDirection: ((state.selectedDirection + 4) % 16) as Direction,
      })),

    pushHistory: (label) => {
      const { grid, undoStack } = get();
      const entry: HistoryEntry = { cells: [...grid.cells], label };
      set({
        undoStack: [...undoStack.slice(-49), entry], // max 50 entries
        redoStack: [],
      });
    },

    undo: () => {
      const { grid, undoStack, redoStack } = get();
      if (undoStack.length === 0) return;
      const prev = undoStack[undoStack.length - 1];
      console.log('[history] undo:', prev.label);
      const redoEntry: HistoryEntry = { cells: [...grid.cells], label: prev.label };
      set({
        grid: { ...grid, cells: prev.cells },
        undoStack: undoStack.slice(0, -1),
        redoStack: [...redoStack, redoEntry],
        selectedEntityIds: new Set<string>(),
      });
    },

    redo: () => {
      const { grid, undoStack, redoStack } = get();
      if (redoStack.length === 0) return;
      const next = redoStack[redoStack.length - 1];
      console.log('[history] redo:', next.label);
      const undoEntry: HistoryEntry = { cells: [...grid.cells], label: next.label };
      set({
        grid: { ...grid, cells: next.cells },
        undoStack: [...undoStack, undoEntry],
        redoStack: redoStack.slice(0, -1),
        selectedEntityIds: new Set<string>(),
      });
    },
  }),
  {
    name: 'factorio-layout-store',
    // **문자열** 기반 어댑터다(zustand v3 모양). v5 의 persist 는 객체(PersistStorage)를
    // 기대하므로 createJSONStorage 로 감싸야 한다. 안 감싸면 setItem 이 객체를 받아
    // JSON.parse 에서 터지고 그 예외를 아래 빈 catch 가 삼켜 **아무것도 저장되지 않는다**
    // (2026-07-25 발견 — 타입 에러가 그 사실을 가리키고 있었다).
    storage: createJSONStorage<PersistedLayout>(() => compressedGridStorage),
    partialize: (state): PersistedLayout => ({
      grid: state.grid,
      viewport: state.viewport,
      externalAreaBbox: state.externalAreaBbox,
      autoLayoutCanvasBbox: state.autoLayoutCanvasBbox,
    }),
    /**
     * v0 → v1: 내부 Direction 을 Factorio 1.x (0/2/4/6) 에서 2.0 (0/4/8/12) 로 ×2 마이그레이션.
     * 이전 사용자 저장본의 cell.direction 을 모두 두 배로 환산한다.
     */
    version: 1,
    migrate: (persisted: unknown, fromVersion: number) => {
      if (fromVersion < 1 && persisted && typeof persisted === 'object') {
        const p = persisted as { grid?: { cells?: Record<number, GridCell> | GridCell[] } };
        const cells = p.grid?.cells;
        if (cells) {
          const upgrade = (c: GridCell): GridCell =>
            c.direction !== undefined && c.direction !== null
              ? { ...c, direction: ((c.direction as number) * 2) as Direction }
              : c;
          if (Array.isArray(cells)) {
            p.grid!.cells = cells.map(upgrade);
          } else {
            const upgraded: Record<number, GridCell> = {};
            for (const [k, v] of Object.entries(cells)) upgraded[Number(k)] = upgrade(v);
            p.grid!.cells = upgraded;
          }
        }
      }
      return persisted as LayoutState;
    },
  }
  ))
);

/** Utility: convert canvas pixel position to grid tile position */
export function canvasToGrid(
  cx: number,
  cy: number,
  viewport: ViewportState,
  tileSize: number
): GridPosition {
  return {
    x: Math.floor((cx - viewport.offsetX) / (tileSize * viewport.zoom)),
    y: Math.floor((cy - viewport.offsetY) / (tileSize * viewport.zoom)),
  };
}
