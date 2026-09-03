import { describe, it, expect, afterEach } from "vitest";
import { packModuleTree, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeDeliveryRoutes } from "./deliveryRoute";
import type { IoLine } from "./module/ioLine";
import { setAutoLayoutLaneMerge } from "../debugFlags";
import { readRunStats } from "../../debug/runStats";

/**
 * **레인 합류 — 집는 쪽은 벨트 하나다**
 * (`docs/factorio/belt-lane-semantics.md` · `tempPlanDocs/벨트-레인/`).
 *
 * 인서터는 먼 레인 하나에만 떨구므로 **줄 하나는 벨트의 절반만 쓴다.** 그래서 레인을 넘는
 * 수요는 줄 둘이 되고([determineBeltCount]), 그 둘을 한 물리 벨트의 좌/우 레인에 하나씩
 * 실으면 벨트가 하나로 돌아온다. **처리량은 안 늘고 물리 벨트 수가 준다.**
 *
 * ## 비대칭이 이 기능의 전부다
 * ```
 * 싣는 쪽(자식)   벨트 **둘**  — 팔이 각자 먼 레인에 떨궈야 두 레인이 다 찬다
 * 집는 쪽(부모)   벨트 **하나** — 합류한 벨트가 벽의 한 칸으로 들어온다
 * ```
 * 이 파일이 잠그는 것은 **집는 쪽**이다(자식 쪽은 오늘 동작 그대로여야 한다).
 *
 * 채널의 합류 도형은 아직 없다 — 그래서 기능이 `AUTO_LAYOUT_LANE_MERGE` 뒤에 있고,
 * 여기서만 켠다. **끈 상태가 오늘 동작**이라 대조군으로 함께 잰다.
 */

const M = { entityName: "assembling-machine-3", w: 3, h: 3 };
const inL = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
const outL = (name: string): IoLine => ({ name, kind: "belt", role: "output" });

const config: PackConfig = {
  inserterEntityName: "inserter",
  inserters: [{ entityName: "inserter", reach: 1, throughput: 30 }],
  beltEntityName: "b",
  // 물리 90 → **줄 하나가 45**(레인). 수요 60 은 레인을 넘어 **줄 둘**이 된다.
  belts: [{ entityName: "b", throughput: 90 }],
  channelGeometry: true,
  reservePerimeterTracks: true,
  beltMaxUndergroundDistance: 4,
};

/** 자식 넷이 60/s 를 내고 부모 둘이 그걸 다 먹는다 — 레인(45)을 넘으므로 줄이 갈린다. */
const specs: NodeSpec[] = [
  {
    id: "p", depth: 0, machine: M, count: 2,
    lines: [inL("x"), outL("y")],
    supplyCapacity: { lineRates: new Map([["input:x", 60], ["output:y", 10]]) },
  },
  {
    id: "c", depth: 1, parentId: "p", machine: M, count: 4,
    lines: [outL("x")],
    supplyCapacity: { lineRates: new Map([["output:x", 60]]) },
  },
];

const run = (merge: boolean) => {
  setAutoLayoutLaneMerge(merge);
  const pack = packModuleTree(specs, config);
  const share = readRunStats().laneShare;
  const parent = pack.placements.find((pl) => pl.id === "p")!;
  const child = pack.placements.find((pl) => pl.id === "c")!;
  const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;
  return {
    pack,
    share,
    /** 부모가 품목 x 로 받는 논리 포트들. */
    inPorts: parent.module.inputPorts.filter((q) => q.line.name === "x"),
    /** 그 포트들이 서 있는 **물리** 자리 — 같으면 한 벨트다. */
    inAnchors: new Set(
      parent.module.inputPorts.filter((q) => q.line.name === "x").map((q) => key(q.anchor)),
    ),
    /** 자식이 x 를 내보내는 논리 포트들. */
    outPorts: child.module.outputPorts.filter((q) => q.line.name === "x"),
    outAnchors: new Set(
      child.module.outputPorts.filter((q) => q.line.name === "x").map((q) => key(q.anchor)),
    ),
    parentChestsAt: (at: string) =>
      parent.module.chests.filter((ch) => key(ch.origin) === at).length,
  };
};

afterEach(() => setAutoLayoutLaneMerge(false));

