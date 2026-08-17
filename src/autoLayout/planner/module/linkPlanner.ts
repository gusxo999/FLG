/**
 * 링크 면 배정 — **모듈 안쪽 계획**. 좌표를 모른다.
 *
 * 자식↔부모를 잇는 링크가 **어느 면에 · 몇 팔로 · 몇 칸 바깥 줄에** 앉을지 정한다.
 * 기계 좌표가 정해지기 **전에** 돌아야 한다 — gap 폭이 여기서 나오고, 그 폭이 다시
 * 기계 좌표를 정하기 때문이다(닭과 달걀을 푸는 지점).
 *
 * ```
 * 면 배정(여기, 좌표 없음) → gap 폭 → layoutCluster → 기계 좌표 → 좌석 좌표 입히기
 * ```
 *
 * 그래서 이 파일은 **팔 개수만** 본다. `Container` 도 `machines[]` 도 받지 않는다.
 *
 * 장부 두 권을 쓴다(둘은 서로 유도되지 않는다):
 *  - `used`(좌석) — **팔마다** 하나. 면이 찼는지 판단
 *  - `faceGroups`(그룹 수) — **그룹마다** 하나. 막힌 면의 벨트 깊이 순번
 *
 * **셋째 장부는 없다.** 예전엔 `generateModule` 이 좌표 단계에서 `placeLedger` 라는 빈 장부를
 * 새로 만들어 **여기서 이미 센 누적값을 처음부터 다시 셌다**. 배정이 알던 값을 계층 경계
 * 너머로 전하지 못해 생긴 중복이었다 — 이제 [commitLinkFace] 가 그 순번을
 * [LinkFacePlan.slotIndex] 에 실어 보내므로, 좌표 단계는 **덧셈만** 한다.
 */

import type { PortFace } from "../../containerModel";
import type { MachineLinkGroup } from "../../module/machineLinkGroup";
import type { PlannedSide } from "./clusterPortPlanner";

export interface LinkFacePlan {
  /** W/E = 머신 옆면(세로 벨트) · N/S = gap(가로 벨트). */
  face: PortFace;
  /** N/S 일 때 가로 벨트를 놓을 gap index — 머신 `gap` 과 `gap+1` 사이. */
  gap?: number;
  /**
   * 이 그룹의 벨트가 앉을 **면에서의 깊이**([faceCell] 의 `d`). 좌석은 언제나 d1 이므로
   * 이 값이 곧 **이 그룹이 면 바깥으로 먹는 줄 수**다 — gap 폭이 여기서 나온다
   * ([gapRowsFromPlans])**이자** 방출기가 벨트를 놓는 깊이다([emitOutputLinks]).
   * 두 곳이 같은 필드를 보므로 폭과 기하가 어긋날 수 없다.
   */
  laneDepth: number;
  /**
   * **반출 깊이 — gap 전용.**
   *
   * W/E 면에서는 빠져나가는 방향이 면과 **수직**이라, 벨트가 자기 좌석 구간만 덮고 끝에서
   * 꺾으면 그만이다(그래서 여러 그룹이 같은 깊이를 나눠 쓴다). gap 은 다르다 — 나가는 쪽
   * (부모=서쪽)이 면과 **평행**이라 모든 벨트가 서쪽 변까지 달려야 하고, 같은 줄 두 벨트는
   * 반드시 합쳐진다.
   *
   * 그래서 이 면의 **n 번째 그룹은 한 칸 더 깊은 줄로 내려가서** 달린다. 내려가는 건
   * **벨트가 벨트를 먹이는 것**이라 팔 길이와 무관하다 — 팔은 `laneDepth`(수집 줄)까지만
   * 닿으면 된다. 첫 그룹은 `laneDepth` 와 같다(내려갈 것도 없이 이미 서쪽 변에서 시작).
   */
  exitDepth?: number;
  /** 이 그룹이 쓰는 머신 index → 팔 수. */
  arms: Map<number, number>;
  /**
   * **포트가 기둥 끝에 선다** — 관통(g=N) 그룹만 갖는다. `undefined` = 옆(면 바깥).
   *
   * 방향은 취향이 아니라 **`g` 가 정한다**(2026-08-17):
   *
   * ```
   * 관통 (g = N)   벨트가 기둥 전체 → 포트는 **기둥 끝**.  건널 것이 없다
   * 구간 (g < N)   벨트가 일부     → 포트는 **옆**.  그 면에 관통이 없어야 성립
   * ```
   *
   * 왜 갈리나 — 상자에 바깥에서 닿으려면 **그보다 깊은 레인들을 가로질러야** 하는데,
   * W/E 면의 레인은 세로줄이라 **관통 레인은 어떤 행에서도 못 건넌다.** 포트를 옆에 두면
   * 그 면의 깊은 관통이 자기 상자를 가둔다(2026-08-17 실측: `planned = 0` · 완제품 상자가
   * 갇힘 · R-도달 위반). 기둥 끝에 두면 상자가 기둥 **밖**이라 면 깊이와 무관해진다.
   *
   * **옛 탭 기하가 이것이었다** — 유산이 아니라 관통의 올바른 기하였고, 아이템 방출을 한
   * 경로로 합치면서(§19-④) 함께 지워졌다.
   *
   * 끝은 면마다 **둘**(N·S)뿐이다. 세 번째 관통은 못 받아 옆으로 물러난다.
   */
  portEnd?: "N" | "S";
  /**
   * 머신 index → 이 그룹이 그 머신 면에서 쓰는 **머신 원점 기준 상대 칸 번호**들(오름차순).
   * 키 순서는 머신 index 오름차순이다(방출 순서가 결정적이어야 하므로).
   *
   * **좌표가 아니다 — 순번이다.** "면에서 몇 번째 칸"까지가 배정의 일이라 여기서 끝내고,
   * 남는 일은 `m.origin.x`(또는 `.y`)를 **더하는 것뿐**이다([placeLinkSeats]).
   * 그래서 이 필드가 있으면 planner 가 진짜 단일 주체가 된다 — 좌표를 모르면서도
   * 자리를 완결한다.
   *
   * gap 면(N/S)의 입력 그룹은 **동쪽 끝에서부터** 센다: 막힌 면의 [[ParallelBelt]]는
   * "포트에 가까운 그룹이 얕은 줄"이라야 성립하는데, 입력의 포트는 동쪽이기 때문이다.
   * 그 뒤집기까지 여기서 끝내므로 좌표 단계는 방향을 알 필요가 없다(`fromEast` 같은
   * 플래그를 밖으로 내보내지 않는다).
   */
  slotIndex: Map<number, number[]>;
}

