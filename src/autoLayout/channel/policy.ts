/**
 * **통로 관심사의 정책** — 채널 기하 장부가 **고르는** 자리 셋: 완전 교차를 누가 푸나(해소 사다리 — 진출 변 · 누가 땅속으로 ·
 * 누가 땅 위를 잃나) · 지상 배정의 순서(실패 비용 순) · 유체 폴백의 사유.
 *
 * **트랙을 잡지 않는다.** 누가 어느 트랙인지는 장부(`channelGeometryPlanner` 의 배정 단계)가 정하고, 여기는 장부에
 * 넘길 판정과 순서만 낸다. 판정 자체는 행 · 벽 비교뿐이다([fullCrossing] — 답이 하나라 `channel/shape`).
 *
 * > **내력.** `channelGeometryPlanner.planChannelGeometry` 의 ① 블록 · ② 후보 목록 · 유체 사유 블록이었다
 * > (2026-09-15 계획 구조-2축 · 2 Step 5b).
 */

import type { DeliveryInput, DeliveryPlan, ExportInput, ExportPlan, GeometryContext, NsEdge } from "./types";
import {
  deliveryEnds, elbowShape, exportEnds, fullCrossing, staircaseShape, type RouteEnds, type Shape,
} from "./shape";

/**
 * **① 의 답** — 반출마다 진출 변 · 땅 위를 내준 납품과 반출, 그리고 지상을 시도할 납품.
 * 뒤 단계가 이것을 받는다 — 후보([surfaceItemsOf]) · 배정 · 계획 객체 · 지하.
 */
export interface ExitSides {
  exitOf: Map<string, NsEdge>;
  /**
   * **완전 교차로 땅 위를 내준 납품** → 그 상대 하나(관측용 — 같은 순위에서 내줬으면 상대가 여럿일 수 있다).
   * 들어갈 수 있는 쪽([DiveAbility])은 ③ 지하 횡단의 후보이고, 못 들어가는 유체는 계획을 여기서 폴백으로 받는다.
   */
  yieldedDeliveries: Map<string, string>;
  /**
   * 땅 위를 내준 반출 — 들어갈 수 있으면 ③ 지하 횡단의 후보다. 못 들어가면 폴백 계획(물러남)을 여기서 적는다 — 상자는
   * 방출에서 트랙을 훑는다.
   */
  yieldedExports: Set<string>;
  surfaceDels: DeliveryInput[];
}

/**
 * **땅속으로 갈 수 있나**를 정하는 것 — 매체마다 지하 사거리(`GeometryContext.maxJump` · `maxJumpPipe`), 그리고 한 번
 * 들어가 봤다가 못 건넌 경로(`noDive` — [planChannelGeometry] 가 다시 돌릴 때 넘긴다).
 *
 * 아이템 납품은 언제나 들어갈 수 있는 쪽으로 친다(사거리가 없으면 ③ 지하 단계가 못 건너 폴백한다 — 2026-10-01 이전과 같다).
 * 파이프 경로(유체 납품 · 파이프 반출)는 지하파이프를 고른 판(`maxJumpPipe ≥ 2`)에서, 벨트 반출은 지하벨트를 고른 판
 * (`maxJump ≥ 2`)에서 들어간다 — 짝 규칙은 ③ 이 장부(corridor)로 본다. 반출이 들어가는 것은 2026-10-02 부터다(그 전엔
 * 방출기가 반출을 땅 위로만 깔았다).
 */
export interface DiveAbility {
  maxJump: number;
  maxJumpPipe: number;
  noDive: ReadonlySet<string>;
}

/**
 * 벨트 × 파이프가 반드시 만나 **상대 수가 같을 때** 들어갈 차례 — 파이프가 먼저다(잠정 — 지금은 무엇이 들어가든 차이가 없다).
 * 상대 수가 다르면 상대가 많은 쪽이 들어간다([loserOf] — docs layout-models §3.5 두점 라우팅 제4조 ③).
 */
const MEDIUM_DIVE_ORDER = ["pipe", "belt"] as const;
const mediumOf = (r: SurfaceRoute): (typeof MEDIUM_DIVE_ORDER)[number] =>
  (r.kind === "delivery" ? r.d.fluid : r.x.fluid) !== undefined ? "pipe" : "belt";

