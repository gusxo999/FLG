/**
 * 정상상태 풀이 — 머신마다 가동률 `u` 를 낸다.
 *
 * ## 모델 (`docs/analysis/flow-model.md` §2 — 왜 이 모양인가는 §3)
 *
 * **한 판(pass)** 은 `u` 가 주어졌을 때의 흐름이다. 벨트 성분마다 투입 팔을 **우선순위 순서**
 * ([graph](graph.ts) 가 정한 `dropOrder` — 상류 먼저 · 직진 먼저 · 유입이 투입보다 먼저)로 하나씩
 * 꺼내, 그 팔이 넣는 물건을 레인을 따라 하류로 걸린다. 지나는 칸의 집는 팔이 **받는 품목이면**
 * 가져간다. **끝까지 안 집힌 것은 받아들이지 않는다** — 벨트가 차서 그 투입이 막힌 것이
 * 정상상태이기 때문이다(정체). 지나는 레인 노드마다 남은 용량을 깎는다(레인 = 벨트의 절반).
 *
 * **가동률은 탐침으로 잰다 — 두 번.** 머신 하나만 100% 로 올려 그 머신이 닿는 성분만 한 판 푼다.
 *
 * ```
 * 공급 탐침   이 머신에 **대 주는** 쪽은 제 공급 능력 `us` 로, 다투는 쪽은 실제 `u` 로
 *             → 받은 양 ÷ 필요량 = 이 머신의 공급 능력 us
 * 배출 탐침   이 머신에서 **받아 가는** 쪽은 제 배출 능력 `ud` 로, 다투는 쪽은 실제 `u` 로
 *             → 내보낸 양 ÷ 생산량 = 이 머신의 배출 능력 ud
 * 가동률      u = min(us, ud)
 * ```
 *
 * 머신마다 차례로(가우스-자이델) 되풀이해 셋이 안 바뀌면 멈춘다. 끝나면 **까닭도 같이 나온다** —
 * `us < ud` 면 굶주림, 아니면 정체.
 *
 * > **왜 탐침인가.** 머신은 `need × u` 만큼만 끄므로 *받은 양 ÷ 필요량* 은 언제나 `≤ u` 다.
 * > 그걸로 `u` 를 고치면 한 번 내려간 `u` 가 다시 오를 길이 없다. 탐침은 **자기 수요를 빼고** 잰다.
 * >
 * > **왜 두 번인가.** 한 탐침으로 주는 쪽·받는 쪽을 모두 실제 `u` 로 두면, 서로가 서로의 까닭인
 * > 두 머신이 **함께 0 에 갇힌다** — 생산자는 소비자가 안 먹어서 멈추고, 소비자는 생산자가 멈춰서
 * > 굶는다. 그것도 고정점이지만 게임의 정상상태가 아니다(2026-09-22 합성 배치에서 머신 넷이 그렇게
 * > 0% 로 나왔다). 대 주는 쪽을 **공급 능력**으로 두면 "내가 더 먹으려 하면 저쪽은 더 낼 수
 * > 있나" 를 묻게 되고, 그 물음에는 내 탓으로 줄어든 값이 끼지 않는다. 다투는 쪽은 실제 `u` 다 —
 * > 제 출력이 막혀 덜 먹는 윗 소비자가 능력만큼 먹는다고 치면 아랫 소비자가 억울하게 굶는다.
 *
 * ## 다른 머신의 몫은 팔마다 고정한다
 *
 * 탐침 밖 머신의 수요·산출(`need × u` · `made × u`)은 **팔마다 나눠** 둔다. 나누는 비율은 그 머신의
 * 직전 탐침에서 **실제로 오간 비율**이다(처음엔 그 품목에 닿는 팔끼리 균등). 그래서 성분 하나만
 * 다시 풀어도 다른 성분에 걸친 몫을 몰라도 된다 — 탐침이 싸진다.
 *
 * ## 유체 — 관망은 용량 무한의 풀
 *
 * 관망에는 순서도 레인도 없다(`pipe-semantics` §2). 탐침은 벨트와 같은 물음을 관망에 던진다 —
 * 모자라면 **비례로 나눈다** — 다투는 머신은 *이 유체 말고 다른 까닭으로 얼마나 돌 수 있나* 로
 * 센다(`consumeIntent`). 배출 쪽은 그 거울이다. 무한파이프 공급이 닿으면 언제나 충분하고, 무한 회수가 닿으면
 * 언제나 다 빠진다 — 반대로 **공급 무한파이프가 붙은 관망에는 생산자가 한 방울도 못 넣는다**(늘 차 있다).
 *
 * ## 중계 — 보통 상자 · 벨트→벨트 팔
 *
 * 들어온 만큼만 나간다. 판과 판 사이에 값을 넘긴다: 다음 판의 재고 = 이번 판에 들어온 양,
 * 받을 수 있는 양 = 이번 판에 나간 양(단, 재고를 다 내보냈으면 제한 없음 — 아래가 더 먹을 수
 * 있다는 뜻이다). 자동 배치는 이것을 안 만든다.
 */

