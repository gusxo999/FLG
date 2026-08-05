/**
 * pipeFlow — **파이프 합류 가드**. "이 칸에 이 유체의 파이프를 놓으면, 놓으면 안 될 것과
 * 이어져 버린다"는 칸의 지도를 만든다.
 *
 * 단일 출처: docs/auto-layout-wizard.trunk-pipe.md · docs/fluid-box-semantics.md ·
 * 용어사전 §C(`PipeFlow` / `collectPipeFlow`).
 *
 * ## 벨트 가드([collectBeltFlow])와 뭐가 다른가 — 두 가지
 *
 * **1. 파이프는 방향이 없다 — 단, 지하파이프는 있다.** 벨트는 흐르는 쪽이 있어서 합류가
 * **비대칭**이다(내 출력이 남의 벨트 칸으로 떨어질 때만 섞인다). 지상 파이프는 **닿기만
 * 하면** 두 관망이 하나가 된다 — 직교로 이웃한 두 지상 파이프는 무조건 이어진다. 그래서
 * "흘려보내는 칸"(`sinkTargets`) 같은 개념이 없고, 남의 지상 파이프 **네 이웃 칸 전부**가
 * 금지 칸이다.
 *
 * **지하파이프만 예외다.** 표면에서 `direction` **한 면으로만** 연결된다
 * ([makeUndergroundPipeCell](cellBuilder.ts)) — 옆면은 벽이다. 이 사실을 가드가 몰라
 * 네 이웃을 다 막던 시절엔 물리보다 보수적이라, **한 면에 유체 두 줄**이 서는 배치를
 * 전부 거절했다(→ trunk-pipe.md §5.2). 정정 후에는 두 자리가 열린다:
 *
 *  - `u₁`(유체1 상자 칸) 과 `u₀`(유체0 상자 칸) — 세로 이웃. 둘 다 표면이 **머신 쪽**만 본다.
 *  - `T₁`(유체1 탭) 과 `C₀`(유체0 ClusterPipe) — 가로 이웃. `T₁` 의 표면은 **바깥**만 본다.
 *
 * 그래서 금지 칸이 **칸이 아니라 (칸, 연결 방향)** 이다. 지상 파이프는 사방을 다 보므로
 * 옛 답과 같고([blockedTilesHard] 가 그 답이다), 지하파이프만 자기 방향으로 좁혀 묻는다.
 *
 * **2. 파이프 처리량은 무한이다.** 벨트는 두 스트림이 합쳐지면 서로 용량을 깎아먹지만,
 * 유체는 그렇지 않다. **같은 유체끼리 합쳐지는 건 게임에서도 우리 모델에서도 손해가 없다.**
 * 그래서 이 가드가 막는 건 오직 **다른 유체**다(사용자 결정, 2026-07-13). 같은 유체의 파이프는
 * 아예 금지 칸에 넣지 않는다.
 *
 * ## 막는 건 두 종류다 — 남의 파이프, 그리고 남의 머신 유체 상자
 *
 * 파이프는 **머신 벽 아무 데나** 붙는 게 아니다. 프로토타입이 정한 **유체 상자의 연결 칸**
 * (머신 바로 바깥의 그 한 칸)에 파이프를 놓을 때만 머신과 이어진다. 그 칸이 어디인지는
 * 좌표가 아니라 `PipeConnection.direction` 이 알려준다([resolveFluidConnection]).
 *
 * 그 연결 칸을 잘못 밟으면 **화면상으로는 멀쩡한데** 물류가 조용히 망가진다:
 *  - 남의 머신 **유체 출력 상자**를 밟으면 → 그 머신의 생산물이 내 관망으로 **새어나간다**.
 *  - 남의 머신 **유체 입력 상자**를 밟으면 → 엄밀히는 안전하다(머신이 스스로 필터링해 필요한
 *    유체만 가져간다). 다만 안 밟는 편이 더 좋은 배치다.
 *
 * 그래서 금지 칸이 **두 등급**이다(이름의 Hard/Soft = 규칙의 **강도**):
 *  - `blockedTilesHard` — 어길 수 없다. 남의(=다른 유체) 파이프 + 그 이웃(지상이면 넷, 지하면
 *    자기 `direction` 쪽 하나), 그리고 **다른 유체를 내는 유체 출력 상자**의 연결 칸
 *    (같은 유체 출력은 소스라 허용 — 아래 참고).
 *  - `blockedTilesSoft` — 어겨도 물류는 안 망가진다. 이 유체를 안 받는 **유체 입력 상자**의
 *    연결 칸. **상황이 열악하면 풀어도 되는 규칙**이지만 **푸는 기준은 아직 안 정했다** →
 *    v1 은 hard 와 똑같이 지킨다(거절은 항상 안전하다 — 옛 경로로 폴백할 뿐이다).
 *    풀고 싶으면 [pipeFlowConflict] 에 `soft: false` 를 주면 된다.
 *
 * ## 유체 출력 상자 — 같은 유체는 소스라 허용, 다른 유체만 막는다 (2026-07-15 정정)
 * 유체를 **반출/납품 경로**하는 줄(머신 유체 출력 상자 → ClusterPipe → 무한파이프)은 자기 머신의
 * 유체 출력 상자에 **닿아야 한다** — 그게 유체를 걷어가는 지점이다. 그래서 유체 출력 상자를 "무조건" 막으면
 * 유체 출력이 자기 소스에서 거절당한다. 정정: **이 유체를 내는 유체 출력 상자는 허용**(소스, 같은
 * 유체 병합은 무해 — 위 원칙 2), **다른 유체를 내는 유체 출력 상자만 hard**(그 생산물이 새기 때문).
 * `recipeFluids.products` 가 그 유체 상자가 내는 유체를 알려준다([boxFluidNames]). (docs/auto-layout-wizard.fluid-delivery.md)
 *
 * ## 미구현 — `joinableTile`
 * 용어사전에 예고된 셋째 필드. "같은 유체면 **이미 깔린 관을 타고 간다**"는 **반대 용도**라
 * 가드가 아니라 **모듈 간 유체 공급 공유**(무한파이프 하나로 N 모듈)를 설계할 때 넣는다.
 * 가드는 Hard/Soft 두 맵으로 완결되므로 지금은 존재하지 않는다.
 *
 * 순수 — store 를 안 본다. 호출자가 게임데이터를 읽어 넘긴다.
 */

