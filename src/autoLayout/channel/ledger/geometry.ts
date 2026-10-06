/**
 * channelGeometryPlanner — 채널 예약을 "폭(트랙 수)"에서 "기하(누가 어느 트랙)"로
 * 승격하는 **통합 장부** (완전 교차 판정 + 해소 사다리).
 *
 * 단일 출처: docs/auto-layout-wizard.channel-geometry-reservation.md
 *
 * 한 채널을 지나는 두 종류 경로를 **한 장부에서** 같이 배정한다:
 *  - **납품 경로(deliveryRoute**, 현 코드 delivery): 자식 출력(E벽) → 부모 입력(W벽).
 *    양 끝 행은 포트가 정했고 자유는 세로 주행 트랙 하나 → 모양은 **계단꼴(staircase)**.
 *    출발 행 = 도착 행이면 일자 수평선(트랙 소비 0).
 *  - **반출 경로(exportRoute**, 현 코드 track): 갇힌 외부상자(벽의 한 점) → 열린 N/S 변.
 *    모양은 **한꺾임꼴(elbow)**.
 *
 * 핵심 판정 [fullCrossing]: 두 경로의 끝이 채널 테두리에서 **엇갈리면**(완전 교차) 트랙을 어떻게 골라도
 * 지상 경로가 기하적으로 존재하지 않는다 — 행 · 벽 비교만으로, 트랙을 고르기 전에 끝난다. 납품 × 납품 · 납품 × 반출 ·
 * 반출 × 반출 모두 같은 판정이다. 완전 교차면 **해소 사다리**(`channel/policy.settleFullCrossings`):
 *   ① 반출이 끼었으면 진출 변 N↔S 뒤집기 — 납품을 새로 안 가둘 때만(반출끼리는 반출 차례에서 다시 푼다)
 *   ② 들어갈 수 있는 쪽이 땅속으로(지하 횡단 — 탐색 아닌 좌표 배정) — 상대 많은 쪽, 벨트 × 파이프가 같으면 파이프
 *   ③ 아무도 못 들어가면 실패 비용이 낮은 쪽이 땅 위를 잃는다 → fallback 마킹(감지 · 로그, 조용한 회귀 아님)
 *
 * 납품끼리(문서 §5): 분리=트랙 공유(백트래킹이 자연 해결), 부분 겹침=**열 갈아타기
 * (columnSwitch)**, 완전 교차=사다리로.
 *
 * **폭 역전(문서 §6)**: 트랙·행 배정을 먼저 끝내고 `trackCount` 는 그 결과에서 나온다.
 * 채널 폭 = `channelWidthFromTracks(trackCount, …)` 는 호출자(modulePacking) 책임.
 *
 * **이 모델이 못 그리는 것**은 `docs/auto-layout/common/layout-models.md` §2③ 에 있다 —
 * 특히 *"포트가 채널 벽을 마주 본다"* 는 전제(코드에서의 이름은 `modulePacking.eligible`).
 * 그 전제가 깨지면 계단꼴이 모듈 몸통을 관통하는 경로를 그린다(2026-08-18 실측 `planned = 0`).
 *
 * 좌표계: 추상 (열, 행). 열 = 트랙 0..T-1(서→동) + 가상 벽 마진(W쪽 -1, E쪽 trackCap).
 * 절대 x 변환(트랙 → 채널 내부 x)은 호출자 책임. 순수·결정적.
 *
 * ## 사슬 — 한 칸 갈 때마다 모르던 것이 하나 정해진다
 *
 * ```
 * ⓪ 판       트랙 상한 · 벽 열 · id 순 · 유체와 아이템                   openChannelSheet
 * ① 완전 교차 풀기  반출마다 N/S · 땅 위를 내준 납품 · 반출(해소 사다리)   channel/policy.settleFullCrossings
 * ② 지상     후보(실패 비용 순) → 누가 어느 트랙 → 계획 객체              channel/policy.surfaceItemsOf · assignSurface · writeSurfacePlans
 * ③ 지하     막힌 셀 밑으로(사다리 2단) — 못 건너면 트랙을 끼운다 → 유체 폴백의 사유   crossUnderground · insertTrack · channel/policy.nameFluidFallbacks
 * ④ 폭       폴백 경로 · 잔여 구간의 유령 세로선 → trackCount(폭 역전)     reserveWidth · trackCountOf
 * ```
 *
 * 앞 칸은 뒤 칸의 산출을 안 읽는다 — ① 은 점유를, ② 는 지하 계획을 모른다. 경로의 모양 · 충돌 · 셀 순서열은
 * `channel/shape`(도형), 진출 변과 순서를 고르는 일은 `channel/policy`(정책)에 있다. **이 파일에 남는 것은 트랙을 잡는
 * 장부**(배정 · 지하 청구 · 폭 예약)와 순서를 쥐는 뼈대다. 장부 단계를 통로 장부 파일(`channel/ledger`)로 안 옮긴 이유는
 * 그 파일의 `planChannels` 가 이 함수를 부르기 때문이다 — 옮기면 두 파일이 서로를 런타임으로 부른다.
 */

import type {
  ChannelGeometryPlan,
  DeliveryInput,
  DeliveryPlan,
  ExportInput,
  ExportPlan,
  GeometryContext,
  Jump,
} from "../types";
import type { UndergroundCorridor } from "../../shared/types";
import { isJumpAllowed } from "../../shared/route";
import { corridorBetween } from "../../shared/cells/path";
import { PIPE_BLOCK_GROUP } from "../../shared/grid";
import {
  cellsOf,
  columnSwitchShape,
  edgeRowOf,
  conflicts,
  conflictsAny,
  exportCells,
  placedOf,
  shapeFromCells,
  staircaseCells,
  vseg,
  type Cell,
  type Placed,
  type Shape,
} from "../shape";
import {
  nameFluidFallbacks,
  settleFullCrossings,
  surfaceItemsOf,
  type ExitSides,
  type SurfaceItem,
} from "../policy";
import { assignTracksLeftEdge } from "./tracks";

