/**
 * BuildSpec — **우리에게 주어진 것.** "무엇으로 지을 수 있고, 그것이 얼마나 멀리·얼마나
 * 빨리 할 수 있는가."
 *
 * 단일 출처: docs/용어사전.md §H `BuildSpec`.
 *
 * 두 출처가 합쳐진 한 덩어리다:
 *  - 사용자가 위저드에서 **고른 엔티티들**의 이름(벨트·인서터·파이프·지하벨트·지하파이프).
 *  - 그 엔티티들의 **게임데이터 능력치**(인서터의 reach 와 초당 처리량, 지하 변형의 최대
 *    점프 거리).
 *
 * ## 이게 무엇이 *아닌지* — 이름이 비슷한 것들과 헷갈리기 쉽다
 *  - **`debugFlags` 가 아니다.** 저건 우리가 켜고 끄는 손잡이다. BuildSpec 은 **주어진 것**이라
 *    우리가 못 바꾼다. 배치 중에 안 변한다(읽기 전용).
 *  - **OS 환경 변수가 아니다.** `process.env` 와는 아무 관계가 없다.
 *  - **라우팅 옵션이 아니다.** 탐색과 무관하다 — 다익스트라든 예약(장부)이든 똑같이 이걸 본다.
 *    (옛 경로의 `RouteOptions` 는 BuildSpec 을 **확장**해 탐색 전용 필드를 얹은 것이다.)
 *
 * ## 왜 중요한가
 * 배치가 무언가를 **거절할 때 그 근거가 대개 여기서 나온다** — "지하 점프 거리가 0이다",
 * "reach 1 인서터밖에 없다", "인서터 하나로 이 수요를 못 받는다". 프로토타입 이름과 능력치를
 * 코드 곳곳에 하드코딩하지 않고 **여기 한 곳**에서만 읽는다.
 */

import type { Entity, GameDataLookup } from "../types/gameData";
import type { ContainerWizardInput } from "./containerModel";
import { inserterReach, inserterThroughput } from "./inserterThroughput";
import { beltThroughput, laneCapOfTier } from "./beltThroughput";

/** 사용자가 고른 인서터 하나 — 이름 + 게임데이터에서 뽑은 능력치. */
export interface SpecInserter {
  entityName: string;
  /**
   * 집기 거리(`inserter_pickup_position` 에서 산출). 일반=1, 긴팔=2.
   *
   * **[ClusterBeltDepth](../../../docs/용어사전.md) 를 이게 정한다** — reach `r` 인 인서터는
   * 좌석(depth 1)에 앉아 depth `1 + r` 의 벨트를 집는다. 그래서 한 면에 세울 수 있는
   * [ClusterBelt] 의 수는 **고른 인서터들의 서로 다른 reach 값의 개수**다. 하드코딩이 아니다.
   */
  reach: number;
  /** 초당 처리량(items/sec). 사용자 override 반영. */
  throughput: number;
}

/** 사용자가 고른 벨트 하나 — 이름 + 게임데이터에서 뽑은 초당 운반량. */
export interface SpecBelt {
  entityName: string;
  /** 초당 운반량(items/sec). 사용자 override 반영. */
  throughput: number;
}

/**
 * 사용자가 고른 **지하벨트 하나** — 이름 · 저울(초당 운반량) · 사거리.
 *
 * 이름만 나르지 않는 이유는 [SpecBelt] 와 같다(*"이름과 저울은 함께 온다"* — 2026-08-24).
 * 여기선 저울이 **가장 느린 것을 고르는 기준**이고(종착은 나르는 일이 없으니 싼 것이 낫다),
 * 사거리는 **장부에 적을 값**이다 — 짝 없는 입구도 그만큼을 예약해야 남이 그 구간에 출구를
 * 세워 **터널이 뚫려 버리는** 일이 없다([resolveBeltTermini](./execution/module/beltTerminus.ts)).
 */
export interface SpecUndergroundBelt {
  entityName: string;
  /** 초당 운반량(items/sec) — 느린 것을 고르는 저울. */
  throughput: number;
  /** `max_underground_distance` — 입/출구 좌표 차이 상한(= 예약할 사거리). */
  maxDistance: number;
}

