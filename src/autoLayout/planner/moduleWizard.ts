/**
 * moduleWizard — **한 번의 실행을 순서대로 부른다.** 트리 하나를 받아 후보 하나(또는 왜 못 만들었는지)를 낸다.
 *
 * 이 파일은 **조율만** 한다 — 게임데이터를 안 읽고, issue 를 안 짓고, 셀을 안 놓는다. 그 일들은
 * 종류마다 [run/](./run/) 에 있다:
 *
 * ```
 * run/gamedata.ts   어댑터 — 트리 + 게임데이터 → NodeSpec · 유체 머신 · 사거리
 * run/policy.ts     정책   — 받을지 물릴지 · 무엇을 고쳐야 하나 (LayoutIssue 를 짓는 유일한 곳)
 * run/ledger.ts     장부   — 유체 관망 · 종착 구간
 * run/emit.ts       찍기   — CandidateLeaf(Area · Routing) · 실패 그림
 * ```
 *
 * [runModulePipeline] 의 단계 여덟은 **아는 것이 자라는 순서**다 — 단계마다 머리 주석이 *"이 단계가 새로
 * 무엇을 아나"* 를 적는다.
 *
 * ## 왜 이게 "자식 == 루트" 를 실현하나
 * generateModule 은 클러스터를 **부모-무시** 생성하므로, 같은 (레시피, count) 면 자식이든
 * 루트든 동일 모듈이다. **루트·자식 모두** 모듈(ROW_GAP 0 통일)이라 일치한다.
 *
 * > **내력.** 이 파일의 `runModulePipeline` 은 714줄이었고 네 종류(어댑터·정책·장부·찍기)를 한 함수에 겸했다
 * > (work-kinds §7 **D7**). 2026-09-14 종류대로 `run/` 으로 갈랐다(계획 구조-2축 · 2 Step 2b). 머리말이 적던
 * > *"실패하면 null → 옛 경로로 폴백"* 은 옛 경로가 2026-07-25 에 지워진 뒤로 거짓이었다 — 실패는 사유다.
 */

import type { GameDataLookup } from "../../types/gameData";
import type { CandidateLeaf, ContainerWizardInput, UndergroundCorridor } from "../containerModel";
import type { RecipeTreeNode } from "../types";
import type { PipeFlow } from "../util/pipeFlow";
import { packModuleTree, type PackConfig, type PackResult } from "./modulePacking";
import { routeDeliveryRoutes, type DeliveryConfig, type DeliveryResult } from "./deliveryRoute";
import { describeIssue, type LayoutIssue, type LayoutSnapshot } from "../layoutIssue";
import { rePathToPerimeter } from "../execution/modulePerimeterPass";
// 진단 카운터 싱크 — **관측만 한다**(계산·분기·반환값 무영향). import 가 0 인 파일이라
// 계층을 거스르지 않는다. 왜 반환값에 실어 올리지 않는지는 그 파일 서두에.
import {
  beginRunStats, recordChannelLedgerStats, recordDeliveryStats, recordExitPlanStats,
  recordPerimeterStats, recordRowChannelStats,
} from "../../debug/runStats";
import { AUTO_LAYOUT_COORD_DUMP, AUTO_LAYOUT_PERIMETER_PASS } from "../debugFlags";
// 예약 경로는 **탐색기를 안 본다** — 옛 경로의 `routeFallback`(Dijkstra 폴백) 대신
// [BuildSpec](../buildSpec.ts)("무엇으로 지을 수 있나")만 읽는다.
import { makeBuildSpec, type BuildSpec } from "../buildSpec";
import {
  fluidMachinesOf, logArmBeltLimits, nodeSpecsOf, resolveNodes, undergroundDistanceOf,
  type ModuleNodeMeta,
} from "./run/gamedata";
import {
  admitBuildSpec, admitFluidTrunks, deliveryWarnings, judgeDeliveries, judgePack, judgePipeMerges,
  terminusMergeWarnings,
} from "./run/policy";
import { fluidBlockedOf, fluidNetworksOf, terminusCorridorsOf } from "./run/ledger";
import { candidateOf, snapshotOf } from "./run/emit";

