import { describe, it, expect } from "vitest";
import { generateModule, type GeneratedModule, type ModuleInput } from "./clusterModule";
import type { MachineLink, MachineLinkGroup } from "./allocateMachineLinks";
import { directionToVector } from "../containerRouting";

/**
 * **한 그룹의 벨트가 다른 그룹의 벨트로 흘러들면 안 된다.**
 *
 * 그룹 하나 = 벨트 하나 = 포트 한 쌍인데, 벨트 A 의 끝 칸이 벨트 B 를 향해 있으면 A 의 물건이
 * B 를 타고 **B 의 포트로 나간다** — 품목이 같아 오염은 없지만 장부가 통째로 거짓이 된다
 * (A 의 부모는 굶고 B 의 부모는 넘친다). 셀이 안 겹치는지(occupancy)만 봐서는 절대 못 잡는다.
 */
function beltLeaks(mod: GeneratedModule): string[] {
  const owner = new Map<string, number>();
  const ports = [...mod.outputPorts, ...mod.inputPorts];
  ports.forEach((p, i) => p.cells.forEach((c) => owner.set(`${c.x},${c.y}`, i)));
  const leaks: string[] = [];
  ports.forEach((p, i) => {
    for (const c of p.cells) {
      const v = directionToVector(c.cell.direction);
      const into = owner.get(`${c.x + v.x},${c.y + v.y}`);
      if (into !== undefined && into !== i) leaks.push(`port${i} (${c.x},${c.y}) → port${into}`);
    }
  });
  return leaks;
}

// 출력 fan-out 방출 검증 — 링크 그룹(=벨트) 단위로 "머신당·목적지별" belt 가 갈라 나온다.
// count≥2, W/E 에 앉는 중간 출력 케이스. **v1 은 링크 하나가 곧 벨트 하나**라
// (docs/auto-layout-wizard.cluster-redesign.md) 여기서도 링크를 그대로 그룹으로 편다.

const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

