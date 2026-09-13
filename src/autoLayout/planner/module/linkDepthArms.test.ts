/**
 * **깊이가 팔을 정한다** — 설계는 `docs/auto-layout/module/module-planning.md §4.5`.
 *
 * 두 결함을 잠근다. 둘 다 **둘째 깊이를 쓰기 시작하는 순간**에만 발현한다:
 *
 * ```
 * A  팔 개수를 센 인서터 ≠ 실제로 앉는 인서터   → 그 줄이 조용히 굶는다
 * B  포트 인서터·상자가 장부에 없다             → 방출에서 부딪혀 한쪽 줄이 통째로 사라진다
 * ```
 *
 * **대조군이 없으면 초록이 거짓이다.** 두 reach 의 팔 처리량이 실제로 갈리는 스펙을 안 쓰면
 * A 는 아무것도 안 지키고, 포트 행을 비껴가는 배열을 함께 안 재면 B 는 *"깊은 줄을 아예
 * 안 준다"* 와 구별되지 않는다.
 *
 * **벨트 셀 수를 팔 수로 읽을 수 있는 것은 머신 하나짜리 줄뿐이다** — 관통 줄의 벨트는
 * 좌석 사이 행까지 통으로 덮으므로 셀 수가 구간 길이다. 그래서 아래 단언은 전부
 * *머신 하나짜리 줄*(`from` 이 한 머신)에만 건다.
 */
import { describe, it, expect } from "vitest";
import { generateModule } from "../../module/clusterModule";
import type { Link } from "../../module/types/line";
import type { GeneratedModule, ModuleInput } from "../../module/types/module";

const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

/** reach 1 은 2.4/s, reach 2 는 그 절반 — **두 배 차이**라야 팔 수가 갈린다(대조군의 전제). */
const R1_TP = 2.4;
const R2_TP = R1_TP / 2;

const base = (outputLinks: Link[]): ModuleInput => ({
  machine: M,
  count: 2,
  lines: [
    { name: "iron", kind: "belt", role: "input" },
    { name: "gear", kind: "belt", role: "output" },
  ],
  inserterEntityName: "inserter",
  inserters: [
    { entityName: "inserter", reach: 1, throughput: R1_TP },
    { entityName: "long-handed-inserter", reach: 2, throughput: R2_TP },
  ],
  beltEntityName: "transport-belt",
  belts: [{ entityName: "transport-belt", throughput: 15 }],
  supplyCapacity: { lineRates: new Map([["input:iron", 1], ["output:gear", 1]]) },
  outputLinks,
});

/** 출력 줄 하나 — `from` 머신들에게서 각각 `rate` 씩 걷는다. */
const link = (from: number[], rate: number): Link => ({
  item: "gear",
  // `from` 의 수는 reach 1 기준 팔 수다. **진짜 출처는 `carries`** 이고, 배정이 깊이마다
  // 그걸로 다시 센다([armsAt]) — 이 둘이 갈리는 것이 결함 A 였다.
  from: new Map(from.map((i) => [i, 1])),
  to: new Map([[0, 1]]),
  carries: from.map((i) => ({ from: i, to: 0, rate })),
});

/** 포트마다 (벨트 깊이, 벨트 셀 수). W 면이라 깊이 = 머신 서쪽 변에서의 거리. */
function depthsOf(mod: GeneratedModule) {
  const mx = Math.min(...mod.machines.map((m) => m.origin.x));
  return mod.outputPorts.map((p) => ({
    depth: mx - Math.max(...p.cells.map((c) => c.x)),
    cells: p.cells.length,
  }));
}

/** 겹쳐 놓인 셀 수 — 0이 아니면 배정이 모르는 다툼이 방출까지 갔다는 뜻이다. */
function overlaps(mod: GeneratedModule): number {
  const seen = new Set<string>();
  let dup = 0;
  for (const c of mod.cells) {
    const k = `${c.x},${c.y}`;
    if (seen.has(k)) dup++;
    seen.add(k);
  }
  return dup;
}

// 관통 줄이 d2 를 통째로 먹으면 뒤 줄은 d3(긴팔)로 밀린다. 뒤 줄은 머신 하나짜리라
// 벨트 셀 수가 곧 팔 수다.
const RATE = R1_TP; // reach 1 로는 팔 1개, reach 2(절반)로는 **팔 2개**
const pushedDeep = generateModule(base([link([0, 1], RATE), link([0], RATE)]));

describe("결함 A — 깊이가 팔 종류를 바꾸면 팔 개수도 바뀐다", () => {
  it("뒤 줄이 실제로 둘째 깊이(d3)에 앉았다 — 아니면 아래가 아무것도 안 지킨다", () => {
    expect(depthsOf(pushedDeep)[1].depth).toBe(3);
  });

  it("**d3 에 앉은 줄의 팔은 긴팔로 센 값**이다 — 같은 rate 가 팔 2개가 된다", () => {
    expect(depthsOf(pushedDeep)[1].cells).toBe(2);
  });

  it("**대조군** — 같은 줄이 혼자 앉으면 d2 이고 팔은 1개다", () => {
    // 관통 줄을 빼면 d2 가 비어 있어 같은 줄이 짧은팔로 앉는다. 깊이만 달라졌는데
    // 팔 수가 갈린다는 것이 §16 의 전부다.
    const alone = generateModule(base([link([0], RATE)]));
    expect(depthsOf(alone)[0]).toEqual({ depth: 2, cells: 1 });
  });

  it("줄이 사라지지 않는다 — 팔이 늘어도 좌석 안에 든다", () => {
    expect(pushedDeep.unroutedLines).toHaveLength(0);
    expect(overlaps(pushedDeep)).toBe(0);
  });
});

describe("결함 B — 포트 칸도 표의 칸이다", () => {
  // 어느 팔로 먹여도 1개인 rate — 이 검사는 팔 수가 아니라 **칸**을 잰다.
  const rate = R2_TP;

  it("앞 줄의 **포트 행**을 삼키는 관통 줄은 그 깊이를 못 받는다", () => {
    // groups[0] = 머신 1 하나 → d2, 구간 [3,3], 포트 = (d3, 행 3)
    // groups[1] = 관통       → 구간 [0,4] 가 d2 와 겹쳐 d3 으로 밀리는데,
    //                          그 d3 구간이 **행 3 을 포함한다** → 배정이 거절해야 한다
    const mod = generateModule(base([link([1], rate), link([0, 1], rate)]));
    // 자리를 못 찾으면 정직하게 실패한다 — **조용히 겹쳐 놓지는 않는다.**
    expect(overlaps(mod)).toBe(0);
    // 그리고 실패한 줄은 목록에 남는다(삼키지 않는다).
    expect(mod.outputPorts.length + mod.unroutedLines.length).toBe(2);
  });

  it("**대조군** — 포트 칸이 안 겹치면 그 깊이를 받는다", () => {
    // 순서를 뒤집으면 관통이 d2 를 먼저 잡고(포트는 기둥 **밖** N 끝),
    // 뒤 줄이 d3 으로 밀리며 그 포트는 d4·d5 라 아무와도 안 만난다.
    expect(pushedDeep.unroutedLines).toHaveLength(0);
    expect(pushedDeep.outputPorts).toHaveLength(2);
    expect(new Set(depthsOf(pushedDeep).map((l) => l.depth))).toEqual(new Set([2, 3]));
  });
});
