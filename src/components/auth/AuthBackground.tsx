export function AuthBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-gradient-to-br from-[#F0EFFE] via-[#F6F4FF] to-[#E8F0FF] dark:from-[#13131F] dark:via-[#0F0F17] dark:to-[#0F1620]">
      <div className="absolute -top-32 -right-32 h-[480px] w-[480px] rounded-full bg-primary/25 blur-[100px] animate-float-slow dark:bg-primary/15" />
      <div className="absolute top-1/3 -left-40 h-[420px] w-[420px] rounded-full bg-blue-300/30 blur-[100px] animate-float-slower dark:bg-blue-500/10" />
      <div className="absolute bottom-[-160px] right-1/4 h-[400px] w-[400px] rounded-full bg-purple-300/25 blur-[100px] animate-float-slow dark:bg-purple-500/10" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(108,99,255,0.07)_1px,transparent_0)] [background-size:28px_28px] opacity-40 dark:opacity-10" />
    </div>
  );
}
