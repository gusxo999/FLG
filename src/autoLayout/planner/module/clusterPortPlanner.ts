/**
 * clusterPortPlanner — 한 기둥 클러스터의 I/O 줄(아이템 belt + 유체 pipe)을 어느
 * 면(W/E)·depth(바깥 칸)·인서터에 배정할지 **결정만** 하는 순수 함수.
 *
 * 단일 출처: docs/auto-layout-wizard.known-limits.md(클러스터 형태 일반화) +
 * 본 설계안(간단 레시피 유체 배치).
 *
 * ## 책임 경계 — "계획"이지 "라우팅"이 아니다
 * 본 모듈은 **배정 결정**만 한다. 실제 셀(belt/pipe/inserter) emit 은 belt
 * trunk(`clusterTrunkMerge`)·pipe spine(후속) emitter 가 담당한다. 경로 추적
 * (`containerRouting`)과 역할이 분리되므로 이름이 `...Planner` 다.
 *
 * ## ClusterBeltDepth 규약 (머신 면에서 바깥으로 N칸 — 용어: docs/용어사전.md §D)
 *  - 0칸 = 머신 자신의 가장자리(인서터가 떨구는 목적지).
 *  - 1칸 = 좌석 줄. 인서터가 여기 앉는다. 유체 파이프는 머신 fluid_box 에 닿아야 하므로
 *    **여기 온다**(팔이 없어 머신에 닿아야 한다).
 *  - 2..(1+최대 reach)칸 = [ClusterBelt] 자리. reach `r` 인서터가 좌석(1칸)에 앉아 `1+r`칸의
 *    벨트를 집는다. 그래서 한 면에 세울 수 있는 ClusterBelt 수 = **고른 인서터들의 서로 다른
 *    reach 값 개수**(하드코딩 아님). 1칸이 파이프면 인서터 좌석이 2칸으로 밀려 `2+r`칸에서
 *    집는다(케이스 B).
 *
 * ## 유체(pipe) 줄
 * [트렁크 파이프](../../../../../docs/auto-layout/module/trunk-pipe.md) — 면을 **우리가 못 고른다**.
 * 머신 `fluid_box` 가 정하고, 호출자가 머신을 돌려 그 면을 W/E 로 맞춘 결과가 [PortPlannerInput.pipeFaces]
 * 다. clusterBeltDepth 는 늘 1(파이프는 팔이 없어 머신에 닿아야 한다). 그 면의 아이템 벨트는
 * 케이스 B(좌석 2칸·벨트 `2+r`칸)로만 놓인다 — 단 **점프 모드면 좌석이 살아** 일반 면과 같다.
 * 한 면에 유체 줄이 여럿일 수 있고(`fluidRows`), 그만큼 좌석 행이 빠진다.
 */

import type { SpecBelt, SpecInserter } from "../../buildSpec";
import { armsFor, inserterForReach } from "../../buildSpec";
import { determineBeltCount } from "../../beltThroughput";

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
  /**
   * **이 배정에 앉을 인서터의 prototype** — 계획이 지목하고 방출은 **놓기만** 한다.
   *
   * `reach` 에서 되유도할 수도 있지만(`reach ≥ 2 → 긴팔`) 그러면 팔을 고르는 코드가 두 곳이
   * 되고, reach 가 3종 이상인 모드팩에서 그 되유도가 틀린다. **세는 쪽이 고른 그 팔을 그대로
   * 실어 보내면 어긋날 수가 없다**(계획서 §17.3 불변 2).
   *
   * [insertingPlanner] 가 채운다. 미지정 = 수량 미상 → 방출부의 기본 인서터.
   */
  inserterEntityName?: string;
}

