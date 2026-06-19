import { createPortal } from 'react-dom';

interface Props {
  message: string;
  buttonLabel: string;
  onClose: () => void;
}

export function BrandedAlert({ message, buttonLabel, onClose }: Props) {
  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-gray-950/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Taha Note"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-3xl border border-app-border bg-white p-7 shadow-2xl dark:border-white/10 dark:bg-gray-900 sm:p-9"
      >
        <img src="/logo.png" alt="Taha Note" className="h-20 w-20 rounded-2xl object-cover shadow-lg" />
        <p className="mt-8 text-xl font-bold leading-relaxed text-app-text dark:text-gray-100">{message}</p>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="mt-8 w-full rounded-xl bg-app-border py-3 text-base font-semibold text-app-text transition-colors hover:bg-gray-300 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
        >
          {buttonLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