import type { Entity } from "../../UI/store/gameDataStore";
import type { Direction } from "../../types/layout";
import { cellKey } from "./helper";
import { fluidPortSlots } from "../module/fluidPorts";

/**
 * 파이프 한 줄(유체 하나)을 깔기 전에 "여기엔 놓으면 안 된다"고 알려주는 칸의 지도.
 * **유체 이름마다 다르다** — 같은 유체는 닿아도 되기 때문이다. 그래서 [collectPipeFlow] 는
 * 깔려는 유체 이름을 받는다.
 */
export interface PipeFlow {
  /**
   * 어길 수 없는 금지 칸(cellKey) — **사방으로 연결하는 지상 파이프 기준**. 다른 유체 파이프
   * + 그 네 이웃, **다른 유체의** 유체 출력 상자. 경로 탐색(`fluidBlocked`)이 읽는 보수적 지도다.
   */
  blockedTilesHard: Set<string>;
  /** 풀 수 있는 금지 칸(cellKey). 이 유체를 안 받는 **유체 입력 상자** — 머신이 스스로 거른다. */
  blockedTilesSoft: Set<string>;
  /**
   * 칸 → **그 칸의 파이프가 이 방향으로 연결하면** 남의 관망에 붙는 방향들.
   *
   * 위 두 집합의 낟알을 쪼갠 것이라 **키 집합이 서로 같다** — 지상 파이프는 사방을 다 보므로
   * 어느 방향이 걸리든 결국 걸리고, 그래서 옛 답과 정확히 같다. 다른 답이 나오는 건
   * **지하파이프**뿐이다(자기 `direction` 한 방향만 묻는다).
   */
  hardDirs: Map<string, Set<Direction>>;
  softDirs: Map<string, Set<Direction>>;
}

