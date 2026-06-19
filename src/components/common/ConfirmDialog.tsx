import { createPortal } from 'react-dom';

interface Props {
  title?: string;
  message: string;
  count?: number;
  countLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, count, countLabel, confirmLabel = 'Delete', cancelLabel = 'Cancel', onConfirm, onCancel }: Props) {
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-gray-950/60 backdrop-blur-sm" onClick={onCancel} />

      {/* Card */}
      <div className="relative w-full max-w-md rounded-2xl border border-app-border bg-white shadow-2xl dark:border-white/10 dark:bg-gray-900">
        {/* Icon + header */}
        <div className="flex flex-col items-center px-6 pt-6 pb-4 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-2xl dark:bg-red-500/15">
            🗑️
          </div>
          {title && <h3 className="mb-1 text-[15px] font-bold text-app-text dark:text-gray-100">{title}</h3>}
          <p className="text-[13.5px] leading-relaxed text-app-text-secondary dark:text-gray-400">{message}</p>
          {count !== undefined && count > 0 && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 dark:border-red-500/20 dark:bg-red-500/10">
              <span className="text-[13px] font-semibold text-red-700 dark:text-red-400">
                {count} {countLabel ?? (count === 1 ? 'note' : 'notes')} will be deleted
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2.5 border-t border-app-border px-5 py-4 dark:border-white/10">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-app-border py-2.5 text-[13px] font-medium text-app-text-secondary transition-all hover:bg-app-bg dark:border-white/10 dark:hover:bg-white/5"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-red-600 py-2.5 text-[13px] font-semibold text-white shadow-md shadow-red-500/20 transition-all hover:-translate-y-0.5 hover:bg-red-700"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
