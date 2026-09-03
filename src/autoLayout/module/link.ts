/**
 * link — **이 클러스터의 벨트 한 줄**을 나타내는 자료 구조와 그 조립·판독.
 *
 * ## 왜 `module/` 인가 — 형제를 모른다
 * 여기 있는 것은 전부 **로컬 머신 index → 팔 수**만 안다. 상대 클러스터의 대수도, 좌표도,
 * 모양도 안 들어온다. 그래서 축 2 판정(*"module = 형제 모듈을 모른다"*)을 통과한다.
 *
 * **`id` 만 예외이고, 그 예외가 좁은 것이 요점이다.** `id` 는 간선의 양끝을 아는
 * `planner/modulePacking.makeLinkId` 가 만들어 얹는 **불투명 토큰**이고, 이 폴더와
 * `execution/` 은 그것을 **복사만 한다 — 파싱하는 코드가 0 이다.** 파싱하는 순간 모듈이
 * 형제를 알게 되므로, 그 0 을 유지하는 것이 모듈↔링크 분리의 실질이다.
 *
 * ## 상대는 안일 수도, 밖일 수도 있다 (2026-07-23 정의 확장)
 * 예전엔 "자식 머신 → 부모 머신"만 가리켰다. 그런데 **원료·완제품 줄(모듈 밖과 주고받는
 * 것)도 물리적으로 똑같은 일**이다 — 머신 면에 팔을 앉히고 벨트로 나른다. 다른 건 상대가
 * 안(부모·자식 머신)이냐 밖(무한상자)이냐 하나뿐이라 **같은 구조로 다룬다**:
 *
 * | | `from` | `to` |
 * |---|---|---|
 * | 내부 링크(자식→부모) | 자식 머신 | 부모 머신들 |
 * | 외부 입력(원료) | **빔** = 밖에서 온다 | 이 클러스터 머신들 |
 * | 외부 출력(완제품) | 이 클러스터 머신들 | **빔** = 밖으로 간다 |
 *
 * 그래서 좌석 예산·면 배정을 **한 장부**로 셀 수 있다.
 *
 * ## 형제를 아는 절반은 여기 없다
 * *"어느 기계 쌍을 몇 벨트로 잇나"* 는 두 클러스터의 대수를 봐야 정해지므로
 * [planner/link/allocateFlows](../planner/link/allocateFlows.ts) 소관이다.
 * 두 파일은 **서로를 import 하지 않는다** — 한 파일에 있던 시절엔 그 경계가 안 보여
 * `module/` 이 `planner/link/` 를 부르고 `planner/link/` 가 다시 `module/` 을 부르는
 * 왕복 간선이 있었다(2026-08-02 해소).
 */

import type { IoLine, SupplyCapacity } from "../planner/module/ioLine";
import { armsFor, faceSeatArms, inserterForReach, type SpecBelt, type SpecInserter } from "../buildSpec";
import { determineBeltCount } from "../beltThroughput";

/**
 * **벨트 하나** — 이 클러스터의 머신들이 상대와 주고받는 물리 벨트 하나 = 포트 한 쌍.
 *
 * ## 왜 목적지마다 벨트를 따로 내나
 * **v1 은 링크 하나가 곧 그룹 하나다**(2026-07-22). 여러 목적지를 한 벨트에 묶으면 그 벨트가
 * 부모 머신 여럿을 **관통**해야 하고, 그러려면 그 머신들이 **붙어 있어야** 한다
 * ([[용어사전#ColumnCluster]]). 채널 트랙 하나를 아끼려고 클러스터 형태 전체를 저당 잡히는
 * 거래라 v1 에서는 안 한다.
 *
 * `from`/`to` 가 Map 인 이유: 병합을 되살리거나(여러 목적지) 외부 줄을 담을 때(전 머신)
 * 자료 구조를 다시 안 바꾸려는 것이다. 내부 링크 v1 에서는 양쪽 다 항목 하나씩이다.
 */
