import { describe, it, expect } from "vitest";
import { packModuleTree } from "./build";
import type { NodeSpec, PackConfig } from "./types/pack";
import { routeDeliveryRoutes } from "../link/build";
import type { IoLine } from "../module/types/line";
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
  reservePerimeterExits: true,
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
  /**
   * **기둥 밖 칸 장부가 `ends` 와 어긋나지 않는다** — `구간-밖-주행` 트랙 A1 의 불변.
   *
   * `outside`(칸)는 `ends`(면당 끝 둘)보다 곱다. 그러니 `outside` 가 막는 것은 `ends` 도
   * 이미 막았어야 한다. 0이 아니면 **모델이 틀린 것**이다 — 결정은 아직 `ends` 가 하므로
   * 그 어긋남은 곧 아무도 안 막는 자리가 있다는 뜻이 된다.
   *
   * **수를 못 박지 않는다** — `endsCoarse`(거친 낟알로 잃은 관통 줄)는 트리마다 다르다.
   * 못 박는 것은 **어긋남이 없다**는 관계 하나다.
   */
  it("기둥 밖 장부가 `ends` 와 어긋나지 않는다 (endsDisagree 0)", () => {
    expect(readRunStats().faceDepths.endsDisagree).toBe(0);
  });

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

  /**
   * **폭 역전이 y 축에서도 돈다** — 행 채널 높이가 배정의 **결과**이지 상수가 아니다.
   *
   * 예전엔 높이가 `STACK_GAP = 3` 고정이었고, 트랙이 그보다 많으면 그 경로는 계획을 접고
   * 탐색으로 갔다(옛 `rowChannelShort` · `row-channel-short` 경고). 이제 그 높이가 **모듈
   * 사이 간격을 정하므로** 모자랄 수가 없다.
   *
   * **수로 못 박지 않는다** — 트랙 수는 트리가 바뀌면 바뀐다. 못 박는 것은 **관계**다:
   * 실제 높이 ≥ 배정이 요구한 높이 ≥ 트랙 수.
   */
  describe("행 채널 높이 — 수요에서 유도된다(폭 역전, y 축)", () => {
    it("모든 행 채널이 자기 트랙을 담는다 — 옛 `rowChannelShort` 의 구조적 대체", () => {
      expect(pack.rowChannels.length).toBeGreaterThan(0);
      for (const b of pack.rowChannels) {
        const actual = b.bottom - b.top + 1;
        expect(actual, `${b.kind} d${b.depth} 실제 ${actual} < 요구 ${b.height}`)
          .toBeGreaterThanOrEqual(b.height);
        expect(actual).toBeGreaterThanOrEqual(b.tracks?.size ?? 0);
      }
    });

    it("높이는 `max(하한, 트랙+2)` 다 — 세로 채널과 **같은 식**이다", () => {
      for (const b of pack.rowChannels)
        expect(b.height).toBe(Math.max(3, (b.tracks?.size ?? 0) + 2));
    });

    it("수요가 없으면 하한 그대로 — 옛 `STACK_GAP` 과 같은 수라 배치가 안 움직인다", () => {
      const idle = pack.rowChannels.filter((b) => (b.tracks?.size ?? 0) === 0);
      expect(idle.length).toBeGreaterThan(0);
      for (const b of idle) expect(b.height).toBe(3);
    });
  });
});
