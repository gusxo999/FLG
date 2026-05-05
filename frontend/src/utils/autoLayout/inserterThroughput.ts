import type { Entity } from '../../store/gameDataStore';

/**
 * 투입기 처리량 모델 — items/sec.
 *
 * 게임 데이터의 inserter_rotation_speed 만으로 정확한 처리량을 도출하긴 어렵다 (extension_speed
 * 변동, 픽업/드랍 좌표 차이, 큐 효과 등이 있음). 본 모델은 사용자가 알려준 보정 anchor 한 개를
 * 기준으로 단순 비례식만 사용한다 — 정확값이 필요하면 사용자가 직접 override 한다.
 *
 *   throughput = K × rotation_speed × stack_size
 *   K = 8 / (0.04 × 12) ≈ 16.67   (anchor: bulk-inserter, stack 12 → 8 items/s)
 *
 * 사용자 입력 우선순위 (높을수록 우선):
 *   1) overrideThroughput  — 사용자가 items/s 값을 직접 입력. stackSize 는 무시.
 *   2) overrideStackSize   — 사용자가 stack 갯수만 조정. 처리량은 위 식으로 자동 계산.
 *   3) entity.inserter_rotation_speed × stackSize=1 — 기본 추정.
 *
 * UI 측에서 두 입력 필드 중 하나만 활성화되도록 강제 (둘 다 채우면 throughput 우선).
 */

const K = 8 / (0.04 * 12); // ≈ 16.6667
const DEFAULT_STACK = 1;

/**
 * 한 투입기에 대한 사용자 override.
 * - throughput 이 정의되어 있으면 그 값을 그대로 반환 (stackSize 무시).
 * - throughput 이 undefined 이고 stackSize 가 정의되어 있으면 stackSize 로 자동 계산.
 * - 둘 다 undefined 이면 기본 추정.
 */
export interface InserterOverride {
  /** 사용자가 입력한 처리량 (items/sec). 입력 시 stackSize 는 무시. */
  throughput?: number;
  /** 사용자가 입력한 한 번에 집을 수 있는 묶음 갯수. throughput 이 비어 있을 때만 적용. */
  stackSize?: number;
}

export type InserterOverrides = ReadonlyMap<string, InserterOverride>;

/**
 * 한 투입기의 effective items/sec.
 * entity 의 inserter_rotation_speed 가 없으면 0 반환 (= 처리 불가).
 */
export function inserterThroughput(
  entity: Entity | undefined,
  override?: InserterOverride,
): number {
  if (override?.throughput !== undefined && override.throughput > 0) {
    return override.throughput;
  }
  if (!entity || !entity.inserter_rotation_speed) return 0;
  const stack = override?.stackSize ?? DEFAULT_STACK;
  return K * entity.inserter_rotation_speed * Math.max(1, stack);
}

/**
 * 사용자가 보정값을 만진 적 없는 시점의 *기본 추정* — UI 의 placeholder 표시용.
 * stackSize 1 가정.
 */
export function defaultInserterThroughput(entity: Entity | undefined): number {
  if (!entity || !entity.inserter_rotation_speed) return 0;
  return K * entity.inserter_rotation_speed * DEFAULT_STACK;
}

/**
 * 한 출력 슬롯 1줄이 운반할 수 있는 처리량 (items/sec).
 * = min(belt_throughput, inserter_throughput)
 *
 * belt_throughput 은 entity.belt_speed (lanes/tick) → items/sec 환산.
 * (Factorio: belt_speed 단위는 tile/tick. 한 lane 의 items/s = belt_speed × 60 × 8.
 *  두 lane 합 = belt_speed × 60 × 8 × 2. 본 함수는 *한 줄(=한 면 출력 슬롯) 한 belt* 의 두 lane
 *  합을 사용 — 한 슬롯이 머신에서 두 줄을 동시에 받을 수는 없으므로 사실상 한 lane 만 채워짐.
 *  보수적으로 한 lane 처리량을 사용한다.)
 */
export function slotLineThroughput(beltEntity: Entity | undefined, inserterRate: number): number {
  const beltRate = beltLaneThroughput(beltEntity);
  if (beltRate <= 0) return inserterRate;
  if (inserterRate <= 0) return beltRate;
  return Math.min(beltRate, inserterRate);
}

/**
 * 한 lane 의 transport-belt 처리량 (items/sec).
 * yellow ≈ 7.5, red ≈ 15, blue ≈ 22.5.
 */
export function beltLaneThroughput(beltEntity: Entity | undefined): number {
  if (!beltEntity || !beltEntity.belt_speed) return 0;
  return beltEntity.belt_speed * 60 * 8;
}
