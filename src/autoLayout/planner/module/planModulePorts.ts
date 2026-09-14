/**
 * planModulePorts — **모듈 안쪽 계획의 단일 진입점.** 좌표가 생기기 전에 자리를 전부 정한다.
 *
 * ## 왜 하나로 묶나
 *
 * 예약 철학은 "큰 그림을 보는 **주체 하나**가 먼저 자리를 잡고, 뒤 단계는 탐색 없이 놓기만
 * 한다" 이다. 그런데 예전엔 그 주체가 둘로 갈려 있었다 —
 *
 * | 주체 | 무엇을 배정 | 어디에 |
 * |---|---|---|
 * | 링크 면 배정 | 자식↔부모 링크가 앉을 면·줄 | `clusterModule` 안 |
 * | `insertingPlanner` | 나머지 줄(원료·완제품)이 앉을 면·깊이 | `clusterPortPlanner` |
 *
 * (2026-09-02: 그 둘 다 삭제됐다 — 나머지 줄도 ①과 **같은 배분기**를 탄다.)
 *
 * 둘이 같은 좌석을 놓고 다투므로 손수 조율해야 했다: 링크 줄을 planner 입력에서 **빼고**
 * (`linkedKeys`), 링크가 먹은 행을 **통보**하고(`seatRowsUsed`), 방출 순서까지 맞춰야 했다.
 * 조율이 코드 여기저기 흩어져 있으니 *"무관한 판정이 이미 끝난 예약을 삼키는"* 순서 버그가
 * 났다(2026-07-21). **한 함수 안에서 순서대로 일어나면 그 버그는 생길 자리가 없다.**
 *
 * ## 순서 — 제약이 센 쪽 먼저(스도쿠 원칙)
 *
 * ```
 * ① 링크 면 배정      자기 기하를 스스로 갖는다 → 가장 덜 자유롭다 → 먼저
 * ② 유체 줄 조립      면을 우리가 못 고른다(머신 fluid_box 가 강제) → 그다음
 * ③ 나머지 줄 배정    ①②가 남긴 예산 안에서 고른다
 * ④ gap 폭 산출       ①의 부산물 — 이 값이 머신 좌표를 정한다
 * ```
 *
 * ## 좌표가 없다는 것이 핵심이다
 *
 * ③ [insertingPlanner] 의 입력을 전수 확인했다 — `machines[]` 도 `layout` 도 안 본다.
 * 그래서 **머신을 놓기 전에** 돌 수 있고, 그래야 ④의 gap 폭이 `layoutCluster` 로 들어간다
 * (닭과 달걀: 폭이 좌표를 정하는데 폭은 배정의 부산물이다).
 *
 * 산출물([ModulePortPlan])에는 좌표가 하나도 없다. 좌표를 입히는 일은
 * [placeLinkSeats] 의 **덧셈 한 줄**뿐이다.
 *
 * ## 이 파일은 순서만 쥔다
 *
 * 두 함수가 뼈대다 — [planLinkFaces](⓪ 유체 면 → ① 무대 → ② 링크 좌석)와 [planModulePorts]
 * (① 무대 → ② 링크 몫 → ③ 유체 줄 → ④ 나머지 줄 → ⑤ 못 부은 줄 → ⑥ 부산물). 고르는 일은
 * [policy] · [linkPlanner], 자리를 묻고 적는 일은 [ledger], 세는 일은 [arith] 가 한다
 * (2026-09-14 계획 구조-2축 · 2 Step 3b). 좌석표는 먼저 앉은 것이 이기므로 **부르는 순서가 곧 답**이고,
 * 그 순서가 이 파일에 있다.
 */

import type { PlannedLine, PortSide, IoLine } from "../../module/types/line";
import type { ModuleInput } from "../../module/types/module";
import type { DepthShortage, LinkFaceStage, LinkFacePlan, LinkFaceContext, FaceAllocation } from "../../module/types/seat";
import { summarizeBeltForms } from "../../module/link";
import { recordBeltFormStats, recordFaceDepthStats } from "../../../debug/runStats";
import { inserterForReach } from "../../buildSpec";
import { laneCapOfTier } from "../../beltThroughput";
import type { PortFace } from "../../containerModel";
import {
  clusterBeltDepthsOf, depthShortagesOf, fluidFacesOf, gapExitSidesFromPlans, gapRowsFromPlans,
  linkedKeysOf, linkFaceDepths, pipeLinesOf, restLinesOf,
} from "./arith";
import { emptyAllocation, openLinkFaceContext } from "./ledger";
import {
  restOutcomeOf, seatModuleLinks, seatRestLines, unpourableOf, type RestSeating,
} from "./policy";

