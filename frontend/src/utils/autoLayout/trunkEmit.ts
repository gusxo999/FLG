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
import { faceVector, makeBeltCell, makeInserterCell, vectorToDirection } from './containerRouting';
import type { TapRole, TrunkPath } from './trunkPath';

/**
 * 트렁크 방향:
 *  - 'supply'  — 입력. 상자(소스) → 머신들. 벨트 흐름 = 상자→끝, 탭은 트렁크에서
 *    집어 머신에 넣고, 상자 인서터(피더)는 상자에서 집어 트렁크에 놓는다.
 *  - 'collect' — 출력. 머신들 → 상자(싱크). 'supply' 의 거울: 벨트 흐름·모든 인서터
 *    픽업 방향을 반전한다. 기하(셀 위치)는 동일.
 */
export type TrunkMode = 'supply' | 'collect';

export interface TrunkEmitOptions {
  /** 공유 무한상자 id (entityId 생성·Routing 연결 키). */
  chestId: string;
  beltEntityName: string;
  /** 일반(reach 1) 인서터 prototype. */
  inserterEntityName: string;
  /** long-handed(reach 2) 인서터 prototype. */
  longInserterEntityName: string;
  /** 기본 'supply'(입력). 출력 병합은 'collect'. */
  mode?: TrunkMode;
}

export interface TrunkTapEmission {
  machineId: string;
  /** 집기 거리(셀 수). 1=일반, ≥2=긴팔. */
  reach: number;
  /** belt 기준 흐름 역할 ('source'=머신→belt, 'sink'=belt→머신). */
  role: TapRole;
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
  // collect(출력)는 supply(입력)의 거울 — 벨트 흐름·모든 인서터 픽업을 반전.
  const collect = opts.mode === 'collect';

  // 1) 트렁크 belt 셀.
  //    supply: trunkCells[i].dir 그대로 (chest→끝, 각 셀 = 다음 셀로의 흐름 방향).
  //    collect: 흐름이 끝→chest 로 반전된다. 코너 셀은 방향이 하나뿐이라 단순
  //    reverseDir 로는 흐름이 꺾여 돌지 못하고 경로 밖(빈칸)을 가리키게 된다
  //    (직선 셀에서만 우연히 일치). 따라서 셀 순서 기하로 "이전 셀(=collect
  //    흐름의 *다음* 셀)" 방향을 다시 계산한다. cell[0] 의 이전 = chest 측 피더 자리.
  const cells = path.trunkCells;
  const start = cells[0];
  let beltCells: PlacedCell[];
  if (collect && start) {
    const f0 = {
      x: Math.sign(start.x - path.chestCell.x),
      y: Math.sign(start.y - path.chestCell.y),
    };
    const feederSeat = { x: path.chestCell.x + f0.x, y: path.chestCell.y + f0.y };
    beltCells = cells.map((c, i) => {
      const prev = i === 0 ? feederSeat : cells[i - 1];
      return makeBeltCell(
        { x: c.x, y: c.y },
        vectorToDirection(prev.x - c.x, prev.y - c.y),
        opts.beltEntityName,
        trunkPair,
      );
    });
  } else {
    beltCells = cells.map((c) =>
      makeBeltCell({ x: c.x, y: c.y }, c.dir, opts.beltEntityName, trunkPair),
    );
  }

  // 2) 상자측 인서터. chest -- seat -- trunkStart 가 일직선(2칸). f = chest→trunkStart.
  //    supply 피더: 상자에서 집어(−f) belt 에 놓음.
  //    collect 리시버: 트렁크에서 집어(+f) 상자에 넣음 (픽업 반전).
  let feeder: PlacedCell | null = null;
  if (start) {
    const f = {
      x: Math.sign(start.x - path.chestCell.x),
      y: Math.sign(start.y - path.chestCell.y),
    };
    const seat = { x: path.chestCell.x + f.x, y: path.chestCell.y + f.y };
    const pickup = collect ? { x: f.x, y: f.y } : { x: -f.x, y: -f.y };
    feeder = makeInserterCell(seat, pickup, opts.inserterEntityName, trunkPair);
  }

  // 3) 머신별 탭 인서터. supply: 트렁크에서 집어(+faceVector) 머신에 넣음.
  //    collect: 머신에서 집어(−faceVector) 트렁크에 놓음 (픽업 반전). reach 로 prototype.
  //    단, role='sink'(멀티싱크 버스의 소비자 부모)는 트렁크 모드와 무관하게 belt 에서
  //    집어(+faceVector) 머신에 넣는다 — collect belt 도중에서 아이템을 내리는 소비자.
  const taps: TrunkTapEmission[] = path.covered.map((t) => {
    const v = faceVector(t.face);
    const pickup = collect && t.role !== 'sink' ? { x: -v.x, y: -v.y } : v;
    const name = t.reach >= 2 ? opts.longInserterEntityName : opts.inserterEntityName;
    const pair = synthPair(trunkConsumerId, t.machineId);
    return {
      machineId: t.machineId,
      reach: t.reach,
      role: t.role,
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
