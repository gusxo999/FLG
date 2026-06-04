/**
 * Visualization — 독립 Pixi 렌더러.
 *
 * 메인 그리드의 pixi-manager 는 layoutStore 싱글톤에 강결합돼 있어 재사용이
 * 어렵다. 시각화 모달은 *별도 Pixi Application 인스턴스* 와 독립 셀 버퍼를 쓰는
 * 이 read-only 렌더러로 한 단계의 스냅샷을 그린다.
 *
 * 카메라: 처음엔 전체 과정의 합집합 bbox 에 맞춰 자동 fit 하고, 그 위에 사용자가
 * 휠로 확대/축소, 드래그로 이동할 수 있다(더블클릭 = fit 으로 리셋). 단계가 바뀌어도
 * 사용자의 뷰 변환은 유지돼 화면이 튀지 않는다.
 */

import * as PIXI from 'pixi.js';
import type { PlacedCell } from '../../utils/autoLayout/containerModel';
import { EntityType } from '../../types/layout';

const BG_COLOR = 0x14181f;
const GRID_LINE = 0x2a2f3a;
const INTERNAL_BORDER = 0xf28e2b;
const LINE_ITEM = 0xf2b84e; // 벨트(item) 라우팅 선
const LINE_FLUID = 0x76b7b2; // 파이프(fluid) 라우팅 선

const MIN_SCALE = 1;
const MAX_SCALE = 120;

/** 엔티티 종류별 색 — 메인 그리드와 비슷한 톤. */
const TYPE_COLORS: Partial<Record<EntityType, number>> = {
  [EntityType.Assembler]: 0x4e79a7,
  [EntityType.Furnace]: 0x6a8cc7,
  [EntityType.Belt]: 0x9aa0a6,
  [EntityType.UndergroundBelt]: 0x6b7077,
  [EntityType.Splitter]: 0x9aa0a6,
  [EntityType.Inserter]: 0xedc948,
  [EntityType.LongInserter]: 0xd4b53f,
  [EntityType.Pipe]: 0x76b7b2,
  [EntityType.PipeUnderground]: 0x4f807c,
  [EntityType.InfinityChest]: 0x59a14f,
  [EntityType.InfinityPipe]: 0x4f9bd0,
  [EntityType.Chest]: 0x59a14f,
};
const DEFAULT_CELL = 0x556677;

export type Bbox = { x: number; y: number; w: number; h: number };

/** 라우팅 연결선 — 끝점은 layout(셀) 좌표. fluid 면 파이프 색. */
export interface VizLine {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  fluid: boolean;
}

interface View {
  scale: number;
  offX: number;
  offY: number;
}

export class VizRenderer {
  private app: PIXI.Application | null = null;
  private layer: PIXI.Container | null = null;
  private destroyed = false;
  private readonly host: HTMLElement;

  // 현재 뷰 변환 (없으면 다음 render 에서 fit 으로 초기화)
  private view: View | null = null;
  // 마지막 그린 내용 — 줌/팬 시 재사용
  private lastPlaced: ReadonlyArray<PlacedCell> = [];
  private lastCamera: Bbox | undefined;
  private lastInternalBbox: Bbox | undefined;
  private lastLines: ReadonlyArray<VizLine> = [];
  private cameraKey = '';

  // 드래그 팬 상태
  private panning = false;
  private panLast = { x: 0, y: 0 };

  // 이벤트 핸들러 (destroy 시 해제용)
  private onWheel = (e: WheelEvent) => this.handleWheel(e);
  private onPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private onPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
  private onPointerUp = (e: PointerEvent) => this.handlePointerUp(e);
  private onDblClick = () => this.resetView();

  constructor(host: HTMLElement) {
    this.host = host;
  }

