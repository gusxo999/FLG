/**
 * **통로 관심사의 타입** — 채널 기하 장부의 입력(`DeliveryInput` · `ExportInput` · `GeometryContext`)과
 * 결과(`ChannelGeometryPlan` 과 그 필드들).
 *
 * 장부(`channelGeometryPlanner.planChannelGeometry`)가 받고 내는 어휘이고, 읽는 쪽이 셋이다 —
 * 통로 장부(`channel/ledger` — 입력을 짓고 결과를 받는다) · 통로 도형(`channel/shape` — 결과를 좌표로 옮긴다) · 장부 자신.
 *
 * **왜 장부 파일 밖인가.** 그 파일을 종류로 가르면 떼어 낸 조각(`channel/shape` · `channel/policy`)이 이 타입을
 * 읽는다. 타입이 뼈대 파일에 남으면 조각이 뼈대를 **올려다보게** 된다 — 역방향 타입 간선도 D4(런타임 순환)의
 * 모양이다(계획 구조-2축 · 2 Step 5a, 2026-09-15 `channel/ledger/geometry.ts` 에서 옮겼다).
 */

import type { Interval } from "./ledger/tracks";

export type ChannelWall = "W" | "E";
export type NsEdge = "N" | "S";

/** 납품 경로 입력 — 자식 출력(E벽) 행 → 부모 입력(W벽) 행. */
export interface DeliveryInput {
  /** 납품 경로 키 — 결과 맵의 키로 그대로 돌아온다. */
  id: string;
  /** 출발 행 = 자식 출력 포트의 abs y (E벽 접점). */
  startY: number;
  /** 도착 행 = 부모 입력 포트의 abs y (W벽 접점). */
  endY: number;
  /**
   * 유체 이름. `undefined` = 아이템(벨트).
   *
   * 유체는 두 가지가 다르다(docs/auto-layout/channel/fluid-delivery-reservation.md):
   *  - **인접 금지** — 파이프는 닿기만 하면 이어진다. *다른* 유체와는 겹침뿐 아니라
   *    4-인접도 충돌이다. 같은 유체끼리는 닿아도 합법이라 겹침만 본다.
   *  - **땅속은 지하파이프로** — 지하파이프의 짝은 종류와 무관하게 같은 줄에서 끊기므로 장부가 파이프 짝을 따로 센다
   *    (`channel/ledger/geometry.crossUnderground`). 누가 들어가나는 docs/auto-layout/common/layout-models.md §3.5 제4조 ③.
   */
  fluid?: string;
}

/** 반출 경로 입력 — 벽의 한 점에서 열린 N/S 변으로. */
export interface ExportInput {
  /** 상자 id — 결과 맵의 키. */
  id: string;
  /** 상자 접점 행 (포트 anchor 의 abs y). */
  entryY: number;
  /** 어느 벽에서 채널로 들어오나 (W벽 = 부모 열 쪽, E벽 = 자식 열 쪽). */
  entryWall: ChannelWall;
  /** 선호 진출 변(가까운 N/S) — 해소 사다리 ①이 뒤집을 수 있다. */
  preferredExit: NsEdge;
  /**
   * 유체 이름 — 파이프 반출이면 있다. `undefined` = 벨트 반출.
   *
   * 반출도 경로라 매체가 값을 정한다([DeliveryInput.fluid] 와 같다) — 땅속으로 가면 지하벨트 · 지하파이프 중 무엇이고 사거리가
   * 얼마인가, 다른 유체에 닿기만 해도 만나는가(인접). 2026-10-02 까지 장부는 반출 파이프를 벨트로 봤다.
   */
  fluid?: string;
}

export interface GeometryContext {
  /** 전역 모듈 밴드(abs y) — 반출 세로 주행이 이 밖(±`PERIMETER_MARGIN` = perimeter seat 행 — `channel/shape.edgeRowOf`)까지 달린다. */
  yMin: number;
  yMax: number;
  /**
   * 지하벨트 점프 거리 상한(입구↔출구 셀 거리). 0(기본) = 지하 불가 = 지상만.
   *
   * **벨트 경로가 쓴다** — 아이템 납품 · 벨트 반출. 파이프 경로(유체 납품 · 파이프 반출)는 [maxJumpPipe] 를 쓴다.
   * 누가 땅 위를 먼저 갖나는 이 값이 아니라 실패 비용(`priority-ordering` P10 — 유체 → 반출 → 아이템)이,
   * 완전 교차에서 누가 땅속으로 가나는 해소 사다리(`channel/policy.settleFullCrossings`)가 정한다.
   */
  maxJump?: number;
  /**
   * 지하파이프 점프 거리 상한 — **파이프 경로**(유체 납품 · 파이프 반출)가 완전 교차에서 땅속으로 갈 때 쓴다. 0(기본) =
   * 지하파이프를 안 골랐다 = 파이프는 땅속으로 못 간다. [link/types.DeliveryConfig] 의 `pipeMaxUndergroundDistance` 와
   * **같아야** 한다 — 장부가 계획한 점프를 방출기가 그대로 깐다.
   */
  maxJumpPipe?: number;
  /** 폭만 예약할 잔여 세로 구간(부적격 납품 경로·미지원 반출 등) — trackCount 에만 반영. */
  reserveIntervals?: Interval[];
  /**
   * 트랙 수 상한. 미지정이면 **경로 수**에서 유도한다(아래 planChannelGeometry).
   *
   * 옛 상한 8은 트렁크 시절의 값이다 — 품목당 포트가 하나뿐이라 한 채널을 지나는 경로가
   * 품목 수(≤ 몇 개)였다. 1:1 에선 포트가 (머신 × 품목) 이라 한 채널에 경로가 수십 개
   * 들어올 수 있고, 상한에 걸린 경로는 전부 fallback → dijkstra 로 떨어져 채널 밖을 돌다
   * 반출 트랙을 끊는다. 최악의 경우 경로마다 자기 트랙이 필요하므로 상한 = 경로 수면 족하다.
   */
  trackCap?: number;
}