export interface Link {
  /**
   * **지정 짝의 토큰 — 비어 있는 것이 뜻을 갖는다.**
   *
   * ```
   * 있다   이 포트는 형제 모듈의 **저** 포트와 이어져야 한다.  바꿔 끼우면 틀린다
   * 없다   같은 품목이면 **아무거나** 이어도 된다(교환 가능)
   * ```
   *
   * [pairDeliveryPorts] 가 이 유무로 갈린다 — 있으면 토큰 조회, 없으면 위치-zip. 그래서
   * *"식별자가 있으면 편하겠지"* 로 채우면 **알고리즘의 갈래가 조용히 바뀐다**(2026-08-17 실측:
   * 채운 줄이 납품 경로를 통째로 잃었다).
   *
   * **채우는 곳은 [makeLinkId] 하나뿐이다.** 지정이 존재하는 조건은 *"외부냐 내부냐"* 가 아니라
   * **"[allocateFlows] 가 머신 단위로 배정했나"** 다 — 배정이 없으면 지킬 것도 없으므로
   * 교환 가능이고, 그때는 비워 두는 것이 **정답**이지 정보 부족이 아니다.
   *
   * 값 자체는 **불투명 토큰**이다. 간선의 양끝(자식·부모 노드 id)을 아는 호출자
   * (`planner/modulePacking`)가 채우고, 이 폴더는 **파싱하지 않는다**.
   */
  id?: string;
  /** 운반 품목. */
  item: string;
  /**
   * 이 벨트에 물건을 **내놓는** 머신 → 그 머신이 쓰는 팔 수.
   * **비어 있으면 물건이 모듈 밖에서 온다**(= 외부 입력 줄: 원료).
   */
  from: Map<number, number>;
  /**
   * 이 벨트에서 물건을 **받는** 머신 → 그 머신이 쓰는 팔 수.
   * **비어 있으면 물건이 모듈 밖으로 나간다**(= 외부 출력 줄: 완제품).
   */
  to: Map<number, number>;
  /**
   * **적재 목록 — 이 줄이 무엇을 얼마나 싣고 있나**(2026-08-23). 모르면 `undefined`
   * (지어내지 않는다).
   *
   * 항목 하나가 [Flow](= 흐름) 하나의 **이 줄이 맡은 몫**이다. 흐름과 벨트 줄은
   * M:N 이라(한 줄이 흐름 여럿을 싣고 = 트렁크, 한 머신이 줄 여럿을 쓰고 = split belt)
   * 이 목록이 그 대응을 담는 **유일한 자리**다.
   *
   * **`from`/`to` 는 여기서 유도된다.** 두 명단만 들던 시절엔 `from={0:2}, to={1:1,2:1}`
   * 에서 *0번 자식이 1번·2번에게 각각 얼마씩* 인지를 표현하지 못했고, 그래서 [machine-link]
   * 가 `toMachine` 을 *"물류 계약이 아니라 장부"* 라고 방어해야 했다. 적재 목록이 있으면
   * **계약**이다 — 다만 *"인서터는 앞에 물건이 있으면 무조건 내린다"* 는 물리는 그대로라,
   * 한 줄에 부모가 여럿이면 **그 줄 안에서의 분배는 여전히 물리가 정한다**. 계약이 보장하는
   * 것은 *"그 줄에 이만큼이 실려 그 행을 지난다"* 까지다.
   *
   * 불변식: `Σ rate ≤ 그 벨트의 처리량`([groupRate] 로 센다). 팔 수로는 못 센다 —
   * `팔 수 × 팔 처리량` 은 **올림된 용량**이라 언제나 실제보다 크고, 그래서 진단이 멀쩡한
   * 줄을 "포화" 라고 거짓 경고한다.
   */
  carries?: ReadonlyArray<LinkCarry>;
  /**
   * 이 줄에 깔 벨트 prototype — [determineBeltCount] 가 **양에서** 고른 티어.
   *
   * 모르면 `undefined` 이고, 그때 방출기가 [ModuleInput.beltEntityName](기본 벨트)로 깐다.
   * **실으려는 양을 정한 곳과 깔 벨트를 고르는 곳이 갈리면 용량이 거짓이 된다** — 접기는
   * 90/s 짜리로 세 놓고 방출이 15/s 짜리를 깔면 그 줄은 조용히 굶는다(2026-08-22 관측).
   */
  beltEntityName?: string;
  /**
   * **짝이 있는 쪽 끝** — 이 줄의 포트가 기둥 어느 끝에 서야 짝과 **안 교차하나**.
   * `from` 은 자식 쪽 끝, `to` 는 부모 쪽 끝(둘은 서로 반대쪽을 본다).
   *
   * **거리가 아니라 교차를 노린다.** *"가장 가까운 끝"* 은 두 기둥의 **모서리**를 알아야 하고,
   * 모서리는 높이를, 높이는 `generateModule` 을 부른다 — 그 목표를 지키는 한 되먹임을 못 연다.
   * 반면 *"누가 위에 있나"* 는 **형제 순서**만으로 알고, 그건 트리가 안다.
   * 그리고 채널이 값을 매기는 것도 교차 쪽이다(교차하면 두 줄이 트랙을 못 나눠 쓴다).
   *
   * `undefined` = 모른다(형제가 하나뿐) → 배정이 오늘처럼 선착순으로 고른다.
   * **`id` 와 같은 규칙으로 산다**: 간선의 양끝을 아는 위층(`planner/modulePacking`)이
   * 채우고, 이 폴더는 만들지 않는다.
   */
  end?: { from: "N" | "S"; to: "N" | "S" };
}

/** [Link.carries] 의 항목 — 흐름 하나가 이 줄에 실은 몫. */
export interface LinkCarry {
  /** 내놓는 머신. **없으면 밖에서 온다**(원료). */
  from?: number;
  /** 받는 머신. **없으면 밖으로 나간다**(완제품). */
  to?: number;
  /** 이 줄이 맡은 초당 개수. */
  rate: number;
}

/**
 * **이 줄에 실린 초당 총량** — 적재 목록의 합. 목록이 없으면 `undefined`(지어내지 않는다).
 *
 * 유도가 한 곳뿐이라 합계가 목록과 어긋날 수 없다. 예전엔 `rate` 를 필드로 따로 들었는데,
 * 그러면 같은 수의 출처가 둘이 된다(이 저장소가 반복해 밟은 함정 — `tapCapacity` 세 출처).
 */
export function groupRate(group: Link): number | undefined {
  if (!group.carries) return undefined;
  return group.carries.reduce((sum, c) => sum + c.rate, 0);
}

/**
 * ─────────────────────────────── 붓기 ───────────────────────────────
 */

/** [createLinks] 가 보는 상한 — 벨트와 좌석, 두 축뿐이다. */
export interface LinkLimits {
  /** 쓸 수 있는 벨트 티어들(빠른 것부터). [determineBeltCount] 가 총량에서 고른 그것. */
  tiers: ReadonlyArray<SpecBelt>;
  /** 팔 하나 — 팔 수 유도([armsFor])에 쓴다. */
  inserter: SpecInserter;
  /**
   * **한 줄이 그 끝의 머신 한 대에게 줄 수 있는 최대**(초당) = 면 좌석 수 × 팔 하나.
   * 벨트 한 줄은 면 하나에 눕고 머신이 그 면에 가진 칸은 정해져 있어서, 그보다 많은 팔을
   * 한 줄에 붙일 수 없다. **벨트 용량과는 다른 축이다.**
   *
   * **`undefined` 는 그 끝이 모듈 밖이라는 뜻이다** — 밖에는 인서터가 앉을 면이 없으므로
   * 상한도 없다. 원료·완제품 줄이 이 값을 비운다.
   */
  fromSeat?: number;
  toSeat?: number;
}

