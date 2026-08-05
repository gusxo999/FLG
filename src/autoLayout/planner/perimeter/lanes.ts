/**
 * lanes — **반출 예약의 입력 준비.** 살아남은 무한상자가 배치 바깥으로 나갈 길을 배정하기
 * 전에, 그 배정기([perimeterLanePlanner.planPerimeterLanes])가 볼 입력을 모은다.
 *
 * ## 왜 `perimeter/` 인가
 * 여기 있는 두 함수는 **전역 외곽을 안다** — `bbox` 프레임을 마진만큼 넓히고(상자가 앉을
 * 변을 확보), 어느 포트가 그 변으로 나가야 하는지를 고른다. 그것이 축 2 의 `perimeter`
 * 판정이다. 좌표를 만들 뿐 셀은 만들지 않으므로 축 1 로는 `planner` 다.
 *
 * ## 여기 없는 것
 * `materializeChannelGeometry`(반출 경로의 **예약 셀**을 찍는 곳)는 `modulePacking` 에
 * 남아 있다. 그 함수는 납품(channel)과 반출(perimeter)을 **한 번에** 훑는데, 둘이 같은
 * 트랙 풀을 다투기 때문이다([channelGeometryPlanner.planChannelGeometry] 가 `deliveries`
 * 와 `exports` 를 함께 받는 것과 같은 이유). 관심사로 가르려면 그 다툼을 먼저 풀어야 한다.
 */

import type { GeneratedModule } from "../../module/clusterModule";
import type { ModulePort } from "../../module/clusterModule";
import type { Orientation } from "../../module/moduleTransform";
import { moduleExtent } from "../../module/moduleTransform";
import {
  planPerimeterLanes,
  type LaneContext,
  type LanePlan,
  type LanePortInput,
  type ExitEdge,
} from "../perimeterLanePlanner";
import { PERIMETER_MARGIN } from "../../util/helper";
import type { NodeSpec } from "../modulePacking";

/** marginNeeds 만큼 bbox 프레임을 넓힌다(상자 seat 자리 예약, ②가 소비). */
export function expandBbox(
  b: { x: number; y: number; w: number; h: number },
  m: { N: boolean; S: boolean; W: boolean; E: boolean },
): { x: number; y: number; w: number; h: number } {
  const M = PERIMETER_MARGIN;
  const l = m.W ? M : 0, r = m.E ? M : 0, t = m.N ? M : 0, bt = m.S ? M : 0;
  return { x: b.x - l, y: b.y - t, w: b.w + l + r, h: b.h + t + bt };
}

/**
 * 살아남은 외부상자 포트(raw 입력 + 루트 출력)를 모아 exit-lane 을 배정한다.
 * 모듈 내부를 안 보는 planner 의 입력(변·abs y·depth·열 밴드)만 준비.
 */
export function planLanes(
  specs: NodeSpec[],
  oriented: Map<string, { module: GeneratedModule; orientation: Orientation }>,
  topY: Map<string, number>,
  /** 납품 경로로 짝지어진 상자 id — 이 포트들은 belt 로 이어지므로 반출 대상이 아니다. */
  pairedChestIds: ReadonlySet<string>,
  maxDepth: number,
  absPortY: (id: string, anchorY: number) => number,
): LanePlan {
  // 변 = planner 슬롯(meta.side)이 단일 출처. 예전엔 anchor↔bbox 기하로 추측했지만
  // (X변 우선), N/S 레인의 chest 는 트렁크가 레인을 따라 수평으로 자라 코너 어깨
  // (x·y 둘 다 bbox 밖)에 앉을 수 있어 W/E 로 오분류된다 — N 레인 상자는 위가 전역
  // 마진이라 self-N 직진이 정답인데 채널 우회로 배정되는 낭비/실패 위험.
  const sideOf = (p: ModulePort): ExitEdge => p.meta.side;
  const ports: LanePortInput[] = [];
  let gyMin = Infinity, gyMax = -Infinity;
  const bandsByDepth = new Map<number, { id: string; top: number; bottom: number }[]>();
  for (const s of specs) {
    const mod = oriented.get(s.id)!.module;
    const ext = moduleExtent(mod);
    const top = topY.get(s.id)!;
    const bottom = top + ext.h - 1;
    gyMin = Math.min(gyMin, top);
    gyMax = Math.max(gyMax, bottom);
    (bandsByDepth.get(s.depth) ?? bandsByDepth.set(s.depth, []).get(s.depth)!).push({ id: s.id, top, bottom });
    // 반출 대상 = **납품 경로로 짝지어지지 않은 포트 전부**. 입력이면 외부 공급 무한상자,
    // 출력이면 무한 sink — 둘 다 perimeter 로 나가야 한다. (1:1 방출이라 자식 출력이
    // 부모 입력보다 많으면 남는 출력도 여기 들어온다.) wayOuts = 모듈이 답해준
    // "나갈 수 있는 방향들" — 배정이 못 쓰는 방향을 예약하지 않게 한다.
    for (const p of [...mod.inputPorts, ...mod.outputPorts])
      if (!pairedChestIds.has(p.chest.id))
        ports.push({
          id: p.chest.id,
          role: p.line.role,
          depth: s.depth,
          side: sideOf(p),
          anchorY: absPortY(s.id, p.anchor.y),
          wayOuts: p.moduleWayOuts,
        });
  }
  const ctx: LaneContext = { globalY: { min: gyMin, max: gyMax }, maxDepth, bandsByDepth };
  return planPerimeterLanes(ports, ctx);
}
