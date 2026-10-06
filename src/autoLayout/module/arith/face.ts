/**
 * **모듈 안쪽 계획의 셈** — 답이 하나이고 장부를 안 읽는다.
 *
 * 깊이 목록은 인서터와 유체 면에서, gap 폭 · 빠져나가는 옆면 · 옆면 최대 깊이는 **확정된
 * 배정([LinkFacePlan])** 에서 유도된다. 그래서 배정이 끝난 뒤 몇 번을 불러도 같은 답이다.
 * 유체 면 · 줄 가르기(링크 몫 · 유체 · 나머지) · 사다리 사유는 입력과 무대에서 유도된다.
 *
 * > **내력.** 앞 넷은 `module/policy/link.ts` 에 정책·장부와 섞여 있다가 2026-09-14 여기로 왔다
 * > (계획 구조-2축 · 2 Step 3a — 파일 하나가 한 가지 종류의 일만 하게). 뒤 다섯은 `module/policy/port.ts`
 * > 에서 왔다(Step 3b).
 */

import type { PortFace } from "../../shared/types";
import type { IoLine, PlannedLine, PortSide } from "../types/line";
import type { ModuleInput } from "../types/module";
import type { DepthShortage, LinkFaceContext, LinkFacePlan, ModuleFaces } from "../types/seat";
// **도형의 단일 출처** — 옆면 줄이 gap 행을 지나는지는 그 줄이 청구한 도형에서 읽는다(work-kinds §7 D1).
import { linkShape, shapeCells } from "../shape/link";
import {
  clusterBeltDepthCap, flowEnd, fluidJumpBlocker, fluidJumpBudgetOf, fluidLineOf, fluidLinesOnSide,
} from "./trunk";

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
export function clusterBeltDepthsOf(ctx: Pick<LinkFaceContext, "inserters" | "pipeFaces">, face: PortFace): number[] {
  const reaches = [...new Set((ctx.inserters ?? []).map((i) => i.reach))]
    .filter((r) => Number.isFinite(r) && r >= 1)
    .sort((a, b) => a - b);
  const all = reaches.length ? reaches.map((r) => r + 1) : [LINK_LANE_DEPTH];
  // **파이프가 먼저다** — 유체 면의 깊이는 지하파이프가 넘을 수 있는 데까지다.
  const cap = ctx.pipeFaces?.get(face)?.depthCap ?? Infinity;
  return all.filter((d) => d <= cap);
}

/**
 * **입력만으로 면의 깊이 목록** — 좌석 창구를 열지 않고 묻는다. [clusterBeltDepthsOf] 가 장부를 안 읽으므로
 * 인서터와 유체 면(깊이 상한)만 있으면 같은 답이 난다. 링크 단계(`link/policy/delivery`)와 관측이 쓴다.
 */
