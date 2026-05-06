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

import { useGameDataStore } from '../../store/gameDataStore';
import type { ComputeContainerCounts, ContainerCounts } from './containerModel';

/**
 * `ceil(per_second / belt 또는 pipe 처리량)`. 최소 1.
 *
 * per_second = `amount × crafting_speed / energy_required`. 모듈/신호기 효과는
 * 1차 구현에서 미반영 — base crafting_speed 만 사용.
 *
 * 알 수 없는 레시피·머신·잘못된 처리량 (≤ 0) 은 빈 결과 반환 (오케스트레이터에서
 * warning 으로 처리할 수 있게).
 */
export const computeContainerCounts: ComputeContainerCounts = (
  recipeName: string,
  machineEntityName: string,
  beltThroughputPerSecond: number,
  pipeThroughputPerSecond: number,
): ContainerCounts => {
  const empty: ContainerCounts = { inputContainers: {}, outputContainers: {} };
  if (beltThroughputPerSecond <= 0 || pipeThroughputPerSecond <= 0) return empty;

  const state = useGameDataStore.getState();
  const recipe = state.recipeMap.get(recipeName);
  const machine = state.entityMap.get(machineEntityName);
  if (!recipe || !machine) return empty;

  const craftingSpeed = machine.crafting_speed ?? 1;
  const energy = recipe.energy_required;
  if (!Number.isFinite(craftingSpeed) || craftingSpeed <= 0) return empty;
  if (!Number.isFinite(energy) || energy <= 0) return empty;

  const out: ContainerCounts = { inputContainers: {}, outputContainers: {} };
  const ratePerSecond = (amount: number) => (amount * craftingSpeed) / energy;
  const containersFor = (amount: number, type: 'item' | 'fluid'): number => {
    const perSec = ratePerSecond(amount);
    const throughput = type === 'fluid' ? pipeThroughputPerSecond : beltThroughputPerSecond;
    return Math.max(1, Math.ceil(perSec / throughput));
  };

  for (const ing of recipe.ingredients) {
    out.inputContainers[ing.name] = containersFor(ing.amount, ing.type);
  }
  for (const prod of recipe.products) {
    // probability 는 average yield 로 환산. 없으면 1 (확정).
    const expected = prod.amount * (prod.probability ?? 1);
    if (expected <= 0) continue;
    out.outputContainers[prod.name] = containersFor(expected, prod.type);
  }
  return out;
};