/**
 * 계획에 필요한 [ModuleInput] 조각 — **좌표·id 접두사·방출 취향은 안 본다.**
 * (`idPrefix`·`lineEnds` 가 빠져 있는 것이 의도다: 전자는 방출 이름, 후자는 트렁크 기하다.)
 */
export type ModulePortPlannerInput = Pick<
  ModuleInput,
  | "machine"
  | "lines"
  | "inserterEntityName"
  | "inserters"
  | "nsExposure"
  | "supplyCapacity"
  | "belts"
  | "outputLinks"
  | "inputLinks"
  | "fluidTrunk"
>;

/** [planModulePorts] 의 산출물 — **좌표가 하나도 없다.** */
export interface ModulePortPlan {
  /** 링크 그룹별 면 배정(입력 목록과 같은 순서, 못 앉은 그룹은 `undefined`). */
  linkFaces: {
    out: (LinkFacePlan | undefined)[];
    in: (LinkFacePlan | undefined)[];
  };
  /**
   * **(나) 기계별 포트의 면 배정** — 링크와 **같은 자료**다(그래서 같은 방출기가 놓는다).
   * 탭으로 성립한 모듈에는 없다(`undefined`). 그룹은 여기서 만든 것이라 함께 들고 나간다 —
   * 방출기가 `plans[i]` 를 그룹 순서로 읽기 때문이다.
   */
  restLinks?: RestSeating;
  /** 머신 i 와 i+1 사이를 몇 칸 벌릴까 — ①의 부산물. `layoutCluster` 로 그대로 간다. */
  rowGaps: number[];
  /** 나머지 줄의 tap/direct 판정 + 줄별 슬롯. */
  /** 유체 줄의 배정 — 면은 머신이 강제하므로 planner 를 안 거치고 여기서 찍는다. */
  pipePlanned: PlannedLine[];
  /** 면마다 — 파이프가 좌석을 비우고 밖으로 점프할 수 있나. 방출 기하가 이 값에 갈린다. */
  isJumpableToClusterPipe: (side: PortSide) => boolean;
  /**
   * gap 벨트의 포트 끝이 좌석 줄(d1)을 먹는 옆면 — [gapExitSidesFromPlans].
   * 파이프가 그 면에서 **점프해야 하는** 이유가 된다([buildTrunkContext]).
   */
  gapExitSides: ReadonlySet<PortFace>;
  /**
   * 옆면(W/E)마다 링크·다이렉트가 먹는 **가장 깊은 칸**([linkFaceDepths]) — [ClusterPipe] 가
   * 이보다 바깥으로 물러나야 한다. 파이프 깊이를 내는 `buildTrunkContext.beltMaxOn` 은
   * **탭 계획만** 훑으므로, 이 값을 안 주면 링크가 앉은 면에서 0 을 답하고 파이프가 링크
   * 포트 끝 위로 지나간다(끊겨도 겹침이 아니라 아무도 못 알아챈다).
   */
  linkFaceDepths: Partial<Record<PortFace, number>>;
  /** 링크가 맡은 줄의 열쇠 `${role}:${name}` — 방출기가 "이 줄은 내 몫이 아니다"를 판정한다. */
  linkedKeys: Set<string>;
  /**
   * **나머지 줄(링크 아닌 줄)의 성패.** 이름이 요점이다 — 예전의 `!plan.ok` 는 *모듈 전체*가
   * 실패했다는 뜻인지 *나머지 줄*이 실패했다는 뜻인지 알 수 없어, 이미 성공한 링크 예약까지
   * 함께 버리는 순서 버그를 불렀다. 링크의 성패는 여기 없다 — 링크는 자기 방출에서 갈린다.
   *
   * 성공·실패가 **서로 다른 자료**를 들고 있어(줄 배정 ↔ 못 놓은 줄), 방출기가 실패를
   * 확인하지 않고 배정을 꺼낼 수 없다.
   */
  rest:
    | { ok: true; lines: PlannedLine[] }
    | { ok: false; unplaced: IoLine[] };
  /**
   * **부을 수 없어 줄이 하나도 안 난 나머지 줄들** — 수량 미상이거나(저울 없음) 팔이 면
   * 좌석에 안 들어가는 줄이다([externalLineGroups] 가 빈 손으로 돌아온 경우).
   *
   * `rest.unplaced` 와 **다른 자리**인 이유: 저쪽은 *"나머지 줄 전체가 실패했다"* 라 모듈이
   * 통째로 물러나지만, 이쪽은 **그 줄 하나만** 못 깐 것이라 나머지는 그대로 깔린다.
   *
   * 이 목록이 없으면 그 줄은 **조용히 사라진다** — 포트도 벨트도 안 나는데 모듈은 성공으로
   * 보고되고, 그 재료를 못 받는 머신이 굶는 걸 게임에 넣어야 안다(2026-08-24 `makeLink`
   * 폴백 삭제 때 드러났다: 폴백이 가짜 줄로 그 구멍을 덮고 있었다).
   */
  unpourableLines: IoLine[];
  /**
   * **왜 못 부었나** — `${role}:${name}` → 고쳐야 할 위저드 단계.
   *
   * 원인이 셋이고 처방이 갈린다([externalLineGroups] 의 `pour`):
   *
   * ```
   * 수량 미상        `lineRates` 에 그 줄이 없다        처방 없음 — **지어내지 않는다**
   * 인서터 없음      reach 1 짜리 팔이 없다            "inserter"
   * 벨트 못 고름     그 수요를 감당할 벨트가 없다       "belt"
   * ```
   *
   * **처방은 사실 옆에 산다.** 예전엔 이 판단이 화면에서 `supply.reason` **문자열을 검사해**
   * 나왔고(`why.includes('demand>beltCap')`), 그래서 사유 이름이 비슷하면 처방이 뒤집혔다
   * (2026-08-04 실측). 지금은 실패를 아는 자리가 값으로 낸다.
   */
  unpourableFix?: Map<string, "belt" | "inserter">;
  /**
   * **못 앉은 내부 링크의 사유** — `linkId` → 후보마다의 [DepthShortage].
   *
   * 사다리 1단(구간 쪼개기)의 입력이다. `blockedRows` 가 곧 **자름의 경계**이고, 쪼개는 일은
   * 여기서 못 한다 — 링크는 **간선**이라 자식·부모가 같은 객체를 봐야 하고([pairDeliveryPorts]
   * 가 `linkId` 로 짝짓는다) 그 객체를 쥔 것은 `modulePacking.linkCache` 다. 그래서 이 계층은
   * **사유만 올려 보낸다.**
   *
   * 외부 줄(원료·완제품)은 신원이 없어 여기 안 담긴다 — 그쪽은 짝이 교환 가능이라 쪼갬이
   * 국지적이고, 별개 단계다.
   */
  depthShortages: Map<string, DepthShortage[]>;
}