/**
 * **실패 비용**(`docs/auto-layout/common/priority-ordering.md` P10) — **아무도 땅속으로 못 갈 때** 땅 위를 잃는 쪽은 이 값이
 * 큰 쪽이다. 유체는 잃으면 트리가 거절되고, 반출은 상자가 안에 남고, 아이템은 방출의 탐색이 회수한다. 모델은 그때
 * *계획이 넓힌다* 다(docs layout-models §3.5 제4조 ④) — 이 값은 그것이 서기 전의 오늘 동작이다.
 */
const lossRank = (r: SurfaceRoute): number =>
  r.kind === "delivery" ? (r.d.fluid !== undefined ? 0 : 2) : 1;

/** 지상 후보 하나 — 납품이거나 반출이다. 둘 다 [RouteEnds] 로 펴서 같은 판정([fullCrossing])을 받는다. */
type SurfaceRoute =
  | { kind: "delivery"; id: string; d: DeliveryInput }
  | { kind: "export"; id: string; x: ExportInput };

/**
 * **① 완전 교차 풀기 — 해소 사다리.** 지상 후보의 모든 쌍에서 완전 교차([fullCrossing])를 보고, 남김없이 푼다.
 *
 * ```
 * 차례   유체끼리 → 유체 × 반출 → 유체 × 아이템 → 아이템 × 반출 → 반출끼리 → 아이템끼리. 무리 안은 id 순
 *   ① 반출이 끼었으면 진출 변을 뒤집어 본다 — 뒤집은 변에서 납품을 새로 안 가둘 때만. 반출끼리 생긴 엇갈림은
 *      반출끼리 차례에서 다시 뒤집어 푼다(거기서는 반출도 새로 안 가둘 때만)
 *   ② 누가 땅속으로 가나 — 들어갈 수 있는 쪽 중 완전 교차 상대가 많은 쪽(남은 후보 중에서 세고, 하나 빼면 다시 센다)
 *      → 벨트 × 파이프가 같으면 파이프 → 동률은 id 뒤쪽
 *   ③ 아무도 못 들어가면 실패 비용(P10)이 낮은 쪽이 땅 위를 잃는다 — 같은 순위면 ②의 상대 수 · id
 * ```
 *
 * 이 단계가 끝나면 **남은 후보 사이에 완전 교차가 없다** — 그래서 ② 지상 탐색이 해가 없는 입력을 받지 않는다(같은 문서
 * §10.2 정리 3: 순환이 하나라도 있으면 어떤 폭에서도 해가 없다). 남은 충돌은 폭 · 다른 유체의 인접뿐이고 탐색이 본다.
 *
 * > **내력.** `settleExitSides` 였다 — 반출 × 납품만 미리 보는 같은 쪽 판정 두 라운드(유체 · 아이템). 납품끼리 · 반출끼리의
 * > 완전 교차는 탐색이 모든 폭에서 실패해야 알았고, 그러면 채널 전체가 탐욕 배정으로 갔다(2026-10-01 · docs/auto-layout/channel/channel-geometry-reservation.md §4.4).
 */
