/**
 * **링크 면 배정의 장부** — 면마다 좌석표 · 기둥 끝 · 기둥 밖 칸. 차리고([openLinkFaceContext] · [reopenLinkFaceContext])
 * 묻고([fitOnGap] · [fitOnFace]) 적는다([commitLinkFace] · [seatOnSharedBelt]).
 *
 * **고르지 않는다.** 어느 면 · 어느 끝 · 어느 깊이를 먼저 볼지는 정책([linkPlanner])이 정하고,
 * 여기는 *"그 자리가 비었나"* 와 *"그 자리를 적는다"* 만 답한다. 묻는 함수는 장부를 **읽기만**
 * 한다 — 표가 없으면 차릴 뿐이다([tableOf]).
 *
 * 예전엔 `generateModule` 이 좌표 단계에서 `placeLedger` 라는 빈 장부를
 * 새로 만들어 **여기서 이미 센 누적값을 처음부터 다시 셌다**. 배정이 알던 값을 계층 경계
 * 너머로 전하지 못해 생긴 중복이었다 — 이제 [commitLinkFace] 가 그 순번을
 * [LinkFacePlan.slotIndex] 에 실어 보내므로, 좌표 단계는 **덧셈만** 한다.
 *
 * > **내력.** `module/policy/link.ts` 에 정책과 섞여 있다가 2026-09-14 여기로 왔다(계획 구조-2축 · 2 Step 3a).
 * > 무대를 차리고 베끼는 둘은 `module/policy/port.ts` 에서 왔다(Step 3b).
 */

import { faceSeatArms } from "../../shared/gamedata/spec";
import type { PortFace } from "../../shared/types";
import { machinesOn } from "../arith/link";
import { flowEnd } from "../arith/trunk";
import type { Link } from "../types/line";
import type { ModuleInput } from "../types/module";
import type {
  DepthShortage, LinkFaceContext, LinkFacePlan, SeatLedgerView,
} from "../types/seat";
// **도형의 단일 출처** — 방출기가 부르는 그 함수를 청구도 부른다(work-kinds §7 D1).
import { linkShape, portCells, shapeCells } from "../shape/link";
import {
  claimDepth, claimSeats, copyFaceTable, freeSeatRows, groupsOn, depthClear, makeFaceTable,
  rowIndex, seatsTaken, takeOwner, type FaceTable,
} from "./face";
import { LINK_LANE_DEPTH } from "../arith/face";

/**
 * [commitLinkFace] 전의 배정안. **인서터 행(`slotIndex`)까지 든다** — 행은 정책이 묻기 때 고르고
 * ([seatRowsOf] — `module/policy/link`), 여기서는 받은 행을 검사하고 적기만 한다.
 *
 * (예전엔 *"순번은 확정 시점에야 정해진다"* 며 이 장부가 도장을 찍는 순간 빈 칸을 앞에서부터 집었다.
 *  같은 계산이 구간 재기 · 사유 · 확정 · 합류 네 곳에 있었고, 그래서 행을 고르는 규칙을 바꿀 자리가 없었다.)
 */
export type LinkFaceCandidate = Omit<LinkFacePlan, "mergeRole" | "sharesBelt">;

/**
 * **이 면의 좌석표** — 없으면 만든다.
 *
 * 면마다 표가 따로인 이유는 **행의 뜻이 다르기 때문**이다: W/E 면의 행은 머신 세로 칸(`h`),
 * N/S 면의 행은 가로 칸(`w`) 이다. 유체 상자는 W/E 에만 붙으므로 N/S 표는 언제나 비어서 시작한다.
 */
export function seatTableOf(ctx: LinkFaceContext, face: PortFace): FaceTable {
  const found = ctx.tables.get(face);
  if (found) return found;
  const isGap = face === "N" || face === "S";
  const made = makeFaceTable(
    isGap ? ctx.machine.w : ctx.machine.h,
    ctx.count,
    isGap ? [] : (ctx.pipeFaces?.get(face)?.rows ?? []),
  );
  ctx.tables.set(face, made);
  return made;
}

/**
 * 이 그룹의 벨트가 면에서 먹을 **행 범위** — 연속이라 `[최소, 최대]` 하나로 족하다.
 * 받은 인서터 행([LinkFacePlan.slotIndex])의 셈이다 — 행을 고르는 것은 정책이다.
 *
 * 좌표가 아니라 **모듈 안 순번**이다([FaceTable] 의 행 번호 그대로).
 */
