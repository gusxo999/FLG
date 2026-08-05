/**
 * fluidPorts — 머신의 **유체 입구가 어느 칸에 있나**를 답한다. 그리고 그 입구가 우리가
 * 원하는 면을 보도록 **머신을 몇 도 돌려야 하나**를 답한다.
 *
 * 단일 출처: docs/auto-layout-wizard.trunk-pipe.md §3 / §6.
 *
 * ## 왜 이게 따로 필요한가
 * 아이템은 인서터가 **머신 둘레 아무 칸에나** 앉는다 — 우리가 자리를 고른다. 유체는 아니다.
 * 파이프는 팔이 없어서 **프로토타입이 정한 칸**(`fluid_boxes`)에 직접 닿아야 한다. 즉 유체
 * 줄의 면은 **우리가 고르는 게 아니라 머신이 정한다**.
 *
 * ## 회전은 우리가 계산하지 않는다
 * `PipeConnection.positions` 는 게임데이터 추출 단계에서 이미 **N/E/S/W 네 방향으로 돌려 둔**
 * 좌표 배열이다(scripts/export-gamedata.lua `extract_fluid_boxes`). 그래서 회전 = 배열 인덱스
 * 하나다: `positions[direction / 4]`. 삼각함수도, 부호 뒤집기도 없다.
 *
 * ## 면은 좌표에서 못 뽑는다 — 데이터가 직접 알려준다 (2026-07-13)
 * 한동안 우리는 좌표의 **부호와 크기**로 면을 역추정했다(`|y| ≥ |x|` 면 N/S, 아니면 E/W).
 * 이건 **틀린 방법**이다. 화학 공장의 유체 상자 좌표는 회전 0에서 `(-1,-1)`, 즉 3×3 의
 * **왼쪽 위 모서리 칸**이다. 모서리는 `|x| = |y|` 라서 그 연결이 **위로 나가는지 옆으로
 * 나가는지 좌표에 정보가 없다.** 회전 0에서 답이 맞아 보인 건 우연이었다(동점이면 N/S 로
 * 보내는데 마침 입력이 위, 출력이 아래였다). 머신을 돌리는 순간 우연이 깨져서 **E 면이
 * 영원히 안 나왔고**, 그래서 트렁크 파이프가 한 번도 못 섰다.
 *
 * 진짜 답은 `PipeConnection.direction` 이다 — 그 연결이 **밖으로 뻗는 쪽**을 게임이 직접
 * 알려준다. 머신을 `d` 만큼 돌리면 면은 `(conn.direction + d) % 16` 이다. 추정 없음.
 *
 * ## 그럼 좌표는 어디에 쓰나
 * **면 위에서 몇 번째 칸이냐**(offset)에만 쓴다. 면에 **나란한** 성분만 보므로(N/S 면이면
 * x, E/W 면이면 y) 좌표가 안쪽 칸이든 바깥 연결점이든 답이 같다 — 모호한 건 수직 성분뿐인데
 * 그건 안 본다.
 */

import type { Entity, PipeConnection } from "../../UI/store/gameDataStore";
import type { Direction } from "../../types/layout";
import type { PortFace } from "../containerModel";

/** 유체 상자 하나가 노출하는 연결 칸 하나. */
export interface FluidPortSlot {
  /** `entity.fluid_boxes` 안의 인덱스 — 같은 유체 상자의 연결끼리 묶어 보려고 남긴다. */
  boxIndex: number;
  /** 이 칸이 붙은 머신 면. */
  face: PortFace;
  /**
   * 면 위에서의 위치 — 머신 origin 기준. W/E 면이면 **행**(dy), N/S 면이면 **열**(dx).
   * 즉 셀 = W면 `(origin.x − 1, origin.y + offset)`, E면 `(origin.x + w, origin.y + offset)`.
   */
  offset: number;
  /**
   * 레시피상 용도 — 재료(input) / 결과물(output) / 특수(input-output).
   * **`flow_direction`(물리 흐름)이 아니라 `production_type`(게임플레이 용도)을 본다** —
   * 우리가 묻는 건 "이 유체 상자가 재료를 받는 유체 상자냐"이기 때문이다.
   * → docs/fluid-box-semantics.md
   */
  productionType: string;
  /** 이 유체 상자가 특정 유체만 받는다면 그 이름. */
  filter?: string;
}