/** [commitLinkFace] 전의 배정안 — 순번(`slotIndex`)은 확정 시점에야 정해진다. */
type LinkFaceCandidate = Omit<LinkFacePlan, "slotIndex">;

/**
 * 링크 그룹 하나가 실제로 앉은 자리 — 면 + 머신마다 쓰는 **면 위 위치** `t`.
 * `t` 는 [faceCell] 과 같은 뜻이다: W/E 면이면 y(행), N/S 면이면 x(열).
 */
export interface LinkSeats extends LinkFacePlan {
  /** 머신 index → 그 머신 면에서 이 그룹이 쓰는 연속 `t` 값들. */
  slots: Map<number, number[]>;
}

/** 좌석 장부의 열쇠 — 머신 하나의 한 면. 면마다 예산이 따로다(`machine.h` 행). */
export function seatKey(machineIndex: number, face: PortFace): string {
  return `${machineIndex}:${face}`;
}

/**
 * **한 모듈의 면 배정이 공유하는 것** — 장부 두 권 + 머신 모양 + 유체가 가져간 면.
 *
 * 예전엔 이 넷이 함수마다 낱개 인자로 늘어서 있었다. 배정에 참여하는 주체가 링크 하나뿐일
 * 땐 견딜 만했는데, 원료·완제품 줄까지 같은 배분기를 타면 호출이 늘어 **인자 순서를 틀리기
 * 쉬운 모양**이 된다. 장부는 호출들 사이에 이어져야 하는 상태라 한 덩어리로 다니는 게 맞다.
 */
