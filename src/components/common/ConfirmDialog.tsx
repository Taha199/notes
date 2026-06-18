interface Props {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ message, confirmLabel = 'OK', cancelLabel = 'Avbryt', danger = true, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-gray-950/50 backdrop-blur-sm" onClick={onCancel} />

      {/* Dialog */}
      <div className="relative w-full max-w-sm rounded-2xl border border-app-border bg-white shadow-2xl dark:border-white/10 dark:bg-gray-900">
        <div className="px-6 py-5">
          <p className="text-[14px] leading-relaxed text-app-text dark:text-gray-100">{message}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-app-border px-5 py-3.5 dark:border-white/10">
          <button
            onClick={onCancel}
            className="rounded-xl border border-app-border px-4 py-2 text-[13px] font-medium text-app-text-secondary transition-all hover:bg-app-bg dark:border-white/10 dark:hover:bg-white/5"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-[13px] font-semibold text-white transition-all hover:-translate-y-0.5 ${danger ? 'bg-red-600 shadow-md shadow-red-500/20 hover:bg-red-700' : 'bg-primary shadow-md shadow-primary/30 hover:bg-primary-dark'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
