/**
 * cut — **벨트 줄을 어디서 끊나.** 붓기가 낸 줄의 경계를 다시 정한다.
 *
 * ## 왜 끊는 자리를 보나 — split belt 할당량 문제
 *
 * 줄이 바뀌는 경계가 머신 한 대의 몫 위에 떨어지면 그 머신이 두 줄을 쓴다. 한 머신의 인서터들은 제 몫의 **반**을 옮기려 하고,
 * 벨트에 남은 자리(남은 물건)가 그보다 적을 때만 덜 옮긴다(`docs/analysis/flow-model.md` §2.3). 그래서 두 몫 가운데
 * **작은 쪽은 "그 줄에 남는 만큼" 으로만 정해진다** — 그 머신이 그 줄의 맨 끝에 서야 하는 까닭이다(`./lineOrder`).
 *
 * **한 줄에 남는 만큼을 갖는 머신이 둘이면 정해지지 않는다.** 같은 편의 둘이면 먼저 방문받는 쪽이 반을 옮기고, 주는 쪽 하나 ·
 * 받는 쪽 하나면 서로가 서로의 남는 양이라 반반 근처에서 굳는다.
 *
 * ```
 * 경계 하나가 가르는 것 — 그 앞뒤 흐름을 보면 안다
 *   주는 머신이 같다(받는 머신이 바뀐다)   → 주는 머신이 갈린다
 *   받는 머신이 같다(주는 머신이 바뀐다)   → 받는 머신이 갈린다
 *   둘 다 바뀐다                          → 아무도 안 갈린다
 *
 * 경계마다 화살표 하나 — 갈린 머신의 두 몫 가운데 작은 쪽이 놓인 줄(위 줄 · 아래 줄). 반반이면 화살표가 없다
 *
 * 지킬 것 — **한 줄이 위 경계와 아래 경계 양쪽에서 작은 몫을 받지 않는다**
 *
 *   15       |       15        |       15            자식 9/s 다섯 → 부모 5/s 아홉. 붓기 그대로
 *   자식1 6 | 3 ▶         ◀ 3 | 6 자식3               가운데 줄이 양쪽에서 받는다 — 부모 한 대가 70%
 *
 *   15       |     10     |     10     |   10        위에서부터 다시 끊은 것
 *   자식1 6 | 3 ▶  자식2 7 | 2 ▶  자식3 8 | 1 ▶        줄마다 하나 — 전부 100%
 * ```
 *
 * ## 찾지 않고 짓는다 — 위에서부터 한 번
 *
 * 붓기(`./link.createLinks`)는 줄을 가득 채우고 다 안 들어가는 자리에서 끊는다. [cutFromTop] 은 같은 일을 하되 하나를 더 본다:
 *
 * ```
 * 위 경계에서 작은 몫을 받은 줄은, 아래 경계에서 또 받게 되는 자리에서는 끊지 않는다 —
 * 그 줄이 방문하는 머신을 덜어 내 더 일찍 끊는다(또 받지 않는 가장 먼 자리). 덜어 낸 머신은 다음 줄이 맡는다
 * ```
 *
 * 줄 하나를 정할 때 보는 것은 **그 줄의 위 경계 하나**뿐이고 정한 줄은 되돌리지 않는다. 그래서 답을 손으로 따라갈 수 있다 —
 * 조건을 어기지 않는 붓기는 한 줄도 안 바뀌고(같은 규칙이 같은 자리에서 끊는다), 바뀌는 곳은 작은 몫을 둘 받던 줄과 그 아래뿐이다.
 * **줄이 하나 늘 수 있다** — 한 줄이 방문하는 머신 수를 줄이면 덜어 낸 머신을 맡을 줄이 더 든다. 얼마까지 늘어도 되나는
 * 부르는 쪽이 정한다(`maxLines`). 주는 쪽 · 받는 쪽을 가리지 않는다 — 끊는 자리가 어느 편의 경계로 옮겨 가느냐일 뿐이다.
 *
 * 흐름은 안 쪼갠다 — 경계는 흐름과 흐름 사이에만 둔다. 흐름 하나가 줄 여럿에 걸친 붓기(몫이 벨트 한 줄보다 큰 머신)는
 * 여기서 다루지 않는다. 머신 한 대가 **세 줄**에 갈리는 끊기도 새로 만들지 않는다 — 인서터 셋이 몫을 어떻게 나누는지는 정한 적이 없다.
 *
 * ## 받는 면을 다른 재료와 나눠 쓰는 간선 — 혼자서는 안 바꾸고, 재료들을 함께 끊는다
 *
 * 줄이 늘거나 받는 머신이 새로 갈리면 그 면의 좌석을 더 쓰는데, 붓기는 한 품목만 보므로 다른 품목이 얼마를 쓰는지 모른다.
 * 그래서 그런 간선의 붓기는 맨 아래 「옛 조건」 의 두 함수로 같은 줄 수 안에서만 다시 끊는다. 작은 몫을 둘 받는 줄이 남으면
 * 그 면의 재료들을 **함께** 다시 끊는다([receiversPerLineTogether] — 부르는 곳은 재료를 다 아는 `link/policy/delivery`):
 * 줄마다 방문하는 받는 머신 수를 재료들이 같이 쓴다.
 *
 * 여기엔 자리도 좌표도 없다 — 흐름 목록과 상한만 본다.
 */

