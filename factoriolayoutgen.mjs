#!/usr/bin/env node
/**
 * factoriolayoutgen 의 시작 파일 — `node factoriolayoutgen.mjs <명령>` (또는 `npm link` 뒤 `factoriolayoutgen <명령>`).
 *
 * CLI 코드(`cli/`)와 그것이 부르는 앱 코드(`src/`)는 TypeScript 라 Node 가 바로 못 돌린다. 그래서 한 파일로 묶어
 * 두고 그것을 돌린다 — 명령 한 번이 0.1초대(vite-node 는 1 ~ 3초, 2026-10-17 잰 값).
 *
 * **묶은 파일이 낡으면 다시 묶는다.** `src/` · `cli/` 에서 가장 최근에 고친 파일이 묶은 파일보다 새로우면 esbuild 로
 * 다시 묶는다(0.3초). 이 검사가 없으면 코드를 고친 뒤에도 옛 코드로 답한다.
 *
 * 작업 폴더는 이 파일 옆의 `.factoriolayoutgen/` 이다 — 어느 폴더에서 부르든 같다.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const bundle = join(root, 'node_modules', '.cache', 'factoriolayoutgen', 'cli.mjs');

function newest(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

const sourceTime = Math.max(newest(join(root, 'src')), newest(join(root, 'cli')), statSync(fileURLToPath(import.meta.url)).mtimeMs);
const bundleTime = existsSync(bundle) ? statSync(bundle).mtimeMs : 0;
if (sourceTime > bundleTime) {
  const { build } = await import('esbuild');
  await build({
    entryPoints: [join(root, 'cli', 'main.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: bundle,
    logLevel: 'warning',
  });
}

process.env.FACTORIOLAYOUTGEN_WORKDIR ??= join(root, '.factoriolayoutgen');
await import(pathToFileURL(bundle).href);
