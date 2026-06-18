import { useEffect, useRef, useState } from 'react';
import type { ChatAttachment, ChatConversation, ChatMessage } from '../../types';
import { sendChatMessageStream } from '../../lib/gemini';
import { useLanguage } from '../../contexts/LanguageContext';

const STORAGE_KEY = 'malacadhati_chats';

function loadChats(): ChatConversation[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveChats(chats: ChatConversation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
}
function newId() { return `c${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }
function nowStr(locale: string) {
  return new Date().toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}
function deriveTitleFromMessage(text: string) {
  const plain = text.replace(/<[^>]*>/g, '').trim();
  return plain.length > 40 ? plain.slice(0, 40) + '…' : plain || 'New Chat';
}

function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="rounded bg-black/10 px-1 py-0.5 font-mono text-[12px] dark:bg-white/10">$1</code>')
    .replace(/^#{3}\s(.+)$/gm, '<p class="font-bold text-[14px] mt-3 mb-1">$1</p>')
    .replace(/^#{2}\s(.+)$/gm, '<p class="font-bold text-[15px] mt-4 mb-1">$1</p>')
    .replace(/^#{1}\s(.+)$/gm, '<p class="font-bold text-[16px] mt-4 mb-2">$1</p>')
    .replace(/^[-*]\s(.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/(<li[^>]*>.*<\/li>\n?)+/g, (m) => `<ul class="my-1 space-y-0.5">${m}</ul>`)
    .replace(/\n/g, '<br>');
}

function isImage(mimeType: string) { return mimeType.startsWith('image/'); }

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold shadow-sm ${isUser ? 'bg-primary text-white' : 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300'}`}>
        {isUser ? '👤' : '🤖'}
      </div>
      <div dir="auto" className={`group relative max-w-[75%] rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed shadow-sm ${isUser ? 'rounded-tr-sm bg-primary text-white' : 'rounded-tl-sm border border-app-border bg-white text-app-text dark:border-white/10 dark:bg-white/8 dark:text-gray-100'}`}>
        {msg.attachment && (
          <div className="mb-2">
            {isImage(msg.attachment.mimeType) ? (
              <img
                src={msg.attachment.dataUrl}
                alt={msg.attachment.name}
                className="max-h-48 max-w-full rounded-xl object-contain"
              />
            ) : (
              <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-medium ${isUser ? 'bg-white/20' : 'bg-app-bg dark:bg-white/10'}`}>
                <span className="text-lg">📄</span>
                <span className="truncate">{msg.attachment.name}</span>
              </div>
            )}
          </div>
        )}
        {isUser
          ? <p className="whitespace-pre-wrap">{msg.text}</p>
          : <div dir="auto" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
        }
        <div className={`mt-1 text-[10px] ${isUser ? 'text-white/60' : 'text-app-text-secondary/50 dark:text-gray-600'}`}>{msg.timestamp}</div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">🤖</div>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-app-border bg-white px-4 py-3 shadow-sm dark:border-white/10 dark:bg-white/8">
        <span className="h-2 w-2 animate-bounce rounded-full bg-primary/60 [animation-delay:0ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-primary/60 [animation-delay:150ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-primary/60 [animation-delay:300ms]" />
      </div>
    </div>
  );
}

function readFileAsBase64(file: File): Promise<{ dataUrl: string; base64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64 = dataUrl.split(',')[1] ?? '';
      resolve({ dataUrl, base64 });
    };
    reader.readAsDataURL(file);
  });
}

export function ChatPage() {
  const { t } = useLanguage();
  const locale = t.dateLocale;
  const [chats, setChats] = useState<ChatConversation[]>(loadChats);
  const [activeId, setActiveId] = useState<string | null>(() => loadChats()[0]?.id ?? null);
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeChat = chats.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChat?.messages.length, loading]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [input]);

  const createNewChat = () => {
    const conv: ChatConversation = { id: newId(), title: 'New Chat', messages: [], createdAt: nowStr(locale) };
    const next = [conv, ...chats];
    setChats(next);
    saveChats(next);
    setActiveId(conv.id);
    setInput('');
    setAttachment(null);
    setError('');
    textareaRef.current?.focus();
  };

  const deleteChat = (id: string) => {
    const next = chats.filter((c) => c.id !== id);
    setChats(next);
    saveChats(next);
    if (activeId === id) setActiveId(next[0]?.id ?? null);
  };

  const updateChats = (updated: ChatConversation[]) => { setChats(updated); saveChats(updated); };

  const handleFileSelect = async (file: File) => {
    const MAX = 10 * 1024 * 1024;
    if (file.size > MAX) { setError('File too large (max 10MB)'); return; }
    const { dataUrl, base64 } = await readFileAsBase64(file);
    setAttachment({ name: file.name, mimeType: file.type || 'application/octet-stream', dataUrl, base64 });
    setError('');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if ((!text && !attachment) || loading) return;

    let conv = activeChat;
    let isNew = false;
    if (!conv) {
      conv = { id: newId(), title: deriveTitleFromMessage(text || attachment?.name || 'File'), messages: [], createdAt: nowStr(locale) };
      isNew = true;
    }

    const userMsg: ChatMessage = {
      role: 'user',
      text,
      timestamp: nowStr(locale),
      ...(attachment ? { attachment } : {}),
    };
    const updatedMessages = [...conv.messages, userMsg];
    const updatedConv: ChatConversation = {
      ...conv,
      title: conv.messages.length === 0 ? deriveTitleFromMessage(text || attachment?.name || 'File') : conv.title,
      messages: updatedMessages,
    };

    const allChats = isNew ? [updatedConv, ...chats] : chats.map((c) => (c.id === conv!.id ? updatedConv : c));
    updateChats(allChats);
    setActiveId(updatedConv.id);
    setInput('');
    const sentAttachment = attachment;
    setAttachment(null);
    setLoading(true);
    setError('');

    try {
      const history = conv.messages.map((m) => ({ role: m.role, text: m.text }));
      let accumulated = '';
      const streamingMsg: ChatMessage = { role: 'model', text: '', timestamp: nowStr(locale) };
      const withStreaming = [...allChats];
      const convIdx = withStreaming.findIndex((c) => c.id === updatedConv.id);

      await sendChatMessageStream(
        history,
        text,
        (chunk) => {
          accumulated += chunk;
          withStreaming[convIdx] = { ...updatedConv, messages: [...updatedMessages, { ...streamingMsg, text: accumulated }] };
          setChats([...withStreaming]);
        },
        sentAttachment ? { mimeType: sentAttachment.mimeType, base64: sentAttachment.base64 } : undefined,
      );

      const finalConv: ChatConversation = { ...updatedConv, messages: [...updatedMessages, { ...streamingMsg, text: accumulated }] };
      updateChats(allChats.map((c) => (c.id === finalConv.id ? finalConv : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <div className="flex h-full overflow-hidden" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
      {/* Conversation sidebar */}
      <aside className={`flex flex-col border-r border-app-border bg-app-bg transition-all duration-200 dark:border-white/10 dark:bg-gray-950 ${sidebarOpen ? 'w-[240px] min-w-[240px]' : 'w-0 min-w-0 overflow-hidden'}`}>
        <div className="p-3">
          <button
            onClick={createNewChat}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-[13px] font-semibold text-white shadow-md shadow-primary/30 transition-all hover:-translate-y-0.5 hover:bg-primary-dark"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {chats.length === 0 ? (
            <p className="mt-6 text-center text-[12px] text-app-text-secondary/50 dark:text-gray-600">No conversations yet</p>
          ) : (
            chats.map((c) => (
              <div key={c.id} className="group relative mb-0.5">
                <button
                  onClick={() => { setActiveId(c.id); setError(''); }}
                  className={`flex w-full flex-col items-start rounded-xl px-3 py-2.5 text-left transition-all ${activeId === c.id ? 'bg-primary/10 text-primary' : 'text-app-text-secondary hover:bg-white hover:text-app-text dark:hover:bg-white/5 dark:hover:text-gray-100'}`}
                >
                  <span className="w-full truncate pr-5 text-[12.5px] font-semibold leading-snug">{c.title}</span>
                  <span className="mt-0.5 text-[10.5px] opacity-60">{c.createdAt}</span>
                </button>
                <button
                  onClick={() => deleteChat(c.id)}
                  className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-md p-1 text-[11px] text-app-text-secondary/40 hover:bg-red-50 hover:text-red-500 group-hover:flex dark:hover:bg-red-500/10"
                  title="Delete"
                >✕</button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-gray-900">
        {/* Header */}
        <div className="flex min-h-[52px] flex-shrink-0 items-center gap-3 border-b border-app-border px-4 dark:border-white/10">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-app-border bg-app-bg text-app-text-secondary shadow-sm transition-all hover:border-primary/30 hover:text-primary dark:border-white/10 dark:bg-white/5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>
            </svg>
          </button>
          <span className="text-[14px] font-semibold text-app-text dark:text-gray-100">{activeChat ? activeChat.title : 'AI Chat'}</span>
          {activeChat && <span className="ml-auto text-[11px] text-app-text-secondary/50 dark:text-gray-600">{activeChat.messages.length} messages</span>}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          {!activeChat || activeChat.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-100 text-3xl shadow-sm dark:bg-violet-500/20">🤖</div>
              <h3 className="mb-1 text-[15px] font-bold text-app-text dark:text-gray-100">How can I help you?</h3>
              <p className="text-[13px] text-app-text-secondary dark:text-gray-500">Type a message or upload an image / file.</p>
              <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {['Summarize my notes for me', 'Help me study for an exam', 'Explain a concept simply', 'Write a plan for my week'].map((s) => (
                  <button key={s} onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                    className="rounded-xl border border-app-border bg-app-bg px-4 py-2.5 text-left text-[12.5px] text-app-text-secondary transition-all hover:border-primary/30 hover:bg-primary/5 hover:text-primary dark:border-white/10 dark:bg-white/5 dark:hover:bg-primary/10">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-5">
              {activeChat.messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
              {loading && <TypingIndicator />}
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">⚠️ {error}</div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
          {(activeChat?.messages.length === 0 || !activeChat) && <div ref={bottomRef} />}
        </div>

        {/* Input area */}
        <div className="flex-shrink-0 border-t border-app-border bg-white px-4 py-3 dark:border-white/10 dark:bg-gray-900">
          <div className="mx-auto max-w-2xl">
            {/* Attachment preview */}
            {attachment && (
              <div className="mb-2 flex items-center gap-2 rounded-xl border border-app-border bg-app-bg px-3 py-2 dark:border-white/10 dark:bg-white/5">
                {isImage(attachment.mimeType) ? (
                  <img src={attachment.dataUrl} alt={attachment.name} className="h-10 w-10 rounded-lg object-cover" />
                ) : (
                  <span className="text-xl">📄</span>
                )}
                <span className="flex-1 truncate text-[12px] font-medium text-app-text dark:text-gray-200">{attachment.name}</span>
                <button onClick={() => setAttachment(null)} className="text-[13px] text-app-text-secondary/50 hover:text-red-500">✕</button>
              </div>
            )}

            <div className="flex items-end gap-2 rounded-2xl border border-app-border bg-app-bg px-3 py-2.5 shadow-sm transition-all focus-within:border-primary/50 focus-within:bg-white focus-within:ring-4 focus-within:ring-primary/10 dark:border-white/10 dark:bg-white/5 dark:focus-within:bg-gray-800">
              {/* Upload button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Upload image or file"
                className="mb-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-app-text-secondary/50 transition-all hover:bg-app-border hover:text-primary dark:hover:bg-white/10"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                </svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.txt,.doc,.docx,.csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = ''; }}
              />

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message… (Enter to send)"
                rows={1}
                className="flex-1 resize-none bg-transparent text-[13.5px] leading-relaxed text-app-text outline-none placeholder:text-app-text-secondary/50 dark:text-gray-100 dark:placeholder:text-gray-600"
                style={{ maxHeight: '160px' }}
              />

              <button
                onClick={sendMessage}
                disabled={(!input.trim() && !attachment) || loading}
                className="mb-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-md shadow-primary/30 transition-all hover:-translate-y-0.5 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-40"
                title="Send"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/>
                </svg>
              </button>
            </div>
            <p className="mt-1.5 text-center text-[10.5px] text-app-text-secondary/40 dark:text-gray-700">Powered by Gemini · responses may be inaccurate</p>
          </div>
        </div>
      </div>
    </div>
  );
}
