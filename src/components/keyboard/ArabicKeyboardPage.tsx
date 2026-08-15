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
            className="rounded-xl border border-app-border px-3.5 py-2 text-[13px] font-semibold text-app-text hover:bg-app-bg disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-gray-100"
          >
            {t.arabicKbOpenGoogle}
          </button>
          <button
            type="button"
            onClick={openYouTube}
            disabled={!query}
            className="rounded-xl border border-app-border px-3.5 py-2 text-[13px] font-semibold text-app-text hover:bg-app-bg disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-gray-100"
          >
            {t.arabicKbOpenYouTube}
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
