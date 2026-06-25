/**
 * moduleHop — 모듈 간 홉 (조각 4, 순수·무상자 belt-to-belt).
 *
 * 단일 출처: 본 설계안(모듈 출력 경계 / ⑤ 핸드오프 = 벨트-투-벨트 무상자).
 *
 * [modulePacking.packModuleTree] 가 낸 `HopSpec`(자식 출력 포트 → 부모 입력 포트)을
 * 받아, 두 포트의 **경계 무한상자 + 경계 인서터를 떼고** 그 자리를 belt 로 메워
 * 자식 출력 trunk 끝 → 부모 입력 trunk 머리를 **상자 없이 직접** 잇는다.
 *
 * ## 왜 무상자
 * generateModule 은 클러스터를 "루트인 척" 생성해 모든 포트가 무한상자(외부 소스/싱크)로
 * 끝난다. 두 모듈을 *실제로* 연결하려면 그 경계 상자를 떼고 belt 를 이어야 한다 — 안 그러면
 * 끊긴 무한버퍼 두 개가 되어 물류가 가짜가 된다.
 *
 * ## 포트 기하 (계약 추가 없이 anchor+face 에서 유도)
 * emitTrunk 규약상 한 포트는 `chest -- seat(인서터) -- trunkStart(belt)` 가 일직선(2칸)이고
 * `face` 는 바깥 방향(클러스터→ring)이다. 따라서:
 *   - chest    = `anchor`
 *   - seat     = `anchor − faceVec(face)`   (인서터 — 제거 대상)
 *   - trunkStart = `anchor − 2·faceVec(face)` (기존 trunk belt — 유지)
 * 출력(collect)은 trunk 흐름이 chest 쪽(바깥)을 향하고, 입력(supply)은 chest→trunk(안쪽)을
 * 향한다. 그래서 새 belt 체인은 `seat_from → chest_from → …경로… → chest_to → seat_to` 로
 * 흐른다(각 셀 방향 = 다음 셀 향함).
 *
 * ## 경로탐색
 * 검증된 [containerRouting.dijkstraWithJumps] 를 그대로 재사용 — start=chest_from,
 * end=chest_to, blocked=전 모듈 occupancy(이 홉의 두 chest 만 제외). 지상 전용(v1,
 * maxJumpDistance=0); 모듈 사이 채널이 비어 있어 충돌이 구조적으로 드물다.
 *
 * 무배선·순수 — Area·store 의존 0. 단위 테스트 + 브라우저 ASCII harness 로만 검증.
 */

import type { ContainerPort, PlacedCell, PortFace, PortPair } from "./containerModel";
import {
  cellKey,
  dijkstraWithJumps,
  faceVector,
  makeBeltCell,
  vectorToDirection,
} from "./containerRouting";
import type { ModulePort } from "./clusterModule";
import type { HopSpec, PackResult } from "./modulePacking";

export interface HopConfig {
  beltEntityName: string;
  /** 지하벨트 점프 거리(>0 이면 underground 허용). v1 기본 0(지상 전용). */
  beltMaxUndergroundDistance?: number;
  /** 지하벨트 prototype(점프 blockGroup). */
  undergroundBeltEntityName?: string;
}

/** 한 홉의 라우팅 결과. */
export interface HopRoute {
  item: string;
  ok: boolean;
  /** 홉 belt 셀들(경계 chest/seat 자리 포함). 실패 시 빈 배열. */
  cells: PlacedCell[];
  reason?: string;
}

export interface ModuleHopResult {
  /** 모든 홉 belt 셀(절대 좌표). */
  cells: PlacedCell[];
  /** 떼야 할 무한상자 컨테이너 id(자식 출력 싱크 + 부모 입력 소스). */
  strippedChestIds: Set<string>;
  /** 떼야 할 모듈 셀 좌표("x,y") — 경계 chest ghost + 경계 인서터. */
  strippedCellKeys: Set<string>;
  routes: HopRoute[];
  /** 경로 못 찾은 홉 수. */
  failures: number;
}

/** 포트의 경계 기하 — anchor + face 에서 유도. */
function portGeometry(port: ModulePort): {
  chest: { x: number; y: number };
  seat: { x: number; y: number };
  trunkStart: { x: number; y: number };
} {
  const fv = faceVector(port.face);
  const chest = { x: port.anchor.x, y: port.anchor.y };
  const seat = { x: chest.x - fv.x, y: chest.y - fv.y };
  const trunkStart = { x: chest.x - 2 * fv.x, y: chest.y - 2 * fv.y };
  return { chest, seat, trunkStart };
}

/** makeBeltCell 의 entityId 생성용 최소 PortPair. */
function synthPair(producerId: string, consumerId: string): PortPair {
  const port = (containerId: string): ContainerPort => ({
    containerId,
    cell: { x: 0, y: 0 },
    face: "N" as PortFace,
    kind: "item",
  });
  return { producer: port(producerId), consumer: port(consumerId) };
}

/** 전 모듈의 점유 셀(머신 footprint + 모든 placed 셀, chest ghost 포함). */
function buildOccupancy(pack: PackResult): Set<string> {
  const occ = new Set<string>();
  for (const pl of pack.placements) {
    for (const m of pl.module.machines)
      for (let dx = 0; dx < m.size.w; dx++)
        for (let dy = 0; dy < m.size.h; dy++)
          occ.add(cellKey(m.origin.x + dx, m.origin.y + dy));
    for (const c of pl.module.cells) occ.add(cellKey(c.x, c.y));
  }
  return occ;
}

