/**
 * modulePacking — 모듈 트리를 좌우 계층형으로 패킹한다 (조각 3, 순수·무배선).
 *
 * 단일 출처: 본 설계안(클러스터 모듈화 — 합성/패킹).
 *
 * 각 노드를 [clusterModule.generateModule] 로 부모-무시 생성한다. 방위는 **생성 단계에서
 * 면=역할로 확정**(출력→W=부모, 입력→E=자식, (B) 정책 넘침은 잔여 면)되므로 D4 사후 회전
 * 없이 항등 방위를 쓴다. 그다음 depth 열 × **tidy-tree(RT) 세로 배치**(부모를 자식들 중앙에)로
 * 배치하고, 부모↔자식 입력 포트를 품목 매칭해 납품 경로 스펙을 낸다.
 *
 * ## 변(side) vs face
 * generateModule 은 포트 `face` 를 트렁크 *축* 방향으로 준다(예: N 깊이를 수평으로 달리는
 * 트렁크의 chest 는 face='W'일 수 있다). 좌우 트리에서 의미 있는 건 포트가 클러스터의
 * **어느 변**(W/E/N/S)에 붙었나이며, 그 단일 출처는 planner 슬롯(`meta.side`)이다 —
 * anchor↔bbox 기하 추측(X변 우선)은 N/S 깊이의 코너 어깨 chest 를 오분류해 폐기했다.
 * face 정의는 불변.
 *
 * 무배선 — 라이브 회귀 0. 단위 테스트 + 전체 트리 ASCII 로만 검증.
 */

import { channelWidthFromTracks, type Interval } from "./channelPlanner";
import { laneCapOfTier } from "../beltThroughput";
import { ROW_CHANNEL_MIN } from "./rowChannelPlanner";
import {
  planChannelGeometry,
  type ChannelGeometryPlan,
  type DeliveryInput,
  type ExportInput,
} from "./channelGeometryPlanner";
import type {
  DeliveryDirective, DeliverySpec, ModulePlacement, NodeSpec, PackChannelGeometry, PackConfig, PackResult,
  RowChannelEntry,
} from "./tree/types";
import { generateModule } from "../module/clusterModule";
import type { Link } from "../module/types/line";
import type { GeneratedModule, ModuleInput, ModulePort } from "../module/types/module";
import type { DepthShortage, LinkFacePlan, LinkFaceStage } from "../module/types/seat";
import { planLinkFaces } from "./module/planModulePorts";
import { seatLinkEdge } from "./module/policy";
import { cloneLinkFaceStage } from "./module/ledger";
import { clusterBeltDepthsOf } from "./module/arith";
import { linkDepthNeed, type LinkDepthNeed } from "./module/depthBudget";
import { summarizeBeltForms } from "../module/link";
import { AUTO_LAYOUT_LINK_LADDER } from "../debugFlags";
// 트리 관심사 — 좌표 없이 트리가 답하는 것(부모·자식 · 깊이마다 순서 · 모듈 하나의 계획 입력).
import { moduleInputOf, treeIndexOf, type TreeIndex } from "./tree/arith";
// link 관심사 — 두 모듈의 식별자를 아는 계산(간선마다 줄 · 끝 · 레인 짝 · 포트 짝짓기).
import { edgeLinksOf, type EdgeLinks } from "./link/policy";
import { pairDeliveries } from "./link/arith";
// channel 관심사 — 행 채널 장부.
import { rowChannelsOf } from "./channel/ledger";
// perimeter 관심사 — 전역 외곽으로 나갈 길의 입력 준비(프레임 확장·반출 대상 포트 수집).
import { planExits, expandBbox } from "./perimeter/exits";
import type { PerimeterExitPlan } from "./perimeterExitPlanner";
import { segment , PERIMETER_MARGIN } from "../util/helper";
import { moduleExtent, shiftModule, type Orientation } from "../module/moduleTransform";
import { AUTO_LAYOUT_COORD_DUMP } from "../debugFlags";
import { recordBeltFormStats, recordFaceDepthStats } from "../../debug/runStats";

// 조율자를 단일 창구로 유지하기 위한 재수출 — 소비처(테스트·deliveryRoute·moduleWizard·
// modulePerimeterPass)는 "배치 결과를 다루는 것"이라 `modulePacking` 에서 가져오는 편이
// 자연스럽다. 정의의 소유자는 각각 `link/edgeLinks` 와 `module/moduleTransform` 이다.
export { deliveryKey, edgeFlows, edgeLinkGroups } from "./link/edgeLinks";
export { moduleExtent } from "../module/moduleTransform";

