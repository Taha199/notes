import { useLanguage } from '../../contexts/LanguageContext';

export function FooterCredit() {
  const { t } = useLanguage();

  return (
    <div className="pointer-events-none flex w-full select-none flex-col items-center gap-0.5 py-5 text-center">
      <span className="rounded-full border border-white/70 bg-white/45 px-4 py-1.5 text-[11px] font-semibold tracking-[0.18em] text-transparent shadow-[0_12px_34px_rgba(108,99,255,0.14)] backdrop-blur-xl bg-clip-text bg-gradient-to-r from-[#7C6DFF] via-[#A78BFA] to-[#4F46E5] dark:border-white/10 dark:bg-white/5 dark:from-[#C4B5FD] dark:via-[#8B5CF6] dark:to-[#DDD6FE] sm:text-xs">
        {t.designedBy}
      </span>
    </div>
  );
}
