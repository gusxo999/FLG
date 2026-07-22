import { describe, it, expect } from "vitest";
import { generateModule, type ModuleInput } from "./clusterModule";
import { groupLinkBelts, type MachineLink } from "./allocateMachineLinks";

// 출력 fan-out 방출 검증 — 링크 그룹(=벨트) 단위로 "머신당·목적지별" belt 가 갈라 나온다.
// count≥2, W/E 에 앉는 중간 출력 케이스. 그룹핑은 packModuleTree(edgeLinkGroups)가 하므로
// 여기선 같은 함수(groupLinkBelts)로 직접 만들어 넣는다.

const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

// 자식 2대. 머신0 이 부모0·부모1 로 갈라 낸다(fan-out).
//   머신0 → 부모0 (팔1), 머신0 → 부모1 (팔1)  → cap 3 이라 한 벨트로 묶임(트렁크 공유)
//   머신1 → 부모1 (팔1)                        → 자기 벨트
const flat: MachineLink[] = [
  { fromMachine: 0, toMachine: 0, item: "gear", inserterCount: 1 },
  { fromMachine: 0, toMachine: 1, item: "gear", inserterCount: 1 },
  { fromMachine: 1, toMachine: 1, item: "gear", inserterCount: 1 },
];
const groups = groupLinkBelts(flat, 3); // [{c0: taps p0,p1}, {c1: taps p1}]

const base: ModuleInput = {
  machine: M,
  count: 2,
  lines: [
    { name: "iron", kind: "belt", role: "input" },
    { name: "gear", kind: "belt", role: "output" },
  ],
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
  throughput: { normal: 2.4, long: 1.2 },
  belts: [{ entityName: "transport-belt", throughput: 15 }],
  supplyCapacity: {
    tapCapacity: 1.2,
    lineRates: new Map([
      ["input:iron", 4],
      ["output:gear", 3],
    ]),
  },
  outputLinks: groups,
};

describe("emitOutputLinks — 출력 fan-out (그룹=벨트)", () => {
  const mod = generateModule(base);

  it("그룹핑: 같은 자식 머신의 작은 링크들이 한 벨트로 묶인다", () => {
    expect(groups.map((g) => g.taps.length)).toEqual([2, 1]);
  });

  it("그룹마다 출력 포트 하나 (옛 트렁크였다면 gear 포트 1개뿐)", () => {
    expect(mod.outputPorts).toHaveLength(2);
  });

  it("포트가 전부 W면으로 나간다 (부모 쪽으로 꺾임)", () => {
    expect(mod.outputPorts.every((p) => p.face === "W")).toBe(true);
  });

  it("두 벨트가 서로 다른 행에서 나간다", () => {
    const ys = mod.outputPorts.map((p) => p.anchor.y);
    expect(new Set(ys).size).toBe(2);
  });

  // 순서 우선(문서 체크리스트 "(나)") — 정렬(부모 Y순 재배치)은 안 한다. 그룹 배열 순서가
  // 곧 좌석 행 순서다(allocateLinkFaces 가 groups.forEach 로 위→아래 누적). 채널을 가로질러
  // 교차하는 홉이 생겨도 channelGeometryPlanner 가 지하로 안전히 우회시키므로(정확성 문제
  // 아님), 이 배열 순서를 재정렬할 필요가 없다는 게 사용자 결정이다 — 그 불변식을 못 박는다.
  it("그룹 배열 순서 = 좌석 행 순서 — 정렬 없이 그대로", () => {
    const rows = mod.outputPorts.map((p) => p.anchor.y);
    const sorted = [...rows].sort((a, b) => a - b);
    expect(rows).toEqual(sorted);
  });

  it("머신0 벨트는 팔 2개(그룹 합), 머신1 벨트는 팔 1개", () => {
    // 벨트 셀 수 = 팔 수(연속 좌석 k행을 덮는 세로 belt).
    expect(mod.outputPorts.map((p) => p.cells.length).sort()).toEqual([1, 2]);
  });

  it("셀 좌표가 겹치지 않는다 (occupancy 충돌 0)", () => {
    const seen = new Set<string>();
    let dup = 0;
    for (const c of mod.cells) {
      const k = `${c.x},${c.y}`;
      if (seen.has(k)) dup++;
      seen.add(k);
    }
    expect(dup).toBe(0);
  });

  it("출력 줄이 unrouted 로 떨어지지 않는다 (좌석 충분)", () => {
    expect(mod.unroutedLines.filter((l) => l.role === "output")).toHaveLength(0);
  });
});

