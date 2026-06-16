export function Logo({ size = 32, rounded = 10 }: { size?: number; rounded?: number }) {
  const id = 'lg' + size;
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={id + 'bg'} x1="6" y1="6" x2="50" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#A78BFA" />
          <stop offset="0.55" stopColor="#7C3AED" />
          <stop offset="1" stopColor="#4C1D95" />
        </linearGradient>
        <linearGradient id={id + 'spine'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6D28D9" />
          <stop offset="1" stopColor="#3B0E8C" />
        </linearGradient>
      </defs>
      <rect x="6" y="13" width="44" height="37" rx={rounded} fill={`url(#${id}bg)`} />
      <rect x="6" y="42" width="44" height="8" rx="3" fill={`url(#${id}spine)`} opacity="0.85" />
      <rect x="9" y="43.5" width="38" height="2.2" rx="1.1" fill="white" opacity="0.35" />
      {[15, 23, 31, 39].map((x) => (
        <rect key={x} x={x - 2.2} y="5" width="4.4" height="12" rx="2.2" fill="#5B21B6" />
      ))}
      <path d="M18 25.5h20a2.5 2.5 0 0 1 0 5h-7.5V41a2.5 2.5 0 0 1-5 0V30.5H18a2.5 2.5 0 0 1 0-5z" fill="white" />
      <g opacity="0.95">
        <path d="M33 38c2-1 4-3 5-5" stroke="white" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
        <path d="M40.5 31.5l1-2 1 2 2 1-2 1-1 2-1-2-2-1z" fill="white" />
        <path d="M37 35.2l.6-1.2.6 1.2 1.2.6-1.2.6-.6 1.2-.6-1.2-1.2-.6z" fill="white" opacity="0.85" />
      </g>
    </svg>
  );
}
