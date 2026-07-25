/**
 * 전략 S-LAYER — 계층화 DAG 레이아웃 + 채널 라우팅 (Sugiyama 프레임워크).
 *
 * 단일 출처: docs/auto-layout-wizard.s-layer-channel-reservation.md.
 *
 * 자동 배치의 **유일 전략**. `AutoLayoutContainerPanel` 이 `runLayeredWizard` 를
 * 직접 호출한다. (이전엔 완전탐색 S-EXH 와 토글 병행했으나 S-EXH 는 제거됨 —
 * 트렁크 병합·시각화는 본 모듈로 포팅 완료.)
 *
 * **핵심 아이디어:**
 *   - 레시피 깊이를 **레이어(열)** 로, 레이어 사이에 빈 **채널**을 두고 머신을
 *     tidy-tree 로 배치한다. 채널이 항상 비어 있어 라우팅이 구조적으로 보장되며,
 *     결정적 단일 후보를 O(V+E) 로 생성한다.
 *
 * **현재 범위 / follow-up:**
 *   - 채널 라우팅은 검증된 BFS 라우터(`routeWithFallback`)를 그대로 사용한다.
 *     채널 폭은 `channelPlanner` 의 left-edge 트랙 배정으로 동적 산정.
 *   - 트렁크 병합(MERGE): 병합 플래그 ON 이면 자식 클러스터 출력은
 *     `tryMergeClusterOutput`(단일 collect 트렁크), 외부 입출력은
 *     `wrapExternalsWithMerge` 로 묶는다. OFF 면 1:1 perimeter wrap.
 *   - 시각화: `traceLayeredPath` 가 본 패스를 레코더 ON 으로 재실행해 phase 별
 *     스냅샷을 수집한다 (모달 재생용).
 *   - 레이어 내 정렬은 tidy-tree 로 충분 — barycenter 교차 최소화는 follow-up.
 */

import { useGameDataStore, type Entity } from "../../store/gameDataStore";
import type {
  Area,
  AreaSnapshot,
  CandidateLeaf,
  CandidateTraceResult,
  CandidateTree,
  Container,
  ContainerWizardInput,
  ContainerWizardResult,
  MachineNode,
  PendingConnection,
  PortKind,
  ProgressReporter,
  Routing,
  RunContainerWizard,
  TraceRouting,
  TraceStep,
} from "./containerModel";
import type { RecipeTreeNode } from "./types";
import {
  assignMinimumCounts,
  assignThroughputCounts,
  expandRecipeTree,
  perMachineItemsPerSec,
} from "./recipeTree";
import {
  makeEmptyArea,
  makeMachinePicker,
  makeMachineParamsLookup,
} from "./wizardUtils";
import { commitContainer } from "./machinePlacer";
import { commitRouting } from "./containerRouting";
import { placeExternalContainer } from "./externalPlacer";
import { AUTO_LAYOUT_COORD_DUMP, AUTO_LAYOUT_MODULE_PIPELINE } from "./debugFlags";
import { inserterReach } from "./inserterThroughput";
import { tryRunModulePipeline, type RejectReason } from "./planner/moduleWizard";
import { makeBuildSpec } from "./buildSpec";

// ─────────────────────────────────────────────────────────────────────────────
// 레이아웃 상수 — 문서 §4 (채널 폭) / §5 (트랙)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 채널 폭의 **하한** (아이템 체인 투입기+벨트+투입기 최소 3). 실제 폭은
 * left-edge 트랙 수로 채널마다 동적으로 정한다 (`channelPlanner`, 문서 §4·§5).
 */
const CHANNEL_MIN = 3;

// 클러스터 내부 세로 간격(ROW_GAP)은 clusterLayout.ts 가 소유한다(형태 결정의 일부).

/** 서로 다른 부모의 부분트리(형제 블록) 사이 세로 여백. */
const SUBTREE_GAP = 3;

// ─────────────────────────────────────────────────────────────────────────────
// id 카운터 — 모듈 스코프 (S-EXH 와 별개)
// ─────────────────────────────────────────────────────────────────────────────

