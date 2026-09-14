/**
 * **모듈 안쪽 계획의 셈** — 답이 하나이고 장부를 안 읽는다.
 *
 * 깊이 목록은 인서터와 유체 면에서, gap 폭 · 빠져나가는 옆면 · 옆면 최대 깊이는 **확정된
 * 배정([LinkFacePlan])** 에서 유도된다. 그래서 배정이 끝난 뒤 몇 번을 불러도 같은 답이다.
 *
 * > **내력.** 넷 다 `linkPlanner.ts` 에 정책·장부와 섞여 있다가 2026-09-14 여기로 왔다
 * > (계획 구조-2축 · 2 Step 3a — 파일 하나가 한 가지 종류의 일만 하게).
 */

import type { PortFace } from "../../containerModel";
import type { LinkFaceContext, LinkFacePlan } from "../../module/types/seat";

/**
 * 링크 벨트의 기본 깊이 — 좌석(d1) 바로 바깥. v1 은 그룹마다 이 한 줄뿐이다
 * (깊이 늘리기 = 긴팔로 d≥3 을 집는 것은 후속).
 */
export const LINK_LANE_DEPTH = 2;

/**
 * **면의 깊이 목록** — reach 종류에서 유도된다. 깊이는 고르는 값이 아니라 *결과*다(계획서 §16):
 * `d2` 가 관통에 먹혔으면 다음 줄은 `d3` 이고, **그러니 그 줄의 팔이 긴팔이 된다.**
 * 거꾸로 *"긴팔을 쓸까"* 를 먼저 정하는 코드는 없다.
 *
 * **장부를 안 읽는다** — `ctx.inserters` 와 `ctx.pipeFaces` 만 본다. 그래서 배정이 끝난 뒤
 * 다시 불러도 같은 답이고, `planModulePorts` 의 사후 계측이 그 성질에 기대고 있다.
 */
export function clusterBeltDepthsOf(ctx: LinkFaceContext, face: PortFace): number[] {
  const reaches = [...new Set((ctx.inserters ?? []).map((i) => i.reach))]
    .filter((r) => Number.isFinite(r) && r >= 1)
    .sort((a, b) => a - b);
  const all = reaches.length ? reaches.map((r) => r + 1) : [LINK_LANE_DEPTH];
  // **파이프가 먼저다** — 유체 면의 깊이는 지하파이프가 넘을 수 있는 데까지다.
  const cap = ctx.pipeFaces?.get(face)?.depthCap ?? Infinity;
  return all.filter((d) => d <= cap);
}

/**
 * **gap 폭 = 그 gap 에 놓일 것들이 먹는 줄 수.** 우리가 고르는 값이 아니라 배정의 부산물이다.
 *
 * 한쪽 면이 먹는 줄 = 좌석(d1) … 벨트(d`clusterBeltDepth`) = `clusterBeltDepth` 줄. 양쪽이 쓰면 각자
 * 자기 머신 면에서 재므로 그냥 더해진다(위 머신은 위에서, 아래 머신은 아래에서 센다).
 *
 * 이 수는 방출기가 벨트를 놓을 때 쓰는 `clusterBeltDepth` **바로 그 값**이다 — 상수를 따로 적어두면
 * 방출 기하가 바뀔 때 폭이 조용히 안 따라와 벨트가 옆 머신 몸통에 놓인다.
 */
export function gapRowsFromPlans(count: number, plans: (LinkFacePlan | undefined)[][]): number[] {
  // 같은 면의 그룹들은 **덮어쓰는 게 아니라 한 줄씩 더 깊어지므로** 가장 깊은 것 하나만
  // 세고(max), 마주 보는 두 면은 각자 자기 쪽에서 재므로 더한다(sum).
  const deepest = new Map<string, number>(); // `gap:face` → 그 면이 먹는 줄 수
  for (const list of plans)
    for (const p of list) {
      if (!p || p.gap === undefined) continue;
      const key = `${p.gap}:${p.face}`;
      const d = p.exitDepth ?? p.clusterBeltDepth;
      deepest.set(key, Math.max(deepest.get(key) ?? 0, d));
    }
  const rows = new Array(Math.max(0, count - 1)).fill(0);
  for (const [key, d] of deepest) rows[Number(key.split(":")[0])] += d;
  return rows;
}

