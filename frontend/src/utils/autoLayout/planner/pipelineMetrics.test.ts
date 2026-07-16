/**
 * 계측기 — **현행 1:1 수치를 박제한다.**
 *
 * 이 파일은 판단하지 않는다. 새 트렁크가 들어온 뒤 같은 자로 재서
 * "이겼는지"를 보기 위한 **기준선(baseline)** 이다
 * ([trunk-redesign](../../../../docs/auto-layout-wizard.trunk-redesign.md) §10.4-3).
 *
 * 그래서 여기 expect 는 **면적·벨트 수 같은 비용 숫자에 걸지 않는다** — 그건 트렁크가
 * 바꾸라고 만드는 값이고, 여기 못 박으면 개선이 곧 테스트 실패가 된다. 비용 숫자는 표로
 * **출력**해 눈으로 비교한다(`VITEST_PRINT_METRICS=1`).
 *
 * **이 파일에 남은 단언은 하나뿐이다** — 다른 데 없는 것만 둔다. 물류 성립·결정성·포트 수는
 * [oneToOneGuarantee](./oneToOneGuarantee.test.ts) 와
 * [modulePipeline.golden](./modulePipeline.golden.test.ts) 이 **같은 트리·같은 count 로**
 * 이미 못 박고 있다. 예전엔 그걸 여기서 한 번 더 검사했는데, 자를 하나 고칠 때마다 네 파일이
 * 같이 빨개질 뿐 새로 잡히는 건 없었다.
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

  if (process.env.VITEST_PRINT_METRICS)
    console.log(`\n${rows.map(([tag, m]) => formatMetrics(tag, m)).join("\n")}\n`);

  // 트렁크(탭 인서팅)의 **구조적 이득** 중, 다른 테스트가 안 보는 하나다 — 이게 갈아탄
  // 이유이므로 조용히 되돌아가면 여기서 잡힌다. 판정 기준은 면적이 아니다(§4 함정) —
  // 머신 수에 안 따라 커지지 않는 것이다.
  it("채널 폭이 머신 수에 안 따라 커진다 — 1:1 은 4→13 으로 벌어졌다", () => {
    for (const [tag, m] of rows)
      for (const w of m.channelWidths) expect(w, `${tag} 채널 폭`).toBeLessThanOrEqual(6);
  });
});
