/**
 * 레지스트리 **의미론만** 검사한다 — 명령 하나하나에 테스트를 붙이지 않는다.
 * 그건 스토어를 다시 테스트하는 일이 되고, 조작 표면의 진짜 검증은 브라우저에서
 * `flg.report()` 를 읽는 것이다.
 *
 * 여기서 지키는 것 셋:
 *  - 스코프 해제가 **다른 스코프를 안 지운다**(옛 `registerAutoLayoutDebug(null)` 의 결함)
 *  - 사전조건 거절이 **처방을 포함**한다
 *  - 저널이 **인자를 보존**한다 (순서가 곧 원인이므로)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearJournal,
  defineGroup,
  dynamicHandler,
  formatJournal,
  hasScope,
  readJournal,
  registerCommands,
} from './registry';

describe('동적 등록 — 스코프', () => {
  it('해제자는 자기 스코프만 지운다', () => {
    const disposeA = registerCommands('a', { hello: () => 1 });
    registerCommands('b', { hello: () => 2 });

    expect(hasScope('a')).toBe(true);
    expect(hasScope('b')).toBe(true);

    disposeA();

    expect(hasScope('a')).toBe(false);
    expect(hasScope('b')).toBe(true);
    expect((dynamicHandler('b', 'hello') as () => number)()).toBe(2);
  });

  it('같은 스코프를 다시 등록하면 갈아 끼운다(중복이 안 쌓인다)', () => {
    registerCommands('c', { v: () => 'old' });
    registerCommands('c', { v: () => 'new' });
    expect((dynamicHandler('c', 'v') as () => string)()).toBe('new');
  });

  it('없는 핸들러는 null 이다 — 호출자가 사전조건으로 거를 수 있게', () => {
    expect(dynamicHandler('없는스코프', 'x')).toBeNull();
  });
});

describe('사전조건', () => {
  beforeEach(() => clearJournal());

  it('거절하면 실행하지 않고, 처방을 함께 찍는다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = vi.fn();
    const g = defineGroup('t1', {
      cmd: { available: () => '패널이 닫혀 있습니다 — flg.wizard.go("review") 를 먼저.', fn },
    });

    const out = (g.cmd as () => unknown)();

    expect(fn).not.toHaveBeenCalled();
    expect(out).toBeUndefined();
    expect(warn.mock.calls[0][0]).toContain('flg.wizard.go');
    expect(readJournal().at(-1)?.result).toContain('✗');
    warn.mockRestore();
  });

  it('available 이 null 이면 그대로 실행한다', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const g = defineGroup('t2', { cmd: { available: () => null, fn: () => 42 } });
    expect((g.cmd as () => number)()).toBe(42);
  });
});

describe('저널', () => {
  beforeEach(() => clearJournal());

  it('인자와 결과를 보존한다', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const g = defineGroup('t3', { face: { fn: (mod: string, f: string) => `${mod}/${f}` } });

    (g.face as (a: string, b: string) => string)('n0-concrete', 'W');

    const e = readJournal().at(-1)!;
    expect(e.name).toBe('t3.face');
    expect(e.args).toBe("'n0-concrete', 'W'");
    expect(e.result).toBe('n0-concrete/W');
    expect(formatJournal()).toContain('t3.face');
  });

  it('예외도 남긴다 — 실패한 시도가 이력에서 사라지면 순서를 못 읽는다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const g = defineGroup('t4', {
      boom: { fn: () => { throw new Error('터짐'); } },
    });

    expect(() => (g.boom as () => void)()).toThrow('터짐');
    expect(readJournal().at(-1)?.result).toContain('터짐');
  });

  it('긴 문자열 결과는 줄 수만 남긴다 — 본문은 따로 출력된다', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const g = defineGroup('t5', { table: { fn: () => 'a\nb\nc' } });
    (g.table as () => string)();
    expect(readJournal().at(-1)?.result).toBe('3줄');
  });
});
