/**
 * **gap 출구의 교차** — `docs/auto-layout/module/trunk-blocked.md` §4.2(work-kinds §7 D8 을 닫았다).
 *
 * gap 벨트는 기둥의 옆 변(싣는 쪽 W · 집는 쪽 E)으로 나가 포트가 된다. 그 변을 여러 머신을 맡은 옆면 줄이 gap 행까지
 * 지나며 달린다 — 면 좌석표에 gap 행이 없어 아무 장부도 몰랐고, 방출 안전망이 gap 줄을 버렸다. 이제:
 *
 * ```
 * 셈     확정 배정에서 옆면이 gap 행을 지나는 깊이를 유도한다(앉는 순서와 무관)       arith/face.sideCrossingsFromPlans
 * 자격   진짜 gap 의 출구는 건널 수 있는 상한까지 닿는 지하벨트가 있어야 앉는다       policy/link.tryLinkFace ③′
 * 도형   건너는 것이 있으면 옆면 d1 에서 땅속으로 들어가 그 바깥에서 나온다           shape/body.gapExitDive
 * 기둥 끝 출구 행이 기둥 밖이면 포트 두 칸을 기둥 밖 칸 장부에 올린다               ledger/seat.fitOnGap
 * ```
 *
 * 잠그는 것: 건너는 것이 없으면 도형은 오늘 그대로다 · 건너면 지하벨트 둘이 놓이고 겹침이 없다 · 지하벨트가 없으면 진짜 gap
 * 출구를 거절하고 사유를 남긴다 · 기둥 끝은 지하벨트 없이도 앉는다 · 먼저 앉은 기둥 끝 포트의 칸이면 거절한다.
 */
import { describe, it, expect } from "vitest";
import { rungOfLine, tryLinkFace } from "./link";
import { openLinkFaceContext } from "../ledger/seat";
import { sideCrossBound, sideCrossingsFromPlans } from "../arith/face";
import { gapExitDive } from "../shape/body";
import { generateModule as generateSeated } from "../build";
import { seatedAlone } from "../../link/testSeat";
import { EntityType } from "../../../types/layout";
import { AUTO_LAYOUT_LANE_MERGE, setAutoLayoutLaneMerge } from "../../shared/flags";
import type { Link } from "../types/line";
import type { ModuleInput } from "../types/module";
import type { DepthShortage, LinkFacePlan } from "../types/seat";

/** 레인 합류를 잠깐 켜거나 끄고 돌린다 — 끝나면 원래 값으로 되돌린다. */
function withLaneMerge<T>(on: boolean, run: () => T): T {
  const was = AUTO_LAYOUT_LANE_MERGE;
  setAutoLayoutLaneMerge(on);
  try {
    return run();
  } finally {
    setAutoLayoutLaneMerge(was);
  }
}

const UG = { entityName: "underground-belt", throughput: 15, maxDistance: 5 };
const M = { entityName: "assembling-machine-3", w: 3, h: 3 };
const INSERTERS = [
  { entityName: "inserter", reach: 1, throughput: 2.4 },
  { entityName: "long-handed-inserter", reach: 2, throughput: 1.2 },
];
const base: ModuleInput = {
  machine: M, count: 2, inserterEntityName: "inserter",
  lines: [{ name: "gear", kind: "belt", role: "output" }],
  inserters: INSERTERS,
  beltEntityName: "transport-belt",
  belts: [{ entityName: "transport-belt", throughput: 15 }],
  undergroundBelts: [UG],
};
/** 줄 하나 — 머신마다 팔 `arms` 개(팔 하나에 2/s — reach 1 팔 2.4/s 안). 상대 쪽은 머신 0 하나다. */
const line = (id: string, item: string, side: "from" | "to", machines: Record<number, number>): Link => {
  const mine = new Map(Object.entries(machines).map(([m, k]) => [Number(m), k] as const));
  const other = new Map([[0, 1]]);
  return {
    id, item,
    from: side === "from" ? mine : other,
    to: side === "to" ? mine : other,
    carries: [...mine].map(([m, k]) => (side === "from" ? { from: m, to: 0, rate: 2 * k } : { from: 0, to: m, rate: 2 * k })),
  };
};
/** 옆면 계획 하나(표의 행 축). */
const plan = (face: "W" | "E", slots: Array<[number, number[]]>, depth: number, extra: Partial<LinkFacePlan> = {}): LinkFacePlan => ({
  face, clusterBeltDepth: depth, reach: depth - 1,
  arms: new Map(slots.map(([m, s]) => [m, s.length])), slotIndex: new Map(slots), ...extra,
});

