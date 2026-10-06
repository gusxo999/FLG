/**
 * **줄마다 방향** — 붓기가 낸 줄(양만 안다)에 *어느 끝으로 흘러야 하나* 를 붙인다.
 *
 * ```
 * 붓기 뒤의 줄    누가 얼마를 싣고 집나                — 방향이 없다(스칼라)
 *    ▼  directSplitLines
 * 좌석 앞의 줄    거기에 더해 편마다 흘러야 하는 끝     — 방향이 있다(벡터)
 * ```
 *
 * ## 왜 방향이 조건이 되나 — split belt 할당량 문제
 *
 * 머신 한 대가 한 품목에 벨트 줄을 둘 이상 쓰면 줄마다의 몫을 인서터가 정해 주지 않는다. 그 머신이 자기 줄들의
 * **맨 끝**에 서 있으면 벨트에 남은 양이 몫을 정한다(`docs/용어사전.md` §split belt 할당량 문제). 맨 끝에 서느냐는
 * 줄이 어느 끝으로 흐르느냐에 달렸고, 그 답은 붓기 결과에서 **유도된다**(`module/arith/lineOrder.requiredEndsOf`).
 *
 * ## 왜 좌석 앞인가
 *
 * 좌석이 방향을 **받아서** 인서터 행과 포트 칸을 고르기 때문이다(`module/policy/link.endOf`). 좌석 뒤에 정하면
 * 그 값을 쓸 자리가 없다. 붓기 앞에는 줄이 없으니 누가 두 줄을 쓰는지도 없다.
 *
 * ## 형제 순번이 준 끝(`Link.end`)보다 앞선다
 *
 * `Link.end` 는 선호다 — 납품이 채널에서 서로 안 건너게 하려는 것이고, 못 받아도 줄은 흐른다. 여기서 붙이는 끝은
 * 조건이다 — 반대로 흐르면 받는 머신이 모자란다. 그래서 이 값이 있는 줄 · 편에서는 채널의 교차가 늘 수 있고,
 * 그 교차는 채널 단계가 푼다(지하로 건너기).
 *
 * 간선마다 본다 — 한 품목은 한 간선으로만 흐르므로(자식의 산출물 하나) 그 품목의 줄은 그 간선의 목록이 전부다.
 *
 * ## 레인 합류의 짝은 건드리지 않는다
 *
 * 짝(`Link.sharedLineId`)은 두 줄이 **같은 끝**으로 나가 기둥 끝 바깥 한 행에서 만나야 선다(`./seat`). 두 줄을 쓰는 머신을
 * 그 줄들 모두의 맨 끝에 세우려면 두 줄이 서로 **다른** 끝으로 흘러야 한다 — 둘은 한 줄에서 함께 설 수 없다.
 * 레인 합류는 사용자가 켜야 도는 기능이고(`AUTO_LAYOUT_LANE_MERGE` — 기본 꺼짐), 켰다면 합치겠다는 뜻이다. 그래서
 * 짝지어진 줄은 여기서 끝을 안 받는다 — 그 줄들의 방향은 합류 도형이 정한다. 짝이 좌석에서 풀리면 그 줄은 방향 없이
 * 오늘 규칙으로 앉는다. 판정(`tree/build.recordSplitMachines`)은 그 줄들도 그대로 센다.
 */

import type { Link } from "../../module/types/line";
import { requiredEndsOf } from "../../module/arith/lineOrder";

/**
 * 간선마다 줄에 **흘러야 하는 끝**([Link.requiredEnd])을 얹는다. 그런 머신이 없는 간선은 손대지 않는다 —
 * 그 줄들의 방향은 오늘 규칙(형제 순번) 그대로다.
 *
 * 같은 Map 의 줄을 **새 객체로 갈아 끼운다**(좌석 앞이라 아직 아무도 그 객체를 쥐고 있지 않다 — `baseLinks` 가
 * 끝을 얹는 것과 같은 방식이다).
 */
export function directSplitLines(linkCache: Map<string, Link[]>): void {
  for (const [childId, groups] of linkCache) {
    const from = requiredEndsOf(groups, "from");
    const to = requiredEndsOf(groups, "to");
    if (from.size + to.size === 0) continue;
    linkCache.set(
      childId,
      groups.map((g, i) => {
        if (g.sharedLineId !== undefined) return g; // 레인 합류의 짝 — 끝은 합류 도형이 정한다
        const f = from.get(i);
        const t = to.get(i);
        if (f === undefined && t === undefined) return g;
        return {
          ...g,
          requiredEnd: { ...(f ? { from: f.end } : {}), ...(t ? { to: t.end } : {}) },
          inwardPort: { ...(f?.portMachineShared ? { from: true } : {}), ...(t?.portMachineShared ? { to: true } : {}) },
        };
      }),
    );
  }
}
