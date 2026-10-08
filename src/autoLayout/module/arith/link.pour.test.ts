/**
 * **붓기는 양만 본다 — 인서터는 줄이 정해진 뒤에 달린다**(2026-10-06 사용자).
 *
 * 붓기([createLinks])가 줄을 세우는 데 쓰는 수는 벨트 한 줄의 상한과 *한 줄이 머신 한 대와 주고받는 최대*
 * (면 좌석 수 × 인서터 운반량) 둘이다. 인서터가 빠르면 뒤의 것은 벨트보다 커서 아무것도 안 정한다 — 그래서
 * 인서터 운반량을 아무리 키워도 줄이 안 변한다. 그리고 줄에 다는 팔 수는 머신 대수를 어림할 때 센 수
 * ([armsForShare])와 같은 식에서 나온다.
 */
import { describe, it, expect } from "vitest";
import { createLinks, groupRate } from "./link";
import { determineBeltCount } from "../../shared/arith/belt";
import { armsForShare, maxRatePerMachinePerLine, type SpecBelt, type SpecInserter } from "../../shared/gamedata/spec";
import type { LinkCarry } from "../types/line";

/** 벨트 30/s — 한 줄(레인 하나) 15/s. */
const BELT30: SpecBelt[] = [{ entityName: "fast-transport-belt", throughput: 30 }];
const LINE_CAP = 15;
/** 3×3 머신의 한 면 좌석 수. */
const SEATS = 3;
const ins = (throughput: number): SpecInserter => ({ entityName: "i", reach: 1, throughput });

const pour = (flows: LinkCarry[], inserter: SpecInserter) =>
  createLinks(flows, "x", {
    tiers: determineBeltCount(flows.reduce((sum, f) => sum + f.rate, 0), BELT30),
    inserter,
    fromFaceSeats: SEATS,
    toFaceSeats: SEATS,
  });
/** 줄마다 실린 양과 그 줄을 쓰는 머신들 — 줄의 모양. 팔 수는 뺀다. */
const shapeOf = (flows: LinkCarry[], inserter: SpecInserter) =>
  pour(flows, inserter).map((l) => ({ rate: groupRate(l), from: [...l.from.keys()], to: [...l.to.keys()] }));

describe("인서터 운반량을 아무리 크게 넣어도 줄이 안 변한다", () => {
  // 자식 10/s 3대 → 부모 6/s 5대 (split belt 할당량 문제의 그 판).
  const flows: LinkCarry[] = [
    { from: 0, to: 0, rate: 6 }, { from: 0, to: 1, rate: 4 },
    { from: 1, to: 1, rate: 2 }, { from: 1, to: 2, rate: 6 }, { from: 1, to: 3, rate: 2 },
    { from: 2, to: 3, rate: 4 }, { from: 2, to: 4, rate: 6 },
  ];

  it("벨트 한 줄(15/s) 이상인 값은 전부 같은 줄을 낸다 — 15 · 100 · 무한", () => {
    const base = shapeOf(flows, ins(15));
    // 흐름을 억지로 쪼개지 않으므로(새 줄에 통째로 들어가면 넘긴다) 15 · 15 가 아니라 세 줄이다 — 줄이 찬 곳에서 끊은 12 · 12 · 6.
    // 가운데 줄의 양끝에 갈린 자식이 서지만 작은 몫을 그 줄에 둔 것은 한 대뿐이라 다시 끊지 않는다(`./cut`).
    expect(base.map((l) => l.rate)).toEqual([12, 12, 6]);
    for (const tp of [100, Infinity]) expect(shapeOf(flows, ins(tp)), `인서터 ${tp}/s`).toEqual(base);
  });

  it("그 줄들에 다는 팔은 머신마다 하나다", () => {
    for (const l of pour(flows, ins(100))) {
      expect([...l.from.values(), ...l.to.values()].every((n) => n === 1)).toBe(true);
    }
  });

  it("인서터가 느려서 면 좌석이 먼저 막으면 줄이 변한다(대조군) — 1/s 면 한 줄이 머신 한 대에게 3/s 까지", () => {
    const slow = pour(flows, ins(1));
    expect(slow.length).toBeGreaterThan(2);
    for (const l of slow) {
      const perMachine = new Map<string, number>();
      for (const c of l.carries ?? []) {
        for (const k of [`from:${c.from}`, `to:${c.to}`]) perMachine.set(k, (perMachine.get(k) ?? 0) + c.rate);
      }
      expect(Math.max(...perMachine.values())).toBeLessThanOrEqual(SEATS * 1 + 1e-9);
    }
  });
});