export interface LinkFaceContext {
  machine: { w: number; h: number };
  count: number;
  /** 좌석(팔) 장부 — `${머신index}:${면}` → 이미 쓴 칸 수. */
  used: Map<string, number>;
  /** 그룹 수 장부 — 막힌 면의 반출 줄 깊이 순번([LinkFacePlan.exitDepth]). */
  faceGroups: Map<string, number>;
  /**
   * **트렁크 파이프가 붙는 면**(W/E) — 그 면의 **유체 상자 행 번호**와 점프 여부.
   *
   * 파이프는 유체 상자 칸 하나만 먹고 지하로 벨트를 넘어 바깥 [ClusterPipe] 로 나간다
   * → 좌석 줄이 **거의 다 살아 있다.** `rows` 만 건너뛰고 앉는다(예산은
   * `machine.h − rows.length`, 순번 remap 은 [commitLinkFace]).
   *
   * `laneCap` 은 **그 면의 레인 깊이 상한** — 지하파이프 사거리가 정한다([laneDepthCap]).
   * 얕으면 깊은 레인이 잘려 그만큼 그룹이 다른 면으로 넘어간다.
   *
   * (예전엔 *"점프 불가"* 갈래가 있어 그 면을 통째로 거절했고, 탭 경로만 **케이스 B** 로
   * 살아남았다. 2026-08-16 그 경우가 도달 불가능해져 둘 다 삭제됐다 — `docs/.../trunk-pipe.md`.)
   *
   * **유체 면에 앉아도 되는 근거는 [linkFaceDepths] 다.** 예전엔 면을 통째로 비켜 줬는데,
   * 이유는 `buildTrunkContext.beltMaxOn` 이 여기서 배정한 줄을 못 봐서 파이프가 벨트 위로
   * 지나가는 배치가 조용히 나오기 때문이었다. 이제 그 값이 링크 깊이를 함께 세므로
   * **링크가 앉는 행위 자체가 `pipeJumpMode` 조건 ①(`beltMaxOn > 0`)을 켠다** — 계획의
   * 전제가 스스로 참이 된다.
   */
  pipeFaces?: ReadonlyMap<PortFace, { rows: readonly number[]; laneCap: number }>;
  /**
   * **레인 장부** — `${면}|${깊이}` → 그 레인에서 이미 먹은 **행 범위**들(닫힌 구간, 서로소).
   *
   * 왜 셋째 장부가 필요한가 — **관통 트렁크가 레인을 통째로 먹기 때문**이다. 벨트는 연속이라야
   * 아이템이 흐르므로(계획서 §3 조건 ⑤) 그룹의 벨트는 *[첫 좌석 행 .. 마지막 좌석 행]* 을 통으로
   * 덮는다. 머신 하나만 맡는 구간이면 그게 몇 행이라 **다른 구간이 남은 행을 쓴다**. 머신 여럿을
   * 맡으면 그 사이 행이 전부 딸려 들어와 **그 면의 그 깊이가 통째로 없어진다.**
   *
   * 좌석 장부(`used`)로는 이 사실이 안 잡힌다 — 관통 그룹은 머신마다 좌석을 *하나씩만* 쓰므로
   * 좌석은 넉넉한데 벨트가 지나갈 자리가 없는 상태가 된다. 그래서 별개다.
   */
  lanes: Map<string, Array<readonly [number, number]>>;
  /** 기둥 끝 장부 — `${면}` → 이미 쓴 끝들([LinkFacePlan.portEnd]). 면마다 N·S 둘뿐이다. */
  ends: Map<PortFace, Set<"N" | "S">>;
  /**
   * 쓸 수 있는 팔의 종류 — **그 면의 레인 목록이 여기서 나온다**([laneDepthsOf]).
   * reach `r` 인 팔은 d`r+1` 을 집으므로 reach 종류 수 = 레인 수다. 비면 d2 하나로 본다.
   */
  inserters?: readonly { reach: number }[];
}

/**
 * **면의 레인 목록** — reach 종류에서 유도된다. 깊이는 고르는 값이 아니라 *결과*다(계획서 §16):
 * `d2` 가 관통에 먹혔으면 다음 줄은 `d3` 이고, **그러니 그 줄의 팔이 긴팔이 된다.**
 * 거꾸로 *"긴팔을 쓸까"* 를 먼저 정하는 코드는 없다.
 */
function laneDepthsOf(ctx: LinkFaceContext, face: PortFace): number[] {
  const reaches = [...new Set((ctx.inserters ?? []).map((i) => i.reach))]
    .filter((r) => Number.isFinite(r) && r >= 1)
    .sort((a, b) => a - b);
  const all = reaches.length ? reaches.map((r) => r + 1) : [LINK_LANE_DEPTH];
  // **파이프가 먼저다** — 유체 면의 레인 깊이는 지하파이프가 넘을 수 있는 데까지다.
  const cap = ctx.pipeFaces?.get(face)?.laneCap ?? Infinity;
  return all.filter((d) => d <= cap);
}

/**
 * 이 그룹의 벨트가 면에서 먹을 **행 범위** — 연속이라 `[최소, 최대]` 하나로 족하다.
 *
 * 좌표가 아니라 **모듈 안 순번**이다: `머신index × h + 면에서의 칸`. 머신 사이 gap 을 안 세지만
 * 사상이 **단조**라 "두 범위가 겹치나"는 실제와 같은 답을 준다 — 배정이 아는 것은 그것뿐이면 된다.
 *
 * `used` 를 읽으므로 **장부를 늘리기 전에** 불러야 한다([commitLinkFace] 가 맨 앞에서 부른다).
 */
function beltRowSpan(
  ctx: LinkFaceContext,
  face: PortFace,
  arms: Map<number, number>,
): readonly [number, number] {
  const remap = skipFluidRows(ctx.pipeFaces?.get(face)?.rows);
  let lo = Infinity;
  let hi = -Infinity;
  for (const [mi, k] of arms) {
    const base = ctx.used.get(seatKey(mi, face)) ?? 0;
    const origin = mi * ctx.machine.h;
    lo = Math.min(lo, origin + remap(base));
    hi = Math.max(hi, origin + remap(base + k - 1));
  }
  return [lo, hi];
}

/**
 * 유체 상자 행을 건너뛰는 **논리 순번 → 실제 행** 사상. `emitTapInserting` 의 `remapRow` 와
 * **같은 산술**이다(둘이 갈리면 계획이 배정한 칸과 방출이 놓는 칸이 어긋난다).
 *
 * 링크 쪽은 이 사상을 **계획에서** 적용해 [LinkFacePlan.slotIndex] 에 실제 행을 담는다 —
 * 방출기는 원점을 더하기만 하면 된다([placeLinkSeats]).
 */
