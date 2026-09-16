import { describe, it, expect } from "vitest";
import { generateModule } from "./build";
import type { Link } from "./types/line";
import type { BeltMerge, BeltTerminus, ModuleInput } from "./types/module";
import type { PlacedCell, PortPair } from "../shared/types";
import { EntityType } from "../../types/layout";
import { makeBeltCell } from "../shared/cells/builder";
import { cellKey } from "../shared/grid";
import { resolveBeltTermini, slowestUnderground } from "./late";

// 벨트 흐름의 **끝 칸** — 방향은 아무래도 좋지만 **남의 품목과 합류해선 안 된다.**
// 규칙과 근거는 [beltTerminus.ts] 머리말.

const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

const pair = (): PortPair => ({
  producer: { containerId: "p", cell: { x: 0, y: 0 }, face: "E", kind: "item" },
  consumer: { containerId: "c", cell: { x: 0, y: 0 }, face: "E", kind: "item" },
});

const line = (name: string) => ({ name, kind: "belt" as const, role: "input" as const });

/** 끝 칸 하나짜리 무대 — 이웃 셋을 원하는 품목으로 채워 놓고 판정만 본다. */
function stage(neighbours: Record<string, string>, undergroundBelts?: ModuleInput["undergroundBelts"]) {
  const cell: PlacedCell = makeBeltCell({ x: 5, y: 5 }, 12, "transport-belt", pair());
  const beltItems = new Map<string, string>([[cellKey(5, 5), "y"]]);
  for (const [k, item] of Object.entries(neighbours)) beltItems.set(k, item);
  const merges: BeltMerge[] = [];
  const terminus: BeltTerminus = {
    cell,
    item: "y",
    flow: { x: 0, y: 1 }, // 남쪽으로 흐르다 끝난 줄
    inward: { x: -1, y: 0 }, // 머신은 서쪽(= 오늘까지의 기본값)
    pair: pair(),
  };
  resolveBeltTermini({ termini: [terminus], beltItems, undergroundBelts, merges });
  return { cell, merges };
}

describe("끝 칸 — 세 방향 중 합류하지 않는 곳", () => {
  it("이웃이 비었으면 기본값(머신 쪽)을 그대로 쓴다 — 회귀 0", () => {
    const { cell } = stage({});
    expect(cell.cell.direction).toBe(12); // W
    expect(cell.cell.entityType).toBe(EntityType.Belt);
  });

  it("머신 쪽이 **남의 품목**이면 다른 방향으로 돌린다 — 긴팔(d3)이 연 자리", () => {
    // d3 줄의 머신 쪽은 d2 다. 거기에 남의 줄이 지나가면 옛 기본값은 그 벨트로 흘러든다.
    const { cell } = stage({ [cellKey(4, 5)]: "x" });
    expect(cell.cell.direction).not.toBe(12);
    expect(cell.cell.entityType).toBe(EntityType.Belt);
  });

  it("같은 품목이면 합류해도 되지만 **빈 칸을 먼저** 고른다 — 장부가 거짓이 되지 않게", () => {
    const { cell } = stage({ [cellKey(4, 5)]: "y" }); // 머신 쪽이 같은 품목
    expect(cell.cell.direction).toBe(4); // 빈 바깥 쪽(E)을 골랐다
  });

  it("빈 칸이 없고 같은 품목만 있으면 그리로 간다 — 오염이 아니다", () => {
    const { cell } = stage({
      [cellKey(4, 5)]: "y", // 머신 쪽 — 같은 품목
      [cellKey(6, 5)]: "x",
      [cellKey(5, 6)]: "x",
    });
    expect(cell.cell.direction).toBe(12); // 후보 순서상 머신 쪽이 먼저
  });
});

