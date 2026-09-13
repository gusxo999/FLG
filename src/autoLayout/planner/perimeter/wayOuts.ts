/**
 * `moduleWayOuts` — **반출 계획의 입력**. 모듈이 자기 몸통에 대해 답한다.
 *
 * 포트마다 *"이 상자가 모듈 몸통에 안 막히고 나갈 수 있는 방향"* 을 계산한다.
 * 셀을 만들지 않고 **판정값만** 내므로 계획 계층이다.
 *
 * ## 왜 module/ 이 아니라 여기인가 (계층 위반 V1 해소)
 * 소비처를 전수 조사한 결과 **`perimeterExitPlanner`(반출 출구 배정) 하나뿐**이다.
 * `module/` 안에는 소비처가 없다 — 모듈 안쪽 코드가 **반출 전용 값**을 계산하고 있었다.
 * 여기로 옮기면 `module/` 은 반출의 존재 자체를 몰라도 된다.
 *
 * 모듈은 여전히 **블랙박스**다. 이 함수는 모듈이 *자기 자신에 대해* 답한 결과이고,
 * 반출 배정은 그 답만 믿고 모듈 내부를 들여다보지 않는다.
 */

import type { Container, PlacedCell, PortFace } from "../../containerModel";
import { cellKey, faceVector } from "../../util/helper";
import type { ModulePort } from "../../module/types/module";


/**
 * **모듈 몸통이 먹는 로컬 열들** — `x − extent.x` 로 잰다.
 *
 * 남의 세로 직진이 *"네 열 c 를 지나가도 되나"* 를 물을 때의 답이다. 여기 **없는** 열이
 * 뚫린 열이고, 모듈 폭 밖의 열도 자동으로 뚫린 것이 된다(집합에 없으니까) — 그래서 폭을
 * 따로 실어 보낼 필요가 없다.
 *
 * **로컬 열끼리의 비교가 절대 x 로 비교한 것과 답이 같은 이유:** 같은 깊이의 모듈은 전부
 * `colX[depth]` 에 왼쪽 정렬된다(`shiftModule(m, colX[d] − ext.x, …)`).
 *
 * 몸통의 정의는 [fillModuleWayOuts] 와 **같다** — 머신 footprint + 모든 placed 셀. 두
 * 판정이 같은 몸통을 보게 하려고 한 파일에 두고, 여기가 그 사실의 **단일 출처**다.
 */
export function bodyColumnsOf(machines: Container[], cells: PlacedCell[]): Set<number> {
  const xs: number[] = [];
  for (const m of machines)
    for (let dx = 0; dx < m.size.w; dx++) xs.push(m.origin.x + dx);
  for (const c of cells) xs.push(c.x);
  let minX = Infinity;
  for (const x of xs) minX = Math.min(minX, x);
  const out = new Set<number>();
  for (const x of xs) out.add(x - minX);
  return out;
}

/**
 * 각 포트의 [ModulePort.moduleWayOuts] 를 채우고, 모듈의 **열 요약**([bodyColumnsOf])을
 * 함께 낸다 — 모듈이 **자기 몸통**을 근거로 답하는 자리다.
 *
 * ```
 * moduleWayOuts   "**내** 상자가 어느 쪽으로 나갈 수 있나"   — 포트마다
 * bodyColumns     "**남의** 직진이 내 어느 열을 지날 수 있나" — 모듈마다
 * ```
 *
 * **둘을 한 번에 내는 것이 요점이다.** 같은 몸통에 대한 두 답이라 따로 계산하면 언젠가
 * 다른 순간의 몸통을 본다 — `perimeter/exits.ts` 가 `orderByDepth` 를 다시 세지 않고
 * 받는 것과 같은 이유다(*"같은 사실을 두 주체가 두 번 세면 언젠가 어긋난다"*).
 *
 * 몸통 = 머신 footprint + 모든 placed 셀(트렁크·인서터·상자 ghost). 상자 ghost 와 그
 * 인서터도 장애물로 센다 — 재배치 때 그 두 칸은 belt 로 다시 깔리므로(modulePerimeterPass
 * 가 path=[feeder, anchor, …] 로 재사용) **여전히 점유 상태**이기 때문이다.
 *
 * 판정: anchor 바로 다음 칸부터 그 방향으로 걸어가며, 몸통 extent 안에 있는 동안 한 칸도
 * 막히지 않고 extent 를 벗어나면 그 방향은 "나갈 수 있다". extent 밖 = 모듈 바깥(채널·마진)
 * 이라 여기선 관심 없다(그쪽은 채널 장부가 따로 예약한다).
 */
export function fillModuleWayOuts(
  machines: Container[],
  cells: PlacedCell[],
  ports: ModulePort[],
): Set<number> {
  const occ = new Set<string>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const mark = (x: number, y: number) => {
    occ.add(cellKey(x, y));
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const m of machines)
    for (let dx = 0; dx < m.size.w; dx++)
      for (let dy = 0; dy < m.size.h; dy++) mark(m.origin.x + dx, m.origin.y + dy);
  for (const c of cells) mark(c.x, c.y);

  const FACES: PortFace[] = ["N", "E", "S", "W"];
  for (const port of ports) {
    const wayOuts: PortFace[] = [];
    for (const face of FACES) {
      const fv = faceVector(face);
      let x = port.anchor.x + fv.x;
      let y = port.anchor.y + fv.y;
      let clear = true;
      // 몸통 extent 안에 있는 동안만 검사 — 벗어나면 탈출 성공.
      while (x >= minX && x <= maxX && y >= minY && y <= maxY) {
        if (occ.has(cellKey(x, y))) { clear = false; break; }
        x += fv.x;
        y += fv.y;
      }
      if (clear) wayOuts.push(face);
    }
    port.moduleWayOuts = wayOuts;
  }

  return bodyColumnsOf(machines, cells);
}

// ─────────────────────────────────────────────────────────────────────────────
// 탭 인서팅 방출 — 트렁크 belt 한 줄 + 머신마다 탭 인서터 1개
// (docs/auto-layout/module/trunk-redesign.md §10.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * reach≥2 [ClusterBelt](../../../../../docs/용어사전.md)는 가까운 벨트를 **넘어서** 집어야 하므로 긴팔이어야
 * 한다. (ModuleInput 이 긴팔 하나만 담는 v1: reach≥2 → 그 긴팔, reach 1 → 기본 인서터.)
 */