/** trackCap 미지정 시의 하한 — 경로가 적어도 이만큼의 트랙은 골라 쓸 수 있게. */
const MIN_TRACK_CAP = 8;
/** 백트래킹 탐색 노드 예산 — 소진 시 탐욕 단계로 넘어간다(결정적). */
const SEARCH_BUDGET = 200000;

// ─────────────────────────────────────────────────────────────────────────────
// 지하 횡단 — 막힌 셀 밑을 건너 계단꼴을 성립시킨다 (문서 §4.4 사다리 ②)
// ─────────────────────────────────────────────────────────────────────────────

/** placedShapes 를 셀 집합으로 편다 — 점프 계산은 셀 단위라야 거리(k)가 정확하다. */
function occupiedCells(placed: ReadonlyArray<Placed>): Set<string> {
  const occ = new Set<string>();
  for (const p of placed) for (const k of cellsOf(p.shape)) occ.add(k);
  return occ;
}

/**
 * **땅속으로 건널 경로 하나** — 납품(계단꼴)이든 반출(한꺾임꼴)이든 장부가 보는 것은 이것뿐이다. 경로의 종류는 규칙에
 * 안 나오고 값으로만 온다(docs/auto-layout/common/layout-models.md §3.5 제2조).
 */
interface JumpRoute {
  /** 트랙 `t` 를 쓸 때의 셀 순서열 — 상자 쪽에서 시작한다. 첫 칸은 입구가 못 된다(E벽 마진은 가상 열이다). */
  cellsAt: (t: number) => Cell[];
  /** 세로 주행이 덮는 행 — 같은 트랙의 다른 세로선과 겹치면 그 트랙은 못 쓴다. */
  lo: number;
  hi: number;
  fluid?: string;
  /**
   * **끝에서 땅 위에 그대로 있어야 하는 칸 수** — 입구 · 출구도, 땅속 구간도 못 된다. 납품은 0(순서열이 상자 앞에서 끝난다).
   * 반출은 순서열이 바깥 변의 상자 자리까지 가므로 벨트는 둘(피더 · 상자), 파이프는 하나(무한파이프)다.
   */
  tail: number;
}

/**
 * 경로 하나를 **막힌 셀 밑을 건너서** 배치한다 — 땅 위를 내준 경로 · 지상 배정이 실패한 경로의 해법.
 *
 * 트랙을 오름차순으로 훑으며, 그 트랙의 도형을 셀 순서열로 펴고 **막힌 구간마다 점프**를
 * 만든다. 점프가 성립하려면:
 *  - 세로 주행이 통째로 비어 있어야 한다(트랙은 지상 전용 — 몸통이 지하로 숨으면 다른
 *    경로가 그 위를 지나가도 되는지 알 수 없다).
 *  - 막힌 구간의 **양 끝 바깥 셀**(지하 입구·출구)이 비어 있어야 한다.
 *  - 입구·출구가 **같은 축**이어야 한다 — 코너를 물면 지하벨트가 못 꺾어 기각.
 *  - 거리가 지하 사거리(벨트 `maxJump` · 파이프 `maxJumpPipe`) 안이어야 한다.
 *  - 체인 양 끝(상자 자리)은 점프로 못 덮는다.
 *  - **짝을 안 가로챈다** — 같은 줄(행 · 열) 위에서 같은 무리(파이프 하나 · 벨트 하나)의 다른 점프와 구간이 겹치면
 *    한쪽 입구가 남의 출구와 짝이 된다(`shared/route.isJumpAllowed` — 라우터와 같은 규칙. 좌표는 채널의 추상 열이지만 평행
 *    이동이라 겹침의 답이 같다). 이 장부가 지금까지 깐 점프가 `corridors` 다.
 *
 * **유체는 둘이 더 붙는다** — 다른 유체의 파이프에 **닿기만 해도** 한 관망이 되므로 그 둘레(halo)도 막힌 칸으로 친다
 * (출구가 halo 밖으로 밀린다). 그리고 마지막 겹침 검사가 유체의 halo 를 함께 본다.
 */
