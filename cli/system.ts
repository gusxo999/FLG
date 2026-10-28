/**
 * 이 컴퓨터의 클립보드 · 브라우저 — 링크가 **AI 의 손을 거치지 않게** 한다.
 *
 * 링크는 천 자가 넘는 문자열이라 사람이든 AI 든 옮겨 적으면 틀린다(2026-10-19 실측: AI 가 1544자 링크를 명령에 옮겨
 * 적다 47번째 글자를 바꿔 풀리지 않았다). 그래서 CLI 가 클립보드를 직접 읽고 쓰고, 브라우저를 직접 연다.
 * 사람과 CLI 가 **같은 컴퓨터**에 있을 때만 되는 길이다.
 */

import { execFileSync, spawn } from 'node:child_process';
import { Refusal } from './io';

/** 클립보드의 글. 못 읽으면 까닭과 함께 거절한다. */
export function readClipboard(): string {
  try {
    if (process.platform === 'win32') {
      return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8' });
    }
    if (process.platform === 'darwin') return execFileSync('pbpaste', { encoding: 'utf8' });
    return execFileSync('xclip', ['-o', '-selection', 'clipboard'], { encoding: 'utf8' });
  } catch (e) {
    throw new Refusal(`클립보드를 못 읽었다 — ${(e as Error).message.split('\n')[0]}`);
  }
}

/** 클립보드에 글을 넣는다. */
export function writeClipboard(text: string): void {
  try {
    if (process.platform === 'win32') execFileSync('clip', { input: text });
    else if (process.platform === 'darwin') execFileSync('pbcopy', { input: text });
    else execFileSync('xclip', ['-selection', 'clipboard'], { input: text });
  } catch (e) {
    throw new Refusal(`클립보드에 못 넣었다 — ${(e as Error).message.split('\n')[0]}`);
  }
}

/** 기본 브라우저로 주소를 연다. 셸을 거치지 않는다 — 주소의 글자가 셸 문법으로 읽히지 않게. */
export function openInBrowser(url: string): void {
  const [cmd, args] = process.platform === 'win32'
    ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore' });
  child.on('error', (e) => console.error(`브라우저를 못 열었다 — ${e.message}`));
  child.unref();
}
