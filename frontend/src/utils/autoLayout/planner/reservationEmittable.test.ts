/**
 * 예약 불변식 — **예약된 반출 경로는 탐색 없이 항상 방출 가능하다.**
 *
 * 채널 기하 예약의 철학(docs/auto-layout-wizard.channel-geometry-reservation.md §1):
 * "충돌은 계획 시점에 전부 보이고, 해소도 계획 시점에 끝난다 — 탐색은 최후 폴백."
 * 예전엔 planPerimeterLanes 가 `meta.side` 만 보고 배정해서, 코너 어깨 상자처럼 그 방향이
 * **형제 트렁크에 막힌** 경우에도 못 쓰는 채널 우회를 예약했다. 그래서 방출 단계가 탐색
 * (routeAuto)으로 우회해야 했고 — 예약한 채널 트랙은 아무도 안 써서 **폭만 낭비**됐다.
 *
 * 지금은 모듈이 [ModulePort.moduleWayOuts] 로 "몸통에 안 막히는 방향"을 답해주고, 예약이
 * 그 방향만 고른다. 그래서 **hint(예약) 재생만으로 전부 방출**되어야 하고, 방출기에 탐색
 * 폴백이 없다. 이 테스트가 그 불변식을 못박는다 — 깨지면 예약이 거짓말을 하고 있는 것이다.
 *
 * 여기서 보는 건 **예약이 방출 가능한가**뿐이다. 실제 재배치 결과(skip 0)는
 * [oneToOneGuarantee](./oneToOneGuarantee.test.ts) 의 `② 모든 포트가 밖으로 나간다` 가
 * 같은 트리·같은 count 로 이미(그리고 더 세게 — 포트 총량까지) 못 박고 있다.
 */
import { describe, it, expect } from "vitest";
import { packModuleTree, moduleExtent, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeModuleHops } from "./moduleHop";
import { routePortToPerimeter } from "./perimeterRouter";
import { cellKey } from "../util/helper";
import type { IoLine } from "../module/clusterPortPlanner";

const inL = (n: string, a: number): IoLine => ({ name: n, kind: "belt", role: "input", amount: a });
const outL = (n: string, a: number): IoLine => ({ name: n, kind: "belt", role: "output", amount: a });
const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

/** production(moduleWizard)과 **같은** 지하벨트 설정. 안 주면 홉이 지상으로만 풀려 배치가 달라진다. */
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

/** advanced-circuit 동형 분기 트리 — count 를 키우면 코너 어깨 상자가 생긴다. */
const mk = (c0: number, c1: number, c2: number): NodeSpec[] => [
  { id: "n0", depth: 0, machine: M, count: c0, lines: [inL("copper-cable", 4), inL("electronic-circuit", 2), inL("kr-components", 2), outL("advanced-circuit", 1)] },
  { id: "n1", depth: 1, parentId: "n0", machine: M, count: c1, lines: [inL("plastic-bar", 4), inL("kr-silicon", 2), inL("kr-glass", 2), outL("kr-components", 4)] },
  { id: "n2", depth: 1, parentId: "n0", machine: M, count: c2, lines: [inL("copper-cable", 3), inL("stone-tablet", 1), outL("electronic-circuit", 2)] },
];

const COUNTS: [number, number, number][] = [
  [1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 2], [6, 4, 2], [8, 6, 4], [3, 2, 5],
];

describe("예약 불변식 — 탐색 없이 방출 가능", () => {
  for (const [c0, c1, c2] of COUNTS) {
    it(`${c0}/${c1}/${c2} — 예약(hint) 재생만으로 모든 상자가 방출된다`, () => {
      const pack = packModuleTree(mk(c0, c1, c2), config);
      const hop = routeModuleHops(pack, { beltEntityName: "transport-belt", ...UNDERGROUND });
      expect(hop.failures).toBe(0);

      // modulePerimeterPass 와 동형의 occ/perimeter 재현.
      const occ = new Set<string>();
      for (const pl of pack.placements) {
        for (const m of pl.module.machines)
          for (let dx = 0; dx < m.size.w; dx++)
            for (let dy = 0; dy < m.size.h; dy++) occ.add(cellKey(m.origin.x + dx, m.origin.y + dy));
        for (const c of pl.module.cells) occ.add(cellKey(c.x, c.y));
      }
      for (const c of hop.cells) occ.add(cellKey(c.x, c.y));

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pl of pack.placements) {
        const e = moduleExtent(pl.module);
        minX = Math.min(minX, e.x); minY = Math.min(minY, e.y);
        maxX = Math.max(maxX, e.x + e.w - 1); maxY = Math.max(maxY, e.y + e.h - 1);
      }
      const perimeter = { minX: minX - 1, minY: minY - 1, maxX: maxX + 1, maxY: maxY + 1 };
      const asg = new Map(pack.lanePlan.assignments.map((a) => [a.id, a]));

      for (const pl of pack.placements)
        for (const p of [...pl.module.inputPorts, ...pl.module.outputPorts]) {
          if (hop.strippedChestIds.has(p.chest.id)) continue;
          const a = asg.get(p.chest.id);
          expect(a, `${p.chest.id} 에 배정이 없다`).toBeDefined();

          // ① 배정된 출구의 모듈 진출 방향은 반드시 wayOuts 안에 있다.
          expect(p.moduleWayOuts, `${p.chest.id} 배정이 막힌 방향을 골랐다`).toContain(a!.options[0].wayOut);

          // ② 그 배정을 그대로 재생하면(탐색 없이) 반드시 방출된다.
          const r = routePortToPerimeter({
            anchor: { x: p.anchor.x, y: p.anchor.y },
            face: p.face,
            perimeter,
            obstacles: occ,
            hint: { exitEdge: a!.exitEdge, host: a!.host, laneX: a!.laneX },
          });
          expect(r.ok, `${p.chest.id}: 예약이 방출 불가 — ${r.ok ? "" : r.reason}`).toBe(true);
        }
    });
  }

  it("안 쓸 출구를 위해 채널을 넓히지 않는다 — 예약된 채널 트랙은 전부 실제로 쓰인다", () => {
    // 코너 어깨 상자(copper-cable)는 E 가 형제 트렁크에 막혀 채널을 못 쓴다.
    // 옛 코드는 그래도 채널 트랙을 예약해 폭만 먹었다. 이제는 채널을 예약한 상자가
    // **정말로 채널로 나가는 상자뿐**이어야 한다.
    const pack = packModuleTree(mk(4, 4, 2), config);
    for (const a of pack.lanePlan.assignments) {
      if (a.host.kind !== "channel") continue;
      // 채널을 예약했다면, 그 채널로 들어가는 진출 방향(W/E)이 실제로 뚫려 있어야 한다.
      const port = pack.placements
        .flatMap((pl) => [...pl.module.inputPorts, ...pl.module.outputPorts])
        .find((p) => p.chest.id === a.id)!;
      expect(port.moduleWayOuts, `${a.id} 가 못 쓰는 채널을 예약했다`).toContain(a.options[0].wayOut);
    }
  });
});