export interface PortPlannerInput {
  /** 배정할 I/O 줄들(아이템 + 유체). */
  lines: IoLine[];
  /**
   * 고른 인서터들([BuildSpec.inserters](../../buildSpec.ts)) — reach 오름차순, 같은 reach 는
   * 하나만. **ClusterBelt 수를 이게 정한다**: 서로 다른 reach 하나당 벨트 한 줄
   * (reach `r` → clusterBeltDepth `1+r`). 옛 `caps.hasNormal/hasLong` 이진값을 대체했다 —
   * reach 가 2종을 넘어도 벨트 줄이 그만큼 는다(하드코딩 아님). throughput 은
   * depth=운반량 매칭의 슬롯 용량으로 쓴다.
   */
  inserters: SpecInserter[];
  /**
   * 출력 라인이 향할 면(부모 방향). 입력 라인은 반대 면을 우선한다. 좌우 계층형에서
   * 부모는 항상 왼쪽이므로 기본 "W". (B) 정책: 출력에 이 면을 **먼저 고르게 하고**,
   * 입력은 반대 면에 채우다 넘치면 이 면의 잔여 슬롯으로 흘린다.
   *
   * **"항상 보장"이 아니다** — 출력도 이 면이 차면 반대 면으로 넘어간다(아래 `place`).
   * 넘치는 이유는 두 가지다: 벨트 자리가 없거나(슬롯 풀 고갈), **좌석 행이 없거나**
   * ([seatRowsPerFace]). 우선권은 "먼저 고른다"이지 "독차지한다"가 아니다.
   */
  outputSide: PortSide;
  /**
   * 노출된 끝면(N/S) — 선호 순서. `external` 입력이 E 를 다 쓰고도 남으면 W 로
   * spill 하기 **전에** 이 면들의 레인을 소비한다(E → N/S → W). 노출 판정(count=1 +
   * 열의 끝 + 전역 마진 방향)은 호출자 책임. 미지정=기존 동작(W/E 만).
   */
  nsFaces?: ("N" | "S")[];
  /**
   * [트렁크 파이프](../../../../../docs/용어사전.md)가 차지하는 면 — **우리가 못 고른다.**
   * 머신의 `fluid_boxes` 가 정하고, 호출자(generateModule)가 머신을 돌려 그 면이 W/E 중
   * 하나가 되게 맞춘 결과다. 유체 줄이 있는데 이게 없으면 `complex` 로 위임한다.
   *
   * 이 면의 아이템 벨트가 어떻게 놓이는지는 `jumpable` 이 가른다:
   *
   *  - **점프 가능**(true): 파이프는 머신 유체 상자 칸 **하나만** 먹고
   *    [pipeJumpToClusterPipe](../../../../../docs/용어사전.md)로 벨트들을 넘어 바깥
   *    [ClusterPipe] 로 나간다. 좌석 줄의 나머지 칸이 살아서 이 면은 **일반 면과 같은**
   *    벨트를 세운다(유체 상자 행만 좌석에서 빠진다 — 그 판정은 호출자가 이 불리언에 접었다).
   *
   *  - **점프 불가**(false/미지정, 옛 동작): clusterBeltDepth 1(좌석 줄) **전체가** 파이프
   *    스파인으로 채워진다 → 아이템 벨트는 [케이스 B](../../../../../docs/용어사전.md#케이스-b-파이프-넘김-레인)
   *    로만 놓인다 — reach `r` 인서터가 좌석을 2칸으로 밀어 앉아 파이프를 넘어 `2+r`칸에서
   *    집는다. reach 1 인서터는 1칸에 앉아야 하는데 그 자리가 파이프라 **못 쓴다** →
   *    이 면의 아이템 벨트는 **reach≥2 인서터만** 세울 수 있다.
   *
   * **면이 여럿일 수 있다** — 유체 입력(E)과 출력(W)이 동시에 있으면 양 면이 다 유체 면이다.
   * 그래서 목록으로 받는다.
   *
   * `fluidRows` = 그 면의 유체 줄 수(줄마다 자기 행). 점프 모드에서 좌석 줄이 그만큼 빠진다.
   * planner 는 지하파이프 역학을 모른다 — `jumpable` 이라는 답만 받아 슬롯 모양을 가른다.
   */
  pipeFaces?: readonly { side: PortSide; fluidRows: number; jumpable: boolean }[];
  /**
   * 고를 수 있는 벨트들([BuildSpec.belts](../../buildSpec.ts)). [insertingPlanner] 가 이걸로
   * [determineBeltCount] 를 돌려 줄 수를 정한다. **미지정이면 줄 수를 안 늘린다**(옛 동작:
   * 수요가 벨트 한 줄을 넘으면 거절).
   */
  belts?: SpecBelt[];
  /**
   * 줄별 **벨트 줄 수** — 키 `${role}:${name}`, 값 = [determineBeltCount] 가 고른 벨트들.
   * 그 줄은 배정을 `길이` 만큼 갖고, 각 배정이 자기 벨트·자기 포트를 갖는다.
   *
   * **미지정이거나 그 줄이 없으면 1줄**(옛 동작) — 수요를 모르면 지어내지 않는다.
   * [insertingPlanner] 가 [SupplyCapacity.lineRates] 와 고른 벨트로 계산해 넣는다.
   */
  beltLines?: Map<string, SpecBelt[]>;
  /**
   * **면당 좌석 행 수** — 그 면에 인서터 팔을 몇 개까지 앉힐 수 있나(= 그 면의 둘레 칸).
   *
   * 벨트 줄 수([laneSlots] = 서로 다른 reach 개수, 보통 2)와 **세는 대상이 다르다**: 저건
   * "벨트를 몇 줄 세우나", 이건 "팔을 몇 개 앉히나"(머신 높이, 보통 7). 배정 하나가 벨트 자리
   * **하나**를 먹으면서 팔은 **여러 개**([armsByPlacement]) 앉힐 수 있어 서로 유도되지 않는다.
   *
   * 이게 없던 동안 배분기는 좌석을 아예 못 봤고, 그래서 팔 4개짜리 줄을 좌석 3칸인 면에
   * 통째로 몰아넣은 뒤 **사후에** 거절당했다(→ 다이렉트 폴백). 이제 배분의 **입력**이라
   * 면이 차면 그 자리에서 다음 면으로 넘어간다.
   *
   * **미지정 = 무한**(옛 동작). [insertingPlanner] 의 탭 계획에만 넣는다 — 다이렉트는
   * 상자·인서터가 둘레 칸을 직접 먹어 셈이 다르고, 무엇보다 **항상 성립하는 폴백**이어야
   * 하므로 이 장부로 실패시키지 않는다.
   */
  seatRowsPerFace?: { WE: number; NS: number };
  /**
   * **면별로 이미 쓰인 좌석 행** — [seatRowsPerFace] 에서 뺀다. 링크 방출
   * (`emitOutputLinks`/`emitInputLinks`)이 tap/direct 와 **무관하게** 먼저 자리를 잡으므로,
   * 남은 줄들은 그만큼 줄어든 예산을 봐야 한다. 안 빼면 배분기가 이미 찬 자리를 또 배정해
   * 셀이 겹친다. 미지정 = 0(옛 동작).
   */
  seatRowsUsed?: Partial<Record<PlannedSide, number>>;
  /**
   * 줄별 **배정마다의 팔 개수** — 키 `${role}:${name}`, 값 = 배정 순서대로의 팔 수
   * ([beltLines] 와 길이가 같다). 배분기가 [seatRowsPerFace] 에서 차감할 양이다.
   *
   * 총합([requiredInserterCount])을 배정들에 어떻게 쪼갤지는 [insertingPlanner] 가 정한다 —
   * 여기선 이미 쪼개진 결과만 받는다(배분기는 용량을 안 본다는 경계 유지).
   * **미지정 = 배정당 1개**(옛 동작).
   */
  armsByPlacement?: Map<string, number[]>;
  /**
   * **이 배정을 `reach` 인 팔로 먹이면 팔이 몇 개인가** — [armsByPlacement] 의 reach 판.
   *
   * 팔 개수는 스칼라가 아니라 *어느 인서터가 앉느냐*의 함수다(계획서 §16). 그리고 어느
   * 인서터가 앉느냐는 **이 배분기가 슬롯을 고르는 순간** 정해진다 — 그래서 배분기가
   * **물어봐야** 한다. 예전엔 호출부가 `reach 1` 기준으로 미리 세어 넘겼고, 그 뒤에
   * 깊이/reach 를 재배정해서 **센 수가 무효가 됐다**(계획서 §15).
   *
   * 미지정이면 [armsByPlacement] 로 폴백(= reach 무관 옛 동작).
   */
  armsAtReach?: (line: IoLine, placementIndex: number, reach: number) => number | undefined;
}

/** 배정 성공(줄별 결과) 또는 복잡(배정 불가 → 2D 대상). */
export type PortPlan =
  | { ok: true; lines: PlannedLine[] }
  | { ok: false; complex: true; reason: string };

/**
 * 탭 인서팅(Tap Inserting)의 면당 [ClusterBelt] 목록 — **고른 인서터의 reach 로 결정**.
 * reach `r` 인서터 하나 → 좌석(1칸)에 앉아 clusterBeltDepth `1+r`칸의 벨트 한 줄. 서로 다른
 * reach 하나당 벨트 한 줄이라, 벨트 줄 수 = **서로 다른 reach 값 개수**(하드코딩 아님).
 * `inserters` 는 이미 reach 오름차순·중복 제거돼 있다([makeBuildSpec]) → near→far 순.
 * 합계 슬롯 수(= 2면 × 벨트 줄 수)는 `columnTapCapacity` 와 정확히 일치한다.
 */
function laneSlots(inserters: SpecInserter[]): { clusterBeltDepth: number; reach: number }[] {
  return inserters.map((i) => ({ clusterBeltDepth: 1 + i.reach, reach: i.reach }));
}