import type { FlowGraph } from './graph';

const EPS = 1e-9;
const MAX_ITER = 200;
const CONVERGE = 1e-7;

type ItemMap = Map<string, number>;

const add = (m: ItemMap, item: string, x: number) => m.set(item, (m.get(item) ?? 0) + x);
const sum = (m: ItemMap | undefined) => {
  let s = 0;
  if (m) for (const v of m.values()) s += v;
  return s;
};

/** 판과 판 사이에 이어지는 것. */
interface SolveState {
  /** 실제 가동률 = min(us, ud). */
  u: Float64Array;
  /** 공급 능력 — 더 먹으려 하면 받을 수 있는 비율. */
  us: Float64Array;
  /** 배출 능력 — 더 만들려 하면 내보낼 수 있는 비율. */
  ud: Float64Array;
  /** 머신 → 재료마다의 공급 비율 · 산출마다의 배출 비율(`us`·`ud` 는 그 최솟값). 유체 나눠 갖기가 쓴다. */
  usParts: Map<number, ItemMap>;
  udParts: Map<number, ItemMap>;
  /** 팔 → 품목 → 그 머신 몫 중 이 팔의 비율. */
  wIn: Map<number, ItemMap>;
  wOut: Map<number, ItemMap>;
  relayStock: Map<number, ItemMap>;
  relayDrain: Map<number, number>;
  armStock: Map<number, ItemMap>;
  armDrain: Map<number, number>;
}

/** 한 판의 기록. */
export interface PassRecord {
  /** 받는 쪽에서 센 양 — 집기 · 직결 · 전달 팔의 집기. */
  picked: Map<number, ItemMap>;
  /** 주는 쪽에서 센 양 — 벨트 투입 · 직결 · 전달 팔의 투입. */
  dropped: Map<number, ItemMap>;
  /** 벨트 투입 팔이 넣으려던 양(받아들인 양 + 정체로 거절된 양). */
  offered: Map<number, number>;
  /** 판이 끝났을 때 팔마다 남은 처리량. **건드린 팔만** 있다 — 없으면 처리량 그대로다. */
  capLeft: Map<number, number>;
  /** 레인 노드 → 품목별 흐름. `withLanes` 일 때만. */
  laneFlow: Map<number, ItemMap> | null;
}

export interface SolveOutput {
  u: Float64Array;
  us: Float64Array;
  ud: Float64Array;
  /** 머신 → 마지막 공급 탐침 · 배출 탐침. 율을 모르는 머신은 없다. */
  supplyProbes: Map<number, PassRecord>;
  drainProbes: Map<number, PassRecord>;
  /** 머신 → 유체 탐침(받을 수 있는 유체 · 내보낼 수 있는 유체). */
  fluidProbes: Map<number, { got: ItemMap; sent: ItemMap }>;
  /** 수렴한 `u` 로 그리드 전체를 푼 판. */
  final: PassRecord;
  converged: boolean;
  iterations: number;
  /** 못 닿았을 때 마지막 되풀이에서도 `us`·`ud` 가 움직인 머신 — 그 `u` 는 멈춘 자리에 달렸다. 닿았으면 비어 있다. */
  unsettled: Set<number>;
}

