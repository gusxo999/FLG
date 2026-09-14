/**
 * **배정이 `generateModule` 밖에서 산다**.
 *
 * 잠그는 것은 하나다: **밖에서 돌린 배정을 넣어도 답이 같다.**
 *
 * ```
 * planModulePorts(input, count)                              ← 자기가 돌린다(옛 경로)
 * planModulePorts(input, count, planLinkFaces(input, count))  ← 밖에서 받는다(P0b)
 * ```
 *
 * **이 단언이 없으면 "동작 무변경" 이 말뿐이다.** 앞으로 Step 2(루프 축을 간선으로)가
 * 배정을 진짜로 다르게 돌릴 텐데, 그때 *"무엇이 바뀌어서 답이 달라졌나"* 를 가르려면
 * **바뀌기 전이 같았다는 사실**이 잠겨 있어야 한다.
 */
import { describe, it, expect } from "vitest";
import { planLinkFaces, planModulePorts, seatLinkEdge } from "./planModulePorts";
import { tryLinkFace } from "./linkPlanner";
import { commitLinkFace } from "./ledger";
import type { Link } from "../../module/types/line";
import type { ModuleInput } from "../../module/types/module";


const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

const link = (item: string, from: number[], to: number[], rate: number): Link => ({
  id: `c→p:${item}#0`,
  item,
  from: new Map(from.map((i) => [i, 1])),
  to: new Map(to.map((i) => [i, 1])),
  carries: from.flatMap((f) => to.map((t) => ({ from: f, to: t, rate }))),
});

const base = (over: Partial<ModuleInput> = {}): ModuleInput => ({
  machine: M,
  count: 3,
  lines: [
    { name: "iron", kind: "belt", role: "input" },
    { name: "copper", kind: "belt", role: "input" },
    { name: "gear", kind: "belt", role: "output" },
  ],
  inserterEntityName: "inserter",
  inserters: [
    { entityName: "inserter", reach: 1, throughput: 2.4 },
    { entityName: "long-handed-inserter", reach: 2, throughput: 1.2 },
  ],
  beltEntityName: "transport-belt",
  belts: [{ entityName: "transport-belt", throughput: 15 }],
  supplyCapacity: {
    lineRates: new Map([["input:iron", 2], ["input:copper", 2], ["output:gear", 2]]),
  },
  outputLinks: [link("gear", [0, 1, 2], [0], 1)],
  inputLinks: [link("copper", [0], [0, 1, 2], 1)],
  ...over,
});

/** 계획에서 **비교 가능한 뼈대**만 뽑는다 — Map·객체 신원이 아니라 값으로 본다. */
const shape = (input: ModuleInput) => {
  const p = planModulePorts(input, Math.max(1, input.count));
  const q = planModulePorts(input, Math.max(1, input.count), planLinkFaces(input, Math.max(1, input.count)));
  const dump = (x: ReturnType<typeof planModulePorts>) => ({
    rowGaps: x.rowGaps,
    linkFaceDepths: x.linkFaceDepths,
    out: x.linkFaces.out.map((f) => f && { face: f.face, d: f.clusterBeltDepth, reach: f.reach, end: f.portEnd, slots: [...f.slotIndex] }),
    in: x.linkFaces.in.map((f) => f && { face: f.face, d: f.clusterBeltDepth, reach: f.reach, end: f.portEnd, slots: [...f.slotIndex] }),
    pipe: x.pipePlanned.map((l) => ({ name: l.line.name, side: l.side, d: l.clusterBeltDepth })),
    gapExit: [...x.gapExitSides].sort(),
    linked: [...x.linkedKeys].sort(),
    rest: x.restLinks && {
      out: x.restLinks.out.groups.map((g) => g.item),
      in: x.restLinks.in.groups.map((g) => g.item),
    },
    shortages: [...x.depthShortages.keys()].sort(),
  });
  return [dump(p), dump(q)] as const;
};

