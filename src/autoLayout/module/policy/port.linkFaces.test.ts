/**
 * **배정이 `generateModule` 밖에서 산다** — 링크의 자리는 좌석 단계가 정하고 **굳힌 값**으로 넘긴다.
 *
 * 잠그는 것은 셋이다:
 *
 * ```
 * 받은 값을 안 바꾼다         같은 굳힌 좌석으로 두 번 계획해도 같은 답 · 굳힌 장부는 그대로
 * 반쪽 배정이 없다            한 링크는 양끝이 다 앉거나 둘 다 안 앉는다(좌석 창구 둘에 묻고 받는다)
 * 모듈 혼자 앉히는 길이 없다   링크가 있는데 굳힌 좌석이 없으면 거절한다
 * ```
 *
 * **이 단언이 없으면 "동작 무변경" 이 말뿐이다.** 넘기는 것이 쓰다 만 장부였을 때는 받는 쪽이 원본을
 * 더럽히지 않게 사본을 떴다(2026-08-29 — 사본 없이 재사용해 21개 시험이 떨어졌다). 지금은 값이고,
 * 복사는 받는 쪽이 열 때 한 번이다.
 *
 * (2026-09-24 까지 이 파일의 첫 묶음은 *"모듈이 혼자 앉힌 답 == 밖에서 받은 답"* 을 잠갔다. 모듈 혼자 앉히는 길이
 *  없어져 그 비교는 뜻을 잃었다 — 대신 받은 값을 안 바꾼다는 성질을 잠근다.)
 */
import { describe, it, expect } from "vitest";
import { planModulePorts } from "./port";
import { openFaceSeating } from "./seat";
import { seatLinkEdge } from "../../link/policy/seat";
import { seatedAlone } from "../../link/testSeat";
import type { Link } from "../types/line";
import type { ModuleInput } from "../types/module";


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

/**
 * 같은 굳힌 좌석으로 **두 번** 계획한다 — 받는 쪽이 값을 복사해 열지 않으면 둘째 계획이 첫째가 앉힌
 * 나머지 줄을 보고 시작해 답이 갈린다(2026-08-29 에 사본 없이 재사용해 21개 시험이 떨어진 그 모양).
 */
const shape = (input: ModuleInput) => {
  const n = Math.max(1, input.count);
  const seated = seatedAlone(input);
  const p = planModulePorts(seated, n);
  const q = planModulePorts(seated, n);
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

describe("굳힌 좌석 — 두 번 열어도 같은 답(받은 값을 안 바꾼다)", () => {
  it("링크가 있는데 굳힌 좌석이 없으면 **거절한다** — 모듈 혼자 링크를 앉히는 길은 없다", () => {
    expect(() => planModulePorts(base(), 3)).toThrow();
    // 대조군 — 링크가 없으면 굳힌 좌석 없이도 된다
    expect(() => planModulePorts(base({ outputLinks: [], inputLinks: [] }), 3)).not.toThrow();
  });

  it("기본 트리 — 두 번 계획해도 같다", () => {
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

  it("받은 값을 안 바꾼다 — 두 번 불러도 같은 답 · 굳힌 장부는 그대로", () => {
    const input = seatedAlone(base());
    const n = Math.max(1, input.count);
    const seatedFaces = input.seatedFaces!;
    const cellsOf = () => [...seatedFaces.ledger.tables].map(([f, t]) => [f, [...t.cells]] as const);
    const before = cellsOf();
    const slots = (x: ReturnType<typeof planModulePorts>) =>
      x.restLinks?.in.plans.map((p) => p && [...p.slotIndex]);
    const once = planModulePorts({ ...input, seatedFaces }, n);
    const twice = planModulePorts({ ...input, seatedFaces }, n);
    // **대조군** — 나머지 줄이 실제로 그 장부에 앉았어야 "안 바뀌었다" 가 뜻을 갖는다.
    expect(once.restLinks?.in.plans.filter(Boolean).length).toBeGreaterThan(0);
    expect(slots(twice)).toEqual(slots(once));
    expect(cellsOf()).toEqual(before);
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
    const c = openFaceSeating(child, 1);
    const p = openFaceSeating(parent, 1);
    const r = seatLinkEdge(c, p, child.outputLinks!, { split: false });
    // 대조군 — 자식만 따로 물으면 **앉을 수 있다**(그래야 이 단언이 뜻을 갖는다).
    expect(openFaceSeating(child, 1).ask(child.outputLinks![0], "from", "near").offer).toBeTruthy();
    expect(openFaceSeating(parent, 1).ask(parent.inputLinks![0], "to", "near").offer).toBeUndefined();
    // 그런데 간선으로 물으면 **둘 다** 비어 있다.
    expect(r.fromSeats[0]).toBeUndefined();
    expect(r.toSeats[0]).toBeUndefined();
  });

  it("양끝이 다 되면 **둘 다** 앉는다", () => {
    const small = link("gear", [0], [0], 1);
    const c = openFaceSeating(base({ count: 1, outputLinks: [small], inputLinks: [] }), 1);
    const p = openFaceSeating(base({ count: 1, outputLinks: [], inputLinks: [small] }), 1);
    const r = seatLinkEdge(c, p, [small], { split: false });
    expect(r.fromSeats[0]).toBeDefined();
    expect(r.toSeats[0]).toBeDefined();
  });

  it("닫은 창구에는 더 못 묻는다 — 굳힌 뒤 장부가 새로 바뀌는 길이 없다", () => {
    const desk = openFaceSeating(child, 1);
    desk.close({ out: { seats: [], why: [] }, in: { seats: [], why: [] } });
    expect(() => desk.ask(child.outputLinks![0], "from", "near")).toThrow();
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

  const seat = (g: Link) =>
    openFaceSeating(base({ count: 3, outputLinks: [g], inputLinks: [] }), 3).ask(g, "from", "near").offer;

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
    const desk = openFaceSeating(base({ count: 3, outputLinks: [a, b], inputLinks: [] }), 3);
    const first = desk.ask(a, "from", "near").offer;
    expect(first?.portEnd).toBe("S");
    desk.take(first!, "from");
    expect(desk.ask(b, "from", "near").offer?.portEnd).toBe("N");
  });
});
