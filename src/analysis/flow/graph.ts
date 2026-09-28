/**
 * 그리드 → 흐름 그래프.
 *
 * 그리드를 **한 번** 읽어 흐름을 풀 재료로 바꾼다 — 벨트는 레인 노드의 숲, 인서터는 양끝을 아는
 * 팔, 머신·상자는 그 끝. 결정은 없다: 연결 규칙은 전부 게임 규칙이고(`belt-lane-semantics` §2),
 * 우선순위를 고르는 것은 [solve](solve.ts) 가 아니라 여기서 정한 **순서**다(§ 투입 순서).
 *
 * 벨트 연결(`nextOf` · `upstreamOf`)과 인서터 칸 해석은 옛 `beltFlow.ts` 의 것을 그대로 옮겼다.
 */

import {
  EntityType,
  ENTITY_SIZES,
  getCell,
  type Direction,
  type GridCell,
  type LayoutGrid,
} from '../../types/layout';
import {
  MACHINE_TYPES,
  chestRole,
  dirVec,
  inserterCap,
  inserterCells,
  isContainer,
  laneCap,
  machineRates,
  type ChestRole,
  type MachineRates,
} from './gamedata';
import { buildFluidNets, machineFluidPorts, type FluidNet, type MachineFluidPorts } from './fluid';
import type { FlowBreaks, FlowCtx, LaneSide, UnknownReason } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

export interface BeltNode {
  x: number;
  y: number;
  dir: Direction;
  name: string | null;
  /** 레인 노드 번호 — [left, right]. */
  lanes: [number, number];
  /** 하류 벨트 칸(없으면 -1 — 막다른 끝). */
  next: number;
  /** 이 칸으로 들어오는 칸. `back` = 뒤에서(지하 페어 포함), `side` = 옆에서. */
  inflows: { cell: number; kind: 'back' | 'side' }[];
  comp: number;
  /** 이 칸에서 **집는** 팔. */
  picks: number[];
}

export interface LaneNode {
  cell: number;
  side: LaneSide;
  cap: number;
  capKnown: boolean;
  /** 하류 레인 노드(없으면 -1). */
  next: number;
}

export type ArmEnd =
  | { kind: 'belt'; cell: number }
  | { kind: 'machine'; m: number }
  | { kind: 'chest'; c: number }
  | { kind: 'none' };

export interface ArmNode {
  x: number;
  y: number;
  name: string;
  cap: number;
  capKnown: boolean;
  from: ArmEnd;
  to: ArmEnd;
  /** 벨트에 놓으면 그 레인 노드, 아니면 -1. */
  dropLane: number;
}

export interface MachineNode {
  x: number;
  y: number;
  w: number;
  h: number;
  cell: GridCell;
  /** 율을 모르면 null(`unknownKind` 가 사유). */
  rates: MachineRates | null;
  unknownKind: UnknownReason | null;
  /** 이 머신에 **넣는** 팔 · 이 머신에서 **꺼내는** 팔. */
  armsIn: number[];
  armsOut: number[];
  /** 이 머신이 닿는 벨트 성분. */
  comps: Set<number>;
  /** 이 머신이 끝인 직결 팔(양끝이 벨트가 아닌 것). */
  directs: number[];
  /** 유체 재료·산출이 드나드는 관망. */
  fluid: MachineFluidPorts;
}

export interface ChestNode {
  x: number;
  y: number;
  name: string | null;
  role: ChestRole;
  armsIn: number[];
  armsOut: number[];
}

export interface Component {
  cells: number[];
  /** 투입 팔 — **우선순위 순서**(먼저 오는 것이 먼저 자리를 얻는다). */
  dropOrder: number[];
  /** 이 성분에 닿는 머신(탐침이 다시 풀 범위). */
  machines: Set<number>;
  scaleUnknown: boolean;
  /** 이 성분에 누군가 넣을 수 있는 품목. `anyItem` 이면 모른다(중계·벨트→벨트가 넣는다). */
  items: Set<string>;
  anyItem: boolean;
}

