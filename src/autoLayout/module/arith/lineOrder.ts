/**
 * lineOrder — **벨트 줄 위에서 머신이 서는 순서.** 누가 그 줄의 맨 끝인가.
 *
 * ## 왜 순서를 보나 — split belt 할당량 문제
 *
 * 머신 한 대가 한 품목에 벨트 줄을 둘 이상 쓰면([[split belt]]), 줄마다 얼마를 싣고 집는지를 인서터는 정해 주지
 * 않는다(`docs/용어사전.md` §split belt 할당량 문제). 정해 주는 것은 **벨트 위의 순서**다 — 앞선 머신이 먼저 싣고
 * 먼저 집으므로, 맨 끝 머신은 벨트에 남은 것만 갖는다(`docs/analysis/flow-model.md` §2.1). 그래서 두 줄을 쓰는
 * 머신이 그 줄들에서 **맨 끝**에 서 있으면 그 머신의 몫은 줄의 구조가 정한다.
 *
 * ## 맨 끝은 편마다 다르게 읽는다
 *
 * ```
 * 싣는 쪽(from)   벨트가 포트 쪽 끝으로 흐른다       → 맨 끝 = 그 끝에 **가장 가까운** 머신
 * 집는 쪽(to)     포트에서 들어와 반대쪽으로 흐른다   → 맨 끝 = 그 끝에서 **가장 먼** 머신
 * ```
 *
 * *포트 쪽 끝* 이 [flowEnd](./trunk.ts) 다(관통 줄은 `portEnd`, 구간 줄은 `exitEnd`). 머신 index 는 위에서 아래로 는다.
 *
 * 여기엔 자리도 좌표도 없다 — 줄의 적재 목록과 끝 하나만 본다. 형제 모듈도 모른다(한 모듈의 한 편만 본다).
 */

import type { Link } from "../types/line";

/** 줄의 어느 편인가 — 싣는 쪽(`from`) · 집는 쪽(`to`). */
export type LineSide = "from" | "to";

/** 그 편에서 이 줄을 쓰는 머신들 — 위에서 아래로. */
export function machinesOnSide(line: Link, side: LineSide): number[] {
  return [...line[side].keys()].sort((a, b) => a - b);
}

/** 그 머신이 이 줄에 맡긴 양(초당). 적재 목록이 없으면 `undefined`. */
export function shareOnLine(line: Link, side: LineSide, machine: number): number | undefined {
  if (!line.carries) return undefined;
  return line.carries.reduce((sum, c) => (c[side] === machine ? sum + c.rate : sum), 0);
}

/**
 * **그 줄에서 그 편의 맨 끝 머신** — 마지막으로 싣는(집는) 머신. 그 편에 머신이 없으면(모듈 밖) `undefined`.
 *
 * @param flowEnd 포트 쪽 끝([flowEnd](./trunk.ts)).
 */
export function lastMachineOn(line: Link, side: LineSide, flowEnd: "N" | "S"): number | undefined {
  const ms = machinesOnSide(line, side);
  if (ms.length === 0) return undefined;
  const nearestToEnd = flowEnd === "S" ? ms[ms.length - 1] : ms[0];
  const farthestFromEnd = flowEnd === "S" ? ms[0] : ms[ms.length - 1];
  return side === "from" ? nearestToEnd : farthestFromEnd;
}

/**
 * **그 머신을 그 줄의 맨 끝에 세우는 끝** — [lastMachineOn] 의 역이다.
 *
 * ```
 * "N" · "S"   그 끝으로 흘러야 그 머신이 맨 끝이다
 * "any"       그 편에 그 머신 혼자다 — 어느 끝이든 맨 끝이다
 * undefined   그 머신이 구간의 가운데에 있다 — 어느 끝으로 흘러도 맨 끝이 못 된다
 * ```
 */
