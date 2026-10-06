/**
 * channelGeometryPlanner — 통합 장부(완전 교차 판정 + 해소 사다리) 단위 테스트.
 * 케이스 번호는 docs/auto-layout/channel/channel-geometry-reservation.md 를 따른다.
 */
import { describe, it, expect } from "vitest";
import { planChannelGeometry } from "./geometry";
import {
  conflicts, deliveryEnds, elbowShape, exportCells, exportEnds, fullCrossing, placedOf, staircaseShape, type RouteEnds,
} from "../shape";
import type { DeliveryInput, ExportInput, GeometryContext, NsEdge } from "../types";
import { packModuleTree, deliveryKey } from "../../tree/build";
import type { NodeSpec, PackConfig } from "../../tree/types/pack";
import { routeDeliveryRoutes } from "../../link/build";
import { rePathToPerimeter } from "../../perimeter/late";
import { cellKey } from "../../shared/grid";
import type { IoLine } from "../../module/types/line";

const ctx = { yMin: 0, yMax: 10 };

describe("fullCrossing — 완전 교차 판정(§5-3 · §10.2 정리 3)", () => {
  const exp: ExportInput = { id: "x", entryY: 3, entryWall: "E", preferredExit: "N" };
  const dx = (d: DeliveryInput, x: ExportInput, exit: NsEdge) => fullCrossing(deliveryEnds(d), exportEnds(x, exit), ctx);

  // 반출 × 납품 — 옛 같은 쪽 판정(§4.2)의 네 경우. 답이 같아야 한다(다른 쪽 = 완전 교차).
  it("§4.3 Case A — 두 끝이 반출이 가르는 같은 쪽 → 완전 교차가 아니다", () => {
    expect(dx({ id: "d", startY: 5, endY: 1 }, exp, "N")).toBe(false);
  });

  it("§4.4 Case B — 출발이 반출의 안쪽에 갇힘 → 완전 교차", () => {
    expect(dx({ id: "d", startY: 1, endY: 2 }, exp, "N")).toBe(true);
  });

  it("진출 변을 S 로 뒤집으면 같은 납품이 완전 교차가 아니게 된다 (해소 사다리 ①의 근거)", () => {
    expect(dx({ id: "d", startY: 1, endY: 2 }, exp, "S")).toBe(false);
  });

  it("반출이 W벽 진입이면 안쪽은 W벽 쪽 — 도착 끝이 갇힌다", () => {
    const expW: ExportInput = { id: "x", entryY: 3, entryWall: "W", preferredExit: "N" };
    expect(dx({ id: "d", startY: 1, endY: 2 }, expW, "N")).toBe(true); // endY=2 안쪽
    expect(dx({ id: "d", startY: 1, endY: 5 }, expW, "N")).toBe(false); // 둘 다 바깥
  });

  it("납품 × 납품 — 양 벽에서 끝 순서가 엇갈리면 완전 교차, 순서를 지키면 아니다(§5-2 · §5-3)", () => {
    const dd = (a: DeliveryInput, b: DeliveryInput) => fullCrossing(deliveryEnds(a), deliveryEnds(b), { yMin: 0, yMax: 40 });
    expect(dd({ id: "a", startY: 20, endY: 5 }, { id: "b", startY: 10, endY: 30 })).toBe(true);
    expect(dd({ id: "a", startY: 10, endY: 30 }, { id: "b", startY: 20, endY: 40 })).toBe(false);
  });

  it("출발 행 = 도착 행인 납품은 그 행을 지나는 모든 세로선과 완전 교차다", () => {
    const flat: DeliveryInput = { id: "flat", startY: 5, endY: 5 };
    expect(fullCrossing(deliveryEnds(flat), deliveryEnds({ id: "v", startY: 2, endY: 8 }), ctx)).toBe(true);
    expect(fullCrossing(deliveryEnds(flat), deliveryEnds({ id: "v", startY: 6, endY: 8 }), ctx)).toBe(false);
  });

  it("반출 × 반출 — 같은 벽에서 위 상자는 S 로 · 아래 상자는 N 으로 나가면 완전 교차", () => {
    const up: ExportInput = { id: "u", entryY: 3, entryWall: "E", preferredExit: "S" };
    const down: ExportInput = { id: "w", entryY: 6, entryWall: "E", preferredExit: "N" };
    expect(fullCrossing(exportEnds(up, "S"), exportEnds(down, "N"), ctx)).toBe(true);
    expect(fullCrossing(exportEnds(up, "N"), exportEnds(down, "N"), ctx)).toBe(false); // 하나를 뒤집으면 풀린다
  });

  /**
   * **판정이 도형과 같은 답을 내나** — 실제 도형(`routeShape` · `conflicts`)으로 *"어떤 트랙 쌍으로도 겹친다"* 를 재서
   * 작은 판의 모든 쌍과 비교한다. 이 대조가 판정의 근거다(2026-09-30 전수 — 어긋남 0).
   */
  describe("작은 판 전수 — 판정 = 도형", () => {
    const R = 5;
    const K = 4;
    const board: Pick<GeometryContext, "yMin" | "yMax"> = { yMin: 0, yMax: R };
    const capCol = K + 1;
    type Route = { ends: RouteEnds; shape: (t: number) => ReturnType<typeof staircaseShape>; wallEnds: string[] };
    const routes: Route[] = [];
    // 납품의 끝은 **밴드 밖**(바깥 행 채널의 트랙 행)에도 선다 — 반출의 seat 행 너머까지 넣어 잰다.
    for (let s = -3; s <= R + 3; s++)
      for (let e = -3; e <= R + 3; e++) {
        const d: DeliveryInput = { id: `d${s}${e}`, startY: s, endY: e };
        routes.push({ ends: deliveryEnds(d), shape: (t) => staircaseShape(d, t, board, capCol), wallEnds: [`E${s}`, `W${e}`] });
      }
    for (let y = 0; y <= R; y++)
      for (const w of ["E", "W"] as const)
        for (const exit of ["N", "S"] as const) {
          const x: ExportInput = { id: `x${y}${w}`, entryY: y, entryWall: w, preferredExit: exit };
          routes.push({ ends: exportEnds(x, exit), shape: (t) => elbowShape(x, t, exit, board, capCol), wallEnds: [`${w}${y}`] });
        }
    /** 같은 벽 · 같은 행의 끝을 나눠 쓰는 쌍 — 같은 상자 자리라 입력에서 안 나온다. */
    const sharesEnd = (a: Route, b: Route) => a.wallEnds.some((k) => b.wallEnds.includes(k));
    const mustMeet = (...rs: Route[]): boolean => {
      const shapes = rs.map((r) => Array.from({ length: K }, (_, t) => placedOf(r.shape(t))));
      const pick = (i: number, chosen: number[]): boolean => {
        if (i === rs.length) return true; // 겹침 없이 다 앉았다
        for (let t = 0; t < K; t++)
          if (chosen.every((u, j) => !conflicts(shapes[i][t], shapes[j][u])) && pick(i + 1, [...chosen, t])) return true;
        return false;
      };
      return !pick(0, []);
    };

    it("쌍 — 어떤 트랙으로도 겹치는 쌍과 완전 교차가 같다", () => {
      const wrong: string[] = [];
      let checked = 0;
      let crossing = 0;
      for (let i = 0; i < routes.length; i++)
        for (let j = i + 1; j < routes.length; j++) {
          if (sharesEnd(routes[i], routes[j])) continue;
          checked += 1;
          if (fullCrossing(routes[i].ends, routes[j].ends, board)) crossing += 1;
          if (mustMeet(routes[i], routes[j]) !== fullCrossing(routes[i].ends, routes[j].ends, board))
            wrong.push(`${JSON.stringify(routes[i].ends)} × ${JSON.stringify(routes[j].ends)}`);
        }
      expect(wrong).toEqual([]);
      expect(checked).toBeGreaterThan(10000); // 비어 있는 대조가 아니다
      expect(crossing).toBeGreaterThan(1000);
    });

    it("셋 — 쌍으로 안 엇갈리면 셋도 함께 앉는다(셋이 얽혀야만 막히는 경우가 없다)", () => {
      const small = routes.filter((r) => r.ends.every((e) => e.kind === "edge" || (e.row >= -1 && e.row <= 3)));
      const stuck: string[] = [];
      let checked = 0;
      const clear = (a: Route, b: Route) => !sharesEnd(a, b) && !fullCrossing(a.ends, b.ends, board);
      for (let i = 0; i < small.length; i++)
        for (let j = i + 1; j < small.length; j++) {
          if (!clear(small[i], small[j])) continue;
          for (let k = j + 1; k < small.length; k++) {
            if (!clear(small[i], small[k]) || !clear(small[j], small[k])) continue;
            checked += 1;
            if (mustMeet(small[i], small[j], small[k])) stuck.push(`${i},${j},${k}`);
          }
        }
      expect(stuck).toEqual([]);
      expect(checked).toBeGreaterThan(1000);
    });
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

  describe("§4.4 해소 사다리 ② — 뒤집기가 다른 납품을 가두면 지하 횡단으로", () => {
    // dA 는 N 진출에 갇히고, dB 가 S 뒤집기를 막는다(뒤집으면 dB 가 갇힘).
    const dels: DeliveryInput[] = [
      { id: "dA", startY: 3, endY: 7 },
      { id: "dB", startY: 8, endY: 9 },
    ];
    const exps: ExportInput[] = [{ id: "x", entryY: 5, entryWall: "E", preferredExit: "N" }];
    /** 점프 하나하나가 직선이고 거리가 [2, reach] 안인가. */
    const jumpsOk = (jumps: { fromCol: number; fromRow: number; toCol: number; toRow: number }[], reach: number) => {
      expect(jumps.length).toBeGreaterThanOrEqual(1);
      for (const j of jumps) {
        const sameAxis = j.fromCol === j.toCol || j.fromRow === j.toRow;
        const dist = Math.abs(j.toCol - j.fromCol) + Math.abs(j.toRow - j.fromRow);
        expect(sameAxis, "지하벨트는 직선이다").toBe(true);
        expect(dist).toBeGreaterThanOrEqual(2);
        expect(dist).toBeLessThanOrEqual(reach);
      }
    };

    it("반출과 납품은 동등하다 — 상대 수가 같으면 id 뒤쪽(반출)이 땅속으로", () => {
      // 반출은 바깥으로 가는 납품이다(docs layout-models §3.5 제4조 ②). 2026-10-02 까지는 반출이 땅속으로 못 가 납품이 건넜다.
      const plan = planChannelGeometry(dels, exps, { ...ctx, maxJump: 4 });
      const x = plan.exports.get("x")!;
      expect(x.kind).toBe("undergroundCrossing");
      if (x.kind === "undergroundCrossing") {
        expect(x.exitEdge).toBe("N"); // 뒤집기 기각됨
        jumpsOk(x.jumps, 4);
        // 점프는 반출 자신의 칸 위에 있고, 끝의 피더 · 상자(마지막 두 칸)에는 안 닿는다.
        const cells = exportCells(exps[0], x.track, "N", ctx, 100).map((c) => `${c.col},${c.row}`);
        for (const j of x.jumps) {
          for (const k of [`${j.fromCol},${j.fromRow}`, `${j.toCol},${j.toRow}`]) {
            expect(cells.indexOf(k), k).toBeGreaterThan(0);
            expect(cells.indexOf(k), k).toBeLessThan(cells.length - 2);
          }
        }
      }
      expect(plan.deliveries.get("dA")!.kind).toBe("staircase");
      expect(plan.deliveries.get("dB")!.kind).toBe("staircase");
      expect(plan.exportDives).toBe(1);
    });

    it("반출이 못 들어가면 납품이 건넌다(대조군 — 파이프 반출 · 지하파이프 없음)", () => {
      const plan = planChannelGeometry(dels, [{ ...exps[0], fluid: "water" }], { ...ctx, maxJump: 4, maxJumpPipe: 0 });
      const a = plan.deliveries.get("dA")!;
      expect(a.kind).toBe("undergroundCrossing");
      if (a.kind === "undergroundCrossing") jumpsOk(a.jumps, 4);
      expect(plan.deliveries.get("dB")!.kind).toBe("staircase");
      const x = plan.exports.get("x")!;
      expect(x.kind).toBe("elbow");
      if (x.kind === "elbow") expect(x.exitEdge).toBe("N");
      expect(plan.exportDives).toBe(0);
    });
  });

  describe("반출이 땅속으로 — 상대 수 · 못 건너면 돌아온다", () => {
    // W벽에서 들어와 N 으로 나가는 반출 x 는 세로가 행 5 · 6 · 8 · 9 를 다 지난다 — 납품 dB(5→8) · dC(6→9)와 각각 완전 교차다.
    // dB 와 dC 는 끝 순서가 같아 서로 안 엇갈린다. 그래서 x 의 상대가 둘, 납품은 하나씩이다. S 로 뒤집으면 dD(22→24)를 가두므로
    // 뒤집기(사다리 ①)로는 안 풀린다.
    const dels: DeliveryInput[] = [
      { id: "dB", startY: 5, endY: 8 },
      { id: "dC", startY: 6, endY: 9 },
      { id: "dD", startY: 22, endY: 24 },
    ];
    const exps: ExportInput[] = [{ id: "x", entryY: 20, entryWall: "W", preferredExit: "N" }];
    const wide = { yMin: 0, yMax: 25 };

    it("상대가 많은 반출이 들어간다 — 둘이 한꺼번에 풀린다", () => {
      const plan = planChannelGeometry(dels, exps, { ...wide, maxJump: 5 });
      expect(plan.exports.get("x")!.kind).toBe("undergroundCrossing");
      expect(plan.deliveries.get("dB")!.kind).toBe("staircase");
      expect(plan.deliveries.get("dC")!.kind).toBe("staircase");
      expect(plan.exportDives).toBe(1);
    });

    it("사거리가 모자라면 트랙을 끼워 건넌다 — 두 납품 사이 새 열에서는 한 칸씩 건넌다(계획이 넓힌다)", () => {
      // dB · dC 의 트랙은 붙어 있다. 그 바깥 어느 트랙에서도 x 는 붙은 두 행(5 · 6 또는 8 · 9)을 한 번에 건너야 하는데 사거리 2 로는
      // 못 건넌다. 둘 **사이**에 열을 끼우면 x 는 dB 의 가로 진입(행 5)과 dC 의 가로 진출(행 9)을 따로따로 건넌다.
      const plan = planChannelGeometry(dels, exps, { ...wide, maxJump: 2 });
      expect(plan.exports.get("x")!.kind).toBe("undergroundCrossing");
      expect(plan.widenedTracks).toBe(1);
      expect(plan.deliveries.get("dB")!.kind).toBe("staircase");
      expect(plan.deliveries.get("dC")!.kind).toBe("staircase");
    });

    it("어디에 끼워도 못 건너면 땅 위로 돌아오고 납품이 건넌다 — 다시 배정", () => {
      // 상대 셋의 가로선이 행 2–5 에 빽빽하다 — x 의 세로가 어느 자리에 서도 붙은 두 행 이상을 한 번에 건너야 한다.
      // 납품은 x 의 세로 한 칸씩만 건너면 된다. S 로 뒤집으면 dE 를 가둔다.
      const dense: DeliveryInput[] = [
        { id: "dB", startY: 2, endY: 3 },
        { id: "dC", startY: 3, endY: 4 },
        { id: "dD", startY: 4, endY: 5 },
        { id: "dE", startY: 22, endY: 24 },
      ];
      const plan = planChannelGeometry(dense, exps, { ...wide, maxJump: 2 });
      expect(plan.exports.get("x")!.kind).toBe("elbow");
      for (const id of ["dB", "dC", "dD"]) expect(plan.deliveries.get(id)!.kind).toBe("undergroundCrossing");
      expect(plan.exportDives).toBe(0);
    });

    it("아무도 못 들어가면 오늘처럼 실패 비용 — 반출은 땅 위를 갖고 아이템이 폴백(대조군)", () => {
      const plan = planChannelGeometry(dels, exps, { ...wide, maxJump: 0 });
      expect(plan.exports.get("x")!.kind).toBe("elbow");
      expect(plan.deliveries.get("dB")!.kind).toBe("fallback");
      expect(plan.deliveries.get("dC")!.kind).toBe("fallback");
    });
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

  it("별 모양 — 하나가 셋과 완전 교차하면 상대가 가장 많은 그 하나만 땅속으로(id 가 앞이어도)", () => {
    // dA 는 E벽에서 맨 위 · W벽에서 맨 아래 — dB · dC · dD 와 각각 엇갈린다. 셋끼리는 순서를 지킨다.
    const dels: DeliveryInput[] = [
      { id: "dA", startY: 1, endY: 20 },
      { id: "dB", startY: 2, endY: 5 },
      { id: "dC", startY: 3, endY: 6 },
      { id: "dD", startY: 4, endY: 7 },
    ];
    const plan = planChannelGeometry(dels, [], { yMin: 0, yMax: 25, maxJump: 5 });
    expect(plan.deliveries.get("dA")!.kind).toBe("undergroundCrossing");
    for (const id of ["dB", "dC", "dD"]) expect(plan.deliveries.get(id)!.kind).toBe("staircase");
    expect(plan.crossingYields).toBe(1);
    expect(plan.greedy).toBe(false); // 남은 셋은 탐색이 푼다 — 예전엔 채널 전체가 탐욕으로 갔다
  });

  describe("꺾이는 칸의 지하 입구 · 출구", () => {
    // 지하벨트 · 지하파이프 출구는 제 방향으로만 내놓는다 — 꺾이는 칸의 출구는 끊긴 길이다. 지하파이프는 입구도 꺾인 쪽과
    // 안 이어진다. 지하벨트 입구는 옆에서 받으면 한 레인만 받는데(옆 싣기) 줄 하나는 원래 한 레인이라 그대로 둔다.

    it("출구가 꺾이는 칸에만 서는 트랙뿐이면 트랙을 끼워 다른 자리로 건넌다", () => {
      // 셋(아래에서 위로 가는 납품)의 출발 행 17 · 18 · 19 가 dA 의 도착 행(20) 바로 위다. 셋이 서쪽 트랙을 먼저 받으므로 남은
      // 트랙의 dA 는 셋의 가로 진입을 도착 행 바로 앞까지 건너야 한다 — 출구가 dA 가 꺾이는 칸(트랙 · 행 20)에 서야 해서 못 건넌다.
      // 셋보다 **서쪽**에 열을 끼우면 dA 는 셋의 가로 진출(행 2 · 3 · 4)을 건넌다 — 출구가 곧은 칸(행 5)에 선다.
      const dels: DeliveryInput[] = [
        { id: "dA", startY: 1, endY: 20 },
        { id: "dB", startY: 17, endY: 2 },
        { id: "dC", startY: 18, endY: 3 },
        { id: "dD", startY: 19, endY: 4 },
      ];
      const plan = planChannelGeometry(dels, [], { yMin: 0, yMax: 25, maxJump: 5 });
      const a = plan.deliveries.get("dA")!;
      expect(a.kind).toBe("undergroundCrossing");
      expect(plan.widenedTracks).toBe(1);
      if (a.kind === "undergroundCrossing") for (const j of a.jumps) expect(j.toRow, "출구는 도착 행(꺾이는 칸)이 아니다").not.toBe(20);
      for (const id of ["dB", "dC", "dD"]) expect(plan.deliveries.get(id)!.kind).toBe("staircase");
    });

    it("입구만 꺾이는 칸이면 벨트는 건너고 파이프는 못 건넌다(대조군)", () => {
      // 셋의 출발 행(2 · 3 · 4)이 dA 의 출발 행(1) 바로 아래다 — 지하 입구가 dA 가 꺾이는 칸(트랙 · 행 1)에 서야 한다.
      const dels = (fluid?: string): DeliveryInput[] => [
        { id: "dA", startY: 1, endY: 20, fluid },
        { id: "dB", startY: 2, endY: 5 },
        { id: "dC", startY: 3, endY: 6 },
        { id: "dD", startY: 4, endY: 7 },
      ];
      const belt = planChannelGeometry(dels(), [], { yMin: 0, yMax: 25, maxJump: 5 });
      expect(belt.deliveries.get("dA")!.kind).toBe("undergroundCrossing");
      expect(belt.widenedTracks, "벨트는 꺾이는 칸 입구로 그대로 건넌다").toBe(0);
      // 유체 dA 는 그 자리에선 못 건넌다 — 셋보다 서쪽에 열을 끼워 셋의 가로 진출을 건넌다.
      const pipe = planChannelGeometry(dels("water"), [], { yMin: 0, yMax: 25, maxJump: 5, maxJumpPipe: 10 });
      expect(pipe.deliveries.get("dA")!.kind).toBe("undergroundCrossing");
      expect(pipe.widenedTracks).toBe(1);
    });
  });

  it("반출 × 반출 완전 교차 — 진출 변을 뒤집어 둘 다 땅 위에 남는다", () => {
    // 같은 E벽에서 위 상자는 S 로 · 아래 상자는 N 으로 — 반드시 만난다. 하나를 뒤집으면 풀린다.
    const exps: ExportInput[] = [
      { id: "xa", entryY: 3, entryWall: "E", preferredExit: "S" },
      { id: "xb", entryY: 6, entryWall: "E", preferredExit: "N" },
    ];
    const plan = planChannelGeometry([], exps, ctx);
    const a = plan.exports.get("xa")!;
    const b = plan.exports.get("xb")!;
    expect(a.kind).toBe("elbow");
    expect(b.kind).toBe("elbow");
    if (a.kind === "elbow" && b.kind === "elbow") {
      expect(b.exitEdge).toBe("S"); // id 뒤쪽이 먼저 뒤집힌다
      expect(fullCrossing(exportEnds(exps[0], a.exitEdge), exportEnds(exps[1], b.exitEdge), ctx)).toBe(false);
    }
    expect(plan.crossingYields).toBe(0);
  });

  describe("누가 땅속으로 가나 — 지하파이프를 고른 판(layout-models §3.5 제4조 ③)", () => {
    // 유체 dA 는 E벽 맨 위 · W벽 맨 아래 — 아이템 dB 와 완전 교차다.
    const crossing: DeliveryInput[] = [
      { id: "dA", startY: 1, endY: 20, fluid: "water" },
      { id: "dB", startY: 5, endY: 8 },
    ];
    const wide = { yMin: 0, yMax: 25, maxJump: 5 };

    it("유체 × 아이템 — 상대 수가 같으면 유체가 지하파이프로 건너고 아이템은 땅 위에 남는다", () => {
      const plan = planChannelGeometry(crossing, [], { ...wide, maxJumpPipe: 10 });
      expect(plan.deliveries.get("dA")!.kind).toBe("undergroundCrossing");
      expect(plan.deliveries.get("dB")!.kind).toBe("staircase");
      expect(plan.fluidDives).toBe(1);
    });

    it("유체 × 아이템 — 아이템의 상대가 더 많으면 아이템이 건넌다(매체보다 상대 수가 먼저)", () => {
      // I 는 F · J · K 셋과 엇갈리고 F 는 I 하나와만 엇갈린다. 매체를 먼저 보면 F 가 들어가고 I 는 J · K 와의 만남이 남는다 —
      // 상대가 많은 I 가 들어가면 셋이 한꺼번에 풀린다(docs layout-models §3.5 두점 라우팅 제4조 ③ 벨트 × 파이프).
      const dels: DeliveryInput[] = [
        { id: "I", startY: 10, endY: 30 },
        { id: "F", startY: 20, endY: 5, fluid: "water" },
        { id: "J", startY: 12, endY: 3 },
        { id: "K", startY: 14, endY: 1 },
      ];
      const plan = planChannelGeometry(dels, [], { yMin: 0, yMax: 35, maxJump: 5, maxJumpPipe: 10 });
      expect(plan.deliveries.get("F")!.kind).toBe("staircase");
      expect(plan.fluidDives).toBe(0);
      expect(plan.deliveries.get("I")!.kind).not.toBe("staircase");
    });

    it("지하파이프가 없으면 오늘처럼 — 유체가 땅 위를 갖고 아이템이 건넌다", () => {
      const plan = planChannelGeometry(crossing, [], { ...wide, maxJumpPipe: 0 });
      expect(plan.deliveries.get("dA")!.kind).toBe("staircase");
      expect(plan.deliveries.get("dB")!.kind).toBe("undergroundCrossing");
      expect(plan.fluidDives).toBe(0);
    });

    it("유체 × 반출 — 들어갈 수 있는 쪽이 건넌다: 둘 다면 파이프 · 유체가 못 들어가면 반출 · 아무도 못 들어가면 반출이 물러난다", () => {
      // dB 가 반출의 S 뒤집기를 막는다(뒤집으면 dB 가 갇힌다). 상대 수는 하나씩이다.
      const dels: DeliveryInput[] = [
        { id: "dA", startY: 3, endY: 7, fluid: "water" },
        { id: "dB", startY: 8, endY: 9 },
      ];
      const exps: ExportInput[] = [{ id: "x", entryY: 5, entryWall: "E", preferredExit: "N" }];
      const withPipe = planChannelGeometry(dels, exps, { ...ctx, maxJump: 4, maxJumpPipe: 10 });
      expect(withPipe.deliveries.get("dA")!.kind).toBe("undergroundCrossing");
      const x = withPipe.exports.get("x")!;
      expect(x.kind).toBe("elbow");
      if (x.kind === "elbow") expect(x.exitEdge).toBe("N");
      // 유체가 못 들어가면 반출이 지하벨트로 건넌다 — 2026-10-02 까지는 반출이 유체에 물러났다(상자가 방출에서 트랙을 훑었다).
      const noPipe = planChannelGeometry(dels, exps, { ...ctx, maxJump: 4, maxJumpPipe: 0 });
      expect(noPipe.exports.get("x")!.kind).toBe("undergroundCrossing");
      expect(noPipe.deliveries.get("dA")!.kind).toBe("staircase");
      // 아무도 못 들어가면 실패 비용(P10) — 반출이 땅 위를 잃는다. 모델은 그때 계획이 넓힌다(제4조 ④ — 아직 없다).
      const none = planChannelGeometry(dels, exps, { ...ctx, maxJump: 0, maxJumpPipe: 0 });
      expect(none.exports.get("x")).toEqual({ kind: "fallback", reason: "yielded-to-fluid" });
    });

    it("유체가 못 건너면 땅 위로 돌아오고 상대가 건넌다 — 다시 배정", () => {
      // 아이템 셋의 가로선이 행 2–5 에 빽빽하다 — 유체의 세로가 어느 자리에 서도(트랙을 끼워도) 붙은 두 행 이상을 한 번에 건너야
      // 해서 사거리 2 로는 못 건넌다. 아이템은 유체의 세로 한 칸씩만 건너면 된다.
      const dels: DeliveryInput[] = [
        { id: "dA", startY: 1, endY: 20, fluid: "water" },
        { id: "dB", startY: 2, endY: 3 },
        { id: "dC", startY: 3, endY: 4 },
        { id: "dD", startY: 4, endY: 5 },
      ];
      const short = planChannelGeometry(dels, [], { ...wide, maxJumpPipe: 2 });
      expect(short.deliveries.get("dA")!.kind).toBe("staircase");
      expect(short.fluidDives).toBe(0);
      for (const id of ["dB", "dC", "dD"]) expect(short.deliveries.get(id)!.kind).toBe("undergroundCrossing");
      const long = planChannelGeometry(dels, [], { ...wide, maxJumpPipe: 10 });
      expect(long.deliveries.get("dA")!.kind).toBe("undergroundCrossing");
      expect(long.fluidDives).toBe(1);
    });

    it("다른 유체 × 유체 — 하나가 건너 둘 다 계획된다(예전엔 하나가 거절)", () => {
      // fluid-delivery-reservation §6 잔여 결정의 그 경우 — 둘 다 못 비켜 한쪽이 트리 거절로 갔다.
      const dels: DeliveryInput[] = [
        { id: "dA", startY: 1, endY: 20, fluid: "water" },
        { id: "dB", startY: 5, endY: 12, fluid: "petroleum" },
      ];
      const withPipe = planChannelGeometry(dels, [], { ...wide, maxJumpPipe: 10 });
      expect([withPipe.deliveries.get("dA")!.kind, withPipe.deliveries.get("dB")!.kind].sort()).toEqual([
        "staircase",
        "undergroundCrossing",
      ]);
      // 상대 수 동률이라 id 뒤쪽 dB 가 먼저 들어가 본다 — 그런데 땅 위의 dA 가 트랙 0 에 앉아 W벽 바로 옆 칸(dB 의 도착
      // 칸)이 dA 의 둘레다. dB 는 못 건너고, 다시 돌 때 **무리 안에서도** 들어갈 수 있는 dA 가 내준다.
      expect(withPipe.deliveries.get("dA")!.kind).toBe("undergroundCrossing");
      expect(withPipe.fluidDives).toBe(1);
      const noPipe = planChannelGeometry(dels, [], { ...wide, maxJumpPipe: 0 });
      expect([...noPipe.deliveries.values()].map((p) => p.kind)).toContain("fallback");
    });
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

  it("넓혀도 계획끼리 안 겹친다 — 끼운 트랙이 쌓인 경로 · 점프를 함께 옮긴다(작은 판 난수 전수)", () => {
    // 계획을 칸으로 되펴서(땅속 칸 제외) 서로 안 겹치나 · 점프가 사거리 안인가를 본다. 칸은 실제 열(-1 … 폭)만 센다 — E벽 너머는
    // 가상 열이다.
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
    let widened = 0;
    for (let round = 0; round < 300; round++) {
      const n = 4 + rnd(3);
      const used = new Set<string>();
      const dels: DeliveryInput[] = [];
      for (let i = 0; i < n; i++) {
        let sy = 0, ey = 0;
        do { sy = 1 + rnd(14); ey = 1 + rnd(14); } while (sy === ey || used.has(`s${sy}`) || used.has(`e${ey}`));
        used.add(`s${sy}`); used.add(`e${ey}`);
        dels.push({ id: `d${i}`, startY: sy, endY: ey });
      }
      const reach = 3;
      const plan = planChannelGeometry(dels, [], { yMin: 0, yMax: 15, maxJump: reach });
      widened += plan.widenedTracks;
      const T = plan.trackCount;
      const cellsOfPlan = (d: DeliveryInput): Set<string> | null => {
        const g = plan.deliveries.get(d.id)!;
        if (g.kind !== "staircase" && g.kind !== "undergroundCrossing") return null;
        const t = g.track;
        const seq: [number, number][] = [];
        for (let c = T; c >= t; c--) seq.push([c, d.startY]);
        const step = d.endY >= d.startY ? 1 : -1;
        for (let r = d.startY + step; r !== d.endY + step; r += step) seq.push([t, r]);
        for (let c = t - 1; c >= -1; c--) seq.push([c, d.endY]);
        const under = new Set<string>();
        if (g.kind === "undergroundCrossing")
          for (const j of g.jumps) {
            expect(Math.abs(j.toCol - j.fromCol) + Math.abs(j.toRow - j.fromRow), "사거리").toBeLessThanOrEqual(reach);
            const dc = Math.sign(j.toCol - j.fromCol), dr = Math.sign(j.toRow - j.fromRow);
            for (let c = j.fromCol + dc, r = j.fromRow + dr; c !== j.toCol || r !== j.toRow; c += dc, r += dr) under.add(`${c},${r}`);
          }
        return new Set(seq.map(([c, r]) => `${c},${r}`).filter((k) => !under.has(k)));
      };
      const sets = dels.map(cellsOfPlan);
      for (let i = 0; i < sets.length; i++)
        for (let j = i + 1; j < sets.length; j++) {
          const a = sets[i], b = sets[j];
          if (!a || !b) continue;
          const hit = [...a].find((k) => b.has(k));
          expect(hit, `${JSON.stringify(dels)} ${dels[i].id}×${dels[j].id}`).toBeUndefined();
        }
    }
    expect(widened, "넓히기가 실제로 돌았다").toBeGreaterThan(0);
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
  reservePerimeterExits: true,
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
    const withoutPack = packModuleTree(specs, { ...config, reservePerimeterExits: false });
    const withoutDelivery = routeDeliveryRoutes(withoutPack, { beltEntityName: "transport-belt" });
    const withoutRes = rePathToPerimeter(withoutPack, withoutDelivery.strippedChestIds, withoutDelivery.cells, {
      beltEntityName: "transport-belt",
      inserterEntityName: "inserter",
    });
    expect(withRes.skipped).toBeLessThanOrEqual(withoutRes.skipped);
  });
});