describe("셈 — 옆면이 gap 행을 지나는 깊이(확정 배정에서)", () => {
  const cross = (plans: LinkFacePlan[], role: "output" | "input" = "output") =>
    sideCrossingsFromPlans(3, 2, [{ role, plans }]);

  it("머신 0 과 1 을 잇는 줄은 gap 0 을 그 깊이로 지난다 · 한 머신 안의 줄은 안 지난다", () => {
    expect([...cross([plan("W", [[0, [1]], [1, [1]]], 2)])]).toEqual([["W:0", 2]]);
    expect([...cross([plan("W", [[0, [0, 1, 2]]], 3)])]).toEqual([]);
  });

  it("몸통이 경계를 건너면 gap 행은 땅속이라 안 센다", () => {
    // 행 2(머신 0 끝) · 3(머신 1 첫) 이 몸통 — 입출구 1 · 4 는 이웃하지 않는다
    expect([...cross([plan("W", [[0, [0]], [1, [2]]], 3, { tunnels: [[2, 3]] })])]).toEqual([]);
  });

  it("면마다 따로 · 가장 깊은 것 하나 · 벨트를 공유한 줄은 자기 칸이 없다", () => {
    const got = cross([
      plan("W", [[0, [2]], [1, [0]]], 2),
      plan("W", [[0, [1]], [1, [1]]], 3),
      plan("E", [[0, [2]], [1, [0]]], 2),
      plan("E", [[0, [0]], [1, [2]]], 3, { sharesBelt: true }),
    ]);
    expect(Object.fromEntries(got)).toEqual({ "W:0": 3, "E:0": 2 });
  });

  it("합류의 따르는 줄은 깊이 +2 로 비켜 올라가며 gap 을 지난다", () => {
    // 머신 1 의 줄 — 흐름은 N(기둥 끝 N 포트). 수집 d2 는 머신 1 안이고, 비켜 가는 열 d4 가 기둥 밖까지 올라간다
    const follow = plan("W", [[1, [0, 1]]], 2, { portEnd: "N", exitEnd: "N", mergeRole: "follow" });
    expect(Object.fromEntries(cross([follow]))).toEqual({ "W:0": 4 });
  });

  it("상한은 입력만 본다 — 벨트 깊이 최댓값, 합류 쌍이 앉는 면이면 +2 · 깊이가 없는 면은 0", () => {
    const ctx = { inserters: INSERTERS, pipeFaces: new Map([["E" as const, { rows: [1], depthCap: 1 }]]) };
    expect(sideCrossBound(ctx, "W", false)).toBe(3);
    expect(sideCrossBound(ctx, "W", true)).toBe(5);
    expect(sideCrossBound(ctx, "E", true)).toBe(0); // 유체 면 상한이 d1 이라 줄이 못 앉는다
  });
});

