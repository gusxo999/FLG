/**
 * `analyzeLayout` — 그리드 한 판을 풀어 머신 판정과 벨트 칸 흐름을 낸다.
 *
 * 조율만 한다: 그래프를 짓고([graph](graph.ts)) 풀고([solve](solve.ts)) 판정한다. 판정 규칙은
 * `docs/analysis/flow-model.md` §2.5 다:
 *
 * ```
 * u < 1 − 1e-6                         → 미달 (낙관적으로 가정하고도 모자라면 확정이다)
 * 아니고 판정 불가 사유가 하나라도 있으면  → 판정 불가
 * 아니면                                → 100%
 * ```
 *
 * **그리드를 쓰지 않는다** — 입력은 `Readonly` 이고 결과는 새 객체다.
 */

import type { LayoutGrid } from '../../types/layout';
import { buildFlowGraph, type FlowGraph } from './graph';
import { canBring, probeTotals, solveFlow, type PassRecord, type SolveOutput } from './solve';
import type {
  BeltCellFlow,
  BeltTap,
  FlowCtx,
  FlowResult,
  LaneFlow,
  LaneSide,
  MachineVerdict,
  UnknownReason,
} from './types';

/** 부동소수 오차만 허용한다 — 99% 도 미달이다(여유를 두면 머신 수 올림으로 생긴 과잉 생산이 안 보인다). */
export const FULL_THRESHOLD = 1 - 1e-6;
const EPS = 1e-9;

export function analyzeLayout(grid: Readonly<LayoutGrid>, ctx: FlowCtx): FlowResult {
  const g = buildFlowGraph(grid, ctx);
  const sol = solveFlow(g);

  const machines = g.machines.map((_, m) => verdictOf(g, sol, m));
  machines.sort((a, b) => a.y - b.y || a.x - b.x);

  // 벨트 칸마다 닿는 팔 — 칸마다 팔 전체를 훑지 않게 한 번 모은다.
  const armsAt = new Map<number, number[]>();
  const push = (b: number, k: number) => {
    const list = armsAt.get(b);
    if (list) list.push(k);
    else armsAt.set(b, [k]);
  };
  for (let k = 0; k < g.arms.length; k++) {
    const a = g.arms[k];
    if (a.dropLane >= 0) push(g.lanes[a.dropLane].cell, k);
    if (a.from.kind === 'belt' && a.from.cell !== (a.dropLane >= 0 ? g.lanes[a.dropLane].cell : -1)) push(a.from.cell, k);
  }
  const belts = new Map<string, BeltCellFlow>();
  for (let b = 0; b < g.belts.length; b++) {
    belts.set(`${g.belts[b].x},${g.belts[b].y}`, beltCellOf(g, b, sol.final, armsAt.get(b) ?? []));
  }

  const summary = { total: machines.length, full: 0, short: 0, unknown: 0 };
  for (const v of machines) summary[v.state]++;

  return { machines, belts, summary, converged: sol.converged, iterations: sol.iterations, breaks: g.breaks };
}

// ─────────────────────────────────────────────────────────────────────────────
// 머신 판정
// ─────────────────────────────────────────────────────────────────────────────

function verdictOf(g: FlowGraph, sol: SolveOutput, m: number): MachineVerdict {
  const mn = g.machines[m];
  const base = {
    entityId: mn.cell.entityId,
    entityName: mn.cell.entityName,
    recipe: mn.cell.recipe ?? null,
    x: mn.x, y: mn.y, w: mn.w, h: mn.h,
    assumed: isAssumed(g, m),
    ...(sol.unsettled.has(m) ? { unsettled: true as const } : {}),
  };
  const rs = sol.supplyProbes.get(m);
  const rd = sol.drainProbes.get(m);
  if (!mn.rates || !rs || !rd) {
    return {
      ...base, state: 'unknown', u: NaN, craftsPerSec: NaN, inputs: [], outputs: [],
      unknown: [mn.unknownKind ?? 'no-recipe'],
    };
  }
  const r = mn.rates;
  const got = probeTotals(g, m, rs, 'in');
  const sent = probeTotals(g, m, rd, 'out');
  const fl = sol.fluidProbes.get(m) ?? { got: new Map<string, number>(), sent: new Map<string, number>() };
  const inputs: MachineVerdict['inputs'] = [
    ...[...r.needs].map(([item, need]) => ({ item, got: got.get(item) ?? 0, need })),
    ...[...r.needsFluid].map(([item, need]) => ({ item, got: fl.got.get(item) ?? 0, need, fluid: true as const })),
  ];
  const outputs: MachineVerdict['outputs'] = [
    ...[...r.makes].map(([item, made]) => ({ item, sent: sent.get(item) ?? 0, made })),
    ...[...r.unknownYield].map((item) => ({ item, sent: sent.get(item) ?? 0, made: NaN })),
    ...[...r.makesFluid].map(([item, made]) => ({ item, sent: fl.sent.get(item) ?? 0, made, fluid: true as const })),
  ];

  const unknown: UnknownReason[] = [...r.reasons];
  if (mn.fluid.unresolved) unknown.push('fluid');
  const scale = [...mn.armsIn, ...mn.armsOut].some((k) => !g.arms[k].capKnown)
    || [...mn.comps].some((c) => g.comps[c].scaleUnknown);
  if (scale) unknown.push('scale');

  const u = sol.u[m];
  const short = u < FULL_THRESHOLD;
  const verdict: MachineVerdict = {
    ...base,
    state: short ? 'short' : unknown.length > 0 ? 'unknown' : 'full',
    u,
    craftsPerSec: r.craftsPerSec,
    inputs,
    outputs,
    unknown,
  };
  // 공급 능력이 배출 능력보다 작으면 굶주림, 아니면 정체(`solve` 머리말 — 두 탐침).
  if (short) {
    verdict.limit = sol.us[m] <= sol.ud[m]
      ? limitOf(g, m, rs, 'input', inputs, outputs)
      : limitOf(g, m, rd, 'output', inputs, outputs);
  }
  return verdict;
}