import type { LinkCarry } from "../types/line";

/** 끊는 자리를 정할 때 보는 상한 — 붓기와 같은 것들이다. */
export interface CutLimits {
  /** 줄 순번(0부터) → 그 줄에 실을 수 있는 양(벨트 한 줄의 상한). */
  capOf: (lineIndex: number) => number;
  /** 한 줄이 주는 머신 한 대와 주고받는 최대. 밖이면 `Infinity`. */
  fromSeat: number;
  /** 한 줄이 받는 머신 한 대와 주고받는 최대. 밖이면 `Infinity`. */
  toSeat: number;
}

const EPS = 1e-9;

/** 경계 `i`(흐름 `i − 1` 과 `i` 사이)가 그 편의 머신을 가르나. 맨 앞 · 맨 뒤는 아무도 안 가른다. */
function splitsAt(flows: ReadonlyArray<LinkCarry>, i: number, side: "from" | "to"): boolean {
  if (i <= 0 || i >= flows.length) return false;
  const a = flows[i - 1][side];
  return a !== undefined && a === flows[i][side];
}

/** 끊는 자리들이 그 편에서 가르는 머신 수 — 경계마다 하나씩 센다. */
export function splitCount(flows: ReadonlyArray<LinkCarry>, cuts: ReadonlyArray<number>, side: "from" | "to"): number {
  return cuts.filter((i) => splitsAt(flows, i, side)).length;
}

/** 줄 `[j, i)` 를 순번 `lineIndex` 로 실을 수 있나 — 줄의 상한 · 머신마다의 상한. */
function fitsLine(flows: ReadonlyArray<LinkCarry>, j: number, i: number, lineIndex: number, limits: CutLimits): boolean {
  let load = 0;
  const per = { from: new Map<number, number>(), to: new Map<number, number>() };
  for (let k = j; k < i; k++) {
    load += flows[k].rate;
    for (const side of ["from", "to"] as const) {
      const mi = flows[k][side];
      if (mi !== undefined) per[side].set(mi, (per[side].get(mi) ?? 0) + flows[k].rate);
    }
  }
  if (load > limits.capOf(lineIndex) + EPS) return false;
  for (const v of per.from.values()) if (v > limits.fromSeat + EPS) return false;
  for (const v of per.to.values()) if (v > limits.toSeat + EPS) return false;
  return true;
}

/** [smallShareAt] 가 경계 하나에 낸 답. */
interface SmallShare {
  /** 작은 몫이 놓인 줄 — 경계의 위 줄 · 아래 줄. 아무도 안 갈리거나 반반이면 `undefined`. */
  line: "upper" | "lower" | undefined;
  /** 이 경계가 머신을 가르나(반반이어도 참). */
  splits: boolean;
  /** 그 머신의 몫이 위 줄보다 앞에서 시작했거나 아래 줄을 넘어간다 — 세 줄째다. */
  spansMore: boolean;
  /** 그 머신의 몫이 끝나는 흐름 index(끝 미포함). 안 가르면 경계 자신. */
  restEnd: number;
}