function skipFluidRows(rows: readonly number[] | undefined): (r: number) => number {
  if (!rows?.length) return (r) => r;
  const sorted = [...rows].sort((a, b) => a - b);
  return (r) => {
    let v = r;
    for (const s of sorted) if (v >= s) v += 1;
    return v;
  };
}

/**
 * 그룹이 머신마다 몇 팔을 쓰나. `side` 는 이 그룹을 **어느 쪽 관점**에서 보나다 —
 * "from"(출력, 자식 머신 하나 고정) 이면 항목이 하나뿐이고, "to"(입력, 부모 머신 여럿)
 * 이면 `taps` 를 그대로 목적지별로 편다.
 */
function armsByMachine(group: MachineLinkGroup, side: "from" | "to"): Map<number, number> {
  // 구조가 대칭이라 그냥 그쪽을 본다([MachineLinkGroup] — 2026-07-23 정의 확장 전에는
  // fromMachine(스칼라)과 taps(배열)를 각각 풀어 Map 으로 만들어야 했다).
  return group[side];
}

/**
 * 링크 벨트의 기본 깊이 — 좌석(d1) 바로 바깥. v1 은 그룹마다 이 한 줄뿐이다
 * (레인 늘리기 = 긴팔로 d≥3 을 집는 것은 후속).
 */
const LINK_LANE_DEPTH = 2;

/**
 * 그룹 하나를 이 면에 앉혀 본다 — **장부는 안 건드린다**(확정은 호출자가 한다).
 * 그룹이 여러 머신을 관통하면(입력 트렁크) **전부** 들어가야 성공이다 — 벨트 하나를 반만
 * 옮길 수는 없다.
 *
 * 면마다 한계가 **좌석 수 하나**다(2026-07-22). 예전엔 좌석과 별개로 **depth(레인)** 도
 * 다퉜다 — 벨트가 면을 따라 끝까지 달렸기 때문에 같은 depth 두 줄이 반드시 부딪혔고, 그래서
 * 한 면의 줄 수가 팔 길이 종류 수에 묶였다. 이제 벨트는 **자기 좌석 구간만 덮고 끝에서 포트
 * 쪽으로 꺾으므로**([emitOutputLinks]) 행 구간이 안 겹치는 그룹끼리는 **같은 depth 를 그냥
 * 나눠 쓴다.** 다툴 게 없으니 장부도 없다.
 *
 *  - **W/E**: 머신 옆면의 d1 칸 = `machine.h` 개. 여러 그룹이 행을 나눠 쓴다.
 *  - **N/S(gap)**: 머신 위/아래 면의 d1 칸 = `machine.w` 개. v1 은 **면당 그룹 하나**
 *    (가로 벨트 한 줄만 깐다). 그리고 그 방향에 **gap 이 실제로 있어야** 한다: 맨 위 머신에
 *    N gap 은 없고, 맨 아래 머신에 S gap 은 없다.
 */
