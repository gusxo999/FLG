/**
 * 링크 면 배정 — **모듈 안쪽 계획**. 좌표를 모른다.
 *
 * 자식↔부모를 잇는 링크가 **어느 면에 · 몇 팔로 · 몇 칸 바깥 줄에** 앉을지 정한다.
 * 기계 좌표가 정해지기 **전에** 돌아야 한다 — gap 폭이 여기서 나오고, 그 폭이 다시
 * 기계 좌표를 정하기 때문이다(닭과 달걀을 푸는 지점).
 *
 * ```
 * 면 배정(여기, 좌표 없음) → gap 폭 → layoutCluster → 기계 좌표 → 좌석 좌표 입히기
 * ```
 *
 * 그래서 이 파일은 **팔 개수만** 본다. `Container` 도 `machines[]` 도 받지 않는다.
 *
 * **이 파일은 고른다** — 어느 면을 비켜 가나 · 포트가 어느 끝에 서나 · 어느 깊이를 먼저 보나 ·
 * 못 앉은 줄에 어떤 이름표를 붙이나. 그 자리가 비었는지 묻고 적는 일은 장부([ledger])가,
 * 깊이 목록과 gap 폭은 셈([arith])이, 포트 칸은 도형([portCells])이 답한다(2026-09-14 계획 구조-2축 · 2 Step 3a).
 */

import { inserterForReach } from "../../shared/gamedata/spec";
import type { PortFace } from "../../shared/types";
import { armsAt, resolveSpanBlock, spansAllMachines } from "../arith/link";
import type { Link } from "../types/line";
import type { DepthShortage, FaceAllocation, LinkFaceContext, LinkFacePlan } from "../types/seat";
import { recordFaceDepthStats } from "../../../debug/runStats";
import { portCells } from "../shape/link";
import { clusterBeltDepthsOf, LINK_LANE_DEPTH } from "../arith/face";
import {
  commitLinkFace, fitOnFace, fitOnGap, splitByTable, type FaceFit, type LinkFaceCandidate,
} from "../ledger/seat";

/**
 * **면에서 줄이 못 앉는 교착 넷** — *무엇이* 막혔나로 가른다. 처방이 아니라 **상태**의 이름이다.
 *
 * ```
 *   면 =  [ 좌석 d1 ][ 구간 d2… ][ 포트 d+1 ]        ← 막힌 자리가 곧 교착의 이름이다
 *
 *   seat-budget    좌석 예산 초과 — 면의 d1 칸(= faceSeatArms)이 애초에 모자라다
 *   seat-blocked   내 **좌석 칸**이 남에게 먹혔다
 *   span-blocked   좌석은 비었는데 **그 사이를 잇는 구간**이 막혔다
 *   port-blocked   구간은 지나는데 **포트 칸**이 막혔다
 * ```
 *
 * `seat-blocked` 와 `span-blocked` 는 둘 다 [DepthShortage.blockedRows] 에서 오지만 **기하가
 * 다르다** — 막힌 칸이 내 좌석 위에 있으면 앞이고, 좌석 *사이*에만 있으면 뒤다. 그 갈림이
 * 곧 [resolveSpanBlock] 이다.
 *
 * **해소자는 교착마다 하나씩이고, 지금 있는 것은 하나뿐이다:**
 *
 * | 교착 | 해소자 | 지금 |
 * |---|---|---|
 * | `span-blocked` | [resolveSpanBlock] → [splitLinkAtRows] | ✅ 사다리 1단 |
 * | `port-blocked` | (없음) | ⛔ 구간막힘과 같은 처방이 통할 자리인데 안 만들었다 |
 * | `seat-blocked` | (없음) | ⛔ gap·다이렉트의 몫 |
 * | `seat-budget` | (없음) | ⛔ gap·다이렉트의 몫 |
 *
 * 그래서 이 이름표가 곧 **미완성 기능의 경계**다 — `unrouted-lines` 이슈가 이걸 싣는다
 * (`docs/auto-layout/link/machine-link.md` — *어디까지 작동하나*).
 */
