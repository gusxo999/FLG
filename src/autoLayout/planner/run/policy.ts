/**
 * **실행의 정책** — 설정·유체·배치·납품·반출이 낸 **사실**을 보고, 받을지 물릴지와 **무엇을 고쳐야 하나**를 정한다.
 *
 * 이 파일이 [LayoutIssue] 를 짓는 유일한 곳이다. 뼈대([runModulePipeline])는 여기서 받은 배열을
 * **정해진 자리에서 push 하고 관문을 세울 뿐**, issue 를 짓지 않는다.
 *
 * **판정 함수는 누적 배열을 받지 않는다** — 읽지도 쓰지도 않고 자기 몫만 돌려준다. 받는 순간 *"경고는 마지막
 * 오류 관문 뒤에"* 라는 순서 계약이 뼈대 밖으로 샌다(→ [terminusMergeWarnings]).
 *
 * > **내력.** 전부 `planner/moduleWizard.ts` 의 `runModulePipeline` 714줄 안에 있었다. 한 함수가 게임데이터를
 * > 읽고(어댑터) 트리를 거절하고(정책) 유체 관망을 쌓고(장부) 셀을 놓았다(찍기) — work-kinds §7 **D7**.
 * > 2026-09-14 종류대로 갈랐다(계획 구조-2축 · 2 Step 2b). 본문은 옮기기만 했다.
 */

import type { NodeSpec, PackResult } from "../modulePacking";
import type { DeliveryResult } from "../deliveryRoute";
import type { PerimeterPassResult } from "../../execution/modulePerimeterPass";
import type { BuildSpec } from "../../buildSpec";
import type { RecipeTreeNode } from "../../types";
import { summarizeRungs } from "../module/linkPlanner";
import { chooseFluidTrunkPlan, fluidJumpBlocker } from "../../module/fluidPorts";
import { pipeFlowConflict, type PipeFlow } from "../../util/pipeFlow";
import type { IssueScope, LayoutIssue } from "../../layoutIssue";
import type { ResolvedNode } from "./gamedata";

/**
 * issue 하나 조립 — 카탈로그(개요 §5)의 한 줄에 대응한다.
 *
 * `recoverable` 기본값이 `false` 인 이유: 여기 오는 것은 **이미 물러설 데가 없어서**
 * 실패로 올라온 것들이다. 폴백을 거쳐 온 자리에서만 명시적으로 `true` 를 준다.
 */
export function fail(
  code: string,
  scope: IssueScope,
  detail: string,
  extra: Partial<Omit<LayoutIssue, "code" | "scope" | "detail">> = {},
): LayoutIssue {
  return { code, scope, severity: "error", recoverable: false, detail, ...extra };
}

/** 게임데이터가 낡았다 — 처방이 하나뿐이라(다시 import) 따로 둔다. */
export function gameDataIssue(detail: string, recipeName?: string): LayoutIssue {
  return fail("stale-gamedata", "게임데이터", detail, { target: { recipeName } });
}

/**
 * **설정이 서 있나 — 저울이 없으면 여기서 끝난다**(2026-08-24 사장님 확정).
 *
 * 벨트와 인서터는 **처리량과 함께** 와야 한다. 하나도 없으면 `determineBeltCount` 는 줄
 * 수를, `armsFor` 는 팔 수를 못 정한다. 예전엔 그 상태가 아래층까지 내려가 [makeLink] 의
 * 폴백이 **팔 1개짜리 가짜 줄**을 조립해 덮었다 — 배치는 "성공"이라 나오고 게임에 넣어야
 * 굶는 걸 안다. 그 폴백을 지울 수 있게 된 것은 거절을 **여기 한 층 위로** 올렸기 때문이다.
 *
 * 이름만 있고 저울이 없는 상태는 이제 만들어지지 않는다 — [makeBuildSpec] 이 이름을
 * **처리량이 확인된 목록에서만** 고른다.
 */
