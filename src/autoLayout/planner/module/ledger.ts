/**
 * **링크 면 배정의 장부** — 면마다 좌석표 · 기둥 끝 · 기둥 밖 칸. 차리고([openLinkFaceContext] · [cloneLinkFaceStage])
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
 * > **내력.** `linkPlanner.ts` 에 정책과 섞여 있다가 2026-09-14 여기로 왔다(계획 구조-2축 · 2 Step 3a).
 * > 무대를 차리고 베끼는 둘은 `planModulePorts.ts` 에서 왔다(Step 3b).
 */

import { faceSeatArms, inserterForReach } from "../../buildSpec";
import type { PortFace } from "../../containerModel";
import { armsAt, machinesOn } from "../../module/link";
import { flowEnd } from "../../module/arith";
import type { Link } from "../../module/types/line";
import type { ModuleInput } from "../../module/types/module";
import type {
  DepthShortage, FaceAllocation, LinkFaceContext, LinkFacePlan, LinkFaceStage,
} from "../../module/types/seat";
// **도형의 단일 출처** — 방출기가 부르는 그 함수를 청구도 부른다(work-kinds §7 D1).
import { linkShape, portCells, shapeCells } from "../../module/linkShape";
import {
  claimDepth, claimSeats, copyFaceTable, freeSeatRows, groupsOn, depthClear, makeFaceTable,
  rowIndex, seatsTaken, takeOwner, type FaceTable,
} from "./faceTable";
import { LINK_LANE_DEPTH } from "./arith";

/** [commitLinkFace] 전의 배정안 — 순번(`slotIndex`)은 확정 시점에야 정해진다. */
export type LinkFaceCandidate = Omit<LinkFacePlan, "slotIndex" | "mergeRole" | "sharesBelt">;

/**
 * **이 면의 좌석표** — 없으면 만든다.
 *
 * 면마다 표가 따로인 이유는 **행의 뜻이 다르기 때문**이다: W/E 면의 행은 머신 세로 칸(`h`),
 * N/S 면의 행은 가로 칸(`w`) 이다. 유체 상자는 W/E 에만 붙으므로 N/S 표는 언제나 비어서 시작한다.
 */
