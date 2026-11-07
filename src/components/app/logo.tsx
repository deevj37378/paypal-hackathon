/**
 * Allowance mark: a budget meter. The needle sits at ~70% of the gauge, under the limit
 * (the faint end of the arc). Fills with currentColor; the gauge is white.
 */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <rect width="24" height="24" rx="6" fill="currentColor" />
      <g fill="none" stroke="#fff" strokeLinecap="round" strokeWidth="2.2">
        <path d="M5.5 15 A6.5 6.5 0 0 1 15.82 9.74" />
        <path d="M17.45 11.46 A6.5 6.5 0 0 1 18.5 15" strokeOpacity="0.4" />
        <path d="M12 15 L14.23 11.93" strokeWidth="1.8" />
      </g>
      <circle cx="12" cy="15" r="1.6" fill="#fff" />
    </svg>
  );
}
