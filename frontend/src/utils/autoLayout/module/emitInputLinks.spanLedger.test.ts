import { describe, it, expect } from "vitest";
import { generateModule, type ModuleInput } from "./clusterModule";
import type { MachineLinkGroup } from "./allocateMachineLinks";

// 발견 ④ 근치 검증 — 두 입력 링크 그룹의 span(머신 index 구간)이 겹치면 방출 시점 탐색
// 없이, 배정 단계([tryLinkFace]의 spanLedger)에서 이미 다른 depth(레인)로 갈라져야 한다.
//
// 그룹1: 머신0 → {0,1,2} 전부 먹이는 트렁크(span [0,2], 머신1 을 "관통").
// 그룹2: 머신1 → {1} 만 먹이는 별도 트렁크(span [1,1]).
// 둘 다 기본 레인(d=2)을 원하면 머신1 에서 겹친다 — 그룹2 가 긴팔 레인(d=3)으로 밀려야 한다.
const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

const overlapping: MachineLinkGroup[] = [
  {
    fromMachine: 0,
    item: "x",
    taps: [
      { toMachine: 0, inserterCount: 1 },
      { toMachine: 1, inserterCount: 1 },
      { toMachine: 2, inserterCount: 1 },
    ],
  },
  { fromMachine: 1, item: "x", taps: [{ toMachine: 1, inserterCount: 1 }] },
];

const base: ModuleInput = {
  machine: M,
  count: 3,
  lines: [{ name: "x", kind: "belt", role: "input" }],
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
  inputLinks: overlapping,
};

describe("입력 링크 span 겹침 — 배정 단계에서 depth 를 가른다(탐색 없이)", () => {
  const mod = generateModule(base);

  it("두 그룹 다 방출된다 — unrouted 0", () => {
    expect(mod.unroutedLines).toHaveLength(0);
    expect(mod.inputPorts).toHaveLength(2);
  });

  it("겹치는 span 은 서로 다른 depth(레인)를 받는다", () => {
    const depths = mod.inputPorts.map((p) => p.meta.laneDepth).sort((a, b) => a - b);
    expect(depths).toEqual([2, 3]); // 기본 레인 + 긴팔 레인(1+reach 2)
  });

  it("먼저 배정된(span [0,2]) 그룹이 기본 레인을 차지하고, 겹친 쪽이 긴팔로 밀린다", () => {
    // 배열 순서 = 처리 순서(committed first wins) — 첫 그룹이 d=2, 겹치는 둘째가 d=3.
    const first = mod.inputPorts.find((p) => p.meta.laneDepth === 2)!;
    const second = mod.inputPorts.find((p) => p.meta.laneDepth === 3)!;
    expect(first.meta.inserter).toBe("normal");
    expect(second.meta.inserter).toBe("long");
  });
});

describe("입력 링크 span 안 겹침 — 굳이 갈라놓지 않는다(기본 레인 유지)", () => {
  const disjoint: MachineLinkGroup[] = [
    { fromMachine: 0, item: "x", taps: [{ toMachine: 0, inserterCount: 1 }] },
    { fromMachine: 1, item: "x", taps: [{ toMachine: 1, inserterCount: 1 }] },
  ];
  const mod = generateModule({ ...base, inputLinks: disjoint });

  it("둘 다 기본 레인(d=2) — 단일 머신끼리는 span 다툼이 없다", () => {
    expect(mod.unroutedLines).toHaveLength(0);
    expect(mod.inputPorts.every((p) => p.meta.laneDepth === 2)).toBe(true);
  });

  // 순서 우선(문서 체크리스트 "(나)") — 입력 쪽도 정렬 없이 그룹 배열 순서 그대로 좌석
  // 행에 앉는다(emitOutputLinks.test.ts 의 같은 불변식, 입력 방향에서 확인).
  it("그룹 배열 순서 = 좌석 행 순서 — 정렬 없이 그대로", () => {
    const rows = mod.inputPorts.map((p) => p.anchor.y);
    const sorted = [...rows].sort((a, b) => a - b);
    expect(rows).toEqual(sorted);
  });
});
