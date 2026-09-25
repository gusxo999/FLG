/**
 * **합류 쌍의 도형을 묻기가 잰다**(work-kinds §7 D9 · 2026-09-25).
 *
 * 받기(`commitLinkFace`)는 합류 쌍의 도형을 통째로 청구한다 — 이끄는 줄은 구간 끝에서 **기둥 밖까지** 같은 깊이로 달리고,
 * 따르는 줄은 깊이 +2 로 기둥 밖까지 비켜 간다. 예전엔 묻기가 포트 두 칸만 봐서, 그 길이 지나는 남의 칸을 청구가 덮어 쓰고
 * 방출 안전망이 그 줄을 버렸다(40대 기둥에서 머신 6 의 이끄는 줄). 이제 묻기가 같은 도형([endCells])을 본다.
 *
 * 잠그는 것: 이끄는 줄의 길이 막히면 그 역할로는 안 앉는다(평범한 줄로는 앉는다 — 대조군) · 따르는 줄은 끝을 청구하지 않고
 * 이끄는 줄의 끝 · 깊이에 앉는다 · 따르는 줄의 비켜 가는 열이 막히면 안 앉는다.
 */
import { describe, it, expect } from "vitest";
import { tryLinkFace } from "./link";
import { openFaceSeating } from "./seat";
import { claimDepth } from "../ledger/face";
import { commitLinkFace, openLinkFaceContext, seatTableOf } from "../ledger/seat";
import { endCells } from "../shape/link";
import type { Link } from "../types/line";
import type { ModuleInput } from "../types/module";

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
};
/** 싣는 줄 — 머신마다 팔 하나(운반량이 팔 하나 안에 든다). 합류 쌍이면 신원을 든다. */
const out = (id: string, machines: number[], sharedLineId?: string): Link => ({
  id, item: "gear", sharedLineId,
  from: new Map(machines.map((m) => [m, 1])), to: new Map([[0, 1]]),
  carries: machines.map((m) => ({ from: m, to: 0, rate: 0.5 })),
});
/** 이끄는 줄로 묻는다 — 기둥 끝 N 을 강제한다(합류 쌍의 규약). */
const askLead = (ctx: ReturnType<typeof openLinkFaceContext>, g: Link) =>
  tryLinkFace(ctx, g, "from", "W", false, [], true, "N", undefined, "lead");

describe("셈 — 구간 밖 칸", () => {
  it("합류가 아니면 포트 두 칸 · 이끄는 줄은 기둥 밖까지의 길과 합류 칸 · 포트 · 따르는 줄은 비켜 가는 열", () => {
    const span = [6, 6] as const;
    expect(endCells({ clusterBeltDepth: 2, portEnd: "N" }, span, -1)).toEqual([[5, 2], [4, 2]]);
    expect(endCells({ clusterBeltDepth: 2, portEnd: "N", mergeRole: "lead" }, span, -1)).toEqual([
      [5, 2], [4, 2], [3, 2], [2, 2], [1, 2], [0, 2], [-1, 2], [-1, 3], [-2, 3], [-3, 3],
    ]);
    expect(endCells({ clusterBeltDepth: 2, portEnd: "N", mergeRole: "follow" }, span, -1)).toEqual([
      [6, 3], [6, 4], [5, 4], [4, 4], [3, 4], [2, 4], [1, 4], [0, 4], [-1, 4],
    ]);
  });
});

describe("이끄는 줄 — 기둥 밖까지 달리는 길이 비어야 그 역할로 앉는다", () => {
  /** 머신 0 의 d2 · d3 에 남의 줄(벨트 d2 · 포트 인서터 d3)이 앉은 표 — 머신 2 에서 N 끝으로 가는 길을 막는다. */
  const scene = () => {
    const ctx = openLinkFaceContext(base, 3, new Map());
    const blocker = tryLinkFace(ctx, out("b#0", [0]), "from", "W")!;
    commitLinkFace(ctx, blocker, "from");
    return ctx;
  };

  it("대조군 — 합류 역할 없이 물으면 앉는다(포트 두 칸은 머신 1 이라 비었다)", () => {
    const cand = tryLinkFace(scene(), out("l#0", [2], "lane"), "from", "W", false, [], true, "N");
    expect(cand?.clusterBeltDepth).toBe(2);
  });

  it("이끄는 줄로 물으면 안 앉는다 — d2 는 남의 벨트, d3 은 남의 포트 인서터가 그 길 위에 있다", () => {
    expect(askLead(scene(), out("l#0", [2], "lane"))).toBeUndefined();
  });

  it("길이 비었으면 이끄는 줄로 앉는다", () => {
    const ctx = openLinkFaceContext(base, 3, new Map());
    const cand = askLead(ctx, out("l#0", [2], "lane"));
    expect(cand?.portEnd).toBe("N");
    expect(cand?.clusterBeltDepth).toBe(2);
  });
});