function beltRowSpan(t: FaceTable, slotIndex: ReadonlyMap<number, readonly number[]>): readonly [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [mi, slots] of slotIndex)
    for (const s of slots) {
      lo = Math.min(lo, rowIndex(t, mi, s));
      hi = Math.max(hi, rowIndex(t, mi, s));
    }
  return [lo, hi];
}

/**
 * 이 행이 기둥 **밖**이면 그 좌표 — `end` 쪽으로 `offset` 칸 나간 자리. 안이면 `undefined`.
 */
function outsideOf(row: number, table: FaceTable): { end: "N" | "S"; offset: number } | undefined {
  const last = table.rowsPerMachine * table.machineCount - 1;
  if (row < 0) return { end: "N", offset: -1 - row };
  if (row > last) return { end: "S", offset: row - last - 1 };
  return undefined;
}

const outsideKey = (o: { end: "N" | "S"; offset: number }, depth: number): string =>
  `${o.end}:${o.offset}:${depth}`;

/**
 * 후보가 먹는 칸을 **표 안 / 기둥 밖**으로 가른다 — 두 장부가 다르기 때문이다.
 *
 * 검사([fitOnFace] · [recordEndsAudit])와 청구([commitLinkFace])가 **같은 함수**를 부르게 해서 둘이 갈리지
 * 않게 한다. 갈리면 배정이 못 본 다툼이 방출에서 터진다.
 */
export function splitByTable(
  cells: ReadonlyArray<readonly [number, number]>,
  table: FaceTable,
): { inside: Array<readonly [number, number]>; outside: string[] } {
  const inside: Array<readonly [number, number]> = [];
  const outside: string[] = [];
  for (const [r, d] of cells) {
    const o = outsideOf(r, table);
    if (o) outside.push(outsideKey(o, d));
    else inside.push([r, d]);
  }
  return { inside, outside };
}

/**
 * **gap(N/S) 면의 자리** — 깊이가 언제나 [LINK_LANE_DEPTH] 라 고를 것이 없고 자리만 묻는다.
 * 장부는 **읽기만** 한다(좌석 수 · 그룹 수). `arms` 는 그 깊이의 팔이다([tryLinkFace] ②).
 */
export function fitOnGap(
  ctx: LinkFaceContext,
  group: Link,
  side: "from" | "to",
  face: "N" | "S",
  arms: Map<number, number>,
): Omit<LinkFaceCandidate, "slotIndex"> | undefined {
  const { machine, count } = ctx;
  // **gap(가로) 벨트는 아직 머신 하나만 맡는다.** 가로 줄 하나가 위·아래 두 대를 먹이는 것은
  // 별개 능력이고(좌석이 gap 양쪽에 하나씩 앉아야 한다), 그 전엔 조용히 겹치는 대신
  // **정직하게 자리 없음**으로 떨어뜨린다.
  if (machinesOn(group, side) !== 1) return undefined;
  const [mi, k] = [...arms][0];
  // **클러스터 양 끝은 gap 이 아니라 바깥이다.** 맨 위 머신의 N, 맨 아래 머신의 S 에는
  // 이웃이 없어 벨트가 모듈 밖으로 나간다 — 그래서 `gap` 이 `undefined` 이고, 벌릴 gap 도
  // 없다([gapRowsFromPlans] 가 안 센다). 자리는 그냥 **바깥으로 자란다**: 모듈이 차지하는
  // 범위는 `moduleExtent`(머신 ∪ 모든 셀)라 배치가 이 셀들을 이미 셈에 넣는다.
  const g = face === "S" ? mi : mi - 1;
  const gap = g >= 0 && g < count - 1 ? g : undefined;
  const gapTable = seatTableOf(ctx, face);
  const base = seatsTaken(gapTable, mi);
  // 좌석 수는 [faceSeatArms] 가 낸다(붓기·배정이 같은 자를 쓴다). gap 면(N/S)의 길이 방향
  // 칸은 `machine.w` 이고, 파이프는 W/E 에만 붙으므로 여기 유체 행은 언제나 0이다.
  if (base + k > faceSeatArms(machine.w, 0)) return undefined; // 이 면의 좌석(열)이 다 찼다
  // **[[ParallelBelt]] — 막힌 면** — 이 면의 몇 번째 그룹인가가 곧 자기 줄의 깊이다
  // (탐색 없이 순번으로 결정. 줄이 달라야 두 벨트가 **합류하지 않는다**).
  // 좌석 수가 아니라 **그룹 수**로 세는 이유: 서쪽으로 달리는 줄은 그룹마다 하나씩이지
  // 팔마다 하나가 아니다. 첫 그룹은 서쪽 변에서 시작하므로 내려갈 필요가 없다.
  const nth = groupsOn(gapTable, mi);
  return {
    face, gap, arms, clusterBeltDepth: LINK_LANE_DEPTH, reach: LINK_LANE_DEPTH - 1,
    exitDepth: LINK_LANE_DEPTH + nth,
  };
}

