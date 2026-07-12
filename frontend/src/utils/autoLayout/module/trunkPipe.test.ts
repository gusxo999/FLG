/**
 * 트렁크 파이프 — 방출 기하 검증.
 *
 * planner 가 자리를 **계획**해도 방출기가 다르게 깔면 소용없다. 여기서는 실제로 놓인 셀을
 * 보고 물리가 성립하는지 확인한다:
 *   ① 파이프가 **모든 머신의 유체 입구 칸**에 닿는가 (닿지 않으면 그 머신은 굶는다)
 *   ② 파이프 면의 depth 1 에 **인서터가 없는가** (있으면 파이프와 자리를 다툰다)
 *   ③ 케이스 B — 아이템 인서터가 depth 2 에 앉아 depth 4 의 벨트에서 집는가
 *   ④ 유체 포트는 무한**파이프**로 끝나는가 (무한상자가 아니라)
 *
 * → docs/auto-layout-wizard.trunk-pipe.md
 */
import { describe, it, expect } from "vitest";
import { generateModule, type ModuleInput } from "./clusterModule";
import type { IoLine } from "./clusterPortPlanner";
import { EntityType } from "../../../types/layout";

const inItem = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
const outItem = (name: string): IoLine => ({ name, kind: "belt", role: "output" });
const inFluid = (name: string): IoLine => ({ name, kind: "pipe", role: "input" });

/** 화학 공장 꼴: petroleum-gas(유체) + coal(아이템) → plastic-bar(아이템). 3×3, 3대. */
function plasticBar(count: number): ModuleInput {
  return {
    machine: { entityName: "chemical-plant", w: 3, h: 3 },
    count,
    lines: [inFluid("petroleum-gas"), inItem("coal"), outItem("plastic-bar")],
    inserterEntityName: "inserter",
    beltEntityName: "transport-belt",
    longInserter: { entityName: "long-handed-inserter", reach: 2 },
    fluidTrunk: { direction: 4, side: "E", pipeEntityName: "pipe" },
  };
}

/** 모듈이 놓은 셀을 좌표로 조회. */
function cellAt(mod: ReturnType<typeof generateModule>, x: number, y: number) {
  return mod.cells.find((c) => c.x === x && c.y === y)?.cell;
}

describe("트렁크 파이프 — 방출 기하", () => {
  it("탭 인서팅으로 판정되고, 머신이 회전한다", () => {
    const mod = generateModule(plasticBar(3));
    expect(mod.supply?.mode).toBe("tap");
    expect(mod.unroutedLines).toHaveLength(0);
    // 유체 입구가 E 를 보게 하는 회전 — 아이템 전용 머신과 달리 direction 이 붙는다.
    for (const m of mod.machines) expect(m.direction).toBe(4);
  });

  it("① 파이프가 기둥 E 면 depth 1 을 직선으로 훑어 모든 머신에 닿는다", () => {
    const mod = generateModule(plasticBar(3));
    // 머신 3×3 이 x=0..2 에 세로로 3대 → E 면 depth 1 = x=3.
    const pipeX = 3;
    for (const m of mod.machines) {
      // 이 머신이 차지하는 모든 행에서 x=3 이 파이프여야 한다 — 그중 하나가 유체 입구다.
      for (let dy = 0; dy < m.size.h; dy++) {
        const cell = cellAt(mod, pipeX, m.origin.y + dy);
        expect(cell?.entityType, `머신 ${m.id} 행 ${m.origin.y + dy}`).toBe(EntityType.Pipe);
      }
    }
  });

  it("② 파이프 면의 depth 1 에는 인서터가 하나도 없다", () => {
    const mod = generateModule(plasticBar(3));
    const onPipeColumn = mod.cells.filter((c) => c.x === 3);
    expect(onPipeColumn.every((c) => c.cell.entityType !== EntityType.Inserter)).toBe(true);
  });

  it("③ 케이스 B — coal 인서터는 depth 2(x=4)에 앉고 벨트는 depth 4(x=6)에 깔린다", () => {
    const mod = generateModule(plasticBar(3));
    const coal = mod.inputPorts.find((p) => p.line.name === "coal")!;
    expect(coal.meta.laneDepth).toBe(4);
    expect(coal.meta.inserter).toBe("long");

    // 벨트는 x=6(= depth 4). 머신 행마다 깔려 있다.
    for (const m of mod.machines) {
      expect(cellAt(mod, 6, m.origin.y)?.entityType).toBe(EntityType.Belt);
    }
    // 탭 인서터(긴팔)는 x=4(= depth 2) — 파이프(x=3)를 넘어 x=6 에서 집는다.
    for (const m of mod.machines) {
      const seat = cellAt(mod, 4, m.origin.y);
      expect(seat?.entityType).toBe(EntityType.Inserter);
      expect(seat?.entityName).toBe("long-handed-inserter");
    }
  });

  it("④ 유체 포트는 무한파이프로 끝나고, 인서터가 끼지 않는다", () => {
    const mod = generateModule(plasticBar(3));
    const gas = mod.inputPorts.find((p) => p.line.name === "petroleum-gas")!;
    expect(gas.chest.kind).toBe("infinity-pipe");
    expect(gas.chest.entityName).toBe("infinity-pipe");

    // 포트 계약: anchor(무한파이프) ← anchor−ev(파이프) ← anchor−2·ev(트렁크 끝=tapAnchor).
    // 아이템이면 가운데가 인서터지만 유체는 **파이프**다 — 유체는 인서터로 못 옮긴다.
    const ev = { x: gas.anchor.x - gas.tapAnchor.x, y: gas.anchor.y - gas.tapAnchor.y };
    expect(Math.abs(ev.x) + Math.abs(ev.y)).toBe(2); // 정확히 2칸
    const mid = { x: gas.tapAnchor.x + ev.x / 2, y: gas.tapAnchor.y + ev.y / 2 };
    expect(cellAt(mod, mid.x, mid.y)?.entityType).toBe(EntityType.Pipe);
  });

  it("머신 수가 늘어도 파이프는 한 줄 — 포트는 품목당 1개", () => {
    for (const count of [1, 2, 5]) {
      const mod = generateModule(plasticBar(count));
      expect(mod.supply?.mode).toBe("tap");
      // 줄 수 = 3(유체 입력 + 아이템 입력 + 아이템 출력). 머신 수와 무관.
      expect(mod.inputPorts.length + mod.outputPorts.length).toBe(3);
      // 유체 포트는 늘 하나.
      expect(mod.chests.filter((c) => c.kind === "infinity-pipe")).toHaveLength(1);
    }
  });
});
