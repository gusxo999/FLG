import { create } from 'zustand';
import { subscribeWithSelector, persist } from 'zustand/middleware';
import type {
  LayoutGrid,
  GridCell,
  Direction,
  ViewportState,
  SelectionState,
  GridPosition,
} from '../types/layout';
import type { ModuleSlot } from '../types/layout';
import {
  EntityType,
  createEmptyGrid,
  createEmptyCell,
  cellIndex,
  getCell,
} from '../types/layout';
import { getEntitySizeRotated } from '../utils/entitySize';
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

interface HistoryEntry {
  cells: GridCell[];
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
  pushHistory: () => void;
}

/**
 * localStorage 용량 절약을 위해 비어있는 셀(entityId===null)은 저장하지 않는
 * sparse 압축 스토리지. 읽을 때 빈 셀을 다시 채워서 반환한다.
 */
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

    resizeGrid: (width, height) => {
      get().pushHistory();
      set({ grid: createEmptyGrid(width, height) });
    },

    clearGrid: () => {
      get().pushHistory();
      const { grid } = get();
      set({ grid: createEmptyGrid(grid.width, grid.height) });
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
      const {
        grid,
        selectedEntityType,
        selectedEntityName,
        selectedDirection,
      } = get();

      if (selectedEntityType === EntityType.Empty) {
        get().removeEntity(x, y);
        return false;
      }

      const size = getEntitySizeRotated(selectedEntityType, selectedEntityName, selectedDirection);

      const outOfBounds = x + size.width > grid.width || y + size.height > grid.height || x < 0 || y < 0;
      if (outOfBounds) {
        useToastStore.getState().show(t('toasts.outOfBounds'), 'warning');
        return false;
      }

      // 동일 카테고리(Belt, Pipe) 덮어쓰기 허용. 그 외 점유 셀은 차단.
      const overwriteIds = new Set<string>();
      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          const cell = getCell(grid, x + dx, y + dy);
          if (cell?.entityId !== null) {
            if (canOverwrite(selectedEntityType, cell.entityType)) {
              overwriteIds.add(cell.entityId!);
              continue;
            }
            useToastStore.getState().show(t('toasts.occupied'), 'warning');
            return false;
          }
        }
      }

      get().pushHistory();
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
      const {
        grid,
        selectedEntityType,
        selectedEntityName,
        selectedDirection,
      } = get();

      if (selectedEntityType === EntityType.Empty) return;

      const size = getEntitySizeRotated(selectedEntityType, selectedEntityName, selectedDirection);

      if (x + size.width > grid.width || y + size.height > grid.height || x < 0 || y < 0) return;

      const overwriteIds = new Set<string>();
      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          const cell = getCell(grid, x + dx, y + dy);
          if (cell?.entityId !== null) {
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
      get().pushHistory();
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
      get().pushHistory();
      const newCells = [...grid.cells];
      for (const { x, y, cell } of placed) {
        if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
        newCells[cellIndex(grid, x, y)] = cell;
      }
      set({ grid: { ...grid, cells: newCells } });
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
      get().pushHistory();
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
      get().pushHistory();
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
      get().pushHistory();
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

    pushHistory: () => {
      const { grid, undoStack } = get();
      const entry: HistoryEntry = { cells: [...grid.cells] };
      set({
        undoStack: [...undoStack.slice(-49), entry], // max 50 entries
        redoStack: [],
      });
    },

    undo: () => {
      const { grid, undoStack, redoStack } = get();
      if (undoStack.length === 0) return;
      const prev = undoStack[undoStack.length - 1];
      const redoEntry: HistoryEntry = { cells: [...grid.cells] };
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
      const undoEntry: HistoryEntry = { cells: [...grid.cells] };
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
    storage: compressedGridStorage,
    partialize: (state) => ({
      grid: state.grid,
      viewport: state.viewport,
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

/** Utility: convert grid position to canvas pixel position */
export function gridToCanvas(
  gx: number,
  gy: number,
  viewport: ViewportState,
  tileSize: number
): GridPosition {
  return {
    x: gx * tileSize * viewport.zoom + viewport.offsetX,
    y: gy * tileSize * viewport.zoom + viewport.offsetY,
  };
}

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
