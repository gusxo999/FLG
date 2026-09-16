/**
 * 공급 보장 — 사용자가 정한 우선순위 두 가지를 **공급 방식과 무관하게** 못박는다
 * (docs/auto-layout/module/trunk-redesign.md §7).
 *
 *   ① 머신이 온전히 작동한다 — 모든 머신이 모든 재료를 받고 산출물을 내보낸다.
 *      = (머신, 줄) 마다 인서터가 **정확히 하나** 머신에 붙어 있고, 그 인서터가 손을
 *        뻗는 바깥 칸이 벨트이거나 상자다(허공이 아니다).
 *   ② 머신 ↔ perimeter ring 라우팅이 보장된다 — 모든 포트가 밖으로 나간다.
 *      = 납품 경로로 이어졌거나(belt), perimeter 로 재배치됐다. 실패·skip 0.
 *
 * **이 둘은 [탭 인서팅](../../../../docs/용어사전.md)(트렁크)이든 다이렉트 인서팅(1:1)이든
 * 똑같이 성립해야 한다** — 그래서 여기 검사는 공급 방식을 묻지 않는다. 방식에 따라 갈리는
 * 것(모듈 안 belt 유무, 경계 포트 수)만 `supply.mode` 로 갈라 확인한다.
 *
 * ⚠ 파일명(`oneToOneGuarantee`)은 1:1 만 있던 시절의 잔재다 — 지금은 두 방식을 다 덮는다.
 */
import { describe, it, expect } from "vitest";
import { packModuleTree } from "../tree/build";
import type { NodeSpec, PackConfig } from "../tree/types/pack";
import { routeDeliveryRoutes } from "../link/build";
import { rePathToPerimeter } from "../perimeter/late";
import { cellKey } from "../shared/grid";
import { EntityType } from "../../types/layout";
import type { IoLine } from "../module/types/line";
import type { Container, PlacedCell } from "../shared/types";

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

/**
 * 벨트/인서터는 **이름과 저울이 함께** 온다 — 이름만 주고 처리량을 0 으로 두면 줄 수를
 * 못 정해 한 줄도 안 깔린다(2026-08-24). 바닐라 노랑 벨트 15/s, 일반 인서터 0.83/s,
 * 긴팔 0.83/s 를 그대로 쓴다.
 */
const config: PackConfig = {
  inserterEntityName: "inserter",
  inserters: [
    { entityName: "inserter", reach: 1, throughput: 0.83 },
    { entityName: "long-handed-inserter", reach: 2, throughput: 0.83 },
  ],
  beltEntityName: "transport-belt",
  belts: [{ entityName: "transport-belt", throughput: 15 }],
  reservePerimeterExits: true,
  beltMaxUndergroundDistance: UNDERGROUND.beltMaxUndergroundDistance,
};

/**
 * **줄마다 초당 얼마가 흐르나** — 이름만 있고 저울이 없으면 줄 수를 못 정해 한 줄도 안
 * 깔린다(2026-08-24, `makeLink` 폴백 삭제 후 드러남). 세 불변이 검사의 전제다:
 *
 *  - **간선 양끝이 같은 수** — 자식의 산출 rate = 부모의 수요 rate. 어긋나면 부모 머신
 *    일부에 그 줄이 안 닿아 검사 ①(줄마다 인서터 하나)이 깨지는 게 **옳은** 동작이다.
 *  - 머신 한 대가 한 줄에서 받는 몫 ≤ 팔 하나(0.83/s) — 그래야 인서터가 줄마다 하나다.
 *    간선 줄의 자식 쪽 몫은 `PER_MACHINE × 부모수 / 자식수` 라 비율이 가장 나쁜
 *    6/4/2(=3배)에서도 0.75/s 로 팔 하나 안에 든다.
 *  - 클러스터 합 ≤ 벨트 한 줄(15/s) — 그래야 한 품목이 한 줄이다.
 */
const PER_MACHINE = 0.25;
/** 간선 줄(자식이 부모에게 주는 품목) — 양끝이 이 이름으로 같은 rate 를 본다. */
const EDGE_ITEM = { n1: "kr-components", n2: "electronic-circuit" } as const;

const mk = (c0: number, c1: number, c2: number): NodeSpec[] => {
  const specs: NodeSpec[] = [
    { id: "n0", depth: 0, machine: M, count: c0, lines: [inL("copper-cable", 4), inL("electronic-circuit", 2), inL("kr-components", 2), outL("advanced-circuit", 1)] },
    { id: "n1", depth: 1, parentId: "n0", machine: M, count: c1, lines: [inL("plastic-bar", 4), inL("kr-silicon", 2), inL("kr-glass", 2), outL("kr-components", 4)] },
    { id: "n2", depth: 1, parentId: "n0", machine: M, count: c2, lines: [inL("copper-cable", 3), inL("stone-tablet", 1), outL("electronic-circuit", 2)] },
  ];
  const edgeRate = PER_MACHINE * c0; // 부모(n0)의 수요가 간선 rate 를 정한다.
  return specs.map((s) => ({
    ...s,
    supplyCapacity: {
      beltCapacity: 15,
      lineRates: new Map(
        s.lines.map((l) => {
          const isEdge =
            (s.id === "n0" && l.role === "input" && (Object.values(EDGE_ITEM) as string[]).includes(l.name)) ||
            (s.id !== "n0" && l.role === "output");
          return [`${l.role}:${l.name}`, isEdge ? edgeRate : PER_MACHINE * s.count];
        }),
      ),
    },
  }));
};

