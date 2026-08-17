/**
 * registry — 콘솔 명령의 **등록·실행·기록**을 한 자리에서.
 *
 * 명령마다 `console.log` 를 손으로 찍던 것을 규약으로 올린다. 얻는 것 셋:
 *
 *  1. **한 줄 규약** — `[flg] <이름>(<인자>) → <결과>`. 콘솔에서 `[flg]` 한 단어로 조작
 *     이력만 뽑을 수 있다([[변수명사전]] §B 가 `모듈 경로 포기` 로 하는 것과 같은 이유).
 *  2. **사전조건은 처방과 함께 거절한다** — 못 쓰는 명령은 *왜* 가 아니라 **다음에 칠
 *     명령**을 알려 준다. 예전 `flg.apply()` 가 "패널이 열려 있어야 합니다" 로 하던 것을
 *     모든 명령의 규칙으로 올린 것.
 *  3. **저널** — 최근 실행을 링버퍼에 남긴다. 사용자가 명령을 여러 개 치고 마지막 화면만
 *     복사하면 *어떤 순서로 무엇을 쳤는지*가 사라진다. 실패 재현에서 순서가 곧 원인이다.
 *
 * ## 등록은 두 곳에서 온다
 *
 *  - **정적** — 스토어만 만지는 명령. 모듈 로드 시 등록된다.
 *  - **동적** — 컴포넌트 안에 로직이 있는 명령([registerCommands]). 마운트 동안만 산다.
 *    스코프 단위로 붙였다 뗀다 — 옛 `registerAutoLayoutDebug(null)` 은 등록을 **통째로**
 *    지워서, 두 컴포넌트가 얽히면 살아 있는 등록이 날아갔다.
 */

/** 명령 하나의 정의. */
export interface CommandSpec {
  /** 화면 라벨 — `help()` 가 명령 옆에 붙인다. 화면에 없는 조회 명령은 생략. */
  label?: string;
  /** 인자 설명 한 줄. 예: `(item, recipe)` */
  usage?: string;
  /** 한 줄 설명. */
  desc?: string;
  /**
   * 지금 쓸 수 있나. `null` 이면 가능, 문자열이면 거절 사유다.
   * **문자열에는 반드시 다음에 칠 명령을 넣는다** — 사유만 있으면 사용자는 다시 묻는다.
   */
  available?: () => string | null;
  fn: (...args: never[]) => unknown;
}

export interface JournalEntry {
  at: number;
  name: string;
  args: string;
  /** 결과 요약(한 줄). 거절·예외면 `✗ …`. */
  result: string;
  ms?: number;
}

const specs = new Map<string, CommandSpec>();
const JOURNAL_MAX = 50;
const journal: JournalEntry[] = [];

/** 인자를 로그에 담을 만한 짧은 문자열로. 긴 것은 모양만 남긴다. */
function fmtArg(a: unknown): string {
  if (typeof a === 'string') return `'${a.length > 40 ? `${a.slice(0, 37)}…` : a}'`;
  if (a === null || a === undefined || typeof a !== 'object') return String(a);
  if (Array.isArray(a)) return a.length <= 4 ? `[${a.map(fmtArg).join(',')}]` : `[${a.length}개]`;
  const keys = Object.keys(a as object);
  return `{${keys.slice(0, 4).join(',')}${keys.length > 4 ? ',…' : ''}}`;
}

/** 결과를 한 줄로. 문자열 결과(단면표 등)는 **길이만** 적는다 — 본문은 따로 출력된다. */
function fmtResult(r: unknown): string {
  if (r === undefined) return 'ok';
  if (typeof r === 'string') return r.includes('\n') ? `${r.split('\n').length}줄` : r;
  if (typeof r === 'number' || typeof r === 'boolean' || r === null) return String(r);
  if (Array.isArray(r)) return `${r.length}개`;
  return fmtArg(r);
}

function record(e: JournalEntry): void {
  journal.push(e);
  if (journal.length > JOURNAL_MAX) journal.shift();
}

/**
 * 명령을 감싼다 — 사전조건 검사 · 로그 한 줄 · 저널.
 * Promise 를 돌려주는 명령은 **끝났을 때** 찍는다(경과 시간 포함).
 */
