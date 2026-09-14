/**
 * **통로 관심사의 장부** — 행 채널(가로)의 신원 · 트랙 · 높이.
 *
 * 폭 역전 — 높이는 고르는 값이 아니라 **배정의 결과**다. 그리고 배정 입력 넷(면 · 모듈-로컬 x ·
 * side · 행 채널 신원)이 어느 것도 y 를 안 본다 — 그래서 이 장부는 좌표보다 **앞**에 선다.
 *
 * > **내력.** `modulePacking.packModuleTree` 의 `3b)` · `3c)` 블록과 `5b)` 의 관통 재료였다
 * > (2026-09-14 계획 구조-2축 · 2 Step 3c-2).
 */

import type { ModulePort } from "../../module/types/module";
import { planRowChannel, type RowCrossing } from "../rowChannelPlanner";
import { rowChannelKey } from "../layoutRegions";
import type { RowChannel } from "../tree/types";
import type { RowChannelNeed } from "../link/arith";

/**
 * **⑤ 행 채널** — 깊이마다 신원 · 트랙 · 높이, 그리고 가로 트랙이 닿는 x. **좌표 없음.**
 *
 *    이 셋이 `topY` 보다 앞에 설 수 있다는 것이 이 구조의 전부다. `rowChannelPlanner`
 *    머리말이 한때 여기에 순환이 있다고 적었는데, 그 순환의 둘째 화살표
 *    *「absPortY → 행 채널을 지나는 경로」* 가 거짓이었다 — 배정 입력 넷(면 · 모듈-로컬 x ·
 *    side · 행 채널 신원)이 어느 것도 y 를 안 본다.
 */
export function rowChannelsOf(
  orderByDepth: ReadonlyMap<number, readonly string[]>,
  rowChannelNeeds: readonly RowChannelNeed[],
): { rowChannels: RowChannel[]; reach: Map<string, number> } {
  // 3b) **행 채널의 신원** — 깊이 · 순번 · 이웃. 자리(`top`/`bottom`)는 5단계가 채운다.
  //
  //     **마진도 행 채널이다** — 이웃이 없을 뿐, 거기로 나가는 경로들이 행을 다투는 것은 같다.
  const rowChannels: RowChannel[] = [];
  for (const [depth, ids] of orderByDepth) {
    const first = ids[0];
    const last = ids[ids.length - 1];
    if (first === undefined || last === undefined) continue;
    rowChannels.push({ depth, index: -1, kind: "marginN", top: 0, bottom: 0, below: first, height: 0 });
    for (let i = 0; i + 1 < ids.length; i++)
      rowChannels.push({
        depth, index: i, kind: "between", top: 0, bottom: 0, above: ids[i], below: ids[i + 1], height: 0,
      });
    rowChannels.push({
      depth, index: ids.length - 1, kind: "marginS", top: 0, bottom: 0, above: last, height: 0,
    });
  }

  // 3c) **행 채널 트랙 배정 → 높이.** 폭 역전 — 높이는 고르는 값이 아니라 배정의 결과다.
  //
  //     수요 하나 = *"이 모듈의 이 면 바깥 행 채널에서 가로로 달린다"*. 면이 N 이면 그 모듈
  //     **위** 행 채널, S 면 **아래** 행 채널이다.
  {
    const rowChannelOf = (nodeId: string, depth: number, face: ModulePort["face"]) =>
      rowChannels.find(
        (b) =>
          b.depth === depth
          && (face === "N" ? b.below === nodeId : b.above === nodeId),
      );
    const byRowChannel = new Map<RowChannel, RowCrossing[]>();
    for (const n of rowChannelNeeds) {
      const rowChannel = rowChannelOf(n.nodeId, n.depth, n.face);
      if (!rowChannel) continue; // 그 면에 행 채널이 없다 — 있을 수 없다(마진이 늘 있다). 안전망.
      // **어느 쪽에서 행 채널로 들어오나** — 면이 답한다. `N` 면이면 행 채널은 모듈 **위**에 있으므로
      // 그 경로는 행 채널의 **아래** 변에서 올라온다. `S` 면은 거울이다. 이 한 값이 교차를
      // 없애는 순서를 정한다([planRowChannel] 의 전순서).
      (byRowChannel.get(rowChannel) ?? byRowChannel.set(rowChannel, []).get(rowChannel)!).push({
        id: n.id, x1: n.x1, x2: n.x2, side: n.face === "N" ? "bottom" : "top",
      });
    }
    // 수요가 없는 행 채널도 하한(`ROW_CHANNEL_MIN`)만큼은 선다 — `planRowChannel([])` 이 그 값이다.
    for (const rowChannel of rowChannels) rowChannel.height = planRowChannel([]).height;
    for (const [rowChannel, crossings] of byRowChannel) {
      const plan = planRowChannel(crossings);
      rowChannel.height = plan.height;
      rowChannel.tracks = plan.tracks;
    }
  }

  // **행 채널 관통 판정의 재료** — 가로 트랙이 덮는 최대 로컬 x. 세로 직진이 그 열을
  // 밟는지 판정하는 데 쓴다(`layoutRegions` 의 ③ 관통). 수요 기준이라 보수적이다.
  const rowChannelReach = new Map<string, number>();
  for (const n of rowChannelNeeds) {
    const k = rowChannelKey(n.depth, n.face === "N" ? "below" : "above", n.nodeId);
    rowChannelReach.set(k, Math.max(rowChannelReach.get(k) ?? -1, n.x2));
  }
  return { rowChannels, reach: rowChannelReach };
}
