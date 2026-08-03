/**
 * 모듈 3a — port 유추 (그리디).
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §2.2.
 *
 * 두 컨테이너 (producer, consumer) 의 *상대 위치* 를 보고 가장 가까운 면의
 * port 를 자동 선택한다. 라우팅이 실패하면 호출자가 본 함수의 결정을 무시하고
 * 다른 port 셀을 시도할 수 있다 (routeFallback 의 enumeration 폴백).
 *
 * 우선순위:
 *  1. 두 컨테이너의 origin 중심을 잇는 벡터로 가장 가까운 두 면을 선택.
 *  2. 같은 면 안에서는 마주보는 셀 페어 중 가장 가까운 쌍.
 *  3. fluid kind 면 fluid_boxes positions 의 셀만 후보 — 둘레 셀 전체가
 *     아니라 *고정된 셀* 만 사용 가능.
 */

import { useGameDataStore } from '../../UI/store/gameDataStore';
import type { Entity } from '../../UI/store/gameDataStore';
import { resolveFluidConnection } from '../module/fluidPorts';
import type {
  Container,
  ContainerPort,
  PortFace,
  PortKind,
  PortPair,
  ResolvePortPair,
} from '../containerModel';

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
  const producerPorts = enumerateContainerPorts(producer, kind, 'producer');
  const consumerPorts = enumerateContainerPorts(consumer, kind, 'consumer');
  if (producerPorts.length === 0 || consumerPorts.length === 0) return null;

  // 두 컨테이너의 *중심* (entity center, in tile coords) 을 잇는 벡터로 가장
  // 가까운 두 face 를 결정. 이 면의 port 만 후보로 좁힌다.
  //
  // **유체는 좁히지 않는다.** 아이템은 둘레 아무 칸이나 쓸 수 있어서 "마주 보는 면"으로
  // 좁히는 게 이득이지만, 유체는 fluid_box 가 면을 **강제**한다. 두 규칙이 부딪히면
  // 후보가 0개가 되어 null 이 나오고, 그 뒤엔 enumeration 폴백이 우연히 메워줄 뿐이다.
  // 유체는 이미 후보가 몇 개 없으니(용도로 걸렀다) 그냥 전부 놓고 가장 가까운 쌍을 고른다.
  const isFluid = kind !== 'item';
  const producerCenter = containerCenter(producer);
  const consumerCenter = containerCenter(consumer);
  const dx = consumerCenter.x - producerCenter.x;
  const dy = consumerCenter.y - producerCenter.y;
  const producerFace: PortFace = pickFaceForVector(dx, dy);
  const consumerFace: PortFace = oppositeFace(producerFace);

  const pProds = isFluid ? producerPorts : producerPorts.filter((p) => p.face === producerFace);
  const cProds = isFluid ? consumerPorts : consumerPorts.filter((p) => p.face === consumerFace);
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
 *                 없으면 `role` 로 **용도(production_type)** 를 걸러 후보를 정한다.
 *                 회전은 미고려.
 *
 * @param role 이 컨테이너가 이 흐름에서 맡은 역할. **유체에서만 의미가 있다** —
 *   유체 상자는 재료용(input)과 결과물용(output)이 물리적으로 **다른 칸**이라
 *   섞으면 안 된다. 미지정이면 안 거른다(하위호환·드래그 재라우팅 등).
 */
export function enumerateContainerPorts(
  container: Container,
  kind: PortKind,
  role?: 'producer' | 'consumer',
): ContainerPort[] {
  if (kind === 'item') {
    return itemPorts(container);
  }
  return fluidPorts(container, kind.fluid, role);
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

function fluidPorts(
  c: Container,
  fluidName: string,
  role?: 'producer' | 'consumer',
): ContainerPort[] {
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
    // **용도(production_type)로 거른다.** 유체 상자는 재료를 받는 칸과 결과물을 뱉는 칸이
    // 물리적으로 다르다(화학 공장: 입력 N면 2칸, 출력 S면 2칸). 이걸 안 보면 재료 파이프가
    // **출력 칸에 꽂혀** 머신이 굶는다 — 겉보기엔 파이프가 멀쩡히 이어져 있어서 조용하다.
    // (2026-07-13 실측: petroleum-gas 가 plastic-bar 화학 공장의 S면=출력 칸으로 들어갔다.)
    // "input-output" 은 양쪽 다 가능(보일러 가열 모드 등) → 통과. docs/fluid-box-semantics.md
    if (role && !fluidBoxAllows(fb.production_type, role)) continue;
    for (const conn of fb.connections) {
      const placed = resolveFluidConnection(conn, c.size, c.direction ?? 0);
      if (!placed) continue;
      ports.push(portFromFace(c, placed.face, placed.offset, fluidName));
    }
  }
  return ports;
}

/**
 * (면, 면 위 오프셋) → 컨테이너 *바로 바깥* 셀.
 *
 * 면과 오프셋은 `resolveFluidConnection` 이 낸다 — 면은 게임데이터의
 * `PipeConnection.direction` 에서 그대로 오고, 좌표에서 추정하지 않는다.
 * (왜 추정이 불가능한지는 module/fluidPorts.ts 머리말: 유체 상자는 **모서리 칸**이라
 *  좌표만으론 위로 나가는지 옆으로 나가는지 갈리지 않는다.)
 */
function portFromFace(
  c: Container,
  face: PortFace,
  offset: number,
  fluidName: string,
): ContainerPort {
  const { x: ox, y: oy } = c.origin;
  const { w, h } = c.size;
  const kind: PortKind = { fluid: fluidName };
  const cell =
    face === 'N' ? { x: ox + offset, y: oy - 1 }
    : face === 'S' ? { x: ox + offset, y: oy + h }
    : face === 'W' ? { x: ox - 1, y: oy + offset }
    : { x: ox + w, y: oy + offset };
  return { containerId: c.id, cell, face, kind };
}

/**
 * 이 유체 상자를 이 역할로 쓸 수 있나 — 게임플레이 용도(`production_type`) 기준.
 *
 * `flow_direction`(물리 흐름)이 아니라 `production_type`(레시피에서의 용도)을 본다.
 * 우리가 묻는 건 "파이프가 흐를 수 있나"가 아니라 **"이 칸이 재료를 받는 칸이냐"** 다.
 * → docs/fluid-box-semantics.md
 *
 * 미지정(`undefined`)은 거르지 않는다 — 파이프·펌프처럼 용도가 없는 엔티티가 있고,
 * 없는 정보를 근거로 후보를 지우면 조용히 라우팅이 실패한다.
 */
function fluidBoxAllows(
  productionType: string | undefined,
  role: 'producer' | 'consumer',
): boolean {
  if (!productionType || productionType === 'none') return true;
  if (productionType === 'input-output') return true; // 보일러 가열 모드 등 — 양쪽 다.
  return role === 'producer' ? productionType === 'output' : productionType === 'input';
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
