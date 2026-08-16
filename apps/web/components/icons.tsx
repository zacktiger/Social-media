/**
 * Hand-rolled icon set. Twelve outline glyphs at 24x24 on `currentColor`, so
 * they inherit hover and disabled states from the button around them and cost
 * nothing to load. An icon library would be a dependency and a network
 * request for the same result.
 */
type IconProps = {
  className?: string;
  /** Heart and bell read as "on" when filled, which is cheaper than a colour change alone. */
  filled?: boolean;
};

function Svg({ children, className = 'h-5 w-5' }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** The wordmark glyph - a single pulse trace. */
export function LogoIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2 12h4l3-8 4 16 3-8h6" strokeWidth={2} />
    </Svg>
  );
}

export function HeartIcon({ className, filled }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'h-5 w-5'}
      aria-hidden="true"
    >
      <path d="M12 20.5 4.2 12.7a5 5 0 0 1 7.1-7l.7.7.7-.7a5 5 0 1 1 7.1 7Z" />
    </svg>
  );
}

export function CommentIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M20.5 11.6a8 8 0 0 1-8.6 8 8.7 8.7 0 0 1-3.7-.9L3.5 20.2l1.5-4.4a8 8 0 0 1 6.9-12 8 8 0 0 1 8.6 7.8Z" />
    </Svg>
  );
}

export function BellIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5Z" />
      <path d="M13.7 20.5a2 2 0 0 1-3.4 0" />
    </Svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4.2-4.2" />
    </Svg>
  );
}

export function ImageIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m20.5 15.5-4.6-4.6L6 21" />
    </Svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 7h16M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7" />
      <path d="m6.5 7 .9 12a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.9-12" />
    </Svg>
  );
}

export function HomeIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m3 10.2 9-7 9 7V19a2 2 0 0 1-2 2h-3.5v-6h-7v6H5a2 2 0 0 1-2-2Z" />
    </Svg>
  );
}

export function LogoutIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9.5 21H5.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 16.5 4.5-4.5L16 7.5M20.5 12H9.5" />
    </Svg>
  );
}

export function EyeIcon({ className, filled }: IconProps) {
  // `filled` here means "password is visible", so the glyph is the struck-out one.
  return (
    <Svg className={className}>
      {filled ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 10.7a2.8 2.8 0 0 0 3.8 4M9.9 5.2A9.6 9.6 0 0 1 12 5c6.2 0 9.5 7 9.5 7a17.6 17.6 0 0 1-3.2 4.2M6.4 6.5A17.3 17.3 0 0 0 2.5 12S5.8 19 12 19a9.5 9.5 0 0 0 3.5-.7" />
        </>
      ) : (
        <>
          <path d="M2.5 12S5.8 5 12 5s9.5 7 9.5 7-3.3 7-9.5 7-9.5-7-9.5-7Z" />
          <circle cx="12" cy="12" r="2.8" />
        </>
      )}
    </Svg>
  );
}

export function UserPlusIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M15 20.5v-1.6a3.8 3.8 0 0 0-3.8-3.8H6.3a3.8 3.8 0 0 0-3.8 3.8v1.6" />
      <circle cx="8.75" cy="7.5" r="3.5" />
      <path d="M19 8.5v5M21.5 11h-5" />
    </Svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </Svg>
  );
}

export function ArrowLeftIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M20 12H4m0 0 6-6m-6 6 6 6" />
    </Svg>
  );
}

export function Spinner({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin ${className}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
