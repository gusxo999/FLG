/**
 * 트렁크 방출(emission) — 트렁크 경로(①)를 실제 그리드 셀로 변환 (Phase 2 둘째 단위).
 *
 * 단일 출처: 계획서 "트렁크 벨트 셀 경로 계산 — 그리디 성장" → ② 탭 라우팅.
 *
 * `computeTrunkPath` 가 계산한 `TrunkPath`(트렁크 belt 셀 + chest 셀 + 직접 탭 기록
 * + untapped) 를 받아, 청사진에 들어갈 PlacedCell 들을 만든다:
 *   - 트렁크 belt 셀 (흐름 방향대로)
 *   - chest 피더 인서터 (chest → 트렁크 시작 셀, 일반 인서터)
 *   - 머신별 탭 인서터 (트렁크 → 머신; reach 1=일반, reach 2=long-handed)
 *
 * 본 단위는 **순수**하다 — Area·gameDataStore 에 의존하지 않고, entity 이름만
 * 인자로 받는다. `untapped` 머신의 **스퍼(routeItem) 배치**와 Area commit·Routing
 * 래핑은 다음(오케스트레이션) 단위의 몫이라 여기서는 `spursNeeded` 로 넘기기만 한다.
 *
 * 인서터 방향 규약 (Factorio: direction = 픽업 방향):
 *   - 피더(chest=source): 픽업 = chest 향(−f), 드롭 = 트렁크.
 *   - 탭(machine=sink): 픽업 = 트렁크 향(=faceVector(face), 바깥), 드롭 = 머신(안).
 */

import type { ContainerPort, PlacedCell, PortPair } from './containerModel';
import { faceVector, makeBeltCell, makeInserterCell } from './containerRouting';
import type { TrunkPath } from './trunkPath';

export interface TrunkEmitOptions {
  /** 공유 무한상자 id (entityId 생성·Routing 연결 키). */
  chestId: string;
  beltEntityName: string;
  /** 일반(reach 1) 인서터 prototype. */
  inserterEntityName: string;
  /** long-handed(reach 2) 인서터 prototype. */
  longInserterEntityName: string;
}

export interface TrunkTapEmission {
  machineId: string;
  reach: 1 | 2;
  inserter: PlacedCell;
}

export interface TrunkEmission {
  /** 트렁크 belt 셀들 (chest→끝 순서). */
  beltCells: PlacedCell[];
  /** chest → 트렁크 시작 셀 피더 인서터. 트렁크 셀이 없으면 null. */
  feeder: PlacedCell | null;
  /** 직접 탭 인서터들 (머신 1개당 1개). */
  taps: TrunkTapEmission[];
  /** 직접 탭 못한 머신 id — 오케스트레이션이 스퍼(routeItem)로 처리. */
  spursNeeded: string[];
}

export function emitTrunk(path: TrunkPath, opts: TrunkEmitOptions): TrunkEmission {
  const trunkConsumerId = `${opts.chestId}#trunk`;
  const trunkPair = synthPair(opts.chestId, trunkConsumerId);

  // 1) 트렁크 belt 셀.
  const beltCells = path.trunkCells.map((c) =>
    makeBeltCell({ x: c.x, y: c.y }, c.dir, opts.beltEntityName, trunkPair),
  );

  // 2) chest 피더 인서터. chest -- feederSeat -- trunkStart 가 일직선(2칸).
  //    f = chest→trunkStart 단위벡터. 피더는 chest 에서 집어(−f) belt 에 놓는다.
  let feeder: PlacedCell | null = null;
  const start = path.trunkCells[0];
  if (start) {
    const f = {
      x: Math.sign(start.x - path.chestCell.x),
      y: Math.sign(start.y - path.chestCell.y),
    };
    const feederSeat = { x: path.chestCell.x + f.x, y: path.chestCell.y + f.y };
    feeder = makeInserterCell(feederSeat, { x: -f.x, y: -f.y }, opts.inserterEntityName, trunkPair);
  }

  // 3) 머신별 탭 인서터. 픽업 = faceVector(face)(트렁크 향, 바깥). reach 로 prototype 선택.
  const taps: TrunkTapEmission[] = path.covered.map((t) => {
    const pickup = faceVector(t.face);
    const name = t.reach === 2 ? opts.longInserterEntityName : opts.inserterEntityName;
    const pair = synthPair(trunkConsumerId, t.machineId);
    return {
      machineId: t.machineId,
      reach: t.reach,
      inserter: makeInserterCell(t.seat, pickup, name, pair),
    };
  });

  return { beltCells, feeder, taps, spursNeeded: [...path.untapped] };
}

/**
 * makeBeltCell/makeInserterCell 의 entityId 생성에 필요한 최소 PortPair.
 * (두 함수는 pair 에서 producer/consumer 의 containerId 만 읽는다.)
 */
function synthPair(producerId: string, consumerId: string): PortPair {
  const port = (containerId: string): ContainerPort => ({
    containerId,
    cell: { x: 0, y: 0 },
    face: 'N',
    kind: 'item',
  });
  return { producer: port(producerId), consumer: port(consumerId) };
}
