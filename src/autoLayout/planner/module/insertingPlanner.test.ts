/**
 * insertingPlanner — **이 클러스터를 트렁크(탭 인서팅)로 합칠 수 있는가** 판정
 * (docs/auto-layout/module/trunk-redesign.md §10.2, 용어: docs/용어사전.md §D).
 *
 * 판정 순서: ① 간단한 레시피인가(기둥 클러스터로 표현 가능 — `planClusterPorts` 의
 * ok/complex 가 곧 이 판별이다, 별도 "레인 검사"를 새로 만들지 않는다) ② 벨트 한 줄이
 * 감당하나 + `requiredInserterCount` 좌석 예산. 하나라도 걸리면 **모듈 전체가 다이렉트
 * 인서팅으로 물러난다** — 거절은 항상 안전하다(1:1 은 구성으로 성립).
 *
 * `requiredInserterCount`(머신 한 대의 한 줄을 먹이는 팔 개수)는 **모드가 정하는 값이 아니다**
 * — 레시피·머신·인서터가 밖에서 정한다. 그래서 탭이든 다이렉트든 **같은 수**를 달고 나가야
 * 한다. 그 불변식을 아래 ③ 이 못 박는다.
 *
 * ## 결과 타입이 유니온이다 (2026-08-06)
 *
 * `InsertingDecisionResult` 는 `{mode:"tap", plan}` **또는** `{mode:"direct", reason}` 이다.
 * 예전엔 한 모양이었고 다이렉트도 `plan: {ok:true, lines:[]}` 를 달고 나갔는데, *"성공했는데
 * 배정 0건"* 이라 **다이렉트는 계획을 안 낸다**는 사실이 관례로만 존재했다. 그래서 이 파일의
 * 헬퍼들은 모드로 먼저 갈라 본다 — 갈라 보지 않으면 컴파일이 안 된다.
 */
import { describe, it, expect } from "vitest";
import {
  insertingPlanner,
  type IoLine,
  type PlannedLine,
  type SupplyCapacity,
} from "./clusterPortPlanner";
import { externalLineGroups } from "../../module/machineLinkGroup";
import type { SpecInserter } from "../../buildSpec";

const inL = (n: string, a = 1): IoLine => ({ name: n, kind: "belt", role: "input", amount: a });
const outL = (n: string, a = 1): IoLine => ({ name: n, kind: "belt", role: "output", amount: a });

const insR = (reach: number): SpecInserter => ({ entityName: `i${reach}`, reach, throughput: 0 });

type Decision = ReturnType<typeof insertingPlanner>;

/**
 * **처리량을 슬롯 목록으로 주입한다** — 실경로에서 슬롯과 처리량은 **한 목록**이다
 * ([PortPlannerInput.inserters], 계획서 §18). 픽스처는 읽기 편하게 `cap` 에 적어 두고
 * 이 헬퍼가 그 사실을 흉내 낸다: `cap.inserters` 가 있으면 그것이 곧 슬롯 목록이다.
 */
type Cap = SupplyCapacity & { inserters?: SpecInserter[] };
const run = (
  input: Parameters<typeof insertingPlanner>[0],
  count: number,
  seats: { WE: number; NS: number },
  cap: Cap = {},
): Decision => {
  // **reach 집합은 `input` 이 정하고(픽스처의 `hasLong`), 처리량만 `cap` 에서 덮어쓴다.**
  // 통째로 갈아 끼우면 *"긴팔 없음"* 을 전제한 픽스처가 조용히 긴팔을 얻는다.
  const tp = new Map((cap.inserters ?? []).map((i) => [i.reach, i.throughput]));
  const inserters = input.inserters.map((i) => ({ ...i, throughput: tp.get(i.reach) ?? i.throughput }));
  return insertingPlanner({ ...input, inserters }, count, seats, cap);
};

/** 3×3 머신의 면당 좌석 행. [insertingPlanner] 의 **자기 인자**다(입력 객체에 없다). */
const SEATS = { WE: 3, NS: 3 };

/** 3×3 머신 기준 — 다이렉트는 면당 3칸, 탭은 면당 벨트 수(reach 종류 수, 긴팔 있으면 2). */
const base = (lines: IoLine[], hasLong = true) => ({
  lines,
  inserters: hasLong ? [insR(1), insR(2)] : [insR(1)],
  outputSide: "W" as const,
});

/** 탭 계획의 배정들. **다이렉트는 계획을 안 내므로 빈 배열**이다. */
const linesOf = (d: Decision): PlannedLine[] => (d.mode === "tap" ? d.plan.lines : []);

