/**
 * cut — **벨트 줄을 어디서 끊나.**
 *
 * 경계가 머신 한 대의 몫을 가르면 그 머신의 두 몫 가운데 작은 쪽은 *그 줄에 남는 만큼* 으로만 정해진다. 한 줄이 위 경계와
 * 아래 경계 양쪽에서 작은 몫을 받으면 정해지지 않는다 — 그런 줄이 없게 **위에서부터** 끊는다. 찾지 않는다: 가득 채우고,
 * 위에서 작은 몫을 받은 줄만 아래에서 또 받지 않게 방문하는 머신을 덜어 낸다.
 */
import { describe, it, expect } from "vitest";
import type { LinkCarry } from "../types/line";
import { chooseCutsWithinLines, cutFromTop, hasLineSplitAtBothEnds, linesTakingTwoSmallShares, splitCount } from "./cut";

/** 자식 한 대가 `a`/s 를 내고 부모 한 대가 `b`/s 를 쓴다 — 위에서부터 채워 가는 흐름 목록(총량 `total`). */
function flowsOf(a: number, b: number, total: number): LinkCarry[] {
  const out: LinkCarry[] = [];
  let c = 0;
  let p = 0;
  let cLeft = a;
  let pLeft = b;
  let left = total;
  while (left > 1e-9) {
    const rate = Math.min(cLeft, pLeft, left);
    out.push({ from: c, to: p, rate });
    cLeft -= rate; pLeft -= rate; left -= rate;
    if (cLeft <= 1e-9) { c += 1; cLeft = a; }
    if (pLeft <= 1e-9) { p += 1; pLeft = b; }
  }
  return out;
}
const limits = (cap = 15) => ({ capOf: () => cap, fromSeat: Infinity, toSeat: Infinity });
/** 끊는 자리 → 줄마다 실린 양. */
const loads = (flows: LinkCarry[], cuts: number[]): number[] => {
  const b = [0, ...cuts, flows.length];
  return b.slice(1).map((end, k) => flows.slice(b[k], end).reduce((s, f) => s + f.rate, 0));
};
/** 붓기가 끊는 자리 — 줄이 찬 곳(다음 흐름이 통째로 안 들어가는 곳). */
const pourCuts = (flows: LinkCarry[], cap = 15): number[] => {
  const cuts: number[] = [];
  let used = 0;
  flows.forEach((f, i) => {
    if (used + f.rate > cap + 1e-9) { cuts.push(i); used = 0; }
    used += f.rate;
  });
  return cuts;
};