export function admitBuildSpec(options: BuildSpec): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  if (options.belts.length === 0) {
    issues.push(fail("no-belt", "게임데이터", "벨트를 하나도 안 골랐다 — 처리량을 모르면 줄 수를 못 정한다", { fixStep: "belt" }));
  }
  if (options.inserters.length === 0) {
    issues.push(fail("no-inserter", "게임데이터", "reach 1 이상 인서터를 하나도 안 골랐다 — 팔 처리량을 모른다", { fixStep: "inserter" }));
  }
  return issues;
}

/** [admitFluidTrunks] 의 산출 — 받은 노드의 트렁크 파이프 계획과 유체 이름, 못 받은 노드의 사유. */
export interface FluidAdmission {
  trunkOf: Map<RecipeTreeNode, NodeSpec["fluidTrunk"]>;
  /** 노드 → 그 모듈이 다루는 유체 이름들. 단계 A 는 면당 1줄이라 최대 2개(입력 E + 출력 W). */
  fluidsOf: Map<RecipeTreeNode, string[]>;
  issues: LayoutIssue[];
}

/**
 * **노드마다 유체를 어느 회전·면에 앉히나** — [트렁크 파이프](../../../../docs/auto-layout/module/trunk-pipe.md).
 *
 * 아이템 전용 노드는 그냥 지나간다. 유체를 못 앉히는 노드는 **거절하고 처방(`fixStep`)을 붙인다** — 사유가
 * 다 다르므로 각각 남긴다. 거절해도 **여기서 멈추지 않는다**: 뼈대는 이 뒤에 관문을 두지 않고, 명세·배치까지 간 뒤
 * 배치 판정과 **함께** 물러난다(그래서 그 실패의 그림에 배치가 들어 있다).
 */