/**
 * **흐름을 벨트 줄로 붓는다 — [Link] 를 만드는 유일한 곳**(2026-08-23 통합).
 *
 * ## 형태를 고르는 `if` 가 없다
 * 줄 수는 상한이 정하고, 흐름을 **순서대로** 그 줄들에 붓는다. 형태 셋은 그 결과를 읽은
 * 이름일 뿐이다([beltLineForm]):
 *
 * ```
 * 한 줄에 흐름이 하나         → 그 줄이 **다이렉트**
 * 한 줄에 흐름이 여럿 쌓임     → 그 줄이 **트렁크**
 * 한 머신이 줄 여럿을 씀       → 그 머신이 **split belt**
 * ```
 *
 * ## 안과 밖이 같은 모양이다
 * 입력이 [LinkCarry] 목록인 것이 요점이다 — `from`/`to` 가 **비어 있을 수 있고 빈 쪽이
 * 모듈 밖**이라, 자식→부모 흐름과 원료·완제품 줄이 **같은 자료**가 된다. 그래서 만드는
 * 곳이 하나면 된다. (예전엔 바깥 줄을 [externalLineGroups] 가 따로 조립했고, 그쪽은
 * 낟알이 **머신 통째**라 머신 한 대의 몫이 벨트 한 줄을 넘으면 쪼개지 못했다.)
 *
 * ## 교차가 안 생기는 이유
 * 흐름 수열이 **양끝 모두 단조**이고([allocateFlows]) 붓기가 그 순서를 유지하므로, 한 줄이
 * 맡는 머신은 각각 **연속 구간**이다. 좌표를 한 번도 안 보고 교차 불가가 나온다.
 *
 * **신원(`id`)은 안 단다** — 그건 간선의 양끝을 아는 호출자(`planner/link`)의 몫이다.
 */
export function createLinks(
  flows: ReadonlyArray<LinkCarry>,
  item: string,
  limits: LinkLimits,
): Link[] {
  const { tiers, inserter } = limits;
  const fromSeat = limits.fromSeat ?? Infinity;
  const toSeat = limits.toSeat ?? Infinity;

  type Pour = { cap: number; used: number; belt: string; carries: LinkCarry[] };
  const lines: Pour[] = [];
  const nextTier = () => tiers[Math.min(lines.length, tiers.length - 1)];
  const nextCap = (): number => nextTier().throughput;
  const openLine = (): Pour => {
    // `tiers` 의 합은 총량 이상이라 여기서 모자랄 일이 없다. 그래도 마지막 티어로 고정해
    // **없는 줄을 지어내는 대신** 마지막 줄에 얹는다(좌석 상한이 줄을 더 부를 수 있다).
    const tier = nextTier();
    const line: Pour = { cap: tier.throughput, used: 0, belt: tier.entityName, carries: [] };
    lines.push(line);
    return line;
  };
  // **적재 목록이 단일 출처다** — `from`/`to` 명단도 여기서 유도한다(아래 `armsBy`).
  const rateOn = (line: Pour, side: "from" | "to", mi: number | undefined): number =>
    line.carries.reduce((sum, c) => (c[side] === mi ? sum + c.rate : sum), 0);

  // 팔 수로 바로 더하면 안 된다 — 한 머신이 한 줄에 여러 번 실을 수 있고, `ceil` 을 조각마다
  // 적용하면 팔이 부풀어 오른다. **rate 로 모은 뒤 마지막에 한 번만 올린다.**
  // **흐름을 억지로 쪼개지 않는다 — 쪼개는 것이 곧 [[split belt]]이고, 쪼갬은 양이 강제할
  // 때만 생긴다.** 지금 줄에 다 안 들어가는데 **새 줄 하나에는 통째로** 들어가면 새 줄로 넘긴다.
  // 그러지 않고 그냥 이어 부으면 흐름이 두 줄에 걸쳐(= 억지 쪼갬) 한 줄이 머신 여러 대를
  // 걸치게 되고, 그 줄은 gap 으로 못 넘어가(가로 벨트는 아직 머신 하나만 맡는다) **자리를
  // 못 찾고 통째로 사라진다**(2026-08-22 실측: `linkMismatches`).
  const fitsInFreshLine = (rate: number) =>
    rate <= Math.min(nextCap(), fromSeat, toSeat) + POUR_EPS;

  // **한 머신이 자기 선호 면 예산을 넘으면 그 머신의 줄은 전용이어야 한다.**
  //
  // 넘으면 그 머신의 줄 하나는 선호 면에 못 앉아 **gap 으로 넘어가야** 하는데, gap 의 가로
  // 벨트는 아직 **머신 하나만** 맡는다([tryLinkFace] 의 `machinesOn !== 1`). 그때 그 줄이
  // 머신 둘을 걸치고 있으면 갈 곳이 없어 **통째로 사라진다**(2026-08-22 실측).
  //
  // 그래서 넘치는 쪽만 1:1 로 되돌린다 — 안 넘치면 병합은 공짜다.
  // **이 제약은 gap 능력의 그림자다** — 가로 벨트가 위·아래 두 대를 먹이게 되면 사라진다.
  // (밖인 끝은 상한이 `Infinity` 라 언제나 병합 가능이다 — 밖에는 좌석이 없다.)
  const peak = (side: "from" | "to"): number => {
    const per = new Map<number | undefined, number>();
    for (const f of flows) per.set(f[side], (per.get(f[side]) ?? 0) + f.rate);
    return Math.max(0, ...per.values());
  };
  const mergeFrom = peak("from") <= fromSeat + POUR_EPS;
  const mergeTo = peak("to") <= toSeat + POUR_EPS;

  const others = (line: Pour, side: "from" | "to", mi: number | undefined): boolean =>
    line.carries.some((c) => c[side] !== mi);

  let cur = openLine();
  for (const f of flows) {
    let left = f.rate;
    while (left > POUR_EPS) {
      const room = Math.min(
        cur.cap - cur.used,
        fromSeat - rateOn(cur, "from", f.from),
        toSeat - rateOn(cur, "to", f.to),
      );
      // 넘치는 쪽은 줄을 남과 나눠 쓰지 않는다(위 `mergeFrom`/`mergeTo`).
      const wouldMix =
        (!mergeFrom && others(cur, "from", f.from)) ||
        (!mergeTo && others(cur, "to", f.to));
      // 줄이 찼거나 이 머신의 좌석이 찼거나, 쪼갤 이유가 없는데 안 들어간다 → 새 줄.
      if (wouldMix || room <= POUR_EPS || (left > room + POUR_EPS && fitsInFreshLine(left))) {
        cur = openLine();
        continue;
      }
      const take = Math.min(left, room);
      cur.used += take;
      // **같은 흐름 조각은 한 항목으로 합친다** — 한 줄 안에서 두 번 나눠 실을 이유가 없고,
      // 나뉘어 있으면 팔 수를 조각마다 올림하게 되어 팔이 부풀어 오른다.
      const prev = cur.carries.find((c) => c.from === f.from && c.to === f.to);
      if (prev) prev.rate += take;
      else cur.carries.push({ from: f.from, to: f.to, rate: take });
      left -= take;
    }
  }

  // **팔 수는 적재 목록에서 유도된다.** 한 머신이 이 줄에서 주고받는 rate 를 모아 한 번만
  // 올린다(조각마다 올리면 팔이 부풀어 오른다). 밖인 끝은 명단이 비어 나온다.
  return lines.map((line) => ({
    item,
    from: armsFromCarries(line.carries, "from", inserter),
    to: armsFromCarries(line.carries, "to", inserter),
    carries: line.carries,
    beltEntityName: line.belt,
  }));
}

