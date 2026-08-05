/**
 * 자식→부모 **유체** 연결이 아이템 링크 장부로 새지 않는지.
 *
 * 2026-07-26 브라우저 실측에서 유체 납품 경로가 **한 번도 성사되지 않는다**는 것이 드러났다.
 * 원인이 둘이었고 둘 다 이 파일이 지킨다.
 *
 *  - **B**: `edgeLinkGroups` 에 유체 가드가 없었다. 유체 링크가 인서터 팔을 배정받고
 *    (`water: 벨트 1줄, 줄당 팔 3`), `linkedKeys` 에 실려 아이템 방출기로 흘러가
 *    트렁크 파이프 경로를 건너뛰었다 → 유체 포트가 안 생기고 납품 경로도 안 생긴다.
 *  - **A**: `productOf` 가 **첫** 출력 라인을 집었다. 다산출 자식(`barrel + sulfuric-acid`)
 *    에서 엉뚱한 품목이 잡혀 부모와 짝이 안 맞고, 자식의 유체 출력과 부모의 유체 입력이
 *    **각각 외부 무한파이프**로 떨어졌다(실측에선 그 둘이 나란히 붙어 "항상 가득"과
 *    "항상 비움"이 한 관망에 공존했다).
 */
import { describe, it, expect } from "vitest";
import {
  edgeLinkGroups,
  edgeMachineLinks,
  packModuleTree,
  type NodeSpec,
  type PackConfig,
} from "./modulePacking";
import type { IoLine } from "./module/clusterPortPlanner";

const belt = (name: string, role: "input" | "output"): IoLine => ({ name, kind: "belt", role });
const pipe = (name: string, role: "input" | "output"): IoLine => ({ name, kind: "pipe", role });

const spec = (
  id: string,
  lines: IoLine[],
  lineRates: Record<string, number>,
  parentId?: string,
): NodeSpec => ({
  id,
  depth: parentId ? 1 : 0,
  parentId,
  machine: { entityName: "m", w: 3, h: 3 },
  count: 1,
  lines,
  supplyCapacity: { tapCapacity: 6, lineRates: new Map(Object.entries(lineRates)) },
});

const config: PackConfig = {
  inserterEntityName: "i",
  beltEntityName: "b",
  throughput: { normal: 6, long: 6 },
  belts: [{ entityName: "b", throughput: 20 }],
};

describe("edgeLinkGroups — 유체는 링크 장부에 안 오른다", () => {
  const rates = { "output:water": 100, "input:water": 100 };

  it("유체 줄이면 undefined — 팔을 배정하지 않는다", () => {
    const child = spec("c", [pipe("water", "output")], rates);
    const parent = spec("p", [pipe("water", "input")], rates, "c");
    expect(edgeLinkGroups(child, parent, "water", config)).toBeUndefined();
  });

  it("같은 수치라도 벨트 줄이면 링크가 나온다 — 가드가 kind 만 본다는 증거", () => {
    const child = spec("c", [belt("water", "output")], rates);
    const parent = spec("p", [belt("water", "input")], rates, "c");
    expect(edgeLinkGroups(child, parent, "water", config)).toBeDefined();
  });

  it("하위 계산기(edgeMachineLinks)는 그대로다 — 가드는 edgeLinkGroups 의 몫", () => {
    // kind 를 모르는 층까지 가드를 내리면 아이템 경로 계산이 흔들린다. 여기서 경계를 못 박는다.
    const child = spec("c", [pipe("water", "output")], rates);
    const parent = spec("p", [pipe("water", "input")], rates, "c");
    expect(edgeMachineLinks(child, parent, "water", config)).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A — 다산출 자식은 **부모가 먹는 것**으로 이어야 한다
// ─────────────────────────────────────────────────────────────────────────────

const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

const packCfg: PackConfig = {
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  throughput: { normal: 6, long: 6 },
  belts: [{ entityName: "transport-belt", throughput: 20 }],
  channelGeometry: true,
  reservePerimeterLanes: true,
  beltMaxUndergroundDistance: 4,
};

describe("productOf — 부산물이 먼저 와도 부모가 먹는 품목으로 잇는다", () => {
  // 자식 산출물 순서가 [부산물, 진짜] 다 — `empty-sulfuric-acid-barrel` 의 `barrel + acid`
  // 와 같은 모양. 첫 출력을 집으면 부모에게 "byproduct 입력"을 찾다 실패해 납품 경로가 0이 된다.
  const child: NodeSpec = {
    id: "c", depth: 1, parentId: "p", machine: M, count: 1,
    lines: [belt("byproduct", "output"), belt("wanted", "output")],
    supplyCapacity: {
      tapCapacity: 6,
      lineRates: new Map([["output:byproduct", 5], ["output:wanted", 10]]),
    },
  };
  const parent: NodeSpec = {
    id: "p", depth: 0, machine: M, count: 1,
    lines: [belt("wanted", "input")],
    supplyCapacity: { tapCapacity: 6, lineRates: new Map([["input:wanted", 10]]) },
  };
  const pack = packModuleTree([parent, child], packCfg);

  it("납품 경로가 생긴다 — 부모가 먹는 품목으로", () => {
    expect(pack.deliveries.map((h) => h.item)).toContain("wanted");
  });

  it("부산물로는 납품 경로를 만들지 않는다", () => {
    expect(pack.deliveries.map((h) => h.item)).not.toContain("byproduct");
  });

  it("부산물은 자식의 외부 출력 포트로 남는다(버리지 않는다)", () => {
    const c = pack.placements.find((pl) => pl.id === "c")!;
    expect(c.module.outputPorts.some((p) => p.line.name === "byproduct")).toBe(true);
  });
});
