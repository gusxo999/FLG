/**
 * edgeLinks — **모듈과 모듈을 잇는 일**. 자식 클러스터의 산출을 부모에게 어떻게 나눠 줄지,
 * 그 결과로 난 포트를 어떻게 짝지을지, 그 벨트를 무슨 이름으로 부를지.
 *
 * ## 왜 `link/` 인가
 * 여기 있는 함수는 전부 **두 모듈의 식별자를 안다** — `child.id`·`parent.id` 를 받아
 * 신원을 만들고([makeLinkId]), 자식·부모 양쪽의 대수와 rate 를 함께 본다. 그것이 축 2 의
 * `link` 판정이다. 반대로 `module/link` 은 로컬 머신 index 만 알아 `module` 이다.
 *
 * ## 신원(`linkId`)의 단일 출처
 * [makeLinkId] 가 이 저장소에서 링크 신원을 **만드는 유일한 곳**이다. 모듈과 방출기는
 * 그것을 **복사만 하고 파싱하지 않는다** — 파싱하는 순간 모듈이 형제를 알게 된다.
 * 신원이 있으면 [pairDeliveryPorts] 가 배열 위치가 아니라 **조회**로 짝을 찾는다.
 *
 * ## `modulePacking` 과의 관계
 * 조율자는 `modulePacking` 이고, 여기는 그 조율자가 부르는 **link 관심사의 계산**이다.
 * 트리 타입(`NodeSpec`·`PackConfig`)은 `planner/tree/types` 에서 온다 — **조율자를 올려다보지 않는다**
 * (2026-09-14. 그 전엔 조율자 파일에서 타입을 가져오며 *"런타임 간선이 아니라 순환이 아니다"* 라고 적었는데,
 * 선례로 든 `clusterModule ⇄ emitModule` 이 실제로는 런타임 순환이었다 — work-kinds §7 D4).
 */

import type { Link, LinkCarry } from "../../module/types/line";
import type { GeneratedModule, ModulePort } from "../../module/types/module";
import { createLinks } from "../../module/arith/link";
import { allocateFlows, type Flow } from "../arith/flows";
import { faceSeatArms, inserterForReach } from "../../shared/gamedata/spec";
import { determineBeltCount } from "../../shared/arith/belt";
import type { NodeSpec, PackConfig } from "../../tree/types/pack";

/**
 * **신원 없는(옛 탭/다이렉트, 교환 가능) 납품 경로만을 위한** 위치 기반 키. **직접 부르지 않는다** —
 * 모든 소비처는 [deliveryKey] 를 쓴다. 밖으로 안 내보내는 이유: 이 함수만 부르면 `linkId` 를
 * 빠뜨린 채 `seq=0` 기본값으로 **엉뚱한 납품 경로**을 조회하게 된다(2026-07-21, 바로 이 실수가
 * `channel/ledger/geometry.test.ts` 에 있었다 — count=1 픽스처라 우연히 안 터졌을 뿐이었다).
 *
 * 1:1 방출(트렁크 비활성)에서는 자식 출력 포트가 머신 수만큼, 부모 입력 포트도 머신 수만큼
 * 있으므로 같은 (from,to,item) 납품 경로가 **여럿**이다. `seq`(짝 index)가 그것들을 구분한다 —
 * 포트가 물리적으로 교환 가능해 위치가 곧 정직한 유일한 신원이기 때문이다.
 */
function dKey(fromId: string, toId: string, item: string, seq = 0): string {
  return `${fromId}→${toId}:${item}#${seq}`;
}

/**
 * `PackChannelGeometry.deliveries`/[reservationEmittable] 의 조회 키 — 소비처가 부를 **유일한**
 * 함수. 신원(`linkId`)이 있으면 그대로 쓰고, 없으면(교환 가능 포트) [dKey] 로 위치 기반
 * 키를 만든다.
 */
export function deliveryKey(delivery: { fromId: string; toId: string; item: string; seq: number; linkId?: string }): string {
  return delivery.linkId ?? dKey(delivery.fromId, delivery.toId, delivery.item, delivery.seq);
}

