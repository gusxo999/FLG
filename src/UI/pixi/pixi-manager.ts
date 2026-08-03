/**
 * pixi-manager.ts
 *
 * React lifecycle 완전 독립 PixiJS 모듈.
 * - initPixi(container, coordsEl) 로 초기화
 * - destroyPixi() 로 정리
 * - zustand store를 직접 subscribe해서 렌더 트리거 (useEffect 없음)
 * - 이벤트를 canvas에 직접 등록 (React passive wheel 문제 없음)
 *
 * 공유 상태(pixiObjects, dragState 등)는 pixi-renderer.ts 에 정의된 객체를 mutate.
 * 드로잉 유틸은 pixi-draw-utils.ts 에 위치.
 */

import * as PIXI from 'pixi.js';
import { useLayoutStore, canvasToGrid } from '../store/layoutStore';
import { useSettingsStore } from '../store/settingsStore';
import { useGameDataStore } from '../store/gameDataStore';
import { useInspectStore } from '../store/inspectStore';
import { EntityType, getCell } from '../../types/layout';
import { getEntitySizeRotated } from '../../factorio/entitySize';
import { isOverwriteAllowed, centerAnchorOrigin } from './pixi-draw-utils';
import {
  BG_COLOR,
  pixiObjects,
  inputState,
  placementDrag,
  selectionDrag,
  infinityDrag,
  routingEditDrag,
  unsubFns,
  getCanvasCoords,
  renderGrid,
  renderHoverPreview,
  renderAll,
  clearHoverPreview,
  hitTestRoutingLine,
  hoveredRoutingId,
  setHoveredRoutingId,
  hitTestModuleLabel,
  hoveredModuleKey,
  setHoveredModuleKey,
} from './pixi-renderer';
import { useModuleInspectStore } from '../store/moduleInspectStore';
import { moduleAtCell } from '../../autoLayout/moduleInspect';
import { isBeltLike } from '../../analysis/beltFlow';

// ---------------------------------------------------------------------------
// 이벤트 핸들러
// ---------------------------------------------------------------------------

function handleWheel(e: WheelEvent) {
  e.preventDefault();
  const { pan, zoom } = useLayoutStore.getState();
  const { cx, cy }    = getCanvasCoords(e);

  if (e.ctrlKey) {
    zoom(e.deltaY < 0 ? 0.1 : -0.1, cx, cy);
  } else if (e.altKey) {
    pan(e.deltaY < 0 ? 80 : -80, 0);
  } else {
    pan(0, e.deltaY < 0 ? 80 : -80);
  }
}

