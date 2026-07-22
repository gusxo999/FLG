import { describe, it, expect, vi } from "vitest";
import { packModuleTree, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeModuleHops } from "./moduleHop";
import type { IoLine } from "../module/clusterPortPlanner";
import * as allocateMachineLinksModule from "../module/allocateMachineLinks";

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
  // 예약 장부를 켠다 — 안 켜면 홉이 전부 dijkstra 폴백으로 나고, "실패 0" 이 예약을
  // 검증하지 않는다(2026-07-20 실측: planned 0 / fallback 전부).
  channelGeometry: true,
  reservePerimeterLanes: true,
  beltMaxUndergroundDistance: 4,
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

  it("HopSpec.linkId 가 채널 예약 키로 그대로 흐른다 — seq 위치가 아니라 신원", () => {
    const hop = pack.hops.find((h) => h.item === "x")!;
    expect(hop.linkId).toBeDefined();
    expect(hop.linkId).toBe(hop.from.linkId);
  });

  it("라우팅 실패 0", () => {
    const hop = routeModuleHops(pack, {
      beltEntityName: "transport-belt",
      undergroundBeltEntityName: "underground-belt",
      beltMaxUndergroundDistance: 4,
    });
    expect(hop.failures).toBe(0);
    // 예약이 냈는지까지 본다 — dijkstra 폴백도 길은 내므로 "실패 0" 만으론 증거가 안 된다.
    expect(hop.dijkstraFallback).toBe(0);
  });

  it("링크 신원이 전부 짝을 찾는다 (linkMismatches 0)", () => {
    expect(pack.linkMismatches).toEqual([]);
  });
});

describe("점대점 — 큰 링크는 그릇이 꽉 차 안 묶인다", () => {
  // 부모 2대(머신당 18 = 팔 3 = 그릇 가득), 자식 2대(머신당 18 = 딱 한 그릇).
  // 물붓기: (c0→p0,3) 에서 c0 소진 → (c1→p1,3). 서로 다른 fromMachine → 안 묶임.
  // (자식 머신당 팔 3 = W면 3행 — 좌석 물리 성립. 머신당 6팔 수치는 W면에 못 앉아
  //  이제 gap 으로 넘어간다 — 아래 "거대 출력" 참고.)
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
    // 예약이 냈는지까지 본다 — dijkstra 폴백도 길은 내므로 "실패 0" 만으론 증거가 안 된다.
    expect(hop.dijkstraFallback).toBe(0);
  });

  it("링크 신원이 전부 짝을 찾는다 (linkMismatches 0)", () => {
    expect(pack.linkMismatches).toEqual([]);
  });
});

// 거대 출력 — 자식 머신 하나가 W면 좌석(3행)보다 많은 팔을 낸다. 넘친 그룹은 **gap** 으로
// 넘어가 가로 벨트로 서쪽 변까지 와서 90° 꺾인다. 여기서 보는 것은 기하가 아니라
// **그 홉을 누가 냈는가**다 — 모서리 포트가 평범한 W 포트라면 장부가 계획할 수 있어야 한다.
describe("거대 출력 — 넘친 그룹이 gap 을 타고 나가도 예약이 계획한다", () => {
  // 자식 2대 × 36/대 = 팔 6 → 그릇 3 이라 머신당 그룹 2개(W 3행 + gap 3칸).
  // 부모 4대 × 18/대 = 팔 3 → 부모 면은 안 넘친다.
  const specs: NodeSpec[] = [
    {
      id: "p", depth: 0, machine: M, count: 4,
      lines: [inL("x"), outL("prod")],
      supplyCapacity: { tapCapacity: 6, lineRates: new Map([["input:x", 72], ["output:prod", 24]]) },
    },
    {
      id: "c", depth: 1, parentId: "p", machine: M, count: 2,
      lines: [outL("x")],
      supplyCapacity: { tapCapacity: 6, lineRates: new Map([["output:x", 72]]) },
    },
  ];
  const pack = packModuleTree(specs, config);
  const child = pack.placements.find((pl) => pl.id === "c")!;

  it("자식 머신마다 W 하나 + gap 하나 — 팔을 깎지 않는다", () => {
    const ports = child.module.outputPorts.filter((p) => p.line.name === "x");
    expect(ports).toHaveLength(4);
    // 넘친 그룹도 모서리에서 꺾여 **평범한 W 포트**로 나온다.
    expect(ports.filter((p) => p.face === "W")).toHaveLength(4);
    expect(ports.reduce((s, p) => s + p.cells.length, 0)).toBe(12); // 팔 합 = 6×2
  });

  it("unrouted 0 — 넘쳤다고 줄을 버리지 않는다", () => {
    expect(child.module.unroutedLines).toHaveLength(0);
  });

  // 이 수가 gap 방향을 고른 **이유**다.
  //
  // 옛 시도(E 면으로 넘기기)에서는 planned 2 / dijkstraFallback 2 였다 — 넘친 홉이 전부
  // 탐색으로 났다. 장부는 자식 출력이 **W 로 채널에 들어온다**고 보므로 E 포트는 장부가 아는
  // "납품"이 아니었기 때문이다.
  //
  // gap 으로 넘기면 가로 벨트가 서쪽 변에서 꺾여 **평범한 W 포트**가 되므로, 장부가 새 모양을
  // 배울 필요 없이 그대로 계획한다 → **fallback 0**. 예약 철학이 지켜진다.
  it("네 홉 전부 예약이 계획한다 — 탐색 0", () => {
    const hop = routeModuleHops(pack, {
      beltEntityName: "transport-belt",
      undergroundBeltEntityName: "underground-belt",
      beltMaxUndergroundDistance: 4,
    });
    expect(hop.failures).toBe(0);
    expect(hop.planned).toBe(4);
    expect(hop.dijkstraFallback).toBe(0);
  });
});

