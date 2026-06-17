import { useState } from 'react';
import { useNotes } from '../../contexts/NotesContext';
import { RichTextEditor } from '../notes/RichTextEditor';

function speak(text: string) {
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'sv-SE';
  window.speechSynthesis.speak(u);
}

export function QuizPage() {
  const { quizzes, deleteQuiz, updateQuiz } = useNotes();
  const [favs, setFavs] = useState<Set<number>>(new Set());
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editQ, setEditQ] = useState('');
  const [editA, setEditA] = useState('');

  const toggleFav = (id: number) => {
    setFavs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const startEdit = (id: number, question: string, answer: string) => {
    setEditingId(id);
    setEditQ(question);
    setEditA(answer);
  };

  const saveEdit = () => {
    if (editingId === null) return;
    const plainQ = editQ.replace(/<[^>]*>/g, '').trim();
    const plainA = editA.replace(/<[^>]*>/g, '').trim();
    if (!plainQ || !plainA) return;
    updateQuiz(editingId, { question: editQ, answer: editA });
    setEditingId(null);
  };

  if (!quizzes.length) {
    return (
      <div className="animate-fade-in flex flex-col items-center py-20 text-center text-app-text-secondary/70 dark:text-gray-500">
        <span className="mb-3 text-5xl opacity-30">🧠</span>
        <p className="text-sm">Inga frågor ännu.<br />Öppna en anteckning och klicka på <strong>Generate Quiz</strong>.</p>
      </div>
    );
  }

  return (
    <div className="px-3 py-4 sm:px-5 sm:py-5">
      <div className="mb-3 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">
        🧠 Quiz — {quizzes.length} {quizzes.length === 1 ? 'fråga' : 'frågor'}
      </div>
      <div className="flex flex-col gap-2">
        {quizzes.map((q) => (
          <div key={q.id} className="group overflow-hidden rounded-2xl border border-app-border bg-white shadow-sm transition-all hover:shadow-md dark:border-white/10 dark:bg-[#1e1e2e]">
            {editingId === q.id ? (
              /* Edit mode */
              <div className="flex flex-col gap-3 p-4">
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60">Fråga</p>
                  <div className="overflow-hidden rounded-xl border border-app-border dark:border-white/10">
                    <RichTextEditor html={editQ} onChange={setEditQ} placeholder="Fråga..." minHeight="60px" />
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60">Svar</p>
                  <div className="overflow-hidden rounded-xl border border-app-border dark:border-white/10">
                    <RichTextEditor html={editA} onChange={setEditA} placeholder="Svar..." minHeight="60px" />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setEditingId(null)} className="rounded-lg border border-app-border px-3 py-1.5 text-xs text-app-text-secondary hover:bg-app-border/40">
                    Avbryt
                  </button>
                  <button onClick={saveEdit} className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark">
                    Spara
                  </button>
                </div>
              </div>
            ) : (
              /* View mode */
              <div className="flex items-stretch">
                {/* Left — Question */}
                <div className="flex flex-1 items-center px-4 py-4">
                  <span
                    className="text-[13px] font-semibold text-app-text dark:text-gray-100 leading-snug"
                    dangerouslySetInnerHTML={{ __html: q.question }}
                  />
                </div>

                {/* Divider */}
                <div className="w-px flex-shrink-0 bg-app-border dark:bg-white/10" />

                {/* Right — Answer */}
                <div className="flex w-1/2 flex-shrink-0 items-center px-4 py-4">
                  <span
                    className="text-[13px] text-app-text-secondary dark:text-gray-400 leading-snug"
                    dangerouslySetInnerHTML={{ __html: q.answer }}
                  />
                </div>

                {/* Actions */}
                <div className="flex flex-shrink-0 flex-col items-center justify-between gap-2 px-3 py-3">
                  <button onClick={() => toggleFav(q.id)} className={'text-base transition-colors ' + (favs.has(q.id) ? 'text-amber-400' : 'text-app-text-secondary/40 hover:text-amber-400')} title="Favorit">★</button>
                  <button
                    onClick={() => {
                      if (speakingId === q.id) {
                        window.speechSynthesis.cancel();
                        setSpeakingId(null);
                      } else {
                        window.speechSynthesis.cancel();
                        setSpeakingId(q.id);
                        const u = new SpeechSynthesisUtterance(q.question.replace(/<[^>]*>/g, '') + '. ' + q.answer.replace(/<[^>]*>/g, ''));
                        u.lang = 'sv-SE';
                        u.onend = () => setSpeakingId(null);
                        window.speechSynthesis.speak(u);
                      }
                    }}
                    className={'transition-colors ' + (speakingId === q.id ? 'text-primary' : 'text-app-text-secondary/40 hover:text-primary')}
                    title={speakingId === q.id ? 'Stoppa' : 'Läs upp'}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                    </svg>
                  </button>
                  <button onClick={() => startEdit(q.id, q.question, q.answer)} className="text-[11px] text-app-text-secondary/40 transition-colors hover:text-primary" title="Redigera">✏️</button>
                  <button onClick={() => deleteQuiz(q.id)} className="text-[11px] text-app-text-secondary/30 transition-colors hover:text-red-500" title="Ta bort">✕</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
