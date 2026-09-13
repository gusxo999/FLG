/**
 * **실행의 찍기** — 배치·납품·반출이 **이미 정한 것**을 화면이 받는 모양으로 옮긴다. 고르지 않는다.
 *
 * ```
 * candidateOf   성공 — Area(internal · external) · Routing(선 · IO 라벨 · 드래그 그룹) → CandidateLeaf
 * snapshotOf    실패 — 문제를 짚을 그림(LayoutSnapshot). CandidateLeaf 가 아니라 배치로 흘러가지 못한다
 * ```
 *
 * > **내력.** `planner/moduleWizard.ts` 의 `runModulePipeline` 끝(`2)`·`2b)`)과 파일 아래쪽에 있었다. 그 블록의
 * > 주석은 이 일을 **"어댑터"** 라 불렀는데, work-kinds 의 어댑터는 *"게임데이터를 우리 타입으로"* 다 — 여기는
 * > 게임데이터를 안 본다. 2026-09-14 옮기면서 이름을 **찍기**로 바로잡았다(계획 구조-2축 · 2 Step 2b).
 */

import { EntityType } from "../../../types/layout";
import type {
  Area, CandidateLeaf, ContainerPort, PortFace, Routing, UndergroundCorridor,
} from "../../containerModel";
import type { LayoutIssue, LayoutSnapshot } from "../../layoutIssue";
import { makeEmptyArea } from "../../wizardUtils";
import { commitContainer } from "../../execution/machinePlacer";
import type { PerimeterPassResult } from "../../execution/modulePerimeterPass";
import { deliveryKey, type PackResult } from "../modulePacking";
import type { DeliveryResult } from "../deliveryRoute";

/** [candidateOf] 가 받는 것 — 앞 단계들이 낸 사실 전부. */
export interface CandidateFacts {
  pack: PackResult;
  deliveryRes: DeliveryResult;
  /** 외곽 반출을 껐으면 `null`. */
  perim: PerimeterPassResult | null;
  terminusCorridors: UndergroundCorridor[];
  recipeOfId: ReadonlyMap<string, string>;
  nodeCount: number;
  makeId: (prefix: string) => string;
}

