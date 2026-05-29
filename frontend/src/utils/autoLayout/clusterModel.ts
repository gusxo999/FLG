/**
 * ClusterGroup — 동일 레시피 N대의 기계 묶음.
 *
 * machineCount > 1 인 레시피 노드를 Spring Relaxation 으로 배치할 때
 * 사용하는 추상. machineCout = 1 이면 ClusterGroup 은 기계 1대를 감싸는
 * 래퍼로 동작 (기존 단일 배치와 동일 결과).
 */

import type { Area, Container, ContainerPort, Routing } from './containerModel';

// ─────────────────────────────────────────────────────────────────────────────
// ClusterGroup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 레시피 노드에 대응하는 N대의 기계 묶음.
 *
 * - `machines`: Spring Relaxation 후 확정된 위치를 가진 Container 배열.
 * - `internalArea`: 클러스터 내부 그리드 (기계 footprint + 라우팅 셀 포함).
 * - `inputPorts`: 부모 클러스터 / 무한상자가 연결할 입력 포트 목록.
 * - `outputPorts`: 자식 클러스터 / 무한상자가 연결할 출력 포트 목록.
 * - `routings`: 클러스터 내부 라우팅 (외부 공급 무한상자 ↔ 기계 연결 등).
 *
 * 클러스터 간 연결은 기존 `containerRouting.ts` Dijkstra 가 그대로 담당.
 */
export interface ClusterGroup {
  recipeName: string;
  machines: Container[];
  internalArea: Area;
  inputPorts: ContainerPort[];
  outputPorts: ContainerPort[];
  routings: Routing[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Spring Relaxation 설정
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 기계에 작용하는 합력 벡터 (실수 — 이동 전 누적용).
 */
export interface ClusterForce {
  dx: number;
  dy: number;
}

/**
 * Spring Relaxation 파라미터.
 *
 * - `maxIterations`: 루프 최대 횟수. 이 안에 수렴하지 않으면 마지막 상태 반환.
 * - `cohesionStrength`: 응집력 계수. 클수록 기계들이 centroid 로 강하게 당겨짐.
 * - `damping`: 감쇠 계수 (0 < damping ≤ 1). 이터레이션이 쌓일수록 힘이 약해짐.
 *   1.0 이면 감쇠 없음, 0.9 이면 10번마다 ~35% 감쇠.
 * - `convergenceThreshold`: 한 이터레이션의 총 이동량(타일 합)이 이 값 이하이고
 *   라우팅 구역 충돌도 없으면 수렴으로 판정.
 */
export interface SpringConfig {
  maxIterations: number;
  cohesionStrength: number;
  damping: number;
  convergenceThreshold: number;
}

export const DEFAULT_SPRING_CONFIG: SpringConfig = {
  maxIterations: 200,
  cohesionStrength: 0.05,
  damping: 0.9,
  convergenceThreshold: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Spring Relaxation 결과
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `runSpringRelaxation` 반환값.
 *
 * - `machines`: 확정된 위치를 가진 Container 배열 (origin 설정 완료).
 * - `converged`: maxIterations 이내에 수렴했는지 여부.
 * - `iterations`: 실제 실행한 이터레이션 수.
 */
export interface SpringResult {
  machines: Container[];
  converged: boolean;
  iterations: number;
}
