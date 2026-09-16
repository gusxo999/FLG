/**
 * **어디에 앉나** — 줄 하나가 모듈의 **어느 면 · 어느 깊이 · 어느 좌석**에 앉았나([LinkFacePlan]),
 * 못 앉았으면 **왜**인가([DepthShortage]), 그리고 한 모듈의 배정이 공유하는 무대([LinkFaceStage]).
 *
 * 좌표는 없다 — 전부 **모듈 안 순번**이다. 좌표를 입히는 것은 방출의 덧셈 한 줄이다.
 *
 * > **내력.** `planner/module/linkPlanner.ts`·`planModulePorts.ts` 에 있다가 2026-09-13 여기로 왔다
 * > (계획 구조-2축 · 2 Step 1). 방출기(`execution/module`)와 조율자(`module/clusterModule`)가 이
 * > 타입을 가지러 계획 계층을 올려다보고 있었다.
 * >
 * > **[FaceTable] 만 아직 계획 계층에서 온다.** 좌석표는 장부의 *모양*이라 타입만 떼면
 * > `claimSeats`·`depthClear` 의 계약이 두 파일로 갈린다 — 장부째 옮기는 것이 다음 단계의 몫이다.
 */

import type { SpecInserter } from "../../shared/gamedata/spec";
import type { PortFace } from "../../shared/types";
import type { Link, PortSide } from "./line";
import type { FaceTable } from "../../planner/module/faceTable";

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
  clusterBeltDepth: number;
  /**
   * **이 줄의 좌석에 앉을 팔** — `reach` 로 지목한다([inserterForReach]).
   *
   * **깊이에서 되유도하지 않는다.** 오늘은 `clusterBeltDepth = reach + 1` 이 항등이라 두 방법이
   * 같은 답을 내지만, 축은 깊이가 아니라 `(인서터, 그 팔이 집는 타일)` 이고(계획서 §16)
   * 그 항등이 깨지는 날(케이스 B 부활 · 유체 면 `depthCap`) **조용히 틀린다.**
   * 그리고 팔 **개수**를 이 팔로 셌으므로([armsAt]), 놓는 팔도 이것이라야 짝이 맞는다.
   */
  reach: number;
  /**
   * **반출 깊이 — gap 전용.**
   *
   * W/E 면에서는 빠져나가는 방향이 면과 **수직**이라, 벨트가 자기 좌석 구간만 덮고 끝에서
   * 꺾으면 그만이다(그래서 여러 그룹이 같은 깊이를 나눠 쓴다). gap 은 다르다 — 나가는 쪽
   * (부모=서쪽)이 면과 **평행**이라 모든 벨트가 서쪽 변까지 달려야 하고, 같은 줄 두 벨트는
   * 반드시 합쳐진다.
   *
   * 그래서 이 면의 **n 번째 그룹은 한 칸 더 깊은 줄로 내려가서** 달린다. 내려가는 건
   * **벨트가 벨트를 먹이는 것**이라 팔 길이와 무관하다 — 팔은 `clusterBeltDepth`(수집 줄)까지만
   * 닿으면 된다. 첫 그룹은 `clusterBeltDepth` 와 같다(내려갈 것도 없이 이미 서쪽 변에서 시작).
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
   * 왜 갈리나 — 상자에 바깥에서 닿으려면 **그보다 더 깊은 줄들을 가로질러야** 하는데,
   * W/E 면의 깊이는 세로줄이라 **관통 줄은 어떤 행에서도 못 건넌다.** 포트를 옆에 두면
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
   * **벨트 흐름이 향하는 끝** — 포트가 서는 쪽. `portEnd` 와 달리 **장부를 안 먹는다.**
   *
   * ```
   * portEnd   포트가 기둥 끝에 선다 = 면의 희소 자원(`ctx.ends`)을 하나 먹는다
   * exitEnd   벨트가 어느 쪽으로 흐르나 = 자원이 아니라 **방향**이다
   * ```
   *
   * 관통 줄이면 둘이 같다(포트가 곧 흐름의 끝). **구간 줄은 `portEnd` 가 없어도 이 값을
   * 갖는다** — 2026-09-05 이전에는 안 그랬고, `topT` 가 `span[0]`(위쪽) 상수였다.
   *
   * 값은 `Link.end`(형제 순번, `modulePacking.linkEndOf`)에서 온다. **좌표를 안 본다** —
   * `gen` 보다 앞에서 확정되므로 되먹임 A(`끝 → gen → 높이 → y → 거리 → 끝`)가 안 닫힌다.
   *
   * (이름은 되살린 것이다. 2026-09-02 에 *"구간이 자기 끝을 지목하는 `exitEnd` 갈래"* 가
   *  `trunkEndKey` 에서 삭제됐는데 — 그건 만드는 쪽(`splitIntervals`)이 죽어 값이 늘
   *  `undefined` 였기 때문이지 개념이 틀려서가 아니었다. 이제 산 생산자가 생겼다.)
   */
  exitEnd?: "N" | "S";
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
  /**
   * **합류에서 이 줄의 역할** — 싣는 쪽(from)에서 두 줄이 기둥 끝 바깥에서 만날 때.
   *
   * ```
   * lead    자기 구간을 지나 기둥 밖까지 달려 **합류 칸**을 세운다. 포트도 그 칸에서 난다
   * follow  깊이 +2 로 비켜 올라와 이끄는 줄의 합류 칸 옆구리를 친다. 포트가 없다
   * ```
   *
   * **방출은 이 값만 본다.** 예전엔 방출이 `Link.sharedLineId` 와 기하 조건(면·깊이·끝)을
   * 스스로 다시 판정했는데, 배정이 짝을 푼 뒤에도 그 신원이 남아 **둘의 답이 갈렸다**
   * (2026-09-12 도형 대조 **F2**). 판정 주체는 배정 하나다.
   */
  mergeRole?: "lead" | "follow";
  /**
   * **집는 쪽(to)에서 첫 줄의 벨트에 얹혔나** — [seatOnSharedBelt] 가 성공했을 때만 참.
   *
   * 이 값이 거짓이면 이 줄은 **자기 벨트를 갖는다**(청구도 그렇게 했다). 방출이 신원만 보고
   * 남의 벨트에 얹으면 청구한 칸이 유령 예약이 되고, 그 줄의 팔은 벨트 없는 칸에 선다(F2).
   */
  sharesBelt?: boolean;
}

