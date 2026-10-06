/**
 * cut — **벨트 줄을 어디서 끊나.** 붓기가 낸 줄의 경계를 다시 고른다.
 *
 * ## 왜 끊는 자리를 고르나 — split belt 할당량 문제
 *
 * 줄이 바뀌는 경계가 머신 한 대의 몫 위에 떨어지면 그 머신이 두 줄을 쓴다. 그 머신을 두 줄 모두의 맨 끝에 세우면 몫을
 * 벨트가 정하는데(`./lineOrder`), **한 줄의 맨 끝 자리는 편마다 하나뿐이다.** 한 줄의 위 경계와 아래 경계가 **같은 편**의
 * 머신을 가르면 그 줄의 양끝에 두 줄을 쓰는 머신이 서고, 방향으로는 한 대만 맨 끝이 된다.
 *
 * ```
 * 경계 하나가 가르는 것 — 그 앞뒤 흐름을 보면 안다
 *   주는 머신이 같다(받는 머신이 바뀐다)   → 주는 머신이 갈린다
 *   받는 머신이 같다(주는 머신이 바뀐다)   → 받는 머신이 갈린다
 *   둘 다 바뀐다                          → 아무도 안 갈린다
 *
 * 지킬 것 — 한 줄의 위 · 아래 경계가 같은 편을 연달아 가르지 않는다
 *          (그 줄을 그 편에서 한 대만 쓰면 괜찮다 — 그 머신은 그 줄을 혼자 쓴다)
 * ```
 *
 * 붓기(`./link.createLinks`)는 *"줄이 찬 곳"* 에서 끊는다. 줄들에 남는 자리가 있으면 같은 줄 수로 위 조건을 지키는 다른
 * 끊는 자리가 있을 수 있다 — 여기서 찾는다. **줄을 늘리지는 않는다**: 받은 줄 수 안에서 못 찾으면 답이 없다(`undefined`).
 *
 * 흐름은 안 쪼갠다 — 경계는 흐름과 흐름 사이에만 둔다. 흐름 하나가 줄 여럿에 걸친 붓기(몫이 벨트 한 줄보다 큰 머신)는
 * 여기서 다루지 않는다.
 *
 * 여기엔 자리도 좌표도 없다 — 흐름 목록과 상한만 본다.
 */

import type { LinkCarry } from "../types/line";

/** [chooseCuts] 가 보는 상한 — 붓기와 같은 것들이다. */
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

/**
 * 줄 하나(`[j, i)` 의 흐름들)가 조건을 지키나 — 위 · 아래 경계가 같은 편을 연달아 가르면서 그 편에 머신이 둘 이상이면 어긴다.
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
 * **끊는 자리들이 조건을 어기나** — 양끝에 두 줄을 쓰는 머신이 선 줄이 있나.
 *
 * @param cuts 새 줄이 시작하는 흐름 index 들(오름차순 · 0 과 끝은 뺀다).
 */
export function hasContestedLine(flows: ReadonlyArray<LinkCarry>, cuts: ReadonlyArray<number>): boolean {
  const bounds = [0, ...cuts, flows.length];
  for (let k = 0; k + 1 < bounds.length; k++) if (!lineKeepsOrder(flows, bounds[k], bounds[k + 1])) return true;
  return false;
}

/** 끊는 자리들이 그 편에서 가르는 머신 수 — 경계마다 하나씩 센다. */
export function splitCount(flows: ReadonlyArray<LinkCarry>, cuts: ReadonlyArray<number>, side: "from" | "to"): number {
  return cuts.filter((i) => splitsAt(flows, i, side)).length;
}

/**
 * **조건을 지키는 끊는 자리** — 줄 수가 가장 적은 것, 그중 **받는 머신**을 가장 적게 가르는 것, 그중 주는 머신을 가장 적게
 * 가르는 것, 그중 앞 줄을 가장 많이 채우는 것.
 *
 * **받는 쪽을 먼저 아낀다** — 갈린 머신은 줄마다 인서터가 하나씩 더 든다. 주는 머신의 면은 그 머신의 산출물 하나가 쓰지만
 * 받는 머신의 면은 재료 품목 여럿이 나눠 쓴다. 이 함수는 한 품목만 보므로 다른 품목이 얼마를 쓰는지 모른다 — 그래서
 * 받는 쪽 가름을 싸게 치지 않는다(2026-10-06 실측: 재료가 둘인 부모에서 받는 쪽으로 가름을 옮기자 좌석이 모자라 배치가 실패했다).
 *
 * @param maxLines 줄 수의 상한 — 이보다 많이는 안 쓴다(붓기가 낸 줄 수를 준다).
 * @returns 새 줄이 시작하는 흐름 index 들. 그 줄 수 안에 답이 없으면 `undefined`.
 */
export function chooseCuts(
  flows: ReadonlyArray<LinkCarry>,
  maxLines: number,
  limits: CutLimits,
): number[] | undefined {
  const m = flows.length;
  if (m === 0) return [];
  /** 줄 `[j, i)` 를 순번 `lineIndex` 로 실을 수 있나 — 줄의 상한 · 머신마다의 상한 · 순서 조건. */
  const fits = (j: number, i: number, lineIndex: number): boolean => {
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