export function faceDepthsOf(
  input: Pick<ModuleInput, "machine" | "lines" | "inserters" | "fluidTrunk">,
  face: PortFace,
): number[] {
  return clusterBeltDepthsOf({ inserters: input.inserters, pipeFaces: fluidFacesOf(input).pipeFaceRows }, face);
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
 * (인서터·상자)이 먹는다는 뜻이다. 출구가 지하 횡단하면([LinkFacePlan.exitDive]) d1 은 지하벨트 입출구가 먹는다 — 같은 칸이다.
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
 * **gap 출구의 교차 — 옆면이 gap 행을 지나는 깊이**(`trunk-blocked.md` §4.2).
 *
 * gap 벨트는 기둥의 옆 변으로 나가 포트가 된다(싣는 쪽 W · 집는 쪽 E — [gapExitSidesFromPlans]). 그런데 그 변에는 여러 머신을
 * 맡은 옆면 줄이 **gap 행까지 지나며** 달린다. 면 좌석표에는 gap 행이 없어(`ledger/face` — *"머신 사이 gap 을 안 세지만"*)
 * 그 교차를 아무 장부도 몰랐고, 방출 안전망이 뒤늦게 gap 줄을 버렸다. 그것이 D8 이다.
 *
 * **확정 배정에서 유도한다** — 옆면 줄의 도형([linkShape], 표의 행 축)에서 **이웃한 두 칸이 머신 g 의 끝 행과 g+1 의
 * 첫 행**이면 그 사이 gap 행을 땅 위로 지난다. 몸통(`tunnels`)으로 건너는 줄은 두 칸이 이웃하지 않으므로 저절로 빠진다
 * (gap 행이 땅속이다). 역할은 가리지 않는다 — 면마다 표가 한 장이고 싣는 쪽 · 집는 쪽이 함께 앉는다. 나머지 줄도 센다.
 * 그래서 **앉는 순서와 무관한 답**이다(gap 좌석이 먼저 서고 옆면 줄이 나중에 와도 같다).
 *
 * 반환: `${면}:${gap}` → 그 gap 에서 그 면을 땅 위로 지나는 **가장 깊은 깊이**. 지나는 것이 없으면 키가 없다.
 * 벨트를 공유한 줄(`sharesBelt`)은 자기 칸이 없어 안 센다 — 첫 줄의 도형이 이미 셌다.
 *
 * 누가 들어가나의 기준은 docs/auto-layout/common/layout-models.md §3.5(두점 라우팅 제4조 ③ — 상대가 많은 쪽 · 매체마다 규칙)다.
 */
export function sideCrossingsFromPlans(
  rowsPerMachine: number,
  count: number,
  lists: ReadonlyArray<{ role: "output" | "input"; plans: readonly (LinkFacePlan | undefined)[] }>,
): Map<string, number> {
  const h = Math.max(1, rowsPerMachine);
  const out = new Map<string, number>();
  for (const { role, plans } of lists)
    for (const p of plans) {
      if (!p || p.face === "N" || p.face === "S" || p.sharesBelt) continue;
      const rows = [...p.slotIndex].flatMap(([mi, slots]) => slots.map((s) => mi * h + s));
      if (rows.length === 0) continue;
      const flowToSouth = flowEnd(p) === "S";
      // 청구([commitLinkFace])와 **같은 입력**으로 부른다 — 표의 행 축 · 기둥 밖 첫 행 · 최종 몸통
      const shape = linkShape({
        role, clusterBeltDepth: p.clusterBeltDepth, portEnd: p.portEnd, flowToSouth, mergeRole: p.mergeRole,
        rows: [Math.min(...rows), Math.max(...rows)], outRow: flowToSouth ? h * count : -1, tunnels: p.tunnels,
      });
      const cells = shapeCells(shape);
      for (let i = 1; i < cells.length; i++) {
        const [a, b] = [cells[i - 1], cells[i]];
        if (a.depth !== b.depth || Math.abs(a.t - b.t) !== 1) continue;
        const lo = Math.min(a.t, b.t);
        // 머신 g 의 끝 행(lo)과 g+1 의 첫 행 — 그 사이가 gap g 다. 기둥 밖(lo < 0 · 끝 머신 뒤)은 gap 이 아니다
        if ((lo + 1) % h !== 0 || lo < 0 || lo + 1 >= h * count) continue;
        const key = `${p.face}:${(lo + 1) / h - 1}`;
        out.set(key, Math.max(out.get(key) ?? 0, a.depth));
      }
    }
  return out;
}

/**
 * **gap 출구가 옆면에서 건널 수 있는 가장 깊은 깊이 — 입력만으로 아는 상한.** 출구의 지하 횡단 자격이 이 값을 본다
 * (`module/policy/link.tryLinkFace` ③′ — `trunk-blocked.md` §4.2).
 *
 * 옆면 칸이 gap 행을 지나는 깊이는 줄의 벨트 깊이([clusterBeltDepthsOf])이고, 그 면에 합류 쌍이 앉을 수 있으면(`merges`)
 * 따르는 줄의 비켜 가는 열(깊이 +2 — `shape/link` 의 `follow`)까지다. 배정을 안 읽는다 — gap 좌석이 먼저 서고 옆면 줄이 나중에 와도
 * 그 줄은 이 안에 선다. 깊이가 하나도 없는 면(유체 면의 `depthCap`)에는 줄이 못 앉으므로 0 이다.
 */
export function sideCrossBound(
  ctx: Pick<LinkFaceContext, "inserters" | "pipeFaces">,
  face: PortFace,
  merges: boolean,
): number {
  const depths = clusterBeltDepthsOf(ctx, face);
  if (depths.length === 0) return 0;
  return Math.max(...depths) + (merges ? 2 : 0);
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
 * **gap(N/S) 스필은 지하 횡단할 때만 센다.** 지하 횡단하지 않는 출구의 포트 끝은 옆면의 d1·d2 에 앉는데 [ClusterPipe] 는
 * 최소 d3 이라 부딪히지 않는다. 그리고 *"그 면의 좌석 줄을 먹는다"* 는 사실은 [gapExitSidesFromPlans] 가 이미 따로
 * 전한다(점프 조건 ④) — 여기서 또 세면 답은 안 바뀌고 폭만 넓어진다. **지하 횡단하는 출구**([LinkFacePlan.exitDive])는
 * 포트 상자가 출구 옆면 d`exitDive + 3` 까지 나간다 — 합류 쌍의 비켜 가는 열(깊이 +2)을 건너면 그 옆면 줄들의 포트 끝보다
 * 깊어서 [ClusterPipe] 와 부딪힐 수 있다(`trunk-blocked.md` §4.2). 그래서 그 깊이를 출구 옆면(`gapExits` — 싣는 쪽 W ·
 * 집는 쪽 E)에 센다.
 */
export function linkFaceDepths(
  lists: readonly (LinkFacePlan | undefined)[][],
  gapExits?: Partial<Record<"W" | "E", readonly (LinkFacePlan | undefined)[][]>>,
): Partial<Record<PortFace, number>> {
  const by: Partial<Record<PortFace, number>> = {};
  for (const list of lists)
    for (const p of list) {
      if (!p || p.face === "N" || p.face === "S") continue;
      by[p.face] = Math.max(by[p.face] ?? 0, p.clusterBeltDepth + 2);
    }
  for (const face of ["W", "E"] as const)
    for (const list of gapExits?.[face] ?? [])
      for (const p of list)
        if (p?.exitDive !== undefined) by[face] = Math.max(by[face] ?? 0, p.exitDive + 3);
  return by;
}

/**
 * **⓪ 유체 면 — 모든 배정보다 먼저.** 면마다 유체 줄 수 · 깊이 상한 · 점프 가능.
 *
 * 머신 `fluid_boxes` 가 강제하는 값이라 우리가 협상할 수 없다(제약이 가장 센 것 먼저 —
 * 스도쿠 원칙). 그리고 ①도 이 답을 알아야 한다: 유체가 가져간 면에 링크를 앉히면 인서터가
 * 파이프 칸에 선다. 예전엔 ①이 ② 앞에 있어 그 사실을 **모른 채** 배정했다.
 * 슬롯 목록은 **접히지 않고 그대로 온다**(`docs/용어사전.md §BuildSpec`). 예전엔 이진 필드에서 다시 폈다.
 */
export function fluidFacesOf(input: Pick<ModuleInput, "machine" | "lines" | "inserters" | "fluidTrunk">): {
  pipeFaces: { side: PortSide; fluidRows: number; depthCap: number }[];
  pipeFaceRows: Map<PortFace, { rows: readonly number[]; depthCap: number }>;
  isJumpableToClusterPipe: (side: PortSide) => boolean;
} {
  const ft = input.fluidTrunk;
  // [isJumpableToClusterPipe] — "이 면에서 파이프가 좌석을 비우고 밖으로 점프할 수 있나".
  // **면마다 따로 판정한다** — 면마다 유체 줄 수가 다르고, 그 수가 아래 ②③을 둘 다 바꾼다.
  // 판정 자체는 [fluidJumpBlocker] 가 단독으로 갖는다 — [admitFluidTrunks] 가 `n ≥ 2` 인 면을
  // **거절**할 때 같은 공식을 봐야 하기 때문이다(둘로 갈리면 계획과 사유가 어긋난다).
  // 유체 한 줄이면 못 넘어도 옛 스파인으로 **연속적 저하**이고, 두 줄이면 거절이다.
  // 예산은 거절과 **같은 함수**가 조립한다([fluidJumpBudgetOf]).
  const jumpBudget = fluidJumpBudgetOf({
    undergroundPipeEntityName: ft?.undergroundPipeEntityName,
    pipeMaxUndergroundDistance: ft?.pipeMaxUndergroundDistance,
    seatRows: input.machine.h,
    inserters: input.inserters,
    itemLineCount: input.lines.filter((l) => l.kind !== "pipe").length,
  });
  /**
   * 이 면의 **깊이 상한** — 지하파이프 사거리가 정한다([clusterBeltDepthCap]). 유체가 없는 면은
   * 상한이 없다. *"사거리가 짧으면 파이프 배치를 우선한다"* 가 이 한 줄이다(2026-08-16).
   */
  const depthCapOf = (side: PortSide): number => {
    const n = fluidLinesOnSide(ft, side).length;
    return n === 0 ? Infinity : clusterBeltDepthCap(n, ft?.pipeMaxUndergroundDistance);
  };
  const isJumpableToClusterPipe = (side: PortSide): boolean => {
    const n = fluidLinesOnSide(ft, side).length;
    if (n === 0) return false; // 유체가 없는 면은 점프할 것도 없다.
    return fluidJumpBlocker(n, jumpBudget) === null;
  };
  /** ③ 이 보는 면별 요약 — 유체 행 수와 점프 여부. 없는 면은 목록에 안 넣는다. */
  const pipeFaces = (["W", "E"] as const)
    .map((side) => ({ side, fluidRows: fluidLinesOnSide(ft, side).length, depthCap: depthCapOf(side) }))
    .filter((f) => f.fluidRows > 0);
  /**
   * ① 이 보는 같은 사실 — 다만 **행 번호까지** 필요하다(③ 은 개수만 쓴다). 링크는 점프 면의
   * 유체 상자 행을 건너뛰고 앉아야 하므로 `fluidboxOffset` 을 그대로 넘긴다.
   */
  const pipeFaceRows = new Map<PortFace, { rows: readonly number[]; depthCap: number }>(
    pipeFaces.map((f) => [
      f.side as PortFace,
      { rows: fluidLinesOnSide(ft, f.side).map((l) => l.fluidboxOffset), depthCap: f.depthCap },
    ]),
  );
  return { pipeFaces, pipeFaceRows, isJumpableToClusterPipe };
}

/**
 * **② 링크가 맡은 줄의 열쇠** `${role}:${name}`.
 *
 * 링크가 맡은 줄은 **자기 기하를 스스로 갖는다**(emitOutputLinks/emitInputLinks) — 그래서
 * ③의 tap/direct 판정 대상이 아니다. ③ 입력에서 빼되, 그 줄이 먹은 좌석은 ①의 장부에
 * 남아 있어 ③이 정확한 예산을 본다. 빼지 않으면 두 문제가 생긴다:
 *  ① 링크 줄이 좌석을 넘겨 ③이 direct 로 떨어지면, 링크 방출이 안 불려 포트가 통째로
 *     사라진다(자식 direct + 부모 tap → 포트 모양이 어긋나 납품 경로가 샌다 — 2026-07-19 실측).
 *  ② ③이 이미 링크가 찜한 자리를 또 배정해 셀이 겹친다.
 */
export function linkedKeysOf(st: Pick<ModuleFaces, "outLinks" | "inLinks">): Set<string> {
  const { outLinks, inLinks } = st;
  const linkedKeys = new Set([
    ...outLinks.map((g) => `output:${g.item}`),
    ...inLinks.map((g) => `input:${g.item}`),
  ]);
  return linkedKeys;
}

/**
 * **③ 유체(pipe) 줄 — 면을 우리가 못 고른다.**
 *
 * 머신 fluid_box 가 강제하고 [FluidTrunkInput.lines] 로 **줄마다** 온다(면·행·순번). 그래서
 * ③에 안 보내고 여기서 [PlannedLine] 을 만든다(depth=1, reach 없음). ③의 **케이스 B 아이템
 * 예약은 그대로**다 — 아래 `pipeFaces` 로 그 면 아이템을 깊이로 밀 뿐, 유체 **줄**은 안 본다.
 *
 * 유체는 트렁크(tap)로만 성립한다 — 배정을 못 받은 유체 줄이 하나라도 있으면 통째로
 * 정직히 실패한다([restOutcomeOf]). 반만 놓으면 유체를 못 받는 머신이 **조용히 굶는다.**
 */
export function pipeLinesOf(input: Pick<ModuleInput, "lines" | "fluidTrunk">): {
  planned: PlannedLine[];
  /** 배정을 못 받은 유체 줄이 있다. 유체 줄이 없으면 언제나 거짓이다(루프 안에서만 참이 된다). */
  cannotPlace: boolean;
} {
  const pipeLines = input.lines.filter((l) => l.kind === "pipe");
  const pipePlanned: PlannedLine[] = [];
  let fluidCannotPlace = false;
  for (const line of pipeLines) {
    const assigned = fluidLineOf(input.fluidTrunk, line);
    if (!assigned) {
      fluidCannotPlace = true;
      continue;
    }
    pipePlanned.push({ line, side: assigned.side, clusterBeltDepth: 1, reach: undefined });
  }
  return { planned: pipePlanned, cannotPlace: fluidCannotPlace };
}

/**
 * **④ 나머지 줄** — 파이프도 링크도 아닌 줄. ①이 남긴 예산 안에서 앉는다([seatRestLines]).
 *
 * **여기 있던 [insertingPlanner] 호출은 사라졌다**(2026-09-02). 그것이 내던 것은 모듈
 * 하나의 라벨(`tap`/`direct`)과 사유 문장이었는데, 배치 흐름에는 그 라벨로 갈리는 분기가
 * 하나도 없었고(방출 통합 2026-08-16), `g` 는 깊이 예산이 정하고(⑤-2), 화면의 처방은
 * 사실에서 나온다([unpourableFix]·[DepthShortage]). 남은 독자가 0이 되어 지웠다.
 */
export function restLinesOf(input: Pick<ModuleInput, "lines">, linkedKeys: ReadonlySet<string>): IoLine[] {
  return input.lines.filter(
    (l) => l.kind !== "pipe" && !linkedKeys.has(`${l.role}:${l.name}`),
  );
}

/**
 * **⑥ 못 앉은 줄의 사유** — 화면의 이름표(`summarizeRungs`)가 읽는다. 링크 줄은 신원(`linkId`)으로, 나머지 줄은
 * `rest:${역할}:${순번}:${품목}` 으로 담는다(나머지 줄은 신원이 없다).
 *
 * 나머지 줄은 2026-09-25 부터 담는다(`trunk-blocked.md` §4.2) — 그 전엔 신원이 없어 빠졌고, 좌석에서 못 앉은 나머지 줄이
 * 화면에 *"방출에서 자리가 없었다"* 로 떴다. gap 출구가 지하벨트 없이 거절되는 줄이 생기면서 그 사유가 화면까지 가야 했다.
 */
export function depthShortagesOf(
  st: Pick<ModuleFaces, "outLinks" | "inLinks" | "out" | "in">,
  rest?: {
    out: { groups: readonly { item: string }[]; plans: readonly (LinkFacePlan | undefined)[]; shortages: DepthShortage[][] };
    in: { groups: readonly { item: string }[]; plans: readonly (LinkFacePlan | undefined)[]; shortages: DepthShortage[][] };
  },
): Map<string, DepthShortage[]> {
  const { outLinks, inLinks } = st;
  const outFaces = st.out;
  const inFaces = st.in;
  const depthShortages = new Map<string, DepthShortage[]>();
  for (const [groups, alloc] of [[outLinks, outFaces], [inLinks, inFaces]] as const) {
    alloc.plans.forEach((p, i) => {
      const id = groups[i]?.id;
      const w = alloc.shortages[i];
      if (p || id === undefined || !w?.length) return;
      depthShortages.set(id, w);
    });
  }
  for (const [role, side] of [["output", rest?.out], ["input", rest?.in]] as const)
    side?.plans.forEach((p, i) => {
      const w = side.shortages[i];
      if (p || !w?.length) return;
      depthShortages.set(`rest:${role}:${i}:${side.groups[i]?.item ?? "?"}`, w);
    });
  return depthShortages;
}
