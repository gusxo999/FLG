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
import type { LinkDepthNeed } from '../autoLayout/planner/module/depthBudget';
import type { ExitBlocked } from '../autoLayout/planner/perimeterExitPlanner';
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

/**
 * **반출 배정** — 나갈 길을 못 준 자리([perimeterExitPlanner.PerimeterExitPlan]).
 *
 * 왜 방출 카운터(`PerimeterCounters`)와 갈라 두나: 방출의 `skipped` 는 **결과**라
 * 사유가 뭉쳐 있다(`no exit assignment` 가 후보 0·짝지어짐·고아 포트를 합쳐 찍는다).
 * 이 계수기는 **배정 시점**의 분류라 *"무엇을 지어야 그 상자가 나가나"* 를 묻는다.
 *
 * `blocked` 중 `canEnterRowChannel` 인 것이 행 채널 환승(`exit-ray.md` §4 의 빈칸 — 미구현)으로
 * 구할 수 있는 상자이고, `hops` 가 **어느 조각이 필요한지**(끝 열 1홉 · 중간 깊이 2홉)를 가른다.
 * 행 채널에도 못 들어가는 상자는 모듈 몸통에 갇힌 것이다(`known-limits.md` §12).
 */
export interface ExitPlanCounters {
  /** 나갈 길이 없는 상자들 — 빈 배열이 정상이고, 그게 곧 답이다. */
  blocked: ReadonlyArray<ExitBlocked>;
  /** 후보 강등이 일어난 자리 수 — **모수가 아니다.** 강등돼도 환승으로 내려갔으면 손해가 없다. */
  demotions: number;
  /**
   * **셋 이상이 다툰 자리 수** — 같은 `cell` 열쇠가 강등 기록에 두 번 이상 나온 것
   * (먼저 앉은 하나 + 강등된 둘 이상).
   *
   * `tempPlanDocs/셀장부/judgements.md` **J-충돌차수** 의 트리거가 이 수다 —
   * *"셋 이상이 다투는 자리가 실제로 몇 건인가"*. `ExitDemotion` 이 2026-09-10 에 그
   * 재료를 만들었지만 **세는 자리가 없었다**(2026-09-11 재감사).
   */
  contestedCells: number;
  /**
   * **위험군** — 모듈이 W·E 를 둘 다 막은 반출 포트 수. `blocked` 가 0 일 때 *"왜 0인가"*
   * 를 가른다: 0 이면 막힘 0 이 **구조적**이고(W·E 중 하나만 열려도 후보가 늘 선다),
   * 0 이 아니면 그 포트들이 N/S 직진으로 나갔다는 뜻이다.
   */
  noSideWayOut: number;
}

/**
 * **채널 통합 장부** — [tree/types.PackChannelGeometry] 가 **계획 단계**에서 포기한 납품 경로.
 *
 * 방출의 `dijkstraFallback` 보다 **한 단계 앞**이다: 저건 *"계획을 못 썼다"* 이고 이건
 * *"계획이 아예 없었다"* 라, 같은 경로가 두 곳에 잡힐 수도 한 곳에만 잡힐 수도 있다.
 *
 * **만들어지기만 하고 읽는 곳이 0곳이었다**(2026-09-11 재감사에서 발견). 그동안
 * `채널-장부-충실도` J-교차지하가 이 수를 보고 있다고 적었다(*"관측 방법: report 에 찍힌다"*
 * 는 거짓이었다). 사유 `no-surface-assignment` 의 한계는 `channel-geometry-reservation.md` §10.4.
 */
