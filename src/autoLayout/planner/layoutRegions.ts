/**
 * layoutRegions — **광선**: 어느 방향으로 나가면 **무엇을 지나나**.
 *
 * 단일 출처: `docs/auto-layout/common/exit-ray.md` (옛 계획서 `tempPlanDocs/두점-잇기/` 는 실행됐다)
 *
 * ## 이 파일이 있는 이유
 *
 * 반출·납품의 자격을 재는 코드가 오늘 저마다 다른 것을 뒤진다 — 형제 모듈의 y 구간,
 * 끝 열인가, 전역 y 범위, 깊이 수. 그런데 실제로 묻고 싶은 것은 한 문장이다:
 *
 * > *"내 상자에서 이 방향으로 나가면, 도면 밖에 닿을 때까지 **무엇을 지나나**?"*
 *
 * 그 답이 [RayRegion] 목록이다. 목록의 각 칸은 **넷 중 하나**이고, 넷마다 규칙이 정해져
 * 있다(`exit-ray.md` §3):
 *
 * ```
 * ① 모듈 몸통   협상 불가. 뚫려 있으면 통과, 아니면 그 방향 끝
 * ② 통로 · 환승  통로를 따라 **꺾어** 나간다 → 그 축의 줄을 **산다** → 모자라면 넓어진다
 * ③ 통로 · 관통  방향을 유지한다 → 파는 줄과 **직교** → **살 게 없다** → "비었나?" 만 묻는다
 * ④ 마진        여백. 통과하고 seat 줄에 앉는다
 * ```
 *
 * ## **좌표를 안 쓴다**
 *
 * 배치는 두 축 모두 **정해진 순서로 번갈아** 놓인다:
 *
 * ```
 * 가로   [W 마진] [열 0] [열채널 1] [열 1] [열채널 2] … [열 D] [E 마진]
 * 세로   [marginN] [모듈 #0] [사이 행채널] [모듈 #1] … [모듈 #k] [marginS]
 * ```
 *
 * 가로 목록은 `maxDepth` 하나로, 세로 목록은 [orderByDepth](트리 DFS 순서)로 완전히
 * 결정된다 — **둘 다 `topY`·`colX` 보다 앞이다.** 좌표는 *"얼마나 먼가"* 를 말하고 순번은
 * *"무엇을 지나나"* 를 말하는데, 자격 판정에 필요한 것은 뒤쪽뿐이다.
 *
 * **세로 광선이 자기 열을 못 벗어난다는 보장:** `colWidth[d]` 가 그 열의 최대 모듈 폭이고,
 * 배치가 모든 모듈의 extent 왼쪽 변을 `colX[d]` 에 맞춘다(`shiftModule`). 그러니 모든 모듈이
 * `[colX[d], colX[d]+colWidth[d]−1]` 안에 있고, 그 안에서 위로 쏜 광선은 영원히 그 열 안이다.
 *
 * ## 한계 — **1홉까지만 본다**
 *
 * 가로 광선은 **첫 통로(또는 바깥 마진)에서 멈춘다.** 그 너머는 남의 열이고, 남의 열을
 * 가로지르려면 그 열의 행 채널로 **갈아타야** 하기 때문이다(2홉). 그래서 가로 광선의 끝은
 * 둘 중 하나다:
 *
 * ```
 * outerMargin 으로 끝난다   →  그대로 나갈 수 있다(끝 열)
 * columnChannel 로 끝난다   →  **거기서 환승해야** 나간다
 * ```
 *
 * 세로 광선은 언제나 `outerMargin` 으로 끝난다 — 자기 열의 행 채널들을 지나면 바로 바깥이다.
 *
 * 2홉(통로 갈아타기)은 `tempPlanDocs/통로-갈아타기/` 소관이다. 그때 이 함수는 재귀가 된다.
 *
 * **순수·결정적.** 좌표도 `PlacedCell` 도 안 만든다 → `planner/`(코드 폴더 축 1).
 */

import type { ExitEdge } from "./perimeterExitPlanner";

/**
 * 광선이 지나는 영역 하나. **넷 중 하나**이고, 넷이 곧 자격 규칙의 네 경우다.
 *
 * 통로가 `②환승` 인지 `③관통` 인지는 **여기서 안 정한다** — 그건 *"이 광선이 어느 축으로
 * 달리나"* 와 *"그 통로가 어느 축의 줄을 파나"* 를 견주는 **소비자의 판단**이다.
 * 이 파일은 *"무엇을 지나나"* 까지만 답한다.
 */
