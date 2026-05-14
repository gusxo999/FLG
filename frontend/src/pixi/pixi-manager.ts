/**
 * pixi-manager.ts
 *
 * React lifecycle 완전 독립 PixiJS 모듈.
 * - initPixi(container, coordsEl) 로 초기화
 * - destroyPixi() 로 정리
 * - zustand store를 직접 subscribe해서 렌더 트리거 (useEffect 없음)
 * - 이벤트를 canvas에 직접 등록 (React passive wheel 문제 없음)
 */

import * as PIXI from 'pixi.js';
import { useLayoutStore, canvasToGrid } from '../store/layoutStore';
import { useSettingsStore } from '../store/settingsStore';
import { useGameDataStore } from '../store/gameDataStore';
import { useInspectStore } from '../store/inspectStore';
import { EntityType, getCell, type Direction } from '../types/layout';
import { getEntitySizeRotated } from '../utils/entitySize';
import { getDynamicEntityColor, collectPlacedEntityNames } from '../utils/entityColors';
import {
  computePipeNetworks,
  computeHoverPipeConnections,
  isPipeCell,
  type PipeNetworkResult,
} from '../utils/pipeNetwork';

// ---------------------------------------------------------------------------
// Colour palette (그리드 보조 요소 전용 — 엔티티 본체는 entityColors 유틸 사용)
// ---------------------------------------------------------------------------
const GRID_LINE_COLOR  = 0x3a3a5f;
const CHUNK_LINE_COLOR = 0x7a3a3a;
const BG_COLOR         = 0x1a1a2e;
const EMPTY_CELL_COLOR = 0x12121f;

// ---------------------------------------------------------------------------
// 모듈 레벨 상태 (React state 없음)
// ---------------------------------------------------------------------------
let app:           PIXI.Application | null = null;
let gridContainer: PIXI.Container   | null = null;
let hoverGfx:      PIXI.Graphics    | null = null;
let coordsEl:      HTMLElement      | null = null;
let appCanvas:     HTMLCanvasElement | null = null; // app.init() 완료 후에만 설정
let initPending = false;                            // await 중 destroyPixi 호출 감지

let isDragging    = false;
let lastPointer   = { x: 0, y: 0 };
let lastCanvasPos: { cx: number; cy: number } | null = null;
// drag-to-place 상태
let isPlacementDragging = false;
let lastPlacedCell: { x: number; y: number } | null = null;
// drag-to-select 상태 (eraser 모드일 때만)
let isSelectionDragging = false;
let selectionStartCell: { x: number; y: number } | null = null;

const unsubFns: Array<() => void> = [];

