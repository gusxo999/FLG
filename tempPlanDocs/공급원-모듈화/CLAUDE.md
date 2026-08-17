# 공급원-모듈화 — 상태와 고유 컨텍스트

> 상태: **승인 대기**

**외부상자를 더미 모듈로 승격한다** — 머신 역할을 하는 모듈이 되어 자식 머신 그룹처럼
행동한다. 그러면 공급원이 하나의 종류가 되고, 특수 경로(반출 패스)가 사라진다.
**최종 목표는 한 자식이 여러 부모 머신 그룹을 먹이는 구조**다(트리 → DAG).
계획서는 [공급원-모듈화.md](공급원-모듈화.md).

## 착수 전 반드시 읽을 것

| 무엇 | 왜 |
|---|---|
| [planner/modulePacking.ts](../../src/autoLayout/planner/modulePacking.ts) `parentId` 사용처 7곳 | **`parentId` 가 스칼라다.** 트리를 전제한 자리가 어디인지 세지 않으면 DAG 로 못 넘어간다 (`childIdsByParent`·`dfsVisit`·`layoutY`·`edgeLinkGroups`) |
| 같은 파일 `rawPorts` (`:536-553`) | 짝 못 지은 포트가 여기로 빠져 **완전히 다른 경로**(반출 패스)를 탄다. 이 계획이 없애려는 갈래다 |
| [execution/modulePerimeterPass.ts](../../src/autoLayout/execution/modulePerimeterPass.ts) 머리말 | 없앨 경로의 책임 범위. *"예약된 경로는 항상 방출 가능해야 한다"* 는 철학이 거기 적혀 있다 |
| [planner/link/edgeLinks.ts](../../src/autoLayout/planner/link/edgeLinks.ts) `pairDeliveryPorts` | 짝짓기가 **신원(linkId) 유무**로 갈린다. 더미 모듈의 포트가 어느 쪽인지 정해야 한다 |
| [planner/perimeter/lanes.ts](../../src/autoLayout/planner/perimeter/lanes.ts) | 반출 lane 예약. 더미 모듈이 서면 이 수요가 어떻게 변하는지 |
| [autoLayout/module/CLAUDE.md](../../src/autoLayout/module/CLAUDE.md) | *"이 폴더의 코드는 형제 모듈을 모른다"* — 더미 모듈도 이 규약을 지켜야 한다 |

## 하지 않는 것

- **모듈 안쪽 배정을 안 건드린다.** 레인·좌석·포트 방향은 트렁크벨트-경로모델 소관이다.
- **트렁크벨트-경로모델의 ③(사다리)·⑤(모드 폐기)를 안 건드린다.** 다른 축이다.
- **채널 폭·트랙 배정을 이 계획에서 고치지 않는다** — 더미 모듈이 수요를 바꾸므로
  먼저 재고 나서 판단한다([judgements.md](judgements.md) J-폭).
- **격자(2D 클러스터)로 안 간다.** 1:N 은 *연결 관계*의 확장이지 *배치 형태*의 확장이 아니다.

## 실제로 밟은 함정

(착수 후 채운다. 계획서를 지울 때 여기 남은 것만 `docs/` 로 옮긴다.)