/** 붓기의 부동소수 여유 — rate 가 60.5 같은 분수라 경계에서 흔들린다. */
const POUR_EPS = 1e-9;

/**
 * **적재 목록 → 머신별 팔 수.** 한 머신이 이 줄에서 주고받는 rate 를 모아 **마지막에 한 번만**
 * 올린다 — 조각마다 `ceil` 하면 팔이 부풀어 오른다. 밖인 끝(`undefined`)은 명단에서 빠진다.
 */
function armsFromCarries(
  carries: ReadonlyArray<LinkCarry>,
  side: "from" | "to",
  inserter: SpecInserter,
): Map<number, number> {
  const per = new Map<number, number>();
  for (const c of carries) {
    const mi = c[side];
    if (mi === undefined) continue;
    per.set(mi, (per.get(mi) ?? 0) + c.rate);
  }
  return new Map([...per].map(([mi, r]) => [mi, armsFor(r, inserter) ?? 1]));
}

/**
 * **이 줄을 그 인서터로 먹이면 머신마다 팔이 몇 개인가** — 배정이 깊이 후보마다 묻는다.
 *
 * 축은 깊이가 아니라 `(인서터, 그 팔이 집는 타일)` 이다(계획서 §16). 깊이를 고르면 팔 종류가
 * 정해지고, 팔 종류가 처리량을 정하고, 처리량이 팔 **개수**를 정한다. 그래서 개수는 깊이를
 * 고르기 **전에** 셀 수 없다 — 그걸 미리 세던 것이 결함 A 다.
 *
 * **적재 목록이 없으면 `from`/`to` 를 그대로 돌려준다** — 수량을 모르면 지어내지 않는다는
 * 규칙 그대로다(픽스처처럼 rate 없이 팔 수만 적어 준 줄이 여기 해당한다). 그런 줄은 깊이가
 * 바뀌어도 팔 수가 안 변하므로 **오늘 동작 그대로**다.
 *
 * **[createLinks] 와 같은 산술을 쓴다** — 그쪽이 reach 1 로 부른 결과가 곧 `from`/`to` 이므로,
 * `armsAt(group, side, reach1 인서터)` 는 `group[side]` 와 **같은 값**이다(`link.form.test.ts`).
 */
export function armsAt(
  group: Link,
  side: "from" | "to",
  inserter: SpecInserter | undefined,
): Map<number, number> {
  if (!group.carries || !inserter) return group[side];
  return armsFromCarries(group.carries, side, inserter);
}

/**
 * **구간막힘(`span-blocked`)을 푼다** — 자를 경계를 내놓거나, 못 푼다고 답한다.
 *
 * 면에서 줄이 못 앉는 교착은 넷이고([LadderRung]) 이 함수는 그중 **하나만** 맡는다:
 *
 * ```
 * seat-budget   좌석 예산 초과 — 면의 d1 칸이 모자라다
 * seat-blocked  내 **좌석 칸**이 막혔다
 * span-blocked  좌석은 비었는데 **그 사이를 잇는 구간**이 막혔다   ← 여기
 * port-blocked  구간은 지나는데 **포트 칸**이 막혔다
 * ```
 *
 * 구간막힘이 푸는 문제는 하나뿐이다:
 *
 * > **막힌 칸 *사이에* 내 좌석이 들어갈 빈 자리가 있나.**
 *
 * 막힌 칸이 **점**이면(= 남의 **포트 인서터**) 사이가 비어 조각이 산다. 막힌 칸이
 * **구간**이면(= 남의 **벨트**) 내 좌석이 그 안에 잠겨 조각을 내도 앉을 데가 없다.
 *
 * ```
 * 좌석 S = {1,4,…,268}   막힌 B = {90,180}    조각 [1,88] [91,178] [181,268]  → 전부 산다 ✔
 * 좌석 S = {1,4,…,268}   막힌 B = {1,2,…,268} 조각마다 그 칸도 B 안           → 하나도 안 산다 ✘
 * ```
 *
 * **판정에 "무엇이 막았나"는 필요 없다** — 벨트냐 포트냐는 *설명*이고, 물음은 *"조각이 비나"*
 * 하나다. 그래서 이 함수는 두 행 목록만 받는다.
 *
 * **전부 살아야 자른다.** 일부만 살면 못 살 머신의 포트까지 함께 늘어난다 — 사다리는 후보를
 * 늘리는 것이지 포트를 늘리는 것이 목적이 아니다. 부분해는 다음 칸(gap·다이렉트)의 몫이다.
 *
 * 그래서 **거절 조건은 하나뿐이다: 막힌 칸이 내 좌석 칸이다.** 조각을 낸 뒤 그 조각의 구간이
 * 못을 덮는 일은 **구성상 없다** — 이웃한 두 좌석 사이에 못이 있으면 거기서 이미 잘랐으므로
 * 조각 안에는 못이 남지 않는다. (그 검사를 한 번 넣었다가 지웠다. 도달 불가능한 안전망은
 * *"구성상 발생 안 함"* 주석을 하나 더 만들 뿐이고, 이 저장소는 그 주석이 거짓이었던 값을
 * 이미 치렀다.)
 *
 * @returns 자를 경계(= 그대로 [splitLinkAtRows] 의 `nailRows`). **못 풀면 빈 배열** —
 *          그때 이 교착은 `span-blocked` 가 아니라 `seat-blocked` 다.
 */
