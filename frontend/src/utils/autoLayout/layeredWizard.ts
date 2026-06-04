/**
 * 전략 S-LAYER — 계층화 DAG 레이아웃 + 채널 라우팅 (Sugiyama 프레임워크).
 *
 * 단일 출처: docs/auto-layout-wizard.s-layer-channel-reservation.md.
 *
 * 기존 완전탐색(S-EXH, [containerWizard.ts](./containerWizard.ts)) 와 **병행**하는
 * 대체 배치 전략. 디버그 탭의 `AUTO_LAYOUT_ALGORITHM` 토글이 'layered' 일 때
 * `AutoLayoutContainerPanel` 이 본 함수를 호출한다. 출력 타입
 * (`ContainerWizardResult`) 은 S-EXH 와 동일하므로 후보 적용 / 라우팅 편집 /
 * 그리드 적용 파이프라인을 그대로 재사용한다.
 *
 * **핵심 아이디어 (vs S-EXH):**
 *   - S-EXH 는 "부모 옆 빈자리"에 그리디로 놓고 곧바로 라우팅을 시도하다 막히면
 *     perm(n!)×dir(2) 로 백트래킹한다 (지수).
 *   - S-LAYER 는 레시피 깊이를 **레이어(열)** 로, 레이어 사이에 빈 **채널**을 두고
 *     머신을 tidy-tree 로 배치한다. 채널이 항상 비어 있어 라우팅이 구조적으로
 *     보장되며, 결정적 단일 후보를 O(V+E) 로 생성한다.
 *
 * **v1 범위 / follow-up:**
 *   - 채널 라우팅은 기존 BFS 라우터(`routeWithFallback`)를 그대로 사용한다.
 *     열 사이 간격(CHANNEL_GAP)·머신 간격(ROW_GAP)을 넉넉히 둬 라우터가 채널을
 *     통로로 쓰게 한다 (= 명시적 채널 트랙 배정은 follow-up; 문서 §5).
 *   - 레이어 내 정렬은 tidy-tree(부모를 자식 중앙에 정렬) 로 충분 — barycenter
 *     교차 최소화는 공유 부분트리(DAG) 도입 시 follow-up (문서 §1, §6 더미 노드).
 *   - 공유 무한상자 병합(MERGE) 미적용 — 1:1 perimeter wrap 만.
 */

import { useGameDataStore } from "../../store/gameDataStore";
import type {
  Area,
  CandidateLeaf,
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
} from "./containerModel";
import type { RecipeTreeNode } from "./types";
import {
  assignMinimumCounts,
  assignThroughputCounts,
  expandRecipeTree,
} from "./recipeTree";
import {
  makeEmptyArea,
  makeMachinePicker,
  makeMachineParamsLookup,
} from "./wizardUtils";
import { commitContainer } from "./machinePlacer";
import { commitRouting } from "./containerRouting";
import { placeExternalContainer } from "./externalPlacer";
import { wrapExternalsAroundPerimeter } from "./areaUnification";
import { routeWithFallback } from "./routeFallback";
import { buildRoutingOptions } from "./containerWizard";

// ─────────────────────────────────────────────────────────────────────────────
// 레이아웃 상수 — 문서 §4 (채널 폭) / §5 (트랙)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 인접 레이어(열) 사이 채널 폭. 아이템 체인(투입기+벨트+투입기)의 최소 3 보다
 * 넉넉히 둬, 한 채널을 여러 연결이 공유해도 BFS 라우터가 세로로 우회할 공간을 준다.
 * (문서 §4 — 명시적 트랙 배정 전의 v1 보수값.)
 */
const CHANNEL_GAP = 6;