/**
 * **경계 `cut` 이 가른 머신의 작은 몫이 어느 줄에 놓이나.**
 *
 * 위 줄의 몫은 그 머신이 경계 앞에서 연달아 맡은 양, 아래 줄의 몫은 경계 뒤에서 연달아 맡을 양이다(한 줄이 맡는 머신은
 * 연속 구간이라 그 둘이 전부다 — `link/arith/flows.allocateFlows`).
 *
 * @param upperStart 위 줄이 시작하는 흐름 index.
 * @param lowerEnd 아래 줄이 끝나는 흐름 index(끝 미포함). 아직 안 정했으면 비운다 — 그 머신의 남은 몫이 전부 아래 줄에 실린다고 본다.
 */
function smallShareAt(flows: ReadonlyArray<LinkCarry>, upperStart: number, cut: number, lowerEnd = flows.length): SmallShare {
  const side = splitsAt(flows, cut, "from") ? "from" : splitsAt(flows, cut, "to") ? "to" : undefined;
  if (side === undefined) return { line: undefined, splits: false, spansMore: false, restEnd: cut };
  const machine = flows[cut][side];
  let upper = 0;
  let first = cut;
  while (first > 0 && flows[first - 1][side] === machine) {
    first -= 1;
    if (first >= upperStart) upper += flows[first].rate;
  }
  let lower = 0;
  let restEnd = cut;
  while (restEnd < flows.length && flows[restEnd][side] === machine) {
    if (restEnd < lowerEnd) lower += flows[restEnd].rate;
    restEnd += 1;
  }
  return {
    line: upper < lower - EPS ? "upper" : lower < upper - EPS ? "lower" : undefined,
    splits: true,
    spansMore: first < upperStart || restEnd > lowerEnd,
    restEnd,
  };
}

/**
 * **작은 몫을 둘 받는 줄** — 위 경계가 가른 머신도 아래 경계가 가른 머신도 작은 몫을 이 줄에 둔 줄들의 순번.
 * 비어 있으면 그 끊는 자리들은 조건을 지킨다.
 *
 * @param cuts 새 줄이 시작하는 흐름 index 들(오름차순 · 0 과 끝은 뺀다).
 */
export function linesTakingTwoSmallShares(flows: ReadonlyArray<LinkCarry>, cuts: ReadonlyArray<number>): number[] {
  const bounds = [0, ...cuts, flows.length];
  const out: number[] = [];
  let fromAbove = false;
  for (let k = 0; k + 2 < bounds.length; k++) {
    const small = smallShareAt(flows, bounds[k], bounds[k + 1], bounds[k + 2]).line;
    if (small === "upper" && fromAbove) out.push(k);
    fromAbove = small === "lower";
  }
  return out;
}

/**
 * **위에서부터 끊는다** — 줄을 가득 채우되, 위 경계에서 작은 몫을 받은 줄은 아래 경계에서 또 받지 않는 가장 먼 자리에서 끊는다
 * (그 줄이 방문하는 머신이 그만큼 준다).
 *
 * 한 번 지나가며 정하고 되돌리지 않는다(머리말 「찾지 않고 짓는다」). 줄 하나의 아래 경계로 못 쓰는 자리는 셋이다:
 *
 * ```
 * ① 이 줄이 위에서 작은 몫을 받았는데, 그 자리가 가르는 머신도 작은 몫을 이 줄에 둔다
 * ② 위 경계가 가른 머신의 남은 몫이 아직 안 끝났다          — 거기서 끊으면 그 머신이 세 줄을 쓴다
 * ③ 그 자리가 가르는 머신의 몫이 이 줄보다 앞에서 시작했다   — 같은 까닭
 * ```
 *
 * @param maxLines 줄 수의 상한 — 이보다 많이 들면 답이 없다.
 * @returns 새 줄이 시작하는 흐름 index 들. 그 줄 수 안에 못 끊으면 `undefined`.
 */
