import { describe, it, expect } from "vitest";
import { packModuleTree, deliveryKey, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeDeliveryRoutes, type DeliveryConfig } from "./deliveryRoute";
import {
  planChannelGeometry,
  type DeliveryInput,
  type ExportInput,
} from "./channelGeometryPlanner";
import type { IoLine } from "./module/clusterPortPlanner";
import { EntityType } from "../../types/layout";

// 유체 납품 경로가 채널 기하 장부 안에서 계획되고, 그 계획대로 깔리는지.
// 단일 출처: docs/auto-layout-wizard.fluid-delivery-reservation.md
//
// 이력: P4-4a 에서 이 파일은 **결함을 못박는** 특성화 테스트로 태어났다 — "장부가 계획을
// 만드는데 라우터가 그걸 버린다"(planned=0). P4-5b 에서 그 단언이 뒤집혔다(planned=1).
// 뒤집힘 자체가 이 작업이 실제로 무언가를 바꿨다는 증거다.

const inL = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
const outL = (name: string): IoLine => ({ name, kind: "belt", role: "output" });
const inFluidL = (name: string): IoLine => ({ name, kind: "pipe", role: "input" });
const outFluidL = (name: string): IoLine => ({ name, kind: "pipe", role: "output" });
const M = { entityName: "assembling-machine-2", w: 3, h: 3 };

/** 유체 상자가 `side` 면을 보는 회전. moduleWizard 가 wantFace 로 강제하는 것과 같은 값. */
const fluidTrunk = (side: "W" | "E") => ({
  direction: (side === "W" ? 12 : 4) as 12 | 4,
  pipeEntityName: "pipe",
  undergroundPipeEntityName: "pipe-to-ground",
  pipeMaxUndergroundDistance: 10,
  lines: [
    {
      name: "petroleum-gas",
      role: (side === "W" ? "output" : "input") as "input" | "output",
      side,
      fluidboxOffset: 0,
      rank: 0,
      boxIndex: 0,
    },
  ],
});

// 자식 gasmaker 가 petroleum-gas 를 만들어 부모 user 가 쓴다(docs/…fluid-delivery.md 의 그 트리).
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
  inserters: [{ entityName: "inserter", reach: 1, throughput: 0 }, { entityName: "long-handed-inserter", reach: 2, throughput: 0 }],
  beltEntityName: "transport-belt",
  channelGeometry: true,
  reservePerimeterLanes: true,
  beltMaxUndergroundDistance: 4,
};
const deliveryConfig: DeliveryConfig = {
  beltEntityName: "transport-belt",
  pipeEntityName: "pipe",
  pipeMaxUndergroundDistance: 10,
  undergroundPipeEntityName: "pipe-to-ground",
};

const pack = packModuleTree(fluidSpecs, packConfig);
const fluidDelivery = pack.deliveries.find((h) => h.item === "petroleum-gas");

