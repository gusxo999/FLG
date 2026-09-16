/**
 * perimeterExitPlanner — 모듈 외부상자를 전역 perimeter 로 빼는 **반출 출구 배정**
 * (조각 6-①, 순수·좌표 산정만).
 *
 * ## 모델은 하나다 — **주행선 하나를 고르고 그 축의 바깥 변까지 간다**
 *
 * ```
 * exitEdge   어느 바깥 변으로 나가나 (N·S·W·E) — **축을 이 값이 정한다**
 * exitMode   그 주행선을 **어디서 얻나**
 *              직진(direct)   후보 1개  — 상자 좌표 그대로.  늘릴 수 없다
 *              환승(channel)  후보 여럿 — 통로가 배정한다.   모자라면 채널이 넓어진다
 * ```
 *
 * 2026-09-08 이전엔 출구가 셋(`self`·`margin`·`channel`)이었는데, `self`(세로 직진)와
 * `margin`(가로 직출)은 **같은 것의 두 축**이었다 — 저장소의 어떤 소비자도 둘을 구분하지
 * 않았고(방출은 `exitEdge` 로만 축을 골랐다), `margin.edge` 는 언제나 `exitEdge` 와 같았다.
 * 합치면서 `track` 이라는 용어도 이 파일에서 걷어냈다 — 저장소의 다른 곳에서 `track` 은
 * **통로가 배급하는 주행선 번호**를 뜻하는데 여기선 「반출 경로」를 뜻해 두 뜻이었다.
 *
 * ## 무엇을/왜
 * 모듈 파이프라인은 살아남은 외부상자(raw 입력 + 루트 출력)를 각자의 **로컬 모듈 ring**
 * 에 둔다. depth 열 타일링 후엔 그 ring 들이 조립 블루프린트의 **내부**로 들어가 상자가
 * 흩어진다. 해법은 각 상자를 **인접 gap(모듈 사이 채널 / 바깥 마진) 안의 트랙** 으로 빼
 * 가장 가까운 전역 외곽 변으로 보내는 것 — 그러려면 채널 폭 계산처럼 **트랙 공간을 패킹
 * 단계에서 미리 예약**해야 한다.
 *
 * ## 일반화 (black box)
 * 모듈 내부(클러스터 기둥/단일 머신)를 보지 않는다. 입력은 **경계 포트(어느 *변*에
 * 붙었나 + abs y) + 배치 gap 기하**뿐. exit 방향은 belt 흐름이 아니라 "어느 gap 이
 * 인접한가"에서 나온다. N/S 우세는 가로 타일링의 *결과*지 가정이 아니다.
 *
 * ## (A) 폭만 예약 — 트랙 index 는 못박지 않음
 * 채널로 들어가는 트랙은 자기 **세로 점유 구간**만 내놓고, packModuleTree 가 이를 납품 경로
 * 구간과 **합쳐** [channelPlanner.assignTracksLeftEdge] 로 트랙 수(=폭)만 산정한다. 실제
 * 몇 번째 트랙에 깔릴지는 검증된 라우터가 정한다(납품 경로와 동일 관행).
 *
 * ## 출구 후보 규칙 — **네 방향에 규칙 하나**([layoutRegions] 의 광선)
 *
 * 2026-09-08 이전엔 축마다 판정이 달랐다 — 세로는 `selfBlocked`(형제 모듈의 y 구간 비교),
 * 가로는 *"끝 열인가"*. **둘 다 같은 질문의 특수형**이었다:
 *
 * ```
 * 그 방향으로 광선을 쏜다
 *   그대로 바깥에 닿고 · 남의 모듈을 안 만난다  →  **직진**
 *   열 채널에서 멈춘다                        →  **환승**(그 채널 안에서 가까운 N/S 로)
 *   남의 모듈을 만난다                        →  그 방향은 후보가 아니다
 * ```
 *
 * **직진은 여기서 장부에도 오른다.** 직진은 통로의 자리를 **안 산다**(후보가 하나뿐이라
 * 고를 게 없다) — 그런데 **선은 긋는다.** 그 선이 어디에도 없으면 두 직진이 만났을 때
 * 방출 순서로 갈리고 진 쪽 상자가 안 나간다. 그래서 확정된 직진마다 반직선([DirectRay])을
 * 등록하고, 뒤 상자의 직진 후보가 겹치면 **그 후보를 만들지 않는다**(후보 강등).
 *
 * **아직 안 보는 것** — 2홉(`docs/auto-layout/common/exit-ray.md` §4). 가로 광선이 열 채널에서
 * 멈추면 거기서 환승할 뿐, 그 너머 열로 **갈아타지는** 못한다.
 *
 * 좌표 주의: colX 확정 *전* 에 불린다(채널 폭이 colX 를 정하므로). **자격 판정은 좌표를
 * 아예 안 쓴다** — 광선이 순번으로 답한다. abs `y` 는 *"가까운 N/S 가 어느 쪽인가"* 라는
 * **선호 순서**에만 쓴다.
 */