/** [fitOnFace] 가 들어간다고 답한 자리 — 대조([recordEndsAudit])가 같은 표·구간·칸을 다시 읽는다. */
export interface FaceFit {
  table: FaceTable;
  span: readonly [number, number];
  claim: { inside: Array<readonly [number, number]>; outside: string[] };
}

/**
 * **이 후보가 옆면(W/E)에 들어가나** — 좌석 → 벨트 구간 → 포트 칸. 못 들면 사유를 `why` 에
 * 하나 남기고 `undefined`.
 *
 * 세 검사는 *"이 후보가 들어가나"* 한 질문이고 뒤 검사가 앞 검사의 답(구간)을 읽는다 — 그래서 한 함수다.
 *
 * **머신 여럿을 맡는 그룹이 여기서 통과한다**(2026-08-16 — 계획서 §19).
 *
 * 예전엔 `arms.size !== 1` 로 통째로 거절했다. 사유는 *"관통하는 순간 다른 그룹과 depth 를
 * 다퉈야 한다"* 였는데, **그 다툼은 관통일 때만 있다**: 나가는 방향이 면과 수직이라 벨트가
 * **자기 좌석 구간만** 덮고 끝에서 꺾으므로([LinkFacePlan.clusterBeltDepth] 머리말), 행이 안 겹치는
 * 그룹끼리는 같은 깊이를 **나눠 쓴다.** 첫 칸이 언제나 포트 쪽으로 꺾여 행이 붙어도 두 벨트가
 * 이어지지 않는다([emitOutputLinks] ①).
 *
 * 그래서 자원이 둘이다 — **좌석 행**(머신마다)과 **깊이 × 행**(면마다).
 * 관통 그룹은 사이 행까지 통으로 먹으므로 깊이 하나를 통째로 청구하는 셈이 된다.
 */
