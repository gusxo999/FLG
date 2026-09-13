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
 */

import {
  type IoLine,
  type PlannedLine,
  type PortSide,
} from "./ioLine";
import type { ModuleInput } from "../../module/clusterModule";
import { fluidJumpBlocker, fluidLineOf, fluidLinesOnSide, clusterBeltDepthCap } from "../../module/fluidPorts";
import {
  externalLineGroups, readLinkRole, resolveSpanBlock, splitLinkAtRows, summarizeBeltForms,
  type Link,
} from "../../module/link";
import { recordBeltFormStats, recordFaceDepthStats, recordLaneUnshare } from "../../../debug/runStats";
import { inserterForReach } from "../../buildSpec";
import { determineBeltCount, laneCapOfTier } from "../../beltThroughput";
import { planBundles } from "./depthBudget";
import { AUTO_LAYOUT_LINK_OPPOSITE_FACE } from "../../debugFlags";
import {
  allocateLinkFaces,
  commitLinkFace,
  tryLinkFace,
  seatOnSharedBelt,
  clusterBeltDepthsOf,
  spillLinkFacesToGap,
  gapRowsFromPlans,
  gapExitSidesFromPlans,
  linkFaceDepths,
  type FaceAllocation,
  type DepthShortage,
  type LinkFaceContext,
  type LinkFacePlan,
} from "./linkPlanner";
import { copyFaceTable, type FaceTable } from "./faceTable";
import type { PortFace } from "../../containerModel";

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
  restLinks?: {
    out: { groups: Link[]; plans: (LinkFacePlan | undefined)[]; shortages: DepthShortage[][] };
    in: { groups: Link[]; plans: (LinkFacePlan | undefined)[]; shortages: DepthShortage[][] };
  };
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
 * 한 모듈의 포트 자리를 전부 배정한다. `count` 는 호출자가 정규화한 머신 대수
 * (`layoutCluster` 가 만드는 머신 수와 **같아야** 한다 — 배정이 없는 머신을 가리키면 안 된다).
 */
/**
 * **① 링크 면 배정의 산출** — [planLinkFaces] 가 내고 [planModulePorts] 가 받는다.
 *
 * 이 번들이 있는 이유는 하나다 — **배정을 `generateModule` 밖에서 돌리기 위해**
 * 배정이 방출 안에 갇혀 있으면
 * 그 결과를 보려고 방출까지 해야 하고, 고치려면 밖에서 입력을 고쳐 **다시 만들어야** 한다
 * — 그게 되먹임 A·B 의 뿌리다.
 *
 * `pipeFaces`·`pipeFaceRows` 까지 담는 것은 ⓪ 가 ① 뿐 아니라 ③도 먹이기 때문이다 —
 * 둘로 나누어 각자 유도하면 **같은 사실을 두 곳이 세게 된다**(R3).
 */
export interface LinkFaceStage {
  tables: Map<PortFace, FaceTable>;
  ctx: LinkFaceContext;
  outLinks: Link[];
  inLinks: Link[];
  out: FaceAllocation;
  in: FaceAllocation;
  pipeFaces: { side: PortSide; fluidRows: number; depthCap: number }[];
  isJumpableToClusterPipe: (side: PortSide) => boolean;
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
  // ── ⓪ 유체 면 — **모든 배정보다 먼저** ──────────────────────────────────────
  // 머신 `fluid_boxes` 가 강제하는 값이라 우리가 협상할 수 없다(제약이 가장 센 것 먼저 —
  // 스도쿠 원칙). 그리고 ①도 이 답을 알아야 한다: 유체가 가져간 면에 링크를 앉히면 인서터가
  // 파이프 칸에 선다. 예전엔 ①이 ② 앞에 있어 그 사실을 **모른 채** 배정했다.
  // 슬롯 목록은 **접히지 않고 그대로 온다**(`docs/용어사전.md §BuildSpec`). 예전엔 이진 필드에서 다시 폈다.
  const plannerInserters = input.inserters;
  const ft = input.fluidTrunk;
  // [isJumpableToClusterPipe] — "이 면에서 파이프가 좌석을 비우고 밖으로 점프할 수 있나".
  // **면마다 따로 판정한다** — 면마다 유체 줄 수가 다르고, 그 수가 아래 ②③을 둘 다 바꾼다.
  // 판정 자체는 [fluidJumpBlocker] 가 단독으로 갖는다 — [moduleWizard] 가 `n ≥ 2` 인 면을
  // **거절**할 때 같은 공식을 봐야 하기 때문이다(둘로 갈리면 계획과 사유가 어긋난다).
  // 유체 한 줄이면 못 넘어도 옛 스파인으로 **연속적 저하**이고, 두 줄이면 거절이다.
  const jumpBudget = {
    undergroundPipeEntityName: ft?.undergroundPipeEntityName,
    pipeMaxUndergroundDistance: ft?.pipeMaxUndergroundDistance,
    seatRows: input.machine.h,
    beltDepths: Math.min(plannerInserters.length, input.lines.filter((l) => l.kind !== "pipe").length),
  };
  /**
   * 이 면의 **깊이 상한** — 지하파이프 사거리가 정한다([clusterBeltDepthCap]). 유체가 없는 면은
   * 상한이 없다. *"사거리가 짧으면 파이프 배치를 우선한다"* 가 이 한 줄이다(2026-08-16).
   */
  const depthCapOf = (side: PortSide): number => {
    const n = fluidLinesOnSide(ft, side).length;
    return n === 0 ? Infinity : clusterBeltDepthCap(n, ft?.pipeMaxUndergroundDistance);
  };
  const isJumpableToClusterPipe = (side: PortSide): boolean => {
    const n = fluidLinesOnSide(ft, side).length;
    if (n === 0) return false; // 유체가 없는 면은 점프할 것도 없다.
    return fluidJumpBlocker(n, jumpBudget) === null;
  };
  /** ③ 이 보는 면별 요약 — 유체 행 수와 점프 여부. 없는 면은 목록에 안 넣는다. */
  const pipeFaces = (["W", "E"] as const)
    .map((side) => ({ side, fluidRows: fluidLinesOnSide(ft, side).length, depthCap: depthCapOf(side) }))
    .filter((f) => f.fluidRows > 0);
  /**
   * ① 이 보는 같은 사실 — 다만 **행 번호까지** 필요하다(③ 은 개수만 쓴다). 링크는 점프 면의
   * 유체 상자 행을 건너뛰고 앉아야 하므로 `fluidboxOffset` 을 그대로 넘긴다.
   */
  const pipeFaceRows = new Map<PortFace, { rows: readonly number[]; depthCap: number }>(
    pipeFaces.map((f) => [
      f.side as PortFace,
      { rows: fluidLinesOnSide(ft, f.side).map((l) => l.fluidboxOffset), depthCap: f.depthCap },
    ]),
  );

