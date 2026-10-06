import { describe, it, expect } from "vitest";
import { packModuleTree } from "../tree/build";
import type { NodeSpec, PackConfig } from "../tree/types/pack";
import { routeDeliveryRoutes } from "./build";
import { plannedChainsOf } from "./ledger";
import type { IoLine } from "../module/types/line";

/**
 * **모서리에 걸린 지하 점프를 한 구간 일찍 먹으면 안 된다** (2026-07-22).
 *
 * 계단꼴 납품 경로는 [모서리]에서 방향을 한 번 튼다. 그 모서리에서 **시작하는** 지하 점프는 다음
 * 구간(가로)의 것인데, `onSegment` 가 끝점을 포함하므로 그 앞 구간(세로)에서도 "구간 위"로
 * 잡혔다. 그걸 먹으면 점프가 우리를 모서리 **너머로** 데려가고, 코드는 여전히 원래 목표
 * (모서리)로 걸어가려 해서 **왔던 길을 되돌아간다** — 같은 칸을 세 번 지나며 지상 점유로
 * 붙잡는다.
 *
 * 그 가짜 점유의 대가가 **둘**이다: 다른 납품 경로의 정당한 트랙과 부딪히고, 계획끼리의 상호 검사가
 * 서로를 이유로 **둘 다** 탐색 폴백시킨다. 지하 횡단은 애초에 그 납품 경로를 **피해서** 밑으로
 * 건너려고 낸 계획인데, 검사기가 그걸 충돌로 읽은 것이다.
 *
 * 실측(브라우저 kr-glass 16머신)에서 납품 경로 16개 중 5개가 탐색으로 났고, 그 조사에서 나온 버그다.
 *
 * **2026-08-22 형상 갱신.** 흐름을 벨트 줄로 접게 되면서(용어사전 §D "배선 형태 셋") 옛 형상
 * (부모 2 / 자식 4)이 납품 경로 4개로 줄었고 **더 이상 지하 횡단을 만들지 않는다** — 즉 이
 * 테스트의 전제가 사라졌다. 통과시키려고 기대값을 낮추면 **지키려던 불변식을 안 재게 되므로**,
 * 지하 횡단이 실제로 계획되는 형상으로 옮긴다(부모 3 / 자식 2, 같은 총량 60/60).
 */
const M = { entityName: "assembling-machine-3", w: 3, h: 3 };
const inL = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
const outL = (name: string): IoLine => ({ name, kind: "belt", role: "output" });

const config: PackConfig = {
  inserterEntityName: "inserter",
  inserters: [{ entityName: "inserter", reach: 1, throughput: 6 }, { entityName: "long-handed-inserter", reach: 2, throughput: 6 }],
  beltEntityName: "transport-belt",
  // **벨트 처리량은 물리값(두 레인)이다** — 줄 하나가 싣는 것은 그 절반이다
  //  (`docs/factorio/belt-lane-semantics.md` ①: 인서터는 먼 레인에만 떨군다).
  //  아래 계산은 전부 **레인** 기준이라, 물리값을 그 두 배로 준다.
  belts: [{ entityName: "transport-belt", throughput: 40 }], // 줄 하나가 20
  // 예약 장부를 켠다 — 안 켜면 납품 경로가 전부 dijkstra 로 나서 이 버그가 안 드러난다.
  reservePerimeterExits: true,
  // **모듈도 같은 지하벨트를 고른다** — gap 출구는 옆면의 세로 벨트를 건너야 할 수 있어 지하벨트가 있어야 앉는다
  // (`trunk-blocked.md` §4.2). 없으면 머신 사이 gap 이 안 열려 모듈 모양이 달라지고, 이 시험의 전제(지하 횡단)가 흔들린다.
  // 사거리는 납품과 모듈이 **같은 값**이라야 한 종류다 — 바닐라 `underground-belt` 의 5(2026-09-25 전엔 납품만 4 였다.
  // 모듈의 gap 출구 자격은 레인 합류를 켜면 옆면 깊이 3 + 합류 열 2 = 5 를 보므로 4 면 싣는 쪽 gap 이 안 열린다 — 꺼짐(기본)이면 3 이다).
  beltMaxUndergroundDistance: 5,
  undergroundBelts: [{ entityName: "underground-belt", throughput: 40, maxDistance: 5 }],
};

/** 지하 횡단이 실제로 계획되는 형상 — 부모 3 / 자식 2, 총 60/60. */
function pack() {
  const specs: NodeSpec[] = [
    {
      id: "p", depth: 0, machine: M, count: 3,
      lines: [inL("x"), outL("prod")],
      supplyCapacity: { lineRates: new Map([["input:x", 60], ["output:prod", 60]]) },
    },
    {
      id: "c", depth: 1, parentId: "p", machine: M, count: 2,
      lines: [outL("x")],
      supplyCapacity: { lineRates: new Map([["output:x", 60]]) },
    },
  ];
  return packModuleTree(specs, config);
}

