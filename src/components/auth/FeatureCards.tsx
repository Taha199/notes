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
    <div className={'w-full max-w-[465px] overflow-hidden rounded-[28px] border border-white/75 bg-white/52 p-2 shadow-[0_28px_90px_-54px_rgba(31,41,55,0.55),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/5 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ' + (align === 'center' ? 'mx-auto' : '')}>
      {cards.map((c, i) => {
        const [icon, label] = splitEmoji(c.title);
        return (
          <div
            key={i}
            className="animate-slide-up group relative flex min-h-[78px] items-center gap-4 overflow-hidden rounded-3xl px-5 py-3.5 transition-all duration-300 hover:bg-white/70 dark:hover:bg-white/10"
            style={{ animationDelay: `${0.15 + i * 0.08}s` }}
          >
            {i > 0 && <span className="absolute left-5 right-5 top-0 h-px bg-gradient-to-r from-transparent via-primary/12 to-transparent dark:via-white/10" />}
            <span className="absolute inset-y-5 left-0 w-1 rounded-r-full bg-gradient-to-b from-primary via-[#8a82ff] to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center text-2xl">
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