export type LadderRung = "span-blocked" | "port-blocked" | "seat-blocked" | "seat-budget";

/** 화면에 나가는 말. 셋이 `막힘` 으로 끝나고 **어디가** 막혔는지만 다르다. */
const RUNG_LABEL: Record<LadderRung, string> = {
  "span-blocked": "구간막힘",
  "port-blocked": "포트막힘",
  "seat-blocked": "좌석막힘",
  "seat-budget": "좌석부족",
};

/** 해소자가 있는 것부터. 후보 여럿이 사유가 갈리면 **풀 수 있는 쪽**이 그 줄을 맡는다. */
const RUNG_ORDER: readonly LadderRung[] = [
  "span-blocked", "port-blocked", "seat-blocked", "seat-budget",
];

function rungOf(w: DepthShortage): LadderRung {
  if (w.blockedRows?.length && w.seatRows?.length)
    return resolveSpanBlock(w.seatRows, w.blockedRows).length > 0 ? "span-blocked" : "seat-blocked";
  if (w.blockedPort?.length) return "port-blocked";
  if (w.blockedRows?.length) return "seat-blocked";
  return "seat-budget";
}

/** 줄 하나의 후보들을 한 이름표로. 후보가 없으면 `undefined` — 사유를 지어내지 않는다. */
export function rungOfLine(ws: readonly DepthShortage[]): LadderRung | undefined {
  if (ws.length === 0) return undefined;
  const seen = new Set(ws.map(rungOf));
  return RUNG_ORDER.find((r) => seen.has(r));
}

/**
 * 모듈 하나의 못 앉은 줄들을 **교착별로 센다** — `unrouted-lines` 이슈에 붙는 한 문장.
 *
 * 줄 이름과 이름표를 1:1 로 잇지 않는 것은 [GeneratedModule.depthShortages] 가 `linkId` 로만
 * 묶여 있어서다(줄 이름과의 짝은 아직 없다). **없는 대응을 지어내지 않는다.**
 */
export function summarizeRungs(shortages: Map<string, DepthShortage[]>): string | undefined {
  const tally = new Map<LadderRung, number>();
  for (const ws of shortages.values()) {
    const r = rungOfLine(ws);
    if (r) tally.set(r, (tally.get(r) ?? 0) + 1);
  }
  if (tally.size === 0) return undefined;
  return RUNG_ORDER.filter((r) => tally.has(r))
    .map((r) => RUNG_LABEL[r] + " " + tally.get(r))
    .join(" · ");
}

/**
 * 그룹 하나를 이 면에 앉혀 본다 — **장부는 안 건드린다**(확정은 호출자가 한다).
 * 그룹이 여러 머신을 관통하면(입력 트렁크) **전부** 들어가야 성공이다 — 벨트 하나를 반만
 * 옮길 수는 없다.
 *
 * 면마다 한계가 **좌석 수 하나**다(2026-07-22). 예전엔 좌석과 별개로 **depth** 도
 * 다퉜다 — 벨트가 면을 따라 끝까지 달렸기 때문에 같은 depth 두 줄이 반드시 부딪혔고, 그래서
 * 한 면의 줄 수가 팔 길이 종류 수에 묶였다. 이제 벨트는 **자기 좌석 구간만 덮고 끝에서 포트
 * 쪽으로 꺾으므로**([emitOutputLinks]) 행 구간이 안 겹치는 그룹끼리는 **같은 depth 를 그냥
 * 나눠 쓴다.** 다툴 게 없으니 장부도 없다.
 *
 *  - **W/E**: 머신 옆면의 d1 칸 = `machine.h` 개. 여러 그룹이 행을 나눠 쓴다.
 *  - **N/S(gap)**: 머신 위/아래 면의 d1 칸 = `machine.w` 개. v1 은 **면당 그룹 하나**
 *    (가로 벨트 한 줄만 깐다). 그리고 그 방향에 **gap 이 실제로 있어야** 한다: 맨 위 머신에
 *    N gap 은 없고, 맨 아래 머신에 S gap 은 없다.
 *
 * ```
 * ① 면     이 면이 받나 — 유체 면은 더 싼 면이 있을 때만 비켜 간다       [avoidsPipeFace]
 * ② 팔     gap 깊이의 팔이 없는 머신을 가리키나
 * ③ gap    N/S 면이면 그 자리 — 깊이 고정 · 몇 번째 무리인가가 반출 깊이   [fitOnGap]
 * ④ 끝     포트가 기둥 끝에 서나 · 줄이 어느 쪽으로 흐르나(깊이를 안 본다) [endOf]
 * ⑤ 후보   깊이마다 팔 수 — 팔 적은 것 → 얕은 것                          [depthCandidates]
 * ⑥ 자리   좌석 → 구간 → 포트 칸. 못 들면 사유를 남기고 다음 후보          [fitOnFace]
 * ```
 */