/**
 * 링크 그룹 하나가 실제로 앉은 자리 — 면 + 머신마다 쓰는 **면 위 위치** `t`.
 * `t` 는 [faceCell] 과 같은 뜻이다: W/E 면이면 y(행), N/S 면이면 x(열).
 */
export interface LinkSeats extends LinkFacePlan {
  /** 머신 index → 그 머신 면에서 이 그룹이 쓰는 연속 `t` 값들. */
  slots: Map<number, number[]>;
}

/**
 * **못 앉은 이유 — 후보(면 × 깊이) 하나마다 하나.** 사다리가 읽는다.
 *
 * **수량이 아니라 `행`을 담는 것이 요점이다.** *"깊이가 하나 모자라다"* 로는 **어디서 자를지**
 * 못 정한다. 사다리 1(구간 쪼개기)이 필요로 하는 것은 자름의 **경계**이고, 그건 막힌 행 번호다
 * (계획서 §14-2 — *못을 피해서*).
 *
 * ```
 * blockedRows [90, 180]  →  토막 [1,88] · [91,178] · [181,268]
 * ```
 *
 * **못은 얕은 줄의 포트에서 온다** — 포트 인서터가 `d+1` 에 서므로, 깊이 `d` 에 앉으려는
 * 줄에게는 깊이 `d−1` 줄들의 진출 행이 전부 못이다. 연쇄하지만 깊이 수만큼에서 멈춘다.
 */
export interface DepthShortage {
  face: PortFace;
  clusterBeltDepth: number;
  /** 이 깊이의 팔로 센 팔 수가 면 좌석 예산을 넘었다. */
  seats?: { need: number; budget: number };
  /** 내 구간 안에서 **이 깊이가 이미 먹힌 행**들 — 곧 자름의 경계다. */
  blockedRows?: number[];
  /**
   * 이 후보로 앉았다면 내 팔이 앉았을 **좌석 행**들(모듈-로컬).
   *
   * 사다리가 *"쪼개면 실제로 앉나"* 를 묻는 데 필요하다([resolveSpanBlock]) — 막힌 칸이
   * **내 좌석 칸**이면 쪼개도 그 머신은 못 앉고, 막힌 칸 **사이**에 좌석이 있으면 조각이 산다.
   * 그 판정은 이 목록과 [blockedRows] 두 개만 있으면 끝난다.
   */
  seatRows?: number[];
  /** 벨트는 지나가는데 **포트 칸**이 막혔다(`(행, 깊이)`). 쪼개면 진출 행이 옮겨간다. */
  blockedPort?: Array<readonly [number, number]>;
}

/**
 * **한 모듈의 면 배정이 공유하는 것** — 면마다 [FaceTable] 한 장 + 머신 모양 + 유체가 가져간 면.
 *
 * 예전엔 장부가 **셋**이었다(`used`·`faceGroups`·`lanes`). 셋이 서로 다른 것을 세고 서로를
 * 몰라서, 면 전체를 그린 것이 **어디에도 없었다** — 그래서 포트 칸(`d+1`·`d+2`)이 아무
 * 장부에도 안 올라갔고, 배정을 되돌릴 방법도 없었다. 지금은 셋이 표 하나를 읽는 질문이다
 * (대응표는 [FaceTable] 머리말).
 */
