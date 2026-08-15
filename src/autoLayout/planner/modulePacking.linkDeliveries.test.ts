import { describe, it, expect, vi } from "vitest";
import { packModuleTree, edgeMachineLinks, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeDeliveryRoutes } from "./deliveryRoute";
import type { IoLine } from "./module/clusterPortPlanner";
import * as allocateMachineLinksModule from "./link/allocateMachineLinks";
import { faceVector } from "../util/helper";
import { EntityType } from "../../types/layout";

// 끝단 통합 — 링크 그룹(=벨트) 단위 fan-out/fan-in 이 1:1 납품 경로로 이어지는지.
// v1 은 **링크 하나 = 벨트 하나**다(2026-07-22).
// 링크가 작아 그릇에 여유가 남아도 목적지가 다르면 안 묶는다 — 묶으면 그 벨트가 부모 머신
// 여럿을 관통해야 하고, 그러려면 그 머신들이 붙어 있어야 하기 때문(= ColumnCluster 강제).

const M = { entityName: "assembling-machine-3", w: 3, h: 3 };
const inL = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
const outL = (name: string): IoLine => ({ name, kind: "belt", role: "output" });

const config: PackConfig = {
  inserterEntityName: "inserter",
  inserters: [{ entityName: "inserter", reach: 1, throughput: 6 }, { entityName: "long-handed-inserter", reach: 2, throughput: 6 }],
  beltEntityName: "transport-belt",
  belts: [{ entityName: "transport-belt", throughput: 20 }],
  // 예약 장부를 켠다 — 안 켜면 납품 경로가 전부 dijkstra 폴백으로 나고, "실패 0" 이 예약을
  // 검증하지 않는다(2026-07-20 실측: planned 0 / fallback 전부).
  channelGeometry: true,
  reservePerimeterLanes: true,
  beltMaxUndergroundDistance: 4,
};

// ─────────────────────────────────────────────────────────────────────────────
// **팔 하나의 처리량은 그 좌석에 실제로 앉는 팔의 것이어야 한다** (2026-07-23).
//
// 실측(1.txt, kr-glass 20/s)에서 벨트 한 줄이 팔 7개(70/s)를 받았다 — 벨트는 45/s 다.
// 원인은 `tapCapacity` 가 `min(fast 10, long-handed 1.2) = 1.2` 였던 것. 링크 좌석은 d1 에
// 앉아 d2 를 집으므로 **긴팔이 앉을 수 없는데도**(reach 는 고정 거리다) 긴팔 속도로 셌다.
// 그 하나가 두 곳을 동시에 망가뜨렸다:
//  - 팔 개수를 8배로 세서 면(7행)을 넘쳐 [7,3] 으로 갈리고,
//  - 그릇이 `45÷1.2 = 37` 이 되어 **벨트 상한이 사실상 사라졌다**.
// 그래서 검사할 불변식은 하나다: **한 링크의 팔이 나르는 양은 그 벨트를 넘지 않는다.**
// ─────────────────────────────────────────────────────────────────────────────
describe("그릇 — 링크 하나가 자기 벨트를 넘지 않는다", () => {
  // 실측 그대로: 벨트 45/s, fast 10/s, long-handed 1.2/s.
  const real: PackConfig = {
    ...config,
    belts: [{ entityName: "express-transport-belt", throughput: 45 }],
  };
  // kr-sand(자식 4대, 48/s) → kr-glass(부모 5대, 40/s).
  const child: NodeSpec = {
    id: "c", depth: 1, parentId: "p", machine: M, count: 4,
    lines: [outL("kr-sand")],
    // moduleWizard 가 채우는 값 = **reach-1 중 가장 빠른 팔**(= fast 10). min 이 아니다.
    supplyCapacity: { lineRates: new Map([["output:kr-sand", 48]]) },
  };
  const parent: NodeSpec = {
    id: "p", depth: 0, machine: M, count: 5,
    lines: [inL("kr-sand"), outL("kr-glass")],
    supplyCapacity: { lineRates: new Map([["input:kr-sand", 40]]) },
  };

  const links = edgeMachineLinks(child, parent, "kr-sand", real)!;

  it("어떤 링크도 벨트 처리량을 넘겨 싣지 않는다", () => {
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      // 고칠 때까지: tapCap 1.2 → 그릇 37 → 팔 7개 → 70/s > 45/s 로 여기서 터진다.
      expect(l.inserterCount * 10).toBeLessThanOrEqual(45);
    }
  });

  it("자식 머신 하나가 요구하는 팔이 면 좌석(3행)을 안 넘는다", () => {
    // 팔을 느린 팔로 세면 머신당 10개를 요구해 면이 넘치고 벨트가 갈려 나갔다.
    const byMachine = new Map<number, number>();
    for (const l of links) byMachine.set(l.fromMachine, (byMachine.get(l.fromMachine) ?? 0) + l.inserterCount);
    for (const arms of byMachine.values()) expect(arms).toBeLessThanOrEqual(M.h);
  });
});

