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
const outFluid = (name: string): IoLine => ({ name, kind: "pipe", role: "output" });

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

// ─────────────────────────────────────────────────────────────────────────────
// pipeJumpToClusterPipe — 좌석을 살리는 점프 방출 (docs/용어사전.md §D)
//
//   머신 | d1 fluidboxPipeCell | d2.. 벨트(지하 통과) | ClusterPipeTapCell | ClusterPipe
//
// 지하파이프 direction = 지상 입구가 향하는 방향(표면 연결 측):
//  - fluidboxPipeCell(x3): 표면이 머신 유체 상자를 향한다 → W(12).
//  - ClusterPipeTapCell: 표면이 바깥 ClusterPipe 를 향한다 → E(4). ClusterPipe 보다 1칸
//    안쪽 — 지하파이프는 지하 방향으로만 합류해서, 줄 위에 앉으면 세로 연속이 끊긴다.
// ─────────────────────────────────────────────────────────────────────────────

/** plasticBar + 점프 재료(상자 칸 위치 + 지하파이프). fluidboxOffset 기본 0(머신 첫 행). */
function plasticBarJump(
  count: number,
  opts?: { longInserter?: boolean; fluidboxOffset?: number },
): ModuleInput {
  const base = plasticBar(count);
  return {
    ...base,
    longInserter:
      opts?.longInserter === false
        ? undefined
        : { entityName: "long-handed-inserter", reach: 2 },
    fluidTrunk: {
      ...base.fluidTrunk!,
      fluidboxOffset: opts?.fluidboxOffset ?? 0,
      undergroundPipeEntityName: "pipe-to-ground",
      pipeMaxUndergroundDistance: 10,
    },
  };
}

