/**
 * moduleTransform — 한 모듈(GeneratedModule)을 강체(rigid block)로 회전/반사한다.
 *
 * 단일 출처: 본 설계안(클러스터 모듈화 — 합성 단계 정렬).
 *
 * 모듈은 부모-무시로 생성되므로([clusterModule.generateModule]) 출력 포트 면이 부모
 * 반대편에 설 수 있다. 합성 단계는 본 변환으로 모듈을 통째로 돌려 포트를 부모 쪽으로
 * 맞춘다. 정사각 대칭군 D4(회전 4 × 반사 0/1 = 8가지)를 **단일 2×2 정수행렬 M** 으로
 * 처리한다 — 셀 좌표·belt/인서터 방향·포트 면·머신 footprint 가 *모두 같은 M* 으로
 * 함께 돌아가므로 belt 흐름·인서터 픽업·머신 자리가 어긋나지 않는 유효 배치를 유지한다.
 *
 * 좌표계: 화면 좌표(y 아래로 증가). 시계방향 90° = rot(x,y)=(−y,x). 반사=세로축 거울
 * mirror(x,y)=(−x,y). M = reflect ? mirror∘rot^k : rot^k.
 *
 * 순수 함수 — gameDataStore·Area 의존 없음. 결과는 머신 bbox 좌상단을 다시 (0,0)으로
 * 정규화해 generateModule 과 **같은 규약의 드롭-인 모듈**로 돌려준다(ring/cells 의
 * 음수 상대좌표는 그대로 유지).
 */

import { EntityType } from "../../types/layout";
import type { Direction } from "../../types/layout";
import type { GeneratedModule, ModulePort } from "./clusterModule";
import type { Container, PlacedCell, PortFace } from "./containerModel";
import { faceVector, vectorToDirection } from "./containerRouting";

export type Rotation = 0 | 90 | 180 | 270;