/**
 * 지하 점프 하나 — `from`(지하 입구)에서 `to`(지하 출구)까지, **그 사이 셀들 밑으로** 간다.
 * 두 셀은 축이 같고(같은 행 또는 같은 열) 둘 다 **지상 belt** 다. 거리 = |Δ| ≥ 2.
 * 좌표계는 계획과 같은 추상 (열, 행) — 열 = 트랙 index, 행 = abs y.
 */
export interface Jump {
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
}

export type DeliveryPlan =
  | { kind: "straight" } // 출발 행 = 도착 행 — 일자 수평선, 트랙 소비 0
  | { kind: "staircase"; track: number }
  | { kind: "columnSwitch"; startTrack: number; switchY: number; endTrack: number }
  | {
      /**
       * 지하 횡단 — 계단꼴이되, 길을 막는 **다른 경로의 셀들** 밑을 지하벨트로 건넌다.
       *
       * 왜 여러 개인가: 1:1 방출에서 납품 경로는 서로 **반드시 교차한다**. 부모 열 서쪽,
       * 자식 둘(위·아래)이 동쪽인 채널을 생각해 보라 — 위 자식에서 아래 부모 머신으로
       * 가는 벨트와, 아래 자식에서 위 부모 머신으로 가는 벨트는 채널 테두리 위에서 끝점이
       * **엇갈려** 있다. 원판 안에서 끝점이 엇갈린 두 곡선은 반드시 만난다(Jordan). 즉
       * 교차는 배정을 잘해서 없앨 수 있는 게 아니라 **기하학적으로 불가피**하고, 지상에서
       * 벨트는 교차할 수 없으니 **지하가 유일한 답**이다. 채널을 지나는 납품이 늘수록
       * 한 경로가 건너야 할 남의 세로선도 늘어난다 → 점프가 여러 개.
       *
       * 세로 주행(track)은 늘 지상이다 — 빈 트랙을 골랐기 때문. 점프는 가로선(진입·진출)
       * 위에서 남의 세로선을 건너거나, 세로선 위에서 남의 가로선을 건널 때 생긴다.
       *
       * 끝점이 엇갈렸나는 트랙을 고르기 **전에** 판정한다 — [fullCrossing](`channel/shape`)의 **완전 교차**.
       * 누가 땅 위를 내주나는 해소 사다리(`channel/policy.settleFullCrossings`)가 고른다.
       */
      kind: "undergroundCrossing";
      track: number;
      jumps: Jump[];
    }
  | { kind: "fallback"; reason: string };

export type ExportPlan =
  | { kind: "elbow"; track: number; exitEdge: NsEdge }
  | {
      /**
       * 땅속으로 건너는 한꺾임꼴 — 완전 교차에서 이 반출이 들어갔다(docs/auto-layout/common/layout-models.md §3.5 제4조 ③).
       * 반출은 바깥으로 가는 납품이라 [DeliveryPlan] 의 `undergroundCrossing` 과 같은 일이다 — 점프는 가로 진입이나 세로
       * 주행 위에서 남의 선을 건넌다. 방출(`perimeter/late`)이 이 점프를 그대로 깐다.
       */
      kind: "undergroundCrossing";
      track: number;
      exitEdge: NsEdge;
      jumps: Jump[];
    }
  | { kind: "fallback"; reason: string };

export interface ChannelGeometryPlan {
  deliveries: Map<string, DeliveryPlan>;
  exports: Map<string, ExportPlan>;
  /** 사용한 트랙 수(fallback 경로의 폭 예약 포함) — 채널 폭의 근거. */
  trackCount: number;
  /** **관측** — 완전 교차에서 땅 위를 내준 경로 수(납품 + 반출). 해소 사다리가 실제로 돌았나를 센다. */
  crossingYields: number;
  /** **관측** — 지상 탐색이 해를 못 찾아(예산 소진 포함) 탐욕 배정으로 갔나. 완전 교차를 푼 뒤에는 드물어야 한다. */
  greedy: boolean;
  /** **관측** — 땅속으로 건넌 유체 납품 수(지하파이프). 유체가 먼저 들어가는 사다리가 실제로 돌았나를 센다. */
  fluidDives: number;
  /** **관측** — 땅속으로 건넌 반출 수(지하벨트 · 지하파이프). 반출이 들어가는 사다리가 실제로 돌았나를 센다. */
  exportDives: number;
  /**
   * **관측** — 건너는 쪽에게 자리를 만들려고 끼운 트랙 수(계획이 넓힌다 — docs layout-models §3.5 제4조 ④). 지금 판의 어느
   * 트랙으로도 못 건넌 경로가 새 열로 건넜다. 폭(`trackCount`)은 그만큼 는다.
   */
  widenedTracks: number;
}