export function resolveSpanBlock(
  seatRows: readonly number[],
  blockedRows: readonly number[],
): number[] {
  const S = [...new Set(seatRows)].sort((a, b) => a - b);
  const B = [...new Set(blockedRows)].sort((a, b) => a - b);
  if (S.length === 0 || B.length === 0) return [];

  // 막힌 행으로 좌석을 조각낸다. 막힌 행 위에 좌석이 있으면 그 좌석은 애초에 못 앉는다.
  const pieces: number[][] = [];
  let cur: number[] = [];
  for (const r of S) {
    if (B.includes(r)) return []; // 내 좌석 칸 자체가 막혔다 — 쪼개도 그 머신은 못 앉는다
    if (cur.length > 0 && B.some((b) => b > cur[cur.length - 1] && b < r)) {
      pieces.push(cur); cur = [];
    }
    cur.push(r);
  }
  if (cur.length) pieces.push(cur);
  if (pieces.length <= 1) return []; // 자를 자리가 없다
  return B;
}

/**
 * **줄 하나를 못을 피해 토막낸다** — 사다리 1단.
 * 설계는 `docs/auto-layout/link/machine-link.md` — *자리가 없으면 링크를 토막낸다*.
 *
 * `nailRows` 는 배정이 낸 **막힌 행**이다([DepthShortage.blockedRows]). 행은 모듈-로컬 순번
 * (`머신index × rowsPerMachine + 칸`)이므로 **그 행을 가진 머신 앞에서 자르면** 토막의 구간이
 * 그 행을 안 덮는다 — 못은 언제나 먼저 앉은(= 더 얕은 칸을 쓴) 줄의 포트이기 때문이다.
 *
 * ```
 * 못 [90, 180], rowsPerMachine 3   →  머신 30·60 앞에서 자른다
 * 머신 0..89 한 줄                 →  0..29 · 30..59 · 60..89   토막 3, 포트 3
 * ```
 *
 * **`carries` 가 진짜 출처다** — 토막마다 자기 몫의 적재 목록을 갖고, `from`/`to` 는 그것에
 * 맞춰 좁힌다. 적재 목록이 없으면(수량 미상) **쪼개지 않는다** — 지어낼 수가 없다.
 *
 * 신원은 `${원래id}/${순번}` 이다. **양끝이 같은 객체를 보므로**(`modulePacking.linkCache`)
 * 자식 출력과 부모 입력이 함께 갈라진다 — 한쪽만 쪼개면 [pairDeliveryPorts] 가 짝을 못 찾는다.
 */
export function splitLinkAtRows(
  group: Link,
  side: "from" | "to",
  nailRows: readonly number[],
  rowsPerMachine: number,
): Link[] {
  if (!group.carries?.length || nailRows.length === 0 || rowsPerMachine <= 0) return [group];
  const cuts = new Set(nailRows.map((r) => Math.floor(r / rowsPerMachine)));
  const machines = [...group[side].keys()].sort((a, b) => a - b);
  if (machines.length <= 1) return [group]; // 쪼갤 것이 없다

  // 못이 가리키는 머신 **앞에서** 자른다 — 그 머신부터 새 토막이 시작한다.
  const segments: number[][] = [];
  let cur: number[] = [];
  for (const mi of machines) {
    if (cur.length > 0 && cuts.has(mi)) { segments.push(cur); cur = []; }
    cur.push(mi);
  }
  if (cur.length) segments.push(cur);
  if (segments.length <= 1) return [group]; // 못이 구간 밖이었다

  return segments.map((seg, k) => {
    const own = new Set(seg);
    const carries = group.carries!.filter((c) => {
      const mi = c[side];
      return mi !== undefined && own.has(mi);
    });
    const narrow = (m: Map<number, number>, s: "from" | "to") =>
      new Map([...m].filter(([mi]) => carries.some((c) => c[s] === mi)));
    return {
      ...group,
      from: narrow(group.from, "from"),
      to: narrow(group.to, "to"),
      carries,
      id: group.id === undefined ? undefined : `${group.id}/${k}`,
    };
  });
}

/**
 * ─────────────────────────────── 판독 ───────────────────────────────
 *
 * **형태는 조건에서 나오고([edgeLinkGroups] 의 붓기), 여기서는 그것을 *읽을* 뿐이다.**
 * 읽는 것이 값을 하는 자리는 둘이다 — 면 배정이 *"이 줄이 머신 몇 대짜리냐"* 를 묻는 곳
 * ([tryLinkFace])과, 진단이 *"이 배치에 트렁크가 몇 줄이냐"* 를 세는 곳([summarizeBeltForms]).
 *
 * **판독의 산출을 인자로 되돌리지 않는다.** 형태 이름(`"trunk"`)이 함수 인자로 흘러가기
 * 시작하면 형태가 다시 **입력**이 되고, 그게 이 설계가 없앤 것이다
 * (`tempPlanDocs/배선-형태/CLAUDE.md`).
 */

/** 이 줄이 그 끝에서 만지는 머신 수. **빈 쪽은 0** — 상대가 모듈 밖이다(원료·완제품). */
export function machinesOn(group: Link, side: "from" | "to"): number {
  return group[side].size;
}

/**
 * 이 줄이 싣는 [[흐름]] 수 — 적재 목록의 항목 수. 모르면 `undefined`(지어내지 않는다).
 *
 * [beltLineForm] 은 이 값을 **안 쓴다**(명단으로 판정한다) — 명단은 언제나 있고 적재 목록은
 * 수량 미상이면 없기 때문이다. 둘이 같은 답을 낸다는 것이 `link.form.test.ts`
 * 의 동치 불변식이고, 그게 깨지면 `carries` 와 `from`/`to` 가 어긋난 것이다.
 */
export function flowsOn(group: Link): number | undefined {
  return group.carries?.length;
}

/**
 * **축 A 판독** — 이 줄이 흐름 하나만 나르나(다이렉트), 여럿을 나르나(트렁크).
 * 정의는 [docs/용어사전.md](../../../docs/용어사전.md) §D.
 *
 * 한쪽 끝에서라도 머신 여럿을 만지면 트렁크다 — 그 줄이 남의 행을 지나야 하고, 그래서
 * 인접을 요구하고 깊이 × 행 구간을 통째로 청구한다.
 */
