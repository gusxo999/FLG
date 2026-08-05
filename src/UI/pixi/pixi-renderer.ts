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
import { EntityType, getCell, type Direction } from '../../types/layout';
import type { Routing } from '../../autoLayout/containerModel';
import { getEntitySizeRotated } from '../../factorio/entitySize';
import { getDynamicEntityColor, collectPlacedEntityNames } from './entityColors';
import {
  computePipeNetworks,
  computeHoverPipeConnections,
  isPipeCell,
  type PipeNetworkResult,
} from '../../analysis/pipeNetwork';
import { summarizeRoutings, type ModuleInfo } from '../../autoLayout/moduleInspect';
import { overlaySource, overlayView, useAutoLayoutRunStore } from '../store/autoLayoutRunStore';
import { useModuleInspectStore } from '../store/moduleInspectStore';
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
const EXTERNAL_INPUT_COLOR   = 0x2266ff;  // 외부 입력 컨테이너 — 파란색
const EXTERNAL_OUTPUT_COLOR  = 0xff3333;  // 외부 출력 컨테이너 — 빨간색
const MODULE_BORDER_COLOR    = 0xffb020;  // 모듈 식별 테두리 — 앰버
const MODULE_LABEL_COLOR     = 0xffd98a;  // 모듈 레시피 라벨
const MODULE_PROBLEM_COLOR   = 0xff4444;  // 문제 있는 모듈 — 빨강(색만으로 안 가르고 채움+✗ 병행)

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

/** store subscription 해제 함수 목록 */
export const unsubFns: Array<() => void> = [];

// ---------------------------------------------------------------------------
// 라우팅 연결선 히트 테스트 캐시
// ---------------------------------------------------------------------------