/** 한 판이 다른 머신의 몫을 무엇으로 셈하나(머리말 표). */
type View = 'actual' | 'supply' | 'drain';

// ─────────────────────────────────────────────────────────────────────────────
// 한 판
// ─────────────────────────────────────────────────────────────────────────────

function runPass(
  g: FlowGraph,
  st: SolveState,
  comps: Iterable<number>,
  directs: readonly number[],
  probe: number,
  view: View,
  withLanes: boolean,
): PassRecord {
  const { arms, machines, chests, lanes, belts } = g;
  const rec: PassRecord = {
    picked: new Map(), dropped: new Map(), offered: new Map(), capLeft: new Map(),
    laneFlow: withLanes ? new Map() : null,
  };
  const capLeft = rec.capLeft;
  const armCap = (k: number) => capLeft.get(k) ?? arms[k].cap;
  const isTransfer = (k: number) => arms[k].from.kind === 'belt' && arms[k].to.kind === 'belt';

  // 탐침 머신의 몫은 팔끼리 **나눠 쓰는** 풀이다.
  const pm = probe >= 0 ? machines[probe].rates : null;
  const poolIn: ItemMap = pm ? new Map(pm.needs) : new Map();
  const poolOut: ItemMap = pm ? new Map(pm.makes) : new Map();
  if (pm) for (const it of pm.unknownYield) poolOut.set(it, Infinity);

  // 탐침 밖 머신의 몫은 팔마다 고정 — `need × u × w`.
  const allocLeft = new Map<string, number>();
  const alloc = (k: number, m: number, item: string, side: 'in' | 'out'): number => {
    const kk = `${side}${k}|${item}`;
    let v = allocLeft.get(kk);
    if (v === undefined) {
      const r = machines[m].rates!;
      const base = side === 'in'
        ? r.needs.get(item) ?? 0
        : r.unknownYield.has(item) ? Infinity : r.makes.get(item) ?? 0;
      const w = (side === 'in' ? st.wIn : st.wOut).get(k)?.get(item) ?? defaultWeight(g, m, k, item, side);
      // 대 주는 쪽은 공급 탐침에서 공급 능력으로, 받아 가는 쪽은 배출 탐침에서 배출 능력으로.
      const f = side === 'out' && view === 'supply' ? st.us[m]
        : side === 'in' && view === 'drain' ? st.ud[m]
          : st.u[m];
      v = base === Infinity ? Infinity : base * f * w;
      allocLeft.set(kk, v);
    }
    return v;
  };
  const useAlloc = (k: number, item: string, side: 'in' | 'out', x: number) => {
    const kk = `${side}${k}|${item}`;
    allocLeft.set(kk, (allocLeft.get(kk) ?? 0) - x);
  };

  // 중계의 이번 판 몫
  const relayDrainLeft = new Map<number, number>();
  const relayStockLeft = new Map<number, ItemMap>();
  const armDrainLeft = new Map<number, number>();
  const armStockLeft = new Map<number, ItemMap>();
  const relayDrain = (c: number) => relayDrainLeft.get(c) ?? st.relayDrain.get(c) ?? Infinity;
  const relayStock = (c: number) => {
    let s = relayStockLeft.get(c);
    if (!s) relayStockLeft.set(c, (s = new Map(st.relayStock.get(c) ?? [])));
    return s;
  };
  const armDrain = (k: number) => armDrainLeft.get(k) ?? st.armDrain.get(k) ?? arms[k].cap;
  const armStock = (k: number) => {
    let s = armStockLeft.get(k);
    if (!s) armStockLeft.set(k, (s = new Map(st.armStock.get(k) ?? [])));
    return s;
  };

  /** 팔 k 가 지금 이 품목을 **받는 쪽으로** 얼마나 옮길 수 있나(처리량 포함). */
  const demand = (k: number, item: string): number => {
    const a = arms[k];
    const cap = armCap(k);
    if (cap <= EPS) return 0;
    const to = a.to;
    if (to.kind === 'machine') {
      const r = machines[to.m].rates;
      if (!r || !r.needs.has(item)) return 0;
      return Math.min(cap, to.m === probe ? poolIn.get(item) ?? 0 : alloc(k, to.m, item, 'in'));
    }
    if (to.kind === 'chest') {
      const role = chests[to.c].role;
      if (role.sinkAll || role.sinkItems.has(item)) return cap;
      if (role.relay) return Math.min(cap, relayDrain(to.c));
      return 0;
    }
    if (to.kind === 'belt') return Math.min(cap, armDrain(k));
    return 0;
  };

  /** 받는 쪽 장부 — 처리량은 **여기서 한 번만** 깎는다(벨트 투입은 걷기가 깎는다). */
  const take = (k: number, item: string, x: number) => {
    const a = arms[k];
    capLeft.set(k, armCap(k) - x);
    const to = a.to;
    if (to.kind === 'machine') {
      if (to.m === probe) poolIn.set(item, (poolIn.get(item) ?? 0) - x);
      else useAlloc(k, item, 'in', x);
    } else if (to.kind === 'chest' && chests[to.c].role.relay) {
      relayDrainLeft.set(to.c, relayDrain(to.c) - x);
    } else if (to.kind === 'belt') {
      armDrainLeft.set(k, armDrain(k) - x);
    }
    let m = rec.picked.get(k);
    if (!m) rec.picked.set(k, (m = new Map()));
    add(m, item, x);
  };

  /** 팔 k 가 **주는 쪽에서** 내놓을 수 있는 것. 처리량은 안 본다. */
  const offers = (k: number): Array<[string, number]> => {
    const from = arms[k].from;
    if (from.kind === 'machine') {
      const r = machines[from.m].rates;
      if (!r) return [];
      const items = [...r.makes.keys(), ...r.unknownYield];
      return items.map((it) => [it, from.m === probe ? poolOut.get(it) ?? 0 : alloc(k, from.m, it, 'out')]);
    }
    if (from.kind === 'chest') {
      const role = chests[from.c].role;
      if (role.relay) return [...relayStock(from.c)];
      return [...role.supply].map((it) => [it, Infinity]);
    }
    if (from.kind === 'belt') return [...armStock(k)];
    return [];
  };

  const give = (k: number, item: string, x: number) => {
    const from = arms[k].from;
    if (from.kind === 'machine') {
      if (from.m === probe) poolOut.set(item, (poolOut.get(item) ?? 0) - x);
      else useAlloc(k, item, 'out', x);
    } else if (from.kind === 'chest' && chests[from.c].role.relay) {
      const s = relayStock(from.c);
      s.set(item, (s.get(item) ?? 0) - x);
    } else if (from.kind === 'belt') {
      const s = armStock(k);
      s.set(item, (s.get(item) ?? 0) - x);
    }
    let m = rec.dropped.get(k);
    if (!m) rec.dropped.set(k, (m = new Map()));
    add(m, item, x);
  };

  // ① 직결 — 벨트 없이 끝과 끝
  for (const k of directs) {
    for (const [item, amount] of offers(k)) {
      const x = Math.min(amount, demand(k, item));
      if (x <= EPS) continue;
      take(k, item, x);
      give(k, item, x);
    }
  }

  // ② 벨트 — 성분마다 투입을 우선순위대로
  const laneLeft = new Map<number, number>();
  const maxSteps = lanes.length + 1;
  for (const ci of comps) {
    for (const k of g.comps[ci].dropOrder) {
      const a = arms[k];
      const transfer = isTransfer(k);
      for (const [item, amount] of offers(k)) {
        let offer = Math.min(amount, transfer ? Infinity : armCap(k));
        if (offer <= EPS) continue;
        // 넣으려던 양은 **그 레인이 받을 수 있는 만큼**까지만 적는다 — 바깥 공급 팔은 벨트 한 줄
        // 운반량이라(가정) 레인보다 큰 수가 나오고, 화면의 "정체로 거절"이 레인 용량을 넘어 보인다.
        rec.offered.set(k, (rec.offered.get(k) ?? 0) + Math.min(offer, lanes[a.dropLane].cap));
        // 걷기 — room 은 지나온 레인 노드의 남은 용량 최솟값(여기까지 오는 물건이 다 지나야 한다)
        const path: number[] = [];
        const at: number[] = [];
        const xs: number[] = [];
        let room = Infinity;
        let l = a.dropLane;
        for (let steps = 0; l >= 0 && steps < maxSteps && offer > EPS; steps++) {
          room = Math.min(room, laneLeft.get(l) ?? lanes[l].cap);
          if (room <= EPS) break;
          path.push(l);
          for (const pk of belts[lanes[l].cell].picks) {
            if (pk === k) continue;
            const d = demand(pk, item);
            if (d <= EPS) continue;
            const x = Math.min(offer, room, d);
            take(pk, item, x);
            offer -= x;
            room -= x;
            at.push(path.length - 1);
            xs.push(x);
            if (offer <= EPS) break;
          }
          l = lanes[l].next;
        }
        // 실은 양을 경로에 싣는다 — 노드 i 를 지나는 양 = i 이후에서 집힌 양의 합.
        let accepted = 0;
        if (xs.length > 0) {
          const loadAt = new Float64Array(path.length);
          for (let j = 0; j < xs.length; j++) loadAt[at[j]] += xs[j];
          let load = 0;
          for (let i = path.length - 1; i >= 0; i--) {
            load += loadAt[i];
            if (load <= 0) continue;
            const li = path[i];
            laneLeft.set(li, (laneLeft.get(li) ?? lanes[li].cap) - load);
            if (rec.laneFlow) {
              let f = rec.laneFlow.get(li);
              if (!f) rec.laneFlow.set(li, (f = new Map()));
              add(f, item, load);
            }
          }
          accepted = load;
        }
        if (accepted > EPS) {
          give(k, item, accepted);
          if (!transfer) capLeft.set(k, armCap(k) - accepted);
        }
      }
    }
  }

  return rec;
}