function wrap(name: string, spec: CommandSpec): (...args: never[]) => unknown {
  return (...args: never[]) => {
    const argStr = args.map(fmtArg).join(', ');
    const blocked = spec.available?.() ?? null;
    if (blocked !== null) {
      console.warn(`[flg] ${name}(${argStr}) ✗ ${blocked}`);
      record({ at: Date.now(), name, args: argStr, result: `✗ ${blocked}` });
      return undefined;
    }
    const t0 = performance.now();
    let out: unknown;
    try {
      out = spec.fn(...args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[flg] ${name}(${argStr}) ✗ 예외 — ${msg}`);
      record({ at: Date.now(), name, args: argStr, result: `✗ 예외 ${msg}` });
      throw e;
    }
    if (out instanceof Promise) {
      return out.then(
        (v) => {
          const ms = Math.round(performance.now() - t0);
          console.log(`[flg] ${name}(${argStr}) … ${(ms / 1000).toFixed(1)}s → ${fmtResult(v)}`);
          record({ at: Date.now(), name, args: argStr, result: fmtResult(v), ms });
          return v;
        },
        (e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[flg] ${name}(${argStr}) ✗ ${msg}`);
          record({ at: Date.now(), name, args: argStr, result: `✗ ${msg}` });
          throw e;
        },
      );
    }
    const ms = Math.round(performance.now() - t0);
    console.log(`[flg] ${name}(${argStr}) → ${fmtResult(out)}`);
    record({ at: Date.now(), name, args: argStr, result: fmtResult(out), ms });
    return out;
  };
}

/**
 * 그룹 하나를 등록하고 **호출 가능한 객체**를 돌려준다.
 * `flg.wizard = defineGroup('wizard', {...})` 형태로 쓴다.
 */
export function defineGroup<T extends Record<string, CommandSpec>>(
  group: string,
  members: T,
): { [K in keyof T]: T[K]['fn'] } {
  const out = {} as Record<string, unknown>;
  for (const [key, spec] of Object.entries(members)) {
    const name = group ? `${group}.${key}` : key;
    specs.set(name, spec);
    out[key] = wrap(name, spec);
  }
  return out as { [K in keyof T]: T[K]['fn'] };
}

// ─────────────────────────────────────────────────────────────────────────────
// 동적 등록 — 컴포넌트가 마운트 동안 자기 핸들러를 건다
// ─────────────────────────────────────────────────────────────────────────────

/** scope → (이름 → 핸들러). 컴포넌트가 언마운트되면 **그 스코프만** 사라진다. */
const dynamic = new Map<string, Map<string, (...a: never[]) => unknown>>();

/**
 * 컴포넌트가 자기 핸들러를 등록한다. 해제자를 돌려준다.
 *
 * **버튼과 명령이 같은 함수 객체를 가리키게** 하는 것이 요점이다 — 버튼만 고치고 명령이
 * 옛 동작으로 남는 일이 원천적으로 안 생긴다.
 */
export function registerCommands(
  scope: string,
  map: Record<string, (...a: never[]) => unknown>,
): () => void {
  dynamic.set(scope, new Map(Object.entries(map)));
  return () => {
    dynamic.delete(scope);
  };
}

/** 등록된 동적 핸들러를 찾는다. 없으면 null. */
export function dynamicHandler(scope: string, name: string): ((...a: never[]) => unknown) | null {
  return dynamic.get(scope)?.get(name) ?? null;
}

/** 스코프가 지금 붙어 있나 — 사전조건 검사에 쓴다. */
export function hasScope(scope: string): boolean {
  return dynamic.has(scope);
}

// ─────────────────────────────────────────────────────────────────────────────
// 조회
// ─────────────────────────────────────────────────────────────────────────────

export function listCommands(): Array<{ name: string; spec: CommandSpec }> {
  return [...specs.entries()].map(([name, spec]) => ({ name, spec }));
}

export function readJournal(): readonly JournalEntry[] {
  return journal;
}

export function clearJournal(): void {
  journal.length = 0;
}

/** 저널을 사람이 읽을 블록으로. `flg.report()` 가 싣는다. */
export function formatJournal(limit = 15): string {
  const rows = journal.slice(-limit);
  if (rows.length === 0) return '  (없음)';
  const t0 = rows[0].at;
  return rows
    .map((e) => {
      const dt = ((e.at - t0) / 1000).toFixed(1).padStart(6);
      return `  +${dt}s  ${e.name}(${e.args}) → ${e.result}`;
    })
    .join('\n');
}