describe("작은 입력도 묶지 않는다 — 목적지가 다르면 벨트도 따로", () => {
  // 부모 2대(머신당 6 = 팔 1), 자식 2대(머신당 12). 링크: (c0→p0,1),(c0→p1,1).
  // 그릇은 3이라 예전이면 한 벨트로 묶였을 자리 — 이제 목적지가 달라 벨트 둘이다.
  const specs: NodeSpec[] = [
    {
      id: "p", depth: 0, machine: M, count: 2,
      lines: [inL("x"), outL("prod")],
      supplyCapacity: { lineRates: new Map([["input:x", 12], ["output:prod", 12]]) },
    },
    {
      id: "c", depth: 1, parentId: "p", machine: M, count: 2,
      lines: [outL("x")],
      supplyCapacity: { lineRates: new Map([["output:x", 24]]) },
    },
  ];
  const pack = packModuleTree(specs, config);
  const child = pack.placements.find((pl) => pl.id === "c")!;
  const parent = pack.placements.find((pl) => pl.id === "p")!;

  it("자식 출력 포트 2개 — 그릇에 여유가 있어도 안 묶는다", () => {
    expect(child.module.outputPorts.filter((p) => p.line.name === "x")).toHaveLength(2);
  });

  it("부모 입력 포트 2개 — 벨트가 남의 머신 행을 관통하지 않는다", () => {
    const ports = parent.module.inputPorts.filter((p) => p.line.name === "x");
    expect(ports).toHaveLength(2);
    // 각 벨트는 **자기 목적지 머신의 좌석 행만** 덮는다(팔 1개 = 셀 1개).
    expect(ports.map((p) => p.cells.length)).toEqual([1, 1]);
  });

  it("납품 경로 2개 — 그룹 순서 1:1, raw 0", () => {
    expect(pack.deliveries.filter((h) => h.item === "x")).toHaveLength(2);
    expect(pack.rawPorts.filter((p) => p.line.name === "x")).toHaveLength(0);
  });

  it("DeliverySpec.linkId 가 채널 예약 키로 그대로 흐른다 — seq 위치가 아니라 신원", () => {
    const delivery = pack.deliveries.find((h) => h.item === "x")!;
    expect(delivery.linkId).toBeDefined();
    expect(delivery.linkId).toBe(delivery.from.linkId);
  });

  it("라우팅 실패 0", () => {
    const delivery = routeDeliveryRoutes(pack, {
      beltEntityName: "transport-belt",
      undergroundBeltEntityName: "underground-belt",
      beltMaxUndergroundDistance: 4,
    });
    expect(delivery.failures).toBe(0);
    // 예약이 냈는지까지 본다 — dijkstra 폴백도 길은 내므로 "실패 0" 만으론 증거가 안 된다.
    expect(delivery.dijkstraFallback).toBe(0);
  });

  it("링크 신원이 전부 짝을 찾는다 (linkMismatches 0)", () => {
    expect(pack.linkMismatches).toEqual([]);
  });

  // 포트 상자가 납품 경로 belt 로 바뀌면 그 상자에 붙어 있던 인서터는 **belt→belt** 가 된다 —
  // 하는 일은 없이 처리량만 인서터 속도로 깎는다. 상자와 **같이** 떨어지고 그 자리도
  // belt 로 메워져야 납품 경로 벨트가 트렁크로 곧장 흐른다.
  it("포트 인서터도 상자와 같이 떨어지고, 그 자리는 belt 가 된다", () => {
    const res = routeDeliveryRoutes(pack, {
      beltEntityName: "transport-belt",
      undergroundBeltEntityName: "underground-belt",
      beltMaxUndergroundDistance: 4,
    });
    const beltAt = new Map<string, EntityType>(
      res.cells.map((c) => [`${c.x},${c.y}`, c.cell.entityType]),
    );

    for (const delivery of pack.deliveries.filter((h) => h.item === "x")) {
      for (const port of [delivery.from, delivery.to]) {
        // 링크 포트 = [상자][인서터][벨트]. 좌석 건너편이 벨트임을 먼저 못 박는다 —
        // 이게 거짓이면 아래 기대는 다른 이유로 통과하는 셈이라 증거가 못 된다.
        const fv = faceVector(port.face);
        const seat = { x: port.anchor.x - fv.x, y: port.anchor.y - fv.y };
        const trunkStart = { x: port.anchor.x - 2 * fv.x, y: port.anchor.y - 2 * fv.y };
        expect(
          port.cells.some((c) => c.x === trunkStart.x && c.y === trunkStart.y),
          "링크 포트가 아님 — 이 테스트의 전제가 깨졌다",
        ).toBe(true);

        const seatKey = `${seat.x},${seat.y}`;
        expect(res.strippedCellKeys.has(seatKey), `좌석 인서터가 안 떨어짐 @${seatKey}`).toBe(true);
        expect(beltAt.get(seatKey), `좌석 자리가 belt 로 안 메워짐 @${seatKey}`).toBe(
          EntityType.Belt,
        );
      }
    }
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
      supplyCapacity: { lineRates: new Map([["input:x", 36], ["output:prod", 12]]) },
    },
    {
      id: "c", depth: 1, parentId: "p", machine: M, count: 2,
      lines: [outL("x")],
      supplyCapacity: { lineRates: new Map([["output:x", 36]]) },
    },
  ];
  const pack = packModuleTree(specs, config);
  const child = pack.placements.find((pl) => pl.id === "c")!;
  const parent = pack.placements.find((pl) => pl.id === "p")!;

  it("그룹이 안 묶여 포트 2쌍·납품 경로 2개(fan-out 유지)", () => {
    expect(child.module.outputPorts.filter((p) => p.line.name === "x")).toHaveLength(2);
    expect(parent.module.inputPorts.filter((p) => p.line.name === "x")).toHaveLength(2);
    expect(pack.deliveries.filter((h) => h.item === "x")).toHaveLength(2);
  });

  it("라우팅 실패 0", () => {
    const delivery = routeDeliveryRoutes(pack, {
      beltEntityName: "transport-belt",
      undergroundBeltEntityName: "underground-belt",
      beltMaxUndergroundDistance: 4,
    });
    expect(delivery.failures).toBe(0);
    // 예약이 냈는지까지 본다 — dijkstra 폴백도 길은 내므로 "실패 0" 만으론 증거가 안 된다.
    expect(delivery.dijkstraFallback).toBe(0);
  });

  it("링크 신원이 전부 짝을 찾는다 (linkMismatches 0)", () => {
    expect(pack.linkMismatches).toEqual([]);
  });
});

