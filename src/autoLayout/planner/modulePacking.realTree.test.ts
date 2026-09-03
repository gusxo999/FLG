import { describe, it, expect } from "vitest";
import { packModuleTree, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeDeliveryRoutes } from "./deliveryRoute";
import type { IoLine } from "./module/ioLine";
import { readRunStats } from "../../debug/runStats";

// 실제 트리(advanced-circuit, count=1)가 링크 기반 새 경로로 라우팅되는지 — 토이 2노드가
// 아니라 다-노드·다-품목·내부간선+external 혼합 트리. production(브라우저)이 rate 를 채우면
// count=1 도 새 경로를 타므로, 이게 "브라우저가 살아있을지"의 브라우저 없는 대리 검증이다.

const M = { entityName: "assembling-machine-3", w: 3, h: 3 };
const inL = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
const outL = (name: string): IoLine => ({ name, kind: "belt", role: "output" });
const cap = (rates: Record<string, number>) => ({
  lineRates: new Map(Object.entries(rates)),
});

const config: PackConfig = {
  inserterEntityName: "inserter",
  inserters: [{ entityName: "inserter", reach: 1, throughput: 6 }, { entityName: "long-handed-inserter", reach: 2, throughput: 6 }],
  beltEntityName: "transport-belt",
  belts: [{ entityName: "transport-belt", throughput: 20 }],
  channelGeometry: true,
  reservePerimeterTracks: true,
  beltMaxUndergroundDistance: 4,
};

// 골든과 같은 구조 + rate. 내부 간선: n1→n0(kr-ec), n2→n0(ec). 나머지 입력은 external.
const specs: NodeSpec[] = [
  {
    id: "n0", depth: 0, machine: M, count: 1,
    lines: [inL("copper-cable"), inL("electronic-circuit"), inL("kr-electronic-components"), outL("advanced-circuit")],
    supplyCapacity: cap({
      "input:copper-cable": 4, "input:electronic-circuit": 2,
      "input:kr-electronic-components": 2, "output:advanced-circuit": 2,
    }),
  },
  {
    id: "n1", depth: 1, parentId: "n0", machine: M, count: 1,
    lines: [inL("plastic-bar"), inL("kr-silicon"), inL("kr-glass"), outL("kr-electronic-components")],
    supplyCapacity: cap({ "input:plastic-bar": 4, "input:kr-silicon": 2, "input:kr-glass": 2, "output:kr-electronic-components": 2 }),
  },
  {
    id: "n2", depth: 1, parentId: "n0", machine: M, count: 1,
    lines: [inL("copper-cable"), inL("stone-tablet"), outL("electronic-circuit")],
    supplyCapacity: cap({ "input:copper-cable": 3, "input:stone-tablet": 1, "output:electronic-circuit": 2 }),
  },
];

describe("packModuleTree — 실제 트리(advanced-circuit)가 새 경로로 라우팅", () => {
  const pack = packModuleTree(specs, config);

  it("내부 간선 품목이 납품 경로로 이어진다 (kr-ec, ec 각 1)", () => {
    expect(pack.deliveries.filter((h) => h.item === "kr-electronic-components")).toHaveLength(1);
    expect(pack.deliveries.filter((h) => h.item === "electronic-circuit")).toHaveLength(1);
  });

  // linkId 짝짓기가 자식·부모 양쪽에서 독립으로 재현되는지 — 실측 트리로 확인.
  it("링크 신원이 전부 짝을 찾는다 (linkMismatches 0)", () => {
    expect(pack.linkMismatches).toEqual([]);
  });

  /**
   * **레인 공유가 여기선 할 일이 없다** — 그리고 그게 옳다.
   *
   * 합류는 *"레인 하나가 다 차서 갈린 줄"* 을 되돌리는 일이다. 이 트리는 간선마다 2/s 뿐이라
   * 레인(벨트 20 → 10)에 한참 못 미쳐 **줄이 애초에 안 갈렸다.** 갈린 적이 없으면 되찾을
   * 절반도 없다.
   *
   * 0 을 잠그는 이유: 후보가 *"간선의 두 줄"* 이라는 정의가 흔들리면 이 수가 먼저 튄다.
   */
  it("수요가 레인 안에 들면 짝이 없다 — 갈린 줄이 없으니 되찾을 것도 없다", () => {
    const share = readRunStats().laneShare;
    expect(share.candidates).toBe(0);
    expect(share.pairs).toBe(0);
  });

  it("deliveryRoute 이 충돌 없이 잇는다 (실패 0)", () => {
    const delivery = routeDeliveryRoutes(pack, {
      beltEntityName: "transport-belt",
      undergroundBeltEntityName: "underground-belt",
      beltMaxUndergroundDistance: 4,
    });
    expect(delivery.failures).toBe(0);
    // 길이 났다는 것만으로는 부족하다 — **누가 냈는지**를 본다. dijkstra 폴백도 길은 낸다.
    expect(delivery.dijkstraFallback).toBe(0);
    expect(delivery.planned).toBeGreaterThan(0);
  });
});
