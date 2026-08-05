/**
 * 자동 배치 **진입점** — 레시피 하나를 받아 후보 트리 하나를 낸다.
 *
 * `AutoLayoutContainerPanel` 이 `runLayeredWizard` 를 직접 호출한다.
 *
 * **이 파일이 하는 일은 셋뿐이다:**
 *   1. 레시피 트리를 펼치고 머신 수를 정한다 (`recipeTree`).
 *   2. 노드마다 머신을 고르고 메타(footprint·대수·깊이)를 모은다.
 *   3. 배치를 [tryRunModulePipeline] 에 맡기고, 그 결과를 후보 트리로 감싼다.
 *
 * **배치 알고리즘은 여기 없다.** `planner/moduleWizard.ts` 가 소유한다 —
 * 단일 출처: docs/auto-layout-wizard.placement-search.md.
 *
 * ## 이름이 역사를 담고 있다 (2026-07-25)
 * `layeredWizard`·`runLayeredWizard` 의 "layered" 는 옛 전략 **S-LAYER**(계층화 DAG +
 * tidy-tree 배치 + 채널 BFS 라우팅)에서 왔다. 그 알고리즘은 Phase 3 에서 삭제됐고
 * (모듈 파이프라인이 채널 예약을 상위 호환으로 계승 — docs/…channel-geometry-reservation.md),
 * 지금 이 파일에 레이어도 tidy-tree 도 없다. 이름만 남아 있다. 개명은 호출부 4곳이
 * 걸려 별도 작업으로 둔다.
 */

import { useGameDataStore } from "../UI/store/gameDataStore";
import type {
  CandidateTree,
  Container,
  ContainerWizardInput,
  ContainerWizardResult,
  MachineNode,
  ProgressReporter,
  RunContainerWizard,
} from "./containerModel";
import type { RecipeTreeNode } from "./types";
import {
  assignMinimumCounts,
  assignThroughputCounts,
  expandRecipeTree,
} from "./recipeTree";
import { makeMachinePicker, makeMachineParamsLookup } from "./wizardUtils";
import { tryRunModulePipeline } from "./planner/moduleWizard";
import { describeIssue, type LayoutIssue, type LayoutSnapshot } from "./layoutIssue";
import { makeBuildSpec } from "./buildSpec";