// ---------------------------------------------------------------------------
// 캔버스 내 좌표 계산
// ---------------------------------------------------------------------------
function getCanvasCoords(e: PointerEvent | WheelEvent): { cx: number; cy: number } {
  const rect = appCanvas!.getBoundingClientRect();
  return { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
}

// ---------------------------------------------------------------------------
// 그리드 렌더
// ---------------------------------------------------------------------------
function renderGrid() {
  if (!app || !gridContainer) return;

  gridContainer.removeChildren();

  const { grid, viewport, tileSize, selectedEntityIds, selection } = useLayoutStore.getState();
  const { gridOverlay, showChunkBoundaries } = useSettingsStore.getState();

  const scaledTile = tileSize * viewport.zoom;
  const { offsetX, offsetY } = viewport;
  const { width, height, cells } = grid;

  const startX = Math.max(0, Math.floor(-offsetX / scaledTile));
  const startY = Math.max(0, Math.floor(-offsetY / scaledTile));
  const endX   = Math.min(width,  Math.ceil((app.screen.width  - offsetX) / scaledTile));
  const endY   = Math.min(height, Math.ceil((app.screen.height - offsetY) / scaledTile));

  const gfx = new PIXI.Graphics();
  gridContainer.addChild(gfx);

  // 그리드에 배치된 unique entityName 수집 → 동적 색 분배 인덱스
  const placedNames = collectPlacedEntityNames(cells);

  // 파이프 네트워크 계산 (Pipe / PipeUnderground 만 대상)
  const { entityMap } = useGameDataStore.getState();
  const pipeNetworks: PipeNetworkResult = computePipeNetworks(grid, entityMap);

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const px   = x * scaledTile + offsetX;
      const py   = y * scaledTile + offsetY;
      const cell = cells[y * width + x];

      if (!cell || cell.entityType === EntityType.Empty || !cell.isOrigin) {
        if (!cell || cell.entityType === EntityType.Empty) {
          gfx.rect(px, py, scaledTile, scaledTile).fill({ color: EMPTY_CELL_COLOR });
        }
      } else {
        const isPipe = !!cell.entityId && isPipeCell(cell.entityType);

        // 파이프 셀이면 네트워크 색 사용, 아니면 기존 동적 색
        let color: number;
        if (isPipe && cell.entityId && pipeNetworks.networkOf.has(cell.entityId)) {
          const nid = pipeNetworks.networkOf.get(cell.entityId)!;
          color = pipeNetworks.colorOf.get(nid) ?? getDynamicEntityColor(cell.entityName, placedNames);
        } else {
          color = getDynamicEntityColor(cell.entityName, placedNames);
        }

        const isSelected = cell.entityId !== null && selectedEntityIds.has(cell.entityId);

        if (isPipe) {
          // 파이프는 셀 풀박스 대신 코어 + 인접 연결 방향 팔의 직사각형 형태로 표현
          drawPipeShape(
            gfx,
            x, y, cell.entityType, cell.direction,
            color, scaledTile, offsetX, offsetY,
            pipeNetworks.cellConnections,
          );
          if (isSelected) {
            gfx.rect(px + 1, py + 1, scaledTile - 2, scaledTile - 2)
              .stroke({ width: 2.5, color: 0xffee44, alpha: 1 });
          }
        } else {
          const size  = getEntitySizeRotated(cell.entityType, cell.entityName, cell.direction);
          const fw    = size.width  * scaledTile - 2;
          const fh    = size.height * scaledTile - 2;

          gfx.rect(px + 1, py + 1, fw, fh).fill({ color });

          if (isSelected) {
            // 다중 선택 강조: 노란 두꺼운 외곽선
            gfx.rect(px + 1, py + 1, fw, fh).stroke({ width: 2.5, color: 0xffee44, alpha: 1 });
          } else {
            gfx.rect(px + 1, py + 1, fw, fh).stroke({ width: 1.5, color: 0xffffff, alpha: 0.25 });
          }

          // 배치된 엔티티의 연결점/I/O 시각화 — 줌 0.5 이상에서만 (노이즈 방지)
          if (cell.entityName && scaledTile >= 16) {
            drawInteractionPoints(
              gfx,
              x, y, cell.entityType, cell.entityName, cell.direction,
              scaledTile, offsetX, offsetY,
              0.55,
            );
          }
        }
      }
    }
  }

  // 지하 터널 짝 시각화 — 양쪽 divider 직사각형의 안쪽 면에서 출발하는 실선.
  // 라인 양 끝을 divider 두께(scaledTile * 0.18 / 2 = 0.09) 만큼 안으로 줄여
  // divider 에서 자연스럽게 출발하는 것처럼 보이게 한다.
  if (pipeNetworks.undergroundLinks.length) {
    const undergroundWidth = Math.max(1.5, scaledTile * 0.12);
    const dividerHalfThin = Math.max(1.5, scaledTile * 0.09);

    for (const link of pipeNetworks.undergroundLinks) {
      const nid = pipeNetworks.networkOf.get(link.fromId);
      if (nid === undefined) continue;
      const color = pipeNetworks.colorOf.get(nid)!;
      const x1 = link.x1 * scaledTile + offsetX;
      const y1 = link.y1 * scaledTile + offsetY;
      const x2 = link.x2 * scaledTile + offsetX;
      const y2 = link.y2 * scaledTile + offsetY;
      const dxn = x2 - x1;
      const dyn = y2 - y1;
      const len = Math.sqrt(dxn * dxn + dyn * dyn);
      if (len < 0.001) continue;
      const ux = dxn / len;
      const uy = dyn / len;
      const sx = x1 + ux * dividerHalfThin;
      const sy = y1 + uy * dividerHalfThin;
      const ex = x2 - ux * dividerHalfThin;
      const ey = y2 - uy * dividerHalfThin;
      gfx
        .moveTo(sx, sy)
        .lineTo(ex, ey)
        .stroke({ width: undergroundWidth, color, alpha: 0.85 });
    }
  }

  if (gridOverlay !== 'none' && scaledTile >= 6) {
    for (let x = startX; x <= endX; x++) {
      const px      = x * scaledTile + offsetX;
      const isChunk = showChunkBoundaries && x % 32 === 0;
      gfx
        .moveTo(px, startY * scaledTile + offsetY)
        .lineTo(px, endY   * scaledTile + offsetY)
        .stroke({ width: isChunk ? 2 : 1, color: isChunk ? CHUNK_LINE_COLOR : GRID_LINE_COLOR });
    }
    for (let y = startY; y <= endY; y++) {
      const py      = y * scaledTile + offsetY;
      const isChunk = showChunkBoundaries && y % 32 === 0;
      gfx
        .moveTo(startX * scaledTile + offsetX, py)
        .lineTo(endX   * scaledTile + offsetX, py)
        .stroke({ width: isChunk ? 2 : 1, color: isChunk ? CHUNK_LINE_COLOR : GRID_LINE_COLOR });
    }
  }

  // 드래그 선택 사각형
  if (selection.active) {
    const sx = Math.min(selection.startX, selection.endX);
    const sy = Math.min(selection.startY, selection.endY);
    const ex = Math.max(selection.startX, selection.endX) + 1;
    const ey = Math.max(selection.startY, selection.endY) + 1;
    const rx = sx * scaledTile + offsetX;
    const ry = sy * scaledTile + offsetY;
    const rw = (ex - sx) * scaledTile;
    const rh = (ey - sy) * scaledTile;
    gfx.rect(rx, ry, rw, rh).fill({ color: 0xffee44, alpha: 0.15 }).stroke({ width: 1.5, color: 0xffee44, alpha: 0.9 });
  }
}

