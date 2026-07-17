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

  it("벨트를 안 골랐으면 수요가 한 줄을 넘을 때 거절 — 줄을 늘릴 수단이 없다", () => {
    const cap: SupplyCapacity = {
      beltCapacity: 15,
      lineRates: new Map([["input:a", 20]]), // 20 > 15
    };
    const d = insertingPlanner(base(lines), 3, cap); // belts 미지정
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

/**
 * ④ **벨트 줄 수는 수요가 정한다** — 한 줄을 넘는 수요를 거절하지 않고 줄을 늘린다.
 *
 * 옛 모델은 "줄 하나 = 벨트 하나" 라서, 수요가 벨트 한 줄을 넘으면 탭이 **거절**하고
 * 다이렉트로 물러났다(그리고 다이렉트는 포트가 폭발해 모듈 경계가 어긋났다).
 * [determineBeltCount] 가 티어를 골라 줄을 늘리면 그 거절 자체가 사라진다.
 *
 * **이게 경계를 안정시킨다**: 줄 수를 수요에서 유도하므로 자식·부모가 같은 수요를 같은
 * 규칙으로 보면 같은 답이 나온다(포트 개수를 팔 개수에서 유도하면 양쪽 머신이 달라 어긋난다).
 */
describe("④ 수요가 벨트 한 줄을 넘으면 줄을 늘린다", () => {
  const fast = { entityName: "fast-transport-belt", throughput: 30 };
  const basic = { entityName: "transport-belt", throughput: 15 };
  const belts = [fast, basic];
  /** 그 줄의 배정(=벨트) 전부. 줄 하나가 배정을 여러 개 가질 수 있다. */
  const placements = (d: ReturnType<typeof insertingPlanner>, name: string) =>
    d.plan.ok ? d.plan.lines.filter((l) => l.line.name === name) : [];

  it("수요 40 → 빠른 벨트(30) + 나머지 10을 덮는 싼 벨트(15) = 2줄. 거절하지 않는다", () => {
    const d = insertingPlanner({ ...base([inL("a"), outL("z")]), belts }, 3, {
      tapCapacity: 100,
      lineRates: new Map([["input:a", 40]]),
    });
    expect(d.mode, "옛 모델은 여기서 거절했다").toBe("tap");
    expect(placements(d, "a").map((p) => p.beltEntityName)).toEqual([
      "fast-transport-belt",
      "transport-belt",
    ]);
  });

  it("두 벨트는 서로 다른 자리에 앉는다 (같은 줄이어도 자리를 나눠 쓴다)", () => {
    const d = insertingPlanner({ ...base([inL("a"), outL("z")]), belts }, 3, {
      tapCapacity: 100,
      lineRates: new Map([["input:a", 40]]),
    });
    const ps = placements(d, "a");
    const seats = ps.map((p) => `${p.side}:${p.clusterBeltDepth}`);
    expect(new Set(seats).size, `두 벨트가 같은 자리에 앉았다: ${seats}`).toBe(2);
  });

  it("한 줄로 감당되면 한 줄 그대로 — 필요 없는 벨트를 깔지 않는다", () => {
    const d = insertingPlanner({ ...base([inL("a"), outL("z")]), belts }, 3, {
      tapCapacity: 100,
      lineRates: new Map([["input:a", 20]]),
    });
    expect(placements(d, "a")).toHaveLength(1);
    expect(placements(d, "a")[0].beltEntityName).toBe("fast-transport-belt");
  });

  it("수량을 모르는 줄은 한 줄 — 없는 숫자로 벨트를 늘리지 않는다", () => {
    const d = insertingPlanner({ ...base([inL("a"), outL("z")]), belts }, 3, {
      tapCapacity: 100,
      lineRates: new Map(), // 수량 미상
    });
    expect(placements(d, "a")).toHaveLength(1);
  });

  it("늘린 줄이 면 용량을 넘으면 complex → 다이렉트 (거짓말 대신 정직한 위임)", () => {
    // 면당 벨트 2줄 × 2면 = 4. a 가 4줄을 요구하면 z 가 앉을 자리가 없다.
    const d = insertingPlanner({ ...base([inL("a"), outL("z")]), belts }, 3, {
      tapCapacity: 100,
      lineRates: new Map([["input:a", 110]]), // 30×3 + 20 → 4줄
    });
    expect(d.mode).toBe("direct");
    expect(d.reason).toContain("belt-demand-exceeds-capacity");
  });
});

/**
 * ⑤ **한 줄의 팔이 여러 면에 나뉘어 앉는다.**
 *
 * 팔이 면 하나의 좌석 행보다 많으면 면을 넘나들 수밖에 없다 — 팔 개수는 협상 대상이
 * 아니므로(레시피·머신·인서터가 정한다) 줄여서 앉히면 굶는다. 그래서 배정을 하나 더
 * 만들어 나눠 앉힌다(각 배정이 자기 벨트·자기 포트).
 *
 * 여기서 못 박는 핵심은 **팔 개수가 보존된다**는 것이다: 배정이 둘로 늘어도 팔의 합은
 * 그대로다. 예전엔 배정마다 팔 개수를 **통째로** 달아서 벨트가 2줄이면 팔이 2배가 됐다
 * (2026-07-16 버그 — 좌석 예산이 없는 수요를 세고 방출도 2배가 될 참이었다).
 */
describe("⑤ 팔이 면을 넘나든다 — 개수는 보존된다", () => {
  const fast = { entityName: "fast-transport-belt", throughput: 30 };
  const belts = [fast];
  const armsOf = (d: ReturnType<typeof insertingPlanner>, name: string) =>
    d.plan.ok ? d.plan.lines.filter((l) => l.line.name === name) : [];
  const armSum = (d: ReturnType<typeof insertingPlanner>, name: string) =>
    armsOf(d, name).reduce((s, p) => s + (p.requiredInserterCount ?? 0), 0);

  /**
   * **배분기가 면별 좌석 행을 본다**(2026-07-17, `seatRowsPerFace`). 배정 수는
   * `placementsOf` 가 `ceil(팔 ÷ 면 행)` 로 정하고, 배분기는 좌석이 남은 면에서만 슬롯을
   * 집으므로 두 배정이 자연히 **다른 면**에 앉는다.
   *
   * 옛 동작: 슬롯 풀이 면 하나의 레인을 다 쓴 뒤에야 넘어가 배정 둘이 같은 면에 앉고,
   * 좌석 예산이 **사후에** 넘침을 발견해 direct 로 떨어졌다(고칠 수 없는 시점).
   */
  it("팔 4개가 3행짜리 면에 안 들어가면 두 면에 나눠 앉는다 (합은 4)", () => {
    // a: 60/3대 = 20, tapCap 5 → 팔 4개. 3×3 머신이라 면 좌석은 3행.
    const d = insertingPlanner({ ...base([inL("a"), outL("z")]), belts }, 3, {
      tapCapacity: 5,
      lineRates: new Map([["input:a", 60]]),
    });
    const ps = armsOf(d, "a");
    expect(ps.length).toBe(2);
    expect(armSum(d, "a")).toBe(4);
    expect(new Set(ps.map((p) => p.side)).size, "두 배정이 같은 면에 앉았다").toBe(2);
    for (const p of ps) expect(p.requiredInserterCount!).toBeLessThanOrEqual(3);
  });

  it("벨트가 2줄이어도 팔은 2배가 되지 않는다 — 나눠 앉을 뿐이다", () => {
    // 수요 40 → 벨트 2줄. 팔은 40/2대 = 20, tapCap 10 → 2개.
    const d = insertingPlanner(
      { ...base([inL("a"), outL("z")]), belts: [fast, { entityName: "t", throughput: 15 }] },
      2,
      { tapCapacity: 10, lineRates: new Map([["input:a", 40]]) },
    );
    expect(armsOf(d, "a").length).toBe(2); // 벨트 2줄
    expect(armSum(d, "a"), "배정마다 팔을 통째로 달면 4가 된다").toBe(2);
  });

  it("한 면에 들어가면 안 나눈다 — 필요 없는 배정을 만들지 않는다", () => {
    const d = insertingPlanner({ ...base([inL("a"), outL("z")]), belts }, 3, {
      tapCapacity: 5,
      lineRates: new Map([["input:a", 30]]), // 30/3 = 10, ceil(10/5) = 팔 2개 ≤ 3행
    });
    expect(armsOf(d, "a").length).toBe(1);
    expect(armSum(d, "a")).toBe(2);
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