  async init(): Promise<void> {
    const app = new PIXI.Application();
    await app.init({
      background: BG_COLOR,
      resizeTo: this.host,
      antialias: false,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    // init 도중 unmount 된 경우 폐기
    if (this.destroyed) {
      try {
        app.destroy(true, { children: true });
      } catch {
        /* ignore */
      }
      return;
    }
    this.app = app;
    const canvas = app.canvas as HTMLCanvasElement;
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    this.host.appendChild(canvas);
    this.layer = new PIXI.Container();
    app.stage.addChild(this.layer);

    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerUp);
    canvas.addEventListener('dblclick', this.onDblClick);
  }

  get ready(): boolean {
    return !!this.app && !!this.layer;
  }

  /**
   * 한 단계의 placed 셀을 그린다.
   * @param placed   현재 단계의 셀 (internal + external 합친 raw 좌표)
   * @param camera   카메라를 맞출 bbox (보통 전체 과정의 합집합)
   * @param internalBbox 내부(블루프린트) 영역 — 주황 테두리로 강조 (선택)
   */
  render(
    placed: ReadonlyArray<PlacedCell>,
    camera: Bbox | undefined,
    internalBbox?: Bbox,
    lines: ReadonlyArray<VizLine> = [],
  ): void {
    this.lastPlaced = placed;
    this.lastCamera = camera;
    this.lastInternalBbox = internalBbox;
    this.lastLines = lines;

    // 카메라(전체 bbox)가 바뀌면 뷰를 fit 으로 재초기화. 같은 트레이스 내
    // 단계 이동에서는 사용자가 조정한 뷰를 유지한다.
    const key = camera
      ? `${camera.x},${camera.y},${camera.w},${camera.h}`
      : '';
    if (key !== this.cameraKey) {
      this.cameraKey = key;
      this.view = null;
    }
    this.draw();
  }

  /** fit 으로 뷰 리셋 (더블클릭). */
  resetView(): void {
    this.view = null;
    this.draw();
  }

  // ── 내부 ────────────────────────────────────────────────────────────────

  private screenSize(): { w: number; h: number } {
    if (!this.app) return { w: 0, h: 0 };
    const res = this.app.renderer.resolution;
    return {
      w: this.app.renderer.width / res,
      h: this.app.renderer.height / res,
    };
  }

  /** camera bbox 를 화면에 맞추는 fit 뷰 계산. */
  private fitView(camera: Bbox): View {
    const { w: screenW, h: screenH } = this.screenSize();
    const pad = 28;
    const scale = Math.max(
      MIN_SCALE,
      Math.min(
        (screenW - pad * 2) / camera.w,
        (screenH - pad * 2) / camera.h,
      ),
    );
    const offX =
      pad + (screenW - pad * 2 - camera.w * scale) / 2 - camera.x * scale;
    const offY =
      pad + (screenH - pad * 2 - camera.h * scale) / 2 - camera.y * scale;
    return { scale, offX, offY };
  }

  private draw(): void {
    if (!this.app || !this.layer) return;
    for (const child of this.layer.removeChildren()) child.destroy();

    const camera = this.lastCamera;
    if (!camera || camera.w <= 0 || camera.h <= 0) return;
    if (!this.view) this.view = this.fitView(camera);
    const view = this.view;

    const toPx = (gx: number, gy: number) => ({
      px: gx * view.scale + view.offX,
      py: gy * view.scale + view.offY,
    });

    // 격자선
    const grid = new PIXI.Graphics();
    for (let gx = camera.x; gx <= camera.x + camera.w; gx++) {
      const a = toPx(gx, camera.y);
      const b = toPx(gx, camera.y + camera.h);
      grid.moveTo(a.px, a.py).lineTo(b.px, b.py);
    }
    for (let gy = camera.y; gy <= camera.y + camera.h; gy++) {
      const a = toPx(camera.x, gy);
      const b = toPx(camera.x + camera.w, gy);
      grid.moveTo(a.px, a.py).lineTo(b.px, b.py);
    }
    grid.stroke({ width: 1, color: GRID_LINE, alpha: 0.6 });
    this.layer.addChild(grid);

    // 셀
    const cells = new PIXI.Graphics();
    for (const p of this.lastPlaced) {
      const color = TYPE_COLORS[p.cell.entityType] ?? DEFAULT_CELL;
      const { px, py } = toPx(p.x, p.y);
      cells.rect(px + 0.5, py + 0.5, view.scale - 1, view.scale - 1);
      cells.fill({ color, alpha: p.cell.isOrigin ? 0.95 : 0.78 });
    }
    this.layer.addChild(cells);

    // 라우팅 연결선 (producer 중심 → consumer 중심) + consumer 쪽 화살표
    if (this.lastLines.length > 0) {
      const lineGfx = new PIXI.Graphics();
      const head = Math.max(4, view.scale * 0.32);
      for (const ln of this.lastLines) {
        const color = ln.fluid ? LINE_FLUID : LINE_ITEM;
        const a = toPx(ln.ax, ln.ay);
        const b = toPx(ln.bx, ln.by);
        // 선 (후광 + 본선)
        lineGfx.moveTo(a.px, a.py).lineTo(b.px, b.py).stroke({ width: 4, color, alpha: 0.18 });
        lineGfx.moveTo(a.px, a.py).lineTo(b.px, b.py).stroke({ width: 1.6, color, alpha: 0.95 });
        // producer 끝 점
        lineGfx.circle(a.px, a.py, Math.max(2, view.scale * 0.12)).fill({ color, alpha: 0.9 });
        // consumer 쪽 화살표
        const dx = b.px - a.px;
        const dy = b.py - a.py;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const px = -uy;
        const py = ux;
        const tipX = b.px - ux * head * 0.4;
        const tipY = b.py - uy * head * 0.4;
        lineGfx
          .moveTo(tipX, tipY)
          .lineTo(tipX - ux * head + px * head * 0.5, tipY - uy * head + py * head * 0.5)
          .lineTo(tipX - ux * head - px * head * 0.5, tipY - uy * head - py * head * 0.5)
          .lineTo(tipX, tipY)
          .fill({ color, alpha: 0.95 });
      }
      this.layer.addChild(lineGfx);
    }

    // 내부(블루프린트) 영역 테두리
    const ib = this.lastInternalBbox;
    if (ib && ib.w > 0 && ib.h > 0) {
      const border = new PIXI.Graphics();
      const tl = toPx(ib.x, ib.y);
      border.rect(tl.px, tl.py, ib.w * view.scale, ib.h * view.scale);
      border.stroke({ width: 2, color: INTERNAL_BORDER, alpha: 0.8 });
      this.layer.addChild(border);
    }
  }

  private canvasCoords(e: { clientX: number; clientY: number }): { x: number; y: number } {
    if (!this.app) return { x: 0, y: 0 };
    const rect = (this.app.canvas as HTMLCanvasElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    if (!this.view) return;
    const { x: cx, y: cy } = this.canvasCoords(e);
    const view = this.view;
    // 커서 위치를 고정점으로 줌
    const worldX = (cx - view.offX) / view.scale;
    const worldY = (cy - view.offY) / view.scale;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor));
    view.scale = newScale;
    view.offX = cx - worldX * newScale;
    view.offY = cy - worldY * newScale;
    this.draw();
  }