export interface ModulePipelineArgs {
  input: ContainerWizardInput;
  /** 입구([runLayeredWizard])가 한 번 읽은 게임데이터 — 이 실행은 이것만 본다. */
  gameData: GameDataLookup;
  metas: Map<RecipeTreeNode, ModuleNodeMeta>;
  parentOf: Map<RecipeTreeNode, RecipeTreeNode | null>;
  /** DFS pre-order(루트 먼저). */
  order: RecipeTreeNode[];
  /** layeredWizard 의 결정적 id 생성기(nextId). */
  makeId: (prefix: string) => string;
}

/**
 * 모듈 경로의 결과 — 성공한 후보이거나, **왜 못 만들었는지**다.
 *
 * 옛 경로가 있던 시절엔 실패가 `null` 이어도 됐다 — 호출자가 옛 경로로 폴백했고 화면엔
 * 무언가 나왔으니까. 옛 경로가 사라진 지금은 **이 사유가 사용자가 받는 설명의 전부**다.
 *
 * 사유는 예전엔 `RejectReason`(`[kind] detail` 한 줄)이었다. 사람은 읽을 수 있어도
 * 화면이 그걸로 할 수 있는 게 없어서 — **어디가** 막혔는지, 사용자가 **무엇을 고쳐야**
 * 하는지가 문장 안에 녹아 있었다 — [LayoutIssue] 로 흡수했다(2026-08-04).
 *
 * 실패해도 **부분 배치는 내지 않는다.** `snapshot` 은 그림일 뿐 `CandidateLeaf` 가 아니라
 * 배치 경로로 흘러갈 수 없다.
 */
export type ModulePipelineResult =
  | { ok: true; leaf: CandidateLeaf; warnings: LayoutIssue[] }
  | { ok: false; issues: LayoutIssue[]; snapshot?: LayoutSnapshot };

/**
 * 모듈 경로로 후보 leaf 를 만든다. 못 만들면 **사유**([LayoutIssue])와, 있으면 그림을 낸다.
 *
 * **진단 로그를 후보에 담는다.** 위저드가 계산 중 찍는 로그(`[팔·벨트 상한]`·
 * `[perimeterPass]`·`[channelGeometry]`·`모듈 경로 포기` …)를 콘솔에 바로 뱉지 않고
 * 캡처해 [CandidateLeaf.moduleDiagnostics] 에 담는다 — 후보를 **클릭할 때** 환경 정보와
 * 함께 한 시점에 출력하기 위해서다(그전엔 6번 버튼과 후보 클릭 두 시점으로 흩어졌다).
 * 후보가 안 나오면 담을 데가 없으니 캡처한 로그를 그 자리에서 뱉는다.
 * `AUTO_LAYOUT_COORD_DUMP` 가 꺼져 있으면 캡처하지 않는다(오버헤드 0).
 */
export function tryRunModulePipeline(args: ModulePipelineArgs): ModulePipelineResult {
  if (!AUTO_LAYOUT_COORD_DUMP) return runModulePipeline(args);

  const captured: string[] = [];
  const fmt = (a: unknown): string => (typeof a === "string" ? a : JSON.stringify(a));
  const orig = { log: console.log, warn: console.warn, info: console.info };
  const cap = (tag: string) => (...a: unknown[]): void => { captured.push(tag + a.map(fmt).join(" ")); };
  console.log = cap(""); console.warn = cap("[warn] "); console.info = cap("[info] ");
  let res: ModulePipelineResult;
  try {
    res = runModulePipeline(args);
  } finally {
    console.log = orig.log; console.warn = orig.warn; console.info = orig.info;
  }
  if (res.ok) res.leaf.moduleDiagnostics = captured;
  else captured.forEach((l) => orig.info(l)); // 후보 없음 → 클릭도 없으니 지금 뱉는다
  return res;
}

