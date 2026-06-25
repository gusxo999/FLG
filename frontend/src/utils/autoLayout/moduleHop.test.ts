import { describe, it, expect } from "vitest";
import { packModuleTree, type NodeSpec, type PackConfig, type PackResult } from "./modulePacking";
import { routeModuleHops, type HopConfig } from "./moduleHop";
import { faceVector } from "./containerRouting";
import type { IoLine } from "./clusterPortPlanner";
import { EntityType } from "../../types/layout";

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
    // 회귀: dijkstraWithJumps 가 점프 경로를 내면 emit 이 지하벨트로 materialize 하지
    // 않고 지상 belt 1칸만 찍어 체인이 끊겼다(아이템이 허공/타 스트림으로 샘). 각 홉
    // route.cells 는 chain 순서이므로 연속 두 셀은 반드시 직교 인접(거리 1)이어야 한다.
    const pack = packModuleTree(emSpecs, packConfig);
    const res = routeModuleHops(pack, ugConfig);
    expect(res.failures).toBe(0);
    for (const route of res.routes) {
      if (!route.ok) continue;
      for (let i = 0; i + 1 < route.cells.length; i++) {
        const a = route.cells[i], b = route.cells[i + 1];
        const md = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        expect(md, `홉 ${route.item}: (${a.x},${a.y})→(${b.x},${b.y}) 텔레포트(거리 ${md})`).toBe(1);
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
      const v = DIRVEC[c.cell.direction];
      const nk = `${c.x + v.x},${c.y + v.y}`;
      expect(hopSet.has(nk) || occ.has(nk), `홉 belt (${c.x},${c.y}) 하류가 허공`).toBe(true);
    }
  });

  it("seat_from 은 자식 출력 trunkStart 와 인접 (기하 유도 검증)", () => {
    const pack = packModuleTree(specs, packConfig);
    const res = routeModuleHops(pack, hopConfig);
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

  it("렌더 — 모듈 트리 + 홉", () => {
    const pack = packModuleTree(specs, packConfig);
    const res = routeModuleHops(pack, hopConfig);
    const ARROW: Record<number, string> = { 0: "^", 4: ">", 8: "v", 12: "<" };
    const strip = res.strippedCellKeys;
    // bbox
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const mark = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
    for (const pl of pack.placements) {
      for (const m of pl.module.machines) { mark(m.origin.x, m.origin.y); mark(m.origin.x + m.size.w - 1, m.origin.y + m.size.h - 1); }
      for (const c of pl.module.cells) mark(c.x, c.y);
    }
    for (const c of res.cells) mark(c.x, c.y);
    const W = maxX - minX + 1, H = maxY - minY + 1;
    const g: string[][] = Array.from({ length: H }, () => Array(W).fill("."));
    const put = (x: number, y: number, ch: string) => { g[y - minY][x - minX] = ch; };
    for (const pl of pack.placements) {
      for (const m of pl.module.machines)
        for (let dx = 0; dx < m.size.w; dx++) for (let dy = 0; dy < m.size.h; dy++)
          put(m.origin.x + dx, m.origin.y + dy, "#");
      for (const c of pl.module.cells) {
        if (strip.has(`${c.x},${c.y}`)) continue; // 떼어낼 경계 셀은 숨김
        const t = c.cell.entityType;
        if (t === EntityType.Belt) put(c.x, c.y, ARROW[c.cell.direction] ?? "b");
        else if (t === EntityType.Inserter) put(c.x, c.y, "i");
        else if (t === EntityType.InfinityChest) put(c.x, c.y, "C");
      }
    }
    for (const c of res.cells) put(c.x, c.y, ARROW[c.cell.direction] ?? "H"); // 홉 belt(대문자 흐름)
    // eslint-disable-next-line no-console
    console.log(
      `\n--- 모듈 트리 + 홉 (strip 적용, 홉=arrow) ---\n` +
        `홉 ${res.routes.map((r) => `${r.item}:${r.ok ? r.cells.length + "셀" : "FAIL"}`).join(", ")} · strip chest ${res.strippedChestIds.size}\n` +
        g.map((r) => r.join("")).join("\n"),
    );
  });
});