function handlePointerDown(e: PointerEvent) {
  pixiObjects.app!.canvas.setPointerCapture(e.pointerId);
  inputState.lastPointer = { x: e.clientX, y: e.clientY };

  if (e.button === 1 || e.button === 2) {
    inputState.isDragging = true;
    return;
  }

  if (e.button === 0) {
    const { cx, cy } = getCanvasCoords(e);
    const store = useLayoutStore.getState();
    const {
      grid, viewport, tileSize,
      placeEntity, selectedEntityType, selectedEntityName, selectedDirection,
      clearMultiSelection, setSelection,
    } = store;
    const { x: gx, y: gy } = canvasToGrid(cx, cy, viewport, tileSize);
    const hitCell = getCell(grid, gx, gy);

    // 모듈 이름표 클릭 → 모듈 정보 패널 (모드 무관·최우선). 라벨은 셀 바깥의
    // 고유 히트 타깃이라 배치/선택/드래그와 충돌하지 않는다.
    const labelKey = hitTestModuleLabel(cx, cy);
    if (labelKey) {
      useModuleInspectStore.getState().open(labelKey);
      return;
    }

    // 라우팅 수정 모드: 조립기계 드래그 (최우선)
    if (store.routingEditMode && store.routingEditSession) {
      const machineIds = new Set(
        store.routingEditSession.containers.filter(c => c.kind === 'machine').map(c => c.id),
      );
      if (hitCell?.entityId && machineIds.has(hitCell.entityId)) {
        routingEditDrag.active      = true;
        routingEditDrag.containerId = hitCell.entityId;
        routingEditDrag.anchorGrid  = { x: gx, y: gy };
        routingEditDrag.currentGrid = { x: gx, y: gy };
        renderGrid(); // 클릭 즉시 원래 위치 엔티티 숨기기
      } else if (
        hitCell?.entityId &&
        (hitCell.entityType === EntityType.InfinityChest || hitCell.entityType === EntityType.InfinityPipe)
      ) {
        // 외부상자 드래그 — 라우팅 편집 모드에서도 허용
        infinityDrag.active     = true;
        infinityDrag.entityId   = hitCell.entityId;
        infinityDrag.entityType = hitCell.entityType;
        infinityDrag.entityName = hitCell.entityName;
        infinityDrag.entityDir  = hitCell.direction;
        infinityDrag.originCell = {
          x: gx - hitCell.tileOffset.x,
          y: gy - hitCell.tileOffset.y,
        };
      } else {
        // 연결선 클릭 여부 확인
        const hitRoutingId = hitTestRoutingLine(cx, cy);
        if (hitRoutingId) {
          store.setSelectedRouting(hitRoutingId);
        } else if (hitCell?.entityName && isBeltLike(hitCell.entityType)) {
          // 벨트류 셀 클릭 → 흐름 정보 포함 엔티티 정보 모달
          useInspectStore.getState().inspect(hitCell.entityName, hitCell.entityId, { x: gx, y: gy });
        }
      }
      return; // 라우팅 수정 모드에서는 좌클릭 기본 동작 차단
    }

    // 엔티티 선택 모드
    if (selectedEntityType !== EntityType.Empty) {
      const isOverwrite =
        hitCell?.entityType !== undefined &&
        isOverwriteAllowed(selectedEntityType, hitCell.entityType);

      // 점유된 셀 클릭 → 정보 모달 (벨트류면 클릭 지점 흐름량 표시용 셀 좌표 포함)
      if (hitCell?.entityName && !isOverwrite) {
        useInspectStore.getState().inspect(hitCell.entityName, hitCell.entityId, { x: gx, y: gy });
        return;
      }
      const size = getEntitySizeRotated(selectedEntityType, selectedEntityName, selectedDirection);
      const { x: ox, y: oy } = centerAnchorOrigin(gx, gy, size);
      const placed = placeEntity(ox, oy);
      if (placed) {
        placementDrag.active        = true;
        placementDrag.lastPlacedCell = { x: gx, y: gy };
      }
      return;
    }

    // 빈손 모드에서 벨트류 셀 클릭 → 그 지점 흐름 정보 모달 (선택 드래그보다 우선)
    if (hitCell?.entityName && isBeltLike(hitCell.entityType)) {
      useInspectStore.getState().inspect(hitCell.entityName, hitCell.entityId, { x: gx, y: gy });
      return;
    }

    // Eraser/no-entity 모드: drag rectangle multi-select 시작
    clearMultiSelection();
    selectionDrag.active    = true;
    selectionDrag.startCell = { x: gx, y: gy };
    setSelection({ active: true, startX: gx, startY: gy, endX: gx, endY: gy });
  }
}

