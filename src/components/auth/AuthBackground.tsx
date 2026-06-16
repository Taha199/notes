const PARTICLES = [
  { top: '12%', left: '18%', size: 5, delay: '0s' },
  { top: '22%', left: '78%', size: 4, delay: '0.6s' },
  { top: '38%', left: '8%', size: 3, delay: '1.2s' },
  { top: '64%', left: '85%', size: 6, delay: '0.3s' },
  { top: '74%', left: '22%', size: 4, delay: '1.8s' },
  { top: '50%', left: '50%', size: 3, delay: '2.2s' },
  { top: '15%', left: '45%', size: 4, delay: '1.5s' },
  { top: '85%', left: '60%', size: 5, delay: '0.9s' },
  { top: '30%', left: '92%', size: 3, delay: '2.6s' },
  { top: '90%', left: '12%', size: 4, delay: '0.4s' },
];

export function AuthBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-gradient-to-br from-[#F0EFFE] via-[#F6F4FF] to-[#E8F0FF] dark:from-[#13131F] dark:via-[#0F0F17] dark:to-[#0F1620]">
      <div className="absolute -top-32 -right-32 h-[480px] w-[480px] rounded-full bg-primary/25 blur-[100px] animate-float-slow dark:bg-primary/15" />
      <div className="absolute top-1/3 -left-40 h-[420px] w-[420px] rounded-full bg-blue-300/30 blur-[100px] animate-float-slower dark:bg-blue-500/10" />
      <div className="absolute bottom-[-160px] right-1/4 h-[400px] w-[400px] rounded-full bg-purple-300/25 blur-[100px] animate-float-slow dark:bg-purple-500/10" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(108,99,255,0.07)_1px,transparent_0)] [background-size:28px_28px] opacity-40 dark:opacity-10" />
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="animate-twinkle absolute rounded-full bg-primary/70 shadow-[0_0_8px_2px_rgba(108,99,255,0.5)] dark:bg-white/60"
          style={{ top: p.top, left: p.left, width: p.size, height: p.size, animationDelay: p.delay }}
        />
      ))}
    </div>
  );
}
