import { defineConfig } from 'vitest/config';

/**
 * 단위 테스트 설정 — 순수 함수(트렁크 경로 기하 등)만 대상이므로 node 환경이면
 * 충분하다 (jsdom 불필요). 테스트 파일은 *.test.ts.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /*
     * manualEdit/ — 수동 편집 격리 구역(호출자 0). tsconfig.app.json 과 같은 이유로
     * 제외한다: 재구현 시 자료구조가 크게 달라질 예정이라 코드를 유지 보수하지 않는다.
     * 기준선이 454 → 448 로 줄어든 것은 이 제외 때문이다(회귀 아님).
     */
    exclude: ['**/node_modules/**', 'src/utils/autoLayout/manualEdit/**'],
  },
});
