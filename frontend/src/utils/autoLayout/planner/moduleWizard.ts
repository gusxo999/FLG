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
 * 무상태·결정적. Routing 객체 emit(piece 7) — 홉=머신→머신(드래그 트리), raw/루트=상자↔머신
 * (IO 라벨). placed=홉 belt 셀(없으면 직선 폴백).
 */

import { useGameDataStore } from "../../../store/gameDataStore";
import { EntityType } from "../../../types/layout";
import type { Area, CandidateLeaf, ContainerPort, ContainerWizardInput, PortFace, Routing } from "../containerModel";
import type { IoLine } from "../module/clusterPortPlanner";
import { CARDINAL_DIRECTIONS, chooseMachineDirection, fluidPortSlots } from "../module/fluidPorts";
import type { RecipeTreeNode } from "../types";
import { packModuleTree, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeModuleHops } from "./moduleHop";
import { relocateChestsToPerimeter } from "./modulePerimeterPass";
import { AUTO_LAYOUT_CHANNEL_GEOMETRY, AUTO_LAYOUT_PERIMETER_PASS } from "../debugFlags";
import { inserterThroughput } from "../inserterThroughput";
import { buildRoutingOptions } from "../routeFallback";
import { makeEmptyArea } from "../wizardUtils";
import { commitContainer } from "../machinePlacer";

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
  const { recipeMap, entityMap } = useGameDataStore.getState();

  const options = buildRoutingOptions(input);

  /**
   * 모듈 경로 포기 — **왜** 포기했는지 반드시 남긴다.
   *
   * 조용히 `null` 을 내면 호출자가 옛 경로로 폴백하고, 화면에는 "그냥 옛날 레이아웃"이
   * 나온다. 새 기능이 안 켜진 건지 안 만든 건지 구분이 안 되고, 실측 로그로도 알 수 없다
   * (2026-07-13: 유체 트리가 폴백했는데 사유를 몰라 추적 불가였다).
   */
  const reject = (why: string): null => {
    // eslint-disable-next-line no-console
    console.info(`[autoLayout] 모듈 경로 포기 → 옛 경로 폴백: ${why}`);
    return null;
  };

  // 자식이 부모에게 **무엇을 먹여주나** — 그 품목은 외부 공급이 아니다(홉으로 온다).
  const fedItemsOf = new Map<RecipeTreeNode, Set<string>>();
  for (const node of order) fedItemsOf.set(node, new Set());
  for (const node of order) {
    const parent = parentOf.get(node);
    if (parent) fedItemsOf.get(parent)!.add(node.itemName);
  }

  // 0) 적격성 — 아이템은 전부 OK. 유체는 [트렁크 파이프](docs/auto-layout-wizard.trunk-pipe.md)
  //    §5 범위(**외부 공급 유체 입력 1개**)만 받고 나머지는 옛 경로로 폴백한다.
  //    거절 사유가 다 다르므로 각각 이유를 남긴다(진단).
  const fluidTrunkOf = new Map<RecipeTreeNode, NodeSpec["fluidTrunk"]>();
  for (const node of order) {
    const recipe = recipeMap.get(node.recipeName!);
    if (!recipe) return reject(`레시피 없음: ${node.recipeName}`);
    const m = metas.get(node)!;
    const at = `${node.recipeName}`;

    // 유체 **출력**(자식→부모 유체 홉 / 루트 유체 반출) — moduleHop·반출이 벨트만 안다.
    if (recipe.products.some((p) => p.type === "fluid")) return reject(`유체 출력 미지원 (${at})`);

    const fluidIngredients = recipe.ingredients.filter((i) => i.type === "fluid");
    if (fluidIngredients.length === 0) continue; // 아이템 전용 노드 — 회전 없음.
    if (fluidIngredients.length > 1) return reject(`유체 입력 2개 이상 미지원 (${at})`);

    const fluid = fluidIngredients[0];
    // 자식이 만들어 주는 유체면 홉이 필요하다 — v1 미지원.
    if (fedItemsOf.get(node)!.has(fluid.name)) return reject(`유체 홉(자식 공급) 미지원 (${at}←${fluid.name})`);
    // 회전은 footprint 를 안 바꾼다는 전제 위에 있다 → 정사각형 머신만(§3).
    if (m.w !== m.h) return reject(`비정사각형 머신은 회전 불가 (${m.entityName} ${m.w}×${m.h})`);
    if (!options.pipeEntityName) return reject("파이프 prototype 없음");

    const entity = entityMap.get(m.entityName);
    if (!entity) return reject(`엔티티 게임데이터 없음: ${m.entityName}`);
    // 유체 입구가 **입력 면(E)** 을 보게 하는 회전을 데이터에서 고른다(§3).
    // generateModule 의 outputSide 가 W 이므로 입력 면은 E 다.
    const chosen = chooseMachineDirection(entity, { w: m.w, h: m.h }, fluid.name, "E", "input");
    if (!chosen) {
      // 회전이 데이터에서 나오므로(§3), 실패했으면 **데이터를 봐야** 안다.
      // 회전이 아예 안 먹으면(=positions 가 4방향 배열이 아니면) 네 방향의 면이 전부 같게 찍힌다.
      // eslint-disable-next-line no-console
      console.info(`[autoLayout] 유체 회전 실패 — ${m.entityName} / ${fluid.name}`, {
        positionsLen: entity.fluid_boxes?.map((fb) => fb.connections.map((c) => c.positions?.length ?? 0)),
        byDirection: Object.fromEntries(
          CARDINAL_DIRECTIONS.map((d) => [
            d,
            fluidPortSlots(entity, { w: m.w, h: m.h }, d).map((s) => `${s.productionType}:${s.face}${s.offset}`),
          ]),
        ),
      });
      return reject(
        `${m.entityName} 을 어느 각도로 돌려도 ${fluid.name} 입력 유체 상자가 E 면에 안 온다` +
          ` (fluid_boxes ${entity.fluid_boxes?.length ?? 0}개)`,
      );
    }

    fluidTrunkOf.set(node, {
      direction: chosen.direction,
      side: "E",
      pipeEntityName: options.pipeEntityName,
    });
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
    // 운반체 = 품목 종류. 유체는 파이프, 아이템은 벨트.
    const carrier = (type: string) => (type === "fluid" ? ("pipe" as const) : ("belt" as const));
    const lines: IoLine[] = [
      ...recipe.ingredients.map((i) => ({ name: i.name, kind: carrier(i.type), role: "input" as const, amount: i.amount })),
      ...recipe.products.map((p) => ({ name: p.name, kind: carrier(p.type), role: "output" as const, amount: p.amount })),
    ];
    const parent = parentOf.get(node) ?? undefined;
    return {
      id: idOf.get(node)!,
      depth: m.depth,
      parentId: parent ? idOf.get(parent) : undefined,
      machine: { entityName: m.entityName, w: m.w, h: m.h },
      count: m.count,
      lines,
      fluidTrunk: fluidTrunkOf.get(node),
    };
  });

  // 인서터별 실제 throughput(items/sec) — depth=운반량 매칭의 슬롯 용량(piece 3).
  const ov = input.inserterOverrides;
  const normalTp = inserterThroughput(entityMap.get(options.inserterEntityName), ov?.[options.inserterEntityName]);
  const longName = options.longInserter?.entityName;
  const longTp = longName ? inserterThroughput(entityMap.get(longName), ov?.[longName]) : normalTp;
  const packConfig: PackConfig = {
    inserterEntityName: options.inserterEntityName,
    beltEntityName: options.beltEntityName,
    longInserter: options.longInserter,
    // throughput 데이터 없으면(0) 생략 → planner 가 depth 를 (B) 등장순서로 유지.
    throughput: normalTp > 0 ? { normal: normalTp, long: longTp } : undefined,
    // 외부상자 perimeter exit-lane 예약(조각 6-①) — 채널 폭에 lane 세로 구간 합산.
    reservePerimeterLanes: AUTO_LAYOUT_PERIMETER_PASS,
    // 채널 기하 예약(통합 장부) — 납품·반출 트랙을 패킹 시점에 배정, 폭은 결과에서 유도.
    channelGeometry: AUTO_LAYOUT_CHANNEL_GEOMETRY,
    // 장부가 납품끼리의 교차를 지하로 계획할 때 쓰는 거리 상한. **아래 routeModuleHops 의
    // maxJump 산식과 같아야 한다** — 지하벨트 prototype 이 없으면 방출기는 어차피 지상
    // 전용이므로, 장부도 0(지하 불가)으로 봐야 계획과 방출이 어긋나지 않는다.
    beltMaxUndergroundDistance: options.undergroundBeltEntityName
      ? options.beltMaxUndergroundDistance
      : 0,
  };

  const pack = packModuleTree(specs, packConfig);
  // 미탭(과용량 등) 있는 모듈 → 폴백.
  for (const pl of pack.placements) {
    if (pl.module.unroutedLines.length > 0) {
      const names = pl.module.unroutedLines.map((l) => `${l.role}:${l.name}`).join(", ");
      return reject(`${pl.id} 의 줄을 못 놓음 [${names}] — ${pl.module.supply?.reason ?? "사유 없음"}`);
    }
  }

  const hopRes = routeModuleHops(pack, {
    beltEntityName: options.beltEntityName,
    beltMaxUndergroundDistance: options.beltMaxUndergroundDistance,
    undergroundBeltEntityName: options.undergroundBeltEntityName,
  });
  if (hopRes.failures > 0) return reject(`모듈 사이 납품 경로 실패 ${hopRes.failures}건`);

  // 1c) 외부상자 전역 perimeter 재배치(조각 6-C) — 합성 후 살아남은 raw 입력·루트 출력
  //     상자는 각자 *로컬* 모듈 ring(=배치 내부)에 박혀 있다. ⑥A lanePlan 배정대로 예약된
  //     lane 안에 결정적 belt(직선 or ㄱ자)를 깔아 전역 외곽으로 옮긴다(탐색 없음). lane 이
  //     막히거나 미지원 배정(형제에 막힌 N/S 변→채널)인 상자만 건너뛰어 로컬 ring 에 남기고
  //     트리는 모듈 경로를 유지한다(회귀 0).
  // relocateChestsToPerimeter 는 moduleHop 처럼 **순수**하다(pack 미변형) — 무엇을 떼고
  // (droppedCellKeys) 무엇을 놓고(addedCells) 상자가 어디로 가는지(relocations)를 반환하고,
  // 적용은 아래 어댑터에서 Area 를 지을 때 한다.
  const perim = AUTO_LAYOUT_PERIMETER_PASS
    ? relocateChestsToPerimeter(pack, hopRes.strippedChestIds, hopRes.cells, {
        beltEntityName: options.beltEntityName,
        inserterEntityName: options.inserterEntityName,
        pipeEntityName: options.pipeEntityName, // 유체 포트는 파이프로 반출한다.
      })
    : null;
  const droppedKeys = perim?.droppedCellKeys ?? new Set<string>();
  const relocOrigin = new Map<string, { x: number; y: number }>();
  const relocBelts = new Map<string, typeof hopRes.cells>();
  for (const r of perim?.relocations ?? []) {
    relocOrigin.set(r.chestId, r.origin);
    relocBelts.set(r.chestId, r.belts);
  }

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
      const k = `${c.x},${c.y}`;
      // stripCells=홉이 뗀 경계 chest/seat, droppedKeys=perimeter 이사한 상자의 옛 ghost/feeder.
      if (stripCells.has(k) || droppedKeys.has(k)) continue;
      if (c.cell.entityType === EntityType.InfinityChest) external.placed.push(c);
      else internal.placed.push(c);
    }
    for (const chest of mod.chests) {
      if (stripChests.has(chest.id)) continue;
      // perimeter 로 이사한 상자는 새 origin 으로(원본 Container 미변형 → 사본).
      const origin = relocOrigin.get(chest.id);
      external.containers.push(origin ? { ...chest, origin } : chest);
    }
  }
  for (const c of hopRes.cells) internal.placed.push(c);
  // perimeter 재배치가 새로 깐 셀(belt+feeder+이사한 chest) — mod.cells 순회와 같은 분류.
  for (const c of perim?.addedCells ?? []) {
    if (c.cell.entityType === EntityType.InfinityChest) external.placed.push(c);
    else internal.placed.push(c);
  }
  // 홉 지하 corridor — Area 인덱스에 기록해 이후 라우팅(드래그 재라우팅 등)이 같은
  // 직선 위 페어링 절단을 피하게 한다. placed 와 같은 직접-기록 규약(비-이중-commit:
  // 이 candidate 의 routings 는 commitRouting 을 타지 않는다).
  internal.undergroundCorridors.push(...hopRes.corridors);

  // 2b) Routing 객체 — 선/IO 라벨/드래그 그룹 복원(옛 routings=[] 한계 해소). 끝점은 실제
  //    컨테이너 id(머신 = `${모듈id}-m0`, 유지된 상자). placed = 홉 belt 셀(직선 폴백 가능).
  //    홉=머신→머신(부모-자식, 드래그 트리), raw 입력=상자→머신, 루트 출력=머신→상자.
  const routings: Routing[] = [];
  const itemPort = (containerId: string, cell: { x: number; y: number }, face: PortFace): ContainerPort =>
    ({ containerId, cell, face, kind: "item" });
  pack.hops.forEach((hop, i) => {
    // belt-following: 자식 트렁크 spine + gap belt + 부모 트렁크 spine (boxless 라 연속).
    const placed = [...hop.from.cells, ...(hopRes.routes[i]?.cells ?? []), ...hop.to.cells];
    routings.push({
      id: makeId("r"),
      kind: "item",
      from: itemPort(`${hop.fromId}-m0`, hop.from.anchor, hop.from.face),
      to: itemPort(`${hop.toId}-m0`, hop.to.anchor, hop.to.face),
      placed,
      // 이 홉이 깐 지하 corridor(표시·수정 모드 정리용 사본 — area 기록이 원본).
      corridors: (hopRes.routes[i]?.corridors ?? []).map((c) => ({ ...c, range: [c.range[0], c.range[1]] as [number, number] })),
      // 포트 산출 근거(표시용) — 자식 출력 포트 / 부모 입력 포트 각각.
      fromPortMeta: hop.from.meta,
      toPortMeta: hop.to.meta,
    });
  });
  for (const pl of pack.placements) {
    for (const chest of pl.module.chests) {
      if (stripChests.has(chest.id)) continue; // boxless 로 떼인 경계 상자는 제외.
      const port = [...pl.module.inputPorts, ...pl.module.outputPorts].find((p) => p.chest.id === chest.id);
      // 유체 포트의 라우팅은 kind=fluid — 선 색·라벨·드래그 재라우팅이 이걸 본다.
      const isFluid = port?.line.kind === "pipe";
      const mkPort = (containerId: string, cell: { x: number; y: number }, face: PortFace): ContainerPort =>
        isFluid
          ? { containerId, cell, face, kind: { fluid: chest.content! } }
          : itemPort(containerId, cell, face);
      // perimeter 로 이사했으면 chest 끝점 = 새 origin, placed = 트렁크 spine + 이사 belt.
      const origin = relocOrigin.get(chest.id) ?? chest.origin;
      // machine 끝점 cell = tapAnchor(anchor 안쪽 2칸). anchor 를 쓰면 chest 끝점과 겹쳐
      // from==to 가 되어 선이 사라진다(⑥B). chest 는 origin, machine 은 tapAnchor 로 분리.
      const machine = mkPort(`${pl.id}-m0`, port?.tapAnchor ?? origin, port?.face ?? "N");
      const chestPort = mkPort(chest.id, origin, port?.face ?? "N");
      const placed = [...(port?.cells ?? []), ...(relocBelts.get(chest.id) ?? [])]; // 트렁크 spine + 이사 belt → belt-following 선.
      const kind = isFluid ? ("fluid" as const) : ("item" as const);
      // raw 입력: 상자→머신(input), 루트 출력: 머신→상자(output). 포트 메타는 머신 끝점 쪽.
      if (chest.role === "input") routings.push({ id: makeId("r"), kind, from: chestPort, to: machine, placed, corridors: [], toPortMeta: port?.meta });
      else routings.push({ id: makeId("r"), kind, from: machine, to: chestPort, placed, corridors: [], fromPortMeta: port?.meta });
    }
  }

  internal.bbox = bboxOf(internal);

  const bbox = internal.bbox;
  return {
    id: makeId("c"),
    kind: "candidate",
    internal,
    external,
    routings,
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
