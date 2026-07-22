/**
 * modulePacking — 모듈 트리를 좌우 계층형으로 패킹한다 (조각 3, 순수·무배선).
 *
 * 단일 출처: 본 설계안(클러스터 모듈화 — 합성/패킹).
 *
 * 각 노드를 [clusterModule.generateModule] 로 부모-무시 생성한다. 방위는 **생성 단계에서
 * 면=역할로 확정**(출력→W=부모, 입력→E=자식, (B) 정책 넘침은 잔여 면)되므로 D4 사후 회전
 * 없이 항등 방위를 쓴다. 그다음 depth 열 × **tidy-tree(RT) 세로 배치**(부모를 자식들 중앙에)로
 * 배치하고, 부모↔자식 입력 포트를 품목 매칭해 홉 스펙을 낸다.
 *
 * ## 변(side) vs face
 * generateModule 은 포트 `face` 를 트렁크 *축* 방향으로 준다(예: N 레인을 수평으로 달리는
 * 트렁크의 chest 는 face='W'일 수 있다). 좌우 트리에서 의미 있는 건 포트가 클러스터의
 * **어느 변**(W/E/N/S)에 붙었나이며, 그 단일 출처는 planner 슬롯(`meta.side`)이다 —
 * anchor↔bbox 기하 추측(X변 우선)은 N/S 레인의 코너 어깨 chest 를 오분류해 폐기했다.
 * face 정의는 불변.
 *
 * 무배선 — 라이브 회귀 0. 단위 테스트 + 전체 트리 ASCII 로만 검증.
 */

import { assignTracksLeftEdge, channelWidthFromTracks, type Interval } from "./channelPlanner";
import {
  planChannelGeometry,
  type ChannelGeometryPlan,
  type DeliveryInput,
  type ExportInput,
} from "./channelGeometryPlanner";
import { generateModule, type GeneratedModule, type ModuleInput, type ModulePort } from "../module/clusterModule";
import {
  allocateMachineLinks,
  type MachineLink,
  type MachineLinkGroup,
} from "../module/allocateMachineLinks";
import { planPerimeterLanes, type LaneContext, type LanePlan, type LanePortInput, type ExitEdge } from "./perimeterLanePlanner";
import { segment , PERIMETER_MARGIN } from "../util/helper";
import type { IoLine } from "../module/clusterPortPlanner";
import type { Container, PlacedCell } from "../containerModel";
import type { Orientation } from "../module/moduleTransform";
import { AUTO_LAYOUT_COORD_DUMP } from "../debugFlags";

/** 채널 폭 하한(셀). 단일 홉(트랙 1)도 이 폭은 확보 — 옛 COLUMN_GAP 동치(좁아지지 않음). */
const MODULE_CHANNEL_MIN = 4;
const STACK_GAP = 3; // tidy-tree 서브트리 간격 + 4b 겹침 스윕 하한

/** 한 노드의 패킹 입력 — recipe 에서 유도. */
export interface NodeSpec {
  id: string;
  depth: number;
  parentId?: string;
  machine: { entityName: string; w: number; h: number };
  count: number;
  /** ingredients=input, products=output. */
  lines: IoLine[];
  /**
   * [트렁크 파이프](../../../../docs/auto-layout-wizard.trunk-pipe.md) 계획 — 유체 줄이
   * 있는 노드만. 머신 회전 각도 + 파이프가 달릴 면. `fluid_boxes` 를 봐야 알 수 있어서
   * 게임데이터에 닿는 moduleWizard 가 계산해 넣는다.
   */
  fluidTrunk?: ModuleInput["fluidTrunk"];
  /**
   * [Parallel Inserting](../../../../docs/용어사전.md#parallel-inserting) 용량 — 줄별 클러스터
   * rate(items/sec) + 탭(인서터) 처리량. 게임데이터(레시피 시간·머신 속도)를 보는 moduleWizard 가
   * 계산해 넣는다(module/ 는 순수). 미지정이면 탭 1개(휴면).
   */
  supplyCapacity?: ModuleInput["supplyCapacity"];
}

export interface PackConfig {
  inserterEntityName: string;
  beltEntityName: string;
  /**
   * 고를 수 있는 벨트 전부([BuildSpec.belts](../buildSpec.ts)) — 수요가 벨트 한 줄을 넘을 때
   * [determineBeltCount] 가 티어를 골라 **줄을 늘린다**. 미지정이면 줄을 안 늘린다(옛 동작:
   * 거절 → 다이렉트).
   */
  belts?: ModuleInput["belts"];
  longInserter?: { entityName: string; reach: number };
  /** 인서터별 실제 throughput(items/sec) — depth=운반량 매칭의 슬롯 용량. */
  throughput?: { normal: number; long: number };
  /**
   * 외부상자 perimeter exit-lane 예약을 켠다(조각 6-①). true 면 채널 폭이 홉 구간에
   * 더해 lane 세로 구간까지 반영해 넓어지고 bbox 에 N/S/W/E 마진 프레임이 붙는다.
   * 미지정=off(현행 유지) — 골든/단위 테스트 회귀 0. moduleWizard 가 플래그로 전달.
   */
  reservePerimeterLanes?: boolean;
  /**
   * 채널 기하 예약(통합 장부) — 예약을 "폭"에서 "기하(누가 어느 트랙)"로 승격한다
   * (docs/auto-layout-wizard.channel-geometry-reservation.md). true 면 납품(홉)·반출(lane)
   * 경로의 트랙을 [channelGeometryPlanner] 가 패킹 시점에 배정하고(같은 쪽 판정 + 해소
   * 사다리), 채널 폭은 그 결과에서 유도(폭 역전), PackResult.channelGeometry 로 방출
   * 지시를 내린다. 미지정=off(현행 dijkstra/스캔 유지).
   */
  channelGeometry?: boolean;
  /**
   * 지하벨트 점프 거리 상한 — 장부가 **납품끼리의 교차**를 지하로 계획할 때 쓴다
   * ([channelGeometryPlanner.GeometryContext.maxJump]). 0/미지정 = 지하 불가 → 교차하는
   * 납품은 fallback(dijkstra). [moduleHop.HopConfig] 에 넘기는 값과 **같아야** 한다 —
   * 어긋나면 장부가 계획한 점프를 방출기가 거부하고 조용히 dijkstra 로 샌다.
   */
  beltMaxUndergroundDistance?: number;
}

