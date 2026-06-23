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
import type { Container, Area, PortKind, Routing, ContainerWizardInput } from '../utils/autoLayout/containerModel';
import type { RouteOptions } from '../utils/autoLayout/routeFallback';
import { routeWithFallback } from '../utils/autoLayout/routeFallback';
import { commitRouting } from '../utils/autoLayout/containerRouting';
import { dragExternalContainer, dragAssemblerGroup, cloneArea, cloneRouting } from '../utils/autoLayout/areaUnification';
import { AUTO_LAYOUT_COORD_DUMP } from '../utils/autoLayout/debugFlags';

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

export interface RoutingSessionRouting {
  id: string;
  portKind: PortKind;
  fromContainerId: string;
  toContainerId: string;
}

export interface RoutingEditSession {
  containers: Container[];
  routings: RoutingSessionRouting[];
  machineParent: Record<string, string | null>;
  machineChildren: Record<string, string[]>;
  routeOptions: RouteOptions;
  /** container.origin + containerOriginOffset = 실제 그리드 좌표 */
  containerOriginOffset: { x: number; y: number };
  /**
   * apply 시점의 Area 모델 — chest 드래그 재라우팅에 사용.
   * dragExternalContainer 가 직접 mutate 하므로 항상 최신 상태.
   * apply 없이 직접 그리드에 배치한 경우 undefined.
   */
  liveArea?: { internal: Area; external: Area; routings: Routing[] };
}

/**
 * 시각화(Visualization) 진입 소스 — 후보 적용 시점에 저장된다.
 * 시각화 버튼이 `traceLayeredPath(input)` 로 그 후보의 생성 과정을 결정적으로
 * 재현하는 데 필요한 최소 정보. S-LAYER 는 perm/dir 없는 단일 패스라 입력만 필요.
 */
export interface VisualizationSource {
  /** 후보 생성에 쓰인 위저드 입력 */
  input: ContainerWizardInput;
}

const DEFAULT_GRID_WIDTH = 256;
const DEFAULT_GRID_HEIGHT = 256;
const DEFAULT_TILE_SIZE = 32; // pixels per tile at zoom=1

// ─── 음수 좌표 정규화 헬퍼 ────────────────────────────────────────────────────

/** 모든 그리드 셀을 (dx, dy) 만큼 평행이동. 범위 밖으로 밀린 셀은 손실. */
function shiftGridCells(grid: LayoutGrid, dx: number, dy: number): LayoutGrid {
  const newCells = grid.cells.map(() => createEmptyCell());
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const src = grid.cells[y * grid.width + x];
      if (!src.entityId) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < grid.width && ny >= 0 && ny < grid.height) {
        newCells[ny * grid.width + nx] = src;
      }
    }
  }
  return { ...grid, cells: newCells };
}

/** 그리드 shift 후 화면이 흔들리지 않도록 viewport offset 보정. */
function shiftViewport(vp: ViewportState, dx: number, dy: number, tileSize: number): ViewportState {
  return {
    ...vp,
    offsetX: vp.offsetX - dx * tileSize * vp.zoom,
    offsetY: vp.offsetY - dy * tileSize * vp.zoom,
  };
}

