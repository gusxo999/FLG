import type { Entity } from '../store/gameDataStore';

/**
 * 투입기 처리량 모델 — items/sec.
 *
 *   throughput = K × rotation_speed × stack_size,  **K = 60**
 *
 * ## K 가 60인 이유 — 임의의 보정값이 아니라 틱 수다
 *
 * `inserter_rotation_speed` 는 **틱당 회전수**(turns/tick)다. 인서터 한 번 스윙 = 180°
 * = **0.5턴** → `0.5 / rotation_speed` 틱. 한 번 나르려면 **왕복**(집으러 갔다 놓으러
 * 온다) = 2스윙 = `1 / rotation_speed` 틱. 게임은 **초당 60틱**이므로:
 *
 *   초당 왕복 횟수 = 60 × rotation_speed  →  items/s = 60 × rotation_speed × stack
 *
 * 바닐라 검산(왼쪽=이 식, 오른쪽=게임 실측값):
 *   inserter             0.014 → 0.84   (실제 ≈ 0.83)
 *   long-handed-inserter 0.02  → 1.2    (실제 ≈ 1.2)
 *   fast-inserter        0.04  → 2.4    (실제 ≈ 2.31)
 *   bulk-inserter        0.04  → 2.4 × stack 12 = 28.8  (실제 ≈ 27.7)
 *
 * 조금씩 높게 나오는 건 팔을 뻗고 접는 시간(`extension_speed`)을 안 세기 때문이다.
 * 그건 **의도적으로 안 센다** — 픽업/드랍 좌표에 따라 달라져 프로토타입만으론 못 정한다.
 * 정확값이 필요하면 사용자가 override 한다.
 *
 * > **2026-07-16 정정.** 예전 K 는 `8/(0.04×12) ≈ 16.67` 이었다 — "bulk-inserter 가 12스택으로
 * > 초당 8개" 라는 앵커 하나에서 나온 값인데, **그 앵커가 틀렸다**(실제 ≈ 27.7). 그래서 모든
 * > 인서터가 3~3.5배 느리게 나왔고, [requiredInserterCount](planner/module/clusterPortPlanner.ts) 가
 * > 팔을 몇 배로 요구해 **어떤 머신으로도 kr-glass 를 못 짓는** 상태였다(실측: 가장 느린
 * > stone-furnace 조차 팔 3개 > 면 2행). 지금 K 는 앵커가 아니라 **틱 정의에서 유도**되므로,
 * > 모드 인서터가 어떤 rotation_speed 를 갖든 같은 식으로 답한다.
 *
 * 사용자 입력 우선순위 (높을수록 우선):
 *   1) overrideThroughput  — 사용자가 items/s 값을 직접 입력. stackSize 는 무시.
 *   2) overrideStackSize   — 사용자가 stack 갯수만 조정. 처리량은 위 식으로 자동 계산.
 *   3) entity.inserter_rotation_speed × stackSize=1 — 기본 추정.
 *
 * UI 측에서 두 입력 필드 중 하나만 활성화되도록 강제 (둘 다 채우면 throughput 우선).
 */

/** 초당 틱 수. 왕복 1회 = `1/rotation_speed` 틱이므로 초당 왕복 = 60 × rotation_speed. */
const K = 60;
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
 * 인서터 prototype 의 집기 거리(reach, 셀 수). `inserter_pickup_position` 의 최대
 * 절대성분을 반올림(일반 ≈ 1, 긴팔 ≈ 2). 데이터 없으면 1. 이름 무관·데이터 기반 —
 * 형태 탭 용량 산정(layeredWizard)과 라우팅 거리 파라미터(routeFallback) 공용.
 */
export function inserterReach(entity: Entity | undefined): number {
  const p = entity?.inserter_pickup_position;
  if (!p) return 1;
  return Math.max(1, Math.round(Math.max(Math.abs(p.x), Math.abs(p.y))));
}

