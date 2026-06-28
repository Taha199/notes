import { useEffect, useRef, useState } from 'react';
import { useNotes } from '../../contexts/NotesContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { RichTextEditor } from './RichTextEditor';
import { CloudSaveIndicator } from '../common/CloudSaveIndicator';
import { generateQuiz, answerQuestion, type QuizResult } from '../../lib/gemini';
import type { Page } from '../../types';

const hasContent = (h: string) => !!h.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

function mdToHtml(content: string): string {
  // Only convert if content looks like markdown (not already HTML)
  if (/<[a-z][\s\S]*>/i.test(content)) return content;
  return content
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

interface NoteEditorModalProps {
  noteId: number;
  previousNoteId?: number;
  nextNoteId?: number;
  onChangeNote?: (noteId: number) => void;
  onClose: () => void;
  onNavigate?: (page: Page) => void;
}

export function NoteEditorModal({ noteId, previousNoteId, nextNoteId, onChangeNote, onClose, onNavigate }: NoteEditorModalProps) {
  const { notes, updateNote, toggleFav, trash, archive, unarchive, nowStr, addQuiz } = useNotes();
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const { hasAi } = useAuth();
  const note = notes.find((n) => n.id === noteId);
  const [locked, setLocked] = useState(() => !!note?.read);
  const [title, setTitle] = useState(note?.title ?? '');
  const [html, setHtml] = useState(() => mdToHtml(note?.html ?? ''));

  // Quiz state
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizItems, setQuizItems] = useState<QuizResult[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [quizError, setQuizError] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const [editingQuiz, setEditingQuiz] = useState(false);
  const [editQ, setEditQ] = useState('');
  const [editA, setEditA] = useState('');
  const [aiAnswerLoading, setAiAnswerLoading] = useState(false);
  const [manualQuiz, setManualQuiz] = useState(false);
  const [manualQ, setManualQ] = useState('');
  const [manualA, setManualA] = useState('');
  const [manualAiLoading, setManualAiLoading] = useState(false);
  // AI Question mode (third screen)
  const [aiMode, setAiMode] = useState(false);
  const [aiQ, setAiQ] = useState('');
  const [aiA, setAiA] = useState('');
  const [aiGenQLoading, setAiGenQLoading] = useState(false);
  const [aiGenALoading, setAiGenALoading] = useState(false);
  const [mcqMode, setMcqMode] = useState(false);
  const [mcqOptions, setMcqOptions] = useState(['', '', '', '']);
  const [mcqCorrect, setMcqCorrect] = useState(0);
  const [copied, setCopied] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(note?.lastEdited ?? null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setHtml(mdToHtml(note.html));
      setLocked(!!note.read);
    }
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleArrowNavigation = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '');
      if (isTyping) return;
      if (event.key === 'ArrowLeft' && previousNoteId !== undefined) onChangeNote?.(previousNoteId);
      if (event.key === 'ArrowRight' && nextNoteId !== undefined) onChangeNote?.(nextNoteId);
    };
    window.addEventListener('keydown', handleArrowNavigation);
    return () => window.removeEventListener('keydown', handleArrowNavigation);
  }, [nextNoteId, onChangeNote, previousNoteId]);

  if (!note) return null;

  const plainText = html.replace(/<[^>]*>/g, '').trim();
  const current = quizItems[quizIndex];

  const save = () => {
    if (!plainText) return;
    const ts = nowStr();
    updateNote(note.id, { title: title.trim(), html, text: plainText, lastEdited: ts });
    setLastSavedAt(ts);
  };

  // Auto-save 1.5 s after the user stops typing (only in edit mode)
  useEffect(() => {
    if (locked) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { save(); }, 1500);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [html, title, locked]); // eslint-disable-line react-hooks/exhaustive-deps

  const markDone = () => {
    updateNote(note.id, { read: true });
    show(t.tStudied);
    if (nextNoteId !== undefined && onChangeNote) {
      onChangeNote(nextNoteId);
    } else {
      onNavigate?.('read');
      onClose();
    }
  };

  const markUndone = () => {
    updateNote(note.id, { read: false });
    show(t.tUnstudied);
    onClose();
  };

  const handleArchive = () => {
    archive(note.id);
    show(t.tArched);
    onNavigate?.('archive');
    onClose();
  };


  const handleSaveCurrent = () => {
    if (!current) return;
    addQuiz({ noteId: note.id, noteTitle: note.title || note.text.slice(0, 50), question: current.question, answer: current.answer, date: nowStr() });
    setSavedCount((c) => c + 1);
    goNext();
  };

  const goNext = () => {
    setEditingQuiz(false);
    if (quizIndex + 1 < quizItems.length) {
      setQuizIndex((i) => i + 1);
      setShowAnswer(false);
    } else {
      show(`${savedCount + (showAnswer ? 1 : 0)} frågor sparade i Quiz 🧠`);
      setQuizOpen(false);
    }
  };

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-gray-900/45 p-2 backdrop-blur-sm sm:p-4">
      <button
        type="button"
        onClick={() => previousNoteId !== undefined && onChangeNote?.(previousNoteId)}
        disabled={previousNoteId === undefined}
        aria-label="Previous note"
        title="Previous note"
        className="fixed left-3 top-1/2 z-[60] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-gray-950/65 text-3xl text-white shadow-xl backdrop-blur-md transition-all hover:scale-105 hover:bg-gray-950/80 disabled:pointer-events-none disabled:opacity-20 sm:left-6 sm:h-12 sm:w-12"
      >
        ‹
      </button>
      <button
        type="button"
        onClick={() => nextNoteId !== undefined && onChangeNote?.(nextNoteId)}
        disabled={nextNoteId === undefined}
        aria-label="Next note"
        title="Next note"
        className="fixed right-3 top-1/2 z-[60] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-gray-950/65 text-3xl text-white shadow-xl backdrop-blur-md transition-all hover:scale-105 hover:bg-gray-950/80 disabled:pointer-events-none disabled:opacity-20 sm:right-6 sm:h-12 sm:w-12"
      >
        ›
      </button>
      <div className="flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-app-border bg-white shadow-2xl dark:border-white/10 dark:bg-gray-900 sm:max-h-[92vh] sm:rounded-3xl" style={{ animation: 'slideUp .22s cubic-bezier(.34,1.56,.64,1)' }}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-border bg-app-bg px-3 py-3 dark:border-white/10 dark:bg-white/5 sm:px-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              onClick={() => setLocked((l) => !l)}
              className={'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ' + (locked ? 'border-primary/40 bg-primary/10 text-primary' : 'border-app-border text-app-text-secondary hover:border-primary/40 hover:text-primary')}
            >
              {locked ? '🔒' : '🔓'} {locked ? t.locked : t.editing}
            </button>
            {note.archived && note.read && (
              <span className="flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">✓ {t.archPill}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => toggleFav(note.id)} className={'flex h-8 w-8 items-center justify-center rounded-lg border text-sm transition-all ' + (note.fav ? 'border-amber-300 bg-amber-50 text-amber-600' : 'border-app-border text-app-text-secondary hover:border-amber-300 hover:text-amber-600')}>★</button>
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-app-text-secondary hover:bg-app-border/60 dark:hover:bg-white/10">✕</button>
          </div>
        </div>

        {manualQuiz ? (
          /* ── Add Question mode: note on left, form on right ── */
          <div className="flex flex-1 overflow-hidden divide-x divide-app-border dark:divide-white/10">
            {/* LEFT — Note (read-only) */}
            <div className="flex flex-1 flex-col overflow-y-auto">
              <input value={title} readOnly placeholder={t.mTiPh} className="border-b border-app-border px-4 py-3 text-base font-bold text-app-text outline-none dark:border-white/10 dark:bg-transparent dark:text-gray-100" />
              <RichTextEditor html={html} onChange={() => {}} placeholder="" editable={false} minHeight="150px" />
            </div>


            {/* RIGHT — Question form */}
            <div className="flex w-[400px] flex-shrink-0 flex-col overflow-y-auto bg-emerald-50/40 dark:bg-emerald-500/5">
              {/* Form header */}
              <div className="flex items-center justify-between border-b border-emerald-200/70 px-4 py-2.5 dark:border-emerald-500/15">
                <span className="text-[13px] font-bold text-emerald-700 dark:text-emerald-400">✏️ Skapa fråga</span>
                <button onClick={() => { setManualQuiz(false); setManualQ(''); setManualA(''); setMcqMode(false); setMcqOptions(['', '', '', '']); setMcqCorrect(0); }} className="text-[11px] text-app-text-secondary hover:text-app-text">✕ Stäng</button>
              </div>

              <div className="flex flex-1 flex-col gap-4 p-4">
                {/* Question */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-emerald-700/70 dark:text-emerald-400/70">Fråga</label>
                    <button
                      onClick={() => setManualQ(html)}
                      className="flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:bg-gray-800 dark:text-emerald-300"
                    >📋 Klistra in</button>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-app-border dark:border-white/10">
                    <RichTextEditor html={manualQ} onChange={setManualQ} placeholder="Skriv din fråga..." minHeight="110px" />
                  </div>
                </div>

                {/* Answer */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-emerald-700/70 dark:text-emerald-400/70">Svar</label>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => { setMcqMode((m) => !m); setManualA(''); setMcqOptions(['', '', '', '']); setMcqCorrect(0); }}
                        className={'flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition-all ' + (mcqMode ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300' : 'border-app-border bg-white text-app-text-secondary hover:border-blue-300 hover:text-blue-700 dark:border-white/10 dark:bg-gray-800 dark:text-gray-400')}
                      >☰ MCQ</button>
                      {!mcqMode && hasAi && (
                        <button
                          onClick={async () => { if (!hasContent(manualQ)) return; setManualAiLoading(true); try { setManualA(mdToHtml(await answerQuestion(manualQ.replace(/<[^>]*>/g, '')))); } finally { setManualAiLoading(false); } }}
                          disabled={manualAiLoading || !hasContent(manualQ)}
                          className="flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-40 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300"
                        >
                          {manualAiLoading ? <span className="animate-spin">⏳</span> : '🧠'} AI-svar
                        </button>
                      )}
                      {!mcqMode && (
                        <button
                          onClick={() => setManualA(html)}
                          className="flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:bg-gray-800 dark:text-emerald-300"
                        >📋 Klistra in</button>
                      )}
                    </div>
                  </div>

                  {mcqMode ? (
                    <div className="flex flex-col gap-2">
                      {mcqOptions.map((opt, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <button onClick={() => setMcqCorrect(i)} className={'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-all ' + (mcqCorrect === i ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-app-border bg-white text-app-text-secondary dark:border-white/20 dark:bg-gray-800')}>
                            {mcqCorrect === i ? '✓' : String.fromCharCode(65 + i)}
                          </button>
                          <input value={opt} dir="auto" onChange={(e) => { const o = [...mcqOptions]; o[i] = e.target.value; setMcqOptions(o); }} placeholder={`Option ${String.fromCharCode(65 + i)}...`} className={'flex-1 rounded-xl border px-3 py-2 text-[13px] text-app-text outline-none transition-all dark:bg-gray-800 dark:text-gray-100 ' + (mcqCorrect === i ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10' : 'border-app-border bg-white dark:border-white/10')} />
                          {mcqOptions.length > 2 && (
                            <button onClick={() => { const o = mcqOptions.filter((_, j) => j !== i); setMcqOptions(o); if (mcqCorrect >= o.length) setMcqCorrect(0); else if (mcqCorrect > i) setMcqCorrect(mcqCorrect - 1); }} className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] text-app-text-secondary/40 hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-500/10">✕</button>
                          )}
                        </div>
                      ))}
                      <div className="flex items-center gap-2">
                        {mcqOptions.length < 6 && <button onClick={() => setMcqOptions([...mcqOptions, ''])} className="flex items-center gap-1 rounded-lg border border-dashed border-app-border px-3 py-1.5 text-[11px] font-medium text-app-text-secondary/60 hover:border-primary/40 hover:text-primary dark:border-white/10">+ Alternativ</button>}
                        <p className="text-[10px] text-app-text-secondary/50 dark:text-gray-600">Circle = rätt svar</p>
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-app-border dark:border-white/10">
                      <RichTextEditor html={manualA} onChange={setManualA} placeholder="Skriv svaret..." minHeight="110px" />
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  <button onClick={() => { setManualQuiz(false); setManualQ(''); setManualA(''); setMcqMode(false); setMcqOptions(['', '', '', '']); setMcqCorrect(0); }} className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-medium text-app-text-secondary hover:bg-app-border/40">Avbryt</button>
                  <button
                    onClick={() => {
                      if (!hasContent(manualQ)) return;
                      let answer = mcqMode ? '' : manualA;
                      if (mcqMode) {
                        const filled = mcqOptions.filter((o) => o.trim());
                        if (filled.length < 2) return;
                        answer = mcqOptions.map((o, i) => `${String.fromCharCode(65 + i)}) ${o.trim()}${i === mcqCorrect ? ' ✓' : ''}`).filter((_, i) => mcqOptions[i].trim()).join('\n');
                      }
                      addQuiz({ noteId: note.id, noteTitle: note.title || note.text.slice(0, 50), question: manualQ, answer, date: nowStr() });
                      show('Fråga sparad i Quiz 🧠');
                      setManualQ(''); setManualA(''); setMcqOptions(['', '', '', '']); setMcqCorrect(0);
                    }}
                    disabled={!hasContent(manualQ) || (mcqMode && mcqOptions.filter((o) => o.trim()).length < 2)}
                    className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                  >💾 Spara fråga</button>
                </div>
              </div>
            </div>
          </div>
        ) : aiMode ? (
          /* ── AI Question mode: note on left, AI form on right ── */
          <div className="flex flex-1 overflow-hidden divide-x divide-app-border dark:divide-white/10">
            {/* LEFT — Note (read-only) */}
            <div className="flex flex-1 flex-col overflow-y-auto">
              <input value={title} readOnly placeholder={t.mTiPh} className="border-b border-app-border px-4 py-3 text-base font-bold text-app-text outline-none dark:border-white/10 dark:bg-transparent dark:text-gray-100" />
              <RichTextEditor html={html} onChange={() => {}} placeholder="" editable={false} minHeight="150px" />
            </div>

            {/* RIGHT — AI Question form */}
            <div className="flex w-[400px] flex-shrink-0 flex-col overflow-y-auto bg-violet-50/40 dark:bg-violet-500/5">
              {/* Form header */}
              <div className="flex items-center justify-between border-b border-violet-200/70 px-4 py-2.5 dark:border-violet-500/15">
                <span className="text-[13px] font-bold text-violet-700 dark:text-violet-400">🤖 AI Fråga</span>
                <button onClick={() => { setAiMode(false); setAiQ(''); setAiA(''); }} className="text-[11px] text-app-text-secondary hover:text-app-text">✕ Stäng</button>
              </div>

              <div className="flex flex-1 flex-col gap-4 p-4">
                {/* Question */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-violet-700/70 dark:text-violet-400/70">Fråga</label>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setAiQ(html)}
                        className="flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-500/30 dark:bg-gray-800 dark:text-violet-300"
                      >📋 Klistra in</button>
                      <button
                        onClick={async () => {
                          setAiGenQLoading(true);
                          try {
                            const results = await generateQuiz(note.text || plainText);
                            if (results.length > 0) setAiQ(mdToHtml(results[0].question));
                          } finally { setAiGenQLoading(false); }
                        }}
                        disabled={aiGenQLoading}
                        className="flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-40 dark:border-violet-500/30 dark:bg-gray-800 dark:text-violet-300"
                      >
                        {aiGenQLoading ? <span className="animate-spin">⏳</span> : '🎲'} Generera fråga
                      </button>
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-app-border dark:border-white/10">
                    <RichTextEditor html={aiQ} onChange={setAiQ} placeholder="Generera eller skriv din fråga..." minHeight="110px" />
                  </div>
                </div>

                {/* Answer */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-violet-700/70 dark:text-violet-400/70">Svar</label>
                    <button
                      onClick={async () => {
                        if (!hasContent(aiQ)) return;
                        setAiGenALoading(true);
                        try { setAiA(mdToHtml(await answerQuestion(aiQ.replace(/<[^>]*>/g, '')))); }
                        finally { setAiGenALoading(false); }
                      }}
                      disabled={aiGenALoading || !hasContent(aiQ)}
                      className="flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-40 dark:border-violet-500/30 dark:bg-gray-800 dark:text-violet-300"
                    >
                      {aiGenALoading ? <span className="animate-spin">⏳</span> : '🧠'} AI-svar
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-app-border dark:border-white/10">
                    <RichTextEditor html={aiA} onChange={setAiA} placeholder="Generera eller skriv svaret..." minHeight="110px" />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button onClick={() => { setAiMode(false); setAiQ(''); setAiA(''); }} className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-medium text-app-text-secondary hover:bg-app-border/40">Avbryt</button>
                  <button
                    onClick={() => {
                      if (!hasContent(aiQ)) return;
                      addQuiz({ noteId: note.id, noteTitle: note.title || note.text.slice(0, 50), question: aiQ, answer: aiA, date: nowStr() });
                      show('Fråga sparad i Quiz 🧠');
                      setAiQ(''); setAiA('');
                    }}
                    disabled={!hasContent(aiQ)}
                    className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
                  >💾 Spara fråga</button>
                </div>
              </div>
            </div>
          </div>
        ) : quizOpen ? (
          /* ── Generate Quiz mode: note on left, flashcard on right ── */
          <div className="flex flex-1 overflow-hidden divide-x divide-app-border dark:divide-white/10">
            {/* LEFT — Note (read-only) */}
            <div className="flex flex-1 flex-col overflow-y-auto">
              <input value={title} readOnly placeholder={t.mTiPh} className="border-b border-app-border px-4 py-3 text-base font-bold text-app-text outline-none dark:border-white/10 dark:bg-transparent dark:text-gray-100" />
              <RichTextEditor html={html} onChange={() => {}} placeholder="" editable={false} minHeight="150px" />
            </div>

            {/* RIGHT — Quiz flashcard */}
            <div className="flex w-[400px] flex-shrink-0 flex-col overflow-y-auto bg-violet-50/40 dark:bg-violet-500/5">
              <div className="flex items-center justify-between border-b border-violet-200/70 px-4 py-2.5 dark:border-violet-500/15">
                <span className="text-[13px] font-bold text-violet-700 dark:text-violet-400">
                  🧠 Quiz
                  {quizItems.length > 0 && <span className="ml-2 text-[11px] font-normal opacity-60">{quizIndex + 1} / {quizItems.length}</span>}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      setQuizLoading(true);
                      try {
                        const more = await generateQuiz(note.text || plainText);
                        setQuizItems((prev) => [...prev, ...more]);
                      } catch {
                        // ignore
                      } finally { setQuizLoading(false); }
                    }}
                    disabled={quizLoading}
                    className="flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-40 dark:border-violet-500/30 dark:bg-gray-800 dark:text-violet-300"
                  >
                    {quizLoading ? <span className="animate-spin">⏳</span> : '+'} Generera fler
                  </button>
                  <button onClick={() => setQuizOpen(false)} className="text-[11px] text-app-text-secondary hover:text-app-text">✕ Stäng</button>
                </div>
              </div>

              <div className="flex flex-1 flex-col gap-3 p-4">
                {quizLoading && (
                  <div className="flex items-center gap-2 text-[13px] text-violet-600 dark:text-violet-400">
                    <span className="animate-spin">⏳</span> Genererar frågor...
                  </div>
                )}
                {quizError && <p className="text-[13px] text-red-600">{quizError}</p>}

                {current && !quizLoading && (
                  <>
                    {editingQuiz ? (
                      /* ── Edit mode ── */
                      <div className="flex flex-col gap-3">
                        <div>
                          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60">Fråga</label>
                          <div className="rounded-xl border border-app-border bg-white focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-200/60 dark:border-white/10 dark:bg-gray-800">
                            <RichTextEditor html={editQ} onChange={setEditQ} placeholder="Skriv frågan..." editable={true} minHeight="80px" />
                          </div>
                        </div>
                        <div>
                          <div className="mb-1 flex items-center justify-between">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60">Svar</label>
                            {hasAi && (
                            <button
                              onClick={async () => {
                                const qText = editQ.replace(/<[^>]*>/g, '').trim();
                                if (!qText) return;
                                setAiAnswerLoading(true);
                                try { setEditA(mdToHtml(await answerQuestion(qText))); }
                                finally { setAiAnswerLoading(false); }
                              }}
                              disabled={aiAnswerLoading || !editQ.replace(/<[^>]*>/g, '').trim()}
                              className="flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 transition-all hover:bg-violet-100 disabled:opacity-40 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300"
                            >
                              {aiAnswerLoading ? <span className="animate-spin">⏳</span> : '🧠'} AI-svar
                            </button>
                            )}
                          </div>
                          <div className="rounded-xl border border-app-border bg-white focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-200/60 dark:border-white/10 dark:bg-gray-800">
                            <RichTextEditor html={editA} onChange={setEditA} placeholder="Skriv svaret..." editable={true} minHeight="100px" />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setEditingQuiz(false)} className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-medium text-app-text-secondary hover:bg-app-border/40">Avbryt</button>
                          <button
                            onClick={() => {
                              const qText = editQ.replace(/<[^>]*>/g, '').trim();
                              if (!qText) return;
                              const updated = quizItems.map((item, i) => i === quizIndex ? { question: editQ, answer: editA } : item);
                              setQuizItems(updated);
                              setEditingQuiz(false);
                              setShowAnswer(true);
                            }}
                            className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
                          >✓ Klar</button>
                        </div>
                      </div>
                    ) : (
                      /* ── View mode ── */
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[14px] font-semibold leading-snug text-app-text dark:text-gray-100" dangerouslySetInnerHTML={{ __html: mdToHtml(current.question) }} />
                          <button
                            onClick={() => { setEditQ(mdToHtml(current.question)); setEditA(mdToHtml(current.answer)); setEditingQuiz(true); setShowAnswer(true); }}
                            className="flex-shrink-0 rounded-lg border border-app-border px-2 py-1 text-[11px] text-app-text-secondary hover:border-primary/40 hover:text-primary dark:border-white/10"
                          >✏️ Redigera</button>
                        </div>
                        {!showAnswer ? (
                          <button onClick={() => setShowAnswer(true)} className="self-start rounded-lg border border-violet-300 bg-white px-4 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-500/30 dark:bg-gray-800 dark:text-violet-300">
                            👁 Visa svar
                          </button>
                        ) : (
                          <>
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Svar</span>
                              <p className="mt-0.5 text-[13px] text-app-text dark:text-gray-200" dangerouslySetInnerHTML={{ __html: mdToHtml(current.answer) }} />
                            </div>
                            <div className="flex gap-2 justify-end">
                              <button onClick={goNext} className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-medium text-app-text-secondary hover:bg-app-border/40">
                                {quizIndex + 1 < quizItems.length ? 'Hoppa över →' : 'Avsluta'}
                              </button>
                              <button onClick={handleSaveCurrent} className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-violet-700">
                                💾 Spara & Nästa {quizIndex + 1 < quizItems.length ? `(${quizIndex + 1}/${quizItems.length})` : ''}
                              </button>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
            <input value={title} readOnly={locked} onChange={(e) => setTitle(e.target.value)} placeholder={t.mTiPh} className="border-b border-app-border px-3 py-3 text-base font-bold text-app-text outline-none dark:border-white/10 dark:bg-transparent dark:text-gray-100 sm:px-4 sm:py-3.5 sm:text-lg" />
            <div className="flex-1 overflow-y-auto">
              <RichTextEditor html={html} onChange={setHtml} placeholder="" editable={!locked} minHeight="180px" resizable onLockedTripleClick={() => setLocked(false)} />
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border bg-app-bg px-3 py-2 dark:border-white/10 dark:bg-white/5 sm:px-4">
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-0">
              <span className="text-[10px] text-app-text-secondary/60 dark:text-gray-500">{lang === 'sv' ? 'Skapad' : 'Created'}: {note.date}</span>
              {note.lastEdited && <span className="text-[10px] text-app-text-secondary/50 dark:text-gray-600">{lang === 'sv' ? 'Uppdaterad' : 'Updated'}: {note.lastEdited}</span>}
            </div>
            <CloudSaveIndicator size="xs" />
            {lastSavedAt && (
              <span className="text-[10px] text-app-text-secondary/50 dark:text-gray-600">
                {lang === 'sv' ? 'Senast' : 'Last'}: {lastSavedAt}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => { trash(note.id); show(t.tMoved); onClose(); }} className="flex items-center gap-1.5 rounded-lg border border-app-border px-3 py-1.5 text-xs font-medium text-app-text-secondary hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-white/10">
              🗑 {t.mDel}
            </button>
            <button
              onClick={() => {
                const text = html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
                navigator.clipboard.writeText((title ? title + '\n\n' : '') + text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
              }}
              className={'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ' + (copied ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300' : 'border-app-border text-app-text-secondary hover:border-primary/40 hover:bg-primary/5 hover:text-primary dark:border-white/10 dark:text-gray-400')}
            >
              {copied ? '✓ Copied!' : `📋 ${t.mCopy}`}
            </button>
            <button
              onClick={() => { setManualQuiz((o) => !o); setAiMode(false); setAiQ(''); setAiA(''); setQuizOpen(false); }}
              className={'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ' + (manualQuiz ? 'border-emerald-400 bg-emerald-100 text-emerald-800 dark:border-emerald-500/50 dark:bg-emerald-500/20 dark:text-emerald-300' : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300')}
            >
              ✏️ {t.mAddQ}
            </button>
            {hasAi && (
            <button
              onClick={() => { setAiMode((o) => !o); setManualQuiz(false); setManualQ(''); setManualA(''); setQuizOpen(false); }}
              className={'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ' + (aiMode ? 'border-violet-400 bg-violet-100 text-violet-800 dark:border-violet-500/50 dark:bg-violet-500/20 dark:text-violet-300' : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300')}
            >
              🤖 AI Fråga
            </button>
            )}
            {note.archived ? (
              <button onClick={() => { unarchive(note.id); show(t.tUnarch); onClose(); }} className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10">
                ↩ {t.mUnarch}
              </button>
            ) : (
              <>
                <button onClick={handleArchive} className="flex items-center gap-1.5 rounded-lg border border-app-border px-3 py-1.5 text-xs font-medium text-app-text-secondary hover:border-primary/40 hover:bg-primary/5 hover:text-primary dark:border-white/10 dark:text-gray-400">
                  🗄 {t.mArchive}
                </button>
                {note.read ? (
                  <button onClick={markUndone} className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10">
                    ↩ {t.mUndone}
                  </button>
                ) : (
                  <button onClick={markDone} className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                    ✓ {t.mDone}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
