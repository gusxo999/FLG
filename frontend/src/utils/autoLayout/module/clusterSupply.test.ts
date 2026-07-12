/**
 * planClusterSupply — **이 클러스터를 트렁크로 합칠 수 있는가** 판정
 * (docs/auto-layout-wizard.trunk-redesign.md §10.2).
 *
 * 두 관문: ① 레인(탭 인서팅 면 용량에 줄이 들어가나) ② 용량(벨트 한 줄·인서터 하나가
 * 감당하나). 하나라도 걸리면 **모듈 전체가 다이렉트 인서팅으로 물러난다** — 거절은
 * 항상 안전하다(1:1 은 구성으로 성립).
 */
import { describe, it, expect } from "vitest";
import { planClusterSupply, type IoLine, type SupplyCapacity } from "./clusterPortPlanner";

const inL = (n: string, a = 1): IoLine => ({ name: n, kind: "belt", role: "input", amount: a });
const outL = (n: string, a = 1): IoLine => ({ name: n, kind: "belt", role: "output", amount: a });

/** 3×3 머신 기준 — 다이렉트는 면당 3칸, 탭은 면당 레인 수(긴팔 있으면 2). */
const base = (lines: IoLine[], hasLong = true) => ({
  lines,
  caps: { hasNormal: true, hasLong },
  outputSide: "W" as const,
  slotsPerFace: { WE: 3, NS: 3 },
});

describe("레인 관문 — 탭 인서팅 면 용량에 줄이 들어가나", () => {
  it("입력 3 + 출력 1 = 4줄, 긴팔 있음(면당 2레인 × 2면 = 4) → tap", () => {
    const lines = [inL("a"), inL("b"), inL("c"), outL("z")];
    const d = planClusterSupply(base(lines), 3);
    expect(d.mode).toBe("tap");
    expect(d.plan.ok).toBe(true);
  });

  it("긴팔 없음(면당 1레인 × 2면 = 2)인데 4줄 → 레인 부족 → direct 폴백", () => {
    const lines = [inL("a"), inL("b"), inL("c"), outL("z")];
    const d = planClusterSupply(base(lines, false), 3);
    expect(d.mode).toBe("direct");
    expect(d.reason).toContain("lane");
    // 폴백은 **성립해야** 한다 — 다이렉트는 면당 3칸이라 4줄이 들어간다.
    expect(d.plan.ok, "1:1 폴백이 실패하면 안전망이 아니다").toBe(true);
  });

  it("줄이 5개면 탭 용량(4) 초과 → direct", () => {
    const lines = [inL("a"), inL("b"), inL("c"), inL("d"), outL("z")];
    expect(planClusterSupply(base(lines), 3).mode).toBe("direct");
  });
});

describe("용량 관문 — 벨트 한 줄 · 인서터 하나가 감당하나", () => {
  const lines = [inL("a"), inL("b"), inL("c"), outL("z")];

  it("수치를 안 주면 게이트를 건너뛴다 — 없는 숫자를 지어내지 않는다", () => {
    expect(planClusterSupply(base(lines), 3, {}).mode).toBe("tap");
  });

  it("클러스터 수요가 벨트 한 줄을 넘으면 거절 (v1: 분할 대신 1:1)", () => {
    const cap: SupplyCapacity = {
      beltCapacity: 15,
      lineRates: new Map([["input:a", 20]]), // 20 > 15
    };
    const d = planClusterSupply(base(lines), 3, cap);
    expect(d.mode).toBe("direct");
    expect(d.reason).toContain("demand>beltCap");
  });

  it("머신 한 대 몫이 인서터 하나를 넘으면 거절", () => {
    const cap: SupplyCapacity = {
      beltCapacity: 100,
      tapCapacity: 5,
      lineRates: new Map([["input:a", 30]]), // 30 / 3대 = 10 > 5
    };
    const d = planClusterSupply(base(lines), 3, cap);
    expect(d.mode).toBe("direct");
    expect(d.reason).toContain("perMachine>tapCap");
  });

  it("머신을 늘리면 머신당 몫이 줄어 같은 수요가 통과한다", () => {
    const cap: SupplyCapacity = {
      beltCapacity: 100,
      tapCapacity: 5,
      lineRates: new Map([["input:a", 30]]), // 30 / 8대 = 3.75 ≤ 5
    };
    expect(planClusterSupply(base(lines), 8, cap).mode).toBe("tap");
  });

  it("벨트 상한은 머신 수와 무관하다 — 합산 수요가 넘으면 몇 대든 거절", () => {
    const cap: SupplyCapacity = {
      beltCapacity: 15,
      tapCapacity: 100,
      lineRates: new Map([["input:a", 20]]),
    };
    expect(planClusterSupply(base(lines), 100, cap).mode).toBe("direct");
  });
});

describe("거절은 항상 안전하다 — 폴백이 실패하지 않는다", () => {
  it("어떤 사유로 거절돼도 direct 계획은 ok 다", () => {
    const cases: [string, ReturnType<typeof planClusterSupply>][] = [
      ["레인", planClusterSupply(base([inL("a"), inL("b"), inL("c"), outL("z")], false), 3)],
      [
        "용량",
        planClusterSupply(base([inL("a"), outL("z")]), 3, {
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
