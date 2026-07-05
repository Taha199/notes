import { useLanguage } from '../../contexts/LanguageContext';
import { isDesktopApp } from '../../lib/isDesktopApp';
import { MAC_DMG_FILENAME, MAC_DMG_URL } from '../../lib/desktopApp';

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-app-border bg-white shadow-sm dark:border-white/10 dark:bg-gray-900">
      <div className="border-b border-app-border px-5 py-3.5 dark:border-white/10">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-400">
          {title}
        </h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

export function DownloadPage() {
  const { t } = useLanguage();
  const alreadyDesktop = isDesktopApp();

  if (alreadyDesktop) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-white px-6 py-8 text-center shadow-sm dark:border-emerald-500/20 dark:from-emerald-500/10 dark:to-gray-900">
          <span className="mb-3 block text-4xl">💻</span>
          <h1 className="text-lg font-bold text-app-text dark:text-gray-100">{t.downloadAlreadyTitle}</h1>
          <p className="mt-2 text-sm text-app-text-secondary dark:text-gray-400">{t.downloadAlreadyDesc}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8 sm:px-6 sm:py-10">
      <div className="px-1">
        <h1 className="text-xl font-bold tracking-tight text-app-text dark:text-gray-100">{t.downloadTitle}</h1>
        <p className="mt-2 text-sm leading-relaxed text-app-text-secondary dark:text-gray-400">{t.downloadSubtitle}</p>
      </div>

      <SectionCard title={t.downloadMacTitle}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 text-2xl shadow-inner dark:from-white/10 dark:to-white/5">
            🍎
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-app-text-secondary dark:text-gray-400">{t.downloadMacDesc}</p>
            <a
              href={MAC_DMG_URL}
              download={MAC_DMG_FILENAME}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-md shadow-primary/30 transition-all hover:-translate-y-0.5 hover:bg-primary-dark"
            >
              ⬇️ {t.downloadMacButton}
            </a>
            <p className="mt-3 text-xs leading-relaxed text-app-text-secondary/80 dark:text-gray-500">{t.downloadMacReqs}</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t.downloadBuildTitle}>
        <p className="text-sm text-app-text-secondary dark:text-gray-400">{t.downloadBuildDesc}</p>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-app-border bg-app-bg px-4 py-3 text-[12.5px] leading-relaxed text-app-text dark:border-white/10 dark:bg-black/30 dark:text-gray-200">
{`npm install
npm run desktop:build`}
        </pre>
        <p className="mt-3 text-xs leading-relaxed text-app-text-secondary/80 dark:text-gray-500">
          {t.downloadBuildOutput}
        </p>
      </SectionCard>
    </div>
  );
}
