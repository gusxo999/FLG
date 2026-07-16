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
 * [트렁크 파이프](../../../../docs/auto-layout-wizard.trunk-pipe.md) — 면을 **우리가 못 고른다**.
 * 머신 `fluid_box` 가 정하고, 호출자가 머신을 돌려 그 면을 W/E 로 맞춘 결과가 [PortPlannerInput.pipeSide]
 * 다. clusterBeltDepth 는 늘 1(파이프는 팔이 없어 머신에 닿아야 한다). 그 면의 아이템 벨트는
 * 케이스 B(좌석 2칸·벨트 `2+r`칸)로만 놓인다. v1 은 유체 줄 1개까지.
 */

import type { SpecBelt, SpecInserter } from "../buildSpec";
import { determineBeltCount } from "../beltThroughput";

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
   * true 인 입력만 노출 N/S 슬롯(`nsFaces`)을 쓸 수 있다 — 내부 간선(홉으로 대체될
   * 라인)은 홉 기하 불변을 위해 W/E 에 남긴다. packModuleTree 가 childFed 판정으로
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
   * [ClusterBeltDepth](../../../../docs/용어사전.md) — 머신 면에서 바깥 칸 거리.
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
   * **[requiredInserterCount](../../../../docs/용어사전.md#requiredinsertercount)** — 머신 한
   * 대의 이 줄을 먹이는 데 필요한 인서터 팔의 개수. **공급 방식과 무관한 물리량**이다
   * (`ceil(머신당 수요 ÷ 인서터 하나 처리량)`) — 탭이면 그 팔들이 같은 [ClusterBelt] 에서
   * 집고([Parallel Inserting](../../../../docs/용어사전.md#parallel-inserting)), 다이렉트면
   * 각자 자기 상자에서 집는다. 팔 **개수** 자체는 어느 쪽이든 같다.
   *
   * [insertingPlanner] 가 [SupplyCapacity] 로 **두 모드 모두에** 채운다. 미지정 = 수량을
   * 모른다(판정 보류 → 소비처가 1로 본다). `planClusterPorts` 자체는 채우지 않는다(용량을
   * 안 본다).
   */
  requiredInserterCount?: number;
}

export interface PortPlannerInput {
  /** 배정할 I/O 줄들(아이템 + 유체). */
  lines: IoLine[];
  /**
   * 고른 인서터들([BuildSpec.inserters](../buildSpec.ts)) — reach 오름차순, 같은 reach 는
   * 하나만. **ClusterBelt 수를 이게 정한다**: 서로 다른 reach 하나당 벨트 한 줄
   * (reach `r` → clusterBeltDepth `1+r`). 옛 `caps.hasNormal/hasLong` 이진값을 대체했다 —
   * reach 가 2종을 넘어도 벨트 줄이 그만큼 는다(하드코딩 아님). throughput 은
   * depth=운반량 매칭의 슬롯 용량으로 쓴다.
   */
  inserters: SpecInserter[];
  /**
   * 출력 라인이 향할 면(부모 방향). 입력 라인은 반대 면을 우선한다. 좌우 계층형에서
   * 부모는 항상 왼쪽이므로 기본 "W". (B) 정책: 출력을 이 면에 **먼저 확정(항상 보장)**,
   * 입력은 반대 면에 채우다 넘치면 이 면의 잔여 슬롯으로 흘린다.
   */
  outputSide: PortSide;
  /**
   * 노출된 끝면(N/S) — 선호 순서. `external` 입력이 E 를 다 쓰고도 남으면 W 로
   * spill 하기 **전에** 이 면들의 레인을 소비한다(E → N/S → W). 노출 판정(count=1 +
   * 열의 끝 + 전역 마진 방향)은 호출자 책임. 미지정=기존 동작(W/E 만).
   */
  nsFaces?: ("N" | "S")[];
  /**
   * **면당 슬롯 수** — 그 면에 줄을 몇 개 세울 수 있나. 주면 아래 "탭 인서팅" 대신
   * 이 수를 쓴다(용어: docs/용어사전.md §D).
   *
   * 두 모델이 있고, 세는 대상이 다르다:
   *
   *  - **탭 인서팅**(Tap Inserting, 미지정 = 기존 동작): 면을 belt 한 줄이 세로로 훑고
   *    머신들이 그 belt 를 인서터로 탭한다. 그래서 한 면이 품는 줄 수 = **고른 인서터들의
   *    서로 다른 reach 값 개수**(reach `r` → clusterBeltDepth `1+r`). `inserters` 에서 유도([laneSlots]).
   *
   *  - **다이렉트 인서팅**(Direct Inserting, 1:1, 트렁크 비활성): belt 가 없다. 머신
   *    둘레 칸마다 `[인서터][상자]` 를 따로 세우므로 한 면이 품는 줄 수 = **그 면의
   *    둘레 칸 수**(W/E=머신 높이, N/S=머신 폭) → 3×3 머신이면 3. depth 는 늘 2
   *    (인서터 1 + 상자 1), 인서터는 늘 일반.
   *
   * 탭 인서팅을 1:1 에 그대로 쓰면 **면 용량을 3이 아니라 2로 세어** 세 번째 입력이
   * 출력면(W)으로 넘친다. 그 포트는 부모 반대편에 태어나 홉이 모듈을 빙 돌아야 하고,
   * 그 우회 belt 가 반출 레인을 가로질러 끊는다 — 채널 장부가 손도 못 대는 곳에서
   * 파이프라인이 무너진다.
   */
  slotsPerFace?: { WE: number; NS: number };
  /**
   * [트렁크 파이프](../../../../docs/용어사전.md)가 차지하는 면 — **우리가 못 고른다.**
   * 머신의 `fluid_boxes` 가 정하고, 호출자(generateModule)가 머신을 돌려 그 면이 W/E 중
   * 하나가 되게 맞춘 결과다. 유체 줄이 있는데 이게 없으면 `complex` 로 위임한다.
   *
   * 이 면의 아이템 벨트가 어떻게 놓이는지는 [isJumpableToClusterPipe] 가 가른다:
   *
   *  - **점프 가능**(true): 파이프는 머신 유체 상자 칸 **하나만** 먹고
   *    [pipeJumpToClusterPipe](../../../../docs/용어사전.md)로 벨트들을 넘어 바깥
   *    [ClusterPipe] 로 나간다. 좌석 줄의 나머지 칸이 살아서 이 면은 **일반 면과 같은**
   *    벨트를 세운다(상자 행만 좌석에서 빠진다 — 그 판정은 호출자가 이 불리언에 접었다).
   *
   *  - **점프 불가**(false/미지정, 옛 동작): clusterBeltDepth 1(좌석 줄) **전체가** 파이프
   *    스파인으로 채워진다 → 아이템 벨트는 [케이스 B](../../../../docs/용어사전.md#케이스-b-파이프-넘김-레인)
   *    로만 놓인다 — reach `r` 인서터가 좌석을 2칸으로 밀어 앉아 파이프를 넘어 `2+r`칸에서
   *    집는다. reach 1 인서터는 1칸에 앉아야 하는데 그 자리가 파이프라 **못 쓴다** →
   *    이 면의 아이템 벨트는 **reach≥2 인서터만** 세울 수 있다.
   */
  pipeSide?: PortSide;
  /**
   * **이 면에서 파이프가 좌석을 비우고 밖으로 점프할 수 있는가** — 호출자(generateModule)가
   * 계산해 넘긴다: 지하파이프 보유 + 점프 거리 충분 + (면 좌석 수 − 상자 행 1) ≥ 벨트 수.
   * planner 는 지하파이프 역학을 모른다 — 이 불리언으로 [pipeSide] 의 슬롯 모양만 가른다.
   */
  isJumpableToClusterPipe?: boolean;
  /**
   * 고를 수 있는 벨트들([BuildSpec.belts](../buildSpec.ts)). [insertingPlanner] 가 이걸로
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

  // ── 유체(pipe) 줄 — [트렁크 파이프](docs/auto-layout-wizard.trunk-pipe.md) ──
  // 면을 우리가 못 고른다(머신 fluid_box 가 정한다). 호출자가 머신을 돌려 그 면을 W/E 로
  // 맞춘 결과가 `pipeSide` 다. depth 는 늘 1 — 파이프는 팔이 없어 머신에 닿아야 한다.
  const pipeLines = lines.filter((l) => l.kind === "pipe");
  const beltLines = lines.filter((l) => l.kind === "belt");
  if (pipeLines.length > 0) {
    // 다이렉트 인서팅은 유체를 다룰 수 없다 — 상자와 머신을 인서터로 잇는 방식인데
    // 유체엔 인서터가 없다. 유체는 **파이프로만** 연결된다 → 트렁크 파이프가 유일한 길.
    if (input.slotsPerFace) {
      return { ok: false, complex: true, reason: "fluid-requires-trunk-pipe" };
    }
    if (!input.pipeSide) {
      return { ok: false, complex: true, reason: "pipe-side-unresolved" };
    }
    if (pipeLines.length > 1) {
      return { ok: false, complex: true, reason: "multi-fluid-not-supported" }; // v1 범위(§5)
    }
  }

  const lanes = laneSlots(inserters);
  if (!input.slotsPerFace && lanes.length === 0) {
    return { ok: false, complex: true, reason: "no-inserter" };
  }

  // 면별 슬롯 풀. 탭 인서팅 = near→far([ClusterBelt] reach 종류당 1). 다이렉트 인서팅 = 그 면의
  // 둘레 칸 수만큼 똑같은 슬롯(clusterBeltDepth 2 = 인서터 1 + 상자 1, reach 1) — 1:1 은
  // 벨트가 없어 깊이가 안 자란다.
  const outputSide = input.outputSide;
  const inputSide: PortSide = outputSide === "W" ? "E" : "W";
  type Slot = { side: PlannedSide; clusterBeltDepth: number; reach: number };
  const rim = input.slotsPerFace;
  const slotsOf = (side: PlannedSide): Slot[] => {
    // 유체가 붙는 면 — [isJumpableToClusterPipe] 가 두 모양을 가른다.
    //  - 점프 가능: 파이프가 상자 칸 하나만 먹고 지하로 벨트를 넘어 ClusterPipe 로 나간다
    //    → 좌석이 살아 **일반 면과 같은** 벨트 목록(아래 lanes 폴스루).
    //  - 점프 불가(옛 스파인): 좌석 줄 전체가 파이프 → 케이스 B(reach≥2 만, 좌석 2칸·벨트 2+r칸).
    if (side === input.pipeSide && !input.isJumpableToClusterPipe) {
      return inserters
        .filter((i) => i.reach >= 2)
        .map((i) => ({ side, clusterBeltDepth: 2 + i.reach, reach: i.reach }));
    }
    if (!rim) return lanes.map((lane) => ({ side, ...lane }));
    const n = side === "W" || side === "E" ? rim.WE : rim.NS;
    return Array.from({ length: Math.max(0, n) }, () => ({
      side,
      clusterBeltDepth: 2,
      reach: 1,
    }));
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
    return { ok: false, complex: true, reason: "belt-demand-exceeds-capacity" };
  }

  /** 줄 → 그 줄의 배정들(줄 수만큼). 등장 순서 보존용. */
  const assigned = new Map<IoLine, PlannedLine[]>();
  // 유체 줄 먼저 — 자리가 강제돼 **선택의 여지가 없다**. 자유도 없는 것부터 못박는다.
  for (const line of pipeLines) {
    assigned.set(line, [{ line, side: input.pipeSide!, clusterBeltDepth: 1, reach: undefined }]);
  }

  // (B) 정책: 출력 먼저 출력면 확정(넘치면 입력면 잔여), 입력은 입력면 우선. 입력이
  // 넘치면 E → (external 한정) 노출 N/S → 출력면 잔여(W) 순 — W-spill 을 최후로 미뤄
  // 상자가 부모-홉이 붐비는 채널 쪽에 태어나는 것을 피한다(kr-glass 갇힘의 원인).
  // 각 풀은 near→far 로 소비. 결과는 등장 순서를 보존해 낸다.
  const take = (primary: Slot[], secondary: Slot[]): Slot =>
    (primary.length ? primary.shift() : secondary.shift())!;
  /** 줄 하나에 벨트 줄 수만큼 슬롯을 뽑아 배정을 만든다. 슬롯이 모자라면 면을 넘나든다. */
  const place = (line: IoLine, pick: (i: number) => Slot): void => {
    const n = beltCountOf(line);
    const out: PlannedLine[] = [];
    for (let i = 0; i < n; i++) {
      const slot = pick(i);
      out.push({
        line,
        side: slot.side,
        clusterBeltDepth: slot.clusterBeltDepth,
        reach: slot.reach,
        beltEntityName: beltProtoOf(line, i),
      });
    }
    assigned.set(line, out);
  };
  for (const line of beltLines.filter((l) => l.role === "output")) {
    place(line, () => take(outPool, inPool));
  }
  // 입력 처리 **순서**: 자식-공급(내부 간선) 먼저, external(raw) 나중.
  //
  // 왜 이 순서인가 — 넘칠 때 **누가 출력면(W)으로 밀려나느냐**가 갈리기 때문이다.
  // 자식-공급 입력이 W(부모 반대편)로 밀려나면 그 줄의 **홉이 모듈을 빙 돌아** 반대편까지
  // 와야 하고, 그 우회 belt 가 W 쪽 다른 포트들의 **바깥 탈출로를 가로질러 끊는다**
  // (2026-07-12 실측: n0 의 kr-components 가 W 로 밀려 홉이 모듈 위를 가로지르는 belt 한
  // 줄을 만들고, 그게 n0 의 W 포트 두 개의 N 탈출로를 막아 반출 skip 3건이 났다).
  // external 입력은 **홉이 없다** — 그냥 perimeter 로 나가면 그만이라 W 로 밀려도 안전하다.
  // 그러니 밀려날 자격이 있는 건 external 쪽이다(제약 센 것에 좋은 자리를 먼저).
  const inputsChildFedFirst = [
    ...beltLines.filter((l) => l.role === "input" && !l.external),
    ...beltLines.filter((l) => l.role === "input" && l.external),
  ];
  for (const line of inputsChildFedFirst) {
    place(line, () =>
      inPool.length ? inPool.shift()!
      : line.external && nsPool.length ? nsPool.shift()!
      : outPool.shift()!,
    );
  }

  // clusterBeltDepth = 운반량순 — (B) 가 정한 면은 유지하고, 같은 면 안에서 깊이/reach 만
  // 재배정: 라인 수요(amount) 내림차순 ↔ 슬롯 용량(인서터 throughput) 내림차순 zip. **수요
  // 신호(amount)가 하나도 없으면 건너뜀**(= (B) 등장순서 = near→far 유지). reach 순서를
  // 가정하지 않고 실제 throughput 으로 정렬한다(사장님 단서).
  // (한 줄이 배정을 여러 개 가질 수 있으므로 **배정 단위**로 재배정한다 — 같은 줄의 두 벨트가
  //  같은 면에 앉았으면 둘 다 그 줄의 수요 신호를 쓴다.)
  const throughputByReach = new Map(inserters.map((i) => [i.reach, i.throughput]));
  const hasDemand = beltLines.some((l) => l.amount !== undefined);
  if (hasDemand) {
    const capOf = (r?: number) => (r === undefined ? 0 : throughputByReach.get(r) ?? 0);
    const demandOf = (p: PlannedLine) => p.line.amount ?? 0;
    const beltPlacements = beltLines.flatMap((l) => assigned.get(l)!);
    for (const face of [outputSide, inputSide, ...(input.nsFaces ?? [])] as PlannedSide[]) {
      // 유체 줄은 제외 — clusterBeltDepth 가 1 로 강제돼 있고 인서터가 없어 재배정 대상이 아니다.
      const facePlacements = beltPlacements.filter((p) => p.side === face);
      if (facePlacements.length <= 1) continue;
      const slots = facePlacements
        .map((p) => ({ clusterBeltDepth: p.clusterBeltDepth, reach: p.reach }))
        .sort((a, b) => capOf(b.reach) - capOf(a.reach));
      const byDemand = [...facePlacements].sort(
        (a, b) => demandOf(b) - demandOf(a) || lines.indexOf(a.line) - lines.indexOf(b.line),
      );
      byDemand.forEach((p, i) => {
        p.clusterBeltDepth = slots[i].clusterBeltDepth;
        p.reach = slots[i].reach;
      });
    }
  }

  return { ok: true, lines: lines.flatMap((l) => assigned.get(l)!) };
}

// ─────────────────────────────────────────────────────────────────────────────
// insertingPlanner — 탭 인서팅으로 합칠 수 있나, 아니면 다이렉트 인서팅으로 남기나
// (docs/auto-layout-wizard.trunk-redesign.md §10, 용어: docs/용어사전.md §D — 2026-07-12
// 사용자 명명. "레인 개수 검사"라는 별도 관문은 만들지 않는다 — 아래 참고.)
// ─────────────────────────────────────────────────────────────────────────────

/** 벨트·인서터가 감당할 수 있는 양(items/sec). 미지정 항목은 무제한으로 본다. */
export interface SupplyCapacity {
  /** 벨트 한 줄의 초당 운반량. 이걸 넘는 품목은 한 줄로 못 나른다. */
  beltCapacity?: number;
  /** 인서터 하나(탭 하나)의 초당 처리량. 머신 한 대의 수요가 이걸 넘으면 못 먹인다. */
  tapCapacity?: number;
  /**
   * 품목별 **클러스터 전체** 초당 수요/산출(items/sec). 키 = `${role}:${name}`.
   * 미지정이면 [requiredInserterCount] 가 `undefined` 를 낸다 — 없는 숫자를 지어내지 않는다.
   */
  lineRates?: Map<string, number>;
}

/** 판정 결과. `plan` 은 그 방식으로 배정한 슬롯이다. */
export interface InsertingDecisionResult {
  /** "tap" = 벨트 한 줄 + 머신별 탭. "direct" = 머신마다 상자+인서터(1:1). */
  mode: "tap" | "direct";
  /** direct 로 떨어진 사유(진단·계측용). mode==="tap" 이면 undefined. */
  reason?: string;
  plan: PortPlan;
}

/**
 * **[requiredInserterCount](../../../../docs/용어사전.md#requiredinsertercount)** — 머신 한
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
): number | undefined {
  const rate = cap.lineRates?.get(`${line.role}:${line.name}`);
  if (rate === undefined) return undefined; // 수치 없음 → 판정 보류(지어내지 않는다)
  if (cap.tapCapacity === undefined || cap.tapCapacity <= 0 || machineCount <= 0) return undefined;
  return Math.max(1, Math.ceil(rate / machineCount / cap.tapCapacity));
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
 * @param lines 이 머신의 I/O 줄들. 유체(pipe)는 인서터가 없어 대상이 아니다.
 * @param perMachineRate 줄별 **머신 한 대의** 초당 수요/산출(items/sec). 모르면 undefined.
 * @param tapCap 인서터 하나의 초당 처리량.
 * @param rowBudget 팔을 앉힐 수 있는 총 행 수(= 쓸 수 있는 면들의 좌석 행 합).
 */
export function allocateArms(
  lines: IoLine[],
  perMachineRate: (line: IoLine) => number | undefined,
  tapCap: number,
  rowBudget: number,
): ArmBudget {
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
 * 먼저 **이 레시피가 [간단한 레시피](용어사전.md#간단한-레시피)인가**를 본다 —
 * 기둥 클러스터로 표현 가능해 탭 인서팅(면에 reach-N 인서터 줄이 지나가는 구조)으로
 * 연속 처리할 수 있는가. **간단한 레시피로 판명나면 레인 자리는 정의상 이미 있다** —
 * 판정 자체가 곧 그 검사이므로 따로 셀 것이 없다. `planClusterPorts` 가 이미 이
 * 판별을 한다(`ok` vs `complex`) — 새로 안 만든다. [복잡한 레시피](용어사전.md#복잡한-레시피)면
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
  input: PortPlannerInput & { slotsPerFace: { WE: number; NS: number } },
  machineCount: number,
  capacity: SupplyCapacity = {},
): InsertingDecisionResult {
  // **팔 개수([requiredInserterCount])를 모드보다 먼저 구한다.** 이건 공급 방식이 정하는 게
  // 아니라 레시피·머신·인서터가 밖에서 정해 주는 물리량이라, 모드를 고르기 전에 이미 정해져
  // 있다. 그래서 탭 계획이든 다이렉트 계획이든 **같은 수**를 달고 나간다 — 다이렉트가 이 수를
  // 모른 채 팔 하나만 놓고 "성공"이라 보고하던 게 굶는 배치의 원인이었다(2026-07-16 실측).
  // 유체 줄은 인서터가 없다(파이프로 흐른다) — 대상이 아니다.
  const armsOf = (plan: PortPlan): void => {
    if (!plan.ok) return;
    for (const planned of plan.lines) {
      if (planned.line.kind !== "belt") continue;
      planned.requiredInserterCount = requiredInserterCount(planned.line, machineCount, capacity);
    }
  };

  const direct = (reason: string): InsertingDecisionResult => {
    const plan = planClusterPorts(input); // slotsPerFace 있음 = 다이렉트 인서팅
    armsOf(plan);
    return { mode: "direct", reason, plan };
  };

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

  // 간단한 레시피 판별 — slotsPerFace 를 빼면 탭 인서팅(기둥 클러스터 면 용량).
  const { slotsPerFace: _drop, ...tapInput } = input;
  const tapPlan = planClusterPorts({ ...tapInput, beltLines: beltLineMap });
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

  // **좌석 예산** — 한 면의 총 탭 수가 그 면의 좌석 행을 넘으면 탭 인서팅으로 못 앉힌다 →
  // 다이렉트로 거른다(안전망). 점프 유체 면은 상자 행 하나를 [fluidboxPipeCell]이 먹으므로 −1.
  const jumpBeltOnPipeSide =
    !!input.isJumpableToClusterPipe &&
    tapPlan.lines.some((p) => p.line.kind === "belt" && p.side === input.pipeSide);
  const rowsOf = (side: PlannedSide): number => {
    const base = side === "W" || side === "E" ? input.slotsPerFace.WE : input.slotsPerFace.NS;
    return side === input.pipeSide && jumpBeltOnPipeSide ? base - 1 : base;
  };
  const tapsOnFace = new Map<PlannedSide, number>();
  for (const p of tapPlan.lines) {
    if (p.line.kind !== "belt") continue;
    tapsOnFace.set(p.side, (tapsOnFace.get(p.side) ?? 0) + (p.requiredInserterCount ?? 1));
  }
  for (const [side, used] of tapsOnFace) {
    if (used > rowsOf(side)) return direct(`seats: ${side} ${used}탭 > ${rowsOf(side)}행`);
  }

  return { mode: "tap", plan: tapPlan };
}
