// A phone with a cracked screen, drawn in the same style as lucide icons
// (24x24, stroke = currentColor) so it sizes and colours like them.
export default function CrackedScreenIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* phone body */}
      <rect x="5" y="2" width="14" height="20" rx="2" />
      {/* speaker */}
      <path d="M11 4.5h2" />
      {/* crack spreading from an impact point */}
      <path d="M13.5 9.5 11 12l2.5 1.5L10 18" strokeWidth={1.5} />
      <path d="M11 12 7.5 10" strokeWidth={1.5} />
      <path d="M13.5 9.5 16 7" strokeWidth={1.5} />
      <path d="M13.5 13.5 16.5 15" strokeWidth={1.5} />
    </svg>
  )
}