/**
 * 클러스터 I/O 줄을 면·clusterBeltDepth·reach 에 배정. 벨트 줄 수는 [laneSlots] 가 고른
 * 인서터의 reach 로 정한다(하드코딩 아님). 결정적((B) 정책: 출력→출력면 먼저 확정,
 * 입력→반대 면 우선·넘치면 출력면 잔여; 각 면 near→far, 등장 순서 보존).
 */
export function planClusterPorts(input: PortPlannerInput): PortPlan {
  const { lines, inserters } = input;

  if (lines.length === 0) return { ok: true, lines: [] };

  // ── 유체(pipe) 줄은 **여기서 안 다룬다**(2026-07-24) ──────────────────────────
  // 유체 면은 우리가 못 고른다 — 머신 fluid_box 가 강제하고, 그 결과(fluidTrunk.side)를 아는
  // [generateModule] 이 유체 [PlannedLine] 을 직접 만든다. 자리를 못 잡는 세 경우
  // (트렁크 미해결·다이렉트·다중 유체)의 판정도 그리로 옮겼다 — 셋 다 "통째로 정직히 실패"로
  // 같은 결과다(테스트: trunkPipe.test.ts "유체 관문").
  //
  // 여기 남은 유체 관련 입력은 [PortPlannerInput.pipeFaces] 하나뿐이고, 그건 **아이템** 배치용
  // 이다: 그 면의 좌석(d1)을 파이프가 먹으므로 아이템을 케이스 B(깊이)로 민다.
  //
  // 그래도 **조용히 무시하지는 않는다** — 유체 줄이 여기까지 왔다면 배선이 어긋난 것이고,
  // 조용히 사라지면 그 머신이 유체를 못 받고 굶는데 아무도 모른다.
  const beltLines = lines.filter((l) => l.kind === "belt");
  if (beltLines.length !== lines.length) {
    return { ok: false, complex: true, reason: "fluid-handled-by-generateModule" };
  }

  const lanes = laneSlots(inserters);
  if (lanes.length === 0) {
    return { ok: false, complex: true, reason: "no-inserter" };
  }

  // 면별 슬롯 풀 — 탭 인서팅뿐이다: near→far([ClusterBelt] reach 종류당 1).
  const outputSide = input.outputSide;
  /** 이 면이 유체 면인가 — 맞으면 그 면의 유체 행 수와 점프 여부. */
  const pipeFaceOf = (side: PlannedSide) => input.pipeFaces?.find((f) => f.side === side);
  const inputSide: PortSide = outputSide === "W" ? "E" : "W";
  type Slot = { side: PlannedSide; clusterBeltDepth: number; reach: number };
  const slotsOf = (side: PlannedSide): Slot[] => {
    // 유체가 붙는 면 — `jumpable` 이 두 모양을 가른다.
    //  - 점프 가능: 파이프가 유체 상자 칸 하나만 먹고 지하로 벨트를 넘어 ClusterPipe 로 나간다
    //    → 좌석이 살아 **일반 면과 같은** 벨트 목록(아래 lanes 폴스루).
    //  - 점프 불가(옛 스파인): 좌석 줄 전체가 파이프 → 케이스 B(reach≥2 만, 좌석 2칸·벨트 2+r칸).
    if (pipeFaceOf(side) && !pipeFaceOf(side)!.jumpable) {
      return inserters
        .filter((i) => i.reach >= 2)
        .map((i) => ({ side, clusterBeltDepth: 2 + i.reach, reach: i.reach }));
    }
    return lanes.map((lane) => ({ side, ...lane }));
  };
  const outPool = slotsOf(outputSide); // 출력 우선 면(부모 쪽)
  const inPool = slotsOf(inputSide); // 입력 우선 면(자식 쪽)
  // 노출 끝면 풀 — external 입력 전용 완화. 용량 게이트엔 안 넣는다(N/S 는 W/E 로
  // 성립하는 레시피의 배치를 개선할 뿐, 불가능하던 레시피를 가능하게 하지 않는다 —
  // complex 판정 보수 유지).
  const nsPool = (input.nsFaces ?? []).flatMap((f) => slotsOf(f));

  // 줄마다 **벨트를 몇 줄 까나** — [determineBeltCount] 가 수요에서 유도한 값을 호출부가
  // 넣어준다. 없으면 1(수요를 모르면 지어내지 않는다). 이 수만큼 슬롯을 먹고, 배정도 그만큼
  // 나온다 — 그래서 수요가 벨트 한 줄을 넘어도 **거절하지 않고 줄을 늘려** 감당한다.
  const beltCountOf = (l: IoLine): number =>
    Math.max(1, input.beltLines?.get(`${l.role}:${l.name}`)?.length ?? 1);
  const beltProtoOf = (l: IoLine, i: number): string | undefined =>
    input.beltLines?.get(`${l.role}:${l.name}`)?.[i]?.entityName;

  // 용량은 **아이템 줄만** 센다 — 유체 줄은 파이프 자리(clusterBeltDepth 1)를 따로 쓰고
  // 벨트 슬롯을 소비하지 않는다. 대신 그 면의 벨트 줄을 이미 케이스 B(reach≥2만)로 깎았다(slotsOf).
  const slotsNeeded = beltLines.reduce((n, l) => n + beltCountOf(l), 0);
  if (slotsNeeded > outPool.length + inPool.length) {
    // **이 거절은 벨트 티어와 무관하다.** 한 면이 세울 수 있는 [ClusterBelt] 수 =
    // **서로 다른 reach 값 개수**([laneSlots]) 라, 모자란 것은 처리량이 아니라 **레인**이다.
    // 옛 이름(`belt-demand-exceeds-capacity`)은 화면의 처방을 4단계(벨트)로 보냈는데, 벨트를
    // 바꿔서는 절대 안 풀린다 — 오히려 [determineBeltCount] 가 줄을 늘려 더 나빠질 수 있다.
    // 실제 지렛대는 **긴팔 인서터(reach≥2)를 고르는 것**이다(면당 레인이 1 → 2로 는다).
    //
    // 유체 면은 한 번 더 깎인다: 점프 불가면 좌석 줄이 통째로 파이프라 케이스 B(reach≥2 전용)
    // 가 되어, 긴팔이 없으면 그 면의 레인이 **0** 이다(slotsOf). 그래서 유체 레시피는 아이템
    // 줄이 둘만 돼도 여기 걸린다 — 그리고 유체는 다이렉트 폴백이 없어(planModulePorts)
    // 그 거절이 곧 모듈 실패다. 숫자를 문구에 담는 이유가 이것이다.
    const faceOf = (side: PlannedSide, pool: Slot[]): string =>
      `${side}${pool.length}${pipeFaceOf(side) && !pipeFaceOf(side)!.jumpable ? "(유체·reach≥2 전용)" : ""}`;
    const reaches = [...new Set(inserters.map((i) => i.reach))].sort((a, b) => a - b);
    return {
      ok: false,
      complex: true,
      reason:
        `lanes-exceed-capacity (벨트 ${slotsNeeded}줄 > 레인 ` +
        `${faceOf(outputSide, outPool)}+${faceOf(inputSide, inPool)}` +
        `; 고른 인서터 reach [${reaches.join(",")}])`,
    };
  }

  /** 줄 → 그 줄의 배정들(줄 수만큼). 등장 순서 보존용. */
  const assigned = new Map<IoLine, PlannedLine[]>();

  // ── 면별 좌석 행 장부 ──
  // 벨트 자리와 **따로 세는 두 번째 자원**이다. 배정 하나는 벨트 슬롯 1개를 먹으면서 팔은
  // 여러 개 앉힌다 — 그래서 슬롯이 남아도 좌석이 없어 그 면을 못 쓰는 일이 생긴다. 그럴 때
  // 다음 면으로 넘어가는 게 이 장부의 존재 이유다(옛 코드엔 이 축이 아예 없었다).
  // 미지정이면 무한 → 옛 동작 그대로(장부가 아무것도 막지 않는다).
  const seatRowsOf = (side: PlannedSide): number => {
    const rows = input.seatRowsPerFace;
    if (!rows) return Infinity;
    const base = side === "W" || side === "E" ? rows.WE : rows.NS;
    // 점프 유체 면은 유체 상자 행 하나를 [fluidboxPipeCell] 이 먹는다 → 좌석 한 줄 감소.
    const pf = pipeFaceOf(side);
    const afterPipe = pf?.jumpable ? base - pf.fluidRows : base;
    // 링크 방출이 먼저 먹은 행을 뺀다([seatRowsUsed]).
    return Math.max(0, afterPipe - (input.seatRowsUsed?.[side] ?? 0));
  };
  const rowsLeft = new Map<PlannedSide, number>();
  const rowsLeftOf = (side: PlannedSide): number => rowsLeft.get(side) ?? seatRowsOf(side);
  /**
   * 이 배정을 `reach` 인 팔로 먹이면 팔이 몇 개인가. **`undefined` 는 "이 슬롯으로는 못 센다"** —
   * 그 reach 의 처리량을 모른다는 뜻이라 [takeSeat] 이 그 슬롯을 **건너뛴다**. 1 로 때우면
   * 셀 수 없는 슬롯이 **가장 싼 슬롯처럼 보여** 먼저 뽑힌다.
   */
  const armsAt = (l: IoLine, i: number, reach: number): number | undefined =>
    input.armsAtReach?.(l, i, reach) ?? input.armsByPlacement?.get(`${l.role}:${l.name}`)?.[i];

  // (B) 정책: 출력이 출력면을 **먼저 고르고**(차면 입력면으로 넘어간다), 입력은 입력면 우선.
  // 입력이 넘치면 E → (external 한정) 노출 N/S → 출력면 잔여(W) 순 — W-spill 을 최후로 미뤄
  // 상자가 부모-납품 경로가 붐비는 채널 쪽에 태어나는 것을 피한다(kr-glass 갇힘의 원인).
  // 각 풀은 near→far 로 소비. 결과는 등장 순서를 보존해 낸다.
  //
  // 풀을 앞에서부터 훑되 **좌석이 남은 슬롯만** 집는다. 좌석이 모자라 건너뛴 슬롯은 풀에
  // 남는다 — 팔이 적은 다른 줄이 나중에 쓸 수 있기 때문이다(자리를 낭비하지 않는다).
  //
  // **한 풀 안에서는 팔이 가장 적게 드는 슬롯부터 본다.** 슬롯이 곧 인서터이고(reach 는
  // 고정 거리 — 계획서 §16), 인서터가 팔 개수를 정하기 때문이다. 예전엔 near→far 로 아무거나
  // 집고 **나중에 깊이/reach 를 재배정**했는데, 그러면 좌석 장부가 예산한 팔과 실제로 앉는
  // 팔이 어긋났다(계획서 §15). 여기서 고르면 어긋날 수가 없다.
  //
  // 동률이면 near→far(풀 순서) — 얕은 쪽이 벨트 칸을 덜 먹는다.
  const takeSeat = (pools: Slot[][], line: IoLine, i: number): { slot: Slot; arms: number } | undefined => {
    /** 어느 풀에서든 셀 수 있는 슬롯을 하나라도 봤나 — **줄 전체 기준**이다(아래 참고). */
    let anyKnown = false;
    for (const pool of pools) {
      let best = -1;
      let bestArms = 0;
      for (let k = 0; k < pool.length; k++) {
        const arms = armsAt(line, i, pool[k].reach);
        if (arms === undefined) continue; // 이 슬롯으로는 못 센다 — 건너뛴다
        anyKnown = true;
        if (rowsLeftOf(pool[k].side) < arms) continue;
        if (best < 0 || arms < bestArms) {
          best = k;
          bestArms = arms;
        }
      }
      if (best < 0) continue;
      const [slot] = pool.splice(best, 1);
      rowsLeft.set(slot.side, rowsLeftOf(slot.side) - bestArms);
      return { slot, arms: bestArms };
    }
    // **어느 슬롯으로도 못 셀 때만** 옛 동작으로 — near→far 첫 자리, 팔 1개로 본다(수량 미상).
    //
    // `anyKnown` 을 풀마다 따로 보면 안 된다: 셀 수 있는 슬롯이 자리가 없어 밀려난 줄이
    // **다음 면에서 "못 세는 슬롯"을 만나 1개짜리로 앉아 버린다.** 그러면 좌석 예산이
    // 거절해야 할 배치가 통과하고, 그 줄은 조용히 굶는다(2026-08-15 실측: 팔 4개짜리 줄이
    // 3행 면에서 밀린 뒤 반대 면의 reach-2 슬롯에 1개로 앉았다).
    if (anyKnown) return undefined;
    for (const pool of pools) {
      const k = pool.findIndex((s) => rowsLeftOf(s.side) >= 1);
      if (k < 0) continue;
      const [slot] = pool.splice(k, 1);
      rowsLeft.set(slot.side, rowsLeftOf(slot.side) - 1);
      return { slot, arms: 1 };
    }
    return undefined;
  };
  /**
   * 줄 하나에 벨트 줄 수만큼 슬롯을 뽑아 배정을 만든다. 슬롯이든 좌석이든 모자라면 다음
   * 면으로 넘어가고, 어느 면에도 없으면 `overflow` 에 남겨 호출부가 complex 로 낸다.
   */
  let overflow: string | undefined;
  const place = (line: IoLine, pools: Slot[][]): void => {
    const n = beltCountOf(line);
    const out: PlannedLine[] = [];
    for (let i = 0; i < n; i++) {
      const taken = takeSeat(pools, line, i);
      if (!taken) {
        overflow ??= `${line.role}:${line.name}`;
        return;
      }
      out.push({
        line,
        side: taken.slot.side,
        clusterBeltDepth: taken.slot.clusterBeltDepth,
        reach: taken.slot.reach,
        beltEntityName: beltProtoOf(line, i),
      });
    }
    assigned.set(line, out);
  };
  /**
   * **정책 묶음 안에서는 수요 내림차순으로 놓는다.**
   *
   * 면을 고르는 정책(출력 먼저 → 자식-공급 입력 → external 입력)은 **묶음의 순서**이고,
   * 이 정렬은 **묶음 안**만 바꾼다 — 정책은 그대로다. 왜 필요한가: [takeSeat] 이 팔이 가장
   * 적게 드는 슬롯을 집으므로, 수요가 작은 줄이 먼저 오면 **좋은 슬롯을 먼저 가져가** 수요가
   * 큰 줄이 느린 팔로 밀린다. 큰 줄부터 고르면 그 뒤집힘이 안 생긴다(재배열 부등식).
   *
   * 예전엔 배정이 끝난 뒤 *수요 ↔ 처리량* 으로 **다시 붙여** 같은 효과를 냈는데, 그때는 이미
   * 팔을 세고 좌석을 찬 뒤라 셈이 무효가 됐다(계획서 §15).
   * 수요 신호(`amount`)가 없으면 등장 순서 그대로다(안정 정렬).
   */
  const byDemandDesc = (ls: IoLine[]): IoLine[] =>
    ls
      .map((l, i) => ({ l, i }))
      .sort((a, b) => (b.l.amount ?? 0) - (a.l.amount ?? 0) || a.i - b.i)
      .map(({ l }) => l);

  for (const line of byDemandDesc(beltLines.filter((l) => l.role === "output"))) {
    place(line, [outPool, inPool]);
  }
  // 입력 처리 **순서**: 자식-공급(내부 간선) 먼저, external(raw) 나중.
  //
  // 왜 이 순서인가 — 넘칠 때 **누가 출력면(W)으로 밀려나느냐**가 갈리기 때문이다.
  // 자식-공급 입력이 W(부모 반대편)로 밀려나면 그 줄의 **납품 경로가 모듈을 빙 돌아** 반대편까지
  // 와야 하고, 그 우회 belt 가 W 쪽 다른 포트들의 **바깥 탈출로를 가로질러 끊는다**
  // (2026-07-12 실측: n0 의 kr-components 가 W 로 밀려 납품 경로가 모듈 위를 가로지르는 belt 한
  // 줄을 만들고, 그게 n0 의 W 포트 두 개의 N 탈출로를 막아 반출 skip 3건이 났다).
  // external 입력은 **납품 경로가 없다** — 그냥 perimeter 로 나가면 그만이라 W 로 밀려도 안전하다.
  // 그러니 밀려날 자격이 있는 건 external 쪽이다(제약 센 것에 좋은 자리를 먼저).
  const inputsChildFedFirst = [
    ...byDemandDesc(beltLines.filter((l) => l.role === "input" && !l.external)),
    ...byDemandDesc(beltLines.filter((l) => l.role === "input" && l.external)),
  ];
  for (const line of inputsChildFedFirst) {
    place(line, line.external ? [inPool, nsPool, outPool] : [inPool, outPool]);
  }
  // 벨트 자리는 [slotsNeeded] 게이트가 이미 봤으므로, 여기 걸리는 건 사실상 **좌석**이다 —
  // 두 면의 좌석을 다 써도 팔이 남는 레시피. 정직하게 거절하고 다이렉트로 물러난다.
  if (overflow) {
    return { ok: false, complex: true, reason: `seats-exceed-capacity (${overflow})` };
  }

  // **깊이/reach 재배정은 여기 없다** (2026-08-15 삭제 — 계획서 §15·§16).
  //
  // 예전엔 배정이 끝난 뒤 같은 면 안에서 *수요 내림차순 ↔ 슬롯 처리량 내림차순* 으로
  // 깊이/reach 를 **다시 붙였다**. 그 자체는 옳은 짝짓기였지만 **순서가 거꾸로였다**:
  // 팔 개수는 이미 앞 단계에서 `reach 1` 기준으로 세어져 좌석 장부에 반영된 뒤였고,
  // 여기서 팔의 실체가 바뀌어도 아무도 다시 세지 않았다. 깊은 벨트로 옮겨진 줄은
  // **느린 팔이 앉는데 빠른 팔 기준으로 센 개수**를 받아 조용히 굶었다.
  //
  // 이제 [takeSeat] 이 슬롯을 고르는 **그 자리에서** `armsAt(line, i, slot.reach)` 를 물어
  // 팔이 가장 적게 드는 슬롯을 집고 그만큼 좌석을 찬다 — 짝짓기와 셈이 같은 순간에 일어나
  // 어긋날 수가 없다. 별도 재배정 패스가 필요 없어졌다.

  return { ok: true, lines: lines.flatMap((l) => assigned.get(l)!) };
}

