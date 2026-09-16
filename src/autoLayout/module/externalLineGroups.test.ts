import { describe, it, expect } from "vitest";
import { externalLineGroups } from "./link";
import type { IoLine, SupplyCapacity } from "./types/line";
import type { SpecInserter } from "../shared/gamedata/spec";

/**
 * **외부 줄도 [Link] 이다** (2026-07-23 사장님 결정).
 *
 * 원료·완제품 줄과 자식↔부모 링크는 **같은 형제 단계**다 — 머신 면에 팔을 앉히고 벨트로
 * 나른다. 다른 건 상대가 안이냐 밖이냐 하나뿐이고, 그건 `from`/`to` 의 **빈 쪽**으로
 * 드러난다. 이 테스트가 지키는 것은 그 대응이지 좌표가 아니다(방출은 아직 옛 경로).
 */
const lines: IoLine[] = [
  { name: "iron-plate", kind: "belt", role: "input" },
  { name: "gear", kind: "belt", role: "output" },
];

/**
 * **다이렉트(기계별 포트)의 팔은 언제나 `reach 1`** — 인서터가 상자와 머신 **양쪽에 인접**
 * 해야 하므로 상자가 `d2`, 팔이 `d1` 이다. 깊은 벨트를 집는 것은 탭뿐이다(계획서 §16).
 *
 * 처리량이 `SupplyCapacity` 가 아니라 **인자**로 오는 이유는 `docs/용어사전.md §BuildSpec` — 인서터는 사용자가 한 번
 * 고르는 전역 선택이라 노드마다 실어 나르면 같은 사실이 복제된다.
 */
const INS: SpecInserter[] = [{ entityName: "i", reach: 1, throughput: 5 }];

/**
 * **벨트도 저울과 함께 온다** — 티어 목록이 없으면 몇 줄인지 정할 수 없어 줄이 아예 안 난다.
 * 여기서는 한 줄에 다 담기는 넉넉한 티어를 쓴다 — 이 파일이 보는 것은 *줄 수* 가 아니라
 * **팔 배분**이라, 줄이 갈리면 검사의 초점이 흐려진다.
 *
 * **줄 하나에 실리는 것은 벨트의 절반(레인 하나)이다**(2026-09-03, `belt-lane-semantics` ①).
 * 그래서 *"한 줄이 100 을 싣는다"* 를 얻으려면 물리 처리량이 **200** 이라야 한다.
 * 아래 주석의 계산은 전부 그 **100**(= 레인) 기준이다.
 */
const BELTS = [{ entityName: "b", throughput: 200 }]; // 레인 100

/** 머신 3대, 팔 하나가 초당 5개. iron 60/3대 = 20 → ceil(20/5) = 팔 4개/머신. */
const cap: SupplyCapacity = {
  lineRates: new Map([
    ["input:iron-plate", 60],
    ["output:gear", 30],
  ]),
};

describe("외부 줄 → Link — 빈 쪽이 곧 '밖'이다", () => {
  const groups = externalLineGroups(lines, 3, cap, INS, undefined, { belts: BELTS });

  it("원료는 from 이 비고, to 에 이 클러스터 머신들이 전부 든다", () => {
    const g = groups.find((x) => x.item === "iron-plate")!;
    expect(g.from.size).toBe(0); // 밖에서 온다
    expect([...g.to]).toEqual([[0, 4], [1, 4], [2, 4]]);
  });

  it("완제품은 to 가 비고, from 에 머신들이 든다 — 원료의 거울", () => {
    const g = groups.find((x) => x.item === "gear")!;
    expect(g.to.size).toBe(0); // 밖으로 간다
    expect([...g.from]).toEqual([[0, 2], [1, 2], [2, 2]]); // 30/3=10, ceil(10/5)=2
  });

  // **뒤집혔다**(2026-08-17). 옛 답은 `["ext:input:iron-plate", "ext:output:gear"]` 였고,
  // 사유는 *"로그·조회가 줄과 그룹을 이어 볼 수 있게"* 였다. 목적은 정당한데 **자리가 틀렸다** —
  // [Link.id] 는 편의 식별자가 아니라 **지정 짝의 토큰**이고, 비어 있는 것이
  // *"교환 가능"* 이라는 적극적 사실을 나른다([pairDeliveryPorts] 가 그 유무로 갈린다).
  //
  // 채워 두면 자식의 `ext:output:X` 와 부모의 `ext:input:X` 가 **절대 안 맞아** 조회 갈래에서
  // 짝을 못 찾고, 그 줄이 납품 경로를 통째로 잃는다(2026-08-17 실측 — 33건 실패의 뿌리).
  // 줄과 그룹을 이어 보는 일은 `item`·`role` 로 이미 된다.
  it("신원을 안 단다 — 원료·완제품은 **교환 가능**이라 지정 짝이 없다", () => {
    expect(groups.map((g) => g.id)).toEqual([undefined, undefined]);
  });
});

