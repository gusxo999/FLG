/**
 * CLI 의 바닥 — 작업 폴더 · 배치 파일 · 출력 규약.
 *
 * ## 출력 규약 (`tempPlanDocs/CLI-앱/CLAUDE.md` 결정 기록)
 *
 *  - 첫 줄은 결과 한 줄 — `[factoriolayoutgen] <명령>(<인자>) → <결과>`. 긴 산출물은 그 아래.
 *  - 못 하는 명령은 **다음에 칠 명령**과 함께 거절한다([Refusal]).
 *  - 종료 코드 — 0 해냈다 · 1 거절 · 2 돌았는데 답이 나쁘다(가동률 미달) · 3 예기치 않은 예외.
 *  - 묻지 않는다. 필요한 것은 전부 인자로.
 *  - 결과 파일은 CLI 가 직접 UTF-8 로 쓴다(셸의 `>` 는 Windows 에서 한글을 깰 수 있다).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { LayoutLinkPayload } from '../src/layoutLink/codec';

export const PROGRAM = 'factoriolayoutgen';

export const EXIT = { ok: 0, refused: 1, bad: 2, crash: 3 } as const;

/** 거절 — 사용자가 고칠 수 있는 까닭과 다음에 칠 명령을 담는다. 종료 코드 1. */
export class Refusal extends Error {}

/** 첫 줄. */
export function head(command: string, args: string, result: string): string {
  return `[${PROGRAM}] ${command}(${args}) → ${result}`;
}

/**
 * 작업 폴더 — **위치를 정하는 곳은 여기 하나다.** 시작 파일(`factoriolayoutgen.mjs`)이 저장소의
 * `.factoriolayoutgen/` 을 알려 준다. 나중에 설치판이 사용자 폴더를 쓰게 되면 바꿀 곳이 여기뿐이다.
 */
export function workDir(): string {
  return process.env.FACTORIOLAYOUTGEN_WORKDIR ?? resolve(process.cwd(), `.${PROGRAM}`);
}

const layoutsDir = () => join(workDir(), 'layouts');

/** 배치 이름 — 파일 이름이 되므로 글자 · 숫자 · `.` `_` `-` 만. */
export function checkName(name: string | undefined): string {
  if (!name) throw new Refusal(`배치 이름이 없다 — --as <이름> 을 준다`);
  if (!/^[\p{L}\p{N}._-]+$/u.test(name)) throw new Refusal(`배치 이름 '${name}' — 글자 · 숫자 · . _ - 만 쓴다`);
  return name;
}

/** 작업 폴더에 둔 배치 하나. `payload` 가 곧 링크에 담기는 것이다. */
export interface StoredLayout {
  format: 'factoriolayoutgen/layout';
  name: string;
  savedAt: string;
  /** 어디서 왔나 — `place <파일>` · `link`. */
  from: string;
  payload: LayoutLinkPayload;
}

export function readLayout(name: string): StoredLayout {
  const path = join(layoutsDir(), `${checkName(name)}.json`);
  if (!existsSync(path)) throw new Refusal(`배치 '${name}' 이 없다 — ${PROGRAM} list 로 이름을 본다`);
  return JSON.parse(readFileSync(path, 'utf8')) as StoredLayout;
}

export function writeLayout(name: string, from: string, payload: LayoutLinkPayload): string {
  mkdirSync(layoutsDir(), { recursive: true });
  const path = join(layoutsDir(), `${checkName(name)}.json`);
  const stored: StoredLayout = {
    format: 'factoriolayoutgen/layout', name, savedAt: new Date().toISOString(), from, payload,
  };
  writeFileSync(path, JSON.stringify(stored, null, 1), 'utf8');
  return path;
}

export function listLayouts(): StoredLayout[] {
  if (!existsSync(layoutsDir())) return [];
  return readdirSync(layoutsDir())
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(layoutsDir(), f), 'utf8')) as StoredLayout);
}

/** 인자에서 `--이름 값` 과 값 없는 `--이름`(`flags` 에 든 것)을 뺀다. 남은 것은 순서대로. */
export function parseArgs(
  args: string[],
  flags: readonly string[] = [],
): { positional: string[]; options: Map<string, string> } {
  const positional: string[] = [];
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--') && flags.includes(a.slice(2))) {
      options.set(a.slice(2), 'true');
    } else if (a.startsWith('--')) {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Refusal(`${a} 뒤에 값이 없다`);
      options.set(a.slice(2), v);
      i++;
    } else positional.push(a);
  }
  return { positional, options };
}
