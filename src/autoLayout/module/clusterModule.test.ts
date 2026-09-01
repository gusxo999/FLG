import { describe, it, expect } from "vitest";
import { generateModule, type GeneratedModule, type ModuleInput } from "./clusterModule";
import type { IoLine } from "../planner/module/clusterPortPlanner";
import { scaled } from "./testScale";
import { EntityType } from "../../types/layout";

// ─────────────────────────────────────────────────────────────────────────────
// 픽스처
// ─────────────────────────────────────────────────────────────────────────────

const line = (name: string, role: "input" | "output"): IoLine => ({
  name,
  kind: "belt",
  role,
});

/** copper-cable 류: 입력 1(copper-plate) + 출력 1(copper-cable), 일반 인서터만(용량 2). */
const copperCable: ModuleInput = scaled({
  machine: { entityName: "assembling-machine-2", w: 3, h: 3 },
  count: 5,
  lines: [line("copper-plate", "input"), line("copper-cable", "output")],
  inserterEntityName: "inserter",
  inserters: [{ entityName: "inserter", reach: 1, throughput: 0 }],
  beltEntityName: "transport-belt",
  belts: [{ entityName: "transport-belt", throughput: 15 }],
});

/** electronic-circuit 류: 입력 2 + 출력 1, 긴팔 보유(용량 4 → 면당 2레인). */
const electronicCircuit: ModuleInput = scaled({
  machine: { entityName: "assembling-machine-2", w: 3, h: 3 },
  count: 4,
  lines: [
    line("iron-plate", "input"),
    line("copper-cable", "input"),
    line("electronic-circuit", "output"),
  ],
  inserterEntityName: "inserter",
  inserters: [{ entityName: "inserter", reach: 1, throughput: 0 }, { entityName: "long-handed-inserter", reach: 2, throughput: 0 }],
  beltEntityName: "transport-belt",
  belts: [{ entityName: "transport-belt", throughput: 15 }],
});

/** electric-motor 류: 입력 3 + 출력 1 = 정확히 용량 4(긴팔). 4스트림 스트레스. */
const electricMotor: ModuleInput = scaled({
  machine: { entityName: "assembling-machine-2", w: 3, h: 3 },
  count: 3,
  lines: [
    line("iron-gear-wheel", "input"),
    line("copper-cable", "input"),
    line("iron-plate", "input"),
    line("electric-motor", "output"),
  ],
  inserterEntityName: "inserter",
  inserters: [{ entityName: "inserter", reach: 1, throughput: 0 }, { entityName: "long-handed-inserter", reach: 2, throughput: 0 }],
  beltEntityName: "transport-belt",
  belts: [{ entityName: "transport-belt", throughput: 15 }],
});

// ─────────────────────────────────────────────────────────────────────────────
// ASCII 렌더 — 결과물을 눈으로 보기 위한 진단 출력
// ─────────────────────────────────────────────────────────────────────────────

const BELT_ARROW: Record<number, string> = { 0: "↑", 4: "→", 8: "↓", 12: "←" };

