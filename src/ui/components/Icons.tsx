const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export const SpinnerIcon = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size} className="spin">
    <path d="M21 12a9 9 0 1 1-6.2-8.55" />
  </svg>
)

export const ArrowDownIcon = () => (
  <svg {...base}>
    <path d="M12 5v14M5 12l7 7 7-7" />
  </svg>
)

export const SendIcon = () => (
  <svg {...base} width={20} height={20}>
    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
  </svg>
)

export const ChatIcon = () => (
  <svg {...base} width={44} height={44} strokeWidth={1.6}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

export const WarningIcon = () => (
  <svg {...base} width={48} height={48} strokeWidth={1.8}>
    <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
  </svg>
)
