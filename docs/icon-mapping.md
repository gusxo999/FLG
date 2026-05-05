# 엔티티 아이콘 매핑 — 시도와 보류

**상태:** **보류 (rolled back 2026-04-26)**. 두 차례 다른 접근으로 시도했으나 모두 사용자 부담 또는 보안 위배 문제로 폐기. 현재 앱은 단색 사각형 + 동적 색상으로만 엔티티를 표현한다.

이 문서는 **다음 시도가 동일 함정에 빠지지 않도록** 시도 내역과 그 한계를 정리한다.

---

## 핵심 발견: Factorio 런타임 API는 의도적으로 아이콘 경로를 숨긴다

`Factorio doc-html/runtime-api.json` 전수 조사 결과:

| Prototype 클래스 | `icon` 또는 `icons` 속성 | 비고 |
|---|---|---|
| `LuaEntityPrototype` | **❌ 없음** | `icon_draw_specification` 만 있고 path는 미노출 |
| `LuaItemPrototype` | **❌ 없음** | |
| `LuaRecipePrototype` | **❌ 없음** | |
| `LuaTilePrototype`, `LuaFluidPrototype` 등 | **❌ 없음** | |
| `LuaCustomChartTag` | ✅ `icon` 있음 | 맵 마커. 우리 용도와 무관 |

**런타임에서 SpritePath를 반환하는 attribute는 단 한 곳도 없다.** Wube가 모드 호환성/저작권 보호 차원에서 의도적으로 숨긴 것으로 보인다 (정확한 이유는 비공식이지만, 자산 경로를 노출하면 외부 도구가 라이선스를 우회해 게임 자산을 추출할 수 있다).

---

## 시도 1: Lua 텍스트 파싱 (2026-03-27 롤백)

**접근:** Python 스크립트가 `data/<mod>/**/*.lua` 와 `mods/*.zip` 안의 모든 Lua 파일을 정규식으로 스캔, `name="..."` 와 인접 윈도우(±1500자)의 `icon="__mod__/path.png"` 매칭.

**실패 모드:** Lua는 동적 언어라서 정규식으로 모든 케이스 처리 불가:
- `data.raw["item"][name].icon` 같은 다른 prototype lookup
- `icon = "../" .. variant .. ".png"` 같은 변수 합성
- `if cond then icon = "a.png" else icon = "b.png" end`
- `icons = { layer1, layer2 }` 합성 — 단일 PNG로 표현 불가
- `data-updates.lua` 단계에서 덮어쓰기

사용자가 "어느 모드가 안 되는지" 추적할 방법 없음 → 디버깅 비용 > 효용. 코드는 메모리 [icon_extraction_lua_parsing.md](../../../.claude/projects/f--CodeStep-factorio-LayoutGenerator/memory/icon_extraction_lua_parsing.md) 에 보존.

---

## 시도 2: File System Access API + ModData 브리지 (2026-04-26 롤백)

**접근:** 두 단계로 시도:

### 2-1. 직접 export 시도 (실패)
런타임 export Lua 스크립트에서 `prototype.icon` / `prototype.icons` 를 읽으려 했으나, 위에서 확인한 대로 **이 attribute들이 존재하지 않아** 항상 nil 반환. JSON에 `icon_layers` 가 빈 채로 export됨.

### 2-2. icon-bridge 모드 + ModData 브리지 (보안 부적절)
Factorio 2.0의 `mod-data` prototype을 데이터-단계 → 런타임 브리지로 활용:
1. 별도 mod (`icon-bridge`) 의 `data-final-fixes.lua` 가 `data.raw` 를 walk하며 모든 icon path를 수집
2. `data:extend{{type="mod-data", name="lg-icon-registry", data=registry}}` 로 저장
3. 런타임 export 스크립트가 `prototypes.mod_data["lg-icon-registry"].data` 로 읽음
4. 앱이 `showDirectoryPicker` + IndexedDB 캐시로 디스크/ZIP에서 PNG 추출

