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

import { useGameDataStore, type Entity } from '../../store/gameDataStore';
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
  PortKind,
  ProgressReporter,
  Routing,
  RunContainerWizard,
} from './containerModel';
import { commitRouting } from './containerRouting';
import { placeExternalContainer } from './externalPlacer';
import { placeMachine, placeRootMachine } from './machinePlacer';
import { routeWithFallback, type RouteOptions } from './routeFallback';
import {
  expandRecipeTree,
  assignMinimumCounts,
} from './recipeTree';
import type { RecipeTreeNode } from './types';

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
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (now - wizardProgress.lastYieldAt >= 16) {
    wizardProgress.lastYieldAt = now;
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

/** emit + maybeYield 한 번에 — phase 진입 지점에서 호출. */
async function reportFn(name: string): Promise<void> {
  emitProgress(name);
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

  // 1. 레시피 트리 펼침 + 머신 수 산정 (1차는 minimum 모드 고정).
  await reportFn('expandRecipeTree');
  const tree = assignMinimumCounts(
    expandRecipeTree(input.targetRecipe, recipeMap, itemToRecipe, input.externalIngredients),
  );

  if (!tree.recipeName) {
    return failureResult('no-machine-match', 'target recipe not found');
  }

  const pickMachine = makeMachinePicker(input);
  const rootMachineEntity = pickMachine(tree.recipeName);
  if (!rootMachineEntity) {
    return failureResult('no-machine-match', `${tree.recipeName} 카테고리 머신 없음`);
  }

  const rootContainer = makeMachineContainer(tree, rootMachineEntity.name);
  const rootNode = makeMachineNode(rootContainer, [], labelFor(rootContainer));

  const directChildren = tree.children.filter((c) => !c.external && c.recipeName);

  let aborted = false;

  if (directChildren.length === 0) {
    // depth 0 — root 만.
    wizardProgress.depth = 0;
    wizardProgress.siblingIndex = 1;
    wizardProgress.siblingTotal = 1;
    wizardProgress.attempts += 1;
    await reportFn('buildSingleAttempt [depth-0]');
    const candidateOrFailure = await buildSingleAttempt(tree, rootContainer, [], 'right', pickMachine, hooks?.signal);
    if (candidateOrFailure.kind === 'candidate') {
      rootNode.children.push(candidateOrFailure);
      wizardProgress.candidatesGenerated += 1;
    } else {
      rootNode.children.push(candidateOrFailure);
      wizardProgress.failuresGenerated += 1;
    }
    emitProgress('완료');
  } else {
    // depth ≥ 1 — 루트 레벨에서 완전 탐색.
    const perms = permutations(directChildren);
    const dirs: Array<'right' | 'down'> = ['right', 'down'];
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

        await reportFn(`buildSingleAttempt [perm=${branchIdx}/${totalBranches} dir=${dir}]`);
        const result = await buildSingleAttempt(tree, rootContainer, perm, dir, pickMachine, hooks?.signal);
        if (result.kind === 'candidate') {
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

  emitProgress('완료');
  return wrapResult(rootNode, aborted);
};

/**
 * 후보 트리에서 *평탄화된 성공 후보 배열* 만 추출 — UI 의 후보 갤러리 / O1
 * 점수 기반 정렬에 사용. 작은 squarenessPenalty 가 앞쪽.
 */
export function flattenCandidates(tree: CandidateTree): CandidateLeaf[] {
  const out: CandidateLeaf[] = [];
  const walk = (node: CandidateNode): void => {
    if (node.kind === 'candidate') {
      out.push(node);
      return;
    }
    if (node.kind === 'failure') return;
    for (const child of node.children) walk(child);
  };
  walk(tree.root);
  out.sort((a, b) => a.squarenessPenalty - b.squarenessPenalty);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 한 (perm × dir) 시도 — 루트 배치 → 자식 재귀 → 외부 IO 채우기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 (root perm × root dir) 후보 시도. 후보 leaf 는 자식들의 MachineNode 를
 * `children` 으로 일시 보관 — 호출자가 분기 노드 children 으로 옮기고 leaf 의
 * children 은 비운다 (UI 의 leaf 식별).
 */
async function buildSingleAttempt(
  tree: RecipeTreeNode,
  rootContainer: Container,
  rootPerm: RecipeTreeNode[],
  rootDir: 'right' | 'down',
  pickMachine: (recipeName: string) => { name: string } | undefined,
  signal: AbortSignal | undefined,
): Promise<(CandidateLeaf & { children: CandidateNode[] }) | FailureLeaf> {
  const internal: Area = makeEmptyArea('internal');
  const external: Area = makeEmptyArea('external');
  const containerByRecipe = new Map<string, Container>();
  const allRoutings: Routing[] = [];

  // 1. 루트 배치
  await reportFn('placeRootMachine');
  const placedRoot = placeRootMachine({ ...rootContainer }, internal);
  if (!placedRoot) {
    return makeFailureLeaf('no-routing', 'root placement collision', captureSnapshot(internal, external));
  }
  if (tree.recipeName) containerByRecipe.set(tree.recipeName, placedRoot);

  // 1a. 루트의 외부 입력 라우팅 (placement-search §7.1 — 사이클의 B 단계)
  await reportFn('attachExternalInputs (루트)');
  const rootInputs = attachExternalInputs(placedRoot, tree, internal, external);
  if (!rootInputs.ok) {
    return makeFailureLeaf(rootInputs.reason, rootInputs.detail, captureSnapshot(internal, external));
  }
  for (const r of rootInputs.routings) allRoutings.push(r);

  // 2. 자식 DFS 재귀
  const childMachineNodes: CandidateNode[] = [];
  let lastParent = placedRoot;
  for (const child of rootPerm) {
    if (signal?.aborted) {
      return makeFailureLeaf('aborted', 'user cancelled', captureSnapshot(internal, external));
    }
    const childResult = await recurseMachine(
      child, lastParent, rootDir, internal, external, containerByRecipe, pickMachine, signal,
    );
    childMachineNodes.push(childResult);
    if (childResult.kind === 'failure') {
      // 부분 트리만 반환 — 위에서 FailureLeaf 로 마킹.
      const failure = makeFailureLeaf(
        childResult.reason,
        `${child.recipeName ?? child.itemName} 처리 중 실패: ${childResult.label}`,
        captureSnapshot(internal, external),
      );
      return failure;
    }
    collectRoutingsFromTree(childResult, allRoutings);
    lastParent = childResult.machine;
  }

  // 3. 루트 product 출력 라우팅 — root 머신 → 외부 무한상자/파이프
  await reportFn('attachRootOutput');
  const rootOutputs = attachRootOutput(placedRoot, tree, internal, external);
  if (!rootOutputs.ok) {
    return makeFailureLeaf(rootOutputs.reason, rootOutputs.detail, captureSnapshot(internal, external));
  }
  for (const r of rootOutputs.routings) allRoutings.push(r);

  // 4. 후보 leaf
  const leaf = makeCandidateLeaf(
    internal,
    external,
    allRoutings,
    rootPerm.length === 0
      ? 'depth-0 candidate'
      : `perm=[${rootPerm.map((n) => n.itemName).join(', ')}] dir=${rootDir}`,
  );
  // 자식 노드들을 일시 보관 (호출자가 옮긴다).
  leaf.children = childMachineNodes;
  return leaf;
}

// ─────────────────────────────────────────────────────────────────────────────
// 머신 재귀 — 임의 깊이
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 비-external 레시피 노드를 부모 옆에 배치 + 그 자식 (= 손자, 증손자 ...) 도
 * 재귀적으로 배치한다.
 *
 * 자식 레벨 (`children of treeNode`) 에서 (perm × dir) enumerate 하되, 첫 성공한
 * 조합만 commit (= 트리에는 모든 시도가 BranchNode 로 기록되지만 상태에는
 * first-success 만 반영). 더 강한 cross-product enumeration 은 follow-up.
 */
async function recurseMachine(
  treeNode: RecipeTreeNode,
  parent: Container,
  dir: 'right' | 'down',
  internal: Area,
  external: Area,
  containerByRecipe: Map<string, Container>,
  pickMachine: (recipeName: string) => { name: string } | undefined,
  signal: AbortSignal | undefined,
): Promise<MachineNode | FailureLeaf> {
  if (!treeNode.recipeName) {
    return makeFailureLeaf('no-machine-match', `${treeNode.itemName} 의 레시피 없음`, captureSnapshot(internal, external));
  }
  const machineEntity = pickMachine(treeNode.recipeName);
  if (!machineEntity) {
    return makeFailureLeaf('no-machine-match', `${treeNode.recipeName} 머신 매칭 실패`, captureSnapshot(internal, external));
  }

  const machineContainer = makeMachineContainer(treeNode, machineEntity.name);
  await reportFn(`placeMachine [${treeNode.recipeName}]`);
  const placed = placeMachine(parent, machineContainer, dir, internal);
  if (!placed) {
    return makeFailureLeaf('no-routing', `${treeNode.recipeName} 배치 충돌`, captureSnapshot(internal, external));
  }

  // Route this → parent — kind 는 흐르는 content (item/fluid) 에서 결정.
  // treeNode.itemName 은 부모로 흘러 들어가는 자식의 product 이름.
  const flowKind = lookupProductKind(treeNode.recipeName, treeNode.itemName);
  const routeKind: PortKind = flowKind === 'fluid' ? { fluid: treeNode.itemName } : 'item';

  const routings: Routing[] = [];
  await reportFn(`routeWithFallback [${treeNode.itemName} → 부모]`);
  const routeResult = routeWithFallback(placed, parent, routeKind, internal, ROUTING_OPTIONS);
  if (!routeResult.ok) {
    return makeFailureLeaf('no-routing', `${treeNode.itemName} 라우팅 실패 — ${routeResult.tried.length} port 조합 시도`, captureSnapshot(internal, external));
  }
  commitRouting(routeResult.routing, internal);
  routings.push(routeResult.routing);

  // 이 머신의 외부 입력 라우팅 — placement-search §7.1 의 B 단계.
  // 자식 ingredient (= 자체 생산) 가 아닌 ingredient 마다 무한상자/파이프 1개
  // 추가하고 이 머신과 라우팅. 한 ingredient 가 여러 머신에 들어가면 머신마다
  // 별도 컨테이너 (Q19 / Q3 결정 — splitter 미사용).
  await reportFn(`attachExternalInputs [${treeNode.recipeName}]`);
  const extInputs = attachExternalInputs(placed, treeNode, internal, external);
  if (!extInputs.ok) {
    return makeFailureLeaf(extInputs.reason, extInputs.detail, captureSnapshot(internal, external));
  }
  for (const r of extInputs.routings) routings.push(r);

  containerByRecipe.set(treeNode.recipeName, placed);
  const thisMN = makeMachineNode(placed, routings, labelFor(placed), captureSnapshot(internal, external));

  // 손자 처리 — 비-external 자식들 enumerate
  const grandchildren = treeNode.children.filter((c) => !c.external && c.recipeName);
  if (grandchildren.length === 0) return thisMN;

  let committed = false;
  for (const perm of permutations(grandchildren)) {
    if (signal?.aborted) break;
    for (const childDir of ['right', 'down'] as const) {
      if (signal?.aborted) break;

      wizardProgress.attempts += 1;
      await reportFn(
        `recurseMachine 손자 시도 [${perm.map((p) => p.itemName).join(',')}] dir=${childDir}`,
      );

      const branch = makeBranchNode(perm, childDir, captureSnapshot(internal, external));
      thisMN.children.push(branch);

      // 시도 — 상태 클론
      const internalAttempt = cloneArea(internal);
      const externalAttempt = cloneArea(external);
      const containerByRecipeAttempt = new Map(containerByRecipe);

      let lastParent = placed;
      let allOk = true;
      for (const grandchild of perm) {
        const childResult = await recurseMachine(
          grandchild, lastParent, childDir,
          internalAttempt, externalAttempt, containerByRecipeAttempt,
          pickMachine, signal,
        );
        branch.children.push(childResult);
        if (childResult.kind === 'failure') {
          allOk = false;
          break;
        }
        lastParent = childResult.machine;
      }

      if (allOk && !committed) {
        // First-success commit — 시도의 mutation 을 caller 의 state 로 반영.
        commitAreaInPlace(internal, internalAttempt);
        commitAreaInPlace(external, externalAttempt);
        for (const [k, v] of containerByRecipeAttempt) containerByRecipe.set(k, v);
        // 부모 라우팅 외에 손자 라우팅도 thisMN.routings 에 누적.
        const subRoutings: Routing[] = [];
        for (const branchChild of branch.children) {
          if (branchChild.kind === 'machine') collectRoutingsFromTree(branchChild, subRoutings);
        }
        for (const r of subRoutings) thisMN.routings.push(r);
        committed = true;
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
  beltEntityName: 'transport-belt',
  inserterEntityName: 'inserter',
  pipeEntityName: 'pipe',
  preferUnderground: false,
};

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
  const beltEntityName = input.primaryBelt ?? input.selectedBelts[0] ?? 'transport-belt';
  const inserterEntityName = input.primaryInserter ?? input.selectedInserters[0] ?? 'inserter';

  const undergroundPipeEntityName = input.selectedUndergroundPipes[0];
  const undergroundBeltEntityName = input.selectedUndergroundBelts[0];

  const pipeMaxUndergroundDistance = undergroundPipeEntityName
    ? lookupPipeUndergroundDistance(entityMap.get(undergroundPipeEntityName))
    : 0;
  const beltMaxUndergroundDistance = undergroundBeltEntityName
    ? entityMap.get(undergroundBeltEntityName)?.max_underground_distance ?? 0
    : 0;

  return {
    beltEntityName,
    inserterEntityName,
    pipeEntityName: 'pipe',
    undergroundPipeEntityName,
    undergroundBeltEntityName,
    pipeMaxUndergroundDistance,
    beltMaxUndergroundDistance,
    preferUnderground: !!(undergroundPipeEntityName || undergroundBeltEntityName),
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
      if (c.connection_type === 'underground' && c.max_underground_distance) {
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
function lookupProductKind(recipeName: string, itemName: string): 'item' | 'fluid' {
  const recipe = useGameDataStore.getState().recipeMap.get(recipeName);
  if (!recipe) return 'item';
  const prod = recipe.products.find((p) => p.name === itemName);
  return prod?.type ?? 'item';
}

// ─────────────────────────────────────────────────────────────────────────────
// 외부 입력 라우팅 — 한 머신의 외부 ingredient 마다 무한상자/파이프 + 라우팅
// ─────────────────────────────────────────────────────────────────────────────

type AttachResult =
  | { ok: true; routings: Routing[] }
  | { ok: false; reason: FailureLeaf['reason']; detail: string };

/**
 * 한 머신의 외부 ingredient (= treeNode 의 자식 중 external 표시이거나, 자식
 * 노드 자체가 없는 ingredient) 별로 무한상자/파이프 1개씩 두고, 이 머신과
 * 라우팅한다.
 *
 * placement-search §7.1: A↔B 사이클의 B 단계 = 그 머신의 *모든 입력 라우팅
 * (외부 + 부모와의 연결)*. 부모 라우팅은 호출자 (recurseMachine) 가 따로 처리.
 *
 * 같은 ingredient 라도 여러 머신이 소비하면 머신마다 별도 컨테이너 (Q19 a /
 * Q3 결정 — splitter 미사용).
 */
function attachExternalInputs(
  machine: Container,
  treeNode: RecipeTreeNode,
  internal: Area,
  external: Area,
): AttachResult {
  if (!treeNode.recipeName) return { ok: true, routings: [] };
  const recipe = useGameDataStore.getState().recipeMap.get(treeNode.recipeName);
  if (!recipe) return { ok: true, routings: [] };

  const routings: Routing[] = [];
  for (const ing of recipe.ingredients) {
    const childForIng = treeNode.children.find((c) => c.itemName === ing.name);
    const isExternal = !childForIng || childForIng.external || !childForIng.recipeName;
    if (!isExternal) continue;

    const chest = placeExternalContainer(
      {
        kind: ing.type === 'fluid' ? 'infinity-pipe' : 'infinity-chest',
        entityName: ing.type === 'fluid' ? 'infinity-pipe' : 'infinity-chest',
        content: ing.name,
      },
      external,
      internal,
      machine,
    );

    const portKind: PortKind = ing.type === 'fluid' ? { fluid: ing.name } : 'item';
    const attempt = routeWithFallback(chest, machine, portKind, internal, ROUTING_OPTIONS);
    if (!attempt.ok) {
      return {
        ok: false,
        reason: 'no-routing',
        detail: `외부 ${ing.name} → ${treeNode.recipeName} 라우팅 실패 (${attempt.tried.length} port 조합 시도)`,
      };
    }
    commitRouting(attempt.routing, internal);
    routings.push(attempt.routing);
  }

  return { ok: true, routings };
}

/**
 * 루트 머신의 모든 product 마다 외부 무한상자/파이프 1개씩 두고, 루트 → 무한상자
 * 라우팅. 루트 product 가 여러 개여도 각각 컨테이너 1개씩.
 */
function attachRootOutput(
  rootContainer: Container,
  tree: RecipeTreeNode,
  internal: Area,
  external: Area,
): AttachResult {
  if (!tree.recipeName) return { ok: true, routings: [] };
  const recipe = useGameDataStore.getState().recipeMap.get(tree.recipeName);
  if (!recipe) return { ok: true, routings: [] };

  const routings: Routing[] = [];
  for (const prod of recipe.products) {
    const chest = placeExternalContainer(
      {
        kind: prod.type === 'fluid' ? 'infinity-pipe' : 'infinity-chest',
        entityName: prod.type === 'fluid' ? 'infinity-pipe' : 'infinity-chest',
        content: prod.name,
      },
      external,
      internal,
      rootContainer,
    );

    const portKind: PortKind = prod.type === 'fluid' ? { fluid: prod.name } : 'item';
    const attempt = routeWithFallback(rootContainer, chest, portKind, internal, ROUTING_OPTIONS);
    if (!attempt.ok) {
      return {
        ok: false,
        reason: 'no-routing',
        detail: `루트 ${prod.name} 출력 라우팅 실패 (${attempt.tried.length} port 조합 시도)`,
      };
    }
    commitRouting(attempt.routing, internal);
    routings.push(attempt.routing);
  }

  return { ok: true, routings };
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
    id: nextNodeId('m'),
    kind: 'machine',
    machine,
    routings,
    children: [],
    label,
    snapshot,
  };
}

function makeBranchNode(
  perm: RecipeTreeNode[],
  dir: 'right' | 'down',
  snapshot?: AreaSnapshot,
): BranchNode {
  return {
    id: nextNodeId('b'),
    kind: 'branch',
    perm: perm.map((n) => n.itemName),
    dir,
    children: [],
    label: `perm=[${perm.map((n) => n.itemName).join(', ')}] dir=${dir}`,
    snapshot,
  };
}

function makeCandidateLeaf(
  internal: Area,
  external: Area,
  routings: Routing[],
  label: string,
): CandidateLeaf {
  const bbox = internal.bbox;
  const squarenessPenalty = bbox ? Math.abs(bbox.w - bbox.h) : 0;
  return {
    id: nextNodeId('c'),
    kind: 'candidate',
    internal,
    external,
    routings,
    squarenessPenalty,
    children: [],
    label,
  };
}

function makeFailureLeaf(
  reason: FailureLeaf['reason'],
  detail: string,
  snapshot?: AreaSnapshot,
): FailureLeaf {
  return {
    id: nextNodeId('f'),
    kind: 'failure',
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

function makeMachineContainer(node: RecipeTreeNode, entityName: string): Container {
  const entity = useGameDataStore.getState().entityMap.get(entityName);
  const w = entity?.tile_width ?? 3;
  const h = entity?.tile_height ?? 3;
  return {
    id: `m-${node.recipeName ?? node.itemName}-${nextNodeId('id')}`,
    kind: 'machine',
    entityName,
    origin: { x: 0, y: 0 }, // placeRootMachine / placeMachine 이 덮어쓴다
    size: { w, h },
    recipeName: node.recipeName,
  };
}

function makeEmptyArea(kind: Area['kind']): Area {
  return { kind, containers: [], placed: [], undergroundCorridors: [] };
}

function cloneArea(a: Area): Area {
  const cloned: Area = {
    kind: a.kind,
    containers: a.containers.map((c) => ({
      ...c,
      origin: { ...c.origin },
      size: { ...c.size },
    })),
    placed: a.placed.map((p) => ({ x: p.x, y: p.y, cell: { ...p.cell, tileOffset: { ...p.cell.tileOffset } } })),
    bbox: a.bbox ? { ...a.bbox } : undefined,
    undergroundCorridors: a.undergroundCorridors.map((c) => ({
      ...c,
      range: [c.range[0], c.range[1]],
    })),
  };
  return cloned;
}

function commitAreaInPlace(target: Area, source: Area): void {
  target.containers.length = 0;
  for (const c of source.containers) target.containers.push(c);
  target.placed.length = 0;
  for (const p of source.placed) target.placed.push(p);
  target.bbox = source.bbox ? { ...source.bbox } : undefined;
  target.undergroundCorridors.length = 0;
  for (const c of source.undergroundCorridors) {
    target.undergroundCorridors.push({ ...c, range: [c.range[0], c.range[1]] });
  }
}

function collectRoutingsFromTree(node: CandidateNode, out: Routing[]): void {
  if (node.kind === 'failure' || node.kind === 'candidate') return;
  if (node.kind === 'machine') {
    for (const r of node.routings) out.push(r);
  }
  for (const child of node.children) collectRoutingsFromTree(child, out);
}

function makeMachinePicker(input: ContainerWizardInput): (recipeName: string) => { name: string } | undefined {
  return (recipeName: string) => {
    const state = useGameDataStore.getState();
    const recipe = state.recipeMap.get(recipeName);
    if (!recipe) return undefined;
    for (const name of input.selectedMachines) {
      const ent = state.entityMap.get(name);
      if (ent?.crafting_categories?.includes(recipe.category)) return { name };
    }
    return undefined;
  };
}

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr.slice()];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const sub of permutations(rest)) {
      out.push([arr[i], ...sub]);
    }
  }
  return out;
}

function labelFor(c: Container): string {
  return `${c.entityName}${c.recipeName ? ` [${c.recipeName}]` : ''} @ (${c.origin.x},${c.origin.y})`;
}

function wrapResult(rootNode: MachineNode, aborted: boolean): ContainerWizardResult {
  let candidates = 0;
  let failures = 0;
  let deepest = 0;
  const walk = (node: CandidateNode, depth: number): void => {
    deepest = Math.max(deepest, depth);
    if (node.kind === 'candidate') candidates += 1;
    if (node.kind === 'failure') failures += 1;
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

function failureResult(reason: FailureLeaf['reason'], detail: string): ContainerWizardResult {
  const dummy: Container = {
    id: 'm-failure',
    kind: 'machine',
    entityName: 'unknown',
    origin: { x: 0, y: 0 },
    size: { w: 1, h: 1 },
  };
  const root = makeMachineNode(dummy, [], 'no recipe / no machine');
  root.children.push(makeFailureLeaf(reason, detail));
  return wrapResult(root, false);
}