export interface FlowGraph {
  belts: BeltNode[];
  lanes: LaneNode[];
  arms: ArmNode[];
  machines: MachineNode[];
  chests: ChestNode[];
  comps: Component[];
  /** 양끝이 벨트가 아닌 팔(머신·상자 직결). */
  directs: number[];
  /** 벨트→벨트 팔 — 한 성분에서 집어 다른 성분에 놓는다. */
  transfers: number[];
  /** 유체 관망 — 용량 무한의 풀([fluid](fluid.ts)). */
  nets: FluidNet[];
  /** 관망 → 그 관망에 유체를 넣는 머신 · 빼는 머신. */
  netProducers: Map<number, Set<number>>;
  netConsumers: Map<number, Set<number>>;
  /** 그래프에 못 들어간 것 — 양끝이 안 닿은 팔 · 정면으로 마주 본 벨트. */
  breaks: FlowBreaks;
}

// ─────────────────────────────────────────────────────────────────────────────
// 벨트 연결 — 옛 beltFlow 에서 그대로
// ─────────────────────────────────────────────────────────────────────────────

const BELT_LIKE: ReadonlySet<string> = new Set<string>([
  EntityType.Belt,
  EntityType.UndergroundBelt,
  EntityType.Splitter,
]);

export function isBeltLike(t: EntityType | undefined): boolean {
  return t !== undefined && BELT_LIKE.has(t);
}

const MAX_UNDERGROUND_FALLBACK = 8;

/** 벨트류 칸의 다음(하류) 칸 좌표. 지하 입구는 페어 출구로 점프. 없으면 null. */
function nextOf(grid: LayoutGrid, x: number, y: number, c: GridCell): { x: number; y: number } | null {
  const v = dirVec(c.direction);
  if (c.entityType === EntityType.UndergroundBelt && c.undergroundType === 'input') {
    // 같은 방향·같은 이름의 최근접 출구. 사이에 또 다른 입구가 나오면 페어가 끊긴 것.
    for (let k = 1; k <= MAX_UNDERGROUND_FALLBACK; k++) {
      const nx = x + v.x * k;
      const ny = y + v.y * k;
      const nc = getCell(grid, nx, ny);
      if (!nc || nc.entityType !== EntityType.UndergroundBelt) continue;
      if (nc.entityName !== c.entityName || nc.direction !== c.direction) continue;
      if (nc.undergroundType === 'input') return null;
      return { x: nx, y: ny };
    }
    return null;
  }
  return { x: x + v.x, y: y + v.y };
}

/**
 * v 로 유입하는 상류 벨트 칸. 4-이웃 중 next(u) == v 이고 정면 마주보기가 아닌 것 + 지하 출구면
 * 그 페어 입구. `tunnel` 은 지하 페어 입구다(뒤 유입과 같이 다룬다).
 */
function upstreamOf(
  grid: LayoutGrid, x: number, y: number, c: GridCell,
): Array<{ x: number; y: number; tunnel: boolean }> {
  const res: Array<{ x: number; y: number; tunnel: boolean }> = [];
  const opp = ((c.direction + 8) % 16) as Direction;
  for (const d of [0, 4, 8, 12] as Direction[]) {
    const v = dirVec(d);
    const ux = x + v.x;
    const uy = y + v.y;
    const uc = getCell(grid, ux, uy);
    if (!uc || !isBeltLike(uc.entityType)) continue;
    // 입구의 하류는 지하 페어다 — 지상 이웃으로는 유입하지 않는다.
    if (uc.entityType === EntityType.UndergroundBelt && uc.undergroundType === 'input') continue;
    // 정면 마주보기 — 아이템 전달 불가.
    if (uc.direction === opp) continue;
    const n = nextOf(grid, ux, uy, uc);
    if (n && n.x === x && n.y === y) res.push({ x: ux, y: uy, tunnel: false });
  }
  if (c.entityType === EntityType.UndergroundBelt && c.undergroundType !== 'input') {
    const v = dirVec(c.direction);
    for (let k = 1; k <= MAX_UNDERGROUND_FALLBACK; k++) {
      const ux = x - v.x * k;
      const uy = y - v.y * k;
      const uc = getCell(grid, ux, uy);
      if (!uc || uc.entityType !== EntityType.UndergroundBelt) continue;
      if (uc.entityName !== c.entityName || uc.direction !== c.direction) continue;
      if (uc.undergroundType === 'input') res.push({ x: ux, y: uy, tunnel: true });
      break;
    }
  }
  return res;
}