import { directRaysCross, crossCellKey, type DirectRay } from "./ledger";
import type {
  ExitAssignment,
  ExitBlocked,
  ExitContext,
  ExitDemotion,
  ExitMode,
  ExitOption,
  ExitPortInput,
  PerimeterExitPlan,
} from "./types";
import { channelEntryOf, directOptionOf } from "./shape/qualify";

/** N/S 중 anchor 에 더 가까운 변. */
function nearerNS(anchorY: number, gy: { min: number; max: number }): "N" | "S" {
  return anchorY - gy.min <= gy.max - anchorY ? "N" : "S";
}

/**
 * 한 포트가 쓸 수 있는 출구 후보를 **선호 순**으로 전부 나열한다.
 *
 * 모든 후보는 `wayOut ∈ p.wayOuts` 를 만족한다 — 즉 **모듈 몸통에 막히지 않음이 보장**된
 * 출구만 나온다. 이것이 "예약한 경로는 항상 방출 가능"이라는 예약 철학의 핵심이다.
 *
 * 선호 순서는 **자유도**다(무엇을 먼저 놓든 정합성은 안 깨짐). 여기선 회귀를 줄이려고
 * 옛 규칙(side 기반)을 1순위로 재현하고, 그게 막혔을 때 나머지 가능한 출구로 흘린다.
 * 나중에 폭 최소화 등 다른 기준으로 재정렬해도 되고, 장부가 앞 후보를 강등시켜도 된다.
 *
 * **이 함수는 순서와 무관하다** — `regionsAlong` 이 (모듈·방향·격자)의 순수 함수라 어떤
 * 순서로 물어도 같은 목록이 나온다. 앞선 상자의 선택을 보는 것은 [planPerimeterExits]
 * 쪽이고, 그 경계가 여기 있다.
 *
 * `why` 를 주면 **떨어진 방향마다 사유를 적는다**([ExitBlocked] 의 재료). 안 주면 아무것도
 * 안 만든다 — 후보가 0인 상자에만 한 번 더 부르는 자리라, 본 경로는 예전 그대로다.
 */
