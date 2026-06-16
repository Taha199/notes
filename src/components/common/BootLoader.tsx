export function BootLoader() {
  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-white dark:bg-gray-950">
      <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-app-border border-t-primary dark:border-white/10" />
    </div>
  );
}
