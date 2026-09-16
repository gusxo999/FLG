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
export function layoutCluster(
  meta: ClusterMeta,
  rowGap: number | number[] = ROW_GAP,
): ClusterLayout {
  const count = Math.max(1, meta.count);
  // gap 은 **자리마다 다를 수 있다** — 그 gap 을 지나는 가로 벨트 수에서 유도되기 때문이다
  // (폭은 우리가 정하는 값이 아니라 예약의 부산물). 스칼라는 "전부 같은 폭" 의 축약.
  const gapAt = (i: number): number =>
    Array.isArray(rowGap) ? Math.max(0, rowGap[i] ?? 0) : rowGap;

  const positions: { dx: number; dy: number }[] = [];
  let y = 0;
  for (let i = 0; i < count; i++) {
    positions.push({ dx: 0, dy: y });
    y += meta.h + gapAt(i); // gapAt(i) = 머신 i 와 i+1 사이
  }
  return {
    positions,
    size: { w: meta.w, h: y - (count > 0 ? gapAt(count - 1) : 0) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 형태 선택 — 탭 용량 기준 (P1)
// ─────────────────────────────────────────────────────────────────────────────

/** 형태 선택에 필요한 인서터 능력 = **고른 인서터들의 reach 값**(≥1). */
export interface ShapeCaps {
  /**
   * 고른 인서터들의 reach 값 목록. **서로 다른 reach 하나당 [ClusterBelt] 한 줄**
   * (reach `r` → clusterBeltDepth `1+r`). 중복은 무시된다(같은 reach 는 벨트를 못 늘림).
   * 옛 `{hasNormal, hasLong}` 이진값을 대체했다.
   */
  reaches: number[];
}

/**
 * 기둥 클러스터의 탭 용량 = 서빙 가능한 *서로 다른 belt* 수.
 *
 * = 한 축의 면 수(2: 좌·우 또는 상·하) × 면당 [ClusterBelt] 수. 면당 벨트 수 = **고른
 * 인서터들의 서로 다른 reach 값 개수**(reach `r` 인서터가 좌석에 앉아 `1+r`칸의 벨트를 집는다).
 * 면 길이와 무관(긴 면은 탭/seat 수만 늘릴 뿐 벨트 줄 수는 reach 종류가 정한다).
 * vanilla 는 reach {1,2} 두 종이라 최대 4(=2면×2벨트)지만, reach 종류가 늘면 그만큼 는다.
 */
export function columnTapCapacity(caps: ShapeCaps): number {
  return 2 * new Set(caps.reaches.filter((r) => r >= 1)).size;
}