function tryLinkFace(
  ctx: LinkFaceContext,
  group: MachineLinkGroup,
  side: "from" | "to",
  face: PortFace,
  allowPipeFace = false,
): LinkFaceCandidate | undefined {
  const { machine, count, used, faceGroups } = ctx;
  // **유체 면은 마지막 수단이다.** 여기 앉는 순간 `beltMaxOn > 0` 이 되어 파이프가 점프하고
  // ([linkFaceDepths] → `pipeJumpMode` 조건 ①) [ClusterPipe] 가 우리 포트 끝(d`laneDepth+2`)
  // **밖으로** 물러나 그 면이 여러 칸 넓어진다. 갈 곳이 있으면 그쪽이 낫다 — *"없는 위험 때문에
  // 폭을 낭비하지 않는다"* 는 `pipeJumpMode` 의 원칙과 같은 이유이고, 그 이름으로 잠긴 테스트가
  // trunkPipe.test.ts 에 있다. 그래서 선호 단계([allocateLinkFaces])는 비켜 가고,
  // 넘침 단계([spillLinkFacesToGap])만 쓴다.
  //
  // (점프 불가 면을 통째로 거절하던 가드는 **케이스 B 와 함께 사라졌다** — 2026-08-16.
  // 지금 유체 면을 다르게 만드는 것은 `laneCap` 하나뿐이다.)
  //
  // **다만 회피는 더 싼 곳이 있을 때만이다**(2026-08-16). 반대 면도 유체 면이면 어디에 앉든
  // +3 으로 **동률**이고, 동률에서 자기 역할 면을 버리면 포트가 반대편에 서서 납품 경로만
  // 길어진다(황산 꼴: 물 입력 E + 황산 출력 W — 아이템이 갈 비유체 면이 없다).
  const pf = face === "W" || face === "E" ? ctx.pipeFaces?.get(face) : undefined;
  const opposite: PortFace = face === "W" ? "E" : "W";
  if (pf && !allowPipeFace && !ctx.pipeFaces?.has(opposite)) return undefined;
  const arms = armsByMachine(group, side);
  for (const mi of arms.keys()) if (mi < 0 || mi >= count) return undefined;
  if (face === "N" || face === "S") {
    // **gap(가로) 벨트는 아직 머신 하나만 맡는다.** 가로 줄 하나가 위·아래 두 대를 먹이는 것은
    // 별개 능력이고(좌석이 gap 양쪽에 하나씩 앉아야 한다), 그 전엔 조용히 겹치는 대신
    // **정직하게 자리 없음**으로 떨어뜨린다.
    if (arms.size !== 1) return undefined;
    const [mi, k] = [...arms][0];
    // **클러스터 양 끝은 gap 이 아니라 바깥이다.** 맨 위 머신의 N, 맨 아래 머신의 S 에는
    // 이웃이 없어 벨트가 모듈 밖으로 나간다 — 그래서 `gap` 이 `undefined` 이고, 벌릴 gap 도
    // 없다([gapRowsFromPlans] 가 안 센다). 자리는 그냥 **바깥으로 자란다**: 모듈이 차지하는
    // 범위는 `moduleExtent`(머신 ∪ 모든 셀)라 배치가 이 셀들을 이미 셈에 넣는다.
    const g = face === "S" ? mi : mi - 1;
    const gap = g >= 0 && g < count - 1 ? g : undefined;
    const base = used.get(seatKey(mi, face)) ?? 0;
    if (base + k > machine.w) return undefined; // 이 면의 좌석(열)이 다 찼다
    // **[[ParallelBelt]] — 막힌 면** — 이 면의 몇 번째 그룹인가가 곧 자기 줄의 깊이다
    // (탐색 없이 순번으로 결정. 줄이 달라야 두 벨트가 **합류하지 않는다**).
    // 좌석 수가 아니라 **그룹 수**로 세는 이유: 서쪽으로 달리는 줄은 그룹마다 하나씩이지
    // 팔마다 하나가 아니다. 첫 그룹은 서쪽 변에서 시작하므로 내려갈 필요가 없다.
    const nth = faceGroups.get(seatKey(mi, face)) ?? 0;
    return { face, gap, arms, laneDepth: LINK_LANE_DEPTH, exitDepth: LINK_LANE_DEPTH + nth };
  }

  // 점프 유체 면은 유체 상자 행을 [fluidboxPipeCell] 이 먹는다 → 그만큼 좌석이 준다.
  // (`planClusterPorts.seatRowsOf` 의 `base − fluidRows` 와 같은 셈이다.)
  const seatRows = machine.h - (pf?.rows.length ?? 0);
  for (const [mi, k] of arms) {
    if ((used.get(seatKey(mi, face)) ?? 0) + k > seatRows) return undefined;
  }
  // **머신 여럿을 맡는 그룹이 여기서 통과한다**(2026-08-16 — 계획서 §19).
  //
  // 예전엔 `arms.size !== 1` 로 통째로 거절했다. 사유는 *"관통하는 순간 다른 그룹과 depth 를
  // 다퉈야 한다"* 였는데, **그 다툼은 관통일 때만 있다**: 나가는 방향이 면과 수직이라 벨트가
  // **자기 좌석 구간만** 덮고 끝에서 꺾으므로([LinkFacePlan.laneDepth] 머리말), 행이 안 겹치는
  // 그룹끼리는 같은 깊이를 **나눠 쓴다.** 첫 칸이 언제나 포트 쪽으로 꺾여 행이 붙어도 두 벨트가
  // 이어지지 않는다([emitOutputLinks] ①).
  //
  // 그래서 자원이 둘이다 — **좌석 행**(바로 위, 머신마다)과 **레인 × 행**(아래, 면마다).
  // 관통 그룹은 사이 행까지 통으로 먹으므로 레인 하나를 통째로 청구하는 셈이 된다.
  const span = beltRowSpan(ctx, face, arms);
  // **관통이면 기둥 끝을 청구한다**([LinkFacePlan.portEnd]). 못 받으면 옆으로 — 그때는
  // 이 면의 깊은 관통이 상자를 가둘 수 있지만, 자리가 없는 것은 정직하게 그대로 둔다.
  const spanning = arms.size === count && count > 1;
  const endsTaken = ctx.ends.get(face);
  const portEnd = spanning
    ? (["N", "S"] as const).find((e) => !endsTaken?.has(e))
    : undefined;
  for (const laneDepth of laneDepthsOf(ctx, face)) {
    const taken = ctx.lanes.get(`${face}|${laneDepth}`);
    if (taken?.some(([a, b]) => span[0] <= b && a <= span[1])) continue;
    return { face, arms, laneDepth, portEnd };
  }
  // 이 면의 레인이 다 찼다 — 넘침 단계가 다른 면을 준다([spillLinkFacesToGap]).
  return undefined;
}

