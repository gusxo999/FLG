/**
 * **연결 관심사의 타입** — 납품 경로 라우팅의 설정(`DeliveryConfig`)과 결과(`DeliveryResult` · `DeliveryRoute`).
 *
 * 납품(`deliveryRoute.routeDeliveryRoutes`)이 받고 내는 어휘이고, 읽는 쪽이 실행 전체다 —
 * 진입점(`moduleWizard`) · 받을지 물릴지(`run/policy`) · 찍기(`run/emit`).
 *
 * **왜 납품 파일 밖인가.** 그 파일을 종류로 가르면 떼어 낸 조각(`link/policy` · `link/ledger` · `link/emit`)이 이 타입을
 * 읽는다. 타입이 뼈대 파일에 남으면 조각이 뼈대를 **올려다보게** 된다
 * (계획 구조-2축 · 2 Step 5a, 2026-09-15 `deliveryRoute.ts` 에서 옮겼다).
 */

import type { PlacedCell, UndergroundCorridor } from "../shared/types";

export interface DeliveryConfig {
  beltEntityName: string;
  /** 지하벨트 점프 거리(>0 이면 underground 허용). v1 기본 0(지상 전용). */
  beltMaxUndergroundDistance?: number;
  /** 지하벨트 prototype(점프 blockGroup). */
  undergroundBeltEntityName?: string;
  /**
   * 유체 납품 경로(pipe-to-pipe, docs/auto-layout-wizard.fluid-delivery.md) 재료. 없으면 유체 납품 경로는
   * 실패 처리(→ 트리 전체 옛 경로 폴백). 파이프는 인서터·방향이 없어 아이템 납품 경로보다 단순하다.
   */
  pipeEntityName?: string;
  pipeMaxUndergroundDistance?: number;
  undergroundPipeEntityName?: string;
  /**
   * 유체별 **금지 칸**(합류 가드) — 납품 경로가 **다른 유체**에 닿지 않게. 키=유체 이름,
   * 값=cellKey 집합(그 유체의 `PipeFlow.blockedTilesHard`). 같은 유체는 안 막는다(공유 허용).
   */
  fluidBlocked?: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * **이미 놓인 지하 입/출구가 예약해 둔 구간** — 지금은 모듈이 세운 **벨트 종착**
   * ([resolveBeltTermini](../../execution/module/beltTerminus.ts))이 유일한 출처다.
   *
   * 왜 필요한가: 종착은 **짝 없는 입구**라 터널이 안 뚫린 채로 서 있다. 그 사거리 안에
   * 납품 경로가 **같은 티어의 출구**를 세우면 그 순간 짝이 맺혀 터널이 뚫리고, 모듈 안
   * 물건이 남의 납품 벨트로 쏟아진다. 구간을 미리 올려 두면 점프 검사가 그 자리를 피한다.
   *
   * `blockGroup` 이 다르면(=티어가 다르면) 어차피 안 맺히므로 검사에서 저절로 빠진다.
   */
  seedCorridors?: ReadonlyArray<UndergroundCorridor>;
}

/** 한 납품 경로의 라우팅 결과. */
export interface DeliveryRoute {
  /**
   * **이 경로 자체의 신원**([deliveryKey]) — 배열 위치가 아니다.
   *
   * 아래 루프는 유체를 먼저 깔려고 `pack.deliveries` 를 **재정렬**해서 돈다(§유체 우선).
   * 그래서 이 배열의 순서는 `pack.deliveries` 의 순서와 다르다. 예전엔 호출자
   * (`moduleWizard`)가 `routes[i]` 를 `pack.deliveries[i]` 의 결과로 읽어, 유체와 아이템이
   * 섞이는 순간 **다른 경로의 셀을 엉뚱한 라우팅에 붙였다**(2026-08-04 발견).
   *
   * 안정 정렬이라 전부 아이템/전부 유체면 어긋나지 않아 여태 드러나지 않았고, 그 값을 쓰는
   * 연결선 렌더까지 죽어 있어 화면에도 안 나왔다. 위치로 되찾는 대신 신원을 싣는다 —
   * 이 저장소가 `seq` 에서 이미 배운 교훈이다([modulePacking] `linkId` 주석).
   */
  key: string;
  item: string;
  ok: boolean;
  /** 납품 경로 belt/지하벨트 셀들(경계 chest/seat 자리 포함). 실패 시 빈 배열. */
  cells: PlacedCell[];
  /** 이 납품 경로가 깐 지하 corridor 들(점프 0 이면 빈 배열). */
  corridors: UndergroundCorridor[];
  reason?: string;
}