// ─────────────────────────────────────────────────────────────────────────────
// 고정점
// ─────────────────────────────────────────────────────────────────────────────

/** 탐침에서 이 머신이 받은 양(`in`) · 내보낸 양(`out`), 품목별. */
export function probeTotals(g: FlowGraph, m: number, r: PassRecord, side: 'in' | 'out'): ItemMap {
  const mn = g.machines[m];
  const out: ItemMap = new Map();
  if (side === 'in') for (const k of mn.armsIn) for (const [it, x] of r.picked.get(k) ?? []) add(out, it, x);
  else for (const k of mn.armsOut) for (const [it, x] of r.dropped.get(k) ?? []) add(out, it, x);
  return out;
}

/** 품목마다의 비율 — 필요/생산이 0 인 품목은 안 본다. 수율 미상 산출은 `makes` 에 없어 빠진다(낙관). */
function parts(pairs: Array<[want: ItemMap, got: ItemMap]>): ItemMap {
  const out: ItemMap = new Map();
  for (const [want, got] of pairs) {
    for (const [it, need] of want) if (need > EPS) out.set(it, Math.max(0, Math.min(1, (got.get(it) ?? 0) / need)));
  }
  return out;
}

const minOf = (m: ItemMap | undefined, except?: string): number => {
  let u = 1;
  if (m) for (const [it, r] of m) if (it !== except) u = Math.min(u, r);
  return u;
};

