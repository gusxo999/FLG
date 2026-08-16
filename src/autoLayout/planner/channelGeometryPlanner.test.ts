/**
 * channelGeometryPlanner — 통합 장부(같은 쪽 판정 + 해소 사다리) 단위 테스트.
 * 케이스 번호는 docs/auto-layout-wizard.channel-geometry-reservation.md 를 따른다.
 */
import { describe, it, expect } from "vitest";
import {
  planChannelGeometry,
  sameSideOfCut,
  type DeliveryInput,
  type ExportInput,
} from "./channelGeometryPlanner";
import { packModuleTree, deliveryKey, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeDeliveryRoutes } from "./deliveryRoute";
import { rePathToPerimeter } from "../execution/modulePerimeterPass";
import { cellKey } from "../util/helper";
import type { IoLine } from "./module/clusterPortPlanner";

const ctx = { yMin: 0, yMax: 10 };

describe("sameSideOfCut — §4.2 판정", () => {
  const exp: ExportInput = { id: "x", entryY: 3, entryWall: "E", preferredExit: "N" };

  it("§4.3 Case A — 두 끝 다 바깥쪽 ② → 같은 쪽", () => {
    expect(sameSideOfCut({ id: "d", startY: 5, endY: 1 }, exp, "N")).toBe(true);
  });

  it("§4.4 Case B — 출발이 안쪽 ①에 갇힘 → 다른 쪽", () => {
    expect(sameSideOfCut({ id: "d", startY: 1, endY: 2 }, exp, "N")).toBe(false);
  });

  it("진출 변을 S 로 뒤집으면 같은 케이스가 같은 쪽이 된다 (해소 사다리 ①의 근거)", () => {
    expect(sameSideOfCut({ id: "d", startY: 1, endY: 2 }, exp, "S")).toBe(true);
  });

  it("반출이 W벽 진입이면 안쪽 ①은 W벽 쪽 — 도착 끝이 갇힌다", () => {
    const expW: ExportInput = { id: "x", entryY: 3, entryWall: "W", preferredExit: "N" };
    expect(sameSideOfCut({ id: "d", startY: 1, endY: 2 }, expW, "N")).toBe(false); // endY=2 안쪽
    expect(sameSideOfCut({ id: "d", startY: 1, endY: 5 }, expW, "N")).toBe(true); // 둘 다 바깥
  });
});

