import { describe, it, expect } from "vitest";
import { packModuleTree, moduleExtent, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeModuleHops } from "./moduleHop";
import { relocateChestsToPerimeter } from "./modulePerimeterPass";
import type { IoLine } from "../module/clusterPortPlanner";
import { EntityType } from "../../../types/layout";

const inL = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
const outL = (name: string): IoLine => ({ name, kind: "belt", role: "output" });
const M = { entityName: "assembling-machine-2", w: 3, h: 3 };

const config: PackConfig = {
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
};

// 3-depth: root ← mid ← leaf. root/mid 각각 raw 입력 1개 + 자식-공급 입력 1개.
const specs: NodeSpec[] = [
  { id: "root", depth: 0, machine: M, count: 4, lines: [inL("rawA"), inL("midOut"), outL("rootOut")] },
  { id: "mid", depth: 1, parentId: "root", machine: M, count: 3, lines: [inL("rawB"), inL("leafOut"), outL("midOut")] },
  { id: "leaf", depth: 2, parentId: "mid", machine: M, count: 2, lines: [inL("rawC"), outL("leafOut")] },
];

function survivingChests(pack: ReturnType<typeof packModuleTree>, stripped: Set<string>) {
  const out: { id: string; origin: { x: number; y: number }; role?: string }[] = [];
  for (const pl of pack.placements)
    for (const c of pl.module.chests)
      if (!stripped.has(c.id)) out.push({ id: c.id, origin: { ...c.origin }, role: c.role });
  return out;
}

function onPerimeter(p: { x: number; y: number }, bbox: { x: number; y: number; w: number; h: number }): boolean {
  return p.x <= bbox.x || p.x >= bbox.x + bbox.w - 1 || p.y <= bbox.y || p.y >= bbox.y + bbox.h - 1;
}

/** 모듈 union(마진 제외) = 전역 외곽 변 기준. */
function moduleUnion(pack: ReturnType<typeof packModuleTree>): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pl of pack.placements) {
    const e = moduleExtent(pl.module);
    minX = Math.min(minX, e.x); minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x + e.w - 1); maxY = Math.max(maxY, e.y + e.h - 1);
  }
  return { minX, minY, maxX, maxY };
}

function onEdge(p: { x: number; y: number }, u: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  return p.x <= u.minX || p.x >= u.maxX || p.y <= u.minY || p.y >= u.maxY;
}

/** 순수 결과 적용 후의 유효 셀 = (mod.cells − droppedCellKeys) + addedCells. moduleWizard 어댑터 동형. */
function effectiveCells(
  pack: ReturnType<typeof packModuleTree>,
  res: ReturnType<typeof relocateChestsToPerimeter>,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const pl of pack.placements)
    for (const c of pl.module.cells)
      if (!res.droppedCellKeys.has(`${c.x},${c.y}`)) out.push({ x: c.x, y: c.y });
  for (const c of res.addedCells) out.push({ x: c.x, y: c.y });
  return out;
}