export function solveFlow(g: FlowGraph): SolveOutput {
  const n = g.machines.length;
  const st: SolveState = {
    u: new Float64Array(n), us: new Float64Array(n), ud: new Float64Array(n),
    usParts: new Map(), udParts: new Map(),
    wIn: new Map(), wOut: new Map(),
    relayStock: new Map(), relayDrain: new Map(),
    armStock: new Map(), armDrain: new Map(),
  };
  const rated: number[] = [];
  for (let m = 0; m < n; m++) {
    const v = g.machines[m].rates ? 1 : NaN;
    st.u[m] = v;
    st.us[m] = v;
    st.ud[m] = v;
    if (g.machines[m].rates) rated.push(m);
  }
  const allComps = g.comps.map((_, i) => i);
  const relays = g.chests.map((c, i) => (c.role.relay && (c.armsIn.length || c.armsOut.length) ? i : -1)).filter((i) => i >= 0);
  const hasRelay = relays.length > 0 || g.transfers.length > 0;

  const supplyProbes = new Map<number, PassRecord>();
  const drainProbes = new Map<number, PassRecord>();
  const fluidProbes = new Map<number, { got: ItemMap; sent: ItemMap }>();
  let converged = false;
  let iter = 0;
  let moved = new Set<number>();
  for (iter = 1; iter <= MAX_ITER; iter++) {
    let delta = 0;
    moved = new Set<number>();

    if (hasRelay) {
      delta = Math.max(delta, updateRelays(g, st, relays, runPass(g, st, allComps, g.directs, -1, 'actual', false)));
    }

    // 가우스-자이델 — 탐침 하나가 끝나면 **바로** 반영한다. 야코비(모두 옛 값으로 동시에)는
    // 같은 줄을 다투는 소비자들이 서로의 옛 값을 보고 "나는 넉넉하다" 를 번갈아 믿어 진동한다
    // (2026-09-22 파이프라인 픽스처에서 0.2 ↔ 1 을 200번 오갔다).
    for (const m of rated) {
      const mn = g.machines[m];
      const rates = mn.rates!;
      const rs = runPass(g, st, mn.comps, mn.directs, m, 'supply', false);
      const rd = runPass(g, st, mn.comps, mn.directs, m, 'drain', false);
      supplyProbes.set(m, rs);
      drainProbes.set(m, rd);
      const got = probeTotals(g, m, rs, 'in');
      const sent = probeTotals(g, m, rd, 'out');
      const gotFluid = fluidSupply(g, st, m);
      const sentFluid = fluidDrain(g, st, m);
      fluidProbes.set(m, { got: gotFluid, sent: sentFluid });
      const usParts = parts([[rates.needs, got], [rates.needsFluid, gotFluid]]);
      const udParts = parts([[rates.makes, sent], [rates.makesFluid, sentFluid]]);
      st.usParts.set(m, usParts);
      st.udParts.set(m, udParts);
      const us = minOf(usParts);
      const ud = minOf(udParts);
      const du = Math.max(Math.abs(us - st.us[m]), Math.abs(ud - st.ud[m]));
      if (du >= CONVERGE) moved.add(m);
      delta = Math.max(delta, du);
      st.us[m] = us;
      st.ud[m] = ud;
      st.u[m] = Math.min(us, ud);
      // 이 머신 몫을 팔에 나누는 비율 — 탐침에서 **실제로** 오간 비율
      for (const k of mn.armsIn) {
        const w = new Map<string, number>();
        for (const [it, total] of got) if (total > EPS) w.set(it, (rs.picked.get(k)?.get(it) ?? 0) / total);
        delta = Math.max(delta, weightDelta(st.wIn.get(k), w));
        st.wIn.set(k, w);
      }
      for (const k of mn.armsOut) {
        const w = new Map<string, number>();
        for (const [it, total] of sent) if (total > EPS) w.set(it, (rd.dropped.get(k)?.get(it) ?? 0) / total);
        delta = Math.max(delta, weightDelta(st.wOut.get(k), w));
        st.wOut.set(k, w);
      }
    }
    if (delta < CONVERGE) {
      converged = true;
      break;
    }
  }

  const final = runPass(g, st, allComps, g.directs, -1, 'actual', true);
  return {
    u: st.u, us: st.us, ud: st.ud, supplyProbes, drainProbes, fluidProbes, final,
    converged, iterations: Math.min(iter, MAX_ITER),
    unsettled: converged ? new Set() : moved,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 유체
// ─────────────────────────────────────────────────────────────────────────────

/** 이 머신이 유체 f 를 드나드는 관망 중 하나라도 `nets` 에 있나. */
const touches = (ports: Map<string, Set<number>>, f: string, nets: Set<number>) => {
  const mine = ports.get(f);
  if (!mine) return false;
  for (const n of mine) if (nets.has(n)) return true;
  return false;
};

/** 관망들에 붙은 머신(자기 빼고). */
function around(g: FlowGraph, nets: Set<number>, side: 'in' | 'out', self: number): Set<number> {
  const out = new Set<number>();
  const book = side === 'in' ? g.netConsumers : g.netProducers;
  for (const n of nets) for (const m of book.get(n) ?? []) if (m !== self) out.add(m);
  return out;
}

/**
 * 관망 하나를 다투는 머신의 **뜻** — 이 유체 말고 다른 까닭으로는 얼마까지 돌 수 있나.
 *
 * 관망에는 우선순위가 없어 모자라면 비례로 나누는데, 다투는 쪽을 실제 `u` 로 두면 그 `u` 가 **바로 이
 * 관망 탓에** 줄어든 값이라 나눠 갖기가 스스로를 깎는다(소비자 둘이 10 을 나누면 0.5 씩이어야 하는데
 * 0.618 로 수렴했다 — `u = 1/(1+u)`). 그래서 이 유체를 뺀 나머지 까닭으로만 잰다:
 * 소비자는 `min(배출 능력, 다른 재료의 공급 비율)`, 생산자는 `min(공급 능력, 다른 산출의 배출 비율)`.
 */
const consumeIntent = (st: SolveState, c: number, f: string) => Math.min(st.ud[c], minOf(st.usParts.get(c), f));
const produceIntent = (st: SolveState, p: number, f: string) => Math.min(st.us[p], minOf(st.udParts.get(p), f));

/** 공급 탐침(유체) — 이 머신이 100% 로 먹으려 하면 유체마다 받을 수 있는 양. */
function fluidSupply(g: FlowGraph, st: SolveState, m: number): ItemMap {
  const mn = g.machines[m];
  const got: ItemMap = new Map();
  if (mn.fluid.unresolved) {
    for (const [f, need] of mn.rates!.needsFluid) got.set(f, need); // 연결을 모른다 — 낙관(판정 불가)
    return got;
  }
  for (const [f, need] of mn.rates!.needsFluid) {
    const nets = mn.fluid.in.get(f) ?? new Set<number>();
    if ([...nets].some((n) => g.nets[n].infiniteSupply.has(f))) {
      got.set(f, need);
      continue;
    }
    let supply = 0;
    for (const p of around(g, nets, 'out', m)) {
      if (touches(g.machines[p].fluid.out, f, nets)) supply += (g.machines[p].rates!.makesFluid.get(f) ?? 0) * produceIntent(st, p, f);
    }
    let others = 0;
    for (const c of around(g, nets, 'in', m)) {
      if (touches(g.machines[c].fluid.in, f, nets)) others += (g.machines[c].rates!.needsFluid.get(f) ?? 0) * consumeIntent(st, c, f);
    }
    got.set(f, supply >= need + others - EPS ? need : (supply * need) / (need + others));
  }
  return got;
}

/** 배출 탐침(유체) — 이 머신이 100% 로 만들려 하면 유체마다 내보낼 수 있는 양. */
function fluidDrain(g: FlowGraph, st: SolveState, m: number): ItemMap {
  const mn = g.machines[m];
  const sent: ItemMap = new Map();
  if (mn.fluid.unresolved) {
    for (const [f, made] of mn.rates!.makesFluid) sent.set(f, made);
    return sent;
  }
  for (const [f, made] of mn.rates!.makesFluid) {
    const nets = mn.fluid.out.get(f) ?? new Set<number>();
    const ns = [...nets].map((n) => g.nets[n]);
    if (ns.some((n) => n.infiniteSink.has(f) || n.infiniteSink.has('*'))) {
      sent.set(f, made);
      continue;
    }
    // 공급 무한파이프가 붙어 있으면 관망은 늘 차 있다 — 넣을 자리가 없다.
    if (ns.some((n) => n.infiniteSupply.has(f))) {
      sent.set(f, 0);
      continue;
    }
    let drain = 0;
    for (const c of around(g, nets, 'in', m)) {
      if (touches(g.machines[c].fluid.in, f, nets)) drain += (g.machines[c].rates!.needsFluid.get(f) ?? 0) * consumeIntent(st, c, f);
    }
    let others = 0;
    for (const p of around(g, nets, 'out', m)) {
      if (touches(g.machines[p].fluid.out, f, nets)) others += (g.machines[p].rates!.makesFluid.get(f) ?? 0) * produceIntent(st, p, f);
    }
    sent.set(f, drain >= made + others - EPS ? made : (drain * made) / (made + others));
  }
  return sent;
}

/**
 * 비율 표가 없을 때 — 그 품목에 **닿는** 팔끼리 균등. 판 벨트의 팔에 선 몫을 나눠 주면 그 몫은
 * 영영 안 쓰이고, 첫 판들이 실제보다 적은 수요로 풀려 이웃을 끌어내린다.
 */
function defaultWeight(g: FlowGraph, m: number, k: number, item: string, side: 'in' | 'out'): number {
  if (side === 'out') return 1 / g.machines[m].armsOut.length;
  const reach = g.machines[m].armsIn.filter((a) => canBring(g, a, item));
  return reach.includes(k) ? 1 / reach.length : 0;
}

/** 팔 k 의 픽업 쪽이 이 품목을 내놓을 수 있나 — 벨트면 그 성분 어딘가에서 넣는 것. */
export function canBring(g: FlowGraph, k: number, item: string): boolean {
  const from = g.arms[k].from;
  if (from.kind === 'chest') return g.chests[from.c].role.supply.has(item) || g.chests[from.c].role.relay;
  if (from.kind === 'machine') {
    const r = g.machines[from.m].rates;
    return !!r && (r.makes.has(item) || r.unknownYield.has(item));
  }
  if (from.kind !== 'belt') return false;
  const c = g.comps[g.belts[from.cell].comp];
  return c.anyItem || c.items.has(item);
}

/** 비율 표가 얼마나 바뀌었나. 처음(표 없음)은 바뀐 것으로 친다 — 한 바퀴 더 돌게. */
function weightDelta(prev: ItemMap | undefined, next: ItemMap): number {
  if (!prev) return next.size > 0 ? 1 : 0;
  let d = 0;
  const keys = new Set([...prev.keys(), ...next.keys()]);
  for (const it of keys) d = Math.max(d, Math.abs((prev.get(it) ?? 0) - (next.get(it) ?? 0)));
  return d;
}

/**
 * 중계를 다음 판으로 넘긴다. 재고 = 이번에 들어온 것 · 받을 양 = 이번에 나간 양(재고를 다 내보냈으면
 * 무제한). 바뀐 크기를 낸다.
 */
function updateRelays(g: FlowGraph, st: SolveState, relays: number[], r: PassRecord): number {
  let delta = 0;
  for (const c of relays) {
    const ch = g.chests[c];
    const stock: ItemMap = new Map();
    for (const k of ch.armsIn) for (const [it, x] of r.picked.get(k) ?? []) add(stock, it, x);
    let out = 0;
    for (const k of ch.armsOut) out += sum(r.dropped.get(k));
    const had = sum(st.relayStock.get(c));
    const drain = out >= had - EPS ? Infinity : out;
    delta = Math.max(delta, Math.abs(sum(stock) - had));
    st.relayStock.set(c, stock);
    st.relayDrain.set(c, drain);
  }
  for (const k of g.transfers) {
    const stock = new Map(r.picked.get(k) ?? []);
    const had = sum(st.armStock.get(k));
    const out = sum(r.dropped.get(k));
    const drain = out >= had - EPS ? g.arms[k].cap : out;
    delta = Math.max(delta, Math.abs(sum(stock) - had));
    st.armStock.set(k, stock);
    st.armDrain.set(k, drain);
  }
  return delta;
}
