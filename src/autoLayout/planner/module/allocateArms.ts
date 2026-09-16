/**
 * **팔 산술** — 이 줄을 먹이는 데 팔이 몇 개 드나([requiredInserterCount])와, 자리가
 * 모자랄 때 **누구부터 줄이나**([allocateArms]).
 *
 * 타입은 `module/types/line` 에 있다. 여기엔 자리도 좌표도 없다 — **수만 센다.**
 *
 * > `clusterPortPlanner.ts` 에서 갈라져 나왔다(2026-09-02). 짝 테스트가 이미
 * > `allocateArms.test.ts` 라는 이름으로 있었다.
 */

import type { SpecInserter } from "../../shared/gamedata/spec";
import { armsFor } from "../../shared/gamedata/spec";
import type { IoLine, SupplyCapacity } from "../../module/types/line";

/**
 * **[requiredInserterCount](../../../../../docs/용어사전.md#requiredinsertercount)** — 머신 한
 * 대의 이 줄을 먹이는 데 필요한 인서터 팔의 개수. 모르면 `undefined`.
 *
 * **공급 방식과 무관한 물리량이다.** 인서터 하나가 나르는 양은 그 팔이 벨트에서 집든
 * 상자에서 집든 같으므로, 이 수는 탭/다이렉트를 고르기 **전에** 정해진다 — 레시피·머신
 * 속도·인서터 프로토타입이 전부 밖에서 오는 값이라 협상 대상이 아니다. 그래서 이 함수는
 * 모드를 모른다. 모드는 **이 수를 어떻게 앉히느냐**의 문제일 뿐이다:
 *  - **탭**: 팔들이 같은 [ClusterBelt] 한 줄에서 집는다([Parallel Inserting]).
 *  - **다이렉트**: 팔들이 각자 자기 상자에서 집는다(상자 한 칸의 이웃은 4칸뿐이고 인서터는
 *    상자와 머신 양쪽에 닿아야 하므로, 팔이 늘면 상자도 늘어야 한다).
 *
 * `rate` 를 모르면(범위 산출물인데 게임데이터에 amount_min/max 가 없는 등) **`undefined`**
 * 를 낸다 — 숫자를 지어내지 않는다. 호출부가 "판정 보류"(1로 봄)를 고른다.
 *
 * **벨트 처리량은 여기 없다.** 그건 다른 축이다 — 클러스터 전체 수요가 벨트 한 줄을 넘는
 * 문제는 팔을 늘려도 안 풀리고(벨트가 못 나른다), 애초에 벨트를 안 쓰는 다이렉트엔 존재하지
 * 않는다. 그래서 [insertingPlanner] 의 탭 경로에만 둔다.
 */
export function requiredInserterCount(
  line: IoLine,
  machineCount: number,
  cap: SupplyCapacity,
  /**
   * **이 줄을 집을 인서터.** 모드는 몰라도 되지만(위 머리말) **어느 팔이 앉는지는 알아야
   * 한다** — 팔 속도가 그것으로 정해지기 때문이다(계획서 §16). 벨트 칸(=`clusterBeltDepth`)이
   * `reach` 를 정하고 `reach` 가 인서터를 정하므로, 호출부는 배정된 슬롯에서 이걸 얻는다.
   */
  inserter: SpecInserter | undefined,
): number | undefined {
  const rate = cap.lineRates?.get(`${line.role}:${line.name}`);
  if (rate === undefined || machineCount <= 0) return undefined; // 수치 없음 → 판정 보류
  return armsFor(rate / machineCount, inserter);
}

/** [allocateArms] 결과 — 줄별 팔 개수 + 그래서 머신이 실제로 도는 비율. */
export interface ArmBudget {
  /** 줄별로 실제 앉힌 팔 개수. 키 = `${role}:${name}`. */
  armsByLine: Map<string, number>;
  /**
   * 머신이 **실제로 도는 비율**(0 < f ≤ 1). 1 = 안 굶는다.
   * 0 = 줄마다 팔 하나씩도 못 앉힌다(이 머신으론 이 레시피가 아예 불가능).
   */
  speedFraction: number;
}