export interface RoutingLineSegment {
  routingId: string;
  /**
   * 렌더·히트테스트용 선분 집합. 배열 순서 폴리라인이 아니라 그리드 인접
   * (맨해튼=1) 셀쌍만 잇는다 → cluster-trunk 처럼 분기하는 트리도 실제 모양대로,
   * placed[] 가 비정렬(벨트+말미 인서터)이어도 대각선 점프 없이 그려진다.
   */
  segments: { x1: number; y1: number; x2: number; y2: number }[];
  /** 끝점(도트 표시용) — 인접 차수 ≤ 1 인 셀 중심 (라우팅이 컨테이너에 닿는 지점) */
  endpoints: { x: number; y: number }[];
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
    for (const s of seg.segments) {
      const d = pointToSegmentDist(cx, cy, s.x1, s.y1, s.x2, s.y2);
      if (d < threshold && d < bestDist) {
        bestDist = d;
        best = seg.routingId;
      }
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
// 모듈 이름표 히트 테스트 캐시 (렌더 시점에 그린 라벨의 화면 사각형)
// ---------------------------------------------------------------------------

export interface ModuleLabelHit {
  moduleKey: string;
  /** 화면 픽셀 사각형 (라벨 클릭·hover 판정용) */
  x: number;
  y: number;
  w: number;
  h: number;
}

export let moduleLabelCache: ModuleLabelHit[] = [];
export let hoveredModuleKey: string | null = null;

export function setHoveredModuleKey(key: string | null): void {
  hoveredModuleKey = key;
}

/**
 * 강조 대상 — 캔버스 hover 와 **사이드바 목록 hover** 의 합집합.
 *
 * 둘이 다른 변수를 보면 "목록에 올렸는데 캔버스가 안 밝아지는" 어긋남이 생긴다.
 * 읽는 지점을 하나로 모아 그 가능성을 없앤다.
 */
export function activeModuleKey(): string | null {
  return hoveredModuleKey ?? useModuleInspectStore.getState().hoveredModuleKey;
}
export function activeLineId(): string | null {
  return hoveredRoutingId ?? useModuleInspectStore.getState().hoveredLineId;
}

/** 화면 좌표 (cx,cy) 위의 모듈 이름표 키 반환(없으면 null). */
export function hitTestModuleLabel(cx: number, cy: number): string | null {
  for (const h of moduleLabelCache) {
    if (cx >= h.x && cx <= h.x + h.w && cy >= h.y && cy <= h.y + h.h) return h.moduleKey;
  }
  return null;
}

/**
 * 모듈 포트 셀 다층 강조 — 이름표 hover·본체 hover·선택이 동일하게 쓰는 공용 렌더.
 * ①넓은 후광(glow) ②밝은 채움 ③볼드 이중 테두리 ④중심 도트. 라우팅 hover 와 같은
 * 시각 언어(두꺼운 반투명 → 선명한 심)로 눈이 즉시 끌리게 한다.
 */
export function drawModulePortHighlights(
  g: PIXI.Graphics,
  module: ModuleInfo,
  scaledTile: number,
  offsetX: number,
  offsetY: number,
): void {
  // ① 후광은 먼저 전부 — 인접 포트끼리 후광이 서로의 본체를 덮지 않게.
  for (const p of module.ports) {
    const ppx = p.x * scaledTile + offsetX;
    const ppy = p.y * scaledTile + offsetY;
    const col = p.role === 'input' ? EXTERNAL_INPUT_COLOR : EXTERNAL_OUTPUT_COLOR;
    const glow = Math.max(4, scaledTile * 0.35);
    g.rect(ppx - glow, ppy - glow, scaledTile + glow * 2, scaledTile + glow * 2)
      .fill({ color: col, alpha: 0.12 });
  }
  // ②~④ 본체
  for (const p of module.ports) {
    const ppx = p.x * scaledTile + offsetX;
    const ppy = p.y * scaledTile + offsetY;
    const col = p.role === 'input' ? EXTERNAL_INPUT_COLOR : EXTERNAL_OUTPUT_COLOR;
    g.rect(ppx + 1, ppy + 1, scaledTile - 2, scaledTile - 2)
      .fill({ color: col, alpha: 0.5 });
    g.rect(ppx + 1, ppy + 1, scaledTile - 2, scaledTile - 2)
      .stroke({ width: Math.max(5, scaledTile * 0.16), color: col, alpha: 0.35 });
    g.rect(ppx + 1, ppy + 1, scaledTile - 2, scaledTile - 2)
      .stroke({ width: 2.5, color: 0xffffff, alpha: 0.95 });
    const cx0 = ppx + scaledTile / 2;
    const cy0 = ppy + scaledTile / 2;
    const r = Math.max(2.5, scaledTile * 0.16);
    g.circle(cx0, cy0, r).fill({ color: col, alpha: 1 });
    g.circle(cx0, cy0, r * 0.5).fill({ color: 0xffffff, alpha: 1 });
  }
}

// ---------------------------------------------------------------------------
// 라우팅 수정 모드 — 그룹 bbox 렌더
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 그리드 렌더
// ---------------------------------------------------------------------------

export function renderGrid() {
  const { app, gridContainer } = pixiObjects;
  if (!app || !gridContainer) return;

  gridContainer.removeChildren();

  const {
    grid, viewport, tileSize, selectedEntityIds, selection,
  } = useLayoutStore.getState();
  const { gridOverlay, showChunkBoundaries } = useSettingsStore.getState();

  const scaledTile          = tileSize * viewport.zoom;
  const { offsetX, offsetY } = viewport;
  const { width, height, cells } = grid;

  const startX = Math.max(0, Math.floor(-offsetX / scaledTile));
  const startY = Math.max(0, Math.floor(-offsetY / scaledTile));
  const endX   = Math.min(width,  Math.ceil((app.screen.width  - offsetX) / scaledTile));
  const endY   = Math.min(height, Math.ceil((app.screen.height - offsetY) / scaledTile));

  const gfx = new PIXI.Graphics();
  gridContainer.addChild(gfx);

  const placedNames = collectPlacedEntityNames(cells);
  const { entityMap } = useGameDataStore.getState();
  const pipeNetworks: PipeNetworkResult = computePipeNetworks(grid, entityMap);

  // 오버레이 운반체 — 모듈 테두리·이름표·포트·연결선·I/O 색이 전부 이것 하나를 본다.
  // 배치가 없으면 null 이고, 아래 블록들이 자연히 비활성이 된다.
  const overlay = overlaySource();
  const overlayRoutings = overlay ? summarizeRoutings(overlay.routings) : [];

  // 외부 컨테이너 I/O 역할 맵 (input: 머신에 공급, output: 머신에서 수취)
  const externalIOMap = new Map<string, 'input' | 'output'>();
  if (overlay) {
    const extIds = new Set(overlay.containers.filter(c => c.kind !== 'machine').map(c => c.id));
    for (const r of overlayRoutings) {
      if (extIds.has(r.fromContainerId)) externalIOMap.set(r.fromContainerId, 'input');
      if (extIds.has(r.toContainerId))   externalIOMap.set(r.toContainerId, 'output');
    }
  }
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
  if (externalIOMap.size > 0) {
    // ── 연결선: 라우팅이 깐 셀 경로를 따라가는 선(없으면 컨테이너 중심 직선) ──────
    if (overlay && overlay.routings.length > 0) {
      const lineGfx = new PIXI.Graphics();
      gridContainer.addChild(lineGfx);

      const containerMap = new Map(overlay.containers.map(c => [c.id, c]));

      routingLineCache = [];

      // 예전엔 요약(session.routings)과 경로(liveArea.routings)가 **다른 두 배열**이라
      // id 로 맞춰 봐야 했다. 운반체가 하나가 되면서 그 대응이 사라졌다 — 요약과 경로가
      // 같은 객체다.
      const liveRoutingMap = new Map<string, Routing>(overlay.routings.map((r) => [r.id, r]));

      // 그리드 셀 (x,y) 중심 → 픽셀. **오버레이 좌표는 이미 그리드 좌표다** — 예전엔
      // 여기서 `overlay.offset` 을 더했는데, 같은 오프셋을 더해야 할 곳이 셋이었고
      // 하나(문제 칸 마커)가 잊혀 있었다. 지금은 더할 것이 없다.
      const cellCenterPx = (x: number, y: number) => ({
        x: (x + 0.5) * scaledTile + offsetX,
        y: (y + 0.5) * scaledTile + offsetY,
      });

      for (const routing of overlayRoutings) {
        const fromC = containerMap.get(routing.fromContainerId);
        const toC   = containerMap.get(routing.toContainerId);
        if (!fromC || !toC) continue;

        const liveR = liveRoutingMap.get(routing.id);

        // 선분 집합 (배열 순서 폴리라인 ✗ → 그리드 인접 셀쌍 ✓).
        //  - 라우팅의 placed[] 셀들 중 맨해튼 거리 1 인 쌍만 잇는다.
        //    단순 라우팅(정렬된 체인)은 그대로 경로가 되고, cluster-trunk 처럼
        //    [벨트들…, 말미 인서터들] 비정렬 트리도 실제 모양대로 그려진다.
        //  - 깐 셀이 없으면 컨테이너 중심끼리 직선 1개.
        const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];
        const endpoints: { x: number; y: number }[] = [];

        if (liveR && liveR.placed.length > 0) {
          const pts = liveR.placed.map(pc => cellCenterPx(pc.x, pc.y));
          const degree = new Array(liveR.placed.length).fill(0);
          for (let a = 0; a < liveR.placed.length; a++) {
            for (let b = a + 1; b < liveR.placed.length; b++) {
              const md = Math.abs(liveR.placed[a].x - liveR.placed[b].x)
                       + Math.abs(liveR.placed[a].y - liveR.placed[b].y);
              if (md === 1) {
                segments.push({ x1: pts[a].x, y1: pts[a].y, x2: pts[b].x, y2: pts[b].y });
                degree[a]++; degree[b]++;
              }
            }
          }
          // 끝점(차수 ≤ 1) = 라우팅이 컨테이너에 닿는 지점(인서터/말단 벨트).
          for (let a = 0; a < liveR.placed.length; a++) {
            if (degree[a] <= 1) endpoints.push(pts[a]);
          }
        } else {
          const a = {
            x: (fromC.origin.x + fromC.size.w / 2) * scaledTile + offsetX,
            y: (fromC.origin.y + fromC.size.h / 2) * scaledTile + offsetY,
          };
          const b = {
            x: (toC.origin.x + toC.size.w / 2) * scaledTile + offsetX,
            y: (toC.origin.y + toC.size.h / 2) * scaledTile + offsetY,
          };
          segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
          endpoints.push(a, b);
        }

        routingLineCache.push({ routingId: routing.id, segments, endpoints });

        const extC = fromC.kind !== 'machine' ? fromC : toC;
        const lineColor = externalIOMap.get(extC.id) === 'input'
          ? EXTERNAL_INPUT_COLOR : EXTERNAL_OUTPUT_COLOR;

        const isHovered = routing.id === activeLineId();

        const tracePath = () => {
          for (const s of segments) {
            lineGfx.moveTo(s.x1, s.y1);
            lineGfx.lineTo(s.x2, s.y2);
          }
        };

        if (isHovered) {
          // 호버 시: glow 후광 (두꺼운 반투명 선) + 메인 선 + 끝점 도트
          tracePath();
          lineGfx.stroke({ width: 10, color: lineColor, alpha: 0.18 });
          tracePath();
          lineGfx.stroke({ width: 3, color: lineColor, alpha: 1.0 });
          const dotR = 5;
          for (const ep of endpoints) {
            lineGfx.circle(ep.x, ep.y, dotR).fill({ color: lineColor, alpha: 1.0 });
          }
          // 경로 전체를 감싸는 노란 직사각형 — segments 의 실제 min/max bbox
          if (segments.length > 0) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const s of segments) {
              minX = Math.min(minX, s.x1, s.x2);
              minY = Math.min(minY, s.y1, s.y2);
              maxX = Math.max(maxX, s.x1, s.x2);
              maxY = Math.max(maxY, s.y1, s.y2);
            }
            // segments 좌표는 셀 중심이므로 반 셀만큼 키워 셀 테두리에 맞춘다.
            const pad = scaledTile / 2;
            lineGfx
              .rect(minX - pad, minY - pad, (maxX - minX) + pad * 2, (maxY - minY) + pad * 2)
              .stroke({ width: 1.5, color: 0xffff00, alpha: 0.9 });
          }
        } else {
          tracePath();
          lineGfx.stroke({ width: 1.5, color: lineColor, alpha: 0.65 });
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

        const opx = ox * scaledTile + offsetX;
        const opy = oy * scaledTile + offsetY;

        const isExt = ocell.entityType === EntityType.InfinityChest || ocell.entityType === EntityType.InfinityPipe;

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

      }
    }

    // 텍스트는 맨 위에 렌더
    for (const t of ioTexts) gridContainer.addChild(t);
  }

