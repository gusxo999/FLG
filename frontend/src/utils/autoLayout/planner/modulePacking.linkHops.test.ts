import { describe, it, expect } from "vitest";
import { packModuleTree, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeModuleHops } from "./moduleHop";
import type { IoLine } from "../module/clusterPortPlanner";

// 끝단 통합 — 링크 그룹(=벨트) 단위 fan-out/fan-in 이 1:1 홉으로 이어지는지.
// 케이스 A: 작은 링크(팔 1) → 트렁크 공유(그룹 하나 = 벨트 하나가 부모 머신 여럿을 탭).
// 케이스 B: 큰 링크(그릇을 채움) → 점대점(그룹 = 링크 하나씩). 별도 판정 없이 그릇 규칙이 가른다.

const M = { entityName: "assembling-machine-3", w: 3, h: 3 };
const inL = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
const outL = (name: string): IoLine => ({ name, kind: "belt", role: "output" });

const config: PackConfig = {
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
  throughput: { normal: 6, long: 6 }, // tapCap 6, 그릇 = floor(20/6) = 3
  belts: [{ entityName: "transport-belt", throughput: 20 }],
};

describe("트렁크 공유 — 작은 입력은 벨트 하나가 부모 머신 여럿을 탭", () => {
  // 부모 2대(머신당 6 = 팔 1), 자식 2대(머신당 12). 링크: (c0→p0,1),(c0→p1,1) → 그룹 하나.
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
  const pack = packModuleTree(specs, config);
  const child = pack.placements.find((pl) => pl.id === "c")!;
  const parent = pack.placements.find((pl) => pl.id === "p")!;

  it("자식 출력 포트 1개 — 두 링크가 한 벨트에 묶임", () => {
    expect(child.module.outputPorts.filter((p) => p.line.name === "x")).toHaveLength(1);
  });

  it("부모 입력 포트 1개 = 트렁크(벨트가 두 머신의 행을 관통, 머신마다 탭)", () => {
    const ports = parent.module.inputPorts.filter((p) => p.line.name === "x");
    expect(ports).toHaveLength(1);
    // 트렁크 belt 가 두 머신의 좌석 행(각 1행)을 다 덮는다 — 벨트 셀 ≥ 머신 간 거리.
    expect(ports[0].cells.length).toBeGreaterThanOrEqual(2);
  });

  it("홉 1개 — 그룹 순서 1:1, raw 0", () => {
    expect(pack.hops.filter((h) => h.item === "x")).toHaveLength(1);
    expect(pack.rawPorts.filter((p) => p.line.name === "x")).toHaveLength(0);
  });

  it("라우팅 실패 0", () => {
    const hop = routeModuleHops(pack, {
      beltEntityName: "transport-belt",
      undergroundBeltEntityName: "underground-belt",
      beltMaxUndergroundDistance: 4,
    });
    expect(hop.failures).toBe(0);
  });
});

describe("점대점 — 큰 링크는 그릇이 꽉 차 안 묶인다", () => {
  // 부모 2대(머신당 18 = 팔 3 = 그릇 가득), 자식 2대(머신당 18 = 딱 한 그릇).
  // 물붓기: (c0→p0,3) 에서 c0 소진 → (c1→p1,3). 서로 다른 fromMachine → 안 묶임.
  // (자식 머신당 팔 3 = W면 3행 — 좌석 물리 성립. 머신당 6팔 수치는 W면에 못 앉아
  //  planner 가 direct 로 떨어뜨리므로 이 테스트의 대상이 아니다.)
  const specs: NodeSpec[] = [
    {
      id: "p", depth: 0, machine: M, count: 2,
      lines: [inL("x"), outL("prod")],
      supplyCapacity: { tapCapacity: 6, lineRates: new Map([["input:x", 36], ["output:prod", 12]]) },
    },
    {
      id: "c", depth: 1, parentId: "p", machine: M, count: 2,
      lines: [outL("x")],
      supplyCapacity: { tapCapacity: 6, lineRates: new Map([["output:x", 36]]) },
    },
  ];
  const pack = packModuleTree(specs, config);
  const child = pack.placements.find((pl) => pl.id === "c")!;
  const parent = pack.placements.find((pl) => pl.id === "p")!;

  it("그룹이 안 묶여 포트 2쌍·홉 2개(fan-out 유지)", () => {
    expect(child.module.outputPorts.filter((p) => p.line.name === "x")).toHaveLength(2);
    expect(parent.module.inputPorts.filter((p) => p.line.name === "x")).toHaveLength(2);
    expect(pack.hops.filter((h) => h.item === "x")).toHaveLength(2);
  });

  it("라우팅 실패 0", () => {
    const hop = routeModuleHops(pack, {
      beltEntityName: "transport-belt",
      undergroundBeltEntityName: "underground-belt",
      beltMaxUndergroundDistance: 4,
    });
    expect(hop.failures).toBe(0);
  });
});
