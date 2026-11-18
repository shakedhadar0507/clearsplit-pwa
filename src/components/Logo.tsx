import { useId } from 'react';

export function LogoMark({ size = 32 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#g${id})`} />
      <path d="M38 20a14 14 0 1 0 0 24" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <circle cx="44" cy="32" r="5" fill="#5eead4" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold text-[17px] tracking-tight">
      <LogoMark size={30} /> <span dir="ltr">ClearSplit</span>
    </span>
  );
}
