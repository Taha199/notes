import { useEffect, useState } from 'react';
import { useNotes } from '../../contexts/NotesContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useToast } from '../../contexts/ToastContext';
import { RichTextEditor } from './RichTextEditor';
import { generateQuiz } from '../../lib/gemini';

export function NoteEditorModal({ noteId, onClose }: { noteId: number; onClose: () => void }) {
  const { notes, updateNote, toggleFav, trash, unarchive, nowStr, addQuiz } = useNotes();
  const { t } = useLanguage();
  const { show } = useToast();
  const note = notes.find((n) => n.id === noteId);
  const [locked, setLocked] = useState(true);
  const [title, setTitle] = useState(note?.title ?? '');
  const [html, setHtml] = useState(note?.html ?? '');

  // Quiz state
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizQuestion, setQuizQuestion] = useState('');
  const [quizAnswer, setQuizAnswer] = useState('');
  const [showAnswer, setShowAnswer] = useState(false);
  const [quizError, setQuizError] = useState('');

  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setHtml(note.html);
      setLocked(true);
    }
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!note) return null;

  const plainText = html.replace(/<[^>]*>/g, '').trim();

  const save = () => {
    if (!plainText) {
      show(t.tCantEmpty);
      return;
    }
    updateNote(note.id, { title: title.trim(), html, text: plainText, lastEdited: nowStr() });
    setLocked(true);
    show(t.tSaved);
  };

  const markDone = () => {
    updateNote(note.id, { read: true, archived: true });
    setLocked(true);
    show(t.tStudied);
  };

  const handleGenerateQuiz = async () => {
    setQuizOpen(true);
    setQuizQuestion('');
    setQuizAnswer('');
    setQuizError('');
    setShowAnswer(false);
    setQuizLoading(true);
    try {
      const result = await generateQuiz(note.text || plainText);
      setQuizQuestion(result.question);
      setQuizAnswer(result.answer);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'INSUFFICIENT_CONTENT') {
        setQuizError('المحتوى غير كافٍ لإنشاء سؤال واضح.');
      } else {
        setQuizError(msg || 'Failed to generate question.');
      }
    } finally {
      setQuizLoading(false);
    }
  };

  const handleSaveQuiz = () => {
    addQuiz({
      noteId: note.id,
      noteTitle: note.title || note.text.slice(0, 50),
      question: quizQuestion,
      answer: quizAnswer,
      date: nowStr(),
    });
    show('Quiz saved! 🧠');
    setQuizOpen(false);
    setQuizQuestion('');
    setQuizAnswer('');
    setShowAnswer(false);
  };

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-gray-900/45 p-2 backdrop-blur-sm sm:p-4">
      <div className="flex max-h-[96dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-app-border bg-white shadow-2xl dark:border-white/10 dark:bg-gray-900 sm:max-h-[92vh] sm:rounded-3xl" style={{ animation: 'slideUp .22s cubic-bezier(.34,1.56,.64,1)' }}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-border bg-app-bg px-3 py-3 dark:border-white/10 dark:bg-white/5 sm:px-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              onClick={() => setLocked((l) => !l)}
              className={
                'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ' +
                (locked ? 'border-primary/40 bg-primary/10 text-primary' : 'border-app-border text-app-text-secondary hover:border-primary/40 hover:text-primary')
              }
            >
              {locked ? '🔒' : '🔓'} {locked ? t.locked : t.editing}
            </button>
            {note.archived && note.read && (
              <span className="flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
                ✓ {t.archPill}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => toggleFav(note.id)}
              className={
                'flex h-8 w-8 items-center justify-center rounded-lg border text-sm transition-all ' +
                (note.fav ? 'border-amber-300 bg-amber-50 text-amber-600' : 'border-app-border text-app-text-secondary hover:border-amber-300 hover:text-amber-600')
              }
            >
              ★
            </button>
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-app-text-secondary hover:bg-app-border/60 dark:hover:bg-white/10">
              ✕
            </button>
          </div>
        </div>

        <input
          value={title}
          readOnly={locked}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t.mTiPh}
          className="border-b border-app-border px-3 py-3 text-base font-bold text-app-text outline-none dark:border-white/10 dark:bg-transparent dark:text-gray-100 sm:px-4 sm:py-3.5 sm:text-lg"
        />

        <div className="flex-1 overflow-y-auto">
          <RichTextEditor html={html} onChange={setHtml} placeholder="" editable={!locked} minHeight="150px" />
        </div>

        {/* Quiz panel */}
        {quizOpen && (
          <div className="border-t border-violet-200 bg-violet-50 px-4 py-4 dark:border-violet-500/20 dark:bg-violet-500/10">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[13px] font-bold text-violet-700 dark:text-violet-300">🧠 Quiz Question</span>
              <button onClick={() => setQuizOpen(false)} className="text-[11px] text-app-text-secondary hover:text-app-text">✕ Close</button>
            </div>
            {quizLoading && (
              <div className="flex items-center gap-2 text-[13px] text-violet-600 dark:text-violet-400">
                <span className="animate-spin">⏳</span> Generating question...
              </div>
            )}
            {quizError && <p className="text-[13px] text-red-600">{quizError}</p>}
            {quizQuestion && !quizLoading && (
              <>
                <p className="mb-3 text-[14px] font-semibold text-app-text dark:text-gray-100">{quizQuestion}</p>
                {!showAnswer ? (
                  <button
                    onClick={() => setShowAnswer(true)}
                    className="rounded-lg border border-violet-300 bg-white px-4 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-500/30 dark:bg-gray-800 dark:text-violet-300"
                  >
                    👁 Show Answer
                  </button>
                ) : (
                  <>
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Answer</span>
                      <p className="mt-0.5 text-[13px] text-app-text dark:text-gray-200">{quizAnswer}</p>
                    </div>
                    <div className="mt-2 flex justify-end">
                      <button
                        onClick={handleSaveQuiz}
                        className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-violet-700"
                      >
                        💾 Save to Quiz
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border bg-app-bg px-3 py-3 dark:border-white/10 dark:bg-white/5 sm:px-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-app-text-secondary/80 dark:text-gray-500">{note.date}</span>
            {note.lastEdited && (
              <span className="text-[10px] text-app-text-secondary/60 dark:text-gray-600">Edited: {note.lastEdited}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={handleGenerateQuiz}
              className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300"
            >
              🧠 Generate Quiz
            </button>
            <button
              onClick={() => {
                trash(note.id);
                show(t.tMoved);
                onClose();
              }}
              className="flex items-center gap-1.5 rounded-lg border border-app-border px-3 py-1.5 text-xs font-medium text-app-text-secondary hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-white/10"
            >
              🗑 {t.mDel}
            </button>
            {note.archived && (
              <button
                onClick={() => {
                  unarchive(note.id);
                  show(t.tUnarch);
                }}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10"
              >
                ↩ {t.mUnarch}
              </button>
            )}
            {!note.archived && (
              <button onClick={markDone} className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                ✓ {t.mDone}
              </button>
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
