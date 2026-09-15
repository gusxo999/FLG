/**
 * **연결 관심사의 정책** — 둘이다. 간선의 링크(무엇을 몇 줄로 · 어느 끝으로 · 어느 줄끼리 한 벨트에)와,
 * 납품 경로 하나가 놓이는 사다리.
 *
 * ## 간선의 링크 — [edgeLinksOf]
 *
 * ```
 * 산출물      productsOf         부모가 먹는 것으로 고른다(다산출 레시피)
 * 끝          lineEndsOf         형제 순번이 끝을 정한다 — 좌표 없이, 생성보다 앞에서
 * 줄          baseLinks          간선마다 edgeLinkGroups 한 번 + 끝을 얹는다
 * 레인 짝     shareLanePairs     같은 간선의 두 줄을 한 벨트의 좌/우 레인에   (LANE_MERGE)
 * 다시 붓기   repourOverflowing  넘치는 부모의 링크 입력만 g = 1 로          (LINK_DIRECT)
 * ```
 *
 * 순서가 곧 답이다 — 끝이 줄보다 앞이라야 생성이 한 번이고(되먹임 A 제거), 레인 짝이 좌석보다
 * 앞이라야 배정이 공유를 보고 한 벨트를 잡는다. 그 순서를 [edgeLinksOf] 하나가 쥔다.
 *
 * ## 납품 경로 하나가 놓이는 사다리 — `deliveryRoute.routeDeliveryRoutes` 가 한 납품씩 부른다
 *
 * ```
 * 게이트      undergroundGateOf  지하벨트를 쓰나 — 충돌 회피용으로만
 * 순서        fluidFirst         유체 먼저(실패 비용 순)
 * 고르기      chooseRoute        파이프 없음 → 계획 → 유체 포기 → 탐색 → 예약 무시
 * 탐색 칸     routeOneDelivery   dijkstraWithJumps 한 번 — 사다리의 한 칸(탐색 표식)
 * ```
 *
 * 장부를 **묻고**(`link/ledger.plannedChainClear` · 탐색의 `blocked`) 계수와 유령 예약만 고친다 — 깐 칸은 장부의
 * `recordRoute` 가 적는다. 셀은 `link/emit`, 체인의 칸은 `link/shape`.
 *
 * ## 경로탐색
 * 검증된 [containerRouting.dijkstraWithJumps] 를 그대로 재사용 — start=chest_from,
 * end=chest_to, blocked=전 모듈 occupancy(이 납품 경로의 두 chest 만 제외).
 *
 * ## 지하벨트 (조각 C)
 * emit 을 [emitPath.emitItemPath] 로 통일(edge-aware, 단일 출처)해 점프 경로를
 * 지하벨트 입/출구로 materialize 한다. 정책:
 *  - `jumpCostModel: 'length'` — 지상이 뚫려 있으면 항상 지상, 점프는 충돌 회피용으로만.
 *  - 탐색 자체가 entrance/exit-straight 를 강제(진행 방향으로만 점프 시작·출구 후 직진).
 *    남는 구멍은 양 끝 셀뿐이라 `requiredStartJump`(트렁크 유입 방향, half-lane side-load
 *    방지)·`requiredEndJump`(트렁크 유출 방향 — 어기면 출구가 seat 를 안 향해 물류 누수)
 *    로 막는다.
 *  - corridor 는 납품 경로 간 누적 전달(같은 직선 위 페어링 절단 방지)하고 결과로 내보내
 *    호출자(`run/emit`)가 Area/Routing 에 기록한다.
 *  - 게이트: `undergroundBeltEntityName` 이 없거나 distance≤0 이면 지상 전용(기존 동작).
 *
 * > **내력.** `modulePacking.packModuleTree` 안의 `P0` 블록이었다(2026-09-14 계획 구조-2축 · 2 Step 3c-2).
 * > 납품 사다리는 `planner/deliveryRoute.ts` 의 루프 몸통과 `routeOneDelivery` 였다(2026-09-15 Step 5c).
 */

