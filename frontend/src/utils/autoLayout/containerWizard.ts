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
 *   - 외부 영역 IO — 무한상자/무한파이프 1×1 줄 자동 배치 (외부 입력 + 루트 출력).
 *
 * **follow-up (별도 커밋):**
 *   - 내부 레벨까지 *완전한 cross-product 후보* 생성 (현재는 first-success)
 *   - 외부 → 내부 라우팅 (현재는 외부 영역에 무한상자만 두고 라우팅 없음)
 *   - 라우팅 fallback (다른 port 셀 시도) — Q21 / §7.4
 *   - fluid 라우팅 — containerRouting.ts 가 처리할 자리
 */

import { useGameDataStore } from '../../store/gameDataStore';
import type { Recipe } from '../../store/gameDataStore';
import type {
  Area,
  AreaSnapshot,
  BranchNode,
  CandidateLeaf,
  CandidateNode,
  CandidateTree,
  Container,
  ContainerPort,
  ContainerWizardInput,
  ContainerWizardResult,
  FailureLeaf,
  MachineNode,
  PortKind,
  PortPair,
  ProgressReporter,
  Routing,
  RoutingAttempt,
  RunContainerWizard,
} from './containerModel';
import { commitRouting, routePorts } from './containerRouting';
import { placeExternalContainer } from './externalPlacer';
import { placeMachine, placeRootMachine } from './machinePlacer';
import { enumerateContainerPorts, resolvePortPair } from './portInference';
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
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