export function admitFluidTrunks(nodes: readonly ResolvedNode[], options: BuildSpec): FluidAdmission {
  const trunkOf = new Map<RecipeTreeNode, NodeSpec["fluidTrunk"]>();
  const fluidsOf = new Map<RecipeTreeNode, string[]>();
  const issues: LayoutIssue[] = [];
  for (const { node, meta: m, recipe, entity, fluidLines, itemLineCount } of nodes) {
    const at = `${node.recipeName}`;
    if (!recipe) { issues.push(gameDataIssue(`레시피 없음: ${node.recipeName}`, at)); continue; }

    // 유체 줄 전부를 **한 회전 안에** 앉힌다([chooseFluidTrunkPlan]). 면은 역할이 정하고
    // (출력 W = 부모 쪽 · 입력 E = 자식 쪽), 회전은 머신 속성이라 모듈당 하나다.
    // 면당 줄 수에 상한을 두지 않는다 — 한 면에 여러 줄이 서는 기하는 유체 하나당 폭 2칸
    // (탭 1 + 관 1)으로 성립하고, 실제 상한은 **지하파이프 사거리**가 정한다(아래 게이트).
    if (fluidLines.length === 0) continue; // 아이템 전용 — 회전 없음.

    // 회전은 footprint 를 안 바꾼다는 전제 위에 있다 → 정사각형 머신만(§3).
    if (m.w !== m.h) {
      issues.push(fail('non-square', '모듈', `${at}: ${m.entityName} ${m.w}×${m.h} — 정사각형이 아니라 유체 회전 불가`,
        { carrier: 'fluid', fixStep: 'machine', target: { recipeName: at } }));
      continue;
    }
    if (!options.pipeEntityName) {
      issues.push(fail('no-pipe-entity', '입력', '빌드 스펙에서 파이프를 선택하지 않음',
        { carrier: 'fluid', fixStep: 'pipe', target: { recipeName: at } }));
      continue;
    }

    if (!entity) { issues.push(gameDataIssue(`엔티티 게임데이터 없음: ${m.entityName}`, at)); continue; }
    const plan = chooseFluidTrunkPlan(entity, { w: m.w, h: m.h }, fluidLines);
    if (!plan.ok) {
      // 사유를 그대로 흘린다 — 둘은 처방이 다르다. `no-rotation`(머신이 안 맞는다) ·
      // `stale-gamedata`(게임데이터를 다시 뽑아야 한다).
      if (plan.reason === 'stale-gamedata') {
        issues.push(gameDataIssue(`${m.entityName}: ${plan.detail}`, at));
      } else {
        issues.push(fail('no-rotation', '모듈', `${at} ${m.entityName}: ${plan.detail}`,
          { carrier: 'fluid', fixStep: 'machine', target: { recipeName: at } }));
      }
      continue;
    }

    // **한 면에 유체가 2줄 이상이면 점프가 필수다** — 옛 스파인(d1)은 기둥 전체를 먹어
    // 둘째 줄의 유체 상자 칸을 막는다. 물러설 곳이 없으니 여기서 정직하게 거절한다.
    // 판정은 [fluidJumpBlocker] 하나가 갖는다 — 계획([planModulePorts])이 같은 함수를 본다.
    // 삼키면 스파인 둘이 같은 d1 을 다투다 한 줄이 끊겨(`unrouted-lines`) **원인에서 멀리
    // 떨어진 곳**에 증상만 남는다.
    const jumpBudget = {
      undergroundPipeEntityName: options.undergroundPipeEntityName,
      pipeMaxUndergroundDistance: options.pipeMaxUndergroundDistance,
      seatRows: m.h,
      // **면당 깊이 = 서로 다른 reach 값 개수**([depthSlots]). 예전엔 `longInserter ? 2 : 1` 로
      // 세어 reach 3종을 골라도 2에서 잘렸다 — 배분기의 주장과 배선이 어긋나던 자리다(`docs/용어사전.md §BuildSpec`).
      beltDepths: Math.min(
        Math.max(1, new Set(options.inserters.map((i) => i.reach)).size),
        itemLineCount,
      ),
      maxInserterReach: options.inserters.reduce((m2, i) => Math.max(m2, i.reach), 1),
    };
    let crowded: LayoutIssue | undefined;
    for (const side of ['W', 'E'] as const) {
      const n = plan.lines.filter((l) => l.side === side).length;
      if (n < 2) continue;
      const blocked = fluidJumpBlocker(n, jumpBudget);
      if (!blocked) continue;
      // 처방이 갈린다: 파이프 단계로 돌아가라(지하파이프) vs 더 큰 머신을 골라라(좌석).
      crowded = blocked.kind === 'seats-exhausted'
        ? fail('fluid-face-seats-exhausted', '모듈', `${at} ${m.entityName} ${side} 면: ${blocked.detail}`,
            { carrier: 'fluid', fixStep: 'machine', target: { recipeName: at } })
        : fail('fluid-underground-too-short', '입력', `${at} ${m.entityName} ${side} 면: ${blocked.detail}`,
            { carrier: 'fluid', fixStep: 'pipe', target: { recipeName: at } });
      break;
    }
    if (crowded) { issues.push(crowded); continue; }

    trunkOf.set(node, {
      direction: plan.direction,
      pipeEntityName: options.pipeEntityName,
      // [pipeJumpToClusterPipe] 재료 — 지하파이프 능력(BuildSpec). 줄마다의 유체 상자 행은
      // `lines` 안에 있다. generateModule 이 이 둘로 면별 점프 가능 여부를 판정한다.
      undergroundPipeEntityName: options.undergroundPipeEntityName,
      pipeMaxUndergroundDistance: options.pipeMaxUndergroundDistance,
      lines: plan.lines,
      // 이 레시피가 안 쓰는 유체 상자 칸 — 그 면은 스파인이 통째로 지나면 안 된다(점프 필수).
      unusedFluidboxRows: plan.unusedFluidboxRows,
    });
    fluidsOf.set(node, plan.lines.map((l) => l.name));
  }
  return { trunkOf, fluidsOf, issues };
}

