/**
 * **모듈 관심사의 셈** — 답이 하나이고 자원도 좌표도 안 본다.
 *
 * ```
 * flowEnd · trunkEndKey                    줄의 끝 — 타입을 읽어 문자열 하나를 낸다
 * FluidJumpBudget · fluidJumpBudgetOf      유체 점프 예산 — 한 면의 좌석 줄 · 벨트 깊이 · 지하파이프
 * clusterBeltDepthCap                      지하파이프 사거리가 정하는 벨트 깊이 상한
 * FluidJumpBlocker · fluidJumpBlocker      그 면의 유체 n 줄이 점프할 수 있나 — 못 하면 사유
 * fluidLinesOnSide · fluidLineOf           유체 배정 조회 — 한 면의 줄들 · 줄 하나
 * ```
 *
 * 앞의 둘은 **타입을 읽어 문자열 하나를 낸다.** 그래서 한때 *"이름을 정하는 일"* 로 분류돼 타입
 * 파일에 들어갈 뻔했다 — 실행되는 것은 타입이 아니다([work-kinds §3](../../../docs/auto-layout/common/work-kinds.md)).
 *
 * 유체 셈 셋(예산 · 상한 · 막힘)은 **한 파일에 함께 산다** — 계획(`planner/module/arith`)과 거절(`planner/run/policy`)이
 * 같은 함수를 봐야 어긋나지 않고, 셋이 서로를 부른다.
 *
 * > **내력.** `trunkEndKey` 는 `module/clusterModule.ts`, `flowEnd` 는 `planner/module/linkPlanner.ts`
 * > 에 있다가 2026-09-13 여기로 왔다(계획 구조-2축 · 2 Step 1). 방출기가 이 둘을 쓰려고 조율자와
 * > 계획 계층을 **런타임으로** 불렀다 — 앞쪽이 저장소의 유일한 런타임 순환이었다.
 * > 유체 셈과 조회는 `module/fluidPorts.ts` 에 있다가 2026-09-15 여기로 왔다(Step 5e) — 그 파일은 게임데이터를 보는
 * > 어댑터 · 정책이고 이것들은 답이 하나다.
 */

import type { PortFace } from "../../shared/types";
import type { FluidLinePlan, FluidTrunkInput } from "../gamedata";
import type { PlannedLine } from "../types/line";
import type { ModuleInput } from "../types/module";
import type { LinkFacePlan } from "../types/seat";

/**
 * **이 줄이 향하는 끝** — 배정과 방출이 같은 값을 보게 하는 단일 출처.
 *
 * `portEnd` 를 앞에 두는 것은 관통 줄에서 둘이 반드시 같아야 하기 때문이다(포트가 기둥
 * 끝에 섰는데 벨트가 반대로 흐르면 도형이 없다). 마지막 `"N"` 은 **방향을 아무도 안 말한
 * 경우**(형제가 하나뿐이라 선호가 없는 줄)의 기본값이고, 그게 2026-09-05 이전의 전부였다.
 */
export const flowEnd = (
  cand: Pick<LinkFacePlan, "portEnd" | "exitEnd">,
): "N" | "S" => cand.portEnd ?? cand.exitEnd ?? "N";

/** [TrunkContext.maxDepthAtEnd] 의 조회 키 — 같은 면·같은 끝(min/max)이면 같은 키. */
export function trunkEndKey(p: PlannedLine, lineEnds: ModuleInput["lineEnds"]): string {
  // (예전엔 구간이 자기 끝을 지목하는 `exitEnd` 갈래가 앞에 있었다. 그것을 만들던
  //  `splitIntervals` 가 죽은 코드여서 함께 삭제됐다 — 2026-09-02.)
  const end = lineEnds?.get(`${p.line.role}:${p.line.name}`) ?? "min";
  return `${p.side}:${end}`;
}

