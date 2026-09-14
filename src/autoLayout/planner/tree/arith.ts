/**
 * **트리 관심사의 셈** — 부모·자식 · 깊이마다 위→아래 순서 · 모듈 하나의 계획 입력. 좌표를 모른다.
 *
 * 트리 구조는 외생이다(스도쿠 닻) — 그래서 좌표가 서기 **전에** 이 답들이 선다.
 *
 * > **내력.** `modulePacking.packModuleTree` 안의 지역 함수들이었다(2026-09-14 계획 구조-2축 · 2 Step 3c-2).
 * > 같은 DFS 가 한 함수 안에서 두 번 돌았다(노출 끝면용 · 행 채널용) — 여기서 한 번으로 접었다.
 */

import type { Link } from "../../module/types/line";
import type { ModuleInput } from "../../module/types/module";
import type { NodeSpec, PackConfig } from "./types";

/** [treeIndexOf] 의 답 — 좌표 없이 트리가 답하는 것 전부. */
export interface TreeIndex {
  byId: Map<string, NodeSpec>;
  /** 부모 id → 자식 id(`specs` 순서). */
  childIdsByParent: Map<string, string[]>;
  /**
   * **깊이별 세로 순서 — 좌표가 아니라 트리가 답한다.**
   *
   * `layoutY` 는 자식을 배열 순서대로 위→아래로 놓고, 겹침 스윕은 **아래로만** 민다.
   * 그러니 같은 깊이의 세로 순서 = **트리 DFS 순서**이고, 좌표 없이 나온다.
   */
  orderByDepth: Map<number, string[]>;
  maxDepth: number;
}

/** **⓪ 트리** — 부모·자식 · 깊이마다 위→아래 순서 · 최대 깊이. */
export function treeIndexOf(specs: readonly NodeSpec[]): TreeIndex {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const childIdsByParent = new Map<string, string[]>();
  for (const s of specs) {
    if (!s.parentId) continue;
    (childIdsByParent.get(s.parentId) ?? childIdsByParent.set(s.parentId, []).get(s.parentId)!).push(s.id);
  }
  const orderByDepth = new Map<number, string[]>();
  {
    const visit = (id: string): void => {
      const d = byId.get(id)!.depth;
      (orderByDepth.get(d) ?? orderByDepth.set(d, []).get(d)!).push(id);
      for (const k of childIdsByParent.get(id) ?? []) visit(k);
    };
    for (const s of specs) if (!s.parentId) visit(s.id);
  }
  const maxDepth = Math.max(...specs.map((s) => s.depth), 0);
  return { byId, childIdsByParent, orderByDepth, maxDepth };
}

/** 부모 입력 중 자식-공급인 품목 집합. */
export function childFedItems(
  tree: TreeIndex,
  productOf: ReadonlyMap<string, string | undefined>,
  s: NodeSpec,
): Set<string> {
  const set = new Set<string>();
  for (const cid of tree.childIdsByParent.get(s.id) ?? []) {
    const p = productOf.get(cid);
    if (p) set.add(p);
  }
  return set;
}

/**
 * 노출 끝면(N/S) — count=1 완화의 노출 판정. 세로 순서는 tidy-tree 가 DFS 방문
 * 순서를 보존하므로(형제 재배열 없음) 좌표 확정 *전에* 열-내 서열로 유도할 수 있다
 * (스도쿠 닻: 트리 구조가 외생). 열의 첫 모듈 위(N)·마지막 모듈 아래(S)는 전역
 * 마진뿐 — 그 방향 깊이가 형제와 충돌하지 않는다.
 */
export function nsExposureOf(tree: TreeIndex, s: NodeSpec): ("N" | "S")[] | undefined {
  if (s.count !== 1) return undefined; // 기둥(count≥2)은 N/S 깊이가 끝 머신만 서빙 — 제외.
  const col = tree.orderByDepth.get(s.depth)!;
  const faces: ("N" | "S")[] = [];
  if (col[0] === s.id) faces.push("N");
  if (col[col.length - 1] === s.id) faces.push("S");
  return faces.length ? faces : undefined;
}

/**
 * **모듈 하나의 계획 입력** — 스펙 · 전역 선택 · 끝 선호 · 노출 끝면 · 링크.
 *
 * 링크는 부를 때의 `linkCache` 에서 읽는다 — 좌석 단계가 그 Map 을 제자리에서 최종본으로
 * 갈아 끼우므로, 부르는 시점이 답을 정한다.
 */
export function moduleInputOf(
  tree: TreeIndex,
  config: PackConfig,
  links: {
    productOf: ReadonlyMap<string, string | undefined>;
    lineEndsById: ReadonlyMap<string, Map<string, "min" | "max">>;
    linkCache: ReadonlyMap<string, Link[]>;
  },
  s: NodeSpec,
): ModuleInput {
  const { linkCache } = links;
  const { childIdsByParent } = tree;
  // 출력 fan-out 링크 — 이 노드의 출력을 부모 머신들에게 나눠 주는 [Link] 목록.
  // 부모가 있고 rate·처리량이 다 있을 때만(없으면 undefined = 옛 트렁크 방출).
  const outputLinksOf = (s: NodeSpec): Link[] | undefined => linkCache.get(s.id);
  // 입력 fan-in 그룹 — outputLinks 의 거울. 이 노드가 부모인 간선들(자식마다)의 그룹을 모은다.
  // 캐시에서 그대로 가져오므로 자식 쪽과 그룹 객체(및 id)가 완전히 일치한다.
  const inputLinksOf = (s: NodeSpec): Link[] | undefined => {
    const kids = childIdsByParent.get(s.id) ?? [];
    const groups: Link[] = [];
    for (const cid of kids) {
      const g = linkCache.get(cid);
      if (g) groups.push(...g);
    }
    return groups.length > 0 ? groups : undefined;
  };
  return {
    ...toModuleInput(s, config, childFedItems(tree, links.productOf, s)),
    // **끝 선호를 처음부터 싣는다** — 예전엔 tidy-tree 뒤에 알아내 2차 생성으로 다시 넣었다.
    lineEnds: links.lineEndsById.get(s.id),
    nsExposure: nsExposureOf(tree, s),
    outputLinks: outputLinksOf(s),
    inputLinks: inputLinksOf(s),
  };
}

function toModuleInput(s: NodeSpec, config: PackConfig, fed: Set<string>): ModuleInput {
  return {
    machine: s.machine,
    count: s.count,
    // external = 트리 안 생산자 없는 입력(무한상자로 살아남음) — planner 의 노출
    // N/S 완화 대상. 내부 간선(납품 경로 대체 예정)·출력은 W/E 유지.
    lines: s.lines.map((l) => ({ ...l, external: l.role === "input" && !fed.has(l.name) })),
    inserterEntityName: config.inserterEntityName,
    beltEntityName: config.beltEntityName,
    belts: config.belts,
    undergroundBelts: config.undergroundBelts,
    inserters: config.inserters,
    idPrefix: s.id,
    // 트렁크 파이프 계획 — 게임데이터(fluid_boxes)를 보는 호출자(`run/policy` · `run/gamedata`)가 이미
    // 풀어서 spec 에 실어 보낸다. module/ 는 store 를 안 본다(순수).
    fluidTrunk: s.fluidTrunk,
    // [Parallel Inserting] 용량 — 마찬가지로 게임데이터를 보는 `run/gamedata` 가 계산해 실었다.
    supplyCapacity: s.supplyCapacity,
  };
}
