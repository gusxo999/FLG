/**
 * runStats — 한 번의 자동 배치 실행이 남기는 **진단 카운터**.
 *
 * ## 왜 별도 싱크인가 (반환값에 실어 올리지 않고)
 *
 * 이 숫자들은 파이프라인 **안쪽**에서 이미 계산되고 있었는데(`routeDeliveryRoutes` 의
 * `planned`·`dijkstraFallback`·`reservationOverrun`, `rePathToPerimeter` 의
 * `relocated`·`skipped`·`skips`) 밖으로 나오는 길이 **문장뿐**이었다 — `moduleWizard` 가
 * 그것들을 `LayoutIssue.detail` 문자열로 빚어 화면에 보낸다. 그래서 *"planned 가 몇이냐"*
 * 를 물으면 콘솔 로그를 정규식으로 긁어야 했다(2026-08-17 실측: `planned = 0` 을 그렇게
 * **우연히** 발견했다).
 *
 * 숫자를 `CandidateLeaf` 까지 실어 올리려면 모델 타입 3개와 그 사이 어댑터가 전부
 * 바뀐다 — **배치 모델에 진단 필드를 심는 일**이다. 반대로 여기 싱크는 파이프라인이
 * *관측만* 당하게 둔다: 계산도, 분기도, 반환값도 그대로다. 대가는 모듈 전역 상태 하나이고,
 * 그건 이미 같은 파일이 하고 있는 일(`tryRunModulePipeline` 의 console 캡처)과 같은 종류다.
 *
 * ## 수명
 *
 * `runModulePipeline` 진입에서 [beginRunStats] 로 리셋된다 — 실행 1회 = 이 값 1벌.
 * 실행이 실패해 중간에 끝나면 그때까지 기록된 것만 남는다(그게 맞다 — 어디까지 갔는지가
 * 곧 진단이다). `flg.report()` 가 [readRunStats] 로 읽는다.
 */

/** 납품 경로 — [deliveryRoute.routeDeliveryRoutes] 의 카운터 그대로. */
export interface DeliveryCounters {
  /** 채널 장부의 **계획대로** 깐 납품 경로 수. 이게 0 이면 예약이 한 번도 안 쓰였다. */
  planned: number;
  /** 계획을 못 쓰고 탐색(dijkstra)으로 돈 수. */
  dijkstraFallback: number;
  /** 그중 **남의 예약을 밟은** 수(연쇄 가능). */
  reservationOverrun: number;
  /** 아예 못 깐 수 — 하나라도 있으면 트리가 거절된다. */
  failures: number;
  /** 시도한 납품 경로 총수. */
  routes: number;
}

/** 반출 — [modulePerimeterPass.rePathToPerimeter] 의 카운터 그대로. */
export interface PerimeterCounters {
  /** 전역 외곽으로 옮긴 상자 수. */
  relocated: number;
  /** 못 나가 모듈 안에 남은 상자 수. */
  skipped: number;
  /** 못 나간 상자마다의 사유 — 개수만으로는 "무엇이 막혔나" 를 못 묻는다. */
  skips: ReadonlyArray<{ chestId: string; reason: string }>;
}

export interface RunStats {
  /** 이 통계가 시작된 시각(ms). 한 번도 안 돌았으면 null. */
  startedAt: number | null;
  /** 납품 단계까지 갔으면 채워진다. 그 전에 거절됐으면 null. */
  delivery: DeliveryCounters | null;
  /**
   * 반출 단계까지 갔으면 채워진다.
   * `AUTO_LAYOUT_PERIMETER_PASS` 가 꺼져 있으면 단계 자체가 없으므로 null 이다 —
   * **"0건 이사" 와 "안 돌았다" 는 다르다.**
   */
  perimeter: PerimeterCounters | null;
}

const fresh = (): RunStats => ({ startedAt: null, delivery: null, perimeter: null });

let current: RunStats = fresh();

/** 실행 1회 시작 — `runModulePipeline` 진입에서 부른다. */
export function beginRunStats(): void {
  current = { ...fresh(), startedAt: Date.now() };
}

export function recordDeliveryStats(c: DeliveryCounters): void {
  current.delivery = c;
}

export function recordPerimeterStats(c: PerimeterCounters): void {
  current.perimeter = { relocated: c.relocated, skipped: c.skipped, skips: [...c.skips] };
}

/** 마지막 실행의 카운터. 읽기 전용 스냅샷(내부 배열까지 복사한다). */
export function readRunStats(): RunStats {
  return {
    startedAt: current.startedAt,
    delivery: current.delivery ? { ...current.delivery } : null,
    perimeter: current.perimeter
      ? { ...current.perimeter, skips: current.perimeter.skips.map((s) => ({ ...s })) }
      : null,
  };
}
