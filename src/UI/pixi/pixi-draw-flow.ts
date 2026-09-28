/**
 * pixi-draw-flow.ts
 *
 * 머신 가동률·포트 실패 표시 — 그리드를 정상상태로 푼 결과(`analysis/flow`)를 캔버스에 얹는다.
 *
 * ```
 * 포트 실패    빨간 굵은 테두리 + **빗금 채움** + "⚠"      그 상자에도 같은 빗금 + ✗
 * 미달         빨간 굵은 테두리 + 옅은 빨간 채움 + "73%"
 * 판정 불가    주황 **점선** 테두리 + "?"
 * 100%         안 그린다
 * ```
 *
 * 색만으로 가르지 않는다 — 모듈 테두리(`pixi-renderer`)와 같은 까닭으로(색각 이상) 채움·무늬·글자를
 * 겹친다. 모듈 테두리가 이미 앰버라 판정 불가는 앰버가 아니라 주황이고, 모듈 테두리는 모듈 bbox 를,
 * 이것은 **머신 footprint 안쪽**을 감싸 크기로도 갈린다.
 *
 * **포트 실패는 미달과 같은 무게로 그린다**(사용자 결정 2026-09-28 — *"실패한 머신입니다"*). 같은 빨강
 * 계열이되 빗금과 `⚠` 로 갈린다: 미달은 *덜 돈다*, 포트 실패는 *그 포트를 아무 데도 못 잇는다*.
 * 가동률이 100% 여도 포트 실패면 실패가 이긴다 — 갇힌 무한상자가 100% 를 만들어 주기 때문이다
 * (`flow-model` §2.6).
 */

import * as PIXI from 'pixi.js';
import type { FlowResult, MachineVerdict } from '../../analysis/flow/types';

export const FLOW_SHORT_COLOR   = 0xff3b3b;
export const FLOW_UNKNOWN_COLOR = 0xff8c1a;
/** 포트 실패 — 미달보다 진한 빨강(빗금·⚠ 와 함께 쓴다). */
export const FLOW_FAIL_COLOR    = 0xff0033;

export function drawFlowOverlay(
  container: PIXI.Container,
  result: FlowResult,
  scaledTile: number,
  offsetX: number,
  offsetY: number,
  view: { x1: number; y1: number; x2: number; y2: number },
): void {
  const inView = (x: number, y: number, w: number, h: number) =>
    x + w > view.x1 && x < view.x2 && y + h > view.y1 && y < view.y2;
  const marked = result.machines.filter(
    (v) => (v.state !== 'full' || v.portFail.length > 0) && inView(v.x, v.y, v.w, v.h),
  );
  const orphans = result.orphanChests.filter((c) => inView(c.x, c.y, 1, 1));
  if (marked.length === 0 && orphans.length === 0) return;

  const g = new PIXI.Graphics();
  container.addChild(g);
  const inset = Math.max(2, scaledTile * 0.1);
  const labels: PIXI.Text[] = [];

  for (const v of marked) {
    const x = v.x * scaledTile + offsetX + inset;
    const y = v.y * scaledTile + offsetY + inset;
    const w = v.w * scaledTile - inset * 2;
    const h = v.h * scaledTile - inset * 2;
    const failed = v.portFail.length > 0;
    if (failed) {
      // 빗금 — 미달의 **옅은 채움**과 한눈에 갈리게. 테두리는 미달보다 굵다.
      g.rect(x, y, w, h).fill({ color: FLOW_FAIL_COLOR, alpha: 0.1 });
      hatch(g, x, y, w, h, Math.max(6, scaledTile * 0.45));
      g.stroke({ width: Math.max(2, scaledTile * 0.07), color: FLOW_FAIL_COLOR, alpha: 0.85 });
      g.rect(x, y, w, h).stroke({ width: Math.max(3, scaledTile * 0.16), color: FLOW_FAIL_COLOR, alpha: 1 });
    } else if (v.state === 'short') {
      g.rect(x, y, w, h).fill({ color: FLOW_SHORT_COLOR, alpha: 0.12 });
      g.rect(x, y, w, h).stroke({ width: Math.max(2.5, scaledTile * 0.12), color: FLOW_SHORT_COLOR, alpha: 1 });
    } else {
      dashedRect(g, x, y, w, h, Math.max(4, scaledTile * 0.3));
      g.stroke({ width: Math.max(2, scaledTile * 0.08), color: FLOW_UNKNOWN_COLOR, alpha: 1 });
    }

    // 글자 — 너무 축소되면 생략(테두리만으로도 보인다).
    if (scaledTile >= 12) {
      labels.push(badge(g, x + w / 2, y + h / 2, labelOf(v), scaledTile, color(v)));
    }
  }

  // 갇힌 상자 — 실패의 **원인 자리**. 머신만 칠하면 어디를 고쳐야 하는지 안 보인다.
  for (const c of orphans) {
    const x = c.x * scaledTile + offsetX + 1;
    const y = c.y * scaledTile + offsetY + 1;
    const s = scaledTile - 2;
    g.rect(x, y, s, s).fill({ color: FLOW_FAIL_COLOR, alpha: 0.35 });
    hatch(g, x, y, s, s, Math.max(4, scaledTile * 0.35));
    g.stroke({ width: Math.max(1.5, scaledTile * 0.06), color: 0xffffff, alpha: 0.9 });
    g.rect(x, y, s, s).stroke({ width: Math.max(2.5, scaledTile * 0.14), color: FLOW_FAIL_COLOR, alpha: 1 });
    // ✗ — 모양으로도 실패임을 알린다(색각 이상 대비).
    const r = s * 0.28;
    const cx = x + s / 2;
    const cy = y + s / 2;
    g.moveTo(cx - r, cy - r).lineTo(cx + r, cy + r)
      .moveTo(cx + r, cy - r).lineTo(cx - r, cy + r)
      .stroke({ width: Math.max(2, scaledTile * 0.09), color: 0xffffff, alpha: 1 });
  }

  for (const l of labels) container.addChild(l);
}

