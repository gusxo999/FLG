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
 * ## depth 규약 (머신 면에서 바깥으로 N칸)
 *  - 0칸 = 머신 자신의 가장자리(인서터가 떨구는 목적지).
 *  - 1칸 = 인접 칸. 유체 파이프는 머신 fluid_box 에 닿아야 하므로 **항상 1칸**.
 *  - 아이템 belt: 가까운 레인 = 2칸(일반 인서터 seat 1칸), 먼 레인 = 3칸(긴팔 seat
 *    1칸, 가까운 belt 위로 넘김). 1칸이 파이프면 → 긴팔 seat 2칸·belt 4칸(케이스 B).
 *
 * ## 유체(pipe) 줄
 * [트렁크 파이프](../../../../docs/auto-layout-wizard.trunk-pipe.md) — 면을 **우리가 못 고른다**.
 * 머신 `fluid_box` 가 정하고, 호출자가 머신을 돌려 그 면을 W/E 로 맞춘 결과가 [PortPlannerInput.pipeSide]
 * 다. depth 는 늘 1(파이프는 팔이 없어 머신에 닿아야 한다). 그 면의 아이템 벨트는 케이스 B
 * (긴팔 seat 2칸·belt 4칸)로만 놓이므로 레인이 **하나로 준다**. v1 은 유체 줄 1개까지.
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

/** belt 를 모는 인서터 종류. */
export type InserterRole = "normal" | "long";

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

/** 한 I/O 줄의 배정 결과. */
export interface PlannedLine {
  line: IoLine;
  side: PlannedSide;
  /** 머신 면에서 바깥 칸 거리. pipe=1, belt 가까운=2, 먼=3, 파이프 위 넘김=4. */
  depth: number;
  /** belt 를 모는 인서터. pipe 는 인서터가 없어 undefined. */
  inserter?: InserterRole;
}

/** 배정에 쓸 인서터 능력 — `ShapeCaps` 와 동형. */
export interface PortPlannerCaps {
  /** reach 1(거리 1) 일반 인서터 보유. */
  hasNormal: boolean;
  /** reach≥2 긴팔 인서터 보유. */
  hasLong: boolean;
}

