/**
 * **링크 좌석 — 간선 하나를 양끝 모듈에 함께 앉힌다.** 양끝이 합의해야 하는 결정만 여기 산다.
 *
 * ```
 * 합류     pairsOf        어느 줄이 이끄나 · 포트 끝 · 짝을 풀까
 * 쪼갬     cutRows        막힌 행 중 쪼개면 실제로 앉는 경계
 * 원자성   seatLinkEdge   양끝이 다 되면 확정 · 한쪽이라도 안 되면 둘 다 미배정
 * 순서     remedyOf       선호 면에 양끝이 다 못 앉았을 때 무엇부터(쪼개기 → 다른 면 → 포기)
 * 넘침     spillPair      양쪽 창구에 먼 자리(far)를 묻는다
 * ```
 *
 * **모듈의 장부는 쥐지 않는다.** 두 모듈의 좌석 창구([FaceSeating])에 묻고(`ask`) 받을(`take`) 뿐이다 —
 * 면 · 깊이 · 끝 · 인서터 행은 창구가 고른다. 한 링크의 양끝은 서로의 자리를 안 보기 때문이다
 * (`docs/auto-layout/module/module-planning.md` §4.6 — *"무엇을 안 보고: 짝(부모·자식)이 어디 있나"*).
 *
 * > **내력.** `module/policy/seat.ts` 에 있다가 2026-09-24 여기로 왔다(계획 링크-좌석 · 1b). 두 모듈에 걸친
 * > 결정이라 관심사가 `link/` 다(`docs/auto-layout/common/code-folders.md` — *"두 모듈의 식별자를 안다"*).
 * > 본문은 옮기기만 했고, 같은 날 1d 에서 장부 대신 좌석 창구를 쥐게 됐다.
 */

import type { Link } from "../../module/types/line";
import type { DepthShortage, FaceSeating, SeatOffer, SeatReceipt } from "../../module/types/seat";
import { resolveSpanBlock, splitLinkAtRows } from "../../module/arith/link";
import { recordLaneUnshare } from "../../../debug/runStats";

/**
 * **합류 쌍을 골라 이끄는 줄과 포트 끝을 정한다** — 앉히기 **전에**, 수만으로.
 *
 * ## 이끄는 줄 = **짧은 구간**
 * 합류 칸은 이끄는 줄의 포트 쪽 끝에 서고, 따르는 줄이 **거기까지 비켜 올라온다.**
 * 그 비켜 가는 길이가 곧 **이끄는 줄의 길이**다 — 그러니 짧은 쪽이 이끌어야 한다.
 * (실측 예: 8대·3대 기둥에서 긴 쪽이 이끌면 10칸, 짧은 쪽이 이끌면 **4칸**.)
 * *"합류는 빠를수록 좋다"* 를 코드로 옮긴 것이 이 한 줄이다 — 두 줄이 나란히 달리는
 * 구간이 짧을수록 자리를 덜 먹는다.
 *
 * ## 포트 끝 = **이끄는 줄이 있는 쪽**
 * 이끄는 줄이 기둥 **아래쪽**(머신 index 가 큰 쪽)이면 S, 아니면 N.
 *
 * 짝이 둘이 아닌 신원은 아예 안 담는다 — 쪼개져 하나만 남았거나 이미 풀린 것이다.
 */
function pairsOf(groups: readonly Link[]): Map<string, { lead: Link; follow: Link; end: "N" | "S" }> {
  const by = new Map<string, Link[]>();
  for (const g of groups) {
    if (g.sharedLineId === undefined) continue;
    (by.get(g.sharedLineId) ?? by.set(g.sharedLineId, []).get(g.sharedLineId)!).push(g);
  }
  const out = new Map<string, { lead: Link; follow: Link; end: "N" | "S" }>();
  for (const [id, gs] of by) {
    if (gs.length !== 2) continue;
    const size = (g: Link) => g.from.size;
    const [lead, follow] = size(gs[0]) <= size(gs[1]) ? [gs[0], gs[1]] : [gs[1], gs[0]];
    const lo = (g: Link) => Math.min(...g.from.keys());
    out.set(id, { lead, follow, end: lo(lead) > lo(follow) ? "S" : "N" });
  }
  return out;
}

