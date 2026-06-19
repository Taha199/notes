import { useState } from 'react';
import { useNotes } from '../../contexts/NotesContext';
import { RichTextEditor } from '../notes/RichTextEditor';
import { answerQuestion } from '../../lib/gemini';
import { StudyMode } from './StudyMode';
import { ConfirmDialog } from '../common/ConfirmDialog';
import type { QuizItem, QuizSet } from '../../types';

const PROGRESS_KEY = 'malacadhati_quiz_progress';

function loadProgress(): Record<string, Record<number, 'known' | 'learning'>> {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); } catch { return {}; }
}

function saveProgress(all: Record<string, Record<number, 'known' | 'learning'>>) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
}

function mdToHtml(content: string): string {
  if (/<[a-z][\s\S]*>/i.test(content)) return content;
  return content
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function parseImportText(raw: string): { question: string; answer: string }[] {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const pairs: { question: string; answer: string }[] = [];
  // Try tab-separated first
  const tabPairs = lines.map((l) => l.split('\t'));
  if (tabPairs.every((p) => p.length >= 2)) {
    return tabPairs.map(([q, ...rest]) => ({ question: q.trim(), answer: rest.join('\t').trim() })).filter((p) => p.question && p.answer);
  }
  // Try pipe-separated
  const pipePairs = lines.map((l) => l.split('|'));
  if (pipePairs.every((p) => p.length >= 2)) {
    return pipePairs.map(([q, ...rest]) => ({ question: q.trim(), answer: rest.join('|').trim() })).filter((p) => p.question && p.answer);
  }
  // Alternating lines: Q, A, Q, A ...
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (lines[i] && lines[i + 1]) pairs.push({ question: lines[i], answer: lines[i + 1] });
  }
  return pairs;
}

interface QuizItemRowProps {
  item: QuizItem;
  onEdit: (item: QuizItem) => void;
  onDelete: () => void;
  speakingId: number | null;
  onSpeak: (id: number) => void;
  favs: Set<number>;
  onToggleFav: (id: number) => void;
  progressMap?: Record<number, 'known' | 'learning'>;
}