// ─────────────────────────────────────────────────────────────────────────────
// insertingPlanner — 탭 인서팅으로 합칠 수 있나, 아니면 다이렉트 인서팅으로 남기나
// (docs/auto-layout/module/trunk-redesign.md §10, 용어: docs/용어사전.md §D — 2026-07-12
// 사용자 명명. "레인 개수 검사"라는 별도 관문은 만들지 않는다 — 아래 참고.)
// ─────────────────────────────────────────────────────────────────────────────

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
 * 판정 결과 — **계획을 내는 쪽은 탭뿐이다.**
 *
 * 예전엔 `{ mode, reason?, plan }` 한 모양이었고 다이렉트도 `plan: { ok: true, lines: [] }` 를
 * 달고 나갔다. *"성공했는데 배정 0건"* 이라는 타입상 거짓말이라, **다이렉트는 계획을 안 낸다**는
 * 사실이 관례로만 존재했다(2026-08-05 공급 모델 통합에서 기계별 포트가 링크 배분기로 옮겨간
 * 뒤의 자국). 유니온으로 가르면 다이렉트 가지에서 `plan` 을 읽는 것이 **타입 에러**가 된다 —
 * [ModulePortPlan.rest] 가 이름으로 산 것과 같은 종류의 이득이다.
 */
