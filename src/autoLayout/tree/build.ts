/**
 * modulePacking — 모듈 트리를 좌우 계층형으로 패킹한다. **순서만 쥐는 뼈대다.**
 *
 * 각 노드를 [clusterModule.generateModule] 로 부모-무시 생성한다. 방위는 **생성 단계에서
 * 면=역할로 확정**(출력→W=부모, 입력→E=자식, (B) 정책 넘침은 잔여 면)되므로 사후 회전
 * 없이 항등 방위를 쓴다. 그다음 depth 열 × 세로 누적합(부모를 자식들 중앙에)으로
 * 배치하고, 부모↔자식 포트를 짝지어 납품 경로 스펙을 낸다.
 *
 * ## 사슬 — 단계마다 새로 아는 것
 *
 * ```
 * ⓪ 트리      부모·자식 · 깊이마다 위→아래 순서 · 최대 깊이          tree/arith.treeIndexOf
 * ① 링크      간선마다 산출물 · 끝 · 줄 · 레인 짝 · 다시 붓기          link/policy.edgeLinksOf
 * ② 좌석      링크가 양끝 모듈의 어느 면·깊이에 · 최종 토막            seatTree(여기)
 * ③ 모양      모듈마다 높이 · 모듈-로컬 포트                          generateModules(여기)
 * ④ 짝        누가 누구에게 · 행 채널을 지날 끝 · 납품 씨앗            link/arith.pairDeliveries
 * ⑤ 행 채널   깊이마다 신원 · 트랙 · 높이                             channel/ledger.rowChannelsOf
 * ── 여기까지 좌표가 없다 ──
 * ⑥ 세로 자리 topY · 행 채널 칸 범위 · 납품 끝의 절대 행               tree/shape · channel/shape
 * ⑦ 통로      반출 출구 · 깊이마다 채널 트랙(폭은 그 결과)             perimeter/exits.planExits · channel/ledger.planChannels
 * ⑧ 가로 자리 열 폭 + 채널 폭 → colX → 절대 배치                       tree/shape.placeColumns
 * ⑨ 결과      절대 포트로 납품·raw · 채널 기하의 절대화 · 틀            tree/shape · channel/shape.materializeChannelGeometry
 * ```
 *
 * **되먹임은 0 이다** — 끝 선호가 ① 에서, 좌석이 ② 에서 서므로 ③ 은 트리마다 한 번뿐이다.
 * 좌표 이전 단계(⓪–⑤)가 `topY` 보다 앞에 설 수 있다는 것이 이 구조의 전부다.
 *
 * ## 변(side) vs face
 * generateModule 은 포트 `face` 를 트렁크 *축* 방향으로 준다(예: N 깊이를 수평으로 달리는
 * 트렁크의 chest 는 face='W'일 수 있다). 좌우 트리에서 의미 있는 건 포트가 클러스터의
 * **어느 변**(W/E/N/S)에 붙었나이며, 그 단일 출처는 planner 슬롯(`meta.side`)이다 —
 * anchor↔bbox 기하 추측(X변 우선)은 N/S 깊이의 코너 어깨 chest 를 오분류해 폐기했다.
 * face 정의는 불변.
 *
 * > **내력.** 2026-09-14 까지 이 파일은 868줄 함수 하나였고 머리말 번호가 `P0 · P0b · 1) · 2) · 3a-c) ·
 * > 4a-c) · 5) · 6) · 6b) · 5) · 5b) · 5c) · 6) · 7) · 7b)` 로 되돌아갔다(계획 구조-2축 · 2 Step 3c).
 */

import type { NodeSpec, PackConfig, PackResult } from "./types/pack";
import { generateModule } from "../module/build";
import type { Link } from "../module/types/line";
import type { GeneratedModule, ModuleInput } from "../module/types/module";
import type { DepthShortage, LinkFacePlan, LinkFaceStage } from "../module/types/seat";
import { planLinkFaces } from "../module/policy/port";
import { seatLinkEdge } from "../module/policy/seat";
import { cloneLinkFaceStage } from "../module/ledger/seat";
import { clusterBeltDepthsOf } from "../module/arith/face";
import { linkDepthNeed, type LinkDepthNeed } from "../module/arith/depth";
import { summarizeBeltForms } from "../module/arith/link";
import { laneCapOfTier } from "../shared/arith/belt";
import { AUTO_LAYOUT_LINK_LADDER } from "../shared/flags";
import type { Orientation } from "../module/shape/transform";
import { recordBeltFormStats, recordFaceDepthStats } from "../../debug/runStats";
// 트리 관심사 — 좌표 없이 트리가 답하는 것 · 그 순서를 좌표로 옮기는 것.
import { moduleInputOf, treeIndexOf, type TreeIndex } from "./arith/pack";
import { absPortYOf, assembleDeliveries, placeColumns, spanYOf, stackColumns, unionExtent } from "./shape";
// link 관심사 — 두 모듈의 식별자를 아는 계산(간선마다 줄 · 끝 · 레인 짝 · 포트 짝짓기).
import { edgeLinksOf, type EdgeLinks } from "../planner/link/policy";
import { pairDeliveries } from "../planner/link/arith";
// channel 관심사 — 행 채널 · 세로 채널 장부와 그 절대화.
import { planChannels, rowChannelsOf } from "../planner/channel/ledger";
import { materializeChannelGeometry, placeRowChannels, settleDeliveryRows } from "../planner/channel/shape";
// perimeter 관심사 — 전역 외곽으로 나갈 길의 입력 준비(프레임 확장·반출 대상 포트 수집).
import { planExits, expandBbox } from "../planner/perimeter/exits";