/** Factorio 방향 중 우리가 쓰는 네 개(직각). `positions` 배열 인덱스와 1:1. */
export const CARDINAL_DIRECTIONS: Direction[] = [0, 4, 8, 12];

/**
 * `direction` 으로 돌린 머신의 유체 연결 칸 전부.
 *
 * `size` 는 **회전 후** footprint 다. v1 은 정사각형 머신만 다루므로(§5) 호출자가 회전 전
 * 크기를 그대로 넘겨도 같다.
 */
export function fluidPortSlots(
  entity: Entity,
  size: { w: number; h: number },
  direction: Direction,
): FluidPortSlot[] {
  const boxes = entity.fluid_boxes;
  if (!boxes) return [];

  const slots: FluidPortSlot[] = [];
  boxes.forEach((fb, boxIndex) => {
    for (const conn of fb.connections) {
      const placed = resolveFluidConnection(conn, size, direction);
      if (!placed) continue;
      slots.push({
        boxIndex,
        face: placed.face,
        offset: placed.offset,
        productionType: fb.production_type ?? "input",
        filter: fb.filter,
      });
    }
  });
  return slots;
}

/** Factorio 방향 → 면. 직각 네 개만 유체 연결에 나온다. */
const FACE_BY_DIRECTION: Record<number, PortFace> = { 0: "N", 4: "E", 8: "S", 12: "W" };

/**
 * 연결 하나 → (면, 면 위 오프셋). **portInference 와 공유한다** — 유체 상자의 면을 읽는
 * 규칙이 두 벌 있으면 한쪽만 고쳐지고 다른 쪽이 조용히 틀린다.
 *
 * - **면**: `conn.direction` + 머신 회전. 좌표에서 추정하지 않는다(머리말 참고).
 * - **오프셋**: 회전된 좌표의 **면에 나란한 성분**만 본다.
 *
 * 구버전 게임데이터(`direction` 미포함)면 null — 호출자가 유체 상자를 못 쓴다고 보게 한다.
 * 없는 정보를 추측으로 메우면 재료가 출력 칸에 꽂혀도 **조용하다**(docs/fluid-box-semantics.md).
 */