/**
 * 점프 판정에 드는 재료 전부 — **한 면**을 본다.
 *
 * 계획([planModulePorts])과 거절([admitFluidTrunks])이 **같은 함수**를 봐야 어긋나지 않는다.
 * 예전엔 판정이 계획 쪽에만 있어서, 넘지 못하는 면은 조용히 옛 스파인으로 물러났다 — 유체가
 * 한 줄일 땐 그게 맞는 저하지만 **두 줄이면 오답**이다(스파인 둘이 같은 d1 을 다툰다).
 */
export interface FluidJumpBudget {
  /** 지하파이프 prototype. 없으면 점프 자체가 불가능하다. */
  undergroundPipeEntityName?: string;
  /** 지하파이프 입출구 **좌표 차** 한계([BuildSpec] 동명 필드). */
  pipeMaxUndergroundDistance?: number;
  /** 그 면의 좌석 줄 수 = 머신 높이(W/E 면). */
  seatRows: number;
  /** 그 면에 설 [ClusterBelt] 줄 수의 상한 — 인서터 reach 종류 수, 단 아이템 줄 수를 못 넘는다. */
  beltDepths: number;
}

/**
 * **점프 예산을 조립하는 한 곳** — 계획([planLinkFaces])과 거절([admitFluidTrunks])이 이 함수를 부른다.
 * 식은 [FluidJumpBudget.beltDepths] 머리말의 문장 그대로다.
 *
 * **면당 깊이 = 서로 다른 reach 값 개수.** 예전엔 `longInserter ? 2 : 1` 로 세어 reach 3종을 골라도
 * 2에서 잘렸다 — 배분기의 주장과 배선이 어긋나던 자리다(`docs/용어사전.md §BuildSpec`).
 *
 * 예전엔 두 호출자가 **각자** 조립했다 — 거절은 `min(max(1, reach 종류 수), 아이템 줄 수)`, 계획은
 * `min(인서터 목록 길이, 파이프 아닌 줄 수)`. 둘이 같은 답을 낸 것은 설정 관문(`admitBuildSpec` — 인서터가
 * 없으면 먼저 물러난다)과 `makeBuildSpec`(reach 마다 하나만 남긴다)에 기댄 결과였다(2026-09-14 두 식을 나란히
 * 계측해 불일치 0 을 확인하고 합쳤다 — 계획 구조-2축 · 2 Step 3b). 거절 쪽이 함께 들던 `maxInserterReach` 는
 * 이 모양에 없는 필드라 아무도 읽지 않았다(2026-08-16 식을 뒤집을 때 남은 것).
 */
export function fluidJumpBudgetOf(a: {
  undergroundPipeEntityName?: string;
  pipeMaxUndergroundDistance?: number;
  seatRows: number;
  inserters: ReadonlyArray<{ reach: number }>;
  /** 이 레시피의 **아이템** 줄 수(재료 + 산출). */
  itemLineCount: number;
}): FluidJumpBudget {
  return {
    undergroundPipeEntityName: a.undergroundPipeEntityName,
    pipeMaxUndergroundDistance: a.pipeMaxUndergroundDistance,
    seatRows: a.seatRows,
    beltDepths: Math.min(new Set(a.inserters.map((i) => i.reach)).size, a.itemLineCount),
  };
}

/** 못 넘는 사유 — 셋은 처방이 다르다(파이프 고르기 · 더 긴 지하파이프 · 더 큰 머신). */
export type FluidJumpBlocker =
  | { kind: "no-underground"; detail: string }
  | { kind: "underground-too-short"; detail: string }
  | { kind: "seats-exhausted"; detail: string };