// 거대 출력 — 자식 머신 하나가 W면 좌석(3행)보다 많은 팔을 낸다. 넘친 그룹은 **gap** 으로
// 넘어가 가로 벨트로 서쪽 변까지 와서 90° 꺾인다. 여기서 보는 것은 기하가 아니라
// **그 납품 경로를 누가 냈는가**다 — 모서리 포트가 평범한 W 포트라면 장부가 계획할 수 있어야 한다.
describe("거대 출력 — 넘친 그룹이 gap 을 타고 나가도 예약이 계획한다", () => {
  // 자식 2대 × 36/대 = 팔 6 → 그릇 3 이라 머신당 그룹 2개(W 3행 + gap 3칸).
  // 부모 4대 × 18/대 = 팔 3 → 부모 면은 안 넘친다.
  const specs: NodeSpec[] = [
    {
      id: "p", depth: 0, machine: M, count: 4,
      lines: [inL("x"), outL("prod")],
      supplyCapacity: { lineRates: new Map([["input:x", 72], ["output:prod", 24]]) },
    },
    {
      id: "c", depth: 1, parentId: "p", machine: M, count: 2,
      lines: [outL("x")],
      supplyCapacity: { lineRates: new Map([["output:x", 72]]) },
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
  // 옛 시도(E 면으로 넘기기)에서는 planned 2 / dijkstraFallback 2 였다 — 넘친 납품 경로가 전부
  // 탐색으로 났다. 장부는 자식 출력이 **W 로 채널에 들어온다**고 보므로 E 포트는 장부가 아는
  // "납품"이 아니었기 때문이다.
  //
  // gap 으로 넘기면 가로 벨트가 서쪽 변에서 꺾여 **평범한 W 포트**가 되므로, 장부가 새 모양을
  // 배울 필요 없이 그대로 계획한다 → **fallback 0**. 예약 철학이 지켜진다.
  it("네 납품 경로 전부 예약이 계획한다 — 탐색 0", () => {
    const delivery = routeDeliveryRoutes(pack, {
      beltEntityName: "transport-belt",
      undergroundBeltEntityName: "underground-belt",
      beltMaxUndergroundDistance: 4,
    });
    expect(delivery.failures).toBe(0);
    expect(delivery.planned).toBe(4);
    expect(delivery.dijkstraFallback).toBe(0);
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
      supplyCapacity: { lineRates: new Map([["input:x", 6], ["output:prod", 6]]) },
    },
    {
      id: "c1", depth: 1, parentId: "p", machine: M, count: 1,
      lines: [outL("x")],
      supplyCapacity: { lineRates: new Map([["output:x", 6]]) },
    },
    {
      id: "c2", depth: 1, parentId: "p", machine: M, count: 1,
      lines: [outL("x")],
      supplyCapacity: { lineRates: new Map([["output:x", 6]]) },
    },
  ];
  const pack = packModuleTree(specs, config);

  it("두 간선이 서로 다른 신원으로 각자 짝을 찾는다 (mismatch 0)", () => {
    expect(pack.linkMismatches).toEqual([]);
  });

  it("납품 경로 2개, raw 0 — 자식마다 하나씩 정확히 짝지어진다", () => {
    expect(pack.deliveries.filter((h) => h.item === "x")).toHaveLength(2);
    expect(pack.rawPorts.filter((p) => p.line.name === "x")).toHaveLength(0);
  });
});

// 간선당 1회 계산(MachineLinkGroup 리팩터 회귀 테스트, 2026-07-22) — 예전엔 outputLinksOf
// (자식 쪽)·inputLinksOf(부모 쪽)가 같은 간선에 대해 edgeLinkGroups 를 각자 독립으로 두 번
// 불렀다("결정적 함수+같은 입력이면 같은 출력"이라는 결정성만 믿고 양쪽이 일치하길 기대하던
// 구조). packModuleTree 가 간선당 사전 캐시 1개만 만들고 양쪽이 그 캐시를 참조하는지,
// edgeMachineLinks 가 부르는 allocateMachineLinks(cross-module import — 같은 파일 안 호출과
// 달리 vi.spyOn 이 가로챌 수 있다) 호출 횟수로 확인한다.
describe("링크 그룹 계산 — 간선당 정확히 1회(이중 계산 회귀 방지)", () => {
  it("자식→부모 간선 하나에 allocateMachineLinks 가 딱 한 번 불린다", () => {
    const spy = vi.spyOn(allocateMachineLinksModule, "allocateMachineLinks");
    const specs: NodeSpec[] = [
      {
        id: "p", depth: 0, machine: M, count: 2,
        lines: [inL("x"), outL("prod")],
        supplyCapacity: { lineRates: new Map([["input:x", 12], ["output:prod", 12]]) },
      },
      {
        id: "c", depth: 1, parentId: "p", machine: M, count: 2,
        lines: [outL("x")],
        supplyCapacity: { lineRates: new Map([["output:x", 24]]) },
      },
    ];
    packModuleTree(specs, config);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