function runModulePipeline(args: ModulePipelineArgs): ModulePipelineResult {
  beginRunStats(); // 실행 1회 = 진단 카운터 1벌 (`flg.report()` 가 읽는다)
  const { input, gameData, metas, parentOf, order, makeId } = args;

  /**
   * 이 실행에서 모은 문제 전부 — **왜** 안 됐는지 반드시 남긴다. 옛 경로가 사라진 지금은
   * **이것이 사용자가 받는 설명의 전부**다.
   *
   * **첫 개에서 멈추지 않는다** — 노드 3개가 막혀 있으면 예전엔 세 번 고치고 세 번 다시
   * 돌려야 전체를 알 수 있었다(2026-08-04 A-2 해소).
   *
   * **뼈대만 이 배열을 쥔다.** 판정([run/policy](./run/policy.ts))은 자기 몫을 돌려주고, 여기서 정해진 자리에
   * push 한다 — 관문(`issues.length > 0`)이 경고도 실패로 세므로, **자리가 곧 계약**이다.
   */
  const issues: LayoutIssue[] = [];

  /** 여기서 끝난다 — 모은 것 전부와, 있으면 그림을 함께 낸다. */
  const abort = (snapshot?: LayoutSnapshot): ModulePipelineResult => {
    for (const i of issues) console.info(`[autoLayout] 모듈 경로 포기 ${describeIssue(i)}`);
    return { ok: false, issues, snapshot };
  };

  // ── ① 입구 — 설정이 **서 있나**(저울 있는 벨트·인서터) ─────────────────────────
  const options = makeBuildSpec(input, gameData);
  issues.push(...admitBuildSpec(options));
  if (issues.length > 0) return abort();

  // ── ② 유체 — 노드마다 유체를 **어느 회전·면**에, 못 앉히면 왜 ──────────────────
  //    관문이 **없다** — 거절당한 노드가 있어도 명세·배치까지 가서 ④ 의 판정과 함께 물러난다
  //    (그래서 그 실패의 그림에 배치가 들어 있다).
  const nodes = resolveNodes(order, metas, gameData);
  const fluid = admitFluidTrunks(nodes, options);
  issues.push(...fluid.issues);

  // ── ③ 명세 — 모듈마다 **무엇을 몇 대·얼마나** 나르나 ────────────────────────────
  const { specs, recipeOfId } = nodeSpecsOf(nodes, parentOf, fluid.trunkOf, options);
  const packConfig = packConfigOf(options);
  if (AUTO_LAYOUT_COORD_DUMP) logArmBeltLimits(specs, packConfig, options, input, gameData);

  // ── ④ 배치 — 모듈이 **어디 앉았고** 무엇이 못 앉았나 ─────────────────────────────
  const pack = packModuleTree(specs, packConfig);
  issues.push(...judgePack(pack));
  if (issues.length > 0) return abort(snapshotOf(pack, issues));

  // ── ⑤ 납품 준비 — 납품이 **피할 칸**(다른 유체 관망)과 **이미 잡힌 구간**(종착 사거리) ──
  const pipeFlowByFluid = fluidNetworksOf(pack, order, fluid.fluidsOf, fluidMachinesOf(pack, recipeOfId, gameData));
  issues.push(...judgePipeMerges(pack, pipeFlowByFluid));
  if (issues.length > 0) return abort(snapshotOf(pack, issues));
  //    **경고는 마지막 오류 관문 뒤에서만 쌓는다** — 위 관문들은 경고도 실패로 보고 배치를 통째로 물린다.
  issues.push(...terminusMergeWarnings(pack));
  const terminusCorridors = terminusCorridorsOf(pack, undergroundDistanceOf(gameData));

  // ── ⑥ 납품 — 경로가 **섰나** ──────────────────────────────────────────────────────
  const deliveryRes = routeDeliveryRoutes(pack, deliveryConfigOf(options, pipeFlowByFluid, terminusCorridors));
  recordPlanStats(pack, deliveryRes);
  issues.push(...judgeDeliveries(deliveryRes));
  if (deliveryRes.failures > 0) return abort(snapshotOf(pack, issues, deliveryRes));

  // ── ⑦ 반출 — 살아남은 상자가 **외곽 어디로** 가나 · 무엇이 계약을 어겼나 ─────────────
  //    합성 후 살아남은 raw 입력·루트 출력 상자는 각자 *로컬* 모듈 ring(=배치 내부)에 박혀 있다.
  //    exitPlan 배정대로 예약된 트랙 안에 결정적 belt(직선 or ㄱ자)를 깔아 전역 외곽으로 옮긴다(탐색 없음).
  //    트랙이 막힌 상자만 로컬 ring 에 남는다. rePathToPerimeter 는 **순수**하다(pack 미변형) — 무엇을
  //    떼고 무엇을 놓고 상자가 어디로 가는지를 **설명으로** 돌려주고, 적용은 ⑧ 이 Area 를 지을 때 한다.
  const perim = AUTO_LAYOUT_PERIMETER_PASS
    ? rePathToPerimeter(pack, deliveryRes.strippedChestIds, deliveryRes.cells, {
        beltEntityName: options.beltEntityName,
        inserterEntityName: options.inserterEntityName,
        pipeEntityName: options.pipeEntityName, // 유체 포트는 파이프로 반출한다.
        pipeFlow: pipeFlowByFluid, // [파이프 합류 가드] — 반출 파이프가 밟으면 안 되는 칸.
      })
    : null;
  if (perim) recordPerimeterStats(perim);
  issues.push(...deliveryWarnings(deliveryRes, perim));

  // ── ⑧ 후보 — 화면에 올릴 **Area · Routing** ──────────────────────────────────────
  return {
    ok: true,
    leaf: candidateOf({ pack, deliveryRes, perim, terminusCorridors, recipeOfId, nodeCount: order.length, makeId }),
    // 성공한 배치에도 경고가 붙을 수 있다 — 반출 skip · 탐색 폴백 · 합류한 끝 칸.
    warnings: issues,
  };
}

