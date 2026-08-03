import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ko } from './ko';
import { en } from './en';

export type Language = 'ko' | 'en';

const translations = { ko, en };

interface I18nState {
  language: Language;
  setLanguage: (lang: Language) => void;
}

function detectBrowserLanguage(): Language {
  if (typeof navigator === 'undefined') return 'en';
  const lang = (navigator.language || '').toLowerCase();
  return lang.startsWith('ko') ? 'ko' : 'en';
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      language: detectBrowserLanguage(),
      setLanguage: (language) => set({ language }),
    }),
    { name: 'factorio-layout-i18n' }
  )
);

/**
 * Get translation by dot-path key with optional {placeholder} substitution.
 * Works outside React components — reads current language from store directly.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const lang = useI18nStore.getState().language;
  const dict = translations[lang];
  const value = key.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object' && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, dict);

  if (typeof value !== 'string') return key;
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (_, name) =>
    name in params ? String(params[name]) : `{${name}}`
  );
}

/**
 * React hook — subscribes to language changes so components re-render.
 */
export function useT() {
  const language = useI18nStore((s) => s.language);
  return (key: string, params?: Record<string, string | number>) => {
    const dict = translations[language];
    const value = key.split('.').reduce<unknown>((acc, k) => {
      if (acc && typeof acc === 'object' && k in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[k];
      }
      return undefined;
    }, dict);
    if (typeof value !== 'string') return key;
    if (!params) return value;
    return value.replace(/\{(\w+)\}/g, (_, name) =>
      name in params ? String(params[name]) : `{${name}}`
    );
  };
}
