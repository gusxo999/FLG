/**
 * layoutIssue — **왜 배치가 안 됐나**를 구조화해 나르는 자료형.
 *
 * ## 왜 문자열이 아니라 자료형인가
 *
 * 예전엔 실패가 `[kind] detail` 한 줄이었다(`describeReject`). 사람이 읽을 순 있지만
 * 화면이 그걸로 할 수 있는 게 없다 — **어디가** 막혔는지, 사용자가 **무엇을 고쳐야**
 * 하는지가 문장 안에 녹아 있어서 코드가 못 꺼낸다.
 *
 * ## 부분 배치는 만들지 않는다
 *
 * 이 파일에는 [LayoutSnapshot] 이 있지만 그것은 **배치가 아니라 그림**이다.
 * `CandidateLeaf` 와 **타입이 달라** `unifyAreas`·`applyPlacedCells`·블루프린트 export 로
 * 흘러갈 수 없다 — 런타임 검사가 아니라 **구조적 보장**이다.
 *
 * 그 이유(2026-08-04 결정): *부분 성공의 존재 이유는 **어느 부분이 막혔는지 알아내기
 * 위한 것**이지, 부분 배치를 갖다 쓰기 위한 것이 아니다.* 구멍 난 배치를 내보내면 그것은
 * 이 저장소가 일관되게 거부해 온 것 — *"성공했다는데 어디로 지나가는지 아무도 모르는"*
 * 배치가 된다.
 */

/**
 * **무엇을 고쳐야 하나.** 관심사 축(module·link·channel·perimeter)에 `입력`·`게임데이터`
 * 둘을 더한 것이다 — 기하 축만으로는 *"위저드에서 고칠 것"* 과 *"데이터를 다시 뽑을 것"* 을
 * 담지 못한다.
 */
export type IssueScope =
  /** 위저드 선택이 없거나 맞지 않음 → 해당 단계로 돌아간다(`fixStep`). */
  | "입력"
  /** prototype 이 없거나 낡음 → 게임데이터 다시 import. */
  | "게임데이터"
  /** 클러스터 **안**에서 안 됨 → 머신·인서터·벨트 선택 조정. */
  | "모듈"
  /** 두 모듈의 벨트 **짝짓기**가 깨짐 → 예약 불변식 위반, 조사 대상. */
  | "링크"
  /** 모듈 **사이**를 못 이음 → 배치 형태 문제. */
  | "납품경로"
  /** 공유 통로에서 자리 경합 → 유체 다중화 한계. */
  | "채널"
  /** 상자를 외곽으로 못 뺌 → 모양만 나쁘고 물류는 정상. */
  | "반출경로";

/** 위저드 단계 — `fixStep` 이 가리키는 곳. `wizardStore.WizardStep` 의 부분집합. */
export type FixStep = "recipe" | "machine" | "inserter" | "belt" | "pipe";

export interface LayoutIssue {
  /** 카탈로그의 사유 키(예: `'non-square'`, `'fluid-unplannable'`). */
  code: string;
  scope: IssueScope;
  /**
   * `error` = 이것 때문에 배치가 없다. `warning` = 배치는 됐는데 모양이 나쁘다.
   * 반출 skip 만이 현재 유일한 `warning` 이다 — 물류 자체는 정상이라(회귀 0 설계)
   * 실패로 올릴 근거가 없다.
   */
  severity: "error" | "warning";
  /** 무엇을 나르다 실패했나. 해당 없으면 생략. */
  carrier?: "item" | "fluid";
  /**
   * **물러설 곳이 있었나.** 아이템 납품 경로는 계획이 막히면 dijkstra 로 내려간다.
   * 유체는 그 자리에서 죽는다(결정 D3: 계획 없이 탐색으로 때운 유체 경로를 안 남긴다).
   *
   * 이 필드가 *"유체를 관심사 축으로 빼지 않고도 유체의 차이를 담는"* 방법이다 —
   * 유체는 축이 아니라 **운반체 속성**이고, 축으로 빼면 진단이 위치(채널)를 잃는다.
   */
  recoverable: boolean;
  /** 사람이 읽을 한 줄. */
  detail: string;
  /** 어디에 붙는 문제인가 — 오버레이가 이걸로 대상을 찾는다. */
  target?: {
    moduleId?: string;
    deliveryKey?: string;
    channelIndex?: number;
    chestId?: string;
    /** 레시피 이름 — 배치 전(층 0·1) 실패는 모듈 id 가 아직 없다. */
    recipeName?: string;
  };
  /** 그리드에 찍을 칸(예: `pipe-merge-conflict` 의 충돌 좌표). */
  cells?: { x: number; y: number }[];
  /** 고치려면 어느 위저드 단계로 가야 하나. */
  fixStep?: FixStep;
}

/** 사람이 읽을 한 줄 — 콘솔 로그·요약 라벨용. */
export function describeIssue(i: LayoutIssue): string {
  return `[${i.code}] ${i.detail}`;
}

/** 배치를 막은 것만(경고 제외). */
export function errorsOf(issues: readonly LayoutIssue[]): LayoutIssue[] {
  return issues.filter((i) => i.severity === "error");
}

// ─────────────────────────────────────────────────────────────────────────────
// 스냅샷 — 실패를 **짚기 위한 그림**. 배치가 아니다.
// ─────────────────────────────────────────────────────────────────────────────

export interface SnapshotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SnapshotModule {
  id: string;
  recipeName?: string;
  entityName: string;
  machineCount: number;
  /** 절대 좌표(레이아웃 좌표계). */
  bbox: SnapshotRect;
  /** 이 모듈에 걸린 `error` issue 가 있으면 `problem`. */
  status: "ok" | "problem";
}

export interface SnapshotDelivery {
  key: string;
  item: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  ok: boolean;
}

/**
 * 실패를 화면에 짚기 위한 기하 — **그리기 전용**.
 *
 * `packModuleTree` 결과에서 **유도만** 한다. 같은 기하를 다시 계산하면 그것이 곧
 * "두 번째 렌더러"가 되고, 렌더러가 아니라 **데이터 층에서** 어긋난다는 점에서 더 나쁘다.
 */
export interface LayoutSnapshot {
  modules: SnapshotModule[];
  deliveries: SnapshotDelivery[];
  bbox: SnapshotRect;
}