// **간선 축 배정이 직접 부른다**([seatLinkEdge]) — 한 링크의 양끝을 놓기 전에 둘 다
// 물어봐야 하는데, 그 두 물음이 **서로 다른 모듈의 표**에 걸린다. 그래서 판정(try)과
// 확정(commit)이 갈려 있는 지금 모양이 그대로 필요하다.
export function tryLinkFace(
  ctx: LinkFaceContext,
  group: Link,
  side: "from" | "to",
  face: PortFace,
  allowPipeFace = false,
  /** 못 앉으면 그 사유가 여기 쌓인다(후보마다 하나). 안 주면 안 모은다. */
  why?: DepthShortage[],
  /**
   * **기둥 끝 포트를 강제한다** — 레인 합류 쌍 전용([endOf]).
   * 관통이 아니어도 포트가 기둥 끝에 서야 벨트가 꺾이고, 그 꺾인 칸이 합류 칸이 된다.
   */
  forceEnd?: boolean,
  /**
   * **이 끝을 먼저 본다** — 합류 쌍 전용. `Link.end`(형제 순번)보다 우선한다.
   *
   * 형제 순번은 *"납품이 교차하지 않게"* 를 노리는 선호인데, 합류는 **그 자리가 아니면
   * 도형이 아예 없다.** 대안이 없는 쪽이 이긴다(배정 순서와 같은 원칙).
   */
  preferEnd?: "N" | "S",
  /**
   * **이 깊이를 먼저 본다** — 합류 쌍의 **따르는 줄** 전용.
   *
   * 두 줄은 구간이 안 겹쳐 **한 깊이에 위/아래로 쌓여야** 합류 도형이 선다. 그런데 후보
   * 정렬은 *"팔 적은 것 → 얕은 것"* 이라 둘이 서로 다른 깊이를 고르는 일이 잦다
   * (2026-09-04 실측: 되돌림 2건이 **전부** `depth 3 vs 2` · `2 vs 3` 이었다).
   * 이끄는 줄은 먼저 앉으므로 자기 깊이를 모르고, 따르는 줄만 상대를 안다.
   */
  preferDepth?: number,
): LinkFaceCandidate | undefined {
  // ① 면 — 유체 면은 마지막 수단. 반대 면도 유체면 동률이라 비켜 가지 않는다
  if (avoidsPipeFace(ctx, face, allowPipeFace)) return undefined;
  // ② 팔 — **gap 벨트의 깊이는 언제나 `LINK_LANE_DEPTH`(d2) 라 팔이 하나로 정해진다** — 깊이를
  // 고를 여지가 없으므로 여기서 한 번만 센다. W/E 는 ⑤ 가 후보마다 다시 센다.
  const gapArms = armsAt(group, side, inserterForReach(ctx.inserters ?? [], LINK_LANE_DEPTH - 1));
  for (const mi of gapArms.keys()) if (mi < 0 || mi >= ctx.count) return undefined;
  // ③ gap — 자원의 모양이 다르다(열 · 반출 깊이). 고를 깊이가 없어 자리만 묻는다
  if (face === "N" || face === "S") return fitOnGap(ctx, group, side, face, gapArms);
  // ④ 끝 — 관통(또는 합류 쌍)이면 기둥 끝 포트. 깊이를 안 본다
  const end = endOf(ctx, group, side, face, forceEnd, preferEnd);
  // ⑤ 후보 — 팔 적은 것 → 얕은 것
  for (const cand of depthCandidates(ctx, group, side, face, preferDepth)) {
    // ⑥ 자리 — 좌석 → 구간 → 포트 칸. 막히면 사유를 남기고 다음 후보
    const fit = fitOnFace(ctx, face, cand, end, why);
    if (!fit) continue;
    recordEndsAudit(ctx, face, cand, fit, end);
    return {
      face, arms: cand.arms, clusterBeltDepth: cand.clusterBeltDepth, reach: cand.clusterBeltDepth - 1,
      portEnd: end.portEnd, exitEnd: end.exitEnd,
    };
  }
  // 이 면의 깊이가 다 찼다 — 넘침 단계가 다른 면을 준다([spillLinkFacesToGap]).
  return undefined;
}

