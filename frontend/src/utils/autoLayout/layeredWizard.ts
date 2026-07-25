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
import { wrapExternalsAroundPerimeter, cloneArea } from "./areaUnification";
import { routeWithFallback, buildRoutingOptions } from "./routeFallback";
import {
  wrapExternalsWithMerge,
  DEFAULT_MERGE_CONFIG,
  AUTO_LAYOUT_MERGE_BOXES,
} from "./externalMergePass";
import {
  gatherExternalsToPoints,
  DEFAULT_GATHER_CONFIG,
  AUTO_LAYOUT_GATHER_EXTERNALS,
} from "./externalGatherPass";
import { tryMergeClusterOutput, tryMergeClusterOutputBus } from "./clusterTrunkMerge";
import { beltThroughput } from "./beltThroughput";
import {
  layoutCluster,
  pickClusterShape,
  columnTapCapacity,
  ROW_GAP,
  type ClusterLayout,
  type ShapeCaps,
} from "./module/clusterLayout";
import {
  assignTracksLeftEdge,
  channelWidthFromTracks,
  type Interval,
} from "./planner/channelPlanner";
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

  // 2b. 클러스터 형태 — S-LAYER 옛 경로 — 노드별 N대 머신의 내부 배열(상대좌표 + bbox)을 한 번 계산해
  //     캐시한다. 이후 레이아웃 단계(열 폭·노드 높이·채널 구간·배치)는 이 결과만
  //     형태-무관하게 소비한다 (불투명 서브블록, clusterLayout.ts). P1 = 기둥.
  //
  //     형태 선택(탭 용량 기준)도 여기서: 레시피의 I/O belt 수요가 기둥 탭 용량을
  //     넘으면 본래 2D 형태가 필요(현재 미구현 → 기둥 폴백 + 디버그 경고).
  // 면당 레인은 인서터 종류로 정해진다: 일반(reach 1, 가까운 belt) + 긴팔(reach≥2, 앞
  // belt 건너 먼 belt). 긴팔은 거리 1을 못 집으므로 2레인은 둘 다 있어야 성립.
  const reaches = input.selectedInserters.map((name) => inserterReach(entityMap.get(name)));
  // 서로 다른 reach 하나당 [ClusterBelt] 한 줄(reach `r` → clusterBeltDepth `1+r`). 인서터를
  // 아무것도 안 골랐으면 기본 인서터(reach 1)가 있다고 본다.
  const usableReaches = reaches.filter((r) => r >= 1);
  const shapeCaps: ShapeCaps = {
    reaches: usableReaches.length > 0 ? usableReaches : [1],
  };
  const clusters = new Map<RecipeTreeNode, ClusterLayout>();
  const overflowNodes: { recipe: string; beltDemand: number; pipeDemand: number; capacity: number }[] = [];
  for (const [node, meta] of metas) {
    // 간단한 레시피(아이템 전용) 클러스터는 gap=0 으로 밀착 — 트렁크가 옆면(W/E)만 타고
    // 흐르도록(기둥 사이 침투 불가). 유체/복잡 레시피는 기존 ROW_GAP(N/S spill 여백) 유지.
    const rowGap = isSimpleRecipe(node.recipeName!) ? 0 : ROW_GAP;
    clusters.set(node, layoutCluster({ w: meta.w, h: meta.h, count: meta.count }, rowGap));
    const recipe = recipeMap.get(node.recipeName!);
    if (!recipe) continue;
    // 아이템(belt)과 유체(pipe)를 분리해 센다 — 둘은 면을 공유하나 점유 방식이 달라
    // 별도 수요로 다룬다(clusterPortPlanner 의 셀 배정 입력과 일치).
    const io = [...recipe.ingredients, ...recipe.products];
    const beltDemand = io.filter((p) => p.type !== "fluid").length;
    const pipeDemand = io.filter((p) => p.type === "fluid").length;
    const decision = pickClusterShape({ beltDemand, pipeDemand }, shapeCaps);
    if (decision.overflow) {
      overflowNodes.push({ recipe: node.recipeName!, beltDemand, pipeDemand, capacity: decision.capacity });
    }
  }
  if (AUTO_LAYOUT_COORD_DUMP && overflowNodes.length > 0) {
    console.log(
      "[autoLayout debug] 클러스터 형태 — 기둥 탭 용량 초과(→ 2D 대상, 현재 기둥 폴백)\n" +
        JSON.stringify({ shapeCaps, columnCapacity: columnTapCapacity(shapeCaps), overflow: overflowNodes }, null, 2),
    );
  }

  // 3. 깊이별 최대 클러스터 폭 — 열(레이어) 폭. x 좌표는 채널 폭이 정해진 뒤(4d) 계산.
  const colWidth: number[] = new Array(maxDepth + 1).fill(0);
  for (const [node, meta] of metas) {
    colWidth[meta.depth] = Math.max(colWidth[meta.depth], clusters.get(node)!.size.w);
  }

  // 4. tidy-tree 세로 배치 — 부모를 자식들의 중앙에 정렬 (Reingold–Tilford 풍).
  await emit("layerAssignment + ordering");
  const topY = new Map<RecipeTreeNode, number>();
  const cursor = { y: 0 };
  const heightOf = (node: RecipeTreeNode): number => clusters.get(node)!.size.h;
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

  // 4c. 채널 계획 — 각 채널 경계(깊이 d↔d-1)를 가로지르는 연결을 세로 구간으로
  //     모아 left-edge 로 트랙 배정. 한 노드의 N대는 각자 부모 대표 머신으로 가는
  //     별개 연결 = 별개 구간(문서 §4·§5·§7). 머신 중심 y 는 4b 확정 topY 기준.
  await emit("planChannels (left-edge)");
  interface ChannelEdge {
    node: RecipeTreeNode;
    machineIndex: number;
    depth: number;
    lo: number;
    hi: number;
    track: number; // assignTracksLeftEdge 가 채움
  }
  const machineCenterY = (node: RecipeTreeNode, i: number): number => {
    const m = metas.get(node)!;
    return Math.round(topY.get(node)!) + clusters.get(node)!.positions[i].dy + m.h / 2;
  };
  const channelEdges: ChannelEdge[] = [];
  const intervalsByDepth = new Map<number, { iv: Interval; edge: ChannelEdge }[]>();
  for (const node of order) {
    const parent = parentOf.get(node);
    if (!parent) continue; // 루트 — 채널을 가로지르지 않음
    const m = metas.get(node)!;
    const consumerY = machineCenterY(parent, 0); // 부모 대표 머신
    for (let i = 0; i < m.count; i++) {
      const producerY = machineCenterY(node, i);
      const iv: Interval = {
        lo: Math.min(producerY, consumerY),
        hi: Math.max(producerY, consumerY),
      };
      const edge: ChannelEdge = { node, machineIndex: i, depth: m.depth, lo: iv.lo, hi: iv.hi, track: 0 };
      channelEdges.push(edge);
      const list = intervalsByDepth.get(m.depth) ?? [];
      list.push({ iv, edge });
      intervalsByDepth.set(m.depth, list);
    }
  }

  // 깊이별 트랙 배정 + 트랙 수. 크로싱 수(A안)도 함께 기록(로그/비교용).
  const trackCount: number[] = new Array(maxDepth + 1).fill(0);
  const crossingCount: number[] = new Array(maxDepth + 1).fill(0);
  for (const [d, list] of intervalsByDepth) {
    crossingCount[d] = list.length;
    const { tracks, trackCount: tc } = assignTracksLeftEdge(list.map((x) => x.iv));
    trackCount[d] = tc;
    list.forEach((x, idx) => {
      x.edge.track = tracks[idx];
    });
  }

  // 4d. 채널 폭(트랙 수 기반) + 열 x 좌표 누적. 열 0(루트)이 왼쪽, 깊은 레이어가 오른쪽.
  const channelWidthOf = (d: number): number =>
    channelWidthFromTracks(trackCount[d], CHANNEL_MIN);
  const colX: number[] = new Array(maxDepth + 1).fill(0);
  for (let d = 1; d <= maxDepth; d++) {
    colX[d] = colX[d - 1] + colWidth[d - 1] + channelWidthOf(d);
  }

  if (AUTO_LAYOUT_COORD_DUMP) {
    console.log(
      "[autoLayout debug] S-LAYER 채널 계획 (A안 crossings vs B안 left-edge tracks)\n" +
        JSON.stringify(
          Array.from({ length: maxDepth }, (_, k) => {
            const d = k + 1;
            return {
              channel: `L${d}↔L${d - 1}`,
              crossings_A: crossingCount[d],
              tracks_leftEdge_B: trackCount[d],
              width: channelWidthOf(d),
            };
          }),
          null,
          2,
        ),
    );
  }

  // 5. 머신 배치 — 각 노드의 클러스터 형태(positions)대로 commit.
  await emit("coordinate + placeMachines");
  const internal: Area = makeEmptyArea("internal");
  const external: Area = makeEmptyArea("external");
  const machinesOf = new Map<RecipeTreeNode, Container[]>();
  for (const node of order) {
    const m = metas.get(node)!;
    const baseTop = Math.round(topY.get(node)!);
    const cluster = clusters.get(node)!;
    const list: Container[] = [];
    for (const pos of cluster.positions) {
      const c: Container = {
        id: nextId(`m-${node.recipeName}`),
        kind: "machine",
        entityName: m.entityName,
        origin: { x: colX[m.depth] + pos.dx, y: baseTop + pos.dy },
        size: { w: m.w, h: m.h },
        recipeName: node.recipeName,
      };
      commitContainer(c, internal);
      list.push(c);
    }
    machinesOf.set(node, list);
  }

  // 6. 채널 라우팅 — left-edge 트랙 순서로 연결을 깐다. 채널 폭이 트랙 수만큼
  //    확보돼 있으므로(4d) 충돌 없이 깔 수 있다. 셀 구성(벨트/투입기/파이프/지하·
  //    방향)은 검증된 기존 라우터(routeWithFallback→routePorts)를 그대로 재사용.
  //    정렬 (depth, track, lo) → 결정적. (명시적 셀 직접 깔기는 follow-up; 문서 §5.)
  await emit("channelRouting (left-edge track order)", { internal, external });
  const options = buildRoutingOptions(input);
  const merge = {
    ...DEFAULT_MERGE_CONFIG,
    enabled: input.mergeSupplyBoxes ?? AUTO_LAYOUT_MERGE_BOXES,
  };
  const routings: Routing[] = [];
  let routeFailures = 0;

  // 6a. 트렁크 병합 — 병합 ON + 아이템 + N≥2 노드의 N대 출력을 단일 collect 트렁크로
  //     먼저 시도. 성공한 노드는 머신별 채널 라우팅을 건너뛴다(트렁크가 대체).
  //     실패(미탭/단독/fluid)면 그 노드의 edge 들은 6b 의 1:1 폴백으로 처리.
  //     노드 방문은 DFS pre-order(`order`)로 결정적.
  const paramsLookup = makeMachineParamsLookup(input.selectedMachines);
  const beltCap = beltThroughput(entityMap.get(options.beltEntityName));

  const mergedNodes = new Set<RecipeTreeNode>();
  if (merge.enabled) {
    for (const node of order) {
      if (hooks?.signal?.aborted) break;
      const parent = parentOf.get(node);
      if (!parent) continue; // 루트 — 채널 간선 없음
      const m = metas.get(node)!;
      const isItem = productKind(node.recipeName!, node.itemName) !== "fluid";
      if (m.count < 2 || !isItem) continue;
      const parentMachines = machinesOf.get(parent)!;

      let merged: Routing[] | null;
      if (parentMachines.length >= 2 && isSimpleRecipe(parent.recipeName!)) {
        // 부모 ≥2대 + 간단한 레시피 → 멀티싱크 버스(벨트 용량만큼 여러 부모에 분배).
        const childRecipe = recipeMap.get(node.recipeName!);
        const params = paramsLookup(node.recipeName!);
        // 수량 미상(undefined)은 레시피/머신 정보가 없을 때와 같이 0 으로 본다 — 이 자리의
        // 기존 규약이다(`: 0`). NaN 을 흘리면 버스 분배 계산이 조용히 망가진다.
        const perChild =
          (childRecipe && params
            ? perMachineItemsPerSec(childRecipe, node.itemName, params)
            : 0) ?? 0;
        merged = tryMergeClusterOutputBus(
          machinesOf.get(node)!,
          parentMachines,
          internal,
          external,
          options,
          { childTotalOutput: m.count * perChild, beltThroughputPerSec: beltCap },
        );
      } else {
        // 부모 1대(또는 유체 부모) → 기존 단일 소비자 트렁크.
        merged = tryMergeClusterOutput(
          machinesOf.get(node)!,
          parentMachines[0],
          internal,
          external,
          options,
        );
      }
      if (!merged) continue; // all-or-nothing → 6b 1:1 폴백
      for (const r of merged) {
        commitRouting(r, internal);
        routings.push(r);
      }
      mergedNodes.add(node);
      // 6a 자식 단계 — 이 노드의 트렁크가 깔린 직후 상태(증분 공개).
      await emit(`trunk · ${node.recipeName} ×${m.count}`, { internal, external }, 1);
    }
  }

  // 6b. 나머지 — 병합 안 된 노드의 edge 들을 머신별 1:1 채널 라우팅.
  const sortedEdges = [...channelEdges].sort(
    (a, b) => a.depth - b.depth || a.track - b.track || a.lo - b.lo,
  );
  for (const e of sortedEdges) {
    if (hooks?.signal?.aborted) break;
    if (mergedNodes.has(e.node)) continue; // 트렁크로 이미 처리됨
    const parent = parentOf.get(e.node)!;
    // 부모 ≥2대면 자식 producer 인덱스로 라운드로빈 분배 — 한 부모에 몰려 나머지가
    // 굶는 것 방지(버스 미적용/실패 시 최소 안전망). 부모 1대면 그 1대.
    const parentMachines = machinesOf.get(parent)!;
    const consumer = parentMachines[e.machineIndex % parentMachines.length];
    const producer = machinesOf.get(e.node)![e.machineIndex];
    const kind: PortKind =
      productKind(e.node.recipeName!, e.node.itemName) === "fluid"
        ? { fluid: e.node.itemName }
        : "item";
    const attempt = routeWithFallback(producer, consumer, kind, internal, options);
    if (attempt.ok) {
      commitRouting(attempt.routing, internal);
      routings.push(attempt.routing);
      // 6b 자식 단계 — 이 edge 의 1:1 채널이 깔린 직후 상태(증분 공개).
      await emit(`route · ${e.node.recipeName}[${e.machineIndex}]`, { internal, external }, 1);
    } else {
      routeFailures += 1;
    }
  }

  // 외부 연결 그룹 헤더(depth 0) — 내부 라우팅 완료 시점 스냅샷. 아래 7·8·9 단계가
  // 이 헤더의 자식(depth 1)으로 묶인다(축 A 구조 그룹핑).
  await emit("외부 연결 (external wiring)", { internal, external });

  // 7. 외부 입력 — 머신마다 external ingredient 당 무한상자/파이프 1개 등록.
  await emit("attachExternalInputs", { internal, external }, 1);
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
            role: "input",
          },
          external,
          internal,
        );
        connections.push({ producerId: chest.id, consumerId: machine.id, kind: portKind });
      }
    }
  }

  // 8. 루트 출력 — 루트 머신마다 product 당 무한상자/파이프 1개.
  //    (입력(7)과 대칭: 대표 1대만이 아니라 모든 루트 머신을 연결해야 전 머신의
  //    생산물이 회수되고, merge ON 시 collect 트렁크로 묶일 후보가 된다.)
  await emit("attachRootOutput", { internal, external }, 1);
  const rootRep = machinesOf.get(tree)![0]; // 후보 트리 rootNode 대표 머신 (메타데이터용).
  const rootRecipe = recipeMap.get(tree.recipeName);
  if (rootRecipe) {
    for (const prod of rootRecipe.products) {
      const portKind: PortKind = prod.type === "fluid" ? { fluid: prod.name } : "item";
      for (const machine of machinesOf.get(tree)!) {
        const chest = placeExternalContainer(
          {
            kind: prod.type === "fluid" ? "infinity-pipe" : "infinity-chest",
            entityName: prod.type === "fluid" ? "infinity-pipe" : "infinity-chest",
            content: prod.name,
            role: "output",
          },
          external,
          internal,
        );
        connections.push({ producerId: machine.id, consumerId: chest.id, kind: portKind });
      }
    }
  }

  // 9. 외부 컨테이너를 perimeter ring 에 배치 + 라우팅. 병합 ON 이면 같은 품목
  //    chest 들을 트렁크로 묶고(입력 supply·출력 collect), OFF 면 기존 1:1.
  //    wrapExternalsWithMerge 는 시그니처 호환(+cfg)이며 비활성/머신없음 시 1:1 폴백.
  if (merge.enabled) {
    await emit("wrapExternalsWithMerge", { internal, external }, 1);
    const ext = wrapExternalsWithMerge(internal, external, routings, connections, options, merge);
    routeFailures += ext.failed;
  } else {
    await emit("wrapExternalsAroundPerimeter", { internal, external }, 1);
    // 외부 통로(perimeter 라우팅) 실패도 routeFailures 로 집계 — 통로가 존재하지
    // 않으면(=배치 불가) 후보 라벨에 ⚠ 로 드러나야 한다(단일 링 불변식의 정합성).
    const ext = wrapExternalsAroundPerimeter(internal, external, routings, connections, options);
    routeFailures += ext.failed;
  }

  // 9.5 외부 상자 집결 — 같은 품목·role 상자를 한 변으로 인접 이송(외부 물류 접점 하나).
  //     맨 마지막 후처리. 그룹 단위 all-or-nothing 폴백이라 실패해도 9의 ring 정렬 유지.
  const gather = {
    ...DEFAULT_GATHER_CONFIG,
    enabled: AUTO_LAYOUT_GATHER_EXTERNALS,
  };
  if (gather.enabled) {
    await emit("gatherExternalsToPoints", { internal, external }, 1);
    gatherExternalsToPoints(internal, external, routings, connections, options, gather);
  }

  // 10. 단일 후보 leaf + 트리 래핑.
  await emit("완료", { internal, external });
  if (AUTO_LAYOUT_COORD_DUMP) {
    const _ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - _wizT0;
    console.log(`[autoLayout debug] runLayeredWizard total ${Math.round(_ms)}ms · routeFailures=${routeFailures}`);
  }
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

/** 한 레시피의 product 중 itemName 의 type (item/fluid) 조회 — 라우팅 kind 결정. */
function productKind(recipeName: string, itemName: string): "item" | "fluid" {
  const recipe = useGameDataStore.getState().recipeMap.get(recipeName);
  if (!recipe) return "item";
  return recipe.products.find((p) => p.name === itemName)?.type ?? "item";
}

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