/** 다이렉트 사유. 탭에 물으면 터진다 — 모드를 먼저 단언하라는 뜻이다. */
const reasonOf = (d: Decision): string => {
  if (d.mode !== "direct") throw new Error("탭 판정에 거절 사유를 물었다");
  return d.reason;
};

describe("① 간단한 레시피 판별 — 기둥 클러스터로 표현 가능한가", () => {
  it("입력 3 + 출력 1 = 4줄, 긴팔 있음(면당 2레인 × 2면 = 4) → tap", () => {
    const lines = [inL("a"), inL("b"), inL("c"), outL("z")];
    const d = run(base(lines), 3, SEATS);
    expect(d.mode).toBe("tap");
    expect(linesOf(d).length).toBeGreaterThan(0);
  });

  it("긴팔 없음(면당 1레인 × 2면 = 2)인데 4줄 → 복잡한 레시피 → direct 폴백", () => {
    const lines = [inL("a"), inL("b"), inL("c"), outL("z")];
    const d = run(base(lines, false), 3, SEATS);
    expect(d.mode).toBe("direct");
    expect(reasonOf(d)).toContain("complex");
    // **폴백이 성립하는지는 더 이상 여기서 안 본다** — 기계별 포트는 링크 배분기
    // ([allocateLinkFaces])가 잡고, 그 성패는 자기 방출에서 갈린다(2026-08-05 통합).
    // 여기서 못 박는 건 "탭이 아니다" 와 "왜 아닌지" 둘뿐이다.
  });

  it("줄이 5개면 탭 용량(4) 초과 → 복잡한 레시피 → direct", () => {
    const lines = [inL("a"), inL("b"), inL("c"), inL("d"), outL("z")];
    expect(run(base(lines), 3, SEATS).mode).toBe("direct");
  });
});