export function cutFromTop(
  flows: ReadonlyArray<LinkCarry>,
  maxLines: number,
  limits: CutLimits,
): number[] | undefined {
  const m = flows.length;
  const cuts: number[] = [];
  let start = 0;
  /** 이 줄이 위 경계에서 작은 몫을 받았나. */
  let fromAbove = false;
  /** 위 경계가 가른 머신의 남은 몫이 끝나는 곳 — 이 줄은 적어도 거기까지 맡는다. */
  let restEnd = 0;
  while (start < m) {
    if (cuts.length + 1 > maxLines) return undefined;
    let end = -1;
    let small: SmallShare | undefined;
    for (let i = m; i > start && i >= restEnd; i--) {
      if (!fitsLine(flows, start, i, cuts.length, limits)) continue;
      if (i === m) { end = m; break; }
      const s = smallShareAt(flows, start, i);
      if (s.spansMore || (fromAbove && s.line === "upper")) continue;
      end = i;
      small = s;
      break;
    }
    if (end < 0) return undefined;
    if (end === m || small === undefined) break;
    cuts.push(end);
    fromAbove = small.line === "lower";
    restEnd = small.splits ? small.restEnd : 0;
    start = end;
  }
  return cuts;
}

/** [receiversPerLineTogether] 가 재료 하나에 대해 받는 것. */
export interface FlowsOnSharedFace {
  flows: ReadonlyArray<LinkCarry>;
  /** 이 재료가 쓸 수 있는 줄 수의 상한. */
  maxLines: number;
  limits: CutLimits;
}

/**
 * **한 면을 나눠 쓰는 재료들이 받는 머신을 같은 묶음으로 방문한다** — 줄마다 방문하는 받는 머신 수를 위에서부터 정한다.
 *
 * 받는 머신의 한 면에 재료가 둘 이상 앉으면 재료마다 줄이 따로 서는데, 안쪽 세로줄에 선 줄의 출입구는 바깥 세로줄을 가로질러
 * 나간다. **두 재료의 줄이 끝나는 자리가 다르면** 그 출입구가 남의 줄 한가운데를 지나야 한다(합성 판에서 좌석의 *구간막힘* 은
 * 전부 그런 판에서 났다). 그래서 그런 면에서는 재료 하나만 따로 다시 끊지 않고, **줄마다 방문하는 받는 머신 수를 재료들이 함께
 * 쓴다** — 한 재료가 한 대를 덜 방문해야 하면 다른 재료의 그 줄도 덜 방문한다.
 *
 * ```
 * 받는 머신 경계에서만 끊는다     받는 머신은 안 갈린다(갈린 머신은 그 면의 좌석을 하나 더 쓴다) — 갈리는 것은 주는 머신뿐이다
 * 줄마다 가장 많이 방문한다       모든 재료가 그 수를 실을 수 있고, 어느 재료의 줄도 작은 몫을 두 번 받지 않는 가장 큰 수
 * ```
 *
 * [cutFromTop] 을 재료 여럿에 나란히 돌린 것이다 — 한 번 지나가며 정하고 되돌리지 않는다.
 *
 * @param receiverCount 받는 머신 수. 흐름의 `to` 는 `0 … receiverCount − 1` 이고 재료마다 받는 머신 전부에 댄다.
 * @returns 줄마다 방문하는 받는 머신 수(위에서부터 · 합 = `receiverCount`). 어느 재료든 상한 안에 못 끊으면 `undefined`.
 */