/** 모듈 방위 — 회전(시계방향) + 선택적 세로축 반사. 8가지(D4). */
export interface Orientation {
  rotation: Rotation;
  /** 세로축 거울(x→−x). 회전 *후* 적용. */
  reflect?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 행렬 적용 — 벡터/타일/방향/면
// ─────────────────────────────────────────────────────────────────────────────

/** 단위/일반 벡터에 회전^k(시계 90°) 후 반사 적용. (정수·반정수 보존.) */
function mvec(v: { x: number; y: number }, o: Orientation): { x: number; y: number } {
  let { x, y } = v;
  const k = (o.rotation / 90) % 4;
  for (let i = 0; i < k; i++) {
    const nx = -y;
    const ny = x;
    x = nx;
    y = ny;
  }
  if (o.reflect) x = -x;
  return { x, y };
}

/** 1×1 타일 인덱스 변환 — 타일 중심에 M 적용 후 −0.5(round 로 fp 흡수). */
function tileXf(x: number, y: number, o: Orientation): { x: number; y: number } {
  const m = mvec({ x: x + 0.5, y: y + 0.5 }, o);
  return { x: Math.round(m.x - 0.5), y: Math.round(m.y - 0.5) };
}

/** belt/인서터 방향(카디널) 변환. */
function dirXf(dir: Direction, o: Orientation): Direction {
  const m = mvec(vecFromDir(dir), o);
  return vectorToDirection(Math.round(m.x), Math.round(m.y));
}

/** 포트 면 변환. */
function faceXf(face: PortFace, o: Orientation): PortFace {
  const m = mvec(faceVector(face), o);
  return faceFromVec(Math.round(m.x), Math.round(m.y));
}

/** 머신/상자 footprint 변환 — 양 끝 모서리 타일을 변환해 새 origin·크기 산출. */
function footprintXf(
  origin: { x: number; y: number },
  size: { w: number; h: number },
  o: Orientation,
): { origin: { x: number; y: number }; size: { w: number; h: number } } {
  const t1 = tileXf(origin.x, origin.y, o);
  const t2 = tileXf(origin.x + size.w - 1, origin.y + size.h - 1, o);
  return {
    origin: { x: Math.min(t1.x, t2.x), y: Math.min(t1.y, t2.y) },
    size: { w: Math.abs(t1.x - t2.x) + 1, h: Math.abs(t1.y - t2.y) + 1 },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

/** 방향을 가진 엔티티 종류(이들만 dir 을 회전; 상자 등은 dir 유지). */
const DIRECTIONAL = new Set<EntityType>([
  EntityType.Belt,
  EntityType.Inserter,
  EntityType.UndergroundBelt,
]);

/**
 * 모듈을 회전/반사. 머신 bbox 좌상단을 (0,0)으로 재정규화한 새 모듈을 반환한다.
 * entityId 는 보존(고유성만 필요; 합성 단계가 재-id) — 좌표 접미사는 stale 해질 수 있음.
 */
export function transformModule(mod: GeneratedModule, o: Orientation): GeneratedModule {
  // 1) 회전/반사만 적용(정규화 전).
  const machines: Container[] = mod.machines.map((m) => {
    const fp = footprintXf(m.origin, m.size, o);
    return { ...m, origin: fp.origin, size: fp.size };
  });

  const chestById = new Map<string, Container>();
  const chests: Container[] = mod.chests.map((c) => {
    const fp = footprintXf(c.origin, c.size, o);
    const next = { ...c, origin: fp.origin, size: fp.size };
    chestById.set(next.id, next);
    return next;
  });

  const cells: PlacedCell[] = mod.cells.map((p) => {
    const t = tileXf(p.x, p.y, o);
    const cell = DIRECTIONAL.has(p.cell.entityType)
      ? { ...p.cell, direction: dirXf(p.cell.direction, o) }
      : { ...p.cell };
    return { x: t.x, y: t.y, cell };
  });

  const ring = mod.ring.map((c) => tileXf(c.x, c.y, o));

  const xfPort = (port: ModulePort): ModulePort => ({
    line: port.line,
    anchor: tileXf(port.anchor.x, port.anchor.y, o),
    face: faceXf(port.face, o),
    chest: chestById.get(port.chest.id) ?? port.chest,
  });
  const inputPorts = mod.inputPorts.map(xfPort);
  const outputPorts = mod.outputPorts.map(xfPort);

  // 2) 머신 bbox 좌상단 → (0,0) 재정규화 (ring/cells 음수 상대좌표는 유지).
  let minX = Infinity, minY = Infinity;
  for (const m of machines) {
    minX = Math.min(minX, m.origin.x);
    minY = Math.min(minY, m.origin.y);
  }
  const dx = -minX, dy = -minY;
  const shiftPt = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
  const shiftContainer = (c: Container): Container => ({ ...c, origin: shiftPt(c.origin) });

  const sMachines = machines.map(shiftContainer);
  const sChestById = new Map<string, Container>();
  const sChests = chests.map((c) => {
    const s = shiftContainer(c);
    sChestById.set(s.id, s);
    return s;
  });
  const sCells = cells.map((p) => ({ x: p.x + dx, y: p.y + dy, cell: p.cell }));
  const sRing = ring.map(shiftPt);
  const shiftPort = (port: ModulePort): ModulePort => ({
    line: port.line,
    anchor: shiftPt(port.anchor),
    face: port.face,
    chest: sChestById.get(port.chest.id) ?? shiftContainer(port.chest),
  });

  // 3) 새 머신 bbox (정규화 후 min=0).
  let w = 0, h = 0;
  for (const m of sMachines) {
    w = Math.max(w, m.origin.x + m.size.w);
    h = Math.max(h, m.origin.y + m.size.h);
  }

  return {
    machines: sMachines,
    chests: sChests,
    cells: sCells,
    ring: sRing,
    inputPorts: inputPorts.map(shiftPort),
    outputPorts: outputPorts.map(shiftPort),
    bbox: { x: 0, y: 0, w, h },
    unroutedLines: mod.unroutedLines,
  };
}

/**
 * `from` 면을 `to` 면으로 보내는 회전(반사 없음). 합성 단계가 출력 포트를 부모
 * 방향으로 맞출 때 사용. (네 면 중 하나로 항상 도달 가능.)
 */
export function rotationToFace(from: PortFace, to: PortFace): Rotation {
  const target = faceVector(to);
  for (const rotation of [0, 90, 180, 270] as Rotation[]) {
    const m = mvec(faceVector(from), { rotation });
    if (m.x === target.x && m.y === target.y) return rotation;
  }
  return 0; // 도달 불가(발생 안 함) — 방어.
}

// ─────────────────────────────────────────────────────────────────────────────
// 카디널 ↔ 벡터
// ─────────────────────────────────────────────────────────────────────────────

function vecFromDir(dir: Direction): { x: number; y: number } {
  switch (((dir % 16) + 16) % 16) {
    case 0: return { x: 0, y: -1 };
    case 4: return { x: 1, y: 0 };
    case 8: return { x: 0, y: 1 };
    case 12: return { x: -1, y: 0 };
    default: return { x: 0, y: -1 }; // 비카디널(발생 안 함) — 방어.
  }
}

function faceFromVec(x: number, y: number): PortFace {
  const faces: PortFace[] = ["N", "E", "S", "W"];
  for (const f of faces) {
    const v = faceVector(f);
    if (v.x === x && v.y === y) return f;
  }
  return "N";
}