// 조율자를 단일 창구로 유지하기 위한 재수출 — 소비처(테스트·deliveryRoute·moduleWizard·
// modulePerimeterPass)는 "배치 결과를 다루는 것"이라 `modulePacking` 에서 가져오는 편이
// 자연스럽다. 정의의 소유자는 각각 `link/edgeLinks` 와 `module/moduleTransform` 이다.
export { deliveryKey, edgeFlows, edgeLinkGroups } from "../planner/link/edgeLinks";
export { moduleExtent } from "../module/shape/transform";

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
  // ⑥ 세로 자리 — topY · 행 채널 칸 범위 · 납품 끝의 절대 행
  const topY = stackColumns(tree, oriented, rows.rowChannels);
  placeRowChannels(rows.rowChannels, topY, oriented);
  const absPortY = absPortYOf(topY, oriented);
  settleDeliveryRows(pairing, rows.rowChannels, absPortY);
  // ⑦ 통로 — 반출 출구 · 깊이마다 채널 트랙. 폭은 이 배정의 결과다
  // 외부상자 반출 트랙 예약(조각 6-①) — 살아남은 raw 입력·루트 출력 상자를 인접 gap
  //     으로 빼는 트랙을 planner 에 맡긴다. 채널로 우회하는 트랙의 세로 구간은 위 납품 경로
  //     으로 빼는 출구를 planner 에 맡긴다. colX 전이라 X 없이 abs y+depth 만으로 판정
  //     가능. 항상 계산해 PackResult 에 싣고, 실제 폭/마진 반영은 reservePerimeterExits 게이트.
  //     환승 출구가 먹는 트랙은 통로 장부(planChannels)가 배정하고, 그 결과에서 폭이 나온다.
  const exitPlan = planExits(
    specs, oriented, topY, pairing.pairedChestIds, tree.maxDepth, absPortY, tree.orderByDepth, rows.reach,
  );
  const channels = planChannels(pairing.deliverySeeds, exitPlan, spanYOf(specs, topY, oriented), tree.maxDepth, config);
  // ⑧ 가로 자리 — 열 폭 + 채널 폭 → colX → 절대 배치
  const columns = placeColumns(specs, oriented, topY, tree.maxDepth, channels.widthOf);
  // ⑨ 결과 — 절대 포트로 납품·raw. 채널 기하를 절대화한 **뒤에** 틀을 넓힌다
  const { deliveries, rawPorts } = assembleDeliveries(specs, columns.absById, pairing);
  const rawBbox = unionExtent(columns.placements);
  // 기하 예약의 절대좌표 변환 — 트랙 index → 채널 내부 x, 반출 배정 확정(exitEdge
  // 뒤집힘 반영 + trackX 기록), 반출 예약 셀 산출. marginNeeds 를 갱신할 수 있으므로
  // expandBbox 보다 먼저.
  const channelGeometry = materializeChannelGeometry({
    geometryPlans: channels.plans,
    deliverySeeds: pairing.deliverySeeds,
    exitPlan,
    placements: columns.placements,
    channelStartX: columns.channelStartX,
    rawBbox,
    reserveTracks: config.reservePerimeterExits === true,
  });
  const bbox = config.reservePerimeterExits ? expandBbox(rawBbox, exitPlan.marginNeeds) : rawBbox;
  return {
    placements: columns.placements, deliveries, rawPorts, bbox, exitPlan, channelGeometry,
    linkMismatches: pairing.linkMismatches, rowChannels: rows.rowChannels, rowChannelNeeds: pairing.rowChannelNeeds,
  };
}

/**
 * **② 좌석 — 간선 단위 배정**.
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
