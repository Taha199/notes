import { createContext, useContext, useRef, useState, type ReactNode } from 'react';

interface ToastCtx {
  message: string | null;
  show: (msg: string) => void;
}

const ToastContext = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (msg: string) => {
    setMessage(msg);
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 2500);
  };

  return (
    <ToastContext.Provider value={{ message, show }}>
      {children}
      <div
        className={
          'fixed bottom-6 left-1/2 -translate-x-1/2 z-[999] rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white shadow-2xl transition-all duration-300 dark:bg-gray-100 dark:text-gray-900 ' +
          (visible ? 'translate-y-0 opacity-100' : 'translate-y-14 opacity-0 pointer-events-none')
        }
      >
        {message}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