export function fitOnFace(
  ctx: LinkFaceContext,
  face: PortFace,
  cand: { clusterBeltDepth: number; arms: Map<number, number>; slotIndex: ReadonlyMap<number, readonly number[]> },
  end: Pick<LinkFaceCandidate, "portEnd" | "exitEnd">,
  why?: DepthShortage[],
): FaceFit | undefined {
  const { clusterBeltDepth, arms, slotIndex } = cand;
  const { portEnd, exitEnd } = end;
  // 점프 유체 면은 유체 상자 행을 [fluidboxPipeCell] 이 먹는다 → 그만큼 좌석이 준다.
  // (`planClusterPorts.seatRowsOf` 의 `base − fluidRows` 와 같은 셈이다.)
  // **자는 [faceSeatArms] 하나다** — 붓기([edgeLinkGroups])가 같은 함수를 `fluidRows = 0` 으로
  // 부른다. 이쪽은 면이 정해진 뒤라 실제 유체 행 수를 안다. 그 차이가 곧 붓기의 낙관이고,
  // 이제 주석이 아니라 **인자**로 드러난다.
  const table = seatTableOf(ctx, face);
  const seatRows = faceSeatArms(ctx.machine.h, ctx.pipeFaces?.get(face)?.rows.length ?? 0);
  let need = 0;
  let seatsFit = true;
  for (const [mi, k] of arms) {
    need = Math.max(need, seatsTaken(table, mi) + k);
    if (seatsTaken(table, mi) + k > seatRows) seatsFit = false;
  }
  if (!seatsFit) {
    why?.push({ face, clusterBeltDepth, seats: { need, budget: seatRows } });
    return undefined; // 이 팔로는 좌석이 모자란다 — 다음 후보가 더 쌀 수 있다
  }
  // **좌석 수는 되는데 받은 행이 모자라다** — 정책이 쓸 수 없는 행을 걸렀다(자리-2). 그 머신에서
  // 빈 좌석인데 안 받은 행이 곧 막힌 좌석이다(좌석막힘). 걸러 내지 않는 규칙에서는 일어나지 않는다.
  const blockedSeats: number[] = [];
  for (const [mi, k] of arms) {
    const got = slotIndex.get(mi) ?? [];
    if (got.length >= k) continue;
    for (const s of freeSeatRows(table, mi)) if (!got.includes(s)) blockedSeats.push(rowIndex(table, mi, s));
  }
  if (blockedSeats.length > 0) {
    why?.push({ face, clusterBeltDepth, blockedRows: blockedSeats.sort((a, b) => a - b), seatRows: [] });
    return undefined;
  }
  const span = beltRowSpan(table, slotIndex);
  if (!depthClear(table, clusterBeltDepth, span[0], span[1])) {
    // **막힌 행이 곧 자름의 경계다.** 수량이 아니라 행을 담는다 — 그리고 사다리가
    // *"쪼개면 앉나"* 를 물으려면 **내 좌석 행**도 있어야 한다([resolveSpanBlock]).
    const rows: number[] = [];
    for (let r = span[0]; r <= span[1]; r++) if (!depthClear(table, clusterBeltDepth, r, r)) rows.push(r);
    const seats: number[] = [];
    for (const [mi, slots] of slotIndex) for (const t of slots) seats.push(rowIndex(table, mi, t));
    why?.push({ face, clusterBeltDepth, blockedRows: rows, seatRows: seats.sort((a, b) => a - b) });
    return undefined;
  }
  // **포트 칸까지 본다**(결함 B). 벨트만 보면 이 그룹의 포트 인서터·상자가 남의 깊이
  // 한복판에 서고, 그 사실이 아무 장부에도 안 올라간다 — 그러면 방출에서 부딪혀
  // 한쪽 줄이 통째로 사라진다(`emitModule` 의 *"구성상 발생 안 함"* 안전망).
  const claim = splitByTable(portCells({ clusterBeltDepth, portEnd, exitEnd }, span), table);
  const hitPort = claim.inside.filter(([r, d]) => !depthClear(table, d, r, r));
  if (hitPort.length > 0) {
    why?.push({ face, clusterBeltDepth, blockedPort: hitPort });
    return undefined;
  }
  return { table, span, claim };
}

/**
 * [tryLinkFace] 가 낸 배정을 **표에 적는다** — 좌석 칸과 (gap 이 아니면) 벨트 칸.
 *
 * **인서터 행([LinkFacePlan.slotIndex])은 받은 그대로 적는다** — 행을 고르는 것은 정책([seatRowsOf])이다.
 * 같은 줄의 묻기와 받기 사이에 이 장부에 다른 기록이 끼어들지 않으므로(좌석 창구의 받기는 묻기 바로 뒤다)
 * 묻기 때 고른 행이 여기서도 비어 있다.
 *
 * 예전엔 장부 둘(`used`·`faceGroups`)을 따로 밀고 셋째(`lanes`)에 구간을 얹었다. 지금은
 * **주인을 적는 일 한 번**이고, 옛 두 수는 그 주인들을 세면 나온다([seatsTaken]·[groupsOn]).
 */