/**
 * **팔을 자리 안에서 나눠 앉히고, 그래서 머신이 몇 %로 도는지 답한다.**
 *
 * 머신은 **가장 굶는 줄의 속도로만** 돈다 — 입력 하나가 절반만 들어오면 제작도 절반이다.
 * 그래서 팔이 모자랄 때 "어느 줄에 몇 개를 주느냐"가 곧 머신 속도를 정한다. 최선은
 * **가장 굶는 줄에 다음 팔을 주는 것**이다(그 줄이 전체를 붙잡고 있으므로).
 *
 * 왜 필요한가: [requiredInserterCount] 를 다 앉힐 자리가 없을 때, 예전엔 줄여서 놓고
 * **"성공"이라 보고**했다(=조용히 굶는 배치). 이제는 줄여 놓은 결과가 **몇 %인지 계산**해서
 * 호출부가 머신을 그만큼 더 놓고 사용자에게 경고할 수 있게 한다(2026-07-16 사용자 설계).
 *
 * **수량을 모르는 줄은 팔 1개**를 받고 비율 계산에서 빠진다 — 모르는 걸로 굶었다고
 * 단정하지 않는다.
 *
 * ## 왜 여기서는 **reach 1** 을 쓰나 — 낙관이 아니라 폴백의 모델이다
 *
 * 팔 속도는 *어느 인서터가 앉느냐*의 함수이고 그건 벨트 칸이 정한다(계획서 §16). 그런데 이
 * 함수는 **머신 대수를 정하기 전에** 돌아서 칸을 모른다.
 *
 * 그래도 `reach 1` 이 맞다 — **다이렉트가 언제나 유효한 폴백이고, 다이렉트의 팔은 항상
 * `reach 1`** 이기 때문이다(인서터가 상자와 머신 **양쪽에 인접**해야 하므로 상자가 `d2`,
 * 팔이 `d1`). 탭이 깊은 벨트를 써서 팔이 더 들면 [takeSeat] 이 **그 시점에 정직하게 거절**해
 * 다이렉트로 물러나고, 그러면 이 함수가 센 수가 다시 맞는다.
 *
 * **이 정당화가 없으면 그냥 낙관이고, 낙관은 조용히 굶는다**(`docs/auto-layout/module/module-planning.md §4.5`).
 *
 * @param lines 이 머신의 I/O 줄들. 유체(pipe)는 인서터가 없어 대상이 아니다.
 * @param perMachineRate 줄별 **머신 한 대의** 초당 수요/산출(items/sec). 모르면 undefined.
 * @param seatInserter 좌석에 앉는 팔 — 위 이유로 `reach 1`. 없으면 답할 수 없다.
 * @param rowBudget 팔을 앉힐 수 있는 총 행 수(= 쓸 수 있는 면들의 좌석 행 합).
 */
export function allocateArms(
  lines: IoLine[],
  perMachineRate: (line: IoLine) => number | undefined,
  seatInserter: SpecInserter | undefined,
  rowBudget: number,
): ArmBudget {
  const tapCap = seatInserter?.throughput ?? 0;
  const belts = lines.filter((l) => l.kind === "belt");
  const armsByLine = new Map<string, number>();
  const keyOf = (l: IoLine) => `${l.role}:${l.name}`;

  // 줄마다 팔 하나씩은 있어야 한다 — 그것도 못 앉히면 이 머신으론 불가능하다.
  if (belts.length > rowBudget || tapCap <= 0) {
    return { armsByLine, speedFraction: 0 };
  }
  for (const l of belts) armsByLine.set(keyOf(l), 1);
  let spent = belts.length;

  /** 이 줄이 지금 팔로 감당하는 비율(1 = 안 굶음). 수량 미상이면 안 굶는 것으로 본다. */
  const fractionOf = (l: IoLine): number => {
    const rate = perMachineRate(l);
    if (rate === undefined || !Number.isFinite(rate) || rate <= 0) return 1;
    return Math.min(1, (armsByLine.get(keyOf(l))! * tapCap) / rate);
  };

  // **가장 굶는 줄에 다음 팔을 준다** — 그 줄이 머신 전체를 붙잡고 있다.
  while (spent < rowBudget) {
    let worst: IoLine | undefined;
    let worstF = 1;
    for (const l of belts) {
      const f = fractionOf(l);
      if (f < worstF) {
        worstF = f;
        worst = l;
      }
    }
    if (!worst) break; // 아무도 안 굶는다 — 더 놓을 이유가 없다(자리를 낭비하지 않는다).
    armsByLine.set(keyOf(worst), armsByLine.get(keyOf(worst))! + 1);
    spent++;
  }

  const speedFraction = belts.reduce((f, l) => Math.min(f, fractionOf(l)), 1);
  return { armsByLine, speedFraction };
}

