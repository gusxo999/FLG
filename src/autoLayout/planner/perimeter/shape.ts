/**
 * **외곽 관심사의 도형** — 반출 출구의 **자격**: 이 방향이 직진 후보인가 · 이 옆면에 환승할 열 채널이 있나.
 *
 * 광선([layoutRegions.regionsAlong])을 쏴 지나는 것들에게 묻는다 — 자기 몸통(`wayOuts`) · 남의 모듈의 몸통 열 요약 ·
 * 행 채널의 가로 트랙 도달. 답이 하나이고 **순서와 무관하다**(모듈 · 방향 · 격자의 순수 함수). 어느 후보를 먼저 두나(선호)와
 * 앞선 상자가 그은 직진에 막히나(강등)는 정책(`perimeterExitPlanner`)이 쥔다.
 *
 * `why` 를 주면 떨어진 방향마다 사유를 적는다 — 관측이다(읽는 곳 `describeBlocked` 가 열쇠로 정렬해 적는다).
 *
 * > **내력.** `perimeterExitPlanner.enumerateOptions` 의 `directOpt` 와 `channelOpts` 의 자격 절반이었다
 * > (2026-09-15 계획 구조-2축 · 2 Step 5d).
 */

import type { PortFace } from "../../containerModel";
import { regionsAlong, reachesOutside, rowChannelKey } from "../layoutRegions";
import type { ExitContext, ExitEdge, ExitOption, ExitPortInput } from "./types";

/**
 * **직진** — 상자 좌표 그대로 그 변까지. 네 방향에 **같은 규칙**이다.
 *
 * 광선을 쏴서 두 가지만 본다:
 *  ① **그대로 바깥에 닿나** — 통로에서 멈추면(가로 광선이 열 채널을 만나면) 직진이 아니다.
 *     거기서 **환승**해야 나간다.
 *  ② **지나는 것들이 내 한 열을 비워 두나** — 남의 모듈이면 그 모듈에게 묻고,
 *     행 채널이면 가로 트랙이 거기까지 뻗는지 본다. 하나라도 밟으면 그 방향은 끝.
 *
 * 예전엔 이 판정이 축마다 달랐다 — 세로는 `selfBlocked`(형제 모듈의 y 구간 비교),
 * 가로는 *"끝 열인가"*. **둘 다 「광선이 남의 모듈을 만나나 / 바깥에 닿나」의 특수형**
 * 이었다. 같은 답을 낸다: 세로는 순번 목록의 앞(N)/뒤(S)에 모듈이 있으면 막히는데
 * 순번 순서가 곧 `top` 순서이고([stackColumns] 의 누적합 + 하한 복원), 가로는 끝 열이 아니면
 * 광선이 열 채널에서 멈춘다.
 *
 * ①은 **블랙박스에게 묻는다** — *"네 로컬 열 c 가 비었나"*([ExitContext.moduleBodyColumns]).
 * 예전엔 *"모듈이 있기만 하면 막힘"* 으로 쳤는데, 그 보수성이 **우연히 직진 장부 노릇**을
 * 하고 있었다(2026-09-08 실측: 정확하게 만들자마자 가로 직진 6건이 방출에서 막혔다).
 * 이제 그 장부가 명시적으로 있으므로([DirectRay]) 정확도를 올릴 수 있다.
 */
export function directOptionOf(p: ExitPortInput, e: ExitEdge, ctx: ExitContext, why?: Map<string, string>): ExitOption | null {
  const can = (d: PortFace) => p.wayOuts.includes(d);
  /** 이 방향이 떨어졌다 — 사유를 적고 `null`. 같은 방향을 두 번 물으면 답이 같다(순수). */
  const no = (e: ExitEdge, reason: string): null => {
    why?.set(`direct:${e}`, reason);
    return null;
  };

  /** 이 방향으로 나갈 때 **지나는 영역들**([layoutRegions]). 좌표를 안 쓴다. */
  const ray = (e: ExitEdge) => regionsAlong({ id: p.moduleId, depth: p.depth }, e, ctx.grid);

  if (!can(e)) return no(e, "모듈몸통(wayOuts)");
  const regions = ray(e);
  // 가로 광선이 열 채널에서 멈춘 것 — 못 나가는 게 아니라 **거기서 환승해야** 한다.
  if (!reachesOutside(regions)) return no(e, "통로에서멈춤");
  for (const r of regions.slice(1)) {
    // ① 남의 모듈 몸통 — **협상 불가지만 블랙박스는 아니다.** 내가 설 그 한 열이
    //    그 모듈 안에서도 비어 있으면 지나갈 수 있다. 여기서 먹는 칸은 남의 extent
    //    **안**이라 어느 통로 장부에도 안 잡히는데, 그래서 [DirectRay] 가 필요했다.
    if (r.kind === "module") {
      // 가로 광선은 남의 모듈을 만날 수 없다 — 1홉이라 첫 통로/마진에서 멈춘다
      // ([regionsAlong]). 도달 불가지만, 만나면 안전한 쪽으로 끝낸다.
      if (e === "W" || e === "E") return no(e, `남의모듈(${r.id})`);
      const cols = ctx.moduleBodyColumns.get(r.id);
      if (!cols) return no(e, `요약없음(${r.id})`);
      if (cols.has(p.localX)) return no(e, `남의모듈(${r.id})`);
      continue;
    }
    // ③ **관통** — 이 통로는 가로줄을 파는데 나는 세로로 지난다. **살 게 없다.**
    //    남는 질문은 하나 — *"내가 설 그 한 열이 비었나?"*
    //    통로를 넓혀도 안 풀린다(가로줄을 더 줘도 내 세로 열은 그대로 밟힌다).
    if (r.kind === "rowChannel") {
      const reach = Math.max(
        r.above === undefined ? -1 : ctx.rowChannelReach.get(rowChannelKey(r.depth, "above", r.above)) ?? -1,
        r.below === undefined ? -1 : ctx.rowChannelReach.get(rowChannelKey(r.depth, "below", r.below)) ?? -1,
      );
      // 가로 트랙이 `[0, reach]` 를 덮는다 → 밟는다.
      if (p.localX <= reach) return no(e, `행채널관통(d${r.depth})`);
    }
  }
  return { exitEdge: e, exitMode: { kind: "direct" }, wayOut: e };
}

/**
 * **환승** — 광선이 만난 열 채널을 따라 꺾어 N/S 변으로. 채널 트랙을 하나 먹는다(폭 +).
 * 모듈은 그 채널의 반대 벽에 붙으므로 진입 벽은 `wayOut` 의 반대.
 */
export function channelEntryOf(
  p: ExitPortInput,
  wayOut: "W" | "E",
  ctx: ExitContext,
  why?: Map<string, string>,
): { depth: number; wall: "W" | "E" } | null {
  const can = (d: PortFace) => p.wayOuts.includes(d);
  const ray = (e: ExitEdge) => regionsAlong({ id: p.moduleId, depth: p.depth }, e, ctx.grid);
  if (!can(wayOut)) {
    why?.set(`channel:${wayOut}`, "모듈몸통(wayOuts)");
    return null;
  }
  const found = ray(wayOut).find((r) => r.kind === "columnChannel");
  if (!found) {
    why?.set(`channel:${wayOut}`, "끝열(채널없음)"); // 그쪽엔 채널이 없다(마진이다).
    return null;
  }
  const depth = found.depth;
  const wall: "W" | "E" = wayOut === "W" ? "E" : "W";
  return { depth, wall };
}
