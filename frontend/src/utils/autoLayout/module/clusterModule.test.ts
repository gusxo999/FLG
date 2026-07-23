import { describe, it, expect } from "vitest";
import { generateModule, type GeneratedModule, type ModuleInput } from "./clusterModule";
import type { IoLine } from "./clusterPortPlanner";
import { EntityType } from "../../../types/layout";

// ─────────────────────────────────────────────────────────────────────────────
// 픽스처
// ─────────────────────────────────────────────────────────────────────────────

const line = (name: string, role: "input" | "output"): IoLine => ({
  name,
  kind: "belt",
  role,
});

/** copper-cable 류: 입력 1(copper-plate) + 출력 1(copper-cable), 일반 인서터만(용량 2). */
const copperCable: ModuleInput = {
  machine: { entityName: "assembling-machine-2", w: 3, h: 3 },
  count: 5,
  lines: [line("copper-plate", "input"), line("copper-cable", "output")],
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
};

/** electronic-circuit 류: 입력 2 + 출력 1, 긴팔 보유(용량 4 → 면당 2레인). */
const electronicCircuit: ModuleInput = {
  machine: { entityName: "assembling-machine-2", w: 3, h: 3 },
  count: 4,
  lines: [
    line("iron-plate", "input"),
    line("copper-cable", "input"),
    line("electronic-circuit", "output"),
  ],
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
};