// 자식 2대. 머신0 이 부모0·부모1 로 갈라 낸다(fan-out).
//   머신0 → 부모0 (팔1), 머신0 → 부모1 (팔1)  → 목적지가 다르니 **벨트도 따로**
//   머신1 → 부모1 (팔1)                        → 자기 벨트
const flat: MachineLink[] = [
  { fromMachine: 0, toMachine: 0, item: "gear", inserterCount: 1 },
  { fromMachine: 0, toMachine: 1, item: "gear", inserterCount: 1 },
  { fromMachine: 1, toMachine: 1, item: "gear", inserterCount: 1 },
];
const groups: MachineLinkGroup[] = flat.map((l) => ({
  fromMachine: l.fromMachine,
  item: l.item,
  taps: [{ toMachine: l.toMachine, inserterCount: l.inserterCount }],
}));

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

  it("링크 하나 = 벨트 하나 — 목적지가 다르면 안 묶는다", () => {
    expect(groups.map((g) => g.taps.length)).toEqual([1, 1, 1]);
  });

  it("그룹마다 출력 포트 하나 (옛 트렁크였다면 gear 포트 1개뿐)", () => {
    expect(mod.outputPorts).toHaveLength(3);
  });

  it("포트가 전부 W면으로 나간다 (부모 쪽으로 꺾임)", () => {
    expect(mod.outputPorts.every((p) => p.face === "W")).toBe(true);
  });

  it("벨트마다 서로 다른 행에서 나간다", () => {
    const ys = mod.outputPorts.map((p) => p.anchor.y);
    expect(new Set(ys).size).toBe(3);
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

  it("벨트마다 팔 1개 — 링크의 팔 수 그대로", () => {
    // 벨트 셀 수 = 팔 수(연속 좌석 k행을 덮는 세로 belt).
    expect(mod.outputPorts.map((p) => p.cells.length)).toEqual([1, 1, 1]);
  });

  it("머신0 의 두 벨트가 **같은 깊이**를 나눠 쓴다 — 행이 안 겹치니 다툴 게 없다", () => {
    const xs = mod.outputPorts.slice(0, 2).map((p) => p.cells[0].x);
    expect(new Set(xs).size).toBe(1);
  });

  it("벨트끼리 새지 않는다", () => {
    expect(beltLeaks(mod)).toEqual([]);
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

  it("입력·출력이 섞여 있어도 벨트끼리 새지 않는다", () => {
    expect(beltLeaks(mod)).toEqual([]);
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

// 벨트가 자기 구간 끝에서 **포트 쪽으로 꺾이지 않고** 면을 따라 계속 흐르면, 바로 옆 머신
// 그룹의 벨트로 물건이 흘러든다. 머신 사이 gap 이 0 이면 두 벨트가 실제로 맞닿는다.
describe("이웃 머신 그룹의 벨트로 물건이 새지 않는다", () => {
  // 머신0 이 W면 3행을 꽉 채우고(rows 0,1,2), 머신1 그룹은 바로 다음 행(row 3)에서 시작한다
  // — gap 이 0 이라 두 벨트가 세로로 맞닿는다.
  const mod = generateModule({
    ...linkedBase,
    lines: [{ name: "gear", kind: "belt", role: "output" }],
    outputLinks: [
      { fromMachine: 0, item: "gear", taps: [{ toMachine: 0, inserterCount: 3 }] },
      { fromMachine: 1, item: "gear", taps: [{ toMachine: 1, inserterCount: 1 }] },
    ],
  } as ModuleInput);

  it("두 벨트가 실제로 맞닿는 배치다 (전제 확인)", () => {
    const ys = mod.outputPorts.flatMap((p) => p.cells.map((c) => c.y));
    expect(new Set(mod.outputPorts.flatMap((p) => p.cells.map((c) => c.x))).size).toBe(1); // 같은 열
    expect(Math.max(...ys) - Math.min(...ys)).toBe(ys.length - 1); // 빈 행 없이 연속
  });

  it("머신1 의 물건이 머신0 의 벨트로 흘러들지 않는다", () => {
    expect(beltLeaks(mod)).toEqual([]);
  });
});

// **반출 사다리** — gap 은 나가는 쪽(서쪽)이 면과 **평행**이라, W/E 처럼 "자기 구간만 덮고
// 꺾기"가 안 통한다. 모든 벨트가 서쪽 변까지 달려야 하므로 같은 줄 두 벨트는 반드시 합쳐진다.
// 그래서 n 번째 그룹은 **한 칸 더 깊은 줄로 내려가서** 달린다. 내려가는 건 벨트→벨트라
// 팔 길이와 무관하다(팔은 수집 줄 d2 까지만 닿으면 된다).
describe("gap 반출 사다리 — 한 면에 벨트 여러 줄", () => {
  // 머신0 이 W면 3행을 채우고, 넘친 그룹 **둘**이 같은 gap 면(S)으로 간다.
  const mod = generateModule({
    ...linkedBase,
    lines: [{ name: "gear", kind: "belt", role: "output" }],
    outputLinks: [
      { fromMachine: 0, item: "gear", taps: [{ toMachine: 0, inserterCount: 3 }] }, // W 를 채움
      { fromMachine: 0, item: "gear", taps: [{ toMachine: 1, inserterCount: 1 }] }, // → gap 1번째
      { fromMachine: 0, item: "gear", taps: [{ toMachine: 1, inserterCount: 1 }] }, // → gap 2번째
    ],
  } as ModuleInput);

  it("셋 다 살아남는다 — 예전엔 면당 한 줄이라 셋째가 unrouted 였다", () => {
    expect(mod.outputPorts).toHaveLength(3);
    expect(mod.unroutedLines).toHaveLength(0);
  });

  it("gap 두 그룹의 포트가 서로 다른 줄에 선다 (사다리)", () => {
    const [, a, b] = mod.outputPorts;
    expect(a.anchor.y).not.toBe(b.anchor.y);
    expect(Math.abs(a.anchor.y - b.anchor.y)).toBe(1); // 딱 한 칸씩만 깊어진다
  });

  it("둘째 그룹이 첫째보다 깊은 줄로 달린다", () => {
    const [, a, b] = mod.outputPorts;
    const depthOf = (p: (typeof mod.outputPorts)[number]) => p.anchor.y - (mod.machines[0].origin.y + 3);
    expect(depthOf(b)).toBeGreaterThan(depthOf(a));
  });

  it("벨트끼리 새지 않는다 — 사다리가 남의 줄을 밟지 않는다", () => {
    expect(beltLeaks(mod)).toEqual([]);
  });

  it("셀이 겹치지 않는다", () => {
    const seen = new Set<string>();
    let dup = 0;
    for (const c of mod.cells) {
      const k = `${c.x},${c.y}`;
      if (seen.has(k)) dup++;
      seen.add(k);
    }
    expect(dup).toBe(0);
  });

  it("gap 폭이 사다리 깊이에서 나온다 — 같은 면은 더하지 않고 가장 깊은 것 하나", () => {
    const [m0, m1] = mod.machines;
    // 좌석 1 + 수집 1 + 사다리 1 = 3. 두 그룹 깊이를 더했다면 5가 됐을 것.
    expect(m1.origin.y - (m0.origin.y + m0.size.h)).toBe(3);
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

// **클러스터 양 끝** — 맨 위 머신의 N, 맨 아래 머신의 S 에는 이웃이 없어 gap 이 아니라
// **모듈 바깥**이다. 예전엔 이 두 면을 아예 안 썼다: count=1 이면 gap 이 하나도 없어
// W 를 넘긴 그룹이 통째로 unrouted 였다. 이제는 바깥으로 자란다 — 모듈이 차지하는 범위는
// moduleExtent(머신 ∪ 모든 셀)라 배치가 이 셀들을 이미 셈에 넣는다.
describe("클러스터 양 끝 — 머신 하나뿐이어도 넘친 그룹이 산다", () => {
  const mod = generateModule({
    ...linkedBase,
    count: 1, // gap 이 하나도 없다
    lines: [{ name: "gear", kind: "belt", role: "output" }],
    outputLinks: [
      { fromMachine: 0, item: "gear", taps: [{ toMachine: 0, inserterCount: 3 }] }, // W 를 채움
      { fromMachine: 0, item: "gear", taps: [{ toMachine: 1, inserterCount: 2 }] }, // → 아래쪽 바깥
      { fromMachine: 0, item: "gear", taps: [{ toMachine: 2, inserterCount: 2 }] }, // → 위쪽 바깥
    ],
  } as ModuleInput);

  it("셋 다 살아남는다 — 예전엔 뒤 둘이 unrouted 였다", () => {
    expect(mod.outputPorts).toHaveLength(3);
    expect(mod.unroutedLines).toHaveLength(0);
  });

  it("팔 합이 보존된다 (3+2+2)", () => {
    expect(mod.outputPorts.reduce((s, p) => s + p.cells.length, 0)).toBeGreaterThanOrEqual(7);
  });

  it("넘친 둘이 머신 몸통 아래·위로 갈라져 앉는다", () => {
    // 넘침은 S 를 먼저 본다(링크 수열이 위→아래 단조라 아래쪽이 뒤 목적지와 가깝다).
    const m = mod.machines[0];
    const [, a, b] = mod.outputPorts;
    expect(a.cells.every((c) => c.y > m.origin.y + m.size.h - 1)).toBe(true); // 아래 바깥
    expect(b.cells.every((c) => c.y < m.origin.y)).toBe(true); // 위 바깥
  });

  it("전부 W 로 나간다 — 바깥에 앉아도 모서리에서 꺾인다", () => {
    expect(mod.outputPorts.every((p) => p.face === "W")).toBe(true);
  });

  it("벨트끼리 새지 않고 셀도 안 겹친다", () => {
    expect(beltLeaks(mod)).toEqual([]);
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