/** 이미 놓인 파이프류 셀 하나(일반 파이프 · 무한파이프 · 지하파이프). 어떤 유체를 나르는지 알아야 한다. */
export interface PipeFlowPipe {
  x: number;
  y: number;
  /** 이 관이 나르는 유체 이름. 깔려는 유체와 **같으면 막지 않는다**. */
  fluid: string;
  /**
   * 지하파이프면 그 **지상 연결 방향**(= `GridCell.direction` — 지상 입구가 향하는 쪽).
   * 미지정이면 지상 파이프로 본다 — 사방으로 이어진다.
   */
  connectDir?: Direction;
}

/** 레시피의 유체 한 줄 — 유체 상자가 **어떤 이름을 받는지** 정하는 데 쓴다. */
export interface PipeFlowRecipeFluid {
  name: string;
  /**
   * 이 유체가 그 역할(입력/출력)의 **몇 번째** 유체 상자로 들어가는지. **1-based**.
   * 없으면(=미지정) 그 유체는 해당 역할의 유체 상자 **전부**에 들어갈 수 있다.
   * → docs/fluid-box-semantics.md
   */
  fluidbox_index?: number;
}

/** 이미 놓인 유체 머신 하나. 유체 상자가 없는 머신(조립기 등)은 넘겨도 아무 칸도 안 만든다. */
export interface PipeFlowMachine {
  origin: { x: number; y: number };
  size: { w: number; h: number };
  /** 머신 회전. 유체 상자가 **어느 면**에 오는지를 이게 바꾼다. */
  direction: Direction;
  /** 프로토타입 — `fluid_boxes` 를 본다. */
  entity: Entity;
  /** 이 머신이 돌리는 레시피의 유체만. 유체 상자가 받는 이름은 프로토타입이 아니라 여기서 나온다. */
  recipeFluids: { ingredients: PipeFlowRecipeFluid[]; products: PipeFlowRecipeFluid[] };
}

export interface PipeFlowInput {
  /** 지금 깔려는 파이프가 나르는 유체. 이 유체와 **다른** 것만 막는다. */
  fluidName: string;
  /** 이미 놓인 파이프류 셀 전부. */
  pipes: readonly PipeFlowPipe[];
  /** 이미 놓인 머신 전부(자기가 이으려는 머신은 호출자가 알아서 뺀다 — 머리말 참고). */
  machines: readonly PipeFlowMachine[];
}

/** 직교 이웃 4방향 — 그 방향으로 가는 화살표와 짝. 파이프는 **여기 닿기만 하면** 이어진다. */
const NEIGHBORS: { x: number; y: number; dir: Direction }[] = [
  { x: 0, y: -1, dir: 0 },
  { x: 1, y: 0, dir: 4 },
  { x: 0, y: 1, dir: 8 },
  { x: -1, y: 0, dir: 12 },
];

/** 반대 방향(직각 넷만). 이웃 칸이 **나를 향해** 연결하는 방향이다. */
const opposite = (d: Direction): Direction => (((d + 8) % 16) as Direction);

/** 사방 — "방향과 무관하게 막힌다"(겹칠 수 없는 칸 · 남의 머신 유체 상자). */
const ALL_DIRS: Direction[] = [0, 4, 8, 12];