export function settleFullCrossings(
  deliveries: ReadonlyArray<DeliveryInput>,
  exports_: ReadonlyArray<ExportInput>,
  fluidDels: ReadonlyArray<DeliveryInput>,
  itemDels: ReadonlyArray<DeliveryInput>,
  deliveryPlans: Map<string, DeliveryPlan>,
  exportPlans: Map<string, ExportPlan>,
  ctx: Pick<GeometryContext, "yMin" | "yMax">,
  dive: DiveAbility = { maxJump: 0, maxJumpPipe: 0, noDive: new Set() },
): ExitSides {
  const exitOf = new Map<string, NsEdge>(exports_.map((x) => [x.id, x.preferredExit]));
  /** 땅속으로 갈 수 있나([DiveAbility]). */
  const canDive = (r: SurfaceRoute): boolean => {
    if (dive.noDive.has(r.id)) return false;
    if (r.kind === "delivery" && r.d.fluid === undefined) return true;
    return mediumOf(r) === "pipe" ? dive.maxJumpPipe >= 2 : dive.maxJump >= 2;
  };
  const yieldedDeliveries = new Map<string, string>();
  const yieldedExports = new Set<string>();

  const asDel = (d: DeliveryInput): SurfaceRoute => ({ kind: "delivery", id: d.id, d });
  const asExp = (x: ExportInput): SurfaceRoute => ({ kind: "export", id: x.id, x });
  const endsOf = (r: SurfaceRoute, exit?: NsEdge): RouteEnds =>
    r.kind === "delivery" ? deliveryEnds(r.d) : exportEnds(r.x, exit ?? exitOf.get(r.id)!);
  const crosses = (a: SurfaceRoute, b: SurfaceRoute): boolean => fullCrossing(endsOf(a), endsOf(b), ctx);
  const yielded = (r: SurfaceRoute): boolean =>
    r.kind === "delivery" ? yieldedDeliveries.has(r.id) : yieldedExports.has(r.id);
  /** 지금 땅 위에 남은 후보 전부 — 뒤집기가 새 완전 교차를 만드나를 여기서 본다. */
  const live = (): SurfaceRoute[] =>
    [...deliveries.map(asDel), ...exports_.map(asExp)].filter((r) => !yielded(r));

  /**
   * 땅 위를 내준다 — 들어갈 수 있는 경로는 ③ 지하 횡단의 후보로 간다. 못 들어가는 유체 · 반출은 폴백 계획을 여기서 받는다
   * (적어 두지 않으면 ②③ 이 그 경로를 건너뛰어 계획이 비어 버린다).
   */
  const yieldSurface = (loser: SurfaceRoute, winner: SurfaceRoute): void => {
    if (loser.kind === "delivery") {
      yieldedDeliveries.set(loser.id, winner.id);
      // 이름은 `nameFluidFallbacks` 가 덮는다.
      if (!canDive(loser)) deliveryPlans.set(loser.id, { kind: "fallback", reason: "fluid-no-surface-assignment" });
      return;
    }
    yieldedExports.add(loser.id);
    if (canDive(loser)) return;
    const toFluid = winner.kind === "delivery" && winner.d.fluid !== undefined;
    exportPlans.set(loser.id, { kind: "fallback", reason: toFluid ? "yielded-to-fluid" : "yielded-to-export" });
  };

  /**
   * ① 진출 변 뒤집기 — 뒤집은 변에서 이 반출이 땅 위에 남은 **납품**과 완전 교차가 없을 때만(`withExports` 면 반출과도).
   *
   * 납품을 상대로 풀 때는 납품만 본다 — 반출끼리 생긴 엇갈림은 반출의 끝이 둘 다 자유로워 **반출 무리 안에서** 다시
   * 푼다([settleWithin] — 거기서는 반출도 본다). 여기서 반출까지 막으면 *"둘 다 뒤집어야 풀리는"* 쌍(같은 납품을 가둔
   * 같은 벽의 두 반출)을 하나씩은 못 뒤집어 납품이 지하로 밀린다.
   */
  const tryFlip = (x: ExportInput, withExports: boolean): boolean => {
    const flipped: NsEdge = exitOf.get(x.id) === "N" ? "S" : "N";
    const ends = exportEnds(x, flipped);
    const ok = live().every((r) =>
      r.kind === "export" ? r.id === x.id || !withExports || !fullCrossing(ends, endsOf(r), ctx) : !fullCrossing(ends, endsOf(r), ctx),
    );
    if (ok) exitOf.set(x.id, flipped);
    return ok;
  };

  /** 이 후보와 완전 교차인 남은 후보의 수 — 같은 순위 · 같은 매체에서 누가 내주나를 정한다. */
  const partnersIn = (r: SurfaceRoute, among: readonly SurfaceRoute[]): number =>
    among.filter((o) => o.id !== r.id && !yielded(o) && crosses(r, o)).length;

  /** 같은 자격끼리 — 완전 교차 상대가 많은 쪽, 동률은 id 뒤쪽. `among` 이 상대를 세는 무리다. */
  const morePartners = (cands: readonly SurfaceRoute[], among: readonly SurfaceRoute[]): SurfaceRoute =>
    cands.reduce((best, r) => {
      const dr = partnersIn(r, among);
      const db = partnersIn(best, among);
      if (dr !== db) return dr > db ? r : best;
      return r.id.localeCompare(best.id) > 0 ? r : best;
    });

  /**
   * ② · ③ — 쌍 하나에서 누가 땅 위를 내주나. 둘 다 들어갈 수 있으면 상대가 많은 쪽 → (매체가 다르면) 파이프 → id 뒤쪽,
   * 아무도 못 들어가면 실패 비용이 낮은 쪽 → 상대 수 → id 뒤쪽.
   */
  const loserOf = (a: SurfaceRoute, b: SurfaceRoute): SurfaceRoute => {
    const divers = [a, b].filter(canDive);
    if (divers.length === 1) return divers[0];
    if (divers.length === 2) {
      // **상대 수가 먼저다** — 여럿과 엇갈린 쪽이 들어가면 만남이 한꺼번에 풀린다. 매체는 상대 수가 같을 때만 본다.
      const pa = partnersIn(a, live());
      const pb = partnersIn(b, live());
      if (pa !== pb) return pa > pb ? a : b;
      const ma = MEDIUM_DIVE_ORDER.indexOf(mediumOf(a));
      const mb = MEDIUM_DIVE_ORDER.indexOf(mediumOf(b));
      if (ma !== mb) return ma < mb ? a : b;
    } else {
      const la = lossRank(a);
      const lb = lossRank(b);
      if (la !== lb) return la > lb ? a : b;
    }
    return morePartners([a, b], live());
  };

  /** ① 반출이 끼었으면 뒤집어 본다 — id 뒤쪽부터(내주는 쪽의 동률 규칙과 같은 방향). 하나라도 뒤집으면 참. */
  const flipOne = (a: SurfaceRoute, b: SurfaceRoute, withExports: boolean): boolean =>
    [b, a].some((r) => r.kind === "export" && tryFlip(r.x, withExports));

  /** 지금 열려 있는(둘 다 땅 위에 있고 완전 교차인) 쌍. */
  const openOf = (pairs: Array<[SurfaceRoute, SurfaceRoute]>): Array<[SurfaceRoute, SurfaceRoute]> =>
    pairs.filter(([a, b]) => !yielded(a) && !yielded(b) && crosses(a, b));

  /** **순위가 다른 두 무리의 쌍** — 답이 쌍 안에서 정해진다. 열린 쌍을 차례대로 하나씩 푼다. */
  const settleAcross = (xs: readonly SurfaceRoute[], ys: readonly SurfaceRoute[]): void => {
    const pairs = xs.flatMap((p) => ys.map((q): [SurfaceRoute, SurfaceRoute] => [p, q]));
    for (;;) {
      const open = openOf(pairs);
      if (open.length === 0) return;
      const [a, b] = open[0];
      if (flipOne(a, b, false)) continue;
      const loser = loserOf(a, b);
      yieldSurface(loser, loser === a ? b : a);
    }
  };

  /**
   * **같은 무리 안의 쌍** — 누가 내주나가 쌍 안에서 안 정해진다(매체 · 실패 비용이 같다). 뒤집기를 먼저 다 해 보고,
   * 그래도 남으면 **무리 전체에서 완전 교차 상대가 가장 많은 쪽**을 하나 빼고 다시 센다(사용자 2026-09-30).
   *
   * 다만 **들어갈 수 있나**는 무리 안에서도 갈린다 — 한 번 들어가 봤다가 못 건넌 유체(`noDive`)가 있다. 그 유체를 또
   * 내주게 하면 다시 돌아도 같은 유체가 땅 위를 잃어 거절로 간다. 그래서 들어갈 수 있는 쪽 중에서 먼저 고른다.
   */
  const settleWithin = (xs: readonly SurfaceRoute[]): void => {
    const pairs = xs.flatMap((p, i) => xs.slice(i + 1).map((q): [SurfaceRoute, SurfaceRoute] => [p, q]));
    for (;;) {
      const open = openOf(pairs);
      if (open.length === 0) return;
      // 무리 안에서는 반출끼리도 본다 — 뒤집기가 새 엇갈림을 하나도 안 만들어야 열린 쌍이 줄고, 그래야 끝난다.
      if (open.some(([a, b]) => flipOne(a, b, true))) continue;
      const inOpen = [...new Map(open.flat().map((r) => [r.id, r])).values()];
      const divers = inOpen.filter(canDive);
      const loser = morePartners(divers.length > 0 ? divers : inOpen, xs);
      const winner = open.find(([a, b]) => a === loser || b === loser)!;
      yieldSurface(loser, winner[0] === loser ? winner[1] : winner[0]);
    }
  };

  const fluids = fluidDels.map(asDel);
  const items = itemDels.map(asDel);
  const exps = exports_.map(asExp);

  // 차례 — 실패 비용이 큰 쪽이 낀 쌍부터(P10). 같은 무리 안은 id 순(입력이 이미 id 순이다).
  // 반출끼리는 납품과의 쌍을 다 푼 **뒤에** 푼다 — 그 사이의 뒤집기가 반출끼리 엇갈림을 만들 수 있다([tryFlip]).
  settleWithin(fluids);
  settleAcross(fluids, exps);
  settleAcross(fluids, items);
  settleAcross(items, exps);
  settleWithin(exps);
  settleWithin(items);

  const surfaceDels = deliveries.filter((d) => !yieldedDeliveries.has(d.id));
  return { exitOf, yieldedDeliveries, yieldedExports, surfaceDels };
}