export function beltLineForm(group: Link): "direct" | "trunk" {
  return machinesOn(group, "from") > 1 || machinesOn(group, "to") > 1 ? "trunk" : "direct";
}

/**
 * **축 A′ 판독** — 이 줄이 기둥을 **관통**하나(그 끝의 머신을 전부 만지나).
 *
 * 관통이면 포트가 옆에 설 수 없다 — 바깥에서 상자에 닿으려면 더 깊은 줄을 가로질러야
 * 하는데 관통 줄은 어떤 행에서도 못 건넌다. 그래서 포트가 **기둥 끝**으로 간다
 * ([LinkFacePlan.portEnd]).
 *
 * `count > 1` 조건은 **현행 동작 보존**이다 — 1대짜리 모듈에서 모든 줄이 관통이 되면
 * 포트가 전부 기둥 끝으로 몰린다.
 */
export function spansAllMachines(
  group: Link,
  side: "from" | "to",
  count: number,
): boolean {
  return machinesOn(group, side) === count && count > 1;
}

/**
 * **한 배치가 실제로 어떤 형태를 깔았나** — 진단 계수기의 단일 출처.
 *
 * 없어서 데인 적이 있다: glass 100/s 에서 필요 5줄 자리에 **54줄**이 깔렸는데(줄당 이용률
 * 8%, 채널 폭 34) 그 사실을 **사후에 손으로 세어** 알았다. 형태가 산출물 어디에도 안 남기
 * 때문이다. 이 함수가 그 수를 낸다 — `flg.report()` 가 읽는다.
 *
 * `fromCount`/`toCount` 는 그 끝의 **클러스터 대수**다(자식 쪽과 부모 쪽이 다르다).
 * 외부 줄은 빈 쪽이 있으므로 그쪽 대수는 안 쓰인다.
 */
export interface BeltFormCounters {
  /** 흐름을 여럿 실은 줄 수. */
  trunk: number;
  /** 흐름을 하나만 실은 줄 수. */
  direct: number;
  /** 그중 기둥을 관통하는 줄 수(포트가 기둥 끝으로 가는 것). */
  spanning: number;
  /** 머신 하나가 쓰는 줄 수의 **최대** — fan-out 의 크기. */
  fanOutMax: number;
  /** 줄들에 실린 초당 총량(수량을 아는 줄만). */
  loaded: number;
  /** 그 줄들이 쓰는 벨트의 처리량 합 — `loaded ÷ capacity` 가 이용률이다. */
  capacity: number;
  /**
   * **붓지 못해 폴백으로 난 줄 수** — 이용률을 잴 수 없다.
   *
   * 실측 트리거는 `amount: 0` 산출물이 대부분이다(아르코스피어 접기 등). *"수량 미상"* 이
   * 아니다 — 실데이터의 모든 산출물은 수량을 갖는다(2026-08-23 대조).
   */
  unpourable: number;
  /**
   * **과적재 — 실린 양이 그 줄의 벨트 처리량을 넘는 줄 수.**
   *
   * 0이 아니면 그 줄은 **못 나른다.** 그런데 배치는 "성공"이라 보고하고 게임에 넣어야
   * 그 머신이 굶는 걸 안다 — 이 저장소가 가장 위험하다고 적어 둔 실패 종류다.
   * 합계 이용률로는 안 잡힌다(남는 줄이 넘치는 줄을 가린다). **그래서 따로 센다.**
   */
  overloaded: number;
}

export const emptyBeltFormCounters = (): BeltFormCounters => ({
  trunk: 0, direct: 0, spanning: 0, fanOutMax: 0, loaded: 0, capacity: 0, unpourable: 0, overloaded: 0,
});

export function summarizeBeltForms(
  entries: ReadonlyArray<{ group: Link; fromCount: number; toCount: number }>,
  /** 벨트 이름 → 초당 처리량. 모르면 `undefined`(그 줄은 `unknown` 으로 센다). */
  throughputOf: (entityName: string | undefined) => number | undefined,
): BeltFormCounters {
  const c = emptyBeltFormCounters();
  /** `${side}:${머신index}` → 그 머신이 쓰는 줄 수. 양쪽을 따로 센다(끝이 다르면 다른 머신). */
  const linesPerMachine = new Map<string, number>();
  for (const { group, fromCount, toCount } of entries) {
    if (beltLineForm(group) === "trunk") c.trunk += 1;
    else c.direct += 1;
    if (spansAllMachines(group, "from", fromCount) || spansAllMachines(group, "to", toCount)) {
      c.spanning += 1;
    }
    for (const side of ["from", "to"] as const) {
      for (const mi of group[side].keys()) {
        const k = `${side}:${mi}`;
        linesPerMachine.set(k, (linesPerMachine.get(k) ?? 0) + 1);
      }
    }
    const rate = groupRate(group);
    const tp = throughputOf(group.beltEntityName);
    if (rate === undefined || tp === undefined || !(tp > 0)) c.unpourable += 1;
    else {
      c.loaded += rate;
      c.capacity += tp;
      // 부동소수 여유 — rate 가 60.5 같은 분수라 경계에서 흔들린다.
      if (rate > tp + 1e-9) c.overloaded += 1;
    }
  }
  c.fanOutMax = Math.max(0, ...linesPerMachine.values());
  return c;
}

/** 두 계수기를 합친다 — 모듈마다 한 벌씩 나므로 누적이 필요하다(최대는 최대끼리). */
export function mergeBeltFormCounters(a: BeltFormCounters, b: BeltFormCounters): BeltFormCounters {
  return {
    trunk: a.trunk + b.trunk,
    direct: a.direct + b.direct,
    spanning: a.spanning + b.spanning,
    fanOutMax: Math.max(a.fanOutMax, b.fanOutMax),
    loaded: a.loaded + b.loaded,
    capacity: a.capacity + b.capacity,
    unpourable: a.unpourable + b.unpourable,
    overloaded: a.overloaded + b.overloaded,
  };
}

