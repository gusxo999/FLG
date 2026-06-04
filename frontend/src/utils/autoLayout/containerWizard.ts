/**
 * 오케스트레이터 — A↔B 사이클 + 완전 탐색.
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §7 / §8 / Q11 / Q20 / Q26 / Q28.
 *
 * 컨테이너 모델 v2 의 진입점. 새 위저드 입력 (`ContainerWizardInput`) 을
 * 받아 후보 트리 (`CandidateTree`) 를 생성한다.
 *
 * **현재 동작 범위:**
 *   - 임의 깊이의 레시피 트리 — DFS 재귀로 모든 비-external 노드를 배치.
 *   - 자식 형제 순서 (n!) × 자식 위치 ('right' | 'down') = **루트 레벨에서 완전 탐색**.
 *   - 내부 레벨에서는 *first-success 커밋* — 자식의 (perm × dir) 도 enumerate 하지만
 *     첫 성공한 조합만 후보 상태로 commit.
 *   - 외부 입력 IO — 사이클 안에서 처리 (placement-search §7.1). 한 머신의
 *     외부 ingredient 마다 무한상자/파이프 1개씩 (= ingredient × consumer 분리,
 *     placement-search §4 Q19 / Q3 결정) 추가하고 그 머신과 라우팅.
 *   - 외부 출력 IO — 루트 머신의 모든 product 마다 무한상자/파이프 1개씩,
 *     루트 → 무한상자 라우팅.
 *
 * **follow-up (별도 커밋):**
 *   - 내부 레벨까지 *완전한 cross-product 후보* 생성 (현재는 first-success)
 *   - 사용자 드래그 후 외부 컨테이너 위치 변경 + 라우팅 재계산
 *   - 라우팅 fallback 의 다른 port 셀 시도는 이미 routeWithFallback 가 처리
 *   - 처리량 기반 컨테이너 분할 (`computeContainerCounts` 활용)
 */

import { useGameDataStore, type Entity } from "../../store/gameDataStore";
import type {
  Area,
  AreaSnapshot,
  BranchNode,
  CandidateLeaf,
  CandidateNode,
  CandidateTree,
  Container,
  ContainerWizardInput,
  ContainerWizardResult,
  FailureLeaf,
  MachineNode,
  PendingConnection,
  PortKind,
  ProgressReporter,
  Routing,
  RunContainerWizard,
  TraceStep,
  TraceRouting,
  CandidateTraceResult,
} from "./containerModel";
import { wrapExternalsAroundPerimeter } from "./areaUnification";
import {
  wrapExternalsWithMerge,
  AUTO_LAYOUT_MERGE_BOXES,
  DEFAULT_MERGE_CONFIG,
  type MergeConfig,
} from "./externalMergePass";
import { commitRouting } from "./containerRouting";
import { placeExternalContainer } from "./externalPlacer";
import {
  commitContainer,
  placeMachine,
  placeRootMachine,
} from "./machinePlacer";
import { routeWithFallback, type RouteOptions } from "./routeFallback";
import { runSpringRelaxation } from "./springPlacer";
import { DEFAULT_SPRING_CONFIG } from "./clusterModel";
import {
  expandRecipeTree,
  assignMinimumCounts,
  assignThroughputCounts,
} from "./recipeTree";
import type { RecipeTreeNode } from "./types";
import {
  cloneArea,
  collectRoutingsFromTree,
  commitAreaInPlace,
  labelFor,
  makeMachinePicker,
  makeMachineParamsLookup,
  makeEmptyArea,
  permutations,
} from "./wizardUtils";

