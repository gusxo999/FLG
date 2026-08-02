---
tags: [visualization, factorio-data]
---

# 벨트 셀 클릭 흐름량 검사 (beltFlow)

**한 줄 요약:** 벨트 셀 클릭 시 그 지점의 운반 품목·items/sec 를 보여준다. 라우팅 세션이 아니라
**그리드 자체**를 정적 분석해서 계산한다 — 수동 배치/수정한 벨트도 동작하고, 투입기 지점마다
흐름량이 달라지는 요구가 그래프 누적에서 자연히 떨어진다.

## 문제/배경

자동 레이아웃 결과(또는 수동 배치)의 벨트가 실제로 무엇을 얼마나 나르는지 그리드에서 확인할
수단이 없었다. 요구사항: 벨트 셀 클릭 → 품목 + 그 지점 흐름량, **투입기 지점마다 값이 달라져야
함**(투입기가 벨트에 투입/제거하므로).

## 설계 결정

### 1. 그리드 기반 정적 분석 (라우팅 세션 기반 기각)

대안: `routingEditSession.liveArea.routings` 의 `placed` 셀 → 라우팅 매핑으로 품목/흐름을 유도.

기각 이유:

- 모듈 파이프라인의 Routing 은 **논리적 홉**(대표 머신 `-m0` 끝점)이라 트렁크 위 머신별 탭이
  라우팅으로 분해돼 있지 않다 — 투입기별 증감을 어차피 벨트 경로를 걸어야 얻는다.
- 수동 배치·드래그 수정된 벨트는 세션 밖이라 커버 불가.

채택: 클릭 셀에서 **상류 역방향 BFS** → 소스(드랍 인서터)부터 전방 누적. 셀 유출량
`out(c) = clamp(Σ out(상류) + drops(c) − picks(c), 0, 벨트용량)`. worklist 완화 + 반복 상한(순환 가드).

### 2. 인서터 기여량 = min(인서터 처리량, 머신 레시피율)

- 머신(레시피 보유): 생산율 = `유효제작속도/energy_required × amount × probability × productivity`
  (모듈 효과는 `moduleEffects.applyEffectsToMachine` 재사용). 소비율은 ingredient amount 기준.
- 상자(무한상자 포함): 무한 공급/회수 → 인서터 처리량([[known-limits|inserterThroughput]]
  모델 + 위저드 override 반영)이 곧 기여량.
- 레시피 미상(용광로 자동 레시피 등): 인서터 처리량 폴백 + UI 에 ⚠ 근사 표시
  (`machineRateUnknownCount`).

### 3. 벨트 그래프 시맨틱스

- 유입 = 뒤/옆(side-load). **정면 마주보기(방향 정반대) 유입 불가** — Factorio 실동작.
- 지하벨트: input→같은 방향·같은 entityName 의 최근접 output 페어로 점프. 사이에 같은 방향·이름의
  다른 input 이 나오면 페어 끊김. 상한 8칸(프로토타입 `max_underground_distance` 미참조 — 보수적).
- 인서터 방향 규약 = **direction 이 픽업 방향**(`containerRouting.makeInserterCell` 규약과 동일).
  픽업/드랍 셀은 프로토타입 `inserter_pickup_position`/`inserter_drop_position` 을 direction 회전
  (렌더러 `pixi-draw-entity` 와 동일) — 없으면 `inserterReach` 폴백.

## 알려진 한계 (의도적 근사)

- **분배기(Splitter)**: 셀 단위 직진 통과로 근사 — 분할/우선순위 미모델링.
- **벨트→벨트 인서터**: 흐름 재배치 미모델링(기여 0 + 미상 카운트).
- 한 벨트 = 1품목 가정(앱 현 제약). 서로 다른 품목 관측 시 `items` 에 모두 담아 "(혼합)" 표시.
- 정적 정상상태 추정이며 시뮬레이션이 아니다 — 버퍼/기아/역압은 표현 안 함. 용량 초과는
  클램프 + `saturated` 플래그로만 표시.

## 구현 위치

| 파일 | 역할 |
|------|------|
| [frontend/src/utils/beltFlow.ts](../frontend/src/utils/beltFlow.ts) | `computeBeltFlowAt(grid, x, y, ctx)` — 순수 함수 분석 코어 |
| [frontend/src/utils/beltFlow.test.ts](../frontend/src/utils/beltFlow.test.ts) | 구간별 증감·머신율 캡·지하 점프·용량 클램프·side-load 합류 |
| [frontend/src/store/inspectStore.ts](../frontend/src/store/inspectStore.ts) | `cell` 좌표 추가(캔버스 클릭 시에만 set) |
| [frontend/src/pixi/pixi-manager.ts](../frontend/src/pixi/pixi-manager.ts) | 빈손/배치/라우팅수정 모드에서 벨트류 클릭 → inspect |
| [frontend/src/components/EntityDetails.tsx](../frontend/src/components/EntityDetails.tsx) | `BeltFlowSection` — 정보 모달 내 흐름 섹션 |

## 트레이드오프 메모

빈손(Empty) 모드에서 벨트 셀을 클릭하면 흐름 정보 모달이 떠서, **벨트 셀에서 시작하는** 사각형
다중선택 드래그는 막힌다(빈 칸에서 시작하면 벨트 위를 지나가는 선택은 여전히 가능). 클릭=정보
요구가 우선이라 수용.