// ---------------------------------------------------------------------------
// 호버 프리뷰 렌더 (배치 가능 여부 색으로 표시)
// ---------------------------------------------------------------------------
function renderHoverPreview(cx: number, cy: number) {
  if (!hoverGfx) return;
  hoverGfx.clear();

  const { grid, viewport, tileSize, selectedEntityType, selectedEntityName, selectedDirection } = useLayoutStore.getState();
  const { x: hx, y: hy } = canvasToGrid(cx, cy, viewport, tileSize);

  const scaledTile = tileSize * viewport.zoom;

  if (coordsEl) {
    coordsEl.textContent = `${hx}, ${hy}`;
    (coordsEl as HTMLElement).style.display = '';
  }

  if (selectedEntityType === EntityType.Empty) {
    const px = hx * scaledTile + viewport.offsetX;
    const py = hy * scaledTile + viewport.offsetY;
    hoverGfx
      .rect(px + 1, py + 1, scaledTile - 2, scaledTile - 2)
      .fill({ color: 0xff4444, alpha: 0.2 })
      .stroke({ width: 2, color: 0xff4444, alpha: 0.9 });
    return;
  }

  const size = getEntitySizeRotated(selectedEntityType, selectedEntityName, selectedDirection);
  const { x, y } = centerAnchorOrigin(hx, hy, size);
  const px = x * scaledTile + viewport.offsetX;
  const py = y * scaledTile + viewport.offsetY;
  const fw = size.width  * scaledTile - 2;
  const fh = size.height * scaledTile - 2;

  const outOfBounds =
    x < 0 || y < 0 ||
    x + size.width  > grid.width ||
    y + size.height > grid.height;

  let occupied = false;
  if (!outOfBounds) {
    outer:
    for (let dy = 0; dy < size.height; dy++) {
      for (let dx = 0; dx < size.width; dx++) {
        const cell = getCell(grid, x + dx, y + dy);
        if (cell?.entityId !== null) { occupied = true; break outer; }
      }
    }
  }

  // 동일 카테고리(Belt, Pipe) 위는 덮어쓰기 가능 → "막힘"으로 표시하지 않음
  const overwritable = !outOfBounds && occupied && (() => {
    for (let dy = 0; dy < size.height; dy++) {
      for (let dx = 0; dx < size.width; dx++) {
        const cell = getCell(grid, x + dx, y + dy);
        if (!cell?.entityId) return false;
        if (!isOverwriteAllowed(selectedEntityType, cell.entityType)) return false;
      }
    }
    return true;
  })();

  const placeable = !outOfBounds && (!occupied || overwritable);
  const color = placeable ? 0x00ff66 : 0xff3333;

  const isPipePreview =
    placeable && (selectedEntityType === EntityType.Pipe || selectedEntityType === EntityType.PipeUnderground);

  if (isPipePreview) {
    // 파이프 호버는 배치 후와 동일한 직사각형 형태로 미리보기.
    // 가상 파이프가 추가됐다고 가정하고 cellConnections 를 즉석 계산.
    const hoverConn = computeHoverPipeConnections(
      grid, useGameDataStore.getState().entityMap,
      x, y, selectedEntityType, selectedDirection, selectedEntityName,
    );
    drawPipeShape(
      hoverGfx,
      x, y, selectedEntityType, selectedDirection,
      color, scaledTile, viewport.offsetX, viewport.offsetY,
      hoverConn,
    );
    // 셀 외곽선으로 호버 영역도 알려준다 (반투명)
    hoverGfx.rect(px + 1, py + 1, fw, fh).stroke({ width: 2, color, alpha: 0.6 });
  } else {
    hoverGfx
      .rect(px + 1, py + 1, fw, fh)
      .fill({ color, alpha: 0.15 })
      .stroke({ width: 2, color, alpha: 0.9 });

    // 연결점/I/O 지점 시각화
    if (selectedEntityName && hoverGfx) {
      drawInteractionPoints(
        hoverGfx,
        x, y, selectedEntityType, selectedEntityName, selectedDirection,
        scaledTile, viewport.offsetX, viewport.offsetY,
        0.9,
      );
    }
  }
}

/**
 * 마우스가 가리키는 타일(hx, hy)이 size×size 엔티티의 중심에 오도록
 * 좌상단 origin 좌표를 계산. 짝수 폭일 땐 hx가 좌측 중앙에 위치.
 */