/** 한 노드의 최종 배치 — 절대 좌표로 옮겨진 모듈 + 적용된 방위·이동량. */
export interface ModulePlacement {
  id: string;
  module: GeneratedModule; // 절대 좌표(공유 좌표계)
  orientation: Orientation;
  origin: { x: number; y: number }; // extent 좌상단이 놓인 절대 위치
}

/** 자식 출력 포트 → 부모 입력 포트 (조각 4가 belt-to-belt 라우팅). 절대 좌표. */
export interface HopSpec {
  item: string;
  from: ModulePort; // 자식 출력
  to: ModulePort; // 부모 입력
  /** 자식 모듈 id(출력 측 owner). Routing from.containerId 유도용. */
  fromId: string;
  /** 부모 모듈 id(입력 측 owner). Routing to.containerId 유도용. */
  toId: string;
  /**
   * 같은 (from,to,item) 짝들 사이의 index — **신원 없는(옛 탭/다이렉트) 홉만** 쓴다.
   * 포트가 물리적으로 교환 가능해 위치가 곧 정답이라 정직한 값이다. `linkId` 가 있으면
   * 이 값은 무시된다(신원이 있는데 위치로 다시 구분할 이유가 없다) — [hopMapKey] 참고.
   */
  seq: number;
  /**
   * **링크 그룹 신원**([ModulePort.linkId] 의 사본, `from`/`to` 양쪽이 같은 값이라야 짝이
   * 성립했으므로 어느 쪽에서 가져와도 같다). 있으면 [hopMapKey] 가 이 값을 채널 예약 키로
   * 그대로 쓴다 — `seq` 처럼 "성공한 짝 배열의 몇 번째"가 아니라 **그 벨트 자체의 신원**이라
   * 형제 홉이 실패해도 이 값은 안 흔들린다(2026-07-21, seq 의 마지막 남은 위치-의존 제거).
   */
  linkId?: string;
}

/** 홉의 결정적 방출 지시(절대 좌표) — 통합 장부의 배정을 트랙 index→x 로 변환한 것. */
export type HopGeometry =
  | { kind: "straight" }
  | { kind: "staircase"; trackX: number }
  | { kind: "columnSwitch"; startTrackX: number; switchY: number; endTrackX: number }
  | {
      /** 계단꼴 + 지하 점프들. 각 점프는 (from)에서 (to)까지 그 사이 셀 **밑으로** 건넌다. */
      kind: "undergroundCrossing";
      trackX: number;
      jumps: { from: { x: number; y: number }; to: { x: number; y: number } }[];
    };

/** 채널 기하 예약 결과 — moduleHop(납품 방출)·modulePerimeterPass(반출 재생)가 소비. */
export interface PackChannelGeometry {
  /** [hopMapKey] → 방출 지시. 없는 홉 = fallback(기존 dijkstra). */
  hops: Map<string, HopGeometry>;
  /** 반출 경로 예약 셀(절대 cellKey) — 폴백 dijkstra 홉이 침범하면 안 되는 자리. */
  reservedExportCells: Set<string>;
}

/**
 * **신원 없는(옛 탭/다이렉트, 교환 가능) 홉만을 위한** 위치 기반 키. **직접 부르지 않는다** —
 * 모든 소비처는 [hopMapKey] 를 쓴다. 밖으로 안 내보내는 이유: 이 함수만 부르면 `linkId` 를
 * 빠뜨린 채 `seq=0` 기본값으로 **엉뚱한 홉**을 조회하게 된다(2026-07-21, 바로 이 실수가
 * `channelGeometryPlanner.test.ts` 에 있었다 — count=1 픽스처라 우연히 안 터졌을 뿐이었다).
 *
 * 1:1 방출(트렁크 비활성)에서는 자식 출력 포트가 머신 수만큼, 부모 입력 포트도 머신 수만큼
 * 있으므로 같은 (from,to,item) 홉이 **여럿**이다. `seq`(짝 index)가 그것들을 구분한다 —
 * 포트가 물리적으로 교환 가능해 위치가 곧 정직한 유일한 신원이기 때문이다.
 */
function hopKey(fromId: string, toId: string, item: string, seq = 0): string {
  return `${fromId}→${toId}:${item}#${seq}`;
}

/**
 * `PackChannelGeometry.hops`/[reservationEmittable] 의 조회 키 — 소비처가 부를 **유일한**
 * 함수. 신원(`linkId`)이 있으면 그대로 쓰고, 없으면(교환 가능 포트) [hopKey] 로 위치 기반
 * 키를 만든다.
 */
export function hopMapKey(hop: { fromId: string; toId: string; item: string; seq: number; linkId?: string }): string {
  return hop.linkId ?? hopKey(hop.fromId, hop.toId, hop.item, hop.seq);
}

/**
 * **링크 그룹 신원** — 자식→부모 간선의 몇 번째 벨트인가. [edgeLinkGroups] 가 자식·부모
 * 양쪽에서 **같은 값으로(child, parent, item, config)** 독립으로 계산되므로, 이 키를
 * 대화 없이 양쪽이 동일하게 재현할 수 있다. `ModulePort.linkId` 가 이 값을 그대로 든다.
 */
function linkGroupId(childId: string, parentId: string, item: string, groupIndex: number): string {
  return `${childId}→${parentId}:${item}#${groupIndex}`;
}

/**
 * 자식 출력 포트 ↔ 부모 입력 포트 **짝짓기** (같은 품목).
 *
 * 두 종류가 섞여 들어온다:
 *  - **신원 있는 포트**([ModulePort.linkId], link 그룹에서 난 포트) — 상대가 **정해져 있다**.
 *    `linkId` 로 직접 조회한다(추측이 아니라 조회). 못 찾으면 **예약 불변식이 깨졌다는
 *    신호**([channel-geometry-reservation] 철학)라 그 포트만 raw 로 남기고 `mismatches` 에
 *    사유를 남긴다 — `modulePerimeterPass.fail` 과 같은 관용구(skip, throw 안 함).
 *  - **신원 없는 포트**(옛 탭/다이렉트) — 물리적으로 교환 가능해 정답이 없다. 등장 순서대로
 *    **1:1 로 짝**짓는다(기존 동작 그대로).
 *
 * 개수가 안 맞으면(신원 없는 쪽) 남는 쪽은 짝이 없다 — 부모 입력이 남으면 무한상자로 남아
 * 외부에서 공급받고(raw), 자식 출력이 남으면 무한상자 sink 로 남는다. 둘 다 perimeter 로
 * 나가야 하므로 `rawPorts` 에 들어간다.
 *
 * `usedIn` 은 **같은 부모를 여러 자식이 먹일 때**(같은 품목을 두 노드가 생산) 부모 입력
 * 포트를 두 번 쓰지 않게 하는 장부다.
 */
