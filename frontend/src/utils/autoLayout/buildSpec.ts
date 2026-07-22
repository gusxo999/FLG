/**
 * BuildSpec — **우리에게 주어진 것.** "무엇으로 지을 수 있고, 그것이 얼마나 멀리·얼마나
 * 빨리 할 수 있는가."
 *
 * 단일 출처: docs/용어사전.md §H `BuildSpec`.
 *
 * 두 출처가 합쳐진 한 덩어리다:
 *  - 사용자가 위저드에서 **고른 엔티티들**의 이름(벨트·인서터·파이프·지하벨트·지하파이프).
 *  - 그 엔티티들의 **게임데이터 능력치**(인서터의 reach 와 초당 처리량, 지하 변형의 최대
 *    점프 거리).
 *
 * ## 이게 무엇이 *아닌지* — 이름이 비슷한 것들과 헷갈리기 쉽다
 *  - **`debugFlags` 가 아니다.** 저건 우리가 켜고 끄는 손잡이다. BuildSpec 은 **주어진 것**이라
 *    우리가 못 바꾼다. 배치 중에 안 변한다(읽기 전용).
 *  - **OS 환경 변수가 아니다.** `process.env` 와는 아무 관계가 없다.
 *  - **라우팅 옵션이 아니다.** 탐색과 무관하다 — 다익스트라든 예약(장부)이든 똑같이 이걸 본다.
 *    (옛 경로의 `RouteOptions` 는 BuildSpec 을 **확장**해 탐색 전용 필드를 얹은 것이다.)
 *
 * ## 왜 중요한가
 * 배치가 무언가를 **거절할 때 그 근거가 대개 여기서 나온다** — "지하 점프 거리가 0이다",
 * "reach 1 인서터밖에 없다", "인서터 하나로 이 수요를 못 받는다". 프로토타입 이름과 능력치를
 * 코드 곳곳에 하드코딩하지 않고 **여기 한 곳**에서만 읽는다.
 */

import { useGameDataStore, type Entity } from "../../store/gameDataStore";
import type { ContainerWizardInput } from "./containerModel";
import { inserterReach, inserterThroughput } from "./inserterThroughput";
import { beltThroughput } from "./beltThroughput";

/** 사용자가 고른 인서터 하나 — 이름 + 게임데이터에서 뽑은 능력치. */
export interface SpecInserter {
  entityName: string;
  /**
   * 집기 거리(`inserter_pickup_position` 에서 산출). 일반=1, 긴팔=2.
   *
   * **[ClusterBeltDepth](../../../../docs/용어사전.md) 를 이게 정한다** — reach `r` 인 인서터는
   * 좌석(depth 1)에 앉아 depth `1 + r` 의 벨트를 집는다. 그래서 한 면에 세울 수 있는
   * [ClusterBelt] 의 수는 **고른 인서터들의 서로 다른 reach 값의 개수**다. 하드코딩이 아니다.
   */
  reach: number;
  /** 초당 처리량(items/sec). 사용자 override 반영. */
  throughput: number;
}

/** 사용자가 고른 벨트 하나 — 이름 + 게임데이터에서 뽑은 초당 운반량. */
export interface SpecBelt {
  entityName: string;
  /** 초당 운반량(items/sec). 사용자 override 반영. */
  throughput: number;
}