function centerAnchorOrigin(hx: number, hy: number, size: { width: number; height: number }) {
  return {
    x: hx - Math.floor((size.width  - 1) / 2),
    y: hy - Math.floor((size.height - 1) / 2),
  };
}

// ---------------------------------------------------------------------------
// 연결점 / I/O 지점 시각화
// ---------------------------------------------------------------------------
const COLOR_PICKUP     = 0x40aaff; // 인서터 집기
const COLOR_DROP       = 0xffaa20; // 인서터 놓기
const COLOR_FLUID_IN   = 0x40c8ff; // 유체 입력
const COLOR_FLUID_OUT  = 0xff8030; // 유체 출력
const COLOR_FLUID_IO   = 0xcc80ff; // 유체 양방향
const COLOR_MINING     = 0xffcc20; // 채굴 드롭
const COLOR_BELT_FLOW  = 0xf5f5ff; // 벨트 진행 방향 (밝은 white)

/** layoutStore.canOverwrite 와 동일 규칙. 모달 띄울지 판정용. */
function isOverwriteAllowed(selected: EntityType, existing: EntityType): boolean {
  if (selected === EntityType.Belt && existing === EntityType.Belt) return true;
  const isPipeFamily = (t: EntityType) =>
    t === EntityType.Pipe || t === EntityType.PipeUnderground || t === EntityType.InfinityPipe;
  if (isPipeFamily(selected) && isPipeFamily(existing)) return true;
  return false;
}

const BELT_TYPES = new Set([
  'transport-belt',
  'underground-belt',
  'splitter',
  'loader',
  'loader-1x1',
]);

function drawInteractionPoints(
  target: PIXI.Graphics,
  gridX: number,
  gridY: number,
  entityType: EntityType,
  entityName: string,
  direction: Direction,
  scaledTile: number,
  offsetX: number,
  offsetY: number,
  alpha = 0.9,
) {
  const rotSize = getEntitySizeRotated(entityType, entityName, direction);
  const centerTileX = gridX + rotSize.width  / 2;
  const centerTileY = gridY + rotSize.height / 2;

  const tileToPx = (tx: number, ty: number) => ({
    px: tx * scaledTile + offsetX,
    py: ty * scaledTile + offsetY,
  });

  // direction index for positions[]: 0=N, 1=E, 2=S, 3=W
  const dirIdx = direction / 4;

  const entity = useGameDataStore.getState().entityMap.get(entityName);

  const centerPx = centerTileX * scaledTile + offsetX;
  const centerPy = centerTileY * scaledTile + offsetY;

  // === 벨트 진행 방향 화살표 (transport-belt, underground-belt, splitter, loader) ===
  if (entity && BELT_TYPES.has(entity.type)) {
    const v = directionToVec(direction);
    // 벨트 길이 ≈ 타일 0.7 (앞쪽으로 치우치게)
    const halfLen = scaledTile * 0.35;
    const fromX = centerPx - v.x * halfLen;
    const fromY = centerPy - v.y * halfLen;
    const toX   = centerPx + v.x * halfLen;
    const toY   = centerPy + v.y * halfLen;
    drawSingleArrow(target, fromX, fromY, toX, toY, scaledTile, COLOR_BELT_FLOW, alpha, 0.12);
  }

  // === 인서터 pickup / drop (화살표) ===
  // Factorio 규약: 인서터의 `direction` = *픽업 방향* (= 인서터가 손을 뻗는
  // 쪽). prototype 의 `inserter_pickup_position={0,-1}` 을 direction 으로 그대로
  // 회전한 위치가 실제 픽업 셀이며, 드롭은 그 반대편 (`inserter_drop_position
  // ={0,1.2}` 회전).
  //
  // 예: direction=0 (N) → 픽업 북쪽, 드롭 남쪽.
  //     direction=4 (E) → 픽업 동쪽, 드롭 서쪽.
  if (isValidVec(entity?.inserter_pickup_position)) {
    const rot = rotateVector(entity!.inserter_pickup_position!, direction);
    const { px, py } = tileToPx(centerTileX + rot.x, centerTileY + rot.y);
    drawSingleArrow(target, centerPx, centerPy, px, py, scaledTile, COLOR_PICKUP, alpha);
  }
  if (isValidVec(entity?.inserter_drop_position)) {
    const rot = rotateVector(entity!.inserter_drop_position!, direction);
    const { px, py } = tileToPx(centerTileX + rot.x, centerTileY + rot.y);
    drawSingleArrow(target, centerPx, centerPy, px, py, scaledTile, COLOR_DROP, alpha);
  }

  // === MiningDrill 드롭 위치 ===
  if (isValidVec(entity?.vector_to_place_result)) {
    const rot = rotateVector(entity!.vector_to_place_result!, direction);
    if (rot.x !== 0 || rot.y !== 0) {
      const { px, py } = tileToPx(centerTileX + rot.x, centerTileY + rot.y);
      drawPoint(target, px, py, scaledTile, COLOR_MINING, alpha);
    }
  }

  // === FluidBox 연결점 (화살표) ===
  // flow_direction(연결 단위)을 우선 사용, 없으면 production_type(fluidbox 단위) fallback.
  // 둘의 의미:
  //   flow_direction    — 이 연결점에서 실제 파이프 흐름 (기술적)
  //   production_type   — 레시피 슬롯 용도 (게임플레이)
  // 시각적 "양방향"은 flow_direction 쪽이 정확함.
  // 단, 일반 파이프(type==='pipe' / 'heat-pipe')는 네 면 모두 양방향이라 화살표 4개가
  // 노이즈가 되므로 네트워크 실선 시각화로 갈음하고 여기서는 그리지 않는다.
  // pipe-to-ground 는 underground 연결 화살표가 의미 있으므로 유지.
  const isPlainPipe =
    entity?.type === 'pipe' ||
    entity?.type === 'heat-pipe' ||
    entity?.type === 'infinity-pipe' ||
    entity?.type === 'pipe-to-ground';
  if (entity?.fluid_boxes && !isPlainPipe) {
    for (const fb of entity.fluid_boxes) {
      for (const conn of fb.connections) {
        const flow = conn.flow_direction ?? fb.production_type;
        const mode: 'input' | 'output' | 'both' =
          flow === 'input' ? 'input' :
          flow === 'output' ? 'output' :
          'both';
        const color =
          mode === 'input' ? COLOR_FLUID_IN :
          mode === 'output' ? COLOR_FLUID_OUT :
          COLOR_FLUID_IO;

        const pos = conn.positions[dirIdx] ?? conn.positions[0];
        if (!isValidVec(pos)) continue;
        const { px, py } = tileToPx(centerTileX + pos.x, centerTileY + pos.y);
        drawConnectionArrow(target, px, py, centerPx, centerPy, scaledTile, color, alpha, mode);
      }
    }
  }
}