describe("그룹이 안 되는 줄 — 지어내지 않는다", () => {
  // **수량을 모르면 그룹을 안 만든다** (2026-08-24 — 옛 답은 *"팔 1개로 만든다"* 였다).
  //
  // 이 답은 두 번 뒤집혔다. 처음엔 안 만들었고(부하를 모르는 채 벨트를 만들면 계산이
  // 거짓말을 시작한다), 2026-08-16 에 만들도록 뒤집혔다 — 안 만들면 그 줄이 **통째로
  // 사라졌기** 때문이다. 그때 채운 "팔 1개"는 지어낸 수가 아니라 관례라고 봤는데, 실제로는
  // **아는 척하는 줄**이었다: 포트가 나고 벨트가 깔리는데 실을 양이 없어, 배치는 성공이라
  // 보고하고 게임에 넣어야 굶는 걸 안다.
  //
  // 지금은 안 만들되 **사라지지도 않는다** — 못 부은 줄은 `planModulePorts` 가
  // [ModulePortPlan.unpourableLines] 로 모아 모듈의 `unroutedLines` 에 올린다. 두 답의
  // 좋은 쪽만 남은 셈이다: 가짜 줄도 없고 조용한 소실도 없다.
  it("수량 미상이면 그 줄은 안 만든다 — 없는 숫자로 벨트를 깔지 않는다", () => {
    // gear 만 rate 가 있다 — iron 은 lineRates 에 없다.
    const partial: SupplyCapacity = { lineRates: new Map([["output:gear", 30]]) };
    const gs = externalLineGroups(lines, 3, partial, INS, undefined, { belts: BELTS });
    expect(gs.map((g) => g.item)).toEqual(["gear"]);
  });

  it("팔 처리량을 모르면 그 줄도 안 만든다 — 팔이 몇 개인지 정할 근거가 없다", () => {
    const gs = externalLineGroups(lines, 3, { lineRates: cap.lineRates }, [], undefined, { belts: BELTS });
    expect(gs).toHaveLength(0);
  });

  it("벨트를 하나도 안 주면 줄 수를 못 정한다 — 역시 안 만든다", () => {
    expect(externalLineGroups(lines, 3, cap, INS, undefined, { belts: [] })).toHaveLength(0);
  });

  it("유체는 벨트 장부에 안 올린다 — 트렁크 파이프의 일이다", () => {
    const fluid: IoLine[] = [{ name: "water", kind: "pipe", role: "input" }];
    const c: SupplyCapacity = { lineRates: new Map([["input:water", 60]]) };
    expect(externalLineGroups(fluid, 3, c, INS, undefined, { belts: BELTS })).toHaveLength(0);
  });

  it("이미 내부 링크가 있는 줄은 두 번 세지 않는다", () => {
    const linked = new Set(["output:gear"]);
    expect(externalLineGroups(lines, 3, cap, INS, linked, { belts: BELTS }).map((g) => g.item)).toEqual(["iron-plate"]);
  });
});

// 팔 수는 [requiredInserterCount] 하나에서 온다 — 이 함수가 자기 식을 따로 갖지 않는지.
// (이 세션에 고친 버그들의 공통 원인이 "같은 수를 두 곳이 각자 유도"였다.)
describe("팔 수는 requiredInserterCount 와 같은 값", () => {
  it("머신 수가 늘면 머신당 팔은 줄어든다 — 클러스터 rate 를 나눠 갖는다", () => {
    const one = externalLineGroups(lines, 1, cap, INS, undefined, { belts: BELTS })[0].to.get(0);
    const six = externalLineGroups(lines, 6, cap, INS, undefined, { belts: BELTS })[0].to.get(0);
    expect(one).toBe(12); // 60/1 = 60, ceil(60/5)
    expect(six).toBe(2); //  60/6 = 10, ceil(10/5)
  });

  it("아무리 적어도 팔은 1개 — 0개면 그 머신은 아예 안 돈다", () => {
    const tiny: SupplyCapacity = { lineRates: new Map([["input:iron-plate", 0.1]]) };
    expect(externalLineGroups(lines, 3, tiny, INS, undefined, { belts: BELTS })[0].to.get(0)).toBe(1);
  });
});