/**
 * **⓪ 유체 면 + ① 링크 면 배정** — 좌표도 방출도 안 본다.
 *
 * `generateModule` 밖(`modulePacking` 의 `P0b`)에서 불러도 같은 답을 낸다 — 입력이
 * 전부 스펙과 링크이고, 그 둘은 `P0` 에 이미 확정되어 있다.
 */
export function planLinkFaces(
  input: ModulePortPlannerInput,
  count: number,
  /**
   * `"seat"`(기본) — 모듈 축으로 이 모듈의 링크를 직접 앉힌다(옛 경로·단독 호출·테스트).
   * `"open"` — **표만 차려 돌려준다.** 자리는 [seatLinkEdge] 가 **간선마다 양끝을 함께**
   * 잡는다(Step 2) — 그래야 한 링크가 반쪽만 앉는 일이 없다.
   */
  mode: "seat" | "open" = "seat",
): LinkFaceStage {
  // ⓪ 유체 면 — 머신이 강제한다. 면마다 줄 수 · 깊이 상한 · 점프 가능(예산은 거절과 같은 함수)
  const fluid = fluidFacesOf(input);
  // ① 무대 — 면마다 빈 표 · 끝 · 기둥 밖 칸. 표는 면을 처음 볼 때 유체 칸을 찍어 차린다
  const faceCtx = openLinkFaceContext(input, count, fluid.pipeFaceRows);
  const outLinks = input.outputLinks ?? [];
  const inLinks = input.inputLinks ?? [];
  if (mode === "open") {
    return stageOf(faceCtx, outLinks, inLinks, emptyAllocation(outLinks.length), emptyAllocation(inLinks.length), fluid);
  }
  // ② 링크 좌석 — 양쪽 선호 면 먼저, 넘침은 그 뒤(유체 면 → gap)
  const seated = seatModuleLinks(faceCtx, outLinks, inLinks);
  return stageOf(faceCtx, outLinks, inLinks, seated.out, seated.in, fluid);
}