/**
 * **배치가 쓸 만한가** — 링크 신원 불일치와, 모듈마다 못 앉은 줄.
 */
export function judgePack(pack: PackResult): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  // **링크 신원 불일치**(A-3) — 여태 `pack.linkMismatches` 를 아무도 안 읽었다.
  // 그 필드 주석이 "정상적으로 있을 수 있는 일이 아니다 … 예약 불변식이 깨진 것"
  // 이라고 말하는데도 조용히 버려지고 있었다(2026-08-04 배선).
  for (const mm of pack.linkMismatches) {
    issues.push(fail('link-mismatch', '링크', `링크 신원 불일치: ${mm}`, { carrier: 'item' }));
  }

  // 미탭(과용량 등) 있는 모듈.
  for (const pl of pack.placements) {
    if (pl.module.unroutedLines.length === 0) continue;
    const names = pl.module.unroutedLines.map((l) => `${l.role}:${l.name}`).join(", ");
    // **물음은 하나다: 이 줄이 왜 못 앉았나.** 그 답을 아는 자리에서 읽는다.
    //
    // 예전엔 `supply.reason`(= *"탭 계획이 왜 깨졌나"*)을 **먼저** 쓰고 [DepthShortage] 는
    // 보지도 않았다. 두 물음이 다르고, `g` 의 주인이 깊이 예산으로 바뀐 뒤로는 둘 사이에
    // **인과도 없다** — 탭이 깨진 것과 이 줄이 못 앉은 것은 별개다.
    //
    // 그리고 처방을 **문장에서 읽지 않는다.** `why.includes('demand>beltCap')` 같은 검사는
    // 사유 이름이 비슷하면 조용히 뒤집힌다(2026-08-04 실측: 정확히 반대로 붙어 있었다).
    // 저장소는 같은 교훈을 이미 배웠다 — [LayoutIssue] 가 `RejectReason` 을 흡수하면서
    // *어디가 막혔나* 와 *무엇을 고쳐야 하나* 가 문장에서 필드로 갈렸다. 여기가 마지막이었다.
    const rungs = pl.module.depthShortages && summarizeRungs(pl.module.depthShortages);
    /** 부을 수조차 없던 줄의 처방 — 붓기가 빈 손으로 온 사유([unpourableFix]). */
    const pourFix = [...(pl.module.unpourableFix?.values() ?? [])][0];
    const why = rungs
      ? `사다리 ${rungs}` // 자리를 못 잡았다 — 어느 칸에서 막혔나
      : pourFix
        ? `줄을 못 부었다 (${pourFix === "belt" ? "벨트 부족" : "인서터 없음"})`
        // 부었는데 사다리 기록도 없다 — 그럼 **방출**에서 못 놓은 것이다
        // (`emitOutputLinks`/`emitInputLinks` 가 `unroutedLines` 에 직접 넣는다).
        // 예전엔 여기에 `supply.reason`(= *"탭 계획이 왜 깨졌나"*)을 붙였는데,
        // **다른 물음의 답**이라 화면이 없는 원인을 가리켰다.
        : "부고도 못 놓았다 — 방출에서 자리가 없었다";
    // **처방은 사실에서 나온다.** 사다리 기록이 있으면 자리가 모자란 것이고, 그 지렛대는
    // 언제나 인서터다 — 빠른 팔은 팔 **개수**를 줄여 좌석을 아끼고, 긴팔은 면의 **깊이
    // 개수**(= 서로 다른 reach 수)를 늘린다. 셋 다(좌석·구간·포트) 같은 손잡이로 풀린다.
    const fixStep = rungs ? ("inserter" as const) : pourFix;
    const scope: IssueScope = "모듈";
    const carrier = pl.module.unroutedLines.some((l) => l.kind === 'pipe')
      ? ('fluid' as const)
      : ('item' as const);
    issues.push(fail('unrouted-lines', scope,
      `${pl.id}: [${names}] — ${why}`,
      { target: { moduleId: pl.id }, fixStep, carrier }));
  }
  return issues;
}