/**
 * **부분 트렁크 — `g` 가 줄마다 유도된다** (2026-08-30).
 *
 * 예전엔 묶음 크기가 **모듈 하나의 라벨**(`tap`/`direct`)로 정해져 두 극단뿐이었다:
 *
 * ```
 * tap     → g = N   벨트 하나가 기둥 전체
 * direct  → g = 1   머신마다 자기 벨트
 * ```
 *
 * 이제 처리량이 상한을 준다 — `g = min(⌊벨트 ÷ 머신 하나의 몫⌋, N)`.
 * **옛 이분법이 그 공식의 두 끝**이 된다.
 */
describe("묶음 크기 `g` — 처리량이 상한을 준다", () => {
  const line: IoLine[] = [{ name: "x", kind: "belt", role: "input" }];
  /** 줄 하나에 100(레인) · 머신 `n` 대 · 총 수요 `total` → 머신 하나의 몫 = total/n. */
  const run = (n: number, total: number, bundle?: number) =>
    externalLineGroups(line, n, { lineRates: new Map([["input:x", total]]) }, INS, undefined,
      { belts: BELTS, bundle });

  it("**부분** — 벨트가 3대치면 6대가 두 토막으로 갈린다 (오늘 없던 값)", () => {
    // per = 180/6 = 30.  k = ⌊100/30⌋ = 3  →  g = 3  →  c = ⌈6/3⌉ = 2
    const gs = run(6, 180);
    expect(gs).toHaveLength(2);
    expect(gs.map((g) => [...g.to.keys()])).toEqual([[0, 1, 2], [3, 4, 5]]);
  });

  it("**관통** — 수요가 작으면 한 줄이 전부 맡는다 (옛 `tap`)", () => {
    // per = 6/6 = 1.  k = 100  →  g = 6
    const gs = run(6, 6);
    expect(gs).toHaveLength(1);
    expect([...gs[0].to.keys()]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("**다이렉트** — 한 대가 벨트를 넘으면 머신마다 하나 (옛 `direct`)", () => {
    // per = 720/6 = 120 > 100  →  k = 0 → g = 1.  줄마다 벨트가 여럿 날 수 있다
    const gs = run(6, 720);
    expect(gs.every((g) => g.to.size === 1), "머신 하나씩 맡아야 한다").toBe(true);
    expect(new Set(gs.flatMap((g) => [...g.to.keys()]))).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });

  it("`bundle` 을 주면 그 값이 이긴다 — gap 탈출이 필요할 때 호출부가 못박는다", () => {
    const gs = run(6, 6, 1); // 유도했으면 g=6 인데 1 로 못박는다
    expect(gs).toHaveLength(6);
    expect(gs.every((g) => g.to.size === 1)).toBe(true);
  });
});

/**
 * **넘친 줄만 내려간다** — 계산의 산출이 **줄마다**여야 성립한다(2026-08-31).
 *
 * 예전엔 `planClusterPorts` 가 *어느 줄이* 자리를 못 찾았는지 알면서도 모듈 하나의
 * 라벨(`tap`/`direct`)로 접어 냈고, 그래서 **한 줄이 안 되면 그 모듈의 모든 줄**이
 * `g = 1` 로 떨어졌다. 여기서 잠그는 것은 그 대응이다:
 *
 * ```
 * 넘친 줄      bundle 1  →  머신마다 하나 (gap 으로 갈 수 있는 유일한 값)
 * 안 넘친 줄   유도값    →  **부분 트렁크가 살아 있다**
 * ```
 */
describe("줄마다 다른 묶음 크기 — 한 줄이 내려가도 남은 줄은 안 내려간다", () => {
  const two: IoLine[] = [
    { name: "a", kind: "belt", role: "input" },
    { name: "b", kind: "belt", role: "input" },
  ];
  /** 둘 다 per = 180/6 = 30 → k = ⌊100/30⌋ = 3 → 유도값 g = 3. */
  const rates: SupplyCapacity = { lineRates: new Map([["input:a", 180], ["input:b", 180]]) };
  const pour = (line: IoLine, bundle?: number) =>
    externalLineGroups([line], 6, rates, INS, undefined, { belts: BELTS, bundle });

  it("`a` 만 내리면 `a` 는 6그룹 · `b` 는 **2그룹 그대로**", () => {
    const a = pour(two[0], 1);
    const b = pour(two[1]); // 유도값
    expect(a).toHaveLength(6);
    expect(a.every((g) => g.to.size === 1), "내린 줄은 머신마다 하나").toBe(true);
    expect(b).toHaveLength(2);
    expect(b.map((g) => [...g.to.keys()])).toEqual([[0, 1, 2], [3, 4, 5]]);
  });

  it("대조군 — 둘 다 내리면 둘 다 6그룹 (옛 모듈 단위 동작)", () => {
    expect(pour(two[0], 1)).toHaveLength(6);
    expect(pour(two[1], 1)).toHaveLength(6);
  });
});
