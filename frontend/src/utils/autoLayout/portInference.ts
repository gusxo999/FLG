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
  // infinity-pipe 는 1×1 일반 파이프와 동등 — 4면 모두 fluid port.
  // 게임데이터에 prototype 자체가 export 되지 않을 수 있어 (export-gamedata.lua
  // 의 ALL_TYPES 에 미포함) `entity.fluid_boxes` 에 의존할 수 없다.
  if (c.kind === 'infinity-pipe') {
    return synthesizeCardinalFluidPorts(c, fluidName);
  }

  const entity: Entity | undefined = useGameDataStore.getState().entityMap.get(c.entityName);
  if (!entity?.fluid_boxes) return [];

  const ports: ContainerPort[] = [];
  for (const fb of entity.fluid_boxes) {
    // fb.filter 가 명시되어 있으면 fluid 이름 일치만 후보. 없으면 통과 — 어떤
    // fluid 든 들어올 수 있는 box (assembler/refinery 의 generic fluid_box).
    if (fb.filter && fb.filter !== fluidName) continue;
    for (const conn of fb.connections) {
      const pos = conn.positions?.[0];
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue;
      const port = portFromFluidBoxPosition(c, pos, fluidName);
      if (port) ports.push(port);
    }
  }
  return ports;
}

/**
 * fluid_box position 을 컨테이너 외부 셀 + face 로 변환.
 *
 * **Factorio 의 fluid_box.connections[].positions** 는 entity center 기준의
 * *boundary 좌표* (= 0.5 타일 단위) 다. 단순히 `floor(center + pos)` 하면
 * entity 의 *내부 셀* 로 떨어지는 경우가 흔하다 (예: chemical-plant 의 코너
 * 입력). 따라서 **pos 의 부호** 로 어느 면인지 먼저 결정하고, 그 면 외부의
 * 적절한 셀로 매핑한다:
 *
 *  - `|pos.y| ≥ |pos.x|` : N (pos.y < 0) 또는 S (pos.y > 0). 셀 x 는 center +
 *    pos.x 가 가리키는 footprint 안의 한 칸으로 결정 (corner 케이스 포함).
 *  - 그 외             : W (pos.x < 0) 또는 E (pos.x > 0). 셀 y 는 center +
 *    pos.y 가 가리키는 footprint 안의 한 칸.
 *
 * 결과 셀은 항상 footprint *바로 바깥* 에 있고 face 와 일치.
 */
function portFromFluidBoxPosition(
  c: Container,
  pos: { x: number; y: number },
  fluidName: string,
): ContainerPort | null {
  const { x: ox, y: oy } = c.origin;
  const { w, h } = c.size;
  const portKind: PortKind = { fluid: fluidName };

  if (Math.abs(pos.y) >= Math.abs(pos.x)) {
    // N / S 면 — pos.y 의 부호로 결정.
    const localX = clamp(Math.floor(w / 2 + pos.x), 0, w - 1);
    if (pos.y < 0) {
      return { containerId: c.id, cell: { x: ox + localX, y: oy - 1 }, face: 'N', kind: portKind };
    }
    if (pos.y > 0) {
      return { containerId: c.id, cell: { x: ox + localX, y: oy + h }, face: 'S', kind: portKind };
    }
    return null; // pos.y === 0 && |pos.x| ≤ |pos.y| === 0 → 중앙. 일반 fluid_box 에서 발생하지 않음.
  }
  // W / E 면 — pos.x 의 부호로 결정.
  const localY = clamp(Math.floor(h / 2 + pos.y), 0, h - 1);
  if (pos.x < 0) {
    return { containerId: c.id, cell: { x: ox - 1, y: oy + localY }, face: 'W', kind: portKind };
  }
  return { containerId: c.id, cell: { x: ox + w, y: oy + localY }, face: 'E', kind: portKind };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function containerCenter(c: Container): { x: number; y: number } {
  return { x: c.origin.x + c.size.w / 2, y: c.origin.y + c.size.h / 2 };
}

/**
 * infinity-pipe (1×1) 의 4면 fluid port 를 합성. fb.filter 미적용 — 어떤 fluid 든
 * 흐를 수 있는 일반 파이프 가정 (실제 Factorio 의 infinity-pipe 도 동일).
 */
function synthesizeCardinalFluidPorts(c: Container, fluidName: string): ContainerPort[] {
  const { x: ox, y: oy } = c.origin;
  const portKind: PortKind = { fluid: fluidName };
  return [
    { containerId: c.id, cell: { x: ox,     y: oy - 1 }, face: 'N', kind: portKind },
    { containerId: c.id, cell: { x: ox,     y: oy + 1 }, face: 'S', kind: portKind },
    { containerId: c.id, cell: { x: ox - 1, y: oy     }, face: 'W', kind: portKind },
    { containerId: c.id, cell: { x: ox + 1, y: oy     }, face: 'E', kind: portKind },
  ];
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
