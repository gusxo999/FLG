/**
 * 컨테이너 모델 — 자동 레이아웃 위저드 v2 의 핵심 추상화.
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md.
 *
 * 본 파일은 *타입 정의만* 포함한다. 실제 모듈 구현 (port 유추, 슬롯 수 계산,
 * 머신 배치, 외부 컨테이너 배치, 라우팅, 오케스트레이터) 은 후속 커밋에서
 * 별도 파일로 추가된다.
 */

import type { Direction, GridCell } from '../types/layout';
import type { LayoutIssue, LayoutSnapshot } from './layoutIssue';

// ─────────────────────────────────────────────────────────────────────────────
// §2. 컨테이너
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 컨테이너의 종류. 새 모델은 머신·무한상자·무한파이프를 단일 추상으로 다룬다.
 */
export type ContainerKind = 'machine' | 'infinity-chest' | 'infinity-pipe';

/**
 * 한 컨테이너 인스턴스 — 통합 단일 좌표계 안에서의 한 점 + 메타.
 *
 * 머신·무한상자·무한파이프 모두 처음부터 같은 좌표계를 공유한다.
 * `origin` 은 곧 최종 블루프린트 좌표다.
 */
export interface Container {
  /** 인스턴스 고유 id (ports 와 routings 의 cross-ref 키) */
  id: string;
  kind: ContainerKind;
  /** 게임데이터 entity name (e.g. "assembling-machine-2", "infinity-chest", "infinity-pipe") */
  entityName: string;
  /**
   * 좌상단 좌표 — *통합 좌표계* (단일 좌표계, 곧 최종 블루프린트 좌표).
   *
   * 머신은 내부 영역 안. 무한상자/무한파이프는 머신+내부 라우팅 bbox 의
   * **perimeter ring** (1셀 두께) 위. 라우팅 BFS 와 블루프린트 export 가 이
   * 좌표를 진실의 근원으로 사용한다.
   */
  origin: { x: number; y: number };
  /** footprint 폭/높이 (Entity.tile_width × tile_height) */
  size: { w: number; h: number };
  /**
   * 머신 회전(Factorio 16방향: 0=N, 4=E, 8=S, 12=W). 미지정=0.
   *
   * **아이템 전용 머신은 돌릴 이유가 없다** — 인서터는 어느 면에나 붙는다. 회전이 필요한 건
   * **유체**뿐이다: 유체 입구 칸이 프로토타입에 박혀 있어서, 기둥에서 그 면이 이웃 머신에
   * 막히면 파이프를 꽂을 자리가 아예 없다. 머신을 돌려 유체 입구가 노출된 면(W/E)을 보게 한다.
   * → docs/auto-layout-wizard.trunk-pipe.md §3
   *
   * footprint 는 회전해도 그대로 쓴다 — v1 은 **정사각형 머신만** 회전 대상이다(§5).
   */
  direction?: Direction;
  /**
   * 머신 컨테이너에 부속된 레시피. 무한상자/무한파이프는 undefined.
   */
  recipeName?: string;
  /**
   * 무한상자/무한파이프가 운반하는 내용물 (item 이름 또는 fluid 이름).
   * 머신은 undefined.
   *
   * 라우팅 시 port.kind 와 일치 여부 검사에 사용되고, 블루프린트 export 시
   * `infinity_settings.filters` (또는 fluid 필터) 의 값으로 들어간다.
   */
  content?: string;
  /**
   * 무한상자/무한파이프의 입출력 역할 — 머신은 undefined.
   *  - `input`  : 머신에 재료를 *공급* 하는 상자 (source). export 시 `at-least` 필터.
   *  - `output` : 머신의 산출물을 *회수* 하는 상자 (sink). export 시 `at-most 0` +
   *               remove_unfiltered_items.
   */
  role?: 'input' | 'output';
}

// ─────────────────────────────────────────────────────────────────────────────
// §2.2 ports
// ─────────────────────────────────────────────────────────────────────────────

/**
 * port 의 매개체 종류.
 *  - `item`        — 둘레 셀, 인서터로 닿는 후보 위치
 *  - `fluid:<name>` — fluid_boxes positions 가 정의하는 고정 셀 (특정 fluid 만 흐름)
 */
