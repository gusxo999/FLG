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

/** 한 편의 계수기 — `split` 이 분모다(나머지 넷의 합). */
export interface SplitMachineCounters {
  split: number;
  lastOnAll: number;
  lastOnSmaller: number;
  notLast: number;
  unknown: number;
}

export const emptySplitMachineCounters = (): SplitMachineCounters => ({
  split: 0, lastOnAll: 0, lastOnSmaller: 0, notLast: 0, unknown: 0,
});