  // ── ① 링크 면 배정 ─────────────────────────────────────────────────────────
  // 이 단계는 팔 **수**만 본다(좌표 없음). gap 으로 넘어간 그룹은 gap 안에 가로 벨트를 놓고,
  // **gap 폭 = 그 gap 을 지나는 가로 벨트 수**다 — 그 폭이 다시 머신 좌표를 정하므로
  // 좌표보다 면이 먼저다.
  const outLinks = input.outputLinks ?? [];
  const inLinks = input.inputLinks ?? [];
  // **면마다 좌석표 한 장** — 이 배정이 아는 자리의 전부다(옛 장부 셋이 여기로 접혔다).
  // 표는 [tryLinkFace] 가 그 면을 처음 볼 때 만들어진다(유체 칸을 미리 찍어서).
  const faceTables = new Map<PortFace, FaceTable>();
  const faceCtx: LinkFaceContext = {
    machine: input.machine, count, tables: faceTables, pipeFaces: pipeFaceRows,
    ends: new Map(), outside: new Map(), inserters: input.inserters,
  };
  const empty = (n: number): FaceAllocation => ({
    plans: Array.from({ length: n }, () => undefined),
    deferred: [],
    shortages: Array.from({ length: n }, () => []),
  });
  if (mode === "open") {
    return {
      tables: faceTables, ctx: faceCtx, outLinks, inLinks,
      out: empty(outLinks.length), in: empty(inLinks.length),
      pipeFaces, isJumpableToClusterPipe,
    };
  }
  const outFaces = allocateLinkFaces(faceCtx, outLinks, "from", "W");
  const inFaces = allocateLinkFaces(faceCtx, inLinks, "to", "E");
  // 넘침은 나중 — 양쪽의 선호 면 수요가 먼저 자리를 잡은 뒤에 남은 gap 을 다툰다.
  // **선호 면을 다시 넣는 이유**: 그 면이 유체 면이면 위에서 비켜 갔다([tryLinkFace] 의
  // `allowPipeFace`). 넘침 단계는 유체 면을 허용하므로 여기서 한 번 더 기회를 준다 —
  // 유체 면에 앉으면 그 면이 넓어지지만 gap 으로 가면 기둥이 벌어진다. **유체 면이 먼저다.**
  // (반대 옆면은 여전히 안 쓴다 — 벨트가 채널 반대쪽에서 출발해 되돌아올 길이 없다.)
  spillLinkFacesToGap(faceCtx, outLinks, "from", outFaces, ["W", "S", "N"]);
  spillLinkFacesToGap(faceCtx, inLinks, "to", inFaces, ["E", "S", "N"]);

  return {
    tables: faceTables, ctx: faceCtx, outLinks, inLinks,
    out: outFaces, in: inFaces, pipeFaces, isJumpableToClusterPipe,
  };
}

/**
 * **간선 하나를 양끝에 함께 앉힌다** — 루프 축이 모듈이 아니라 간선이다
 *
 * `Link` 는 **두 모듈에 걸친 객체**다 — `from` 은 자식의 머신, `to` 는 부모의 머신.
 * 그런데 옛 모듈 축에서는 자식이 `from` 만, 부모가 `to` 만, **서로 모르게** 읽었다.
 * 그래서 셋이 불가능했고(쪼갬·끝 맞추기·순서), 코드는 그 셋을 **밖에서 우회**하며
 * 되먹임 둘을 지고 있었다.
 *
 * 여기서 얻는 것이 둘이다:
 *
 * ```
 * ① 원자성  양끝이 다 되면 확정 · 한쪽이라도 안 되면 둘 다 미배정   ← 반쪽 배정이 없다
 * ② 국소성  쪼갤 만하면 **그 자리에서** 쪼개고 토막을 이어서 앉힌다  ← 밖에서 고쳐 다시 안 만든다
 * ```
 *
 * ①이 없던 시절의 증상이 `PackResult.linkMismatches` 의 *"child emitted, parent didn't"* 이고,
 * ②가 없던 시절의 대가가 **되먹임 B**(`linkCache` 를 밖에서 고치고 트리를 통째로 재생성)다.
 *
 * @param toOffsetGroups 이 간선의 그룹들. **반환값의 `groups` 가 최종본**이다(쪼개졌으면 토막).
 */
/**
 * **합류 쌍을 골라 이끄는 줄과 포트 끝을 정한다** — 앉히기 **전에**, 수만으로.
 *
 * ## 이끄는 줄 = **짧은 구간**
 * 합류 칸은 이끄는 줄의 포트 쪽 끝에 서고, 따르는 줄이 **거기까지 비켜 올라온다.**
 * 그 비켜 가는 길이가 곧 **이끄는 줄의 길이**다 — 그러니 짧은 쪽이 이끌어야 한다.
 * (실측 예: 8대·3대 기둥에서 긴 쪽이 이끌면 10칸, 짧은 쪽이 이끌면 **4칸**.)
 * *"합류는 빠를수록 좋다"* 를 코드로 옮긴 것이 이 한 줄이다 — 두 줄이 나란히 달리는
 * 구간이 짧을수록 자리를 덜 먹는다.
 *
 * ## 포트 끝 = **이끄는 줄이 있는 쪽**
 * 이끄는 줄이 기둥 **아래쪽**(머신 index 가 큰 쪽)이면 S, 아니면 N.
 *
 * 짝이 둘이 아닌 신원은 아예 안 담는다 — 쪼개져 하나만 남았거나 이미 풀린 것이다.
 */