/**
 * **밖과 주고받는 그룹의 방향을 읽는다** — [makeLink] 의 역([isInternalLink] 로 안↔안이 아님을
 * 이미 안 그룹에만 쓴다). 빈 쪽이 밖이므로, 머신이 든 쪽이 곧 역할이다:
 *  - `to` 에 머신 → **input**(밖에서 받는다 = 원료).
 *  - `from` 에 머신 → **output**(밖으로 낸다 = 완제품).
 *
 * `find…` 가 아니다 — 다른 링크를 **찾는** 건 [pairDeliveryPorts] 의 일이고, 이건 이 그룹 자신의
 * **속성**을 읽을 뿐이다.
 */
export function readLinkRole(group: Link): "input" | "output" {
  return group.to.size > 0 ? "input" : "output";
}

/**
 * **외부 줄(원료·완제품)을 [Link] 으로 낸다** — 2026-07-23 결정.
 *
 * ## 왜 같은 구조인가
 * 모듈 밖과 주고받는 줄도 물리적으로 링크와 **똑같은 일**이다: 머신 면에 팔을 앉히고
 * 벨트 한 줄로 나른다. 다른 건 상대가 안(부모·자식 머신)이냐 밖(무한상자)이냐 하나뿐이라,
 * [Link] 의 빈 쪽으로 표현된다.
 *
 * 그래서 "링크 있는 줄 / 없는 줄"이라는 갈래가 **자료 구조에서는 사라진다** — 남는 갈래는
 * 하나뿐이다: **수량을 아나 모르나**. 아는 줄은 여기서 그룹이 되고, 모르는 줄은 그룹이 안
 * 된다([edgeFlows] 도 같은 문턱에서 `undefined` 를 낸다). 지어낸 숫자로 그룹을
 * 만들면 그 순간 벨트 부하 계산이 거짓말을 시작한다.
 *
 * ## 여기서 벨트를 쪼개지 않는다 (일부러)
 * 그룹 하나 = 벨트 하나지만, 이 함수는 **줄 하나당 그룹 하나**만 낸다. 수요가 벨트 한 줄을
 * 넘을 때 몇 줄로 늘릴지는 이미 [determineBeltCount] 가 낸 티어 수가
 * 정하고 있다. 여기서 또 쪼개면 **같은 수를 두 곳이 각자 유도**하게 되고, 그게 이 세션에
 * 고친 버그들의 공통 원인이었다(tapCapacity 세 출처·배정 수 두 출처). 쪼개기를 여기로
 * 옮긴다면 저쪽에서 **빼면서** 옮겨야 한다.
 *
 * ## 묶은 그룹 ↔ 쪼갠 그룹 — **공급 방식이 곧 이 선택이다** (2026-08-05)
 *
 * 같은 줄을 두 모양으로 낼 수 있고, 그 둘이 정확히 두 공급 방식이다:
 *
 * | | 그룹 | 벨트 | 한 면에 몇 줄 | 포트 |
 * |---|---|---|---|---|
 * | **묶은 것**(기본) | 줄 하나 = 그룹 하나, 담당 = 전 머신 | 여러 머신이 **나눠 집는** 한 줄 | 팔 길이 종류 수 | 품목당 1 |
 * | **쪼갠 것**(`perMachine`) | 줄 하나 = 그룹 **n개**, 담당 = 머신 하나씩 | 머신마다 **자기 벨트** | 그 면의 둘레 칸 수 | 머신 × 품목 |
 *
 * 쪼개면 [tryLinkFace] 의 *"그룹 하나 = 머신 하나"* 문턱을 통과한다 — 그래서 **위/아래(gap)로
 * 넘기는 능력이 따라온다.** 기둥 축과 수직인 가로 벨트는 자기가 닿는 머신 한 대만 먹일 수
 * 있는데, 쪼갠 그룹은 애초에 한 대짜리라 그 제약에 걸릴 것이 없기 때문이다.
 *
 * @param linkedKeys 이미 내부 링크가 있는 줄의 키(`${role}:${name}`) — 두 번 세지 않는다.
 * @param opts.bundle 묶음 크기 `g` — 안 주면 줄마다 `min(⌊벌트÷per⌋, N)` 으로 유도한다.
 */
/**
 * **묶음 크기의 상한** `g_max` — 벨트 한 줄이 맡을 수 있는 머신 수(TR1).
 *
 * ```
 * g_max = min(N, ⌊벨트 처리량 ÷ 머신 하나의 몫⌋)
 * ```
 *
 * **이건 상한일 뿐 실제 `g` 가 아니다.** 자리(깊이 예산)가 여기서 더 깎는다 —
 * 관통 줄은 깊이를 통째로 먹으므로 면마다 몇 줄까지 관통할 수 있는지가 따로 있다
 * (`docs/auto-layout/module/trunk-assignment.md` §4.2, 계산은 [planBundles]).
 *
 * 수량을 모르면 `N` 이다 — **지어내지 않는다.** 그 값이 곧 옛 탭 동작이고,
 * 깊이 예산이 그걸 다시 깎는 것이 지금의 모양이다.
 *
 * 붓기와 계획이 **같은 함수를 본다**(R3). 예전엔 이 식이 [externalLineGroups] 안에만
 * 있어서 바깥에서 `g_max` 를 알려면 베껴 쓰는 수밖에 없었다.
 */
export function bundleCap(
  machineCount: number,
  per: number | undefined,
  beltThroughput: number | undefined,
): number {
  const n = Math.max(1, machineCount);
  return per !== undefined && per > 0 && beltThroughput !== undefined && beltThroughput > 0
    ? Math.min(n, Math.max(1, Math.floor(beltThroughput / per)))
    : n;
}