/** [LinkFaceStage] 를 엮는다 — `tables` 는 무대(`ctx.tables`)와 **같은 Map** 이다. */
function stageOf(
  ctx: LinkFaceContext,
  outLinks: LinkFaceStage["outLinks"],
  inLinks: LinkFaceStage["inLinks"],
  out: FaceAllocation,
  inn: FaceAllocation,
  fluid: Pick<LinkFaceStage, "pipeFaces" | "isJumpableToClusterPipe">,
): LinkFaceStage {
  return {
    tables: ctx.tables, ctx, outLinks, inLinks,
    out, in: inn, pipeFaces: fluid.pipeFaces, isJumpableToClusterPipe: fluid.isJumpableToClusterPipe,
  };
}

/**
 * 모듈 하나의 포트 계획 — 한 모듈의 포트 자리를 전부 배정한다. ⓪①②는 [planLinkFaces] 가 이미 끝낸 것을 **받는다.**
 *
 * `count` 는 호출자가 정규화한 머신 대수
 * (`layoutCluster` 가 만드는 머신 수와 **같아야** 한다 — 배정이 없는 머신을 가리키면 안 된다).
 *
 * `stage` 를 안 주면 여기서 직접 돌린다 — 그랬면 옆 경로(모듈 안에서 배정)가 생기는 게
 * 아니라 **같은 함수를 같은 인자로** 부를 뿐이라 답이 같다(테스트·단독 호출용).
 */
export function planModulePorts(
  input: ModulePortPlannerInput,
  count: number,
  stage?: LinkFaceStage,
): ModulePortPlan {
  // ① 무대 — 간선 축 배정(packModuleTree 의 좌석 단계)이 이미 앉혔으면 그것을 받는다
  const st = stage ?? planLinkFaces(input, count);
  // ② 링크 몫 — 링크가 맡은 줄은 자기 기하를 갖는다. 나머지 줄 배정에서 뺀다
  const linkedKeys = linkedKeysOf(st);
  // ③ 유체 줄 — 면은 머신이 정한다
  const pipe = pipeLinesOf(input);
  // ④ 나머지 줄 — 깊이 예산이 g 를 정하고, 링크와 같은 배분기로 앉힌다(자식-공급 먼저)
  const restLines = restLinesOf(input, linkedKeys);
  const restLinks = seatRestLines(st, input, count, restLines);
  // ⑤ 못 부은 줄 — 줄이 하나도 안 난 줄과 고칠 위저드 단계
  const unpourable = unpourableOf(input, restLines, restLinks);
  recordPortPlanStats(st, input, count, restLinks);
  // ⑥ 부산물 — 좌석이 정한 gap 폭 · 점프해야 할 면 · 링크 깊이 · 사다리로 올릴 사유
  const plans = [st.out.plans, st.in.plans, restLinks.out.plans, restLinks.in.plans];
  return {
    linkFaces: { out: st.out.plans, in: st.in.plans },
    restLinks,
    // gap 폭 — ①④의 부산물. 우리가 고르는 값이 아니다.
    rowGaps: gapRowsFromPlans(count, plans),
    pipePlanned: pipe.planned,
    isJumpableToClusterPipe: st.isJumpableToClusterPipe,
    gapExitSides: gapExitSidesFromPlans([st.out.plans, restLinks.out.plans], [st.in.plans, restLinks.in.plans]),
    linkFaceDepths: linkFaceDepths(plans),
    linkedKeys,
    depthShortages: depthShortagesOf(st),
    // 부을 수 없어 줄이 하나도 안 난 나머지 줄 — **삼키지 않는다**(위 [unpourableLines]).
    unpourableLines: unpourable.lines,
    unpourableFix: unpourable.fix,
    // 유체가 못 앉으면 나머지 줄도 통째로 실패한다(반만 놓으면 그 머신이 조용히 굶는다).
    rest: restOutcomeOf(input, linkedKeys, pipe),
  };
}

