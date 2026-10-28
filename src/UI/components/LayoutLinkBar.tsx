/**
 * 링크로 연 탭이라는 표시 — 툴바 아래 띠 하나.
 *
 * 링크로 연 탭은 저장하지 않는다(`layoutLink/openInApp.ts`). 그 사실이 화면에 없으면 사용자는 손본 배치가 남는 줄
 * 안다. 링크를 못 열었을 때도 같은 자리에 까닭을 띄운다 — 실패를 삼키지 않는다.
 */

import { leaveLayoutLink } from '../../layoutLink/openInApp';
import { useT } from '../i18n/index';
import { useLayoutLinkStore } from '../store/layoutLinkStore';

export default function LayoutLinkBar() {
  const t = useT();
  const opened = useLayoutLinkStore((s) => s.opened);
  const error = useLayoutLinkStore((s) => s.error);

  if (error) {
    const dismiss = () => {
      // 주소의 깨진 링크를 지운다 — 새로 고칠 때마다 같은 실패가 뜨지 않게.
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      useLayoutLinkStore.setState({ error: null });
    };
    return (
      <div className="flex items-center gap-3 bg-red-900/80 text-red-100 text-xs px-3 py-1.5">
        <span>{t('layoutLink.openFailed', { message: error })}</span>
        <button onClick={dismiss} className="toolbar-btn ml-auto">✕</button>
      </div>
    );
  }
  if (!opened) return null;
  return (
    <div className="flex items-center gap-3 bg-sky-900/80 text-sky-100 text-xs px-3 py-1.5">
      <span className="font-bold">
        {t('layoutLink.opened')}
        {opened.title ? ` — ${opened.title}` : ''}
      </span>
      <span className="text-sky-300">{t('layoutLink.notSaved')}</span>
      <button onClick={leaveLayoutLink} className="toolbar-btn ml-auto">{t('layoutLink.back')}</button>
    </div>
  );
}
