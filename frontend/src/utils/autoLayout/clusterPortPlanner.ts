/**
 * clusterPortPlanner — 한 기둥 클러스터의 I/O 줄(아이템 belt + 유체 pipe)을 어느
 * 면(W/E)·depth(바깥 칸)·인서터에 배정할지 **결정만** 하는 순수 함수.
 *
 * 단일 출처: docs/auto-layout-wizard.known-limits.md(클러스터 형태 일반화) +
 * 본 설계안(간단 레시피 유체 배치).
 *
 * ## 책임 경계 — "계획"이지 "라우팅"이 아니다
 * 본 모듈은 **배정 결정**만 한다. 실제 셀(belt/pipe/inserter) emit 은 belt
 * trunk(`clusterTrunkMerge`)·pipe spine(후속) emitter 가 담당한다. 경로 추적
 * (`containerRouting`)과 역할이 분리되므로 이름이 `...Planner` 다.
 *
 * ## depth 규약 (머신 면에서 바깥으로 N칸)
 *  - 0칸 = 머신 자신의 가장자리(인서터가 떨구는 목적지).
 *  - 1칸 = 인접 칸. 유체 파이프는 머신 fluid_box 에 닿아야 하므로 **항상 1칸**.
 *  - 아이템 belt: 가까운 레인 = 2칸(일반 인서터 seat 1칸), 먼 레인 = 3칸(긴팔 seat
 *    1칸, 가까운 belt 위로 넘김). 1칸이 파이프면 → 긴팔 seat 2칸·belt 4칸(케이스 B).
 *
 * ## 1단계 범위 (현재)
 * **아이템 belt 만.** 면당 레인 모델(P1 `columnTapCapacity` 와 동치) 재현. 유체(pipe)
 * 줄이 있으면 미구현이므로 `complex` 로 위임한다 — 본 결과는 아직 emit 에 연결되지
 * 않아(레이아웃 회귀 동등) 유체 클러스터는 종전대로 1:1 폴백으로 처리된다.
 */

/** 컬럼의 좌/우 면. */
export type PortSide = "W" | "E";

/** belt 를 모는 인서터 종류. */
export type InserterRole = "normal" | "long";

/** I/O 줄의 운반체 종류 — 아이템=belt(인서터 탭), 유체=pipe(스파인, 인서터 없음). */
export type LineKind = "belt" | "pipe";

/** 배정 대상 — 레시피의 한 I/O 품목. */
export interface IoLine {
  /** 품목 이름(아이템/유체). */
  name: string;
  kind: LineKind;
  role: "input" | "output";
}

/** 한 I/O 줄의 배정 결과. */
export interface PlannedLine {
  line: IoLine;
  side: PortSide;
  /** 머신 면에서 바깥 칸 거리. pipe=1, belt 가까운=2, 먼=3, 파이프 위 넘김=4. */
  depth: number;
  /** belt 를 모는 인서터. pipe 는 인서터가 없어 undefined. */
  inserter?: InserterRole;
}

/** 배정에 쓸 인서터 능력 — `ShapeCaps` 와 동형. */
export interface PortPlannerCaps {
  /** reach 1(거리 1) 일반 인서터 보유. */
  hasNormal: boolean;
  /** reach≥2 긴팔 인서터 보유. */
  hasLong: boolean;
}

export interface PortPlannerInput {
  /** 배정할 I/O 줄들(아이템 + 유체). */
  lines: IoLine[];
  caps: PortPlannerCaps;
  /**
   * perimeter ring(외부 소스/싱크)에 더 가까운 면. 유체 입력·우선 줄을 이 면에
   * 먼저 배정한다(라우팅 거리 최소화). 1단계(아이템만)에서는 채움 순서에만 영향.
   */
  perimeterNearSide: PortSide;
}

/** 배정 성공(줄별 결과) 또는 복잡(배정 불가 → 2D 대상). */
export type PortPlan =
  | { ok: true; lines: PlannedLine[] }
  | { ok: false; complex: true; reason: string };

/**
 * 면당 belt 레인 — 인서터 능력으로 결정. 가까운 레인(2칸, 일반) + 먼 레인(3칸, 긴팔).
 * 긴팔은 거리 1을 못 집어 가까운 레인은 일반 전용, 먼 레인은 긴팔 전용.
 * 합계 슬롯 수(= 2면 × 레인수)는 `columnTapCapacity` 와 정확히 일치한다.
 */
function laneSlots(caps: PortPlannerCaps): { depth: number; inserter: InserterRole }[] {
  const lanes: { depth: number; inserter: InserterRole }[] = [];
  if (caps.hasNormal) lanes.push({ depth: 2, inserter: "normal" });
  if (caps.hasLong) lanes.push({ depth: 3, inserter: "long" });
  return lanes;
}

/**
 * 클러스터 I/O 줄을 면·depth·인서터에 배정. 1단계: **아이템 belt 만** — 면당 레인
 * 모델 재현. 유체 줄이 있으면 미구현이라 `complex` 위임. 결정적(입력 먼저·등장 순서,
 * perimeter 가까운 면부터 채움).
 */
export function planClusterPorts(input: PortPlannerInput): PortPlan {
  const { lines, caps } = input;

  // 유체(pipe) 미구현 — 있으면 complex 로 위임(emit 미연결 → 레이아웃 회귀 동등).
  if (lines.some((l) => l.kind === "pipe")) {
    return { ok: false, complex: true, reason: "pipe-not-yet-supported" };
  }

  if (lines.length === 0) return { ok: true, lines: [] };

  const lanes = laneSlots(caps);
  if (lanes.length === 0) {
    return { ok: false, complex: true, reason: "no-inserter" };
  }

  // 슬롯 풀 — perimeter 가까운 면 먼저, 그다음 먼 면. 각 면에 레인을 깐다.
  const farSide: PortSide = input.perimeterNearSide === "W" ? "E" : "W";
  const slots: { side: PortSide; depth: number; inserter: InserterRole }[] = [];
  for (const side of [input.perimeterNearSide, farSide]) {
    for (const lane of lanes) slots.push({ side, ...lane });
  }

  if (lines.length > slots.length) {
    return { ok: false, complex: true, reason: "belt-demand-exceeds-capacity" };
  }

  // 결정적 배정: 입력 먼저, 그다음 출력(각각 등장 순서). 슬롯은 near 면부터.
  const index = new Map(lines.map((l, i) => [l, i] as const));
  const ordered = [...lines].sort((a, b) => {
    const ra = a.role === "input" ? 0 : 1;
    const rb = b.role === "input" ? 0 : 1;
    return ra !== rb ? ra - rb : index.get(a)! - index.get(b)!;
  });

  const planned: PlannedLine[] = ordered.map((line, i) => ({
    line,
    side: slots[i].side,
    depth: slots[i].depth,
    inserter: slots[i].inserter,
  }));
  return { ok: true, lines: planned };
}
