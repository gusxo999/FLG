/**
 * **모듈 관심사의 셈** — 답이 하나이고 자원도 좌표도 안 본다.
 *
 * 둘 다 **타입을 읽어 문자열 하나를 낸다.** 그래서 한때 *"이름을 정하는 일"* 로 분류돼 타입
 * 파일에 들어갈 뻔했다 — 실행되는 것은 타입이 아니다([work-kinds §3](../../../docs/auto-layout/common/work-kinds.md)).
 *
 * > **내력.** `trunkEndKey` 는 `module/clusterModule.ts`, `flowEnd` 는 `planner/module/linkPlanner.ts`
 * > 에 있다가 2026-09-13 여기로 왔다(계획 구조-2축 · 2 Step 1). 방출기가 이 둘을 쓰려고 조율자와
 * > 계획 계층을 **런타임으로** 불렀다 — 앞쪽이 저장소의 유일한 런타임 순환이었다.
 */

import type { PlannedLine } from "./types/line";
import type { ModuleInput } from "./types/module";
import type { LinkFacePlan } from "./types/seat";

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
