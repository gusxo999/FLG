/**
 * 유체 관망 — 파이프를 관망으로 묶고, 머신의 유체 상자가 어느 관망에 닿는지 찾는다.
 *
 * **관망 하나 = 용량 무한의 풀**이다(`pipe-semantics` §2 — *"세그먼트 안에서 유량이 무제한"*).
 * 그래서 벨트처럼 레인·순서를 셀 일이 없고, 관망마다 *누가 넣고 누가 빼나* 만 알면 된다.
 * 모자라면 나눠 갖는다(비례) — 2.0 의 유체 세그먼트는 우선순위가 없다고 본다.
 *
 * 연결 규칙(`analysis/pipeNetwork` 와 같다 — 렌더러의 관망 색이 쓰는 그 규칙):
 *  - 파이프 · 무한파이프는 네 면 전부, 지하 파이프는 지표 쪽 한 면(`direction`)으로 닿는다
 *  - 지하 파이프는 `direction` 의 반대쪽으로 `max_underground_distance` 안의 마주 보는 짝과 잇는다
 *  - 머신은 **유체 상자의 연결 칸**에서만 닿는다 — 면은 `PipeConnection.direction` 이 정하고
 *    (`fluid-box-semantics`), 그 읽기는 배치기와 같은 함수(`module/gamedata.resolveFluidConnection`)를
 *    쓴다. 규칙이 두 벌이면 한쪽만 고쳐지고 다른 쪽이 조용히 틀린다.
 *
 * 레시피 유체가 어느 유체 상자로 가는지는 `fluidbox_index`(역할별 1-based)가 있으면 그 상자, 없으면
 * **그 역할의 상자 전부**다(`pipe-semantics` §4).
 */

import { EntityType, type Direction, type GridCell, type LayoutGrid } from '../../types/layout';
import type { InfinityPipeSettings } from '../../types/blueprint';
import type { Entity } from '../../types/gameData';
import { resolveFluidConnection } from '../../autoLayout/module/gamedata';
import { dirVec } from './gamedata';
import type { FlowCtx } from './types';

export interface FluidNet {
  /** 무한 공급하는 유체. */
  infiniteSupply: Set<string>;
  /** 무한 회수하는 유체. `'*'` 이면 무엇이든. */
  infiniteSink: Set<string>;
}

/** 머신 하나가 유체로 닿는 곳 — 유체 이름 → 그 유체가 드나들 수 있는 관망들. */
export interface MachineFluidPorts {
  in: Map<string, Set<number>>;
  out: Map<string, Set<number>>;
  /** 유체를 쓰는데 게임데이터가 연결을 말해 주지 않는다(유체 상자 · 연결 방향 없음). */
  unresolved: boolean;
}

export interface FluidGraph {
  nets: FluidNet[];
}

const PIPE_TYPES: ReadonlySet<string> = new Set<string>([
  EntityType.Pipe,
  EntityType.PipeUnderground,
  EntityType.InfinityPipe,
]);

const opposite = (d: Direction) => ((d + 8) % 16) as Direction;
const FACE_DIR: Record<string, Direction> = { N: 0, E: 4, S: 8, W: 12 };

/** 파이프 칸이 이 면으로 닿나. 지하 파이프는 지표 쪽 한 면뿐. */
function opensTo(c: GridCell, side: Direction): boolean {
  return c.entityType !== EntityType.PipeUnderground || c.direction === side;
}