function pairHopPorts(
  childMod: GeneratedModule,
  parentMod: GeneratedModule,
  item: string,
  usedIn: Set<string>,
  mismatches: string[],
): { out: ModulePort; inp: ModulePort }[] {
  const outs = childMod.outputPorts.filter((p) => p.line.name === item);
  const ins = parentMod.inputPorts.filter((p) => p.line.name === item && !usedIn.has(p.chest.id));
  const pairs: { out: ModulePort; inp: ModulePort }[] = [];

  // ① 신원이 있는 쪽 — 조회. 배열 위치가 아니라 linkId 로 짝을 찾는다.
  const insById = new Map(ins.filter((p) => p.linkId !== undefined).map((p) => [p.linkId!, p]));
  const exchangeableOuts: ModulePort[] = [];
  for (const out of outs) {
    if (out.linkId === undefined) { exchangeableOuts.push(out); continue; }
    const inp = insById.get(out.linkId);
    if (!inp) {
      mismatches.push(`${out.linkId}: no matching parent input port (child emitted, parent didn't)`);
      continue;
    }
    usedIn.add(inp.chest.id);
    insById.delete(out.linkId);
    pairs.push({ out, inp });
  }

  // ② 신원이 없는 쪽(옛 탭/다이렉트) — 교환 가능이라 위치-zip 이 정답이다(기존 동작 그대로).
  const exchangeableIns = ins.filter((p) => p.linkId === undefined && !usedIn.has(p.chest.id));
  for (let i = 0; i < Math.min(exchangeableOuts.length, exchangeableIns.length); i++) {
    usedIn.add(exchangeableIns[i].chest.id);
    pairs.push({ out: exchangeableOuts[i], inp: exchangeableIns[i] });
  }

  return pairs;
}

