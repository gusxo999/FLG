/**
 * linkShape — **배정 하나가 먹는 칸의 단일 출처.**
 *
 * *"이 배정이 어느 칸을 먹나"* 와 *"그 칸에 무엇을 놓나"* 는 **같은 도형의 두 질문**이다.
 * 예전엔 두 곳이 각자 계산했다 — 계획은 `linkPlanner`(`beltRowSpan` → `portCells`), 방출은
 * `emitModule`(`path`/`span`). 둘을 붙들고 있는 것이 주석의 줄 번호뿐이라 실제로 갈렸다
 * (2026-09-12 실측: 링크 84개 중 9개, 방출만 22칸 · 계획만 116칸).
 * → `docs/auto-layout/common/work-kinds.md` §7 **D1**
 *
 * ## 이 함수가 안 보는 것
 *
 * ```
 * 장부      안 본다. **입력이 이미 확정된 배정**이라 빈자리를 찾을 일이 없다
 * 게임데이터  안 본다. 엔티티 이름·방향 규약은 찍는 쪽(`cellBuilder`)의 일이다
 * 좌표계     안 본다. `t` 는 **호출자의 축**이다 — 배정이면 순번, 방출이면 모듈-로컬 좌표
 * ```
 *
 * 마지막 줄이 요점이다. 두 축은 머신 원점만큼 어긋나 있지만 **도형의 모양은 같아서**, 같은
 * 함수가 각자의 축에서 답한다(변환은 `placeLinkSeats` 의 덧셈 한 줄).
 *
 * ## 방향은 **순서**가 든다
 *
 * `path` 는 벨트가 흐르는 차례다. 각 칸의 방향은 **다음 칸과의 차**이고, 마지막 칸은
 * [LinkShape.after] 를 본다. 그래서 이 함수는 벡터를 하나도 만들지 않는다 — 면이 W냐 E냐에
 * 따라 부호가 뒤집히는 계산이 방출기 한 곳(`faceCell`)에만 남는다.
 *
 * ## gap(N/S) 면은 여기 없다
 *
 * gap 은 **계획이 아무것도 청구하지 않는다**(겹침을 행이 아니라 반출 깊이로 푼다 —
 * `commitLinkFace` 의 `span` 이 `undefined`). 그래서 계획과 방출이 나눠 부를 도형이 없고, 그 길은
 * 머신 좌표에 묶인 채 [module/shape] 의 `outputRouteOf` · `inputRouteOf` 가 짓는다.
 *
 * **청구가 없다는 것은 갈릴 도형이 없다는 뜻이지 다툼이 없다는 뜻이 아니다** — gap 그룹의 포트 두 칸이
 * 어느 장부에도 없어서, 남의 벨트와의 다툼을 방출 안전망이 처음 본다(work-kinds §7 D8).
 */

import { flowEnd } from "./arith";
import type { LinkFacePlan } from "./types/seat";

/** 이 칸에 무엇이 서나. 좌석(d1)은 여기 없다 — 배정의 `slotIndex` 가 이미 단일 출처다. */
export type ShapeKind = "belt" | "merge" | "portInserter" | "portChest";

/** 면 위 한 칸 — `t` 의 뜻은 [faceCell] 과 같다(W/E 면이면 행). */
export interface ShapeCell {
  readonly kind: ShapeKind;
  readonly depth: number;
  readonly t: number;
}

export interface LinkShapeInput {
  /** 싣는 쪽(`output`)은 포트로 **모으고**, 집는 쪽(`input`)은 포트에서 **나눠 준다** — 흐름이 반대다. */
  role: "output" | "input";
  clusterBeltDepth: number;
  /** 포트가 기둥 끝에 서나([LinkFacePlan.portEnd]). 없으면 옆(면 바깥)이다. */
  portEnd?: "N" | "S";
  /** 흐름이 향하는 끝이 S 인가([flowEnd]). 포트가 서는 쪽이다. */
  flowToSouth: boolean;
  /** 합류에서 이 줄의 역할([LinkFacePlan.mergeRole]). 싣는 쪽에만 있다. */
  mergeRole?: "lead" | "follow";
  /** 이 그룹이 앉은 행들. 정렬은 안 해도 된다 — 양 끝만 쓴다. */
  rows: readonly number[];
  /** 기둥 **밖** 첫 행 — 합류가 서는 자리. 합류가 아니면 안 쓴다. */
  outRow: number;
}

export interface LinkShape {
  /** 벨트가 흐르는 **순서대로**. */
  path: readonly ShapeCell[];
  /**
   * 마지막 칸이 **향하는** 칸 — 여기엔 벨트를 놓지 않는다. 마지막 칸의 방향이 이걸로 정해진다.
   * 싣는 쪽은 포트 인서터, 집는 쪽은 머신 쪽 이웃 칸(흐름이 거기서 끝난다).
   */
  after: ShapeCell;
  /** 포트 두 칸. **따르는 줄은 없다** — 포트도 물리 벨트도 첫 줄의 것 하나다. */
  port?: { inserter: ShapeCell; chest: ShapeCell };
}

/** 이 배정이 먹는 칸 전부 — 순서는 `path`, 나머지는 뒤에 붙는다. */
export function shapeCells(s: LinkShape): ShapeCell[] {
  return s.port ? [...s.path, s.port.inserter, s.port.chest] : [...s.path];
}

/**
 * 확정된 배정 하나의 도형. **W/E 면 전용**(위 머리말 §gap).
 *
 * 좌석은 여기 없다 — `slotIndex` 가 이미 단일 출처이고, 두 곳이 그걸 그대로 읽어 갈릴 수 없다.
 */
