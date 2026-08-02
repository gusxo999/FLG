import { describe, it, expect } from "vitest";
import { generateModule, type GeneratedModule, type ModulePort } from "./clusterModule";
import type { IoLine } from "../planner/module/clusterPortPlanner";
import type { PortFace } from "../containerModel";

const inL = (name: string, amount?: number): IoLine => ({ name, kind: "belt", role: "input", amount });
const outL = (name: string, amount?: number): IoLine => ({ name, kind: "belt", role: "output", amount });

function mod(count: number, lines: IoLine[]): GeneratedModule {
  return generateModule({
    idPrefix: "m",
    machine: { entityName: "assembling-machine-3", w: 3, h: 3 },
    count,
    lines,
    inserterEntityName: "inserter",
    beltEntityName: "transport-belt",
    longInserter: { entityName: "long-handed-inserter", reach: 2 },
  });
}

const FV: Record<PortFace, { x: number; y: number }> = {
  N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 },
};

/**
 * 독립 재계산 — 모듈 몸통(머신+셀)에서 직접 ray 를 쏴 wayOuts 를 다시 구한다.
 * 구현과 다른 경로로 같은 답이 나와야 한다(구현 자기참조 방지).
 */
function recomputeWayOuts(m: GeneratedModule, port: ModulePort): PortFace[] {
  const occ = new Set<string>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const mark = (x: number, y: number) => {
    occ.add(`${x},${y}`);
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const mc of m.machines)
    for (let dx = 0; dx < mc.size.w; dx++)
      for (let dy = 0; dy < mc.size.h; dy++) mark(mc.origin.x + dx, mc.origin.y + dy);
  for (const c of m.cells) mark(c.x, c.y);

  const out: PortFace[] = [];
  for (const f of ["N", "E", "S", "W"] as PortFace[]) {
    const v = FV[f];
    let x = port.anchor.x + v.x, y = port.anchor.y + v.y, clear = true;
    while (x >= minX && x <= maxX && y >= minY && y <= maxY) {
      if (occ.has(`${x},${y}`)) { clear = false; break; }
      x += v.x; y += v.y;
    }
    if (clear) out.push(f);
  }
  return out;
}

describe("moduleWayOuts — 포트가 모듈 몸통을 벗어날 수 있는 방향", () => {
  const cases: { name: string; count: number; lines: IoLine[] }[] = [
    { name: "count=1 · 입력3", count: 1, lines: [inL("a", 4), inL("b", 2), inL("c", 2), outL("z", 1)] },
    { name: "count=2 · 입력3", count: 2, lines: [inL("a", 4), inL("b", 2), inL("c", 2), outL("z", 1)] },
    { name: "count=4 · 입력3", count: 4, lines: [inL("a", 4), inL("b", 2), inL("c", 2), outL("z", 1)] },
    { name: "count=3 · 입력2", count: 3, lines: [inL("a", 3), inL("b", 1), outL("z", 2)] },
  ];

  for (const c of cases) {
    it(`${c.name} — 모든 포트의 wayOuts 가 독립 재계산과 일치`, () => {
      const m = mod(c.count, c.lines);
      const ports = [...m.inputPorts, ...m.outputPorts];
      expect(ports.length).toBeGreaterThan(0);
      for (const p of ports) {
        expect(p.moduleWayOuts, `port ${p.chest.id}`).toEqual(recomputeWayOuts(m, p));
      }
    });

    it(`${c.name} — 막힌 방향은 실제로 모듈 셀에 막혀 있다`, () => {
      const m = mod(c.count, c.lines);
      const occ = new Set(m.cells.map((x) => `${x.x},${x.y}`));
      for (const mc of m.machines)
        for (let dx = 0; dx < mc.size.w; dx++)
          for (let dy = 0; dy < mc.size.h; dy++) occ.add(`${mc.origin.x + dx},${mc.origin.y + dy}`);
      for (const p of [...m.inputPorts, ...m.outputPorts]) {
        for (const f of ["N", "E", "S", "W"] as PortFace[]) {
          if (p.moduleWayOuts.includes(f)) continue;
          // 막혔다고 했으면, 그 방향 어딘가에 실제 모듈 셀이 있어야 한다.
          const v = FV[f];
          let hit = false;
          for (let i = 1; i <= 64; i++) {
            if (occ.has(`${p.anchor.x + v.x * i},${p.anchor.y + v.y * i}`)) { hit = true; break; }
          }
          expect(hit, `${p.chest.id} 의 ${f} 가 막혔다는데 장애물이 없다`).toBe(true);
        }
      }
    });
  }

  it("포트는 최소 한 방향으로는 나갈 수 있다 (고립된 상자 없음)", () => {
    for (const c of cases) {
      const m = mod(c.count, c.lines);
      for (const p of [...m.inputPorts, ...m.outputPorts])
        expect(p.moduleWayOuts.length, `${c.name} / ${p.chest.id} 고립`).toBeGreaterThan(0);
    }
  });

  it("자기 face 방향은 항상 나갈 수 있다 (상자는 face 쪽으로 열려 있다)", () => {
    for (const c of cases) {
      const m = mod(c.count, c.lines);
      for (const p of [...m.inputPorts, ...m.outputPorts])
        expect(p.moduleWayOuts, `${c.name} / ${p.chest.id} face=${p.face}`).toContain(p.face);
    }
  });
});
