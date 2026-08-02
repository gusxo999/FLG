import { describe, it, expect } from "vitest";
import { generateModule, type ModuleInput } from "../../module/clusterModule";
import type { MachineLinkGroup } from "../../planner/link/allocateMachineLinks";

// 입력 fan-in 방출 — [emitOutputLinks] 의 거울.
//
// v1 은 **링크 하나 = 벨트 하나**라 벨트가 남의 머신 행을 관통하는 일이 없다.
// 관통이 없으니 그룹끼리 depth 를 다툴 일도 없어, 행 구간만 안 겹치면
// **같은 depth 를 그냥 나눠 쓴다**.
const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

/** 머신 여럿에 걸친 그룹 — v1 의 [edgeLinkGroups] 는 이런 걸 내지 않는다(안전망 확인용). */
const spanning: MachineLinkGroup[] = [
  {
    item: "x",
    from: new Map([[0, 3]]),
    to: new Map([[0, 1], [1, 1], [2, 1]]),
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
    { item: "x", from: new Map([[0, 1]]), to: new Map([[0, 1]]) },
    { item: "x", from: new Map([[1, 1]]), to: new Map([[1, 1]]) },
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

// **[[ParallelBelt]] — 막힌 면, 입력 쪽** — [emitOutputLinks] 의 거울. 입력의 포트는 **동쪽**이라 좌석도
// 동쪽부터 채운다: 그래야 포트에 가까운 그룹이 얕은 줄을 쓰고, 먼 그룹의 줄이 가까운 그룹의
// 열 위를 밟지 않는다(출력은 포트가 서쪽이라 서→동으로 채운다).
describe("ParallelBelt(막힌 면, 입력) — 한 면에 벨트 여러 줄, 합류 없음", () => {
  const linked = {
    machine: M,
    count: 2,
    inserterEntityName: "inserter",
    beltEntityName: "transport-belt",
    longInserter: { entityName: "long-handed-inserter", reach: 2 },
    lines: [{ name: "x", kind: "belt", role: "input" as const }],
  };
  // 머신0 의 E면(3행)을 첫 그룹이 채우고, 넘친 그룹 **둘**이 같은 gap 면(S)으로 간다.
  const mod = generateModule({
    ...linked,
    inputLinks: [
      { item: "x", from: new Map([[0, 3]]), to: new Map([[0, 3]]) }, // E 를 채움
      { item: "x", from: new Map([[1, 1]]), to: new Map([[0, 1]]) }, // → gap 1번째
      { item: "x", from: new Map([[2, 1]]), to: new Map([[0, 1]]) }, // → gap 2번째
    ],
  } as ModuleInput);

  it("셋 다 살아남는다 — 예전엔 입력 gap 이 면당 한 줄이라 셋째가 거절됐다", () => {
    expect(mod.inputPorts).toHaveLength(3);
    expect(mod.unroutedLines).toHaveLength(0);
  });

  it("gap 두 그룹이 서로 다른 줄에 선다 — 합류하지 않는다", () => {
    const [, a, b] = mod.inputPorts;
    expect(Math.abs(a.anchor.y - b.anchor.y)).toBe(1);
  });

  it("좌석을 동쪽부터 채운다 — 첫 gap 그룹이 더 동쪽에 앉는다", () => {
    // 벨트의 **동쪽 끝**으로는 못 잰다 — 자기 줄로 내려간 그룹도 반출 줄이 동쪽 변까지 가므로
    // 둘 다 같은 값이 나온다. 좌석이 어디까지 뻗었나(= 서쪽 끝)를 봐야 순서가 드러난다.
    const [, a, b] = mod.inputPorts;
    const westmost = (p: (typeof mod.inputPorts)[number]) => Math.min(...p.cells.map((c) => c.x));
    expect(westmost(a)).toBeGreaterThan(westmost(b));
  });

  it("포트는 둘 다 클러스터 동쪽 변 밖에 선다", () => {
    const east = mod.machines[0].origin.x + mod.machines[0].size.w - 1;
    for (const p of mod.inputPorts.slice(1)) expect(p.anchor.x).toBeGreaterThan(east);
  });

  it("셀이 겹치지 않는다", () => {
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
