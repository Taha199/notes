import { createPortal } from 'react-dom';
import { useLanguage } from '../../contexts/LanguageContext';

const GOOGLE_HOME = 'https://www.google.com/';

function openGoogleTab() {
  const tab = window.open(GOOGLE_HOME, '_blank');
  if (tab) {
    tab.opener = null;
    return;
  }

  const link = document.createElement('a');
  link.href = GOOGLE_HOME;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function FloatingOtterSearch() {
  const { t } = useLanguage();

  return createPortal(
    <div className="otter-launcher-wrap fixed bottom-5 right-5 z-50 sm:bottom-6">
      <button
        type="button"
        onClick={openGoogleTab}
        aria-label={t.otterSearchToggle}
        className="otter-launcher flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-white/60 bg-white shadow-xl shadow-primary/25 transition hover:scale-105 dark:border-white/10 dark:bg-gray-900"
      >
        <span className="otter-launcher-google" aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 48 48" role="img" aria-label="Google">
            <path
              fill="#FFC107"
              d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.223 36 24 36c-5.522 0-10-4.478-10-10s4.478-10 10-10c2.426 0 4.652.867 6.375 2.301l5.975-5.975C33.642 9.053 29.028 7 24 7 13.507 7 5 15.507 5 26s8.507 19 19 19 19-8.507 19-19c0-1.341-.138-2.65-.389-3.917z"
            />
            <path
              fill="#FF3D00"
              d="M6.306 14.691l6.571 4.819C14.655 16.108 18.961 13 24 13c2.426 0 4.652.867 6.375 2.301l5.975-5.975C33.642 9.053 29.028 7 24 7c-7.682 0-14.344 4.337-17.694 10.691z"
            />
            <path
              fill="#4CAF50"
              d="M24 45c5.097 0 9.621-1.948 13.094-5.094l-6.057-4.909C29.223 36 24.723 37 24 37c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 41.556 16.227 45 24 45z"
            />
            <path
              fill="#1976D2"
              d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.057 4.909C35.852 41.09 41 36 41 26c0-1.341-.138-2.65-.389-3.917z"
            />
          </svg>
        </span>
      </button>
    </div>,
    document.body,
  );
}