/** electric-motor 류: 입력 3 + 출력 1 = 정확히 용량 4(긴팔). 4스트림 스트레스. */
const electricMotor: ModuleInput = {
  machine: { entityName: "assembling-machine-2", w: 3, h: 3 },
  count: 3,
  lines: [
    line("iron-gear-wheel", "input"),
    line("copper-cable", "input"),
    line("iron-plate", "input"),
    line("electric-motor", "output"),
  ],
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
};

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
    supplyCapacity: {
      beltCapacity: 100,
      tapCapacity: 5,
      // copper-plate 30 / 3대 = 10, ceil(10/5) = 탭 2개. copper-cable(출력)은 수치 없음 → 1.
      lineRates: new Map([["input:copper-plate", 30]]),
    },
  };

  // 기하: outputSide=W → 입력 copper-plate 는 **E 면**. 머신 x=0..2, E 면 depth 1(좌석) = x=3,
  // depth 2(near 벨트) = x=4.
  it("고수요 입력이 머신마다 탭 인서터 2개로 집힌다", () => {
    const mod = generateModule(highDemand);
    expect(mod.supply?.mode).toBe("tap");
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

  // **머신마다 자기 벨트**([[ParallelBelt]]) — 2026-07-23 부터 외부 줄도 링크와 같은 방출기를
  // 탄다. 예전엔 벨트 한 줄이 기둥 전체를 훑고 포트가 품목당 하나였다(옛 트렁크).
  //
  // 왜 바뀌었나: 한 줄에 몰아 실으면 그 줄이 넘치는지를 **머신 수만큼 곱해서** 따져야 하는데,
  // 그 곱셈이 빠진 자리가 이번 세션에 고친 포화 버그였다. 머신마다 갈라 두면 한 줄의 부하가
  // 팔 개수로 곧장 보이고, 합치기는 좌표가 생긴 뒤 **최적화**로 올린다(못 합치면 이대로 둔다).
  it("머신마다 자기 벨트 · 자기 포트 — 합류하지 않는다", () => {
    const mod = generateModule(highDemand);
    const plate = mod.inputPorts.filter((p) => p.line.name === "copper-plate");
    expect(plate).toHaveLength(3); // 머신 3대 → 벨트 3줄
    // 포트가 전부 다른 행에 선다 = 세 줄이 서로 다른 줄이다.
    expect(new Set(plate.map((p) => p.anchor.y)).size).toBe(3);
    // 각 머신의 벨트는 **자기 좌석 행만** 덮는다(E near, x=4).
    for (const m of mod.machines) {
      const own = mod.cells.filter(
        (c) => c.cell.entityType === EntityType.Belt && c.x === 4 &&
          c.y >= m.origin.y && c.y < m.origin.y + m.size.h,
      );
      expect(own.length, `머신 ${m.id} 의 벨트`).toBe(2); // 탭 2개 = 벨트 2칸
    }
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
 * **[requiredInserterCount] 만큼 팔을 놓는다 — 벨트가 좁으면 줄을 늘려서라도.**
 *
 * 팔 개수는 공급 방식과 무관한 물리량이다 — 인서터 하나가 나르는 양은 벨트에서 집든
 * 상자에서 집든 같다. 그래서 "팔 2개"라고 판정한 수요는 어떻게 깔든 팔 2개다.
 *
 * 예전엔 다이렉트가 이 수를 묻지도 않고 줄당 팔 하나만 놓고 "성공"이라 보고했다 —
 * 실측(2026-07-16 kr-glass ← kr-sand)에서 초당 8개를 먹는 머신에 초당 0.667개짜리 인서터가
 * 하나 붙은 배치가 나왔다. 게임에 넣으면 굶는다.
 *
 * **2026-07-23 부터 외부 줄은 [[ParallelBelt]] 로 나간다.** 그래서 "벨트가 좁다"의 답이
 * 바뀌었다: 예전엔 벨트를 포기하고 다이렉트(상자 1:1)로 물러났고, 지금은 **줄을 늘린다**.
 * 팔 총합은 어느 쪽이든 같다 — 그게 이 describe 가 지키는 불변식이다.
 */
describe("좁은 벨트 — 팔을 깎는 대신 줄을 늘린다", () => {
  /** 벨트 한 줄이 팔 하나밖에 못 받는 수요(그릇 1) + 팔은 머신당 2개 필요. */
  const directHighDemand: ModuleInput = {
    ...copperCable,
    count: 2,
    supplyCapacity: {
      beltCapacity: 1, // 팔 하나(5/s)도 못 받는 벨트 → 그릇 1 → 팔마다 자기 줄
      tapCapacity: 5,
      // copper-plate 20 / 2대 = 10, ceil(10/5) = 팔 2개. copper-cable(출력)은 수치 없음 → 1.
      lineRates: new Map([["input:copper-plate", 20]]),
    },
  };

  it("머신마다 팔 2개가 붙는다 (굶지 않는다)", () => {
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

  it("팔마다 자기 줄 — 그릇이 1이면 벨트도 상자도 팔 수만큼", () => {
    const mod = generateModule(directHighDemand);
    const plateChests = mod.chests.filter((c) => c.content === "copper-plate");
    // 머신 2대 × 팔 2개 = 줄 4개. (예전엔 머신당 1개 = 2개였다.)
    expect(plateChests).toHaveLength(4);
    // 포트도 그만큼 — 줄 하나가 포트 하나다.
    expect(mod.inputPorts.filter((p) => p.line.name === "copper-plate")).toHaveLength(4);
    // 좌표 고유 — 팔마다 다른 행에 앉는다.
    expect(new Set(plateChests.map((c) => `${c.origin.x},${c.origin.y}`)).size).toBe(4);
  });

  it("수량을 모르는 줄은 옛 경로 그대로 — 없는 숫자로 줄을 늘리지 않는다", () => {
    const mod = generateModule(directHighDemand);
    // copper-cable(출력)은 lineRates 에 없다 → 그룹이 안 만들어져 [insertingPlanner] 가 맡는다.
    expect(mod.chests.filter((c) => c.content === "copper-cable")).toHaveLength(1);
  });

  it("한 면에 다 못 앉으면 gap 으로 넘어간다 — 팔을 깎지 않는다", () => {
    // 팔 4개가 필요한데 3×3 머신의 한 면은 3칸뿐. 예전엔 여기서 정직하게 포기했고(옛 경로의
    // 면 예산), 지금은 넷째 줄이 머신 사이 gap 으로 넘어가 **팔 4개를 다 앉힌다**.
    const tooHungry: ModuleInput = {
      ...copperCable,
      count: 2,
      supplyCapacity: {
        beltCapacity: 1,
        tapCapacity: 5,
        lineRates: new Map([["input:copper-plate", 40]]), // 40/2 = 20, ceil(20/5) = 팔 4개 > 3칸
      },
    };
    const mod = generateModule(tooHungry);
    expect(mod.unroutedLines).toHaveLength(0);
    // 머신 2대 × 팔 4개 = 8줄. 하나도 안 깎였다.
    expect(mod.inputPorts.filter((p) => p.line.name === "copper-plate")).toHaveLength(8);
    const seats = mod.cells.filter(
      (c) => c.cell.entityType === EntityType.Inserter && c.x === 3,
    );
    expect(seats.length).toBeGreaterThanOrEqual(6); // E 면 3칸 × 2대는 꽉 찬다
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

  it("N면 2레인 공존 — N2(일반) + N3(긴팔)이 같은 면에서 미탭 0 으로 방출", () => {
    // external 입력 4개 = W/E 용량(4)을 정확히 채우는 대신 E2, E3, N2, N3 로 분산.
    const mod = generateModule({
      machine: { entityName: "assembling-machine-3", w: 3, h: 3 },
      count: 1,
      lines: [ext("a"), ext("b"), ext("c"), ext("d")],
      inserterEntityName: "inserter",
      beltEntityName: "transport-belt",
      longInserter: { entityName: "long-handed-inserter", reach: 2 },
      nsExposure: ["N"],
    });
    render(mod, "count=1, external 입력 4 (E2 E3 N2 N3)");

    expect(mod.unroutedLines).toHaveLength(0);
    expect(mod.inputPorts).toHaveLength(4);
    const slots = mod.inputPorts.map((p) => `${p.meta.side}${p.meta.laneDepth}/${p.meta.inserter}`);
    expect(slots).toEqual(["E2/normal", "E3/long", "N2/normal", "N3/long"]);

    // 면 교차 충돌 0 — E 레인(세로)과 N 레인(가로)이 코너에서 겹치지 않는다.
    const seen = new Set<string>();
    for (const c of mod.cells) {
      const k = `${c.x},${c.y}`;
      expect(seen.has(k), `중복 셀 ${k}`).toBe(false);
      seen.add(k);
    }
    // N 포트 상자는 머신 위쪽(음수 y 방향)에 있다.
    const machineTop = 0;
    for (const p of mod.inputPorts.filter((x) => x.meta.side === "N")) {
      expect(p.anchor.y).toBeLessThan(machineTop);
    }
  });

  it("긴팔 없음 → 면당 1레인 — 노출 N 은 N2(일반)만 제공", () => {
    // 용량 게이트 = W1+E1 = 2. 입력 2개: E2 다음 external 이라 W-spill 대신 N2.
    const mod = generateModule({
      machine: { entityName: "assembling-machine-2", w: 3, h: 3 },
      count: 1,
      lines: [ext("a"), ext("b")],
      inserterEntityName: "inserter",
      beltEntityName: "transport-belt",
      nsExposure: ["N"],
    });
    render(mod, "count=1, 일반만, external 입력 2 (E2 N2)");

    expect(mod.unroutedLines).toHaveLength(0);
    const slots = mod.inputPorts.map((p) => `${p.meta.side}${p.meta.laneDepth}/${p.meta.inserter}`);
    expect(slots).toEqual(["E2/normal", "N2/normal"]);
  });

  it("count≥2 는 nsExposure 를 받아도 packing 이 안 주므로 여기선 미전달 규약만 확인 — nsExposure 미지정 시 기존 W-spill", () => {
    const mod = generateModule({
      machine: { entityName: "assembling-machine-3", w: 3, h: 3 },
      count: 1,
      lines: [ext("a"), ext("b"), ext("c"), { name: "out", kind: "belt", role: "output" }],
      inserterEntityName: "inserter",
      beltEntityName: "transport-belt",
      longInserter: { entityName: "long-handed-inserter", reach: 2 },
      // nsExposure 미지정 → 기존 동작.
    });
    const c = mod.inputPorts.find((p) => p.line.name === "c")!;
    expect(c.meta.side).toBe("W"); // W-spill (기존)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// gap 면을 양쪽에서 채울 때 — 좌석 장부가 하나면 같은 칸을 두 번 준다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **출력은 서→동, 입력은 동→서로 gap 면을 채운다.** 둘이 한 장부를 같이 쓰면 "이미 n칸
 * 찼다"를 **각자 자기 끝에서** 세어, 출력이 서쪽 첫 칸을 잡고 입력이 "동쪽에서 n칸 건너뛴"
 * 칸을 잡는다 — 폭이 3이고 n=1 이면 그 둘이 **같은 칸**이다.
 *
 * 좌석 장부는 "3칸 중 3칸"이라 통과시키므로 배정 단계에선 안 걸리고, 방출 단계에서 좌석이
 * 이미 점유됐다며 그 링크가 **조용히 unrouted 로** 떨어진다(2026-07-23 발견 — 외부 줄이
 * gap 을 쓰기 시작하면서 처음 드러났다. 그전엔 gap 한 면에 한쪽만 왔다).
 */
describe("gap 면을 양쪽에서 채운다 — 좌석이 겹치지 않는다", () => {
  const M3 = { entityName: "assembling-machine-3", w: 3, h: 3 };
  const mod = generateModule({
    machine: M3,
    count: 2,
    lines: [
      { name: "x", kind: "belt", role: "input" },
      { name: "prod", kind: "belt", role: "output" },
    ],
    inserterEntityName: "inserter",
    beltEntityName: "transport-belt",
    // 입력 링크: 머신마다 팔 2개짜리 그룹 **둘** → E 면(3칸)이 넘쳐 하나가 gap 으로 간다.
    inputLinks: [
      { item: "x", from: new Map([[0, 2]]), to: new Map([[0, 2]]) },
      { item: "x", from: new Map([[1, 2]]), to: new Map([[0, 2]]) },
    ],
    // 외부 출력: 40/2대 = 20, 팔당 5 → 팔 4개/머신. 그릇 1이라 팔마다 자기 줄 → W(3칸)가
    // 넘쳐 나머지가 gap 으로 간다. 그래서 **같은 gap 면에 출력·입력이 같이 온다**.
    supplyCapacity: { beltCapacity: 1, tapCapacity: 5, lineRates: new Map([["output:prod", 40]]) },
  });

  it("아무것도 조용히 떨어지지 않는다", () => {
    expect(mod.unroutedLines.map((l) => `${l.role}:${l.name}`)).toEqual([]);
  });

  it("셀이 겹치지 않는다 — 겹침이 곧 같은 칸을 두 번 준 증거", () => {
    const seen = new Set<string>();
    const dup: string[] = [];
    for (const c of mod.cells) {
      const k = `${c.x},${c.y}`;
      if (seen.has(k)) dup.push(k);
      seen.add(k);
    }
    expect(dup).toEqual([]);
  });

  it("팔이 하나도 안 깎였다 — 입력 4개 + 출력 8개", () => {
    const inserters = mod.cells.filter((c) => c.cell.entityType === EntityType.Inserter);
    // 좌석(탭) 12개 + 줄마다 포트 인서터 하나. 좌석만 세려면 포트 인서터를 빼야 하는데,
    // 여기선 총합이 줄지 않았다는 것만 확인한다(깎이면 총합이 준다).
    expect(inserters.length).toBeGreaterThanOrEqual(12);
  });
});
