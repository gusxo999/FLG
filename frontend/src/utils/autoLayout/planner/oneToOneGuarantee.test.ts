/**
 * 1:1 기준선의 **보장** — 사용자가 정한 우선순위 두 가지를 그대로 못박는다
 * (docs/auto-layout-wizard.trunk-redesign.md §7).
 *
 *   ① 머신이 온전히 작동한다 — 모든 머신이 모든 재료를 받고 산출물을 내보낸다.
 *      = (머신, 품목) 마다 인서터가 하나 붙어 있고, 그 인서터가 집는(놓는) 칸이
 *        상자이거나 벨트다(허공이 아니다).
 *   ② 머신 ↔ perimeter ring 라우팅이 보장된다 — 모든 포트가 밖으로 나갈 수 있다.
 *      = 홉으로 이어졌거나(belt), perimeter 로 재배치됐다. 실패·skip 0.
 *
 * 트렁크(여러 머신이 벨트 한 줄을 나눠 탭)는 **비활성**이다. 트렁크는 나중에 이 1:1
 * 경로들을 **합치는 최적화**로 돌아오므로, 이 두 보장은 그때도 깨지면 안 된다.
 */
import { describe, it, expect } from "vitest";
import { packModuleTree, moduleExtent, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeModuleHops } from "./moduleHop";
import { relocateChestsToPerimeter } from "./modulePerimeterPass";
import { cellKey, faceVector } from "../util/helper";
import { EntityType } from "../../../types/layout";
import type { IoLine } from "../module/clusterPortPlanner";
import type { PlacedCell } from "../containerModel";

const inL = (n: string, a: number): IoLine => ({ name: n, kind: "belt", role: "input", amount: a });
const outL = (n: string, a: number): IoLine => ({ name: n, kind: "belt", role: "output", amount: a });
const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

/**
 * 지하벨트는 **선택 사항이 아니다.** 부모(머신 ≥2)를 자식 둘이 먹이는 순간, 위 자식 →
 * 아래 부모 머신 벨트와 아래 자식 → 위 부모 머신 벨트는 채널 테두리에서 끝점이 엇갈려
 * **반드시 교차**한다(Jordan). 지상에서 벨트는 교차할 수 없다 → 지하가 유일한 답이다.
 * 그래서 여기 config 는 production(moduleWizard)과 같이 지하벨트를 준다.
 */
const UNDERGROUND = {
  undergroundBeltEntityName: "underground-belt",
  beltMaxUndergroundDistance: 4,
};

const config: PackConfig = {
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
  reservePerimeterLanes: true,
  channelGeometry: true,
  beltMaxUndergroundDistance: UNDERGROUND.beltMaxUndergroundDistance,
};

const mk = (c0: number, c1: number, c2: number): NodeSpec[] => [
  { id: "n0", depth: 0, machine: M, count: c0, lines: [inL("copper-cable", 4), inL("electronic-circuit", 2), inL("kr-components", 2), outL("advanced-circuit", 1)] },
  { id: "n1", depth: 1, parentId: "n0", machine: M, count: c1, lines: [inL("plastic-bar", 4), inL("kr-silicon", 2), inL("kr-glass", 2), outL("kr-components", 4)] },
  { id: "n2", depth: 1, parentId: "n0", machine: M, count: c2, lines: [inL("copper-cable", 3), inL("stone-tablet", 1), outL("electronic-circuit", 2)] },
];

const COUNTS: [number, number, number][] = [
  [1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 2], [6, 4, 2], [8, 6, 4], [3, 2, 5],
];

/** 파이프라인 한 판 — pack → hop → perimeter, 그리고 최종 셀 맵. */
function run(specs: NodeSpec[]) {
  const pack = packModuleTree(specs, config);
  const hop = routeModuleHops(pack, { beltEntityName: "transport-belt", ...UNDERGROUND });
  const perim = relocateChestsToPerimeter(pack, hop.strippedChestIds, hop.cells, {
    beltEntityName: "transport-belt",
    inserterEntityName: "inserter",
  });

  // moduleWizard 와 동형으로 최종 셀 맵을 합성한다: 모듈 셀 − 떼어낸 것 + 홉 + 반출.
  const dropped = new Set([...hop.strippedCellKeys, ...perim.droppedCellKeys]);
  const grid = new Map<string, PlacedCell>();
  for (const pl of pack.placements)
    for (const c of pl.module.cells) {
      const k = cellKey(c.x, c.y);
      if (!dropped.has(k)) grid.set(k, c);
    }
  for (const c of [...hop.cells, ...perim.addedCells]) grid.set(cellKey(c.x, c.y), c);

  const machineCells = new Set<string>();
  for (const pl of pack.placements)
    for (const m of pl.module.machines)
      for (let dx = 0; dx < m.size.w; dx++)
        for (let dy = 0; dy < m.size.h; dy++) machineCells.add(cellKey(m.origin.x + dx, m.origin.y + dy));

  return { pack, hop, perim, grid, machineCells };
}

