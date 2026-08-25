import { useState } from 'react';
import type { CountdownItem } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { useCountdowns } from '../../contexts/CountdownsContext';
import { CountdownDisplay } from './CountdownDisplay';
import { CountdownSettingsModal } from './CountdownSettingsModal';

export function CountdownPage() {
  const { t } = useLanguage();
  const { countdowns, headerCountdownId, setHeaderCountdownId, addCountdown, updateCountdown, deleteCountdown } = useCountdowns();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CountdownItem | null>(null);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (item: CountdownItem) => {
    setEditing(item);
    setModalOpen(true);
  };

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 sm:px-5 sm:py-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-app-text dark:text-gray-100">{t.countdownTitle}</h1>
          <p className="mt-1 text-sm text-app-text-secondary dark:text-gray-400">{t.countdownSubtitle}</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition hover:bg-primary-dark"
        >
          + {t.countdownAdd}
        </button>
      </div>

      {!countdowns.length ? (
        <div className="flex flex-col items-center rounded-3xl border border-dashed border-app-border px-6 py-20 text-center dark:border-white/10">
          <span className="mb-3 text-5xl opacity-40">⏳</span>
          <p className="text-sm text-app-text-secondary dark:text-gray-400">{t.countdownEmpty}</p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-4 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary"
          >
            {t.countdownAddFirst}
          </button>
        </div>
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {countdowns.map((item) => (
            <CountdownDisplay
              key={item.id}
              item={item}
              pinned={headerCountdownId === item.id}
              onTogglePin={() => setHeaderCountdownId(headerCountdownId === item.id ? null : item.id)}
              onEdit={() => openEdit(item)}
            />
          ))}
        </div>
      )}

      <CountdownSettingsModal
        open={modalOpen}
        initial={editing}
        onClose={() => setModalOpen(false)}
        onSave={(draft) => {
          if (editing) updateCountdown(editing.id, draft);
          else addCountdown(draft);
        }}
        onDelete={editing ? () => deleteCountdown(editing.id) : undefined}
      />
    </div>
  );
}