/**
 * **링크 그룹 신원** — 자식→부모 간선의 몇 번째 벨트인가. [edgeLinkGroups] 가 자식·부모
 * 양쪽에서 **같은 값으로(child, parent, item, config)** 독립으로 계산되므로, 이 키를
 * 대화 없이 양쪽이 동일하게 재현할 수 있다. `ModulePort.linkId` 가 이 값을 그대로 든다.
 */
function makeLinkId(childId: string, parentId: string, item: string, groupIndex: number): string {
  return `${childId}→${parentId}:${item}#${groupIndex}`;
}

/**
 * 자식 출력 포트 ↔ 부모 입력 포트 **짝짓기** (같은 품목).
 *
 * 두 종류가 섞여 들어온다:
 *  - **신원 있는 포트**([ModulePort.linkId], link 그룹에서 난 포트) — 상대가 **정해져 있다**.
 *    `linkId` 로 직접 조회한다(추측이 아니라 조회). 못 찾으면 **예약 불변식이 깨졌다는
 *    신호**([channel-geometry-reservation] 철학)라 그 포트만 raw 로 남기고 `mismatches` 에
 *    사유를 남긴다 — `modulePerimeterPass.fail` 과 같은 관용구(skip, throw 안 함).
 *  - **신원 없는 포트**(옛 탭/다이렉트) — 물리적으로 교환 가능해 정답이 없다. 등장 순서대로
 *    **1:1 로 짝**짓는다(기존 동작 그대로).
 *
 * 개수가 안 맞으면(신원 없는 쪽) 남는 쪽은 짝이 없다 — 부모 입력이 남으면 무한상자로 남아
 * 외부에서 공급받고(raw), 자식 출력이 남으면 무한상자 sink 로 남는다. 둘 다 perimeter 로
 * 나가야 하므로 `rawPorts` 에 들어간다.
 *
 * `usedIn` 은 **같은 부모를 여러 자식이 먹일 때**(같은 품목을 두 노드가 생산) 부모 입력
 * 포트를 두 번 쓰지 않게 하는 장부다.
 */
export function pairDeliveryPorts(
  childMod: GeneratedModule,
  parentMod: GeneratedModule,
  item: string,
  usedIn: Set<string>,
  mismatches: string[],
): { out: ModulePort; inp: ModulePort }[] {
  const outs = childMod.outputPorts.filter((p) => p.line.name === item);
  const ins = parentMod.inputPorts.filter((p) => p.line.name === item && !usedIn.has(p.chest.id));
  const pairs: { out: ModulePort; inp: ModulePort }[] = [];

  // ① 신원이 있는 쪽 — 조회. 배열 위치가 아니라 linkId 로 짝을 찾는다.
  const insById = new Map(ins.filter((p) => p.linkId !== undefined).map((p) => [p.linkId!, p]));
  const exchangeableOuts: ModulePort[] = [];
  for (const out of outs) {
    if (out.linkId === undefined) { exchangeableOuts.push(out); continue; }
    const inp = insById.get(out.linkId);
    if (!inp) {
      mismatches.push(`${out.linkId}: no matching parent input port (child emitted, parent didn't)`);
      continue;
    }
    usedIn.add(inp.chest.id);
    insById.delete(out.linkId);
    pairs.push({ out, inp });
  }

  // ② 신원이 없는 쪽(옛 탭/다이렉트) — 교환 가능이라 위치-zip 이 정답이다(기존 동작 그대로).
  const exchangeableIns = ins.filter((p) => p.linkId === undefined && !usedIn.has(p.chest.id));
  for (let i = 0; i < Math.min(exchangeableOuts.length, exchangeableIns.length); i++) {
    usedIn.add(exchangeableIns[i].chest.id);
    pairs.push({ out: exchangeableOuts[i], inp: exchangeableIns[i] });
  }

  return pairs;
}

/**
 * 한 엣지(자식→부모, 한 품목)의 [Flow] 목록을 spec 의 rate·count 에서 유도.
 * rate 나 처리량을 모르면 `undefined`(지어내지 않는다).
 *
 * **논리 층 — 좌표·전략 무관.** 자식 머신당 산출 = 클러스터 산출 ÷ 대수, 부모 머신당
 * 수요 = 클러스터 수요 ÷ 대수. 인서터 처리량은 보수적으로 min(normal, long)([insertingPlanner]
 * 의 tapCap 과 동일), 벨트는 가장 빠른 티어. Phase 2(출력 emit)가 이 결과를 소비한다.
 */