function placeWithJumps(
  route: JumpRoute,
  placed: ReadonlyArray<Placed>,
  cap: number,
  maxJump: number,
  corridors: ReadonlyArray<UndergroundCorridor>,
  /** 이 트랙 하나만 본다 — 끼운 트랙으로 건너 볼 때([crossUnderground] 의 넓히기). */
  only?: number,
): { track: number; jumps: Jump[]; shape: Shape } | null {
  if (maxJump < 2) return null; // 지하 사거리 없음 — 건널 방법이 없다.
  const occ = occupiedCells(placed);
  // 다른 유체의 둘레 — 거기 지상 칸(입구 · 출구 포함)을 두면 두 관망이 닿는다
  if (route.fluid !== undefined)
    for (const p of placed) if (p.fluid !== undefined && p.fluid !== route.fluid && p.halo) for (const k of p.halo) occ.add(k);
  const free = (c: Cell) => !occ.has(`${c.col},${c.row}`);
  const { lo, hi, tail } = route;

  for (let t = only ?? 0; t < (only === undefined ? cap : only + 1); t++) {
    // 세로 주행은 **지상 전용**이다 — 다른 세로선이 같은 트랙의 같은 행에 있으면 후보 탈락.
    // (남의 *가로선* 이 내 세로선을 가로지르는 건 괜찮다 — 그건 아래 점프가 건넌다.)
    const trackTaken = placed.some((p) => p.shape.v.some((v) => v.col === t && v.r1 <= hi && lo <= v.r2));
    if (trackTaken) continue;

    const cells = route.cellsAt(t);
    const blocked = cells.map((c) => !free(c));
    if (blocked[0] || blocked[cells.length - 1]) continue; // 상자 자리가 막힘
    // 끝의 고정 칸(피더 · 상자)이 막혔으면 건널 수 없다 — 땅속 구간이 그 칸을 덮을 수 없다.
    if (blocked.slice(cells.length - tail).some(Boolean)) continue;
    /** 출구가 설 수 있는 마지막 칸. */
    const lastExit = cells.length - 1 - tail;
    /** 순서열에서 방향이 바뀌는 칸 — 들어온 방향과 나가는 방향이 다르다. */
    const isCorner = (k: number): boolean =>
      k > 0 && k < cells.length - 1 &&
      (cells[k].col - cells[k - 1].col !== cells[k + 1].col - cells[k].col ||
        cells[k].row - cells[k - 1].row !== cells[k + 1].row - cells[k].row);

    const jumps: Jump[] = [];
    const underground = new Array(cells.length).fill(false);
    let ok = true;
    for (let i = 0; i < cells.length && ok; ) {
      if (!blocked[i]) { i += 1; continue; }
      // 지하 입구는 **지상 belt** 여야 한다. 셀 순서열의 첫 칸은 E벽 마진(capCol)이고,
      // 그 열이 입구가 되면 절대 x 로 옮길 근거가 없다(capCol 은 가상 열이라 트랙처럼
      // 1:1 로 대응되지 않는다) → 거부. 반대로 **마지막 칸(-1)은 진짜 채널 셀**이다
      // (tx(-1) = 채널 첫 열). 상자는 그보다 한 칸 더 서쪽이라 순서열에 없다 — 그래서
      // 출구가 -1 이어도 상자를 덮지 않는다. 여기를 막으면 "트랙 바로 서쪽이 막힌" 흔한
      // 반출-납품 교차가 통째로 폴백으로 샌다.
      if (i - 1 === 0) { ok = false; break; }

      // 출구 자리 고르기. 지하벨트는 **위에 뭐가 있든 상관없이** 입구에서 출구까지
      // 통째로 지나간다 — 그래서 막힌 칸만 딱 맞춰 건널 이유가 없고, 필요하면 빈 칸
      // 밑으로도 지나간다. 출구는 두 조건을 만족하는 첫 칸이다:
      //   ① 그 칸이 비어 있다(지상 belt 를 놓을 자리).
      //   ② 바로 다음 칸이 막혀 있지 않다.
      // ②가 없으면 이 점프의 **출구와 다음 점프의 입구가 같은 칸**이 된다 — 한 칸에
      // 지하벨트 두 개는 못 놓는다. 그래서 "빈 칸 하나만 두고 또 막힌" 배치는 두 번
      // 나눠 건너지 못하고 **한 번에 길게** 건넌다(그래서 아래 dist 가 자란다).
      let e = i;
      while (e < cells.length && (blocked[e] || (e + 1 < cells.length && blocked[e + 1]))) e += 1;
      if (e > lastExit) { ok = false; break; } // 끝까지 막힘 — 나갈 자리가 없다(고정 칸에는 못 나간다)

      const from = cells[i - 1];
      const to = cells[e];
      const straight = from.col === to.col || from.row === to.row;
      const dist = Math.abs(to.col - from.col) + Math.abs(to.row - from.row);
      // 코너를 물면 입구·출구가 축이 어긋나거나(straight 실패) 거리가 셀 수와 안 맞는다.
      const spansCorner = dist !== e - i + 1;
      if (!straight || spansCorner || dist > maxJump) { ok = false; break; }
      // **출구는 꺾이는 칸에 못 선다** — 지하벨트 출구는 제 방향으로만 내놓고, 지하파이프는 땅 위 쪽 한 방향으로만 이어진다.
      // 꺾이는 칸의 출구는 경로의 다음 칸이 아니라 그 옆으로 내놓는다 — 끊긴 길이다. **입구**는 매체가 가른다: 지하파이프는
      // 옆과 안 이어지므로 못 서고, 지하벨트는 옆에서 받으면 한 레인만 받는다(옆 싣기) — 줄 하나는 원래 한 레인이라 그대로 둔다
      // (두 레인을 쓰는 합류 벨트는 반이 된다 — 남은 위험). 2026-10-02 까지 이 장부엔 이 규칙이 없어 꺾이는 칸에 출구를 둔
      // 계획이 방출됐다. 탐색 라우터는 둘 다 직진만 허용한다(`shared/route.dijkstraWithJumps` 의 입구 직진 · 출구 직진).
      if (isCorner(e) || (route.fluid !== undefined && isCorner(i - 1))) { ok = false; break; }
      if (!isJumpAllowed(from.col, from.row, to.col, to.row, corridors)) { ok = false; break; }
      jumps.push({ fromCol: from.col, fromRow: from.row, toCol: to.col, toRow: to.row });
      for (let m = i; m < e; m++) underground[m] = true;
      i = e;
    }
    if (!ok || jumps.length === 0) continue;

    const shape = shapeFromCells(cells, underground);
    // 방어 — 위 판정이 놓친 겹침. 유체면 halo 를 붙여 다른 유체와의 **인접**까지 본다.
    if (conflictsAny(placedOf(shape, route.fluid), placed)) continue;
    return { track: t, jumps, shape };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **들어간 쪽이 못 건너면 땅 위로 돌아온다.** ① 의 해소 사다리는 들어갈 수 있는 쪽을 땅속으로 보내는데, 정말
 * 건너지나는 ③ 이 트랙을 받고서야 안다. 못 건넌 유체 납품 · 반출이 있으면 그 경로를 *"못 들어가는 쪽"* 으로 표시하고
 * 처음부터 다시 배정한다 — 그러면 같은 사다리가 그 경로에게 땅 위를 주고 상대가 들어간다(그 경로가 들어갈 수 없던 때의
 * 답). 다시 돌 때마다 표시가 하나 이상 늘므로 그런 경로 수만큼 돌면 끝난다. 아이템 납품은 돌아오지 않는다 — 못 건너면
 * 폴백(방출의 탐색)이다.
 */
export function planChannelGeometry(
  deliveriesIn: ReadonlyArray<DeliveryInput>,
  exportsIn: ReadonlyArray<ExportInput>,
  ctx: GeometryContext,
): ChannelGeometryPlan {
  const noDive = new Set<string>();
  for (;;) {
    const { plan, failedDivers } = planOnce(deliveriesIn, exportsIn, ctx, noDive);
    if (failedDivers.length === 0) return plan;
    for (const id of failedDivers) noDive.add(id);
  }
}

function planOnce(
  deliveriesIn: ReadonlyArray<DeliveryInput>,
  exportsIn: ReadonlyArray<ExportInput>,
  ctx: GeometryContext,
  noDive: ReadonlySet<string>,
): { plan: ChannelGeometryPlan; failedDivers: string[] } {
  // ⓪ 판 — 트랙 상한 · 벽 열 · id 순 · 유체와 아이템 · 빈 계획. 아직 어느 경로도 트랙이 없다
  const sheet = openChannelSheet(deliveriesIn, exportsIn, ctx);
  // ① 완전 교차 풀기 — 끝이 엇갈린 쌍을 해소 사다리로. 행 · 벽 비교만. 끝나면 남은 후보끼리 완전 교차가 없다
  const sides = settleFullCrossings(
    sheet.deliveries, sheet.exports_, sheet.fluidDels, sheet.itemDels, sheet.deliveryPlans, sheet.exportPlans, ctx,
    { maxJump: ctx.maxJump ?? 0, maxJumpPipe: ctx.maxJumpPipe ?? 0, noDive },
  );
  // ② 지상 — 누가 어느 트랙. 실패 비용 순 → 폭 최소 백트래킹(밀도부터) → 막히면 탐욕 + 열 갈아타기
  const items = surfaceItemsOf(sides, sheet.exports_, ctx, sheet.cap, sheet.capCol);
  const { assigned, greedy } = assignSurface(sheet, sides, items);
  writeSurfacePlans(sheet, sides, assigned);
  // ③ 지하 — ①에서 땅 위를 내준 납품 · 반출(파이프 먼저) · ②에서 자리를 못 받은 아이템은 막힌 셀 밑으로
  const failedDivers = crossUnderground(sheet, sides, ctx);
  nameFluidFallbacks(sheet.fluidDels, sheet.deliveryPlans);
  // ④ 폭 — 폴백 경로 · 잔여 구간도 세로 구간만큼 트랙을 잡는다. 폭은 이 결과다(폭 역전)
  reserveWidth(sheet, ctx);
  const plan: ChannelGeometryPlan = {
    deliveries: sheet.deliveryPlans,
    exports: sheet.exportPlans,
    trackCount: trackCountOf(sheet.placedShapes),
    crossingYields: sides.yieldedDeliveries.size + sides.yieldedExports.size,
    greedy,
    fluidDives: sheet.fluidDels.filter((d) => sheet.deliveryPlans.get(d.id)?.kind === "undergroundCrossing").length,
    exportDives: sheet.exports_.filter((x) => sheet.exportPlans.get(x.id)?.kind === "undergroundCrossing").length,
    widenedTracks: sheet.widened,
  };
  return { plan, failedDivers };
}

/**
 * **⓪ 판** — 한 번의 배정이 처음부터 끝까지 함께 쓰는 것. 단계가 새로 아는 것(진출 변 · 누가 어느 트랙)은 여기
 * 안 싣고 단계의 반환으로 넘긴다 — 그래야 뼈대에서 *"누가 무엇을 알고 들어오나"* 가 보인다.
 *
 * 계획 둘과 `placedShapes` 는 단계마다 **쌓인다.** 넣는 순서(계획)와 쌓는 순서(도형)가 뒤 단계의 답을 바꾸는
 * 입력이라, 단계 순서가 곧 결과다.
 */
interface ChannelSheet {
  /** 트랙 수 상한. ③ 이 트랙을 끼우면 하나 는다([insertTrack]). */
  cap: number;
  /** E벽 마진의 추상 열(`cap + 1`). ③ 이 트랙을 끼우면 함께 한 칸 동쪽으로 간다. */
  capCol: number;
  /** **관측** — ③ 이 건너는 쪽에게 자리를 만들려고 끼운 트랙 수(계획이 넓힌다 — 제4조 ④). */
  widened: number;
  /** id 순. */
  deliveries: DeliveryInput[];
  /** id 순. */
  exports_: ExportInput[];
  fluidDels: DeliveryInput[];
  itemDels: DeliveryInput[];
  deliveryPlans: Map<string, DeliveryPlan>;
  exportPlans: Map<string, ExportPlan>;
  placedShapes: Placed[];
}

/** 경로 하나의 지상 배정 — 확정 도형(유체면 halo 포함)과 트랙. */
type Assignment = { placed: Placed; track: number | null };

/** **⓪ 판 차리기** — 트랙 상한 · 벽 열 · id 순 · 유체와 아이템 · 빈 계획 둘 · 빈 점유. */
function openChannelSheet(
  deliveriesIn: ReadonlyArray<DeliveryInput>,
  exportsIn: ReadonlyArray<ExportInput>,
  ctx: GeometryContext,
): ChannelSheet {
  // 경로마다 자기 트랙을 줘도 충분하다는 것이 상한의 근거(세로선은 트랙이 다르면 절대
   // 안 겹친다). 폭은 여기서 안 정해진다 — 배정 결과(trackCount)에서 나온다(폭 역전).
  const cap = ctx.trackCap ?? Math.max(MIN_TRACK_CAP, deliveriesIn.length + exportsIn.length);
  // E벽 마진의 추상 열. **트랙보다 두 칸 위**에 둔다 — 그래야 "가장 동쪽 트랙"이 막혀도
  // 지하 입구가 그 동쪽의 *실재하는* 채널 셀에 앉는다(capCol 자신은 가상 열이라 안 됨).
  const capCol = cap + 1;
  const deliveries = [...deliveriesIn].sort((a, b) => a.id.localeCompare(b.id));
  const exports_ = [...exportsIn].sort((a, b) => a.id.localeCompare(b.id));

  const deliveryPlans = new Map<string, DeliveryPlan>();
  const exportPlans = new Map<string, ExportPlan>();

  // 실패 비용 순 — 이 순서가 아래 ①·②를 모두 지배한다(docs/…fluid-delivery-reservation.md §4.3).
  //   1. 유체 납품 — 지하로 못 도망간다(§D2). 배정 실패 = **트리 전체 실패**.
  //   2. 반출     — 실패해도 상자가 로컬 ring 에 남는다. 되돌릴 수 있는 손해.
  //   3. 아이템 납품 — 실패하면 ③ 지하 횡단이 회수한다. 사실상 손해 없음.
  // 그래서 유체가 지상을 먼저 갖고, 교차하는 아이템이 **밑으로 지나간다**. 교차 자체는
  // 배정을 잘해서 없앨 수 있는 게 아니다(Jordan — DeliveryPlan.undergroundCrossing 주석).
  const fluidDels = deliveries.filter((d) => d.fluid !== undefined);
  const itemDels = deliveries.filter((d) => d.fluid === undefined);

  const placedShapes: Placed[] = []; // 확정된 모든 도형(불변식: 서로소 + 유체 인접 없음)
  return { cap, capCol, widened: 0, deliveries, exports_, fluidDels, itemDels, deliveryPlans, exportPlans, placedShapes };
}

/**
 * **② 배정** — 누가 어느 트랙. 폭 최소 백트래킹이 풀면 그 해를, 못 풀면(예산 소진 포함) 탐욕 + 열 갈아타기.
 * 탐욕이 못 앉힌 경로와 열 갈아타기는 계획을 여기서 **먼저** 적는다 — [writeSurfacePlans] 가 그 계획을 건너뛴다.
 *
 * **폭은 밀도에서 시작한다** — 세로 구간이 겹치는 둘은 같은 트랙에 못 오므로(충돌 규칙 1) 밀도보다 좁은 폭은 반드시
 * 실패하고, 그 실패의 증명이 전 탐색이라 예산만 태운다(`docs/auto-layout/channel/channel-geometry-reservation.md` §10.4 T-A).
 * ① 이 완전 교차를 다 풀었으므로 남은 후보는 해가 있는 입력이다 — `greedy` 는 그래도 탐욕으로 간 채널을 센다(관측).
 */
function assignSurface(
  sheet: ChannelSheet,
  sides: ExitSides,
  items: ReadonlyArray<SurfaceItem>,
): { assigned: Map<string, Assignment>; greedy: boolean } {
  const { cap, capCol, deliveryPlans, exportPlans, placedShapes } = sheet;
  const { surfaceDels } = sides;
  // ── ② 지상 배정 — iterative-deepening 백트래킹(폭 최소 우선, 결정적) ──
  const assigned = new Map<string, { placed: Placed; track: number | null }>();
  const budget = { left: SEARCH_BUDGET };
  type Acc = { id: string; placed: Placed; track: number };
  const search = (idx: number, T: number, acc: Acc[]): boolean => {
    if (idx === items.length) return true;
    const item = items[idx];
    const tMax = Math.min(item.max, T);
    for (let t = 0; t < tMax; t++) {
      if (budget.left-- <= 0) return false;
      const shape = item.candidates(t);
      if (!shape) continue;
      const cand = placedOf(shape, item.fluid);
      if (acc.some((a) => conflicts(cand, a.placed))) continue;
      acc.push({ id: item.id, placed: cand, track: t });
      if (search(idx + 1, T, acc)) return true;
      acc.pop();
    }
    return false;
  };
  let solved: Acc[] | null = null;
  // 밀도 — 후보들의 세로 구간(트랙과 무관 — 0번 트랙의 도형에서 읽는다)이 한 행에서 가장 많이 겹치는 수.
  const density = assignTracksLeftEdge(
    items.flatMap((it) => it.candidates(0)?.v ?? []).map((v) => ({ lo: v.r1, hi: v.r2 })),
  ).trackCount;
  for (let T = Math.max(1, density); T <= cap && !solved; T++) {
    const acc: Acc[] = [];
    if (search(0, T, acc)) solved = acc;
    if (budget.left <= 0) break;
  }

  if (solved) {
    for (const a of solved) {
      assigned.set(a.id, { placed: a.placed, track: a.track });
      placedShapes.push(a.placed);
    }
  } else {
    // 탐욕 폴백(드묾): items 순서대로 first-fit, 납품은 실패 시 열 갈아타기까지.
    // **여기서 유체가 맨 앞이라는 사실이 값을 한다** — 전 배정 탐색이 실패하는 트리
    // (교차가 불가피하면 늘 실패한다)에서 유체가 지상 자리를 먼저 집는다.
    for (const item of items) {
      let done = false;
      for (let t = 0; t < item.max && !done; t++) {
        const shape = item.candidates(t);
        const cand = shape && placedOf(shape, item.fluid);
        if (cand && !conflictsAny(cand, placedShapes)) {
          assigned.set(item.id, { placed: cand, track: t });
          placedShapes.push(cand);
          done = true;
        }
      }
      if (done) continue;
      const d = surfaceDels.find((dd) => dd.id === item.id);
      if (d && d.startY !== d.endY) {
        const sw = tryColumnSwitch(d, placedShapes, cap, capCol);
        if (sw) {
          deliveryPlans.set(d.id, sw.plan);
          placedShapes.push(placedOf(sw.shape, d.fluid));
          continue;
        }
      }
      // 배정 실패 — fallback(③) + 폭 예약은 아래 phantom 단계에서.
      if (d) deliveryPlans.set(item.id, { kind: "fallback", reason: "no-surface-assignment" });
      else exportPlans.set(item.id, { kind: "fallback", reason: "no-surface-assignment" });
    }
  }
  return { assigned, greedy: !solved };
}

/** **②′ 계획** — 배정을 계획 객체로 적는다. 배정을 **읽기만** 한다. */
function writeSurfacePlans(sheet: ChannelSheet, sides: ExitSides, assigned: ReadonlyMap<string, Assignment>): void {
  const { exports_, deliveryPlans, exportPlans } = sheet;
  const { exitOf, surfaceDels, yieldedExports } = sides;
  // 배정 결과 → 계획 객체. 땅 위를 내준 반출은 여기 안 온다 — 들어가는 반출은 ③ 이, 못 들어가는 반출은 ① 이 계획을 적는다.
  for (const x of exports_) {
    if (exportPlans.has(x.id) || yieldedExports.has(x.id)) continue;
    const a = assigned.get(x.id);
    if (a) exportPlans.set(x.id, { kind: "elbow", track: a.track!, exitEdge: exitOf.get(x.id)! });
    else exportPlans.set(x.id, { kind: "fallback", reason: "no-surface-assignment" });
  }
  for (const d of surfaceDels) {
    if (deliveryPlans.has(d.id)) continue;
    const a = assigned.get(d.id);
    if (!a) {
      deliveryPlans.set(d.id, { kind: "fallback", reason: "no-surface-assignment" });
    } else if (d.startY === d.endY) {
      deliveryPlans.set(d.id, { kind: "straight" });
    } else {
      deliveryPlans.set(d.id, { kind: "staircase", track: a.track! });
    }
  }
}

/**
 * **트랙 하나를 끼운다** — 열 `p` 와 그 동쪽(E벽 가상 열 포함)을 한 칸씩 민다. 쌓인 도형 · 계획의 트랙 · 점프 · 지하 장부가 함께
 * 옮겨진다. 배정의 유효성은 트랙의 **순서**에만 달렸으므로(`channel-geometry-reservation.md` §10.2 정리 1) 빈 열을 끼워도 쌓인
 * 경로끼리는 그대로 안 만난다 — 가로선은 새 열까지 늘어나고, 그 열엔 아직 아무 세로선이 없다.
 *
 * 다만 **가로로 놓인 점프가 새 열을 넘으면 한 칸 길어진다** — 그 매체의 사거리를 넘으면 이 자리엔 못 끼운다(`false`, 아무것도 안
 * 바꾼다). 세로 점프는 행이라 그대로다.
 */
function insertTrack(
  sheet: ChannelSheet,
  p: number,
  corridorLists: ReadonlyArray<UndergroundCorridor[]>,
  reachOf: (fluid: string | undefined) => number,
): boolean {
  const shift = (c: number) => (c >= p ? c + 1 : c); // W벽 가상 열 -1 은 언제나 p 보다 서쪽이다
  const stretched = (j: Jump) => j.fromRow === j.toRow && Math.min(j.fromCol, j.toCol) < p && p <= Math.max(j.fromCol, j.toCol);
  const fits = (jumps: readonly Jump[], fluid: string | undefined) =>
    jumps.every((j) => !stretched(j) || Math.abs(j.toCol - j.fromCol) + 1 <= reachOf(fluid));
  const fluidOfDelivery = new Map(sheet.deliveries.map((d) => [d.id, d.fluid]));
  const fluidOfExport = new Map(sheet.exports_.map((x) => [x.id, x.fluid]));
  for (const [id, plan] of sheet.deliveryPlans)
    if (plan.kind === "undergroundCrossing" && !fits(plan.jumps, fluidOfDelivery.get(id))) return false;
  for (const [id, plan] of sheet.exportPlans)
    if (plan.kind === "undergroundCrossing" && !fits(plan.jumps, fluidOfExport.get(id))) return false;

  const shiftJump = (j: Jump): Jump => ({ fromCol: shift(j.fromCol), fromRow: j.fromRow, toCol: shift(j.toCol), toRow: j.toRow });
  for (const [id, plan] of sheet.deliveryPlans) {
    if (plan.kind === "staircase") sheet.deliveryPlans.set(id, { ...plan, track: shift(plan.track) });
    else if (plan.kind === "columnSwitch")
      sheet.deliveryPlans.set(id, { ...plan, startTrack: shift(plan.startTrack), endTrack: shift(plan.endTrack) });
    else if (plan.kind === "undergroundCrossing")
      sheet.deliveryPlans.set(id, { ...plan, track: shift(plan.track), jumps: plan.jumps.map(shiftJump) });
  }
  for (const [id, plan] of sheet.exportPlans) {
    if (plan.kind === "elbow") sheet.exportPlans.set(id, { ...plan, track: shift(plan.track) });
    else if (plan.kind === "undergroundCrossing")
      sheet.exportPlans.set(id, { ...plan, track: shift(plan.track), jumps: plan.jumps.map(shiftJump) });
  }
  sheet.placedShapes.forEach((pl, i) => {
    sheet.placedShapes[i] = placedOf(
      {
        h: pl.shape.h.map((h) => ({ row: h.row, c1: shift(h.c1), c2: shift(h.c2) })),
        v: pl.shape.v.map((v) => vseg(shift(v.col), v.r1, v.r2)),
      },
      pl.fluid,
    );
  });
  for (const list of corridorLists)
    list.forEach((c, i) => {
      list[i] = c.axis === "v" ? { ...c, line: shift(c.line) } : { ...c, range: [shift(c.range[0]), shift(c.range[1])] };
    });
  sheet.cap += 1;
  sheet.capCol += 1;
  sheet.widened += 1;
  return true;
}

/**
 * **③ 지하** — 막힌 셀 밑으로 건넌 도형을 쌓고(청구), 못 건넌 아이템 납품에는 폴백의 사유를 적는다. 못 건넌 **유체 납품 ·
 * 반출**을 돌려준다 — [planChannelGeometry] 가 그 경로에게 땅 위를 주고 다시 배정한다.
 *
 * 누가 들어가나의 기준은 docs/auto-layout/common/layout-models.md §3.5(두점 라우팅 제4조 ③ — 상대가 많은 쪽 · 매체마다 규칙)다.
 */
function crossUnderground(sheet: ChannelSheet, sides: ExitSides, ctx: GeometryContext): string[] {
  // `cap` · `capCol` 은 넓히기([insertTrack])가 바꾸므로 그때그때 `sheet` 에서 읽는다.
  const { fluidDels, itemDels, exports_, deliveryPlans, exportPlans, placedShapes } = sheet;
  const { yieldedDeliveries, yieldedExports, exitOf } = sides;
  const maxJump = ctx.maxJump ?? 0;
  const maxJumpPipe = ctx.maxJumpPipe ?? 0;
  // ── ③ 지하 횡단(사다리 2단) — 지상에 자리가 없는 경로는 막힌 셀 **밑으로** 건넌다 ──
  //
  // 여기 오는 경로는 두 부류다: ①이 **완전 교차**에서 땅 위를 내주게 한 것(납품도 반출도), 그리고 ②에서 폭 · 탐욕
  // 때문에 자리를 못 받은 아이템 납품. 해법은 같다 — "내 길을 막은 셀 밑을 건넌다". 아이템 납품의 사유만 가른다:
  // 앞의 것이 못 건너면 `crossing-needs-underground`, 뒤의 것은 ②의 `no-surface-assignment` 그대로다.
  //
  // **파이프가 먼저 건넌다** — 지하파이프는 많이 쓸수록 좋다(사용자 2026-10-01). 파이프와 벨트는 짝을 안 다투므로
  // 장부가 둘이다. 같은 매체 안에서는 **납품 · 반출을 가리지 않고 id 순**이다 — 만난 두 경로는 동등하다(제4조 ②).
  const pipeCorridors: UndergroundCorridor[] = [];
  const beltCorridors: UndergroundCorridor[] = [];
  const failedDivers: string[] = [];
  const reachOf = (fluid: string | undefined) => (fluid === undefined ? maxJump : maxJumpPipe);
  /**
   * **④ 계획이 넓힌다**(docs/auto-layout/common/layout-models.md §3.5 제4조 ④) — 지금 판의 어느 트랙으로도 못 건너면 **트랙 하나를
   * 끼워** 그 새 열로 건너 본다. 새 열엔 아무 세로선이 없어, 건너는 쪽이 남의 선을 다른 자리 · 다른 순서로 만난다 — 꺾이는 칸
   * 출구 · 막힌 입구 · 긴 땅속을 피할 자리가 생긴다. 서쪽 열부터 보고 처음 되는 자리에 끼운다. 그래도 안 되면 오늘처럼 진다.
   *
   * 끼우기 전에 그 자리에서 정말 건너지나를 **옮겨 본 판**에서 먼저 본다 — 안 되는 자리에 폭만 늘리지 않는다.
   */
  const widenFor = (route: JumpRoute, reach: number, corridors: UndergroundCorridor[]) => {
    if (reach < 2) return null;
    const maxT = Math.max(-1, ...placedShapes.flatMap((pl) => pl.shape.v.map((v) => v.col)));
    for (let p = 0; p <= maxT + 1; p++) {
      const shift = (c: number) => (c >= p ? c + 1 : c);
      const moved = placedShapes.map((pl) =>
        placedOf(
          { h: pl.shape.h.map((h) => ({ row: h.row, c1: shift(h.c1), c2: shift(h.c2) })), v: pl.shape.v.map((v) => vseg(shift(v.col), v.r1, v.r2)) },
          pl.fluid,
        ),
      );
      const movedCor = corridors.map((c) =>
        c.axis === "v" ? { ...c, line: shift(c.line) } : { ...c, range: [shift(c.range[0]), shift(c.range[1])] as [number, number] },
      );
      // 옮긴 판의 칸 순서열은 한 칸 동쪽으로 간 E벽을 써야 한다 — 경로는 `sheet.capCol` 을 읽으므로 잠깐 옮겨 본다.
      sheet.capCol += 1;
      const res = placeWithJumps(route, moved, sheet.cap + 1, reach, movedCor, p);
      sheet.capCol -= 1;
      if (!res) continue;
      if (!insertTrack(sheet, p, [pipeCorridors, beltCorridors], reachOf)) continue;
      return res;
    }
    return null;
  };
  const cross = (route: JumpRoute, reach: number, corridors: UndergroundCorridor[], kind: UndergroundCorridor["kind"]) => {
    const res = placeWithJumps(route, placedShapes, sheet.cap, reach, corridors) ?? widenFor(route, reach, corridors);
    if (!res) return null;
    placedShapes.push(placedOf(res.shape, route.fluid));
    for (const j of res.jumps)
      corridors.push(
        corridorBetween({ x: j.fromCol, y: j.fromRow }, { x: j.toCol, y: j.toRow }, kind, kind === "pipe" ? PIPE_BLOCK_GROUP : "belt"),
      );
    return res;
  };
  const deliveryRoute = (d: DeliveryInput): JumpRoute => ({
    cellsAt: (t) => staircaseCells(d, t, sheet.capCol),
    lo: Math.min(d.startY, d.endY),
    hi: Math.max(d.startY, d.endY),
    fluid: d.fluid,
    tail: 0,
  });
  const exportRoute = (x: ExportInput): JumpRoute => {
    const exit = exitOf.get(x.id)!;
    const edge = edgeRowOf(exit, ctx);
    return {
      cellsAt: (t) => exportCells(x, t, exit, ctx, sheet.capCol),
      lo: Math.min(x.entryY, edge),
      hi: Math.max(x.entryY, edge),
      fluid: x.fluid,
      tail: x.fluid === undefined ? 2 : 1,
    };
  };
  /** 땅속으로 가기로 한 반출 — 아직 계획이 없다(못 들어가는 반출은 ① 이 폴백을 적었다). */
  const divingExports = (pipe: boolean) =>
    exports_.filter((x) => (x.fluid !== undefined) === pipe && yieldedExports.has(x.id) && !exportPlans.has(x.id));
  const crossExport = (x: ExportInput, reach: number, corridors: UndergroundCorridor[], kind: UndergroundCorridor["kind"]) => {
    const res = cross(exportRoute(x), reach, corridors, kind);
    if (res) exportPlans.set(x.id, { kind: "undergroundCrossing", track: res.track, exitEdge: exitOf.get(x.id)!, jumps: res.jumps });
    else failedDivers.push(x.id);
  };
  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
  type Diver = { id: string; d: DeliveryInput; x?: undefined } | { id: string; x: ExportInput; d?: undefined };

  // 파이프 — 들어가기로 한 유체 납품 · 파이프 반출. 못 들어가는 유체는 ① 이 이미 폴백을 적었다.
  const pipeDivers: Diver[] = [
    ...fluidDels.filter((d) => yieldedDeliveries.has(d.id) && !deliveryPlans.has(d.id)).map((d) => ({ id: d.id, d })),
    ...divingExports(true).map((x) => ({ id: x.id, x })),
  ].sort(byId);
  for (const r of pipeDivers) {
    if (r.x) { crossExport(r.x, maxJumpPipe, pipeCorridors, "pipe"); continue; }
    const res = cross(deliveryRoute(r.d), maxJumpPipe, pipeCorridors, "pipe");
    if (res) deliveryPlans.set(r.d.id, { kind: "undergroundCrossing", track: res.track, jumps: res.jumps });
    else failedDivers.push(r.d.id);
  }
  // 벨트 — 계획이 없거나 폴백인 아이템 납품 · 땅 위를 내준 벨트 반출.
  const beltDivers: Diver[] = [
    ...itemDels
      .filter((d) => { const cur = deliveryPlans.get(d.id); return !cur || cur.kind === "fallback"; })
      .map((d) => ({ id: d.id, d })),
    ...divingExports(false).map((x) => ({ id: x.id, x })),
  ].sort(byId);
  for (const r of beltDivers) {
    if (r.x) { crossExport(r.x, maxJump, beltCorridors, "belt"); continue; }
    const res = cross(deliveryRoute(r.d), maxJump, beltCorridors, "belt");
    if (res) { deliveryPlans.set(r.d.id, { kind: "undergroundCrossing", track: res.track, jumps: res.jumps }); continue; }
    deliveryPlans.set(r.d.id, {
      kind: "fallback",
      reason: yieldedDeliveries.has(r.d.id) ? "crossing-needs-underground" : "no-surface-assignment",
    });
  }
  return failedDivers;
}

/** **④ 폭** — 폴백 경로 · 잔여 구간의 유령 세로선을 쌓는다(청구만 — 계획은 안 바꾼다). */
function reserveWidth(sheet: ChannelSheet, ctx: GeometryContext): void {
  const { cap, deliveries, exports_, deliveryPlans, exportPlans, placedShapes } = sheet;
  // ── ④ 폭 예약(phantom) — fallback 경로·잔여 구간도 세로 구간만큼 트랙을 확보해,
  //      dijkstra/스캔이 들어갈 자리가 폭에서 사라지지 않게 한다(모듈 폴백 방지).
  //      폭은 세로 용량 문제라 세로선끼리만 비교한다 — 가로선과의 교차는 dijkstra 가
  //      지하벨트 등으로 풀 몫이고, 여기서 막으면 자리만 사라진다.
  const phantom = (lo: number, hi: number) => {
    for (let t = 0; t < cap; t++) {
      const clash = placedShapes.some((p) => p.shape.v.some((v) => v.col === t && v.r1 <= hi && lo <= v.r2));
      if (!clash) {
        placedShapes.push(placedOf({ h: [], v: [vseg(t, lo, hi)] }));
        return;
      }
    }
  };
  for (const d of deliveries) {
    const p = deliveryPlans.get(d.id);
    if (p?.kind === "fallback") phantom(Math.min(d.startY, d.endY), Math.max(d.startY, d.endY));
  }
  for (const x of exports_) {
    const p = exportPlans.get(x.id);
    if (p?.kind === "fallback") {
      const edgeRow = edgeRowOf(x.preferredExit, ctx);
      phantom(Math.min(x.entryY, edgeRow), Math.max(x.entryY, edgeRow));
    }
  }
  for (const iv of ctx.reserveIntervals ?? []) phantom(iv.lo, iv.hi);
}

/** **⑤ 폭 역전** — 쌓인 도형이 쓴 최고 트랙 번호 + 1. */
function trackCountOf(placedShapes: ReadonlyArray<Placed>): number {
  // 폭 역전 — 폭의 근거는 배정 결과(사용한 최고 트랙 번호).
  let trackCount = 0;
  for (const p of placedShapes) for (const v of p.shape.v) trackCount = Math.max(trackCount, v.col + 1);
  return trackCount;
}

/** 열 갈아타기 소탐색 — 트랙 쌍 × 갈아타는 행(구간 내부) 오름차순 첫 성공. */
function tryColumnSwitch(
  d: DeliveryInput,
  placed: ReadonlyArray<Placed>,
  cap: number,
  capCol: number,
): { plan: DeliveryPlan; shape: Shape } | null {
  const lo = Math.min(d.startY, d.endY);
  const hi = Math.max(d.startY, d.endY);
  for (let t1 = 0; t1 < cap; t1++) {
    for (let t2 = 0; t2 < cap; t2++) {
      if (t1 === t2) continue;
      for (let sy = lo + 1; sy <= hi - 1; sy++) {
        const shape = columnSwitchShape(d, t1, sy, t2, capCol);
        if (!conflictsAny(placedOf(shape, d.fluid), placed)) {
          return { plan: { kind: "columnSwitch", startTrack: t1, switchY: sy, endTrack: t2 }, shape };
        }
      }
    }
  }
  return null;
}