describe("relocateChestsToPerimeter", () => {
  it("순수 — pack 미변형(chest.origin·mod.cells 그대로), 이사 결과는 relocations 로 반환", () => {
    // 예약 on — 채널이 lane 만큼 넓어져야 channel-host 상자도 통로가 난다.
    const pack = packModuleTree(specs, { ...config, reservePerimeterLanes: true });
    const hop = routeModuleHops(pack, { beltEntityName: "transport-belt" });
    expect(hop.failures).toBe(0);

    const u = moduleUnion(pack);
    const survBefore = survivingChests(pack, hop.strippedChestIds);
    // 재배치 전: 적어도 하나는 내부(전역 외곽이 아님).
    expect(survBefore.some((c) => !onEdge(c.origin, u))).toBe(true);
    const cellsBefore = JSON.stringify(pack.placements.map((pl) => pl.module.cells.length));

    const res = relocateChestsToPerimeter(pack, hop.strippedChestIds, hop.cells, {
      beltEntityName: "transport-belt",
      inserterEntityName: "inserter",
    });
    expect(res.ok).toBe(true);
    expect(res.relocated).toBeGreaterThan(0);
    expect(res.relocated + res.skipped).toBe(survBefore.length);
    expect(res.relocations.length).toBe(res.relocated);

    // 순수성: pack 은 한 셀도 바뀌지 않았다(chest.origin·mod.cells 길이 불변).
    expect(survivingChests(pack, hop.strippedChestIds)).toEqual(survBefore);
    expect(JSON.stringify(pack.placements.map((pl) => pl.module.cells.length))).toBe(cellsBefore);

    // 이사한 상자의 새 origin(relocations)은 전역 외곽 한 줄 바깥에 앉는다.
    for (const r of res.relocations) {
      const onOuter =
        r.origin.y === u.minY - 1 || r.origin.y === u.maxY + 1 ||
        r.origin.x === u.minX - 1 || r.origin.x === u.maxX + 1;
      expect(onOuter, `${r.chestId} @(${r.origin.x},${r.origin.y}) not on outer perimeter`).toBe(true);
    }
  });

  it("유효 셀 겹침 0 — 적용(drop+add) 후에도 좌표 고유", () => {
    const pack = packModuleTree(specs, config);
    const hop = routeModuleHops(pack, { beltEntityName: "transport-belt" });
    const res = relocateChestsToPerimeter(pack, hop.strippedChestIds, hop.cells, {
      beltEntityName: "transport-belt",
      inserterEntityName: "inserter",
    });
    const seen = new Set<string>();
    for (const c of effectiveCells(pack, res)) {
      const k = `${c.x},${c.y}`;
      expect(seen.has(k), `중복 ${k}`).toBe(false);
      seen.add(k);
    }
  });

  it("이사 상자 — addedCells 에 새 origin InfinityChest, 옛 chest 자리는 droppedCellKeys", () => {
    const pack = packModuleTree(specs, config);
    const hop = routeModuleHops(pack, { beltEntityName: "transport-belt" });
    const survBefore = new Map(survivingChests(pack, hop.strippedChestIds).map((c) => [c.id, c.origin]));
    const res = relocateChestsToPerimeter(pack, hop.strippedChestIds, hop.cells, {
      beltEntityName: "transport-belt",
      inserterEntityName: "inserter",
    });
    // addedCells 의 InfinityChest 위치 = 대응 relocation.origin.
    const addedChestAt = new Map<string, { x: number; y: number }>();
    for (const c of res.addedCells)
      if (c.cell.entityType === EntityType.InfinityChest) addedChestAt.set(c.cell.entityId ?? "", { x: c.x, y: c.y });
    for (const r of res.relocations) {
      expect(addedChestAt.get(r.chestId)).toEqual(r.origin);
      // 옛 chest 자리(origin)는 떼어낼 좌표에 포함.
      const old = survBefore.get(r.chestId)!;
      expect(res.droppedCellKeys.has(`${old.x},${old.y}`)).toBe(true);
    }
    // 상자별 2칸(ghost+feeder)씩 떼어낸다.
    expect(res.droppedCellKeys.size).toBe(res.relocated * 2);
  });

  it("결정적 — 같은 입력 → 같은 relocations", () => {
    const run = () => {
      const pack = packModuleTree(specs, config);
      const hop = routeModuleHops(pack, { beltEntityName: "transport-belt" });
      const res = relocateChestsToPerimeter(pack, hop.strippedChestIds, hop.cells, {
        beltEntityName: "transport-belt",
        inserterEntityName: "inserter",
      });
      return JSON.stringify(res.relocations.map((r) => [r.chestId, r.origin]));
    };
    expect(run()).toEqual(run());
  });

  it("count≥2 코너 어깨(face=N/S) 상자도 전부 재배치 — skip 0, 유효 셀 겹침 0", () => {
    // 분기 트리 n0←{n1,n2}, count=2. count≥2 기둥에선 트렁크가 레인을 따라 수평으로
    // 자라 상자가 코너 어깨(face=N/S, metaSide=E/W)에 앉는다. 옛 코드는 이 상자의 채널
    // 우회를 fv.x=0 로 무조건 거부(`N/S-side channel divert unsupported`)했고, 예약된
    // 채널 트랙이 자기 트렁크를 관통하는 상자(copper-cable)도 skip 됐다. laneX 구동 +
    // auto 폴백으로 전부 열린 외곽(대개 face 직진)으로 나가야 한다.
    const bin = (name: string, amount: number): IoLine => ({ name, kind: "belt", role: "input", amount });
    const bout = (name: string, amount: number): IoLine => ({ name, kind: "belt", role: "output", amount });
    const M3 = { entityName: "assembling-machine-3", w: 3, h: 3 };
    const branch: NodeSpec[] = [
      { id: "n0", depth: 0, machine: M3, count: 2, lines: [bin("copper-cable", 4), bin("electronic-circuit", 2), bin("kr-components", 2), bout("advanced-circuit", 1)] },
      { id: "n1", depth: 1, parentId: "n0", machine: M3, count: 2, lines: [bin("plastic-bar", 4), bin("kr-silicon", 2), bin("kr-glass", 2), bout("kr-components", 4)] },
      { id: "n2", depth: 1, parentId: "n0", machine: M3, count: 2, lines: [bin("copper-cable", 3), bin("stone-tablet", 1), bout("electronic-circuit", 2)] },
    ];
    const pack = packModuleTree(branch, { ...config, reservePerimeterLanes: true, channelGeometry: true });
    const hop = routeModuleHops(pack, { beltEntityName: "transport-belt" });
    expect(hop.failures).toBe(0);
    const res = relocateChestsToPerimeter(pack, hop.strippedChestIds, hop.cells, {
      beltEntityName: "transport-belt",
      inserterEntityName: "inserter",
    });
    expect(res.relocated).toBeGreaterThan(0);
    expect(res.skipped).toBe(0);
    // 적용 후 유효 셀 겹침 0.
    const seen = new Set<string>();
    for (const c of effectiveCells(pack, res)) {
      const k = `${c.x},${c.y}`;
      expect(seen.has(k), `중복 ${k}`).toBe(false);
      seen.add(k);
    }
  });
});
