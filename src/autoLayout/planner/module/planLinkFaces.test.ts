/**
 * **배정이 `generateModule` 밖에서 산다** — `tempPlanDocs/간선-배정/` Step 1.
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
import { planLinkFaces, planModulePorts } from "./planModulePorts";
import type { ModuleInput } from "../../module/clusterModule";
import type { Link } from "../../module/link";

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
    out: x.linkFaces.out.map((f) => f && { face: f.face, d: f.laneDepth, reach: f.reach, end: f.portEnd, slots: [...f.slotIndex] }),
    in: x.linkFaces.in.map((f) => f && { face: f.face, d: f.laneDepth, reach: f.reach, end: f.portEnd, slots: [...f.slotIndex] }),
    pipe: x.pipePlanned.map((l) => ({ name: l.line.name, side: l.side, d: l.clusterBeltDepth })),
    gapExit: [...x.gapExitSides].sort(),
    linked: [...x.linkedKeys].sort(),
    rest: x.restLinks && {
      out: x.restLinks.out.groups.map((g) => g.item),
      in: x.restLinks.in.groups.map((g) => g.item),
    },
    shortages: [...x.laneShortages.keys()].sort(),
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