/** BuildSpec → 패킹 설정. 고르는 것은 없다 — 옮겨 담을 뿐이다. */
function packConfigOf(options: BuildSpec): PackConfig {
  return {
    inserterEntityName: options.inserterEntityName,
    beltEntityName: options.beltEntityName,
    // 고른 벨트 전부 — determineBeltCount 가 수요를 이 티어들로 나눠 덮는다.
    belts: options.belts,
    // 고른 지하벨트 전부 — 모듈이 벨트 종착([resolveBeltTermini])에 가장 느린 것을 쓴다.
    undergroundBelts: options.undergroundBelts,
    inserters: options.inserters,
    // 외부상자 perimeter 반출 트랙 예약(조각 6-①) — 채널 폭에 트랙 세로 구간 합산.
    reservePerimeterExits: AUTO_LAYOUT_PERIMETER_PASS,
    // 채널 기하 예약(통합 장부) — 납품·반출 트랙을 패킹 시점에 배정, 폭은 결과에서 유도.
    // 장부가 납품끼리의 교차를 지하로 계획할 때 쓰는 거리 상한. **아래 routeDeliveryRoutes 의
    // maxJump 산식과 같아야 한다** — 지하벨트 prototype 이 없으면 방출기는 어차피 지상
    // 전용이므로, 장부도 0(지하 불가)으로 봐야 계획과 방출이 어긋나지 않는다.
    beltMaxUndergroundDistance: options.undergroundBeltEntityName
      ? options.beltMaxUndergroundDistance
      : 0,
  };
}

