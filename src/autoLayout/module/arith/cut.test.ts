/**
 * cut — **벨트 줄을 어디서 끊나.**
 *
 * 한 줄의 위 · 아래 경계가 같은 편의 머신을 연달아 가르면 그 줄의 양끝에 두 줄을 쓰는 머신이 선다 — 맨 끝 자리는 편마다
 * 하나뿐이라 방향으로는 한 대만 맨 끝이 된다. 줄들에 남는 자리가 있으면 같은 줄 수로 그런 줄이 없는 끊는 자리를 찾는다.
 * **줄은 늘리지 않는다** — 그 줄 수 안에 답이 없으면 없다고 한다.
 */
import { describe, it, expect } from "vitest";
import type { LinkCarry } from "../types/line";
import { chooseCuts, hasContestedLine, splitCount } from "./cut";

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

describe("hasContestedLine — 한 줄의 위 · 아래 경계가 같은 편을 연달아 가르나", () => {
  // 자식 10/s 셋 → 부모 6/s 다섯. 흐름 일곱: 6 · 4 · 2 · 6 · 2 · 4 · 6.
  const flows = flowsOf(10, 6, 30);

  it("붓기가 낸 12 · 12 · 6 — 가운데 줄의 양끝에서 자식이 갈린다", () => {
    expect(loads(flows, [3, 6])).toEqual([12, 12, 6]);
    expect(hasContestedLine(flows, [3, 6])).toBe(true);
    expect(splitCount(flows, [3, 6], "from")).toBe(2);
    expect(splitCount(flows, [3, 6], "to")).toBe(0);
  });

  it("12 · 8 · 10 — 첫 경계는 자식을, 둘째 경계는 부모를 가른다. 연달아 같은 편이 아니다", () => {
    expect(loads(flows, [3, 5])).toEqual([12, 8, 10]);
    expect(hasContestedLine(flows, [3, 5])).toBe(false);
    expect(splitCount(flows, [3, 5], "from")).toBe(1);
    expect(splitCount(flows, [3, 5], "to")).toBe(1);
  });

  it("그 편에 머신이 하나뿐인 줄은 어긴 것이 아니다 — 그 머신은 그 줄을 혼자 쓴다", () => {
    // 자식 0 이 세 줄을 쓴다: 가운데 줄은 자식 0 혼자다.
    const one: LinkCarry[] = [
      { from: 0, to: 0, rate: 10 }, { from: 0, to: 1, rate: 10 }, { from: 0, to: 2, rate: 10 },
    ];
    expect(hasContestedLine(one, [1, 2])).toBe(false);
  });
});

describe("chooseCuts — 같은 줄 수 안에서 조건을 지키는 끊는 자리", () => {
  it("자식 10/s 셋 → 부모 6/s 다섯 · 세 줄: 12 · 8 · 10 을 고른다", () => {
    const flows = flowsOf(10, 6, 30);
    const cuts = chooseCuts(flows, 3, limits())!;
    expect(loads(flows, cuts)).toEqual([12, 8, 10]);
    expect(hasContestedLine(flows, cuts)).toBe(false);
  });

  it("줄 수가 적은 답이 먼저다 — 두 줄로 되면 세 줄을 안 쓴다", () => {
    // 자식 5/s 여섯 → 부모 5/s 여섯: 15 · 15 로 끊으면 아무도 안 갈린다.
    const flows = flowsOf(5, 5, 30);
    const cuts = chooseCuts(flows, 3, limits())!;
    expect(loads(flows, cuts)).toEqual([15, 15]);
    expect(splitCount(flows, cuts, "from") + splitCount(flows, cuts, "to")).toBe(0);
  });

  it("남는 자리가 없으면 답이 없다 — 자식 9/s 다섯 → 부모 5/s 아홉은 15 · 15 · 15 밖에 못 끊는다", () => {
    // 세 줄이 꽉 차서 경계가 15 · 30 으로 못박힌다. 둘 다 자식을 가르고 가운데 줄에 자식이 셋이다.
    const flows = flowsOf(9, 5, 45);
    expect(chooseCuts(flows, 3, limits())).toBeUndefined();
    // 대조군 — 한 줄을 더 주면 답이 있다(줄을 늘릴지는 이 함수가 정하지 않는다).
    const four = chooseCuts(flows, 4, limits())!;
    expect(four).toBeDefined();
    expect(hasContestedLine(flows, four)).toBe(false);
    expect(Math.max(...loads(flows, four))).toBeLessThanOrEqual(15);
  });

  it("받는 머신을 가르는 답보다 주는 머신을 가르는 답이 먼저다", () => {
    // 자식 6/s 다섯 → 부모 10/s 셋(30/s). 두 줄 15 · 15 는 흐름 사이가 아니라 못 끊는다 → 세 줄.
    // 경계마다 누군가는 갈린다. 받는 쪽을 덜 가르는 답을 고른다.
    const flows = flowsOf(6, 10, 30);
    const cuts = chooseCuts(flows, 3, limits())!;
    const others: number[][] = [];
    for (let i = 1; i < flows.length; i++) for (let j = i + 1; j < flows.length; j++) {
      const l = loads(flows, [i, j]);
      if (Math.max(...l) <= 15 && !hasContestedLine(flows, [i, j])) others.push([i, j]);
    }
    const fewestTo = Math.min(...others.map((c) => splitCount(flows, c, "to")));
    expect(splitCount(flows, cuts, "to")).toBe(fewestTo);
  });

  it("머신 한 대가 세 줄을 쓰게 되는 답은 안 낸다", () => {
    // 자식 0 이 30/s 를 부모 셋(10/s 씩)에게 준다. 10 · 10 · 10 으로 끊으면 자식 0 이 세 줄을 쓴다 — 붓기가 안 만든 모양이다.
    const flows: LinkCarry[] = [
      { from: 0, to: 0, rate: 10 }, { from: 0, to: 1, rate: 10 }, { from: 0, to: 2, rate: 10 },
    ];
    expect(chooseCuts(flows, 3, limits(10))).toBeUndefined();
  });

  it("줄의 상한과 머신마다의 상한을 넘는 줄은 안 만든다", () => {
    const flows = flowsOf(10, 6, 30);
    // 한 줄이 받는 머신 한 대에게 5/s 까지만 — 6/s 흐름을 통째로 실을 줄이 없다.
    expect(chooseCuts(flows, 3, { capOf: () => 15, fromSeat: Infinity, toSeat: 5 })).toBeUndefined();
  });
});
