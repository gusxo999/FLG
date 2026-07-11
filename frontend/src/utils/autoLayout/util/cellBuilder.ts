/**
 * cellBuilder — 칸 하나에 놓을 물건을 만드는 함수 모음.
 *
 * 좌표와 방향이 **이미 정해진 뒤** 불린다. 어디에 놓을지 고르지 않고, 길도 찾지 않는다.
 * "이 칸에 이 방향으로 벨트" 라고 하면 벨트 한 칸을 만들어 돌려줄 뿐이다.
 *
 * 새 함수를 여기 넣기 전 확인: 이 함수가 자리를 *고르는가*, 아니면 이미 고른 자리를
 * *채우는가*? 고른다면 여기가 아니다.
 */

import { EntityType, createEmptyCell } from "../../../types/layout";
import type { Direction, GridCell } from "../../../types/layout";
import type { InfinitySettings, InfinityPipeSettings } from "../../../types/blueprint";
import type { Container, PlacedCell, PortPair } from "../containerModel";
import { vectorToDirection } from "./helper";

/**
 * 인서터 1셀 emit. `pickupVec` = 인서터의 *픽업 방향* 단위벡터 (= 손 뻗는 쪽).
 * Factorio 규약: `LuaEntity.direction` = 픽업 방향. prototype 의
 * `inserter_pickup_position` 을 그대로 direction 만큼 회전한 위치가 픽업 셀.
 *
 * 예: direction=0 (N) → 북쪽에서 집고 남쪽에 놓는다.
 *     direction=4 (E) → 동쪽에서 집고 서쪽에 놓는다.
 */
export function makeInserterCell(
  cell: { x: number; y: number },
  pickupVec: { x: number; y: number },
  inserterEntityName: string,
  pair: PortPair,
): PlacedCell {
  const grid: GridCell = {
    ...createEmptyCell(),
    entityId: `r-ins-${pair.producer.containerId}-${pair.consumer.containerId}-${cell.x},${cell.y}`,
    entityName: inserterEntityName,
    entityType: EntityType.Inserter,
    direction: vectorToDirection(pickupVec.x, pickupVec.y),
    tileOffset: { x: 0, y: 0 },
    isOrigin: true,
  };
  return { x: cell.x, y: cell.y, cell: grid };
}

export function makeBeltCell(
  cell: { x: number; y: number },
  direction: Direction,
  beltEntityName: string,
  pair: PortPair,
): PlacedCell {
  const grid: GridCell = {
    ...createEmptyCell(),
    entityId: `r-belt-${pair.producer.containerId}-${pair.consumer.containerId}-${cell.x},${cell.y}`,
    entityName: beltEntityName,
    entityType: EntityType.Belt,
    direction,
    tileOffset: { x: 0, y: 0 },
    isOrigin: true,
  };
  return { x: cell.x, y: cell.y, cell: grid };
}

/**
 * 컨테이너 셀 1개 생성. `at` 좌표에 박아넣음.
 */
export function makeContainerCell(
  c: Container,
  at: { x: number; y: number },
): PlacedCell {
  const cell: GridCell = {
    ...createEmptyCell(),
    entityId: c.id,
    entityName: c.entityName,
    entityType:
      c.kind === "infinity-chest"
        ? EntityType.InfinityChest
        : EntityType.InfinityPipe,
    direction: 0 satisfies Direction,
    tileOffset: { x: 0, y: 0 },
    isOrigin: true,
    ...(c.content && c.kind !== "machine"
      ? {
          infinitySettings:
            c.kind === "infinity-chest"
              ? buildInfinitySettings(c.content, c.role)
              : buildPipeInfinitySettings(c.content, c.role),
        }
      : {}),
  };
  return { x: at.x, y: at.y, cell };
}

/** 무한상자 1개가 유지할 공급 아이템 수량 (입력 상자 `at-least` 필터 기본값). */
const DEFAULT_SUPPLY_COUNT = 100;

/**
 * 무한상자의 `content` + 역할로부터 블루프린트 `infinity_settings` 를 합성한다.
 *  - 입력(공급) 상자: `at-least` 로 항상 채워 머신이 끌어가게 함.
 *  - 출력(회수) 상자: `at-most 0` + remove_unfiltered_items 로 무한 sink.
 *  - 역할 미상: 공급으로 간주.
 */
function buildInfinitySettings(
  item: string,
  role: "input" | "output" | undefined,
): InfinitySettings {
  if (role === "output") {
    return {
      remove_unfiltered_items: true,
      filters: [{ name: item, count: 0, mode: "at-most", index: 1 }],
    };
  }
  return {
    remove_unfiltered_items: false,
    filters: [{ name: item, count: DEFAULT_SUPPLY_COUNT, mode: "at-least", index: 1 }],
  };
}

/**
 * 무한파이프의 `content`(유체) + 역할로부터 블루프린트 `infinity_settings` 를 합성한다.
 * 무한상자와 대칭 의미를 갖되, 파이프 전용 모양(단일 유체 + percentage)을 쓴다.
 *  - 입력(공급) 파이프: `at-least` + 가득(100%) — 머신이 항상 끌어가게 함.
 *  - 출력(회수) 파이프: `at-most` + 빈(0%) — 무한 sink.
 *  - 역할 미상: 공급으로 간주.
 */
function buildPipeInfinitySettings(
  fluid: string,
  role: "input" | "output" | undefined,
): InfinityPipeSettings {
  if (role === "output") {
    return { name: fluid, percentage: 0, mode: "at-most" };
  }
  return { name: fluid, percentage: 1, mode: "at-least" };
}