export const runContainerWizard: RunContainerWizard = async (
  input: ContainerWizardInput,
  hooks?: {
    onProgress?: ProgressReporter;
    signal?: AbortSignal;
  },
): Promise<ContainerWizardResult> => {
  const { recipeMap, itemToRecipe } = useGameDataStore.getState();

  // 1. 레시피 트리 펼침 + 머신 수 산정 (1차는 minimum 모드 고정).
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

  let candidatesGenerated = 0;
  let failuresGenerated = 0;
  let aborted = false;

  if (directChildren.length === 0) {
    // depth 0 — root 만.
    const candidateOrFailure = buildSingleAttempt(tree, rootContainer, [], 'right', pickMachine, hooks?.signal);
    if (candidateOrFailure.kind === 'candidate') {
      rootNode.children.push(candidateOrFailure);
      candidatesGenerated += 1;
    } else {
      rootNode.children.push(candidateOrFailure);
      failuresGenerated += 1;
    }
    hooks?.onProgress?.({
      depth: 0,
      siblingIndex: 1,
      siblingTotal: 1,
      candidatesGenerated,
      failuresGenerated,
    });
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

        const branch = makeBranchNode(perm, dir);
        rootNode.children.push(branch);

        const result = buildSingleAttempt(tree, rootContainer, perm, dir, pickMachine, hooks?.signal);
        if (result.kind === 'candidate') {
          // 자식 머신 노드들도 트리에 표시 — 디버깅용.
          for (const c of result.children) branch.children.push(c);
          result.children = []; // 후보 leaf 자체는 children 비움 (UI 가 leaf 로 인식)
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
    }
  }

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
function buildSingleAttempt(
  tree: RecipeTreeNode,
  rootContainer: Container,
  rootPerm: RecipeTreeNode[],
  rootDir: 'right' | 'down',
  pickMachine: (recipeName: string) => { name: string } | undefined,
  signal: AbortSignal | undefined,
): (CandidateLeaf & { children: CandidateNode[] }) | FailureLeaf {
  const internal: Area = makeEmptyArea('internal');
  const external: Area = makeEmptyArea('external');
  const containerByRecipe = new Map<string, Container>();

  // 1. 루트 배치
  const placedRoot = placeRootMachine({ ...rootContainer }, internal);
  if (!placedRoot) {
    return makeFailureLeaf('no-routing', 'root placement collision', captureSnapshot(internal, external));
  }
  if (tree.recipeName) containerByRecipe.set(tree.recipeName, placedRoot);

  // 2. 자식 DFS 재귀
  const childMachineNodes: CandidateNode[] = [];
  let lastParent = placedRoot;
  const allRoutings: Routing[] = [];
  for (const child of rootPerm) {
    if (signal?.aborted) {
      return makeFailureLeaf('aborted', 'user cancelled', captureSnapshot(internal, external));
    }
    const childResult = recurseMachine(
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

  // 3. 외부 IO 채우기 (모든 머신 배치 후)
  populateExternalIO(tree, containerByRecipe, external);

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
function recurseMachine(
  treeNode: RecipeTreeNode,
  parent: Container,
  dir: 'right' | 'down',
  internal: Area,
  external: Area,
  containerByRecipe: Map<string, Container>,
  pickMachine: (recipeName: string) => { name: string } | undefined,
  signal: AbortSignal | undefined,
): MachineNode | FailureLeaf {
  if (!treeNode.recipeName) {
    return makeFailureLeaf('no-machine-match', `${treeNode.itemName} 의 레시피 없음`, captureSnapshot(internal, external));
  }
  const machineEntity = pickMachine(treeNode.recipeName);
  if (!machineEntity) {
    return makeFailureLeaf('no-machine-match', `${treeNode.recipeName} 머신 매칭 실패`, captureSnapshot(internal, external));
  }

  const machineContainer = makeMachineContainer(treeNode, machineEntity.name);
  const placed = placeMachine(parent, machineContainer, dir, internal);
  if (!placed) {
    return makeFailureLeaf('no-routing', `${treeNode.recipeName} 배치 충돌`, captureSnapshot(internal, external));
  }

  // Route this → parent — kind 는 흐르는 content (item/fluid) 에서 결정.
  // treeNode.itemName 은 부모로 흘러 들어가는 자식의 product 이름.
  const flowKind = lookupProductKind(treeNode.recipeName, treeNode.itemName);
  const routeKind: PortKind = flowKind === 'fluid' ? { fluid: treeNode.itemName } : 'item';

  const routings: Routing[] = [];
  const routeResult = routeWithFallback(placed, parent, routeKind, internal);
  if (!routeResult.ok) {
    return makeFailureLeaf('no-routing', `${treeNode.itemName} 라우팅 실패 — ${routeResult.tried.length} port 조합 시도`, captureSnapshot(internal, external));
  }
  commitRouting(routeResult.routing, internal);
  routings.push(routeResult.routing);

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

      const branch = makeBranchNode(perm, childDir, captureSnapshot(internal, external));
      thisMN.children.push(branch);

      // 시도 — 상태 클론
      const internalAttempt = cloneArea(internal);
      const externalAttempt = cloneArea(external);
      const containerByRecipeAttempt = new Map(containerByRecipe);

      let lastParent = placed;
      let allOk = true;
      for (const grandchild of perm) {
        const childResult = recurseMachine(
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
// 라우팅 fallback — 그리디 실패 시 다른 port 셀 시도 (placement-search §7.4)
// ─────────────────────────────────────────────────────────────────────────────

const ROUTING_OPTIONS = {
  beltEntityName: 'transport-belt',
  inserterEntityName: 'inserter',
  pipeEntityName: 'pipe',
  preferUnderground: false,
} as const;

/**
 * 그리디 매칭 → 실패 시 모든 port 조합을 manhattan 거리 오름차순으로 시도.
 * 어느 조합이라도 라우팅 성공하면 그 라우팅 반환. 모두 실패면 ok=false + 시도 목록.
 *
 * routePorts 자체는 area 를 mutate 하지 않으므로 (commitRouting 이 따로) 시도 중에
 * 영역 상태를 더럽히지 않는다.
 */
function routeWithFallback(
  producer: Container,
  consumer: Container,
  kind: PortKind,
  internal: Area,
): RoutingAttempt {
  // 1. 그리디 시도
  const greedy = resolvePortPair(producer, consumer, kind);
  if (greedy) {
    const attempt = routePorts(greedy, internal, ROUTING_OPTIONS);
    if (attempt.ok) return attempt;
  }

  // 2. 모든 port 조합 enumerate, 그리디 페어는 제외
  const producerPorts = enumerateContainerPorts(producer, kind);
  const consumerPorts = enumerateContainerPorts(consumer, kind);
  if (producerPorts.length === 0 || consumerPorts.length === 0) {
    return { ok: false, reason: 'no-port-pair', tried: greedy ? [greedy] : [] };
  }

  type Cand = { pair: PortPair; dist: number };
  const candidates: Cand[] = [];
  for (const p of producerPorts) {
    for (const c of consumerPorts) {
      if (greedy && samePort(p, greedy.producer) && samePort(c, greedy.consumer)) continue;
      const dist = Math.abs(p.cell.x - c.cell.x) + Math.abs(p.cell.y - c.cell.y);
      candidates.push({ pair: { producer: p, consumer: c }, dist });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);

  const tried: PortPair[] = greedy ? [greedy] : [];
  for (const cand of candidates) {
    tried.push(cand.pair);
    const attempt = routePorts(cand.pair, internal, ROUTING_OPTIONS);
    if (attempt.ok) return attempt;
  }

  return { ok: false, reason: 'no-path', tried };
}

function samePort(a: ContainerPort, b: ContainerPort): boolean {
  return a.cell.x === b.cell.x && a.cell.y === b.cell.y;
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
// 외부 IO 채우기 — 비-external 노드의 외부 ingredient + 루트 product
// ─────────────────────────────────────────────────────────────────────────────

function populateExternalIO(
  tree: RecipeTreeNode,
  containerByRecipe: Map<string, Container>,
  external: Area,
): void {
  const recipeMap = useGameDataStore.getState().recipeMap;

  const seen = new Set<string>(); // 중복 (예: 같은 ingredient 이름이 여러 머신에 들어가는 경우) 방지

  const walk = (node: RecipeTreeNode): void => {
    if (node.external || !node.recipeName) return;
    const recipe: Recipe | undefined = recipeMap.get(node.recipeName);
    if (recipe) {
      for (const ing of recipe.ingredients) {
        const childForIng = node.children.find((c) => c.itemName === ing.name);
        // external 로 판정되는 조건: 자식이 없거나, 자식이 external 표시되었거나, 자식에 recipeName 이 없음.
        const isExternal = !childForIng || childForIng.external || !childForIng.recipeName;
        if (!isExternal) continue;
        const key = `in:${ing.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        placeExternalContainer(
          {
            kind: ing.type === 'fluid' ? 'infinity-pipe' : 'infinity-chest',
            entityName: ing.type === 'fluid' ? 'infinity-pipe' : 'infinity-chest',
            content: ing.name,
          },
          external,
        );
      }
    }
    for (const c of node.children) walk(c);
  };
  walk(tree);

  // 루트 product 출력
  if (tree.recipeName) {
    const rootRecipe = recipeMap.get(tree.recipeName);
    if (rootRecipe) {
      for (const prod of rootRecipe.products) {
        const key = `out:${prod.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        placeExternalContainer(
          {
            kind: prod.type === 'fluid' ? 'infinity-pipe' : 'infinity-chest',
            entityName: prod.type === 'fluid' ? 'infinity-pipe' : 'infinity-chest',
            content: prod.name,
          },
          external,
        );
      }
    }
  }

  // containerByRecipe 미사용 — 후속 외부→내부 라우팅에서 활용.
  void containerByRecipe;
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
  return { kind, containers: [], placed: [] };
}

function cloneArea(a: Area): Area {
  const cloned: Area = {
    kind: a.kind,
    containers: a.containers.map((c) => ({ ...c, origin: { ...c.origin }, size: { ...c.size } })),
    placed: a.placed.map((p) => ({ x: p.x, y: p.y, cell: { ...p.cell, tileOffset: { ...p.cell.tileOffset } } })),
    bbox: a.bbox ? { ...a.bbox } : undefined,
  };
  return cloned;
}

function commitAreaInPlace(target: Area, source: Area): void {
  target.containers.length = 0;
  for (const c of source.containers) target.containers.push(c);
  target.placed.length = 0;
  for (const p of source.placed) target.placed.push(p);
  target.bbox = source.bbox ? { ...source.bbox } : undefined;
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