export function endThatPutsLast(line: Link, side: LineSide, machine: number): "N" | "S" | "any" | undefined {
  const ms = machinesOnSide(line, side);
  if (!ms.includes(machine)) return undefined;
  if (ms.length === 1) return "any";
  const isTop = ms[0] === machine;
  const isBottom = ms[ms.length - 1] === machine;
  if (!isTop && !isBottom) return undefined;
  // 싣는 쪽은 포트 쪽 끝에 가장 가까운 머신이, 집는 쪽은 가장 먼 머신이 맨 끝이다.
  if (side === "from") return isBottom ? "S" : "N";
  return isBottom ? "N" : "S";
}

/**
 * **두 줄 이상을 쓰는 머신** — 한 품목에 벨트 줄을 둘 이상 쓰면서, 그중 한 줄을 **같은 편의 다른 머신과 함께** 쓴다.
 *
 * 함께 쓰는 줄이 없으면 여기 안 든다 — 한 머신만 쓰는 줄들에서는 몫이 어떻게 갈려도 총량이 맞아 드러나지 않는다.
 */
export interface SplitMachine {
  machine: number;
  item: string;
  /** 이 머신이 그 품목에 쓰는 줄들 — 받은 목록의 index. */
  lines: number[];
}

/** 한 모듈의 한 편에 앉은 줄들에서 [SplitMachine] 을 찾는다. 머신 index 오름차순 · 품목 이름순. */
export function splitMachinesOf(lines: ReadonlyArray<Link>, side: LineSide): SplitMachine[] {
  const used = new Map<string, SplitMachine>();
  lines.forEach((line, i) => {
    for (const machine of line[side].keys()) {
      const key = `${machine}|${line.item}`;
      const cur = used.get(key);
      if (cur) cur.lines.push(i);
      else used.set(key, { machine, item: line.item, lines: [i] });
    }
  });
  return [...used.values()]
    .filter((u) => u.lines.length >= 2 && u.lines.some((i) => lines[i][side].size > 1))
    .sort((a, b) => a.machine - b.machine || a.item.localeCompare(b.item));
}

/**
 * **두 줄 이상을 쓰는 머신이 어디에 섰나.**
 *
 * ```
 * lastOnAll       그 줄들 **모두에서** 맨 끝 — 몫을 벨트가 정한다(인서터가 몫을 어떻게 나누든 같다)
 * lastOnSmaller   몫이 가장 큰 줄 하나만 빼고 맨 끝 — 인서터가 몫을 반반 나누고 막힌 쪽이 다른 쪽으로 넘어간다면 맞는다
 * notLast         몫이 작은 줄에서도 맨 끝이 아니다 — 그 줄에서 계획보다 많이 싣는다(집는다)
 * unknown         방향을 모르는 줄이 끼어 있다(그 줄이 못 앉았다)
 * ```
 */
export type SplitStanding = "lastOnAll" | "lastOnSmaller" | "notLast" | "unknown";

/** [standingOf] 가 줄마다 낸 것. */
export interface SplitLineStanding {
  /** 그 머신이 이 줄에 맡긴 양. */
  share: number;
  /** 그 편에서 이 줄을 다른 머신과 함께 쓰나. */
  shared: boolean;
  /** 이 줄에서 맨 끝인가. 방향을 모르면 `undefined`(혼자 쓰는 줄은 방향을 몰라도 맨 끝이다). */
  last: boolean | undefined;
}

/** 부동소수 여유 — 몫이 같은 두 줄을 가를 때. */
const SHARE_EPS = 1e-9;

/**
 * 한 머신의 판정.
 *
 * @param flowEndOf 줄 index → 그 줄의 포트 쪽 끝. 못 앉아 모르면 `undefined`.
 */
export function standingOf(
  sm: SplitMachine,
  lines: ReadonlyArray<Link>,
  side: LineSide,
  flowEndOf: (lineIndex: number) => "N" | "S" | undefined,
): { standing: SplitStanding; perLine: SplitLineStanding[] } {
  const perLine = sm.lines.map((i): SplitLineStanding => {
    const line = lines[i];
    const shared = line[side].size > 1;
    const end = flowEndOf(i);
    return {
      share: shareOnLine(line, side, sm.machine) ?? 0,
      shared,
      last: !shared ? true : end === undefined ? undefined : lastMachineOn(line, side, end) === sm.machine,
    };
  });
  if (perLine.some((l) => l.last === undefined)) return { standing: "unknown", perLine };
  const notLast = perLine.filter((l) => l.last === false);
  if (notLast.length === 0) return { standing: "lastOnAll", perLine };
  const biggest = Math.max(...perLine.map((l) => l.share));
  const onlyTheBiggest = notLast.length === 1 && notLast[0].share >= biggest - SHARE_EPS;
  return { standing: onlyTheBiggest ? "lastOnSmaller" : "notLast", perLine };
}