describe("② requiredInserterCount — 벨트 용량 + Parallel Inserting", () => {
  const lines = [inL("a"), inL("b"), inL("c"), outL("z")];

  /** plan 에서 한 줄의 requiredInserterCount 조회. **모드와 무관하게** 달려 있어야 한다. */
  const armsOf = (d: Decision, name: string): number | undefined =>
    linesOf(d).find((l) => l.line.name === name)?.requiredInserterCount;

  it("수치를 안 주면 판정 보류 — undefined(없는 숫자를 지어내지 않는다)", () => {
    const d = run(base(lines), 3, SEATS, {});
    expect(d.mode).toBe("tap");
    expect(armsOf(d, "a")).toBeUndefined();
  });

  it("벨트를 안 골랐으면 수요가 한 줄을 넘을 때 거절 — 줄을 늘릴 수단이 없다", () => {
    const cap: Cap = {
      beltCapacity: 15,
      lineRates: new Map([["input:a", 20]]), // 20 > 15
    };
    const d = run(base(lines), 3, SEATS, cap); // belts 미지정
    expect(d.mode).toBe("direct");
    expect(reasonOf(d)).toContain("demand>beltCap");
  });

  it("머신 한 대 몫이 인서터 하나를 넘으면 Parallel Inserting — 탭을 늘린다", () => {
    const cap: Cap = {
      beltCapacity: 100,
      inserters: [{ entityName: 'i1', reach: 1, throughput: 5 }, { entityName: 'i2', reach: 2, throughput: 5 }],
      lineRates: new Map([["input:a", 30]]), // 30 / 3대 = 10, ceil(10/5) = 탭 2개
    };
    const d = run(base(lines), 3, SEATS, cap);
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
    const cap: Cap = {
      beltCapacity: 100,
      inserters: [{ entityName: 'i1', reach: 1, throughput: 5 }, { entityName: 'i2', reach: 2, throughput: 5 }],
      lineRates: new Map([["input:a", 30]]), // "b" 는 수량 미상 → 아예 없음
    };
    const d = run(base(lines), 3, SEATS, cap);
    expect(d.mode).toBe("tap");
    expect(armsOf(d, "b")).toBeUndefined(); // 보류. NaN 도 0 도 아니어야 한다.
    expect(Number.isNaN(armsOf(d, "b") as number)).toBe(false);
  });

  it("머신을 늘리면 머신당 몫이 줄어 탭이 1개로 준다", () => {
    const cap: Cap = {
      beltCapacity: 100,
      inserters: [{ entityName: 'i1', reach: 1, throughput: 5 }, { entityName: 'i2', reach: 2, throughput: 5 }],
      lineRates: new Map([["input:a", 30]]), // 30 / 8대 = 3.75 ≤ 5 → 탭 1개
    };
    const d = run(base(lines), 8, SEATS, cap);
    expect(d.mode).toBe("tap");
    expect(armsOf(d, "a")).toBe(1);
  });

  it("좌석이 모자라면(총 탭 > 면 좌석 행) 다이렉트로 거른다", () => {
    // a 혼자 E 면에서 탭 4개를 요구 — 3×3 면 좌석 3행을 넘는다.
    const cap: Cap = {
      beltCapacity: 100,
      inserters: [{ entityName: 'i1', reach: 1, throughput: 5 }, { entityName: 'i2', reach: 2, throughput: 5 }],
      lineRates: new Map([["input:a", 60]]), // 60 / 3대 = 20, ceil(20/5) = 탭 4개 > 3행
    };
    const d = run(base([inL("a"), outL("z")]), 3, SEATS, cap);
    expect(d.mode).toBe("direct");
    expect(reasonOf(d)).toContain("seats");
  });

  it("벨트 상한은 머신 수와 무관하다 — 합산 수요가 넘으면 몇 대든 거절", () => {
    const cap: Cap = {
      beltCapacity: 15,
      inserters: [{ entityName: 'i1', reach: 1, throughput: 100 }, { entityName: 'i2', reach: 2, throughput: 100 }],
      lineRates: new Map([["input:a", 20]]),
    };
    expect(run(base(lines), 100, SEATS, cap).mode).toBe("direct");
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
  const armsOf = (d: Decision, name: string): number | undefined =>
    linesOf(d).find((l) => l.line.name === name)?.requiredInserterCount;

  const cap: Cap = {
    beltCapacity: 100,
    inserters: [{ entityName: 'i1', reach: 1, throughput: 5 }, { entityName: 'i2', reach: 2, throughput: 5 }],
    lineRates: new Map([["input:a", 60]]), // 60 / 3대 = 20, ceil(20/5) = 팔 4개
  };

  // **다이렉트의 팔 개수는 이제 여기서 안 나온다** (2026-08-05 공급 모델 통합).
  // 탭이 깨지면 기계별 포트가 링크 배분기를 타고, 그 팔 수는 [externalLineGroups] 가
  // **같은 함수**([requiredInserterCount])로 낸다. 그래서 사실은 그대로이고 — 모드가 팔
  // 개수를 바꾸지 않는다 — 그 사실을 지키는 자리만 옮겼다. 여기서는 **두 출처가 같은 수를
  // 낸다**를 확인한다(수가 갈리면 좌석 예산과 실제로 앉는 팔이 어긋나 조용히 굶는다).
  it("좌석이 모자라면 다이렉트로 떨어지고, 자리는 여기서 안 잡는다", () => {
    const d = run(base([inL("a"), outL("z")]), 3, SEATS, cap);
    expect(d.mode).toBe("direct");
    expect(reasonOf(d)).toContain("seats");
    // 배정을 두 곳이 내면 장부가 갈린다 — 그래서 판정만 하고 **계획 자체를 안 낸다.**
    // 예전엔 빈 배열(`plan.lines === []`)로 그 뜻을 흉내 냈고, 지금은 필드가 아예 없다.
    expect("plan" in d, "다이렉트가 계획을 들고 나오면 배정 주체가 둘이 된다").toBe(false);
  });

  it("복잡한 레시피도 다이렉트 — 사유가 그렇게 말한다", () => {
    const lines = [inL("a"), inL("b"), inL("c"), outL("z")];
    const d = run(base(lines, false), 3, SEATS, cap); // 긴팔 없음 → complex
    expect(d.mode).toBe("direct");
    expect(reasonOf(d)).toContain("complex");
  });

  it("탭 계획과 기계별 그룹이 **같은 팔 개수**를 낸다 — 모드가 물리량을 못 바꾼다", () => {
    // 4줄 — 긴팔이 있으면 탭(면당 2레인 × 2면 = 4), 없으면 complex → 기계별 포트.
    // 갈리는 건 **모드뿐**이고 수요·머신 수·인서터 처리량은 같다.
    const lines = [inL("a"), inL("b"), inL("c"), outL("z")];
    const rates = { ...cap, lineRates: new Map([["input:a", 30]]) }; // 30/3대 = 10, ceil(10/5) = 2
    const tap = run(base(lines), 3, SEATS, rates);
    expect(tap.mode).toBe("tap");
    expect(armsOf(tap, "a")).toBe(2);

    expect(run(base(lines, false), 3, SEATS, rates).mode).toBe("direct");
    // 기계별 그룹이 든 팔 수 — 머신 3대니까 그룹 3개, 각각 팔 2개.
    const groups = externalLineGroups(lines, 3, rates, rates.inserters ?? [], undefined, { perMachine: true })
      .filter((g) => g.item === "a");
    expect(groups).toHaveLength(3);
    for (const g of groups) {
      expect([...g.to.values()], "모드가 팔 개수를 바꾸면 안 된다").toEqual([armsOf(tap, "a")]);
    }
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
  const placements = (d: Decision, name: string) =>
    linesOf(d).filter((l) => l.line.name === name);

  it("수요 40 → 빠른 벨트(30) + 나머지 10을 덮는 싼 벨트(15) = 2줄. 거절하지 않는다", () => {
    const d = run({ ...base([inL("a"), outL("z")]), belts }, 3, SEATS, {
      inserters: [{ entityName: 'i1', reach: 1, throughput: 100 }, { entityName: 'i2', reach: 2, throughput: 100 }],
      lineRates: new Map([["input:a", 40]]),
    });
    expect(d.mode, "옛 모델은 여기서 거절했다").toBe("tap");
    expect(placements(d, "a").map((p) => p.beltEntityName)).toEqual([
      "fast-transport-belt",
      "transport-belt",
    ]);
  });

  it("두 벨트는 서로 다른 자리에 앉는다 (같은 줄이어도 자리를 나눠 쓴다)", () => {
    const d = run({ ...base([inL("a"), outL("z")]), belts }, 3, SEATS, {
      inserters: [{ entityName: 'i1', reach: 1, throughput: 100 }, { entityName: 'i2', reach: 2, throughput: 100 }],
      lineRates: new Map([["input:a", 40]]),
    });
    const ps = placements(d, "a");
    const seats = ps.map((p) => `${p.side}:${p.clusterBeltDepth}`);
    expect(new Set(seats).size, `두 벨트가 같은 자리에 앉았다: ${seats}`).toBe(2);
  });

  it("한 줄로 감당되면 한 줄 그대로 — 필요 없는 벨트를 깔지 않는다", () => {
    const d = run({ ...base([inL("a"), outL("z")]), belts }, 3, SEATS, {
      inserters: [{ entityName: 'i1', reach: 1, throughput: 100 }, { entityName: 'i2', reach: 2, throughput: 100 }],
      lineRates: new Map([["input:a", 20]]),
    });
    expect(placements(d, "a")).toHaveLength(1);
    expect(placements(d, "a")[0].beltEntityName).toBe("fast-transport-belt");
  });

  it("수량을 모르는 줄은 한 줄 — 없는 숫자로 벨트를 늘리지 않는다", () => {
    const d = run({ ...base([inL("a"), outL("z")]), belts }, 3, SEATS, {
      inserters: [{ entityName: 'i1', reach: 1, throughput: 100 }, { entityName: 'i2', reach: 2, throughput: 100 }],
      lineRates: new Map(), // 수량 미상
    });
    expect(placements(d, "a")).toHaveLength(1);
  });

  it("늘린 줄이 면 용량을 넘으면 complex → 다이렉트 (거짓말 대신 정직한 위임)", () => {
    // 면당 벨트 2줄 × 2면 = 4. a 가 4줄을 요구하면 z 가 앉을 자리가 없다.
    const d = run({ ...base([inL("a"), outL("z")]), belts }, 3, SEATS, {
      inserters: [{ entityName: 'i1', reach: 1, throughput: 100 }, { entityName: 'i2', reach: 2, throughput: 100 }],
      lineRates: new Map([["input:a", 110]]), // 30×3 + 20 → 4줄
    });
    expect(d.mode).toBe("direct");
    expect(reasonOf(d)).toContain("lanes-exceed-capacity");
  });
});

/**
 * ④-B **레인 부족은 벨트 문제가 아니다** — battery 실측(2026-08-05).
 *
 * battery = 아이템 2입력(iron-plate·copper-plate) + 1출력 + 유체 1(sulfuric-acid),
 * 화학공장 3×3. 유체 면은 머신 `fluid_box` 가 강제하므로 W/E 중 한 면이 파이프에 넘어가고,
 * 점프(지하파이프)가 없으면 그 면은 [케이스 B](reach≥2 전용)라 **긴팔이 없으면 레인 0** 이다.
 * 남는 것은 반대 면의 1레인뿐 — 아이템 3줄이 들어갈 리가 없다.
 *
 * 여기서 못 박는 것은 **처방이 어느 축을 가리키나**다. 사유 문구가 "belt" 로 시작하던 시절
 * 화면은 4단계(벨트)로 보냈는데, 벨트를 아무리 바꿔도 레인은 안 는다 — 늘려야 하는 것은
 * **서로 다른 reach 값 개수**(= 긴팔 인서터 선택)다. 그리고 이 거절이 곧 "탭 포기" 이므로,
 * 유체 줄은 그대로 [emitTrunkPipe] 가 기계별 포트 옆에서 깐다(2026-08-05 이후).
 */
describe("④-B battery 형상 — 레인 부족의 처방은 인서터다", () => {
  const battery = [inL("iron-plate"), inL("copper-plate"), outL("battery")];
  /** 유체 면 E — `jumpable` 은 지하파이프를 골랐는지에 갈린다. */
  const runBattery = (hasLong: boolean, jumpable: boolean): Decision =>
    run({ ...base(battery, hasLong), pipeFaces: [{ side: "E" as const, fluidRows: 1, jumpable }] },
      3,
      SEATS,
      {},
    );

  it("긴팔 없음 → 레인 부족. 사유가 **인서터 reach** 를 짚는다(벨트가 아니라)", () => {
    for (const jumpable of [false, true]) {
      const d = runBattery(false, jumpable);
      expect(d.mode, `jumpable=${jumpable}`).toBe("direct");
      expect(reasonOf(d)).toContain("lanes-exceed-capacity");
      expect(reasonOf(d)).toContain("고른 인서터 reach [1]");
      // 옛 이름으로 되돌아가면 화면 처방이 다시 4단계(벨트)로 샌다.
      expect(reasonOf(d)).not.toContain("belt-demand");
    }
  });

  it("점프 불가 유체 면은 레인 0 — 문구가 그 면을 지목한다", () => {
    expect(reasonOf(runBattery(false, false))).toContain("E0(유체·reach≥2 전용)");
  });

  it("긴팔을 고르면 케이스 B 로 유체 면이 1레인을 내어 3줄이 앉는다 → tap", () => {
    for (const jumpable of [false, true]) {
      const d = runBattery(true, jumpable);
      expect(d.mode, `jumpable=${jumpable}`).toBe("tap");
      expect(linesOf(d).length).toBeGreaterThan(0);
    }
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
  const armsOf = (d: Decision, name: string) => linesOf(d).filter((l) => l.line.name === name);
  const armSum = (d: Decision, name: string) =>
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
    const d = run({ ...base([inL("a"), outL("z")]), belts }, 3, SEATS, {
      inserters: [{ entityName: 'i1', reach: 1, throughput: 5 }, { entityName: 'i2', reach: 2, throughput: 5 }],
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
    const d = run({ ...base([inL("a"), outL("z")]), belts: [fast, { entityName: "t", throughput: 15 }] },
      2,
      SEATS,
      { inserters: [{ entityName: 'i1', reach: 1, throughput: 10 }, { entityName: 'i2', reach: 2, throughput: 10 }], lineRates: new Map([["input:a", 40]]) },
    );
    expect(armsOf(d, "a").length).toBe(2); // 벨트 2줄
    expect(armSum(d, "a"), "배정마다 팔을 통째로 달면 4가 된다").toBe(2);
  });

  it("한 면에 들어가면 안 나눈다 — 필요 없는 배정을 만들지 않는다", () => {
    const d = run({ ...base([inL("a"), outL("z")]), belts }, 3, SEATS, {
      inserters: [{ entityName: 'i1', reach: 1, throughput: 5 }, { entityName: 'i2', reach: 2, throughput: 5 }],
      lineRates: new Map([["input:a", 30]]), // 30/3 = 10, ceil(10/5) = 팔 2개 ≤ 3행
    });
    expect(armsOf(d, "a").length).toBe(1);
    expect(armSum(d, "a")).toBe(2);
  });
});

/**
 * **거절은 항상 안전하다** — 탭을 포기해도 모듈이 죽지 않는다.
 *
 * 예전엔 이 자리에서 *"폴백 계획이 `ok` 다"* 를 확인했다. 그 계획은 이제 여기서 안 나온다
 * (기계별 포트 = 링크 배분기 소관, 2026-08-05). 그래서 여기서 지킬 수 있는 불변식은
 * **"거절에는 언제나 사유가 붙는다"** 로 좁아진다 — 사유 없는 거절은 화면이 처방을 못 낸다
 * ([moduleWizard] 의 `fixStep` 이 이 문구로 갈린다).
 */
describe("거절은 항상 안전하다 — 사유 없는 거절이 없다", () => {
  it("어떤 사유로 거절돼도 mode 와 reason 이 함께 온다", () => {
    const cases: [string, Decision][] = [
      ["복잡한 레시피", run(base([inL("a"), inL("b"), inL("c"), outL("z")], false), 3, SEATS)],
      [
        "벨트 용량",
        run(base([inL("a"), outL("z")]), 3, SEATS, {
          beltCapacity: 1,
          lineRates: new Map([["input:a", 99]]),
        }),
      ],
    ];
    for (const [tag, d] of cases) {
      expect(d.mode, tag).toBe("direct");
      expect(reasonOf(d), `${tag}: 사유가 비었다`).not.toBe("");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// **어떤 배정도 자기 벨트를 넘겨 싣지 않는다** (2026-07-23).
//
// 배정 하나가 받을 수 있는 팔은 `min(면 좌석 행, 그릇)` 인데, 예전엔 배정 **수**를 좌석
// 행으로만 셌다(`ceil(팔 ÷ 면 행)`). 그러면 마지막 배정이 남은 팔을 다 받아 자기 벨트를
// 넘긴다 — [armsByPlacement] 는 "합은 언제나 total"이라 깎지 않기 때문이다(깎으면 조용히
// 굶는다). 실제로 7×7 머신·벨트 45/s·팔 10/s·수요 90/s 에서 부하가 [40, **50**] 이었다.
//
// 수요를 훑어 **한 건도** 안 넘는지 본다. 한 케이스만 박아 두면 경계가 조금만 움직여도
// 그 케이스를 비껴간다.
// ─────────────────────────────────────────────────────────────────────────────
describe("그릇 — 어떤 배정도 자기 벨트를 넘기지 않는다", () => {
  const BELT = 45;
  const TAP = 10;
  /** 실측 모드팩 값(express 45/s, fast 10/s, 7×7 머신). */
  const sweep = (rate: number, machineCount: number) => {
    const line = inL("x");
    const res = run({
        lines: [line],
        inserters: [{ entityName: "fast-inserter", reach: 1, throughput: TAP }],
        outputSide: "W",
        belts: [{ entityName: "express-transport-belt", throughput: BELT }],
      },
      machineCount,
      { WE: 7, NS: 7 },
      { inserters: [{ entityName: 'i1', reach: 1, throughput: TAP }, { entityName: 'i2', reach: 2, throughput: TAP }], lineRates: new Map([["input:x", rate]]) } as Cap,
    );
    if (res.mode !== "tap") return [];
    return res.plan.lines
      .filter((p) => p.line.kind === "belt")
      .map((p) => (p.requiredInserterCount ?? 1) * TAP);
  };

  it("머신 수·수요를 훑어도 벨트 상한을 넘는 배정이 없다", () => {
    const over: string[] = [];
    for (const machineCount of [1, 2, 4, 5, 8]) {
      for (let rate = 10; rate <= 600; rate += 10) {
        const loads = sweep(rate, machineCount);
        if (loads.some((l) => l > BELT)) over.push(`머신${machineCount} rate=${rate} → [${loads}]`);
      }
    }
    expect(over).toEqual([]);
  });

  it("고치기 전 터지던 그 자리 — 머신 1대·수요 90/s 는 이제 탭을 거절한다", () => {
    // 예전: 배정 2개로 잡아 부하 [40, **50**] — 벨트가 못 나르는데 "성공"이라 보고했다.
    // 지금: 그릇까지 세면 배정 3개가 필요한데 이 모듈은 벨트 3줄을 못 놓는다 → **direct 폴백**.
    // (이 픽스처는 **reach 1 하나만** 고른다 → 면당 1레인 × 2면 = 슬롯 둘뿐이다.)
    //
    // 이게 옳은 답이다. 못 하는 걸 못 한다고 말하는 쪽이, 되는 척하며 조용히 굶는 것보다 낫다
    // ("거절은 항상 안전하다" — 1:1 은 구성으로 성립한다). 고친 결과가 "배정이 하나 늘었다"가
    // 아니라 "정직하게 물러났다"인 것은 **예상과 달랐고**, 그래서 여기 적어 둔다.
    expect(sweep(90, 1)).toEqual([]); // 탭 계획 없음 = direct 로 물러남
  });
});