function pairsOf(groups: readonly Link[]): Map<string, { lead: Link; follow: Link; end: "N" | "S" }> {
  const by = new Map<string, Link[]>();
  for (const g of groups) {
    if (g.sharedLineId === undefined) continue;
    (by.get(g.sharedLineId) ?? by.set(g.sharedLineId, []).get(g.sharedLineId)!).push(g);
  }
  const out = new Map<string, { lead: Link; follow: Link; end: "N" | "S" }>();
  for (const [id, gs] of by) {
    if (gs.length !== 2) continue;
    const size = (g: Link) => g.from.size;
    const [lead, follow] = size(gs[0]) <= size(gs[1]) ? [gs[0], gs[1]] : [gs[1], gs[0]];
    const lo = (g: Link) => Math.min(...g.from.keys());
    out.set(id, { lead, follow, end: lo(lead) > lo(follow) ? "S" : "N" });
  }
  return out;
}

export function seatLinkEdge(
  fromSeat: LinkFaceStage,
  toSeat: LinkFaceStage,
  toOffsetGroups: readonly Link[],
  opts: { split: boolean },
): EdgeSeatResult {
  const groups: Link[] = [];
  const fromPlans: (LinkFacePlan | undefined)[] = [];
  const toPlans: (LinkFacePlan | undefined)[] = [];
  const fromWhy: DepthShortage[][] = [];
  const toWhy: DepthShortage[][] = [];
  let splits = 0;

  // **쪼갬 예산** — 못은 깊이 수만큼에서 멈추므로(`machine-link.md`) 유한하지만,
  // 예산 없이 두면 잘못된 판정 하나가 무한 루프가 된다. 그룹당 넷이면 넉넉하다.
  let budget = toOffsetGroups.length * 4;

  // ── 배정 순서 — **제약이 센 것부터**(스도쿠 원칙) ──────────────────────────────
  //
  // `planModulePorts` ⓪ 이 유체 면에 쓰는 그 원칙이다. 순위는 **대안이 있느냐**로 갈린다:
  //
  // ```
  // ① 유체 면    머신이 정한다. 협상 불가                    (여기 오기 전에 끝났다)
  // ② 합류 쌍    기둥 끝 + 비켜 가는 열. **대안이 없다**      ← 이 정렬이 넣는 자리
  // ③ 관통 줄    끝을 원한다. 못 받으면 **옆 포트로 저하 가능**
  // ④ 구간 줄    옆 포트. 깊이·행이 자유로워 가장 헐겁다
  // ```
  //
  // **이 순서면 「양보하나 포기하나」를 따로 판단할 필요가 없다.** 합류가 먼저 앉고, 그래도
  // 자리가 없으면 그건 모듈에 **진짜로** 자리가 없는 것이라 정직하게 포기하면 된다 —
  // 남이 뺏은 것이 아니다. (2026-09-04 사장님과 정한 기준.)
  const mergePairs = pairsOf(toOffsetGroups);
  const queue: Link[] = [
    ...[...mergePairs.values()].flatMap((p) => [p.lead, p.follow]),
    ...toOffsetGroups.filter((g) => !(g.sharedLineId && mergePairs.has(g.sharedLineId))),
  ];

  const keep = (g: Link, fp?: LinkFacePlan, tp?: LinkFacePlan, fw: DepthShortage[] = [], tw: DepthShortage[] = []) => {
    groups.push(g); fromPlans.push(fp); toPlans.push(tp); fromWhy.push(fw); toWhy.push(tw);
  };

  /**
   * **레인 공유 — 양끝이 서로 다르게 다뤄진다.**
   *
   * ```
   * 싣는 쪽(from)   벨트 **둘**  — 팔이 각자 먼 레인에 떨궈야 두 레인이 찬다.
   *                 다만 **같은 끝 · 인접 깊이**라야 기둥 끝 바깥 한 행에서 만난다
   * 집는 쪽(to)     벨트 **하나** — 합류한 벨트가 벽의 한 칸으로 들어온다
   * ```
   *
   * 그래서 장부도 둘이다: `sharedFrom` 은 *"둘째 줄이 나란히 앉을 자리"* 를 재고,
   * `sharedTo` 는 *"둘째 줄이 얹힐 벨트"* 를 든다.
   */
  const sharedTo = new Map<string, LinkFacePlan>();
  const sharedFrom = new Map<string, LinkFacePlan>();

  while (queue.length > 0) {
    const g = queue.shift()!;
    const fw: DepthShortage[] = [];
    const tw: DepthShortage[] = [];
    // **놓기 전에 둘 다 물어본다** — `tryLinkFace` 는 장부를 안 건드린다(원자성의 전제다).
    // 합류 쌍은 **양쪽 줄 다** 기둥 끝 포트로 앉힌다(따르는 줄은 포트를 안 갖지만, 같은 끝·
    // 같은 `topT` 규약을 써야 방출이 합류 칸을 계산할 수 있다).
    const pair = g.sharedLineId !== undefined ? mergePairs.get(g.sharedLineId) : undefined;
    const inPair = pair !== undefined;
    // **이끄는 줄이 이미 앉았으면 그 면·깊이를 물려받는다** — 배정 순서가 쌍을 붙여 놓았으므로
    // 따르는 줄 차례엔 반드시 있다(없으면 이끄는 줄이 도형을 못 세운 것이라 짝도 아니다).
    const fromPartner = g.sharedLineId !== undefined ? sharedFrom.get(g.sharedLineId) : undefined;
    let candFrom = tryLinkFace(
      fromSeat.ctx, g, "from", "W", false, fw, inPair, pair?.end, fromPartner?.clusterBeltDepth,
    );

    // **싣는 쪽 — 짝의 둘째 줄은 첫 줄과 같은 끝을 써야 한다.**
    //
    // 출구 합류는 기둥 끝 **바깥 한 행**에서 일어난다(`emitOutputLinks`). 두 줄이 서로 다른
    // 끝으로 나가면 그 행에서 만날 수가 없다. 그런데 기둥 끝 장부(`ctx.ends`)는 기본적으로
    // **반대 끝**을 준다(먼저 앉은 줄이 N 을 잡으면 다음은 S) — 그래서 여기서 덮어쓴다.
    //
    // 깊이가 **인접**하지 않거나 면이 다르면 그 도형이 안 선다 → **짝을 푼다.**
    // (배정 단계라 아직 풀 수 있다 — 납품이 하나로 접히는 것은 이 뒤다.)
    let merged: Record<string, never> | undefined;
    if (candFrom && fromPartner) {
      // **같은 면 · 같은 깊이 · 끝이 있다.** 구간 줄 둘은 구간이 안 겹쳐 **한 깊이를 나눠
      // 쓴다** — 그래서 같은 열에 위/아래로 쌓이고, 따르는 줄이 그 열 밖(깊이 +2)으로
      // 비켜 이끄는 줄의 합류 칸까지 올라온다.
      const ok =
        candFrom.face === fromPartner.face
        && fromPartner.portEnd !== undefined
        && candFrom.portEnd !== undefined // 끝을 아예 못 받으면(양쪽 다 찼다) 기하가 없다
        && candFrom.clusterBeltDepth === fromPartner.clusterBeltDepth;
      if (ok) {
        // **같은 끝으로 나가야 한 행에서 만난다** — 끝 장부는 기본적으로 반대 끝을 준다.
        candFrom = { ...candFrom, portEnd: fromPartner.portEnd };
        merged = {};
      } else {
        g.sharedLineId = undefined;
        recordLaneUnshare("shape");
      }
    }

    /**
     * **이 줄이 지금도 짝의 이끄는 쪽인가** — 커밋 **직전에** 다시 묻는다.
     *
     * `inPair` 는 큐를 세울 때의 사실이라 그 뒤 짝이 풀렸어도(`g.sharedLineId = undefined`)
     * 참으로 남는다. 그 값으로 `mergeLead` 를 주면 **합칠 상대가 없는데 합류 도형을 청구**
     * 하고, 방출은 신원이 지워졌으니 평범한 도형을 놓아 둘이 갈린다(2026-09-12 F2 와 같은 뿌리).
     *
     * 기하가 안 서는 경우도 여기서 걸러 낸다 — 끝을 못 받았거나 gap 면이면 합류 칸이 설 자리가
     * 없다. 그래야 방출이 [LinkFacePlan.mergeRole] 하나만 보고 따를 수 있다.
     */
    const leadNow = (): boolean =>
      g.sharedLineId !== undefined && mergePairs.has(g.sharedLineId)
      && candFrom !== undefined && candFrom.portEnd !== undefined
      && candFrom.face !== "N" && candFrom.face !== "S";

    // **집는 쪽 — 짝의 둘째 줄은 자리를 안 고른다.** 첫 줄이 잡은 벨트에 좌석만 얹는다.
    const partner = g.sharedLineId !== undefined ? sharedTo.get(g.sharedLineId) : undefined;
    if (candFrom && partner) {
      const onShared = seatOnSharedBelt(toSeat.ctx, g, "to", partner);
      if (onShared) {
        keep(g, commitLinkFace(fromSeat.ctx, candFrom, "from", { merged, mergeLead: !merged && leadNow() }), onShared);
        continue;
      }
      // 좌석이 모자라다 — **짝을 푼다.** 반쪽만 공유된 상태를 남기지 않는다.
      g.sharedLineId = undefined;
      recordLaneUnshare("seats");
    }

    const candTo = tryLinkFace(toSeat.ctx, g, "to", "E", false, tw);
    if (candFrom && candTo) {
      const toPlan = commitLinkFace(toSeat.ctx, candTo, "to");
      const fromPlan = commitLinkFace(fromSeat.ctx, candFrom, "from", { merged, mergeLead: !merged && leadNow() });
      if (g.sharedLineId !== undefined && !sharedTo.has(g.sharedLineId)) {
        sharedTo.set(g.sharedLineId, toPlan); // 첫 줄 — 다음 줄이 이 벨트에 얹힌다
        sharedFrom.set(g.sharedLineId, fromPlan); // 〃 — 다음 줄이 이 옆에 나란히 앉는다
      }
      keep(g, fromPlan, toPlan);
      continue;
    }

    // **구간막힘이면 그 자리에서 쪼갠다**(Step 3). 막힌 쪽에서 자른다 — 자름의 경계는
    // 그 쪽 모듈의 행이므로 `rowsPerMachine` 도 그 쪽 것이다.
    if (opts.split && budget > 0) {
      const cut = !candTo
        ? { side: "to" as const, rows: cutRows(tw), h: toSeat.ctx.machine.h }
        : { side: "from" as const, rows: cutRows(fw), h: fromSeat.ctx.machine.h };
      if (cut.rows.length > 0) {
        const parts = splitLinkAtRows(g, cut.side, cut.rows, cut.h);
        if (parts.length > 1) {
          budget -= parts.length;
          splits += parts.length - 1;
          queue.unshift(...parts); // 토막을 **앞에** 넣어 이어서 앉힌다 — 되돌리기가 없다
          continue;
        }
      }
    }

    // 넘침 — 선호 면이 빈손이면 다른 면을, 역시 **양끝 함께**.
    const spilled = spillPair(fromSeat, toSeat, g);
    if (spilled) { keep(g, spilled.from, spilled.to); continue; }
    keep(g, undefined, undefined, fw, tw); // 정직하게 자리 없음
  }
  return { groups, fromPlans, toPlans, fromWhy, toWhy, splits };
}