describe("어림한 팔 수 = 붓기가 줄에 단 팔 수 — 머신 한 대 · 흐름 하나", () => {
  // [몫, 인서터 운반량, 무엇을 겨누나]
  const cases: Array<[number, number, string]> = [
    [30, 100, "인서터 ≥ 벨트 한 줄 — 줄마다 하나"],
    [30, 12, "벨트 한 줄이 인서터의 정수배가 아니다 — 줄마다 따로 올린다(옛 어림은 3, 실제는 4였다)"],
    [24, 12, "〃 — 15 · 9 로 갈려 2 + 1"],
    [30, 5, "정수배(대조군)"],
    [10, 2, "면 좌석이 먼저 막는다 — 6 · 4 로 갈린다(대조군)"],
    [7.2, 2.4, "정확히 나누어떨어지는 몫(부동소수)"],
  ];
  for (const [share, tp, what] of cases) {
    it(`몫 ${share}/s · 인서터 ${tp}/s — ${what}`, () => {
      const links = pour([{ from: 0, rate: share }], ins(tp));
      const poured = links.reduce((sum, l) => sum + (l.from.get(0) ?? 0), 0);
      const estimated = armsForShare(share, maxRatePerMachinePerLine(LINE_CAP, SEATS, ins(tp)), ins(tp));
      expect(poured).toBe(estimated);
    });
  }
});

describe("한 머신의 몫을 옮기는 팔이 한 면에 다 못 앉으면 그 머신의 줄은 전용이다 — 수로 견준다", () => {
  // 자식 0 이 48/s 를 낸다 — 15/s 줄 넷이 드니 팔 넷 > 좌석 셋. 자식 1 은 6/s 다.
  // 자식 0 의 마지막 줄에는 3/s 만 실려 자리가 남는다 — 자식 1 이 거기 얹히느냐가 물음이다.
  const big: LinkCarry[] = [
    { from: 0, to: 0, rate: 24 }, { from: 0, to: 1, rate: 24 }, { from: 1, to: 1, rate: 6 },
  ];
  // 자식 0 이 18/s — 줄 둘이라 팔 둘 ≤ 좌석 셋. 마지막 줄에 3/s 가 실리고 자식 1 이 얹힌다.
  const small: LinkCarry[] = [{ from: 0, to: 0, rate: 18 }, { from: 1, to: 0, rate: 6 }];
  const sharedByChildren = (flows: LinkCarry[], tp: number) => pour(flows, ins(tp)).filter((l) => l.from.size > 1).length;

  it("팔이 좌석을 넘는 자식 — 그 자식의 줄에 다른 자식이 안 얹힌다. 인서터 값을 키워도 같다", () => {
    // 2026-10-06 까지는 양으로 견줬다(`몫 ≤ 좌석 수 × 인서터 운반량`). 인서터 100/s 면 48 ≤ 300 이라 언제나 참이 되어
    // 자식 1 이 자식 0 의 마지막 줄에 얹혔다.
    for (const tp of [15, 100, Infinity]) expect(sharedByChildren(big, tp), `인서터 ${tp}/s`).toBe(0);
  });

  it("팔이 좌석 안인 자식 — 남는 자리에 다른 자식이 얹힌다(대조군)", () => {
    expect(sharedByChildren(small, 100)).toBe(1);
  });
});

describe("몫이 벨트 한 줄보다 큰 흐름은 자기 줄을 쓴다 — 줄 수가 안 늘 때만", () => {
  it("24/s 두 쌍 — 15 · 9 · 15 · 9. 이어 부으면 15 · 9+6 · 15 · 3 이고 둘째 줄을 두 쌍이 함께 쓴다", () => {
    const links = pour([{ from: 0, to: 0, rate: 24 }, { from: 1, to: 1, rate: 24 }], ins(100));
    expect(links.map((l) => groupRate(l))).toEqual([15, 9, 15, 9]);
    // 줄마다 한 쌍만 쓴다.
    expect(links.every((l) => l.from.size === 1 && l.to.size === 1)).toBe(true);
  });

  it("줄이 늘면 안 바꾼다(대조군) — 20 · 10 · 10 · 20: 이어 부으면 넷, 자기 줄이면 여섯", () => {
    const flows: LinkCarry[] = [
      { from: 0, to: 0, rate: 20 }, { from: 1, to: 0, rate: 10 }, { from: 1, to: 1, rate: 10 }, { from: 2, to: 1, rate: 20 },
    ];
    expect(pour(flows, ins(100)).map((l) => groupRate(l))).toEqual([15, 15, 15, 15]);
  });

  it("한 줄에 통째로 들어가는 흐름뿐이면 손대지 않는다(대조군)", () => {
    const links = pour([{ from: 0, to: 0, rate: 10 }, { from: 1, to: 1, rate: 5 }], ins(100));
    expect(links.map((l) => groupRate(l))).toEqual([15]);
  });
});