describe("1:1 보장 — 트렁크 없이도 성립해야 한다", () => {
  for (const [c0, c1, c2] of COUNTS) {
    const tag = `${c0}/${c1}/${c2}`;

    it(`${tag} — ① 모든 (머신, 품목) 에 인서터가 있고, 집는 칸이 상자/벨트다`, () => {
      const { pack, grid, machineCells } = run(mk(c0, c1, c2));

      const machineCount = pack.placements.reduce((n, pl) => n + pl.module.machines.length, 0);
      const lineCount = mk(c0, c1, c2).reduce((n, s) => n + s.lines.length, 0);
      const spec = new Map(mk(c0, c1, c2).map((s) => [s.id, s]));
      let checked = 0;

      for (const pl of pack.placements) {
        const lines = spec.get(pl.id)!.lines;
        for (const port of [...pl.module.inputPorts, ...pl.module.outputPorts]) {
          const fv = faceVector(port.face);
          // seat = anchor − fv. 여기 인서터가 살아 있어야 한다(홉·반출이 덮으면 안 됨).
          const seat = { x: port.anchor.x - fv.x, y: port.anchor.y - fv.y };
          const seatCell = grid.get(cellKey(seat.x, seat.y));
          expect(seatCell?.cell.entityType, `${port.chest.id}: seat 이 인서터가 아니다`).toBe(
            EntityType.Inserter,
          );

          // 인서터가 머신에 붙어 있어야 한다(반대편 = 머신 가장자리).
          const inner = { x: seat.x - fv.x, y: seat.y - fv.y };
          expect(machineCells.has(cellKey(inner.x, inner.y)), `${port.chest.id}: 인서터가 머신에 안 붙음`).toBe(true);

          // 인서터가 집는(놓는) 칸 = anchor. 상자이거나 벨트여야 한다 — 허공이면 물류가 끊긴다.
          const outer = grid.get(cellKey(port.anchor.x, port.anchor.y));
          const t = outer?.cell.entityType;
          expect(
            t === EntityType.Belt || t === EntityType.UndergroundBelt || t === EntityType.InfinityChest,
            `${port.chest.id}: anchor 가 벨트도 상자도 아님 (${t ?? "빈칸"})`,
          ).toBe(true);
          checked += 1;
        }
        // 이 모듈의 포트 수 = 머신 수 × 줄 수 (1:1 — 트렁크로 뭉치지 않는다).
        expect(
          pl.module.inputPorts.length + pl.module.outputPorts.length,
          `${pl.id}: 포트 수가 머신×줄 이 아니다`,
        ).toBe(pl.module.machines.length * lines.length);
      }
      expect(checked).toBe(machineCount * 0 + checked); // 자명 — 아래가 실질 검사
      expect(checked).toBeGreaterThanOrEqual(machineCount);
      expect(lineCount).toBeGreaterThan(0);
    });

    it(`${tag} — ② 모든 포트가 밖으로 나간다 (홉 실패 0 · 반출 skip 0)`, () => {
      const { pack, hop, perim } = run(mk(c0, c1, c2));
      expect(hop.failures, "홉 실패").toBe(0);
      expect(perim.skipped, `반출 skip — ${perim.reason ?? "-"}`).toBe(0);

      // 짝지어진 포트(홉) + 반출된 포트 = 전체 포트. 남는 포트가 없어야 한다.
      const total = pack.placements.reduce(
        (n, pl) => n + pl.module.inputPorts.length + pl.module.outputPorts.length,
        0,
      );
      expect(hop.strippedChestIds.size + perim.relocated).toBe(total);
    });

    it(`${tag} — 모듈 내부에 트렁크 벨트가 없다 (1:1 = 상자 + 인서터 두 칸)`, () => {
      const { pack } = run(mk(c0, c1, c2));
      for (const pl of pack.placements) {
        const belts = pl.module.cells.filter((c) => c.cell.entityType === EntityType.Belt);
        expect(belts.length, `${pl.id}: 모듈 안에 트렁크 벨트가 남아 있다`).toBe(0);
        for (const p of [...pl.module.inputPorts, ...pl.module.outputPorts])
          expect(p.cells.length, `${p.chest.id}: 포트에 belt spine 이 남아 있다`).toBe(0);
      }
    });

    it(`${tag} — 모든 포트가 자기 면으로 나갈 수 있다 (moduleWayOuts 가 face 포함)`, () => {
      const { pack } = run(mk(c0, c1, c2));
      for (const pl of pack.placements)
        for (const p of [...pl.module.inputPorts, ...pl.module.outputPorts])
          expect(p.moduleWayOuts, `${p.chest.id}: 자기 면(${p.face})이 막혔다`).toContain(p.face);
    });
  }

  it("모듈 폭 — 면당 2칸(인서터 + 상자)뿐이라 트렁크(3칸)보다 좁다", () => {
    const pack = packModuleTree(mk(3, 3, 3), config);
    for (const pl of pack.placements) {
      const ext = moduleExtent(pl.module);
      // 머신 3칸 + 양면 2칸씩 = 7. (N/S 면을 쓰면 세로로도 2칸씩 — count=1 완화 한정.)
      expect(ext.w).toBeLessThanOrEqual(3 + 2 + 2);
    }
  });
});