import type { UndergroundCorridor } from "../../containerModel";
import type { Link } from "../../module/types/line";
import { shareLanes } from "../../module/link";
import { portGeometry } from "../../module/shape";
import { laneCapOfTier } from "../../beltThroughput";
import { AUTO_LAYOUT_COORD_DUMP, AUTO_LAYOUT_LANE_MERGE, AUTO_LAYOUT_LINK_DIRECT } from "../../debugFlags";
import { recordLaneShareStats } from "../../../debug/runStats";
import { cellKey, faceVector } from "../../util/helper";
import { dijkstraWithJumps } from "../containerRouting";
import { planLinkFaces } from "../module/planModulePorts";
import { clusterBeltDepthsOf } from "../module/arith";
import { linkDepthNeed } from "../module/depthBudget";
import { edgeLinkGroups } from "./edgeLinks";
import { finishChain, finishFluidChain } from "./emit";
import { plannedChainClear, type DeliveryLedger, type PlannedChains } from "./ledger";
import type { Bounds } from "./shape";
import type { DeliveryConfig, DeliveryRoute } from "./types";
import type { DeliverySpec, NodeSpec, PackConfig } from "../tree/types";
import { moduleInputOf, type TreeIndex } from "../tree/arith";

/** [edgeLinksOf] 의 답. `linkCache` 는 **같은 Map 이 좌석 단계에서 최종본으로 갈아 끼워진다.** */
export interface EdgeLinks {
  /** 노드 id → 부모에게 실제로 넘기는 품목. */
  productOf: ReadonlyMap<string, string | undefined>;
  /** 노드 id → 줄 열쇠(`role:name`) → 트렁크 줄의 끝 선호. */
  lineEndsById: ReadonlyMap<string, Map<string, "min" | "max">>;
  /** 자식 id → 그 간선의 줄(간선 = 자식→부모). */
  linkCache: Map<string, Link[]>;
}

/** **① 링크** — 간선마다 무엇을 몇 줄로 · 어느 끝으로. 끝이 여기서 서야 생성이 한 번이다. */
export function edgeLinksOf(tree: TreeIndex, specs: readonly NodeSpec[], config: PackConfig): EdgeLinks {
  const productOf = productsOf(tree, specs);
  const lineEndsById = lineEndsOf(tree, specs, productOf);
  const linkCache = baseLinks(tree, specs, config, productOf);
  shareLanePairs(linkCache, config);
  const links = { productOf, lineEndsById, linkCache };
  repourOverflowing(tree, specs, config, links);
  return links;
}

/**
 * 노드가 **부모에게 실제로 넘기는** 품목.
 *
 * 예전엔 첫 출력 라인을 그냥 집었다. 산출물이 하나뿐인 레시피에선 맞지만 **다산출
 * 레시피에선 엉뚱한 걸 집는다** — `empty-sulfuric-acid-barrel` 은 `barrel + sulfuric-acid`
 * 를 내는데 배열 순서상 `barrel` 이 잡혀, 부모(battery)에게서 "barrel 입력"을 찾다
 * 실패했다. 그러면 [pairDeliveryPorts] 가 짝을 못 만들어 **납품 경로가 0개**가 되고, 자식의 산
 * 출력과 부모의 산 입력이 **각각 외부 포트로** 떨어진다. 실측에서는 그 둘이 나란히
 * 붙어 한 관망이 됐다 — 한쪽은 "항상 가득"(at-least 1), 다른 쪽은 "항상 비움"(at-most 0)
 * 인 무한파이프 두 개가 같은 네트워크에(2026-07-26 브라우저 실측).
 *
 * 그래서 **부모가 먹는 것**으로 고른다. 나머지 산출물은 부산물이라 외부로 나간다.
 *
 * `specs` 는 `packModuleTree` 안에서 아무도 안 고치므로 **한 번 센 것을 끝까지 쓴다**(2026-09-14 —
 * 예전엔 부를 때마다 셌다).
 */
export function productsOf(tree: TreeIndex, specs: readonly NodeSpec[]): Map<string, string | undefined> {
  const { byId } = tree;
  const productOf = (s: NodeSpec): string | undefined => {
    const outs = s.lines.filter((l) => l.role === "output");
    if (outs.length === 0) return undefined;
    const parent = s.parentId ? byId.get(s.parentId) : undefined;
    if (parent) {
      const wanted = new Set(
        parent.lines.filter((l) => l.role === "input").map((l) => l.name),
      );
      const match = outs.find((o) => wanted.has(o.name));
      if (match) return match.name;
    }
    // 부모가 없거나(루트) 겹치는 게 없으면 옛 동작 — 없는 답을 지어내지 않는다.
    return outs[0].name;
  };
  return new Map(specs.map((s) => [s.id, productOf(s)] as const));
}

