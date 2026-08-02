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
  type InsertingDecisionResult,
} from "./clusterPortPlanner";
import type { SpecInserter } from "../../buildSpec";
import type { ModuleInput } from "../../module/clusterModule";
import {
  allocateLinkFaces,
  spillLinkFacesToGap,
  gapRowsFromPlans,
  seatRowsByFace,
  type LinkFacePlan,
} from "./linkPlanner";

/**
 * 계획에 필요한 [ModuleInput] 조각 — **좌표·id 접두사·방출 취향은 안 본다.**
 * (`idPrefix`·`lineEnds` 가 빠져 있는 것이 의도다: 전자는 방출 이름, 후자는 트렁크 기하다.)
 */
export type ModulePortPlannerInput = Pick<
  ModuleInput,
  | "machine"
  | "lines"
  | "inserterEntityName"
  | "longInserter"
  | "throughput"
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
  /** 머신 i 와 i+1 사이를 몇 칸 벌릴까 — ①의 부산물. `layoutCluster` 로 그대로 간다. */
  rowGaps: number[];
  /** 나머지 줄의 tap/direct 판정 + 줄별 슬롯. */
  supply: InsertingDecisionResult;
  /** 유체 줄의 배정 — 면은 머신이 강제하므로 planner 를 안 거치고 여기서 찍는다. */
  pipePlanned: PlannedLine[];
  /** 유체 면에서 파이프가 좌석을 비우고 밖으로 점프할 수 있나. 방출 기하가 이 값에 갈린다. */
  isJumpableToClusterPipe: boolean;
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
  const outFaces = allocateLinkFaces(input.machine, count, outLinkGroups, "from", "W", faceLedger, faceGroupLedger);
  const inFaces = allocateLinkFaces(input.machine, count, inLinkGroups, "to", "E", faceLedger, faceGroupLedger);
  // 넘침은 나중 — 양쪽의 선호 면 수요가 먼저 자리를 잡은 뒤에 남은 gap 을 다툰다.
  spillLinkFacesToGap(input.machine, count, outLinkGroups, "from", faceLedger, outFaces, faceGroupLedger);
  spillLinkFacesToGap(input.machine, count, inLinkGroups, "to", faceLedger, inFaces, faceGroupLedger);

  // 링크가 맡은 줄은 **자기 기하를 스스로 갖는다**(emitOutputLinks/emitInputLinks) — 그래서
  // ③의 tap/direct 판정 대상이 아니다. ③ 입력에서 빼되, 그 줄이 먹은 좌석은 ①의 장부에
  // 남아 있어 ③이 정확한 예산을 본다. 빼지 않으면 두 문제가 생긴다:
  //  ① 링크 줄이 좌석을 넘겨 ③이 direct 로 떨어지면, 링크 방출이 안 불려 포트가 통째로
  //     사라진다(자식 direct + 부모 tap → 포트 모양이 어긋나 홉이 샌다 — 2026-07-19 실측).
  //  ② ③이 이미 링크가 찜한 자리를 또 배정해 셀이 겹친다.
  const linkedKeys = new Set([
    ...outLinkGroups.map((g) => `output:${g.item}`),
    ...inLinkGroups.map((g) => `input:${g.item}`),
  ]);

  // ── ② 유체(pipe) 줄 — 면을 우리가 못 고른다 ────────────────────────────────
  // 머신 fluid_box 가 강제하고 [ModuleInput.fluidTrunk].side 로 온다. 그래서 ③에 안 보내고
  // 여기서 [PlannedLine] 을 만든다([planClusterPorts] 가 하던 stamping 을 옮김:
  // side=fluidTrunk.side, depth=1, reach 없음). ③의 **케이스 B 아이템 예약은 그대로**다 —
  // fluidTrunk.side 를 pipeSide 로 따로 받아 그 면 아이템을 깊이로 밀 뿐, 유체 **줄**은 안 본다.
  const pipeLines = input.lines.filter((l) => l.kind === "pipe");
  const pipePlanned: PlannedLine[] = input.fluidTrunk
    ? pipeLines.map((line) => ({
        line,
        side: input.fluidTrunk!.side,
        clusterBeltDepth: 1,
        reach: undefined,
      }))
    : [];
  // 유체는 트렁크(tap)로만 성립한다 — 자리가 아예 없으면(트렁크 미해결·다중 유체 v1 밖)
  // 통째로 정직히 실패한다(현행 보존: 예전엔 planner 가 complex→다이렉트→!plan.ok 로
  // 전부 unrouted 였다).
  const fluidCannotPlace = pipeLines.length > 0 && (!input.fluidTrunk || pipeLines.length > 1);

  // ModuleInput 의 이진 인서터 필드(reach 1 기본 + 긴팔 하나)를 ③이 먹는 reach 목록으로
  // 번역한다. ③은 서로 다른 reach 하나당 [ClusterBelt] 한 줄을 세운다 — 지금은 최대 2종
  // (1·긴팔)이라 옛 동작과 동일하지만, 여기 목록이 늘면 벨트 줄도 는다.
  // (BuildSpec.inserters 를 ModuleInput 까지 직접 통과시키는 일은 후속.)
  const plannerInserters: SpecInserter[] = [
    { entityName: input.inserterEntityName, reach: 1, throughput: input.throughput?.normal ?? 0 },
    ...(input.longInserter
      ? [{
          entityName: input.longInserter.entityName,
          reach: input.longInserter.reach,
          throughput: input.throughput?.long ?? 0,
        }]
      : []),
  ];
  // [isJumpableToClusterPipe] — "유체 면에서 파이프가 좌석을 비우고 밖으로 점프할 수 있나".
  // 셋 다 성립해야 true (하나라도 어긋나면 옛 스파인 = 케이스 B 로 **연속적 저하**):
  //  ① 상자 칸 위치를 안다(fluidboxOffset) + 지하파이프를 골랐다.
  //  ② 점프 거리가 최악 폭을 감당한다 — 입구 d1 → 출구 d(2+최대reach), 좌표 차 = 최대reach+1.
  //     (실제 폭은 그 면에 배정된 벨트로 정해져 더 좁을 수 있다 — 여기선 보수적으로 최악.)
  //  ③ 좌석 줄에서 상자 행 1개를 빼고도 벨트 좌석이 남는다: 벨트 수 ≤ 면 좌석 − 1.
  const ft = input.fluidTrunk;
  const maxReach = plannerInserters.reduce((a, i) => Math.max(a, i.reach), 0);
  const isJumpableToClusterPipe =
    !!ft &&
    ft.fluidboxOffset !== undefined &&
    !!ft.undergroundPipeEntityName &&
    (ft.pipeMaxUndergroundDistance ?? 0) >= maxReach + 1 &&
    plannerInserters.length <= input.machine.h - 1;

  // ── ③ 나머지 줄 배정 — ①이 남긴 예산 안에서 ──────────────────────────────
  // 보장된 columnTapCapacity 슬롯을 줄마다 1:1 못박는다(natural-divergence 대체).
  // 각 줄 → {면 W/E, 레인 near/far, 인서터}. 결과 순서가 곧 처리 순서(입력 먼저·near 면부터).
  // complex(과용량·무인서터)면 전부 위임. 트렁크로 합칠 수 있으면 "tap", 안 되면 "direct"(1:1)
  // — 거절은 **항상 안전**하다: 1:1 은 구성으로 성립한다.
  //
  // slotsPerFace = 다이렉트 인서팅의 면 용량(그 면의 둘레 칸 수). 이 수는 방출 루프의
  // `lateral`(슬롯 상한)과 **같아야** 한다 — 어긋나면 없는 자리를 배정하거나(미탭) 있는
  // 자리를 안 쓴다(스필). 탭 인서팅(면당 2)을 1:1 에 쓰면 3×3 머신의 셋째 입력이 자리가
  // 남는데도 출력면(W)으로 넘친다. (용어: docs/용어사전.md §D)
  //
  // **`seatRowsUsed` 는 계층을 건너는 통보가 아니라 ① → ③ 의 내부 전달이다.** 두 배정의
  // 장부 낟알이 다르기 때문에 Map 을 그대로 넘기지는 못한다 — ①은 (머신,면)마다 세고
  // ③은 면마다 센다(모든 머신이 같은 행을 쓰는 것이 ③의 모델이다). [seatRowsByFace] 가
  // 머신 축을 max 로 접어 그 낟알 차이를 흡수한다.
  const supply: InsertingDecisionResult = insertingPlanner(
    {
      lines: input.lines.filter(
        (l) => l.kind !== "pipe" && !linkedKeys.has(`${l.role}:${l.name}`),
      ),
      inserters: plannerInserters,
      outputSide: "W" as const, // 좌우 계층형: 부모=좌=W. 출력을 W 에 먼저 확정((B) 정책).
      nsFaces: input.nsExposure, // 노출 끝면 — external 입력의 W-spill 완화(E→N/S→W).
      slotsPerFace: { WE: input.machine.h, NS: input.machine.w },
      seatRowsUsed: seatRowsByFace(faceLedger), // ①이 먼저 먹은 행
      pipeSide: input.fluidTrunk?.side, // 유체가 붙는 면.
      isJumpableToClusterPipe, // true=좌석 살림(일반 면), false=옛 스파인(케이스 B).
      belts: input.belts,
    },
    count,
    input.supplyCapacity,
  );

  // 유체는 트렁크(tap)로만 성립하므로, 자리가 없거나(fluidCannotPlace) 아이템이 다이렉트로
  // 떨어지면(유체는 다이렉트 불가) 나머지 줄이 통째로 실패한다 — 유체 재료 하나가 안 되면
  // 그 모듈은 옛 경로로 넘어가야 하기 때문(예전엔 planner 가 complex 로 같은 결과를 냈다).
  const fluidNeedsTap = pipeLines.length > 0 && (fluidCannotPlace || supply.mode === "direct");

  return {
    linkFaces: { out: outFaces.plans, in: inFaces.plans },
    // ── ④ gap 폭 — ①의 부산물. 우리가 고르는 값이 아니다.
    rowGaps: gapRowsFromPlans(count, [outFaces.plans, inFaces.plans]),
    supply,
    pipePlanned,
    isJumpableToClusterPipe,
    linkedKeys,
    rest:
      supply.plan.ok && !fluidNeedsTap
        ? { ok: true, lines: supply.plan.lines }
        : {
            ok: false,
            // 링크 줄은 여기 안 들어간다 — 링크의 성패는 자기 방출에서 갈린다.
            // 넣으면 성공한 링크까지 오염된다.
            unplaced: input.lines.filter((l) => !linkedKeys.has(`${l.role}:${l.name}`)),
          },
  };
}