/**
 * [tryLinkFace] 가 낸 배정을 장부에 확정한다 — 좌석(팔 수)과 그룹 수를 따로 센다.
 * 둘은 유도가 안 된다: 좌석은 **팔마다** 하나, 반출 줄은 **그룹마다** 하나다.
 *
 * **여기서 순번([LinkFacePlan.slotIndex])도 함께 낸다.** 장부를 늘리기 직전의 값(`base`)이
 * 곧 "이 그룹이 몇 번째 칸부터 쓰나" 이므로, 확정과 순번은 **같은 순간의 같은 사실**이다.
 * 나눠 두면 나중 단계가 같은 누적을 다시 세야 한다(옛 `placeLedger`).
 */
function commitLinkFace(
  ctx: LinkFaceContext,
  cand: LinkFaceCandidate,
  side: "from" | "to",
): LinkFacePlan {
  const { machine, used, faceGroups } = ctx;
  const isGap = cand.face === "N" || cand.face === "S";
  // **좌석 장부를 늘리기 전에** 잰다 — [beltRowSpan] 이 `used` 를 읽어 시작 행을 안다.
  const span = isGap ? undefined : beltRowSpan(ctx, cand.face, cand.arms);
  // gap 면의 좌석은 **포트 쪽부터** 채운다 — 출력 포트는 서쪽, 입력 포트는 동쪽이다.
  // (W/E 면은 나가는 쪽이 면과 수직이라 이 순서와 무관하다 — 늘 위→아래.)
  const fromEast = isGap && side === "to";
  // **유체 상자 행을 여기서 건너뛴다.** 장부(`used`)는 논리 칸을 세고, 순번은 실제 행으로
  // 나간다 — 그래야 방출기가 원점만 더하면 된다. gap 면은 유체가 없어 항등이다.
  const remap = skipFluidRows(isGap ? undefined : ctx.pipeFaces?.get(cand.face)?.rows);
  const slotIndex = new Map<number, number[]>();
  // 머신 index 오름차순 — 방출 순서가 결정적이어야 한다.
  for (const [mi, k] of [...cand.arms].sort((a, b) => a[0] - b[0])) {
    const key = seatKey(mi, cand.face);
    const base = used.get(key) ?? 0;
    used.set(key, base + k);
    faceGroups.set(key, (faceGroups.get(key) ?? 0) + 1);
    // 면의 길이 방향 칸 수 — W/E 면은 세로(h), N/S 면은 가로(w).
    const span = isGap ? machine.w : machine.h;
    slotIndex.set(
      mi,
      fromEast
        ? Array.from({ length: k }, (_, t) => span - 1 - base - t).reverse()
        : Array.from({ length: k }, (_, t) => remap(base + t)),
    );
  }
  // 레인 장부 — gap(N/S)은 안 센다. 그쪽은 모두가 서쪽 변까지 달려야 해서 겹침을 행이 아니라
  // **반출 깊이**(`exitDepth`)로 푼다 — 자원의 모양이 아예 다르다.
  if (span) {
    const key = `${cand.face}|${cand.laneDepth}`;
    ctx.lanes.set(key, [...(ctx.lanes.get(key) ?? []), span]);
  }
  if (cand.portEnd) {
    const set = ctx.ends.get(cand.face) ?? new Set<"N" | "S">();
    set.add(cand.portEnd);
    ctx.ends.set(cand.face, set);
  }
  return { ...cand, slotIndex };
}

/**
 * **링크 면 배정 — 선호 면부터 채우고, 차면 gap 으로 넘어간다.**
 *
 * 머신 하나의 한 면에는 인서터가 `machine.h` 개까지만 앉는다(d1 칸이 그것뿐이다). 팔이 그보다
 * 많으면(거대 출력) 다른 면으로 넘길 수밖에 없다. **넘어갈 곳은 N/S(gap) 뿐이다:**
 * 반대 옆면(E)으로 넘기면 벨트가 채널 반대쪽에서 출발해 **되돌아올 길이 없다**(gap 이 0 이면
 * 클러스터를 통째로 돌아야 한다). N/S 로 넘기면 가로 벨트가 gap 을 따라 서쪽 변까지 와서
 * 90° 꺾이고, **그 꺾이는 칸이 곧 평범한 W 포트**가 된다 — 채널 장부가 이미 아는 모양이다.
 *
 * 두 단계로 나눈 이유(굶주림 방지): 출력은 W, 입력은 E 를 선호한다. 출력을 통째로 먼저
 * 처리하면 출력의 넘침이 gap 을 먼저 먹어 입력이 굶는다. 그래서
 *  - 1단계: 출력·입력 **양쪽의 선호 면 수요**를 먼저 앉히고,
 *  - 2단계: 그러고 남은 gap 을 넘침끼리 다툰다.
 *
 * 못 앉은 그룹은 `undefined` — 방출기가 정직하게 `unrouted` 로 낸다.
 */
export function allocateLinkFaces(
  ctx: LinkFaceContext,
  groups: MachineLinkGroup[],
  side: "from" | "to",
  prefer: PortFace,
): { plans: (LinkFacePlan | undefined)[]; deferred: number[] } {
  const plans: (LinkFacePlan | undefined)[] = groups.map(() => undefined);
  const deferred: number[] = [];
  groups.forEach((g, i) => {
    const cand = tryLinkFace(ctx, g, side, prefer);
    if (cand) plans[i] = commitLinkFace(ctx, cand, side);
    else deferred.push(i);
  });
  return { plans, deferred };
}