/** 후보들 중 **쪼개면 실제로 앉는** 첫 경계. 없으면 빈 배열([resolveSpanBlock]). */
function cutRows(why: readonly DepthShortage[]): number[] {
  for (const r of why) {
    if (!r.blockedRows?.length || !r.seatRows?.length) continue;
    const worth = resolveSpanBlock(r.seatRows, r.blockedRows);
    if (worth.length > 0) return worth;
  }
  return [];
}

/**
 * 넘침 — 선호 면이 안 되면 다른 면을 본다. 면 순서는 옛 축과 같다
 * (출력 `["W","S","N"]` · 입력 `["E","S","N"]`) — 선호 면이 다시 들어 있는 것은 그 면이
 * 유체 면이면 1단계가 비켜 갔기 때문이다(`allowPipeFace`).
 */
function spillPair(
  fromSeat: LinkFaceStage,
  toSeat: LinkFaceStage,
  g: Link,
): { from: LinkFacePlan; to: LinkFacePlan } | undefined {
  // **반대 옆면은 gap 앞에 온다** — gap 은 기둥을 벌려 모듈을 키우지만(`gapRowsFromPlans`)
  // 반대 면은 안 키운다. 그 순서는 자매 경로가 자기 줄에 이미 쓰는 것과 같다
  // (`planModulePorts`: `["E","W","S","N"]` · `["W","E","S","N"]`).
  //
  // **끄면 오늘 동작 그대로다** — 기전: `false` 면 배열이 옛 상수와 글자 그대로 같아,
  // 반대 면을 후보로 **한 번도 안 물어본다**([tryLinkFace] 호출 자체가 안 생긴다).
  //
  // 이 분기가 **켜졌는데 납품이 깨지면** `tempPlanDocs/부분-링크/judgements.md` **J14** 를
  // 본다 — 그 대가를 재는 것이 이 플래그의 존재 이유다(2026-08-05 실측: 자매 경로에서
  // W 로 밀린 자식-공급 입력의 납품 1건이 실패했다).
  const both = AUTO_LAYOUT_LINK_OPPOSITE_FACE;
  const OUT: readonly PortFace[] = both ? ["W", "E", "S", "N"] : ["W", "S", "N"];
  const IN: readonly PortFace[] = both ? ["E", "W", "S", "N"] : ["E", "S", "N"];
  for (const ff of OUT) {
    const candFrom = tryLinkFace(fromSeat.ctx, g, "from", ff, true);
    if (!candFrom) continue;
    for (const tf of IN) {
      const candTo = tryLinkFace(toSeat.ctx, g, "to", tf, true);
      if (!candTo) continue;
      return {
        from: commitLinkFace(fromSeat.ctx, candFrom, "from"),
        to: commitLinkFace(toSeat.ctx, candTo, "to"),
      };
    }
  }
  return undefined;
}

