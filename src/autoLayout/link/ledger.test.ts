import { describe, it, expect } from "vitest";
import type { DeliverySpec, PackResult } from "../tree/types/pack";
import type { ModulePort } from "../module/types/module";
import { EntityType } from "../../types/layout";
import { deliveryKey } from "./policy/edge";
import { plannedChainsOf } from "./ledger";
import { finishFluidChain } from "./emit";
import { buildPlannedChain } from "./shape";

/**
 * **장부가 땅속으로 계획한 납품은 그 매체의 사거리로 편다** (2026-10-01 · docs/auto-layout/common/layout-models.md §3.5 제4조 ③).
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

describe("곧장 건너는 땅속 계획은 되돌아 걷지 않는다", () => {
  // 출발 행 = 도착 행(10) 이라 열 채널을 가로로 곧장 건넌다. 트랙 x=13 은 그 직선 위의 *지나가는 점* 이고,
  // 점프 (13,10)→(11,10) 이 그 점에서 시작해 남의 세로 트랙 x=12 를 땅속으로 넘는다(2026-10-02 합성 스윕의 모양).
  const d: DeliverySpec = {
    item: "petroleum-gas",
    from: port(15, 9, "W", "infinity-pipe"),
    to: port(10, 13, "E", "infinity-pipe"),
    fromId: "child",
    toId: "parent",
    seq: 0,
  };
  const g = {
    kind: "undergroundCrossing",
    trackX: 13,
    fromRowChannel: { row: 10 },
    toRowChannel: { row: 10 },
    jumps: [{ from: { x: 13, y: 10 }, to: { x: 11, y: 10 } }],
  } as const;

  it("점프 밑 칸(12,10)을 땅 위로 밟지 않고, 한 칸도 두 번 지나지 않는다", () => {
    const chain = buildPlannedChain(d, g as never)!;
    const keys = chain.cells.map((c) => `${c.x},${c.y}`);
    expect(keys).toEqual(["15,9", "15,10", "14,10", "13,10", "11,10", "10,10", "10,11", "10,12", "10,13"]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("꺾이는 계단꼴은 그대로다(대조군) — 트랙에서 세로로 내려가며 건넌다", () => {
    const stair = { ...g, fromRowChannel: { row: 9 }, jumps: [{ from: { x: 13, y: 9 }, to: { x: 13, y: 11 } }] };
    const chain = buildPlannedChain({ ...d, to: port(10, 13, "E", "infinity-pipe") }, { ...stair, toRowChannel: { row: 12 } } as never)!;
    const keys = chain.cells.map((c) => `${c.x},${c.y}`);
    expect(keys).toEqual(["15,9", "14,9", "13,9", "13,11", "13,12", "12,12", "11,12", "10,12", "10,13"]);
  });
});