describe("지하 횡단 사슬 — 모서리 점프를 앞 구간이 먹지 않는다", () => {
  const p = pack();
  const delivery = routeDeliveryRoutes(p, {
    beltEntityName: "transport-belt",
    undergroundBeltEntityName: "underground-belt",
    beltMaxUndergroundDistance: 5,
  });

  it("이 형상이 실제로 지하 횡단을 계획한다 (전제 확인)", () => {
    const kinds = [...(p.channelGeometry?.deliveries.values() ?? [])].map((g) => g.kind);
    expect(kinds).toContain("undergroundCrossing");
  });

  it("만든 계획을 하나도 안 버린다 — 방출에서 막힌 계획 0", () => {
    // 버그가 있던 시절: 계획은 다 있는데(noPlan 0) 일부가 fallback 이었다.
    // 되돌아 걷는 사슬 **하나**가 멀쩡한 이웃까지 끌고 떨어졌다 — 그래서 *"계획이 방출에서 막혔다"* 가 신호다.
    //
    // **개수를 못 박지 않는다**(2026-09-04) — 레인 합류가 기본으로 켜지면서 같은 품목
    // 두 줄이 납품 하나로 접혀 6 → 3 이 됐다(기본은 2026-10-06 에 다시 꺼졌다). 그건 이 테스트가 겨눈 결함과 **무관한
    // 기능**이다. 겨눈 것은 *"만든 계획을 하나도 안 버린다"* 이므로 총계가 아니라 **방출이 버린 계획의 사유**로 잰다.
    //
    // **계획 수 = 납품 수 로 재지 않는다**(2026-10-02) — 장부가 꺾이는 칸에 지하 입구 · 출구를 두지 않게 되면서(`channel/
    // ledger/geometry.placeWithJumps`) 그런 자리밖에 없는 납품은 계획 없이 사유(`crossing-needs-underground`)를 남기고 탐색으로
    // 간다. 그건 장부가 *안 만든* 계획이지 방출이 *버린* 계획이 아니다.
    expect(p.deliveries.length).toBeGreaterThan(0);
    expect(delivery.failures).toBe(0);
    const discarded = delivery.chainMisses.filter((m) => m.reason.startsWith("chain-"));
    expect(discarded).toEqual([]);
    expect(delivery.planned).toBeGreaterThan(0);
  });

  it("계획된 사슬은 같은 칸을 두 번 밟지 않는다 (되돌아 걷기 금지)", () => {
    // 되돌아 걷는 사슬은 자기 칸을 중복으로 들고 있었다 — 그 자체로 정직하지 않은 경로다.
    for (const g of p.channelGeometry?.deliveries.values() ?? []) {
      if (g.kind !== "undergroundCrossing") continue;
      // 점프는 **한 방향으로만** 뻗는다: 입구에서 출구로 가는 벡터가 계단 진행 방향과 같다.
      for (const j of g.jumps) {
        expect(j.from.x === j.to.x || j.from.y === j.to.y).toBe(true);
        expect(j.from.x !== j.to.x || j.from.y !== j.to.y).toBe(true);
      }
    }
  });

  it("지하 출구는 꺾이는 칸에 없다 — 나간 방향 그대로 나간다", () => {
    // 지하벨트 출구는 제 방향으로만 내놓는다 — 꺾이는 칸의 출구는 경로의 다음 칸이 아니라 그 옆으로 내놓는 끊긴 길이다.
    // 2026-10-02 까지 장부엔 이 규칙이 없어 그런 계획이 방출됐다(`channel/ledger/geometry.placeWithJumps`). 벨트 입구는
    // 꺾이는 칸에 설 수 있다 — 옆 싣기로 한 레인을 받고, 줄 하나는 원래 한 레인이다.
    const { plannedChains } = plannedChainsOf(p, 5, 0);
    let jumps = 0;
    for (const chain of plannedChains.values()) {
      const dir = (i: number) => `${Math.sign(chain.cells[i + 1].x - chain.cells[i].x)},${Math.sign(chain.cells[i + 1].y - chain.cells[i].y)}`;
      chain.edges.forEach((e, i) => {
        if (e === "surface") return;
        jumps += 1;
        if (chain.edges[i + 1] === "surface") expect(dir(i + 1), "출구 직진").toBe(dir(i));
      });
    }
    expect(jumps).toBeGreaterThan(0);
  });
});