/** 진행 방향 d 의 오른쪽(그리드는 y 가 아래로). N → E, E → S. */
function rightOf(d: Direction): { x: number; y: number } {
  const v = dirVec(d);
  return { x: -v.y, y: v.x };
}

/** 칸 b(방향 d) 기준으로 점 p 가 어느 옆에 있나. 옆이 아니면(앞·뒤) null. */
function sideOf(b: { x: number; y: number }, d: Direction, p: { x: number; y: number }): LaneSide | null {
  const vx = Math.sign(p.x - b.x);
  const vy = Math.sign(p.y - b.y);
  const r = rightOf(d);
  if (vx === r.x && vy === r.y) return 'right';
  if (vx === -r.x && vy === -r.y) return 'left';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 조립
// ─────────────────────────────────────────────────────────────────────────────

const key = (x: number, y: number) => `${x},${y}`;
const SIDES: readonly LaneSide[] = ['left', 'right'];

export function buildFlowGraph(grid: Readonly<LayoutGrid>, ctx: FlowCtx): FlowGraph {
  const belts: BeltNode[] = [];
  const beltIdx = new Map<string, number>();
  const lanes: LaneNode[] = [];

  // ① 벨트 칸과 레인 노드
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const c = grid.cells[y * grid.width + x];
      if (!c || !isBeltLike(c.entityType)) continue;
      const idx = belts.length;
      const { cap, known } = laneCap(c.entityName, ctx);
      const l = lanes.length;
      lanes.push({ cell: idx, side: 'left', cap, capKnown: known, next: -1 });
      lanes.push({ cell: idx, side: 'right', cap, capKnown: known, next: -1 });
      belts.push({
        x, y, dir: c.direction, name: c.entityName,
        lanes: [l, l + 1], next: -1, inflows: [], comp: -1, picks: [],
      });
      beltIdx.set(key(x, y), idx);
    }
  }

  // ② 유입 — 받는 쪽에서 센다(곡선인지 합류인지가 **그 칸의 유입 개수**로 갈리므로, ⑥)
  for (let n = 0; n < belts.length; n++) {
    const b = belts[n];
    const cell = getCell(grid, b.x, b.y)!;
    const back = { x: b.x - dirVec(b.dir).x, y: b.y - dirVec(b.dir).y };
    for (const u of upstreamOf(grid, b.x, b.y, cell)) {
      const ui = beltIdx.get(key(u.x, u.y));
      if (ui === undefined) continue;
      const kind = u.tunnel || (u.x === back.x && u.y === back.y) ? 'back' : 'side';
      b.inflows.push({ cell: ui, kind });
      belts[ui].next = n;
    }
    // 뒤 → 옆(왼 → 오른) 순. 투입 순서(④)가 이 순서를 물려받는다.
    b.inflows.sort((p, q) => rank(p) - rank(q));
    function rank(f: { cell: number; kind: 'back' | 'side' }): number {
      if (f.kind === 'back') return 0;
      return sideOf(b, b.dir, belts[f.cell]) === 'left' ? 1 : 2;
    }
  }

  // ②' 정면 마주보기 — `upstreamOf` 가 유입에서 빼는 자리. 빼기만 하면 **아무도 모른다**(2026-09-25 실측:
  //     외곽 경로가 포트 벨트에 정면으로 닿아 머신이 0% 였는데 `flg.check()` 는 통과였다).
  const headOn: FlowBreaks['headOn'] = [];
  const seenPair = new Set<string>();
  for (const b of belts) {
    const n = nextOf(grid, b.x, b.y, getCell(grid, b.x, b.y)!);
    const nc = n ? getCell(grid, n.x, n.y) : undefined;
    if (!n || !nc || !isBeltLike(nc.entityType) || nc.direction !== (b.dir + 8) % 16) continue;
    const pair = [key(b.x, b.y), key(n.x, n.y)].sort().join('|');
    if (seenPair.has(pair)) continue;
    seenPair.add(pair);
    headOn.push({
      a: { x: b.x, y: b.y, entityId: getCell(grid, b.x, b.y)!.entityId },
      b: { x: n.x, y: n.y, entityId: nc.entityId },
    });
  }

  // ③ 레인의 하류 — ⑤ 뒤는 보존 · ⑥ 옆 하나뿐이면 곡선(보존) · ③ 아니면 닿은 쪽 레인으로 접힘
  for (let u = 0; u < belts.length; u++) {
    const n = belts[u].next;
    if (n < 0) continue;
    const nb = belts[n];
    const inflow = nb.inflows.find((f) => f.cell === u)!;
    const hasBack = nb.inflows.some((f) => f.kind === 'back');
    const collapse = inflow.kind === 'side' && (hasBack || nb.inflows.length >= 2);
    for (let s = 0; s < 2; s++) {
      const target: LaneSide = collapse
        ? (sideOf(nb, nb.dir, belts[u]) ?? SIDES[s])
        : SIDES[s];
      lanes[belts[u].lanes[s]].next = nb.lanes[target === 'left' ? 0 : 1];
    }
  }

  // ④ 머신 · 상자
  const machines: MachineNode[] = [];
  const machineIdx = new Map<string, number>();
  const chests: ChestNode[] = [];
  const chestIdx = new Map<string, number>();
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const c = grid.cells[y * grid.width + x];
      if (!c || !c.isOrigin) continue;
      if (MACHINE_TYPES.has(c.entityType)) {
        const r = machineRates(c, ctx);
        const { w, h } = footprint(c, ctx);
        machineIdx.set(key(x, y), machines.length);
        machines.push({
          x, y, w, h, cell: c,
          rates: typeof r === 'string' ? null : r,
          unknownKind: typeof r === 'string' ? r : null,
          armsIn: [], armsOut: [], comps: new Set(), directs: [],
          fluid: { in: new Map(), out: new Map(), unresolved: false },
        });
      } else if (isContainer(c, ctx)) {
        chestIdx.set(key(x, y), chests.length);
        chests.push({ x, y, name: c.entityName, role: chestRole(c), armsIn: [], armsOut: [] });
      }
    }
  }

  const endAt = (x: number, y: number): ArmEnd => {
    const c = getCell(grid, x, y);
    if (!c || c.entityType === EntityType.Empty) return { kind: 'none' };
    const bi = beltIdx.get(key(x, y));
    if (bi !== undefined) return { kind: 'belt', cell: bi };
    const ok = key(x - c.tileOffset.x, y - c.tileOffset.y);
    const mi = machineIdx.get(ok);
    if (mi !== undefined) return { kind: 'machine', m: mi };
    const ci = chestIdx.get(ok);
    if (ci !== undefined) return { kind: 'chest', c: ci };
    return { kind: 'none' };
  };

  // ⑤ 팔
  const arms: ArmNode[] = [];
  const deadArms: FlowBreaks['deadArms'] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const c = grid.cells[y * grid.width + x];
      if (!c || !c.isOrigin) continue;
      if (c.entityType !== EntityType.Inserter && c.entityType !== EntityType.LongInserter) continue;
      const ent = c.entityName ? ctx.entityMap.get(c.entityName) : undefined;
      const { pick, drop } = inserterCells(x, y, c.direction, ent);
      const from = endAt(pick.x, pick.y);
      const to = endAt(drop.x, drop.y);
      if (from.kind === 'none' || to.kind === 'none') {
        // 옮길 것이 없어 풀이에서 빠진다 — 그래도 **적는다**. 빠진 팔의 머신은 판정에 0 으로만 남아,
        // 까닭이 "벨트가 덜 준다" 인지 "팔이 허공을 집는다" 인지 판정만 보고는 못 가른다.
        const found = (p: { x: number; y: number }) => getCell(grid, p.x, p.y)?.entityType ?? 'out-of-grid';
        deadArms.push({
          x, y, name: c.entityName ?? '?', entityId: c.entityId,
          ends: [
            ...(from.kind === 'none' ? [{ end: 'pick' as const, ...pick, found: found(pick) }] : []),
            ...(to.kind === 'none' ? [{ end: 'drop' as const, ...drop, found: found(drop) }] : []),
          ],
        });
        continue;
      }
      const { cap, known } = inserterCap(c.entityName, ctx);
      let dropLane = -1;
      if (to.kind === 'belt') {
        const b = belts[to.cell];
        // ① 먼 레인. 벨트와 나란히 서면(옆이 아니면) 오른쪽 — 게임에서 확인 안 된 가정(`flow-model` §4 (b)).
        const near = sideOf(b, b.dir, { x, y });
        const far: LaneSide = near === 'right' ? 'left' : 'right';
        dropLane = b.lanes[far === 'left' ? 0 : 1];
      }
      const k = arms.length;
      arms.push({ x, y, name: c.entityName ?? '?', cap, capKnown: known, from, to, dropLane });
      if (from.kind === 'belt') belts[from.cell].picks.push(k);
      if (from.kind === 'machine') machines[from.m].armsOut.push(k);
      if (from.kind === 'chest') chests[from.c].armsOut.push(k);
      if (to.kind === 'machine') machines[to.m].armsIn.push(k);
      if (to.kind === 'chest') chests[to.c].armsIn.push(k);
    }
  }

  // ⑥ 성분 — 하류가 하나뿐이라 한 성분은 뿌리 하나짜리 나무(아니면 고리 하나)다
  const comps: Component[] = [];
  for (let s = 0; s < belts.length; s++) {
    if (belts[s].comp >= 0) continue;
    const ci = comps.length;
    const comp: Component = {
      cells: [], dropOrder: [], machines: new Set(), scaleUnknown: false, items: new Set(), anyItem: false,
    };
    comps.push(comp);
    const stack = [s];
    belts[s].comp = ci;
    while (stack.length) {
      const b = stack.pop()!;
      comp.cells.push(b);
      const nb = [belts[b].next, ...belts[b].inflows.map((f) => f.cell)];
      for (const o of nb) {
        if (o < 0 || belts[o].comp >= 0) continue;
        belts[o].comp = ci;
        stack.push(o);
      }
    }
  }

  // ⑦ 투입 순서 — 뿌리에서 거슬러 올라가는 후위 순회. 한 칸에서: 뒤 가지 전부 → 옆 가지 전부 →
  //    그 칸 자신의 투입(왼 레인 → 오른 레인). 그래서 **상류가 먼저, 직진이 먼저, 유입이 투입보다 먼저**
  //    (`flow-model` §2.1 · `belt-lane-semantics` ⑦).
  const dropsByLane = new Map<number, number[]>();
  for (let k = 0; k < arms.length; k++) {
    if (arms[k].dropLane < 0) continue;
    const list = dropsByLane.get(arms[k].dropLane);
    if (list) list.push(k);
    else dropsByLane.set(arms[k].dropLane, [k]);
  }
  const visited = new Uint8Array(belts.length);
  for (const comp of comps) {
    const roots = comp.cells.filter((b) => belts[b].next < 0);
    // 고리(뿌리 없음)는 아무 칸에서 끊는다 — 드물고, 걷기는 성분 크기로 막는다.
    const starts = roots.length > 0 ? roots : [Math.min(...comp.cells)];
    for (const r of starts) postOrder(r, (b) => {
      for (const l of belts[b].lanes) comp.dropOrder.push(...(dropsByLane.get(l) ?? []));
    });
    for (const b of comp.cells) {
      if (!visited[b]) postOrder(b, (bb) => {
        for (const l of belts[bb].lanes) comp.dropOrder.push(...(dropsByLane.get(l) ?? []));
      });
      if (!lanes[belts[b].lanes[0]].capKnown) comp.scaleUnknown = true;
    }
  }
  function postOrder(root: number, emit: (b: number) => void): void {
    // 재귀 대신 명시적 스택 — 긴 벨트(수천 칸)에서 호출 깊이를 안 쓴다.
    const stack: Array<{ b: number; i: number }> = [{ b: root, i: 0 }];
    visited[root] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const inflows = belts[top.b].inflows;
      if (top.i < inflows.length) {
        const child = inflows[top.i++].cell;
        if (!visited[child]) {
          visited[child] = 1;
          stack.push({ b: child, i: 0 });
        }
        continue;
      }
      emit(top.b);
      stack.pop();
    }
  }

  // ⑦' 성분에 들어올 수 있는 품목 — 팔의 몫을 처음 나눌 때 "그 품목에 닿는 팔" 을 가린다.
  for (const comp of comps) {
    for (const k of comp.dropOrder) {
      const src = arms[k].from;
      if (src.kind === 'machine') {
        const r = machines[src.m].rates;
        if (r) for (const it of [...r.makes.keys(), ...r.unknownYield]) comp.items.add(it);
      } else if (src.kind === 'chest') {
        if (chests[src.c].role.relay) comp.anyItem = true;
        for (const it of chests[src.c].role.supply) comp.items.add(it);
      } else {
        comp.anyItem = true;
      }
    }
  }

  // ⑧ 머신 ↔ 성분 · 직결 · 전달
  const directs: number[] = [];
  const transfers: number[] = [];
  const machineOf = (e: ArmEnd) => (e.kind === 'machine' ? e.m : -1);
  for (let k = 0; k < arms.length; k++) {
    const a = arms[k];
    const touched = [a.from, a.to].filter((e) => e.kind === 'belt').map((e) => belts[(e as { cell: number }).cell].comp);
    for (const m of [machineOf(a.from), machineOf(a.to)]) {
      if (m < 0) continue;
      for (const ci of touched) {
        machines[m].comps.add(ci);
        comps[ci].machines.add(m);
      }
    }
    if (a.from.kind !== 'belt' && a.to.kind !== 'belt') {
      directs.push(k);
      for (const m of [machineOf(a.from), machineOf(a.to)]) if (m >= 0) machines[m].directs.push(k);
    }
    if (a.from.kind === 'belt' && a.to.kind === 'belt') transfers.push(k);
  }

  // ⑨ 유체 — 관망을 묶고 머신의 유체 상자를 잇는다
  const { nets, netAt } = buildFluidNets(grid, ctx);
  const netProducers = new Map<number, Set<number>>();
  const netConsumers = new Map<number, Set<number>>();
  const addTo = (m: Map<number, Set<number>>, n: number, v: number) => {
    const s = m.get(n);
    if (s) s.add(v);
    else m.set(n, new Set([v]));
  };
  machines.forEach((mn, m) => {
    const r = mn.rates;
    if (!r || (r.fluidIngredients.length === 0 && r.fluidProducts.length === 0)) return;
    const ent = mn.cell.entityName ? ctx.entityMap.get(mn.cell.entityName) : undefined;
    mn.fluid = machineFluidPorts(grid, mn, ent, netAt, r.fluidIngredients, r.fluidProducts);
    for (const set of mn.fluid.in.values()) for (const n of set) addTo(netConsumers, n, m);
    for (const set of mn.fluid.out.values()) for (const n of set) addTo(netProducers, n, m);
  });

  return {
    belts, lanes, arms, machines, chests, comps, directs, transfers, nets, netProducers, netConsumers,
    breaks: { deadArms, headOn },
  };
}

/** 머신 footprint — 프로토타입 크기, E/W 면 가로세로를 바꾼다. */
function footprint(c: GridCell, ctx: FlowCtx): { w: number; h: number } {
  const e = c.entityName ? ctx.entityMap.get(c.entityName) : undefined;
  const base = e
    ? { width: e.tile_width, height: e.tile_height }
    : ENTITY_SIZES[c.entityType] ?? { width: 1, height: 1 };
  return c.direction === 4 || c.direction === 12
    ? { w: base.height, h: base.width }
    : { w: base.width, h: base.height };
}
