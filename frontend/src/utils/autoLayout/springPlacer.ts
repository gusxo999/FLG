/**
 * Spring Relaxation 배치 — 동일 레시피 N대 기계의 위치를 물리 시뮬레이션으로 결정.
 *
 * 설계 개요:
 *   1. 초기화: N대를 수평 라인으로 배치 (간격 = machine.w + ROUTING_GAP).
 *   2. Spring 루프:
 *      a. 라우팅 압력 — 각 기계의 공급/출력 구역(위/아래 ROUTING_GAP 셀)을
 *         다른 기계가 침범하면 반발력 부여.
 *      b. 기계 간 반발력 — footprint 가 겹치거나 너무 가까우면 서로 밀어냄.
 *      c. 응집력 — 그룹 centroid 방향으로 당김.
 *      d. 감쇠 적용 + 1타일 단위 이동 + 그리드 snap.
 *      e. 하드 겹침 해소.
 *      f. 수렴 체크.
 *   3. 결과 반환 (수렴 여부 포함).
 *
 * 기계 1대 → Spring 루프 없이 즉시 반환. 하위 호환 유지.
 */

import type { Area, Container } from './containerModel';
import { buildOccupancy } from './containerRouting';
import type { ClusterForce, SpringConfig, SpringResult } from './clusterModel';

/** machinePlacer.ts 와 동일한 라우팅 gap 상수. */
const ROUTING_GAP = 3;

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

/**
 * N대 기계의 위치를 Spring Relaxation 으로 결정한다.
 *
 * @param templates  크기(size)는 설정되어 있고 origin 은 미설정인 기계 템플릿 배열.
 *                   본 함수가 origin 을 채워 새 Container 배열로 반환한다.
 * @param blockingArea  클러스터 외부 이미 점유된 영역 (기계 이동 시 이 셀을 피함).
 * @param config     Spring 파라미터.
 */
export function runSpringRelaxation(
  templates: Container[],
  blockingArea: Area,
  config: SpringConfig,
): SpringResult {
  if (templates.length === 0) {
    return { machines: [], converged: true, iterations: 0 };
  }

  // 기계 1대: Spring 불필요, (0,0) 에 배치.
  if (templates.length === 1) {
    return {
      machines: [{ ...templates[0], origin: { x: 0, y: 0 } }],
      converged: true,
      iterations: 0,
    };
  }

  // 초기화: 수평 라인.
  let current = initHorizontalLine(templates);
  const existingBlocked = buildOccupancy(blockingArea);

  for (let iter = 0; iter < config.maxIterations; iter++) {
    const forces: ClusterForce[] = current.map(() => ({ dx: 0, dy: 0 }));

    applyRepulsion(current, forces);
    applyRoutingPressure(current, forces, existingBlocked);
    applyCohesion(current, forces, config.cohesionStrength);

    // 감쇠: 이터레이션이 쌓일수록 힘이 약해짐.
    const dampFactor = Math.pow(config.damping, iter);

    let totalMovement = 0;
    current = current.map((m, i) => {
      const rawDx = forces[i].dx * dampFactor;
      const rawDy = forces[i].dy * dampFactor;
      // 1타일 단위 step, 최대 ±1.
      const stepX = clampStep(rawDx);
      const stepY = clampStep(rawDy);
      totalMovement += Math.abs(stepX) + Math.abs(stepY);
      return { ...m, origin: { x: m.origin.x + stepX, y: m.origin.y + stepY } };
    });

    resolveOverlaps(current);

    const allClear = !hasRoutingZoneConflict(current, existingBlocked);
    if (totalMovement <= config.convergenceThreshold && allClear) {
      return { machines: current, converged: true, iterations: iter + 1 };
    }

    // 이동 없이 충돌이 계속되면 더 반복해봐야 변하지 않음 → 중단.
    if (totalMovement === 0) break;
  }

  return { machines: current, converged: false, iterations: config.maxIterations };
}