/** [requiredEndsOf] 가 줄 하나 · 한 편에 낸 답. */
export interface LineEndDecision {
  /** 이 끝으로 흘러야 한다. */
  end: "N" | "S";
  /**
   * 왜 그 끝인가.
   *
   * ```
   * last    그 끝으로 흘러야 두 줄 이상을 쓰는 머신이 이 줄의 맨 끝에 선다
   * aside   그런 머신이 **혼자** 쓰는 줄이다 — 몫과는 무관하고 자리 때문이다. 그 머신의 다른 줄이 위에 있으면 아래 끝,
   *         아래에 있으면 위 끝으로 흘러야 좌석이 그 줄의 바깥쪽 행에 앉아 두 줄의 벨트가 한 깊이에서 안 겹친다
   * ```
   */
  reason: "last" | "aside";
  /**
   * **한 줄의 같은 편 양끝에 두 줄 이상을 쓰는 머신이 섰다** — 맨 끝 자리는 편마다 하나뿐이라 둘 다 맨 끝에 세울 수 없다.
   * 방향으로는 못 푼다(줄을 끊는 자리를 바꿔야 풀린다). `end` 는 그중 한 대를 고른 것이다.
   */
  contested: boolean;
  /**
   * **포트가 서는 머신도 두 줄 이상을 쓰는 머신이다** — 그 머신에서 이 줄과 이웃 줄이 한 깊이를 나눠 쓴다.
   * 이 줄은 그 머신에서 **구간 안쪽 행부터** 앉아야 이웃 줄의 벨트와 안 엇갈린다(`module/policy/link.seatRowsOf` 의 `inward`).
   * 포트는 흐름이 향하는 끝의 머신에 선다 — 싣는 쪽에서는 맨 끝 머신이 곧 포트 머신이고, 집는 쪽에서는 맨 앞 머신이다.
   */
  portMachineShared: boolean;
}

/**
 * **두 줄 이상을 쓰는 머신을 맨 끝에 세우려면 줄마다 어느 끝으로 흘러야 하나** — 한 모듈의 한 편.
 *
 * 줄을 양(누가 얼마)으로만 알던 것에 **방향**을 붙이는 자리다 — 방향은 새 입력이 아니라 양에서 유도된다:
 * 두 줄을 쓰는 머신은 이웃한 두 줄의 경계에 서므로(구간의 끝), 그 머신 쪽으로 흐르면 그 머신이 맨 끝이다([endThatPutsLast]).
 *
 * 답이 없는 줄은 Map 에 없다 — 그런 머신이 안 쓰는 줄이다. 그 줄의 방향은 부르는 쪽의 기본을 따른다.
 *
 * **줄의 순서가 곧 위아래다** — 받은 목록은 붓기 순서이고, 붓기는 머신을 위에서 아래로 훑으므로 뒤의 줄이 아래 줄이다
 * (`module/arith/link.createLinks` — *"한 줄이 맡는 머신은 각각 연속 구간이다"*).
 *
 * ## 한 줄의 양끝에서 부딪히면 — 누구를 맨 끝에 세우나
 *
 * ```
 * ① 그 줄이 **몫이 가장 큰 줄이 아닌** 머신 먼저     몫이 작은 줄에서 앞에 서면 그 줄에 계획보다 많이 싣는다(집는다)
 * ② 같으면 반반으로 나눴을 때 계획보다 더 많이 넘치는 머신 먼저   `몫의 합 ÷ 줄 수 − 이 줄의 몫` 이 큰 쪽
 * ③ 같으면 머신 index 가 작은 쪽
 * ```
 *
 * ①②는 *한 머신의 인서터들이 몫을 반반 나눈다* 는 가정(`docs/analysis/flow-model.md` §4 (c))에 기댄다 — 부딪힌 줄에서만 쓴다.
 */
