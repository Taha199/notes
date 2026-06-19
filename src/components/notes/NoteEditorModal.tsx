import { useEffect, useState } from 'react';
import { useNotes } from '../../contexts/NotesContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useToast } from '../../contexts/ToastContext';
import { RichTextEditor } from './RichTextEditor';
import { generateQuiz, answerQuestion, type QuizResult } from '../../lib/gemini';
import type { Page } from '../../types';

function mdToHtml(content: string): string {
  // Only convert if content looks like markdown (not already HTML)
  if (/<[a-z][\s\S]*>/i.test(content)) return content;
  return content
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

export function NoteEditorModal({ noteId, onClose, onNavigate }: { noteId: number; onClose: () => void; onNavigate?: (page: Page) => void }) {
  const { notes, updateNote, toggleFav, trash, archive, unarchive, nowStr, addQuiz } = useNotes();
  const { t } = useLanguage();
  const { show } = useToast();
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
  const [mcqMode, setMcqMode] = useState(false);
  const [mcqOptions, setMcqOptions] = useState(['', '', '', '']);
  const [mcqCorrect, setMcqCorrect] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setHtml(mdToHtml(note.html));
      setLocked(!!note.read);
    }
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!note) return null;

  const plainText = html.replace(/<[^>]*>/g, '').trim();
  const current = quizItems[quizIndex];

  const save = () => {
    if (!plainText) { show(t.tCantEmpty); return; }
    updateNote(note.id, { title: title.trim(), html, text: plainText, lastEdited: nowStr() });
    setLocked(true);
    show(t.tSaved);
  };

  const markDone = () => {
    updateNote(note.id, { read: true, archived: true });
    show(t.tStudied);
    onNavigate?.('read');
    onClose();
  };

  const handleArchive = () => {
    archive(note.id);
    show(t.tArched);
    onNavigate?.('archive');
    onClose();
  };

  const handleGenerateQuiz = async () => {
    setQuizOpen(true);
    setQuizItems([]);
    setQuizIndex(0);
    setShowAnswer(false);
    setQuizError('');
    setSavedCount(0);
    setQuizLoading(true);
    try {
      const results = await generateQuiz(note.text || plainText);
      setQuizItems(results);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setQuizError(msg === 'INSUFFICIENT_CONTENT' ? 'Innehållet är inte tillräckligt för att generera frågor.' : 'Det gick inte att generera frågor. Försök igen.');
    } finally {
      setQuizLoading(false);
    }
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
      <div className="flex max-h-[96dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-app-border bg-white shadow-2xl dark:border-white/10 dark:bg-gray-900 sm:max-h-[92vh] sm:rounded-3xl" style={{ animation: 'slideUp .22s cubic-bezier(.34,1.56,.64,1)' }}>
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

        <input value={title} readOnly={locked} onChange={(e) => setTitle(e.target.value)} placeholder={t.mTiPh} className="border-b border-app-border px-3 py-3 text-base font-bold text-app-text outline-none dark:border-white/10 dark:bg-transparent dark:text-gray-100 sm:px-4 sm:py-3.5 sm:text-lg" />

        <div className="flex-1 overflow-y-auto">
          <RichTextEditor html={html} onChange={setHtml} placeholder="" editable={!locked} minHeight="150px" />
        </div>

        {/* Manual quiz panel */}
        {manualQuiz && (
          <div className="border-t border-emerald-200 bg-emerald-50 px-4 py-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[13px] font-bold text-emerald-700 dark:text-emerald-400">✏️ Skapa fråga manuellt</span>
              <button onClick={() => { setManualQuiz(false); setManualQ(''); setManualA(''); }} className="text-[11px] text-app-text-secondary hover:text-app-text">✕ Stäng</button>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-emerald-700/70 dark:text-emerald-400/70">Fråga</label>
                <textarea
                  value={manualQ}
                  onChange={(e) => setManualQ(e.target.value)}
                  rows={2}
                  placeholder="Skriv din fråga..."
                  className="w-full resize-none rounded-xl border border-app-border bg-white px-3 py-2 text-[13px] text-app-text outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 dark:border-white/10 dark:bg-gray-800 dark:text-gray-100"
                />
                <button
                  onClick={() => setManualQ(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim())}
                  className="mt-1.5 flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition-all hover:bg-emerald-50 dark:border-emerald-500/30 dark:bg-gray-800 dark:text-emerald-300"
                >
                  📋 Paste note
                </button>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-emerald-700/70 dark:text-emerald-400/70">Svar</label>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => { setMcqMode((m) => !m); setManualA(''); setMcqOptions(['', '', '', '']); setMcqCorrect(0); }}
                      className={'flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all ' + (mcqMode ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300' : 'border-app-border bg-white text-app-text-secondary hover:border-blue-300 hover:text-blue-700 dark:border-white/10 dark:bg-gray-800 dark:text-gray-400')}
                    >
                      ☰ MCQ
                    </button>
                    {!mcqMode && (
                      <button
                        onClick={async () => {
                          if (!manualQ.trim()) return;
                          setManualAiLoading(true);
                          try { setManualA(await answerQuestion(manualQ)); }
                          finally { setManualAiLoading(false); }
                        }}
                        disabled={manualAiLoading || !manualQ.trim()}
                        className="flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 transition-all hover:bg-violet-100 disabled:opacity-40 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300"
                      >
                        {manualAiLoading ? <span className="animate-spin">⏳</span> : '🧠'} AI-svar
                      </button>
                    )}
                  </div>
                </div>

                {mcqMode ? (
                  <div className="flex flex-col gap-2">
                    {mcqOptions.map((opt, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <button
                          onClick={() => setMcqCorrect(i)}
                          className={'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-all ' + (mcqCorrect === i ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-app-border bg-white text-app-text-secondary dark:border-white/20 dark:bg-gray-800')}
                          title="Mark as correct"
                        >
                          {mcqCorrect === i ? '✓' : String.fromCharCode(65 + i)}
                        </button>
                        <input
                          value={opt}
                          onChange={(e) => { const o = [...mcqOptions]; o[i] = e.target.value; setMcqOptions(o); }}
                          placeholder={`Option ${String.fromCharCode(65 + i)}...`}
                          className={'flex-1 rounded-xl border px-3 py-2 text-[13px] text-app-text outline-none transition-all dark:bg-gray-800 dark:text-gray-100 ' + (mcqCorrect === i ? 'border-emerald-400 bg-emerald-50 focus:ring-2 focus:ring-emerald-200 dark:border-emerald-500/40 dark:bg-emerald-500/10' : 'border-app-border bg-white focus:border-primary/50 focus:ring-2 focus:ring-primary/10 dark:border-white/10')}
                        />
                        {mcqOptions.length > 2 && (
                          <button
                            onClick={() => {
                              const o = mcqOptions.filter((_, j) => j !== i);
                              setMcqOptions(o);
                              if (mcqCorrect >= o.length) setMcqCorrect(0);
                              else if (mcqCorrect > i) setMcqCorrect(mcqCorrect - 1);
                            }}
                            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] text-app-text-secondary/40 hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-500/10"
                            title="Remove option"
                          >✕</button>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      {mcqOptions.length < 6 && (
                        <button
                          onClick={() => setMcqOptions([...mcqOptions, ''])}
                          className="flex items-center gap-1 rounded-lg border border-dashed border-app-border px-3 py-1.5 text-[11px] font-medium text-app-text-secondary/60 transition-all hover:border-primary/40 hover:text-primary dark:border-white/10"
                        >
                          + Add option
                        </button>
                      )}
                      <p className="text-[10px] text-app-text-secondary/50 dark:text-gray-600">Click circle = correct answer</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <textarea
                      value={manualA}
                      onChange={(e) => setManualA(e.target.value)}
                      rows={3}
                      placeholder="Skriv svaret..."
                      className="w-full resize-none rounded-xl border border-app-border bg-white px-3 py-2 text-[13px] text-app-text outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 dark:border-white/10 dark:bg-gray-800 dark:text-gray-100"
                    />
                    <button
                      onClick={() => setManualA(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim())}
                      className="mt-1.5 flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition-all hover:bg-emerald-50 dark:border-emerald-500/30 dark:bg-gray-800 dark:text-emerald-300"
                    >
                      📋 Paste note
                    </button>
                  </>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => { setManualQuiz(false); setManualQ(''); setManualA(''); setMcqMode(false); setMcqOptions(['', '', '', '']); setMcqCorrect(0); }} className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-medium text-app-text-secondary hover:bg-app-border/40">
                  Avbryt
                </button>
                <button
                  onClick={() => {
                    if (!manualQ.trim()) return;
                    let answer = manualA.trim();
                    if (mcqMode) {
                      const filled = mcqOptions.filter((o) => o.trim());
                      if (filled.length < 2) return;
                      answer = mcqOptions.map((o, i) => `${String.fromCharCode(65 + i)}) ${o.trim()}${i === mcqCorrect ? ' ✓' : ''}`).filter((_, i) => mcqOptions[i].trim()).join('\n');
                    }
                    addQuiz({ noteId: note.id, noteTitle: note.title || note.text.slice(0, 50), question: manualQ.trim(), answer, date: nowStr() });
                    show('Fråga sparad i Quiz 🧠');
                    setManualQ(''); setManualA(''); setMcqOptions(['', '', '', '']); setMcqCorrect(0);
                  }}
                  disabled={!manualQ.trim() || (mcqMode && mcqOptions.filter((o) => o.trim()).length < 2)}
                  className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  💾 Spara fråga
                </button>
              </div>
            </div>
          </div>
        )}

        {/* AI Quiz panel */}
        {quizOpen && (
          <div className="border-t border-violet-200 bg-violet-50 px-4 py-4 dark:border-violet-500/20 dark:bg-violet-500/10">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[13px] font-bold text-violet-700 dark:text-violet-300">
                🧠 Quiz
                {quizItems.length > 0 && <span className="ml-2 text-[11px] font-normal opacity-70">{quizIndex + 1} / {quizItems.length}</span>}
              </span>
              <button onClick={() => setQuizOpen(false)} className="text-[11px] text-app-text-secondary hover:text-app-text">✕ Stäng</button>
            </div>

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
                      <textarea
                        value={editQ}
                        onChange={(e) => setEditQ(e.target.value)}
                        rows={3}
                        className="w-full resize-none rounded-xl border border-app-border bg-white px-3 py-2 text-[13px] text-app-text outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 dark:border-white/10 dark:bg-gray-800 dark:text-gray-100"
                      />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60">Svar</label>
                        <button
                          onClick={async () => {
                            if (!editQ.trim()) return;
                            setAiAnswerLoading(true);
                            try { setEditA(await answerQuestion(editQ)); }
                            finally { setAiAnswerLoading(false); }
                          }}
                          disabled={aiAnswerLoading || !editQ.trim()}
                          className="flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 transition-all hover:bg-violet-100 disabled:opacity-40 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300"
                        >
                          {aiAnswerLoading ? <span className="animate-spin">⏳</span> : '🧠'} AI-svar
                        </button>
                      </div>
                      <textarea
                        value={editA}
                        onChange={(e) => setEditA(e.target.value)}
                        rows={4}
                        className="w-full resize-none rounded-xl border border-app-border bg-white px-3 py-2 text-[13px] text-app-text outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 dark:border-white/10 dark:bg-gray-800 dark:text-gray-100"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingQuiz(false)} className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-medium text-app-text-secondary hover:bg-app-border/40">
                        Avbryt
                      </button>
                      <button
                        onClick={() => {
                          if (!editQ.trim()) return;
                          const updated = quizItems.map((item, i) => i === quizIndex ? { question: editQ.trim(), answer: editA.trim() } : item);
                          setQuizItems(updated);
                          setEditingQuiz(false);
                          setShowAnswer(true);
                        }}
                        className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
                      >
                        ✓ Klar
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── View mode ── */
                  <>
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <p className="text-[14px] font-semibold text-app-text dark:text-gray-100" dangerouslySetInnerHTML={{ __html: mdToHtml(current.question) }} />
                      <button
                        onClick={() => { setEditQ(current.question); setEditA(current.answer); setEditingQuiz(true); setShowAnswer(true); }}
                        title="Redigera"
                        className="flex-shrink-0 rounded-lg border border-app-border px-2 py-1 text-[11px] text-app-text-secondary hover:border-primary/40 hover:text-primary dark:border-white/10"
                      >
                        ✏️ Redigera
                      </button>
                    </div>
                    {!showAnswer ? (
                      <button onClick={() => setShowAnswer(true)} className="rounded-lg border border-violet-300 bg-white px-4 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-500/30 dark:bg-gray-800 dark:text-violet-300">
                        👁 Visa svar
                      </button>
                    ) : (
                      <>
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Svar</span>
                            <button
                              onClick={async () => {
                                setAiAnswerLoading(true);
                                try {
                                  const ans = await answerQuestion(current.question);
                                  setQuizItems((prev) => prev.map((item, i) => i === quizIndex ? { ...item, answer: ans } : item));
                                } finally { setAiAnswerLoading(false); }
                              }}
                              disabled={aiAnswerLoading}
                              className="flex items-center gap-1 rounded-lg border border-violet-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-40 dark:border-violet-500/30 dark:bg-gray-800 dark:text-violet-300"
                            >
                              {aiAnswerLoading ? <span className="animate-spin">⏳</span> : '🧠'} AI-svar
                            </button>
                          </div>
                          <p className="mt-0.5 text-[13px] text-app-text dark:text-gray-200" dangerouslySetInnerHTML={{ __html: mdToHtml(current.answer) }} />
                        </div>
                        <div className="mt-2.5 flex gap-2 justify-end">
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
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border bg-app-bg px-3 py-3 dark:border-white/10 dark:bg-white/5 sm:px-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-app-text-secondary/80 dark:text-gray-500">{note.date}</span>
            {note.lastEdited && <span className="text-[10px] text-app-text-secondary/60 dark:text-gray-600">Edited: {note.lastEdited}</span>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => {
                const text = html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
                navigator.clipboard.writeText((title ? title + '\n\n' : '') + text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
              }}
              className={'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ' + (copied ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300' : 'border-app-border text-app-text-secondary hover:border-primary/40 hover:bg-primary/5 hover:text-primary dark:border-white/10 dark:text-gray-400')}
            >
              {copied ? '✓ Copied!' : `📋 ${t.mCopy}`}
            </button>
            <button onClick={handleGenerateQuiz} className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300">
              🧠 {t.mGenQuiz}
            </button>
            <button onClick={() => { setManualQuiz((o) => !o); setQuizOpen(false); }} className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
              ✏️ {t.mAddQ}
            </button>
            <button onClick={() => { trash(note.id); show(t.tMoved); onClose(); }} className="flex items-center gap-1.5 rounded-lg border border-app-border px-3 py-1.5 text-xs font-medium text-app-text-secondary hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-white/10">
              🗑 {t.mDel}
            </button>
            {note.archived ? (
              <button onClick={() => { unarchive(note.id); show(t.tUnarch); onClose(); }} className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10">
                ↩ {t.mUnarch}
              </button>
            ) : (
              <>
                <button onClick={handleArchive} className="flex items-center gap-1.5 rounded-lg border border-app-border px-3 py-1.5 text-xs font-medium text-app-text-secondary hover:border-primary/40 hover:bg-primary/5 hover:text-primary dark:border-white/10 dark:text-gray-400">
                  🗄 {t.mArchive}
                </button>
                <button onClick={markDone} className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                  ✓ {t.mDone}
                </button>
              </>
            )}
            {!locked && (
              <button onClick={save} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white shadow-sm shadow-primary/30 hover:bg-primary-dark">
                💾 {t.mSave}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
