import { describe, it, expect } from "vitest";
import type { BuildSpec } from "../shared/gamedata/spec";
import type { ResolvedNode } from "./gamedata/tree";
import { admitBuildSpec, admitFluidTrunks } from "./policy";

/**
 * **지하벨트 · 지하파이프는 필수다**(2026-10-01 사용자 — docs/auto-layout/common/layout-models.md §3.5 두점 라우팅).
 * 두 경로가 반드시 만나면 한쪽이 땅속으로 건너야 풀린다 — 통로를 넓혀도 엇갈림은 안 풀린다. 그래서 안 골랐으면 짓지 않는다:
 * 지하벨트가 없으면 **진입에서**, 지하파이프가 없으면 **유체 레시피 노드를** 거절한다(위저드가 그 단계로 돌려보낸다).
 */
const spec = (over: Partial<BuildSpec>): BuildSpec =>
  ({
    beltEntityName: "transport-belt",
    belts: [{ entityName: "transport-belt", throughput: 15 }],
    inserterEntityName: "inserter",
    inserters: [{ entityName: "inserter", reach: 1, throughput: 0.83 }],
    pipeEntityName: "pipe",
    undergroundPipeEntityName: "pipe-to-ground",
    pipeMaxUndergroundDistance: 10,
    undergroundBeltEntityName: "underground-belt",
    undergroundBelts: [{ entityName: "underground-belt", throughput: 15, maxDistance: 5 }],
    beltMaxUndergroundDistance: 5,
    ...over,
  }) as unknown as BuildSpec;

/** 유체 줄 하나를 쓰는 정사각 머신 노드 — 거절은 엔티티를 보기 **전에** 난다. */
const fluidNode = {
  node: { recipeName: "plastic-bar" },
  meta: { w: 3, h: 3, entityName: "chemical-plant" },
  recipe: {},
  entity: undefined,
  fluidLines: [{ name: "petroleum-gas" }],
  itemLineCount: 1,
} as unknown as ResolvedNode;

describe("지하벨트는 필수다 — 진입에서", () => {
  it("고른 지하벨트가 없으면 거절하고 벨트 단계로 돌려보낸다", () => {
    const issues = admitBuildSpec(spec({ undergroundBeltEntityName: undefined, undergroundBelts: [] }));
    expect(issues.map((i) => [i.code, i.fixStep])).toEqual([["no-underground-belt", "belt"]]);
  });

  it("골랐으면 지나간다(대조군)", () => {
    expect(admitBuildSpec(spec({}))).toEqual([]);
  });
});

describe("지하파이프는 필수다 — 안 골랐으면 유체 레시피를 쓰지 않는다", () => {
  it("지하파이프가 없으면 유체 노드를 거절하고 파이프 단계로 돌려보낸다", () => {
    const { issues } = admitFluidTrunks([fluidNode], spec({ undergroundPipeEntityName: undefined, pipeMaxUndergroundDistance: 0 }));
    expect(issues.map((i) => [i.code, i.fixStep, i.carrier])).toEqual([["no-underground-pipe", "pipe", "fluid"]]);
  });

  it("사거리 2 미만은 건널 수 없으니 안 고른 것과 같다", () => {
    const { issues } = admitFluidTrunks([fluidNode], spec({ pipeMaxUndergroundDistance: 1 }));
    expect(issues.map((i) => i.code)).toEqual(["no-underground-pipe"]);
  });

  it("골랐으면 이 판정은 지나간다 — 다음 판정(게임데이터)으로 간다(대조군)", () => {
    const { issues } = admitFluidTrunks([fluidNode], spec({}));
    expect(issues.map((i) => i.code)).not.toContain("no-underground-pipe");
  });
});
