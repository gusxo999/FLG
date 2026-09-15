/**
 * `DirectRay` — **직진이 먹는 칸의 집합.** 자리를 안 사는 경로도 등록은 해야 한다.
 *
 * ## 왜 필요했나
 *
 * 이 저장소의 자리 모델은 한 문장이다 — *"통로가 자기 축의 줄을 판다 → 경로가 자기 축의
 * 줄을 산다 → 모자라면 통로가 넓어진다."* **직진은 이 모델 밖이다.** 주행선 후보가
 * **하나뿐**(상자 좌표)이라 고를 게 없고, 그래서 사지 않는다. 그런데 **선은 긋는다.**
 *
 * 그 선이 어느 장부에도 없으면 두 직진이 만났을 때 **방출 순서로 갈린다** — 먼저 깔린
 * 쪽이 이기고 나중 것은 `straight blocked` 로 skip 돼 상자가 조립 블루프린트 **한복판에**
 * 남는다. 방출 시점엔 남은 수가 포기뿐이다: 직진은 옆으로 한 칸도 못 비끼고
 * ([perimeterRouter.routeWithHint] 의 `offsets: [0]`) 방출은 배정을 재생만 한다.
 *
 * > **고칠 수 있는 것은 「부딪힌다」가 아니라 「너무 늦게 안다」다.**
 * > 배정 시점엔 후보가 여럿이라(`options`) **다른 길**이 있다.
 *
 * ## 「사는 것」과 「등록하는 것」은 다르다
 *
 * ```
 * 사는 것      여럿 중 하나를 고르고, 모자라면 통로를 늘린다   ← 고를 게 있어야 성립
 * 등록하는 것   내가 여기 있다                              ← **고를 게 없어도 할 수 있다**
 * ```
 *
 * 직진은 못 산다. 그건 결함이 아니라 성질이고, 그 성질 덕에 **트랙을 안 먹어 폭이 안 는다.**
 * 이 자료는 그 성질을 그대로 두고 **「있다는 말」만** 남긴다.
 *
 * ## 끝점이 필요 없다 — 직진은 **반직선**이다
 *
 * 끝점(seat 행/열)은 `rawBbox` 에서 나오고 그건 **배치 뒤**다. 반출 자격이 서는 시점엔
 * 아직 없다. 그런데 직진의 선은 *"상자에서 도면 끝까지"* — **한쪽이 열린 반직선**이라
 * 끝점을 몰라도 표현된다.
 *
 * ```
 * 세로 직진   (열 c, 상자 행 y₀, N)  =  { (c, y) : y ≤ y₀ }
 * 가로 직진   (행 r, 상자 열 x₀, E)  =  { (x, r) : x ≥ x₀ }
 * ```
 *
 * ## **한 열 안에서만** 일어난다 — 좌표가 거의 필요 없다
 *
 * 가로 직진은 **끝 열에서만** 나오고(`perimeter/shape.directOptionOf` 는 가로 광선이
 * `outerMargin` 으로 끝날 때만 후보를 만든다) 그 선은 **바깥쪽으로** 뻗는다. 그러니 다른
 * 열의 세로선과는 만날 수가 없다:
 *
 * ```
 * [W 마진] [열 0] [채널 1] [열 1] … [열 D] [E 마진]
 *   ←────────┤                              ├────────→
 *   깊이 0 의 W 직진은 여기까지          최대 깊이의 E 직진은 여기부터
 * ```
 *
 * **그래서 비교는 언제나 같은 깊이 안이고, 열은 로컬 x 로 비교하면 된다** — 같은 깊이
 * 모듈은 전부 `colX[depth]` 에 왼쪽 정렬되므로(`shiftModule(m, colX[d] − ext.x, …)`)
 * 로컬 x 끼리의 비교가 절대 x 로 비교한 것과 답이 같다. 행은 이미 절대 y 다.
 *
 * > **넷이면 완전하다 — `(깊이, 로컬 열, 절대 행, 방향)`.** `colX` 도 `rawBbox` 도
 * > 필요 없다. 광선처럼 *"좌표를 아예 안 쓴다"* 가 아니라 **배정 시점에 이미 있는 좌표만
 * > 쓴다** 는 뜻이고, `directOptionOf` 가 `p.localX` 를 쓰는 것과 같은 층이다.
 *
 * ## 「광선」이 아니다 — 셋이 서로 다른 층이다
 *
 * ```
 * 광선     "이 방향으로 나가면 무엇을 지나나"라는 **질문**(`layoutRegions.regionsAlong`).
 *          순수 함수라 **아무것도 안 먹고** 순서와 무관하다. 직진·환승 둘 다 이걸로 잰다
 * 직진     반출 **모드**(`ExitMode.direct`) — 주행선 후보가 1개, 자유도 0
 * 반직선   그 직진이 **먹는 칸의 집합** — 이 파일
 * ```
 *
 * **순수·결정적.** `PlacedCell` 을 안 만들고 전역 외곽(반출)을 아니 `planner/perimeter/`.
 */

import type { ExitEdge } from "./types";

/**
 * 직진 하나가 긋는 **반직선**. 끝점을 몰라도 표현된다(도면 끝까지 간다).
 *
 * `axis` 와 `toward` 를 한 union 으로 묶은 것은 의도다 — 세로인데 `toward: "E"` 같은
 * 값이 **타입에서 만들어지지 않게** 한다. 두 필드가 어긋나면 아래 판정이 조용히 틀린다.
 *
 * 좌표계 주의: **`line` 과 `from` 의 단위가 축마다 뒤바뀐다.**
 *
 * ```
 * V   line = 로컬 열(고정)     from = 절대 행(상자 쪽 끝)
 * H   line = 절대 행(고정)     from = 로컬 열(상자 쪽 끝)
 * ```
 */
