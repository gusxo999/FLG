/**
 * 납품 경로 결과를 **위치가 아니라 신원으로** 되찾는다 (A-1 회귀 방지).
 *
 * ## 무엇이 틀렸었나
 *
 * [routeDeliveryRoutes] 는 유체를 먼저 깔려고 `pack.deliveries` 를 **재정렬해서** 돈다
 * (유체는 폴백이 없어 자리를 먼저 잡아야 한다 — 정렬 자체는 옳다). 그런데 결과를 그
 * **작업 순서대로** 쌓아 놓고, 호출자(`moduleWizard`)는 **계획 순서의 인덱스**로 읽었다:
 *
 * ```
 * pack.deliveries = [ 아이템, 유체 ]     ← 계획 순서
 * ordered         = [ 유체,  아이템 ]    ← 유체 먼저
 * routes          = [ r유체, r아이템 ]   ← 작업 순서로 쌓임
 *                      ↑ routes[0] 을 "아이템의 결과" 로 읽었다
 * ```
 *
 * 결과: 다른 경로의 셀이 엉뚱한 `Routing.placed` 에 붙어 **연결선이 틀린 곳을 잇는다.**
 *
 * ## 왜 여태 안 드러났나 — 이 테스트가 필요한 이유
 *
 * `sort` 가 안정 정렬이라 **전부 아이템이거나 전부 유체면 순서가 안 바뀐다.** 기존 테스트는
 * 전부 그런 트리라 고치기 전에도 후에도 똑같이 통과한다. 그래서 **섞인 트리**가 필요하다.
 * 게다가 그 값을 쓰는 연결선 렌더까지 죽어 있어(운반체 단절) 화면에도 안 나왔다.
 */

import { describe, it, expect } from "vitest";
import { packModuleTree, deliveryKey, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeDeliveryRoutes, type DeliveryConfig } from "./deliveryRoute";
import type { IoLine } from "./module/clusterPortPlanner";

const inL = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
const outL = (name: string): IoLine => ({ name, kind: "belt", role: "output" });
const inFluidL = (name: string): IoLine => ({ name, kind: "pipe", role: "input" });
const outFluidL = (name: string): IoLine => ({ name, kind: "pipe", role: "output" });
const M = { entityName: "assembling-machine-2", w: 3, h: 3 };

/** 유체 상자가 `side` 면을 보는 회전 — moduleWizard 의 wantFace 와 같은 값. */
const fluidTrunk = (side: "W" | "E", role: "input" | "output") => ({
  direction: (side === "W" ? 12 : 4) as 12 | 4,
  pipeEntityName: "pipe",
  undergroundPipeEntityName: "pipe-to-ground",
  pipeMaxUndergroundDistance: 10,
  lines: [
    { name: "petroleum-gas", role, side, fluidboxOffset: 0, rank: 0, boxIndex: 0 },
  ],
});

/**
 * **섞인 트리** — 부모가 유체 하나와 아이템 하나를 받는다.
 * 자식 둘: `plater`(아이템 출력) · `gasmaker`(유체 출력).
 *
 * **자식 순서가 이 계측의 핵심이다.** 아이템 자식을 **먼저** 둬야 `pack.deliveries` 가
 * `[아이템, 유체]` 로 나오고, 유체 우선 정렬이 실제로 순서를 뒤집는다. 유체를 먼저 두면
 * 정렬이 안정이라 순서가 그대로여서 — 인덱스로 읽어도 우연히 맞는다(= 계측이 무의미).
 * 아래 마지막 테스트가 이 전제를 지킨다.
 */
const specs: NodeSpec[] = [
  {
    id: "user", depth: 0, machine: M, count: 2,
    lines: [inFluidL("petroleum-gas"), inL("iron-plate"), outL("plastic-bar")],
    fluidTrunk: fluidTrunk("E", "input"),
  },
  {
    id: "plater", depth: 1, parentId: "user", machine: M, count: 2,
    lines: [inL("iron-ore"), outL("iron-plate")],
  },
  {
    id: "gasmaker", depth: 1, parentId: "user", machine: M, count: 2,
    lines: [inL("coal"), outFluidL("petroleum-gas")],
    fluidTrunk: fluidTrunk("W", "output"),
  },
];

const packConfig: PackConfig = {
  inserterEntityName: "inserter",
  inserters: [{ entityName: "inserter", reach: 1, throughput: 0 }, { entityName: "long-handed-inserter", reach: 2, throughput: 0 }],
  beltEntityName: "transport-belt",
  channelGeometry: true,
  reservePerimeterLanes: true,
  beltMaxUndergroundDistance: 4,
};
const deliveryConfig: DeliveryConfig = {
  beltEntityName: "transport-belt",
  pipeEntityName: "pipe",
  pipeMaxUndergroundDistance: 10,
  undergroundPipeEntityName: "pipe-to-ground",
};

const pack = packModuleTree(specs, packConfig);

describe("납품 경로 결과 짝짓기 — 위치가 아니라 신원", () => {
  it("전제: 유체와 아이템 납품 경로가 **둘 다** 있다", () => {
    const items = pack.deliveries.map((d) => d.item).sort();
    expect(items, "섞인 트리가 아니면 이 파일의 계측이 무의미하다").toEqual([
      "iron-plate",
      "petroleum-gas",
    ]);
  });

  it("모든 결과가 계획된 납품 경로의 신원을 갖는다 — 유실도 창작도 없다", () => {
    const res = routeDeliveryRoutes(pack, deliveryConfig);
    const planned = pack.deliveries.map(deliveryKey).sort();
    const got = res.routes.map((r) => r.key).sort();
    expect(got).toEqual(planned);
  });

  it("신원으로 찾으면 그 납품 경로의 품목이 나온다 — **인덱스로 읽으면 어긋나던 자리**", () => {
    const res = routeDeliveryRoutes(pack, deliveryConfig);
    const byKey = new Map(res.routes.map((r) => [r.key, r]));
    for (const d of pack.deliveries) {
      const route = byKey.get(deliveryKey(d));
      expect(route, `${d.item} 의 결과를 신원으로 못 찾는다`).toBeDefined();
      expect(route!.item, "신원 조회가 다른 납품 경로의 결과를 준다").toBe(d.item);
    }
  });

  it("결과 순서는 계획 순서와 **다르다** — 그래서 인덱스로 읽으면 안 된다", () => {
    const res = routeDeliveryRoutes(pack, deliveryConfig);
    const plannedOrder = pack.deliveries.map(deliveryKey);
    const routeOrder = res.routes.map((r) => r.key);
    // 유체 우선 정렬이 실제로 순서를 바꿨는지. 안 바뀌었다면(정렬 정책이 바뀌었다면)
    // 이 파일의 전제가 사라진 것이므로 계측을 다시 설계해야 한다.
    const fluidFirst = plannedOrder[0] !== routeOrder[0];
    expect(
      fluidFirst,
      "정렬이 순서를 안 바꿨다 — 유체 우선 정책이 사라졌거나 트리가 더는 섞이지 않는다",
    ).toBe(true);
  });
});