export function receiversPerLineTogether(
  materials: ReadonlyArray<FlowsOnSharedFace>,
  receiverCount: number,
): number[] | undefined {
  /** 재료마다 — 받는 머신 `r` 의 몫이 시작하는 흐름 index(`receiverCount` 는 끝). */
  const startOf = materials.map(({ flows }) => {
    const at: number[] = [];
    let i = 0;
    for (let r = 0; r <= receiverCount; r++) {
      while (i < flows.length && (flows[i].to ?? 0) < r) i += 1;
      at.push(i);
    }
    return at;
  });
  const state = materials.map(() => ({ fromAbove: false, restEnd: 0 }));
  const perLine: number[] = [];
  let first = 0;
  while (first < receiverCount) {
    const line = perLine.length;
    if (materials.some((m) => line + 1 > m.maxLines)) return undefined;
    let count = 0;
    let smalls: (SmallShare | undefined)[] = [];
    for (let n = receiverCount - first; n >= 1 && count === 0; n--) {
      const got: (SmallShare | undefined)[] = [];
      const ok = materials.every((m, k) => {
        const start = startOf[k][first];
        const end = startOf[k][first + n];
        if (end <= start || !fitsLine(m.flows, start, end, line, m.limits)) return false;
        if (end === m.flows.length) { got.push(undefined); return true; }
        if (end < state[k].restEnd) return false;
        const s = smallShareAt(m.flows, start, end);
        if (s.spansMore || (state[k].fromAbove && s.line === "upper")) return false;
        got.push(s);
        return true;
      });
      if (ok) { count = n; smalls = got; }
    }
    if (count === 0) return undefined;
    perLine.push(count);
    smalls.forEach((s, k) => {
      state[k].fromAbove = s?.line === "lower";
      state[k].restEnd = s?.splits ? s.restEnd : 0;
    });
    first += count;
  }
  return perLine;
}

// ─────────────────────────────────────────────────────────────────────────────
// 옛 조건 — 받는 면을 다른 재료와 나눠 쓰는 간선만 쓴다
// ─────────────────────────────────────────────────────────────────────────────
//
// 이 자리를 고치기 전에 tempPlanDocs/재료-둘-이상-부모/judgements.md 를 본다 — 아직 안 고른 판단이 있다(J-함께-못-끊는-면).
//
// 2026-10-06 의 조건이다: *한 줄의 위 · 아래 경계가 같은 편의 머신을 연달아 가르지 않는다*(두 줄을 쓰는 머신을 그 줄들
// **모두**에서 맨 끝에 세우려던 것). 위 조건과 견주면 양쪽으로 어긋난다 — 멀쩡한 줄(작은 몫이 하나뿐인 줄)을 어겼다고 보고,
// 주는 쪽 하나 · 받는 쪽 하나가 작은 몫을 한 줄에 둔 것은 못 본다. 그래도 나눠 쓰는 면에서는 이 조건이 다시 끊은 줄이 좌석에
// 앉는 판이 많다(붓기 그대로 두면 합성 83판 중 4판이 새로 못 선다). 재료들을 함께 끊는 쪽([receiversPerLineTogether])이
// 못 끊은 면에서는 이 답이 그대로 남는다.

/**
 * 줄 하나(`[j, i)` 의 흐름들)가 옛 조건을 지키나 — 위 · 아래 경계가 같은 편을 연달아 가르면서 그 편에 머신이 둘 이상이면 어긴다.
 */
function lineKeepsOrder(flows: ReadonlyArray<LinkCarry>, j: number, i: number): boolean {
  for (const side of ["from", "to"] as const) {
    if (!splitsAt(flows, j, side) || !splitsAt(flows, i, side)) continue;
    const first = flows[j][side];
    for (let k = j + 1; k < i; k++) if (flows[k][side] !== first) return false;
  }
  return true;
}

/**
 * **끊는 자리들이 옛 조건을 어기나** — 같은 편의 양끝에 두 줄을 쓰는 머신이 선 줄이 있나.
 *
 * @param cuts 새 줄이 시작하는 흐름 index 들(오름차순 · 0 과 끝은 뺀다).
 */
export function hasLineSplitAtBothEnds(flows: ReadonlyArray<LinkCarry>, cuts: ReadonlyArray<number>): boolean {
  const bounds = [0, ...cuts, flows.length];
  for (let k = 0; k + 1 < bounds.length; k++) if (!lineKeepsOrder(flows, bounds[k], bounds[k + 1])) return true;
  return false;
}