// 2026-07-19 등재했던 갭의 회귀 테스트 — 링크 방출이 tap 분기 안에만 있어서, 링크 없는 줄이
// 좌석을 넘겨 모듈이 direct 로 떨어지면 **링크 포트가 통째로 사라졌다**(자식 direct + 부모 tap
// → 포트 모양이 어긋나 홉이 샘). 이제 링크 방출은 모드 판정 **이전에, 무관하게** 돈다.
describe("링크 방출은 tap/direct 판정과 무관하다", () => {
  const mod = generateModule({
    machine: M,
    count: 1,
    lines: [
      { name: "heavy", kind: "belt", role: "input" }, // 좌석 초과 유발(링크 없음)
      { name: "gear", kind: "belt", role: "output" }, // 링크 줄
    ],
    inserterEntityName: "inserter",
    beltEntityName: "transport-belt",
    longInserter: { entityName: "long-handed-inserter", reach: 2 },
    throughput: { normal: 6, long: 6 },
    belts: [{ entityName: "transport-belt", throughput: 20 }],
    supplyCapacity: {
      tapCapacity: 6,
      lineRates: new Map([["input:heavy", 60], ["output:gear", 6]]), // heavy = 팔 10개 → 좌석 초과
    },
    outputLinks: [{ fromMachine: 0, item: "gear", taps: [{ toMachine: 0, inserterCount: 1 }] }],
  });

  it("링크 없는 줄이 좌석을 넘겨 모듈은 direct 로 떨어진다", () => {
    expect(mod.supply?.mode).toBe("direct");
  });

  it("그래도 링크 출력 포트는 그대로 나온다 — 개수만이 아니라 **모양**이 링크다", () => {
    const gear = mod.outputPorts.filter((p) => p.line.name === "gear");
    expect(gear).toHaveLength(1);
    // 개수로는 옛 버그를 못 잡는다 — 옛 코드도 direct 방출로 gear 포트를 하나 냈다.
    // 구분은 모양: 링크 포트는 **자기 벨트**를 갖고(anchor 는 그 벨트 바깥 2칸),
    // 다이렉트 포트는 벨트가 없다(cells: []).
    expect(gear[0].cells.length).toBeGreaterThan(0);
  });

  it("링크가 먼저 먹은 좌석을 나머지 줄이 안 밟는다 (셀 충돌 0)", () => {
    const seen = new Set<string>();
    let dup = 0;
    for (const c of mod.cells) {
      const k = `${c.x},${c.y}`;
      if (seen.has(k)) dup++;
      seen.add(k);
    }
    expect(dup).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 면 넘나들기(거대 출력) — 머신 하나의 한 면에는 인서터가 h개까지만 앉는다(d1 칸이 그것뿐).
// 팔이 그보다 많으면 **N/S(gap)** 로 넘어간다. 반대 옆면(E)이 아닌 이유: E 로 넘기면 벨트가
// 채널 반대쪽에서 출발해 **되돌아올 길이 없다**. gap 으로 넘기면 가로 벨트가 서쪽 변까지 와서
// 90° 꺾이고, 그 꺾이는 칸이 곧 평범한 W 포트다.
// ─────────────────────────────────────────────────────────────────────────────

const linkedBase = {
  machine: M,
  count: 2,
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
  throughput: { normal: 2.4, long: 1.2 },
  belts: [{ entityName: "transport-belt", throughput: 15 }],
};

describe("거대 출력 — W면이 차면 gap 으로 넘어간다", () => {
  // 머신 0 에서 팔 5개(그룹 3 + 그룹 2). W면 좌석은 h=3 뿐 → 둘째 그룹은 아래 gap 으로.
  const mod = generateModule({
    ...linkedBase,
    lines: [{ name: "gear", kind: "belt", role: "output" }],
    outputLinks: [
      { fromMachine: 0, item: "gear", taps: [{ toMachine: 0, inserterCount: 3 }] },
      { fromMachine: 0, item: "gear", taps: [{ toMachine: 1, inserterCount: 2 }] },
    ],
  } as ModuleInput);

  it("두 그룹 다 살아남는다 (넘친 쪽을 버리지 않는다)", () => {
    expect(mod.outputPorts).toHaveLength(2);
    expect(mod.unroutedLines).toHaveLength(0);
  });

  it("둘 다 W 로 나간다 — gap 그룹도 모서리에서 꺾여 평범한 W 포트가 된다", () => {
    expect(mod.outputPorts.map((p) => p.face)).toEqual(["W", "W"]);
    expect(mod.outputPorts.map((p) => p.meta.side)).toEqual(["W", "W"]);
  });

  it("팔 합은 언제나 total (3+2)", () => {
    expect(mod.outputPorts.map((p) => p.cells.length)).toEqual([3, 2]);
  });

  it("gap 이 열린다 — 머신 두 대가 더 이상 밀착이 아니다", () => {
    const [m0, m1] = mod.machines;
    expect(m1.origin.y - (m0.origin.y + m0.size.h)).toBe(2); // 좌석 1줄 + 가로 벨트 1줄
  });

  it("gap 포트는 gap 행에 선다 (머신 행이 아니다)", () => {
    const [m0] = mod.machines;
    const corner = mod.outputPorts[1];
    expect(corner.anchor.y).toBeGreaterThanOrEqual(m0.origin.y + m0.size.h);
  });

  it("셀 좌표가 겹치지 않는다", () => {
    const seen = new Set<string>();
    let dup = 0;
    for (const c of mod.cells) {
      const k = `${c.x},${c.y}`;
      if (seen.has(k)) dup++;
      seen.add(k);
    }
    expect(dup).toBe(0);
  });
});

// 넘침이 **남의 선호 면**을 먼저 먹으면 안 된다 — 배정은 ① 양쪽의 선호 면 ② 남은 gap 순이다.
describe("넘침은 남의 선호 면을 먼저 먹지 않는다", () => {
  const mod = generateModule({
    ...linkedBase,
    lines: [
      { name: "gear", kind: "belt", role: "output" },
      { name: "iron", kind: "belt", role: "input" },
    ],
    outputLinks: [
      { fromMachine: 0, item: "gear", taps: [{ toMachine: 0, inserterCount: 3 }] },
      { fromMachine: 0, item: "gear", taps: [{ toMachine: 1, inserterCount: 2 }] }, // W 초과분
    ],
    inputLinks: [{ fromMachine: 9, item: "iron", taps: [{ toMachine: 0, inserterCount: 3 }] }],
  } as ModuleInput);

  it("입력은 선호 면(E)을 그대로 얻는다", () => {
    const iron = mod.inputPorts.filter((p) => p.line.name === "iron");
    expect(iron).toHaveLength(1);
    expect(iron[0].face).toBe("E");
    expect(iron[0].cells.length).toBe(3);
  });

  it("출력 넘침은 gap 으로 가고 아무도 안 굶는다", () => {
    expect(mod.outputPorts).toHaveLength(2);
    expect(mod.unroutedLines).toHaveLength(0);
  });
});

// gap 폭은 **자리마다 다르다** — 우리가 고르는 값이 아니라 그 gap 을 지나는 가로 벨트에서
// 유도된 부산물이라, 안 쓰는 gap 은 0 으로 남아 머신이 밀착한다.
describe("gap 은 필요한 자리만, 필요한 만큼만 벌어진다", () => {
  // 머신 3대. 머신0 만 W면(3행)을 넘겨 아래 gap(0번)으로 넘친다. 머신1·2 는 안 넘친다.
  const mod = generateModule({
    ...linkedBase,
    count: 3,
    lines: [{ name: "gear", kind: "belt", role: "output" }],
    outputLinks: [
      { fromMachine: 0, item: "gear", taps: [{ toMachine: 0, inserterCount: 3 }] },
      { fromMachine: 0, item: "gear", taps: [{ toMachine: 1, inserterCount: 2 }] }, // W 초과 → gap0
      { fromMachine: 1, item: "gear", taps: [{ toMachine: 1, inserterCount: 2 }] },
      { fromMachine: 2, item: "gear", taps: [{ toMachine: 2, inserterCount: 2 }] },
    ],
  } as ModuleInput);

  const gapOf = (i: number) => {
    const [a, b] = [mod.machines[i], mod.machines[i + 1]];
    return b.origin.y - (a.origin.y + a.size.h);
  };

  it("쓰는 gap 만 벌어지고 나머지는 밀착(0)", () => {
    expect(gapOf(0)).toBe(2); // 머신0 의 S 면이 쓴다 → 좌석 1 + 벨트 1
    expect(gapOf(1)).toBe(0); // 아무도 안 쓴다 → 낭비 0
  });

  it("네 그룹 다 살아남고 팔 합이 보존된다", () => {
    expect(mod.outputPorts).toHaveLength(4);
    expect(mod.outputPorts.reduce((s, p) => s + p.cells.length, 0)).toBe(9);
    expect(mod.unroutedLines).toHaveLength(0);
  });
});

// 레인(depth)과 팔 종류는 **짝**이다 — 배정이 "이 벨트는 d3 이니 긴팔로 집어라"라고 정해
// LinkFacePlan.inserter 에 적어 보내는데, 방출이 그걸 안 읽고 기본 인서터를 놓으면 팔이
// 벨트에 **닿지 않는다**(조용히 굶는다). 입력 방출은 처음부터 읽고 있었고 출력만 빠져 있었다.
describe("깊은 레인 그룹은 긴팔로 집는다 (배정이 정한 팔 종류를 따른다)", () => {
  // 같은 머신에서 그룹 둘. 좌석은 남지만(1+1 ≤ 3) 기본 레인(d2)은 첫 그룹이 이미 관통해
  // 있으므로 둘째 그룹은 긴팔 레인(d = 1+reach = 3)으로 밀린다. count=1 이라 gap 폴백도 없다.
  const mod = generateModule({
    ...linkedBase,
    count: 1,
    lines: [{ name: "gear", kind: "belt", role: "output" }],
    outputLinks: [
      { fromMachine: 0, item: "gear", taps: [{ toMachine: 0, inserterCount: 1 }] },
      { fromMachine: 0, item: "gear", taps: [{ toMachine: 1, inserterCount: 1 }] },
    ],
  } as ModuleInput);

  const [m0] = mod.machines;
  /** 이 포트의 벨트가 W 면에서 몇 칸 바깥인가. */
  const depthOf = (i: number) => m0.origin.x - mod.outputPorts[i].cells[0].x;

  it("두 그룹이 서로 다른 레인에 선다", () => {
    expect(mod.outputPorts).toHaveLength(2);
    expect(depthOf(0)).toBe(2);
    expect(depthOf(1)).toBe(3);
  });

  it("d3 벨트를 집는 팔은 긴팔이다", () => {
    // 탭 인서터 = 좌석(d1) 칸. 그 칸의 엔티티가 레인 깊이와 짝이어야 한다.
    const seatX = m0.origin.x - 1;
    const seatsOf = (i: number) => {
      const beltYs = new Set(mod.outputPorts[i].cells.map((c) => c.y));
      return mod.cells.filter((c) => c.x === seatX && beltYs.has(c.y));
    };
    expect(seatsOf(0).map((c) => c.cell.entityName)).toEqual(["inserter"]);
    expect(seatsOf(1).map((c) => c.cell.entityName)).toEqual(["long-handed-inserter"]);
  });
});

// gap 폭과 방출 기하가 **같은 값**(LinkFacePlan.laneDepth)에서 나온다는 걸 구조로 확인한다.
// 상수 재확인이 아니라 결과 좌표를 본다 — 둘이 어긋나면 벨트가 옆 머신 몸통 위에 놓인다.
describe("gap 그룹의 벨트는 gap 안에 있다", () => {
  const mod = generateModule({
    ...linkedBase,
    lines: [{ name: "gear", kind: "belt", role: "output" }],
    outputLinks: [
      { fromMachine: 0, item: "gear", taps: [{ toMachine: 0, inserterCount: 3 }] },
      { fromMachine: 0, item: "gear", taps: [{ toMachine: 1, inserterCount: 2 }] }, // W 초과 → gap
    ],
  } as ModuleInput);

  it("넘친 그룹의 벨트 칸이 두 머신 사이 빈 띠 안에 든다", () => {
    const [m0, m1] = mod.machines;
    const bandTop = m0.origin.y + m0.size.h; // gap 첫 줄
    const bandBot = m1.origin.y - 1; // gap 마지막 줄
    expect(bandBot).toBeGreaterThanOrEqual(bandTop); // gap 이 실제로 열렸다
    for (const c of mod.outputPorts[1].cells) {
      expect(c.y).toBeGreaterThanOrEqual(bandTop);
      expect(c.y).toBeLessThanOrEqual(bandBot);
    }
  });

  it("어떤 셀도 머신 몸통 위에 없다", () => {
    const body = new Set<string>();
    for (const m of mod.machines)
      for (let x = m.origin.x; x < m.origin.x + m.size.w; x++)
        for (let y = m.origin.y; y < m.origin.y + m.size.h; y++) body.add(`${x},${y}`);
    const on = mod.cells.filter((c) => body.has(`${c.x},${c.y}`));
    expect(on).toHaveLength(0);
  });
});