let nodeIdCounter = 0;
const nextNodeId = (prefix: string): string => {
  nodeIdCounter += 1;
  return `${prefix}-${nodeIdCounter}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// 진행 상태 (모듈 스코프) — wizard 한 인스턴스 = 한 진행 상태 전제.
// nodeIdCounter 가 이미 모듈 스코프인 것과 같은 가정. UI 가 phase 별 진입을
// 실시간 표시할 수 있도록 emit + maybeYield (16ms throttle) 를 함께 제공.
// ─────────────────────────────────────────────────────────────────────────────

const wizardProgress = {
  depth: 0,
  siblingIndex: 1,
  siblingTotal: 1,
  candidatesGenerated: 0,
  failuresGenerated: 0,
  attempts: 0,
  callback: null as ProgressReporter | null,
  lastYieldAt: 0,
};

function resetProgress(cb: ProgressReporter | undefined): void {
  wizardProgress.depth = 0;
  wizardProgress.siblingIndex = 1;
  wizardProgress.siblingTotal = 1;
  wizardProgress.candidatesGenerated = 0;
  wizardProgress.failuresGenerated = 0;
  wizardProgress.attempts = 0;
  wizardProgress.callback = cb ?? null;
  wizardProgress.lastYieldAt = 0;
}

function emitProgress(currentFunction: string): void {
  wizardProgress.callback?.({
    depth: wizardProgress.depth,
    siblingIndex: wizardProgress.siblingIndex,
    siblingTotal: wizardProgress.siblingTotal,
    candidatesGenerated: wizardProgress.candidatesGenerated,
    failuresGenerated: wizardProgress.failuresGenerated,
    currentFunction,
    attempts: wizardProgress.attempts,
  });
}

/**
 * macrotask 양보 — React batch flush + paint 를 위해 setTimeout 0.
 * 16ms throttle 로 알고리즘 비용 최소화 (~60fps).
 */
async function maybeYield(): Promise<void> {
  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now - wizardProgress.lastYieldAt >= 16) {
    wizardProgress.lastYieldAt = now;
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 시각화 레코더 (모듈 스코프) — `traceCandidatePath` 가 활성화하면 각 reportFn
// 진입마다 (함수 이름 + 호출 깊이 + 영역 스냅샷) 을 한 단계로 기록한다.
// 평소엔 null 이라 runContainerWizard 의 성능/동작에 영향을 주지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

interface TraceRecorder {
  steps: TraceStep[];
  /** recurseMachine 재귀 깊이 — 호출 트리 중첩 구성용 */
  callDepth: number;
}

let traceRecorder: TraceRecorder | null = null;

/**
 * emit + maybeYield 한 번에 — phase 진입 지점에서 호출.
 *
 * `areas` 가 주어지고 레코더가 활성이면 그 시점의 스냅샷을 한 단계로 기록한다.
 * (areas 미전달 = 트레이스 대상 아님 → 기록 생략.)
 */
async function reportFn(
  name: string,
  areas?: { internal: Area; external: Area },
): Promise<void> {
  emitProgress(name);
  if (traceRecorder && areas) {
    traceRecorder.steps.push({
      order: traceRecorder.steps.length,
      functionName: name,
      callDepth: traceRecorder.callDepth,
      snapshot: captureSnapshot(areas.internal, areas.external),
    });
  }
  await maybeYield();
}

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

export const runContainerWizard: RunContainerWizard = async (
  input: ContainerWizardInput,
  hooks?: {
    onProgress?: ProgressReporter;
    signal?: AbortSignal;
  },
): Promise<ContainerWizardResult> => {
  resetProgress(hooks?.onProgress);
  const { recipeMap, itemToRecipe } = useGameDataStore.getState();

  // 라우팅 옵션 갱신 — 사용자가 선택한 underground entity 들의
  // max_underground_distance 를 lookup 해 점프 활성 여부를 결정.
  ROUTING_OPTIONS = buildRoutingOptions(input);

  // 공유 무한상자 병합 설정 — 입력에 명시되면 우선, 없으면 모듈 토글.
  MERGE_CONFIG = {
    ...DEFAULT_MERGE_CONFIG,
    enabled: input.mergeSupplyBoxes ?? AUTO_LAYOUT_MERGE_BOXES,
  };

  // 1. 레시피 트리 펼침 + 머신 수 산정.
  //    countMode 'min' → 노드마다 1대 / { perTarget } → 루트 perTarget 개/초 처리량 기준 비례 배정.
  await reportFn("expandRecipeTree");
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
          makeMachineParamsLookup(input.selectedMachines),
        );

  if (!tree.recipeName) {
    return failureResult("no-machine-match", "target recipe not found");
  }

  const pickMachine = makeMachinePicker(input);
  const rootMachineEntity = pickMachine(tree.recipeName);
  if (!rootMachineEntity) {
    return failureResult(
      "no-machine-match",
      `${tree.recipeName} 카테고리 머신 없음`,
    );
  }

  const rootContainer = makeMachineContainer(tree, rootMachineEntity.name);
  const rootNode = makeMachineNode(rootContainer, [], labelFor(rootContainer));

  const directChildren = tree.children.filter(
    (c) => !c.external && c.recipeName,
  );

  let aborted = false;

  if (directChildren.length === 0) {
    // depth 0 — root 만.
    wizardProgress.depth = 0;
    wizardProgress.siblingIndex = 1;
    wizardProgress.siblingTotal = 1;
    wizardProgress.attempts += 1;
    await reportFn("buildSingleAttempt [depth-0]");
    const candidateOrFailure = await buildSingleAttempt(
      tree,
      rootContainer,
      [],
      "right",
      pickMachine,
      hooks?.signal,
    );
    if (candidateOrFailure.kind === "candidate") {
      rootNode.children.push(candidateOrFailure);
      wizardProgress.candidatesGenerated += 1;
    } else {
      rootNode.children.push(candidateOrFailure);
      wizardProgress.failuresGenerated += 1;
    }
    emitProgress("완료");
  } else {
    // depth ≥ 1 — 루트 레벨에서 완전 탐색.
    const perms = permutations(directChildren);
    const dirs: Array<"right" | "down"> = ["right", "down"];
    const totalBranches = perms.length * dirs.length;
    let branchIdx = 0;

    outer: for (const perm of perms) {
      for (const dir of dirs) {
        branchIdx += 1;
        if (hooks?.signal?.aborted) {
          aborted = true;
          break outer;
        }

        wizardProgress.depth = 1;
        wizardProgress.siblingIndex = branchIdx;
        wizardProgress.siblingTotal = totalBranches;
        wizardProgress.attempts += 1;

        const branch = makeBranchNode(perm, dir);
        rootNode.children.push(branch);

        await reportFn(
          `buildSingleAttempt [perm=${branchIdx}/${totalBranches} dir=${dir}]`,
        );
        const result = await buildSingleAttempt(
          tree,
          rootContainer,
          perm,
          dir,
          pickMachine,
          hooks?.signal,
        );
        if (result.kind === "candidate") {
          // 자식 머신 노드들도 트리에 표시 — 디버깅용.
          for (const c of result.children) branch.children.push(c);
          result.children = []; // 후보 leaf 자체는 children 비움 (UI 가 leaf 로 인식)
          branch.children.push(result);
          wizardProgress.candidatesGenerated += 1;
        } else {
          branch.children.push(result);
          wizardProgress.failuresGenerated += 1;
        }
      }
    }
  }

  emitProgress("완료");
  return wrapResult(rootNode, aborted);
};

/**
 * 후보 트리에서 *평탄화된 성공 후보 배열* 만 추출 — UI 의 후보 갤러리 / O1
 * 점수 기반 정렬에 사용. 작은 squarenessPenalty 가 앞쪽.
 */
export function flattenCandidates(tree: CandidateTree): CandidateLeaf[] {
  const out: CandidateLeaf[] = [];
  const walk = (node: CandidateNode): void => {
    if (node.kind === "candidate") {
      out.push(node);
      return;
    }
    if (node.kind === "failure") return;
    for (const child of node.children) walk(child);
  };
  walk(tree.root);
  out.sort((a, b) => a.squarenessPenalty - b.squarenessPenalty);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 시각화 트레이스 — 선택된 후보 1개의 생성 과정을 함수 단계로 재현
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 후보의 (perm, dir) 로 `buildSingleAttempt` 를 *한 번만* 재실행하며 각 reportFn
 * 진입을 한 단계로 기록한다. `runContainerWizard` 는 모든 perm×dir 을 탐색하지만
 * 여기선 확정된 한 조합만 결정적으로 재현하므로 동일 후보가 그대로 나온다.
 *
 * 반환된 단계들은 시각화 모달이 0.5초(사용자 지정) 간격으로 재생한다.
 */
/**
 * 트레이스 직렬화 락 — `traceRecorder`/`ROUTING_OPTIONS`/`MERGE_CONFIG` 가 모두
 * 모듈 전역이라 동시 실행 시 서로를 덮어쓴다. React StrictMode(개발)가 effect 를
 * 이중 호출하면 traceCandidatePath 가 둘 동시에 돌 수 있으므로, 이전 트레이스가
 * 끝날 때까지 기다려 한 번에 하나만 실행되게 한다.
 */
let traceLock: Promise<void> = Promise.resolve();

export async function traceCandidatePath(
  input: ContainerWizardInput,
  perm: string[],
  dir: "right" | "down",
): Promise<CandidateTraceResult> {
  const prevLock = traceLock;
  let release!: () => void;
  traceLock = new Promise<void>((r) => (release = r));
  await prevLock;

  // 로컬 레코더 — 전역 traceRecorder 가 다른 호출에 의해 null 이 되어도 안전.
  const rec: TraceRecorder = { steps: [], callDepth: 0 };
  let failed = false;
  try {
    resetProgress(undefined);
    ROUTING_OPTIONS = buildRoutingOptions(input);
    MERGE_CONFIG = {
      ...DEFAULT_MERGE_CONFIG,
      enabled: input.mergeSupplyBoxes ?? AUTO_LAYOUT_MERGE_BOXES,
    };

    const { recipeMap, itemToRecipe } = useGameDataStore.getState();
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
            makeMachineParamsLookup(input.selectedMachines),
          );

    if (!tree.recipeName)
      return { steps: [], routings: [], bbox: undefined, failed: true };

    const pickMachine = makeMachinePicker(input);
    const rootMachineEntity = pickMachine(tree.recipeName);
    if (!rootMachineEntity)
      return { steps: [], routings: [], bbox: undefined, failed: true };

    const rootContainer = makeMachineContainer(tree, rootMachineEntity.name);

    // perm(itemName 순서) → 실제 자식 노드 배열로 복원. perm 에 없는 자식은 뒤에 보충.
    const directChildren = tree.children.filter(
      (c) => !c.external && c.recipeName,
    );
    const rootPerm: RecipeTreeNode[] = [];
    for (const name of perm) {
      const found = directChildren.find(
        (c) => c.itemName === name && !rootPerm.includes(c),
      );
      if (found) rootPerm.push(found);
    }
    for (const c of directChildren) {
      if (!rootPerm.includes(c)) rootPerm.push(c);
    }

    traceRecorder = rec;
    let routings: TraceRouting[] = [];
    try {
      const result = await buildSingleAttempt(
        tree,
        rootContainer,
        rootPerm,
        dir,
        pickMachine,
        undefined,
      );
      if (result.kind === "candidate") {
        // 최종 '완료' 단계 — 완성된 후보의 영역을 그대로 담는다.
        rec.steps.push({
          order: rec.steps.length,
          functionName: "완료",
          callDepth: 0,
          snapshot: captureSnapshot(result.internal, result.external),
        });
        // 전체 라우팅 연결 목록 — 단계별로 양 끝 컨테이너 존재 시 선을 그린다.
        routings = result.routings.map((r) => ({
          fromId: r.from.containerId,
          toId: r.to.containerId,
          fluid: r.from.kind !== "item",
        }));
      } else {
        failed = true;
      }
    } finally {
      if (traceRecorder === rec) traceRecorder = null;
    }

    return {
      steps: rec.steps,
      routings,
      bbox: unionStepsBbox(rec.steps),
      failed,
    };
  } finally {
    release();
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// 한 (perm × dir) 시도 — 루트 배치 → 자식 재귀 → 외부 IO 채우기
// ─────────────────────────────────────────────────────────────────────────────

interface MachineRecord {
  machine: Container;
  treeNode: RecipeTreeNode;
}

/**
 * 한 (root perm × root dir) 후보 시도. 후보 leaf 는 자식들의 MachineNode 를
 * `children` 으로 일시 보관 — 호출자가 분기 노드 children 으로 옮기고 leaf 의
 * children 은 비운다 (UI 의 leaf 식별).
 */
async function buildSingleAttempt(
  tree: RecipeTreeNode,
  rootContainer: Container,
  rootPerm: RecipeTreeNode[],
  rootDir: "right" | "down",
  pickMachine: (recipeName: string) => { name: string } | undefined,
  signal: AbortSignal | undefined,
): Promise<(CandidateLeaf & { children: CandidateNode[] }) | FailureLeaf> {
  const internal: Area = makeEmptyArea("internal");
  const external: Area = makeEmptyArea("external");
  const containerByRecipe = new Map<string, Container>();
  const allRoutings: Routing[] = [];
  const allConnections: PendingConnection[] = [];
  const machineRecords: MachineRecord[] = [];

  // 1. 루트 배치 — machineCount > 1 이면 클러스터 (Spring Relaxation)
  await reportFn("placeRootMachine", { internal, external });
  let placedRoot: Container;
  if (tree.machineCount > 1) {
    const clusterResult = placeCluster(
      tree,
      rootContainer.entityName,
      null,
      "right",
      internal,
    );
    if (!clusterResult.ok) {
      return makeFailureLeaf(
        "no-routing",
        clusterResult.detail,
        captureSnapshot(internal, external),
      );
    }
    for (const m of clusterResult.machines) {
      machineRecords.push({ machine: m, treeNode: tree });
    }
    placedRoot = clusterResult.representative;
    if (tree.recipeName) containerByRecipe.set(tree.recipeName, placedRoot);
  } else {
    const placed = placeRootMachine({ ...rootContainer }, internal);
    if (!placed) {
      return makeFailureLeaf(
        "no-routing",
        "root placement collision",
        captureSnapshot(internal, external),
      );
    }
    placedRoot = placed;
    if (tree.recipeName) containerByRecipe.set(tree.recipeName, placedRoot);
    machineRecords.push({ machine: placedRoot, treeNode: tree });
  }

  // 2. 자식 DFS 재귀 (Phase 1 — 머신 배치만)
  // 루트 직계 자식들: 배치는 직전 형제 옆에 나란히(lastAnchor)지만, 라우팅은
  // 모두 실제 부모(placedRoot)로 보낸다 — 형제끼리는 서로의 재료가 아니다.
  const childMachineNodes: CandidateNode[] = [];
  let lastAnchor = placedRoot;
  for (const child of rootPerm) {
    if (signal?.aborted) {
      return makeFailureLeaf(
        "aborted",
        "user cancelled",
        captureSnapshot(internal, external),
      );
    }
    const childResult = await recurseMachine(
      child,
      lastAnchor,
      placedRoot,
      rootDir,
      internal,
      external,
      containerByRecipe,
      pickMachine,
      signal,
      machineRecords,
    );
    childMachineNodes.push(childResult);
    if (childResult.kind === "failure") {
      // 부분 트리만 반환 — 위에서 FailureLeaf 로 마킹.
      const failure = makeFailureLeaf(
        childResult.reason,
        `${child.recipeName ?? child.itemName} 처리 중 실패: ${childResult.label}`,
        captureSnapshot(internal, external),
      );
      return failure;
    }
    collectRoutingsFromTree(childResult, allRoutings);
    lastAnchor = childResult.machine;
  }

  // Phase 2 — 외부 컨테이너 등록 (모든 머신 배치 완료 후)
  await reportFn("attachExternalInputs (Phase 2)", { internal, external });
  for (const { machine, treeNode } of machineRecords) {
    attachExternalInputs(machine, treeNode, internal, external, allConnections);
  }

  // 3. 루트 product 출력 연결 등록 — root 머신 → 외부 무한상자/파이프
  await reportFn("attachRootOutput", { internal, external });
  attachRootOutput(placedRoot, tree, internal, external, allConnections);

  // 4. 후처리 — chest 들을 internal bbox 의 perimeter ring 위에 최초 배치 + 라우팅.
  //    병합 플래그 ON 이면 공유 무한상자 병합 패스(트렁크), 아니면 기존 1:1.
  if (MERGE_CONFIG.enabled) {
    await reportFn("wrapExternalsWithMerge", { internal, external });
    wrapExternalsWithMerge(
      internal,
      external,
      allRoutings,
      allConnections,
      ROUTING_OPTIONS,
      MERGE_CONFIG,
    );
  } else {
    await reportFn("wrapExternalsAroundPerimeter", { internal, external });
    wrapExternalsAroundPerimeter(
      internal,
      external,
      allRoutings,
      allConnections,
      ROUTING_OPTIONS,
    );
  }

  // 5. 후보 leaf
  const leaf = makeCandidateLeaf(
    internal,
    external,
    allRoutings,
    rootPerm.length === 0
      ? "depth-0 candidate"
      : `perm=[${rootPerm.map((n) => n.itemName).join(", ")}] dir=${rootDir}`,
    rootPerm.map((n) => n.itemName),
    rootDir,
  );
  // 자식 노드들을 일시 보관 (호출자가 옮긴다).
  leaf.children = childMachineNodes;
  return leaf;
}

// ─────────────────────────────────────────────────────────────────────────────
// 머신 재귀 — 임의 깊이
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `recurseMachine` 의 얇은 래퍼 — 시각화 레코더의 호출 깊이를 증감시켜
 * 함수 호출 트리의 중첩 관계를 기록한다. 레코더 비활성 시 비용 없음.
 */
async function recurseMachine(
  treeNode: RecipeTreeNode,
  placeAnchor: Container,
  consumer: Container,
  dir: "right" | "down",
  internal: Area,
  external: Area,
  containerByRecipe: Map<string, Container>,
  pickMachine: (recipeName: string) => { name: string } | undefined,
  signal: AbortSignal | undefined,
  machineRecords: MachineRecord[],
): Promise<MachineNode | FailureLeaf> {
  if (traceRecorder) traceRecorder.callDepth += 1;
  try {
    return await recurseMachineImpl(
      treeNode,
      placeAnchor,
      consumer,
      dir,
      internal,
      external,
      containerByRecipe,
      pickMachine,
      signal,
      machineRecords,
    );
  } finally {
    if (traceRecorder) traceRecorder.callDepth -= 1;
  }
}

/**
 * 한 비-external 레시피 노드를 부모 옆에 배치 + 그 자식 (= 손자, 증손자 ...) 도
 * 재귀적으로 배치한다.
 *
 * 자식 레벨 (`children of treeNode`) 에서 (perm × dir) enumerate 하되, 첫 성공한
 * 조합만 commit (= 트리에는 모든 시도가 BranchNode 로 기록되지만 상태에는
 * first-success 만 반영). 더 강한 cross-product enumeration 은 follow-up.
 */
async function recurseMachineImpl(
  treeNode: RecipeTreeNode,
  // 배치 기준점 — 충돌 회피를 위해 이 컨테이너 옆(dir)에 자식을 나란히 둔다.
  // 형제 체인에서는 *직전 형제* 가 들어온다 (레이아웃 압축용).
  placeAnchor: Container,
  // 라우팅 소비자 — 이 자식의 product 를 실제로 소비하는 부모 머신.
  // placeAnchor 와 다를 수 있다 (형제끼리는 서로의 재료가 아니므로).
  consumer: Container,
  dir: "right" | "down",
  internal: Area,
  external: Area,
  containerByRecipe: Map<string, Container>,
  pickMachine: (recipeName: string) => { name: string } | undefined,
  signal: AbortSignal | undefined,
  machineRecords: MachineRecord[],
): Promise<MachineNode | FailureLeaf> {
  if (!treeNode.recipeName) {
    return makeFailureLeaf(
      "no-machine-match",
      `${treeNode.itemName} 의 레시피 없음`,
      captureSnapshot(internal, external),
    );
  }
  const machineEntity = pickMachine(treeNode.recipeName);
  if (!machineEntity) {
    return makeFailureLeaf(
      "no-machine-match",
      `${treeNode.recipeName} 머신 매칭 실패`,
      captureSnapshot(internal, external),
    );
  }

  const machineContainer = makeMachineContainer(treeNode, machineEntity.name);
  await reportFn(`placeMachine [${treeNode.recipeName}]`, { internal, external });

  const routings: Routing[] = [];
  let placed: Container;

  const flowKind = lookupProductKind(treeNode.recipeName, treeNode.itemName);
  const routeKind: PortKind =
    flowKind === "fluid" ? { fluid: treeNode.itemName } : "item";

  if (treeNode.machineCount > 1) {
    // 클러스터 경로 — N대 Spring Relaxation 배치
    const clusterResult = placeCluster(
      treeNode,
      machineEntity.name,
      placeAnchor,
      dir,
      internal,
    );
    if (!clusterResult.ok) {
      return makeFailureLeaf(
        "no-routing",
        clusterResult.detail,
        captureSnapshot(internal, external),
      );
    }

    for (const m of clusterResult.machines) {
      await reportFn(
        `routeWithFallback [${treeNode.itemName} → 부모 (클러스터)]`,
        { internal, external },
      );
      const routeResult = routeWithFallback(
        m,
        consumer,
        routeKind,
        internal,
        ROUTING_OPTIONS,
      );
      if (!routeResult.ok) {
        return makeFailureLeaf(
          "no-routing",
          `${treeNode.itemName} 라우팅 실패 — ${routeResult.tried.length} port 조합 시도`,
          captureSnapshot(internal, external),
        );
      }
      commitRouting(routeResult.routing, internal);
      routings.push(routeResult.routing);

      machineRecords.push({ machine: m, treeNode });
    }

    placed = clusterResult.representative;
  } else {
    // 단일 기계 경로
    const single = placeMachine(placeAnchor, machineContainer, dir, internal);
    if (!single) {
      return makeFailureLeaf(
        "no-routing",
        `${treeNode.recipeName} 배치 충돌`,
        captureSnapshot(internal, external),
      );
    }
    placed = single;

    // Route this → consumer — treeNode.itemName 은 소비자(부모)로 흘러 들어가는 자식의 product 이름.
    await reportFn(`routeWithFallback [${treeNode.itemName} → 부모]`, {
      internal,
      external,
    });
    const routeResult = routeWithFallback(
      placed,
      consumer,
      routeKind,
      internal,
      ROUTING_OPTIONS,
    );
    if (!routeResult.ok) {
      return makeFailureLeaf(
        "no-routing",
        `${treeNode.itemName} 라우팅 실패 — ${routeResult.tried.length} port 조합 시도`,
        captureSnapshot(internal, external),
      );
    }
    commitRouting(routeResult.routing, internal);
    routings.push(routeResult.routing);

    machineRecords.push({ machine: placed, treeNode });
  }

  containerByRecipe.set(treeNode.recipeName, placed);
  const thisMN = makeMachineNode(
    placed,
    routings,
    labelFor(placed),
    captureSnapshot(internal, external),
  );

  // 손자 처리 — 비-external 자식들 enumerate
  const grandchildren = treeNode.children.filter(
    (c) => !c.external && c.recipeName,
  );
  if (grandchildren.length === 0) return thisMN;

  let committed = false;
  for (const perm of permutations(grandchildren)) {
    if (signal?.aborted) break;
    for (const childDir of ["right", "down"] as const) {
      if (signal?.aborted) break;

      wizardProgress.attempts += 1;
      await reportFn(
        `recurseMachine 손자 시도 [${perm.map((p) => p.itemName).join(",")}] dir=${childDir}`,
        { internal, external },
      );

      const branch = makeBranchNode(
        perm,
        childDir,
        captureSnapshot(internal, external),
      );
      thisMN.children.push(branch);

      // 시도 — 상태 클론 + machineRecords 스냅샷
      const internalAttempt = cloneArea(internal);
      const externalAttempt = cloneArea(external);
      const containerByRecipeAttempt = new Map(containerByRecipe);
      const machineRecordsLengthBefore = machineRecords.length;

      // 형제 손자들: 배치는 직전 형제 옆에 나란히(lastAnchor)지만, 라우팅은
      // 모두 실제 부모(placed)로 보낸다 — 형제끼리는 서로의 재료가 아니다.
      let lastAnchor = placed;
      let allOk = true;
      for (const grandchild of perm) {
        const childResult = await recurseMachine(
          grandchild,
          lastAnchor,
          placed,
          childDir,
          internalAttempt,
          externalAttempt,
          containerByRecipeAttempt,
          pickMachine,
          signal,
          machineRecords,
        );
        branch.children.push(childResult);
        if (childResult.kind === "failure") {
          allOk = false;
          break;
        }
        lastAnchor = childResult.machine;
      }

      if (allOk && !committed) {
        // First-success commit — 시도의 mutation 을 caller 의 state 로 반영.
        commitAreaInPlace(internal, internalAttempt);
        commitAreaInPlace(external, externalAttempt);
        for (const [k, v] of containerByRecipeAttempt)
          containerByRecipe.set(k, v);
        // 부모 라우팅 외에 손자 라우팅도 thisMN.routings 에 누적.
        const subRoutings: Routing[] = [];
        for (const branchChild of branch.children) {
          if (branchChild.kind === "machine")
            collectRoutingsFromTree(branchChild, subRoutings);
        }
        for (const r of subRoutings) thisMN.routings.push(r);
        committed = true;
      } else if (!allOk) {
        // 실패한 시도의 machineRecords 롤백
        machineRecords.length = machineRecordsLengthBefore;
      }
    }
  }

  return thisMN;
}

// ─────────────────────────────────────────────────────────────────────────────
// 라우팅 옵션 — 본 위저드의 default 설정. fallback 본체는 routeFallback.ts 로
// 추출되어 통합 단계 (`areaUnification.dragExternalContainer`) 와 공유.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 라우팅 옵션 — `runContainerWizard` 진입 시 사용자 입력에 맞춰 갱신된다.
 * 이 모듈 내 모든 라우팅 호출이 이 값을 참조한다.
 *
 * 외부 소비자 (드래그 핸들러 등) 는 `buildRoutingOptions(input)` 으로 직접
 * 빌드해 사용하면 됨 — 이 mutable 상태에 의존하지 말 것.
 */
export let ROUTING_OPTIONS: RouteOptions = {
  beltEntityName: "transport-belt",
  inserterEntityName: "inserter",
  pipeEntityName: "pipe",
  preferUnderground: false,
};

/**
 * 공유 무한상자 병합 설정 — `runContainerWizard` 진입부에서 입력/토글로 갱신된다.
 * 기본 비활성.
 */
export let MERGE_CONFIG: MergeConfig = { ...DEFAULT_MERGE_CONFIG };

/**
 * 위저드 입력으로부터 라우팅 옵션을 빌드. 사용자가 선택한 첫 underground
 * pipe / belt prototype 의 entityName 과 `max_underground_distance` 를
 * gameDataStore 에서 lookup 한다.
 *
 * 점프 비활성 (= maxDistance=0) 조건:
 *  - 사용자가 underground pipe / belt 를 하나도 선택 안 함, OR
 *  - 선택한 entity 가 prototype 사전에 없음, OR
 *  - max_underground_distance 가 0 / 미정.
 */
export function buildRoutingOptions(input: ContainerWizardInput): RouteOptions {
  const { entityMap } = useGameDataStore.getState();
  const beltEntityName =
    input.primaryBelt ?? input.selectedBelts[0] ?? "transport-belt";
  const inserterEntityName =
    input.primaryInserter ?? input.selectedInserters[0] ?? "inserter";

  const undergroundPipeEntityName = input.selectedUndergroundPipes[0];
  const undergroundBeltEntityName = input.selectedUndergroundBelts[0];

  const pipeMaxUndergroundDistance = undergroundPipeEntityName
    ? lookupPipeUndergroundDistance(entityMap.get(undergroundPipeEntityName))
    : 0;
  const beltMaxUndergroundDistance = undergroundBeltEntityName
    ? (entityMap.get(undergroundBeltEntityName)?.max_underground_distance ?? 0)
    : 0;

  return {
    beltEntityName,
    inserterEntityName,
    pipeEntityName: "pipe",
    undergroundPipeEntityName,
    undergroundBeltEntityName,
    pipeMaxUndergroundDistance,
    beltMaxUndergroundDistance,
    preferUnderground: !!(
      undergroundPipeEntityName || undergroundBeltEntityName
    ),
  };
}

/**
 * pipe-to-ground 의 underground 거리 추출. Factorio 2.0 prototype API 가
 * connection 별 거리를 두지만 (`fluid_boxes[].connections[].max_underground_distance`),
 * 최상위 `Entity.max_underground_distance` 도 호환용으로 채워진다.
 * connection 우선, 없으면 최상위 fallback.
 */
function lookupPipeUndergroundDistance(entity: Entity | undefined): number {
  if (!entity) return 0;
  for (const fb of entity.fluid_boxes ?? []) {
    for (const c of fb.connections ?? []) {
      if (c.connection_type === "underground" && c.max_underground_distance) {
        return c.max_underground_distance;
      }
    }
  }
  return entity.max_underground_distance ?? 0;
}

/**
 * 한 레시피의 product 가운데 itemName 의 type (item / fluid) 을 조회.
 * 자식 노드가 부모로 흘려보내는 content 의 종류를 결정 — fluid 면 라우팅 kind
 * 가 fluid 가 되어 파이프 라우팅으로 전환된다.
 */
function lookupProductKind(
  recipeName: string,
  itemName: string,
): "item" | "fluid" {
  const recipe = useGameDataStore.getState().recipeMap.get(recipeName);
  if (!recipe) return "item";
  const prod = recipe.products.find((p) => p.name === itemName);
  return prod?.type ?? "item";
}

// ─────────────────────────────────────────────────────────────────────────────
// 외부 입력 라우팅 — 한 머신의 외부 ingredient 마다 무한상자/파이프 + 라우팅
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 머신의 외부 ingredient 별로 무한상자/파이프 1개씩 등록하고
 * PendingConnection 을 allConnections 에 push 한다.
 *
 * 라우팅은 하지 않는다 — 모든 머신 배치 완료 후
 * wrapExternalsAroundPerimeter 가 일괄 처리한다.
 */
function attachExternalInputs(
  machine: Container,
  treeNode: RecipeTreeNode,
  internal: Area,
  external: Area,
  allConnections: PendingConnection[],
): void {
  if (!treeNode.recipeName) return;
  const recipe = useGameDataStore.getState().recipeMap.get(treeNode.recipeName);
  if (!recipe) return;

  for (const ing of recipe.ingredients) {
    const childForIng = treeNode.children.find((c) => c.itemName === ing.name);
    const isExternal =
      !childForIng || childForIng.external || !childForIng.recipeName;
    if (!isExternal) continue;

    const chest = placeExternalContainer(
      {
        kind: ing.type === "fluid" ? "infinity-pipe" : "infinity-chest",
        entityName: ing.type === "fluid" ? "infinity-pipe" : "infinity-chest",
        content: ing.name,
      },
      external,
      internal,
    );

    const portKind: PortKind =
      ing.type === "fluid" ? { fluid: ing.name } : "item";
    allConnections.push({
      producerId: chest.id,
      consumerId: machine.id,
      kind: portKind,
    });
  }
}

/**
 * 루트 머신의 모든 product 마다 외부 무한상자/파이프 1개씩 등록하고
 * PendingConnection 을 allConnections 에 push 한다.
 *
 * 라우팅은 하지 않는다 — wrapExternalsAroundPerimeter 가 일괄 처리한다.
 */
function attachRootOutput(
  rootContainer: Container,
  tree: RecipeTreeNode,
  internal: Area,
  external: Area,
  allConnections: PendingConnection[],
): void {
  if (!tree.recipeName) return;
  const recipe = useGameDataStore.getState().recipeMap.get(tree.recipeName);
  if (!recipe) return;

  for (const prod of recipe.products) {
    const chest = placeExternalContainer(
      {
        kind: prod.type === "fluid" ? "infinity-pipe" : "infinity-chest",
        entityName: prod.type === "fluid" ? "infinity-pipe" : "infinity-chest",
        content: prod.name,
      },
      external,
      internal,
    );

    const portKind: PortKind =
      prod.type === "fluid" ? { fluid: prod.name } : "item";
    allConnections.push({
      producerId: rootContainer.id,
      consumerId: chest.id,
      kind: portKind,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 노드 생성 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function makeMachineNode(
  machine: Container,
  routings: Routing[],
  label: string,
  snapshot?: AreaSnapshot,
): MachineNode {
  return {
    id: nextNodeId("m"),
    kind: "machine",
    machine,
    routings,
    children: [],
    label,
    snapshot,
  };
}

function makeBranchNode(
  perm: RecipeTreeNode[],
  dir: "right" | "down",
  snapshot?: AreaSnapshot,
): BranchNode {
  return {
    id: nextNodeId("b"),
    kind: "branch",
    perm: perm.map((n) => n.itemName),
    dir,
    children: [],
    label: `perm=[${perm.map((n) => n.itemName).join(", ")}] dir=${dir}`,
    snapshot,
  };
}

function makeCandidateLeaf(
  internal: Area,
  external: Area,
  routings: Routing[],
  label: string,
  sourcePerm: string[],
  sourceDir: "right" | "down",
): CandidateLeaf {
  const bbox = internal.bbox;
  const squarenessPenalty = bbox ? Math.abs(bbox.w - bbox.h) : 0;
  return {
    id: nextNodeId("c"),
    kind: "candidate",
    internal,
    external,
    routings,
    squarenessPenalty,
    children: [],
    label,
    sourcePerm,
    sourceDir,
  };
}

function makeFailureLeaf(
  reason: FailureLeaf["reason"],
  detail: string,
  snapshot?: AreaSnapshot,
): FailureLeaf {
  return {
    id: nextNodeId("f"),
    kind: "failure",
    reason,
    children: [],
    label: `${reason}: ${detail}`,
    snapshot,
  };
}

/**
 * 현재 영역 상태를 deep-clone 해 snapshot 으로 보존.
 * 후보 트리의 각 노드가 hover preview 시 이 시점까지 배치된 셀을 그릴 때 사용.
 */
function captureSnapshot(internal: Area, external: Area): AreaSnapshot {
  return { internal: cloneArea(internal), external: cloneArea(external) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 컨테이너 / 영역 / 라우팅 유틸
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 머신 footprint 크기 조회. 배치는 엔티티가 entityMap 에 *존재해야만* 시작할 수
 * 있으므로, 없으면 예외를 던진다 — 기본값(3×3) 으로 조용히 배치하지 않는다.
 * (정상 경로에선 pickMachine 이 이미 존재를 보장하므로 발생하지 않는 invariant.)
 */
function resolveMachineSize(entityName: string): { w: number; h: number } {
  const entity = useGameDataStore.getState().entityMap.get(entityName);
  if (!entity) {
    throw new Error(`머신 엔티티 없음: ${entityName} — 배치 불가`);
  }
  return { w: entity.tile_width, h: entity.tile_height };
}

function makeMachineContainer(
  node: RecipeTreeNode,
  entityName: string,
): Container {
  const { w, h } = resolveMachineSize(entityName);
  return {
    id: `m-${node.recipeName ?? node.itemName}-${nextNodeId("id")}`,
    kind: "machine",
    entityName,
    origin: { x: 0, y: 0 }, // placeRootMachine / placeMachine 이 덮어쓴다
    size: { w, h },
    recipeName: node.recipeName,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 클러스터 배치 — machineCount > 1 일 때 Spring Relaxation 으로 N대 배치
// ─────────────────────────────────────────────────────────────────────────────

const ROUTING_GAP_CLUSTER = 3;
const CLUSTER_ROOT_ORIGIN = { x: 0, y: 0 } as const;

type ClusterPlaceResult =
  | { ok: true; machines: Container[]; representative: Container }
  | { ok: false; detail: string };

/**
 * N대 기계를 Spring Relaxation 으로 배치하고 internal area 에 commit 한다.
 *
 * - parent = null  → 루트 클러스터. CLUSTER_ROOT_ORIGIN 을 기준점으로 사용.
 * - parent ≠ null  → 자식 클러스터. parent 오른쪽/아래쪽에 인접 배치.
 *
 * representative = 다음 형제/자식 배치의 기준으로 사용되는 대표 기계.
 * dir='right' 이면 클러스터 가장 오른쪽 기계, dir='down' 이면 가장 아래쪽 기계.
 */
function placeCluster(
  node: RecipeTreeNode,
  entityName: string,
  parent: Container | null,
  dir: "right" | "down",
  internal: Area,
): ClusterPlaceResult {
  const count = Math.max(1, node.machineCount);
  const { w, h } = resolveMachineSize(entityName);

  // N개 템플릿 생성 (origin 은 Spring 이 결정)
  const templates: Container[] = Array.from({ length: count }, (_, i) => ({
    id: `m-${node.recipeName ?? node.itemName}-cl${nextNodeId("id")}-${i}`,
    kind: "machine" as const,
    entityName,
    origin: { x: 0, y: 0 },
    size: { w, h },
    recipeName: node.recipeName,
  }));

  // Spring Relaxation — 기계들의 상대 위치 결정
  const spring = runSpringRelaxation(
    templates,
    internal,
    DEFAULT_SPRING_CONFIG,
  );

  // 클러스터 bbox (Spring 결과 기준 상대 좌표)
  const bbox = clusterBbox(spring.machines);

  // 절대 좌표 offset 계산
  let ox: number;
  let oy: number;
  if (!parent) {
    ox = CLUSTER_ROOT_ORIGIN.x - bbox.x;
    oy = CLUSTER_ROOT_ORIGIN.y - bbox.y;
  } else if (dir === "right") {
    ox = parent.origin.x + parent.size.w + ROUTING_GAP_CLUSTER - bbox.x;
    oy = parent.origin.y - bbox.y;
  } else {
    ox = parent.origin.x - bbox.x;
    oy = parent.origin.y + parent.size.h + ROUTING_GAP_CLUSTER - bbox.y;
  }

  // 절대 좌표 적용
  const positioned: Container[] = spring.machines.map((m) => ({
    ...m,
    origin: { x: m.origin.x + ox, y: m.origin.y + oy },
  }));

  // 충돌 검사 — 기존 placed 셀 + 클러스터 내부 기계끼리
  const occupied = new Set<string>(internal.placed.map((p) => `${p.x},${p.y}`));
  for (const m of positioned) {
    for (let dy = 0; dy < m.size.h; dy++) {
      for (let dx = 0; dx < m.size.w; dx++) {
        const key = `${m.origin.x + dx},${m.origin.y + dy}`;
        if (occupied.has(key)) {
          return {
            ok: false,
            detail: `클러스터 배치 충돌: ${node.recipeName ?? node.itemName}`,
          };
        }
        occupied.add(key);
      }
    }
  }

  // Area 에 commit
  for (const m of positioned) {
    commitContainer(m, internal);
  }

  // 대표 기계: 다음 형제가 이 기계 기준으로 위치를 잡으므로, 클러스터의 "끝" 기계 선택
  const representative = selectRepresentative(positioned, dir);

  return { ok: true, machines: positioned, representative };
}

function clusterBbox(machines: Container[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const m of machines) {
    minX = Math.min(minX, m.origin.x);
    minY = Math.min(minY, m.origin.y);
    maxX = Math.max(maxX, m.origin.x + m.size.w);
    maxY = Math.max(maxY, m.origin.y + m.size.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 다음 형제 배치의 기준점 — 클러스터 끝단 기계. */
function selectRepresentative(
  machines: Container[],
  dir: "right" | "down",
): Container {
  return machines.reduce((best, m) =>
    dir === "right"
      ? m.origin.x + m.size.w > best.origin.x + best.size.w
        ? m
        : best
      : m.origin.y + m.size.h > best.origin.y + best.size.h
        ? m
        : best,
  );
}


function wrapResult(
  rootNode: MachineNode,
  aborted: boolean,
): ContainerWizardResult {
  let candidates = 0;
  let failures = 0;
  let deepest = 0;
  const walk = (node: CandidateNode, depth: number): void => {
    deepest = Math.max(deepest, depth);
    if (node.kind === "candidate") candidates += 1;
    if (node.kind === "failure") failures += 1;
    for (const c of node.children) walk(c, depth + 1);
  };
  walk(rootNode, 0);

  const tree: CandidateTree = {
    root: rootNode,
    candidates: [],
    aborted,
    stats: {
      candidatesGenerated: candidates,
      failuresGenerated: failures,
      deepestDepth: deepest,
    },
  };
  tree.candidates = flattenCandidates(tree);
  return { ok: candidates > 0, tree, partial: aborted };
}

function failureResult(
  reason: FailureLeaf["reason"],
  detail: string,
): ContainerWizardResult {
  const dummy: Container = {
    id: "m-failure",
    kind: "machine",
    entityName: "unknown",
    origin: { x: 0, y: 0 },
    size: { w: 1, h: 1 },
  };
  const root = makeMachineNode(dummy, [], "no recipe / no machine");
  root.children.push(makeFailureLeaf(reason, detail));
  return wrapResult(root, false);
}