export interface ChannelLedgerCounters {
  /** 장부에 못 들어간 납품 경로와 사유. 빈 배열이 정상이다. */
  skips: ReadonlyArray<{ key: string; reason: string }>;
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

/** 행 채널 — [modulePacking] 이 낸 행 채널들(Step 1). 아직 자리만 있고 배정은 없다. */
export interface RowChannelCounters {
  /** 행 채널 개수. 0 이면 이 트리엔 세로로 쌓인 이웃이 없다(같은 깊이에 모듈 하나씩). */
  count: number;
  /** 행 채널마다 `depth#index top..bottom (위모듈 | 아래모듈)`. */
  channels: ReadonlyArray<string>;
  /**
   * **행 채널을 지나야 하는 경로 끝 수** — 포트가 기둥 끝이라 세로 채널 벽을 직접 못 마주 보는 것.
   * 0이면 행 채널이 이 트리에 필요 없다.
   */
  needs: ReadonlyArray<string>;
}

/**
 * **면 깊이 — 좌석표 배정의 계측기**(`docs/auto-layout/module/module-planning.md §4.5`).
 *
 * 묻는 것은 둘이다. *"결함이 실물에서 발현하나"* 를 **수로** 답한다:
 *
 * ```
 * deepBelt / deepBeltOtherArm   둘째 깊이가 쓰이나, 그 팔이 얕은 줄과 다른가
 * netTrips                      **경보** — 포트 칸 다툼이 방출까지 갔다(결함 B)
 * ```
 *
 * `netTrips` 는 `emitModule` 의 두 안전망(`emitOutputLinks` · `emitInputLinks` 의 ⓕ 검사)이다. 그 줄들은 스스로
 * *"구성상 발생 안 함"* 이라 적고 있고, **발동은 곧 그 구성 논증이 틀렸다는 증거**다
 * (`module-planning.md` §5: *"착수 시점은 안전망이 실제로 발동할 때다"*).
 *
 * 다른 계수기와 같은 규약 — **관측만 한다.** 계산도 분기도 반환값도 안 바뀐다.
 */
export interface FaceDepthCounters {
  /** 옆면(W/E)에 앉은 배정 수 — 아래 셋의 모수. gap(N/S)은 깊이 개념이 없어 안 센다. */
  assignments: number;
  /** 그중 그 면의 **깊이 후보가 둘 이상**이던 것 — 조건 ①이 서나. */
  multiDepthFace: number;
  /** 그중 **가장 얕은 후보가 아닌** 깊이에 앉은 것 — 조건 ②가 서나(계획서의 `B수`). */
  deepBelt: number;
  /**
   * `deepBelt` 중 그 깊이의 팔 처리량이 가장 얕은 줄과 **다른** 것.
   *
   * **뜻이 Step 2 에서 뒤집혔다.** 예전엔 이 수가 곧 결함 A 였다 — 팔 개수를 얕은 줄
   * 기준으로 세 놓고 깊은 줄의 느린 팔을 앉혔으니, 갈리는 만큼 그 줄이 굶었다.
   * 지금은 [armsAt] 이 **그 깊이의 팔로 개수를 다시 세므로** 갈려도 맞는 값이고,
   * 이 수는 *"긴팔이 실제로 값을 하고 있다"* 는 관측치다.
   *
   * 결함 A 는 이제 **구성상 발생할 수 없다**(세는 곳과 앉는 곳이 같은 인서터를 본다).
   * 그래서 이 수를 경보로 읽지 않는다 — 경보는 [netTrips] 하나다.
   */
  deepBeltOtherArm: number;
  /** `emitModule` 의 *"구성상 발생 안 함"* 안전망이 발동한 횟수 (계획서의 `D수`). */
  netTrips: number;
  /**
   * **`ends` 가 거칠어서 잃은 관통 줄** — 기둥 끝을 못 받아 옆 포트로 저하했는데
   * **칸 장부(`LinkFaceContext.outside`)로는 자리가 있었던** 수.
   *
   * `ends` 의 낟알은 「면 × 끝」이라 한 줄이 N 을 잡으면 그 끝 바깥이 통째로 잠긴다.
   * 그런데 포트 칸은 **각자 자기 깊이**에 서므로 깊이가 다르면 안 부딪힌다 — 이 수가
   * 그 잃은 자리다(`tempPlanDocs/구간-밖-주행/` §3.4 값 ①).
   *
   * **실패가 아니라 저하**라 다른 어떤 수에도 안 나타난다. 0이면 이 트리에선 안 잃었다.
   */
  endsCoarse: number;
  /**
   * **두 장부가 어긋난 수 — 0이어야 한다.**
   *
   * `outside` 는 `ends` 보다 곱다. 그러니 `outside` 가 막는 것은 `ends` 도 이미 막았어야
   * 한다. 0이 아니면 **모델이 틀린 것**이다 — `ends` 가 못 보는 자리가 있다는 뜻.
   */
  endsDisagree: number;
  /**
   * **배정이 구간막힘을 만나 링크를 토막낸 횟수** — 옛 사다리의 `laddered`.
   *
   * 이제 쪼갬은 배정 **안에서** 일어난다([seatLinkEdge]) — 밖에서 `linkCache` 를 고치고
   * 트리를 다시 만들지 않는다. 그래도 이 수는 계속 봐야 한다: **0이면 못이 안 생겼다는
   * 뜻**이고, 그게 곧 순서 규칙(Step 6)이 값을 했다는 증거다.
   */
  splits: number;
  /**
   * **못 앉은 줄의 사유** — 사다리가 읽을 것을 사람도 읽게 찍는다(`DepthShortage`).
   *
   * *"깊이 부족"* 이 아니라 **막힌 행**이 담긴다. 그 행이 곧 자름의 경계이기 때문이다
   * (`docs/auto-layout/module/trunk-assignment.md` §2 — *못을 피해서*). 사다리가 아직 없으므로
   * 지금은 **관측뿐**이다.
   */
  shortages: ReadonlyArray<string>;
  /**
   * **링크가 앉으려면 무엇을 풀어야 하나** — 모듈을 눈금별로 센다([linkDepthNeed]).
   *
   * 오늘 코드는 `free` 밖에 못 한다(링크는 반대 면을 안 보고, `g` 를 주는 호출부가 없다).
   * **그래서 `free` 가 아닌 수가 곧 "오늘 통째로 실패하는 모듈 수"** 다.
   *
   * 이 수가 `tempPlanDocs/부분-링크/` 의 값이다 — 무엇을 자동으로 켤지(J14 손잡이 기본값)를
   * 정하려면 **어느 눈금이 실제로 필요한지**부터 봐야 한다. 판정 자체는 입력(`L`·`R`)만으로
   * 서므로, 성공한 배치만 세는 편향이 없다.
   */
  linkNeed: Readonly<Record<LinkDepthNeed, number>>;
  /**
   * **넘친 모듈의 이름과 눈금** — `모듈id:눈금`. 수만으로는 *어느 모듈을 고쳐야 하나*를
   * 못 묻는다(`shortages` 와 같은 이유다). `"free"` 는 안 싣는다 — 그게 대부분이라.
   */
  linkNeedWho: ReadonlyArray<string>;
}

/**
 * **레인 공유** — 벨트 한 줄에 두 품목을 좌/우 레인으로 실은 횟수
 * (`docs/factorio/belt-lane-semantics.md` · `tempPlanDocs/벨트-레인/`).
 *
 * **이 수가 그 계획의 값이다.** 기하를 만들기 전에 *"실물 트리에서 자격을 통과하는 쌍이
 * 몇이나 되나"* 를 먼저 세려고 둔다 — 0에 가까우면 뒤 단계를 지을 이유가 없다.
 */
export interface LaneShareCounters {
  /** 위/아래 형제에서 하나씩 고른 쌍 — **자격 판정 전**의 후보 수. */
  candidates: number;
  /** 그중 자격 넷을 통과해 실제로 한 물리 줄이 된 쌍. */
  pairs: number;
  /** 떨어진 쌍 — 사유는 거의 언제나 **양**이다(각자 ≤ 레인 용량). */
  rejected: number;
  /**
   * **배정이 되돌린 쌍** — `pairs` 는 *자격*을, 이건 *자리*를 잰다.
   *
   * 사유 둘은 **처방이 다르다.** `shape` 는 싣는 쪽(자식)이 두 줄을 같은 면·깊이·끝에
   * 못 세운 것이고, `seats` 는 집는 쪽(부모)이 한 벨트에 좌석을 다 못 얹은 것이다.
   * 합쳐 세면 어느 쪽을 고쳐야 하는지가 사라진다.
   */
  unshared: { shape: number; seats: number };
  /**
   * **셀까지 간 합류** — 방출이 실제로 첫 줄의 포트를 다시 쓴 횟수.
   *
   * **이 수만이 「아낀 물리 벨트」다.** `pairs` 는 자격을 통과한 수라 배정·방출에서
   * 얼마든지 되돌아간다(2026-09-04: 짝 3인데 납품은 하나만 줄었다).
   */
  merged: number;
}

const freshLaneShare = (): LaneShareCounters =>
  ({ candidates: 0, pairs: 0, rejected: 0, unshared: { shape: 0, seats: 0 }, merged: 0 });

const freshLinkNeed = (): Record<LinkDepthNeed, number> => ({
  "free": 0, "opposite-face": 0, "direct": 0, "depth-starved": 0,
});

const freshFaceDepths = (): FaceDepthCounters => ({
  assignments: 0, multiDepthFace: 0, deepBelt: 0, deepBeltOtherArm: 0, netTrips: 0, splits: 0,
  endsCoarse: 0, endsDisagree: 0,
  shortages: [], linkNeed: freshLinkNeed(), linkNeedWho: [],
});

/**
 * **벨트 흐름의 끝 칸** — [resolveBeltTermini](../autoLayout/execution/module/beltTerminus.ts)
 * 가 무엇을 골랐나.
 *
 * 세는 이유: 끝 칸의 기본값(머신 쪽으로 꺾기)은 벨트가 `d2` 일 때만 *"자기 좌석이라 언제나
 * 안전"* 하다. 긴팔이 열려 `d3` 이 쓰이기 시작하면 그 칸이 **남의 벨트**일 수 있다 —
 * `turned` 가 0 이 아니면 그 일이 실제로 일어나고 있다는 뜻이고, `underground` 는 세 방향이
 * 전부 막혀 종착까지 간 수다.
 */
export interface BeltTerminusCounters {
  /** 끝 칸 수(= 입력 줄이 깐 물리 벨트 수). */
  ends: number;
  /** 기본 방향(머신 쪽)이 남의 품목 벨트라 **다른 방향으로 돌린** 수. */
  turned: number;
  /** 세 방향이 다 막혀 **지하벨트 종착**을 세운 수. */
  underground: number;
  /**
   * 종착도 못 세워 **합류한 채로 남긴** 수 — 0 이 아니면 **지하벨트를 안 골랐다**는 뜻이고,
   * 그만큼 화면에 `belt-terminus-merge` 경고가 뜬다.
   */
  merged: number;
}

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
  /**
   * 반출 **배정**. 패킹까지 갔으면 채워진다 — 방출(`perimeter`)보다 한 단계 앞이라
   * 트리가 납품에서 거절돼도 남는다.
   */
  exitPlan: ExitPlanCounters | null;
  /** 채널 통합 장부. 패킹까지 갔으면 채워진다. */
  channelLedger: ChannelLedgerCounters | null;
  /** 행 채널. 패킹까지 갔으면 채워진다. */
  rowChannels: RowChannelCounters | null;
  /**
   * 면 깊이. **null 이 아니라 언제나 있다** — 0 이 유의미한 답이기 때문이다
   * (*"둘째 깊이가 한 번도 안 쓰였다"* 는 결함 A 가 도달 불가라는 뜻이다).
   */
  faceDepths: FaceDepthCounters;
  /**
   * 레인 공유. **null 이 아니라 언제나 있다** — 0 이 유의미한 답이기 때문이다
   * (*"자격을 통과하는 쌍이 한 건도 없다"* 는 그 기능을 지을 이유가 없다는 뜻이다).
   */
  laneShare: LaneShareCounters;
  /** 벨트 끝 칸. **null 이 아니라 언제나 있다** — 0 이 유의미한 답이다(위 주석). */
  beltTermini: BeltTerminusCounters;
}

