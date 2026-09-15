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
 *
 * ## 여기 없는 것
 * 유체 점프의 셈(예산 · 막힘 · 벨트 깊이 상한)과 유체 줄 조회는 `module/arith` 에 있다 — 답이 하나이고 게임데이터를
 * 안 본다(2026-09-15 계획 구조-2축 · 2 Step 5e 에서 옮겼다). 이 파일에 남는 것은 어댑터(유체 상자 칸 · 연결 해석) ·
 * 정책(`chooseFluidTrunkPlan`) · 그 둘이 함께 읽는 타입이고, factorio 가 부르는 넷은 전부 이쪽이다.
 */

import type { Entity, PipeConnection } from "../../types/gameData";
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
 * ([arith.fluidJumpBlocker]), 그건 프로토타입을 다 본 뒤에야 답할 수 있어 여기 있을 수 없다.
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
