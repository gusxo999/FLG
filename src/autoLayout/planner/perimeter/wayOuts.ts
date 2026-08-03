/**
 * `moduleWayOuts` — **반출 계획의 입력**. 모듈이 자기 몸통에 대해 답한다.
 *
 * 포트마다 *"이 상자가 모듈 몸통에 안 막히고 나갈 수 있는 방향"* 을 계산한다.
 * 셀을 만들지 않고 **판정값만** 내므로 계획 계층이다.
 *
 * ## 왜 module/ 이 아니라 여기인가 (계층 위반 V1 해소)
 * 소비처를 전수 조사한 결과 **`perimeterLanePlanner`(반출 출구 배정) 하나뿐**이다.
 * `module/` 안에는 소비처가 없다 — 모듈 안쪽 코드가 **반출 전용 값**을 계산하고 있었다.
 * 여기로 옮기면 `module/` 은 반출의 존재 자체를 몰라도 된다.
 *
 * 모듈은 여전히 **블랙박스**다. 이 함수는 모듈이 *자기 자신에 대해* 답한 결과이고,
 * 반출 배정은 그 답만 믿고 모듈 내부를 들여다보지 않는다.
 */

import type { Container, PlacedCell, PortFace } from "../../containerModel";
import { cellKey, faceVector } from "../../util/helper";
import type { ModulePort } from "../../module/clusterModule";


/**
 * 각 포트의 [ModulePort.moduleWayOuts] 를 채운다 — 모듈이 **자기 몸통**을 근거로
 * "이 포트가 어느 쪽으로 나갈 수 있나"에 답하는 자리.
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
): void {
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
}

// ─────────────────────────────────────────────────────────────────────────────
// 탭 인서팅 방출 — 트렁크 belt 한 줄 + 머신마다 탭 인서터 1개
// (docs/auto-layout-wizard.trunk-redesign.md §10.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * reach≥2 [ClusterBelt](../../../../../docs/용어사전.md)는 가까운 벨트를 **넘어서** 집어야 하므로 긴팔이어야
 * 한다. (ModuleInput 이 긴팔 하나만 담는 v1: reach≥2 → 그 긴팔, reach 1 → 기본 인서터.)
 */