/**
 * [allocateLinkFaces] 의 2단계 — 선호 면이 찬 그룹을 **다른 면으로** 넘긴다.
 *
 * `faces` 는 시도 순서다. 기본(링크)은 gap 뿐이고, 아래 gap(S)을 먼저 본다: 링크 수열이
 * 위→아래 단조라 아래쪽이 뒤에 오는 목적지와 가깝다.
 *
 * **원료·완제품 줄은 반대 면을 먼저 준다**(`["E"|"W", "S", "N"]`). gap 으로 넘기면 모듈이
 * **세로로 벌어지는데**([gapRowsFromPlans]), 반대 면에 빈 행이 있으면 그건 순수한 손해다.
 * 그래서 gap 은 **양 면이 다 찼을 때의 마지막 수단**이고, 그 순서가 곧 *"오늘 되는 배치는
 * 한 칸도 안 움직인다"* 를 지켜 준다 — 지금 W/E 에 앉는 것은 그대로 W/E 에 앉는다.
 */
export function spillLinkFacesToGap(
  ctx: LinkFaceContext,
  groups: MachineLinkGroup[],
  side: "from" | "to",
  out: { plans: (LinkFacePlan | undefined)[]; deferred: number[] },
  faces: readonly PortFace[] = ["S", "N"],
): void {
  for (const i of out.deferred) {
    for (const face of faces) {
      // **여기서만 유체 면이 열린다.** 선호 단계가 비켜 간 면을 마지막 수단으로 다시 본다
      // ([tryLinkFace] 의 `allowPipeFace`) — 그래서 `faces` 에 선호 면이 다시 들어 있어도 된다.
      const cand = tryLinkFace(ctx, groups[i], side, face, true);
      if (!cand) continue;
      out.plans[i] = commitLinkFace(ctx, cand, side);
      break;
    }
  }
}

/**
 * **gap 폭 = 그 gap 에 놓일 것들이 먹는 줄 수.** 우리가 고르는 값이 아니라 배정의 부산물이다.
 *
 * 한쪽 면이 먹는 줄 = 좌석(d1) … 벨트(d`laneDepth`) = `laneDepth` 줄. 양쪽이 쓰면 각자
 * 자기 머신 면에서 재므로 그냥 더해진다(위 머신은 위에서, 아래 머신은 아래에서 센다).
 *
 * 이 수는 방출기가 벨트를 놓을 때 쓰는 `laneDepth` **바로 그 값**이다 — 상수를 따로 적어두면
 * 방출 기하가 바뀔 때 폭이 조용히 안 따라와 벨트가 옆 머신 몸통에 놓인다.
 *
 * **더하기가 맞는 이유는 전제 하나에 달려 있다: 한 면에는 그룹이 하나뿐**([tryLinkFace] 의
 * N/S 분기가 `used > 0` 이면 거절하고, 그 장부는 출력·입력이 공유한다). 그래서 한 gap 에
 * 들어오는 계획은 최대 둘이고 그 둘은 **반드시 다른 면**(위 머신의 S, 아래 머신의 N)이라,
 * 각자 자기 쪽에서 세므로 그냥 더하면 된다.
 *
 * **그 전제를 푸는 사람에게(면당 여러 줄):** 같은 면의 둘째 그룹은 첫 그룹을 **덮는 게 아니라
 * 한 줄 더 바깥**이므로(d2 옆에 d3), 그때는 같은 면끼리 `max` 를 잡고 **면 둘을 더해야** 한다.
 * 지금처럼 전부 더하면 안 쓰는 줄만큼 클러스터가 조용히 벌어진다(2026-07-22 확인 — 지금은
 * 발현 불가라 산술을 미리 안 바꿨다).
 */
export function gapRowsFromPlans(count: number, plans: (LinkFacePlan | undefined)[][]): number[] {
  // 같은 면의 그룹들은 **덮어쓰는 게 아니라 한 줄씩 더 깊어지므로** 가장 깊은 것 하나만
  // 세고(max), 마주 보는 두 면은 각자 자기 쪽에서 재므로 더한다(sum).
  const deepest = new Map<string, number>(); // `gap:face` → 그 면이 먹는 줄 수
  for (const list of plans)
    for (const p of list) {
      if (!p || p.gap === undefined) continue;
      const key = `${p.gap}:${p.face}`;
      const d = p.exitDepth ?? p.laneDepth;
      deepest.set(key, Math.max(deepest.get(key) ?? 0, d));
    }
  const rows = new Array(Math.max(0, count - 1)).fill(0);
  for (const [key, d] of deepest) rows[Number(key.split(":")[0])] += d;
  return rows;
}

