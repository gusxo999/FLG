/**
 * **인서터 자리 산술** — 머신 둘레의 자리가 모자랄 때 **어느 줄부터 줄이나**, 그래서 머신이 몇 % 로 도나
 * ([allocateArms]).
 *
 * 타입은 `module/types/line` 에 있다. 여기엔 자리도 좌표도 없다 — **수만 센다.** 줄 하나에 인서터가 몇 개 드는지는
 * 여기서 세지 않는다 — `shared/gamedata/spec` 의 [armLoadsOf] 가 유일한 출처이고(붓기가 줄에 다는 수와 같은 식),
 * 이 파일은 그 목록을 자리 안에서 나눠 준다.
 *
 * > `clusterPortPlanner.ts` 에서 갈라져 나왔다(2026-09-02). 짝 테스트가 이미
 * > `module/arith/arms.test.ts` 라는 이름으로 있었다.
 * > `requiredInserterCount`(줄 하나의 인서터 수를 몫 ÷ 운반량으로 따로 세던 함수)는 2026-10-06 에 지웠다 —
 * > 부르는 곳이 없었고, 세는 식이 둘이 되는 자리였다.
 */

import type { SpecInserter } from "../../shared/gamedata/spec";
import { armLoadsOf } from "../../shared/gamedata/spec";
import type { IoLine } from "../types/line";

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
 * 왜 필요한가: 필요한 팔을 다 앉힐 자리가 없을 때, 예전엔 줄여서 놓고
 * **"성공"이라 보고**했다(=조용히 굶는 배치). 이제는 줄여 놓은 결과가 **몇 %인지 계산**해서
 * 호출부가 머신을 그만큼 더 놓고 사용자에게 경고할 수 있게 한다(2026-07-16 사용자 설계).
 *
 * **수량을 모르는 줄은 팔 1개**를 받고 비율 계산에서 빠진다 — 모르는 걸로 굶었다고
 * 단정하지 않는다.
 *
 * ## 줄마다 필요한 팔은 [armLoadsOf] 가 센다 — 여기서 다시 세지 않는다
 *
 * 그 목록은 *인서터마다 옮기는 양*(큰 것부터)이다. 길이가 필요한 팔 수이고, 앞에서 `k` 개의 합이 팔 `k` 개가
 * 옮기는 양이다. 2026-10-06 까지 이 함수는 `팔 수 × 인서터 운반량 ≥ 몫` 이라는 자기 식을 따로 가졌다 — 벨트 한 줄의
 * 상한이 인서터 운반량의 정수배가 아니면 줄에 실제로 다는 수보다 적게 셌다(인서터 12/s · 한 줄 15/s · 몫 30/s 에서
 * 어림 3 · 실제 4). 그러면 어림은 *"다 앉는다"* 고 하고 배치는 자리를 못 찾는다.
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
 * @param maxPerLine 벨트 한 줄이 이 머신과 주고받는 최대([maxRatePerMachinePerLine]). 안 주면 줄의 상한 없이 센다
 *   (몫 전체가 한 줄에 실린다고 본다 — 벨트를 모르는 호출부의 값이다).
 */
export function allocateArms(
  lines: IoLine[],
  perMachineRate: (line: IoLine) => number | undefined,
  seatInserter: SpecInserter | undefined,
  rowBudget: number,
  maxPerLine: number = Infinity,
): ArmBudget {
  const belts = lines.filter((l) => l.kind === "belt");
  const armsByLine = new Map<string, number>();
  const keyOf = (l: IoLine) => `${l.role}:${l.name}`;

  // 줄마다 팔 하나씩은 있어야 한다 — 그것도 못 앉히면 이 머신으론 불가능하다.
  if (belts.length > rowBudget || !seatInserter || !(seatInserter.throughput > 0)) {
    return { armsByLine, speedFraction: 0 };
  }
  for (const l of belts) armsByLine.set(keyOf(l), 1);
  let spent = belts.length;

  /** 줄 → 인서터마다 옮기는 양(큰 것부터). 수량 미상이면 없다. */
  const loadsOf = new Map<string, number[]>();
  for (const l of belts) {
    const rate = perMachineRate(l);
    if (rate === undefined || !Number.isFinite(rate) || rate <= 0) continue;
    const loads = armLoadsOf(rate, maxPerLine, seatInserter);
    if (loads) loadsOf.set(keyOf(l), loads);
  }

  /** 이 줄이 지금 팔로 감당하는 비율(1 = 안 굶음). 수량 미상이면 안 굶는 것으로 본다. */
  const fractionOf = (l: IoLine): number => {
    const loads = loadsOf.get(keyOf(l));
    if (!loads) return 1;
    const arms = armsByLine.get(keyOf(l))!;
    if (arms >= loads.length) return 1; // 필요한 팔이 다 앉았다 — 합으로 다시 재지 않는다(부동소수)
    const carried = loads.slice(0, arms).reduce((sum, v) => sum + v, 0);
    return Math.min(1, carried / perMachineRate(l)!);
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