/** [seatLinkEdge] 의 산출 — **`groups` 가 그 간선의 최종본**이다(쪼개졌으면 토막). */
export interface EdgeSeatResult {
  groups: Link[];
  fromPlans: (LinkFacePlan | undefined)[];
  toPlans: (LinkFacePlan | undefined)[];
  fromWhy: DepthShortage[][];
  toWhy: DepthShortage[][];
  /** 쪼갠 횟수(진단). */
  splits: number;
}

/**
 * **무대의 사본** — `gen` 이 여러 번 돌 때 **꼭 필요하다.**
 *
 * 배정(①)은 `P0b` 에서 한 번 끝나지만, `planModulePorts` 의 ③′(기계별 포트)가 **같은
 * 좌석표에 이어서 앉는다.** 그래서 무대를 그대로 재사용하면 두 번째 `gen` 이
 * **①이 아니라 ①+③′ 이 앉은 표**를 보고 시작해 자리가 조용히 줄어든다.
 *
 * 2026-08-29 에 실제로 그렇게 깨졌다 — 21개 테스트가 *"인서터 수 ≠ 줄 수"* 로 떨어졌다.
 * [FaceTable] 이 값인 것([copyFaceTable])이 이 사본을 싸게 만든다.
 *
 * `out`/`in` 의 [LinkFacePlan] 은 확정된 결과라 **참조로 나눠 쓴다**(아무도 안 고친다).
 */
export function cloneLinkFaceStage(stage: LinkFaceStage): LinkFaceStage {
  const tables = new Map([...stage.tables].map(([f, t]) => [f, copyFaceTable(t)] as const));
  const ends = new Map([...stage.ctx.ends].map(([f, set]) => [f, new Set(set)] as const));
  const outside = new Map([...stage.ctx.outside].map(([f, set]) => [f, new Set(set)] as const));
  return {
    ...stage,
    tables,
    ctx: { ...stage.ctx, tables, ends, outside },
    out: { ...stage.out, plans: [...stage.out.plans], deferred: [...stage.out.deferred] },
    in: { ...stage.in, plans: [...stage.in.plans], deferred: [...stage.in.deferred] },
  };
}

/**
 * 모듈 하나의 포트 계획 — ⓪①은 [planLinkFaces] 가 이미 끝낸 것을 **받는다.**
 *
 * `stage` 를 안 주면 여기서 직접 돌린다 — 그랬면 옆 경로(모듈 안에서 배정)가 생기는 게
 * 아니라 **같은 함수를 같은 인자로** 부를 뿐이라 답이 같다(테스트·단독 호출용).
 */