export interface PackResult {
  placements: ModulePlacement[];
  hops: HopSpec[];
  /** child 없는 입력 포트 — raw(무한상자 유지). 절대 좌표. */
  rawPorts: ModulePort[];
  bbox: { x: number; y: number; w: number; h: number };
  /** 외부상자 perimeter exit-lane 배정(조각 6-①). ②③(재배치·라우팅)이 소비. */
  lanePlan: LanePlan;
  /** 채널 기하 예약(통합 장부) — config.channelGeometry 일 때만. */
  channelGeometry?: PackChannelGeometry;
  /**
   * **링크 신원 불일치** — 자식이 `linkId` 를 선언한 그룹을 냈는데 부모 쪽에서 짝을 못 찾은
   * 경우([pairHopPorts]). 정상적으로 있을 수 있는 일이 **아니다**: 신원은 자식·부모가 같은
   * [edgeLinkGroups] 를 독립으로 돌려 나온 값이라 원래는 항상 일치해야 한다. 여기 항목이
   * 있으면 예약 불변식이 깨진 것 — 조사 대상이지 정상 경로가 아니다. 비어 있으면 `[]`.
   */
  linkMismatches: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 엣지(자식→부모, 한 품목)의 [MachineLink] 목록을 spec 의 rate·count 에서 유도.
 * rate 나 처리량을 모르면 `undefined`(지어내지 않는다).
 *
 * **논리 층 — 좌표·전략 무관.** 자식 머신당 산출 = 클러스터 산출 ÷ 대수, 부모 머신당
 * 수요 = 클러스터 수요 ÷ 대수. 인서터 처리량은 보수적으로 min(normal, long)([insertingPlanner]
 * 의 tapCap 과 동일), 벨트는 가장 빠른 티어. Phase 2(출력 emit)가 이 결과를 소비한다.
 */
export function edgeMachineLinks(
  child: NodeSpec,
  parent: NodeSpec,
  item: string,
  config: PackConfig,
): MachineLink[] | undefined {
  const tp = config.throughput ? Math.min(config.throughput.normal, config.throughput.long) : 0;
  const belt = config.belts?.[0]?.throughput ?? 0;
  if (tp <= 0 || belt <= 0 || child.count <= 0 || parent.count <= 0) return undefined;
  const outTotal = child.supplyCapacity?.lineRates?.get(`output:${item}`);
  const inTotal = parent.supplyCapacity?.lineRates?.get(`input:${item}`);
  if (outTotal === undefined || inTotal === undefined) return undefined;
  return allocateMachineLinks({
    childCount: child.count,
    parentCount: parent.count,
    childProduction: outTotal / child.count,
    parentDemand: inTotal / parent.count,
    item,
    inserterThroughput: tp,
    beltThroughput: belt,
  });
}

/**
 * 한 엣지의 링크를 **벨트**로 — **링크 하나 = 벨트 하나 = 포트 한 쌍**(v1, 2026-07-22).
 *
 * 예전엔 여기서 같은 (품목, 자식 머신)의 연속 링크를 `min(그릇, 자식 머신 좌석)` 까지 한
 * 벨트로 묶었다. 그 병합이 부모 머신의 **인접**을 요구했고(벨트 하나가 여럿을 관통해야
 * 하므로), 인접이 클러스터를 세로 한 줄로 못박아 한 면의 벨트 줄 수를 팔 길이에 묶었다 —
 * 채널 트랙 하나 값으로는 너무 비쌌다. 되살릴 때는 채널 층에서 합친다(같은 품목 벨트끼리는
 * 합류해도 오염이 없다). 근거: docs/auto-layout-wizard.cluster-redesign.md
 *
 * 이 함수는 간선당 [packModuleTree] 안에서 **한 번만** 불린다(사전 캐시) — 자식(출력 emit)과
 * 부모(입력 emit)는 그 결과 [MachineLinkGroup] 객체를 그대로 참조하므로 짝이 어긋날 수 없다.
 * `id`([linkGroupId])도 여기서 한 번 매겨져 그룹 안에 실린다.
 */
export function edgeLinkGroups(
  child: NodeSpec,
  parent: NodeSpec,
  item: string,
  config: PackConfig,
): MachineLinkGroup[] | undefined {
  const links = edgeMachineLinks(child, parent, item, config);
  if (!links || links.length === 0) return undefined;
  return links.map((l, gi) => ({
    id: linkGroupId(child.id, parent.id, item, gi),
    fromMachine: l.fromMachine,
    item: l.item,
    taps: [{ toMachine: l.toMachine, inserterCount: l.inserterCount }],
  }));
}

export function packModuleTree(specs: NodeSpec[], config: PackConfig): PackResult {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const childIdsByParent = new Map<string, string[]>();
  for (const s of specs) {
    if (!s.parentId) continue;
    (childIdsByParent.get(s.parentId) ?? childIdsByParent.set(s.parentId, []).get(s.parentId)!).push(s.id);
  }
  /** 노드가 부모에 내보내는 품목(= 출력 라인 이름). */
  const productOf = (s: NodeSpec): string | undefined =>
    s.lines.find((l) => l.role === "output")?.name;
  /** 부모 입력 중 자식-공급인 품목 집합. */
  const childFedItems = (s: NodeSpec): Set<string> => {
    const set = new Set<string>();
    for (const cid of childIdsByParent.get(s.id) ?? []) {
      const p = productOf(byId.get(cid)!);
      if (p) set.add(p);
    }
    return set;
  };

  // 노출 끝면(N/S) — count=1 완화의 노출 판정. 세로 순서는 tidy-tree 가 DFS 방문
  // 순서를 보존하므로(형제 재배열 없음) 좌표 확정 *전에* 열-내 서열로 유도할 수 있다
  // (스도쿠 닻: 트리 구조가 외생). 열의 첫 모듈 위(N)·마지막 모듈 아래(S)는 전역
  // 마진뿐 — 그 방향 레인이 형제와 충돌하지 않는다.
  const dfsByDepth = new Map<number, string[]>();
  const dfsVisit = (id: string) => {
    const s = byId.get(id)!;
    (dfsByDepth.get(s.depth) ?? dfsByDepth.set(s.depth, []).get(s.depth)!).push(id);
    for (const cid of childIdsByParent.get(id) ?? []) dfsVisit(cid);
  };
  for (const s of specs) if (!s.parentId) dfsVisit(s.id);
  const nsExposureOf = (s: NodeSpec): ("N" | "S")[] | undefined => {
    if (s.count !== 1) return undefined; // 기둥(count≥2)은 N/S 레인이 끝 머신만 서빙 — 제외.
    const col = dfsByDepth.get(s.depth)!;
    const faces: ("N" | "S")[] = [];
    if (col[0] === s.id) faces.push("N");
    if (col[col.length - 1] === s.id) faces.push("S");
    return faces.length ? faces : undefined;
  };

  // 면=역할은 생성 단계에서 확정되므로 사후 회전 없이 항등 방위.
  const IDENTITY: Orientation = { rotation: 0, reflect: false };

  // 간선당 [edgeLinkGroups] 를 **한 번만** 계산해 자식 id 로 캐시한다(간선 = 자식→부모,
  // 자식 하나는 출력 품목이 하나뿐이므로 childId 만으로 간선이 유일하게 식별된다).
  // 자식 쪽(outputLinksOf)과 부모 쪽(inputLinksOf)이 예전엔 이 계산을 각자 독립으로
  // 두 번 돌려 "결정적 함수+같은 입력이면 같은 출력"이라는 결정성만 믿고 일치를 기대했다
  // (2026-07-21 이전) — 이제 한 번 계산된 같은 객체를 양쪽이 그대로 참조한다.
  const linkGroupCache = new Map<string, MachineLinkGroup[]>();
  for (const s of specs) {
    if (!s.parentId) continue;
    const product = productOf(s);
    if (!product) continue;
    const groups = edgeLinkGroups(s, byId.get(s.parentId)!, product, config);
    if (groups) linkGroupCache.set(s.id, groups);
  }
  // 출력 fan-out 링크 — 이 노드의 출력을 부모 머신들에게 나눠 주는 [MachineLinkGroup] 목록.
  // 부모가 있고 rate·처리량이 다 있을 때만(없으면 undefined = 옛 트렁크 방출).
  const outputLinksOf = (s: NodeSpec): MachineLinkGroup[] | undefined => linkGroupCache.get(s.id);
  // 입력 fan-in 그룹 — outputLinks 의 거울. 이 노드가 부모인 간선들(자식마다)의 그룹을 모은다.
  // 캐시에서 그대로 가져오므로 자식 쪽과 그룹 객체(및 id)가 완전히 일치한다.
  const inputLinksOf = (s: NodeSpec): MachineLinkGroup[] | undefined => {
    const kids = childIdsByParent.get(s.id) ?? [];
    const groups: MachineLinkGroup[] = [];
    for (const cid of kids) {
      const g = linkGroupCache.get(cid);
      if (g) groups.push(...g);
    }
    return groups.length > 0 ? groups : undefined;
  };
  const gen = (s: NodeSpec, lineEnds?: Map<string, "min" | "max">): GeneratedModule => {
    return generateModule({
      ...toModuleInput(s, config, childFedItems(s)),
      lineEnds,
      nsExposure: nsExposureOf(s),
      outputLinks: outputLinksOf(s),
      inputLinks: inputLinksOf(s),
    });
  };

  // 1) 1차 생성(끝 무선호) — extent/높이 산정용. (높이는 끝 선호와 무관 → Y 배치는 1차로 OK.)
  const pass1 = new Map<string, GeneratedModule>();
  for (const s of specs) pass1.set(s.id, gen(s));

  // 2) tidy-tree(RT) 세로 배치 — 부모를 자식들 중앙에(Reingold–Tilford 풍). 옛 id-stack
  //    preview 대체. 6/13 측정상 무용했으나(그땐 채널 없어 홉=raw 거리), 채널 폭(piece 5)이
  //    부모↔자식 근접을 보상하므로 복원 — 부모를 자식 곁에 두면 교차 구간↓→트랙↓→폭↓.
  const heightOf = (id: string): number => moduleExtent(pass1.get(id)!).h;
  const topY = new Map<string, number>();
  const cursor = { y: 0 };
  const layoutY = (id: string): number => {
    const kids = childIdsByParent.get(id) ?? [];
    if (kids.length === 0) {
      const top = cursor.y;
      topY.set(id, top);
      cursor.y = top + heightOf(id) + STACK_GAP;
      return top + heightOf(id) / 2;
    }
    const centers = kids.map(layoutY);
    const center = (centers[0] + centers[centers.length - 1]) / 2;
    topY.set(id, center - heightOf(id) / 2);
    return center;
  };
  for (const s of specs) if (!s.parentId) layoutY(s.id);

  // 2b) 열 단위 겹침 안전 스윕 — 반올림·키 큰 노드가 같은 depth 에서 안 겹치게 아래로 민다.
  const idsByDepth = new Map<number, string[]>();
  for (const s of specs) (idsByDepth.get(s.depth) ?? idsByDepth.set(s.depth, []).get(s.depth)!).push(s.id);
  for (const ids of idsByDepth.values()) {
    ids.sort((a, b) => topY.get(a)! - topY.get(b)!);
    let prevBottom = -Infinity;
    for (const id of ids) {
      let t = Math.round(topY.get(id)!);
      if (t < prevBottom + STACK_GAP) t = prevBottom + STACK_GAP;
      topY.set(id, t);
      prevBottom = t + heightOf(id);
    }
  }

  // 3) 포트 끝(DOF-B) 의도 — 각 홉에서 자식 출력끝·부모 입력끝을 |Δy| 최소 조합으로 고른다.
  //    끝 후보는 각 기둥의 위끝(min=topY)·아래끝(max=topY+h) 둘. 부모가 자식 위에 겹쳐
  //    중심이 같아도 같은 쪽 끝을 골라 마주 보게 한다(중심 비교는 겹침에서 degenerate).
  //    자식별 부모 입력은 품목이 달라 서로 다른 슬롯 → 끝을 독립 선택해도 충돌 없음.
  const ends = (id: string): Record<"min" | "max", number> => ({
    min: topY.get(id)!,
    max: topY.get(id)! + heightOf(id),
  });
  const lineEndsById = new Map<string, Map<string, "min" | "max">>();
  const setEnd = (id: string, key: string, end: "min" | "max") => {
    (lineEndsById.get(id) ?? lineEndsById.set(id, new Map()).get(id)!).set(key, end);
  };
  const EE = ["min", "max"] as const;
  for (const s of specs) {
    if (!s.parentId) continue;
    const product = productOf(s);
    if (!product) continue;
    const c = ends(s.id), p = ends(s.parentId);
    let bestC: "min" | "max" = "min", bestP: "min" | "max" = "min", bestD = Infinity;
    for (const ce of EE) for (const pe of EE) {
      const d = Math.abs(c[ce] - p[pe]);
      if (d < bestD) { bestD = d; bestC = ce; bestP = pe; }
    }
    setEnd(s.id, `output:${product}`, bestC);
    setEnd(s.parentId, `input:${product}`, bestP);
  }

  // 4) 2차 생성 — 끝 선호 반영(포트가 부모↔자식 방향 끝으로 정렬).
  const oriented = new Map<string, { module: GeneratedModule; orientation: Orientation }>();
  for (const s of specs) oriented.set(s.id, { module: gen(s, lineEndsById.get(s.id)), orientation: IDENTITY });

  // 5) 열 폭 + 채널 폭(수요 기반) → x 좌표. 채널 d(깊이 d↔d-1)를 가로지르는 홉을 세로
  //    구간 [min(자식포트y, 부모포트y), max(...)] 으로 모아 left-edge 트랙 수 = 폭의 근거.
  //    포트 abs-y = 로컬 anchor.y + (topY - ext.y) (colX 무관 → 배치 전 계산 가능). 끝 정렬
  //    (piece 4)으로 구간이 짧아 트랙↓→폭↓. channelPlanner 코드 무수정(좌표-무지).
  const maxDepth = Math.max(...specs.map((s) => s.depth), 0);
  const colWidth = new Array(maxDepth + 1).fill(0);
  for (const s of specs) colWidth[s.depth] = Math.max(colWidth[s.depth], moduleExtent(oriented.get(s.id)!.module).w);

  const absPortY = (id: string, anchorY: number): number =>
    anchorY + topY.get(id)! - moduleExtent(oriented.get(id)!.module).y;
  const intervalsByDepth = new Map<number, { lo: number; hi: number }[]>();
  // 홉 씨앗 — 기하 예약(5c)의 납품 경로 입력. eligible = 자식 출력이 W변·부모 입력이 E변
  // (= 둘 사이 채널을 정면으로 가로지르는 계단꼴 모델의 전제). 아니면(스필 등) 폭만 예약.
  //    짝짓기는 `oriented` 에서 한 번만 하고(결정적), 짝지은 상자 id 를 아래 5b(레인 예약)
  //    와 7(홉 생성)이 공유한다 — 세 곳이 따로 판단해 어긋나는 일이 없게.
  const hopSeeds: { depth: number; key: string; startY: number; endY: number; eligible: boolean }[] = [];
  const pairedChestIds = new Set<string>();
  const usedParentIn = new Map<string, Set<string>>();
  /** [pairHopPorts] 가 신원 있는 포트끼리 짝을 못 찾았을 때 쌓는 사유 — 정상 경로가 아니다. */
  const linkMismatches: string[] = [];
  /** [자식 id] → 짝지은 (출력상자 id, 입력상자 id, linkId) 쌍들. 7)이 absById 로 재구성한다. */
  const hopPairs = new Map<string, { item: string; outId: string; inId: string; linkId?: string }[]>();
  for (const s of specs) {
    if (!s.parentId) continue;
    const product = productOf(s);
    if (!product) continue;
    const used = usedParentIn.get(s.parentId) ?? usedParentIn.set(s.parentId, new Set()).get(s.parentId)!;
    const pairs = pairHopPorts(oriented.get(s.id)!.module, oriented.get(s.parentId)!.module, product, used, linkMismatches);
    hopPairs.set(
      s.id,
      pairs.map((p) => ({ item: product, outId: p.out.chest.id, inId: p.inp.chest.id, linkId: p.out.linkId })),
    );
    pairs.forEach(({ out, inp }, i) => {
      pairedChestIds.add(out.chest.id);
      pairedChestIds.add(inp.chest.id);
      const cy = absPortY(s.id, out.anchor.y);
      const py = absPortY(s.parentId!, inp.anchor.y);
      (intervalsByDepth.get(s.depth) ?? intervalsByDepth.set(s.depth, []).get(s.depth)!).push({
        lo: Math.min(cy, py),
        hi: Math.max(cy, py),
      });
      hopSeeds.push({
        depth: s.depth,
        key: hopMapKey({ fromId: s.id, toId: s.parentId!, item: product, seq: i, linkId: out.linkId }),
        startY: cy,
        endY: py,
        eligible:
          out.meta.side === "W" && inp.meta.side === "E" && byId.get(s.parentId!)!.depth === s.depth - 1,
      });
    });
  }

  // 5b) 외부상자 exit-lane 예약(조각 6-①) — 살아남은 raw 입력·루트 출력 상자를 인접 gap
  //     으로 빼는 lane 을 planner 에 맡긴다. 채널로 우회하는 lane 의 세로 구간은 위 홉
  //     구간과 **합쳐** 채널 폭에 반영(결정 A: 폭만 예약, 트랙 index 는 라우터). colX 전이라
  //     X 없이 abs y+depth 만으로 판정 가능. 항상 계산해 PackResult 에 싣고, 실제 폭/마진
  //     반영은 reservePerimeterLanes 게이트.
  const lanePlan = planLanes(specs, oriented, topY, pairedChestIds, maxDepth, absPortY);
  if (config.reservePerimeterLanes) {
    for (const [d, ivs] of lanePlan.channelLaneIntervals)
      for (const iv of ivs) (intervalsByDepth.get(d) ?? intervalsByDepth.set(d, []).get(d)!).push(iv);
  }

  // 5c) 채널 기하 예약(통합 장부) — 납품·반출 경로를 한 장부에 모아 트랙을 배정한다
  //     (같은 쪽 판정 + 해소 사다리, docs/…channel-geometry-reservation.md). 폭 역전:
  //     아래 channelWidth 가 이 배정 결과(trackCount)에서 폭을 유도한다. 부적격 경로
  //     (스필 홉·N/S 우회 반출)는 폭만 예약(reserveIntervals)하고 기존 dijkstra/스캔에 맡긴다.
  const geometryPlans = new Map<number, ChannelGeometryPlan>();
  if (config.channelGeometry) {
    let gyMin = Infinity, gyMax = -Infinity;
    for (const s of specs) {
      const top = topY.get(s.id)!;
      gyMin = Math.min(gyMin, top);
      gyMax = Math.max(gyMax, top + moduleExtent(oriented.get(s.id)!.module).h - 1);
    }
    for (let d = 1; d <= maxDepth; d++) {
      const dels: DeliveryInput[] = [];
      const reserve: Interval[] = [];
      for (const seed of hopSeeds) {
        if (seed.depth !== d) continue;
        if (seed.eligible) dels.push({ id: seed.key, startY: seed.startY, endY: seed.endY });
        else reserve.push({ lo: Math.min(seed.startY, seed.endY), hi: Math.max(seed.startY, seed.endY) });
      }
      const exps: ExportInput[] = [];
      if (config.reservePerimeterLanes) {
        for (const a of lanePlan.assignments) {
          if (a.host.kind !== "channel" || a.host.depth !== d) continue;
          if (a.entry && (a.exitEdge === "N" || a.exitEdge === "S")) {
            exps.push({ id: a.id, entryY: a.entry.y, entryWall: a.entry.wall, preferredExit: a.exitEdge });
          } else if (a.interval) {
            reserve.push(a.interval); // N/S 우회 등 미지원 진입 — 폭만 예약
          }
        }
      }
      geometryPlans.set(
        d,
        planChannelGeometry(dels, exps, {
          yMin: gyMin,
          yMax: gyMax,
          reserveIntervals: reserve,
          maxJump: config.beltMaxUndergroundDistance ?? 0,
        }),
      );
    }
  }

  const channelWidth = (d: number): number => {
    if (config.channelGeometry) {
      // 폭 역전 — 폭은 기하 배정의 결과(사용 트랙 수)에서 유도된다.
      return channelWidthFromTracks(geometryPlans.get(d)?.trackCount ?? 0, MODULE_CHANNEL_MIN);
    }
    const ivs = intervalsByDepth.get(d) ?? [];
    return channelWidthFromTracks(assignTracksLeftEdge(ivs).trackCount, MODULE_CHANNEL_MIN);
  };
  const colX = new Array(maxDepth + 1).fill(0);
  for (let d = 1; d <= maxDepth; d++) colX[d] = colX[d - 1] + colWidth[d - 1] + channelWidth(d);

  // 6) 절대 좌표 배치 — 결정적(depth 오름차순, 같은 depth 는 id 순).
  const placements: ModulePlacement[] = [];
  const absById = new Map<string, GeneratedModule>();
  for (const s of [...specs].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id))) {
    const { module, orientation } = oriented.get(s.id)!;
    const ext = moduleExtent(module);
    const y = topY.get(s.id)!;
    const abs = shiftModule(module, colX[s.depth] - ext.x, y - ext.y);
    placements.push({ id: s.id, module: abs, orientation, origin: { x: colX[s.depth], y } });
    absById.set(s.id, abs);
  }

  // 7) 홉 = 위(5)에서 이미 짝지은 쌍을 절대좌표 포트로 재구성. raw = 짝 못 지은 포트 전부
  //    (입력이면 외부 공급 무한상자, 출력이면 무한 sink) — 둘 다 perimeter 로 나가야 한다.
  const hops: HopSpec[] = [];
  const rawPorts: ModulePort[] = [];
  const portByChestId = new Map<string, ModulePort>();
  for (const s of specs) {
    const mod = absById.get(s.id)!;
    for (const p of [...mod.inputPorts, ...mod.outputPorts]) portByChestId.set(p.chest.id, p);
  }
  for (const s of specs) {
    for (const [i, pr] of (hopPairs.get(s.id) ?? []).entries()) {
      const from = portByChestId.get(pr.outId);
      const to = portByChestId.get(pr.inId);
      if (from && to)
        hops.push({ item: pr.item, from, to, fromId: s.id, toId: s.parentId!, seq: i, linkId: pr.linkId });
    }
  }
  for (const s of specs) {
    const mod = absById.get(s.id)!;
    for (const p of [...mod.inputPorts, ...mod.outputPorts])
      if (!pairedChestIds.has(p.chest.id)) rawPorts.push(p);
  }

  const rawBbox = unionExtent(placements);

  // 7b) 기하 예약의 절대좌표 변환 — 트랙 index → 채널 내부 x, 반출 배정 확정(exitEdge
  //     뒤집힘 반영 + laneX 기록), 반출 예약 셀 산출. marginNeeds 를 갱신할 수 있으므로
  //     expandBbox 보다 먼저.
  const channelGeometry = config.channelGeometry
    ? materializeChannelGeometry({
        geometryPlans,
        hopSeeds,
        lanePlan,
        placements,
        channelStartX: (d: number) => colX[d - 1] + colWidth[d - 1],
        rawBbox,
        reserveLanes: config.reservePerimeterLanes === true,
      })
    : undefined;

  const bbox = config.reservePerimeterLanes ? expandBbox(rawBbox, lanePlan.marginNeeds) : rawBbox;
  return { placements, hops, rawPorts, bbox, lanePlan, channelGeometry, linkMismatches };
}