**롤백 사유 (사용자 결정):**
> "보안적으로 아이콘 경로를 숨기는 이유가있을것같아서 모드까지설치하게만드는건 부적절할것같습니다."

Wube가 의도적으로 차단한 정보를 모드 설치라는 우회 경로로 빼내는 것은:
- **사용자 동의/이해 부담**: "왜 이 mod를 설치해야 하지?" 를 사용자가 판단해야 함
- **모드 호환성/안정성 위험**: 다른 mod가 `mod-data` 프로토타입을 변경/삭제하면 깨짐
- **저작권/자산 보호 정책 우회**: Wube가 명시적으로 노출하지 않은 정보를 시스템적으로 추출
- **유지보수 비용**: 우리가 별도 mod를 배포·버전 관리해야 함

추가로 부수 발견된 한계:
- **Chromium의 시스템 폴더 차단**: `%APPDATA%/Factorio/mods` 는 `showDirectoryPicker` 로 열 수 없음. ZIP 업로드 fallback이 필요했음.
- **Firefox/Safari**: `showDirectoryPicker` 자체 미지원.
- **모드 합성 아이콘**: tint/shift/scale 합성을 OffscreenCanvas로 흉내 내야 함 — Pixi 텍스처 합성과 정확히 일치하지 않음.

---

## 정리

| 측면 | 시도 1 (Lua 파싱) | 시도 2 (ModData 브리지) | 현재 (단색만) |
|---|---|---|---|
| 사용자 부담 | Python 설치 + CLI | mod 설치 + 폴더 권한 | 0 |
| 정확도 | 비결정적 | vanilla 100% / mods 90%+ | N/A |
| 유지보수 | Python 코드 + 정규식 | 모드 + 4-layer 캐시 시스템 | 0 |
| 정책 위배 | 없음 | **있음 (Wube 의도 우회)** | 없음 |
| 결정 | 롤백 | **롤백** | 유지 |

---

## 다음 시도 시 검토할 옵션 (재시도 전 사용자 확인 필수)

1. **수동 큐레이션 (권장)**: vanilla 핵심 ~50개 엔티티의 64×64 PNG를 수동 수집해 `frontend/public/game-icons/` 에 두고 `<entityName>.png` 규칙으로 매칭. 모드는 단색 fallback. 라이선스 처리 필요 (Wube 자산 재배포 가능성 검토).

2. **사용자 직접 업로드**: 사용자가 임의의 PNG들을 업로드해서 entity 이름과 수동 매핑. UI는 무겁지만 Wube 자산 미포함, 보안 위배 0.

3. **포기 + 시각적 보강**: 단색 + 약자 텍스트 + 카테고리별 패턴 (사선/도트) 등으로 식별성 개선. 아이콘 없이도 구분 가능하게.

**시도 1, 2의 접근(런타임 API에서 path 추출)은 재시도하지 말 것.** 보안 정책상 막혀 있으며, 우회는 사용자 부담 또는 정책 위배를 동반한다.

---

## 영향 범위 (롤백 시 정리한 것들)

코드:
- `frontend/src/store/iconStore.ts`, `utils/factorioFolder.ts`, `iconCache.ts`, `iconCompose.ts`, `spriteResolver.ts`, `modZipStorage.ts` — 삭제
- `Toolbar.tsx`, `Sidebar.tsx`, `pixi-manager.ts`, `App.tsx`, `gameDataStore.ts`, `parseGameData.ts` — 아이콘 관련 추가분 제거
- `scripts/icon-bridge/` 모드 — 삭제
- `scripts/export-gamedata.lua` / `.min.lua` — `icon_layers` 추출 로직 제거
- `frontend/public/game-icons/` (1794개 PNG, ~17 MB) — 시도 1의 잔존물 정리
- 의존성: `fflate`, `idb-keyval` 제거

유지된 것 (아이콘과 무관):
- `📋` 버튼 — Lua export 스크립트 클립보드 복사
- `vite.config.ts` 의 `server.fs.allow: ['..']` — `?raw` import 위해 필요
- App.tsx의 stale selectedEntity 가드 — `entityMap` 미스 시 자동 Empty 리셋
