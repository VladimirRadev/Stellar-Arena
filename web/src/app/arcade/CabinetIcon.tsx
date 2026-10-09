import { KIND } from './arcade'

/**
 * Original cabinet icons, one per kind: creature (DUEL), chest (TIERS), lanes (RACE), cards (HIGHCARD),
 * extraction beacon (EXTRACT). Emerald line work with the cabinet's genre colour as the accent.
 */
export function CabinetIcon({ kind, color, size = 48 }: { kind: number; color: string; size?: number }) {
  const line = { fill: 'none', stroke: '#34d399', strokeWidth: 2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      {kind === KIND.DUEL ? (
        <>
          <path d="M18 12 14 4l8 7M30 12l4-8-3 9" {...line} stroke={color} />
          <path d="M10 21 18 12h12l9 10-4 12-13 4-10-6Z" {...line} fill="rgb(16 185 129 / 0.12)" />
          <path d="m18 22 3-2 3 2-3 2ZM27 22l3-2 3 2-3 2Z" fill={color} />
          <path d="m17 31 3-3 3 3 3-3 3 3 3-3" {...line} />
        </>
      ) : kind === KIND.TIERS ? (
        <>
          <path d="M8 22v-6q16-10 32 0v6Z" {...line} fill="rgb(16 185 129 / 0.12)" />
          <rect x="8" y="22" width="32" height="18" rx="2" {...line} fill="rgb(16 185 129 / 0.08)" />
          <path d="M16 22v18M32 22v18" {...line} strokeOpacity="0.5" />
          <rect x="21" y="19" width="6" height="8" rx="1.5" fill={color} />
          <path d="M24 4.5c.4 2.6 1.4 3.6 4 4-2.6.4-3.6 1.4-4 4-.4-2.6-1.4-3.6-4-4 2.6-.4 3.6-1.4 4-4Z" fill={color} />
        </>
      ) : kind === KIND.RACE ? (
        <>
          {[12, 20, 28, 36].map((y) => (
            <path key={y} d={`M5 ${y}h31`} {...line} strokeOpacity="0.45" strokeDasharray="3 3" />
          ))}
          <path d="M39 8v32" stroke="#e7f3ec" strokeWidth="3" strokeDasharray="2.5 2.5" />
          <path d="m22 16 6 4-6 4" {...line} stroke={color} strokeWidth="2.6" />
          <circle cx="12" cy="12" r="2" fill="#34d399" />
          <circle cx="16" cy="28" r="2" fill="#34d399" />
          <circle cx="9" cy="36" r="2" fill="#34d399" />
        </>
      ) : kind === KIND.HIGHCARD ? (
        <>
          <rect x="7" y="11" width="20" height="28" rx="3" transform="rotate(-12 17 25)" {...line} fill="rgb(16 185 129 / 0.1)" />
          <rect x="20" y="9" width="20" height="28" rx="3" transform="rotate(10 30 23)" {...line} fill="#0e1a14" />
          <path d="m30 16 5 7-5 7-5-7Z" fill={color} />
        </>
      ) : (
        <>
          <path d="M15 14a12 12 0 0 1 18 0M10 9a19 19 0 0 1 28 0" {...line} stroke={color} />
          <circle cx="24" cy="19" r="3.2" fill={color} />
          <path d="M24 22v14" {...line} />
          <path d="M14 41h20l-10-11Z" {...line} fill="rgb(16 185 129 / 0.12)" />
        </>
      )}
    </svg>
  )
}
