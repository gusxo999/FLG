/**
 * **지하 횡단** — 막힌 칸을 땅속으로 비켜 간다(`AUTO_LAYOUT_LINK_DIVE`). 규칙은 `docs/auto-layout/module/trunk-blocked.md` §1 · §4.
 *
 * ```
 * 도착한 줄     구간 안의 못(남의 포트) 밑으로 지하 횡단한다 — 자르지 않는다
 * 먼저 앉은 줄  도착한 줄의 포트 칸이 자기 벨트(인서터가 안 닿는 행) 위면 그 행을 땅속으로 내준다
 * ```
 *
 * 잠그는 것: **끄면 오늘 그대로다**(같은 입력에서 못 앉는다) · 켜면 실제로 앉고 지하벨트가 놓인다 ·
 * 비켜 준 줄의 자리(면 · 깊이 · 인서터 · 포트)는 안 바뀐다 · 조건(T2 · T3)이 서지 않으면 지하 횡단하지 않는다.
 */
import { afterEach, describe, it, expect } from "vitest";
import { tryLinkFace } from "./link";
import { openFaceSeating } from "./seat";
import { cellAt, claimDepth } from "../ledger/face";
import { commitLinkFace, fitOnGap, openLinkFaceContext, seatTableOf } from "../ledger/seat";
import { tunnelBodies, tunnelFault } from "../arith/dive";
import { setAutoLayoutLinkDive } from "../../shared/flags";
import { generateModule as generateSeated } from "../build";
import { seatedAlone } from "../../link/testSeat";
import { EntityType } from "../../../types/layout";
import type { Link } from "../types/line";
import type { ModuleInput } from "../types/module";

// 기본값은 켜짐이다(2026-09-24 사용자) — 시험마다 기본으로 되돌리고, 대조군은 스스로 끈다
afterEach(() => setAutoLayoutLinkDive(true));

const UG = { entityName: "underground-belt", throughput: 15, maxDistance: 5 };
const M = { entityName: "assembling-machine-3", w: 3, h: 3 };
const base: ModuleInput = {
  machine: M, count: 3, inserterEntityName: "inserter",
  lines: [{ name: "gear", kind: "belt", role: "output" }],
  inserters: [
    { entityName: "inserter", reach: 1, throughput: 2.4 },
    { entityName: "long-handed-inserter", reach: 2, throughput: 1.2 },
  ],
  beltEntityName: "transport-belt",
  belts: [{ entityName: "transport-belt", throughput: 15 }],
  undergroundBelts: [UG],
};
/** 싣는 줄 — 머신마다 팔 하나(운반량이 팔 하나 안에 든다). */
const out = (id: string, machines: number[]): Link => ({
  id, item: "gear",
  from: new Map(machines.map((m) => [m, 1])), to: new Map([[0, 1]]),
  carries: machines.map((m) => ({ from: m, to: 0, rate: 0.5 })),
});

describe("셈 — 몸통", () => {
  it("붙은 행은 한 몸통, 사이가 한 행이면 입출구가 겹쳐 합친다, 두 행이면 따로", () => {
    expect(tunnelBodies([3, 4])).toEqual([[3, 4]]);
    expect(tunnelBodies([3, 5])).toEqual([[3, 5]]);
    expect(tunnelBodies([3, 6])).toEqual([[3, 3], [6, 6]]);
  });
  it("T2 인서터 행 · T3 입출구가 고정 행이거나 구간 밖 · 사거리", () => {
    const len = (e: number, x: number) => x - e;
    expect(tunnelFault([[3, 3]], [0, 6], new Set([3]), new Set(), len, 5)).toBe("seat");
    expect(tunnelFault([[1, 1]], [0, 6], new Set(), new Set([0]), len, 5)).toBe("end");
    expect(tunnelFault([[6, 6]], [0, 6], new Set(), new Set(), len, 5)).toBe("end");
    expect(tunnelFault([[2, 6]], [0, 8], new Set(), new Set(), len, 5)).toBe("range");
    expect(tunnelFault([[3, 3]], [0, 6], new Set(), new Set([0]), len, 5)).toBeUndefined();
  });
});

