# Factorio Layout Generator

[English](README.md) | **한국어**

브라우저 기반 팩토리오 공장 레이아웃 설계 도구. 그리드에 엔티티를 배치하고 블루프린트 문자열로 내보내 게임에서 바로 사용할 수 있습니다.

백엔드 서버 없이 **완전 클라이언트 사이드**로 동작합니다. 게임 데이터와 레이아웃은 모두 localStorage에 저장됩니다.

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| 렌더링 | PixiJS 8 (standalone 모듈, React 외부) |
| UI | React 19 + TypeScript |
| 상태 관리 | Zustand (persist middleware → localStorage) |
| 스타일링 | Tailwind CSS v4 |
| 블루프린트 코덱 | pako (zlib) + base64 |
| 빌드 | Vite 8 |
| 국제화 | 자체 경량 i18n (한국어/영어) |

### 아키텍처 (Option B)

```
React (UI 패널)              PixiJS (캔버스 렌더링)
┌──────────────┐             ┌──────────────────────┐
│ Toolbar.tsx  │             │ pixi-manager.ts      │
│ Sidebar.tsx  │             │  - 그리드 렌더링      │
│ Tutorial.tsx │             │  - 엔티티 배치/삭제   │
│ GridCanvas   │──mount──▶   │  - 호버 미리보기      │
│  (div only)  │             │  - 팬/줌 처리         │
└──────┬───────┘             └──────────┬───────────┘
       │                                │
       └──── zustand store ◄────────────┘
              (layoutStore, gameDataStore, settingsStore, i18nStore)
```

- **React**는 HTML UI 패널만 담당 (Sidebar, Toolbar, Tutorial)
- **PixiJS**는 `pixi-manager.ts`에서 standalone으로 동작, `zustand.subscribe()`로 상태 변경을 직접 구독
- 마우스 이벤트 → PixiJS 핸들러 → `zustand.getState()` / `setState()` (React 미관여)

---

## 요구 사항

