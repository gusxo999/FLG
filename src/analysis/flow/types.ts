/**
 * 흐름 분석의 타입 — 그리드를 **정상상태로** 풀었을 때 무엇이 나오나.
 *
 * 모델은 `docs/analysis/flow-model.md` 가 적고, 코드의 단일 출처는
 * [solve](solve.ts) 머리말이다.
 */

import type { Entity, Module, Recipe } from '../../types/gameData';

/** 벨트의 좌/우 레인 — 진행 방향 기준. 게임 레인**만** 뜻한다(`belt-lane-semantics`). */
export type LaneSide = 'left' | 'right';

export interface FlowCtx {
  entityMap: Map<string, Entity>;
  recipeMap: Map<string, Recipe>;
  moduleMap: Map<string, Module>;
  /** 위저드의 인서터 보정(entityName 키) — 계획과 **같은 저울**을 쓰려고 받는다. */
  inserterOverrides?: Record<string, { throughput?: number; stackSize?: number }>;
  /**
   * 블루프린트 **안쪽**의 bbox — `layoutStore.externalAreaBbox`(이름과 달리 내부 영역이다).
   * 무한상자가 이 안에 있으면 **밖과 못 잇는 상자**다(`flow-model` §2.6 고아 상자).
   * 없으면(손으로 만든 그리드) 모든 무한상자를 바깥 포트로 본다.
   */
  interiorBbox?: { x: number; y: number; w: number; h: number } | null;
}

/**
 * 판정 불가 사유.
 *
 *  - `no-recipe` — 레시피가 없거나 게임데이터에 없다
 *  - `kind`      — 레시피 모델 밖의 변환기(연구실·채굴기)
 *  - `yield`     — 범위 산출물의 기대 수율을 모른다
 *  - `scale`     — 그 머신이 닿는 팔·벨트에 저울(회전 속도·벨트 속도)이 없는 프로토타입이 있다
 *  - `fluid`     — 유체를 쓰는데 게임데이터가 유체 상자의 연결을 말해 주지 않는다
 *
 * 앞의 둘은 **율을 아예 모른다**. 뒤의 셋은 **낙관적으로 가정하고 푼다** — 그래서 그 가정
 * 아래서도 모자라면 미달은 확정이고, 모자라지 않을 때만 판정 불가가 된다.
 */
export type UnknownReason = 'no-recipe' | 'kind' | 'yield' | 'scale' | 'fluid';

export type MachineState = 'full' | 'short' | 'unknown';

/**
 * 이 머신의 포트 하나가 **바깥과 안 이어졌다** — 그 상자가 블루프린트 안쪽에 갇혀 있다(고아 상자).
 * 가동률과 **다른 축**이다: 갇힌 상자는 게임에서 무한상자로 돌아 머신이 100% 로 보이지만,
 * 사용자는 그 포트에 아무것도 연결할 수 없다 → 그 머신은 실패다(`flow-model` §2.6).
 */
export interface PortFailure {
  /** `output` = 산출을 못 내보낸다(반출 실패) · `input` = 재료가 안 들어온다(공급 실패). */
  role: 'input' | 'output';
  /** 갇힌 상자의 칸. */
  chest: { x: number; y: number };
  /** 그 상자가 맡던 품목(설정에서). */
  items: string[];
}

/** 머신 하나의 판정. 좌표는 origin 칸(그리드 좌표). */
export interface MachineVerdict {
  entityId: string | null;
  entityName: string | null;
  recipe: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  state: MachineState;
  /** 가동률 0..1. 율을 모르는 판정 불가(`no-recipe`·`kind`)면 NaN. */
  u: number;
  /** 정격 제작 수/초(모듈 반영). 모르면 NaN. */
  craftsPerSec: number;
  /** 재료마다 — 100% 로 돌려 할 때 **받을 수 있는 양**과 정격 필요량(/s). `fluid` 면 유체. */
  inputs: { item: string; got: number; need: number; fluid?: true }[];
  /** 산출마다 — 100% 로 돌려 할 때 **내보낼 수 있는 양**과 정격 생산량(/s). `fluid` 면 유체. */
  outputs: { item: string; sent: number; made: number; fluid?: true }[];
  /**
   * 가장 모자란 한 줄 — 화면의 "왜". `u < 1` 일 때만.
   * `by`: `arms` = 그 머신 팔의 처리량이 모자란다 · `belt` = 벨트(나 상대)가 안 준다/안 받는다 ·
   * `pipe` = 유체 관망이 안 준다/안 받는다(닿은 관망이 없으면 그것도 여기다).
   */
  limit?: { side: 'input' | 'output'; item: string; by: 'arms' | 'belt' | 'pipe' };
  /** 판정 불가 사유 전부(`state === 'unknown'` 일 때 비어 있지 않다). */
  unknown: UnknownReason[];
  /** 율을 모르는 머신(`no-recipe`·`kind`)과 벨트·직결을 공유한다 — 그 가정 위의 판정이다. */
  assumed: boolean;
  /** 밖과 안 이어진 포트 — 있으면 **가동률과 무관하게 실패다**(`PortFailure`). */
  portFail: PortFailure[];
  /**
   * 고정점에 못 닿은 풀이에서 **마지막 되풀이에도 `us`·`ud` 가 움직였다** — 이 머신의 `u` 는 되풀이를
   * 어디서 멈췄느냐에 달렸다(2026-09-25 실측: 200회와 201회에서 머신 7대의 판정이 갈렸다).
   */
  unsettled?: true;
}