describe("자격 — 진짜 gap 의 출구는 옆면을 건널 지하벨트가 있어야 앉는다", () => {
  const ask = (undergroundBelts: ModuleInput["undergroundBelts"], g: Link, face: "S" | "N" = "S") => {
    const ctx = openLinkFaceContext({ ...base, undergroundBelts }, 2, new Map());
    const why: DepthShortage[] = [];
    return { cand: tryLinkFace(ctx, g, "from", face, true, why), why };
  };
  const g0 = line("c→p:g#0", "gear", "from", { 0: 1 });

  it("지하벨트가 있으면 앉고 종류를 받는다", () => {
    const { cand } = ask([UG], g0);
    expect(cand?.face).toBe("S");
    expect(cand?.gap).toBe(0);
    expect(cand?.undergroundName).toBe("underground-belt");
  });

  it("없으면 거절하고 사유 `지하벨트없음` 을 남긴다", () => {
    const { cand, why } = ask([], g0);
    expect(cand).toBeUndefined();
    expect(why).toEqual([{ face: "S", clusterBeltDepth: 2, exitUnderground: "none" }]);
    expect(rungOfLine(why)).toBe("no-underground");
  });

  it("운반량을 모르거나 감당 못 하면 없는 것과 같다 · 사거리가 모자라면 `사거리초과`", () => {
    expect(ask([UG], { ...g0, carries: undefined }).why[0]?.exitUnderground).toBe("none");
    expect(ask([{ ...UG, throughput: 1 }], g0).why[0]?.exitUnderground).toBe("none");
    const short = ask([{ ...UG, maxDistance: 2 }], g0); // 상한 = 옆면 벨트 깊이 최댓값 3
    expect(short.why[0]?.exitUnderground).toBe("range");
    expect(rungOfLine(short.why)).toBe("dive-range");
  });

  it("레인 합류를 켜면 상한이 따르는 줄의 비켜 가는 열만큼(+2) 는다 — 사거리 4 는 꺼짐에서 닿고 켜짐에서 모자란다", () => {
    const four = [{ ...UG, maxDistance: 4 }];
    expect(ask(four, g0).cand?.undergroundName, "꺼짐(기본) — 상한 3").toBe("underground-belt");
    const on = withLaneMerge(true, () => ask(four, g0)); // 상한 = 깊이 3 + 합류 열 2 = 5
    expect(on.cand).toBeUndefined();
    expect(on.why[0]?.exitUnderground).toBe("range");
  });

  it("감당하는 것 중 사거리가 닿는 가장 느린 것을 고른다", () => {
    const fast = { entityName: "fast-underground-belt", throughput: 30, maxDistance: 7 };
    expect(ask([{ ...UG, maxDistance: 2 }, fast], g0).cand?.undergroundName).toBe("fast-underground-belt");
    expect(ask([UG, fast], g0).cand?.undergroundName).toBe("underground-belt");
  });

  it("기둥 끝(이웃 머신이 없는 면)은 출구가 기둥 밖이라 지하벨트 없이도 앉는다", () => {
    const { cand } = ask([], g0, "N"); // 머신 0 의 N — 맨 위
    expect(cand?.face).toBe("N");
    expect(cand?.gap).toBeUndefined();
    expect(cand?.undergroundName).toBeUndefined();
  });
});

describe("도형 — 출구 지하 횡단의 두 칸", () => {
  it("건너는 것이 없으면 없다(오늘 도형) · 있으면 옆면 d1 과 건너는 깊이 바로 바깥", () => {
    expect(gapExitDive({ x: 0, y: 4 }, { x: -1, y: 0 }, undefined)).toBeUndefined();
    expect(gapExitDive({ x: 0, y: 4 }, { x: -1, y: 0 }, 2)).toEqual({ near: { x: -1, y: 4 }, far: { x: -3, y: 4 } });
    expect(gapExitDive({ x: 2, y: 4 }, { x: 1, y: 0 }, 3)).toEqual({ near: { x: 3, y: 4 }, far: { x: 6, y: 4 } });
  });
});

/**
 * **실물** — 두 대 기둥. 관통 줄(머신 0 · 1 에 팔 하나씩)이 옆면 d2 에 앉아 gap 0 을 지난다. 머신 0 의 팔 셋 줄은 옆면 좌석이
 * 모자라 gap 0(머신 0 의 S)으로 넘친다. 그 출구가 관통 벨트를 건넌다 — D8 의 모양이다.
 */