export function externalLineGroups(
  lines: ReadonlyArray<IoLine>,
  machineCount: number,
  cap: SupplyCapacity,
  /**
   * 고른 인서터들 — **여기 팔은 언제나 `reach 1`** 이다: 밖과 주고받는 팔은 상자와 머신
   * **양쪽에 인접**해야 해서 상자가 `d2`, 팔이 `d1` 이다. 깊은 벨트를 집는 것은 탭뿐이다.
   */
  inserters: ReadonlyArray<SpecInserter>,
  linkedKeys?: ReadonlySet<string>,
  opts?: {
    /**
     * **묶음 크기를 바깥에서 못박는다** — 주면 그 값을 쓰고, 안 주면 **줄마다 유도한다**
     * (`g = min(⌊가장 빠른 벨트 ÷ 머신 하나의 몫⌋, N)`).
     *
     * 옛 `perMachine: boolean` 을 대체한다. 그것은 **모듈 하나의 값이 그 모듈의 모든 줄**을
     * 정했고, 그래서 한 줄이 안 되면 전부 `g = 1` 로 떨어졌다. 유도로 바꾸면 그 이분법이
     * **한 공식의 두 끝**이 된다 — `per` 가 작으면 `g = N`(관통), 벨트를 넘으면 `g = 1`(다이렉트).
     */
    bundle?: number;
    belts?: ReadonlyArray<SpecBelt>;
    /**
     * 머신 면의 길이 방향 칸 수(W/E 면이면 `machine.h`) — **좌석 상한의 재료**다.
     * 없으면 좌석 상한 없이 붓는다(옛 동작). [edgeLinkGroups] 와 **같은 낙관**으로
     * `fluidRows = 0` 을 쓴다 — 이 시점엔 그 줄이 어느 면에 앉을지 모른다.
     */
    machineFaceCells?: number;
  },
): Link[] {
  const n = Math.max(1, machineCount);
  const inserter = inserterForReach(inserters, 1);
  const groups: Link[] = [];
  // **여기서 나는 줄은 신원(`id`)을 안 단다.**
  //
  // [Link.id] 는 *"이 포트는 형제 모듈의 **저** 포트와 짝"* 이라는 **지정 짝**을 뜻하고,
  // 그 지정은 [allocateFlows] 가 머신 단위로 배정했을 때만 존재한다. 원료·완제품 줄은 그
  // 배정을 안 거치므로 **교환 가능**이고, [pairDeliveryPorts] 는 그때 위치-zip 으로 짝짓는다
  // — 신원이 있으면 조회 갈래로 빠져 짝을 못 찾고 불변식 위반으로 보고한다(2026-08-17).
  for (const line of lines) {
    // 유체는 팔로 나르지 않는다 — 트렁크 파이프의 일이라 벨트 장부에 안 올린다.
    if (line.kind !== "belt") continue;
    const key = `${line.role}:${line.name}`;
    if (linkedKeys?.has(key)) continue;
    const total = cap.lineRates?.get(key);
    const per = total !== undefined && n > 0 ? total / n : undefined; // 머신 한 대의 몫
    // 밖과 주고받는 줄은 **한쪽 끝이 비어 있다**([LinkCarry]). 머신이 든 쪽이 곧 역할이다.
    const side: "from" | "to" = line.role === "output" ? "from" : "to";
    // **좌석 상한은 머신 쪽 끝에만 있다** — 밖에는 인서터가 앉을 면이 없다.
    const seat =
      inserter && opts?.machineFaceCells !== undefined
        ? faceSeatArms(opts.machineFaceCells, 0) * inserter.throughput
        : undefined;

    /** 이 머신들의 몫을 [createLinks] 에 부어 줄로 만든다. 못 만들면 빈 배열(폴백으로 간다). */
    const pour = (machines: readonly number[]): Link[] => {
      if (per === undefined || !inserter) return []; // 수량 미상 — 지어내지 않는다
      const tiers = determineBeltCount(per * machines.length, [...(opts?.belts ?? [])]);
      if (tiers.length === 0) return []; // 벨트를 못 고름
      return createLinks(
        machines.map((i) => (side === "from" ? { from: i, rate: per } : { to: i, rate: per })),
        line.name,
        {
          tiers,
          inserter,
          fromSeat: side === "from" ? seat : undefined,
          toSeat: side === "to" ? seat : undefined,
        },
      );
    };

    // **낱알은 `g`(묶음 크기) 가 정한다** — 한 벌트 줄이 몇 대를 맡나.
    //
    // ```
    // g = 1     머신마다 자기 벌트            = 다이렉트
    // g = N     벌트 하나가 기둥 전체        = 관통(트렁크)
    // 1<g<N     **부분 트렁크** — 예전엔 없었다
    // ```
    //
    // 상한은 처리량이 준다: `k = ⌊벌트 처리량 ÷ 머신 하나의 몴⌋`.
    // 넘기면 그 벌트가 굶는다. 그래서 `g = min(k, N)` 이 **공식 하나**이고,
    // 예전의 이분법(탭/다이렉트)이 그 **두 끕**이 된다.
    //
    // **쪼개는 일 자체는 여전히 [createLinks] 가 한다** — 여기서 정하는 것은
    // *한꺼번에 몇 명씩 부을까* 뿐이고, 부은 묶음 안에서는 벌트·좌석 상한까지 채운다.
    const g = opts?.bundle ?? bundleCap(n, per, opts?.belts?.[0]?.throughput);
    const batches: number[][] = [];
    for (let i = 0; i < n; i += Math.max(1, g))
      batches.push(Array.from({ length: Math.min(g, n - i) }, (_, j) => i + j));
    const made: Link[] = [];
    let poured = true;
    for (const batch of batches) {
      const got = pour(batch);
      if (got.length === 0) {
        poured = false;
        break;
      }
      made.push(...got);
    }
    if (poured) {
      groups.push(...made);
      continue;
    }

    // ── 못 부었다 — **가짜 줄을 만들지 않는다**(2026-08-24) ─────────────────────
    //
    // 예전엔 여기서 팔 1개짜리 줄을 조립해 내보냈다([makeLink], 삭제됨). *"모른다"* 를
    // 표시하려던 것인데 실제로는 **아는 척하는 줄**이었다 — 포트가 나고 벨트가 깔리고
    // 계수기에 잡히는데 실을 양이 없다. 배치는 "성공"이라 보고하고 게임에 넣어야 안다.
    //
    // 지울 수 있게 된 것은 거절이 **한 층 위로** 올라갔기 때문이다: 벨트·인서터를 하나도
    // 안 골랐으면 `runModulePipeline` 이 진입에서 사유와 함께 거절한다. 여기까지 내려온
    // 줄은 **양을 모를 뿐**이고, 그 줄은 안 만드는 게 맞다 — 0개를 나르는 벨트는 없다.
    //
    // 남는 자리는 `flg.report()` 의 `붓기불가` 가 센다.
    continue;
  }
  return groups;
}
