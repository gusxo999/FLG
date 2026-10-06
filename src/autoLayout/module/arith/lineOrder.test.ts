/**
 * lineOrder — **벨트 줄 위에서 누가 맨 끝인가.**
 *
 * 맨 끝 머신은 벨트에 남은 것만 갖는다 — 그래서 두 줄 이상을 쓰는 머신이 그 줄들의 맨 끝에 서 있으면 줄마다의 몫을
 * 벨트가 정한다(`docs/용어사전.md` §split belt 할당량 문제). 싣는 쪽과 집는 쪽은 맨 끝을 읽는 법이 반대다.
 */
import { describe, it, expect } from "vitest";
import type { Link, LinkCarry } from "../types/line";
import { endThatPutsLast, lastMachineOn, shareOnLine, splitMachinesOf, standingOf } from "./lineOrder";

/** 적재 목록에서 줄을 짓는다 — 팔 수는 판정이 안 보므로 전부 1 로 둔다. */
const line = (carries: LinkCarry[], item = "x"): Link => ({
  item,
  carries,
  from: new Map(carries.filter((c) => c.from !== undefined).map((c) => [c.from!, 1])),
  to: new Map(carries.filter((c) => c.to !== undefined).map((c) => [c.to!, 1])),
});

describe("lastMachineOn — 맨 끝은 편마다 다르게 읽는다", () => {
  // 자식 0 · 1 · 2 가 싣고 부모 3 · 4 가 집는 줄.
  const l = line([{ from: 0, to: 3, rate: 5 }, { from: 1, to: 3, rate: 5 }, { from: 2, to: 4, rate: 5 }]);

  it("싣는 쪽 — 벨트가 흐르는 끝에 가장 가까운 머신이 마지막으로 싣는다", () => {
    expect(lastMachineOn(l, "from", "S")).toBe(2);
    expect(lastMachineOn(l, "from", "N")).toBe(0);
  });

  it("집는 쪽 — 포트에서 들어와 반대쪽으로 흐르므로, 포트 쪽 끝에서 가장 먼 머신이 마지막으로 집는다", () => {
    expect(lastMachineOn(l, "to", "S")).toBe(3);
    expect(lastMachineOn(l, "to", "N")).toBe(4);
  });

  it("그 편이 모듈 밖이면 없다", () => {
    expect(lastMachineOn(line([{ to: 0, rate: 5 }]), "from", "N")).toBeUndefined();
  });
});

describe("endThatPutsLast — 그 머신을 맨 끝에 세우는 끝(lastMachineOn 의 역)", () => {
  const l = line([{ from: 0, to: 3, rate: 5 }, { from: 1, to: 3, rate: 5 }, { from: 2, to: 4, rate: 5 }]);

  it("구간의 끝에 선 머신은 한쪽 끝으로 흘러야 맨 끝이다 — 그 끝으로 흐르게 하면 실제로 맨 끝이 된다", () => {
    for (const side of ["from", "to"] as const) {
      for (const m of [...l[side].keys()]) {
        const end = endThatPutsLast(l, side, m);
        if (end === "N" || end === "S") expect(lastMachineOn(l, side, end), `${side} 머신 ${m}`).toBe(m);
      }
    }
    expect(endThatPutsLast(l, "from", 2)).toBe("S");
    expect(endThatPutsLast(l, "from", 0)).toBe("N");
    expect(endThatPutsLast(l, "to", 3)).toBe("S");
    expect(endThatPutsLast(l, "to", 4)).toBe("N");
  });

  it("가운데 머신은 어느 끝으로 흘러도 맨 끝이 못 된다", () => {
    expect(endThatPutsLast(l, "from", 1)).toBeUndefined();
  });

  it("그 편에 혼자면 어느 끝이든 맨 끝이다", () => {
    expect(endThatPutsLast(line([{ from: 0, to: 1, rate: 5 }]), "from", 0)).toBe("any");
  });
});