function render(mod: GeneratedModule, title: string): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const mark = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const m of mod.machines)
    for (let dx = 0; dx < m.size.w; dx++)
      for (let dy = 0; dy < m.size.h; dy++) mark(m.origin.x + dx, m.origin.y + dy);
  for (const c of mod.cells) mark(c.x, c.y);

  const W = maxX - minX + 1, H = maxY - minY + 1;
  const grid: string[][] = Array.from({ length: H }, () => Array(W).fill("·"));
  const put = (x: number, y: number, ch: string) => { grid[y - minY][x - minX] = ch; };

  for (const m of mod.machines)
    for (let dx = 0; dx < m.size.w; dx++)
      for (let dy = 0; dy < m.size.h; dy++) put(m.origin.x + dx, m.origin.y + dy, "▒");
  for (const c of mod.cells) {
    const t = c.cell.entityType;
    if (t === EntityType.Belt) put(c.x, c.y, BELT_ARROW[c.cell.direction] ?? "b");
    else if (t === EntityType.Inserter) put(c.x, c.y, "i");
    else if (t === EntityType.InfinityChest) put(c.x, c.y, "C");
  }
  // 포트 anchor 강조.
  for (const p of mod.inputPorts) put(p.anchor.x, p.anchor.y, "▶"); // 입력
  for (const p of mod.outputPorts) put(p.anchor.x, p.anchor.y, "◉"); // 출력

  const body = grid.map((r) => r.join("")).join("\n");
  // eslint-disable-next-line no-console
  console.log(
    `\n=== ${title} ===\n` +
      `머신 ${mod.machines.length}대 | 입력포트 ${mod.inputPorts.length} | 출력포트 ${mod.outputPorts.length} | 미라우팅 ${mod.unroutedLines.length}\n` +
      `입력: ${mod.inputPorts.map((p) => `${p.line.name}@(${p.anchor.x},${p.anchor.y}) ${p.face}`).join(", ")}\n` +
      `출력: ${mod.outputPorts.map((p) => `${p.line.name}@(${p.anchor.x},${p.anchor.y}) ${p.face}`).join(", ")}\n` +
      body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────────────────────────────────────

describe("generateModule", () => {
  it("copper-cable: 입력 1 + 출력 1 모듈을 자기 ring 으로 라우팅 (용량 2)", () => {
    const mod = generateModule(copperCable);
    render(mod, "copper-cable ×5 (용량 2)");

    expect(mod.machines).toHaveLength(5);
    expect(mod.unroutedLines).toHaveLength(0);
    expect(mod.outputPorts).toHaveLength(1);
    expect(mod.inputPorts).toHaveLength(1);

    const ringSet = new Set(mod.ring.map((c) => `${c.x},${c.y}`));
    for (const p of [...mod.inputPorts, ...mod.outputPorts]) {
      expect(ringSet.has(`${p.anchor.x},${p.anchor.y}`)).toBe(true);
    }
  });

  it("electronic-circuit: 입력 2 + 출력 1, 긴팔로 면당 2레인 (용량 4)", () => {
    const mod = generateModule(electronicCircuit);
    render(mod, "electronic-circuit ×4 (용량 4, 긴팔)");

    expect(mod.unroutedLines).toHaveLength(0);
    expect(mod.inputPorts).toHaveLength(2);
    expect(mod.outputPorts).toHaveLength(1);
  });

  it("electric-motor: 입력 3 + 출력 1 = 4스트림 (용량 4 정확히)", () => {
    const mod = generateModule(electricMotor);
    render(mod, "electric-motor ×3 (4스트림, 용량 4)");

    expect(mod.unroutedLines).toHaveLength(0);
    expect(mod.inputPorts).toHaveLength(3);
    expect(mod.outputPorts).toHaveLength(1);
  });

  it("셀 좌표 충돌 0 — 모든 placed 셀이 고유 좌표", () => {
    for (const input of [copperCable, electronicCircuit]) {
      const mod = generateModule(input);
      const seen = new Set<string>();
      for (const c of mod.cells) {
        const k = `${c.x},${c.y}`;
        expect(seen.has(k), `중복 셀 ${k} in ${input.lines[0].name}`).toBe(false);
        seen.add(k);
      }
    }
  });

  it("결정적 — 같은 입력은 같은 셀/포트", () => {
    const a = generateModule(copperCable);
    const b = generateModule(copperCable);
    expect(JSON.stringify(b.cells)).toEqual(JSON.stringify(a.cells));
    expect(JSON.stringify(b.outputPorts.map((p) => p.anchor))).toEqual(
      JSON.stringify(a.outputPorts.map((p) => p.anchor)),
    );
  });

  it("포트 anchor 와 머신 footprint 는 겹치지 않는다", () => {
    const mod = generateModule(electronicCircuit);
    const machineCells = new Set<string>();
    for (const m of mod.machines)
      for (let dx = 0; dx < m.size.w; dx++)
        for (let dy = 0; dy < m.size.h; dy++)
          machineCells.add(`${m.origin.x + dx},${m.origin.y + dy}`);
    for (const p of [...mod.inputPorts, ...mod.outputPorts]) {
      expect(machineCells.has(`${p.anchor.x},${p.anchor.y}`)).toBe(false);
    }
  });
});

describe("Parallel Inserting — 머신당 탭 인서터 여러 개", () => {
  /** copper-plate 가 머신당 인서터 하나로 못 받는 고수요 픽스처. */
  const highDemand: ModuleInput = {
    ...copperCable,
    count: 3,
    inserters: [{ entityName: "inserter", reach: 1, throughput: 5 }],
    // 벨트 티어도 같은 저울(100/s)이어야 30/s 가 **한 줄**에 담긴다 — 15/s 짜리를 주면
    // 두 줄로 갈리는 게 옳은 동작이라 이 검사(줄 하나)의 전제가 깨진다.
    belts: [{ entityName: "transport-belt", throughput: 100 }],
    supplyCapacity: {
      beltCapacity: 100,
      // copper-plate 30 / 3대 = 10, ceil(10/5) = 탭 2개. 출력 6 / 3대 = 2 → 팔 1개.
      lineRates: new Map([["input:copper-plate", 30], ["output:copper-cable", 6]]),
    },
  };

  // 기하: outputSide=W → 입력 copper-plate 는 **E 면**. 머신 x=0..2, E 면 depth 1(좌석) = x=3,
  // depth 2(near 벨트) = x=4.
  it("고수요 입력이 머신마다 탭 인서터 2개로 집힌다", () => {
    const mod = generateModule(highDemand);
    expect(mod.unroutedLines).toHaveLength(0);

    const inserters = mod.cells.filter((c) => c.cell.entityType === EntityType.Inserter);
    // 각 머신의 E 면 좌석 열(x=3)에 탭 인서터가 2행 앉는다(= requiredInserterCount 2).
    for (const m of mod.machines) {
      const seatCol = inserters.filter(
        (c) => c.x === 3 && c.y >= m.origin.y && c.y < m.origin.y + m.size.h,
      );
      expect(seatCol.length, `머신 ${m.id} 좌석 열`).toBe(2);
    }
  });

  it("탭이 늘어도 벨트는 여전히 한 줄 · 포트는 품목당 1개", () => {
    const mod = generateModule(highDemand);
    expect(mod.inputPorts.filter((p) => p.line.name === "copper-plate")).toHaveLength(1);
    // copper-plate 벨트 열(E near, x=4)은 한 줄 그대로 — 머신 기둥 전체를 덮는다.
    const plateBelts = mod.cells.filter(
      (c) => c.cell.entityType === EntityType.Belt && c.x === 4,
    );
    expect(plateBelts.length).toBeGreaterThan(0);
  });

  it("결정적 — 같은 고수요 입력은 같은 셀", () => {
    const a = generateModule(highDemand);
    const b = generateModule(highDemand);
    expect(JSON.stringify(b.cells)).toEqual(JSON.stringify(a.cells));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 다이렉트도 팔 개수를 지킨다 — 상자 여러 개가 머신 한 대를 먹인다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **다이렉트 인서팅이 [requiredInserterCount] 만큼 팔을 놓는다.**
 *
 * 팔 개수는 공급 방식과 무관한 물리량이다 — 인서터 하나가 나르는 양은 벨트에서 집든
 * 상자에서 집든 같다. 그래서 탭이 "팔 2개"라고 판정한 수요는 다이렉트에서도 팔 2개다.
 * 다만 다이렉트는 팔마다 **자기 상자**가 필요하다(상자 한 칸의 이웃은 4칸뿐이고 인서터는
 * 상자와 머신 양쪽에 닿아야 한다) → **상자 여러 개가 머신 한 대를 먹이는 형태**가 된다.
 *
 * 예전엔 다이렉트가 이 수를 묻지도 않고 줄당 팔 하나만 놓고 "성공"이라 보고했다 —
 * 실측(2026-07-16 kr-glass ← kr-sand)에서 초당 8개를 먹는 머신에 초당 0.667개짜리 인서터가
 * 하나 붙은 배치가 나왔다. 게임에 넣으면 굶는다.
 */
describe("다이렉트 인서팅 — 팔 개수만큼 상자·인서터", () => {
  /** 벨트 한 줄로는 못 나르는 수요(→ 다이렉트로 떨어짐) + 팔은 2개 필요. */
  const directHighDemand: ModuleInput = {
    ...copperCable,
    count: 2,
    inserters: [{ entityName: "inserter", reach: 1, throughput: 5 }],
    supplyCapacity: {
      beltCapacity: 1, // 20 > 1 → 벨트 축에서 거절 → 다이렉트
      // copper-plate 20 / 2대 = 10, ceil(10/5) = 팔 2개. 출력 4 / 2대 = 2 → 팔 1개.
      lineRates: new Map([["input:copper-plate", 20], ["output:copper-cable", 4]]),
    },
  };

  it("다이렉트로 떨어져도 머신마다 팔 2개가 붙는다 (굶지 않는다)", () => {
    const mod = generateModule(directHighDemand);
    expect(mod.unroutedLines).toHaveLength(0);

    // 입력 copper-plate 는 E 면(outputSide=W 의 반대). 좌석 열 = x=3.
    const inserters = mod.cells.filter((c) => c.cell.entityType === EntityType.Inserter);
    for (const m of mod.machines) {
      const seatCol = inserters.filter(
        (c) => c.x === 3 && c.y >= m.origin.y && c.y < m.origin.y + m.size.h,
      );
      expect(seatCol.length, `머신 ${m.id} 가 팔 하나로 굶는다`).toBe(2);
    }
  });

  it("팔 여러 개가 **한 포트**로 모인다 — 머신마다 벨트 하나", () => {
    const mod = generateModule(directHighDemand);
    const plateChests = mod.chests.filter((c) => c.content === "copper-plate");
    // 머신 2대 × 포트 1개 = 상자 2개.
    //
    // **예전엔 팔마다 상자였다(4개).** 상자 한 칸의 이웃은 4칸뿐이라 인서터 하나가 상자와
    // 머신 양쪽에 닿으려면 팔마다 자기 상자가 필요했기 때문이다. 지금은 팔들이 자기 면의
    // **짧은 벨트 하나**에 함께 놓고 그 벨트가 포트로 나간다(링크와 같은 모양) — 팔은 그대로
    // 2개인데 모듈 경계 포트는 절반이 된다. 반출 압력이 그만큼 준다.
    expect(plateChests).toHaveLength(2);
    expect(mod.inputPorts.filter((p) => p.line.name === "copper-plate")).toHaveLength(2);
    expect(new Set(plateChests.map((c) => `${c.origin.x},${c.origin.y}`)).size).toBe(2);
  });

  it("수량을 모르는 줄은 아예 안 깔린다 — 없는 숫자로 상자를 지어내지 않는다", () => {
    // 예전엔 수치가 없으면 **팔 1개짜리 줄을 지어냈다**(`makeLink` 폴백). 2026-08-24 그 폴백을
    // 지우면서 의도가 더 강해졌다: 저울이 없으면 줄 수를 정할 근거가 없으므로 **못 깐 줄로
    // 정직하게 낸다.** 조용히 1을 쓰면 그 줄은 실제로 굶으면서도 성공처럼 보였다.
    const noRate: ModuleInput = {
      ...directHighDemand,
      supplyCapacity: {
        beltCapacity: 1,
        lineRates: new Map([["input:copper-plate", 20]]), // 출력 copper-cable 은 일부러 뺀다
      },
    };
    const mod = generateModule(noRate);
    expect(mod.chests.filter((c) => c.content === "copper-cable")).toHaveLength(0);
    expect(mod.unroutedLines.map((l) => l.name)).toContain("copper-cable");
  });

  it("팔이 한 면에 다 안 앉으면 **줄을 갈라 두 면에** 앉힌다 (줄여서 굶히지 않는다)", () => {
    // 팔 4개가 필요한데 3×3 머신의 한 면은 3행뿐이다.
    //
    // **2026-08-24 이전의 답은 "못 놓는다"였다** — 한 줄에 팔을 다 못 앉히니 그 줄을 통째로
    // 포기했다(줄여 놓으면 굶는 배치가 되니까). 지금은 [split belt](../../../docs/용어사전.md)
    // 가 있다: 좌석 상한(면 3칸 × 5/s = 15/s)을 넘는 몫은 **둘째 줄**로 갈라져 반대 면에
    // 앉는다. 그래서 팔 4개가 E 3 + W 1 로 나뉘어 **다 앉는다** — 굶는 머신이 없다는 의도는
    // 그대로고, 답만 "포기"에서 "분할"로 바뀌었다.
    const tooHungry: ModuleInput = {
      ...copperCable,
      count: 2,
      inserters: [{ entityName: "inserter", reach: 1, throughput: 5 }],
      supplyCapacity: {
        beltCapacity: 1,
        // 40/2 = 20, ceil(20/5) = 팔 4개 > 3행 → 한 줄로는 못 앉는다.
        lineRates: new Map([["input:copper-plate", 40], ["output:copper-cable", 4]]),
      },
    };
    const mod = generateModule(tooHungry);
    // **아무 줄도 안 버렸다** — 못 부은 줄은 여기 이름이 뜬다([ModulePortPlan.unpourableLines]).
    expect(mod.unroutedLines).toHaveLength(0);
    // 머신 2대 × 갈라진 줄 2개 = 상자 4개(머신마다 두 면).
    expect(mod.chests.filter((c) => c.content === "copper-plate")).toHaveLength(4);
    // 한 머신의 copper-plate 포트가 **서로 다른 두 면**에 있다 — 한 면에 4개를 우겨넣지 않았다.
    const sides = new Set(
      mod.inputPorts.filter((p) => p.line.name === "copper-plate").map((p) => p.meta.side),
    );
    expect(sides.size).toBeGreaterThan(1);
  });

  it("결정적", () => {
    const a = generateModule(directHighDemand);
    const b = generateModule(directHighDemand);
    expect(JSON.stringify(b.cells)).toEqual(JSON.stringify(a.cells));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 노출 N/S 완화 — count=1 raw 입력 (방출 수준)
// ─────────────────────────────────────────────────────────────────────────────

describe("generateModule — 노출 N/S 완화 (count=1)", () => {
  const ext = (name: string): IoLine => ({ name, kind: "belt", role: "input", external: true });

  // **자원이 레인이 아니라 행이다**(2026-08-17 — 계획서 §14). 옛 답은 `E2 · E3 · N2 · N3` 로,
  // *"줄 하나가 레인 하나를 통째로 먹는다"* 는 모델이었다. 지금은 벨트가 **자기 좌석 구간만**
  // 덮으므로 3×3 머신의 E 면 세 행에 줄 셋이 같은 `d2` 로 앉고, 넷째만 노출 N 으로 넘어간다.
  // 그래서 긴팔(`d3`)을 쓸 일이 아예 없다 — 깊이는 고르는 값이 아니라 **자리가 없을 때의 결과**다.
  it("한 면의 **행**을 나눠 쓴다 — 셋이 같은 레인에 앉고 넷째만 노출 N 으로", () => {
    // external 입력 4개. E 면 좌석 3행 → 셋이 E2 를 나눠 쓰고, 넷째가 N 으로 넘어간다.
    const mod = generateModule(scaled({
      machine: { entityName: "assembling-machine-3", w: 3, h: 3 },
      count: 1,
      lines: [ext("a"), ext("b"), ext("c"), ext("d")],
      inserterEntityName: "inserter",
      inserters: [{ entityName: "inserter", reach: 1, throughput: 0 }, { entityName: "long-handed-inserter", reach: 2, throughput: 0 }],
      beltEntityName: "transport-belt",
      belts: [{ entityName: "transport-belt", throughput: 15 }],
      nsExposure: ["N"],
    }));
    render(mod, "count=1, external 입력 4 (E2 E3 N2 N3)");

    expect(mod.unroutedLines).toHaveLength(0);
    expect(mod.inputPorts).toHaveLength(4);
    // 넷이 다 얕은 레인(d2)·일반 팔이다 — 깊은 레인을 쓸 이유가 없었다.
    const slots = mod.inputPorts.map((p) => `${p.meta.laneDepth}/${p.meta.inserter}`);
    expect(slots).toEqual(["2/normal", "2/normal", "2/normal", "2/normal"]);

    // 면 교차 충돌 0 — E 레인(세로)과 N 레인(가로)이 코너에서 겹치지 않는다.
    const seen = new Set<string>();
    for (const c of mod.cells) {
      const k = `${c.x},${c.y}`;
      expect(seen.has(k), `중복 셀 ${k}`).toBe(false);
      seen.add(k);
    }
    // **N 면을 실제로 썼다** — 정확히 하나가 머신 위쪽(음수 y)에 앉는다.
    //
    // `meta.side` 로는 못 가른다: N/S 면 벨트는 가로로 달려 **변에서 꺾이고**, 그 꺾이는 칸이
    // 곧 평범한 E 포트가 된다([emitInputLinks] 의 `portFace`). 그래서 면이 아니라 **좌표**로 본다.
    const machineTop = 0;
    const north = mod.inputPorts.filter((p) => p.anchor.y < machineTop);
    expect(north).toHaveLength(1);
  });

  // 옛 답은 `E2 · N2` — *"긴팔이 없으면 면당 레인 1개"* 라 둘째 줄이 곧바로 다른 면으로 갔다.
  // 행 모델에서는 **팔 길이가 면 용량을 안 정한다**: E 면 3행에 둘 다 앉으므로 노출 N 을 쓸
  // 일이 없다. 긴팔 유무는 *"얕은 레인이 다 찼을 때 하나 더 열 수 있나"* 만 정한다.
  it("긴팔이 없어도 한 면에 두 줄 — 면 용량은 팔 길이가 아니라 **행 수**다", () => {
    const mod = generateModule(scaled({
      machine: { entityName: "assembling-machine-2", w: 3, h: 3 },
      count: 1,
      lines: [ext("a"), ext("b")],
      inserterEntityName: "inserter",
      inserters: [{ entityName: "inserter", reach: 1, throughput: 0 }],
      beltEntityName: "transport-belt",
      belts: [{ entityName: "transport-belt", throughput: 15 }],
      nsExposure: ["N"],
    }));
    render(mod, "count=1, 일반만, external 입력 2 (E2 N2)");

    expect(mod.unroutedLines).toHaveLength(0);
    const slots = mod.inputPorts.map((p) => `${p.meta.side}${p.meta.laneDepth}/${p.meta.inserter}`);
    expect(slots).toEqual(["E2/normal", "E2/normal"]);
    // 둘 다 머신 옆(E)이다 — 노출 N 으로 넘어간 줄이 없다.
    expect(mod.inputPorts.every((p) => p.anchor.y >= 0)).toBe(true);
  });

  it("nsExposure 미지정 — 노출 면을 안 주면 원료가 옆면 행을 그대로 쓴다", () => {
    const mod = generateModule(scaled({
      machine: { entityName: "assembling-machine-3", w: 3, h: 3 },
      count: 1,
      lines: [ext("a"), ext("b"), ext("c"), { name: "out", kind: "belt", role: "output" }],
      inserterEntityName: "inserter",
      inserters: [{ entityName: "inserter", reach: 1, throughput: 0 }, { entityName: "long-handed-inserter", reach: 2, throughput: 0 }],
      beltEntityName: "transport-belt",
      belts: [{ entityName: "transport-belt", throughput: 15 }],
      // nsExposure 미지정 → 기존 동작.
    }));
    const c = mod.inputPorts.find((p) => p.line.name === "c")!;
    // 옛 답은 `W`(W-spill)였다. E 면 좌석이 3행이라 셋째 원료가 **아직 E 에 앉는다** —
    // 반대 면으로 밀 이유가 생기지 않았다.
    expect(c.meta.side).toBe("E");
    expect(c.meta.laneDepth).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 공급 모델 통합 (2026-08-05) — 기계별 포트가 링크와 같은 배분기·방출기를 탄다
//
// 얻는 것 둘, 둘 다 여기서 확인한다:
//  ① **유체 레시피가 물러설 곳을 갖는다.** 탭이 깨져도 모듈이 통째로 사라지지 않는다.
//  ② **위/아래(gap)가 열린다.** W/E 두 면이 다 차면 가로 벨트가 기둥 축과 수직으로 나간다.
//
// → docs/auto-layout/module/module-planning.md §5 · docs/auto-layout/link/machine-link.md
// ─────────────────────────────────────────────────────────────────────────────
describe("공급 모델 통합 — 기계별 포트", () => {
  /** battery 꼴: 철판·구리판(아이템) + 황산(유체) → 배터리. **짧은 팔만** 고른다. */
  const battery = (count: number): ModuleInput => scaled({
    machine: { entityName: "chemical-plant", w: 3, h: 3 },
    count,
    lines: [
      line("iron-plate", "input"),
      line("copper-plate", "input"),
      { name: "sulfuric-acid", kind: "pipe", role: "input" },
      line("battery", "output"),
    ],
    inserterEntityName: "inserter", // reach 1 하나뿐 — 긴팔 없음
    inserters: [{ entityName: "inserter", reach: 1, throughput: 0 }],
    beltEntityName: "transport-belt",
    belts: [{ entityName: "transport-belt", throughput: 15 }],
    fluidTrunk: {
      direction: 4,
      pipeEntityName: "pipe",
      undergroundPipeEntityName: "pipe-to-ground",
      pipeMaxUndergroundDistance: 10,
      lines: [{ name: "sulfuric-acid", role: "input", side: "E", fluidboxOffset: 1, rank: 0, boxIndex: 0 }],
    },
  });

  it("긴팔 없이 battery 가 선다 — 탭은 깨지고 기계별 포트로 물러난다", () => {
    const mod = generateModule(battery(2));
    // 탭은 못 선다: 짧은 팔만이면 면당 1레인인데 아이템 줄이 3개다.
    // 그래도 **아무 줄도 못 놓은 게 없다** — 예전엔 유체 때문에 통째로 실패했다.
    expect(mod.unroutedLines).toHaveLength(0);
  });

  it("아이템 3줄이 유체 면을 비켜 W 3칸에 앉는다", () => {
    const mod = generateModule(battery(2));
    // 유체가 가져간 E 면에는 아이템 포트가 하나도 없다.
    const itemPorts = [...mod.inputPorts, ...mod.outputPorts].filter((p) => p.line.kind === "belt");
    expect(itemPorts.every((p) => p.meta.side === "W")).toBe(true);
    // 머신마다 3줄 × 2대 = 아이템 포트 6개.
    expect(itemPorts).toHaveLength(6);
  });

  it("머신마다 3줄 전부에 인서터가 하나씩 붙는다 — 굶는 머신이 없다", () => {
    const mod = generateModule(battery(2));
    const inserters = mod.cells.filter((c) => c.cell.entityType === EntityType.Inserter);
    for (const m of mod.machines) {
      // 좌석 줄(W d1 = x=-1)에서 이 머신의 행에 앉은 탭.
      const taps = inserters.filter(
        (c) => c.x === m.origin.x - 1 && c.y >= m.origin.y && c.y < m.origin.y + m.size.h,
      );
      expect(taps.length, `머신 ${m.id}`).toBe(3);
    }
  });

  it("유체 포트는 여전히 기둥에 하나 — 파이프는 쪼개지지 않는다", () => {
    const mod = generateModule(battery(4));
    const fluid = mod.inputPorts.filter((p) => p.line.kind === "pipe");
    expect(fluid).toHaveLength(1);
    expect(fluid[0].chest.kind).toBe("infinity-pipe");
  });

  it("W/E 가 다 차면 **위/아래로 넘어가고** 그만큼 기계 사이가 벌어진다", () => {
    // 3×3 머신의 W/E 좌석은 머신당 3+3 = 6줄. 7줄을 주면 하나가 갈 곳이 없다 —
    // 예전엔 여기서 그 줄이 그냥 못 놓였고, 이제 gap 으로 간다.
    const mod = generateModule(scaled({
      machine: { entityName: "assembling-machine-3", w: 3, h: 3 },
      count: 2,
      lines: [
        line("a", "input"), line("b", "input"), line("c", "input"),
        line("d", "input"), line("e", "input"), line("f", "input"),
        line("out", "output"),
      ],
      inserterEntityName: "inserter",
      inserters: [{ entityName: "inserter", reach: 1, throughput: 0 }],
      beltEntityName: "transport-belt",
      belts: [{ entityName: "transport-belt", throughput: 15 }],
    }));
    expect(mod.unroutedLines).toHaveLength(0);
    // 일곱 줄 × 머신 2대 = 포트 14개. 하나도 안 잃었다.
    expect(mod.inputPorts.length + mod.outputPorts.length).toBe(14);
    // 기둥이 벌어졌다 — gap 폭은 우리가 고른 값이 아니라 배정의 부산물이다.
    const [m0, m1] = mod.machines;
    expect(m1.origin.y - (m0.origin.y + m0.size.h)).toBeGreaterThan(0);
  });

  // ── 안 쓰는 유체 상자 칸 (2026-08-05 브라우저 실측) ────────────────────────────
  //
  // 화학공장은 입력 유체 상자가 E 면에 **둘**(offset 0·2)인데 battery 는 하나만 쓴다.
  // 옛 점프 게이트는 *"그 면에 넘을 벨트가 있나"* 만 봤는데, 기계별 포트는 유체 면을 통째로
  // 비켜 주므로 벨트가 0이라 점프가 안 켜졌다 → 스파인이 좌석 줄을 통째로 지나며 **안 쓰는
  // 상자 칸에 붙었고**, 합류 가드가 hard 위반으로 모듈을 거절했다(화면: "물러설 곳이 없었습니다").
  it("안 쓰는 유체 상자 칸이 있으면 넘을 벨트가 없어도 점프한다", () => {
    const base = battery(2);
    const mod = generateModule(scaled({
      ...base,
      fluidTrunk: { ...base.fluidTrunk!, unusedFluidboxRows: { E: [2] } },
    }));
    expect(mod.unroutedLines).toHaveLength(0);
    const at = (x: number, y: number) => mod.cells.find((c) => c.x === x && c.y === y)?.cell;
    for (const m of mod.machines) {
      // 쓰는 상자 행(offset 1)에는 지하파이프 입구가 온다.
      expect(at(3, m.origin.y + 1)?.entityType).toBe(EntityType.PipeUnderground);
      // **안 쓰는 상자 행은 비어 있어야 한다** — 여기 파이프가 닿으면 가드가 거절한다.
      expect(at(3, m.origin.y + 2), `머신 ${m.id} 의 안 쓰는 상자 칸`).toBeUndefined();
    }
  });

  it("남는 상자가 없으면 옛 스파인 그대로 — 없는 위험 때문에 폭을 낭비하지 않는다", () => {
    const mod = generateModule(battery(2));
    // unusedFluidboxRows 미지정 → 넘을 벨트도 없으니 점프 안 켜짐 = d1 직선 스파인.
    // 기둥이 덮는 행만 본다(그 **밖**은 포트 끝이라 무한파이프가 오는 게 정상).
    const yMax = Math.max(...mod.machines.map((m) => m.origin.y + m.size.h - 1));
    const spine = mod.cells.filter((c) => c.x === 3 && c.y >= 0 && c.y <= yMax);
    expect(spine.length).toBe(yMax + 1);
    expect(spine.every((c) => c.cell.entityType === EntityType.Pipe)).toBe(true);
  });

  // ── gap 스필 × 유체 (2026-08-05) ──────────────────────────────────────────────
  //
  // gap 벨트는 **옆면으로** 빠져나간다(출력=서, 입력=동). 그 면에 유체가 있으면 포트 끝
  // (인서터 d1 · 상자 d2)이 파이프의 좌석 줄에 앉는다 — 점프하지 않는 스파인은 **거기서
  // 끊기고**, 끊긴 아래쪽 머신은 유체를 못 받는다. 겹침도 미배치도 아니라 아무 신호가 없다:
  // `emitTrunkPipe` 의 occupancy 안전망이 그 칸만 조용히 건너뛰고 있었다.
  //
  // 근치는 점프 조건 ④([gapExitSidesFromPlans]) — 그 면으로 gap 벨트가 나가면 파이프가 d3 으로
  // 물러나 d1·d2 를 비운다. 그물은 그대로 두되 **삼키지 않게** 바꿨다(줄을 unrouted 로 낸다).

  /** 세로 파이프 열 하나가 기둥의 모든 머신 행을 **끊김 없이** 덮는가. */
  const spineIsContinuous = (mod: GeneratedModule): boolean => {
    const y0 = Math.min(...mod.machines.map((m) => m.origin.y));
    const y1 = Math.max(...mod.machines.map((m) => m.origin.y + m.size.h - 1));
    const byColumn = new Map<number, Set<number>>();
    for (const c of mod.pipeCells) {
      const ys = byColumn.get(c.x) ?? new Set<number>();
      ys.add(c.y);
      byColumn.set(c.x, ys);
    }
    for (const ys of byColumn.values()) {
      let covers = true;
      for (let y = y0; y <= y1 && covers; y++) if (!ys.has(y)) covers = false;
      if (covers) return true;
    }
    return false;
  };

  /** battery 에 아이템 한 줄을 더해 W 3칸을 넘긴다 — 넷째 줄이 gap 으로 간다. */
  const batteryPlusOne = (count: number): ModuleInput => {
    const base = battery(count);
    // 줄을 더했으면 **저울도 다시 단다** — `supplyCapacity` 를 그대로 물려받으면 새 줄 `d` 만
    // 수치가 없어 안 깔린다(그게 옳은 동작이라, 이 검사의 전제가 사라진다).
    return scaled({ ...base, lines: [...base.lines, line("d", "input")], supplyCapacity: undefined });
  };

  it("gap 벨트가 나가는 면에서는 파이프가 점프한다 — 기둥이 안 끊긴다", () => {
    const mod = generateModule(batteryPlusOne(2));
    // 넷째 줄이 실제로 gap 으로 갔는가(= 이 테스트가 그 분기를 지나는가)를 먼저 본다.
    const gapPorts = [...mod.inputPorts].filter((p) => p.line.kind === "belt" && p.meta.side === "E");
    expect(gapPorts.length, "gap 으로 넘어간 줄이 있어야 이 테스트가 의미 있다").toBeGreaterThan(0);
    expect(mod.unroutedLines).toHaveLength(0);
    // 예전엔 여기서 unrouted 도 0, 겹침도 0인데 **기둥만 끊겨 있었다.**
    expect(spineIsContinuous(mod)).toBe(true);
  });

  it("유체가 W(출력)일 때도 같다 — gap 출력이 서쪽으로 나가는 면", () => {
    const base = battery(2);
    const mod = generateModule(scaled({
      ...base,
      supplyCapacity: undefined, // 줄이 통째로 바뀌었다 — 저울을 다시 단다.
      lines: [line("a", "input"), line("b", "input"), line("c", "input"), line("out", "output"),
        { name: "steam", kind: "pipe", role: "output" }],
      fluidTrunk: {
        ...base.fluidTrunk!,
        lines: [{ name: "steam", role: "output", side: "W", fluidboxOffset: 1, rank: 0, boxIndex: 0 }],
      },
    }));
    const gapPorts = mod.outputPorts.filter((p) => p.line.kind === "belt" && p.meta.side === "W");
    expect(gapPorts.length).toBeGreaterThan(0);
    expect(mod.unroutedLines).toHaveLength(0);
    expect(spineIsContinuous(mod)).toBe(true);
  });

  it("gap 이 없으면 점프도 없다 — 조건 ④는 폭을 함부로 안 늘린다", () => {
    // battery(2) 는 세 줄이 W 에 다 앉아 gap 이 안 생긴다. 남는 상자도 안 주면 옛 스파인 그대로.
    const mod = generateModule(battery(2));
    const yMax = Math.max(...mod.machines.map((m) => m.origin.y + m.size.h - 1));
    expect(mod.cells.filter((c) => c.x === 3 && c.y >= 0 && c.y <= yMax)).toHaveLength(yMax + 1);
  });

  it("여섯 줄까지는 안 벌어진다 — gap 은 **찼을 때만** 쓰는 마지막 수단", () => {
    const mod = generateModule(scaled({
      machine: { entityName: "assembling-machine-3", w: 3, h: 3 },
      count: 2,
      lines: [
        line("a", "input"), line("b", "input"), line("c", "input"),
        line("d", "input"), line("e", "input"), line("out", "output"),
      ],
      inserterEntityName: "inserter",
      inserters: [{ entityName: "inserter", reach: 1, throughput: 0 }],
      beltEntityName: "transport-belt",
      belts: [{ entityName: "transport-belt", throughput: 15 }],
    }));
    expect(mod.unroutedLines).toHaveLength(0);
    const [m0, m1] = mod.machines;
    expect(m1.origin.y - (m0.origin.y + m0.size.h)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// **처방은 사실 옆에서 난다** (2026-09-02 — 지도 A 삭제와 함께 옮겨온 의도)
//
// 옛 `insertingPlanner` 는 `lanes-exceed-capacity` 같은 **문장**을 냈고, 화면이 그 문자열을
// `includes` 로 뒤져 위저드 단계를 정했다. 사유 이름이 비슷하면 처방이 조용히 뒤집혔다
// (2026-08-04 실측). 이제 실패를 아는 자리가 **값**으로 낸다 — [ModulePortPlan.unpourableFix].
//
// 여기서 잠그는 것은 그 값 하나다: *"부을 수 없던 줄이 어느 단계를 가리키나."*
// ─────────────────────────────────────────────────────────────────────────────
describe("부을 수 없던 줄의 처방", () => {
  /** 긴팔(reach 2)만 고른 스펙 — 바깥 줄은 `reach 1` 팔이 있어야 상자와 머신에 함께 닿는다. */
  const longOnly = (): ModuleInput => scaled({
    machine: { entityName: "assembling-machine-2", w: 3, h: 3 },
    count: 2,
    lines: [line("iron-plate", "input"), line("gear", "output")],
    inserterEntityName: "long-handed-inserter",
    inserters: [{ entityName: "long-handed-inserter", reach: 2, throughput: 5 }],
    beltEntityName: "transport-belt",
    belts: [{ entityName: "transport-belt", throughput: 15 }],
  });

  it("reach 1 팔이 없으면 줄이 안 나고, 처방은 **인서터**를 가리킨다", () => {
    const mod = generateModule(longOnly());
    // 줄이 하나도 안 났다 — 가짜 줄을 만들지 않는다(2026-08-24 `makeLink` 폴백 삭제).
    expect(mod.unroutedLines.length).toBeGreaterThan(0);
    for (const l of mod.unroutedLines)
      expect(mod.unpourableFix?.get(`${l.role}:${l.name}`), `${l.role}:${l.name}`).toBe("inserter");
  });

  it("수량을 모르는 줄에는 **처방을 지어내지 않는다**", () => {
    const base = longOnly();
    const mod = generateModule({ ...base, supplyCapacity: { lineRates: new Map() } });
    expect(mod.unroutedLines.length).toBeGreaterThan(0);
    // 위저드 어느 단계로 보낼지 알 수 없다 — 비워 두는 것이 정직하다.
    expect([...(mod.unpourableFix?.values() ?? [])]).toHaveLength(0);
  });
});