const color = (v: MachineVerdict) =>
  v.portFail.length > 0 ? FLOW_FAIL_COLOR : v.state === 'short' ? FLOW_SHORT_COLOR : FLOW_UNKNOWN_COLOR;

/** 미달은 반올림해도 100 을 못 넘게 — 99.6% 를 "100%" 빨간 테두리로 보이면 거짓이다. */
const labelOf = (v: MachineVerdict) =>
  v.portFail.length > 0 ? '⚠' : v.state === 'short' ? `${Math.min(99, Math.round(v.u * 100))}%` : '?';

/** 가운데 글자 + 뒷판. 뒷판은 `g` 에 그리고 글자는 부르는 쪽이 컨테이너에 올린다(글자가 위). */
function badge(g: PIXI.Graphics, cx: number, cy: number, text: string, scaledTile: number, bg: number): PIXI.Text {
  const label = new PIXI.Text({
    text,
    style: { fontSize: Math.max(9, Math.floor(scaledTile * 0.42)), fill: 0xffffff, fontWeight: 'bold' },
  });
  label.anchor.set(0.5, 0.5);
  label.x = cx;
  label.y = cy;
  const pad = 2;
  g.rect(cx - label.width / 2 - pad, cy - label.height / 2, label.width + pad * 2, label.height)
    .fill({ color: bg, alpha: 0.9 });
  return label;
}

/** 45° 빗금 경로 — 선 긋기는 부르는 쪽이 한다. */
function hatch(g: PIXI.Graphics, x: number, y: number, w: number, h: number, gap: number): void {
  for (let d = -h; d < w; d += gap) {
    const x1 = Math.max(x + d, x);
    const y1 = y + Math.max(-d, 0);
    const x2 = Math.min(x + d + h, x + w);
    const y2 = y1 + (x2 - x1);
    if (x2 <= x1) continue;
    g.moveTo(x1, y1).lineTo(x2, Math.min(y2, y + h));
  }
}

/** 점선 사각형 경로 — PIXI 에 dash 가 없어 변마다 토막을 긋는다. 선 긋기는 부르는 쪽이 한다. */
function dashedRect(g: PIXI.Graphics, x: number, y: number, w: number, h: number, dash: number): void {
  const side = (x1: number, y1: number, x2: number, y2: number) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.round(len / dash));
    for (let i = 0; i < steps; i += 2) {
      const t0 = i / steps;
      const t1 = Math.min(1, (i + 1) / steps);
      g.moveTo(x1 + (x2 - x1) * t0, y1 + (y2 - y1) * t0).lineTo(x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1);
    }
  };
  side(x, y, x + w, y);
  side(x + w, y, x + w, y + h);
  side(x + w, y + h, x, y + h);
  side(x, y + h, x, y);
}
