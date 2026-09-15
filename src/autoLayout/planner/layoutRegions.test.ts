import { describe, it, expect } from "vitest";
import { regionsAlong, reachesOutside } from "./layoutRegions";
import type { LayoutGrid } from "./perimeter/types";

/** 깊이 0 에 모듈 하나, 깊이 1 에 셋, 깊이 2 에 하나. maxDepth 2. */
const grid: LayoutGrid = {
  orderByDepth: new Map([
    [0, ["p"]],
    [1, ["a", "b", "c"]], // 위 → 아래
    [2, ["z"]],
  ]),
  maxDepth: 2,
};

describe("layoutRegions — 광선이 지나는 영역", () => {
  it("세로 광선은 **자기 열의 순번 목록**을 모듈·행채널 번갈아 훑는다", () => {
    // b 에서 위로: [b] [b 위 행채널] [a] [a 위 마진행채널] [바깥]
    expect(regionsAlong({ id: "b", depth: 1 }, "N", grid)).toEqual([
      { kind: "module", id: "b" },
      { kind: "rowChannel", depth: 1, above: "a", below: "b" },
      { kind: "module", id: "a" },
      { kind: "rowChannel", depth: 1, above: undefined, below: "a" }, // marginN
      { kind: "outerMargin", edge: "N" },
    ]);
  });

  it("아래로 가면 거울이다 — 순서가 뒤집히고 마지막이 marginS 다", () => {
    expect(regionsAlong({ id: "b", depth: 1 }, "S", grid)).toEqual([
      { kind: "module", id: "b" },
      { kind: "rowChannel", depth: 1, above: "b", below: "c" },
      { kind: "module", id: "c" },
      { kind: "rowChannel", depth: 1, above: "c", below: undefined }, // marginS
      { kind: "outerMargin", edge: "S" },
    ]);
  });

  it("행 채널의 신원은 `rowChannels` 와 **같은 규약**이다 — 이웃 모듈이 말한다", () => {
    // above 없음 = marginN · below 없음 = marginS. 둘 다 있으면 between.
    const up = regionsAlong({ id: "a", depth: 1 }, "N", grid);
    expect(up).toEqual([
      { kind: "module", id: "a" },
      { kind: "rowChannel", depth: 1, above: undefined, below: "a" },
      { kind: "outerMargin", edge: "N" },
    ]);
  });

  it("모듈이 하나뿐인 열도 **마진 행 채널을 지난다** — 마진도 행 채널이다", () => {
    expect(regionsAlong({ id: "z", depth: 2 }, "S", grid)).toEqual([
      { kind: "module", id: "z" },
      { kind: "rowChannel", depth: 2, above: "z", below: undefined },
      { kind: "outerMargin", edge: "S" },
    ]);
  });

  it("세로 광선은 **언제나 바깥에 닿는다** — 자기 열을 지나면 바로 바깥이다", () => {
    for (const id of ["a", "b", "c"])
      for (const dir of ["N", "S"] as const)
        expect(reachesOutside(regionsAlong({ id, depth: 1 }, dir, grid))).toBe(true);
  });

  it("가로 광선 — **끝 열이면 바깥 마진**에 바로 닿는다", () => {
    expect(regionsAlong({ id: "p", depth: 0 }, "W", grid)).toEqual([
      { kind: "module", id: "p" },
      { kind: "outerMargin", edge: "W" },
    ]);
    expect(regionsAlong({ id: "z", depth: 2 }, "E", grid)).toEqual([
      { kind: "module", id: "z" },
      { kind: "outerMargin", edge: "E" },
    ]);
  });

  it("가로 광선 — **중간 열이면 첫 열 채널에서 멈춘다**(1홉 한계). 거기서 환승해야 나간다", () => {
    const w = regionsAlong({ id: "b", depth: 1 }, "W", grid);
    expect(w).toEqual([
      { kind: "module", id: "b" },
      { kind: "columnChannel", depth: 1 }, // W 는 **자기 깊이**의 채널
    ]);
    expect(reachesOutside(w)).toBe(false); // ← 이 값이 "환승이 필요하다"를 말한다

    const e = regionsAlong({ id: "b", depth: 1 }, "E", grid);
    expect(e).toEqual([
      { kind: "module", id: "b" },
      { kind: "columnChannel", depth: 2 }, // E 는 **다음 깊이**의 채널
    ]);
    expect(reachesOutside(e)).toBe(false);
  });

  it("첫 칸은 **언제나 자기 몸통**이다 — 넷 중 하나라 규칙에 예외가 없다", () => {
    for (const dir of ["N", "S", "W", "E"] as const)
      expect(regionsAlong({ id: "b", depth: 1 }, dir, grid)[0]).toEqual({ kind: "module", id: "b" });
  });

  it("모르는 모듈이면 빈 목록 — 있을 수 없는 입력의 안전망", () => {
    expect(regionsAlong({ id: "없음", depth: 1 }, "N", grid)).toEqual([]);
    expect(regionsAlong({ id: "b", depth: 9 }, "N", grid)).toEqual([]);
  });
});