describe("레인 합류 — 켜면 집는 쪽이 한 벨트가 된다", () => {
  it("[전제] 수요가 레인을 넘어 **줄이 갈린다** — 안 갈리면 잴 것이 없다", () => {
    const off = run(false);
    expect(off.inPorts.length, "부모 입력 줄 둘").toBe(2);
    expect(off.outPorts.length, "자식 출력 줄 둘").toBe(2);
  });

  it("**끄면 오늘 동작** — 줄마다 자기 벨트·자기 자리(대조군)", () => {
    const off = run(false);
    expect(off.share.pairs).toBe(0);
    expect(off.inAnchors.size, "부모 포트가 서로 다른 자리에 선다").toBe(2);
  });

  it("**켜면 부모의 두 줄이 한 물리 벨트를 쓴다** — 논리 포트는 둘, 자리는 하나", () => {
    const on = run(true);
    expect(on.share.pairs, "짝이 지어져야 한다").toBe(1);
    expect(on.inPorts.length, "논리 포트는 그대로 둘 — 짝짓기가 품목·신원으로 조회한다").toBe(2);
    expect(on.inAnchors.size, "물리 자리는 하나").toBe(1);
  });

  it("**자식 쪽은 안 바뀐다** — 싣는 쪽은 벨트 둘이라야 두 레인이 다 찬다", () => {
    const on = run(true);
    expect(on.outPorts.length).toBe(2);
    expect(on.outAnchors.size, "자식은 여전히 벨트 둘").toBe(2);
  });

  it("한 자리에 상자는 **하나**뿐이다 — 논리 포트가 둘이어도 물건은 하나다", () => {
    const on = run(true);
    const at = [...on.inAnchors][0];
    expect(on.parentChestsAt(at)).toBe(1);
  });

  it("채널 지시가 둘로 갈린다 — 이끄는 줄은 계단꼴, 따르는 줄은 `mergeTail`", () => {
    const on = run(true);
    const kinds = [...(on.pack.channelGeometry?.deliveries.values() ?? [])].map((d) => d.kind);
    expect([...kinds].sort()).toEqual(["mergeTail", "staircase"]);
  });

  it("**상자 id 는 서로 다르다** — 같으면 먼저 짝지은 줄이 나머지를 영영 못 짝짓게 한다", () => {
    const on = run(true);
    // `pairDeliveryPorts` 의 `usedIn` 이 상자 id 로 *"이미 썼다"* 를 센다.
    expect(new Set(on.inPorts.map((q) => q.chest.id)).size).toBe(2);
  });
});

describe("레인 합류 — 채널이 두 납품을 한 줄로 잇는다", () => {
  const route = (merge: boolean) => {
    const r = run(merge);
    const delivery = routeDeliveryRoutes(r.pack, {
      beltEntityName: "b",
      undergroundBeltEntityName: "underground-belt",
      beltMaxUndergroundDistance: 4,
    });
    return { ...r, delivery };
  };

  it("**따르는 줄은 합류 칸 직전에서 멈춘다** — 그 한 칸의 어긋남이 사이드로드다", () => {
    const on = route(true);
    const kinds = [...(on.pack.channelGeometry?.deliveries.values() ?? [])].map((d) => d.kind);
    expect(kinds.filter((k) => k === "mergeTail"), "따르는 줄 하나").toHaveLength(1);
    // 이끄는 줄은 평범한 계단꼴 — 합류 칸에서 부모 벽으로 나간다.
    expect(kinds.filter((k) => k === "staircase" || k === "straight").length).toBeGreaterThan(0);
  });

  it("두 납품 다 **장부가 계획한다** — 탐색 폴백 0 · 실패 0", () => {
    const on = route(true);
    // 도형이 칸을 안 나눠 쓰므로(끝이 한 칸 어긋난다) 같은 트랙에 둘이 앉아도 다툼이 없다.
    expect(on.delivery.failures, "실패 0").toBe(0);
    expect(on.delivery.dijkstraFallback, "탐색 폴백 0 — 길이 났다가 아니라 **누가 냈나**").toBe(0);
    expect(on.delivery.planned).toBeGreaterThan(0);
  });

  it("[대조군] 끄면 둘 다 평범한 납품이다", () => {
    const off = route(false);
    expect([...(off.pack.channelGeometry?.deliveries.values() ?? [])].some((d) => d.kind === "mergeTail")).toBe(false);
    expect(off.delivery.failures).toBe(0);
  });
});
