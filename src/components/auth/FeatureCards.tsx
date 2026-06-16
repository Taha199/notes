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
    <div className={'flex w-full max-w-[460px] flex-col gap-3.5 ' + (align === 'center' ? 'mx-auto' : '')}>
      {cards.map((c, i) => {
        const [icon, label] = splitEmoji(c.title);
        return (
          <div
            key={i}
            className="animate-slide-up group relative flex min-h-[82px] items-center gap-4 overflow-hidden rounded-2xl border border-white/75 bg-white/65 px-5 py-4 shadow-[0_18px_55px_-32px_rgba(31,41,55,0.45),inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-primary/20 hover:bg-white/85 hover:shadow-[0_24px_65px_-35px_rgba(108,99,255,0.9),inset_0_1px_0_rgba(255,255,255,0.9)] dark:border-white/10 dark:bg-white/5 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] dark:hover:bg-white/10"
            style={{ animationDelay: `${0.15 + i * 0.08}s` }}
          >
            <span className="absolute inset-y-4 left-0 w-1 rounded-r-full bg-gradient-to-b from-primary via-[#8a82ff] to-transparent opacity-60 transition-opacity group-hover:opacity-100" />
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/18 via-white/40 to-primary/8 text-xl shadow-inner shadow-white/70 dark:from-primary/25 dark:via-white/5 dark:to-primary/10 dark:shadow-none">
              {icon}
            </span>
            <div dir={t.dir} className="min-w-0">
              <div className="text-[15px] font-bold leading-tight text-app-text dark:text-gray-100">{label}</div>
              <div className="mt-1 text-[13px] leading-relaxed text-app-text-secondary dark:text-gray-400">{c.sub}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
