/**
 * 공급 보장 — 사용자가 정한 우선순위 두 가지를 **공급 방식과 무관하게** 못박는다
 * (docs/auto-layout-wizard.trunk-redesign.md §7).
 *
 *   ① 머신이 온전히 작동한다 — 모든 머신이 모든 재료를 받고 산출물을 내보낸다.
 *      = (머신, 줄) 마다 인서터가 **정확히 하나** 머신에 붙어 있고, 그 인서터가 손을
 *        뻗는 바깥 칸이 벨트이거나 상자다(허공이 아니다).
 *   ② 머신 ↔ perimeter ring 라우팅이 보장된다 — 모든 포트가 밖으로 나간다.
 *      = 홉으로 이어졌거나(belt), perimeter 로 재배치됐다. 실패·skip 0.
 *
 * **이 둘은 [탭 인서팅](../../../../docs/용어사전.md)(트렁크)이든 다이렉트 인서팅(1:1)이든
 * 똑같이 성립해야 한다** — 그래서 여기 검사는 공급 방식을 묻지 않는다. 방식에 따라 갈리는
 * 것(모듈 안 belt 유무, 경계 포트 수)만 `supply.mode` 로 갈라 확인한다.
 *
 * ⚠ 파일명(`oneToOneGuarantee`)은 1:1 만 있던 시절의 잔재다 — 지금은 두 방식을 다 덮는다.
 */
import { describe, it, expect } from "vitest";
import { packModuleTree, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeModuleHops } from "./moduleHop";
import { rePathToPerimeter } from "../execution/modulePerimeterPass";
import { cellKey } from "../util/helper";
import { EntityType } from "../../../types/layout";
import type { IoLine } from "../module/clusterPortPlanner";
import type { Container, PlacedCell } from "../containerModel";

const inL = (n: string, a: number): IoLine => ({ name: n, kind: "belt", role: "input", amount: a });
const outL = (n: string, a: number): IoLine => ({ name: n, kind: "belt", role: "output", amount: a });
const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

/**
 * 지하벨트는 **선택 사항이 아니다.** 1:1 에선 납품 벨트끼리의 교차가 기하학적으로 불가피해
 * (Jordan) 지하가 유일한 답이었다. 트렁크에선 교차가 대부분 사라지지만, production
 * (moduleWizard)이 지하를 넘기므로 테스트도 **같은 설정**을 쓴다.
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
  const perim = rePathToPerimeter(pack, hop.strippedChestIds, hop.cells, {
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

  return { pack, hop, perim, grid };
}

/** 머신 footprint 에 직교 인접한 칸들. */
function adjacentToMachine(m: Container): { x: number; y: number; out: { x: number; y: number } }[] {
  const out: { x: number; y: number; out: { x: number; y: number } }[] = [];
  const { x, y } = m.origin;
  const { w, h } = m.size;
  for (let dy = 0; dy < h; dy++) {
    out.push({ x: x - 1, y: y + dy, out: { x: -1, y: 0 } });
    out.push({ x: x + w, y: y + dy, out: { x: 1, y: 0 } });
  }
  for (let dx = 0; dx < w; dx++) {
    out.push({ x: x + dx, y: y - 1, out: { x: 0, y: -1 } });
    out.push({ x: x + dx, y: y + h, out: { x: 0, y: 1 } });
  }
  return out;
}

// Set<EntityType> 로 넓혀 둔다 — 리터럴 3종 union 으로 좁혀지면 .has(EntityType) 이 막힌다.
const CARRIER = new Set<EntityType>([EntityType.Belt, EntityType.UndergroundBelt, EntityType.InfinityChest]);

describe("공급 보장 — 탭이든 다이렉트든 성립해야 한다", () => {
  for (const [c0, c1, c2] of COUNTS) {
    const tag = `${c0}/${c1}/${c2}`;

    it(`${tag} — ① 머신마다 줄 수만큼 인서터가 붙고, 손 닿는 칸이 벨트/상자다`, () => {
      const { pack, grid } = run(mk(c0, c1, c2));
      const spec = new Map(mk(c0, c1, c2).map((s) => [s.id, s]));

      for (const pl of pack.placements) {
        const lineCount = spec.get(pl.id)!.lines.filter((l) => l.kind === "belt").length;
        for (const m of pl.module.machines) {
          const inserters = adjacentToMachine(m).filter(
            (a) => grid.get(cellKey(a.x, a.y))?.cell.entityType === EntityType.Inserter,
          );
          // 줄마다 인서터 하나 — 재료를 못 받거나(부족) 겹쳐 낭비되지(초과) 않는다.
          expect(inserters.length, `${m.id}: 인서터 수 ≠ 줄 수`).toBe(lineCount);

          // 인서터는 머신 바로 옆(1칸)에 앉으므로, 손이 닿는 바깥 칸은 **1~2칸 더 밖**이다
          // (일반=1칸 = 가까운 레인, 긴팔=2칸 = 먼 레인). 거기 벨트나 상자가 있어야 한다 —
          // 허공에 집어넣으면 물류가 끊긴다.
          for (const ins of inserters) {
            const fed = [1, 2].some((step) => {
              const t = grid.get(
                cellKey(ins.x + ins.out.x * step, ins.y + ins.out.y * step),
              )?.cell.entityType;
              return t !== undefined && CARRIER.has(t);
            });
            expect(fed, `${m.id}: 인서터(${ins.x},${ins.y}) 가 허공에 손을 뻗는다`).toBe(true);
          }
        }
      }
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

    it(`${tag} — 모든 포트가 자기 나가는 방향으로 나갈 수 있다 (moduleWayOuts ∋ face)`, () => {
      const { pack } = run(mk(c0, c1, c2));
      for (const pl of pack.placements)
        for (const p of [...pl.module.inputPorts, ...pl.module.outputPorts])
          expect(p.moduleWayOuts, `${p.chest.id}: 자기 face(${p.face})가 막혔다`).toContain(p.face);
    });

    it(`${tag} — 공급 방식이 기하와 일치한다 (탭=트렁크 belt 있음·포트=줄 수)`, () => {
      const { pack } = run(mk(c0, c1, c2));
      const spec = new Map(mk(c0, c1, c2).map((s) => [s.id, s]));
      for (const pl of pack.placements) {
        const lines = spec.get(pl.id)!.lines.filter((l) => l.kind === "belt").length;
        const belts = pl.module.cells.filter((c) => c.cell.entityType === EntityType.Belt).length;
        const ports = pl.module.inputPorts.length + pl.module.outputPorts.length;
        if (pl.module.supply?.mode === "tap") {
          // 트렁크: 모듈 안에 belt 가 있고, 경계 포트는 **줄당 하나**로 접힌다.
          expect(belts, `${pl.id}: 탭인데 트렁크 belt 가 없다`).toBeGreaterThan(0);
          expect(ports, `${pl.id}: 탭인데 포트가 줄 수가 아니다`).toBe(lines);
        } else {
          // 다이렉트(1:1): 모듈 안 belt 0, 포트 = 머신 × 줄.
          expect(belts, `${pl.id}: 다이렉트인데 belt 가 있다`).toBe(0);
          expect(ports, `${pl.id}: 다이렉트인데 포트가 머신×줄 이 아니다`).toBe(
            pl.module.machines.length * lines,
          );
        }
      }
    });
  }
});