/**
 * 파이프(Pipe / PipeUnderground) 한 셀을 직사각형 형태로 그린다.
 * - 셀 중심에 정사각형 코어
 * - 인접 방향에 surface 연결이 있으면 그 방향으로 셀 가장자리까지 직사각형 팔을 뻗음
 * - PipeUnderground 는 direction 방향 가장자리에 어두운 입구 표식 추가
 */
function drawPipeShape(
  target: PIXI.Graphics,
  gridX: number,
  gridY: number,
  entityType: EntityType,
  direction: Direction,
  color: number,
  scaledTile: number,
  offsetX: number,
  offsetY: number,
  cellConnections: Map<string, Set<Direction>>,
) {
  const px = gridX * scaledTile + offsetX;
  const py = gridY * scaledTile + offsetY;
  const cx = px + scaledTile / 2;
  const cy = py + scaledTile / 2;
  const armW = Math.max(4, scaledTile * 0.5);
  const half = armW / 2;
  const halfTile = scaledTile / 2;

  if (entityType === EntityType.PipeUnderground) {
    // ── PipeUnderground 디자인 ──
    // 1) 셀 정중앙에 "divider 직사각형"을 둔다.
    //    direction 축에 수직이며(즉 지상↔지하를 가르는 면), 일반 파이프 팔의 두께와
    //    같은 짧은 변 + 셀 폭의 ~90%인 긴 변.
    // 2) divider 의 지상 쪽(=direction)에 일반 파이프와 동일한 팔을 그려
    //    인접 일반 파이프와 자연스럽게 이어 보이게 한다.
    // 3) divider 반대편(=짝 방향)에서 짝까지의 실선은 undergroundLinks 루프가 그리며,
    //    링크 좌표가 셀 중심이라도 divider 가 그 위를 덮어 출발선이 divider 에서 시작하는 것처럼 보인다.
    const isHoriz = direction === 4 || direction === 12;
    const dividerLong = Math.max(6, scaledTile * 0.9);  // 가르는 막대의 긴 변
    const dividerThin = Math.max(3, scaledTile * 0.18); // 짧은 변(두께)

    // 지상 쪽 팔 — 일반 파이프와 동일 두께/색이라 연속처럼 보인다
    switch (direction) {
      case 0:  target.rect(cx - half, py, armW, halfTile).fill({ color }); break;            // N
      case 8:  target.rect(cx - half, cy, armW, halfTile).fill({ color }); break;            // S
      case 12: target.rect(px, cy - half, halfTile, armW).fill({ color }); break;            // W
      case 4:  target.rect(cx, cy - half, halfTile, armW).fill({ color }); break;            // E
    }

    // divider 직사각형 — 셀 정중앙. direction 축에 수직.
    let dx0: number, dy0: number, dw: number, dh: number;
    if (isHoriz) {
      // direction E/W → divider 는 세로 막대
      dw = dividerThin; dh = dividerLong;
      dx0 = cx - dw / 2; dy0 = cy - dh / 2;
    } else {
      // direction N/S → divider 는 가로 막대
      dw = dividerLong; dh = dividerThin;
      dx0 = cx - dw / 2; dy0 = cy - dh / 2;
    }
    target.rect(dx0, dy0, dw, dh).fill({ color });
    target.rect(dx0, dy0, dw, dh).stroke({ width: 1.5, color: 0x000000, alpha: 0.55 });
  } else {
    // ── 일반 Pipe ──
    // 코어 + 연결 팔
    target.rect(cx - half, cy - half, armW, armW).fill({ color });
    const conns = cellConnections.get(`${gridX},${gridY}`);
    if (conns) {
      if (conns.has(0))  target.rect(cx - half, py, armW, halfTile).fill({ color });          // N
      if (conns.has(8))  target.rect(cx - half, cy, armW, halfTile).fill({ color });          // S
      if (conns.has(12)) target.rect(px, cy - half, halfTile, armW).fill({ color });          // W
      if (conns.has(4))  target.rect(cx, cy - half, halfTile, armW).fill({ color });          // E
    }
  }
}

