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
 * | [insertingPlanner] | 나머지 줄(원료·완제품)이 앉을 면·레인 | `clusterPortPlanner` |
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
  insertingPlanner,
  type IoLine,
  type PlannedLine,
  type PortSide,
  type InsertingDecisionResult,
} from "./clusterPortPlanner";
import type { ModuleInput } from "../../module/clusterModule";
import { fluidJumpBlocker, fluidLineOf, fluidLinesOnSide, laneDepthCap } from "../../module/fluidPorts";
import { externalLineGroups, readLinkRole, type MachineLinkGroup } from "../../module/machineLinkGroup";
import {
  allocateLinkFaces,
  spillLinkFacesToGap,
  gapRowsFromPlans,
  gapExitSidesFromPlans,
  linkFaceDepths,
  seatRowsByFace,
  type LinkFaceContext,
  type LinkFacePlan,
} from "./linkPlanner";
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
    out: { groups: MachineLinkGroup[]; plans: (LinkFacePlan | undefined)[] };
    in: { groups: MachineLinkGroup[]; plans: (LinkFacePlan | undefined)[] };
  };
  /** 머신 i 와 i+1 사이를 몇 칸 벌릴까 — ①의 부산물. `layoutCluster` 로 그대로 간다. */
  rowGaps: number[];
  /** 나머지 줄의 tap/direct 판정 + 줄별 슬롯. */
  supply: InsertingDecisionResult;
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
}

/**
 * 한 모듈의 포트 자리를 전부 배정한다. `count` 는 호출자가 정규화한 머신 대수
 * (`layoutCluster` 가 만드는 머신 수와 **같아야** 한다 — 배정이 없는 머신을 가리키면 안 된다).
 */