/**
 * 통합 장부의 추상 배정(트랙 index)을 절대좌표 지시로 변환한다.
 * - 납품: HopGeometry(트랙 x·갈아타는 행·지하 횡단 좌표) — moduleHop 이 탐색 없이 방출.
 * - 반출: LaneAssignment 에 laneX·(뒤집혔으면) exitEdge 를 기록 — ⑥C 가 그대로 재생.
 * - 예약 셀: 모든 확정 반출 경로(채널 elbow + self/margin 직선)의 절대 셀 —
 *   폴백 dijkstra 홉의 침범을 막아 "먼저 깐 경로가 자리를 뺏는" 원래 구멍을 봉인한다.
 */
function materializeChannelGeometry(args: {
  geometryPlans: Map<number, ChannelGeometryPlan>;
  hopSeeds: { depth: number; key: string; eligible: boolean }[];
  lanePlan: LanePlan;
  placements: ModulePlacement[];
  channelStartX: (d: number) => number;
  rawBbox: { x: number; y: number; w: number; h: number };
  reserveLanes: boolean;
}): PackChannelGeometry {
  const { geometryPlans, hopSeeds, lanePlan, placements, channelStartX, rawBbox, reserveLanes } = args;
  const hops = new Map<string, HopGeometry>();
  for (const seed of hopSeeds) {
    if (!seed.eligible) continue;
    const plan = geometryPlans.get(seed.depth)?.deliveries.get(seed.key);
    if (!plan || plan.kind === "fallback") {
      // **장부가 왜 포기했는지는 여기서만 알 수 있다** — 아래로 안 내려보내면 소비처는
      // "계획이 없다"만 보고 이유를 영영 못 본다(2026-07-22 조사에서 계측을 새로 만들어야
      // 했던 자리). 포기한 홉 하나가 탐색으로 내려가면 남의 계획까지 밟아 **연쇄**하므로
      // ([moduleHop] 의 "예약 무시 재시도"), 이 한 줄이 그 연쇄의 출발점을 가리킨다.
      if (AUTO_LAYOUT_COORD_DUMP)
        console.log("[channelGeometry] 계획 포기 —", seed.key, plan ? plan.reason : "계획 자체가 없음");
      continue;
    }
    const tx = (t: number) => channelStartX(seed.depth) + 1 + t;
    if (plan.kind === "straight") hops.set(seed.key, { kind: "straight" });
    else if (plan.kind === "staircase") hops.set(seed.key, { kind: "staircase", trackX: tx(plan.track) });
    else if (plan.kind === "columnSwitch")
      hops.set(seed.key, {
        kind: "columnSwitch",
        startTrackX: tx(plan.startTrack),
        switchY: plan.switchY,
        endTrackX: tx(plan.endTrack),
      });
    else
      hops.set(seed.key, {
        kind: "undergroundCrossing",
        trackX: tx(plan.track),
        // 행은 이미 abs y. 열만 트랙 index → 절대 x. 벽 마진 열(-1 / capCol)은 점프에
        // 안 나온다(점프는 트랙 밴드 안에서만 생긴다) — tx 가 그 밖으로 새지 않는다.
        jumps: plan.jumps.map((j) => ({
          from: { x: tx(j.fromCol), y: j.fromRow },
          to: { x: tx(j.toCol), y: j.toRow },
        })),
      });
  }

  const reservedExportCells = new Set<string>();
  if (reserveLanes) {
    // 포트 anchor(절대) — 상자 id 로 조회.
    const portByChest = new Map<string, ModulePort>();
    for (const pl of placements)
      for (const p of [...pl.module.inputPorts, ...pl.module.outputPorts]) portByChest.set(p.chest.id, p);
    const M = PERIMETER_MARGIN;
    const seatRow = (edge: "N" | "S") => (edge === "N" ? rawBbox.y - M : rawBbox.y + rawBbox.h - 1 + M);
    const seatCol = (edge: "W" | "E") => (edge === "W" ? rawBbox.x - M : rawBbox.x + rawBbox.w - 1 + M);
    const addSeg = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      for (const c of segment(from, to)) reservedExportCells.add(`${c.x},${c.y}`);
    };
    for (const a of lanePlan.assignments) {
      const port = portByChest.get(a.id);
      if (!port) continue;
      const anchor = { x: port.anchor.x, y: port.anchor.y };
      if (a.host.kind === "channel") {
        const plan = geometryPlans.get(a.host.depth)?.exports.get(a.id);
        if (plan?.kind !== "elbow") continue; // fallback — 예약 없음(스캔·skip 유지)
        const laneX = channelStartX(a.host.depth) + 1 + plan.track;
        a.exitEdge = plan.exitEdge; // 해소 사다리 ①에서 뒤집혔을 수 있다
        a.laneX = laneX;
        lanePlan.marginNeeds[plan.exitEdge] = true;
        const corner = { x: laneX, y: anchor.y };
        addSeg(anchor, corner);
        addSeg(corner, { x: laneX, y: seatRow(plan.exitEdge) });
      } else if (a.exitEdge === "N" || a.exitEdge === "S") {
        addSeg(anchor, { x: anchor.x, y: seatRow(a.exitEdge) });
      } else {
        addSeg(anchor, { x: seatCol(a.exitEdge), y: anchor.y });
      }
    }
  }

  return { hops, reservedExportCells };
}

