import { describe, it, expect } from "vitest";
import { packModuleTree, hopMapKey, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeModuleHops, type HopConfig } from "./moduleHop";
import type { IoLine } from "../module/clusterPortPlanner";

// P4-4a 계측 — 유체 홉이 채널 기하 장부에서 어떤 대접을 받는지 **현재 동작을 못박는다**.
// 단일 출처: docs/auto-layout-wizard.fluid-hop-reservation.md
//
// 이 파일은 특성화 테스트(characterization test)다. 지금 단언하는 것은 "옳은 동작"이 아니라
// **"지금 이렇게 동작한다"** 이다. P4-5 에서 라우터가 계획을 쓰기 시작하면 §"버려진다" 쪽
// 단언이 뒤집힌다 — 그때 뒤집는 것이 이 작업이 실제로 무언가를 바꿨다는 증거다.

const inL = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
const outL = (name: string): IoLine => ({ name, kind: "belt", role: "output" });
const inFluidL = (name: string): IoLine => ({ name, kind: "pipe", role: "input" });
const outFluidL = (name: string): IoLine => ({ name, kind: "pipe", role: "output" });
const M = { entityName: "assembling-machine-2", w: 3, h: 3 };

/** 유체 상자가 `side` 면을 보는 회전. moduleWizard 가 wantFace 로 강제하는 것과 같은 값. */
const fluidTrunk = (side: "W" | "E") => ({
  direction: (side === "W" ? 12 : 4) as 12 | 4,
  side,
  pipeEntityName: "pipe",
  fluidboxOffset: 0,
  undergroundPipeEntityName: "pipe-to-ground",
  pipeMaxUndergroundDistance: 10,
});

// 자식 gasmaker 가 petroleum-gas 를 만들어 부모 user 가 쓴다(docs/…fluid-hop.md 의 그 트리).
// 출력 유체는 W 면(부모 쪽), 입력 유체는 E 면(자식 쪽) — moduleWizard.ts:149 의 wantFace.
const fluidSpecs: NodeSpec[] = [
  {
    id: "user", depth: 0, machine: M, count: 2,
    lines: [inFluidL("petroleum-gas"), outL("plastic-bar")], fluidTrunk: fluidTrunk("E"),
  },
  {
    id: "gasmaker", depth: 1, parentId: "user", machine: M, count: 2,
    lines: [inL("coal"), outFluidL("petroleum-gas")], fluidTrunk: fluidTrunk("W"),
  },
];

// **production 충실**: moduleWizard 는 channelGeometry·reservePerimeterLanes 를 켜고 부른다
// (AUTO_LAYOUT_CHANNEL_GEOMETRY 기본 on). 기존 유체 테스트는 이 둘이 꺼진 config 를 써서
// 장부가 아예 안 돌았다 — 그래서 이 계측이 따로 필요하다.
const packConfig: PackConfig = {
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
  channelGeometry: true,
  reservePerimeterLanes: true,
  beltMaxUndergroundDistance: 4,
};
const hopConfig: HopConfig = {
  beltEntityName: "transport-belt",
  pipeEntityName: "pipe",
  pipeMaxUndergroundDistance: 10,
  undergroundPipeEntityName: "pipe-to-ground",
};

const pack = packModuleTree(fluidSpecs, packConfig);
const fluidHop = pack.hops.find((h) => h.item === "petroleum-gas");

describe("P4-4a 계측 — 유체 홉과 채널 기하 장부", () => {
  it("유체 홉 쌍이 만들어진다 (전제)", () => {
    expect(fluidHop, "유체 HopSpec 이 없다 — 아래 계측이 무의미해진다").toBeDefined();
    expect(fluidHop!.from.chest.kind).toBe("infinity-pipe");
  });

  // §1.1 — 홉 입력 생성에 품목 종류 필터가 없다. 유체 포트는 wantFace 로 W/E 가 강제되고
  // (moduleWizard.ts:149, 못 맞추면 트리째 reject), 그게 eligible 조건과 정확히 같다.
  // 따라서 유체 홉은 **예외 없이** 장부에 들어가 트랙을 하나 차지한다.
  it("장부가 유체 홉의 경로를 이미 계획한다", () => {
    const key = hopMapKey(fluidHop!);
    const geo = pack.channelGeometry;
    expect(geo, "channelGeometry 가 안 켜졌다 — config 확인").toBeDefined();
    expect(
      geo!.hops.has(key),
      "유체 홉이 장부 계획에 없다 — §1.1 조사와 어긋난다(설계 재검토 필요)",
    ).toBe(true);
  });

  // §1.2 — 그런데 routeModuleHops 루프의 첫 줄이 유체를 걷어낸다(moduleHop.ts:253).
  // plannedChains 조회에 도달하지 못하므로 위 계획은 **쓰이지 않는다**.
  //
  // ↓ P4-5b 에서 뒤집힌다: planned 가 1 이 되고 이 단언이 실패해야 한다.
  it("[현재 결함] 라우터가 그 계획을 쓰지 않는다 — planned 에 안 잡힌다", () => {
    const res = routeModuleHops(pack, hopConfig);
    expect(res.failures, "유체 홉이 아예 실패하면 계측이 다른 얘기가 된다").toBe(0);
    // 이 트리의 홉은 유체 하나뿐이다. 계획을 썼다면 planned=1 이어야 한다.
    expect(
      res.planned,
      "유체 홉이 planned 로 집계됐다 — 계획을 쓰기 시작했다면 이 테스트를 P4-5b 기준으로 갱신할 것",
    ).toBe(0);
  });
});