export function planModulePorts(
  input: ModulePortPlannerInput,
  count: number,
): ModulePortPlan {
  // ── ⓪ 유체 면 — **모든 배정보다 먼저** ──────────────────────────────────────
  // 머신 `fluid_boxes` 가 강제하는 값이라 우리가 협상할 수 없다(제약이 가장 센 것 먼저 —
  // 스도쿠 원칙). 그리고 ①도 이 답을 알아야 한다: 유체가 가져간 면에 링크를 앉히면 인서터가
  // 파이프 칸에 선다. 예전엔 ①이 ② 앞에 있어 그 사실을 **모른 채** 배정했다.
  // 슬롯 목록은 **접히지 않고 그대로 온다**(계획서 §18). 예전엔 이진 필드에서 다시 폈다.
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
    beltLanes: Math.min(plannerInserters.length, input.lines.filter((l) => l.kind !== "pipe").length),
  };
  /**
   * 이 면의 **레인 깊이 상한** — 지하파이프 사거리가 정한다([laneDepthCap]). 유체가 없는 면은
   * 상한이 없다. *"사거리가 짧으면 파이프 배치를 우선한다"* 가 이 한 줄이다(2026-08-16).
   */
  const laneCapOf = (side: PortSide): number => {
    const n = fluidLinesOnSide(ft, side).length;
    return n === 0 ? Infinity : laneDepthCap(n, ft?.pipeMaxUndergroundDistance);
  };
  const isJumpableToClusterPipe = (side: PortSide): boolean => {
    const n = fluidLinesOnSide(ft, side).length;
    if (n === 0) return false; // 유체가 없는 면은 점프할 것도 없다.
    return fluidJumpBlocker(n, jumpBudget) === null;
  };
  /** ③ 이 보는 면별 요약 — 유체 행 수와 점프 여부. 없는 면은 목록에 안 넣는다. */
  const pipeFaces = (["W", "E"] as const)
    .map((side) => ({ side, fluidRows: fluidLinesOnSide(ft, side).length, laneCap: laneCapOf(side) }))
    .filter((f) => f.fluidRows > 0);
  /**
   * ① 이 보는 같은 사실 — 다만 **행 번호까지** 필요하다(③ 은 개수만 쓴다). 링크는 점프 면의
   * 유체 상자 행을 건너뛰고 앉아야 하므로 `fluidboxOffset` 을 그대로 넘긴다.
   */
  const pipeFaceRows = new Map<PortFace, { rows: readonly number[]; laneCap: number }>(
    pipeFaces.map((f) => [
      f.side as PortFace,
      { rows: fluidLinesOnSide(ft, f.side).map((l) => l.fluidboxOffset), laneCap: f.laneCap },
    ]),
  );

  // ── ① 링크 면 배정 ─────────────────────────────────────────────────────────
  // 이 단계는 팔 **수**만 본다(좌표 없음). gap 으로 넘어간 그룹은 gap 안에 가로 벨트를 놓고,
  // **gap 폭 = 그 gap 을 지나는 가로 벨트 수**다 — 그 폭이 다시 머신 좌표를 정하므로
  // 좌표보다 면이 먼저다.
  const outLinkGroups = input.outputLinks ?? [];
  const inLinkGroups = input.inputLinks ?? [];
  const faceLedger = new Map<string, number>();
  // 면마다 **그룹이 몇 개** 앉았나 — 막힌 면의 [[ParallelBelt]](몇 번째가 몇 칸 깊이로 달리나)를
  // 순번으로 정한다. 좌석 장부(팔 수)에서 유도되지 않는 별개의 수다.
  const faceGroupLedger = new Map<string, number>();
  // 레인 장부 — 관통 그룹이 그 면의 한 깊이를 통째로 청구한다([LinkFaceContext.lanes]).
  const laneLedger = new Map<string, Array<readonly [number, number]>>();
  const faceCtx: LinkFaceContext = {
    machine: input.machine, count, used: faceLedger, faceGroups: faceGroupLedger, pipeFaces: pipeFaceRows,
    lanes: laneLedger, ends: new Map(), inserters: input.inserters,
  };
  const outFaces = allocateLinkFaces(faceCtx, outLinkGroups, "from", "W");
  const inFaces = allocateLinkFaces(faceCtx, inLinkGroups, "to", "E");
  // 넘침은 나중 — 양쪽의 선호 면 수요가 먼저 자리를 잡은 뒤에 남은 gap 을 다툰다.
  // **선호 면을 다시 넣는 이유**: 그 면이 유체 면이면 위에서 비켜 갔다([tryLinkFace] 의
  // `allowPipeFace`). 넘침 단계는 유체 면을 허용하므로 여기서 한 번 더 기회를 준다 —
  // 유체 면에 앉으면 그 면이 넓어지지만 gap 으로 가면 기둥이 벌어진다. **유체 면이 먼저다.**
  // (반대 옆면은 여전히 안 쓴다 — 벨트가 채널 반대쪽에서 출발해 되돌아올 길이 없다.)
  spillLinkFacesToGap(faceCtx, outLinkGroups, "from", outFaces, ["W", "S", "N"]);
  spillLinkFacesToGap(faceCtx, inLinkGroups, "to", inFaces, ["E", "S", "N"]);

  // 링크가 맡은 줄은 **자기 기하를 스스로 갖는다**(emitOutputLinks/emitInputLinks) — 그래서
  // ③의 tap/direct 판정 대상이 아니다. ③ 입력에서 빼되, 그 줄이 먹은 좌석은 ①의 장부에
  // 남아 있어 ③이 정확한 예산을 본다. 빼지 않으면 두 문제가 생긴다:
  //  ① 링크 줄이 좌석을 넘겨 ③이 direct 로 떨어지면, 링크 방출이 안 불려 포트가 통째로
  //     사라진다(자식 direct + 부모 tap → 포트 모양이 어긋나 납품 경로가 샌다 — 2026-07-19 실측).
  //  ② ③이 이미 링크가 찜한 자리를 또 배정해 셀이 겹친다.
  const linkedKeys = new Set([
    ...outLinkGroups.map((g) => `output:${g.item}`),
    ...inLinkGroups.map((g) => `input:${g.item}`),
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
  // 보장된 columnTapCapacity 슬롯을 줄마다 1:1 못박는다(natural-divergence 대체).
  // 각 줄 → {면 W/E, 레인 near/far, 인서터}. 결과 순서가 곧 처리 순서(입력 먼저·near 면부터).
  // complex(과용량·무인서터)면 전부 위임. 트렁크로 합칠 수 있으면 "tap", 안 되면 "direct"(1:1)
  // — 거절은 **항상 안전**하다: 1:1 은 구성으로 성립한다.
  //
  // 좌석 행 수(면의 둘레 칸)는 [insertingPlanner] 의 **자기 인자**로 준다. 이 수는 방출 루프의
  // `lateral`(슬롯 상한)과 **같아야** 한다 — 어긋나면 없는 자리를 배정하거나 있는 자리를
  // 안 쓴다. (용어: docs/용어사전.md §D)
  //
  // **`seatRowsUsed` 는 계층을 건너는 통보가 아니라 ① → ③ 의 내부 전달이다.** 두 배정의
  // 장부 낟알이 다르기 때문에 Map 을 그대로 넘기지는 못한다 — ①은 (머신,면)마다 세고
  // ③은 면마다 센다(모든 머신이 같은 행을 쓰는 것이 ③의 모델이다). [seatRowsByFace] 가
  // 머신 축을 max 로 접어 그 낟알 차이를 흡수한다.
  const restLines = input.lines.filter(
    (l) => l.kind !== "pipe" && !linkedKeys.has(`${l.role}:${l.name}`),
  );
  const supply: InsertingDecisionResult = insertingPlanner(
    {
      lines: restLines,
      inserters: plannerInserters,
      outputSide: "W" as const, // 좌우 계층형: 부모=좌=W. 출력을 W 에 먼저 확정((B) 정책).
      nsFaces: input.nsExposure, // 노출 끝면 — external 입력의 W-spill 완화(E→N/S→W).
      seatRowsUsed: seatRowsByFace(faceLedger), // ①이 먼저 먹은 행
      pipeFaces, // 유체가 붙는 면들 + 그 면의 유체 행 수·점프 여부.
      belts: input.belts,
    },
    count,
    { WE: input.machine.h, NS: input.machine.w },
    input.supplyCapacity,
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
  const restLinks = (() => {
        const groups = externalLineGroups(restLines, count, input.supplyCapacity ?? {}, input.inserters, undefined, {
          perMachine: supply.mode !== "tap",
        });
        const lineOfKey = new Map(restLines.map((l) => [`${l.role}:${l.name}`, l]));
        const isExternal = (g: MachineLinkGroup): boolean =>
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
          out: { groups: out, plans: outPlans.plans },
          in: { groups: [...inFed, ...inRaw], plans: [...fedPlans.plans, ...rawPlans.plans] },
        };
      })();

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
    supply,
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
    // (나)로 갔으면 [ClusterBelt] 가 하나도 없다 — 줄들은 `restLinks` 가 들고 있고, 못 앉은
    // 그룹의 실패는 링크와 똑같이 **자기 방출에서** 갈린다(그래서 `unplaced` 가 아니다).
    // **아이템 [ClusterBelt] 가 하나도 없다** — 줄들은 전부 `restLinks` 가 들고 있고, 못 앉은
    // 그룹의 실패는 링크와 똑같이 **자기 방출에서** 갈린다(그래서 `unplaced` 가 아니다).
    // 유체가 못 앉으면 나머지 줄도 통째로 실패한다(반만 놓으면 그 머신이 조용히 굶는다).
    // 유체가 못 앉으면 **유체 줄까지** 함께 낸다 — `restLines` 는 파이프를 빼고 걸러진 목록이라
    // 그것만 내면 정작 실패한 유체가 사유에서 사라진다(2026-08-16 회귀).
    rest: fluidUnplaceable
      ? { ok: false, unplaced: input.lines.filter((l) => !linkedKeys.has(`${l.role}:${l.name}`)) }
      : { ok: true, lines: [] },
  };
}
