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

/**
 * **배선 형태** — 이 배치가 실제로 무엇을 깔았나([summarizeBeltForms]).
 *
 * 없어서 데인 적이 있다: glass 100/s 에서 필요 5줄 자리에 54줄이 깔린 것을 **사후에 손으로
 * 세어** 알았다. 형태는 산출물 어디에도 안 남기 때문이다. 모듈마다 한 벌씩 나므로
 * [mergeBeltFormCounters] 로 누적한다.
 */
import { mergeBeltFormCounters, type BeltFormCounters } from '../autoLayout/module/link';
export type { BeltFormCounters };

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

/** 행 채널 — [modulePacking] 이 낸 띠들(Step 1). 아직 자리만 있고 배정은 없다. */
export interface RowChannelCounters {
  /** 띠 개수. 0 이면 이 트리엔 세로로 쌓인 이웃이 없다(같은 깊이에 모듈 하나씩). */
  count: number;
  /** 띠마다 `depth#index top..bottom (위모듈 | 아래모듈)`. */
  bands: ReadonlyArray<string>;
  /**
   * **띠를 지나야 하는 경로 끝 수** — 포트가 기둥 끝이라 세로 채널 벽을 직접 못 마주 보는 것.
   * 0이면 행 채널이 이 트리에 필요 없다.
   */
  needs: ReadonlyArray<string>;
}

/**
 * **면 레인 — 좌석표 배정의 계측기**(`docs/auto-layout/module/module-planning.md §4.5`).
 *
 * 묻는 것은 둘이다. *"결함이 실물에서 발현하나"* 를 **수로** 답한다:
 *
 * ```
 * deepLane / deepLaneOtherArm   둘째 레인이 쓰이나, 그 팔이 얕은 레인과 다른가
 * netTrips                      **경보** — 포트 칸 다툼이 방출까지 갔다(결함 B)
 * ```
 *
 * `netTrips` 는 `emitModule` 의 두 안전망(`:278`·`:430`)이다. 그 줄들은 스스로
 * *"구성상 발생 안 함"* 이라 적고 있고, **발동은 곧 그 구성 논증이 틀렸다는 증거**다
 * (`module-planning.md` §5: *"착수 시점은 안전망이 실제로 발동할 때다"*).
 *
 * 다른 계수기와 같은 규약 — **관측만 한다.** 계산도 분기도 반환값도 안 바뀐다.
 */
export interface FaceLaneCounters {
  /** 옆면(W/E)에 앉은 배정 수 — 아래 셋의 모수. gap(N/S)은 레인 개념이 없어 안 센다. */
  assignments: number;
  /** 그중 그 면의 **레인 후보가 둘 이상**이던 것 — 조건 ①이 서나. */
  multiLaneFace: number;
  /** 그중 **가장 얕은 후보가 아닌** 레인에 앉은 것 — 조건 ②가 서나(계획서의 `B수`). */
  deepLane: number;
  /**
   * `deepLane` 중 그 레인의 팔 처리량이 가장 얕은 레인과 **다른** 것.
   *
   * **뜻이 Step 2 에서 뒤집혔다.** 예전엔 이 수가 곧 결함 A 였다 — 팔 개수를 얕은 레인
   * 기준으로 세 놓고 깊은 레인의 느린 팔을 앉혔으니, 갈리는 만큼 그 줄이 굶었다.
   * 지금은 [armsAt] 이 **그 레인의 팔로 개수를 다시 세므로** 갈려도 맞는 값이고,
   * 이 수는 *"긴팔이 실제로 값을 하고 있다"* 는 관측치다.
   *
   * 결함 A 는 이제 **구성상 발생할 수 없다**(세는 곳과 앉는 곳이 같은 인서터를 본다).
   * 그래서 이 수를 경보로 읽지 않는다 — 경보는 [netTrips] 하나다.
   */
  deepLaneOtherArm: number;
  /** `emitModule` 의 *"구성상 발생 안 함"* 안전망이 발동한 횟수 (계획서의 `D수`). */
  netTrips: number;
}

const freshFaceLanes = (): FaceLaneCounters => ({
  assignments: 0, multiLaneFace: 0, deepLane: 0, deepLaneOtherArm: 0, netTrips: 0,
});

