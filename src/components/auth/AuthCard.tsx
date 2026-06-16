import type { ReactNode } from 'react';

export function AuthCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={
        'animate-slide-up relative w-full max-w-[420px] rounded-3xl border border-white/80 bg-white/90 p-9 shadow-[0_30px_80px_-20px_rgba(108,99,255,0.35),0_4px_20px_rgba(108,99,255,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/80 ' +
        className
      }
    >
      {children}
    </div>
  );
}