const freshBeltTermini = (): BeltTerminusCounters => ({
  ends: 0, turned: 0, underground: 0, merged: 0,
});

const fresh = (): RunStats => ({
  startedAt: null, delivery: null, perimeter: null, exitPlan: null, channelLedger: null,
  rowChannels: null, beltForms: null,
  faceDepths: freshFaceDepths(), laneShare: freshLaneShare(), beltTermini: freshBeltTermini(),
});

let current: RunStats = fresh();

/** 실행 1회 시작 — `runModulePipeline` 진입에서 부른다. */
export function beginRunStats(): void {
  current = { ...fresh(), startedAt: Date.now() };
}

/** 레인 공유 짝짓기 결과 — `packModuleTree` 가 링크 캐시를 다 만든 뒤 한 번 부른다. */
export function recordLaneShareStats(c: Pick<LaneShareCounters, "candidates" | "pairs" | "rejected">): void {
  // **뒤 단계 계수기는 여기서 0 이 된다** — 짝짓기가 다시 돌았다는 건 새 패스라는 뜻이다.
  current.laneShare = { ...c, unshared: { shape: 0, seats: 0 }, merged: 0 };
}

/** 배정이 짝을 되돌렸다 — `planner/module/policy.seatLinkEdge` 가 도형·좌석을 못 세운 자리에서 부른다. */
export function recordLaneUnshare(why: "shape" | "seats"): void {
  current.laneShare.unshared[why] += 1;
}