describe("유체 납품 경로가 장부의 계획대로 깔린다", () => {
  it("유체 납품 경로 쌍이 만들어진다 (전제)", () => {
    expect(fluidDelivery, "유체 DeliverySpec 이 없다 — 아래 계측이 무의미해진다").toBeDefined();
    expect(fluidDelivery!.from.chest.kind).toBe("infinity-pipe");
  });

  // §1.1 — 납품 경로 입력 생성에 품목 종류 필터가 없다. 유체 포트는 wantFace 로 W/E 가 강제되고
  // (moduleWizard.ts:149, 못 맞추면 트리째 reject), 그게 eligible 조건과 정확히 같다.
  // 따라서 유체 납품 경로는 **예외 없이** 장부에 들어가 트랙을 하나 차지한다.
  it("장부가 유체 납품 경로의 경로를 이미 계획한다", () => {
    const key = deliveryKey(fluidDelivery!);
    const geo = pack.channelGeometry;
    expect(geo, "channelGeometry 가 안 켜졌다 — config 확인").toBeDefined();
    expect(
      geo!.deliveries.has(key),
      "유체 납품 경로가 장부 계획에 없다 — §1.1 조사와 어긋난다(설계 재검토 필요)",
    ).toBe(true);
  });

  // P4-5b 이전엔 routeDeliveryRoutes 루프의 첫 줄이 유체를 걷어내(옛 deliveryRoute.ts:253)
  // plannedChains 조회에 도달하지 못했다 — 계획이 있는데도 planned=0 이었다.
  // 지금은 유체도 계획 체인을 탄다. 이 트리의 납품 경로는 유체 하나뿐이므로 planned=1.
  it("라우터가 그 계획을 쓴다 — 탐색 없이 planned 로 집계", () => {
    const res = routeDeliveryRoutes(pack, deliveryConfig);
    expect(res.failures).toBe(0);
    expect(res.planned, "유체 납품 경로가 계획 체인으로 안 깔렸다").toBe(1);
    expect(res.dijkstraFallback, "유체가 탐색으로 샜다 — D3 위반").toBe(0);
  });

  it("계획으로 깐 유체 납품 경로도 파이프로 나온다 (벨트가 아니라)", () => {
    const res = routeDeliveryRoutes(pack, deliveryConfig);
    const route = res.routes.find((r) => r.item === "petroleum-gas")!;
    expect(route.ok).toBe(true);
    expect(route.cells.length).toBeGreaterThan(0);
    expect(
      route.cells.every(
        (c) =>
          c.cell.entityType === EntityType.Pipe ||
          c.cell.entityType === EntityType.PipeUnderground,
      ),
      "계획 체인이 벨트로 방출됐다 — finishFluidChain 이 안 탔다",
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P4-4c/d — 장부가 유체를 어떻게 다르게 다루는가 (§2 인접 규칙, §4.3 우선순위)
// ─────────────────────────────────────────────────────────────────────────────

const geoCtx = { yMin: 0, yMax: 12, maxJump: 6 };

/** 계획의 세로 주행 트랙 — straight 는 트랙을 안 쓰므로 null. */
const trackOf = (p: ReturnType<typeof planChannelGeometry>["deliveries"] extends Map<string, infer V> ? V : never) =>
  p.kind === "staircase" || p.kind === "undergroundCrossing"
    ? p.track
    : p.kind === "columnSwitch"
      ? p.startTrack
      : null;

describe("P4-4c — 파이프는 닿기만 해도 이어진다 (인접 금지)", () => {
  // 두 경로가 세로 구간을 공유한다 → 트랙을 나눠 써야 한다. 진입 행은 3칸 떨어뜨렸다 —
  // 실제로 다른 모듈의 포트라 붙어 있지 않다. (붙여 놓으면 가로 진입선끼리 나란히 닿아
  // 어떤 트랙 배정으로도 두 유체가 만난다 = 계획 불가가 정답이 되어 배정을 못 본다.)
  const a = (fluid?: string): DeliveryInput => ({ id: "a", startY: 2, endY: 9, fluid });
  const b = (fluid?: string): DeliveryInput => ({ id: "b", startY: 5, endY: 12, fluid });
  const noExports: ExportInput[] = [];

  it("아이템 두 줄은 이웃 트랙에 붙어도 된다 (겹침만 피하면 됨)", () => {
    const plan = planChannelGeometry([a(), b()], noExports, geoCtx);
    const ta = trackOf(plan.deliveries.get("a")!)!;
    const tb = trackOf(plan.deliveries.get("b")!)!;
    expect(Math.abs(ta - tb), "아이템끼리 트랙이 벌어졌다 — 인접 규칙이 잘못 적용됐다").toBe(1);
  });

  it("같은 유체 두 줄도 붙어도 된다 (닿아도 합법 — 자연 병합)", () => {
    const plan = planChannelGeometry([a("water"), b("water")], noExports, geoCtx);
    const ta = trackOf(plan.deliveries.get("a")!)!;
    const tb = trackOf(plan.deliveries.get("b")!)!;
    expect(Math.abs(ta - tb)).toBe(1);
  });

  it("다른 유체 두 줄은 반드시 한 칸 떨어진다 (닿으면 한 통이 된다)", () => {
    const plan = planChannelGeometry([a("water"), b("steam")], noExports, geoCtx);
    const ta = trackOf(plan.deliveries.get("a")!);
    const tb = trackOf(plan.deliveries.get("b")!);
    expect(ta, "water 가 계획을 못 받았다").not.toBeNull();
    expect(tb, "steam 이 계획을 못 받았다").not.toBeNull();
    expect(
      Math.abs(ta! - tb!),
      `다른 유체가 이웃 트랙에 배정됐다 (water=${ta}, steam=${tb}) — 두 유체가 한 통이 된다`,
    ).toBeGreaterThanOrEqual(2);
  });

  it("아이템과 유체는 붙어도 된다 (파이프 옆 벨트는 무해)", () => {
    const plan = planChannelGeometry([a("water"), b()], noExports, geoCtx);
    const ta = trackOf(plan.deliveries.get("a")!)!;
    const tb = trackOf(plan.deliveries.get("b")!)!;
    expect(Math.abs(ta - tb)).toBe(1);
  });
});

describe("P4-4d — 교차하면 유체가 지상, 아이템이 밑으로 (실패 비용 순)", () => {
  // 끝점이 엇갈린 두 경로 = 기하학적으로 교차 불가피(Jordan). 지상은 한 쪽만 가능하다.
  const up: DeliveryInput = { id: "up", startY: 2, endY: 10 };
  const down: DeliveryInput = { id: "down", startY: 10, endY: 2 };

  const exportsIn: ExportInput[] = [{ id: "x", entryY: 6, entryWall: "E", preferredExit: "N" }];

  // 우선순위가 **품목 종류**로 정해지는지, 아니면 그냥 id 정렬 순서인지 가른다.
  // 장부는 입력을 id 순으로 정렬하므로("down" < "up") 종류를 안 보면 늘 down 이 이긴다.
  // 그래서 유체를 up(정렬상 나중)에 걸었을 때도 up 이 이겨야 진짜 종류 우선순위다.
  it("id 정렬에서 뒤인 쪽이 유체여도 유체가 지상을 갖는다", () => {
    const plan = planChannelGeometry([{ ...up, fluid: "water" }, down], exportsIn, geoCtx);
    const fluidPlan = plan.deliveries.get("up")!;
    expect(
      fluidPlan.kind,
      `유체가 지상을 못 잡았다 (${fluidPlan.kind}) — 우선순위가 id 순서에 밀렸다`,
    ).not.toBe("fallback");
    expect(fluidPlan.kind, "유체에 지하 횡단이 배정됐다 — D2 위반").not.toBe("undergroundCrossing");
  });

  it("역할을 바꿔도 결과가 따라 바뀐다 (지상을 갖는 쪽 = 유체인 쪽)", () => {
    const plan = planChannelGeometry([up, { ...down, fluid: "water" }], exportsIn, geoCtx);
    expect(plan.deliveries.get("down")!.kind).not.toBe("fallback");
    expect(plan.deliveries.get("down")!.kind).not.toBe("undergroundCrossing");
  });

  it("유체는 어떤 경우에도 지하 횡단 계획을 받지 않는다 (D2)", () => {
    // 트랙을 좁혀 지상을 빡빡하게 만든다 — 아이템이라면 지하로 내려갈 상황.
    const plan = planChannelGeometry(
      [{ ...up, fluid: "water" }, { ...down, id: "d2" }, { id: "d3", startY: 4, endY: 8 }],
      [{ id: "x", entryY: 6, entryWall: "E", preferredExit: "N" }],
      { ...geoCtx, trackCap: 3 },
    );
    expect(plan.deliveries.get("up")!.kind).not.toBe("undergroundCrossing");
  });
});