export type InsertingDecisionResult =
  /** 벨트 한 줄 + 머신별 탭. 이 방식으로 배정한 슬롯이 `plan` 에 든다. */
  | { mode: "tap"; plan: { ok: true; lines: PlannedLine[] } }
  /**
   * 머신마다 상자+인서터(1:1). **자리는 여기서 안 잡는다** — 기계별 포트는 링크 배분기
   * ([allocateLinkFaces])가 맡으므로 이 결과가 답하는 것은 **판정과 사유**뿐이다.
   * 배정을 두 곳이 내면 좌석 장부가 갈린다.
   */
  | { mode: "direct"; reason: string };

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
 * **이 정당화가 없으면 그냥 낙관이고, 낙관은 조용히 굶는다**(계획서 §15.4).
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

/**
 * **이 클러스터를 트렁크(탭 인서팅)로 합칠 수 있는가**를 판정하고, 되는 쪽의 슬롯
 * 배정을 함께 낸다.
 *
 * ## 판정 순서 — "레인 개수 검사"는 별도 관문이 아니다
 *
 * 먼저 **이 레시피가 [간단한 레시피](../../../../../docs/용어사전.md#간단한-레시피)인가**를 본다 —
 * 기둥 클러스터로 표현 가능해 탭 인서팅(면에 reach-N 인서터 줄이 지나가는 구조)으로
 * 연속 처리할 수 있는가. **간단한 레시피로 판명나면 레인 자리는 정의상 이미 있다** —
 * 판정 자체가 곧 그 검사이므로 따로 셀 것이 없다. `planClusterPorts` 가 이미 이
 * 판별을 한다(`ok` vs `complex`) — 새로 안 만든다. [복잡한 레시피](../../../../../docs/용어사전.md#복잡한-레시피)면
 * 정의상 다이렉트(1:1)로 간다.
 *
 * 그다음 두 축을 본다([SupplyCapacity.lineRates] 가 있을 때만) — **섞으면 안 된다**:
 *  - **[requiredInserterCount]**(인서터 처리량) — 머신 한 대의 한 줄에 팔이 몇 개 필요한가.
 *    **모드가 정하는 값이 아니라서** 탭/다이렉트를 고르기 전에 구해 **두 계획 모두에** 단다.
 *    면별 총 팔 수가 좌석 행을 넘으면 탭으로 못 앉힌다([Parallel Inserting] 좌석 예산).
 *  - **벨트 처리량** — 클러스터 전체 수요가 벨트 한 줄을 넘는가. 팔을 늘려도 안 풀리고,
 *    공유 벨트가 없는 다이렉트엔 이 축이 아예 없다 → 탭 경로 전용 거절.
 *
 * 하나라도 걸리면 **모듈 전체가 다이렉트 인서팅으로 물러난다**(v1 결정, §10.4-1).
 * 부분 병합(한 면은 트렁크, 다른 면은 1:1)은 같은 면에서 벨트와 상자가 자리를 다투므로
 * 보류했다 — 되돌아갈 곳(1:1)이 **항상 유효**하다는 게 이 설계의 안전망이다(§2-②).
 */