/**
 * **① 이 면을 비켜 가나.**
 *
 * **유체 면은 마지막 수단이다.** 여기 앉는 순간 `beltMaxOn > 0` 이 되어 파이프가 점프하고
 * ([linkFaceDepths] → `pipeJumpMode` 조건 ①) [ClusterPipe] 가 우리 포트 끝(d`clusterBeltDepth+2`)
 * **밖으로** 물러나 그 면이 여러 칸 넓어진다. 갈 곳이 있으면 그쪽이 낫다 — *"없는 위험 때문에
 * 폭을 낭비하지 않는다"* 는 `pipeJumpMode` 의 원칙과 같은 이유이고, 그 이름으로 잠긴 테스트가
 * module/build.trunkPipe.test.ts 에 있다. 그래서 선호 단계([allocateLinkFaces])는 비켜 가고,
 * 넘침 단계([spillLinkFacesToGap])만 쓴다.
 *
 * (점프 불가 면을 통째로 거절하던 가드는 **케이스 B 와 함께 사라졌다** — 2026-08-16.
 * 지금 유체 면을 다르게 만드는 것은 `depthCap` 하나뿐이다.)
 *
 * **다만 회피는 더 싼 곳이 있을 때만이다**(2026-08-16). 반대 면도 유체 면이면 어디에 앉든
 * +3 으로 **동률**이고, 동률에서 자기 역할 면을 버리면 포트가 반대편에 서서 납품 경로만
 * 길어진다(황산 꼴: 물 입력 E + 황산 출력 W — 아이템이 갈 비유체 면이 없다).
 */
function avoidsPipeFace(ctx: LinkFaceContext, face: PortFace, allowPipeFace: boolean): boolean {
  const pf = face === "W" || face === "E" ? ctx.pipeFaces?.get(face) : undefined;
  const opposite: PortFace = face === "W" ? "E" : "W";
  return pf !== undefined && !allowPipeFace && !ctx.pipeFaces?.has(opposite);
}

/** [endOf] 의 답 — 옆면(W/E) 전용. */
interface LinkEnd {
  /** 관통(또는 합류 쌍) — 기둥 끝 포트를 청구하려 했나. */
  spanning: boolean;
  /** 받은 기둥 끝. 관통인데 `undefined` 면 끝이 다 차서 옆 포트로 저하했다. */
  portEnd: "N" | "S" | undefined;
  /** 흐름이 향하는 끝. */
  exitEnd: "N" | "S" | undefined;
}