export function requiredEndsOf(lines: ReadonlyArray<Link>, side: LineSide): Map<number, LineEndDecision> {
  interface Demand { machine: number; end: "N" | "S"; notBiggest: boolean; excess: number }
  const demands = new Map<number, Demand[]>();
  /** 혼자 쓰는 줄 → 그 머신의 함께 쓰는 줄에서 멀어지는 끝. */
  const aside = new Map<number, "N" | "S">();
  for (const sm of splitMachinesOf(lines, side)) {
    const shares = sm.lines.map((i) => shareOnLine(lines[i], side, sm.machine) ?? 0);
    const biggest = Math.max(...shares);
    const even = shares.reduce((sum, v) => sum + v, 0) / shares.length;
    const sharedLines = sm.lines.filter((i) => lines[i][side].size > 1);
    sm.lines.forEach((i, k) => {
      const end = endThatPutsLast(lines[i], side, sm.machine);
      if (end === "any") {
        // 혼자 쓰는 줄 — 어느 끝이든 맨 끝이다. 함께 쓰는 줄들이 전부 한쪽에 있을 때만 그 반대쪽으로 붙인다.
        if (sharedLines.every((j) => j < i)) aside.set(i, "S");
        else if (sharedLines.every((j) => j > i)) aside.set(i, "N");
        return;
      }
      if (end === undefined) return; // 구간의 가운데 — 어느 끝으로 흘러도 맨 끝이 못 된다
      const list = demands.get(i) ?? demands.set(i, []).get(i)!;
      list.push({ machine: sm.machine, end, notBiggest: shares[k] < biggest - SHARE_EPS, excess: even - shares[k] });
    });
  }
  const out = new Map<number, LineEndDecision>();
  for (const [i, end] of aside) out.set(i, { end, reason: "aside", contested: false, portMachineShared: false });
  for (const [i, ds] of demands) {
    const contested = ds.some((d) => d.end !== ds[0].end);
    const winner = [...ds].sort(
      (a, b) => Number(b.notBiggest) - Number(a.notBiggest) || b.excess - a.excess || a.machine - b.machine,
    )[0];
    // 포트 머신 = 흐름이 향하는 끝의 머신. 이 줄에 끝을 요구한 머신들(= 이 줄을 남과 함께 쓰는 두-줄 머신) 가운데 있나.
    const ms = machinesOnSide(lines[i], side);
    const portMachine = winner.end === "S" ? ms[ms.length - 1] : ms[0];
    out.set(i, {
      end: winner.end, reason: "last", contested,
      portMachineShared: ds.some((d) => d.machine === portMachine),
    });
  }
  return out;
}

/** 한 편의 계수기 — `split` 이 분모다(판정 넷의 합). */
export interface SplitMachineCounters {
  split: number;
  lastOnAll: number;
  lastOnSmaller: number;
  notLast: number;
  unknown: number;
  /**
   * **양끝에 두 줄 이상을 쓰는 머신이 선 줄 수**([LineEndDecision.contested]) — 방향으로는 둘 다 맨 끝에 못 세운다.
   * 머신이 아니라 **줄**을 센다. 0 이 아니면 줄을 끊는 자리를 바꿔야 풀린다.
   */
  contestedLines: number;
  /**
   * **방향을 내려놓은 줄 수** — 흘러야 하는 끝이 정해졌는데 그 끝으로는 앉을 자리가 없어 오늘 규칙으로 앉은 줄
   * (`link/policy/seat.seatUnit`). 0 이 아니면 그 줄을 쓰는 머신이 `맨 끝 아님` 으로 남을 수 있다.
   */
  dropped: number;
}

export const emptySplitMachineCounters = (): SplitMachineCounters => ({
  split: 0, lastOnAll: 0, lastOnSmaller: 0, notLast: 0, unknown: 0, contestedLines: 0, dropped: 0,
});
