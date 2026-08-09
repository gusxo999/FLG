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
import type { IoLine } from "../planner/module/clusterPortPlanner";
import { EntityType } from "../../types/layout";
import { collectPipeFlow, pipeFlowConflict } from "../util/pipeFlow";

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
    fluidTrunk: {
      direction: 4,
      pipeEntityName: "pipe",
      lines: [{ name: "petroleum-gas", role: "input", side: "E", fluidboxOffset: 0, rank: 0, boxIndex: 0 }],
    },
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
      lines: base.fluidTrunk!.lines.map((l) => ({ ...l, fluidboxOffset: opts?.fluidboxOffset ?? 0 })),
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
// 유체 출력 반출 (docs/auto-layout-wizard.fluid-delivery.md) — 머신 유체 산출 → 무한파이프
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
      direction: 12, // W 면을 보게(테스트 픽스처 — 실제는 chooseFluidTrunkPlan 이 고름)
      pipeEntityName: "pipe",
      undergroundPipeEntityName: "pipe-to-ground",
      pipeMaxUndergroundDistance: 10,
      lines: [{ name: "petroleum-gas", role: "output", side: "W", fluidboxOffset: 0, rank: 0, boxIndex: 2 }],
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

  it("트렁크 계획이 못 덮는 유체 줄이 있으면 전부 unrouted — 반만 놓지 않는다", () => {
    // 여기 한때 *"유체가 둘이면 전부 unrouted — v1 은 모듈당 유체 한 줄"* 이 있었다.
    // 그 한계는 사라졌다(면당 여러 줄이 선다). 남은 사실은 **배정을 못 받은 줄**이다 —
    // `lines` 에 있는데 `fluidTrunk.lines` 가 안 덮으면 그 줄의 면·행을 지어낼 수 없다.
    const base = plasticBar(3);
    const mod = generateModule({ ...base, lines: [...base.lines, inFluid("water")] });
    expect(mod.unroutedLines.map((l) => l.name)).toContain("water");
    expect(mod.unroutedLines.map((l) => l.name)).toContain("petroleum-gas");
    expect(mod.outputPorts).toHaveLength(0);
  });

  it("아이템이 탭에 못 서도 **유체는 선다** — 기계별 포트로 물러날 뿐이다", () => {
    // 긴팔이 없으면 파이프 면(E)은 케이스 B 를 못 써 아이템 벨트가 0줄 → W 한 줄에 3줄을
    // 못 담아 탭이 깨진다. 예전엔 여기서 모듈이 통째로 실패했다 — 파이프 방출이 tap 가지
    // **안에만** 있어서 물러나는 순간 유체가 조용히 사라졌기 때문이다(`fluidNeedsTap`).
    // 이제 파이프는 갈래 밖에서 깔리므로, 아이템만 기계별 포트로 내려가고 유체는 그대로 선다.
    const base = plasticBar(3);
    const mod = generateModule({
      ...base,
      longInserter: undefined,
      lines: [...base.lines, inItem("iron-plate")],
    });
    expect(mod.supply?.mode).toBe("direct");
    expect(mod.unroutedLines).toHaveLength(0);
    // 유체 포트는 여전히 기둥에 **하나** — 파이프는 쪼개지지 않는다.
    const fluidPorts = mod.inputPorts.filter((p) => p.line.kind === "pipe");
    expect(fluidPorts).toHaveLength(1);
    expect(fluidPorts[0].chest.kind).toBe("infinity-pipe");
    // 아이템 포트는 **머신마다** — 그게 기계별 포트의 정의다.
    expect(mod.outputPorts.filter((p) => p.line.name === "plastic-bar")).toHaveLength(3);
    // 파이프 열(E d1 = x=3)에는 인서터가 없다 — 아이템이 그 면을 비켜 갔다.
    const onPipeColumn = mod.cells.filter((c) => c.x === 3);
    expect(onPipeColumn.every((c) => c.cell.entityType !== EntityType.Inserter)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 다중 유체 단계 A — **양 면이 동시에 유체 면**일 수 있다 (유체 입력 1 + 출력 1).
//
// 새 기하는 없다. 면 하나의 유체 기하를 그대로 쓰되, W 와 E 가 동시에 유체 면이 되는 것뿐이다.
// 두 면 사이에는 머신이 통째로 들어 있어 **어떤 머신 크기에서도 트렁크끼리 인접하지 않는다.**
// → docs/auto-layout/module/trunk-pipe.md §5
// ─────────────────────────────────────────────────────────────────────────────
describe("다중 유체 — 유체 입력(E) + 유체 출력(W) 동시", () => {
  /** 황산 꼴: 물(유체 입력) + 철판(아이템 입력) → 황산(유체 출력). */
  function bothFaces(count: number): ModuleInput {
    return {
      machine: { entityName: "chemical-plant", w: 3, h: 3 },
      count,
      lines: [inFluid("water"), inItem("iron-plate"), outFluid("sulfuric-acid")],
      inserterEntityName: "inserter",
      beltEntityName: "transport-belt",
      longInserter: { entityName: "long-handed-inserter", reach: 2 },
      fluidTrunk: {
        direction: 4,
        pipeEntityName: "pipe",
        undergroundPipeEntityName: "pipe-to-ground",
        pipeMaxUndergroundDistance: 10,
        lines: [
          { name: "water", role: "input", side: "E", fluidboxOffset: 0, rank: 0, boxIndex: 0 },
          { name: "sulfuric-acid", role: "output", side: "W", fluidboxOffset: 0, rank: 0, boxIndex: 2 },
        ],
      },
    };
  }

  it("유체 포트가 둘 다 선다 — 입력은 E, 출력은 W, 끝은 둘 다 무한파이프", () => {
    const mod = generateModule(bothFaces(3));
    expect(mod.unroutedLines).toEqual([]);

    const water = mod.inputPorts.find((p) => p.line.name === "water")!;
    const acid = mod.outputPorts.find((p) => p.line.name === "sulfuric-acid")!;
    expect(water.meta.side).toBe("E");
    expect(acid.meta.side).toBe("W");
    expect(water.chest.kind).toBe("infinity-pipe");
    expect(acid.chest.kind).toBe("infinity-pipe");
  });

  it("두 유체 트렁크는 서로 **닿지 않는다** — 사이에 머신이 통째로 들어 있다", () => {
    const mod = generateModule(bothFaces(3));
    const at = (f: string) => mod.pipeCells.filter((c) => c.fluid === f);
    const waterX = new Set(at("water").map((c) => c.x));
    const acidX = new Set(at("sulfuric-acid").map((c) => c.x));
    expect(waterX.size).toBeGreaterThan(0);
    expect(acidX.size).toBeGreaterThan(0);
    // 직교 인접이 하나도 없어야 한다(파이프는 닿기만 하면 한 관망이 된다).
    const key = (x: number, y: number) => `${x},${y}`;
    const acidSet = new Set(at("sulfuric-acid").map((c) => key(c.x, c.y)));
    for (const c of at("water")) {
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        expect(acidSet.has(key(c.x + dx, c.y + dy))).toBe(false);
      }
    }
  });

  it("pipeCells 가 **셀마다** 유체를 답한다 — 모듈 단위로는 답이 없다", () => {
    const mod = generateModule(bothFaces(2));
    const fluids = new Set(mod.pipeCells.map((c) => c.fluid));
    expect([...fluids].sort()).toEqual(["sulfuric-acid", "water"]);
    // 같은 칸이 두 유체로 잡히면 안 된다(겹쳐 놓았다는 뜻).
    const keys = mod.pipeCells.map((c) => `${c.x},${c.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("아이템 탭이 **자기 면의** 유체 상자 행만 건너뛴다 — 반대 면 행은 안 본다", () => {
    // E 면(유체 입력 + 아이템 벨트)은 점프 모드라 상자 행 하나를 비운다.
    const mod = generateModule(bothFaces(2));
    const plate = mod.inputPorts.find((p) => p.line.name === "iron-plate")!;
    expect(plate.meta.side).toBe("E");
    expect(plate.chest.kind).toBe("infinity-chest");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 다중 유체 단계 B — **한 면에 유체 2줄 이상.** 유체 하나가 폭 2칸(탭 1 + 관 1)을 산다.
//
// 깊이는 한 공식에서 나온다: `base = max(그 면 벨트 최대 깊이, 1)` · 순번 r 의 관 `D_r =
// base + 2 + 2r` · 탭 `D_r − 1` · 터널 좌표 차 `base + 2r`.
// → docs/auto-layout/module/trunk-pipe.md §5.1
// ─────────────────────────────────────────────────────────────────────────────
describe("다중 유체 — 한 면에 유체 두 줄(단계 B)", () => {
  /**
   * 경유 분해 꼴: 물 + 경유(둘 다 유체 입력, **같은 E 면**) → 경유(유체 출력, W).
   * **아이템 줄이 하나도 없다** — 그 면에 벨트가 0줄이라 `base = 1` 로 승격된다.
   */
  function cracking(count: number): ModuleInput {
    return {
      machine: { entityName: "chemical-plant", w: 3, h: 3 },
      count,
      lines: [inFluid("water"), inFluid("heavy-oil"), outFluid("light-oil")],
      inserterEntityName: "inserter",
      beltEntityName: "transport-belt",
      longInserter: { entityName: "long-handed-inserter", reach: 2 },
      fluidTrunk: {
        direction: 4,
        pipeEntityName: "pipe",
        undergroundPipeEntityName: "pipe-to-ground",
        pipeMaxUndergroundDistance: 10,
        lines: [
          { name: "water", role: "input", side: "E", fluidboxOffset: 0, rank: 0, boxIndex: 0 },
          { name: "heavy-oil", role: "input", side: "E", fluidboxOffset: 2, rank: 1, boxIndex: 1 },
          { name: "light-oil", role: "output", side: "W", fluidboxOffset: 0, rank: 0, boxIndex: 2 },
        ],
      },
    };
  }

  it("세 줄이 다 선다 — 같은 면의 두 줄이 각자 무한파이프로 끝난다", () => {
    const mod = generateModule(cracking(3));
    expect(mod.unroutedLines).toEqual([]);
    const inFluids = mod.inputPorts.filter((p) => p.line.kind === "pipe");
    expect(inFluids.map((p) => p.line.name).sort()).toEqual(["heavy-oil", "water"]);
    for (const p of inFluids) {
      expect(p.meta.side).toBe("E");
      expect(p.chest.kind).toBe("infinity-pipe");
    }
  });

  it("깊이 공식 — 벨트가 없으면 base=1, 순번마다 관이 2칸씩 바깥으로", () => {
    const mod = generateModule(cracking(3));
    // 머신 x=0..2 → E 면 d1 = x3. base=1 이므로 D_0 = 1+2 = 3(x5) · D_1 = 5(x7).
    const depthOf = (name: string) =>
      mod.inputPorts.find((p) => p.line.name === name)!.meta.laneDepth;
    expect(depthOf("water")).toBe(3);
    expect(depthOf("heavy-oil")).toBe(5);
  });

  it("탭·유체 상자 칸이 지하파이프이고 **터널 좌표 차가 base + 2r**", () => {
    const mod = generateModule(cracking(1));
    const m = mod.machines[0];
    // rank 0(water, 행 +0): 상자 칸 x3 · 탭 x4 → 좌표 차 1 = base(1) + 2·0.
    // rank 1(heavy-oil, 행 +2): 상자 칸 x3 · 탭 x6 → 좌표 차 3 = base(1) + 2·1.
    for (const [row, tapX] of [[m.origin.y + 0, 4], [m.origin.y + 2, 6]] as const) {
      expect(cellAt(mod, 3, row)?.entityType).toBe(EntityType.PipeUnderground);
      expect(cellAt(mod, tapX, row)?.entityType).toBe(EntityType.PipeUnderground);
    }
  });

  it("**다른 유체의 지상 파이프가 직교로 이웃하지 않는다** — 이웃하는 건 지하파이프뿐", () => {
    const mod = generateModule(cracking(3));
    // 지하파이프는 표면에서 한 면으로만 이어지므로 이웃해도 안전하다(가드가 그걸 안다).
    // 지상 파이프끼리는 닿기만 하면 한 관망이 되므로 **하나도 이웃하면 안 된다.**
    const surface = mod.pipeCells.filter((c) => c.connectDir === undefined);
    const key = (x: number, y: number) => `${x},${y}`;
    const byCell = new Map(surface.map((c) => [key(c.x, c.y), c.fluid]));
    for (const c of surface) {
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const other = byCell.get(key(c.x + dx, c.y + dy));
        if (other !== undefined) expect(other).toBe(c.fluid);
      }
    }
  });

  it("지하파이프 셀은 **방향까지** 실려 나간다 — 가드가 그 한 면만 막게", () => {
    const mod = generateModule(cracking(2));
    const underground = mod.pipeCells.filter((c) => c.connectDir !== undefined);
    expect(underground.length).toBeGreaterThan(0);
    // E 면이므로 상자 칸은 머신 쪽(W=12), 탭은 바깥(E=4)을 본다.
    expect(new Set(underground.map((c) => c.connectDir))).toEqual(new Set([4, 12]));
    // 지상 파이프는 방향이 없다 — 사방으로 이어지기 때문이다.
    expect(mod.pipeCells.some((c) => c.connectDir === undefined)).toBe(true);
  });

  it("머신을 늘려도 유체 행이 겹치지 않는다 — 절대 행 = 머신 원점 + offset", () => {
    const mod = generateModule(cracking(4));
    const rowsOf = (fluid: string) =>
      new Set(mod.pipeCells.filter((c) => c.connectDir !== undefined && c.fluid === fluid).map((c) => c.y));
    const water = rowsOf("water");
    const heavy = rowsOf("heavy-oil");
    expect(water.size).toBe(4); // 머신 4대 × 자기 행 하나
    expect(heavy.size).toBe(4);
    for (const y of water) expect(heavy.has(y)).toBe(false);
  });

  // ── 지하파이프가 없으면 — **기계 대수와 무관하게** 둘째 줄이 설 자리가 없다 ──────────
  //
  // 점프를 못 하면 파이프는 옛 스파인(depth 1 을 기둥 **전체**로)만 놓을 수 있는데, 그 줄은
  // 하나뿐이라 둘째 유체가 자기 유체 상자에 닿을 방법이 없다. `emitTrunkPipe` 의 `severed`
  // 그물이 잡아 `unroutedLines` 로 낸다.
  //
  // **기계가 1대여도 마찬가지다.** 스파인이 extent 전체를 훑으므로 짧게 끊어 옆으로 빼는
  // 모양이 애초에 없다 — 그래서 `moduleWizard` 가 `n ≥ 2 && 점프 불가` 를 **대수를 안 보고**
  // 거절하는 것은 과잉이 아니다(2026-08-09 실측). 조기 거절이 없으면 원인에서 먼
  // `unrouted-lines` 로만 드러난다.
  function crackingNoUnderground(count: number): ModuleInput {
    const base = cracking(count);
    return {
      ...base,
      fluidTrunk: {
        ...base.fluidTrunk!,
        undergroundPipeEntityName: undefined,
        pipeMaxUndergroundDistance: undefined,
      },
    };
  }

  for (const count of [1, 3]) {
    it(`지하파이프가 없으면 둘째 줄이 unrouted — 기계 ${count}대에서도 같다`, () => {
      const mod = generateModule(crackingNoUnderground(count));
      // 계획은 성공한다(`mode: tap`) — 실패는 **방출에서만** 난다. 그래서 계획만 보면 안 보인다.
      expect(mod.supply?.mode).toBe("tap");
      expect(mod.unroutedLines.map((l) => `${l.role}:${l.name}`)).toEqual(["input:heavy-oil"]);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 기준 사례 — `se-space-coolant-hot` (사용자 지정 합격선)
//
// **이 레시피를 머신 여러 대로 배치할 수 있어야 다중 유체 지원이 된 것이다.**
// 유체 입력 2(heavy-oil · se-chemical-gel) + 아이템 입력 3 + 유체 출력 1, 머신은
// `se-space-biochemical-laboratory` 9×9. 회전 후 E 면 유체 상자 rows {2,4,6} 중 앞의 둘,
// W 면 rows {2,4,6} 중 첫 것. → docs/auto-layout/module/trunk-pipe.md §5.1
// ─────────────────────────────────────────────────────────────────────────────
describe("기준 사례 — se-space-coolant-hot (9×9 · 유체 3줄 · 아이템 3줄)", () => {
  function coolantHot(count: number): ModuleInput {
    return {
      machine: { entityName: "se-space-biochemical-laboratory", w: 9, h: 9 },
      count,
      lines: [
        inFluid("heavy-oil"), inFluid("se-chemical-gel"),
        inItem("copper-plate"), inItem("iron-plate"), inItem("sulfur"),
        outFluid("se-space-coolant-hot"),
      ],
      inserterEntityName: "inserter",
      beltEntityName: "transport-belt",
      longInserter: { entityName: "long-handed-inserter", reach: 2 },
      fluidTrunk: {
        direction: 4,
        pipeEntityName: "pipe",
        undergroundPipeEntityName: "pipe-to-ground",
        pipeMaxUndergroundDistance: 10,
        lines: [
          { name: "heavy-oil", role: "input", side: "E", fluidboxOffset: 2, rank: 0, boxIndex: 1 },
          { name: "se-chemical-gel", role: "input", side: "E", fluidboxOffset: 4, rank: 1, boxIndex: 3 },
          { name: "se-space-coolant-hot", role: "output", side: "W", fluidboxOffset: 2, rank: 0, boxIndex: 6 },
        ],
        // 안 쓰고 남는 유체 상자 칸 — E 면 셋째 입력, W 면 나머지 출력 둘.
        unusedFluidboxRows: { E: [6], W: [4, 6] },
      },
    };
  }

  it("여섯 줄이 전부 선다 — 유체 3 + 아이템 3, 못 놓은 줄이 없다", () => {
    const mod = generateModule(coolantHot(4));
    expect(mod.unroutedLines).toEqual([]);
    const fluidPorts = [...mod.inputPorts, ...mod.outputPorts].filter((p) => p.line.kind === "pipe");
    expect(fluidPorts).toHaveLength(3);
    for (const p of fluidPorts) expect(p.chest.kind).toBe("infinity-pipe");
  });

  it("유체 줄이 자기 역할 면에 온다 — 입력 E(순번 0·1) · 출력 W", () => {
    const mod = generateModule(coolantHot(4));
    const sideOf = (name: string) =>
      [...mod.inputPorts, ...mod.outputPorts].find((p) => p.line.name === name)!.meta.side;
    expect(sideOf("heavy-oil")).toBe("E");
    expect(sideOf("se-chemical-gel")).toBe("E");
    expect(sideOf("se-space-coolant-hot")).toBe("W");
  });

  it("**머신을 1 → 4 대로 늘려도** 유체 행이 겹치지 않는다 — 절대 행 = 원점 + offset", () => {
    for (const count of [1, 2, 4]) {
      const mod = generateModule(coolantHot(count));
      expect(mod.unroutedLines, `${count}대`).toEqual([]);
      const rowsOf = (fluid: string) =>
        mod.pipeCells.filter((c) => c.connectDir !== undefined && c.fluid === fluid).map((c) => c.y);
      const heavy = new Set(rowsOf("heavy-oil"));
      const gel = new Set(rowsOf("se-chemical-gel"));
      expect(heavy.size, `${count}대 heavy-oil 행`).toBe(count);
      expect(gel.size, `${count}대 gel 행`).toBe(count);
      for (const y of heavy) expect(gel.has(y), `행 ${y} 충돌`).toBe(false);
    }
  });

  it("**다른 유체의 지상 파이프가 직교로 이웃하지 않는다** — 4대에서도", () => {
    const mod = generateModule(coolantHot(4));
    const surface = mod.pipeCells.filter((c) => c.connectDir === undefined);
    const key = (x: number, y: number) => `${x},${y}`;
    const byCell = new Map(surface.map((c) => [key(c.x, c.y), c.fluid]));
    for (const c of surface) {
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const other = byCell.get(key(c.x + dx, c.y + dy));
        if (other !== undefined) expect(other, `(${c.x},${c.y}) 옆`).toBe(c.fluid);
      }
    }
  });

  it("같은 칸을 두 번 쓰지 않는다 — 겹쳐 놓으면 한쪽이 조용히 사라진다", () => {
    const mod = generateModule(coolantHot(4));
    const keys = mod.cells.map((c) => `${c.x},${c.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("**합류 가드가 이 배치를 통과시킨다** — 방향 인식이 없으면 자기 자신을 거절한다", () => {
    // [moduleWizard] 1b) 가 하는 일을 그대로 재현한다: 유체별로 지도를 만들고 그 유체의
    // 셀만 검사한다. **가드의 방향 인식**이 한 면 다줄의 필수 선행이었던 이유가 이것이다 —
    // 지하파이프의 네 이웃을 다 막던 시절엔 `T₁`(유체1 탭)이 옆의 `C₀`(유체0 ClusterPipe)
    // 헤일로에 걸려, 우리가 방금 깐 배치를 우리가 hard 위반으로 거절했다.
    const mod = generateModule(coolantHot(4));
    for (const fluid of new Set(mod.pipeCells.map((c) => c.fluid))) {
      const flow = collectPipeFlow({ fluidName: fluid, pipes: mod.pipeCells, machines: [] });
      const own = mod.pipeCells.filter((c) => c.fluid === fluid);
      expect(pipeFlowConflict(own, flow), `${fluid}`).toBeNull();
    }
  });

  it("회귀 못 — **방향을 지우면** 같은 배치가 거절된다(가드가 실제로 그 정보를 쓴다)", () => {
    // 테스트가 헛돌지 않는다는 증거다: `connectDir` 을 떼면 지상 파이프로 보여 옛 답이 나온다.
    const mod = generateModule(coolantHot(4));
    const flat = mod.pipeCells.map((c) => ({ x: c.x, y: c.y, fluid: c.fluid }));
    const hits = [...new Set(flat.map((c) => c.fluid))].filter((fluid) => {
      const flow = collectPipeFlow({ fluidName: fluid, pipes: flat, machines: [] });
      return pipeFlowConflict(flat.filter((c) => c.fluid === fluid), flow) !== null;
    });
    expect(hits.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 유체 면 회수 (2026-08-09) — 링크·다이렉트가 **점프하는** 유체 면에 앉는다
//
// 예전엔 유체가 붙은 면을 통째로 비켜 gap 으로 밀렸다. 이제 유체 상자 행만 건너뛰고 앉는다.
// **다만 마지막 수단이다** — 앉는 순간 파이프가 점프해 그 면이 넓어지므로, 다른 면에 자리가
// 있으면 거기가 먼저다.
// → 유체 면 회수 (2026-08-09) · git log --grep="유체 면에 앉는다"
// ─────────────────────────────────────────────────────────────────────────────
describe("유체 면 회수 — 점프 면에 링크가 앉는다", () => {
  /** 3×3 화학공장 2대 · E 면 유체 1줄(상자 행 1, 점프 가능) · 짧은 팔만 → 기계별 포트. */
  const crowded = (inputs: number): ModuleInput => ({
    machine: { entityName: "chemical-plant", w: 3, h: 3 },
    count: 2,
    lines: [
      ...Array.from({ length: inputs }, (_, i) => inItem(`in${i}`)),
      inFluid("sulfuric-acid"),
      outItem("out"),
    ],
    inserterEntityName: "inserter", // 긴팔 없음 → 탭이 깨지고 기계별 포트로
    beltEntityName: "transport-belt",
    fluidTrunk: {
      direction: 4,
      pipeEntityName: "pipe",
      undergroundPipeEntityName: "pipe-to-ground",
      pipeMaxUndergroundDistance: 10,
      lines: [{ name: "sulfuric-acid", role: "input", side: "E", fluidboxOffset: 1, rank: 0, boxIndex: 0 }],
    },
  });

  const gapOf = (mod: ReturnType<typeof generateModule>) => {
    const [m0, m1] = mod.machines;
    return m1.origin.y - (m0.origin.y + m0.size.h);
  };

  it("W 에 자리가 있으면 유체 면을 안 쓴다 — 없는 위험 때문에 폭을 낭비하지 않는다", () => {
    const mod = generateModule(crowded(2));
    expect(mod.unroutedLines).toHaveLength(0);
    // E 면 좌석 줄(d1)이 통째로 파이프 = 옛 스파인. 점프할 이유가 없다.
    const m = mod.machines[0];
    for (let dy = 0; dy < 3; dy++) {
      const c = cellAt(mod, m.origin.x + 3, m.origin.y + dy);
      expect(c?.entityType, `y=${m.origin.y + dy}`).toBe(EntityType.Pipe);
    }
    expect(gapOf(mod)).toBe(0);
  });

  it("W 가 차면 유체 면에 앉는다 — **유체 상자 행만 건너뛴다**", () => {
    const mod = generateModule(crowded(4));
    expect(mod.supply?.mode).toBe("direct");
    expect(mod.unroutedLines).toHaveLength(0);
    for (const m of mod.machines) {
      const at = (dy: number) => cellAt(mod, m.origin.x + 3, m.origin.y + dy)?.entityType;
      expect(at(0)).toBe(EntityType.Inserter); // 좌석
      expect(at(1)).toBe(EntityType.PipeUnderground); // 유체 상자 행 — 파이프가 여기서 점프
      expect(at(2)).toBe(EntityType.Inserter); // 좌석
    }
  });

  it("그래서 gap 이 안 벌어진다 — 예전엔 두 줄이 통째로 gap 으로 밀렸다", () => {
    expect(gapOf(generateModule(crowded(4)))).toBe(0);
  });

  it("파이프가 링크 포트 끝 **밖으로** 물러난다 (1단계 `linkFaceDepths`)", () => {
    // 이게 틀리면 파이프가 포트 끝 위로 지나가 조용히 끊긴다 — 겹침으로는 안 잡힌다.
    const mod = generateModule(crowded(4));
    const eastOf = (pred: (t: unknown) => boolean) =>
      Math.max(...mod.cells.filter((c) => pred(c.cell.entityType) && c.x > 2).map((c) => c.x));
    const pipeMaxX = eastOf((t) => t === EntityType.Pipe || t === EntityType.PipeUnderground);
    const portMaxX = eastOf((t) => t === EntityType.InfinityChest);
    expect(pipeMaxX).toBeGreaterThan(portMaxX);
  });
});