function handlePointerMove(e: PointerEvent) {
  const { cx, cy } = getCanvasCoords(e);
  inputState.lastCanvasPos = { cx, cy };

  // 라우팅 수정 모드 드래그 중
  if (routingEditDrag.active) {
    const { viewport, tileSize } = useLayoutStore.getState();
    const { x: gx, y: gy } = canvasToGrid(cx, cy, viewport, tileSize);
    routingEditDrag.currentGrid = { x: gx, y: gy };
    renderAll(); // renderGrid(원래 위치 숨김) + renderHoverPreview(새 위치 bbox)
    return;
  }

  // 모듈 hover (모드 무관, 팬 중 제외) — 이름표 위든 모듈 본체 위든 같은 모듈 키를
  // active 로 잡아 강조(테두리+포트)를 통일한다. 이름표 위에서만 커서 pointer + 다른
  // hover 억제(클릭=정보 패널). 본체 위에서는 배치 미리보기와 공존하므로 억제 안 함.
  if (!inputState.isDragging) {
    const labelKey = hitTestModuleLabel(cx, cy);
    if (labelKey) {
      if (labelKey !== hoveredModuleKey) {
        setHoveredModuleKey(labelKey);
        if (hoveredRoutingId !== null) setHoveredRoutingId(null);
        pixiObjects.appCanvas!.style.cursor = 'pointer';
        renderGrid();
      }
      return;
    }
    // 이름표는 아니지만 모듈 본체 bbox 안이면 같은 강조 유지. 이름표에서 벗어나면
    // 커서 pointer 도 해제(본체는 기본 커서). 아무 모듈도 아니면 강조 제거.
    const { viewport, tileSize } = useLayoutStore.getState();
    const { x: gx, y: gy } = canvasToGrid(cx, cy, viewport, tileSize);
    const bodyKey = moduleAtCell(gx, gy)?.key ?? null;
    if (bodyKey !== hoveredModuleKey) {
      setHoveredModuleKey(bodyKey);
      pixiObjects.appCanvas!.style.cursor = '';
      renderGrid();
    }
  }

  // 라우팅 수정 모드 (드래그 없음): 연결선 hover 감지
  if (useLayoutStore.getState().routingEditMode) {
    const hitRoutingId = hitTestRoutingLine(cx, cy);
    if (hitRoutingId !== hoveredRoutingId) {
      setHoveredRoutingId(hitRoutingId);
      pixiObjects.appCanvas!.style.cursor = hitRoutingId ? 'pointer' : '';
      renderGrid();
    }
    return;
  }

  // InfinityChest/InfinityPipe 이동 드래그 중
  if (infinityDrag.active) {
    renderHoverPreview(
      cx, cy,
      infinityDrag.entityType,
      infinityDrag.entityName ?? undefined,
      infinityDrag.entityDir,
    );
    return;
  }

  // 라우팅 편집 모드 해제 시 hover 잔상 정리
  if (hoveredRoutingId !== null) {
    setHoveredRoutingId(null);
    pixiObjects.appCanvas!.style.cursor = '';
    renderGrid();
  }

  renderHoverPreview(cx, cy);

  // 뷰포트 팬
  if (inputState.isDragging) {
    const dx = e.clientX - inputState.lastPointer.x;
    const dy = e.clientY - inputState.lastPointer.y;
    inputState.lastPointer = { x: e.clientX, y: e.clientY };
    useLayoutStore.getState().pan(dx, dy);
    return;
  }

  // drag-place
  if (placementDrag.active) {
    const {
      viewport, tileSize, placeEntitySilent,
      selectedEntityType, selectedEntityName, selectedDirection,
    } = useLayoutStore.getState();
    const { x: gx, y: gy } = canvasToGrid(cx, cy, viewport, tileSize);
    if (!placementDrag.lastPlacedCell || gx !== placementDrag.lastPlacedCell.x || gy !== placementDrag.lastPlacedCell.y) {
      const size = getEntitySizeRotated(selectedEntityType, selectedEntityName, selectedDirection);
      const { x: ox, y: oy } = centerAnchorOrigin(gx, gy, size);
      placeEntitySilent(ox, oy);
      placementDrag.lastPlacedCell = { x: gx, y: gy };
    }
    return;
  }

  // drag-select
  if (selectionDrag.active && selectionDrag.startCell) {
    const { viewport, tileSize, setSelection } = useLayoutStore.getState();
    const { x: gx, y: gy } = canvasToGrid(cx, cy, viewport, tileSize);
    setSelection({
      active: true,
      startX: selectionDrag.startCell.x,
      startY: selectionDrag.startCell.y,
      endX: gx,
      endY: gy,
    });
  }
}