export interface RunStats {
  /** 이 통계가 시작된 시각(ms). 한 번도 안 돌았으면 null. */
  startedAt: number | null;
  /**
   * 배선 형태 — 벨트 줄을 하나라도 만들었으면 채워진다.
   * **null 과 "전부 0" 은 다르다** — 전자는 줄을 만드는 단계에 못 갔다는 뜻이다.
   */
  beltForms: BeltFormCounters | null;
  /** 납품 단계까지 갔으면 채워진다. 그 전에 거절됐으면 null. */
  delivery: DeliveryCounters | null;
  /**
   * 반출 단계까지 갔으면 채워진다.
   * `AUTO_LAYOUT_PERIMETER_PASS` 가 꺼져 있으면 단계 자체가 없으므로 null 이다 —
   * **"0건 이사" 와 "안 돌았다" 는 다르다.**
   */
  perimeter: PerimeterCounters | null;
  /** 행 채널 띠. 패킹까지 갔으면 채워진다. */
  rowChannels: RowChannelCounters | null;
  /**
   * 면 레인. **null 이 아니라 언제나 있다** — 0 이 유의미한 답이기 때문이다
   * (*"둘째 레인이 한 번도 안 쓰였다"* 는 결함 A 가 도달 불가라는 뜻이다).
   */
  faceLanes: FaceLaneCounters;
}

const fresh = (): RunStats => ({
  startedAt: null, delivery: null, perimeter: null, rowChannels: null, beltForms: null,
  faceLanes: freshFaceLanes(),
});

let current: RunStats = fresh();

/** 실행 1회 시작 — `runModulePipeline` 진입에서 부른다. */
export function beginRunStats(): void {
  current = { ...fresh(), startedAt: Date.now() };
}

export function recordDeliveryStats(c: DeliveryCounters): void {
  current.delivery = c;
}

/**
 * 배선 형태 계수기만 비운다 — **측정용 패스를 버리기 위한 것**이다.
 * `packModuleTree` 는 모듈을 두 번 만든다(끝 선호를 재는 1차 · 그것을 반영한 2차).
 * 1차가 센 줄은 실제로 안 깔리므로, 2차 직전에 여기서 지운다. 다른 계수기는 안 건드린다.
 */
export function resetBeltFormStats(): void {
  current.beltForms = null;
}

/**
 * 배선 형태를 **누적**한다 — 모듈마다(그리고 내부 링크는 트리 전체에서 한 번) 불린다.
 * 덮어쓰기가 아니라 합치기인 것이 요점이다([mergeBeltFormCounters]).
 */
export function recordBeltFormStats(c: BeltFormCounters): void {
  current.beltForms = current.beltForms ? mergeBeltFormCounters(current.beltForms, c) : c;
}

/**
 * 면 레인 계수기를 **누적**한다 — 배정마다·안전망 발동마다 한 번. 준 항목만 더한다.
 * (배선 형태와 달리 낟알이 잘아서 `Partial` 을 받는다 — 방출은 `netTrips` 만 안다.)
 */
export function recordFaceLaneStats(c: Partial<FaceLaneCounters>): void {
  const cur = current.faceLanes;
  for (const k of Object.keys(cur) as (keyof FaceLaneCounters)[]) cur[k] += c[k] ?? 0;
}

/**
 * 면 레인 계수기만 비운다 — [resetBeltFormStats] 와 **같은 이유·같은 자리**다.
 * `packModuleTree` 의 1차(끝 선호 측정용) 모듈은 실제로 안 깔리므로 그것이 센 배정과
 * 안전망 발동은 버려야 한다. 안 버리면 모든 수가 두 배로 보인다.
 */
export function resetFaceLaneStats(): void {
  current.faceLanes = freshFaceLanes();
}

export function recordRowChannelStats(c: RowChannelCounters): void {
  current.rowChannels = { count: c.count, bands: [...c.bands], needs: [...c.needs] };
}

export function recordPerimeterStats(c: PerimeterCounters): void {
  current.perimeter = { relocated: c.relocated, skipped: c.skipped, skips: [...c.skips] };
}

/** 마지막 실행의 카운터. 읽기 전용 스냅샷(내부 배열까지 복사한다). */
export function readRunStats(): RunStats {
  return {
    startedAt: current.startedAt,
    beltForms: current.beltForms ? { ...current.beltForms } : null,
    delivery: current.delivery ? { ...current.delivery } : null,
    perimeter: current.perimeter
      ? { ...current.perimeter, skips: current.perimeter.skips.map((s) => ({ ...s })) }
      : null,
    rowChannels: current.rowChannels
      ? {
          ...current.rowChannels,
          bands: [...current.rowChannels.bands],
          needs: [...current.rowChannels.needs],
        }
      : null,
    faceLanes: { ...current.faceLanes },
  };
}
