/**
 * **임시 계측 하네스** — 계획 1(도형 단일 출처) 2단계의 사전 재기.
 * 값을 읽고 나면 지운다. `tempPlanDocs/구조-2축/1-도형-단일출처/` §2단계.
 *
 * 브라우저 실측(`flg.run()`)이 본 게임데이터를 쓰는 반면 여기는 픽스처라서, **0 이어도
 * 안전을 보장하지 못한다.** 반대로 여기서 0 이 아니면 브라우저를 켜기 전에 이미 답이 나온다.
 */
import { describe, it, vi } from "vitest";
import { packModuleTree, type NodeSpec, type PackConfig } from "../planner/modulePacking";
import type { IoLine } from "../planner/module/ioLine";
import { readRunStats } from "../../debug/runStats";

const M = { entityName: "assembling-machine-3", w: 3, h: 3 };
const inL = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
const outL = (name: string): IoLine => ({ name, kind: "belt", role: "output" });

const config: PackConfig = {
  inserterEntityName: "inserter",
  inserters: [
    { entityName: "inserter", reach: 1, throughput: 6 },
    { entityName: "long-handed-inserter", reach: 2, throughput: 6 },
  ],
  beltEntityName: "transport-belt",
  belts: [{ entityName: "transport-belt", throughput: 40 }],
  reservePerimeterExits: true,
  beltMaxUndergroundDistance: 4,
};

/** 부모-자식 한 쌍 — 대수와 양을 바꿔 가며 여러 배정 모양을 만든다. */
const pair = (pc: number, cc: number, rate: number): NodeSpec[] => [
  {
    id: "p", depth: 0, machine: M, count: pc,
    lines: [inL("x"), outL("prod")],
    supplyCapacity: { lineRates: new Map([["input:x", rate], ["output:prod", rate]]) },
  },
  {
    id: "c", depth: 1, parentId: "p", machine: M, count: cc,
    lines: [outL("x")],
    supplyCapacity: { lineRates: new Map([["output:x", rate]]) },
  },
];

/** 원료·완제품까지 든 세 노드 트리 — 외부 줄(빈 쪽 링크)도 같은 배분기를 탄다. */
const tree = (): NodeSpec[] => [
  {
    id: "root", depth: 0, machine: M, count: 3,
    lines: [inL("a"), inL("b"), outL("final")],
    supplyCapacity: { lineRates: new Map([["input:a", 18], ["input:b", 9], ["output:final", 9]]) },
  },
  {
    id: "ca", depth: 1, parentId: "root", machine: M, count: 2,
    lines: [inL("raw"), outL("a")],
    supplyCapacity: { lineRates: new Map([["input:raw", 18], ["output:a", 18]]) },
  },
  {
    id: "cb", depth: 1, parentId: "root", machine: M, count: 1,
    lines: [outL("b")],
    supplyCapacity: { lineRates: new Map([["output:b", 9]]) },
  },
];

describe("도형 대조 — 계획의 청구와 방출의 실물", () => {
  it("픽스처 여럿을 돌리고 카운터를 찍는다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const specs of [pair(2, 2, 12), pair(5, 4, 40), pair(1, 1, 6), pair(3, 1, 24), tree()]) {
      try { packModuleTree(specs, config); } catch { /* 배치 실패는 여기서 볼 것이 아니다 */ }
    }
    warn.mockRestore();
    const sd = readRunStats().shapeDiff;
    console.log("[도형대조]", JSON.stringify({
      links: sd.links, clean: sd.clean, onlyPlan: sd.onlyPlan, onlyEmit: sd.onlyEmit,
      skipped: sd.skipped,
    }));
    console.log("[레인공유]", JSON.stringify(readRunStats().laneShare));
    for (const s of sd.samples) console.log("  ·", s);
  });
});
