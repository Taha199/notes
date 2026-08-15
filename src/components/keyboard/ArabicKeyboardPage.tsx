import { useCallback, useRef, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useToast } from '../../contexts/ToastContext';
import { arabicFromCode, insertAtCursor } from '../../lib/arabicKeyboard';
import { ArabicOnScreenKeyboard } from './ArabicOnScreenKeyboard';

function openSearchTab(url: string) {
  const tab = window.open(url, '_blank', 'noopener,noreferrer');
  if (tab) {
    tab.opener = null;
    return;
  }
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function ArabicKeyboardPage() {
  const { t } = useLanguage();
  const { show } = useToast();
  const [text, setText] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const insert = useCallback((chunk: string) => {
    const el = areaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const { next, caret } = insertAtCursor(text, start, end, chunk);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }, [text]);

  const backspace = useCallback(() => {
    const el = areaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    if (start !== end) {
      const { next, caret } = insertAtCursor(text, start, end, '');
      setText(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(caret, caret);
      });
      return;
    }
    if (start <= 0) return;
    const next = text.slice(0, start - 1) + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start - 1, start - 1);
    });
  }, [text]);

  const copyText = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      show(t.arabicKbCopied);
    } catch {
      areaRef.current?.select();
      document.execCommand('copy');
      show(t.arabicKbCopied);
    }
  };

  const query = text.trim();
  const openGoogle = () => {
    if (!query) return;
    openSearchTab(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
  };
  const openYouTube = () => {
    if (!query) return;
    openSearchTab(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 px-3 py-4 sm:px-5 sm:py-5" dir="rtl">
      <div className="rounded-2xl border border-app-border bg-white p-4 shadow-sm dark:border-white/10 dark:bg-gray-900/70">
        <textarea
          ref={areaRef}
          data-arabic-local="true"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === 'Backspace') {
              e.preventDefault();
              backspace();
              return;
            }
            const mapped = arabicFromCode(e.code, e.shiftKey);
            if (mapped == null) return;
            e.preventDefault();
            insert(mapped);
          }}
          rows={7}
          placeholder={t.arabicKbPlaceholder}
          className="w-full resize-y rounded-xl border border-app-border bg-app-bg px-3 py-3 text-right text-lg leading-8 text-app-text outline-none placeholder:text-app-text-secondary/50 focus:border-primary/50 focus:ring-4 focus:ring-primary/10 dark:border-white/15 dark:bg-gray-800/90 dark:text-gray-100"
          dir="rtl"
          lang="ar"
          spellCheck={false}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copyText()}
            disabled={!text}
            className="rounded-xl bg-primary px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t.arabicKbCopy}
          </button>
          <button
            type="button"
            onClick={openGoogle}
            disabled={!query}
            title={t.arabicKbOpenGoogle}
            aria-label={t.arabicKbOpenGoogle}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-app-border hover:bg-app-bg disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10"
          >
            <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.223 36 24 36c-5.522 0-10-4.478-10-10s4.478-10 10-10c2.426 0 4.652.867 6.375 2.301l5.975-5.975C33.642 9.053 29.028 7 24 7 13.507 7 5 15.507 5 26s8.507 19 19 19 19-8.507 19-19c0-1.341-.138-2.65-.389-3.917z" />
              <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 16.108 18.961 13 24 13c2.426 0 4.652.867 6.375 2.301l5.975-5.975C33.642 9.053 29.028 7 24 7c-7.682 0-14.344 4.337-17.694 10.691z" />
              <path fill="#4CAF50" d="M24 45c5.097 0 9.621-1.948 13.094-5.094l-6.057-4.909C29.223 36 24.723 37 24 37c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 41.556 16.227 45 24 45z" />
              <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.057 4.909C35.852 41.09 41 36 41 26c0-1.341-.138-2.65-.389-3.917z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={openYouTube}
            disabled={!query}
            title={t.arabicKbOpenYouTube}
            aria-label={t.arabicKbOpenYouTube}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-app-border hover:bg-app-bg disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10"
          >
            <svg width="22" height="16" viewBox="0 0 24 17" aria-hidden="true">
              <path fill="#FF0000" d="M23.5 2.7A3 3 0 0 0 21.4.6C19.5.1 12 .1 12 .1s-7.5 0-9.4.5A3 3 0 0 0 .5 2.7 31.5 31.5 0 0 0 0 8.5a31.5 31.5 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1 31.5 31.5 0 0 0 .5-5.8 31.5 31.5 0 0 0-.5-5.8z" />
              <path fill="#fff" d="M9.6 12.1V4.9l6.3 3.6-6.3 3.6z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setText('')}
            disabled={!text}
            className="rounded-xl border border-app-border px-3.5 py-2 text-[13px] font-semibold text-app-text hover:bg-app-bg disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-gray-100"
          >
            {t.arabicKbClear}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-app-border bg-white p-3 shadow-sm dark:border-white/10 dark:bg-gray-900/70">
        <ArabicOnScreenKeyboard onInsert={insert} onBackspace={backspace} />
      </div>
    </div>
  );
}