export type PortKind = 'item' | { fluid: string };

/**
 * port 가 컨테이너의 *어느 면* 에 붙어 있는지. 이 면 방향이 곧 인서터 / 파이프
 * 진입 방향이 된다. (회전은 미고려이므로 prototype 기본 회전 기준.)
 */
export type PortFace = 'N' | 'E' | 'S' | 'W';

/**
 * 한 컨테이너의 외부 통로 1개.
 *
 * - 좌표는 *컨테이너 origin 기준 절대 좌표가 아니라* 해당 영역 좌표계의
 *   절대 좌표다 (= 라우팅이 직접 사용 가능).
 * - item port 는 컨테이너 둘레의 셀 1칸이며 face 가 그 셀의 바깥 방향.
 * - fluid port 는 fluid_boxes[].connections[].positions 의 셀 1칸이며 face 는
 *   그 셀의 *바깥 방향* (= 파이프가 진입해야 하는 방향).
 */
export interface ContainerPort {
  /** 어느 컨테이너에 붙은 port 인지 */
  containerId: string;
  /** 절대 좌표 (해당 영역 좌표계) */
  cell: { x: number; y: number };
  face: PortFace;
  kind: PortKind;
}

// ─────────────────────────────────────────────────────────────────────────────
// §3. 영역 — 내부 영역 / 외부 영역
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 영역 식별자 — 통합 좌표계 안에서의 *역할 분류*. 좌표계는 단일이며 두
 * 영역이 같은 좌표를 공유한다.
 *
 *  - `internal` — 머신 + 내부 라우팅 (벨트/파이프/투입기). bbox 가 곧
 *    perimeter 의 기준이 된다.
 *  - `external` — 무한상자/무한파이프. internal bbox 의 1-cell perimeter
 *    ring 위에 배치된다.
 */
export type AreaKind = 'internal' | 'external';

/**
 * 한 영역의 상태 — 컨테이너 + placed cells + bbox. 좌표는 통합 좌표계.
 *
 * `internal` 영역: 머신 + 라우팅 셀만. ghost cell 없음.
 * `external` 영역: 외부 컨테이너(무한상자/무한파이프) 셀. 라우팅 occupancy 계산 시
 *   `internal` 과 합산된다. `bbox` 는 internal 기준 (perimeter 계산에 사용).
 */
export interface Area {
  kind: AreaKind;
  containers: Container[];
  /** 이 영역에 깔린 그리드 셀 (좌표는 통합 좌표계 절대 좌표) */
  placed: PlacedCell[];
  /** 점유 셀의 최소 외접 사각형. 비어있으면 undefined */
  bbox?: { x: number; y: number; w: number; h: number };
  /**
   * 이 영역에 깔린 지하 변형 페어 (지하파이프 / 지하벨트) 의 사이드 인덱스.
   *
   * 라우팅 Dijkstra 의 점프 edge 검증에 사용된다. 동일 `blockGroup` 의
   * 기존 corridor 와의 충돌만 검사 — pipe 는 모든 pipe-to-ground prototype 이
   * 단일 그룹(`"pipe-to-ground"`) 으로 묶이며, belt 는 prototype `entityName`
   * 자체가 그룹이라 다른 티어의 underground-belt 와는 독립.
   *
   * (placement-search §6 O2 — 지하 변형 우선 규칙의 검증 자료구조.)
   */
  undergroundCorridors: UndergroundCorridor[];
}

/**
 * 한 지하 변형 페어 (입구·출구 두 셀 + 사이 통과 셀들).
 *
 * - `axis === 'h'` → 수평 corridor. 모든 셀이 `y = line`. x ∈ `range`.
 * - `axis === 'v'` → 수직 corridor. 모든 셀이 `x = line`. y ∈ `range`.
 * - `range` 는 입구·출구의 좌표를 *포함* 한다 (`[min, max]`, `min ≤ max`).
 *   사이 통과 셀 = `range` 의 *열린 구간*.
 *
 * 차단 규칙 (Factorio 게임 동작 기준):
 *  - **pipe-to-ground**: prototype 무관 무조건 차단 → `blockGroup = "pipe-to-ground"` 고정.
 *  - **underground-belt**: 같은 prototype 만 차단 → `blockGroup = entityName`.
 *
 * 다른 `blockGroup` 의 corridor 끼리는 같은 직선 위에 있어도 간섭 없음.
 * 수직(다른 축) corridor 끼리는 어떤 group 이든 간섭 없음.
 */
