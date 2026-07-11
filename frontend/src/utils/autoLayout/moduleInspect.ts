/**
 * moduleInspect — 적용된 레이아웃(routingEditSession)에서 "모듈"(자족 클러스터)
 * 단위 정보를 유도하는 단일 출처.
 *
 * 모듈 식별 키 = 머신 id 에서 `-m{index}` 접미사를 뗀 나머지. 모듈 파이프라인이
 * 머신 id 를 `${moduleId}-m${j}` 로 생성하므로(clusterModule.generateModule) 접미사
 * 제거가 곧 클러스터 단위다. 폴백(비모듈) 머신은 접미사가 없어 머신 1개가 곧 1모듈로
 * 떨어진다(여전히 유효한 단위).
 *
 * pixi-renderer(테두리·포트 강조 렌더)와 ModuleInfoPanel(React 정보 창)이 함께 쓴다.
 */

import { useLayoutStore } from "../../store/layoutStore";
import type { ModulePortMeta } from "../autoLayout/containerModel";

export interface ModulePortCell {
  x: number;
  y: number;
  role: "input" | "output";
  /** 반대 끝점(상자 anchor 또는 상대 모듈 포트) — 그리드 좌표. */
  peer: { x: number; y: number };
  /** 반대 끝점 컨테이너 id(상자 id 또는 상대 머신 id). */
  peerId: string;
  /** 산출 근거(planner 슬롯 + 트렁크 seed 점수). 모듈 파이프라인 외 경로는 없음. */
  meta?: ModulePortMeta;
}

export interface ModuleInfo {
  /** 모듈 식별 키(머신 id 접두사). */
  key: string;
  /** 레시피 이름(머신 recipeName). 없으면 null. */
  recipe: string | null;
  /** 머신 prototype 이름(동일 모듈 내 균일 가정). */
  machineEntityName: string | null;
  /** 머신 대수. */
  machineCount: number;
  /**
   * 모듈 영역의 외접 사각형 — 그리드 좌표(칸 단위).
   * 머신 footprint ∪ 포트 셀의 합집합. 포트(tapAnchor/링 anchor)는 머신 옆
   * 레인·링 위에 있으므로 머신 bbox 만으로는 포트가 테두리 밖으로 나간다 —
   * 합집합이 곧 "포트를 포함하는 모듈 경계". (모듈 상자는 ⑥C 재배치로 외곽까지
   * 이동할 수 있어 의도적으로 제외 — 포함하면 테두리가 레이아웃 외곽까지 부푼다.)
   */
  bbox: { x: number; y: number; w: number; h: number };
  /** 포트 셀(그리드 좌표) — 라우팅이 머신에 닿는 지점. 소비=input, 생산=output. */
  ports: ModulePortCell[];
}

/**
 * 현재 적용된 레이아웃에서 모듈별 경계·포트·머신 정보를 계산한다. 스토어 스냅샷을
 * 직접 읽어 호출 시점마다 갱신(드래그 후 origin 변경 반영). 세션이 없으면 빈 배열.
 */
export function collectModules(): ModuleInfo[] {
  const { routingEditSession } = useLayoutStore.getState();
  if (!routingEditSession) return [];

  const coox = routingEditSession.containerOriginOffset?.x ?? 0;
  const cooy = routingEditSession.containerOriginOffset?.y ?? 0;

  const byKey = new Map<string, ModuleInfo>();
  const machineKey = new Map<string, string>();

  const expandBbox = (m: ModuleInfo, gx: number, gy: number, w: number, h: number) => {
    const x1 = Math.min(m.bbox.x, gx);
    const y1 = Math.min(m.bbox.y, gy);
    const x2 = Math.max(m.bbox.x + m.bbox.w, gx + w);
    const y2 = Math.max(m.bbox.y + m.bbox.h, gy + h);
    m.bbox = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  };

  for (const c of routingEditSession.containers) {
    if (c.kind !== "machine") continue;
    const key = c.id.replace(/-m\d+$/, "");
    machineKey.set(c.id, key);

    const gx = c.origin.x + coox;
    const gy = c.origin.y + cooy;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        key,
        recipe: c.recipeName ?? null,
        machineEntityName: c.entityName,
        machineCount: 1,
        bbox: { x: gx, y: gy, w: c.size.w, h: c.size.h },
        ports: [],
      });
    } else {
      existing.machineCount++;
      expandBbox(existing, gx, gy, c.size.w, c.size.h);
    }
  }

  // 포트 셀: liveArea 라우팅의 머신 쪽 끝점. 머신이 소비자(to)면 입력, 생산자(from)면 출력.
  // 포트는 레인/링 위 셀이므로 bbox 도 함께 확장 — 포트는 항상 테두리 안(구성적 보장).
  const live = routingEditSession.liveArea;
  if (live) {
    const addPort = (
      key: string,
      cell: { x: number; y: number },
      role: "input" | "output",
      peer: { x: number; y: number },
      peerId: string,
      meta?: ModulePortMeta,
    ) => {
      const m = byKey.get(key);
      if (!m) return;
      const gx = cell.x + coox;
      const gy = cell.y + cooy;
      m.ports.push({ x: gx, y: gy, role, peer: { x: peer.x + coox, y: peer.y + cooy }, peerId, meta });
      expandBbox(m, gx, gy, 1, 1);
    };
    for (const r of live.routings) {
      const toKey = machineKey.get(r.to.containerId);
      if (toKey) addPort(toKey, r.to.cell, "input", r.from.cell, r.from.containerId, r.toPortMeta);
      const fromKey = machineKey.get(r.from.containerId);
      if (fromKey) addPort(fromKey, r.from.cell, "output", r.to.cell, r.to.containerId, r.fromPortMeta);
    }
  }

  return [...byKey.values()];
}

/** 그리드 셀 (gx,gy) 을 bbox 로 포함하는 모듈 반환(없으면 null). */
export function moduleAtCell(
  gx: number,
  gy: number,
  modules?: ModuleInfo[],
): ModuleInfo | null {
  const list = modules ?? collectModules();
  for (const m of list) {
    if (gx >= m.bbox.x && gx < m.bbox.x + m.bbox.w && gy >= m.bbox.y && gy < m.bbox.y + m.bbox.h) return m;
  }
  return null;
}