/**
 * 유체 연결점에 방향성 화살표를 그린다.
 * - input: 엔티티 중심을 가리킴 (arrowhead가 중심 쪽)
 * - output: 엔티티 바깥을 가리킴 (arrowhead가 바깥 쪽)
 * - both: 양방향
 */
function drawConnectionArrow(
  target: PIXI.Graphics,
  px: number, py: number,
  cx: number, cy: number,
  scaledTile: number,
  color: number,
  alpha: number,
  mode: 'input' | 'output' | 'both',
) {
  const dx = px - cx;
  const dy = py - cy;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return;
  const ux = dx / len;
  const uy = dy / len;

  const arrowLen = Math.max(10, scaledTile * 0.55);
  const half = arrowLen / 2;

  const innerX = px - ux * half;
  const innerY = py - uy * half;
  const outerX = px + ux * half;
  const outerY = py + uy * half;

  // 몸체
  target
    .moveTo(innerX, innerY)
    .lineTo(outerX, outerY)
    .stroke({ width: Math.max(1.5, scaledTile * 0.06), color, alpha });

  const headSize = Math.max(4, scaledTile * 0.22);

  if (mode === 'output' || mode === 'both') {
    drawArrowhead(target, outerX, outerY, ux, uy, headSize, color, alpha);
  }
  if (mode === 'input' || mode === 'both') {
    drawArrowhead(target, innerX, innerY, -ux, -uy, headSize, color, alpha);
  }
}

function drawArrowhead(
  target: PIXI.Graphics,
  tipX: number, tipY: number,
  dirX: number, dirY: number,
  size: number,
  color: number,
  alpha: number,
) {
  // 수직 벡터 (90° 회전)
  const perpX = -dirY;
  const perpY = dirX;
  const baseX = tipX - dirX * size;
  const baseY = tipY - dirY * size;
  const halfWidth = size * 0.6;

  target
    .poly([
      tipX, tipY,
      baseX + perpX * halfWidth, baseY + perpY * halfWidth,
      baseX - perpX * halfWidth, baseY - perpY * halfWidth,
    ])
    .fill({ color, alpha })
    .stroke({ width: 1, color: 0x000000, alpha: alpha * 0.5 });
}

function isValidVec(v: { x: number; y: number } | null | undefined): v is { x: number; y: number } {
  return !!v && typeof v.x === 'number' && typeof v.y === 'number';
}

/**
 * 엔티티 중심 기준 벡터를 direction으로 회전.
 * Factorio 2.0 direction: 0=N(회전 없음), 4=E(90°cw), 8=S(180°), 12=W(270°cw)
 */
function rotateVector(v: { x: number; y: number }, direction: Direction): { x: number; y: number } {
  switch (direction) {
    case 4:  return { x: -v.y, y:  v.x }; // E (90° cw)
    case 8:  return { x: -v.x, y: -v.y }; // S (180°)
    case 12: return { x:  v.y, y: -v.x }; // W (270° cw)
    default: return { x: v.x, y: v.y };   // N
  }
}

/**
 * 한 방향 화살표. (fromX, fromY)에서 (toX, toY)로 화살촉이 끝점에 위치.
 * 인서터 pickup/drop, 벨트 진행 방향 등에 사용.
 */
function drawSingleArrow(
  target: PIXI.Graphics,
  fromX: number, fromY: number,
  toX: number, toY: number,
  scaledTile: number,
  color: number,
  alpha: number,
  thickness = 0.08,
) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return;
  const ux = dx / len;
  const uy = dy / len;

  const headSize = Math.max(5, scaledTile * 0.26);
  // 몸체는 화살촉 base까지만 (화살촉과 겹치지 않도록)
  const bodyEndX = toX - ux * headSize * 0.7;
  const bodyEndY = toY - uy * headSize * 0.7;

  target
    .moveTo(fromX, fromY)
    .lineTo(bodyEndX, bodyEndY)
    .stroke({ width: Math.max(1.5, scaledTile * thickness), color, alpha });

  drawArrowhead(target, toX, toY, ux, uy, headSize, color, alpha);
}