export interface UndergroundCorridor {
  axis: 'h' | 'v';
  line: number;
  range: [number, number];
  blockGroup: string;
  kind: 'pipe' | 'belt';
}

/** 한 셀 = (좌표, GridCell). 영역의 placed 배열의 원소. */
export interface PlacedCell {
  x: number;
  y: number;
  cell: GridCell;
}

// ─────────────────────────────────────────────────────────────────────────────
// §4. 라우팅
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 운반체 종류 — 라우팅 형식의 분기 키.
 *
 * 한 (producer, consumer) 페어의 라우팅은 두 port 의 kind 가 일치할 때만
 * 가능하며, kind 에 따라 체인 형식이 갈린다:
 *  - item  : 컨테이너—투입기—벨트(가변길이 ≥ 1)—투입기—컨테이너
 *  - fluid : 컨테이너—파이프 + 지하파이프—컨테이너 (투입기 없음)
 */
export type RoutingKind = 'item' | 'fluid';

/**
 * 모듈 포트 하나가 **어떻게 산출됐는지** 기록 — 표시(ModuleInfoPanel)·진단 전용,
 * 라우팅/배치에 영향 없음. 좌표는 넣지 않는다(드래그·재배치로 stale). 좌표는 항상
 * 라우팅 끝점(현재값)에서 읽는다.
 *
 * 산출 3축(직교):
 *  - 면(side) = 토폴로지: planClusterPorts (B) 정책 — 출력→W(부모 쪽) 먼저 확정.
 *  - depth(레인) = 운반량: 수요(amount)↓ ↔ 슬롯 throughput↓ zip 매칭.
 *  - 끝(end) = 합성 정렬: packModuleTree 가 부모↔자식 포트 |Δy| 최소로 지정.
 */
export interface ModulePortMeta {
  /** 운반 품목. */
  item: string;
  /** planner 가 배정한 면. W=부모 쪽 우선/E=자식 쪽, N/S=노출 끝면(count=1 raw 입력 완화). */
  side: 'W' | 'E' | 'N' | 'S';
  /** 머신 면에서 바깥 칸 거리(레인). 2=근접(일반 인서터), 3=원거리(긴팔). */
  laneDepth: number;
  /** belt 를 모는 인서터 종류. */
  inserter?: 'normal' | 'long';
  /** craft당 수량 = 운반량 프록시(depth 매칭의 수요). */
  amount?: number;
  /** DOF-B 끝 선호 — 합성 단계가 부모↔자식 포트를 마주 보게 지정. min=위, max=아래. */
  endPreference?: 'min' | 'max';
}

export interface Routing {
  id: string;
  kind: RoutingKind;
  from: ContainerPort;
  to: ContainerPort;
  /** from 끝점이 모듈 포트일 때 그 산출 근거(디버그·표시용). */
  fromPortMeta?: ModulePortMeta;
  /** to 끝점이 모듈 포트일 때 그 산출 근거(디버그·표시용). */
  toPortMeta?: ModulePortMeta;
  /** 라우팅이 깐 셀들 (벨트·투입기·파이프·지하파이프). occupancy 갱신용 */
  placed: PlacedCell[];
  /**
   * 이 라우팅이 깐 지하 변형 페어들. `commitRouting` 이 area 의
   * `undergroundCorridors` 인덱스로 옮긴다. 점프가 없는 라우팅은 빈 배열.
   */
  corridors: UndergroundCorridor[];
}

// ─────────────────────────────────────────────────────────────────────────────
// §5. 모듈 시그니처
// ─────────────────────────────────────────────────────────────────────────────

/** 모듈 3a 출력 — 한 컨테이너 페어에 대한 그리디 port 매칭 */
export interface PortPair {
  producer: ContainerPort;
  consumer: ContainerPort;
}