/** 이 유체의 파이프를 깔 때 밟으면 안 되는 칸들. */
export function collectPipeFlow(input: PipeFlowInput): PipeFlow {
  const hardDirs = new Map<string, Set<Direction>>();
  const softDirs = new Map<string, Set<Direction>>();
  const block = (m: Map<string, Set<Direction>>, k: string, dirs: readonly Direction[]): void => {
    const set = m.get(k) ?? new Set<Direction>();
    for (const d of dirs) set.add(d);
    m.set(k, set);
  };

  // ── 남의 파이프 ────────────────────────────────────────────────────────────
  // 셀 자신은 **방향 무관**(겹칠 수 없다). 이웃 칸은 **나를 향하는 한 방향**만 막는다 —
  // 그 방향으로 연결하는 파이프만 실제로 붙기 때문이다. 이웃을 네 방향 다 막으면
  // 지하파이프의 옆면까지 막혀 물리보다 보수적이 된다(머리말).
  //
  // 남의 파이프가 **지하파이프**면 자기 `connectDir` 한 이웃만 상대한다 — 나머지 세 면은
  // 벽이라 아무것도 안 막는다. 같은 유체면 아예 안 막는다(닿아도 무해).
  for (const p of input.pipes) {
    if (p.fluid === input.fluidName) continue;
    block(hardDirs, cellKey(p.x, p.y), ALL_DIRS);
    const faces = p.connectDir === undefined ? NEIGHBORS : NEIGHBORS.filter((n) => n.dir === p.connectDir);
    for (const n of faces) block(hardDirs, cellKey(p.x + n.x, p.y + n.y), [opposite(n.dir)]);
  }

  // ── 머신 유체 상자 — 그 유체 상자의 **연결 칸 하나**만. 머신 벽 전체가 아니다. ──
  // 여기는 방향 무관으로 둔다(정정 대상은 지하파이프뿐이다) — 유체 상자 칸에 서는 것은 그
  // 상자에 붙으려는 파이프뿐이라, 방향으로 빠져나갈 자리가 애초에 없다.
  for (const m of input.machines) {
    for (const slot of fluidPortSlots(m.entity, m.size, m.direction)) {
      const at = connectionCell(m, slot.face, slot.offset);
      const isOutput = slot.productionType === "output" || slot.productionType === "input-output";
      if (isOutput) {
        // 유체 출력 상자: **이 유체를 내는** 유체 상자는 이 관망의 **소스**다 — 걷어가려면 닿아야 한다
        // (같은 유체 병합은 무해, 파이프 처리량 무한). 다른 유체(또는 이 레시피가 안 내는
        // 유체)를 내는 유체 상자만 hard — 그 생산물이 내 관망으로 새기 때문이다.
        const produces = boxFluidNames(m, slot.boxIndex, "output", slot.filter);
        if (!produces.has(input.fluidName)) block(hardDirs, cellKey(at.x, at.y), ALL_DIRS);
        continue;
      }
      if (slot.productionType !== "input") continue; // "none" 등 — 파이프가 안 붙는다.
      const accepts = boxFluidNames(m, slot.boxIndex, "input", slot.filter);
      if (accepts.has(input.fluidName)) continue; // 같은 유체 — 닿아도 무해(오히려 이게 정상 연결).
      block(softDirs, cellKey(at.x, at.y), ALL_DIRS);
    }
  }

  // 같은 칸이 두 등급에 다 걸리면 강한 쪽만 남긴다(검사 결과가 등급에 안 흔들리게).
  for (const k of hardDirs.keys()) softDirs.delete(k);
  return {
    blockedTilesHard: new Set(hardDirs.keys()),
    blockedTilesSoft: new Set(softDirs.keys()),
    hardDirs,
    softDirs,
  };
}

/**
 * 깔려는 파이프 경로가 금지 칸을 밟는 **첫 칸**을 돌려준다(없으면 null).
 *
 * 파이프는 **자기가 밟는 칸**만 보면 된다 — 이웃까지 넓히는 일은 [collectPipeFlow] 가
 * 이미 지도 쪽에서 해 뒀다(남의 지상 파이프 네 이웃이 금지 칸이다).
 *
 * **깔려는 칸이 지하파이프면 `connectDir` 을 준다** — 그 한 방향으로만 묻는다. 안 주면
 * 지상 파이프로 보고 사방을 묻는다(옛 답과 같다). 물리가 대칭이라 **양쪽 다** 방향을 봐야
 * 한다: 지도만 고치면 `T₁` 이 옆의 `C₀`(지상) 헤일로에 걸려 여전히 거절된다(머리말).
 *
 * @param soft `false` 면 `blockedTilesSoft` 를 무시한다 — **소프트 가드 해제**. 해제 기준은
 *   아직 안 정했으므로 기본은 지킨다(사용자 결정 유보, 2026-07-13).
 */