/**
 * **도착한 줄의 지하 횡단** — 짧은 줄 둘(머신 1 · 2)이 d2 에 앉아 옆 포트 인서터로 d3 에 못을 박는다. 관통 줄은 d2 가 그 벨트에
 * 막혀 d3 으로 가는데, d3 에는 못이 둘이다. 자르지 않고(`LINK_LADDER` 꺼짐) 못 밑으로 두 번 지하 횡단해 앉는다.
 */
describe("도착한 줄 — 못 밑으로 두 번 지하 횡단한다", () => {
  const seatSpanning = () => {
    const desk = openFaceSeating(base, 3);
    for (const g of [out("c→p:a1#0", [1]), out("c→p:a2#0", [2])]) desk.take(desk.ask(g, "from", "near").offer!, "from");
    return desk.ask(out("c→p:b#0", [0, 1, 2]), "from", "near");
  };

  it("대조군 — 끄면 d3 의 못에 막혀 못 앉는다(구간막힘)", () => {
    setAutoLayoutLinkDive(false);
    const a = seatSpanning();
    expect(a.offer).toBeUndefined();
    expect(a.why.some((w) => w.clusterBeltDepth === 3 && w.blockedRows?.includes(3) && w.blockedRows?.includes(6))).toBe(true);
  });

  it("켜면 d3 에 앉고 몸통이 행 3 · 6 이다 — 입출구는 2·4 · 5·7", () => {
    setAutoLayoutLinkDive(true);
    const a = seatSpanning();
    expect(a.offer?.clusterBeltDepth).toBe(3);
    expect(a.offer?.tunnels).toEqual([[3, 3], [6, 6]]);
    expect(a.offer?.dive?.entityName).toBe("underground-belt");
  });

  it("켜면 방출에 지하벨트 넷(입구 둘 · 출구 둘)이 d3 열에 서고, 몸통 칸에는 못(포트 인서터)이 선다", () => {
    setAutoLayoutLinkDive(true);
    const input: ModuleInput = {
      ...base, outputLinks: [out("c→p:a1#0", [1]), out("c→p:a2#0", [2]), out("c→p:b#0", [0, 1, 2])],
    };
    const mod = generateSeated(seatedAlone(input));
    expect(mod.unroutedLines).toEqual([]);
    const x0 = Math.min(...mod.machines.map((m) => m.origin.x));
    const ugs = mod.cells.filter((c) => c.cell.entityType === EntityType.UndergroundBelt);
    expect(ugs.map((c) => [c.x - x0, c.cell.undergroundType]).sort()).toEqual(
      [[-3, "input"], [-3, "input"], [-3, "output"], [-3, "output"]].sort(),
    );
    // 흐름은 N(관통의 끝이 N) — 입구가 아래, 출구가 위
    const at = (t: number) => ugs.find((c) => c.y - mod.machines[0].origin.y === t)?.cell.undergroundType;
    expect([at(7), at(5), at(4), at(2)]).toEqual(["input", "output", "input", "output"]);
    // 몸통 칸(행 3 · 6, d3)에는 짧은 줄의 포트 인서터가 서 있다 — 그 밑을 관통이 지난다
    for (const t of [3, 6]) {
      const c = mod.cells.find((p) => p.x - x0 === -3 && p.y - mod.machines[0].origin.y === t);
      expect(c?.cell.entityType).toBe(EntityType.Inserter);
    }
    // 겹친 칸이 없다
    const keys = mod.cells.map((c) => `${c.x},${c.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * **먼저 앉은 줄의 지하 횡단** — 관통 줄이 d3 에 먼저 앉아 있다(d2 는 남의 벨트가 막았다). 짧은 줄이 d2 에 앉으면 옆 포트
 * 인서터가 d3 — 관통 벨트 위 — 에 선다. 그 행은 관통의 인서터 행이 아니므로 관통이 그 행을 땅속으로 내준다.
 */
describe("먼저 앉은 줄 — 옆 포트에게 그 행을 땅속으로 내준다", () => {
  const scene = () => {
    const ctx = openLinkFaceContext(base, 3, new Map());
    const t = seatTableOf(ctx, "W");
    claimDepth(t, 2, 1, 1, 99, "belt"); // d2 의 행 1 에 남의 벨트 — 관통이 d3 으로 간다
    const b = tryLinkFace(ctx, out("c→p:b#0", [0, 1, 2]), "from", "W")!;
    const bPlan = commitLinkFace(ctx, b, "from");
    return { ctx, t, bPlan, a: () => tryLinkFace(ctx, out("c→p:a#0", [1]), "from", "W") };
  };

  it("대조군 — 끄면 짧은 줄의 포트가 관통 벨트에 막혀 못 앉는다", () => {
    setAutoLayoutLinkDive(false);
    const { bPlan, a } = scene();
    expect(bPlan.clusterBeltDepth).toBe(3);
    expect(a()).toBeUndefined();
  });

  it("켜면 짧은 줄이 d2 에 앉고, 관통이 행 4 를 내준다 — 관통의 면 · 깊이 · 인서터 · 끝은 그대로", () => {
    setAutoLayoutLinkDive(true);
    const { ctx, t, bPlan, a } = scene();
    const cand = a()!;
    expect(cand.clusterBeltDepth).toBe(2);
    expect([...cand.slotIndex]).toEqual([[1, [1]]]); // 머신 1 의 칸 1 = 행 4
    expect([...(cand.yields ?? [])]).toEqual([[bPlan.owner, [[4, 4]]]]);
    commitLinkFace(ctx, cand, "from");
    // 행 4 의 d3 에는 짧은 줄의 포트 인서터가, 3 · 5 는 관통의 입출구(단단한 칸)다
    expect(cellAt(t, 4, 3)?.kind).toBe("port");
    expect(cellAt(t, 3, 3)).toEqual({ owner: bPlan.owner, kind: "belt" });
    expect(cellAt(t, 5, 3)).toEqual({ owner: bPlan.owner, kind: "belt" });
    expect(t.dives.get(bPlan.owner!)?.bodies).toEqual([[4, 4]]);
    // 영수증은 안 바뀐다 — 관통의 계획 객체는 그대로(몸통은 장부에만)
    expect(bPlan.tunnels).toBeUndefined();
    expect([...bPlan.slotIndex]).toEqual([[0, [0]], [1, [0]], [2, [0]]]);
  });
});

/** **gap 이 터널을 깨면 그 gap 을 안 연다** — 머신 경계를 건너는 몸통은 그 gap 폭만큼 물리적으로 길다. */
describe("gap 과 터널 — 경계를 건너는 몸통", () => {
  it("터널이 경계 0 을 건너고 여유가 한 칸이면, gap 0 을 여는 gap 줄은 거절된다 · 경계 밖 gap 은 그대로 연다", () => {
    const ctx = openLinkFaceContext(base, 3, new Map());
    const w = seatTableOf(ctx, "W");
    // 몸통 [2, 3](머신 0 의 칸 2 ~ 머신 1 의 칸 0) — 입구 1 · 출구 4, 표 길이 3, 사거리 4 → 여유 1
    w.dives.set(7, {
      depth: 3, span: [0, 8], seatRows: [0], fixedRows: [0], entityName: "u", maxDistance: 4, bodies: [[2, 3]],
    });
    const gapLine = (mi: number): Link => ({ id: `g${mi}`, item: "gear", from: new Map([[mi, 1]]), to: new Map([[0, 1]]) });
    expect(fitOnGap(ctx, gapLine(0), "from", "S", new Map([[0, 1]]))).toBeUndefined(); // gap 0 폭 2 → 길이 5
    expect(fitOnGap(ctx, gapLine(1), "from", "S", new Map([[1, 1]]))).toBeDefined(); // gap 1 은 안 건넌다
  });
});
