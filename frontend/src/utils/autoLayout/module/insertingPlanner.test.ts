/**
 * insertingPlanner — **이 클러스터를 트렁크(탭 인서팅)로 합칠 수 있는가** 판정
 * (docs/auto-layout-wizard.trunk-redesign.md §10.2, 용어: docs/용어사전.md §D).
 *
 * 판정 순서: ① 간단한 레시피인가(기둥 클러스터로 표현 가능 — `planClusterPorts` 의
 * ok/complex 가 곧 이 판별이다, 별도 "레인 검사"를 새로 만들지 않는다) ② 벨트 한 줄이
 * 감당하나 + `requiredInserterCount` 좌석 예산. 하나라도 걸리면 **모듈 전체가 다이렉트
 * 인서팅으로 물러난다** — 거절은 항상 안전하다(1:1 은 구성으로 성립).
 *
 * `requiredInserterCount`(머신 한 대의 한 줄을 먹이는 팔 개수)는 **모드가 정하는 값이 아니다**
 * — 레시피·머신·인서터가 밖에서 정한다. 그래서 탭이든 다이렉트든 **같은 수**를 달고 나가야
 * 한다. 그 불변식을 아래 ③ 이 못 박는다.
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

describe("② requiredInserterCount — 벨트 용량 + Parallel Inserting", () => {
  const lines = [inL("a"), inL("b"), inL("c"), outL("z")];

  /** plan 에서 한 줄의 requiredInserterCount 조회. **모드와 무관하게** 달려 있어야 한다. */
  const armsOf = (d: ReturnType<typeof insertingPlanner>, name: string): number | undefined =>
    d.plan.ok ? d.plan.lines.find((l) => l.line.name === name)?.requiredInserterCount : undefined;

  it("수치를 안 주면 판정 보류 — undefined(없는 숫자를 지어내지 않는다)", () => {
    const d = insertingPlanner(base(lines), 3, {});
    expect(d.mode).toBe("tap");
    expect(armsOf(d, "a")).toBeUndefined();
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
    expect(armsOf(d, "a")).toBe(2);
    expect(armsOf(d, "b")).toBeUndefined(); // 수치 없는 줄은 보류
  });

  /**
   * 수량 미상(범위 산출물인데 게임데이터에 amount_min/max 가 없던 43개)이 **NaN 으로** 흘러들면
   * 여기가 조용히 망가졌다: `rate === undefined` 방어를 NaN 이 **뚫고**, `NaN > beltCapacity` 도
   * false 라 거절되지 않고, `Math.max(1, Math.ceil(NaN/…))` = **NaN** 이 되어 emit 의
   * `for (k = 0; k < NaN; k++)` 가 0회 → **인서터가 사라졌다**(2026-07-16).
   *
   * 이제 호출부(moduleWizard)가 수량 미상인 줄을 lineRates 에 **넣지 않으므로** 이 상황은
   * "수치 없음 → `undefined`(판정 보류)" 로 떨어지고, 소비처가 1로 본다. 그 계약을 고정한다.
   */
  it("수량 미상인 줄은 lineRates 에 없다 → undefined 로 보류 (NaN 이 흘러들면 안 된다)", () => {
    const cap: SupplyCapacity = {
      beltCapacity: 100,
      tapCapacity: 5,
      lineRates: new Map([["input:a", 30]]), // "b" 는 수량 미상 → 아예 없음
    };
    const d = insertingPlanner(base(lines), 3, cap);
    expect(d.mode).toBe("tap");
    expect(armsOf(d, "b")).toBeUndefined(); // 보류. NaN 도 0 도 아니어야 한다.
    expect(Number.isNaN(armsOf(d, "b") as number)).toBe(false);
  });

  it("머신을 늘리면 머신당 몫이 줄어 탭이 1개로 준다", () => {
    const cap: SupplyCapacity = {
      beltCapacity: 100,
      tapCapacity: 5,
      lineRates: new Map([["input:a", 30]]), // 30 / 8대 = 3.75 ≤ 5 → 탭 1개
    };
    const d = insertingPlanner(base(lines), 8, cap);
    expect(d.mode).toBe("tap");
    expect(armsOf(d, "a")).toBe(1);
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

/**
 * ③ **팔 개수는 모드보다 먼저 정해진다.**
 *
 * 인서터 하나가 나르는 양은 그 팔이 벨트에서 집든 상자에서 집든 같다. 그래서
 * `requiredInserterCount` 는 탭/다이렉트를 고르기 **전에** 이미 정해져 있고, 두 계획이
 * **같은 수**를 달고 나가야 한다.
 *
 * 예전엔 이 수가 탭 경로 안에서만 계산됐다. 그래서 다이렉트로 떨어진 모듈은 팔이 몇 개
 * 필요한지 **묻지도 않고** 줄당 하나만 놓고 "성공" 이라 보고했다 — 실측(2026-07-16,
 * kr-glass ← kr-sand)에서 초당 8개를 먹는 머신에 초당 0.667개짜리 인서터가 **하나** 붙은
 * 배치가 나왔다. 게임에 넣으면 12배 굶는다.
 *
 * 여기서 못 박는 건 "다이렉트가 그 수만큼 팔을 놓는다"가 아니라(그건 다음 단계다)
 * **"다이렉트도 그 수를 알고 있다"** 이다.
 */
describe("③ requiredInserterCount 는 모드와 무관하다", () => {
  const armsOf = (d: ReturnType<typeof insertingPlanner>, name: string): number | undefined =>
    d.plan.ok ? d.plan.lines.find((l) => l.line.name === name)?.requiredInserterCount : undefined;

  const cap: SupplyCapacity = {
    beltCapacity: 100,
    tapCapacity: 5,
    lineRates: new Map([["input:a", 60]]), // 60 / 3대 = 20, ceil(20/5) = 팔 4개
  };

  it("좌석이 모자라 다이렉트로 떨어져도, 그 계획이 팔 4개를 알고 있다", () => {
    const d = insertingPlanner(base([inL("a"), outL("z")]), 3, cap);
    expect(d.mode).toBe("direct");
    expect(d.reason).toContain("seats");
    // 굶는 배치의 근원 — 예전엔 여기가 undefined 라 다이렉트가 팔 하나만 놓았다.
    expect(armsOf(d, "a"), "다이렉트 계획이 팔 개수를 모른다").toBe(4);
  });

  it("복잡한 레시피로 다이렉트가 돼도 팔 개수는 달려 나온다", () => {
    const lines = [inL("a"), inL("b"), inL("c"), outL("z")];
    const d = insertingPlanner(base(lines, false), 3, cap); // 긴팔 없음 → complex
    expect(d.mode).toBe("direct");
    expect(d.reason).toContain("complex");
    expect(armsOf(d, "a")).toBe(4);
  });

  it("탭과 다이렉트가 같은 줄에 대해 같은 수를 낸다", () => {
    // 4줄 — 긴팔이 있으면 탭(면당 2레인 × 2면 = 4), 없으면 complex → 다이렉트.
    // 갈리는 건 **모드뿐**이고 수요·머신 수·인서터 처리량은 같다.
    const lines = [inL("a"), inL("b"), inL("c"), outL("z")];
    const rates = { ...cap, lineRates: new Map([["input:a", 30]]) }; // 30/3대 = 10, ceil(10/5) = 2
    const tap = insertingPlanner(base(lines), 3, rates);
    const dir = insertingPlanner(base(lines, false), 3, rates);
    expect(tap.mode).toBe("tap");
    expect(dir.mode).toBe("direct");
    expect(armsOf(tap, "a")).toBe(2);
    expect(armsOf(dir, "a"), "모드가 팔 개수를 바꾸면 안 된다").toBe(armsOf(tap, "a"));
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