/**
 * 그 쪽에서 가장 모자란 한 줄과 그 까닭.
 * `arms` = 그 품목에 닿는 팔이 전부 처리량을 다 썼다(또는 팔이 하나도 없다) ·
 * `belt` = 팔은 남는데 벨트(나 상대)가 안 줬다/안 받았다.
 */
function limitOf(
  g: FlowGraph, m: number, probe: PassRecord, side: 'input' | 'output',
  inputs: MachineVerdict['inputs'], outputs: MachineVerdict['outputs'],
): MachineVerdict['limit'] {
  const mn = g.machines[m];
  const rows = side === 'input'
    ? inputs.map((i) => ({ item: i.item, fluid: !!i.fluid, ratio: i.need > EPS ? i.got / i.need : Infinity }))
    : outputs.map((o) => ({ item: o.item, fluid: !!o.fluid, ratio: o.made > EPS ? o.sent / o.made : Infinity }));
  const best = rows.reduce<{ item: string; fluid: boolean; ratio: number } | null>(
    (b, x) => (x.ratio < (b?.ratio ?? Infinity) ? x : b), null);
  if (!best) return undefined;
  if (best.fluid) return { side, item: best.item, by: 'pipe' };
  // 그 품목에 **닿을 수 있는** 팔만 본다 — 판 벨트의 팔이 남는다고 선 벨트가 모자란 까닭이
  // 팔일 수는 없다. 출력은 팔마다 산출 전부를 나르므로 전부 닿는다.
  const all = side === 'input' ? mn.armsIn : mn.armsOut;
  const reach = side === 'input' ? all.filter((k) => canBring(g, k, best.item)) : all;
  const spent = (k: number) => (probe.capLeft.get(k) ?? g.arms[k].cap) <= EPS;
  const by: 'arms' | 'belt' = all.length === 0 || (reach.length > 0 && reach.every(spent)) ? 'arms' : 'belt';
  return { side, item: best.item, by };
}

/** 율을 모르는 머신과 벨트 성분이나 직결을 나눠 쓰나. */
function isAssumed(g: FlowGraph, m: number): boolean {
  const mn = g.machines[m];
  for (const c of mn.comps) {
    for (const o of g.comps[c].machines) if (o !== m && !g.machines[o].rates) return true;
  }
  for (const k of mn.directs) {
    const a = g.arms[k];
    for (const e of [a.from, a.to]) if (e.kind === 'machine' && e.m !== m && !g.machines[e.m].rates) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// 벨트 칸
// ─────────────────────────────────────────────────────────────────────────────

function beltCellOf(g: FlowGraph, b: number, final: PassRecord, armList: number[]): BeltCellFlow {
  const node = g.belts[b];
  const laneOf = (i: 0 | 1): LaneFlow => {
    const l = g.lanes[node.lanes[i]];
    const f = final.laneFlow?.get(node.lanes[i]);
    const items = [...(f ?? [])]
      .filter(([, r]) => r > EPS)
      .map(([item, rate]) => ({ item, rate }))
      .sort((p, q) => q.rate - p.rate);
    const rate = items.reduce((s, x) => s + x.rate, 0);
    return { rate, items, capacity: l.cap, saturated: rate >= l.cap - 1e-6 };
  };
  const lanes: Record<LaneSide, LaneFlow> = { left: laneOf(0), right: laneOf(1) };

  const taps: BeltTap[] = [];
  const peerName = (e: (typeof g.arms)[number]['from']): string | null =>
    e.kind === 'machine' ? g.machines[e.m].cell.entityName
      : e.kind === 'chest' ? g.chests[e.c].name
        : null;
  for (const k of armList) {
    const a = g.arms[k];
    if (a.dropLane >= 0 && g.lanes[a.dropLane].cell === b) {
      const moved = final.dropped.get(k);
      const rate = sumMap(moved);
      taps.push({
        x: a.x, y: a.y, kind: 'drop', inserterName: a.name, peerName: peerName(a.from),
        rate, refused: Math.max(0, (final.offered.get(k) ?? 0) - rate),
        side: g.lanes[a.dropLane].side, items: [...(moved?.keys() ?? [])],
      });
    }
    if (a.from.kind === 'belt' && a.from.cell === b) {
      const moved = final.picked.get(k);
      taps.push({
        x: a.x, y: a.y, kind: 'pick', inserterName: a.name, peerName: peerName(a.to),
        rate: sumMap(moved), refused: 0, items: [...(moved?.keys() ?? [])],
      });
    }
  }
  return {
    x: node.x, y: node.y, lanes, taps,
    mixedLane: lanes.left.items.length > 1 || lanes.right.items.length > 1,
  };
}

function sumMap(m: Map<string, number> | undefined): number {
  let s = 0;
  if (m) for (const v of m.values()) s += v;
  return s;
}

/** 그리드 칸 (x, y) 가 속한 머신의 판정 — footprint 어디를 눌러도 같은 머신. */
export function machineVerdictAt(result: FlowResult, x: number, y: number): MachineVerdict | undefined {
  return result.machines.find((v) => x >= v.x && x < v.x + v.w && y >= v.y && y < v.y + v.h);
}
