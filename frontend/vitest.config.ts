import { defineConfig } from 'vitest/config';

/**
 * 단위 테스트 설정 — 순수 함수(트렁크 경로 기하 등)만 대상이므로 node 환경이면
 * 충분하다 (jsdom 불필요). 테스트 파일은 *.test.ts.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
