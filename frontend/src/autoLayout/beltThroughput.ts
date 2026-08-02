import type { Entity } from '../store/gameDataStore';
import type { SpecBelt } from './buildSpec';

/**
 * 벨트 처리량 모델 — items/sec.
 *
 * 게임 데이터의 `belt_speed` 는 tiles/tick 단위다. 벨트 한 줄(2 레인)이 나르는
 * 초당 아이템 수는:
 *
 *   itemsPerSec = belt_speed × 480
 *   (= belt_speed × 2 레인 × 4 아이템/타일 × 60 틱/초)
 *
 * vanilla anchor: transport 0.03125→15, fast 0.0625→30, express 0.09375→45.
 *
 * `override` (items/sec) 가 양수면 그 값을 그대로 쓴다(사용자 보정용). entity 나
 * belt_speed 가 없으면 0 (= 처리 불가).
 */
const ITEMS_PER_SEC_PER_BELT_SPEED = 480;

export function beltThroughput(entity: Entity | undefined, override?: number): number {
  if (override !== undefined && override > 0) return override;
  if (!entity || !entity.belt_speed || entity.belt_speed <= 0) return 0;
  return entity.belt_speed * ITEMS_PER_SEC_PER_BELT_SPEED;
}

/**
 * **determineBeltCount** — 이 초당 수요를 나르려면 **벨트를 어떤 걸 몇 줄** 깔아야 하나
 * (2026-07-12 사용자 명명, [용어사전](../../../docs/용어사전.md#determinebeltcount)).
 *
 * 규칙(2026-07-16 사용자 지정):
 *  1. **가장 빠른 벨트부터** 채워 수요를 감당한다.
 *  2. 딱 안 나눠떨어지고 남는 만큼은, **그 나머지를 감당할 수 있는 가장 싼(느린) 벨트**로
 *     덮는다. 나머지 벨트는 **넉넉해도 된다**(살짝 초과 허용).
 *  3. **부모가 굶으면 절대 안 된다** — 그래서 합계는 언제나 수요 **이상**이다. 모자라느니
 *     한 티어 위를 쓴다.
 *
 * 왜 이 규칙인가: 벨트 줄 수는 **협상 대상이 아니라 수요에서 유도되는 값**이다. 그리고
 * 유도 규칙이 자식·부모 양쪽에서 같으므로, **같은 수요를 보면 같은 줄 수가 나온다** —
 * 두 모듈의 경계에서 줄 수가 어긋날 일이 없다(포트 개수를 팔 개수에서 유도하면 어긋난다).
 *
 * 수요를 **모르면 빈 배열**을 낸다 — 없는 숫자로 벨트를 깔지 않는다. 벨트를 하나도 안
 * 골랐어도 빈 배열이다(호출부가 "못 놓는다"를 고르게 한다).
 *
 * @param rate 초당 수요(items/sec). **부모 수요 기준**이다 — 자식이 과잉 생산해도 남는 건
 *   신경 쓰지 않는다(2026-07-16 사용자 결정). 벨트가 차면 자식이 알아서 쉰다.
 * @param belts 고를 수 있는 벨트들([BuildSpec.belts]). 순서 무관 — 여기서 정렬한다.
 */
export function determineBeltCount(rate: number | undefined, belts: SpecBelt[]): SpecBelt[] {
  if (rate === undefined || !Number.isFinite(rate) || rate <= 0) return [];
  const usable = belts.filter((b) => b.throughput > 0).sort((a, b) => b.throughput - a.throughput);
  if (usable.length === 0) return [];

  const fastest = usable[0];
  const lines: SpecBelt[] = [];
  // ① 가장 빠른 벨트로 **꽉 채울 수 있는 만큼**만 깐다. 나머지는 ② 가 더 싸게 덮는다.
  let remaining = rate;
  while (remaining >= fastest.throughput) {
    lines.push(fastest);
    remaining -= fastest.throughput;
  }
  // ② 남은 조각 — 이걸 감당하는 것 중 **가장 느린** 벨트. usable 이 내림차순이니 뒤에서
  //    찾으면 그게 가장 싼 것이다. 남은 조각은 fastest 보다 작으므로 후보는 반드시 있다.
  if (remaining > 1e-9) {
    const cheapest = [...usable].reverse().find((b) => b.throughput >= remaining) ?? fastest;
    lines.push(cheapest);
  }
  return lines;
}