/** bbox 좌표를 (dx, dy) 이동. */
function shiftBbox(
  bbox: { x: number; y: number; w: number; h: number } | null,
  dx: number, dy: number,
): { x: number; y: number; w: number; h: number } | null {
  if (!bbox) return null;
  return { ...bbox, x: bbox.x + dx, y: bbox.y + dy };
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
  /** 자동 레이아웃 hover 미리보기 셀 (실제 그리드에 반영되지 않음) */
  previewCells: ReadonlyArray<{ x: number; y: number; cell: GridCell }> | null;
  /** 자동 레이아웃 계산 실행 중 여부 (화면 하단 처리중 표시용) */
  autoLayoutRunning: boolean;
  /** Blueprint(머신+라우팅) 영역 bbox. 렌더러의 내부/외부 경계선. */
  externalAreaBbox: { x: number; y: number; w: number; h: number } | null;
  /** 전체 캔버스 bbox (ghost cell 포함). 렌더러가 이 범위의 외부 영역을 초록으로 칠한다. */
  autoLayoutCanvasBbox: { x: number; y: number; w: number; h: number } | null;
  /** 가상 좌표계 원점 오프셋. 표시 좌표 = 내부좌표 + gridOriginX/Y. shift 누적으로 음수가 됨. */
  gridOriginX: number;
  gridOriginY: number;
  routingEditMode: boolean;
  routingEditSession: RoutingEditSession | null;
  selectedRoutingId: string | null;
  /** 시각화 진입 소스 — 후보 적용 시 세팅. null 이면 시각화 버튼 비활성. */
  visualizationSource: VisualizationSource | null;

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
  setPreviewCells: (cells: ReadonlyArray<{ x: number; y: number; cell: GridCell }> | null) => void;
  setAutoLayoutRunning: (v: boolean) => void;
  setExternalAreaBbox: (bbox: { x: number; y: number; w: number; h: number } | null) => void;
  setAutoLayoutCanvasBbox: (bbox: { x: number; y: number; w: number; h: number } | null) => void;
  setRoutingEditMode: (v: boolean) => void;
  setRoutingEditSession: (session: RoutingEditSession | null) => void;
  setVisualizationSource: (s: VisualizationSource | null) => void;
  setSelectedRouting: (id: string | null) => void;
  /** InfinityChest/InfinityPipe 를 새 위치로 이동. 성공 여부 반환. */
  moveEntityById: (entityId: string, toX: number, toY: number) => boolean;
  /** 라우팅 수정 모드: 조립기계 그룹(부모+자손)을 (dx,dy) 이동. 성공 여부 반환. */
  moveAssemblerGroup: (containerId: string, dx: number, dy: number) => boolean;

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
    previewCells: null,
    autoLayoutRunning: false,
    externalAreaBbox: null,
    autoLayoutCanvasBbox: null,
    gridOriginX: 0,
    gridOriginY: 0,
    routingEditMode: false,
    routingEditSession: null,
    selectedRoutingId: null,
    visualizationSource: null,

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
        gridOriginX: 0,
        gridOriginY: 0,
        routingEditSession: null,
        routingEditMode: false,
        selectedRoutingId: null,
        visualizationSource: null,
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
      const {
        grid, viewport, tileSize,
        selectedEntityType, selectedEntityName, selectedDirection,
        externalAreaBbox, autoLayoutCanvasBbox,
        gridOriginX, gridOriginY,
      } = get();

      if (selectedEntityType === EntityType.Empty) {
        get().removeEntity(x, y);
        return false;
      }

      const size = getEntitySizeRotated(selectedEntityType, selectedEntityName, selectedDirection);

      // 음수 좌표: 기존 셀 전체를 평행이동해 공간 확보
      const sx = Math.max(0, -x);
      const sy = Math.max(0, -y);
      const workGrid = sx > 0 || sy > 0 ? shiftGridCells(grid, sx, sy) : grid;
      const ax = x + sx, ay = y + sy;

      if (ax + size.width > workGrid.width || ay + size.height > workGrid.height) {
        useToastStore.getState().show(t('toasts.outOfBounds'), 'warning');
        return false;
      }

      // 동일 카테고리(Belt, Pipe) 덮어쓰기 허용. 그 외 점유 셀은 차단.
      const overwriteIds = new Set<string>();
      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          const cell = getCell(workGrid, ax + dx, ay + dy);
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

      get().pushHistory('placeEntity');
      const entityId = nanoid();
      const newCells = overwriteIds.size > 0
        ? workGrid.cells.map((c) =>
            c.entityId && overwriteIds.has(c.entityId) ? createEmptyCell() : c,
          )
        : [...workGrid.cells];

      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          const idx = cellIndex(workGrid, ax + dx, ay + dy);
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

      set({
        grid: { ...workGrid, cells: newCells },
        ...(sx > 0 || sy > 0 ? {
          viewport: shiftViewport(viewport, sx, sy, tileSize),
          externalAreaBbox: shiftBbox(externalAreaBbox, sx, sy),
          autoLayoutCanvasBbox: shiftBbox(autoLayoutCanvasBbox, sx, sy),
          gridOriginX: gridOriginX - sx,
          gridOriginY: gridOriginY - sy,
        } : {}),
      });
      return true;
    },

    /** Drag-place 전용: 실패 시 toast 없이 무시. history도 매 호출마다 push하지 않고 한 번만(첫 성공 시) push. */
    placeEntitySilent: (x, y) => {
      const {
        grid, viewport, tileSize,
        selectedEntityType, selectedEntityName, selectedDirection,
        externalAreaBbox, autoLayoutCanvasBbox,
        gridOriginX, gridOriginY,
      } = get();

      if (selectedEntityType === EntityType.Empty) return;

      const size = getEntitySizeRotated(selectedEntityType, selectedEntityName, selectedDirection);

      // 음수 좌표: 기존 셀 전체를 평행이동해 공간 확보
      const sx = Math.max(0, -x);
      const sy = Math.max(0, -y);
      const workGrid = sx > 0 || sy > 0 ? shiftGridCells(grid, sx, sy) : grid;
      const ax = x + sx, ay = y + sy;

      if (ax + size.width > workGrid.width || ay + size.height > workGrid.height) return;

      const overwriteIds = new Set<string>();
      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          const cell = getCell(workGrid, ax + dx, ay + dy);
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
        ? workGrid.cells.map((c) =>
            c.entityId && overwriteIds.has(c.entityId) ? createEmptyCell() : c,
          )
        : [...workGrid.cells];

      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          const idx = cellIndex(workGrid, ax + dx, ay + dy);
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

      set({
        grid: { ...workGrid, cells: newCells },
        ...(sx > 0 || sy > 0 ? {
          viewport: shiftViewport(viewport, sx, sy, tileSize),
          externalAreaBbox: shiftBbox(externalAreaBbox, sx, sy),
          autoLayoutCanvasBbox: shiftBbox(autoLayoutCanvasBbox, sx, sy),
          gridOriginX: gridOriginX - sx,
          gridOriginY: gridOriginY - sy,
        } : {}),
      });
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
      const { grid, viewport, tileSize, externalAreaBbox, autoLayoutCanvasBbox, gridOriginX, gridOriginY } = get();

      // 음수 좌표가 있으면 전체 평행이동으로 정규화
      let minX = 0, minY = 0;
      for (const { x, y } of placed) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
      }
      const sx = -minX, sy = -minY; // sx/sy >= 0
      const workGrid = sx > 0 || sy > 0 ? shiftGridCells(grid, sx, sy) : grid;

      get().pushHistory('applyPlacedCells');
      const newCells = [...workGrid.cells];
      for (const { x, y, cell } of placed) {
        const ax = x + sx, ay = y + sy;
        if (ax < 0 || ay < 0 || ax >= workGrid.width || ay >= workGrid.height) continue;
        newCells[cellIndex(workGrid, ax, ay)] = cell;
      }
      set({
        grid: { ...workGrid, cells: newCells },
        previewCells: null,
        ...(sx > 0 || sy > 0 ? {
          viewport: shiftViewport(viewport, sx, sy, tileSize),
          externalAreaBbox: shiftBbox(externalAreaBbox, sx, sy),
          autoLayoutCanvasBbox: shiftBbox(autoLayoutCanvasBbox, sx, sy),
          gridOriginX: gridOriginX - sx,
          gridOriginY: gridOriginY - sy,
        } : {}),
      });
    },

    setPreviewCells: (cells) => set({ previewCells: cells }),

    setAutoLayoutRunning: (v) => set({ autoLayoutRunning: v }),

    setExternalAreaBbox: (bbox) => set({ externalAreaBbox: bbox }),
    setAutoLayoutCanvasBbox: (bbox) => set({ autoLayoutCanvasBbox: bbox }),

    setRoutingEditMode: (v) => set({ routingEditMode: v }),
    setRoutingEditSession: (session) => set({ routingEditSession: session }),
    setVisualizationSource: (s) => set({ visualizationSource: s }),
    setSelectedRouting: (id) => set({ selectedRoutingId: id }),

    moveAssemblerGroup: (containerId, dx, dy) => {
      const { grid, viewport, tileSize, routingEditSession, externalAreaBbox, autoLayoutCanvasBbox, gridOriginX, gridOriginY } = get();
      if (!routingEditSession) return false;
      if (dx === 0 && dy === 0) return false;

      // 1. BFS: group = containerId + all descendant machines
      const groupIds = new Set<string>([containerId]);
      const queue: string[] = [containerId];
      while (queue.length > 0) {
        const curr = queue.shift()!;
        for (const child of (routingEditSession.machineChildren[curr] ?? [])) {
          if (!groupIds.has(child)) { groupIds.add(child); queue.push(child); }
        }
      }

      // 2. 음수 좌표 진입 여부 사전 검사 (그룹 셀 기준)
      let sx = 0, sy = 0;
      for (let i = 0; i < grid.cells.length; i++) {
        const cell = grid.cells[i];
        if (cell.entityId && groupIds.has(cell.entityId)) {
          const rx = (i % grid.width) + dx;
          const ry = Math.floor(i / grid.width) + dy;
          if (rx < 0) sx = Math.max(sx, -rx);
          if (ry < 0) sy = Math.max(sy, -ry);
        }
      }

      // ─── A-plan: liveArea 있고 grid shift 불필요 — Area 모델 위임 (chest 드래그와 대칭) ───
      if (routingEditSession.liveArea && sx === 0 && sy === 0) {
        const coox = routingEditSession.containerOriginOffset?.x ?? 0;
        const cooy = routingEditSession.containerOriginOffset?.y ?? 0;

        const internalA = cloneArea(routingEditSession.liveArea.internal);
        const externalA = cloneArea(routingEditSession.liveArea.external);
        const areaRoutings = routingEditSession.liveArea.routings.map(cloneRouting);

        // 그리드 셀 클리어용 — 이동 전 시점에 그룹과 연결된 라우팅 id (old)
        const oldAffectedRoutingIds = new Set<string>();
        for (const r of routingEditSession.routings) {
          const fi = groupIds.has(r.fromContainerId);
          const ti = groupIds.has(r.toContainerId);
          if (fi || ti) oldAffectedRoutingIds.add(r.id);
        }

        const result = dragAssemblerGroup(
          containerId, dx, dy,
          routingEditSession.machineChildren,
          internalA, externalA, areaRoutings,
          routingEditSession.routeOptions,
        );

        if (!result.ok) {
          const msg =
            result.reason === 'collision' ? '이동 위치가 다른 셀과 충돌합니다' :
            result.reason === 'no-path' ? '라우팅 경로를 찾을 수 없어 이동이 취소되었습니다' :
            '연결 대상이 사라져 이동을 취소했습니다';
          useToastStore.getState().show(msg, 'warning');
          return false;
        }

        get().pushHistory('moveAssemblerGroup');
        const liveCells = [...grid.cells];

        // 옛 그룹 머신 셀 + 옛 영향분 라우팅 셀 제거
        for (let i = 0; i < liveCells.length; i++) {
          const c = liveCells[i];
          if (c.entityId && (groupIds.has(c.entityId) || oldAffectedRoutingIds.has(c.entityId))) {
            liveCells[i] = createEmptyCell();
          }
        }

        // 새 그룹 머신 셀 배치 (internal.placed 에서 entityId ∈ groupIds, layout → grid)
        for (const p of internalA.placed) {
          if (p.cell.entityId && groupIds.has(p.cell.entityId)) {
            const gx = p.x + coox, gy = p.y + cooy;
            const idx = cellIndex(grid, gx, gy);
            if (idx >= 0 && idx < liveCells.length) liveCells[idx] = p.cell;
          }
        }

        // 새 라우팅 셀 (rerouted boundary + shifted internal-of-group)
        const finalAffectedRoutingIds = new Set<string>([
          ...result.rerouted.map(r => r.id),
          ...result.shiftedInternalRoutingIds,
        ]);
        for (const r of areaRoutings) {
          if (!finalAffectedRoutingIds.has(r.id)) continue;
          for (const { x, y, cell } of r.placed) {
            const gx = x + coox, gy = y + cooy;
            const idx = cellIndex(grid, gx, gy);
            if (idx >= 0 && idx < liveCells.length) liveCells[idx] = cell;
          }
        }

        // session.containers: 그룹의 새 origin 을 Area 에서 가져온다
        const updatedSessionContainers: Container[] = routingEditSession.containers.map(c => {
          if (!groupIds.has(c.id)) return c;
          const upd = internalA.containers.find(ic => ic.id === c.id)
            ?? externalA.containers.find(ec => ec.id === c.id);
          return upd ? { ...upd, origin: { ...upd.origin }, size: { ...upd.size } } : c;
        });

        // session.routings: areaRoutings 에서 재구성 (rerouted 라우팅 id 변경 가능)
        const updatedSessionRoutings: RoutingSessionRouting[] = areaRoutings.map(r => ({
          id: r.id,
          portKind: r.from.kind,
          fromContainerId: r.from.containerId,
          toContainerId: r.to.containerId,
        }));

        set({
          grid: { ...grid, cells: liveCells },
          routingEditSession: {
            ...routingEditSession,
            containers: updatedSessionContainers,
            routings: updatedSessionRoutings,
            liveArea: { internal: internalA, external: externalA, routings: areaRoutings },
          },
        });
        return true;
      }

      // ─── B-plan: liveArea 없거나 음수 시프트 필요 — 기존 grid 기반 경로 ───
      if (AUTO_LAYOUT_COORD_DUMP) {
        console.log('[autoLayout debug] moveAssemblerGroup — fallback path\n' + JSON.stringify({
          containerId,
          groupIds: [...groupIds],
          delta: { dx, dy },
          reason: routingEditSession.liveArea ? 'grid-shift-needed' : 'no-live-area',
          shift: { sx, sy },
        }, null, 2));
      }

      // 2. Classify routings: internal (both in group) vs boundary (one in group)
      const internalRoutingIds = new Set<string>();
      const boundaryRoutings: RoutingSessionRouting[] = [];
      for (const r of routingEditSession.routings) {
        const fi = groupIds.has(r.fromContainerId);
        const ti = groupIds.has(r.toContainerId);
        if (fi && ti) internalRoutingIds.add(r.id);
        else if (fi || ti) boundaryRoutings.push(r);
      }

      const workGrid = sx > 0 || sy > 0 ? shiftGridCells(grid, sx, sy) : grid;
      const workViewport = sx > 0 || sy > 0 ? shiftViewport(viewport, sx, sy, tileSize) : viewport;

      // 3. Collect cells to move/clear (from workGrid)
      const machineCellEntries: Array<{ x: number; y: number; cell: GridCell }> = [];
      const internalRoutingCellEntries: Array<{ x: number; y: number; cell: GridCell }> = [];
      const boundaryRoutingIdSet = new Set(boundaryRoutings.map(r => r.id));
      const clearIndices = new Set<number>();

      for (let i = 0; i < workGrid.cells.length; i++) {
        const cell = workGrid.cells[i];
        if (!cell.entityId) continue;
        const x = i % workGrid.width;
        const y = Math.floor(i / workGrid.width);
        if (groupIds.has(cell.entityId)) {
          machineCellEntries.push({ x, y, cell });
          clearIndices.add(i);
        } else if (internalRoutingIds.has(cell.entityId)) {
          internalRoutingCellEntries.push({ x, y, cell });
          clearIndices.add(i);
        } else if (boundaryRoutingIdSet.has(cell.entityId)) {
          clearIndices.add(i);
        }
      }

      // 4. Bounds check (right/bottom only — left/top already ensured by shift)
      for (const { x, y } of machineCellEntries) {
        const nx = x + dx, ny = y + dy;
        if (nx >= workGrid.width || ny >= workGrid.height) {
          useToastStore.getState().show('이동 위치가 그리드 범위를 벗어납니다', 'warning');
          return false;
        }
      }

      // 5. Collision check for new machine positions (skip cells that will be cleared)
      const clearKeySet = new Set<string>();
      for (const i of clearIndices) {
        clearKeySet.add(`${i % workGrid.width},${Math.floor(i / workGrid.width)}`);
      }
      for (const { x, y } of machineCellEntries) {
        const nx = x + dx, ny = y + dy;
        if (!clearKeySet.has(`${nx},${ny}`)) {
          const existingCell = getCell(workGrid, nx, ny);
          if (existingCell?.entityId) {
            useToastStore.getState().show('이동 위치가 다른 셀과 충돌합니다', 'warning');
            return false;
          }
        }
      }

      get().pushHistory('moveAssemblerGroup');
      const newCells = [...workGrid.cells];

      // 6. Clear old positions
      for (const idx of clearIndices) newCells[idx] = createEmptyCell();

      // 7. Place machines at shifted positions
      for (const { x, y, cell } of machineCellEntries) {
        newCells[cellIndex(workGrid, x + dx, y + dy)] = cell;
      }

      // 8. Shift internal routing cells (skip out-of-bounds)
      for (const { x, y, cell } of internalRoutingCellEntries) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < workGrid.width && ny < workGrid.height) {
          newCells[cellIndex(workGrid, nx, ny)] = cell;
        }
      }

      // 9. Update container origins (group: +sx+dx/dy, non-group: +sx/sy for grid shift)
      const updatedContainers: Container[] = routingEditSession.containers.map(c =>
        groupIds.has(c.id)
          ? { ...c, origin: { x: c.origin.x + sx + dx, y: c.origin.y + sy + dy } }
          : (sx > 0 || sy > 0 ? { ...c, origin: { x: c.origin.x + sx, y: c.origin.y + sy } } : c)
      );

      // 10. Build occupancy Area from newCells for re-routing
      const rerouteArea: Area = {
        kind: 'internal',
        containers: updatedContainers,
        placed: [],
        undergroundCorridors: [],
      };
      for (let i = 0; i < newCells.length; i++) {
        if (newCells[i].entityId !== null) {
          rerouteArea.placed.push({ x: i % workGrid.width, y: Math.floor(i / workGrid.width), cell: newCells[i] });
        }
      }

      // 11. Re-route boundary routings
      // container.origin은 layout 좌표계이므로 라우팅 시 그리드 좌표로 보정한다.
      const coox = routingEditSession.containerOriginOffset?.x ?? 0;
      const cooy = routingEditSession.containerOriginOffset?.y ?? 0;
      const toGridOrigin = (c: Container): Container =>
        coox === 0 && cooy === 0 ? c : { ...c, origin: { x: c.origin.x + coox, y: c.origin.y + cooy } };

      const updatedRoutings = routingEditSession.routings.map(r => ({ ...r }));
      for (const r of boundaryRoutings) {
        const fromC = updatedContainers.find(c => c.id === r.fromContainerId);
        const toC = updatedContainers.find(c => c.id === r.toContainerId);
        if (!fromC || !toC) continue;
        const attempt = routeWithFallback(toGridOrigin(fromC), toGridOrigin(toC), r.portKind, rerouteArea, routingEditSession.routeOptions);
        if (attempt.ok) {
          commitRouting(attempt.routing, rerouteArea);
          for (const { x, y, cell } of attempt.routing.placed) {
            if (x >= 0 && y >= 0 && x < workGrid.width && y < workGrid.height) {
              newCells[cellIndex(workGrid, x, y)] = cell;
            }
          }
          const rIdx = updatedRoutings.findIndex(ur => ur.id === r.id);
          if (rIdx >= 0) updatedRoutings[rIdx] = { ...updatedRoutings[rIdx], id: attempt.routing.id };
        }
      }

      set({
        grid: { ...workGrid, cells: newCells },
        viewport: workViewport,
        externalAreaBbox: shiftBbox(externalAreaBbox, sx, sy),
        autoLayoutCanvasBbox: shiftBbox(autoLayoutCanvasBbox, sx, sy),
        ...(sx > 0 || sy > 0 ? {
          gridOriginX: gridOriginX - sx,
          gridOriginY: gridOriginY - sy,
        } : {}),
        routingEditSession: { ...routingEditSession, containers: updatedContainers, routings: updatedRoutings },
      });
      return true;
    },

    moveEntityById: (entityId, toX, toY) => {
      const { grid, viewport, tileSize, routingEditSession, externalAreaBbox, autoLayoutCanvasBbox, gridOriginX, gridOriginY } = get();

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

      // 음수 좌표: 전체 평행이동으로 공간 확보
      const sx = Math.max(0, -toX);
      const sy = Math.max(0, -toY);
      const workGrid = sx > 0 || sy > 0 ? shiftGridCells(grid, sx, sy) : grid;
      const wOriginX = originX + sx, wOriginY = originY + sy;
      const wToX = toX + sx, wToY = toY + sy;

      // Bounds check
      if (wToX + size.width > workGrid.width || wToY + size.height > workGrid.height) return false;

      // Find connected routings (if routing session is active)
      const connectedRoutings = routingEditSession
        ? routingEditSession.routings.filter(r => r.fromContainerId === entityId || r.toContainerId === entityId)
        : [];
      const connectedRoutingIdSet = new Set(connectedRoutings.map(r => r.id));

      // Collect routing cell indices to clear (from workGrid)
      const routingClearIndices = new Set<number>();
      for (let i = 0; i < workGrid.cells.length; i++) {
        const cell = workGrid.cells[i];
        if (cell.entityId && connectedRoutingIdSet.has(cell.entityId)) {
          routingClearIndices.add(i);
        }
      }

      // Collision check (excluding current entity cells and routing cells that will be cleared)
      const currentKeys = new Set<string>();
      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          currentKeys.add(`${wOriginX + dx},${wOriginY + dy}`);
        }
      }
      const routingClearKeys = new Set<string>();
      for (const i of routingClearIndices) {
        routingClearKeys.add(`${i % workGrid.width},${Math.floor(i / workGrid.width)}`);
      }
      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          const tx = wToX + dx, ty = wToY + dy;
          if (currentKeys.has(`${tx},${ty}`)) continue;
          if (routingClearKeys.has(`${tx},${ty}`)) continue;
          const cell = getCell(workGrid, tx, ty);
          if (cell?.entityId !== null) return false;
        }
      }

      get().pushHistory('moveEntityById');
      const newCells = [...workGrid.cells];

      // Clear connected routing cells
      for (const idx of routingClearIndices) newCells[idx] = createEmptyCell();

      // Clear old entity position
      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          const idx = cellIndex(workGrid, wOriginX + dx, wOriginY + dy);
          if (idx >= 0 && idx < newCells.length) newCells[idx] = createEmptyCell();
        }
      }

      // Place at new position
      for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
          const idx = cellIndex(workGrid, wToX + dx, wToY + dy);
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

      const shiftExtra = sx > 0 || sy > 0 ? {
        viewport: shiftViewport(viewport, sx, sy, tileSize),
        externalAreaBbox: shiftBbox(externalAreaBbox, sx, sy),
        autoLayoutCanvasBbox: shiftBbox(autoLayoutCanvasBbox, sx, sy),
        gridOriginX: gridOriginX - sx,
        gridOriginY: gridOriginY - sy,
      } : {};

      // pushHistory 는 실제로 상태를 바꾸는 경로에서만 호출 (각 set() 직전).
      // Re-route connected routings if session is active
      if (routingEditSession && connectedRoutings.length > 0) {
        const coox = routingEditSession.containerOriginOffset?.x ?? 0;
        const cooy = routingEditSession.containerOriginOffset?.y ?? 0;
        const toGridOrigin = (c: Container): Container =>
          coox === 0 && cooy === 0 ? c : { ...c, origin: { x: c.origin.x + coox, y: c.origin.y + cooy } };

        // A-plan: liveArea 가 있으면 chest/pipe 드래그를 dragExternalContainer 에 위임.
        // dragExternalContainer 는 *레이아웃 좌표* 에서 동작하므로 그리드 음수(좌/상 드롭)
        // 와 무관하다. 결과 셀이 음수 그리드 좌표를 가지면 그만큼 전체 그리드를 시프트한다.
        // (이전엔 sx===0&&sy===0 일 때만 A-plan 을 쓰고 좌/상 드롭은 레거시 B-plan 으로
        //  빠졌으나, 그러면 스냅·pickBest 가 안 걸려 라우팅 품질이 방향마다 달랐다.)
        if (
          routingEditSession.liveArea &&
          (entityType === EntityType.InfinityChest || entityType === EntityType.InfinityPipe)
        ) {
          // 매 드래그마다 liveArea 를 deep-clone 해서 dragExternalContainer 에 전달.
          // dragExternalContainer 는 전달받은 객체를 직접 mutate 하므로,
          // 실패(롤백) 포함 어떤 경우에도 원본 liveArea 가 오염되지 않는다.
          const internal = cloneArea(routingEditSession.liveArea.internal);
          const external = cloneArea(routingEditSession.liveArea.external);
          const areaRoutings = routingEditSession.liveArea.routings.map(cloneRouting);
          const newLayoutOrigin = { x: toX - coox, y: toY - cooy };

          // 영향받는 라우팅 ID 수집 (그리드 지울 셀 파악용)
          const affectedRoutingIds = new Set(
            areaRoutings
              .filter(r => r.from.containerId === entityId || r.to.containerId === entityId)
              .map(r => r.id),
          );

          const dragResult = dragExternalContainer(
            entityId, newLayoutOrigin, internal, external, areaRoutings, routingEditSession.routeOptions,
          );
          if (!dragResult.ok) {
            console.warn('[autoLayout] reroute failed (A-plan, move rejected)', { entityId, reason: dragResult.reason, failedRouting: dragResult.failedRouting });
            useToastStore.getState().show(t('toasts.routingRerouteFailed'), 'warning');
            return false;
          }

          // 새로 깔릴 셀(chest + rerouted 라우팅)의 그리드 좌표 → 음수면 시프트량 산정.
          let minGx = 0, minGy = 0;
          const noteCell = (gx: number, gy: number) => {
            if (gx < minGx) minGx = gx;
            if (gy < minGy) minGy = gy;
          };
          for (const p of external.placed) {
            if (p.cell.entityId === entityId) noteCell(p.x + coox, p.y + cooy);
          }
          for (const routing of dragResult.rerouted) {
            for (const { x, y } of routing.placed) noteCell(x + coox, y + cooy);
          }
          const asx = Math.max(0, -minGx), asy = Math.max(0, -minGy);

          get().pushHistory('moveEntityById');
          const baseGrid = asx > 0 || asy > 0 ? shiftGridCells(grid, asx, asy) : grid;
          const liveCells = [...baseGrid.cells];

          // 기존 chest 셀 + 기존 routing 셀 제거 (id 기준 — 시프트 후에도 id 유지)
          for (let i = 0; i < liveCells.length; i++) {
            const c = liveCells[i];
            if (c.entityId === entityId || (c.entityId && affectedRoutingIds.has(c.entityId))) {
              liveCells[i] = createEmptyCell();
            }
          }

          // 새 chest 셀 배치 (external.placed 기준, layout → grid, 시프트 적용)
          for (const p of external.placed) {
            if (p.cell.entityId !== entityId) continue;
            const idx = cellIndex(baseGrid, p.x + coox + asx, p.y + cooy + asy);
            if (idx >= 0 && idx < liveCells.length) liveCells[idx] = p.cell;
          }

          // 새 routing 셀 배치 (layout → grid, 시프트 적용)
          for (const routing of dragResult.rerouted) {
            for (const { x, y, cell } of routing.placed) {
              const idx = cellIndex(baseGrid, x + coox + asx, y + cooy + asy);
              if (idx >= 0 && idx < liveCells.length) liveCells[idx] = cell;
            }
          }

          // session.containers: clone 된 chest 객체의 새 origin 을 사용
          const clonedChest = external.containers.find(c => c.id === entityId);
          const updatedSessionContainers = routingEditSession.containers.map(c =>
            c.id === entityId ? (clonedChest ? { ...clonedChest } : { ...c }) : c,
          );
          // session.routings: areaRoutings에서 재구성 (라우팅 ID가 변경될 수 있음)
          const updatedSessionRoutings: RoutingSessionRouting[] = areaRoutings.map(r => ({
            id: r.id,
            portKind: r.from.kind,
            fromContainerId: r.from.containerId,
            toContainerId: r.to.containerId,
          }));

          set({
            grid: { ...baseGrid, cells: liveCells },
            routingEditSession: {
              ...routingEditSession,
              containers: updatedSessionContainers,
              routings: updatedSessionRoutings,
              // 시프트만큼 offset 갱신 → 이후 드래그의 layout↔grid 변환이 정확해진다.
              containerOriginOffset: { x: coox + asx, y: cooy + asy },
              liveArea: { internal, external, routings: areaRoutings },
            },
            ...(asx > 0 || asy > 0 ? {
              viewport: shiftViewport(viewport, asx, asy, tileSize),
              externalAreaBbox: shiftBbox(externalAreaBbox, asx, asy),
              autoLayoutCanvasBbox: shiftBbox(autoLayoutCanvasBbox, asx, asy),
              gridOriginX: gridOriginX - asx,
              gridOriginY: gridOriginY - asy,
            } : {}),
          });
          return true;
        }

        // Fallback: liveArea 없거나 그리드 shift 있을 때
        // (Step 1 fix: 좌표계 불일치 수정 — toGridOrigin 보정 추가)
        const updatedContainers = routingEditSession.containers.map(c =>
          c.id === entityId
            ? { ...c, origin: { x: wToX - coox, y: wToY - cooy } }  // layout-space로 저장
            : (sx > 0 || sy > 0 ? { ...c, origin: { x: c.origin.x + sx, y: c.origin.y + sy } } : c)
        );

        const rerouteArea: Area = {
          kind: 'internal',
          containers: updatedContainers,
          placed: [],
          undergroundCorridors: [],
        };
        for (let i = 0; i < newCells.length; i++) {
          if (newCells[i].entityId !== null) {
            rerouteArea.placed.push({ x: i % workGrid.width, y: Math.floor(i / workGrid.width), cell: newCells[i] });
          }
        }

        const updatedRoutings = routingEditSession.routings.map(r => ({ ...r }));
        const failedRoutings: { id: string; reason: string }[] = [];
        for (const r of connectedRoutings) {
          const fromC = updatedContainers.find(c => c.id === r.fromContainerId);
          const toC = updatedContainers.find(c => c.id === r.toContainerId);
          if (!fromC || !toC) {
            failedRoutings.push({ id: r.id, reason: 'container-not-found' });
            continue;
          }
          const attempt = routeWithFallback(toGridOrigin(fromC), toGridOrigin(toC), r.portKind, rerouteArea, routingEditSession.routeOptions);
          if (attempt.ok) {
            commitRouting(attempt.routing, rerouteArea);
            for (const { x, y, cell } of attempt.routing.placed) {
              if (x >= 0 && y >= 0 && x < workGrid.width && y < workGrid.height) {
                newCells[cellIndex(workGrid, x, y)] = cell;
              }
            }
            const rIdx = updatedRoutings.findIndex(ur => ur.id === r.id);
            if (rIdx >= 0) updatedRoutings[rIdx] = { ...updatedRoutings[rIdx], id: attempt.routing.id };
          } else {
            failedRoutings.push({ id: r.id, reason: attempt.reason });
          }
        }

        if (failedRoutings.length > 0) {
          console.warn('[autoLayout] reroute failed (fallback)', { entityId, failed: failedRoutings });
          useToastStore.getState().show(t('toasts.routingRerouteFailed'), 'warning');
        }

        get().pushHistory('moveEntityById');
        set({
          grid: { ...workGrid, cells: newCells },
          routingEditSession: { ...routingEditSession, containers: updatedContainers, routings: updatedRoutings },
          ...shiftExtra,
        });
        return true;
      }

      get().pushHistory('moveEntityById');
      set({ grid: { ...workGrid, cells: newCells }, ...shiftExtra });
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
    storage: compressedGridStorage,
    partialize: (state) => ({
      grid: state.grid,
      viewport: state.viewport,
      gridOriginX: state.gridOriginX,
      gridOriginY: state.gridOriginY,
      externalAreaBbox: state.externalAreaBbox,
      autoLayoutCanvasBbox: state.autoLayoutCanvasBbox,
      routingEditSession: state.routingEditSession,
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