  // ── 모듈 경계 테두리 — 같은 클러스터의 머신 그룹을 앰버 사각형으로 식별 ──────────
  //    이름표(레시피 라벨)는 클릭 가능한 히트 타깃 → 화면 사각형을 moduleLabelCache 에 기록.
  //    실패해도 같은 블록이 그린다 — 성공은 배치에서, 실패는 스냅샷에서 **같은 모양**
  //    (OverlayModule)으로 오기 때문이다. 실패 전용 렌더 경로를 두면 그게 곧 두 번째
  //    렌더러가 되고, 두 그림이 조용히 어긋난다.
  const moduleBounds = overlayView().modules;
  moduleLabelCache = [];
  if (moduleBounds.length > 0) {
    const selectedModuleKey = useModuleInspectStore.getState().moduleKey;
    const activeKey = activeModuleKey();
    const modGfx = new PIXI.Graphics();
    gridContainer.addChild(modGfx);
    const pad = Math.max(1.5, scaledTile * 0.08);
    for (const mb of moduleBounds) {
      const active = mb.key === activeKey || mb.key === selectedModuleKey;
      const bad = mb.status === 'problem';
      const color = bad ? MODULE_PROBLEM_COLOR : MODULE_BORDER_COLOR;
      const bx = mb.bbox.x * scaledTile + offsetX - pad;
      const by = mb.bbox.y * scaledTile + offsetY - pad;
      const bw = mb.bbox.w * scaledTile + pad * 2;
      const bh = mb.bbox.h * scaledTile + pad * 2;
      // 문제 모듈은 **채움까지** 준다 — 색만으로 가르면 색각 이상에서 무너지므로
      // 채움·아이콘(아래 ✗)까지 세 신호를 겹친다.
      if (bad) modGfx.rect(bx, by, bw, bh).fill({ color, alpha: 0.14 });
      modGfx
        .rect(bx, by, bw, bh)
        .stroke({ width: active || bad ? 2.5 : 2, color, alpha: active || bad ? 1 : 0.85 });

      // active(이름표 hover·본체 hover·선택) 모듈은 포트 셀도 강조 — 세 경로 강조 통일.
      if (active) drawModulePortHighlights(modGfx, mb, scaledTile, offsetX, offsetY);

      // 레시피 라벨 — 모듈 좌상단. 너무 축소되면 생략(라벨 없으면 히트 타깃도 없음).
      // **실패 모듈은 레시피가 없어도 라벨을 낸다** — 라벨이 유일한 클릭 입구라
      // 없으면 사유를 볼 방법이 없어진다.
      const labelText = bad ? `✗ ${mb.recipe ?? mb.key}` : mb.recipe;
      if (labelText && scaledTile >= 14) {
        const label = new PIXI.Text({
          text: labelText,
          style: {
            fontSize:   Math.max(9, Math.floor(scaledTile * 0.34)),
            fill:       bad ? 0xffffff : active ? 0x1a1a2e : MODULE_LABEL_COLOR,
            fontWeight: 'bold',
          },
        });
        const lx = bx + 2;
        const ly = by - label.height - 1;
        // 이름표 배경 — hover/선택 시 강조(앰버 채움), 평소엔 은은한 어두운 배경.
        const bgPad = 2;
        modGfx
          .rect(lx - bgPad, ly - bgPad / 2, label.width + bgPad * 2, label.height + bgPad)
          .fill({ color: bad ? color : active ? MODULE_BORDER_COLOR : 0x1a1a2e, alpha: bad || active ? 0.95 : 0.55 });
        label.x = lx;
        label.y = ly;
        gridContainer.addChild(label);

        moduleLabelCache.push({
          moduleKey: mb.key,
          x: lx - bgPad,
          y: ly - bgPad / 2,
          w: label.width + bgPad * 2,
          h: label.height + bgPad,
        });
      }
    }
  }