/** Direction → 단위 벡터 (entity가 향하는 방향). Factorio 2.0 0/4/8/12. */
function directionToVec(direction: Direction): { x: number; y: number } {
  switch (direction) {
    case 0:  return { x: 0,  y: -1 }; // N (위쪽)
    case 4:  return { x: 1,  y: 0  }; // E
    case 8:  return { x: 0,  y: 1  }; // S
    case 12: return { x: -1, y: 0  }; // W
  }
}

function drawPoint(
  target: PIXI.Graphics,
  px: number,
  py: number,
  scaledTile: number,
  color: number,
  alpha: number,
) {
  const radius = Math.max(3, scaledTile * 0.18);
  target
    .circle(px, py, radius)
    .fill({ color, alpha })
    .stroke({ width: 1.5, color: 0x000000, alpha: alpha * 0.67 });
}

function clearHoverPreview() {
  hoverGfx?.clear();
  if (coordsEl) (coordsEl as HTMLElement).style.display = 'none';
  lastCanvasPos = null;
}

// 그리드 + 호버 동시 갱신 (viewport/grid 변경 시)
function renderAll() {
  renderGrid();
  if (lastCanvasPos) renderHoverPreview(lastCanvasPos.cx, lastCanvasPos.cy);
}

// ---------------------------------------------------------------------------
// 이벤트 핸들러
// ---------------------------------------------------------------------------
function handleWheel(e: WheelEvent) {
  e.preventDefault();
  const { pan, zoom } = useLayoutStore.getState();
  const { cx, cy } = getCanvasCoords(e);

  if (e.ctrlKey) {
    zoom(e.deltaY < 0 ? 0.1 : -0.1, cx, cy);
  } else if (e.altKey) {
    pan(e.deltaY < 0 ? 80 : -80, 0);
  } else {
    pan(0, e.deltaY < 0 ? 80 : -80);
  }
}

function handlePointerDown(e: PointerEvent) {
  app!.canvas.setPointerCapture(e.pointerId);
  lastPointer = { x: e.clientX, y: e.clientY };

  if (e.button === 1 || e.button === 2) {
    isDragging = true;
    return;
  }

  if (e.button === 0) {
    const { cx, cy } = getCanvasCoords(e);
    const store = useLayoutStore.getState();
    const { grid, viewport, tileSize, placeEntity, selectedEntityType, selectedEntityName, selectedDirection, clearMultiSelection, setSelection } = store;
    const { x: gx, y: gy } = canvasToGrid(cx, cy, viewport, tileSize);

    const hitCell = getCell(grid, gx, gy);

    // 엔티티 선택 모드
    if (selectedEntityType !== EntityType.Empty) {
      // 동일 카테고리(Belt, Pipe) 위 → 정보 모달 띄우지 않고 그대로 덮어쓰기 흐름으로 진입
      const isOverwrite =
        hitCell?.entityType !== undefined &&
        isOverwriteAllowed(selectedEntityType, hitCell.entityType);

      // 점유된 셀 클릭 → 정보 모달 (인스턴스 단위 편집을 위해 entityId 전달)
      if (hitCell?.entityName && !isOverwrite) {
        useInspectStore.getState().inspect(hitCell.entityName, hitCell.entityId);
        return;
      }
      // 마우스 위치를 엔티티 중심으로 → origin 좌표 계산
      const size = getEntitySizeRotated(selectedEntityType, selectedEntityName, selectedDirection);
      const { x: ox, y: oy } = centerAnchorOrigin(gx, gy, size);
      // 빈 셀 → 배치 시도. 성공 시에만 drag-place 모드 진입
      // (실패한 채로 drag 진입하면 history가 안 쌓여 undo가 작동하지 않음)
      const placed = placeEntity(ox, oy);
      if (placed) {
        isPlacementDragging = true;
        lastPlacedCell = { x: gx, y: gy };
      }
      return;
    }

    // Eraser/no-entity 모드: drag rectangle multi-select 시작
    clearMultiSelection();
    isSelectionDragging = true;
    selectionStartCell = { x: gx, y: gy };
    setSelection({ active: true, startX: gx, startY: gy, endX: gx, endY: gy });
  }
}

