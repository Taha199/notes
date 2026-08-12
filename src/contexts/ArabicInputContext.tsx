import { createContext, useContext, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'tahanote_arabic_kb';

interface ArabicInputCtx {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  toggle: () => void;
}

const ArabicInputContext = createContext<ArabicInputCtx | null>(null);

export function ArabicInputProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(() => localStorage.getItem(STORAGE_KEY) === '1');

  const setEnabled = (on: boolean) => {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    setEnabledState(on);
  };

  return (
    <ArabicInputContext.Provider value={{ enabled, setEnabled, toggle: () => setEnabled(!enabled) }}>
      {children}
    </ArabicInputContext.Provider>
  );
}

export function useArabicInput() {
  const ctx = useContext(ArabicInputContext);
  if (!ctx) throw new Error('useArabicInput must be used within ArabicInputProvider');
  return ctx;
}