/**
 * **간선 하나를 양끝에 함께 앉힌다** — 루프 축이 모듈이 아니라 간선이다
 *
 * `Link` 는 **두 모듈에 걸친 객체**다 — `from` 은 자식의 머신, `to` 는 부모의 머신.
 * 그런데 옛 모듈 축에서는 자식이 `from` 만, 부모가 `to` 만, **서로 모르게** 읽었다.
 * 그래서 셋이 불가능했고(쪼갬·끝 맞추기·순서), 코드는 그 셋을 **밖에서 우회**하며
 * 되먹임 둘을 지고 있었다.
 *
 * 여기서 얻는 것이 둘이다:
 *
 * ```
 * ① 원자성  양끝이 다 되면 확정 · 한쪽이라도 안 되면 둘 다 미배정   ← 반쪽 배정이 없다
 * ② 국소성  쪼갤 만하면 **그 자리에서** 쪼개고 토막을 이어서 앉힌다  ← 밖에서 고쳐 다시 안 만든다
 * ```
 *
 * ①이 없던 시절의 증상이 `PackResult.linkMismatches` 의 *"child emitted, parent didn't"* 이고,
 * ②가 없던 시절의 대가가 **되먹임 B**(`linkCache` 를 밖에서 고치고 트리를 통째로 재생성)다.
 *
 * @param toOffsetGroups 이 간선의 그룹들. **반환값의 `groups` 가 최종본**이다(쪼개졌으면 토막).
 */