export interface BuildSpec {
  /** 주 벨트(첫 선택 또는 지정). 벨트를 하나만 묻는 옛 소비처용. */
  beltEntityName: string;
  /**
   * 고른 벨트 **전부** — throughput 내림차순, 같은 처리량은 하나만.
   * [determineBeltCount](./beltThroughput.ts) 가 수요를 이 티어들로 나눠 덮는다:
   * 빠른 것부터 채우고 **나머지는 그 나머지를 감당하는 가장 싼(느린) 벨트**로.
   */
  belts: SpecBelt[];
  /**
   * 기본 인서터 = **reach 1 중 가장 빠른 것**(2026-07-23 사장님 규칙 1).
   *
   * 좌석은 거의 전부 d1 에 앉아 d2 를 집으므로 후보가 reach 1 뿐이고, 그중 느린 걸 놓을
   * 이유가 없다. 예전엔 `primaryInserter ?? selectedInserters[0]` 이었는데 `primaryInserter`
   * 를 **채우는 코드가 아무 데도 없어서** 실제로는 "사용자가 고른 순서상 첫 번째"가 놓이고
   * 있었다 — 의도가 아니라 우연이다. 그 필드는 타입 선언만 남아 있다가 2026-07-23 삭제됐다.
   *
   * **이 값과 [inserters] 의 reach-1 항목은 반드시 같은 엔티티여야 한다.** 세는 쪽은
   * `inserters` 의 처리량을 읽고 놓는 쪽은 이 이름을 쓰므로, 둘이 어긋나면 세는 값과 놓는
   * 팔이 달라진다. 빠르게 세면 팔이 모자라 **조용히 굶는다**(2026-07-23 분석).
   */
  inserterEntityName: string;
  /**
   * 고른 인서터 **전부** — reach 오름차순, 같은 reach 는 처리량 높은 것 하나만 남긴다.
   * 같은 reach 두 종류는 **같은 자리를 두고 다투므로** 벨트를 한 줄 더 세워주지 못한다.
   */
  inserters: SpecInserter[];
  /**
   * 긴팔(reach≥2) 인서터 — 고른 것 중 첫 하나. 없으면 undefined.
   * `inserters` 의 부분집합이지만, 옛 경로와 케이스 B 가 "긴팔 하나"만 물어서 남겨 둔다.
   */
  longInserter?: { entityName: string; reach: number };
  pipeEntityName: string;
  undergroundPipeEntityName?: string;
  undergroundBeltEntityName?: string;
  /**
   * 고른 지하벨트 **전부** — 처리량 **오름차순**(느린 것부터). 사거리·처리량을 게임데이터에서
   * 확인한 것만 담는다(둘 중 하나라도 없으면 뺀다 — 지어내지 않는다).
   *
   * `undergroundBeltEntityName` 과 자리가 다르다: 저쪽은 **납품 경로가 점프에 쓸 하나**이고,
   * 이쪽은 **고를 수 있는 전부**다(벨트가 `beltEntityName` ↔ `belts` 로 갈린 것과 같은 축).
   */
  undergroundBelts: SpecUndergroundBelt[];
  /** 지하파이프 입출구 좌표 차이 한계. undefined / 0 이면 **점프 비활성**. */
  pipeMaxUndergroundDistance?: number;
  /** 지하벨트 입출구 좌표 차이 한계. undefined / 0 이면 **점프 비활성**. */
  beltMaxUndergroundDistance?: number;
  /** 기본 인서터의 사용자 처리량/묶음 보정. */
  inserterOverride?: { throughput?: number; stackSize?: number };
}

/**
 * 위저드 입력 + 게임데이터 → BuildSpec.
 *
 * 점프 비활성(= maxDistance 0) 조건: 지하 변형을 하나도 안 골랐거나, 고른 엔티티가
 * 프로토타입 사전에 없거나, `max_underground_distance` 가 0/미정.
 */
