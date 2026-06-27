import { useEffect } from 'react';
import type { Page } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { applySeo, injectJsonLd } from '../../lib/seo';

export function SeoHead({ page }: { page: Page }) {
  const { lang } = useLanguage();

  useEffect(() => {
    applySeo(page, lang);
  }, [page, lang]);

  useEffect(() => {
    injectJsonLd();
  }, []);

  return null;
}