/**
 * 모든 홉을 라우팅. 결정적 순서(packResult.hops 순서)로 누적 occupancy 를 공유해
 * 뒤 홉이 앞 홉 belt 를 피한다.
 */
export function routeModuleHops(pack: PackResult, config: HopConfig): ModuleHopResult {
  const base = buildOccupancy(pack);
  const hopBelts = new Set<string>(); // 이미 깐 홉 belt
  const cells: PlacedCell[] = [];
  const strippedChestIds = new Set<string>();
  const strippedCellKeys = new Set<string>();
  const routes: HopRoute[] = [];
  let failures = 0;

  // 지상 전용 강제. routeOneHop 의 emit(아래)은 result.edges 를 보지 않고 셀-델타로만
  // 방향을 잡으므로, dijkstra 가 점프(지하벨트) 경로를 내면 지하벨트 entity 를
  // materialize 하지 못해 belt 체인이 끊긴다(아이템이 허공/타 스트림으로 샘). 점프를
  // 0 으로 막아 항상 연속 지상 경로만 나오게 한다. 지상이 막혀 경로가 없으면 그 홉은
  // 실패 → 트리 전체가 옛 경로로 폴백(회귀, correctness 유지). 지하벨트 지원은
  // emit 을 edge-aware(=containerRouting.emitItemPath)로 바꾼 뒤 config 로 재활성.
  const maxJump = 0;
  const blockGroup = config.undergroundBeltEntityName ?? config.beltEntityName;
  void config.beltMaxUndergroundDistance; // 예약(현재 미사용) — 위 주석 참조

  for (const hop of pack.hops) {
    const route = routeOneHop(hop, base, hopBelts, maxJump, blockGroup, config);
    routes.push(route);
    if (!route.ok) {
      failures += 1;
      continue;
    }
    for (const c of route.cells) {
      cells.push(c);
      hopBelts.add(cellKey(c.x, c.y));
    }
    strippedChestIds.add(hop.from.chest.id);
    strippedChestIds.add(hop.to.chest.id);
    for (const k of stripKeys(hop)) strippedCellKeys.add(k);
  }

  return { cells, strippedChestIds, strippedCellKeys, routes, failures };
}

/** 한 홉이 떼는 셀 좌표 — 양끝 chest(ghost) + 양끝 seat(인서터). */
function stripKeys(hop: HopSpec): string[] {
  const g0 = portGeometry(hop.from);
  const g1 = portGeometry(hop.to);
  return [
    cellKey(g0.chest.x, g0.chest.y),
    cellKey(g0.seat.x, g0.seat.y),
    cellKey(g1.chest.x, g1.chest.y),
    cellKey(g1.seat.x, g1.seat.y),
  ];
}

function routeOneHop(
  hop: HopSpec,
  base: Set<string>,
  hopBelts: Set<string>,
  maxJump: number,
  blockGroup: string,
  config: HopConfig,
): HopRoute {
  const from = portGeometry(hop.from); // 자식 출력(collect)
  const to = portGeometry(hop.to); // 부모 입력(supply)

  // blocked = 전 모듈 + 이미 깐 홉 belt − 이 홉의 두 chest(start/end). seat 은 막은 채로
  // 둬 경로가 클러스터 안쪽으로 새지 않게 한다.
  const blocked = new Set<string>(base);
  for (const k of hopBelts) blocked.add(k);
  blocked.delete(cellKey(from.chest.x, from.chest.y));
  blocked.delete(cellKey(to.chest.x, to.chest.y));

  const result = dijkstraWithJumps({
    start: from.chest,
    end: to.chest,
    blocked,
    corridors: [],
    maxJumpDistance: maxJump,
    blockGroup,
    // 지하벨트는 충돌 회피용으로만 — 지상이 뚫려 있으면 항상 지상을 택한다.
    jumpCostModel: 'length',
  });
  if (!result) {
    return { item: hop.item, ok: false, cells: [], reason: "no-path" };
  }

  // 새 belt 체인: seat_from → [경로 셀들(chest_from..chest_to)] → seat_to.
  // 각 셀 방향 = 다음 셀 향함. seat_to 의 다음 = trunkStart_to(기존, 방향 산출용 sentinel).
  const chain: { x: number; y: number }[] = [from.seat, ...result.cells, to.seat];

  // INVARIANT: belt 체인은 텔레포트하지 않는다 — 연속 두 셀은 직교 인접(거리 1)이어야
  // 한다. 이 emit 은 지하벨트를 materialize 하지 않으므로 점프 셀(거리>1)을 만나면
  // 끊긴 체인을 낳는다. 그런 결과를 *조용히 내보내지 말고* 홉 실패로 처리해 트리가
  // 옛 경로로 폴백하게 한다(가짜 물류 방지). maxJump=0 이면 정상적으로 절대 안 걸린다.
  for (let i = 0; i + 1 < chain.length; i++) {
    const md = Math.abs(chain[i].x - chain[i + 1].x) + Math.abs(chain[i].y - chain[i + 1].y);
    if (md !== 1) {
      return { item: hop.item, ok: false, cells: [], reason: "discontinuous-chain" };
    }
  }

  const pair = synthPair(hop.from.chest.id, hop.to.chest.id);
  const out: PlacedCell[] = [];
  for (let i = 0; i < chain.length; i++) {
    const cur = chain[i];
    const next = i + 1 < chain.length ? chain[i + 1] : to.trunkStart;
    const dir = vectorToDirection(next.x - cur.x, next.y - cur.y);
    out.push(makeBeltCell(cur, dir, config.beltEntityName, pair));
  }
  return { item: hop.item, ok: true, cells: out };
}
