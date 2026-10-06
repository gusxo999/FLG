/**
 * **지하벨트 종류를 고르는 곳** — 모듈 안에 지하벨트가 서는 두 자리의 종류를 여기서 함께 고른다.
 *
 * ```
 * diveUnderground      지하 횡단 — 줄이 땅속으로 비켜 갈 때. 그 줄의 운반량을 감당하는 가장 느린 것
 * exitUnderground      gap 출구 — 옆면을 건너야 앉는 줄. 감당하고 사거리가 닿는 것 중 가장 느린 것
 * terminusUnderground  종착 — 흐름의 끝 칸이 세 방향 다 막혔을 때. 가장 느린 것 중 T4 에 안 걸리는 것
 * ```
 *
 * **둘이 한 파일인 이유는 T4 다** — 종착은 짝 없는 입구라, 같은 열 · 같은 종류 · 사거리 안 앞쪽에 지하 횡단 입출구가
 * 있으면 그 출구와 짝이 되어 물건이 샌다. 그래서 종착의 종류는 지하 횡단이 무엇을 골랐는지를 알아야 한다
 * (`docs/auto-layout/module/trunk-blocked.md` §4 · `docs/auto-layout/module/belt-terminus.md` §4).
 *
 * **목록의 정렬을 믿지 않는다**([inserterForReach] 와 같은 이유) — 거르지 않은 목록을 받았을 때 조용히 비싼 답을 내면,
 * 그 선택이 **어디서 정해졌는지** 를 아무도 못 찾는다.
 */

import type { SpecUndergroundBelt } from "../../shared/gamedata/spec";

/** 사거리를 모르는 종류는 뺀다 — 장부에 적을 값이 없다. */
const usable = (b: SpecUndergroundBelt): boolean => b.maxDistance > 0;

/**
 * **가장 느린 지하벨트** — 종착은 아무것도 나르지 않으므로 빠른 티어를 태울 이유가 없다.
 */
export function slowestUnderground(
  belts: ReadonlyArray<SpecUndergroundBelt> | undefined,
): SpecUndergroundBelt | undefined {
  let best: SpecUndergroundBelt | undefined;
  for (const b of belts ?? []) {
    if (!usable(b)) continue;
    if (!best || b.throughput < best.throughput) best = b;
  }
  return best;
}

/**
 * **지하 횡단에 쓸 지하벨트** — 그 줄의 운반량(`rate`, 초당 개수)을 감당하는 것 중 가장 느린 것.
 *
 * 더 느린 것을 쓰면 그 줄이 땅속에서 막힌다. 더 빠른 것을 쓸 이유는 없다 — 종착(가장 느린 것)과 종류가 갈려
 * T4 에 덜 걸린다는 이점은 있지만, 그 다툼은 종착 쪽이 종류를 바꿔 푼다([terminusUnderground]).
 *
 * **운반량을 모르면 고르지 않는다** — 이름은 저울과 함께 온다. 모르는 줄은 지하 횡단하지 않는다(오늘 그대로).
 */
export function diveUnderground(
  belts: ReadonlyArray<SpecUndergroundBelt> | undefined,
  rate: number | undefined,
): SpecUndergroundBelt | undefined {
  if (rate === undefined) return undefined;
  let best: SpecUndergroundBelt | undefined;
  for (const b of belts ?? []) {
    if (!usable(b) || b.throughput < rate) continue;
    if (!best || b.throughput < best.throughput) best = b;
  }
  return best;
}

/**
 * **gap 출구의 지하 횡단에 쓸 지하벨트** — 그 줄의 운반량을 감당하고 사거리가 `span`(입구에서 출구까지) 이상인 것 중 가장 느린 것
 * (`trunk-blocked.md` §4.2). 못 고르면 까닭을 낸다:
 *
 * ```
 * none    운반량을 감당하는 것이 없다 — 안 골랐거나 운반량을 모른다(이름은 저울과 함께 온다)
 * range   감당하는 것은 있는데 사거리가 모자라다
 * ```
 *
 * **옆면 지하 횡단([diveUnderground])와 달리 닿는 것을 고른다** — 옆면 지하 횡단은 막힌 칸을 비켜 가는 기회라 못 닿으면 안 하면
 * 그만이지만, gap 출구는 옆면을 건너야 앉을 수 있다. 그래서 가장 느린 것이 못 닿으면 사거리가 긴(빠른) 것으로 간다.
 */
export function exitUnderground(
  belts: ReadonlyArray<SpecUndergroundBelt> | undefined,
  rate: number | undefined,
  span: number,
): SpecUndergroundBelt | "none" | "range" {
  if (rate === undefined) return "none";
  const carrying = (belts ?? []).filter((b) => usable(b) && b.throughput >= rate);
  if (carrying.length === 0) return "none";
  let best: SpecUndergroundBelt | undefined;
  for (const b of carrying) {
    if (b.maxDistance < span) continue;
    if (!best || b.throughput < best.throughput) best = b;
  }
  return best ?? "range";
}

/**
 * **종착에 쓸 지하벨트** — 느린 것부터 보되, `clash` 가 참인 종류(앞쪽 사거리 안에 같은 종류의 지하가 있다 — T4)는 건너뛴다.
 * 다 걸리면 `undefined` — 종착을 못 세운다(부르는 쪽이 흐름 그대로 두고 경고한다).
 */
export function terminusUnderground(
  belts: ReadonlyArray<SpecUndergroundBelt> | undefined,
  clash: (b: SpecUndergroundBelt) => boolean,
): SpecUndergroundBelt | undefined {
  const sorted = [...(belts ?? [])].filter(usable).sort((a, b) => a.throughput - b.throughput);
  return sorted.find((b) => !clash(b));
}
