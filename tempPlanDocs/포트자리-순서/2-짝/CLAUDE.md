> 상태: **승인 대기** (2026-08-29 재작성)

# 2-짝 — 고유 컨텍스트

**여는 고리:** A = `gen → extent → tidy-tree → lineEnds → gen`.
Step 1~3 은 **링크 절반**만 열고, **Step 4(트렁크 절반)까지 해야 고리가 실제로 닫힌다.**

**용어:** *짝* = 이 벨트 줄의 반대쪽 끝. 자식의 **출력 포트**와 부모의 **입력 포트**가 한
쌍이고, 둘을 잇는 것이 **납품 경로**다.

**목표가 바뀌었다**(2026-08-29): *"가장 가까운 끝"* 은 모서리(= 높이)를 요구하고, 높이는
`gen` 이 준다 — 그 목표를 지키는 한 고리를 못 연다. 대신 **"교차하지 않는 끝"** 을 노린다.
중심 **순서**만 필요하고, 그건 트리가 안다.

## 반드시 읽을 것

- `src/autoLayout/module/link.ts` `Link` 자료구조 — 특히 `id` 주석
  (*"위층이 채우고 여기는 파싱 안 한다"*)
- `src/autoLayout/planner/modulePacking.ts` `layoutY`(:489-501) —
  **무엇이 확정이고 무엇이 아닌가의 근거**
- 같은 파일 `lineEnds`(:564-589) — 지금의 최소거리 계산
- `src/autoLayout/planner/module/linkPlanner.ts` `portEnd` 선착순(:484-486)
- `src/autoLayout/planner/link/edgeLinks.ts` `makeLinkId`(:56) · `pairDeliveryPorts`(:79)
  — 열쇠가 `linkId` 인 자리

## 하지 않는 것

- **행(어느 좌석 칸)** — 자유도가 머신 안 몇 칸이라 작다. 끝(N/S)만 본다.
- **가운데 자식의 끝** — 트리로 판정 불가. `undefined` 로 두고 오늘 동작(선착순)을 상속한다.
- **거리 최적화** — 교차만 본다. 거리는 좌표가 있어야 하고, 그건 고리를 부른다.
