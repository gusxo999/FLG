/**
 * 모듈 3b — 슬롯 수 계산.
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §5 / §12 / Q12 / Q19.
 *
 * 한 머신의 입력 ingredient 별 / 출력 product 별 *필요 컨테이너 수* 를
 * `ceil(throughput / 운반체-처리량)` 로 산정한다.
 *
 * 원칙: 라우팅 1개 = 컨테이너 1개. 한 라우팅이 처리량을 못 채우면
 * 컨테이너 수를 늘려 별도 라우팅으로 분할 (placement-search §4 / Q19 a).
 *
 * 새 모델은 구 둘레 슬롯 모델의 `inputSlots = ceil(재료/2)` (lane=2 가정) 을
 * **폐기** 하고, 입력도 출력과 동일한 throughput-기반 식을 쓴다.
 */

import type { ComputeContainerCounts, ContainerCounts } from './containerModel';

/**
 * `ceil(throughput / belt 또는 pipe 처리량)`.
 * fluid 인지 item 인지는 게임데이터의 ingredient/product 메타에서 판정.
 */
export const computeContainerCounts: ComputeContainerCounts = (
  _recipeName: string,
  _beltThroughputPerSecond: number,
  _pipeThroughputPerSecond: number,
): ContainerCounts => {
  // TODO(placement-search §5 모듈 3b):
  //  1. recipeName 으로 gameDataStore 에서 Recipe 를 조회.
  //  2. recipe.ingredients 각각에 대해:
  //      - item ingredient: count = ceil(amount × crafting_speed / energy / belt-throughput)
  //      - fluid ingredient: count = ceil(amount × crafting_speed / energy / pipe-throughput)
  //  3. recipe.products 도 동일하게 계산.
  //  4. 결과를 inputContainers / outputContainers 에 ingredient/product 이름 키로 채워 반환.
  //
  //  주의: throughput 식의 정확한 단위 (per craft / per second 변환) 는 인서터
  //  처리량 모델 (inserterThroughput.ts) 과 정합되어야 한다.
  throw new Error('containerCounts.computeContainerCounts: not implemented');
};