function QuizItemRow({ item, onEdit, onDelete, speakingId, onSpeak, favs, onToggleFav, progressMap }: QuizItemRowProps) {
  const status = progressMap?.[item.id];
  return (
    <div className="group overflow-hidden rounded-2xl border border-app-border bg-white shadow-sm transition-all hover:shadow-md dark:border-white/10 dark:bg-[#1e1e2e]">
      <div className="flex items-stretch">
        <div className="flex flex-1 items-center gap-2 px-4 py-4">
          {status && (
            <span className={`flex-shrink-0 text-[10px] font-bold ${status === 'known' ? 'text-emerald-500' : 'text-red-400'}`}>
              {status === 'known' ? '✓' : '✗'}
            </span>
          )}
          <span className="text-[13px] font-semibold text-app-text dark:text-gray-100 leading-snug" dangerouslySetInnerHTML={{ __html: mdToHtml(item.question) }} />
        </div>
        <div className="w-px flex-shrink-0 bg-app-border dark:bg-white/10" />
        <div className="flex w-1/2 flex-shrink-0 items-center px-4 py-4">
          <span className="text-[13px] text-app-text dark:text-gray-100 leading-snug" dangerouslySetInnerHTML={{ __html: mdToHtml(item.answer) }} />
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

function ImportModal({ onImport, onClose }: { onImport: (pairs: { question: string; answer: string }[]) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const preview = parseImportText(text);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-app-border bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-app-text dark:text-gray-100">📋 Import from text</h3>
          <button onClick={onClose} className="text-app-text-secondary hover:text-app-text">✕</button>
        </div>
        <p className="text-[12px] text-app-text-secondary dark:text-gray-400">
          Paste pairs separated by <strong>Tab</strong>, <strong>|</strong>, or <strong>alternating lines</strong> (question, answer, question, answer…)
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Capital of France\tParis\nCapital of Japan\tTokyo"}
          rows={6}
          className="w-full resize-none rounded-xl border border-app-border bg-app-bg px-4 py-3 text-[13px] font-mono text-app-text outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 dark:border-white/10 dark:bg-gray-800 dark:text-gray-100"
        />
        {text && (
          <div className="rounded-xl border border-app-border bg-app-bg px-3 py-2 dark:border-white/10 dark:bg-gray-800">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60">Preview — {preview.length} pairs</p>
            <div className="max-h-32 overflow-y-auto">
              {preview.slice(0, 5).map((p, i) => (
                <div key={i} className="flex gap-2 py-0.5 text-[11px]">
                  <span className="font-semibold text-app-text dark:text-gray-200 truncate">{p.question}</span>
                  <span className="flex-shrink-0 text-app-text-secondary/50">→</span>
                  <span className="text-app-text-secondary dark:text-gray-400 truncate">{p.answer}</span>
                </div>
              ))}
              {preview.length > 5 && <p className="text-[10px] text-app-text-secondary/50">+{preview.length - 5} more…</p>}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-app-border px-4 py-2 text-[13px] text-app-text-secondary hover:bg-app-bg dark:border-white/10">Cancel</button>
          <button
            onClick={() => { if (preview.length > 0) { onImport(preview); onClose(); } }}
            disabled={preview.length === 0}
            className="rounded-xl bg-primary px-5 py-2 text-[13px] font-semibold text-white hover:bg-primary-dark disabled:opacity-40"
          >
            Import {preview.length > 0 ? `${preview.length} pairs` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

const SET_COLORS = [
  { name: 'Default', value: '' },
  { name: 'Lila', value: '#8b5cf6' },
  { name: 'Blå', value: '#3b82f6' },
  { name: 'Grön', value: '#10b981' },
  { name: 'Gul', value: '#f59e0b' },
  { name: 'Röd', value: '#ef4444' },
  { name: 'Rosa', value: '#ec4899' },
  { name: 'Cyan', value: '#06b6d4' },
];

export function QuizPage() {
  const { quizzes, quizSets, deleteQuiz, updateQuiz, addQuizSet, deleteQuizSet, renameQuizSet, setQuizSetColor, addItemToSet, removeItemFromSet, updateItemInSet } = useNotes();

  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [favs, setFavs] = useState<Set<number>>(new Set());
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [allProgress, setAllProgress] = useState<Record<string, Record<number, 'known' | 'learning'>>>(loadProgress);

  // Study mode
  const [studyMode, setStudyMode] = useState<'flashcard' | 'written' | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editQ, setEditQ] = useState('');
  const [editA, setEditA] = useState('');

  // New question panel
  const [addingQuestion, setAddingQuestion] = useState(false);
  const [newQ, setNewQ] = useState('');
  const [newA, setNewA] = useState('');

  // Rename set
  const [renamingSetId, setRenamingSetId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');

  // Import
  const [showImport, setShowImport] = useState(false);

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

  const handleQuickCreateSet = () => {
    const num = quizSets.length + 1;
    const name = `Nameless ${num}`;
    const s = addQuizSet(name);
    setSelectedSetId(s.id);
  };

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ setId: string; x: number; y: number } | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [confirmDeleteSetId, setConfirmDeleteSetId] = useState<string | null>(null);

  const openCtxMenu = (e: React.MouseEvent, setId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ setId, x: e.clientX, y: e.clientY });
    setShowColorPicker(false);
  };

  const closeCtxMenu = () => { setCtxMenu(null); setShowColorPicker(false); };

  const handleImport = (pairs: { question: string; answer: string }[]) => {
    pairs.forEach((p) => {
      if (selectedSetId) {
        addItemToSet(selectedSetId, { noteId: 0, noteTitle: '', question: p.question, answer: p.answer, date: new Date().toLocaleDateString() });
      }
    });
  };

  const progressKey = selectedSetId ?? 'all';
  const currentProgress = allProgress[progressKey] ?? {};
  const knownCount = Object.values(currentProgress).filter((v) => v === 'known').length;

  const handleSaveProgress = (p: Record<number, 'known' | 'learning'>) => {
    const next = { ...allProgress, [progressKey]: p };
    setAllProgress(next);
    saveProgress(next);
  };

  const selectedSet: QuizSet | undefined = quizSets.find((s) => s.id === selectedSetId);
  const displayItems: QuizItem[] = selectedSet ? (selectedSet.items ?? []) : quizzes;

  const progressForSet = (setId: string | null) => {
    const key = setId ?? 'all';
    const prog = allProgress[key] ?? {};
    const items = setId ? (quizSets.find((s) => s.id === setId)?.items ?? []) : quizzes;
    const known = items.filter((i) => prog[i.id] === 'known').length;
    return { known, total: items.length };
  };

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
          {quizSets.map((s) => {
            const { known, total } = progressForSet(s.id);
            return (
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
                      onBlur={() => { renameQuizSet(s.id, renameVal.trim() || s.name); setRenamingSetId(null); }}
                      className="min-w-0 flex-1 bg-transparent text-[12px] text-app-text outline-none dark:text-gray-200"
                    />
                    <button onClick={() => { renameQuizSet(s.id, renameVal.trim() || s.name); setRenamingSetId(null); }} className="text-[10px] text-primary">✓</button>
                  </div>
                ) : (
                  <div
                    onContextMenu={(e) => openCtxMenu(e, s.id)}
                    className={'flex w-full flex-col rounded-xl text-left text-[13px] font-medium transition-all ' +
                      (selectedSetId === s.id ? 'bg-primary/10 text-primary dark:bg-primary/20' : 'text-app-text hover:bg-white dark:text-gray-300 dark:hover:bg-white/5')}
                  >
                    <div className="flex w-full items-center">
                      {/* Colored section tab */}
                      <span
                        className="my-1.5 ml-0.5 h-6 w-2 flex-shrink-0 rounded-r-md"
                        style={{ backgroundColor: s.color || '#9ca3af' }}
                      />
                      <button onClick={() => setSelectedSetId(s.id)} className="flex flex-1 items-center gap-2 px-2.5 py-2 min-w-0">
                        <span className="flex-1 truncate" style={s.color ? { color: s.color } : undefined}>{s.name}</span>
                        <span className="text-[11px] text-app-text-secondary/60 dark:text-gray-500">{s.items?.length ?? 0}</span>
                      </button>
                      <button
                        onClick={(e) => openCtxMenu(e, s.id)}
                        className="mr-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-[13px] leading-none text-app-text-secondary/40 opacity-0 transition-opacity hover:bg-app-border hover:text-app-text group-hover:opacity-100 dark:hover:bg-white/10"
                        title="Options"
                      >···</button>
                    </div>
                    {total > 0 && known > 0 && (
                      <div className="mb-1.5 flex items-center gap-2 pl-10 pr-3">
                        <div className="h-1 flex-1 rounded-full bg-app-border dark:bg-white/10">
                          <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${(known / total) * 100}%` }} />
                        </div>
                        <span className="text-[9px] text-emerald-500 font-semibold">{known}/{total}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* New Set */}
        <div className="border-t border-app-border p-2 dark:border-white/10">
          <button
            onClick={handleQuickCreateSet}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-medium text-app-text-secondary transition-all hover:bg-white hover:text-primary dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-primary"
          >
            <span className="text-base leading-none">+</span> New Set
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-4 sm:px-5 sm:py-5">
          {/* Header */}
          <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
            <span className="flex-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">
              {selectedSet ? `📂 ${selectedSet.name}` : '🧠 All Questions'} — {displayItems.length} {displayItems.length === 1 ? 'fråga' : 'frågor'}
              {knownCount > 0 && displayItems.length > 0 && (
                <span className="ml-2 font-normal text-emerald-500">· {knownCount}/{displayItems.length} known</span>
              )}
            </span>
            {displayItems.length > 0 && (
              <div className="flex items-center gap-1.5">
                {/* Import - only for sets */}
                {selectedSetId && (
                  <button
                    onClick={() => setShowImport(true)}
                    className="flex items-center gap-1 rounded-xl border border-app-border px-2.5 py-1.5 text-[11px] font-medium text-app-text-secondary hover:bg-app-bg dark:border-white/10 dark:text-gray-400"
                    title="Import from text"
                  >
                    📋 Import
                  </button>
                )}
                {/* Study buttons */}
                <button
                  onClick={() => setStudyMode('flashcard')}
                  className="flex items-center gap-1 rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300"
                >
                  🃏 Flashcards
                </button>
                <button
                  onClick={() => setStudyMode('written')}
                  className="flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300"
                >
                  ✏️ Written
                </button>
                {selectedSetId && (
                  <button
                    onClick={() => { setAddingQuestion(true); setNewQ(''); setNewA(''); }}
                    className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-1.5 text-[12px] font-semibold text-primary transition-all hover:bg-primary/10"
                  >
                    + Add
                  </button>
                )}
              </div>
            )}
            {displayItems.length === 0 && selectedSetId && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowImport(true)}
                  className="flex items-center gap-1 rounded-xl border border-app-border px-2.5 py-1.5 text-[11px] font-medium text-app-text-secondary hover:bg-app-bg dark:border-white/10 dark:text-gray-400"
                >
                  📋 Import
                </button>
                <button
                  onClick={() => { setAddingQuestion(true); setNewQ(''); setNewA(''); }}
                  className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-1.5 text-[12px] font-semibold text-primary transition-all hover:bg-primary/10"
                >
                  ✏️ Add Question
                </button>
              </div>
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
                ? <p className="text-sm">This set is empty.<br />Click <strong>Add Question</strong> or <strong>Import</strong> to get started.</p>
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
                  progressMap={currentProgress}
                />
              )
            ))}
          </div>
        </div>
      </div>

      {/* Study mode overlay */}
      {studyMode && displayItems.length > 0 && (
        <StudyMode
          title={selectedSet?.name ?? 'All Questions'}
          items={displayItems}
          mode={studyMode}
          initialProgress={currentProgress}
          onClose={() => setStudyMode(null)}
          onSaveProgress={handleSaveProgress}
        />
      )}

      {/* Import modal */}
      {showImport && selectedSetId && (
        <ImportModal
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* Context menu */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeCtxMenu} onContextMenu={(e) => { e.preventDefault(); closeCtxMenu(); }} />
          <div
            className="fixed z-50 min-w-[160px] overflow-hidden rounded-xl border border-app-border bg-white py-1 shadow-xl dark:border-white/10 dark:bg-gray-800"
            style={{ top: ctxMenu.y, left: ctxMenu.x }}
          >
            <button
              onClick={() => {
                const s = quizSets.find((x) => x.id === ctxMenu.setId);
                if (s) { setRenamingSetId(s.id); setRenameVal(s.name); setSelectedSetId(s.id); }
                closeCtxMenu();
              }}
              className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-app-text hover:bg-app-bg dark:text-gray-200 dark:hover:bg-white/5"
            >
              ✏️ Byt namn
            </button>
            <button
              onClick={() => setShowColorPicker((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-4 py-2 text-[13px] text-app-text hover:bg-app-bg dark:text-gray-200 dark:hover:bg-white/5"
            >
              <span className="flex items-center gap-3">🎨 Färg</span>
              <span className="text-app-text-secondary/50">{showColorPicker ? '▾' : '›'}</span>
            </button>
            {showColorPicker && (
              <div className="flex flex-wrap gap-1.5 px-4 py-2">
                {SET_COLORS.map((c) => {
                  const active = (quizSets.find((x) => x.id === ctxMenu.setId)?.color ?? '') === c.value;
                  return (
                    <button
                      key={c.name}
                      title={c.name}
                      onClick={() => { setQuizSetColor(ctxMenu.setId, c.value); closeCtxMenu(); }}
                      className={'flex h-6 w-6 items-center justify-center rounded-full border transition-all ' +
                        (active ? 'border-app-text ring-2 ring-primary/40 dark:border-white' : 'border-app-border dark:border-white/20')}
                      style={c.value ? { backgroundColor: c.value } : undefined}
                    >
                      {!c.value && <span className="text-[10px] text-app-text-secondary">✕</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="my-1 h-px bg-app-border dark:bg-white/10" />
            <button
              onClick={() => {
                setConfirmDeleteSetId(ctxMenu.setId);
                closeCtxMenu();
              }}
              className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
            >
              🗑 Ta bort set
            </button>
          </div>
        </>
      )}

      {/* Delete set confirmation */}
      {confirmDeleteSetId && (() => {
        const s = quizSets.find((x) => x.id === confirmDeleteSetId);
        return (
          <ConfirmDialog
            title="Ta bort set"
            message={`Är du säker på att du vill ta bort "${s?.name ?? ''}"? Alla ${s?.items?.length ?? 0} frågor i detta set raderas.`}
            confirmLabel="Ta bort"
            cancelLabel="Avbryt"
            onConfirm={() => {
              if (selectedSetId === confirmDeleteSetId) setSelectedSetId(null);
              deleteQuizSet(confirmDeleteSetId);
              setConfirmDeleteSetId(null);
            }}
            onCancel={() => setConfirmDeleteSetId(null)}
          />
        );
      })()}
    </div>
  );
}
