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
   * 유체는 두 가지가 다르다(docs/auto-layout-wizard.fluid-delivery-reservation.md):
   *  - **인접 금지** — 파이프는 닿기만 하면 이어진다. *다른* 유체와는 겹침뿐 아니라
   *    4-인접도 충돌이다. 같은 유체끼리는 닿아도 합법이라 겹침만 본다.
   *  - **지하로 못 도망간다** — 지하파이프 페어링 절단이 별개 제약이라 v1 에선 유체에
   *    지하 횡단을 안 쓴다. 대신 **지상 우선권**을 준다(배정 순서 맨 앞).
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
}

export interface GeometryContext {
  /** 전역 모듈 밴드(abs y) — 반출 세로 주행이 이 밖(±1 = perimeter seat 행)까지 달린다. */
  yMin: number;
  yMax: number;
  /**
   * 지하벨트 점프 거리 상한(입구↔출구 셀 거리). 0(기본) = 지하 불가 = 지상만.
   *
   * **납품 경로에만 쓴다.** 반출 경로는 [perimeterRouter] 가 지상 belt 로만 깔기 때문에
   * 지하로 도망갈 수 없다 — 그래서 반출이 **제약이 센 쪽**이고, 배정에서 먼저 자리를
   * 잡는다(제약 센 것부터). 납품은 [deliveryRoute] 이 지하벨트를 방출할 수 있어 막히면
   * 밑으로 건널 수 있다.
   */
  maxJump?: number;
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
       */
      kind: "undergroundCrossing";
      track: number;
      jumps: Jump[];
    }
  | { kind: "fallback"; reason: string };

export type ExportPlan =
  | { kind: "elbow"; track: number; exitEdge: NsEdge }
  | { kind: "fallback"; reason: string };

export interface ChannelGeometryPlan {
  deliveries: Map<string, DeliveryPlan>;
  exports: Map<string, ExportPlan>;
  /** 사용한 트랙 수(fallback 경로의 폭 예약 포함) — 채널 폭의 근거. */
  trackCount: number;
}
