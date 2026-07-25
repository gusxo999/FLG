import { describe, it, expect } from "vitest";
import { packModuleTree, type NodeSpec, type PackConfig, type PackResult } from "./modulePacking";
import { routeModuleHops, type HopConfig } from "./moduleHop";
import { faceVector } from "../util/helper";
import type { IoLine } from "../module/clusterPortPlanner";
import { EntityType } from "../../../types/layout";

const inL = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
const outL = (name: string): IoLine => ({ name, kind: "belt", role: "output" });
const M = { entityName: "assembling-machine-2", w: 3, h: 3 };

// 트리: electronic-circuit(root) ← copper-cable ← (raw copper-plate)
//                                ← (raw iron-plate)
const specs: NodeSpec[] = [
  {
    id: "circuit", depth: 0, machine: M, count: 4,
    lines: [inL("iron-plate"), inL("copper-cable"), outL("electronic-circuit")],
  },
  {
    id: "coppercable", depth: 1, parentId: "circuit", machine: M, count: 5,
    lines: [inL("copper-plate"), outL("copper-cable")],
  },
];

const packConfig: PackConfig = {
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
};
const hopConfig: HopConfig = { beltEntityName: "transport-belt" };

// 프로덕션 충실 트리: electric-motor(root) ← iron-gear-wheel + copper-cable (2 홉).
// + 프로덕션처럼 지하벨트 활성 config. 단일-홉·지상-only 테스트가 못 잡던 멀티홉 교차를 재현.
const emSpecs: NodeSpec[] = [
  {
    id: "em", depth: 0, machine: M, count: 3,
    lines: [inL("iron-gear-wheel"), inL("copper-cable"), inL("iron-plate"), outL("electric-motor")],
  },
  { id: "gear", depth: 1, parentId: "em", machine: M, count: 2, lines: [inL("iron-plate"), outL("iron-gear-wheel")] },
  { id: "copper", depth: 1, parentId: "em", machine: M, count: 6, lines: [inL("copper-plate"), outL("copper-cable")] },
];
const ugConfig: HopConfig = {
  beltEntityName: "transport-belt",
  beltMaxUndergroundDistance: 9,
  undergroundBeltEntityName: "underground-belt",
};

// 유체 홉 트리(docs/auto-layout-wizard.fluid-hop.md): 자식 gasmaker 가 petroleum-gas(유체)를
// 만들어 부모 user 가 쓴다. 출력 유체는 W 면(부모 쪽), 입력 유체는 E 면(자식 쪽).
const inFluidL = (name: string): IoLine => ({ name, kind: "pipe", role: "input" });
const outFluidL = (name: string): IoLine => ({ name, kind: "pipe", role: "output" });
const fluidTrunk = (side: "W" | "E") => ({
  direction: (side === "W" ? 12 : 4) as 12 | 4,
  side,
  pipeEntityName: "pipe",
  fluidboxOffset: 0,
  undergroundPipeEntityName: "pipe-to-ground",
  pipeMaxUndergroundDistance: 10,
});
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
const fluidHopConfig: HopConfig = {
  beltEntityName: "transport-belt",
  pipeEntityName: "pipe",
  pipeMaxUndergroundDistance: 10,
  undergroundPipeEntityName: "pipe-to-ground",
};

/** 모듈 셀 + 머신 footprint 의 점유 좌표 집합. */
function occupancyOf(pack: PackResult): Set<string> {
  const occ = new Set<string>();
  for (const pl of pack.placements) {
    for (const m of pl.module.machines)
      for (let dx = 0; dx < m.size.w; dx++) for (let dy = 0; dy < m.size.h; dy++)
        occ.add(`${m.origin.x + dx},${m.origin.y + dy}`);
    for (const c of pl.module.cells) occ.add(`${c.x},${c.y}`);
  }
  return occ;
}

