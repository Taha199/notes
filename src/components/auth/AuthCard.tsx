import type { ReactNode } from 'react';

export function AuthCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={
        'animate-slide-up relative w-full max-w-[460px] rounded-[28px] border border-white/80 bg-white/90 p-10 shadow-[0_30px_90px_-20px_rgba(108,99,255,0.38),0_4px_24px_rgba(108,99,255,0.1)] backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/80 ' +
        className
      }
    >
      {children}
    </div>
  );
}
