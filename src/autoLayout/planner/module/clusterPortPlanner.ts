/**
 * **줄과 팔의 낱말** — I/O 줄([IoLine])·배정([PlannedLine])·수요([SupplyCapacity])의 타입과,
 * 팔 개수를 세는 두 함수([requiredInserterCount]·[allocateArms]).
 *
 * > **이름이 낡았다.** 2026-09-02 까지 이 파일에는 `planClusterPorts`·`insertingPlanner`
 * > (= *지도 A*)가 있었고 파일 이름은 그것에서 왔다. 둘은 삭제됐다 — 남은 것은 **낱말과
 * > 산술**뿐이라 더는 "planner" 가 아니다. 파일 이름 정리는 34곳의 import 를 건드리는
 * > 별개 작업이다(`tempPlanDocs/부분-트렁크/`).
 *
 * ## 왜 지웠나 — **읽는 사람이 0이 됐다**
 *
 * 지도 A 는 모듈 하나의 낱말(`tap`/`direct`)과 사유 문장을 냈고, 자리 계산(`PlannedLine[]`)은
 * 아무도 안 읽었다. 그 낱말이 정하던 것이 하나씩 옮겨 갔다:
 *
 * ```
 * 기하        2026-08-16  방출이 통합됐다 — `mode` 로 갈리는 분기가 사라졌다
 * `g`(묶음)   2026-09-01  레인 예산이 정한다(`laneBudget.ts` · trunk-assignment §4.2)
 * 화면 처방    2026-09-02  사실에서 나온다([ModulePortPlan.unpourableFix]·[LaneShortage])
 * ```
 *
 * ## ClusterBeltDepth 규약 (머신 면에서 바깥으로 N칸 — 용어: docs/용어사전.md §D)
 *  - 0칸 = 머신 자신의 가장자리(인서터가 떨구는 목적지).
 *  - 1칸 = 좌석 줄. 인서터가 여기 앉는다. 유체 파이프는 머신 fluid_box 에 닿아야 하므로
 *    **여기 온다**(팔이 없어 머신에 닿아야 한다).
 *  - 2..(1+최대 reach)칸 = [ClusterBelt] 자리. reach `r` 인서터가 좌석(1칸)에 앉아 `1+r`칸의
 *    벨트를 집는다. 그래서 한 면의 레인 수 = **고른 인서터들의 서로 다른 reach 값 개수**
 *    (하드코딩 아님 — 지금 그 수를 세는 곳은 `linkPlanner.laneDepthsOf` 다).
 */

import type { SpecInserter } from "../../buildSpec";
import { armsFor } from "../../buildSpec";

/** 컬럼의 좌/우 면. */
export type PortSide = "W" | "E";

/**
 * 배정 결과가 가리킬 수 있는 면 — 좌/우(W/E) + **노출된 끝면(N/S)**.
 * N/S 는 count=1(퇴화 기둥)의 raw 입력 전용 완화다: 기둥에서 N/S 레인은 끝 머신
 * 1대만 서빙 가능해 일반화가 안 되지만, 머신이 1대면 4면이 전부 동등하다. 노출
 * 여부(열의 끝 + 그 방향 전역 마진)는 호출자(packModuleTree)가 판정해 넘긴다.
 */
export type PlannedSide = PortSide | "N" | "S";

/** I/O 줄의 운반체 종류 — 아이템=belt(인서터 탭), 유체=pipe(스파인, 인서터 없음). */
export type LineKind = "belt" | "pipe";

/** 배정 대상 — 레시피의 한 I/O 품목. */
export interface IoLine {
  /** 품목 이름(아이템/유체). */
  name: string;
  kind: LineKind;
  role: "input" | "output";
  /**
   * craft당 수량 = 운반량(throughput) 프록시. 한 클러스터 내 모든 라인은 같은 craft
   * 속도라 amount 비율이 곧 throughput 비율 → depth(레인) 배정 기준. 미지정=0.
   */
  amount?: number;
  /**
   * 외부 라인(트리 안 생산자 없음 → 무한상자로 살아남아 perimeter 로 나가야 함).
   * true 인 입력만 노출 N/S 슬롯(`nsFaces`)을 쓸 수 있다 — 내부 간선(납품 경로로 대체될
   * 라인)은 납품 경로 기하 불변을 위해 W/E 에 남긴다. packModuleTree 가 childFed 판정으로
   * 채운다. 미지정=내부 취급.
   */
  external?: boolean;
}

/**
 * **한 I/O 줄의 배정 하나** — 줄 하나가 배정을 **여러 개** 가질 수 있다.
 *
 * 수요가 벨트 한 줄을 넘으면 [determineBeltCount] 가 줄 수를 늘리고, 그러면 이 줄은
 * 배정을 그 수만큼 갖는다(각각 자기 면·자기 벨트·자기 포트). 옛 모델은 "줄 하나 = 배정
 * 하나" 였고, 그래서 벨트 한 줄을 넘는 수요를 **거절**할 수밖에 없었다.
 */
export interface PlannedLine {
  line: IoLine;
  side: PlannedSide;
  /**
   * [ClusterBeltDepth](../../../../../docs/용어사전.md) — 머신 면에서 바깥 칸 거리.
   * pipe=1, 벨트=`1+reach`(케이스 B 면 `2+reach`).
   */
  clusterBeltDepth: number;
  /**
   * 이 줄을 집는 인서터의 **reach**. reach `r` 인서터가 좌석에 앉아 `1+r`칸(케이스 B 면
   * `2+r`칸)의 벨트를 집는다. pipe 는 인서터가 없어 undefined.
   */
  reach?: number;
  /**
   * 이 배정이 까는 벨트의 prototype. [determineBeltCount] 가 티어를 고른다(빠른 것부터,
   * 나머지는 그걸 감당하는 가장 싼 것). 미지정이면 호출부의 기본 벨트.
   */
  beltEntityName?: string;
  /**
   * **[requiredInserterCount](../../../../../docs/용어사전.md#requiredinsertercount)** — 머신 한
   * 대의 이 줄을 먹이는 데 필요한 인서터 팔의 개수. **공급 방식과 무관한 물리량**이다
   * (`ceil(머신당 수요 ÷ 인서터 하나 처리량)`) — 탭이면 그 팔들이 같은 [ClusterBelt] 에서
   * 집고([Parallel Inserting](../../../../../docs/용어사전.md#parallel-inserting)), 다이렉트면
   * 각자 자기 상자에서 집는다. 팔 **개수** 자체는 어느 쪽이든 같다.
   *
   * [insertingPlanner] 가 [SupplyCapacity] 로 **두 모드 모두에** 채운다. 미지정 = 수량을
   * 모른다(판정 보류 → 소비처가 1로 본다). `planClusterPorts` 자체는 채우지 않는다(용량을
   * 안 본다).
   */
  requiredInserterCount?: number;
}

  /** 벨트·인서터가 감당할 수 있는 양(items/sec). 미지정 항목은 무제한으로 본다. */
export interface SupplyCapacity {
  /** 벨트 한 줄의 초당 운반량. 이걸 넘는 품목은 한 줄로 못 나른다. */
  beltCapacity?: number;
  /**
   * 품목별 **클러스터 전체** 초당 수요/산출(items/sec). 키 = `${role}:${name}`.
   * 미지정이면 [requiredInserterCount] 가 `undefined` 를 낸다 — 없는 숫자를 지어내지 않는다.
   */
  lineRates?: Map<string, number>;
}

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

