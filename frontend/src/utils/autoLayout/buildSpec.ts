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

export interface BuildSpec {
  beltEntityName: string;
  /** 기본 인서터(사용자가 지정한 주 인서터 또는 첫 선택). */
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
export function makeBuildSpec(input: ContainerWizardInput): BuildSpec {
  const { entityMap } = useGameDataStore.getState();
  const beltEntityName = input.primaryBelt ?? input.selectedBelts[0] ?? "transport-belt";
  const inserterEntityName = input.primaryInserter ?? input.selectedInserters[0] ?? "inserter";

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

  const undergroundPipeEntityName = input.selectedUndergroundPipes[0];
  const undergroundBeltEntityName = input.selectedUndergroundBelts[0];

  return {
    beltEntityName,
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
