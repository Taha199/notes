export function Logo({ size = 32, plus = false }: { size?: number; plus?: boolean; rounded?: number }) {
  if (!plus) {
    return <img src="/logo.png" width={size} height={size} alt="Taha Note" className="select-none" draggable={false} />;
  }

  const radius = Math.round(size * 0.22);
  return (
    <div className="logo-plus-wrap relative inline-flex flex-shrink-0" style={{ width: size, height: size }}>
      <div
        className="logo-plus-ring absolute -inset-[3px] rounded-[22%] bg-gradient-to-br from-violet-500 via-primary to-amber-400 opacity-90 shadow-md shadow-violet-400/35"
        style={{ borderRadius: radius + 3 }}
      />
      <img
        src="/logo.png"
        width={size}
        height={size}
        alt="Taha Note Plus"
        className="logo-plus-img relative select-none rounded-[20%] ring-2 ring-white/90 dark:ring-gray-950/80"
        style={{ borderRadius: radius }}
        draggable={false}
      />
      <span
        className="logo-plus-badge absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border border-white bg-gradient-to-br from-amber-300 to-amber-500 text-[9px] leading-none text-white shadow-sm dark:border-gray-900"
        style={{ width: Math.max(14, size * 0.34), height: Math.max(14, size * 0.34) }}
        aria-hidden
      >
        ✦
      </span>
    </div>
  );
}