/**
 * 흐름이 **못 건너는** 그리드 사실 — 풀이는 이것을 조용히 건너뛰므로 판정에는 결과(0)만 남는다.
 * 미달의 까닭(`limit`)은 *"벨트가 덜 준다"* 까지만 말하고, 이것이 **어디서 끊겼나**를 짚는다.
 */
export interface FlowBreaks {
  /** 집는 칸이나 놓는 칸에 벨트·머신·상자가 없는 인서터. 그래프에 안 들어간다. */
  deadArms: {
    x: number;
    y: number;
    name: string;
    entityId: string | null;
    /** 안 닿은 끝 — 그 칸과 거기 있는 것(`Empty` 면 빈 칸). */
    ends: { end: 'pick' | 'drop'; x: number; y: number; found: string }[];
  }[];
  /** 앞 칸의 벨트류가 **반대 방향**이라 아이템이 안 건너간다. 서로를 가리키므로 쌍 하나로 센다. */
  headOn: { a: { x: number; y: number; entityId: string | null }; b: { x: number; y: number; entityId: string | null } }[];
}

/** 벨트 칸 한 레인의 정상상태 흐름. */
export interface LaneFlow {
  /** 이 칸을 지나는 초당 개수(품목 합). */
  rate: number;
  items: { item: string; rate: number }[];
  /** 레인 용량(/s). 저울이 없으면 Infinity. */
  capacity: number;
  saturated: boolean;
}

/** 벨트 칸에 닿는 인서터 하나 — 이 칸에서 넣나(drop) 집나(pick). */
export interface BeltTap {
  x: number;
  y: number;
  kind: 'drop' | 'pick';
  inserterName: string;
  /** 반대편(머신·상자) 이름. 없으면 null. */
  peerName: string | null;
  /** 정상상태에서 실제로 옮기는 양(/s). */
  rate: number;
  /** 넣으려 했으나 **하류가 안 가져가서** 못 넣은 양(/s) — 정체. drop 만. */
  refused: number;
  /** drop 이 떨어지는 레인. pick 은 두 레인 다 집으므로 없다. */
  side?: LaneSide;
  items: string[];
}

export interface BeltCellFlow {
  x: number;
  y: number;
  lanes: Record<LaneSide, LaneFlow>;
  taps: BeltTap[];
  /** 한 레인에 두 품목 이상 — 정상상태가 못 보는 막힘 위험(`flow-model` §5). */
  mixedLane: boolean;
}

export interface FlowSummary {
  total: number;
  full: number;
  short: number;
  unknown: number;
  /** 포트가 밖과 안 이어진 머신 수 — `full`·`short`·`unknown` 과 **겹쳐 센다**(다른 축이다). */
  failed: number;
}

/** 블루프린트 안쪽에 갇힌 무한상자 — 밖에서 아무것도 못 잇는다. */
export interface OrphanChest {
  x: number;
  y: number;
  items: string[];
  /** 설정상 역할 — 공급(`supply`) · 회수(`sink`) · 둘 다. */
  role: 'supply' | 'sink' | 'both';
}

export interface FlowResult {
  /** origin 좌표 순(y, x). */
  machines: MachineVerdict[];
  /** 키 `"x,y"` = 벨트류 칸. */
  belts: Map<string, BeltCellFlow>;
  summary: FlowSummary;
  /** 고정점에 닿았나. false 면 화면은 **근사**로 표시한다. */
  converged: boolean;
  iterations: number;
  breaks: FlowBreaks;
  /** 블루프린트 안쪽에 갇힌 무한상자 — 그 포트는 밖과 안 이어졌다. */
  orphanChests: OrphanChest[];
}