let layeredIdCounter = 0;
const nextId = (prefix: string): string => {
  layeredIdCounter += 1;
  return `${prefix}-L${layeredIdCounter}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// 노드 메타 — 레이아웃 계산용
// ─────────────────────────────────────────────────────────────────────────────

interface NodeMeta {
  entityName: string;
  /** 머신 footprint */
  w: number;
  h: number;
  /** 이 노드의 머신 대수 (machineCount, 최소 1) */
  count: number;
  /** 루트로부터의 깊이 = 레이어/열 인덱스 */
  depth: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

export const runLayeredWizard: RunContainerWizard = async (
  input: ContainerWizardInput,
  hooks?: {
    onProgress?: ProgressReporter;
    signal?: AbortSignal;
  },
): Promise<ContainerWizardResult> => {
  const { recipeMap, itemToRecipe, entityMap } = useGameDataStore.getState();
  // 협조적 양보(cooperative yield): 실제 실행(hooks 존재) 시에만 phase/루프 경계에서
  // 이벤트 루프에 제어를 돌려준다 — 무거운 라우팅 중에도 UI 가 멈추지 않고(10초 freeze
  // 방지) 진행 표시·중단·"오래 걸림" 모달이 동작하도록. 트레이스(hooks 없음)는 양보 없이
  // 동기 재현(레코더 단계 순서 보존).
  const emit = makeEmitter(hooks?.onProgress, hooks ? { yieldEveryMs: 40 } : undefined);
  const _wizT0 = typeof performance !== "undefined" ? performance.now() : Date.now();

  // '간단한 레시피' = I/O 에 유체가 없는 아이템 전용 레시피. 이런 클러스터는 W/E 옆면만
  // 쓰므로 머신을 밀착(rowGap=0)시킨다 — N/S gap 으로 트렁크가 파고들 공간을 없애 기둥
  // 사이 침투를 막는다. 멀티싱크 버스 적격 게이트도 이 판정을 공유한다.
  const isSimpleRecipe = (recipeName: string): boolean => {
    const r = recipeMap.get(recipeName);
    if (!r) return false;
    return ![...r.ingredients, ...r.products].some((p) => p.type === "fluid");
  };

  // 1. 레시피 트리 + 머신 수 산정 (S-EXH 와 동일 모듈 재사용).
  await emit("expandRecipeTree");
  // recipeOverrides 를 반드시 함께 넘긴다 — 빠뜨리면 실행이 사용자의 **대체 제작법 선택을
  // 무시**하고 첫 매칭으로 트리를 짓는다(= 화면에 보이는 트리와 실제 배치되는 트리가 달라진다).
  // 2026-07-16 실측에서 발견: water 를 kr-water-from-atmosphere 로 골랐는데 실행은 첫 매칭인
  // se-melting-water-ice 로 펼쳐 원유 체인(basic-oil-processing)을 끌고 와 실패했다.
  const expanded = expandRecipeTree(
    input.targetRecipe,
    recipeMap,
    itemToRecipe,
    input.externalIngredients,
    new Map(Object.entries(input.recipeOverrides ?? {})),
  );
  const tree =
    input.countMode === "min"
      ? assignMinimumCounts(expanded)
      : assignThroughputCounts(
          expanded,
          input.countMode.perTarget,
          recipeMap,
          // 인서터를 함께 넘겨 **굶주림 보상**을 켠다 — 팔을 다 앉힐 자리가 없는 머신은
          // 그만큼만 돌므로(speedFraction), 부족분만큼 머신이 더 놓인다.
          makeMachineParamsLookup(input.selectedMachines, makeBuildSpec(input).inserters),
        );

  if (!tree.recipeName) {
    return failureResult("타깃 레시피를 찾을 수 없습니다");
  }

  const pickMachine = makeMachinePicker(input);

  // 2. 메타 수집 + 부모 맵 — DFS. 머신 매칭 실패 노드가 있으면 즉시 실패 반환.
  const metas = new Map<RecipeTreeNode, NodeMeta>();
  const parentOf = new Map<RecipeTreeNode, RecipeTreeNode | null>();
  const order: RecipeTreeNode[] = []; // DFS pre-order — 레이어 내 안정 정렬에 사용
  let maxDepth = 0;
  let failure: string | null = null;

  const collect = (node: RecipeTreeNode, depth: number, parent: RecipeTreeNode | null): void => {
    if (node.external || !node.recipeName) return;
    const ent = pickMachine(node.recipeName);
    if (!ent) {
      failure ??= `${node.recipeName} 카테고리 머신 없음`;
      return;
    }
    const entity = entityMap.get(ent.name);
    if (!entity) {
      failure ??= `머신 엔티티 없음: ${ent.name}`;
      return;
    }
    metas.set(node, {
      entityName: ent.name,
      w: entity.tile_width,
      h: entity.tile_height,
      count: Math.max(1, node.machineCount),
      depth,
    });
    parentOf.set(node, parent);
    order.push(node);
    maxDepth = Math.max(maxDepth, depth);
    for (const child of node.children) collect(child, depth + 1, node);
  };
  collect(tree, 0, null);

  if (!metas.has(tree) || failure) {
    return failureResult(failure ?? "루트 머신 배치 불가");
  }

  // 2a. 모듈 파이프라인(조각 5, 하이브리드) — 플래그 ON + 트리 전부 simple-item 일 때만
  //     generateModule 자족 경로로 후보를 만든다(루트·자식 동일 생성 → child==root).
  //     적격 아니면(유체·미탭·홉 실패) null → fallbackToLegacyPath 로 폴백(회귀 0).
  if (AUTO_LAYOUT_MODULE_PIPELINE) {
    const moduleLeaf = tryRunModulePipeline({ input, metas, parentOf, order, makeId: nextId });
    if (moduleLeaf) {
      await emit("완료(module)", { internal: moduleLeaf.internal, external: moduleLeaf.external });
      const rootRep =
        moduleLeaf.internal.containers.find(
          (c) => c.kind === "machine" && c.recipeName === tree.recipeName,
        ) ?? moduleLeaf.internal.containers[0];
      const moduleTree: CandidateTree = {
        root: {
          id: nextId("root"),
          kind: "machine",
          machine: rootRep,
          routings: [],
          children: [moduleLeaf],
          label: `S-LAYER(module) root [${tree.recipeName}]`,
        },
        candidates: [moduleLeaf],
        aborted: hooks?.signal?.aborted ?? false,
        stats: { candidatesGenerated: 1, failuresGenerated: 0, deepestDepth: maxDepth },
      };
      return { ok: true, tree: moduleTree, partial: moduleTree.aborted };
    }
    // 모듈 경로 실패 → fallback 스텁 반환. (유체·미탭·홉 실패 등)
    return fallbackToLegacyPath();
  }
};

/**
 * P3-2 fallback 스텁 — 모듈 경로 실패 시 호출.
 * 옛 S-LAYER 경로는 삭제됨. 실패 신호 반환.
 */
function fallbackToLegacyPath(): ContainerWizardResult {
  return failureResult("자동배치 실패(fallback) — 모듈 경로가 처리할 수 없는 케이스 (유체/회전/비정사각형 등)");
}

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * onProgress 콜백을 phase 이름으로 호출하고, 시각화 레코더가 활성이면 그 시점의
 * 영역 스냅샷을 한 단계로 기록한다. `areas` 가 주어진 phase 만 단계가 된다
 * (영역이 아직 없는 초기 phase 는 진행 보고만) — S-EXH `reportFn` 패턴 미러.
 */
function makeEmitter(
  cb: ProgressReporter | undefined,
  opts?: { yieldEveryMs: number },
): (name: string, areas?: { internal: Area; external: Area }, depth?: number) => Promise<void> {
  // 누적 단계 수 — 진행 UI 가 "멈춤"이 아니라 실제 진행 중임을 보이도록 단조 증가.
  let attempts = 0;
  // 마지막으로 이벤트 루프에 양보한 시각(ms). 양보 주기 throttle 기준.
  let lastYield = typeof performance !== "undefined" ? performance.now() : Date.now();
  return async (name, areas, depth = 0) => {
    attempts += 1;
    cb?.({
      depth,
      siblingIndex: 1,
      siblingTotal: 1,
      candidatesGenerated: name === "완료" ? 1 : 0,
      failuresGenerated: 0,
      currentFunction: name,
      attempts,
    });
    if (layeredRecorder && areas) {
      layeredRecorder.steps.push({
        order: layeredRecorder.steps.length,
        functionName: name,
        // depth 0 = phase 그룹 헤더, depth 1 = 그 phase 의 루프 단위 자식 단계.
        // 호출 트리 사이드바가 callDepth 시퀀스로 중첩을 만든다(buildFunctionTree).
        callDepth: depth,
        snapshot: captureSnapshot(areas.internal, areas.external),
      });
    }
    // 협조적 양보 — yieldEveryMs 가 지정된 실제 실행에서만, 마지막 양보 후 충분히
    // 시간이 흘렀을 때 매크로태스크 1회를 끼워 넣어 브라우저가 리페인트하고 React
    // 상태(진행/모달)를 반영하며 abort 신호를 받을 수 있게 한다.
    if (opts) {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - lastYield >= opts.yieldEveryMs) {
        await new Promise<void>((r) => setTimeout(r, 0));
        lastYield = typeof performance !== "undefined" ? performance.now() : Date.now();
      }
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 시각화 트레이스 — 결정적 단일 패스(S-LAYER)의 생성 과정을 phase 단계로 재현.
// S-EXH 의 `traceCandidatePath`(perm×dir 재실행) 대체. 여기선 perm/dir 가 없어
// `runLayeredWizard` 를 레코더 ON 으로 1회 실행하면 곧 그 후보의 생성 과정이다.
// ─────────────────────────────────────────────────────────────────────────────

interface LayeredRecorder {
  steps: TraceStep[];
}

let layeredRecorder: LayeredRecorder | null = null;

/** 영역 스냅샷 — internal/external 의 복제본 (raw layout 좌표). */
function captureSnapshot(internal: Area, external: Area): AreaSnapshot {
  return { internal: cloneArea(internal), external: cloneArea(external) };
}

/** 모든 단계의 placed 셀(internal+external) 합집합 bbox — 카메라 고정용. */
function unionStepsBbox(
  steps: TraceStep[],
): { x: number; y: number; w: number; h: number } | undefined {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const s of steps) {
    for (const area of [s.snapshot.internal, s.snapshot.external]) {
      for (const p of area.placed) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x + 1 > maxX) maxX = p.x + 1;
        if (p.y + 1 > maxY) maxY = p.y + 1;
      }
    }
  }
  if (!isFinite(minX)) return undefined;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * 트레이스 직렬화 락 — `layeredRecorder` 가 모듈 전역이라 동시 실행 시 서로를
 * 덮어쓴다(React StrictMode 이중 effect 등). 이전 트레이스가 끝날 때까지 기다려
 * 한 번에 하나만 실행한다.
 */
let layeredTraceLock: Promise<void> = Promise.resolve();

/**
 * S-LAYER 한 패스의 생성 과정을 단계로 재현. `runLayeredWizard` 를 레코더 ON 으로
 * 1회 실행해 phase 별 영역 스냅샷을 수집하고, 최종 후보의 라우팅 연결 목록과 카메라
 * bbox 를 함께 반환한다. 시각화 모달이 이 단계들을 0.5초 간격으로 재생한다.
 */
export async function traceLayeredPath(
  input: ContainerWizardInput,
): Promise<CandidateTraceResult> {
  const prevLock = layeredTraceLock;
  let release!: () => void;
  layeredTraceLock = new Promise<void>((r) => (release = r));
  await prevLock;

  const rec: LayeredRecorder = { steps: [] };
  try {
    layeredRecorder = rec;
    let result: ContainerWizardResult;
    try {
      result = await runLayeredWizard(input);
    } finally {
      if (layeredRecorder === rec) layeredRecorder = null;
    }

    const leaf = result.tree.candidates[0];
    const routings: TraceRouting[] = leaf
      ? leaf.routings.map((r) => ({
          fromId: r.from.containerId,
          toId: r.to.containerId,
          fluid: r.from.kind !== "item",
        }))
      : [];

    return {
      steps: rec.steps,
      routings,
      bbox: unionStepsBbox(rec.steps),
      failed: !result.ok,
    };
  } finally {
    release();
  }
}

function failureResult(detail: string): ContainerWizardResult {
  const dummy: Container = {
    id: "m-layered-failure",
    kind: "machine",
    entityName: "unknown",
    origin: { x: 0, y: 0 },
    size: { w: 1, h: 1 },
  };
  const root: MachineNode = {
    id: nextId("root"),
    kind: "machine",
    machine: dummy,
    routings: [],
    children: [
      {
        id: nextId("f"),
        kind: "failure",
        reason: "no-machine-match",
        children: [],
        label: `S-LAYER 실패: ${detail}`,
      },
    ],
    label: "S-LAYER (실패)",
  };
  return {
    ok: false,
    tree: {
      root,
      candidates: [],
      aborted: false,
      stats: { candidatesGenerated: 0, failuresGenerated: 1, deepestDepth: 0 },
    },
    partial: false,
  };
}
