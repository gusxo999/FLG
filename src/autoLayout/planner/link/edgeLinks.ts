/**
 * edgeLinks — **모듈과 모듈을 잇는 일**. 자식 클러스터의 산출을 부모에게 어떻게 나눠 줄지,
 * 그 결과로 난 포트를 어떻게 짝지을지, 그 벨트를 무슨 이름으로 부를지.
 *
 * ## 왜 `link/` 인가
 * 여기 있는 함수는 전부 **두 모듈의 식별자를 안다** — `child.id`·`parent.id` 를 받아
 * 신원을 만들고([linkGroupId]), 자식·부모 양쪽의 대수와 rate 를 함께 본다. 그것이 축 2 의
 * `link` 판정이다. 반대로 `module/machineLinkGroup` 은 로컬 머신 index 만 알아 `module` 이다.
 *
 * ## 신원(`linkId`)의 단일 출처
 * [linkGroupId] 가 이 저장소에서 링크 신원을 **만드는 유일한 곳**이다. 모듈과 방출기는
 * 그것을 **복사만 하고 파싱하지 않는다** — 파싱하는 순간 모듈이 형제를 알게 된다.
 * 신원이 있으면 [pairDeliveryPorts] 가 배열 위치가 아니라 **조회**로 짝을 찾는다.
 *
 * ## `modulePacking` 과의 관계
 * 타입(`NodeSpec`·`PackConfig`·`GeneratedModule`)은 `import type` 으로만 가져온다 —
 * 런타임 간선이 아니라 순환이 아니다(`clusterModule ⇄ emitModule` 과 같은 패턴).
 * 조율자는 `modulePacking` 이고, 여기는 그 조율자가 부르는 **link 관심사의 계산**이다.
 */

import type { GeneratedModule, ModulePort } from "../../module/clusterModule";
import type { MachineLinkGroup } from "../../module/machineLinkGroup";
import { allocateMachineLinks, type MachineLink } from "./allocateMachineLinks";
import { inserterForReach } from "../../buildSpec";
import type { NodeSpec, PackConfig } from "../modulePacking";

/**
 * **신원 없는(옛 탭/다이렉트, 교환 가능) 납품 경로만을 위한** 위치 기반 키. **직접 부르지 않는다** —
 * 모든 소비처는 [deliveryKey] 를 쓴다. 밖으로 안 내보내는 이유: 이 함수만 부르면 `linkId` 를
 * 빠뜨린 채 `seq=0` 기본값으로 **엉뚱한 납품 경로**을 조회하게 된다(2026-07-21, 바로 이 실수가
 * `channelGeometryPlanner.test.ts` 에 있었다 — count=1 픽스처라 우연히 안 터졌을 뿐이었다).
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
function linkGroupId(childId: string, parentId: string, item: string, groupIndex: number): string {
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
 * 한 엣지(자식→부모, 한 품목)의 [MachineLink] 목록을 spec 의 rate·count 에서 유도.
 * rate 나 처리량을 모르면 `undefined`(지어내지 않는다).
 *
 * **논리 층 — 좌표·전략 무관.** 자식 머신당 산출 = 클러스터 산출 ÷ 대수, 부모 머신당
 * 수요 = 클러스터 수요 ÷ 대수. 인서터 처리량은 보수적으로 min(normal, long)([insertingPlanner]
 * 의 tapCap 과 동일), 벨트는 가장 빠른 티어. Phase 2(출력 emit)가 이 결과를 소비한다.
 */
export function edgeMachineLinks(
  child: NodeSpec,
  parent: NodeSpec,
  item: string,
  config: PackConfig,
): MachineLink[] | undefined {
  // 팔 하나의 처리량 = [SupplyCapacity.inserters] — **여기서 다시 유도하지 않는다.**
  // 예전엔 `min(throughput.normal, throughput.long)` 을 자체 계산했는데, 같은 값을
  // moduleWizard 도 따로 계산해 담고 있었다. 유도가 두 곳에 있으면 한쪽만 고쳐도 조용히
  // 어긋난다 — 실제로 그렇게 어긋났다(2026-07-22 벨트 포화). 한 곳만 읽는다.
  //
  // **`reach 1` 이다** — 내부 링크의 팔은 좌석(`d1`)에서 바로 옆 벨트(`d2`)를 집는다.
  // 깊은 벨트를 집는 것은 탭뿐이고, 그건 [insertingPlanner] 가 슬롯을 고르며 정한다(계획서 §16).
  const tp = inserterForReach(child.supplyCapacity?.inserters ?? [], 1)?.throughput ?? 0;
  const belt = config.belts?.[0]?.throughput ?? 0;
  if (tp <= 0 || belt <= 0 || child.count <= 0 || parent.count <= 0) return undefined;
  const outTotal = child.supplyCapacity?.lineRates?.get(`output:${item}`);
  const inTotal = parent.supplyCapacity?.lineRates?.get(`input:${item}`);
  if (outTotal === undefined || inTotal === undefined) return undefined;
  return allocateMachineLinks({
    childCount: child.count,
    parentCount: parent.count,
    childProduction: outTotal / child.count,
    parentDemand: inTotal / parent.count,
    item,
    inserterThroughput: tp,
    beltThroughput: belt,
  });
}

/**
 * 한 엣지의 링크를 **벨트**로 — **링크 하나 = 벨트 하나 = 포트 한 쌍**(v1, 2026-07-22).
 *
 * 예전엔 여기서 같은 (품목, 자식 머신)의 연속 링크를 `min(그릇, 자식 머신 좌석)` 까지 한
 * 벨트로 묶었다. 그 병합이 부모 머신의 **인접**을 요구했고(벨트 하나가 여럿을 관통해야
 * 하므로), 인접이 클러스터를 세로 한 줄로 못박아 한 면의 벨트 줄 수를 팔 길이에 묶었다 —
 * 채널 트랙 하나 값으로는 너무 비쌌다. 되살릴 때는 채널 층에서 합친다(같은 품목 벨트끼리는
 * 합류해도 오염이 없다).
 *
 * 이 함수는 간선당 [packModuleTree] 안에서 **한 번만** 불린다(사전 캐시) — 자식(출력 emit)과
 * 부모(입력 emit)는 그 결과 [MachineLinkGroup] 객체를 그대로 참조하므로 짝이 어긋날 수 없다.
 * `id`([linkGroupId])도 여기서 한 번 매겨져 그룹 안에 실린다.
 */
export function edgeLinkGroups(
  child: NodeSpec,
  parent: NodeSpec,
  item: string,
  config: PackConfig,
): MachineLinkGroup[] | undefined {
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
  const links = edgeMachineLinks(child, parent, item, config);
  if (!links || links.length === 0) return undefined;
  // 내부 링크는 양쪽 다 머신 하나씩 — 자식이 내놓고 부모가 받는다([MachineLinkGroup]).
  // 외부 줄은 한쪽이 비는데(밖), 그건 다른 호출부가 만든다.
  return links.map((l, gi) => ({
    id: linkGroupId(child.id, parent.id, item, gi),
    item: l.item,
    from: new Map([[l.fromMachine, l.inserterCount]]),
    to: new Map([[l.toMachine, l.inserterCount]]),
  }));
}
