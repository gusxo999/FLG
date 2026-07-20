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
});

describe("점대점 — 큰 링크는 그릇이 꽉 차 안 묶인다", () => {
  // 부모 2대(머신당 18 = 팔 3 = 그릇 가득), 자식 2대(머신당 18 = 딱 한 그릇).
  // 물붓기: (c0→p0,3) 에서 c0 소진 → (c1→p1,3). 서로 다른 fromMachine → 안 묶임.
  // (자식 머신당 팔 3 = W면 3행 — 좌석 물리 성립. 머신당 6팔 수치는 W면에 못 앉아
  //  이제 E 면으로 넘어간다 — 아래 "거대 출력" 참고.)
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
});

// 거대 출력 — 자식 머신 하나가 W면 좌석(3행)보다 많은 팔을 낸다. 넘친 그룹은 E 면으로
// 넘어가고, 그 포트는 **왼쪽 부모까지 되돌아 나가야** 한다. 여기서 보는 것은 기하가 아니라
// 그 되돌아 나가는 길이 **실제로 라우팅되는가**다.
describe("거대 출력 — 넘친 그룹이 E 로 나가도 부모까지 이어진다", () => {
  // 자식 2대 × 36/대 = 팔 6 → 그릇 3 이라 머신당 그룹 2개(W 3행 + E 3행).
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

  it("자식 머신마다 W 하나 + E 하나 — 팔을 깎지 않는다", () => {
    const ports = child.module.outputPorts.filter((p) => p.line.name === "x");
    expect(ports).toHaveLength(4);
    expect(ports.filter((p) => p.face === "W")).toHaveLength(2);
    expect(ports.filter((p) => p.face === "E")).toHaveLength(2);
    expect(ports.reduce((s, p) => s + p.cells.length, 0)).toBe(12); // 팔 합 = 6×2
  });

  it("unrouted 0 — 넘쳤다고 줄을 버리지 않는다", () => {
    expect(child.module.unroutedLines).toHaveLength(0);
  });

  // ⚠ 여기가 **알려진 저하 지점**이다(2026-07-20 실측).
  //
  // 길은 다 난다(failures 0). 하지만 W 로 나가는 홉만 예약 장부가 계획하고, **E 로 넘어간
  // 홉 2개는 dijkstra 폴백**으로 난다. 이유: 장부([channelGeometryPlanner])는 자식 출력이
  // **W 로 채널에 들어온다**고 보고 트랙을 배정한다. E 포트는 채널 반대쪽을 보므로 장부가
  // 아는 "납품"이 아니다 — 기존에 이미 이름이 붙은 **스필 홉** 부류(폭만 예약하고 탐색에
  // 맡김)에 들어간다.
  //
  // 즉 새 구멍이 아니라 **기존 저하 부류의 인구가 는 것**이다. 그래도 예약 철학과 어긋나므로
  // 수치를 못박아 **눈에 보이게** 둔다 — 나아지면 이 기대값이 깨져서 알려준다.
  it("길은 다 나지만 E 로 넘어간 홉은 아직 예약이 아니라 탐색이 낸다", () => {
    const hop = routeModuleHops(pack, {
      beltEntityName: "transport-belt",
      undergroundBeltEntityName: "underground-belt",
      beltMaxUndergroundDistance: 4,
    });
    expect(hop.failures).toBe(0);
    expect(hop.planned).toBe(2); // W 로 나간 두 홉
    expect(hop.dijkstraFallback).toBe(2); // E 로 넘어간 두 홉 ← 없애야 할 수
  });
});