describe("실물 — gap 출구가 옆면 관통 벨트를 지하로 건넌다", () => {
  const scene = (role: "from" | "to", undergroundBelts: ModuleInput["undergroundBelts"] = [UG]) => {
    const item = role === "from" ? "gear" : "plate";
    const links = [line("a#0", item, role, { 0: 1, 1: 1 }), line("b#0", item, role, { 0: 3 })];
    const input: ModuleInput = {
      ...base, undergroundBelts,
      lines: [{ name: item, kind: "belt", role: role === "from" ? "output" : "input" }],
      ...(role === "from" ? { outputLinks: links } : { inputLinks: links }),
    };
    return generateSeated(seatedAlone(input));
  };
  const at = (mod: ReturnType<typeof scene>, x: number, y: number) =>
    mod.cells.filter((c) => c.x === x && c.y === y).map((c) => c.cell);

  it("싣는 쪽 — 입구 W d1 · 출구 W d3, 포트는 그 바깥(d4 · d5) · 관통 벨트는 그 사이 d2 를 지난다", () => {
    const mod = scene("from");
    expect(mod.unroutedLines).toEqual([]);
    const [m0, m1] = mod.machines;
    const y = m0.origin.y + m0.size.h + 1; // gap 행 — 좌석 1 줄 다음 수집 줄(d2)
    expect(m1.origin.y - (m0.origin.y + m0.size.h)).toBe(2);
    const x0 = m0.origin.x;
    expect(at(mod, x0 - 1, y).map((c) => [c.entityType, c.undergroundType])).toEqual([[EntityType.UndergroundBelt, "input"]]);
    expect(at(mod, x0 - 2, y).map((c) => c.entityType)).toEqual([EntityType.Belt]); // 관통 줄
    expect(at(mod, x0 - 3, y).map((c) => [c.entityType, c.undergroundType])).toEqual([[EntityType.UndergroundBelt, "output"]]);
    const gapPort = mod.outputPorts.find((p) => p.anchor.y === y)!;
    expect(gapPort.anchor).toEqual({ x: x0 - 5, y });
    expect(gapPort.tapAnchor).toEqual({ x: x0 - 3, y }); // 포트가 붙는 칸 = 출구
    const keys = mod.cells.map((c) => `${c.x},${c.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("집는 쪽 — 거울: 입구 E d3 · 출구 E d1, 포트는 그 바깥", () => {
    const mod = scene("to");
    expect(mod.unroutedLines).toEqual([]);
    const [m0] = mod.machines;
    const y = m0.origin.y + m0.size.h + 1;
    const x1 = m0.origin.x + m0.size.w - 1;
    expect(at(mod, x1 + 3, y).map((c) => c.undergroundType)).toEqual(["input"]);
    expect(at(mod, x1 + 1, y).map((c) => c.undergroundType)).toEqual(["output"]);
    expect(mod.inputPorts.find((p) => p.anchor.y === y)?.anchor).toEqual({ x: x1 + 5, y });
    const keys = mod.cells.map((c) => `${c.x},${c.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("대조 — 건너는 줄이 없으면 오늘 도형 그대로다(포트 인서터 d1 · 상자 d2, 지하벨트 0)", () => {
    const input: ModuleInput = { ...base, outputLinks: [line("a#0", "gear", "from", { 1: 1 }), line("b#0", "gear", "from", { 0: 3 }), line("c#0", "gear", "from", { 0: 1 })] };
    const mod = generateSeated(seatedAlone(input));
    expect(mod.unroutedLines).toEqual([]);
    expect(mod.cells.filter((c) => c.cell.entityType === EntityType.UndergroundBelt)).toEqual([]);
    const [m0] = mod.machines;
    const gapPort = mod.outputPorts.find((p) => p.anchor.y > m0.origin.y + m0.size.h - 1 && p.anchor.y < mod.machines[1].origin.y);
    expect(gapPort?.anchor.x).toBe(m0.origin.x - 2);
  });

  it("대조 — 지하벨트가 없으면 gap 0 을 거절하고, 기둥 끝 N 은 관통 줄의 기둥 끝 포트 칸이라 거절한다 · 이름표 지하벨트없음", () => {
    const mod = scene("from", []);
    expect(mod.unroutedLines.map((l) => l.name)).toEqual(["gear"]);
    const why = [...(mod.depthShortages?.values() ?? [])];
    expect(why).toHaveLength(1);
    expect(why[0].some((w) => w.face === "S" && w.exitUnderground === "none")).toBe(true);
    expect(why[0].some((w) => w.face === "N" && w.blockedPort?.length)).toBe(true);
    expect(rungOfLine(why[0])).toBe("no-underground");
    // gap 은 안 열렸다
    const [m0, m1] = mod.machines;
    expect(m1.origin.y - (m0.origin.y + m0.size.h)).toBe(0);
  });
});
