export function FilesLoadingIndicator({ text }: { text: string }) {
  const label = text.replace(/[.…]+\s*$/, '');
  return (
    <div className="flex flex-col items-center gap-3">
      <span className="animate-files-loading-float text-4xl opacity-50" aria-hidden>☁️</span>
      <p className="flex items-center gap-0.5 text-sm font-medium">
        <span className="animate-files-loading-shimmer bg-gradient-to-r from-app-text-secondary via-primary to-app-text-secondary bg-[length:220%_100%] bg-clip-text text-transparent dark:from-gray-500 dark:via-primary/90 dark:to-gray-500">
          {label}
        </span>
        <span className="inline-flex min-w-[1.4rem] translate-y-px gap-px text-primary/80 dark:text-primary/90" aria-hidden>
          <span className="animate-files-loading-dot [animation-delay:0ms]">·</span>
          <span className="animate-files-loading-dot [animation-delay:180ms]">·</span>
          <span className="animate-files-loading-dot [animation-delay:360ms]">·</span>
        </span>
      </p>
    </div>
  );
}