/**
 * **④ 포트가 어느 끝에 서나** — 끝 장부(`ctx.ends`)를 **읽는다**. 깊이를 안 본다.
 *
 * **관통이면 기둥 끝을 청구한다**([LinkFacePlan.portEnd]). 못 받으면 옆으로 — 그때는
 * 이 면의 깊은 관통이 상자를 가둘 수 있지만, 자리가 없는 것은 정직하게 그대로 둔다.
 * **합류 쌍은 관통이 아니어도 기둥 끝 포트를 받는다**(`forceEnd`).
 *
 * 왜: 합류는 **뒤 유입이 없는 칸**을 필요로 하고, 그런 칸은 벨트가 **꺾이는** 자리뿐이다
 * (`belt-lane-semantics` ⑤ — 뒤에서 온 쪽이 두 레인을 선점한다). 옆 포트는 벨트 끝 칸이
 * 곧 포트라 꺾을 자리가 없다. 기둥 끝 포트로 만들면 벨트가 **깊은 쪽으로 한 번 꺾고**,
 * 그 꺾인 칸이 합류 칸이 된다(도형은 `emitOutputLinks` 의 `sharedExit`).
 */
function endOf(
  ctx: LinkFaceContext,
  group: Link,
  side: "from" | "to",
  face: PortFace,
  forceEnd?: boolean,
  preferEnd?: "N" | "S",
): LinkEnd {
  const spanning = spansAllMachines(group, side, ctx.count) || forceEnd === true;
  const endsTaken = ctx.ends.get(face);
  // **선호 끝이 있으면 그것부터**. 없으면 오늘처럼 N 먼저 — 그 경우
  // 후보 순서가 `["N","S"]` 로 같아지므로 **한 칸도 안 달라진다**.
  const want = preferEnd ?? group.end?.[side];
  const endOrder = want ? ([want, want === "N" ? "S" : "N"] as const) : (["N", "S"] as const);
  const portEnd = spanning ? endOrder.find((e) => !endsTaken?.has(e)) : undefined;
  // **구간 줄도 방향을 갖는다**(2026-09-05). `want` 는 위에서 이미 계산됐는데 예전엔
  // `spanning` 이 거짓이면 **그대로 버려졌고**, 그 뒤 `portCells`/방출기가 `span[0]`(위)로
  // 상수 고정됐다 — 부모가 아래에 있어도 위로 나갔다는 뜻이다.
  //
  // 옆 포트는 깊이 방향(`d+1`·`d+2`)으로 나가므로 **`ctx.ends` 를 안 먹는다.** 그래서
  // 이 값은 희소 자원을 다투지 않는다 = 방향을 사려고 기둥 끝을 사던 거래가 사라진다
  // (`tempPlanDocs/벨트-레인/` ㉣ 3차).
  //
  // **gap(N/S) 면은 뺀다.** 거기서 벨트는 가로로 눕고 `topT` 가 행이 아니라 **열**이라,
  // 이 값의 뜻(위/아래)이 성립하지 않는다. gap 의 방향은 다른 규칙이 정한다 —
  // *"모두가 서쪽 변까지 달린다"*(`emitOutputLinks` 의 `beltDirV = {-1, 0}`).
  const exitEnd = portEnd ?? (face === "W" || face === "E" ? want : undefined);
  return { spanning, portEnd, exitEnd };
}