/**
 * **그 면의 아이템 벨트가 가질 수 있는 최대 깊이** — 지하파이프 사거리가 정하는 상한.
 *
 * 순번 `r` 인 유체 줄의 터널 좌표 차가 `base + 2r` 이고(trunk-pipe §5.1) 가장 바깥 줄이
 * `r = n−1` 이므로, 사거리 `have` 로 넘을 수 있는 `base` 는 `have − 2(n−1)` 이다.
 * `base = max(그 면 벨트 최대 깊이, 1)` 이라 이 값이 곧 **깊이의 상한**이다.
 *
 * **식을 뒤집은 것이다**(2026-08-16 사용자 결정 — *"사거리가 짧으면 파이프 배치를 우선"*).
 * 예전엔 `maxInserterReach + 1` 을 **최악 base 로 가정**해 필요 사거리를 냈다. 배정이 아직
 * 안 끝나 실제 깊이를 몰랐기 때문인데, 그 가정 때문에 **실제로는 넘을 수 있는 면을 거절**했다.
 * 이제 파이프가 먼저 답을 내고 아이템 깊이가 그 안에 들어간다 — 상한이 2 미만이면 그 면은
 * 아이템 깊이를 안 주고(사다리 한 칸), 거절이 아니다.
 */
export function clusterBeltDepthCap(n: number, pipeMaxUndergroundDistance: number | undefined): number {
  return (pipeMaxUndergroundDistance ?? 0) - 2 * (n - 1);
}

/**
 * 이 면의 유체 `n` 줄이 바깥 [ClusterPipe] 로 점프할 수 있나 — 못 하면 그 사유. 넘으면 null.
 *
 * `n ≥ 2` 면 **점프는 선택이 아니라 필수**다: 옛 스파인은 좌석 줄(d1)을 기둥 전체로 먹어
 * 둘째 줄의 유체 상자 칸을 막는다. 그래서 호출자는 `n ≥ 2` 인데 이 함수가 사유를 내면
 * **거절해야 한다** — 물러설 곳이 없다.
 */
export function fluidJumpBlocker(n: number, b: FluidJumpBudget): FluidJumpBlocker | null {
  if (!b.undergroundPipeEntityName) {
    return { kind: "no-underground", detail: `유체 ${n}줄을 넘길 지하파이프를 안 골랐다` };
  }
  // **아이템 벨트를 하나도 안 놓아도 못 넘나** — 그때만 거절이다(base 의 최소값은 1).
  // 넘을 수는 있는데 좁은 경우는 거절이 아니라 [clusterBeltDepthCap] 이 깊이를 깎는다.
  if (clusterBeltDepthCap(n, b.pipeMaxUndergroundDistance) < 1) {
    const have = b.pipeMaxUndergroundDistance ?? 0;
    return {
      kind: "underground-too-short",
      detail: `유체 ${n}줄엔 지하파이프 사거리 ${1 + 2 * (n - 1)} 가 필요한데 ${b.undergroundPipeEntityName} 은 ${have}`,
    };
  }
  // 좌석 줄에서 유체 상자 행 n개를 빼고도 벨트 좌석이 남아야 한다.
  // **`beltDepths` 는 아이템 줄 수를 못 넘는다** — 아이템이 아예 없는 레시피(경유 분해: 물 +
  // 경유 → 경유)는 그 면에 벨트가 0줄이라 유체 행만 있으면 된다. 인서터 종류 수만 보던
  // 시절엔 3×3 머신 + 긴팔 선택에서 `2 ≤ 3−2` 가 거짓이 되어 **아이템이 없는데도** 거절했다.
  if (b.beltDepths > b.seatRows - n) {
    return {
      kind: "seats-exhausted",
      detail: `면 좌석 ${b.seatRows}행에서 유체 ${n}행을 빼면 ${b.seatRows - n}행 — 벨트 ${b.beltDepths}줄이 안 들어간다`,
    };
  }
  return null;
}

/** 이 면에 붙는 유체 줄들 — 안쪽부터(rank 오름차순). 없으면 빈 배열. */
export function fluidLinesOnSide(ft: FluidTrunkInput | undefined, side: PortFace): FluidLinePlan[] {
  return (ft?.lines ?? []).filter((l) => l.side === side).sort((a, b) => a.rank - b.rank);
}

/** 이 줄(`role:name`)의 유체 배정. 아이템 줄이면 undefined. */
export function fluidLineOf(
  ft: FluidTrunkInput | undefined,
  line: { role: "input" | "output"; name: string },
): FluidLinePlan | undefined {
  return ft?.lines.find((l) => l.role === line.role && l.name === line.name);
}