/** BuildSpec + ⑤ 의 두 사실 → 납품 설정. 고르는 것은 없다. */
function deliveryConfigOf(
  options: BuildSpec,
  pipeFlowByFluid: ReadonlyMap<string, PipeFlow>,
  terminusCorridors: UndergroundCorridor[],
): DeliveryConfig {
  return {
    beltEntityName: options.beltEntityName,
    beltMaxUndergroundDistance: options.beltMaxUndergroundDistance,
    undergroundBeltEntityName: options.undergroundBeltEntityName,
    pipeEntityName: options.pipeEntityName,
    pipeMaxUndergroundDistance: options.pipeMaxUndergroundDistance,
    undergroundPipeEntityName: options.undergroundPipeEntityName,
    fluidBlocked: fluidBlockedOf(pipeFlowByFluid),
    seedCorridors: terminusCorridors,
  };
}

/**
 * **계획이 어디까지 갔나** — 관측 전용 표식(`flg.report()` 가 읽는다). 계산·분기·반환값을 안 바꾼다.
 *
 * **행 채널** — 높이가 곧 모듈 사이 간격이다(2026-09-06). `높이` 와 `트랙` 이 함께
 * 나오므로 **폭 역전이 실제로 돌았는지**를 한 줄로 읽을 수 있다: 트랙 n 이면 높이는
 * `max(3, n+2)` 라야 한다. 예전엔 높이가 `STACK_GAP` 고정이라 둘이 갈릴 수 있었고,
 * 그 갈림을 `수요` 로 따로 적어야 했다.
 * **반출 배정** — 나갈 길을 **못 준** 자리. 방출의 `skipped` 보다 한 단계 앞이라,
 * 트리가 납품에서 거절돼도 남는다(그게 진단이다 — 어디까지 갔는지).
 *
 * **다툰 칸** — 같은 열쇠가 두 번 이상 나오면 그 자리를 셋 이상이 다툰 것이다
 * (`셀장부/judgements.md` J-충돌차수 의 트리거. 읽는 법은 `ExitDemotion` 주석).
 */
function recordPlanStats(pack: PackResult, deliveryRes: DeliveryResult): void {
  const cellHits = new Map<string, number>();
  for (const d of pack.exitPlan.demotions) cellHits.set(d.cell, (cellHits.get(d.cell) ?? 0) + 1);
  recordExitPlanStats({
    blocked: pack.exitPlan.blocked,
    demotions: pack.exitPlan.demotions.length,
    contestedCells: [...cellHits.values()].filter((n) => n >= 2).length,
    noSideWayOut: pack.exitPlan.noSideWayOut,
  });
  // **계획 단계의 포기** — 방출의 `dijkstraFallback` 보다 한 단계 앞이다(둘은 다른 수다).
  recordChannelLedgerStats({ skips: pack.channelGeometry.skips });
  recordRowChannelStats({
    count: pack.rowChannels.length,
    channels: pack.rowChannels.map(
      (b) => {
        const have = b.bottom - b.top + 1;
        const who = b.kind === "between" ? `${b.above} | ${b.below}` : `${b.kind} ${b.above ?? b.below}`;
        const t = b.tracks?.size ?? 0;
        return (
          `d${b.depth} ${b.kind} y${b.top}..${b.bottom} 높이 ${have}`
          + (t > 0 ? ` · 트랙 ${t}건` : "")
          + `  (${who})`
        );
      },
    ),
    needs: pack.rowChannelNeeds.map((n) => `${n.id} @d${n.depth} ${n.nodeId} y${n.portY} ${n.face}`),
  });
  // (옛 `row-channel-short` 경고는 **사유가 사라져** 지웠다 — 2026-09-06. 행 채널 높이가 배정
  //  **결과**라 트랙보다 좁을 수가 없다. 예전엔 높이가 `STACK_GAP` 고정이라 넘칠 수 있었다.)
  recordDeliveryStats({
    planned: deliveryRes.planned,
    dijkstraFallback: deliveryRes.dijkstraFallback,
    reservationOverrun: deliveryRes.reservationOverrun,
    failures: deliveryRes.failures,
    routes: deliveryRes.routes.length,
  });
}