/**
 * **gap 벨트가 어느 옆면으로 빠져나가나** — 그 면의 좌석 줄(d1)과 그 바깥 줄(d2)을 포트 끝
 * (인서터·상자)이 먹는다는 뜻이다.
 *
 * 왜 이 값이 필요한가 — **트렁크 파이프와 자리를 다투기 때문이다.** 점프하지 않는 파이프는
 * 좌석 줄을 기둥 전체로 훑는데(`emitTrunkPipe` 의 d1 직선), gap 벨트의 포트 끝이 그 줄의 gap
 * 행에 앉으면 파이프가 **거기서 끊긴다.** 끊긴 아래쪽 머신들은 유체를 못 받는데, 겹침도
 * 아니고 못 놓은 줄도 아니라 **아무도 알아채지 못한다**(2026-08-05 실측 — `emitTrunkPipe` 의
 * `occupancy` 안전망이 조용히 건너뛰고 있었다).
 *
 * 방향은 방출기가 못 박아 둔 규약이다: gap 출력은 서쪽으로, gap 입력은 동쪽으로 나간다
 * ([emitOutputLinks]·[emitInputLinks] 의 `portFace`).
 *
 * `gap` 이 `undefined` 인 것(맨 위 머신의 N, 맨 아래의 S — 클러스터 **밖**)도 센다. 그 행은
 * 기둥 범위 밖이지만 파이프의 **포트 끝**(줄 끝에서 두 칸)이 거기까지 나오므로 같은 사고가
 * 난다. 판정을 좁혀 두 칸을 아끼는 것보다 안전한 쪽이 낫다 — 이 값이 참일 때 치르는 값은
 * 파이프가 점프해서 생기는 폭 2칸뿐이고, 그것도 **그 면에 유체가 있을 때만**이다.
 */
export function gapExitSidesFromPlans(
  outPlans: (LinkFacePlan | undefined)[][],
  inPlans: (LinkFacePlan | undefined)[][],
): Set<PortFace> {
  const sides = new Set<PortFace>();
  const scan = (lists: (LinkFacePlan | undefined)[][], exit: PortFace) => {
    for (const list of lists)
      for (const p of list) if (p && (p.face === "N" || p.face === "S")) sides.add(exit);
  };
  scan(outPlans, "W");
  scan(inPlans, "E");
  return sides;
}

/**
 * **링크·다이렉트가 옆면(W/E)에서 먹는 가장 깊은 칸** — [ClusterPipe] 가 그보다 바깥으로
 * 물러나야 하는 기준이다([buildTrunkContext] 의 `beltMaxOn`).
 *
 * 벨트는 [LinkFacePlan.laneDepth] 지만 **포트 끝이 두 칸 더 깊다**: 인서터 `+1` · 상자 `+2`
 * ([makeLinkPortChest]). 벨트 깊이만 세면 파이프가 그 두 칸 **위로** 지나가고, 파이프는
 * 끊겨도 겹침도 미배치도 아니라 **아무도 못 알아챈다** — 2026-08-05 의 gap 벨트 사고와
 * 같은 종류다([gapExitSidesFromPlans]).
 *
 * **gap(N/S) 스필은 세지 않는다.** 그 포트 끝은 옆면의 d1·d2 에 앉는데 [ClusterPipe] 는
 * 최소 d3 이라 부딪히지 않는다. 그리고 *"그 면의 좌석 줄을 먹는다"* 는 사실은
 * [gapExitSidesFromPlans] 가 이미 따로 전한다(점프 조건 ④) — 여기서 또 세면 답은 안 바뀌고
 * 폭만 넓어진다.
 */
export function linkFaceDepths(
  lists: readonly (LinkFacePlan | undefined)[][],
): Partial<Record<PortFace, number>> {
  const by: Partial<Record<PortFace, number>> = {};
  for (const list of lists)
    for (const p of list) {
      if (!p || p.face === "N" || p.face === "S") continue;
      by[p.face] = Math.max(by[p.face] ?? 0, p.laneDepth + 2);
    }
  return by;
}

/**
 * 면마다 링크가 먹은 **최대 좌석 수**(머신 하나 기준) — planner 의 좌석 예산에서 뺄 값.
 *
 * W/E 만 반환하지 않는다 — `used` 의 키는 [tryLinkFace] 가 N/S(gap 스필)에도 똑같이
 * 적는다(`seatKey(mi, "N"|"S")`). **지금은** planner 가 N/S 를 시도하는 유일한 경로
 * (`input.nsFaces`)가 count=1 일 때만 켜지고, gap 스필은 count≥2 일 때만 생겨 서로
 * 상호배타라 이 값이 없어도 조용히 안 터졌다 — 그건 우연이지 설계가 아니다. 계산해 둔
 * 값을 버리지 않는 쪽이 항상 맞다(2026-07-21, [발견 ③] 근치).
 */
export function seatRowsByFace(used: Map<string, number>): Partial<Record<PlannedSide, number>> {
  const by: Partial<Record<PlannedSide, number>> = {};
  for (const [k, v] of used) {
    const face = k.slice(k.indexOf(":") + 1) as PlannedSide;
    by[face] = Math.max(by[face] ?? 0, v);
  }
  return by;
}