export function commitLinkFace(
  ctx: LinkFaceContext,
  cand: LinkFaceCandidate,
  side: "from" | "to",
  /**
   * **레인 합류의 둘째 줄** — 청구가 다르다.
   *
   * ```
   * 끝        안 청구한다  물리 벨트당 하나여야 한다(첫 줄이 이미 청구했다)
   * 포트 칸    안 청구한다  포트가 없다. 청구하면 **첫 줄의 벨트 행**을 자기 것으로 적는다
   * 비켜 가는 열 청구한다   깊이 +2 에서 첫 줄의 포트 행까지 올라간다(그게 합류 경로다)
   * ```
   */
  opts?: {
    /** 따르는 줄 — 위 표. */
    merged?: Record<string, never>;
    /**
     * **이끄는 줄** — 포트가 옆이 아니라 **깊이 +1 열**로 옮겨 간다(벨트가 거기서 꺾여
     * 합류 칸이 되기 때문이다). 그래서 청구할 칸도 그 열이다 — 옛 [portCells] 를 쓰면
     * **엉뚱한 열을 적어** 합류 칸이 장부에 없는 채로 남고, 방출에서 남과 부딪힌다
     * (2026-09-04 실측: `unrouted-lines` + 안전망 1회).
     */
    mergeLead?: boolean;
  },
): LinkFacePlan {
  const isGap = cand.face === "N" || cand.face === "S";
  const table = seatTableOf(ctx, cand.face);
  const span = isGap ? undefined : beltRowSpan(table, cand.slotIndex);
  const owner = takeOwner(table);
  // 머신 index 오름차순으로 온다([seatRowsOf]) — 방출 순서가 결정적이어야 한다.
  for (const [mi, slots] of cand.slotIndex) claimSeats(table, mi, slots, owner);
  // 벨트·합류·포트 칸 — **도형은 [linkShape] 한 곳에서 온다**(2026-09-12 D1). 방출기가
  // 부르는 그 함수이고, 여기서는 **순번 축**으로 부를 뿐이다(방출은 좌표 축).
  //
  // gap(N/S)은 안 적는다. 그쪽은 모두가 서쪽 변까지 달려야 해서 겹침을 행이 아니라
  // **반출 깊이**(`exitDepth`)로 푼다 — 자원의 모양이 아예 다르다(그래서 도형도 갈릴 일이 없다).
  if (span) {
    const end = flowEnd(cand);
    const dir = end === "S" ? 1 : -1;
    /** 기둥 **밖** 첫 행 — 합류는 여기서 일어난다. */
    const outRow = dir > 0 ? table.rowsPerMachine * table.machineCount : -1;
    const shape = linkShape({
      role: side === "from" ? "output" : "input",
      clusterBeltDepth: cand.clusterBeltDepth,
      portEnd: cand.portEnd,
      flowToSouth: end === "S",
      mergeRole: opts?.merged ? "follow" : opts?.mergeLead ? "lead" : undefined,
      rows: span,
      outRow,
    });
    // **청구는 칸의 종류가 가른다** — 벨트는 표에 바로 적고(구간이라 기둥 밖도 표가 든다),
    // 합류 칸·포트는 [splitByTable] 로 표 안/밖을 갈라 밖은 `ctx.outside` 가 든다.
    // 그 비대칭은 오늘의 규약 그대로다 — **도형만 한 곳으로 모으고 청구 정책은 안 건드린다**
    // (건드리면 배치가 바뀐다. 장부를 하나로 접는 것은 `구간-밖-주행` A2 의 일이다).
    const band = ctx.outside.get(cand.face) ?? new Set<string>();
    for (const c of shapeCells(shape)) {
      if (c.kind === "belt") { claimDepth(table, c.depth, c.t, c.t, owner); continue; }
      const o = outsideOf(c.t, table);
      if (o) band.add(outsideKey(o, c.depth));
      else claimDepth(table, c.depth, c.t, c.t, owner);
    }
    ctx.outside.set(cand.face, band);
  }
  if (cand.portEnd && !opts?.merged) {
    const set = ctx.ends.get(cand.face) ?? new Set<"N" | "S">();
    set.add(cand.portEnd);
    ctx.ends.set(cand.face, set);
  }
  return {
    ...cand,
    // **역할은 배정이 정하고 방출은 따르기만 한다**(F2). 청구한 도형과 놓는 도형이 한 판정에서 난다.
    mergeRole: opts?.merged ? "follow" : opts?.mergeLead ? "lead" : undefined,
  };
}