/**
 * **⑤ 어느 깊이부터 보나.**
 *
 * **깊이마다 팔 수를 다시 센다**(계획서 §16 · 결함 A). 깊이가 인서터를 정하고, 인서터가
 * 처리량을 정하고, 처리량이 팔 **개수**를 정한다 — 그러니 좌석 검사도 깊이마다 다르다.
 * 예전엔 팔 수를 reach 1 로 못박아 미리 세고 깊이만 골랐고, 그 줄이 d3 에 앉으면
 * **센 팔과 앉는 팔이 갈렸다**(실측: 10/s 로 세고 3.6/s 가 앉았다).
 *
 * **후보를 팔이 적게 드는 순으로 본다** — 좌석은 이 모델에서 **유일하게 못 늘리는 자원**
 * 이라(`faceSeatArms`: 면의 d1 칸이 그것뿐), 팔이 적게 드는 깊이가 그 면의 남은 예산을
 * 가장 적게 태운다. 동률이면 **얕은 쪽** — 벨트 칸을 덜 먹고 [ClusterPipe] 를 덜 밀어낸다.
 * 옛 탭 경로(`clusterPortPlanner.takeSeat`, 2026-09-02 삭제)가 쓰던 규칙 **그대로**이고,
 * 이제 그 판단을 하는 곳은 **여기 하나**다(R3). 예전엔 **도착 순으로 얕은 것부터**라 임의가 실패할 수 있는
 * 자리에 있었다(R2).
 */
function depthCandidates(
  ctx: LinkFaceContext,
  group: Link,
  side: "from" | "to",
  face: PortFace,
  preferDepth?: number,
): Array<{ clusterBeltDepth: number; arms: Map<number, number>; total: number }> {
  return clusterBeltDepthsOf(ctx, face)
    .map((clusterBeltDepth) => {
      const arms = armsAt(group, side, inserterForReach(ctx.inserters ?? [], clusterBeltDepth - 1));
      let total = 0;
      for (const k of arms.values()) total += k;
      return { clusterBeltDepth, arms, total };
    })
    .sort((a, b) =>
      // **짝의 깊이가 먼저다** — 도형이 걸린 축이라 팔 수·얕음보다 세다.
      (preferDepth !== undefined
        ? Number(a.clusterBeltDepth !== preferDepth) - Number(b.clusterBeltDepth !== preferDepth)
        : 0)
      || a.total - b.total || a.clusterBeltDepth - b.clusterBeltDepth);
}

/**
 * **A1 — 기둥 밖 칸 장부를 나란히 돌린다**(`tempPlanDocs/구간-밖-주행/` 트랙 A). **관측만 한다.**
 *
 * 결정은 아직 `ends` 가 한다. 여기서는 두 답을 대조만 한다:
 *
 * ```
 * endsDisagree  outside 가 막았는데 ends 는 안 막았다  → **0이어야 한다**(모델 검증)
 * endsCoarse    ends 가 막았는데 outside 는 자리가 있다 → **A2 의 이득**
 * ```
 */
function recordEndsAudit(
  ctx: LinkFaceContext,
  face: PortFace,
  cand: { clusterBeltDepth: number },
  fit: FaceFit,
  end: LinkEnd,
): void {
  const { clusterBeltDepth } = cand;
  const bandTaken = ctx.outside.get(face);
  if (fit.claim.outside.some((k) => bandTaken?.has(k)))
    recordFaceDepthStats({ endsDisagree: 1 });
  // **끝을 못 받아 옆 포트로 저하했나** — 그런데 칸 장부로는 자리가 있었나.
  // 끝 선택은 깊이를 안 보는데([endOf] 가 후보 루프 **밖**이다) 포트 칸은 깊이에 선다 —
  // 그래서 이 대조는 깊이를 아는 **여기**서만 할 수 있다. A2 는 끝 선택 자체를
  // 이 루프 안으로 들여와야 한다.
  if (end.spanning && end.portEnd === undefined) {
    const roomAtSomeEnd = (["N", "S"] as const).some((e) =>
      splitByTable(portCells({ clusterBeltDepth, portEnd: e, exitEnd: e }, fit.span), fit.table)
        .outside.every((k) => !bandTaken?.has(k)));
    if (roomAtSomeEnd) recordFaceDepthStats({ endsCoarse: 1 });
  }
}