/** marginNeeds 만큼 bbox 프레임을 넓힌다(상자 seat 자리 예약, ②가 소비). */
function expandBbox(
  b: { x: number; y: number; w: number; h: number },
  m: { N: boolean; S: boolean; W: boolean; E: boolean },
): { x: number; y: number; w: number; h: number } {
  const M = PERIMETER_MARGIN;
  const l = m.W ? M : 0, r = m.E ? M : 0, t = m.N ? M : 0, bt = m.S ? M : 0;
  return { x: b.x - l, y: b.y - t, w: b.w + l + r, h: b.h + t + bt };
}

/**
 * 살아남은 외부상자 포트(raw 입력 + 루트 출력)를 모아 exit-lane 을 배정한다.
 * 모듈 내부를 안 보는 planner 의 입력(변·abs y·depth·열 밴드)만 준비.
 */
function planLanes(
  specs: NodeSpec[],
  oriented: Map<string, { module: GeneratedModule; orientation: Orientation }>,
  topY: Map<string, number>,
  /** 홉으로 짝지어진 상자 id — 이 포트들은 belt 로 이어지므로 반출 대상이 아니다. */
  pairedChestIds: ReadonlySet<string>,
  maxDepth: number,
  absPortY: (id: string, anchorY: number) => number,
): LanePlan {
  // 변 = planner 슬롯(meta.side)이 단일 출처. 예전엔 anchor↔bbox 기하로 추측했지만
  // (X변 우선), N/S 레인의 chest 는 트렁크가 레인을 따라 수평으로 자라 코너 어깨
  // (x·y 둘 다 bbox 밖)에 앉을 수 있어 W/E 로 오분류된다 — N 레인 상자는 위가 전역
  // 마진이라 self-N 직진이 정답인데 채널 우회로 배정되는 낭비/실패 위험.
  const sideOf = (p: ModulePort): ExitEdge => p.meta.side;
  const ports: LanePortInput[] = [];
  let gyMin = Infinity, gyMax = -Infinity;
  const bandsByDepth = new Map<number, { id: string; top: number; bottom: number }[]>();
  for (const s of specs) {
    const mod = oriented.get(s.id)!.module;
    const ext = moduleExtent(mod);
    const top = topY.get(s.id)!;
    const bottom = top + ext.h - 1;
    gyMin = Math.min(gyMin, top);
    gyMax = Math.max(gyMax, bottom);
    (bandsByDepth.get(s.depth) ?? bandsByDepth.set(s.depth, []).get(s.depth)!).push({ id: s.id, top, bottom });
    // 반출 대상 = **홉으로 짝지어지지 않은 포트 전부**. 입력이면 외부 공급 무한상자,
    // 출력이면 무한 sink — 둘 다 perimeter 로 나가야 한다. (1:1 방출이라 자식 출력이
    // 부모 입력보다 많으면 남는 출력도 여기 들어온다.) wayOuts = 모듈이 답해준
    // "나갈 수 있는 방향들" — 배정이 못 쓰는 방향을 예약하지 않게 한다.
    for (const p of [...mod.inputPorts, ...mod.outputPorts])
      if (!pairedChestIds.has(p.chest.id))
        ports.push({
          id: p.chest.id,
          role: p.line.role,
          depth: s.depth,
          side: sideOf(p),
          anchorY: absPortY(s.id, p.anchor.y),
          wayOuts: p.moduleWayOuts,
        });
  }
  const ctx: LaneContext = { globalY: { min: gyMin, max: gyMax }, maxDepth, bandsByDepth };
  return planPerimeterLanes(ports, ctx);
}

