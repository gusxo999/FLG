/**
 * **깊이 예산** — 줄마다 `g`(묶음 크기)를 정한다. 자리를 앉혀 보기 **전에**, 수만으로.
 *
 * 모델은 `docs/auto-layout/module/trunk-assignment.md` **§4.2**("공짜" 의 정확한 뜻).
 *
 * ## 왜 필요한가 — 관통은 깊이를 **독점한다**
 *
 * 벨트가 덮는 행은 그 줄의 **팔이 앉은 행**이다. 그런데 `beltRowSpan` 은 `[최소행, 최대행]`
 * **하나**를 내므로(구멍이 없다), 머신을 걸치는 순간 그 사이의 남의 자리까지 문닫는다.
 *
 * ```
 * g = 1   머신 한 대의 `a_j(m)` 행만        → 여러 품목이 한 깊이를 **나눠 쓴다**
 * g > 1   첫 머신 첫 행 … 끝 머신 끝 행     → **사이 행까지** 먹어 깊이를 독점한다
 * ```
 *
 * 그래서 상한에 `g` 가 들어간다 — 처리량이 준 `g_max`([bundleCap])를 **깊이가 더 깎는다**:
 *
 * ```
 * 모듈 전체:   (g>1 줄 수)  +  (g=1 줄이 있으면 **면 수**)   ≤   Σ_f R_f
 * ```
 *
 * **면마다 따로 세지 않는다** — 선호 면이 차면 반대 면으로 넘어가기 때문이다
 * ([spillLinkFacesToGap]). 좌석 예산이 이미 그렇게 서 있고(모델 §4: *"모듈 전체 = 2h"*),
 * 깊이도 같은 이유로 같은 낟알이다. 면마다 세면 **넘어갈 수 있는 자리를 없다고 세어**
 * 관통을 헛되이 깎는다(2026-09-01 실측: electric-motor 4줄이 E 두 깊이만 보고 둘을 내렸다 —
 * 실제로는 W 의 남은 깊이로 넘어가 넷 다 관통이 선다).
 *
 * 예약이 **면 수**인 것은 `g=1` 줄이 여러 면에 흩어질 수 있어서다 — 좌석이 넘치면
 * 반대 면으로 밀리고, 그 면에도 공용 깊이가 하나 있어야 한다.
 *
 * ## 기본값은 **"공짜일 때만 관통"** (2026-09-01 사용자)
 *
 * 공짜 = *그 관통을 줘도 다른 줄이 밀리지 않는다* = **모듈이 안 커진다.** 예산을 넘으면
 * 관통을 **안 산다**(줄을 `g=1` 로 내린다) — gap 을 벌려서까지 사는 갈래(§4.3 의 ②·③)는
 * 값이 gap 폭이라 격자 클러스터의 몫이다.
 *
 * 근거는 최적화 우선순위다: *"머신 100% 가동이 최우선"*. ②·③ 은 자리가 모자랄 때 **못 앉는
 * 줄**(= 굶는 머신)을 만들 수 있고, ①은 정의상 그럴 수 없다.
 *
 * ## 행이 필요 없다 — **좌석만 맞으면 깊이는 저절로 맞는다**
 *
 * `g=1` 줄의 벨트 조각은 자기 팔이 앉은 행만 덮으므로, 좌석이 서로 다른 행에 배정된 이상
 * 겹칠 수가 없다. 그래서 좌석 검사(`Σ_j a_j(m) ≤ h`)는 [tryLinkFace] 에 그대로 두고,
 * 여기서는 **깊이 개수**만 센다. 들어가는 값이 전부 스펙·수요·정책이라 좌표를 안 본다.
 *
 * > **보수적인 자리 하나.** 관통 줄이 마지막 머신의 꼬리 행을 안 쓰면 그 자리는 비는데
 * > 이 부등식은 안 센다 — 행을 안 보기로 한 대가이고, **틀리는 방향이 안전하다**
 * > (모듈이 커지는 쪽으로 안 틀린다).
 *
 * > **전제: 벨트가 지상으로만 간다.** 지하 벨트(TR7 (나) 잠수)가 생기면 관통이 팔 없는
 * > 구간을 잠수해 지나가므로 한 깊이가 담는 줄이 늘고 **공짜의 범위가 넓어진다.**
 * > 느슨해지는 방향이라 오늘 배치는 안 깨지지만, 그때 이 함수를 다시 세야 한다.
 */

import { bundleCap } from "../../module/link";
import type { SpecBelt } from "../../buildSpec";
import type { IoLine } from "./ioLine";