// 신원이 자식 구분을 잃지 않는지 — 같은 부모·같은 품목을 자식 **둘**이 먹인다. inputLinksOf
// 가 두 자식의 그룹을 평평하게 이어붙이면서도 groupIndex 를 자식마다 따로 세야
// linkGroupId 가 outputLinksOf(각 자식) 와 어긋나지 않는다(2026-07-21, 이 세션에서 고친 지점).
describe("링크 신원 — 같은 부모를 같은 품목으로 먹이는 자식이 둘", () => {
  const specs: NodeSpec[] = [
    {
      id: "p", depth: 0, machine: M, count: 1,
      lines: [inL("x"), outL("prod")],
      supplyCapacity: { tapCapacity: 6, lineRates: new Map([["input:x", 6], ["output:prod", 6]]) },
    },
    {
      id: "c1", depth: 1, parentId: "p", machine: M, count: 1,
      lines: [outL("x")],
      supplyCapacity: { tapCapacity: 6, lineRates: new Map([["output:x", 6]]) },
    },
    {
      id: "c2", depth: 1, parentId: "p", machine: M, count: 1,
      lines: [outL("x")],
      supplyCapacity: { tapCapacity: 6, lineRates: new Map([["output:x", 6]]) },
    },
  ];
  const pack = packModuleTree(specs, config);

  it("두 간선이 서로 다른 신원으로 각자 짝을 찾는다 (mismatch 0)", () => {
    expect(pack.linkMismatches).toEqual([]);
  });

  it("홉 2개, raw 0 — 자식마다 하나씩 정확히 짝지어진다", () => {
    expect(pack.hops.filter((h) => h.item === "x")).toHaveLength(2);
    expect(pack.rawPorts.filter((p) => p.line.name === "x")).toHaveLength(0);
  });
});

// 간선당 1회 계산(MachineLinkGroup 리팩터 회귀 테스트, 2026-07-22) — 예전엔 outputLinksOf
// (자식 쪽)·inputLinksOf(부모 쪽)가 같은 간선에 대해 edgeLinkGroups 를 각자 독립으로 두 번
// 불렀다("결정적 함수+같은 입력이면 같은 출력"이라는 결정성만 믿고 양쪽이 일치하길 기대하던
// 구조). packModuleTree 가 간선당 사전 캐시 1개만 만들고 양쪽이 그 캐시를 참조하는지,
// edgeLinkGroups 내부에서 트렁크 공유를 실제로 계산하는 groupLinkBelts(cross-module import
// — 같은 파일 안 호출과 달리 vi.spyOn 이 가로챌 수 있다) 호출 횟수로 확인한다.
describe("링크 그룹 계산 — 간선당 정확히 1회(이중 계산 회귀 방지)", () => {
  it("자식→부모 간선 하나에 groupLinkBelts 가 딱 한 번 불린다", () => {
    const spy = vi.spyOn(allocateMachineLinksModule, "groupLinkBelts");
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
    packModuleTree(specs, config);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
