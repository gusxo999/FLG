/**
 * pixi-renderer.ts
 *
 * 공유 상태 오브젝트 + 렌더링 함수 모음.
 * 이벤트 핸들러와 lifecycle 은 pixi-manager.ts 에 있다.
 *
 * 상태는 exported const 오브젝트의 프로퍼티로 관리하므로
 * pixi-manager.ts 에서 자유롭게 mutate 할 수 있다.
 */

import * as PIXI from 'pixi.js';
import { useLayoutStore, canvasToGrid } from '../store/layoutStore';
import { useSettingsStore } from '../store/settingsStore';
import { useGameDataStore } from '../store/gameDataStore';
import { EntityType, getCell, type Direction } from '../types/layout';
import { getEntitySizeRotated } from '../utils/entitySize';
import { getDynamicEntityColor, collectPlacedEntityNames } from '../utils/entityColors';
import {
  computePipeNetworks,
  computeHoverPipeConnections,
  isPipeCell,
  type PipeNetworkResult,
} from '../utils/pipeNetwork';
import { centerAnchorOrigin, isInExternalArea, isOverwriteAllowed } from './pixi-draw-utils';
import { drawPipeShape } from './pixi-draw-pipe';
import { drawInteractionPoints } from './pixi-draw-entity';

// ---------------------------------------------------------------------------
// 그리드 보조 색상 상수
// ---------------------------------------------------------------------------
const GRID_LINE_COLOR    = 0x3a3a5f;
const CHUNK_LINE_COLOR   = 0x7a3a3a;
export const BG_COLOR    = 0x1a1a2e;
const EMPTY_CELL_COLOR   = 0x12121f;
const EXTERNAL_AREA_BG   = 0x0d1f10;
const EXTERNAL_AREA_EDGE = 0x2a5c30;
const ROUTING_EDIT_BOX_COLOR = 0x44aaff;
const EXTERNAL_INPUT_COLOR   = 0x2266ff;  // 외부 입력 컨테이너 — 파란색
const EXTERNAL_OUTPUT_COLOR  = 0xff3333;  // 외부 출력 컨테이너 — 빨간색
const ROUTING_EDIT_MACHINE_GLOW = 0x44ffcc;  // 라우팅 편집 모드 조립기계 하이라이트

// ---------------------------------------------------------------------------
// 공유 PIXI 오브젝트 — pixi-manager.ts 에서 프로퍼티를 직접 mutate
// ---------------------------------------------------------------------------
export const pixiObjects = {
  app:           null as PIXI.Application | null,
  gridContainer: null as PIXI.Container   | null,
  hoverGfx:      null as PIXI.Graphics    | null,
  coordsEl:      null as HTMLElement      | null,
  appCanvas:     null as HTMLCanvasElement | null,
  initPending:   false,
};

// ---------------------------------------------------------------------------
// 공유 입력/드래그 상태 — pixi-manager.ts 에서 프로퍼티를 직접 mutate
// ---------------------------------------------------------------------------

/** 뷰포트 팬 드래그 + 마지막 커서 위치 */
export const inputState = {
  isDragging:    false,
  lastPointer:   { x: 0, y: 0 },
  lastCanvasPos: null as { cx: number; cy: number } | null,
};

/** 엔티티 배치 드래그 */
export const placementDrag = {
  active:        false,
  lastPlacedCell: null as { x: number; y: number } | null,
};

/** 다중 선택 rectangle 드래그 */
export const selectionDrag = {
  active:    false,
  startCell: null as { x: number; y: number } | null,
};

/** InfinityChest / InfinityPipe 이동 드래그 */
export const infinityDrag = {
  active:     false,
  entityId:   null as string | null,
  entityType: EntityType.Empty as EntityType,
  entityName: null as string | null,
  entityDir:  0 as Direction,
  originCell: null as { x: number; y: number } | null,
};

/** 라우팅 수정 모드 조립기계 그룹 드래그 */
export const routingEditDrag = {
  active:      false,
  containerId: null as string | null,
  anchorGrid:  null as { x: number; y: number } | null,
  currentGrid: null as { x: number; y: number } | null,
};

/** store subscription 해제 함수 목록 */
export const unsubFns: Array<() => void> = [];