/**
 * 라우팅 시도 결과. 실패 시 `kind` 가 'no-port-pair' 또는 'no-path' 이며
 * 오케스트레이터의 fallback (다른 port 시도, 그래도 실패면 후보 마킹) 트리거.
 */
export type RoutingAttempt =
  | { ok: true; routing: Routing }
  | { ok: false; reason: 'no-port-pair' | 'no-path'; tried: PortPair[] };

// ─────────────────────────────────────────────────────────────────────────────
// §7. 후보 트리 — Esc 중단 시에도 부분 결과로 보존
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 후보 트리 노드의 종류.
 *
 *  - `machine`   — A 단계 (머신 1개 배치 + 그 머신의 모든 입력 라우팅).
 *                  자식으로 분기점 노드를 가질 수 있음 (자식이 여러 명일 때).
 *  - `branch`    — 분기점 (자식 형제 순서 perm × 자식 위치 dir 의 한 조합).
 *                  자식으로 다음 머신 노드들 (자식 형제 순서 따라) 을 가짐.
 *  - `candidate` — leaf. 한 perm × dir 시퀀스가 끝까지 성공한 완성 블루프린트.
 *  - `failure`   — leaf. 그 시퀀스에서 라우팅 실패 등으로 좌초된 가지.
 */
export type CandidateNodeKind = 'machine' | 'branch' | 'candidate' | 'failure';

export interface CandidateNodeBase {
  id: string;
  kind: CandidateNodeKind;
  /** 자식 노드들. leaf 는 빈 배열 */
  children: CandidateNode[];
  /** UI 라벨 (예: "조립기-2 [기어휠] @ (5,5)", "perm=[톱니, 철판] dir=right") */
  label: string;
}

/** A 노드 — 한 머신 배치 + 그 입력 라우팅. */
export interface MachineNode extends CandidateNodeBase {
  kind: 'machine';
  /** 이 노드가 배치한 머신 */
  machine: Container;
  /** 이 머신의 입력에 대해 깔린 라우팅들 */
  routings: Routing[];
}

/** 분기점 노드 — 한 perm × dir 조합. */
export interface BranchNode extends CandidateNodeBase {
  kind: 'branch';
  /** 자식 형제 순서 (자식 머신 id 의 순열) */
  perm: string[];
  /** 자식 위치 — 부모 기준 'right' 또는 'down' */
  dir: 'right' | 'down';
}

/** 후보 leaf — 끝까지 성공한 완성 블루프린트. */
export interface CandidateLeaf extends CandidateNodeBase {
  kind: 'candidate';
  /** 통합된 internal area (placed cells, bbox 포함) */
  internal: Area;
  /** 통합 직전의 external area */
  external: Area;
  /** 이 후보의 모든 라우팅 (영역 통합 후 평탄화) */
  routings: Routing[];
  /** O1 점수 — 내부 영역 bbox 의 |W − H|. 작을수록 정사각형에 가까움 */
  squarenessPenalty: number;
  /**
   * 이 후보를 **만드는 동안** 나온 진단 로그(모듈 경로 전용) — 위저드 실행 시점이 아니라
   * **후보를 클릭할 때** 환경 정보와 함께 출력한다. 위저드가 계산 중 찍는 로그가 후보
   * 생성 시점(6번 버튼)과 적용 시점(후보 클릭)으로 흩어지던 것을 한 시점으로 모은다.
   * 모듈 경로가 아닌 후보(옛 경로)는 없음. `AUTO_LAYOUT_COORD_DUMP` 일 때만 채워진다.
   */
  moduleDiagnostics?: string[];
}

/** 실패 leaf — 라우팅 실패 / 모든 port 조합 소진 등. */
export interface FailureLeaf extends CandidateNodeBase {
  kind: 'failure';
  reason:
    | 'no-routing'        // 모든 port 조합 소진 (Q26)
    | 'no-machine-match'  // pickMachineForRecipe 실패
    | 'aborted';          // 사용자 Esc — 트리의 그 시점에서 중단
}

export type CandidateNode = MachineNode | BranchNode | CandidateLeaf | FailureLeaf;

/**
 * 트리 전체. 루트는 항상 최상위 머신 (= 타깃 레시피) 의 MachineNode.
 */