/**
 * **형제 순번이 끝을 정한다** — 좌표 없이.
 *
 * `layoutY` 는 자식을 **배열 순서대로 위 → 아래**로 놓고, 부모를 **첫·마지막의 중점**에
 * 둔다(`:489-501`). 그래서 좌표를 몰라도 이것만은 확정이다:
 *
 * ```
 * 앞쪽 형제 → 부모보다 위    → 자식은 **아래 끝**으로 나가고 부모는 **위 끝**에서 받는다
 * 뒤쪽 형제 → 부모보다 아래  → 자식은 **위 끝**,           부모는 **아래 끝**
 * ```
 *
 * **거리가 아니라 교차를 노린다.** *"가장 가까운 끝"* 은 두 기둥의 **모서리**(= topY + 높이)를
 * 알아야 하고, 높이는 `gen` 이 준다 — 그 목표를 지키는 한 `gen → 높이 → 끝 → gen` 이
 * 반드시 닫힌다(**되먹임 A**). 순서만 보면 고리가 없다.
 *
 * 가운데 형제는 부모 중심의 어느 쪽인지 **트리로 못 가른다**(간격 = 높이에 달렸다).
 * 그래도 **절반으로 갈라 두면 서로 안 교차한다** — 위 절반은 부모 위 끝, 아래 절반은
 * 아래 끝. 전부 한 끝으로 몰면 그 줄들이 서로를 건넌다.
 *
 * 형제가 하나뿐이면 부모가 그 위에 겹쳐 있어 선호가 없다 → `undefined`.
 */
export function siblingHalf(tree: TreeIndex, s: NodeSpec): "top" | "bottom" | undefined {
  const { childIdsByParent } = tree;
  if (!s.parentId) return undefined;
  const kids = childIdsByParent.get(s.parentId) ?? [];
  if (kids.length < 2) return undefined;
  const i = kids.indexOf(s.id);
  return i < kids.length / 2 ? "top" : "bottom";
}

/**
 * **트렁크 줄의 끝 선호** — 링크와 **같은 규칙**을 쓴다(`min` = 위끝 · `max` = 아래끝).
 *
 * 예전엔 tidy-tree 뒤에서 |Δy| 최소 조합으로 골랐고, 그 값이 `gen` 의 입력으로 돌아가
 * **2차 생성**을 불렀다(되먹임 A). 형제 순번으로 정하면 `gen` 보다 **앞**에서 확정되므로
 * 고리가 열린다. 대가는 거리 최적화를 버린 것이고, 대신 **교차가 없다**.
 */
export function lineEndsOf(
  tree: TreeIndex,
  specs: readonly NodeSpec[],
  productOf: ReadonlyMap<string, string | undefined>,
): Map<string, Map<string, "min" | "max">> {
  const lineEndsById = new Map<string, Map<string, "min" | "max">>();
  {
    const setEnd = (id: string, key: string, end: "min" | "max") => {
      (lineEndsById.get(id) ?? lineEndsById.set(id, new Map()).get(id)!).set(key, end);
    };
    for (const s of specs) {
      if (!s.parentId) continue;
      const product = productOf.get(s.id);
      if (!product) continue;
      const half = siblingHalf(tree, s);
      if (!half) continue; // 형제가 하나뿐 — 선호가 없다. 방출의 기본값(`min`)을 쓴다
      setEnd(s.id, `output:${product}`, half === "top" ? "max" : "min");
      setEnd(s.parentId, `input:${product}`, half === "top" ? "min" : "max");
    }
  }
  return lineEndsById;
}

/** 링크가 들 끝 — 자식 쪽·부모 쪽이 서로 반대다. */
export function linkEndOf(tree: TreeIndex, s: NodeSpec): Link["end"] {
  const half = siblingHalf(tree, s);
  if (!half) return undefined;
  return half === "top" ? { from: "S", to: "N" } : { from: "N", to: "S" };
}