/** 지상 배정의 후보 하나 — 경로 id · 트랙마다 도형 · 트랙 상한 · 유체. */
export type SurfaceItem = { id: string; candidates: (t: number) => Shape | null; max: number; fluid?: string };

/**
 * **② 후보 — 실패 비용 순.** 유체 납품(실패 = 트리 전체 실패) → 반출(실패하면 방출이 트랙을 훑고, 그래도 못 나가면
 * 상자가 로컬 ring 에 남는다) → 아이템 납품(실패하면 지하 횡단이 회수한다). 탐욕 폴백에서 앞선 것이 자리를 먼저
 * 가지므로 이 순서가 곧 *"누가 지상을 먼저 갖나"* 다.
 */
export function surfaceItemsOf(
  sides: ExitSides,
  exports_: ReadonlyArray<ExportInput>,
  ctx: GeometryContext,
  cap: number,
  capCol: number,
): SurfaceItem[] {
  const { exitOf, yieldedExports, surfaceDels } = sides;
  // 경로 순서: 반출(id 순) → 지상 가능한 납품(id 순). 트랙 후보는 0..T-1 오름차순.
  const delItem = (d: DeliveryInput): SurfaceItem =>
    d.startY === d.endY
      ? // 일자 수평선 — 트랙 무관, 후보 1개(t=0 로만 호출되게 max=1).
        { id: d.id, candidates: () => staircaseShape(d, 0, ctx, capCol), max: 1, fluid: d.fluid }
      : { id: d.id, candidates: (t) => staircaseShape(d, t, ctx, capCol), max: cap, fluid: d.fluid };

  // 순서 = 실패 비용 순(위 주석). 탐욕 폴백에서 앞선 것이 자리를 먼저 가진다.
  const items: SurfaceItem[] = [];
  for (const d of surfaceDels) if (d.fluid !== undefined) items.push(delItem(d));
  for (const x of exports_) {
    if (yieldedExports.has(x.id)) continue;
    const exit = exitOf.get(x.id)!;
    // 파이프 반출도 유체다 — 다른 유체와 닿기만 해도 만난다(halo). 2026-10-02 까지 장부는 반출 파이프를 벨트로 봤다.
    items.push({ id: x.id, candidates: (t) => elbowShape(x, t, exit, ctx, capCol), max: cap, fluid: x.fluid });
  }
  for (const d of surfaceDels) if (d.fluid === undefined) items.push(delItem(d));
  return items;
}

/** **③′ 유체 폴백의 사유** — 지상에 못 앉은 유체 납품이 거절 메시지에 실을 사유를 고른다(지하 단계 뒤에 — 앞 사유를 덮는다). */
export function nameFluidFallbacks(
  fluidDels: ReadonlyArray<DeliveryInput>,
  deliveryPlans: Map<string, DeliveryPlan>,
): void {
  // 유체가 지상에 못 앉았다면 남은 수는 없다 — 지하도(D2) 탐색 폴백도(D3) 안 준다.
  // 사유를 갈라 둔다: 소비자(moduleWizard)가 거절 메시지에 그대로 싣는다.
  for (const d of fluidDels) {
    if (deliveryPlans.get(d.id)?.kind !== "fallback") continue;
    deliveryPlans.set(d.id, { kind: "fallback", reason: "fluid-no-surface-assignment" });
  }
}