export function candidateOf(facts: CandidateFacts): CandidateLeaf {
  const { pack, deliveryRes, perim, terminusCorridors, recipeOfId, nodeCount, makeId } = facts;
  const droppedKeys = perim?.droppedCellKeys ?? new Set<string>();
  const relocOrigin = new Map<string, { x: number; y: number }>();
  const relocBelts = new Map<string, typeof deliveryRes.cells>();
  for (const r of perim?.relocations ?? []) {
    relocOrigin.set(r.chestId, r.origin);
    relocBelts.set(r.chestId, r.belts);
  }

  // Area — internal/external.
  //    - 머신 → internal.containers
  //    - belt/인서터 셀(strip 제외) → internal.placed
  //    - 유지되는 무한상자(raw 입력·루트 출력) → external.containers + ghost 셀 external.placed
  //    - 납품 경로 belt → internal.placed
  //    strip(경계 chest+seat) 셀/상자는 제외.
  const internal = makeEmptyArea("internal");
  const external = makeEmptyArea("external");
  const stripCells = deliveryRes.strippedCellKeys;
  const stripChests = deliveryRes.strippedChestIds;

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
      // stripCells=납품 경로가 뗀 경계 chest/seat, droppedKeys=perimeter 이사한 상자의 옛 ghost/feeder.
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
  for (const c of deliveryRes.cells) internal.placed.push(c);
  // perimeter 재배치가 새로 깐 셀(belt+feeder+이사한 chest) — mod.cells 순회와 같은 분류.
  for (const c of perim?.addedCells ?? []) {
    if (c.cell.entityType === EntityType.InfinityChest) external.placed.push(c);
    else internal.placed.push(c);
  }
  // 납품 경로 지하 corridor — Area 인덱스에 기록해 이후 라우팅(드래그 재라우팅 등)이 같은
  // 직선 위 페어링 절단을 피하게 한다. placed 와 같은 직접-기록 규약(비-이중-commit:
  // 이 candidate 의 routings 는 commitRouting 을 타지 않는다).
  internal.undergroundCorridors.push(...terminusCorridors, ...deliveryRes.corridors);

  // Routing 객체 — 선/IO 라벨/드래그 그룹 복원(옛 routings=[] 한계 해소). 끝점은 실제
  //    컨테이너 id(머신 = `${모듈id}-m0`, 유지된 상자). placed = 납품 경로 belt 셀(직선 폴백 가능).
  //    납품 경로=머신→머신(부모-자식, 드래그 트리), raw 입력=상자→머신, 루트 출력=머신→상자.
  const routings: Routing[] = [];
  const itemPort = (containerId: string, cell: { x: number; y: number }, face: PortFace): ContainerPort =>
    ({ containerId, cell, face, kind: "item" });
  // **위치가 아니라 신원으로 짝짓는다.** `routeDeliveryRoutes` 는 유체를 먼저 깔려고
  // `pack.deliveries` 를 재정렬해서 돌므로 결과 배열의 순서가 계획 순서와 다르다 —
  // `routes[i]` 로 읽으면 유체와 아이템이 섞이는 순간 **다른 경로의 셀이 이 라우팅에 붙는다**
  // (2026-08-04 수정. 안정 정렬이라 한 종류뿐이면 안 드러났고, 그 값을 쓰는 연결선 렌더까지
  //  죽어 있어 화면에도 안 나왔다).
  const routeByKey = new Map(deliveryRes.routes.map((r) => [r.key, r]));
  pack.deliveries.forEach((delivery) => {
    const route = routeByKey.get(deliveryKey(delivery));
    // belt-following: 자식 트렁크 spine + gap belt + 부모 트렁크 spine (boxless 라 연속).
    const placed = [...delivery.from.cells, ...(route?.cells ?? []), ...delivery.to.cells];
    routings.push({
      id: makeId("r"),
      kind: "item",
      from: itemPort(`${delivery.fromId}-m0`, delivery.from.anchor, delivery.from.face),
      to: itemPort(`${delivery.toId}-m0`, delivery.to.anchor, delivery.to.face),
      placed,
      // 이 납품 경로가 깐 지하 corridor(표시·수정 모드 정리용 사본 — area 기록이 원본).
      corridors: (route?.corridors ?? []).map((c) => ({ ...c, range: [c.range[0], c.range[1]] as [number, number] })),
      // 포트 산출 근거(표시용) — 자식 출력 포트 / 부모 입력 포트 각각.
      fromPortMeta: delivery.from.meta,
      toPortMeta: delivery.to.meta,
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
    label: `모듈 · ${nodeCount} 노드 · ${pack.deliveries.length} 납품 경로 · raw ${pack.rawPorts.length}`,
  };
}

/**
 * 실패를 **짚기 위한 그림** — `pack` 에서 유도만 한다(재계산 금지).
 *
 * 같은 기하를 다시 계산하면 그것이 곧 "두 번째 렌더러"가 되고, 렌더러가 아니라
 * **데이터 층에서** 어긋난다는 점에서 더 나쁘다.
 */
export function snapshotOf(
  pack: PackResult,
  issues: readonly LayoutIssue[],
  deliveryRes?: DeliveryResult,
): LayoutSnapshot {
  const problemModules = new Set(
    issues.filter((i) => i.severity === 'error' && i.target?.moduleId).map((i) => i.target!.moduleId!),
  );
  const okByKey = new Map((deliveryRes?.routes ?? []).map((r) => [r.key, r.ok]));
  return {
    modules: pack.placements.map((pl) => ({
      id: pl.id,
      recipeName: undefined,
      entityName: pl.module.machines[0]?.entityName ?? 'unknown',
      machineCount: pl.module.machines.length,
      bbox: { ...pl.module.bbox },
      status: problemModules.has(pl.id) ? 'problem' : 'ok',
    })),
    deliveries: pack.deliveries.map((d) => {
      const key = deliveryKey(d);
      return {
        key,
        item: d.item,
        from: { ...d.from.anchor },
        to: { ...d.to.anchor },
        // 라우팅까지 못 간 실패(층 2 등)면 결과가 없다 — 그건 "아직 안 깔림" 이지 실패가 아니다.
        ok: okByKey.get(key) ?? true,
      };
    }),
    bbox: { ...pack.bbox },
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