describe("splitMachinesOf — 두 줄 이상을 쓰면서 그중 한 줄을 남과 함께 쓰는 머신", () => {
  it("자식 10/s 셋 → 부모 6/s 다섯: 붓기는 12 · 12 · 6 이고 자식 1 · 2 가 두 줄에 갈린다", () => {
    const lines = [
      line([{ from: 0, to: 0, rate: 6 }, { from: 0, to: 1, rate: 4 }, { from: 1, to: 1, rate: 2 }]),
      line([{ from: 1, to: 2, rate: 6 }, { from: 1, to: 3, rate: 2 }, { from: 2, to: 3, rate: 4 }]),
      line([{ from: 2, to: 4, rate: 6 }]),
    ];
    expect(splitMachinesOf(lines, "from")).toEqual([
      { machine: 1, item: "x", lines: [0, 1] },
      { machine: 2, item: "x", lines: [1, 2] },
    ]);
    // 부모는 아무도 두 줄을 안 쓴다.
    expect(splitMachinesOf(lines, "to")).toEqual([]);
    expect(shareOnLine(lines[1], "from", 1)).toBe(8);
  });

  it("두 줄을 쓰지만 둘 다 혼자 쓰면 안 든다 — 몫이 어떻게 갈려도 총량이 맞는다", () => {
    const lines = [line([{ from: 0, to: 0, rate: 15 }]), line([{ from: 0, to: 0, rate: 9 }])];
    expect(splitMachinesOf(lines, "from")).toEqual([]);
  });

  it("서로 다른 품목을 한 줄씩 쓰는 것은 갈린 것이 아니다", () => {
    const lines = [
      line([{ from: 0, to: 0, rate: 5 }, { from: 1, to: 0, rate: 5 }], "a"),
      line([{ from: 0, to: 1, rate: 5 }, { from: 1, to: 1, rate: 5 }], "b"),
    ];
    expect(splitMachinesOf(lines, "from")).toEqual([]);
  });
});

describe("standingOf — 두 줄을 쓰는 머신이 어디에 섰나", () => {
  // 자식 1 이 줄 0 에 2/s(자식 0 과 함께), 줄 1 에 8/s(자식 2 와 함께) 싣는다.
  const lines = [
    line([{ from: 0, to: 0, rate: 10 }, { from: 1, to: 1, rate: 2 }]),
    line([{ from: 1, to: 2, rate: 8 }, { from: 2, to: 3, rate: 4 }]),
  ];
  const sm = splitMachinesOf(lines, "from")[0];
  const stand = (ends: ("N" | "S" | undefined)[]) => standingOf(sm, lines, "from", (i) => ends[i]).standing;

  it("그 줄들 모두에서 맨 끝 — 줄 0 은 아래로(자식 1 이 아래 끝), 줄 1 은 위로(자식 1 이 위 끝)", () => {
    expect(stand(["S", "N"])).toBe("lastOnAll");
  });

  it("몫이 큰 줄에서만 맨 앞 — 몫이 작은 줄에서는 맨 끝이다", () => {
    expect(stand(["S", "S"])).toBe("lastOnSmaller");
  });

  it("몫이 작은 줄에서 맨 앞 — 그 줄에 계획보다 많이 싣는다", () => {
    expect(stand(["N", "N"])).toBe("notLast");
    expect(stand(["N", "S"])).toBe("notLast");
  });

  it("못 앉은 줄이 끼면 모른다 — 지어내지 않는다", () => {
    expect(stand([undefined, "N"])).toBe("unknown");
  });

  it("혼자 쓰는 줄은 방향을 몰라도 맨 끝이다", () => {
    // 자식 0 이 줄 0 을 혼자, 줄 1 을 자식 1 과 함께 쓴다.
    const own = [line([{ from: 0, to: 0, rate: 15 }]), line([{ from: 0, to: 1, rate: 3 }, { from: 1, to: 1, rate: 6 }])];
    const m = splitMachinesOf(own, "from")[0];
    expect(standingOf(m, own, "from", (i) => [undefined, "N" as const][i]).standing).toBe("lastOnAll");
  });

  it("몫이 같은 두 줄은 어느 쪽에서 맨 앞이어도 '작은 쪽에서 맨 끝' 이다", () => {
    const even = [
      line([{ from: 0, to: 0, rate: 10 }, { from: 1, to: 1, rate: 5 }]),
      line([{ from: 1, to: 2, rate: 5 }, { from: 2, to: 3, rate: 10 }]),
    ];
    const m = splitMachinesOf(even, "from")[0];
    expect(standingOf(m, even, "from", () => "N").standing).toBe("lastOnSmaller");
    expect(standingOf(m, even, "from", () => "S").standing).toBe("lastOnSmaller");
  });
});