/**
 * **계측 — 관측만 한다**(계산도 분기도 반환값도 안 바꾼다).
 *
 * 형태는 산출물 어디에도 안 남아서, glass 54줄(필요 5줄)을 사후에 손으로 세야 했다.
 * 내부 링크는 `modulePacking` 이 따로 센다 — 여기는 **외부 줄**(원료·완제품) 몫이다.
 * 싱크에 직접 쓰는 것은 `moduleWizard` 가 이미 하는 일과 같은 관용구다(runStats 머리말).
 * **면 깊이 계측** — 설계는 `docs/auto-layout/module/module-planning.md §4.5`.
 * 묻는 것: *"둘째 깊이가 실물에서 쓰이나, 그때 팔 종류가 실제로 갈리나."*
 * 사후에 훑기만 한다 — [clusterBeltDepthsOf] 가 장부를 안 읽어서 배정이 끝난 뒤에도 같은 답이다.
 * (관측만 — 계산·분기·반환값은 안 바뀐다. `runStats` 머리말의 규약.)
 */
function recordPortPlanStats(
  st: LinkFaceStage,
  input: Pick<ModuleInput, "inserters" | "belts">,
  count: number,
  restLinks: RestSeating,
): void {
  const plannerInserters = input.inserters;
  const { ctx: faceCtx, outLinks, inLinks } = st;
  const outFaces = st.out;
  const inFaces = st.in;
  for (const list of [
    outFaces.plans, inFaces.plans, restLinks.out.plans, restLinks.in.plans,
  ]) {
    for (const p of list) {
      if (!p || p.face === "N" || p.face === "S") continue; // gap 은 깊이 개념이 없다
      const depths = clusterBeltDepthsOf(faceCtx, p.face);
      const deep = depths.length > 0 && p.clusterBeltDepth !== depths[0];
      // 팔 종류가 실제로 갈리나 — **깊이가 아니라 처리량**을 본다(§0.3: 배수는 스펙이 정한다).
      const tpOf = (d: number) => inserterForReach(plannerInserters, d - 1)?.throughput;
      const mismatch =
        deep && tpOf(depths[0]) !== undefined && tpOf(p.clusterBeltDepth) !== undefined
          && tpOf(depths[0]) !== tpOf(p.clusterBeltDepth);
      recordFaceDepthStats({
        assignments: 1,
        multiDepthFace: depths.length > 1 ? 1 : 0,
        deepBelt: deep ? 1 : 0,
        deepBeltOtherArm: mismatch ? 1 : 0,
      });
    }
  }

  // **못 앉은 줄의 사유** — 선호 면에서 후보마다 왜 안 됐나. 사다리가 읽을 자료를 지금은
  // 관측만 한다(계획서 §9.7 ⑤ · §14-2). *"깊이 부족"* 이 아니라 **막힌 행**을 담는 것이
  // 요점이다 — 그 행이 곧 자름의 경계다.
  const said: string[] = [];
  for (const [groups, alloc] of [
    [outLinks, outFaces], [inLinks, inFaces],
    [restLinks.out.groups, restLinks.out], [restLinks.in.groups, restLinks.in],
  ] as const) {
    alloc.plans.forEach((p, i) => {
      if (p || said.length >= 12) return; // 앉은 줄은 사유가 없다
      const w = alloc.shortages[i];
      if (!w?.length) return;
      said.push(
        `못앉음 ${groups[i]?.item ?? "?"}: ` +
          w.map((x: DepthShortage) => {
            if (x.seats) return `${x.face}d${x.clusterBeltDepth} 좌석 ${x.seats.need}>${x.seats.budget}`;
            if (x.blockedRows) {
              const r = x.blockedRows;
              return `${x.face}d${x.clusterBeltDepth} 막힌행 ${r.slice(0, 6).join(",")}${r.length > 6 ? `…(${r.length})` : ""}`;
            }
            return `${x.face}d${x.clusterBeltDepth} 포트칸 ${(x.blockedPort ?? []).map(([r, d]: readonly [number, number]) => `(${r},d${d})`).join("")}`;
          }).join(" · "),
      );
    });
  }
  if (said.length) recordFaceDepthStats({ shortages: said });

  recordBeltFormStats(
    summarizeBeltForms(
      [...restLinks.out.groups, ...restLinks.in.groups].map((group) => ({
        group, fromCount: count, toCount: count,
      })),
      // **분모는 레인이다**(`modulePacking` 의 같은 자리와 같은 이유) — 줄 하나가 쓸 수 있는
      // 것은 벨트의 절반뿐이라, 물리 처리량으로 재면 이용률이 절반으로 보이고 과적재가 안 잡힌다.
      (name) => (name === undefined ? undefined : laneCapOfTier(input.belts?.find((b) => b.entityName === name))),
    ),
  );
}
