/**
 * moduleWizard — 조각 5 (하이브리드 배선). 트리가 **전부 simple-item** 일 때만
 * generateModule+packModuleTree+routeModuleHops 자족 모듈 경로로 후보 1개를 만든다.
 * 유체·미탭(과용량)·홉 실패 중 하나라도 있으면 `null` 반환 → 호출자(layeredWizard)가
 * 옛 경로로 폴백한다(회귀 0).
 *
 * ## 왜 이게 "자식 == 루트" 를 실현하나
 * generateModule 은 클러스터를 **부모-무시** 생성하므로, 같은 (레시피, count) 면 자식이든
 * 루트든 동일 모듈이다. 옛 라이브는 자식만 clusterTrunkMerge(부모-결합)·루트만 자족이라
 * 둘이 달랐다. 본 경로는 **루트·자식 모두** 모듈(ROW_GAP 0 통일)이라 일치한다.
 *
 * ## 배치
 * v1 은 packModuleTree 의 preview 배치(depth 열 × 세로 stack)를 그대로 쓴다 — child==root
 * 는 배치와 무관(생성이 부모-무시)하므로 우선 검증 가능. tidy-tree 정렬·홉 단축은 후속.
 *
 * 무상태·결정적. routings=[] (홉은 belt 셀로만 표현 — 머신 그룹 드래그 추론은 후속 어댑터).
 */

import { useGameDataStore } from "../../store/gameDataStore";
import { EntityType } from "../../types/layout";
import type { Area, CandidateLeaf, ContainerWizardInput } from "./containerModel";
import type { IoLine } from "./clusterPortPlanner";
import type { RecipeTreeNode } from "./types";
import { packModuleTree, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeModuleHops } from "./moduleHop";
import { buildRoutingOptions } from "./routeFallback";
import { makeEmptyArea } from "./wizardUtils";
import { commitContainer } from "./machinePlacer";

/** layeredWizard NodeMeta 와 동형(필요한 부분만). */
export interface ModuleNodeMeta {
  entityName: string;
  w: number;
  h: number;
  count: number;
  depth: number;
}

export interface ModulePipelineArgs {
  input: ContainerWizardInput;
  metas: Map<RecipeTreeNode, ModuleNodeMeta>;
  parentOf: Map<RecipeTreeNode, RecipeTreeNode | null>;
  /** DFS pre-order(루트 먼저). */
  order: RecipeTreeNode[];
  /** layeredWizard 의 결정적 id 생성기(nextId). */
  makeId: (prefix: string) => string;
}

/**
 * 모듈 경로로 후보 leaf 생성. 적격(전부 item·미탭0·홉성공) 아니면 null.
 */
export function tryRunModulePipeline(args: ModulePipelineArgs): CandidateLeaf | null {
  const { input, metas, parentOf, order, makeId } = args;
  const { recipeMap } = useGameDataStore.getState();

  // 0) 적격성 — 전부 item(유체 0). 하나라도 유체면 즉시 폴백.
  for (const node of order) {
    const recipe = recipeMap.get(node.recipeName!);
    if (!recipe) return null;
    const io = [...recipe.ingredients, ...recipe.products];
    if (io.some((p) => p.type === "fluid")) return null;
  }

  // 1) NodeSpec — 트리에서 유도. id 는 노드별 결정적(order 인덱스 + 레시피).
  const idOf = new Map<RecipeTreeNode, string>();
  const recipeOfId = new Map<string, string>();
  order.forEach((node, i) => {
    const id = `n${i}-${node.recipeName}`;
    idOf.set(node, id);
    recipeOfId.set(id, node.recipeName!);
  });
  const specs: NodeSpec[] = order.map((node) => {
    const m = metas.get(node)!;
    const recipe = recipeMap.get(node.recipeName!)!;
    const lines: IoLine[] = [
      ...recipe.ingredients.map((i) => ({ name: i.name, kind: "belt" as const, role: "input" as const })),
      ...recipe.products.map((p) => ({ name: p.name, kind: "belt" as const, role: "output" as const })),
    ];
    const parent = parentOf.get(node) ?? undefined;
    return {
      id: idOf.get(node)!,
      depth: m.depth,
      parentId: parent ? idOf.get(parent) : undefined,
      machine: { entityName: m.entityName, w: m.w, h: m.h },
      count: m.count,
      lines,
    };
  });

  const options = buildRoutingOptions(input);
  const packConfig: PackConfig = {
    inserterEntityName: options.inserterEntityName,
    beltEntityName: options.beltEntityName,
    longInserter: options.longInserter,
  };

  const pack = packModuleTree(specs, packConfig);
  // 미탭(과용량 등) 있는 모듈 → 폴백.
  for (const pl of pack.placements) {
    if (pl.module.unroutedLines.length > 0) return null;
  }

  const hopRes = routeModuleHops(pack, {
    beltEntityName: options.beltEntityName,
    beltMaxUndergroundDistance: options.beltMaxUndergroundDistance,
    undergroundBeltEntityName: options.undergroundBeltEntityName,
  });
  if (hopRes.failures > 0) return null;

  // 2) 어댑터 → internal/external Area.
  //    - 머신 → internal.containers
  //    - belt/인서터 셀(strip 제외) → internal.placed
  //    - 유지되는 무한상자(raw 입력·루트 출력) → external.containers + ghost 셀 external.placed
  //    - 홉 belt → internal.placed
  //    strip(경계 chest+seat) 셀/상자는 제외.
  const internal = makeEmptyArea("internal");
  const external = makeEmptyArea("external");
  const stripCells = hopRes.strippedCellKeys;
  const stripChests = hopRes.strippedChestIds;

  for (const pl of pack.placements) {
    const mod = pl.module;
    const recipeName = recipeOfId.get(pl.id);
    for (const machine of mod.machines) {
      // generateModule 은 레시피-무관 생성이라 머신에 recipeName 이 없다. 블루프린트
      // 레시피 배정·디버그 식별을 위해 노드 레시피를 채운 뒤 commitContainer 로
      // **footprint 셀까지** internal.placed 에 펼친다(머신은 컨테이너만으론 그리드에
      // 안 그려진다 — 이 누락이 "머신이 안 보이던" 원인).
      machine.recipeName = recipeName;
      commitContainer(machine, internal);
    }
    for (const c of mod.cells) {
      if (stripCells.has(`${c.x},${c.y}`)) continue;
      if (c.cell.entityType === EntityType.InfinityChest) external.placed.push(c);
      else internal.placed.push(c);
    }
    for (const chest of mod.chests) {
      if (stripChests.has(chest.id)) continue;
      external.containers.push(chest);
    }
  }
  for (const c of hopRes.cells) internal.placed.push(c);

  internal.bbox = bboxOf(internal);

  const bbox = internal.bbox;
  return {
    id: makeId("c"),
    kind: "candidate",
    internal,
    external,
    routings: [],
    squarenessPenalty: bbox ? Math.abs(bbox.w - bbox.h) : 0,
    children: [],
    label: `S-LAYER(module) · ${order.length} 노드 · ${pack.hops.length} 홉 · raw ${pack.rawPorts.length}`,
  };
}

/** 머신 footprint + placed 셀의 외접 bbox (w/h 는 폭/높이). */
function bboxOf(area: Area): { x: number; y: number; w: number; h: number } | undefined {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const mk = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
  };
  for (const c of area.containers) mk(c.origin.x, c.origin.y, c.size.w, c.size.h);
  for (const p of area.placed) mk(p.x, p.y, 1, 1);
  if (!isFinite(minX)) return undefined;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
