/**
 * insertingPlanner — **이 클러스터를 트렁크(탭 인서팅)로 합칠 수 있는가** 판정
 * (docs/auto-layout-wizard.trunk-redesign.md §10.2, 용어: docs/용어사전.md §D).
 *
 * 판정 순서: ① 간단한 레시피인가(기둥 클러스터로 표현 가능 — `planClusterPorts` 의
 * ok/complex 가 곧 이 판별이다, 별도 "레인 검사"를 새로 만들지 않는다) ②
 * `determineTapsPerMachine`(벨트 한 줄이 감당하나 + 머신당 탭 몇 개 — Parallel Inserting)
 * + 좌석 예산. 하나라도 걸리면 **모듈 전체가 다이렉트 인서팅으로 물러난다** — 거절은
 * 항상 안전하다(1:1 은 구성으로 성립).
 */
import { describe, it, expect } from "vitest";
import { insertingPlanner, type IoLine, type SupplyCapacity } from "./clusterPortPlanner";
import type { SpecInserter } from "../buildSpec";

const inL = (n: string, a = 1): IoLine => ({ name: n, kind: "belt", role: "input", amount: a });
const outL = (n: string, a = 1): IoLine => ({ name: n, kind: "belt", role: "output", amount: a });

const insR = (reach: number): SpecInserter => ({ entityName: `i${reach}`, reach, throughput: 0 });

/** 3×3 머신 기준 — 다이렉트는 면당 3칸, 탭은 면당 벨트 수(reach 종류 수, 긴팔 있으면 2). */
const base = (lines: IoLine[], hasLong = true) => ({
  lines,
  inserters: hasLong ? [insR(1), insR(2)] : [insR(1)],
  outputSide: "W" as const,
  slotsPerFace: { WE: 3, NS: 3 },
});

describe("① 간단한 레시피 판별 — 기둥 클러스터로 표현 가능한가", () => {
  it("입력 3 + 출력 1 = 4줄, 긴팔 있음(면당 2레인 × 2면 = 4) → tap", () => {
    const lines = [inL("a"), inL("b"), inL("c"), outL("z")];
    const d = insertingPlanner(base(lines), 3);
    expect(d.mode).toBe("tap");
    expect(d.plan.ok).toBe(true);
  });

  it("긴팔 없음(면당 1레인 × 2면 = 2)인데 4줄 → 복잡한 레시피 → direct 폴백", () => {
    const lines = [inL("a"), inL("b"), inL("c"), outL("z")];
    const d = insertingPlanner(base(lines, false), 3);
    expect(d.mode).toBe("direct");
    expect(d.reason).toContain("complex");
    // 폴백은 **성립해야** 한다 — 다이렉트는 면당 3칸이라 4줄이 들어간다.
    expect(d.plan.ok, "1:1 폴백이 실패하면 안전망이 아니다").toBe(true);
  });

  it("줄이 5개면 탭 용량(4) 초과 → 복잡한 레시피 → direct", () => {
    const lines = [inL("a"), inL("b"), inL("c"), inL("d"), outL("z")];
    expect(insertingPlanner(base(lines), 3).mode).toBe("direct");
  });
});

describe("② determineTapsPerMachine — 벨트 용량 + Parallel Inserting", () => {
  const lines = [inL("a"), inL("b"), inL("c"), outL("z")];

  /** plan 에서 한 줄의 tapsPerMachine 조회(탭 모드 전용). */
  const tapsOf = (d: ReturnType<typeof insertingPlanner>, name: string): number | undefined =>
    d.plan.ok ? d.plan.lines.find((l) => l.line.name === name)?.tapsPerMachine : undefined;

  it("수치를 안 주면 건너뛴다 — 탭 1개(없는 숫자를 지어내지 않는다)", () => {
    const d = insertingPlanner(base(lines), 3, {});
    expect(d.mode).toBe("tap");
    expect(tapsOf(d, "a")).toBe(1);
  });

  it("클러스터 수요가 벨트 한 줄을 넘으면 거절 (탭으론 못 푼다 → 1:1)", () => {
    const cap: SupplyCapacity = {
      beltCapacity: 15,
      lineRates: new Map([["input:a", 20]]), // 20 > 15
    };
    const d = insertingPlanner(base(lines), 3, cap);
    expect(d.mode).toBe("direct");
    expect(d.reason).toContain("demand>beltCap");
  });

  it("머신 한 대 몫이 인서터 하나를 넘으면 Parallel Inserting — 탭을 늘린다", () => {
    const cap: SupplyCapacity = {
      beltCapacity: 100,
      tapCapacity: 5,
      lineRates: new Map([["input:a", 30]]), // 30 / 3대 = 10, ceil(10/5) = 탭 2개
    };
    const d = insertingPlanner(base(lines), 3, cap);
    expect(d.mode).toBe("tap"); // 옛 모델은 여기서 거절했다 — 이제 탭으로 감당
    expect(tapsOf(d, "a")).toBe(2);
    expect(tapsOf(d, "b")).toBe(1); // 수치 없는 줄은 1
  });

  it("머신을 늘리면 머신당 몫이 줄어 탭이 1개로 준다", () => {
    const cap: SupplyCapacity = {
      beltCapacity: 100,
      tapCapacity: 5,
      lineRates: new Map([["input:a", 30]]), // 30 / 8대 = 3.75 ≤ 5 → 탭 1개
    };
    const d = insertingPlanner(base(lines), 8, cap);
    expect(d.mode).toBe("tap");
    expect(tapsOf(d, "a")).toBe(1);
  });

  it("좌석이 모자라면(총 탭 > 면 좌석 행) 다이렉트로 거른다", () => {
    // a 혼자 E 면에서 탭 4개를 요구 — 3×3 면 좌석 3행을 넘는다.
    const cap: SupplyCapacity = {
      beltCapacity: 100,
      tapCapacity: 5,
      lineRates: new Map([["input:a", 60]]), // 60 / 3대 = 20, ceil(20/5) = 탭 4개 > 3행
    };
    const d = insertingPlanner(base([inL("a"), outL("z")]), 3, cap);
    expect(d.mode).toBe("direct");
    expect(d.reason).toContain("seats");
  });

  it("벨트 상한은 머신 수와 무관하다 — 합산 수요가 넘으면 몇 대든 거절", () => {
    const cap: SupplyCapacity = {
      beltCapacity: 15,
      tapCapacity: 100,
      lineRates: new Map([["input:a", 20]]),
    };
    expect(insertingPlanner(base(lines), 100, cap).mode).toBe("direct");
  });
});

describe("거절은 항상 안전하다 — 폴백이 실패하지 않는다", () => {
  it("어떤 사유로 거절돼도 direct 계획은 ok 다", () => {
    const cases: [string, ReturnType<typeof insertingPlanner>][] = [
      ["복잡한 레시피", insertingPlanner(base([inL("a"), inL("b"), inL("c"), outL("z")], false), 3)],
      [
        "벨트 용량",
        insertingPlanner(base([inL("a"), outL("z")]), 3, {
          beltCapacity: 1,
          lineRates: new Map([["input:a", 99]]),
        }),
      ],
    ];
    for (const [tag, d] of cases) {
      expect(d.mode, tag).toBe("direct");
      expect(d.plan.ok, `${tag}: 폴백이 실패했다`).toBe(true);
    }
  });
});