export function seatLinkEdge(
  fromDesk: FaceSeating,
  toDesk: FaceSeating,
  toOffsetGroups: readonly Link[],
  opts: { split: boolean },
): EdgeSeatResult {
  const groups: Link[] = [];
  const fromSeats: (SeatReceipt | undefined)[] = [];
  const toSeats: (SeatReceipt | undefined)[] = [];
  const fromWhy: DepthShortage[][] = [];
  const toWhy: DepthShortage[][] = [];
  let splits = 0;

  // **쪼갬 예산** — 못은 깊이 수만큼에서 멈추므로(`machine-link.md`) 유한하지만,
  // 예산 없이 두면 잘못된 판정 하나가 무한 루프가 된다. 그룹당 넷이면 넉넉하다.
  let budget = toOffsetGroups.length * 4;

  // ── 배정 순서 — **제약이 센 것부터**(스도쿠 원칙) ──────────────────────────────
  //
  // 좌석 창구가 유체 면에 쓰는(⓪) 그 원칙이다. 순위는 **대안이 있느냐**로 갈린다:
  //
  // ```
  // ① 유체 면    머신이 정한다. 협상 불가                    (여기 오기 전에 끝났다)
  // ② 합류 쌍    기둥 끝 + 비켜 가는 열. **대안이 없다**      ← 이 정렬이 넣는 자리
  // ③ 관통 줄    끝을 원한다. 못 받으면 **옆 포트로 저하 가능**
  // ④ 구간 줄    옆 포트. 깊이·행이 자유로워 가장 헐겁다
  // ```
  //
  // **이 순서면 「양보하나 포기하나」를 따로 판단할 필요가 없다.** 합류가 먼저 앉고, 그래도
  // 자리가 없으면 그건 모듈에 **진짜로** 자리가 없는 것이라 정직하게 포기하면 된다 —
  // 남이 뺏은 것이 아니다. (2026-09-04 사장님과 정한 기준.)
  const mergePairs = pairsOf(toOffsetGroups);
  const queue: Link[] = [
    ...[...mergePairs.values()].flatMap((p) => [p.lead, p.follow]),
    ...toOffsetGroups.filter((g) => !(g.sharedLineId && mergePairs.has(g.sharedLineId))),
  ];

  const keep = (g: Link, fs?: SeatReceipt, ts?: SeatReceipt, fw: DepthShortage[] = [], tw: DepthShortage[] = []) => {
    groups.push(g); fromSeats.push(fs); toSeats.push(ts); fromWhy.push(fw); toWhy.push(tw);
  };

  /**
   * **레인 공유 — 양끝이 서로 다르게 다뤄진다.**
   *
   * ```
   * 싣는 쪽(from)   벨트 **둘**  — 팔이 각자 먼 레인에 떨궈야 두 레인이 찬다.
   *                 다만 **같은 끝 · 인접 깊이**라야 기둥 끝 바깥 한 행에서 만난다
   * 집는 쪽(to)     벨트 **하나** — 합류한 벨트가 벽의 한 칸으로 들어온다
   * ```
   *
   * 그래서 장부도 둘이다: `sharedFrom` 은 *"둘째 줄이 나란히 앉을 자리"* 를 재고,
   * `sharedTo` 는 *"둘째 줄이 얹힐 벨트"* 를 든다. 둘 다 **영수증**이다 — 자리 자체는 창구 안에 있다.
   */
  const sharedTo = new Map<string, SeatReceipt>();
  const sharedFrom = new Map<string, SeatReceipt>();

  while (queue.length > 0) {
    const g = queue.shift()!;
    // **놓기 전에 둘 다 물어본다** — 묻기는 장부를 안 건드린다(원자성의 전제다). 면은 창구가 고른다(near = 선호 면).
    // 합류 쌍은 **양쪽 줄 다** 기둥 끝 포트로 앉힌다(따르는 줄은 포트를 안 갖지만, 같은 끝·
    // 같은 `topT` 규약을 써야 방출이 합류 칸을 계산할 수 있다).
    const pair = g.sharedLineId !== undefined ? mergePairs.get(g.sharedLineId) : undefined;
    const inPair = pair !== undefined;
    // **이끄는 줄이 이미 앉았으면 그 면·깊이를 물려받는다** — 배정 순서가 쌍을 붙여 놓았으므로
    // 따르는 줄 차례엔 반드시 있다(없으면 이끄는 줄이 도형을 못 세운 것이라 짝도 아니다).
    const fromPartner = g.sharedLineId !== undefined ? sharedFrom.get(g.sharedLineId) : undefined;
    const nearFrom = fromDesk.ask(g, "from", "near", {
      forceEnd: inPair, preferEnd: pair?.end, preferDepth: fromPartner?.clusterBeltDepth,
    });
    const fw = nearFrom.why;
    let candFrom: SeatOffer | undefined = nearFrom.offer;

    // **싣는 쪽 — 짝의 둘째 줄은 첫 줄과 같은 끝을 써야 한다.**
    //
    // 출구 합류는 기둥 끝 **바깥 한 행**에서 일어난다(`emitOutputLinks`). 두 줄이 서로 다른
    // 끝으로 나가면 그 행에서 만날 수가 없다. 그런데 기둥 끝 장부는 기본적으로
    // **반대 끝**을 준다(먼저 앉은 줄이 N 을 잡으면 다음은 S) — 그래서 여기서 덮어쓴다.
    // 링크 쪽이 제안을 고쳐 넘기는 **유일한** 자리다(합류는 양끝의 결정이다).
    //
    // 깊이가 **인접**하지 않거나 면이 다르면 그 도형이 안 선다 → **짝을 푼다.**
    // (배정 단계라 아직 풀 수 있다 — 납품이 하나로 접히는 것은 이 뒤다.)
    let merged: Record<string, never> | undefined;
    if (candFrom && fromPartner) {
      // **같은 면 · 같은 깊이 · 끝이 있다.** 구간 줄 둘은 구간이 안 겹쳐 **한 깊이를 나눠
      // 쓴다** — 그래서 같은 열에 위/아래로 쌓이고, 따르는 줄이 그 열 밖(깊이 +2)으로
      // 비켜 이끄는 줄의 합류 칸까지 올라온다.
      const ok =
        candFrom.face === fromPartner.face
        && fromPartner.portEnd !== undefined
        && candFrom.portEnd !== undefined // 끝을 아예 못 받으면(양쪽 다 찼다) 기하가 없다
        && candFrom.clusterBeltDepth === fromPartner.clusterBeltDepth;
      if (ok) {
        // **같은 끝으로 나가야 한 행에서 만난다** — 끝 장부는 기본적으로 반대 끝을 준다.
        candFrom = { ...candFrom, portEnd: fromPartner.portEnd };
        merged = {};
      } else {
        g.sharedLineId = undefined;
        recordLaneUnshare("shape");
      }
    }

    /**
     * **이 줄이 지금도 짝의 이끄는 쪽인가** — 커밋 **직전에** 다시 묻는다.
     *
     * `inPair` 는 큐를 세울 때의 사실이라 그 뒤 짝이 풀렸어도(`g.sharedLineId = undefined`)
     * 참으로 남는다. 그 값으로 `mergeLead` 를 주면 **합칠 상대가 없는데 합류 도형을 청구**
     * 하고, 방출은 신원이 지워졌으니 평범한 도형을 놓아 둘이 갈린다(2026-09-12 F2 와 같은 뿌리).
     *
     * 기하가 안 서는 경우도 여기서 걸러 낸다 — 끝을 못 받았거나 gap 면이면 합류 칸이 설 자리가
     * 없다. 그래야 방출이 [LinkFacePlan.mergeRole] 하나만 보고 따를 수 있다.
     */
    const leadNow = (): boolean =>
      g.sharedLineId !== undefined && mergePairs.has(g.sharedLineId)
      && candFrom !== undefined && candFrom.portEnd !== undefined
      && candFrom.face !== "N" && candFrom.face !== "S";

    // **집는 쪽 — 짝의 둘째 줄은 자리를 안 고른다.** 첫 줄이 잡은 벨트에 좌석만 얹는다.
    const partner = g.sharedLineId !== undefined ? sharedTo.get(g.sharedLineId) : undefined;
    if (candFrom && partner) {
      const onShared = toDesk.takeShared(g, "to", partner);
      if (onShared) {
        keep(g, fromDesk.take(candFrom, "from", { merged, mergeLead: !merged && leadNow() }), onShared);
        continue;
      }
      // 좌석이 모자라다 — **짝을 푼다.** 반쪽만 공유된 상태를 남기지 않는다.
      g.sharedLineId = undefined;
      recordLaneUnshare("seats");
    }

    const nearTo = toDesk.ask(g, "to", "near");
    const tw = nearTo.why;
    const candTo = nearTo.offer;
    if (candFrom && candTo) {
      const toSeat = toDesk.take(candTo, "to");
      const fromSeat = fromDesk.take(candFrom, "from", { merged, mergeLead: !merged && leadNow() });
      if (g.sharedLineId !== undefined && !sharedTo.has(g.sharedLineId)) {
        sharedTo.set(g.sharedLineId, toSeat); // 첫 줄 — 다음 줄이 이 벨트에 얹힌다
        sharedFrom.set(g.sharedLineId, fromSeat); // 〃 — 다음 줄이 이 옆에 나란히 앉는다
      }
      keep(g, fromSeat, toSeat);
      continue;
    }

    // 선호 면에 양끝이 다 못 앉았다 — **수단 사이의 순서**([remedyOf])를 따른다.
    const r = remedyOf(g, { candFrom, candTo, fw, tw }, fromDesk, toDesk, opts.split && budget > 0);
    if (r.kind === "split") {
      budget -= r.parts.length;
      splits += r.parts.length - 1;
      queue.unshift(...r.parts); // 토막을 **앞에** 넣어 이어서 앉힌다 — 되돌리기가 없다
      continue;
    }
    if (r.kind === "spilled") { keep(g, r.from, r.to); continue; }
    keep(g, undefined, undefined, fw, tw); // 정직하게 자리 없음
  }
  return { groups, fromSeats, toSeats, fromWhy, toWhy, splits };
}