describe("routeModuleHops", () => {
  it("홉 1개(copper-cable) 라우팅 성공, 실패 0", () => {
    const pack = packModuleTree(specs, packConfig);
    const res = routeModuleHops(pack, hopConfig);
    expect(pack.hops).toHaveLength(1);
    expect(res.failures).toBe(0);
    expect(res.routes[0].ok).toBe(true);
    expect(res.cells.length).toBeGreaterThan(0);
  });

  it("양끝 경계 무한상자 2개를 strip 대상으로 표시", () => {
    const pack = packModuleTree(specs, packConfig);
    const res = routeModuleHops(pack, hopConfig);
    const hop = pack.hops[0];
    expect(res.strippedChestIds.has(hop.from.chest.id)).toBe(true);
    expect(res.strippedChestIds.has(hop.to.chest.id)).toBe(true);
    expect(res.strippedChestIds.size).toBe(2);
  });

  // **섞인 홉** — 한쪽 끝은 트렁크(탭 인서팅) 포트, 반대쪽은 1:1 다이렉트 인서팅 포트.
  // 부모는 입력이 많아 트렁크가 거절되고(direct), 자식은 tap 으로 남는다.
  //
  // 좌석 인서터의 운명이 **끝마다 다르다**([moduleHop.seatIsBeltFeeder]):
  //  - 트렁크 끝 `[상자][인서터][벨트]` — 상자가 홉 belt 가 되면 그 인서터는 belt→belt 가
  //    되어 하는 일 없이 처리량만 깎는다. 떼고 그 자리도 belt 로 메운다.
  //  - 1:1 끝 `[상자][인서터][머신]` — 그 인서터가 **머신에 재료를 넣는 유일한 물건**이다.
  //    떼면 머신이 조용히 굶는다. 남긴다.
  //
  // 그래서 판정은 홉 단위 플래그가 아니라 **포트 단위**여야 한다 — 이 트리가 그 증거다.
  it("섞인 홉 — 트렁크 끝 인서터는 belt 가 되고, 1:1 끝 인서터는 남는다", () => {
    const mixedSpecs: NodeSpec[] = [
      {
        id: "p", depth: 0, machine: M, count: 2,
        // 입력 5줄 = 트렁크 거절 → 다이렉트 인서팅(포트가 머신에 직접 붙는다).
        lines: [inL("a"), inL("b"), inL("c"), inL("d"), inL("x"), outL("prod")],
      },
      { id: "c", depth: 1, parentId: "p", machine: M, count: 2, lines: [outL("x")] },
    ];
    const pack = packModuleTree(mixedSpecs, packConfig);
    const res = routeModuleHops(pack, hopConfig);
    const hop = pack.hops.find((h) => h.item === "x")!;

    // 전제 — 두 끝의 모양이 실제로 다른가. 이게 같아지면 이 테스트는 섞인 홉을 더 이상
    // 재현하지 못하므로, 통과해도 증거가 아니다.
    expect(hop.from.cells.length, "자식 끝이 트렁크 포트가 아님").toBeGreaterThan(0);
    expect(hop.to.cells, "부모 끝이 1:1 포트가 아님").toHaveLength(0);

    const seatOf = (p: typeof hop.from) => {
      const fv = faceVector(p.face);
      return `${p.anchor.x - fv.x},${p.anchor.y - fv.y}`;
    };
    const fromSeat = seatOf(hop.from);
    const toSeat = seatOf(hop.to);

    // 트렁크 끝 — 떨어지고 belt 로 메워진다.
    expect(res.strippedCellKeys.has(fromSeat), `트렁크 끝 인서터가 안 떨어짐 @${fromSeat}`).toBe(true);
    expect(
      res.cells.find((c) => `${c.x},${c.y}` === fromSeat)?.cell.entityType,
      `트렁크 끝 좌석이 belt 로 안 메워짐 @${fromSeat}`,
    ).toBe(EntityType.Belt);

    // 1:1 끝 — 그대로 남는다(떼지도, 덮지도 않는다).
    expect(res.strippedCellKeys.has(toSeat), `1:1 인서터를 뗐다 @${toSeat}`).toBe(false);
    expect(
      res.cells.some((c) => `${c.x},${c.y}` === toSeat),
      `1:1 인서터를 belt 로 덮었다 @${toSeat}`,
    ).toBe(false);
  });

  it("유체 홉 — 자식 유체 출력 → 부모 유체 입력을 파이프로 잇는다", () => {
    const pack = packModuleTree(fluidSpecs, packConfig);
    // packModuleTree 가 이름 기반으로 유체 포트도 짝짓는다 → 유체 HopSpec 이 만들어진다.
    const fluidHop = pack.hops.find((h) => h.item === "petroleum-gas");
    expect(fluidHop, "유체 홉 쌍이 안 만들어짐").toBeDefined();
    expect(fluidHop!.from.chest.kind).toBe("infinity-pipe"); // 유체 포트

    const res = routeModuleHops(pack, fluidHopConfig);
    expect(res.failures).toBe(0);

    // 홉 경로는 **파이프**로 깔린다(벨트가 아니라) — pipe-to-pipe.
    const route = res.routes.find((r) => r.item === "petroleum-gas")!;
    expect(route.ok).toBe(true);
    expect(route.cells.length).toBeGreaterThan(0);
    expect(
      route.cells.every(
        (c) =>
          c.cell.entityType === EntityType.Pipe ||
          c.cell.entityType === EntityType.PipeUnderground,
      ),
      "홉 경로에 파이프 아닌 셀이 있다",
    ).toBe(true);

    // 양끝 무한파이프를 strip 대상으로.
    expect(res.strippedChestIds.has(fluidHop!.from.chest.id)).toBe(true);
    expect(res.strippedChestIds.has(fluidHop!.to.chest.id)).toBe(true);
  });

  it("유체 홉 config 에 파이프 prototype 이 없으면 실패(→ 옛 경로 폴백)", () => {
    const pack = packModuleTree(fluidSpecs, packConfig);
    const res = routeModuleHops(pack, { beltEntityName: "transport-belt" }); // 파이프 없음
    expect(res.failures).toBeGreaterThan(0);
  });

  it("strip 후 홉 belt 와 모듈 셀이 겹치지 않음 (좌표 고유)", () => {
    const pack = packModuleTree(specs, packConfig);
    const res = routeModuleHops(pack, hopConfig);
    const occ = occupancyOf(pack);
    for (const k of res.strippedCellKeys) occ.delete(k);
    for (const c of res.cells) {
      const k = `${c.x},${c.y}`;
      expect(occ.has(k), `홉 belt ${k} 가 모듈 셀과 충돌`).toBe(false);
      occ.add(k);
    }
  });

  it("홉 belt 는 전부 직교 이웃을 향함 (지상 연속 흐름)", () => {
    const pack = packModuleTree(specs, packConfig);
    const res = routeModuleHops(pack, hopConfig);
    const set = new Set(res.cells.map((c) => `${c.x},${c.y}`));
    // 각 belt 방향이 가리키는 다음 셀은 또 다른 홉 belt 이거나 trunkStart(기존 모듈 belt).
    const DIRVEC: Record<number, { x: number; y: number }> = {
      0: { x: 0, y: -1 }, 4: { x: 1, y: 0 }, 8: { x: 0, y: 1 }, 12: { x: -1, y: 0 },
    };
    const occ = occupancyOf(pack);
    let endpointsHittingTrunk = 0;
    for (const c of res.cells) {
      const v = DIRVEC[c.cell.direction];
      const nx = c.x + v.x, ny = c.y + v.y;
      const nk = `${nx},${ny}`;
      const intoHop = set.has(nk);
      const intoModule = occ.has(nk);
      expect(intoHop || intoModule, `belt (${c.x},${c.y}) dir ${c.cell.direction} 가 허공을 가리킴`).toBe(true);
      if (!intoHop && intoModule) endpointsHittingTrunk += 1;
    }
    // 정확히 1곳: 부모 입력 trunkStart 로 들어가는 seat_to belt.
    expect(endpointsHittingTrunk).toBeGreaterThanOrEqual(1);
  });

  it("[불변식] 지하벨트 활성·멀티홉에서도 belt 체인은 텔레포트하지 않는다", () => {
    // 회귀: 옛 emit 은 점프 경로를 지하벨트로 materialize 하지 못해 체인이 끊겼다.
    // 지금은 edge-aware(emitItemPath)라, 연속 두 셀은 (a) 직교 인접(거리 1)이거나
    // (b) 지하 입구→출구 페어(축 정렬·같은 방향·거리 ≤ maxJump)여야 한다.
    const pack = packModuleTree(emSpecs, packConfig);
    const res = routeModuleHops(pack, ugConfig);
    expect(res.failures).toBe(0);
    for (const route of res.routes) {
      if (!route.ok) continue;
      for (let i = 0; i + 1 < route.cells.length; i++) {
        const a = route.cells[i], b = route.cells[i + 1];
        const md = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        if (md === 1) continue;
        const isJumpPair =
          a.cell.entityType === EntityType.UndergroundBelt && a.cell.undergroundType === "input" &&
          b.cell.entityType === EntityType.UndergroundBelt && b.cell.undergroundType === "output" &&
          (a.x === b.x || a.y === b.y) && a.cell.direction === b.cell.direction &&
          md <= (ugConfig.beltMaxUndergroundDistance ?? 0);
        expect(isJumpPair, `홉 ${route.item}: (${a.x},${a.y})→(${b.x},${b.y}) 텔레포트(거리 ${md})`).toBe(true);
      }
    }
  });

  it("[불변식] 모든 홉 belt 는 하류가 belt/인서터/머신 — 허공·orphan 없음", () => {
    const pack = packModuleTree(emSpecs, packConfig);
    const res = routeModuleHops(pack, ugConfig);
    const DIRVEC: Record<number, { x: number; y: number }> = {
      0: { x: 0, y: -1 }, 4: { x: 1, y: 0 }, 8: { x: 0, y: 1 }, 12: { x: -1, y: 0 },
    };
    const hopSet = new Set(res.cells.map((c) => `${c.x},${c.y}`));
    const occ = occupancyOf(pack);
    for (const k of res.strippedCellKeys) occ.delete(k);
    for (const c of res.cells) {
      // 지하 입구의 하류는 지표가 아니라 터널(페어 출구) — 지표 검사에서 제외.
      if (c.cell.entityType === EntityType.UndergroundBelt && c.cell.undergroundType === "input") continue;
      const v = DIRVEC[c.cell.direction];
      const nk = `${c.x + v.x},${c.y + v.y}`;
      expect(hopSet.has(nk) || occ.has(nk), `홉 belt (${c.x},${c.y}) 하류가 허공`).toBe(true);
    }
  });

  it("seat_from 은 자식 출력 trunkStart 와 인접 (기하 유도 검증)", () => {
    const pack = packModuleTree(specs, packConfig);
    routeModuleHops(pack, hopConfig); // pack 미변형(순수) — 던지지 않는지만 본다
    const hop = pack.hops[0];
    const fv = faceVector(hop.from.face);
    const trunkStart = { x: hop.from.anchor.x - 2 * fv.x, y: hop.from.anchor.y - 2 * fv.y };
    // 자식 모듈에 trunkStart 가 실제 belt 로 존재해야 함.
    const childMod = pack.placements.find((p) => p.id === "coppercable")!.module;
    const isBelt = childMod.cells.some(
      (c) => c.x === trunkStart.x && c.y === trunkStart.y && c.cell.entityType === EntityType.Belt,
    );
    expect(isBelt, "자식 출력 trunkStart 가 belt 가 아님 — 기하 유도 오류").toBe(true);
  });

  it("결정적", () => {
    const a = routeModuleHops(packModuleTree(specs, packConfig), hopConfig);
    const b = routeModuleHops(packModuleTree(specs, packConfig), hopConfig);
    const sig = (r: ReturnType<typeof routeModuleHops>) =>
      JSON.stringify(r.cells.map((c) => [c.x, c.y, c.cell.direction]));
    expect(sig(b)).toEqual(sig(a));
  });

  // ── 지하벨트 (조각 C) ──────────────────────────────────────────────────────

  /** 채널을 세로로 완전히 막는 벽을 pack 에 주입 — 지상 우회 비용 ≫ 점프 비용. */
  function injectWall(pack: PackResult): { wallX: number } {
    const hop = pack.hops[0];
    const wallX = Math.round((hop.from.anchor.x + hop.to.anchor.x) / 2);
    const template = pack.placements[0].module.cells[0];
    const cells = pack.placements[0].module.cells;
    for (let y = -20; y <= 30; y++) {
      cells.push({ x: wallX, y, cell: { ...template.cell } });
    }
    return { wallX };
  }

  it("지하벨트: 벽에 막히면 점프로 넘고 입/출구·corridor 를 낸다", () => {
    const pack = packModuleTree(specs, packConfig);
    const { wallX } = injectWall(pack);
    const res = routeModuleHops(pack, ugConfig);
    expect(res.failures).toBe(0);

    const route = res.routes[0];
    const ug = route.cells.filter((c) => c.cell.entityType === EntityType.UndergroundBelt);
    const ins = ug.filter((c) => c.cell.undergroundType === "input");
    const outs = ug.filter((c) => c.cell.undergroundType === "output");
    expect(ins).toHaveLength(1);
    expect(outs).toHaveLength(1);
    // 입구/출구가 벽 양쪽에 있고, 방향이 같고(흐름), 벽 셀 위에는 안 앉는다.
    const [i0] = ins, [o0] = outs;
    expect(Math.sign(wallX - i0.x)).toBe(-Math.sign(wallX - o0.x));
    expect(i0.cell.direction).toBe(o0.cell.direction);
    expect(i0.x !== wallX && o0.x !== wallX).toBe(true);
    // corridor 1개가 결과로 나온다(호출자가 Area 에 기록).
    expect(route.corridors).toHaveLength(1);
    expect(res.corridors).toHaveLength(1);
  });

  it("지하벨트 게이트 오프(미선택): 막힌 벽을 **뚫지 않는다** — 지하 셀 0, 대신 실패", () => {
    const pack = packModuleTree(specs, packConfig);
    injectWall(pack);
    const res = routeModuleHops(pack, hopConfig); // underground 미지정

    // 이 벽은 배치 bbox 를 세로로 가로막는다. 홉 dijkstra 는 bbox 안에 갇혀 있으므로
    // (routeOneHop 의 bounds — 없으면 무한 격자를 탐색하다 OOM), **지상 우회로가 없다.**
    // 지하가 유일한 답인데 게이트가 꺼져 있으니 → 정직하게 실패한다.
    // 이게 이 테스트가 지키는 불변식이다: **게이트가 꺼지면 지하벨트를 절대 안 깐다.**
    // (교차가 기하학적으로 불가피하다는 것과 같은 이야기 —
    //  docs/auto-layout-wizard.trunk-redesign.md §7)
    expect(res.failures).toBe(1);
    expect(res.cells.some((c) => c.cell.entityType === EntityType.UndergroundBelt)).toBe(false);
    expect(res.corridors).toHaveLength(0);
  });

  it("지하벨트: 점프가 있어도 하류 연속성 유지(입구→터널→출구→지상)", () => {
    const pack = packModuleTree(specs, packConfig);
    injectWall(pack);
    const res = routeModuleHops(pack, ugConfig);
    const route = res.routes[0];
    // route.cells 는 체인 순서 — 입구 다음 원소는 페어 출구, 그다음은 출구 방향 지상 셀.
    for (let i = 0; i + 1 < route.cells.length; i++) {
      const a = route.cells[i], b = route.cells[i + 1];
      if (a.cell.entityType === EntityType.UndergroundBelt && a.cell.undergroundType === "input") {
        expect(b.cell.entityType).toBe(EntityType.UndergroundBelt);
        expect(b.cell.undergroundType).toBe("output");
        // 축 정렬 + 같은 방향.
        expect(a.x === b.x || a.y === b.y).toBe(true);
        expect(b.cell.direction).toBe(a.cell.direction);
      }
    }
  });
});