// ─────────────────────────────────────────────────────────────────────────────
// extent / 이동 / 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/** 모듈이 차지하는 실제 범위 = 머신 footprint ∪ 모든 placed 셀(튀어나온 포트 상자 포함). */
export function moduleExtent(mod: GeneratedModule): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const mk = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const m of mod.machines) {
    mk(m.origin.x, m.origin.y);
    mk(m.origin.x + m.size.w - 1, m.origin.y + m.size.h - 1);
  }
  for (const c of mod.cells) mk(c.x, c.y);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function shiftModule(mod: GeneratedModule, dx: number, dy: number): GeneratedModule {
  const pt = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
  const ctn = (c: Container): Container => ({ ...c, origin: pt(c.origin) });
  const chestById = new Map<string, Container>();
  const chests = mod.chests.map((c) => { const s = ctn(c); chestById.set(s.id, s); return s; });
  const port = (p: ModulePort): ModulePort => ({
    line: p.line, anchor: pt(p.anchor), tapAnchor: pt(p.tapAnchor), face: p.face,
    moduleWayOuts: p.moduleWayOuts, // 방향 집합 — 평행이동 불변.
    chest: chestById.get(p.chest.id) ?? ctn(p.chest),
    cells: p.cells.map((c): PlacedCell => ({ x: c.x + dx, y: c.y + dy, cell: c.cell })),
    meta: p.meta, // 산출 근거 — 좌표 없음(이동 불변).
    linkId: p.linkId, // 그룹 신원 — 좌표 없음(이동 불변). 안 옮기면 pairHopPorts 가 못 찾는다.
  });
  return {
    machines: mod.machines.map(ctn),
    chests,
    cells: mod.cells.map((c): PlacedCell => ({ x: c.x + dx, y: c.y + dy, cell: c.cell })),
    ring: mod.ring.map(pt),
    inputPorts: mod.inputPorts.map(port),
    outputPorts: mod.outputPorts.map(port),
    bbox: { x: mod.bbox.x + dx, y: mod.bbox.y + dy, w: mod.bbox.w, h: mod.bbox.h },
    unroutedLines: mod.unroutedLines,
    supply: mod.supply, // 공급 방식 판정 — 좌표 없음(이동 불변).
  };
}