const COUNTS: [number, number, number][] = [
  [1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 2], [6, 4, 2], [8, 6, 4], [3, 2, 5],
];

/** 파이프라인 한 판 — pack → delivery → perimeter, 그리고 최종 셀 맵. */
function run(specs: NodeSpec[]) {
  const pack = packModuleTree(specs, config);
  const delivery = routeDeliveryRoutes(pack, { beltEntityName: "transport-belt", ...UNDERGROUND });
  const perim = rePathToPerimeter(pack, delivery.strippedChestIds, delivery.cells, {
    beltEntityName: "transport-belt",
    inserterEntityName: "inserter",
  });

  // `run/emit` 과 동형으로 최종 셀 맵을 합성한다: 모듈 셀 − 떼어낸 것 + 납품 경로 + 반출.
  const dropped = new Set([...delivery.strippedCellKeys, ...perim.droppedCellKeys]);
  const grid = new Map<string, PlacedCell>();
  for (const pl of pack.placements)
    for (const c of pl.module.cells) {
      const k = cellKey(c.x, c.y);
      if (!dropped.has(k)) grid.set(k, c);
    }
  for (const c of [...delivery.cells, ...perim.addedCells]) grid.set(cellKey(c.x, c.y), c);

  return { pack, delivery, perim, grid };
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
          // (일반=1칸 = 가까운 깊이, 긴팔=2칸 = 먼 깊이). 거기 벨트나 상자가 있어야 한다 —
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

    it(`${tag} — ② 모든 포트가 밖으로 나간다 (납품 경로 실패 0 · 반출 skip 0)`, () => {
      const { pack, delivery, perim } = run(mk(c0, c1, c2));
      expect(delivery.failures, "납품 경로 실패").toBe(0);
      expect(perim.skipped, `반출 skip — ${perim.reason ?? "-"}`).toBe(0);

      // 짝지어진 포트(납품 경로) + 반출된 포트 = 전체 포트. 남는 포트가 없어야 한다.
      const total = pack.placements.reduce(
        (n, pl) => n + pl.module.inputPorts.length + pl.module.outputPorts.length,
        0,
      );
      expect(delivery.strippedChestIds.size + perim.relocated).toBe(total);
    });

    it(`${tag} — 모든 포트가 자기 나가는 방향으로 나갈 수 있다 (moduleWayOuts ∋ face)`, () => {
      const { pack } = run(mk(c0, c1, c2));
      for (const pl of pack.placements)
        for (const p of [...pl.module.inputPorts, ...pl.module.outputPorts])
          expect(p.moduleWayOuts, `${p.chest.id}: 자기 face(${p.face})가 막혔다`).toContain(p.face);
    });

    it(`${tag} — 공급 형태가 기하와 일치한다 (모듈 안 belt 유무 ↔ 포트 수)`, () => {
      // **모듈 라벨(`supply.mode`)이 사라졌다**(2026-09-02). 이젠 한 모듈 안에서도 줄마다
      // `g` 가 다를 수 있어(부분 트렁크) *탭이다/다이렉트다* 라는 라벨로는 기하를 못 말한다.
      // 대신 **관측되는 둘이 묶여 있다**: 기둥을 훑는 belt 가 생기는 것과 포트가 접히는 것은
      // **같은 사실의 두 얼굴**이다 — `g > 1` 인 줄이 하나라도 있으면 둘 다 참이다.
      const { pack } = run(mk(c0, c1, c2));
      const spec = new Map(mk(c0, c1, c2).map((s) => [s.id, s]));
      for (const pl of pack.placements) {
        const lines = spec.get(pl.id)!.lines.filter((l) => l.kind === "belt").length;
        const belts = pl.module.cells.filter((c) => c.cell.entityType === EntityType.Belt).length;
        const ports = pl.module.inputPorts.length + pl.module.outputPorts.length;
        const all = pl.module.machines.length * lines;
        // 어떤 형태든 **줄마다 포트는 하나 이상** · **머신마다 하나 이하**다.
        expect(ports, `${pl.id}: 포트가 줄 수보다 적다`).toBeGreaterThanOrEqual(lines);
        expect(ports, `${pl.id}: 포트가 머신×줄을 넘는다`).toBeLessThanOrEqual(all);
        // 머신이 한 대면 `g = 1` 과 `g = N` 이 **같은 기하**라 갈라볼 것이 없다 —
        // 위 두 부등식이 이미 `ports === lines` 로 조이고 있다.
        if (pl.module.machines.length < 2) continue;
        if (belts === 0) {
          // belt 가 없다 = 모든 줄이 `g = 1` — 머신마다 자기 상자다.
          expect(ports, `${pl.id}: belt 가 없는데 포트가 머신×줄이 아니다`).toBe(all);
        } else {
          // belt 가 있다 = `g > 1` 인 줄이 있다 — 그만큼 포트가 접혔야 한다.
          expect(ports, `${pl.id}: belt 가 있는데 포트가 안 접혔다`).toBeLessThan(all);
        }
      }
    });
  }
});
