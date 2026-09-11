# 커스텀 레시피 — 공통 컨텍스트

> 상태: **승인 대기**

**게임에 없는 레시피와 그것을 돌릴 머신을 앱 안에서 만들어 게임데이터에 합류시킨다.**
설계는 [커스텀-레시피.md](커스텀-레시피.md).

**핵심은 화면이 아니라 합성기다.** 사용자가 말하는 어휘(*"입력 유체는 W 면 1행"*)를
게임데이터 어휘(`positions` 네 개 · `direction` · `production_type`)로 옮기는 자리가
이 작업의 전부다. 그 변환이 틀리면 **화면은 멀쩡하고 머신만 굶는다** —
[fluid-box-semantics](../../docs/factorio/fluid-box-semantics.md) 가 *"이 버그가 고약한 이유:
**조용하다**"* 로 적어 둔 그 함정이다.

## 착수 전 반드시 읽을 것

| 무엇 | 왜 |
|---|---|
| [docs/factorio/fluid-box-semantics.md](../../docs/factorio/fluid-box-semantics.md) | 유체 상자의 **네 필드**(`production_type` · `flow_direction` · `direction` · `fluidbox_index`)가 각각 무엇을 말하나. 합성기가 채울 칸의 정의가 전부 여기 있다 |
| [src/autoLayout/module/fluidPorts.ts](../../src/autoLayout/module/fluidPorts.ts) — 머리말과 `chooseFluidTrunkPlan` | **면 규약(입력 E · 출력 W)** 과 회전 탐색. 검증기가 이 함수를 *그대로 부른다* |
| [src/autoLayout/module/fluidPorts.test.ts](../../src/autoLayout/module/fluidPorts.test.ts) 의 두 fixture | 화학공장 3×3 · SE 랩 9×9 — **실게임 덤프**다. 좌표 합성식의 정답지 |
| [src/factorio/parseGameData.ts](../../src/factorio/parseGameData.ts) | 파일 → `GameData`. 커스텀 합성기는 이것의 **형제**다(원천만 다르고 도착지가 같다) |
| [src/UI/store/gameDataStore.ts](../../src/UI/store/gameDataStore.ts) — `buildDerived` · `partialize` | 파생 인덱스가 무엇을 요구하나(`enabled`) · 무엇이 localStorage 에 남나 |
| [docs/debug/ai-console.md](../../docs/debug/ai-console.md) §2 · §4 | 콘솔 명령의 **세 방식 판정**. 그리고 이 계획은 §4 정직한 괴리표의 한 줄을 **바꾼다** |

## 하지 않는 것

```
아이콘            앱은 `icon` 을 아무 데서도 안 그린다(pixi·사이드바 참조 0곳). 커스텀도 안 그린다
기술(연구) 연동    커스텀 레시피는 `enabled: true` 로 항상 활성. technologies 배열을 안 건드린다
모듈·표면조건      v1 파이프라인이 안 보는 필드는 **입력으로도 안 받는다**
비정사각 머신      사용자 전제 — 정사각만. 유체 회전 배열도 정사각에서만 자명하다
인프라 엔티티      커스텀 벨트·인서터·파이프는 없다. 레시피와 그 머신뿐
게임데이터 파일 수정  고쳐진 factorio-data.json 을 **파일로 내보내지 않는다** (콘솔 문자열은 낸다)
블루프린트 호환    커스텀 이름은 블루프린트에 그대로 실리고 게임이 거부한다 — 막지 않고 경고만 (§10)
```

## 전제 — 계획 **전체**가 참으로 놓는 것

깨지면 계획이 통째로 흔들리는 여섯. 단계별 전제는 계획서 §9 에 따로 있다.

| # | 전제 | 근거 **문장** | 깨지면 |
|---|---|---|---|
| ① | 유체 상자의 **면**은 `direction` 에만 있다 | fluidPorts.ts 머리말 — *"진짜 답은 `PipeConnection.direction` 이다 … 머신을 `d` 만큼 돌리면 면은 `(conn.direction + d) % 16` 이다. 추정 없음."* | 합성기가 `direction` 을 빼면 `resolveFluidConnection` 이 `null` → 그 머신은 유체를 **못 쓴다** |
| ② | `positions` 는 **네 방향으로 미리 돌려 둔** 배열이다 | 같은 곳 — *"회전 = 배열 인덱스 하나다: `positions[direction / 4]`. 삼각함수도, 부호 뒤집기도 없다."* | 한 개만 넣으면 회전 시 `?? positions[0]` 폴백으로 **엉뚱한 행**에 앉는다 |
| ③ | 파이프라인은 **입력 E · 출력 W** 인 회전을 찾는다 | `wantFaceOf` 주석 — *"역할이 정하는 면 — 출력은 부모 쪽(W), 입력은 자식 쪽(E). 납품 경로·채널 장부가 이 규약에 기댄다."* | 입출력 면이 **안 마주보면** 네 회전 어디에도 안 앉는다 → 모듈 거절 |
| ④ | 레시피가 후보에 오르려면 `enabled === true` (또는 기술 언록) | gameDataStore — *"둘 다 아니면 … 플레이어가 영영 만들 수 없으므로 자동완성 후보에서 제외한다."* | 만든 레시피가 콤보박스에 **안 뜬다** |
| ⑤ | localStorage 에 남는 것은 `partialize` 가 고른 네 배열뿐 | gameDataStore `partialize` — `recipes` · `entities` · `modules` · `technologies` · `loaded` | 커스텀을 다른 그릇에 두면 **세션을 못 넘는다**(사용자 요구의 절반) |
| ⑥ | `fluidbox_index` 는 **미지정이 정상**이다 | fluid-box-semantics — *"`0` 은 데이터에 절대 안 나온다 … 코드는 `fluidbox_index === 0` 이 아니라 **"없으면 전부"** 로 읽어야 한다."* | 편집기가 `0` 을 채우면 배정이 조용히 어긋난다 |

## 기준선 (2026-09-07 실측)

```
npx tsc -p tsconfig.app.json --noEmit    →  에러 0
npx vitest run                           →  56파일 684테스트 · 기존 실패 2 (trunkPipe 유체 면)
```
