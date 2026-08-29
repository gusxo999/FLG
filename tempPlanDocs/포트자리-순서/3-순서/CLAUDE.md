> 상태: **승인 대기** (전제: `1-되먹임` Step 1 의 판정)

# 3-순서 — 고유 컨텍스트

**용어:** *그룹* = **벨트 한 줄**(`Link` 객체 하나). 개수는 처리량이 정하고
(`determineBeltCount`), 만드는 것은 **붓기**다(`createLinks` — 흐름을 줄에 붓다 차면 새 줄).
**그래서 그룹의 순서는 붓기의 부산물이지, 정한 값이 아니다.**

## 반드시 읽을 것

- `module/link.ts:181-270` `createLinks` — 붓기(그룹이 생기는 유일한 자리)
- `linkPlanner.ts:596-608` `allocateLinkFaces` — `groups.forEach` (배정 순서)
- `linkPlanner.ts:508-521` 레인 후보 정렬 · `faceTable.ts:106` `freeSeatRows`
- `modulePacking.ts:409-418` `inputLinksOf` — 부모의 입력 그룹 순서 = **자식 순서**

## 하지 않는 것

- **붓기 자체(`createLinks`)** — 줄을 몇 개로 나눌지는 안 건드린다. **앉히는 순서**만 바꾼다.
- **레인 후보 정렬** — 한 그룹 안의 후보 정렬은 이미 R2 를 지킨다. 손대지 않는다.
