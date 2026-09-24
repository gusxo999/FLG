/**
 * **모듈 지하벨트의 되읽기** — 입구마다 흐름 방향 사거리 안에서 짝을 찾는다(`terminusCorridorsOf`).
 * 잠수(짝 있는 입구)는 [입구, 출구] 만, 종착(짝 없는 입구)은 사거리 끝까지 잡는다 — 잠수 입구를 종착으로 읽으면
 * 사거리 끝까지 과잉 예약된다(`docs/auto-layout/module/belt-terminus.md` §4).
 */
import { describe, it, expect } from "vitest";
import { terminusCorridorsOf } from "./ledger";
import { makeUndergroundBeltCell } from "../shared/cells/builder";
import type { PackResult } from "../tree/types/pack";
import type { PlacedCell, PortPair } from "../shared/types";

const pair: PortPair = {
  producer: { containerId: "p", cell: { x: 0, y: 0 }, face: "W", kind: "item" },
  consumer: { containerId: "c", cell: { x: 0, y: 0 }, face: "W", kind: "item" },
};
const ug = (x: number, y: number, t: "input" | "output", name = "underground-belt"): PlacedCell =>
  makeUndergroundBeltCell({ x, y }, 8, t, name, pair); // 8 = S — 흐름이 아래로
const packOf = (cells: PlacedCell[]) => ({ placements: [{ module: { cells } }] }) as unknown as PackResult;

describe("모듈 지하벨트 되읽기", () => {
  it("짝 있는 입구(잠수)는 [입구, 출구] · 짝 없는 입구(종착)는 사거리 끝까지", () => {
    const corridors = terminusCorridorsOf(
      packOf([ug(0, 0, "input"), ug(0, 3, "output"), ug(5, 0, "input")]),
      () => 5,
    );
    expect(corridors).toEqual([
      { axis: "v", line: 0, range: [0, 3], blockGroup: "underground-belt", kind: "belt" },
      { axis: "v", line: 5, range: [0, 5], blockGroup: "underground-belt", kind: "belt" },
    ]);
  });

  it("다른 종류의 출구는 짝이 아니다 — 종착으로 읽는다", () => {
    const corridors = terminusCorridorsOf(
      packOf([ug(0, 0, "input"), ug(0, 3, "output", "fast-underground-belt")]),
      () => 5,
    );
    expect(corridors[0].range).toEqual([0, 5]);
  });
});