export type DirectRay =
  /** **세로 직진** — 열이 고정이고 위(N)/아래(S)로 뻗는다. */
  | { depth: number; axis: "V"; line: number; from: number; toward: Extract<ExitEdge, "N" | "S"> }
  /** **가로 직진** — 행이 고정이고 서(W)/동(E)로 뻗는다. */
  | { depth: number; axis: "H"; line: number; from: number; toward: Extract<ExitEdge, "W" | "E"> };

/** 한쪽이 열린 구간. `-Infinity`/`Infinity` 가 *"도면 끝까지"* 다. */
interface HalfLine {
  lo: number;
  hi: number;
}

/**
 * 이 반직선이 **자기 축을 따라** 덮는 구간. 세로면 행 구간, 가로면 열 구간이다.
 *
 * N(위)·W(왼쪽)는 좌표가 **줄어드는** 쪽이라 `from` 이 상한이고, S·E 는 하한이다.
 */
function along(r: DirectRay): HalfLine {
  return r.toward === "N" || r.toward === "W"
    ? { lo: -Infinity, hi: r.from }
    : { lo: r.from, hi: Infinity };
}

const contains = (h: HalfLine, v: number): boolean => h.lo <= v && v <= h.hi;
const overlaps = (a: HalfLine, b: HalfLine): boolean => a.lo <= b.hi && b.lo <= a.hi;

/**
 * 두 직진이 **같은 칸을 먹나**.
 *
 * **`toward` 를 반드시 읽는다.** 축만 보는 판정은 마주 보고 뻗는 쌍을 겹친다고 오판한다 —
 * 방향 조합이 넷이고 부등식이 넷 다 다르다:
 *
 * ```
 * 세로(c, y₀, ↑N)  ×  가로(r, x₀, →E)    ⟺  r ≤ y₀  ∧  c ≥ x₀
 * 세로(c, y₀, ↑N)  ×  가로(r, x₀, ←W)    ⟺  r ≤ y₀  ∧  c ≤ x₀
 * 세로(c, y₀, ↓S)  ×  가로(r, x₀, →E)    ⟺  r ≥ y₀  ∧  c ≥ x₀
 * 세로(c, y₀, ↓S)  ×  가로(r, x₀, ←W)    ⟺  r ≥ y₀  ∧  c ≤ x₀
 *
 * 세로(c, y₀, ↑N)  ×  세로(c′, y₁, ↑N)   ⟺  c = c′              (같은 방향이면 반드시 겹친다)
 * 세로(c, y₀, ↑N)  ×  세로(c′, y₁, ↓S)   ⟺  c = c′  ∧  y₁ ≤ y₀   (마주 보고 뻗을 때만)
 * ```
 *
 * **같은 축·같은 방향의 쌍이 「반드시 겹친다」인 이유:** 둘 다 같은 열의 **한쪽으로 닫힌**
 * 반직선이라 포함 관계가 성립한다 — 뒤에 온 쪽은 앞의 것을 **부분집합으로** 밟는다.
 *
 * 깊이가 다르면 만날 수 없다(위 §한 열 안에서만).
 */
export function directRaysCross(a: DirectRay, b: DirectRay): boolean {
  if (a.depth !== b.depth) return false;
  if (a.axis === b.axis) {
    // 같은 축 — 고정된 줄이 같아야 하고, 그 위에서 두 반직선이 겹쳐야 한다.
    return a.line === b.line && overlaps(along(a), along(b));
  }
  // 직교 — 만나는 곳은 한 칸이다. 세로의 열이 가로의 사정거리 안에, 가로의 행이 세로의
  // 사정거리 안에 있어야 한다. (단위가 맞물린다: along(V)=행 ∋ H.line=행, along(H)=열 ∋ V.line=열.)
  const [v, h] = a.axis === "V" ? [a, b] : [b, a];
  return contains(along(v), h.line) && contains(along(h), v.line);
}

/**
 * `a` 가 `b` 와 **처음 만나는 칸**의 열쇠 — `깊이:로컬열,절대행`.
 *
 * **계측 전용이다**(낙선 기록). 배정은 이 값을 안 본다 — `directRaysCross` 가 참일 때만
 * 부르고, 같은 열쇠가 여러 번 나오면 *"그 자리를 셋 이상이 다퉜다"* 는 뜻이다.
 *
 * 직교면 만나는 칸이 하나뿐이라 자명하다. 같은 축이면 겹치는 곳이 **구간**이므로,
 * `a` 가 자기 상자에서 출발해 **가장 먼저** 밟는 칸을 대표로 삼는다.
 */
export function crossCellKey(a: DirectRay, b: DirectRay): string {
  if (a.axis !== b.axis) {
    const [v, h] = a.axis === "V" ? [a, b] : [b, a];
    return `${a.depth}:${v.line},${h.line}`;
  }
  const ia = along(a), ib = along(b);
  // 겹치는 구간의 두 끝 중 `a` 의 상자에 가까운 쪽 — N/W 면 상한, S/E 면 하한이다.
  const first =
    a.toward === "N" || a.toward === "W"
      ? Math.min(ia.hi, ib.hi)
      : Math.max(ia.lo, ib.lo);
  return a.axis === "V" ? `${a.depth}:${a.line},${first}` : `${a.depth}:${first},${a.line}`;
}