/**
 * **짝의 둘째 줄을 첫 줄의 벨트에 얹는다** — 레인 공유
 * (`docs/factorio/belt-lane-semantics.md` · `tempPlanDocs/벨트-레인/`).
 *
 * ## 비대칭이 이 함수의 존재 이유다
 * ```
 * 싣는 쪽(자식)   벨트 **둘**  — 팔이 각자 먼 레인에 떨궈야 두 레인이 다 찬다
 * 집는 쪽(부모)   벨트 **하나** — 합류한 벨트가 벽의 한 칸으로 들어온다
 * ```
 * 그래서 이 함수는 **집는 쪽에서만** 불린다. 싣는 쪽은 오늘처럼 각자 자기 벨트를 잡는다.
 *
 * ## 무엇을 다시 청구하고 무엇을 안 하나
 * ```
 * 좌석(d1)   **자기 것** — 팔은 줄마다 따로 앉는다
 * 벨트 칸     안 한다 — 첫 줄이 이미 잡았고, 그게 곧 **같은 물리 벨트**라는 뜻이다
 * 포트 칸     안 한다 — 포트도 하나다(논리 포트 둘이 한 셀)
 * 기둥 끝     안 한다 — 끝 장부는 물리 벨트당 하나여야 한다
 * ```
 *
 * **깊이·면·팔 종류를 고르지 않는다** — 첫 줄이 정한 것을 그대로 받는다. 고르는 순간 두 줄이
 * 다른 벨트에 앉고, 그러면 합류한 벨트가 먹일 곳이 없어진다.
 *
 * 이 장부 함수는 **적기만** 한다 — 팔 수 · 인서터 행을 고르고 좌석이 모자란지 보는 것은 정책
 * ([seatOnSharedBelt] — `module/policy/link`)이다.
 */
export function claimSharedSeats(
  ctx: LinkFaceContext,
  shared: LinkFacePlan,
  arms: Map<number, number>,
  want: ReadonlyMap<number, number[]>,
): LinkFacePlan {
  const table = seatTableOf(ctx, shared.face);
  const owner = takeOwner(table);
  for (const [mi, slots] of want) claimSeats(table, mi, slots, owner);
  // 벨트·포트 칸·기둥 끝은 **안 청구한다** — 첫 줄의 것을 그대로 쓴다.
  return { ...shared, arms, slotIndex: new Map(want), mergeRole: undefined, sharesBelt: true };
}

/**
 * **① 무대를 차린다** — 면마다 빈 좌석표 자리 · 끝 장부 · 기둥 밖 칸 장부.
 *
 * **면마다 좌석표 한 장** — 이 배정이 아는 자리의 전부다(옛 장부 셋이 여기로 접혔다).
 * 표는 [tableOf] 가 그 면을 처음 볼 때 만들어진다(유체 칸을 미리 찍어서).
 */
export function openLinkFaceContext(
  input: Pick<ModuleInput, "machine" | "inserters">,
  count: number,
  pipeFaceRows: ReadonlyMap<PortFace, { rows: readonly number[]; depthCap: number }>,
): LinkFaceContext {
  const faceTables = new Map<PortFace, FaceTable>();
  return {
    machine: input.machine, count, tables: faceTables, pipeFaces: pipeFaceRows,
    ends: new Map(), outside: new Map(), inserters: input.inserters,
  };
}

/**
 * **굳힌 장부에서 무대를 다시 연다** — 좌석표 · 끝 · 기둥 밖 칸을 **복사해** 자기 것으로 삼는다.
 *
 * 받은 값은 안 바꾼다. `generateModule` 은 입력의 순수 함수라야 하고(같은 입력이면 같은 답), 굳힌 좌석은 그 입력의 일부다.
 * 복사가 여기 하나뿐이다 — 예전에는 넘기는 쪽(`cloneLinkFaceStage`)이 *"받는 쪽이 원본을 더럽히지 않게"* 복사했다.
 */
export function reopenLinkFaceContext(
  ledger: SeatLedgerView,
  input: Pick<ModuleInput, "machine" | "inserters">,
  count: number,
  pipeFaceRows: ReadonlyMap<PortFace, { rows: readonly number[]; depthCap: number }>,
): LinkFaceContext {
  return {
    machine: input.machine, count, pipeFaces: pipeFaceRows, inserters: input.inserters,
    tables: new Map([...ledger.tables].map(([f, t]) => [f, copyFaceTable(t)] as const)),
    ends: new Map([...ledger.ends].map(([f, set]) => [f, new Set(set)] as const)),
    outside: new Map([...ledger.outside].map(([f, set]) => [f, new Set(set)] as const)),
  };
}
