/**
 * 클러스터 형태 — 한 레시피 노드의 N대 머신을 어떤 배열로 둘지 결정 (순수 함수).
 *
 * 단일 출처: docs/auto-layout-wizard.known-limits.md §1·§2 (클러스터 형태 일반화).
 *
 * "클러스터" = 같은 레시피 노드의 N대 동일 머신. 그 *내부 배열*(상대 좌표 + bbox)을
 * 이 모듈이 단독으로 결정하고, `layeredWizard` 는 결과를 **형태-무관하게** 소비한다
 * (불투명 서브블록). 형태를 바꾸려면 본 모듈만 고치면 되고, 레이아웃 파이프라인
 * (tidy-tree·채널·배치)은 (positions, size) 만 본다.
 *
 * P0 범위: **기둥(column)만** — 세로 한 줄. 동작은 기존 인라인 배치와 동일.
 *   P1: 행(row) + 포트-버짓 기반 `pickClusterShape` + 적응 gap (`portDemand` 인자 추가).
 *   P2: 격자/스트리트 + fluid 면 처리.
 */

/** 같은 클러스터 안에서 머신끼리의 세로 간격 — 투입기/벨트가 사이를 지날 공간. */
export const ROW_GAP = 3;

/** 클러스터 1개의 형태 결과 — 머신별 로컬 상대좌표 + 전체 bbox. */
export interface ClusterLayout {
  /** N대의 클러스터-로컬 상대 좌표 (index = machineIndex). 좌상단 기준 (0,0). */
  positions: { dx: number; dy: number }[];
  /** 클러스터 bounding box. */
  size: { w: number; h: number };
}

/** 클러스터 형태 계산에 필요한 최소 정보. */
export interface ClusterMeta {
  /** 머신 footprint 폭. */
  w: number;
  /** 머신 footprint 높이. */
  h: number;
  /** 머신 대수 (≥ 1). */
  count: number;
}

/**
 * 한 클러스터의 형태를 계산. P0: 세로 기둥(x 고정, y 가 `h + rowGap` 씩 증가).
 *
 * 결과 좌표는 클러스터-로컬(좌상단 (0,0) 기준)이며, 호출자가 절대 위치 오프셋을 더한다.
 *
 * `rowGap` = 머신 사이 세로 공백. 기본 `ROW_GAP`(3) — 옛 라이브 경로(externalMergePass)는
 * 트렁크가 N/S 끝면으로 spill 탭을 할 수 있어 이 여백이 필요하다. **간단 레시피(W/E 전용)**
 * 모듈 경로는 N/S 면을 안 쓰므로 0 을 넘겨 머신을 밀착시킨다(gap 은 트렁크 길이만 늘릴 뿐).
 */
export function layoutCluster(meta: ClusterMeta, rowGap: number = ROW_GAP): ClusterLayout {
  const count = Math.max(1, meta.count);
  const positions = Array.from({ length: count }, (_, i) => ({
    dx: 0,
    dy: i * (meta.h + rowGap),
  }));
  return {
    positions,
    size: {
      w: meta.w,
      h: count * meta.h + (count - 1) * rowGap,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 형태 선택 — 탭 용량 기준 (P1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 클러스터가 다뤄야 하는 I/O 줄 수요. 운반체 종류로 분리한다 — 아이템은 belt(인서터
 * 탭), 유체는 pipe 스파인(인서터 없음). 둘은 면(W/E)을 공유하지만 점유 방식이 달라
 * 따로 센다. (셀-정밀 배정은 `clusterPortPlanner` 가 담당; 본 스칼라는 형태 게이트용.)
 */
export interface PortDemand {
  /** 아이템 I/O 줄 수 — belt 로 운반, 인서터로 탭. */
  beltDemand: number;
  /** 유체 I/O 줄 수 — pipe 스파인으로 운반, 인서터 없음. */
  pipeDemand: number;
}

/** 형태 선택에 필요한 인서터 능력. */
export interface ShapeCaps {
  /** reach 1(거리 1)을 집을 수 있는 일반 인서터 보유 — 가까운 belt 레인. */
  hasNormal: boolean;
  /** reach≥2 긴팔 인서터 보유 — 앞 belt 위로 넘겨 먼 belt 레인. */
  hasLong: boolean;
}

export type ClusterShape = "column";

/**
 * 기둥 클러스터의 탭 용량 = 서빙 가능한 *서로 다른 belt* 수.
 *
 * = 한 축의 면 수(2: 좌·우 또는 상·하) × 면당 레인 수. 면당 레인 = 일반@거리1(앞 belt)
 * + 긴팔@거리2(앞 belt 건너 뒷 belt). **긴팔은 거리 1을 못 집으므로 2레인은 일반 AND
 * 긴팔 둘 다 있어야 성립** → `면당 레인 = (hasNormal?1:0)+(hasLong?1:0)`. 둘 다 2, 하나만
 * 1. 면 길이와 무관(긴 면은 탭/seat 수만 늘릴 뿐 레인 수는 인서터 종류가 정한다).
 * vanilla 긴팔 reach=2 가 상한이라 최대 4(=2면×2레인).
 */
export function columnTapCapacity(caps: ShapeCaps): number {
  return 2 * ((caps.hasNormal ? 1 : 0) + (caps.hasLong ? 1 : 0));
}

export interface ShapeDecision {
  shape: ClusterShape;
  /** 기둥 탭 용량(서빙 가능한 belt 수). */
  capacity: number;
  /** I/O belt 수요가 용량을 초과 → 본래 2D 형태가 필요(현재 미구현, 기둥으로 폴백). */
  overflow: boolean;
}

/**
 * 클러스터 형태 결정. **P1: 항상 기둥.** 단 belt 수요 > 기둥 용량이면 `overflow=true`
 * 로 표시한다(복잡/유체 레시피 → 향후 2D 알고리즘 대상). 2D 미구현이므로 동작은 기둥 유지.
 */
export function pickClusterShape(demand: PortDemand, caps: ShapeCaps): ShapeDecision {
  const capacity = columnTapCapacity(caps);
  // 셀-정밀 배정(`clusterPortPlanner`)이 아직 emit 에 연결되지 않아, overflow 판정은
  // 종전과 동일하게 총 I/O(belt+pipe) > 용량 으로 유지한다(회귀 동등). belt/pipe 가
  // 면을 점유하는 방식 차이를 반영한 정밀 판정은 planner 연결 단계에서 대체한다.
  return {
    shape: "column",
    capacity,
    overflow: demand.beltDemand + demand.pipeDemand > capacity,
  };
}