/**
 * **트렁크 파이프가 남의 관망에 붙었나** — 기둥은 자기 머신의 **유체 입력 상자**를 지나가라고 깐 것이므로
 * (같은 유체 → 안 막힘) 여기서 걸리는 건 진짜 사고다: 자기 머신의 유체 출력 상자를 같이 스쳤거나, 옆
 * 모듈의 다른 유체 관망에 붙었거나.
 *
 * **유체별로 나눠서 검사한다** — 한 모듈의 파이프를 통째로 한 유체의 지도에 대면,
 * 유체가 둘일 때 서로를 "남의 파이프"로 보고 자기 자신을 거절한다.
 */
export function judgePipeMerges(pack: PackResult, pipeFlowByFluid: ReadonlyMap<string, PipeFlow>): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  if (pipeFlowByFluid.size === 0) return issues; // 유체가 없는 트리 — 관망도 검사도 없다
  for (const pl of pack.placements) {
    for (const fluid of new Set(pl.module.pipeCells.map((c) => c.fluid))) {
      const ownPipes = pl.module.pipeCells.filter((c) => c.fluid === fluid);
      const hit = pipeFlowConflict(ownPipes, pipeFlowByFluid.get(fluid)!);
      if (hit)
        issues.push(fail('pipe-merge-conflict', '모듈',
          `${pl.id}: 트렁크 파이프(${fluid})가 (${hit.cell.x},${hit.cell.y}) 에서 ${hit.rule} 규칙 위반`,
          { carrier: 'fluid', target: { moduleId: pl.id }, cells: [{ ...hit.cell }] }));
    }
  }
  return issues;
}

/**
 * **못 피한 벨트 끝 칸** — 끝 칸이 어느 방향으로 꺾어도 남의 품목과 만나는데 지하벨트를
 * 안 골라 [종착](../../execution/module/beltTerminus.ts)을 못 세운 자리다. 흐름 그대로 두고
 * **경고**로 낸다(2026-09-06 사용자 확정): 물류는 이어지고 처방은 한 단계 뒤로 가는 것
 * 뿐이라 줄을 물리지 않는다 — 대신 **보이지 않으면 안 된다**(반출 skip 과 같은 자리).
 *
 * **뼈대가 마지막 오류 관문 뒤에서 부른다** — 앞쪽 `issues.length > 0` 관문들은 경고도 실패로 보고 배치를
 * 통째로 물린다. 경고는 마지막 관문을 지난 뒤에 쌓아야 `leaf.warnings` 로 나간다.
 */
export function terminusMergeWarnings(pack: PackResult): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  for (const pl of pack.placements) {
    const merges = pl.module.beltMerges;
    if (merges.length === 0) continue;
    const who = merges.map((m) => `(${m.x},${m.y}) ${m.item}→${m.into}`).join(' · ');
    issues.push({
      code: 'belt-terminus-merge', scope: '모듈', severity: 'warning', recoverable: true,
      carrier: 'item', fixStep: 'belt', target: { moduleId: pl.id },
      cells: merges.map((m) => ({ x: m.x, y: m.y })),
      detail:
        `${pl.id}: 벨트 끝 칸 ${merges.length}개가 **남의 품목 줄과 합류한다**`
        + ` — ${who}; 벨트 단계에서 **지하벨트를 하나 고르면** 그 자리에 종착이 선다`,
    });
  }
  return issues;
}