describe("pipeJumpToClusterPipe — 점프 방출 기하", () => {
  // 3×3 머신이 x=0..2. E 면 depth d → x = 2 + d.
  // 벨트: coal 이 가까운 벨트(d2, x4). ClusterPipe = 벨트 최대 깊이+2 = d4(x6), 탭 = d3(x5).

  it("좌석이 살아난다 — coal 이 케이스 B(d4·긴팔)가 아니라 가까운 벨트(d2·일반)로", () => {
    const mod = generateModule(plasticBarJump(3));
    expect(mod.supply?.mode).toBe("tap");
    expect(mod.unroutedLines).toHaveLength(0);
    const coal = mod.inputPorts.find((p) => p.line.name === "coal")!;
    expect(coal.meta.laneDepth).toBe(2);
    expect(coal.meta.inserter).toBe("normal");
    // 탭 인서터가 depth 1(x3)에 앉는다 — 옛 스파인에선 그 자리가 파이프라 불가능했다.
    for (const m of mod.machines) {
      const seat = cellAt(mod, 3, m.origin.y + 1); // 상자 행(offset 0)을 건너뛴 첫 좌석 행
      expect(seat?.entityType).toBe(EntityType.Inserter);
      expect(seat?.entityName).toBe("inserter"); // reach 1 — 긴팔이 아니다
    }
  });

  it("머신마다 fluidboxPipeCell(d1, 표면=머신쪽 W) + ClusterPipeTapCell(표면=바깥 E)", () => {
    const mod = generateModule(plasticBarJump(3));
    for (const m of mod.machines) {
      const row = m.origin.y + 0; // fluidboxOffset 0 — 각 머신의 자기 상자 행
      const box = cellAt(mod, 3, row); // d1
      expect(box?.entityType).toBe(EntityType.PipeUnderground);
      expect(box?.entityName).toBe("pipe-to-ground");
      expect(box?.direction).toBe(12); // 표면이 머신 유체 상자를 향한다(W)

      const tap = cellAt(mod, 5, row); // d3 = ClusterPipe(d4) 1칸 안쪽
      expect(tap?.entityType).toBe(EntityType.PipeUnderground);
      expect(tap?.direction).toBe(4); // 표면이 ClusterPipe 를 향한다(E)
    }
  });

  it("ClusterPipe 는 벨트 바깥(d4)에 일반 파이프 세로줄 — 좌석 줄(d1)엔 스파인이 없다", () => {
    const mod = generateModule(plasticBarJump(3));
    for (const m of mod.machines) {
      for (let dy = 0; dy < m.size.h; dy++) {
        const row = m.origin.y + dy;
        // ClusterPipe 본체(x6) — 기둥 전체를 세로로 잇는 일반 파이프.
        expect(cellAt(mod, 6, row)?.entityType).toBe(EntityType.Pipe);
        // 옛 스파인 자리(x3, d1)는 상자 행만 지하파이프, 나머지는 좌석(인서터)이거나 빈 칸 —
        // **일반 파이프가 아니다**(스파인이 사라졌다는 물리적 증거).
        expect(cellAt(mod, 3, row)?.entityType).not.toBe(EntityType.Pipe);
      }
      // coal 벨트(d2, x4)가 상자 행 위도 그대로 지나간다 — 지하 통과라 안 부딪힌다.
      expect(cellAt(mod, 4, m.origin.y)?.entityType).toBe(EntityType.Belt);
    }
  });

  it("유체 포트는 ClusterPipe 끝의 무한파이프 — laneDepth 가 실제 깊이(d4)", () => {
    const mod = generateModule(plasticBarJump(3));
    const gas = mod.inputPorts.find((p) => p.line.name === "petroleum-gas")!;
    expect(gas.chest.kind).toBe("infinity-pipe");
    expect(gas.meta.laneDepth).toBe(4);
    // 포트 계약 불변: anchor − 2·ev = tapAnchor(트렁크 끝), 가운데는 파이프.
    const ev = { x: gas.anchor.x - gas.tapAnchor.x, y: gas.anchor.y - gas.tapAnchor.y };
    expect(Math.abs(ev.x) + Math.abs(ev.y)).toBe(2);
    const mid = { x: gas.tapAnchor.x + ev.x / 2, y: gas.tapAnchor.y + ev.y / 2 };
    expect(cellAt(mod, mid.x, mid.y)?.entityType).toBe(EntityType.Pipe);
  });

  it("긴팔 없이도(reach {1}) 유체 레시피가 탭 인서팅으로 선다 — 케이스 B 의존 제거", () => {
    // 옛 모델: 케이스 B 는 긴팔 전용 → 긴팔 없으면 E 면 벨트 0 → complex → 다이렉트조차
    // 유체 불가(fluid-requires-trunk-pipe). 점프 모드가 이 계급을 통째로 구한다.
    const mod = generateModule(plasticBarJump(3, { longInserter: false }));
    expect(mod.supply?.mode).toBe("tap");
    expect(mod.unroutedLines).toHaveLength(0);
  });

  it("fluidboxOffset 이 중간 행이면 좌석이 그 행을 건너뛰고 앉는다", () => {
    const mod = generateModule(plasticBarJump(2, { fluidboxOffset: 1 }));
    for (const m of mod.machines) {
      // 상자 행 = origin.y+1 → 지하파이프. 좌석(coal, slot 0)은 remap 없이 행 0.
      expect(cellAt(mod, 3, m.origin.y + 1)?.entityType).toBe(EntityType.PipeUnderground);
      expect(cellAt(mod, 3, m.origin.y + 0)?.entityType).toBe(EntityType.Inserter);
    }
  });

  it("지하파이프가 없으면(점프 불가) 옛 스파인으로 폴백 — 연속적 저하", () => {
    // plasticBar(원본 픽스처)는 fluidboxOffset/지하파이프가 없다 → 위 기존 describe 전체가
    // 그 폴백의 회귀 테스트다. 여기선 "거리 0" 케이스만 짚는다.
    const input = plasticBarJump(3);
    input.fluidTrunk!.pipeMaxUndergroundDistance = 0;
    const mod = generateModule(input);
    expect(mod.supply?.mode).toBe("tap");
    // 스파인 복귀: E 면 d1(x3)이 전부 일반 파이프, coal 은 케이스 B(d4·긴팔).
    for (const m of mod.machines) {
      expect(cellAt(mod, 3, m.origin.y)?.entityType).toBe(EntityType.Pipe);
    }
    const coal = mod.inputPorts.find((p) => p.line.name === "coal")!;
    expect(coal.meta.laneDepth).toBe(4);
    expect(coal.meta.inserter).toBe("long");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 유체 출력 반출 (docs/auto-layout-wizard.fluid-hop.md) — 머신 유체 산출 → 무한파이프
// ─────────────────────────────────────────────────────────────────────────────

/** 아이템 입력(coal) + 유체 출력(petroleum-gas). 출력 유체는 W 면(부모 쪽). 3×3. */
function fluidOut(count: number): ModuleInput {
  return {
    machine: { entityName: "chemical-plant", w: 3, h: 3 },
    count,
    lines: [inItem("coal"), outFluid("petroleum-gas")],
    inserterEntityName: "inserter",
    beltEntityName: "transport-belt",
    longInserter: { entityName: "long-handed-inserter", reach: 2 },
    fluidTrunk: {
      direction: 12, // W 면을 보게(테스트 픽스처 — 실제는 chooseMachineDirection 이 고름)
      side: "W",
      pipeEntityName: "pipe",
      fluidboxOffset: 0,
      undergroundPipeEntityName: "pipe-to-ground",
      pipeMaxUndergroundDistance: 10,
    },
  };
}

describe("유체 출력 반출 — 머신 유체 → 무한파이프", () => {
  it("탭으로 서고, 유체 출력 포트가 무한파이프다", () => {
    const mod = generateModule(fluidOut(3));
    expect(mod.supply?.mode).toBe("tap");
    expect(mod.unroutedLines).toHaveLength(0);
    const gas = mod.outputPorts.find((p) => p.line.name === "petroleum-gas")!;
    expect(gas.chest.kind).toBe("infinity-pipe");
    expect(gas.meta.side).toBe("W"); // 출력 유체 = 부모 쪽 면
    // 유체 포트엔 인서터가 없다 — 포트 끝이 파이프.
    const ev = { x: gas.anchor.x - gas.tapAnchor.x, y: gas.anchor.y - gas.tapAnchor.y };
    const mid = { x: gas.tapAnchor.x + ev.x / 2, y: gas.tapAnchor.y + ev.y / 2 };
    expect(cellAt(mod, mid.x, mid.y)?.entityType).toBe(EntityType.Pipe);
  });

  it("coal 입력은 반대 면(E)에 벨트로 — 유체와 아이템이 안 다툰다", () => {
    const mod = generateModule(fluidOut(3));
    const coal = mod.inputPorts.find((p) => p.line.name === "coal")!;
    expect(coal.meta.side).toBe("E");
    expect(coal.chest.kind).toBe("infinity-chest");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 유체 관문 — **planner 가 아니라 generateModule 이 판정한다**(2026-07-24).
//
// 유체 줄의 면은 머신 fluid_box 가 강제하므로(fluidTrunk.side) planner 에 보내지 않고
// generateModule 이 직접 [PlannedLine] 을 만든다. 그래서 "유체가 자리를 못 잡는" 세 경우의
// 판정도 여기로 옮겨 왔다 — 예전엔 planClusterPorts 가 complex 로 냈다(pipe-side-unresolved
// · fluid-requires-trunk-pipe · multi-fluid-not-supported).
//
// 셋 다 결과는 같다: **유체는 트렁크(tap)로만 성립하므로 통째로 정직히 실패**한다.
// 반만 놓으면 유체를 못 받는 머신이 조용히 굶는다.
// ─────────────────────────────────────────────────────────────────────────────
describe("유체 관문 — 자리를 못 잡으면 통째로 정직히 실패", () => {
  it("fluidTrunk 가 없으면(회전 미해결) 전부 unrouted — 면을 지어내지 않는다", () => {
    const { fluidTrunk: _drop, ...noTrunk } = plasticBar(3);
    const mod = generateModule(noTrunk as ModuleInput);
    expect(mod.unroutedLines.map((l) => l.name).sort()).toEqual(
      ["coal", "petroleum-gas", "plastic-bar"].sort(),
    );
    expect(mod.inputPorts).toHaveLength(0);
    expect(mod.outputPorts).toHaveLength(0);
  });

  it("유체가 둘이면 전부 unrouted — v1 은 모듈당 유체 한 줄", () => {
    const base = plasticBar(3);
    const mod = generateModule({ ...base, lines: [...base.lines, inFluid("water")] });
    expect(mod.unroutedLines.map((l) => l.name)).toContain("water");
    expect(mod.unroutedLines.map((l) => l.name)).toContain("petroleum-gas");
    expect(mod.outputPorts).toHaveLength(0);
  });

  it("아이템이 탭에 못 서면(다이렉트) 유체까지 전부 unrouted — 유체는 다이렉트가 없다", () => {
    // 긴팔이 없으면 파이프 면(E)은 케이스 B 를 못 써 아이템 벨트가 0줄 → W 한 줄에 3줄을
    // 못 담아 탭이 깨진다. 아이템만이면 다이렉트로 물러나면 그만이지만, 유체는 인서터로
    // 못 옮기므로 다이렉트가 아예 없다 → 이 모듈은 통째로 옛 경로로 넘어가야 한다.
    const base = plasticBar(3);
    const mod = generateModule({
      ...base,
      longInserter: undefined,
      lines: [...base.lines, inItem("iron-plate")],
    });
    expect(mod.supply?.mode).toBe("direct");
    expect(mod.unroutedLines.map((l) => l.name)).toContain("petroleum-gas");
    expect(mod.outputPorts).toHaveLength(0);
  });
});