describe("planLinkFaces — 밖에서 돌린 배정을 받아도 답이 같다", () => {
  it("기본 트리 — 두 경로가 같은 계획을 낸다", () => {
    const [a, b] = shape(base());
    // **초록이 거짓이 아니게** — 둘 다 아무것도 안 앉혔으면 "같다" 는 아무 뜻이 없다.
    expect(a.out.filter(Boolean).length).toBeGreaterThan(0);
    expect(a.in.filter(Boolean).length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it("링크가 없어도 같다 — 배정할 것이 없는 경우", () => {
    const [a, b] = shape(base({ outputLinks: [], inputLinks: [] }));
    expect(b).toEqual(a);
  });

  it("선호 면이 넘쳐 gap 으로 밀리는 경우도 같다", () => {
    // 팔을 좌석(면당 3칸)보다 많이 요구해 넘침 단계를 태운다.
    const [a, b] = shape(base({
      count: 1,
      outputLinks: [link("gear", [0], [0], 12)],
      supplyCapacity: { lineRates: new Map([["input:iron", 2], ["input:copper", 2], ["output:gear", 12]]) },
    }));
    expect(b).toEqual(a);
  });

  it("유체 면이 끼어도 같다 — ⓪ 가 ①보다 먼저라는 순서가 유지된다", () => {
    const [a, b] = shape(base({
      lines: [
        { name: "water", kind: "pipe", role: "input" },
        { name: "iron", kind: "belt", role: "input" },
        { name: "gear", kind: "belt", role: "output" },
      ],
      fluidTrunk: {
        direction: 0,
        pipeEntityName: "pipe",
        undergroundPipeEntityName: "pipe-to-ground",
        pipeMaxUndergroundDistance: 10,
        lines: [{ name: "water", role: "input", side: "E", fluidboxOffset: 1, rank: 0, boxIndex: 0 }],
      },
    }));
    expect(b).toEqual(a);
  });
});

/**
 * **원자성** — 한 링크는 양끝이 다 앉거나 둘 다 안 앉는다(Step 2).
 *
 * 옛 모듈 축에서는 자식이 `from` 을, 부모가 `to` 를 **서로 모르게** 정해서 반쪽이 났다.
 * 그 증상이 `PackResult.linkMismatches` 의 *"child emitted, parent didn't"* 다.
 */
describe("seatLinkEdge — 반쪽 배정이 없다", () => {
  /** 자식은 자리가 넉넉하고(h=3), 부모는 **좌석이 하나뿐**(h=1)이라 팔 셋을 못 받는다. */
  const child = base({ count: 1, outputLinks: [link("gear", [0], [0], 6)], inputLinks: [] });
  const parent = base({
    machine: { entityName: "tiny", w: 1, h: 1 },
    count: 1,
    outputLinks: [],
    inputLinks: [link("gear", [0], [0], 6)],
  });

  it("부모가 못 앉으면 **자식도 안 앉는다**", () => {
    const c = planLinkFaces(child, 1, "open");
    const p = planLinkFaces(parent, 1, "open");
    const r = seatLinkEdge(c, p, child.outputLinks!, { split: false });
    // 대조군 — 자식만 따로 물으면 **앉을 수 있다**(그래야 이 단언이 뜻을 갖는다).
    expect(tryLinkFace(planLinkFaces(child, 1, "open").ctx, child.outputLinks![0], "from", "W")).toBeTruthy();
    expect(tryLinkFace(planLinkFaces(parent, 1, "open").ctx, parent.inputLinks![0], "to", "E")).toBeUndefined();
    // 그런데 간선으로 물으면 **둘 다** 비어 있다.
    expect(r.fromPlans[0]).toBeUndefined();
    expect(r.toPlans[0]).toBeUndefined();
  });

  it("양끝이 다 되면 **둘 다** 앉는다", () => {
    const small = link("gear", [0], [0], 1);
    const c = planLinkFaces(base({ count: 1, outputLinks: [small], inputLinks: [] }), 1, "open");
    const p = planLinkFaces(base({ count: 1, outputLinks: [], inputLinks: [small] }), 1, "open");
    const r = seatLinkEdge(c, p, [small], { split: false });
    expect(r.fromPlans[0]).toBeDefined();
    expect(r.toPlans[0]).toBeDefined();
  });
});

/**
 * **끝은 짝을 본다** — 형제 순번이 정하고, 좌표는 안 본다(Step 4).
 *
 * 옛 규칙은 `["N","S"]` **선착순**이라 짝이 어디 있든 첫 관통이 N 을 먹었다.
 * 거리(가장 가까운 끝)를 노리면 두 기둥의 **모서리**가 필요하고, 모서리는 높이를,
 * 높이는 `generateModule` 을 부른다 — 그래서 **교차 없음**을 노린다.
 */
describe("portEnd — 선호가 있으면 그것부터", () => {
  /** 머신 셋을 **관통**하는 출력 줄 하나(관통이라야 기둥 끝을 쓴다). */
  const spanning = (end?: { from: "N" | "S"; to: "N" | "S" }): Link => ({
    ...link("gear", [0, 1, 2], [0], 1),
    ...(end ? { end } : {}),
  });

  const seat = (g: Link) => {
    const st = planLinkFaces(base({ count: 3, outputLinks: [g], inputLinks: [] }), 3, "open");
    return tryLinkFace(st.ctx, g, "from", "W");
  };

  it("대조군 — 선호가 없으면 **N** 이 먼저다(오늘 동작)", () => {
    expect(seat(spanning())?.portEnd).toBe("N");
  });

  it("선호가 `S` 면 **S** 를 잡는다", () => {
    expect(seat(spanning({ from: "S", to: "N" }))?.portEnd).toBe("S");
  });

  it("선호가 `N` 이면 오늘과 같다 — 기전: 후보 순서가 `[\"N\",\"S\"]` 로 같아진다", () => {
    expect(seat(spanning({ from: "N", to: "S" }))?.portEnd).toBe("N");
  });

  it("선호한 끝이 이미 찼으면 **반대쪽**으로 물러난다", () => {
    const a = spanning({ from: "S", to: "N" });
    const b = spanning({ from: "S", to: "N" });
    const st = planLinkFaces(base({ count: 3, outputLinks: [a, b], inputLinks: [] }), 3, "open");
    const first = tryLinkFace(st.ctx, a, "from", "W");
    expect(first?.portEnd).toBe("S");
    commitLinkFace(st.ctx, first!, "from");
    expect(tryLinkFace(st.ctx, b, "from", "W")?.portEnd).toBe("N");
  });
});