export function pipeFlowConflict(
  cells: readonly { x: number; y: number; connectDir?: Direction }[],
  flow: PipeFlow,
  soft = true,
): { cell: { x: number; y: number }; rule: "hard" | "soft" } | null {
  const hits = (m: Map<string, Set<Direction>>, k: string, dir: Direction | undefined): boolean => {
    const blocked = m.get(k);
    if (!blocked) return false;
    return dir === undefined ? true : blocked.has(dir);
  };
  for (const c of cells) {
    const k = cellKey(c.x, c.y);
    if (hits(flow.hardDirs, k, c.connectDir)) return { cell: c, rule: "hard" };
    if (soft && hits(flow.softDirs, k, c.connectDir)) return { cell: c, rule: "soft" };
  }
  return null;
}

/** 유체 상자의 연결 칸 = 머신 **바로 바깥** 한 칸. 면 위 위치는 `offset` 이 정한다. */
function connectionCell(
  m: PipeFlowMachine,
  face: "N" | "E" | "S" | "W",
  offset: number,
): { x: number; y: number } {
  const { origin, size } = m;
  switch (face) {
    case "N": return { x: origin.x + offset, y: origin.y - 1 };
    case "S": return { x: origin.x + offset, y: origin.y + size.h };
    case "W": return { x: origin.x - 1, y: origin.y + offset };
    case "E": return { x: origin.x + size.w, y: origin.y + offset };
  }
}

/**
 * 유체 상자 하나가 **받는 유체 이름들**. 하나가 아니라 **집합**이다.
 *
 * 왜 집합인가: 화학 공장은 유체 입력 상자가 2개인데 `plastic-bar` 는 유체 재료가 1개(석유 가스)뿐이다.
 * 그런데 게임에선 **양쪽 유체 상자 아무 데나** 석유 가스를 넣어도 된다. 이유는 레시피의
 * `fluidbox_index` 가 **미지정**이기 때문이다 — 미지정이면 그 유체는 **그 역할의 유체 상자 전부**에
 * 들어간다(개발자 확인). 지정돼 있으면 그 번호의 유체 상자 **하나**에만 들어간다.
 *
 * 번호는 **그 역할 안에서 1-based** 로 센다(입력끼리 1,2… / 출력끼리 1,2…). 유체 상자의 등장
 * 순서는 프로토타입 정의 순서다(`FluidBoxInfo.index`).
 * → docs/fluid-box-semantics.md
 *
 * `filter` 가 박힌 유체 상자(보일러의 물 칸 등)는 레시피와 무관하게 그 유체 하나만 받는다.
 */
function boxFluidNames(
  m: PipeFlowMachine,
  boxIndex: number,
  role: "input" | "output",
  filter?: string,
): Set<string> {
  if (filter) return new Set([filter]);

  // 이 유체 상자가 같은 역할의 유체 상자들 중 **몇 번째**인가(1-based).
  const boxes = m.entity.fluid_boxes ?? [];
  let ordinal = 0;
  for (let i = 0; i <= boxIndex && i < boxes.length; i++) {
    const pt = boxes[i].production_type;
    if (pt === role || pt === "input-output") ordinal += 1;
  }

  const fluids = role === "input" ? m.recipeFluids.ingredients : m.recipeFluids.products;
  const names = new Set<string>();
  for (const f of fluids) {
    // 미지정 → 이 역할의 유체 상자 **전부**에 들어갈 수 있다. 지정 → 그 번호의 유체 상자에만.
    if (!f.fluidbox_index || f.fluidbox_index === ordinal) names.add(f.name);
  }
  return names;
}