export type RayRegion =
  /** ① 모듈 몸통 — 협상 불가. 그 모듈에게 *"네 로컬 열/행 c 가 비었나"* 를 물어야 한다. */
  | { kind: "module"; id: string }
  /**
   * ②③ **행 채널** — 가로줄(트랙)을 판다. 세로 광선에겐 ③(관통), 가로 광선에겐 ②(환승).
   *
   * 신원은 `rowChannels` 와 같은 방식으로 **이웃 모듈**이 말한다 —
   * `above` 없으면 `marginN`, `below` 없으면 `marginS`.
   */
  | { kind: "rowChannel"; depth: number; above?: string; below?: string }
  /** ②③ **열 채널** — 세로줄(트랙)을 판다. 가로 광선에겐 ②(환승), 세로 광선에겐 ③(관통). */
  | { kind: "columnChannel"; depth: number }
  /** ④ 바깥 마진 — 여백. 아무도 안 사고 살 필요도 없다. 여기 닿으면 seat 에 앉는다. */
  | { kind: "outerMargin"; edge: ExitEdge };

/**
 * 광선이 훑을 격자. **좌표가 하나도 없다** — 순번과 깊이뿐이다.
 *
 * 둘 다 3a·3b 단계(`modulePacking`)에서 나오고 `topY` 보다 **앞**이다.
 */
export interface LayoutGrid {
  /** 깊이 → 그 열의 모듈 id 들, **위에서 아래** 순서(트리 DFS 순서 = 세로 순서). */
  orderByDepth: ReadonlyMap<number, readonly string[]>;
  /** 가장 깊은 깊이. 가로 목록의 길이를 정한다. */
  maxDepth: number;
}

/**
 * `from` 모듈에서 `dir` 로 나갈 때 **지나는 영역들**을, 자기 몸통부터 순서대로.
 *
 * 첫 칸은 언제나 `{kind:"module", id: from.id}` 다 — 자기 몸통도 넷 중 하나이므로
 * 규칙이 예외 없이 적용되게 한다(자기 몸통의 답은 `moduleWayOuts` 가 이미 갖고 있다).
 *
 * 모듈이 그 깊이 목록에 없으면 빈 배열을 낸다(있을 수 없다 — 안전망).
 */
export function regionsAlong(
  from: { id: string; depth: number },
  dir: ExitEdge,
  grid: LayoutGrid,
): RayRegion[] {
  const ids = grid.orderByDepth.get(from.depth);
  if (!ids) return [];
  const i = ids.indexOf(from.id);
  if (i < 0) return [];

  const out: RayRegion[] = [{ kind: "module", id: from.id }];
  const d = from.depth;

  if (dir === "N" || dir === "S") {
    // **세로 광선** — 자기 열의 순번 목록을 한 칸씩 거슬러 오른다(또는 내려간다).
    // 모듈 하나를 지날 때마다 그 앞에 행 채널이 하나씩 있다(마진도 행 채널이다).
    const step = dir === "N" ? -1 : 1;
    for (let k = i; ; k += step) {
      const above = dir === "N" ? ids[k - 1] : ids[k];
      const below = dir === "N" ? ids[k] : ids[k + 1];
      out.push({ kind: "rowChannel", depth: d, above, below });
      const next = ids[k + step];
      if (next === undefined) break; // 방금 지난 것이 마진 행 채널이다
      out.push({ kind: "module", id: next });
    }
    out.push({ kind: "outerMargin", edge: dir });
    return out;
  }

  // **가로 광선** — 첫 통로(또는 바깥 마진)에서 멈춘다(위 §한계).
  // W 는 자기 깊이의 채널, E 는 다음 깊이의 채널이다(`channelOpts` 와 같은 규약).
  if (dir === "W") {
    out.push(d >= 1 ? { kind: "columnChannel", depth: d } : { kind: "outerMargin", edge: "W" });
  } else {
    out.push(
      d < grid.maxDepth ? { kind: "columnChannel", depth: d + 1 } : { kind: "outerMargin", edge: "E" },
    );
  }
  return out;
}

/**
 * 행 채널의 **열쇠** — 이웃 모듈이 신원을 말한다(`rowChannels` 와 같은 규약).
 *
 * 수요 쪽(`rowChannelNeeds`)은 *"이 모듈의 N 면 바깥 행 채널"* 처럼 **한쪽 이웃**으로만
 * 그 통로를 부른다(N 면이면 자기가 `below`, S 면이면 `above`). 그래서 열쇠도 한쪽으로
 * 짓고, `between` 채널은 **양쪽 열쇠로 두 번** 조회한다.
 */
export const rowChannelKey = (
  depth: number,
  side: "above" | "below",
  nodeId: string,
): string => `${depth}:${side}:${nodeId}`;

/** 이 광선이 **그대로 바깥까지 닿나** — 마지막 칸이 마진이면 참. 아니면 거기서 환승해야 한다. */
export function reachesOutside(regions: ReadonlyArray<RayRegion>): boolean {
  return regions[regions.length - 1]?.kind === "outerMargin";
}
