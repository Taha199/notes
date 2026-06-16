import { useLanguage } from '../../contexts/LanguageContext';

function splitEmoji(s: string): [string, string] {
  const idx = s.indexOf(' ');
  return idx === -1 ? ['✦', s] : [s.slice(0, idx), s.slice(idx + 1)];
}

export function FeatureCards({ align = 'center' }: { align?: 'center' | 'start' }) {
  const { t } = useLanguage();
  const cards = [
    { title: t.featNotesTitle, sub: t.featNotesSub },
    { title: t.featCloudTitle, sub: t.featCloudSub },
    { title: t.featSecureTitle, sub: t.featSecureSub },
  ];
  return (
    <div className={'flex w-full max-w-[420px] flex-col gap-3 ' + (align === 'center' ? 'mx-auto' : '')}>
      {cards.map((c, i) => {
        const [icon, label] = splitEmoji(c.title);
        return (
          <div
            key={i}
            className="animate-slide-up flex items-center gap-4 rounded-2xl border border-white/60 bg-white/60 px-5 py-4 backdrop-blur-md shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white/80 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            style={{ animationDelay: `${0.15 + i * 0.08}s` }}
          >
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-xl dark:from-primary/25 dark:to-primary/10">
              {icon}
            </span>
            <div dir={t.dir} className="min-w-0">
              <div className="text-sm font-semibold text-app-text dark:text-gray-100">{label}</div>
              <div className="mt-0.5 text-xs text-app-text-secondary dark:text-gray-400">{c.sub}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