export function planModulePorts(
  input: ModulePortPlannerInput,
  count: number,
  stage?: LinkFaceStage,
): ModulePortPlan {
  const plannerInserters = input.inserters;
  const st = stage ?? planLinkFaces(input, count);
  const { ctx: faceCtx, outLinks, inLinks, isJumpableToClusterPipe } = st;
  const outFaces = st.out;
  const inFaces = st.in;

  // 링크가 맡은 줄은 **자기 기하를 스스로 갖는다**(emitOutputLinks/emitInputLinks) — 그래서
  // ③의 tap/direct 판정 대상이 아니다. ③ 입력에서 빼되, 그 줄이 먹은 좌석은 ①의 장부에
  // 남아 있어 ③이 정확한 예산을 본다. 빼지 않으면 두 문제가 생긴다:
  //  ① 링크 줄이 좌석을 넘겨 ③이 direct 로 떨어지면, 링크 방출이 안 불려 포트가 통째로
  //     사라진다(자식 direct + 부모 tap → 포트 모양이 어긋나 납품 경로가 샌다 — 2026-07-19 실측).
  //  ② ③이 이미 링크가 찜한 자리를 또 배정해 셀이 겹친다.
  const linkedKeys = new Set([
    ...outLinks.map((g) => `output:${g.item}`),
    ...inLinks.map((g) => `input:${g.item}`),
  ]);

  // ── ② 유체(pipe) 줄 — 면을 우리가 못 고른다 ────────────────────────────────
  // 머신 fluid_box 가 강제하고 [FluidTrunkInput.lines] 로 **줄마다** 온다(면·행·순번). 그래서
  // ③에 안 보내고 여기서 [PlannedLine] 을 만든다(depth=1, reach 없음). ③의 **케이스 B 아이템
  // 예약은 그대로**다 — 아래 `pipeFaces` 로 그 면 아이템을 깊이로 밀 뿐, 유체 **줄**은 안 본다.
  const pipeLines = input.lines.filter((l) => l.kind === "pipe");
  const pipePlanned: PlannedLine[] = [];
  // 유체는 트렁크(tap)로만 성립한다 — 배정을 못 받은 유체 줄이 하나라도 있으면 통째로
  // 정직히 실패한다. 반만 놓으면 유체를 못 받는 머신이 **조용히 굶는다.**
  let fluidCannotPlace = false;
  for (const line of pipeLines) {
    const assigned = fluidLineOf(input.fluidTrunk, line);
    if (!assigned) {
      fluidCannotPlace = true;
      continue;
    }
    pipePlanned.push({ line, side: assigned.side, clusterBeltDepth: 1, reach: undefined });
  }

  // ── ③ 나머지 줄 배정 — ①이 남긴 예산 안에서 ──────────────────────────────
  //
  // **여기 있던 [insertingPlanner] 호출은 사라졌다**(2026-09-02). 그것이 내던 것은 모듈
  // 하나의 라벨(`tap`/`direct`)과 사유 문장이었는데, 배치 흐름에는 그 라벨로 갈리는 분기가
  // 하나도 없었고(방출 통합 2026-08-16), `g` 는 깊이 예산이 정하고(⑤-2), 화면의 처방은
  // 사실에서 나온다([unpourableFix]·[DepthShortage]). 남은 독자가 0이 되어 지웠다.
  const restLines = input.lines.filter(
    (l) => l.kind !== "pipe" && !linkedKeys.has(`${l.role}:${l.name}`),
  );

  // ── ③′ (나) 기계별 포트 — **링크와 같은 배분기로** ────────────────────────────
  //
  // 탭이 안 되면 예전엔 `insertingPlanner` 가 자기 rim 모델로 자리를 잡았다. 그 모델은 W/E
  // 두 면만 봤고, 그래서 두 면이 차면 **거기서 끝**이었다. 같은 일을 하는 링크 배분기는
  // 이미 위/아래(gap)로 넘길 줄 아는데(가로 벨트 + gap 벌리기), 원료 줄이 *"이 벨트는 전
  // 머신 담당"* 이라고 적혀 나와 [tryLinkFace] 의 문턱(`arms.size !== 1`)에 걸렸을 뿐이다.
  //
  // **머신마다 하나씩 쪼개면 그대로 통과한다** — 그리고 쪼갠 그룹이 곧 "기계별 포트" 다.
  // 두 개념이 아니라 같은 것의 두 이름이라, 여기서 하나로 만난다.
  //
  // 면 순서: 선호 면 → **반대 면** → gap. gap 은 모듈을 세로로 벌리므로([gapRowsFromPlans])
  // 반대 면에 빈 행이 있는데 넘기면 순수한 손해다. 이 순서라서 *"오늘 W/E 에 앉는 것은
  // 그대로 W/E 에 앉는다"* 가 지켜진다.
  // **탭도 이 경로를 탄다**(2026-08-16 — 계획서 §19-④). 예전엔 `mode === "direct"` 일 때만
  // 만들었고, 탭은 `emitTapInserting` 이라는 **두 번째 트렁크 기하**를 따로 갖고 있었다.
  // [tryLinkFace] 의 `arms.size !== 1` 문턱이 풀린 지금(§19-①) 묶은 그룹이 그대로 앉으므로
  // 갈래를 둘 이유가 없다 — 트렁크 기하를 아는 코드가 **한 곳**이 된다(R3).
  //
  // 모드가 남기는 것은 **쪼개기 여부** 하나뿐이다: 탭이면 묶은 그룹(벨트 하나가 전 머신),
  // 다이렉트면 머신마다 하나. 그 둘은 `g = N` 과 `g = 1` 이라는 **같은 축의 두 끝**이다(§16).
  /**
   * **어느 줄이 `g = 1` 로 내려가야 하나** — [planBundles] 가 **깊이 예산**으로 정한다
   * (`docs/auto-layout/module/trunk-assignment.md` §4.2). 기본값은 *"공짜일 때만 관통"* 이다.
   *
   * ```
   * 면 f:   (g>1 줄 수)  +  (g=1 줄이 있으면 1)   ≤   R_f
   * ```
   *
   * **예전엔 이 답을 `supply`(= `planClusterPorts`)가 냈다.** 그쪽은 지도가 달라서
   * (면 단위 슬롯 풀, 머신 축 없음) *"이 모듈은 다이렉트"* 라는 **모듈 단위 라벨**밖에 못
   * 냈고, 2026-08-31 에 줄 단위(`overflowed`)로 폈지만 여전히 **깊이를 안 셌다** —
   * 관통이 깊이를 통째로 먹는다는 것을 모른다. 그래서 한 줄이 관통을 사면 나머지가
   * 자리를 잃는 일이 조용히 났다(2026-09-01 실측: battery 에서 copper-plate 가 못 앉았다).
   *
   * 이제 **같은 지도**(`FaceTable`·[clusterBeltDepthsOf])가 낸 수로 정한다. `supply` 는 2026-09-02 에
   * 지도 A 와 함께 삭제됐다 — `g` 를 정하는 곳은 [planBundles] **하나**다.
   */
  const restByPriority = [
    ...restLines.filter((l) => l.role === "output"),
    ...restLines.filter((l) => l.role === "input" && !l.external),
    ...restLines.filter((l) => l.role === "input" && l.external),
  ];
  const bundleByKey = planBundles({
    lines: restByPriority,
    count,
    lineRates: input.supplyCapacity?.lineRates,
    belts: input.belts,
    depthsOf: (face) => clusterBeltDepthsOf(faceCtx, face).length,
    // **①이 먼저 먹은 깊이** — 링크는 자기 기하를 스스로 갖고 이미 앉았다. 좌석을
    // `seatRowsUsed` 로 넘기는 것과 같은 이유로, 깊이도 넘겨야 예산이 참이 된다.
    taken: (face) => {
      let spanning = 0;
      let direct = false;
      for (const p of [...outFaces.plans, ...inFaces.plans]) {
        if (!p || p.face !== face) continue;
        if (p.arms.size > 1) spanning++;
        else direct = true;
      }
      return { spanning, direct };
    },
  });

  const restLinks = (() => {
        // **줄마다 따로 붓는다** — 묶음 크기가 줄마다 다르기 때문이다.
        const groups = restLines.flatMap((line) =>
          externalLineGroups([line], count, input.supplyCapacity ?? {}, input.inserters, undefined, {
          // **넘친 줄만 `g = 1` 로 내린다** — 계산이 이미 *어느 줄이* 자리를 못 찾았는지 안다.
          //
          // 예전엔 `perMachine: supply.mode !== "tap"` 이라 **한 줄이 안 되면 그 모듈의
          // 모든 줄**이 `g = 1` 로 떨어졌다. 계산은 옳았고 **산출의 낟알이 틀렸다** —
          // `planClusterPorts` 가 `overflowed` 로 줄 이름을 들고 있는데 모듈 라벨 하나로
          // 접혀 나왔다. (그 파일은 2026-09-02 에 지워졌다 — 여기 남은 것은 *왜 낟알이
          // 줄 단위여야 하는가* 의 근거다.)
          //
          // `g = 1` 이 처방인 이유: 그 줄은 **gap(N/S)으로 가야** 하고, 오늘 gap 은
          // `machinesOn !== 1` 이라 한 대짜리 그룹만 받는다([tryLinkFace]).
          // 넘치지 않은 줄은 처리량이 준 `g` 를 그대로 쓴다 — **부분 트렁크가 살아 있다.**
            bundle: bundleByKey.get(`${line.role}:${line.name}`),
            belts: input.belts,
          // **좌석 상한의 재료** — 이걸 안 주면 바깥 줄이 좌석을 안 보고 묶여, 팔이 면에
          // 안 들어가는 줄이 나서 배정에서 통째로 떨어진다(2026-08-23 실측: 40/s 원료 줄이
          // 팔 9개짜리 한 줄로 나 3칸 면에 못 앉았다).
            machineFaceCells: input.machine.h,
          }));
        const lineOfKey = new Map(restLines.map((l) => [`${l.role}:${l.name}`, l]));
        const isExternal = (g: Link): boolean =>
          lineOfKey.get(`${readLinkRole(g)}:${g.item}`)?.external ?? false;
        const out = groups.filter((g) => readLinkRole(g) === "output");
        // **입력 처리 순서: 자식-공급(내부 간선) 먼저, external(원료) 나중.**
        // 넘칠 때 **누가 반대 면으로 밀려나느냐**가 갈리기 때문이다. 자식-공급 입력이 W(부모
        // 반대편)로 밀려나면 그 줄의 납품 경로가 모듈을 **빙 돌아야** 하고, 실제로 길이 막힌다
        // (2026-08-05 실측: 통합 직후 이 순서를 빠뜨려 x 입력이 W 로 밀렸고 납품 1건이 실패했다).
        // external 입력은 납품 경로가 없다 — perimeter 로 나가면 그만이라 어느 면이든 안전하다.
        // 그래서 밀려날 자격이 있는 건 external 쪽이다(제약 센 것에 좋은 자리를 먼저).
        const inFed = groups.filter((g) => readLinkRole(g) === "input" && !isExternal(g));
        const inRaw = groups.filter((g) => readLinkRole(g) === "input" && isExternal(g));
        const outPlans = allocateLinkFaces(faceCtx, out, "from", "W");
        const fedPlans = allocateLinkFaces(faceCtx, inFed, "to", "E");
        const rawPlans = allocateLinkFaces(faceCtx, inRaw, "to", "E");
        // 넘치면 **반대 면 → gap** 순. 옛 rim 배분기가 쓰던 순서 그대로이고(출력 W→E,
        // 입력 E→W), gap 만 **새 마지막 수단**으로 붙였다 — 그래서 오늘 W/E 에 앉던 줄은
        // 그대로 W/E 에 앉고, 예전 같으면 자리가 없어 실패하던 것만 gap 으로 간다.
        // (반대 면이 나쁜 자리인 것은 맞지만 그 완화는 **순서**가 한다: 위에서 자식-공급을
        //  먼저 앉혀 밀려나는 쪽이 원료가 되게 했다. 금지하면 gap 이 아무 때나 벌어진다.)
        // 순서: **반대 면 → 선호 면 재시도(유체 허용) → gap.** 반대 면은 공짜지만 유체 면은
        // 앉는 순간 파이프가 물러나 폭을 먹고([tryLinkFace]), gap 은 기둥을 벌린다.
        // 선호 면이 유체가 아니면 재시도는 그냥 한 번 더 실패할 뿐이라 해가 없다.
        spillLinkFacesToGap(faceCtx, out, "from", outPlans, ["E", "W", "S", "N"]);
        spillLinkFacesToGap(faceCtx, inFed, "to", fedPlans, ["W", "E", "S", "N"]);
        // **원료 입력만 노출 끝면을 먼저 본다**([[ns-face-relief]] — `E → N/S → W`).
        // W 는 부모 쪽이라 납품 경로와 자리를 다투는데, `nsExposure` 면은 클러스터 **밖**이라
        // 공짜다. 그 완화가 옛 `insertingPlanner.nsFaces` 에만 있어서 아이템 방출이 링크
        // 경로로 합쳐질 때 함께 사라질 뻔했다(2026-08-17).
        spillLinkFacesToGap(faceCtx, inRaw, "to", rawPlans, [
          ...(input.nsExposure ?? []), "W", "E", "S", "N",
        ]);
        return {
          out: { groups: out, plans: outPlans.plans, shortages: outPlans.shortages },
          in: {
            groups: [...inFed, ...inRaw],
            plans: [...fedPlans.plans, ...rawPlans.plans],
            shortages: [...fedPlans.shortages, ...rawPlans.shortages],
          },
        };
      })();

  /** 실제로 줄이 난 나머지 줄들 — 이 집합에 없는 나머지 줄이 [unpourableLines] 다. */
  const pouredKeys = new Set(
    [...restLinks.out.groups, ...restLinks.in.groups].map((g) => `${readLinkRole(g)}:${g.item}`),
  );
  const unpourable = restLines.filter(
    (l) => l.kind === "belt" && !pouredKeys.has(`${l.role}:${l.name}`),
  );
  // **처방은 여기서 난다** — [ModulePortPlan.unpourableFix]. 붓기가 빈 손으로 돌아오는 원인
  // 셋을 같은 입력으로 되짚는다(`externalLineGroups` 의 `pour` 와 **같은 세 물음**이다).
  const unpourableFix = new Map<string, "belt" | "inserter">();
  for (const l of unpourable) {
    const key = `${l.role}:${l.name}`;
    const rate = input.supplyCapacity?.lineRates?.get(key);
    if (rate === undefined) continue; // 수량 미상 — 위저드 단계로 못 보낸다
    if (!inserterForReach(input.inserters, 1)) {
      unpourableFix.set(key, "inserter");
      continue;
    }
    if (determineBeltCount(rate, [...(input.belts ?? [])]).length === 0)
      unpourableFix.set(key, "belt");
  }

  // ── 계측 — **관측만 한다**(계산도 분기도 반환값도 안 바꾼다) ──────────────────
  // 형태는 산출물 어디에도 안 남아서, glass 54줄(필요 5줄)을 사후에 손으로 세야 했다.
  // 내부 링크는 `modulePacking` 이 따로 센다 — 여기는 **외부 줄**(원료·완제품) 몫이다.
  // 싱크에 직접 쓰는 것은 `moduleWizard` 가 이미 하는 일과 같은 관용구다(runStats 머리말).
  // **면 깊이 계측** — 설계는 `docs/auto-layout/module/module-planning.md §4.5`.
  // 묻는 것: *"둘째 깊이가 실물에서 쓰이나, 그때 팔 종류가 실제로 갈리나."*
  // 사후에 훑기만 한다 — [clusterBeltDepthsOf] 가 장부를 안 읽어서 배정이 끝난 뒤에도 같은 답이다.
  // (관측만 — 계산·분기·반환값은 안 바뀐다. `runStats` 머리말의 규약.)
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

  // **사다리로 올려 보낼 사유** — 신원이 있는(= 간선인) 줄만. 쪼갬은 양끝이 함께라야 한다.
  const depthShortages = new Map<string, DepthShortage[]>();
  for (const [groups, alloc] of [[outLinks, outFaces], [inLinks, inFaces]] as const) {
    alloc.plans.forEach((p, i) => {
      const id = groups[i]?.id;
      const w = alloc.shortages[i];
      if (p || id === undefined || !w?.length) return;
      depthShortages.set(id, w);
    });
  }

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

  // 유체 줄이 자리를 못 잡으면 나머지 줄이 통째로 실패한다 — 반만 놓으면 유체를 못 받는
  // 머신이 **조용히 굶는다**. 예전엔 여기 `supply.mode === "direct"` 도 함께 있었다: 파이프
  // 방출이 tap 가지 안에만 있어서 1:1 로 물러나면 유체가 사라졌기 때문이다. 방출을 갈래 밖으로
  // 꺼낸 지금([generateModule]) 그 근거가 없다 — 파이프는 두 방식에서 똑같이 깔린다.
  const fluidUnplaceable = pipeLines.length > 0 && fluidCannotPlace;

  return {
    linkFaces: { out: outFaces.plans, in: inFaces.plans },
    restLinks,
    // ── ④ gap 폭 — ①③′의 부산물. 우리가 고르는 값이 아니다.
    rowGaps: gapRowsFromPlans(count, [
      outFaces.plans, inFaces.plans,
      ...(restLinks ? [restLinks.out.plans, restLinks.in.plans] : []),
    ]),
    pipePlanned,
    isJumpableToClusterPipe,
    gapExitSides: gapExitSidesFromPlans(
      [outFaces.plans, ...(restLinks ? [restLinks.out.plans] : [])],
      [inFaces.plans, ...(restLinks ? [restLinks.in.plans] : [])],
    ),
    linkFaceDepths: linkFaceDepths([
      outFaces.plans, inFaces.plans,
      ...(restLinks ? [restLinks.out.plans, restLinks.in.plans] : []),
    ]),
    linkedKeys,
    depthShortages,
    // (나)로 갔으면 [ClusterBelt] 가 하나도 없다 — 줄들은 `restLinks` 가 들고 있고, 못 앉은
    // 그룹의 실패는 링크와 똑같이 **자기 방출에서** 갈린다(그래서 `unplaced` 가 아니다).
    // **아이템 [ClusterBelt] 가 하나도 없다** — 줄들은 전부 `restLinks` 가 들고 있고, 못 앉은
    // 그룹의 실패는 링크와 똑같이 **자기 방출에서** 갈린다(그래서 `unplaced` 가 아니다).
    // 유체가 못 앉으면 나머지 줄도 통째로 실패한다(반만 놓으면 그 머신이 조용히 굶는다).
    // 유체가 못 앉으면 **유체 줄까지** 함께 낸다 — `restLines` 는 파이프를 빼고 걸러진 목록이라
    // 그것만 내면 정작 실패한 유체가 사유에서 사라진다(2026-08-16 회귀).
    // 부을 수 없어 줄이 하나도 안 난 나머지 줄 — **삼키지 않는다**(위 [unpourableLines]).
    unpourableLines: unpourable,
    unpourableFix,
    rest: fluidUnplaceable
      ? { ok: false, unplaced: input.lines.filter((l) => !linkedKeys.has(`${l.role}:${l.name}`)) }
      : { ok: true, lines: [] },
  };
}