/** [remedyOf] 의 답 — 무엇을 했나. */
type Remedy =
  | { kind: "split"; parts: Link[] }
  | { kind: "spilled"; from: SeatReceipt; to: SeatReceipt }
  | { kind: "none" };

/**
 * **수단 사이의 순서** — 한 줄이 선호 면(near)에 양끝 다 못 앉았을 때 무엇부터 해 보나.
 *
 * ```
 * ① 쪼갠다     막힌 쪽 near 의 막힌 행 중 쪼개면 실제로 앉는 경계로 — 쪼개기를 켰을 때만
 * ② 다른 면    양쪽 창구에 먼 자리(far)를 묻고, 둘 다 되면 둘 다 받는다
 * ③ 포기       사유는 near 의 것 — *"원래 앉고 싶던 면"* 의 이유다
 * ```
 *
 * **쪼개기가 다른 면보다 먼저인 이유** — 대가가 작다. 쪼개기의 대가는 포트 하나이고 모듈 크기는 그대로다
 * (`docs/auto-layout/module/trunk-blocked.md` §3 (가) *"대가: 포트 +1 … 모듈 크기 변화 0"*). 다른 면 중 gap 은
 * 모듈을 세로로 벌린다(`gapRowsFromPlans`). 그리고 쪼개기는 그룹 목록을 바꾸는 **양끝의** 수단이라 링크 쪽만 쓸 수
 * 있다 — 그래서 이 순서를 링크 쪽이 쥔다. 창구 안의 수단(깊이 · 끝 · 인서터 행)은 near 가 이미 다 써 봤다.
 *
 * 쪼갤 쪽은 **막힌 쪽**이다 — 자름의 경계는 그 쪽 모듈의 행이므로 행 단위도 그 쪽 창구의 것이다.
 */