  // ── 실패 진단 선 — 스냅샷의 납품 경로. 성공 배치의 연결선(위 오버레이 패스)과 **같은
  //    캐시**(routingLineCache)에 들어가 같은 hitTest·hover 를 탄다.
  //
  //    실패엔 깔린 셀이 없어 양끝을 잇는 직선뿐이다. 실패한 경로는 **점선 + ✗** 로 —
  //    빨강만으로 가르면 색각 이상에서 무너진다.
  const diagLines = overlayView().lines;
  if (diagLines.length > 0) {
    const activeLine = activeLineId();
    const lineGfx = new PIXI.Graphics();
    gridContainer.addChild(lineGfx);
    const px = (c: { x: number; y: number }) => ({
      x: (c.x + 0.5) * scaledTile + offsetX,
      y: (c.y + 0.5) * scaledTile + offsetY,
    });
    for (const ln of diagLines) {
      const a = px(ln.from);
      const b = px(ln.to);
      routingLineCache.push({
        routingId: ln.id,
        segments: [{ x1: a.x, y1: a.y, x2: b.x, y2: b.y }],
        endpoints: [a, b],
      });
      const hovered = ln.id === activeLine;
      const color = ln.ok ? 0x9aa0b5 : MODULE_PROBLEM_COLOR;
      if (ln.ok) {
        lineGfx.moveTo(a.x, a.y).lineTo(b.x, b.y)
          .stroke({ width: hovered ? 3 : 2, color, alpha: hovered ? 1 : 0.7 });
      } else {
        // 점선 — PIXI 에 dash 가 없어 구간을 나눠 긋는다.
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const dash = Math.max(6, scaledTile * 0.35);
        const steps = Math.max(1, Math.floor(dist / dash));
        for (let i = 0; i < steps; i += 2) {
          const t0 = i / steps, t1 = Math.min(1, (i + 1) / steps);
          lineGfx
            .moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0)
            .lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
        }
        lineGfx.stroke({ width: hovered ? 4 : 3, color, alpha: 1 });
        // 중앙 ✗ — 모양으로도 실패임을 알린다.
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const r = Math.max(4, scaledTile * 0.22);
        lineGfx.moveTo(mx - r, my - r).lineTo(mx + r, my + r)
               .moveTo(mx + r, my - r).lineTo(mx - r, my + r)
               .stroke({ width: 2.5, color, alpha: 1 });
      }
    }
  }

  // ── 문제 칸 마커 — `pipe-merge-conflict` 처럼 좌표를 아는 issue.
  const issueCells = useAutoLayoutRunStore.getState().issues.flatMap((i) => i.cells ?? []);
  if (issueCells.length > 0) {
    const markGfx = new PIXI.Graphics();
    gridContainer.addChild(markGfx);
    for (const c of issueCells) {
      const mx = c.x * scaledTile + offsetX;
      const my = c.y * scaledTile + offsetY;
      markGfx.rect(mx, my, scaledTile, scaledTile)
        .fill({ color: MODULE_PROBLEM_COLOR, alpha: 0.3 })
        .stroke({ width: 2, color: MODULE_PROBLEM_COLOR, alpha: 1 });
    }
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

  // 자동 레이아웃 hover 미리보기 오버레이는 **없앴다**(2026-08-04). 후보 목록/트리 로그에
  // 마우스를 올렸을 때 그 후보를 반투명으로 겹쳐 보여 주던 것인데, 고를 후보가 하나뿐이라
  // 그 UI 자체가 사라졌다. 결과는 생성 즉시 그리드에 그대로 적용된다.
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
  } = useLayoutStore.getState();
  const { x: hx, y: hy } = canvasToGrid(cx, cy, viewport, tileSize);
  const scaledTile = tileSize * viewport.zoom;

  if (pixiObjects.coordsEl) {
    // 좌표계가 하나다 — 예전엔 `gridOriginX/Y` 를 더해 "표시 좌표"를 따로 냈다.
    // 음수 좌표를 금지하면서 그 누적이 사라졌다(사용자 결정, 2026-08-05).
    pixiObjects.coordsEl.textContent = `${hx}, ${hy}`;
    (pixiObjects.coordsEl as HTMLElement).style.display = '';
  }

  // 모듈 포트 강조는 renderGrid 가 active 모듈(이름표/본체 hover·선택) 기준으로 그린다
  // — 이름표 hover 와 본체 hover 의 강조가 완전히 동일하도록 단일 경로로 통일.

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
