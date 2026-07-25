# 자동배치 리팩토링 기준선 (2026-07-25)

**날짜:** 2026-07-25  
**커밋:** c9e14bd (feature/shared-supply-box-merge)  
**계획:** 옛 경로를 스텁 뒤로 · 신 파이프라인 표면 정리

## 1. 타입 검사

```
$ npx tsc --noEmit
```

**결과:** ✅ 통과, 에러 0개

## 2. 테스트

```
$ npm test
```

**결과:**
- ✅ Test Files: 48 passed (48)
- ✅ Tests: 510 passed (510)
- 실행 시간: 13.20s

테스트 파일 목록:
- clusterPortPlanner.test.ts (21 tests)
- insertingPlanner.test.ts (24 tests)
- trunkPath.test.ts (23 tests)
- trunkPipe.test.ts (18 tests)
- clusterModule.test.ts (다수의 레시피 테스트)
- pipelineMetrics.test.ts (1 test)
- modulePacking.realTree.test.ts (3 tests)
- modulePacking.edgeLinks.test.ts (5 tests)
- channelPlanner.test.ts (6 tests)
- makeLink.test.ts (5 tests)
- 기타 테스트 파일 다수

## 3. 통합 테스트 대표 레시피

다음 4개 레시피로 단계별 회귀 테스트 진행:

### 3.1 kr-glass (아이템만)

아이템 전용 레시피. 신 경로(Module pipeline)로 처리.

**확인 항목:**
- 홉 수 (예: 2개)
- planned chains 존재
- dijkstraFallback 미사용
- perimeterPass 완료
- penalty (기준선 유지)

### 3.2 plastic-bar (유체 입력 + 아이템)

유체 입력과 아이템이 혼합된 레시피.

**확인 항목:**
- 유체 트렁크 배정 성공
- 아이템 링크 할당 성공
- 혼합 라우팅 완료

### 3.3 wood←water (유체 홉)

유체 홉 레시피 (유체 공급 → 유체 소비).

**확인 항목:**
- routeOneFluidHop 호출됨
- 유체 경로 실패 0개
- perimeter 배치 완료

### 3.4 concrete (다-유체)

다-유체 레시피 → 옛 경로(fallback) 진입.

**확인 항목:**
- Phase 3-2 이전: 옛 경로 실행
- Phase 3-2 이후: fallback 스텁 반환 (실패 라벨)

## 4. 회귀 안전망 체크리스트 (P0-3)

Phase 진행 중 다음을 계속 모니터링:

- [ ] tsc --noEmit: 0 에러 유지
- [ ] vitest: 48 파일 510 테스트 모두 통과
- [ ] kr-glass: 기준선 지표 유지
- [ ] plastic-bar: 혼합 처리 성공
- [ ] wood: 유체 경로 실패 0
- [ ] concrete: Phase 3-2 전후 동작 전환