- [Node.js](https://nodejs.org/) 18+

---

## 빠른 시작

```bash
cd frontend
npm install
npm run dev
```

| 주소 | 설명 |
|------|------|
| http://localhost:5173 | 개발 서버 |

### 빌드

```bash
cd frontend
npm run build     # dist/ 에 정적 파일 생성
npm run preview   # 빌드 결과 미리보기
```

빌드 결과물은 정적 파일이므로 Vercel, GitHub Pages, Netlify 등에 바로 배포 가능합니다.

---

## 언어 전환

UI는 한국어와 영어를 모두 지원합니다. 툴바 오른쪽의 **EN / 한국어** 버튼으로 즉시 전환할 수 있으며, 선택한 언어는 localStorage에 저장되어 다음 방문 시에도 유지됩니다. 처음 방문 시 브라우저 언어 설정을 감지해 자동 선택됩니다.

번역은 `frontend/src/i18n/` 폴더에서 관리합니다:
- [ko.ts](frontend/src/i18n/ko.ts) — 한국어
- [en.ts](frontend/src/i18n/en.ts) — 영어
- [index.ts](frontend/src/i18n/index.ts) — `t()` 함수 및 `useT()` 훅

---

## 게임 데이터 추출

팩토리오의 엔티티/레시피 데이터를 앱에 로드하려면:

1. 팩토리오 실행 → 아무 세이브 로드 → `~` 콘솔 열기
2. [`scripts/export-gamedata.min.lua`](scripts/export-gamedata.min.lua) 파일 내용을 콘솔에 붙여넣기
3. `%APPDATA%\Factorio\script-output\factorio-data.json` 생성됨
4. 웹앱 Toolbar의 **게임 데이터 로드** 버튼으로 해당 파일 업로드

> 스크립트 원본: [`scripts/export-gamedata.lua`](scripts/export-gamedata.lua) (주석 포함, 편집용)

### 추출되는 데이터

| 카테고리 | 엔티티 타입 | 주요 필드 |
|----------|------------|-----------|
| 생산 | assembling-machine, furnace, rocket-silo | crafting_speed, crafting_categories, module_slots, allowed_effects |
| 연구/채굴 | lab, mining-drill | researching_speed, lab_inputs, mining_speed, resource_categories |
| 물류 | transport-belt, underground-belt, splitter, inserter, pipe, pump | belt_speed, max_underground_distance, inserter_positions |
| 전력 | electric-pole, solar-panel, accumulator, boiler, generator, reactor | supply_area_distance, max_wire_distance, max_power_output |
| 유틸리티 | beacon, roboport, container, logistic-container, radar, lamp | distribution_effectivity, logistic_radius, inventory_size |
| 회로 | arithmetic/decider/constant-combinator, programmable-speaker | 공통 필드만 |
| 방어 | wall, gate, ammo/electric/fluid-turret | 공통 필드만 |
| 철도 | straight-rail, curved-rail, train-stop | 공통 필드만 |

새 필드가 필요하면 `scripts/export-gamedata.lua`의 해당 섹션에 추가하고, 한줄 버전을 재생성하면 됩니다.

---

## 블루프린트 Import / Export

팩토리오 블루프린트 문자열 형식:

```
"0" + base64( zlib_deflate( JSON ) )
```

- Toolbar의 **Export** → 현재 레이아웃을 블루프린트 `.txt` 파일로 다운로드
- Toolbar의 **Import** → 블루프린트 문자열을 붙여넣어 그리드에 복원

---

## 조작법

| 입력 | 동작 |
|------|------|
| 좌클릭 | 엔티티 배치 |
| Shift + 좌클릭 | 엔티티 삭제 |
| 중앙 클릭 드래그 | 팬 (화면 이동) |
| 스크롤 | 상하 팬 |
| Alt + 스크롤 | 좌우 팬 |
| Ctrl + 스크롤 | 줌 |
| R | 방향 회전 |
| Ctrl + Z | 되돌리기 |
| Ctrl + Y | 다시 실행 |

---

## 개발 문서

구현 결정 및 데이터 모델 분석은 [`docs/`](docs/README.md) 디렉토리에 정리되어 있습니다:

- [fluid-box-semantics.md](docs/fluid-box-semantics.md) — 파이프 I/O 시각화에서 왜 `flow_direction`(연결 단위)을 `production_type`(fluidbox 단위)보다 우선하는가
- [map-position-parsing.md](docs/map-position-parsing.md) — Factorio `MapPosition`의 모호한 형태(keyed vs positional)를 위한 3중 방어 정규화 전략

---

## 프로젝트 구조

```
factorio-LayoutGenerator/
├── docs/                            # 개발 문서 (설계 결정, 데이터 분석)
│   ├── README.md                    # 문서 인덱스
│   ├── fluid-box-semantics.md       # flow_direction vs production_type 분석
│   └── map-position-parsing.md      # MapPosition 형태 정규화 3중 방어 전략
├── scripts/
│   ├── export-gamedata.lua          # 게임 데이터 추출 Lua (주석 포함)
│   └── export-gamedata.min.lua      # 콘솔 붙여넣기용 한줄 버전
├── frontend/
│   ├── src/
│   │   ├── i18n/
│   │   │   ├── index.ts              # 언어 스토어, t() / useT()
│   │   │   ├── ko.ts                 # 한국어 번역
│   │   │   └── en.ts                 # 영어 번역
│   │   ├── pixi/
│   │   │   └── pixi-manager.ts       # PixiJS 캔버스 초기화, 렌더링, 이벤트 처리
│   │   ├── components/
│   │   │   ├── GridCanvas.tsx        # PixiJS 마운트 래퍼 (div + initPixi/destroyPixi)
│   │   │   ├── Toolbar.tsx           # 게임데이터 로드, Import/Export, 언어 선택기
│   │   │   ├── Sidebar.tsx           # 엔티티 팔레트 + 레시피/머신 탐색
│   │   │   └── Tutorial.tsx          # 첫 방문 튜토리얼 모달
│   │   ├── store/
│   │   │   ├── layoutStore.ts        # 그리드 상태, 뷰포트, 배치/삭제, 히스토리
│   │   │   ├── gameDataStore.ts      # 레시피/머신 데이터 (localStorage 캐시)
│   │   │   ├── settingsStore.ts      # UI 설정 (테마, 그리드 오버레이 등)
│   │   │   └── nanoid.ts             # ID 생성 유틸
│   │   ├── types/
│   │   │   ├── layout.ts             # 내부 그리드/엔티티 타입 정의
│   │   │   └── blueprint.ts          # 팩토리오 블루프린트 JSON 스키마
│   │   ├── utils/
│   │   │   ├── blueprintCodec.ts     # 블루프린트 문자열 인코딩/디코딩
│   │   │   └── parseGameData.ts      # 게임 데이터 JSON → store 형식 변환
│   │   ├── App.tsx                   # 루트 컴포넌트 + 키보드 단축키
│   │   └── main.tsx                  # React 진입점
│   ├── package.json
│   └── vite.config.ts
├── README.md                         # 영어 README
└── README.ko.md                      # 한국어 README (이 파일)
```

---

## 데이터 저장

모든 데이터는 브라우저 localStorage에 저장됩니다:

| 키 | 내용 | 비고 |
|----|------|------|
| `factorio-layout-store` | 그리드, 뷰포트, 선택 상태 | sparse 압축 (비어있는 셀 제외) |
| `factorio-game-data` | 레시피, 머신 배열 | 파일 업로드 시 갱신 |
| `factorio-layout-settings` | UI 설정 | 테마, 그리드 오버레이 등 |
| `factorio-layout-i18n` | 선택한 언어 | ko 또는 en |
| `factorio-tutorial-done` | 튜토리얼 표시 여부 | 첫 방문 시에만 표시 |

그리드는 256x256 기본 크기이며, sparse 직렬화로 엔티티가 배치된 셀만 저장하여 localStorage 5MB 제한 내에서 동작합니다.