function remedyOf(
  g: Link,
  near: {
    candFrom?: SeatOffer; candTo?: SeatOffer; fw: readonly DepthShortage[]; tw: readonly DepthShortage[];
  },
  fromDesk: FaceSeating,
  toDesk: FaceSeating,
  canSplit: boolean,
): Remedy {
  // ① 쪼갠다 — 구간막힘이면 그 자리에서
  if (canSplit) {
    const cut = !near.candTo
      ? { side: "to" as const, rows: cutRows(near.tw), h: toDesk.rowsPerMachine }
      : { side: "from" as const, rows: cutRows(near.fw), h: fromDesk.rowsPerMachine };
    if (cut.rows.length > 0) {
      const parts = splitLinkAtRows(g, cut.side, cut.rows, cut.h);
      if (parts.length > 1) return { kind: "split", parts };
    }
  }
  // ② 다른 면 — 역시 **양끝 함께**
  const spilled = spillPair(fromDesk, toDesk, g);
  if (spilled) return { kind: "spilled", from: spilled.from, to: spilled.to };
  // ③ 포기
  return { kind: "none" };
}

/** 후보들 중 **쪼개면 실제로 앉는** 첫 경계. 없으면 빈 배열([resolveSpanBlock]). */
function cutRows(why: readonly DepthShortage[]): number[] {
  for (const r of why) {
    if (!r.blockedRows?.length || !r.seatRows?.length) continue;
    const worth = resolveSpanBlock(r.seatRows, r.blockedRows);
    if (worth.length > 0) return worth;
  }
  return [];
}

/**
 * **넘침** — 양쪽 창구에 먼 자리(far)를 묻는다. 면 순서는 창구 안에 있다(`module/policy/seat` 의 넘침 순서).
 *
 * 예전엔 여기서 자식 면 × 부모 면을 이중 루프로 돌며 첫 성공을 썼다. 부모 쪽 시도가 자식 쪽 선택을 인자로
 * 받지 않으므로 그 답은 **양쪽이 각자 처음 되는 면을 고른 것과 같다** — 그래서 면 순서를 창구로 옮겨도 자리가
 * 안 바뀐다. 달라지는 것은 부모 쪽에 되는 면이 하나도 없을 때 자식 쪽을 **여러 번** 묻던 호출 횟수뿐이다
 * (관측 계수기 `endsCoarse` · `endsDisagree` 가 그 횟수를 센다).
 */
function spillPair(
  fromDesk: FaceSeating,
  toDesk: FaceSeating,
  g: Link,
): { from: SeatReceipt; to: SeatReceipt } | undefined {
  const f = fromDesk.ask(g, "from", "far");
  if (!f.offer) return undefined;
  const t = toDesk.ask(g, "to", "far");
  if (!t.offer) return undefined;
  return { from: fromDesk.take(f.offer, "from"), to: toDesk.take(t.offer, "to") };
}

/** [seatLinkEdge] 의 산출 — **`groups` 가 그 간선의 최종본**이다(쪼개졌으면 토막). */
export interface EdgeSeatResult {
  groups: Link[];
  /** 자식 쪽 영수증 — `groups` 와 같은 순서. 못 앉은 줄은 `undefined`. */
  fromSeats: (SeatReceipt | undefined)[];
  /** 부모 쪽 영수증. */
  toSeats: (SeatReceipt | undefined)[];
  fromWhy: DepthShortage[][];
  toWhy: DepthShortage[][];
  /** 쪼갠 횟수(진단). */
  splits: number;
}