export interface BuildSpec {
  /** 주 벨트(첫 선택 또는 지정). 벨트를 하나만 묻는 옛 소비처용. */
  beltEntityName: string;
  /**
   * 고른 벨트 **전부** — throughput 내림차순, 같은 처리량은 하나만.
   * [determineBeltCount](./beltThroughput.ts) 가 수요를 이 티어들로 나눠 덮는다:
   * 빠른 것부터 채우고 **나머지는 그 나머지를 감당하는 가장 싼(느린) 벨트**로.
   */
  belts: SpecBelt[];
  /**
   * 기본 인서터 = **reach 1 중 가장 빠른 것**(2026-07-23 사장님 규칙 1).
   *
   * 좌석은 거의 전부 d1 에 앉아 d2 를 집으므로 후보가 reach 1 뿐이고, 그중 느린 걸 놓을
   * 이유가 없다. 예전엔 `primaryInserter ?? selectedInserters[0]` 이었는데 `primaryInserter`
   * 를 **채우는 코드가 아무 데도 없어서**(타입 선언만 존재) 실제로는 "사용자가 고른 순서상
   * 첫 번째"가 놓이고 있었다 — 의도가 아니라 우연이다.
   *
   * **이 값과 [inserters] 의 reach-1 항목은 반드시 같은 엔티티여야 한다.** 세는 쪽은
   * `inserters` 의 처리량을 읽고 놓는 쪽은 이 이름을 쓰므로, 둘이 어긋나면 세는 값과 놓는
   * 팔이 달라진다. 빠르게 세면 팔이 모자라 **조용히 굶는다**(2026-07-23 분석).
   */
  inserterEntityName: string;
  /**
   * 고른 인서터 **전부** — reach 오름차순, 같은 reach 는 처리량 높은 것 하나만 남긴다.
   * 같은 reach 두 종류는 **같은 자리를 두고 다투므로** 벨트를 한 줄 더 세워주지 못한다.
   */
  inserters: SpecInserter[];
  /**
   * 긴팔(reach≥2) 인서터 — 고른 것 중 첫 하나. 없으면 undefined.
   * `inserters` 의 부분집합이지만, 옛 경로와 케이스 B 가 "긴팔 하나"만 물어서 남겨 둔다.
   */
  longInserter?: { entityName: string; reach: number };
  pipeEntityName: string;
  undergroundPipeEntityName?: string;
  undergroundBeltEntityName?: string;
  /** 지하파이프 입출구 좌표 차이 한계. undefined / 0 이면 **점프 비활성**. */
  pipeMaxUndergroundDistance?: number;
  /** 지하벨트 입출구 좌표 차이 한계. undefined / 0 이면 **점프 비활성**. */
  beltMaxUndergroundDistance?: number;
  /** 기본 인서터의 사용자 처리량/묶음 보정. */
  inserterOverride?: { throughput?: number; stackSize?: number };
}

/**
 * 위저드 입력 + 게임데이터 → BuildSpec.
 *
 * 점프 비활성(= maxDistance 0) 조건: 지하 변형을 하나도 안 골랐거나, 고른 엔티티가
 * 프로토타입 사전에 없거나, `max_underground_distance` 가 0/미정.
 */
/**
 * **[tapCapacity](../../../docs/용어사전.md) — 팔 하나가 초당 몇 개를 옮기나.**
 * [SupplyCapacity.tapCapacity](./module/clusterPortPlanner.ts) 에 담기는 그 값이고,
 * 이 함수가 **유일한 출처**다.
 *
 * 값은 **reach 1 중 가장 빠른 것**이다. 좌석은 거의 전부 d1 에 앉아 d2 를 집으므로 후보가
 * reach 1 뿐이고([inserterReach] 의 reach 는 최대치가 아니라 고정 거리라 긴팔은 d2 를 아예
 * 못 집는다), [BuildSpec.inserterEntityName] 이 놓는 것도 같은 엔티티다.
 *
 * **여러 곳이 이 수를 각자 유도하면 반드시 어긋난다.** 실제로 그랬다 — 규칙을 한 곳에서만
 * 바꾸자 "머신 몇 대" 담당은 1.2 를, "팔 몇 개" 담당은 10 을 믿었다(2026-07-23). 어긋나는
 * 방향에 따라 증상이 갈리는데, **빠르게 세는 쪽이 더 위험하다**: 팔이 모자란 채로 배치가
 * "성공"이라 보고되고 게임에 넣어야 안다.
 *
 * 데이터가 없으면 `undefined` — 지어내지 않는다.
 */
export function tapCapacity(inserters: ReadonlyArray<SpecInserter>): number | undefined {
  // reach 1 중 **최댓값**을 직접 고른다. [makeBuildSpec] 이 이미 reach 별로 가장 빠른 것만
  // 남기지만, 그 전제에 기대면 다른 호출자가 거르지 않은 목록을 줬을 때 조용히 느린 답을
  // 낸다(= 팔이 과다해지는 쪽). 전제를 안 믿는 편이 싸다.
  const tp = inserters.reduce((m, i) => (i.reach === 1 && i.throughput > m ? i.throughput : m), 0);
  return tp > 0 ? tp : undefined;
}