export interface DeliveryResult {
  /** 모든 납품 경로 belt 셀(절대 좌표). */
  cells: PlacedCell[];
  /** 모든 납품 경로의 지하 corridor(절대 좌표) — Area.undergroundCorridors 로 기록 대상. */
  corridors: UndergroundCorridor[];
  /** 떼야 할 무한상자 컨테이너 id(자식 출력 싱크 + 부모 입력 소스). */
  strippedChestIds: Set<string>;
  /** 떼야 할 모듈 셀 좌표("x,y") — 경계 chest ghost + belt→belt 가 된 경계 인서터. */
  strippedCellKeys: Set<string>;
  routes: DeliveryRoute[];
  /** 경로 못 찾은 납품 경로 수. */
  failures: number;
  /**
   * **예약(계획된 체인)으로 깐 납품 경로 수** — 탐색이 없었던 납품 경로.
   *
   * `failures === 0` 은 "길이 났다"만 말하고 **누가 냈는지는 안 말한다.** dijkstra 폴백도
   * 길을 내기 때문이다. 예약 철학이 지켜지는지 보려면 이 수를 봐야 한다
   * (`planned + dijkstraFallback + failures = 아이템 납품 경로 수`).
   */
  planned: number;
  /** 예약이 못 대서 dijkstra 로 넘어간 납품 경로 수 — 0 이 아니면 예약에 구멍이 있다. */
  dijkstraFallback: number;
  /**
   * **남의 예약을 밟고 지나간 납품 경로 수** — dijkstra 폴백조차 예약을 피해선 길이 없어
   * *"예약 무시 재시도"* 로 넘어간 수다. `dijkstraFallback` 의 부분집합이고 **더 나쁘다**:
   * 밟힌 계획은 다음 차례에 자기도 탐색으로 내려가 **연쇄**한다.
   *
   * 세는 이유 — 여태 콘솔에 줄 하나 찍고 끝이라 `failures` 도 0, 화면도 "성공"이었다.
   * **폴백은 실패다**(2026-08-17 사용자). 실패를 삼키지 않는다는 이 저장소의 규칙이
   * 여기서만 지켜지지 않고 있었고, 그래서 우회 기하를 배정 탓으로 오진했다.
   */
  reservationOverrun: number;
  /**
   * **계획을 못 쓴 납품 경로마다 그 사유** — `planned` 가 0 인데 왜 0 인지 물을 수 있어야 한다.
   *
   * 사유가 넷이고 **처방이 다 다르다**:
   *  - `no-geometry-plan` — 채널 장부가 이 납품에 배정을 안 냈다(계획 단계가 포기)
   *  - `underground-not-allowed` — 지하 횡단 계획인데 지하벨트를 안 골랐다(사용자 입력)
   *  - `chain-build-failed` — 배정은 있는데 체인을 못 세웠다(장부와 기하가 어긋남 = 버그)
   *  - `chain-blocked` — 체인은 섰는데 놓을 때 칸이 막혔다(예약 불변식 파손)
   *
   * 개수만으로는 어느 처방인지 못 고른다 — 2026-08-17 실측에서 `planned 0` 을 보고도
   * 넷 중 무엇인지 몰라 게이트·배선·기하를 차례로 뒤졌다.
   */
  chainMisses: { key: string; reason: string }[];
}
