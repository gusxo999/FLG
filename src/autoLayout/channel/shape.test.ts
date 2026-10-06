import { describe, it, expect } from "vitest";
import { materializeChannelGeometry, routeShape, settleDeliveryRows, type ChannelEndpoint } from "./shape";
import type { DeliverySeed, RowChannelNeed } from "../link/arith/pair";
import type { RowChannel } from "../tree/types/pack";
import type { PerimeterExitPlan } from "../perimeter/types";
import { PERIMETER_MARGIN } from "../shared/grid";

// 채널 세로 범위 [0,9] · 가상 E벽 열 = capCol
const ctx = { yMin: 0, yMax: 9 };
const CAP = 8;

const wall = (row: number, w: "W" | "E"): ChannelEndpoint => ({ kind: "wall", row, wall: w });
const edge = (e: "N" | "S"): ChannelEndpoint => ({ kind: "edge", edge: e });

describe("routeShape — 납품과 반출은 같은 도형이다", () => {
  it("**반출(elbow) = 납품(계단꼴) − 마지막 가로 조각**", () => {
    // 같은 시작점·같은 트랙. 도착만 벽(납품) ↔ 변(반출)으로 바꾼다.
    const 납품 = routeShape(wall(2, "E"), wall(7, "W"), 3, ctx, CAP);
    const 반출 = routeShape(wall(2, "E"), edge("S"), 3, ctx, CAP);

    // 가로 진입은 **같다**.
    expect(반출.h[0]).toEqual(납품.h[0]);
    // 납품엔 가로 **진출**이 하나 더 있다. 반출은 세로가 채널을 그대로 빠져나간다.
    expect(납품.h).toHaveLength(2);
    expect(반출.h).toHaveLength(1);
    // 세로 주행은 둘 다 하나 — 끝나는 행만 다르다(도착 벽의 행 vs 변의 seat 행).
    expect(납품.v).toEqual([{ col: 3, r1: 2, r2: 7 }]);
    expect(반출.v).toEqual([{ col: 3, r1: 2, r2: 9 + PERIMETER_MARGIN }]); // yMax + PERIMETER_MARGIN
  });

  // **seat 행까지 달린다** — 상자는 밴드 밖 `PERIMETER_MARGIN` 칸에 앉고, 예약 셀도 거기까지다(`materializeChannelGeometry`).
  // 2026-10-01 까지 이 시험은 *"바깥 한 칸"* 을 못 박았는데, 그 값이 실제 주행보다 한 행 짧았다 — 그 행의 바깥 행 채널
  // 트랙과의 만남을 도형이 못 봤다(`channel/shape.edgeRowOf`).
  it("`edge` 끝점의 행은 **그 변의 seat 행**이다 — N 은 위, S 는 아래", () => {
    expect(routeShape(wall(4, "W"), edge("N"), 1, ctx, CAP).v).toEqual([{ col: 1, r1: -PERIMETER_MARGIN, r2: 4 }]);
    expect(routeShape(wall(4, "W"), edge("S"), 1, ctx, CAP).v).toEqual([{ col: 1, r1: 4, r2: 9 + PERIMETER_MARGIN }]);
  });

  it("진입 벽이 가로 조각의 **끝**을 정한다 — W벽은 −1, E벽은 capCol", () => {
    expect(routeShape(wall(5, "W"), edge("N"), 2, ctx, CAP).h).toEqual([{ row: 5, c1: -1, c2: 2 }]);
    expect(routeShape(wall(5, "E"), edge("N"), 2, ctx, CAP).h).toEqual([{ row: 5, c1: 2, c2: CAP }]);
  });

  it("**양 끝이 벽이고 행이 같으면 트랙을 안 먹는다** — 세로가 길이 0이라 접는다", () => {
    const s = routeShape(wall(4, "E"), wall(4, "W"), 3, ctx, CAP);
    expect(s.v).toEqual([]); // ← 세로 조각을 남기면 trackCount 가 그 열을 세어 폭이 는다
    expect(s.h).toEqual([{ row: 4, c1: -1, c2: CAP }]); // 채널 전 열을 그 행에서 가로지른다
  });

  it("한쪽이 `edge` 면 행이 같아도 **접지 않는다** — 세로가 밖으로 나가야 한다", () => {
    // 도착이 변이면 도착 행이 seat 행이라 애초에 같아질 수 없지만, 규칙이 벽에만 걸린다는 것을 못 박는다.
    const s = routeShape(wall(-PERIMETER_MARGIN, "E"), edge("N"), 3, ctx, CAP);
    expect(s.v).toEqual([{ col: 3, r1: -PERIMETER_MARGIN, r2: -PERIMETER_MARGIN }]);
    expect(s.h).toHaveLength(1);
  });
});

describe("행을 못 받은 끝 — 계획을 접고 사유를 남긴다", () => {
  // 행 채널의 완전 교차(같은 쪽 · 반대 방향으로 엇갈린 끝)는 한 끝이 행을 못 받는다(`channel/ledger/row.planRowChannel`).
  // 2026-10-02 까지 그 납품은 `eligible` 만 꺼져 *스필* 로 읽혔고, 되꺾기(ㄱ자)를 받아 그 가로가 모듈 몸통을 지났다.
  const seed = (): DeliverySeed => ({
    depth: 1, key: "c→p:x#0", startY: 0, endY: 0, fromId: "c", toId: "p", fromAnchorY: 4, toAnchorY: 2, eligible: true,
  });
  const need: RowChannelNeed = { id: "c→p:x#0:out", nodeId: "c", depth: 1, portY: 0, anchorY: 4, face: "S", x: 1, toward: "W" };
  const rowChannel = (tracks: Map<string, number>): RowChannel =>
    ({ depth: 1, index: 0, kind: "marginS", top: 10, bottom: 12, above: "c", height: 3, tracks }) as RowChannel;
  const emptyExits: PerimeterExitPlan = { assignments: [], marginNeeds: { N: false, S: false, W: false, E: false }, demotions: [], blocked: [], noSideWayOut: 0 } as unknown as PerimeterExitPlan;
  const materialize = (s: DeliverySeed) =>
    materializeChannelGeometry({
      geometryPlans: new Map(), deliverySeeds: [s], exitPlan: emptyExits, placements: [],
      channelStartX: () => 0, rawBbox: { x: 0, y: 0, w: 1, h: 1 }, reserveTracks: false,
    });

  it("행을 못 받으면 도형 없이 `row-channel-crossing` 으로 포기한다", () => {
    const s = seed();
    settleDeliveryRows({ deliverySeeds: [s], rowChannelNeeds: [need] }, [rowChannel(new Map())], (_id, y) => y);
    expect(s.noPlan).toBe("row-channel-crossing");
    const g = materialize(s);
    expect(g.deliveries.has(s.key)).toBe(false);
    expect(g.skips).toEqual([{ key: s.key, reason: "row-channel-crossing" }]);
  });

  it("행을 받으면 그 행이 출발 행이다(대조군)", () => {
    const s = seed();
    settleDeliveryRows({ deliverySeeds: [s], rowChannelNeeds: [need] }, [rowChannel(new Map([[need.id, 1]]))], (_id, y) => y);
    expect(s.noPlan).toBeUndefined();
    expect(s.fromRowChannel).toEqual({ row: 11 });
    expect(s.startY).toBe(11);
  });
});