export interface PortPlannerInput {
  /** 배정할 I/O 줄들(아이템 + 유체). */
  lines: IoLine[];
  caps: PortPlannerCaps;
  /**
   * 출력 라인이 향할 면(부모 방향). 입력 라인은 반대 면을 우선한다. 좌우 계층형에서
   * 부모는 항상 왼쪽이므로 기본 "W". (B) 정책: 출력을 이 면에 **먼저 확정(항상 보장)**,
   * 입력은 반대 면에 채우다 넘치면 이 면의 잔여 슬롯으로 흘린다.
   */
  outputSide: PortSide;
  /**
   * 인서터별 실제 throughput(items/sec). depth(레인) 배정 = **면 안에서 라인 운반량
   * (amount) 내림차순 ↔ 슬롯 용량(이 throughput) 내림차순 매칭**. reach 순서를 가정하지
   * 않고 실제 throughput 으로 정렬(사장님 단서). 미지정이면 depth 는 (B) 등장순서 유지.
   */
  throughput?: { normal: number; long: number };
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
   *    머신들이 그 belt 를 인서터로 탭한다. 그래서 한 면이 품는 줄 수 = **인서터 종류 수**
   *    (일반=가까운 레인, 긴팔=먼 레인) → 최대 2. `caps` 에서 유도([laneSlots]).
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
   * 이 면은 **depth 1 이 파이프로 채워진다.** 그래서 이 면의 아이템 벨트는
   * [케이스 B](../../../../docs/용어사전.md#케이스-b-파이프-넘김-레인)로만 놓을 수 있다 —
   * 긴팔이 depth 2 에 앉아 파이프를 넘어 depth 4 에서 집는다. 일반 인서터는 depth 1 에
   * 앉아야 하는데 그 자리가 파이프라 **못 쓴다** → 이 면의 아이템 레인은 **하나뿐**이다.
   */
  pipeSide?: PortSide;
}

/** 배정 성공(줄별 결과) 또는 복잡(배정 불가 → 2D 대상). */
export type PortPlan =
  | { ok: true; lines: PlannedLine[] }
  | { ok: false; complex: true; reason: string };

/**
 * 탭 인서팅(Tap Inserting)의 면당 belt 레인 — 인서터 능력으로 결정. 가까운 레인(2칸, 일반)
 * + 먼 레인(3칸, 긴팔). 긴팔은 거리 1을 못 집어 가까운 레인은 일반 전용, 먼 레인은 긴팔 전용.
 * 합계 슬롯 수(= 2면 × 레인수)는 `columnTapCapacity` 와 정확히 일치한다.
 */
function laneSlots(caps: PortPlannerCaps): { depth: number; inserter: InserterRole }[] {
  const lanes: { depth: number; inserter: InserterRole }[] = [];
  if (caps.hasNormal) lanes.push({ depth: 2, inserter: "normal" });
  if (caps.hasLong) lanes.push({ depth: 3, inserter: "long" });
  return lanes;
}

/**
 * 클러스터 I/O 줄을 면·depth·인서터에 배정. 1단계: **아이템 belt 만** — 면당 레인
 * 모델 재현. 유체 줄이 있으면 미구현이라 `complex` 위임. 결정적((B) 정책: 출력→출력면
 * 먼저 확정, 입력→반대 면 우선·넘치면 출력면 잔여; 각 면 near→far, 등장 순서 보존).
 */
export function planClusterPorts(input: PortPlannerInput): PortPlan {
  const { lines, caps } = input;

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

  const lanes = laneSlots(caps);
  if (!input.slotsPerFace && lanes.length === 0) {
    return { ok: false, complex: true, reason: "no-inserter" };
  }

  // 면별 슬롯 풀. 탭 인서팅 = near→far(인서터 종류당 1). 다이렉트 인서팅 = 그 면의 둘레
  // 칸 수만큼 똑같은 슬롯(depth 2 = 인서터 1 + 상자 1, 일반 인서터) — 1:1 은 레인이 없어
  // depth 가 안 자란다.
  const outputSide = input.outputSide;
  const inputSide: PortSide = outputSide === "W" ? "E" : "W";
  type Slot = { side: PlannedSide; depth: number; inserter: InserterRole };
  const rim = input.slotsPerFace;
  const slotsOf = (side: PlannedSide): Slot[] => {
    // 트렁크 파이프가 지나가는 면 — depth 1 이 파이프다. 아이템은 케이스 B 로만 놓인다:
    // 긴팔이 depth 2 에 앉아 파이프를 넘어 depth 4 에서 집는다. 일반 인서터는 depth 1 에
    // 앉아야 하는데 그 자리가 파이프라 못 쓴다 → **이 면의 아이템 레인은 하나뿐**.
    if (side === input.pipeSide) {
      return caps.hasLong ? [{ side, depth: 4, inserter: "long" as InserterRole }] : [];
    }
    if (!rim) return lanes.map((lane) => ({ side, ...lane }));
    const n = side === "W" || side === "E" ? rim.WE : rim.NS;
    return Array.from({ length: Math.max(0, n) }, () => ({
      side,
      depth: 2,
      inserter: "normal" as InserterRole,
    }));
  };
  const outPool = slotsOf(outputSide); // 출력 우선 면(부모 쪽)
  const inPool = slotsOf(inputSide); // 입력 우선 면(자식 쪽)
  // 노출 끝면 풀 — external 입력 전용 완화. 용량 게이트엔 안 넣는다(N/S 는 W/E 로
  // 성립하는 레시피의 배치를 개선할 뿐, 불가능하던 레시피를 가능하게 하지 않는다 —
  // complex 판정 보수 유지).
  const nsPool = (input.nsFaces ?? []).flatMap((f) => slotsOf(f));

  // 용량은 **아이템 줄만** 센다 — 유체 줄은 파이프 자리(depth 1)를 따로 쓰고 인서터 레인을
  // 소비하지 않는다. 대신 그 면의 레인 수를 이미 케이스 B(1개)로 깎았다(slotsOf).
  if (beltLines.length > outPool.length + inPool.length) {
    return { ok: false, complex: true, reason: "belt-demand-exceeds-capacity" };
  }

  const assigned = new Map<IoLine, PlannedLine>();
  // 유체 줄 먼저 — 자리가 강제돼 **선택의 여지가 없다**. 자유도 없는 것부터 못박는다.
  for (const line of pipeLines) {
    assigned.set(line, { line, side: input.pipeSide!, depth: 1, inserter: undefined });
  }

  // (B) 정책: 출력 먼저 출력면 확정(넘치면 입력면 잔여), 입력은 입력면 우선. 입력이
  // 넘치면 E → (external 한정) 노출 N/S → 출력면 잔여(W) 순 — W-spill 을 최후로 미뤄
  // 상자가 부모-홉이 붐비는 채널 쪽에 태어나는 것을 피한다(kr-glass 갇힘의 원인).
  // 각 풀은 near→far 로 소비. 결과는 등장 순서를 보존해 낸다.
  const take = (primary: Slot[], secondary: Slot[]): Slot =>
    (primary.length ? primary.shift() : secondary.shift())!;
  for (const line of beltLines.filter((l) => l.role === "output")) {
    const slot = take(outPool, inPool);
    assigned.set(line, { line, side: slot.side, depth: slot.depth, inserter: slot.inserter });
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
    const slot =
      inPool.length ? inPool.shift()!
      : line.external && nsPool.length ? nsPool.shift()!
      : outPool.shift()!;
    assigned.set(line, { line, side: slot.side, depth: slot.depth, inserter: slot.inserter });
  }

  // depth(레인) = 운반량순 — (B) 가 정한 면은 유지하고, 같은 면 안에서 depth/inserter 만
  // 재배정: 라인 수요(amount) 내림차순 ↔ 슬롯 용량(throughput) 내림차순 zip. throughput
  // 미지정이면 건너뜀(= (B) 등장순서 depth 유지, 하위호환).
  const tp = input.throughput;
  if (tp) {
    const capOf = (r?: InserterRole) => (r === "long" ? tp.long : tp.normal);
    const demandOf = (l: IoLine) => l.amount ?? 0;
    for (const face of [outputSide, inputSide, ...(input.nsFaces ?? [])] as PlannedSide[]) {
      // 유체 줄은 제외 — depth 가 1 로 강제돼 있고 인서터가 없어 재배정 대상이 아니다.
      const faceLines = beltLines.filter((l) => assigned.get(l)!.side === face);
      if (faceLines.length <= 1) continue;
      const slots = faceLines
        .map((l) => { const p = assigned.get(l)!; return { depth: p.depth, inserter: p.inserter }; })
        .sort((a, b) => capOf(b.inserter) - capOf(a.inserter));
      const byDemand = [...faceLines].sort(
        (a, b) => demandOf(b) - demandOf(a) || lines.indexOf(a) - lines.indexOf(b),
      );
      byDemand.forEach((l, i) => {
        const p = assigned.get(l)!;
        p.depth = slots[i].depth;
        p.inserter = slots[i].inserter;
      });
    }
  }

  return { ok: true, lines: lines.map((l) => assigned.get(l)!) };
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
   * 미지정이면 [determineBeltCount] 는 **건너뛴다** — 없는 숫자를 지어내지 않는다.
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
 * 벨트·인서터가 이 품목을 감당하는지 판정 — 안 되면 사유를 낸다.
 *
 * **v1 은 거절만 한다**(→ [insertingPlanner] 가 모듈 전체를 다이렉트로 되돌린다).
 * 후속 단계에서 여기가 `ceil(수요÷벨트용량)` 로 벨트 줄 수를 나눠 감당하게 하는
 * 자리가 될 것 — 분할 처리를 다른 곳이 아니라 **여기서** 하는 게 적절해 보인다는
 * 평가를 남긴다(2026-07-12, 사용자).
 */
function determineBeltCount(
  line: IoLine,
  machineCount: number,
  cap: SupplyCapacity,
): string | undefined {
  const rate = cap.lineRates?.get(`${line.role}:${line.name}`);
  if (rate === undefined) return undefined; // 수치 없음 → 판정 보류
  if (cap.beltCapacity !== undefined && rate > cap.beltCapacity) {
    return `demand>beltCap (${line.name})`;
  }
  if (cap.tapCapacity !== undefined && machineCount > 0 && rate / machineCount > cap.tapCapacity) {
    // 머신 한 대가 자기 몫을 인서터 하나로 못 받는다 — 탭을 늘려야 하는데 v1 은 탭 1개/머신.
    return `perMachine>tapCap (${line.name})`;
  }
  return undefined;
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
 * 그다음 [determineBeltCount] — 품목마다 벨트 한 줄·인서터 하나가 양을 감당하는가
 * ([SupplyCapacity.lineRates] 가 있을 때만 검사).
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
  const direct = (reason: string): InsertingDecisionResult => ({
    mode: "direct",
    reason,
    plan: planClusterPorts(input), // slotsPerFace 있음 = 다이렉트 인서팅
  });

  // 간단한 레시피 판별 — slotsPerFace 를 빼면 탭 인서팅(기둥 클러스터 면 용량).
  const { slotsPerFace: _drop, ...tapInput } = input;
  const tapPlan = planClusterPorts(tapInput);
  if (!tapPlan.ok) return direct(`complex: ${tapPlan.reason}`);

  // 간단한 레시피로 판명났다 → 벨트·인서터 처리량만 남는다. 유체 줄은 벨트가 아니라
  // 파이프로 흐르므로 이 검사의 대상이 아니다(파이프 처리량은 아직 안 잰다 — trunk-pipe §8).
  for (const line of input.lines) {
    if (line.kind !== "belt") continue;
    const why = determineBeltCount(line, machineCount, capacity);
    if (why) return direct(`belt: ${why}`);
  }

  return { mode: "tap", plan: tapPlan };
}
