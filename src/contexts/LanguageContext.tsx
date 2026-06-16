import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Lang } from '../types';
import { LANGS, type Translation } from '../i18n/translations';

interface LanguageCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Translation;
}

const LanguageContext = createContext<LanguageCtx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('appLang') as Lang | null;
    return saved && LANGS[saved] ? saved : 'sv';
  });

  useEffect(() => {
    document.documentElement.lang = LANGS[lang].htmlLang;
    document.documentElement.dir = LANGS[lang].dir;
  }, [lang]);

  const setLang = (l: Lang) => {
    localStorage.setItem('appLang', l);
    setLangState(l);
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t: LANGS[lang] }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