function unionExtent(placements: ModulePlacement[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pl of placements) {
    const e = moduleExtent(pl.module);
    minX = Math.min(minX, e.x); minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x + e.w - 1); maxY = Math.max(maxY, e.y + e.h - 1);
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function toModuleInput(s: NodeSpec, config: PackConfig, fed: Set<string>): ModuleInput {
  return {
    machine: s.machine,
    count: s.count,
    // external = 트리 안 생산자 없는 입력(무한상자로 살아남음) — planner 의 노출
    // N/S 완화 대상. 내부 간선(홉 대체 예정)·출력은 W/E 유지.
    lines: s.lines.map((l) => ({ ...l, external: l.role === "input" && !fed.has(l.name) })),
    inserterEntityName: config.inserterEntityName,
    beltEntityName: config.beltEntityName,
    belts: config.belts,
    longInserter: config.longInserter,
    throughput: config.throughput,
    idPrefix: s.id,
    // 트렁크 파이프 계획 — 게임데이터(fluid_boxes)를 보는 호출자(moduleWizard)가 이미
    // 풀어서 spec 에 실어 보낸다. module/ 는 store 를 안 본다(순수).
    fluidTrunk: s.fluidTrunk,
    // [Parallel Inserting] 용량 — 마찬가지로 게임데이터를 보는 moduleWizard 가 계산해 실었다.
    supplyCapacity: s.supplyCapacity,
  };
}

