import { useLanguage } from '../../contexts/LanguageContext';

export function FeatureCards() {
  const { t } = useLanguage();
  const cards = [
    { title: t.featNotesTitle, sub: t.featNotesSub },
    { title: t.featCloudTitle, sub: t.featCloudSub },
    { title: t.featSecureTitle, sub: t.featSecureSub },
  ];
  return (
    <div className="mt-8 hidden w-full max-w-[420px] grid-cols-1 gap-3 md:grid">
      {cards.map((c, i) => (
        <div
          key={i}
          className="animate-slide-up rounded-2xl border border-white/60 bg-white/60 px-5 py-4 text-center backdrop-blur-md shadow-sm transition-transform hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/5"
          style={{ animationDelay: `${0.15 + i * 0.08}s` }}
        >
          <div className="text-sm font-semibold text-app-text dark:text-gray-100">{c.title}</div>
          <div className="mt-1 text-xs text-app-text-secondary dark:text-gray-400">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
