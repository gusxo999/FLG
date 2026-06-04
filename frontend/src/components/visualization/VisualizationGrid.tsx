/**
 * Visualization — 독립 그리드 캔버스.
 *
 * `VizRenderer`(별도 Pixi 인스턴스)를 마운트하고, 현재 단계의 스냅샷이 바뀔 때마다
 * 다시 그린다. 카메라는 전체 과정의 합집합 bbox 에 고정된다(사용자 줌/팬은 유지).
 *
 * 라우팅 선: 전체 라우팅 목록 중 *양 끝 컨테이너가 현재 단계 스냅샷에 둘 다 존재*
 * 하는 것만 그 단계에서 선으로 그린다 → 단계가 진행되며 선이 점진적으로 등장.
 */

import { useEffect, useRef, useState } from 'react';
import { VizRenderer, type Bbox, type VizLine } from './pixi-viz';
import type { AreaSnapshot, TraceRouting } from '../../utils/autoLayout/containerModel';

interface VisualizationGridProps {
  snapshot: AreaSnapshot | null;
  camera: Bbox | undefined;
  routings: TraceRouting[];
}

export default function VisualizationGrid({ snapshot, camera, routings }: VisualizationGridProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<VizRenderer | null>(null);
  // init 은 비동기라 완료 시점에 첫 렌더를 트리거하기 위한 플래그
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hostRef.current) return;
    const renderer = new VizRenderer(hostRef.current);
    rendererRef.current = renderer;
    let cancelled = false;
    renderer.init().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
      renderer.destroy();
      rendererRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!ready || !renderer || !renderer.ready) return;
    if (!snapshot) {
      renderer.render([], camera);
      return;
    }
    const placed = [...snapshot.internal.placed, ...snapshot.external.placed];
    const lines = computeLines(snapshot, routings);
    renderer.render(placed, camera, snapshot.internal.bbox, lines);
  }, [snapshot, camera, routings, ready]);

  return <div ref={hostRef} className="w-full h-full" />;
}

/** 현재 단계 스냅샷에 양 끝 컨테이너가 모두 있는 라우팅만 선으로 변환. */
function computeLines(snapshot: AreaSnapshot, routings: TraceRouting[]): VizLine[] {
  const center = new Map<string, { x: number; y: number }>();
  for (const c of [...snapshot.internal.containers, ...snapshot.external.containers]) {
    center.set(c.id, {
      x: c.origin.x + c.size.w / 2,
      y: c.origin.y + c.size.h / 2,
    });
  }
  const lines: VizLine[] = [];
  for (const r of routings) {
    const a = center.get(r.fromId);
    const b = center.get(r.toId);
    if (a && b) lines.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, fluid: r.fluid });
  }
  return lines;
}