/**
 * **팔 개수의 유일한 출처** — 머신 한 대의 한 줄을 이 인서터로 먹이려면 팔이 몇 개인가.
 *
 * `⌈머신당 수요 ÷ 그 인서터의 처리량⌉`. **인서터가 인자인 것이 핵심이다**(계획서 §16):
 * 팔 속도는 스칼라가 아니라 *어느 인서터를 쓰느냐*의 함수이고, 어느 인서터를 쓰느냐는
 * **벨트를 어느 칸에 두느냐**로 정해진다(`reach` 는 최대치가 아니라 **고정 거리**라
 * reach `r` 인서터는 `1+r` 칸만 집는다 — 다른 칸은 아예 못 집는다).
 *
 * 예전엔 이 자리에 `tapCapacity(inserters)` 라는 **스칼라**가 있었고 값이 *"reach 1 중 가장
 * 빠른 것"* 이었다. 그 전제(*"좌석에는 reach 1 만 앉는다"*)를 다중 깊이 탭이 깨뜨렸는데,
 * 세는 쪽만 옛 전제에 남아 **깊은 벨트를 쓰는 줄이 조용히 굶었다**(`docs/auto-layout/module/module-planning.md §4.5`).
 * 실측 모드팩에서 fast 10/s 대 long-handed 1.2/s — **8배**.
 *
 * **"출처는 하나"는 그대로다.** 바뀐 것은 그 출처가 **스칼라에서 함수로** 넓어진 것뿐이다.
 * 세는 쪽(팔 개수·그릇·머신 대수)과 놓는 쪽(`emitModule`)이 같은 인서터를 본다.
 *
 * 수요나 처리량을 모르면 `undefined` — 지어내지 않는다.
 */
export function armsFor(
  ratePerMachine: number | undefined,
  inserter: SpecInserter | undefined,
): number | undefined {
  if (ratePerMachine === undefined || !Number.isFinite(ratePerMachine)) return undefined;
  if (!inserter || !(inserter.throughput > 0)) return undefined;
  return Math.max(1, Math.ceil(ratePerMachine / inserter.throughput - EPS_ARMS));
}

/** 부동소수 여유 — 수요가 처리량의 정확한 배수일 때 팔이 하나 더 붙는 것을 막는다. */
const EPS_ARMS = 1e-9;

/**
 * **면 좌석의 유일한 출처** — 머신 한 대의 **한 면**에 팔을 몇 개까지 앉힐 수 있나.
 *
 * [armsFor] 의 짝이다: 저쪽이 *"몇 개가 필요한가"*, 이쪽이 *"몇 개가 들어가는가"*.
 * 면의 `d1` 칸이 그것뿐이라 물리로 정해진다 — 협상 대상이 아니다.
 *
 * ```
 * faceSeatArms = 면의 길이 방향 칸 수 − 그 면에서 파이프가 먹은 칸 수
 * ```
 *
 * **왜 한 곳이어야 하나.** 예전엔 같은 사실을 셋이 각자 셌다 —
 * 붓기([edgeLinkGroups])는 `max(1, h)`(유체를 안 뺀다), 면 배정([tryLinkFace])은
 * `h − 유체 행`, 외부 줄 조립([externalLineGroups])은 **아예 안 셌다.** 그래서 붓기가
 * *"여기 8개 들어간다"* 며 만든 줄이 배정에서 자리를 못 찾아 통째로 사라지는 일이 났다
 * (2026-08-22 `linkMismatches`). 셋이 같은 자를 쓰면 그 어긋남은 생길 자리가 없다.
 *
 * **`fluidRows` 가 인자인 것이 요점이다.** 줄을 *만드는* 때는 그 줄이 어느 면에 앉을지
 * 모르므로 유체 칸 수를 알 수 없다 — 그래서 붓기는 `0` 을 넘긴다(**상속된 낙관**이고,
 * 그 사실이 주석이 아니라 **호출부의 인자**로 드러난다). 좁힐지는
 * `tempPlanDocs/배선-형태/judgements.md` **J2** — 착수 조건은 계측 수치다.
 *
 * `max(1, …)` 는 붓기가 쓰던 방어를 그대로 가져온 것이다(면이 0칸인 머신은 없다).
 */
export function faceSeatArms(machineFaceCells: number, fluidRows: number): number {
  return Math.max(1, machineFaceCells) - fluidRows;
}

