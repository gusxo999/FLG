/**
 * **인서터 행 고르기**(`seatRowsOf`) — 결정표 결-4 의 집. 플래그(`AUTO_LAYOUT_SEAT_PICK`)를 켜면 규칙 둘이 선다:
 *
 * ```
 * 자리-1  포트 쪽 끝부터 붙여 앉는다        흐름 끝이 S 면 아래부터
 * 자리-2  쓸 수 없는 행은 고르기 전에 거른다  내 깊이 칸이 남의 것 · 끝 머신에서 포트 칸이 막힘
 * ```
 *
 * 잠그는 것: **끄면 오늘 규칙(앞에서 k 개) 그대로다** · 켜면 두 규칙이 **실제로** 다른 행을 고른다 ·
 * 걸러서 모자라면 좌석막힘으로 정직하게 떨어진다.
 */
import { afterEach, describe, it, expect } from "vitest";
import { seatRowsOf, tryLinkFace } from "./link";
import { openFaceSeating } from "./seat";
import { claimDepth, makeFaceTable } from "../ledger/face";
import { fitOnFace, openLinkFaceContext, seatTableOf } from "../ledger/seat";
import { setAutoLayoutSeatPick } from "../../shared/flags";
import type { Link } from "../types/line";
import type { ModuleInput } from "../types/module";
import type { DepthShortage } from "../types/seat";

// 기본값은 켜짐이다(2026-09-24 사용자) — 시험마다 기본으로 되돌리고, 대조군은 스스로 끈다
afterEach(() => setAutoLayoutSeatPick(true));

const one = (k: number) => new Map([[0, k]]);

describe("seatRowsOf — 끄면 오늘 규칙 그대로", () => {
  it("흐름이 S 여도 · 깊이 칸이 막혀도 앞에서 k 개", () => {
    setAutoLayoutSeatPick(false);
    const t = makeFaceTable(3, 1);
    claimDepth(t, 2, 0, 0, 9); // (행 0, d2) 에 남의 칸
    expect(seatRowsOf(t, "W", one(1), "from", { flowToSouth: true, depth: 2 })).toEqual(new Map([[0, [0]]]));
  });
});

describe("seatRowsOf — 켜면 규칙 둘", () => {
  it("자리-1 — 흐름 끝이 S 면 아래부터 붙인다(행은 오름차순으로 낸다)", () => {
    setAutoLayoutSeatPick(true);
    const t = makeFaceTable(3, 1);
    expect(seatRowsOf(t, "W", one(1), "from", { flowToSouth: true })).toEqual(new Map([[0, [2]]]));
    expect(seatRowsOf(t, "W", one(2), "from", { flowToSouth: true })).toEqual(new Map([[0, [1, 2]]]));
    // 대조군 — 흐름이 N 이면 오늘과 같다
    expect(seatRowsOf(t, "W", one(1), "from", { flowToSouth: false })).toEqual(new Map([[0, [0]]]));
  });

  it("자리-2 — 내 깊이 칸이 남의 것인 행은 건너뛴다(같은 깊이의 다른 행)", () => {
    setAutoLayoutSeatPick(true);
    const t = makeFaceTable(3, 1);
    claimDepth(t, 2, 0, 0, 9);
    expect(seatRowsOf(t, "W", one(1), "from", { flowToSouth: false, depth: 2 })).toEqual(new Map([[0, [1]]]));
  });

  it("자리-2 — 끝 머신에서 포트 칸이 막히는 행은 끝 행으로 안 쓴다(그보다 포트 쪽 행도 함께)", () => {
    setAutoLayoutSeatPick(true);
    const t = makeFaceTable(3, 1);
    const rows = seatRowsOf(t, "W", one(1), "from", { flowToSouth: false, portClear: (r) => r !== 0 });
    expect(rows).toEqual(new Map([[0, [1]]]));
  });

  it("gap 면은 안 바꾼다 — 이미 포트 쪽부터다", () => {
    setAutoLayoutSeatPick(true);
    const t = makeFaceTable(3, 1);
    expect(seatRowsOf(t, "N", one(1), "to", { flowToSouth: true, depth: 2 }))
      .toEqual(seatRowsOf(t, "N", one(1), "to"));
  });
});

