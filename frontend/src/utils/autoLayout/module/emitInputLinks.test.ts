import { describe, it, expect } from "vitest";
import { generateModule, type ModuleInput } from "./clusterModule";
import type { MachineLinkGroup } from "./allocateMachineLinks";

// 입력 fan-in 방출 — [emitOutputLinks] 의 거울.
//
// v1 은 **링크 하나 = 벨트 하나**라 벨트가 남의 머신 행을 관통하는 일이 없다
// (docs/auto-layout-wizard.cluster-redesign.md). 관통이 없으니 그룹끼리 depth 를 다툴 일도
// 없어, 행 구간만 안 겹치면 **같은 depth 를 그냥 나눠 쓴다**.
const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

/** 머신 여럿에 걸친 그룹 — v1 의 [edgeLinkGroups] 는 이런 걸 내지 않는다(안전망 확인용). */
const spanning: MachineLinkGroup[] = [
  {
    fromMachine: 0,
    item: "x",
    taps: [
      { toMachine: 0, inserterCount: 1 },
      { toMachine: 1, inserterCount: 1 },
      { toMachine: 2, inserterCount: 1 },
    ],
  },
];

const base: ModuleInput = {
  machine: M,
  count: 3,
  lines: [{ name: "x", kind: "belt", role: "input" }],
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
  inputLinks: spanning,
};

// 관통 벨트는 다른 그룹의 행 위를 지나므로 depth 를 다퉈야 한다 — 그 다툼을 없앤 게 이번
// 재설계다. 그래서 v1 은 이런 그룹을 **조용히 겹치게 두지 않고 정직하게 거절**한다.
// (병합을 되살릴 때 여기가 관문이다 — 이 테스트가 빨개지는 것이 곧 "관통을 다시 열었다"다.)
describe("머신 여럿에 걸친 그룹 — 조용히 겹치는 대신 정직하게 거절한다", () => {
  const mod = generateModule(base);

  it("포트를 내지 않고 줄을 unrouted 로 남긴다", () => {
    expect(mod.inputPorts).toHaveLength(0);
    expect(mod.unroutedLines.map((l) => l.name)).toEqual(["x"]);
  });

  it("셀이 겹치지 않는다 — 억지로 깔지 않았다는 증거", () => {
    const seen = new Set<string>();
    let dup = 0;
    for (const c of mod.cells) {
      const k = `${c.x},${c.y}`;
      if (seen.has(k)) dup++;
      seen.add(k);
    }
    expect(dup).toBe(0);
  });
});

describe("머신마다 자기 벨트 — 여럿이 같은 깊이를 나눠 쓴다", () => {
  const disjoint: MachineLinkGroup[] = [
    { fromMachine: 0, item: "x", taps: [{ toMachine: 0, inserterCount: 1 }] },
    { fromMachine: 1, item: "x", taps: [{ toMachine: 1, inserterCount: 1 }] },
  ];
  const mod = generateModule({ ...base, inputLinks: disjoint });

  it("둘 다 기본 레인(d=2) — 행이 안 겹치니 다툴 게 없다", () => {
    expect(mod.unroutedLines).toHaveLength(0);
    expect(mod.inputPorts).toHaveLength(2);
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
