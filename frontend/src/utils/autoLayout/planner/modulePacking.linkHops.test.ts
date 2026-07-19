import { describe, it, expect } from "vitest";
import { packModuleTree, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeModuleHops } from "./moduleHop";
import type { IoLine } from "../module/clusterPortPlanner";

// 끝단 통합 — count≥2 에서 출력 fan-out(자식) ↔ 입력 fan-in(부모)이 링크 순서대로
// 1:1 홉으로 이어지는지. (emitOutputLinks/emitInputLinks + pairHopPorts index-zip)

const M = { entityName: "assembling-machine-3", w: 3, h: 3 };
const inL = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
const outL = (name: string): IoLine => ({ name, kind: "belt", role: "output" });

const config: PackConfig = {
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
  throughput: { normal: 6, long: 6 }, // tapCap = 6
  belts: [{ entityName: "transport-belt", throughput: 20 }],
};

// 자식 2대(머신당 12 = 클러스터 24), 부모 2대(머신당 6 = 클러스터 12).
// edgeMachineLinks: 자식0 이 부모0·부모1 을 각각 1벨트씩 → fan-out 링크 2개.
const specs: NodeSpec[] = [
  {
    id: "p", depth: 0, machine: M, count: 2,
    lines: [inL("x"), outL("prod")],
    supplyCapacity: { tapCapacity: 6, lineRates: new Map([["input:x", 12], ["output:prod", 12]]) },
  },
  {
    id: "c", depth: 1, parentId: "p", machine: M, count: 2,
    lines: [outL("x")],
    supplyCapacity: { tapCapacity: 6, lineRates: new Map([["output:x", 24]]) },
  },
];

describe("packModuleTree — 링크 기반 fan-out/fan-in 홉", () => {
  const pack = packModuleTree(specs, config);
  const child = pack.placements.find((pl) => pl.id === "c")!;
  const parent = pack.placements.find((pl) => pl.id === "p")!;

  it("자식이 x 출력 포트 2개(fan-out) — 부모0·부모1 로 갈림", () => {
    expect(child.module.outputPorts.filter((p) => p.line.name === "x")).toHaveLength(2);
  });

  it("부모가 x 입력 포트 2개(fan-in) — 링크당 하나", () => {
    expect(parent.module.inputPorts.filter((p) => p.line.name === "x")).toHaveLength(2);
  });

  it("x 에 대해 홉 2개 — 링크 순서로 1:1 짝지어짐", () => {
    expect(pack.hops.filter((h) => h.item === "x")).toHaveLength(2);
  });

  it("x 포트가 raw 로 남지 않는다 (전부 짝지어짐)", () => {
    expect(pack.rawPorts.filter((p) => p.line.name === "x")).toHaveLength(0);
  });

  it("홉이 실제로 라우팅된다 (moduleHop 실패 0)", () => {
    const hop = routeModuleHops(pack, {
      beltEntityName: "transport-belt",
      undergroundBeltEntityName: "underground-belt",
      beltMaxUndergroundDistance: 4,
    });
    expect(hop.failures).toBe(0);
  });
});