/**
 * **간선마다 줄.**
 *
 * 간선당 [edgeLinkGroups] 를 **한 번만** 계산해 자식 id 로 캐시한다(간선 = 자식→부모,
 * 자식 하나는 출력 품목이 하나뿐이므로 childId 만으로 간선이 유일하게 식별된다).
 * 자식 쪽(outputLinksOf)과 부모 쪽(inputLinksOf)이 예전엔 이 계산을 각자 독립으로
 * 두 번 돌려 "결정적 함수+같은 입력이면 같은 출력"이라는 결정성만 믿고 일치를 기대했다
 * (2026-07-21 이전) — 이제 한 번 계산된 같은 객체를 양쪽이 그대로 참조한다.
 */
export function baseLinks(
  tree: TreeIndex,
  specs: readonly NodeSpec[],
  config: PackConfig,
  productOf: ReadonlyMap<string, string | undefined>,
): Map<string, Link[]> {
  const { byId } = tree;
  const linkCache = new Map<string, Link[]>();
  for (const s of specs) {
    if (!s.parentId) continue;
    const product = productOf.get(s.id);
    if (!product) continue;
    const groups = edgeLinkGroups(s, byId.get(s.parentId)!, product, config);
    // **끝은 여기서 얹는다** — `id` 와 같은 자리, 같은 규칙(위층이 채우고 module/ 은 안 만든다).
    const end = linkEndOf(tree, s);
    if (groups) linkCache.set(s.id, end ? groups.map((g) => ({ ...g, end })) : groups);
  }
  return linkCache;
}

/**
 * **레인 공유 짝짓기** — 같은 Map 의 줄에 `sharedLineId` 를 얹는다.
 *
 * **줄 둘을 한 물리 벨트의 좌/우 레인에 하나씩** 싣는다
 * (`docs/factorio/belt-lane-semantics.md` · `tempPlanDocs/벨트-레인/`).
 *
 * ## 무엇을 되찾나
 * 인서터는 먼 레인 하나에만 떨구므로 **줄 하나는 벨트의 절반만 쓴다.** 그래서 45/s 수요는
 * [determineBeltCount] 가 줄 **둘**로 낸다. 합류시키면 벨트가 하나로 돌아온다 —
 * **처리량은 안 늘고 물리 벨트 수가 준다.**
 *
 * ## 후보 = **같은 간선의 두 줄** (v1 = 같은 품목)
 * `linkCache` 의 한 항목이 곧 간선 하나(자식→부모, 품목 하나)이고, 그 안에 줄이 여럿이면
 * 그것이 곧 *"수요가 레인 하나를 넘어 갈린 줄들"* 이다. 그 둘이 짝의 자연스러운 단위다.
 *
 * **기하가 공짜로 성립한다** — 관통 줄은 기둥 끝에 포트를 세우는데(`LinkFacePlan.portEnd`),
 * 그 끝은 면마다 장부(`ctx.ends`)로 관리돼 **먼저 앉은 줄이 N 을 잡으면 다음 줄은 S** 를
 * 잡는다. 즉 같은 간선의 두 줄은 기둥의 **위·아래 끝**에서 나가고, 채널에서 그 둘의 세로
 * 주행은 도착 행에 **양옆으로** 닿는다 → 유입이 둘 다 옆이라 **둘 다 접힌다**(각자 한 레인).
 * 같은 쪽에서 오면 위쪽이 아래쪽의 **뒤 유입**이 되어 아래쪽이 조용히 굶는다(규칙 ⑤⑦).
 *
 * **같은 품목이라 필터가 필요 없다** — 집는 팔이 뭘 집든 같은 품목이다(승인 Q1).
 *
 * **[AUTO_LAYOUT_LANE_MERGE] 가 꺼져 있으면 아무 줄에도 안 붙는다** — 아래 모든 갈래가
 * 도달 불가가 되어 **오늘 동작 그대로**다(미완성 기능의 관용구).
 *
 * **배정([allocateTree]) 앞이라야 한다** — 배정이 공유를 보고 부모 면에서 한 벨트를
 * 잡기 때문이다. 배정이 줄을 쪼개면 그 토막은 더 이상 같은 줄이 아니므로
 * [splitLinkAtRows] 가 표시를 **떼어 낸다**.
 * **꺼져 있어도 0 을 적는다** — 안 적으면 앞 실행의 수가 그대로 남아 대조군이 거짓이
 * 된다(2026-09-04: 끈 실행이 켠 실행의 `후보 1` 을 물려받았다). `beginRunStats` 가
 * 가려 주는 자리라 앱에선 안 보이고 테스트에서만 드러난다.
 */