// ─────────────────────────────────────────────────────────────────────────────
// id 카운터 — 모듈 스코프
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

  // 1. 레시피 트리 + 머신 수 산정.
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
    return failureResult([
      {
        code: "no-target-recipe", scope: "입력", severity: "error", recoverable: false,
        detail: `타깃 레시피를 찾을 수 없습니다: ${input.targetRecipe}`,
        fixStep: "recipe",
      },
    ]);
  }

  const pickMachine = makeMachinePicker(input);

  // 2. 메타 수집 + 부모 맵 — DFS. 머신 매칭 실패 노드가 있으면 즉시 실패 반환.
  const metas = new Map<RecipeTreeNode, NodeMeta>();
  const parentOf = new Map<RecipeTreeNode, RecipeTreeNode | null>();
  const order: RecipeTreeNode[] = []; // DFS pre-order — 레이어 내 안정 정렬에 사용
  let maxDepth = 0;
  /**
   * **첫 개에서 멈추지 않는다**(A-2). 예전엔 `failure ??=` 로 첫 실패만 남겨서, 노드 3개가
   * 막혀 있으면 사용자가 **세 번 고치고 세 번 다시 돌려야** 전체를 알 수 있었다.
   */
  const issues: LayoutIssue[] = [];

  const collect = (node: RecipeTreeNode, depth: number, parent: RecipeTreeNode | null): void => {
    if (node.external || !node.recipeName) return;
    const ent = pickMachine(node.recipeName);
    if (!ent) {
      issues.push({
        code: "no-machine-for-category", scope: "입력", severity: "error", recoverable: false,
        detail: `${node.recipeName}: 카테고리를 처리할 머신이 선택되지 않았습니다`,
        target: { recipeName: node.recipeName }, fixStep: "machine",
      });
      return;
    }
    const entity = entityMap.get(ent.name);
    if (!entity) {
      issues.push({
        code: "stale-gamedata", scope: "게임데이터", severity: "error", recoverable: false,
        detail: `머신 엔티티 없음: ${ent.name}`,
        target: { recipeName: node.recipeName },
      });
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

  if (issues.length > 0 || !metas.has(tree)) {
    if (issues.length === 0) {
      issues.push({
        code: "root-unplaceable", scope: "입력", severity: "error", recoverable: false,
        detail: "루트 머신을 앉힐 수 없습니다", fixStep: "machine",
      });
    }
    return failureResult(issues);
  }

  // 3. 배치 — 모듈 파이프라인이 후보를 만든다(generateModule 자족 경로: 루트·자식을 같은
  //    방식으로 생성해 "자식 == 루트" 를 실현). 실패하면 **사유 그대로** 실패를 반환한다.
  //    폴백할 다른 경로는 없다 — 옛 S-LAYER 는 삭제됐다(2026-07-25, Phase 3).
  const res = tryRunModulePipeline({ input, metas, parentOf, order, makeId: nextId });
  if (!res.ok) return failureResult(res.issues, res.snapshot);

  const leaf = res.leaf;
  await emit("완료");
  const rootRep =
    leaf.internal.containers.find(
      (c) => c.kind === "machine" && c.recipeName === tree.recipeName,
    ) ?? leaf.internal.containers[0];
  const candidateTree: CandidateTree = {
    root: {
      id: nextId("root"),
      kind: "machine",
      machine: rootRep,
      routings: [],
      children: [leaf],
      label: `root [${tree.recipeName}]`,
    },
    candidates: [leaf],
    aborted: hooks?.signal?.aborted ?? false,
    stats: { candidatesGenerated: 1, failuresGenerated: 0, deepestDepth: maxDepth },
  };
  // 성공해도 경고는 있을 수 있다(반출 skip).
  return { ok: true, tree: candidateTree, partial: candidateTree.aborted, issues: res.warnings };
};

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * onProgress 콜백을 phase 이름으로 호출한다 — 진행 표시와 협조적 양보 둘뿐이다.
 */
function makeEmitter(
  cb: ProgressReporter | undefined,
  opts?: { yieldEveryMs: number },
): (name: string, depth?: number) => Promise<void> {
  // 누적 단계 수 — 진행 UI 가 "멈춤"이 아니라 실제 진행 중임을 보이도록 단조 증가.
  let attempts = 0;
  // 마지막으로 이벤트 루프에 양보한 시각(ms). 양보 주기 throttle 기준.
  let lastYield = typeof performance !== "undefined" ? performance.now() : Date.now();
  return async (name, depth = 0) => {
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

/**
 * 실패 결과 — **모은 문제 전부**와, 있으면 그 문제를 짚을 그림을 낸다.
 *
 * `snapshot` 은 `CandidateLeaf` 가 **아니다**(타입이 다르다) — 그래서 `unifyAreas` ·
 * `applyPlacedCells` · 블루프린트 export 로 흘러갈 수 없다. 부분 배치를 만들지 않겠다는
 * 결정을 런타임 검사가 아니라 **타입으로** 지킨다.
 */
function failureResult(issues: LayoutIssue[], snapshot?: LayoutSnapshot): ContainerWizardResult {
  const dummy: Container = {
    id: "m-layered-failure",
    kind: "machine",
    entityName: "unknown",
    origin: { x: 0, y: 0 },
    size: { w: 1, h: 1 },
  };
  const errors = issues.filter((i) => i.severity === "error");
  const root: MachineNode = {
    id: nextId("root"),
    kind: "machine",
    machine: dummy,
    routings: [],
    // 문제 하나에 실패 노드 하나 — 예전엔 첫 사유 한 줄뿐이었다.
    children: errors.map((i) => ({
      id: nextId("f"),
      kind: "failure" as const,
      reason: "no-machine-match" as const,
      children: [],
      label: describeIssue(i),
    })),
    label: "자동배치 (실패)",
  };
  return {
    ok: false,
    tree: {
      root,
      candidates: [],
      aborted: false,
      stats: { candidatesGenerated: 0, failuresGenerated: errors.length, deepestDepth: 0 },
    },
    partial: false,
    issues,
    snapshot,
  };
}