function enumerateOptions(
  p: ExitPortInput,
  ctx: ExitContext,
  why?: Map<string, string>,
): ExitOption[] {
  const gy = ctx.globalY;
  const opts: ExitOption[] = [];
  /** 직진 — 자격은 광선이 답한다([directOptionOf]). 여기서는 **어느 방향을 먼저 묻나** 만 쥔다. */
  const directNS = (e: "N" | "S") => directOptionOf(p, e, ctx, why);
  const directWE = (e: "W" | "E") => directOptionOf(p, e, ctx, why);

  /** 환승 — 자격(열 채널 · 진입 벽)은 [channelEntryOf]. 가까운 N/S 를 먼저 두는 것이 선호다. */
  const channelOpts = (wayOut: "W" | "E"): ExitOption[] => {
    const entry = channelEntryOf(p, wayOut, ctx, why);
    if (!entry) return [];
    const { depth, wall } = entry;
    const near = nearerNS(p.anchorY, gy);
    const far: "N" | "S" = near === "N" ? "S" : "N";
    return [near, far].map((e) => ({
      exitEdge: e,
      exitMode: { kind: "channel", depth } as ExitMode,
      wayOut,
      entry: { y: p.anchorY, wall },
    }));
  };

  // ── 1순위: 옛 규칙 재현(회귀 최소) ──
  if (p.side === "N" || p.side === "S") {
    opts.push(...[directNS(p.side)].filter((o): o is ExitOption => !!o));
    // 막히면 채널 우회 — 옛 divertChannel: depth≥1 이면 왼쪽, 아니면 오른쪽.
    opts.push(...(p.depth >= 1 ? channelOpts("W") : channelOpts("E")));
    opts.push(...[directNS(p.side === "N" ? "S" : "N")].filter((o): o is ExitOption => !!o));
  } else if (p.side === "W") {
    opts.push(...[directWE("W")].filter((o): o is ExitOption => !!o));
    opts.push(...channelOpts("W"));
  } else {
    opts.push(...[directWE("E")].filter((o): o is ExitOption => !!o));
    opts.push(...channelOpts("E"));
  }

  // ── 2순위: 그래도 없거나 부족하면, 남은 모든 가능한 출구(자유도 최대화·고립 방지) ──
  // 코너 어깨 상자(face 가 N/S인데 side 가 E/W)가 여기서 구제된다 — 옛 규칙의 채널
  // 우회는 wayOuts 에 막혀 후보가 안 되고, 뚫린 face 쪽 self/margin 이 잡힌다.
  for (const e of ["N", "S"] as const) opts.push(...[directNS(e)].filter((o): o is ExitOption => !!o));
  for (const e of ["W", "E"] as const) opts.push(...[directWE(e)].filter((o): o is ExitOption => !!o));
  opts.push(...channelOpts("W"), ...channelOpts("E"));

  // 중복 제거(선호 순 보존).
  const seen = new Set<string>();
  return opts.filter((o) => {
    // 옛 열쇠는 `margin` 의 `edge` 도 섞었는데 그 값은 **언제나 `exitEdge` 와 같아서**
    // 아무것도 더 가르지 않았다(`directWE` 가 둘 다 `e` 로 넣는다).
    const k = `${o.exitMode.kind}:${o.exitMode.kind === "channel" ? o.exitMode.depth : ""}:${o.exitEdge}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 막힌 상자 하나를 **분류한다** — 계측 전용([ExitBlocked]).
 *
 * 사유를 받으려고 [enumerateOptions] 를 한 번 더 부른다. 순수 함수라 같은 답이 나오고,
 * 부르는 자리가 *막힌 상자에만* 이라 본 경로의 비용이 안 는다.
 */
function describeBlocked(
  p: ExitPortInput,
  ctx: ExitContext,
  kind: ExitBlocked["kind"],
  extra?: string,
): ExitBlocked {
  const why = new Map<string, string>();
  enumerateOptions(p, ctx, why);
  // **행 채널에 들어가려면 모듈 몸통을 N/S 로 빠져나가야 한다** — 그 판정은 이미 모듈이
  // 답해 놓았다(`moduleWayOuts`). 여기서 모듈 내부를 다시 보지 않는다.
  const canEnterRowChannel = p.wayOuts.includes("N") || p.wayOuts.includes("S");
  // 끝 열의 행 채널은 한쪽 끝이 **바깥 마진**이라 갈아탈 필요가 없다(1홉).
  const hops = !canEnterRowChannel ? null : p.depth === 0 || p.depth === ctx.maxDepth ? 1 : 2;
  const reasons = [...why].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`);
  return {
    id: p.id,
    kind,
    depth: p.depth,
    canEnterRowChannel,
    hops,
    why: [...(extra ? [extra] : []), ...reasons].join(" "),
  };
}

/**
 * 이 후보가 긋는 **반직선**. 환승이면 없다 — 통로가 자리를 팔고, 그 다툼은 채널 통합
 * 장부가 본다. 자리를 **안 사는** 직진만 여기 등록된다.
 *
 * 좌표계는 [DirectRay] 의 규약 그대로다 — 세로는 `line`=로컬 열/`from`=절대 행, 가로는
 * 그 반대. 둘 다 **배정 시점에 이미 있는 값**이라 `colX`·`rawBbox` 를 안 기다린다.
 */
function directRayOf(o: ExitOption, p: ExitPortInput): DirectRay | null {
  if (o.exitMode.kind !== "direct") return null;
  return o.exitEdge === "N" || o.exitEdge === "S"
    ? { depth: p.depth, axis: "V", line: p.localX, from: p.anchorY, toward: o.exitEdge }
    : { depth: p.depth, axis: "H", line: p.anchorY, from: p.localX, toward: o.exitEdge };
}

/**
 * 반출 트랙 배정. 순수·결정적. 모듈 내부를 안 본다(모듈이 답해준 `wayOuts` 만 믿는다).
 *
 * 각 상자마다 **쓸 수 있는 출구 후보**를 나열하고, 앞에서부터 **직진 장부에 안 걸리는**
 * 첫 후보를 확정한다. 폭/마진 수요는 **확정된 출구 하나**에서만 계산한다(후보 전부가
 * 아니라) — 안 쓸 출구를 위해 채널을 넓히던 옛 낭비가 여기서 사라진다.
 *
 * 나갈 길이 하나도 없는 상자는 **배정을 만들지 않는다** → 예약도 0, 재배치도 skip(로컬 ring
 * 유지). 못 쓸 경로를 예약해 폭만 잡아먹는 것보다 정직하다.
 *
 * ## **직진 장부** — 자리를 안 사는 경로도 등록은 해야 한다
 *
 * 직진은 통로의 자리를 안 산다(후보가 하나뿐이라 고를 게 없다). 그건 맞다 — 그런데
 * **선은 긋는다.** 그 선이 어디에도 없으면 두 직진이 만났을 때 **방출 순서로 갈리고**
 * 진 쪽 상자가 안 나간다(`straight blocked` → skip → 상자가 블루프린트 한복판에 남는다).
 *
 * ```
 * 옛  ① A 의 직진 확정(안 적힘) → ② B 의 직진 확정(A 를 모름) → ③ 방출에서 충돌 → **B 포기**
 * 새  ① A 의 직진 확정 + **등록** → ② B 의 후보가 겹치면 **안 만든다** → 환승이 확정된다
 * ```
 *
 * **바뀌는 것은 승자가 아니라 패자의 대가다.** *"먼저 온 쪽이 이긴다"* 는 그대로고
 * (방출에 있던 선점이 배정으로 옮겨 왔을 뿐이다), 진 쪽이 치르는 값이 *"상자가 안 나간다"*
 * 에서 *"폭이 는다"* 로 바뀐다. 그 방향은 피해 등급(머신 > 유체 > 납품 > 반출 > **폭**)이
 * 이미 정해 둔 것이다.
 *
 * > **그래서 자격이 「상태 있는 술어」가 된다.** [enumerateOptions] 자체는 여전히 순수하고
 * > 순서와 무관하지만, **어느 후보가 확정되나**는 앞선 상자의 선택에 달린다. 되먹임은
 * > 아니다 — 한 번 훑고 끝나고, 자격의 입력(순번·로컬 x·`rowChannelReach`)은 전부 배정보다
 * > 먼저 확정되며, 확정된 직진은 뒤에서 다시 안 고쳐진다.
 *
 * ## 순회는 **후보가 적은 상자부터**
 *
 * 옛 순회는 `id` 오름차순이었다. 결정적이지만 **제약과 아무 상관이 없다** — 후보가 셋인
 * 상자가 후보 하나뿐인 상자보다 먼저 골라 버린다. 스도쿠와 같은 이유로 **제약 센 곳부터**
 * 고르게 한다. 동률은 `id` 로 깨서 결정성을 지킨다.
 *
 * **결과 배열은 여전히 `id` 순이다** — 순회 순서와 출력 순서를 가른다. 뒤 단계(통합 장부의
 * 신고 순서 등)가 배열 순서에 달려 있을 수 있어, 겹치는 직진이 없으면 산출이 **한 글자도**
 * 안 바뀌게 둔다.
 */
export function planPerimeterExits(ports: ReadonlyArray<ExitPortInput>, ctx: ExitContext): PerimeterExitPlan {
  const marginNeeds = { N: false, S: false, W: false, E: false };
  const demotions: ExitDemotion[] = [];
  const blocked: ExitBlocked[] = [];

  // 후보를 **먼저** 전부 나열한다 — 순회 순서가 후보 수에 달려 있기 때문이다.
  const all = ports.map((p) => ({ p, options: enumerateOptions(p, ctx) }));
  const cands = all.filter((c) => c.options.length > 0); // 나갈 길 없음 — 예약 0, 계획된 skip.
  // **그 「계획된 skip」이 이 계획의 트리거다** — 여기서 안 세면 아무 데도 안 남는다.
  // 방출은 `no exit assignment` 로 사유 셋(후보 0 · 짝지어짐 · 고아 포트)을 합쳐 찍는다.
  for (const c of all) if (c.options.length === 0) blocked.push(describeBlocked(c.p, ctx, "noOption"));

  // **제약 센 곳부터.** 후보가 하나뿐인 상자는 강등할 데가 없으니 먼저 고른다.
  const order = [...cands].sort(
    (a, b) => a.options.length - b.options.length || a.p.id.localeCompare(b.p.id),
  );

  /** 이미 그어진 직진들 — *"내가 여기 있다"* 만 담는다. 자리를 사지는 않는다. */
  const laid: { id: string; ray: DirectRay }[] = [];
  const chosenById = new Map<string, ExitOption>();

  for (const { p, options } of order) {
    let chosen: ExitOption | undefined;
    for (const o of options) {
      const ray = directRayOf(o, p);
      if (!ray) { chosen = o; break; } // 환승 — 이 장부의 소관이 아니다(통로가 판다).
      const hit = laid.find((l) => directRaysCross(ray, l.ray));
      if (!hit) { chosen = o; break; }
      demotions.push({
        id: p.id,
        droppedEdge: o.exitEdge,
        blockedBy: hit.id,
        cell: crossCellKey(ray, hit.ray),
      });
    }

    // **강등할 데가 없는 경우가 실재한다** — `channelOpts` 는 광선이 열 채널을 못 만나면
    // 빈 배열을 낸다(깊이 0 의 W · 최대 깊이의 E · `maxDepth === 0` 인 단일 열 트리).
    // 그때 후보가 직진 하나뿐이라 위 루프가 아무것도 못 고른다. 그 갈래를 안 적으면
    // **배정이 통째로 사라져 확정 skip** 이 된다 — 오늘보다 나쁘다. 그러니 오늘 그대로
    // 두고(`options[0]`) 방출에 맡긴다. 이 자리를 구제하는 것은 다른 계획의 몫이다.
    const pick = chosen ?? options[0];
    // **강행이다 — 계측에 남긴다.** 이 상자는 남이 이미 그은 선 위에 서므로 방출에서
    // `straight blocked` 로 skip 될 것이다(`occ` 가 앞 상자의 belt 를 품는다). 강등 기록만
    // 보면 *"내려갈 데가 있었나"* 를 못 묻는다 — 그 답이 여기 있다.
    if (!chosen) blocked.push(describeBlocked(p, ctx, "forced", `강행=${pick.exitEdge}`));

    // 상자 seat 는 진출 변의 마진에 앉는다 — 직진이든 환승이든 같다.
    marginNeeds[pick.exitEdge] = true;
    chosenById.set(p.id, pick);
    // 확정된 직진은 **겹치더라도** 등록한다. 장부는 *"배정이 무엇을 그었나"* 를 말하지
    // *"방출이 성공하나"* 를 말하지 않는다 — 빼면 뒤 상자가 같은 선을 또 고른다.
    const ray = directRayOf(pick, p);
    if (ray) laid.push({ id: p.id, ray });
  }

  const assignments = [...cands]
    .sort((a, b) => a.p.id.localeCompare(b.p.id))
    .map(({ p, options }): ExitAssignment => {
      const c = chosenById.get(p.id)!;
      return { id: p.id, role: p.role, options, exitEdge: c.exitEdge, exitMode: c.exitMode, entry: c.entry };
    });

  // 계측은 **`id` 순**으로 낸다 — 순회 순서(후보 수)가 새어 나가지 않게(출력 안정).
  blocked.sort((a, b) => a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));
  const noSideWayOut = ports.filter(
    (p) => !p.wayOuts.includes("W") && !p.wayOuts.includes("E"),
  ).length;
  return { assignments, marginNeeds, demotions, blocked, noSideWayOut };
}
