export function CertusMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="3 3 56 56" width={size} height={size} fill="none" role="img" aria-label="Certus" className={`shrink-0 ${className}`}>
      <path d="M46 18.5C42.1 13.6 36.4 10.5 30 10.5C18.7 10.5 9.5 19.7 9.5 31" stroke="#E86F4C" strokeWidth="11" />
      <path d="M9.5 31C9.5 42.3 18.7 51.5 30 51.5C36.4 51.5 42.1 48.4 46 43.5" stroke="#E86F4C" strokeWidth="11" />
      <path d="M6 31H58" stroke="#E86F4C" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M32 24.8L33.9 29.5L38.6 31.4L33.9 33.3L32 38L30.1 33.3L25.4 31.4L30.1 29.5L32 24.8Z" fill="#E86F4C" />
    </svg>
  );
}
