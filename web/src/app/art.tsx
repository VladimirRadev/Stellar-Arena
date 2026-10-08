import { useId, type SVGProps } from 'react'

type ArtProps = SVGProps<SVGSVGElement> & { size?: number }

/**
 * The Arena emblem: an original low-poly fox guardian inside a hexagonal badge.
 * Built only from flat polygons (emerald and lime facets on a dark field), with the
 * four-point Stellar star on the forehead.
 */
export function FoxEmblem({ size = 240, ...props }: ArtProps) {
  const id = useId()
  const rim = `${id}-rim`
  const field = `${id}-field`
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Fox guardian emblem" {...props}>
      <defs>
        <linearGradient id={rim} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#A3E635" />
          <stop offset="0.5" stopColor="#34D399" />
          <stop offset="1" stopColor="#10B981" />
        </linearGradient>
        <radialGradient id={field} cx="0.5" cy="0.42" r="0.62">
          <stop offset="0" stopColor="#13301f" />
          <stop offset="1" stopColor="#07110d" />
        </radialGradient>
      </defs>
      {/* Hexagonal badge */}
      <path d="M60 4 108 32v56L60 116 12 88V32Z" fill={`url(#${field})`} stroke={`url(#${rim})`} strokeWidth="2.5" />
      <path d="M60 12 101 36v48L60 108 19 84V36Z" fill="none" stroke="#34D399" strokeOpacity="0.18" strokeWidth="1" />
      {/* Ears */}
      <path d="M28 20 47 45 35 53Z" fill="#34D399" />
      <path d="M32 28 43 44 37 48Z" fill="#A3E635" fillOpacity="0.85" />
      <path d="M92 20 73 45 85 53Z" fill="#10B981" />
      <path d="M88 28 77 44 83 48Z" fill="#A3E635" fillOpacity="0.6" />
      {/* Head facets */}
      <path d="M47 45 60 39 73 45 60 57Z" fill="#10B981" />
      <path d="M35 53 47 45 60 57 41 72Z" fill="#059669" />
      <path d="M85 53 73 45 60 57 79 72Z" fill="#34D399" />
      <path d="M41 72 60 57 52 80Z" fill="#047857" />
      <path d="M79 72 60 57 68 80Z" fill="#10B981" />
      {/* Muzzle */}
      <path d="M52 80 60 57 68 80 60 95Z" fill="#6EE7B7" />
      <path d="M52 80 60 95 47 84Z" fill="#A3E635" fillOpacity="0.9" />
      <path d="M68 80 60 95 73 84Z" fill="#A3E635" fillOpacity="0.7" />
      <path d="M56 90h8l-4 6Z" fill="#07110d" />
      {/* Eyes */}
      <path d="M45 58 55 61 46 63Z" fill="#ECFCCB" />
      <path d="M75 58 65 61 74 63Z" fill="#ECFCCB" />
      {/* Stellar star on the forehead */}
      <path d="M60 41.5c.5 4 2.4 5.9 6.8 6.8-4.4.9-6.3 2.8-6.8 6.8-.5-4-2.4-5.9-6.8-6.8 4.4-.9 6.3-2.8 6.8-6.8Z" fill="#ECFCCB" />
      {/* Guardian collar */}
      <path d="M38 100 60 92 82 100 60 110Z" fill="none" stroke={`url(#${rim})`} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

const stroke = (size: number): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
})

export const SwordIcon = ({ size = 22, ...p }: ArtProps) => (
  <svg {...stroke(size)} {...p}>
    <path d="M14.5 3.5H20.5V9.5L10 20" />
    <path d="M5 14.5 9.5 19M3.5 20.5l3-3M12.5 5.5l6 6" />
  </svg>
)

export const ShieldIcon = ({ size = 22, ...p }: ArtProps) => (
  <svg {...stroke(size)} {...p}>
    <path d="M12 3 19.5 6v5.5c0 4.6-3.1 8.2-7.5 9.5-4.4-1.3-7.5-4.9-7.5-9.5V6Z" />
    <path d="M12 7v10M8 11h8" />
  </svg>
)

export const FistIcon = ({ size = 22, ...p }: ArtProps) => (
  <svg {...stroke(size)} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 15.5 15.5 8.5" />
  </svg>
)

export const TrophyIcon = ({ size = 22, ...p }: ArtProps) => (
  <svg {...stroke(size)} {...p}>
    <path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0Z" />
    <path d="M7.5 6H4.5a3 3 0 0 0 3 4M16.5 6h3a3 3 0 0 1-3 4M12 13.5V17M8.5 20h7M9.5 17h5v3h-5Z" />
  </svg>
)