describe("linesTakingTwoSmallShares — 한 줄이 위 · 아래 경계 양쪽에서 작은 몫을 받나", () => {
  // 자식 9/s 다섯 → 부모 5/s 아홉. 흐름 열셋: 5 · 4 | 1 · 5 · 3 | 2 · 5 · 2 | 3 · 5 · 1 | 4 · 5 (자식마다 묶었다).
  const nineFive = flowsOf(9, 5, 45);

  it("붓기가 낸 15 · 15 · 15 — 가운데 줄이 자식 1 의 3 과 자식 3 의 3 을 함께 받는다", () => {
    expect(loads(nineFive, [4, 9])).toEqual([15, 15, 15]);
    expect(linesTakingTwoSmallShares(nineFive, [4, 9])).toEqual([1]);
  });

  it("15 · 10 · 10 · 10 — 자식 셋이 갈리지만 작은 몫이 줄마다 하나다(3 · 2 · 1 이 전부 아랫줄에 놓인다)", () => {
    expect(loads(nineFive, [4, 7, 10])).toEqual([15, 10, 10, 10]);
    expect(linesTakingTwoSmallShares(nineFive, [4, 7, 10])).toEqual([]);
  });

  it("15 · 12 · 13 · 5 — 주는 머신 하나 · 받는 머신 하나의 작은 몫이 한 줄에 놓여도 어긴 것이다", () => {
    // 첫 경계는 자식 1 을(6 | 3), 둘째 경계는 부모 5 를(2 | 3) 가른다. 같은 편이 연달아 갈린 것은 아니지만 줄 1 이 3 과 2 를 함께 받는다 —
    // 자식 1 이 실을 양은 줄에 남는 자리로, 부모 5 가 집을 양은 줄에 남는 물건으로 정해지는데 그 둘이 서로를 가리킨다.
    expect(loads(nineFive, [4, 8, 12])).toEqual([15, 12, 13, 5]);
    expect(hasLineSplitAtBothEnds(nineFive, [4, 8, 12])).toBe(false);
    expect(linesTakingTwoSmallShares(nineFive, [4, 8, 12])).toEqual([1]);
  });

  it("양끝에 갈린 머신이 서도 작은 몫을 둔 것이 한 대뿐이면 지킨 것이다 — 자식 10/s 셋 → 부모 6/s 다섯의 12 · 12 · 6", () => {
    // 가운데 줄: 자식 1 은 8(작은 몫 2 는 윗줄), 자식 2 는 4(큰 몫 6 은 아랫줄). 그 줄이 받는 작은 몫은 자식 2 의 4 하나다.
    const flows = flowsOf(10, 6, 30);
    expect(loads(flows, [3, 6])).toEqual([12, 12, 6]);
    expect(hasLineSplitAtBothEnds(flows, [3, 6])).toBe(true);
    expect(linesTakingTwoSmallShares(flows, [3, 6])).toEqual([]);
  });

  it("반반으로 갈린 머신은 작은 몫이 없다", () => {
    // 가운데 줄: 자식 1 은 5 | 5 로 갈렸고(위 경계), 자식 2 는 3 | 7 로 갈렸다(아래 경계 — 작은 몫 3 이 가운데 줄).
    const flows: LinkCarry[] = [
      { from: 0, to: 0, rate: 10 }, { from: 1, to: 0, rate: 5 },
      { from: 1, to: 1, rate: 5 }, { from: 2, to: 1, rate: 3 },
      { from: 2, to: 2, rate: 7 },
    ];
    expect(linesTakingTwoSmallShares(flows, [2, 4])).toEqual([]);
  });

  it("한 머신이 혼자 쓰는 줄들은 어긴 것이 아니다", () => {
    const one: LinkCarry[] = [
      { from: 0, to: 0, rate: 10 }, { from: 0, to: 1, rate: 10 }, { from: 0, to: 2, rate: 10 },
    ];
    expect(linesTakingTwoSmallShares(one, [1, 2])).toEqual([]);
  });
});

