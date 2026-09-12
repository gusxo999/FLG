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
 * 예전엔 `generateModule` 이 좌표 단계에서 `placeLedger` 라는 빈 장부를
 * 새로 만들어 **여기서 이미 센 누적값을 처음부터 다시 셌다**. 배정이 알던 값을 계층 경계
 * 너머로 전하지 못해 생긴 중복이었다 — 이제 [commitLinkFace] 가 그 순번을
 * [LinkFacePlan.slotIndex] 에 실어 보내므로, 좌표 단계는 **덧셈만** 한다.
 */

import { faceSeatArms, inserterForReach, type SpecInserter } from "../../buildSpec";
import type { PortFace } from "../../containerModel";
import { armsAt, machinesOn, resolveSpanBlock, spansAllMachines, type Link } from "../../module/link";
import { recordFaceDepthStats } from "../../../debug/runStats";
// **도형의 단일 출처** — 방출기가 부르는 그 함수를 청구도 부른다(work-kinds §7 D1).
import { linkShape, shapeCells } from "../../module/linkShape";
import type { PlannedSide } from "./ioLine";
import {
  claimDepth, claimSeats, freeSeatRows, groupsOn, depthClear, makeFaceTable,
  rowIndex, seatsTaken, takeOwner, type FaceTable,
} from "./faceTable";

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

/** [commitLinkFace] 전의 배정안 — 순번(`slotIndex`)은 확정 시점에야 정해진다. */
type LinkFaceCandidate = Omit<LinkFacePlan, "slotIndex" | "mergeRole" | "sharesBelt">;

/**
 * **이 줄이 향하는 끝** — 배정과 방출이 같은 값을 보게 하는 단일 출처.
 *
 * `portEnd` 를 앞에 두는 것은 관통 줄에서 둘이 반드시 같아야 하기 때문이다(포트가 기둥
 * 끝에 섰는데 벨트가 반대로 흐르면 도형이 없다). 마지막 `"N"` 은 **방향을 아무도 안 말한
 * 경우**(형제가 하나뿐이라 선호가 없는 줄)의 기본값이고, 그게 2026-09-05 이전의 전부였다.
 */
export const flowEnd = (
  cand: Pick<LinkFacePlan, "portEnd" | "exitEnd">,
): "N" | "S" => cand.portEnd ?? cand.exitEnd ?? "N";

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
 * **면에서 줄이 못 앉는 교착 넷** — *무엇이* 막혔나로 가른다. 처방이 아니라 **상태**의 이름이다.
 *
 * ```
 *   면 =  [ 좌석 d1 ][ 구간 d2… ][ 포트 d+1 ]        ← 막힌 자리가 곧 교착의 이름이다
 *
 *   seat-budget    좌석 예산 초과 — 면의 d1 칸(= faceSeatArms)이 애초에 모자라다
 *   seat-blocked   내 **좌석 칸**이 남에게 먹혔다
 *   span-blocked   좌석은 비었는데 **그 사이를 잇는 구간**이 막혔다
 *   port-blocked   구간은 지나는데 **포트 칸**이 막혔다
 * ```
 *
 * `seat-blocked` 와 `span-blocked` 는 둘 다 [DepthShortage.blockedRows] 에서 오지만 **기하가
 * 다르다** — 막힌 칸이 내 좌석 위에 있으면 앞이고, 좌석 *사이*에만 있으면 뒤다. 그 갈림이
 * 곧 [resolveSpanBlock] 이다.
 *
 * **해소자는 교착마다 하나씩이고, 지금 있는 것은 하나뿐이다:**
 *
 * | 교착 | 해소자 | 지금 |
 * |---|---|---|
 * | `span-blocked` | [resolveSpanBlock] → [splitLinkAtRows] | ✅ 사다리 1단 |
 * | `port-blocked` | (없음) | ⛔ 구간막힘과 같은 처방이 통할 자리인데 안 만들었다 |
 * | `seat-blocked` | (없음) | ⛔ gap·다이렉트의 몫 |
 * | `seat-budget` | (없음) | ⛔ gap·다이렉트의 몫 |
 *
 * 그래서 이 이름표가 곧 **미완성 기능의 경계**다 — `unrouted-lines` 이슈가 이걸 싣는다
 * (`docs/auto-layout/link/machine-link.md` — *어디까지 작동하나*).
 */
export type LadderRung = "span-blocked" | "port-blocked" | "seat-blocked" | "seat-budget";

/** 화면에 나가는 말. 셋이 `막힘` 으로 끝나고 **어디가** 막혔는지만 다르다. */
const RUNG_LABEL: Record<LadderRung, string> = {
  "span-blocked": "구간막힘",
  "port-blocked": "포트막힘",
  "seat-blocked": "좌석막힘",
  "seat-budget": "좌석부족",
};

/** 해소자가 있는 것부터. 후보 여럿이 사유가 갈리면 **풀 수 있는 쪽**이 그 줄을 맡는다. */
const RUNG_ORDER: readonly LadderRung[] = [
  "span-blocked", "port-blocked", "seat-blocked", "seat-budget",
];

function rungOf(w: DepthShortage): LadderRung {
  if (w.blockedRows?.length && w.seatRows?.length)
    return resolveSpanBlock(w.seatRows, w.blockedRows).length > 0 ? "span-blocked" : "seat-blocked";
  if (w.blockedPort?.length) return "port-blocked";
  if (w.blockedRows?.length) return "seat-blocked";
  return "seat-budget";
}

/** 줄 하나의 후보들을 한 이름표로. 후보가 없으면 `undefined` — 사유를 지어내지 않는다. */
export function rungOfLine(ws: readonly DepthShortage[]): LadderRung | undefined {
  if (ws.length === 0) return undefined;
  const seen = new Set(ws.map(rungOf));
  return RUNG_ORDER.find((r) => seen.has(r));
}