export function edgeFlows(
  child: NodeSpec,
  parent: NodeSpec,
  item: string,
  config: PackConfig,
): Flow[] | undefined {
  // 팔 하나의 처리량 = [SupplyCapacity.inserters] — **여기서 다시 유도하지 않는다.**
  // 예전엔 `min(throughput.normal, throughput.long)` 을 자체 계산했는데, 같은 값을
  // moduleWizard 도 따로 계산해 담고 있었다. 유도가 두 곳에 있으면 한쪽만 고쳐도 조용히
  // 어긋난다 — 실제로 그렇게 어긋났다(2026-07-22 벨트 포화). 한 곳만 읽는다.
  //
  // **`reach 1` 이다** — 내부 링크의 팔은 좌석(`d1`)에서 바로 옆 벨트(`d2`)를 집는다.
  // 깊은 벨트를 집는 것은 탭뿐이고, 그건 [insertingPlanner] 가 슬롯을 고르며 정한다(계획서 §16).
  const tp = inserterForReach(config.inserters, 1)?.throughput ?? 0;
  const belt = config.belts?.[0]?.throughput ?? 0;
  if (tp <= 0 || belt <= 0 || child.count <= 0 || parent.count <= 0) return undefined;
  const outTotal = child.supplyCapacity?.lineRates?.get(`output:${item}`);
  const inTotal = parent.supplyCapacity?.lineRates?.get(`input:${item}`);
  if (outTotal === undefined || inTotal === undefined) return undefined;
  // **벨트·인서터 처리량은 여기서 안 넘긴다**(2026-08-22) — 흐름 배정은 순수한 rate 산술이고,
  // 벨트 상한은 [edgeLinkGroups] 의 접기가 본다. 두 곳이 같은 상한을 각자 유도하면 어긋난다.
  // 다만 **둘을 모르면 아예 시작하지 않는다** — 접을 수 없는 흐름을 내면 뒤에서 지어내게 된다.
  return allocateFlows({
    childCount: child.count,
    parentCount: parent.count,
    childProduction: outTotal / child.count,
    parentDemand: inTotal / parent.count,
    item,
  });
}

/**
 * **간선의 묶음 크기** — 이 쪽 머신 `g` 대를 벨트 한 줄이 맡는다(`g = N` 이면 관통).
 *
 * ## 왜 `side` 가 붙나 — `g` 는 모듈마다 다르다
 *
 * 간선의 양끝은 대수가 다르다(자식 32 · 부모 64). 그래서 *"한 줄이 몇 대를 맡나"* 는 끝마다
 * 다른 수이고, **간선이 공유하는 값은 토막 수 `c`** 다:
 *
 * ```
 * c = ⌈N_자식 ÷ g_자식⌉ = ⌈N_부모 ÷ g_부모⌉
 * ```
 *
 * 자리가 모자란 쪽이 자기 `g` 를 말하면 반대쪽 `g` 는 **결과로** 정해진다 — 그래서 여기서
 * 받는 것은 `(어느 끝, 그 끝의 g)` 한 쌍이다.
 *
 * ## 아직 아무도 안 준다 — 밸브만 먼저 뚫는다
 *
 * 오늘 호출부는 이 값을 **비워 둔다** → 흐름을 한 번에 붓는 옛 동작 그대로다(관통). 채울
 * 사람은 **깊이 예산**(`module/arith/depth.ts` 의 `planBundles`)인데, 그쪽은 아직
 * 나머지 줄(원료·완제품)만 본다. 그 판정을 링크까지 넓히는 자리는 `modulePacking` 의 간선
 * 루프다 — **거기서만** 자식·부모의 좌석표를 둘 다 보고 있다(`tempPlanDocs/부분-링크/`).
 *
 * > **이 타입은 정책이 아니라 손잡이다.** *언제* 쓸지는 여기서 정하지 않는다 — 정하면
 * > 형태가 다시 **입력**이 되고, 그것이 이 설계가 없앤 것이다(`link.ts` 의 *판독* 절).
 */