/** 방출이 첫 줄의 포트를 다시 썼다 — **셀까지 간 합류**. `emitOutputLinks` 가 부른다. */
export function recordLaneMerge(): void {
  current.laneShare.merged += 1;
}

/**
 * 끝 칸 하나의 결말 — [resolveBeltTermini] 가 칸마다 한 번 부른다.
 * `kept` 는 오늘까지의 동작(머신 쪽)과 같은 답이 나온 경우다.
 */
export function recordBeltTerminus(outcome: "kept" | "turned" | "underground" | "merged"): void {
  current.beltTermini.ends += 1;
  if (outcome !== "kept") current.beltTermini[outcome] += 1;
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
 * 면 깊이 계수기를 **누적**한다 — 배정마다·안전망 발동마다 한 번. 준 항목만 더한다.
 * (배선 형태와 달리 낟알이 잘아서 `Partial` 을 받는다 — 방출은 `netTrips` 만 안다.)
 */
export function recordFaceDepthStats(c: Partial<FaceDepthCounters>): void {
  const cur = current.faceDepths;
  // **`splits` 가 이 목록에 없었다**(2026-09-06 발견) — 선언·초기화·보고는 다 있는데
  // 더하는 자리에만 빠져서 **언제나 0** 이었다. `쪼갬 0` 이 *"안 일어났다"* 가 아니라
  // *"안 세었다"* 였다는 뜻이라, 그 수를 관문으로 읽던 글이 거짓을 읽고 있었다.
  for (const k of
    ["assignments", "multiDepthFace", "deepBelt", "deepBeltOtherArm", "netTrips", "splits",
     "endsCoarse", "endsDisagree"] as const)
    cur[k] += c[k] ?? 0;
  // 사유는 더하는 게 아니라 잇는다. 트리가 크면 폭주하므로 앞의 것 몇 줄만 든다.
  if (c.shortages?.length) cur.shortages = [...cur.shortages, ...c.shortages].slice(0, 12);
  // 넘친 모듈 이름은 잇는다(사유와 같은 규약). 트리가 크면 폭주하므로 앞의 것 몇만.
  if (c.linkNeedWho?.length)
    cur.linkNeedWho = [...cur.linkNeedWho, ...c.linkNeedWho].slice(0, 12);
  // 눈금은 **모듈 수**라 더한다 — 준 눈금만.
  if (c.linkNeed) {
    const next = { ...cur.linkNeed };
    for (const k of Object.keys(next) as LinkDepthNeed[]) next[k] += c.linkNeed[k] ?? 0;
    cur.linkNeed = next;
  }
}

/**
 * 면 깊이 계수기만 비운다 — [resetBeltFormStats] 와 **같은 이유·같은 자리**다.
 * `packModuleTree` 의 1차(끝 선호 측정용) 모듈은 실제로 안 깔리므로 그것이 센 배정과
 * 안전망 발동은 버려야 한다. 안 버리면 모든 수가 두 배로 보인다.
 */
export function resetFaceDepthStats(): void {
  current.faceDepths = freshFaceDepths();
  current.beltTermini = freshBeltTermini(); // 끝 칸도 방출이 센다 — 같은 이유로 함께 비운다
}

export function recordRowChannelStats(c: RowChannelCounters): void {
  current.rowChannels = { count: c.count, channels: [...c.channels], needs: [...c.needs] };
}

/** 반출 배정 — `packModuleTree` 가 낸 `exitPlan` 을 그대로 옮긴다(관측만). */
export function recordExitPlanStats(c: ExitPlanCounters): void {
  current.exitPlan = {
    blocked: c.blocked.map((b) => ({ ...b })),
    demotions: c.demotions,
    contestedCells: c.contestedCells,
    noSideWayOut: c.noSideWayOut,
  };
}

/** 채널 통합 장부 — `packModuleTree` 가 낸 `channelGeometry.skips` 를 그대로 옮긴다(관측만). */
export function recordChannelLedgerStats(c: ChannelLedgerCounters): void {
  current.channelLedger = { skips: c.skips.map((s) => ({ ...s })) };
}

export function recordPerimeterStats(c: PerimeterCounters): void {
  current.perimeter = { relocated: c.relocated, skipped: c.skipped, skips: [...c.skips] };
}

/** 마지막 실행의 카운터. 읽기 전용 스냅샷(내부 배열까지 복사한다). */
export function readRunStats(): RunStats {
  return {
    startedAt: current.startedAt,
    laneShare: { ...current.laneShare },
    beltTermini: { ...current.beltTermini },
    beltForms: current.beltForms ? { ...current.beltForms } : null,
    delivery: current.delivery ? { ...current.delivery } : null,
    perimeter: current.perimeter
      ? { ...current.perimeter, skips: current.perimeter.skips.map((s) => ({ ...s })) }
      : null,
    exitPlan: current.exitPlan
      ? { ...current.exitPlan, blocked: current.exitPlan.blocked.map((b) => ({ ...b })) }
      : null,
    channelLedger: current.channelLedger
      ? { skips: current.channelLedger.skips.map((s) => ({ ...s })) }
      : null,
    rowChannels: current.rowChannels
      ? {
          ...current.rowChannels,
          channels: [...current.rowChannels.channels],
          needs: [...current.rowChannels.needs],
        }
      : null,
    faceDepths: {
      ...current.faceDepths,
      shortages: [...current.faceDepths.shortages],
      linkNeed: { ...current.faceDepths.linkNeed },
      linkNeedWho: [...current.faceDepths.linkNeedWho],
    },
  };
}
