/**
 * pixi-draw-flow.ts
 *
 * 머신 가동률 테두리 — 그리드를 정상상태로 푼 결과(`analysis/flow`)를 캔버스에 얹는다.
 *
 * ```
 * 미달        빨간 굵은 테두리 + 옅은 빨간 채움 + "73%"
 * 판정 불가   주황 **점선** 테두리 + "?"
 * 100%        안 그린다
 * ```
 *
 * 색만으로 가르지 않는다 — 모듈 테두리(`pixi-renderer`)와 같은 까닭으로(색각 이상) 미달은 채움과
 * 숫자, 판정 불가는 점선과 `?` 를 겹친다. 모듈 테두리가 이미 앰버라 판정 불가는 앰버가 아니라
 * 주황이고, 모듈 테두리는 모듈 bbox 를, 이것은 **머신 footprint 안쪽**을 감싸 크기로도 갈린다.
 */

import * as PIXI from 'pixi.js';
import type { FlowResult } from '../../analysis/flow/types';

export const FLOW_SHORT_COLOR   = 0xff3b3b;
export const FLOW_UNKNOWN_COLOR = 0xff8c1a;

export function drawFlowOverlay(
  container: PIXI.Container,
  result: FlowResult,
  scaledTile: number,
  offsetX: number,
  offsetY: number,
  view: { x1: number; y1: number; x2: number; y2: number },
): void {
  const marked = result.machines.filter((v) => v.state !== 'full'
    && v.x + v.w > view.x1 && v.x < view.x2 && v.y + v.h > view.y1 && v.y < view.y2);
  if (marked.length === 0) return;

  const g = new PIXI.Graphics();
  container.addChild(g);
  const inset = Math.max(2, scaledTile * 0.1);
  const labels: PIXI.Text[] = [];

  for (const v of marked) {
    const x = v.x * scaledTile + offsetX + inset;
    const y = v.y * scaledTile + offsetY + inset;
    const w = v.w * scaledTile - inset * 2;
    const h = v.h * scaledTile - inset * 2;
    if (v.state === 'short') {
      g.rect(x, y, w, h).fill({ color: FLOW_SHORT_COLOR, alpha: 0.12 });
      g.rect(x, y, w, h).stroke({ width: Math.max(2.5, scaledTile * 0.12), color: FLOW_SHORT_COLOR, alpha: 1 });
    } else {
      dashedRect(g, x, y, w, h, Math.max(4, scaledTile * 0.3));
      g.stroke({ width: Math.max(2, scaledTile * 0.08), color: FLOW_UNKNOWN_COLOR, alpha: 1 });
    }

    // 숫자 — 너무 축소되면 생략(테두리만으로도 미달은 보인다).
    if (scaledTile >= 12) {
      // 미달은 반올림해도 100 을 못 넘게 — 99.6% 를 "100%" 빨간 테두리로 보이면 거짓이다.
      const text = v.state === 'short' ? `${Math.min(99, Math.round(v.u * 100))}%` : '?';
      const label = new PIXI.Text({
        text,
        style: {
          fontSize: Math.max(9, Math.floor(scaledTile * 0.42)),
          fill: 0xffffff,
          fontWeight: 'bold',
        },
      });
      label.anchor.set(0.5, 0.5);
      label.x = x + w / 2;
      label.y = y + h / 2;
      const pad = 2;
      g.rect(label.x - label.width / 2 - pad, label.y - label.height / 2, label.width + pad * 2, label.height)
        .fill({ color: v.state === 'short' ? FLOW_SHORT_COLOR : FLOW_UNKNOWN_COLOR, alpha: 0.9 });
      labels.push(label);
    }
  }
  for (const l of labels) container.addChild(l);
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