// ─────────────────────────────────────────────────────────────────────────────
// 초기화
// ─────────────────────────────────────────────────────────────────────────────

/** N대를 수평으로 나열. 간격 = machine.size.w + ROUTING_GAP. */
function initHorizontalLine(templates: Container[]): Container[] {
  let x = 0;
  return templates.map((t) => {
    const m: Container = { ...t, origin: { x, y: 0 } };
    x += t.size.w + ROUTING_GAP;
    return m;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 힘 계산
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 기계 간 반발력.
 *
 * 두 기계의 footprint 가 ROUTING_GAP/2 이내로 가까우면 서로 밀어낸다.
 * 힘의 방향 = center_i → center_j 의 반대 방향.
 */
function applyRepulsion(machines: Container[], forces: ClusterForce[]): void {
  const minGap = Math.ceil(ROUTING_GAP / 2);
  for (let i = 0; i < machines.length; i++) {
    for (let j = i + 1; j < machines.length; j++) {
      if (!footprintsWithinGap(machines[i], machines[j], minGap)) continue;

      const ci = centerOf(machines[i]);
      const cj = centerOf(machines[j]);
      let dx = ci.x - cj.x;
      let dy = ci.y - cj.y;
      if (dx === 0 && dy === 0) { dx = 1; } // 완전 겹침 → 오른쪽으로
      const len = Math.sqrt(dx * dx + dy * dy);
      forces[i].dx += dx / len;
      forces[i].dy += dy / len;
      forces[j].dx -= dx / len;
      forces[j].dy -= dy / len;
    }
  }
}

/**
 * 라우팅 구역 압력.
 *
 * 각 기계의 공급 구역(위 ROUTING_GAP 셀)과 출력 구역(아래 ROUTING_GAP 셀)을
 * 다른 기계가 침범하면 침범한 기계를 밀어낸다.
 *
 * - 공급 구역 침범 → 침범 기계를 아래로 (공급 방향에서 멀어지게).
 * - 출력 구역 침범 → 침범 기계를 위로 (출력 방향에서 멀어지게).
 */
function applyRoutingPressure(
  machines: Container[],
  forces: ClusterForce[],
  existingBlocked: ReadonlySet<string>,
): void {
  for (let i = 0; i < machines.length; i++) {
    const m = machines[i];
    const cx = m.origin.x + Math.floor(m.size.w / 2);

    // 공급 구역: 기계 위쪽 ROUTING_GAP 행.
    for (let step = 1; step <= ROUTING_GAP; step++) {
      const cell = { x: cx, y: m.origin.y - step };
      if (existingBlocked.has(cellKey(cell.x, cell.y))) continue;
      for (let j = 0; j < machines.length; j++) {
        if (j === i) continue;
        if (machineOccupiesCell(machines[j], cell)) {
          forces[j].dy += 1;   // j 를 아래로 밀기
          forces[i].dy -= 0.3; // i 도 약간 위로
        }
      }
    }

    // 출력 구역: 기계 아래쪽 ROUTING_GAP 행.
    for (let step = 1; step <= ROUTING_GAP; step++) {
      const cell = { x: cx, y: m.origin.y + m.size.h + step - 1 };
      if (existingBlocked.has(cellKey(cell.x, cell.y))) continue;
      for (let j = 0; j < machines.length; j++) {
        if (j === i) continue;
        if (machineOccupiesCell(machines[j], cell)) {
          forces[j].dy -= 1;   // j 를 위로 밀기
          forces[i].dy += 0.3; // i 도 약간 아래로
        }
      }
    }
  }
}

/**
 * 응집력.
 *
 * 각 기계를 그룹 centroid 방향으로 당긴다.
 * magnitude = cohesionStrength × centroid 까지의 거리.
 */
function applyCohesion(
  machines: Container[],
  forces: ClusterForce[],
  strength: number,
): void {
  const centroid = getCentroid(machines);
  for (let i = 0; i < machines.length; i++) {
    const ci = centerOf(machines[i]);
    forces[i].dx += (centroid.x - ci.x) * strength;
    forces[i].dy += (centroid.y - ci.y) * strength;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 겹침 해소 (하드 제약)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 하드 겹침 해소.
 *
 * 두 기계 footprint 가 실제로 겹치면 j 를 i 의 오른쪽으로 밀어낸다 (단순).
 * Spring 힘이 이미 대부분의 충돌을 처리하므로 이 함수는 안전망 역할.
 * 최대 10회 반복으로 연쇄 충돌도 해소.
 */
function resolveOverlaps(machines: Container[]): void {
  for (let pass = 0; pass < 10; pass++) {
    let anyOverlap = false;
    for (let i = 0; i < machines.length; i++) {
      for (let j = i + 1; j < machines.length; j++) {
        if (!footprintsOverlap(machines[i], machines[j])) continue;
        anyOverlap = true;
        machines[j] = {
          ...machines[j],
          origin: {
            x: machines[i].origin.x + machines[i].size.w + ROUTING_GAP,
            y: machines[j].origin.y,
          },
        };
      }
    }
    if (!anyOverlap) break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 수렴 판정
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 라우팅 구역 충돌이 하나라도 남아 있으면 true.
 * 수렴 판정에 사용 — 이동도 없고 충돌도 없으면 수렴.
 */
function hasRoutingZoneConflict(
  machines: Container[],
  existingBlocked: ReadonlySet<string>,
): boolean {
  for (let i = 0; i < machines.length; i++) {
    const m = machines[i];
    const cx = m.origin.x + Math.floor(m.size.w / 2);
    for (let step = 1; step <= ROUTING_GAP; step++) {
      const supplyCell = { x: cx, y: m.origin.y - step };
      if (existingBlocked.has(cellKey(supplyCell.x, supplyCell.y))) continue;
      for (let j = 0; j < machines.length; j++) {
        if (j !== i && machineOccupiesCell(machines[j], supplyCell)) return true;
      }
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function centerOf(m: Container): { x: number; y: number } {
  return { x: m.origin.x + m.size.w / 2, y: m.origin.y + m.size.h / 2 };
}

function getCentroid(machines: Container[]): { x: number; y: number } {
  const sum = machines.reduce(
    (acc, m) => {
      const c = centerOf(m);
      return { x: acc.x + c.x, y: acc.y + c.y };
    },
    { x: 0, y: 0 },
  );
  return { x: sum.x / machines.length, y: sum.y / machines.length };
}

function machineOccupiesCell(m: Container, cell: { x: number; y: number }): boolean {
  return (
    cell.x >= m.origin.x &&
    cell.x < m.origin.x + m.size.w &&
    cell.y >= m.origin.y &&
    cell.y < m.origin.y + m.size.h
  );
}

function footprintsOverlap(a: Container, b: Container): boolean {
  return !(
    a.origin.x + a.size.w <= b.origin.x ||
    b.origin.x + b.size.w <= a.origin.x ||
    a.origin.y + a.size.h <= b.origin.y ||
    b.origin.y + b.size.h <= a.origin.y
  );
}

/** 두 기계 사이의 거리가 gap 미만인지 (수평/수직 방향 기준). */
function footprintsWithinGap(a: Container, b: Container, gap: number): boolean {
  const aRight = a.origin.x + a.size.w;
  const bRight = b.origin.x + b.size.w;
  const aBottom = a.origin.y + a.size.h;
  const bBottom = b.origin.y + b.size.h;

  const hOverlap = !(aRight + gap <= b.origin.x || bRight + gap <= a.origin.x);
  const vOverlap = !(aBottom + gap <= b.origin.y || bBottom + gap <= a.origin.y);
  return hOverlap && vOverlap;
}

/** 실수 힘을 ±1 정수 step 으로 클램프. */
function clampStep(force: number): number {
  if (Math.abs(force) < 0.01) return 0;
  return Math.sign(force) * Math.min(1, Math.ceil(Math.abs(force)));
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}