describe("cutFromTop — 위에서부터 가득 채우고, 작은 몫을 또 받게 되는 줄은 방문하는 머신을 덜어 낸다", () => {
  it("자식 9/s 다섯 → 부모 5/s 아홉: 15 · 10 · 10 · 10 — 가운데 줄들이 부모를 셋이 아니라 둘씩 방문한다", () => {
    // 줄 0  부모 셋(15)을 방문한다. 자식 1 이 이 줄에 6, 다음 줄에 3 을 싣게 된다 — 작은 몫 3 이 줄 1 로 넘어간다.
    // 줄 1  부모 셋(15)을 방문하면 자식 3 이 이 줄에 3, 다음 줄에 6 — 작은 몫 3 이 또 이 줄에 놓인다(자식 1 의 3 과 둘).
    //       부모 하나를 덜어 둘(10)만 방문하면 자식 2 가 이 줄에 7, 다음 줄에 2 — 작은 몫이 다음 줄로 간다. 여기서 끊는다.
    // 줄 2  같은 까닭으로 부모 셋(자식 4 가 4 · 5)이 안 되고 둘(자식 3 이 8 · 1)을 방문한다.
    // 줄 3  덜어 낸 부모들이 밀려 와 남은 둘(10)을 맡는다 — 줄이 하나 늘었다.
    const flows = flowsOf(9, 5, 45);
    const cuts = cutFromTop(flows, 4, limits())!;
    expect(loads(flows, cuts)).toEqual([15, 10, 10, 10]);
    expect(linesTakingTwoSmallShares(flows, cuts)).toEqual([]);
  });

  it("줄 수의 상한 안에 못 끊으면 답이 없다 — 위 판을 세 줄로는 못 끊는다", () => {
    expect(cutFromTop(flowsOf(9, 5, 45), 3, limits())).toBeUndefined();
  });

  it("조건을 어기지 않는 붓기는 한 줄도 안 바뀐다 — 같은 규칙이 같은 자리에서 끊는다", () => {
    for (const [a, b, total] of [[10, 6, 30], [7, 6, 42], [5, 5, 30], [8, 7.5, 45]]) {
      const flows = flowsOf(a, b, total);
      const poured = pourCuts(flows);
      expect(linesTakingTwoSmallShares(flows, poured), `${a} → ${b} · ${total}`).toEqual([]);
      // 줄 수의 상한을 붓기와 같게 줘도 같은 답이 난다 — 줄을 더 쓰지 않는다.
      expect(cutFromTop(flows, poured.length + 1, limits()), `${a} → ${b} · ${total}`).toEqual(poured);
    }
  });

  it("거울 — 자식 5/s 아홉 → 부모 9/s 다섯: 같은 15 · 10 · 10 · 10. 이번에는 줄이 방문하는 **자식**이 셋에서 둘로 준다", () => {
    // 주는 쪽 · 받는 쪽을 맞바꾼 판이다. 부모 1 이 6 · 3 으로, 부모 3 이 3 · 6 으로 갈려 가운데 줄이 작은 몫을 둘 받는다.
    const flows = flowsOf(5, 9, 45);
    expect(loads(flows, pourCuts(flows))).toEqual([15, 15, 15]);
    expect(linesTakingTwoSmallShares(flows, pourCuts(flows))).toEqual([1]);
    const cuts = cutFromTop(flows, 4, limits())!;
    expect(loads(flows, cuts)).toEqual([15, 10, 10, 10]);
    expect(splitCount(flows, cuts, "from")).toBe(0);
    expect(splitCount(flows, cuts, "to")).toBe(3);
  });

  it("쓸기 — 끊은 줄은 조건을 지키고, 상한을 안 넘고, 붓기보다 한 줄까지만 는다", () => {
    for (const total of [30, 45, 60]) for (const b of [3, 5, 6, 7.5, 10]) for (const a of [4, 5, 6, 7, 8, 9, 10, 12]) {
      const flows = flowsOf(a, b, total);
      const poured = pourCuts(flows);
      const pouredLines = poured.length + 1;
      const cuts = cutFromTop(flows, pouredLines + 1, limits());
      const label = `자식 ${a} → 부모 ${b} · ${total}`;
      expect(cuts, label).toBeDefined();
      expect(linesTakingTwoSmallShares(flows, cuts!), label).toEqual([]);
      expect(Math.max(...loads(flows, cuts!)), label).toBeLessThanOrEqual(15 + 1e-9);
      if (linesTakingTwoSmallShares(flows, poured).length === 0) expect(cuts, label).toEqual(poured);
    }
  });

  it("머신 한 대가 세 줄을 쓰게 되는 끊기는 안 만든다", () => {
    // 자식 0 이 30/s 를 부모 셋(10/s 씩)에게 준다. 한 줄 10/s 면 자식 0 을 세 줄에 갈라야 한다.
    const flows: LinkCarry[] = [
      { from: 0, to: 0, rate: 10 }, { from: 0, to: 1, rate: 10 }, { from: 0, to: 2, rate: 10 },
    ];
    expect(cutFromTop(flows, 3, limits(10))).toBeUndefined();
  });

  it("줄의 상한과 머신마다의 상한을 넘는 줄은 안 만든다", () => {
    const flows = flowsOf(10, 6, 30);
    // 한 줄이 받는 머신 한 대에게 5/s 까지만 — 6/s 흐름을 통째로 실을 줄이 없다.
    expect(cutFromTop(flows, 9, { capOf: () => 15, fromSeat: Infinity, toSeat: 5 })).toBeUndefined();
  });
});