export interface CandidateTree {
  root: MachineNode;
  /** 평탄화된 성공 leaf — 사용자 노출용 */
  candidates: CandidateLeaf[];
  /** Esc 중단 여부 */
  aborted: boolean;
  /** 진행 통계 — UI 진행 표시용 */
  stats: {
    candidatesGenerated: number;
    failuresGenerated: number;
    deepestDepth: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §8. 사용자 인터페이스 후크
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 진행 UI 콜백 — 오케스트레이터가 phase 진입/완료 시점마다 호출.
 * `currentFunction` / `attempts` 는 새 모델 v2 의 phase-level 추적용 (선택).
 */
export type ProgressReporter = (snapshot: {
  depth: number;
  siblingIndex: number;
  siblingTotal: number;
  candidatesGenerated: number;
  failuresGenerated: number;
  /** 지금 실행 중인 wizard phase / 함수 이름 — UI 의 "처리 중" 표시 */
  currentFunction?: string;
  /** 누적 시도 횟수 — root branch + 손자 (perm × dir) attempt 의 합 */
  attempts?: number;
}) => void;

/**
 * 외부 포트 default 위치 — 코어 bbox 좌상단.
 * 사용자 드래그가 일어나기 전 알고리즘이 가정하는 기본값.
 */
export type ExternalPortDefault = 'top-left';

// ─────────────────────────────────────────────────────────────────────────────
// 모듈 함수 시그니처 (구현은 후속 커밋)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 모듈 3a — port 유추 (그리디).
 *
 * 입력: 두 컨테이너 + 운반 종류. 출력: 두 컨테이너의 port 페어.
 * 그리디: 두 컨테이너의 *상대 위치* 를 기준으로 가장 가까운 면의 port 를
 * 자동 선택. 라우팅이 실패하면 오케스트레이터가 다른 port 셀을 시도하며
 * 본 함수의 결정을 덮어쓸 수 있다 (routeFallback 의 enumeration 폴백).
 */
export type ResolvePortPair = (
  producer: Container,
  consumer: Container,
  kind: PortKind,
) => PortPair | null;

/**
 * 모듈 A — 머신 배치 (내부 영역).
 *
 * 부모 머신과 자식 머신의 상대 위치 (오른쪽 / 아래쪽) 를 받아 자식의 origin
 * 좌표를 결정. 부모와 *벨트 길이 ≥ 1* 만 확보하도록 인접 배치한다.
 *
 * 충돌 (다른 머신/라우팅 셀과 겹침) 발생 시 null 반환. 오케스트레이터가
 * 후보를 'no-routing' 등으로 마킹하고 다음 perm·dir 후보로 진행 (§7.4 ~ §7.5).
 *
 * 성공 시 `internal` 을 mutate 한다 (containers / placed / bbox 업데이트).
 * 실패 시 mutate 하지 않으므로 호출자는 롤백을 신경 쓸 필요가 없다.
 */
export type PlaceMachine = (
  parent: Container,
  child: Container,
  dir: 'right' | 'down',
  internal: Area,
) => Container | null;

/**
 * 모듈 4 — 라우팅.
 *
 * 두 port 사이의 운반체 체인을 BFS 로 깐다. item / fluid 분기, 지하 변형
 * 적용. 실패 시 RoutingAttempt 의 ok=false 로 반환.
 */
export type RoutePorts = (
  pair: PortPair,
  area: Area,
  options: {
    beltEntityName: string;
    inserterEntityName: string;
    pipeEntityName: string;
    undergroundPipeEntityName?: string;
    undergroundBeltEntityName?: string;
    /**
     * 지하파이프의 입출구 좌표 차이 한계 (= prototype `max_underground_distance`).
     * 사이 통과 셀 = `pipeMaxUndergroundDistance − 1`. undefined / 0 이면 점프 비활성.
     */
    pipeMaxUndergroundDistance?: number;
    /**
     * 지하벨트의 입출구 좌표 차이 한계 (= prototype `max_underground_distance`).
     * 사이 통과 셀 = `beltMaxUndergroundDistance − 1`. undefined / 0 이면 점프 비활성.
     */
    beltMaxUndergroundDistance?: number;
    /** placement-search O2 — 지하 변형으로 사이 셀 비울 수 있으면 우선 */
    preferUnderground: boolean;
  },
  extra?: Area,
) => RoutingAttempt;

/**
 * 오케스트레이터 — 진입점 시그니처. 진행 UI 콜백, AbortSignal 로 사용자 Esc
 * 중단을 받는다.
 */
export type RunContainerWizard = (
  input: ContainerWizardInput,
  hooks?: {
    onProgress?: ProgressReporter;
    signal?: AbortSignal;
  },
) => Promise<ContainerWizardResult>;

/**
 * 새 위저드 입력 — 기존 WizardInput (types.ts) 과 호환되는 필드 + 새 모델
 * 전용 필드를 합친다. 기존 위저드와 병행하기 위해 별도 타입으로 둔다.
 */
export interface ContainerWizardInput {
  targetRecipe: string;
  countMode: 'min' | { perTarget: number };
  externalIngredients: ReadonlySet<string>;
  /** item.name → 사용자가 고른 대체 제작법 이름. 비어 있으면 기본 제작법(itemToRecipe). */
  recipeOverrides?: Readonly<Record<string, string>>;
  selectedMachines: ReadonlyArray<string>;
  selectedInserters: ReadonlyArray<string>;
  selectedBelts: ReadonlyArray<string>;
  selectedUndergroundPipes: ReadonlyArray<string>;
  selectedUndergroundBelts: ReadonlyArray<string>;
  primaryBelt?: string;
  inserterOverrides?: Record<string, { throughput?: number; stackSize?: number }>;
  /** 외부 포트 default — 1차 구현은 'top-left' 만 지원 */
  externalPortsDefault?: ExternalPortDefault;
}

/** 새 위저드 결과 — 후보 트리 + 평탄화된 후보 배열. */
export interface ContainerWizardResult {
  ok: boolean;
  tree: CandidateTree;
  /** 부분 결과 여부 — Esc 중단으로 일부만 생성된 경우 true */
  partial: boolean;
  /**
   * **왜 안 됐나(또는 무엇이 아쉬운가)** — 실패면 `error` 들, 성공이어도 `warning` 이 있을 수 있다.
   * 단일 출처는 [layoutIssue](./layoutIssue.ts).
   */
  issues?: LayoutIssue[];
  /**
   * 실패를 **짚기 위한 그림**(모듈 사각형 + 납품 경로 선). 배치가 없을 때만, 그것도
   * `pack` 까지 갔을 때만 있다. **`CandidateLeaf` 가 아니다** — 그리기 전용이라
   * 배치 경로로 흘러갈 수 없다.
   */
  snapshot?: LayoutSnapshot;
}

// ─────────────────────────────────────────────────────────────────────────────
// §9. 영역 통합 (placement-search §3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 후보의 영역 통합 결과 — **레이아웃 좌표(F1) → 그리드 좌표(F2) 경계를 넘은 것**.
 *
 * 여기 담긴 것은 전부 **이미 그리드 좌표**다. 예전엔 `offset` 을 함께 실어 보내
 * *읽는 쪽이 매번 더하게* 했는데, 세 소비자 중 하나가 잊으면 그 하나만 조용히
 * 어긋났다(`LayoutIssue.cells` 가 실제로 그랬다 — 2026-08-05). 오프셋을 안 실으면
 * 더하는 것을 잊을 자리가 없다.
 */
export interface UnifyResult {
  /** 그리드 좌표로 옮겨진 leaf 전체 — 오버레이·정보 모달이 읽는다. */
  leaf: CandidateLeaf;
  /** 그리드 적용·블루프린트 export 입력. `leaf` 의 두 영역 placed 를 합친 것과 같다. */
  placed: PlacedCell[];
  /** Blueprint(내부) 영역 bbox — 머신+라우팅 셀만 포함. 렌더러의 내부/외부 경계선. */
  internalBbox: { x: number; y: number; w: number; h: number } | undefined;
  /** 전체 캔버스 bbox — ghost cell(외부 컨테이너) 포함 모든 placed cell 의 bbox.
   *  렌더러가 이 범위에서 internalBbox 바깥을 초록 외부 영역으로 칠한다. */
  canvasBbox: { x: number; y: number; w: number; h: number } | undefined;
}

