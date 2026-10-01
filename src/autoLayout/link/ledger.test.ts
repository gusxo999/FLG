import { describe, it, expect } from "vitest";
import type { DeliverySpec, PackResult } from "../tree/types/pack";
import type { ModulePort } from "../module/types/module";
import { EntityType } from "../../types/layout";
import { deliveryKey } from "./policy/edge";
import { plannedChainsOf } from "./ledger";
import { finishFluidChain } from "./emit";

/**
 * **장부가 땅속으로 계획한 납품은 그 매체의 사거리로 편다** (2026-10-01, 계획 두점-잇기 Step 2).
 *
 * 채널 장부는 완전 교차에서 유체를 지하파이프로 먼저 넣는다. 그 계획을 칸으로 펴는 문(`plannedChainsOf`)이 지하벨트
 * 사거리만 봤다면, 지하파이프만 고르고 지하벨트를 안 고른 판에서 유체의 땅속 계획이 *"지하 미허용"* 으로 버려진다 —
 * 유체엔 탐색 폴백이 없어(결정 D3) 트리째 거절된다. 장부가 계획한 것을 방출이 버리면 그건 예약이 아니다.
 *
 * 형상: 자식 상자 (10,2) → 트랙 x=5 를 따라 내려가며 (5,4)→(5,6) 을 땅속으로 → 부모 상자 (0,8).
 */
const port = (x: number, y: number, face: "W" | "E", kind: string) =>
  ({ anchor: { x, y }, face, chest: { kind }, cells: [], line: { name: "f", kind: "pipe", role: "output" } }) as unknown as ModulePort;

const deliveryOf = (kind: "infinity-pipe" | "infinity-chest"): DeliverySpec => ({
  item: kind === "infinity-pipe" ? "petroleum-gas" : "coal",
  from: port(10, 2, "W", kind),
  to: port(0, 8, "E", kind),
  fromId: "child",
  toId: "parent",
  seq: 0,
});

const packOf = (d: DeliverySpec) =>
  ({
    placements: [],
    deliveries: [d],
    channelGeometry: {
      deliveries: new Map([
        [deliveryKey(d), { kind: "undergroundCrossing", trackX: 5, jumps: [{ from: { x: 5, y: 4 }, to: { x: 5, y: 6 } }] }],
      ]),
      skips: [],
      reservedExportCells: new Set<string>(),
    },
  }) as unknown as PackResult;

describe("땅속 계획은 매체의 사거리로 편다", () => {
  const fluid = deliveryOf("infinity-pipe");
  const item = deliveryOf("infinity-chest");

  it("유체 — 지하벨트가 없어도 지하파이프가 있으면 편다", () => {
    const plans = plannedChainsOf(packOf(fluid), 0, 10);
    expect(plans.chainMisses).toEqual([]);
    expect(plans.plannedChains.has(deliveryKey(fluid))).toBe(true);
  });

  it("유체 — 지하파이프가 없으면 못 편다(대조군)", () => {
    const plans = plannedChainsOf(packOf(fluid), 5, 0);
    expect(plans.chainMisses.map((m) => m.reason)).toEqual(["underground-not-allowed"]);
  });

  it("아이템 — 지하파이프는 아이템을 못 건네준다(대조군)", () => {
    const plans = plannedChainsOf(packOf(item), 0, 10);
    expect(plans.chainMisses.map((m) => m.reason)).toEqual(["underground-not-allowed"]);
  });

  it("편 사슬은 지하파이프 한 쌍으로 방출된다", () => {
    const chain = plannedChainsOf(packOf(fluid), 0, 10).plannedChains.get(deliveryKey(fluid))!;
    const route = finishFluidChain(fluid, chain, {
      beltEntityName: "transport-belt",
      pipeEntityName: "pipe",
      undergroundPipeEntityName: "pipe-to-ground",
      pipeMaxUndergroundDistance: 10,
    });
    expect(route.ok).toBe(true);
    const ptg = route.cells.filter((c) => c.cell.entityType === EntityType.PipeUnderground);
    expect(ptg.map((c) => `${c.x},${c.y}`).sort()).toEqual(["5,4", "5,6"]);
    // 땅속 칸(5,5)에는 아무것도 안 깔린다 — 거기를 지나는 남의 가로선이 있을 자리다.
    expect(route.cells.some((c) => c.x === 5 && c.y === 5)).toBe(false);
  });
});
