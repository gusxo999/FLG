/**
 * 오케스트레이터 — A↔B 사이클 + 완전 탐색.
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §7 / §8 / Q11 / Q20 / Q26 / Q28.
 *
 * 컨테이너 모델 v2 의 진입점. 새 위저드 입력 (`ContainerWizardInput`) 을
 * 받아 후보 트리 (`CandidateTree`) 를 생성한다.
 *
 * **1차 구현 범위:**
 *   - depth 0 (root 만) — 후보 1개 생성.
 *   - depth 1 (root + 직접 자식) — 자식 형제 순서 n! × 방향 2 = 2n! 후보.
 *
 * **이번 커밋의 미구현 (follow-up):**
 *   - depth ≥ 2 손자 재귀 — 현재는 손자가 있는 노드를 만나면 *external* 처럼
 *     처리 (= 그 자식을 leaf 로 두고 라우팅 안 함).
 *   - 외부 영역 IO (무한상자/파이프) 배치 + 통합.
 *   - 라우팅 fallback (다른 port 셀 시도).
 *   - 완전 탐색 진행 중 후보 깊이/형제 진행률 정확 계산 (현재는 단순 카운터).
 */

import { useGameDataStore } from '../../store/gameDataStore';
import { computeContainerCounts } from './containerCounts';
import type {
  Area,
  BranchNode,
  CandidateLeaf,
  CandidateTree,
  Container,
  ContainerWizardInput,
  ContainerWizardResult,
  FailureLeaf,
  MachineNode,
  ProgressReporter,
  Routing,
  RunContainerWizard,
} from './containerModel';
import { commitRouting, routePorts } from './containerRouting';
import { placeMachine, placeRootMachine } from './machinePlacer';
import { resolvePortPair } from './portInference';
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

/**
 * 새 위저드의 단일 진입점.
 */
export const runContainerWizard: RunContainerWizard = async (
  input: ContainerWizardInput,
  hooks?: {
    onProgress?: ProgressReporter;
    signal?: AbortSignal;
  },
): Promise<ContainerWizardResult> => {
  const { recipeMap, itemToRecipe } = useGameDataStore.getState();

  // 1. 트리 펼침 + 머신 수 산정 (1차는 minimum 모드 고정).
  const tree = assignMinimumCounts(
    expandRecipeTree(input.targetRecipe, recipeMap, itemToRecipe, input.externalIngredients),
  );

  // 2. 머신 매핑.
  const pickMachine = makeMachinePicker(input);
  const rootMachineEntity = tree.recipeName ? pickMachine(tree.recipeName) : undefined;
  if (!tree.recipeName || !rootMachineEntity) {
    return failureResult(tree, 'no-machine-match');
  }

  // 3. 자식 enumerate — 비-external 만이 머신으로 배치됨.
  const children = tree.children.filter((c) => !c.external && c.recipeName);

  // 4. depth 0 / depth 1 분기.
  if (children.length === 0) {
    return runDepthZero(tree, rootMachineEntity, input, hooks);
  }
  return runDepthOne(tree, rootMachineEntity, children, pickMachine, input, hooks);
};

/**
 * 후보 트리에서 *평탄화된 성공 후보 배열* 만 추출 — UI 의 후보 갤러리 / O1
 * 점수 기반 정렬에 사용. 작은 squarenessPenalty 가 앞쪽.
 */