export function shareLanePairs(linkCache: ReadonlyMap<string, Link[]>, config: PackConfig): void {
  const share = { candidates: 0, pairs: 0, rejected: 0 };
  if (AUTO_LAYOUT_LANE_MERGE) {
    const laneCapOf = (n: string | undefined): number | undefined => {
      const tier = config.belts?.find((b) => b.entityName === n);
      return tier ? laneCapOfTier(tier) : undefined;
    };
    for (const [childId, groups] of linkCache) {
      // 줄이 하나면 갈린 적이 없다 — 되찾을 절반도 없다.
      for (let i = 0; i + 1 < groups.length; i += 2) {
        share.candidates += 1;
        const made = shareLanes(
          [groups[i], groups[i + 1]],
          laneCapOf,
          () => `${childId}#lane${i / 2}`,
        );
        share.pairs += made;
        share.rejected += made === 0 ? 1 : 0;
      }
    }
  }
  recordLaneShareStats(share);
}

/**
 * **(가) 다이렉트 — 넘치는 부모의 링크 입력만 `g = 1` 로 다시 붓는다** (플래그 뒤).
 *
 * 밸브([EdgeBundle])는 진작 뚫려 있었고 **주는 사람이 없었다.** 여기가 주는 자리다.
 *
 * **두 번 붓는 것이 낭비가 아니다** — `edgeLinkGroups` 가 `undefined` 를 내는 조건
 * (유체 줄 · 흐름 0 · 벨트/인서터 못 고름)은 `bundle` 과 **무관**하다. 그러니 1차가
 * 어떤 간선이 링크가 되는지를 확정해 주고, 그 결과라야 `L_f`(품목 종류 수)를 **방출과
 * 같은 낟알로** 셀 수 있다. 트리에서 자식 수를 세면 유체 간선까지 세어 과대평가한다.
 *
 * **끄면 오늘 동작 그대로다** — 기전: 이 블록 전체가 안 돈다.
 * **레인 합류와 같이 켜지 않는다** — 짝짓기가 이미 `sharedLineId` 를 얹은 뒤라
 * 다시 부으면 그 신원이 사라진다. 둘을 함께 쓰려면 짝짓기를 이 뒤로 옮겨야 하고,
 * 그건 이 계획의 몫이 아니다(`부분-링크` 는 `벨트-레인` 을 안 건드린다).
 */