/** 관망 묶기 — 칸 키(`y*w+x`) → 관망 번호. */
export function buildFluidNets(grid: Readonly<LayoutGrid>, ctx: FlowCtx): { nets: FluidNet[]; netAt: Map<number, number> } {
  const { width, height, cells } = grid;
  const isPipe = (i: number) => {
    const c = cells[i];
    if (!c || !PIPE_TYPES.has(c.entityType)) return false;
    // 열 파이프(heat-pipe)는 EntityType.Pipe 로 들어오지만 유체가 아니다.
    return (c.entityName ? ctx.entityMap.get(c.entityName)?.type : undefined) !== 'heat-pipe';
  };
  const parent = new Map<number, number>();
  const find = (a: number): number => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let x = a;
    while (parent.get(x) !== r) { const n = parent.get(x)!; parent.set(x, r); x = n; }
    return r;
  };
  const union = (a: number, b: number) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  for (let i = 0; i < cells.length; i++) if (isPipe(i)) parent.set(i, i);
  for (const i of parent.keys()) {
    const c = cells[i];
    const x = i % width;
    const y = (i - x) / width;
    for (const side of [0, 4, 8, 12] as Direction[]) {
      if (!opensTo(c, side)) continue;
      const v = dirVec(side);
      const nx = x + v.x;
      const ny = y + v.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (!parent.has(j) || !opensTo(cells[j], opposite(side))) continue;
      union(i, j);
    }
    if (c.entityType === EntityType.PipeUnderground) {
      // 터널은 지표 쪽의 반대로 간다. 같은 방향 지하 파이프를 만나면 막힌다.
      const back = opposite(c.direction);
      const v = dirVec(back);
      const max = (c.entityName ? ctx.entityMap.get(c.entityName)?.max_underground_distance : undefined) ?? 10;
      for (let k = 1; k <= max; k++) {
        const tx = x + v.x * k;
        const ty = y + v.y * k;
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) break;
        const o = cells[ty * width + tx];
        if (!o || o.entityType !== EntityType.PipeUnderground) continue;
        if (o.direction === back) { union(i, ty * width + tx); break; }
        if (o.direction === c.direction) break;
      }
    }
  }

  const netOfRoot = new Map<number, number>();
  const nets: FluidNet[] = [];
  const netAt = new Map<number, number>();
  for (const i of parent.keys()) {
    const r = find(i);
    let n = netOfRoot.get(r);
    if (n === undefined) {
      n = nets.length;
      netOfRoot.set(r, n);
      nets.push({ infiniteSupply: new Set(), infiniteSink: new Set() });
    }
    netAt.set(i, n);
    const c = cells[i];
    if (c.entityType === EntityType.InfinityPipe) {
      const s = c.infinitySettings as InfinityPipeSettings | undefined;
      const mode = s?.mode ?? 'at-least';
      if (s?.name && (mode === 'at-least' || mode === 'exactly' || mode === 'add') && (s.percentage ?? 1) > 0) {
        nets[n].infiniteSupply.add(s.name);
      }
      if (mode === 'at-most' || mode === 'remove' || mode === 'exactly') nets[n].infiniteSink.add(s?.name ?? '*');
    }
  }
  return { nets, netAt };
}

/**
 * 머신의 유체 상자 → 관망. 레시피 유체마다 드나들 수 있는 관망을 모은다.
 *
 * @param ingredients / products — 레시피의 유체 재료·산출(이름 · `fluidbox_index`).
 */
export function machineFluidPorts(
  grid: Readonly<LayoutGrid>,
  origin: { x: number; y: number; w: number; h: number; cell: GridCell },
  entity: Entity | undefined,
  netAt: Map<number, number>,
  ingredients: { name: string; fluidbox_index?: number }[],
  products: { name: string; fluidbox_index?: number }[],
): MachineFluidPorts {
  const ports: MachineFluidPorts = { in: new Map(), out: new Map(), unresolved: false };
  if (ingredients.length === 0 && products.length === 0) return ports;
  const boxes = entity?.fluid_boxes;
  if (!boxes || boxes.length === 0) {
    ports.unresolved = true;
    return ports;
  }

  // 역할별 서수(1-based) — 레시피의 fluidbox_index 가 세는 방식(`module/gamedata.roleOrdinalOf`).
  const ordinal = (role: 'input' | 'output') => {
    const m = new Map<number, number>();
    let n = 0;
    boxes.forEach((fb, i) => {
      const pt = fb.production_type ?? 'input';
      if (pt === role || pt === 'input-output') m.set(i, ++n);
    });
    return m;
  };
  const ordIn = ordinal('input');
  const ordOut = ordinal('output');

  // 상자마다 닿는 관망
  const netsOfBox = boxes.map((fb) => {
    const found = new Set<number>();
    for (const conn of fb.connections) {
      if (conn.connection_type && conn.connection_type !== 'normal') continue;
      const placed = resolveFluidConnection(conn, { w: origin.w, h: origin.h }, origin.cell.direction);
      if (!placed) {
        ports.unresolved = true;
        continue;
      }
      const { face, offset } = placed;
      const cx = face === 'W' ? origin.x - 1 : face === 'E' ? origin.x + origin.w : origin.x + offset;
      const cy = face === 'N' ? origin.y - 1 : face === 'S' ? origin.y + origin.h : origin.y + offset;
      if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) continue;
      const i = cy * grid.width + cx;
      const n = netAt.get(i);
      if (n === undefined) continue;
      // 지하 파이프는 지표 쪽이 머신을 봐야 닿는다.
      const c = grid.cells[i];
      if (c.entityType === EntityType.PipeUnderground && c.direction !== opposite(FACE_DIR[face])) continue;
      found.add(n);
    }
    return found;
  });

  const assign = (
    list: { name: string; fluidbox_index?: number }[],
    ord: Map<number, number>,
    into: Map<string, Set<number>>,
  ) => {
    for (const f of list) {
      const set = into.get(f.name) ?? new Set<number>();
      boxes.forEach((fb, i) => {
        const k = ord.get(i);
        if (k === undefined) return;
        if (f.fluidbox_index !== undefined && f.fluidbox_index !== k) return;
        if (fb.filter && fb.filter !== f.name) return;
        for (const n of netsOfBox[i]) set.add(n);
      });
      into.set(f.name, set);
    }
  };
  assign(ingredients, ordIn, ports.in);
  assign(products, ordOut, ports.out);
  return ports;
}