describe("옛 조건 — 받는 면을 다른 재료와 나눠 쓰는 간선(같은 줄 수 안에서만 다시 끊는다)", () => {
  // 자식 10/s 셋 → 부모 6/s 다섯. 흐름 일곱: 6 · 4 · 2 · 6 · 2 · 4 · 6.
  const flows = flowsOf(10, 6, 30);

  it("hasLineSplitAtBothEnds — 12 · 12 · 6 은 가운데 줄의 양끝에서 자식이 갈리고, 12 · 8 · 10 은 자식 · 부모가 번갈아 갈린다", () => {
    expect(hasLineSplitAtBothEnds(flows, [3, 6])).toBe(true);
    expect(splitCount(flows, [3, 6], "from")).toBe(2);
    expect(splitCount(flows, [3, 6], "to")).toBe(0);
    expect(loads(flows, [3, 5])).toEqual([12, 8, 10]);
    expect(hasLineSplitAtBothEnds(flows, [3, 5])).toBe(false);
    expect(splitCount(flows, [3, 5], "from")).toBe(1);
    expect(splitCount(flows, [3, 5], "to")).toBe(1);
  });

  it("그 편에 머신이 하나뿐인 줄은 어긴 것이 아니다 — 그 머신은 그 줄을 혼자 쓴다", () => {
    const one: LinkCarry[] = [
      { from: 0, to: 0, rate: 10 }, { from: 0, to: 1, rate: 10 }, { from: 0, to: 2, rate: 10 },
    ];
    expect(hasLineSplitAtBothEnds(one, [1, 2])).toBe(false);
  });

  it("chooseCutsWithinLines — 세 줄: 12 · 8 · 10 을 고른다", () => {
    const cuts = chooseCutsWithinLines(flows, 3, limits())!;
    expect(loads(flows, cuts)).toEqual([12, 8, 10]);
    expect(hasLineSplitAtBothEnds(flows, cuts)).toBe(false);
  });

  it("줄 수가 적은 답이 먼저다 — 두 줄로 되면 세 줄을 안 쓴다", () => {
    // 자식 5/s 여섯 → 부모 5/s 여섯: 15 · 15 로 끊으면 아무도 안 갈린다.
    const even = flowsOf(5, 5, 30);
    const cuts = chooseCutsWithinLines(even, 3, limits())!;
    expect(loads(even, cuts)).toEqual([15, 15]);
    expect(splitCount(even, cuts, "from") + splitCount(even, cuts, "to")).toBe(0);
  });

  it("남는 자리가 없으면 답이 없다 — 자식 9/s 다섯 → 부모 5/s 아홉은 세 줄로 15 · 15 · 15 밖에 못 끊는다", () => {
    expect(chooseCutsWithinLines(flowsOf(9, 5, 45), 3, limits())).toBeUndefined();
  });

  it("받는 머신을 가르는 답보다 주는 머신을 가르는 답이 먼저다", () => {
    // 자식 6/s 다섯 → 부모 10/s 셋(30/s). 두 줄 15 · 15 는 흐름 사이가 아니라 못 끊는다 → 세 줄.
    // 경계마다 누군가는 갈린다. 받는 쪽을 덜 가르는 답을 고른다.
    const sixTen = flowsOf(6, 10, 30);
    const cuts = chooseCutsWithinLines(sixTen, 3, limits())!;
    const others: number[][] = [];
    for (let i = 1; i < sixTen.length; i++) for (let j = i + 1; j < sixTen.length; j++) {
      const l = loads(sixTen, [i, j]);
      if (Math.max(...l) <= 15 && !hasLineSplitAtBothEnds(sixTen, [i, j])) others.push([i, j]);
    }
    const fewestTo = Math.min(...others.map((c) => splitCount(sixTen, c, "to")));
    expect(splitCount(sixTen, cuts, "to")).toBe(fewestTo);
  });

  it("머신 한 대가 세 줄을 쓰게 되는 답은 안 낸다 · 상한을 넘는 줄은 안 만든다", () => {
    const one: LinkCarry[] = [
      { from: 0, to: 0, rate: 10 }, { from: 0, to: 1, rate: 10 }, { from: 0, to: 2, rate: 10 },
    ];
    expect(chooseCutsWithinLines(one, 3, limits(10))).toBeUndefined();
    expect(chooseCutsWithinLines(flows, 3, { capOf: () => 15, fromSeat: Infinity, toSeat: 5 })).toBeUndefined();
  });
});