/** 아이템 줄이 앉을 수 있는 기둥 옆면. gap(N/S)은 `g=1` 전용이라 예산에 안 들어간다. */
export type BudgetFace = "W" | "E";

/** 그 면에 **이미 앉은** 것이 먹은 깊이 — 링크(내부 간선)가 먼저 자리를 잡기 때문이다. */
export interface TakenDepths {
  /** 머신을 걸치는 그룹 수 — 하나가 깊이 하나를 독점한다. */
  spanning: number;
  /** 머신 하나짜리 그룹이 있나 — 있으면 그것들이 깊이 하나를 함께 쓴다. */
  direct: boolean;
}

export interface DepthBudgetInput {
  /**
   * 나머지 줄 — **우선순위 순**(출력 → 자식-공급 입력 → 원료 입력).
   *
   * 예산이 넘치면 **뒤에서부터** 내린다. 순서는 `planModulePorts` 가 쓰는 그 순서 그대로다
   * (제약이 센 것에 좋은 자리를 먼저 — 원료 입력은 납품 경로가 없어 밀려도 안전하다).
   */
  readonly lines: readonly IoLine[];
  readonly count: number;
  /** 품목별 **클러스터 전체** 초당 수요/산출. 키 = `${role}:${name}`. */
  readonly lineRates?: ReadonlyMap<string, number>;
  readonly belts?: readonly SpecBelt[];
  /** 그 면의 깊이 수 `R_f` — [clusterBeltDepthsOf] 가 낸다(유체 면은 지하파이프 사거리로 깎인 값). */
  readonly depthsOf: (face: BudgetFace) => number;
  /** 링크가 먼저 먹은 깊이. 없으면 빈 면으로 본다. */
  readonly taken?: (face: BudgetFace) => TakenDepths;
}

const keyOf = (l: IoLine): string => `${l.role}:${l.name}`;

/**
 * 줄마다 `g` 를 낸다 — 키는 `${role}:${name}`.
 *
 * **되먹임이 없다.** `g_max` → 면 배정 → 부등식 → 넘치면 내림 → 다시 확인, 이 한 방향뿐이고
 * 내릴 때마다 관통 수가 줄어 **반드시 끝난다.** 앉혀 보지 않으므로 되돌릴 것도 없다.
 */
export function planBundles(input: DepthBudgetInput): Map<string, number> {
  const beltTp = input.belts?.[0]?.throughput;
  const g = new Map<string, number>();
  for (const line of input.lines) {
    const total = input.lineRates?.get(keyOf(line));
    const per = total !== undefined && input.count > 0 ? total / input.count : undefined;
    g.set(keyOf(line), bundleCap(input.count, per, beltTp));
  }

  const faces = (["W", "E"] as const).filter((f) => input.depthsOf(f) > 0);
  const base = faces.map((f) => input.taken?.(f) ?? { spanning: 0, direct: false });
  /** 링크가 이미 독점한 깊이를 뺀 **남은 깊이** — 관통과 공용 깊이가 여기서 나눠 갖는다. */
  const depths =
    faces.reduce((n, f) => n + input.depthsOf(f), 0) - base.reduce((n, b) => n + b.spanning, 0);
  const takenDirect = base.some((b) => b.direct);
  /** 이 줄이 깊이를 **독점**하나 — 머신을 걸치면 사이 행까지 먹는다(§4.1). */
  const wide = (l: IoLine): boolean => (g.get(keyOf(l)) ?? 1) > 1;

  // **우선순위가 낮은 줄부터 내린다** — 뒤에서 앞으로. 내릴 때마다 관통이 하나 줄고,
  // 첫 번째로 내리는 순간 공용 깊이 예약이 켜지므로 예산이 **단조 감소**한다 → 반드시 끝난다.
  for (let i = input.lines.length - 1; i >= 0; i--) {
    const narrow = takenDirect || input.lines.some((l) => !wide(l));
    // `g=1` 줄이 있으면 **면마다** 공용 깊이 하나를 예약한다. 그 줄들은 좌석이 넘치면
    // 반대 면으로 밀리는데(그게 `g=1` 의 존재 이유다), 밀려간 면의 깊이를 관통이 이미
    // 독점하고 있으면 **갈 곳을 잃는다**(2026-09-01 실측: 일곱 줄 스펙에서 포트가 사라졌다).
    const budget = depths - (narrow ? faces.length : 0);
    if (input.lines.filter(wide).length <= budget) break;
    if (wide(input.lines[i])) g.set(keyOf(input.lines[i]), 1);
  }
  return g;
}
