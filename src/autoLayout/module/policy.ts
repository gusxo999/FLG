/**
 * **모듈 정책 — 머신이 놓인 뒤에 고르는 것.** 오늘은 하나다: 유체 기둥이 좌석 줄에 머무를지, 벨트들을 지하로 넘어
 * 바깥 [ClusterPipe] 로 점프할지([buildTrunkContext]). 넘을 것이 없으면 옛 스파인이 최선이라 **대안 중에서 고른다.**
 *
 * 머신 좌표가 필요한 것은 기둥 틀(`ext`) 하나뿐이다 — 점프 여부 · ClusterPipe 깊이 · 엇갈림 기준은 좌표를 안 본다.
 * 그 셋을 계획으로 올릴지는 정하지 않았다(module-planning §5 *"넷을 계획으로 옮길지는 정하지 않았다"*).
 *
 * > **내력.** 2026-09-14 까지 조율자(`clusterModule`) 안에 있었다(계획 구조-2축 · 2 Step 4c).
 */

import { fluidLineOf, fluidLinesOnSide, trunkEndKey } from "./arith";
import type { PlannedLine, PortSide } from "./types/line";
import type { ModuleInput, TrunkContext } from "./types/module";
import { machineExtent } from "./shape";
import type { Container, PortFace } from "../shared/types";

/**
 * [TrunkContext] 를 만든다 — `plan.lines`(유체 줄) 전체를 한 번 훑어야 나오는 값들이라, [emitTrunkPipe] 가
 * 줄마다 되묻기 **전**에 한 번만 계산한다.
 *
 * ── [pipeJumpToClusterPipe] 모드 — 유체 줄이 좌석 줄 대신 바깥 [ClusterPipe] 로 ──
 * 점프 가능 판정(isJumpableToClusterPipe)이 참이어도, 그 면에 **벨트가 하나도 안 앉았으면**
 * 넘을 것이 없다 → 옛 스파인(d=1)이 그대로 최선이라 점프하지 않는다(폭 낭비 0).
 *
 * ClusterPipe 깊이 = 그 면 벨트 최대 깊이 + 2:
 *   +1 = [ClusterPipeTapCell] — 지하파이프는 **지하 방향으로만** 합류하고 옆(수직)으론
 *        못 이어서, 탭이 ClusterPipe 줄 위에 앉으면 세로 연속이 끊긴다 → 1칸 안쪽.
 *   +2 = ClusterPipe 본체(일반 파이프 세로줄).
 * (나중에: 벨트를 지하벨트로 접으면 탭·ClusterPipe 를 더 안쪽으로 당길 수 있다 — 최적화 보류.)
 */
export function buildTrunkContext(
  plan: { ok: true; lines: PlannedLine[] },
  machines: Container[],
  input: ModuleInput,
  isJumpableToClusterPipe: (side: PortSide) => boolean,
  gapExitSides: ReadonlySet<PortFace>,
  linkFaceDepths: Partial<Record<PortFace, number>>,
): TrunkContext {
  const ext = machineExtent(machines);

  // ── 면별 값 — trunk-pipe §5.1 공식 한 곳 ────────────────────────────────────────────────
  //   base = max(그 면 벨트 최대 깊이, 1) · D_r = base + 2 + 2r · 탭 = D_r − 1
  // `n=1, beltMax>0` 을 넣으면 `beltMax + 2` — **현행과 같은 수**다(회귀 0).
  // **그 면 벨트 최대 깊이는 링크가 먹은 깊이다**([ModulePortPlan.linkFaceDepths] — 링크 · 다이렉트 · 나머지 줄 전부).
  // 이 항을 안 세면 ClusterPipe 가 링크 포트 끝(d`clusterBeltDepth+2`) **위로** 지나가고, 파이프가 끊겨도
  // 겹침도 미배치도 아니라 아무도 못 알아챈다. 유체 면에도 링크가 앉으므로(반대 면도 유체면 비켜 가지 않는다)
  // **이 항은 배치를 바꾼다** — ClusterPipe 깊이를 옮기고 점프를 켠다(2026-09-14 계측).
  //
  // 예전엔 탭 계획(`plan.lines` 의 벨트 줄)도 함께 셌다. 그 계획은 2026-09-02 에 사라졌고 `plan.lines` 에는
  // 유체 줄만 온다 — 그 합은 언제나 0 이라 지웠다.
  const beltMaxOn = (side: PortSide): number => linkFaceDepths[side] ?? 0;
  const baseOn = (side: PortSide): number => Math.max(beltMaxOn(side), 1);

  // 점프 게이트 — 좌석 줄(d1)을 통째로 먹는 옛 스파인이 **무언가를 밟을 때** 점프한다:
  //  ① 넘을 벨트가 있다(옛 조건).
  //  ② 유체가 둘 이상 — 스파인이 둘째 유체의 상자 칸을 막는다(trunk-pipe §5.1).
  //  ③ **이 레시피가 안 쓰는 유체 상자 칸이 그 면에 있다**(2026-08-05 추가). 화학공장은 입력
  //     상자가 E 면에 둘인데 battery 는 하나만 쓴다 — 스파인이 안 쓰는 칸까지 지나 거기 붙고,
  //     합류 가드가 hard 위반으로 모듈을 거절한다. 넘을 벨트가 없어도 **비켜 가야 한다.**
  //     (실측 전에는 아이템이 늘 그 면에 있어 ①이 우연히 가려 주고 있었다.)
  //  ④ **gap 벨트가 이 면으로 빠져나간다**(2026-08-05 추가 — [gapExitSidesFromPlans]).
  //     ①이 못 보는 자리다: gap 벨트는 `plan.lines` 가 아니라 링크 배정에서 나오므로
  //     `beltMaxOn` 이 0 을 답한다. 그 벨트의 포트 끝(인서터 d1 · 상자 d2)이 gap 행에서
  //     좌석 줄을 먹고, 스파인은 거기서 **끊긴다** — 아래쪽 머신이 유체를 못 받는데 겹침도
  //     미배치도 아니라 아무도 모른다. 점프하면 파이프가 d3 으로 물러나 d1·d2 를 비운다.
  const unusedBoxRowsOn = (side: PortSide): number =>
    (input.fluidTrunk?.unusedFluidboxRows?.[side] ?? []).length;
  const pipeJumpMode = (side: PortSide): boolean =>
    isJumpableToClusterPipe(side) &&
    (beltMaxOn(side) > 0 ||
      fluidLinesOnSide(input.fluidTrunk, side).length >= 2 ||
      unusedBoxRowsOn(side) > 0 ||
      gapExitSides.has(side));
  const clusterPipeDepth = (side: PortSide, rank: number): number => baseOn(side) + 2 + 2 * rank;

  const emitDepthOf = (p: PlannedLine): number => {
    if (p.line.kind !== "pipe") return p.clusterBeltDepth;
    const side = p.side as PortSide;
    if (!pipeJumpMode(side)) return p.clusterBeltDepth; // 옛 스파인 — d1 로 기둥 전체.
    return clusterPipeDepth(side, fluidLineOf(input.fluidTrunk, p.line)?.rank ?? 0);
  };

  const maxDepthAtEnd = new Map<string, number>();
  for (const p of plan.lines) {
    const k = trunkEndKey(p, input.lineEnds);
    maxDepthAtEnd.set(k, Math.max(maxDepthAtEnd.get(k) ?? 0, emitDepthOf(p)));
  }

  return { ext, pipeJumpMode, clusterPipeDepth, emitDepthOf, maxDepthAtEnd };
}