  private handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0 && e.button !== 1) return;
    this.panning = true;
    this.panLast = { x: e.clientX, y: e.clientY };
    const canvas = this.app?.canvas as HTMLCanvasElement | undefined;
    if (canvas) {
      canvas.style.cursor = 'grabbing';
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.panning || !this.view) return;
    const dx = e.clientX - this.panLast.x;
    const dy = e.clientY - this.panLast.y;
    this.panLast = { x: e.clientX, y: e.clientY };
    this.view.offX += dx;
    this.view.offY += dy;
    this.draw();
  }

  private handlePointerUp(e: PointerEvent): void {
    this.panning = false;
    const canvas = this.app?.canvas as HTMLCanvasElement | undefined;
    if (canvas) {
      canvas.style.cursor = 'grab';
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.app) {
      const canvas = this.app.canvas as HTMLCanvasElement;
      canvas.removeEventListener('wheel', this.onWheel);
      canvas.removeEventListener('pointerdown', this.onPointerDown);
      canvas.removeEventListener('pointermove', this.onPointerMove);
      canvas.removeEventListener('pointerup', this.onPointerUp);
      canvas.removeEventListener('pointerleave', this.onPointerUp);
      canvas.removeEventListener('dblclick', this.onDblClick);
      try {
        canvas.parentElement?.removeChild(canvas);
        this.app.destroy(true, { children: true });
      } catch {
        /* ignore */
      }
      this.app = null;
    }
    this.layer = null;
  }
}
