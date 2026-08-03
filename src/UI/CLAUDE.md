# UI/ — 화면에 붙은 것

| 폴더 | 무엇 |
|---|---|
| `components/` | React 컴포넌트 — 툴바 · 사이드바 · 모달 · 패널 |
| `store/` | zustand 스토어 (게임데이터 · 레이아웃 · 검사 · 위저드 · 설정 · 토스트) |
| `pixi/` | PixiJS 렌더러 — 그리드 · 엔티티 · 벨트 · 파이프 그리기 |
| `i18n/` | ko/en 문자열 + `useT` |

React 와 PixiJS 를 나눈 이유(캔버스는 React 밖에서 명령형으로 그린다)는 프로젝트 초기 결정이다.

## `store/gameDataStore` 는 UI 전용이 아니다

이 폴더에서 **바깥이 의존하는 유일한 것**이다 — `autoLayout/` · `analysis/` · `factorio/` 가
전부 `../UI/store/gameDataStore` 에서 `Entity` · `Recipe` 타입과 prototype 데이터를 가져간다.
게임데이터가 zustand 스토어에 실려 있어서 그렇지, **역할은 UI 가 아니라 데이터 원본**이다.

나머지 셋(`components/` · `pixi/` · `i18n/`)과 `store/` 의 다른 스토어는 UI 안쪽에서만 쓰인다.
바깥 폴더가 `UI/components` 나 `UI/pixi` 를 import 하기 시작하면 경계가 새는 것이다.

## 읽을 문서

`docs/UI/` 가 이 폴더의 거울이다 —
[belt-flow-inspection](../../docs/UI/belt-flow-inspection.md)(벨트 셀 클릭 → 흐름량 검사).
