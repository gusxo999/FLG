/**
 * 계측기 — **현행 1:1 수치를 박제한다.**
 *
 * 이 파일은 판단하지 않는다. 새 트렁크가 들어온 뒤 같은 자로 재서
 * "이겼는지"를 보기 위한 **기준선(baseline)** 이다
 * ([trunk-redesign](../../../../docs/auto-layout-wizard.trunk-redesign.md) §10.4-3).
 *
 * 그래서 여기 expect 는 **면적·벨트 수 같은 비용 숫자에 걸지 않는다** — 그건 트렁크가
 * 바꾸라고 만드는 값이고, 여기 못 박으면 개선이 곧 테스트 실패가 된다. 대신:
 *   - **결정성**(같은 입력 → 같은 숫자)만 못 박고,
 *   - 비용 숫자는 표로 **출력**해 눈으로 비교한다(`VITEST_PRINT_METRICS=1`).
 *
 * 물류 성립(홉 실패 0 · 반출 skip 0)은 [oneToOneGuarantee](./oneToOneGuarantee.test.ts) 가
 * 이미 못 박고 있으므로 여기서 중복 검사하지 않는다.
 */
import { describe, it, expect } from "vitest";
import { measurePipeline, formatMetrics, type PipelineMetrics } from "./pipelineMetrics";
import type { NodeSpec, PackConfig } from "./modulePacking";
import type { HopConfig } from "./moduleHop";
import type { IoLine } from "../module/clusterPortPlanner";

const inL = (n: string, a: number): IoLine => ({ name: n, kind: "belt", role: "input", amount: a });
const outL = (n: string, a: number): IoLine => ({ name: n, kind: "belt", role: "output", amount: a });
const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

const config: PackConfig = {
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
  reservePerimeterLanes: true,
  channelGeometry: true,
  beltMaxUndergroundDistance: 4,
};

const hopConfig: HopConfig = {
  beltEntityName: "transport-belt",
  undergroundBeltEntityName: "underground-belt",
  beltMaxUndergroundDistance: 4,
};

/** advanced-circuit 동형 트리 — golden·보장 테스트와 같은 트리(자를 통일한다). */
const mk = (c0: number, c1: number, c2: number): NodeSpec[] => [
  { id: "n0", depth: 0, machine: M, count: c0, lines: [inL("copper-cable", 4), inL("electronic-circuit", 2), inL("kr-components", 2), outL("advanced-circuit", 1)] },
  { id: "n1", depth: 1, parentId: "n0", machine: M, count: c1, lines: [inL("plastic-bar", 4), inL("kr-silicon", 2), inL("kr-glass", 2), outL("kr-components", 4)] },
  { id: "n2", depth: 1, parentId: "n0", machine: M, count: c2, lines: [inL("copper-cable", 3), inL("stone-tablet", 1), outL("electronic-circuit", 2)] },
];

const COUNTS: [number, number, number][] = [
  [1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 2], [6, 4, 2], [8, 6, 4], [3, 2, 5],
];

describe("파이프라인 계측기 — 1:1 기준선", () => {
  const rows: [string, PipelineMetrics][] = COUNTS.map(([a, b, c]) => [
    `${a}/${b}/${c}`,
    measurePipeline(mk(a, b, c), config, hopConfig),
  ]);

  it("표를 낸다 (VITEST_PRINT_METRICS=1 이면 콘솔로)", () => {
    const table = rows.map(([tag, m]) => formatMetrics(tag, m)).join("\n");
    if (process.env.VITEST_PRINT_METRICS) console.log(`\n${table}\n`);
    expect(table.split("\n")).toHaveLength(COUNTS.length);
  });

  it("결정성 — 같은 트리를 두 번 재면 같은 숫자다", () => {
    for (const [tag, m] of rows) {
      const [a, b, c] = tag.split("/").map(Number);
      expect(measurePipeline(mk(a, b, c), config, hopConfig), tag).toEqual(m);
    }
  });

  it("포트 수 = 머신 × 줄 — 1:1 의 대가가 여기 있다(트렁크가 줄여야 할 값)", () => {
    for (const [tag, m] of rows) {
      const [a, b, c] = tag.split("/").map(Number);
      expect(m.ports, tag).toBe(a * 4 + b * 4 + c * 3);
    }
  });
});