// ---------------------------------------------------------------------------
// 라우팅 연결선 히트 테스트 캐시
// ---------------------------------------------------------------------------

export interface RoutingLineSegment {
  routingId: string;
  fromPx: number; fromPy: number;
  toPx: number; toPy: number;
}

export let routingLineCache: RoutingLineSegment[] = [];
export let hoveredRoutingId: string | null = null;

export function setHoveredRoutingId(id: string | null): void {
  hoveredRoutingId = id;
}

function pointToSegmentDist(
  px: number, py: number,
  x1: number, y1: number, x2: number, y2: number,
): number {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function hitTestRoutingLine(cx: number, cy: number, threshold = 10): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const seg of routingLineCache) {
    const d = pointToSegmentDist(cx, cy, seg.fromPx, seg.fromPy, seg.toPx, seg.toPy);
    if (d < threshold && d < bestDist) {
      bestDist = d;
      best = seg.routingId;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 좌표 유틸
// ---------------------------------------------------------------------------

export function getCanvasCoords(e: PointerEvent | WheelEvent): { cx: number; cy: number } {
  const rect = pixiObjects.appCanvas!.getBoundingClientRect();
  return { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
}

// ---------------------------------------------------------------------------
// 라우팅 수정 모드 — 그룹 bbox 렌더
// ---------------------------------------------------------------------------

function renderRoutingEditGroupBbox(
  containerId: string,
  offsetDx: number,
  offsetDy: number,
  scaledTile: number,
  offsetX: number,
  offsetY: number,
) {
  if (!pixiObjects.hoverGfx) return;
  const { grid, routingEditSession } = useLayoutStore.getState();
  if (!routingEditSession) return;

  // BFS: containerId + 모든 자손 machine
  const groupIds = new Set<string>([containerId]);
  const queue: string[] = [containerId];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const child of (routingEditSession.machineChildren[curr] ?? [])) {
      if (!groupIds.has(child)) { groupIds.add(child); queue.push(child); }
    }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < grid.cells.length; i++) {
    const cell = grid.cells[i];
    if (!cell.entityId || !groupIds.has(cell.entityId)) continue;
    const x = i % grid.width;
    const y = Math.floor(i / grid.width);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (minX > maxX) return;

  const bx = (minX + offsetDx) * scaledTile + offsetX;
  const by = (minY + offsetDy) * scaledTile + offsetY;
  const bw = (maxX - minX + 1) * scaledTile;
  const bh = (maxY - minY + 1) * scaledTile;

  pixiObjects.hoverGfx
    .rect(bx, by, bw, bh)
    .fill({ color: ROUTING_EDIT_BOX_COLOR, alpha: 0.1 })
    .stroke({ width: 2, color: ROUTING_EDIT_BOX_COLOR, alpha: 0.9 });
}

// ---------------------------------------------------------------------------
// 그리드 렌더
// ---------------------------------------------------------------------------

export function renderGrid() {
  const { app, gridContainer } = pixiObjects;
  if (!app || !gridContainer) return;

  gridContainer.removeChildren();

  const {
    grid, viewport, tileSize, selectedEntityIds, selection, routingEditSession, routingEditMode,
  } = useLayoutStore.getState();
  const { gridOverlay, showChunkBoundaries } = useSettingsStore.getState();

  const scaledTile          = tileSize * viewport.zoom;
  const { offsetX, offsetY } = viewport;
  const { width, height, cells } = grid;

  // 라우팅 수정 드래그 중: 드래그 그룹의 셀을 원래 위치에서 숨기기
  let draggingSkipIds: Set<string> | null = null;
  if (routingEditDrag.active && routingEditDrag.containerId && routingEditSession) {
    draggingSkipIds = new Set();
    const groupIds = new Set<string>([routingEditDrag.containerId]);
    const bfsQ: string[] = [routingEditDrag.containerId];
    while (bfsQ.length > 0) {
      const curr = bfsQ.shift()!;
      for (const child of (routingEditSession.machineChildren[curr] ?? [])) {
        if (!groupIds.has(child)) { groupIds.add(child); bfsQ.push(child); }
      }
    }
    for (const id of groupIds) draggingSkipIds.add(id);
    for (const r of routingEditSession.routings) {
      if (groupIds.has(r.fromContainerId) || groupIds.has(r.toContainerId)) {
        draggingSkipIds.add(r.id);
      }
    }
  }

  const startX = Math.max(0, Math.floor(-offsetX / scaledTile));
  const startY = Math.max(0, Math.floor(-offsetY / scaledTile));
  const endX   = Math.min(width,  Math.ceil((app.screen.width  - offsetX) / scaledTile));
  const endY   = Math.min(height, Math.ceil((app.screen.height - offsetY) / scaledTile));

  const gfx = new PIXI.Graphics();
  gridContainer.addChild(gfx);

  const placedNames = collectPlacedEntityNames(cells);
  const { entityMap } = useGameDataStore.getState();
  const pipeNetworks: PipeNetworkResult = computePipeNetworks(grid, entityMap);

  // 외부 컨테이너 I/O 역할 맵 (input: 머신에 공급, output: 머신에서 수취)
  const externalIOMap = new Map<string, 'input' | 'output'>();
  if (routingEditSession) {
    const extIds = new Set(routingEditSession.containers.filter(c => c.kind !== 'machine').map(c => c.id));
    for (const r of routingEditSession.routings) {
      if (extIds.has(r.fromContainerId)) externalIOMap.set(r.fromContainerId, 'input');
      if (extIds.has(r.toContainerId))   externalIOMap.set(r.toContainerId, 'output');
    }
  }
  const routingMachineIds = routingEditSession
    ? new Set(routingEditSession.containers.filter(c => c.kind === 'machine').map(c => c.id))
    : null;

  // 외부 영역 배경 — canvasBbox 내에서 internalBbox(Blueprint) 바깥 전체를 초록으로 칠함
  const { externalAreaBbox, autoLayoutCanvasBbox } = useLayoutStore.getState();
  if (externalAreaBbox && autoLayoutCanvasBbox) {
    const cx1 = autoLayoutCanvasBbox.x;
    const cy1 = autoLayoutCanvasBbox.y;
    const cx2 = cx1 + autoLayoutCanvasBbox.w - 1; // inclusive
    const cy2 = cy1 + autoLayoutCanvasBbox.h - 1; // inclusive
    const bx1 = externalAreaBbox.x;
    const by1 = externalAreaBbox.y;
    const bx2 = bx1 + externalAreaBbox.w - 1; // inclusive
    const by2 = by1 + externalAreaBbox.h - 1; // inclusive
    const visX1 = Math.max(startX, cx1);
    const visY1 = Math.max(startY, cy1);
    const visX2 = Math.min(endX - 1, cx2);
    const visY2 = Math.min(endY - 1, cy2);
    for (let ry = visY1; ry <= visY2; ry++) {
      for (let rx = visX1; rx <= visX2; rx++) {
        if (rx >= bx1 && rx <= bx2 && ry >= by1 && ry <= by2) continue; // Blueprint 내부 건너뜀
        const rpx = rx * scaledTile + offsetX;
        const rpy = ry * scaledTile + offsetY;
        gfx.rect(rpx, rpy, scaledTile, scaledTile).fill({ color: EXTERNAL_AREA_BG });
      }
    }
    // Blueprint 경계 외곽선
    if (visX1 <= visX2 && visY1 <= visY2) {
      const edgeX = bx1 * scaledTile + offsetX;
      const edgeY = by1 * scaledTile + offsetY;
      const edgeW = (bx2 - bx1 + 1) * scaledTile;
      const edgeH = (by2 - by1 + 1) * scaledTile;
      gfx.rect(edgeX, edgeY, edgeW, edgeH).stroke({ width: 1.5, color: EXTERNAL_AREA_EDGE, alpha: 0.7 });
    }
  }

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const px   = x * scaledTile + offsetX;
      const py   = y * scaledTile + offsetY;
      const cell = cells[y * width + x];

      // 드래그 중인 그룹은 원래 위치에 렌더하지 않음
      if (draggingSkipIds && cell?.entityId && draggingSkipIds.has(cell.entityId)) {
        const inExt = externalAreaBbox !== null && autoLayoutCanvasBbox !== null &&
          isInExternalArea(x, y, autoLayoutCanvasBbox, externalAreaBbox);
        if (!inExt) gfx.rect(px, py, scaledTile, scaledTile).fill({ color: EMPTY_CELL_COLOR });
        continue;
      }

      if (!cell || cell.entityType === EntityType.Empty || !cell.isOrigin) {
        if (!cell || cell.entityType === EntityType.Empty) {
          // 외부 영역에 있는 빈 셀은 EXTERNAL_AREA_BG 가 이미 그려져 있으므로 스킵
          const inExt = externalAreaBbox !== null && autoLayoutCanvasBbox !== null &&
            isInExternalArea(x, y, autoLayoutCanvasBbox, externalAreaBbox);
          if (!inExt) gfx.rect(px, py, scaledTile, scaledTile).fill({ color: EMPTY_CELL_COLOR });
        }
      } else {
        const isPipe = !!cell.entityId && isPipeCell(cell.entityType);

        let color: number;
        if (isPipe && cell.entityId && pipeNetworks.networkOf.has(cell.entityId)) {
          const nid = pipeNetworks.networkOf.get(cell.entityId)!;
          color = pipeNetworks.colorOf.get(nid) ?? getDynamicEntityColor(cell.entityName, placedNames);
        } else {
          color = getDynamicEntityColor(cell.entityName, placedNames);
        }

        // 외부 컨테이너 I/O 색상 오버라이드
        if (cell.entityId && (cell.entityType === EntityType.InfinityChest || cell.entityType === EntityType.InfinityPipe)) {
          const io = externalIOMap.get(cell.entityId);
          if (io === 'input')       color = EXTERNAL_INPUT_COLOR;
          else if (io === 'output') color = EXTERNAL_OUTPUT_COLOR;
        }

        const isSelected = cell.entityId !== null && selectedEntityIds.has(cell.entityId);

        if (isPipe) {
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
          const size = getEntitySizeRotated(cell.entityType, cell.entityName, cell.direction);
          const fw   = size.width  * scaledTile - 2;
          const fh   = size.height * scaledTile - 2;

          gfx.rect(px + 1, py + 1, fw, fh).fill({ color });

          if (isSelected) {
            gfx.rect(px + 1, py + 1, fw, fh).stroke({ width: 2.5, color: 0xffee44, alpha: 1 });
          } else {
            gfx.rect(px + 1, py + 1, fw, fh).stroke({ width: 1.5, color: 0xffffff, alpha: 0.25 });
          }

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

  // 오버레이 패스: 연결선 + I/O glow + 기계 하이라이트 + I/O 텍스트
  if (externalIOMap.size > 0 || (routingEditMode && routingMachineIds)) {
    // ── 연결선: 외부 컨테이너 ↔ 머신 중심 사이 직선 ──────────────────────────
    if (routingEditSession && routingEditSession.routings.length > 0) {
      const lineGfx = new PIXI.Graphics();
      gridContainer.addChild(lineGfx);

      const containerMap = new Map(routingEditSession.containers.map(c => [c.id, c]));

      // 드래그 중인 그룹 및 오프셋
      let dragGroupIds: Set<string> | null = null;
      let dragDx = 0;
      let dragDy = 0;
      if (routingEditDrag.active && routingEditDrag.containerId
          && routingEditDrag.anchorGrid && routingEditDrag.currentGrid) {
        dragDx = routingEditDrag.currentGrid.x - routingEditDrag.anchorGrid.x;
        dragDy = routingEditDrag.currentGrid.y - routingEditDrag.anchorGrid.y;
        dragGroupIds = new Set([routingEditDrag.containerId]);
        const bq: string[] = [routingEditDrag.containerId];
        while (bq.length > 0) {
          const curr = bq.shift()!;
          for (const child of routingEditSession.machineChildren[curr] ?? []) {
            if (!dragGroupIds.has(child)) { dragGroupIds.add(child); bq.push(child); }
          }
        }
      }

      // 매 렌더마다 라인 캐시 갱신 (드래그 오프셋 반영)
      routingLineCache = [];

      // container.origin은 layout 좌표계 → 그리드 좌표로 변환하는 상수 오프셋
      const coox = routingEditSession.containerOriginOffset?.x ?? 0;
      const cooy = routingEditSession.containerOriginOffset?.y ?? 0;

      for (const routing of routingEditSession.routings) {
        const fromC = containerMap.get(routing.fromContainerId);
        const toC   = containerMap.get(routing.toContainerId);
        if (!fromC || !toC) continue;

        const fdx = dragGroupIds?.has(routing.fromContainerId) ? dragDx : 0;
        const fdy = dragGroupIds?.has(routing.fromContainerId) ? dragDy : 0;
        const tdx = dragGroupIds?.has(routing.toContainerId)   ? dragDx : 0;
        const tdy = dragGroupIds?.has(routing.toContainerId)   ? dragDy : 0;

        const fromPx = (fromC.origin.x + coox + fdx + fromC.size.w / 2) * scaledTile + offsetX;
        const fromPy = (fromC.origin.y + cooy + fdy + fromC.size.h / 2) * scaledTile + offsetY;
        const toPx   = (toC.origin.x   + coox + tdx + toC.size.w   / 2) * scaledTile + offsetX;
        const toPy   = (toC.origin.y   + cooy + tdy + toC.size.h   / 2) * scaledTile + offsetY;

        routingLineCache.push({ routingId: routing.id, fromPx, fromPy, toPx, toPy });

        const extC = fromC.kind !== 'machine' ? fromC : toC;
        const lineColor = externalIOMap.get(extC.id) === 'input'
          ? EXTERNAL_INPUT_COLOR : EXTERNAL_OUTPUT_COLOR;

        const isHovered = routing.id === hoveredRoutingId;

        if (isHovered) {
          // 호버 시: glow 후광 (두꺼운 반투명 선) + 메인 선 + 양 끝 점
          lineGfx
            .moveTo(fromPx, fromPy)
            .lineTo(toPx, toPy)
            .stroke({ width: 10, color: lineColor, alpha: 0.18 });
          lineGfx
            .moveTo(fromPx, fromPy)
            .lineTo(toPx, toPy)
            .stroke({ width: 3, color: lineColor, alpha: 1.0 });
          const dotR = 5;
          lineGfx.circle(fromPx, fromPy, dotR).fill({ color: lineColor, alpha: 1.0 });
          lineGfx.circle(toPx,   toPy,   dotR).fill({ color: lineColor, alpha: 1.0 });
          // 중심점 (클릭 가능 표시)
          const midX = (fromPx + toPx) / 2;
          const midY = (fromPy + toPy) / 2;
          lineGfx.circle(midX, midY, 7).fill({ color: 0xffffff, alpha: 0.15 });
          lineGfx.circle(midX, midY, 7).stroke({ width: 1.5, color: lineColor, alpha: 0.9 });
        } else {
          lineGfx
            .moveTo(fromPx, fromPy)
            .lineTo(toPx, toPy)
            .stroke({ width: 1.5, color: lineColor, alpha: 0.65 });
        }
      }
    }

    // ── glow: 외부상자 + 조립기계 ────────────────────────────────────────────
    const highlightGfx = new PIXI.Graphics();
    gridContainer.addChild(highlightGfx);
    const ioTexts: PIXI.Text[] = [];

    for (let oy = startY; oy < endY; oy++) {
      for (let ox = startX; ox < endX; ox++) {
        const ocell = cells[oy * width + ox];
        if (!ocell?.entityId || !ocell.isOrigin) continue;
        if (draggingSkipIds?.has(ocell.entityId)) continue;

        const opx = ox * scaledTile + offsetX;
        const opy = oy * scaledTile + offsetY;
        const osize = getEntitySizeRotated(ocell.entityType, ocell.entityName, ocell.direction);
        const ofw = osize.width  * scaledTile - 2;
        const ofh = osize.height * scaledTile - 2;

        const isExt = ocell.entityType === EntityType.InfinityChest || ocell.entityType === EntityType.InfinityPipe;

        // 외부상자 glow (I/O 색상) — 라우팅 편집 모드에서만
        if (isExt && routingEditMode) {
          const io = externalIOMap.get(ocell.entityId);
          if (io) {
            const glowColor = io === 'input' ? EXTERNAL_INPUT_COLOR : EXTERNAL_OUTPUT_COLOR;
            highlightGfx
              .rect(opx - 3, opy - 3, ofw + 8, ofh + 8)
              .stroke({ width: 4, color: glowColor, alpha: 0.18 });
            highlightGfx
              .rect(opx + 1, opy + 1, ofw, ofh)
              .stroke({ width: 2, color: glowColor, alpha: 0.9 });
          }
        }

        // I/O 텍스트 레이블
        if (isExt && scaledTile >= 18) {
          const io = externalIOMap.get(ocell.entityId);
          if (io) {
            const label = new PIXI.Text({
              text: io === 'input' ? 'I' : 'O',
              style: {
                fontSize:   Math.max(8, Math.floor(scaledTile * 0.44)),
                fill:       0xffffff,
                fontWeight: 'bold',
              },
            });
            label.anchor.set(0.5, 0.5);
            label.x = opx + scaledTile / 2;
            label.y = opy + scaledTile / 2;
            ioTexts.push(label);
          }
        }

        // 조립기계 hglow (라우팅 편집 모드 — 드래그 가능 표시)
        if (routingEditMode && routingMachineIds?.has(ocell.entityId)) {
          highlightGfx
            .rect(opx - 3, opy - 3, ofw + 8, ofh + 8)
            .stroke({ width: 5, color: ROUTING_EDIT_MACHINE_GLOW, alpha: 0.2 });
          highlightGfx
            .rect(opx + 1, opy + 1, ofw, ofh)
            .stroke({ width: 2, color: ROUTING_EDIT_MACHINE_GLOW, alpha: 0.85 });
        }
      }
    }

    // 텍스트는 맨 위에 렌더
    for (const t of ioTexts) gridContainer.addChild(t);
  }

  // 지하 터널 짝 시각화
  if (pipeNetworks.undergroundLinks.length) {
    const undergroundWidth = Math.max(1.5, scaledTile * 0.12);
    const dividerHalfThin  = Math.max(1.5, scaledTile * 0.09);

    for (const link of pipeNetworks.undergroundLinks) {
      const nid = pipeNetworks.networkOf.get(link.fromId);
      if (nid === undefined) continue;
      const color = pipeNetworks.colorOf.get(nid)!;
      const x1  = link.x1 * scaledTile + offsetX;
      const y1  = link.y1 * scaledTile + offsetY;
      const x2  = link.x2 * scaledTile + offsetX;
      const y2  = link.y2 * scaledTile + offsetY;
      const dxn = x2 - x1;
      const dyn = y2 - y1;
      const len = Math.sqrt(dxn * dxn + dyn * dyn);
      if (len < 0.001) continue;
      const ux = dxn / len;
      const uy = dyn / len;
      gfx
        .moveTo(x1 + ux * dividerHalfThin, y1 + uy * dividerHalfThin)
        .lineTo(x2 - ux * dividerHalfThin, y2 - uy * dividerHalfThin)
        .stroke({ width: undergroundWidth, color, alpha: 0.85 });
    }
  }

  if (gridOverlay !== 'none' && scaledTile >= 6) {
    // KNOWN ISSUE: 브라우저 줌 변경 시 일부 배율에서 그리드 선이 사라질 수 있음.
    // 원인: PixiJS resolution(초기화 시 고정)과 실제 devicePixelRatio가 일시적으로 불일치.
    // pixi-manager.ts의 watchDpr()가 변경을 감지해 동기화하지만,
    // matchMedia 이벤트 특성상 일부 비표준 배율에서 감지가 누락될 수 있음.
    const dpr    = pixiObjects.app?.renderer.resolution || window.devicePixelRatio || 1;
    const snapPx = (v: number) => Math.round(v * dpr) / dpr;
    const lineW  = 1 / dpr;

    for (let x = startX; x <= endX; x++) {
      const px      = snapPx(x * scaledTile + offsetX);
      const isChunk = showChunkBoundaries && x % 32 === 0;
      const lw      = isChunk ? lineW * 2 : lineW;
      gfx.rect(px, startY * scaledTile + offsetY, lw, (endY - startY) * scaledTile)
         .fill({ color: isChunk ? CHUNK_LINE_COLOR : GRID_LINE_COLOR });
    }
    for (let y = startY; y <= endY; y++) {
      const py      = snapPx(y * scaledTile + offsetY);
      const isChunk = showChunkBoundaries && y % 32 === 0;
      const lh      = isChunk ? lineW * 2 : lineW;
      gfx.rect(startX * scaledTile + offsetX, py, (endX - startX) * scaledTile, lh)
         .fill({ color: isChunk ? CHUNK_LINE_COLOR : GRID_LINE_COLOR });
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
    gfx.rect(rx, ry, rw, rh)
       .fill({ color: 0xffee44, alpha: 0.15 })
       .stroke({ width: 1.5, color: 0xffee44, alpha: 0.9 });
  }

  // 자동 레이아웃 hover 미리보기 오버레이
  const { previewCells } = useLayoutStore.getState();
  if (previewCells && previewCells.length > 0) {
    const previewNames   = collectPlacedEntityNames(previewCells.map((p) => p.cell));
    const combinedNames  = [...new Set([...placedNames, ...previewNames])].sort();

    for (const { x, y, cell } of previewCells) {
      if (x < startX || x >= endX || y < startY || y >= endY) continue;
      if (!cell.isOrigin) continue;
      const size  = getEntitySizeRotated(cell.entityType, cell.entityName ?? '', cell.direction);
      const px    = x * scaledTile + offsetX;
      const py    = y * scaledTile + offsetY;
      const fw    = size.width  * scaledTile - 2;
      const fh    = size.height * scaledTile - 2;
      const color = getDynamicEntityColor(cell.entityName, combinedNames);
      gfx
        .rect(px + 1, py + 1, fw, fh)
        .fill({ color, alpha: 0.7 })
        .stroke({ width: 1.5, color: 0xffffff, alpha: 0.5 });
    }
  }
}

// ---------------------------------------------------------------------------
// 호버 프리뷰 렌더
// overrideType/Name/Dir 를 지정하면 store 의 선택 엔티티 대신 해당 값 사용
// ---------------------------------------------------------------------------

export function renderHoverPreview(
  cx: number,
  cy: number,
  overrideType?: EntityType,
  overrideName?: string,
  overrideDir?: Direction,
) {
  if (!pixiObjects.hoverGfx) return;
  pixiObjects.hoverGfx.clear();

  const {
    grid, viewport, tileSize,
    selectedEntityType, selectedEntityName, selectedDirection,
    routingEditMode, routingEditSession,
    gridOriginX, gridOriginY,
  } = useLayoutStore.getState();
  const { x: hx, y: hy } = canvasToGrid(cx, cy, viewport, tileSize);
  const scaledTile = tileSize * viewport.zoom;

  if (pixiObjects.coordsEl) {
    pixiObjects.coordsEl.textContent = `${hx + gridOriginX}, ${hy + gridOriginY}`;
    (pixiObjects.coordsEl as HTMLElement).style.display = '';
  }

  // 라우팅 수정 모드: 그룹 bbox 표시 (일반 배치 미리보기 대체)
  if (routingEditMode && routingEditSession) {
    let displayId: string | null = null;
    if (routingEditDrag.active && routingEditDrag.containerId) {
      displayId = routingEditDrag.containerId;
    } else {
      const hitCell = getCell(grid, hx, hy);
      if (hitCell?.entityId) {
        const machineIds = new Set(
          routingEditSession.containers.filter(c => c.kind === 'machine').map(c => c.id),
        );
        if (machineIds.has(hitCell.entityId)) displayId = hitCell.entityId;
      }
    }
    if (displayId) {
      const odx = routingEditDrag.active && routingEditDrag.anchorGrid
        ? hx - routingEditDrag.anchorGrid.x : 0;
      const ody = routingEditDrag.active && routingEditDrag.anchorGrid
        ? hy - routingEditDrag.anchorGrid.y : 0;
      renderRoutingEditGroupBbox(displayId, odx, ody, scaledTile, viewport.offsetX, viewport.offsetY);
    }
    return;
  }

  const actualType = overrideType ?? selectedEntityType;
  const actualName = overrideName ?? selectedEntityName;
  const actualDir  = overrideDir  ?? selectedDirection;

  if (actualType === EntityType.Empty) {
    const px = hx * scaledTile + viewport.offsetX;
    const py = hy * scaledTile + viewport.offsetY;
    pixiObjects.hoverGfx
      .rect(px + 1, py + 1, scaledTile - 2, scaledTile - 2)
      .fill({ color: 0xff4444, alpha: 0.2 })
      .stroke({ width: 2, color: 0xff4444, alpha: 0.9 });
    return;
  }

  const size = getEntitySizeRotated(actualType, actualName, actualDir);
  const { x, y } = centerAnchorOrigin(hx, hy, size);
  const px = x * scaledTile + viewport.offsetX;
  const py = y * scaledTile + viewport.offsetY;
  const fw = size.width  * scaledTile - 2;
  const fh = size.height * scaledTile - 2;

  // x/y < 0 는 placeEntity 가 shift 로 처리 — 우/하 경계만 진짜 out-of-bounds
  const outOfBounds =
    x + size.width  > grid.width ||
    y + size.height > grid.height;

  let occupied = false;
  if (!outOfBounds) {
    outer:
    for (let dy = 0; dy < size.height; dy++) {
      for (let dx = 0; dx < size.width; dx++) {
        const cell = getCell(grid, x + dx, y + dy);
        // 드래그 중인 InfinityChest/Pipe 자신의 셀은 점유로 보지 않음
        if (cell?.entityId !== null && cell?.entityId !== infinityDrag.entityId) {
          occupied = true; break outer;
        }
      }
    }
  }

  // 동일 카테고리(Belt, Pipe) 위는 덮어쓰기 가능 → "막힘"으로 표시하지 않음
  const overwritable = !outOfBounds && occupied && (() => {
    for (let dy = 0; dy < size.height; dy++) {
      for (let dx = 0; dx < size.width; dx++) {
        const cell = getCell(grid, x + dx, y + dy);
        if (!cell?.entityId) return false;
        if (!isOverwriteAllowed(actualType, cell.entityType)) return false;
      }
    }
    return true;
  })();

  const placeable = !outOfBounds && (!occupied || overwritable);
  const color     = placeable ? 0x00ff66 : 0xff3333;

  const isPipePreview =
    placeable && (actualType === EntityType.Pipe || actualType === EntityType.PipeUnderground);

  if (isPipePreview) {
    const hoverConn = computeHoverPipeConnections(
      grid, useGameDataStore.getState().entityMap,
      x, y, actualType, actualDir, actualName,
    );
    drawPipeShape(
      pixiObjects.hoverGfx,
      x, y, actualType, actualDir,
      color, scaledTile, viewport.offsetX, viewport.offsetY,
      hoverConn,
    );
    pixiObjects.hoverGfx.rect(px + 1, py + 1, fw, fh).stroke({ width: 2, color, alpha: 0.6 });
  } else {
    pixiObjects.hoverGfx
      .rect(px + 1, py + 1, fw, fh)
      .fill({ color, alpha: 0.15 })
      .stroke({ width: 2, color, alpha: 0.9 });

    if (actualName) {
      drawInteractionPoints(
        pixiObjects.hoverGfx,
        x, y, actualType, actualName, actualDir,
        scaledTile, viewport.offsetX, viewport.offsetY,
        0.9,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 전체 재렌더 / 호버 초기화
// ---------------------------------------------------------------------------

export function clearHoverPreview() {
  pixiObjects.hoverGfx?.clear();
  if (pixiObjects.coordsEl) (pixiObjects.coordsEl as HTMLElement).style.display = 'none';
  inputState.lastCanvasPos = null;
}

export function renderAll() {
  renderGrid();
  if (inputState.lastCanvasPos) {
    if (infinityDrag.active) {
      renderHoverPreview(
        inputState.lastCanvasPos.cx, inputState.lastCanvasPos.cy,
        infinityDrag.entityType,
        infinityDrag.entityName ?? undefined,
        infinityDrag.entityDir,
      );
    } else {
      renderHoverPreview(inputState.lastCanvasPos.cx, inputState.lastCanvasPos.cy);
    }
  }
}
