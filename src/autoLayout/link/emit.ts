/**
 * **연결 관심사의 찍기** — 납품 체인 → 벨트 · 파이프 셀. 고르지 않는다 — 좌석 이음은 도형(`link/shape`)이 칸 목록을
 * 늘리고, 여기는 늘어난 목록을 셀로 바꿀 뿐이다(방향 인코딩 · 지하 입출구는 `execution/emitPath` 가 안다).
 *
 * 벨트판([finishChain])과 유체판([finishFluidChain])이 **같은 체인**을 받는다 — 계획 체인은 품목-무관하다.
 *
 * > **내력.** `link/build.ts` 에서 왔다(2026-09-15 계획 구조-2축 · 2 Step 5c).
 */

import type { ContainerPort, PortFace, PortPair } from "../shared/types";
import type { DijkstraResult } from "../shared/route";
import { emitItemPath, emitFluidPath } from "../shared/cells/path";
import { faceVector } from "../shared/grid";
import type { DeliverySpec } from "../tree/types/pack";
import { chainWithSeats, isContinuous } from "./shape";
import type { DeliveryConfig, DeliveryRoute } from "./types";

/** makeBeltCell 의 entityId 생성용 최소 PortPair. */
function synthPair(producerId: string, consumerId: string): PortPair {
  const port = (containerId: string): ContainerPort => ({
    containerId,
    cell: { x: 0, y: 0 },
    face: "N" as PortFace,
    kind: "item",
  });
  return { producer: port(producerId), consumer: port(consumerId) };
}

/**
 * 체인(chest_from..chest_to) 공통 마무리 — seat 이음, 연속성 불변식, emit.
 * dijkstra 결과와 기하 예약의 결정적 체인이 같은 꼬리를 탄다(단일 출처).
 */
export function finishChain(delivery: DeliverySpec, result: DijkstraResult, config: DeliveryConfig): Omit<DeliveryRoute, "key"> {
  const fvTo = faceVector(delivery.to.face);

  const ext = chainWithSeats(delivery, result);

  if (!isContinuous(ext)) {
    return { item: delivery.item, ok: false, cells: [], corridors: [], reason: "discontinuous-chain" };
  }

  const pair = synthPair(delivery.from.chest.id, delivery.to.chest.id);
  // 마지막 셀의 방향 = 모듈 안쪽 = −fv_to. emitItemPath 는 `-consumerOut` 방향으로
  // emit 하므로 consumerOut = +fv_to 를 넘긴다. 끝이 seat_to 든(피더를 뗀 경우) chest_to
  // 든(1:1, 인서터 잔류) 다음 칸은 −fv_to 쪽이라 **같은 값**이다.
  const emitted = emitItemPath(
    ext,
    pair,
    {
      beltEntityName: config.beltEntityName,
      undergroundBeltEntityName: config.undergroundBeltEntityName,
    },
    { x: fvTo.x, y: fvTo.y },
  );
  return { item: delivery.item, ok: true, cells: emitted.placed, corridors: emitted.corridors };
}

/**
 * 유체판 [finishChain] — 계획 체인을 **파이프**로 방출한다.
 *
 * 벨트판보다 짧은 이유가 유체의 성질 그대로다:
 *  - **좌석 이음이 없다** — 파이프 포트엔 인서터가 없다. 좌석 자리의 파이프는 떼지 않고
 *    그대로 이음에 쓰므로([stripKeys] 가 chest 한 칸만 뗀다) 체인을 늘릴 필요가 없다.
 *  - **방향이 없다** — 흐름 방향을 넘길 인자가 없다. 인접이 곧 연결이다.
 *
 * 체인 자체는 [buildPlannedChain] 이 낸 것 그대로다 — 그 함수는 품목-무관이라 벨트·파이프가
 * 같은 계획을 공유한다. 갈리는 곳은 여기 방출 한 곳뿐이다.
 */
export function finishFluidChain(delivery: DeliverySpec, chain: DijkstraResult, config: DeliveryConfig): Omit<DeliveryRoute, "key"> {
  if (!isContinuous(chain)) {
    return { item: delivery.item, ok: false, cells: [], corridors: [], reason: "discontinuous-chain" };
  }
  const emitted = emitFluidPath(chain, synthPair(delivery.fromId, delivery.toId), {
    pipeEntityName: config.pipeEntityName!,
    undergroundPipeEntityName: config.undergroundPipeEntityName,
  });
  return { item: delivery.item, ok: true, cells: emitted.placed, corridors: emitted.corridors };
}