export function linkShape(i: LinkShapeInput): LinkShape {
  const d = i.clusterBeltDepth;
  const lo = Math.min(...i.rows);
  const hi = Math.max(...i.rows);
  /** 포트 쪽 끝 행. */
  const topT = i.flowToSouth ? hi : lo;
  /** 반대쪽 끝 행. */
  const farT = i.flowToSouth ? lo : hi;
  /** 기둥 밖으로 나가는 방향(포트 끝이 있을 때). */
  const out = i.portEnd === "S" ? 1 : -1;
  const belt = (depth: number, t: number): ShapeCell => ({ kind: "belt", depth, t });
  const path: ShapeCell[] = [];

  if (i.role === "output") {
    // ① **수집** — 자기 좌석 구간을 덮으며 포트 쪽으로 흐른다.
    const step = i.flowToSouth ? 1 : -1;
    for (let t = farT; t !== topT + step; t += step) path.push(belt(d, t));

    if (i.mergeRole === "follow") {
      // ② **비켜 가기** — 깊이 +1 로 한 칸, +2 를 따라 기둥 밖까지. 마지막에 **얕은 쪽**으로
      // 꺾어 이끄는 줄의 합류 칸 옆구리를 친다(사이드로드). 포트는 없다.
      path.push(belt(d + 1, topT));
      for (let t = topT; t !== i.outRow + step; t += step) path.push(belt(d + 2, t));
      return { path, after: { kind: "merge", depth: d + 1, t: i.outRow } };
    }
    if (i.mergeRole === "lead") {
      // ②′ **기둥 밖까지 달린다** — 합류 칸이 표 밖이라야 남의 옆 포트 자리를 안 뺏는다.
      for (let t = topT + step; t !== i.outRow + step; t += step) path.push(belt(d, t));
      path.push({ kind: "merge", depth: d + 1, t: i.outRow });
      // 포트는 그 합류 칸에서 **더 바깥으로** 난다.
      const port = {
        inserter: { kind: "portInserter", depth: d + 1, t: i.outRow + out } as const,
        chest: { kind: "portChest", depth: d + 1, t: i.outRow + 2 * out } as const,
      };
      return { path, after: port.inserter, port };
    }
    const port = portOf(d, topT, out, i.portEnd !== undefined);
    return { path, after: port.inserter, port };
  }

  // 집는 쪽 — 포트에서 받아 좌석 구간에 **나눠 주고**, 먼 끝에서 머신 쪽으로 꺾어 멈춘다.
  // 그 끝 칸의 최종 방향은 [resolveBeltTermini] 가 다시 정할 수 있다(늦은 결정).
  const step = i.flowToSouth ? -1 : 1;
  for (let t = topT; t !== farT + step; t += step) path.push(belt(d, t));
  const port = portOf(d, topT, out, i.portEnd !== undefined);
  // 흐름의 끝은 **머신 쪽 이웃 칸**을 향한다 — 벨트를 놓지 않는 가상의 칸이다.
  return { path, after: { kind: "belt", depth: d - 1, t: farT }, port };
}

/**
 * 이 후보의 **포트가 먹는 칸 둘** — `(행, 깊이)`. **검사 전용**이고, 확정 청구와 방출이
 * 부르는 [linkShape] 와 **같은 함수에서 답을 받는다**(2026-09-12 D1).
 *
 * 예전엔 계획 파일이 그 도형을 직접 계산했고, 주석이 근거로 `emitModule` 의 **줄 번호**를
 * 인용하고 있었다. 그래서 방출이 도형을 바꾸면 여기가 조용히 낡았다.
 * (2026-09-14 `planner/module/linkPlanner.ts` 에서 여기로 — 도형은 도형 파일에.)
 */
export function portCells(
  cand: Pick<LinkFacePlan, "clusterBeltDepth" | "portEnd" | "exitEnd">,
  span: readonly [number, number],
): Array<readonly [number, number]> {
  const port = linkShape({
    role: "output", // 포트 두 칸은 역할과 무관하다 — 흐름만 반대이고 자리는 같다
    clusterBeltDepth: cand.clusterBeltDepth,
    portEnd: cand.portEnd,
    flowToSouth: flowEnd(cand) === "S",
    rows: span,
    outRow: 0, // 합류 도형을 안 물으므로 안 쓰인다
  }).port;
  // **거르지 않는다**(2026-09-06) — 기둥 밖 행은 `ctx.outside` 가 센다([splitByTable]).
  return port ? [[port.inserter.t, port.inserter.depth], [port.chest.t, port.chest.depth]] : [];
}

/**
 * 포트 두 칸 — **`portEnd` 가 모양을 정한다.**
 *
 * ```
 * 옆 포트 (끝 없음)   벨트에서 **바깥으로**   (d+1, topT) · (d+2, topT)
 * 기둥 끝 포트        벨트에서 **행 방향**    (d, topT±1) · (d, topT±2)
 * ```
 */
function portOf(
  d: number,
  topT: number,
  out: number,
  atEnd: boolean,
): { inserter: ShapeCell; chest: ShapeCell } {
  return atEnd
    ? {
        inserter: { kind: "portInserter", depth: d, t: topT + out },
        chest: { kind: "portChest", depth: d, t: topT + 2 * out },
      }
    : {
        inserter: { kind: "portInserter", depth: d + 1, t: topT },
        chest: { kind: "portChest", depth: d + 2, t: topT },
      };
}