/**
 * 모듈 하나의 못 앉은 줄들을 **교착별로 센다** — `unrouted-lines` 이슈에 붙는 한 문장.
 *
 * 줄 이름과 이름표를 1:1 로 잇지 않는 것은 [GeneratedModule.depthShortages] 가 `linkId` 로만
 * 묶여 있어서다(줄 이름과의 짝은 아직 없다). **없는 대응을 지어내지 않는다.**
 */
export function summarizeRungs(shortages: Map<string, DepthShortage[]>): string | undefined {
  const tally = new Map<LadderRung, number>();
  for (const ws of shortages.values()) {
    const r = rungOfLine(ws);
    if (r) tally.set(r, (tally.get(r) ?? 0) + 1);
  }
  if (tally.size === 0) return undefined;
  return RUNG_ORDER.filter((r) => tally.has(r))
    .map((r) => RUNG_LABEL[r] + " " + tally.get(r))
    .join(" · ");
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
 * **이 면의 좌석표** — 없으면 만든다.
 *
 * 면마다 표가 따로인 이유는 **행의 뜻이 다르기 때문**이다: W/E 면의 행은 머신 세로 칸(`h`),
 * N/S 면의 행은 가로 칸(`w`) 이다. 유체 상자는 W/E 에만 붙으므로 N/S 표는 언제나 비어서 시작한다.
 */
function tableOf(ctx: LinkFaceContext, face: PortFace): FaceTable {
  const found = ctx.tables.get(face);
  if (found) return found;
  const isGap = face === "N" || face === "S";
  const made = makeFaceTable(
    isGap ? ctx.machine.w : ctx.machine.h,
    ctx.count,
    isGap ? [] : (ctx.pipeFaces?.get(face)?.rows ?? []),
  );
  ctx.tables.set(face, made);
  return made;
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
 * **면의 깊이 목록** — reach 종류에서 유도된다. 깊이는 고르는 값이 아니라 *결과*다(계획서 §16):
 * `d2` 가 관통에 먹혔으면 다음 줄은 `d3` 이고, **그러니 그 줄의 팔이 긴팔이 된다.**
 * 거꾸로 *"긴팔을 쓸까"* 를 먼저 정하는 코드는 없다.
 *
 * **장부를 안 읽는다** — `ctx.inserters` 와 `ctx.pipeFaces` 만 본다. 그래서 배정이 끝난 뒤
 * 다시 불러도 같은 답이고, `planModulePorts` 의 사후 계측이 그 성질에 기대고 있다.
 */
export function clusterBeltDepthsOf(ctx: LinkFaceContext, face: PortFace): number[] {
  const reaches = [...new Set((ctx.inserters ?? []).map((i) => i.reach))]
    .filter((r) => Number.isFinite(r) && r >= 1)
    .sort((a, b) => a - b);
  const all = reaches.length ? reaches.map((r) => r + 1) : [LINK_LANE_DEPTH];
  // **파이프가 먼저다** — 유체 면의 깊이는 지하파이프가 넘을 수 있는 데까지다.
  const cap = ctx.pipeFaces?.get(face)?.depthCap ?? Infinity;
  return all.filter((d) => d <= cap);
}

/**
 * 이 그룹의 벨트가 면에서 먹을 **행 범위** — 연속이라 `[최소, 최대]` 하나로 족하다.
 *
 * 좌표가 아니라 **모듈 안 순번**이다([FaceTable] 의 행 번호 그대로).
 *
 * **표를 읽으므로 칸을 차지하기 전에** 불러야 한다([commitLinkFace] 가 맨 앞에서 부른다).
 *
 * 옛 코드는 `used`(논리 칸 수)에 `skipFluidRows` 를 씌워 실제 행을 구했다. 표에서는
 * **빈 좌석을 앞에서부터 집으면** 그 사상이 저절로 나오므로([freeSeatRows]) 되사상이 없다 —
 * `emitTapInserting.remapRow` 와 같은 산술을 두 곳이 갖던 자리가 하나 없어졌다.
 */
function beltRowSpan(
  ctx: LinkFaceContext,
  face: PortFace,
  arms: Map<number, number>,
): readonly [number, number] {
  const t = tableOf(ctx, face);
  let lo = Infinity;
  let hi = -Infinity;
  for (const [mi, k] of arms) {
    const free = freeSeatRows(t, mi);
    if (free.length === 0) continue;
    const first = free[0];
    const last = free[Math.min(k, free.length) - 1];
    lo = Math.min(lo, rowIndex(t, mi, first));
    hi = Math.max(hi, rowIndex(t, mi, last));
  }
  return [lo, hi];
}

/**
 * 이 행이 기둥 **밖**이면 그 좌표 — `end` 쪽으로 `offset` 칸 나간 자리. 안이면 `undefined`.
 */
function outsideOf(row: number, table: FaceTable): { end: "N" | "S"; offset: number } | undefined {
  const last = table.rowsPerMachine * table.machineCount - 1;
  if (row < 0) return { end: "N", offset: -1 - row };
  if (row > last) return { end: "S", offset: row - last - 1 };
  return undefined;
}

const outsideKey = (o: { end: "N" | "S"; offset: number }, depth: number): string =>
  `${o.end}:${o.offset}:${depth}`;

/**
 * 후보가 먹는 칸을 **표 안 / 기둥 밖**으로 가른다 — 두 장부가 다르기 때문이다.
 *
 * 검사([tryLinkFace])와 청구([commitLinkFace])가 **같은 함수**를 부르게 해서 둘이 갈리지
 * 않게 한다. 갈리면 배정이 못 본 다툼이 방출에서 터진다.
 */
function splitByTable(
  cells: ReadonlyArray<readonly [number, number]>,
  table: FaceTable,
): { inside: Array<readonly [number, number]>; outside: string[] } {
  const inside: Array<readonly [number, number]> = [];
  const outside: string[] = [];
  for (const [r, d] of cells) {
    const o = outsideOf(r, table);
    if (o) outside.push(outsideKey(o, d));
    else inside.push([r, d]);
  }
  return { inside, outside };
}

/**
 * 이 후보의 **포트가 먹는 칸 둘** — `(행, 깊이)`. **검사 전용**이고, 확정 청구와 방출이
 * 부르는 [linkShape] 와 **같은 함수에서 답을 받는다**(2026-09-12 D1).
 *
 * 예전엔 이 파일이 그 도형을 직접 계산했고, 주석이 근거로 `emitModule` 의 **줄 번호**를
 * 인용하고 있었다. 그래서 방출이 도형을 바꾸면 여기가 조용히 낡았다.
 */
function portCells(
  cand: Pick<LinkFaceCandidate, "clusterBeltDepth" | "portEnd" | "exitEnd">,
  span: readonly [number, number],
): Array<readonly [number, number]> {
  const port = linkShape({
    role: "output", // 포트 두 칸은 역할과 무관하다 — 흐름만 반대이고 자리는 같다
    clusterBeltDepth: cand.clusterBeltDepth,
    portEnd: cand.portEnd,
    flowToSouth: flowEnd(cand) === "S",
    rows: span,
    outRow: 0, // 합류 도형을 안 물으므로 안 쓰인다
  }).port;
  // **거르지 않는다**(2026-09-06) — 기둥 밖 행은 `ctx.outside` 가 센다([splitByTable]).
  return port ? [[port.inserter.t, port.inserter.depth], [port.chest.t, port.chest.depth]] : [];
}

/**
 * 링크 벨트의 기본 깊이 — 좌석(d1) 바로 바깥. v1 은 그룹마다 이 한 줄뿐이다
 * (깊이 늘리기 = 긴팔로 d≥3 을 집는 것은 후속).
 */
const LINK_LANE_DEPTH = 2;

/**
 * 그룹 하나를 이 면에 앉혀 본다 — **장부는 안 건드린다**(확정은 호출자가 한다).
 * 그룹이 여러 머신을 관통하면(입력 트렁크) **전부** 들어가야 성공이다 — 벨트 하나를 반만
 * 옮길 수는 없다.
 *
 * 면마다 한계가 **좌석 수 하나**다(2026-07-22). 예전엔 좌석과 별개로 **depth** 도
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
// **간선 축 배정이 직접 부른다**([seatLinkEdge]) — 한 링크의 양끝을 놓기 전에 둘 다
// 물어봐야 하는데, 그 두 물음이 **서로 다른 모듈의 표**에 걸린다. 그래서 판정(try)과
// 확정(commit)이 갈려 있는 지금 모양이 그대로 필요하다.
export function tryLinkFace(
  ctx: LinkFaceContext,
  group: Link,
  side: "from" | "to",
  face: PortFace,
  allowPipeFace = false,
  /** 못 앉으면 그 사유가 여기 쌓인다(후보마다 하나). 안 주면 안 모은다. */
  why?: DepthShortage[],
  /**
   * **기둥 끝 포트를 강제한다** — 레인 합류 쌍 전용(위 `spanning` 주석).
   * 관통이 아니어도 포트가 기둥 끝에 서야 벨트가 꺾이고, 그 꺾인 칸이 합류 칸이 된다.
   */
  forceEnd?: boolean,
  /**
   * **이 끝을 먼저 본다** — 합류 쌍 전용. `Link.end`(형제 순번)보다 우선한다.
   *
   * 형제 순번은 *"납품이 교차하지 않게"* 를 노리는 선호인데, 합류는 **그 자리가 아니면
   * 도형이 아예 없다.** 대안이 없는 쪽이 이긴다(배정 순서와 같은 원칙).
   */
  preferEnd?: "N" | "S",
  /**
   * **이 깊이를 먼저 본다** — 합류 쌍의 **따르는 줄** 전용.
   *
   * 두 줄은 구간이 안 겹쳐 **한 깊이에 위/아래로 쌓여야** 합류 도형이 선다. 그런데 후보
   * 정렬은 *"팔 적은 것 → 얕은 것"* 이라 둘이 서로 다른 깊이를 고르는 일이 잦다
   * (2026-09-04 실측: 되돌림 2건이 **전부** `depth 3 vs 2` · `2 vs 3` 이었다).
   * 이끄는 줄은 먼저 앉으므로 자기 깊이를 모르고, 따르는 줄만 상대를 안다.
   */
  preferDepth?: number,
): LinkFaceCandidate | undefined {
  const { machine, count } = ctx;
  // **유체 면은 마지막 수단이다.** 여기 앉는 순간 `beltMaxOn > 0` 이 되어 파이프가 점프하고
  // ([linkFaceDepths] → `pipeJumpMode` 조건 ①) [ClusterPipe] 가 우리 포트 끝(d`clusterBeltDepth+2`)
  // **밖으로** 물러나 그 면이 여러 칸 넓어진다. 갈 곳이 있으면 그쪽이 낫다 — *"없는 위험 때문에
  // 폭을 낭비하지 않는다"* 는 `pipeJumpMode` 의 원칙과 같은 이유이고, 그 이름으로 잠긴 테스트가
  // trunkPipe.test.ts 에 있다. 그래서 선호 단계([allocateLinkFaces])는 비켜 가고,
  // 넘침 단계([spillLinkFacesToGap])만 쓴다.
  //
  // (점프 불가 면을 통째로 거절하던 가드는 **케이스 B 와 함께 사라졌다** — 2026-08-16.
  // 지금 유체 면을 다르게 만드는 것은 `depthCap` 하나뿐이다.)
  //
  // **다만 회피는 더 싼 곳이 있을 때만이다**(2026-08-16). 반대 면도 유체 면이면 어디에 앉든
  // +3 으로 **동률**이고, 동률에서 자기 역할 면을 버리면 포트가 반대편에 서서 납품 경로만
  // 길어진다(황산 꼴: 물 입력 E + 황산 출력 W — 아이템이 갈 비유체 면이 없다).
  const pf = face === "W" || face === "E" ? ctx.pipeFaces?.get(face) : undefined;
  const opposite: PortFace = face === "W" ? "E" : "W";
  if (pf && !allowPipeFace && !ctx.pipeFaces?.has(opposite)) return undefined;
  // **gap 벨트의 깊이는 언제나 `LINK_LANE_DEPTH`(d2) 라 팔이 하나로 정해진다** — 깊이를
  // 고를 여지가 없으므로 여기서 한 번만 센다. W/E 는 아래 깊이 루프가 후보마다 다시 센다.
  const gapArms = armsAt(group, side, inserterForReach(ctx.inserters ?? [], LINK_LANE_DEPTH - 1));
  for (const mi of gapArms.keys()) if (mi < 0 || mi >= count) return undefined;
  if (face === "N" || face === "S") {
    const arms = gapArms;
    // **gap(가로) 벨트는 아직 머신 하나만 맡는다.** 가로 줄 하나가 위·아래 두 대를 먹이는 것은
    // 별개 능력이고(좌석이 gap 양쪽에 하나씩 앉아야 한다), 그 전엔 조용히 겹치는 대신
    // **정직하게 자리 없음**으로 떨어뜨린다.
    if (machinesOn(group, side) !== 1) return undefined;
    const [mi, k] = [...arms][0];
    // **클러스터 양 끝은 gap 이 아니라 바깥이다.** 맨 위 머신의 N, 맨 아래 머신의 S 에는
    // 이웃이 없어 벨트가 모듈 밖으로 나간다 — 그래서 `gap` 이 `undefined` 이고, 벌릴 gap 도
    // 없다([gapRowsFromPlans] 가 안 센다). 자리는 그냥 **바깥으로 자란다**: 모듈이 차지하는
    // 범위는 `moduleExtent`(머신 ∪ 모든 셀)라 배치가 이 셀들을 이미 셈에 넣는다.
    const g = face === "S" ? mi : mi - 1;
    const gap = g >= 0 && g < count - 1 ? g : undefined;
    const gapTable = tableOf(ctx, face);
    const base = seatsTaken(gapTable, mi);
    // 좌석 수는 [faceSeatArms] 가 낸다(붓기·배정이 같은 자를 쓴다). gap 면(N/S)의 길이 방향
    // 칸은 `machine.w` 이고, 파이프는 W/E 에만 붙으므로 여기 유체 행은 언제나 0이다.
    if (base + k > faceSeatArms(machine.w, 0)) return undefined; // 이 면의 좌석(열)이 다 찼다
    // **[[ParallelBelt]] — 막힌 면** — 이 면의 몇 번째 그룹인가가 곧 자기 줄의 깊이다
    // (탐색 없이 순번으로 결정. 줄이 달라야 두 벨트가 **합류하지 않는다**).
    // 좌석 수가 아니라 **그룹 수**로 세는 이유: 서쪽으로 달리는 줄은 그룹마다 하나씩이지
    // 팔마다 하나가 아니다. 첫 그룹은 서쪽 변에서 시작하므로 내려갈 필요가 없다.
    const nth = groupsOn(gapTable, mi);
    return {
      face, gap, arms, clusterBeltDepth: LINK_LANE_DEPTH, reach: LINK_LANE_DEPTH - 1,
      exitDepth: LINK_LANE_DEPTH + nth,
    };
  }

  // 점프 유체 면은 유체 상자 행을 [fluidboxPipeCell] 이 먹는다 → 그만큼 좌석이 준다.
  // (`planClusterPorts.seatRowsOf` 의 `base − fluidRows` 와 같은 셈이다.)
  // **자는 [faceSeatArms] 하나다** — 붓기([edgeLinkGroups])가 같은 함수를 `fluidRows = 0` 으로
  // 부른다. 이쪽은 면이 정해진 뒤라 실제 유체 행 수를 안다. 그 차이가 곧 붓기의 낙관이고,
  // 이제 주석이 아니라 **인자**로 드러난다.
  const table = tableOf(ctx, face);
  const seatRows = faceSeatArms(machine.h, pf?.rows.length ?? 0);
  // **머신 여럿을 맡는 그룹이 여기서 통과한다**(2026-08-16 — 계획서 §19).
  //
  // 예전엔 `arms.size !== 1` 로 통째로 거절했다. 사유는 *"관통하는 순간 다른 그룹과 depth 를
  // 다퉈야 한다"* 였는데, **그 다툼은 관통일 때만 있다**: 나가는 방향이 면과 수직이라 벨트가
  // **자기 좌석 구간만** 덮고 끝에서 꺾으므로([LinkFacePlan.clusterBeltDepth] 머리말), 행이 안 겹치는
  // 그룹끼리는 같은 깊이를 **나눠 쓴다.** 첫 칸이 언제나 포트 쪽으로 꺾여 행이 붙어도 두 벨트가
  // 이어지지 않는다([emitOutputLinks] ①).
  //
  // 그래서 자원이 둘이다 — **좌석 행**(머신마다)과 **깊이 × 행**(면마다).
  // 관통 그룹은 사이 행까지 통으로 먹으므로 깊이 하나를 통째로 청구하는 셈이 된다.
  //
  // **관통이면 기둥 끝을 청구한다**([LinkFacePlan.portEnd]). 못 받으면 옆으로 — 그때는
  // 이 면의 깊은 관통이 상자를 가둘 수 있지만, 자리가 없는 것은 정직하게 그대로 둔다.
  // **합류 쌍은 관통이 아니어도 기둥 끝 포트를 받는다**(`forceEnd`).
  //
  // 왜: 합류는 **뒤 유입이 없는 칸**을 필요로 하고, 그런 칸은 벨트가 **꺾이는** 자리뿐이다
  // (`belt-lane-semantics` ⑤ — 뒤에서 온 쪽이 두 레인을 선점한다). 옆 포트는 벨트 끝 칸이
  // 곧 포트라 꺾을 자리가 없다. 기둥 끝 포트로 만들면 벨트가 **깊은 쪽으로 한 번 꺾고**,
  // 그 꺾인 칸이 합류 칸이 된다(도형은 `emitOutputLinks` 의 `sharedExit`).
  const spanning = spansAllMachines(group, side, count) || forceEnd === true;
  const endsTaken = ctx.ends.get(face);
  // **선호 끝이 있으면 그것부터**. 없으면 오늘처럼 N 먼저 — 그 경우
  // 후보 순서가 `["N","S"]` 로 같아지므로 **한 칸도 안 달라진다**.
  const want = preferEnd ?? group.end?.[side];
  const endOrder = want ? ([want, want === "N" ? "S" : "N"] as const) : (["N", "S"] as const);
  const portEnd = spanning ? endOrder.find((e) => !endsTaken?.has(e)) : undefined;
  // **구간 줄도 방향을 갖는다**(2026-09-05). `want` 는 위에서 이미 계산됐는데 예전엔
  // `spanning` 이 거짓이면 **그대로 버려졌고**, 그 뒤 `portCells`/방출기가 `span[0]`(위)로
  // 상수 고정됐다 — 부모가 아래에 있어도 위로 나갔다는 뜻이다.
  //
  // 옆 포트는 깊이 방향(`d+1`·`d+2`)으로 나가므로 **`ctx.ends` 를 안 먹는다.** 그래서
  // 이 값은 희소 자원을 다투지 않는다 = 방향을 사려고 기둥 끝을 사던 거래가 사라진다
  // (`tempPlanDocs/벨트-레인/` ㉣ 3차).
  //
  // **gap(N/S) 면은 뺀다.** 거기서 벨트는 가로로 눕고 `topT` 가 행이 아니라 **열**이라,
  // 이 값의 뜻(위/아래)이 성립하지 않는다. gap 의 방향은 다른 규칙이 정한다 —
  // *"모두가 서쪽 변까지 달린다"*(`emitOutputLinks` 의 `beltDirV = {-1, 0}`).
  const exitEnd = portEnd ?? (face === "W" || face === "E" ? want : undefined);

  // **깊이마다 팔 수를 다시 센다**(계획서 §16 · 결함 A). 깊이가 인서터를 정하고, 인서터가
  // 처리량을 정하고, 처리량이 팔 **개수**를 정한다 — 그러니 좌석 검사도 깊이마다 다르다.
  // 예전엔 팔 수를 reach 1 로 못박아 미리 세고 깊이만 골랐고, 그 줄이 d3 에 앉으면
  // **센 팔과 앉는 팔이 갈렸다**(실측: 10/s 로 세고 3.6/s 가 앉았다).
  //
  // **후보를 팔이 적게 드는 순으로 본다** — 좌석은 이 모델에서 **유일하게 못 늘리는 자원**
  // 이라(`faceSeatArms`: 면의 d1 칸이 그것뿐), 팔이 적게 드는 깊이가 그 면의 남은 예산을
  // 가장 적게 태운다. 동률이면 **얕은 쪽** — 벨트 칸을 덜 먹고 [ClusterPipe] 를 덜 밀어낸다.
  // 옛 탭 경로(`clusterPortPlanner.takeSeat`, 2026-09-02 삭제)가 쓰던 규칙 **그대로**이고,
  // 이제 그 판단을 하는 곳은 **여기 하나**다(R3). 예전엔 **도착 순으로 얕은 것부터**라 임의가 실패할 수 있는
  // 자리에 있었다(R2).
  const candidates = clusterBeltDepthsOf(ctx, face)
    .map((clusterBeltDepth) => {
      const arms = armsAt(group, side, inserterForReach(ctx.inserters ?? [], clusterBeltDepth - 1));
      let total = 0;
      for (const k of arms.values()) total += k;
      return { clusterBeltDepth, arms, total };
    })
    .sort((a, b) =>
      // **짝의 깊이가 먼저다** — 도형이 걸린 축이라 팔 수·얕음보다 세다.
      (preferDepth !== undefined
        ? Number(a.clusterBeltDepth !== preferDepth) - Number(b.clusterBeltDepth !== preferDepth)
        : 0)
      || a.total - b.total || a.clusterBeltDepth - b.clusterBeltDepth);
  for (const { clusterBeltDepth, arms } of candidates) {
    let need = 0;
    let seatsFit = true;
    for (const [mi, k] of arms) {
      need = Math.max(need, seatsTaken(table, mi) + k);
      if (seatsTaken(table, mi) + k > seatRows) seatsFit = false;
    }
    if (!seatsFit) {
      why?.push({ face, clusterBeltDepth, seats: { need, budget: seatRows } });
      continue; // 이 팔로는 좌석이 모자란다 — 다음 후보가 더 쌀 수 있다
    }
    const span = beltRowSpan(ctx, face, arms);
    if (!depthClear(table, clusterBeltDepth, span[0], span[1])) {
      // **막힌 행이 곧 자름의 경계다.** 수량이 아니라 행을 담는다 — 그리고 사다리가
      // *"쪼개면 앉나"* 를 물으려면 **내 좌석 행**도 있어야 한다([resolveSpanBlock]).
      const rows: number[] = [];
      for (let r = span[0]; r <= span[1]; r++) if (!depthClear(table, clusterBeltDepth, r, r)) rows.push(r);
      const seats: number[] = [];
      for (const [mi, k] of arms)
        for (const t of freeSeatRows(table, mi).slice(0, k)) seats.push(rowIndex(table, mi, t));
      why?.push({ face, clusterBeltDepth, blockedRows: rows, seatRows: seats.sort((a, b) => a - b) });
      continue;
    }
    // **포트 칸까지 본다**(결함 B). 벨트만 보면 이 그룹의 포트 인서터·상자가 남의 깊이
    // 한복판에 서고, 그 사실이 아무 장부에도 안 올라간다 — 그러면 방출에서 부딪혀
    // 한쪽 줄이 통째로 사라진다(`emitModule` 의 *"구성상 발생 안 함"* 안전망).
    const claim = splitByTable(portCells({ clusterBeltDepth, portEnd, exitEnd }, span), table);
    const hitPort = claim.inside.filter(([r, d]) => !depthClear(table, d, r, r));
    if (hitPort.length > 0) {
      why?.push({ face, clusterBeltDepth, blockedPort: hitPort });
      continue;
    }
    // **A1 — 기둥 밖 칸 장부를 나란히 돌린다**(`tempPlanDocs/구간-밖-주행/` 트랙 A).
    //
    // 결정은 아직 `ends` 가 한다. 여기서는 두 답을 대조만 한다:
    //
    // ```
    // endsDisagree  outside 가 막았는데 ends 는 안 막았다  → **0이어야 한다**(모델 검증)
    // endsCoarse    ends 가 막았는데 outside 는 자리가 있다 → **A2 의 이득**
    // ```
    const bandTaken = ctx.outside.get(face);
    if (claim.outside.some((k) => bandTaken?.has(k)))
      recordFaceDepthStats({ endsDisagree: 1 });
    // **끝을 못 받아 옆 포트로 저하했나** — 그런데 칸 장부로는 자리가 있었나.
    // 끝 선택은 깊이를 안 보는데(`endOrder` 가 루프 **밖**이다) 포트 칸은 깊이에 선다 —
    // 그래서 이 대조는 깊이를 아는 **여기**서만 할 수 있다. A2 는 끝 선택 자체를
    // 이 루프 안으로 들여와야 한다.
    if (spanning && portEnd === undefined) {
      const roomAtSomeEnd = (["N", "S"] as const).some((e) =>
        splitByTable(portCells({ clusterBeltDepth, portEnd: e, exitEnd: e }, span), table)
          .outside.every((k) => !bandTaken?.has(k)));
      if (roomAtSomeEnd) recordFaceDepthStats({ endsCoarse: 1 });
    }
    return { face, arms, clusterBeltDepth, reach: clusterBeltDepth - 1, portEnd, exitEnd };
  }
  // 이 면의 깊이가 다 찼다 — 넘침 단계가 다른 면을 준다([spillLinkFacesToGap]).
  return undefined;
}

/**
 * [tryLinkFace] 가 낸 배정을 **표에 적는다** — 좌석 칸과 (gap 이 아니면) 벨트 칸.
 *
 * **여기서 순번([LinkFacePlan.slotIndex])도 함께 낸다.** 칸을 차지하기 직전에 고른 빈 칸이
 * 곧 "이 그룹이 몇 번째 칸을 쓰나" 이므로, 확정과 순번은 **같은 순간의 같은 사실**이다.
 * 나눠 두면 나중 단계가 같은 누적을 다시 세야 한다(옛 `placeLedger`).
 *
 * 예전엔 장부 둘(`used`·`faceGroups`)을 따로 밀고 셋째(`lanes`)에 구간을 얹었다. 지금은
 * **주인을 적는 일 한 번**이고, 옛 두 수는 그 주인들을 세면 나온다([seatsTaken]·[groupsOn]).
 */
export function commitLinkFace(
  ctx: LinkFaceContext,
  cand: LinkFaceCandidate,
  side: "from" | "to",
  /**
   * **레인 합류의 둘째 줄** — 청구가 다르다.
   *
   * ```
   * 끝        안 청구한다  물리 벨트당 하나여야 한다(첫 줄이 이미 청구했다)
   * 포트 칸    안 청구한다  포트가 없다. 청구하면 **첫 줄의 벨트 행**을 자기 것으로 적는다
   * 비켜 가는 열 청구한다   깊이 +2 에서 첫 줄의 포트 행까지 올라간다(그게 합류 경로다)
   * ```
   */
  opts?: {
    /** 따르는 줄 — 위 표. */
    merged?: Record<string, never>;
    /**
     * **이끄는 줄** — 포트가 옆이 아니라 **깊이 +1 열**로 옮겨 간다(벨트가 거기서 꺾여
     * 합류 칸이 되기 때문이다). 그래서 청구할 칸도 그 열이다 — 옛 [portCells] 를 쓰면
     * **엉뚱한 열을 적어** 합류 칸이 장부에 없는 채로 남고, 방출에서 남과 부딪힌다
     * (2026-09-04 실측: `unrouted-lines` + 안전망 1회).
     */
    mergeLead?: boolean;
  },
): LinkFacePlan {
  const isGap = cand.face === "N" || cand.face === "S";
  const table = tableOf(ctx, cand.face);
  // **칸을 차지하기 전에** 잰다 — [beltRowSpan] 이 빈 칸을 읽어 시작 행을 안다.
  const span = isGap ? undefined : beltRowSpan(ctx, cand.face, cand.arms);
  // gap 면의 좌석은 **포트 쪽부터** 채운다 — 출력 포트는 서쪽, 입력 포트는 동쪽이다.
  // (W/E 면은 나가는 쪽이 면과 수직이라 이 순서와 무관하다 — 늘 위→아래.)
  const fromEast = isGap && side === "to";
  const owner = takeOwner(table);
  const slotIndex = new Map<number, number[]>();
  // 머신 index 오름차순 — 방출 순서가 결정적이어야 한다.
  for (const [mi, k] of [...cand.arms].sort((a, b) => a[0] - b[0])) {
    // W/E 는 빈 칸을 앞에서부터(유체 칸은 이미 차 있어 저절로 건너뛴다),
    // gap 은 **동쪽 끝에서부터** — 막힌 면의 [[ParallelBelt]]가 "포트에 가까운 그룹이 얕은 줄"
    // 이라야 성립하고, 입력의 포트는 동쪽이기 때문이다.
    const base = seatsTaken(table, mi);
    const slots = fromEast
      ? Array.from({ length: k }, (_, j) => table.rowsPerMachine - 1 - base - (k - 1 - j))
      : freeSeatRows(table, mi).slice(0, k);
    claimSeats(table, mi, slots, owner);
    slotIndex.set(mi, slots);
  }
  // 벨트·합류·포트 칸 — **도형은 [linkShape] 한 곳에서 온다**(2026-09-12 D1). 방출기가
  // 부르는 그 함수이고, 여기서는 **순번 축**으로 부를 뿐이다(방출은 좌표 축).
  //
  // gap(N/S)은 안 적는다. 그쪽은 모두가 서쪽 변까지 달려야 해서 겹침을 행이 아니라
  // **반출 깊이**(`exitDepth`)로 푼다 — 자원의 모양이 아예 다르다(그래서 도형도 갈릴 일이 없다).
  if (span) {
    const end = flowEnd(cand);
    const dir = end === "S" ? 1 : -1;
    /** 기둥 **밖** 첫 행 — 합류는 여기서 일어난다. */
    const outRow = dir > 0 ? table.rowsPerMachine * table.machineCount : -1;
    const shape = linkShape({
      role: side === "from" ? "output" : "input",
      clusterBeltDepth: cand.clusterBeltDepth,
      portEnd: cand.portEnd,
      flowToSouth: end === "S",
      mergeRole: opts?.merged ? "follow" : opts?.mergeLead ? "lead" : undefined,
      rows: span,
      outRow,
    });
    // **청구는 칸의 종류가 가른다** — 벨트는 표에 바로 적고(구간이라 기둥 밖도 표가 든다),
    // 합류 칸·포트는 [splitByTable] 로 표 안/밖을 갈라 밖은 `ctx.outside` 가 든다.
    // 그 비대칭은 오늘의 규약 그대로다 — **도형만 한 곳으로 모으고 청구 정책은 안 건드린다**
    // (건드리면 배치가 바뀐다. 장부를 하나로 접는 것은 `구간-밖-주행` A2 의 일이다).
    const band = ctx.outside.get(cand.face) ?? new Set<string>();
    for (const c of shapeCells(shape)) {
      if (c.kind === "belt") { claimDepth(table, c.depth, c.t, c.t, owner); continue; }
      const o = outsideOf(c.t, table);
      if (o) band.add(outsideKey(o, c.depth));
      else claimDepth(table, c.depth, c.t, c.t, owner);
    }
    ctx.outside.set(cand.face, band);
  }
  if (cand.portEnd && !opts?.merged) {
    const set = ctx.ends.get(cand.face) ?? new Set<"N" | "S">();
    set.add(cand.portEnd);
    ctx.ends.set(cand.face, set);
  }
  return {
    ...cand, slotIndex,
    // **역할은 배정이 정하고 방출은 따르기만 한다**(F2). 청구한 도형과 놓는 도형이 한 판정에서 난다.
    mergeRole: opts?.merged ? "follow" : opts?.mergeLead ? "lead" : undefined,
  };
}

/**
 * **짝의 둘째 줄을 첫 줄의 벨트에 얹는다** — 레인 공유
 * (`docs/factorio/belt-lane-semantics.md` · `tempPlanDocs/벨트-레인/`).
 *
 * ## 비대칭이 이 함수의 존재 이유다
 * ```
 * 싣는 쪽(자식)   벨트 **둘**  — 팔이 각자 먼 레인에 떨궈야 두 레인이 다 찬다
 * 집는 쪽(부모)   벨트 **하나** — 합류한 벨트가 벽의 한 칸으로 들어온다
 * ```
 * 그래서 이 함수는 **집는 쪽에서만** 불린다. 싣는 쪽은 오늘처럼 각자 자기 벨트를 잡는다.
 *
 * ## 무엇을 다시 청구하고 무엇을 안 하나
 * ```
 * 좌석(d1)   **자기 것** — 팔은 줄마다 따로 앉는다
 * 벨트 칸     안 한다 — 첫 줄이 이미 잡았고, 그게 곧 **같은 물리 벨트**라는 뜻이다
 * 포트 칸     안 한다 — 포트도 하나다(논리 포트 둘이 한 셀)
 * 기둥 끝     안 한다 — 끝 장부는 물리 벨트당 하나여야 한다
 * ```
 *
 * **깊이·면·팔 종류를 고르지 않는다** — 첫 줄이 정한 것을 그대로 받는다. 고르는 순간 두 줄이
 * 다른 벨트에 앉고, 그러면 합류한 벨트가 먹일 곳이 없어진다.
 *
 * `undefined` = **좌석이 모자라다.** 그때 호출자는 짝을 풀고 오늘처럼 각자 앉힌다 —
 * 반쪽만 공유된 상태를 남기지 않는다.
 */
export function seatOnSharedBelt(
  ctx: LinkFaceContext,
  group: Link,
  side: "from" | "to",
  shared: LinkFacePlan,
): LinkFacePlan | undefined {
  if (shared.face === "N" || shared.face === "S") return undefined; // gap 은 폭이 자원이라 다르다
  const table = tableOf(ctx, shared.face);
  const inserter = inserterForReach(ctx.inserters ?? [], shared.reach);
  if (!inserter) return undefined;
  const arms = armsAt(group, side, inserter);
  if (arms.size === 0) return undefined;

  // **좌석이 되는지 먼저 다 확인하고** 나서 청구한다 — 반쯤 앉히면 되돌릴 길이 없다.
  const want = new Map<number, number[]>();
  for (const [mi, k] of [...arms].sort((a, b) => a[0] - b[0])) {
    const slots = freeSeatRows(table, mi).slice(0, k);
    if (slots.length < k) return undefined;
    want.set(mi, slots);
  }
  const owner = takeOwner(table);
  for (const [mi, slots] of want) claimSeats(table, mi, slots, owner);
  // 벨트·포트 칸·기둥 끝은 **안 청구한다** — 첫 줄의 것을 그대로 쓴다.
  return { ...shared, arms, slotIndex: want, mergeRole: undefined, sharesBelt: true };
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
  groups: Link[],
  side: "from" | "to",
  prefer: PortFace,
): FaceAllocation {
  const plans: (LinkFacePlan | undefined)[] = groups.map(() => undefined);
  const deferred: number[] = [];
  // **선호 면의 사유만 모은다** — 사다리는 그 줄이 *원래 앉고 싶던* 면의 못으로 자른다.
  // 다른 면으로 밀려나는 것은 넘침 단계가 이미 시도하고 실패한 뒤다(`trunk-assignment.md` §15 ⑤).
  const shortages: DepthShortage[][] = groups.map(() => []);
  groups.forEach((g, i) => {
    const cand = tryLinkFace(ctx, g, side, prefer, false, shortages[i]);
    if (cand) plans[i] = commitLinkFace(ctx, cand, side);
    else deferred.push(i);
  });
  return { plans, deferred, shortages };
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
  groups: Link[],
  side: "from" | "to",
  out: FaceAllocation,
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
 * 한쪽 면이 먹는 줄 = 좌석(d1) … 벨트(d`clusterBeltDepth`) = `clusterBeltDepth` 줄. 양쪽이 쓰면 각자
 * 자기 머신 면에서 재므로 그냥 더해진다(위 머신은 위에서, 아래 머신은 아래에서 센다).
 *
 * 이 수는 방출기가 벨트를 놓을 때 쓰는 `clusterBeltDepth` **바로 그 값**이다 — 상수를 따로 적어두면
 * 방출 기하가 바뀔 때 폭이 조용히 안 따라와 벨트가 옆 머신 몸통에 놓인다.
 */
export function gapRowsFromPlans(count: number, plans: (LinkFacePlan | undefined)[][]): number[] {
  // 같은 면의 그룹들은 **덮어쓰는 게 아니라 한 줄씩 더 깊어지므로** 가장 깊은 것 하나만
  // 세고(max), 마주 보는 두 면은 각자 자기 쪽에서 재므로 더한다(sum).
  const deepest = new Map<string, number>(); // `gap:face` → 그 면이 먹는 줄 수
  for (const list of plans)
    for (const p of list) {
      if (!p || p.gap === undefined) continue;
      const key = `${p.gap}:${p.face}`;
      const d = p.exitDepth ?? p.clusterBeltDepth;
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
 * 벨트는 [LinkFacePlan.clusterBeltDepth] 지만 **포트 끝이 두 칸 더 깊다**: 인서터 `+1` · 상자 `+2`
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
      by[p.face] = Math.max(by[p.face] ?? 0, p.clusterBeltDepth + 2);
    }
  return by;
}

/**
 * 면마다 링크가 먹은 **최대 좌석 수**(머신 하나 기준) — planner 의 좌석 예산에서 뺄 값.
 *
 * W/E 만 반환하지 않는다 — 표는 [tryLinkFace] 가 N/S(gap 스필)에도 똑같이 만든다.
 * **지금은** planner 가 N/S 를 시도하는 유일한 경로(`input.nsFaces`)가 count=1 일 때만
 * 켜지고, gap 스필은 count≥2 일 때만 생겨 서로 상호배타라 이 값이 없어도 조용히 안 터졌다 —
 * 그건 우연이지 설계가 아니다. 계산해 둔 값을 버리지 않는 쪽이 항상 맞다
 * (2026-07-21, [발견 ③] 근치).
 *
 * **파이프 칸은 안 센다** — 이 값을 받는 `insertingPlanner` 가 유체 행을 이미 따로 뺀다
 * (`seatRowsOf` 의 `afterPipe − seatRowsUsed`). [seatsTaken] 이 그룹 칸만 세는 것이 그 짝이다.
 */
export function seatRowsByFace(
  tables: ReadonlyMap<PortFace, FaceTable>,
): Partial<Record<PlannedSide, number>> {
  const by: Partial<Record<PlannedSide, number>> = {};
  for (const [face, t] of tables) {
    let max = 0;
    for (let mi = 0; mi < t.machineCount; mi++) max = Math.max(max, seatsTaken(t, mi));
    by[face as PlannedSide] = Math.max(by[face as PlannedSide] ?? 0, max);
  }
  return by;
}
