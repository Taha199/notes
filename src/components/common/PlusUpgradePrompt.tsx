import { useLanguage } from '../../contexts/LanguageContext';

export function PlusUpgradePrompt({ compact = false }: { compact?: boolean }) {
  const { t } = useLanguage();

  return (
    <div
      className={
        'mx-auto flex flex-col items-center justify-center text-center ' +
        (compact ? 'max-w-md px-4 py-8' : 'max-w-lg px-6 py-16')
      }
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-primary text-3xl shadow-lg shadow-primary/25">
        ✨
      </div>
      <h2 className="mb-2 text-lg font-bold text-app-text dark:text-gray-100">{t.plusTitle}</h2>
      <p className="mb-4 text-sm leading-relaxed text-app-text-secondary dark:text-gray-400">{t.plusSub}</p>
      <ul className="mb-2 space-y-2 text-left text-sm text-app-text-secondary dark:text-gray-400">
        <li>{t.plusFeatureStorage}</li>
        <li>{t.plusFeatureAi}</li>
      </ul>
    </div>
  );
}