export function insertingPlanner(
  input: PortPlannerInput,
  machineCount: number,
  /**
   * **면당 좌석 행 수**(그 면의 둘레 칸) — 이 함수 **자신의** 입력이다.
   *
   * 예전엔 `PortPlannerInput.slotsPerFace` 로 들어와 여기서 빼낸 뒤 `seatRowsPerFace` 라는
   * **다른 이름으로 다시 넣었다** — `planClusterPorts` 는 그 필드를 읽은 적이 없으므로(읽던
   * rim 모드는 2026-08-05 에 삭제됐다) 존재 이유가 개명뿐이었다.
   */
  seatRows: { WE: number; NS: number },
  capacity: SupplyCapacity = {},
): InsertingDecisionResult {
  // **팔 개수([requiredInserterCount])를 모드보다 먼저 구한다.** 이건 공급 방식이 정하는 게
  // 아니라 레시피·머신·인서터가 밖에서 정해 주는 물리량이라, 모드를 고르기 전에 이미 정해져
  // 있다. 그래서 탭 계획이든 다이렉트 계획이든 **같은 수**를 달고 나간다 — 다이렉트가 이 수를
  // 모른 채 팔 하나만 놓고 "성공"이라 보고하던 게 굶는 배치의 원인이었다(2026-07-16 실측).
  // 유체 줄은 인서터가 없다(파이프로 흐른다) — 대상이 아니다.
  // 면 하나에 앉힐 수 있는 좌석 행 수(= 그 면의 둘레 칸). 모르면 무한(옛 동작).
  // 링크 방출이 먼저 먹은 행은 뺀다 — W/E 예산이 한 수라 **보수적으로 큰 쪽**을 뺀다
  // (정밀한 면별 차감은 planClusterPorts 의 [seatRowsUsed] 가 따로 한다).
  const linkUsedWE = Math.max(input.seatRowsUsed?.W ?? 0, input.seatRowsUsed?.E ?? 0);
  const rowsPerFace = Math.max(1, seatRows.WE - linkUsedWE);

  // **슬롯도 처리량도 `input.inserters` 하나에서 나온다**(계획서 §18). 예전엔 같은 자료가
  // `SupplyCapacity` 로도 흘러 두 벌이었고, 둘이 어긋나면 *"reach 는 서는데 처리량은
  // 모르는 슬롯"* 이 생겨 [armsAt] 이 셀 수 없었다.
  const inserters = input.inserters;
  const reaches = [...new Set(inserters.map((i) => i.reach))].sort((a, b) => a - b);

  /**
   * 줄별 **팔 개수(머신 한 대 전체)** — 배정 수와 무관한 물리량이지만 **어느 팔이 앉느냐에는
   * 의존한다**(계획서 §16). 아래에서 배정들에 **나눠** 앉힌다. 통째로 달면 배정이 둘일 때
   * 팔이 두 배가 된다(2026-07-16 버그).
   */
  const armsTotalOf = (line: IoLine, reach: number): number | undefined =>
    requiredInserterCount(line, machineCount, capacity, inserterForReach(inserters, reach));

  /**
   * **팔이 가장 적게 드는 reach** — 배정 수를 잡을 때의 기준이다.
   *
   * 배정 수는 배분기가 슬롯을 고르기 **전에** 정해야 하는데(슬롯을 몇 개 뽑을지 알아야
   * 하므로) 슬롯이 곧 팔이라 순환처럼 보인다. **가장 좋은 팔을 받았을 때의 수**로 잡아
   * 끊는다 — 더 나쁜 슬롯을 받으면 팔이 늘고, 그러면 [takeSeat] 이 **그 자리에서 정직하게
   * 거절**해 다이렉트로 물러난다. 낙관이 조용한 굶음이 아니라 **보이는 폴백**으로 끝난다.
   */
  const bestReachFor = (line: IoLine): number | undefined => {
    let best: number | undefined;
    let bestArms = Infinity;
    for (const r of reaches) {
      const a = armsTotalOf(line, r);
      if (a === undefined) continue;
      if (a < bestArms) {
        bestArms = a;
        best = r;
      }
    }
    return best;
  };

  /**
   * 이 줄이 배정을 **몇 개** 가져야 하나 — 두 가지가 각각 배정을 요구하고, **더 큰 쪽**을 따른다:
   *  - **벨트 처리량**([determineBeltCount]): 수요가 벨트 한 줄을 넘으면 줄이 는다.
   *  - **팔**: 배정 하나가 받을 수 있는 팔은 `min(면 좌석 행, 그릇)` 이다 → `ceil(팔 ÷ 그 수)`.
   *    (한 줄의 팔이 W 에 7개, E 에 6개로 나뉘어 앉는 식. 각 배정이 자기 벨트·자기 포트다.)
   *
   * **좌석 행만 보면 안 된다**(2026-07-23 수정). 예전엔 `ceil(팔 ÷ 면 행)` 만 봤는데, 배정
   * 하나가 감당하는 팔은 좌석과 그릇 **둘 중 작은 쪽**이라 좌석만으로는 모자랄 수 있다.
   * 그러면 [armsByPlacement] 의 마지막 배정이 남은 팔을 다 받아 **자기 벨트를 넘겨 싣는다**
   * (7×7 머신·벨트 45/s·팔 10/s·수요 90/s 에서 배정 2개로 잡혀 부하가 [40, **50**] 이 됐다).
   * 배정 수를 같은 상한에서 유도하면 마지막 배정도 구성상 넘칠 수 없다.
   */
  const placementsOf = (line: IoLine): number => {
    const key = `${line.role}:${line.name}`;
    const chosen = beltLineMap.get(key);
    const belts = chosen?.length ?? 1;
    const reach = bestReachFor(line);
    const arms = reach === undefined ? undefined : armsTotalOf(line, reach);
    if (arms === undefined) return Math.max(1, belts); // 팔 수 미상 — 지어내지 않는다
    // 그릇은 **실제로 깔릴 벨트 중 가장 느린 것**으로 잰다(보수적). 벨트를 못 골랐으면
    // (수요 미상) 이 축은 없다 — 옛 동작대로 좌석만 본다.
    // 팔 처리량은 위에서 고른 reach 의 것이다 — 그릇도 *어느 팔이 앉느냐*의 함수다.
    const tp = inserterForReach(inserters, reach)?.throughput ?? 0;
    const slowest = chosen?.length ? Math.min(...chosen.map((b) => b.throughput)) : undefined;
    const grail = slowest !== undefined && tp > 0 ? Math.floor(slowest / tp) : Infinity;
    const perPlacement = Math.max(1, Math.min(rowsPerFace, grail));
    const byArms = Number.isFinite(perPlacement) ? Math.ceil(arms / perPlacement) : 1;
    return Math.max(1, belts, byArms);
  };

  /**
   * 줄별 **배정마다의 팔 개수** — 배분기의 좌석 장부([PortPlannerInput.seatRowsPerFace])와
   * 최종 [PlannedLine.requiredInserterCount] 가 **같은 수**를 봐야 한다. 그래서 여기서 한 번
   * 쪼개 두 곳이 함께 읽는다(따로 계산하면 장부가 예산한 좌석과 실제로 앉는 팔이 어긋난다).
   * 수량 미상인 줄은 넣지 않는다 → 양쪽 다 "배정당 1개"로 보수적으로 본다.
   */
  /** `줄 → reach → 배정마다의 팔 개수`. reach 축이 있는 것이 §16 의 전부다. */
  const armsByPlacement = new Map<string, Map<number, number[]>>();
  /** 배분기가 슬롯을 고르는 순간 묻는다 — 그 슬롯의 팔로 이 배정을 먹이면 몇 개인가. */
  const armsAtReach = (line: IoLine, i: number, reach: number): number | undefined =>
    armsByPlacement.get(`${line.role}:${line.name}`)?.get(reach)?.[i];
  /**
   * 쪼개 둔 팔 개수를 계획의 배정들에 순서대로 단다(배정 순서 = 그 줄의 벨트 순서).
   * **배정이 받은 `reach` 로 읽는다** — 배분기가 좌석을 찬 수와 같은 수여야 한다.
   */
  const armsOf = (plan: PortPlan): void => {
    if (!plan.ok) return;
    const nth = new Map<string, number>();
    for (const planned of plan.lines) {
      if (planned.line.kind !== "belt") continue;
      const key = `${planned.line.role}:${planned.line.name}`;
      const i = nth.get(key) ?? 0;
      nth.set(key, i + 1);
      const byReach = armsByPlacement.get(key);
      planned.requiredInserterCount =
        planned.reach === undefined ? undefined : byReach?.get(planned.reach)?.[i]; // 미상 = 보류
      // **엔티티는 슬롯 목록(`input.inserters`)에서 뽑는다** — 슬롯이 거기서 났으므로
      // 언제나 찾힌다. 처리량 출처(`capacity.inserters`)에서 뽑으면 두 목록이 어긋날 때
      // 비고, 그러면 방출부의 폴백(= reach 되유도)이 살아난다.
      planned.inserterEntityName = inserterForReach(input.inserters, planned.reach)?.entityName;
    }
  };

  /**
   * **탭이 안 된다** — 자리를 여기서 잡지 않는다.
   *
   * 예전엔 여기서 rim 모델로 1:1 배정을 함께 냈고, 그 모델이 사라진 뒤에도 빈 계획
   * (`{ ok: true, lines: [] }`)을 달고 나갔다. 지금은 [InsertingDecisionResult] 가 유니온이라
   * **다이렉트 가지에 `plan` 이 아예 없다** — 배정을 두 곳이 내면 좌석 장부가 갈린다는 사실을
   * 관례가 아니라 타입이 지킨다.
   */
  const direct = (reason: string): InsertingDecisionResult => ({ mode: "direct", reason });

  // **벨트 줄 수** — 수요가 벨트 한 줄을 넘으면 [determineBeltCount] 가 줄을 늘린다(빠른
  // 것부터, 나머지는 그걸 감당하는 가장 싼 벨트로). 팔 개수와 **다른 축**이다: 벨트 상한은
  // 팔을 늘려도 안 풀리고(벨트가 못 나른다), 반대로 벨트를 늘려도 팔은 그대로 필요하다.
  //
  // 벨트를 안 골랐으면(belts 없음) 줄을 못 늘린다 → 옛 규칙대로 `beltCapacity` 초과는 거절.
  const beltLineMap = new Map<string, SpecBelt[]>();
  if (input.belts?.length) {
    for (const line of input.lines) {
      if (line.kind !== "belt") continue;
      const key = `${line.role}:${line.name}`;
      const chosen = determineBeltCount(capacity.lineRates?.get(key), input.belts);
      if (chosen.length > 0) beltLineMap.set(key, chosen);
    }
  }

  // **배정 수 = max(벨트 축, 좌석 축).** 팔이 면 하나의 행보다 많으면 배정을 하나 더 만들어
  // **면을 넘나든다**(W 에 7개, E 에 6개…). 그 추가 배정도 자기 벨트가 필요한데, 수요는 이미
  // 벨트 축이 덮었으므로 **가장 싼 벨트**를 붙인다(넉넉한 건 괜찮다 — 모자라면 안 될 뿐).
  // 벨트를 안 골랐으면 줄을 못 늘리므로 좌석 축도 포기한다(→ 옛 동작: 좌석 초과는 거절).
  const placementMap = new Map<string, SpecBelt[]>(beltLineMap);
  if (input.belts?.length) {
    const cheapest = [...input.belts].sort((a, b) => a.throughput - b.throughput)[0];
    for (const line of input.lines) {
      if (line.kind !== "belt") continue;
      const key = `${line.role}:${line.name}`;
      const want = placementsOf(line);
      const have = placementMap.get(key) ?? [];
      if (want <= have.length) continue;
      placementMap.set(key, [...have, ...Array(want - have.length).fill(have.at(-1) ?? cheapest)]);
    }
  }

  // 배정 수가 확정됐으니 팔을 그 배정들에 쪼갠다. 이 결과를 배분기의 좌석 장부와 최종
  // [PlannedLine] 이 **함께** 읽는다.
  //
  // **채워서 쪼갠다(고르게 아님).** 고르게 나누면 자리가 남는데도 굶는다: 팔 10개를 [5,5] 로
  // 나누면 7행짜리 면에 2행씩 남기고, 그 남은 자리는 조각나서 다른 줄도 못 쓴다. [7,3] 으로
  // 채우면 한 면을 비워 다음 줄에 통째로 넘겨줄 수 있다(2026-07-17 실측: kr-sand 가 [5,5] 라
  // stone 4팔이 갈 곳을 잃었다 — [7,3] 이면 E 의 4행에 정확히 앉는다).
  //
  // 배정 하나가 받을 수 있는 팔은 **두 상한 중 작은 쪽**이다 — 섞으면 안 된다:
  //  - **좌석**: 면 하나의 행보다 많이 앉을 수 없다.
  //  - **벨트**: 그 배정의 벨트가 나르는 양보다 많이 집을 수 없다. 벨트가 여러 줄인 건 수요가
  //    한 줄을 넘었다는 뜻이라, 한 줄에 팔을 몰면 그 벨트가 먼저 터진다.
  //
  // **reach 마다 한 벌씩 쪼갠다.** 어느 슬롯을 받을지는 배분기가 정하므로, 미리 한 벌만
  // 만들어 두면 그 슬롯이 아닌 팔이 앉았을 때 수가 어긋난다(계획서 §15 의 그 어긋남).
  for (const line of input.lines) {
    if (line.kind !== "belt") continue;
    const key = `${line.role}:${line.name}`;
    const belts = placementMap.get(key);
    const n = belts?.length ?? 1;
    const byReach = new Map<number, number[]>();
    for (const reach of reaches) {
      const tapCap = inserterForReach(inserters, reach)?.throughput ?? 0;
      const total = armsTotalOf(line, reach);
      if (total === undefined || tapCap <= 0) continue; // 미상 — 지어내지 않는다
      /** 이 배정이 받을 수 있는 팔 상한(좌석 ∧ 벨트). 최소 1 — 배정이 있으면 팔은 있어야 한다. */
      const capOf = (i: number): number => {
        const beltArms = belts?.[i] ? Math.floor(belts[i].throughput / tapCap) : Infinity;
        return Math.max(1, Math.min(rowsPerFace, beltArms));
      };
    // **합은 언제나 `total` 이다** — 상한에 막혀도 팔 개수를 깎지 않는다. 이건 협상 대상이
    // 아닌 물리량이라([requiredInserterCount]), 깎아서 적어내면 그 계획은 "성공"이라 보고하며
    // 조용히 굶는다(2026-07-16 실측의 근원). 마지막 배정이 남은 걸 다 받고, **안 들어가면**
    // 좌석 장부가 거절해 다이렉트로 물러난다 — 정직한 실패.
    //
    // 그 대가: 마지막 배정이 자기 벨트 상한을 넘을 수 있다(팔은 앉는데 벨트가 못 나르는 경우).
    // 벨트 축의 정밀화는 별도다 — 벨트 분할·합류가 없는 지금은 어차피 폴백뿐이다.
      const arms: number[] = [];
      let left = total;
      for (let i = 0; i < n; i++) {
        // 뒤에 남은 배정마다 최소 1개는 남겨 둔다 — 배정이 있는데 팔이 0이면 그 벨트는 헛것이다.
        const give = i === n - 1 ? left : Math.max(1, Math.min(capOf(i), left - (n - i - 1)));
        arms.push(give);
        left -= give;
      }
      byReach.set(reach, arms);
    }
    if (byReach.size > 0) armsByPlacement.set(key, byReach);
  }

  // 간단한 레시피 판별 — 탭 인서팅(기둥 클러스터 면 용량)으로 배정해 본다.
  // **좌석 장부는 여기(탭)에만 준다** — 다이렉트는 항상 성립하는 폴백이어야 한다.
  const tapPlan = planClusterPorts({
    ...input,
    beltLines: placementMap,
    seatRowsPerFace: seatRows,
    armsAtReach,
  });
  if (!tapPlan.ok) return direct(`complex: ${tapPlan.reason}`);
  armsOf(tapPlan);

  // 줄 수를 못 정했는데(벨트 미선택) 수요가 벨트 한 줄을 넘으면 여전히 거절 → 다이렉트.
  // 다이렉트엔 공유 벨트가 없어 이 축 자체가 없다.
  for (const planned of tapPlan.lines) {
    if (planned.line.kind !== "belt") continue;
    const key = `${planned.line.role}:${planned.line.name}`;
    if (beltLineMap.has(key)) continue; // 줄 수로 감당했다
    const rate = capacity.lineRates?.get(key);
    if (rate !== undefined && capacity.beltCapacity !== undefined && rate > capacity.beltCapacity) {
      return direct(`belt: demand>beltCap (${planned.line.name})`);
    }
  }

  // **좌석 예산 재검은 없다**(2026-08-06 삭제). 예전엔 여기서 면별 탭 수를 다시 세어 넘치면
  // 다이렉트로 물렀는데, 그 그물은 **구성상 걸릴 수 없었다** — 예산을 배정 시점보다 후하게
  // 잡았기 때문이다: [seatRowsUsed] 를 안 뺐고, 점프 유체 면 차감에도 조건이 하나 더 붙어
  // 있었다(`jumpBeltOnPipeSide`). 게다가 [takeSeat] 이 배정 **시점에** 좌석을 보고 자리가
  // 모자란 슬롯을 건너뛰므로, 통과한 계획이 나중에 걸릴 여지가 없다.
  //
  // 안전망의 값은 *"장부가 틀렸을 때 잡는 것"* 인데 장부보다 느슨한 그물은 **틀려도 못 잡는다.**
  // 없는 보호를 있다고 적어 두는 쪽이 더 위험하다.
  return { mode: "tap", plan: tapPlan };
}