describe("세 방향이 다 막히면 — 지하벨트 종착", () => {
  const blocked = {
    [cellKey(4, 5)]: "x", // 머신 쪽
    [cellKey(6, 5)]: "z", // 바깥 쪽
    [cellKey(5, 6)]: "w", // 흐름 그대로
  };
  const tiers: ModuleInput["undergroundBelts"] = [
    { entityName: "fast-underground-belt", throughput: 30, maxDistance: 6 },
    { entityName: "underground-belt", throughput: 15, maxDistance: 4 },
  ];

  it("끝 칸이 **가장 느린** 지하벨트 입구가 된다 — 짝이 없으니 완전한 종착", () => {
    const { cell, merges } = stage(blocked, tiers);
    expect(cell.cell.entityType).toBe(EntityType.UndergroundBelt);
    expect(cell.cell.undergroundType).toBe("input");
    expect(cell.cell.entityName).toBe("underground-belt"); // 느린 쪽
    expect(merges).toHaveLength(0); // 피했으니 경고할 것이 없다
  });

  it("입구는 **흐름 방향**을 본다 — 앞 칸이 등을 밀어 넣어야 물건이 들어간다", () => {
    const { cell } = stage(blocked, tiers);
    expect(cell.cell.direction).toBe(8); // S = flow
  });

  // 2026-09-06 사용자 확정: **줄을 물리지 않는다.** 그 칸 하나의 문제이고 처방은 한 단계
  // 뒤로 돌아가는 것뿐이라, 흐름 그대로 두고 **화면에 경고를 띄운다.**
  it("지하벨트를 안 골랐으면 흐름 그대로 두고 **경고 재료를 낸다**", () => {
    const { cell, merges } = stage(blocked, []);
    expect(cell.cell.entityType).toBe(EntityType.Belt); // 벨트로 남는다
    expect(cell.cell.direction).toBe(8); // S = 들어온 흐름 그대로
    expect(merges).toEqual([{ x: 5, y: 5, item: "y", into: "w" }]);
  });

  it("사거리를 모르는 티어는 후보가 아니다 — 장부에 적을 값이 없다", () => {
    expect(slowestUnderground([{ entityName: "u", throughput: 1, maxDistance: 0 }])).toBeUndefined();
  });
});

// ── 실물 모듈 — 이 결함이 실제로 났던 도형 ────────────────────────────────────
//
// 2026-09-06 실측: 관통 줄 `x`(d2, 행 0..6)와 머신 1대만 먹이는 `y` 가 같은 E 면에 앉으면
// `y` 는 d2 가 찼으니 **d3**(긴팔)로 간다. `y` 의 끝 칸은 머신 쪽으로 꺾는데, 그 칸이
// **`x` 의 벨트**다 — 옛 코드는 그대로 흘려보냈다.
describe("관통 줄 위를 지나는 d3 줄 — 끝 칸이 남의 벨트로 흘러들지 않는다", () => {
  const base: ModuleInput = {
    machine: M,
    count: 3,
    lines: [line("x"), line("y")],
    inserterEntityName: "inserter",
    inserters: [
      { entityName: "inserter", reach: 1, throughput: 0 },
      { entityName: "long-handed-inserter", reach: 2, throughput: 0 },
    ],
    beltEntityName: "transport-belt",
    inputLinks: [
      { item: "x", from: new Map([[0, 3]]), to: new Map([[0, 1], [1, 1], [2, 1]]) },
      { item: "y", from: new Map([[0, 1]]), to: new Map([[1, 1]]) },
    ] as Link[],
  };
  const mod = generateModule(base);
  const belts = mod.cells.filter((c) => c.cell.entityType === EntityType.Belt);
  const at = (x: number, y: number) => belts.find((c) => c.x === x && c.y === y);
  const port = (name: string) => mod.inputPorts.find((p) => p.line.name === name)!;

  it("무대가 그대로다 — `x` 는 d2 관통, `y` 는 d3", () => {
    expect(mod.unroutedLines).toHaveLength(0);
    expect(port("x").meta.clusterBeltDepth).toBe(2);
    expect(port("y").meta.clusterBeltDepth).toBe(3);
  });

  it("`y` 의 끝 칸이 `x` 의 벨트 칸을 안 본다", () => {
    const y = port("y").cells.at(-1)!;
    const west = at(y.x - 1, y.y);
    expect(west, "d2 에 x 의 벨트가 있어야 무대가 성립한다").toBeDefined();
    expect(y.cell.direction, "서(12)를 보면 x 의 줄로 합류한다").not.toBe(12);
  });

  // **대조군** — 같은 모듈 안에서 `x` 자신의 끝 칸은 옛 답 그대로다.
  // 그쪽 머신 쪽 칸은 자기 좌석(인서터)이라 벨트가 아니기 때문이다.
  it("`x` 의 끝 칸은 여전히 머신 쪽 — 자기 좌석은 벨트가 아니다", () => {
    const xs = port("x").cells;
    expect(xs.at(-1)!.cell.direction).toBe(12);
  });
});
