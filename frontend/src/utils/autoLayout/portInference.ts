/**
 * 모듈 3a — port 유추 (그리디).
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §5 / §7.4 / Q21.
 *
 * 두 컨테이너 (producer, consumer) 의 *상대 위치* 를 보고 가장 가까운 면의
 * port 를 자동 선택한다. 라우팅이 실패하면 오케스트레이터가 본 함수의 결정을
 * 무시하고 다른 port 셀을 시도할 수 있다 (placement-search §7.4 fallback).
 *
 * 우선순위:
 *  1. 두 컨테이너의 origin 중심을 잇는 벡터로 가장 가까운 두 면을 선택.
 *  2. 같은 면 안에서는 마주보는 셀 페어 중 가장 가까운 쌍.
 *  3. fluid kind 면 fluid_boxes positions 의 셀만 후보 — 둘레 셀 전체가
 *     아니라 *고정된 셀* 만 사용 가능.
 */

import { useGameDataStore } from '../../store/gameDataStore';
import type { Entity } from '../../store/gameDataStore';
import type {
  Container,
  ContainerPort,
  PortFace,
  PortKind,
  PortPair,
  ResolvePortPair,
} from './containerModel';

/**
 * 그리디 port 매칭. 실패 시 null (예: fluid kind 인데 한쪽 컨테이너에
 * 해당 fluid 의 fluid_boxes 가 없음, 또는 두 컨테이너의 마주보는 면 후보가
 * 같은 면이 아닌 케이스).
 */
export const resolvePortPair: ResolvePortPair = (
  producer: Container,
  consumer: Container,
  kind: PortKind,
): PortPair | null => {
  const producerPorts = enumerateContainerPorts(producer, kind);
  const consumerPorts = enumerateContainerPorts(consumer, kind);
  if (producerPorts.length === 0 || consumerPorts.length === 0) return null;

  // 두 컨테이너의 *중심* (entity center, in tile coords) 을 잇는 벡터로 가장
  // 가까운 두 face 를 결정. 이 면의 port 만 후보로 좁힌다.
  const producerCenter = containerCenter(producer);
  const consumerCenter = containerCenter(consumer);
  const dx = consumerCenter.x - producerCenter.x;
  const dy = consumerCenter.y - producerCenter.y;
  const producerFace: PortFace = pickFaceForVector(dx, dy);
  const consumerFace: PortFace = oppositeFace(producerFace);

  const pProds = producerPorts.filter((p) => p.face === producerFace);
  const cProds = consumerPorts.filter((p) => p.face === consumerFace);
  if (pProds.length === 0 || cProds.length === 0) return null;

  // 면 안에서 마주보는 셀 페어 중 manhattan 거리가 최소인 쌍.
  let best: PortPair | null = null;
  let bestDist = Infinity;
  for (const a of pProds) {
    for (const b of cProds) {
      const d = Math.abs(a.cell.x - b.cell.x) + Math.abs(a.cell.y - b.cell.y);
      if (d < bestDist) {
        bestDist = d;
        best = { producer: a, consumer: b };
      }
    }
  }
  return best;
};

/**
 * fallback 시도용 — 한 컨테이너의 *모든* port 를 enumerate.
 * 오케스트레이터가 router 실패 시 cross product 로 재시도.
 *
 * - item kind   : footprint 둘레의 모든 셀 (= 2(w + h) 개, 코너 제외).
 * - fluid:<name>: fluid_boxes[].connections[].positions[0] (= direction 0 = N) 의
 *                 셀. fb.filter 가 있으면 fluid 이름 일치하는 box 만,
 *                 없으면 모든 fluid_box 가 후보. 회전은 미고려.
 */