export function flattenCandidates(tree: CandidateTree): CandidateLeaf[] {
  const out: CandidateLeaf[] = [];
  const walk = (node: MachineNode | BranchNode | CandidateLeaf | FailureLeaf): void => {
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
// depth 0 — root 머신 1개만
// ─────────────────────────────────────────────────────────────────────────────

function runDepthZero(
  tree: RecipeTreeNode,
  rootEntity: { name: string },
  _input: ContainerWizardInput,
  hooks: { onProgress?: ProgressReporter; signal?: AbortSignal } | undefined,
): ContainerWizardResult {
  const aborted = !!hooks?.signal?.aborted;
  const internal = makeEmptyArea('internal');
  const external = makeEmptyArea('external');

  const rootContainer = makeMachineContainer(tree, rootEntity.name);
  const placed = placeRootMachine(rootContainer, internal);

  let rootNode: MachineNode;
  if (!placed) {
    rootNode = makeMachineNode(rootContainer, [], `${rootEntity.name} placement failed`);
    rootNode.children.push(makeFailureLeaf('no-routing', 'root placement collision'));
  } else {
    rootNode = makeMachineNode(placed, [], labelFor(placed));
    const candidate = makeCandidateLeaf(internal, external, [], 'depth-0 candidate');
    rootNode.children.push(candidate);
  }

  hooks?.onProgress?.({
    depth: 0,
    siblingIndex: 0,
    siblingTotal: 1,
    candidatesGenerated: rootNode.children.some((c) => c.kind === 'candidate') ? 1 : 0,
    failuresGenerated: rootNode.children.some((c) => c.kind === 'failure') ? 1 : 0,
  });

  return wrapResult(rootNode, aborted);
}

// ─────────────────────────────────────────────────────────────────────────────
// depth 1 — root + 직접 자식들 (자식 형제 순서 perm × 자식 위치 dir 완전 탐색)
// ─────────────────────────────────────────────────────────────────────────────

function runDepthOne(
  tree: RecipeTreeNode,
  rootEntity: { name: string },
  children: RecipeTreeNode[],
  pickMachine: (recipeName: string) => { name: string } | undefined,
  _input: ContainerWizardInput,
  hooks: { onProgress?: ProgressReporter; signal?: AbortSignal } | undefined,
): ContainerWizardResult {
  // root 노드는 *모든* (perm × dir) 후보의 부모이므로 한 번만 만든다.
  const rootContainer = makeMachineContainer(tree, rootEntity.name);
  const rootNode = makeMachineNode(rootContainer, [], labelFor(rootContainer));

  let candidatesGenerated = 0;
  let failuresGenerated = 0;
  let aborted = false;

  const perms = permutations(children);
  const dirs: Array<'right' | 'down'> = ['right', 'down'];
  const totalBranches = perms.length * dirs.length;
  let branchIdx = 0;

  for (const perm of perms) {
    for (const dir of dirs) {
      branchIdx += 1;
      if (hooks?.signal?.aborted) {
        aborted = true;
        break;
      }

      const branch = makeBranchNode(perm, dir);
      rootNode.children.push(branch);

      const result = tryDepthOneBranch(rootContainer, perm, dir, pickMachine);
      if (result.kind === 'candidate') {
        branch.children.push(result);
        candidatesGenerated += 1;
      } else {
        branch.children.push(result);
        failuresGenerated += 1;
      }

      hooks?.onProgress?.({
        depth: 1,
        siblingIndex: branchIdx,
        siblingTotal: totalBranches,
        candidatesGenerated,
        failuresGenerated,
      });
    }
    if (aborted) break;
  }

  return wrapResult(rootNode, aborted);
}

/**
 * 한 (perm × dir) 후보 가지의 시도. 성공이면 CandidateLeaf, 실패면 FailureLeaf.
 */
function tryDepthOneBranch(
  rootContainer: Container,
  perm: RecipeTreeNode[],
  dir: 'right' | 'down',
  pickMachine: (recipeName: string) => { name: string } | undefined,
): CandidateLeaf | FailureLeaf {
  const internal = makeEmptyArea('internal');
  const external = makeEmptyArea('external');

  // root 배치
  const root = placeRootMachine({ ...rootContainer }, internal);
  if (!root) {
    return makeFailureLeaf('no-routing', 'root collision');
  }

  const allRoutings: Routing[] = [];

  // 자식 순회
  let parent: Container = root;
  for (const childNode of perm) {
    if (!childNode.recipeName) {
      return makeFailureLeaf('no-machine-match', `${childNode.itemName} 의 레시피 없음`);
    }
    const childEntity = pickMachine(childNode.recipeName);
    if (!childEntity) {
      return makeFailureLeaf('no-machine-match', `${childNode.recipeName} 매칭 머신 없음`);
    }
    const childContainer = makeMachineContainer(childNode, childEntity.name);
    const placedChild = placeMachine(parent, childContainer, dir, internal);
    if (!placedChild) {
      return makeFailureLeaf('no-routing', `${childNode.recipeName} 충돌`);
    }
    // 자식 → 부모 (= root) 라우팅 — 자식이 만든 product 를 root 의 ingredient 로.
    const itemName = childNode.itemName;
    const pair = resolvePortPair(placedChild, root, 'item');
    if (!pair) {
      return makeFailureLeaf('no-routing', `${itemName} port 매칭 실패`);
    }
    const attempt = routePorts(pair, internal, {
      beltEntityName: 'transport-belt',
      inserterEntityName: 'inserter',
      pipeEntityName: 'pipe',
      preferUnderground: false,
    });
    if (!attempt.ok) {
      return makeFailureLeaf('no-routing', `${itemName} 라우팅 실패: ${attempt.reason}`);
    }
    commitRouting(attempt.routing, internal);
    allRoutings.push(attempt.routing);

    // 다음 자식은 *방금 배치된 자식* 옆에 (= 직렬). 이는 1차 배치 정책이며,
    // 다른 정책 (예: 모든 자식이 부모 옆에 직접) 은 follow-up 에서 후보로 추가.
    parent = placedChild;
  }

  return makeCandidateLeaf(internal, external, allRoutings, `perm=[${perm
    .map((n) => n.itemName)
    .join(', ')}] dir=${dir}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 후보 트리 / 노드 생성 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function makeMachineNode(
  machine: Container,
  routings: Routing[],
  label: string,
): MachineNode {
  return {
    id: nextNodeId('m'),
    kind: 'machine',
    machine,
    routings,
    children: [],
    label,
  };
}

function makeBranchNode(perm: RecipeTreeNode[], dir: 'right' | 'down'): BranchNode {
  return {
    id: nextNodeId('b'),
    kind: 'branch',
    perm: perm.map((n) => n.itemName),
    dir,
    children: [],
    label: `perm=[${perm.map((n) => n.itemName).join(', ')}] dir=${dir}`,
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
): FailureLeaf {
  return {
    id: nextNodeId('f'),
    kind: 'failure',
    reason,
    children: [],
    label: `${reason}: ${detail}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 기타 유틸
// ─────────────────────────────────────────────────────────────────────────────

function makeMachineContainer(node: RecipeTreeNode, entityName: string): Container {
  return {
    id: `m-${node.recipeName ?? node.itemName}-${nextNodeId('id')}`,
    kind: 'machine',
    entityName,
    origin: { x: 0, y: 0 }, // placeRootMachine / placeMachine 이 덮어쓴다
    size: { w: 3, h: 3 }, // TODO: gameData 에서 entity.tile_width × tile_height 조회
    recipeName: node.recipeName,
  };
}

function makeEmptyArea(kind: Area['kind']): Area {
  return { kind, containers: [], placed: [] };
}

function makeMachinePicker(input: ContainerWizardInput): (recipeName: string) => { name: string } | undefined {
  // 매우 단순한 매칭: 첫 selected 머신 중 해당 레시피 카테고리를 처리할 수 있는 것.
  // legacy `pickMachineForRecipe` 와 동일 의도이지만 deps 로 받지 않고 store 에서 직접 조회.
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
  const walk = (node: MachineNode | BranchNode | CandidateLeaf | FailureLeaf, depth: number): void => {
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

function failureResult(_tree: RecipeTreeNode, reason: FailureLeaf['reason']): ContainerWizardResult {
  const dummyContainer: Container = {
    id: 'm-failure',
    kind: 'machine',
    entityName: 'unknown',
    origin: { x: 0, y: 0 },
    size: { w: 1, h: 1 },
  };
  const root = makeMachineNode(dummyContainer, [], 'no recipe / no machine');
  root.children.push(makeFailureLeaf(reason, 'tree expansion failed'));
  return wrapResult(root, false);
}
