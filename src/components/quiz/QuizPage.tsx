import { useState } from 'react';
import { useNotes } from '../../contexts/NotesContext';
import { RichTextEditor } from '../notes/RichTextEditor';
import { answerQuestion } from '../../lib/gemini';
import type { QuizItem, QuizSet } from '../../types';

function mdToHtml(content: string): string {
  if (/<[a-z][\s\S]*>/i.test(content)) return content;
  return content
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

interface QuizItemRowProps {
  item: QuizItem;
  onEdit: (item: QuizItem) => void;
  onDelete: () => void;
  speakingId: number | null;
  onSpeak: (id: number) => void;
  favs: Set<number>;
  onToggleFav: (id: number) => void;
}

function QuizItemRow({ item, onEdit, onDelete, speakingId, onSpeak, favs, onToggleFav }: QuizItemRowProps) {
  return (
    <div className="group overflow-hidden rounded-2xl border border-app-border bg-white shadow-sm transition-all hover:shadow-md dark:border-white/10 dark:bg-[#1e1e2e]">
      <div className="flex items-stretch">
        <div className="flex flex-1 items-center px-4 py-4">
          <span className="text-[13px] font-semibold text-app-text dark:text-gray-100 leading-snug" dangerouslySetInnerHTML={{ __html: mdToHtml(item.question) }} />
        </div>
        <div className="w-px flex-shrink-0 bg-app-border dark:bg-white/10" />
        <div className="flex w-1/2 flex-shrink-0 items-center px-4 py-4">
          <span className="text-[13px] text-app-text-secondary dark:text-gray-400 leading-snug" dangerouslySetInnerHTML={{ __html: mdToHtml(item.answer) }} />
        </div>
        <div className="flex flex-shrink-0 flex-col items-center justify-between gap-2 px-3 py-3">
          <button onClick={() => onToggleFav(item.id)} className={'text-base transition-colors ' + (favs.has(item.id) ? 'text-amber-400' : 'text-app-text-secondary/40 hover:text-amber-400')} title="Favorit">★</button>
          <button
            onClick={() => onSpeak(item.id)}
            className={'transition-colors ' + (speakingId === item.id ? 'text-primary' : 'text-app-text-secondary/40 hover:text-primary')}
            title={speakingId === item.id ? 'Stoppa' : 'Läs upp'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
          </button>
          <button onClick={() => onEdit(item)} className="text-[11px] text-app-text-secondary/40 transition-colors hover:text-primary" title="Redigera">✏️</button>
          <button onClick={onDelete} className="text-[11px] text-app-text-secondary/30 transition-colors hover:text-red-500" title="Ta bort">✕</button>
        </div>
      </div>
    </div>
  );
}

interface EditPanelProps {
  question: string;
  answer: string;
  onChangeQ: (v: string) => void;
  onChangeA: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function EditPanel({ question, answer, onChangeQ, onChangeA, onSave, onCancel }: EditPanelProps) {
  const [aiLoading, setAiLoading] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-app-border bg-white shadow-sm dark:border-white/10 dark:bg-[#1e1e2e]">
      <div className="flex flex-col gap-3 p-4">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60">Fråga</p>
            <button
              onClick={async () => {
                const plain = question.replace(/<[^>]*>/g, '').trim();
                if (!plain) return;
                setAiLoading(true);
                try { onChangeA(await answerQuestion(plain)); } finally { setAiLoading(false); }
              }}
              disabled={aiLoading || !question.replace(/<[^>]*>/g, '').trim()}
              className="flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 transition-all hover:bg-violet-100 disabled:opacity-40 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300"
            >
              {aiLoading ? <span className="animate-spin">⏳</span> : '🧠'} AI-svar
            </button>
          </div>
          <div className="overflow-hidden rounded-xl border border-app-border dark:border-white/10">
            <RichTextEditor html={question} onChange={onChangeQ} placeholder="Fråga..." minHeight="60px" />
          </div>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60">Svar</p>
          <div className="overflow-hidden rounded-xl border border-app-border dark:border-white/10">
            <RichTextEditor html={answer} onChange={onChangeA} placeholder="Svar..." minHeight="60px" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-app-border px-3 py-1.5 text-xs text-app-text-secondary hover:bg-app-border/40">Avbryt</button>
          <button onClick={onSave} className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark">Spara</button>
        </div>
      </div>
    </div>
  );
}

export function QuizPage() {
  const { quizzes, quizSets, deleteQuiz, updateQuiz, addQuizSet, deleteQuizSet, renameQuizSet, addItemToSet, removeItemFromSet, updateItemInSet } = useNotes();

  const [selectedSetId, setSelectedSetId] = useState<string | null>(null); // null = all questions
  const [favs, setFavs] = useState<Set<number>>(new Set());
  const [speakingId, setSpeakingId] = useState<number | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editQ, setEditQ] = useState('');
  const [editA, setEditA] = useState('');

  // New question panel (for sets)
  const [addingQuestion, setAddingQuestion] = useState(false);
  const [newQ, setNewQ] = useState('');
  const [newA, setNewA] = useState('');

  // New set creation
  const [creatingSet, setCreatingSet] = useState(false);
  const [newSetName, setNewSetName] = useState('');

  // Rename set
  const [renamingSetId, setRenamingSetId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');

  const toggleFav = (id: number) => setFavs((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleSpeak = (id: number) => {
    const item = selectedSet ? selectedSet.items.find((i) => i.id === id) : quizzes.find((q) => q.id === id);
    if (!item) return;
    if (speakingId === id) { window.speechSynthesis.cancel(); setSpeakingId(null); return; }
    window.speechSynthesis.cancel();
    setSpeakingId(id);
    const u = new SpeechSynthesisUtterance(item.question.replace(/<[^>]*>/g, '') + '. ' + item.answer.replace(/<[^>]*>/g, ''));
    u.lang = navigator.language || 'sv-SE';
    u.onend = () => setSpeakingId(null);
    window.speechSynthesis.speak(u);
  };

  const startEdit = (item: QuizItem) => { setEditingId(item.id); setEditQ(item.question); setEditA(item.answer); };

  const saveEdit = () => {
    if (editingId === null) return;
    if (!editQ.replace(/<[^>]*>/g, '').trim() || !editA.replace(/<[^>]*>/g, '').trim()) return;
    if (selectedSetId) updateItemInSet(selectedSetId, editingId, { question: editQ, answer: editA });
    else updateQuiz(editingId, { question: editQ, answer: editA });
    setEditingId(null);
  };

  const saveNewQuestion = () => {
    if (!selectedSetId) return;
    if (!newQ.replace(/<[^>]*>/g, '').trim() || !newA.replace(/<[^>]*>/g, '').trim()) return;
    addItemToSet(selectedSetId, { noteId: 0, noteTitle: '', question: newQ, answer: newA, date: new Date().toLocaleDateString() });
    setNewQ(''); setNewA(''); setAddingQuestion(false);
  };

  const handleCreateSet = () => {
    const name = newSetName.trim();
    if (!name) return;
    const s = addQuizSet(name);
    setSelectedSetId(s.id);
    setNewSetName(''); setCreatingSet(false);
  };

  const selectedSet: QuizSet | undefined = quizSets.find((s) => s.id === selectedSetId);
  const displayItems: QuizItem[] = selectedSet ? selectedSet.items : quizzes;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="flex w-56 flex-shrink-0 flex-col border-r border-app-border bg-app-bg dark:border-white/10 dark:bg-gray-950">
        <div className="px-3 pt-4 pb-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60 dark:text-gray-500">Quiz</p>
        </div>

        {/* All Questions */}
        <button
          onClick={() => setSelectedSetId(null)}
          className={'mx-2 mb-0.5 flex items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-all ' +
            (selectedSetId === null ? 'bg-primary/10 text-primary dark:bg-primary/20' : 'text-app-text hover:bg-white dark:text-gray-300 dark:hover:bg-white/5')}
        >
          <span>🧠</span>
          <span className="flex-1 truncate">All Questions</span>
          <span className="text-[11px] text-app-text-secondary/60 dark:text-gray-500">{quizzes.length}</span>
        </button>

        {/* Sets */}
        {quizSets.length > 0 && (
          <div className="mt-2 px-3 pb-1">
            <p className="text-[9px] font-bold uppercase tracking-widest text-app-text-secondary/50 dark:text-gray-600">Sets</p>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-2">
          {quizSets.map((s) => (
            <div key={s.id} className="group mb-0.5">
              {renamingSetId === s.id ? (
                <div className="flex items-center gap-1 rounded-xl bg-white px-2 py-1.5 dark:bg-white/5">
                  <input
                    autoFocus
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { renameQuizSet(s.id, renameVal.trim() || s.name); setRenamingSetId(null); }
                      if (e.key === 'Escape') setRenamingSetId(null);
                    }}
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-app-text outline-none dark:text-gray-200"
                  />
                  <button onClick={() => { renameQuizSet(s.id, renameVal.trim() || s.name); setRenamingSetId(null); }} className="text-[10px] text-primary">✓</button>
                </div>
              ) : (
                <button
                  onClick={() => setSelectedSetId(s.id)}
                  className={'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-all ' +
                    (selectedSetId === s.id ? 'bg-primary/10 text-primary dark:bg-primary/20' : 'text-app-text hover:bg-white dark:text-gray-300 dark:hover:bg-white/5')}
                >
                  <span>📂</span>
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="text-[11px] text-app-text-secondary/60 dark:text-gray-500">{s.items.length}</span>
                  <span className="hidden gap-0.5 group-hover:flex">
                    <span
                      onClick={(e) => { e.stopPropagation(); setRenamingSetId(s.id); setRenameVal(s.name); }}
                      className="flex h-4 w-4 items-center justify-center rounded text-[9px] text-app-text-secondary/50 hover:bg-app-border hover:text-app-text"
                      title="Rename"
                    >✏️</span>
                    <span
                      onClick={(e) => { e.stopPropagation(); if (selectedSetId === s.id) setSelectedSetId(null); deleteQuizSet(s.id); }}
                      className="flex h-4 w-4 items-center justify-center rounded text-[9px] text-app-text-secondary/50 hover:bg-red-100 hover:text-red-500"
                      title="Delete"
                    >✕</span>
                  </span>
                </button>
              )}
            </div>
          ))}
        </div>

        {/* New Set */}
        <div className="border-t border-app-border p-2 dark:border-white/10">
          {creatingSet ? (
            <div className="flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/5 px-2.5 py-2">
              <input
                autoFocus
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateSet(); if (e.key === 'Escape') { setCreatingSet(false); setNewSetName(''); } }}
                placeholder="Set name..."
                className="min-w-0 flex-1 bg-transparent text-[12px] text-app-text outline-none placeholder:text-app-text-secondary/50 dark:text-gray-200"
              />
              <button onClick={handleCreateSet} className="text-[11px] font-semibold text-primary">✓</button>
              <button onClick={() => { setCreatingSet(false); setNewSetName(''); }} className="text-[11px] text-app-text-secondary/50">✕</button>
            </div>
          ) : (
            <button
              onClick={() => setCreatingSet(true)}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-medium text-app-text-secondary transition-all hover:bg-white hover:text-primary dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-primary"
            >
              <span className="text-base leading-none">+</span> New Set
            </button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-4 sm:px-5 sm:py-5">
          {/* Header */}
          <div className="mb-3 flex items-center justify-between px-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">
              {selectedSet ? `📂 ${selectedSet.name}` : '🧠 All Questions'} — {displayItems.length} {displayItems.length === 1 ? 'fråga' : 'frågor'}
            </span>
            {selectedSetId && (
              <button
                onClick={() => { setAddingQuestion(true); setNewQ(''); setNewA(''); }}
                className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-1.5 text-[12px] font-semibold text-primary transition-all hover:bg-primary/10"
              >
                ✏️ Add Question
              </button>
            )}
          </div>

          {/* New question panel */}
          {addingQuestion && selectedSetId && (
            <div className="mb-3">
              <EditPanel
                question={newQ}
                answer={newA}
                onChangeQ={setNewQ}
                onChangeA={setNewA}
                onSave={saveNewQuestion}
                onCancel={() => { setAddingQuestion(false); setNewQ(''); setNewA(''); }}
              />
            </div>
          )}

          {/* Empty state */}
          {displayItems.length === 0 && !addingQuestion && (
            <div className="animate-fade-in flex flex-col items-center py-20 text-center text-app-text-secondary/70 dark:text-gray-500">
              <span className="mb-3 text-5xl opacity-30">{selectedSetId ? '📂' : '🧠'}</span>
              {selectedSetId
                ? <p className="text-sm">This set is empty.<br />Click <strong>Add Question</strong> to get started.</p>
                : <p className="text-sm">Inga frågor ännu.<br />Öppna en anteckning och klicka på <strong>Generate Quiz</strong>.</p>}
            </div>
          )}

          {/* Questions list */}
          <div className="flex flex-col gap-2">
            {displayItems.map((item) => (
              editingId === item.id ? (
                <EditPanel
                  key={item.id}
                  question={editQ}
                  answer={editA}
                  onChangeQ={setEditQ}
                  onChangeA={setEditA}
                  onSave={saveEdit}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <QuizItemRow
                  key={item.id}
                  item={item}
                  onEdit={startEdit}
                  onDelete={() => selectedSetId ? removeItemFromSet(selectedSetId, item.id) : deleteQuiz(item.id)}
                  speakingId={speakingId}
                  onSpeak={handleSpeak}
                  favs={favs}
                  onToggleFav={toggleFav}
                />
              )
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
