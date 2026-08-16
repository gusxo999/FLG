import { describe, it, expect } from "vitest";
import { externalLineGroups } from "./machineLinkGroup";
import type { IoLine, SupplyCapacity } from "../planner/module/clusterPortPlanner";
import type { SpecInserter } from "../buildSpec";

/**
 * **외부 줄도 [MachineLinkGroup] 이다** (2026-07-23 사장님 결정).
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
 * 처리량이 `SupplyCapacity` 가 아니라 **인자**로 오는 이유는 §18 — 인서터는 사용자가 한 번
 * 고르는 전역 선택이라 노드마다 실어 나르면 같은 사실이 복제된다.
 */
const INS: SpecInserter[] = [{ entityName: "i", reach: 1, throughput: 5 }];

/** 머신 3대, 팔 하나가 초당 5개. iron 60/3대 = 20 → ceil(20/5) = 팔 4개/머신. */
const cap: SupplyCapacity = {
  lineRates: new Map([
    ["input:iron-plate", 60],
    ["output:gear", 30],
  ]),
};

describe("외부 줄 → MachineLinkGroup — 빈 쪽이 곧 '밖'이다", () => {
  const groups = externalLineGroups(lines, 3, cap, INS);

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
  // [MachineLinkGroup.id] 는 편의 식별자가 아니라 **지정 짝의 토큰**이고, 비어 있는 것이
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
  /** 이 줄이 머신 쪽에 쓴 팔 — 입력이면 `to`, 출력이면 `from` 이 머신 맵이다. */
  const armsOf = (g: { from: Map<number, number>; to: Map<number, number> }) =>
    g.from.size ? g.from : g.to;

  // **수량을 몰라도 그룹은 만든다** (2026-08-16 — 옛 답은 *"안 만든다"* 였다).
  //
  // 뒤집힌 이유는 그 답의 전제가 사라졌기 때문이다. 예전엔 안 만들어도 **옛 탭 경로가 그 줄을
  // 맡았고**, 그래서 *"부하를 모르는 채로 벨트 그룹을 만들면 계산이 거짓말을 시작한다"* 가
  // 공짜였다. 그 경로가 사라진 지금(계획서 §19-④) 안 만들면 **그 줄이 통째로 사라진다.**
  //
  // 채우는 값은 지어낸 수가 아니라 **이미 있는 관례**다 — `PlannedLine.requiredInserterCount`
  // 의 소비처가 전부 *"판정 보류 = 팔 1개"* 로 읽는다. 부하 축은 `beltCapacity` 가 따로
  // 거절하고, 그건 수량을 알 때만 켜진다.
  it("수량 미상이어도 그룹을 만든다 — 팔 1개(판정 보류)로", () => {
    // gear 만 rate 가 있다 — iron 은 lineRates 에 없다.
    const partial: SupplyCapacity = { lineRates: new Map([["output:gear", 30]]) };
    const gs = externalLineGroups(lines, 3, partial, INS);
    expect(gs.map((g) => g.item)).toEqual(["iron-plate", "gear"]);
    // 모르는 줄은 머신마다 팔 하나 — 아는 줄은 자기 수요대로.
    expect([...armsOf(gs[0]).values()]).toEqual([1, 1, 1]);
  });

  it("팔 처리량을 몰라도 그룹은 선다 — 팔 1개로", () => {
    const gs = externalLineGroups(lines, 3, { lineRates: cap.lineRates }, []);
    expect(gs.map((g) => g.item)).toEqual(["iron-plate", "gear"]);
    for (const g of gs) expect([...armsOf(g).values()]).toEqual([1, 1, 1]);
  });

  it("유체는 벨트 장부에 안 올린다 — 트렁크 파이프의 일이다", () => {
    const fluid: IoLine[] = [{ name: "water", kind: "pipe", role: "input" }];
    const c: SupplyCapacity = { lineRates: new Map([["input:water", 60]]) };
    expect(externalLineGroups(fluid, 3, c, INS)).toHaveLength(0);
  });

  it("이미 내부 링크가 있는 줄은 두 번 세지 않는다", () => {
    const linked = new Set(["output:gear"]);
    expect(externalLineGroups(lines, 3, cap, INS, linked).map((g) => g.item)).toEqual(["iron-plate"]);
  });
});

// 팔 수는 [requiredInserterCount] 하나에서 온다 — 이 함수가 자기 식을 따로 갖지 않는지.
// (이 세션에 고친 버그들의 공통 원인이 "같은 수를 두 곳이 각자 유도"였다.)
describe("팔 수는 requiredInserterCount 와 같은 값", () => {
  it("머신 수가 늘면 머신당 팔은 줄어든다 — 클러스터 rate 를 나눠 갖는다", () => {
    const one = externalLineGroups(lines, 1, cap, INS)[0].to.get(0);
    const six = externalLineGroups(lines, 6, cap, INS)[0].to.get(0);
    expect(one).toBe(12); // 60/1 = 60, ceil(60/5)
    expect(six).toBe(2); //  60/6 = 10, ceil(10/5)
  });

  it("아무리 적어도 팔은 1개 — 0개면 그 머신은 아예 안 돈다", () => {
    const tiny: SupplyCapacity = { lineRates: new Map([["input:iron-plate", 0.1]]) };
    expect(externalLineGroups(lines, 3, tiny, INS)[0].to.get(0)).toBe(1);
  });
});
