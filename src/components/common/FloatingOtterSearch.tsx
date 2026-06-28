import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../../contexts/LanguageContext';

const POPUP_NAME = 'tahanote-google-panel';
const GOOGLE_HOME = 'https://www.google.com/';
const googleSearchUrl = (q: string) =>
  q.trim()
    ? `https://www.google.com/search?q=${encodeURIComponent(q.trim())}`
    : GOOGLE_HOME;

function getPanelWidth(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--otter-panel-width').trim();
  if (raw.endsWith('px')) return parseInt(raw, 10);
  if (window.innerWidth <= 768) return Math.min(window.innerWidth * 0.92, 400);
  return 540;
}

function screenLeft() {
  return window.screenLeft ?? window.screenX ?? 0;
}

function screenTop() {
  return window.screenTop ?? window.screenY ?? 0;
}

function popupFeatures(width: number, height: number, left: number, top: number) {
  return [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'resizable=yes',
    'scrollbars=yes',
    'toolbar=yes',
    'location=yes',
    'menubar=no',
    'status=no',
  ].join(',');
}

export function FloatingOtterSearch() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [currentUrl, setCurrentUrl] = useState(GOOGLE_HOME);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [popupReady, setPopupReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<Window | null>(null);

  const positionPopup = useCallback((popup: Window) => {
    const width = getPanelWidth();
    const headerBottom = headerRef.current?.getBoundingClientRect().bottom ?? 0;
    const left = Math.round(screenLeft() + window.outerWidth - width);
    const top = Math.round(screenTop() + headerBottom);
    const height = Math.max(320, Math.round(window.outerHeight - headerBottom));
    try {
      popup.resizeTo(width, height);
      popup.moveTo(left, top);
    } catch {
      // Safari may block move/resize on cross-origin windows.
    }
  }, []);

  const openGoogleWindow = useCallback(
    (url: string) => {
      const width = getPanelWidth();
      const headerBottom = headerRef.current?.getBoundingClientRect().bottom ?? 120;
      const left = Math.round(screenLeft() + window.outerWidth - width);
      const top = Math.round(screenTop() + headerBottom);
      const height = Math.max(320, Math.round(window.outerHeight - headerBottom));
      const features = popupFeatures(width, height, left, top);

      let popup = popupRef.current;
      if (!popup || popup.closed) {
        popup = window.open('', POPUP_NAME, features);
        if (!popup) {
          setPopupBlocked(true);
          setPopupReady(false);
          return null;
        }
        popupRef.current = popup;
      }

      try {
        popup.location.href = url;
      } catch {
        popup = window.open(url, POPUP_NAME, features);
        if (!popup) {
          setPopupBlocked(true);
          setPopupReady(false);
          return null;
        }
        popupRef.current = popup;
      }

      setPopupBlocked(false);
      setPopupReady(true);
      setCurrentUrl(url);
      requestAnimationFrame(() => positionPopup(popup!));
      popup.focus();
      return popup;
    },
    [positionPopup],
  );

  const closeGoogleWindow = useCallback(() => {
    const popup = popupRef.current;
    if (popup && !popup.closed) popup.close();
    popupRef.current = null;
    setPopupReady(false);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('otter-search-open', open);
    return () => document.body.classList.remove('otter-search-open');
  }, [open]);

  useEffect(() => {
    if (!open) {
      closeGoogleWindow();
      return;
    }

    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      const popup = popupRef.current;
      if (popup && !popup.closed) positionPopup(popup);
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onLayout = () => {
      const popup = popupRef.current;
      if (popup && !popup.closed) positionPopup(popup);
    };

    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onLayout);
    window.visualViewport?.addEventListener('resize', onLayout);
    window.visualViewport?.addEventListener('scroll', onLayout);

    const poll = window.setInterval(() => {
      if (popupRef.current?.closed) {
        setOpen(false);
        setPopupReady(false);
      }
    }, 500);

    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onLayout);
      window.visualViewport?.removeEventListener('resize', onLayout);
      window.visualViewport?.removeEventListener('scroll', onLayout);
      window.clearInterval(poll);
    };
  }, [open, closeGoogleWindow, positionPopup]);

  const runSearch = (term?: string) => {
    const q = (term ?? query).trim();
    const url = googleSearchUrl(q);
    if (q) setQuery(q);
    setCurrentUrl(url);
    if (open) openGoogleWindow(url);
  };

  const togglePanel = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const url = query.trim() ? googleSearchUrl(query) : GOOGLE_HOME;
    openGoogleWindow(url);
    setOpen(true);
  };

  const openExternal = () => {
    window.open(currentUrl, '_blank', 'noopener,noreferrer');
  };

  return createPortal(
    <>
      <aside
        role="complementary"
        aria-label={t.otterSearchTitle}
        aria-hidden={!open}
        className={
          'otter-search-panel fixed inset-y-0 right-0 z-40 flex flex-col border-l border-app-border bg-white shadow-xl dark:border-white/10 dark:bg-gray-950 ' +
          (open ? 'pointer-events-auto' : 'pointer-events-none')
        }
      >
        <div
          ref={headerRef}
          className="shrink-0 border-b border-app-border bg-white px-4 py-3 dark:border-white/10 dark:bg-gray-900"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-tight">
                <span className="text-[#4285F4]">G</span>
                <span className="text-[#EA4335]">o</span>
                <span className="text-[#FBBC05]">o</span>
                <span className="text-[#4285F4]">g</span>
                <span className="text-[#34A853]">l</span>
                <span className="text-[#EA4335]">e</span>
              </span>
              <span className="text-xs text-app-text-secondary dark:text-gray-400">{t.otterSearchTitle}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={openExternal}
                title={t.otterSearchExternal}
                className="rounded-lg px-2 py-1 text-xs font-medium text-app-text-secondary hover:bg-app-bg dark:text-gray-400 dark:hover:bg-white/10"
              >
                ↗
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t.otterSearchClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-app-text-secondary hover:bg-app-bg dark:text-gray-400 dark:hover:bg-white/10"
              >
                ✕
              </button>
            </div>
          </div>

          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch();
            }}
          >
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.otterSearchPlaceholder}
              className="min-w-0 flex-1 rounded-full border border-app-border bg-app-bg px-4 py-2.5 text-sm text-app-text outline-none focus:border-primary dark:border-white/15 dark:bg-white/5 dark:text-gray-100"
            />
            <button
              type="submit"
              className="shrink-0 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary/25 transition hover:bg-primary-dark"
            >
              {t.otterSearchGo}
            </button>
          </form>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          {popupBlocked ? (
            <>
              <p className="text-sm leading-relaxed text-app-text-secondary dark:text-gray-400">
                {t.otterSearchPopupBlocked}
              </p>
              <a
                href={query.trim() ? googleSearchUrl(query) : GOOGLE_HOME}
                target={POPUP_NAME}
                rel="opener"
                onClick={() => {
                  setPopupBlocked(false);
                  setPopupReady(true);
                }}
                className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-primary-dark"
              >
                {t.otterSearchPopupRetry}
              </a>
            </>
          ) : popupReady ? (
            <p className="max-w-xs text-xs leading-relaxed text-app-text-secondary dark:text-gray-500">
              {t.otterSearchPopupDocked}
            </p>
          ) : (
            <p className="max-w-xs text-sm leading-relaxed text-app-text-secondary dark:text-gray-400">
              {t.otterSearchPopupLoading}
            </p>
          )}
        </div>
      </aside>

      <button
        type="button"
        onClick={togglePanel}
        aria-label={t.otterSearchToggle}
        aria-expanded={open}
        className={
          'otter-launcher fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-white/60 bg-white text-3xl shadow-xl shadow-primary/25 transition-all hover:scale-105 hover:shadow-2xl active:scale-95 dark:border-white/10 dark:bg-gray-900 sm:bottom-6 ' +
          (open ? 'ring-2 ring-primary ring-offset-2 ring-offset-app-bg dark:ring-offset-[#0F0F17]' : '')
        }
      >
        🦦
      </button>
    </>,
    document.body,
  );
}
