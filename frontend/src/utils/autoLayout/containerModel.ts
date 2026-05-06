/**
 * 컨테이너 모델 — 자동 레이아웃 위저드 v2 의 핵심 추상화.
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md.
 *
 * 본 파일은 *타입 정의만* 포함한다. 실제 모듈 구현 (port 유추, 슬롯 수 계산,
 * 머신 배치, 외부 컨테이너 배치, 라우팅, 오케스트레이터) 은 후속 커밋에서
 * 별도 파일로 추가된다.
 */

import type { GridCell } from '../../types/layout';

// ─────────────────────────────────────────────────────────────────────────────
// §2. 컨테이너
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 컨테이너의 종류. 새 모델은 머신·무한상자·무한파이프를 단일 추상으로 다룬다.
 */
export type ContainerKind = 'machine' | 'infinity-chest' | 'infinity-pipe';

/**
 * 한 컨테이너 인스턴스 — 좌표계 (내부 / 외부) 안에서의 한 점 + 메타.
 *
 * 좌표는 *해당 영역의 좌표계* 기준 (내부 영역의 머신이면 내부 좌표,
 * 외부 영역의 무한상자라면 외부 좌표). 두 좌표계의 통합은 알고리즘
 * 마지막 단계에서 일어난다 (placement-search §3).
 */
export interface Container {
  /** 인스턴스 고유 id (ports 와 routings 의 cross-ref 키) */
  id: string;
  kind: ContainerKind;
  /** 게임데이터 entity name (e.g. "assembling-machine-2", "infinity-chest", "infinity-pipe") */
  entityName: string;
  /** 좌상단 좌표 (해당 영역 좌표계) */
  origin: { x: number; y: number };
  /** footprint 폭/높이 (Entity.tile_width × tile_height) */
  size: { w: number; h: number };
  /**
   * 머신 컨테이너에 부속된 레시피. 무한상자/무한파이프는 undefined.
   * 외부 입력/출력 무한상자/파이프는 별도 `content` (item/fluid 이름) 으로
   * 의미를 갖지만 이는 port 의 kind 에 인코딩된다.
   */
  recipeName?: string;
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
 * 좌표계 식별자.
 *  - `internal` — 머신 + 내부 라우팅 (벨트/파이프/투입기) 이 사는 좌표계
 *  - `external` — 무한상자/무한파이프 + 외부 라우팅이 사는 좌표계
 *
 * 두 좌표계는 *별도* 로 진행되며, 알고리즘 마지막 단계에서 사용자 드래그를
 * 거쳐 통합된다.
 */
export type AreaKind = 'internal' | 'external';

/**
 * 한 영역의 상태 — 컨테이너 + placed cells + bbox.
 *
 * `placed` 는 그리드 적용 직전의 cell-array 이며, 라우팅이 추가됨에 따라
 * incremental 로 자라난다. bbox 는 packed cells 의 최소 외접 사각형.
 */
export interface Area {
  kind: AreaKind;
  containers: Container[];
  /** 이 영역에 깔린 그리드 셀 (좌표는 영역 좌표계 절대 좌표) */
  placed: PlacedCell[];
  /** 점유 셀의 최소 외접 사각형. 비어있으면 undefined */
  bbox?: { x: number; y: number; w: number; h: number };
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
 * 한 라우팅 인스턴스 — 두 port 사이를 잇는 운반체 체인.
 *
 * 라우팅 1개 = 컨테이너 1개 (placement-search Q19 a). 처리량이 부족해 한
 * 라우팅으로 못 채우면 컨테이너 *수* 를 늘려 별도 라우팅으로 분할한다.
 */
export interface Routing {
  id: string;
  kind: RoutingKind;
  from: ContainerPort;
  to: ContainerPort;
  /** 라우팅이 깐 셀들 (벨트·투입기·파이프·지하파이프). occupancy 갱신용 */
  placed: PlacedCell[];
  /** 어느 영역의 라우팅인지 — 영역 통합 후에는 'internal' 로 흡수됨 */
  area: AreaKind;
}

// ─────────────────────────────────────────────────────────────────────────────
// §5. 모듈 시그니처
// ─────────────────────────────────────────────────────────────────────────────

/** 모듈 3a 출력 — 한 컨테이너 페어에 대한 그리디 port 매칭 */
export interface PortPair {
  producer: ContainerPort;
  consumer: ContainerPort;
}

/** 모듈 3b 출력 — 한 머신의 컨테이너/라우팅 수 */
export interface ContainerCounts {
  /** 입력 ingredient 별 라우팅 개수 (= 외부 입력 무한상자 수) */
  inputContainers: Record<string, number>;
  /** 출력 product 별 라우팅 개수 (= 외부 출력 무한상자 수) */
  outputContainers: Record<string, number>;
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

/** 진행 UI 콜백 — 오케스트레이터가 후보 1개 생성/실패할 때마다 호출 */
export type ProgressReporter = (snapshot: {
  depth: number;
  siblingIndex: number;
  siblingTotal: number;
  candidatesGenerated: number;
  failuresGenerated: number;
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
 * 본 함수의 결정을 덮어쓸 수 있다 (placement-search §7.4 fallback).
 */
export type ResolvePortPair = (
  producer: Container,
  consumer: Container,
  kind: PortKind,
) => PortPair | null;

/**
 * 모듈 3b — 슬롯 수 계산.
 *
 * 한 머신에 필요한 입력/출력 컨테이너 수를 처리량으로 산정.
 * `ceil(throughput / belt 또는 pipe 처리량)`. (placement-search §4 / §12)
 *
 * `machineEntityName` 으로부터 `crafting_speed` 를 읽어 per-second 처리량을
 * 계산. 모듈/신호기 효과는 1차 구현에서 미반영 (base crafting_speed 만).
 */
export type ComputeContainerCounts = (
  recipeName: string,
  machineEntityName: string,
  beltThroughputPerSecond: number,
  pipeThroughputPerSecond: number,
) => ContainerCounts;

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
 * 모듈 B — 외부 컨테이너 배치 (외부 영역).
 *
 * 외부 입력/출력 무한상자/파이프를 외부 좌표계 (0,0) 부터 1×1 단위로 줄지어
 * 배치. 사용자 드래그가 통합 직전에 일어나면 그 결과로 위치가 덮어써진다.
 */
export type PlaceExternalContainer = (
  spec: { kind: 'infinity-chest' | 'infinity-pipe'; entityName: string; content: string },
  external: Area,
) => Container;

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
    /** placement-search O2 — 지하 변형으로 사이 셀 비울 수 있으면 우선 */
    preferUnderground: boolean;
  },
) => RoutingAttempt;

/**
 * 오케스트레이터 — A↔B 사이클 + 완전 탐색.
 *
 * placement-search §7 의 알고리즘 흐름 그대로. 진행 UI 콜백, AbortSignal
 * 로 사용자 Esc 중단을 받는다.
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
  selectedMachines: ReadonlyArray<string>;
  selectedInserters: ReadonlyArray<string>;
  selectedBelts: ReadonlyArray<string>;
  selectedUndergroundPipes: ReadonlyArray<string>;
  primaryInserter?: string;
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
}
