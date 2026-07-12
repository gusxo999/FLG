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
 * ## 좌표 변환의 함정
 * `positions` 는 머신 **중심 기준의 경계 좌표**(0.5 타일 단위)다. `floor(center + pos)` 를
 * 그냥 하면 머신 **안쪽 칸**으로 떨어지는 경우가 흔하다. 그래서 **부호로 면을 먼저 정하고**
 * 그 면 바깥 칸으로 매핑한다 — portInference 의 `portFromFluidBoxPosition` 과 같은 규칙이며,
 * 여기서는 절대 좌표가 아니라 **머신-로컬 오프셋**을 낸다(모듈이 로컬 좌표로 산다).
 */

import type { Entity } from "../../../store/gameDataStore";
import type { Direction } from "../../../types/layout";
import type { PortFace } from "../containerModel";

/** 유체 상자 하나가 노출하는 연결 칸 하나. */
export interface FluidPortSlot {
  /** `entity.fluid_boxes` 안의 인덱스 — 같은 상자의 연결끼리 묶어 보려고 남긴다. */
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
   * 우리가 묻는 건 "이 상자가 재료를 받는 상자냐"이기 때문이다.
   * → docs/fluid-box-semantics.md
   */
  productionType: string;
  /** 이 상자가 특정 유체만 받는다면 그 이름. */
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
  const posIndex = CARDINAL_DIRECTIONS.indexOf(direction);
  if (posIndex < 0) return []; // 대각선 방향 — 유체 머신엔 없다.

  const slots: FluidPortSlot[] = [];
  boxes.forEach((fb, boxIndex) => {
    for (const conn of fb.connections) {
      // 4방향 배열이 없는(=회전 정보 미제공) 데이터면 0번(북쪽)으로 폴백한다.
      const pos = conn.positions?.[posIndex] ?? conn.positions?.[0];
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue;
      const placed = faceAndOffset(pos, size);
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

/** 중심 기준 경계 좌표 → (면, 면 위 오프셋). 부호로 면을 먼저 정한다(머리말 참고). */
function faceAndOffset(
  pos: { x: number; y: number },
  size: { w: number; h: number },
): { face: PortFace; offset: number } | null {
  const { w, h } = size;
  if (Math.abs(pos.y) >= Math.abs(pos.x)) {
    if (pos.y === 0) return null; // 중심 — 일반 fluid_box 에선 안 나온다.
    return {
      face: pos.y < 0 ? "N" : "S",
      offset: clamp(Math.floor(w / 2 + pos.x), 0, w - 1),
    };
  }
  return {
    face: pos.x < 0 ? "W" : "E",
    offset: clamp(Math.floor(h / 2 + pos.y), 0, h - 1),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * **이 유체를 `wantFace` 면으로 받으려면 머신을 어느 방향으로 돌려야 하나.**
 *
 * 각도를 상수로 박지 않는 이유: 프로토타입마다 유체 상자 위치가 다르다. "화학 공장은 입구가
 * N 이니 시계방향" 을 박으면 다른 머신에서 조용히 깨진다. **네 방향을 다 시험해** 원하는
 * 면에 입구가 오는 회전을 고른다 — 데이터가 결정하고, 결정적이다(작은 방향부터 첫 성공).
 *
 * 상자 고르기(§6): `filter` 가 유체 이름과 맞는 상자 우선, 없으면 그 면 위 상자 중 첫 번째.
 *
 * @returns 회전과 그때 쓸 칸. 어느 방향으로 돌려도 `wantFace` 에 입구가 안 오면 null.
 */
export function chooseMachineDirection(
  entity: Entity,
  size: { w: number; h: number },
  fluidName: string,
  wantFace: PortFace,
  role: "input" | "output",
): { direction: Direction; slot: FluidPortSlot } | null {
  const wants = role === "input" ? ["input", "input-output"] : ["output", "input-output"];
  for (const direction of CARDINAL_DIRECTIONS) {
    const onFace = fluidPortSlots(entity, size, direction).filter(
      (s) => s.face === wantFace && wants.includes(s.productionType),
    );
    if (onFace.length === 0) continue;
    // filter 일치 상자 우선 → 없으면 등장 순서 첫 번째.
    const slot = onFace.find((s) => s.filter === fluidName) ?? onFace[0];
    return { direction, slot };
  }
  return null;
}