describe("planChannelGeometry — 지상 배정", () => {
  it("§4.3 Case A — 같은 쪽: 납품이 반출 서쪽 트랙으로 지상 해결", () => {
    const dels: DeliveryInput[] = [{ id: "d", startY: 5, endY: 1 }];
    const exps: ExportInput[] = [{ id: "x", entryY: 3, entryWall: "E", preferredExit: "N" }];
    const plan = planChannelGeometry(dels, exps, ctx);
    const d = plan.deliveries.get("d")!;
    const x = plan.exports.get("x")!;
    expect(d.kind).toBe("staircase");
    expect(x.kind).toBe("elbow");
    if (d.kind === "staircase" && x.kind === "elbow") {
      expect(d.track).toBeLessThan(x.track); // 문서 그림: 납품 x1, 반출 x2
      expect(x.exitEdge).toBe("N");
    }
    expect(plan.trackCount).toBe(2);
  });

  it("§4.4 해소 사다리 ① — 다른 쪽이면 반출 진출 변을 뒤집어 지상 유지", () => {
    const dels: DeliveryInput[] = [{ id: "d", startY: 1, endY: 2 }];
    const exps: ExportInput[] = [{ id: "x", entryY: 3, entryWall: "E", preferredExit: "N" }];
    const plan = planChannelGeometry(dels, exps, ctx);
    expect(plan.deliveries.get("d")!.kind).toBe("staircase");
    const x = plan.exports.get("x")!;
    expect(x.kind).toBe("elbow");
    if (x.kind === "elbow") expect(x.exitEdge).toBe("S"); // N → S 뒤집힘
  });

  it("§4.4 해소 사다리 ② — 뒤집기가 다른 납품을 가두면 지하 횡단으로", () => {
    // dA 는 N 진출에 갇히고, dB 가 S 뒤집기를 막는다(뒤집으면 dB 가 갇힘).
    const dels: DeliveryInput[] = [
      { id: "dA", startY: 3, endY: 7 },
      { id: "dB", startY: 8, endY: 9 },
    ];
    const exps: ExportInput[] = [{ id: "x", entryY: 5, entryWall: "E", preferredExit: "N" }];
    const plan = planChannelGeometry(dels, exps, { ...ctx, maxJump: 4 });
    const a = plan.deliveries.get("dA")!;
    expect(a.kind).toBe("undergroundCrossing");
    if (a.kind === "undergroundCrossing") {
      // 반출이 그은 절단선을 지하로 건넌다 — 점프 하나, 입구·출구는 축이 같고 거리 ≥ 2.
      expect(a.jumps.length).toBeGreaterThanOrEqual(1);
      for (const j of a.jumps) {
        const sameAxis = j.fromCol === j.toCol || j.fromRow === j.toRow;
        const dist = Math.abs(j.toCol - j.fromCol) + Math.abs(j.toRow - j.fromRow);
        expect(sameAxis, "지하벨트는 직선이다").toBe(true);
        expect(dist).toBeGreaterThanOrEqual(2);
        expect(dist).toBeLessThanOrEqual(4);
      }
    }
    expect(plan.deliveries.get("dB")!.kind).toBe("staircase");
    const x = plan.exports.get("x")!;
    if (x.kind === "elbow") expect(x.exitEdge).toBe("N"); // 뒤집기 기각됨
  });

  it("§5-3 완전 교차(끝 순서 엇갈림) — 지상 해법 없음 → fallback 마킹(감지·로그)", () => {
    // E벽 순서 dB(10) 위 dA(20), W벽 순서 dA(5) 위 dB(30) — 순서 스왑 = 반드시 교차.
    const dels: DeliveryInput[] = [
      { id: "dA", startY: 20, endY: 5 },
      { id: "dB", startY: 10, endY: 30 },
    ];
    const plan = planChannelGeometry(dels, [], { yMin: 0, yMax: 40 });
    const kinds = [plan.deliveries.get("dA")!.kind, plan.deliveries.get("dB")!.kind].sort();
    expect(kinds).toContain("fallback"); // 한쪽은 dijkstra 로
    // fallback 경로도 폭은 예약된다(phantom) — 자리 소멸로 인한 모듈 폴백 방지.
    expect(plan.trackCount).toBeGreaterThanOrEqual(2);
  });

  it("출발 행 = 도착 행 — 일자 수평선(트랙 소비 0)", () => {
    const plan = planChannelGeometry([{ id: "d", startY: 4, endY: 4 }], [], ctx);
    expect(plan.deliveries.get("d")!.kind).toBe("straight");
    expect(plan.trackCount).toBe(0);
  });

  it("폭 역전 — 겹치는 납품이 늘면 trackCount 가 배정 결과에서 자란다", () => {
    // 양 벽 순서 보존(교차 없음) + 세로 구간 상호 겹침 → 트랙 3개 필요.
    const dels: DeliveryInput[] = [
      { id: "d1", startY: 1, endY: 4 },
      { id: "d2", startY: 2, endY: 5 },
      { id: "d3", startY: 3, endY: 6 },
    ];
    const plan = planChannelGeometry(dels, [], ctx);
    for (const d of dels) expect(plan.deliveries.get(d.id)!.kind).not.toBe("fallback");
    expect(plan.trackCount).toBe(3);
  });

  it("결정성 — 같은 입력이면 같은 배정 (§9 불변식 c)", () => {
    const dels: DeliveryInput[] = [
      { id: "d1", startY: 5, endY: 1 },
      { id: "d2", startY: 2, endY: 8 },
    ];
    const exps: ExportInput[] = [{ id: "x", entryY: 6, entryWall: "W", preferredExit: "S" }];
    const a = planChannelGeometry(dels, exps, ctx);
    const b = planChannelGeometry(dels, exps, ctx);
    expect(JSON.stringify([...a.deliveries], null, 0)).toEqual(JSON.stringify([...b.deliveries], null, 0));
    expect(JSON.stringify([...a.exports])).toEqual(JSON.stringify([...b.exports]));
    expect(a.trackCount).toBe(b.trackCount);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 파이프라인 통합 불변식 — §9 (a) 셀 서로소, (b) 판정-일치, (c) 결정성
// ─────────────────────────────────────────────────────────────────────────────

const inL = (name: string, amount: number): IoLine => ({ name, kind: "belt", role: "input", amount });
const outL = (name: string, amount: number): IoLine => ({ name, kind: "belt", role: "output", amount });
const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

const config: PackConfig = {
  inserterEntityName: "inserter",
  inserters: [{ entityName: "i", reach: 1, throughput: 0 }, { entityName: "long-handed-inserter", reach: 2, throughput: 0 }],
  beltEntityName: "transport-belt",
  reservePerimeterLanes: true,
  channelGeometry: true,
};

// advanced-circuit 실측 트리와 동형.
const specs: NodeSpec[] = [
  {
    id: "n0-advanced-circuit", depth: 0, machine: M, count: 1,
    lines: [
      inL("copper-cable", 4),
      inL("electronic-circuit", 2),
      inL("kr-electronic-components", 2),
      outL("advanced-circuit", 1),
    ],
  },
  {
    id: "n1-kr-electronic-components", depth: 1, parentId: "n0-advanced-circuit", machine: M, count: 1,
    lines: [inL("plastic-bar", 4), inL("kr-silicon", 2), inL("kr-glass", 2), outL("kr-electronic-components", 4)],
  },
  {
    id: "n2-electronic-circuit", depth: 1, parentId: "n0-advanced-circuit", machine: M, count: 1,
    lines: [inL("copper-cable", 3), inL("stone-tablet", 1), outL("electronic-circuit", 2)],
  },
];

function runPipeline() {
  const pack = packModuleTree(specs, config);
  const delivery = routeDeliveryRoutes(pack, { beltEntityName: "transport-belt" });
  const res = rePathToPerimeter(pack, delivery.strippedChestIds, delivery.cells, {
    beltEntityName: "transport-belt",
    inserterEntityName: "inserter",
  });
  return { pack, delivery, res };
}

describe("채널 기하 예약 — 파이프라인 불변식(§9)", () => {
  it("(a) 셀 서로소 — 납품 경로 belt 는 모듈 셀(strip 제외)·다른 납품 경로와 겹치지 않는다", () => {
    const { pack, delivery } = runPipeline();
    const occ = new Set<string>();
    for (const pl of pack.placements) {
      for (const m of pl.module.machines)
        for (let dx = 0; dx < m.size.w; dx++)
          for (let dy = 0; dy < m.size.h; dy++) occ.add(cellKey(m.origin.x + dx, m.origin.y + dy));
      for (const c of pl.module.cells) {
        if (delivery.strippedCellKeys.has(cellKey(c.x, c.y))) continue;
        occ.add(cellKey(c.x, c.y));
      }
    }
    for (const c of delivery.cells) {
      const k = cellKey(c.x, c.y);
      expect(occ.has(k), `납품 경로 셀 ${k} 가 다른 점유와 겹침`).toBe(false);
      occ.add(k);
    }
  });

  it("(b) 판정-일치 — 계획된 납품 경로(지상)은 corridor 없이, 납품 경로 실패 0", () => {
    const { pack, delivery } = runPipeline();
    expect(delivery.failures).toBe(0);
    expect(pack.channelGeometry).toBeDefined();
    for (const [i, deliverySpec] of pack.deliveries.entries()) {
      const g = pack.channelGeometry!.deliveries.get(deliveryKey(deliverySpec));
      if (g && g.kind !== "undergroundCrossing") {
        expect(delivery.routes[i].corridors).toHaveLength(0); // 지상 계획 = 지상 방출
      }
    }
  });

  it("(c) 결정성 — 두 번 실행해도 같은 결과", () => {
    const summarize = () => {
      const { pack, delivery, res } = runPipeline();
      return JSON.stringify({
        cells: delivery.cells.map((c) => [c.x, c.y]),
        relocated: res.relocated,
        skipped: res.skipped,
        bbox: pack.bbox,
      });
    };
    expect(summarize()).toEqual(summarize());
  });

  // **대조군으로 잰다**(2026-08-17). 옛 답은 `skipped <= 2` 였는데, 그 `2` 는 *"당시 옛 경로의
  // 실측값"* 을 상수로 박은 것이라 **모델이 바뀌면 비교 대상 없이 깨진다.** 이 테스트가 묻고
  // 싶은 것은 절대 수가 아니라 *"예약이 반출을 나쁘게 만들지 않는다"* 이므로, 같은 트리를
  // 예약 켜고/끄고 돌려 **둘을 비교**한다 — 그러면 배치 모델이 바뀌어도 뜻이 그대로 남는다.
  it("반출 예약 재생 — 예약을 켜도 skip 이 끈 것보다 늘지 않는다", () => {
    const withRes = runPipeline().res;
    const withoutPack = packModuleTree(specs, { ...config, reservePerimeterLanes: false, channelGeometry: false });
    const withoutDelivery = routeDeliveryRoutes(withoutPack, { beltEntityName: "transport-belt" });
    const withoutRes = rePathToPerimeter(withoutPack, withoutDelivery.strippedChestIds, withoutDelivery.cells, {
      beltEntityName: "transport-belt",
      inserterEntityName: "inserter",
    });
    expect(withRes.skipped).toBeLessThanOrEqual(withoutRes.skipped);
  });
});