/**
 * **링크 면 배정 — 선호 면부터 채우고, 차면 gap 으로 넘어간다.**
 *
 * 머신 하나의 한 면에는 인서터가 `machine.h` 개까지만 앉는다(d1 칸이 그것뿐이다). 팔이 그보다
 * 많으면(거대 출력) 다른 면으로 넘길 수밖에 없다. **넘어갈 곳은 N/S(gap) 뿐이다:**
 * 반대 옆면(E)으로 넘기면 벨트가 채널 반대쪽에서 출발해 **되돌아올 길이 없다**(gap 이 0 이면
 * 클러스터를 통째로 돌아야 한다). N/S 로 넘기면 가로 벨트가 gap 을 따라 서쪽 변까지 와서
 * 90° 꺾이고, **그 꺾이는 칸이 곧 평범한 W 포트**가 된다 — 채널 장부가 이미 아는 모양이다.
 *
 * 두 단계로 나눈 이유(굶주림 방지): 출력은 W, 입력은 E 를 선호한다. 출력을 통째로 먼저
 * 처리하면 출력의 넘침이 gap 을 먼저 먹어 입력이 굶는다. 그래서
 *  - 1단계: 출력·입력 **양쪽의 선호 면 수요**를 먼저 앉히고,
 *  - 2단계: 그러고 남은 gap 을 넘침끼리 다툰다.
 *
 * 못 앉은 그룹은 `undefined` — 방출기가 정직하게 `unrouted` 로 낸다.
 */
export function allocateLinkFaces(
  ctx: LinkFaceContext,
  groups: Link[],
  side: "from" | "to",
  prefer: PortFace,
): FaceAllocation {
  const plans: (LinkFacePlan | undefined)[] = groups.map(() => undefined);
  const deferred: number[] = [];
  // **선호 면의 사유만 모은다** — 사다리는 그 줄이 *원래 앉고 싶던* 면의 못으로 자른다.
  // 다른 면으로 밀려나는 것은 넘침 단계가 이미 시도하고 실패한 뒤다(`trunk-assignment.md` §15 ⑤).
  const shortages: DepthShortage[][] = groups.map(() => []);
  groups.forEach((g, i) => {
    const cand = tryLinkFace(ctx, g, side, prefer, false, shortages[i]);
    if (cand) plans[i] = commitLinkFace(ctx, cand, side);
    else deferred.push(i);
  });
  return { plans, deferred, shortages };
}

/**
 * [allocateLinkFaces] 의 2단계 — 선호 면이 찬 그룹을 **다른 면으로** 넘긴다.
 *
 * `faces` 는 시도 순서다. 기본(링크)은 gap 뿐이고, 아래 gap(S)을 먼저 본다: 링크 수열이
 * 위→아래 단조라 아래쪽이 뒤에 오는 목적지와 가깝다.
 *
 * **원료·완제품 줄은 반대 면을 먼저 준다**(`["E"|"W", "S", "N"]`). gap 으로 넘기면 모듈이
 * **세로로 벌어지는데**([gapRowsFromPlans]), 반대 면에 빈 행이 있으면 그건 순수한 손해다.
 * 그래서 gap 은 **양 면이 다 찼을 때의 마지막 수단**이고, 그 순서가 곧 *"오늘 되는 배치는
 * 한 칸도 안 움직인다"* 를 지켜 준다 — 지금 W/E 에 앉는 것은 그대로 W/E 에 앉는다.
 */
export function spillLinkFacesToGap(
  ctx: LinkFaceContext,
  groups: Link[],
  side: "from" | "to",
  out: FaceAllocation,
  faces: readonly PortFace[] = ["S", "N"],
): void {
  for (const i of out.deferred) {
    for (const face of faces) {
      // **여기서만 유체 면이 열린다.** 선호 단계가 비켜 간 면을 마지막 수단으로 다시 본다
      // ([tryLinkFace] 의 `allowPipeFace`) — 그래서 `faces` 에 선호 면이 다시 들어 있어도 된다.
      const cand = tryLinkFace(ctx, groups[i], side, face, true);
      if (!cand) continue;
      out.plans[i] = commitLinkFace(ctx, cand, side);
      break;
    }
  }
}