describe("걸러서 모자라면 — 좌석막힘으로 떨어진다", () => {
  it("좌석 수는 되는데 받은 행이 모자라면 막힌 좌석을 사유로 남긴다", () => {
    setAutoLayoutSeatPick(true);
    const ctx = openLinkFaceContext({ machine: { entityName: "m", w: 3, h: 3 }, inserters: [] }, 1, new Map());
    const t = seatTableOf(ctx, "W");
    claimDepth(t, 2, 0, 2, 9); // d2 의 세 행이 전부 남의 칸
    const slotIndex = seatRowsOf(t, "W", one(1), "from", { flowToSouth: false, depth: 2 });
    expect(slotIndex.get(0)).toEqual([]);
    const why: DepthShortage[] = [];
    const fit = fitOnFace(ctx, "W", { clusterBeltDepth: 2, arms: one(1), slotIndex }, {}, why);
    expect(fit).toBeUndefined();
    expect(why[0]?.blockedRows).toEqual([0, 1, 2]);
    expect(why[0]?.seats).toBeUndefined(); // 좌석부족이 아니다 — 좌석막힘이다
  });
});

/**
 * 한 줄을 앉히는 자리(`tryLinkFace`)에서 — 첫 좌석의 깊이 칸이 남의 것일 때 **같은 깊이의 다른 행**이 먼저다.
 * 좌석은 못 늘리는 자원이라 깊이를 내리는 것(긴팔)보다 행을 바꾸는 것이 앞선다(`depthCandidates` 머리말).
 */
describe("tryLinkFace — 첫 좌석의 깊이 칸이 막히면", () => {
  const input: ModuleInput = {
    machine: { entityName: "m", w: 3, h: 3 }, count: 1, lines: [], inserterEntityName: "inserter",
    inserters: [
      { entityName: "inserter", reach: 1, throughput: 2.4 },
      { entityName: "long-handed-inserter", reach: 2, throughput: 1.2 },
    ],
    beltEntityName: "transport-belt",
  };
  const line: Link = { id: "c→p:a#0", item: "a", from: new Map([[0, 1]]), to: new Map([[0, 1]]) };
  const seat = () => {
    const ctx = openLinkFaceContext(input, 1, new Map());
    claimDepth(seatTableOf(ctx, "W"), 2, 0, 0, 9); // (행 0, d2) 에 남의 벨트 칸
    const c = tryLinkFace(ctx, line, "from", "W")!;
    return { depth: c.clusterBeltDepth, rows: [...c.slotIndex] };
  };

  it("대조군 — 끄면 행 0 에 앉고 d2 가 막혀 긴팔(d3)로 내려간다", () => {
    setAutoLayoutSeatPick(false);
    expect(seat()).toEqual({ depth: 3, rows: [[0, [0]]] });
  });

  it("켜면 d2 의 행 1 에 앉는다 — 긴팔을 안 쓴다", () => {
    setAutoLayoutSeatPick(true);
    expect(seat()).toEqual({ depth: 2, rows: [[0, [1]]] });
  });
});

/** 좌석 창구로 — 관통 줄 둘(머신 두 대)이 기둥 끝 N · S 를 나눠 가질 때 S 쪽 줄의 행. */
describe("좌석 창구 — S 끝 기둥 포트가 기둥 밖으로 나간다", () => {
  const M = { entityName: "assembling-machine-3", w: 3, h: 3 };
  const g = (item: string): Link => ({
    id: `c→p:${item}#0`, item, from: new Map([[0, 1], [1, 1]]), to: new Map([[0, 1]]),
  });
  const input: ModuleInput = {
    machine: M, count: 2, lines: [], inserterEntityName: "inserter",
    inserters: [
      { entityName: "inserter", reach: 1, throughput: 2.4 },
      { entityName: "long-handed-inserter", reach: 2, throughput: 1.2 },
    ],
    beltEntityName: "transport-belt",
  };
  const seatB = () => {
    const desk = openFaceSeating(input, 2);
    const a = desk.ask(g("a"), "from", "near").offer!;
    expect(a.portEnd).toBe("N"); // 두 대를 다 먹이는 줄은 관통이다 — 첫 줄이 N
    desk.take(a, "from");
    // 첫 줄의 벨트가 d2 의 행 0~3 을 덮으므로 둘째 줄은 d3 으로 간다
    const b = desk.ask(g("b"), "from", "near").offer!;
    expect(b.portEnd).toBe("S");
    expect(b.clusterBeltDepth).toBe(3);
    return [...b.slotIndex];
  };

  it("대조군 — 끄면 머신마다 윗줄(칸 1)에 앉아 끝 행이 4 — 포트 첫 칸(행 5)이 기둥 안쪽이다", () => {
    setAutoLayoutSeatPick(false);
    expect(seatB()).toEqual([[0, [1]], [1, [1]]]);
  });

  it("켜면 포트 쪽(아래) 끝 칸 2 에 앉아 끝 행이 5 — 포트(행 6 · 7)가 기둥 밖이다", () => {
    setAutoLayoutSeatPick(true);
    expect(seatB()).toEqual([[0, [2]], [1, [2]]]);
  });
});