/** 같은 열 안에서 머신끼리의 세로 간격 — 투입기/벨트가 사이를 지날 공간. */
const ROW_GAP = 3;

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
  const emit = makeEmitter(hooks?.onProgress);

  // 1. 레시피 트리 + 머신 수 산정 (S-EXH 와 동일 모듈 재사용).
  emit("expandRecipeTree");
  const expanded = expandRecipeTree(
    input.targetRecipe,
    recipeMap,
    itemToRecipe,
    input.externalIngredients,
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

  // 3. 열(레이어) x 좌표 — 깊이별 최대 머신 폭 + 채널 폭 누적.
  //    열 0(루트)이 가장 왼쪽, 깊은 레이어(생산자)가 오른쪽으로 확장된다.
  const colWidth: number[] = new Array(maxDepth + 1).fill(0);
  for (const meta of metas.values()) {
    colWidth[meta.depth] = Math.max(colWidth[meta.depth], meta.w);
  }
  const colX: number[] = new Array(maxDepth + 1).fill(0);
  for (let d = 1; d <= maxDepth; d++) {
    colX[d] = colX[d - 1] + colWidth[d - 1] + CHANNEL_GAP;
  }

  // 4. tidy-tree 세로 배치 — 부모를 자식들의 중앙에 정렬 (Reingold–Tilford 풍).
  emit("layerAssignment + ordering");
  const topY = new Map<RecipeTreeNode, number>();
  const cursor = { y: 0 };
  const heightOf = (node: RecipeTreeNode): number => {
    const m = metas.get(node)!;
    return m.count * m.h + (m.count - 1) * ROW_GAP;
  };
  const layout = (node: RecipeTreeNode): number => {
    const children = node.children.filter((c) => metas.has(c));
    if (children.length === 0) {
      const top = cursor.y;
      topY.set(node, top);
      cursor.y = top + heightOf(node) + SUBTREE_GAP;
      return top + heightOf(node) / 2;
    }
    const centers = children.map(layout);
    const center = (centers[0] + centers[centers.length - 1]) / 2;
    topY.set(node, center - heightOf(node) / 2);
    return center;
  };
  layout(tree);

  // 4b. 열 단위 겹침 안전 스윕 — tidy 결과의 반올림·키 큰 노드가 같은 열에서
  //     겹치지 않도록 아래로 민다 (정합성 C1 보장).
  const byDepth = new Map<number, RecipeTreeNode[]>();
  for (const node of order) {
    const d = metas.get(node)!.depth;
    (byDepth.get(d) ?? byDepth.set(d, []).get(d)!).push(node);
  }
  for (const nodes of byDepth.values()) {
    nodes.sort((a, b) => topY.get(a)! - topY.get(b)!);
    let prevBottom = -Infinity;
    for (const node of nodes) {
      let t = Math.round(topY.get(node)!);
      if (t < prevBottom + SUBTREE_GAP) t = prevBottom + SUBTREE_GAP;
      topY.set(node, t);
      prevBottom = t + heightOf(node);
    }
  }

  // 5. 머신 배치 — 각 노드의 N대를 같은 열에 세로로 쌓아 commit.
  emit("coordinate + placeMachines");
  const internal: Area = makeEmptyArea("internal");
  const external: Area = makeEmptyArea("external");
  const machinesOf = new Map<RecipeTreeNode, Container[]>();
  for (const node of order) {
    const m = metas.get(node)!;
    const baseTop = Math.round(topY.get(node)!);
    const list: Container[] = [];
    for (let i = 0; i < m.count; i++) {
      const c: Container = {
        id: nextId(`m-${node.recipeName}`),
        kind: "machine",
        entityName: m.entityName,
        origin: { x: colX[m.depth], y: baseTop + i * (m.h + ROW_GAP) },
        size: { w: m.w, h: m.h },
        recipeName: node.recipeName,
      };
      commitContainer(c, internal);
      list.push(c);
    }
    machinesOf.set(node, list);
  }

  // 6. 채널 라우팅 — 각 비-루트 노드의 머신을 부모(소비자) 대표 머신으로 연결.
  //    채널이 비어 있으므로 BFS 라우터가 거의 항상 성공한다.
  emit("channelRouting");
  const options = buildRoutingOptions(input);
  const routings: Routing[] = [];
  let routeFailures = 0;
  for (const node of order) {
    if (hooks?.signal?.aborted) break;
    const parent = parentOf.get(node);
    if (!parent) continue; // 루트 — 소비자가 외부 출력(아래에서 처리)
    const consumer = machinesOf.get(parent)![0]; // 부모 대표 머신
    const kind: PortKind =
      productKind(node.recipeName!, node.itemName) === "fluid"
        ? { fluid: node.itemName }
        : "item";
    for (const producer of machinesOf.get(node)!) {
      const attempt = routeWithFallback(producer, consumer, kind, internal, options);
      if (attempt.ok) {
        commitRouting(attempt.routing, internal);
        routings.push(attempt.routing);
      } else {
        routeFailures += 1;
      }
    }
  }

  // 7. 외부 입력 — 머신마다 external ingredient 당 무한상자/파이프 1개 등록.
  emit("attachExternalInputs");
  const connections: PendingConnection[] = [];
  for (const node of order) {
    const recipe = recipeMap.get(node.recipeName!);
    if (!recipe) continue;
    for (const ing of recipe.ingredients) {
      const childForIng = node.children.find((c) => c.itemName === ing.name);
      const isExternal = !childForIng || childForIng.external || !childForIng.recipeName;
      if (!isExternal) continue;
      const portKind: PortKind = ing.type === "fluid" ? { fluid: ing.name } : "item";
      for (const machine of machinesOf.get(node)!) {
        const chest = placeExternalContainer(
          {
            kind: ing.type === "fluid" ? "infinity-pipe" : "infinity-chest",
            entityName: ing.type === "fluid" ? "infinity-pipe" : "infinity-chest",
            content: ing.name,
          },
          external,
          internal,
        );
        connections.push({ producerId: chest.id, consumerId: machine.id, kind: portKind });
      }
    }
  }

  // 8. 루트 출력 — 루트 머신의 product 당 무한상자/파이프 1개.
  emit("attachRootOutput");
  const rootRep = machinesOf.get(tree)![0];
  const rootRecipe = recipeMap.get(tree.recipeName);
  if (rootRecipe) {
    for (const prod of rootRecipe.products) {
      const portKind: PortKind = prod.type === "fluid" ? { fluid: prod.name } : "item";
      const chest = placeExternalContainer(
        {
          kind: prod.type === "fluid" ? "infinity-pipe" : "infinity-chest",
          entityName: prod.type === "fluid" ? "infinity-pipe" : "infinity-chest",
          content: prod.name,
        },
        external,
        internal,
      );
      connections.push({ producerId: rootRep.id, consumerId: chest.id, kind: portKind });
    }
  }

  // 9. 외부 컨테이너를 perimeter ring 에 배치 + 라우팅 (S-EXH 와 동일 패스).
  emit("wrapExternalsAroundPerimeter");
  wrapExternalsAroundPerimeter(internal, external, routings, connections, options);

  // 10. 단일 후보 leaf + 트리 래핑.
  emit("완료");
  const bbox = internal.bbox;
  const squarenessPenalty = bbox ? Math.abs(bbox.w - bbox.h) : 0;
  const leaf: CandidateLeaf = {
    id: nextId("c"),
    kind: "candidate",
    internal,
    external,
    routings,
    squarenessPenalty,
    children: [],
    label:
      `S-LAYER · ${order.length} 노드 · ${routings.length} 라우팅` +
      (routeFailures > 0 ? ` · ⚠ ${routeFailures} 라우팅 실패` : ""),
    sourcePerm: [],
    sourceDir: "right",
  };

  const rootNode: MachineNode = {
    id: nextId("root"),
    kind: "machine",
    machine: rootRep,
    routings: [],
    children: [leaf],
    label: `S-LAYER root [${tree.recipeName}]`,
  };

  const candidateTree: CandidateTree = {
    root: rootNode,
    candidates: [leaf],
    aborted: hooks?.signal?.aborted ?? false,
    stats: {
      candidatesGenerated: 1,
      failuresGenerated: routeFailures > 0 ? 1 : 0,
      deepestDepth: maxDepth,
    },
  };

  return { ok: true, tree: candidateTree, partial: candidateTree.aborted };
};

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/** 한 레시피의 product 중 itemName 의 type (item/fluid) 조회 — 라우팅 kind 결정. */
function productKind(recipeName: string, itemName: string): "item" | "fluid" {
  const recipe = useGameDataStore.getState().recipeMap.get(recipeName);
  if (!recipe) return "item";
  return recipe.products.find((p) => p.name === itemName)?.type ?? "item";
}

/** onProgress 콜백을 phase 이름만으로 호출하는 얇은 래퍼. */
function makeEmitter(cb: ProgressReporter | undefined): (name: string) => void {
  return (name: string) => {
    cb?.({
      depth: 0,
      siblingIndex: 1,
      siblingTotal: 1,
      candidatesGenerated: name === "완료" ? 1 : 0,
      failuresGenerated: 0,
      currentFunction: name,
      attempts: 1,
    });
  };
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