/**
 * `reach` 로 인서터를 찾는다 — **벨트 칸이 인서터를 지목하는 지점**.
 *
 * `clusterBeltDepth = 1 + reach` 이므로 깊이를 알면 reach 를 알고, reach 를 알면 인서터가
 * 하나로 정해진다([makeBuildSpec] 이 reach 마다 가장 빠른 것 하나씩만 남긴다).
 */
export function inserterForReach(
  inserters: ReadonlyArray<SpecInserter>,
  reach: number | undefined,
): SpecInserter | undefined {
  if (reach === undefined) return undefined;
  // reach 별 최댓값을 직접 고른다 — [makeBuildSpec] 이 이미 그렇게 주지만, 거르지 않은
  // 목록을 받았을 때 조용히 느린 답(= 팔이 과다해지는 쪽)을 내지 않도록 전제를 안 믿는다.
  let best: SpecInserter | undefined;
  for (const i of inserters) {
    if (i.reach !== reach) continue;
    if (!best || i.throughput > best.throughput) best = i;
  }
  return best;
}

export function makeBuildSpec(input: ContainerWizardInput, gameData: GameDataLookup): BuildSpec {
  const { entityMap } = gameData;
  // 고른 벨트 전부 → 처리량 내림차순. 같은 처리량이 둘이면 하나만(자리를 두고 다툴 뿐
  // 더 나르지 못한다 — 인서터를 reach 별로 하나만 남기는 것과 같은 이유).
  const byThroughput = new Map<number, SpecBelt>();
  for (const entityName of input.selectedBelts) {
    const throughput = beltThroughput(entityMap.get(entityName));
    if (throughput <= 0) continue; // 데이터 없음 — 지어내지 않는다.
    if (!byThroughput.has(throughput)) byThroughput.set(throughput, { entityName, throughput });
  }
  const belts = [...byThroughput.values()].sort((a, b) => b.throughput - a.throughput);

  // **팔 하나가 실을 수 있는 양의 상한 `B`** — 가장 빠른 벨트의 **레인 하나**.
  //
  // 줄 전체가 아니라 레인인 이유: 인서터는 **먼 레인 하나에만** 떨군다
  // (`docs/factorio/belt-lane-semantics.md` ①). 팔 하나가 아무리 빨라도 그 레인보다 많이
  // 실을 수 없다. 벨트를 하나도 안 골랐으면 상한이 없다(0) — 지어내지 않는다.
  const beltCeiling = laneCapOfTier(belts[0]);

  /**
   * **기본 벨트 — 이름과 저울은 함께 온다**(2026-08-24 사장님 확정).
   *
   * 예전엔 `input.primaryBelt ?? input.selectedBelts[0] ?? "transport-belt"` 였다. 세 번째
   * 항이 **지어낸 이름**이고, 앞의 둘도 처리량을 확인하지 않은 원본 선택이라 *"이름은 아는데
   * 저울은 없는"* 상태를 만들 수 있었다. 그 상태가 아래층까지 내려가 폴백을 불렀다.
   * 이제는 **처리량이 확인된 `belts` 안에서만** 고른다 — 불변식: `beltEntityName ∈ belts`.
   *
   * 하나도 없으면 빈 문자열이고, 그 스펙으로는 아무것도 못 짓는다 —
   * `runModulePipeline` 이 진입에서 거절한다(옛 경로는 애초에 이 값을 안 쓴다).
   */
  const beltEntityName =
    belts.find((b) => b.entityName === input.primaryBelt)?.entityName ?? belts[0]?.entityName ?? "";

  // 고른 인서터 전부 → reach 별로 **가장 빠른 것 하나씩**. reach 가 같으면 두 인서터가
  // 같은 depth 의 벨트를 집으므로 벨트를 한 줄 더 세워주지 못한다 — 더 빠른 쪽만 쓴다.
  //
  // **처리량은 `B` 에서 접는다**(2026-08-22 사장님 확정, 용어사전 §D "배선 형태 셋" 물리 2):
  // *팔 하나가 벨트 한 줄보다 많이 나를 수는 없다.* 접는 자리가 여기 **하나**여서
  // 소비처(armsFor·maxInsertersPerBelt·requiredInserterCount)는 아무것도 안 바꿔도 된다.
  // 안 접으면 `그릇 = floor(벨트 ÷ 인서터)` 가 1로 접혀 벨트가 텅 빈 채로 깔리고,
  // *"인서터 처리량 무한"* 같은 입력이 링크를 통째로 0으로 만든다(2026-08-21 battery 실측).
  const byReach = new Map<number, SpecInserter>();
  for (const entityName of input.selectedInserters) {
    const entity = entityMap.get(entityName);
    const reach = inserterReach(entity);
    if (reach < 1) continue;
    const raw = inserterThroughput(entity, input.inserterOverrides?.[entityName]);
    const throughput = beltCeiling > 0 ? Math.min(raw, beltCeiling) : raw;
    const cur = byReach.get(reach);
    if (!cur || throughput > cur.throughput) byReach.set(reach, { entityName, reach, throughput });
  }
  const inserters = [...byReach.values()].sort((a, b) => a.reach - b.reach);
  const long = inserters.find((i) => i.reach >= 2);
  // **기본 좌석 인서터 = reach 1.** 계획이 인서터를 지목하지 못한 배정(수량 미상 등)의
  // 폴백일 뿐이다 — 실제로 놓는 팔은 [PlannedLine.reach] 가 정한다([inserterForReach]).
  // reach 1 을 하나도 안 골랐으면 옛 폴백(첫 선택)으로.
  // **같은 규칙** — 처리량이 확인된 `inserters` 안에서만 고른다(불변식: ∈ inserters).
  // reach 1 이 없으면 가장 짧은 것. 목록이 비면 빈 문자열이고, 진입에서 거절된다.
  const inserterEntityName =
    inserterForReach(inserters, 1)?.entityName ?? inserters[0]?.entityName ?? "";

  const undergroundPipeEntityName = input.selectedUndergroundPipes[0];
  const undergroundBeltEntityName = input.selectedUndergroundBelts[0];

  // 고른 지하벨트 전부 → **느린 것부터**. 종착([resolveBeltTermini])이 가장 느린 것을 쓴다:
  // 종착은 아무것도 나르지 않으니 빠른 티어를 태울 이유가 없다(사용자 규칙 2026-09-06).
  // 처리량이나 사거리를 모르는 것은 **뺀다** — 사거리를 모르면 장부에 적을 값이 없고,
  // 값을 지어내면 남의 출구가 그 안에 서서 터널이 조용히 뚫린다.
  const undergroundBelts: SpecUndergroundBelt[] = [];
  for (const entityName of input.selectedUndergroundBelts) {
    const entity = entityMap.get(entityName);
    const throughput = beltThroughput(entity);
    const maxDistance = entity?.max_underground_distance ?? 0;
    if (throughput <= 0 || maxDistance <= 0) continue;
    undergroundBelts.push({ entityName, throughput, maxDistance });
  }
  undergroundBelts.sort((a, b) => a.throughput - b.throughput);

  return {
    beltEntityName,
    belts,
    inserterEntityName,
    inserters,
    longInserter: long ? { entityName: long.entityName, reach: long.reach } : undefined,
    pipeEntityName: "pipe",
    undergroundPipeEntityName,
    undergroundBeltEntityName,
    undergroundBelts,
    pipeMaxUndergroundDistance: undergroundPipeEntityName
      ? pipeUndergroundDistance(entityMap.get(undergroundPipeEntityName))
      : 0,
    beltMaxUndergroundDistance: undergroundBeltEntityName
      ? (entityMap.get(undergroundBeltEntityName)?.max_underground_distance ?? 0)
      : 0,
    inserterOverride: input.inserterOverrides?.[inserterEntityName],
  };
}

/**
 * pipe-to-ground 의 지하 거리. Factorio 2.0 은 connection 별로 거리를 두지만
 * (`fluid_boxes[].connections[].max_underground_distance`), 최상위
 * `Entity.max_underground_distance` 도 호환용으로 채워진다. connection 우선.
 */
function pipeUndergroundDistance(entity: Entity | undefined): number {
  if (!entity) return 0;
  for (const fb of entity.fluid_boxes ?? []) {
    for (const c of fb.connections ?? []) {
      if (c.connection_type === "underground" && c.max_underground_distance) {
        return c.max_underground_distance;
      }
    }
  }
  return entity.max_underground_distance ?? 0;
}