function handlePointerMove(e: PointerEvent) {
  const { cx, cy } = getCanvasCoords(e);
  lastCanvasPos = { cx, cy };
  renderHoverPreview(cx, cy);

  // pan dragging
  if (isDragging) {
    const dx = e.clientX - lastPointer.x;
    const dy = e.clientY - lastPointer.y;
    lastPointer = { x: e.clientX, y: e.clientY };
    useLayoutStore.getState().pan(dx, dy);
    return;
  }

  // drag-place
  if (isPlacementDragging) {
    const { viewport, tileSize, placeEntitySilent, selectedEntityType, selectedEntityName, selectedDirection } = useLayoutStore.getState();
    const { x: gx, y: gy } = canvasToGrid(cx, cy, viewport, tileSize);
    if (!lastPlacedCell || gx !== lastPlacedCell.x || gy !== lastPlacedCell.y) {
      const size = getEntitySizeRotated(selectedEntityType, selectedEntityName, selectedDirection);
      const { x: ox, y: oy } = centerAnchorOrigin(gx, gy, size);
      placeEntitySilent(ox, oy);
      lastPlacedCell = { x: gx, y: gy };
    }
    return;
  }

  // drag-select
  if (isSelectionDragging && selectionStartCell) {
    const { viewport, tileSize, setSelection } = useLayoutStore.getState();
    const { x: gx, y: gy } = canvasToGrid(cx, cy, viewport, tileSize);
    setSelection({
      active: true,
      startX: selectionStartCell.x,
      startY: selectionStartCell.y,
      endX: gx,
      endY: gy,
    });
  }
}

function handlePointerUp() {
  isDragging = false;

  if (isPlacementDragging) {
    isPlacementDragging = false;
    lastPlacedCell = null;
  }

  if (isSelectionDragging && selectionStartCell) {
    const store = useLayoutStore.getState();
    const { x1, y1, x2, y2 } = {
      x1: selectionStartCell.x,
      y1: selectionStartCell.y,
      x2: store.selection.endX,
      y2: store.selection.endY,
    };
    store.selectEntitiesInRect(x1, y1, x2, y2);
    store.clearSelection();
    isSelectionDragging = false;
    selectionStartCell = null;
  }
}

function handlePointerLeave() {
  isDragging = false;
  if (isPlacementDragging) {
    isPlacementDragging = false;
    lastPlacedCell = null;
  }
  if (isSelectionDragging) {
    isSelectionDragging = false;
    selectionStartCell = null;
    useLayoutStore.getState().clearSelection();
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
  if (app || initPending) return;
  initPending = true;
  coordsEl = coords;

  const newApp = new PIXI.Application();
  app = newApp;

  await newApp.init({
    background: BG_COLOR,
    resizeTo: container,
    antialias: false,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  // await 중 destroyPixi()가 호출된 경우 중단
  if (!initPending || app !== newApp) {
    try { newApp.destroy(true, { children: true }); } catch { /* ignore */ }
    return;
  }
  initPending = false;

  appCanvas = newApp.canvas as HTMLCanvasElement;
  container.appendChild(appCanvas);

  gridContainer = new PIXI.Container();
  newApp.stage.addChild(gridContainer);

  hoverGfx = new PIXI.Graphics();
  newApp.stage.addChild(hoverGfx);

  // 이벤트를 canvas에 직접 등록 — React passive 문제 없음
  appCanvas.addEventListener('wheel',        handleWheel,       { passive: false });
  appCanvas.addEventListener('pointerdown',  handlePointerDown);
  appCanvas.addEventListener('pointermove',  handlePointerMove);
  appCanvas.addEventListener('pointerup',    handlePointerUp);
  appCanvas.addEventListener('pointerleave', handlePointerLeave);
  appCanvas.addEventListener('contextmenu',  handleContextMenu);

  // zustand store 직접 구독 — React useEffect/useCallback 없음
  unsubFns.push(useLayoutStore.subscribe(() => renderAll()));
  unsubFns.push(useSettingsStore.subscribe(() => renderAll()));
  // gameData 가 늦게 로드돼도 파이프 네트워크 색/터널이 정확히 그려지도록 재렌더 트리거.
  unsubFns.push(useGameDataStore.subscribe(() => renderAll()));

  renderGrid();
}

export function destroyPixi() {
  initPending = false; // await 중이라면 initPixi가 중단 조건을 확인하도록

  unsubFns.forEach(fn => fn());
  unsubFns.length = 0;

  // appCanvas는 init 완료 후에만 설정됨 — 미완료 시 null이므로 안전
  if (appCanvas) {
    appCanvas.removeEventListener('wheel',        handleWheel);
    appCanvas.removeEventListener('pointerdown',  handlePointerDown);
    appCanvas.removeEventListener('pointermove',  handlePointerMove);
    appCanvas.removeEventListener('pointerup',    handlePointerUp);
    appCanvas.removeEventListener('pointerleave', handlePointerLeave);
    appCanvas.removeEventListener('contextmenu',  handleContextMenu);
    appCanvas = null;
  }

  if (app) {
    try { app.destroy(true, { children: true }); } catch { /* init 미완료 시 무시 */ }
    app = null;
  }

  gridContainer = null;
  hoverGfx      = null;
  coordsEl      = null;
  lastCanvasPos = null;
  isDragging    = false;
}