export function resolveFluidConnection(
  conn: PipeConnection,
  size: { w: number; h: number },
  direction: Direction,
): { face: PortFace; offset: number } | null {
  const posIndex = CARDINAL_DIRECTIONS.indexOf(direction);
  if (posIndex < 0) return null; // 대각선 방향 — 유체 머신엔 없다.
  if (conn.direction === undefined) return null;

  const face = FACE_BY_DIRECTION[(((conn.direction + direction) % 16) + 16) % 16];
  if (!face) return null; // 대각선 연결 — 우리 모델(4면)에 없다.

  const pos = conn.positions?.[posIndex] ?? conn.positions?.[0];
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;

  const { w, h } = size;
  const offset =
    face === "N" || face === "S"
      ? clamp(Math.floor(w / 2 + pos.x), 0, w - 1)
      : clamp(Math.floor(h / 2 + pos.y), 0, h - 1);
  return { face, offset };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 계획에 넣을 유체 줄 하나 — 호출자가 레시피에서 뽑아 넘긴다(순수: store 를 안 본다). */
export interface FluidLineSpec {
  name: string;
  role: "input" | "output";
  /**
   * 레시피가 못박은 유체 상자 서수(**1-based · 역할별**). 미지정이면 그 역할의 유체 상자
   * 전부에 들어갈 수 있다 → 우리가 고른다. → docs/factorio/fluid-box-semantics.md
   */
  fluidboxIndex?: number;
}

/** 배정이 끝난 유체 줄 — 어느 면·어느 행·같은 면에서 몇 번째인가. */
export interface FluidLinePlan extends FluidLineSpec {
  /** 이 줄이 붙는 면. 역할이 정한다(출력 W = 부모 쪽 · 입력 E = 자식 쪽). */
  side: PortFace;
  /** 그 면 위 행/열 — [FluidPortSlot.offset]. */
  fluidboxOffset: number;
  /** 같은 면 안 순번(0 = 가장 안쪽). `fluidboxOffset` 오름차순. 단계 A 는 항상 0. */
  rank: number;
  /** 배정된 유체 상자의 `entity.fluid_boxes` 인덱스 — 진단·배타 배정용. */
  boxIndex: number;
}

/**
 * [트렁크 파이프](../../../docs/auto-layout/module/trunk-pipe.md) 계획 — 유체 줄이 있을 때만.
 *
 * **회전은 하나, 줄은 여럿이다.** `direction` 이 `lines` 바깥에 있는 것이 설계다 — 회전은
 * **머신 속성**이라 줄마다 다를 수 없고, 자료형이 그 불가능을 표현하지 못하게 한다.
 * 프로토타입을 보는 계산은 [chooseFluidTrunkPlan], 운반체 선택(파이프 종류)은 호출자 몫이다.
 */
export interface FluidTrunkInput {
  /** 이 각도라야 모든 줄의 유체 상자가 자기 면을 본다. 머신 Container.direction 으로 내려간다. */
  direction: Direction;
  /** 파이프 prototype(예: "pipe"). */
  pipeEntityName: string;
  /** 지하파이프 prototype(예: "pipe-to-ground"). 미지정이면 점프 불가(옛 스파인 폴백). */
  undergroundPipeEntityName?: string;
  /** 지하파이프 입출구 좌표 차이 한계([BuildSpec] 동명 필드). 0/미지정 = 점프 불가. */
  pipeMaxUndergroundDistance?: number;
  /** 유체 줄마다 하나 — 면·행·같은 면 안 순번. */
  lines: FluidLinePlan[];
  /**
   * **이 레시피가 안 쓰는 유체 상자 칸** — 면별 행(offset) 목록.
   *
   * 머신이 노출하는 유체 상자가 레시피가 쓰는 것보다 많을 수 있다(화학공장은 입력 상자가
   * 둘인데 battery 는 하나만 쓴다). 트렁크 파이프가 좌석 줄을 **통째로** 지나가면 그 칸에
   * 붙어 버리고, 합류 가드가 hard 위반으로 거절한다 — 화면에는 *"물러설 곳이 없었습니다"*
   * 만 남는다.
   *
   * 그래서 이 목록이 비어 있지 않은 면은 [pipeJumpToClusterPipe] **를 켜야 한다**: 파이프가
   * 자기 상자 행만 먹고 지하로 빠져나가면 스칠 것이 없다. 넘을 벨트가 없어도 점프하는
   * 이유가 이것이다(옛 조건은 벨트만 봤다).
   */
  unusedFluidboxRows?: Partial<Record<PortFace, number[]>>;
}

/**
 * 점프 판정에 드는 재료 전부 — **한 면**을 본다.
 *
 * 계획([planModulePorts])과 거절([moduleWizard])이 **같은 함수**를 봐야 어긋나지 않는다.
 * 예전엔 판정이 계획 쪽에만 있어서, 넘지 못하는 면은 조용히 옛 스파인으로 물러났다 — 유체가
 * 한 줄일 땐 그게 맞는 저하지만 **두 줄이면 오답**이다(스파인 둘이 같은 d1 을 다툰다).
 */
export interface FluidJumpBudget {
  /** 지하파이프 prototype. 없으면 점프 자체가 불가능하다. */
  undergroundPipeEntityName?: string;
  /** 지하파이프 입출구 **좌표 차** 한계([BuildSpec] 동명 필드). */
  pipeMaxUndergroundDistance?: number;
  /** 그 면의 좌석 줄 수 = 머신 높이(W/E 면). */
  seatRows: number;
  /** 그 면에 설 [ClusterBelt] 줄 수의 상한 — 인서터 reach 종류 수, 단 아이템 줄 수를 못 넘는다. */
  beltLanes: number;
  /** 인서터 최대 reach — 최악 base(trunk-pipe §5.1) = `maxInserterReach + 1`. */
  maxInserterReach: number;
}

/** 못 넘는 사유 — 셋은 처방이 다르다(파이프 고르기 · 더 긴 지하파이프 · 더 큰 머신). */
export type FluidJumpBlocker =
  | { kind: "no-underground"; detail: string }
  | { kind: "underground-too-short"; detail: string }
  | { kind: "seats-exhausted"; detail: string };

/**
 * 유체 `n` 줄이 있는 면에서 **지하파이프 하나가 넘어야 하는 좌표 차**(trunk-pipe §5.1).
 *
 * `base = max(그 면 벨트 최대 깊이, 1)` 이고 순번 `r` 의 터널 좌표 차가 `base + 2r` 이므로,
 * 가장 바깥 줄(`r = n−1`)이 최장이다. 여기서는 실제 벨트 깊이 대신 **최악 base = maxReach+1**
 * 을 쓴다 — 배정이 아직 안 끝난 시점에도 답해야 하기 때문이다(실제 폭은 이보다 좁을 수 있다).
 *
 * `n = 1` 이면 `maxReach + 1` — **현행과 같은 수**다(회귀 0).
 */
export function requiredUndergroundReach(n: number, maxInserterReach: number): number {
  return maxInserterReach + 1 + 2 * (n - 1);
}

/**
 * 이 면의 유체 `n` 줄이 바깥 [ClusterPipe] 로 점프할 수 있나 — 못 하면 그 사유. 넘으면 null.
 *
 * `n ≥ 2` 면 **점프는 선택이 아니라 필수**다: 옛 스파인은 좌석 줄(d1)을 기둥 전체로 먹어
 * 둘째 줄의 유체 상자 칸을 막는다. 그래서 호출자는 `n ≥ 2` 인데 이 함수가 사유를 내면
 * **거절해야 한다** — 물러설 곳이 없다.
 */
export function fluidJumpBlocker(n: number, b: FluidJumpBudget): FluidJumpBlocker | null {
  if (!b.undergroundPipeEntityName) {
    return { kind: "no-underground", detail: `유체 ${n}줄을 넘길 지하파이프를 안 골랐다` };
  }
  const need = requiredUndergroundReach(n, b.maxInserterReach);
  const have = b.pipeMaxUndergroundDistance ?? 0;
  if (have < need) {
    return {
      kind: "underground-too-short",
      detail: `유체 ${n}줄엔 지하파이프 사거리 ${need} 가 필요한데 ${b.undergroundPipeEntityName} 은 ${have}`,
    };
  }
  // 좌석 줄에서 유체 상자 행 n개를 빼고도 벨트 좌석이 남아야 한다.
  // **`beltLanes` 는 아이템 줄 수를 못 넘는다** — 아이템이 아예 없는 레시피(경유 분해: 물 +
  // 경유 → 경유)는 그 면에 벨트가 0줄이라 유체 행만 있으면 된다. 인서터 종류 수만 보던
  // 시절엔 3×3 머신 + 긴팔 선택에서 `2 ≤ 3−2` 가 거짓이 되어 **아이템이 없는데도** 거절했다.
  if (b.beltLanes > b.seatRows - n) {
    return {
      kind: "seats-exhausted",
      detail: `면 좌석 ${b.seatRows}행에서 유체 ${n}행을 빼면 ${b.seatRows - n}행 — 벨트 ${b.beltLanes}줄이 안 들어간다`,
    };
  }
  return null;
}

/** 이 면에 붙는 유체 줄들 — 안쪽부터(rank 오름차순). 없으면 빈 배열. */
export function fluidLinesOnSide(ft: FluidTrunkInput | undefined, side: PortFace): FluidLinePlan[] {
  return (ft?.lines ?? []).filter((l) => l.side === side).sort((a, b) => a.rank - b.rank);
}

/** 이 줄(`role:name`)의 유체 배정. 아이템 줄이면 undefined. */
export function fluidLineOf(
  ft: FluidTrunkInput | undefined,
  line: { role: "input" | "output"; name: string },
): FluidLinePlan | undefined {
  return ft?.lines.find((l) => l.role === line.role && l.name === line.name);
}

export type FluidTrunkPlanResult =
  | {
      ok: true;
      direction: Direction;
      lines: FluidLinePlan[];
      /** [FluidTrunkInput.unusedFluidboxRows] — 이 회전에서 안 쓰고 남는 유체 상자 칸. */
      unusedFluidboxRows: Partial<Record<PortFace, number[]>>;
    }
  | { ok: false; reason: "no-rotation" | "stale-gamedata"; detail: string };

/** 역할이 정하는 면 — 출력은 부모 쪽(W), 입력은 자식 쪽(E). 납품 경로·채널 장부가 이 규약에 기댄다. */
function wantFaceOf(role: "input" | "output"): PortFace {
  return role === "output" ? "W" : "E";
}

function acceptsRole(productionType: string, role: "input" | "output"): boolean {
  return productionType === role || productionType === "input-output";
}

/**
 * 유체 상자의 **역할별 서수**(1-based) — 레시피의 `fluidbox_index` 가 세는 방식과 같아야 한다.
 * 입력끼리 1,2… / 출력끼리 1,2… 로 따로 세고 순서는 프로토타입 등장 순서다.
 * → docs/factorio/fluid-box-semantics.md
 */
function roleOrdinalOf(entity: Entity, role: "input" | "output"): Map<number, number> {
  const out = new Map<number, number>();
  let n = 0;
  (entity.fluid_boxes ?? []).forEach((fb, i) => {
    if (acceptsRole(fb.production_type ?? "input", role)) out.set(i, ++n);
  });
  return out;
}

/**
 * **유체 줄 전부를 한 회전 안에 앉힌다.**
 *
 * 회전은 머신 속성이라 **모듈당 하나**다 — 줄마다 다른 각도를 줄 수 없다. 그래서 네 방향을
 * 다 시험해 **모든 줄이 자기 역할 면**(출력 W · 입력 E)에 오는 첫 방향을 고른다. 각도를
 * 상수로 박지 않는 이유는 [[trunk-pipe]] §3 에 있다 — 프로토타입마다 유체 상자 자리가 다르고,
 * 실제로 `se-space-biochemical-laboratory` 는 입력이 W·N 이라 **180°** 라야 맞는다.
 *
 * 유체 상자 배정(결정적·배타):
 *  1. 프로토타입 `filter` 가 유체 이름과 일치하는 유체 상자 — 최우선.
 *  2. 레시피 `fluidboxIndex` 가 지정된 줄 — 그 서수의 유체 상자에 못박는다.
 *  3. 나머지 — 그 면의 남은 유체 상자를 **offset 오름차순**으로 앞에서부터.
 *
 * 3번이 순번(rank)과 **같은 규칙**이라 배정과 순번이 어긋날 수 없다.
 *
 * **면당 줄 수에 상한이 없다.** 한때 여기 상한이 있었는데(단계 A), 그건 기하의 사실이 아니라
 * 아직 안 만든 것에 붙인 임시 문턱이었다. 진짜 상한은 **지하파이프 사거리**가 정하고
 * ([fluidJumpBlocker]), 그건 프로토타입을 다 본 뒤에야 답할 수 있어 여기 있을 수 없다.
 */
export function chooseFluidTrunkPlan(
  entity: Entity,
  size: { w: number; h: number },
  lines: readonly FluidLineSpec[],
): FluidTrunkPlanResult {
  if (lines.length === 0) return { ok: true, direction: 0, lines: [], unusedFluidboxRows: {} };

  const ordinalOf = { input: roleOrdinalOf(entity, "input"), output: roleOrdinalOf(entity, "output") };
  const misses: string[] = [];

  for (const direction of CARDINAL_DIRECTIONS) {
    const slots = fluidPortSlots(entity, size, direction);
    const used = new Set<number>();
    const placed: FluidLinePlan[] = [];

    /** 이 줄이 앉을 수 있는 칸들 — 자기 역할 면 + 역할이 맞는 유체 상자, offset 오름차순. */
    const candidatesFor = (line: FluidLineSpec): FluidPortSlot[] => {
      const face = wantFaceOf(line.role);
      const seen = new Set<number>();
      return slots
        .filter((s) => s.face === face && acceptsRole(s.productionType, line.role) && !used.has(s.boxIndex))
        .sort((a, b) => a.offset - b.offset || a.boxIndex - b.boxIndex)
        // 유체 상자 하나가 같은 면에 연결을 여러 개 가질 수 있다 — 첫 칸만 쓴다.
        .filter((s) => (seen.has(s.boxIndex) ? false : (seen.add(s.boxIndex), true)));
    };

    // 못박힌 줄(filter · fluidboxIndex)을 먼저 앉힌다 — 자유로운 줄이 그 자리를 먼저 먹으면
    // 되돌릴 수 없다(제약이 센 쪽 먼저).
    const pinned = lines.filter((l) => l.fluidboxIndex !== undefined);
    const free = lines.filter((l) => l.fluidboxIndex === undefined);
    let failed: string | null = null;

    for (const line of [...pinned, ...free]) {
      const cands = candidatesFor(line);
      const slot =
        cands.find((s) => s.filter === line.name) ??
        (line.fluidboxIndex !== undefined
          ? cands.find((s) => ordinalOf[line.role].get(s.boxIndex) === line.fluidboxIndex)
          : cands[0]);
      if (!slot) {
        failed = `${line.name}(${line.role}) → ${wantFaceOf(line.role)} 면에 쓸 유체 상자 없음`;
        break;
      }
      used.add(slot.boxIndex);
      placed.push({ ...line, side: slot.face, fluidboxOffset: slot.offset, rank: 0, boxIndex: slot.boxIndex });
    }
    if (failed) {
      misses.push(`dir ${direction}: ${failed}`);
      continue;
    }

    // 순번 — 같은 면 안 offset 오름차순(trunk-pipe §5.1). 배정과 같은 규칙이라 어긋날 수 없다.
    for (const face of ["W", "E"] as const) {
      placed
        .filter((p) => p.side === face)
        .sort((a, b) => a.fluidboxOffset - b.fluidboxOffset)
        .forEach((p, i) => (p.rank = i));
    }
    // **안 쓰는 유체 상자 칸** — 이 레시피가 안 먹이는데 같은 면에 노출된 연결 칸.
    // 트렁크 파이프가 좌석 줄을 통째로 지나가면 이 칸을 **스친다**(2026-08-05 실측: 화학공장
    // battery — 입력 상자가 E 면에 둘인데 레시피는 하나만 쓴다. 스파인이 (3,0)과 (3,2)를 다
    // 지나 안 쓰는 box2 에 붙어 합류 가드가 hard 위반으로 거절했다).
    // 계산은 여기가 맞다 — 프로토타입을 보는 유일한 자리다. `module/` 은 게임데이터를 안 본다.
    const usedBoxes = new Set(placed.map((p) => p.boxIndex));
    const unusedFluidboxRows: Partial<Record<PortFace, number[]>> = {};
    for (const s of slots) {
      if (usedBoxes.has(s.boxIndex)) continue;
      const rows = (unusedFluidboxRows[s.face] ??= []);
      if (!rows.includes(s.offset)) rows.push(s.offset);
    }
    for (const rows of Object.values(unusedFluidboxRows)) rows.sort((a, b) => a - b);
    return { ok: true, direction, lines: placed, unusedFluidboxRows };
  }

  // 어느 각도로도 못 앉혔다. **각 줄이 어디서 걸렸는지**를 들려 보낸다 — "각도가 아예 없다"와
  // "각 줄은 되는데 동시엔 안 된다"를 구분해야 오진하지 않는다. 유체 연결에 `direction` 이
  // 아예 없으면 그건 머신 탓이 아니라 **구버전 export** 다(그 둘을 섞으면 오진한다).
  const hasDirection = entity.fluid_boxes?.some((fb) => fb.connections.some((c) => c.direction !== undefined));
  return hasDirection
    ? { ok: false, reason: "no-rotation", detail: misses.join(" / ") }
    : {
        ok: false,
        reason: "stale-gamedata",
        detail: `유체 연결에 direction 이 없다 (구 export). scripts/export-gamedata.lua 로 다시 뽑아야 함`,
      };
}
