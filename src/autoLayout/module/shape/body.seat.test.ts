/**
 * `seatIsBeltFeeder` — 좌석 인서터를 벨트로 메워도 **트렁크 머리와 벨트끼리 이어지나**.
 *
 * 2026-10-01 가동률 검사 결함 #2(*포트 벨트 정면*): 긴팔(d3) 줄의 머리가 흐름의 끝 칸이면 좌석 쪽(바깥)을 본다. 거기 좌석을
 * 벨트로 메우면 두 벨트가 정면으로 마주 봐 물건이 안 들어간다 — 그런 포트는 좌석을 남긴다.
 */
import { describe, it, expect } from "vitest";
import { seatIsBeltFeeder } from "./body";
import { makeBeltCell } from "../../shared/cells/builder";
import { vectorToDirection } from "../../shared/grid";
import type { ModulePort } from "../types/module";
import type { PortPair } from "../../shared/types";

const pair = {
  producer: { containerId: "a", cell: { x: 0, y: 0 }, face: "E", kind: "item" },
  consumer: { containerId: "b", cell: { x: 0, y: 0 }, face: "E", kind: "item" },
} as unknown as PortPair;

/** E 면 포트 — 상자(anchor) x=10 · 좌석 x=9 · 트렁크 머리 x=8. 머리 벨트의 방향만 바꾼다. */
const portWithHead = (role: "input" | "output", dx: number, dy: number): ModulePort =>
  ({
    face: "E",
    anchor: { x: 10, y: 5 },
    line: { role },
    cells: [makeBeltCell({ x: 8, y: 5 }, vectorToDirection(dx, dy), "transport-belt", pair)],
  }) as unknown as ModulePort;

describe("seatIsBeltFeeder — 트렁크 머리와 벨트끼리 이어질 때만 좌석을 뗀다", () => {
  it("집는 쪽: 머리가 안쪽 · 옆을 보면 뗀다(좌석 벨트가 뒤 · 옆에서 넣는다)", () => {
    expect(seatIsBeltFeeder(portWithHead("input", -1, 0))).toBe(true);
    expect(seatIsBeltFeeder(portWithHead("input", 0, 1))).toBe(true);
  });

  it("집는 쪽: 머리가 바깥(좌석)을 보면 안 뗀다 — 정면으로 마주 본다", () => {
    expect(seatIsBeltFeeder(portWithHead("input", 1, 0))).toBe(false);
  });

  it("싣는 쪽: 머리가 바깥(좌석)을 볼 때만 뗀다 — 옆을 보면 좌석 칸에 물건이 안 온다", () => {
    expect(seatIsBeltFeeder(portWithHead("output", 1, 0))).toBe(true);
    expect(seatIsBeltFeeder(portWithHead("output", 0, 1))).toBe(false);
    expect(seatIsBeltFeeder(portWithHead("output", -1, 0))).toBe(false);
  });

  it("머리가 벨트가 아니면(다이렉트 1:1) 안 뗀다 — 그 인서터가 머신을 먹인다", () => {
    expect(seatIsBeltFeeder({ face: "E", anchor: { x: 10, y: 5 }, line: { role: "input" }, cells: [] } as unknown as ModulePort)).toBe(false);
  });
});