export function enumerateContainerPorts(
  container: Container,
  kind: PortKind,
): ContainerPort[] {
  if (kind === 'item') {
    return itemPorts(container);
  }
  return fluidPorts(container, kind.fluid);
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function itemPorts(c: Container): ContainerPort[] {
  const ports: ContainerPort[] = [];
  const { x: ox, y: oy } = c.origin;
  const { w, h } = c.size;
  // N 면 — 위쪽 한 줄 (y = oy - 1, x = ox..ox+w-1).
  for (let dx = 0; dx < w; dx++) {
    ports.push({ containerId: c.id, cell: { x: ox + dx, y: oy - 1 }, face: 'N', kind: 'item' });
  }
  // S 면 — 아래쪽 한 줄 (y = oy + h, x = ox..ox+w-1).
  for (let dx = 0; dx < w; dx++) {
    ports.push({ containerId: c.id, cell: { x: ox + dx, y: oy + h }, face: 'S', kind: 'item' });
  }
  // W 면 — 왼쪽 한 줄 (x = ox - 1, y = oy..oy+h-1).
  for (let dy = 0; dy < h; dy++) {
    ports.push({ containerId: c.id, cell: { x: ox - 1, y: oy + dy }, face: 'W', kind: 'item' });
  }
  // E 면 — 오른쪽 한 줄 (x = ox + w, y = oy..oy+h-1).
  for (let dy = 0; dy < h; dy++) {
    ports.push({ containerId: c.id, cell: { x: ox + w, y: oy + dy }, face: 'E', kind: 'item' });
  }
  return ports;
}

function fluidPorts(c: Container, fluidName: string): ContainerPort[] {
  const entity: Entity | undefined = useGameDataStore.getState().entityMap.get(c.entityName);
  if (!entity?.fluid_boxes) return [];

  // 엔티티 중심 (tile coords). 3×3 origin (0,0) → center (1.5, 1.5).
  const center = containerCenter(c);
  const ports: ContainerPort[] = [];

  for (const fb of entity.fluid_boxes) {
    // fb.filter 가 명시되어 있으면 fluid 이름 일치만 후보. 없으면 통과 — 어떤
    // fluid 든 들어올 수 있는 box (assembler/refinery 의 generic fluid_box).
    if (fb.filter && fb.filter !== fluidName) continue;
    for (const conn of fb.connections) {
      const pos = conn.positions?.[0];
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue;
      // positions 는 entity center 기준 *tile-center 좌표 offset*.
      // 셀 (정수 top-left) 로 환산: floor(center + offset).
      const cell = {
        x: Math.floor(center.x + pos.x),
        y: Math.floor(center.y + pos.y),
      };
      const face = inferFace(c, cell);
      if (!face) continue; // 컨테이너 내부 셀은 port 가 아님 — 방어.
      ports.push({ containerId: c.id, cell, face, kind: { fluid: fluidName } });
    }
  }
  return ports;
}

function containerCenter(c: Container): { x: number; y: number } {
  return { x: c.origin.x + c.size.w / 2, y: c.origin.y + c.size.h / 2 };
}

/**
 * 셀 좌표가 컨테이너의 *어느 면 바깥* 인지 판정. 컨테이너 내부면 null.
 *
 * 코너 셀 (예: 좌상단 대각) 은 인접한 두 면 중 우선 N/S 를 우선 (수직 우선).
 */
function inferFace(c: Container, cell: { x: number; y: number }): PortFace | null {
  const { x: ox, y: oy } = c.origin;
  const { w, h } = c.size;
  if (cell.y < oy) return 'N';
  if (cell.y >= oy + h) return 'S';
  if (cell.x < ox) return 'W';
  if (cell.x >= ox + w) return 'E';
  return null;
}

/** 두 컨테이너 중심을 잇는 벡터에서 가장 가까운 face — 우세 축으로 결정. */
function pickFaceForVector(dx: number, dy: number): PortFace {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'E' : 'W';
  }
  return dy >= 0 ? 'S' : 'N';
}

function oppositeFace(f: PortFace): PortFace {
  switch (f) {
    case 'N': return 'S';
    case 'S': return 'N';
    case 'E': return 'W';
    case 'W': return 'E';
  }
}