export function repourOverflowing(
  tree: TreeIndex,
  specs: readonly NodeSpec[],
  config: PackConfig,
  links: EdgeLinks,
): void {
  const { productOf, linkCache } = links;
  if (AUTO_LAYOUT_LINK_DIRECT && !AUTO_LAYOUT_LANE_MERGE) {
    /** 부모별 들어오는 링크(1차 결과 기준) — 이것이 그 면의 `L_E` 다. */
    const inItemsOf = new Map<string, Set<string>>();
    for (const s of specs) {
      if (!s.parentId || !linkCache.get(s.id)?.length) continue;
      const set = inItemsOf.get(s.parentId) ?? inItemsOf.set(s.parentId, new Set()).get(s.parentId)!;
      for (const g of linkCache.get(s.id)!) set.add(g.item);
    }
    for (const p of specs) {
      const L_E = inItemsOf.get(p.id)?.size ?? 0;
      if (L_E === 0) continue;
      const outItem = p.parentId ? productOf.get(p.id) : undefined;
      // **깊이는 장부를 안 읽는다**([clusterBeltDepthsOf] 머리말) — `"open"` 무대면 족하다.
      const probe = planLinkFaces(moduleInputOf(tree, config, links, p), Math.max(1, p.count), "open");
      const need = linkDepthNeed({
        linesOf: (f) => (f === "W" ? (outItem ? 1 : 0) : L_E),
        depthsOf: (f) => clusterBeltDepthsOf(probe.ctx, f).length,
      });
      if (need === "free") continue;
      // **집는 쪽(`to`) 기준이다** — 넘치는 것은 받는 면이고, `g` 는 그 끝의 값이다.
      for (const s of specs) {
        if (s.parentId !== p.id || !linkCache.get(s.id)?.length) continue;
        const re = edgeLinkGroups(s, p, productOf.get(s.id)!, config, { side: "to", g: 1 });
        if (!re?.length) continue; // 다시 부어 빈손이면 **1차 결과를 지키다** — 없애지 않는다
        const end = linkEndOf(tree, s);
        linkCache.set(s.id, end ? re.map((g) => ({ ...g, end })) : re);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 납품 경로 하나가 놓이는 사다리
// ─────────────────────────────────────────────────────────────────────────────

/** **ⓐ 게이트** — 지하벨트를 쓰나 · 점프가 페어링되는 prototype. */
export function undergroundGateOf(config: DeliveryConfig): { maxJump: number; blockGroup: string } {
  // 지하벨트 게이트 — prototype 미지정(위저드에서 지하벨트 미선택)이면 지상 전용(기존
  // 동작). emit 은 emitItemPath(edge-aware)라 점프 경로가 지하벨트 입/출구로 정확히
  // materialize 된다. 'length' 비용 모델이라 지상이 뚫려 있으면 점프는 절대 선택되지
  // 않는다 — 지하는 충돌 회피용으로만.
  const maxJump = config.undergroundBeltEntityName
    ? Math.max(0, config.beltMaxUndergroundDistance ?? 0)
    : 0;
  const blockGroup = config.undergroundBeltEntityName ?? config.beltEntityName;
  return { maxJump, blockGroup };
}

const isFluidDelivery = (h: DeliverySpec) => h.from.chest.kind === "infinity-pipe";

/** **ⓒ 순서 — 유체 먼저.** 안정 정렬이라 아이템끼리 · 유체끼리의 순서는 `pack.deliveries` 그대로다. */
export function fluidFirst(deliveries: ReadonlyArray<DeliverySpec>): DeliverySpec[] {
  // 유체 납품 경로를 **먼저** 깐다. 순서가 실패 비용을 따른다(docs/…fluid-delivery-reservation.md §4.3):
  // 아이템의 "예약 무시 재시도"(아래)는 남의 계획 칸을 밟는데, 그게 유체의 자리였으면
  // 유체는 물러설 데가 없어 트리가 통째로 죽는다. 유체가 먼저 자리를 실제로 차지하면
  // (deliveryBelts 에 올라가면) 그 재시도가 밟을 수 없다 — 순서 하나로 최악을 막는다.
  return [...deliveries].sort((a, b) => Number(isFluidDelivery(b)) - Number(isFluidDelivery(a)));
}

/** **ⓐ 의 판** — 전 모듈 점유 · 탐색 경계 · 지하 게이트. 한 실행 동안 안 바뀐다. */
export interface DeliveryBoard {
  base: Set<string>;
  bounds: Bounds;
  maxJump: number;
  blockGroup: string;
}

/**
 * **ⓓ-2 고르기** — 이 납품의 경로와 사유. 칸 순서를 다시 쓰지 않는다 — 그 순서가 곧 *"예약 무시 재시도는 남의 계획을
 * 밟는다(연쇄 가능)"* 의 대가를 정한다.
 */
export function chooseRoute(
  delivery: DeliverySpec,
  k: string,
  board: DeliveryBoard,
  plans: PlannedChains,
  laid: DeliveryLedger,
  config: DeliveryConfig,
): Omit<DeliveryRoute, "key"> {
  const { base, bounds, maxJump, blockGroup } = board;
  const { plannedChains, chainMisses, reservedDelivery, reservedExport } = plans;
  const { deliveryBelts, ledger } = laid;
  const isFluid = isFluidDelivery(delivery);
  const chain = plannedChains.get(k);
  let route: Omit<DeliveryRoute, "key">;
  const mergeGuard = isFluid ? config.fluidBlocked?.get(delivery.item) : undefined;
  const blockedBy = chain
    ? plannedChainClear(chain, k, base, deliveryBelts, reservedExport, reservedDelivery, mergeGuard)
    : null;
  if (isFluid && !config.pipeEntityName) {
    // **파이프 prototype 이 없으면 유체는 아예 못 깐다.** 이 판정은 옛 탐색 경로
    // ([routeOneFluidDelivery] 호출부)가 갖고 있었는데, 그 경로가 사라지면서
    // (`AUTO_LAYOUT_CHANNEL_GEOMETRY` off 모드 제거, 2026-09-08) 계획 경로가 물려받았다.
    // 안 그러면 [finishFluidChain] 의 `!` 가 **이름 없는 파이프**를 깐다.
    route = { item: delivery.item, ok: false, cells: [], corridors: [], reason: "no-pipe-entity" };
  } else if (chain && blockedBy === null) {
    // 계획 체인은 품목-무관하다([buildPlannedChain]) — 갈리는 곳은 방출 하나뿐이다.
    route = isFluid ? finishFluidChain(delivery, chain, config) : finishChain(delivery, chain, config);
    laid.planned += 1;
  } else if (isFluid) {
    // **유체엔 탐색 폴백이 없다**(결정 D3). 원칙이 "모든 배치는 처음에 계획할 수 있어야
    // 한다"이므로, 계획 없이 탐색으로 때운 경로를 유체에 남기지 않는다 — 그건 "성공했다는데
    // 어디로 지나가는지 아무도 모르는" 배치다. 여기 오면 납품 경로 실패 → 트리가 거절된다.
    //
    // 유체는 장부에 **항상** 들어가므로(§1.1: wantFace 가 W/E 를 강제) 계획 자체가 없는
    // 경우는 장부가 자리를 못 준 것이다 — 사실상 한 채널 안 다른 유체끼리의 교차뿐이다.
    route = {
      item: delivery.item, ok: false, cells: [], corridors: [],
      reason: chain ? "fluid-planned-chain-blocked" : "fluid-unplannable",
    };
  } else {
    laid.dijkstraFallback += 1;
    if (chain) {
      chainMisses.push({ key: k, reason: `chain-blocked:${blockedBy}` });
      // **안 쓸 계획의 예약은 유령이다 — 여기서 지운다.**
      //
      // 예약 장부는 계획 체인 전부에서 **한 번에** 만들어지고 여태 갱신된 적이 없었다.
      // 그래서 계획 둘이 한 칸에서 만나면 **둘 다 죽었다**: A 는 B 의 예약에 막혀
      // 탐색으로 내려가는데, A 의 (이제 안 깔릴) 계획 칸이 장부에 남아 B 까지 막는다.
      // 아무도 못 이기고 둘 다 폴백한다(2026-09-04 실측: 겹친 칸은 `(18,26)` **하나**였다).
      //
      // 지우면 A 는 탐색으로 가되 B 는 계획을 지킨다 — 폴백이 둘에서 하나로 준다.
      // A 의 탐색은 아래 `extra` 로 여전히 B 의 예약을 피하고, B 는 그 뒤 A 가 **실제로**
      // 깐 칸(`deliveryBelts`)에 대고 다시 검사받는다. 유령만 사라진다.
      reservedDelivery.delete(k);
      if (AUTO_LAYOUT_COORD_DUMP)
        console.log("[deliveryRoute] planned chain blocked — dijkstra fallback", k, "—", blockedBy);
    }
    // 다른 예약 자리(반출 트랙 + 다른 계획 납품 경로)는 dijkstra 도 침범 금지.
    const extra = new Set<string>(reservedExport);
    for (const [k2, cells] of reservedDelivery) if (k2 !== k) for (const c of cells) extra.add(c);
    route = routeOneDelivery(delivery, base, deliveryBelts, ledger, maxJump, blockGroup, config, bounds, extra);
    if (!route.ok && extra.size > 0) {
      // 예약이 길을 전부 막은 극단 케이스 — 예약 없이 재시도(납품 경로 실패 = 트리 전체
      // 폴백이므로, 반출 skip-on-failure 보다 훨씬 비싼 회귀를 피한다).
      //
      // **이 재시도는 남의 예약을 밟는다. 그 대가가 연쇄한다**(2026-07-22 조사):
      // 밟힌 계획은 다음 차례에 막혀 자기도 탐색으로 내려가고, 그 탐색이 또 예약을
      // 밟을 수 있다. 관측된 사슬 — 계획 없던 납품 경로 하나가 두 납품 경로를 더 끌고 내려갔다.
      // 그래도 **의도된 거래**다: 여기서 물러나면 납품 경로 실패 → 트리 전체가 옛 경로로
      // 떨어져 훨씬 크게 잃는다. 줄이려면 예약을 "막힘"이 아니라 "비싼 칸"으로 줘서
      // **최소한만 밟게** 해야 하는데, 그건 라우터 비용 모델을 바꾸는 별개 작업이다.
      route = routeOneDelivery(delivery, base, deliveryBelts, ledger, maxJump, blockGroup, config, bounds);
      laid.reservationOverrun += 1;
      if (AUTO_LAYOUT_COORD_DUMP)
        console.log("[deliveryRoute] 예약 무시 재시도 — 남의 계획을 밟는다(연쇄 가능)", k);
    }
  }
  return route;
}

function routeOneDelivery(
  delivery: DeliverySpec,
  base: Set<string>,
  deliveryBelts: Set<string>,
  corridors: ReadonlyArray<UndergroundCorridor>,
  maxJump: number,
  blockGroup: string,
  config: DeliveryConfig,
  /**
   * 탐색 경계 = 전체 배치 bbox(마진 포함). **없으면 dijkstra 가 무한 격자로 새어나가
   * 폭주한다** — 1:1 방출로 납품 경로가 머신 수만큼 늘고 예약 셀이 길을 좁히면, 막힌 폴백이
   * 바깥으로 끝없이 우회하며 Map 이 터진다(실측: count 4/4/2 에서 46초 후 OOM).
   * 납품 경로는 정의상 배치 안에서 끝나므로 여기에 가둔다.
   */
  bounds: { x0: number; y0: number; x1: number; y1: number },
  extraBlocked?: ReadonlySet<string>,
): Omit<DeliveryRoute, "key"> {
  const from = portGeometry(delivery.from); // 자식 출력(collect)
  const to = portGeometry(delivery.to); // 부모 입력(supply)
  const fvFrom = faceVector(delivery.from.face);
  const fvTo = faceVector(delivery.to.face);

  // blocked = 전 모듈 + 이미 깐 납품 경로 belt + 예약 자리(기하 예약) − 이 납품 경로의 두 chest(start/end).
  // seat 은 막은 채로 둬 경로가 클러스터 안쪽으로 새지 않게 한다.
  const blocked = new Set<string>(base);
  for (const k of deliveryBelts) blocked.add(k);
  if (extraBlocked) for (const k of extraBlocked) blocked.add(k);
  blocked.delete(cellKey(from.chest.x, from.chest.y));
  blocked.delete(cellKey(to.chest.x, to.chest.y));

  const result = dijkstraWithJumps({
    start: from.chest,
    end: to.chest,
    blocked,
    corridors,
    maxJumpDistance: maxJump,
    blockGroup,
    // 지하벨트는 충돌 회피용으로만 — 지상이 뚫려 있으면 항상 지상을 택한다.
    jumpCostModel: 'length',
    // 끝 셀 점프의 방향 강제. 탐색이 entrance/exit-straight 를 이미 보장하므로 남는
    // 구멍은 양 끝뿐: 시작 점프는 seat_from→chest_from 유입 방향(+fv, 어기면 half-lane
    // side-load), 끝 점프는 chest_to→seat_to 유출 방향(−fv, 어기면 출구가 seat 를 안
    // 향해 아이템이 다른 칸으로 샘 = 누수).
    requiredStartJump: { dx: fvFrom.x, dy: fvFrom.y },
    requiredEndJump: { dx: -fvTo.x, dy: -fvTo.y },
    bounds,
  });
  if (!result) {
    return { item: delivery.item, ok: false, cells: [], corridors: [], reason: "no-path" };
  }

  return finishChain(delivery, result, config);
}