describe("따르는 줄 — 끝을 청구하지 않고 이끄는 줄의 끝 · 깊이에 앉는다", () => {
  const scene = () => {
    const ctx = openLinkFaceContext(base, 3, new Map());
    const lead = askLead(ctx, out("l#0", [1], "lane"))!;
    commitLinkFace(ctx, lead, "from", { mergeLead: true });
    return { ctx, lead };
  };
  const askFollow = (ctx: ReturnType<typeof openLinkFaceContext>) =>
    tryLinkFace(ctx, out("f#0", [2], "lane"), "from", "W", false, [], true, "N", 2, "follow");

  it("끝 장부에 N 이 찼어도 N 으로 흐르고, 이끄는 줄의 깊이에 앉는다 · 받아도 끝을 안 먹는다", () => {
    const { ctx } = scene();
    const cand = askFollow(ctx)!;
    expect(cand.portEnd).toBe("N");
    expect(cand.clusterBeltDepth).toBe(2);
    expect([...cand.slotIndex]).toEqual([[2, [0]]]); // 포트 쪽(N) 끝부터 — 흐름이 N 이다
    commitLinkFace(ctx, cand, "from", { merged: {} });
    expect([...(ctx.ends.get("W") ?? [])]).toEqual(["N"]);
  });

  it("비켜 가는 열(d4)이 막히면 안 앉는다", () => {
    const { ctx } = scene();
    claimDepth(seatTableOf(ctx, "W"), 4, 1, 1, 99, "belt"); // 머신 0 의 행 1, d4 — 따르는 줄의 길 위
    expect(askFollow(ctx)).toBeUndefined();
  });
});

/**
 * **이끄는 줄은 따를 줄이 옆에 앉는 자리만 받는다**(work-kinds §7 D10). 창구가 베낀 무대에 이끄는 줄을 받아 보고 따를 줄을
 * 묻는다(싣는 쪽) · 집는 쪽은 받기 전에 따를 줄이 그 벨트에 얹히나 묻는다(`canShare`). 예전엔 이끄는 줄이 합류 도형을 먼저
 * 세우고, 따를 줄이 못 앉으면 짝만 풀려 그 도형이 홀로 남았다.
 */
describe("짝 맞춤 — 이끄는 줄을 받기 전에 따를 줄을 본다", () => {
  /** 머신 0 의 두 줄 — 팔이 `a` · `b` 개. W 면 좌석은 머신당 3 이다. */
  const pairOn0 = (a: number, b: number) => {
    const line = (id: string, arms: number, side: "from" | "to"): Link => ({
      id, item: "gear", sharedLineId: "lane",
      from: side === "from" ? new Map([[0, arms]]) : new Map([[0, 1]]),
      to: side === "to" ? new Map([[0, arms]]) : new Map([[0, 1]]),
      carries: [{ from: 0, to: 0, rate: 2 * arms }],
    });
    return (side: "from" | "to") => ({ lead: line("l#0", a, side), follow: line("f#0", b, side) });
  };

  it("싣는 쪽 — 따를 줄이 옆면에 못 앉으면(좌석 3 + 1 > 3) 이끄는 줄로는 안 낸다 · 따를 줄을 안 주면 낸다(대조군)", () => {
    const { lead, follow } = pairOn0(3, 1)("from");
    const ask = (withFollow: boolean) => openFaceSeating(base, 1).ask(lead, "from", "near", {
      forceEnd: true, preferEnd: "N", mergeRole: "lead", ...(withFollow ? { follow } : {}),
    });
    expect(ask(false).offer?.portEnd).toBe("N");
    expect(ask(true).offer).toBeUndefined();
  });

  it("싣는 쪽 — 따를 줄이 앉을 자리가 있으면 이끄는 줄로 낸다", () => {
    const { lead, follow } = pairOn0(2, 1)("from");
    const offer = openFaceSeating(base, 1).ask(lead, "from", "near", {
      forceEnd: true, preferEnd: "N", mergeRole: "lead", follow,
    }).offer;
    expect(offer?.portEnd).toBe("N");
  });

  it("집는 쪽 — 이끄는 줄의 벨트에 따를 줄의 좌석이 남나(받기 전) · 묻기는 장부를 안 바꾼다", () => {
    const full = pairOn0(3, 1)("to");
    const desk = openFaceSeating(base, 1);
    const lead = desk.ask(full.lead, "to", "near").offer!;
    expect(desk.canShare(full.follow, "to", lead)).toBe(false);
    const roomy = pairOn0(2, 1)("to");
    const desk2 = openFaceSeating(base, 1);
    const lead2 = desk2.ask(roomy.lead, "to", "near").offer!;
    expect(desk2.canShare(roomy.follow, "to", lead2)).toBe(true);
    // 두 번 물어도 같다 — 시험은 베낀 무대에서 받는다
    expect(desk2.canShare(roomy.follow, "to", lead2)).toBe(true);
    expect(desk2.ask(roomy.lead, "to", "near").offer?.slotIndex).toEqual(lead2.slotIndex);
  });
});
