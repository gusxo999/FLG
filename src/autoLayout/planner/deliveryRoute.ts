/**
 * deliveryRoute — 모듈 간 납품 경로 (조각 4, 순수·무상자 belt-to-belt).
 *
 * 단일 출처: 본 설계안(모듈 출력 경계 / ⑤ 핸드오프 = 벨트-투-벨트 무상자).
 *
 * [modulePacking.packModuleTree] 가 낸 `DeliverySpec`(자식 출력 포트 → 부모 입력 포트)을
 * 받아, 두 포트의 **경계 무한상자를 떼고**(+ 그 상자에 붙은 인서터가 belt→belt 피더면
 * 그것도 함께 떼고) 그 자리를 belt 로 메워 자식 출력 trunk 끝 → 부모 입력 trunk 머리를
 * **상자 없이 직접** 잇는다. 어느 인서터가 함께 떨어지는지는 [seatIsBeltFeeder] 참조.
 *
 * ## 왜 무상자
 * generateModule 은 클러스터를 "루트인 척" 생성해 모든 포트가 무한상자(외부 소스/싱크)로
 * 끝난다. 두 모듈을 *실제로* 연결하려면 그 경계 상자를 떼고 belt 를 이어야 한다 — 안 그러면
 * 끊긴 무한버퍼 두 개가 되어 물류가 가짜가 된다.
 *
 * ## 사슬 — 납품 하나가 놓이는 사다리
 *
 * ```
 * ⓐ 판      전 모듈 점유 · 탐색 경계 · 지하를 쓰나      link/ledger.buildOccupancy · link/shape.searchBoundsOf · link/policy.undergroundGateOf
 * ⓑ 계획    납품마다 체인 또는 못 쓴 사유 · 예약 칸     link/ledger.plannedChainsOf (체인의 칸은 link/shape.buildPlannedChain)
 * ⓒ 순서    유체 먼저(실패 비용 순)                     link/policy.fluidFirst
 * ⓓ 한 납품씩 고르기 → 적기                             link/policy.chooseRoute → link/ledger.recordRoute
 * ```
 *
 * 조각의 주소 — 포트의 경계 기하는 `module/shape`(방출기 규약의 역) · 체인의 칸과 좌석 이음은 `link/shape` ·
 * 셀은 `link/emit` · 경로탐색과 지하벨트 정책은 `link/policy` 머리말. 이 파일에는 **신원을 찍는 루프**만 남는다.
 *
 * 무배선·순수 — Area·store 의존 0. 단위 테스트 + 브라우저 ASCII harness 로만 검증.
 */

import { deliveryKey } from "./modulePacking";
import type { PackResult } from "./tree/types";
import type { DeliveryConfig, DeliveryResult } from "./link/types";
import { buildOccupancy, deliveryResultOf, openDeliveryLedger, plannedChainsOf, recordRoute } from "./link/ledger";
import { searchBoundsOf } from "./link/shape";
import { chooseRoute, fluidFirst, undergroundGateOf } from "./link/policy";

/**
 * 모든 납품 경로를 라우팅. 결정적 순서(packResult.deliveries 순서)로 누적 occupancy 를 공유해
 * 뒤 납품 경로가 앞 납품 경로 belt 를 피한다.
 */
export function routeDeliveryRoutes(pack: PackResult, config: DeliveryConfig): DeliveryResult {
  // ⓐ 판 — 전 모듈의 점유 · 탐색 경계 · 지하를 쓰나. 아직 아무 납품도 모른다
  const base = buildOccupancy(pack);
  const bounds = searchBoundsOf(pack.bbox);
  const gate = undergroundGateOf(config);
  // ⓑ 계획 — 납품마다 채널 장부의 지시를 칸으로 편다. 편 체인은 예약이 되고, 못 편 것은 사유를 남긴다
  const plans = plannedChainsOf(pack, gate.maxJump);
  // ⓒ 순서 — 유체 먼저(실패 비용 순)
  const ordered = fluidFirst(pack.deliveries);
  // ⓓ 한 납품씩 — 계획 → 막히면 탐색 → 탐색도 막히면 예약 무시. 깐 칸은 뒤 납품이 피한다
  const laid = openDeliveryLedger(config);
  for (const delivery of ordered) {
    // 신원을 여기서 찍는다 — 이 루프만이 "이 결과가 어느 납품 경로의 것인지" 를 안다.
    const k = deliveryKey(delivery);
    recordRoute(laid, delivery, k, chooseRoute(delivery, k, { base, bounds, ...gate }, plans, laid, config));
  }
  return deliveryResultOf(laid, plans);
}
