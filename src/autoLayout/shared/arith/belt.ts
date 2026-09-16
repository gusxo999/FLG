import type { Entity } from '../../../types/gameData';
import type { SpecBelt } from '../gamedata/spec';

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
 * **레인 하나가 나르는 양** — 줄 전체의 **정확히 절반**이다(45/s 줄이면 22.5/s).
 *
 * `× 480` 이 이미 `2 레인 × 4 아이템/타일 × 60 틱` 이므로 새로 잴 것이 없다. 게임 규칙과
 * 그 근거는 [belt-lane-semantics](../../docs/factorio/belt-lane-semantics.md) §1.
 *
 * **계획이 보는 상한은 전부 이 값이다**(2026-09-03). 인서터는 먼 레인 하나에만 떨구므로
 * 인서터가 싣는 줄은 벨트의 절반만 쓴다 — [determineBeltCount] 도, [createLinks] 의 붓기도,
 * `buildSpec` 의 팔 상한도 이 값을 본다. 물리 처리량([beltThroughput])은 **블루프린트와
 * 그리드 분석의 진실**로 남는다(거기선 레인이 둘 다 찰 수 있다).
 */
export function laneThroughput(entity: Entity | undefined, override?: number): number {
  return beltThroughput(entity, override) / 2;
}

/** [laneThroughput] 의 `SpecBelt` 판 — 티어를 이미 고른 뒤에 쓴다. */
export function laneCapOfTier(tier: { throughput: number } | undefined): number {
  return tier !== undefined && tier.throughput > 0 ? tier.throughput / 2 : 0;
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
 * ## 왜 **레인 용량**으로 세나 (2026-09-03)
 *
 * 인서터는 **먼 레인 하나에만** 떨군다([belt-lane-semantics](../../docs/factorio/belt-lane-semantics.md) ①).
 * 우리 모듈은 기둥이라 머신이 벨트 **한쪽에만** 있고, 그 면의 팔은 전부 같은 레인에 싣는다.
 * 그래서 **인서터가 싣는 줄은 벨트의 절반만 쓴다** — 45/s 벨트에 실제로 실리는 것은 22.5/s 다.
 *
 * 예전엔 줄 전체(45)로 세서, 40/s 수요에 익스프레스 **한 줄**을 깔고 "충분하다" 고 보고했다.
 * 게임에 넣으면 22.5 만 흐르고 부모가 굶는다 — **배치는 성공이라 말하는데 물류가 거짓인**
 * 실패다. 그래서 여기서 세는 단위는 **줄이 아니라 레인**이다.
 *
 * 줄을 둘로 늘려도 물리 벨트가 둘이 되는 것은 아니다 — 두 줄을 **합류**시키면 한 벨트의
 * 좌/우 레인에 하나씩 실린다(`tempPlanDocs/벨트-레인/`). 합류는 **처리량을 안 늘리고
 * 물리 벨트 수를 줄인다.**
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
  while (remaining >= laneCapOfTier(fastest)) {
    lines.push(fastest);
    remaining -= laneCapOfTier(fastest);
  }
  // ② 남은 조각 — 이걸 감당하는 것 중 **가장 느린** 벨트. usable 이 내림차순이니 뒤에서
  //    찾으면 그게 가장 싼 것이다. 남은 조각은 fastest 보다 작으므로 후보는 반드시 있다.
  if (remaining > 1e-9) {
    const cheapest = [...usable].reverse().find((b) => laneCapOfTier(b) >= remaining) ?? fastest;
    lines.push(cheapest);
  }
  return lines;
}