export function makeBuildSpec(input: ContainerWizardInput): BuildSpec {
  const { entityMap } = useGameDataStore.getState();
  const beltEntityName = input.primaryBelt ?? input.selectedBelts[0] ?? "transport-belt";
  // 고른 인서터 전부 → reach 별로 **가장 빠른 것 하나씩**. reach 가 같으면 두 인서터가
  // 같은 depth 의 벨트를 집으므로 벨트를 한 줄 더 세워주지 못한다 — 더 빠른 쪽만 쓴다.
  const byReach = new Map<number, SpecInserter>();
  for (const entityName of input.selectedInserters) {
    const entity = entityMap.get(entityName);
    const reach = inserterReach(entity);
    if (reach < 1) continue;
    const throughput = inserterThroughput(entity, input.inserterOverrides?.[entityName]);
    const cur = byReach.get(reach);
    if (!cur || throughput > cur.throughput) byReach.set(reach, { entityName, reach, throughput });
  }
  const inserters = [...byReach.values()].sort((a, b) => a.reach - b.reach);
  const long = inserters.find((i) => i.reach >= 2);
  // **놓는 팔과 세는 팔은 같은 곳에서 나온다** — 이름을 [tapCapacity] 가 낸 **그 수를 가진**
  // 항목에서 뽑아, 둘이 구조적으로 어긋날 수 없게 한다. 따로 고르면 어긋나고, 어긋나는
  // 방향에 따라 팔이 넘치거나(폴백) 모자란다(**조용히 굶음**).
  // reach 1 을 하나도 안 골랐으면 옛 폴백(첫 선택)으로 — 좌석 모델이 reach 1 을 전제한다.
  const cap = tapCapacity(inserters);
  const inserterEntityName =
    inserters.find((i) => i.reach === 1 && i.throughput === cap)?.entityName ??
    input.selectedInserters[0] ??
    "inserter";

  // 고른 벨트 전부 → 처리량 내림차순. 같은 처리량이 둘이면 하나만(자리를 두고 다툴 뿐
  // 더 나르지 못한다 — 인서터를 reach 별로 하나만 남기는 것과 같은 이유).
  const byThroughput = new Map<number, SpecBelt>();
  for (const entityName of input.selectedBelts) {
    const throughput = beltThroughput(entityMap.get(entityName));
    if (throughput <= 0) continue; // 데이터 없음 — 지어내지 않는다.
    if (!byThroughput.has(throughput)) byThroughput.set(throughput, { entityName, throughput });
  }
  const belts = [...byThroughput.values()].sort((a, b) => b.throughput - a.throughput);

  const undergroundPipeEntityName = input.selectedUndergroundPipes[0];
  const undergroundBeltEntityName = input.selectedUndergroundBelts[0];

  return {
    beltEntityName,
    belts,
    inserterEntityName,
    inserters,
    longInserter: long ? { entityName: long.entityName, reach: long.reach } : undefined,
    pipeEntityName: "pipe",
    undergroundPipeEntityName,
    undergroundBeltEntityName,
    pipeMaxUndergroundDistance: undergroundPipeEntityName
      ? pipeUndergroundDistance(entityMap.get(undergroundPipeEntityName))
      : 0,
    beltMaxUndergroundDistance: undergroundBeltEntityName
      ? (entityMap.get(undergroundBeltEntityName)?.max_underground_distance ?? 0)
      : 0,
    inserterOverride: input.inserterOverrides?.[inserterEntityName],
  };
}

/**
 * pipe-to-ground 의 지하 거리. Factorio 2.0 은 connection 별로 거리를 두지만
 * (`fluid_boxes[].connections[].max_underground_distance`), 최상위
 * `Entity.max_underground_distance` 도 호환용으로 채워진다. connection 우선.
 */
function pipeUndergroundDistance(entity: Entity | undefined): number {
  if (!entity) return 0;
  for (const fb of entity.fluid_boxes ?? []) {
    for (const c of fb.connections ?? []) {
      if (c.connection_type === "underground" && c.max_underground_distance) {
        return c.max_underground_distance;
      }
    }
  }
  return entity.max_underground_distance ?? 0;
}