export interface EdgeBundle {
  /** 기준으로 삼는 끝 — `"from"` 은 자식 머신, `"to"` 는 부모 머신. */
  side: "from" | "to";
  /** 그 끝의 머신 몇 대를 한 줄이 맡나. `1` = 다이렉트, `≥ N` = 관통. */
  g: number;
}

/**
 * 한 엣지의 **흐름을 벨트 줄로 접는다**(2026-08-22 재설계 — 용어사전 §D "배선 형태 셋").
 *
 * ## 접기 하나가 형태 셋을 전부 낸다
 * 줄 수는 `determineBeltCount(간선 총량)` 이 정하고, 흐름을 **순서대로** 그 줄들에 붓는다.
 *
 * ```
 * 흐름 하나가 여러 줄에 걸침   → 그 (자식,부모) 쌍이 **링크**   (rate > 벨트 한 줄)
 * 한 줄에 흐름이 여럿 쌓임     → 그 줄이 **트렁크**
 * 한 줄에 흐름이 하나          → 그 줄이 **다이렉트**
 * ```
 *
 * **형태를 고르는 `if` 가 없다.** 셋은 같은 붓기의 결과를 읽은 이름이다 — 이것이
 * *"구조적으로 하드코딩하지 않는다"*(2026-08-22 사장님)의 실질이다.
 *
 * ## 교차가 안 생기는 이유
 * [allocateFlows] 의 흐름 수열이 **양끝 모두 단조**이고 붓기가 그 순서를 유지하므로,
 * 한 줄이 맡는 자식·부모는 각각 **연속 구간**이다. 좌표를 한 번도 안 보고 교차 불가가 나온다.
 *
 * ## 팔 수는 여기서 유도된다
 * `팔 수 = ceil(그 줄이 그 머신에서 싣는/내리는 rate ÷ 팔 하나의 실효 처리량)`([armsFor]).
 * 인서터의 실효 처리량은 이미 **가장 빠른 벨트에서 접혀** 있으므로([makeBuildSpec]) 팔 하나가
 * 벨트 한 줄을 넘길 수 없다.
 *
 * 이 함수는 간선당 [packModuleTree] 안에서 **한 번만** 불린다(사전 캐시) — 자식(출력 emit)과
 * 부모(입력 emit)는 그 결과 [Link] 객체를 그대로 참조하므로 짝이 어긋날 수 없다.
 * `id`([makeLinkId])도 여기서 한 번 매겨져 그룹 안에 실린다.
 */