/**
 * **납품 경로가 섰나** — 경로마다 하나씩 낸다. 예전엔 "3건" 이라는 숫자 하나였다. 어느 납품 경로가 왜
 * 막혔는지는 `routes` 에 이미 있었는데 화면까지 못 갔다.
 *
 * 유체와 아이템을 가른다 — 원인도 처방도 다르다. 아이템 실패는 라우팅이 어려웠다는
 * 뜻(dijkstra 폴백까지 갔다 = `recoverable`)이지만, 유체 실패는 **계획 자체가
 * 불가능했다**는 뜻이다(§4.6, 폴백 없음 = `recoverable: false`).
 */
export function judgeDeliveries(deliveryRes: DeliveryResult): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  if (deliveryRes.failures === 0) return issues;
  for (const r of deliveryRes.routes) {
    if (r.ok) continue;
    const isFluidPlan = r.reason === "fluid-unplannable" || r.reason === "fluid-planned-chain-blocked";
    if (isFluidPlan) {
      issues.push(fail('fluid-unplannable', '채널',
        `${r.item}(${r.reason}) — 한 채널에 다른 유체가 겹쳤을 가능성`,
        { carrier: 'fluid', target: { deliveryKey: r.key } }));
    } else {
      issues.push(fail('delivery-failures', '납품경로',
        `${r.item}: ${r.reason ?? "사유 없음"}`,
        { carrier: 'item', recoverable: true, target: { deliveryKey: r.key } }));
    }
  }
  return issues;
}

/**
 * **섰지만 계약을 어긴 자리** — 경고 둘. 둘 다 물류는 이어지므로 실패가 아니지만, **보이지 않으면 안 된다.**
 */
export function deliveryWarnings(deliveryRes: DeliveryResult, perim: PerimeterPassResult | null): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  // **납품 폴백 경고**(2026-08-17) — *"계획대로 놓는다"* 는 S-layer 의 핵심 계약이 깨진 자리다.
  // 여태 콘솔에 줄 하나 찍고 끝이라 `failures` 는 0, 화면은 "성공"이었다. **폴백은 실패다** —
  // 계획된 경로를 못 쓰고 탐색으로 돌면 벨트가 모듈을 가로질러 남의 포트를 감고 들어오는
  // 기하가 나온다(실측 확인). 물류는 이어지므로 경고이되, **보이지 않으면 안 된다.**
  if (deliveryRes.dijkstraFallback > 0) {
    issues.push({
      code: 'delivery-dijkstra-fallback', scope: '납품경로', severity: 'warning', recoverable: true,
      detail:
        `납품 경로 ${deliveryRes.dijkstraFallback}개가 **계획을 못 쓰고 탐색으로** 돌았다` +
        `(계획대로 깐 것 ${deliveryRes.planned}개)` +
        (deliveryRes.reservationOverrun > 0
          ? ` — 그중 ${deliveryRes.reservationOverrun}개는 **남의 예약을 밟았다**(연쇄 가능)`
          : '') +
        // **사유를 붙인다** — 넷의 처방이 다 다르다([DeliveryRouteResult.chainMisses]).
        (deliveryRes.chainMisses.length
          ? `; 사유 ${[...new Map(deliveryRes.chainMisses.map((m) => [m.reason, 0])).keys()]
              .map((r) => `${r}×${deliveryRes.chainMisses.filter((m) => m.reason === r).length}`)
              .join(' ')}`
          : ''),
    });
  }
  // **반출 skip 경고**(A-4) — 여태 `skipped` 와 사유를 아무도 안 읽었다. 상자가 외곽으로
  // 못 나가 로컬 ring 에 남아도 사용자는 알 길이 없었다. 물류 자체는 정상이므로(트렁크째
  // 남아 여전히 이어진다) 실패가 아니라 **경고**다.
  if (perim && perim.skipped > 0) {
    issues.push({
      code: 'perimeter-skip', scope: '반출경로', severity: 'warning', recoverable: true,
      detail: `상자 ${perim.skipped}개가 외곽으로 못 나가 모듈 안에 남음${perim.reason ? ` — ${perim.reason}` : ''}`,
    });
  }
  return issues;
}