/**
 * **옛 조건을 지키는 끊는 자리** — 줄 수가 가장 적은 것, 그중 **받는 머신**을 가장 적게 가르는 것, 그중 주는 머신을 가장 적게
 * 가르는 것, 그중 앞 줄을 가장 많이 채우는 것. 줄은 늘리지 않는다.
 *
 * **받는 쪽을 먼저 아낀다** — 갈린 머신은 줄마다 인서터가 하나씩 더 든다. 주는 머신의 면은 그 머신의 산출물 하나가 쓰지만
 * 받는 머신의 면은 재료 품목 여럿이 나눠 쓴다(2026-10-06 실측: 재료가 둘인 부모에서 받는 쪽으로 가름을 옮기자 좌석이 모자라
 * 배치가 실패했다).
 *
 * @param maxLines 줄 수의 상한 — 이보다 많이는 안 쓴다(붓기가 낸 줄 수를 준다).
 * @returns 새 줄이 시작하는 흐름 index 들. 그 줄 수 안에 답이 없으면 `undefined`.
 */
export function chooseCutsWithinLines(
  flows: ReadonlyArray<LinkCarry>,
  maxLines: number,
  limits: CutLimits,
): number[] | undefined {
  const m = flows.length;
  if (m === 0) return [];
  /** 줄 `[j, i)` 를 순번 `lineIndex` 로 실을 수 있나 — 줄의 상한 · 머신마다의 상한 · 순서 조건. */
  const fits = (j: number, i: number, lineIndex: number): boolean => {
    if (!fitsLine(flows, j, i, lineIndex, limits)) return false;
    // **고를 때는 더 엄하다** — 위 · 아래 경계가 같은 편을 연달아 가르는 줄은 그 편에 머신이 하나뿐이어도 안 낸다.
    // 그 머신은 줄을 **셋** 쓰게 되고(위 줄 · 이 줄 · 아래 줄) 인서터도 셋이 든다 — 붓기가 안 만든 모양을 새로 만들지 않는다.
    return !(["from", "to"] as const).some((side) => splitsAt(flows, j, side) && splitsAt(flows, i, side));
  };
  /** 경계 `i` 의 값 — 받는 머신을 가르면 크게, 주는 머신을 가르면 작게(받는 쪽 가름 하나가 주는 쪽 가름 전부보다 비싸다). */
  const TO_WEIGHT = flows.length + 1;
  const splitCost = (i: number): number =>
    Number(splitsAt(flows, i, "to")) * TO_WEIGHT + Number(splitsAt(flows, i, "from"));

  for (let n = 1; n <= maxLines; n++) {
    // rest[k][j] — 흐름 `j` 부터 끝까지를 줄 `k` 개로 끊을 때 가름 값의 최소(못 끊으면 Infinity).
    // 그 `k` 개의 첫 줄은 전체에서 순번 `n − k` 다.
    const rest: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(Infinity));
    rest[0][m] = 0;
    for (let k = 1; k <= n; k++) {
      for (let j = m - 1; j >= 0; j--) {
        let best = Infinity;
        for (let i = j + 1; i <= m; i++) {
          if (rest[k - 1][i] === Infinity || !fits(j, i, n - k)) continue;
          best = Math.min(best, splitCost(i) + rest[k - 1][i]);
        }
        rest[k][j] = best;
      }
    }
    if (rest[n][0] === Infinity) continue;
    // 앞 줄부터 가장 많이 채운다 — 같은 값이면 가장 뒤의 경계.
    const cuts: number[] = [];
    let j = 0;
    for (let k = n; k >= 1; k--) {
      let pick = -1;
      for (let i = m; i > j; i--) {
        if (rest[k - 1][i] === Infinity || !fits(j, i, n - k)) continue;
        if (splitCost(i) + rest[k - 1][i] === rest[k][j]) { pick = i; break; }
      }
      if (pick < m) cuts.push(pick);
      j = pick;
    }
    return cuts;
  }
  return undefined;
}