function tableOf(ctx: LinkFaceContext, face: PortFace): FaceTable {
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
 *
 * 좌표가 아니라 **모듈 안 순번**이다([FaceTable] 의 행 번호 그대로).
 *
 * **표를 읽으므로 칸을 차지하기 전에** 불러야 한다([commitLinkFace] 가 맨 앞에서 부른다).
 *
 * 옛 코드는 `used`(논리 칸 수)에 `skipFluidRows` 를 씌워 실제 행을 구했다. 표에서는
 * **빈 좌석을 앞에서부터 집으면** 그 사상이 저절로 나오므로([freeSeatRows]) 되사상이 없다 —
 * `emitTapInserting.remapRow` 와 같은 산술을 두 곳이 갖던 자리가 하나 없어졌다.
 */
function beltRowSpan(
  ctx: LinkFaceContext,
  face: PortFace,
  arms: Map<number, number>,
): readonly [number, number] {
  const t = tableOf(ctx, face);
  let lo = Infinity;
  let hi = -Infinity;
  for (const [mi, k] of arms) {
    const free = freeSeatRows(t, mi);
    if (free.length === 0) continue;
    const first = free[0];
    const last = free[Math.min(k, free.length) - 1];
    lo = Math.min(lo, rowIndex(t, mi, first));
    hi = Math.max(hi, rowIndex(t, mi, last));
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
): LinkFaceCandidate | undefined {
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
  const gapTable = tableOf(ctx, face);
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
  cand: { clusterBeltDepth: number; arms: Map<number, number> },
  end: Pick<LinkFaceCandidate, "portEnd" | "exitEnd">,
  why?: DepthShortage[],
): FaceFit | undefined {
  const { clusterBeltDepth, arms } = cand;
  const { portEnd, exitEnd } = end;
  // 점프 유체 면은 유체 상자 행을 [fluidboxPipeCell] 이 먹는다 → 그만큼 좌석이 준다.
  // (`planClusterPorts.seatRowsOf` 의 `base − fluidRows` 와 같은 셈이다.)
  // **자는 [faceSeatArms] 하나다** — 붓기([edgeLinkGroups])가 같은 함수를 `fluidRows = 0` 으로
  // 부른다. 이쪽은 면이 정해진 뒤라 실제 유체 행 수를 안다. 그 차이가 곧 붓기의 낙관이고,
  // 이제 주석이 아니라 **인자**로 드러난다.
  const table = tableOf(ctx, face);
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
  const span = beltRowSpan(ctx, face, arms);
  if (!depthClear(table, clusterBeltDepth, span[0], span[1])) {
    // **막힌 행이 곧 자름의 경계다.** 수량이 아니라 행을 담는다 — 그리고 사다리가
    // *"쪼개면 앉나"* 를 물으려면 **내 좌석 행**도 있어야 한다([resolveSpanBlock]).
    const rows: number[] = [];
    for (let r = span[0]; r <= span[1]; r++) if (!depthClear(table, clusterBeltDepth, r, r)) rows.push(r);
    const seats: number[] = [];
    for (const [mi, k] of arms)
      for (const t of freeSeatRows(table, mi).slice(0, k)) seats.push(rowIndex(table, mi, t));
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
 * **여기서 순번([LinkFacePlan.slotIndex])도 함께 낸다.** 칸을 차지하기 직전에 고른 빈 칸이
 * 곧 "이 그룹이 몇 번째 칸을 쓰나" 이므로, 확정과 순번은 **같은 순간의 같은 사실**이다.
 * 나눠 두면 나중 단계가 같은 누적을 다시 세야 한다(옛 `placeLedger`).
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
  const table = tableOf(ctx, cand.face);
  // **칸을 차지하기 전에** 잰다 — [beltRowSpan] 이 빈 칸을 읽어 시작 행을 안다.
  const span = isGap ? undefined : beltRowSpan(ctx, cand.face, cand.arms);
  // gap 면의 좌석은 **포트 쪽부터** 채운다 — 출력 포트는 서쪽, 입력 포트는 동쪽이다.
  // (W/E 면은 나가는 쪽이 면과 수직이라 이 순서와 무관하다 — 늘 위→아래.)
  const fromEast = isGap && side === "to";
  const owner = takeOwner(table);
  const slotIndex = new Map<number, number[]>();
  // 머신 index 오름차순 — 방출 순서가 결정적이어야 한다.
  for (const [mi, k] of [...cand.arms].sort((a, b) => a[0] - b[0])) {
    // W/E 는 빈 칸을 앞에서부터(유체 칸은 이미 차 있어 저절로 건너뛴다),
    // gap 은 **동쪽 끝에서부터** — 막힌 면의 [[ParallelBelt]]가 "포트에 가까운 그룹이 얕은 줄"
    // 이라야 성립하고, 입력의 포트는 동쪽이기 때문이다.
    const base = seatsTaken(table, mi);
    const slots = fromEast
      ? Array.from({ length: k }, (_, j) => table.rowsPerMachine - 1 - base - (k - 1 - j))
      : freeSeatRows(table, mi).slice(0, k);
    claimSeats(table, mi, slots, owner);
    slotIndex.set(mi, slots);
  }
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
    ...cand, slotIndex,
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
 * `undefined` = **좌석이 모자라다.** 그때 호출자는 짝을 풀고 오늘처럼 각자 앉힌다 —
 * 반쪽만 공유된 상태를 남기지 않는다.
 */
export function seatOnSharedBelt(
  ctx: LinkFaceContext,
  group: Link,
  side: "from" | "to",
  shared: LinkFacePlan,
): LinkFacePlan | undefined {
  if (shared.face === "N" || shared.face === "S") return undefined; // gap 은 폭이 자원이라 다르다
  const table = tableOf(ctx, shared.face);
  const inserter = inserterForReach(ctx.inserters ?? [], shared.reach);
  if (!inserter) return undefined;
  const arms = armsAt(group, side, inserter);
  if (arms.size === 0) return undefined;

  // **좌석이 되는지 먼저 다 확인하고** 나서 청구한다 — 반쯤 앉히면 되돌릴 길이 없다.
  const want = new Map<number, number[]>();
  for (const [mi, k] of [...arms].sort((a, b) => a[0] - b[0])) {
    const slots = freeSeatRows(table, mi).slice(0, k);
    if (slots.length < k) return undefined;
    want.set(mi, slots);
  }
  const owner = takeOwner(table);
  for (const [mi, slots] of want) claimSeats(table, mi, slots, owner);
  // 벨트·포트 칸·기둥 끝은 **안 청구한다** — 첫 줄의 것을 그대로 쓴다.
  return { ...shared, arms, slotIndex: want, mergeRole: undefined, sharesBelt: true };
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

/** 아직 아무도 안 앉은 배정 — 간선 축([seatLinkEdge])이 자리를 잡기 전의 모양. */
export const emptyAllocation = (n: number): FaceAllocation => ({
  plans: Array.from({ length: n }, () => undefined),
  deferred: [],
  shortages: Array.from({ length: n }, () => []),
});

/**
 * **무대의 사본** — `gen` 이 여러 번 돌 때 **꼭 필요하다.**
 *
 * 배정(①)은 `modulePacking.seatTree` 에서 한 번 끝나지만, `planModulePorts` 의 ③′(기계별 포트)가 **같은
 * 좌석표에 이어서 앉는다.** 그래서 무대를 그대로 재사용하면 두 번째 `gen` 이
 * **①이 아니라 ①+③′ 이 앉은 표**를 보고 시작해 자리가 조용히 줄어든다.
 *
 * 2026-08-29 에 실제로 그렇게 깨졌다 — 21개 테스트가 *"인서터 수 ≠ 줄 수"* 로 떨어졌다.
 * [FaceTable] 이 값인 것([copyFaceTable])이 이 사본을 싸게 만든다.
 *
 * `out`/`in` 의 [LinkFacePlan] 은 확정된 결과라 **참조로 나눠 쓴다**(아무도 안 고친다).
 */
export function cloneLinkFaceStage(stage: LinkFaceStage): LinkFaceStage {
  const tables = new Map([...stage.tables].map(([f, t]) => [f, copyFaceTable(t)] as const));
  const ends = new Map([...stage.ctx.ends].map(([f, set]) => [f, new Set(set)] as const));
  const outside = new Map([...stage.ctx.outside].map(([f, set]) => [f, new Set(set)] as const));
  return {
    ...stage,
    tables,
    ctx: { ...stage.ctx, tables, ends, outside },
    out: { ...stage.out, plans: [...stage.out.plans], deferred: [...stage.out.deferred] },
    in: { ...stage.in, plans: [...stage.in.plans], deferred: [...stage.in.deferred] },
  };
}