export interface LinkFaceContext {
  machine: { w: number; h: number };
  count: number;
  /**
   * **면마다 좌석표 한 장** — 이 배정이 아는 자리의 전부다. 없는 면은 [tableOf] 가 만든다.
   *
   * 표는 **값**이라 복사해서 채워 보고 버릴 수 있다 — 트렁크 경로 계획의 배정 3단이 요구하는
   * 것이 그것 하나다(`docs/auto-layout/module/trunk-assignment.md` §15).
   */
  tables: Map<PortFace, FaceTable>;
  /**
   * **트렁크 파이프가 붙는 면**(W/E) — 그 면의 **유체 상자 행 번호**와 점프 여부.
   *
   * 파이프는 유체 상자 칸 하나만 먹고 지하로 벨트를 넘어 바깥 [ClusterPipe] 로 나간다
   * → 좌석 줄이 **거의 다 살아 있다.** `rows` 만 건너뛰고 앉는다(예산은
   * `machine.h − rows.length`, 순번 remap 은 [commitLinkFace]).
   *
   * `depthCap` 은 **그 면의 깊이 상한** — 지하파이프 사거리가 정한다([clusterBeltDepthCap]).
   * 얕으면 깊은 줄이 잘려 그만큼 그룹이 다른 면으로 넘어간다.
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
  pipeFaces?: ReadonlyMap<PortFace, { rows: readonly number[]; depthCap: number }>;
  /**
   * 기둥 끝 장부 — `${면}` → 이미 쓴 끝들([LinkFacePlan.portEnd]). 면마다 N·S 둘뿐이다.
   *
   * **이것만 표 밖에 남는다** — 기둥 끝은 면의 칸이 아니라 그 **바깥**이라 `(행, 깊이)` 로
   * 표현되지 않는다. 셋을 하나로 접은 뒤에도 이 하나가 남는 것이 정직한 회계다.
   */
  ends: Map<PortFace, Set<"N" | "S">>;
  /**
   * **기둥 밖의 칸 장부** — `${끝}:${오프셋}:${깊이}`. `offset 0` 이 기둥 바로 바깥 행.
   *
   * 위 `ends` 의 주석은 *"기둥 끝은 `(행, 깊이)` 로 표현되지 않는다"* 고 적었는데, 그건
   * **표의 좌표계**에서만 참이었다. 기둥 밖도 격자다 — 원점을 기둥 끝으로 옮기면 그만이다.
   *
   * **왜 필요한가** — `ends` 의 낟알은 「면 × 끝」이라 한 줄이 N 을 잡으면 그 끝 바깥이
   * 통째로 잠긴다. 그런데 포트 칸은 **각자 자기 깊이**에 서므로 깊이가 다르면 안 부딪힌다.
   * 그 잃은 자리를 `endsCoarse` 가 센다(`tempPlanDocs/구간-밖-주행/` 트랙 A).
   *
   * **아직 결정은 `ends` 가 한다**(A1). 이 장부는 나란히 돌면서 두 답을 대조한다 —
   * `endsDisagree` 가 0이 아니면 모델이 틀린 것이다.
   */
  outside: Map<PortFace, Set<string>>;
  /**
   * 쓸 수 있는 팔 — **그 면의 깊이 목록이 여기서 나온다**([clusterBeltDepthsOf]).
   * reach `r` 인 팔은 d`r+1` 을 집으므로 reach 종류 수 = 깊이 수다. 비면 d2 하나로 본다.
   *
   * **처리량까지 든다** — 깊이를 고르면 그 팔의 처리량이 팔 **개수**를 정하기 때문이다
   * ([armsAt]). 예전엔 `{ reach }` 만 받아서 개수를 못 셌고, 그래서 붓기가 reach 1 로
   * 미리 센 수를 그대로 썼다(결함 A).
   */
  inserters?: readonly SpecInserter[];
}

/**
 * [allocateLinkFaces] 의 산출 — 배정 + 못 앉은 줄 + **왜 못 앉았나**.
 *
 * `shortages[i]` 는 그룹 `i` 가 **선호 면**에서 후보마다 낸 사유다. 앉은 그룹은 빈 배열이고,
 * 넘침 단계에서 앉은 그룹은 선호 면의 사유가 남아 있다 — *"왜 밀려났나"* 가 곧 그것이다.
 */
export interface FaceAllocation {
  plans: (LinkFacePlan | undefined)[];
  deferred: number[];
  shortages: DepthShortage[][];
}

/**
 * **① 링크 면 배정의 산출** — [planLinkFaces] 가 내고 [planModulePorts] 가 받는다.
 *
 * 이 번들이 있는 이유는 하나다 — **배정을 `generateModule` 밖에서 돌리기 위해**
 * 배정이 방출 안에 갇혀 있으면
 * 그 결과를 보려고 방출까지 해야 하고, 고치려면 밖에서 입력을 고쳐 **다시 만들어야** 한다
 * — 그게 되먹임 A·B 의 뿌리다.
 *
 * `pipeFaces`·`pipeFaceRows` 까지 담는 것은 ⓪ 가 ① 뿐 아니라 ③도 먹이기 때문이다 —
 * 둘로 나누어 각자 유도하면 **같은 사실을 두 곳이 세게 된다**(R3).
 */
export interface LinkFaceStage {
  tables: Map<PortFace, FaceTable>;
  ctx: LinkFaceContext;
  outLinks: Link[];
  inLinks: Link[];
  out: FaceAllocation;
  in: FaceAllocation;
  pipeFaces: { side: PortSide; fluidRows: number; depthCap: number }[];
  isJumpableToClusterPipe: (side: PortSide) => boolean;
}