/** 채널 폭 하한(셀). 단일 납품 경로(트랙 1)도 이 폭은 확보 — 옛 COLUMN_GAP 동치(좁아지지 않음). */
const MODULE_CHANNEL_MIN = 4;

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

export function packModuleTree(specs: NodeSpec[], config: PackConfig): PackResult {
  // ⓪ 트리 — 부모·자식 · 깊이마다 위→아래 순서. 좌표가 아니라 DFS 가 답한다
  const tree = treeIndexOf(specs);
  // ① 링크 — 간선마다 무엇을 몇 줄로 · 어느 끝으로. 끝이 여기서 서야 생성이 한 번이다
  const links = edgeLinksOf(tree, specs, config);
  // ② 좌석 — 링크가 양끝 모듈의 어느 면·깊이에. 쪼개졌으면 토막이 최종본이다
  const seated = seatTree(specs, tree, links, config);
  // ③ 모양 — 모듈마다 한 번 생성. 높이와 모듈-로컬 포트가 선다
  const oriented = generateModules(specs, seated);
  recordLinkForms(tree, links, config);
  // ④ 짝 — 누가 누구에게 · 행 채널을 지날 끝. 좌표 없음
  const pairing = pairDeliveries(specs, tree, oriented, links.productOf);
  // ⑤ 행 채널 — 깊이마다 신원 · 트랙 · 높이. 좌표 없음
  const rows = rowChannelsOf(tree.orderByDepth, pairing.rowChannelNeeds);
  // ── 여기까지 좌표가 없다. 아래부터 평면 ──
  const { childIdsByParent, orderByDepth, maxDepth } = tree;
  const { deliverySeeds, pairedChestIds, linkMismatches, rowChannelNeeds, deliveryPairs } = pairing;
  const { rowChannels } = rows;
  const rowChannelReach = rows.reach;
  /** 경로 끝 id(`…:out`/`…:in`) → 행 채널 접근. 5a-2 가 채우고 5c 가 지시에 싣는다. */
  const rowChannelEntryById = new Map<string, RowChannelEntry>();

  // ── 4) 세로 좌표 — **열마다 누적합. 간격은 전부 행 채널 높이다** ────────────────
  //
  //    `colX[d] = colX[d-1] + 열폭 + 채널폭` 의 **세로 판**이다. 열 하나가 순번 0부터
  //    누적합이고, 더하는 것은 **모듈 높이 + 그 아래 행 채널의 높이**뿐 — 상수가 없다.
  //    예전엔 `STACK_GAP = 3` 이 간격이었고 행 채널이 모자라면 경로가 탐색으로 떨어졌다.
  const heightOf = (id: string): number => moduleExtent(oriented.get(id)!.module).h;
  const heightBelow = new Map<string, number>();
  for (const b of rowChannels)
    if (b.kind === "between") heightBelow.set(`${b.depth}:${b.above}`, b.height);
  /** 순번 `i` 다음에 오는 행 채널의 높이 — 이것이 곧 다음 모듈까지의 간격이다. */
  const gapBelow = (depth: number, id: string): number =>
    heightBelow.get(`${depth}:${id}`) ?? ROW_CHANNEL_MIN;

  // 4a) **누적합** — 순번 → 행. 좌표는 이 식 하나에서 나온다.
  const topY = new Map<string, number>();
  const stack = (): void => {
    for (const [depth, ids] of orderByDepth) {
      let y = 0;
      for (const id of ids) {
        topY.set(id, y);
        y += heightOf(id) + gapBelow(depth, id);
      }
    }
  };
  stack();

  // 4b) **중앙 정렬 — 순번 공간에서**(2026-09-06 사장님 지시로 index 판으로 다시 세움).
  //
  //     부모를 자식들 곁에 두면 납품의 세로 구간이 짧아지고, 그만큼 세로 채널의 트랙이
  //     줄어 **채널이 좁아진다**. 그 이득은 버리지 않는다.
  //
  //     **옛 tidy-tree 와 무엇이 다른가** — 옛 판은 잎을 전역 커서에 상수(`STACK_GAP`)
  //     간격으로 쌓아 **좌표를 먼저 만들고** 부모를 그 좌표의 중점에 놓았다. 그래서 간격이
  //     행 채널과 무관했다. 지금은 자리를 4a 의 누적합이 만들고, 이 단계는 **부모를 옮기기만**
  //     한다 — 옮긴 뒤 4c 가 누적합 하한을 되살리므로 행 채널보다 좁아질 수 없다.
  //
  //     깊은 열부터 올라간다: 자식이 먼저 서야 부모가 맞출 수 있다.
  const depths = [...orderByDepth.keys()].sort((a, b) => b - a);
  for (const d of depths) {
    for (const id of orderByDepth.get(d) ?? []) {
      const kids = childIdsByParent.get(id) ?? [];
      if (kids.length === 0) continue;
      const lo = Math.min(...kids.map((k) => topY.get(k)!));
      const hi = Math.max(...kids.map((k) => topY.get(k)! + heightOf(k)));
      topY.set(id, Math.round((lo + hi) / 2 - heightOf(id) / 2));
    }
  }

  // 4c) **누적합 하한 복원** — 4b 가 부모를 옮겨 이웃과 가까워졌을 수 있다.
  //     순서는 3a 가 정했으므로 **좌표로 다시 정렬하지 않는다.** 위에서부터 아래로만 민다.
  for (const [depth, ids] of orderByDepth) {
    let prevBottom = -Infinity;
    let prevId: string | undefined;
    for (const id of ids) {
      let t = topY.get(id)!;
      if (prevId !== undefined) t = Math.max(t, prevBottom + gapBelow(depth, prevId));
      topY.set(id, t);
      prevBottom = t + heightOf(id);
      prevId = id;
    }
  }

  // 5) **행 채널 자리** — 이제야 좌표가 붙는다. `top`/`bottom` 은 행 채널의 **빈 칸 범위**다.
  //
  //    사이 행 채널는 두 모듈이 경계다(4b 가 높이만큼 벌려 놓았다). 마진은 바깥이 열려 있으므로
  //    자기 높이만큼 뻗는다 — 예전의 `fitRowChannel` 이 하던 일이 여기로 접혔다.
  for (const b of rowChannels) {
    if (b.kind === "between") {
      b.top = topY.get(b.above!)! + heightOf(b.above!);
      b.bottom = topY.get(b.below!)! - 1;
    } else if (b.kind === "marginN") {
      b.bottom = topY.get(b.below!)! - 1;
      b.top = b.bottom - (b.height - 1);
    } else {
      b.top = topY.get(b.above!)! + heightOf(b.above!);
      b.bottom = b.top + (b.height - 1);
    }
  }

  // 6) **절대 행** — 2단계가 미뤄 둔 것들을 여기서 푼다.
  const absPortY = (id: string, anchorY: number): number =>
    anchorY + topY.get(id)! - moduleExtent(oriented.get(id)!.module).y;
  for (const n of rowChannelNeeds) n.portY = absPortY(n.nodeId, n.anchorY);
  for (const seed of deliverySeeds) {
    seed.startY = absPortY(seed.fromId, seed.fromAnchorY);
    seed.endY = absPortY(seed.toId, seed.toAnchorY);
  }

  // 6b) **행 채널 진입 행** — 트랙 번호가 행이 된다(`top + t`). 자리가 선 지금에야 된다.
  {
    for (const b of rowChannels) {
      if (!b.tracks) continue;
      for (const [id, t] of b.tracks) rowChannelEntryById.set(id, { row: b.top + t });
    }
    // **배정이 끝난 지금** seed 에 실어 준다 — 위 짝짓기 루프는 배정을 아직 모른다.
    // 진입 행이 곧 세로 채널의 출발/도착 행이다(Step 0: 출처를 안 가린다).
    for (const seed of deliverySeeds) {
      const fb = rowChannelEntryById.get(`${seed.key}:out`);
      const tb = rowChannelEntryById.get(`${seed.key}:in`);
      if (fb) { seed.fromRowChannel = fb; seed.startY = fb.row; }
      if (tb) { seed.toRowChannel = tb; seed.endY = tb.row; }
      // **행 채널이 필요한데 못 받았으면 계획을 접는다.** 그 끝의 `startY` 는 여전히 포트 행이고,
      // 포트는 기둥 **밖**에 있어 계단꼴의 가로 진입이 모듈 몸통을 지난다. 그리면 반드시
      // 막히므로 **애초에 안 그린다** — 장부는 폭만 예약하고 라우터가 탐색으로 잇는다.
      const wantsRowChannel = (w: "out" | "in") => rowChannelNeeds.some((n) => n.id === `${seed.key}:${w}`);
      if ((!fb && wantsRowChannel("out")) || (!tb && wantsRowChannel("in"))) seed.eligible = false;
    }
  }

  // 5) 열 폭 + 채널 폭(수요 기반) → x 좌표. 채널 d(깊이 d↔d-1)를 가로지르는 납품 경로를 세로
  //    구간 [min(자식포트y, 부모포트y), max(...)] 으로 모아 left-edge 트랙 수 = 폭의 근거.
  //    포트 abs-y = 로컬 anchor.y + (topY - ext.y) (colX 무관 → 배치 전 계산 가능). 끝 정렬
  //    (piece 4)으로 구간이 짧아 트랙↓→폭↓. channelPlanner 코드 무수정(좌표-무지).
  const colWidth = new Array(maxDepth + 1).fill(0);
  for (const s of specs) colWidth[s.depth] = Math.max(colWidth[s.depth], moduleExtent(oriented.get(s.id)!.module).w);

  // 5b) 외부상자 반출 트랙 예약(조각 6-①) — 살아남은 raw 입력·루트 출력 상자를 인접 gap
  //     으로 빼는 트랙을 planner 에 맡긴다. 채널로 우회하는 트랙의 세로 구간은 위 납품 경로
  //     으로 빼는 출구를 planner 에 맡긴다. colX 전이라 X 없이 abs y+depth 만으로 판정
  //     가능. 항상 계산해 PackResult 에 싣고, 실제 폭/마진 반영은 reservePerimeterExits 게이트.
  //     환승 출구가 먹는 트랙은 5c 의 통합 장부가 배정하고, 그 결과에서 폭이 나온다.
  const exitPlan = planExits(
    specs, oriented, topY, pairedChestIds, maxDepth, absPortY, orderByDepth, rowChannelReach,
  );

  // 5c) 채널 기하 예약(통합 장부) — 납품·반출 경로를 한 장부에 모아 트랙을 배정한다
  //     (같은 쪽 판정 + 해소 사다리, docs/…channel-geometry-reservation.md). 폭 역전:
  //     아래 channelWidth 가 이 배정 결과(trackCount)에서 폭을 유도한다. 부적격 경로
  //     (스필 납품 경로)는 폭만 예약(reserveIntervals)하고 방출의 dijkstra 에 맡긴다.
  const geometryPlans = new Map<number, ChannelGeometryPlan>();
  let gyMin = Infinity, gyMax = -Infinity;
  for (const s of specs) {
    const top = topY.get(s.id)!;
    gyMin = Math.min(gyMin, top);
    gyMax = Math.max(gyMax, top + moduleExtent(oriented.get(s.id)!.module).h - 1);
  }
  for (let d = 1; d <= maxDepth; d++) {
    const dels: DeliveryInput[] = [];
    const reserve: Interval[] = [];
    for (const seed of deliverySeeds) {
      if (seed.depth !== d) continue;
      if (seed.eligible) dels.push({ id: seed.key, startY: seed.startY, endY: seed.endY, fluid: seed.fluid });
      else reserve.push({ lo: Math.min(seed.startY, seed.endY), hi: Math.max(seed.startY, seed.endY) });
    }
    const exps: ExportInput[] = [];
    if (config.reservePerimeterExits) {
      for (const a of exitPlan.assignments) {
        if (a.exitMode.kind !== "channel" || a.exitMode.depth !== d) continue;
        // **불변식** — 환승 후보는 `entry` 가 언제나 있고 진출 변이 언제나 N/S 다
        // (`channelOpts` 가 `[near, far]` 로 둘 다 N/S 를 낸다). 그 방향으로 못 나가는
        // 포트는 **환승 후보 자체가 안 만들어진다**(`wayOut` 이 W/E 일 때만 도니까).
        // 아래 가드는 그 불변식을 타입에 알려 주는 것뿐이다 — 참이 될 수 없다.
        if (!a.entry || (a.exitEdge !== "N" && a.exitEdge !== "S")) continue;
        exps.push({ id: a.id, entryY: a.entry.y, entryWall: a.entry.wall, preferredExit: a.exitEdge });
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

  /** **폭 역전** — 폭은 우리가 고르는 값이 아니라 기하 배정의 결과(사용 트랙 수)다. */
  const channelWidth = (d: number): number =>
    channelWidthFromTracks(geometryPlans.get(d)?.trackCount ?? 0, MODULE_CHANNEL_MIN);
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

  // 7) 납품 경로 = 위(5)에서 이미 짝지은 쌍을 절대좌표 포트로 재구성. raw = 짝 못 지은 포트 전부
  //    (입력이면 외부 공급 무한상자, 출력이면 무한 sink) — 둘 다 perimeter 로 나가야 한다.
  const deliveries: DeliverySpec[] = [];
  const rawPorts: ModulePort[] = [];
  const portByChestId = new Map<string, ModulePort>();
  for (const s of specs) {
    const mod = absById.get(s.id)!;
    for (const p of [...mod.inputPorts, ...mod.outputPorts]) portByChestId.set(p.chest.id, p);
  }
  /**
   * **레인 공유 — 납품은 물리 벨트마다 하나다.**
   *
   * 두 줄이 한 물리 벨트를 쓰면(`sharedLineId`) 양끝이 각각 **한 칸**이다 — 자식은 출구에서
   * 이미 합쳐졌고 부모도 한 벨트로 받는다. 그 사이를 잇는 물리 경로도 하나여야 한다.
   * 두 번째 줄까지 납품을 내면 **같은 두 칸 사이에 벨트를 두 번 깔려 든다.**
   */
  const deliveredLines = new Set<string>();
  for (const s of specs) {
    for (const [i, pr] of (deliveryPairs.get(s.id) ?? []).entries()) {
      const from = portByChestId.get(pr.outId);
      const to = portByChestId.get(pr.inId);
      if (!from || !to) continue;
      const shared = to.sharedLineId;
      if (shared !== undefined) {
        if (deliveredLines.has(shared)) continue;
        deliveredLines.add(shared);
      }
      deliveries.push({ item: pr.item, from, to, fromId: s.id, toId: s.parentId!, seq: i, linkId: pr.linkId });
    }
  }
  for (const s of specs) {
    const mod = absById.get(s.id)!;
    for (const p of [...mod.inputPorts, ...mod.outputPorts])
      if (!pairedChestIds.has(p.chest.id)) rawPorts.push(p);
  }

  const rawBbox = unionExtent(placements);

  // 7b) 기하 예약의 절대좌표 변환 — 트랙 index → 채널 내부 x, 반출 배정 확정(exitEdge
  //     뒤집힘 반영 + trackX 기록), 반출 예약 셀 산출. marginNeeds 를 갱신할 수 있으므로
  //     expandBbox 보다 먼저.
  const channelGeometry = materializeChannelGeometry({
    geometryPlans,
    deliverySeeds,
    exitPlan,
    placements,
    channelStartX: (d: number) => colX[d - 1] + colWidth[d - 1],
    rawBbox,
    reserveTracks: config.reservePerimeterExits === true,
  });

  const bbox = config.reservePerimeterExits ? expandBbox(rawBbox, exitPlan.marginNeeds) : rawBbox;
  return { placements, deliveries, rawPorts, bbox, exitPlan, channelGeometry, linkMismatches, rowChannels, rowChannelNeeds };
}

/**
 * 통합 장부의 추상 배정(트랙 index)을 절대좌표 지시로 변환한다.
 * - 납품: DeliveryGeometry(트랙 x·갈아타는 행·지하 횡단 좌표) — deliveryRoute 이 탐색 없이 방출.
 * - 반출: ExitAssignment 에 trackX·(뒤집혔으면) exitEdge 를 기록 — ⑥C 가 그대로 재생.
 * - 예약 셀: 모든 확정 반출 경로(환승 elbow + 직진 직선)의 절대 셀 —
 *   폴백 dijkstra 납품 경로의 침범을 막아 "먼저 깐 경로가 자리를 뺏는" 원래 구멍을 봉인한다.
 */
function materializeChannelGeometry(args: {
  geometryPlans: Map<number, ChannelGeometryPlan>;
  deliverySeeds: {
    depth: number; key: string; eligible: boolean; fluid?: string;
    /** 합류의 멈춤 행을 여기서 유도한다(`mergeTail`) — 계획이 쓴 것과 **같은 행**이라야 한다. */
    startY: number; endY: number;
    fromRowChannel?: RowChannelEntry; toRowChannel?: RowChannelEntry;
  }[];
  exitPlan: PerimeterExitPlan;
  placements: ModulePlacement[];
  channelStartX: (d: number) => number;
  rawBbox: { x: number; y: number; w: number; h: number };
  reserveTracks: boolean;
}): PackChannelGeometry {
  const { geometryPlans, deliverySeeds, exitPlan, placements, channelStartX, rawBbox, reserveTracks } = args;
  const deliveries = new Map<string, DeliveryDirective>();
  const skips: { key: string; reason: string }[] = [];
  for (const seed of deliverySeeds) {
    // 행 채널 접근은 도형과 무관하게 붙는다 — 세로 채널은 진입 행만 받고 출처를 안 묻는다.
    const rcEntries = { fromRowChannel: seed.fromRowChannel, toRowChannel: seed.toRowChannel };
    if (!seed.eligible) {
      // **계단꼴이 못 그리는 기하 → 되꺾기로 계획한다**(2026-08-17). 대개 부모 입력이 반대
      // 면으로 스필한 경우다. 여태 여기서 조용히 빠져 dijkstra 가 맡았고, 그 폴백이 남의
      // 예약을 밟아 연쇄했다. 모양은 **ㄱ자** — 자기 행을 따라 가로로 간 뒤 목표 열에서
      // 세로로 (근거는 `wrapAround` 자료형 주석: 상자의 자기 열은 늘 붐빈다).
      // 유체는 제외한다(유체는 언제나 적격이라 여기 오면 그게 사고다).
      if (seed.fluid !== undefined) {
        skips.push({ key: seed.key, reason: "not-eligible-fluid" });
        if (AUTO_LAYOUT_COORD_DUMP)
          console.log("[channelGeometry] 장부에서 제외 —", seed.key, "not-eligible(유체인데 전제 위반 — 사고)");
        continue;
      }
      deliveries.set(seed.key, { kind: "wrapAround", ...rcEntries });
      continue;
    }
    const plan = geometryPlans.get(seed.depth)?.deliveries.get(seed.key);
    if (!plan || plan.kind === "fallback") {
      // **장부가 왜 포기했는지는 여기서만 알 수 있다** — 아래로 안 내려보내면 소비처는
      // "계획이 없다"만 보고 이유를 영영 못 본다(2026-07-22 조사에서 계측을 새로 만들어야
      // 했던 자리). 포기한 납품 경로 하나가 탐색으로 내려가면 남의 계획까지 밟아 **연쇄**하므로
      // ([deliveryRoute] 의 "예약 무시 재시도"), 이 한 줄이 그 연쇄의 출발점을 가리킨다.
      skips.push({ key: seed.key, reason: plan ? plan.reason : "no-plan" });
      if (AUTO_LAYOUT_COORD_DUMP)
        console.log("[channelGeometry] 계획 포기 —", seed.key, plan ? plan.reason : "계획 자체가 없음");
      continue;
    }
    const tx = (t: number) => channelStartX(seed.depth) + 1 + t;
    if (plan.kind === "straight") deliveries.set(seed.key, { kind: "straight", ...rcEntries });
    else if (plan.kind === "staircase")
      deliveries.set(seed.key, { kind: "staircase", trackX: tx(plan.track), ...rcEntries });
    else if (plan.kind === "columnSwitch")
      deliveries.set(seed.key, {
        ...rcEntries,
        kind: "columnSwitch",
        startTrackX: tx(plan.startTrack),
        switchY: plan.switchY,
        endTrackX: tx(plan.endTrack),
      });
    else
      deliveries.set(seed.key, {
        ...rcEntries,
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
  if (reserveTracks) {
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
    for (const a of exitPlan.assignments) {
      const port = portByChest.get(a.id);
      if (!port) continue;
      const anchor = { x: port.anchor.x, y: port.anchor.y };
      if (a.exitMode.kind === "channel") {
        const plan = geometryPlans.get(a.exitMode.depth)?.exports.get(a.id);
        if (plan?.kind !== "elbow") continue; // fallback — 예약 없음(스캔·skip 유지)
        const trackX = channelStartX(a.exitMode.depth) + 1 + plan.track;
        a.exitEdge = plan.exitEdge; // 해소 사다리 ①에서 뒤집혔을 수 있다
        a.trackX = trackX;
        exitPlan.marginNeeds[plan.exitEdge] = true;
        const corner = { x: trackX, y: anchor.y };
        addSeg(anchor, corner);
        addSeg(corner, { x: trackX, y: seatRow(plan.exitEdge) });
      } else if (a.exitEdge === "N" || a.exitEdge === "S") {
        addSeg(anchor, { x: anchor.x, y: seatRow(a.exitEdge) });
      } else {
        addSeg(anchor, { x: seatCol(a.exitEdge), y: anchor.y });
      }
    }
  }

  return { deliveries, reservedExportCells, skips };
}

// ─────────────────────────────────────────────────────────────────────────────
// extent / 이동 / 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

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
/**
 * **P0b — 간선 단위 배정**.
 *
 * 모듈마다 무대(좌석표)를 차린 뒤, **간선마다** 그 간선의 그룹을 **양끝에 함께** 앉힌다.
 * 못이 있으면 **그 자리에서** 쪼개고 토막을 이어서 앉힌다 — 밖에서 `linkCache` 를 고치고
 * 트리를 **다시 만들던** 옛 사다리(되먹임 B)가 여기로 접혔다.
 *
 * 순서는 `specs`(트리 DFS pre-order)를 그대로 쓴다 — **순서를 고르는 것은 Step 6 의 일**이다.
 *
 * 트리 전체 배정. **`linkCache` 를 제자리에서 최종본으로 갈아 끼우고**(쪼개졌으면 토막),
 * 그에 맞춘 무대와 `ModuleInput` 을 돌려준다. **방출은 안 한다.**
 */
function seatTree(
  specs: readonly NodeSpec[],
  tree: TreeIndex,
  links: EdgeLinks,
  config: PackConfig,
): { stages: Map<string, LinkFaceStage>; inputs: Map<string, ModuleInput> } {
  const { linkCache } = links;
  /** 배정이 낸 쪼갬 수 — 진단용(옛 `laddered`). */
  let laddered = 0;
  const stages = new Map<string, LinkFaceStage>();
  for (const s of specs)
    stages.set(s.id, planLinkFaces(moduleInputOf(tree, config, links, s), Math.max(1, s.count), "open"));

  // 모듈마다 최종 링크 목록·계획을 모은다. `in` 은 자식 순서대로 이어 붙는다
  // (`inputLinksOf` 와 같은 순서라야 방출이 짝을 찾는다).
  const outOf = new Map<string, { links: Link[]; plans: (LinkFacePlan | undefined)[]; why: DepthShortage[][] }>();
  const inOf = new Map<string, { links: Link[]; plans: (LinkFacePlan | undefined)[]; why: DepthShortage[][] }>();
  for (const s of specs) {
    outOf.set(s.id, { links: [], plans: [], why: [] });
    inOf.set(s.id, { links: [], plans: [], why: [] });
  }

  for (const s of specs) {
    if (!s.parentId) continue;
    const groups = linkCache.get(s.id);
    if (!groups?.length) continue;
    const child = stages.get(s.id);
    const parent = stages.get(s.parentId);
    if (!child || !parent) continue;
    const r = seatLinkEdge(child, parent, groups, { split: AUTO_LAYOUT_LINK_LADDER });
    laddered += r.splits;
    linkCache.set(s.id, r.groups); // **최종본** — 쪼개졌으면 토막이 들어 있다
    const o = outOf.get(s.id)!;
    o.links.push(...r.groups); o.plans.push(...r.fromPlans); o.why.push(...r.fromWhy);
    const i = inOf.get(s.parentId)!;
    i.links.push(...r.groups); i.plans.push(...r.toPlans); i.why.push(...r.toWhy);
  }

  recordLinkNeed(specs, stages, outOf, inOf);

  // 무대의 링크 목록·배정을 최종본으로 갈아 끼운다 — `generateModule` 이 보는
  // `input.outputLinks` 와 **같은 배열**이어야 방출이 index 로 짝을 찾는다.
  const inputs = new Map<string, ModuleInput>();
  for (const s of specs) {
    const st = stages.get(s.id)!;
    const o = outOf.get(s.id)!;
    const i = inOf.get(s.id)!;
    st.outLinks = o.links;
    st.inLinks = i.links;
    st.out = { plans: o.plans, deferred: [], shortages: o.why };
    st.in = { plans: i.plans, deferred: [], shortages: i.why };
    inputs.set(s.id, {
      ...moduleInputOf(tree, config, links, s),
      outputLinks: o.links.length ? o.links : undefined,
      inputLinks: i.links.length ? i.links : undefined,
    });
  }
  // 쪼갬은 **0이 목표다** — 못이 안 생겼다는 뜻이고, 그게 순서 규칙(Step 6)의 과녁이다.
  if (laddered > 0) recordFaceDepthStats({ splits: laddered });
  return { stages, inputs };
}

/**
 * **링크가 앉으려면 무엇을 풀어야 했나** — 모듈마다 눈금 하나([linkDepthNeed]). **관측만 한다.**
 *
 * 여기서 세는 이유: `L_f`(그 면의 링크 **줄** 수 = 품목 종류 수)와 `R_f`(그 면의 깊이
 * 수)를 **둘 다 아는 유일한 자리**다. 판정 자체는 앉혀 본 결과를 안 보므로(입력만
 * 본다) 성공한 배치만 세는 편향이 없다 — `tempPlanDocs/부분-링크/` §4 Step 1.
 *
 * 면은 **선호**로 읽는다: 출력은 W, 입력은 E([allocateLinkFaces] 의 기본 면).
 * 링크는 반대 면으로 못 넘어가므로(`spillPair`) 그 선호가 곧 그 줄이 앉을 면이다.
 */
function recordLinkNeed(
  specs: readonly NodeSpec[],
  stages: ReadonlyMap<string, LinkFaceStage>,
  outOf: ReadonlyMap<string, { links: Link[] }>,
  inOf: ReadonlyMap<string, { links: Link[] }>,
): void {
  const needTally: Partial<Record<LinkDepthNeed, number>> = {};
  const needWho: string[] = [];
  for (const s of specs) {
    const st = stages.get(s.id)!;
    const items = (ls: readonly Link[]): number => new Set(ls.map((l) => l.item)).size;
    const L = (f: "W" | "E"): number =>
      items(f === "W" ? outOf.get(s.id)!.links : inOf.get(s.id)!.links);
    const R = (f: "W" | "E"): number => clusterBeltDepthsOf(st.ctx, f).length;
    const need = linkDepthNeed({ linesOf: L, depthsOf: R });
    needTally[need] = (needTally[need] ?? 0) + 1;
    // **넘친 것만 이름을 남긴다** — `L/R` 까지 실어야 *왜* 넘쳤는지가 한 줄에서 읽힌다.
    if (need !== "free")
      needWho.push(`${s.id} → ${need} (W ${L("W")}/${R("W")} · E ${L("E")}/${R("E")})`);
  }
  recordFaceDepthStats({
    linkNeed: needTally as Record<LinkDepthNeed, number>,
    linkNeedWho: needWho,
  });
}

/** 면=역할은 생성 단계에서 확정되므로 사후 회전 없이 항등 방위. */
const IDENTITY: Orientation = { rotation: 0, reflect: false };

/**
 * **③ 모양 — 모듈마다 한 번 생성.** 여기서 잰 높이가 곧 깔릴 높이다(세로 자리가 그 값을 쓴다).
 *
 * 끝 선호(`lineEnds`)가 ① 에서 확정되므로 다시 돌 이유가 없다.
 *
 * (옛 `1b) 사다리 1단` 은 **배정 안으로 접혔다** — `seatLinkEdge` 가 못을 만나면
 *  그 자리에서 쪼개고 토막을 이어 앉힌다. `linkCache` 를 밖에서 고치고 1차를 통째로
 *  다시 만들던 자리가 사라졌다 = **되먹임 B 제거**
 *
 * (옛 `3) 포트 끝(DOF-B)` 은 **P0 으로 옮겼다** — 형제 순번으로 정하므로 tidy-tree 가
 *  필요 없다. |Δy| 최소(거리)를 버리고 **교차 없음**을 노린다.
 *  그것이 `gen → 높이 → 끝 → gen` 고리를 여는 유일한 조건이었다 = **되먹임 A 제거**
 *
 * (옛 `4) 2차 생성` 은 **사라졌다** — 끝 선호가 `P0` 에서 확정되므로 1차가 곧 최종이다.
 *  `generateModule` 은 이제 트리마다 **한 번**만 돈다 = **되먹임 0**.
 *  그래서 *"1차가 센 형태는 버린다"* 던 계측 초기화도 필요 없다 — 잰 것이 곧 깔린 것이다.
 */
function generateModules(
  specs: readonly NodeSpec[],
  seated: { stages: ReadonlyMap<string, LinkFaceStage>; inputs: ReadonlyMap<string, ModuleInput> },
): Map<string, { module: GeneratedModule; orientation: Orientation }> {
  const stagesRef = seated.stages;
  const inputsRef = seated.inputs;
  const gen = (s: NodeSpec): GeneratedModule => {
    const base = inputsRef.get(s.id)!;
    // **사본을 준다** — ③′(기계별 포트)가 이 표에 이어서 앉으므로, 원본을 주면
    // 두 번째 `gen` 이 ①+③′ 이 앉은 표를 보고 시작한다([cloneLinkFaceStage]).
    const st = stagesRef.get(s.id);
    return generateModule({ ...base, linkFaceStage: st && cloneLinkFaceStage(st) });
  };
  const oriented = new Map<string, { module: GeneratedModule; orientation: Orientation }>();
  for (const s of specs) oriented.set(s.id, { module: gen(s), orientation: IDENTITY });
  return oriented;
}

/** 내부 링크(자식→부모)의 형태 — 외부 줄은 `planModulePorts` 가 자기 몫을 센다. **관측만 한다.** */
function recordLinkForms(tree: TreeIndex, links: EdgeLinks, config: PackConfig): void {
  const { byId } = tree;
  const { linkCache } = links;
  // 대수가 끝마다 다르다(자식 count ↔ 부모 count)라 그대로 넘긴다.
  recordBeltFormStats(
    summarizeBeltForms(
      [...linkCache].flatMap(([childId, groups]) => {
        const child = byId.get(childId);
        const parent = child?.parentId ? byId.get(child.parentId) : undefined;
        return groups.map((group) => ({
          group, fromCount: child?.count ?? 0, toCount: parent?.count ?? 0,
        }));
      }),
      // **분모는 레인이다** — 줄 하나가 쓸 수 있는 것은 벨트의 절반뿐이므로
      // (`docs/factorio/belt-lane-semantics.md` ①), 물리 처리량으로 재면 이용률이 **절반으로
      // 보이고** 과적재가 안 잡힌다(레인은 넘쳤는데 줄로는 안 넘친 줄이 그렇다).
      (name) => (name === undefined ? undefined : laneCapOfTier(config.belts?.find((b) => b.entityName === name))),
    ),
  );
}