export function edgeLinkGroups(
  child: NodeSpec,
  parent: NodeSpec,
  item: string,
  config: PackConfig,
  /** 이 간선의 묶음 크기([EdgeBundle]). **안 주면 한 번에 다 붓는다** = 오늘 동작(관통). */
  bundle?: EdgeBundle,
): Link[] | undefined {
  // 유체는 팔로 나르지 않는다 — [externalLineGroups] 가 외부 줄에 두는 것과 **같은 가드**다.
  // 여기 없으면 유체 링크가 인서터 장부에 올라 "벨트 1줄, 줄당 팔 3" 같은 배정을 받고
  // (물을 인서터로 옮길 수 없다), `linkedKeys` 에 실려 아이템 방출기
  // (emitOutputLinks/emitInputLinks)로 흘러가 트렁크 파이프 경로를 통째로 건너뛴다.
  // 그러면 유체 포트가 안 생기고 → 납품 경로도 안 생긴다(2026-07-26 브라우저 실측에서 발견).
  //
  // 링크를 안 만든다고 부모-자식 유체 연결이 끊기는 게 아니다 — [emitTrunkPipe] 가 같은
  // 줄로 포트를 내고, [pairDeliveryPorts] 가 이름으로 짝지어 **유체 납품 경로**이 된다. 그게 설계다
  // (docs/auto-layout-wizard.fluid-delivery-reservation.md).
  if (child.lines.find((l) => l.role === "output" && l.name === item)?.kind !== "belt") {
    return undefined;
  }
  const flows = edgeFlows(child, parent, item, config);
  if (!flows || flows.length === 0) return undefined;
  const inserter = inserterForReach(config.inserters, 1);
  if (!inserter) return undefined; // 팔을 모르면 지어내지 않는다.

  // **한 줄이 머신 한 대에게 줄 수 있는 최대** — 그 면의 좌석 수 × 팔 하나.
  // 좌석 수는 [faceSeatArms] 가 낸다 — 여기서 다시 유도하지 않는다(2026-08-23).
  // `fluidRows = 0` 은 **일부러 낙관**이다: 이 함수는 간선 하나만 보고 돌아서 그 줄이 어느
  // 면에 앉을지(= 그 면의 파이프가 몇 칸을 먹었는지) 알 수 없다. 좁힐지는 계측이 답한다
  // (`tempPlanDocs/배선-형태/judgements.md` J2 — 실패 0건이면 영구 폐기).
  const seatCap = (h: number) => faceSeatArms(h, 0) * inserter.throughput;
  const limits = {
    inserter,
    fromSeat: seatCap(child.machine.h),
    toSeat: seatCap(parent.machine.h),
  };
  const carries: LinkCarry[] = flows.map((f) => ({
    from: f.fromMachine,
    to: f.toMachine,
    rate: f.rate,
  }));

  // **붓는 일 자체는 [createLinks] 가 한다** — 이 저장소에서 [Link] 를 만드는 유일한 곳이다.
  // 여기가 하는 일은 그 앞뒤 셋뿐이다: ① 흐름을 계산하고(자식·부모를 **둘 다** 봐야 하므로
  // planner 의 몫) ② `bundle` 이 있으면 묶음으로 잘라 **묶음마다** 붓고 ③ 난 줄에 **신원**을
  // 얹는다(간선의 양끝 id 를 아는 것도 여기뿐).
  //
  // **줄 수와 티어는 묶음마다 다시 센다** — `determineBeltCount(그 묶음의 총량)`. 묶음이
  // 없으면 목록 전체가 묶음 하나라 옛 식(`간선 총량`)과 **같은 값**이다. [externalLineGroups]
  // 도 묶음마다 새로 세므로 두 경로가 같은 판단을 다르게 하지 않는다.
  const pour = (part: readonly LinkCarry[]): Link[] => {
    const tiers = determineBeltCount(
      part.reduce((sum, c) => sum + c.rate, 0),
      config.belts ?? [],
    );
    if (tiers.length === 0) return []; // 벨트를 못 고름 — 없는 숫자로 깔지 않는다.
    return createLinks(part, item, { ...limits, tiers });
  };

  const links: Link[] = [];
  for (const part of bundle ? batchCarries(carries, bundle) : [carries]) {
    const got = pour(part);
    if (got.length === 0) return undefined; // 한 묶음이라도 못 부으면 간선을 지어내지 않는다
    links.push(...got);
  }
  return links.map((link, gi) => ({ ...link, id: makeLinkId(child.id, parent.id, item, gi) }));
}

/**
 * 흐름을 **한쪽 끝의 머신 `g` 대씩** 이어지는 묶음으로 자른다.
 *
 * **반대쪽도 저절로 연속이 된다** — [allocateFlows] 의 수열이 양끝 모두 단조라, 한쪽을
 * 연속 구간으로 자르면 반대쪽 명단도 연속 구간이다. 그래서 이 자름은 교차를 만들 수 없고,
 * 좌표를 한 번도 안 본다(그 성질이 [edgeLinkGroups] 머리말의 *"교차가 안 생기는 이유"* 다).
 *
 * 반대쪽 머신은 **묶음 둘에 걸칠 수 있다**(자식 하나가 부모 둘을 먹이는 경우). 새 형태가
 * 아니다 — 한 흐름이 줄 여럿에 실리는 [[split belt]] 그대로다.
 */
function batchCarries(carries: readonly LinkCarry[], bundle: EdgeBundle): LinkCarry[][] {
  const g = Math.max(1, Math.floor(bundle.g));
  const machines = [...new Set(carries.map((c) => c[bundle.side]))].sort(
    (a, b) => (a ?? 0) - (b ?? 0),
  );
  const parts: LinkCarry[][] = [];
  for (let i = 0; i < machines.length; i += g) {
    const own = new Set(machines.slice(i, i + g));
    // `filter` 가 순서를 지키므로 묶음 안의 흐름 수열도 단조 그대로다.
    const part = carries.filter((c) => own.has(c[bundle.side]));
    if (part.length > 0) parts.push(part);
  }
  return parts;
}

