/**
 * **줄의 낱말** — 모듈 하나가 안팎으로 주고받는 I/O 줄([IoLine])과 그 줄의 배정
 * ([PlannedLine]), 그리고 그 줄이 나르는 양([SupplyCapacity]).
 *
 * **여기엔 판단이 없다** — 타입뿐이다. 그래서 계획·배정·방출이 다 같은 낱말을 쓰면서도
 * 서로를 import 하지 않는다.
 *
 * > **이 낱말들은 `clusterPortPlanner.ts` 에 있었다**(2026-09-02 분리). 그 파일에는
 * > `planClusterPorts`·`insertingPlanner`(= *지도 A*)가 함께 있었고 이름도 거기서 왔는데,
 * > 둘이 삭제되면서 낱말만 남았다. 팔 산술은 [allocateArms] 로 갈라 두었다 —
 * > 그쪽은 **수를 세는 일**이고 이쪽은 **이름을 정하는 일**이다.
 *
 * ## ClusterBeltDepth 규약 (머신 면에서 바깥으로 N칸 — 용어: docs/용어사전.md §D)
 *  - 0칸 = 머신 자신의 가장자리(인서터가 떨구는 목적지).
 *  - 1칸 = 좌석 줄. 인서터가 여기 앉는다. 유체 파이프는 머신 fluid_box 에 닿아야 하므로
 *    **여기 온다**(팔이 없어 머신에 닿아야 한다).
 *  - 2..(1+최대 reach)칸 = [ClusterBelt] 자리. reach `r` 인서터가 좌석(1칸)에 앉아 `1+r`칸의
 *    벨트를 집는다. 그래서 한 면의 레인 수 = **고른 인서터들의 서로 다른 reach 값 개수**
 *    (하드코딩 아님 — 그 수를 세는 곳은 `linkPlanner.laneDepthsOf` 다).
 */

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