function handlePointerUp() {
  inputState.isDragging = false;

  // 라우팅 수정 모드 드래그 완료
  if (routingEditDrag.active) {
    if (routingEditDrag.containerId && routingEditDrag.anchorGrid && routingEditDrag.currentGrid) {
      const dx = routingEditDrag.currentGrid.x - routingEditDrag.anchorGrid.x;
      const dy = routingEditDrag.currentGrid.y - routingEditDrag.anchorGrid.y;
      if (dx !== 0 || dy !== 0) {
        useLayoutStore.getState().moveAssemblerGroup(routingEditDrag.containerId, dx, dy);
      }
    }
    routingEditDrag.active      = false;
    routingEditDrag.containerId = null;
    routingEditDrag.anchorGrid  = null;
    routingEditDrag.currentGrid = null;
    renderAll();
    return;
  }

  // InfinityChest/InfinityPipe 이동 드래그 완료
  if (infinityDrag.active) {
    if (inputState.lastCanvasPos && infinityDrag.entityId && infinityDrag.originCell) {
      const { viewport, tileSize } = useLayoutStore.getState();
      const { x: gx, y: gy } = canvasToGrid(
        inputState.lastCanvasPos.cx, inputState.lastCanvasPos.cy, viewport, tileSize,
      );
      if (gx !== infinityDrag.originCell.x || gy !== infinityDrag.originCell.y) {
        useLayoutStore.getState().moveEntityById(infinityDrag.entityId, gx, gy);
      }
    }
    infinityDrag.active     = false;
    infinityDrag.entityId   = null;
    infinityDrag.entityType = EntityType.Empty;
    infinityDrag.entityName = null;
    infinityDrag.originCell = null;
    renderAll();
    return;
  }

  if (placementDrag.active) {
    placementDrag.active        = false;
    placementDrag.lastPlacedCell = null;
  }

  if (selectionDrag.active && selectionDrag.startCell) {
    const store = useLayoutStore.getState();
    const { startCell } = selectionDrag;
    const isClick =
      store.selection.endX === startCell.x && store.selection.endY === startCell.y;
    const hitCell = isClick ? getCell(store.grid, startCell.x, startCell.y) : null;

    if (hitCell?.entityName) {
      // 미선택 모드에서 엔티티 단일 클릭 → 정보 모달 (벨트 포함)
      useInspectStore.getState().inspect(hitCell.entityName, hitCell.entityId);
      store.clearMultiSelection();
    } else {
      store.selectEntitiesInRect(
        startCell.x, startCell.y,
        store.selection.endX, store.selection.endY,
      );
    }
    store.clearSelection();
    selectionDrag.active    = false;
    selectionDrag.startCell = null;
  }
}

function handlePointerLeave() {
  inputState.isDragging = false;
  if (placementDrag.active) {
    placementDrag.active        = false;
    placementDrag.lastPlacedCell = null;
  }
  if (selectionDrag.active) {
    selectionDrag.active    = false;
    selectionDrag.startCell = null;
    useLayoutStore.getState().clearSelection();
  }
  if (infinityDrag.active) {
    infinityDrag.active     = false;
    infinityDrag.entityId   = null;
    infinityDrag.entityType = EntityType.Empty;
    infinityDrag.entityName = null;
    infinityDrag.originCell = null;
  }
  if (routingEditDrag.active) {
    routingEditDrag.active      = false;
    routingEditDrag.containerId = null;
    routingEditDrag.anchorGrid  = null;
    routingEditDrag.currentGrid = null;
  }
  clearHoverPreview();
}