/**
 * **gap 벨트가 어느 옆면으로 빠져나가나** — 그 면의 좌석 줄(d1)과 그 바깥 줄(d2)을 포트 끝
 * (인서터·상자)이 먹는다는 뜻이다.
 *
 * 왜 이 값이 필요한가 — **트렁크 파이프와 자리를 다투기 때문이다.** 점프하지 않는 파이프는
 * 좌석 줄을 기둥 전체로 훑는데(`emitTrunkPipe` 의 d1 직선), gap 벨트의 포트 끝이 그 줄의 gap
 * 행에 앉으면 파이프가 **거기서 끊긴다.** 끊긴 아래쪽 머신들은 유체를 못 받는데, 겹침도
 * 아니고 못 놓은 줄도 아니라 **아무도 알아채지 못한다**(2026-08-05 실측 — `emitTrunkPipe` 의
 * `occupancy` 안전망이 조용히 건너뛰고 있었다).
 *
 * 방향은 방출기가 못 박아 둔 규약이다: gap 출력은 서쪽으로, gap 입력은 동쪽으로 나간다
 * ([emitOutputLinks]·[emitInputLinks] 의 `portFace`).
 *
 * `gap` 이 `undefined` 인 것(맨 위 머신의 N, 맨 아래의 S — 클러스터 **밖**)도 센다. 그 행은
 * 기둥 범위 밖이지만 파이프의 **포트 끝**(줄 끝에서 두 칸)이 거기까지 나오므로 같은 사고가
 * 난다. 판정을 좁혀 두 칸을 아끼는 것보다 안전한 쪽이 낫다 — 이 값이 참일 때 치르는 값은
 * 파이프가 점프해서 생기는 폭 2칸뿐이고, 그것도 **그 면에 유체가 있을 때만**이다.
 */
export function gapExitSidesFromPlans(
  outPlans: (LinkFacePlan | undefined)[][],
  inPlans: (LinkFacePlan | undefined)[][],
): Set<PortFace> {
  const sides = new Set<PortFace>();
  const scan = (lists: (LinkFacePlan | undefined)[][], exit: PortFace) => {
    for (const list of lists)
      for (const p of list) if (p && (p.face === "N" || p.face === "S")) sides.add(exit);
  };
  scan(outPlans, "W");
  scan(inPlans, "E");
  return sides;
}

/**
 * **링크·다이렉트가 옆면(W/E)에서 먹는 가장 깊은 칸** — [ClusterPipe] 가 그보다 바깥으로
 * 물러나야 하는 기준이다([buildTrunkContext] 의 `beltMaxOn`).
 *
 * 벨트는 [LinkFacePlan.clusterBeltDepth] 지만 **포트 끝이 두 칸 더 깊다**: 인서터 `+1` · 상자 `+2`
 * ([makeLinkPortChest]). 벨트 깊이만 세면 파이프가 그 두 칸 **위로** 지나가고, 파이프는
 * 끊겨도 겹침도 미배치도 아니라 **아무도 못 알아챈다** — 2026-08-05 의 gap 벨트 사고와
 * 같은 종류다([gapExitSidesFromPlans]).
 *
 * **gap(N/S) 스필은 세지 않는다.** 그 포트 끝은 옆면의 d1·d2 에 앉는데 [ClusterPipe] 는
 * 최소 d3 이라 부딪히지 않는다. 그리고 *"그 면의 좌석 줄을 먹는다"* 는 사실은
 * [gapExitSidesFromPlans] 가 이미 따로 전한다(점프 조건 ④) — 여기서 또 세면 답은 안 바뀌고
 * 폭만 넓어진다.
 */
export function linkFaceDepths(
  lists: readonly (LinkFacePlan | undefined)[][],
): Partial<Record<PortFace, number>> {
  const by: Partial<Record<PortFace, number>> = {};
  for (const list of lists)
    for (const p of list) {
      if (!p || p.face === "N" || p.face === "S") continue;
      by[p.face] = Math.max(by[p.face] ?? 0, p.clusterBeltDepth + 2);
    }
  return by;
}