function handleContextMenu(e: Event) {
  e.preventDefault();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function initPixi(
  container: HTMLElement,
  coords: HTMLElement | null,
) {
  if (pixiObjects.app || pixiObjects.initPending) return;
  pixiObjects.initPending = true;
  pixiObjects.coordsEl    = coords;

  const newApp = new PIXI.Application();
  pixiObjects.app = newApp;

  await newApp.init({
    background: BG_COLOR,
    resizeTo:   container,
    antialias:  false,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  // await 중 destroyPixi()가 호출된 경우 중단
  if (!pixiObjects.initPending || pixiObjects.app !== newApp) {
    try { newApp.destroy(true, { children: true }); } catch { /* ignore */ }
    return;
  }
  pixiObjects.initPending = false;

  pixiObjects.appCanvas = newApp.canvas as HTMLCanvasElement;
  container.appendChild(pixiObjects.appCanvas);

  pixiObjects.gridContainer = new PIXI.Container();
  newApp.stage.addChild(pixiObjects.gridContainer);

  pixiObjects.hoverGfx = new PIXI.Graphics();
  newApp.stage.addChild(pixiObjects.hoverGfx);

  // 이벤트를 canvas에 직접 등록 — React passive 문제 없음
  const canvas = pixiObjects.appCanvas;
  canvas.addEventListener('wheel',        handleWheel,        { passive: false });
  canvas.addEventListener('pointerdown',  handlePointerDown);
  canvas.addEventListener('pointermove',  handlePointerMove);
  canvas.addEventListener('pointerup',    handlePointerUp);
  canvas.addEventListener('pointerleave', handlePointerLeave);
  canvas.addEventListener('contextmenu',  handleContextMenu);

  // zustand store 직접 구독 — React useEffect/useCallback 없음
  unsubFns.push(useLayoutStore.subscribe(() => renderAll()));
  unsubFns.push(useSettingsStore.subscribe(() => renderAll()));
  // gameData 가 늦게 로드돼도 파이프 네트워크 색/터널이 정확히 그려지도록 재렌더 트리거
  unsubFns.push(useGameDataStore.subscribe(() => renderAll()));

  // 브라우저 줌(DPR 변경) 감지 — PixiJS resolution 동기화
  const watchDpr = () => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onDprChange = () => {
      mq.removeEventListener('change', onDprChange);
      if (!pixiObjects.app) return;
      pixiObjects.app.renderer.resolution = window.devicePixelRatio || 1;
      pixiObjects.app.renderer.resize(container.clientWidth, container.clientHeight);
      renderAll();
      watchDpr();
    };
    mq.addEventListener('change', onDprChange);
    unsubFns.push(() => mq.removeEventListener('change', onDprChange));
  };
  watchDpr();

  renderGrid();
}

export function destroyPixi() {
  pixiObjects.initPending = false; // await 중이라면 initPixi가 중단 조건을 확인하도록

  unsubFns.forEach(fn => fn());
  unsubFns.length = 0;

  if (pixiObjects.appCanvas) {
    const canvas = pixiObjects.appCanvas;
    canvas.removeEventListener('wheel',        handleWheel);
    canvas.removeEventListener('pointerdown',  handlePointerDown);
    canvas.removeEventListener('pointermove',  handlePointerMove);
    canvas.removeEventListener('pointerup',    handlePointerUp);
    canvas.removeEventListener('pointerleave', handlePointerLeave);
    canvas.removeEventListener('contextmenu',  handleContextMenu);
    pixiObjects.appCanvas = null;
  }

  if (pixiObjects.app) {
    try { pixiObjects.app.destroy(true, { children: true }); } catch { /* init 미완료 시 무시 */ }
    pixiObjects.app = null;
  }

  pixiObjects.gridContainer = null;
  pixiObjects.hoverGfx      = null;
  pixiObjects.coordsEl      = null;
  inputState.lastCanvasPos  = null;
  inputState.isDragging     = false;

  infinityDrag.active     = false;
  infinityDrag.entityId   = null;
  infinityDrag.entityType = EntityType.Empty;
  infinityDrag.entityName = null;
  infinityDrag.originCell = null;

  routingEditDrag.active      = false;
  routingEditDrag.containerId = null;
  routingEditDrag.anchorGrid  = null;
  routingEditDrag.currentGrid = null;
}
